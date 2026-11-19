'use strict';
// 瘋人院 24 張測試
const test = require('node:test');
const { scen, choose, pick, pickFail, zone, card, isAction, hasOption, endTurn, passRitual, labels, assert } = require('./helpers');
const D = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'];
const S = (p0, p1, extra = {}) => scen(Object.assign({ factions: ['白狐神社', '瘋人院'], players: [Object.assign({ deck: D }, p0), Object.assign({ deck: D }, p1)] }, extra));
// 預設：玩家一（白狐）回合；玩家二（瘋人院）控訴
const counterOn = (g, name) => choose(g, name, 1);

test('asy01 院長：你的信徒控訴聲量 +1；快速行動拿回棄牌區聲量 2 以下的信徒（看卡面聲量，依 QA）', () => {
  const g = S({}, { field: ['asy01'], hand: ['asy05'] });
  assert.equal(g.counterVolume(card(g, 1, 'asy05')), 5);
  const g2 = S({ field: ['asy01'], discard: ['asy10', 'asy05'] }, {}, { factions: ['瘋人院', '白狐神社'] });
  choose(g2, '快速行動');
  assert.deepEqual(g2.pending.options.map(o => o.cardId), ['asy10']);
  pick(g2, ['asy10']);
  assert.deepEqual(zone(g2, 0, 'hand'), ['asy10']);
});

test('asy02／asy03／asy04 儀式條件', () => {
  const g = S({ field: ['asy02', 'asy12', 'asy13', 'asy15', 'asy16'] }, {});
  assert.equal(g.ritualReady(card(g, 0, 'asy02')), true);
  const g2 = S({ field: ['asy03', 'fox05', 'fox06', 'fox07', 'fox08', { id: 'fox09', guilty: true }] }, {});
  assert.equal(g2.ritualReady(card(g2, 0, 'asy03')), false);
  const g3 = S({ field: ['asy03', 'fox05', 'fox06', 'fox07', 'fox08', 'fox09'] }, {});
  assert.equal(g3.ritualReady(card(g3, 0, 'asy03')), true);
  const gs = ['asy07', 'cro10', 'cro07', 'cro05', 'cro06'].map(id => ({ id, guilty: true }));
  const g4 = S({ field: ['asy04', ...gs] }, {});
  assert.equal(g4.ritualReady(card(g4, 0, 'asy04')), true);
});

test('asy05 排隊的瘋子：控訴時若擁有 3 凋零，目標敵方棄 1 張', () => {
  const g = S({ hand: ['fox11', 'fox19'] }, { hand: ['asy05'], field: ['asy06', 'asy14', 'asy18'] });
  choose(g, '打出 燈籠巡遊'); counterOn(g, '排隊的瘋子'); pick(g, ['fox19'], 0);
  assert.deepEqual(zone(g, 0, 'discard'), ['fox19']);
});

test('asy06 艾德與比利：控訴時若煉金數大於醫藥數，拿回棄牌區 1 張；解構1', () => {
  const g = S({ hand: ['fox11'] }, { hand: ['asy06'], field: ['asy08'], discard: ['fox19'] });
  choose(g, '打出 燈籠巡遊'); counterOn(g, '艾德與比利'); pick(g, ['fox19'], 1);
  assert.deepEqual(zone(g, 1, 'hand'), ['fox19']);
});

test('asy07 小丑：控訴時除外被控訴的非儀式牌（信徒、魔法）', () => {
  const P1 = ['asy01', 'asy19', 'asy08', 'asy15', 'asy12']; // 控訴聲量 0 +1 +1 +1 = 3
  const g = S({ hand: ['fox11'] }, { hand: ['asy07'], field: P1 });
  choose(g, '打出 燈籠巡遊'); counterOn(g, '小丑');
  assert.deepEqual(zone(g, 0, 'exile'), ['fox11']);
  const g2 = S({ hand: ['fox21'], field: ['fox05', 'fox06', 'fox07'] }, { hand: ['asy07'], field: P1 });
  choose(g2, '打出 狐火'); counterOn(g2, '小丑');
  assert.deepEqual(zone(g2, 0, 'exile'), ['fox21']);
});

test('asy08 孤單藝術家：控訴時破壞場上 1 個聲量 ≤ 雙方聖地數的信徒', () => {
  const g = S({ hand: ['fox11'], field: ['fox19', 'fox09'] }, { hand: ['asy08'], field: ['asy16'] });
  choose(g, '打出 燈籠巡遊'); counterOn(g, '孤單藝術家');
  pick(g, ['fox09'], 1);
  assert.deepEqual(zone(g, 0, 'discard'), ['fox09']);
});

test('asy09 誠實的病患：控訴時除外自己；變為罪惡時除外自己', () => {
  const g = S({ hand: ['fox11'] }, { hand: ['asy09'] });
  choose(g, '打出 燈籠巡遊'); counterOn(g, '誠實的病患');
  assert.deepEqual(zone(g, 1, 'exile'), ['asy09']);
});

test('asy10 夢遊人：觸發地點行動（未被控訴）時拿回手；不能襲擊；不會變罪惡', () => {
  const g = S({ field: ['asy10', 'asy18', 'asy06', 'asy14'] }, {}, { factions: ['瘋人院', '白狐神社'] });
  assert.equal(g.attackers(0).some(c => c.id === 'asy10'), false);
  choose(g, '地點行動：瘋人院花園');
  assert.deepEqual(zone(g, 0, 'hand'), ['asy10']);
  const g2 = S({ field: ['asy10', 'asy18'] }, { hand: ['cro13'] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g2, '地點行動：瘋人院花園'); choose(g2, '灰眼童', 1);
  assert.ok(zone(g2, 0, 'field').includes('asy10'));
  g2.makeGuilty(card(g2, 0, 'asy10'));
  assert.equal(card(g2, 0, 'asy10').guilty, false);
});

test('asy11 數列女士：剛好 1/2/3/4 個罪惡信徒時控訴聲量 +2/3/5/8', () => {
  const vols = [0, 1, 2, 3, 4, 5].map(n => {
    const g = S({}, { hand: ['asy11'], field: Array.from({ length: n }, (_, i) => ({ id: ['asy05', 'asy06', 'asy07', 'asy08', 'asy13'][i], guilty: true })) });
    return g.counterVolume(card(g, 1, 'asy11'));
  });
  assert.deepEqual(vols, [1, 3, 4, 6, 9, 1]);
});

test('asy12 催眠師：打出災厄 4 以上的魔法時（含星塵加成，先於控訴）將你 1 信徒拿回手', () => {
  const g = S({ hand: ['asy21'], field: ['asy12', 'asy13', 'asy15'] }, {}, { factions: ['瘋人院', '白狐神社'] });
  // 安眠藥 災厄 1 + 醫藥 3 = 4
  choose(g, '打出 安眠藥');
  assert.match(g.pending.prompt, /催眠師/);
  pick(g, ['asy13']);
  assert.deepEqual(zone(g, 0, 'hand'), ['asy13']);
  assert.ok(card(g, 0, 'asy12').guilty);
});

test('asy13 實習護士：每 2 凋零，破壞你 1 罪惡信徒，然後破壞敵方等量信徒（由你選）', () => {
  const g = S({ hand: ['asy13'], field: ['asy06', 'asy14', 'kit06', { id: 'asy05', guilty: true }, { id: 'asy07', guilty: true }] }, { field: ['fox13', 'fox09', 'fox05'] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g, '打出 實習護士'); pick(g, ['asy05']); pick(g, ['asy07']);
  pick(g, ['fox13', 'fox09']);
  assert.deepEqual(zone(g, 1, 'discard').sort(), ['fox09', 'fox13']);
});

test('asy14 主治醫師：拿回棄牌區 1 信徒；解構1', () => {
  const g = S({ hand: ['asy14'], field: ['asy02'], discard: ['asy05'] }, {}, { factions: ['瘋人院', '白狐神社'] });
  choose(g, '打出 主治醫師'); pick(g, ['asy05']); choose(g, '解構 切開頭顱');
  assert.deepEqual(zone(g, 0, 'hand'), ['asy05']);
});

test('asy15 藥劑師／asy19 諮商室：每 3 醫藥／3 煉金，你的信徒控訴聲量 +1', () => {
  const g = S({}, { hand: ['asy05'], field: ['asy15', 'asy12', 'asy13', 'asy19', 'asy08', 'asy09'] });
  assert.equal(g.counterVolume(card(g, 1, 'asy05')), 4 + 1 + 1);
});

test('asy16 手術室：擁有 4 醫藥時，你的信徒控訴後不會變為罪惡', () => {
  const g = S({ hand: ['fox11'] }, { hand: ['asy05'], field: ['asy16', 'asy12', 'asy13', 'asy15'] });
  choose(g, '打出 燈籠巡遊'); counterOn(g, '排隊的瘋子');
  assert.equal(card(g, 1, 'asy05').guilty, false);
});

test('asy17 廢棄電話亭：每 2 夜幕，敵方獻祭自己 1 個信徒（敵方選）', () => {
  const g = S({ field: ['asy17', 'asy07', 'asy10'] }, { field: ['fox03', 'fox13', 'fox09'] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g, '地點行動：廢棄電話亭'); pick(g, ['fox09'], 1);
  assert.equal(card(g, 1, 'fox09').zone, 'under');
});

test('asy18 瘋人院花園：每 2 凋零，將你 1 信徒拿回手', () => {
  const g = S({ field: ['asy18', 'asy06', { id: 'asy14', guilty: true }] }, {}, { factions: ['瘋人院', '白狐神社'] });
  choose(g, '地點行動：瘋人院花園'); pick(g, ['asy14']);
  assert.deepEqual(zone(g, 0, 'hand'), ['asy14']);
});

test('asy20 狂亂質詢：雙方各破壞自己 1 信徒（各自選）；星塵可改為一半', () => {
  const g = S({ hand: ['asy20'], field: ['asy05', 'asy06'] }, { field: ['fox13', 'fox09', 'fox05', 'fox06'] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g, '打出 狐亂質詢'.replace('狐', '狂'));
  pick(g, ['asy05'], 0); pick(g, ['fox13'], 1);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox13']);
  const g2 = S({ hand: ['asy20'], field: ['asy05', 'asy06', 'asy07'] }, { field: ['fox13', 'fox09', 'fox05', 'fox06'] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g2, '打出 狂亂質詢'); choose(g2, '改為各破壞一半');
  pick(g2, ['asy05'], 0); pick(g2, ['fox13', 'fox09'], 1);
  assert.equal(g2.followers(1).length, 2);
});

test('asy21 安眠藥：雙方所有信徒變罪惡；星塵：每 1 醫藥災厄 +1', () => {
  const g = S({ hand: ['asy21'], field: ['asy13', 'fox14'] }, { field: ['fox13'] }, { factions: ['瘋人院', '白狐神社'] });
  assert.equal(g.magicCalamity(0, card(g, 0, 'asy21'), true), 2);
  choose(g, '打出 安眠藥');
  assert.ok(card(g, 0, 'asy13').guilty && card(g, 1, 'fox13').guilty);
  assert.equal(card(g, 0, 'fox14').guilty, false);
});

test('asy22 強制拘束：附著於信徒，不能襲擊與解除罪惡；星塵：該信徒變罪惡', () => {
  const g = S({ hand: ['asy22'] }, { field: ['fox13'] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g, '打出 強制拘束'); pick(g, ['fox13']);
  assert.equal(g.attackers(1).length, 0);
  const g2 = S({ hand: ['asy22'], field: ['asy05', 'asy06'] }, { field: ['fox13'] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g2, '打出 強制拘束'); pick(g2, ['fox13']);
  assert.equal(card(g2, 1, 'fox13').guilty, true);
  assert.equal(g2.unGuilty(card(g2, 1, 'fox13')), false);
});

test('asy23 深度催眠：附著敵方信徒使其失去能力；星塵取得控制權；被控制的牌離場進入控制者區域（設計者裁定）、魔法回我方棄牌區', () => {
  const g = S({ hand: ['asy23'] }, { field: ['fox14'] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g, '打出 深度催眠'); pick(g, ['fox14']);
  g.makeGuilty(card(g, 1, 'fox14'));
  assert.equal(card(g, 1, 'fox14').guilty, true); // 櫻華失去「不會變罪惡」
  const g2 = S({ hand: ['asy23'], field: ['asy05', 'asy06', 'asy07'] }, { field: ['fox13'] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g2, '打出 深度催眠'); pick(g2, ['fox13']);
  const c = g2.P[0].field.find(x => x.id === 'fox13');
  assert.ok(c && c.owner === 0);
  assert.equal(g2.followers(1).length, 0);
  g2.destroy(c);
  assert.deepEqual(zone(g2, 1, 'discard'), []);
  assert.deepEqual(zone(g2, 0, 'discard').sort(), ['asy23', 'fox13']);
  assert.equal(c.owner, 0);
});

test('asy24 特殊療法：雙方獻祭自己 2 個非罪惡信徒；星塵：破壞敵方至少獻祭 3 張的儀式', () => {
  const g = S({ hand: ['asy24'], field: ['asy02', 'asy05', 'asy06', 'asy07'] }, { field: ['fox03', 'fox02', 'fox13', 'fox09'], under: [{ id: 'fox17', under: 'fox03' }] }, { factions: ['瘋人院', '白狐神社'] });
  choose(g, '打出 特殊療法');
  pick(g, ['asy05', 'asy06'], 0);
  pick(g, ['fox13', 'fox09'], 1); pick(g, ['fox03'], 1); pick(g, ['fox03'], 1);
  assert.deepEqual(zone(g, 1, 'discard').sort(), ['fox03', 'fox09', 'fox13', 'fox17']);
  assert.ok(zone(g, 1, 'field').includes('fox02'));
});

test('組牌：瘋人院預設牌組合法', () => {
  const { validateDeck, presetDeck } = require('../engine/engine');
  assert.ok(validateDeck(presetDeck('瘋人院')).ok);
});
