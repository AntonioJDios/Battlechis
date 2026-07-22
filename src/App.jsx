import React, { useState, useEffect } from 'react';
import { useGameState } from './hooks/useGameState';
import { useMultiplayer } from './hooks/useMultiplayer';
import Board from './components/Board';
import PlayerCards from './components/PlayerCards';
import ControlPanel from './components/ControlPanel';
import GameControls from './components/GameControls';
import CombatModal from './components/CombatModal';
import ConquestModal from './components/ConquestModal';
import SurpriseModal from './components/SurpriseModal';
import SiegeModal from './components/SiegeModal';
import NegotiationModal from './components/NegotiationModal';
import FortifyModal from './components/FortifyModal';
import BombModal from './components/BombModal';
import HandPanel from './components/HandPanel';
import DefenseModal from './components/DefenseModal';
import Lobby from './components/Lobby';
import { SoundManager } from './components/SoundManager';
import { FACTIONS } from './utils/boardGraph';
import { Shield, Settings, Play, ShieldAlert, RotateCcw, Volume2, VolumeX, ListCollapse, Wifi } from 'lucide-react';

// Canonical JSON (sorted keys) so state coming back from Postgres JSONB — which
// does NOT preserve key order — compares equal to our locally-built snapshot.
// Used to detect and ignore our own echoed updates (prevents sync loops).
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => k !== 'seats').sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export default function App() {
  // Online multiplayer transport (declared first so useGameState can receive
  // the online authority config).
  const mp = useMultiplayer();
  const [onlineActive, setOnlineActive] = useState(false);
  const iAmHost = !!(mp.game && mp.userId === mp.game.host_id);
  const onlineConfig = onlineActive ? { isOnline: true, isHost: iAmHost } : null;

  const {
    graph,
    players,
    currentTurn,
    phase,
    boardState,
    diceRoll,
    sixCount,
    recruitmentTroops,
    selectedNode,
    highlightedNodes,
    logs,
    gameStarted,
    combatState,
    conquestState,
    surpriseState,
    siegeState,
    negotiationState,
    bombState,
    defenseState,
    hands,
    winner,
    shieldPurchasedThisTurn,
    brutalCards,
    startGame,
    rollMovement,
    handleNodeClick,
    reinforceNode,
    placeShield,
    skipFortify,
    getTotalTroops,
    endTurn,
    executeConquestRoll,
    executeCombatRound,
    executeSurpriseDraw,
    executeSiegeRoll,
    executeBomb,
    playCard,
    respondNegotiation,
    resolveNegotiation,
    respondDefense,
    resolveDefense,
    retreatCombat,
    retreatDefender,
    proposeAlliance,
    breakAlliance,
    areAllied,
    alliances,
    nucleoData,
    addLog,
    getSnapshot,
    hydrate,
  } = useGameState(onlineConfig);

  // ── Online turn authority ──
  const seats = mp.game?.state?.seats ?? null;
  const myFactions = seats
    ? seats.filter((s) => s.userId === mp.userId).map((s) => s.faction)
    : [];
  const activeFaction = players[currentTurn]?.faction;
  const isMyTurn = !onlineActive || myFactions.includes(activeFaction);
  // This device may write to the shared state when it's my human turn, or when
  // I'm the host and it's a bot's turn.
  const authoritative = !onlineActive
    ? true
    : (myFactions.includes(activeFaction) || (iAmHost && players[currentTurn]?.isBot));

  const lastSyncedRef = React.useRef(null);

  // ── Road-crossing negotiation (defender modal / attacker resolution) ──
  const negDefender = negotiationState
    ? players.find((p) => p.faction === negotiationState.defenderFaction)
    : null;
  // Show the decision modal to a HUMAN defender: online → only if it's my seat;
  // local → any human defender on this device.
  const showNegotiationModal = Boolean(
    negotiationState && !negotiationState.response && negDefender && !negDefender.isBot &&
    (onlineActive ? myFactions.includes(negotiationState.defenderFaction) : true)
  );
  // The attacker (and spectators) wait while a negotiation is pending.
  const negotiationWaiting = Boolean(negotiationState && !showNegotiationModal);

  // Resolve the negotiation on the attacker-authoritative client: when the
  // defender has answered, or (online only) when the countdown expires → block.
  useEffect(() => {
    if (!negotiationState) return;
    if (onlineActive && !authoritative) return; // only the attacker side resolves online
    if (negotiationState.response) { resolveNegotiation(); return; }
    if (negotiationState.deadline) {
      const ms = negotiationState.deadline - Date.now();
      if (ms <= 0) { resolveNegotiation(); return; }
      const t = setTimeout(() => resolveNegotiation(), ms + 150);
      return () => clearTimeout(t);
    }
  }, [negotiationState, authoritative, onlineActive, resolveNegotiation]);

  // ── Reactive SUPER DEFENSE ──
  const defDefender = defenseState
    ? players.find((p) => p.faction === defenseState.defenderFaction)
    : null;
  // Show the defense prompt to a HUMAN defender (online: only my seat; local: any human).
  const showDefenseModal = Boolean(
    defenseState && !defenseState.response && defDefender && !defDefender.isBot &&
    (onlineActive ? myFactions.includes(defenseState.defenderFaction) : true)
  );
  const defenseWaiting = Boolean(defenseState && !showDefenseModal);

  // Resolve the defense on the attacker-authoritative client (or on timeout → skip).
  useEffect(() => {
    if (!defenseState) return;
    if (onlineActive && !authoritative) return;
    if (defenseState.response) { resolveDefense(); return; }
    if (defenseState.deadline) {
      const ms = defenseState.deadline - Date.now();
      if (ms <= 0) { resolveDefense(); return; }
      const t = setTimeout(() => resolveDefense(), ms + 150);
      return () => clearTimeout(t);
    }
  }, [defenseState, authoritative, onlineActive, resolveDefense]);

  // Setup lobby state
  const [playerCount, setPlayerCount] = useState(5);
  const [setupPlayers, setSetupPlayers] = useState([
    { faction: 0, isBot: false, name: "ALPHA (Crimson)" },
    { faction: 1, isBot: true, name: "DELTA (Blue Eagle)" },
    { faction: 2, isBot: true, name: "SIGMA (Lightning)" },
    { faction: 3, isBot: true, name: "GAMMA (Viper)" },
    { faction: 4, isBot: true, name: "OMEGA (Eclipse)" }
  ]);
  const [isMuted, setIsMuted] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [troopsToMove, setTroopsToMove] = useState(1);
  const [wizardIdx, setWizardIdx] = useState(0); // setup wizard: current seat step (=== count → review)
  // Game options chosen by the creator
  const [boardSizeOpt, setBoardSizeOpt] = useState('large'); // 'large' | 'small'
  const [brutalOpt, setBrutalOpt] = useState(false); // brutal cards (bomb + instant núcleo win)
  // Landing page: show "Jugar / Instalar" first; deep-link joins skip straight in.
  const [homeScreen, setHomeScreen] = useState(true);
  const [lobbyInitialView, setLobbyInitialView] = useState('choose'); // 'choose' | 'mygames'

  // ── PWA install ──
  const [deferredPrompt, setDeferredPrompt] = useState(null); // Android/desktop Chrome
  const [showIosHelp, setShowIosHelp] = useState(false);
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
  useEffect(() => {
    const onBIP = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => setDeferredPrompt(null);
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIosHelp(true);
    }
  };
  const canShowInstall = !isStandalone && (deferredPrompt || isIOS);

  // Online multiplayer lobby visibility. If the URL carries ?join=CODE, open the
  // lobby straight into the join view with the code prefilled.
  const initialJoinCode = (() => {
    try { return new URLSearchParams(window.location.search).get('join') || ''; }
    catch { return ''; }
  })();
  const [showLobby, setShowLobby] = useState(Boolean(initialJoinCode));

  // Seats config for the lobby, derived from the setup screen (faction + human/bot).
  const seatsConfig = setupPlayers.map((p) => ({
    faction: p.faction,
    type: p.isBot ? 'bot' : 'human',
    name: p.name,
  }));

  // Host presses "Empezar" in the waiting room → seed the board and go online.
  // Re-fetch the freshest seats first, so a just-joined player isn't missed
  // (avoids: their claim being overwritten and their seat turned into a bot).
  const handleLaunchOnline = async (game) => {
    const id = mp.game?.id ?? game?.id;
    const fresh = id ? await mp.refreshGame(id) : null;
    const gameSeats = fresh?.state?.seats ?? game?.state?.seats ?? seatsConfig;
    const launchPlayers = gameSeats.map((s) => ({
      faction: s.faction,
      // A human seat nobody claimed → play it as a bot, so the game never
      // stalls on an unmanned seat.
      isBot: s.type === 'bot' || (s.type === 'human' && !s.userId),
      name: s.name,
    }));
    setShowLobby(false);
    setOnlineActive(true);
    startGame(launchPlayers, { boardSize: boardSizeOpt, brutalCards: brutalOpt });
  };

  // ── ONLINE: receive remote state (other player acted) and hydrate ──
  useEffect(() => {
    if (!mp.available) return;
    mp.setOnRemoteState((remoteState) => {
      if (!remoteState || remoteState.gameStarted === undefined) return; // ignore lobby-only state
      const key = stableStringify(remoteState);
      if (key === lastSyncedRef.current) return; // our own echo (poll/realtime) — don't re-hydrate
      lastSyncedRef.current = key;
      if (remoteState.gameStarted) setOnlineActive(true);
      hydrate(remoteState);
    });
  }, [mp.available, mp.setOnRemoteState, hydrate]);

  // ── ONLINE: push ANY local state change to the shared row ──
  // NOTE: we must NOT gate this on "is it still my turn", because the change
  // that ENDS my turn (endTurn → currentTurn now points at the opponent) must
  // still be broadcast — otherwise the opponent never learns it's their turn.
  // Input is already gated elsewhere, so only the acting client's state ever
  // diverges from lastSyncedRef; hydrated remote state matches it → no echo.
  useEffect(() => {
    if (!onlineActive || !mp.game) return;
    const snap = getSnapshot();
    const key = stableStringify(snap);
    if (key === lastSyncedRef.current) return; // nothing new, or we just applied remote
    const t = setTimeout(() => {
      lastSyncedRef.current = key;
      const status = snap.phase === 'GAME_OVER' ? 'finished' : 'playing';
      mp.pushState(mp.game.id, { ...snap, seats }, status);
    }, 250);
    return () => clearTimeout(t);
  }, [onlineActive, mp.game, mp.pushState, seats, getSnapshot]);

  // Guard modal/action callbacks so spectators (not their turn) can't mutate.
  const guardAuth = (fn) => (...args) => {
    if (onlineActive && !authoritative) return;
    return fn(...args);
  };

  // Reset troop selector when selection changes — default to 1 (conservative)
  useEffect(() => {
    setTroopsToMove(1);
  }, [selectedNode]);

  // RECRUIT: default to all available reinforcements; clamp as they are spent
  useEffect(() => {
    if (phase === 'RECRUIT') {
      setTroopsToMove(prev => Math.min(Math.max(prev, 1), Math.max(recruitmentTroops, 1)));
    }
  }, [phase, recruitmentTroops]);
  useEffect(() => {
    if (phase === 'RECRUIT') setTroopsToMove(Math.max(recruitmentTroops, 1));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentTurn]); // full reset only at phase/turn entry

  const selectedNodeType = selectedNode ? graph[selectedNode]?.type : null;
  const isBase = selectedNodeType === 'hq' || selectedNodeType === 'neutral' || selectedNodeType === 'center';
  const maxMovable = selectedNode && boardState[selectedNode]
    ? isBase
      ? Math.max(1, boardState[selectedNode].troops - 1)  // bases: leave at least 1
      : boardState[selectedNode].troops                    // path nodes: move all
    : 1;

  const handlePlayerCountChange = (count) => {
    setPlayerCount(count);
    // Trim or expand the array
    if (count === 4) {
      setSetupPlayers(prev => prev.slice(0, 4));
    } else {
      const newPlayers = [...setupPlayers];
      while (newPlayers.length < 5) {
        const unusedFaction = [0, 1, 2, 3, 4].find(f => !newPlayers.some(p => p.faction === f));
        newPlayers.push({
          faction: unusedFaction,
          isBot: true,
          name: FACTIONS[unusedFaction].name
        });
      }
      setSetupPlayers(newPlayers);
    }
    SoundManager.playClick();
  };

  const handleSetupPlayerChange = (index, field, value) => {
    const updated = [...setupPlayers];
    updated[index][field] = value;
    
    if (field === 'faction') {
      updated[index].name = FACTIONS[value].commander;
    }
    setSetupPlayers(updated);
    SoundManager.playClick();
  };

  const handleStartGame = () => {
    // Validate no duplicate factions
    const factionsUsed = setupPlayers.map(p => p.faction);
    const hasDuplicates = new Set(factionsUsed).size !== factionsUsed.length;
    
    if (hasDuplicates) {
      alert("ERROR: Cada comandante debe liderar una facción única.");
      return;
    }

    startGame(setupPlayers, { boardSize: boardSizeOpt, brutalCards: brutalOpt });
  };

  const toggleMute = () => {
    const muted = SoundManager.toggleMute();
    setIsMuted(muted);
  };


  // Render Setup Lobby Screen
  if (!gameStarted) {
    return (
      <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: '#07090f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px', zIndex: 10 }}>
        <div className="w-full max-w-lg mx-auto border border-cyan-500/20 rounded bg-[#101424]/90 backdrop-blur-md p-3 sm:p-4 shadow-[0_0_50px_rgba(0,240,255,0.15)] relative overflow-hidden animate-fade-in">

          {/* Top corner design markers */}
          <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-cyan-400"></div>
          <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-cyan-400"></div>
          <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-cyan-400"></div>
          <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-cyan-400"></div>

          {/* iOS install instructions */}
          {showIosHelp && (
            <div className="fixed inset-0 z-[800] flex items-center justify-center p-4 bg-black/85" onClick={() => setShowIosHelp(false)}>
              <div className="max-w-xs bg-[#101424] border border-cyan-500/40 rounded-lg p-4 text-center" onClick={(e) => e.stopPropagation()}>
                <div className="text-3xl mb-2">📲</div>
                <p className="font-tactical text-sm text-white font-bold mb-2">Instalar en iPhone / iPad</p>
                <p className="font-mono text-[11px] text-gray-300 leading-relaxed text-left">
                  ⚠️ Tiene que ser con <strong>Safari</strong> (Chrome no puede instalar en iPhone).<br/><br/>
                  1. Abre <strong>battlechis.vercel.app</strong> en <strong>Safari</strong>.<br/>
                  2. Pulsa el botón <strong>Compartir</strong> <span className="text-cyan-400">⎋</span> (el cuadrado con la flecha ↑, abajo).<br/>
                  3. Baja y elige <strong>"Añadir a pantalla de inicio"</strong>.<br/>
                  4. Pulsa <strong>Añadir</strong>.
                </p>
                <button onClick={() => setShowIosHelp(false)} className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 py-2 px-6 text-xs mt-3">Entendido</button>
              </div>
            </div>
          )}

          {homeScreen ? (
            /* ── PORTADA: Jugar / Instalar ── */
            <div className="text-center py-3 animate-fade-in">
              <h1 className="font-tactical text-3xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 tracking-widest uppercase drop-shadow-[0_0_12px_rgba(0,240,255,0.4)]">
                BATTLECHIS
              </h1>
              <p className="font-tactical text-[9px] sm:text-xs text-cyan-400/70 tracking-[4px] uppercase font-bold mt-1 mb-6">
                Risk + Parchís táctico
              </p>
              <div className="flex flex-col gap-3 max-w-xs mx-auto">
                <button
                  onClick={() => setHomeScreen(false)}
                  className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/30 font-black tracking-widest text-base py-3 hover:shadow-[0_0_20px_rgba(0,240,255,0.4)]"
                >
                  <Play className="w-5 h-5 mr-1" /> JUGAR
                </button>
                {mp.available && (
                  <button
                    onClick={() => { setLobbyInitialView('mygames'); setShowLobby(true); }}
                    className="btn-tactical border-slate-500 text-slate-300 bg-slate-800/30 font-bold tracking-widest text-sm py-2.5 hover:bg-slate-700/40"
                  >
                    📂 MIS PARTIDAS
                  </button>
                )}
                {mp.available && mp.pushSupported && (
                  <button
                    onClick={async () => {
                      const r = await mp.enablePush();
                      alert(r.ok ? '🔔 Avisos activados: te notificaremos cuando sea tu turno o te ataquen, aunque tengas la app cerrada.' : `No se pudieron activar: ${r.msg}`);
                    }}
                    className="btn-tactical border-amber-500/60 text-amber-300 bg-amber-950/20 font-bold tracking-widest text-sm py-2.5 hover:bg-amber-900/30"
                  >
                    🔔 ACTIVAR AVISOS
                  </button>
                )}
                {canShowInstall ? (
                  <button
                    onClick={handleInstall}
                    className="btn-tactical border-green-400 text-green-400 bg-green-950/20 font-black tracking-widest text-base py-3 hover:shadow-[0_0_20px_rgba(0,230,118,0.4)]"
                  >
                    📲 INSTALAR APP
                  </button>
                ) : (
                  <p className="font-mono text-[9px] text-gray-600">
                    {isStandalone ? '✓ App instalada' : 'La app ya está instalada o tu navegador no permite instalarla aquí.'}
                  </p>
                )}
              </div>
            </div>
          ) : (() => {
            const total = setupPlayers.length;
            const step = Math.min(wizardIdx, total);          // clamp if count shrank
            const onReview = step >= total;
            const player = setupPlayers[step];

            return (
              <>
                {/* Header: title + count toggle */}
                <div className="flex items-center justify-between gap-3 mb-3 border-b border-slate-800 pb-2">
                  <div>
                    <h1 className="font-tactical text-lg sm:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 tracking-widest uppercase leading-none drop-shadow-[0_0_10px_rgba(0,240,255,0.4)]">
                      BATTLECHIS
                    </h1>
                    <p className="font-tactical text-[8px] sm:text-[10px] text-cyan-400/70 tracking-[3px] uppercase font-bold mt-0.5">
                      RISK + PARCHÍS TÁCTICO
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {[4, 5].map(count => (
                      <button
                        key={count}
                        onClick={() => { handlePlayerCountChange(count); setWizardIdx(0); }}
                        className={`px-3 py-1.5 font-tactical text-xs border font-bold transition-all ${
                          playerCount === count
                            ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                            : 'border-slate-800 text-gray-500 hover:border-slate-700 hover:text-white'
                        }`}
                        style={{ clipPath: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)' }}
                      >
                        {count} Jug.
                      </button>
                    ))}
                  </div>
                </div>

                {/* Progress dots */}
                <div className="flex items-center justify-center gap-1.5 mb-3">
                  {setupPlayers.map((_, i) => (
                    <div key={i}
                      className="rounded-full transition-all"
                      style={{
                        width: i === step ? 22 : 8, height: 8,
                        background: i < step || onReview ? '#00e676' : i === step ? '#00f0ff' : 'rgba(255,255,255,0.15)',
                      }}
                    />
                  ))}
                </div>

                {!onReview ? (
                  /* ── One seat at a time ── */
                  <div className="animate-fade-in">
                    <div className="text-center mb-3">
                      <div className="font-tactical text-sm text-white font-bold uppercase tracking-wider">
                        Puesto {step + 1} <span className="text-gray-600">/ {total}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 max-w-md mx-auto">
                      <select
                        value={player.faction}
                        onChange={(e) => handleSetupPlayerChange(step, 'faction', parseInt(e.target.value))}
                        className="w-full bg-[#121625] border border-slate-800 text-gray-200 font-mono text-sm p-2.5 rounded focus:outline-none focus:border-cyan-500"
                      >
                        {FACTIONS.map(f => (
                          <option key={f.id} value={f.id}
                            disabled={setupPlayers.some((p, pIdx) => p.faction === f.id && pIdx !== step)}>
                            {f.name}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        placeholder="Nombre del comandante"
                        value={player.name}
                        onChange={(e) => handleSetupPlayerChange(step, 'name', e.target.value)}
                        className="w-full bg-[#121625] border border-slate-800 text-gray-200 font-mono text-sm p-2.5 rounded focus:outline-none focus:border-cyan-500"
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSetupPlayerChange(step, 'isBot', false)}
                          className={`flex-1 py-3 rounded font-tactical text-sm font-black border-2 transition-all ${
                            !player.isBot
                              ? 'border-green-400 bg-green-500 text-[#04110a] shadow-[0_0_16px_rgba(0,230,118,0.5)]'
                              : 'border-slate-700 bg-transparent text-slate-500 hover:text-slate-300'
                          }`}
                        >{!player.isBot ? '✓ ' : ''}👤 HUMANO</button>
                        <button
                          onClick={() => handleSetupPlayerChange(step, 'isBot', true)}
                          className={`flex-1 py-3 rounded font-tactical text-sm font-black border-2 transition-all ${
                            player.isBot
                              ? 'border-amber-400 bg-amber-500 text-[#1a1204] shadow-[0_0_16px_rgba(245,158,11,0.5)]'
                              : 'border-slate-700 bg-transparent text-slate-500 hover:text-slate-300'
                          }`}
                        >{player.isBot ? '✓ ' : ''}🤖 IA</button>
                      </div>
                    </div>

                    {/* Nav */}
                    <div className="flex justify-between items-center gap-3 mt-4 max-w-md mx-auto">
                      <button
                        onClick={() => { if (step === 0) setHomeScreen(true); else setWizardIdx(step - 1); }}
                        className="btn-tactical border-slate-700 text-slate-400 py-2 px-5 text-xs"
                      >◀ {step === 0 ? 'Inicio' : 'Anterior'}</button>
                      <button
                        onClick={() => setWizardIdx(step + 1)}
                        className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 py-2 px-6 text-xs font-bold"
                      >{step === total - 1 ? 'Revisar ▶' : 'Siguiente ▶'}</button>
                    </div>
                  </div>
                ) : (
                  /* ── Review + launch ── */
                  <div className="animate-fade-in max-w-md mx-auto">
                    <div className="flex flex-col gap-1.5 mb-3">
                      {setupPlayers.map((p, i) => (
                        <button key={i} onClick={() => setWizardIdx(i)}
                          className="flex items-center gap-2 bg-[#0d101a] border border-slate-900 rounded px-2 py-1.5 hover:border-slate-700 transition-all text-left">
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: FACTIONS[p.faction]?.neon, flexShrink: 0 }} />
                          <span className="font-tactical text-[11px] text-white flex-1 truncate">{p.name}</span>
                          <span className={`font-mono text-[9px] px-2 py-0.5 rounded ${p.isBot ? 'text-amber-400 bg-amber-950/30' : 'text-green-400 bg-green-950/30'}`}>
                            {p.isBot ? '🤖 IA' : '👤 Humano'}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Game options: board size + brutal cards */}
                    <div className="flex flex-col gap-2 mb-2 border-t border-slate-800 pt-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[9px] text-gray-500 uppercase tracking-wider w-16 shrink-0">Tablero</span>
                        {[['large', 'Grande'], ['small', 'Pequeño ⚡']].map(([val, lbl]) => (
                          <button key={val} onClick={() => setBoardSizeOpt(val)}
                            className={`flex-1 py-1.5 rounded font-tactical text-[10px] font-bold border transition-all ${
                              boardSizeOpt === val ? 'border-cyan-400 text-cyan-400 bg-cyan-950/30' : 'border-slate-800 text-gray-500'
                            }`}>{lbl}</button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[9px] text-gray-500 uppercase tracking-wider w-16 shrink-0">Cartas</span>
                        {[[false, 'Normales'], [true, 'Brutales 💣👑']].map(([val, lbl]) => (
                          <button key={String(val)} onClick={() => setBrutalOpt(val)}
                            className={`flex-1 py-1.5 rounded font-tactical text-[10px] font-bold border transition-all ${
                              brutalOpt === val ? 'border-red-400 text-red-400 bg-red-950/30' : 'border-slate-800 text-gray-500'
                            }`}>{lbl}</button>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={handleStartGame}
                        style={{ flex: 1 }}
                        className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/30 font-black tracking-wider text-sm py-2.5 px-3 hover:shadow-[0_0_20px_rgba(0,240,255,0.4)]"
                      ><Play className="w-4 h-4 mr-1" /> LOCAL</button>
                      <button
                        onClick={() => setShowLobby(true)}
                        style={{ flex: 1 }}
                        className="btn-tactical border-green-400 text-green-400 bg-green-950/20 font-black tracking-wider text-sm py-2.5 px-3 hover:shadow-[0_0_20px_rgba(0,230,118,0.4)]"
                      ><Wifi className="w-4 h-4 mr-1" /> ONLINE</button>
                    </div>
                    <button
                      onClick={() => setWizardIdx(total - 1)}
                      className="btn-tactical border-slate-700 text-slate-400 py-2 px-5 text-xs mt-2 w-full"
                    >◀ Volver a editar</button>
                  </div>
                )}
              </>
            );
          })()}

        </div>

        {/* Online lobby overlay */}
        {showLobby && (
          <div className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <Lobby
              mp={mp}
              seatsConfig={seatsConfig}
              initialJoinCode={initialJoinCode}
              initialView={lobbyInitialView}
              onSeatsChange={() => {}}
              onBack={() => { mp.leaveGame(); setShowLobby(false); setLobbyInitialView('choose'); }}
              onLaunch={handleLaunchOnline}
            />
          </div>
        )}
      </div>
    );
  }

  // Calculate controlled bases helper
  const getBasesCount = (faction) => {
    let count = 0;
    Object.keys(boardState).forEach(nodeId => {
      const node = graph[nodeId];
      const state = boardState[nodeId];
      if (state && state.occupyingFaction === faction && (node.type === 'hq' || node.type === 'neutral' || node.type === 'center')) {
        count++;
      }
    });
    return count;
  };

  // Step-by-step game start instructions HUD
  const getTutorialBanner = () => {
    const currentPlayer = players[currentTurn];
    if (!currentPlayer) return null;

    if (phase === 'RECRUIT') {
      return (
        <div className="tutorial-banner w-full bg-red-950/20 border border-red-500/30 px-3 py-2 rounded text-red-400 font-mono text-[10px] sm:text-xs flex items-center gap-2 animate-pulse shrink-0">
          <span className="text-base">🚨</span>
          <span><strong>PASO 1: REFUERZOS</strong> — Te quedan <strong>+{recruitmentTroops} tropas</strong>. Ajusta la cantidad en el panel derecho y haz clic en una <strong>base parpadeante</strong>. Puedes repartirlas entre varias bases.</span>
        </div>
      );
    }
    if (phase === 'MOVE') {
      if (diceRoll === null) {
        return (
          <div className="tutorial-banner w-full bg-cyan-950/20 border border-cyan-500/30 px-3 py-2 rounded text-cyan-400 font-mono text-[10px] sm:text-xs flex items-center gap-2 shrink-0 animate-pulse">
            <span className="text-base">🎲</span>
            <span><strong>PASO 2: DADO TÁCTICO</strong> — Pulsa <strong>"🎲 LANZAR DADO"</strong> en el panel derecho.</span>
          </div>
        );
      }
      if (!selectedNode) {
        return (
          <div className="tutorial-banner w-full bg-amber-950/20 border border-amber-500/30 px-3 py-2 rounded text-amber-400 font-mono text-[10px] sm:text-xs flex items-center gap-2 shrink-0 animate-pulse">
            <span className="text-base">👉</span>
            <span><strong>PASO 3:</strong> Haz click en tu HQ o base con más de 1 tropa.</span>
          </div>
        );
      }
      return (
        <div className="tutorial-banner w-full bg-green-950/20 border border-green-500/30 px-3 py-2 rounded text-green-400 font-mono text-[10px] sm:text-xs flex items-center gap-2 shrink-0">
          <span className="text-base">🚀</span>
          <span><strong>PASO 4:</strong> Ajusta las tropas con <strong>− +</strong> y haz click en un destino parpadeante.</span>
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className="grid-lines text-gray-300"
      style={{ width: '100vw', height: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr', background: '#07090f', overflow: 'hidden' }}
    >
      {/* Top Navigation HUD Bar */}
      <header className="game-header h-14 border-b border-slate-900 bg-[#0e111c]/90 flex items-center justify-between px-4 relative z-10">
        
        {/* Logo / Status */}
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="font-tactical text-sm font-bold text-white uppercase tracking-wider leading-none">
              BATTLECHIS
            </h2>
            <span className="header-subtitle text-[9px] text-cyan-400 font-mono tracking-widest uppercase">
              Operativo de Campaña
            </span>
          </div>
        </div>

        {/* NÚCLEO domination alert */}
        {nucleoData.turns > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(0,230,118,0.4)', background: 'rgba(0,230,118,0.08)' }}>
            <span style={{ fontSize: 12 }}>👑</span>
            {[1,2,3].map(i => (
              <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: i <= nucleoData.turns ? '#00e676' : 'rgba(255,255,255,0.15)', boxShadow: i <= nucleoData.turns ? '0 0 6px #00e676' : 'none' }} />
            ))}
            <span className="font-tactical text-[9px] text-green-400">{nucleoData.turns}/3</span>
          </div>
        )}

        {/* Turn indicator HUD banner */}
        <div className="flex items-center gap-3 px-4 py-1.5 rounded-full border border-slate-800 bg-[#07090f]/75">
          <div 
            className="w-3 h-3 rounded-full animate-pulse"
            style={{ backgroundColor: FACTIONS[players[currentTurn]?.faction].neon }}
          ></div>
          <span className="font-tactical text-xs text-white uppercase font-bold tracking-wider">
            TURNO DE: {players[currentTurn]?.name}
          </span>
          <span className="font-mono text-[9px] text-gray-500 bg-slate-950 px-2 py-0.5 border border-slate-900 rounded">
            FASE {phase}
          </span>
        </div>

        {/* Utility panel */}
        <div className="flex items-center gap-3">
          {/* Roster toggle */}
          <button
            onClick={() => setShowRoster(v => !v)}
            className={`p-2 border rounded transition-all text-xs font-tactical font-bold ${showRoster ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20' : 'border-slate-800 text-slate-500 hover:text-white hover:border-slate-700'}`}
            title="Estado de mandos"
          >
            👥
          </button>

          {/* Log toggle button */}
          <button
            onClick={() => setShowLog(v => !v)}
            className={`p-2 border rounded transition-all text-xs font-tactical font-bold ${showLog ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20' : 'border-slate-800 text-slate-500 hover:text-white hover:border-slate-700'}`}
            title="Log táctico"
          >
            📋
          </button>

          {/* Mute button */}
          <button
            onClick={toggleMute}
            className="p-2 border border-slate-800 rounded text-slate-500 hover:text-white hover:border-slate-700 transition-all"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-500" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>
          
          {/* Reset button */}
          <button
            onClick={() => {
              if (window.confirm("¿Seguro que deseas abortar esta misión y volver al menú principal?")) {
                window.location.reload();
              }
            }}
            className="p-2 border border-slate-800 rounded text-slate-500 hover:text-red-400 hover:border-red-950 transition-all"
            title="Reiniciar partida"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

      </header>

      {/* Main Workspace Frame — 2nd grid row fills all remaining height */}
      <main
        className="game-main overflow-hidden"
        style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', padding: '8px', minHeight: 0 }}
      >

        {/* Left / Center Work Area (Board only) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0, overflow: 'hidden' }}>

          {/* Online: spectator banner when it's not your turn */}
          {onlineActive && !isMyTurn && (
            <div className="w-full bg-slate-800/40 border border-slate-600/40 px-3 py-2 rounded text-slate-300 font-mono text-[10px] sm:text-xs flex items-center gap-2 shrink-0 animate-pulse">
              <span className="text-base">⏳</span>
              <span>Turno de <strong style={{ color: FACTIONS[activeFaction]?.neon }}>{players[currentTurn]?.name}</strong> — esperando su jugada…</span>
            </div>
          )}

          {/* Tutorial step box (only on your turn) */}
          {isMyTurn && getTutorialBanner()}

          {/* Symmetrical Star Battlefield Map — fills all remaining space */}
          <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <Board
              graph={graph}
              boardState={boardState}
              currentTurn={currentTurn}
              phase={phase}
              selectedNode={selectedNode}
              highlightedNodes={highlightedNodes}
              onNodeClick={(nodeId) => {
                if (!isMyTurn) return;
                handleNodeClick(nodeId, troopsToMove);
              }}
              players={players}
            />
          </div>

        </div>


      </main>

      {/* Your secret hand (only shown to you) */}
      {gameStarted && phase !== 'GAME_OVER' && isMyTurn && (
        <HandPanel
          hand={hands[players[currentTurn]?.faction]}
          players={players}
          currentTurn={currentTurn}
          onPlay={guardAuth(playCard)}
          canPlay={phase === 'MOVE' && !combatState && !conquestState && !surpriseState && !siegeState && !negotiationState && !bombState && !defenseState}
        />
      )}

      {/* Floating game controls — only for the player whose turn it is */}
      {gameStarted && phase !== 'GAME_OVER' && !combatState && !conquestState && !surpriseState && !siegeState && !negotiationState && !bombState && !defenseState && isMyTurn && (
        <GameControls
          phase={phase}
          currentTurn={currentTurn}
          players={players}
          diceRoll={diceRoll}
          sixCount={sixCount}
          recruitmentTroops={recruitmentTroops}
          rollMovement={rollMovement}
          endTurn={endTurn}
          selectedNode={selectedNode}
          highlightedNodes={highlightedNodes}
          onReinforce={reinforceNode}
          troopsToMove={troopsToMove}
          onTroopsChange={setTroopsToMove}
          maxMovable={maxMovable}
          isBase={isBase}
          boardState={boardState}
        />
      )}

      {/* FORTIFY step: buy a shield after reinforcing, before rolling (own turn only) */}
      {gameStarted && phase === 'FORTIFY' && isMyTurn && !combatState && !conquestState && !surpriseState && !siegeState && !negotiationState && (
        <FortifyModal
          boardState={boardState}
          graph={graph}
          players={players}
          currentTurn={currentTurn}
          onFortify={guardAuth(placeShield)}
          onSkip={guardAuth(skipFortify)}
        />
      )}

      {/* Modals & Overlays */}
      <CombatModal
        combatState={combatState}
        onRollRound={guardAuth(executeCombatRound)}
        onRetreat={guardAuth(retreatCombat)}
        onRetreatDefender={guardAuth(retreatDefender)}
        players={players}
      />

      <ConquestModal
        conquestState={conquestState}
        onRoll={guardAuth(executeConquestRoll)}
        players={players}
        currentTurn={currentTurn}
        graph={graph}
      />

      <SurpriseModal
        surpriseState={surpriseState}
        onDraw={guardAuth(executeSurpriseDraw)}
        players={players}
        currentTurn={currentTurn}
        graph={graph}
        brutalCards={brutalCards}
      />

      <BombModal
        bombState={bombState}
        boardState={boardState}
        graph={graph}
        players={players}
        currentTurn={currentTurn}
        onBomb={guardAuth(executeBomb)}
      />

      <SiegeModal
        siegeState={siegeState}
        onRoll={guardAuth(executeSiegeRoll)}
        players={players}
        currentTurn={currentTurn}
        graph={graph}
      />

      {/* Negotiation: modal for the (human) defender; waiting overlay for everyone else */}
      {showNegotiationModal && (
        <NegotiationModal
          negotiationState={negotiationState}
          onRespond={respondNegotiation}
          players={players}
          graph={graph}
        />
      )}
      {negotiationWaiting && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 510, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div className="animate-fade-in" style={{ pointerEvents: 'all', background: '#0f121d', border: '1px solid rgba(0,240,255,0.3)', borderRadius: 8, padding: '16px 22px', boxShadow: '0 8px 32px rgba(0,0,0,0.7)' }}>
            <p className="font-mono text-[12px] text-cyan-400 animate-pulse text-center">⏳ Esperando respuesta del enemigo…</p>
          </div>
        </div>
      )}

      {/* Reactive super-defense: prompt for the defender, waiting overlay for the rest */}
      {showDefenseModal && (
        <DefenseModal
          defenseState={defenseState}
          onRespond={respondDefense}
          players={players}
          graph={graph}
        />
      )}
      {defenseWaiting && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 510, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div className="animate-fade-in" style={{ pointerEvents: 'all', background: '#0f121d', border: '1px solid rgba(0,230,118,0.3)', borderRadius: 8, padding: '16px 22px', boxShadow: '0 8px 32px rgba(0,0,0,0.7)' }}>
            <p className="font-mono text-[12px] text-green-400 animate-pulse text-center">🛡️ El defensor decide si usa Super Defensa…</p>
          </div>
        </div>
      )}

      {/* Floating Roster Panel */}
      {showRoster && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 490, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div
            className="tactical-panel animate-fade-in"
            style={{ pointerEvents: 'all', width: 'min(400px, 96vw)', maxHeight: 'calc(100vh - 60px)', overflowY: 'auto', background: '#0d101a', borderColor: 'rgba(100,120,180,0.4)', borderRadius: '10px', boxShadow: '0 0 40px rgba(0,0,0,0.8)' }}
          >
            <div className="panel-header bg-[#151a30] flex items-center justify-between">
              <span>⚔️ ESTADO DE MANDOS</span>
              <button onClick={() => setShowRoster(false)} className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none px-1">✕</button>
            </div>

            {/* NÚCLEO indicator */}
            {nucleoData.turns > 0 && (
              <div style={{ margin: '8px 12px 0', padding: '6px 10px', borderRadius: 6, background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.25)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="text-base">👑</span>
                <div>
                  <span className="font-tactical text-[10px] text-green-400 font-bold">NÚCLEO CONTROLADO</span>
                  <div className="flex gap-1 mt-1">
                    {[1,2,3].map(i => (
                      <div key={i} style={{ width: 24, height: 8, borderRadius: 4, background: i <= nucleoData.turns ? '#00e676' : 'rgba(255,255,255,0.1)' }} />
                    ))}
                  </div>
                  <span className="font-mono text-[9px] text-gray-400">{nucleoData.turns}/3 turnos para victoria</span>
                </div>
              </div>
            )}

            <div className="p-3">
              <PlayerCards
                players={players}
                currentTurn={currentTurn}
                boardState={boardState}
                getBasesCount={getBasesCount}
              />
            </div>

            {/* Alliance controls — only during human turn */}
            {gameStarted && phase !== 'GAME_OVER' && !players[currentTurn]?.isBot && (
              <div style={{ padding: '0 12px 12px' }}>
                <div className="font-tactical text-[10px] text-gray-500 font-bold tracking-widest uppercase mb-2">DIPLOMACIA</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {players.filter(p => p.faction !== players[currentTurn]?.faction && !p.eliminated).map(p => {
                    const myFaction = players[currentTurn]?.faction;
                    const allied = areAllied(myFaction, p.faction);
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: allied ? 'rgba(0,230,118,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${allied ? 'rgba(0,230,118,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: FACTIONS[p.faction]?.neon, flexShrink: 0 }} />
                        <span className="font-tactical text-[10px] text-gray-300 flex-1 truncate">{p.name}</span>
                        {allied
                          ? <button onClick={() => breakAlliance(myFaction, p.faction)} style={{ fontSize: 10, padding: '2px 8px', border: '1px solid rgba(255,59,59,0.5)', borderRadius: 4, background: 'rgba(255,59,59,0.1)', color: '#f87171', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--font-tactical)', fontWeight: 700 }}>💔 Romper</button>
                          : <button onClick={() => proposeAlliance(myFaction, p.faction)} style={{ fontSize: 10, padding: '2px 8px', border: '1px solid rgba(0,230,118,0.5)', borderRadius: 4, background: 'rgba(0,230,118,0.1)', color: '#4ade80', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--font-tactical)', fontWeight: 700 }}>🤝 Aliar</button>
                        }
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Log Panel */}
      {showLog && (
        <div
          className="fixed z-[500] tactical-panel bg-[#0d101a]/95 border-slate-700 rounded-md shadow-[0_0_30px_rgba(0,0,0,0.8)] animate-fade-in"
          style={{ bottom: '16px', right: '16px', width: '340px', height: '320px', display: 'flex', flexDirection: 'column' }}
        >
          <div className="panel-header bg-[#151a30] flex items-center justify-between">
            <span>TÉRMINAL MILITAR (LOGS)</span>
            <button
              onClick={() => setShowLog(false)}
              className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none px-1"
            >✕</button>
          </div>
          <div className="p-2 font-mono text-[9px] text-gray-400 flex-1 overflow-y-auto flex flex-col-reverse gap-1 scrollbar">
            {logs.length === 0 ? (
              <span className="text-gray-600 italic">No hay transmisiones recibidas...</span>
            ) : (
              logs.map((log, idx) => (
                <div
                  key={idx}
                  className={`border-l pl-2 py-0.5 border-slate-800 ${
                    log.includes("VICTORIA") || log.includes("CONQUISTA")
                      ? 'text-green-400 border-green-500/40 bg-green-950/10'
                      : log.includes("ALERTA") || log.includes("ERROR") || log.includes("DERROTA")
                      ? 'text-red-400 border-red-500/40 bg-red-950/10'
                      : 'text-gray-300'
                  }`}
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Game Over Screen Overlay */}
      {phase === 'GAME_OVER' && (() => {
        const wColor = winner ? FACTIONS[winner.faction]?.neon : 'var(--neon-green)';
        const wRgb = winner ? FACTIONS[winner.faction]?.rgb : '0, 230, 118';
        return (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-md border rounded bg-[#101424] text-center p-8 animate-fade-in"
            style={{ borderColor: `rgba(${wRgb},0.5)`, boxShadow: `0 0 50px rgba(${wRgb},0.35)` }}>
            <div className="text-5xl mb-3">🏆</div>
            {winner ? (
              <>
                <p className="text-[10px] text-gray-500 font-mono tracking-widest uppercase mb-2">Ganador de la batalla</p>
                <div className="inline-flex items-center gap-2 mb-2">
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: wColor, boxShadow: `0 0 12px ${wColor}` }} />
                  <h2 className="font-tactical text-2xl font-black uppercase" style={{ color: wColor }}>
                    {winner.name}
                  </h2>
                </div>
                {winner.reason && (
                  <p className="text-gray-400 font-mono text-xs mb-6">{winner.reason}</p>
                )}
              </>
            ) : (
              <>
                <h2 className="font-tactical text-2xl font-black text-green-400 mb-1 uppercase">MISIÓN COMPLETADA</h2>
                <p className="text-white font-mono text-sm mb-6">La partida ha terminado.</p>
              </>
            )}

            <button
              onClick={() => window.location.reload()}
              className="btn-tactical border-green-400 text-green-400 bg-green-950/20 hover:bg-green-500/20 py-3 px-8 w-full text-sm"
              style={{ clipPath: 'polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)' }}
            >
              Iniciar Nueva Campaña
            </button>
          </div>
        </div>
        );
      })()}

    </div>
  );
}
