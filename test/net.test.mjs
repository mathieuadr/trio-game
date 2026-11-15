// Tests de la partie à plusieurs téléphones : un relais MQTT local, un hôte, des joueurs,
// et un « espion » abonné à tout le trafic du relais.
// `node --test test/net.test.mjs`
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { Net, NS } from '../public/net/room.js';
import { open, seal, sharedKey, makeKeyPair, BLOCK } from '../public/net/crypto.js';
import { publicView } from '../public/state/privacy.js';
import { legalMoves } from '../public/engine/game.js';
import { seeded, peek, publicLeaks, invariants } from './helpers.mjs';

const require = createRequire(import.meta.url);
const mqtt = require('mqtt');
const aedes = require('aedes');

let broker; let server; let url;
before(async () => {
  broker = await aedes.createBroker();
  server = net.createServer(broker.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `mqtt://127.0.0.1:${server.address().port}`;
});

const memory = () => { const m = new Map(); return { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)), del: (k) => m.delete(k), raw: m }; };
const live = new Set();
function phone(label, storage = memory(), opts = {}) {
  const errors = [];
  const p = new Net({
    connect: mqtt.connect, broker: url, storage, onError: (m) => errors.push(m),
    hbMs: 150, offlineMs: 600, joinWaitMs: 1500, joinRetryMs: 500, missMs: 60, trioMs: 60, graceMs: 500, ...opts,
  });
  Object.assign(p, { label, errors, store: storage });
  live.add(p);
  return p;
}
const close = (p) => { p.close(); live.delete(p); };
const spies = new Set();
after(async () => {
  for (const p of live) p.close(); // d'abord les téléphones encore ouverts (test en échec), puis le relais
  for (const c of spies) c.end(true);
  await new Promise((r) => server.close(r));
  await new Promise((r) => broker.close(r));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, what, timeout = 5000) {
  const t = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await pred(); } catch { ok = false; }
    if (ok) return;
    if (Date.now() - t > timeout) throw new Error(`Délai dépassé : ${what}`);
    await sleep(10);
  }
}
const connected = (...ps) => until(() => ps.every((p) => p.connected), 'connexion au relais');

function spy(code) {
  const seen = [];
  const c = mqtt.connect(url);
  spies.add(c);
  c.on('connect', () => c.subscribe(`${NS}/${code}/#`));
  c.on('message', (topic, payload) => seen.push({ topic, raw: payload.toString() }));
  return { seen, client: c, ready: until(() => c.connected, 'espion connecté') };
}

/** Monte une table : un hôte et des joueurs dans le salon. */
async function table(names, { hostOpts = {}, mode } = {}) {
  const host = phone(names[0], memory(), hostOpts);
  await connected(host);
  const code = await host.create(names[0], { mode });
  const guests = names.slice(1).map((n) => phone(n));
  await connected(...guests);
  // un par un, pour que l'ordre autour de la table soit celui de la liste
  for (const [i, g] of guests.entries()) {
    await g.join(code, names[i + 1]);
    await until(() => g.status === 'room', `${names[i + 1]} dans le salon`);
  }
  await until(() => host.room.members.length === names.length, 'tout le monde dans le salon');
  assert.deepEqual(host.room.members.map((m) => m.name), names);
  return { host, guests, all: [host, ...guests], code };
}
const bySeat = (all, room) => room.members.map((m) => all.find((p) => p.id === m.id));
const sameView = (all, host = all[0]) => until(() => {
  const ref = JSON.stringify(host.room.game);
  return all.every((p) => JSON.stringify(p.room?.game) === ref && p.room.ver === host.room.ver);
}, 'tous les téléphones voient la même table');
/** Chaque joueur a reçu sa main, et c'est bien la sienne. */
const handsDelivered = (all, host) => until(() => all.every((p) => {
  const seat = host.room.members.findIndex((m) => m.id === p.id);
  return p.priv && p.priv.gameId === host.room.gameId && JSON.stringify(p.priv.hand) === JSON.stringify(host.host.game.hands[seat].map((c) => c.v));
}), 'chacun a reçu sa main');

/** Le joueur actif joue un coup ; attend que l'hôte l'ait appliqué. */
async function act(t, move) {
  const { host, all } = t;
  const g = host.host.game;
  const actor = bySeat(all, host.room)[g.current];
  await until(() => actor.room?.game?.step === g.step, 'le joueur actif est à jour');
  const reveals = g.reveals;
  assert.equal(await actor.reveal(move), true);
  await until(() => host.host.game.reveals === reveals + 1, 'révélation appliquée');
  return host.host.game;
}
const settled = (host) => until(() => host.host.game.phase !== 'resolve', 'fin de tour automatique');

/** Fait jouer une partie entière par des joueurs qui se souviennent plus ou moins de tout. */
async function playOut(t, rng, skill = 0.9) {
  const { host } = t;
  for (let guard = 0; guard < 3000; guard++) {
    await settled(host);
    const g = host.host.game;
    if (g.phase === 'over') return g;
    assert.deepEqual(invariants(g), []);
    const moves = legalMoves(g);
    const same = g.picks.length && rng() < skill ? moves.filter((m) => peek(g, m) === g.picks[0].v) : [];
    const pool = same.length ? same : moves;
    await act(t, pool[Math.floor(rng() * pool.length)]);
  }
  throw new Error('partie sans fin');
}

// ───────────────────────────────────────────── scénarios

test('chiffrement : la taille d\'un message ne dit rien de son contenu', async () => {
  const [a, b, c] = await Promise.all([makeKeyPair(), makeKeyPair(), makeKeyPair()]);
  const key = await sharedKey(a.priv, b.pub);
  const small = await seal(key, 'priv:x', { gameId: 'aaaaaaaa', seat: 0, hand: [1], ver: 1 });
  const big = await seal(key, 'priv:x', { gameId: 'aaaaaaaa', seat: 5, hand: [10, 10, 10, 11, 11, 11, 12, 12, 12], ver: 99999 });
  const empty = await seal(key, 'priv:x', { gameId: 'aaaaaaaa', seat: 0, hand: [], ver: 1 });
  assert.equal(small.ct.length, big.ct.length);
  assert.equal(small.ct.length, empty.ct.length);
  assert.equal(Buffer.from(small.ct, 'base64').length, BLOCK + 16, 'un bloc, plus l\'étiquette d\'authenticité');
  assert.notEqual(small.iv, big.iv);
  // le destinataire relit exactement ce qui a été chiffré, accents compris
  assert.deepEqual(await open(await sharedKey(b.priv, a.pub), 'priv:x', big), { gameId: 'aaaaaaaa', seat: 5, hand: [10, 10, 10, 11, 11, 11, 12, 12, 12], ver: 99999 });
  const msg = { msg: 'C’est à Zoé de jouer — déjà commencé…' };
  assert.deepEqual(await open(key, 'err:x', await seal(key, 'err:x', msg)), msg);
  // un tiers, un autre usage ou un message altéré : illisible
  assert.equal(await open(await sharedKey(c.priv, a.pub), 'priv:x', big), null);
  assert.equal(await open(key, 'cmd:x', big), null);
  assert.equal(await open(key, 'priv:x', { iv: big.iv, ct: small.ct }), null);
  // un long message occupe plusieurs blocs entiers
  const long = await seal(key, 'err:x', { msg: 'x'.repeat(700) });
  assert.equal(Buffer.from(long.ct, 'base64').length, 3 * BLOCK + 16);
});

test('salon : rejoindre, refus (prénom en double, table pleine, code inconnu), réglages, ordre, retrait', async () => {
  const t = await table(['Ana', 'Ben', 'Chloé']);
  const { host, guests, code } = t;
  assert.equal(code.length, 5);
  assert.deepEqual(host.room.settings, { mode: 'normal', max: 6, first: 'random' });
  // prénom déjà pris : refusé, le joueur revient à l'accueil avec un message
  const dup = phone('Ana bis');
  await connected(dup);
  await dup.join(code, 'ana');
  await until(() => dup.status === 'idle', 'refus du prénom en double');
  assert.match(dup.errors.at(-1), /déjà pris/);
  close(dup);
  // code inexistant
  const lost = phone('Perdu');
  await connected(lost);
  await lost.join('ZZZZZ', 'Perdu');
  await until(() => lost.status === 'idle', 'salle introuvable', 4000);
  assert.match(lost.errors.at(-1), /introuvable/);
  close(lost);
  // seul l'hôte règle la partie
  assert.equal(await guests[0].send({ t: 'settings', mode: 'spicy' }), true);
  await until(() => guests[0].errors.length, 'refus côté joueur');
  assert.match(guests[0].errors.at(-1), /Seul l’hôte/);
  await host.send({ t: 'settings', mode: 'spicy' });
  await until(() => guests.every((g) => g.room.settings.mode === 'spicy'), 'mode diffusé');
  await host.send({ t: 'settings', mode: 'n\'importe quoi', max: 99, first: 'inconnu' });
  assert.deepEqual(host.room.settings, { mode: 'spicy', max: 6, first: 'random' }, 'réglages invalides ignorés');
  // le nombre de places : jamais moins que les joueurs présents, jamais moins de 3
  await host.send({ t: 'settings', max: 2 });
  assert.equal(host.room.settings.max, 3);
  const extra = phone('Dov');
  await connected(extra);
  await extra.join(code, 'Dov');
  await until(() => extra.status === 'idle', 'table pleine');
  assert.match(extra.errors.at(-1), /complète \(3 joueurs\)/);
  await host.send({ t: 'settings', max: 4 });
  await extra.join(code, 'Dov');
  await until(() => extra.status === 'room' && host.room.members.length === 4, 'place libérée');
  // l'ordre autour de la table et le premier joueur
  await host.send({ t: 'move', id: extra.id, delta: -1 });
  await until(() => guests[0].room.members.map((m) => m.name).join() === 'Ana,Ben,Dov,Chloé', 'ordre mis à jour');
  await host.send({ t: 'settings', first: guests[1].id });
  await until(() => guests[0].room.settings.first === guests[1].id, 'premier joueur diffusé');
  // un joueur quitte : s'il devait commencer, on revient au tirage au sort
  await guests[1].leave();
  await until(() => host.room.members.length === 3, 'départ pris en compte');
  assert.equal(guests[1].status, 'idle');
  assert.equal(host.room.settings.first, 'random');
  // retrait par l'hôte, puis impossible de lancer à 2
  await host.send({ t: 'kick', id: extra.id });
  await until(() => extra.status === 'idle', 'joueur retiré');
  assert.match(extra.errors.at(-1), /retiré/);
  await host.send({ t: 'start' });
  assert.match(host.errors.at(-1), /au moins 3/);
  assert.equal(await guests[0].send({ t: 'start' }), true);
  await until(() => guests[0].errors.some((e) => /Seul l’hôte/.test(e)), 'un joueur ne lance pas la partie');
  // l'hôte ferme la partie : tout le monde est prévenu
  await host.leave();
  await until(() => guests[0].status === 'idle', 'fermeture reçue');
  assert.match(guests[0].errors.at(-1), /fermé/);
  close(extra);
  for (const p of t.all) close(p);
});

for (const n of [3, 4, 5, 6]) {
  test(`partie complète à ${n} joueurs : chacun sa main, mêmes révélations pour tous, rien de caché en clair sur le relais`, async () => {
    const t = await table(['Ana', 'Ben', 'Chloé', 'Dov', 'Emma', 'Farid'].slice(0, n), { mode: n % 2 ? 'spicy' : 'normal' });
    const { host, guests, all, code } = t;
    const s = spy(code);
    await s.ready;
    // on ne rejoint plus une partie commencée
    await host.send({ t: 'start' });
    await handsDelivered(all, host);
    const late = phone('Retard');
    await connected(late);
    await late.join(code, 'Retard');
    await until(() => late.status === 'idle', 'refus en cours de partie');
    assert.match(late.errors.at(-1), /déjà commencé/);
    close(late);

    const g0 = host.host.game;
    const sizes = { 3: [9, 9], 4: [7, 8], 5: [6, 6], 6: [5, 6] }[n];
    assert.deepEqual([g0.hands[0].length, g0.center.length], sizes);
    assert.equal(g0.mode, n % 2 ? 'spicy' : 'normal');
    // chaque téléphone ne détient que sa propre main
    for (const p of all) {
      assert.equal(p.priv.hand.length, sizes[0]);
      assert.deepEqual(Object.keys(p.priv).sort(), ['gameId', 'hand', 'seat', 'ver']);
      if (p !== host) assert.equal(p.host, null, 'l\'état complet reste chez l\'hôte');
    }

    const end = await playOut(t, seeded(1000 + n));
    assert.equal(end.phase, 'over');
    await sameView(all, host);
    assert.deepEqual(guests[0].room.game, publicView(host.host.game));
    assert.equal(guests[0].room.game.winner, end.winner);
    const winnerId = host.room.members[end.winner].id;
    assert.equal(guests.at(-1).room.members.find((m) => m.id === winnerId).wins, 1, 'victoire comptée et diffusée');

    // ── analyse du trafic capturé par l'espion
    await sleep(150);
    let publicMsgs = 0; let sealed = 0;
    const handSizes = new Set();
    for (const { topic, raw } of s.seen) {
      if (!raw) continue;
      const kind = topic.split('/')[2];
      const msg = JSON.parse(raw);
      if (kind === 'state') {
        publicMsgs += 1;
        assert.ok(!/"(hands|hand|won|id)":\s*[[\d]/.test(raw.replace(/"id":"[0-9a-f]+"/g, '')), `secret en clair dans l'état public : ${raw.slice(0, 200)}`);
        if (msg.game) {
          assert.deepEqual(publicLeaks(msg.game), []);
          // le nombre de valeurs lisibles ne dépasse jamais ce qui est révélé ou gagné
          const up = msg.game.center.filter((c) => c.s === 'up').length;
          assert.ok(up <= 3 && msg.game.picks.length <= 3);
        }
      } else if (kind === 'p') {
        sealed += 1;
        assert.deepEqual(Object.keys(msg).sort(), ['ct', 'iv'], 'main chiffrée');
        handSizes.add(msg.ct.length);
      } else if (kind === 'c' && msg.t !== 'join') {
        assert.deepEqual(Object.keys(msg), ['box'], 'action chiffrée');
        assert.deepEqual(Object.keys(msg.box).sort(), ['ct', 'iv']);
      } else if (kind === 'c') {
        assert.deepEqual(Object.keys(msg).sort(), ['key', 'name', 't'], 'une demande pour rejoindre ne contient que le prénom et la clé publique');
      }
    }
    assert.ok(publicMsgs > 10 && sealed >= n - 1, `trafic observé (${publicMsgs} publics, ${sealed} privés)`);
    assert.equal(handSizes.size, 1, `toutes les mains chiffrées ont la même taille, quelles que soient les cartes (${[...handSizes]})`);
    // un joueur ne peut pas lire la main d'un autre, même en écoutant le relais
    const [a, b] = guests;
    const last = (id) => JSON.parse(s.seen.filter((m) => m.topic.endsWith(`/p/${id}`) && m.raw).at(-1).raw);
    const aKey = await sharedKey(a.keys.priv, host.keys.pub);
    assert.equal(await open(aKey, `priv:${b.id}`, last(b.id)), null, 'chiffré pour B : illisible pour A');
    assert.ok(await open(aKey, `priv:${a.id}`, last(a.id)), 'lisible par son destinataire');

    // ── rejouer avec la même table : nouvelle donne, le joueur suivant commence
    const first = end.first;
    await host.send({ t: 'replay' });
    await until(() => all.every((p) => p.room.game?.phase === 'play' && p.room.game.reveals === 0 && p.priv?.gameId === host.room.gameId), 'nouvelle partie partout');
    assert.equal(host.host.game.first, (first + 1) % n);
    await handsDelivered(all, host);
    s.client.end(true);
    for (const p of all) close(p);
  });
}

test('règles appliquées par l\'hôte : hors tour refusé, double appui ignoré, deux actions en même temps', async () => {
  const t = await table(['Ana', 'Ben', 'Chloé', 'Dov'], { hostOpts: { missMs: 400, trioMs: 400 } });
  const { host, all } = t;
  await host.send({ t: 'settings', first: all[1].id });
  await host.send({ t: 'start' });
  await handsDelivered(all, host);
  await sameView(all, host);
  let g = host.host.game;
  assert.equal(g.current, 1, 'le joueur choisi par l\'hôte commence');
  const seats = bySeat(all, host.room);
  const actor = seats[1];
  const other = seats[2];

  // un joueur qui n'a pas la main ne révèle rien — ni au centre, ni dans une main, ni dans la sienne
  for (const move of [{ from: 'center', slot: 0 }, { from: 'hand', seat: 1, end: 'low' }, { from: 'hand', seat: 2, end: 'high' }]) {
    const before = other.errors.length;
    await other.reveal(move);
    await until(() => other.errors.length > before, 'refus hors tour');
    assert.match(other.errors.at(-1), /C’est à Ben de jouer/);
  }
  assert.equal(host.host.game.reveals, 0);

  // demandes mal formées : rien ne se passe, le joueur est prévenu
  for (const bad of [{ from: 'hand', seat: 0, end: 'middle' }, { from: 'hand', seat: 0, end: 2 }, { from: 'hand', seat: 9, end: 'low' }, { from: 'center', slot: 99 }, { from: 'pioche' }]) {
    const before = actor.errors.length;
    await actor.reveal(bad);
    await until(() => actor.errors.length > before, 'demande invalide refusée');
  }
  assert.equal(host.host.game.reveals, 0);
  // le client ne choisit jamais la valeur : même s'il en envoie une, c'est l'hôte qui trouve la carte
  const lowest = host.host.game.hands[0][0].v;
  const wished = lowest === 12 ? 1 : 12;
  await actor.reveal({ from: 'hand', seat: 0, end: 'low', value: wished, v: wished, slot: 3 });
  await until(() => host.host.game.reveals === 1, 'révélation appliquée');
  g = host.host.game;
  assert.deepEqual(g.picks.map((p) => [p.v, p.from, p.seat, p.end]), [[lowest, 'hand', 0, 'low']], 'la plus petite carte de la main visée, quoi que dise le client');

  // double appui : la même action envoyée deux fois d'affilée ne retourne qu'une carte
  await until(() => actor.room.game.step === g.step, 'joueur à jour');
  const center = g.center.findIndex(Boolean);
  await Promise.all([actor.reveal({ from: 'center', slot: center }), actor.reveal({ from: 'center', slot: center }), actor.reveal({ from: 'hand', seat: 3, end: 'high' })]);
  await sleep(250);
  assert.equal(host.host.game.reveals, 2, 'une seule action acceptée par étape');
  assert.equal(host.host.game.picks.at(-1).slot, center);

  // deux joueurs agissent en même temps : seule l'action du joueur actif compte
  await settled(host);
  await sameView(all, host);
  g = host.host.game;
  const now = bySeat(all, host.room)[g.current];
  const intruder = all.find((p) => p !== now);
  const reveals = g.reveals;
  await Promise.all([intruder.reveal({ from: 'center', slot: center }), now.reveal({ from: 'center', slot: center })]);
  await until(() => host.host.game.reveals === reveals + 1, 'action du joueur actif appliquée');
  await sleep(150);
  assert.equal(host.host.game.reveals, reveals + 1);
  assert.ok(intruder.errors.some((e) => /de jouer/.test(e)));

  // pendant la résolution d'un tour raté, plus rien ne se révèle ; puis le tour passe tout seul
  g = host.host.game;
  const other2 = legalMoves(g).find((m) => peek(g, m) !== g.picks[0].v);
  await act(t, other2);
  g = host.host.game;
  assert.deepEqual([g.phase, g.outcome], ['resolve', 'miss']);
  await sameView(all, host);
  const turnNow = g.turn;
  const cur = g.current;
  await now.reveal({ from: 'center', slot: g.center.findIndex((c, i) => c && !g.picks.some((p) => p.slot === i)) });
  await sleep(120);
  assert.equal(host.host.game.reveals, g.reveals, 'aucune révélation pendant la résolution');
  await settled(host);
  g = host.host.game;
  assert.deepEqual([g.phase, g.turn, g.current, g.picks.length], ['play', turnNow + 1, (cur + 1) % 4, 0], 'joueur suivant, sans intervention');
  assert.deepEqual(invariants(g), []);
  await sameView(all, host);
  assert.ok(all.every((p) => p.room.game.center.every((c) => c.s === 'down')), 'cartes rendues face cachée partout');
  await handsDelivered(all, host);
  for (const p of all) close(p);
});

test('rechargement : un joueur puis l\'hôte rechargent l\'appli en pleine partie', async () => {
  const t = await table(['Léa', 'Tom', 'Inès', 'Noé', 'Jade'], { hostOpts: { missMs: 300, trioMs: 300 } });
  const { host, guests, all } = t;
  await host.send({ t: 'start' });
  await handsDelivered(all, host);
  // un joueur recharge : il retrouve sa main et la table
  const hand = JSON.stringify(guests[1].priv.hand);
  const store = guests[1].store;
  close(guests[1]);
  const back = phone('Inès (rechargée)', store);
  await connected(back);
  assert.equal(await back.resume(), true);
  await until(() => back.status === 'room' && back.priv?.hand, 'reprise du joueur');
  assert.equal(JSON.stringify(back.priv.hand), hand);
  assert.equal(back.seat, 2);
  t.guests[1] = back; t.all[2] = back;
  const rng = seeded(5);
  for (let i = 0; i < 7; i++) {
    await settled(host);
    const g = host.host.game;
    const moves = legalMoves(g);
    await act(t, moves[Math.floor(rng() * moves.length)]);
  }
  // l'hôte recharge en plein tour (même en pleine résolution) : la partie reprend où elle en était
  const snapshot = JSON.stringify(host.host.game);
  const hostStore = host.store;
  close(host);
  await until(() => !t.guests[0].hostOnline, 'les joueurs voient l\'hôte hors ligne', 3000);
  const host2 = phone('Léa (rechargée)', hostStore, { missMs: 300, trioMs: 300 });
  assert.equal(await host2.resume(), true);
  assert.equal(JSON.stringify(host2.host.game), snapshot);
  await connected(host2);
  t.host = host2; t.all[0] = host2;
  await until(() => t.guests.every((g) => g.hostOnline), 'hôte de retour');
  await settled(host2);
  await handsDelivered(t.all, host2);
  const end = await playOut(t, seeded(9));
  assert.equal(end.phase, 'over');
  await sameView(t.all, host2);
  // retour au salon : plus aucune main ne circule
  await host2.send({ t: 'lobby' });
  await until(() => t.all.every((p) => p.room.status === 'lobby' && p.priv === null), 'retour au salon partout');
  for (const p of t.all) close(p);
});

test('joueur actif déconnecté : tour en pause, l\'hôte choisit d\'attendre ou d\'interrompre, jamais de passage automatique', async () => {
  const t = await table(['Un', 'Deux', 'Trois'], { hostOpts: { graceMs: 500 } });
  const { host, guests, all } = t;
  await host.send({ t: 'settings', first: guests[0].id });
  await host.send({ t: 'start' });
  await handsDelivered(all, host);
  const gone = guests[0];
  // un joueur NON actif hors ligne ne bloque rien : sa main reste jouable par les autres
  const idle = guests[1];
  const idleStore = idle.store;
  close(idle);
  await until(() => !host.room.members[2].online, 'joueur vu hors ligne', 3000);
  assert.equal(host.room.away, null, 'le joueur actif est là : pas de pause');
  const g = host.host.game;
  const t2 = { host, all: [host, gone] };
  await act(t2, { from: 'hand', seat: 2, end: 'low' });
  assert.equal(host.host.game.picks[0].v, g.hands[2][0].v);
  const idleBack = phone('Trois (de retour)', idleStore);
  await connected(idleBack);
  await idleBack.resume();
  await until(() => idleBack.status === 'room' && idleBack.priv?.hand.length === g.hands[2].length - 1, 'il retrouve sa main, moins la carte révélée');
  all[2] = idleBack;

  // le joueur actif disparaît : son tour reste le sien
  const turn = host.host.game.turn;
  const goneStore = gone.store;
  close(gone);
  await until(() => host.room.away && host.room.away.seat === 1 && !host.room.away.due, 'tour en pause', 3000);
  await until(() => idleBack.room.away?.seat === 1, 'pause visible des autres joueurs');
  await until(() => host.room.away.due, 'délai de grâce écoulé', 3000);
  assert.deepEqual([host.host.game.turn, host.host.game.current], [turn, 1], 'aucun passage automatique du tour');
  // seul l'hôte décide
  await idleBack.send({ t: 'abort' });
  await until(() => idleBack.errors.some((e) => /Seul l’hôte/.test(e)), 'refus côté joueur');
  // « attendre encore » relance le délai
  await host.send({ t: 'wait' });
  assert.equal(host.room.away.due, false);
  await until(() => host.room.away?.due, 'nouveau délai écoulé', 3000);
  assert.deepEqual([host.host.game.turn, host.host.game.current], [turn, 1]);
  // le joueur revient : la partie reprend avec lui
  const goneBack = phone('Deux (de retour)', goneStore);
  await connected(goneBack);
  await goneBack.resume();
  await until(() => goneBack.status === 'room' && host.room.away === null, 'reprise', 3000);
  all[1] = goneBack;
  const t3 = { host, all: [host, goneBack, idleBack] };
  await until(() => goneBack.room.game.step === host.host.game.step, 'à jour');
  await act(t3, { from: 'center', slot: 0 });
  // il repart ; cette fois l'hôte interrompt la partie
  close(goneBack);
  await settled(host);
  if (host.host.game.current === 1) {
    await until(() => host.room.away?.due, 'délai écoulé', 4000);
  }
  await host.send({ t: 'abort' });
  await until(() => host.room.status === 'lobby' && idleBack.room.status === 'lobby', 'retour au salon');
  assert.equal(host.room.game, null);
  assert.equal(host.room.away, null);
  for (const p of [host, idleBack]) close(p);
});
