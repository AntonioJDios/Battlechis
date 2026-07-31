import React from 'react';
import { FACTIONS } from '../utils/boardGraph';

// Compact, always-visible live leaderboard: each player's bases + troops, sorted
// by who's leading (most bases, then most troops). The leader gets a 👑.
export default function Scoreboard({ players, boardState, getBasesCount, currentTurn }) {
  const troopsOf = (faction) => {
    let t = 0;
    for (const id in boardState) {
      if (boardState[id]?.occupyingFaction === faction) t += boardState[id].troops || 0;
    }
    return t;
  };

  const rows = players
    .map((p) => ({ ...p, bases: getBasesCount(p.faction), troops: troopsOf(p.faction) }))
    .sort((a, b) => {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      if (b.bases !== a.bases) return b.bases - a.bases;
      return b.troops - a.troops;
    });
  const leaderId = rows.find((r) => !r.eliminated)?.id;

  return (
    <div className="w-full flex gap-1.5 overflow-x-auto pb-1 shrink-0 scrollbar">
      {rows.map((r) => {
        const f = FACTIONS[r.faction];
        const active = players[currentTurn]?.faction === r.faction && !r.eliminated;
        return (
          <div
            key={r.id}
            className="flex items-center gap-1.5 px-2 py-1 rounded shrink-0"
            style={{
              background: r.eliminated ? 'rgba(255,255,255,0.02)' : `rgba(${f.rgb},0.10)`,
              border: `1px solid ${active ? f.neon : `rgba(${f.rgb},0.35)`}`,
              opacity: r.eliminated ? 0.45 : 1,
            }}
            title={`${r.name}: ${r.bases} bases, ${r.troops} tropas${r.eliminated ? ' (eliminado)' : ''}`}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.neon, flexShrink: 0 }} />
            <span className="font-tactical text-[10px] text-white truncate" style={{ maxWidth: 74 }}>{r.name}</span>
            {r.id === leaderId && !r.eliminated && <span className="text-[11px] leading-none">👑</span>}
            <span className="font-mono text-[10px] text-gray-300 whitespace-nowrap">🏰{r.bases} · ⚔️{r.troops}</span>
          </div>
        );
      })}
    </div>
  );
}
