import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { SoundManager } from './SoundManager';
import { SURPRISE_CARDS } from '../hooks/useGameState';

export default function SurpriseModal({ surpriseState, onDraw, players, currentTurn, graph }) {
  const [card, setCard] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);

  if (!surpriseState) return null;

  const { nodeId } = surpriseState;
  const currentPlayer = players[currentTurn];
  const node = graph[nodeId];

  const handleDraw = () => {
    if (isDrawing || card !== null) return;
    setIsDrawing(true);
    SoundManager.playRoll?.();

    setTimeout(() => {
      const drawn = SURPRISE_CARDS[Math.floor(Math.random() * SURPRISE_CARDS.length)];
      setCard(drawn);
      setIsDrawing(false);
      SoundManager.playClick?.();

      setTimeout(() => {
        onDraw(drawn);
        setCard(null);
      }, 1600);
    }, 900);
  };

  const isPositive = card !== null && card > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        className="animate-fade-in"
        style={{
          pointerEvents: 'all',
          width: 'min(320px, 92vw)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: '#0f121d',
          border: '1px solid rgba(245,158,11,0.45)',
          borderRadius: '8px',
          boxShadow: '0 0 40px rgba(245,158,11,0.25), 0 8px 32px rgba(0,0,0,0.7)',
        }}
      >
        {/* Header */}
        <div style={{ background: 'rgba(60,40,5,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="font-tactical text-[11px] text-amber-400 font-bold uppercase tracking-widest">
            {node?.name ?? 'CASILLA SORPRESA'}
          </span>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <p className="font-mono text-[10px] text-gray-400 text-center">
            ¡{currentPlayer?.name} ha caído en una casilla sorpresa! Roba una carta: tus tropas aquí pueden ganar o perder efectivos.
          </p>

          {/* Card display */}
          <div style={{ height: '96px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isDrawing ? (
              <div style={{ width: '64px', height: '88px', borderRadius: '8px', border: '2px solid #f59e0b', background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }} className="animate-pulse">
                🃏
              </div>
            ) : card !== null ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }} className={isPositive ? 'animate-bounce' : 'animate-wiggle'}>
                <div style={{
                  width: '64px', height: '88px', borderRadius: '8px',
                  background: isPositive ? '#16a34a' : '#dc2626',
                  border: '2px solid white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '26px', fontWeight: 900, color: 'white',
                  boxShadow: isPositive ? '0 0 20px rgba(0,230,118,0.6)' : '0 0 20px rgba(255,59,59,0.6)',
                }} className="font-tactical">
                  {card > 0 ? `+${card}` : card}
                </div>
                <span className={`text-[10px] font-tactical font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                  {isPositive ? '¡REFUERZOS!' : '¡EMBOSCADA!'}
                </span>
              </div>
            ) : (
              <div style={{ width: '64px', height: '88px', borderRadius: '8px', border: '2px dashed rgba(245,158,11,0.4)', background: '#1a2035', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', color: '#4b5563' }}>
                ?
              </div>
            )}
          </div>

          {/* Button */}
          {!currentPlayer?.isBot ? (
            <button
              onClick={handleDraw}
              disabled={isDrawing || card !== null}
              className="btn-tactical w-full py-2 text-xs border-amber-500 text-amber-400 bg-amber-950/20 hover:bg-amber-500/20"
            >
              🃏 Robar Carta Sorpresa
            </button>
          ) : (
            <div className="text-[10px] text-slate-500 font-mono animate-pulse text-center">
              🤖 Bot robando carta...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
