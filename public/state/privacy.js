// Triplette — cloisonnement des informations.
//
// Deux niveaux, jamais mélangés :
//   • publicView(state)          → ce que tous les téléphones reçoivent (en clair sur le relais) ;
//   • privateView(state, player) → la main d'UN joueur, chiffrée pour son seul téléphone.
// L'état complet (state) ne quitte jamais le téléphone de l'hôte : les 36 valeurs ne sont donc
// jamais envoyées à un navigateur pour y être simplement masquées.

export class PrivacyError extends Error {
  constructor(message) { super(message); this.name = 'PrivacyError'; }
}

/**
 * Tout ce que la table entière a le droit de connaître : les noms, le NOMBRE de cartes de chaque
 * main, les emplacements du centre, les cartes révélées pendant le tour et les trios gagnés.
 * La valeur d'une carte n'apparaît que si elle est révélée ou gagnée.
 */
export function publicView(state) {
  const shown = new Set(state.picks.filter((p) => p.from === 'center').map((p) => p.slot));
  return {
    phase: state.phase,
    n: state.n,
    mode: state.mode,
    turn: state.turn,
    step: state.step,
    reveals: state.reveals,
    current: state.current,
    first: state.first,
    outcome: state.outcome,
    players: state.players.map((p, i) => ({ name: p.name, cards: state.hands[i].length, trios: state.trios[i].slice() })),
    center: state.center.map((card, slot) => {
      if (!card) return { s: 'gone' };
      return shown.has(slot) ? { s: 'up', v: card.v } : { s: 'down' };
    }),
    picks: state.picks.map((p) => (p.from === 'center'
      ? { v: p.v, from: 'center', slot: p.slot }
      : { v: p.v, from: 'hand', seat: p.seat, end: p.end })),
    winner: state.winner,
    reason: state.reason,
  };
}

/** Ce qu'un joueur est seul à connaître : les cartes encore cachées de sa propre main, triées. */
export function privateView(state, player) {
  if (!Number.isInteger(player) || player < 0 || player >= state.n) throw new PrivacyError('Joueur inconnu.');
  return { seat: player, hand: state.hands[player].map((c) => c.v) };
}
