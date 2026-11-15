// Chiffrement de bout en bout entre le téléphone de l'hôte et celui de chaque joueur.
//
// Chaque appareil possède une paire de clés ECDH (P-256) gardée dans son stockage local.
// L'hôte et un joueur en déduisent une clé AES-GCM commune que personne d'autre ne connaît :
// ni le relais public, ni les autres joueurs. Tout ce qui est secret (la main d'un joueur) ne
// circule que chiffré avec cette clé, dans des messages de taille constante.
// Utilise uniquement l'API Web Crypto (navigateurs récents et Node ≥ 20).

const subtle = () => globalThis.crypto.subtle;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

const toB64 = (bytes) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Ne garde que les champs utiles d'une clé publique (message plus court, comparaison facile). */
export const publicJwk = ({ kty, crv, x, y }) => ({ kty, crv, x, y });
export const sameKey = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.crv === b.crv;

export async function makeKeyPair() {
  const kp = await subtle().generateKey(ECDH, true, ['deriveKey']);
  return {
    priv: await subtle().exportKey('jwk', kp.privateKey),
    pub: publicJwk(await subtle().exportKey('jwk', kp.publicKey)),
  };
}

/** Clé commune entre ma clé privée et la clé publique de l'autre appareil. */
export async function sharedKey(privJwk, pubJwk) {
  const priv = await subtle().importKey('jwk', privJwk, ECDH, false, ['deriveKey']);
  const pub = await subtle().importKey('jwk', publicJwk(pubJwk), ECDH, false, []);
  return subtle().deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * Chiffre un objet. `label` est authentifié sans être chiffré : un message destiné à un usage
 * (ex. « priv ») ne peut pas être rejoué pour un autre (ex. « cmd »).
 */
export async function seal(key, label, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(label) }, key, padded(obj));
  return { iv: toB64(iv), ct: toB64(ct) };
}

/**
 * Le chiffrement cache le contenu d'un message, pas sa longueur. Or « [1,2,3] » est plus court
 * que « [10,11,12] » : sans précaution, la taille d'une main chiffrée dirait combien de cartes
 * à deux chiffres elle contient. Chaque message est donc complété par des espaces (ignorés à la
 * lecture du JSON) jusqu'à un multiple de BLOCK octets : toutes les mains ont la même taille.
 */
export const BLOCK = 256;
function padded(obj) {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const out = new Uint8Array(Math.ceil((data.length + 1) / BLOCK) * BLOCK).fill(0x20);
  out.set(data);
  return out;
}

/** Déchiffre ; renvoie null si le message est illisible, altéré ou destiné à un autre usage. */
export async function open(key, label, box) {
  try {
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromB64(box.iv), additionalData: new TextEncoder().encode(label) },
      key, fromB64(box.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

/** Identifiant aléatoire en hexadécimal. */
export const randomId = (bytes = 6) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Hasard uniforme dans [0, 1) de qualité cryptographique. */
export function cryptoRandom() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}
