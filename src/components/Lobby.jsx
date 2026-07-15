import React, { useState } from 'react';
import { FACTIONS } from '../utils/boardGraph';
import { Users, Wifi, Copy, Check, ArrowLeft, Loader2, Share2 } from 'lucide-react';

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

  const doJoin = async () => {
    if (!code.trim()) { setLocalError('Escribe el código de la partida.'); return; }
    setBusy(true); setLocalError(null);
    try {
      await mp.joinGame(code, name || 'Invitado');
      setView('waiting');
    } catch (e) {
      setLocalError(e.message);
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

  const shareLink = async () => {
    if (!inviteLink) return;
    const shareData = {
      title: 'BattleChis',
      text: `¡Únete a mi partida de BattleChis! Código: ${game.code}`,
      url: inviteLink,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard?.writeText(inviteLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* user cancelled share — ignore */
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
              <Share2 className="w-4 h-4" /> Compartir enlace
            </button>
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
            onClick={doJoin}
            disabled={busy}
            className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20 py-3 text-sm font-bold mt-1 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            {busy ? 'Conectando…' : 'Unirse'}
          </button>
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
    <div className="w-full max-w-md border border-cyan-500/20 rounded bg-[#101424]/95 backdrop-blur-md p-6 shadow-[0_0_50px_rgba(0,240,255,0.15)] animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="p-1.5 border border-slate-800 rounded text-slate-500 hover:text-white hover:border-slate-700 transition-all">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="font-tactical text-lg font-black text-cyan-400 tracking-wider uppercase">{title}</h2>
      </div>
      {children}
    </div>
  );
}
