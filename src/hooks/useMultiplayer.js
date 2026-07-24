import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

const TABLE = 'battlechis_games';
const PUSH_TABLE = 'battlechis_push';
const PROFILE_TABLE = 'battlechis_profiles';
const FRIENDS_TABLE = 'battlechis_friends';
const GAME_INVITES_TABLE = 'battlechis_game_invites';
const DEFAULT_AVATAR = '🎖️';

// The player's profile lives on the device (localStorage) for instant prefill,
// and is mirrored to battlechis_profiles so rivals + the ranking can see it.
function loadLocalProfile() {
  try {
    const raw = localStorage.getItem('bc_profile');
    if (raw) { const p = JSON.parse(raw); return { nickname: p.nickname || '', avatar: p.avatar || DEFAULT_AVATAR, friendCode: p.friendCode || null, hasPassword: !!p.hasPassword }; }
  } catch { /* ignore */ }
  let nickname = '';
  try { nickname = localStorage.getItem('bc_name') || ''; } catch { /* ignore */ } // migrate old key
  return { nickname, avatar: DEFAULT_AVATAR, friendCode: null, hasPassword: false };
}

// VAPID public key (safe to expose). Set VITE_VAPID_PUBLIC_KEY (or NEXT_PUBLIC_…).
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY || import.meta.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Short, human-friendly invite code (no ambiguous chars like 0/O/1/I).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode(len = 5) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Multiplayer glue over Supabase.
 * - Anonymous auth gives each device a stable user id.
 * - A game row holds the whole game `state` (JSONB) plus the list of members.
 * - Realtime pushes row changes to every subscribed client.
 *
 * This hook is transport-only: it does NOT know the game rules. The caller
 * decides when to `pushState` and what to do with incoming `onRemoteState`.
 */
export function useMultiplayer() {
  const [userId, setUserId] = useState(null);
  const [game, setGame] = useState(null); // { id, code, status, member_ids, state, host_id }
  const [error, setError] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [profile, setProfile] = useState(loadLocalProfile);
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  const channelRef = useRef(null);
  const onRemoteRef = useRef(null);   // callback(state, meta) for incoming updates
  const pollRef = useRef(null);       // polling interval (realtime fallback)
  const lastUpdatedRef = useRef(null); // last row.updated_at we processed (dedupe)

  // ── Anonymous auth: one stable uid per device ──
  const ensureAuth = useCallback(async () => {
    if (!isSupabaseConfigured) throw new Error('Supabase no configurado');
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user) {
      setUserId(sessionData.session.user.id);
      return sessionData.session.user.id;
    }
    const { data, error: authErr } = await supabase.auth.signInAnonymously();
    if (authErr) throw authErr;
    setUserId(data.user.id);
    return data.user.id;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    ensureAuth().then(async (uid) => {
      // 1) Basic profile (nickname/avatar/has_password) — always available.
      try {
        const { data } = await supabase.from(PROFILE_TABLE).select('nickname, avatar, has_password').eq('user_id', uid).maybeSingle();
        if (data) {
          setProfile((p) => {
            const next = { ...p, nickname: data.nickname ?? p.nickname, avatar: data.avatar ?? p.avatar, hasPassword: !!data.has_password };
            try { localStorage.setItem('bc_profile', JSON.stringify(next)); } catch { /* ignore */ }
            return next;
          });
        }
      } catch { /* ignore */ }
      // 2) Friend code — needs the friends schema; skip gracefully if not there.
      try {
        const { data, error } = await supabase.from(PROFILE_TABLE).select('friend_code').eq('user_id', uid).maybeSingle();
        if (error) return; // column missing (schema not re-run yet) → link stays "Generando…"
        let friendCode = data?.friend_code || null;
        if (!friendCode) {
          friendCode = makeCode(5);
          const { error: fcErr } = await supabase.from(PROFILE_TABLE).upsert({
            user_id: uid,
            friend_code: friendCode,
            ...(data ? {} : { avatar: profileRef.current.avatar || DEFAULT_AVATAR }), // nickname stays null until chosen
          });
          if (fcErr) return; // rare code clash → retry next load
        }
        setProfile((p) => {
          const next = { ...p, friendCode };
          try { localStorage.setItem('bc_profile', JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      } catch { /* ignore */ }
    }).catch((e) => setError(e.message));
  }, [ensureAuth]);

  // ── Save this device's profile (unique nickname + avatar): local + DB ──
  const saveProfile = useCallback(async ({ nickname, avatar }) => {
    const name = (nickname ?? '').trim();
    if (name.length < 2) return { ok: false, msg: 'Elige un nombre (mínimo 2 letras).' };
    const av = avatar || DEFAULT_AVATAR;
    if (!isSupabaseConfigured) {
      const next = { ...profileRef.current, nickname: name, avatar: av };
      setProfile(next);
      try { localStorage.setItem('bc_profile', JSON.stringify(next)); } catch { /* ignore */ }
      return { ok: false, msg: 'Online no configurado: el perfil solo se guarda en este dispositivo.' };
    }
    try {
      const uid = await ensureAuth();
      const { error: upErr } = await supabase.from(PROFILE_TABLE)
        .upsert({ user_id: uid, nickname: name, avatar: av, updated_at: new Date().toISOString() });
      if (upErr) {
        if (upErr.code === '23505' || /duplicate|unique/i.test(upErr.message || '')) {
          return { ok: false, msg: `El nombre "${name}" ya está cogido, elige otro.` };
        }
        return { ok: false, msg: upErr.message };
      }
      // Read it back so we only report success once it's really in the DB.
      const { data: check, error: chkErr } = await supabase.from(PROFILE_TABLE)
        .select('nickname, avatar').eq('user_id', uid).maybeSingle();
      if (chkErr) return { ok: false, msg: chkErr.message };
      if (!check || check.nickname !== name || check.avatar !== av) {
        return { ok: false, msg: 'No se pudo confirmar el guardado en el servidor.' };
      }
      const next = { ...profileRef.current, nickname: name, avatar: av };
      setProfile(next);
      try { localStorage.setItem('bc_profile', JSON.stringify(next)); } catch { /* ignore */ }
    } catch (e) { return { ok: false, msg: e.message }; }
    return { ok: true };
  }, [ensureAuth]);

  // ── Set/change MY profile password (to use it on another device) ──
  const setPassword = useCallback(async (pw) => {
    if (!isSupabaseConfigured) return { ok: false, msg: 'Online no configurado.' };
    const p = (pw ?? '').trim();
    if (p.length < 3) return { ok: false, msg: 'La contraseña es muy corta (mínimo 3).' };
    try {
      await ensureAuth();
      const { error } = await supabase.rpc('battlechis_set_password', { p_password: p });
      if (error) return { ok: false, msg: /SHORT/.test(error.message) ? 'La contraseña es muy corta.' : error.message };
      setProfile((prev) => {
        const next = { ...prev, hasPassword: true };
        try { localStorage.setItem('bc_profile', JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [ensureAuth]);

  // ── Log in / claim an existing profile on THIS device (name + password) ──
  const claimProfile = useCallback(async (name, pw) => {
    if (!isSupabaseConfigured) return { ok: false, msg: 'Online no configurado.' };
    const n = (name ?? '').trim(); const p = (pw ?? '').trim();
    if (!n || !p) return { ok: false, msg: 'Escribe nombre y contraseña.' };
    try {
      await ensureAuth();
      const { data, error } = await supabase.rpc('battlechis_claim_profile', { p_name: n, p_password: p });
      if (error) return { ok: false, msg: /INVALID/.test(error.message) ? 'Nombre o contraseña incorrectos.' : error.message };
      const row = Array.isArray(data) ? data[0] : data;
      const uid = await ensureAuth();
      const { data: pr } = await supabase.from(PROFILE_TABLE).select('nickname, avatar, friend_code, has_password').eq('user_id', uid).maybeSingle();
      const next = {
        nickname: pr?.nickname || row?.nickname || n,
        avatar: pr?.avatar || row?.avatar || DEFAULT_AVATAR,
        friendCode: pr?.friend_code || null,
        hasPassword: pr?.has_password ?? true,
      };
      setProfile(next);
      try { localStorage.setItem('bc_profile', JSON.stringify(next)); } catch { /* ignore */ }
      return { ok: true, nickname: next.nickname };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [ensureAuth]);

  // ── Log out: drop this identity and start a fresh anonymous one ──
  const logout = useCallback(async () => {
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    try { localStorage.removeItem('bc_profile'); localStorage.removeItem('bc_name'); } catch { /* ignore */ }
    setProfile({ nickname: '', avatar: DEFAULT_AVATAR, friendCode: null, hasPassword: false });
    try {
      const { data } = await supabase.auth.signInAnonymously();
      if (data?.user) setUserId(data.user.id);
    } catch { /* ignore */ }
  }, []);

  // ── Record a finished game for the caller (1 played, +1 won if `won`) ──
  const recordResult = useCallback(async (won) => {
    if (!isSupabaseConfigured) return;
    try { await ensureAuth(); await supabase.rpc('battlechis_record_result', { won: !!won }); }
    catch { /* best-effort */ }
  }, [ensureAuth]);

  // ── Friends: search by unique name, request + accept (all in-app) ──

  // Is a nickname free (or already mine)?
  const checkNickname = useCallback(async (name) => {
    const n = (name || '').trim().replace(/[%_]/g, '');
    if (n.length < 2) return { ok: false };
    if (!isSupabaseConfigured) return { ok: true };
    try {
      const uid = await ensureAuth();
      const { data } = await supabase.from(PROFILE_TABLE).select('user_id').ilike('nickname', n).maybeSingle();
      return { ok: !data || data.user_id === uid };
    } catch { return { ok: true }; }
  }, [ensureAuth]);

  // Search profiles by (unique) name.
  const searchProfiles = useCallback(async (query) => {
    const q = (query || '').trim().replace(/[%_]/g, '');
    if (!isSupabaseConfigured || q.length < 2) return [];
    const uid = await ensureAuth();
    const { data } = await supabase.from(PROFILE_TABLE)
      .select('user_id, nickname, avatar, games_won, games_played')
      .ilike('nickname', `%${q}%`).not('nickname', 'is', null).limit(15);
    return (data || []).filter((p) => p.user_id !== uid);
  }, [ensureAuth]);

  // Send a friend request (or auto-accept if they already requested me).
  const sendFriendRequest = useCallback(async (toUserId) => {
    if (!isSupabaseConfigured || !toUserId) return { ok: false, msg: 'Online no configurado.' };
    try {
      const uid = await ensureAuth();
      if (toUserId === uid) return { ok: false, msg: 'Eres tú 🙂' };
      const { data: incoming } = await supabase.from(FRIENDS_TABLE)
        .select('user_id').eq('user_id', toUserId).eq('friend_id', uid).maybeSingle();
      if (incoming) {
        await supabase.from(FRIENDS_TABLE).update({ status: 'accepted' }).eq('user_id', toUserId).eq('friend_id', uid);
        return { ok: true, accepted: true };
      }
      const { error } = await supabase.from(FRIENDS_TABLE).insert({ user_id: uid, friend_id: toUserId, status: 'pending' });
      if (error && error.code !== '23505') return { ok: false, msg: error.message };
      const nick = profileRef.current?.nickname || 'Alguien';
      supabase.functions.invoke('notify', { body: { notify: { userId: toUserId, title: '👋 Solicitud de amistad', body: `${nick} quiere ser tu amigo en BattleChis.`, url: window.location.origin } } }).then(() => {}, () => {});
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [ensureAuth]);

  // Kept for the legacy ?friend= link: resolve the code, then send a request.
  const addFriendByCode = useCallback(async (code) => {
    const c = (code || '').trim().toUpperCase();
    if (!c) return { ok: false, msg: 'Escribe un código.' };
    if (!isSupabaseConfigured) return { ok: false, msg: 'Online no configurado.' };
    try {
      const { data: prof, error: e1 } = await supabase.from(PROFILE_TABLE)
        .select('user_id, nickname, avatar').eq('friend_code', c).maybeSingle();
      if (e1) return { ok: false, msg: e1.message };
      if (!prof) return { ok: false, msg: 'No existe ese código.' };
      const r = await sendFriendRequest(prof.user_id);
      return r.ok ? { ok: true, friend: prof, accepted: r.accepted } : r;
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [sendFriendRequest]);

  // Incoming friend requests (people who asked to be my friend).
  const listFriendRequests = useCallback(async () => {
    if (!isSupabaseConfigured) return [];
    const uid = await ensureAuth();
    const { data: rows } = await supabase.from(FRIENDS_TABLE)
      .select('user_id').eq('friend_id', uid).eq('status', 'pending');
    const ids = (rows || []).map((r) => r.user_id);
    if (!ids.length) return [];
    const { data: profs } = await supabase.from(PROFILE_TABLE).select('user_id, nickname, avatar').in('user_id', ids);
    return profs || [];
  }, [ensureAuth]);

  const acceptFriendRequest = useCallback(async (fromUserId) => {
    if (!isSupabaseConfigured) return;
    const uid = await ensureAuth();
    await supabase.from(FRIENDS_TABLE).update({ status: 'accepted' }).eq('user_id', fromUserId).eq('friend_id', uid);
  }, [ensureAuth]);

  const rejectFriendRequest = useCallback(async (fromUserId) => {
    if (!isSupabaseConfigured) return;
    const uid = await ensureAuth();
    await supabase.from(FRIENDS_TABLE).delete().eq('user_id', fromUserId).eq('friend_id', uid);
  }, [ensureAuth]);

  // My accepted friends (both directions), joined to their profiles.
  const listFriends = useCallback(async () => {
    if (!isSupabaseConfigured) return [];
    const uid = await ensureAuth();
    const { data: rows, error: e } = await supabase.from(FRIENDS_TABLE)
      .select('user_id, friend_id').eq('status', 'accepted').or(`user_id.eq.${uid},friend_id.eq.${uid}`);
    if (e) throw e;
    const ids = Array.from(new Set((rows || []).map((r) => (r.user_id === uid ? r.friend_id : r.user_id))));
    if (ids.length === 0) return [];
    const { data: profs, error: e2 } = await supabase.from(PROFILE_TABLE)
      .select('user_id, nickname, avatar, games_played, games_won').in('user_id', ids);
    if (e2) throw e2;
    return profs || [];
  }, [ensureAuth]);

  const removeFriend = useCallback(async (friendId) => {
    if (!isSupabaseConfigured) return;
    const uid = await ensureAuth();
    await supabase.from(FRIENDS_TABLE).delete()
      .or(`and(user_id.eq.${uid},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${uid})`);
  }, [ensureAuth]);

  // ── In-app game invitations ──
  const inviteToGame = useCallback(async (toUserId, gameId, code) => {
    if (!isSupabaseConfigured || !toUserId) return { ok: false };
    try {
      const uid = await ensureAuth();
      const { error } = await supabase.from(GAME_INVITES_TABLE)
        .upsert({ game_id: gameId, code, from_user: uid, to_user: toUserId }, { onConflict: 'game_id,to_user' });
      if (error) return { ok: false, msg: error.message };
      const nick = profileRef.current?.nickname || 'Un amigo';
      supabase.functions.invoke('notify', { body: { notify: { userId: toUserId, title: '🎮 ¡Te invitan a una partida!', body: `${nick} te ha invitado. Ábrela en "Mis partidas".`, url: window.location.origin } } }).then(() => {}, () => {});
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [ensureAuth]);

  const listGameInvites = useCallback(async () => {
    if (!isSupabaseConfigured) return [];
    const uid = await ensureAuth();
    const { data: inv } = await supabase.from(GAME_INVITES_TABLE)
      .select('id, game_id, code, from_user, created_at').eq('to_user', uid).order('created_at', { ascending: false });
    if (!inv || !inv.length) return [];
    const fromIds = Array.from(new Set(inv.map((i) => i.from_user)));
    const { data: profs } = await supabase.from(PROFILE_TABLE).select('user_id, nickname, avatar').in('user_id', fromIds);
    const pmap = Object.fromEntries((profs || []).map((p) => [p.user_id, p]));
    return inv.map((i) => ({ ...i, from: pmap[i.from_user] || null }));
  }, [ensureAuth]);

  const dismissGameInvite = useCallback(async (id) => {
    if (!isSupabaseConfigured) return;
    await supabase.from(GAME_INVITES_TABLE).delete().eq('id', id);
  }, []);

  // ── Ranking: your friend circle (you + friends), most wins first ──
  const fetchRanking = useCallback(async () => {
    if (!isSupabaseConfigured) return [];
    const uid = await ensureAuth();
    const friends = await listFriends();
    const ids = Array.from(new Set([uid, ...friends.map((f) => f.user_id)]));
    const { data, error: e } = await supabase.from(PROFILE_TABLE)
      .select('user_id, nickname, avatar, games_played, games_won')
      .in('user_id', ids)
      .order('games_won', { ascending: false })
      .order('games_played', { ascending: true });
    if (e) throw e;
    return data || [];
  }, [ensureAuth, listFriends]);

  // Make sure there's a free human seat for an invited friend: if none, turn a
  // bot seat into an open human seat. Returns { ok, msg? }.
  const ensureOpenSeat = useCallback(async (gameId) => {
    const { data: row, error } = await supabase.from(TABLE).select('*').eq('id', gameId).single();
    if (error || !row) return { ok: false, msg: 'No se pudo leer la partida.' };
    const seats = [...(row.state?.seats ?? [])];
    if (seats.some((s) => s.type === 'human' && !s.userId)) return { ok: true }; // already room
    const botIdx = seats.findIndex((s) => s.type === 'bot');
    if (botIdx === -1) return { ok: false, msg: 'La partida ya está llena de jugadores humanos.' };
    seats[botIdx] = { ...seats[botIdx], type: 'human', userId: null };
    const { data, error: upErr } = await supabase
      .from(TABLE).update({ state: { ...row.state, seats } }).eq('id', gameId).select().single();
    if (upErr) return { ok: false, msg: upErr.message };
    setGame(data);
    return { ok: true };
  }, []);

  // Apply a freshly-read row (from realtime OR polling), de-duplicated by updated_at.
  const applyRow = useCallback((row) => {
    if (!row) return;
    if (lastUpdatedRef.current && row.updated_at === lastUpdatedRef.current) return;
    lastUpdatedRef.current = row.updated_at;
    setGame((prev) => ({ ...prev, ...row }));
    if (onRemoteRef.current) {
      onRemoteRef.current(row.state, {
        status: row.status,
        memberIds: row.member_ids,
        updatedAt: row.updated_at,
      });
    }
  }, []);

  // ── Subscribe to a game: realtime + a polling fallback (every 2.5s) ──
  // Realtime with RLS + anonymous auth can silently fail to deliver; the poll
  // guarantees both the lobby and in-game state stay in sync.
  const subscribe = useCallback((gameId) => {
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    channelRef.current = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: TABLE, filter: `id=eq.${gameId}` },
        (payload) => applyRow(payload.new)
      )
      .subscribe();

    pollRef.current = setInterval(async () => {
      const { data } = await supabase.from(TABLE).select('*').eq('id', gameId).single();
      applyRow(data);
    }, 2500);
  }, [applyRow]);

  // ── Create a new game (host) ──
  // seats: array like [{faction, type:'human'|'bot', name}], initialState: game state object
  const createGame = useCallback(async (initialState, seats) => {
    setConnecting(true);
    setError(null);
    try {
      const uid = await ensureAuth();
      const code = makeCode();
      // Assign the host to the first human seat.
      const firstHuman = seats.findIndex((x) => x.type === 'human');
      const filledSeats = seats.map((s, i) => (
        i === firstHuman
          ? { ...s, userId: uid, name: profileRef.current?.nickname || s.name, avatar: profileRef.current?.avatar || DEFAULT_AVATAR }
          : { ...s, userId: null }
      ));
      const state = { ...initialState, seats: filledSeats };
      const { data, error: insErr } = await supabase
        .from(TABLE)
        .insert({ code, status: 'waiting', host_id: uid, member_ids: [uid], state })
        .select()
        .single();
      if (insErr) throw insErr;
      setGame(data);
      subscribe(data.id);
      return data;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [ensureAuth, subscribe]);

  // ── Look up a game by code (no changes yet — used to show its seats) ──
  // Look up a game by code. Returns the row for ANY status (the caller decides:
  // 'waiting' → pick a seat; 'playing' + you're a member → reconnect).
  const findGame = useCallback(async (code) => {
    setConnecting(true);
    setError(null);
    try {
      await ensureAuth();
      const clean = code.trim().toUpperCase();
      const { data: rows, error: selErr } = await supabase
        .from(TABLE)
        .select('*')
        .eq('code', clean)
        .limit(1);
      if (selErr) throw selErr;
      if (!rows || rows.length === 0) throw new Error('No existe una partida con ese código.');
      return rows[0];
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [ensureAuth]);

  // ── Reconnect to a game already in progress (you must be a member) ──
  const reconnect = useCallback((row) => {
    setGame(row);
    subscribe(row.id);
    applyRow(row); // hydrate the current state immediately
  }, [subscribe, applyRow]);

  // ── List this device's unfinished games (waiting/playing) to resume or delete ──
  const listMyGames = useCallback(async () => {
    const uid = await ensureAuth();
    // Best-effort cleanup: drop this player's finished games so they don't pile up
    // (works even without the pg_cron job). Fire-and-forget.
    supabase.from(TABLE).delete().contains('member_ids', [uid]).eq('status', 'finished').then(() => {}, () => {});
    const { data, error: selErr } = await supabase
      .from(TABLE)
      .select('*')
      .contains('member_ids', [uid])
      .neq('status', 'finished')
      .order('updated_at', { ascending: false });
    if (selErr) { setError(selErr.message); return []; }
    return data || [];
  }, [ensureAuth]);

  // ── Delete a game row (any member can, e.g. from "my games") ──
  const deleteGame = useCallback(async (gameId) => {
    const { error: delErr } = await supabase.from(TABLE).delete().eq('id', gameId);
    if (delErr) { setError(delErr.message); return false; }
    return true;
  }, []);

  // ── Enable Web Push notifications on this device ──
  const pushSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [pushEnabled, setPushEnabled] = useState(false);

  // On load, reflect whether this device is already subscribed (so the button
  // can show "activated" instead of always inviting you to activate again).
  useEffect(() => {
    if (!pushSupported || Notification.permission !== 'granted') return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => { if (sub) setPushEnabled(true); })
      .catch(() => {});
  }, [pushSupported]);

  const enablePush = useCallback(async () => {
    if (!isSupabaseConfigured) return { ok: false, msg: 'Online no configurado.' };
    if (!pushSupported) return { ok: false, msg: 'Tu navegador no soporta notificaciones push.' };
    if (!VAPID_PUBLIC) return { ok: false, msg: 'Falta la clave pública VAPID (VITE_VAPID_PUBLIC_KEY).' };
    if (location.protocol !== 'https:') return { ok: false, msg: 'Las notificaciones necesitan HTTPS (usa la web publicada).' };
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return { ok: false, msg: 'Permiso de notificaciones denegado. Actívalo en los ajustes del navegador.' };
      const uid = await ensureAuth();
      // serviceWorker.ready can hang forever if no SW is active → guard with a timeout.
      let reg;
      try {
        reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, rej) => setTimeout(() => rej(new Error('SW_TIMEOUT')), 6000)),
        ]);
      } catch {
        return { ok: false, msg: 'No hay service worker activo. Recarga la app (Ctrl+F5 / reabrir) e inténtalo otra vez.' };
      }
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
        });
      }
      const { error: upErr } = await supabase.from(PUSH_TABLE)
        .upsert({ user_id: uid, subscription: sub.toJSON(), updated_at: new Date().toISOString() });
      if (upErr) return { ok: false, msg: upErr.message };
      setPushEnabled(true);
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  }, [pushSupported, ensureAuth]);

  // ── Fire a push to a specific user via the edge function (no webhook needed) ──
  const notify = useCallback(async (payload) => {
    if (!isSupabaseConfigured || !payload?.userId) return;
    try { await supabase.functions.invoke('notify', { body: { notify: payload } }); }
    catch { /* best-effort */ }
  }, []);

  // ── Claim a specific seat in a game (the player picks which commander) ──
  const claimSeat = useCallback(async (gameId, seatIndex, playerName) => {
    setConnecting(true);
    setError(null);
    try {
      const uid = await ensureAuth();
      // Re-fetch fresh to reduce races when several people pick at once.
      const { data: row, error: selErr } = await supabase
        .from(TABLE).select('*').eq('id', gameId).single();
      if (selErr) throw selErr;
      if (row.status !== 'waiting') throw new Error('Esa partida ya ha empezado.');

      const seats = [...(row.state?.seats ?? [])];
      const seat = seats[seatIndex];
      if (!seat || seat.type !== 'human') throw new Error('Ese puesto no es válido.');
      if (seat.userId && seat.userId !== uid) throw new Error('Ese comandante ya está ocupado, elige otro.');
      seats[seatIndex] = { ...seat, userId: uid, name: playerName || seat.name, avatar: profileRef.current?.avatar || DEFAULT_AVATAR };

      const memberIds = Array.from(new Set([...(row.member_ids ?? []), uid]));
      const { data, error: updErr } = await supabase
        .from(TABLE)
        .update({ member_ids: memberIds, state: { ...row.state, seats } })
        .eq('id', row.id)
        .select()
        .single();
      if (updErr) throw updErr;
      setGame(data);
      subscribe(data.id);
      return data;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [ensureAuth, subscribe]);

  // ── Re-fetch the latest row (used right before launch to get fresh seats) ──
  const refreshGame = useCallback(async (gameId) => {
    const { data, error: selErr } = await supabase
      .from(TABLE).select('*').eq('id', gameId).single();
    if (selErr) { setError(selErr.message); return null; }
    setGame(data);
    return data;
  }, []);

  // ── Push a new game state (and optionally status) to the row ──
  const pushState = useCallback(async (gameId, newState, status) => {
    const patch = { state: newState };
    if (status) patch.status = status;
    const { error: updErr } = await supabase.from(TABLE).update(patch).eq('id', gameId);
    if (updErr) setError(updErr.message);
  }, []);

  // Register the callback fired on incoming remote state.
  const setOnRemoteState = useCallback((fn) => {
    onRemoteRef.current = fn;
  }, []);

  const leaveGame = useCallback(() => {
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    lastUpdatedRef.current = null;
    setGame(null);
  }, []);

  useEffect(() => () => {
    if (channelRef.current) supabase?.removeChannel(channelRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  return {
    available: isSupabaseConfigured,
    userId,
    game,
    error,
    connecting,
    createGame,
    findGame,
    claimSeat,
    reconnect,
    listMyGames,
    deleteGame,
    enablePush,
    pushSupported,
    pushEnabled,
    notify,
    profile,
    saveProfile,
    checkNickname,
    setPassword,
    claimProfile,
    logout,
    recordResult,
    fetchRanking,
    searchProfiles,
    sendFriendRequest,
    addFriendByCode,
    listFriendRequests,
    acceptFriendRequest,
    rejectFriendRequest,
    listFriends,
    removeFriend,
    inviteToGame,
    listGameInvites,
    dismissGameInvite,
    ensureOpenSeat,
    refreshGame,
    pushState,
    setOnRemoteState,
    leaveGame,
  };
}
