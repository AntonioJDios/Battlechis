import React, { useState, useEffect } from 'react';
import { FACTIONS } from '../utils/boardGraph';
import { Users, Wifi, Copy, Check, ArrowLeft, Loader2, Share2, Trash2, RotateCcw, FolderOpen } from 'lucide-react';

/**
 * Online lobby: create a game (configuring the 5 seats) or join by code,
 * then a waiting room that shows the invite code and who has joined.
 *
 * Transport comes from useMultiplayer (passed in via props). This component
 * is pure UI + orchestration; it doesn't know the game rules.
 */
export default function Lobby({ mp, seatsConfig, initialJoinCode = '', onSeatsChange, onBack, onLaunch }) {
  const [view, setView] = useState(initialJoinCode ? 'join' : 'choose'); // choose | create | join | waiting
  const [code, setCode] = useState(initialJoinCode);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [foundGame, setFoundGame] = useState(null); // game row looked up by code
  const [myGames, setMyGames] = useState(null); // in-progress games list (null = not loaded)
  const linkRef = React.useRef(null);

  // Load this device's unfinished games.
  const loadMyGames = async () => {
    setView('mygames'); setMyGames(null); setLocalError(null);
    try { setMyGames(await mp.listMyGames()); }
    catch (e) { setLocalError(e.message); setMyGames([]); }
  };

  // Resume a saved game: playing → into the game; waiting → back to its lobby room.
  const resumeGame = (g) => {
    mp.reconnect(g);
    setView(g.status === 'playing' ? 'reconnecting' : 'waiting');
  };

  const delGame = async (g) => {
    if (!window.confirm('¿Borrar esta partida? No se puede deshacer.')) return;
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
    if (autoFound.current) return;
    if (mp.available && initialJoinCode && view === 'join') {
      autoFound.current = true;
      doFind();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mp.available, initialJoinCode]);

  // Step 2: claim the chosen seat.
  const doClaim = async (seatIndex) => {
    setBusy(true); setLocalError(null);
    try {
      await mp.claimSeat(foundGame.id, seatIndex, name || 'Invitado');
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
          <div className="text-center">
            <div className="font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-1">Código de invitación</div>
            <button
              onClick={copyCode}
              className="inline-flex items-center gap-3 px-5 py-3 rounded-lg border border-cyan-500/40 bg-cyan-950/20 hover:bg-cyan-900/30 transition-all"
            >
              <span className="font-tactical text-3xl font-black text-cyan-400 tracking-[6px]">{game.code}</span>
              {copied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5 text-gray-400" />}
            </button>
            <div className="font-mono text-[9px] text-gray-500 mt-2">Compártelo con tus amigos para que se unan</div>
            <button
              onClick={shareLink}
              className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20 py-2 px-4 text-xs font-bold mt-3 inline-flex items-center gap-2"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Share2 className="w-4 h-4" />}
              {copied ? '¡Copiado!' : 'Compartir enlace'}
            </button>
            {/* Always-visible, selectable link (works even on insecure http LAN, where clipboard is blocked) */}
            <input
              ref={linkRef}
              readOnly
              value={inviteLink}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.target.select()}
              className="w-full mt-2 bg-[#0a0d16] border border-slate-800 rounded px-2 py-1.5 font-mono text-[10px] text-cyan-300 text-center focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="border-t border-slate-800 pt-3">
            <div className="font-tactical text-[10px] text-gray-400 uppercase tracking-wider mb-2">Comandantes</div>
            <div className="flex flex-col gap-2">
              {seats.map((s, i) => (
                <div key={i} className="flex items-center gap-3 bg-[#0d101a] border border-slate-900 rounded p-2">
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: FACTIONS[s.faction]?.neon, flexShrink: 0 }} />
                  <span className="font-tactical text-[11px] text-white flex-1 truncate">{s.name}</span>
                  <span className={`font-mono text-[9px] px-2 py-0.5 rounded ${
                    s.type === 'bot' ? 'text-amber-400 bg-amber-950/30'
                    : s.userId ? 'text-green-400 bg-green-950/30' : 'text-gray-500 bg-slate-900'
                  }`}>
                    {s.type === 'bot' ? '🤖 IA' : s.userId ? '👤 Conectado' : '⏳ Libre'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {isHost ? (
            <button
              onClick={() => onLaunch(game)}
              className="btn-tactical border-green-400 text-green-400 bg-green-950/20 hover:bg-green-500/20 py-3 text-sm font-black tracking-widest"
            >
              ▶ EMPEZAR PARTIDA
            </button>
          ) : (
            <div className="text-center font-mono text-[11px] text-cyan-400 animate-pulse py-2">
              Esperando a que el anfitrión empiece la partida…
            </div>
          )}
          {err && <p className="font-mono text-[10px] text-red-400 text-center">{err}</p>}
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
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre (opcional)"
            className="bg-[#121625] border border-slate-800 text-gray-300 font-mono text-sm p-2 rounded focus:outline-none focus:border-cyan-500 mb-1"
          />
          <p className="font-mono text-[10px] text-gray-500 mb-1">Selecciona el puesto que vas a controlar:</p>
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
                      <span className={`font-mono text-[8px] px-1.5 py-0.5 rounded ${g.status === 'playing' ? 'text-green-400 bg-green-950/40' : 'text-amber-400 bg-amber-950/40'}`}>
                        {g.status === 'playing' ? 'EN JUEGO' : 'EN ESPERA'}
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
                  <button
                    onClick={() => delGame(g)}
                    title="Borrar partida"
                    className="p-2 border border-red-500/40 rounded text-red-400 hover:bg-red-900/30 transition-all shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
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

function Shell({ title, children, onBack }) {
  return (
    <div
      className="w-full max-w-md border border-cyan-500/20 rounded bg-[#101424]/95 backdrop-blur-md p-4 shadow-[0_0_50px_rgba(0,240,255,0.15)] animate-fade-in"
      style={{ maxHeight: 'calc(100vh - 20px)', overflowY: 'auto' }}
    >
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
