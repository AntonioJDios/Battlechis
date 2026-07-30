import React, { useState, useEffect } from 'react';
import { FACTIONS } from '../utils/boardGraph';
import { Users, Wifi, Copy, Check, ArrowLeft, Loader2, Share2, Trash2, RotateCcw, FolderOpen, Search, X } from 'lucide-react';

/**
 * Online lobby: create a game (configuring the 5 seats) or join by code,
 * then a waiting room that shows the invite code and who has joined.
 *
 * Transport comes from useMultiplayer (passed in via props). This component
 * is pure UI + orchestration; it doesn't know the game rules.
 */
export default function Lobby({ mp, seatsConfig, initialJoinCode = '', initialView = 'choose', onSeatsChange, onBack, onLaunch }) {
  const [view, setView] = useState(initialJoinCode ? 'join' : initialView); // choose | create | join | waiting | mygames | reconnecting
  const [code, setCode] = useState(initialJoinCode);
  // Default the name to the saved profile nickname (falls back to the old
  // bc_name key), so friends don't re-type it and don't land on "Invitado".
  const [name, setName] = useState(() => {
    if (mp.profile?.nickname) return mp.profile.nickname;
    try { return localStorage.getItem('bc_name') || ''; } catch { return ''; }
  });
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [foundGame, setFoundGame] = useState(null); // game row looked up by code
  const [myGames, setMyGames] = useState(null); // in-progress games list (null = not loaded)
  const [invites, setInvites] = useState(null); // game invitations received (null = not loaded)
  const [friends, setFriends] = useState(null); // friend circle (for inviting)
  const [invited, setInvited] = useState({});   // friendId -> true once a push invite is sent
  const [showShare, setShowShare] = useState(false); // reveal code/link (kept at the bottom)
  const [inviteOpen, setInviteOpen] = useState(false); // "invite a friend" search popup
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState(null);
  const [inviteSearching, setInviteSearching] = useState(false);

  // Debounced friend search for the invite popup.
  useEffect(() => {
    if (!inviteOpen) return;
    const q = inviteQuery.trim();
    if (q.length < 2) { setInviteResults(null); return; }
    setInviteSearching(true);
    const t = setTimeout(async () => {
      try { setInviteResults(await mp.searchProfiles(q)); } catch { setInviteResults([]); }
      setInviteSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [inviteQuery, inviteOpen, mp.searchProfiles]);
  const linkRef = React.useRef(null);

  // Load the friend circle when we enter the waiting room (to invite them).
  useEffect(() => {
    if (view !== 'waiting' || !mp.available) return;
    mp.listFriends().then(setFriends).catch(() => setFriends([]));
  }, [view, mp.available, mp.listFriends]);

  // Load this device's unfinished games + invitations received.
  const loadMyGames = async () => {
    setView('mygames'); setMyGames(null); setInvites(null); setLocalError(null);
    try { setMyGames(await mp.listMyGames()); }
    catch (e) { setLocalError(e.message); setMyGames([]); }
    try { setInvites(await mp.listGameInvites()); } catch { setInvites([]); }
  };

  // Join a game I was invited to (look it up by its code).
  const joinInvite = async (inv) => {
    setLocalError(null); setCode(inv.code);
    try {
      const row = await mp.findGame(inv.code);
      if (row.status === 'waiting') { setFoundGame(row); setView('pickSeat'); return; }
      const isMember = (row.member_ids || []).includes(mp.userId) || (row.state?.seats || []).some((s) => s.userId === mp.userId);
      if (isMember) { setView('reconnecting'); mp.reconnect(row); }
      else { setLocalError('Esa partida ya ha empezado y no formas parte de ella.'); }
    } catch (e) { setLocalError(e.message); }
  };

  const dismissInvite = async (inv) => {
    await mp.dismissGameInvite(inv.id);
    setInvites((prev) => (prev || []).filter((x) => x.id !== inv.id));
  };

  // Resume a saved game: playing → into the game; waiting → back to its lobby room.
  const resumeGame = (g) => {
    mp.reconnect(g);
    setView(g.status === 'playing' ? 'reconnecting' : 'waiting');
  };

  const delGame = async (g) => {
    const msg = g.status === 'finished'
      ? '¿Borrar esta partida terminada?'
      : '⚠️ Esto BORRA la partida para TODOS los jugadores y no se puede deshacer. ¿Seguro?';
    if (!window.confirm(msg)) return;
    await mp.deleteGame(g.id);
    setMyGames((prev) => (prev || []).filter((x) => x.id !== g.id));
  };

  const game = mp.game;
  const isHost = game && mp.userId === game.host_id;
  const seats = game?.state?.seats ?? seatsConfig;

  const humanCount = seatsConfig.filter((s) => s.type === 'human').length;

  const doCreate = async () => {
    setBusy(true); setLocalError(null);
    try {
      // Minimal placeholder state; the real board is seeded at launch.
      await mp.createGame({ phase: 'LOBBY' }, seatsConfig);
      setView('waiting');
    } catch (e) {
      setLocalError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Step 1: look up the game. Waiting → pick a seat. Already started → if you're
  // a member (same browser/device), reconnect; otherwise you can't join.
  const doFind = async () => {
    if (!code.trim()) { setLocalError('Escribe el código de la partida.'); return; }
    setBusy(true); setLocalError(null);
    try {
      const row = await mp.findGame(code);
      if (row.status === 'waiting') {
        setFoundGame(row);
        setView('pickSeat');
        return;
      }
      // Game in progress (or finished): reconnect only if this device is a member.
      const isMember = (row.member_ids || []).includes(mp.userId)
        || (row.state?.seats || []).some((s) => s.userId === mp.userId);
      if (isMember) {
        setView('reconnecting');
        mp.reconnect(row); // the app switches to the game once state hydrates
      } else {
        setLocalError('Esa partida ya ha empezado y no formas parte de ella (o entras desde otro dispositivo).');
      }
    } catch (e) {
      setLocalError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Arriving via a shared link (?join=CODE): look up the game automatically and
  // jump straight to picking a commander — no need to press "Buscar".
  const autoFound = React.useRef(false);
  useEffect(() => {
    if (autoFound.current || !mp.available) return;
    autoFound.current = true;
    if (initialJoinCode) doFind();
    else if (initialView === 'mygames') loadMyGames(); // opened straight from the home screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mp.available]);

  // Step 2: claim the chosen seat.
  const doClaim = async (seatIndex) => {
    setBusy(true); setLocalError(null);
    try {
      const seat = (foundGame.state?.seats ?? [])[seatIndex];
      const finalName = name.trim() || seat?.name || 'Invitado';
      try { if (name.trim()) localStorage.setItem('bc_name', name.trim()); } catch { /* ignore */ }
      await mp.claimSeat(foundGame.id, seatIndex, finalName);
      setView('waiting');
    } catch (e) {
      setLocalError(e.message);
      // Refresh seats so the player sees the up-to-date occupancy.
      try { setFoundGame(await mp.findGame(code)); } catch { /* ignore */ }
    } finally {
      setBusy(false);
    }
  };

  const inviteLink = game?.code ? `${window.location.origin}/?join=${game.code}` : '';

  const copyCode = () => {
    if (!game?.code) return;
    navigator.clipboard?.writeText(game.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const flashCopied = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const shareLink = async () => {
    if (!inviteLink) return;
    // 1) Native share sheet (mobile, https only)
    try {
      if (navigator.share) {
        await navigator.share({ title: 'BattleChis', text: `¡Únete a mi partida! Código: ${game.code}`, url: inviteLink });
        return;
      }
    } catch { return; /* user cancelled */ }
    // 2) Clipboard API (https / localhost only)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
        flashCopied();
        return;
      }
    } catch { /* fall through */ }
    // 3) Legacy fallback for insecure origins (http LAN IP): select + execCommand
    const el = linkRef.current;
    if (el) {
      el.focus();
      el.select();
      try { document.execCommand('copy'); flashCopied(); } catch { /* user copies manually */ }
    }
  };

  const err = localError || mp.error;

  // ── Not configured (no Supabase env) ──
  if (!mp.available) {
    return (
      <Shell onBack={onBack} title="Multijugador online">
        <p className="font-mono text-[11px] text-amber-400 leading-relaxed">
          El juego online no está configurado en esta versión (faltan las claves de Supabase).
          Puedes jugar en modo local en el mismo dispositivo.
        </p>
      </Shell>
    );
  }

  // ── Waiting room ──
  if (view === 'waiting' && game) {
    return (
      <Shell onBack={onBack} title="Sala de espera">
        <div className="flex flex-col gap-4">
          <div>
            <div className="font-tactical text-[10px] text-gray-400 uppercase tracking-wider mb-2">Comandantes</div>
            <div className="flex flex-col gap-2">
              {seats.map((s, i) => {
                const free = s.type === 'human' && !s.userId;
                return (
                  <div key={i} className="flex items-center gap-2 bg-[#0d101a] border border-slate-900 rounded p-2">
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: FACTIONS[s.faction]?.neon, flexShrink: 0 }} />
                    {s.type === 'human' && s.userId && s.avatar && <span className="text-base leading-none shrink-0">{s.avatar}</span>}
                    <span className="font-tactical text-[11px] text-white flex-1 truncate">{s.name}</span>
                    <span className={`font-mono text-[9px] px-2 py-0.5 rounded ${
                      s.type === 'bot' ? 'text-amber-400 bg-amber-950/30'
                      : s.userId ? 'text-green-400 bg-green-950/30' : 'text-gray-500 bg-slate-900'
                    }`}>
                      {s.type === 'bot' ? '🤖 IA' : s.userId ? '👤 Conectado' : '⏳ Libre'}
                    </span>
                    {isHost && free && (
                      <button onClick={() => { setInviteOpen(true); setInviteQuery(''); setInviteResults(null); }}
                        className="py-1 px-2.5 text-[10px] font-bold rounded border border-cyan-400/50 text-cyan-300 bg-cyan-950/20 hover:bg-cyan-900/30 shrink-0">
                        🎮 Invitar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {isHost && seats.some((s) => s.type === 'human' && !s.userId) && (
              <p className="font-mono text-[9px] text-gray-600 mt-1.5">Pulsa <strong className="text-cyan-400">Invitar</strong> en un puesto libre para buscar a tu amigo.</p>
            )}
          </div>

          {(() => {
            const humanSeats = seats.filter((s) => s.type === 'human');
            const freeSeats = humanSeats.filter((s) => !s.userId).length;
            const allFilled = humanSeats.length > 0 && freeSeats === 0;
            if (!isHost) {
              return (
                <div className="text-center font-mono text-[11px] text-cyan-400 animate-pulse py-2">
                  Esperando a que el anfitrión empiece la partida…
                </div>
              );
            }
            return (
              <>
                <button
                  onClick={() => onLaunch(game)}
                  disabled={!allFilled}
                  className={`btn-tactical py-3 text-sm font-black tracking-widest ${
                    allFilled
                      ? 'border-green-400 text-green-400 bg-green-950/20 hover:bg-green-500/20'
                      : 'border-slate-700 text-slate-500 opacity-50 cursor-not-allowed'
                  }`}
                >
                  ▶ EMPEZAR PARTIDA
                </button>
                {!allFilled && (
                  <p className="font-mono text-[10px] text-amber-400 text-center">
                    Faltan {freeSeats} jugador{freeSeats !== 1 ? 'es' : ''} por unirse (los puestos 👤 deben estar todos ocupados).
                  </p>
                )}
              </>
            );
          })()}
          {err && <p className="font-mono text-[10px] text-red-400 text-center">{err}</p>}

          {/* Share by link / code — kept compact at the bottom (in-app invites
              are the main way now). Tap to reveal. */}
          <div className="border-t border-slate-800 pt-3">
            <button
              onClick={() => setShowShare((v) => !v)}
              className="w-full flex items-center justify-center gap-2 text-slate-400 font-mono text-[11px] hover:text-cyan-300 transition-all"
            >
              <Share2 className="w-4 h-4" /> Compartir por enlace / código {showShare ? '▲' : '▼'}
            </button>
            {showShare && (
              <div className="mt-3 flex flex-col items-center gap-2 animate-fade-in">
                <button onClick={copyCode}
                  className="inline-flex items-center gap-3 px-5 py-2.5 rounded-lg border border-cyan-500/40 bg-cyan-950/20 hover:bg-cyan-900/30 transition-all">
                  <span className="font-tactical text-2xl font-black text-cyan-400 tracking-[6px]">{game.code}</span>
                  {copied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5 text-gray-400" />}
                </button>
                <button onClick={shareLink}
                  className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20 py-2 px-4 text-xs font-bold inline-flex items-center gap-2">
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Share2 className="w-4 h-4" />}
                  {copied ? '¡Copiado!' : 'Compartir enlace'}
                </button>
                <input ref={linkRef} readOnly value={inviteLink}
                  onFocus={(e) => e.target.select()} onClick={(e) => e.target.select()}
                  className="w-full bg-[#0a0d16] border border-slate-800 rounded px-2 py-1.5 font-mono text-[10px] text-cyan-300 text-center focus:outline-none focus:border-cyan-500" />
                <p className="font-mono text-[9px] text-gray-600">Ojo: abrir el enlace fuera de la app (WhatsApp) puede fallar; mejor invita por 🎮 arriba.</p>
              </div>
            )}
          </div>

          {/* Invite popup — search a friend by name to invite to this game */}
          {inviteOpen && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 720, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={() => setInviteOpen(false)}>
              <div onClick={(e) => e.stopPropagation()} className="animate-fade-in" style={{ width: 'min(380px, 94vw)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', background: '#0f121d', border: '1px solid rgba(0,240,255,0.35)', borderRadius: 8, padding: '14px 16px' }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-tactical text-[11px] text-cyan-400 font-bold uppercase tracking-widest flex-1">Invitar a la partida</span>
                  <button onClick={() => setInviteOpen(false)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center gap-2 bg-[#121625] border border-slate-800 rounded px-2 focus-within:border-cyan-500">
                  <Search className="w-4 h-4 text-slate-500 shrink-0" />
                  <input value={inviteQuery} onChange={(e) => setInviteQuery(e.target.value)} autoFocus
                    placeholder="Busca a tu amigo por nombre…"
                    className="flex-1 min-w-0 bg-transparent text-white font-mono text-sm py-2 focus:outline-none" />
                  {inviteSearching && <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />}
                </div>
                <div className="flex flex-col gap-1.5 mt-2">
                  {inviteResults === null ? (
                    <p className="font-mono text-[10px] text-gray-500 py-1">Escribe un nombre para buscar.</p>
                  ) : inviteResults.length === 0 ? (
                    <p className="font-mono text-[10px] text-gray-500 py-1">Nadie con ese nombre.</p>
                  ) : inviteResults.map((u) => {
                    const seated = seats.some((s) => s.userId === u.user_id);
                    const done = invited[u.user_id];
                    return (
                      <div key={u.user_id} className="flex items-center gap-2 bg-[#0d101a] border border-slate-900 rounded px-2 py-1.5">
                        <span className="text-lg shrink-0">{u.avatar || '🎖️'}</span>
                        <span className="font-tactical text-[12px] text-white flex-1 truncate">{u.nickname}</span>
                        {seated ? (
                          <span className="font-mono text-[9px] text-green-400 shrink-0">ya está</span>
                        ) : (
                          <button
                            onClick={async () => { await mp.inviteToGame(u.user_id, game.id, game.code); setInvited((p) => ({ ...p, [u.user_id]: true })); }}
                            disabled={done}
                            className={`py-1 px-2.5 text-[10px] font-bold rounded border shrink-0 ${done ? 'border-green-500/40 text-green-400 bg-green-950/20' : 'border-cyan-400/50 text-cyan-300 bg-cyan-950/20 hover:bg-cyan-900/30'}`}>
                            {done ? '✓ Invitado' : '🎮 Invitar'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="font-mono text-[9px] text-gray-600 mt-2">Le llega la invitación en <strong>Mis partidas</strong> (+ aviso push si lo tiene activado).</p>
              </div>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // ── Join by code ──
  if (view === 'join') {
    return (
      <Shell onBack={() => setView('choose')} title="Unirse a una partida">
        <div className="flex flex-col gap-3">
          <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Código de partida</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Ej. K7QM2"
            maxLength={6}
            className="bg-[#121625] border border-slate-800 text-cyan-400 font-tactical text-2xl tracking-[6px] text-center p-3 rounded focus:outline-none focus:border-cyan-500 uppercase"
          />
          <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider mt-1">Tu nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Comandante"
            className="bg-[#121625] border border-slate-800 text-gray-300 font-mono text-sm p-2 rounded focus:outline-none focus:border-cyan-500"
          />
          <button
            onClick={doFind}
            disabled={busy}
            className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20 py-3 text-sm font-bold mt-1 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            {busy ? 'Buscando…' : 'Entrar / Reconectar'}
          </button>
          <p className="font-mono text-[9px] text-gray-600 text-center">
            Si la partida ya empezó, con este mismo código vuelves a tu comandante (desde el mismo navegador/dispositivo).
          </p>
          {err && <p className="font-mono text-[10px] text-red-400 text-center">{err}</p>}
        </div>
      </Shell>
    );
  }

  // ── Reconnecting to a game in progress ──
  if (view === 'reconnecting') {
    return (
      <Shell onBack={onBack} title="Reconectando">
        <div className="flex flex-col items-center gap-3 py-4">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          <p className="font-mono text-[11px] text-cyan-400 text-center">Recuperando tu partida…</p>
        </div>
      </Shell>
    );
  }

  // ── Pick which commander you are ──
  if (view === 'pickSeat' && foundGame) {
    const fseats = foundGame.state?.seats ?? [];
    const humanSeats = fseats
      .map((s, i) => ({ ...s, idx: i }))
      .filter((s) => s.type === 'human');
    return (
      <Shell onBack={() => { setView('join'); setFoundGame(null); }} title="Elige tu comandante">
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] text-cyan-300 uppercase tracking-wider">Tu nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Escribe tu nombre"
            className="bg-[#121625] border border-cyan-500/40 text-white font-mono text-sm p-2.5 rounded focus:outline-none focus:border-cyan-400 mb-1"
          />
          <p className="font-mono text-[10px] text-gray-500 mb-1">Y selecciona el puesto que vas a controlar:</p>
          {humanSeats.map((s) => {
            const taken = Boolean(s.userId);
            return (
              <button
                key={s.idx}
                onClick={() => !taken && doClaim(s.idx)}
                disabled={taken || busy}
                className={`flex items-center gap-3 rounded px-3 py-2.5 border transition-all text-left ${
                  taken
                    ? 'border-slate-800 bg-[#0d101a] opacity-50 cursor-not-allowed'
                    : 'border-cyan-500/40 bg-cyan-950/10 hover:bg-cyan-900/25'
                }`}
              >
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: FACTIONS[s.faction]?.neon, flexShrink: 0 }} />
                {taken && s.avatar && <span className="text-base leading-none shrink-0">{s.avatar}</span>}
                <span className="font-tactical text-sm text-white flex-1 truncate">{s.name}</span>
                <span className={`font-mono text-[9px] px-2 py-0.5 rounded ${taken ? 'text-gray-500 bg-slate-900' : 'text-green-400 bg-green-950/30'}`}>
                  {taken ? 'Ocupado' : 'Libre'}
                </span>
              </button>
            );
          })}
          {humanSeats.every((s) => s.userId) && (
            <p className="font-mono text-[10px] text-amber-400 text-center mt-1">Todos los puestos humanos están ocupados.</p>
          )}
          {err && <p className="font-mono text-[10px] text-red-400 text-center">{err}</p>}
        </div>
      </Shell>
    );
  }

  // ── My in-progress games (resume / delete) ──
  if (view === 'mygames') {
    return (
      <Shell onBack={() => setView('choose')} title="Mis partidas">
        <div className="flex flex-col gap-2">
          {/* Invitations received */}
          {invites && invites.length > 0 && (
            <div className="mb-1">
              <div className="font-tactical text-[10px] text-amber-400 uppercase tracking-wider mb-1">🎮 Te han invitado</div>
              <div className="flex flex-col gap-1.5">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2 bg-[#0d101a] border border-amber-500/30 rounded px-2 py-2">
                    <span className="text-base shrink-0">{inv.from?.avatar || '🎖️'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-tactical text-[11px] text-white truncate">{inv.from?.nickname || 'Un amigo'} te invita</div>
                      <div className="font-mono text-[9px] text-gray-500">Código {inv.code}</div>
                    </div>
                    <button onClick={() => joinInvite(inv)} className="btn-tactical border-green-400 text-green-400 bg-green-950/20 hover:bg-green-500/20 py-1.5 px-3 text-[11px] font-bold shrink-0">Unirse</button>
                    <button onClick={() => dismissInvite(inv)} title="Descartar" className="p-1.5 text-slate-600 hover:text-red-400 shrink-0"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-800 mt-2" />
            </div>
          )}
          {myGames === null ? (
            <div className="flex items-center justify-center gap-2 py-6 text-cyan-400 font-mono text-[11px]">
              <Loader2 className="w-5 h-5 animate-spin" /> Cargando…
            </div>
          ) : myGames.length === 0 ? (
            <p className="font-mono text-[11px] text-gray-500 text-center py-6">No tienes partidas en curso en este dispositivo.</p>
          ) : (
            myGames.map((g) => {
              const seats = g.state?.seats ?? [];
              const humans = seats.filter((s) => s.type === 'human' && s.userId).length;
              const when = g.updated_at ? new Date(g.updated_at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
              return (
                <div key={g.id} className="flex items-center gap-2 bg-[#0d101a] border border-slate-800 rounded px-2 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-tactical text-sm font-black text-cyan-400 tracking-widest">{g.code}</span>
                      <span className={`font-mono text-[8px] px-1.5 py-0.5 rounded ${g.status === 'playing' ? 'text-green-400 bg-green-950/40' : g.status === 'finished' ? 'text-slate-400 bg-slate-800/60' : 'text-amber-400 bg-amber-950/40'}`}>
                        {g.status === 'playing' ? 'EN JUEGO' : g.status === 'finished' ? 'TERMINADA' : 'EN ESPERA'}
                      </span>
                    </div>
                    <div className="font-mono text-[9px] text-gray-500 truncate">👤 {humans} · {when}</div>
                  </div>
                  <button
                    onClick={() => resumeGame(g)}
                    className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20 py-1.5 px-3 text-[11px] font-bold flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Volver
                  </button>
                  {/* Only the host can delete an active game (avoids a player
                      accidentally nuking the shared game); anyone can clear a
                      finished one. */}
                  {(g.host_id === mp.userId || g.status === 'finished') && (
                    <button
                      onClick={() => delGame(g)}
                      title={g.status === 'finished' ? 'Borrar partida' : 'Borrar (para todos)'}
                      className="p-2 border border-red-500/40 rounded text-red-400 hover:bg-red-900/30 transition-all shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })
          )}
          {err && <p className="font-mono text-[10px] text-red-400 text-center">{err}</p>}
        </div>
      </Shell>
    );
  }

  // ── Choose: create or join ──
  return (
    <Shell onBack={onBack} title="Multijugador online">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-[10px] text-gray-500 leading-relaxed">
          Configura los puestos en la pantalla anterior (humanos / IA) y crea la partida,
          o únete a la de un amigo con su código.
        </p>
        <button
          onClick={doCreate}
          disabled={busy || humanCount === 0}
          className="btn-tactical border-green-400 text-green-400 bg-green-950/20 hover:bg-green-500/20 py-3 text-sm font-bold flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          Crear partida
        </button>
        <button
          onClick={() => { setView('join'); setLocalError(null); }}
          className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20 py-3 text-sm font-bold flex items-center justify-center gap-2"
        >
          <Wifi className="w-4 h-4" /> Unirse con código
        </button>
        <button
          onClick={loadMyGames}
          className="btn-tactical border-slate-600 text-slate-300 hover:bg-slate-700/30 py-3 text-sm font-bold flex items-center justify-center gap-2"
        >
          <FolderOpen className="w-4 h-4" /> Mis partidas en curso
        </button>
        {humanCount === 0 && (
          <p className="font-mono text-[9px] text-amber-400 text-center">Marca al menos un puesto como 👤 HUMANO para crear una partida online.</p>
        )}
        {err && <p className="font-mono text-[10px] text-red-400 text-center">{err}</p>}
      </div>
    </Shell>
  );
}

// No card box: fills the width, centered, scrolls with the page (not in a box).
function Shell({ title, children, onBack }) {
  return (
    <div className="w-full max-w-lg mx-auto my-auto p-4 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onBack} className="p-1.5 border border-slate-800 rounded text-slate-500 hover:text-white hover:border-slate-700 transition-all shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="font-tactical text-base font-black text-cyan-400 tracking-wider uppercase">{title}</h2>
      </div>
      {children}
    </div>
  );
}
