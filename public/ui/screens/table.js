// La table : les adversaires, les cartes révélées pendant le tour, le centre et ma main.
// Tous les téléphones affichent la même table ; seul le joueur actif peut retourner une carte.
//
// L'écran est découpé en zones redessinées séparément, uniquement quand ce qu'elles montrent a
// changé : une animation en cours n'est donc pas interrompue par une mise à jour qui ne la
// concerne pas (présence d'un joueur, arrivée de ma main chiffrée…).

import { h, dur, reduced, plural } from '../dom.js';
import { ICON } from '../art.js';
import { card, trioRow, modeChip, openSheet, linksTable, toast, tint, confirmSheet } from '../components.js';
import { MODE_GOAL } from '../texts.js';
import { MODE } from '../../engine/rules.js';

let mounted = null; // { root, gameId, zones: { nom: { sig, el, memo } } }
const ZONES = ['hud', 'rivals', 'stage', 'center', 'mine'];

/** Peut-on retourner une carte depuis ce téléphone ? */
export function canPlay(net) {
  const g = net.room?.game;
  return !!g && g.phase === 'play' && net.seat === g.current;
}

export function tableScreen(ctx) {
  const { net, ui } = ctx;
  const room = net.room;
  const view = room.game;
  const me = net.seat;
  const { n, picks } = view;
  const spicy = view.mode === MODE.SPICY;
  const priv = net.priv && net.priv.gameId === room.gameId ? net.priv : null;
  const myTurn = canPlay(net);
  const cur = view.players[view.current];
  const hostName = room.members.find((m) => m.id === room.hostId)?.name || 'L’hôte';
  const mineNow = view.current === me;
  // les cartes sorties d'une main pendant ce tour (un trio gagné, lui, a déjà quitté la table)
  const outOf = (seat, end) => (view.outcome === 'trio' ? [] : picks.filter((p) => p.from === 'hand' && p.seat === seat && p.end === end).map((p) => p.v));

  function reveal(move, el) {
    // une zone peut rester affichée plusieurs étapes : on lit toujours l'état du moment, pas celui du dessin
    const now = net.room?.game;
    if (!now) return;
    if (!canPlay(net)) {
      ctx.sound.error();
      toast(now.phase === 'play' ? `C’est à ${now.players[now.current].name} de jouer.` : now.phase === 'over' ? 'La partie est terminée.' : 'Le tour se termine : un instant…');
      return;
    }
    // un seul envoi par étape : l'hôte écarterait de toute façon le second
    const lock = ui.lock;
    if (lock && lock.gameId === net.room.gameId && lock.step === now.step && Date.now() - lock.at < 1500) return;
    ui.lock = { gameId: net.room.gameId, step: now.step, at: Date.now() };
    ctx.sound.tap();
    if (el) {
      // l'élément disparaît dès que la carte est retournée ; si l'action n'aboutit pas, il ne doit pas rester en attente
      el.classList.add('pending');
      setTimeout(() => el.classList.remove('pending'), 1600);
    }
    net.reveal(move).then((ok) => { if (!ok) { ui.lock = null; if (el) el.classList.remove('pending'); } });
  }

  // ───────────────────────────────────────── bandeau

  const hud = {
    sig: `${view.mode}|${view.turn}`,
    build: () => ({
      el: h('header', { class: 'hud' },
        h('div', { class: 'hud-mode', title: 'Pour gagner la partie' }, modeChip(view.mode), h('small', { id: 'hudGoal' }, MODE_GOAL[view.mode])),
        h('div', { class: 'hud-turn', id: 'hudTurn' }, h('small', null, 'Tour'), h('b', null, String(view.turn))),
        spicy ? h('button', { class: 'icon-btn', id: 'btnLinks', 'aria-label': 'Trios liés', html: ICON.link, onClick: () => openLinks() }) : null,
        h('button', { class: 'icon-btn', id: 'btnMenu', 'aria-label': 'Menu', html: ICON.menu, onClick: () => ctx.openMenu() })),
    }),
  };

  // ───────────────────────────────────────── adversaires (dans l'ordre du tour, après moi)

  const order = Array.from({ length: n }, (_, k) => (Math.max(me, 0) + 1 + k) % n).filter((i) => i !== me);
  const rivalData = order.map((i) => [view.players[i].name, view.players[i].cards, view.players[i].trios, room.members[i].online, outOf(i, 'low'), outOf(i, 'high')]);
  const rivals = {
    sig: JSON.stringify([rivalData, view.current, view.phase, myTurn, view.turn]),
    build: (memo) => {
      const fresh = memo && memo.turn === view.turn;
      const lastPick = picks.at(-1);
      const tiles = order.map((i) => {
        const p = view.players[i];
        const m = room.members[i];
        const low = outOf(i, 'low');
        const high = outOf(i, 'high');
        const active = i === view.current && view.phase !== 'over';
        const newOut = fresh && low.length + high.length > (memo.out[i] || 0) && lastPick?.from === 'hand' && lastPick.seat === i ? lastPick.end : null;
        const back = memo && p.cards > (memo.cards[i] ?? p.cards);
        const chip = (v, isNew) => h('i', { class: `mini up ${isNew ? 'just' : ''}`.trim(), style: tint(v) }, String(v));
        const endBtn = (end, label, ic) => h('button', {
          class: `end ${end}`, 'data-end': end, disabled: !p.cards,
          'aria-label': `Révéler la plus ${end === 'low' ? 'petite' : 'grande'} carte de ${p.name}`,
          onClick: (e) => reveal({ from: 'hand', seat: i, end }, e.currentTarget),
        }, end === 'low' ? [h('span', { class: 'end-ic', html: ic }), label] : [label, h('span', { class: 'end-ic', html: ic })]);
        const cls = ['rival', active ? 'active' : '', m.online ? '' : 'off', p.cards ? '' : 'empty', myTurn && p.cards ? 'pickable' : ''].filter(Boolean).join(' ');
        return h('div', { class: cls, 'data-seat': String(i) },
          h('div', { class: 'rv-head' },
            h('span', { class: 'nm' }, p.name),
            active ? h('span', { class: 'tag-turn' }, 'joue') : null,
            m.online ? null : h('span', { class: 'offdot', title: 'Hors ligne' }),
            p.trios.length ? trioRow(p.trios) : null),
          h('div', { class: 'rv-hand', 'aria-label': `${plural(p.cards, 'carte cachée', 'cartes cachées')}${m.online ? '' : ', hors ligne'}` },
            low.map((v, k) => chip(v, newOut === 'low' && k === low.length - 1)),
            Array.from({ length: p.cards }, () => h('i', { class: `mini ${back ? 'returned' : ''}`.trim() })),
            high.slice().reverse().map((v, k) => chip(v, newOut === 'high' && k === 0)),
            p.cards || low.length || high.length ? h('span', { class: 'rv-count', title: plural(p.cards, 'carte cachée', 'cartes cachées') }, String(p.cards)) : h('span', { class: 'rv-none' }, 'plus de carte')),
          h('div', { class: 'rv-ends' }, endBtn('low', 'Petite', ICON.low), endBtn('high', 'Grande', ICON.high)));
      });
      return {
        el: h('div', { class: `rivals r${order.length}`, id: 'rivals' }, tiles),
        memo: { turn: view.turn, out: Object.fromEntries(order.map((i) => [i, outOf(i, 'low').length + outOf(i, 'high').length])), cards: Object.fromEntries(order.map((i) => [i, view.players[i].cards])) },
      };
    },
  };

  // ───────────────────────────────────────── cartes révélées pendant le tour

  const away = room.away && view.phase === 'play' ? room.away : null;
  const stage = {
    sig: JSON.stringify([picks, view.outcome, view.phase, view.current, me, away, net.isHost, view.turn, cur.name, spicy]),
    build: (memo) => {
      const v = picks[0]?.v;
      let title; let hint; let tone = mineNow ? 'yours' : '';
      if (view.outcome === 'trio') {
        title = `Trio de ${v} !`;
        hint = view.phase === 'over' ? (mineNow ? 'Et c’est gagné !' : `${cur.name} remporte la partie.`) : mineNow ? 'Il rejoint ta collection.' : `${cur.name} gagne le trio.`;
        tone = 'trio';
      } else if (view.outcome === 'miss') {
        title = 'Raté !';
        hint = 'Les cartes retournent à leur place.';
        tone = 'miss';
      } else if (away) {
        title = `${cur.name} est hors ligne`;
        hint = net.isHost
          ? (away.due ? 'Son tour est en pause. Que fait-on ?' : 'Son tour est en pause : on l’attend.')
          : `Son tour est en pause. ${hostName} peut attendre ou interrompre la partie.`;
        tone = 'away';
      } else if (mineNow) {
        if (!picks.length) { title = 'À toi de jouer'; hint = 'Retourne une carte du centre, ou la plus petite / la plus grande carte d’une main.'; }
        else if (picks.length === 1) { title = `Un ${v} !`; hint = 'Trouve les deux autres.'; }
        else { title = `Deux ${v} !`; hint = 'Plus qu’un pour le trio.'; }
      } else {
        title = `${cur.name} joue`;
        hint = !picks.length ? 'Retiens bien ce qui est révélé.' : picks.length === 1 ? `Un ${v} révélé…` : `Deux ${v} : plus qu’un !`;
      }
      const isNew = memo && memo.turn === view.turn && picks.length > memo.len;
      const from = (p) => {
        if (p.from === 'center') return [h('b', null, 'Centre')];
        const who = p.seat === me ? 'Toi' : view.players[p.seat].name;
        return [h('b', null, who), p.end === 'low' ? 'plus petite' : 'plus grande'];
      };
      const slots = [0, 1, 2].map((k) => {
        const p = picks[k];
        if (!p) return h('div', { class: 'tslot empty' }, h('div', { class: 'tslot-ph' }), h('small', null, ' '));
        const cls = ['tslot', k > 0 && p.v === picks[0].v ? 'match' : '', view.outcome === 'miss' && k === picks.length - 1 ? 'miss' : '', view.outcome === 'trio' ? 'won' : ''].filter(Boolean).join(' ');
        return h('div', { class: cls, 'data-k': String(k), 'data-v': String(p.v) },
          card({ v: p.v, spicy, variant: k, just: isNew && k === picks.length - 1 }),
          h('small', { class: 'tslot-from' }, from(p)));
      });
      const hostChoice = away && net.isHost && away.due ? h('div', { class: 'away-actions', id: 'awayActions' },
        h('button', { class: 'btn sm', id: 'btnWait', onClick: () => net.send({ t: 'wait' }) }, 'Attendre encore'),
        h('button', {
          class: 'btn sm danger', id: 'btnAbort',
          onClick: async () => {
            if (await confirmSheet({ title: 'Interrompre la partie ?', text: 'La partie en cours s’arrête et tout le monde revient au salon.', yes: 'Interrompre la partie', danger: true })) net.send({ t: 'abort' });
          },
        }, 'Interrompre la partie')) : null;
      return {
        el: h('div', { class: `stage ${tone}`.trim(), id: 'stage', 'data-outcome': view.outcome || '' },
          h('div', { class: 'stage-main' },
            h('div', { class: 'stage-text', 'aria-live': 'polite' },
              h('b', { id: 'stageTitle' }, away && !view.outcome ? h('span', { class: 'pause-ic', html: ICON.pause }) : null, title),
              h('span', { id: 'stageHint' }, hint)),
            h('div', { class: 'tray', id: 'tray', 'aria-label': 'Cartes révélées pendant ce tour' }, slots)),
          hostChoice),
        memo: { turn: view.turn, len: picks.length },
      };
    },
  };

  // ───────────────────────────────────────── centre

  const center = {
    sig: JSON.stringify([view.center, myTurn, spicy]),
    build: (memo) => {
      const slots = view.center.map((c, slot) => {
        const was = memo?.states[slot];
        if (c.s === 'gone') return h('div', { class: `cslot gone ${was && was !== 'gone' ? 'leaving' : ''}`.trim(), 'data-slot': String(slot), 'aria-hidden': 'true' });
        if (c.s === 'up') {
          const k = picks.findIndex((p) => p.from === 'center' && p.slot === slot);
          return h('div', { class: 'cslot up', 'data-slot': String(slot), 'data-v': String(c.v) }, card({ v: c.v, spicy, variant: Math.max(0, k), just: was === 'down' }));
        }
        return h('button', {
          class: `cslot down ${myTurn ? 'pickable' : ''} ${was === 'up' ? 'returned' : ''}`.replace(/\s+/g, ' ').trim(), 'data-slot': String(slot),
          'aria-label': `Carte cachée du centre, emplacement ${slot + 1}`,
          onClick: (e) => reveal({ from: 'center', slot }, e.currentTarget),
        }, card());
      });
      const cols = view.center.length <= 6 ? 6 : view.center.length <= 8 ? 4 : 5;
      return {
        el: h('div', { class: 'centerzone' },
          h('div', { class: 'cgrid', id: 'center', style: { '--cols': String(cols) }, 'aria-label': 'Cartes du centre' }, slots)),
        memo: { states: view.center.map((c) => c.s) },
      };
    },
  };

  // ───────────────────────────────────────── ma main

  const mineInfo = view.players[me];
  const hand = priv?.hand || null;
  // ma main arrive chiffrée, à part de l'état public : on attend qu'elles concordent pour la redessiner
  const stale = !hand || !mineInfo || hand.length !== mineInfo.cards;
  const mine = {
    stale,
    sig: JSON.stringify([hand, mineInfo && outOf(me, 'low'), mineInfo && outOf(me, 'high'), mineInfo?.trios, myTurn, !!ui.hideHand, mineNow, spicy, stale ? mineInfo?.cards : 0]),
    build: (memo) => {
      if (!mineInfo) return { el: h('footer', { class: 'myzone' }) };
      const low = outOf(me, 'low');
      const high = outOf(me, 'high');
      const values = stale ? Array.from({ length: mineInfo.cards }, () => null) : hand;
      const hide = !!ui.hideHand || stale;
      const fresh = memo && memo.turn === view.turn;
      const newOut = fresh && low.length + high.length > memo.out ? picks.at(-1)?.end : null;
      const back = memo && values.length > memo.cards;
      const out = (v, isNew) => h('div', { class: `hslot out ${isNew ? 'just' : ''}`.trim(), 'data-v': String(v) }, card({ v, spicy }), h('span', { class: 'end-tag shown' }, 'révélée'));
      const els = [
        ...low.map((v, k) => out(v, newOut === 'low' && k === low.length - 1)),
        ...values.map((v, k) => {
          const isLow = k === 0;
          const isHigh = k === values.length - 1;
          const face = hide ? card() : card({ v, spicy });
          const cls = `hslot ${back ? 'returned' : ''}`.trim();
          if (!isLow && !isHigh) return h('div', { class: cls }, face);
          const end = isLow ? 'low' : 'high';
          return h('button', {
            class: `${cls} end ${isLow ? 'low' : ''} ${isHigh ? 'high' : ''} ${myTurn ? 'pickable' : ''}`.replace(/\s+/g, ' ').trim(), 'data-end': end,
            'aria-label': isLow && isHigh ? 'Révéler ma dernière carte' : `Révéler ma plus ${isLow ? 'petite' : 'grande'} carte`,
            onClick: (e) => reveal({ from: 'hand', seat: me, end }, e.currentTarget),
          }, face, h('span', { class: 'end-tag' }, isLow && isHigh ? 'min·max' : isLow ? 'min' : 'max'));
        }),
        ...high.slice().reverse().map((v, k) => out(v, newOut === 'high' && k === 0)),
      ];
      return {
        el: h('footer', { class: `myzone ${mineNow && view.phase === 'play' ? 'active' : ''}`.trim(), id: 'myZone' },
          h('div', { class: 'mz-head' },
            h('span', { class: 'lbl' }, 'Ta main'),
            h('span', { class: 'mz-count', id: 'myCount' }, plural(values.length, 'carte')),
            trioRow(mineInfo.trios, 'own'),
            h('button', {
              class: 'icon-btn sm bare', id: 'btnHide', 'aria-pressed': String(!!ui.hideHand), 'aria-label': ui.hideHand ? 'Montrer ma main' : 'Cacher ma main',
              html: ui.hideHand ? ICON.eyeOff : ICON.eye, onClick: () => { ui.hideHand = !ui.hideHand; ctx.render(true); },
            })),
          els.length
            ? h('div', { class: 'myhand', id: 'myHand', style: { '--n': String(els.length), '--d': String(Math.max(1, els.length - 1)) } }, els)
            : h('p', { class: 'mz-empty', id: 'myHand' }, 'Tu n’as plus de carte en main : tu continues de jouer normalement.')),
        memo: { turn: view.turn, out: low.length + high.length, cards: values.length },
      };
    },
  };

  // ───────────────────────────────────────── assemblage

  const zones = { hud, rivals, stage, center, mine };
  const rootClass = `screen table n${n} ${spicy ? 'spicy' : ''} ${myTurn ? 'myturn' : ''} phase-${view.phase}`.replace(/\s+/g, ' ').trim();
  if (mounted && mounted.root.isConnected && mounted.gameId === room.gameId) {
    for (const name of ZONES) {
      const old = mounted.zones[name];
      const z = zones[name];
      if (old.sig === z.sig) continue;
      if (z.stale && !old.stale) continue; // on garde l'ancienne main le temps que la nouvelle arrive
      const { el, memo } = z.build(old.memo);
      old.el.replaceWith(el);
      mounted.zones[name] = { sig: z.sig, el, memo, stale: z.stale };
    }
    mounted.root.className = rootClass;
    return mounted.root;
  }
  const built = {};
  for (const name of ZONES) {
    const { el, memo } = zones[name].build(null);
    built[name] = { sig: zones[name].sig, el, memo, stale: zones[name].stale };
  }
  const root = h('section', { class: rootClass }, ZONES.map((name) => built[name].el));
  mounted = { root, gameId: room.gameId, zones: built };
  return root;
}

function openLinks() {
  openSheet(h('div', { class: 'links-sheet' },
    h('p', null, 'En mode Picante, il faut gagner deux trios liés. Les pastilles en bas d’une carte rappellent ses numéros liés.'),
    linksTable()), { title: 'Trios liés' });
}

// ───────────────────────────────────────────── Trio gagné (sur tous les téléphones)

/** Célébration d'un trio : purement décorative, elle ne bloque jamais le jeu. */
export function showTrio(ctx, room) {
  if (reduced()) return;
  const view = room.game;
  const v = view.picks[0]?.v;
  if (!v) return;
  const mine = ctx.net.seat === view.current;
  const by = view.players[view.current].name;
  const spicy = view.mode === MODE.SPICY;
  const fx = document.getElementById('fx');
  const el = h('div', { class: `trio-fx ${v === 7 ? 'seven' : ''}`.trim(), id: 'trioFx', 'aria-hidden': 'true' },
    h('div', { class: 'tf-burst' }, Array.from({ length: 16 }, (_, i) => h('i', { style: { '--a': `${(i * 360) / 16}deg`, '--d': `${90 + (i % 4) * 30}px`, '--c': ['#ffd43b', '#ff6b81', '#38d9a9', '#74c0fc'][i % 4] } }))),
    h('div', { class: 'tf-cards' }, [0, 1, 2].map((k) => h('div', { class: 'tf-card', style: { '--k': String(k - 1) } }, card({ v, spicy, variant: k })))),
    h('h2', { class: 'tf-title' }, `Trio de ${v} !`),
    h('p', { class: 'tf-sub' }, v === 7 ? 'Le trio magique : victoire immédiate !' : mine ? 'Il rejoint ta collection.' : `${by} gagne le trio.`));
  fx.replaceChildren(el);
  setTimeout(() => el.classList.add('out'), dur(1900));
  setTimeout(() => { if (el.isConnected) el.remove(); }, dur(2300));
}
