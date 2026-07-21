import { useState, useEffect, useCallback, useMemo } from 'react';
import { generateBoardGraph, getNodesAtDistance, findShortestPath, FACTIONS } from '../utils/boardGraph';
import { SoundManager } from '../components/SoundManager';

// Surprise card pool (Monopoly-style): troops gained/lost by the platoon landing on the cell
export const SURPRISE_CARDS = [+5, +3, +2, +1, -1, -2, -3];

// Build the surprise draw deck. In "brutal" mode we sprinkle in powerful cards:
//   💣 bomb (wipe any base) and 👑 instant NÚCLEO victory (rare).
export const BRUTAL_CARD_TYPES = ['bomb', 'nucleo', 'endgame', 'superdef'];

export function buildSurpriseDeck(brutal) {
  const deck = SURPRISE_CARDS.map((v) => ({ t: 'troops', v }));
  if (brutal) {
    deck.push({ t: 'bomb' }, { t: 'bomb' });   // 2 nukes
    deck.push({ t: 'superdef' }, { t: 'superdef' }); // 2 super-defense
    deck.push({ t: 'nucleo' });                 // 1 instant NÚCLEO win (rare)
    deck.push({ t: 'endgame' });                // 1 sudden death: leader wins now (rare)
  }
  return deck;
}

// Human-readable card info (for hand UI / logs)
export const CARD_INFO = {
  bomb: { icon: '💣', name: 'Bomba atómica', kind: 'attack' },
  nucleo: { icon: '👑', name: 'Victoria del núcleo', kind: 'attack' },
  endgame: { icon: '🏁', name: 'Fin de partida', kind: 'attack' },
  superdef: { icon: '🛡️', name: 'Super defensa', kind: 'defense' },
};

export function useGameState(online = null) {
  // Online config (null = offline single-device play, unchanged behaviour):
  //   { isOnline: true, isHost: bool }
  // In online mode the HOST is the only client that runs bot logic, so bots
  // don't get executed (and pushed) by every device at once.
  const isOnline = online?.isOnline ?? false;
  const botAuthority = !isOnline || (online?.isHost ?? false); // may this device run bots?

  // Board size + brutal cards are chosen by the game creator; graph is derived
  // from boardSize so every client rebuilds the same layout (deterministic ids).
  const [boardSize, setBoardSize] = useState('large');
  const [brutalCards, setBrutalCards] = useState(false);
  const graph = useMemo(() => generateBoardGraph(boardSize), [boardSize]);
  const [players, setPlayers] = useState([]);
  const [currentTurn, setCurrentTurn] = useState(0); // Index in players array
  const [phase, setPhase] = useState('SETUP'); // SETUP, RECRUIT, MOVE, CONQUER, COMBAT, GAME_OVER
  const [boardState, setBoardState] = useState({});
  const [diceRoll, setDiceRoll] = useState(null);
  const [sixCount, setSixCount] = useState(0);
  const [recruitmentTroops, setRecruitmentTroops] = useState(0);
  const [selectedNode, setSelectedNode] = useState(null);
  const [highlightedNodes, setHighlightedNodes] = useState([]);
  const [logs, setLogs] = useState([]);
  const [gameStarted, setGameStarted] = useState(false);

  // Alliances: array of {a: factionId, b: factionId}
  const [alliances, setAlliances] = useState([]);

  // NÚCLEO domination tracker: {faction: null|id, turns: 0}
  const [nucleoData, setNucleoData] = useState({ faction: null, turns: 0 });

  // Modals state
  const [combatState, setCombatState] = useState(null);
  const [conquestState, setConquestState] = useState(null);
  const [surpriseState, setSurpriseState] = useState(null); // {nodeId} — landing on a surprise cell
  const [siegeState, setSiegeState] = useState(null); // {attackerNodeId, defenderNodeId, attackForce} — shield siege before combat
  const [negotiationState, setNegotiationState] = useState(null); // road-crossing negotiation
  const [pendingAdvance, setPendingAdvance] = useState(null); // {fromId, toId} — continue after winning a block
  const [bombState, setBombState] = useState(null); // {nodeId} — surprise NUKE: pick a base to wipe
  const [defenseState, setDefenseState] = useState(null); // reactive Super Defense prompt on an attacked base

  // Secret card hands, per faction: { [factionId]: ['bomb'|'nucleo'|'endgame'|'superdef', ...] }
  const [hands, setHands] = useState({});

  // Shields: max 1 purchase per turn
  const [shieldPurchasedThisTurn, setShieldPurchasedThisTurn] = useState(false);

  // Add a message to the tactical console log
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 100));
  }, []);

  // Initialize the game.
  // options: { boardSize: 'large'|'small', brutalCards: boolean }
  const startGame = useCallback((selectedPlayers, options = {}) => {
    const size = options.boardSize || 'large';
    const brutal = !!options.brutalCards;
    setBoardSize(size);
    setBrutalCards(brutal);
    // Build from a freshly-generated graph of the chosen size (state update is async).
    const g = generateBoardGraph(size);

    // selectedPlayers: array of { faction: 0..4, isBot: boolean, name: string }
    const gamePlayers = selectedPlayers.map((p, idx) => ({
      id: idx,
      faction: p.faction,
      name: p.name || FACTIONS[p.faction].commander,
      color: FACTIONS[p.faction].color,
      neon: FACTIONS[p.faction].neon,
      isBot: p.isBot,
      eliminated: false
    }));

    setPlayers(gamePlayers);

    // Initialize board state
    const initialBoard = {};
    Object.keys(g).forEach(nodeId => {
      const node = g[nodeId];
      if (node.type === 'hq') {
        const owner = gamePlayers.find(p => p.faction === node.faction);
        if (owner) {
          initialBoard[nodeId] = {
            occupyingFaction: owner.faction,
            troops: 5,
            isSieged: false,
            shields: 0
          };
        } else {
          // Unassigned HQ starts as unoccupied base
          initialBoard[nodeId] = {
            occupyingFaction: null,
            troops: 2,
            isSieged: false,
            shields: 0
          };
        }
      } else {
        initialBoard[nodeId] = {
          occupyingFaction: null,
          troops: 0,
          isSieged: false,
          shields: 0
        };
      }
    });

    setBoardState(initialBoard);
    setCurrentTurn(0);
    setSixCount(0);
    setDiceRoll(null);
    setPhase('RECRUIT');
    setGameStarted(true);
    setShieldPurchasedThisTurn(false);
    setHands({});

    const firstPlayer = gamePlayers[0];
    const firstBases = Object.keys(initialBoard).filter(id => {
      const n = g[id]; const s = initialBoard[id];
      return s?.occupyingFaction === firstPlayer.faction && (n.type === 'hq' || n.type === 'neutral' || n.type === 'center');
    }).length;
    const initialRecruits = Math.max(1, firstBases * 3);
    setRecruitmentTroops(initialRecruits);

    setLogs([]);
    addLog(`SISTEMA INICIADO: Modo ${gamePlayers.length} Comandantes · Tablero ${size === 'small' ? 'PEQUEÑO' : 'GRANDE'}${brutal ? ' · Cartas brutales 💣' : ''}.`, 'success');
    addLog(`TURNO DE: ${firstPlayer.name.toUpperCase()} (+${initialRecruits} Refuerzos).`, 'info');
    SoundManager.playConquest();
  }, [addLog]);

  // Capture bonus by node type
  const captureBonus = useCallback((nodeType) => {
    if (nodeType === 'hq') return 10;
    if (nodeType === 'neutral') return 5;
    return 0;
  }, []);

  // BFS: find nearest friendly HQ or neutral base reachable from startNodeId
  const findNearestFriendlyBase = useCallback((startNodeId, faction, board) => {
    const startType = graph[startNodeId]?.type;
    if (board[startNodeId]?.occupyingFaction === faction && (startType === 'hq' || startType === 'neutral')) {
      return startNodeId;
    }
    const queue = [startNodeId];
    const visited = new Set([startNodeId]);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of (graph[current]?.neighbors ?? [])) {
        if (visited.has(neighbor)) continue;
        const nState = board[neighbor];
        const isEnemy = nState?.occupyingFaction !== null && nState.occupyingFaction !== faction;
        if (isEnemy) continue;
        visited.add(neighbor);
        const nType = graph[neighbor]?.type;
        if (nState?.occupyingFaction === faction && (nType === 'hq' || nType === 'neutral')) return neighbor;
        queue.push(neighbor);
      }
    }
    return null;
  }, [graph]);

  // Alliance helpers
  const areAllied = useCallback((factionA, factionB) =>
    alliances.some(al => (al.a === factionA && al.b === factionB) || (al.a === factionB && al.b === factionA)),
  [alliances]);

  const proposeAlliance = useCallback((factionA, factionB) => {
    if (areAllied(factionA, factionB)) return;
    setAlliances(prev => [...prev, { a: factionA, b: factionB }]);
    const nameA = FACTIONS[factionA].name.split(' ')[0];
    const nameB = FACTIONS[factionB].name.split(' ')[0];
    addLog(`🤝 ALIANZA: ${nameA} y ${nameB} han firmado un pacto de no agresión.`, 'success');
  }, [areAllied, addLog]);

  const breakAlliance = useCallback((factionA, factionB) => {
    setAlliances(prev => prev.filter(al =>
      !((al.a === factionA && al.b === factionB) || (al.a === factionB && al.b === factionA))
    ));
    const nameA = FACTIONS[factionA].name.split(' ')[0];
    const nameB = FACTIONS[factionB].name.split(' ')[0];
    addLog(`💔 TRAICIÓN: ${nameA} ha roto la alianza con ${nameB}. ¡La guerra recomienza!`, 'error');
  }, [addLog]);

  // Count strategic bases (HQ + neutral + center) controlled by faction
  const countStrategicBases = useCallback((faction, currentBoard) => {
    let count = 0;
    Object.keys(currentBoard).forEach(nodeId => {
      const node = graph[nodeId];
      const state = currentBoard[nodeId];
      if (state?.occupyingFaction === faction &&
          (node.type === 'hq' || node.type === 'neutral' || node.type === 'center')) count++;
    });
    return count;
  }, [graph]);

  // Check if a faction is eliminated or if there is a winner
  const checkVictoryConditions = useCallback((currentBoard) => {
    const activeFactions = new Set();
    Object.keys(currentBoard).forEach(nodeId => {
      const state = currentBoard[nodeId];
      if (state.occupyingFaction !== null && state.troops > 0) activeFactions.add(state.occupyingFaction);
    });

    // Mark eliminated players
    const updatedPlayers = players.map(p => {
      if (!p.eliminated && !activeFactions.has(p.faction)) {
        addLog(`💀 ELIMINADO: El comandante ${p.name.toUpperCase()} ha caído.`, 'error');
        return { ...p, eliminated: true };
      }
      return p;
    });

    const activePlayers = updatedPlayers.filter(p => !p.eliminated);

    // Win condition: last player standing
    if (activePlayers.length <= 1) {
      const winner = activePlayers[0] || players[0];
      setPhase('GAME_OVER');
      addLog(`🏆 VICTORIA ABSOLUTA: ${winner.name.toUpperCase()} domina el sector.`, 'success');
      SoundManager.playConquest();
      return true;
    }

    // Win condition: 60% of all strategic bases
    const totalBases = Object.keys(currentBoard).filter(id =>
      ['hq','neutral','center'].includes(graph[id]?.type)
    ).length;
    const threshold60 = Math.ceil(totalBases * 0.6);
    for (const p of activePlayers) {
      const controlled = countStrategicBases(p.faction, currentBoard);
      if (controlled >= threshold60) {
        setPhase('GAME_OVER');
        addLog(`🌍 DOMINACIÓN TOTAL: ${p.name.toUpperCase()} controla ${controlled}/${totalBases} bases (${Math.round(controlled/totalBases*100)}%). ¡Victoria!`, 'success');
        SoundManager.playConquest();
        return true;
      }
      if (controlled >= threshold60 - 1) {
        addLog(`⚠️ ALERTA: ${p.name.toUpperCase()} está a 1 base de la victoria por dominación.`, 'error');
      }
    }

    setPlayers(updatedPlayers);
    return false;
  }, [players, graph, countStrategicBases, addLog]);

  // Get recruitment points: 3 per controlled base (HQ, neutral, center)
  const getBasesControlledCount = useCallback((faction, currentBoard = boardState) => {
    let count = 0;
    Object.keys(currentBoard).forEach(nodeId => {
      const node = graph[nodeId];
      const state = currentBoard[nodeId];
      if (state && state.occupyingFaction === faction &&
          (node.type === 'hq' || node.type === 'neutral' || node.type === 'center')) {
        count++;
      }
    });
    return Math.max(1, count * 3);
  }, [graph, boardState]);

  // Total troops a faction controls across the whole board (for shield eligibility)
  const getTotalTroops = useCallback((faction, currentBoard = boardState) => {
    let total = 0;
    Object.keys(currentBoard).forEach(nodeId => {
      const s = currentBoard[nodeId];
      if (s?.occupyingFaction === faction) total += (s.troops || 0);
    });
    return total;
  }, [boardState]);

  // Phase transition: End Turn
  const endTurn = useCallback(() => {
    if (phase === 'SETUP' || phase === 'GAME_OVER') return;

    // ── NÚCLEO win condition check ──
    // Only increments when the player WHO HOLDS the center ends THEIR OWN turn
    // AND has at least 3 satellite bases — if below 3, counter resets to 0
    const centerNode = Object.keys(boardState).find(id => graph[id]?.type === 'center');
    if (centerNode) {
      const centerOwner = boardState[centerNode]?.occupyingFaction;
      const currentPlayerFaction = players[currentTurn]?.faction;

      // Count satellite bases for the center owner
      const satBases = centerOwner !== null ? Object.keys(boardState).filter(id => {
        const n = graph[id]; const s = boardState[id];
        return s?.occupyingFaction === centerOwner && (n.type === 'hq' || n.type === 'neutral');
      }).length : 0;

      setNucleoData(prev => {
        if (centerOwner === null) return { faction: null, turns: 0 };

        // Someone else's turn ending — just track ownership, no count change
        if (centerOwner !== currentPlayerFaction) {
          return centerOwner !== prev.faction ? { faction: centerOwner, turns: 0 } : prev;
        }

        // The center holder is ending their own turn
        // If they lost satellite bases, reset counter
        if (satBases < 3) {
          return { faction: centerOwner, turns: 0 };
        }

        const newTurns = centerOwner === prev.faction ? prev.turns + 1 : 1;

        if (newTurns >= 3) {
          const winner = players.find(p => p.faction === centerOwner);
          setTimeout(() => {
            setPhase('GAME_OVER');
            addLog(`👑 CONTROL DEL NÚCLEO: ${winner?.name.toUpperCase()} dominó el centro durante 3 de sus propios turnos. ¡VICTORIA!`, 'success');
            SoundManager.playConquest();
          }, 100);
        } else if (newTurns === 2) {
          const holder = players.find(p => p.faction === centerOwner);
          addLog(`⚠️ ALERTA: ${holder?.name.toUpperCase()} controla el NÚCLEO (2/3 turnos propios). ¡Detenedlo!`, 'error');
        } else {
          const holder = players.find(p => p.faction === centerOwner);
          addLog(`🔴 ${holder?.name.toUpperCase()} controla el NÚCLEO (1/3 turnos propios).`);
        }
        return { faction: centerOwner, turns: newTurns };
      });

      // Log reset separately when holder has insufficient satellite bases
      if (centerOwner === currentPlayerFaction && satBases < 3 && nucleoData.turns > 0) {
        const holderName = players.find(p => p.faction === centerOwner)?.name;
        addLog(`❌ NÚCLEO ANULADO: ${holderName?.toUpperCase()} no tiene 3 bases satélite. ¡Contador reiniciado!`, 'error');
      }
    }

    // Find next active player
    let nextIdx = (currentTurn + 1) % players.length;
    let attempts = 0;
    while (players[nextIdx].eliminated && attempts < players.length) {
      nextIdx = (nextIdx + 1) % players.length;
      attempts++;
    }

    setCurrentTurn(nextIdx);
    setSixCount(0);
    setDiceRoll(null);
    setSelectedNode(null);
    setHighlightedNodes([]);
    setPhase('RECRUIT');
    setShieldPurchasedThisTurn(false);

    const nextPlayer = players[nextIdx];
    const recruits = getBasesControlledCount(nextPlayer.faction);
    setRecruitmentTroops(recruits);

    addLog(`⚔️ TURNO: ${nextPlayer.name.toUpperCase()} | +${recruits} refuerzos`);
  }, [players, currentTurn, boardState, graph, getBasesControlledCount, phase, nucleoData, addLog]);

  // Handle reinforcements — only bases (HQ, neutral, center)
  const reinforceNode = useCallback((nodeId, count = 1) => {
    if (phase !== 'RECRUIT') return;

    const node = graph[nodeId];
    const state = boardState[nodeId];
    const currentPlayer = players[currentTurn];
    const isBase = node.type === 'hq' || node.type === 'neutral' || node.type === 'center';

    if (!isBase) {
      addLog("ERROR: Solo puedes reforzar bases (HQ, bases neutrales, núcleo).", "error");
      return;
    }
    if (!state || state.occupyingFaction !== currentPlayer.faction) {
      addLog("ERROR: Solo puedes reforzar tus propias bases.", "error");
      return;
    }

    const newBoard = { ...boardState, [nodeId]: { ...state, troops: state.troops + count } };
    setBoardState(newBoard);
    const remaining = recruitmentTroops - count;
    setRecruitmentTroops(remaining);

    const nodeName = graph[nodeId].name;
    addLog(`REFUERZO: ${currentPlayer.name.toUpperCase()} desplegó ${count} tropas en ${nodeName}.`, 'success');
    SoundManager.playMove();

    if (remaining <= 0) {
      // After deploying all reinforcements, offer the FORTIFY step (buy a shield)
      // to human players who are eligible; otherwise go straight to MOVE.
      const faction = currentPlayer.faction;
      const canFortify = !currentPlayer.isBot && !shieldPurchasedThisTurn &&
        getTotalTroops(faction, newBoard) >= 10 &&
        Object.keys(newBoard).some(id => {
          const n = graph[id]; const s = newBoard[id];
          return s.occupyingFaction === faction && (n.type === 'hq' || n.type === 'neutral' || n.type === 'center')
            && s.troops >= 6 && (s.shields || 0) < 3;
        });
      setHighlightedNodes([]);
      if (canFortify) {
        setPhase('FORTIFY');
        addLog("🛡️ FASE DE FORTIFICACIÓN: puedes canjear tropas de una base por 1 escudo.", "info");
      } else {
        setPhase('MOVE');
        addLog("FASE DE MOVIMIENTO: Lanza el dado táctico.", "info");
      }
    }
  }, [boardState, recruitmentTroops, players, currentTurn, phase, graph, addLog, shieldPurchasedThisTurn, getTotalTroops]);

  // Fortify a base with 1 shield during the FORTIFY step (after reinforcing, before
  // rolling). The 5-soldier cost is taken FROM THAT BASE's troops (must keep ≥1).
  // Requires ≥10 total troops. Max 1 shield/turn, max 3/base. Then → MOVE.
  const placeShield = useCallback((nodeId) => {
    if (phase !== 'FORTIFY' && phase !== 'RECRUIT') return;
    const node = graph[nodeId];
    const state = boardState[nodeId];
    const currentPlayer = players[currentTurn];
    const isBase = node?.type === 'hq' || node?.type === 'neutral' || node?.type === 'center';

    if (shieldPurchasedThisTurn) { addLog("Solo puedes fortificar con 1 escudo por turno.", "error"); return; }
    if (!isBase || !state || state.occupyingFaction !== currentPlayer.faction) {
      addLog("Los escudos solo se colocan en tus propias bases.", "error"); return;
    }
    if ((state.shields || 0) >= 3) { addLog("Esta base ya tiene el máximo de 3 escudos.", "error"); return; }
    if (getTotalTroops(currentPlayer.faction) < 10) {
      addLog("Necesitas al menos 10 tropas en el tablero para fortificar.", "error"); return;
    }
    if (state.troops < 6) {
      addLog("Esta base necesita al menos 6 tropas (gastas 5 y debe quedar 1 de guarnición).", "error"); return;
    }

    const newBoard = { ...boardState, [nodeId]: { ...state, troops: state.troops - 5, shields: (state.shields || 0) + 1 } };
    setBoardState(newBoard);
    setShieldPurchasedThisTurn(true);
    addLog(`🛡️ ${currentPlayer.name.toUpperCase()} fortificó ${node.name} (−5 tropas → 1 escudo).`, 'success');
    SoundManager.playConquest?.();
    // From the dedicated FORTIFY step, continue to movement. (Bots call this during
    // RECRUIT before reinforcing, so they must NOT skip ahead.)
    if (phase === 'FORTIFY') {
      setPhase('MOVE');
      setHighlightedNodes([]);
      addLog("FASE DE MOVIMIENTO: Lanza el dado táctico.", "info");
    }
  }, [phase, graph, boardState, players, currentTurn, shieldPurchasedThisTurn, getTotalTroops, addLog]);

  // Skip fortification → go straight to the movement phase.
  const skipFortify = useCallback(() => {
    setPhase('MOVE');
    setHighlightedNodes([]);
    addLog("FASE DE MOVIMIENTO: Lanza el dado táctico.", "info");
  }, [addLog]);

  // Roll movement die
  const rollMovement = useCallback(() => {
    if (phase !== 'MOVE' || diceRoll !== null) return;

    SoundManager.playRoll();
    const roll = Math.floor(Math.random() * 6) + 1;
    setDiceRoll(roll);
    addLog(`DADO TÁCTICO: Resultado del despliegue = ${roll}.`, 'info');

    // Check if the current player has any valid moves
    const currentPlayer = players[currentTurn];
    let hasValidMove = false;

    Object.keys(boardState).forEach(nodeId => {
      const state = boardState[nodeId];
      if (state.occupyingFaction === currentPlayer.faction && state.troops > 1) {
        const reachable = getNodesAtDistance(graph, nodeId, roll);
        if (reachable.length > 0) hasValidMove = true;
      }
    });

    // Special Siege Check: If a player has a platoon on a neutral base (sieging),
    // they can choose to spend their movement action to attempt to conquer it instead!
    // We'll allow them to resolve sieges.
    let hasSieges = false;
    Object.keys(boardState).forEach(nodeId => {
      const state = boardState[nodeId];
      if (state.occupyingFaction === currentPlayer.faction && state.isSieged) {
        hasSieges = true;
      }
    });

    if (!hasValidMove && !hasSieges) {
      addLog(`BLOQUEO: No hay movimientos viables para el rol ${roll}.`, 'error');
      // If rolled 6, they can roll again! Otherwise, end turn
      if (roll === 6 && sixCount < 2) {
        setSixCount(prev => prev + 1);
        setDiceRoll(null);
        addLog("REGLA DEL 6: ¡Vuelves a tirar!", "success");
      } else {
        setTimeout(() => {
          endTurn();
        }, 1500);
      }
    }
  }, [phase, diceRoll, boardState, players, currentTurn, graph, sixCount, endLog => addLog, endTurn]);

  // Complete movement step (check for 6-rolls or end turn)
  const resolvePostMovement = useCallback((customBoard = null) => {
    const finalBoard = customBoard || boardState;
    const isOver = checkVictoryConditions(finalBoard);
    if (isOver) return;

    // Rule of 6: roll again
    if (diceRoll === 6 && sixCount < 2) {
      setSixCount(prev => prev + 1);
      setDiceRoll(null);
      setPhase('MOVE');
      setSelectedNode(null);
      setHighlightedNodes([]);
      addLog("REGLA DEL 6: ¡Vuelves a tirar dado de movimiento!", "success");
    } else {
      const cp = players[currentTurn];
      if (cp?.isBot) {
        endTurn();
      } else {
        setPhase('REDISTRIBUTE');
        setSelectedNode(null);
        setHighlightedNodes([]);
        addLog("🔄 REDISTRIBUCIÓN: Reorganiza tropas entre nodos propios adyacentes. Pulsa 'Fin de turno' cuando acabes.", "info");
      }
    }
  }, [diceRoll, sixCount, boardState, players, currentTurn, checkVictoryConditions, endTurn, addLog]);

  // Trigger Combat Screen
  const initCombat = useCallback((attackerNodeId, defenderNodeId, attackForce, continueTo = null) => {
    const attacker = boardState[attackerNodeId];
    const defender = boardState[defenderNodeId];

    setPhase('COMBAT');
    setCombatState({
      attackerNodeId,
      defenderNodeId,
      attackerFaction: attacker.occupyingFaction,
      defenderFaction: defender.occupyingFaction,
      attackerTroops: attackForce,
      defenderTroops: defender.troops,
      continueTo, // if set: after winning, survivors march on to this node (road block)
      log: [`Bose de Combate: ${graph[attackerNodeId].name} vs ${graph[defenderNodeId].name}`]
    });
  }, [boardState, graph]);

  // Trigger Conquest Screen
  // attackerNodeId: where to return troops on roll=1 (null = stay in place)
  const initConquest = useCallback((nodeId, invadingForce, attackerNodeId = null) => {
    setPhase('CONQUER');
    setConquestState({
      nodeId,
      invadingForce,
      attackerNodeId,
      log: [`Iniciando asalto a base neutral ${graph[nodeId].name}`]
    });
  }, [graph]);

  // Trigger Siege Screen (attacking a base that has shields)
  const initSiege = useCallback((attackerNodeId, defenderNodeId, attackForce) => {
    setPhase('SIEGE');
    setSiegeState({
      attackerNodeId,
      defenderNodeId,
      attackForce,
      shields: boardState[defenderNodeId]?.shields || 0,
    });
  }, [boardState]);

  // Resolve the siege roll: 1→-1 shield, 2-3→-2, 4-6→-3 (all).
  // If shields remain → attack fails, troops retreat to origin.
  // If all shields fall → open melee combat.
  const executeSiegeRoll = useCallback((rollValue = null) => {
    if (!siegeState) return;
    SoundManager.playRoll();
    const roll = rollValue || Math.floor(Math.random() * 6) + 1;
    const { attackerNodeId, defenderNodeId, attackForce } = siegeState;
    const currentPlayer = players[currentTurn];
    const destName = graph[defenderNodeId]?.name ?? 'la base';
    const before = boardState[defenderNodeId]?.shields || 0;
    const destroyed = roll === 1 ? 1 : roll <= 3 ? 2 : 3;
    const remaining = Math.max(0, before - destroyed);

    const newBoard = { ...boardState, [defenderNodeId]: { ...boardState[defenderNodeId], shields: remaining } };

    if (remaining > 0) {
      // Assault repelled: attacking troops retreat to their origin.
      if (newBoard[attackerNodeId]) {
        newBoard[attackerNodeId] = { ...newBoard[attackerNodeId], troops: newBoard[attackerNodeId].troops + attackForce };
      }
      setBoardState(newBoard);
      setSiegeState(null);
      addLog(`🛡️ ASEDIO (dado ${roll}): destruidos ${destroyed} escudo(s) en ${destName}, aún resisten ${remaining}. El asalto se repliega.`, 'error');
      SoundManager.playSiegeFail?.();
      setPhase('MOVE');
      resolvePostMovement(newBoard);
    } else {
      // Breach! All shields down → melee combat.
      setBoardState(newBoard);
      setSiegeState(null);
      addLog(`💥 ASEDIO (dado ${roll}): ¡murallas derribadas en ${destName}! Comienza el combate.`, 'success');
      SoundManager.playExplosion?.();
      initCombat(attackerNodeId, defenderNodeId, attackForce);
    }
  }, [siegeState, boardState, players, currentTurn, graph, addLog, resolvePostMovement, initCombat]);

  // Find the first NOT-YET-passed enemy (non-allied) road cell crossed toward a destination.
  const findCrossingConflict = useCallback((originId, destId, faction, skip = []) => {
    const path = findShortestPath(graph, originId, destId) || [];
    for (let i = 1; i < path.length - 1; i++) { // skip origin & destination
      const pid = path[i];
      if (skip.includes(pid)) continue;
      const pn = graph[pid];
      const ps = boardState[pid];
      if (!pn || !ps) continue;
      if (!['path', 'surprise'].includes(pn.type)) continue;
      if (ps.occupyingFaction === null || ps.occupyingFaction === faction) continue;
      if (areAllied(faction, ps.occupyingFaction)) continue;
      return pid;
    }
    return null;
  }, [graph, boardState, areAllied]);

  // Start a road-crossing negotiation (defender decides pass/block).
  // `passed` carries the cells already resolved earlier in the same move.
  const initNegotiation = useCallback((info) => {
    const defender = players.find((p) => p.faction === info.defenderFaction);
    const defenderIsBot = defender?.isBot;
    const deadline = (isOnline && !defenderIsBot) ? Date.now() + 15000 : null;
    setPhase('NEGOTIATION');
    setNegotiationState({ passed: [], ...info, deadline, response: null });
    const attackerName = players.find((p) => p.faction === info.attackerFaction)?.name ?? 'Atacante';
    addLog(`🚧 ${attackerName.toUpperCase()} intenta cruzar por ${graph[info.conflictId]?.name} (${defender?.name}). Esperando decisión…`, 'info');
  }, [isOnline, players, graph, addLog]);

  // Resolve a movement toward a destination. Re-checks the route for enemy road
  // cells (skipping already-passed ones) so a platoon fights/negotiates EVERY
  // enemy cell in its path. opts: { skip: [passed cells], continueTo: {toId, passed} }.
  const resolveMoveTo = useCallback((originId, destId, troops, opts = {}) => {
    const { skip = [], continueTo = null } = opts;
    const cp = players[currentTurn];
    const originState = boardState[originId];
    const originType = graph[originId]?.type;
    const destState = boardState[destId];
    const destNode = graph[destId];
    if (!originState || !destState) return;

    // Road crossing: negotiate the next not-yet-passed enemy road cell first.
    const conflict = findCrossingConflict(originId, destId, cp.faction, skip);
    if (conflict) {
      initNegotiation({
        originId, conflictId: conflict, destId, troops,
        attackerFaction: cp.faction, defenderFaction: boardState[conflict].occupyingFaction,
        passed: skip,
      });
      return;
    }

    const remaining = originState.troops - troops;
    const board = {
      ...boardState,
      [originId]: {
        ...originState,
        troops: remaining,
        occupyingFaction: (['path', 'surprise'].includes(originType) && remaining <= 0) ? null : originState.occupyingFaction,
      },
    };

    // Empty or friendly destination
    if (destState.occupyingFaction === null || destState.occupyingFaction === cp.faction) {
      if ((destNode.type === 'center' || destNode.type === 'neutral') && destState.occupyingFaction === null) {
        setBoardState(board);
        initConquest(destId, troops, originId);
      } else {
        board[destId] = {
          ...destState,
          occupyingFaction: cp.faction,
          troops: (destState.occupyingFaction === cp.faction ? destState.troops : 0) + troops,
        };
        setBoardState(board);
        addLog(`${cp.name.toUpperCase()} desplazó pelotón a ${destNode.name}.`, 'info');
        if (destNode.type === 'surprise') {
          setPhase('SURPRISE');
          setSurpriseState({ nodeId: destId });
        } else {
          resolvePostMovement(board);
        }
      }
      return;
    }

    // Enemy destination
    if (destState.troops <= 0) {
      board[destId] = { occupyingFaction: cp.faction, troops, isSieged: false, shields: 0 };
      setBoardState(board);
      addLog(`${cp.name.toUpperCase()} tomó ${destNode.name} sin resistencia.`, 'info');
      resolvePostMovement(board);
      return;
    }
    const destIsBase = ['hq', 'neutral', 'center'].includes(destNode.type);
    setBoardState(board);
    // Reactive SUPER DEFENSE: if the defender holds a superdef card and this is a
    // base attack, prompt them to stop the attack before combat/siege.
    const defenderCanDefend = destIsBase && (hands[destState.occupyingFaction] || []).includes('superdef');
    if (defenderCanDefend) {
      const defender = players.find((p) => p.faction === destState.occupyingFaction);
      const deadline = (isOnline && !defender?.isBot) ? Date.now() + 15000 : null;
      setPhase('DEFENSE');
      setDefenseState({
        originId, destId, troops, continueTo,
        siege: (destState.shields || 0) > 0,
        defenderFaction: destState.occupyingFaction,
        deadline, response: null,
      });
      addLog(`🛡️ ${cp.name.toUpperCase()} ataca ${destNode.name}. ¡${defender?.name} puede usar SUPER DEFENSA!`, 'info');
      return;
    }
    if (destIsBase && (destState.shields || 0) > 0) {
      initSiege(originId, destId, troops); // fortified → siege first
    } else {
      initCombat(originId, destId, troops, continueTo);
    }
  }, [players, currentTurn, boardState, graph, hands, isOnline, findCrossingConflict, initNegotiation, initConquest, initCombat, initSiege, resolvePostMovement, addLog]);

  // Defender's answer to a Super Defense prompt: 'use' (stop the attack) or 'skip'.
  const respondDefense = useCallback((response) => {
    setDefenseState((prev) => (prev ? { ...prev, response } : prev));
  }, []);

  // Resolve the defense prompt (attacker-authoritative or on timeout). Null = skip.
  const resolveDefense = useCallback(() => {
    if (!defenseState) return;
    const { originId, destId, troops, continueTo, siege, defenderFaction, response } = defenseState;
    const effective = response || 'skip';
    setDefenseState(null);
    setPhase('MOVE');
    if (effective === 'use') {
      // Consume one superdef card; the attack is repelled, attacker retreats to origin.
      setHands((prev) => {
        const h = [...(prev[defenderFaction] || [])];
        const i = h.indexOf('superdef');
        if (i >= 0) h.splice(i, 1);
        return { ...prev, [defenderFaction]: h };
      });
      const defender = players.find((p) => p.faction === defenderFaction);
      const newBoard = { ...boardState };
      if (newBoard[originId]) newBoard[originId] = { ...newBoard[originId], troops: newBoard[originId].troops + troops };
      setBoardState(newBoard);
      addLog(`🛡️ ¡SUPER DEFENSA! ${defender?.name.toUpperCase()} rechaza el ataque a ${graph[destId]?.name}. Las tropas se repliegan.`, 'success');
      SoundManager.playSiegeFail?.();
      resolvePostMovement(newBoard);
    } else {
      // Not used → proceed with the original attack.
      if (siege) initSiege(originId, destId, troops);
      else initCombat(originId, destId, troops, continueTo);
    }
  }, [defenseState, boardState, players, graph, addLog, initSiege, initCombat, resolvePostMovement]);

  // Defender's answer: 'pass' (let through) or 'block' (fight).
  const respondNegotiation = useCallback((response) => {
    setNegotiationState((prev) => (prev ? { ...prev, response } : prev));
  }, []);

  // Resolve the negotiation (attacker-authoritative, or on timeout). Null response = block.
  const resolveNegotiation = useCallback(() => {
    if (!negotiationState) return;
    const { originId, destId, conflictId, troops, response, passed = [] } = negotiationState;
    const effective = response || 'block';
    const nowPassed = [...passed, conflictId];
    setNegotiationState(null);
    setPhase('MOVE');
    if (effective === 'pass') {
      addLog('✅ Paso franco concedido. El pelotón continúa.', 'info');
      // Continue toward the destination, skipping this (still-occupied) cell.
      resolveMoveTo(originId, destId, troops, { skip: nowPassed });
    } else {
      addLog('⛔ ¡Bloqueo! Combate en la casilla de cruce.', 'error');
      // Fight at the conflict cell; if we win, survivors march on to the destination
      // and keep fighting any remaining enemy cells on the way.
      const onward = (destId && destId !== conflictId) ? { toId: destId, passed: nowPassed } : null;
      resolveMoveTo(originId, conflictId, troops, { skip: passed, continueTo: onward });
    }
  }, [negotiationState, resolveMoveTo, addLog]);

  // Handle Node selection / Movement execution
  const handleNodeClick = useCallback((nodeId, customTroops = null) => {
    const currentPlayer = players[currentTurn];
    if (currentPlayer.isBot) return; // Ignore clicks during bot turns

    const node = graph[nodeId];
    const state = boardState[nodeId];

    // --- REDISTRIBUTE PHASE ---
    if (phase === 'REDISTRIBUTE') {
      // Move to highlighted adjacent friendly node
      if (selectedNode && highlightedNodes.includes(nodeId)) {
        const originState = boardState[selectedNode];
        const originNode = graph[selectedNode];
        const isOriginBase = originNode.type === 'hq' || originNode.type === 'neutral' || originNode.type === 'center';
        const maxFromOrigin = isOriginBase ? originState.troops - 1 : originState.troops;
        const moveTroops = customTroops !== null ? Math.min(Math.max(1, customTroops), maxFromOrigin) : maxFromOrigin;
        const remainingRedist = originState.troops - moveTroops;
        const newBoard = {
          ...boardState,
          [selectedNode]: {
            ...originState,
            troops: remainingRedist,
            // Path/surprise nodes with 0 troops become neutral (free)
            occupyingFaction: (['path', 'surprise'].includes(graph[selectedNode]?.type) && remainingRedist <= 0) ? null : originState.occupyingFaction
          },
          [nodeId]: { ...state, troops: state.troops + moveTroops }
        };
        setBoardState(newBoard);
        addLog(`🔄 ${currentPlayer.name}: ${moveTroops} tropas de ${graph[selectedNode].name} → ${node.name}.`, 'info');
        SoundManager.playMove();
        setSelectedNode(null);
        setHighlightedNodes([]);
        return;
      }

      // Select / re-select origin (any friendly node with movable troops)
      if (state.occupyingFaction === currentPlayer.faction && nodeId !== selectedNode) {
        const isBase = node.type === 'hq' || node.type === 'neutral' || node.type === 'center';
        const maxMove = isBase ? state.troops - 1 : state.troops;
        if (maxMove < 1) { addLog("No hay tropas disponibles para redistribuir aquí.", "error"); return; }
        SoundManager.playClick();
        setSelectedNode(nodeId);

        // BFS: traverse through unoccupied paths AND friendly nodes, stop at enemy nodes
        // Destinations must be friendly-occupied
        const reachable = new Set();
        const bfsQueue = [nodeId];
        const bfsVisited = new Set([nodeId]);
        while (bfsQueue.length > 0) {
          const curr = bfsQueue.shift();
          for (const neighbor of (graph[curr]?.neighbors ?? [])) {
            if (bfsVisited.has(neighbor)) continue;
            const nState = boardState[neighbor];
            const isEnemy = nState?.occupyingFaction !== null && nState.occupyingFaction !== currentPlayer.faction;
            if (isEnemy) continue; // enemy node blocks passage
            bfsVisited.add(neighbor);
            bfsQueue.push(neighbor);
            if (nState?.occupyingFaction === currentPlayer.faction) reachable.add(neighbor);
          }
        }
        setHighlightedNodes([...reachable]);
        if (reachable.size === 0) addLog("No hay territorio propio conectado desde aquí.", "error");
        return;
      }

      setSelectedNode(null);
      setHighlightedNodes([]);
      return;
    }

    // --- RECRUIT PHASE ---
    if (phase === 'RECRUIT') {
      const isBase = node.type === 'hq' || node.type === 'neutral' || node.type === 'center';
      if (state.occupyingFaction === currentPlayer.faction && isBase) {
        // Deploy the selected amount (allows splitting across several bases)
        const deployCount = customTroops !== null
          ? Math.min(Math.max(1, customTroops), recruitmentTroops)
          : recruitmentTroops;
        reinforceNode(nodeId, deployCount);
      } else if (!isBase || state.occupyingFaction !== currentPlayer.faction) {
        addLog("Solo puedes reforzar tus propias bases (resaltadas en el mapa).", 'error');
      }
      return;
    }

    // --- MOVE PHASE ---
    if (phase === 'MOVE') {
      // If we clicked on a siege node to roll for conquest instead of standard move
      if (state.occupyingFaction === currentPlayer.faction && state.isSieged) {
        SoundManager.playClick();
        initConquest(nodeId, state.troops, nodeId); // origin = same node (stay if roll=1)
        return;
      }

      // If no die rolled yet, cannot move
      if (diceRoll === null) {
        addLog("Lanza el dado de movimiento primero.", "error");
        return;
      }

      // Select origin platoon
      if (state.occupyingFaction === currentPlayer.faction) {
        const isBase = node.type === 'hq' || node.type === 'neutral' || node.type === 'center';
        if (isBase && state.troops <= 1) {
          addLog("ERROR: Las bases deben mantener al menos 1 tropa de guarnición.", "error");
          return;
        }
        if (state.troops < 1) {
          addLog("ERROR: No hay tropas en esta posición.", "error");
          return;
        }
        
        SoundManager.playClick();
        setSelectedNode(nodeId);
        const satBases = Object.keys(boardState).filter(id => {
          const n = graph[id]; const s = boardState[id];
          return s?.occupyingFaction === currentPlayer.faction && (n.type === 'hq' || n.type === 'neutral');
        }).length;
        const targets = getNodesAtDistance(graph, nodeId, diceRoll).filter(
          tid => graph[tid]?.type !== 'center' || satBases >= 3
        );
        setHighlightedNodes(targets);
        
        if (targets.length === 0) {
          addLog("No hay rutas viables desde esta posición.", "error");
        }
        return;
      }

      // Execute movement if a highlighted target is clicked
      if (selectedNode && highlightedNodes.includes(nodeId)) {
        const originState = boardState[selectedNode];
        const originNode = graph[selectedNode];
        const isBase = originNode.type === 'hq' || originNode.type === 'neutral' || originNode.type === 'center';
        const maxMove = isBase ? originState.troops - 1 : originState.troops;
        const moveTroops = customTroops !== null ? Math.min(Math.max(1, customTroops), maxMove) : maxMove;

        const destState = boardState[nodeId];

        // Block attack on allied faction (only if the destination itself is the ally)
        if (destState.occupyingFaction !== null && destState.occupyingFaction !== currentPlayer.faction
            && areAllied(currentPlayer.faction, destState.occupyingFaction)) {
          const allyName = players.find(p => p.faction === destState.occupyingFaction)?.name ?? 'aliado';
          addLog(`🤝 ALIANZA ACTIVA: No puedes atacar a ${allyName}. Rompe la alianza primero.`, 'error');
          setSelectedNode(null);
          setHighlightedNodes([]);
          return;
        }

        // NÚCLEO requires 3 satellite bases (HQ + neutral, not center itself)
        if (node.type === 'center') {
          const satBases = Object.keys(boardState).filter(id => {
            const n = graph[id]; const s = boardState[id];
            return s?.occupyingFaction === currentPlayer.faction && (n.type === 'hq' || n.type === 'neutral');
          }).length;
          if (satBases < 3) {
            addLog(`⛔ NÚCLEO BLOQUEADO: Necesitas controlar 3 bases satélite antes de poder atacar el NÚCLEO (tienes ${satBases}/3).`, 'error');
            setSelectedNode(null);
            setHighlightedNodes([]);
            return;
          }
        }

        SoundManager.playMove();

        // resolveMoveTo re-checks the route for enemy road cells and negotiates
        // each one (fighting through all of them) before resolving the destination.
        resolveMoveTo(selectedNode, nodeId, moveTroops);

        setSelectedNode(null);
        setHighlightedNodes([]);
      } else {
        // Deselect or click elsewhere
        setSelectedNode(null);
        setHighlightedNodes([]);
      }
    }
  }, [phase, currentTurn, players, boardState, diceRoll, selectedNode, highlightedNodes, graph, reinforceNode, addLog, recruitmentTroops, areAllied, findCrossingConflict, initNegotiation, resolveMoveTo, initConquest]);

  // --- SURPRISE CELL: draw a card. Troops → apply delta; 💣 bomb → pick a base to
  //     wipe; 👑 nucleo → instant victory. Then continue the turn. ---
  const executeSurpriseDraw = useCallback((card = null) => {
    if (!surpriseState) return;
    const drawn = card || (() => { const d = buildSurpriseDeck(brutalCards); return d[Math.floor(Math.random() * d.length)]; })();
    const { nodeId } = surpriseState;
    const currentPlayer = players[currentTurn];
    const nodeName = graph[nodeId]?.name ?? 'casilla sorpresa';

    // Brutal cards go to the drawer's SECRET HAND (played later; superdef is reactive).
    if (BRUTAL_CARD_TYPES.includes(drawn.t)) {
      const faction = currentPlayer.faction;
      setHands((prev) => ({ ...prev, [faction]: [...(prev[faction] || []), drawn.t] }));
      const info = CARD_INFO[drawn.t];
      addLog(`🃏 ${currentPlayer?.name.toUpperCase()} consiguió una carta: ${info.icon} ${info.name}.`, 'success');
      setSurpriseState(null);
      setPhase('MOVE');
      resolvePostMovement(boardState);
      return;
    }

    // Troop card (default)
    const v = drawn.v;
    const state = boardState[nodeId];
    const newBoard = { ...boardState };
    const newTroops = (state?.troops ?? 0) + v;
    if (newTroops <= 0) {
      newBoard[nodeId] = { occupyingFaction: null, troops: 0, isSieged: false, shields: 0 };
      addLog(`🃏 SORPRESA (${v}): ¡El pelotón de ${currentPlayer?.name.toUpperCase()} fue aniquilado en ${nodeName}!`, 'error');
    } else {
      newBoard[nodeId] = { ...state, troops: newTroops };
      if (v > 0) addLog(`🃏 SORPRESA (+${v}): ¡Refuerzos inesperados para ${currentPlayer?.name.toUpperCase()} en ${nodeName}!`, 'success');
      else addLog(`🃏 SORPRESA (${v}): Emboscada — ${currentPlayer?.name.toUpperCase()} pierde tropas en ${nodeName}.`, 'error');
    }

    setBoardState(newBoard);
    setSurpriseState(null);
    setPhase('MOVE');
    resolvePostMovement(newBoard);
  }, [surpriseState, brutalCards, boardState, players, currentTurn, graph, addLog, resolvePostMovement, countStrategicBases, getTotalTroops]);

  // --- ATOMIC BOMB: wipe the chosen base. Playing a card does NOT consume the
  //     player's move, so afterwards we just return to MOVE (turn continues). ---
  const executeBomb = useCallback((targetNodeId) => {
    if (!bombState) return;
    const currentPlayer = players[currentTurn];
    const node = graph[targetNodeId];
    const isBase = node && (node.type === 'hq' || node.type === 'neutral' || node.type === 'center');
    if (!isBase) { addLog("La bomba solo puede caer sobre una base (HQ, neutral o núcleo).", "error"); return; }

    const newBoard = { ...boardState, [targetNodeId]: { occupyingFaction: null, troops: 0, isSieged: false, shields: 0 } };
    setBoardState(newBoard);
    setBombState(null);
    addLog(`💥 BOMBA ATÓMICA: ${currentPlayer?.name.toUpperCase()} arrasó ${node.name}. ¡Tropas y escudos destruidos!`, 'error');
    SoundManager.playExplosion?.();
    const over = checkVictoryConditions(newBoard);
    if (!over) setPhase('MOVE'); // turn continues (player can still roll/move)
  }, [bombState, boardState, players, currentTurn, graph, addLog, checkVictoryConditions]);

  // --- PLAY an offensive card from your hand (on your turn). Consumes the card. ---
  const playCard = useCallback((cardType) => {
    const cp = players[currentTurn];
    if (!cp) return;
    const faction = cp.faction;
    const hand = hands[faction] || [];
    if (!hand.includes(cardType)) return;
    if (CARD_INFO[cardType]?.kind !== 'attack') return; // superdef is reactive only

    const consume = () => setHands((prev) => {
      const h = [...(prev[faction] || [])];
      const i = h.indexOf(cardType);
      if (i >= 0) h.splice(i, 1);
      return { ...prev, [faction]: h };
    });

    if (cardType === 'nucleo') {
      consume();
      addLog(`👑 ${cp.name.toUpperCase()} juega VICTORIA DEL NÚCLEO y GANA la partida.`, 'success');
      SoundManager.playConquest();
      setPhase('GAME_OVER');
      return;
    }
    if (cardType === 'endgame') {
      consume();
      const score = (f) => countStrategicBases(f, boardState) * 1000 + getTotalTroops(f, boardState);
      const active = players.filter((p) => !p.eliminated);
      let winner = active[0] || players[0];
      active.forEach((p) => { if (score(p.faction) > score(winner.faction)) winner = p; });
      addLog(`🏁 ${cp.name.toUpperCase()} juega FIN DE PARTIDA. Gana ${winner.name.toUpperCase()} (${countStrategicBases(winner.faction, boardState)} bases).`, 'success');
      SoundManager.playConquest();
      setPhase('GAME_OVER');
      return;
    }
    if (cardType === 'bomb') {
      consume();
      setPhase('BOMB');
      setBombState({});
      addLog(`💣 ${cp.name.toUpperCase()} juega BOMBA ATÓMICA. Elige una base para arrasar.`, 'error');
    }
  }, [players, currentTurn, hands, boardState, countStrategicBases, getTotalTroops, addLog]);

  // --- RESOLVE NEUTRAL BASE CONQUEST (5-6 captures, 1-4 sieges) ---
  const executeConquestRoll = useCallback((rollValue = null) => {
    if (!conquestState) return;

    SoundManager.playRoll();
    const roll = rollValue || Math.floor(Math.random() * 6) + 1;
    const { nodeId, invadingForce, attackerNodeId } = conquestState;
    const currentPlayer = players[currentTurn];
    const nodeName = graph[nodeId].name;
    const newBoard = { ...boardState };

    if (roll >= 2) {
      // Roll 2-6: capture the base
      const bonus = captureBonus(graph[nodeId]?.type);
      newBoard[nodeId] = { occupyingFaction: currentPlayer.faction, troops: invadingForce + bonus, isSieged: false };
      setBoardState(newBoard);
      addLog(`CONQUISTA: ${currentPlayer.name.toUpperCase()} capturó ${nodeName} (dado ${roll})${bonus > 0 ? ` +${bonus} tropas` : ''}.`, 'success');
      SoundManager.playConquest();
    } else {
      // Roll 1: fail — troops retreat to attacker origin (or stay if siege resolution)
      const originIsSame = !attackerNodeId || attackerNodeId === nodeId;
      if (!originIsSame && newBoard[attackerNodeId]) {
        newBoard[attackerNodeId] = { ...newBoard[attackerNodeId], troops: newBoard[attackerNodeId].troops + invadingForce };
        // Leave destination empty (or restore siege state if it had one)
        if (boardState[nodeId]?.isSieged) {
          newBoard[nodeId] = { ...boardState[nodeId] };
        }
        // else: destination was already empty, leave it empty (no change needed)
      }
      // If siege resolution (originIsSame): troops stay in place, keep siege state
      setBoardState(newBoard);
      addLog(`ASALTO FALLIDO: Dado 1 — las tropas retroceden a su posición.`, 'error');
      SoundManager.playSiegeFail?.();
    }

    setConquestState(null);
    setTimeout(() => {
      setPhase('MOVE');
      resolvePostMovement(newBoard);
    }, 1000);
  }, [conquestState, boardState, players, currentTurn, graph, captureBonus, addLog, resolvePostMovement]);

  // --- RESOLVE COMBAT ROUND (1 die each, highest wins) ---
  const executeCombatRound = useCallback((autoResolve = false) => {
    if (!combatState) return;

    const { attackerNodeId, defenderNodeId } = combatState;
    let attTroops = combatState.attackerTroops;
    let defTroops = combatState.defenderTroops;
    const attFaction = combatState.attackerFaction;
    const defFaction = combatState.defenderFaction;

    const roundLogs = [];
    let lastAttRoll = null;
    let lastDefRoll = null;

    const simulateRound = () => {
      const attRoll = Math.floor(Math.random() * 6) + 1;
      const defRoll = Math.floor(Math.random() * 6) + 1;
      lastAttRoll = attRoll;
      lastDefRoll = defRoll;

      SoundManager.playLaser();

      if (attRoll > defRoll) {
        defTroops--;
        roundLogs.push(`⚔️ Ataque ${attRoll} vs Defensa ${defRoll} → Defensor pierde 1 tropa`);
      } else if (defRoll > attRoll) {
        attTroops--;
        roundLogs.push(`🛡️ Ataque ${attRoll} vs Defensa ${defRoll} → Atacante pierde 1 tropa`);
      } else {
        // Tie → defender holds
        attTroops--;
        roundLogs.push(`⚖️ Empate ${attRoll} vs ${defRoll} → Defensor aguanta, Atacante pierde 1`);
      }
    };

    if (autoResolve) {
      while (attTroops > 0 && defTroops > 0) {
        simulateRound();
      }
    } else {
      simulateRound();
    }

    const isBattleEnded = attTroops <= 0 || defTroops <= 0;

    // Update combat state — mark as ended so the bot auto-resolve useEffect doesn't re-trigger
    const newCombatState = {
      ...combatState,
      attackerTroops: attTroops,
      defenderTroops: defTroops,
      lastAttRoll,
      lastDefRoll,
      ended: isBattleEnded,
      log: [...combatState.log, ...roundLogs]
    };

    setCombatState(newCombatState);

    if (isBattleEnded) {
      SoundManager.playExplosion();
      const newBoard = { ...boardState };
      const currentPlayer = players[currentTurn];
      const targetName = graph[defenderNodeId].name;

      const continueTo = combatState.continueTo; // { toId, passed } | null
      let advance = null; // set when the attacker should keep moving after winning a block

      if (defTroops <= 0 && attTroops > 0) {
        if (continueTo && continueTo.toId) {
          // Won a road block: clear the cell and keep the survivors there so the
          // dedicated effect can march them on toward the original destination.
          newBoard[defenderNodeId] = { occupyingFaction: attFaction, troops: attTroops, isSieged: false, shields: 0 };
          advance = { fromId: defenderNodeId, toId: continueTo.toId, passed: continueTo.passed || [] };
          addLog(`VICTORIA: ${currentPlayer.name.toUpperCase()} abrió paso en ${targetName} y continúa avanzando.`, 'success');
        } else {
          const bonus = captureBonus(graph[defenderNodeId]?.type);
          newBoard[defenderNodeId] = {
            occupyingFaction: attFaction,
            troops: attTroops + bonus,
            isSieged: false
          };
          addLog(`VICTORIA: ${currentPlayer.name.toUpperCase()} capturó ${targetName}${bonus > 0 ? ` +${bonus} tropas` : ''}.`, 'success');
        }
      } else {
        // Defender wins! Defending troops remain
        newBoard[defenderNodeId] = {
          ...boardState[defenderNodeId],
          troops: defTroops
        };
        addLog(`DERROTA EN COMBATE: Pelotón atacante destruido en ${targetName}. Defensores restantes: ${defTroops}.`, 'error');
      }

      setBoardState(newBoard);

      // Delay closing modal and moving forward
      setTimeout(() => {
        setCombatState(null);
        setPhase('MOVE');
        if (advance) {
          setPendingAdvance(advance); // continue the move to the original destination
        } else {
          resolvePostMovement(newBoard);
        }
      }, 1500);
    }
  }, [combatState, boardState, players, currentTurn, graph, addLog, resolvePostMovement]);

  // Attacker retreat — returns to nearest friendly base
  const retreatCombat = useCallback(() => {
    if (!combatState) return;
    const { attackerNodeId, attackerFaction, defenderNodeId, attackerTroops, defenderTroops } = combatState;
    const newBoard = { ...boardState };
    const currentPlayer = players[currentTurn];

    const retreatBase = findNearestFriendlyBase(attackerNodeId, attackerFaction, boardState) || attackerNodeId;
    newBoard[retreatBase] = { ...newBoard[retreatBase], troops: newBoard[retreatBase].troops + attackerTroops };
    newBoard[defenderNodeId] = { ...newBoard[defenderNodeId], troops: defenderTroops };

    setBoardState(newBoard);
    addLog(`RETIRADA TÁCTICA: ${currentPlayer.name.toUpperCase()} ordena retirada a ${graph[retreatBase].name}.`, 'info');
    SoundManager.playMove();
    setCombatState(null);
    setPhase('MOVE');
    resolvePostMovement(newBoard);
  }, [combatState, boardState, players, currentTurn, graph, addLog, resolvePostMovement, findNearestFriendlyBase]);

  // Defender retreat — flees to nearest friendly base, attacker takes the node
  const retreatDefender = useCallback(() => {
    if (!combatState) return;
    const { defenderNodeId, defenderFaction, attackerFaction, attackerTroops, defenderTroops } = combatState;
    const newBoard = { ...boardState };

    const retreatBase = findNearestFriendlyBase(defenderNodeId, defenderFaction, boardState);
    const defenderName = players.find(p => p.faction === defenderFaction)?.name ?? 'Defensor';

    if (retreatBase && retreatBase !== defenderNodeId) {
      newBoard[retreatBase] = { ...newBoard[retreatBase], troops: newBoard[retreatBase].troops + defenderTroops };
      addLog(`HUIDA DEFENSIVA: ${defenderName.toUpperCase()} retrocede a ${graph[retreatBase].name}.`, 'info');
    } else {
      addLog(`HUIDA DEFENSIVA: ${defenderName.toUpperCase()} intenta huir pero queda atrapado. ¡Tropas perdidas!`, 'error');
    }

    // Attacker claims the abandoned node
    newBoard[defenderNodeId] = { occupyingFaction: attackerFaction, troops: attackerTroops, isSieged: false };
    addLog(`CAPTURA: ${graph[defenderNodeId].name} tomada por el atacante.`, 'success');
    SoundManager.playConquest();

    setBoardState(newBoard);
    setCombatState(null);
    setPhase('MOVE');
    resolvePostMovement(newBoard);
  }, [combatState, boardState, players, graph, addLog, findNearestFriendlyBase, resolvePostMovement]);


  // --- BOT AI ROTATION TIMER/EFFECT ---
  useEffect(() => {
    if (phase === 'SETUP' || phase === 'GAME_OVER' || combatState || conquestState || surpriseState || siegeState || negotiationState || pendingAdvance || bombState || defenseState) return;
    if (!botAuthority) return; // online: only the host drives bots

    const currentPlayer = players[currentTurn];
    if (!currentPlayer || !currentPlayer.isBot) return;

    // AI Bot execution block
    const botTimer = setTimeout(() => {
      // Bots fortify during RECRUIT (below); they never use the human FORTIFY step.
      if (phase === 'FORTIFY') { setPhase('MOVE'); return; }

      // 0. REDISTRIBUTE PHASE — bots skip
      if (phase === 'REDISTRIBUTE') {
        endTurn();
        return;
      }

      // 1. RECRUIT PHASE
      if (phase === 'RECRUIT') {
        // Find all controlled nodes that are bases (HQs, conquered neutrals, or center)
        const myBases = Object.keys(boardState).filter(nodeId => {
          const state = boardState[nodeId];
          const node = graph[nodeId];
          return state.occupyingFaction === currentPlayer.faction &&
            (node.type === 'hq' || node.type === 'neutral' || node.type === 'center');
        });

        if (myBases.length === 0) {
          // No bases owned (extreme edge case before elimination), just advance
          setRecruitmentTroops(0);
          setPhase('MOVE');
          return;
        }

        // Optionally fortify a valuable base first (≥10 total troops, base has ≥6 troops
        // to pay the 5-soldier cost, <3 shields). Own tick (return) to avoid state clobber.
        if (!shieldPurchasedThisTurn && getTotalTroops(currentPlayer.faction) >= 10) {
          const priority = (t) => (graph[t].type === 'center' ? 0 : graph[t].type === 'hq' ? 1 : 2);
          const shieldTarget = myBases
            .filter(id => (boardState[id].shields || 0) < 3 && boardState[id].troops >= 6)
            .sort((a, b) => (priority(a) - priority(b)) || (boardState[b].troops - boardState[a].troops))[0];
          if (shieldTarget) {
            placeShield(shieldTarget);
            return;
          }
        }

        // Reinforce the weakest base with the remaining recruits
        let weakestBase = myBases[0];
        let minTroops = boardState[weakestBase].troops;
        myBases.forEach(baseId => {
          if (boardState[baseId].troops < minTroops) {
            minTroops = boardState[baseId].troops;
            weakestBase = baseId;
          }
        });
        reinforceNode(weakestBase, recruitmentTroops);
      }

      // 2. MOVE PHASE
      if (phase === 'MOVE') {
        // Play an offensive card from hand first (before rolling): win-now cards, else bomb.
        if (diceRoll === null) {
          const myHand = hands[currentPlayer.faction] || [];
          const totalBases = Object.keys(boardState).filter(id => {
            const n = graph[id]; const s = boardState[id];
            return s.occupyingFaction === currentPlayer.faction && ['hq','neutral','center'].includes(n.type);
          }).length;
          if (myHand.includes('nucleo')) { playCard('nucleo'); return; }
          if (myHand.includes('endgame') && totalBases >= 3) { playCard('endgame'); return; }
          if (myHand.includes('bomb')) { playCard('bomb'); return; } // → BOMB phase, bot auto-targets
        }
        if (diceRoll === null) {
          rollMovement();
          return;
        }

        // Find all nodes where bot has troops > 1
        const botTroopNodes = Object.keys(boardState).filter(nodeId => {
          const state = boardState[nodeId];
          return state.occupyingFaction === currentPlayer.faction && state.troops > 1 && !state.isSieged;
        });

        // AI also checks if it has any sieges
        const botSiegeNodes = Object.keys(boardState).filter(nodeId => {
          const state = boardState[nodeId];
          return state.occupyingFaction === currentPlayer.faction && state.isSieged;
        });

        // If sieging, bot has a 50% chance to roll for conquest instead of standard movement
        if (botSiegeNodes.length > 0 && (botTroopNodes.length === 0 || Math.random() > 0.5)) {
          const siegeNodeId = botSiegeNodes[0];
          addLog(`BOT ACCIÓN: ${currentPlayer.name.toUpperCase()} intenta consolidar asedio en ${graph[siegeNodeId].name}.`);
          setTimeout(() => {
            initConquest(siegeNodeId, boardState[siegeNodeId].troops, siegeNodeId);
            // auto-resolve handled by the dedicated useEffect below
          }, 1000);
          return;
        }

        if (botTroopNodes.length === 0) {
          // No units available to move, end turn
          resolvePostMovement();
          return;
        }

        // Count satellite bases for NÚCLEO access check
        const botSatBases = Object.keys(boardState).filter(id => {
          const n = graph[id]; const s = boardState[id];
          return s.occupyingFaction === currentPlayer.faction && (n.type === 'hq' || n.type === 'neutral');
        }).length;

        // Evaluate all possible moves
        const possibleMoves = [];

        botTroopNodes.forEach(originId => {
          const targets = getNodesAtDistance(graph, originId, diceRoll);
          targets.forEach(targetId => {
            const destState = boardState[targetId];
            const destNode = graph[targetId];
            const originTroops = boardState[originId].troops - 1;

            let score = 10; // Base score

            if (destState.occupyingFaction === null) {
              if (destNode.type === 'neutral') {
                score += 30; // High value to capture neutral bases
              } else if (destNode.type === 'center') {
                score += botSatBases >= 3 ? 50 : -200; // Center only if 3+ satellite bases
              } else {
                score += 5; // Move to empty path
              }
            } else if (destState.occupyingFaction === currentPlayer.faction) {
              score += 12; // Merging troops
            } else {
              // Enemy occupied
              const enemyTroops = destState.troops;
              if (originTroops > enemyTroops + 1) {
                score += 40; // Attack weak enemy!
              } else if (originTroops === enemyTroops) {
                score += 15; // Even fight
              } else {
                score -= 30; // Suicide fight
              }
            }

            possibleMoves.push({ originId, targetId, score });
          });
        });

        if (possibleMoves.length > 0) {
          // Sort and pick top score
          possibleMoves.sort((a, b) => b.score - a.score);
          const bestMove = possibleMoves[0];

          addLog(`BOT MOVIMIENTO: ${currentPlayer.name.toUpperCase()} selecciona ruta desde ${graph[bestMove.originId].name}.`);

          setTimeout(() => {
            const moveTroops = boardState[bestMove.originId].troops - 1;
            // resolveMoveTo handles road-crossing negotiation (all enemy cells),
            // plus empty/friendly/conquest/combat/siege/surprise at the destination.
            resolveMoveTo(bestMove.originId, bestMove.targetId, moveTroops);
          }, 1000);
        } else {
          // No possible moves (all blocked), end turn
          resolvePostMovement();
        }
      }
    }, 1200);

    return () => clearTimeout(botTimer);
  }, [
    phase,
    currentTurn,
    players,
    boardState,
    diceRoll,
    graph,
    combatState,
    conquestState,
    reinforceNode,
    recruitmentTroops,
    rollMovement,
    initConquest,
    executeConquestRoll,
    initCombat,
    executeCombatRound,
    resolvePostMovement,
    addLog,
    surpriseState,
    siegeState,
    negotiationState,
    pendingAdvance,
    bombState,
    defenseState,
    hands,
    botAuthority,
    shieldPurchasedThisTurn,
    placeShield,
    getTotalTroops,
    findCrossingConflict,
    initNegotiation,
    resolveMoveTo,
    playCard,
  ]);

  // --- BOT AUTO-RESOLVE: Combat ---
  useEffect(() => {
    if (!combatState) return;
    if (!botAuthority) return; // online: only the host drives bots
    // Guard: don't re-trigger once battle is concluded (ended flag set by executeCombatRound)
    if (combatState.ended) return;
    const attacker = players.find(p => p.faction === combatState.attackerFaction);
    if (!attacker?.isBot) return;

    const timer = setTimeout(() => executeCombatRound(true), 900);
    return () => clearTimeout(timer);
  }, [combatState, executeCombatRound, players, botAuthority]);

  // --- BOT AUTO-RESOLVE: Conquest ---
  useEffect(() => {
    if (!conquestState) return;
    if (!botAuthority) return; // online: only the host drives bots
    const currentPlayer = players[currentTurn];
    if (!currentPlayer?.isBot) return;

    const timer = setTimeout(() => {
      const roll = Math.floor(Math.random() * 6) + 1;
      executeConquestRoll(roll);
    }, 900);
    return () => clearTimeout(timer);
  }, [conquestState, executeConquestRoll, players, currentTurn, botAuthority]);

  // --- BOT AUTO-RESOLVE: Surprise card ---
  useEffect(() => {
    if (!surpriseState) return;
    if (!botAuthority) return; // online: only the host drives bots
    const currentPlayer = players[currentTurn];
    if (!currentPlayer?.isBot) return;

    const timer = setTimeout(() => executeSurpriseDraw(), 1200);
    return () => clearTimeout(timer);
  }, [surpriseState, executeSurpriseDraw, players, currentTurn, botAuthority]);

  // --- BOT AUTO-RESOLVE: Atomic bomb (drop on the strongest ENEMY base) ---
  useEffect(() => {
    if (!bombState) return;
    if (!botAuthority) return; // online: only the host drives bots
    const currentPlayer = players[currentTurn];
    if (!currentPlayer?.isBot) return;

    const timer = setTimeout(() => {
      const enemyBases = Object.keys(boardState).filter((id) => {
        const n = graph[id]; const s = boardState[id];
        return s?.occupyingFaction != null && s.occupyingFaction !== currentPlayer.faction
          && (n.type === 'hq' || n.type === 'neutral' || n.type === 'center');
      });
      // Strongest enemy base (most troops + shields weight)
      enemyBases.sort((a, b) => (boardState[b].troops + (boardState[b].shields || 0) * 3) - (boardState[a].troops + (boardState[a].shields || 0) * 3));
      if (enemyBases.length > 0) executeBomb(enemyBases[0]);
      else { setBombState(null); setPhase('MOVE'); resolvePostMovement(boardState); }
    }, 1200);
    return () => clearTimeout(timer);
  }, [bombState, botAuthority, players, currentTurn, boardState, graph, executeBomb, resolvePostMovement]);

  // --- BOT AUTO-RESOLVE: Siege roll (attacker is a bot) ---
  useEffect(() => {
    if (!siegeState) return;
    if (!botAuthority) return; // online: only the host drives bots
    const attacker = players[currentTurn];
    if (!attacker?.isBot) return;

    const timer = setTimeout(() => executeSiegeRoll(), 900);
    return () => clearTimeout(timer);
  }, [siegeState, executeSiegeRoll, players, currentTurn, botAuthority]);

  // --- CONTINUE ADVANCE after winning a road block (survivors march on, and keep
  //     fighting/negotiating any remaining enemy cells until the destination) ---
  useEffect(() => {
    if (!pendingAdvance) return;
    const { fromId, toId, passed = [] } = pendingAdvance;
    setPendingAdvance(null);
    const troops = boardState[fromId]?.troops || 0;
    if (troops > 0 && toId && graph[toId]) {
      resolveMoveTo(fromId, toId, troops, { skip: passed }); // fresh boardState (post-combat)
    } else {
      resolvePostMovement(boardState);
    }
  }, [pendingAdvance, boardState, graph, resolveMoveTo, resolvePostMovement]);

  // --- BOT DEFENDER: decide a road negotiation on the host, with criterio ---
  // Blocks if it has at least as many troops at the conflict cell as the crosser.
  useEffect(() => {
    if (!negotiationState || negotiationState.response) return;
    if (!botAuthority) return; // only the host answers for bots
    const defender = players.find(p => p.faction === negotiationState.defenderFaction);
    if (!defender?.isBot) return;

    const timer = setTimeout(() => {
      const defTroops = boardState[negotiationState.conflictId]?.troops || 0;
      respondNegotiation(defTroops >= negotiationState.troops ? 'block' : 'pass');
    }, 1000);
    return () => clearTimeout(timer);
  }, [negotiationState, botAuthority, players, boardState, respondNegotiation]);

  // --- BOT DEFENDER: decide a Super Defense prompt on the host ---
  // Uses the card if the attack looks like it could take the base.
  useEffect(() => {
    if (!defenseState || defenseState.response) return;
    if (!botAuthority) return;
    const defender = players.find(p => p.faction === defenseState.defenderFaction);
    if (!defender?.isBot) return;

    const timer = setTimeout(() => {
      const defTroops = boardState[defenseState.destId]?.troops || 0;
      // Use it when the attacker force is at least the garrison (base in real danger).
      respondDefense(defenseState.troops >= defTroops ? 'use' : 'skip');
    }, 1000);
    return () => clearTimeout(timer);
  }, [defenseState, botAuthority, players, boardState, respondDefense]);

  // --- Highlight owned bases during RECRUIT for human player ---
  useEffect(() => {
    if (phase !== 'RECRUIT') return;
    const currentPlayer = players[currentTurn];
    if (!currentPlayer || currentPlayer.isBot) return;
    const ownedBases = Object.keys(boardState).filter(id => {
      const n = graph[id]; const s = boardState[id];
      return s?.occupyingFaction === currentPlayer.faction &&
             (n.type === 'hq' || n.type === 'neutral' || n.type === 'center');
    });
    setHighlightedNodes(ownedBases);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentTurn]); // only re-run at phase/turn boundary

  // ── Online sync: serialize / apply the full shared game state ──
  // selectedNode & highlightedNodes are intentionally NOT synced (local UI).
  const getSnapshot = useCallback(() => ({
    players, currentTurn, phase, boardState, diceRoll, sixCount,
    recruitmentTroops, logs, gameStarted, combatState, conquestState,
    surpriseState, siegeState, negotiationState, bombState, defenseState,
    hands, alliances, nucleoData, boardSize, brutalCards,
  }), [players, currentTurn, phase, boardState, diceRoll, sixCount,
       recruitmentTroops, logs, gameStarted, combatState, conquestState,
       surpriseState, siegeState, negotiationState, bombState, defenseState,
       hands, alliances, nucleoData, boardSize, brutalCards]);

  const hydrate = useCallback((snap) => {
    if (!snap) return;
    if (snap.players !== undefined) setPlayers(snap.players);
    if (snap.currentTurn !== undefined) setCurrentTurn(snap.currentTurn);
    if (snap.phase !== undefined) setPhase(snap.phase);
    if (snap.boardState !== undefined) setBoardState(snap.boardState);
    if (snap.diceRoll !== undefined) setDiceRoll(snap.diceRoll);
    if (snap.sixCount !== undefined) setSixCount(snap.sixCount);
    if (snap.recruitmentTroops !== undefined) setRecruitmentTroops(snap.recruitmentTroops);
    if (snap.logs !== undefined) setLogs(snap.logs);
    if (snap.gameStarted !== undefined) setGameStarted(snap.gameStarted);
    if (snap.combatState !== undefined) setCombatState(snap.combatState);
    if (snap.conquestState !== undefined) setConquestState(snap.conquestState);
    if (snap.surpriseState !== undefined) setSurpriseState(snap.surpriseState);
    if (snap.siegeState !== undefined) setSiegeState(snap.siegeState);
    if (snap.negotiationState !== undefined) setNegotiationState(snap.negotiationState);
    if (snap.bombState !== undefined) setBombState(snap.bombState);
    if (snap.defenseState !== undefined) setDefenseState(snap.defenseState);
    if (snap.hands !== undefined) setHands(snap.hands);
    if (snap.alliances !== undefined) setAlliances(snap.alliances);
    if (snap.nucleoData !== undefined) setNucleoData(snap.nucleoData);
    // Board layout config must match so every client rebuilds the same graph.
    if (snap.boardSize !== undefined) setBoardSize(snap.boardSize);
    if (snap.brutalCards !== undefined) setBrutalCards(snap.brutalCards);
    // Incoming state means someone else acted — clear our local selection.
    setSelectedNode(null);
    setHighlightedNodes([]);
  }, []);

  return {
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
    shieldPurchasedThisTurn,
    brutalCards,
    boardSize,
    alliances,
    nucleoData,
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
    addLog,
    getSnapshot,
    hydrate,
  };
}
