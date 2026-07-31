// Catálogo de logros/medallas. El `code` se guarda en battlechis_achievements.
export const ACHIEVEMENTS = [
  { code: 'win_first',      icon: '🥇', name: 'Primera victoria',  desc: 'Gana tu primera partida.' },
  { code: 'win_nucleo',     icon: '👑', name: 'Amo del Núcleo',    desc: 'Gana controlando el NÚCLEO.' },
  { code: 'win_domination', icon: '🌍', name: 'Dominador',         desc: 'Gana por dominación (60% de bases).' },
  { code: 'win_survivor',   icon: '💀', name: 'Último en pie',      desc: 'Gana eliminando a todos los rivales.' },
  { code: 'won_5',          icon: '🎖️', name: 'Veterano',          desc: 'Gana 5 partidas.' },
  { code: 'played_10',      icon: '🎮', name: 'Habitual',          desc: 'Juega 10 partidas.' },
];

// Medallas que se ganan al VENCER, según el motivo de la victoria (winner.reason).
export function achievementsForWin(reason = '') {
  const out = ['win_first'];
  if (/N[úu]cleo/i.test(reason)) out.push('win_nucleo');
  else if (/Dominaci[óo]n/i.test(reason)) out.push('win_domination');
  else if (/[ÚU]ltimo/i.test(reason)) out.push('win_survivor');
  return out;
}
