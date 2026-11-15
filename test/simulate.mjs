// Simulation : joue des milliers de parties dans les deux modes, de 3 à 6 joueurs, et vérifie
// les invariants du moteur et l'étanchéité de la vue publique après chaque action.
// Usage : node test/simulate.mjs [parties par configuration]
import { createGame, settle, legalMoves, play } from '../public/engine/game.js';
import { publicView, privateView } from '../public/state/privacy.js';
import { seeded, names, smartMove, invariants, publicLeaks, scramble } from './helpers.mjs';

const GAMES = Number(process.argv[2]) || 300;
let total = 0;
let actions = 0;
const rows = [];

function fail(label, messages) {
  console.error(`✗ ${label}\n  ${messages.join('\n  ')}`);
  process.exit(1);
}

function check(state, label, rng) {
  const bad = invariants(state);
  const view = publicView(state);
  bad.push(...publicLeaks(view));
  if (JSON.stringify(publicView(scramble(state, rng))) !== JSON.stringify(view)) bad.push('la vue publique dépend des cartes cachées');
  for (let p = 0; p < state.n; p++) {
    const mine = privateView(state, p);
    if (mine.hand.length !== view.players[p].cards) bad.push(`main privée du joueur ${p} : taille incohérente`);
  }
  if (bad.length) fail(label, bad);
}

for (const mode of ['normal', 'spicy']) {
  for (let n = 3; n <= 6; n++) {
    const reasons = { seven: 0, three: 0, linked: 0 };
    let turns = 0; let trios = 0; let longest = 0;
    for (let g = 0; g < GAMES; g++) {
      const rng = seeded(n * 100003 + g * 7919 + mode.length);
      const label = `${mode} · ${n} joueurs · partie ${g}`;
      // des joueurs plus ou moins attentifs d'une partie à l'autre
      const skill = 0.55 + (g % 5) * 0.1;
      let s = createGame({ names: names(n), mode, firstPlayer: Math.floor(rng() * n) }, rng);
      check(s, label, rng);
      let guard = 0;
      while (s.phase !== 'over') {
        if (++guard > 60000) fail(label, ['partie sans fin']);
        if (s.phase === 'resolve') {
          s = settle(s);
        } else {
          const move = smartMove(s, rng, skill);
          if (!move) fail(label, ['aucune révélation possible alors que la partie continue']);
          if (!legalMoves(s).some((m) => JSON.stringify(m) === JSON.stringify(move))) fail(label, ['coup illégal proposé']);
          s = play(s, s.current, move);
        }
        actions += 1;
        check(s, label, rng);
      }
      reasons[s.reason] += 1;
      turns += s.turn;
      trios += s.trios.flat().length;
      longest = Math.max(longest, s.turn);
      total += 1;
    }
    rows.push({
      mode, joueurs: n, 'trio de 7': reasons.seven, '3 trios': reasons.three, '2 trios liés': reasons.linked,
      'tours moy.': (turns / GAMES).toFixed(1), 'tours max': longest, 'trios moy.': (trios / GAMES).toFixed(1),
    });
  }
}
console.table(rows);
console.log(`✓ ${total} parties jouées jusqu'au bout (${actions} actions), invariants et confidentialité vérifiés à chaque action.`);
console.log('  (Joueurs simulés : ces proportions ne reflètent pas des parties jouées par des humains.)');
