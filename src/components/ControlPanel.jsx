import React from 'react';
import { RefreshCw } from 'lucide-react';
import { SoundManager } from './SoundManager';

export default function ControlPanel({
  phase,
  currentTurn,
  players,
  diceRoll,
  sixCount,
  recruitmentTroops,
  rollMovement,
  endTurn,
  selectedNode,
  highlightedNodes,
  onReinforce,
  troopsToMove,
  onTroopsChange,
  maxMovable
}) {
  const currentPlayer = players[currentTurn];

  const getBriefingText = () => {
    if (phase === 'RECRUIT') return `Despliega +${recruitmentTroops} tropas en tus bases.`;
    if (phase === 'MOVE') {
      if (diceRoll === null) return 'Lanza el dado para calcular alcance de movimiento.';
      if (!selectedNode) return `Dado: ${diceRoll} pasos. Selecciona una unidad con >1 tropa.`;
      return `Elige destino. Envías ${troopsToMove} tropa(s), dejas ${maxMovable - troopsToMove + 1} atrás.`;
    }
    if (phase === 'COMBAT') return 'Combate en curso — esperando resolución de dados.';
    if (phase === 'CONQUER') return 'Asalto a base neutral. Necesitas 5 o 6 para capturarla.';
    return 'Sistema en espera...';
  };

  return (
    <div className="tactical-panel bg-[#101424]/95 border-slate-800 rounded-md">
      <div className="panel-header bg-[#151a30] flex items-center gap-1.5">
        <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" style={{ animationDuration: '6s' }} />
        <span>CONSOLA DE MANDO</span>
      </div>

      <div className="control-panel-body p-3 flex flex-col gap-2">

        {/* Briefing text */}
        <p className="text-[10px] text-gray-400 font-mono leading-snug">{getBriefingText()}</p>

        {/* Main action row: dice + buttons */}
        <div className="flex gap-2 items-center">

          {/* Dice: lanzar button */}
          {phase === 'MOVE' && diceRoll === null && !currentPlayer?.isBot && (
            <button
              onClick={() => { SoundManager.playRoll?.(); rollMovement(); }}
              className="flex-1 py-2 rounded-lg border-2 border-dashed border-cyan-500/60 bg-[#121625] text-cyan-400 text-xs font-tactical font-bold animate-pulse text-center"
            >
              🎲 LANZAR DADO
            </button>
          )}

          {/* Dice: result — simple large number */}
          {phase === 'MOVE' && diceRoll !== null && (
            <div
              className="relative w-12 h-12 rounded-lg shrink-0 flex items-center justify-center text-2xl font-black text-cyan-400"
              style={{ border: '2px solid var(--neon-cyan)', boxShadow: '0 0 12px rgba(0,240,255,0.3)', background: '#121625' }}
            >
              {diceRoll}
              {sixCount > 0 && (
                <div className="absolute -top-1.5 -right-1.5 bg-green-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-tactical text-[8px] font-bold border border-white">
                  ×{sixCount + 1}
                </div>
              )}
            </div>
          )}

          {/* RECRUIT: deploy all to HQ */}
          {phase === 'RECRUIT' && !currentPlayer?.isBot && (
            <button
              onClick={() => onReinforce('hq_' + currentPlayer.faction, recruitmentTroops)}
              className="flex-1 py-2 px-2 rounded border border-red-500/80 text-red-400 bg-red-950/30 hover:bg-red-500/20 font-tactical text-[10px] font-bold animate-pulse-border text-center"
              style={{ clipPath: 'polygon(8% 0%, 100% 0%, 92% 100%, 0% 100%)' }}
            >
              +{recruitmentTroops} en HQ
            </button>
          )}

          {/* MOVE: pass turn */}
          {phase === 'MOVE' && diceRoll !== null && !currentPlayer?.isBot && (
            <button
              onClick={endTurn}
              className="flex-1 py-2 px-2 rounded border border-gray-700 text-gray-400 hover:text-white hover:border-white font-tactical text-[10px] text-center"
              style={{ clipPath: 'polygon(8% 0%, 100% 0%, 92% 100%, 0% 100%)' }}
            >
              Pasar turno
            </button>
          )}

          {/* BOT indicator */}
          {currentPlayer?.isBot && (
            <div className="flex-1 text-center py-1.5 border border-dashed border-cyan-500/30 rounded text-cyan-400 animate-pulse text-[10px] font-tactical">
              🤖 IA procesando...
            </div>
          )}
        </div>

        {/* Troop selector — visible when unit selected and targets exist */}
        {phase === 'MOVE' && selectedNode && highlightedNodes.length > 0 && !currentPlayer?.isBot && (
          <div className="flex items-center gap-2 bg-[#0d101a] rounded border border-cyan-500/20 px-2 py-1.5">
            <span className="text-[10px] text-gray-400 font-mono flex-1">Tropas a enviar:</span>
            <button
              onClick={() => onTroopsChange(Math.max(1, troopsToMove - 1))}
              className="w-6 h-6 rounded border border-slate-700 text-gray-300 hover:text-cyan-400 hover:border-cyan-400 font-bold flex items-center justify-center text-base leading-none"
            >−</button>
            <span className="text-cyan-400 font-black text-sm w-7 text-center">{troopsToMove}</span>
            <button
              onClick={() => onTroopsChange(Math.min(maxMovable, troopsToMove + 1))}
              className="w-6 h-6 rounded border border-slate-700 text-gray-300 hover:text-cyan-400 hover:border-cyan-400 font-bold flex items-center justify-center text-base leading-none"
            >+</button>
            <span className="text-[9px] text-gray-600 w-8">/{maxMovable}</span>
          </div>
        )}

      </div>
    </div>
  );
}
