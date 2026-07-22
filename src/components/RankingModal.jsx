import React, { useEffect, useState } from 'react';
import { Trophy, X, Loader2 } from 'lucide-react';

// Global ranking: every profile, most wins first.
export default function RankingModal({ fetchRanking, myUserId, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchRanking()
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) { setErr(e.message); setRows([]); } });
    return () => { alive = false; };
  }, [fetchRanking]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(420px, 94vw)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: '#0f121d', border: '1px solid rgba(245,196,0,0.4)', borderRadius: 8, boxShadow: '0 0 40px rgba(245,196,0,0.18), 0 8px 32px rgba(0,0,0,0.7)' }}
      >
        <div style={{ background: 'rgba(50,40,0,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(245,196,0,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Trophy className="w-4 h-4 text-yellow-400" />
          <span className="font-tactical text-[11px] text-yellow-400 font-bold uppercase tracking-widest flex-1">Ranking</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div style={{ padding: '12px 14px' }}>
          {rows === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-yellow-400 font-mono text-[11px]">
              <Loader2 className="w-5 h-5 animate-spin" /> Cargando…
            </div>
          ) : rows.length === 0 ? (
            <p className="font-mono text-[11px] text-gray-500 text-center py-8">Aún no hay partidas registradas. ¡Juega una para aparecer aquí!</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {rows.map((r, i) => {
                const isMe = r.user_id === myUserId;
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                return (
                  <div
                    key={r.user_id}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 border ${isMe ? 'border-cyan-500/50 bg-cyan-950/20' : 'border-slate-900 bg-[#0d101a]'}`}
                  >
                    <span className="font-tactical text-xs text-gray-400 w-7 text-center shrink-0">{medal}</span>
                    <span className="text-xl shrink-0">{r.avatar || '🎖️'}</span>
                    <span className={`font-tactical text-[12px] flex-1 truncate ${isMe ? 'text-cyan-300' : 'text-white'}`}>
                      {r.nickname || 'Comandante'}{isMe ? ' (tú)' : ''}
                    </span>
                    <span className="font-mono text-[11px] text-yellow-400 shrink-0">🏆 {r.games_won}</span>
                    <span className="font-mono text-[9px] text-gray-500 shrink-0">/ {r.games_played}</span>
                  </div>
                );
              })}
            </div>
          )}
          {err && <p className="font-mono text-[10px] text-red-400 text-center mt-2">{err}</p>}
        </div>
      </div>
    </div>
  );
}
