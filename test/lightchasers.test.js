'use strict';
// 逐光者 24 張測試
const test = require('node:test');
const { Game } = require('../engine/engine');
const { scen, choose, pick, pickFail, zone, card, isAction, hasOption, endTurn, passRitual, labels, assert } = require('./helpers');
const D = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'];
const F = ['逐光者', '白狐神社'];
const S = (p0, p1, extra = {}) => scen(Object.assign({ factions: F, players: [Object.assign({ deck: D }, p0), Object.assign({ deck: D }, p1)] }, extra));

test('mot01 灰燼皇后：你的信徒襲擊聲量 +1；快速行動：破壞自己 1 地點，然後解除自己 1 信徒罪惡', () => {
  const g = S({ field: ['mot01', 'mot19', 'mot07', { id: 'mot10', guilty: true }] }, { field: ['fox18'] });
  assert.equal(g.attackVolume(card(g, 0, 'mot07')), 3);
  assert.equal(g.attackVolume(card(g, 1, 'fox18')) >= 0, true);
  choose(g, '快速行動'); pick(g, ['mot19']); pick(g, ['mot10']);
  assert.deepEqual(zone(g, 0, 'discard'), ['mot19']);
  assert.equal(card(g, 0, 'mot10').guilty, false);
  assert.equal(hasOption(g, '快速行動'), false); // 每回合限一次
  // 被推倒聖像附著：襲擊加成消失
  const g2 = S({ field: ['mot01', 'mot07', { id: 'exi18', attach: 'mot01' }] }, {});
  assert.equal(g2.attackVolume(card(g2, 0, 'mot07')), 2);
});

test('mot02 燃燒飛蛾：需要 4 自然 4 灰燼（獻祭可補）', () => {
  const field = ['mot02', 'mot19', 'mot20', 'fox18', 'mot05'];
  const g = S({ field }, {});
  assert.equal(g.ritualReady(card(g, 0, 'mot02')), false); // 自然4 灰燼3
  const g2 = S({ field, under: [{ id: 'fox17', under: 'mot02' }] }, {});
  assert.equal(g2.ritualReady(card(g2, 0, 'mot02')), true);
});

test('mot03 回歸原始：敵方場上信徒 3 個以下；遊戲開始時在手中則棄置其餘手牌', () => {
  const g = S({ field: ['mot03'] }, { field: ['fox05', 'fox06', 'fox07'] });
  assert.equal(g.ritualReady(card(g, 0, 'mot03')), true);
  const g2 = S({ field: ['mot03'] }, { field: ['fox05', 'fox06', 'fox07', 'fox08'] });
  assert.equal(g2.ritualReady(card(g2, 0, 'mot03')), false);
  const g3 = new Game({ seed: 3, factions: ['逐光者', '白狐神社'] }).start();
  while (g3.pending && g3.pending.info === 'mulligan') g3.answer(g3.pending.player, []);
  assert.deepEqual(g3.P[0].hand.map(c => c.id), ['mot03']);
  assert.equal(g3.P[0].discard.length, 5);
  assert.equal(g3.P[1].hand.length, 6);
  // 調度時把回歸原始放回牌庫底 → 不觸發
  const g4 = new Game({ seed: 3, factions: ['逐光者', '白狐神社'] }).start();
  while (g4.pending && g4.pending.info === 'mulligan') {
    const p = g4.pending.player, i = g4.pending.options.findIndex(o => o.cardId === 'mot03');
    g4.answer(p, i >= 0 ? [i] : []);
  }
  assert.equal(g4.P[0].hand.length, 6);
  assert.equal(g4.P[0].discard.length, 0);
});

test('mot04 最後的燈火：場上至少 4 個地點且有「橋」', () => {
  const g = S({ field: ['mot04', 'mot19', 'mot20', 'fox19', 'mot16'] }, {});
  assert.equal(g.ritualReady(card(g, 0, 'mot04')), false);
  const g2 = S({ field: ['mot04', 'mot19', 'mot20', 'fox19', 'mot17'] }, {});
  assert.equal(g2.ritualReady(card(g2, 0, 'mot04')), true);
});

test('mot05 縱火犯：聖戰；每 1 灰燼襲擊聲量 +1；可多個聖戰信徒一起襲擊', () => {
  const g = S({ field: ['mot05', 'mot19', 'mot08'] }, { field: [{ id: 'cro13', guilty: true }, 'fox17'] });
  assert.equal(g.attackVolume(card(g, 0, 'mot05')), 5); // 3 + 灰燼2
  choose(g, '聖戰：襲擊罪惡信徒 灰眼童');
  assert.deepEqual(g.pending.options.map(o => o.cardId).sort(), ['mot05', 'mot08']);
  pick(g, ['mot05']);
  assert.deepEqual(zone(g, 1, 'discard'), ['cro13']);
  assert.equal(card(g, 0, 'mot05').guilty, true);
});

test('mot06 夜鹿：敵方展示手牌，由敵方選 1 個聲量最小的信徒放到場上並變為罪惡；不會變罪惡的就只放到場上', () => {
  const g = S({ hand: ['mot06'] }, { hand: ['cro05', 'cro14', 'cro10', 'fox19'] });
  choose(g, '打出 夜鹿'); choose(g, '不控訴', 1);
  assert.deepEqual(g.pending.options.map(o => o.cardId).sort(), ['cro10', 'cro14']);
  assert.equal(g.pending.player, 1);
  pick(g, ['cro10'], 1);
  assert.equal(card(g, 1, 'cro10').zone, 'field');
  assert.equal(card(g, 1, 'cro10').guilty, true);
  assert.ok(g.logs.some(l => l.to === 0 && /手牌：鴉仕女/.test(l.text)));
  const g2 = S({ hand: ['mot06'] }, { hand: ['fox14', 'fox19'] });
  choose(g2, '打出 夜鹿'); pick(g2, ['fox14'], 1);
  assert.equal(card(g2, 1, 'fox14').zone, 'field');
  assert.equal(card(g2, 1, 'fox14').guilty, false);
});

test('mot07 發光蘑菇：你每擁有 2 灰燼，將場上 1 個信徒置入陰謀區', () => {
  const g = S({ hand: ['mot07'], field: ['mot19', 'mot05'] }, { field: ['cro05', { id: 'cro06', guilty: true }] });
  choose(g, '打出 發光蘑菇'); // 灰燼 3 → 1 次
  pick(g, ['cro06']);
  assert.deepEqual(zone(g, 1, 'conspiracy'), ['cro06']);
  assert.equal(card(g, 1, 'cro06').guilty, false);
  assert.ok(isAction(g));
});

test('mot08 貓修女：聖戰；敵方場上每 1 個信徒，控訴聲量 -1', () => {
  const g = S({ field: ['cro05', 'cro06'] }, { hand: ['mot08'] }, { active: 0 });
  assert.equal(g.counterVolume(card(g, 1, 'mot08')), 3);
  assert.equal(require('../engine/engine').DEFS.mot08.crusade, true);
});

test('mot09 鶚面祭司：聖戰、只能單獨襲擊；襲擊後可破壞敵方 1 個聲量小於你野性數的信徒', () => {
  const g = S({ field: ['mot01', 'mot09', 'fox13', 'mot05'] }, { field: [{ id: 'cro14', guilty: true }, 'cro10', 'cro05'] });
  // 野性 = 皇后1 + 鶚面1 + 狐渡1 = 3；鶚面襲擊聲量 1+1 = 2
  choose(g, '聖戰：襲擊罪惡信徒 鴉雛');
  assert.equal(pickFail(g, ['mot09', 'mot05']), false);
  pick(g, ['mot09']);
  assert.deepEqual(g.pending.options.map(o => o.cardId), ['cro10']);
  pick(g, ['cro10']);
  assert.deepEqual(zone(g, 1, 'discard').sort(), ['cro10', 'cro14']);
});

test('mot10 蠟人：破壞你 1 個荒野，然後破壞敵方 1 個地點；沒有荒野則中止', () => {
  const g = S({ hand: ['mot10'], field: ['mot19'] }, { field: ['fox19'] });
  choose(g, '打出 蠟人'); pick(g, ['mot19']); pick(g, ['fox19']);
  assert.deepEqual(zone(g, 0, 'discard'), ['mot19']);
  assert.deepEqual(zone(g, 1, 'discard'), ['fox19']);
  const g2 = S({ hand: ['mot10'], field: ['fox19'] }, { field: ['fox19'] });
  choose(g2, '打出 蠟人');
  assert.ok(isAction(g2));
  assert.ok(zone(g2, 1, 'field').includes('fox19'));
});

test('mot11 逐星霧蹄：聖戰；從牌庫找至多 1 信徒放到場上，並啟動其駐守', () => {
  const g = S({ hand: ['mot11'], field: ['fox19'], deck: ['fox17', 'mot13', 'fox17'] }, {});
  choose(g, '打出 逐星霧蹄'); pick(g, ['mot13']); choose(g, '駐守 本殿');
  assert.equal(card(g, 0, 'mot13').guardAt, card(g, 0, 'fox19').uid);
  assert.equal(g.locGuard(card(g, 0, 'fox19')), 8);
  assert.equal(g.P[0].deck.length, 2);
});

test('mot12 螢火蟲男孩：你每擁有 2 煉金，雙方獻祭牌庫頂 1 張；沒有儀式的一方不獻祭', () => {
  const g = S({ hand: ['mot12'], field: ['mot20', 'mot09', 'mot02'] }, { field: ['fox03'] });
  choose(g, '打出 螢火蟲男孩');
  assert.equal(g.P[0].under.length, 1);
  assert.equal(g.P[1].under.length, 1);
  assert.equal(g.P[0].deck.length, 5);
  const g2 = S({ hand: ['mot12'], field: ['mot20', 'mot09', 'mot02'] }, {});
  choose(g2, '打出 螢火蟲男孩');
  assert.equal(g2.P[0].under.length, 1);
  assert.equal(g2.P[1].deck.length, 6);
});

test('mot13 寄生的信者：駐守3，被駐守的地點類型改為荒野；沼澤女巫因此移出（維持非罪惡）', () => {
  const g = S({ hand: ['mot13'], field: ['fox19', { id: 'exi04', guard: 'fox19' }] }, {});
  assert.equal(g.locGuard(card(g, 0, 'fox19')), 8);
  choose(g, '打出 寄生的信者'); choose(g, '駐守 本殿');
  assert.equal(g.locType(card(g, 0, 'fox19')), '荒野');
  assert.equal(card(g, 0, 'exi04').guardAt, null);
  assert.equal(card(g, 0, 'exi04').guilty, false);
  assert.equal(g.locGuard(card(g, 0, 'fox19')), 8);
  g.makeGuilty(card(g, 0, 'mot13'));
  assert.equal(g.locType(card(g, 0, 'fox19')), '聖地');
});

test('mot14 鳥語者：你的回合中，你的荒野被破壞時，將場上 1 信徒變為罪惡（先於原效果其餘部分）', () => {
  const g = S({ hand: ['mot10'], field: ['mot14', 'mot19'] }, { field: ['fox19', 'cro05'] });
  choose(g, '打出 蠟人'); pick(g, ['mot19']);
  assert.match(g.pending.prompt, /鳥語者/);
  pick(g, ['cro05']); pick(g, ['fox19']);
  assert.equal(card(g, 1, 'cro05').guilty, true);
  // 寄生的信者使地點變荒野，被破壞也會觸發
  const g2 = S({ hand: ['cro21'], field: ['mot14', 'fox19', { id: 'mot13', guard: 'fox19' }] }, { field: ['cro05'] });
  choose(g2, '打出 黯燭'); pick(g2, ['fox19']);
  assert.match(g2.pending.prompt, /鳥語者/);
  // 敵方回合破壞你的荒野不觸發
  const g3 = S({ hand: ['cro21'] }, { field: ['mot14', 'mot19', 'cro05'] });
  choose(g3, '打出 黯燭'); pick(g3, ['mot19']);
  assert.equal(card(g3, 1, 'mot19').zone, 'discard');
  assert.ok(!(g3.pending.prompt || '').includes('鳥語者'));
});

test('mot15 搬運者：你場上每 1 個橋，將棄牌區 1 地點置入陰謀區，荒野改為放到場上', () => {
  const g = S({ hand: ['mot15'], field: ['mot17', 'fox16'], discard: ['mot19', 'fox19'] }, {});
  choose(g, '打出 搬運者'); pick(g, ['mot19']); pick(g, ['fox19']);
  assert.ok(zone(g, 0, 'field').includes('mot19'));
  assert.deepEqual(zone(g, 0, 'conspiracy'), ['fox19']);
});

test('mot16 漆黑樹洞：擁有 4 煉金時，每回合第一次襲擊（含聖戰）不花費行動', () => {
  const g = S({ field: ['mot16', 'mot20', 'mot09', 'mot12', 'mot17', 'mot07'] }, { field: ['fox17', 'fox18'] });
  const a0 = g.actionsLeft;
  assert.ok(hasOption(g, '不花費行動'));
  choose(g, '襲擊 神隱之森'); pick(g, ['mot12']);
  assert.equal(g.actionsLeft, a0);
  assert.equal(hasOption(g, '不花費行動'), false);
  choose(g, '襲擊 稻原'); pick(g, ['mot07']);
  assert.equal(g.actionsLeft, a0 - 1);
  const g2 = S({ field: ['mot16', 'mot20', 'mot09', 'mot12'] }, { field: ['fox17'] });
  assert.equal(hasOption(g2, '不花費行動'), false); // 煉金只有 3
});

test('mot17 蠅橋：地點行動，你每擁有 2 自然，將場上 1 信徒變為罪惡', () => {
  const g = S({ field: ['mot17', 'mot19', 'mot20', 'fox18'] }, { field: ['cro05', 'cro06'] });
  choose(g, '地點行動：蠅橋'); pick(g, ['cro05']); pick(g, ['cro06']);
  assert.equal(card(g, 1, 'cro05').guilty && card(g, 1, 'cro06').guilty, true);
});

test('mot18 誘蛾林道：你襲擊時，可獻祭你棄牌區 1 張牌', () => {
  const g = S({ field: ['mot18', 'mot02', 'mot05'], discard: ['fox19'] }, { field: ['fox18'] });
  choose(g, '襲擊 稻原'); pick(g, ['mot05']); pick(g, ['fox19']);
  assert.equal(card(g, 0, 'fox19').zone, 'under');
  assert.deepEqual(zone(g, 1, 'discard'), ['fox18']);
  // 沒有儀式則不詢問
  const g2 = S({ field: ['mot18', 'mot05'], discard: ['fox17'] }, { field: ['fox18'] });
  choose(g2, '襲擊 稻原'); pick(g2, ['mot05']);
  assert.ok(isAction(g2));
});

test('mot19 燒毀的林地／mot20 黃金平原：沒有效果的荒野，提供符號', () => {
  const g = S({ field: ['mot19', 'mot20'] }, {});
  assert.equal(g.countLocType(0, '荒野'), 2);
  assert.deepEqual(g.symbolsAll(0), { 自然: 2, 灰燼: 1, 煉金: 1 });
});

test('mot21 森林大火：破壞雙方所有地點（駐守信徒留下）；星塵：每 1 灰燼災厄 +1', () => {
  const g = S({ hand: ['mot21'], field: ['mot19', 'mot05', 'mot07', 'mot10'] }, { field: ['fox19', { id: 'fox08', guard: 'fox19' }] });
  assert.equal(g.magicCalamity(0, card(g, 0, 'mot21'), true), 1 + 4);
  choose(g, '打出 森林大火');
  assert.equal(g.locations(0).length + g.locations(1).length, 0);
  assert.equal(card(g, 1, 'fox08').zone, 'field');
});

test('mot22 蛾之夢：雙方場上所有信徒置入陰謀區（附著的魔法回棄牌區）；星塵：每 1 野性災厄 +1', () => {
  const g = S({ hand: ['mot22'], field: ['mot09', 'mot06', 'mot08', { id: 'mot23', attach: 'mot09' }] }, { field: ['cro05', { id: 'cro06', guilty: true }] });
  assert.equal(g.magicCalamity(0, card(g, 0, 'mot22'), true), 1 + 3);
  choose(g, '打出 蛾之夢');
  assert.deepEqual(zone(g, 0, 'conspiracy').sort(), ['mot06', 'mot08', 'mot09']);
  assert.deepEqual(zone(g, 1, 'conspiracy').sort(), ['cro05', 'cro06']);
  assert.deepEqual(zone(g, 0, 'discard').sort(), ['mot22', 'mot23']);
});

test('mot23 動物語言：附著於你的信徒使其獲得聖戰；星塵：本回合該信徒襲擊聲量 +3', () => {
  const g = S({ hand: ['mot23'], field: ['cro05', 'cro06'] }, { field: [{ id: 'cro13', guilty: true }] });
  choose(g, '打出 動物語言'); pick(g, ['cro05']);
  assert.equal(card(g, 0, 'mot23').zone, 'field');
  assert.equal(g.isCrusader(card(g, 0, 'cro05')), true);
  assert.equal(g.attackVolume(card(g, 0, 'cro05')), 7);
  choose(g, '聖戰'); pick(g, ['cro05']);
  assert.deepEqual(zone(g, 1, 'discard'), ['cro13']);
  // 下一回合加成消失
  const c = card(g, 0, 'cro05'); g.turnNo++;
  assert.equal(g.attackVolume(c), 4);
  // 沒有信徒：不能附著，進棄牌區
  const g2 = S({ hand: ['mot23'] }, {});
  choose(g2, '打出 動物語言');
  assert.deepEqual(zone(g2, 0, 'discard'), ['mot23']);
});

test('mot24 點亮燈火：你每擁有 2 自然，將棄牌區或陰謀區 1 地點放到場上；星塵：棄牌區每 1 荒野災厄 +1', () => {
  const g = S({ hand: ['mot24'], field: ['fox18', 'mot13', 'fox08', 'mot19'], discard: ['mot20', 'fox17'], conspiracy: ['fox19'] }, {});
  assert.equal(g.magicCalamity(0, card(g, 0, 'mot24'), true), 3 + 2);
  choose(g, '打出 點亮燈火'); // 自然 = 稻原2 + 寄生1 + 稻草人1 + 林地1 = 5 → 2 次
  pick(g, ['fox19']); pick(g, ['mot20']);
  assert.ok(zone(g, 0, 'field').includes('fox19') && zone(g, 0, 'field').includes('mot20'));
});

test('組牌：逐光者預設牌組合法、可與放逐者混搭', () => {
  const { validateDeck, presetDeck } = require('../engine/engine');
  assert.ok(validateDeck(presetDeck('逐光者')).ok);
  const main = presetDeck('逐光者').slice(4, 16);
  const v = validateDeck(['mot01', 'mot02', 'mot03', 'mot04', ...main, 'exi01', 'exi02', 'fox05', 'fox06', 'fox07', 'fox08', 'fox09', 'fox10']);
  assert.ok(v.ok, v.errors.join());
});
