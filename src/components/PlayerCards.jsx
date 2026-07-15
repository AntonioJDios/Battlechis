import React from 'react';
import { Shield, Target, User, Cpu, AlertTriangle } from 'lucide-react';
import { FACTIONS } from '../utils/boardGraph';

export default function PlayerCards({ players, currentTurn, boardState, getBasesCount }) {
  
  // Calculate total troops on board for a player
  const calculateTotalTroops = (faction) => {
    let total = 0;
    Object.keys(boardState).forEach(nodeId => {
      const state = boardState[nodeId];
      if (state.occupyingFaction === faction) {
        total += state.troops;
      }
    });
    return total;
  };

  const getBasesControlled = (faction) => {
    let count = 0;
    Object.keys(boardState).forEach(nodeId => {
      const state = boardState[nodeId];
      if (state.occupyingFaction === faction) {
        // In our state graph, we check if it is hq, neutral, or center
        // To be safe, let's pass a function or calculate directly
        count++; // A simple approximation or count of all nodes occupied
      }
    });
    return count;
  };

  return (
    <div className="w-full flex flex-col gap-2">
      {players.map((player, idx) => {
        const isActive = currentTurn === idx;
        const totalTroops = calculateTotalTroops(player.faction);
        const controlledBases = getBasesCount ? getBasesCount(player.faction) : getBasesControlled(player.faction);
        const factionInfo = FACTIONS[player.faction];
        
        // CSS border class
        let borderClass = 'border-slate-800';
        let glowStyle = {};
        if (player.eliminated) {
          borderClass = 'border-red-950/40 opacity-40';
        } else if (isActive) {
          borderClass = `border-faction-${player.color}`;
          glowStyle = {
            boxShadow: `0 0 15px rgba(${factionInfo.rgb}, 0.25), inset 0 0 10px rgba(${factionInfo.rgb}, 0.15)`
          };
        }

        return (
          <div
            key={player.id}
            className={`tactical-panel transition-all duration-300 border bg-[#101424]/90 rounded-md overflow-hidden ${borderClass}`}
            style={{
              ...glowStyle,
              borderLeftWidth: '4px'
            }}
          >
            {/* Header / Active indicator */}
            <div 
              className="px-3 py-1.5 flex justify-between items-center bg-[#151a30]"
              style={{
                borderLeftColor: factionInfo.neon
              }}
            >
              <span className="font-tactical text-[9px] font-bold text-gray-400 tracking-wider">
                COMANDANTE
              </span>
              
              {player.eliminated ? (
                <span className="flex items-center gap-1 text-[8px] font-mono text-red-500 bg-red-950/40 px-1 border border-red-800/40 rounded">
                  <AlertTriangle className="w-2.5 h-2.5" /> KIA
                </span>
              ) : isActive ? (
                <span 
                  className="w-2 h-2 rounded-full animate-ping"
                  style={{ backgroundColor: factionInfo.neon }}
                ></span>
              ) : (
                <span className="text-[8px] font-mono text-gray-500">STANDBY</span>
              )}
            </div>

            {/* Profile contents */}
            <div className="p-3 flex items-center gap-3">
              {/* Silhouette Avatar */}
              <div 
                className="w-10 h-10 rounded border flex items-center justify-center bg-[#0d101a]"
                style={{
                  borderColor: isActive ? factionInfo.neon : 'rgba(255,255,255,0.08)'
                }}
              >
                {player.isBot ? (
                  <Cpu className="w-5 h-5" style={{ color: factionInfo.neon }} />
                ) : (
                  <User className="w-5 h-5" style={{ color: factionInfo.neon }} />
                )}
              </div>

              {/* Text metadata */}
              <div className="flex-1 min-w-0">
                <h4 className="font-tactical text-xs font-bold text-white truncate leading-tight">
                  {player.name}
                </h4>
                <span className="text-[9px] text-gray-400 font-mono flex items-center gap-1 mt-0.5">
                  {player.isBot ? '🤖 IA TÁCTICA' : '👤 HUMANO'}
                </span>
              </div>
            </div>

            {/* Statistical indicators */}
            {!player.eliminated && (
              <div className="grid grid-cols-2 border-t border-slate-900 bg-[#0e111d]/50 text-center font-stats py-1.5">
                <div className="border-r border-slate-900 flex flex-col justify-center">
                  <span className="text-[8px] text-gray-500 tracking-wider flex items-center justify-center gap-0.5 uppercase">
                    <Target className="w-2.5 h-2.5" /> Bases
                  </span>
                  <span className="text-sm font-black text-white">{controlledBases}</span>
                </div>
                <div className="flex flex-col justify-center">
                  <span className="text-[8px] text-gray-500 tracking-wider flex items-center justify-center gap-0.5 uppercase">
                    <Shield className="w-2.5 h-2.5" /> Tropas
                  </span>
                  <span className="text-sm font-black text-white">{totalTroops}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
