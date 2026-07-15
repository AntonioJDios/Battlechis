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
  const onRemoteRef = useRef(null); // callback(state, meta) for incoming updates

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

  // ── Realtime subscription to one game row ──
  const subscribe = useCallback((gameId) => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: TABLE, filter: `id=eq.${gameId}` },
        (payload) => {
          const row = payload.new;
          setGame((prev) => ({ ...prev, ...row }));
          if (onRemoteRef.current) {
            onRemoteRef.current(row.state, {
              status: row.status,
              memberIds: row.member_ids,
              updatedAt: row.updated_at,
            });
          }
        }
      )
      .subscribe();
    channelRef.current = channel;
  }, []);

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

  // ── Join an existing game by code ──
  const joinGame = useCallback(async (code, playerName) => {
    setConnecting(true);
    setError(null);
    try {
      const uid = await ensureAuth();
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

      // Claim the first free human seat.
      const seats = row.state?.seats ?? [];
      const freeIdx = seats.findIndex((s) => s.type === 'human' && !s.userId);
      if (freeIdx === -1) throw new Error('La partida está completa.');
      seats[freeIdx] = { ...seats[freeIdx], userId: uid, name: playerName || seats[freeIdx].name };

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
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setGame(null);
  }, []);

  useEffect(() => () => {
    if (channelRef.current) supabase?.removeChannel(channelRef.current);
  }, []);

  return {
    available: isSupabaseConfigured,
    userId,
    game,
    error,
    connecting,
    createGame,
    joinGame,
    pushState,
    setOnRemoteState,
    leaveGame,
  };
}
