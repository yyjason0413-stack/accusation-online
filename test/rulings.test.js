'use strict';
// 設計者裁定（2026-11-13）回歸測試
const test = require('node:test');
const { Game } = require('../engine/engine');
const { scen, choose, pick, zone, card, isAction, hasOption, assert } = require('./helpers');
const D = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'];
const mk = f => (p0, p1, extra = {}) => scen(Object.assign({ factions: f, players: [Object.assign({ deck: D }, p0), Object.assign({ deck: D }, p1)] }, extra));
const opts = g => g.pending.options.map(o => o.cardId);

test('裁定1 回歸原始：雙方調度結束後才棄手牌（調度時手牌仍完整）', () => {
  const g = new Game({ seed: 3, factions: ['逐光者', '白狐神社'] }).start();
  assert.equal(g.pending.info, 'mulligan');
  assert.equal(g.P[0].hand.length, 6);
  assert.ok(g.P[0].hand.some(c => c.id === 'mot03'));
  g.answer(g.pending.player, []);
  assert.equal(g.pending.info, 'mulligan', '另一方仍在調度');
  assert.equal(g.P[0].hand.length + g.P[1].hand.length, 12, '尚未棄牌');
  g.answer(g.pending.player, []);
  assert.deepEqual(g.P[0].hand.map(c => c.id), ['mot03']);
});

test('裁定2 痛苦調味：星塵效果強制（必須選 1 個敵方儀式完成）', () => {
  const g = mk(['禁忌廚房', '白狐神社'])({ hand: ['kit21'], field: ['kit05', 'kit06', 'cro05'] }, { field: ['fox03'] });
  choose(g, '打出 痛苦調味'); pick(g, ['fox17'], 1);
  assert.equal(g.pending.type, 'pick'); assert.equal(g.pending.min, 1);
  pick(g, ['fox03']);
  assert.ok(zone(g, 1, 'score').includes('fox03'));
});

test('裁定3 誘蛾林道：一次襲擊只觸發一次（多個信徒參與也一樣）', () => {
  const g = mk(['逐光者', '白狐神社'])({ field: ['mot18', 'mot02', 'mot05', 'fox09'], discard: ['fox19', 'fox20'] }, { field: ['fox15'] });
  choose(g, '襲擊 神巫之間'); pick(g, ['mot05', 'fox09']);
  assert.match(g.pending.prompt, /誘蛾林道/);
  pick(g, ['fox19']);
  assert.ok(isAction(g), '沒有第二次誘蛾林道詢問');
  assert.equal(g.P[0].under.length, 1);
});

// 裁定4（冷藏櫃／餐廳經理由回合玩家選順序）沿用 kitchen.test.js 的「先結算：餐廳經理／冷藏櫃」兩個測試。

test('裁定5-7 資料庫管理員本身沒有解構，不能被選為啟動對象', () => {
  const g = mk(['門教團', '白狐神社'])({ hand: ['dor10'], field: ['dor15', 'dor16', 'dor02', 'dor05'] }, {});
  assert.equal(g.deconXOf(card(g, 0, 'dor10')), 0);
  choose(g, '打出 資料庫管理員');
  assert.deepEqual(opts(g), ['dor05']);
});

test('裁定5-12 相同效果可疊加（兩張上鎖的檔案庫各減 1）', () => {
  const g = mk(['門教團', '白狐神社'])({ field: ['dor02', 'dor15', 'dor15', 'dor05', 'dor06', 'dor10'] }, {});
  assert.equal(g.sym(0, '知識') >= 4, true);
  assert.equal(g.ritualReduction(card(g, 0, 'dor02')), 2);
});

test('裁定5-18 災厄比較用目前災厄（含加成）：逆向儀式', () => {
  // 敵方《毀滅計畫》除外 7 信徒 → 目前災厄 3；我方禁忌 3 不大於 3 → 只破壞不除外
  const ex = ['vir05', 'vir06', 'vir08', 'vir11', 'vir09', 'vir10', 'vir12'];
  const g = mk(['門教團', '疫病中心'])({ hand: ['dor21'], field: ['vir05', 'vir12', 'fox09', 'dor05', 'dor06'] }, { field: ['vir02'], exile: ex });
  assert.equal(g.ritualCalamity(1, card(g, 1, 'vir02')), 3);
  choose(g, '打出 逆向儀式'); pick(g, ['vir02']);
  assert.ok(zone(g, 1, 'discard').includes('vir02'));
  const g2 = mk(['門教團', '疫病中心'])({ hand: ['dor21'], field: ['vir05', 'vir12', 'fox09', 'dor05', 'dor06'] }, { field: ['vir02'], exile: ex.slice(0, 4) });
  choose(g2, '打出 逆向儀式'); pick(g2, ['vir02']);
  assert.ok(zone(g2, 1, 'exile').includes('vir02'), '災厄 2 < 禁忌 3 → 除外');
});

test('裁定5-21 鼠王：星塵效果獨立結算（基本效果除外後判定勝利）', () => {
  const g2 = mk(['紫靈山', '疫病中心'])({ hand: ['vir24'], field: ['cen01', 'cen15', 'cen19', 'cen20'], exile: ['cen05'] }, {});
  // 星塵需求 5-1-4=0 → 星塵啟動；除外蜈蚣智者後，除外區信徒 2 > 場上 0 → 勝利
  choose(g2, '打出 進化樣本-鼠王'); pick(g2, ['cen15']);
  assert.equal(g2.winner, 0);
});

test('裁定5-21 啟示：附著後星塵效果照常詢問（程式已移除「附著失敗即中止」）', () => {
  const g = mk(['疫病中心', '白狐神社'])({ hand: ['vir22'], field: ['vir05', 'vir12', 'vir16', 'fox17'] }, {});
  choose(g, '打出 進化樣本-啟示'); pick(g, ['vir05']);
  assert.match(g.pending.prompt, /星塵效果/);
});

test('裁定6 控制權：取得控制權的牌離場進入控制者的區域（破壞／除外／拿回手）', () => {
  const S = mk(['疫病中心', '白狐神社']);
  const mkCtrl = () => { const g = S({ field: ['vir13', 'vir16', 'vir06', 'vir11', 'vir04'] }, { field: ['fox05'] }); choose(g, '地點行動：扭曲書庫'); pick(g, ['fox05']); return g; };
  let g = mkCtrl(); let c = card(g, 0, 'fox05');
  assert.ok(g.P[0].all.includes(c) && !g.P[1].all.includes(c));
  g.destroy(c); assert.ok(zone(g, 0, 'discard').includes('fox05')); assert.equal(c.ctrlFrom, null);
  g = mkCtrl(); c = card(g, 0, 'fox05'); g.exile(c); assert.ok(zone(g, 0, 'exile').includes('fox05'));
  g = mkCtrl(); c = card(g, 0, 'fox05'); g.toHand(c); assert.ok(zone(g, 0, 'hand').includes('fox05'));
  // 獻祭到控制者儀式下，儀式離場 → 控制者棄牌區
  g = mkCtrl(); c = card(g, 0, 'fox05');
  const r = card(g, 0, 'vir04'); g.move(c, 'under'); c.underOf = r.uid; g.destroy(r);
  assert.ok(zone(g, 0, 'discard').includes('fox05'));
});

test('裁定6 深度催眠：附著魔法離場而信徒仍在場上時，控制權回到原持有者', () => {
  const g = mk(['瘋人院', '白狐神社'])({ hand: ['asy23'], field: ['asy05', 'asy06', 'asy07'] }, { field: ['fox13'] });
  choose(g, '打出 深度催眠'); pick(g, ['fox13']);
  const c = card(g, 0, 'fox13'); assert.equal(c.owner, 0);
  g.destroy(card(g, 0, 'asy23'));
  assert.equal(c.owner, 1); assert.ok(zone(g, 1, 'field').includes('fox13')); assert.equal(c.ctrlFrom, null);
  assert.ok(g.P[1].all.includes(c));
});

test('裁定6 原始樣本-寄生：魔法離場 → 恢復信徒且控制權歸還原持有者', () => {
  const g = mk(['疫病中心', '白狐神社'])({ hand: ['vir21'], field: ['vir05', 'vir06'] }, { field: [{ id: 'fox09', guilty: true }] });
  choose(g, '打出 原始樣本-寄生'); pick(g, ['fox09']);
  const c = card(g, 0, 'fox09');
  g.destroy(card(g, 0, 'vir21'));
  assert.equal(c.owner, 1); assert.equal(g.def(c).type, '信徒'); assert.equal(c.guilty, true);
});

test('裁定7-10 催眠師可以拿回自己', () => {
  const g = mk(['瘋人院', '白狐神社'])({ hand: ['asy21'], field: ['asy12', 'asy13', 'asy15'] }, {});
  choose(g, '打出 安眠藥');
  assert.ok(opts(g).includes('asy12'));
  pick(g, ['asy12']);
  assert.deepEqual(zone(g, 0, 'hand'), ['asy12']);
});

test('裁定7-15 狂亂質詢：回合玩家先選並破壞，之後對手才選', () => {
  const g = mk(['瘋人院', '白狐神社'])({ hand: ['asy20'], field: ['asy05', 'asy06'] }, { field: ['fox13', 'fox09'] });
  choose(g, '打出 狂亂質詢');
  assert.equal(g.pending.player, 0);
  pick(g, ['asy05'], 0);
  assert.ok(zone(g, 0, 'discard').includes('asy05'), '回合玩家的破壞先結算');
  assert.equal(g.pending.player, 1);
  pick(g, ['fox13'], 1);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox13']);
});

test('裁定8-2 零號病患：只影響敵方被附著的信徒', () => {
  const g = mk(['疫病中心', '白狐神社'])({ field: ['vir01', 'vir06', { id: 'vir20', attach: 'vir06' }] }, { field: ['fox06', { id: 'fox21', attach: 'fox06' }] });
  assert.equal(g.vol(card(g, 0, 'vir06')), 3, '我方被附著不受影響');
});

test('裁定8-4／8-20 被控制的敵方信徒除外 → 進入我方除外區並計入毀滅計畫', () => {
  const g = mk(['疫病中心', '白狐神社'])({ hand: ['vir07'], field: ['vir02', 'vir13', 'vir16', 'vir06', 'vir11', 'vir04'], discard: ['fox17', 'fox18'], exile: ['vir05', 'vir08', 'vir09'] }, { field: ['fox05'] });
  choose(g, '地點行動：扭曲書庫'); pick(g, ['fox05']);
  choose(g, '打出 感染的聖女'); pick(g, ['fox05']); pick(g, ['fox17', 'fox18']);
  assert.ok(zone(g, 0, 'exile').includes('fox05'));
  assert.equal(zone(g, 1, 'exile').length, 0);
  assert.equal(g.ritualReady(card(g, 0, 'vir02')), true, '除外區信徒 4（含被控制的敵方信徒）');
});
