// Tests du moteur de règles et du cloisonnement des informations.
// `node --test test/engine.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, revealCenter, revealHand, settle, legalMoves, RuleError } from '../public/engine/game.js';
import { LINKS, MODE, DECK_SIZE, validateLinks, linked, linkPairs, victory, winningPair, buildDeck, dealSizes } from '../public/engine/rules.js';
import { publicView, privateView } from '../public/state/privacy.js';
import { seeded, names, rig, tableA, tableB, C, LOW, HIGH, turn, missTurn, valuesOf, invariants, publicLeaks, scramble, smartMove } from './helpers.mjs';

const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof RuleError, `erreur inattendue : ${e}`); return e.code; } return null; };
const ok = (state) => assert.deepEqual(invariants(state), []);

// ───────────────────────────────────────────── distribution

test('le paquet : 36 cartes, 12 valeurs en trois exemplaires, identifiants uniques', () => {
  const deck = buildDeck();
  assert.equal(deck.length, DECK_SIZE);
  assert.equal(new Set(deck.map((c) => c.id)).size, 36);
  for (let v = 1; v <= 12; v++) assert.equal(deck.filter((c) => c.v === v).length, 3, `valeur ${v}`);
});

for (const [n, hand, center] of [[3, 9, 9], [4, 7, 8], [5, 6, 6], [6, 5, 6]]) {
  test(`distribution à ${n} joueurs : ${hand} cartes chacun et ${center} au centre`, () => {
    assert.deepEqual(dealSizes(n), { hand, center });
    for (let seed = 1; seed <= 40; seed++) {
      const s = createGame({ names: names(n), firstPlayer: seed % n }, seeded(seed));
      assert.equal(s.hands.length, n);
      for (const h of s.hands) {
        assert.equal(h.length, hand);
        assert.deepEqual(valuesOf(h), valuesOf(h).slice().sort((a, b) => a - b), 'main triée par ordre croissant');
      }
      assert.equal(s.center.length, center);
      const all = [...s.hands.flat(), ...s.center];
      assert.equal(all.length, 36, 'toutes les cartes sont distribuées');
      assert.equal(new Set(all.map((c) => c.id)).size, 36, 'chaque carte une seule fois');
      for (let v = 1; v <= 12; v++) assert.equal(all.filter((c) => c.v === v).length, 3, `valeur ${v} en trois exemplaires`);
      assert.equal(s.current, seed % n);
      assert.equal(s.phase, 'play');
      ok(s);
    }
  });
}

test('le mélange dépend du hasard injecté, et rien d\'autre', () => {
  const a = createGame({ names: names(4) }, seeded(7));
  const b = createGame({ names: names(4) }, seeded(7));
  const c = createGame({ names: names(4) }, seeded(8));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.hands, c.hands);
});

test('une partie se joue de 3 à 6 joueurs, dans un mode connu', () => {
  assert.equal(code(() => createGame({ names: names(2) })), 'bad-players');
  assert.equal(code(() => createGame({ names: [...names(6), 'Gus'] })), 'bad-players');
  assert.equal(code(() => createGame({ names: names(3), mode: 'turbo' })), 'bad-mode');
  assert.equal(code(() => createGame({ names: names(3), firstPlayer: 3 })), 'bad-first-player');
  assert.throws(() => dealSizes(7), RangeError);
});

// ───────────────────────────────────────────── révélations

test('révéler une carte du centre', () => {
  const s0 = tableA();
  const s = revealCenter(s0, 0, 4);
  assert.deepEqual(s.picks, [{ id: s0.center[4].id, v: 8, from: 'center', slot: 4 }]);
  assert.equal(s.phase, 'play');
  assert.equal(s.current, 0, 'le joueur continue');
  const view = publicView(s);
  assert.deepEqual(view.center[4], { s: 'up', v: 8 });
  assert.equal(view.center.filter((c) => c.s === 'down').length, 8);
  assert.equal(s0.picks.length, 0, 'l\'état précédent n\'est pas modifié');
  ok(s);
});

test('révéler la plus petite et la plus grande carte d\'une main', () => {
  const s0 = tableA();
  const low = revealHand(s0, 0, 1, 'low');
  assert.equal(low.picks[0].v, 1);
  assert.deepEqual(valuesOf(low.hands[1]), [2, 3, 3, 6, 7, 9, 10, 12]);
  const high = revealHand(s0, 0, 2, 'high');
  assert.equal(high.picks[0].v, 12);
  assert.deepEqual(valuesOf(high.hands[2]), [2, 4, 4, 6, 7, 9, 10, 11]);
  assert.deepEqual(high.picks[0], { id: high.picks[0].id, v: 12, from: 'hand', seat: 2, end: 'high' });
  // sa propre main aussi
  const mine = revealHand(s0, 0, 0, 'high');
  assert.equal(mine.picks[0].v, 12);
  ok(low); ok(high); ok(mine);
});

test('impossible de révéler une carte du milieu d\'une main', () => {
  const s = tableA();
  for (const end of ['middle', 3, null, undefined, 'LOW', '7']) assert.equal(code(() => revealHand(s, 0, 1, end)), 'bad-end');
  assert.equal(code(() => revealHand(s, 0, 9, 'low')), 'bad-seat');
  // quels que soient les coups, la carte révélée est toujours la plus petite ou la plus grande de ce qui reste
  for (let seed = 1; seed <= 30; seed++) {
    const rng = seeded(seed);
    let g = createGame({ names: names(3 + (seed % 4)), firstPlayer: 0 }, rng);
    for (let i = 0; i < 60 && g.phase !== 'over'; i++) {
      if (g.phase === 'resolve') { g = settle(g); continue; }
      const moves = legalMoves(g).filter((m) => m.from === 'hand');
      const m = moves[Math.floor(rng() * moves.length)];
      const before = valuesOf(g.hands[m.seat]);
      g = revealHand(g, g.current, m.seat, m.end);
      assert.equal(g.picks.at(-1).v, m.end === 'low' ? Math.min(...before) : Math.max(...before));
    }
  }
});

test('deux cartes identiques à une extrémité : une seule est révélée par action', () => {
  // main [2, 2, 5, 8, 11] : plus petite → 2, encore → 2, encore → 5
  const s0 = rig({ hands: [[2, 2, 5, 8, 11], [1, 3, 4, 6, 7], [9, 10, 12, 12, 12]], center: [], strict: false });
  const s1 = revealHand(s0, 0, 0, 'low');
  assert.deepEqual([s1.picks.at(-1).v, valuesOf(s1.hands[0])], [2, [2, 5, 8, 11]]);
  const s2 = revealHand(s1, 0, 0, 'low');
  assert.deepEqual([s2.picks.at(-1).v, valuesOf(s2.hands[0])], [2, [5, 8, 11]]);
  assert.equal(s2.phase, 'play', 'deux cartes identiques : on continue');
  const s3 = revealHand(s2, 0, 0, 'low');
  assert.deepEqual([s3.picks.at(-1).v, valuesOf(s3.hands[0])], [5, [8, 11]]);
  assert.deepEqual(s3.picks.map((p) => p.v), [2, 2, 5]);
  assert.equal(s3.outcome, 'miss');
});

test('une seule carte en main : elle est à la fois la plus petite et la plus grande', () => {
  const s = rig({ hands: [[4], [4, 9], [4, 9, 9]], center: [], strict: false });
  assert.equal(revealHand(s, 0, 0, 'low').picks[0].id, revealHand(s, 0, 0, 'high').picks[0].id);
  const moves = legalMoves(s);
  assert.deepEqual(moves.filter((m) => m.seat === 0), [LOW(0)], 'une seule extrémité proposée');
  assert.equal(moves.filter((m) => m.seat === 2).length, 2);
});

test('un joueur sans carte peut toujours jouer', () => {
  const s = rig({ hands: [[], [3, 3, 8], [3, 5, 8]], center: [8, 5, 5], strict: false });
  assert.equal(code(() => revealHand(s, 0, 0, 'low')), 'empty-hand');
  assert.ok(!legalMoves(s).some((m) => m.seat === 0));
  const t = turn(s, LOW(1), LOW(1), LOW(2));
  assert.equal(t.outcome, 'trio');
  assert.deepEqual(t.trios[0], [3], 'trio gagné sans posséder une carte de cette valeur');
});

test('deux cartes identiques : le joueur continue ; deux différentes : le tour s\'arrête aussitôt', () => {
  const s = turn(tableA(), LOW(0), LOW(0));
  assert.deepEqual([s.phase, s.outcome, s.current, s.picks.length], ['play', null, 0, 2]);
  const miss = turn(tableA(), LOW(0), C(0));
  assert.deepEqual([miss.phase, miss.outcome], ['resolve', 'miss']);
  assert.deepEqual(miss.picks.map((p) => p.v), [1, 3]);
  // impossible de continuer après deux valeurs différentes, même en sachant où sont les cartes
  assert.equal(code(() => revealHand(miss, 0, 0, 'low')), 'not-playing');
  assert.equal(code(() => revealCenter(miss, 0, 1)), 'not-playing');
  assert.equal(code(() => revealCenter(miss, 1, 1)), 'not-playing');
  assert.deepEqual(legalMoves(miss), []);
  ok(s); ok(miss);
});

test('trois cartes identiques : le trio est gagné et retiré du jeu', () => {
  const s = turn(tableA(), LOW(0), LOW(0), LOW(1));
  assert.deepEqual([s.phase, s.outcome], ['resolve', 'trio']);
  assert.deepEqual(s.trios, [[1], [], []]);
  assert.deepEqual(s.won.slice().sort((a, b) => a - b), [0, 1, 2]);
  assert.ok(!s.hands.flat().some((c) => c.v === 1));
  ok(s);
  // un trio peut mêler mains et centre
  const mix = turn(missTurn(tableA()), HIGH(0), C(8)); // 12 puis 11 : raté
  assert.equal(mix.outcome, 'miss');
  const five = turn(rig({ hands: [[5, 5, 9], [1, 9, 9], [1, 1, 3]], center: [5, 3, 3], strict: false }), LOW(0), C(0), LOW(0));
  assert.equal(five.outcome, 'trio');
  assert.equal(five.center[0], null, 'la carte du centre quitte son emplacement');
  assert.deepEqual(publicView(five).center.map((c) => c.s), ['gone', 'down', 'down']);
});

test('on ne joue que pendant son tour', () => {
  const s = tableA({ first: 1 });
  assert.equal(code(() => revealCenter(s, 0, 0)), 'not-your-turn');
  assert.equal(code(() => revealHand(s, 2, 2, 'low')), 'not-your-turn');
  assert.equal(code(() => revealCenter(s, 7, 0)), 'bad-player');
  assert.equal(revealCenter(s, 1, 0).picks.length, 1);
});

test('une carte du centre ne se révèle qu\'une fois par tour, et jamais si elle n\'existe pas', () => {
  const s = revealCenter(tableA(), 0, 4);
  assert.equal(code(() => revealCenter(s, 0, 4)), 'already-shown');
  for (const slot of [-1, 9, 2.5, '4', null]) assert.equal(code(() => revealCenter(s, 0, slot)), 'bad-slot');
  assert.ok(!legalMoves(s).some((m) => m.from === 'center' && m.slot === 4));
});

test('on peut enchaîner sa propre main, une main adverse et le centre dans le même tour', () => {
  const s = turn(rig({ hands: [[5, 6, 9], [5, 9, 9], [1, 1, 3]], center: [5, 3, 3], strict: false }), LOW(0), LOW(1), C(0));
  assert.equal(s.outcome, 'trio');
  assert.deepEqual(s.picks.map((p) => p.from), ['hand', 'hand', 'center']);
});

// ───────────────────────────────────────────── restitution

test('après un échec, les cartes du centre se retournent face cachée à leur emplacement', () => {
  const s0 = tableA();
  const s = settle(turn(s0, C(2), C(7)));
  assert.deepEqual(s.center, s0.center, 'mêmes cartes aux mêmes emplacements');
  assert.ok(publicView(s).center.every((c) => c.s === 'down'));
  assert.deepEqual(s.picks, []);
  assert.deepEqual([s.phase, s.outcome, s.current, s.turn], ['play', null, 1, 2]);
  ok(s);
});

test('après un échec, les cartes des mains retournent chez leur propriétaire, à leur place triée', () => {
  const s0 = tableA();
  const miss = turn(s0, HIGH(1), HIGH(2), LOW(2)); // 12, 12, 2
  assert.equal(miss.outcome, 'miss');
  assert.deepEqual(valuesOf(miss.hands[2]), [4, 4, 6, 7, 9, 10, 11]);
  const s = settle(miss);
  assert.deepEqual(s.hands, s0.hands, 'les mains sont exactement celles d\'avant le tour');
  ok(s);
  // mélange de mains et de centre, avec des doublons aux extrémités
  const again = settle(turn(s0, LOW(0), LOW(0), C(3)));
  assert.deepEqual(again.hands, s0.hands);
  assert.deepEqual(again.center, s0.center);
});

test('settle n\'existe que pour clore un tour ; gagner un trio ne fait pas rejouer', () => {
  assert.equal(code(() => settle(tableA())), 'not-resolve');
  const trio = turn(tableA(), LOW(0), LOW(0), LOW(1));
  const next = settle(trio);
  assert.deepEqual([next.phase, next.current, next.turn], ['play', 1, 2], 'le joueur suivant joue');
  assert.deepEqual(next.picks, []);
  // le tour passe dans le sens horaire et revient au premier joueur
  let s = tableA({ first: 1 });
  s = missTurn(s); assert.equal(s.current, 2);
  s = missTurn(s); assert.equal(s.current, 0);
  s = missTurn(s); assert.equal(s.current, 1);
});

test('une carte gagnée ne réapparaît jamais', () => {
  let s = settle(turn(tableA(), LOW(0), LOW(0), LOW(1))); // trio de 1
  const gone = new Set(s.won);
  const rng = seeded(11);
  for (let i = 0; i < 400 && s.phase !== 'over'; i++) {
    if (s.phase === 'resolve') { s = settle(s); continue; }
    const moves = legalMoves(s);
    s = turn(s, moves[Math.floor(rng() * moves.length)]);
    const live = [...s.hands.flat(), ...s.center.filter(Boolean), ...(s.outcome === 'trio' ? [] : s.picks)];
    assert.ok(!live.some((c) => gone.has(c.id) || c.v === 1), 'un 1 est revenu en jeu');
    ok(s);
  }
  // l'emplacement d'une carte du centre gagnée ne peut plus être révélé
  const five = settle(turn(rig({ hands: [[5, 5, 9], [1, 9, 9], [1, 1, 3]], center: [5, 3, 3], strict: false }), LOW(0), C(0), LOW(0)));
  assert.equal(code(() => revealCenter(five, 1, 0)), 'slot-empty');
});

// ───────────────────────────────────────────── victoire

test('mode Normal : trois trios quelconques font gagner', () => {
  let s = tableA();
  s = settle(turn(s, LOW(0), LOW(0), LOW(1))); // joueur 0 : trio de 1
  assert.equal(s.phase, 'play');
  s = missTurn(missTurn(s));
  s = settle(turn(s, HIGH(0), HIGH(1), HIGH(2))); // trio de 12
  assert.deepEqual(s.trios[0], [1, 12]);
  assert.equal(s.winner, null, 'deux trios ne suffisent pas');
  s = missTurn(missTurn(s));
  s = turn(s, LOW(0), LOW(1), LOW(2)); // trio de 2
  assert.deepEqual([s.phase, s.winner, s.reason, s.outcome], ['over', 0, 'three', 'trio']);
  assert.deepEqual(s.trios[0], [1, 12, 2], 'pas besoin de gagner les trios dans l\'ordre');
  ok(s);
  // partie terminée : plus aucune action
  assert.equal(code(() => revealCenter(s, 0, 0)), 'game-over');
  assert.equal(code(() => settle(s)), 'not-resolve');
  assert.deepEqual(legalMoves(s), []);
});

test('mode Picante : deux trios quelconques, ou même trois, ne suffisent pas ; deux trios liés font gagner', () => {
  let s = tableA({ mode: 'spicy' });
  s = settle(turn(s, LOW(0), LOW(0), LOW(1))); // 1
  s = missTurn(missTurn(s));
  s = settle(turn(s, HIGH(0), HIGH(1), HIGH(2))); // 12
  assert.equal(s.phase, 'play', '1 et 12 ne sont pas liés');
  s = missTurn(missTurn(s));
  s = settle(turn(s, LOW(0), LOW(1), LOW(2))); // 2
  assert.deepEqual(s.trios[0], [1, 12, 2]);
  assert.equal(s.phase, 'play', 'trois trios non liés ne font pas gagner en Picante');
  s = missTurn(missTurn(s));
  s = turn(s, LOW(0), LOW(0), C(2)); // 5 : lié au 2 (et au 12)
  assert.deepEqual([s.phase, s.winner, s.reason], ['over', 0, 'linked']);
  assert.ok(winningPair(s.trios[0]));
  ok(s);
  // deux trios liés suffisent, dès le deuxième
  let t = rig({ hands: [[2, 2, 2, 9], [5, 5, 5, 9], [1, 1, 1, 9]], center: [], strict: false, mode: 'spicy' });
  t = settle(turn(t, LOW(0), LOW(0), LOW(0)));
  t = settle(turn(t, LOW(2), LOW(2), LOW(2))); // joueur 1 : trio de 1
  t = settle(turn(t, LOW(2), LOW(1))); // joueur 2 : 9 puis 5, raté
  t = turn(t, LOW(1), LOW(1), LOW(1)); // joueur 0 : trio de 5, lié au 2
  assert.deepEqual([t.phase, t.winner, t.reason, t.trios[0]], ['over', 0, 'linked', [2, 5]]);
});

test('le trio de 7 fait gagner immédiatement dans les deux modes', () => {
  for (const mode of ['normal', 'spicy']) {
    const s = turn(tableB({ mode }), LOW(0), HIGH(1), C(0));
    assert.deepEqual([s.phase, s.winner, s.reason, s.outcome], ['over', 0, 'seven', 'trio'], mode);
    assert.deepEqual(s.trios[0], [7]);
    ok(s);
  }
  // un autre joueur que le premier peut le gagner, sans aucun 7 en main
  const s = turn(missTurn(missTurn(tableB({ first: 2 }), 1, 2), 1, 2), LOW(0), HIGH(1), C(0));
  assert.deepEqual([s.winner, s.reason], [0, 'seven']);
  const t = turn(missTurn(tableB({ first: 1 }), 1, 2), LOW(0), HIGH(1), C(0));
  assert.deepEqual([t.winner, t.reason], [2, 'seven'], 'gagné sans posséder de 7');
});

test('condition de victoire, à l\'unité', () => {
  assert.equal(victory([], 'normal'), null);
  assert.equal(victory([3, 9], 'normal'), null);
  assert.equal(victory([3, 9, 11], 'normal'), 'three');
  assert.equal(victory([7], 'normal'), 'seven');
  assert.equal(victory([7], 'spicy'), 'seven');
  assert.equal(victory([2, 5], 'spicy'), 'linked');
  assert.equal(victory([2, 9], 'spicy'), 'linked');
  assert.equal(victory([5, 9], 'spicy'), null);
  assert.equal(victory([2, 3, 6, 11], 'spicy'), null);
  assert.equal(victory([2, 3, 6, 11, 4], 'spicy'), 'linked');
  assert.deepEqual(winningPair([9, 4, 2]), [2, 9]);
  assert.equal(winningPair([9, 4]), null);
});

// ───────────────────────────────────────────── liaisons du mode Picante

test('la table des liaisons est complète et symétrique', () => {
  assert.deepEqual(validateLinks(LINKS), []);
  for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) assert.equal(linked(a, b), linked(b, a), `${a}–${b}`);
  assert.ok(linked(2, 5) && linked(5, 2) && linked(2, 9) && linked(9, 2), 'exemples des règles : 2–5 et 2–9');
  assert.deepEqual(LINKS[7], [], 'le 7 n\'est lié à rien : il gagne seul');
  // deux trios sont liés quand leur somme ou leur différence vaut 7
  for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) assert.equal(linked(a, b), a !== b && (a + b === 7 || Math.abs(a - b) === 7), `${a}–${b}`);
  assert.deepEqual(linkPairs(), [[1, 6], [1, 8], [2, 5], [2, 9], [3, 4], [3, 10], [4, 11], [5, 12]]);
});

test('une table de liaisons bancale est signalée', () => {
  assert.ok(validateLinks({ ...LINKS, 5: [12] }).some((m) => m.includes('2 est lié à 5')));
  assert.ok(validateLinks({ ...LINKS, 3: [3] }).length);
  assert.ok(validateLinks({ ...LINKS, 3: [4, 13] }).length);
  assert.ok(validateLinks({ 1: [] }).length);
});

// ───────────────────────────────────────────── confidentialité

test('la vue publique ne contient aucune valeur cachée', () => {
  const s = turn(tableA(), LOW(1), C(0));
  const view = publicView(s);
  assert.deepEqual(publicLeaks(view), []);
  assert.deepEqual(view.players.map((p) => p.cards), [9, 8, 9]);
  assert.deepEqual(view.picks, [{ v: 1, from: 'hand', seat: 1, end: 'low' }, { v: 3, from: 'center', slot: 0 }]);
  assert.deepEqual(view.center.map((c) => c.s), ['up', 'down', 'down', 'down', 'down', 'down', 'down', 'down', 'down']);
  // seules les valeurs révélées ou gagnées peuvent s'y lire
  const values = [...JSON.stringify(view).matchAll(/"v":(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(values.sort((a, b) => a - b), [1, 3, 3], 'le 1 révélé, et le 3 du centre (à son emplacement et dans les cartes du tour)');
  assert.ok(view.players.every((p) => p.trios.length === 0));
});

test('la vue publique ne dépend pas des cartes cachées', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rng = seeded(seed);
    let s = createGame({ names: names(3 + (seed % 4)), mode: seed % 2 ? 'normal' : 'spicy', firstPlayer: 0 }, rng);
    for (let i = 0; i < 80 && s.phase !== 'over'; i++) {
      s = s.phase === 'resolve' ? settle(s) : turn(s, smartMove(s, rng));
      assert.deepEqual(publicLeaks(publicView(s)), []);
      assert.deepEqual(publicView(scramble(s, rng)), publicView(s), 'deux donnes cachées différentes, même vue publique');
    }
  }
});

test('la vue privée : sa propre main, triée, et rien d\'autre', () => {
  const s = turn(tableA(), LOW(1));
  assert.deepEqual(privateView(s, 0), { seat: 0, hand: [1, 1, 2, 5, 5, 7, 8, 11, 12] });
  assert.deepEqual(privateView(s, 1), { seat: 1, hand: [2, 3, 3, 6, 7, 9, 10, 12] }, 'sans la carte révélée');
  assert.throws(() => privateView(s, 3));
  assert.throws(() => privateView(s, -1));
  const mine = JSON.stringify(privateView(s, 2));
  assert.ok(!mine.includes('center') && !mine.includes('hands'));
});

test('les modes sont bien ceux annoncés', () => {
  assert.deepEqual(Object.values(MODE), ['normal', 'spicy']);
});
