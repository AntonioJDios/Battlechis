import React, { useState, useEffect } from 'react';
import { Handshake, Swords } from 'lucide-react';
import { FACTIONS } from '../utils/boardGraph';

// Shown to the DEFENDER whose road cell an enemy is trying to cross.
// They choose: pass (let through) or block (fight). Online has a countdown.
export default function NegotiationModal({ negotiationState, onRespond, players, graph }) {
  const [secondsLeft, setSecondsLeft] = useState(null);

  const deadline = negotiationState?.deadline ?? null;

  useEffect(() => {
    if (!deadline) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  if (!negotiationState) return null;

  const { attackerFaction, defenderFaction, conflictId, troops } = negotiationState;
  const attacker = players.find(p => p.faction === attackerFaction);
  const defender = players.find(p => p.faction === defenderFaction);
  const attColor = FACTIONS[attackerFaction]?.neon ?? '#fff';
  const defColor = FACTIONS[defenderFaction]?.neon ?? '#00f0ff';
  const defRgb = FACTIONS[defenderFaction]?.rgb ?? '0, 240, 255';
  const cellName = graph[conflictId]?.name ?? 'tu casilla';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 520, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        className="animate-fade-in"
        style={{
          pointerEvents: 'all',
          width: 'min(360px, 92vw)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: '#0f121d',
          border: `2px solid ${defColor}`,
          borderRadius: '8px',
          boxShadow: `0 0 40px rgba(${defRgb},0.35), 0 8px 32px rgba(0,0,0,0.7)`,
        }}
      >
        <div style={{ background: `rgba(${defRgb},0.15)`, padding: '8px 12px', borderBottom: `1px solid rgba(${defRgb},0.3)`, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Handshake className="w-4 h-4 animate-pulse" style={{ color: defColor }} />
          <span className="font-tactical text-[11px] font-bold uppercase tracking-widest" style={{ color: defColor }}>Decisión de {defender?.name?.split(' ')[0] ?? 'defensa'}</span>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          {/* Who defends (you) */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, border: `1px solid ${defColor}`, background: `rgba(${defRgb},0.12)` }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: defColor }} />
            <span className="font-tactical text-[10px] font-bold" style={{ color: defColor }}>🛡️ DEFIENDES TÚ · {defender?.name}</span>
          </div>

          <p className="font-mono text-[11px] text-gray-300 text-center leading-relaxed">
            <strong style={{ color: attColor }}>{attacker?.name}</strong> quiere cruzar con <strong>{troops}</strong> tropa(s) por <strong>{cellName}</strong>.
            <br />¿Le dejas pasar o lo bloqueas?
          </p>

          {secondsLeft !== null && (
            <div className="font-tactical text-2xl font-black" style={{ color: secondsLeft <= 5 ? '#f87171' : '#00f0ff' }}>
              {secondsLeft}s
              <span className="block text-[8px] font-mono text-gray-500 text-center">sin respuesta → bloquear</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
            <button
              onClick={() => onRespond('pass')}
              className="btn-tactical flex-1 py-3 text-xs font-bold border-green-500 text-green-400 bg-green-950/20 hover:bg-green-500/20"
            >
              🕊️ DEJAR PASAR
            </button>
            <button
              onClick={() => onRespond('block')}
              className="btn-tactical flex-1 py-3 text-xs font-bold border-red-500 text-red-400 bg-red-950/20 hover:bg-red-500/20 flex items-center justify-center gap-1"
            >
              <Swords className="w-4 h-4" /> BLOQUEAR
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
