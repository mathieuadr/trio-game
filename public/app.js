// Triplette — démarrage, navigation entre écrans, sons et animations liés aux événements de la partie.

import * as MQ from './vendor/mqtt.esm.js';
import { Net } from './net/room.js';
import { storage, prefs } from './state/store.js';
import { sound } from './ui/sound.js';
import { h, dur } from './ui/dom.js';
import { installDefs, ICON } from './ui/art.js';
import { openSheet, closeTopSheet, closeAllSheets, confirmSheet, settingRows, rulesContent, linksTable, toast } from './ui/components.js';
import { homeScreen, joiningScreen } from './ui/screens/home.js';
import { lobbyScreen } from './ui/screens/lobby.js';
import { rulesScreen } from './ui/screens/rules.js';
import { tableScreen, showTrio } from './ui/screens/table.js';
import { gameOverScreen } from './ui/screens/gameOver.js';

const mqtt = MQ.default?.connect ? MQ.default : MQ;
const params = new URLSearchParams(location.search);
// Relais public par défaut ; `?broker=wss://…` pour en utiliser un autre (tous les joueurs doivent avoir le même).
const BROKER = params.get('broker') || 'wss://broker.hivemq.com:8884/mqtt';

const ui = {
  screen: 'home', // home | rules (hors partie)
  invite: params.get('room'), // code reçu par un lien d'invitation
  code: '',
  hideHand: false, // ma main affichée de dos (jamais sauvegardé)
  seen: null, // dernier état de la partie pris en compte (sons, animations)
  hold: null, // on laisse voir le trio gagnant avant l'écran de fin
  lock: null,
  over: null,
};
// le code d'invitation n'a pas à survivre à une actualisation
if (params.has('room')) {
  params.delete('room');
  const q = params.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}`);
}

prefs.load();
const ctx = { prefs, ui, sound, render, go, openMenu, setSetting, net: null };

function applySettings() {
  sound.setEnabled(prefs.sound);
  document.documentElement.classList.toggle('reduced', !prefs.motion);
}

function setSetting(key, value, { silent = false } = {}) {
  prefs.set(key, value);
  applySettings();
  if (key === 'sound' && value) sound.tap();
  if (!silent) render(true);
}

// ───────────────────────────────────────────── Navigation

/** Écran à afficher : [clé, signature, construction]. On ne redessine que si la signature change. */
function route() {
  const { net } = ctx;
  if (net.status === 'idle') {
    if (ui.screen === 'rules') return ['rules', '', () => rulesScreen(ctx)];
    return ['home', ui.invite || '', () => homeScreen(ctx)];
  }
  const room = net.room;
  if (net.status === 'joining' || !room) return ['joining', `${net.connected}|${net.code}`, () => joiningScreen(ctx)];
  if (room.status === 'lobby' || !room.game) return ['lobby', `${room.ver}|${net.connected}`, () => lobbyScreen(ctx)];
  const holding = ui.hold && ui.hold.id === room.gameId && Date.now() < ui.hold.until;
  if (room.game.phase === 'over' && !holding) return ['over', `${room.gameId}|${room.ver}|${net.isHost}`, () => gameOverScreen(ctx)];
  return ['table', `${room.ver}|${net.priv?.gameId}|${net.priv?.ver}|${ui.hideHand}`, () => tableScreen(ctx)];
}

let last = { key: null, sig: null, sheets: null };
function render(force = false) {
  const { net } = ctx;
  const [key, sig, build] = route();
  // une feuille ouverte n'a plus de sens si l'on a changé de partie ou d'écran
  const sheets = `${net.status}|${net.room?.status}|${net.room?.gameId}|${key}`;
  if (last.sheets !== null && sheets !== last.sheets) closeAllSheets();
  last.sheets = sheets;
  if (!force && key === last.key && sig === last.sig) return;
  const same = key === last.key;
  const y = window.scrollY;
  const app = document.getElementById('app');
  const node = build();
  // la table se met à jour sur place : on ne la remplace pas, pour ne pas couper ses animations
  if (!(app.childNodes.length === 1 && app.firstChild === node)) app.replaceChildren(node);
  document.body.dataset.screen = key;
  window.scrollTo(0, same ? y : 0);
  last.key = key;
  last.sig = sig;
}

function go(screen) {
  closeAllSheets();
  ui.screen = screen;
  render(true);
}

/** Bandeau d'état de la connexion. */
function netbar() {
  const { net } = ctx;
  const bar = document.getElementById('netbar');
  let text = '';
  if (net.status !== 'idle' && !net.connected) text = 'Connexion au relais…';
  else if (net.status === 'room' && !net.isHost && net.room && !net.hostOnline) {
    const host = net.room.members.find((m) => m.id === net.room.hostId)?.name || 'L’hôte';
    text = `${host} (l’hôte) est hors ligne : la partie reprendra dès son retour.`;
  }
  bar.textContent = text;
  bar.classList.toggle('hidden', !text);
}

const buzz = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* sans vibreur */ } };

/** Appelé à chaque changement venant du réseau : sons et effets, puis nouvel affichage. */
function update() {
  const { net } = ctx;
  const room = net.room;
  const g = net.status === 'room' ? room?.game : null;
  if (g) {
    const prev = ui.seen && ui.seen.id === room.gameId ? ui.seen : null;
    const me = net.seat;
    if (prev) {
      if (g.reveals === prev.reveals + 1) {
        // une carte vient d'être retournée
        sound.flip();
        if (g.outcome === 'trio') {
          if (g.picks[0]?.v === 7) sound.seven(); else sound.trio();
          showTrio(ctx, room);
          if (g.phase === 'over') {
            ui.hold = { id: room.gameId, until: Date.now() + dur(2500) };
            setTimeout(schedule, dur(2500) + 40);
          }
        } else if (g.outcome === 'miss') sound.miss();
        else if (g.picks.length >= 2) sound.match(g.picks.length);
      } else if (prev.phase === 'resolve' && g.phase === 'play' && prev.outcome === 'miss') {
        sound.back(); // les cartes retournent à leur place
      }
      if (g.phase === 'play' && g.current === me && !g.picks.length && (prev.current !== me || prev.phase !== 'play')) {
        setTimeout(() => sound.turn(), 220);
        buzz([60, 40, 120]);
      }
    } else if (g.phase === 'play' && g.reveals === 0) {
      sound.shuffle(); // nouvelle donne
      if (g.current === me) { setTimeout(() => sound.turn(), 520); buzz([60, 40, 120]); }
    }
    ui.seen = { id: room.gameId, reveals: g.reveals, phase: g.phase, outcome: g.outcome, current: g.current };
  } else {
    ui.seen = null;
    ui.hold = null;
  }
  render();
  netbar();
  keepAwake();
}
let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; update(); });
}

// ───────────────────────────────────────────── Menu

function openMenu() {
  const { net } = ctx;
  const inRoom = net.status === 'room' && net.room;
  const game = inRoom ? net.room.game : null;
  const playing = !!game && game.phase !== 'over';
  const sheet = openSheet(
    h('div', { class: 'menu' },
      settingRows(ctx),
      h('div', { class: 'btn-col' },
        h('button', { class: 'btn big', id: 'menuRules', onClick: () => openSheet(rulesContent(), { title: 'Règles du jeu', cls: 'tall' }) }, h('span', { class: 'btn-ic', html: ICON.book }), 'Règles du jeu'),
        game && game.mode === 'spicy' ? h('button', {
          class: 'btn big', id: 'menuLinks',
          onClick: () => openSheet(h('div', { class: 'links-sheet' }, h('p', null, 'En mode Picante, il faut gagner deux trios liés.'), linksTable()), { title: 'Trios liés' }),
        }, h('span', { class: 'btn-ic', html: ICON.link }), 'Trios liés') : null,
        playing && net.isHost ? h('button', {
          class: 'btn big', id: 'menuAbort',
          onClick: async () => {
            const ok = await confirmSheet({ title: 'Interrompre la partie ?', text: 'La partie en cours s’arrête et tout le monde revient au salon. Les joueurs restent à la table.', yes: 'Interrompre la partie', danger: true });
            if (!ok) return;
            sheet.close();
            net.send({ t: 'abort' });
          },
        }, 'Interrompre la partie (retour au salon)') : null,
        inRoom ? h('button', {
          class: 'btn big danger', id: 'menuQuit',
          onClick: async () => {
            const host = net.isHost;
            const ok = await confirmSheet(host
              ? { title: 'Fermer la partie ?', text: 'La partie s’arrête pour tout le monde et tous les joueurs reviennent à l’accueil.', yes: 'Fermer la partie', danger: true }
              : { title: 'Quitter la partie ?', text: playing ? 'Ta main reste en jeu et les autres peuvent continuer. Tu pourras revenir avec le code de la partie.' : 'Tu reviendras à l’accueil.', yes: 'Quitter', danger: true });
            if (!ok) return;
            sheet.close();
            if (host || !playing) net.leave(); else net.reset();
          },
        }, net.isHost ? 'Fermer la partie pour tout le monde' : 'Quitter la partie') : null)),
    { title: 'Menu' });
}

// ───────────────────────────────────────────── Garde-fous

/** Le geste « retour » ne fait jamais quitter l'appli : il ferme une feuille, au plus. */
function trapBack() { try { history.pushState({ tp: 1 }, ''); } catch { /* sans importance */ } }
window.addEventListener('popstate', () => {
  trapBack();
  if (closeTopSheet()) return;
  if (ctx.net.status === 'idle' && ui.screen === 'rules') go('home');
});
document.addEventListener('pointerdown', () => { sound.unlock(); trapBack(); }, { once: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { keepAwake(); schedule(); } });

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('focusin', (e) => { if (e.target.matches('input[type="text"]')) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => document.body.classList.remove('typing'));

/** Empêche l'écran de s'éteindre pendant une partie, quand le navigateur le permet. */
let wake = null;
async function keepAwake() {
  try {
    if (!('wakeLock' in navigator) || document.hidden || ctx.net?.status !== 'room') return;
    if (wake && !wake.released) return;
    wake = await navigator.wakeLock.request('screen');
  } catch { /* refusé : sans conséquence */ }
}

// ───────────────────────────────────────────── Démarrage

applySettings();
installDefs();
ctx.net = new Net({
  connect: mqtt.connect,
  broker: BROKER,
  storage,
  onUpdate: schedule,
  onError: (msg) => { toast(msg, { tone: 'warn' }); sound.error(); },
  // délais réglables par l'adresse pour les tests de bout en bout (ex. ?miss=600&trio=800&grace=3000)
  ...Object.fromEntries([['miss', 'missMs'], ['trio', 'trioMs'], ['grace', 'graceMs']]
    .filter(([q]) => /^\d{2,6}$/.test(params.get(q) || ''))
    .map(([q, opt]) => [opt, Number(params.get(q))])),
});
render(true);
trapBack();
ctx.net.resume().catch(() => {}).finally(() => { window.__tpReady = true; schedule(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
