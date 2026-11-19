'use strict';
// Cloudflare 版以「種子＋事件紀錄」重播重建房間：驗證引擎可決定性重播
const test = require('node:test');
const assert = require('node:assert');
const { Game, presetDeck } = require('../engine/engine');
const { aiAnswer, randomAnswer } = require('../engine/bots');
const FACS = ['白狐神社', '鴉教團', '逐光者', '禁忌廚房', '門教團', '瘋人院', '疫病中心', '紫靈山'];

function build(gs) {
  const g = new Game({ seed: gs.seed, decks: gs.decks, names: ['A', 'B'] });
  g.P.forEach((pl, i) => { pl.autoSkipCounter = gs.auto[i]; });
  g.start();
  for (const ev of gs.ev) {
    if (ev[0] === 'a') assert.ok(g.answer(ev[1], ev[2]).ok, 'replayed answer must be valid');
    else if (ev[0] === 'o') g.P[ev[1]].autoSkipCounter = ev[2];
  }
  return g;
}
test('seed + event log replays to identical state for all factions', () => {
  for (let n = 0; n < 48; n++) {
    const f0 = FACS[n % 8], f1 = FACS[(n * 3 + 1) % 8];
    const gs = { seed: 1000 + n, decks: [presetDeck(f0), presetDeck(f1)], auto: [n % 2 === 0, true], ev: [] };
    const g = build(gs);
    let steps = 0;
    while (g.pending && steps++ < 4000) {
      const p = g.pending.player;
      if (steps === 50) { gs.ev.push(['o', 0, !g.P[0].autoSkipCounter]); g.P[0].autoSkipCounter = gs.ev.at(-1)[2]; }
      let sel = n % 3 === 0 ? randomAnswer(g, g.pending) : aiAnswer(g, g.pending, p);
      let r = g.answer(p, sel.slice());
      if (!r.ok) { sel = randomAnswer(g, g.pending); r = g.answer(p, sel.slice()); }
      assert.ok(r.ok);
      gs.ev.push(['a', p, sel.slice()]);
      if (steps % 97 === 0 || !g.pending) {
        const h = build(JSON.parse(JSON.stringify(gs)));
        assert.deepStrictEqual(h.view(0), g.view(0));
        assert.deepStrictEqual(h.view(1), g.view(1));
      }
    }
  }
});
