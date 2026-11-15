// Écran d'accueil : prénom, mode, créer une partie ou en rejoindre une.
import { h } from '../dom.js';
import { ICON } from '../art.js';
import { card, settingToggles, toast } from '../components.js';
import { MODE_GOAL } from '../texts.js';
import { cleanCode } from '../../net/room.js';

/** Quelques cartes en éventail derrière le titre. */
const backdrop = () => h('div', { class: 'home-art', 'aria-hidden': 'true' },
  [[3, -24], [9, -12], [7, 0], [12, 12], [5, 24]].map(([v, rot], i) => h('div', { class: 'home-card-art', style: { '--rot': `${rot}deg`, '--i': String(i) } }, card({ v }))));

export function homeScreen(ctx) {
  const { prefs, ui, net } = ctx;
  const invited = cleanCode(ui.invite || '');

  const nameInput = h('input', {
    type: 'text', class: 'field', id: 'name', value: prefs.name, placeholder: 'ex. Camille', maxLength: 14,
    'aria-label': 'Ton prénom', attrs: { autocomplete: 'nickname', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done' },
    onInput: (e) => prefs.set('name', e.target.value),
  });
  const codeInput = h('input', {
    type: 'text', class: 'field code-input', id: 'code', value: ui.code || '', placeholder: 'CODE', maxLength: 5,
    'aria-label': 'Code de la partie', attrs: { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'go' },
    onInput: (e) => { e.target.value = cleanCode(e.target.value); ui.code = e.target.value; },
    onKeydown: (e) => { if (e.key === 'Enter') join(e.target.value); },
  });

  const name = () => {
    const v = nameInput.value.trim();
    if (!v) { toast('Indique d’abord ton prénom.', { tone: 'warn' }); ctx.sound.error(); nameInput.focus(); return null; }
    prefs.set('name', v);
    return v;
  };
  async function create() {
    const n = name();
    if (!n) return;
    ctx.sound.unlock();
    try { await net.create(n, { mode: prefs.mode }); } catch (e) { toast(e.message, { tone: 'warn' }); }
  }
  async function join(code) {
    const n = name();
    if (!n) return;
    code = cleanCode(code);
    if (code.length !== 5) { toast('Le code de la partie a 5 caractères.', { tone: 'warn' }); ctx.sound.error(); codeInput.focus(); return; }
    ctx.sound.unlock();
    ui.invite = null;
    try { await net.join(code, n); } catch (e) { toast(e.message, { tone: 'warn' }); }
  }

  // choix du mode pour la partie que l'on crée (l'hôte peut encore le changer dans le salon)
  const goal = h('p', { class: 'hint left', id: 'homeGoal' }, `Pour gagner : ${MODE_GOAL[prefs.mode]}.`);
  const modeBtn = (mode, label) => h('button', {
    class: prefs.mode === mode ? 'sel' : '', 'data-v': mode, 'aria-pressed': String(prefs.mode === mode),
    onClick: (e) => {
      ctx.sound.tap();
      prefs.set('mode', mode);
      for (const b of e.currentTarget.parentNode.children) { const on = b === e.currentTarget; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', String(on)); }
      goal.textContent = `Pour gagner : ${MODE_GOAL[mode]}.`;
    },
  }, label);

  const actions = invited
    ? [
      h('div', { class: 'invite' }, 'Tu es invité·e à la partie ', h('b', { class: 'mono' }, invited)),
      h('button', { class: 'btn primary big', id: 'btnJoinInvite', onClick: () => join(invited) }, 'Rejoindre la partie'),
      h('button', { class: 'btn ghost', id: 'btnOwn', onClick: () => { ui.invite = null; ctx.render(true); } }, 'Créer plutôt ma propre partie'),
    ]
    : [
      h('div', { class: 'lbl' }, 'Mode de jeu'),
      h('div', { class: 'seg', id: 'homeMode', role: 'group', 'aria-label': 'Mode de jeu' }, modeBtn('normal', 'Normal'), modeBtn('spicy', 'Picante')),
      goal,
      h('button', { class: 'btn primary big', id: 'btnCreate', onClick: create }, 'Créer une partie'),
      h('div', { class: 'sep' }, h('span', null, 'ou rejoindre une partie')),
      h('div', { class: 'row' }, codeInput, h('button', { class: 'btn', id: 'btnJoin', onClick: () => join(codeInput.value) }, 'Rejoindre')),
    ];

  return h('section', { class: 'screen home' },
    backdrop(),
    h('div', { class: 'home-top' }, settingToggles(ctx)),
    h('div', { class: 'home-title' },
      h('h1', { class: 'logo', 'aria-label': 'Triplette' }, 'TRIPLETTE'),
      h('p', { class: 'tagline' }, 'Trois cartes identiques, et le trio est à toi.', h('br'), 'Chacun son téléphone, de 3 à 6 joueurs.')),
    h('div', { class: 'card-box glass home-card' },
      h('label', { class: 'lbl', for: 'name' }, 'Ton prénom'),
      nameInput,
      actions),
    h('div', { class: 'home-foot' },
      h('button', { class: 'btn ghost', id: 'btnRules', onClick: () => ctx.go('rules') }, h('span', { class: 'btn-ic', html: ICON.book }), 'Règles du jeu'),
      h('p', { class: 'hint' }, '3 à 6 joueurs · un téléphone chacun · sans compte')));
}

/** Pendant la connexion à une partie. */
export function joiningScreen(ctx) {
  const { net } = ctx;
  const resuming = net.pending?.kind === 'resume';
  return h('section', { class: 'screen joining' },
    h('div', { class: 'joining-main' },
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', { class: 'joining-lead' }, resuming ? 'Retour dans la partie' : 'Connexion à la partie'),
      h('div', { class: 'room-code', id: 'joiningCode' }, net.code),
      h('p', { class: 'joining-note' }, net.connected ? 'On attend la réponse de l’hôte…' : 'Connexion au relais…')),
    h('div', { class: 'bottom-actions' },
      h('button', { class: 'btn big', id: 'btnCancelJoin', onClick: () => net.reset() }, 'Annuler')));
}
