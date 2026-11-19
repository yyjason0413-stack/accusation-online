'use strict';
const { Game, DATA, validateDeck, isAutomated, LEADER_FACTIONS } = require('../engine/engine');
function randomDeck(rng) {
  const autos = DATA.filter(c => isAutomated(c.id));
  const leaders = autos.filter(c => c.type === '教主');
  const L = leaders[Math.floor(rng() * leaders.length)];
  const rit = autos.filter(c => c.faction === L.faction && c.type === '儀式').map(c => c.id);
  const prim = autos.filter(c => c.faction === L.faction && !['教主', '儀式'].includes(c.type)).map(c => c.id);
  const facs = [...new Set(autos.map(c => c.faction))].filter(f => f !== L.faction && f !== '放逐者');
  const sec = rng() < 0.4 ? null : facs[Math.floor(rng() * facs.length)]; // 40%：其餘全用放逐者
  const pool2 = autos.filter(c => (c.faction === sec || c.faction === '放逐者') && !['教主', '儀式'].includes(c.type)).map(c => c.id);
  const sh = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const nPrim = rng() < 0.5 ? 12 : 12 + Math.floor(rng() * Math.min(9, prim.length - 11));
  const main = sh(prim).slice(0, nPrim).concat(sh(pool2).slice(0, 20 - nPrim));
  const deck = [L.id, ...rit, ...main];
  const v = validateDeck(deck);
  if (!v.ok) throw new Error('random deck invalid ' + v.errors);
  return deck;
}
const { randomAnswer, aiAnswer } = require('../engine/bots');
const N = Number(process.argv[2] || 500);
const mode = process.argv[3] || 'random';
const F = LEADER_FACTIONS;
let wins = [0, 0], reasons = {}, steps = 0, maxTurns = 0, errors = 0;
const usedCards = new Set();
for (let i = 0; i < N; i++) {
  const seed = 1000 + i;
  const fac = [F[i % F.length], F[Math.floor(i / F.length) % F.length]];
  let rs = seed;
  const rng = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  const mixed = i % 3 === 2;
  const g = mixed ? new Game({ seed, decks: [randomDeck(rng), randomDeck(rng)] }) : new Game({ seed, factions: fac });
  if (i % 4 === 1) g.P[1].autoSkipCounter = false;
  try {
    g.start();
    let k = 0;
    while (g.pending) {
      const ch = g.pending;
      const sel = (mode === 'ai' || (mode === 'mix' && ch.player === 0)) ? aiAnswer(g, ch, ch.player, rng) : randomAnswer(g, ch, rng);
      if (ch.info === 'action') { const o = ch.options[sel[0]]; if (o.cardId) usedCards.add(o.cardId); }
      const r = g.answer(ch.player, sel);
      if (!r.ok) throw new Error('bot answer rejected: ' + r.err + ' ' + ch.prompt + ' ' + JSON.stringify(sel));
      if (++k > 20000) throw new Error('too many steps');
      // 不變式檢查
      let tot = 0;
      for (const pl of g.P) {
        tot += pl.deck.length + pl.hand.length + pl.field.length + pl.conspiracy.length + pl.discard.length + pl.exile.length + pl.score.length + pl.stack.length + pl.under.length;
        for (const c of pl.all) if (!g.P[c.owner][c.zone].includes(c)) throw new Error('zone mismatch ' + c.id);
        for (const c of pl.all) if (c.ctrlFrom != null && !['field', 'under'].includes(c.zone)) throw new Error('control leak ' + c.id);
        for (const c of pl.field) if (c.guilty && c.guardAt) throw new Error('guilty guard');
      }
      if (tot !== 48) throw new Error('card count ' + tot);
    }
    steps += k;
    if (g.winner == null) throw new Error('ended without winner');
    wins[g.winner]++;
    const rkey = g.winReason.replace(/^\S+ /, '');
    reasons[rkey] = (reasons[rkey] || 0) + 1;
    maxTurns = Math.max(maxTurns, g.turnNo);
  } catch (e) {
    errors++;
    console.error('seed', seed, fac, e.stack);
    if (errors > 5) break;
  }
}
console.log({ N, mode, wins, reasons, avgSteps: steps / N, maxTurns, errors, cardsPlayedOrUsed: usedCards.size });
process.exit(errors ? 1 : 0);
