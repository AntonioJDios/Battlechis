import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { SoundManager } from './SoundManager';
import { buildSurpriseDeck } from '../hooks/useGameState';

// Describe a drawn card for display.
function describe(card) {
  if (!card) return null;
  if (card.t === 'bomb') return { label: '💣 BOMBA ATÓMICA', sub: 'Elige una base para arrasar', bg: '#7f1d1d', glow: 'rgba(239,68,68,0.6)', anim: 'animate-wiggle' };
  if (card.t === 'nucleo') return { label: '👑 ¡VICTORIA!', sub: 'Control del NÚCLEO', bg: '#a16207', glow: 'rgba(245,208,0,0.7)', anim: 'animate-bounce' };
  if (card.t === 'endgame') return { label: '🏁 FIN DE PARTIDA', sub: 'Gana quien va líder', bg: '#4338ca', glow: 'rgba(99,102,241,0.7)', anim: 'animate-bounce' };
  const v = card.v;
  return {
    label: v > 0 ? `+${v}` : `${v}`,
    sub: v > 0 ? '¡REFUERZOS!' : '¡EMBOSCADA!',
    bg: v > 0 ? '#16a34a' : '#dc2626',
    glow: v > 0 ? 'rgba(0,230,118,0.6)' : 'rgba(255,59,59,0.6)',
    anim: v > 0 ? 'animate-bounce' : 'animate-wiggle',
  };
}

export default function SurpriseModal({ surpriseState, onDraw, players, currentTurn, graph, brutalCards }) {
  const [card, setCard] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);

  if (!surpriseState) return null;

  const { nodeId } = surpriseState;
  const currentPlayer = players[currentTurn];
  const node = graph[nodeId];
  const info = describe(card);

  const handleDraw = () => {
    if (isDrawing || card !== null) return;
    setIsDrawing(true);
    SoundManager.playRoll?.();

    setTimeout(() => {
      const deck = buildSurpriseDeck(brutalCards);
      const drawn = deck[Math.floor(Math.random() * deck.length)];
      setCard(drawn);
      setIsDrawing(false);
      SoundManager.playClick?.();

      setTimeout(() => {
        onDraw(drawn);
        setCard(null);
      }, 1700);
    }, 900);
  };

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
        <div style={{ background: 'rgba(60,40,5,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="font-tactical text-[11px] text-amber-400 font-bold uppercase tracking-widest">
            {node?.name ?? 'CASILLA SORPRESA'}
          </span>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <p className="font-mono text-[10px] text-gray-400 text-center">
            ¡{currentPlayer?.name} ha caído en una casilla sorpresa! Roba una carta.
          </p>

          {/* Card display */}
          <div style={{ height: '104px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isDrawing ? (
              <div style={{ width: '68px', height: '92px', borderRadius: '8px', border: '2px solid #f59e0b', background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px' }} className="animate-pulse">🃏</div>
            ) : info ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }} className={info.anim}>
                <div style={{
                  minWidth: '68px', height: '92px', padding: '0 8px', borderRadius: '8px',
                  background: info.bg, border: '2px solid white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: card.t === 'troops' ? '30px' : '15px', fontWeight: 900, color: 'white', textAlign: 'center',
                  boxShadow: `0 0 22px ${info.glow}`,
                }} className="font-tactical">
                  {info.label}
                </div>
                <span className="text-[10px] font-tactical font-bold text-white">{info.sub}</span>
              </div>
            ) : (
              <div style={{ width: '68px', height: '92px', borderRadius: '8px', border: '2px dashed rgba(245,158,11,0.4)', background: '#1a2035', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px', color: '#4b5563' }}>?</div>
            )}
          </div>

          {!currentPlayer?.isBot ? (
            <button
              onClick={handleDraw}
              disabled={isDrawing || card !== null}
              className="btn-tactical w-full py-2 text-xs border-amber-500 text-amber-400 bg-amber-950/20 hover:bg-amber-500/20"
            >
              🃏 Robar Carta Sorpresa
            </button>
          ) : (
            <div className="text-[10px] text-slate-500 font-mono animate-pulse text-center">🤖 Bot robando carta…</div>
          )}
        </div>
      </div>
    </div>
  );
}
