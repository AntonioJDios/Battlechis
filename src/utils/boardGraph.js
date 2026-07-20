// Board Graph Generator for JuegoGonzi
// Symmetrical Pentagram/Star Layout with 5 HQs, 5 Neutral Bases, 1 Central Core, and intermediate paths.

const RAD_36 = (36 * Math.PI) / 180;
const RAD_72 = (72 * Math.PI) / 180;
const RAD_12 = (12 * Math.PI) / 180;

export const FACTIONS = [
  { id: 0, name: "ALPHA (Crimson)", commander: "Col. Marcus Vance", color: "red", neon: "var(--neon-red)", rgb: "255, 59, 59" },
  { id: 1, name: "DELTA (Blue Eagle)", commander: "Cmdr. Elena Rostova", color: "blue", neon: "var(--neon-blue)", rgb: "0, 136, 255" },
  { id: 2, name: "SIGMA (Lightning)", commander: "Maj. Jackson Briggs", color: "yellow", neon: "var(--neon-yellow)", rgb: "255, 208, 0" },
  { id: 3, name: "GAMMA (Viper)", commander: "Capt. Caleb Stone", color: "green", neon: "var(--neon-green)", rgb: "0, 230, 118" },
  { id: 4, name: "OMEGA (Eclipse)", commander: "Lt. Valeria Ruiz", color: "purple", neon: "var(--neon-purple)", rgb: "197, 66, 255" }
];

export const NEUTRAL_BASE_NAMES = [
  "BASE ECHO-7",
  "BASE BRAVO-3",
  "BASE CHARLIE-4",
  "BASE BRAVO-7",
  "BASE ALPHA-5"
];

// Board sizes: number of intermediate path cells on each kind of route.
// 'large' = original long board; 'small' = quick board (contact happens fast).
const BOARD_SIZES = {
  large: { outer: 7, radialHqN: 6, radialNCenter: 2 }, // HQ↔HQ 8, HQ↔base 7, base↔centro 3
  small: { outer: 3, radialHqN: 2, radialNCenter: 1 }, // HQ↔HQ 4, HQ↔base 3, base↔centro 2
};

export function generateBoardGraph(size = 'large') {
  const cfg = BOARD_SIZES[size] || BOARD_SIZES.large;
  const graph = {};

  const width = 800;
  const height = 800;
  const cx = width / 2;
  const cy = height / 2;

  // Radii
  const R_hq = 320;
  const R_outer = 330;
  const R_neutral = 160;
  const R_center = 0;

  // Helper to add node
  const addNode = (id, data) => {
    graph[id] = {
      id,
      neighbors: [],
      ...data
    };
  };

  // Helper to connect nodes bidirectionally
  const connect = (id1, id2) => {
    if (graph[id1] && graph[id2]) {
      if (!graph[id1].neighbors.includes(id2)) graph[id1].neighbors.push(id2);
      if (!graph[id2].neighbors.includes(id1)) graph[id2].neighbors.push(id1);
    }
  };

  // 1. Add Center Node
  addNode("center", {
    type: "center",
    name: "CENTRO DE CONTROL ESTRATÉGICO",
    x: cx,
    y: cy
  });

  // Angles for HQs (0 is Top, then clockwise)
  const getHqAngle = (i) => (i * RAD_72) - (Math.PI / 2);
  // Angles for Valley/Neutral bases (offset by 36 deg)
  const getNeutralAngle = (i) => getHqAngle(i) + RAD_36;

  // 2. Add HQs
  for (let i = 0; i < 5; i++) {
    const angle = getHqAngle(i);
    addNode(`hq_${i}`, {
      type: "hq",
      name: `CUARTEL GENERAL ${FACTIONS[i].color.toUpperCase()} (${FACTIONS[i].name.split(" ")[0]})`,
      faction: i,
      x: cx + R_hq * Math.cos(angle),
      y: cy + R_hq * Math.sin(angle)
    });
  }

  // 3. Add Neutral Bases
  for (let i = 0; i < 5; i++) {
    const angle = getNeutralAngle(i);
    addNode(`neutral_${i}`, {
      type: "neutral",
      name: NEUTRAL_BASE_NAMES[i],
      x: cx + R_neutral * Math.cos(angle),
      y: cy + R_neutral * Math.sin(angle)
    });
  }

  // 4. Add Outer Paths & Connect HQs.
  // `cfg.outer` intermediate cells → distance outer+1 between HQs.
  // The middle cell is a SURPRISE cell.
  const outerN = cfg.outer;
  const outerMid = Math.ceil(outerN / 2);
  for (let i = 0; i < 5; i++) {
    const nextHq = (i + 1) % 5;
    const startAngle = getHqAngle(i);
    let lastNodeId = `hq_${i}`;

    for (let j = 1; j <= outerN; j++) {
      const angle = startAngle + (j * RAD_72 / (outerN + 1));
      const isSurprise = j === outerMid;
      const nodeId = `outer_${i}_${j}`;
      addNode(nodeId, {
        type: isSurprise ? "surprise" : "path",
        name: isSurprise ? `CASILLA SORPRESA ${i+1}` : `Vía Perimetral ${i+1}-${j}`,
        x: cx + R_outer * Math.cos(angle),
        y: cy + R_outer * Math.sin(angle)
      });
      connect(lastNodeId, nodeId);
      lastNodeId = nodeId;
    }
    connect(lastNodeId, `hq_${nextHq}`);
  }

  // 5. Add Radial Paths between HQs and Neutral Bases (`cfg.radialHqN` intermediate cells).
  const radN = cfg.radialHqN;
  for (let i = 0; i < 5; i++) {
    const nIdx1 = i;
    const nIdx2 = (i - 1 + 5) % 5;

    const hq = graph[`hq_${i}`];
    const n1 = graph[`neutral_${nIdx1}`];
    const n2 = graph[`neutral_${nIdx2}`];

    let lastNodeId = `hq_${i}`;
    for (let j = 1; j <= radN; j++) {
      const nodeId = `radial_hq_n1_${i}_${j}`;
      addNode(nodeId, {
        type: "path",
        name: `Sector Radial ${i}-A${j}`,
        x: hq.x + (n1.x - hq.x) * (j / (radN + 1)),
        y: hq.y + (n1.y - hq.y) * (j / (radN + 1))
      });
      connect(lastNodeId, nodeId);
      lastNodeId = nodeId;
    }
    connect(lastNodeId, `neutral_${nIdx1}`);

    lastNodeId = `hq_${i}`;
    for (let j = 1; j <= radN; j++) {
      const nodeId = `radial_hq_n2_${i}_${j}`;
      addNode(nodeId, {
        type: "path",
        name: `Sector Radial ${i}-B${j}`,
        x: hq.x + (n2.x - hq.x) * (j / (radN + 1)),
        y: hq.y + (n2.y - hq.y) * (j / (radN + 1))
      });
      connect(lastNodeId, nodeId);
      lastNodeId = nodeId;
    }
    connect(lastNodeId, `neutral_${nIdx2}`);
  }

  // 6. Add Radial Paths between Neutral Bases and Center Core (`cfg.radialNCenter`).
  const ncN = cfg.radialNCenter;
  for (let i = 0; i < 5; i++) {
    const neutral = graph[`neutral_${i}`];
    let lastNodeId = `neutral_${i}`;

    for (let j = 1; j <= ncN; j++) {
      const nodeId = `radial_n_center_${i}_${j}`;
      addNode(nodeId, {
        type: "path",
        name: `Acceso Núcleo ${i}-${j}`,
        x: neutral.x + (cx - neutral.x) * (j / (ncN + 1)),
        y: neutral.y + (cy - neutral.y) * (j / (ncN + 1))
      });
      connect(lastNodeId, nodeId);
      lastNodeId = nodeId;
    }
    connect(lastNodeId, "center");
  }

  return graph;
}

// Find shortest path between two nodes (BFS)
export function findShortestPath(graph, startId, endId) {
  if (startId === endId) return [startId];
  
  const queue = [[startId]];
  const visited = new Set([startId]);

  while (queue.length > 0) {
    const path = queue.shift();
    const node = path[path.length - 1];

    if (node === endId) return path;

    const neighbors = graph[node]?.neighbors || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null;
}

// Get all nodes reachable in exactly 'distance' steps, without visiting the same node twice in the path
export function getNodesAtDistance(graph, startId, distance) {
  const result = new Set();
  
  function dfs(nodeId, stepsLeft, visited) {
    if (stepsLeft === 0) {
      result.add(nodeId);
      return;
    }

    const neighbors = graph[nodeId]?.neighbors || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        dfs(neighbor, stepsLeft - 1, visited);
        visited.delete(neighbor);
      }
    }
  }

  dfs(startId, distance, new Set([startId]));
  return Array.from(result);
}
