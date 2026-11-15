// Triplette — tables et constantes des règles.
// Aucun accès au DOM ici : ce module est utilisable tel quel sous Node pour les tests.

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const VALUES = 12; // valeurs de 1 à 12
export const COPIES = 3; // trois exemplaires de chaque valeur
export const DECK_SIZE = VALUES * COPIES; // 36 cartes
export const SEVEN = 7; // le trio de 7 fait gagner immédiatement, dans les deux modes
export const TRIOS_TO_WIN = 3; // mode Normal

export const MODE = Object.freeze({ NORMAL: 'normal', SPICY: 'spicy' });
export const REASON = Object.freeze({ SEVEN: 'seven', THREE: 'three', LINKED: 'linked' });

// Distribution : [cartes par joueur, cartes au centre] selon le nombre de joueurs.
export const DEAL = Object.freeze({ 3: [9, 9], 4: [7, 8], 5: [6, 6], 6: [5, 6] });

/**
 * Liaisons du mode Picante : deux trios sont liés quand leur somme ou leur différence vaut 7.
 * C'est LA table à modifier pour changer les liaisons ; `validateLinks` (et un test) vérifie
 * qu'elle reste symétrique : si 2 est lié à 5, alors 5 est lié à 2.
 */
export const LINKS = Object.freeze({
  1: [6, 8],
  2: [5, 9],
  3: [4, 10],
  4: [3, 11],
  5: [2, 12],
  6: [1],
  7: [],
  8: [1],
  9: [2],
  10: [3],
  11: [4],
  12: [5],
});

const inRange = (n) => Number.isInteger(n) && n >= MIN_PLAYERS && n <= MAX_PLAYERS;
export const isValue = (v) => Number.isInteger(v) && v >= 1 && v <= VALUES;

/** Liste des anomalies d'une table de liaisons (vide si elle est correcte). */
export function validateLinks(links = LINKS) {
  const bad = [];
  for (let v = 1; v <= VALUES; v++) {
    const list = links?.[v];
    if (!Array.isArray(list)) { bad.push(`valeur ${v} absente`); continue; }
    if (new Set(list).size !== list.length) bad.push(`valeur ${v} : liaison en double`);
    for (const w of list) {
      if (!isValue(w)) bad.push(`valeur ${v} : liaison inconnue (${w})`);
      else if (w === v) bad.push(`valeur ${v} liée à elle-même`);
      else if (!links[w]?.includes(v)) bad.push(`${v} est lié à ${w}, mais pas ${w} à ${v}`);
    }
  }
  return bad;
}

export const linked = (a, b, links = LINKS) => !!links[a]?.includes(b);

/** Les paires de trios liés, chacune une seule fois : [[1, 6], [1, 8], …]. */
export function linkPairs(links = LINKS) {
  const out = [];
  for (let v = 1; v <= VALUES; v++) for (const w of links[v] || []) if (v < w) out.push([v, w]);
  return out;
}

/** Nombre de cartes par joueur et au centre. */
export function dealSizes(n) {
  if (!inRange(n)) throw new RangeError(`Nombre de joueurs invalide : ${n}`);
  const [hand, center] = DEAL[n];
  return { hand, center };
}

/** Le paquet (non mélangé) : 36 cartes, chacune avec un identifiant unique. */
export function buildDeck() {
  const deck = [];
  for (let v = 1; v <= VALUES; v++) for (let k = 0; k < COPIES; k++) deck.push({ id: (v - 1) * COPIES + k, v });
  return deck;
}

/**
 * Condition de victoire d'un joueur d'après ses trios.
 * Renvoie la raison ('seven' | 'three' | 'linked') ou null si la partie continue.
 */
export function victory(trios, mode, links = LINKS) {
  if (trios.includes(SEVEN)) return REASON.SEVEN;
  if (mode === MODE.SPICY) {
    for (const a of trios) for (const b of links[a] || []) if (trios.includes(b)) return REASON.LINKED;
    return null;
  }
  return trios.length >= TRIOS_TO_WIN ? REASON.THREE : null;
}

/** En Picante : la paire de trios liés qui fait gagner (ou null). */
export function winningPair(trios, links = LINKS) {
  for (const a of trios) for (const b of links[a] || []) if (trios.includes(b)) return a < b ? [a, b] : [b, a];
  return null;
}
