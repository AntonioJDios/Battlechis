import React from 'react';
import { CARD_INFO } from '../hooks/useGameState';
import { FACTIONS } from '../utils/boardGraph';

// Shows ONLY the current player's secret hand of brutal cards. Attack cards are
// playable on your turn; the super-defense card is reactive (shown but not playable here).
export default function HandPanel({ hand, players, currentTurn, onPlay, canPlay }) {
  const cards = hand || [];
  if (cards.length === 0) return null;
  const factionColor = FACTIONS[players[currentTurn]?.faction]?.neon ?? '#f59e0b';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '12px',
        left: '12px',
        zIndex: 380,
        background: 'rgba(13,16,26,0.97)',
        border: `1px solid ${factionColor}55`,
        borderRadius: '10px',
        padding: '8px 10px',
        maxWidth: 'min(320px, 92vw)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
      }}
    >
      <div className="font-tactical text-[9px] uppercase tracking-widest mb-1" style={{ color: factionColor }}>
        🃏 Tu mano ({cards.length})
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {cards.map((c, i) => {
          const info = CARD_INFO[c] || { icon: '🃏', name: c, kind: 'attack' };
          const playable = canPlay && info.kind === 'attack';
          return (
            <button
              key={`${c}-${i}`}
              onClick={() => playable && onPlay(c)}
              disabled={!playable}
              title={info.kind === 'defense' ? 'Reactiva: se usa cuando te atacan' : 'Jugar en tu turno'}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                width: 62, padding: '6px 4px', borderRadius: 8,
                border: `1px solid ${playable ? factionColor : 'rgba(120,130,150,0.35)'}`,
                background: playable ? `${factionColor}18` : 'rgba(30,35,50,0.5)',
                color: playable ? '#fff' : '#9ca3af',
                cursor: playable ? 'pointer' : 'default',
              }}
            >
              <span style={{ fontSize: 20 }}>{info.icon}</span>
              <span className="font-mono text-[8px] leading-tight text-center">{info.name}</span>
              {info.kind === 'defense' && <span className="font-mono text-[7px] text-cyan-400">reactiva</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
