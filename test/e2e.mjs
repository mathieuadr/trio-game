// Test de bout en bout : de vraies parties, un téléphone émulé par joueur (Playwright),
// reliés par un relais MQTT local.
//
//   node test/e2e.mjs                       tous les scénarios
//   ONLY=normal node test/e2e.mjs           un seul scénario
//   OUT=dossier SCALE=2 node test/e2e.mjs   captures d'écran haute définition
//
// Le test joue l'arbitre : il lit l'état complet dans le stockage du téléphone de l'hôte pour
// choisir les cartes à retourner et vérifier que chaque écran ne montre que ce qu'il a le droit de montrer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { start, startBroker } from './serve.mjs';
import { legalMoves, play } from '../public/engine/game.js';
import { peek } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const mqtt = require('mqtt');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || path.join(HERE, 'shots');
const SCALE = Number(process.env.SCALE) || 1;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const NS = 'triplette-v1';
const MISS = 900; // durée d'affichage d'un tour raté pendant les tests
const TRIO = 1100;
fs.mkdirSync(OUT, { recursive: true });

const web = await start(Number(process.env.PORT) || 8101);
const relay = await startBroker(Number(process.env.BROKER_PORT) || 8885);
const APP = `${web.url}?broker=${encodeURIComponent(relay.url)}&miss=${MISS}&trio=${TRIO}&grace=2500`;
const browser = await chromium.launch();
const errors = [];
const done = [];

// ───────────────────────────────────────────── outils

const IPHONE = devices['iPhone 13'];
const PIXEL = devices['Pixel 7'];
const sized = (width, height, ua = IPHONE.userAgent) => ({ viewport: { width, height }, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, userAgent: ua });

async function phone(label, device = IPHONE, { motion = false, url = APP } = {}) {
  const context = await browser.newContext({ ...device, deviceScaleFactor: SCALE, locale: 'fr-FR' });
  await context.addInitScript((m) => {
    if (!localStorage.getItem('tp:prefs')) localStorage.setItem('tp:prefs', JSON.stringify({ name: '', mode: 'normal', sound: false, motion: m }));
  }, motion);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label} : ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} : console — ${m.text()}`); });
  await page.goto(url);
  await page.waitForFunction(() => window.__tpReady === true);
  const p = { label, context, page };
  p.id = await page.evaluate(() => JSON.parse(localStorage.getItem('tp:device')).id);
  return p;
}
async function reload(p) {
  await p.page.reload();
  await p.page.waitForFunction(() => window.__tpReady === true);
}
const shot = async (p, name) => { await p.page.waitForTimeout(350); await p.page.screenshot({ path: path.join(OUT, `${name}.png`) }); };
const text = async (page, sel) => (await page.textContent(sel)).trim();
const hostState = (host) => host.page.evaluate(() => JSON.parse(localStorage.getItem('tp:host')));
async function until(fn, what, timeout = 15000) {
  const t = Date.now();
  for (;;) {
    if (await fn().catch(() => false)) return;
    if (Date.now() - t > timeout) throw new Error(`Délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const phoneOf = (phones, id) => phones.find((p) => p.id === id && !p.gone);
const seatOf = (st, p) => st.members.findIndex((m) => m.id === p.id);

/** Écoute tout le trafic du relais pour une partie. */
function spy(code) {
  const seen = [];
  const c = mqtt.connect(relay.url);
  c.on('connect', () => c.subscribe(`${NS}/${code}/#`));
  c.on('message', (topic, payload) => seen.push({ topic, raw: payload.toString() }));
  return { seen, end: () => c.end(true) };
}
function assertSealed(seen) {
  let n = 0;
  for (const { topic, raw } of seen) {
    if (!raw) continue;
    const kind = topic.split('/')[2];
    const msg = JSON.parse(raw);
    if (kind === 'state' && msg.game) {
      assert.ok(!/"(hands|hand|won)":/.test(raw), 'secret en clair dans l\'état public');
      for (const pl of msg.game.players) assert.deepEqual(Object.keys(pl).sort(), ['cards', 'name', 'trios']);
      for (const c of msg.game.center) if (c.s !== 'up') assert.deepEqual(Object.keys(c), ['s'], 'une carte cachée du centre n\'a pas de valeur');
    }
    if (kind === 'p') { assert.deepEqual(Object.keys(msg).sort(), ['ct', 'iv']); n += 1; }
    if (kind === 'c' && msg.t !== 'join') assert.deepEqual(Object.keys(msg), ['box']);
  }
  assert.ok(n > 0, 'des mains chiffrées ont circulé');
}

/**
 * Ce téléphone ne montre et ne détient que ce qu'il a le droit de connaître : sa propre main,
 * les cartes révélées pendant le tour et les trios gagnés.
 */
async function assertPrivate(p, st, where) {
  const g = st.game;
  const seat = seatOf(st, p);
  const page = p.page;
  if (!(await page.locator('.table').count())) return;
  const dom = await page.evaluate(() => ({
    mine: [...document.querySelectorAll('#myHand .hslot:not(.out) .card')].map((c) => (c.dataset.v ? Number(c.dataset.v) : null)),
    mineOut: [...document.querySelectorAll('#myHand .hslot.out')].map((c) => Number(c.dataset.v)),
    tray: [...document.querySelectorAll('#tray .tslot[data-v]')].map((c) => Number(c.dataset.v)),
    centerUp: [...document.querySelectorAll('#center .cslot.up')].map((c) => [Number(c.dataset.slot), Number(c.dataset.v)]),
    centerDownFaces: document.querySelectorAll('#center .cslot.down .cfront, #center .cslot.down [data-v]').length,
    rivalFaces: document.querySelectorAll('#rivals .card, #rivals .cfront').length,
    rivalChips: [...document.querySelectorAll('#rivals .rival')].map((r) => [Number(r.dataset.seat), [...r.querySelectorAll('.mini.up')].map((m) => Number(m.textContent)), r.querySelectorAll('.mini:not(.up)').length]),
    keys: Object.keys(localStorage).sort(),
    hidden: !!document.querySelector('#btnHide[aria-pressed="true"]'),
  }));
  const shownTrio = g.outcome === 'trio';
  const outOf = (s, end) => (shownTrio ? [] : g.picks.filter((k) => k.from === 'hand' && k.seat === s && k.end === end).map((k) => k.v));
  const mine = g.hands[seat].map((c) => c.v);
  assert.deepEqual(dom.mine, dom.hidden ? mine.map(() => null) : mine, `${p.label} voit sa propre main, triée (${where})`);
  assert.deepEqual(dom.mineOut, [...outOf(seat, 'low'), ...outOf(seat, 'high').reverse()], `cartes de ${p.label} révélées (${where})`);
  assert.deepEqual(dom.tray, g.picks.map((k) => k.v), `cartes du tour chez ${p.label} (${where})`);
  assert.deepEqual(dom.centerUp, shownTrio ? [] : g.picks.filter((k) => k.from === 'center').map((k) => [k.slot, k.v]).sort((a, b) => a[0] - b[0]), `centre chez ${p.label} (${where})`);
  assert.equal(dom.centerDownFaces, 0, `aucune face dans une carte cachée du centre (${p.label}, ${where})`);
  assert.equal(dom.rivalFaces, 0, `aucune carte adverse dessinée face visible (${p.label}, ${where})`);
  for (const [s, chips, minis] of dom.rivalChips) {
    assert.deepEqual(chips, [...outOf(s, 'low'), ...outOf(s, 'high').reverse()], `main de ${g.players[s].name} vue par ${p.label} (${where})`);
    assert.equal(minis, g.hands[s].length, `nombre de cartes de ${g.players[s].name} vu par ${p.label} (${where})`);
  }
  // un joueur ne garde rien de la partie complète : seulement son identité et de quoi revenir
  if (p.id !== st.members[0].id || !dom.keys.includes('tp:host')) assert.deepEqual(dom.keys, ['tp:device', 'tp:prefs', 'tp:session'], `stockage de ${p.label}`);
}

// ── salon

async function createTable(host, guests, { invite = 1, mode = null } = {}) {
  await host.page.fill('#name', host.label);
  if (mode) await host.page.click(`#homeMode button[data-v="${mode}"]`);
  await host.page.click('#btnCreate');
  await host.page.waitForSelector('#roomCode');
  const code = await text(host.page, '#roomCode');
  for (const [i, g] of guests.entries()) {
    if (i < invite) {
      // arrivée par le lien d'invitation
      await g.page.goto(`${APP}&room=${code}`);
      await g.page.waitForFunction(() => window.__tpReady === true);
      await g.page.fill('#name', g.label);
      assert.ok((await text(g.page, '.invite')).includes(code));
      await g.page.click('#btnJoinInvite');
    } else {
      await g.page.fill('#name', g.label);
      await g.page.fill('#code', code.toLowerCase());
      await g.page.click('#btnJoin');
    }
    await g.page.waitForSelector('#members');
    await until(async () => (await host.page.locator('#members li').count()) === i + 2, `${g.label} dans le salon`);
  }
  return code;
}

// ── jeu

/** Trois révélations qui font un trio depuis cette position, s'il en existe (l'arbitre voit tout). */
function findTrio(g, want = null) {
  const walk = (s, pathSoFar) => {
    for (const m of legalMoves(s)) {
      const v = peek(s, m);
      if (want && v !== want) continue;
      if (pathSoFar.length && v !== s.picks[0].v) continue;
      const next = play(s, s.current, m);
      if (next.outcome === 'trio') return [...pathSoFar, m];
      if (next.phase === 'play') { const found = walk(next, [...pathSoFar, m]); if (found) return found; }
    }
    return null;
  };
  return walk(g, []);
}
/** De quoi rater le tour : deux cartes différentes, ou une seule si le tour est déjà commencé. */
function findMiss(g) {
  const moves = legalMoves(g);
  if (g.picks.length) {
    const other = moves.find((m) => peek(g, m) !== g.picks[0].v);
    return other ? [other] : null;
  }
  for (const a of moves) {
    const s = play(g, g.current, a);
    if (s.phase !== 'play') continue;
    const b = legalMoves(s).find((m) => peek(s, m) !== peek(g, a));
    if (b) return [a, b];
  }
  return null;
}

async function tap(phones, host, move) {
  const st = await hostState(host);
  const g = st.game;
  const actor = phoneOf(phones, st.members[g.current].id);
  assert.ok(actor, 'le joueur actif a un téléphone');
  const page = actor.page;
  await page.waitForSelector('.table.myturn');
  await until(async () => (await page.locator('#tray .tslot[data-v]').count()) === g.picks.length, 'joueur actif à jour');
  if (move.from === 'center') await page.click(`#center .cslot.down[data-slot="${move.slot}"]`);
  else if (move.seat === g.current) await page.click(g.hands[move.seat].length === 1 ? '#myHand .hslot.end' : `#myHand .hslot.end.${move.end}`);
  else await page.click(`.rival[data-seat="${move.seat}"] .end.${move.end}`);
  await until(async () => (await hostState(host)).game.reveals === g.reveals + 1, 'révélation appliquée');
  const after = await hostState(host);
  assert.equal(after.game.picks.at(-1).v, peek(g, move), 'la carte révélée est bien celle de l\'emplacement demandé');
  return after;
}

/** Tous les téléphones montrent la même table, et rien de trop. */
async function checkAll(phones, host, where) {
  const st = await hostState(host);
  const g = st.game;
  for (const p of phones.filter((x) => !x.gone)) {
    const page = p.page;
    await until(async () => (await page.locator('#tray .tslot[data-v]').count()) === g.picks.length
      && (await page.locator('#myHand .hslot:not(.out)').count()) === g.hands[seatOf(st, p)].length, `table à jour chez ${p.label} (${where})`);
    await assertPrivate(p, st, where);
    const mine = st.members[g.current].id === p.id && g.phase === 'play';
    assert.equal(await page.locator('.table.myturn').count(), mine ? 1 : 0, `${p.label} sait si c'est son tour (${where})`);
    const fit = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.ok(fit, `la table ne déborde pas en largeur chez ${p.label}`);
  }
  return st;
}
const settled = (host) => until(async () => (await hostState(host)).game.phase !== 'resolve', 'fin de tour automatique', 8000);

/** Joue un tour complet : un trio si `trio` (et s'il en existe un), sinon un tour raté. */
async function playTurn(phones, host, { trio = true, shots = null, check = true } = {}) {
  await settled(host);
  let st = await hostState(host);
  if (st.game.phase === 'over') return st;
  const moves = (trio && findTrio(st.game)) || findMiss(st.game) || findTrio(st.game);
  assert.ok(moves, 'un coup est toujours possible');
  for (const [k, m] of moves.entries()) {
    st = await tap(phones, host, m);
    if (check) await checkAll(phones, host, `tour ${st.game.turn}, carte ${k + 1}`);
    if (shots && k === moves.length - 1) {
      const actor = phoneOf(phones, st.members[st.game.current].id);
      const other = phones.find((p) => p !== actor && !p.gone);
      await shot(other, `${shots}-${st.game.outcome === 'trio' ? 'trio' : 'rate'}-spectateur`);
      await shot(actor, `${shots}-${st.game.outcome === 'trio' ? 'trio' : 'rate'}-joueur`);
    }
  }
  return st;
}

async function playOut(phones, host, { rhythm = 2, shots = null, max = 60 } = {}) {
  for (let k = 0; k < max; k++) {
    // un tour raté de temps en temps, pour vérifier que les cartes sont bien rendues
    const st = await playTurn(phones, host, { trio: k % rhythm !== 0, shots: shots && k < 4 ? `${shots}-${k}` : null });
    if (st.game.phase === 'over') return st;
  }
  throw new Error('partie sans fin');
}

async function scenario(name, fn) {
  if (ONLY && !ONLY.some((o) => name.startsWith(o))) return;
  const t = Date.now();
  await fn();
  done.push(`${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  console.log(`✓ ${name}`);
}

// ───────────────────────────────────────────── scénarios

await scenario('normal-4-joueurs : partie complète, rechargements, rejouer', async () => {
  const host = await phone('Léa');
  const guests = [await phone('Tom'), await phone('Inès', PIXEL), await phone('Noé')];
  const all = [host, ...guests];
  const code = await createTable(host, guests);
  const sp = spy(code);
  // l'hôte range la table : Noé passe avant Inès, et c'est Tom qui commence
  await host.page.click(`.member[data-id="${guests[2].id}"] [aria-label^="Monter"]`);
  await until(async () => (await guests[0].page.locator('#members li .m-name').allTextContents()).map((s) => s.replace(/hôte|toi|hors ligne/gi, '').trim()).join() === 'Léa,Tom,Noé,Inès', 'ordre diffusé');
  await host.page.click(`#firstPick [data-first="${guests[0].id}"]`);
  await until(async () => (await text(guests[1].page, '#firstName')) === 'Tom', 'premier joueur diffusé');
  assert.equal(await guests[0].page.locator('#btnLaunch').count(), 0, 'seul l\'hôte peut lancer');
  assert.ok((await text(host.page, '#dealSummary')).includes('7 cartes chacun, 8 au centre'));
  await host.page.click('#btnLaunch');
  for (const p of all) await p.page.waitForSelector('.table');

  let st = await checkAll(all, host, 'début');
  assert.equal(st.game.current, 1, 'Tom commence');
  assert.deepEqual([st.game.hands.map((h) => h.length), st.game.center.length], [[7, 7, 7, 7], 8]);
  assert.equal(await text(host.page, '#hudGoal'), '3 trios, ou le trio de 7');
  await shot(host, 'n4-table');
  await shot(guests[1], 'n4-table-pixel');

  // un joueur qui n'a pas la main ne peut rien retourner
  const watcher = guests[1];
  await watcher.page.click('#center .cslot.down >> nth=0');
  await watcher.page.waitForSelector('.toast');
  assert.match(await text(watcher.page, '.toast'), /C’est à Tom de jouer/);
  await watcher.page.click('.rival >> nth=0 >> .end.low');
  await watcher.page.waitForTimeout(250);
  assert.equal((await hostState(host)).game.reveals, 0);

  // cacher sa main : les cartes passent de dos sur son propre écran
  await watcher.page.click('#btnHide');
  assert.equal(await watcher.page.locator('#myHand .cfront').count(), 0);
  await watcher.page.click('#btnHide');
  assert.equal(await watcher.page.locator('#myHand .cfront').count(), 7);

  // premier tour : raté, les cartes retournent à leur place sur tous les écrans
  const before = st.game;
  st = await playTurn(all, host, { trio: false });
  assert.equal(st.game.outcome, 'miss');
  for (const p of all) assert.equal(await text(p.page, '#stageTitle'), 'Raté !');
  await settled(host);
  st = await checkAll(all, host, 'après un tour raté');
  assert.deepEqual(st.game.hands, before.hands, 'mains rendues à l\'identique');
  assert.deepEqual(st.game.center, before.center, 'centre rendu à l\'identique');
  assert.equal(st.game.current, 2, 'au joueur suivant');

  // un joueur recharge en pleine partie : il retrouve sa main
  await reload(guests[2]);
  await guests[2].page.waitForSelector('.table');
  await checkAll(all, host, 'après rechargement d\'un joueur');

  // un trio, puis l'hôte recharge en plein milieu d'un tour
  st = await playTurn(all, host, { trio: true });
  if (st.game.outcome === 'trio') for (const p of all) assert.match(await text(p.page, '#stageTitle'), /^Trio de \d+ !$/);
  await settled(host);
  st = await hostState(host);
  if (st.game.phase !== 'over') {
    const m = findTrio(st.game)?.[0] || legalMoves(st.game)[0];
    st = await tap(all, host, m);
    const snapshot = JSON.stringify(st.game);
    await reload(host);
    await host.page.waitForSelector('.table');
    await until(async () => (await hostState(host)).game.reveals === st.game.reveals, 'hôte de retour');
    assert.equal(JSON.stringify((await hostState(host)).game), snapshot, 'la partie reprend exactement où elle en était');
    await checkAll(all, host, 'après rechargement de l\'hôte');
  }

  st = await playOut(all, host, { rhythm: 3 });
  assert.equal(st.game.phase, 'over');
  const winner = st.game.players[st.game.winner].name;
  for (const p of all) {
    await p.page.waitForSelector('.over', { timeout: 8000 });
    assert.equal(await text(p.page, '#overTitle'), p.label === winner ? 'Tu as gagné !' : `${winner} gagne !`);
    assert.equal(await p.page.locator('#scores .score-row').count(), 4);
    assert.equal(await p.page.locator('#scores .score-row.won .trio-chip').count(), st.game.trios[st.game.winner].length);
  }
  assert.ok(['three', 'seven'].includes(st.game.reason));
  assertSealed(sp.seen);
  sp.end();
  // rejouer avec la même table : seul l'hôte décide, le joueur suivant commence
  assert.equal(await guests[0].page.locator('#btnReplay').count(), 0);
  await host.page.click('#btnReplay');
  for (const p of all) await p.page.waitForSelector('.table');
  st = await checkAll(all, host, 'nouvelle partie');
  assert.equal(st.game.first, 2);
  assert.equal(st.game.reveals, 0);
  for (const p of all) await p.context.close();
});

await scenario('picante-3-joueurs : liaisons, joueur actif déconnecté, retour au salon', async () => {
  const host = await phone('Ana', sized(375, 667));
  const guests = [await phone('Ben'), await phone('Chloé', PIXEL)];
  const all = [host, ...guests];
  await createTable(host, guests, { invite: 2, mode: 'spicy' });
  assert.equal(await text(guests[0].page, '#modeName'), 'Picante');
  assert.equal(await guests[0].page.locator('#linksTable .link-pair').count(), 9, 'huit liaisons et le 7');
  // l'hôte peut encore changer de mode dans le salon
  await host.page.click('#modePick button[data-v="normal"]');
  await until(async () => (await text(guests[1].page, '#modeName')) === 'Normal', 'mode diffusé');
  await host.page.click('#modePick button[data-v="spicy"]');
  await until(async () => (await text(guests[1].page, '#modeName')) === 'Picante', 'mode diffusé');
  await host.page.click(`#firstPick [data-first="${guests[0].id}"]`);
  await until(async () => (await text(guests[1].page, '#firstName')) === 'Ben', 'premier joueur diffusé');
  await host.page.click('#btnLaunch');
  for (const p of all) await p.page.waitForSelector('.table.spicy');
  let st = await checkAll(all, host, 'début');
  assert.deepEqual([st.game.hands.map((h) => h.length), st.game.center.length, st.game.mode], [[9, 9, 9], 9, 'spicy']);
  assert.equal(await text(host.page, '#hudGoal'), '2 trios liés, ou le trio de 7');
  await shot(host, 'p3-table-petit-ecran');
  await shot(guests[0], 'p3-table');
  await host.page.click('#btnLinks');
  await host.page.waitForSelector('.links-sheet #linksTable');
  await shot(host, 'p3-liaisons');
  await host.page.click('.sheet .icon-btn');

  // Ben, le joueur actif, perd la connexion : son tour reste le sien, en pause
  const ben = guests[0];
  st = await tap(all, host, legalMoves(st.game)[0]);
  await ben.context.setOffline(true);
  await until(async () => (await text(host.page, '#stageTitle')) === 'Ben est hors ligne', 'pause visible chez l\'hôte', 30000);
  await until(async () => (await text(guests[1].page, '#stageTitle')) === 'Ben est hors ligne', 'pause visible des autres joueurs');
  assert.match(await text(guests[1].page, '#stageHint'), /Ana peut attendre ou interrompre/);
  await host.page.waitForSelector('#awayActions', { timeout: 15000 });
  await shot(host, 'p3-pause-hote');
  await shot(guests[1], 'p3-pause-joueur');
  assert.equal(await guests[1].page.locator('#awayActions').count(), 0, 'seul l\'hôte décide');
  st = await hostState(host);
  assert.deepEqual([st.game.current, st.game.picks.length], [1, 1], 'aucun passage automatique du tour');
  await host.page.click('#btnWait');
  await until(async () => (await host.page.locator('#awayActions').count()) === 0, 'on attend encore');
  // Ben revient : la partie reprend avec lui, sa carte toujours révélée
  await ben.context.setOffline(false);
  await until(async () => (await text(host.page, '#stageTitle')) !== 'Ben est hors ligne', 'reprise', 30000);
  await ben.page.waitForSelector('.table.myturn', { timeout: 20000 });
  st = await checkAll(all, host, 'après le retour de Ben');
  assert.deepEqual([st.game.current, st.game.picks.length], [1, 1]);

  st = await playOut(all, host, { rhythm: 4 });
  assert.equal(st.game.phase, 'over');
  assert.ok(['linked', 'seven'].includes(st.game.reason), `victoire Picante : ${st.game.reason}`);
  for (const p of all) await p.page.waitForSelector('.over', { timeout: 8000 });
  if (st.game.reason === 'linked') assert.match(await text(host.page, '#overHow'), /2 trios liés — Deux trios liés : le \d+ et le \d+\./);
  // retour au salon : la victoire est comptée, les réglages sont de nouveau modifiables
  await host.page.click('#btnBackLobby');
  for (const p of all) await p.page.waitForSelector('#members');
  assert.equal(await host.page.locator('#members .tag-mini.wins').count(), 1);
  // l'hôte ferme la partie : tout le monde revient à l'accueil
  await host.page.click('#btnLeaveLobby');
  await host.page.click('.confirm .btn.danger');
  for (const p of all) await p.page.waitForSelector('#btnCreate, #btnJoinInvite');
  for (const p of all) await p.context.close();
});

await scenario('captures : 6 joueurs, animations, petits écrans, partie interrompue', async () => {
  const host = await phone('Zoé', sized(375, 667), { motion: true });
  const guests = [
    await phone('Yan', IPHONE, { motion: true }), await phone('Xu', sized(360, 640, PIXEL.userAgent), { motion: true }),
    await phone('Wim', sized(430, 932), { motion: true }), await phone('Vic', PIXEL, { motion: true }), await phone('Uma', sized(390, 664), { motion: true }),
  ];
  const all = [host, ...guests];
  await shot(host, 'z-accueil');
  await guests[0].page.goto(`${APP}&room=ABCDE`);
  await guests[0].page.waitForFunction(() => window.__tpReady === true);
  await shot(guests[0], 'z-accueil-invitation');
  await guests[0].page.goto(APP);
  await guests[0].page.waitForFunction(() => window.__tpReady === true);
  const code = await createTable(host, guests, { invite: 0, mode: 'spicy' });
  // table pleine : un septième joueur est refusé
  const extra = await phone('Tao');
  await extra.page.fill('#name', 'Tao');
  await extra.page.fill('#code', code);
  await extra.page.click('#btnJoin');
  await extra.page.waitForSelector('.toast');
  assert.match(await text(extra.page, '.toast'), /complète \(6 joueurs\)/);
  await extra.context.close();
  await shot(host, 'z-salon-hote');
  await shot(guests[0], 'z-salon-joueur');
  await host.page.click('#btnLaunch');
  for (const p of all) await p.page.waitForSelector('.table');
  let st = await checkAll(all, host, 'début à 6');
  assert.deepEqual([st.game.hands.map((h) => h.length), st.game.center.length], [[5, 5, 5, 5, 5, 5], 6]);
  const actor = phoneOf(all, st.members[st.game.current].id);
  const other = all.find((p) => p !== actor);
  await shot(actor, 'z-table-a-toi');
  await shot(other, 'z-table-spectateur');
  // la table tient dans l'écran, même sur les plus petits
  for (const p of all) {
    const fit = await p.page.evaluate(() => ({ w: document.documentElement.scrollWidth <= innerWidth, h: document.querySelector('.table').getBoundingClientRect().height <= innerHeight + 1 }));
    assert.deepEqual(fit, { w: true, h: true }, `la table tient dans l'écran de ${p.label}`);
  }
  st = await tap(all, host, findMiss(st.game)[0]);
  await shot(actor, 'z-table-une-carte');
  st = await playTurn(all, host, { trio: false, shots: 'z-1' });
  assert.equal(st.game.outcome, 'miss');
  await settled(host);
  st = await playTurn(all, host, { trio: true, shots: 'z-2' });
  await settled(host);
  st = await playOut(all, host, { rhythm: 5, shots: 'z-3' });
  for (const p of all) await p.page.waitForSelector('.over', { timeout: 8000 });
  await host.page.waitForTimeout(900);
  const win = phoneOf(all, st.members[st.game.winner].id);
  await shot(win, 'z-fin-gagnant');
  await shot(all.find((p) => p !== win), 'z-fin-autre');
  // nouvelle partie, que l'hôte interrompt depuis le menu
  await host.page.click('#btnReplay');
  for (const p of all) await p.page.waitForSelector('.table');
  await host.page.click('#btnMenu');
  await shot(host, 'z-menu');
  await host.page.click('#menuAbort');
  await host.page.click('.confirm .btn.danger');
  for (const p of all) await p.page.waitForSelector('#members');
  await host.page.click('#btnLobbyRules');
  await host.page.waitForSelector('.sheet.open .rules');
  await shot(host, 'z-regles');
  for (const p of all) await p.context.close();
});

await scenario('adresse-non-securisee : message clair au lieu d\'une partie sans chiffrement', async () => {
  // hors https (et hors localhost), le navigateur ne fournit pas Web Crypto : pas de partie possible
  const plain = await chromium.launch({ args: ['--host-resolver-rules=MAP jeu.test 127.0.0.1'] });
  const context = await plain.newContext({ ...IPHONE, locale: 'fr-FR' });
  const page = await context.newPage();
  await page.goto(APP.replace('localhost', 'jeu.test'));
  await page.waitForFunction(() => window.__tpReady === true);
  assert.equal(await page.evaluate(() => window.isSecureContext), false);
  await page.fill('#name', 'Lou');
  await page.click('#btnCreate');
  await page.waitForSelector('.toast');
  assert.match(await text(page, '.toast'), /https/);
  assert.equal(await page.locator('#roomCode').count(), 0);
  await plain.close();
});

// ───────────────────────────────────────────── bilan

await browser.close();
web.server.close();
await relay.close();
if (errors.length) {
  console.error(`\n✗ Erreurs dans les pages :\n  ${[...new Set(errors)].join('\n  ')}`);
  process.exit(1);
}
console.log(`\n✓ ${done.length} scénario${done.length > 1 ? 's' : ''} de bout en bout :\n  ${done.join('\n  ')}`);
console.log(`  Captures : ${OUT}`);
