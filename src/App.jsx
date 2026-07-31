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
import ProfileModal from './components/ProfileModal';
import FriendsModal from './components/FriendsModal';
import { SoundManager } from './components/SoundManager';
import { FACTIONS } from './utils/boardGraph';
import { APP_VERSION } from './version';
import { Shield, Settings, Play, ShieldAlert, RotateCcw, Volume2, VolumeX, ListCollapse, Wifi, X, Home } from 'lucide-react';
import ChatPanel from './components/ChatPanel';

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
  const iAmHost = !!(mp.game && (
    (mp.accountId && mp.game.host_account === mp.accountId) || mp.userId === mp.game.host_id
  ));
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
    acceptAlliance,
    rejectAlliance,
    breakAlliance,
    areAllied,
    alliances,
    allianceProposals,
    nucleoData,
    addLog,
    getSnapshot,
    hydrate,
  } = useGameState(onlineConfig);

  // ── Online turn authority ──
  const seats = mp.game?.state?.seats ?? null;
  // A seat is "mine" if it belongs to my account (any of my linked devices) or,
  // for pre-account/anonymous games, to this device's uid.
  const myFactions = seats
    ? seats.filter((s) => (s.accountId && mp.accountId && s.accountId === mp.accountId) || s.userId === mp.userId).map((s) => s.faction)
    : [];
  const activeFaction = players[currentTurn]?.faction;
  const isMyTurn = !onlineActive || myFactions.includes(activeFaction);
  // This device may write to the shared state when it's my human turn, or when
  // I'm the host and it's a bot's turn.
  const authoritative = !onlineActive
    ? true
    : (myFactions.includes(activeFaction) || (iAmHost && players[currentTurn]?.isBot));

  const lastSyncedRef = React.useRef(null);
  const notifyRef = React.useRef({ turn: null, def: false, neg: false }); // push-notification dedupe

  // ── Record the game result into my profile stats (online games, once each) ──
  const recordedRef = React.useRef(false);
  useEffect(() => {
    if (phase !== 'GAME_OVER' || !onlineActive || recordedRef.current) return;
    const gid = mp.game?.id;
    if (!gid) return;
    let done = [];
    try { done = JSON.parse(localStorage.getItem('bc_recorded') || '[]'); } catch { /* ignore */ }
    recordedRef.current = true;
    if (done.includes(gid)) return; // already counted (survives reloads)
    const won = Boolean(winner && myFactions.includes(winner.faction));
    mp.recordResult(won);
    try { localStorage.setItem('bc_recorded', JSON.stringify([...done, gid].slice(-100))); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, onlineActive, winner]);

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
    { faction: 0, isBot: false, name: "Jugador Rojo" },
    { faction: 1, isBot: true, name: "Jugador Azul" },
    { faction: 2, isBot: true, name: "Jugador Amarillo" },
    { faction: 3, isBot: true, name: "Jugador Verde" },
    { faction: 4, isBot: true, name: "Jugador Morado" }
  ]);
  const [isMuted, setIsMuted] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatSeen, setChatSeen] = useState(0);
  // While the chat is open, everything counts as seen; closed, new messages pile up.
  useEffect(() => { if (showChat) setChatSeen(mp.chatMessages.length); }, [showChat, mp.chatMessages.length]);
  const chatUnread = Math.max(0, mp.chatMessages.length - chatSeen);
  const [troopsToMove, setTroopsToMove] = useState(1);
  const [wizardIdx, setWizardIdx] = useState(0); // setup wizard: current seat step (=== count → review)
  // Game options chosen by the creator
  const [boardSizeOpt, setBoardSizeOpt] = useState('large'); // 'large' | 'small'
  const [brutalOpt, setBrutalOpt] = useState(false); // brutal cards (bomb + instant núcleo win)
  const [showGameConfig, setShowGameConfig] = useState(false); // board+cards popup
  const [seatConfigIdx, setSeatConfigIdx] = useState(null); // which seat's role popup is open
  // A local (hotseat) game saved on this device, so "back to menu" can resume it.
  const [hasSavedLocal] = useState(() => { try { return !!localStorage.getItem('bc_local_game'); } catch { return false; } });
  // Landing page: show "Jugar / Instalar" first; deep-link joins skip straight in.
  const [homeScreen, setHomeScreen] = useState(true);
  const [lobbyInitialView, setLobbyInitialView] = useState('choose'); // 'choose' | 'mygames'

  // ── Profile / friends (ranking lives inside the friends modal) ──
  const [showProfile, setShowProfile] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [onboarded, setOnboarded] = useState(false); // dismissed the create-profile prompt this session
  const [updateAvailable, setUpdateAvailable] = useState(false); // a newer app version is live

  // Compare the live deploy's /version.json against this build; prompt if newer.
  // (Static file published by Vercel on each deploy — no DB, no manual step.)
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json();
        if (alive && typeof version === 'number' && version > APP_VERSION) setUpdateAvailable(true);
      } catch { /* offline / not deployed yet — ignore */ }
    };
    check();
    const t = setInterval(check, 5 * 60 * 1000); // re-check every 5 min while open
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Force a clean reload to the latest version (clears SW caches first — reliable on iOS).
  const applyUpdate = async () => {
    try { if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } } catch { /* ignore */ }
    window.location.reload();
  };
  const [friendToast, setFriendToast] = useState(null); // { ok, text }
  const friendLinkRef = React.useRef(false);

  // ── PWA install ──
  const [deferredPrompt, setDeferredPrompt] = useState(null); // Android/desktop Chrome
  const [showIosHelp, setShowIosHelp] = useState(false);
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
  // In-app browsers (WhatsApp/Instagram/Facebook/Android WebView) have isolated
  // storage → a different anonymous identity → a stray profile. Warn about it.
  const inAppBrowser = typeof navigator !== 'undefined' && !isStandalone &&
    (/WhatsApp|FBAN|FBAV|FB_IAB|Instagram|Line\/|Messenger|; ?wv\)/i.test(navigator.userAgent || ''));
  const [dismissInApp, setDismissInApp] = useState(false);
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

  // If the URL carries ?friend=CODE, add that friend (mutual, instant) and toast.
  useEffect(() => {
    if (!mp.available || friendLinkRef.current) return;
    let friendCode = '';
    try { friendCode = new URLSearchParams(window.location.search).get('friend') || ''; } catch { /* ignore */ }
    if (!friendCode) return;
    friendLinkRef.current = true;
    try { const u = new URL(window.location.href); u.searchParams.delete('friend'); window.history.replaceState({}, '', u); } catch { /* ignore */ }
    mp.addFriendByCode(friendCode).then((r) => {
      setFriendToast(r.ok
        ? { ok: true, text: r.accepted
            ? `¡Ahora sois amigos, ${r.friend?.nickname || ''}! ${r.friend?.avatar || ''}`
            : `Solicitud de amistad enviada a ${r.friend?.nickname || 'tu amigo'} ${r.friend?.avatar || ''}` }
        : { ok: false, text: r.msg });
      setTimeout(() => setFriendToast(null), 4500);
    });
  }, [mp.available, mp.addFriendByCode]);

  // Onboarding: on the home screen, if online is available and you have no
  // profile yet, prompt to create one (or log in). Once, dismissible.
  useEffect(() => {
    if (!homeScreen || !mp.available || onboarded || showProfile) return;
    if (mp.profile?.nickname) return;
    const t = setTimeout(() => { if (!mp.profile?.nickname) setShowProfile(true); }, 900);
    return () => clearTimeout(t);
  }, [homeScreen, mp.available, mp.profile?.nickname, onboarded, showProfile]);

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

      // Push notifications (only the acting client runs this). Best-effort.
      try {
        const url = `${window.location.origin}/?join=${mp.game.code}`;
        const seatUid = (f) => (seats || []).find((s) => s.faction === f && s.type === 'human' && s.userId)?.userId;
        // Turn handed to a different human → notify them.
        if (snap.currentTurn !== notifyRef.current.turn) {
          notifyRef.current.turn = snap.currentTurn;
          const cur = snap.players?.[snap.currentTurn];
          const uid = cur && !cur.isBot ? seatUid(cur.faction) : null;
          if (uid && uid !== mp.userId) mp.notify({ userId: uid, title: '🎯 ¡Es tu turno!', body: `Te toca en BattleChis (${cur.name}).`, url });
        }
        // Attacked → super-defense prompt.
        if (snap.defenseState && !notifyRef.current.def) {
          notifyRef.current.def = true;
          const uid = seatUid(snap.defenseState.defenderFaction);
          if (uid && uid !== mp.userId) mp.notify({ userId: uid, title: '🛡️ ¡Te atacan!', body: 'Decide si usas tu Super Defensa.', url });
        } else if (!snap.defenseState) { notifyRef.current.def = false; }
        // Road-crossing negotiation.
        if (snap.negotiationState && !notifyRef.current.neg) {
          notifyRef.current.neg = true;
          const uid = seatUid(snap.negotiationState.defenderFaction);
          if (uid && uid !== mp.userId) mp.notify({ userId: uid, title: '🚧 Cruce en tu territorio', body: '¿Dejas pasar o bloqueas?', url });
        } else if (!snap.negotiationState) { notifyRef.current.neg = false; }
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(t);
  }, [onlineActive, mp, seats, getSnapshot]);

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
          name: FACTIONS[unusedFaction].commander
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

  // Set a seat's role from the per-player popup. role: 'bot' | 'local' | 'online'
  // (local covers "yo" and "invitado" — the difference is just the name).
  const setSeatRole = (index, role) => {
    const updated = setupPlayers.map((p, i) => {
      if (i !== index) return p;
      if (role === 'bot') return { ...p, isBot: true, online: false };
      if (role === 'online') return { ...p, isBot: false, online: true, name: 'Online' };
      // local: keep a real name (fall back to my profile when coming from bot/online)
      const name = (!p.isBot && !p.online && p.name) ? p.name : (mp.profile?.nickname || FACTIONS[p.faction].commander);
      return { ...p, isBot: false, online: false, name };
    });
    setSetupPlayers(updated);
    SoundManager.playClick();
  };

  // Single entry point: the engine decides local vs online from the seats.
  const handleCreateGame = () => {
    const factionsUsed = setupPlayers.map((p) => p.faction);
    if (new Set(factionsUsed).size !== factionsUsed.length) {
      alert('ERROR: Cada jugador debe tener un color único.');
      return;
    }
    if (!setupPlayers.some((p) => !p.isBot)) {
      alert('Pon al menos un jugador humano.');
      return;
    }
    const hasOnline = setupPlayers.some((p) => !p.isBot && p.online);
    if (hasOnline) {
      // Online game: create the row (local seats pre-claimed, online seats open)
      // and jump to the waiting room to invite the online players.
      const seats = setupPlayers.map((p) => ({
        faction: p.faction,
        type: p.isBot ? 'bot' : 'human',
        online: !!p.online,
        name: p.name,
      }));
      mp.createGame({ phase: 'LOBBY' }, seats)
        .then(() => { setLobbyInitialView('waiting'); setShowLobby(true); })
        .catch(() => {});
    } else {
      // Local hotseat game.
      try { localStorage.removeItem('bc_local_game'); } catch { /* ignore */ }
      startGame(setupPlayers, { boardSize: boardSizeOpt, brutalCards: brutalOpt });
    }
  };

  // Persist the LOCAL game so "volver al menú" keeps it (online lives in the DB).
  useEffect(() => {
    if (onlineActive) return;
    try {
      if (gameStarted && phase !== 'GAME_OVER') localStorage.setItem('bc_local_game', JSON.stringify(getSnapshot()));
      else if (phase === 'GAME_OVER') localStorage.removeItem('bc_local_game');
    } catch { /* ignore */ }
  }, [onlineActive, gameStarted, phase, getSnapshot]);

  // Your seat should show YOUR name: when the profile loads, put your nickname on
  // the first Local seat (only while it still has a default color name).
  useEffect(() => {
    const nick = mp.profile?.nickname;
    if (!nick) return;
    setSetupPlayers((prev) => {
      const idx = prev.findIndex((p) => !p.isBot && !p.online);
      if (idx === -1) return prev;
      const p = prev[idx];
      const isDefaultName = FACTIONS.some((f) => f.commander === p.name);
      if (!isDefaultName || p.name === nick) return prev;
      const next = [...prev];
      next[idx] = { ...p, name: nick };
      return next;
    });
  }, [mp.profile?.nickname]);

  // Resume a saved local game from the home screen.
  const continueLocalGame = () => {
    try {
      const s = JSON.parse(localStorage.getItem('bc_local_game'));
      if (s) hydrate(s);
    } catch { /* ignore */ }
  };

  const toggleMute = () => {
    const muted = SoundManager.toggleMute();
    setIsMuted(muted);
  };


  // Render Setup Lobby Screen
  if (!gameStarted) {
    return (
      <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: '#07090f', zIndex: 10 }}>
        {/* Settings (profile + notifications) — pinned to the true top-right corner
            of the screen (outside the animate-fade-in transform, only on home). */}
        {homeScreen && mp.available && (
          <div style={{ position: 'fixed', top: 8, right: 8, zIndex: 40, maxWidth: '60vw', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <button
              onClick={() => setShowProfile(true)}
              title="Ajustes"
              className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border border-slate-700 bg-[#0d101a]/90 hover:border-cyan-500/50 transition-all max-w-full"
            >
              <span className="text-lg leading-none">{mp.profile?.avatar || '🎖️'}</span>
              <span className="font-tactical text-xs text-white truncate">{mp.profile?.nickname || 'Ajustes'}</span>
              <Settings className="w-4 h-4 text-slate-400 shrink-0" />
            </button>
            <span className="font-mono text-[9px] text-slate-500 pr-1.5 leading-none select-none">Versión {APP_VERSION}</span>
          </div>
        )}
        <div className="min-h-full w-full flex flex-col justify-center items-center gap-3 p-3 sm:p-5 relative animate-fade-in">

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

          {showProfile && (
            <ProfileModal
              profile={mp.profile}
              onSave={mp.saveProfile}
              checkNickname={mp.checkNickname}
              setPassword={mp.setPassword}
              claimProfile={mp.claimProfile}
              onLogout={async () => { await mp.logout(); setOnboarded(false); }}
              pushSupported={mp.pushSupported}
              pushEnabled={mp.pushEnabled}
              enablePush={mp.enablePush}
              disablePush={mp.disablePush}
              onClose={() => { setShowProfile(false); setOnboarded(true); }}
            />
          )}
          {showFriends && (
            <FriendsModal
              profile={mp.profile}
              myUserId={mp.userId}
              searchProfiles={mp.searchProfiles}
              sendFriendRequest={mp.sendFriendRequest}
              listFriendRequests={mp.listFriendRequests}
              acceptFriendRequest={mp.acceptFriendRequest}
              rejectFriendRequest={mp.rejectFriendRequest}
              fetchRanking={mp.fetchRanking}
              removeFriend={mp.removeFriend}
              onClose={() => setShowFriends(false)}
            />
          )}
          {friendToast && (
            <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 900 }}>
              <div className={`px-4 py-2 rounded-lg border font-mono text-[11px] shadow-lg ${friendToast.ok ? 'border-green-500/50 bg-green-950/90 text-green-300' : 'border-red-500/50 bg-red-950/90 text-red-300'}`}>
                {friendToast.text}
              </div>
            </div>
          )}

          {homeScreen ? (
            /* ── PORTADA: Jugar / Instalar ── */
            <div className="flex flex-col items-center text-center pt-12 pb-1 animate-fade-in">
              {updateAvailable && (
                <button
                  onClick={applyUpdate}
                  className="w-full max-w-xs mb-4 btn-tactical border-green-400 text-green-300 bg-green-950/40 font-black tracking-widest text-sm py-2.5 hover:bg-green-500/20 animate-pulse"
                >
                  🔄 ACTUALIZAR · NUEVA VERSIÓN
                </button>
              )}
              {inAppBrowser && !dismissInApp && (
                <div className="w-full max-w-sm mb-3 rounded-lg border border-amber-500/50 bg-amber-950/30 px-3 py-2 text-left">
                  <p className="font-mono text-[10px] text-amber-300 leading-relaxed">
                    ⚠️ Parece que has abierto esto <strong>dentro de otra app</strong> (WhatsApp/Instagram…). Aquí tu perfil y amigos <strong>no se guardan bien</strong> (identidad distinta). Ábrelo en tu <strong>navegador</strong> (menú ⋮ → “Abrir en Chrome/Safari”) o en la <strong>app instalada</strong>.
                  </p>
                  <button onClick={() => setDismissInApp(true)} className="mt-1 font-mono text-[9px] text-amber-500/70 underline">Entendido, seguir aquí igualmente</button>
                </div>
              )}
              <h1 className="font-tactical text-2xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 tracking-widest uppercase drop-shadow-[0_0_12px_rgba(0,240,255,0.4)]">
                BATTLECHIS
              </h1>
              <p className="font-tactical text-[9px] sm:text-xs text-cyan-400/70 tracking-[4px] uppercase font-bold mt-0.5 mb-4">
                Risk + Parchís táctico
              </p>
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {hasSavedLocal && (
                  <button
                    onClick={continueLocalGame}
                    className="btn-tactical border-green-400 text-green-400 bg-green-950/30 font-black tracking-widest text-base py-2.5 hover:shadow-[0_0_20px_rgba(0,230,118,0.4)]"
                  >
                    ▶ CONTINUAR PARTIDA
                  </button>
                )}
                <button
                  onClick={() => setHomeScreen(false)}
                  className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/30 font-black tracking-widest text-base py-2.5 hover:shadow-[0_0_20px_rgba(0,240,255,0.4)]"
                >
                  <Play className="w-5 h-5 mr-1" /> {hasSavedLocal ? 'NUEVA PARTIDA' : 'JUGAR'}
                </button>
                {mp.available && (
                  <button
                    onClick={() => { setLobbyInitialView('mygames'); setShowLobby(true); }}
                    className="btn-tactical border-slate-500 text-slate-300 bg-slate-800/30 font-bold tracking-widest text-sm py-2.5 hover:bg-slate-700/40"
                  >
                    📂 MIS PARTIDAS
                  </button>
                )}
                {mp.available && (
                  <button
                    onClick={() => setShowFriends(true)}
                    className="btn-tactical border-cyan-500/50 text-cyan-300 bg-cyan-950/20 font-bold tracking-widest text-sm py-2.5 hover:bg-cyan-900/30"
                  >
                    👥 AMIGOS Y RANKING
                  </button>
                )}
                {canShowInstall ? (
                  <button
                    onClick={handleInstall}
                    className="btn-tactical border-green-400 text-green-400 bg-green-950/20 font-black tracking-widest text-base py-2.5 hover:shadow-[0_0_20px_rgba(0,230,118,0.4)]"
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
            const hasOnline = setupPlayers.some((p) => !p.isBot && p.online);
            const roleBadge = (p) => p.isBot
              ? { txt: '🤖 IA', cls: 'text-amber-400 bg-amber-950/30' }
              : p.online
                ? { txt: '📶 Online', cls: 'text-cyan-300 bg-cyan-950/40' }
                : { txt: '👤 Local', cls: 'text-green-400 bg-green-950/30' };
            const seat = seatConfigIdx !== null ? setupPlayers[seatConfigIdx] : null;

            return (
              <div className="w-full max-w-lg mx-auto">
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
                        onClick={() => handlePlayerCountChange(count)}
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

                {/* Player roster — tap a row to set who plays it */}
                <div className="flex flex-col gap-1.5 mb-3">
                  {setupPlayers.map((p, i) => {
                    const b = roleBadge(p);
                    return (
                      <button key={i} onClick={() => setSeatConfigIdx(i)}
                        className="flex items-center gap-2 bg-[#0d101a] border border-slate-900 rounded px-2.5 py-2 hover:border-cyan-500/40 transition-all text-left">
                        <div style={{ width: 12, height: 12, borderRadius: '50%', background: FACTIONS[p.faction]?.neon, flexShrink: 0 }} />
                        <span className="font-tactical text-[12px] text-white flex-1 truncate">
                          {p.name}
                          {!p.isBot && !p.online && mp.profile?.nickname && p.name === mp.profile.nickname && <span className="text-cyan-400/70"> (tú)</span>}
                        </span>
                        <span className={`font-mono text-[9px] px-2 py-0.5 rounded ${b.cls}`}>{b.txt}</span>
                        <Settings className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      </button>
                    );
                  })}
                </div>

                {/* Game config (board + cards) → popup, no scroll */}
                <button onClick={() => setShowGameConfig(true)}
                  className="w-full flex items-center justify-center gap-2 border border-slate-700 rounded py-2 mb-3 text-slate-300 font-mono text-[11px] hover:border-cyan-500/40 transition-all">
                  <Settings className="w-4 h-4" /> Configuración de partida
                  <span className="text-gray-600 text-[9px]">· {boardSizeOpt === 'large' ? 'Grande' : 'Pequeño'} · {brutalOpt ? 'Brutales' : 'Normales'}</span>
                </button>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setHomeScreen(true)}
                    className="btn-tactical border-slate-700 text-slate-400 py-2.5 px-4 text-xs">◀ Volver</button>
                  <button onClick={handleCreateGame} style={{ flex: 1 }}
                    className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/30 font-black tracking-wider text-sm py-2.5 hover:shadow-[0_0_20px_rgba(0,240,255,0.4)]">
                    {hasOnline ? <><Wifi className="w-4 h-4 mr-1" /> CREAR ONLINE</> : <><Play className="w-4 h-4 mr-1" /> CREAR PARTIDA</>}
                  </button>
                </div>
                {hasOnline && (
                  <p className="font-mono text-[9px] text-cyan-400/70 text-center mt-1.5">Hay puestos online → se crea partida online (invitas en la sala de espera).</p>
                )}

                {/* ── Per-seat role popup ── */}
                {seat && (
                  <div style={{ position: 'fixed', inset: 0, zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={() => setSeatConfigIdx(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="animate-fade-in" style={{ width: 'min(340px, 92vw)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', background: '#0f121d', border: '1px solid rgba(0,240,255,0.35)', borderRadius: 8, padding: '14px 16px' }}>
                      <div className="flex items-center gap-2 mb-3">
                        <div style={{ width: 12, height: 12, borderRadius: '50%', background: FACTIONS[seat.faction]?.neon }} />
                        <span className="font-tactical text-[12px] text-white flex-1">Jugador {seatConfigIdx + 1}</span>
                        <button onClick={() => setSeatConfigIdx(null)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
                      </div>

                      {/* Color */}
                      <label className="font-mono text-[9px] text-gray-500 uppercase tracking-wider">Color</label>
                      <div className="flex gap-2 mt-1 mb-3">
                        {FACTIONS.map((f) => {
                          const taken = setupPlayers.some((q, qi) => q.faction === f.id && qi !== seatConfigIdx);
                          return (
                            <button key={f.id} disabled={taken} title={f.name}
                              onClick={() => handleSetupPlayerChange(seatConfigIdx, 'faction', f.id)}
                              style={{ width: 28, height: 28, borderRadius: '50%', background: f.neon, opacity: taken ? 0.2 : 1, outline: seat.faction === f.id ? '2px solid #fff' : 'none', outlineOffset: 2, cursor: taken ? 'not-allowed' : 'pointer', border: 'none' }} />
                          );
                        })}
                      </div>

                      {/* Role */}
                      <label className="font-mono text-[9px] text-gray-500 uppercase tracking-wider">Quién juega</label>
                      <div className="grid grid-cols-3 gap-1.5 mt-1">
                        {[['local', '👤 Local'], ['bot', '🤖 IA'], ...(mp.available ? [['online', '📶 Online']] : [])].map(([role, lbl]) => {
                          const active = role === 'bot' ? seat.isBot : role === 'online' ? (!seat.isBot && seat.online) : (!seat.isBot && !seat.online);
                          return (
                            <button key={role} onClick={() => setSeatRole(seatConfigIdx, role)}
                              className={`py-2 rounded font-tactical text-[11px] font-bold border transition-all ${active ? 'border-cyan-400 text-cyan-300 bg-cyan-950/40' : 'border-slate-700 text-slate-400 hover:text-white'}`}>{lbl}</button>
                          );
                        })}
                      </div>

                      {/* Name (local humans) */}
                      {!seat.isBot && !seat.online && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between">
                            <label className="font-mono text-[9px] text-gray-500 uppercase tracking-wider">Nombre (tú o invitado)</label>
                            {mp.profile?.nickname && (
                              <button onClick={() => handleSetupPlayerChange(seatConfigIdx, 'name', mp.profile.nickname)}
                                className="font-mono text-[9px] text-cyan-400 hover:text-cyan-300 underline">usar mi perfil</button>
                            )}
                          </div>
                          <input value={seat.name} onChange={(e) => handleSetupPlayerChange(seatConfigIdx, 'name', e.target.value)}
                            className="w-full bg-[#121625] border border-slate-800 text-white font-mono text-sm p-2 rounded focus:outline-none focus:border-cyan-500 mt-1" />
                        </div>
                      )}
                      {!seat.isBot && seat.online && (
                        <p className="font-mono text-[9px] text-cyan-400/80 mt-3">Este puesto lo ocupará alguien <strong>online</strong>: le invitas desde la sala de espera al crear la partida.</p>
                      )}

                      <button onClick={() => setSeatConfigIdx(null)}
                        className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 py-2 text-xs font-bold w-full mt-4">Hecho</button>
                    </div>
                  </div>
                )}

                {/* ── Game config popup ── */}
                {showGameConfig && (
                  <div style={{ position: 'fixed', inset: 0, zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowGameConfig(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="animate-fade-in" style={{ width: 'min(340px, 92vw)', background: '#0f121d', border: '1px solid rgba(0,240,255,0.35)', borderRadius: 8, padding: '14px 16px' }}>
                      <div className="flex items-center gap-2 mb-3">
                        <Settings className="w-4 h-4 text-cyan-400" />
                        <span className="font-tactical text-[12px] text-white flex-1">Configuración de partida</span>
                        <button onClick={() => setShowGameConfig(false)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
                      </div>
                      <label className="font-mono text-[9px] text-gray-500 uppercase tracking-wider">Tablero</label>
                      <div className="flex gap-2 mt-1 mb-3">
                        {[['large', 'Grande'], ['small', 'Pequeño ⚡']].map(([val, lbl]) => (
                          <button key={val} onClick={() => setBoardSizeOpt(val)}
                            className={`flex-1 py-2 rounded font-tactical text-[11px] font-bold border transition-all ${boardSizeOpt === val ? 'border-cyan-400 text-cyan-400 bg-cyan-950/30' : 'border-slate-800 text-gray-500'}`}>{lbl}</button>
                        ))}
                      </div>
                      <label className="font-mono text-[9px] text-gray-500 uppercase tracking-wider">Cartas</label>
                      <div className="flex gap-2 mt-1">
                        {[[false, 'Normales'], [true, 'Brutales 💣👑']].map(([val, lbl]) => (
                          <button key={String(val)} onClick={() => setBrutalOpt(val)}
                            className={`flex-1 py-2 rounded font-tactical text-[11px] font-bold border transition-all ${brutalOpt === val ? 'border-red-400 text-red-400 bg-red-950/30' : 'border-slate-800 text-gray-500'}`}>{lbl}</button>
                        ))}
                      </div>
                      <button onClick={() => setShowGameConfig(false)}
                        className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 py-2 text-xs font-bold w-full mt-4">Hecho</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        </div>

        {/* Online lobby overlay (full-screen, scrolls with the page, centered) */}
        {showLobby && (
          <div className="fixed inset-0 z-[700] overflow-y-auto bg-black/85 backdrop-blur-md flex flex-col items-center py-8">
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
      style={{ width: '100vw', height: '100dvh', display: 'grid', gridTemplateRows: 'auto 1fr', background: '#07090f', overflow: 'hidden' }}
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
            onClick={() => { setShowLog(v => !v); setShowChat(false); }}
            className={`p-2 border rounded transition-all text-xs font-tactical font-bold ${showLog ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20' : 'border-slate-800 text-slate-500 hover:text-white hover:border-slate-700'}`}
            title="Log táctico"
          >
            📋
          </button>

          {/* Chat toggle (online only) */}
          {onlineActive && (
            <button
              onClick={() => { setShowChat(v => !v); setShowLog(false); }}
              className={`relative p-2 border rounded transition-all text-xs font-tactical font-bold ${showChat ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20' : 'border-slate-800 text-slate-500 hover:text-white hover:border-slate-700'}`}
              title="Chat"
            >
              💬
              {chatUnread > 0 && !showChat && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] px-1 flex items-center justify-center leading-none">
                  {chatUnread > 9 ? '9+' : chatUnread}
                </span>
              )}
            </button>
          )}

          {/* Push notifications toggle */}
          {mp.available && mp.pushSupported && (
            <button
              onClick={async () => {
                const r = await mp.enablePush();
                alert(r.ok ? '🔔 Avisos activados: te avisaremos cuando sea tu turno o te ataquen, aunque cierres la app.' : `No se pudieron activar: ${r.msg}`);
              }}
              className={`p-2 border rounded transition-all text-xs font-tactical font-bold ${mp.pushEnabled ? 'border-green-500/60 text-green-300 bg-green-950/20' : 'border-slate-800 text-slate-500 hover:text-white hover:border-slate-700'}`}
              title={mp.pushEnabled ? 'Avisos activados' : 'Activar avisos push'}
            >
              {mp.pushEnabled ? '🔔' : '🔕'}
            </button>
          )}

          {/* Mute button */}
          <button
            onClick={toggleMute}
            className="p-2 border border-slate-800 rounded text-slate-500 hover:text-white hover:border-slate-700 transition-all"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-500" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>
          
          {/* Back to menu (non-destructive: the game is kept) */}
          <button
            onClick={() => {
              const msg = onlineActive
                ? '¿Volver al menú? La partida NO se borra: sigue en "Mis partidas" para continuar.'
                : '¿Volver al menú? La partida local se guarda: podrás continuarla desde el menú.';
              if (window.confirm(msg)) window.location.reload();
            }}
            className="p-2 border border-slate-800 rounded text-slate-500 hover:text-cyan-400 hover:border-cyan-900 transition-all"
            title="Volver al menú (sin borrar la partida)"
          >
            <Home className="w-4 h-4" />
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
            style={{ pointerEvents: 'all', width: 'min(400px, 96vw)', maxHeight: 'calc(100dvh - 60px)', overflowY: 'auto', background: '#0d101a', borderColor: 'rgba(100,120,180,0.4)', borderRadius: '10px', boxShadow: '0 0 40px rgba(0,0,0,0.8)' }}
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

            {/* Alliance controls — only on YOUR human turn (so "you" is always the
                current player: no self-ally, and every opponent shows). */}
            {gameStarted && phase !== 'GAME_OVER' && isMyTurn && !players[currentTurn]?.isBot && (
              <div style={{ padding: '0 12px 12px' }}>
                <div className="font-tactical text-[10px] text-gray-500 font-bold tracking-widest uppercase mb-2">DIPLOMACIA</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {players.filter(p => p.faction !== players[currentTurn]?.faction && !p.eliminated).map(p => {
                    const myFaction = players[currentTurn]?.faction;
                    const allied = areAllied(myFaction, p.faction);
                    // Pending requests either way between me and this player.
                    const incoming = (allianceProposals || []).find(x => x.from === p.faction && x.to === myFaction); // they asked me
                    const outgoing = (allianceProposals || []).find(x => x.from === myFaction && x.to === p.faction); // I asked them
                    const btn = (bg, border, color) => ({ fontSize: 10, padding: '2px 8px', border: `1px solid ${border}`, borderRadius: 4, background: bg, color, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--font-tactical)', fontWeight: 700 });
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: allied ? 'rgba(0,230,118,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${allied ? 'rgba(0,230,118,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: FACTIONS[p.faction]?.neon, flexShrink: 0 }} />
                        <span className="font-tactical text-[10px] text-gray-300 flex-1 truncate">{p.name}</span>
                        {allied ? (
                          <button onClick={guardAuth(() => breakAlliance(myFaction, p.faction))} style={btn('rgba(255,59,59,0.1)', 'rgba(255,59,59,0.5)', '#f87171')}>💔 Romper</button>
                        ) : incoming ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={guardAuth(() => acceptAlliance(p.faction, myFaction))} style={btn('rgba(0,230,118,0.15)', 'rgba(0,230,118,0.6)', '#4ade80')}>✅ Aceptar</button>
                            <button onClick={guardAuth(() => rejectAlliance(p.faction, myFaction))} style={btn('rgba(255,59,59,0.1)', 'rgba(255,59,59,0.4)', '#f87171')}>❌</button>
                          </div>
                        ) : outgoing ? (
                          <span className="font-tactical text-[10px] text-amber-400/80" style={{ whiteSpace: 'nowrap' }}>⏳ Enviada</span>
                        ) : (
                          <button onClick={guardAuth(() => proposeAlliance(myFaction, p.faction))} style={btn('rgba(0,230,118,0.1)', 'rgba(0,230,118,0.5)', '#4ade80')}>🤝 Aliar</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Chat Panel (online) */}
      {showChat && onlineActive && (
        <ChatPanel
          messages={mp.chatMessages}
          onSend={(t) => mp.sendChat(mp.game?.id, t)}
          onClose={() => setShowChat(false)}
          myUid={mp.userId}
          myAccountId={mp.accountId}
        />
      )}

      {/* Floating Log Panel */}
      {showLog && (
        <div
          className="fixed z-[500] tactical-panel bg-[#0d101a]/95 border-slate-700 rounded-md shadow-[0_0_30px_rgba(0,0,0,0.8)] animate-fade-in"
          style={{ bottom: '12px', left: '50%', transform: 'translateX(-50%)', width: 'min(340px, calc(100vw - 24px))', height: 'min(320px, calc(100dvh - 90px))', display: 'flex', flexDirection: 'column' }}
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
