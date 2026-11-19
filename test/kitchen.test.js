'use strict';
// 禁忌廚房 24 張測試
const test = require('node:test');
const { scen, choose, pick, pickFail, zone, card, isAction, hasOption, endTurn, passRitual, labels, assert } = require('./helpers');
const D = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'];
const F = ['禁忌廚房', '白狐神社'];
const S = (p0, p1, extra = {}) => scen(Object.assign({ factions: F, players: [Object.assign({ deck: D }, p0), Object.assign({ deck: D }, p1)] }, extra));
const N9 = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'];

test('kit01 主廚：敵方回合結束時手牌上限 5', () => {
  const g = S({ field: ['kit01'] }, { hand: ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox18'] }, { active: 1 });
  endTurn(g); passRitual(g);
  assert.match(g.pending.prompt, /超過 5 張，請棄置 2 張/);
  // 自己回合結束仍是 6
  const g2 = S({ field: ['kit01'], hand: ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox18'] }, {});
  endTurn(g2); passRitual(g2);
  assert.match(g2.pending.prompt, /超過 6 張，請棄置 1 張/);
});

test('kit01 主廚：快速行動破壞自己 1 信徒，由你或敵方抽「符號種類數」張', () => {
  const g = S({ field: ['kit01', 'kit05'] }, {});
  choose(g, '快速行動'); pick(g, ['kit05']);
  // 迷路的露蹄被破壞時：敵方抽 1；符號 自然自然禁忌 → 2 種
  assert.equal(g.P[1].hand.length, 1);
  choose(g, '我抽 2 張');
  assert.equal(g.P[0].hand.length, 2);
  assert.equal(hasOption(g, '快速行動'), false);
});

test('kit02 秘密菜單：需要 4 凋零 4 禁忌', () => {
  const g = S({ field: ['kit02', 'kit09', 'kit08', 'kit06'] }, {}); // 凋零 1+2+2=5，禁忌 1+2+1=4
  assert.equal(g.ritualReady(card(g, 0, 'kit02')), true);
  const g2 = S({ field: ['kit02', 'kit09', 'kit06'] }, {});
  assert.equal(g2.ritualReady(card(g2, 0, 'kit02')), false);
});

test('kit03 廚餘回收：你棄牌區至少 9 張', () => {
  assert.equal(S({ field: ['kit03'], discard: N9 }, {}).ritualReady(card(S({ field: ['kit03'], discard: N9 }, {}), 0, 'kit03')), true);
  const g = S({ field: ['kit03'], discard: N9.slice(1) }, {});
  assert.equal(g.ritualReady(card(g, 0, 'kit03')), false);
});

test('kit04 飯後甜點：4 自然且敵方牌庫已空', () => {
  const g = S({ field: ['kit04', 'kit05', 'fox18'] }, { deck: [] });
  assert.equal(g.ritualReady(card(g, 0, 'kit04')), true); // 自然 1+2+2
  const g2 = S({ field: ['kit04', 'kit05', 'fox18'] }, {});
  assert.equal(g2.ritualReady(card(g2, 0, 'kit04')), false);
});

test('kit05 迷路的露蹄（供品）：可被襲擊；被破壞時敵方抽 1', () => {
  const g = S({ field: ['cro05'] }, { field: ['kit05'] }, { factions: ['鴉教團', '禁忌廚房'] });
  choose(g, '襲擊 迷路的露蹄'); pick(g, ['cro05']);
  assert.deepEqual(zone(g, 1, 'discard'), ['kit05']);
  assert.equal(g.P[0].hand.length, 1);
});

test('kit06 斷腿兔子（供品）：被破壞時你棄 1 張手牌', () => {
  const g = S({ field: ['cro05'] }, { field: ['kit06'], hand: ['fox19', 'fox18'] });
  choose(g, '襲擊 斷腿兔子'); pick(g, ['cro05']); pick(g, ['fox19'], 1);
  assert.deepEqual(zone(g, 1, 'discard').sort(), ['fox19', 'kit06']);
});

test('kit07 不可觸岩鹽（供品）：被破壞時破壞你場上 1 個信徒', () => {
  const g = S({ field: ['cro05'] }, { field: ['kit07', 'fox13'] });
  choose(g, '襲擊 不可觸岩鹽'); pick(g, ['cro05']); pick(g, ['fox13'], 1);
  assert.deepEqual(zone(g, 1, 'discard').sort(), ['fox13', 'kit07']);
});

test('kit08 流淚的罪人（供品）：可棄手牌 1 張儀式，否則破壞你場上 1 個儀式', () => {
  const g = S({ field: ['cro05'] }, { field: ['kit08', 'fox02'], hand: ['fox03'] });
  choose(g, '襲擊 流淚的罪人'); pick(g, ['cro05']); pick(g, ['fox03'], 1);
  assert.ok(zone(g, 1, 'field').includes('fox02'));
  const g2 = S({ field: ['cro05'] }, { field: ['kit08', 'fox02'], hand: ['fox03'] });
  choose(g2, '襲擊 流淚的罪人'); pick(g2, ['cro05']); pick(g2, [], 1); pick(g2, ['fox02'], 1);
  assert.deepEqual(zone(g2, 1, 'discard').sort(), ['fox02', 'kit08']);
});

test('kit09 臃腫肉團（供品）：除外棄牌區另 1 張，然後洗回牌庫；有食材輸送帶也在牌庫（依 QA）', () => {
  const g = S({ field: ['cro05'] }, { field: ['kit09', 'kit20'], discard: ['fox19'] });
  choose(g, '襲擊 臃腫肉團'); pick(g, ['cro05']); pick(g, ['fox19'], 1);
  assert.deepEqual(zone(g, 1, 'exile'), ['fox19']);
  assert.equal(card(g, 1, 'kit09').zone, 'deck');
  assert.equal(g.P[1].conspiracy.length, 0);
  // 棄牌區沒有其他牌：中止，留在棄牌區
  const g2 = S({ field: ['cro05'] }, { field: ['kit09'] });
  choose(g2, '襲擊 臃腫肉團'); pick(g2, ['cro05']);
  assert.equal(card(g2, 1, 'kit09').zone, 'discard');
});

test('供品變罪惡後只能被聖戰襲擊（依 QA）', () => {
  const g = S({ field: ['cro05', 'mot05'] }, { field: [{ id: 'kit05', guilty: true }] });
  assert.equal(hasOption(g, '襲擊 迷路的露蹄'), false);
  assert.ok(hasOption(g, '聖戰：襲擊罪惡信徒 迷路的露蹄'));
});

test('kit10 餐廚學徒：你每擁有 2 凋零，從棄牌區或牌庫找 1 信徒放到場上', () => {
  const g = S({ hand: ['kit10'], field: ['kit06'], deck: ['fox17', 'cro05', 'fox17'] }, {});
  choose(g, '打出 餐廚學徒'); pick(g, ['cro05']); // 凋零 3 → 1 次
  assert.equal(card(g, 0, 'cro05').zone, 'field');
  assert.ok(isAction(g));
});

test('kit11 甜點師：你每擁有 2 禁忌，雙方各抽 1', () => {
  const g = S({ hand: ['kit11'], field: ['kit09'] }, {});
  choose(g, '打出 甜點師');
  assert.equal(g.P[0].hand.length, 1);
  assert.equal(g.P[1].hand.length, 1);
});

test('kit12 洗碗工：你場上每 1 墓園，將棄牌區 1 信徒洗回牌庫', () => {
  const g = S({ hand: ['kit12'], field: ['kit18', 'kit19'], discard: ['cro05', 'cro06', 'fox19'] }, {});
  choose(g, '打出 洗碗工'); pick(g, ['cro05']); pick(g, ['cro06']);
  assert.deepEqual(zone(g, 0, 'discard'), ['fox19']);
  assert.equal(g.P[0].deck.length, 8);
});

test('kit13 燒烤魔：破壞場上 1 個聲量 ≤ 你灰燼數的信徒', () => {
  const g = S({ hand: ['kit13'], field: ['kit07'] }, { field: ['fox13', 'cro05'] });
  choose(g, '打出 燒烤魔');
  assert.deepEqual(g.pending.options.map(o => o.cardId).sort(), ['fox13', 'kit13']);
  pick(g, ['fox13']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox13']);
});

test('kit14 調酒師：目標敵方下一回合無法執行儀式', () => {
  const g = S({ hand: ['kit14'] }, { field: ['fox03', 'fox18', 'fox17', 'fox14'] });
  assert.equal(g.ritualReady(card(g, 1, 'fox03')), true);
  choose(g, '打出 調酒師');
  endTurn(g); passRitual(g);
  assert.equal(g.active, 1);
  endTurn(g);
  assert.notEqual(g.pending.info, 'ritual');
  assert.ok(g.logs.some(l => /本回合無法執行儀式/.test(l.text)));
});

test('kit15 櫃檯接待員：控訴時被控訴的信徒拿回手；5 禁忌改為破壞', () => {
  const g = S({ hand: ['cro05'] }, { hand: ['kit15'] }, { factions: ['鴉教團', '禁忌廚房'] });
  choose(g, '打出 鴉仕女'); choose(g, '櫃檯接待員', 1);
  assert.deepEqual(zone(g, 0, 'hand'), ['cro05']);
  const g2 = S({ hand: ['cro05'] }, { hand: ['kit15'], field: ['kit09', 'kit07', 'kit11', 'kit02'] }, { factions: ['鴉教團', '禁忌廚房'] });
  choose(g2, '打出 鴉仕女'); choose(g2, '櫃檯接待員', 1);
  assert.deepEqual(zone(g2, 0, 'discard'), ['cro05']);
  // 控訴魔法時沒有效果
  const g3 = S({ hand: ['cro21'], field: ['cro05', 'cro06', 'cro07'] }, { hand: ['kit15'], field: ['fox19'] }, { factions: ['鴉教團', '禁忌廚房'] });
  choose(g3, '打出 黯燭'); choose(g3, '櫃檯接待員', 1);
  assert.equal(zone(g3, 0, 'field').length, 3);
});

test('kit16 餐廳經理：你的回合中，你的墓園離場→敵方抽 1；你的儀式離場→敵方棄 1', () => {
  const g = S({ hand: ['cro21'], field: ['kit16', 'kit19'] }, {});
  choose(g, '打出 黯燭'); pick(g, ['kit19']);
  assert.equal(g.P[1].hand.length, 1);
  const g2 = S({ hand: ['cro21'], field: ['kit16', 'kit03'] }, { hand: ['fox19'] });
  choose(g2, '打出 黯燭'); pick(g2, ['kit03']); pick(g2, ['fox19'], 1);
  assert.deepEqual(zone(g2, 1, 'discard'), ['fox19']);
  // 完成儀式也算離場
  const g3 = S({ field: ['kit16', 'kit03'], discard: N9 }, { hand: ['fox19'] });
  endTurn(g3); choose(g3, '執行儀式'); pick(g3, ['fox19'], 1);
  assert.equal(g3.P[0].score.length, 1);
  // 敵方回合不觸發
  const g4 = S({ hand: ['cro21'] }, { field: ['kit16', 'kit19'] });
  choose(g4, '打出 黯燭'); pick(g4, ['kit19']);
  assert.equal(g4.P[0].hand.length, 0);
});

test('kit17 屠宰場：每 3 禁忌，破壞自己 1 信徒，然後拿回棄牌區 1 張（臃腫肉團的效果先結算）', () => {
  const g = S({ field: ['kit17', 'kit09'], discard: ['cro05', 'cro06'] }, {});
  choose(g, '地點行動：屠宰場'); pick(g, ['kit09']);
  assert.match(g.pending.prompt, /臃腫肉團/);
  pick(g, ['cro05']); pick(g, ['cro06']);
  assert.equal(card(g, 0, 'kit09').zone, 'deck');
  assert.deepEqual(zone(g, 0, 'hand'), ['cro06']);
});

test('kit18 惡魔烤箱：4 灰燼時破壞自己 3 信徒，完成 1 儀式，破壞這個地點', () => {
  const g = S({ field: ['kit18', 'kit07', 'kit13', 'cro05', 'kit02'] }, {});
  choose(g, '地點行動：惡魔烤箱'); pick(g, ['kit07', 'kit13', 'cro05']);
  pick(g, ['kit02']);
  assert.deepEqual(zone(g, 0, 'score'), ['kit02']);
  assert.ok(zone(g, 0, 'discard').includes('kit18'));
  // 信徒不足 3：中止
  const g2 = S({ field: ['kit18', 'kit07', 'kit13', 'kit02'] }, {});
  choose(g2, '地點行動：惡魔烤箱');
  assert.ok(isAction(g2));
  assert.equal(g2.followers(0).length, 2);
});

test('kit19 冷藏櫃：執行儀式時（即使被控訴）將棄牌區 1 張置入陰謀區；儀式完成後破壞冷藏櫃', () => {
  const g = S({ field: ['kit19', 'kit03'], discard: ['fox19', ...N9] }, {});
  endTurn(g); choose(g, '執行儀式'); pick(g, ['fox19']);
  assert.deepEqual(zone(g, 0, 'conspiracy').filter(x => x === 'fox19'), ['fox19']);
  assert.ok(zone(g, 0, 'discard').includes('kit19'));
  const g2 = S({ field: ['kit19', 'kit03'], discard: ['fox19', ...N9] }, { hand: ['cro13'] });
  endTurn(g2); choose(g2, '執行儀式'); pick(g2, ['fox19']); choose(g2, '灰眼童', 1);
  assert.ok(zone(g2, 0, 'conspiracy').includes('fox19'));
  assert.ok(zone(g2, 0, 'field').includes('kit19'));
});

test('kit20 食材輸送帶：你場上的信徒被破壞後改為置入陰謀區', () => {
  const g = S({ field: ['kit01', 'kit20', 'cro05'] }, {});
  choose(g, '快速行動'); pick(g, ['cro05']);
  assert.deepEqual(zone(g, 0, 'conspiracy'), ['cro05']);
  choose(g, '我抽');
  // 敵方信徒不受影響
  const g2 = S({ hand: ['kit13'], field: ['kit20', 'kit07'] }, { field: ['fox13'] });
  choose(g2, '打出 燒烤魔'); pick(g2, ['fox13']);
  assert.deepEqual(zone(g2, 1, 'discard'), ['fox13']);
});

test('kit21 痛苦調味：敵方抽 1 再棄 1；星塵：完成敵方 1 儀式，然後每 2 自然敵方除外牌庫頂 1 張', () => {
  const g = S({ hand: ['kit21'] }, { hand: ['fox19'] });
  choose(g, '打出 痛苦調味'); pick(g, ['fox19'], 1);
  assert.equal(g.P[1].hand.length, 1);
  const g2 = S({ hand: ['kit21'], field: ['kit05', 'kit06', 'cro05'] }, { field: ['fox03'] });
  choose(g2, '打出 痛苦調味'); pick(g2, ['fox17'], 1); pick(g2, ['fox03']);
  assert.deepEqual(zone(g2, 1, 'score'), ['fox03']);
  assert.equal(g2.P[1].exile.length, 1); // 自然 3 → 1 張
});

test('kit22 開胃菜：敵方抽 2；星塵可改為敵方棄 2', () => {
  const g = S({ hand: ['kit22'] }, {});
  choose(g, '打出 開胃菜');
  assert.equal(g.P[1].hand.length, 2);
  const g2 = S({ hand: ['kit22'], field: ['cro05', 'cro06', 'cro07', 'cro08'] }, { hand: ['fox19', 'fox18', 'fox16'] });
  choose(g2, '打出 開胃菜'); choose(g2, '改為敵方棄置'); pick(g2, ['fox19', 'fox18'], 1);
  assert.deepEqual(zone(g2, 1, 'hand'), ['fox16']);
});

test('kit23 精心燉煮：完成你 1 個滿足條件的儀式；星塵：每 1 灰燼災厄 +1', () => {
  const g = S({ hand: ['kit23'], field: ['kit03', 'kit02', 'kit07'], discard: N9 }, {});
  assert.equal(g.magicCalamity(0, card(g, 0, 'kit23'), true), 1 + 2);
  choose(g, '打出 精心燉煮');
  assert.deepEqual(g.pending.options.map(o => o.cardId), ['kit03']);
  pick(g, ['kit03']);
  assert.deepEqual(zone(g, 0, 'score'), ['kit03']);
});

test('kit24 餘興節目：破壞雙方所有儀式；星塵：每 1 個離場的儀式，敵方棄 1 張', () => {
  const g = S({ hand: ['kit24'], field: ['kit02', 'cro05', 'cro06', 'cro07', 'cro08'] }, { field: ['fox03', 'fox02', 'fox10'], hand: ['fox19', 'fox18', 'fox16', 'fox15'] });
  // 祈願之子保護白狐儀式（自然 ≥3 才保護；這裡自然只有 1）
  choose(g, '打出 餘興節目'); pick(g, ['fox19', 'fox18', 'fox16'], 1);
  assert.equal(g.rituals(0).length + g.rituals(1).length, 0);
  assert.deepEqual(zone(g, 1, 'hand'), ['fox15']);
});

test('組牌：禁忌廚房預設牌組合法', () => {
  const { validateDeck, presetDeck } = require('../engine/engine');
  assert.ok(validateDeck(presetDeck('禁忌廚房')).ok);
});

test('同時觸發：餐廳經理＋冷藏櫃，由回合玩家選擇順序（依 QA）', () => {
  const mk = () => S({ field: ['kit16', 'kit19', 'kit03'], discard: ['fox19', ...N9] }, { hand: ['fox18', 'fox16'] });
  const g = mk();
  endTurn(g); choose(g, '執行儀式'); pick(g, ['fox19']);
  assert.equal(g.pending.info, 'order');
  choose(g, '先結算：餐廳經理'); // 先棄（2 張中選 1）再抽
  assert.equal(g.pending.options.length, 2);
  pick(g, ['fox18'], 1);
  assert.deepEqual(zone(g, 1, 'hand').sort(), ['fox16', 'fox17']);
  const g2 = mk();
  endTurn(g2); choose(g2, '執行儀式'); pick(g2, ['fox19']);
  choose(g2, '先結算：冷藏櫃'); // 冷藏櫃被破壞 → 經理（墓園）抽 1 先結算，之後才棄
  assert.equal(g2.pending.options.length, 3);
  pick(g2, ['fox18'], 1);
  assert.equal(g2.P[1].hand.length, 2);
});

test('同時觸發：惡魔烤箱同時破壞兩個供品，回合玩家選擇先結算哪個', () => {
  const g = S({ field: ['kit18', 'kit07', 'kit13', 'kit05', 'kit06', 'kit02'], hand: ['fox19'] }, {});
  choose(g, '地點行動：惡魔烤箱'); pick(g, ['kit07', 'kit05', 'kit06']);
  assert.equal(g.pending.info, 'order');
  assert.equal(g.pending.options.length, 3);
  choose(g, '先結算：斷腿兔子'); pick(g, ['fox19']);
  choose(g, '先結算：迷路的露蹄');
  pick(g, ['kit13']); // 岩鹽：破壞你場上 1 個信徒
  pick(g, ['kit02']); // 烤箱：完成儀式
  assert.deepEqual(zone(g, 0, 'score'), ['kit02']);
  assert.equal(g.P[1].hand.length, 1);
});
