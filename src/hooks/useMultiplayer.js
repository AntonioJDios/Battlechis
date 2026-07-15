import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

const TABLE = 'battlechis_games';

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
    ensureAuth().catch((e) => setError(e.message));
  }, [ensureAuth]);

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
      const filledSeats = seats.map((s, i) => {
        const firstHuman = seats.findIndex((x) => x.type === 'human');
        return i === firstHuman ? { ...s, userId: uid } : { ...s, userId: null };
      });
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
      const row = rows[0];
      if (row.status !== 'waiting') throw new Error('Esa partida ya ha empezado.');
      return row;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [ensureAuth]);

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
      seats[seatIndex] = { ...seat, userId: uid, name: playerName || seat.name };

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
    refreshGame,
    pushState,
    setOnRemoteState,
    leaveGame,
  };
}
