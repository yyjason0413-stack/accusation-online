'use strict';
const assert = require('node:assert/strict');
const { Game, DEFS } = require('../engine/engine');

function scen(spec, seed = 7) { return new Game({ seed, factions: spec.factions || ['鴉教團', '白狐神社'] }).loadScenario(spec); }
const P = g => g.pending;
function labels(g) { return g.pending ? g.pending.options.map(o => o.label) : []; }
// 在 ask 選項中選擇包含 text 的選項
function choose(g, text, player) {
  const ch = g.pending;
  assert.ok(ch, `沒有待決定事項（想選 ${text}）`);
  assert.equal(ch.type, 'ask', `預期 ask，但為 pick：${ch.prompt}`);
  if (player != null) assert.equal(ch.player, player, `預期玩家 ${player} 決定：${ch.prompt}`);
  const i = ch.options.findIndex(o => o.label.includes(text));
  assert.ok(i >= 0, `找不到選項「${text}」，現有：${labels(g).join(' | ')}（${ch.prompt}）`);
  const r = g.answer(ch.player, [i]);
  assert.ok(r.ok, r.err);
}
// pick：以卡片 id 或名稱選擇
function pick(g, ids, player) {
  const ch = g.pending;
  assert.ok(ch, '沒有待決定事項');
  assert.equal(ch.type, 'pick', `預期 pick，但為 ask：${ch.prompt} / ${labels(g).join('|')}`);
  if (player != null) assert.equal(ch.player, player, `預期玩家 ${player} 決定：${ch.prompt}`);
  const used = new Set();
  const sel = ids.map(x => {
    const i = ch.options.findIndex((o, k) => !used.has(k) && (o.cardId === x || DEFS[o.cardId].name === x || o.uid === x));
    assert.ok(i >= 0, `pick 找不到 ${x}，現有：${labels(g).join('|')}（${ch.prompt}）`);
    used.add(i); return i;
  });
  const r = g.answer(ch.player, sel);
  assert.ok(r.ok, r.err + ' ' + ch.prompt);
}
function pickFail(g, ids) {
  const ch = g.pending;
  const sel = ids.map(x => ch.options.findIndex(o => o.cardId === x));
  return g.answer(ch.player, sel).ok;
}
const zone = (g, p, z) => g.P[p][z].map(c => c.id);
const card = (g, p, id) => g.P[p].field.find(c => c.id === id) || g.P[p].hand.find(c => c.id === id) || g.P[p].all.find(c => c.id === id);
function isAction(g, player = g.active) { return g.pending && g.pending.info === 'action' && g.pending.player === player; }
function hasOption(g, text) { return labels(g).some(l => l.includes(text)); }
function endTurn(g) { choose(g, '結束回合'); }
// 跳過回合結束的儀式詢問
function passRitual(g) { if (g.pending && g.pending.info === 'ritual') choose(g, '不執行'); }
module.exports = { scen, choose, pick, pickFail, zone, card, isAction, hasOption, endTurn, passRitual, labels, assert };
