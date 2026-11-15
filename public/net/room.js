// Triplette — une partie à plusieurs téléphones, sans serveur.
//
// Les téléphones communiquent par un relais MQTT public. Le téléphone qui crée la partie est
// l'HÔTE : il exécute le moteur de règles et garde l'état complet (les 36 cartes), sans jamais
// l'afficher. Il publie :
//   • l'état PUBLIC de la table (en clair, message retenu)        → .../state
//   • la main de chaque joueur, chiffrée pour lui seul            → .../p/<joueur>
//   • les erreurs d'un joueur, chiffrées pour lui seul            → .../e/<joueur>
// Chaque joueur envoie ses actions chiffrées à l'hôte              → .../c/<joueur>
// et signale sa présence                                          → .../hb
//
// Un joueur n'envoie jamais la valeur d'une carte : seulement « cet emplacement du centre » ou
// « la plus petite / la plus grande carte de tel joueur ». C'est l'hôte qui trouve la carte,
// vérifie que c'est bien le tour du demandeur et applique les règles.
//
// Si l'hôte ferme l'appli, la partie se met en pause : son téléphone a tout sauvegardé et
// reprend là où il en était à sa réouverture.

import { createGame, revealCenter, revealHand, settle, RuleError } from '../engine/game.js';
import { MIN_PLAYERS, MAX_PLAYERS, MODE } from '../engine/rules.js';
import { publicView, privateView } from '../state/privacy.js';
import { makeKeyPair, sharedKey, seal, open, sameKey, publicJwk, randomId, cryptoRandom } from './crypto.js';

export const NS = 'triplette-v1';
export const PROTOCOL = 1;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEYS = { device: 'tp:device', host: 'tp:host', session: 'tp:session' };

const RULE_MESSAGES = {
  'not-your-turn': 'Ce n’est pas ton tour.',
  'not-playing': 'Le tour se termine : un instant…',
  'game-over': 'La partie est terminée.',
  'bad-slot': 'Carte introuvable au centre.',
  'slot-empty': 'Cette carte a déjà été gagnée.',
  'already-shown': 'Cette carte est déjà retournée.',
  'bad-seat': 'Joueur introuvable.',
  'bad-end': 'On ne révèle que la plus petite ou la plus grande carte d’une main.',
  'empty-hand': 'Ce joueur n’a plus de carte en main.',
  'bad-players': `Il faut entre ${MIN_PLAYERS} et ${MAX_PLAYERS} joueurs.`,
};

export class NetError extends Error {
  constructor(message, { fatal = false } = {}) { super(message); this.name = 'NetError'; this.fatal = fatal; }
}

const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
const clampSeats = (n) => Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, n));
const sameName = (a, b) => a.toLocaleLowerCase('fr') === b.toLocaleLowerCase('fr');
const validKey = (k) => !!k && k.kty === 'EC' && k.crv === 'P-256' && typeof k.x === 'string' && typeof k.y === 'string';
const validMode = (m) => Object.values(MODE).includes(m);
export const cleanCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

export function defaultSettings(mode = MODE.NORMAL) {
  return { mode: validMode(mode) ? mode : MODE.NORMAL, max: MAX_PLAYERS, first: 'random' };
}

/**
 * @param {object} o
 * @param {(url: string, opts: object) => any} o.connect  client MQTT (mqtt.connect du navigateur ou de Node)
 * @param {string} o.broker  adresse du relais
 * @param {{get(k:string):any, set(k:string,v:any):void, del(k:string):void}} o.storage  stockage local
 * @param {() => void} [o.onUpdate]  appelé à chaque changement visible
 * @param {(msg: string) => void} [o.onError]  message d'erreur à montrer au joueur
 * @param {number} [o.missMs]  durée pendant laquelle un tour raté reste visible avant que les cartes soient rendues
 * @param {number} [o.trioMs]  idem après un trio
 * @param {number} [o.graceMs]  attente d'un joueur actif hors ligne avant de demander à l'hôte quoi faire
 */
export class Net {
  constructor({
    connect, broker, storage, onUpdate = () => {}, onError = () => {}, now = () => Date.now(), rng = cryptoRandom,
    hbMs = 4000, offlineMs = 13000, joinWaitMs = 7000, joinRetryMs = 4000, missMs = 2600, trioMs = 3600, graceMs = 60000,
  }) {
    Object.assign(this, { storage, onUpdate, onError, now, rng, hbMs, offlineMs, joinWaitMs, joinRetryMs, missMs, trioMs, graceMs });
    this.status = 'idle'; // idle | joining | room
    this.code = null;
    this.isHost = false;
    this.connected = false;
    this.room = null; // dernier état public
    this.priv = null; // ma main (déchiffrée)
    this.host = null; // { code, members, settings, status, game, gameId, ver, lastN, wins, settleAt, away } — sur le téléphone de l'hôte seulement
    this.seen = new Map(); // id → dernier signe de vie
    this.memberKeys = new Map(); // id → Promise<CryptoKey> (hôte)
    this.lastPriv = new Map(); // id → dernier état privé publié (hôte)
    this.shared = null; // clé commune avec l'hôte (joueur)
    this.hostKey = null;
    this.pending = null; // { kind: 'join'|'resume', name, since, sentAt, tries }
    this.stashedPriv = null;
    this.settleTimer = null;
    this.n = 0;
    this.chain = Promise.resolve();
    this.ready = this.loadIdentity();
    this.ready.catch(() => {}); // l'erreur éventuelle est signalée au moment de créer ou de rejoindre une partie

    this.client = connect(broker, { clientId: `tp_${randomId(5)}`, keepalive: 30, reconnectPeriod: 2000, connectTimeout: 10000, clean: true });
    this.client.on('connect', () => {
      this.connected = true;
      if (this.code) this.enqueue(() => this.subscribe());
      this.onUpdate();
    });
    const down = () => { if (this.connected) { this.connected = false; this.onUpdate(); } };
    this.client.on('close', down);
    this.client.on('offline', down);
    this.client.on('error', () => {});
    this.client.on('message', (topic, payload) => this.route(topic, payload.toString()));
    this.timer = setInterval(() => this.tick(), Math.max(100, Math.min(1000, Math.floor(hbMs / 2))));
  }

  // ─────────────────────────────────────────── identité de l'appareil

  async loadIdentity() {
    // le chiffrement des mains repose sur Web Crypto, que les navigateurs réservent aux adresses sûres (https, localhost)
    if (!globalThis.crypto?.subtle) throw new NetError('Cette adresse n’est pas sécurisée : ouvre le jeu en https pour jouer.', { fatal: true });
    let dev = this.storage.get(KEYS.device);
    if (!dev || !dev.id || !dev.priv || !validKey(dev.pub)) {
      const keys = await makeKeyPair();
      dev = { id: randomId(6), ...keys };
      this.storage.set(KEYS.device, dev);
    }
    this.id = dev.id;
    this.keys = dev;
  }

  // ─────────────────────────────────────────── outils

  enqueue(fn) {
    const run = this.chain.then(fn);
    this.chain = run.catch((e) => { if (!(e instanceof NetError) && !(e instanceof RuleError)) console.error(e); });
    return run;
  }
  topic(kind, who) { return `${NS}/${this.code}/${kind}${who ? `/${who}` : ''}`; }
  pub(kind, who, payload, opts = {}) {
    if (!this.code) return;
    this.client.publish(this.topic(kind, who), typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 1, ...opts });
  }
  online(id) { return id === this.id || this.now() - (this.seen.get(id) || 0) < this.offlineMs; }
  get hostOnline() {
    if (this.isHost) return true;
    return !!this.room && this.online(this.room.hostId);
  }
  /** Ma place à la table (index dans l'ordre du tour), ou -1. */
  get seat() {
    if (!this.room) return -1;
    return this.room.members.findIndex((m) => m.id === this.id);
  }

  subscribe() {
    const base = `${NS}/${this.code}`;
    const topics = this.isHost ? [`${base}/c/+`, `${base}/hb`] : [`${base}/state`, `${base}/hb`, `${base}/p/${this.id}`, `${base}/e/${this.id}`];
    this.client.subscribe(topics, { qos: 1 });
    this.subscribedAt = this.now();
    this.heartbeat();
    if (this.isHost && this.host) return this.commit({ bump: true });
    return undefined;
  }
  heartbeat() { if (this.code && this.connected) this.pub('hb', null, { id: this.id }, { qos: 0 }); }

  /** Quitte la salle localement (sans prévenir personne). */
  reset(message) {
    if (this.code && this.connected) {
      const base = `${NS}/${this.code}`;
      this.client.unsubscribe([`${base}/c/+`, `${base}/hb`, `${base}/state`, `${base}/p/${this.id}`, `${base}/e/${this.id}`]);
    }
    clearTimeout(this.settleTimer);
    this.storage.del(KEYS.session);
    if (this.isHost) this.storage.del(KEYS.host);
    Object.assign(this, { status: 'idle', code: null, isHost: false, room: null, priv: null, host: null, shared: null, hostKey: null, pending: null, stashedPriv: null });
    this.seen.clear(); this.memberKeys.clear(); this.lastPriv.clear();
    this.onUpdate();
    if (message) this.onError(message);
  }

  // ─────────────────────────────────────────── API utilisée par l'interface

  /** Reprend la partie en cours sur cet appareil (hôte ou joueur), s'il y en a une. */
  async resume() {
    await this.ready;
    const snap = this.storage.get(KEYS.host);
    if (snap && snap.code && Array.isArray(snap.members)) {
      this.isHost = true;
      this.host = snap;
      this.code = snap.code;
      this.status = 'room';
      // au retour de l'hôte, chacun est présumé là le temps que ses signes de vie arrivent
      for (const m of snap.members) this.seen.set(m.id, this.now());
      if (this.connected) await this.enqueue(() => this.subscribe());
      else this.publishState();
      this.armSettle(); // un tour en cours de résolution se termine tout seul
      this.onUpdate();
      return true;
    }
    const session = this.storage.get(KEYS.session);
    if (session && session.code) {
      this.hostKey = validKey(session.hostKey) ? session.hostKey : null;
      this.startJoin(session.code, { kind: 'resume', name: session.name || '' });
      return true;
    }
    return false;
  }

  async create(name, { mode } = {}) {
    await this.ready;
    name = cleanName(name);
    if (!name) throw new NetError('Indique ton prénom.');
    if (this.status !== 'idle') this.reset();
    const code = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(5)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    this.isHost = true;
    this.code = code;
    this.status = 'room';
    this.host = {
      code, members: [{ id: this.id, name, key: this.keys.pub }], settings: defaultSettings(mode),
      status: 'lobby', game: null, gameId: null, ver: 0, lastN: {}, wins: {}, settleAt: null, away: null,
    };
    if (this.connected) await this.enqueue(() => this.subscribe());
    else this.commit({ bump: true });
    return code;
  }

  async join(code, name) {
    await this.ready;
    code = cleanCode(code);
    name = cleanName(name);
    if (code.length !== 5) throw new NetError('Le code de la partie a 5 caractères.');
    if (!name) throw new NetError('Indique ton prénom.');
    if (this.status !== 'idle') this.reset();
    this.hostKey = null;
    this.startJoin(code, { kind: 'join', name });
  }

  startJoin(code, { kind, name }) {
    this.code = code;
    this.isHost = false;
    this.status = 'joining';
    this.pending = { kind, name, since: this.now(), sentAt: 0, tries: 0 };
    if (this.connected) this.enqueue(() => this.subscribe());
    this.onUpdate();
  }

  /** Envoie une action. Chez l'hôte elle est appliquée directement. Résout true si elle est partie. */
  send(cmd) {
    return this.enqueue(async () => {
      if (this.status !== 'room') throw new NetError('Tu n’es dans aucune partie.');
      if (this.isHost) {
        try { await this.apply(this.id, cmd); } catch (e) { this.onError(this.explain(e)); throw e; }
        return true;
      }
      if (!this.connected) { this.onError('Connexion au relais en cours…'); throw new NetError('offline'); }
      if (!this.shared) throw new NetError('Clé de la partie absente.');
      this.n = Math.max(this.n + 1, this.now() * 1000);
      this.pub('c', this.id, { box: await seal(this.shared, `cmd:${this.id}`, { ...cmd, n: this.n }) });
      return true;
    }).catch(() => false);
  }

  /**
   * Révèle une carte : `{ from: 'center', slot }` ou `{ from: 'hand', seat, end: 'low' | 'high' }`.
   * L'action porte le numéro d'étape vu par ce téléphone : si elle arrive deux fois (double
   * appui) ou trop tard, l'hôte l'ignore au lieu de retourner une carte de plus.
   */
  reveal(move) {
    const step = this.room?.game?.step;
    if (!Number.isInteger(step)) return Promise.resolve(false);
    return this.send({ t: 'reveal', ...move, at: step });
  }

  /** Quitter : l'hôte ferme la partie pour tout le monde ; un joueur quitte le salon. */
  leave() {
    return this.enqueue(async () => {
      if (this.isHost && this.host) {
        if (this.connected) {
          this.pub('state', null, '', { retain: true });
          for (const m of this.host.members) if (m.id !== this.id) this.pub('p', m.id, '', { retain: true });
        }
        return this.reset();
      }
      if (this.status === 'room' && this.room?.status === 'lobby' && this.shared && this.connected) {
        this.n = Math.max(this.n + 1, this.now() * 1000);
        this.pub('c', this.id, { box: await seal(this.shared, `cmd:${this.id}`, { t: 'leave', n: this.n }) });
      }
      return this.reset();
    });
  }

  explain(e) {
    if (e instanceof RuleError) return RULE_MESSAGES[e.code] || 'Action impossible.';
    if (e instanceof NetError) return e.message;
    return 'Erreur inattendue.';
  }

  // ─────────────────────────────────────────── réception

  route(topic, raw) {
    const [ns, code, kind, who] = topic.split('/');
    if (ns !== NS || code !== this.code) return;
    if (kind === 'hb') {
      let msg = null;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg && typeof msg.id === 'string') {
        const was = this.online(msg.id);
        this.seen.set(msg.id, this.now());
        if (!was && !this.isHost) this.onUpdate();
      }
      return;
    }
    if (this.isHost) {
      if (kind === 'c' && who) this.enqueue(() => this.onCommand(who, raw));
      return;
    }
    if (kind === 'state') this.enqueue(() => this.onState(raw));
    else if (kind === 'p' && who === this.id) this.enqueue(() => this.onPrivate(raw));
    else if (kind === 'e' && who === this.id) this.enqueue(() => this.onErrorMsg(raw));
  }

  // ── côté joueur

  async onState(raw) {
    if (!raw) {
      if (this.status === 'room') this.reset('L’hôte a fermé la partie.');
      return;
    }
    let room;
    try { room = JSON.parse(raw); } catch { return; }
    if (!room || room.v !== PROTOCOL || room.code !== this.code || !validKey(room.hostKey) || !Array.isArray(room.members)) return;
    if (this.hostKey && !sameKey(this.hostKey, room.hostKey)) return; // ce n'est pas notre hôte : ignoré
    if (this.room && room.ver <= this.room.ver) return; // message en retard
    if (!this.shared) {
      this.hostKey = publicJwk(room.hostKey);
      this.shared = await sharedKey(this.keys.priv, this.hostKey);
    }
    this.room = room;
    if (!this.seen.has(room.hostId)) this.seen.set(room.hostId, this.now());
    const member = room.members.some((m) => m.id === this.id);

    if (this.status === 'joining') {
      const p = this.pending;
      if (member) {
        this.status = 'room';
        this.pending = null;
        const me = room.members.find((m) => m.id === this.id);
        this.storage.set(KEYS.session, { code: this.code, hostKey: this.hostKey, name: me.name });
      } else if (p.kind === 'resume') {
        return this.reset('Tu ne fais plus partie de cette partie.');
      } else if (room.status !== 'lobby') {
        return this.reset('Cette partie a déjà commencé.');
      } else if (!p.sentAt) {
        this.sendJoin();
        return this.onUpdate();
      } else {
        return this.onUpdate();
      }
    } else if (!member) {
      return this.reset('L’hôte t’a retiré de la partie.');
    }
    if (this.stashedPriv) { const s = this.stashedPriv; this.stashedPriv = null; await this.onPrivate(s, { silent: true }); }
    if (this.priv && this.priv.gameId !== room.gameId) this.priv = null;
    this.onUpdate();
  }

  sendJoin() {
    const p = this.pending;
    p.sentAt = this.now();
    p.tries += 1;
    this.pub('c', this.id, { t: 'join', name: p.name, key: this.keys.pub });
  }

  async onPrivate(raw, { silent = false } = {}) {
    if (!raw) { this.priv = null; if (!silent) this.onUpdate(); return; }
    if (!this.shared) { this.stashedPriv = raw; return; }
    let box;
    try { box = JSON.parse(raw); } catch { return; }
    const data = await open(this.shared, `priv:${this.id}`, box);
    if (!data) return;
    if (this.priv && this.priv.gameId === data.gameId && data.ver < this.priv.ver) return;
    this.priv = data.gameId ? data : null;
    if (!silent) this.onUpdate();
  }

  async onErrorMsg(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg?.box && this.shared) msg = await open(this.shared, `err:${this.id}`, msg.box);
    if (!msg || typeof msg.msg !== 'string') return;
    if (msg.fatal && this.status === 'joining') return this.reset(msg.msg);
    this.onError(msg.msg);
  }

  // ── côté hôte

  keyFor(member) {
    if (!this.memberKeys.has(member.id)) this.memberKeys.set(member.id, sharedKey(this.keys.priv, member.key));
    return this.memberKeys.get(member.id);
  }

  async onCommand(from, raw) {
    if (!this.host) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg) return;
    this.seen.set(from, this.now());
    if (msg.t === 'join') return this.onJoin(from, msg);
    const member = this.host.members.find((m) => m.id === from);
    if (!member || !msg.box) return;
    const key = await this.keyFor(member);
    const cmd = await open(key, `cmd:${from}`, msg.box);
    if (!cmd || typeof cmd.n !== 'number') return;
    if (cmd.n <= (this.host.lastN[from] || 0)) return; // message rejoué ou en double
    this.host.lastN[from] = cmd.n;
    try {
      await this.apply(from, cmd);
    } catch (e) {
      const text = this.explain(e);
      this.pub('e', from, { box: await seal(key, `err:${from}`, { msg: text }) }, { qos: 0 });
    }
  }

  async onJoin(from, msg) {
    const h = this.host;
    const refuse = (text) => this.pub('e', from, { msg: text, fatal: true }, { qos: 0 });
    if (!validKey(msg.key)) return;
    const existing = h.members.find((m) => m.id === from);
    if (existing) {
      if (!sameKey(existing.key, msg.key)) return refuse('Cet appareil ne peut pas rejoindre cette partie.');
      this.lastPriv.delete(from); // simple reconnexion : on lui renvoie sa main
      return this.commit({ bump: true });
    }
    const name = cleanName(msg.name);
    if (h.status !== 'lobby') return refuse(h.game?.phase === 'over' ? 'Cette partie est terminée.' : 'Cette partie a déjà commencé.');
    if (h.members.length >= h.settings.max) return refuse(`La table est complète (${h.settings.max} joueurs).`);
    if (!name) return refuse('Indique ton prénom.');
    if (h.members.some((m) => sameName(m.name, name))) return refuse(`Le prénom « ${name} » est déjà pris à cette table.`);
    h.members.push({ id: from, name, key: publicJwk(msg.key) });
    this.normalizeSettings();
    return this.commit();
  }

  normalizeSettings() {
    const h = this.host;
    h.settings.max = clampSeats(Math.max(h.settings.max, h.members.length));
    if (h.settings.first !== 'random' && !h.members.some((m) => m.id === h.settings.first)) h.settings.first = 'random';
  }

  async apply(from, cmd) {
    const h = this.host;
    if (!h) throw new NetError('Aucune partie.');
    const isHost = from === this.id;
    const hostOnly = () => { if (!isHost) throw new NetError('Seul l’hôte peut faire ça.'); };
    const lobbyOnly = () => { if (h.status !== 'lobby') throw new NetError('La partie a déjà commencé.'); };
    const g = h.game;
    const needGame = (phase) => { if (!g || h.status !== 'game' || (phase && g.phase !== phase)) throw new NetError('Action impossible maintenant.'); };
    const seat = h.members.findIndex((m) => m.id === from);
    if (seat < 0) throw new NetError('Tu ne fais pas partie de cette table.');

    switch (cmd?.t) {
      // ── salon (hôte)
      case 'settings': {
        hostOnly(); lobbyOnly();
        const s = { ...h.settings };
        if (validMode(cmd.mode)) s.mode = cmd.mode;
        if (Number.isInteger(cmd.max)) s.max = clampSeats(Math.max(cmd.max, h.members.length));
        if (cmd.first === 'random' || h.members.some((m) => m.id === cmd.first)) s.first = cmd.first;
        h.settings = s;
        this.normalizeSettings();
        return this.commit({ privates: false });
      }
      case 'move': {
        hostOnly(); lobbyOnly();
        const i = h.members.findIndex((m) => m.id === cmd.id);
        const j = i + (cmd.delta > 0 ? 1 : -1);
        if (i < 0 || j < 0 || j >= h.members.length) return undefined;
        [h.members[i], h.members[j]] = [h.members[j], h.members[i]];
        return this.commit({ privates: false });
      }
      case 'kick': {
        hostOnly(); lobbyOnly();
        if (cmd.id === this.id) throw new NetError('L’hôte ne peut pas se retirer.');
        h.members = h.members.filter((m) => m.id !== cmd.id);
        this.forget(cmd.id);
        this.normalizeSettings();
        return this.commit();
      }
      case 'leave': {
        if (isHost || h.status !== 'lobby') return undefined;
        h.members = h.members.filter((m) => m.id !== from);
        this.forget(from);
        this.normalizeSettings();
        return this.commit();
      }
      case 'start': {
        hostOnly(); lobbyOnly();
        return this.startGame();
      }

      // ── partie
      case 'reveal': {
        needGame();
        // contrôles dans cet ordre : est-ce son tour ? l'action est-elle encore d'actualité ? puis les règles
        if (g.phase !== 'over' && seat !== g.current) throw new NetError(`C’est à ${g.players[g.current].name} de jouer.`);
        if (!Number.isInteger(cmd.at)) throw new NetError('Action illisible.');
        if (cmd.at !== g.step) return undefined; // double appui ou action en retard : une seule action par étape
        if (cmd.from === 'center') h.game = revealCenter(g, seat, cmd.slot);
        else if (cmd.from === 'hand') h.game = revealHand(g, seat, cmd.seat, cmd.end);
        else throw new NetError('Action inconnue.');
        h.settleAt = null;
        h.away = null;
        if (h.game.phase === 'over') {
          const winner = h.members[h.game.winner].id;
          h.wins[winner] = (h.wins[winner] || 0) + 1;
        }
        this.armSettle();
        return this.commit();
      }
      case 'wait': {
        // l'hôte choisit d'attendre encore le joueur actif hors ligne
        hostOnly(); needGame('play');
        if (!h.away) return undefined;
        h.away = { ...h.away, until: this.now() + this.graceMs, due: false };
        return this.commit({ privates: false });
      }
      case 'abort': {
        // l'hôte interrompt la partie en cours : retour au salon
        hostOnly(); needGame();
        return this.backToLobby();
      }
      case 'replay':
        hostOnly(); needGame('over');
        return this.startGame({ rotate: true });
      case 'lobby':
        hostOnly(); needGame('over');
        return this.backToLobby();
      default:
        throw new NetError('Action inconnue.');
    }
  }

  startGame({ rotate = false } = {}) {
    const h = this.host;
    const n = h.members.length;
    if (n < MIN_PLAYERS) throw new NetError(`Il faut au moins ${MIN_PLAYERS} joueurs.`);
    if (n > MAX_PLAYERS) throw new NetError(`${MAX_PLAYERS} joueurs au maximum.`);
    // « Rejouer » : le joueur suivant commence. Sinon, le choix de l'hôte ou le tirage au sort.
    let first = -1;
    if (rotate && h.game) first = (h.game.first + 1) % n;
    else if (h.settings.first !== 'random') first = h.members.findIndex((m) => m.id === h.settings.first);
    if (first < 0) first = Math.floor(this.rng() * n);
    clearTimeout(this.settleTimer);
    h.game = createGame({ names: h.members.map((m) => m.name), mode: h.settings.mode, firstPlayer: first }, this.rng);
    h.gameId = randomId(4);
    h.status = 'game';
    h.settleAt = null;
    h.away = null;
    return this.commit();
  }

  backToLobby() {
    clearTimeout(this.settleTimer);
    Object.assign(this.host, { status: 'lobby', game: null, gameId: null, settleAt: null, away: null });
    return this.commit();
  }

  /** Efface ce qui concerne un joueur retiré du salon. */
  forget(id) {
    this.memberKeys.delete(id);
    this.lastPriv.delete(id);
    delete this.host.lastN[id];
    delete this.host.wins[id];
    this.pub('p', id, '', { retain: true });
  }

  // ── fin de tour automatique

  /**
   * Quand un tour vient de se terminer (deux cartes différentes, ou un trio), les cartes restent
   * visibles un instant sur tous les téléphones, puis l'hôte clôt le tour tout seul : personne
   * n'a rien à toucher pour que la partie continue.
   */
  armSettle() {
    clearTimeout(this.settleTimer);
    const h = this.host;
    if (!h?.game || h.status !== 'game' || h.game.phase !== 'resolve') return;
    if (!h.settleAt) h.settleAt = this.now() + (h.game.outcome === 'trio' ? this.trioMs : this.missMs);
    this.settleTimer = setTimeout(() => this.enqueue(() => this.settleDue()), Math.max(0, h.settleAt - this.now()));
  }

  settleDue() {
    const h = this.host;
    if (!h?.game || h.status !== 'game' || h.game.phase !== 'resolve') return undefined;
    if (h.settleAt && this.now() < h.settleAt) return this.armSettle();
    clearTimeout(this.settleTimer);
    h.game = settle(h.game);
    h.settleAt = null;
    h.away = null;
    return this.commit();
  }

  // ── joueur actif hors ligne

  /**
   * Le tour d'un joueur hors ligne est en pause. Passé le délai de grâce, c'est à l'hôte de
   * choisir : attendre encore, ou interrompre la partie. On ne passe jamais son tour d'office.
   */
  awayNow() {
    const h = this.host;
    const g = h.game;
    if (h.status !== 'game' || !g || g.phase !== 'play') return null;
    const m = h.members[g.current];
    if (!m || m.id === this.id || this.online(m.id)) return null;
    const same = h.away && h.away.seat === g.current && h.away.turn === g.turn;
    const until = same ? h.away.until : this.now() + this.graceMs;
    return { seat: g.current, turn: g.turn, until, due: this.now() >= until };
  }

  // ── publication

  /** Enregistre l'état de l'hôte puis publie l'état public et les mains privées. */
  async commit({ bump = true, privates = true } = {}) {
    const h = this.host;
    if (!h) return;
    if (bump) h.ver += 1;
    h.away = this.awayNow();
    this.storage.set(KEYS.host, h);
    this.publishState();
    if (privates) await this.publishPrivates();
    this.onUpdate();
  }

  publishState() {
    const h = this.host;
    const g = h.game;
    const members = h.members.map((m) => ({ id: m.id, name: m.name, online: this.online(m.id), wins: h.wins[m.id] || 0 }));
    this.lastFlags = this.flags();
    const room = {
      v: PROTOCOL, code: h.code, hostId: this.id, hostKey: this.keys.pub, ver: h.ver, status: h.status,
      members, settings: h.settings, gameId: h.gameId,
      game: g ? publicView(g) : null,
      away: h.away ? { seat: h.away.seat, due: h.away.due } : null,
    };
    this.room = room;
    if (this.connected) this.pub('state', null, room, { retain: true });
    // la main de l'hôte, calculée sur place (elle ne transite pas)
    const seat = h.members.findIndex((m) => m.id === this.id);
    this.priv = g ? { ver: h.ver, gameId: h.gameId, ...privateView(g, seat) } : null;
  }

  async publishPrivates() {
    const h = this.host;
    if (!this.connected) return;
    for (const [seat, m] of h.members.entries()) {
      if (m.id === this.id) continue;
      if (!h.game) {
        if (this.lastPriv.get(m.id) !== '') { this.pub('p', m.id, '', { retain: true }); this.lastPriv.set(m.id, ''); }
        continue;
      }
      const data = { gameId: h.gameId, ...privateView(h.game, seat) };
      const json = JSON.stringify(data);
      if (this.lastPriv.get(m.id) === json) continue;
      this.lastPriv.set(m.id, json);
      const box = await seal(await this.keyFor(m), `priv:${m.id}`, { ...data, ver: h.ver });
      this.pub('p', m.id, box, { retain: true });
    }
  }

  /** Ce qui, vu de l'hôte, mérite une nouvelle publication sans qu'aucune action ait eu lieu. */
  flags() {
    const h = this.host;
    const away = this.awayNow();
    return `${h.members.map((m) => this.online(m.id)).join()}|${away ? `${away.seat}:${away.turn}:${away.due}` : ''}`;
  }

  // ─────────────────────────────────────────── horloge : présence, délais

  tick() {
    if (!this.code) return;
    const now = this.now();
    if (this.isHost && this.host) {
      const h = this.host;
      // filet de sécurité si la minuterie de fin de tour n'a pas pu se déclencher (appli en arrière-plan)
      if (h.game?.phase === 'resolve' && h.status === 'game' && (!h.settleAt || now >= h.settleAt)) this.enqueue(() => this.settleDue());
    }
    if (!this.connected) return;
    if (!this.lastHb || now - this.lastHb >= this.hbMs) { this.lastHb = now; this.heartbeat(); }
    if (this.isHost && this.host) {
      if (this.flags() !== this.lastFlags) this.enqueue(() => (this.host ? this.commit({ privates: false }) : undefined));
      return;
    }
    if (this.status === 'joining' && this.pending) {
      const p = this.pending;
      if (!this.room && now - Math.max(p.since, this.subscribedAt || 0) > this.joinWaitMs) {
        return this.reset(p.kind === 'resume' ? 'La partie est introuvable : l’hôte l’a peut-être fermée.' : 'Partie introuvable : vérifie le code.');
      }
      if (p.sentAt && now - p.sentAt > this.joinRetryMs) {
        if (p.tries >= 3) return this.reset('L’hôte ne répond pas. Réessaie dans un instant.');
        this.sendJoin();
      }
      return;
    }
    // côté joueur : met à jour l'affichage quand l'hôte disparaît ou revient
    const hostOn = this.hostOnline;
    if (hostOn !== this.lastHostOnline) { this.lastHostOnline = hostOn; this.onUpdate(); }
  }

  /** Arrête tout (tests). */
  close() {
    clearInterval(this.timer);
    clearTimeout(this.settleTimer);
    this.client.end(true);
  }
}
