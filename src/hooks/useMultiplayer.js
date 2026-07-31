import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

const TABLE = 'battlechis_games';
const CHAT_TABLE = 'battlechis_chat';
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

// PostgREST returns PGRST202 (or "function … does not exist") when an RPC isn't
// created yet (account schema not re-run). Lets the client fall back gracefully
// so a client deploy is safe even before the SQL is applied.
function isMissingFn(err) {
  if (!err) return false;
  return err.code === 'PGRST202' || err.code === '42883'
    || /find the function|does not exist|schema cache/i.test(err.message || '');
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
  const [accountId, setAccountId] = useState(null); // stable account id (survives device changes)
  const accountIdRef = useRef(null);
  useEffect(() => { accountIdRef.current = accountId; }, [accountId]);
  const [game, setGame] = useState(null); // { id, code, status, member_ids, member_accounts, state, host_id, host_account }
  const [error, setError] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [profile, setProfile] = useState(loadLocalProfile);
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  const channelRef = useRef(null);
  const onRemoteRef = useRef(null);   // callback(state, meta) for incoming updates
  const pollRef = useRef(null);       // polling interval (realtime fallback)
  const lastUpdatedRef = useRef(null); // last row.updated_at we processed (dedupe)

  // ── In-game chat (own table, independent of turn authority) ──
  const [chatMessages, setChatMessages] = useState([]);
  const chatChannelRef = useRef(null);
  const chatPollRef = useRef(null);
  const chatIdsRef = useRef(new Set()); // dedupe by message id
  const mergeChat = useCallback((rows) => {
    if (!rows || !rows.length) return;
    setChatMessages((prev) => {
      const seen = chatIdsRef.current;
      const added = rows.filter((r) => r && r.id && !seen.has(r.id));
      if (!added.length) return prev;
      added.forEach((r) => seen.add(r.id));
      const next = [...prev, ...added].sort((a, b) =>
        (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
      return next.slice(-100); // keep the last 100
    });
  }, []);

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

  // Resolve MY account (nickname/avatar/friend code + stable account_id) for this
  // device. A device links to an account via battlechis_account_devices, so a
  // logged-in account follows you across phones. Falls back to the legacy per-uid
  // profile row if the account RPC isn't there yet (schema not re-run).
  const refreshAccount = useCallback(async () => {
    const apply = (a) => setProfile((p) => {
      const next = {
        ...p,
        nickname: a.nickname ?? p.nickname,
        avatar: a.avatar ?? p.avatar,
        friendCode: a.friend_code ?? p.friendCode,
        hasPassword: !!a.has_password,
      };
      try { localStorage.setItem('bc_profile', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    try {
      const { data, error } = await supabase.rpc('battlechis_my_account');
      if (!error && Array.isArray(data) && data[0]) {
        setAccountId(data[0].account_id || null);
        apply(data[0]);
        return data[0].account_id || null;
      }
    } catch { /* fall through to legacy */ }
    // Legacy fallback (schema not re-run yet): read the per-uid profile row.
    try {
      const uid = await ensureAuth();
      const { data } = await supabase.from(PROFILE_TABLE)
        .select('nickname, avatar, has_password, friend_code').eq('user_id', uid).maybeSingle();
      if (data) apply(data);
    } catch { /* ignore */ }
    return null;
  }, [ensureAuth]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    ensureAuth().then(() => refreshAccount()).catch((e) => setError(e.message));
  }, [ensureAuth, refreshAccount]);

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
      // Server creates the account (+ device link) or updates it; keeps the
      // stable account_id so the profile follows you across devices.
      const { data, error: rpcErr } = await supabase.rpc('battlechis_save_account', { p_name: name, p_avatar: av });
      if (rpcErr && isMissingFn(rpcErr)) {
        // Account schema not re-run yet → legacy per-device upsert (still works).
        const { error: upErr } = await supabase.from(PROFILE_TABLE)
          .upsert({ user_id: uid, nickname: name, avatar: av, updated_at: new Date().toISOString() });
        if (upErr) {
          if (upErr.code === '23505' || /duplicate|unique/i.test(upErr.message || '')) return { ok: false, msg: `El nombre "${name}" ya está cogido, elige otro.` };
          return { ok: false, msg: upErr.message };
        }
        const next = { ...profileRef.current, nickname: name, avatar: av };
        setProfile(next);
        try { localStorage.setItem('bc_profile', JSON.stringify(next)); } catch { /* ignore */ }
        return { ok: true };
      }
      if (rpcErr) {
        if (/TAKEN/.test(rpcErr.message)) return { ok: false, msg: `El nombre "${name}" ya está cogido, elige otro.` };
        if (/SHORT_NAME/.test(rpcErr.message)) return { ok: false, msg: 'Elige un nombre (mínimo 2 letras).' };
        return { ok: false, msg: rpcErr.message };
      }
      const a = Array.isArray(data) ? data[0] : data;
      if (a?.account_id) setAccountId(a.account_id);
      const next = {
        ...profileRef.current,
        nickname: a?.nickname || name,
        avatar: a?.avatar || av,
        friendCode: a?.friend_code ?? profileRef.current.friendCode,
      };
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
      // Log in = LINK this device to the account (does not move it). Several
      // devices can be linked to the same account at once.
      let { data, error } = await supabase.rpc('battlechis_link_account', { p_name: n, p_password: p });
      if (error && isMissingFn(error)) {
        // Account schema not re-run yet → legacy claim (moves the profile here).
        ({ data, error } = await supabase.rpc('battlechis_claim_profile', { p_name: n, p_password: p }));
      }
      if (error) return { ok: false, msg: /INVALID/.test(error.message) ? 'Nombre o contraseña incorrectos.' : error.message };
      const a = Array.isArray(data) ? data[0] : data;
      if (a?.account_id) setAccountId(a.account_id);
      const next = {
        nickname: a?.nickname || n,
        avatar: a?.avatar || DEFAULT_AVATAR,
        friendCode: a?.friend_code || null,
        hasPassword: a?.has_password ?? true,
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
    setAccountId(null);
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

  // ── Achievements / medals ──
  const grantAchievement = useCallback(async (code) => {
    if (!isSupabaseConfigured || !code) return;
    try { await supabase.rpc('battlechis_grant_achievement', { p_code: code }); } catch { /* best-effort */ }
  }, []);
  const listAchievements = useCallback(async () => {
    if (!isSupabaseConfigured) return [];
    try {
      const { data } = await supabase.rpc('battlechis_my_achievements');
      return Array.isArray(data) ? data.map((r) => r.code).filter(Boolean) : [];
    } catch { return []; }
  }, []);

  // ── App version (from battlechis_config) to prompt updates ──
  const fetchAppVersion = useCallback(async () => {
    if (!isSupabaseConfigured) return null;
    try {
      const { data } = await supabase.from('battlechis_config').select('value').eq('key', 'app_version').maybeSingle();
      const n = data ? parseInt(data.value, 10) : NaN;
      return Number.isFinite(n) ? n : null;
    } catch { return null; }
  }, []);

  // ── Friends: search by unique name, request + accept (all in-app) ──

  // Send a push to EVERY device of an account (friend request / game invite…).
  // NOTE: friends, invites and ranking are keyed by account_id now (not the
  // device uid), so they follow you to any phone you log into. In the objects
  // returned to the UI the `user_id` field carries the account_id (kept for the
  // components' existing `.user_id` keys).
  const notifyAccount = useCallback(async (accId, payload) => {
    if (!isSupabaseConfigured || !accId) return;
    try {
      const { data } = await supabase.rpc('battlechis_push_targets', { p_account: accId });
      const uids = Array.isArray(data) ? data.map((r) => r.device_uid).filter(Boolean) : [];
      await Promise.all(uids.map((u) => supabase.functions.invoke('notify', { body: { notify: { ...payload, userId: u } } })));
    } catch { /* best-effort */ }
  }, []);

  // Is a nickname free (or already mine)?
  const checkNickname = useCallback(async (name) => {
    const n = (name || '').trim().replace(/[%_]/g, '');
    if (n.length < 2) return { ok: false };
    if (!isSupabaseConfigured) return { ok: true };
    try {
      await ensureAuth();
      const { data } = await supabase.from(PROFILE_TABLE).select('account_id').ilike('nickname', n).maybeSingle();
      return { ok: !data || data.account_id === accountIdRef.current };
    } catch { return { ok: true }; }
  }, [ensureAuth]);

  // Search profiles (accounts) by (unique) name.
  const searchProfiles = useCallback(async (query) => {
    const q = (query || '').trim().replace(/[%_]/g, '');
    if (!isSupabaseConfigured || q.length < 2) return [];
    await ensureAuth();
    const acc = accountIdRef.current;
    const { data } = await supabase.from(PROFILE_TABLE)
      .select('account_id, nickname, avatar, games_won, games_played')
      .ilike('nickname', `%${q}%`).not('nickname', 'is', null).limit(15);
    return (data || [])
      .filter((p) => p.account_id && p.account_id !== acc)
      .map((p) => ({ ...p, user_id: p.account_id }));
  }, [ensureAuth]);

  // Send a friend request (or auto-accept if they already requested me). By account.
  const sendFriendRequest = useCallback(async (toAccount) => {
    if (!isSupabaseConfigured || !toAccount) return { ok: false, msg: 'Online no configurado.' };
    try {
      await ensureAuth();
      const acc = accountIdRef.current;
      if (!acc) return { ok: false, msg: 'Crea tu perfil (con nombre) primero.' };
      if (toAccount === acc) return { ok: false, msg: 'Eres tú 🙂' };
      const { data: incoming } = await supabase.from(FRIENDS_TABLE)
        .select('user_id').eq('user_id', toAccount).eq('friend_id', acc).maybeSingle();
      if (incoming) {
        await supabase.from(FRIENDS_TABLE).update({ status: 'accepted' }).eq('user_id', toAccount).eq('friend_id', acc);
        return { ok: true, accepted: true };
      }
      const { error } = await supabase.from(FRIENDS_TABLE).insert({ user_id: acc, friend_id: toAccount, status: 'pending' });
      if (error && error.code !== '23505') return { ok: false, msg: error.message };
      const nick = profileRef.current?.nickname || 'Alguien';
      notifyAccount(toAccount, { title: '👋 Solicitud de amistad', body: `${nick} quiere ser tu amigo en BattleChis.`, url: window.location.origin });
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [ensureAuth, notifyAccount]);

  // Kept for the legacy ?friend= link: resolve the code, then send a request.
  const addFriendByCode = useCallback(async (code) => {
    const c = (code || '').trim().toUpperCase();
    if (!c) return { ok: false, msg: 'Escribe un código.' };
    if (!isSupabaseConfigured) return { ok: false, msg: 'Online no configurado.' };
    try {
      const { data: prof, error: e1 } = await supabase.from(PROFILE_TABLE)
        .select('account_id, nickname, avatar').eq('friend_code', c).maybeSingle();
      if (e1) return { ok: false, msg: e1.message };
      if (!prof) return { ok: false, msg: 'No existe ese código.' };
      const r = await sendFriendRequest(prof.account_id);
      return r.ok ? { ok: true, friend: { ...prof, user_id: prof.account_id }, accepted: r.accepted } : r;
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [sendFriendRequest]);

  // Incoming friend requests (accounts that asked to be my friend).
  const listFriendRequests = useCallback(async () => {
    if (!isSupabaseConfigured) return [];
    await ensureAuth();
    const acc = accountIdRef.current;
    if (!acc) return [];
    const { data: rows } = await supabase.from(FRIENDS_TABLE)
      .select('user_id').eq('friend_id', acc).eq('status', 'pending');
    const ids = (rows || []).map((r) => r.user_id);
    if (!ids.length) return [];
    const { data: profs } = await supabase.from(PROFILE_TABLE).select('account_id, nickname, avatar').in('account_id', ids);
    return (profs || []).map((p) => ({ ...p, user_id: p.account_id }));
  }, [ensureAuth]);

  const acceptFriendRequest = useCallback(async (fromAccount) => {
    if (!isSupabaseConfigured) return;
    await ensureAuth();
    const acc = accountIdRef.current;
    await supabase.from(FRIENDS_TABLE).update({ status: 'accepted' }).eq('user_id', fromAccount).eq('friend_id', acc);
  }, [ensureAuth]);

  const rejectFriendRequest = useCallback(async (fromAccount) => {
    if (!isSupabaseConfigured) return;
    await ensureAuth();
    const acc = accountIdRef.current;
    await supabase.from(FRIENDS_TABLE).delete().eq('user_id', fromAccount).eq('friend_id', acc);
  }, [ensureAuth]);

  // My accepted friends (both directions), joined to their profiles. By account.
  const listFriends = useCallback(async () => {
    if (!isSupabaseConfigured) return [];
    await ensureAuth();
    const acc = accountIdRef.current;
    if (!acc) return [];
    const { data: rows, error: e } = await supabase.from(FRIENDS_TABLE)
      .select('user_id, friend_id').eq('status', 'accepted').or(`user_id.eq.${acc},friend_id.eq.${acc}`);
    if (e) throw e;
    const ids = Array.from(new Set((rows || []).map((r) => (r.user_id === acc ? r.friend_id : r.user_id))));
    if (ids.length === 0) return [];
    const { data: profs, error: e2 } = await supabase.from(PROFILE_TABLE)
      .select('account_id, nickname, avatar, games_played, games_won').in('account_id', ids);
    if (e2) throw e2;
    return (profs || []).map((p) => ({ ...p, user_id: p.account_id }));
  }, [ensureAuth]);

  const removeFriend = useCallback(async (friendAccount) => {
    if (!isSupabaseConfigured || !friendAccount) return { ok: false };
    try {
      await ensureAuth();
      const acc = accountIdRef.current;
      // Two simple deletes cover both directions of the (directed) friendship.
      const a = await supabase.from(FRIENDS_TABLE).delete().eq('user_id', acc).eq('friend_id', friendAccount);
      const b = await supabase.from(FRIENDS_TABLE).delete().eq('user_id', friendAccount).eq('friend_id', acc);
      if (a.error || b.error) return { ok: false, msg: (a.error || b.error).message };
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [ensureAuth]);

  // ── In-app game invitations (by account) ──
  const inviteToGame = useCallback(async (toAccount, gameId, code) => {
    if (!isSupabaseConfigured || !toAccount) return { ok: false };
    try {
      await ensureAuth();
      const acc = accountIdRef.current;
      const { error } = await supabase.from(GAME_INVITES_TABLE)
        .upsert({ game_id: gameId, code, from_user: acc, to_user: toAccount }, { onConflict: 'game_id,to_user' });
      if (error) return { ok: false, msg: error.message };
      const nick = profileRef.current?.nickname || 'Un amigo';
      notifyAccount(toAccount, { title: '🎮 ¡Te invitan a una partida!', body: `${nick} te ha invitado. Ábrela en "Mis partidas".`, url: window.location.origin });
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [ensureAuth, notifyAccount]);

  const listGameInvites = useCallback(async () => {
    if (!isSupabaseConfigured) return [];
    await ensureAuth();
    const acc = accountIdRef.current;
    if (!acc) return [];
    const { data: inv } = await supabase.from(GAME_INVITES_TABLE)
      .select('id, game_id, code, from_user, created_at').eq('to_user', acc).order('created_at', { ascending: false });
    if (!inv || !inv.length) return [];
    const fromIds = Array.from(new Set(inv.map((i) => i.from_user)));
    const { data: profs } = await supabase.from(PROFILE_TABLE).select('account_id, nickname, avatar').in('account_id', fromIds);
    const pmap = Object.fromEntries((profs || []).map((p) => [p.account_id, { ...p, user_id: p.account_id }]));
    return inv.map((i) => ({ ...i, from: pmap[i.from_user] || null }));
  }, [ensureAuth]);

  const dismissGameInvite = useCallback(async (id) => {
    if (!isSupabaseConfigured) return;
    await supabase.from(GAME_INVITES_TABLE).delete().eq('id', id);
  }, []);

  // ── Ranking: your friend circle (you + friends), most wins first ──
  const fetchRanking = useCallback(async () => {
    if (!isSupabaseConfigured) return [];
    await ensureAuth();
    const acc = accountIdRef.current;
    const friends = await listFriends();
    const ids = Array.from(new Set([acc, ...friends.map((f) => f.account_id)].filter(Boolean)));
    if (!ids.length) return [];
    const { data, error: e } = await supabase.from(PROFILE_TABLE)
      .select('account_id, nickname, avatar, games_played, games_won')
      .in('account_id', ids)
      .order('games_won', { ascending: false })
      .order('games_played', { ascending: true });
    if (e) throw e;
    return (data || []).map((p) => ({ ...p, user_id: p.account_id }));
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
    seats[botIdx] = { ...seats[botIdx], type: 'human', userId: null, accountId: null };
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
  // Subscribe to a game's chat: initial load + realtime INSERT + poll fallback.
  const subscribeChat = useCallback((gameId) => {
    if (chatChannelRef.current) { supabase.removeChannel(chatChannelRef.current); chatChannelRef.current = null; }
    if (chatPollRef.current) { clearInterval(chatPollRef.current); chatPollRef.current = null; }
    chatIdsRef.current = new Set();
    setChatMessages([]);
    supabase.from(CHAT_TABLE).select('*').eq('game_id', gameId)
      .order('created_at', { ascending: true }).limit(100)
      .then(({ data }) => mergeChat(data || []), () => {});
    chatChannelRef.current = supabase
      .channel(`chat:${gameId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: CHAT_TABLE, filter: `game_id=eq.${gameId}` },
        (payload) => mergeChat([payload.new]))
      .subscribe();
    chatPollRef.current = setInterval(async () => {
      const { data } = await supabase.from(CHAT_TABLE).select('*').eq('game_id', gameId)
        .order('created_at', { ascending: false }).limit(30);
      mergeChat(data || []);
    }, 3500);
  }, [mergeChat]);

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

    subscribeChat(gameId);
  }, [applyRow, subscribeChat]);

  // Send a quick chat message to the current game.
  const sendChat = useCallback(async (gameId, text) => {
    const body = (text ?? '').toString().trim();
    if (!isSupabaseConfigured || !gameId || !body) return { ok: false };
    try {
      const uid = await ensureAuth();
      const { error } = await supabase.from(CHAT_TABLE).insert({
        game_id: gameId,
        sender_uid: uid,
        sender_account: accountIdRef.current || null,
        nickname: profileRef.current?.nickname || 'Jugador',
        avatar: profileRef.current?.avatar || DEFAULT_AVATAR,
        body: body.slice(0, 300),
      });
      if (error) return { ok: false, msg: error.message };
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [ensureAuth]);

  // ── Create a new game (host) ──
  // seats: array like [{faction, type:'human'|'bot', name}], initialState: game state object
  const createGame = useCallback(async (initialState, seats) => {
    setConnecting(true);
    setError(null);
    try {
      const uid = await ensureAuth();
      const acc = accountIdRef.current;
      const code = makeCode();
      // The host's device drives every LOCAL human seat (hotseat), so claim them
      // all for this uid/account. ONLINE human seats stay open for others to join.
      const av = profileRef.current?.avatar || DEFAULT_AVATAR;
      const filledSeats = seats.map((s) => (
        s.type === 'human' && !s.online
          ? { ...s, userId: uid, accountId: acc || null, avatar: av }
          : { ...s, userId: null, accountId: null }
      ));
      const state = { ...initialState, seats: filledSeats };
      const { data, error: insErr } = await supabase
        .from(TABLE)
        .insert({ code, status: 'waiting', host_id: uid, host_account: acc || null,
                  member_ids: [uid], member_accounts: acc ? [acc] : [], state })
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

  // ── List this device's games (waiting/playing/finished) to resume or delete ──
  // NOTE: we do NOT auto-delete finished games here — doing so made in-progress
  // games "vanish" the moment someone opened this list. Old ones are cleaned by
  // the pg_cron job (or manually with the trash button).
  const listMyGames = useCallback(async () => {
    const uid = await ensureAuth();
    const acc = accountIdRef.current;
    let q = supabase.from(TABLE).select('*');
    // Games belong to the account (any linked device sees them); fall back to the
    // device uid for pre-account / anonymous games.
    q = acc
      ? q.or(`member_ids.cs.{${uid}},member_accounts.cs.{${acc}}`)
      : q.contains('member_ids', [uid]);
    const { data, error: selErr } = await q.order('updated_at', { ascending: false }).limit(30);
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

  // ── Turn OFF notifications on this device (unsubscribe + drop the row) ──
  const disablePush = useCallback(async () => {
    if (!pushSupported) return { ok: false, msg: 'No soportado.' };
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('SW_TIMEOUT')), 6000)),
      ]).catch(() => null);
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { try { await sub.unsubscribe(); } catch { /* ignore */ } }
      }
      if (isSupabaseConfigured) {
        try { const uid = await ensureAuth(); await supabase.from(PUSH_TABLE).delete().eq('user_id', uid); } catch { /* ignore */ }
      }
      setPushEnabled(false);
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, [pushSupported, ensureAuth]);

  // ── Fire a push to a specific user via the edge function (no webhook needed) ──
  const notify = useCallback(async (payload) => {
    if (!isSupabaseConfigured || (!payload?.userId && !payload?.accountId)) return;
    try { await supabase.functions.invoke('notify', { body: { notify: payload } }); }
    catch { /* best-effort */ }
  }, []);

  // "Nudge" a player whose turn it is (poke them to come play). Reaches EVERY
  // device linked to their account (resolved via RPC), with the seat's userId as
  // a fallback — no edge-function redeploy needed.
  const nudge = useCallback(async ({ accountId: acc, userId: uid } = {}) => {
    if (!isSupabaseConfigured || (!acc && !uid)) return { ok: false };
    const nick = profileRef.current?.nickname || 'Un jugador';
    const payload = {
      title: '👉 ¡Te tocaaaa!',
      body: `${nick} te avisa: ¡es tu turno en BattleChis!`,
      url: window.location.origin,
      tag: 'battlechis-nudge',
    };
    let uids = [];
    if (acc) {
      try {
        const { data } = await supabase.rpc('battlechis_push_targets', { p_account: acc });
        if (Array.isArray(data)) uids = data.map((r) => r.device_uid).filter(Boolean);
      } catch { /* RPC not there yet → fall back to the seat uid */ }
    }
    if (!uids.length && uid) uids = [uid];
    if (!uids.length) return { ok: false };
    try {
      await Promise.all(uids.map((u) =>
        supabase.functions.invoke('notify', { body: { notify: { ...payload, userId: u } } })));
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }, []);

  // ── Claim a specific seat in a game (the player picks which commander) ──
  const claimSeat = useCallback(async (gameId, seatIndex, playerName) => {
    setConnecting(true);
    setError(null);
    try {
      const uid = await ensureAuth();
      const acc = accountIdRef.current;
      // Re-fetch fresh to reduce races when several people pick at once.
      const { data: row, error: selErr } = await supabase
        .from(TABLE).select('*').eq('id', gameId).single();
      if (selErr) throw selErr;
      if (row.status !== 'waiting') throw new Error('Esa partida ya ha empezado.');

      const seats = [...(row.state?.seats ?? [])];
      const seat = seats[seatIndex];
      if (!seat || seat.type !== 'human') throw new Error('Ese puesto no es válido.');
      const mine = (seat.accountId && acc && seat.accountId === acc) || seat.userId === uid;
      if (seat.userId && !mine) throw new Error('Ese comandante ya está ocupado, elige otro.');
      seats[seatIndex] = { ...seat, userId: uid, accountId: acc || null, name: playerName || seat.name, avatar: profileRef.current?.avatar || DEFAULT_AVATAR };

      const memberIds = Array.from(new Set([...(row.member_ids ?? []), uid]));
      const memberAccounts = Array.from(new Set([...(row.member_accounts ?? []), ...(acc ? [acc] : [])]));
      const { data, error: updErr } = await supabase
        .from(TABLE)
        .update({ member_ids: memberIds, member_accounts: memberAccounts, state: { ...row.state, seats } })
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
    if (chatChannelRef.current) { supabase.removeChannel(chatChannelRef.current); chatChannelRef.current = null; }
    if (chatPollRef.current) { clearInterval(chatPollRef.current); chatPollRef.current = null; }
    chatIdsRef.current = new Set();
    setChatMessages([]);
    lastUpdatedRef.current = null;
    setGame(null);
  }, []);

  useEffect(() => () => {
    if (channelRef.current) supabase?.removeChannel(channelRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    if (chatChannelRef.current) supabase?.removeChannel(chatChannelRef.current);
    if (chatPollRef.current) clearInterval(chatPollRef.current);
  }, []);

  return {
    available: isSupabaseConfigured,
    userId,
    accountId,
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
    disablePush,
    pushSupported,
    pushEnabled,
    notify,
    nudge,
    grantAchievement,
    listAchievements,
    profile,
    fetchAppVersion,
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
    chatMessages,
    sendChat,
  };
}
