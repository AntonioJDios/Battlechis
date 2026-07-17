import React from 'react';
import { ShieldPlus, ArrowRight } from 'lucide-react';
import { FACTIONS } from '../utils/boardGraph';

// FORTIFY step: shown after reinforcing, before rolling the movement die.
// The player may spend 5 troops from one of their bases to add 1 shield, or skip.
export default function FortifyModal({ boardState, graph, players, currentTurn, onFortify, onSkip }) {
  const currentPlayer = players[currentTurn];
  if (!currentPlayer) return null;

  const color = FACTIONS[currentPlayer.faction]?.neon ?? '#f59e0b';

  // Own bases that can be fortified: ≥6 troops (spend 5, keep 1) and <3 shields.
  const eligible = Object.keys(boardState)
    .filter((id) => {
      const n = graph[id]; const s = boardState[id];
      return s?.occupyingFaction === currentPlayer.faction
        && (n.type === 'hq' || n.type === 'neutral' || n.type === 'center')
        && s.troops >= 6 && (s.shields || 0) < 3;
    })
    .sort((a, b) => boardState[b].troops - boardState[a].troops);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 515, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        className="animate-fade-in"
        style={{
          pointerEvents: 'all',
          width: 'min(360px, 92vw)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: '#0f121d',
          border: '1px solid rgba(245,158,11,0.4)',
          borderRadius: '8px',
          boxShadow: '0 0 40px rgba(245,158,11,0.22), 0 8px 32px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ background: 'rgba(60,40,5,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldPlus className="w-4 h-4 text-amber-400" />
          <span className="font-tactical text-[11px] text-amber-400 font-bold uppercase tracking-widest">Fortificación</span>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p className="font-mono text-[10px] text-gray-400 leading-relaxed">
            Puedes canjear <strong className="text-amber-400">5 tropas de una base por 1 escudo</strong> (máx. 3 por base). Elige la base o continúa.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {eligible.length === 0 && (
              <p className="font-mono text-[10px] text-gray-600 text-center py-1">No tienes bases con ≥6 tropas para fortificar.</p>
            )}
            {eligible.map((id) => (
              <button
                key={id}
                onClick={() => onFortify(id)}
                className="flex items-center gap-2 rounded px-3 py-2 border transition-all text-left border-amber-500/40 bg-amber-950/10 hover:bg-amber-900/25"
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span className="font-tactical text-[11px] text-white flex-1 truncate">{graph[id].name}</span>
                <span className="font-mono text-[9px] text-gray-400">{boardState[id].troops} T</span>
                <span className="font-mono text-[10px] text-amber-400">{'🛡️'.repeat(boardState[id].shields || 0) || '—'}</span>
              </button>
            ))}
          </div>

          <button
            onClick={onSkip}
            className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20 py-2.5 text-xs font-bold flex items-center justify-center gap-2 mt-1"
          >
            <ArrowRight className="w-4 h-4" /> Continuar sin fortificar
          </button>
        </div>
      </div>
    </div>
  );
}
