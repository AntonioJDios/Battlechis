import React from 'react';
import { FACTIONS } from '../utils/boardGraph';

export default function GameControls({
  phase,
  currentTurn,
  players,
  diceRoll,
  sixCount,
  recruitmentTroops,
  rollMovement,
  endTurn,
  selectedNode,
  highlightedNodes,
  onReinforce,
  troopsToMove,
  onTroopsChange,
  maxMovable,
  isBase,
  boardState,
}) {
  const currentPlayer = players[currentTurn];
  if (!currentPlayer) return null;

  const factionColor = FACTIONS[currentPlayer.faction]?.neon ?? '#00f0ff';
  const isBot = currentPlayer.isBot;

  return (
    <div
      style={{
        position: 'fixed',
        top: '60px',
        right: '12px',
        zIndex: 400,
        background: 'rgba(13,16,26,0.97)',
        border: `1px solid ${factionColor}40`,
        borderRadius: '12px',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '8px',
        boxShadow: `0 0 24px ${factionColor}20, 0 8px 32px rgba(0,0,0,0.8)`,
        backdropFilter: 'blur(10px)',
        width: '200px',
      }}
    >
      {/* Phase badge */}
      <div style={{
        background: `${factionColor}18`,
        border: `1px solid ${factionColor}40`,
        borderRadius: '6px',
        padding: '4px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: factionColor }} className="animate-pulse" />
        <span className="font-tactical text-[10px] font-bold uppercase tracking-wider" style={{ color: factionColor }}>
          {currentPlayer.name.split(' ')[0]} · {phase}
        </span>
      </div>

      {/* ── BOT turn ── */}
      {isBot && (
        <span className="font-mono text-[10px] text-cyan-400 animate-pulse">🤖 IA procesando...</span>
      )}

      {/* ── RECRUIT phase ── */}
      {!isBot && phase === 'RECRUIT' && (
        <div style={{
          background: 'rgba(80,10,10,0.3)',
          border: '1px solid rgba(255,59,59,0.5)',
          borderRadius: '8px',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <p className="font-tactical text-[11px] font-bold text-red-400">+{recruitmentTroops} Tropas disponibles</p>

          {/* Troop amount selector — allows splitting across bases */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => onTroopsChange(Math.max(1, troopsToMove - 1))}
              style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid rgba(255,59,59,0.4)', background: '#121625', color: '#9ca3af', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
            >−</button>
            <span className="font-tactical font-black text-xl" style={{ color: '#f87171', width: 28, textAlign: 'center' }}>{troopsToMove}</span>
            <button
              onClick={() => onTroopsChange(Math.min(recruitmentTroops, troopsToMove + 1))}
              style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid rgba(255,59,59,0.4)', background: '#121625', color: '#9ca3af', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
            >+</button>
            <span className="font-mono text-[9px] text-gray-500">/{recruitmentTroops}</span>
          </div>

          <p className="font-mono text-[9px] text-gray-500">Elige la cantidad y haz clic en una base parpadeante. Repite para repartir entre varias bases.</p>
        </div>
      )}

      {/* ── MOVE phase ── */}
      {!isBot && phase === 'MOVE' && (
        <>
          {/* Dice */}
          {diceRoll === null ? (
            <button
              onClick={rollMovement}
              className="font-tactical text-[11px] font-bold animate-pulse"
              style={{
                padding: '7px 18px',
                border: '2px dashed rgba(0,240,255,0.6)',
                borderRadius: '8px',
                background: 'rgba(0,240,255,0.07)',
                color: '#00f0ff',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              🎲 Lanzar dado
            </button>
          ) : (
            <div style={{
              width: 44, height: 44,
              borderRadius: '8px',
              border: '2px solid var(--neon-cyan)',
              background: '#121625',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 900,
              color: '#00f0ff',
              flexShrink: 0,
              position: 'relative',
              boxShadow: '0 0 12px rgba(0,240,255,0.3)',
              fontFamily: 'var(--font-tactical)',
            }}>
              {diceRoll}
              {sixCount > 0 && (
                <div style={{
                  position: 'absolute', top: -8, right: -8,
                  background: '#16a34a', color: 'white',
                  borderRadius: '50%', width: 18, height: 18,
                  fontSize: 9, fontWeight: 900,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid white',
                }}>×{sixCount + 1}</div>
              )}
            </div>
          )}

          {/* Troop selector — only when unit selected and targets available */}
          {selectedNode && highlightedNodes.length > 0 && (
            <div style={{
              background: 'rgba(0,240,255,0.08)',
              border: '1px solid rgba(0,240,255,0.35)',
              borderRadius: '8px',
              padding: '7px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}>
              <span className="font-mono text-[9px] text-cyan-400 uppercase tracking-wider">Tropas a mover</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => onTroopsChange(Math.max(1, troopsToMove - 1))}
                  style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid rgba(100,120,180,0.4)', background: '#121625', color: '#9ca3af', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                >−</button>
                <span className="font-tactical font-black text-xl" style={{ color: '#00f0ff', width: 28, textAlign: 'center' }}>{troopsToMove}</span>
                <button
                  onClick={() => onTroopsChange(Math.min(maxMovable, troopsToMove + 1))}
                  style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid rgba(100,120,180,0.4)', background: '#121625', color: '#9ca3af', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                >+</button>
                <span className="font-mono text-[9px] text-gray-500">/{maxMovable}{isBase ? ' (1 queda)' : ''}</span>
              </div>
              <span className="font-mono text-[9px] text-gray-500">Pulsa destino en el tablero</span>
            </div>
          )}

          {/* Pass turn — only after dice rolled */}
          {diceRoll !== null && (
            <button onClick={endTurn} className="font-tactical text-[11px]"
              style={{ padding: '7px 14px', border: '1px solid rgba(100,116,139,0.5)', borderRadius: '6px', background: 'rgba(30,41,59,0.4)', color: '#94a3b8', cursor: 'pointer' }}>
              Pasar turno
            </button>
          )}
        </>
      )}

      {/* ── REDISTRIBUTE phase ── */}
      {!isBot && phase === 'REDISTRIBUTE' && (
        <>
          <div style={{
            background: 'rgba(99,102,241,0.1)',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: '8px',
            padding: '7px 10px',
          }}>
            <p className="font-mono text-[9px] text-indigo-300 uppercase tracking-wider mb-1">Redistribuir tropas</p>
            <p className="font-mono text-[9px] text-gray-500">Selecciona una posición propia y mueve tropas a cualquier territorio propio conectado. Repite las veces que quieras.</p>
          </div>

          {/* Troop selector when origin selected */}
          {selectedNode && highlightedNodes.length > 0 && (
            <div style={{
              background: 'rgba(99,102,241,0.1)',
              border: '1px solid rgba(99,102,241,0.4)',
              borderRadius: '8px',
              padding: '7px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}>
              <span className="font-mono text-[9px] text-indigo-300 uppercase tracking-wider">Tropas a mover</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => onTroopsChange(Math.max(1, troopsToMove - 1))}
                  style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid rgba(99,102,241,0.4)', background: '#121625', color: '#9ca3af', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                >−</button>
                <span className="font-tactical font-black text-xl" style={{ color: '#818cf8', width: 28, textAlign: 'center' }}>{troopsToMove}</span>
                <button
                  onClick={() => onTroopsChange(Math.min(maxMovable, troopsToMove + 1))}
                  style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid rgba(99,102,241,0.4)', background: '#121625', color: '#9ca3af', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                >+</button>
                <span className="font-mono text-[9px] text-gray-500">/{maxMovable}{isBase ? ' (1 queda)' : ''}</span>
              </div>
              <span className="font-mono text-[9px] text-gray-500">Pulsa cualquier destino propio parpadeante</span>
            </div>
          )}

          <button onClick={endTurn}
            className="font-tactical text-[11px] font-bold"
            style={{ padding: '8px 14px', border: '1px solid rgba(99,102,241,0.6)', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', cursor: 'pointer' }}>
            ✓ Fin de turno
          </button>
        </>
      )}

    </div>
  );
}
