// Salon : on attend les joueurs, l'hôte range la table et règle la partie.
import { h, plural } from '../dom.js';
import { ICON } from '../art.js';
import { confirmSheet, toast, linksTable, rulesContent, openSheet } from '../components.js';
import { MODE_LABEL, MODE_HELP, rich } from '../texts.js';
import { MIN_PLAYERS, MAX_PLAYERS, MODE, dealSizes } from '../../engine/rules.js';

export function inviteLink(code) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  const broker = new URLSearchParams(location.search).get('broker');
  if (broker) url.searchParams.set('broker', broker);
  return url.toString();
}

async function share(code) {
  const link = inviteLink(code);
  try {
    if (navigator.share) { await navigator.share({ title: 'Triplette', text: `Rejoins ma partie de Triplette : code ${code}`, url: link }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(link); toast('Lien d’invitation copié.'); } catch { toast(`Code de la partie : ${code}`); }
}

export function lobbyScreen(ctx) {
  const { net } = ctx;
  const room = net.room;
  const isHost = net.isHost;
  const s = room.settings;
  const n = room.members.length;
  const missing = Math.max(0, MIN_PLAYERS - n);
  const hostName = room.members.find((m) => m.id === room.hostId)?.name || 'l’hôte';
  const send = (cmd) => net.send(cmd);
  const anyWins = room.members.some((m) => m.wins);

  async function leave() {
    const ok = await confirmSheet(isHost
      ? { title: 'Fermer la partie ?', text: 'Tous les joueurs du salon seront renvoyés à l’accueil.', yes: 'Fermer la partie', danger: true }
      : { title: 'Quitter le salon ?', text: 'Tu pourras revenir avec le même code tant que la partie n’a pas commencé.', yes: 'Quitter', danger: true });
    if (ok) net.leave();
  }

  // ── joueurs
  const rows = room.members.map((m, i) => {
    const me = m.id === net.id;
    return h('li', { class: `member ${m.online ? '' : 'off'} ${me ? 'me' : ''}`.trim(), 'data-id': m.id },
      h('span', { class: 'num' }, String(i + 1)),
      h('span', { class: `presence ${m.online ? 'on' : 'off'}`, title: m.online ? 'Connecté' : 'Hors ligne' }),
      h('span', { class: 'm-name' }, m.name,
        m.id === room.hostId ? h('span', { class: 'tag-mini host' }, 'hôte') : null,
        me ? h('span', { class: 'tag-mini' }, 'toi') : null,
        m.online ? null : h('span', { class: 'tag-mini warn' }, 'hors ligne'),
        m.wins ? h('span', { class: 'tag-mini wins', title: plural(m.wins, 'victoire') }, h('span', { class: 'wins-ic', html: ICON.trophy }), String(m.wins)) : null),
      isHost ? h('span', { class: 'm-tools' },
        h('button', { class: 'icon-btn sm', 'aria-label': `Monter ${m.name}`, disabled: i === 0, html: ICON.up, onClick: () => send({ t: 'move', id: m.id, delta: -1 }) }),
        h('button', { class: 'icon-btn sm', 'aria-label': `Descendre ${m.name}`, disabled: i === n - 1, html: ICON.down, onClick: () => send({ t: 'move', id: m.id, delta: 1 }) }),
        me ? h('span', { class: 'icon-spacer' }) : h('button', {
          class: 'icon-btn sm danger-ic', 'aria-label': `Retirer ${m.name}`, html: ICON.close,
          onClick: async () => { if (await confirmSheet({ title: `Retirer ${m.name} ?`, text: `${m.name} sera renvoyé·e à l’accueil.`, yes: 'Retirer', danger: true })) send({ t: 'kick', id: m.id }); },
        })) : null);
  });

  // ── réglages
  const seg = (items, current, onPick, id, label) => h('div', { class: 'seg', id, role: 'group', 'aria-label': label },
    items.map(([value, text, disabled]) => h('button', { class: value === current ? 'sel' : '', 'data-v': String(value), disabled: !!disabled, 'aria-pressed': String(value === current), onClick: () => onPick(value) }, text)));
  const firstName = s.first === 'random' ? 'Tirage au sort' : room.members.find((m) => m.id === s.first)?.name || 'Tirage au sort';

  let settings;
  if (isHost) {
    settings = [
      seg([[MODE.NORMAL, 'Normal'], [MODE.SPICY, 'Picante']], s.mode, (mode) => send({ t: 'settings', mode }), 'modePick', 'Mode de jeu'),
      h('p', { class: 'hint left', id: 'modeHelp' }, rich(MODE_HELP[s.mode])),
      s.mode === MODE.SPICY ? linksTable() : null,
      h('div', { class: 'lbl' }, 'Nombre de places'),
      seg([3, 4, 5, 6].map((k) => [k, String(k), k < n]), s.max, (max) => send({ t: 'settings', max }), 'seatPick', 'Nombre de places'),
      h('div', { class: 'lbl' }, 'Qui commence ?'),
      h('div', { class: 'chips', id: 'firstPick' },
        h('button', { class: `chip ${s.first === 'random' ? 'sel' : ''}`, 'data-first': 'random', onClick: () => send({ t: 'settings', first: 'random' }) }, h('span', { class: 'chip-ic', html: ICON.dice }), 'Tirage au sort'),
        room.members.map((m) => h('button', { class: `chip ${s.first === m.id ? 'sel' : ''}`, 'data-first': m.id, onClick: () => send({ t: 'settings', first: m.id }) }, m.name))),
    ];
  } else {
    const line = (label, value, id) => h('div', { class: 'set-row' }, h('span', { class: 'set-label' }, label), h('b', { class: 'set-v', id }, value));
    settings = [
      h('div', { class: 'ro-mode' }, h('b', { id: 'modeName' }, MODE_LABEL[s.mode]), h('span', { class: 'muted' }, ` · réglé par ${hostName}`)),
      h('p', { class: 'hint left' }, rich(MODE_HELP[s.mode])),
      s.mode === MODE.SPICY ? linksTable() : null,
      line('Places', String(s.max), 'seatCount'),
      line('Commence', firstName, 'firstName'),
    ];
  }

  let summary;
  if (missing) summary = h('div', { class: 'summary wait', id: 'dealSummary' }, `Encore ${plural(missing, 'joueur')} à attendre (${MIN_PLAYERS} minimum).`);
  else {
    const d = dealSizes(n);
    summary = h('div', { class: 'summary ok', id: 'dealSummary' }, h('b', null, `${n} joueurs`), ` · ${d.hand} cartes chacun, ${d.center} au centre`);
  }

  const canStart = !missing && n <= MAX_PLAYERS;
  return h('section', { class: 'screen lobby' },
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', id: 'btnLeaveLobby', 'aria-label': isHost ? 'Fermer la partie' : 'Quitter le salon', html: ICON.back, onClick: leave }),
      h('h1', null, 'Salon'),
      h('button', { class: 'icon-btn', 'aria-label': 'Menu', html: ICON.menu, onClick: () => ctx.openMenu() })),

    h('div', { class: 'card-box glass center code-card' },
      h('div', { class: 'lbl' }, 'Code de la partie'),
      h('div', { class: 'room-code', id: 'roomCode' }, room.code),
      h('button', { class: 'btn primary', id: 'btnShare', onClick: () => share(room.code) }, h('span', { class: 'btn-ic', html: ICON.users }), 'Inviter des joueurs'),
      h('p', { class: 'hint' }, 'Les autres ouvrent le lien, ou tapent ce code sur l’accueil.')),

    h('div', { class: 'card-box glass' },
      h('div', { class: 'lbl' }, `Autour de la table · ${n}/${s.max}`),
      isHost ? h('p', { class: 'hint left' }, 'Range les joueurs dans l’ordre du tour (sens des aiguilles d’une montre).') : null,
      h('ol', { class: 'members', id: 'members' }, rows),
      anyWins ? h('p', { class: 'hint left' }, 'Le trophée compte les parties gagnées depuis l’ouverture du salon.') : null),

    h('div', { class: 'card-box glass', id: 'settingsCard' },
      h('div', { class: 'lbl' }, 'La partie'),
      settings,
      summary),

    h('button', { class: 'btn ghost', id: 'btnLobbyRules', onClick: () => openSheet(rulesContent(), { title: 'Règles du jeu', cls: 'tall' }) }, h('span', { class: 'btn-ic', html: ICON.book }), 'Règles du jeu'),

    h('div', { class: 'cta-space' }),
    h('div', { class: 'cta-bar' },
      isHost
        ? h('button', { class: 'btn primary big', id: 'btnLaunch', disabled: !canStart, onClick: () => { ctx.sound.unlock(); send({ t: 'start' }); } },
          missing ? `Lancer · encore ${plural(missing, 'joueur')}` : 'Lancer la partie')
        : h('div', { class: 'waiting-host', id: 'waitStart' }, h('span', { class: 'spinner sm', 'aria-hidden': 'true' }), `En attente que ${hostName} lance la partie…`)));
}
