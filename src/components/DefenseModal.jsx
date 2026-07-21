import React, { useState, useEffect } from 'react';
import { ShieldCheck, Swords } from 'lucide-react';
import { FACTIONS } from '../utils/boardGraph';

// Reactive Super Defense: shown to the DEFENDER when a base of theirs is attacked
// and they hold a super-defense card. They may use it to stop the attack.
export default function DefenseModal({ defenseState, onRespond, players, graph }) {
  const [secondsLeft, setSecondsLeft] = useState(null);
  const deadline = defenseState?.deadline ?? null;

  useEffect(() => {
    if (!deadline) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  if (!defenseState) return null;
  const { destId, troops, defenderFaction } = defenseState;
  const defender = players.find((p) => p.faction === defenderFaction);
  const defColor = FACTIONS[defenderFaction]?.neon ?? '#00e676';
  const baseName = graph[destId]?.name ?? 'tu base';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 525, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        className="animate-fade-in"
        style={{
          pointerEvents: 'all',
          width: 'min(360px, 92vw)',
          background: '#0f121d',
          border: `2px solid ${defColor}`,
          borderRadius: '8px',
          boxShadow: `0 0 40px ${defColor}55, 0 8px 32px rgba(0,0,0,0.7)`,
        }}
      >
        <div style={{ background: 'rgba(8,50,30,0.9)', padding: '8px 12px', borderBottom: `1px solid ${defColor}40`, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck className="w-4 h-4 animate-pulse" style={{ color: defColor }} />
          <span className="font-tactical text-[11px] font-bold uppercase tracking-widest" style={{ color: defColor }}>¡Te atacan! Super defensa</span>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          <p className="font-mono text-[11px] text-gray-300 text-center leading-relaxed">
            Atacan <strong style={{ color: defColor }}>{baseName}</strong> con <strong>{troops}</strong> tropa(s).
            <br />¿Te defiendes tirando el dado, o sacas la carta de <strong>Super Defensa</strong>?
          </p>

          {secondsLeft !== null && (
            <div className="font-tactical text-2xl font-black" style={{ color: secondsLeft <= 5 ? '#f87171' : defColor }}>
              {secondsLeft}s
              <span className="block text-[8px] font-mono text-gray-500 text-center">sin respuesta → combate normal</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
            <button
              onClick={() => onRespond('use')}
              className="btn-tactical flex-1 py-3 text-xs font-bold border-green-500 text-green-400 bg-green-950/20 hover:bg-green-500/20 flex items-center justify-center gap-1"
            >
              <ShieldCheck className="w-4 h-4" /> 🛡️ Carta: ¡todos muertos!
            </button>
            <button
              onClick={() => onRespond('skip')}
              className="btn-tactical flex-1 py-3 text-xs font-bold border-slate-600 text-slate-300 hover:bg-slate-700/30 flex items-center justify-center gap-1"
            >
              <Swords className="w-4 h-4" /> 🎲 Tirar dado
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
