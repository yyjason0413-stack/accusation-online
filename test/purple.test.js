'use strict';
// 紫靈山 24 張測試
const test = require('node:test');
const { scen, choose, pick, zone, card, hasOption, labels, isAction, assert } = require('./helpers');
const D = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'];
const S = (p0, p1, extra = {}) => scen(Object.assign({ factions: ['紫靈山', '白狐神社'], players: [Object.assign({ deck: D }, p0), Object.assign({ deck: D }, p1)] }, extra));
const opts = g => g.pending.options.map(o => o.cardId);

test('飛升：需要除外你場上提供符號的信徒才能打出；無法滿足時不能打出', () => {
  const g0 = S({ hand: ['cen13'] }, {});
  assert.equal(hasOption(g0, '打出 蝶夫人'), false);
  const g = S({ hand: ['cen13'], field: ['cen06', 'cen05'] }, {});
  choose(g, '打出 蝶夫人');
  assert.equal(g.pending.info, 'ascend');
  pick(g, ['cen06']);
  assert.deepEqual(zone(g, 0, 'exile'), ['cen06']);
  assert.ok(zone(g, 0, 'field').includes('cen13'));
});

test('cen01 黑蟾法師：魔法星塵需求 -1；快速行動觸發棄牌區災厄 4 以上魔法基礎效果後除外', () => {
  const g = S({ field: ['cen01', 'cen05', 'cen06', 'cen07', 'cen08', 'cen09'], discard: ['cen22', 'cen12', 'cen23'] }, {});
  assert.equal(g.stardustNeed(0, card(g, 0, 'cen22')), 5);
  choose(g, '快速行動');
  assert.deepEqual(opts(g), ['cen22']);
  pick(g, ['cen22']); pick(g, ['cen12']);
  assert.ok(zone(g, 0, 'deck').includes('cen12'));
  assert.deepEqual(zone(g, 0, 'exile'), ['cen22']);
});

test('cen02／cen03／cen04 儀式條件', () => {
  const g = S({ field: ['cen02', 'cen12', 'cen16', 'cen14'] }, {});
  assert.equal(g.ritualReady(card(g, 0, 'cen02')), true);
  const g1 = S({ field: ['cen02', 'cen12', 'cen16'] }, {});
  assert.equal(g1.ritualReady(card(g1, 0, 'cen02')), false);
  const g2 = S({ field: ['cen03'], exile: ['fox17', 'fox17', 'fox18', 'fox05', 'fox06', 'fox07'] }, {});
  assert.equal(g2.ritualReady(card(g2, 0, 'cen03')), true);
  const g3 = S({ field: ['cen04', 'cen15', 'cen14', 'cen05', 'cen06', 'cen07', 'cen10'] }, {});
  assert.equal(g3.ritualReady(card(g3, 0, 'cen04')), true);
});

test('cen05 千雪：每 2 醫藥解除你 1 個信徒的罪惡', () => {
  const g = S({ hand: ['cen05'], field: ['cen20', 'cen11', { id: 'cen06', guilty: true }] }, {});
  choose(g, '打出 千雪'); pick(g, ['cen06']);
  assert.equal(card(g, 0, 'cen06').guilty, false);
});

test('cen06 黃石：控訴聲量＋棄牌區魔法數；打出魔法時可獻祭手中的黃石', () => {
  const g = S({ hand: ['cen06'], discard: ['cen21', 'cen22'] }, {});
  assert.equal(g.counterVolume(card(g, 0, 'cen06')), 5);
  const g2 = S({ hand: ['cen23', 'cen06'], field: ['cen03'] }, {});
  choose(g2, '打出 嚙災'); choose(g2, '展示並獻祭黃石');
  assert.deepEqual(zone(g2, 0, 'under'), ['cen06']);
});

test('cen07 銀河：每 3 知識魔法星塵需求 -1', () => {
  const g = S({ field: ['cen07', 'cen06', 'cen10'], hand: ['cen21'] }, {});
  assert.equal(g.stardustNeed(0, card(g, 0, 'cen21')), 4);
});

test('cen08 養殖者：你的回合原始聲量 5 以上信徒進場時，可獻祭棄牌區 1 張', () => {
  const g = S({ hand: ['cen12', 'cen23'], field: ['cen08', 'cen03'], discard: ['fox18'] }, {});
  choose(g, '打出 修行失敗者');
  while (g.pending && g.pending.type === 'pick' && !/養殖者/.test(g.pending.prompt)) pick(g, ['cen23']);
  assert.match(g.pending.prompt, /養殖者/);
  pick(g, ['fox18']);
  assert.deepEqual(zone(g, 0, 'under'), ['fox18']);
});

test('cen09 掌中符：每 2 煉金棄置 1 張被獻祭的牌，然後除外場上 1 個信徒', () => {
  const g = S({ hand: ['cen09'], field: ['cen08', 'cen17', 'cen03'], under: [{ id: 'fox18', under: 'cen03' }] }, { field: ['fox06'] });
  choose(g, '打出 掌中符'); pick(g, ['fox18']); pick(g, ['fox06']);
  assert.deepEqual(zone(g, 1, 'exile'), ['fox06']);
  assert.ok(zone(g, 0, 'discard').includes('fox18'));
});

test('cen10 霜蟾：除外你 1 張醫藥非教主牌，觸發棄牌區魔法基礎效果', () => {
  const g = S({ hand: ['cen10'], field: ['cen01', 'cen05'], discard: ['cen22', 'cen12'] }, {});
  choose(g, '打出 霜蟾');
  assert.deepEqual(opts(g), ['cen05']);
  pick(g, ['cen05']); pick(g, ['cen22']); pick(g, ['cen12']);
  assert.ok(zone(g, 0, 'deck').includes('cen12'));
  assert.ok(zone(g, 0, 'discard').includes('cen22'), '觸發後魔法留在棄牌區');
});

test('cen11 著魔煉丹師：飛升時可提供任意符號；不會變為罪惡', () => {
  const g = S({ hand: ['cen13'], field: ['cen11'] }, {});
  choose(g, '打出 蝶夫人'); pick(g, ['cen11']);
  assert.deepEqual(zone(g, 0, 'exile'), ['cen11']);
  const g2 = S({ field: ['cen11'] }, {});
  assert.equal(g2.makeGuilty(card(g2, 0, 'cen11')), false);
});

test('cen12 修行失敗者：無法控訴；不除外手牌則破壞你 2 個信徒', () => {
  const g = S({ hand: ['cen12'], field: ['cen05', 'cen06', 'cen07'] }, {});
  assert.equal(g.canCounterWith(card(g, 0, 'cen12')), false);
  choose(g, '打出 修行失敗者'); pick(g, ['cen05', 'cen06']);
  assert.deepEqual(zone(g, 0, 'discard').sort(), ['cen05', 'cen06']);
});

test('cen13 蝶夫人：本回合魔法災厄 +1，然後可打出手牌 1 張魔法', () => {
  const g = S({ hand: ['cen13', 'cen23'], field: ['cen06'] }, { field: [{ id: 'fox06', guilty: true }] });
  choose(g, '打出 蝶夫人'); pick(g, ['cen06']); pick(g, ['cen23']); pick(g, ['fox06']);
  assert.deepEqual(zone(g, 1, 'exile'), ['fox06']);
  assert.equal(g.actionsLeft, 1);
  assert.equal(g.P[0].flags.magicCalBonus, 1);
});

test('cen14 蜘蛛僧：飛升(煉金)(醫藥)；詠頌破壞場上至多 2 個信徒', () => {
  const g = S({ hand: ['cen14'], field: ['cen08', 'cen05'] }, { field: ['fox06', 'fox07'] });
  choose(g, '打出 蜘蛛僧'); pick(g, ['cen08', 'cen05']); pick(g, ['fox06', 'fox07']);
  assert.deepEqual(zone(g, 1, 'discard').sort(), ['fox06', 'fox07']);
});

test('cen15 蜈蚣智者：每個庭院魔法星塵需求 -2', () => {
  const g = S({ field: ['cen15', 'cen19', 'cen20'], hand: ['cen24'] }, {});
  assert.equal(g.stardustNeed(0, card(g, 0, 'cen24')), 4);
});

test('cen16 蛇娘子：襲擊時可棄置 2 張被獻祭的牌，讓被襲擊的牌改為除外；不會變罪惡', () => {
  const g = S({ field: ['cen16', 'cen03'], under: [{ id: 'fox18', under: 'cen03' }, { id: 'fox14', under: 'cen03' }] }, { field: ['fox17'] });
  choose(g, '襲擊 神隱之森'); pick(g, ['cen16']); pick(g, ['fox18', 'fox14']);
  assert.deepEqual(zone(g, 1, 'exile'), ['fox17']);
  assert.equal(card(g, 0, 'cen16').guilty, false);
});

test('cen17 還魂橋：你的回合你場上的信徒被除外時，拿回棄牌區 1 張', () => {
  const g = S({ hand: ['cen13'], field: ['cen17', 'cen06'], discard: ['fox18'] }, {});
  choose(g, '打出 蝶夫人'); pick(g, ['cen06']); pick(g, ['fox18']);
  assert.ok(zone(g, 0, 'hand').includes('fox18'));
});

test('cen18 百蠱堂：除外棄牌區 1 張；本回合飛升 -1、星塵 -2、災厄 +1', () => {
  const g = S({ field: ['cen18', 'cen08'], discard: ['fox18'], hand: ['cen23', 'cen16'] }, {});
  assert.equal(hasOption(g, '打出 蛇娘子'), false, '需 3 個符號，只有知識＋煉金');
  choose(g, '地點行動：百蠱堂'); pick(g, ['fox18']);
  assert.equal(g.stardustNeed(0, card(g, 0, 'cen23')), 4);
  assert.equal(g.magicCalamity(0, card(g, 0, 'cen23'), false), 2);
  assert.ok(hasOption(g, '打出 蛇娘子'), '飛升需求 -1 後 2 張即可');
});

test('cen19 空蟲院：除外聲量小於野性數的信徒', () => {
  const g = S({ field: ['cen19', 'cen12'] }, { field: ['fox06', 'fox09'] });
  choose(g, '地點行動：空蟲院');
  assert.deepEqual(opts(g).filter(x => x.startsWith('fox')), ['fox09']);
  pick(g, ['fox09']);
  assert.deepEqual(zone(g, 1, 'exile'), ['fox09']);
});

test('cen20 汞月湖：每 3 醫藥飛升需求 -1', () => {
  const g = S({ field: ['cen20', 'cen05', 'cen11'] }, {});
  assert.equal(g.ascendReduce(0), 1);
  assert.equal(g.ascendCovers(0, { 知識: 1 }, []), true);
});

test('cen21 蠱丹法：本回合飛升 -1；星塵獻祭牌庫頂／手牌／棄牌區至多 4 張', () => {
  const g = S({ hand: ['cen21', 'fox05'], field: ['cen01', 'cen03', 'cen05', 'cen06', 'cen07', 'cen08'], deck: ['fox17', 'fox18'] }, {});
  choose(g, '打出 蠱丹法'); choose(g, '從牌庫頂獻祭 1 張'); pick(g, ['fox05']);
  assert.deepEqual(zone(g, 0, 'under').sort(), ['fox05', 'fox18']);
  assert.equal(g.ascendReduce(0), 1);
});

test('cen22 轉生術：棄牌區 1 信徒洗回；星塵可改為每煉金洗回 1 張', () => {
  const g = S({ hand: ['cen22'], discard: ['cen12', 'fox18'] }, {});
  choose(g, '打出 轉生術'); pick(g, ['cen12']);
  assert.ok(zone(g, 0, 'deck').includes('cen12'));
  const g2 = S({ hand: ['cen22'], field: ['cen01', 'cen08', 'cen09', 'cen16', 'cen06', 'cen07'], discard: ['cen12', 'fox18', 'fox17'] }, {});
  choose(g2, '打出 轉生術'); choose(g2, '改為洗回'); pick(g2, ['fox18', 'fox17', 'cen12']);
  assert.deepEqual(zone(g2, 0, 'discard'), ['cen22']);
});

test('cen23 嚙災：除外任意數量罪惡信徒；星塵每知識災厄 +1', () => {
  const g = S({ hand: ['cen23'], field: ['cen06', 'cen07', 'cen10', 'cen13', 'cen15', 'cen01'] }, { field: [{ id: 'fox06', guilty: true }, { id: 'fox07', guilty: true }, 'fox05'] });
  assert.equal(g.magicCalamity(0, card(g, 0, 'cen23'), true), 1 + 5);
  choose(g, '打出 嚙災'); pick(g, ['fox06', 'fox07']);
  assert.deepEqual(zone(g, 1, 'exile').sort(), ['fox06', 'fox07']);
});

test('cen24 蠱祖降臨：抽 1 棄 2；星塵：野性多於敵方信徒數即勝利', () => {
  const g = S({ hand: ['cen24', 'fox05', 'fox06'], field: ['cen01', 'cen15', 'cen19', 'cen20'], deck: ['fox07'] }, { field: ['fox08', 'fox09'] });
  // 星塵需求 8-1-4=3，信徒 1 → 未滿足；野性 3 > 2
  choose(g, '打出 蠱祖降臨'); pick(g, ['fox05', 'fox06']);
  assert.equal(g.winner, null);
  const g2 = S({ hand: ['cen24', 'fox05', 'fox06'], field: ['cen01', 'cen15', 'cen19', 'cen20', 'cen12', 'cen16'], deck: ['fox07'] }, { field: ['fox08', 'fox09'] });
  choose(g2, '打出 蠱祖降臨'); pick(g2, ['fox05', 'fox06']);
  assert.equal(g2.winner, 0);
});

// ---- 設計者裁定（飛升）----
test('飛升：每張牌只提供 1 個符號（蛇娘子：多符號的牌不能一張抵多個）', () => {
  const g = S({ hand: ['cen16'], field: ['cen14'] }, {}); // 蜘蛛僧有 野性煉金醫藥，但只能提供 1 個
  assert.equal(hasOption(g, '打出 蛇娘子'), false);
  const g2 = S({ hand: ['cen16'], field: ['cen14', 'cen12', 'cen06'] }, {});
  choose(g2, '打出 蛇娘子');
  assert.equal(g2.pending.min, 3); assert.equal(g2.pending.max, 3);
  pick(g2, ['cen14', 'cen12', 'cen06']); // 煉金／野性／知識
  assert.deepEqual(zone(g2, 0, 'exile').sort(), ['cen06', 'cen12', 'cen14']);
  assert.ok(zone(g2, 0, 'field').includes('cen16'));
});

test('飛升：可除外地點、儀式等非教主牌；教主不能；不可多付', () => {
  const g = S({ hand: ['cen14'], field: ['cen01', 'cen17', 'cen04'] }, {}); // 還魂橋 煉金、永生靈藥 醫藥；教主有醫藥但不能用
  choose(g, '打出 蜘蛛僧');
  assert.ok(!opts(g).includes('cen01'), '教主不能被除外');
  assert.equal(g.answer(0, [0]).ok, false, '張數不足');
  pick(g, ['cen17', 'cen04']);
  assert.deepEqual(zone(g, 0, 'exile').sort(), ['cen04', 'cen17']);
  const g2 = S({ hand: ['cen13'], field: ['cen01'] }, {});
  assert.equal(hasOption(g2, '打出 蝶夫人'), false, '只有教主有符號 → 不能飛升');
});

test('飛升：罪惡信徒也可除外；著魔煉丹師可當任意符號；需求減少後張數變少', () => {
  const g = S({ hand: ['cen15'], field: [{ id: 'cen06', guilty: true }, 'cen11'] }, {});
  choose(g, '打出 蜈蚣智者'); pick(g, ['cen06', 'cen11']);
  assert.ok(zone(g, 0, 'field').includes('cen15'));
  const g2 = S({ hand: ['cen15'], field: ['cen20', 'cen05', 'cen11', 'cen06'] }, {}); // 醫藥 3 → 需求 -1
  choose(g2, '打出 蜈蚣智者');
  assert.equal(g2.pending.min, 1);
});

test('飛升信徒不能控訴', () => {
  const g = S({ hand: ['fox11'] }, { hand: ['cen13', 'cen16'] }, { factions: ['白狐神社', '紫靈山'] });
  assert.equal(g.canCounterWith(card(g, 1, 'cen13')), false);
  choose(g, '打出 燈籠巡遊');
  assert.ok(!g.pending || g.pending.info !== 'counter' || !g.pending.options.some(o => /蝶夫人|蛇娘子/.test(o.label)));
});

test('飛升信徒不能透過其他效果進場（鴉司祭／尋找放置／直接移動）', () => {
  const g = scen({ factions: ['鴉教團', '紫靈山'], players: [{ deck: D, hand: ['cro06', 'cen13', 'cro05'] }, { deck: D }] });
  choose(g, '打出 鴉司祭');
  assert.deepEqual(g.pending.options.map(o => o.cardId), ['cro05']);
  const g2 = S({ hand: ['cen13'] }, {});
  const c = card(g2, 0, 'cen13'); g2.move(c, 'field');
  assert.equal(c.zone, 'hand', '直接移到場上也被擋下');
});

test('裁定 夜鹿：飛升信徒也參與比較；最小的是飛升信徒則不放置', () => {
  const S2 = (h) => scen({ factions: ['逐光者', '紫靈山'], players: [{ deck: D, hand: ['mot06'] }, { deck: D, hand: h }] });
  // 蝶夫人聲量 6 比蜈蚣智者 7 小，但沒有比它更小的一般信徒 → 不放置
  const g = S2(['cen13', 'cen15']);
  choose(g, '打出 夜鹿');
  assert.ok(isAction(g, 0)); assert.equal(zone(g, 1, 'field').length, 0);
  // 一般信徒（千雪 3）比飛升信徒小 → 放置千雪
  const g2 = S2(['cen13', 'cen05']);
  choose(g2, '打出 夜鹿');
  if (g2.pending && g2.pending.type === 'pick') pick(g2, ['cen05'], 1);
  assert.ok(zone(g2, 1, 'field').includes('cen05'));
});
