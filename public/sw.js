// Service worker DESACTIVADO durante el desarrollo.
// Este SW se auto-destruye: se da de baja y borra todas las cachés, para
// eliminar de raíz el problema de "versión vieja pegada" en cualquier
// dispositivo que tuviera un SW anterior registrado.
//
// Cuando publiquemos la PWA de verdad, aquí volverá una estrategia
// network-first con versión de caché.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url)); // recarga con contenido fresco
    })()
  );
});
