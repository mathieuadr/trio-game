// Illustrations originales de Triplette, dessinées en SVG (aucune image externe).
// Tout ce module renvoie des chaînes statiques : aucune donnée saisie par un joueur n'y entre.

import { LINKS } from '../engine/rules.js';

// ───────────────────────────────────────────── Les douze univers
// a → b : dégradé du fond · ink : couleur du numéro · edge : contour · soft : motifs clairs · pip : pastille de liaison

export const THEME = {
  1: { name: 'Végétal', a: '#5fd475', b: '#1d8a3c', ink: '#ffffff', edge: '#0c4a20', soft: '#d8fbe0', pip: '#2f9e44' },
  2: { name: 'Marin', a: '#58b2fb', b: '#165fa8', ink: '#ffffff', edge: '#0a2f5c', soft: '#d6edff', pip: '#1c7ed6' },
  3: { name: 'Solaire', a: '#ffe272', b: '#f59f00', ink: '#ffffff', edge: '#7a4300', soft: '#fff8d6', pip: '#f08c00' },
  4: { name: 'Géométrique', a: '#55606c', b: '#1d2228', ink: '#ffffff', edge: '#0a0c0f', soft: '#e9ecef', pip: '#495057' },
  5: { name: 'Floral', a: '#ff95ab', b: '#dc2f52', ink: '#ffffff', edge: '#6b0f25', soft: '#ffe3ea', pip: '#e03150' },
  6: { name: 'Nocturne', a: '#3c48a8', b: '#0f1340', ink: '#ffffff', edge: '#05071f', soft: '#dfe5ff', pip: '#2b3486' },
  7: { name: 'Magique', a: '#431173', b: '#120420', ink: 'url(#tpGold)', edge: '#1a0530', soft: '#ffe58a', pip: '#ffd43b' },
  8: { name: 'Aquatique', a: '#74e0ee', b: '#0b7a8f', ink: '#ffffff', edge: '#054853', soft: '#e6fcff', pip: '#1098ad' },
  9: { name: 'Céleste', a: '#9d7dfb', b: '#4a29ae', ink: '#ffffff', edge: '#1c0d55', soft: '#ebe3ff', pip: '#7048e8' },
  10: { name: 'Tropical', a: '#ffb057', b: '#e8590c', ink: '#ffffff', edge: '#6e2400', soft: '#fff0dc', pip: '#f76707' },
  11: { name: 'Abstrait', a: '#fbf4e2', b: '#e2d0a4', ink: '#2c2620', edge: '#fffaf0', soft: '#2c2620', pip: '#c9b27a' },
  12: { name: 'Festif', a: '#f283f0', b: '#9c2bb0', ink: '#ffffff', edge: '#4b0d57', soft: '#ffe3fe', pip: '#be4bdb' },
};

const grad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

const DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  ${Object.entries(THEME).map(([v, t]) => grad(`tpG${v}`, t.a, t.b)).join('')}
  ${grad('tpBack', '#4a2590', '#1b0d3d')}
  <linearGradient id="tpGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c2"/><stop offset=".45" stop-color="#ffd43b"/><stop offset="1" stop-color="#f08c00"/></linearGradient>
  <radialGradient id="tpHalo"><stop offset="0" stop-color="#ffe58a" stop-opacity=".75"/><stop offset=".6" stop-color="#ffb347" stop-opacity=".18"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
  <clipPath id="tpClip"><rect x="2.500" y="2.500" width="95" height="135" rx="10"/></clipPath>
</defs></svg>`;

export function installDefs() {
  if (document.getElementById('art-defs')) return;
  const holder = document.createElement('div');
  holder.id = 'art-defs';
  holder.innerHTML = DEFS;
  document.body.prepend(holder);
}

// ───────────────────────────────────────────── Icônes (trait, 24 × 24)

const icon = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICON = {
  soundOn: icon('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.6 7.6 0 0 1 0 11"/>'),
  soundOff: icon('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="m16 9.5 5 5m0-5-5 5"/>'),
  motionOn: icon('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="2.5"/>'),
  motionOff: icon('<circle cx="12" cy="12" r="2.5"/><path d="M4 12h3M17 12h3"/>'),
  menu: icon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: icon('<path d="m6 6 12 12M18 6 6 18"/>'),
  back: icon('<path d="M15 5l-7 7 7 7"/>'),
  up: icon('<path d="m6 14 6-6 6 6"/>'),
  down: icon('<path d="m6 10 6 6 6-6"/>'),
  dice: icon('<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/>'),
  eye: icon('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  eyeOff: icon('<path d="M4 4l16 16"/><path d="M9.5 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-2.8 3.4M6.200 7.700A15 15 0 0 0 2.500 12S6 18.500 12 18.500a9 9 0 0 0 3.300-.6"/>'),
  book: icon('<path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M5 16.5a3 3 0 0 1 3-3h11"/>'),
  users: icon('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c0-3.300 2.700-5.500 6-5.500s6 2.200 6 5.500"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6.200M17.500 14.300c2.100.6 3.500 2.400 3.500 5.200"/>'),
  link: icon('<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1"/><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>'),
  low: icon('<path d="M12 5v11"/><path d="m7 12 5 5 5-5"/><path d="M6 20h12"/>'),
  high: icon('<path d="M12 19V8"/><path d="m7 12 5-5 5 5"/><path d="M6 4h12"/>'),
  trophy: icon('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.500 20h7M10 17h4"/>'),
  pause: icon('<path d="M9 6v12M15 6v12"/>'),
};

// ───────────────────────────────────────────── Cartes (100 × 140, proportion 5:7)

const CARD = (inner, cls = '') => `<svg viewBox="0 0 100 140" class="cardsvg ${cls}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
const star4 = (x, y, r) => `<path d="M${x} ${y - r}q${r * 0.22} ${r * 0.78} ${r} ${r}q-${r * 0.78} ${r * 0.22}-${r} ${r}q-${r * 0.22}-${r * 0.78}-${r}-${r}q${r * 0.78}-${r * 0.22} ${r}-${r}z"/>`;

/** Motif décoratif de chaque valeur. Il laisse toujours le centre dégagé pour le numéro. */
const DECO = {
  // 1 — végétal : tiges et feuilles
  1: (t) => `
    <g fill="none" stroke="${t.soft}" stroke-width="2.200" stroke-linecap="round" opacity=".9">
      <path d="M11 134C22 116 10 100 16 80"/><path d="M90 6C80 24 91 38 85 58"/>
    </g>
    <g fill="${t.soft}" opacity=".92">
      <path d="M15 116c9-11 20-8 23 0-8 7-17 6-23 0z"/><path d="M13 100c-9-7-10-17-5-22 8 5 10 13 5 22z"/><path d="M16 86c8-10 18-8 22-1-8 7-16 6-22 1z"/>
      <path d="M86 26c-9 10-19 8-23 1 8-7 17-7 23-1z"/><path d="M88 42c9 6 10 16 5 22-8-5-10-13-5-22z"/>
    </g>
    <g fill="${t.edge}" opacity=".28"><circle cx="78" cy="118" r="3.200"/><circle cx="86" cy="108" r="2.200"/><circle cx="70" cy="126" r="1.800"/><circle cx="26" cy="38" r="2.200"/></g>`,
  // 2 — marin : vagues, coquillage, bulles
  2: (t) => `
    <g fill="none" stroke="${t.soft}" stroke-width="2.400" stroke-linecap="round" opacity=".88">
      <path d="M6 106q7.500-8 15 0t15 0 15 0 15 0 15 0 15 0"/><path d="M4 118q7.500-8 15 0t15 0 15 0 15 0 15 0 15 0" opacity=".65"/><path d="M6 130q7.500-8 15 0t15 0 15 0 15 0 15 0 15 0" opacity=".4"/>
    </g>
    <g transform="translate(79 27)">
      <path d="M0 13C-17 9-16-14 0-14 16-14 17 9 0 13z" fill="${t.soft}" opacity=".95"/>
      <g stroke="${t.b}" stroke-width="1.400" stroke-linecap="round" opacity=".7"><path d="M0 12V-11"/><path d="M0 12-7-8"/><path d="M0 12 7-8"/><path d="M0 12-12-1"/><path d="M0 12 12-1"/></g>
    </g>
    <g fill="none" stroke="${t.soft}" stroke-width="1.500" opacity=".75"><circle cx="16" cy="50" r="3.500"/><circle cx="24" cy="38" r="2.200"/><circle cx="12" cy="66" r="1.800"/></g>`,
  // 3 — solaire : soleil et rayons
  3: (t) => `
    <g transform="translate(78 28)">
      <g stroke="${t.soft}" stroke-width="2.600" stroke-linecap="round" opacity=".95">
        <path d="M0-21v-6"/><path d="M0 21v6"/><path d="M-21 0h-6"/><path d="M21 0h6"/><path d="m-15-15-4.200-4.200"/><path d="m15 15 4.200 4.200"/><path d="m-15 15-4.200 4.200"/><path d="m15-15 4.200-4.200"/>
      </g>
      <circle r="14" fill="${t.soft}"/><circle r="9" fill="none" stroke="${t.b}" stroke-width="1.500" opacity=".55"/>
    </g>
    <g stroke="${t.soft}" stroke-width="2.200" stroke-linecap="round" opacity=".7">
      <path d="M8 132 26 106"/><path d="M8 132 40 118"/><path d="M8 132 14 100"/><path d="M8 132 44 132"/>
    </g>
    <circle cx="8" cy="132" r="7" fill="${t.soft}" opacity=".9"/>`,
  // 4 — géométrique : formes angulaires
  4: () => `
    <path d="M66 10h24v24z" fill="#ffd43b"/><path d="M70 40 90 28v24z" fill="none" stroke="#4dabf7" stroke-width="2.400" stroke-linejoin="round"/>
    <path d="M10 130V104l26 26z" fill="#ff6b6b"/><path d="M12 96 24 84l12 12-12 12z" fill="none" stroke="#69db7c" stroke-width="2.400" stroke-linejoin="round"/>
    <path d="M46 126l8-10 8 10 8-10 8 10 8-10 6 8" fill="none" stroke="#e9ecef" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>
    <rect x="12" y="38" width="9" height="9" fill="#4dabf7" transform="rotate(45 16.500 42.500)"/>
    <path d="M40 12h14" stroke="#ff6b6b" stroke-width="2.600" stroke-linecap="round"/><path d="M40 19h8" stroke="#69db7c" stroke-width="2.600" stroke-linecap="round"/>`,
  // 5 — floral : fleurs stylisées
  5: (t) => {
    const flower = (x, y, r, c = t.soft) => `<g transform="translate(${x} ${y})"><g fill="${c}">${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="${r * 0.52}" ry="${r}" cy="${-r}" transform="rotate(${a})"/>`).join('')}</g><circle r="${r * 0.55}" fill="#ffd43b"/></g>`;
    return `${flower(78, 28, 9)}${flower(22, 112, 10)}${flower(84, 108, 5.500, '#ffc9d6')}${flower(18, 46, 4.500, '#ffc9d6')}
    <g fill="none" stroke="${t.soft}" stroke-width="2" stroke-linecap="round" opacity=".8"><path d="M30 122c8 4 16 4 24 0"/><path d="M70 36c-6 5-13 6-20 4"/></g>
    <g fill="${t.soft}" opacity=".7"><circle cx="60" cy="14" r="1.800"/><circle cx="90" cy="64" r="1.800"/><circle cx="10" cy="80" r="1.800"/><circle cx="46" cy="128" r="1.800"/></g>`;
  },
  // 6 — nocturne : lune et étoiles
  6: (t) => `
    <path d="M86 16a17 17 0 1 0 6 26 13.500 13.500 0 0 1-6-26z" fill="#ffe58a"/>
    <g fill="${t.soft}">${star4(20, 44, 5)}${star4(16, 108, 6.500)}${star4(82, 112, 4.500)}${star4(58, 16, 3.500)}${star4(88, 76, 3)}</g>
    <g fill="${t.soft}" opacity=".7"><circle cx="34" cy="124" r="1.400"/><circle cx="68" cy="128" r="1.400"/><circle cx="10" cy="70" r="1.400"/><circle cx="40" cy="30" r="1.400"/><circle cx="92" cy="54" r="1.400"/><circle cx="52" cy="118" r="1"/></g>`,
  // 7 — magique : traité à part (voir face())
  7: () => '',
  // 8 — aquatique : gouttes et bulles
  8: (t) => {
    const drop = (x, y, s, o = 0.95) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-12C-5-4-8 1-8 5a8 8 0 0 0 16 0c0-4-3-9-8-17z" fill="${t.soft}" opacity="${o}"/>`;
    return `${drop(80, 28, 1.250)}${drop(64, 16, 0.600, 0.75)}${drop(20, 112, 1.350)}${drop(38, 126, 0.650, 0.75)}${drop(88, 104, 0.800, 0.8)}
    <g fill="none" stroke="${t.soft}" stroke-width="1.600" opacity=".85"><circle cx="16" cy="48" r="5"/><circle cx="26" cy="36" r="2.600"/><circle cx="84" cy="126" r="3.400"/><circle cx="72" cy="118" r="1.800"/><circle cx="10" cy="78" r="2"/></g>
    <g stroke="#fff" stroke-width="1.400" stroke-linecap="round" opacity=".85"><path d="M77 30a4 4 0 0 0 2 4"/><path d="M16.500 116a4.400 4.400 0 0 0 2.200 4.400"/></g>`;
  },
  // 9 — céleste : constellations
  9: (t) => `
    <g fill="none" stroke="${t.soft}" stroke-width="1.300" stroke-linecap="round" opacity=".7">
      <path d="M56 14 70 26 86 18 82 40 92 54"/><path d="M10 96 22 110 14 126 36 122 48 132"/>
    </g>
    <g fill="#fff">
      <circle cx="56" cy="14" r="2.200"/><circle cx="70" cy="26" r="3"/><circle cx="86" cy="18" r="2.200"/><circle cx="82" cy="40" r="2.600"/><circle cx="92" cy="54" r="1.800"/>
      <circle cx="10" cy="96" r="2"/><circle cx="22" cy="110" r="3"/><circle cx="14" cy="126" r="2.200"/><circle cx="36" cy="122" r="2.600"/><circle cx="48" cy="132" r="1.800"/>
    </g>
    <g fill="${t.soft}" opacity=".8">${star4(18, 46, 3.500)}${star4(86, 112, 4)}<circle cx="30" cy="34" r="1.200"/><circle cx="70" cy="126" r="1.200"/><circle cx="92" cy="90" r="1.200"/><circle cx="8" cy="70" r="1.200"/></g>`,
  // 10 — tropical : feuillages
  10: () => {
    const frond = (x, y, rot, s = 1) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0C6-14 6-30 0-44-6-30-6-14 0 0z" fill="#2f9e44"/><path d="M0 0C14-8 22-22 22-36 10-28 2-16 0 0z" fill="#37b24d"/><path d="M0 0C-14-8-22-22-22-36-10-28-2-16 0 0z" fill="#37b24d"/><path d="M0 0C20-2 32-12 38-24 24-22 8-14 0 0z" fill="#8ce99a"/><path d="M0 0C-20-2-32-12-38-24-24-22-8-14 0 0z" fill="#8ce99a"/><path d="M0-2v-38" stroke="#1b6e30" stroke-width="1.200" stroke-linecap="round"/></g>`;
    return `${frond(92, 4, 205, 0.820)}${frond(8, 138, 25, 0.900)}
    <g fill="#fff0dc" opacity=".85"><circle cx="16" cy="44" r="2.200"/><circle cx="88" cy="96" r="2.200"/><circle cx="24" cy="34" r="1.400"/><circle cx="80" cy="106" r="1.400"/></g>`;
  },
  // 11 — abstrait : motifs répétitifs
  11: () => `
    <g fill="#e8590c">${[0, 1, 2, 3, 4].map((i) => `<path d="M${46 + i * 10} 22a5 5 0 0 1 10 0z"/>`).join('')}</g>
    <g fill="#0b7285">${[0, 1, 2, 3, 4].map((i) => `<path d="M${46 + i * 10} 22a5 5 0 0 0 10 0z" opacity=".85"/>`).join('')}</g>
    <g fill="#2c2620" opacity=".8">${[0, 1, 2, 3, 4, 5, 6].flatMap((i) => [0, 1].map((j) => `<circle cx="${12 + i * 7}" cy="${112 + j * 8}" r="1.900"/>`)).join('')}</g>
    <g stroke="#e8590c" stroke-width="2.600" stroke-linecap="round">${[0, 1, 2, 3].map((i) => `<path d="M${68 + i * 6.500} 108v18"/>`).join('')}</g>
    <g stroke="#0b7285" stroke-width="2.200" stroke-linecap="round" opacity=".9">${[0, 1, 2].map((i) => `<path d="M10 ${38 + i * 7}h12"/>`).join('')}</g>
    <g fill="none" stroke="#2c2620" stroke-width="1.600" opacity=".7"><circle cx="86" cy="46" r="5"/><circle cx="86" cy="46" r="1.600" fill="#2c2620"/></g>`,
  // 12 — festif : confettis et serpentins
  12: () => {
    const colors = ['#ffd43b', '#69db7c', '#4dabf7', '#ffffff', '#ffa8a8', '#ffd43b', '#63e6be'];
    const bits = [[70, 14, 20], [84, 26, -30], [62, 30, 60], [90, 48, 10], [76, 44, -50], [12, 100, 35], [26, 112, -20], [16, 126, 70], [38, 124, 15], [8, 80, -40], [88, 118, 50], [70, 128, -15], [52, 12, -60], [20, 40, 30]];
    return `<g>${bits.map(([x, y, r], i) => `<rect x="${x - 3.500}" y="${y - 1.800}" width="7" height="3.600" rx="1" fill="${colors[i % colors.length]}" transform="rotate(${r} ${x} ${y})"/>`).join('')}</g>
    <g fill="none" stroke-width="2.200" stroke-linecap="round"><path d="M82 62c8 4 8 12 0 14s-8 10 0 14" stroke="#ffd43b"/><path d="M12 50c-6 5-4 12 3 12s9 7 3 12" stroke="#63e6be"/></g>
    <g fill="#fff"><circle cx="56" cy="124" r="1.800"/><circle cx="34" cy="20" r="1.800"/><circle cx="92" cy="100" r="1.800"/></g>`;
  },
};

/** Pastille de liaison (mode Picante) : la valeur liée, dans la couleur de son univers. */
function pip(x, linkedValue) {
  const t = THEME[linkedValue];
  const dark = linkedValue === 11 || linkedValue === 3 || linkedValue === 7;
  return `<g transform="translate(${x} 118)">
    <rect width="24" height="16" rx="8" fill="${t.pip}" stroke="#fff" stroke-width="1.400"/>
    <text x="12" y="12.300" text-anchor="middle" font-size="11" font-weight="900" fill="${dark ? '#2c2620' : '#fff'}">${linkedValue}</text></g>`;
}

const num = (v, t, { size, y }) => `<text x="50" y="${y}" text-anchor="middle" font-size="${size}" font-weight="900" letter-spacing="${v > 9 ? -3 : 0}" fill="${t.ink}" stroke="${t.edge}" stroke-width="${v === 11 ? 4 : 5.500}" stroke-linejoin="round" paint-order="stroke">${v}</text>`;

/**
 * Recto d'une carte. `variant` (0, 1, 2) fait varier légèrement le décor entre les trois
 * exemplaires affichés côte à côte ; le numéro et les informations de jeu sont identiques.
 * `spicy` ajoute les pastilles de liaison dans les coins inférieurs.
 */
export function cardFace(v, { spicy = false, variant = 0 } = {}) {
  const t = THEME[v];
  if (!t) return '';
  const flip = variant === 1 ? ' transform="translate(100 0) scale(-1 1)"' : variant === 2 ? ' transform="translate(100 140) scale(-1 -1)"' : '';
  const links = spicy ? LINKS[v] || [] : [];
  const pips = links.map((w, i) => pip(i === 0 ? 8 : 68, w)).join('');
  const corner = `<text x="15" y="24" text-anchor="middle" font-size="16.500" font-weight="900" letter-spacing="${v > 9 ? -1 : 0}" fill="${t.ink}" stroke="${t.edge}" stroke-width="3.400" stroke-linejoin="round" paint-order="stroke">${v}</text>`;

  if (v === 7) {
    // la carte magique : cadre doré, halo et étoile rayonnante derrière le numéro
    const rays = Array.from({ length: 12 }, (_, i) => `<path d="M0-12 2.400-36 0-41-2.400-36z" transform="rotate(${i * 30})"/>`).join('');
    return CARD(`
      <rect x="1.500" y="1.500" width="97" height="137" rx="11" fill="url(#tpG7)" stroke="url(#tpGold)" stroke-width="2.600"/>
      <rect x="7" y="7" width="86" height="126" rx="7" fill="none" stroke="#ffd43b" stroke-opacity=".7" stroke-width="1.200"/>
      <rect x="10.500" y="10.500" width="79" height="119" rx="5" fill="none" stroke="#ffd43b" stroke-opacity=".28" stroke-dasharray="2 3.500"/>
      <circle cx="50" cy="70" r="46" fill="url(#tpHalo)"/>
      <g${flip}><g transform="translate(50 70)" fill="#ffd43b" opacity=".5" class="rays">${rays}</g>
      <g fill="#ffe58a">${star4(80, 26, 6)}${star4(20, 114, 6)}${star4(86, 100, 3.500)}${star4(15, 44, 3.500)}</g>
      <g fill="#ffd43b" opacity=".85"><path d="M50 14l3 4-3 4-3-4z"/><path d="M50 118l3 4-3 4-3-4z"/></g></g>
      <circle cx="50" cy="70" r="31" fill="#12041f" fill-opacity=".55" stroke="#ffd43b" stroke-opacity=".6" stroke-width="1.200"/>
      ${num(7, t, { size: 62, y: 92 })}
      ${corner}
      <g fill="#ffd43b">${star4(20, 126, 4.500)}${star4(80, 126, 4.500)}</g>`, 'seven');
  }
  return CARD(`
    <rect x="1.500" y="1.500" width="97" height="137" rx="11" fill="url(#tpG${v})" stroke="${v === 11 ? '#b9a472' : t.edge}" stroke-opacity="${v === 11 ? 1 : 0.55}" stroke-width="1.500"/>
    <rect x="6.500" y="6.500" width="87" height="127" rx="7.500" fill="none" stroke="${v === 11 ? '#2c2620' : '#ffffff'}" stroke-opacity=".28"/>
    <g clip-path="url(#tpClip)"><g${flip}>${DECO[v](t)}</g></g>
    ${num(v, t, { size: v > 9 ? 54 : 64, y: v > 9 ? 89 : 92 })}
    ${corner}
    ${pips}`);
}

/** Verso : le même pour toutes les cartes, sans aucun indice sur la valeur. Symétrique dans les deux sens. */
export const cardBack = () => CARD(`
  <rect x="1.500" y="1.500" width="97" height="137" rx="11" fill="url(#tpBack)" stroke="#ffd166" stroke-opacity=".7" stroke-width="1.600"/>
  <rect x="7" y="7" width="86" height="126" rx="7" fill="none" stroke="#ffd166" stroke-opacity=".3"/>
  <g fill="none" stroke="#b197fc" stroke-opacity=".38" stroke-width="1.300" stroke-linejoin="round">
    <path d="M50 12 88 70 50 128 12 70z"/><path d="M50 26 78 70 50 114 22 70z"/>
    <path d="M12 12 30 12 12 38z"/><path d="M88 12 70 12 88 38z"/><path d="M12 128 30 128 12 102z"/><path d="M88 128 70 128 88 102z"/>
  </g>
  <g fill="#ffd166" fill-opacity=".8"><circle cx="50" cy="12" r="1.800"/><circle cx="50" cy="128" r="1.800"/><circle cx="12" cy="70" r="1.800"/><circle cx="88" cy="70" r="1.800"/></g>
  <path d="M50 46 70 70 50 94 30 70z" fill="#1b0d3d" stroke="#ffd166" stroke-width="1.800" stroke-linejoin="round"/>
  <g fill="#ffd166"><circle cx="41" cy="70" r="3.600"/><circle cx="50" cy="70" r="3.600"/><circle cx="59" cy="70" r="3.600"/></g>`, 'back');

// ───────────────────────────────────────────── Icône de l'application

/** Icône de l'application (512 × 512), autonome : sert aussi à produire les PNG. */
export const appIcon = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a2db0"/><stop offset="1" stop-color="#1b0d3d"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g stroke="#1b0d3d" stroke-width="12" stroke-linejoin="round">
    <rect x="88" y="150" width="150" height="212" rx="26" fill="#ff6b81" transform="rotate(-16 163 256)"/>
    <rect x="274" y="150" width="150" height="212" rx="26" fill="#38d9a9" transform="rotate(16 349 256)"/>
    <rect x="181" y="118" width="150" height="212" rx="26" fill="#ffd43b"/>
  </g>
  <g fill="#1b0d3d"><circle cx="224" cy="224" r="15"/><circle cx="256" cy="224" r="15"/><circle cx="288" cy="224" r="15"/></g>
</svg>`;
