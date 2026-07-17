import React, { useState } from 'react';
import { ShieldAlert, Bomb } from 'lucide-react';
import { SoundManager } from './SoundManager';

// Siege phase: attacking a fortified base. One d6 roll destroys shields:
//   1 → -1 · 2-3 → -2 · 4-6 → -3 (all). If any shield remains, the assault is repelled.
export default function SiegeModal({ siegeState, onRoll, players, currentTurn, graph }) {
  const [rollResult, setRollResult] = useState(null);
  const [isRolling, setIsRolling] = useState(false);
  const [status, setStatus] = useState(null); // 'breach' | 'repelled'

  if (!siegeState) return null;

  const { defenderNodeId, attackForce, shields } = siegeState;
  const currentPlayer = players[currentTurn];
  const node = graph[defenderNodeId];

  const handleRoll = () => {
    if (isRolling || status !== null) return;
    setIsRolling(true);
    setRollResult(null);
    SoundManager.playRoll?.();

    setTimeout(() => {
      const roll = Math.floor(Math.random() * 6) + 1;
      const destroyed = roll === 1 ? 1 : roll <= 3 ? 2 : 3;
      const remaining = Math.max(0, (shields || 0) - destroyed);
      setRollResult(roll);
      setIsRolling(false);
      setStatus(remaining > 0 ? 'repelled' : 'breach');

      setTimeout(() => {
        onRoll(roll);
        setRollResult(null);
        setStatus(null);
      }, 1500);
    }, 900);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        className="animate-fade-in"
        style={{
          pointerEvents: 'all',
          width: 'min(340px, 92vw)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: '#0f121d',
          border: '1px solid rgba(245,158,11,0.4)',
          borderRadius: '8px',
          boxShadow: '0 0 40px rgba(245,158,11,0.25), 0 8px 32px rgba(0,0,0,0.7)',
        }}
      >
        {/* Header */}
        <div style={{ background: 'rgba(60,40,5,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldAlert className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="font-tactical text-[11px] text-amber-400 font-bold uppercase tracking-widest">
            ASEDIO: {node?.name}
          </span>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          {/* Info row */}
          <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
            <div style={{ flex: 1, background: 'rgba(30,40,70,0.5)', border: '1px solid rgba(100,120,180,0.2)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <span className="text-[9px] text-gray-500 font-mono block">FUERZA</span>
              <span className="font-tactical text-lg font-black text-white">{attackForce}</span>
            </div>
            <div style={{ flex: 1, background: 'rgba(60,40,5,0.4)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
              <span className="text-[9px] text-gray-500 font-mono block">ESCUDOS</span>
              <span className="font-tactical text-lg font-black text-amber-400">{'🛡️'.repeat(shields || 0) || '0'}</span>
            </div>
          </div>

          {/* Rule hint */}
          <div className="font-mono text-[9px] text-gray-500 text-center leading-relaxed">
            Dado 1 → −1 escudo · 2-3 → −2 · 4-6 → −3 (todos).<br/>Si queda algún escudo, el asalto se repliega.
          </div>

          {/* Dice display */}
          <div style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isRolling ? (
              <div style={{ width: '64px', height: '64px', borderRadius: '12px', border: '2px solid #f59e0b', background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }} className="animate-spin">🎲</div>
            ) : status ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }} className={status === 'breach' ? 'animate-bounce' : 'animate-wiggle'}>
                <div style={{
                  width: '64px', height: '64px', borderRadius: '12px',
                  background: status === 'breach' ? '#16a34a' : '#d97706',
                  border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '30px', fontWeight: 900, color: 'white',
                  boxShadow: status === 'breach' ? '0 0 20px rgba(0,230,118,0.6)' : '0 0 20px rgba(217,119,6,0.6)',
                }} className="font-tactical">{rollResult}</div>
                <span className={`text-[10px] font-tactical font-bold flex items-center gap-1 ${status === 'breach' ? 'text-green-400' : 'text-amber-400'}`}>
                  {status === 'breach' ? <><Bomb className="w-3 h-3" /> ¡BRECHA!</> : <><ShieldAlert className="w-3 h-3" /> REPELIDO</>}
                </span>
              </div>
            ) : (
              <div style={{ width: '64px', height: '64px', borderRadius: '12px', border: '2px solid rgba(100,120,180,0.3)', background: '#1a2035', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', color: '#4b5563' }}>—</div>
            )}
          </div>

          {/* Button */}
          {!currentPlayer?.isBot ? (
            <button
              onClick={handleRoll}
              disabled={isRolling || status !== null}
              className="btn-tactical w-full py-2 text-xs border-amber-500 text-amber-400 bg-amber-950/20 hover:bg-amber-500/20"
            >
              🎲 Lanzar Dado de Asedio
            </button>
          ) : (
            <div className="text-[10px] text-slate-500 font-mono animate-pulse text-center">🤖 Bot asediando la fortaleza…</div>
          )}
        </div>
      </div>
    </div>
  );
}
