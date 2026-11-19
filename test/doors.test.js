'use strict';
// 門教團 24 張測試
const test = require('node:test');
const { scen, choose, pick, pickFail, zone, card, isAction, hasOption, endTurn, passRitual, labels, assert } = require('./helpers');
const D = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'];
const F = ['門教團', '白狐神社'];
const S = (p0, p1, extra = {}) => scen(Object.assign({ factions: F, players: [Object.assign({ deck: D }, p0), Object.assign({ deck: D }, p1)] }, extra));

test('dor01 鑰匙持有人：你的魔法災厄 +1；快速行動：獻祭你棄牌區 1 張魔法', () => {
  const g = S({ field: ['dor01', 'dor02'], hand: ['dor19'], discard: ['dor20'] }, {});
  assert.equal(g.magicCalamity(0, card(g, 0, 'dor19'), false), 2);
  choose(g, '快速行動'); pick(g, ['dor20']);
  assert.equal(card(g, 0, 'dor20').underOf, card(g, 0, 'dor02').uid);
  const g2 = S({ field: ['dor01'], discard: ['dor20'] }, {});
  assert.equal(hasOption(g2, '快速行動'), false); // 沒有儀式
});

test('dor02／dor03／dor04 儀式條件', () => {
  const g = S({ field: ['dor02', 'dor05', 'dor10', 'dor11', 'dor14', 'dor15'] }, {});
  assert.equal(g.ritualReady(card(g, 0, 'dor02')), true); // 知識 6
  const g2 = S({ field: ['dor03', 'dor07', 'dor09', 'dor17', 'mot20', 'mot12'] }, {});
  assert.equal(g2.ritualReady(card(g2, 0, 'dor03')), true); // 煉金 6
  const base = ['dor04', 'dor07', 'dor09', 'dor17', 'mot20', 'mot12', 'dor05', 'dor10', 'dor11', 'dor14'];
  const g3 = S({ field: [...base, 'cro14'] }, {});
  assert.equal(g3.ritualReady(card(g3, 0, 'dor04')), false); // 沒有圖書館
  const g4 = S({ field: [...base, 'dor15'] }, {});
  assert.equal(g4.ritualReady(card(g4, 0, 'dor04')), true);
});

test('dor05 瘋狂數學家：解構1（只有用回合行動打出時）', () => {
  const g = S({ hand: ['dor05'], field: ['dor02'] }, {});
  choose(g, '打出 瘋狂數學家'); choose(g, '解構 無知對談');
  assert.equal(g.ritualReduction(card(g, 0, 'dor02')), 1);
});

test('dor06 異象分析師：解構1，擁有 3 知識改為解構2', () => {
  const g = S({ field: ['dor02', { id: 'dor06', decon: 'dor02' }] }, {});
  assert.equal(g.ritualReduction(card(g, 0, 'dor02')), 1);
  const g2 = S({ field: ['dor02', 'dor05', 'cro14', { id: 'dor06', decon: 'dor02' }] }, {});
  assert.equal(g2.ritualReduction(card(g2, 0, 'dor02')), 2);
});

test('dor07 門測量員：獻祭你牌庫頂 2 張（先選儀式再看）', () => {
  const g = S({ hand: ['dor07'], field: ['dor02', 'dor03'], deck: ['cro05', 'cro06', 'cro07'] }, {});
  choose(g, '打出 門測量員');
  assert.match(g.pending.prompt, /獻祭後才能察看/);
  pick(g, ['dor02']); pick(g, ['dor03']);
  assert.equal(g.P[0].under.length, 2);
  assert.deepEqual(zone(g, 0, 'deck'), ['cro05']);
});

test('dor08 失憶的研究員：解構1，不會變為罪惡', () => {
  const g = S({ field: ['dor08'] }, {});
  g.makeGuilty(card(g, 0, 'dor08'));
  assert.equal(card(g, 0, 'dor08').guilty, false);
});

test('dor09 概念術士：詠頌拿回棄牌區 1 張魔法；解構1', () => {
  const g = S({ hand: ['dor09'], field: ['dor02'], discard: ['dor19', 'cro05'] }, {});
  choose(g, '打出 概念術士'); pick(g, ['dor19']); choose(g, '解構 無知對談');
  assert.deepEqual(zone(g, 0, 'hand'), ['dor19']);
  assert.equal(card(g, 0, 'dor09').deconAt, card(g, 0, 'dor02').uid);
});

test('dor10 資料庫管理員：每 1 圖書館，啟動你 1 個非罪惡信徒的解構（可重新選目標）', () => {
  const g = S({ hand: ['dor10'], field: ['dor15', 'dor16', 'dor02', 'dor03', { id: 'dor05', decon: 'dor02' }, 'dor08'] }, {});
  choose(g, '打出 資料庫管理員');
  pick(g, ['dor05']); choose(g, '解構 開啟入口');
  pick(g, ['dor08']); choose(g, '解構 開啟入口');
  // 知識 4 → 上鎖的檔案庫另減 1
  assert.equal(g.ritualReduction(card(g, 0, 'dor03')), 3);
  assert.equal(g.ritualReduction(card(g, 0, 'dor02')), 1);
});

test('dor11 Δ議會博士：將棄牌區所有儀式放到場上', () => {
  const g = S({ hand: ['dor11'], discard: ['dor02', 'dor03', 'cro05'] }, {});
  choose(g, '打出 Δ議會博士');
  assert.deepEqual(g.rituals(0).map(c => c.id).sort(), ['dor02', 'dor03']);
  assert.deepEqual(zone(g, 0, 'discard'), ['cro05']);
});

test('dor12 知罪者：變為罪惡時可棄手牌 1 儀式，否則破壞場上 1 儀式；用來控訴也會觸發（含鐘塔）', () => {
  const g = S({ field: ['dor12', 'dor02'], hand: ['dor03'] }, { field: ['fox19'] });
  choose(g, '襲擊 本殿');
  assert.equal(pickFail(g, ['dor12']), true);
  pick(g, [], 0); pick(g, ['dor02']);
  assert.deepEqual(zone(g, 0, 'discard').sort(), ['dor02']);
  const g2 = S({ hand: ['cro05'] }, { hand: ['dor12', 'dor03'], field: ['cro17', 'dor02'] }, { factions: ['鴉教團', '門教團'] });
  choose(g2, '打出 鴉仕女'); choose(g2, '知罪者', 1); pick(g2, ['dor03'], 1);
  assert.ok(zone(g2, 1, 'discard').includes('dor03'));
  assert.ok(zone(g2, 1, 'discard').includes('dor12')); // 鐘塔：控訴後破壞
});

test('dor13 實驗體：每 1 個解構中的信徒襲擊聲量 +2；只能單獨襲擊', () => {
  const g = S({ field: ['dor02', 'dor13', { id: 'dor05', decon: 'dor02' }, { id: 'dor08', decon: 'dor02' }] }, { field: ['fox19'] });
  assert.equal(g.attackVolume(card(g, 0, 'dor13')), 7);
  choose(g, '襲擊 本殿');
  assert.equal(pickFail(g, ['dor13', 'dor05']), false);
  pick(g, ['dor13']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox19']);
});

test('dor14 未知語言學家：擁有 4 禁忌時，敵方魔法無法觸發星塵效果', () => {
  const g = S({ hand: ['dor19'], field: ['cro05', 'cro06', 'cro07'] }, { field: ['dor14', 'dor13', 'dor06', 'kit09', 'fox19'] });
  choose(g, '打出 物質瓦解'); pick(g, ['fox19']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox19']); // 破壞而不是除外
  const g2 = S({ hand: ['dor19'], field: ['cro05', 'cro06', 'cro07'] }, { field: ['dor14', 'dor13', 'fox19'] });
  choose(g2, '打出 物質瓦解'); pick(g2, ['fox19']);
  assert.deepEqual(zone(g2, 1, 'exile'), ['fox19']);
});

test('dor15 上鎖的檔案庫：擁有 4 知識時，你的儀式減少 1 個符號需求', () => {
  const g = S({ field: ['dor02', 'dor15', 'dor05', 'dor10', 'dor11'] }, {}); // 知識 5
  assert.equal(g.ritualReady(card(g, 0, 'dor02')), true);
  const g2 = S({ field: ['dor02', 'dor15', 'dor05', 'dor10'] }, {});
  assert.equal(g2.ritualReady(card(g2, 0, 'dor02')), false);
});

test('dor16 門物質研究間：每 2 凋零，獻祭棄牌區 1 張', () => {
  const g = S({ field: ['dor16', 'dor18', 'dor08', 'kit06', 'dor02'], discard: ['cro05', 'cro06', 'cro07'] }, {});
  choose(g, '地點行動：門物質研究間'); pick(g, ['cro05', 'cro06']); // 凋零 5 → 2 張
  assert.equal(g.P[0].under.length, 2);
});

test('dor17 研究室中庭：每 2 煉金，將你場上或棄牌區 1 信徒洗回牌庫', () => {
  const g = S({ field: ['dor17', 'dor07', 'dor09', 'mot20'], discard: ['cro05'] }, {});
  choose(g, '地點行動：研究室中庭'); pick(g, ['cro05']); pick(g, ['dor07']);
  assert.equal(g.P[0].deck.length, 8);
});

test('dor18 增幅管道：擁有 4 凋零時，每回合第一張魔法不消耗行動（行動用完也能打）', () => {
  const g = S({ field: ['dor18', 'dor08', 'kit06'], hand: ['dor20', 'dor20'] }, {});
  const a = g.actionsLeft;
  choose(g, '打出 現實扭曲（不花費行動）');
  assert.equal(g.actionsLeft, a);
  assert.equal(hasOption(g, '不花費行動'), false);
  const g2 = S({ field: ['dor18', 'dor08'], hand: ['dor20'] }, {});
  assert.equal(hasOption(g2, '不花費行動'), false);
});

test('dor19 物質瓦解：破壞場上 1 信徒或地點；星塵改為除外', () => {
  const g = S({ hand: ['dor19'] }, { field: ['fox13'] });
  choose(g, '打出 物質瓦解'); pick(g, ['fox13']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox13']);
});

test('dor20 現實扭曲：敵方下一回合無法執行地點行動；星塵：也無法執行儀式', () => {
  const g = S({ hand: ['dor20'], field: ['cro05', 'cro06', 'cro07', 'cro08', 'cro10'] }, { field: ['fox19', 'fox03', 'fox18', 'fox17', 'fox14'] });
  choose(g, '打出 現實扭曲');
  endTurn(g); passRitual(g);
  assert.equal(hasOption(g, '地點行動'), false);
  endTurn(g);
  assert.notEqual(g.pending.info, 'ritual');
});

test('dor21 逆向儀式：破壞敵方 1 儀式；星塵：禁忌數大於該儀式災厄時改為除外', () => {
  const g = S({ hand: ['dor21'] }, { field: ['fox03'] });
  choose(g, '打出 逆向儀式'); pick(g, ['fox03']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox03']);
  const g2 = S({ hand: ['dor21'], field: ['dor13', 'dor06', 'kit09', 'cro05'] }, { field: ['fox03'] }); // 禁忌 4 > 2
  choose(g2, '打出 逆向儀式'); pick(g2, ['fox03']);
  assert.deepEqual(zone(g2, 1, 'exile'), ['fox03']);
});

test('dor22 意識轉移：獻祭任意數量信徒；星塵：每 3 張被獻祭的牌，本回合儀式災厄 +1', () => {
  const g = S({ hand: ['dor22'], field: ['dor02', 'cro05', 'cro06', 'cro07', 'cro08', 'cro10'], under: [{ id: 'fox17', under: 'dor02' }] }, {});
  choose(g, '打出 意識轉移'); pick(g, ['cro05', 'cro06']);
  assert.equal(g.P[0].under.length, 3);
  assert.equal(g.P[0].flags.ritualCalBonus, 1);
});

test('dor23 整理資料：棄任意張再抽等量；星塵：拿回棄牌區 1 張（不能拿回自己，依 QA）', () => {
  const g = S({ hand: ['dor23', 'fox19', 'fox18'], field: ['cro05', 'cro06', 'cro07', 'cro08'], discard: ['cro21'] }, {});
  choose(g, '打出 整理資料'); pick(g, ['fox19', 'fox18']);
  assert.ok(!g.pending.options.some(o => o.cardId === 'dor23'));
  pick(g, ['cro21']);
  assert.deepEqual(zone(g, 0, 'hand').sort(), ['cro21', 'fox17', 'fox17']);
});

test('dor24 重要的數據：獻祭這個魔法；星塵：每 2 煉金抽 1；沒有儀式時仍結算星塵（基本與星塵效果獨立）', () => {
  const g = S({ hand: ['dor24'], field: ['dor03', 'dor07', 'dor09', 'cro05'] }, {});
  choose(g, '打出 重要的數據');
  assert.equal(card(g, 0, 'dor24').zone, 'under');
  assert.equal(g.P[0].hand.length, 1); // 煉金 3 → 抽 1
  const g2 = S({ hand: ['dor24'], field: ['dor07', 'dor09', 'cro05'] }, {});
  choose(g2, '打出 重要的數據');
  assert.deepEqual(zone(g2, 0, 'discard'), ['dor24']);
  assert.equal(g2.P[0].hand.length, Math.floor(g2.sym(0, '煉金') / 2));
  assert.ok(g2.P[0].hand.length >= 1, '星塵效果照常抽牌');
});

test('組牌：門教團預設牌組合法', () => {
  const { validateDeck, presetDeck } = require('../engine/engine');
  assert.ok(validateDeck(presetDeck('門教團')).ok);
});
