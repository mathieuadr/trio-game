// Fin de partie : le gagnant, la condition de victoire, les trios de chacun.
import { h, plural } from '../dom.js';
import { ICON } from '../art.js';
import { card, trioRow, modeChip, confirmSheet } from '../components.js';
import { REASON_LABEL } from '../texts.js';
import { MODE, winningPair } from '../../engine/rules.js';

export function gameOverScreen(ctx) {
  const { net, ui } = ctx;
  const room = net.room;
  const view = room.game;
  const me = net.seat;
  const winner = view.players[view.winner];
  const mine = me === view.winner;
  const spicy = view.mode === MODE.SPICY;
  const hostName = room.members.find((m) => m.id === room.hostId)?.name || 'l’hôte';
  const st = ui.over?.gameId === room.gameId ? ui.over : (ui.over = { gameId: room.gameId, played: false });
  if (!st.played) {
    st.played = true;
    setTimeout(() => (mine ? ctx.sound.win() : ctx.sound.lose()), 250);
  }

  // les trios qui font gagner, et la phrase qui l'explique
  let shown; let how;
  if (view.reason === 'seven') {
    shown = [7];
    how = 'Le trio de 7 : victoire immédiate.';
  } else if (view.reason === 'linked') {
    shown = winningPair(winner.trios) || winner.trios.slice(-2);
    how = `Deux trios liés : le ${shown[0]} et le ${shown[1]}.`;
  } else {
    shown = winner.trios.slice(0, 3);
    how = `Trois trios : ${shown.join(', ')}.`;
  }

  const fan = (v) => h('div', { class: `win-trio ${v === 7 ? 'seven' : ''}`.trim(), 'data-v': String(v) },
    [0, 1, 2].map((k) => h('div', { class: 'win-card', style: { '--k': String(k - 1) } }, card({ v, spicy, variant: k }))));

  const rows = view.players.map((p, i) => {
    const m = room.members[i];
    return h('li', { class: `score-row ${i === view.winner ? 'won' : ''} ${i === me ? 'me' : ''}`.replace(/\s+/g, ' ').trim(), 'data-seat': String(i) },
      h('span', { class: 'sc-name' }, p.name, i === me ? h('span', { class: 'tag-mini' }, 'toi') : null, i === view.winner ? h('span', { class: 'tag-mini host' }, 'gagne') : null),
      trioRow(p.trios),
      h('span', { class: 'sc-wins', title: plural(m?.wins || 0, 'victoire') }, h('span', { class: 'wins-ic', html: ICON.trophy }), String(m?.wins || 0)));
  });

  async function quit() {
    const ok = await confirmSheet(net.isHost
      ? { title: 'Fermer la partie ?', text: 'Tous les joueurs seront renvoyés à l’accueil.', yes: 'Fermer la partie', danger: true }
      : { title: 'Quitter la table ?', text: `Tu quittes la partie de ${hostName}.`, yes: 'Quitter', danger: true });
    if (ok) net.leave();
  }

  const sparks = h('div', { class: 'over-fx', 'aria-hidden': 'true' },
    Array.from({ length: 18 }, (_, i) => h('i', { style: { left: `${4 + ((i * 37) % 92)}%`, '--t': `${2.6 + (i % 5) * 0.5}s`, '--w': `${(i % 6) * 0.35}s`, '--c': ['#ffd43b', '#ff6b81', '#38d9a9', '#74c0fc'][i % 4] } })));

  return h('section', { class: `screen over reason-${view.reason} ${mine ? 'i-won' : ''}`.trim(), 'data-winner': String(view.winner), 'data-reason': view.reason },
    sparks,
    h('div', { class: 'over-main' },
      h('p', { class: 'over-kicker' }, 'Partie terminée'),
      h('h1', { class: 'over-title', id: 'overTitle' }, mine ? 'Tu as gagné !' : `${winner.name} gagne !`),
      h('div', { class: `win-trios k${shown.length}`, id: 'winTrios' }, shown.map(fan)),
      h('p', { class: 'over-how', id: 'overHow' }, h('b', null, REASON_LABEL[view.reason]), ' — ', how),
      h('div', { class: 'over-meta' }, modeChip(view.mode), h('span', null, `${plural(view.turn, 'tour')} · ${plural(view.reveals, 'carte retournée', 'cartes retournées')}`))),
    h('div', { class: 'card-box glass' },
      h('div', { class: 'lbl' }, 'Les trios de chacun'),
      h('ul', { class: 'scores', id: 'scores' }, rows),
      h('p', { class: 'hint left' }, 'Le trophée compte les parties gagnées depuis l’ouverture du salon.')),
    h('div', { class: 'bottom-actions static' },
      net.isHost
        ? [
          h('button', { class: 'btn primary big', id: 'btnReplay', onClick: () => net.send({ t: 'replay' }) }, 'Rejouer'),
          h('button', { class: 'btn big', id: 'btnBackLobby', onClick: () => net.send({ t: 'lobby' }) }, 'Retour au salon'),
        ]
        : h('div', { class: 'waiting-host', id: 'waitNext' }, h('span', { class: 'spinner sm', 'aria-hidden': 'true' }), `${hostName} choisit la suite : rejouer ou revenir au salon.`),
      h('button', { class: 'btn big ghost', id: 'btnQuit', onClick: quit }, net.isHost ? 'Fermer la partie' : 'Quitter la table')));
}
