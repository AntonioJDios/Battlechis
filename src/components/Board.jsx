import React, { useState } from 'react';
import { FACTIONS } from '../utils/boardGraph';
import { SoundManager } from './SoundManager';

// Faction insignias as SVG paths centered at (0,0)
const FactionInsignia = ({ factionId, size = 20, color = "#fff" }) => {
  const scale = size / 32;
  
  // Custom SVG paths for each faction crest
  const renderPath = () => {
    switch (factionId) {
      case 0: // Crimson Skull
        return (
          <path 
            d="M 16 2 C 10 2 6 6 6 12 C 6 17 9 20 11 22 L 11 27 C 11 28.5 12.5 30 14 30 L 18 30 C 19.5 30 21 28.5 21 27 L 21 22 C 23 20 26 17 26 12 C 26 6 22 2 16 2 Z M 12 11 A 2 2 0 1 1 12 15 A 2 2 0 1 1 12 11 Z M 20 11 A 2 2 0 1 1 20 15 A 2 2 0 1 1 20 11 Z M 13 22 L 13 25 L 15 25 L 15 22 Z M 17 22 L 17 25 L 19 25 L 19 22 Z"
            fill={color}
          />
        );
      case 1: // Delta Wings
        return (
          <path 
            d="M 16 4 L 4 12 L 8 16 L 12 14 L 12 28 L 20 28 L 20 14 L 24 16 L 28 12 Z M 16 10 L 20 13 L 12 13 Z"
            fill={color}
          />
        );
      case 2: // Sigma Lightning
        return (
          <path 
            d="M 22 2 L 6 18 L 14 18 L 10 30 L 26 14 L 18 14 Z"
            fill={color}
          />
        );
      case 3: // Gamma Biohazard / Cross
        return (
          <path 
            d="M 16 2 L 20 10 L 29 10 L 22 16 L 25 25 L 16 20 L 7 25 L 10 16 L 3 10 L 12 10 Z"
            fill={color}
          />
        );
      case 4: // Omega Eclipse
        return (
          <path 
            d="M 16 2 A 14 14 0 1 0 30 16 A 14 14 0 0 1 18 4 A 14 14 0 0 1 16 2 Z"
            fill={color}
          />
        );
      default:
        return (
          <circle cx="16" cy="16" r="10" fill={color} />
        );
    }
  };

  return (
    <g transform={`scale(${scale}) translate(-16, -16)`}>
      {renderPath()}
    </g>
  );
};

export default function Board({ 
  graph, 
  boardState, 
  currentTurn, 
  phase, 
  selectedNode, 
  highlightedNodes, 
  onNodeClick,
  players
}) {
  const [hoveredNode, setHoveredNode] = useState(null);

  // Pre-calculate unique connections to avoid double drawing
  const links = [];
  const visitedLinks = new Set();
  
  Object.keys(graph).forEach(nodeId => {
    const node = graph[nodeId];
    node.neighbors.forEach(neighborId => {
      const linkKey = [nodeId, neighborId].sort().join('-');
      if (!visitedLinks.has(linkKey)) {
        visitedLinks.add(linkKey);
        links.push({ from: node, to: graph[neighborId] });
      }
    });
  });

  // Calculate the path to draw for previews
  const getHoveredPath = () => {
    if (!selectedNode || !hoveredNode || !highlightedNodes.includes(hoveredNode)) {
      return null;
    }
    
    // We can run a simple BFS for the shortest path to display a neat connection trail
    const queue = [[selectedNode]];
    const visited = new Set([selectedNode]);

    while (queue.length > 0) {
      const path = queue.shift();
      const node = path[path.length - 1];

      if (node === hoveredNode) return path;

      const neighbors = graph[node]?.neighbors || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor) && (highlightedNodes.includes(neighbor) || neighbor === hoveredNode || neighbor === selectedNode)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }
    return null;
  };

  const activePath = getHoveredPath();

  // Helper to render flag on neutral bases
  const renderFlag = (x, y, color) => {
    return (
      <g transform={`translate(${x - 4}, ${y - 25})`}>
        <line x1="0" y1="0" x2="0" y2="16" stroke="#8093a8" strokeWidth="2" />
        <polygon points="0,0 12,4 0,8" fill={color} />
      </g>
    );
  };

  // Helper to render shield pips (fortification) above a base
  const renderShields = (shields, y) => {
    if (!shields || shields <= 0) return null;
    return (
      <text y={y} textAnchor="middle" fontSize="12" style={{ pointerEvents: 'none' }}>
        {'🛡️'.repeat(Math.min(3, shields))}
      </text>
    );
  };

  const getFactionColor = (factionId) => {
    if (factionId === null || factionId === undefined) return 'var(--neon-grey)';
    return FACTIONS[factionId]?.neon || 'var(--neon-grey)';
  };

  const getPlayerDetails = (factionId) => {
    return players.find(p => p.faction === factionId);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', padding: '2px' }}>
      <div
        style={{
          aspectRatio: '1 / 1',
          height: '100%',
          maxWidth: '100%',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <svg 
          viewBox="0 0 800 800" 
          className="w-full h-full drop-shadow-[0_0_20px_rgba(10,15,30,0.8)]"
          style={{ overflow: 'visible' }}
        >
        <defs>
          {/* Neon glow filters */}
          <filter id="neon-glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          
          <filter id="neon-glow-active" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feColorMatrix type="matrix" values="
              0 0 0 0 0
              0 0 0 0 1
              0 0 0 0 1
              0 0 0 1 0" 
            />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          
          <radialGradient id="center-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0, 230, 118, 0.4)" />
            <stop offset="70%" stopColor="rgba(16, 20, 30, 0.9)" />
            <stop offset="100%" stopColor="var(--neon-green)" />
          </radialGradient>

          <radialGradient id="hq-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(30, 45, 75, 0.6)" />
            <stop offset="100%" stopColor="rgba(12, 16, 25, 0.95)" />
          </radialGradient>
        </defs>

        {/* 1. Draw Board Connections (Lines) */}
        <g id="connections">
          {links.map((link, idx) => {
            const isHovered = (hoveredNode === link.from.id || hoveredNode === link.to.id);
            const inActivePath = activePath && 
              activePath.includes(link.from.id) && 
              activePath.includes(link.to.id) &&
              Math.abs(activePath.indexOf(link.from.id) - activePath.indexOf(link.to.id)) === 1;

            return (
              <line
                key={idx}
                x1={link.from.x}
                y1={link.from.y}
                x2={link.to.x}
                y2={link.to.y}
                stroke={inActivePath ? 'var(--neon-cyan)' : 'rgba(35, 55, 85, 0.45)'}
                strokeWidth={inActivePath ? '4' : isHovered ? '2.5' : '1.5'}
                strokeDasharray={inActivePath ? '6,4' : 'none'}
                className="transition-all duration-200"
                style={{
                  filter: inActivePath ? 'url(#neon-glow-cyan)' : 'none'
                }}
              />
            );
          })}
        </g>

        {/* 2. Draw Nodes */}
        <g id="nodes">
          {Object.keys(graph).map(nodeId => {
            const node = graph[nodeId];
            const state = boardState[nodeId] || { occupyingFaction: null, troops: 0 };
            const isHq = node.type === 'hq';
            const isNeutral = node.type === 'neutral';
            const isCenter = node.type === 'center';
            const isPath = node.type === 'path';
            const isSurprise = node.type === 'surprise';

            const player = state.occupyingFaction !== null ? getPlayerDetails(state.occupyingFaction) : null;
            const factionColor = player ? player.neon : getFactionColor(isHq ? node.faction : null);
            
            const isSelected = selectedNode === nodeId;
            const isHighlighted = highlightedNodes.includes(nodeId);
            const isHovered = hoveredNode === nodeId;

            // Render Center base
            if (isCenter) {
              const borderGlow = state.occupyingFaction !== null ? getFactionColor(state.occupyingFaction) : 'var(--neon-green)';
              return (
                <g 
                  key={nodeId}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  onClick={() => onNodeClick(nodeId)}
                  onMouseEnter={() => { SoundManager.playClick(); setHoveredNode(nodeId); }}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  <polygon
                    points="0,-45 39,-22.5 39,22.5 0,45 -39,22.5 -39,-22.5"
                    fill="url(#center-gradient)"
                    stroke={borderGlow}
                    strokeWidth={isHovered || isSelected ? 4 : 2}
                    className="transition-all duration-300"
                    style={{
                      filter: isHovered || isSelected || isHighlighted ? 'url(#neon-glow-active)' : 'none'
                    }}
                  />
                  {state.occupyingFaction !== null && renderFlag(0, 5, factionColor)}
                  
                  {/* Central Text HUD */}
                  <text 
                    y="-12"
                    textAnchor="middle" 
                    fill="#fff" 
                    fontSize="10" 
                    fontFamily="var(--font-tactical)"
                    fontWeight="bold"
                    letterSpacing="1"
                  >
                    NÚCLEO
                  </text>
                  <text 
                    y="10"
                    textAnchor="middle" 
                    fill="var(--neon-cyan)" 
                    fontSize="16" 
                    fontFamily="var(--font-stats)"
                    fontWeight="bold"
                  >
                    {state.troops} T
                  </text>
                  {renderShields(state.shields, -30)}
                  {isHighlighted && (
                    <circle r="52" fill="none" stroke="var(--neon-cyan)" strokeWidth="1.5" strokeDasharray="5,5" className="animate-spin" style={{ animationDuration: '10s' }} />
                  )}
                </g>
              );
            }

            // Render HQs
            if (isHq) {
              const commanderColor = factionColor;
              return (
                <g
                  key={nodeId}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  onClick={() => onNodeClick(nodeId)}
                  onMouseEnter={() => { SoundManager.playClick(); setHoveredNode(nodeId); }}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  {/* Outer base platform */}
                  <polygon
                    points="0,-36 34,-11 21,29 -21,29 -34,-11"
                    fill="url(#hq-gradient)"
                    stroke={commanderColor}
                    strokeWidth={isSelected ? 4.5 : isHovered ? 3.5 : 2}
                    className="transition-all duration-200"
                    style={{
                      filter: isSelected || isHovered ? `drop-shadow(0 0 8px ${commanderColor})` : 'none'
                    }}
                  />
                  
                  {/* Insignia Icon */}
                  <g transform="translate(0, -6)">
                    <FactionInsignia factionId={node.faction} size={24} color={commanderColor} />
                  </g>

                  {/* Faction Tag */}
                  <text
                    y="18"
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="8"
                    fontFamily="var(--font-tactical)"
                    letterSpacing="0.5"
                  >
                    {FACTIONS[node.faction].color.toUpperCase()} HQ
                  </text>

                  {/* Troop Counter Badge */}
                  <g transform="translate(22, -22)">
                    <circle r="12" fill="#121620" stroke={commanderColor} strokeWidth="1.5" />
                    <text
                      y="3.5"
                      textAnchor="middle"
                      fill="#fff"
                      fontSize="10"
                      fontFamily="var(--font-stats)"
                      fontWeight="bold"
                    >
                      {state.troops}
                    </text>
                  </g>

                  {renderShields(state.shields, -34)}

                  {/* Action Highlights */}
                  {isHighlighted && (
                    <circle r="44" fill="none" stroke="var(--neon-cyan)" strokeWidth="2" strokeDasharray="4,4" className="animate-pulse" />
                  )}
                </g>
              );
            }

            // Render Neutral / Captured Bases
            if (isNeutral) {
              const baseColor = state.occupyingFaction !== null ? factionColor : 'var(--neon-grey)';
              const isSieged = state.isSieged;
              return (
                <g
                  key={nodeId}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  onClick={() => onNodeClick(nodeId)}
                  onMouseEnter={() => { SoundManager.playClick(); setHoveredNode(nodeId); }}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  <polygon
                    points="0,-25 22,-12.5 22,12.5 0,25 -22,12.5 -22,-12.5"
                    fill="#10141f"
                    stroke={baseColor}
                    strokeWidth={isSelected ? 3.5 : isHovered ? 2.5 : 1.5}
                    className="transition-all duration-200"
                    style={{
                      filter: isSelected || isHovered ? `drop-shadow(0 0 6px ${baseColor})` : 'none'
                    }}
                  />
                  {renderFlag(0, 0, baseColor)}
                  
                  {/* Troop Counter */}
                  <text
                    y="10"
                    textAnchor="middle"
                    fill={isSieged ? 'var(--neon-red)' : '#fff'}
                    fontSize="11"
                    fontFamily="var(--font-stats)"
                    fontWeight="bold"
                  >
                    {state.troops}
                  </text>

                  {/* Siege Indicator */}
                  {isSieged && (
                    <g transform="translate(-18, -18)">
                      <circle r="6" fill="var(--neon-red)" />
                      <text y="2" textAnchor="middle" fill="#fff" fontSize="6" fontWeight="bold">S</text>
                    </g>
                  )}

                  {renderShields(state.shields, -26)}

                  {isHighlighted && (
                    <circle r="32" fill="none" stroke="var(--neon-cyan)" strokeWidth="2" strokeDasharray="3,3" className="animate-pulse" />
                  )}
                </g>
              );
            }

            // Render Surprise Cells (Monopoly-style "?" diamond)
            if (isSurprise) {
              const occupied = state.occupyingFaction !== null;
              const surpriseColor = occupied ? factionColor : '#f59e0b';
              return (
                <g
                  key={nodeId}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  onClick={() => onNodeClick(nodeId)}
                  onMouseEnter={() => setHoveredNode(nodeId)}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  <rect
                    x="-12" y="-12" width="24" height="24" rx="4"
                    transform="rotate(45)"
                    fill={occupied ? factionColor : 'rgba(50,35,5,0.9)'}
                    stroke={isHighlighted ? 'var(--neon-cyan)' : '#f59e0b'}
                    strokeWidth={isHighlighted || isHovered ? 2.5 : 1.5}
                    className="transition-all duration-200"
                    style={{ filter: isHighlighted ? 'url(#neon-glow-cyan)' : `drop-shadow(0 0 4px ${surpriseColor}60)` }}
                  />
                  {occupied ? (
                    <>
                      <text y="4" textAnchor="middle" fill="#fff" fontSize="10" fontFamily="var(--font-stats)" fontWeight="bold">
                        {state.troops}
                      </text>
                      <text y="-16" textAnchor="middle" fill="#f59e0b" fontSize="9" fontWeight="bold">?</text>
                    </>
                  ) : (
                    <text y="5" textAnchor="middle" fill="#f59e0b" fontSize="14" fontFamily="var(--font-tactical)" fontWeight="900">?</text>
                  )}

                  {isHighlighted && (
                    <circle r="20" fill="none" stroke="var(--neon-cyan)" strokeWidth="1.5" className="animate-pulse" />
                  )}
                  {isSelected && (
                    <circle r="22" fill="none" stroke="var(--neon-cyan)" strokeWidth="2" className="animate-ping" style={{ animationDuration: '1.5s' }} />
                  )}
                </g>
              );
            }

            // Render Path Circular Nodes
            const isOccupied = state.occupyingFaction !== null;
            return (
              <g
                key={nodeId}
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer"
                onClick={() => onNodeClick(nodeId)}
                onMouseEnter={() => setHoveredNode(nodeId)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Visual node anchor */}
                <circle
                  r={isOccupied ? 12 : isHovered ? 8 : 6}
                  fill={isOccupied ? factionColor : 'rgba(16, 20, 30, 0.8)'}
                  stroke={isOccupied ? '#fff' : isHighlighted ? 'var(--neon-cyan)' : 'var(--neon-grey)'}
                  strokeWidth={isOccupied ? 1.5 : isHighlighted ? 2 : 1}
                  className="transition-all duration-200"
                  style={{
                    filter: isHighlighted ? 'url(#neon-glow-cyan)' : 'none',
                    boxShadow: isOccupied ? `0 0 8px ${factionColor}` : 'none'
                  }}
                />

                {/* Show troop counts on path circles */}
                {isOccupied && (
                  <text
                    y="3.5"
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="9"
                    fontFamily="var(--font-stats)"
                    fontWeight="bold"
                  >
                    {state.troops}
                  </text>
                )}

                {/* Pulsing ring for movement targets */}
                {isHighlighted && (
                  <circle
                    r="15"
                    fill="none"
                    stroke="var(--neon-cyan)"
                    strokeWidth="1.5"
                    className="animate-pulse"
                  />
                )}
                
                {/* Double pulse for selected platoon */}
                {isSelected && (
                  <circle
                    r="18"
                    fill="none"
                    stroke="var(--neon-cyan)"
                    strokeWidth="2"
                    className="animate-ping"
                    style={{ animationDuration: '1.5s' }}
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>
      </div>
    </div>
  );
}
