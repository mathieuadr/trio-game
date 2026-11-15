// Triplette — moteur de règles pur.
// Chaque action reçoit un état et renvoie un NOUVEL état ; rien n'est modifié en place.
// Le hasard est injecté (`rng`) pour que les tests soient reproductibles.
//
// L'état complet ne vit que sur le téléphone de l'hôte :
//   hands[j]   cartes encore cachées dans la main du joueur j, toujours triées par valeur croissante
//   center[s]  carte posée à l'emplacement s du centre (l'emplacement ne bouge jamais), ou null si elle a été gagnée
//   picks      cartes révélées pendant le tour en cours, dans l'ordre, avec leur origine
//   trios[j]   valeurs des trios gagnés par le joueur j
//
// Déroulement : play → (révélations) → resolve → settle() → play … → over

import { MIN_PLAYERS, MAX_PLAYERS, MODE, COPIES, buildDeck, dealSizes, victory } from './rules.js';

export const STATE_VERSION = 1;
export const END = Object.freeze({ LOW: 'low', HIGH: 'high' });

export class RuleError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'RuleError';
    this.code = code;
  }
}

const clone = (s) => JSON.parse(JSON.stringify(s));
const byValue = (a, b) => a.v - b.v || a.id - b.id;

/** Mélange de Fisher–Yates (renvoie une copie). */
export function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createGame({ names, mode = MODE.NORMAL, firstPlayer = 0 }, rng = Math.random) {
  const n = Array.isArray(names) ? names.length : 0;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new RuleError('bad-players', `Il faut entre ${MIN_PLAYERS} et ${MAX_PLAYERS} joueurs.`);
  if (!Object.values(MODE).includes(mode)) throw new RuleError('bad-mode');
  if (!Number.isInteger(firstPlayer) || firstPlayer < 0 || firstPlayer >= n) throw new RuleError('bad-first-player');
  const { hand, center } = dealSizes(n);
  const deck = shuffle(buildDeck(), rng);
  const hands = Array.from({ length: n }, (_, j) => deck.slice(j * hand, (j + 1) * hand).sort(byValue));
  return {
    v: STATE_VERSION,
    n,
    mode,
    players: names.map((name) => ({ name: String(name) })),
    hands,
    center: deck.slice(n * hand, n * hand + center),
    picks: [],
    trios: Array.from({ length: n }, () => []),
    won: [], // identifiants des cartes retirées du jeu
    current: firstPlayer,
    first: firstPlayer,
    turn: 1,
    step: 0, // compteur d'actions : sert à écarter une action envoyée deux fois ou arrivée trop tard
    reveals: 0,
    phase: 'play',
    outcome: null, // 'miss' | 'trio' pendant la phase resolve (et 'trio' en fin de partie)
    winner: null,
    reason: null,
  };
}

function assertTurn(state, player) {
  if (state.phase !== 'play') throw new RuleError(state.phase === 'over' ? 'game-over' : 'not-playing');
  if (!Number.isInteger(player) || player < 0 || player >= state.n) throw new RuleError('bad-player');
  if (player !== state.current) throw new RuleError('not-your-turn');
}

/** Enregistre une carte révélée et applique la règle de comparaison. */
function reveal(s, pick) {
  s.picks.push(pick);
  s.step += 1;
  s.reveals += 1;
  if (pick.v !== s.picks[0].v) {
    // deux valeurs différentes : le tour s'arrête là, les cartes restent visibles jusqu'à settle()
    s.phase = 'resolve';
    s.outcome = 'miss';
    return s;
  }
  if (s.picks.length < COPIES) return s; // identique : le joueur continue
  // trois cartes identiques : le trio quitte définitivement le jeu
  for (const p of s.picks) {
    if (p.from === 'center') s.center[p.slot] = null;
    s.won.push(p.id);
  }
  s.trios[s.current].push(pick.v);
  s.outcome = 'trio';
  const reason = victory(s.trios[s.current], s.mode);
  if (reason) {
    s.phase = 'over';
    s.winner = s.current;
    s.reason = reason;
  } else {
    s.phase = 'resolve';
  }
  return s;
}

/** Le joueur actif retourne la carte cachée de l'emplacement `slot` du centre. */
export function revealCenter(state, player, slot) {
  assertTurn(state, player);
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.center.length) throw new RuleError('bad-slot');
  const card = state.center[slot];
  if (!card) throw new RuleError('slot-empty');
  if (state.picks.some((p) => p.from === 'center' && p.slot === slot)) throw new RuleError('already-shown');
  return reveal(clone(state), { id: card.id, v: card.v, from: 'center', slot });
}

/**
 * Le joueur actif révèle la plus petite (`low`) ou la plus grande (`high`) carte encore cachée
 * de la main du joueur `seat` (lui-même compris). C'est le moteur qui trouve la carte : on ne
 * peut jamais désigner une carte du milieu d'une main.
 */
export function revealHand(state, player, seat, end) {
  assertTurn(state, player);
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.n) throw new RuleError('bad-seat');
  if (end !== END.LOW && end !== END.HIGH) throw new RuleError('bad-end');
  if (!state.hands[seat].length) throw new RuleError('empty-hand');
  const s = clone(state);
  const card = end === END.LOW ? s.hands[seat].shift() : s.hands[seat].pop();
  return reveal(s, { id: card.id, v: card.v, from: 'hand', seat, end });
}

/**
 * Fin du tour. Après un échec, chaque carte retourne d'où elle vient : celles du centre se
 * retournent face cachée à leur emplacement, celles des mains reprennent leur place dans la
 * main triée de leur propriétaire. Après un trio, il n'y a rien à rendre. Le joueur suivant
 * (sens horaire) commence son tour : gagner un trio ne fait pas rejouer.
 */
export function settle(state) {
  if (state.phase !== 'resolve') throw new RuleError('not-resolve');
  const s = clone(state);
  if (s.outcome === 'miss') {
    for (const p of s.picks) if (p.from === 'hand') s.hands[p.seat].push({ id: p.id, v: p.v });
    for (const hand of s.hands) hand.sort(byValue);
  }
  s.picks = [];
  s.outcome = null;
  s.current = (s.current + 1) % s.n;
  s.turn += 1;
  s.step += 1;
  s.phase = 'play';
  return s;
}

/** Toutes les révélations permises au joueur actif. */
export function legalMoves(state) {
  if (state.phase !== 'play') return [];
  const out = [];
  const shown = new Set(state.picks.filter((p) => p.from === 'center').map((p) => p.slot));
  state.center.forEach((card, slot) => { if (card && !shown.has(slot)) out.push({ from: 'center', slot }); });
  state.hands.forEach((hand, seat) => {
    if (!hand.length) return;
    out.push({ from: 'hand', seat, end: END.LOW });
    if (hand.length > 1) out.push({ from: 'hand', seat, end: END.HIGH });
  });
  return out;
}

/** Applique une révélation décrite comme dans `legalMoves`. */
export function play(state, player, move) {
  if (move?.from === 'center') return revealCenter(state, player, move.slot);
  if (move?.from === 'hand') return revealHand(state, player, move.seat, move.end);
  throw new RuleError('bad-move');
}
