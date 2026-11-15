// Outils communs aux tests du moteur.
import { createGame, settle, legalMoves, play, shuffle } from '../public/engine/game.js';
import { DECK_SIZE, COPIES, VALUES, dealSizes, victory } from '../public/engine/rules.js';

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NAMES = ['Ada', 'Bo', 'Cléo', 'Dan', 'Eve', 'Flo'];
export const names = (n) => NAMES.slice(0, n);

/**
 * Fabrique une partie dont on choisit les cartes : `hands` (une liste de valeurs par joueur) et
 * `center` (valeurs, dans l'ordre des emplacements). Les identifiants sont attribués pour que les
 * exemplaires d'une même valeur restent distincts. `strict` vérifie que c'est une vraie donne de 36 cartes.
 */
export function rig({ hands, center, mode = 'normal', first = 0, strict = true }) {
  const n = hands.length;
  const base = createGame({ names: names(n), mode, firstPlayer: first }, seeded(1));
  const used = {};
  const card = (v) => {
    used[v] = (used[v] || 0) + 1;
    if (used[v] > COPIES) throw new Error(`plus de ${COPIES} cartes de valeur ${v}`);
    return { id: (v - 1) * COPIES + used[v] - 1, v };
  };
  const state = {
    ...base,
    hands: hands.map((h) => h.map(card).sort((a, b) => a.v - b.v || a.id - b.id)),
    center: center.map(card),
  };
  if (strict) {
    const { hand, center: c } = dealSizes(n);
    const total = state.hands.flat().length + state.center.length;
    if (total !== DECK_SIZE || state.center.length !== c || state.hands.some((h) => h.length !== hand)) throw new Error('donne incomplète');
  }
  return state;
}

/** Donne à 3 joueurs : les 1 et les 12 aux extrémités des mains, les 7 au milieu. */
export const tableA = (opts = {}) => rig({
  hands: [
    [1, 1, 2, 5, 5, 7, 8, 11, 12],
    [1, 2, 3, 3, 6, 7, 9, 10, 12],
    [2, 4, 4, 6, 7, 9, 10, 11, 12],
  ],
  center: [3, 4, 5, 6, 8, 8, 9, 10, 11],
  ...opts,
});

/** Donne à 4 joueurs : les trois 7 sont accessibles tout de suite (deux extrémités et le centre). */
export const tableB = (opts = {}) => rig({
  hands: [
    [7, 8, 8, 9, 10, 11, 12],
    [1, 2, 3, 4, 5, 6, 7],
    [1, 2, 3, 4, 5, 6, 12],
    [1, 2, 3, 4, 5, 6, 12],
  ],
  center: [7, 8, 9, 9, 10, 10, 11, 11],
  ...opts,
});

export const C = (slot) => ({ from: 'center', slot });
export const LOW = (seat) => ({ from: 'hand', seat, end: 'low' });
export const HIGH = (seat) => ({ from: 'hand', seat, end: 'high' });

/** Le joueur actif joue ces révélations à la suite. */
export function turn(state, ...moves) {
  let s = state;
  for (const m of moves) s = play(s, s.current, m);
  return s;
}

/** Le joueur actif rate son tour (deux cartes différentes du centre), puis les cartes sont rendues. */
export function missTurn(state, a = 0, b = 1) {
  const s = turn(state, C(a), C(b));
  if (s.outcome !== 'miss') throw new Error('ce tour devait être raté');
  return settle(s);
}

export const valuesOf = (hand) => hand.map((c) => c.v);

/** Valeur de la carte que révélerait ce coup (le test, lui, a le droit de regarder). */
export function peek(state, move) {
  if (move.from === 'center') return state.center[move.slot].v;
  const hand = state.hands[move.seat];
  return move.end === 'low' ? hand[0].v : hand.at(-1).v;
}

/** Coup d'un joueur qui se souvient de tout : il complète sa série quand c'est possible. */
export function smartMove(state, rng, skill = 0.85) {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (state.picks.length && rng() < skill) {
    const same = moves.filter((m) => peek(state, m) === state.picks[0].v);
    if (same.length) return same[Math.floor(rng() * same.length)];
  }
  return moves[Math.floor(rng() * moves.length)];
}

/**
 * Remplace toutes les cartes cachées par les mêmes cartes mélangées autrement (mains retriées).
 * Deux états qui ne diffèrent que par là doivent avoir exactement la même vue publique.
 */
export function scramble(state, rng) {
  const s = JSON.parse(JSON.stringify(state));
  const shown = new Set(s.picks.filter((p) => p.from === 'center').map((p) => p.slot));
  const hidden = [];
  s.hands.forEach((h) => hidden.push(...h));
  s.center.forEach((c, slot) => { if (c && !shown.has(slot)) hidden.push(c); });
  const mixed = shuffle(hidden, rng);
  let k = 0;
  s.hands = s.hands.map((h) => h.map(() => mixed[k++]).sort((a, b) => a.v - b.v || a.id - b.id));
  s.center = s.center.map((c, slot) => (c && !shown.has(slot) ? mixed[k++] : c));
  return s;
}

/** Vérifie tous les invariants d'un état ; renvoie la liste des anomalies (vide si tout va bien). */
export function invariants(state) {
  const bad = [];
  const { n } = state;
  const sizes = dealSizes(n);
  if (state.hands.length !== n || state.trios.length !== n) bad.push('nombre de mains ou de collections');
  if (state.center.length !== sizes.center) bad.push('nombre d\'emplacements au centre');

  // chaque carte existe une fois et une seule : dans une main, au centre, révélée, ou gagnée
  const seen = new Map();
  const put = (card, where) => {
    if (seen.has(card.id)) bad.push(`carte ${card.id} en double (${seen.get(card.id)} et ${where})`);
    seen.set(card.id, where);
    if (card.v !== Math.floor(card.id / COPIES) + 1) bad.push(`carte ${card.id} : valeur ${card.v} incohérente`);
  };
  state.hands.forEach((h, j) => h.forEach((c) => put(c, `main ${j}`)));
  state.center.forEach((c, slot) => { if (c) put(c, `centre ${slot}`); });
  const trioShown = state.outcome === 'trio';
  for (const p of state.picks) {
    if (p.from === 'hand' && !trioShown) put(p, 'révélée');
    if (p.from === 'center' && !trioShown && state.center[p.slot]?.id !== p.id) bad.push('carte du centre révélée mais absente de son emplacement');
    if (p.from === 'center' && trioShown && state.center[p.slot] !== null) bad.push('carte gagnée encore au centre');
  }
  for (const id of state.won) put({ id, v: Math.floor(id / COPIES) + 1 }, 'gagnée');
  if (seen.size !== DECK_SIZE) bad.push(`${seen.size} cartes au lieu de ${DECK_SIZE}`);

  // mains triées
  state.hands.forEach((h, j) => { for (let i = 1; i < h.length; i++) if (h[i - 1].v > h[i].v) bad.push(`main ${j} non triée`); });

  // trios : trois cartes par trio, chaque valeur gagnée une seule fois
  const wonValues = state.trios.flat();
  if (new Set(wonValues).size !== wonValues.length) bad.push('un trio gagné deux fois');
  if (wonValues.length * COPIES !== state.won.length) bad.push('cartes gagnées et trios ne correspondent pas');
  for (const v of wonValues) for (let k = 0; k < COPIES; k++) if (!state.won.includes((v - 1) * COPIES + k)) bad.push(`trio de ${v} incomplet`);
  if (wonValues.some((v) => v < 1 || v > VALUES)) bad.push('trio de valeur inconnue');

  // cartes révélées pendant le tour
  const vals = state.picks.map((p) => p.v);
  if (vals.length > COPIES) bad.push('plus de trois cartes révélées');
  if (state.phase === 'play' && (vals.length >= COPIES || vals.some((v) => v !== vals[0]))) bad.push('le tour aurait dû s\'arrêter');
  if (state.outcome === 'miss' && !(state.phase === 'resolve' && vals.length >= 2 && vals.at(-1) !== vals[0] && vals.slice(0, -1).every((v) => v === vals[0]))) bad.push('échec incohérent');
  if (state.outcome === 'trio' && !(vals.length === COPIES && vals.every((v) => v === vals[0]))) bad.push('trio incohérent');
  if (state.phase === 'play' && state.outcome) bad.push('résultat de tour en dehors de sa résolution');
  if (state.phase === 'resolve' && !state.outcome) bad.push('résolution sans résultat');

  // tour et victoire
  if (!(state.current >= 0 && state.current < n)) bad.push('joueur actif invalide');
  const winners = state.trios.map((t) => victory(t, state.mode));
  if (state.phase === 'over') {
    if (state.winner !== state.current || !winners[state.winner] || winners[state.winner] !== state.reason) bad.push('vainqueur invalide');
    if (winners.filter(Boolean).length !== 1) bad.push('plusieurs vainqueurs');
  } else {
    if (state.winner !== null || state.reason !== null) bad.push('vainqueur avant la fin');
    if (winners.some(Boolean)) bad.push('une victoire n\'a pas été détectée');
  }
  return bad;
}

/** Vérifie la forme de la vue publique : aucune valeur de carte cachée ne doit s'y trouver. */
export function publicLeaks(view) {
  const bad = [];
  const keys = (o) => Object.keys(o).sort().join();
  view.players.forEach((p) => { if (keys(p) !== 'cards,name,trios' || !Number.isInteger(p.cards)) bad.push('joueur : champs inattendus'); });
  view.center.forEach((c) => {
    if (c.s === 'down' || c.s === 'gone') { if (keys(c) !== 's') bad.push('carte cachée du centre : valeur exposée'); }
    else if (c.s !== 'up' || keys(c) !== 's,v') bad.push('emplacement du centre illisible');
  });
  view.picks.forEach((p) => {
    const want = p.from === 'center' ? 'from,slot,v' : 'end,from,seat,v';
    if (keys(p) !== want) bad.push('carte révélée : champs inattendus (identifiant ?)');
  });
  if (/"(hands|hand|won|id)":/.test(JSON.stringify(view))) bad.push('champ interne dans la vue publique');
  return bad;
}
