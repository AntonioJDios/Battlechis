import { useState, useEffect, useCallback } from 'react';
import { generateBoardGraph, getNodesAtDistance, findShortestPath, FACTIONS } from '../utils/boardGraph';
import { SoundManager } from '../components/SoundManager';

// Surprise card pool (Monopoly-style): troops gained/lost by the platoon landing on the cell
export const SURPRISE_CARDS = [+5, +3, +2, +1, -1, -2, -3];

export function useGameState(online = null) {
  // Online config (null = offline single-device play, unchanged behaviour):
  //   { isOnline: true, isHost: bool }
  // In online mode the HOST is the only client that runs bot logic, so bots
  // don't get executed (and pushed) by every device at once.
  const isOnline = online?.isOnline ?? false;
  const botAuthority = !isOnline || (online?.isHost ?? false); // may this device run bots?

  const [graph] = useState(() => generateBoardGraph());
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

  // Add a message to the tactical console log
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 100));
  }, []);

  // Initialize the game
  const startGame = useCallback((selectedPlayers) => {
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
    Object.keys(graph).forEach(nodeId => {
      const node = graph[nodeId];
      if (node.type === 'hq') {
        const owner = gamePlayers.find(p => p.faction === node.faction);
        if (owner) {
          initialBoard[nodeId] = {
            occupyingFaction: owner.faction,
            troops: 5,
            isSieged: false
          };
        } else {
          // Unassigned HQ starts as unoccupied base
          initialBoard[nodeId] = {
            occupyingFaction: null,
            troops: 2,
            isSieged: false
          };
        }
      } else {
        initialBoard[nodeId] = {
          occupyingFaction: null,
          troops: 0,
          isSieged: false
        };
      }
    });

    setBoardState(initialBoard);
    setCurrentTurn(0);
    setSixCount(0);
    setDiceRoll(null);
    setPhase('RECRUIT');
    setGameStarted(true);

    const firstPlayer = gamePlayers[0];
    const firstBases = Object.keys(initialBoard).filter(id => {
      const n = graph[id]; const s = initialBoard[id];
      return s?.occupyingFaction === firstPlayer.faction && (n.type === 'hq' || n.type === 'neutral' || n.type === 'center');
    }).length;
    const initialRecruits = Math.max(1, firstBases * 3);
    setRecruitmentTroops(initialRecruits);

    setLogs([]);
    addLog(`SISTEMA INICIADO: Modo ${gamePlayers.length} Comandantes.`, 'success');
    addLog(`TURNO DE: ${firstPlayer.name.toUpperCase()} (+${initialRecruits} Refuerzos).`, 'info');
    SoundManager.playConquest();
  }, [graph, addLog]);

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
      setPhase('MOVE');
      setHighlightedNodes([]);
      addLog("FASE DE MOVIMIENTO: Lanza el dado táctico.", "info");
    }
  }, [boardState, recruitmentTroops, players, currentTurn, phase, graph, addLog]);

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
  const initCombat = useCallback((attackerNodeId, defenderNodeId, attackForce) => {
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

        // Update origin node (leave remaining troops behind)
        const remainingMove = originState.troops - moveTroops;
        const updatedBoard = {
          ...boardState,
          [selectedNode]: {
            ...originState,
            troops: remainingMove,
            // Path/surprise nodes with 0 troops become neutral (free)
            occupyingFaction: (['path', 'surprise'].includes(graph[selectedNode]?.type) && remainingMove <= 0) ? null : originState.occupyingFaction
          }
        };

        SoundManager.playMove();

        // Check destination type
        const destState = boardState[nodeId];

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

        // 1. Destination is empty or friendly
        if (destState.occupyingFaction === null || destState.occupyingFaction === currentPlayer.faction) {
          // Empty base: always requires conquest roll (1=fail, 2-6=capture)
          if ((node.type === 'center' || node.type === 'neutral') && destState.occupyingFaction === null) {
            setBoardState(updatedBoard);
            initConquest(nodeId, moveTroops, selectedNode);
          } else {
            // Friendly merge or empty path node occupy
            updatedBoard[nodeId] = {
              occupyingFaction: currentPlayer.faction,
              troops: (destState.occupyingFaction === currentPlayer.faction ? destState.troops : 0) + moveTroops,
              isSieged: false
            };
            setBoardState(updatedBoard);
            addLog(`${currentPlayer.name.toUpperCase()} desplazó pelotón a ${node.name}.`, 'info');

            if (node.type === 'surprise') {
              // Landing on a surprise cell: draw a card before continuing
              setPhase('SURPRISE');
              setSurpriseState({ nodeId });
            } else {
              // Handle Roll again rules (Rule of 6)
              resolvePostMovement(updatedBoard);
            }
          }
        }
        // 2. Destination is enemy occupied (Path or Base)
        else {
          // Block attack on allied faction
          if (areAllied(currentPlayer.faction, destState.occupyingFaction)) {
            const allyName = players.find(p => p.faction === destState.occupyingFaction)?.name ?? 'aliado';
            addLog(`🤝 ALIANZA ACTIVA: No puedes atacar a ${allyName}. Rompe la alianza primero.`, 'error');
            setSelectedNode(null);
            setHighlightedNodes([]);
            return;
          }
          // Safety: node marked as owned but with 0 troops → free capture, no combat
          if (destState.troops <= 0) {
            updatedBoard[nodeId] = { occupyingFaction: currentPlayer.faction, troops: moveTroops, isSieged: false };
            setBoardState(updatedBoard);
            addLog(`${currentPlayer.name.toUpperCase()} tomó ${node.name} sin resistencia.`, 'info');
            resolvePostMovement(updatedBoard);
          } else {
            setBoardState(updatedBoard);
            initCombat(selectedNode, nodeId, moveTroops);
          }
        }

        setSelectedNode(null);
        setHighlightedNodes([]);
      } else {
        // Deselect or click elsewhere
        setSelectedNode(null);
        setHighlightedNodes([]);
      }
    }
  }, [phase, currentTurn, players, boardState, diceRoll, selectedNode, highlightedNodes, graph, reinforceNode, initCombat, initConquest, addLog, recruitmentTroops, resolvePostMovement, areAllied]);

  // --- SURPRISE CELL: draw a card, apply troops delta immediately, then continue turn ---
  const executeSurpriseDraw = useCallback((cardValue = null) => {
    if (!surpriseState) return;
    const card = cardValue !== null ? cardValue : SURPRISE_CARDS[Math.floor(Math.random() * SURPRISE_CARDS.length)];
    const { nodeId } = surpriseState;
    const state = boardState[nodeId];
    const currentPlayer = players[currentTurn];
    const nodeName = graph[nodeId]?.name ?? 'casilla sorpresa';
    const newBoard = { ...boardState };
    const newTroops = (state?.troops ?? 0) + card;

    if (newTroops <= 0) {
      newBoard[nodeId] = { occupyingFaction: null, troops: 0, isSieged: false };
      addLog(`🃏 SORPRESA (${card}): ¡El pelotón de ${currentPlayer?.name.toUpperCase()} fue aniquilado en ${nodeName}!`, 'error');
    } else {
      newBoard[nodeId] = { ...state, troops: newTroops };
      if (card > 0) {
        addLog(`🃏 SORPRESA (+${card}): ¡Refuerzos inesperados para ${currentPlayer?.name.toUpperCase()} en ${nodeName}!`, 'success');
      } else {
        addLog(`🃏 SORPRESA (${card}): Emboscada — ${currentPlayer?.name.toUpperCase()} pierde tropas en ${nodeName}.`, 'error');
      }
    }

    setBoardState(newBoard);
    setSurpriseState(null);
    setPhase('MOVE');
    resolvePostMovement(newBoard);
  }, [surpriseState, boardState, players, currentTurn, graph, addLog, resolvePostMovement]);

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

      if (defTroops <= 0 && attTroops > 0) {
        const bonus = captureBonus(graph[defenderNodeId]?.type);
        newBoard[defenderNodeId] = {
          occupyingFaction: attFaction,
          troops: attTroops + bonus,
          isSieged: false
        };
        addLog(`VICTORIA: ${currentPlayer.name.toUpperCase()} capturó ${targetName}${bonus > 0 ? ` +${bonus} tropas` : ''}.`, 'success');
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
        resolvePostMovement(newBoard);
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
    if (phase === 'SETUP' || phase === 'GAME_OVER' || combatState || conquestState || surpriseState) return;
    if (!botAuthority) return; // online: only the host drives bots

    const currentPlayer = players[currentTurn];
    if (!currentPlayer || !currentPlayer.isBot) return;

    // AI Bot execution block
    const botTimer = setTimeout(() => {
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

        if (myBases.length > 0) {
          // Put all recruits on a random controlled base (or weakest base)
          // Find weakest base
          let weakestBase = myBases[0];
          let minTroops = boardState[weakestBase].troops;
          myBases.forEach(baseId => {
            if (boardState[baseId].troops < minTroops) {
              minTroops = boardState[baseId].troops;
              weakestBase = baseId;
            }
          });

          reinforceNode(weakestBase, recruitmentTroops);
        } else {
          // No bases owned (extreme edge case before elimination), just advance
          setRecruitmentTroops(0);
          setPhase('MOVE');
        }
      }

      // 2. MOVE PHASE
      if (phase === 'MOVE') {
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
            const originState = boardState[bestMove.originId];
            const moveTroops = originState.troops - 1;
            const updatedBoard = {
              ...boardState,
              [bestMove.originId]: { ...originState, troops: 1 }
            };

            const destState = boardState[bestMove.targetId];
            const destNode = graph[bestMove.targetId];

            if (destState.occupyingFaction === null) {
              if (destNode.type === 'center' || destNode.type === 'neutral') {
                // Always use conquest roll (1=fail/retreat, 2-6=capture)
                setBoardState(updatedBoard);
                initConquest(bestMove.targetId, moveTroops, bestMove.originId);
                // auto-resolve handled by the dedicated useEffect below
              } else {
                updatedBoard[bestMove.targetId] = {
                  occupyingFaction: currentPlayer.faction,
                  troops: moveTroops,
                  isSieged: false
                };
                setBoardState(updatedBoard);
                addLog(`${currentPlayer.name.toUpperCase()} desplazó pelotón a ${destNode.name}.`, 'info');
                if (destNode.type === 'surprise') {
                  setPhase('SURPRISE');
                  setSurpriseState({ nodeId: bestMove.targetId });
                } else {
                  setTimeout(() => resolvePostMovement(updatedBoard), 1000);
                }
              }
            } else if (destState.occupyingFaction === currentPlayer.faction) {
              updatedBoard[bestMove.targetId] = {
                occupyingFaction: currentPlayer.faction,
                troops: destState.troops + moveTroops,
                isSieged: false
              };
              setBoardState(updatedBoard);
              addLog(`${currentPlayer.name.toUpperCase()} reforzó pelotón en ${destNode.name}.`, 'info');
              if (destNode.type === 'surprise') {
                setPhase('SURPRISE');
                setSurpriseState({ nodeId: bestMove.targetId });
              } else {
                setTimeout(() => resolvePostMovement(updatedBoard), 1000);
              }
            } else {
              // Safety: node marked as owned but with 0 troops → free capture
              if (destState.troops <= 0) {
                updatedBoard[bestMove.targetId] = { occupyingFaction: currentPlayer.faction, troops: moveTroops, isSieged: false };
                setBoardState(updatedBoard);
                addLog(`${currentPlayer.name.toUpperCase()} tomó ${destNode.name} sin resistencia.`, 'info');
                setTimeout(() => resolvePostMovement(updatedBoard), 1000);
              } else {
                setBoardState(updatedBoard);
                initCombat(bestMove.originId, bestMove.targetId, moveTroops);
                // auto-resolve handled by the dedicated useEffect below
              }
            }
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
    surpriseState
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
    surpriseState, alliances, nucleoData,
  }), [players, currentTurn, phase, boardState, diceRoll, sixCount,
       recruitmentTroops, logs, gameStarted, combatState, conquestState,
       surpriseState, alliances, nucleoData]);

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
    if (snap.alliances !== undefined) setAlliances(snap.alliances);
    if (snap.nucleoData !== undefined) setNucleoData(snap.nucleoData);
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
    alliances,
    nucleoData,
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
    addLog,
    getSnapshot,
    hydrate,
  };
}
