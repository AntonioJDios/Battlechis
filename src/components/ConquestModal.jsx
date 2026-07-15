import React, { useState } from 'react';
import { Target, Award, ShieldAlert } from 'lucide-react';
import { SoundManager } from './SoundManager';

export default function ConquestModal({ conquestState, onRoll, players, currentTurn, graph }) {
  const [rollResult, setRollResult] = useState(null);
  const [isRolling, setIsRolling] = useState(false);
  const [status, setStatus] = useState(null);

  if (!conquestState) return null;

  const { nodeId, invadingForce } = conquestState;
  const currentPlayer = players[currentTurn];
  const node = graph[nodeId];

  const handleRoll = () => {
    if (isRolling || status !== null) return;
    setIsRolling(true);
    setRollResult(null);
    setStatus(null);
    SoundManager.playRoll?.();

    setTimeout(() => {
      const roll = Math.floor(Math.random() * 6) + 1;
      setRollResult(roll);
      setIsRolling(false);
      setStatus(roll >= 2 ? 'success' : 'fail');

      setTimeout(() => {
        onRoll(roll);
        setRollResult(null);
        setStatus(null);
      }, 1400);
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
        border: '1px solid rgba(0,240,255,0.35)',
        borderRadius: '8px',
        boxShadow: '0 0 40px rgba(0,240,255,0.2), 0 8px 32px rgba(0,0,0,0.7)',
      }}
    >
      {/* Header */}
      <div style={{ background: 'rgba(8,40,60,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(0,240,255,0.15)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Target className="w-4 h-4 text-cyan-400 animate-pulse" />
        <span className="font-tactical text-[11px] text-cyan-400 font-bold uppercase tracking-widest">
          ASALTO: {node?.name}
        </span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        {/* Info row */}
        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <div style={{ flex: 1, background: 'rgba(30,40,70,0.5)', border: '1px solid rgba(100,120,180,0.2)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
            <span className="text-[9px] text-gray-500 font-mono block">FUERZA</span>
            <span className="font-tactical text-lg font-black text-white">{invadingForce}</span>
          </div>
          <div style={{ flex: 1, background: 'rgba(10,50,20,0.4)', border: '1px solid rgba(0,200,100,0.2)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
            <span className="text-[9px] text-gray-500 font-mono block">CAPTURA</span>
            <span className="font-tactical text-lg font-black text-green-400">2 – 6</span>
          </div>
          <div style={{ flex: 1, background: 'rgba(80,10,10,0.4)', border: '1px solid rgba(200,50,50,0.2)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
            <span className="text-[9px] text-gray-500 font-mono block">RETROCESO</span>
            <span className="font-tactical text-lg font-black text-red-400">1</span>
          </div>
        </div>

        {/* Dice display */}
        <div style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isRolling ? (
            <div style={{ width: '64px', height: '64px', borderRadius: '12px', border: '2px solid var(--neon-cyan)', background: 'rgba(0,240,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }} className="animate-spin">
              🎲
            </div>
          ) : status === 'success' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }} className="animate-bounce">
              <div style={{ width: '64px', height: '64px', borderRadius: '12px', background: '#16a34a', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px', fontWeight: 900, color: 'white', boxShadow: '0 0 20px rgba(0,230,118,0.6)' }} className="font-tactical">
                {rollResult}
              </div>
              <span className="text-[10px] text-green-400 font-tactical font-bold flex items-center gap-1">
                <Award className="w-3 h-3" /> CONQUISTADO
              </span>
            </div>
          ) : status === 'fail' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }} className="animate-wiggle">
              <div style={{ width: '64px', height: '64px', borderRadius: '12px', background: '#d97706', border: '2px solid white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px', fontWeight: 900, color: 'white', boxShadow: '0 0 20px rgba(217,119,6,0.6)' }} className="font-tactical">
                {rollResult}
              </div>
              <span className="text-[10px] text-red-400 font-tactical font-bold flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> RETROCESO
              </span>
            </div>
          ) : (
            <div style={{ width: '64px', height: '64px', borderRadius: '12px', border: '2px solid rgba(100,120,180,0.3)', background: '#1a2035', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', color: '#4b5563' }}>
              —
            </div>
          )}
        </div>

        {/* Button */}
        {!currentPlayer?.isBot ? (
          <button
            onClick={handleRoll}
            disabled={isRolling || status !== null}
            className="btn-tactical w-full py-2 text-xs border-cyan-500 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20"
          >
            🎲 Lanzar Dado de Asalto
          </button>
        ) : (
          <div className="text-[10px] text-slate-500 font-mono animate-pulse text-center">
            🤖 Bot realizando asalto...
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
