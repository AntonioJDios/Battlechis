import React from 'react';
import { Bomb } from 'lucide-react';
import { FACTIONS } from '../utils/boardGraph';

// After drawing the 💣 card, the player picks ANY base on the board to wipe
// (all its troops and shields are destroyed; it becomes empty).
export default function BombModal({ bombState, boardState, graph, players, currentTurn, onBomb }) {
  if (!bombState) return null;
  const currentPlayer = players[currentTurn];

  const bases = Object.keys(boardState)
    .filter((id) => {
      const n = graph[id];
      return n && (n.type === 'hq' || n.type === 'neutral' || n.type === 'center');
    })
    .sort((a, b) => (boardState[b].troops + (boardState[b].shields || 0)) - (boardState[a].troops + (boardState[a].shields || 0)));

  const colorOf = (f) => (f == null ? 'var(--neon-grey)' : FACTIONS[f]?.neon);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 520, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        className="animate-fade-in"
        style={{
          pointerEvents: 'all',
          width: 'min(380px, 94vw)',
          maxHeight: 'calc(100vh - 24px)',
          overflowY: 'auto',
          background: '#0f121d',
          border: '2px solid rgba(239,68,68,0.6)',
          borderRadius: '8px',
          boxShadow: '0 0 40px rgba(239,68,68,0.35), 0 8px 32px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ background: 'rgba(80,10,10,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bomb className="w-4 h-4 text-red-400 animate-pulse" />
          <span className="font-tactical text-[11px] text-red-400 font-bold uppercase tracking-widest">Bomba atómica</span>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {!currentPlayer?.isBot ? (
            <>
              <p className="font-mono text-[10px] text-gray-300 leading-relaxed">
                Elige una <strong className="text-red-400">base para arrasar</strong>: mueren todas sus tropas y escudos y queda vacía.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {bases.map((id) => {
                  const s = boardState[id];
                  const owner = s.occupyingFaction != null ? players.find((p) => p.faction === s.occupyingFaction) : null;
                  return (
                    <button
                      key={id}
                      onClick={() => onBomb(id)}
                      className="flex items-center gap-2 rounded px-3 py-2 border border-red-500/30 bg-red-950/10 hover:bg-red-900/30 transition-all text-left"
                    >
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: colorOf(s.occupyingFaction), flexShrink: 0 }} />
                      <span className="font-tactical text-[11px] text-white flex-1 truncate">{graph[id].name}</span>
                      <span className="font-mono text-[9px] text-gray-400">{owner ? owner.name.split(' ')[0] : 'libre'}</span>
                      <span className="font-mono text-[10px] text-gray-300">{s.troops}T {(s.shields || 0) > 0 ? '🛡️'.repeat(s.shields) : ''}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-slate-500 font-mono animate-pulse text-center py-3">🤖 El bot apunta con la bomba…</div>
          )}
        </div>
      </div>
    </div>
  );
}
