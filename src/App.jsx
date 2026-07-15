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
    startGame,
    rollMovement,
    handleNodeClick,
    reinforceNode,
    endTurn,
    executeConquestRoll,
    executeCombatRound,
    executeSurpriseDraw,
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
  // The push effect below then broadcasts the initial state to the other players.
  const handleLaunchOnline = (game) => {
    const gameSeats = game?.state?.seats ?? seatsConfig;
    const launchPlayers = gameSeats.map((s) => ({
      faction: s.faction,
      isBot: s.type === 'bot',
      name: s.name,
    }));
    setShowLobby(false);
    setOnlineActive(true);
    startGame(launchPlayers);
  };

  // ── ONLINE: receive remote state (other player acted) and hydrate ──
  useEffect(() => {
    if (!mp.available) return;
    mp.setOnRemoteState((remoteState) => {
      if (!remoteState || remoteState.gameStarted === undefined) return; // ignore lobby-only state
      lastSyncedRef.current = stableStringify(remoteState); // mark so we don't echo it back
      if (remoteState.gameStarted) setOnlineActive(true);
      hydrate(remoteState);
    });
  }, [mp.available, mp.setOnRemoteState, hydrate]);

  // ── ONLINE: push local state when this device is the authoritative writer ──
  useEffect(() => {
    if (!onlineActive || !mp.game || !authoritative) return;
    const snap = getSnapshot();
    const key = stableStringify(snap);
    if (key === lastSyncedRef.current) return; // nothing new, or we just applied remote
    const t = setTimeout(() => {
      lastSyncedRef.current = key;
      const status = snap.phase === 'GAME_OVER' ? 'finished' : 'playing';
      mp.pushState(mp.game.id, { ...snap, seats }, status);
    }, 250);
    return () => clearTimeout(t);
  }, [onlineActive, authoritative, mp.game, mp.pushState, seats, getSnapshot]);

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

    startGame(setupPlayers);
  };

  const toggleMute = () => {
    const muted = SoundManager.toggleMute();
    setIsMuted(muted);
  };


  // Render Setup Lobby Screen
  if (!gameStarted) {
    return (
      <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: '#07090f', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px', zIndex: 10 }}>
        <div className="w-full max-w-3xl border border-cyan-500/20 rounded bg-[#101424]/90 backdrop-blur-md p-6 sm:p-8 shadow-[0_0_50px_rgba(0,240,255,0.15)] relative overflow-hidden animate-fade-in">
          
          {/* Top corner design markers */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-cyan-400"></div>
          <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-cyan-400"></div>
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-400"></div>
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-cyan-400"></div>

          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="font-tactical text-2xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 tracking-widest uppercase mb-1 drop-shadow-[0_0_10px_rgba(0,240,255,0.4)]">
              JUEGOGONZI
            </h1>
            <p className="font-tactical text-[9px] sm:text-xs text-cyan-400/70 tracking-[4px] uppercase font-bold">
              CONSOLA TÁCTICA MULTIJUGADOR (RISK + PARCHÍS)
            </p>
          </div>

          {/* Player Count Selection */}
          <div className="mb-6 flex flex-col sm:flex-row items-center justify-between border-b border-slate-800 pb-4 gap-4">
            <div>
              <div className="font-tactical text-xs text-white font-bold mb-1">CONFIGURACIÓN DE TEATRO DE GUERRA</div>
              <div className="text-[10px] text-gray-500 font-mono">Selecciona la cantidad de comandantes desplegados.</div>
            </div>
            
            <div className="flex gap-2">
              {[4, 5].map(count => (
                <button
                  key={count}
                  onClick={() => handlePlayerCountChange(count)}
                  className={`px-6 py-2 font-tactical text-sm border font-bold transition-all ${
                    playerCount === count 
                      ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                      : 'border-slate-800 text-gray-500 hover:border-slate-700 hover:text-white'
                  }`}
                  style={{ clipPath: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)' }}
                >
                  {count} Jugadores
                </button>
              ))}
            </div>
          </div>

          {/* Player Slots Configuration */}
          <div className="space-y-4 mb-8">
            <span className="font-tactical text-[10px] text-gray-400 tracking-wider block uppercase">
              ASIGNACIÓN DE COMANDANTES
            </span>
            
            <div className="grid grid-cols-1 gap-3">
              {setupPlayers.map((player, idx) => (
                <div 
                  key={idx}
                  className="flex flex-col sm:flex-row items-center gap-3 bg-[#0d101a] border border-slate-900 rounded p-3"
                >
                  {/* Slot identifier */}
                  <div className="flex items-center gap-2 w-full sm:w-1/4">
                    <div className="w-6 h-6 rounded border border-cyan-500/20 bg-cyan-950/20 flex items-center justify-center">
                      <span className="font-mono text-xs text-cyan-400 font-black">{idx + 1}</span>
                    </div>
                    <span className="font-tactical text-xs text-white uppercase font-bold truncate">
                      PUESTO {idx + 1}
                    </span>
                  </div>

                  {/* Faction selector */}
                  <div className="w-full sm:w-1/3">
                    <select
                      value={player.faction}
                      onChange={(e) => handleSetupPlayerChange(idx, 'faction', parseInt(e.target.value))}
                      className="w-full bg-[#121625] border border-slate-800 text-gray-300 font-mono text-xs p-2 rounded focus:outline-none focus:border-cyan-500"
                    >
                      {FACTIONS.map(f => (
                        <option 
                          key={f.id} 
                          value={f.id}
                          disabled={setupPlayers.some((p, pIdx) => p.faction === f.id && pIdx !== idx)}
                        >
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Commander Name Input */}
                  <div className="w-full sm:w-1/4">
                    <input
                      type="text"
                      placeholder="Nombre Comandante"
                      value={player.name}
                      onChange={(e) => handleSetupPlayerChange(idx, 'name', e.target.value)}
                      className="w-full bg-[#121625] border border-slate-800 text-gray-300 font-mono text-xs p-2 rounded focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  {/* Controller Toggle (Human vs Bot) */}
                  <div className="w-full sm:w-1/5 flex justify-end">
                    <button
                      onClick={() => handleSetupPlayerChange(idx, 'isBot', !player.isBot)}
                      className={`w-full py-1.5 px-3 rounded font-tactical text-[10px] font-bold border transition-all text-center ${
                        player.isBot 
                          ? 'border-amber-500/50 bg-amber-950/20 text-amber-500 hover:bg-amber-900/20'
                          : 'border-green-500/50 bg-green-950/20 text-green-400 hover:bg-green-900/20'
                      }`}
                    >
                      {player.isBot ? '🤖 IA TÁCTICA' : '👤 HUMANO'}
                    </button>
                  </div>

                </div>
              ))}
            </div>
          </div>

          {/* Launch Actions */}
          <div style={{ display: 'flex', flexDirection: 'row', gap: '12px', justifyContent: 'center', alignItems: 'stretch', width: '100%' }}>
            <button
              onClick={handleStartGame}
              style={{ flex: 1, maxWidth: '220px' }}
              className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/30 font-black tracking-widest text-sm sm:text-base py-3 px-4 hover:shadow-[0_0_20px_rgba(0,240,255,0.4)]"
            >
              <Play className="w-5 h-5 mr-1" />
              JUGAR LOCAL
            </button>
            <button
              onClick={() => setShowLobby(true)}
              style={{ flex: 1, maxWidth: '220px' }}
              className="btn-tactical border-green-400 text-green-400 bg-green-950/20 font-black tracking-widest text-sm sm:text-base py-3 px-4 hover:shadow-[0_0_20px_rgba(0,230,118,0.4)]"
            >
              <Wifi className="w-5 h-5 mr-1" />
              JUGAR ONLINE
            </button>
          </div>

        </div>

        {/* Online lobby overlay */}
        {showLobby && (
          <div className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <Lobby
              mp={mp}
              seatsConfig={seatsConfig}
              initialJoinCode={initialJoinCode}
              onSeatsChange={() => {}}
              onBack={() => { mp.leaveGame(); setShowLobby(false); }}
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
              JUEGOGONZI
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
              onNodeClick={(nodeId) => { if (!isMyTurn) return; handleNodeClick(nodeId, troopsToMove); }}
              players={players}
            />
          </div>

        </div>


      </main>

      {/* Floating game controls — only for the player whose turn it is */}
      {gameStarted && phase !== 'GAME_OVER' && !combatState && !conquestState && !surpriseState && isMyTurn && (
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
      />

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
      {phase === 'GAME_OVER' && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-md border border-green-500/40 rounded bg-[#101424] text-center p-8 shadow-[0_0_50px_rgba(0,230,118,0.3)] animate-fade-in">
            <ShieldAlert className="w-16 h-16 text-green-400 mx-auto mb-4 animate-bounce" />
            <h2 className="font-tactical text-2xl font-black text-green-400 mb-1 uppercase">
              MISIÓN COMPLETADA
            </h2>
            <p className="text-[10px] text-gray-500 font-mono tracking-widest uppercase mb-6">
              PARTIDA FINALIZADA
            </p>
            
            <p className="text-white font-mono text-sm mb-8 leading-relaxed">
              El teatro de operaciones ha sido pacificado. Un comandante ha asegurado el control absoluto del sector de conflicto.
            </p>

            <button
              onClick={() => window.location.reload()}
              className="btn-tactical border-green-400 text-green-400 bg-green-950/20 hover:bg-green-500/20 py-3 px-8 w-full text-sm"
              style={{ clipPath: 'polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)' }}
            >
              Iniciar Nueva Campaña
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
