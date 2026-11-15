// Composants d'interface réutilisables : cartes, pastilles, feuilles modales, interrupteurs, messages.

import { h, dur } from './dom.js';
import { ICON, THEME, cardFace, cardBack } from './art.js';
import { RULES, MODE_LABEL, rich } from './texts.js';
import { linkPairs } from '../engine/rules.js';

// ───────────────────────────────────────────── Cartes

/**
 * Une carte. Sans valeur (`v`), seul le dos existe dans la page : une carte cachée ne contient
 * aucune trace de ce qu'elle est. `just` joue l'animation de retournement à l'apparition.
 */
export function card({ v = null, spicy = false, variant = 0, just = false, cls = '' } = {}) {
  const up = v != null;
  return h('div', { class: `card ${up ? 'up' : 'down'} ${just ? 'just' : ''} ${cls}`.replace(/\s+/g, ' ').trim(), 'data-v': up ? String(v) : null },
    h('div', { class: 'card-in' },
      up ? h('div', { class: 'cface cfront', html: cardFace(v, { spicy, variant }) }) : null,
      !up || just ? h('div', { class: 'cface cback', html: cardBack() }) : null));
}

const darkInk = (v) => v === 11 || v === 3 || v === 7;
/** Couleurs d'une valeur, pour les pastilles. */
export const tint = (v) => ({ '--c': THEME[v].pip, '--ink': darkInk(v) ? '#2c2620' : '#fff' });

/** Pastille d'un trio gagné. */
export const trioChip = (v, cls = '') => h('span', { class: `trio-chip ${v === 7 ? 'seven' : ''} ${cls}`.replace(/\s+/g, ' ').trim(), style: tint(v), title: `Trio de ${v}` }, String(v));

/** Les trios d'un joueur, ou un tiret discret s'il n'en a pas. */
export const trioRow = (trios, cls = '') => h('span', { class: `trio-row ${cls}`.trim(), 'aria-label': trios.length ? `Trios gagnés : ${trios.join(', ')}` : 'Aucun trio' },
  trios.length ? trios.map((v) => trioChip(v)) : h('span', { class: 'trio-none' }, 'aucun trio'));

/** Table des liaisons du mode Picante. */
export function linksTable() {
  const dot = (v) => h('span', { class: 'trio-chip', style: tint(v) }, String(v));
  return h('div', { class: 'links', id: 'linksTable' },
    linkPairs().map(([a, b]) => h('span', { class: 'link-pair' }, dot(a), h('span', { class: 'link-ic', html: ICON.link }), dot(b))),
    h('span', { class: 'link-pair solo' }, h('span', { class: 'trio-chip seven', style: tint(7) }, '7'), h('small', null, 'gagne seul')));
}

export const modeChip = (mode) => h('span', { class: `mode-chip ${mode}` }, MODE_LABEL[mode]);

// ───────────────────────────────────────────── Feuilles modales et superpositions

const layer = () => document.getElementById('layer');
const stack = [];

/** Feuille qui monte du bas de l'écran. Renvoie { el, close }. */
export function openSheet(content, { title = '', dismissible = true, onClose, cls = '' } = {}) {
  let closed = false;
  const handle = { el: null, close, dismissible };
  function close() {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(handle);
    if (i >= 0) stack.splice(i, 1);
    handle.el.classList.remove('open');
    setTimeout(() => handle.el.remove(), dur(240));
    if (onClose) onClose();
  }
  handle.el = h('div', { class: `sheet ${cls}`.trim() },
    h('div', { class: 'sheet-backdrop', onClick: () => dismissible && close() }),
    h('div', { class: 'sheet-body', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Fenêtre' },
      h('div', { class: 'sheet-head' },
        h('h2', null, title),
        dismissible ? h('button', { class: 'icon-btn', 'aria-label': 'Fermer', onClick: close, html: ICON.close }) : null),
      h('div', { class: 'sheet-content' }, content)));
  layer().append(handle.el);
  stack.push(handle);
  requestAnimationFrame(() => requestAnimationFrame(() => handle.el.classList.add('open')));
  return handle;
}

/** Ferme la feuille du dessus si elle peut l'être (bouton retour d'Android). */
export function closeTopSheet() {
  const top = stack.at(-1);
  if (top && top.dismissible) { top.close(); return true; }
  return false;
}

export function closeAllSheets() {
  stack.length = 0;
  layer().replaceChildren();
}

/** Demande de confirmation avant une action irréversible. Résout true ou false. */
export function confirmSheet({ title, text, yes = 'Confirmer', no = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const sheet = openSheet(
      h('div', { class: 'confirm' },
        h('p', null, text),
        h('div', { class: 'btn-col' },
          h('button', { class: `btn big ${danger ? 'danger' : 'primary'}`, onClick: () => { answer = true; sheet.close(); } }, yes),
          h('button', { class: 'btn big ghost', onClick: () => sheet.close() }, no))),
      { title, onClose: () => resolve(answer) });
  });
}

// ───────────────────────────────────────────── Messages brefs

export function toast(message, { tone = '' } = {}) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${tone}`.trim(), role: 'status' }, message);
  box.replaceChildren(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 2600);
}

// ───────────────────────────────────────────── Réglages (sons, animations)

export function settingToggles(ctx) {
  const { prefs } = ctx;
  const mk = (key, on, off, label) => {
    const active = prefs[key];
    return h('button', {
      class: `icon-btn toggle ${active ? 'on' : ''}`,
      'aria-pressed': String(active),
      'aria-label': `${label} : ${active ? 'activés' : 'désactivés'}`,
      title: label,
      html: active ? on : off,
      onClick: () => { ctx.setSetting(key, !active); },
    });
  };
  return h('div', { class: 'toggles' },
    mk('sound', ICON.soundOn, ICON.soundOff, 'Sons'),
    mk('motion', ICON.motionOn, ICON.motionOff, 'Animations'));
}

export function settingRows(ctx) {
  const { prefs } = ctx;
  const row = (key, label, hint) => h('label', { class: 'row-switch' },
    h('span', { class: 'rs-text' }, h('b', null, label), h('small', null, hint)),
    h('input', { type: 'checkbox', class: 'switch', checked: prefs[key], onChange: (e) => ctx.setSetting(key, e.target.checked, { silent: true }) }));
  return h('div', { class: 'rows' },
    row('sound', 'Sons', 'Cartes retournées, trios, fin de partie'),
    row('motion', 'Animations', 'Désactive pour un affichage plus sobre'));
}

// ───────────────────────────────────────────── Règles

export function rulesContent() {
  return h('div', { class: 'rules' },
    RULES.map((section) => h('section', { class: 'rule' },
      h('h3', null, section.title),
      section.body.map((p) => h('p', null, rich(p))),
      section.title === 'Gagner la partie' ? linksTable() : null)));
}

