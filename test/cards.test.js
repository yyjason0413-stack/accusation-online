'use strict';
const test = require('node:test');
const { Game } = require('../engine/engine');
const { scen, choose, pick, pickFail, zone, card, isAction, hasOption, endTurn, passRitual, labels, assert } = require('./helpers');
const D = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17']; // 牌庫填充

// ================= 通用規則 =================
test('開局：教主在陰謀區、3 儀式在手、手牌 6 張、先手第一回合 1 行動', () => {
  const g = new Game({ seed: 3, factions: ['白狐神社', '鴉教團'] }).start();
  for (const p of [0, 1]) {
    assert.equal(g.P[p].hand.length, 6);
    assert.equal(g.P[p].conspiracy.length, 1);
    assert.equal(g.P[p].hand.filter(c => g.def(c).type === '儀式').length, 3);
    assert.equal(g.P[p].deck.length, 17);
  }
  const f = g.firstPlayer;
  assert.equal(g.pending.player, f);
  pick(g, [g.P[f].hand[0].id, g.P[f].hand[1].id]); // 調度 2 張
  assert.equal(g.P[f].hand.length, 6);
  pick(g, []);
  assert.ok(isAction(g, f));
  assert.equal(g.actionsLeft, 1);
  choose(g, '結束回合'); passRitual(g);
  assert.equal(g.actionsLeft, 2);
  assert.equal(g.P[f].hand.length, 8); // 回合結束抽 2（6 + 2）
});

test('襲擊：聲量合計 ≥ 守護才可襲擊，信徒變罪惡，地點被破壞', () => {
  const g = scen({ players: [{ field: ['cro05', 'cro14'], deck: D }, { field: ['fox19'], deck: D }] });
  assert.ok(hasOption(g, '襲擊 本殿'));
  choose(g, '襲擊 本殿');
  assert.equal(pickFail(g, ['cro14']), false); // 2 < 5
  pick(g, ['cro05', 'cro14']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox19']);
  assert.equal(card(g, 0, 'cro05').guilty, true);
  assert.equal(card(g, 0, 'cro14').guilty, false); // 鴉雛不會變為罪惡
  assert.equal(g.actionsLeft, 1);
});

test('襲擊：聲量不足時不能選擇襲擊；罪惡信徒不能襲擊', () => {
  const g = scen({ players: [{ field: ['cro14', { id: 'cro05', guilty: true }], deck: D }, { field: ['fox19'], deck: D }] });
  assert.equal(hasOption(g, '襲擊'), false);
});

test('控訴：手牌信徒聲量 ≥ 災厄可控訴；被控訴信徒留在場上但詠頌不結算，控訴者以罪惡上場', () => {
  const g = scen({ players: [{ hand: ['cro05'], deck: D }, { hand: ['fox13', 'fox14'], deck: D }] });
  choose(g, '打出 鴉仕女');
  assert.equal(g.pending.player, 1);
  assert.ok(hasOption(g, '狐渡'));
  assert.equal(hasOption(g, '櫻華'), false); // 聲量 1 < 3
  choose(g, '狐渡', 1);
  assert.deepEqual(zone(g, 0, 'discard'), []);
  assert.deepEqual(zone(g, 0, 'field'), ['cro05']);
  assert.equal(card(g, 0, 'cro05').guilty, false);
  assert.equal(card(g, 1, 'fox13').zone, 'field');
  assert.equal(card(g, 1, 'fox13').guilty, true);
  assert.equal(g.P[0].hand.length, 0); // 沒抽牌
});

test('控訴：地點行動被控訴，地點留在場上；儀式被控訴，留在場上不計分；魔法被控訴進棄牌區', () => {
  const g = scen({ players: [{ field: ['cro16', 'cro03', 'cro17', 'cro18'], deck: D }, { hand: ['fox13', 'fox09'], deck: D }] });
  choose(g, '地點行動：夜渡橋');
  choose(g, '狐渡', 1);
  assert.ok(zone(g, 0, 'field').includes('cro16'));
  assert.deepEqual(zone(g, 0, 'discard'), []);
  endTurn(g);
  assert.equal(g.pending.info, 'ritual');
  choose(g, '不執行');
  const g2 = scen({ players: [{ field: ['cro16', 'cro03', 'cro17', 'cro18'], deck: D }, { hand: ['fox09'], deck: D }] });
  endTurn(g2);
  choose(g2, '執行儀式 群鴉風暴');
  choose(g2, '白衣武士', 1);
  assert.ok(zone(g2, 0, 'field').includes('cro03'));
  assert.equal(g2.P[0].score.length, 0);
  const g3 = scen({ players: [{ hand: ['cro24'], deck: D }, { hand: ['fox13'], deck: D }] });
  choose(g3, '打出 鳴災'); choose(g3, '狐渡', 1);
  assert.deepEqual(zone(g3, 0, 'discard'), ['cro24']);
});

test('回合結束：執行儀式成功進入計分區，完成 2 個儀式獲勝', () => {
  const g = scen({ players: [{ field: ['cro03', 'cro16', 'cro17', 'cro18'], score: ['cro04'], deck: D }, { deck: D }] });
  endTurn(g);
  choose(g, '執行儀式 群鴉風暴');
  assert.equal(g.winner, 0);
  assert.equal(g.pending, null);
});

test('牌庫為空：回合結束無法執行儀式即落敗；可執行時必須執行', () => {
  const g = scen({ players: [{ deck: [] }, { deck: D }] });
  endTurn(g);
  assert.equal(g.winner, 1);
  const g2 = scen({ players: [{ field: ['cro03', 'cro16', 'cro17', 'cro18'], deck: [] }, { hand: ['fox09'], deck: D }] });
  endTurn(g2);
  assert.equal(hasOption(g2, '不執行'), false);
  choose(g2, '執行儀式');
  choose(g2, '白衣武士', 1); // 被控訴不判敗
  assert.equal(g2.winner, null);
  assert.ok(isAction(g2, 1));
});

test('手牌上限 6：回合結束棄到 6 張再抽 2', () => {
  const g = scen({ players: [{ hand: ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox18', 'fox18'], deck: D }, { deck: D }] });
  endTurn(g);
  pick(g, ['fox18', 'fox18']);
  assert.equal(g.P[0].hand.length, 8);
  assert.deepEqual(zone(g, 0, 'discard'), ['fox18', 'fox18']);
});

test('特殊行動：花 2 行動將棄牌區儀式放回場上；只有 1 行動時不可用', () => {
  const g = scen({ players: [{ discard: ['cro03'], hand: ['fox17'], deck: D }, { deck: D }] });
  assert.ok(hasOption(g, '特殊行動'));
  choose(g, '打出 神隱之森');
  assert.equal(hasOption(g, '特殊行動'), false);
  const g2 = scen({ players: [{ discard: ['cro03'], deck: D }, { deck: D }] });
  choose(g2, '特殊行動');
  assert.deepEqual(zone(g2, 0, 'field'), ['cro03']);
  assert.equal(g2.actionsLeft, 0);
});

test('教主：需任一方計分區已有儀式才能從陰謀區打出，花 1 行動', () => {
  const g0 = scen({ players: [{ conspiracy: ['cro01'], deck: D }, { deck: D }] });
  assert.equal(hasOption(g0, '打出 第十三夜'), false);
  const g = scen({ players: [{ conspiracy: ['cro01'], deck: D }, { score: ['fox03'], deck: D }] });
  choose(g, '打出 第十三夜');
  assert.deepEqual(zone(g, 0, 'field'), ['cro01']);
  assert.equal(g.actionsLeft, 1);
});

test('星塵：非罪惡信徒才提供星塵；罪惡信徒仍提供符號', () => {
  const g = scen({ players: [{ field: ['cro05', { id: 'cro07', guilty: true }], deck: D }, { deck: D }] });
  assert.equal(g.stardust(0), 1);
  assert.equal(g.sym(0, '夜幕'), 2);
});

// ================= 鴉教團 =================
test('cro01 第十三夜：觸發詠頌抽 1；快速行動棄 2 張拿回另外 1 張（每回合一次）', () => {
  const g = scen({ players: [{ field: ['cro01'], hand: ['cro05', 'fox17', 'fox18'], discard: ['cro24'], deck: D }, { deck: D }] });
  choose(g, '打出 鴉仕女');
  assert.equal(g.P[0].hand.length, 4); // 2 + 第十三夜 1 + 鴉仕女 1
  choose(g, '快速行動');
  pick(g, ['fox17', 'fox18']);
  assert.equal(g.pending.options.some(o => o.cardId === 'fox18'), false); // 不能拿回剛棄的牌
  pick(g, ['cro24']);
  assert.ok(zone(g, 0, 'hand').includes('cro24'));
  assert.equal(hasOption(g, '快速行動'), false);
});

test('cro01 第十三夜：詠頌被控訴時不抽牌；不在場上（陰謀區）時無效', () => {
  const g = scen({ players: [{ field: ['cro01'], hand: ['cro05'], deck: D }, { hand: ['fox13'], deck: D }] });
  choose(g, '打出 鴉仕女'); choose(g, '狐渡', 1);
  assert.equal(g.P[0].hand.length, 0);
  assert.ok(zone(g, 0, 'field').includes('cro05'));
  const g2 = scen({ players: [{ conspiracy: ['cro01'], hand: ['cro05'], deck: D }, { deck: D }] });
  choose(g2, '打出 鴉仕女');
  assert.equal(g2.P[0].hand.length, 1);
});

test('cro02 黑色葬禮：4 凋零且棄牌區至少 4 信徒', () => {
  const f = ['cro02', 'cro19', 'cro20', 'cro13'];
  let g = scen({ players: [{ field: f, discard: ['cro05', 'cro06', 'cro07', 'cro08'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'cro02')), true);
  g = scen({ players: [{ field: f, discard: ['cro05', 'cro06', 'cro07', 'cro21'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'cro02')), false);
});

test('cro03 群鴉風暴：場上至少 3 地點', () => {
  let g = scen({ players: [{ field: ['cro03', 'cro16', 'cro17'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'cro03')), false);
  g = scen({ players: [{ field: ['cro03', 'cro16', 'cro17', 'fox17'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'cro03')), true);
});

test('cro04 無聲奉獻：場上至少 4 個夜幕信徒（看信徒數量非符號數）', () => {
  let g = scen({ players: [{ field: ['cro04', 'cro05', 'cro06', 'cro07', 'cro16'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'cro04')), false);
  g = scen({ players: [{ field: ['cro04', 'cro05', 'cro06', 'cro07', { id: 'cro10', guilty: true }], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'cro04')), true);
});

test('cro05 鴉仕女：詠頌抽 1', () => {
  const g = scen({ players: [{ hand: ['cro05'], deck: D }, { deck: D }] });
  choose(g, '打出 鴉仕女');
  assert.deepEqual(zone(g, 0, 'hand'), ['fox17']);
});

test('cro06 鴉司祭：將手牌信徒放到場上並觸發其詠頌，該詠頌不可被控訴、不能駐守', () => {
  const g = scen({ players: [{ hand: ['cro06', 'cro05', 'fox11'], field: ['fox17'], deck: D }, { hand: ['fox13'], deck: D }] });
  choose(g, '打出 鴉司祭');
  choose(g, '不控訴', 1);
  pick(g, ['cro05']);
  assert.ok(isAction(g, 0)); // 沒有再詢問控訴
  assert.deepEqual(zone(g, 0, 'field'), ['fox17', 'cro06', 'cro05']);
  assert.equal(g.P[0].hand.length, 2);
  const g2 = scen({ players: [{ hand: ['cro06', 'fox11'], field: ['fox17'], deck: D }, { deck: D }] });
  choose(g2, '打出 鴉司祭'); pick(g2, ['fox11']);
  assert.ok(isAction(g2, 0)); // 沒有駐守詢問
  assert.equal(g2.P[1].cannotAttackTurn, g2.turnNo + 1);
});

test('cro07 信使：抽 1，雙方各棄 1', () => {
  const g = scen({ players: [{ hand: ['cro07', 'fox18'], deck: D }, { hand: ['fox14', 'fox13'], deck: D }] });
  choose(g, '打出 信使'); choose(g, '不控訴', 1);
  pick(g, ['fox18'], 0);
  pick(g, ['fox14'], 1);
  assert.deepEqual(zone(g, 0, 'hand'), ['fox17']);
  assert.deepEqual(zone(g, 1, 'hand'), ['fox13']);
});

test('cro08 烏血醫生：將場上 1 個信徒變為罪惡', () => {
  const g = scen({ players: [{ hand: ['cro08'], deck: D }, { field: ['fox13'], deck: D }] });
  choose(g, '打出 烏血醫生'); pick(g, ['fox13']);
  assert.equal(card(g, 1, 'fox13').guilty, true);
});

test('cro09 失眠掘墓人：拿回聲量 3 以下信徒；即使有墓園也不觸發該信徒詠頌（原作者裁定）', () => {
  const g = scen({ players: [{ hand: ['cro09'], discard: ['cro05', 'cro10'], deck: D }, { field: ['fox02'], deck: D }] });
  choose(g, '打出 失眠掘墓人');
  assert.equal(g.pending.options.some(o => o.cardId === 'cro05'), false); // 聲量 4 不可
  pick(g, ['cro10']);
  assert.ok(isAction(g)); // 無墓園：不觸發
  assert.deepEqual(zone(g, 1, 'field'), ['fox02']);
  const g2 = scen({ players: [{ hand: ['cro09'], field: ['cro20'], discard: ['cro10'], deck: D }, { field: ['fox02'], deck: D }] });
  choose(g2, '打出 失眠掘墓人'); pick(g2, ['cro10']);
  assert.ok(isAction(g2));
  assert.deepEqual(zone(g2, 1, 'field'), ['fox02']);
  assert.deepEqual(zone(g2, 0, 'hand'), ['cro10']);
});

test('cro10 迷路的亡魂：破壞敵方 1 個儀式；祈願之子(3 自然)保護', () => {
  const g = scen({ players: [{ hand: ['cro10'], deck: D }, { field: ['fox03'], deck: D }] });
  choose(g, '打出 迷路的亡魂'); pick(g, ['fox03']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox03']);
  const g2 = scen({ players: [{ hand: ['cro10'], deck: D }, { field: ['fox03', 'fox10', 'fox18'], deck: D }] });
  choose(g2, '打出 迷路的亡魂'); pick(g2, ['fox03']);
  assert.ok(zone(g2, 1, 'field').includes('fox03'));
});

test('cro11 割舌的僧侶：無法控訴；每 3 夜幕魔法災厄 +1（罪惡時無效）', () => {
  const g = scen({ players: [{ field: ['cro11', 'cro05', 'cro07', 'cro03'], hand: ['cro24'], deck: D }, { hand: ['fox13'], deck: D }] });
  assert.equal(g.magicCalamity(0, card(g, 0, 'cro24'), true), 4);
  choose(g, '打出 鳴災');
  assert.equal(g.pending.player, 0); // 狐渡聲量 3 < 災厄 4，無法控訴
  const g2 = scen({ players: [{ hand: ['cro05'], deck: D }, { hand: ['cro11'], deck: D }], factions: ['鴉教團', '鴉教團'] });
  choose(g2, '打出 鴉仕女');
  assert.ok(isAction(g2, 0)); // 沒有可控訴的牌
  const g3 = scen({ players: [{ field: [{ id: 'cro11', guilty: true }, 'cro05', 'cro07', 'cro03'], hand: ['cro24'], deck: D }, { deck: D }] });
  assert.equal(g3.magicCalamity(0, card(g3, 0, 'cro24'), false), 3);
});

test('cro12 鐘塔守衛：控訴時將棄牌區 1 個地點拿回手', () => {
  const g = scen({ players: [{ hand: ['fox11'], deck: D }, { hand: ['cro12'], discard: ['cro16'], deck: D }], factions: ['白狐神社', '鴉教團'] });
  choose(g, '打出 燈籠巡遊'); choose(g, '鐘塔守衛', 1); pick(g, ['cro16'], 1);
  assert.deepEqual(zone(g, 1, 'hand'), ['cro16']);
  assert.equal(card(g, 1, 'cro12').guilty, true);
});

test('cro13 灰眼童：控訴時破壞自己場上 1 個信徒（不會破壞自身）', () => {
  const g = scen({ players: [{ hand: ['fox11'], deck: D }, { hand: ['cro13'], field: ['cro05'], deck: D }], factions: ['白狐神社', '鴉教團'] });
  choose(g, '打出 燈籠巡遊'); choose(g, '灰眼童', 1);
  assert.deepEqual(g.pending.options.map(o => o.cardId), ['cro05']);
  pick(g, ['cro05'], 1);
  assert.deepEqual(zone(g, 1, 'field'), ['cro13']);
  const g2 = scen({ players: [{ hand: ['fox11'], deck: D }, { hand: ['cro13'], deck: D }], factions: ['白狐神社', '鴉教團'] });
  choose(g2, '打出 燈籠巡遊'); choose(g2, '灰眼童', 1);
  assert.deepEqual(zone(g2, 1, 'field'), ['cro13']);
});

test('cro14 鴉雛：棄 2 張手牌，拿回棄牌區另外 1 張；不會變為罪惡（含控訴時）', () => {
  const g = scen({ players: [{ hand: ['cro14', 'fox17', 'fox18'], discard: ['cro21'], deck: D }, { deck: D }] });
  choose(g, '打出 鴉雛'); pick(g, ['fox17', 'fox18']); pick(g, ['cro21']);
  assert.deepEqual(zone(g, 0, 'hand'), ['cro21']);
  const g2 = scen({ players: [{ hand: ['fox11'], deck: D }, { hand: ['cro14'], deck: D }], factions: ['白狐神社', '鴉教團'] });
  choose(g2, '打出 燈籠巡遊'); choose(g2, '鴉雛', 1);
  assert.equal(card(g2, 1, 'cro14').guilty, false);
  assert.equal(card(g2, 1, 'cro14').zone, 'field');
});

test('cro15 黑夫人：每 3 凋零，敵方棄 1 張（敵方自選）', () => {
  const g = scen({ players: [{ hand: ['cro15'], field: ['cro19', 'cro20'], deck: D }, { hand: ['fox17', 'fox18'], deck: D }] });
  choose(g, '打出 黑夫人'); pick(g, ['fox18'], 1);
  assert.deepEqual(zone(g, 1, 'hand'), ['fox17']);
  const g2 = scen({ players: [{ hand: ['cro15'], field: ['cro19'], deck: D }, { hand: ['fox17'], deck: D }] });
  choose(g2, '打出 黑夫人');
  assert.ok(isAction(g2, 0));
});

test('cro16 夜渡橋：每 2 禁忌破壞場上 1 個信徒（行動者選）', () => {
  const g = scen({ players: [{ field: ['cro16', 'cro17', 'cro11', 'cro08'], deck: D }, { field: ['fox13', 'fox09'], deck: D }] });
  // 禁忌：鐘塔1 + 割舌1 + 烏血1 = 3 → 1 次
  choose(g, '地點行動：夜渡橋'); pick(g, ['fox13']);
  assert.ok(isAction(g));
  assert.deepEqual(zone(g, 1, 'field'), ['fox09']);
});

test('cro17 鐘塔：雙方信徒控訴後被破壞', () => {
  const g = scen({ players: [{ hand: ['cro05'], field: ['cro17'], deck: D }, { hand: ['fox13'], deck: D }] });
  choose(g, '打出 鴉仕女'); choose(g, '狐渡', 1);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox13']);
  assert.deepEqual(zone(g, 0, 'field'), ['cro17', 'cro05']);
});

test('cro18 巢修道院：4 知識時每回合第一個詠頌額外觸發 1 次', () => {
  const g = scen({ players: [{ hand: ['cro05', 'cro05'], field: ['cro18', 'cro06', 'cro14', 'cro04'], deck: D }, { deck: D }] });
  // 知識：巢修道院1 + 鴉司祭1 + 鴉雛1 + 無聲奉獻1 = 4
  choose(g, '打出 鴉仕女');
  assert.equal(g.P[0].hand.length, 3); // 1 + 2
  choose(g, '打出 鴉仕女');
  assert.equal(g.P[0].hand.length, 3); // 3-1+1：第二次不再額外觸發
});

test('cro18 巢修道院 + 鴉司祭 + 鴉雛（QA）：結算完鴉雛後額外觸發鴉司祭', () => {
  const g = scen({ players: [{ hand: ['cro06', 'cro14', 'cro05', 'fox17', 'fox18'], field: ['cro18', 'cro04'], discard: ['cro21'], deck: D }, { deck: D }] });
  // 知識：巢1 + 無聲1 + 鴉司祭1 + 鴉雛1 = 4（鴉雛上場後）
  choose(g, '打出 鴉司祭'); pick(g, ['cro14']);
  pick(g, ['fox17', 'fox18']); pick(g, ['cro21']);
  // 額外觸發鴉司祭
  assert.match(g.pending.prompt, /鴉司祭/);
  pick(g, ['cro05']);
  assert.ok(zone(g, 0, 'field').includes('cro05'));
});

test('cro19 羽墓園：每 1 凋零拿回 1 信徒，然後破壞此地點', () => {
  const g = scen({ players: [{ field: ['cro19', 'cro15'], discard: ['cro05', 'cro06', 'cro07'], deck: D }, { deck: D }] });
  choose(g, '地點行動：羽墓園'); pick(g, ['cro05']); pick(g, ['cro06']);
  assert.deepEqual(zone(g, 0, 'hand'), ['cro05', 'cro06']);
  assert.ok(zone(g, 0, 'discard').includes('cro19'));
});

test('cro20 湖畔墓園：棄牌區每 2 信徒拿回 1 魔法，然後破壞此地點', () => {
  const g = scen({ players: [{ field: ['cro20'], discard: ['cro05', 'cro06', 'cro07', 'cro21', 'cro22'], deck: D }, { deck: D }] });
  choose(g, '地點行動：湖畔墓園'); pick(g, ['cro22']);
  assert.ok(isAction(g));
  assert.deepEqual(zone(g, 0, 'hand'), ['cro22']);
  assert.ok(zone(g, 0, 'discard').includes('cro20'));
});

test('cro21 黯燭：破壞場上 1 張非教主牌；星塵 3 時災厄 +2', () => {
  const g = scen({ players: [{ hand: ['cro21'], deck: D }, { field: ['fox01', 'fox19'], hand: ['fox13'], deck: D }] });
  choose(g, '打出 黯燭');
  assert.match(g.pending.prompt, /災厄 1/);
  choose(g, '不控訴', 1);
  assert.deepEqual(g.pending.options.map(o => o.cardId), ['fox19']);
  pick(g, ['fox19']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox19']);
  const g2 = scen({ players: [{ hand: ['cro21'], field: ['cro05', 'cro06', 'cro07'], deck: D }, { hand: ['fox09'], deck: D }] });
  assert.equal(g2.magicCalamity(0, card(g2, 0, 'cro21'), true), 3);
  choose(g2, '打出 黯燭');
  assert.equal(g2.pending.player, 0); // 災厄 3 > 白衣武士 2，無法控訴，直接選目標
});

test('cro22 烏骨療法：解除 1 信徒罪惡；星塵可將 1 信徒變罪惡', () => {
  const g = scen({ players: [{ hand: ['cro22'], field: [{ id: 'cro05', guilty: true }, 'cro06', 'cro07'], deck: D }, { field: ['fox13'], deck: D }] });
  choose(g, '打出 烏骨療法'); pick(g, ['cro05']); pick(g, ['fox13']);
  assert.equal(card(g, 0, 'cro05').guilty, false);
  assert.equal(card(g, 1, 'fox13').guilty, true);
});

test('cro23 失聲詛咒：本回合敵方無法控訴詠頌（魔法仍可）；星塵改為無法控訴', () => {
  const g = scen({ players: [{ hand: ['cro23', 'cro05', 'cro24'], deck: D }, { hand: ['fox13', 'fox06'], deck: D }] });
  choose(g, '打出 失聲詛咒'); choose(g, '不控訴', 1);
  choose(g, '打出 鴉仕女');
  assert.ok(isAction(g, 0));
  const g2 = scen({ players: [{ hand: ['cro23', 'cro24'], field: ['cro05', 'cro06', 'cro07', 'cro08'], deck: D }, { hand: ['fox13', 'fox06'], deck: D }] });
  choose(g2, '打出 失聲詛咒'); choose(g2, '不控訴', 1);
  choose(g2, '打出 鳴災');
  assert.equal(g2.pending.player, 0); // 敵方無法控訴，直接進入選擇
});

test('cro24 鳴災：破壞至多 2 罪惡信徒；星塵可改為除外', () => {
  const g = scen({ players: [{ hand: ['cro24'], deck: D }, { field: [{ id: 'fox13', guilty: true }, { id: 'fox09', guilty: true }, 'fox12'], deck: D }] });
  choose(g, '打出 鳴災');
  assert.equal(g.pending.options.length, 2);
  pick(g, ['fox13', 'fox09']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox13', 'fox09']);
  const g2 = scen({ players: [{ hand: ['cro24'], field: ['cro05', 'cro06', 'cro07'], deck: D }, { field: [{ id: 'fox13', guilty: true }], deck: D }] });
  choose(g2, '打出 鳴災'); choose(g2, '除外'); pick(g2, ['fox13']);
  assert.deepEqual(zone(g2, 1, 'exile'), ['fox13']);
});

// ================= 白狐神社 =================
const F = ['白狐神社', '鴉教團'];
test('fox01 雪白尾：執行儀式災厄 +1；快速行動從牌庫/棄牌區找荒野上場', () => {
  const g = scen({ factions: F, players: [{ field: ['fox01', 'fox03'], deck: ['fox17', 'fox05'], discard: ['fox18'], deck2: [] }, { deck: D }] });
  assert.equal(g.ritualCalamity(0, card(g, 0, 'fox03')), 3);
  choose(g, '快速行動');
  assert.deepEqual(g.pending.options.map(o => o.cardId).sort(), ['fox17', 'fox18']);
  pick(g, ['fox17']);
  assert.ok(zone(g, 0, 'field').includes('fox17'));
  assert.equal(hasOption(g, '快速行動'), false);
  assert.equal(g.actionsLeft, 2);
});

test('fox02 狐嫁夜：5 野性且場上有雪白尾或祈願之子', () => {
  let g = scen({ factions: F, players: [{ field: ['fox02', 'fox17', 'fox16', 'fox13', 'fox19', 'fox05'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'fox02')), false);
  g = scen({ factions: F, players: [{ field: ['fox02', 'fox17', 'fox16', 'fox13', 'fox19', 'fox10'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'fox02')), true);
});

test('fox03 稻魂祭：5 自然（稻原提供 2 自然）', () => {
  // 儀式本身在場上也提供符號（稻魂祭 1 自然）
  let g = scen({ factions: F, players: [{ field: ['fox03', 'fox18', 'fox17'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'fox03')), false);
  g = scen({ factions: F, players: [{ field: ['fox03', 'fox18', 'fox17', 'fox14'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'fox03')), true);
});

test('fox04 返靈舞：地點守護總和（含駐守）≥ 18', () => {
  let g = scen({ factions: F, players: [{ field: ['fox04', 'fox19', 'fox20', 'fox15'], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'fox04')), false);
  g = scen({ factions: F, players: [{ field: ['fox04', 'fox19', 'fox20', 'fox15', { id: 'fox08', guard: 'fox19' }], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'fox04')), true);
});

test('fox05 神巫：每 2 夜幕拿回 1 地點', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox05'], field: ['fox18', 'fox20', 'fox09'], discard: ['fox19', 'fox17'], deck: D }, { deck: D }] });
  choose(g, '打出 神巫'); pick(g, ['fox19']);
  assert.deepEqual(zone(g, 0, 'hand'), ['fox19']);
  assert.ok(isAction(g));
});

test('fox06 神隱修士：2 聖地時完成場上 1 儀式，然後破壞 1 聖地', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox06'], field: ['fox19', 'fox20', 'fox03'], deck: D }, { deck: D }] });
  choose(g, '打出 神隱修士'); pick(g, ['fox03']); pick(g, ['fox20']);
  assert.deepEqual(zone(g, 0, 'score'), ['fox03']);
  assert.deepEqual(zone(g, 0, 'discard'), ['fox20']);
  const g2 = scen({ factions: F, players: [{ hand: ['fox06'], field: ['fox19', 'fox03'], deck: D }, { deck: D }] });
  choose(g2, '打出 神隱修士');
  assert.equal(g2.P[0].score.length, 0);
});

test('fox07 焚香師：破壞自己 1 荒野，再破壞對方至多 2 個聲量總和 ≤ 守護的信徒', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox07'], field: ['fox17'], deck: D }, { field: ['cro14', 'cro10', 'cro05'], deck: D }] });
  choose(g, '打出 焚香師'); pick(g, ['fox17']);
  assert.equal(pickFail(g, ['cro14', 'cro10']), false); // 4 > 3
  pick(g, ['cro14']);
  assert.deepEqual(zone(g, 1, 'discard'), ['cro14']);
  assert.deepEqual(zone(g, 0, 'discard'), ['fox17']);
});

test('fox08 稻草人：駐守 3；你場上的荒野不會被襲擊（罪惡時失效）', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox08'], field: ['fox19'], deck: D }, { deck: D }] });
  choose(g, '打出 稻草人'); choose(g, '駐守 本殿');
  assert.equal(g.locGuard(card(g, 0, 'fox19')), 8);
  const g2 = scen({ factions: ['鴉教團', '白狐神社'], players: [{ field: ['cro05'], deck: D }, { field: ['fox17', 'fox08'], deck: D }] });
  assert.equal(hasOption(g2, '襲擊 神隱之森'), false);
  const g3 = scen({ factions: ['鴉教團', '白狐神社'], players: [{ field: ['cro05'], deck: D }, { field: ['fox17', { id: 'fox08', guilty: true }], deck: D }] });
  assert.ok(hasOption(g3, '襲擊 神隱之森'));
});

test('fox09 白衣武士：駐守 2；每 1 夜幕襲擊聲量 +1', () => {
  const g = scen({ factions: F, players: [{ field: ['fox09', 'fox18'], deck: D }, { field: ['cro19'], deck: D }] });
  // 夜幕：白衣武士1 + 稻原1 = 2 → 襲擊聲量 4 < 6
  assert.equal(g.attackVolume(card(g, 0, 'fox09')), 4);
  assert.equal(hasOption(g, '襲擊 羽墓園'), false);
  const g2 = scen({ factions: F, players: [{ field: ['fox09', 'fox18', 'fox20', 'fox11'], deck: D }, { field: ['cro19'], deck: D }] });
  assert.equal(g2.attackVolume(card(g2, 0, 'fox09')), 6);
  choose(g2, '襲擊 羽墓園'); pick(g2, ['fox09']);
  assert.deepEqual(zone(g2, 1, 'discard'), ['cro19']);
});

test('fox10 祈願之子：駐守 2；3 自然時儀式不會被破壞與除外', () => {
  const g = scen({ players: [{ hand: ['cro21'], field: ['cro05', 'cro06', 'cro07'], deck: D }, { field: ['fox03', 'fox10', 'fox18', 'fox17'], deck: D }] });
  choose(g, '打出 黯燭'); pick(g, ['fox03']);
  assert.ok(zone(g, 1, 'field').includes('fox03'));
  const g2 = scen({ factions: F, players: [{ hand: ['fox10'], field: ['fox17'], deck: D }, { deck: D }] });
  choose(g2, '打出 祈願之子'); choose(g2, '駐守 神隱之森');
  assert.equal(g2.locGuard(card(g2, 0, 'fox17')), 5);
});

test('fox11 燈籠巡遊：目標敵方下一回合無法襲擊；駐守 2', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox11'], field: ['fox19'], deck: D }, { field: ['cro05', 'cro13'], deck: D }] });
  choose(g, '打出 燈籠巡遊'); choose(g, '駐守 本殿');
  assert.equal(g.locGuard(card(g, 0, 'fox19')), 7);
  endTurn(g);
  assert.ok(isAction(g, 1));
  assert.equal(hasOption(g, '襲擊'), false);
  endTurn(g); endTurn(g);
  assert.ok(isAction(g, 1));
  assert.ok(hasOption(g, '襲擊 本殿')); // 再下一回合恢復
});

test('fox12 面守：駐守 2；場上每有 1 駐守中信徒，控訴聲量 +2', () => {
  const g = scen({ players: [{ hand: ['cro05'], deck: D }, { hand: ['fox12'], field: ['fox17', { id: 'fox08', guard: 'fox17' }], deck: D }] });
  assert.equal(g.counterVolume(card(g, 1, 'fox12')), 4);
  choose(g, '打出 鴉仕女');
  assert.ok(hasOption(g, '面守'));
});

test('fox13 狐渡：雙方場上每有 1 個橋，控訴聲量 +2', () => {
  const g = scen({ players: [{ field: ['cro16'], hand: ['cro05'], deck: D }, { hand: ['fox13'], field: ['fox16'], deck: D }] });
  assert.equal(g.counterVolume(card(g, 1, 'fox13')), 7);
});

test('fox14 櫻華：駐守 1；不會變為罪惡', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox14'], field: ['fox17'], deck: D }, { field: ['fox18'], deck: D }] });
  choose(g, '打出 櫻華'); choose(g, '駐守 神隱之森');
  assert.equal(g.locGuard(card(g, 0, 'fox17')), 4);
  assert.equal(hasOption(g, '襲擊 稻原'), false); // 襲擊聲量 1 < 2
});

test('fox14 櫻華：襲擊後不會變為罪惡', () => {
  const g = scen({ factions: F, players: [{ field: ['fox14', 'fox09'], deck: D }, { field: ['fox17'], deck: D }], });
  choose(g, '襲擊 神隱之森'); pick(g, ['fox14', 'fox09']);
  assert.equal(card(g, 0, 'fox14').guilty, false);
  assert.equal(card(g, 0, 'fox09').guilty, true);
});

test('fox15 神巫之間：每 2 知識解除 1 信徒罪惡並啟動其駐守', () => {
  const g = scen({ factions: F, players: [{ field: ['fox15', 'fox19', 'fox06', { id: 'fox08', guilty: true }], deck: D }, { deck: D }] });
  // 知識：神巫之間1 + 神隱修士1 = 2
  choose(g, '地點行動：神巫之間'); pick(g, ['fox08']); choose(g, '駐守 本殿');
  assert.equal(card(g, 0, 'fox08').guilty, false);
  assert.equal(g.locGuard(card(g, 0, 'fox19')), 8);
});

test('fox16 狐尾橋：每 3 野性，執行儀式災厄 +1', () => {
  const g = scen({ factions: F, players: [{ field: ['fox16', 'fox03', 'fox17', 'fox13'], deck: D }, { deck: D }] });
  assert.equal(g.ritualCalamity(0, card(g, 0, 'fox03')), 3);
});

test('fox17 神隱之森 / fox18 稻原：無效果荒野，提供符號；可被雪白尾找出', () => {
  const g = scen({ factions: F, players: [{ field: ['fox17', 'fox18'], deck: D }, { deck: D }] });
  assert.deepEqual(g.symbolsAll(0), { '自然': 3, '野性': 1, '夜幕': 1 });
  assert.equal(g.def(card(g, 0, 'fox17')).locAction, undefined);
});

test('fox19 本殿：從棄牌區或牌庫找至多 1 儀式放上場', () => {
  const g = scen({ factions: F, players: [{ field: ['fox19'], deck: ['fox17', 'fox02', 'fox17'], discard: ['fox03'] }, { deck: D }] });
  choose(g, '地點行動：本殿'); pick(g, ['fox02']);
  assert.ok(zone(g, 0, 'field').includes('fox02'));
  assert.equal(g.P[0].deck.length, 2);
});

test('fox20 遺忘神龕：守護 ≥ 10 時完成場上 1 儀式，然後破壞此地點', () => {
  const g = scen({ factions: F, players: [{ field: ['fox20', 'fox03', { id: 'fox08', guard: 'fox20' }, { id: 'fox09', guard: 'fox20' }], deck: D }, { deck: D }] });
  // 守護 5 + 3 + 2 = 10
  choose(g, '地點行動：遺忘神龕'); pick(g, ['fox03']);
  assert.deepEqual(zone(g, 0, 'score'), ['fox03']);
  assert.ok(zone(g, 0, 'discard').includes('fox20'));
  const g2 = scen({ factions: F, players: [{ field: ['fox20', 'fox03'], deck: D }, { deck: D }] });
  choose(g2, '地點行動：遺忘神龕');
  assert.equal(g2.P[0].score.length, 0);
  assert.ok(zone(g2, 0, 'field').includes('fox20'));
});

test('fox21 狐火：破壞 1 個聲量 ≤3 信徒；星塵可額外破壞 1 個聲量 ≤2', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox21'], field: ['fox08', 'fox09', 'fox12'], deck: D }, { field: ['cro05', 'cro07', 'cro10'], deck: D }] });
  choose(g, '打出 狐火');
  assert.equal(g.pending.options.some(o => o.cardId === 'cro05'), false);
  pick(g, ['cro07']); pick(g, ['cro10']);
  assert.deepEqual(zone(g, 1, 'field'), ['cro05']);
});

test('fox22 魂燈：敵方可棄 1 信徒否則隨機棄 1；星塵拿回 1 信徒', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox22'], field: ['fox08', 'fox09', 'fox12'], discard: ['fox13'], deck: D }, { hand: ['cro05', 'cro21'], deck: D }] });
  choose(g, '打出 魂燈'); choose(g, '不控訴', 1); choose(g, '棄置 鴉仕女', 1); pick(g, ['fox13']);
  assert.deepEqual(zone(g, 1, 'hand'), ['cro21']);
  assert.deepEqual(zone(g, 0, 'hand'), ['fox13']);
  const g2 = scen({ factions: F, players: [{ hand: ['fox22'], deck: D }, { hand: ['cro05', 'cro21'], deck: D }] });
  choose(g2, '打出 魂燈'); choose(g2, '不控訴', 1); choose(g2, '隨機', 1);
  assert.equal(g2.P[1].hand.length, 1);
  assert.equal(g2.P[1].discard.length, 1);
});

test('fox23 時雨：場上每 2 地點抽 1；星塵破壞所有荒野並破壞敵方等量信徒', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox23'], field: ['fox17', 'fox18', 'fox19', 'fox20'], deck: D }, { field: ['cro05'], deck: D }] });
  choose(g, '打出 時雨');
  assert.equal(g.P[0].hand.length, 2);
  const g2 = scen({ factions: F, players: [{ hand: ['fox23'], field: ['fox17', 'fox18', 'fox08', 'fox09', 'fox12'], deck: D }, { field: ['cro05', 'cro06', 'cro07'], deck: D }] });
  choose(g2, '打出 時雨'); pick(g2, ['cro05', 'cro06']);
  assert.deepEqual(zone(g2, 1, 'field'), ['cro07']);
  assert.equal(g2.locations(0).length, 0);
});

test('fox24 結靈：每個駐守中信徒使下一次襲擊 +2；星塵以聲量 2 免費襲擊', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox24'], field: ['fox19', { id: 'fox14', guard: 'fox19' }], deck: D }, { field: ['cro19'], deck: D }] });
  // 星塵 1 < 2；加成 +2，櫻華 1 → 3 < 6
  choose(g, '打出 結靈');
  assert.equal(g.P[0].flags.attackBonus, 2);
  const g2 = scen({ factions: F, players: [{ hand: ['fox24'], field: ['fox19', 'fox20', { id: 'fox08', guard: 'fox19' }, { id: 'fox09', guard: 'fox20' }], deck: D }, { field: ['cro19', 'cro16'], deck: D }] });
  choose(g2, '打出 結靈');
  choose(g2, '襲擊 羽墓園'); // 2 + 4 = 6 ≥ 6
  pick(g2, []);
  assert.ok(zone(g2, 1, 'discard').includes('cro19'));
  assert.equal(g2.actionsLeft, 1);
  assert.equal(g2.P[0].flags.attackBonus, 0);
});

// ================= 原作者修正後新增 =================
test('駐守可疊加：多個信徒駐守同一地點，守護相加', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox09'], field: ['fox19', { id: 'fox08', guard: 'fox19' }], deck: D }, { deck: D }] });
  choose(g, '打出 白衣武士'); choose(g, '駐守 本殿');
  assert.equal(g.locGuard(card(g, 0, 'fox19')), 10);
  assert.equal(card(g, 0, 'fox08').guardAt, card(g, 0, 'fox19').uid);
});

test('被控訴的駐守信徒：留在場上但不能駐守', () => {
  const g = scen({ factions: F, players: [{ hand: ['fox11'], field: ['fox19'], deck: D }, { hand: ['cro05'], deck: D }] });
  choose(g, '打出 燈籠巡遊'); choose(g, '鴉仕女', 1);
  assert.ok(isAction(g, 0));
  assert.equal(card(g, 0, 'fox11').zone, 'field');
  assert.equal(card(g, 0, 'fox11').guardAt, null);
});

test('cro18 巢修道院：只計算巢修道院上場「之後」的第一次詠頌', () => {
  // 先打鴉仕女（巢修道院尚未上場）→ 再打巢修道院 → 下一個詠頌額外觸發
  const g = scen({ players: [{ hand: ['cro05', 'cro18', 'cro07'], field: ['cro06', 'cro14', 'cro04'], deck: [...D, ...D] }, { deck: D }] });
  choose(g, '打出 鴉仕女');
  choose(g, '打出 巢修道院');
  endTurn(g); passRitual(g);
  endTurn(g); passRitual(g);
  const h = g.P[0].hand.length;
  choose(g, '打出 信使'); // 抽1、棄1，額外再觸發一次
  pick(g, [g.P[0].hand[0].id], 0); pick(g, [g.P[1].hand[0].id], 1);
  pick(g, [g.P[0].hand[0].id], 0); pick(g, [g.P[1].hand[0].id], 1);
  assert.equal(g.P[0].hand.length, h - 1);
});

test('cro18 巢修道院：同回合先有詠頌、之後巢修道院才上場，下一個詠頌仍算第一次', () => {
  const g = scen({ players: [{ hand: ['cro06', 'cro18', 'cro05'], field: ['cro14', 'cro04'], deck: D }, { deck: D }] });
  choose(g, '打出 鴉司祭'); pick(g, []);   // 詠頌（巢修道院尚未上場）
  // 用鴉司祭之後的打出不可能（行動用完），改以直接檢查：巢修道院上場後的 enteredSeq 大於先前詠頌
  choose(g, '打出 巢修道院');
  const nest = card(g, 0, 'cro18');
  assert.ok(g.P[0].flags.chantSeqs.every(s => s < nest.enteredSeq));
});

test('「沒有可控訴的卡時自動跳過」關閉時，仍會詢問（只能選不控訴）', () => {
  const g = scen({ players: [{ hand: ['cro05'], deck: D }, { hand: ['fox14'], deck: D, autoSkipCounter: false }] });
  choose(g, '打出 鴉仕女');
  assert.equal(g.pending.player, 1);
  assert.deepEqual(g.pending.options.map(o => o.label), ['不控訴']);
  choose(g, '不控訴', 1);
  assert.deepEqual(zone(g, 0, 'hand'), ['fox17']);
  const g2 = scen({ players: [{ hand: ['cro05'], deck: D }, { hand: ['fox14'], deck: D }] });
  choose(g2, '打出 鴉仕女');
  assert.ok(isAction(g2, 0));
});

const { validateDeck, presetDeck } = require('../engine/engine');
test('組牌驗證：預設牌組合法；混搭規則', () => {
  assert.ok(validateDeck(presetDeck('白狐神社')).ok);
  assert.ok(validateDeck(presetDeck('鴉教團')).ok);
  const fox = presetDeck('白狐神社');
  // 白狐 教主+3 儀式 + 12 張白狐 + 8 張鴉／放逐者
  const foxMain = fox.filter(id => !['fox01', 'fox02', 'fox03', 'fox04'].includes(id));
  const croMain = presetDeck('鴉教團').filter(id => !['cro01', 'cro02', 'cro03', 'cro04'].includes(id));
  const mix = ['fox01', 'fox02', 'fox03', 'fox04', ...foxMain.slice(0, 12), ...croMain.slice(0, 5), 'exi01', 'exi03', 'exi33'];
  const v = validateDeck(mix);
  assert.ok(v.ok, v.errors.join());
  assert.equal(v.secondary, '鴉教團');
  const bad1 = ['fox01', 'fox02', 'fox03', 'fox04', ...foxMain.slice(0, 11), ...croMain.slice(0, 9)];
  assert.match(validateDeck(bad1).errors.join(), /至少 12 張/);
  const exiOnly = ['fox01', 'fox02', 'fox03', 'fox04', ...foxMain.slice(0, 12), 'exi01', 'exi02', 'exi03', 'exi04', 'exi05', 'exi06', 'exi07', 'exi08'];
  assert.ok(validateDeck(exiOnly).ok);
  const twoOther = ['fox01', 'fox02', 'fox03', 'fox04', ...foxMain.slice(0, 12), ...croMain.slice(0, 7), 'dor05'];
  assert.match(validateDeck(twoOther).errors.join(), /尚未支援|另一個教團/);
  const bad2 = ['fox01', 'fox02', 'fox03', 'cro02', ...foxMain];
  assert.match(validateDeck(bad2).errors.join(), /儀式必須/);
  const bad3 = ['fox01', 'cro01', 'fox02', 'fox03', 'fox04', ...foxMain.slice(0, 19)];
  assert.match(validateDeck(bad3).errors.join(), /教主/);
  assert.match(validateDeck(['fox01', 'fox01']).errors.join(), /重複|24/);
  // 混搭牌組可以實際開局
  const { Game } = require('../engine/engine');
  const g = new Game({ seed: 5, decks: [mix, presetDeck('鴉教團')] }).start();
  assert.equal(g.P[0].faction, '白狐神社');
  assert.equal(g.P[0].all.length, 24);
});
