// Écran des règles.
import { h } from '../dom.js';
import { ICON } from '../art.js';
import { rulesContent } from '../components.js';

export function rulesScreen(ctx) {
  return h('section', { class: 'screen rules-screen' },
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Retour', html: ICON.back, onClick: () => ctx.go('home') }),
      h('h1', null, 'Règles du jeu'),
      h('span', { class: 'topbar-space' })),
    h('div', { class: 'card-box glass' }, rulesContent()),
    h('button', { class: 'btn big', onClick: () => ctx.go('home') }, 'Retour à l’accueil'));
}
