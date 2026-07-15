import React, { useState } from 'react';
import { FACTIONS } from '../utils/boardGraph';
import { Swords, LogOut, Zap } from 'lucide-react';
import { SoundManager } from './SoundManager';

function Die({ value, color, label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 9, color: '#6b7280', fontFamily: 'var(--font-tactical)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
      <div style={{
        width: 52, height: 52,
        borderRadius: 10,
        border: `2px solid ${color}`,
        background: `${color}18`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: value ? 28 : 22,
        fontWeight: 900,
        color: value ? color : '#374151',
        boxShadow: value ? `0 0 14px ${color}50` : 'none',
        fontFamily: 'var(--font-tactical)',
        transition: 'all 0.2s',
      }}>
        {value ?? '?'}
      </div>
    </div>
  );
}

export default function CombatModal({ combatState, onRollRound, onRetreat, onRetreatDefender, players }) {
  const [isRolling, setIsRolling] = useState(false);

  if (!combatState) return null;

  const { attackerFaction, defenderFaction, attackerTroops, defenderTroops, lastAttRoll, lastDefRoll, log } = combatState;
  const attacker = players.find(p => p.faction === attackerFaction);
  const defender = players.find(p => p.faction === defenderFaction);
  const attF = FACTIONS[attackerFaction];
  const defF = FACTIONS[defenderFaction];

  const attWon = lastAttRoll !== null && lastAttRoll > lastDefRoll;
  const defWon = lastDefRoll !== null && lastDefRoll >= lastAttRoll;

  const handleRoll = () => {
    setIsRolling(true);
    SoundManager.playRoll?.();
    setTimeout(() => { setIsRolling(false); onRollRound(false); }, 600);
  };

  const handleAuto = () => {
    setIsRolling(true);
    SoundManager.playRoll?.();
    setTimeout(() => { setIsRolling(false); onRollRound(true); }, 400);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        className="animate-fade-in"
        style={{
          pointerEvents: 'all',
          width: 'min(320px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: '#0f121d',
          border: '1px solid rgba(255,59,59,0.4)',
          borderRadius: '10px',
          boxShadow: '0 0 40px rgba(255,59,59,0.2), 0 8px 32px rgba(0,0,0,0.8)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ background: 'rgba(60,10,10,0.9)', padding: '8px 14px', borderBottom: '1px solid rgba(255,59,59,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Swords className="w-4 h-4 text-red-400 animate-pulse" />
          <span className="font-tactical text-[11px] text-red-400 font-bold uppercase tracking-widest">COMBATE TÁCTICO</span>
        </div>

        {/* Troop counts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, padding: '12px 14px 8px', alignItems: 'center' }}>
          <div style={{ background: `${attF?.neon}14`, border: `1px solid ${attF?.neon}30`, borderRadius: 8, padding: '8px', textAlign: 'center' }}>
            <div className="font-tactical text-[9px] text-gray-400 truncate mb-1">{attacker?.name?.split(' ')[0]}</div>
            <div className="font-tactical text-2xl font-black text-white">{attackerTroops}<span className="text-[9px] text-gray-500 ml-0.5">T</span></div>
            <div className="text-[8px] text-gray-600 mt-0.5">ATACANTE</div>
          </div>
          <div className="font-tactical text-xs text-gray-600 font-bold">VS</div>
          <div style={{ background: `${defF?.neon}14`, border: `1px solid ${defF?.neon}30`, borderRadius: 8, padding: '8px', textAlign: 'center' }}>
            <div className="font-tactical text-[9px] text-gray-400 truncate mb-1">{defender?.name?.split(' ')[0]}</div>
            <div className="font-tactical text-2xl font-black text-white">{defenderTroops}<span className="text-[9px] text-gray-500 ml-0.5">T</span></div>
            <div className="text-[8px] text-gray-600 mt-0.5">DEFENSOR</div>
          </div>
        </div>

        {/* Dice result */}
        <div style={{ padding: '8px 14px 12px', display: 'flex', justifyContent: 'center', gap: 24, alignItems: 'flex-end' }}>
          <Die value={isRolling ? null : lastAttRoll} color={attF?.neon ?? '#ff3b3b'} label="Ataque" />
          <div style={{ paddingBottom: 14, fontSize: 18, color: '#374151', fontWeight: 900 }}>⚔</div>
          <Die value={isRolling ? null : lastDefRoll} color={defF?.neon ?? '#0088ff'} label="Defensa" />
        </div>

        {/* Last round result */}
        {!isRolling && lastAttRoll !== null && (
          <div style={{ margin: '0 14px 10px', padding: '6px 10px', borderRadius: 6, background: attWon ? 'rgba(0,200,80,0.1)' : 'rgba(255,59,59,0.1)', border: `1px solid ${attWon ? 'rgba(0,200,80,0.3)' : 'rgba(255,59,59,0.3)'}` }}>
            <p className="font-mono text-[10px] text-center" style={{ color: attWon ? '#4ade80' : '#f87171' }}>
              {attWon ? `✓ Atacante gana — defensor pierde 1 tropa` : lastAttRoll === lastDefRoll ? `⚖ Empate — defensor aguanta` : `✗ Defensor aguanta — atacante pierde 1 tropa`}
            </p>
          </div>
        )}
        {isRolling && (
          <div style={{ margin: '0 14px 10px', textAlign: 'center' }}>
            <span className="font-tactical text-[10px] text-amber-400 animate-pulse">LANZANDO DADOS...</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '8px 14px 12px', borderTop: '1px solid rgba(255,59,59,0.1)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!attacker?.isBot ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <button onClick={onRetreat} disabled={isRolling}
                className="btn-tactical text-[10px] py-2 border-amber-500/50 text-amber-400 hover:bg-amber-500/10">
                <LogOut className="w-3 h-3" /> Retirar
              </button>
              <button onClick={handleAuto} disabled={isRolling}
                className="btn-tactical text-[10px] py-2 border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10">
                <Zap className="w-3 h-3" /> Auto
              </button>
              <button onClick={handleRoll} disabled={isRolling}
                className="btn-tactical text-[10px] py-2 border-red-500/80 text-red-400 bg-red-950/30 hover:bg-red-500/20">
                <Swords className="w-3 h-3" /> Atacar
              </button>
            </div>
          ) : (
            <div className="w-full text-center text-[10px] text-slate-500 font-mono animate-pulse">
              🤖 Bot resolviendo combate...
            </div>
          )}

          {/* Defender retreat — available when defender is human */}
          {!defender?.isBot && onRetreatDefender && (
            <button onClick={onRetreatDefender} disabled={isRolling}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
              className="btn-tactical text-[10px] py-2 border-orange-500/50 text-orange-400 hover:bg-orange-500/10">
              <LogOut className="w-3 h-3" />
              Defensor: Huir a base más cercana
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
