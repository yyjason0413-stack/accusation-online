'use strict';
// 疫病中心 24 張測試
const test = require('node:test');
const { scen, choose, pick, zone, card, isAction, hasOption, labels, assert } = require('./helpers');
const D = ['fox17', 'fox17', 'fox17', 'fox17', 'fox17', 'fox17'];
// 預設：玩家一（疫病中心）回合
const S = (p0, p1, extra = {}) => scen(Object.assign({ factions: ['疫病中心', '白狐神社'], players: [Object.assign({ deck: D }, p0), Object.assign({ deck: D }, p1)] }, extra));
const opts = g => g.pending.options.map(o => o.cardId);

test('vir01 零號病患：敵方被附著信徒聲量 -1；快速行動控制敵方聲量 0 以下信徒', () => {
  const g = S({ field: ['vir01'], hand: ['vir20'] }, { field: ['fox06', 'fox05'] });
  choose(g, '打出 原始樣本-遺忘'); pick(g, ['fox05']);
  assert.equal(g.vol(card(g, 1, 'fox05')), 0);
  assert.equal(g.vol(card(g, 1, 'fox06')), 3);
  choose(g, '快速行動');
  assert.deepEqual(opts(g), ['fox05']);
  pick(g, ['fox05']);
  assert.ok(zone(g, 0, 'field').includes('fox05'));
  assert.equal(g.vol(card(g, 0, 'fox05')), 1, '轉為我方後不再受零號病患影響');
});

test('vir02 毀滅計畫：除外區 4 個信徒；7 個時災厄 +1', () => {
  const g = S({ field: ['vir02'], exile: ['vir05', 'vir06', 'vir08', 'vir11'] }, {});
  assert.equal(g.ritualReady(card(g, 0, 'vir02')), true);
  assert.equal(g.ritualCalamity(0, card(g, 0, 'vir02')), 2);
  const g2 = S({ field: ['vir02'], exile: ['vir05', 'vir06', 'vir08'] }, {});
  assert.equal(g2.ritualReady(card(g2, 0, 'vir02')), false);
  const g3 = S({ field: ['vir02'], exile: ['vir05', 'vir06', 'vir08', 'vir11', 'vir09', 'vir10', 'vir12'] }, {});
  assert.equal(g3.ritualCalamity(0, card(g3, 0, 'vir02')), 3);
});

test('vir03 擴大感染：4 自然＋場上 3 張附著魔法', () => {
  const sp = { field: ['vir03', 'vir07', 'vir10', 'vir12', 'vir17', 'vir20', 'vir19', 'fox_'] };
  const g = S({ field: ['vir03', 'vir07', 'vir10', 'vir12', 'vir17'] }, { field: ['fox05', 'fox06', 'fox07'] });
  assert.equal(g.ritualReady(card(g, 0, 'vir03')), false);
  const g2 = S({ field: ['vir03', 'vir07', 'vir10', 'vir12', 'vir17', { id: 'vir19', attach: 'fox05' }, { id: 'vir20', attach: 'fox06' }, { id: 'vir22', attach: 'fox07' }] }, { field: ['fox05', 'fox06', 'fox07'] });
  assert.equal(g2.attachedMagics().length, 3);
  assert.equal(g2.ritualReady(card(g2, 0, 'vir03')), true);
  void sp;
});

test('vir04 疫苗研製：6 種不同符號', () => {
  const g = S({ field: ['vir04', 'vir16', 'vir17', 'vir05'] }, {}); // 知識自然禁忌醫藥 = 4
  assert.equal(g.ritualReady(card(g, 0, 'vir04')), false);
  const g2 = S({ field: ['vir04', 'vir16', 'vir17', 'fox12'] }, {}); // +夜幕野性 = 6
  assert.equal(g2.ritualReady(card(g2, 0, 'vir04')), true);
});

test('vir05 垂死引路人：每 4 禁忌，敵方信徒聲量 -1', () => {
  const g = S({ field: ['vir05', 'vir12', 'vir15', 'fox17'] }, { field: ['fox06'] });
  assert.equal(g.vol(card(g, 1, 'fox06')), 3);
  const g2 = S({ field: ['vir05', 'vir12', 'vir15', 'vir16', 'fox17'] }, { field: ['fox06'] });
  assert.equal(g2.vol(card(g2, 1, 'fox06')), 2);
  assert.equal(g2.vol(card(g2, 0, 'vir12')), 1);
});

test('vir06 慈懷：控訴時若被控訴信徒聲量 < 你的聖地數，獲得其控制權', () => {
  const g = S({ hand: ['fox11'] }, { hand: ['vir06'], field: ['vir14', 'vir15', 'fox19'] }, { factions: ['白狐神社', '疫病中心'] });
  choose(g, '打出 燈籠巡遊'); choose(g, '慈懷', 1);
  assert.ok(zone(g, 1, 'field').includes('fox11'));
  const g2 = S({ hand: ['fox11'] }, { hand: ['vir06'], field: ['vir14', 'vir15'] }, { factions: ['白狐神社', '疫病中心'] });
  choose(g2, '打出 燈籠巡遊'); choose(g2, '慈懷', 1);
  assert.ok(zone(g2, 0, 'field').includes('fox11'));
});

test('vir07 感染的聖女：除外至多 2 信徒，每個放置棄牌區 2 荒野', () => {
  const g = S({ hand: ['vir07'], field: ['vir11', 'vir05'], discard: ['vir16', 'vir17', 'fox17', 'fox18', 'vir13'] }, {});
  choose(g, '打出 感染的聖女'); pick(g, ['vir11', 'vir05']);
  assert.deepEqual(opts(g).sort(), ['fox17', 'fox18', 'vir16', 'vir17']);
  pick(g, ['vir16', 'vir17', 'fox17', 'fox18']);
  assert.deepEqual(zone(g, 0, 'exile').sort(), ['vir05', 'vir11']);
  assert.equal(g.locations(0).length, 4);
});

test('vir08 解剖師：打出災厄 4 以上魔法時除外 1 信徒，拿回棄牌區 1 張', () => {
  const g = S({ hand: ['vir19'], field: ['vir08', 'vir11'], discard: ['vir13'] }, { field: ['fox06'] });
  choose(g, '打出 原始樣本-衰弱'); pick(g, ['vir11']); pick(g, ['vir13']); pick(g, ['fox06']);
  assert.deepEqual(zone(g, 0, 'exile'), ['vir11']);
  assert.deepEqual(zone(g, 0, 'hand'), ['vir13']);
  const g2 = S({ hand: ['vir20'], field: ['vir08', 'vir11'] }, { field: ['fox06'] });
  choose(g2, '打出 原始樣本-遺忘'); pick(g2, ['fox06']);
  assert.deepEqual(zone(g2, 0, 'exile'), []);
});

test('vir09 危險物運送員：本回合魔法災厄 +1，尋找 1 張魔法', () => {
  const g = S({ hand: ['vir09', 'vir20'], deck: ['fox17', 'vir24', 'fox17'] }, { field: ['fox06'] });
  choose(g, '打出 危險物運送員'); pick(g, ['vir24']);
  assert.ok(zone(g, 0, 'hand').includes('vir24'));
  assert.equal(g.magicCalamity(0, card(g, 0, 'vir20'), false), 2);
});

test('vir10 Δ議會花藝師：每個荒野可打出手牌或陰謀區 1 張魔法（不耗行動）', () => {
  const g = S({ hand: ['vir10', 'vir20'], conspiracy: ['vir22'], field: ['vir16', 'vir17'] }, { field: ['fox06', 'fox05'] });
  choose(g, '打出 Δ議會花藝師'); pick(g, ['vir20']); pick(g, ['fox06']); pick(g, ['vir22']); pick(g, ['fox05']);
  assert.equal(g.attachedMagics().length, 2);
  assert.equal(g.actionsLeft, 1);
});

test('vir11 Δ議會預言者：控訴聲量＋敵方罪惡數；完成儀式後魔法災厄 +1', () => {
  const g = S({ field: [{ id: 'fox05', guilty: true }, { id: 'fox06', guilty: true }] }, { hand: ['vir11'] }, { factions: ['白狐神社', '疫病中心'] });
  assert.equal(g.counterVolume(card(g, 1, 'vir11')), 2);
  const g2 = S({ field: ['vir11'], score: ['vir04'], hand: ['vir20'] }, {});
  assert.equal(g2.magicCalamity(0, card(g2, 0, 'vir20'), false), 2);
});

test('vir12 黑蓮：詠頌破壞荒野抽 1；你的回合荒野被破壞時魔法災厄 +1', () => {
  const g = S({ hand: ['vir12', 'vir20'], field: ['vir16'], deck: ['vir13', 'vir13'] }, {});
  choose(g, '打出 黑蓮'); pick(g, ['vir16']);
  assert.ok(zone(g, 0, 'hand').includes('vir13'));
  assert.equal(g.magicCalamity(0, card(g, 0, 'vir20'), false), 2);
});

test('vir13 扭曲書庫：控制聲量小於 知識/2 的敵方信徒', () => {
  const g = S({ field: ['vir13', 'vir16', 'vir06', 'vir11'] }, { field: ['fox05', 'fox06'] }); // 知識 4 → <2
  choose(g, '地點行動：扭曲書庫');
  assert.deepEqual(opts(g), ['fox05']);
  pick(g, ['fox05']);
  assert.ok(zone(g, 0, 'field').includes('fox05'));
});

test('vir14 隱密製藥廠：每 2 醫藥打出至多 1 張附著魔法（含棄牌區）', () => {
  const g = S({ field: ['vir01', 'vir14', 'vir09', 'vir17'], hand: ['vir24'], discard: ['vir19'], conspiracy: ['vir20'] }, { field: ['fox06', 'fox05'] });
  choose(g, '地點行動：隱密製藥廠');
  assert.deepEqual(opts(g).sort(), ['vir19', 'vir20']);
  pick(g, ['vir19']); pick(g, ['fox06']);
  pick(g, ['vir20']); pick(g, ['fox05']);
  assert.equal(g.vol(card(g, 1, 'fox06')), 3 - 2 - 1, '附著 -2，零號病患 -1');
});

test('vir15 隔離堡：聲量 1 以下無法襲擊；只有 1 個地點時雙方信徒 -1', () => {
  const g = S({ field: ['vir15', 'vir12', 'vir06'] }, { field: ['fox06'] });
  assert.equal(g.vol(card(g, 0, 'vir06')), 2);
  assert.equal(g.vol(card(g, 1, 'fox06')), 2);
  assert.deepEqual(g.attackers(0).map(c => c.id), ['vir06']);
  const g2 = S({ field: ['vir15', 'vir16', 'vir12', 'vir06'] }, {});
  assert.equal(g2.vol(card(g2, 0, 'vir06')), 3);
});

test('vir16／vir17 荒野無效果；守護 2／3', () => {
  const g = S({ field: ['vir16', 'vir17'] }, {});
  assert.equal(g.locGuard(card(g, 0, 'vir16')), 2);
  assert.equal(g.locGuard(card(g, 0, 'vir17')), 3);
});

test('vir18 起源地探索：從牌庫或棄牌區尋找魔法；星塵可破壞荒野並置入陰謀區', () => {
  const g = S({ hand: ['vir18'], field: ['vir16', 'vir05', 'vir06'], discard: ['vir24'] }, {});
  choose(g, '打出 起源地探索'); pick(g, ['vir24']); pick(g, ['vir16']);
  assert.deepEqual(zone(g, 0, 'conspiracy'), ['vir18']);
  assert.ok(zone(g, 0, 'hand').includes('vir24'));
});

test('vir19 原始樣本-衰弱：附著 -2；星塵每自然本回合 -1；魔法離場後恢復', () => {
  const g = S({ hand: ['vir19'], field: ['vir07', 'vir10'] }, { field: ['fox13'] }); // 自然 2
  choose(g, '打出 原始樣本-衰弱'); pick(g, ['fox13']);
  assert.equal(g.vol(card(g, 1, 'fox13')), 3 - 2 - 2);
  const m = card(g, 0, 'vir19'); g.destroy(m);
  assert.equal(g.vol(card(g, 1, 'fox13')), 1);
});

test('vir20 原始樣本-遺忘：不會變為罪惡；星塵每醫藥災厄 +1', () => {
  const g = S({ hand: ['vir20'], field: ['vir08', 'vir09'] }, { field: ['fox13'] });
  assert.equal(g.magicCalamity(0, card(g, 0, 'vir20'), true), 3);
  choose(g, '打出 原始樣本-遺忘'); pick(g, ['fox13']);
  assert.equal(g.makeGuilty(card(g, 1, 'fox13')), false);
});

test('vir21 原始樣本-寄生：罪惡信徒改為荒野（守護＝原聲量）；星塵獲得控制權；魔法離場恢復', () => {
  const g = S({ hand: ['vir21'], field: ['vir05', 'vir06'] }, { field: [{ id: 'fox09', guilty: true }, { id: 'fox13', guilty: true }, 'fox12'] });
  choose(g, '打出 原始樣本-寄生');
  assert.deepEqual(opts(g), ['fox09']);
  pick(g, ['fox09']);
  const c = card(g, 0, 'fox09');
  assert.ok(c, '獲得控制權');
  assert.equal(g.def(c).type, '地點'); assert.equal(g.locType(c), '荒野'); assert.equal(g.locGuard(c), 2);
  assert.ok(g.locations(0).includes(c));
  g.destroy(card(g, 0, 'vir21'));
  assert.equal(g.def(c).type, '信徒'); assert.equal(c.guilty, true);
  // 受控的信徒在場上，離場時回到原持有者
  g.destroy(c); assert.ok(zone(g, 1, 'discard').includes('fox09'));
});

test('vir22 進化樣本-啟示：附著 -2；星塵每 2 禁忌將 1 個信徒變罪惡', () => {
  const g = S({ hand: ['vir22'], field: ['vir05', 'vir12', 'vir15', 'fox17'] }, { field: ['fox13', 'fox12'] }); // 禁忌 3 → 1
  choose(g, '打出 進化樣本-啟示'); pick(g, ['fox13']); pick(g, ['fox12']);
  assert.equal(card(g, 1, 'fox12').guilty, true);
  assert.equal(g.vol(card(g, 1, 'fox13')), 1);
});

test('vir23 進化樣本-救贖：附著 -2；星塵控制聲量小於該信徒的敵方信徒', () => {
  const g = S({ hand: ['vir23'], field: ['vir05', 'vir06', 'vir07'] }, { field: ['fox14', 'fox09'] });
  choose(g, '打出 進化樣本-救贖'); pick(g, ['vir07']); // 4-2=2
  assert.deepEqual(opts(g), ['fox14']);
  pick(g, ['fox14']);
  assert.ok(zone(g, 0, 'field').includes('fox14'));
});

test('vir24 進化樣本-鼠王：除外 1 信徒及所有同聲量信徒；星塵勝利條件', () => {
  const g = S({ hand: ['vir24'], field: ['vir05', 'vir08', 'vir06', 'vir09', 'vir10'], exile: ['vir11', 'vir12'] }, { field: ['fox09', 'fox13'] });
  choose(g, '打出 進化樣本-鼠王'); pick(g, ['vir05']);
  assert.deepEqual(zone(g, 1, 'exile'), ['fox09']);
  assert.equal(zone(g, 0, 'exile').length, 4);
  // 星塵 5 達成；除外區信徒 4 vs 場上 4 → 未勝利
  assert.equal(g.winner, null);
  const g2 = S({ hand: ['vir24'], field: ['vir05', 'vir08', 'vir06', 'vir09', 'vir10'], exile: ['vir11', 'vir12', 'vir07'] }, { field: ['fox09'] });
  choose(g2, '打出 進化樣本-鼠王'); pick(g2, ['vir05']);
  assert.equal(g2.winner, 0);
});

test('裁定 疫苗研製：自己場上合計 6 種不同符號（含取得控制權的敵方牌、教主、儀式）', () => {
  const g = S({ field: ['vir04', 'vir16', 'vir17', 'vir05'] }, { field: ['fox12'] }); // 知識自然禁忌醫藥 = 4
  assert.equal(g.ritualReady(card(g, 0, 'vir04')), false);
  g.takeControl(card(g, 1, 'fox12'), 0); // 夜幕野性
  assert.equal(g.ritualReady(card(g, 0, 'vir04')), true);
  const g2 = S({ field: ['vir04', 'vir16', 'vir17'] }, { field: ['fox12', 'fox05'] }); // 敵方場上的符號不算
  assert.equal(g2.ritualReady(card(g2, 0, 'vir04')), false);
});
