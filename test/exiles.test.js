'use strict';
// 放逐者 21 張 + 新規則（獻祭、解構、聖戰、供品、附著、觸發佇列）測試
const test = require('node:test');
const { scen, choose, pick, pickFail, zone, card, isAction, hasOption, endTurn, passRitual, labels, assert } = require('./helpers');
const D = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'];
const F = ['白狐神社', '鴉教團'];

// ---------- 通用新規則 ----------
test('獻祭：每張被獻祭的牌減少該儀式 1 個任意符號需求；儀式離場後獻祭牌進棄牌區', () => {
  // 稻魂祭需 5 自然；場上 稻魂祭1 + 稻原2 = 3，獻祭 2 張 → 滿足
  const g = scen({ factions: F, players: [{ field: ['fox03', 'fox18'], under: [{ id: 'cro05', under: 'fox03' }], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'fox03')), false);
  const g2 = scen({ factions: F, players: [{ field: ['fox03', 'fox18'], under: [{ id: 'cro05', under: 'fox03' }, { id: 'cro06', under: 'fox03' }], deck: D }, { hand: ['cro10'], deck: D }] });
  assert.equal(g2.ritualReady(card(g2, 0, 'fox03')), true);
  g2.destroy(card(g2, 0, 'fox03'));
  assert.deepEqual(zone(g2, 0, 'discard').sort(), ['cro05', 'cro06', 'fox03']);
  assert.equal(g2.P[0].under.length, 0);
});

test('獻祭：不能減少非符號條件（無聲奉獻的信徒數量）', () => {
  const g = scen({ players: [{ field: ['cro04', 'cro05', 'cro06'], under: [{ id: 'cro07', under: 'cro04' }, { id: 'cro10', under: 'cro04' }], deck: D }, { deck: D }] });
  assert.equal(g.ritualReady(card(g, 0, 'cro04')), false);
});

test('獻祭的牌是隱藏資訊：對手只看得到張數', () => {
  const g = scen({ players: [{ field: ['cro03'], under: [{ id: 'cro07', under: 'cro03' }], deck: D }, { deck: D }] });
  const v1 = g.view(1);
  assert.equal(v1.players[0].under, undefined);
  assert.equal(v1.players[0].underCount, 1);
  assert.equal(g.view(0).players[0].under[0].id, 'cro07');
});

test('解構X（通用）：用回合行動打出可解構 1 個儀式，減少 X 個符號需求；變罪惡後不再解構', () => {
  // 以門教團的「瘋狂數學家」（解構1）測試通用機制
  const g = scen({ factions: F, players: [{ hand: ['dor05'], field: ['fox03', 'fox18', 'fox17'], deck: D }, { deck: D }] });
  // 自然：稻魂祭1 + 稻原2 + 森1 = 4 / 5
  assert.equal(g.ritualReady(card(g, 0, 'fox03')), false);
  choose(g, '打出 瘋狂數學家'); choose(g, '解構 稻魂祭');
  assert.equal(g.ritualReady(card(g, 0, 'fox03')), true);
  g.makeGuilty(card(g, 0, 'dor05'));
  assert.equal(card(g, 0, 'dor05').deconAt, null);
  assert.equal(g.ritualReady(card(g, 0, 'fox03')), false);
});

test('駐守地點離場：駐守信徒留在場上、不再駐守', () => {
  const g = scen({ factions: F, players: [{ field: ['fox19', { id: 'fox08', guard: 'fox19' }], deck: D }, { deck: D }] });
  g.destroy(card(g, 0, 'fox19'));
  assert.equal(card(g, 0, 'fox08').zone, 'field');
  assert.equal(card(g, 0, 'fox08').guardAt, null);
});

// ---------- 放逐者 ----------
test('exi01 斷翅的鴉：抽 1 張，然後棄 1 張', () => {
  const g = scen({ players: [{ hand: ['exi01', 'fox18'], deck: D }, { deck: D }] });
  choose(g, '打出 斷翅的鴉'); pick(g, ['fox18']);
  assert.deepEqual(zone(g, 0, 'hand'), ['fox17']);
  assert.deepEqual(zone(g, 0, 'discard'), ['fox18']);
  assert.equal(g.stardust(0), 1); // 卡面沒有星塵加成
});

test('exi02 酒鬼傑克：控訴時破壞自己場上 1 個信徒', () => {
  const g = scen({ players: [{ hand: ['cro05'], deck: D }, { hand: ['exi02'], field: ['fox13'], deck: D }] });
  choose(g, '打出 鴉仕女'); choose(g, '酒鬼傑克', 1); pick(g, ['fox13'], 1);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox13']);
  assert.equal(card(g, 1, 'exi02').guilty, true);
});

test('exi03 黑尾：雙方執行儀式災厄 -1（可疊加、可為負）', () => {
  const g = scen({ players: [{ field: ['cro03', 'exi03'], deck: D }, { field: ['fox03', 'exi03'], deck: D }] });
  assert.equal(g.ritualCalamity(0, card(g, 0, 'cro03')), -1);
  assert.equal(g.ritualCalamity(1, card(g, 1, 'fox03')), 0);
});

test('exi04 沼澤女巫：駐守 3，但不能駐守荒野', () => {
  const g = scen({ factions: F, players: [{ hand: ['exi04'], field: ['fox17', 'fox19'], deck: D }, { deck: D }] });
  choose(g, '打出 沼澤女巫');
  assert.equal(hasOption(g, '神隱之森'), false);
  choose(g, '駐守 本殿');
  assert.equal(g.locGuard(card(g, 0, 'fox19')), 8);
});

test('exi05 竊密者：獻祭手牌或棄牌區至多 1 張儀式；場上沒儀式則不能獻祭', () => {
  const g = scen({ players: [{ hand: ['exi05', 'cro02'], field: ['cro03'], deck: D }, { deck: D }] });
  choose(g, '打出 竊密者'); pick(g, ['cro02']);
  assert.equal(g.P[0].under.length, 1);
  assert.equal(card(g, 0, 'cro02').underOf, card(g, 0, 'cro03').uid);
  const g2 = scen({ players: [{ hand: ['exi05', 'cro02'], deck: D }, { deck: D }] });
  choose(g2, '打出 竊密者');
  assert.ok(isAction(g2));
  assert.equal(g2.P[0].under.length, 0);
});

test('exi06 說謊的病患：控訴時除外自己；變為罪惡時除外自己', () => {
  const g = scen({ players: [{ hand: ['cro05'], deck: D }, { hand: ['exi06'], deck: D }] });
  choose(g, '打出 鴉仕女'); choose(g, '說謊的病患', 1);
  assert.deepEqual(zone(g, 1, 'exile'), ['exi06']);
  const g2 = scen({ players: [{ field: ['exi06'], deck: D }, { field: ['fox17'], deck: D }] });
  choose(g2, '襲擊 神隱之森'); pick(g2, ['exi06']);
  assert.deepEqual(zone(g2, 0, 'exile'), ['exi06']);
});

test('exi07 空白：打出原始災厄 ≤2 的魔法時，解除自己 1 信徒罪惡並將空白拿回手；沒有罪惡信徒則中止', () => {
  const g = scen({ players: [{ hand: ['cro21'], field: ['exi07', { id: 'cro05', guilty: true }], deck: D }, { field: ['fox19'], deck: D }] });
  choose(g, '打出 黯燭'); pick(g, ['cro05']);
  assert.equal(card(g, 0, 'cro05').guilty, false);
  assert.deepEqual(zone(g, 0, 'hand'), ['exi07']);
  pick(g, ['fox19']);
  const g2 = scen({ players: [{ hand: ['cro21'], field: ['exi07'], deck: D }, { field: ['fox19'], deck: D }] });
  choose(g2, '打出 黯燭'); pick(g2, ['fox19']);
  assert.ok(zone(g2, 0, 'field').includes('exi07'));
  const g3 = scen({ players: [{ hand: ['cro24'], field: ['exi07', { id: 'cro05', guilty: true }], deck: D }, { deck: D }] });
  choose(g3, '打出 鳴災'); // 原始災厄 3 → 不觸發
  assert.match(g3.pending.prompt, /鳴災/);
});

test('exi08 邪祟獵人：除外場上 1 個聲量 ≥3 的罪惡信徒', () => {
  const g = scen({ players: [{ hand: ['exi08'], deck: D }, { field: [{ id: 'fox13', guilty: true }, { id: 'fox09', guilty: true }], deck: D }] });
  choose(g, '打出 邪祟獵人');
  assert.deepEqual(g.pending.options.map(o => o.cardId), ['fox13']);
  pick(g, ['fox13']);
  assert.deepEqual(zone(g, 1, 'exile'), ['fox13']);
});

test('exi09 盜火賊：除外自己棄牌區至多 2 張魔法，再除外敵方棄牌區等量的牌', () => {
  const g = scen({ players: [{ hand: ['exi09'], discard: ['cro21', 'cro22', 'cro05'], deck: D }, { discard: ['fox17', 'fox18', 'fox19'], deck: D }] });
  choose(g, '打出 盜火賊'); pick(g, ['cro21', 'cro22']); pick(g, ['fox18', 'fox19']);
  assert.deepEqual(zone(g, 0, 'exile'), ['cro21', 'cro22']);
  assert.deepEqual(zone(g, 1, 'exile'), ['fox18', 'fox19']);
});

test('exi10 追書者地窖：你棄牌區每有 1 張儀式，你的魔法災厄 +1', () => {
  const g = scen({ players: [{ field: ['exi10'], hand: ['cro24'], discard: ['cro02', 'cro03'], deck: D }, { deck: D }] });
  assert.equal(g.magicCalamity(0, card(g, 0, 'cro24'), false), 5);
});

test('exi11 惱人廣播器：控訴時效果被無效，廣播器置入陰謀區（之後可從陰謀區打出）', () => {
  const g = scen({ players: [{ hand: ['cro05'], field: ['exi11'], deck: D }, { hand: ['cro13'], field: ['fox13'], deck: D }] });
  choose(g, '打出 鴉仕女'); choose(g, '灰眼童', 1);
  assert.deepEqual(zone(g, 1, 'field'), ['fox13', 'cro13']); // 沒有破壞
  assert.deepEqual(zone(g, 0, 'conspiracy'), ['exi11']);
  assert.ok(hasOption(g, '打出 惱人廣播器（陰謀區）'));
});

test('exi11 惱人廣播器：雙方都有時，回合玩家的先結算', () => {
  const g = scen({ players: [{ hand: ['cro05'], field: ['exi11'], deck: D }, { hand: ['cro13'], field: ['exi11', 'fox13'], deck: D }] });
  choose(g, '打出 鴉仕女'); choose(g, '灰眼童', 1);
  assert.deepEqual(zone(g, 0, 'conspiracy'), ['exi11']);
  assert.ok(zone(g, 1, 'field').includes('exi11'));
});

test('exi12 Δ議會紀念碑：2 個庭院且已完成 1 儀式時，儀式災厄 +1', () => {
  const g = scen({ players: [{ field: ['exi12', 'dor17', 'cro03'], score: ['cro04'], deck: D }, { deck: D }] });
  assert.equal(g.ritualCalamity(0, card(g, 0, 'cro03')), 2);
  const g2 = scen({ players: [{ field: ['exi12', 'dor17', 'cro03'], deck: D }, { deck: D }] });
  assert.equal(g2.ritualCalamity(0, card(g2, 0, 'cro03')), 1);
});

test('exi13 亡途鐵道：棄 1 張手牌，棄牌區每 7 張，本回合執行儀式災厄 +1', () => {
  const g = scen({ players: [{ field: ['exi13', 'cro03'], hand: ['fox18'], discard: ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'], deck: D }, { deck: D }] });
  choose(g, '地點行動：亡途鐵道'); pick(g, ['fox18']);
  assert.equal(g.P[0].flags.ritualCalBonus, 2);
  assert.equal(g.ritualCalamity(0, card(g, 0, 'cro03')), 3);
});

test('exi14 荊棘墓園：棄牌區每 1 個荒野破壞敵方 1 地點或信徒，除外所有荒野，破壞自己', () => {
  const g = scen({ players: [{ field: ['exi14'], discard: ['fox17', 'fox18'], deck: D }, { field: ['fox19', 'fox13'], deck: D }] });
  choose(g, '地點行動：荊棘墓園'); pick(g, ['fox19']); pick(g, ['fox13']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox19', 'fox13']);
  assert.deepEqual(zone(g, 0, 'exile').sort(), ['fox17', 'fox18']);
  assert.deepEqual(zone(g, 0, 'discard'), ['exi14']);
});

test('exi15 劣質藥劑：解除 1 信徒罪惡；星塵獻祭 1 個非罪惡信徒並使本回合儀式災厄 +1', () => {
  const g = scen({ players: [{ hand: ['exi15'], field: ['cro03', { id: 'cro05', guilty: true }, 'cro06', 'cro07', 'cro08'], deck: D }, { deck: D }] });
  choose(g, '打出 劣質藥劑'); pick(g, ['cro05']); pick(g, ['cro08']);
  assert.equal(card(g, 0, 'cro05').guilty, false);
  assert.equal(card(g, 0, 'cro08').zone, 'under');
  assert.equal(g.P[0].flags.ritualCalBonus, 1);
});

test('exi16 影子地圖：從牌庫找 1 張加入手中；星塵可將手牌地點放到場上', () => {
  const g = scen({ players: [{ hand: ['exi16'], field: ['cro05', 'cro06'], deck: ['fox17', 'cro19', 'fox17'] }, { deck: D }] });
  choose(g, '打出 影子地圖'); pick(g, ['cro19']); pick(g, ['cro19']);
  assert.ok(zone(g, 0, 'field').includes('cro19'));
  assert.equal(g.P[0].deck.length, 2);
});

test('exi17 不穩定召喚：除外棄牌區 1 儀式，本回合儀式災厄 +2；星塵：每個圖書館魔法災厄 +1；沒儀式則中止', () => {
  const g = scen({ players: [{ hand: ['exi17'], field: ['fox15', 'exi10', 'cro05', 'cro06', 'cro07'], discard: ['cro02'], deck: D }, { deck: D }] });
  // 災厄 2 + 圖書館 2（星塵）+ 追書者地窖（棄牌區 1 儀式）1 = 5
  assert.equal(g.magicCalamity(0, card(g, 0, 'exi17'), true), 5);
  choose(g, '打出 不穩定召喚'); pick(g, ['cro02']);
  assert.equal(g.P[0].flags.ritualCalBonus, 2);
  const g2 = scen({ players: [{ hand: ['exi17'], deck: D }, { deck: D }] });
  choose(g2, '打出 不穩定召喚');
  assert.equal(g2.P[0].flags.ritualCalBonus, 0);
});

test('exi18 推倒聖像：附著敵方教主使其失去能力；附著的魔法在場上；星塵：每個放逐者信徒災厄 +1', () => {
  const g = scen({ players: [{ hand: ['exi18'], field: ['exi01', 'exi02', 'cro05', 'cro06'], deck: D }, { field: ['fox01', 'fox03'], deck: D }] });
  assert.equal(g.magicCalamity(0, card(g, 0, 'exi18'), true), 3);
  assert.equal(g.ritualCalamity(1, card(g, 1, 'fox03')), 3);
  choose(g, '打出 推倒聖像');
  assert.equal(card(g, 0, 'exi18').zone, 'field');
  assert.equal(card(g, 0, 'exi18').attachTo, card(g, 1, 'fox01').uid);
  assert.equal(g.ritualCalamity(1, card(g, 1, 'fox03')), 2);
  endTurn(g); passRitual(g);
  assert.equal(hasOption(g, '快速行動'), false);
  // 黯燭破壞附著的魔法 → 回到持有者棄牌區，教主恢復
  const g2 = scen({ players: [{ hand: ['cro21'], field: [{ id: 'exi18', attach: 'fox01' }], deck: D }, { field: ['fox01'], deck: D }] });
  choose(g2, '打出 黯燭'); pick(g2, ['exi18']);
  assert.deepEqual(zone(g2, 0, 'discard').sort(), ['cro21', 'exi18']);
  assert.equal(g2.active_(card(g2, 1, 'fox01')), true);
});

test('exi31 小麵團狗（供品）：無法控訴、無法襲擊、可被敵方襲擊；被破壞時入陰謀區並使自己 1 信徒變罪惡', () => {
  const g = scen({ players: [{ hand: ['cro05'], deck: D }, { hand: ['exi31'], deck: D }] });
  choose(g, '打出 鴉仕女');
  assert.ok(isAction(g, 0)); // 供品不能控訴
  const g2 = scen({ players: [{ field: ['cro14'], deck: D }, { field: ['exi31', 'fox13'], deck: D }] });
  assert.ok(hasOption(g2, '襲擊 小麵團狗'));
  choose(g2, '襲擊 小麵團狗'); pick(g2, ['cro14']);
  assert.deepEqual(zone(g2, 1, 'conspiracy'), ['exi31']);
  pick(g2, ['fox13'], 1);
  assert.equal(card(g2, 1, 'fox13').guilty, true);
  const g3 = scen({ players: [{ field: ['exi31'], deck: D }, { field: ['fox17'], deck: D }] });
  assert.equal(hasOption(g3, '襲擊'), false); // 供品不能襲擊
  // 罪惡的供品：不能被一般信徒襲擊，被破壞時正常進棄牌區
  const g4 = scen({ players: [{ field: ['cro14'], deck: D }, { field: [{ id: 'exi31', guilty: true }], deck: D }] });
  assert.equal(hasOption(g4, '襲擊 小麵團狗'), false);
});

test('exi31 被破壞時效果先於原效果其餘部分結算（觸發佇列）', () => {
  // 鳴災破壞 2 個罪惡信徒…這裡用夜渡橋：破壞小麵團狗後，對手先選罪惡，再繼續第 2 次破壞
  const g = scen({ players: [{ field: ['cro16', 'cro17', 'cro11', 'cro08', 'cro12'], deck: D }, { field: ['exi31', 'fox13', 'fox09'], deck: D }] });
  // 禁忌 4 → 破壞 2 次
  choose(g, '地點行動：夜渡橋'); pick(g, ['exi31']);
  assert.equal(g.pending.player, 1); // 小麵團狗觸發先結算
  pick(g, ['fox13'], 1);
  assert.equal(g.pending.player, 0);
  pick(g, ['fox09']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox09']);
});

test('exi32 小報記者：控訴時展示自己手牌；在自己回合被破壞時展示敵方手牌', () => {
  const g = scen({ players: [{ hand: ['cro05'], deck: D }, { hand: ['exi32', 'fox18'], deck: D }] });
  choose(g, '打出 鴉仕女'); choose(g, '小報記者', 1);
  assert.ok(g.logs.some(l => l.to === 0 && /手牌：稻原/.test(l.text)));
  const g2 = scen({ players: [{ field: ['exi32', 'cro16', 'cro17', 'cro11'], deck: D }, { hand: ['fox19'], deck: D }] });
  choose(g2, '地點行動：夜渡橋'); pick(g2, ['exi32']);
  assert.ok(g2.logs.some(l => l.to === 0 && /手牌：本殿/.test(l.text)));
});

test('exi33 殉道者（聖戰）：可聖戰襲擊敵方罪惡信徒；只能單獨襲擊；被襲擊的牌改為除外，然後除外自己', () => {
  const g = scen({ players: [{ field: ['exi33', 'cro05'], deck: D }, { field: [{ id: 'fox09', guilty: true }, 'fox17'], deck: D }] });
  assert.ok(hasOption(g, '聖戰：襲擊罪惡信徒 白衣武士'));
  choose(g, '聖戰');
  assert.deepEqual(g.pending.options.map(o => o.cardId), ['exi33']); // 只有聖戰信徒可參加
  pick(g, ['exi33']);
  assert.deepEqual(zone(g, 1, 'exile'), ['fox09']);
  assert.deepEqual(zone(g, 0, 'exile'), ['exi33']);
  // 襲擊地點：只能單獨
  const g2 = scen({ players: [{ field: ['exi33', 'cro14'], deck: D }, { field: ['fox18', 'fox19'], deck: D }] });
  choose(g2, '襲擊 稻原');
  assert.equal(pickFail(g2, ['exi33', 'cro14']), false);
  pick(g2, ['exi33']);
  assert.deepEqual(zone(g2, 1, 'exile'), ['fox18']);
  // 不能與結靈星塵一起襲擊（只能單獨）
  const g3 = scen({ factions: F, players: [{ hand: ['fox24'], field: ['exi33', 'fox14'], deck: D }, { field: ['fox18'], deck: D }] });
  assert.equal(g3.attackers(0).some(c => c.id === 'exi33'), true);
});

test('聖戰視為襲擊：燈籠巡遊使下一回合也不能聖戰', () => {
  const g = scen({ players: [{ field: ['exi33'], deck: D }, { field: [{ id: 'fox09', guilty: true }], deck: D }] });
  assert.ok(g.legalActions(0).some(a => a.kind === 'crusade'));
  g.P[0].cannotAttackTurn = g.turnNo;
  assert.equal(g.legalActions(0).some(a => a.kind === 'crusade'), false);
});
