// BattleChis service worker (PWA install + offline fallback).
// Strategy chosen to AVOID the classic "stale version stuck" problem:
//   • Navigations (HTML): network-first → always load the freshest app shell
//     (which references the newest hashed assets); cache is only an offline fallback.
//   • Hashed build assets (/assets/*): cache-first — safe because the file name
//     changes on every build, so a new deploy fetches new URLs.
// Bump CACHE_VERSION on notable releases to retire old caches.
const CACHE_VERSION = 'battlechis-v3';
const PRECACHE = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.allSettled(PRECACHE.map((u) => cache.add(u)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  const url = new URL(request.url);
  const isHtml = request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');

  if (isHtml) {
    // Network-first: freshest shell, fall back to cache offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first for immutable hashed assets.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
        }
        return res;
      });
    })
  );
});
