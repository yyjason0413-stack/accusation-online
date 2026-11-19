'use strict';
// 白狐神社、鴉教團 共 48 張卡的效果實作。
// 介面：chant(g,p,self) 詠頌；onCounter(g,p,self) 控訴時；locAction(g,p,self) 地點行動；
//       magic(g,p,self,sd) 魔法（sd=星塵效果是否啟動）；cond(g,p) 儀式條件；canQuick/quick 教主快速行動。
const fl = Math.floor;
const T = (g, c) => g.def(c).type;

function* returnFromDiscard(g, p, filter, prompt, harm = false) {
  const cands = g.P[p].discard.filter(c => filter(c));
  const c = yield* g.pickOne(p, { prompt, cards: cands, harm });
  if (c) g.toHand(c, p);
  return c;
}
function* searchToField(g, p, filter, prompt) {
  const pl = g.P[p];
  const cands = pl.discard.filter(filter).concat(pl.deck.filter(filter)).filter(c => g.canEnterByEffect(c));
  const sel = yield* g.pick(p, { prompt, cards: cands, min: 0, max: 1, harm: false, info: 'search' });
  const c = sel[0];
  if (c) {
    const fromDeck = c.zone === 'deck';
    g.move(c, 'field');
    g.log(`${pl.name} 從${fromDeck ? '牌庫' : '棄牌區'}將 ${g.cname(c)} 放置到場上。`);
  }
  // 搜尋過牌庫後洗牌
  g.shuffle(pl.deck);
  return c;
}

const EFFECTS = {
  // ======== 鴉教團 ========
  cro01: { // 第十三夜
    onChant(g, self) { g.log('《第十三夜》：觸發詠頌，抽 1 張牌。'); g.draw(self.owner, 1); },
    canQuick: (g, p) => g.P[p].hand.length >= 2,
    *quick(g, p) {
      const pl = g.P[p];
      const ds = yield* g.pick(p, { prompt: '《第十三夜》：選擇 2 張手牌棄置', cards: pl.hand.slice(), min: 2, max: 2, harm: false });
      for (const c of ds) g.discardFromHand(c);
      yield* returnFromDiscard(g, p, c => !ds.includes(c), '《第十三夜》：選擇棄牌區另外 1 張牌拿回手');
    },
  },
  cro02: { needs: { 凋零: 4 }, cond: (g, p) => g.P[p].discard.filter(c => T(g, c) === '信徒').length >= 4 },
  cro03: { cond: (g, p) => g.locations(p).length >= 3 },
  cro04: { cond: (g, p) => g.followers(p).filter(c => (g.def(c).symbols || []).includes('夜幕')).length >= 4 },
  cro05: { *chant(g, p) { g.draw(p, 1); } },
  cro06: {
    *chant(g, p) {
      const sel = yield* g.pick(p, { prompt: '《鴉司祭》：可將手牌至多 1 個信徒放置到場上並觸發其詠頌', cards: g.P[p].hand.filter(c => T(g, c) === '信徒' && g.canEnterByEffect(c)), min: 0, max: 1, harm: false });
      const f = sel[0];
      if (!f) return;
      g.move(f, 'field');
      g.log(`《鴉司祭》將 ${g.cname(f)} 放置到場上。`);
      if (g.def(f).chant) yield* g.doChant(p, f);
    },
  },
  cro07: {
    *chant(g, p) {
      g.draw(p, 1);
      for (const q of [p, g.opp(p)]) {
        const c = yield* g.pickOne(q, { prompt: '《信使》：雙方玩家棄置 1 張手牌，請選擇你要棄置的牌', cards: g.P[q].hand.slice(), harm: false });
        if (c) g.discardFromHand(c);
      }
    },
  },
  cro08: {
    *chant(g, p) {
      const c = yield* g.pickOne(p, { prompt: '《烏血醫生》：將場上 1 個信徒變為罪惡', cards: g.allFollowers().filter(c => !c.guilty), harm: true });
      if (c) g.makeGuilty(c);
    },
  },
  cro09: {
    *chant(g, p) {
      // 原作者裁定：拿回手的信徒不觸發詠頌（即使場上有墓園）。
      yield* returnFromDiscard(g, p, c => T(g, c) === '信徒' && (g.vol(c)) <= 3, '《失眠掘墓人》：將棄牌區 1 個聲量 3 以下的信徒拿回手');
    },
  },
  cro10: {
    *chant(g, p) {
      const c = yield* g.pickOne(p, { prompt: '《迷路的亡魂》：破壞敵方場上 1 個儀式', cards: g.rituals(g.opp(p)), harm: true });
      if (c) g.destroy(c);
    },
  },
  cro11: { noCounter: true, magicCalMod: (g, self, p) => p === self.owner ? fl(g.sym(p, '夜幕') / 3) : 0 },
  cro12: {
    *onCounter(g, p) { yield* returnFromDiscard(g, p, c => T(g, c) === '地點', '《鐘塔守衛》：將棄牌區 1 個地點拿回手'); },
  },
  cro13: {
    *onCounter(g, p) {
      const c = yield* g.pickOne(p, { prompt: '《灰眼童》：破壞你場上 1 個信徒', cards: g.followers(p), harm: false });
      if (c) g.destroy(c);
    },
  },
  cro14: {
    neverGuilty: true,
    *chant(g, p) {
      const pl = g.P[p];
      const n = Math.min(2, pl.hand.length);
      const ds = yield* g.pick(p, { prompt: '《鴉雛》：棄置 2 張手牌', cards: pl.hand.slice(), min: n, max: n, harm: false });
      for (const c of ds) g.discardFromHand(c);
      yield* returnFromDiscard(g, p, c => !ds.includes(c), '《鴉雛》：將棄牌區另外 1 張牌拿回手');
    },
  },
  cro15: {
    *chant(g, p) {
      const n = fl(g.sym(p, '凋零') / 3), o = g.opp(p);
      g.log(`《黑夫人》：凋零 ${g.sym(p, '凋零')}，敵方棄置 ${n} 張手牌。`);
      for (let i = 0; i < n; i++) {
        const c = yield* g.pickOne(o, { prompt: `《黑夫人》：請棄置 1 張手牌（${i + 1}/${n}）`, cards: g.P[o].hand.slice(), harm: false });
        if (c) g.discardFromHand(c);
      }
    },
  },
  cro16: {
    *locAction(g, p) {
      const n = fl(g.sym(p, '禁忌') / 2);
      g.log(`《夜渡橋》：禁忌 ${g.sym(p, '禁忌')}，可破壞 ${n} 個信徒。`);
      for (let i = 0; i < n; i++) {
        const c = yield* g.pickOne(p, { prompt: `《夜渡橋》：破壞場上 1 個信徒（${i + 1}/${n}）`, cards: g.allFollowers(), harm: true });
        if (c) g.destroy(c);
      }
    },
  },
  cro17: { destroyAfterCounter: () => true },
  cro18: { nest: (g, self) => g.sym(self.owner, '知識') >= 4 },
  cro19: {
    *locAction(g, p, self) {
      const n = g.sym(p, '凋零');
      g.log(`《羽墓園》：凋零 ${n}，將棄牌區至多 ${n} 個信徒拿回手。`);
      for (let i = 0; i < n; i++) {
        const c = yield* returnFromDiscard(g, p, c => T(g, c) === '信徒', `《羽墓園》：將棄牌區 1 個信徒拿回手（${i + 1}/${n}）`);
        if (!c) break;
      }
      g.destroy(self);
    },
  },
  cro20: {
    *locAction(g, p, self) {
      const n = fl(g.P[p].discard.filter(c => T(g, c) === '信徒').length / 2);
      g.log(`《湖畔墓園》：可將棄牌區 ${n} 張魔法拿回手。`);
      for (let i = 0; i < n; i++) {
        const c = yield* returnFromDiscard(g, p, c => T(g, c) === '魔法', `《湖畔墓園》：將棄牌區 1 張魔法拿回手（${i + 1}/${n}）`);
        if (!c) break;
      }
      g.destroy(self);
    },
  },
  cro21: {
    calMod: (g, p, self, sd) => sd ? 2 : 0,
    *magic(g, p) {
      const cards = [...g.P[0].field, ...g.P[1].field].filter(c => T(g, c) !== '教主');
      const c = yield* g.pickOne(p, { prompt: '《黯燭》：破壞場上 1 張非教主牌', cards, harm: true });
      if (c) g.destroy(c);
    },
  },
  cro22: {
    *magic(g, p, self, sd) {
      const c = yield* g.pickOne(p, { prompt: '《烏骨療法》：解除場上 1 個信徒的罪惡', cards: g.allFollowers().filter(c => c.guilty), harm: false });
      if (c) g.unGuilty(c);
      if (sd) {
        const s = yield* g.pick(p, { prompt: '《烏骨療法》星塵效果：可將場上 1 個信徒變為罪惡', cards: g.allFollowers().filter(c => !c.guilty), min: 0, max: 1, harm: true });
        if (s[0]) g.makeGuilty(s[0]);
      }
    },
  },
  cro23: {
    *magic(g, p, self, sd) {
      const o = g.P[g.opp(p)];
      if (sd) { o.noCounterTurn = g.turnNo; g.log(`《失聲詛咒》星塵效果：本回合 ${o.name} 無法控訴。`); }
      else { o.noCounterChantTurn = g.turnNo; g.log(`《失聲詛咒》：本回合 ${o.name} 無法控訴你的詠頌。`); }
    },
  },
  cro24: {
    *magic(g, p, self, sd) {
      let mode = 'destroy';
      if (sd) mode = yield* g.ask(p, '《鳴災》星塵效果：要破壞還是除外？', [{ key: 'destroy', label: '破壞至多 2 個罪惡信徒' }, { key: 'exile', label: '改為除外至多 2 個罪惡信徒' }]);
      const sel = yield* g.pick(p, { prompt: `《鳴災》：${mode === 'exile' ? '除外' : '破壞'}場上至多 2 個罪惡信徒`, cards: g.allFollowers().filter(c => c.guilty), min: 0, max: 2, harm: true });
      for (const c of sel) mode === 'exile' ? g.exile(c) : g.destroy(c);
    },
  },

  // ======== 白狐神社 ========
  fox01: { // 雪白尾
    ritualCalMod: (g, self, p) => p === self.owner ? 1 : 0,
    canQuick: (g, p) => [...g.P[p].discard, ...g.P[p].deck].some(c => g.def(c).locationType === '荒野'),
    *quick(g, p) { yield* searchToField(g, p, c => g.def(c).locationType === '荒野', '《雪白尾》：從棄牌區或牌庫尋找至多 1 個「荒野」放置到場上'); },
  },
  fox02: { needs: { 野性: 5 }, cond: (g, p) => g.P[p].field.some(c => c.id === 'fox01' || c.id === 'fox10') },
  fox03: { needs: { 自然: 5 } },
  fox04: { cond: (g, p) => g.locations(p).reduce((s, l) => s + g.locGuard(l), 0) >= 18 },
  fox05: {
    *chant(g, p) {
      const n = fl(g.sym(p, '夜幕') / 2);
      g.log(`《神巫》：夜幕 ${g.sym(p, '夜幕')}，可將 ${n} 個地點拿回手。`);
      for (let i = 0; i < n; i++) {
        const c = yield* returnFromDiscard(g, p, c => T(g, c) === '地點', `《神巫》：將棄牌區 1 個地點拿回手（${i + 1}/${n}）`);
        if (!c) break;
      }
    },
  },
  fox06: {
    *chant(g, p) {
      const holy = () => g.locations(p).filter(l => g.locType(l) === '聖地');
      if (holy().length < 2) { g.log('《神隱修士》：場上聖地不足 2 個，沒有效果。'); return; }
      const r = yield* g.pickOne(p, { prompt: '《神隱修士》：選擇完成你場上 1 個儀式', cards: g.rituals(p), harm: false });
      if (!r) { g.log('《神隱修士》：場上沒有儀式。'); return; }
      g.complete(r);
      const h = yield* g.pickOne(p, { prompt: '《神隱修士》：破壞你場上 1 個「聖地」', cards: holy(), harm: false });
      if (h) g.destroy(h);
    },
  },
  fox07: {
    *chant(g, p) {
      const w = yield* g.pickOne(p, { prompt: '《焚香師》：破壞你場上 1 個「荒野」', cards: g.locations(p).filter(l => g.locType(l) === '荒野'), harm: false });
      if (!w) { g.log('《焚香師》：場上沒有荒野。'); return; }
      const gv = g.locGuard(w);
      g.destroy(w);
      const vol = c => g.vol(c);
      const sel = yield* g.pick(p, {
        prompt: `《焚香師》：破壞對方場上至多 2 個聲量總和 ≤ ${gv} 的信徒`, cards: g.followers(g.opp(p)), min: 0, max: 2, harm: true,
        validate: cs => cs.reduce((s, c) => s + vol(c), 0) <= gv, vals: vol, sumMax: gv,
      });
      for (const c of sel) g.destroy(c);
    },
  },
  fox08: { noAttackOn: (g, self, l) => g.locType(l) === '荒野' && l.owner === self.owner },
  fox09: { attackVol: (g, self) => g.sym(self.owner, '夜幕') },
  fox10: { protectRituals: (g, self) => g.sym(self.owner, '自然') >= 3 },
  fox12: { counterVol: (g, self) => 2 * g.guardingCount(self.owner) },
  fox13: { counterVol: g => 2 * [...g.locations(0), ...g.locations(1)].filter(l => g.locType(l) === '橋').length },
  fox14: { neverGuilty: true },
  fox11: {
    *chant(g, p) {
      const o = g.P[g.opp(p)];
      o.cannotAttackTurn = g.turnNo + 1;
      g.log(`《燈籠巡遊》：${o.name} 下一回合無法襲擊。`);
    },
  },
  fox15: {
    *locAction(g, p) {
      const n = fl(g.sym(p, '知識') / 2);
      g.log(`《神巫之間》：知識 ${g.sym(p, '知識')}，可執行 ${n} 次。`);
      for (let i = 0; i < n; i++) {
        const fs = g.followers(p);
        const c = yield* g.pickOne(p, { prompt: `《神巫之間》：選擇你場上 1 個信徒解除罪惡並啟動駐守（${i + 1}/${n}）`, cards: fs.filter(f => f.guilty).concat(fs.filter(f => !f.guilty)), harm: false });
        if (!c) break;
        g.unGuilty(c);
        if (g.def(c).guardX && c.zone === 'field' && !c.guilty) yield* g.offerGuard(p, c);
      }
    },
  },
  fox16: { ritualCalMod: (g, self, p) => p === self.owner ? fl(g.sym(p, '野性') / 3) : 0 },
  fox17: {}, fox18: {},
  fox19: {
    *locAction(g, p) { yield* searchToField(g, p, c => T(g, c) === '儀式', '《本殿》：從棄牌區或牌庫尋找至多 1 個儀式放置到場上'); },
  },
  fox20: {
    *locAction(g, p, self) {
      const gv = g.locGuard(self);
      if (self.zone !== 'field' || gv < 10) { g.log(`《遺忘神龕》：守護 ${gv} 未達 10，沒有效果。`); return; }
      const r = yield* g.pickOne(p, { prompt: '《遺忘神龕》：完成你場上 1 個儀式', cards: g.rituals(p), harm: false });
      if (!r) { g.log('《遺忘神龕》：場上沒有儀式。'); return; }
      g.complete(r);
      g.destroy(self);
    },
  },
  fox21: {
    *magic(g, p, self, sd) {
      const vol = c => g.vol(c);
      const c = yield* g.pickOne(p, { prompt: '《狐火》：破壞場上 1 個聲量 3 以下的信徒', cards: g.allFollowers().filter(c => vol(c) <= 3), harm: true });
      if (c) g.destroy(c);
      if (sd) {
        const s = yield* g.pick(p, { prompt: '《狐火》星塵效果：可額外破壞場上 1 個聲量 2 以下的信徒', cards: g.allFollowers().filter(c => vol(c) <= 2), min: 0, max: 1, harm: true });
        if (s[0]) g.destroy(s[0]);
      }
    },
  },
  fox22: {
    *magic(g, p, self, sd) {
      const o = g.opp(p), oh = g.P[o].hand;
      if (oh.length) {
        const fols = oh.filter(c => T(g, c) === '信徒');
        const opts = fols.map(c => ({ key: c.uid, uid: c.uid, cardId: c.id, label: `棄置 ${g.def(c).name}` })).concat([{ key: 0, label: '不棄信徒（改為隨機棄置 1 張手牌）' }]);
        const k = yield* g.ask(o, '《魂燈》：你可棄置手牌 1 個信徒，否則隨機棄置 1 張手牌', opts);
        if (k) g.discardFromHand(oh.find(c => c.uid === k));
        else g.discardFromHand(oh[g.rand(oh.length)], true);
      }
      if (sd) yield* returnFromDiscard(g, p, c => T(g, c) === '信徒', '《魂燈》星塵效果：將你棄牌區 1 個信徒拿回手');
    },
  },
  fox23: {
    *magic(g, p, self, sd) {
      const n = fl(g.locations(p).length / 2);
      g.log(`《時雨》：場上 ${g.locations(p).length} 個地點，抽 ${n} 張牌。`);
      g.draw(p, n);
      if (sd) {
        let k = 0;
        for (const w of g.locations(p).filter(l => g.locType(l) === '荒野')) if (g.destroy(w)) k++;
        g.log(`《時雨》星塵效果：破壞了 ${k} 個荒野。`);
        if (k) {
          const sel = yield* g.pick(p, { prompt: `《時雨》：破壞敵方場上 ${k} 個信徒`, cards: g.followers(g.opp(p)), min: k, max: k, harm: true });
          for (const c of sel) g.destroy(c);
        }
      }
    },
  },
  fox24: {
    *magic(g, p, self, sd) {
      const pl = g.P[p];
      const b = 2 * g.guardingCount(p);
      pl.flags.attackBonus = (pl.flags.attackBonus || 0) + b;
      g.log(`《結靈》：本回合下一次襲擊聲量 +${b}。`);
      if (sd) {
        if (!g.canAttack(p)) { g.log('《結靈》星塵效果：本回合無法襲擊。'); return; }
        const tg = g.attackTargets(p).filter(l => g.maxAttack(p, true) + 2 + pl.flags.attackBonus >= g.targetValue(l));
        if (!tg.length) { g.log('《結靈》星塵效果：沒有可襲擊的地點。'); return; }
        const opts = tg.map(l => ({ key: l.uid, uid: l.uid, cardId: l.id, label: `襲擊 ${g.def(l).name}（${g.def(l).type === '地點' ? '守護' : '聲量'} ${g.targetValue(l)}）` })).concat([{ key: 0, label: '不襲擊' }]);
        const k = yield* g.ask(p, '《結靈》星塵效果：以聲量 2 進行一次襲擊（可搭配其他信徒，不需花費行動）', opts);
        if (k) yield* g.attack(p, tg.find(l => l.uid === k), 2, false);
      }
    },
  },
};

// ======== 放逐者 ========
Object.assign(EFFECTS, {
  exi01: { *chant(g, p) { // 斷翅的鴉
    g.draw(p, 1);
    const c = yield* g.pickOne(p, { prompt: '《斷翅的鴉》：棄置你 1 張手牌', cards: g.P[p].hand.slice(), harm: false });
    if (c) g.discardFromHand(c);
  } },
  exi02: { *onCounter(g, p) { // 酒鬼傑克
    const c = yield* g.pickOne(p, { prompt: '《酒鬼傑克》：破壞你場上 1 個信徒', cards: g.followers(p), harm: false });
    if (c) g.destroy(c);
  } },
  exi03: { ritualCalMod: () => -1 }, // 黑尾：雙方執行儀式災厄 -1
  exi04: { cantGuardType: '荒野' },  // 沼澤女巫
  exi05: { *chant(g, p) { // 竊密者：獻祭手牌或棄牌區至多 1 張儀式
    if (!g.rituals(p).length) { g.log('《竊密者》：場上沒有儀式，無法獻祭。'); return; }
    const pl = g.P[p];
    const sel = yield* g.pick(p, { prompt: '《竊密者》：可獻祭你手牌或棄牌區至多 1 張儀式', cards: pl.hand.concat(pl.discard).filter(c => T(g, c) === '儀式'), min: 0, max: 1, harm: false });
    yield* g.sacrifice(p, sel);
  } },
  exi06: { // 說謊的病患
    *onCounter(g, p, self) { g.log('《說謊的病患》控訴時：除外這個信徒。'); g.exile(self); },
    onGuilty(g, self) { g.log('《說謊的病患》變為罪惡：除外這個信徒。'); g.exile(self); },
  },
  exi07: { // 空白
    *onMagicPlayed(g, self, m) {
      if ((g.def(m).calamity || 0) > 2) return;
      const p = self.owner;
      const c = yield* g.pickOne(p, { prompt: '《空白》：解除你場上 1 個信徒的罪惡（然後將《空白》拿回手）', cards: g.followers(p).filter(f => f.guilty), harm: false });
      if (!c) { g.log('《空白》：沒有罪惡信徒，效果中止。'); return; }
      g.unGuilty(c);
      if (self.zone === 'field') g.toHand(self);
    },
  },
  exi08: { *chant(g, p) { // 邪祟獵人
    const c = yield* g.pickOne(p, { prompt: '《邪祟獵人》：除外場上 1 個聲量 3 以上的罪惡信徒', cards: g.allFollowers().filter(f => f.guilty && (g.vol(f)) >= 3), harm: true });
    if (c) g.exile(c);
  } },
  exi09: { *chant(g, p) { // 盜火賊
    const mine = yield* g.pick(p, { prompt: '《盜火賊》：除外你棄牌區至多 2 張魔法', cards: g.P[p].discard.filter(c => T(g, c) === '魔法'), min: 0, max: 2, harm: false });
    for (const c of mine) g.exile(c);
    const n = mine.length, o = g.opp(p);
    if (!n) return;
    const theirs = yield* g.pick(p, { prompt: `《盜火賊》：除外目標敵方棄牌區 ${n} 張牌`, cards: g.P[o].discard.slice(), min: n, max: n, harm: true });
    for (const c of theirs) g.exile(c);
  } },
  exi10: { magicCalMod: (g, self, p) => p === self.owner ? g.P[p].discard.filter(c => T(g, c) === '儀式').length : 0 }, // 追書者地窖
  exi11: { nullifyCounterEffect: true }, // 惱人廣播器（引擎 calamityCheck）
  exi12: { ritualCalMod: (g, self, p) => p === self.owner && g.countLocType(p, '庭院') >= 2 && g.P[p].score.length >= 1 ? 1 : 0 }, // Δ議會紀念碑
  exi13: { *locAction(g, p) { // 亡途鐵道
    const c = yield* g.pickOne(p, { prompt: '《亡途鐵道》：棄置 1 張手牌', cards: g.P[p].hand.slice(), harm: false });
    if (!c) { g.log('《亡途鐵道》：沒有手牌，效果中止。'); return; }
    g.discardFromHand(c);
    const n = fl(g.P[p].discard.length / 7);
    g.P[p].flags.ritualCalBonus = (g.P[p].flags.ritualCalBonus || 0) + n;
    g.log(`《亡途鐵道》：棄牌區 ${g.P[p].discard.length} 張，本回合執行儀式災厄 +${n}。`);
  } },
  exi14: { *locAction(g, p, self) { // 荊棘墓園
    const wild = () => g.P[p].discard.filter(c => g.def(c).locationType === '荒野');
    const n = wild().length, o = g.opp(p);
    g.log(`《荊棘墓園》：棄牌區有 ${n} 個荒野。`);
    for (let i = 0; i < n; i++) {
      const c = yield* g.pickOne(p, { prompt: `《荊棘墓園》：破壞敵方場上 1 個地點或信徒（${i + 1}/${n}）`, cards: g.P[o].field.filter(x => ['地點', '信徒'].includes(T(g, x))), harm: true });
      if (!c) break;
      g.destroy(c);
    }
    for (const w of wild()) g.exile(w);
    g.destroy(self);
  } },
  exi15: { *magic(g, p, self, sd) { // 劣質藥劑
    const c = yield* g.pickOne(p, { prompt: '《劣質藥劑》：解除場上 1 個信徒的罪惡', cards: g.allFollowers().filter(f => f.guilty), harm: false });
    if (c) g.unGuilty(c);
    if (sd) {
      if (!g.rituals(p).length) { g.log('《劣質藥劑》星塵效果：場上沒有儀式，無法獻祭。'); return; }
      const f = yield* g.pickOne(p, { prompt: '《劣質藥劑》星塵效果：獻祭你場上 1 個非罪惡信徒', cards: g.followers(p).filter(x => !x.guilty), harm: false });
      if (!f) { g.log('《劣質藥劑》星塵效果：沒有非罪惡信徒，效果中止。'); return; }
      yield* g.sacrifice(p, [f]);
      g.P[p].flags.ritualCalBonus = (g.P[p].flags.ritualCalBonus || 0) + 1;
      g.log('《劣質藥劑》：本回合執行儀式災厄 +1。');
    }
  } },
  exi16: { *magic(g, p, self, sd) { // 影子地圖
    const pl = g.P[p];
    const sel = yield* g.pick(p, { prompt: '《影子地圖》：從你牌庫尋找至多 1 張牌加入手中', cards: pl.deck.slice(), min: 0, max: 1, harm: false, info: 'search' });
    if (sel[0]) { g.move(sel[0], 'hand'); g.log(`${pl.name} 從牌庫尋找並展示 ${g.cname(sel[0])}，加入手中。`); }
    g.shuffle(pl.deck);
    if (sd) {
      const l = yield* g.pick(p, { prompt: '《影子地圖》星塵效果：可將你手牌 1 個地點放置到場上', cards: pl.hand.filter(c => T(g, c) === '地點'), min: 0, max: 1, harm: false });
      if (l[0]) { g.move(l[0], 'field'); g.log(`${g.cname(l[0])} 放置到場上。`); }
    }
  } },
  exi17: { // 不穩定召喚
    calMod: (g, p, self, sd) => sd ? g.countLocType(p, '圖書館') : 0,
    *magic(g, p) {
      const r = yield* g.pickOne(p, { prompt: '《不穩定召喚》：除外你棄牌區 1 張儀式', cards: g.P[p].discard.filter(c => T(g, c) === '儀式'), harm: false });
      if (!r) { g.log('《不穩定召喚》：棄牌區沒有儀式，效果中止。'); return; }
      g.exile(r);
      g.P[p].flags.ritualCalBonus = (g.P[p].flags.ritualCalBonus || 0) + 2;
      g.log('《不穩定召喚》：本回合執行儀式災厄 +2。');
    },
  },
  exi18: { // 推倒聖像
    suppress: true,
    calMod: (g, p, self, sd) => sd ? g.followers(p).filter(f => g.def(f).faction === '放逐者').length : 0,
    *magic(g, p, self) {
      const L = g.leaderOf(g.opp(p));
      if (!L) { g.log('《推倒聖像》：敵方場上沒有教主，無法附著。'); return; }
      g.move(self, 'field'); self.attachTo = L.uid;
      g.log(`《推倒聖像》附著於 ${g.cname(L)}，該教主失去效果欄內所有能力。`);
    },
  },
  exi31: { // 小麵團狗（供品）
    replaceDestroy(g, self) {
      g.move(self, 'conspiracy');
      g.log('《小麵團狗》被破壞：置入陰謀區。');
      g.queue('exi31', function* () {
        const p = self.owner;
        const c = yield* g.pickOne(p, { prompt: '《小麵團狗》：將你場上 1 個信徒變為罪惡', cards: g.followers(p).filter(f => !f.guilty), harm: false });
        if (c) g.makeGuilty(c);
      });
    },
  },
  exi32: { // 小報記者
    *onCounter(g, p, self) { g.revealHand(p, g.opp(p), self); },
    onDestroyed(g, self) { if (g.active === self.owner) g.revealHand(g.opp(self.owner), self.owner); },
  },
  exi33: { solo: true, attackExile: true }, // 殉道者（聖戰）
});

// ======== 逐光者 ========
const wildOnField = (g, p) => g.locations(p).filter(l => g.locType(l) === '荒野');
const addTo = (g, p, k, n) => { g.P[p].flags[k] = (g.P[p].flags[k] || 0) + n; };
function* repeatPick(g, p, n, mk) { // 「你每擁有…」：次數在結算時固定，逐次選擇
  for (let i = 0; i < n; i++) { const ok = yield* mk(i, n); if (!ok) break; }
}
Object.assign(EFFECTS, {
  mot01: { // 灰燼皇后
    attackVolAll: (g, self, c) => c.owner === self.owner ? 1 : 0,
    canQuick: (g, p) => g.locations(p).length > 0,
    *quick(g, p) {
      const l = yield* g.pickOne(p, { prompt: '《灰燼皇后》：破壞你場上 1 個地點', cards: g.locations(p), harm: false });
      if (!l || !g.destroy(l)) return;
      yield* g.flushTriggers();
      const f = yield* g.pickOne(p, { prompt: '《灰燼皇后》：解除你場上 1 個信徒的罪惡', cards: g.followers(p).filter(x => x.guilty), harm: false });
      if (f) g.unGuilty(f);
    },
  },
  mot02: { needs: { 自然: 4, 灰燼: 4 } },
  mot03: { // 回歸原始
    cond: (g, p) => g.followers(g.opp(p)).length <= 3,
    atGameStart(g, p, self) {
      const others = g.P[p].hand.filter(c => c !== self);
      if (!others.length) return;
      g.log(`《回歸原始》：遊戲開始時在 ${g.pname(p)} 手中，棄置其餘 ${others.length} 張手牌。`);
      for (const c of others) g.discardFromHand(c);
    },
  },
  mot04: { cond: (g, p) => g.locations(p).length >= 4 && g.hasLocType(p, '橋') },
  mot05: { attackVol: (g, self) => g.sym(self.owner, '灰燼') }, // 縱火犯（聖戰）
  mot06: { *chant(g, p) { // 夜鹿
    const o = g.opp(p);
    g.revealHand(o, p);
    const fs = g.P[o].hand.filter(c => T(g, c) === '信徒');
    if (!fs.length) { g.log('《夜鹿》：敵方手牌沒有信徒。'); return; }
    // 設計者裁定：飛升信徒也參與比較聲量；最小的若是飛升信徒則不放置入場（同為最小時放置非飛升信徒）
    const mn = Math.min(...fs.map(c => g.vol(c)));
    const smallest = fs.filter(c => g.vol(c) === mn), placeable = smallest.filter(c => g.canEnterByEffect(c));
    if (!placeable.length) { g.log(`《夜鹿》：聲量最小的信徒是飛升信徒（${smallest.map(c => g.cname(c)).join('、')}），不放置入場。`); return; }
    const c = yield* g.pickOne(o, { prompt: '《夜鹿》：選擇你手牌中 1 個聲量最小的信徒放置到場上（之後變為罪惡）', cards: placeable, harm: false });
    if (!c) return;
    g.move(c, 'field');
    g.log(`${g.cname(c)} 被放置到 ${g.pname(o)} 場上。`);
    g.makeGuilty(c);
  } },
  mot07: { *chant(g, p) { // 發光蘑菇
    const n = fl(g.sym(p, '灰燼') / 2);
    yield* repeatPick(g, p, n, function* (i) {
      const c = yield* g.pickOne(p, { prompt: `《發光蘑菇》：將場上 1 個信徒置入陰謀區（${i + 1}/${n}）`, cards: g.allFollowers(), harm: true });
      if (!c) return false;
      g.move(c, 'conspiracy'); g.log(`${g.cname(c)}（${g.pname(c.owner)}）置入陰謀區。`);
      return true;
    });
  } },
  mot08: { counterVol: (g, self) => -g.followers(g.opp(self.owner)).length }, // 貓修女（聖戰）
  mot09: { // 鶚面祭司（聖戰、只能單獨襲擊）
    solo: true,
    *afterAttack(g, self) {
      const p = self.owner, n = g.sym(p, '野性');
      const cs = g.followers(g.opp(p)).filter(f => (g.vol(f)) < n);
      const sel = yield* g.pick(p, { prompt: `《鶚面祭司》襲擊後：可破壞敵方場上 1 個聲量小於 ${n}（你的野性數）的信徒`, cards: cs, min: 0, max: 1, harm: true });
      if (sel[0]) g.destroy(sel[0]);
    },
  },
  mot10: { *chant(g, p) { // 蠟人
    const w = yield* g.pickOne(p, { prompt: '《蠟人》：破壞你場上 1 個「荒野」', cards: wildOnField(g, p), harm: false });
    if (!w) { g.log('《蠟人》：你場上沒有荒野，效果中止。'); return; }
    if (!g.destroy(w)) return;
    yield* g.flushTriggers();
    const l = yield* g.pickOne(p, { prompt: '《蠟人》：破壞敵方場上 1 個地點', cards: g.locations(g.opp(p)), harm: true });
    if (l) g.destroy(l);
  } },
  mot11: { *chant(g, p) { // 逐星霧蹄（聖戰）
    const pl = g.P[p];
    const sel = yield* g.pick(p, { prompt: '《逐星霧蹄》：從你牌庫尋找至多 1 個信徒放置到場上', cards: pl.deck.filter(c => T(g, c) === '信徒' && g.canEnterByEffect(c)), min: 0, max: 1, harm: false, info: 'search' });
    g.shuffle(pl.deck);
    const c = sel[0];
    if (!c) return;
    g.move(c, 'field'); g.log(`${pl.name} 從牌庫將 ${g.cname(c)} 放置到場上。`);
    if (g.def(c).guardX) yield* g.offerGuard(p, c);
    if (g.deconXOf(c)) yield* g.offerDecon(p, c);
  } },
  mot12: { *chant(g, p) { // 螢火蟲男孩
    const n = fl(g.sym(p, '煉金') / 2);
    if (n) g.log(`《螢火蟲男孩》：雙方各獻祭牌庫頂 ${n} 張牌。`);
    for (let i = 0; i < n; i++) for (const q of [p, g.opp(p)]) {
      const pl = g.P[q];
      if (!pl.deck.length || !g.rituals(q).length) continue;
      yield* g.sacrifice(q, [pl.deck[pl.deck.length - 1]], '《螢火蟲男孩》：選擇獻祭給哪個儀式');
    }
  } },
  mot13: { guardSetType: '荒野' }, // 寄生的信者（駐守3）
  mot14: { // 鳥語者（駐守2）
    onOwnLocDestroyed(g, self, loc, lt) {
      if (lt !== '荒野' || g.active !== self.owner) return;
      g.queue('mot14', function* () {
        const c = yield* g.pickOne(self.owner, { prompt: `《鳥語者》：${g.cname(loc)}（荒野）被破壞，將場上 1 個信徒變為罪惡`, cards: g.allFollowers().filter(f => !f.guilty && !g.neverGuilty(f)), harm: true });
        if (c) g.makeGuilty(c);
      });
    },
  },
  mot15: { *chant(g, p) { // 搬運者
    const n = g.countLocType(p, '橋');
    yield* repeatPick(g, p, n, function* (i) {
      const c = yield* g.pickOne(p, { prompt: `《搬運者》：將你棄牌區 1 個地點置入陰謀區（荒野則改為放置到場上）（${i + 1}/${n}）`, cards: g.P[p].discard.filter(x => T(g, x) === '地點'), harm: false });
      if (!c) return false;
      if (g.def(c).locationType === '荒野') { g.move(c, 'field'); g.log(`${g.cname(c)} 是荒野，放置到場上。`); }
      else { g.move(c, 'conspiracy'); g.log(`${g.cname(c)} 置入陰謀區。`); }
      return true;
    });
  } },
  mot16: { freeFirstAttack: (g, self, p) => p === self.owner && g.sym(p, '煉金') >= 4 }, // 漆黑樹洞
  mot17: { *locAction(g, p) { // 蠅橋
    const n = fl(g.sym(p, '自然') / 2);
    yield* repeatPick(g, p, n, function* (i) {
      const c = yield* g.pickOne(p, { prompt: `《蠅橋》：將場上 1 個信徒變為罪惡（${i + 1}/${n}）`, cards: g.allFollowers().filter(f => !f.guilty && !g.neverGuilty(f)), harm: true });
      if (!c) return false;
      g.makeGuilty(c); return true;
    });
  } },
  mot18: { *onAttack(g, self) { // 誘蛾林道
    const p = self.owner;
    if (!g.rituals(p).length) return;
    const sel = yield* g.pick(p, { prompt: '《誘蛾林道》：襲擊時，可獻祭你棄牌區 1 張牌', cards: g.P[p].discard.slice(), min: 0, max: 1, harm: false });
    yield* g.sacrifice(p, sel);
  } },
  mot19: {}, mot20: {},
  mot21: { // 森林大火
    calMod: (g, p, self, sd) => sd ? g.sym(p, '灰燼') : 0,
    *magic(g, p) {
      for (const q of [p, g.opp(p)]) for (const l of g.locations(q)) g.destroy(l);
    },
  },
  mot22: { // 蛾之夢
    calMod: (g, p, self, sd) => sd ? g.sym(p, '野性') : 0,
    *magic(g, p) {
      for (const q of [p, g.opp(p)]) for (const f of g.followers(q)) { g.move(f, 'conspiracy'); g.log(`${g.cname(f)}（${g.pname(q)}）置入陰謀區。`); }
    },
  },
  mot23: { // 動物語言
    grantCrusade: true,
    *magic(g, p, self, sd) {
      const f = yield* g.pickOne(p, { prompt: '《動物語言》：附著於你場上 1 個信徒（獲得聖戰）', cards: g.followers(p), harm: false });
      if (!f) { g.log('《動物語言》：你場上沒有信徒，無法附著。'); return; }
      g.move(self, 'field'); self.attachTo = f.uid;
      g.log(`《動物語言》附著於 ${g.cname(f)}，該信徒獲得聖戰。`);
      if (sd) { f.tempAtk = { turn: g.turnNo, val: 3 }; g.log(`星塵效果：本回合 ${g.cname(f)} 襲擊聲量 +3。`); }
    },
  },
  mot24: { // 點亮燈火
    calMod: (g, p, self, sd) => sd ? g.P[p].discard.filter(c => g.def(c).locationType === '荒野').length : 0,
    *magic(g, p) {
      const n = fl(g.sym(p, '自然') / 2);
      yield* repeatPick(g, p, n, function* (i) {
        const c = yield* g.pickOne(p, { prompt: `《點亮燈火》：將你棄牌區或陰謀區 1 個地點放置到場上（${i + 1}/${n}）`, cards: g.P[p].discard.concat(g.P[p].conspiracy).filter(x => T(g, x) === '地點'), harm: false });
        if (!c) return false;
        g.move(c, 'field'); g.log(`${g.cname(c)} 放置到場上。`); return true;
      });
    },
  },
});

// ======== 禁忌廚房 ========
const symKinds = (g, c) => new Set(g.def(c).symbols || []).size;
function* discardN(g, q, n, prompt) {
  const k = Math.min(n, g.P[q].hand.length);
  if (!k) return 0;
  const ds = yield* g.pick(q, { prompt, cards: g.P[q].hand.slice(), min: k, max: k, harm: false, info: 'discard' });
  for (const c of ds) g.discardFromHand(c);
  return ds.length;
}
const onDestroyedQ = (fn) => function (g, self) { g.queue(self.id, () => fn(g, self, self.owner), { label: `${g.def(self).name} 被破壞時的效果`, uid: self.uid }); };
Object.assign(EFFECTS, {
  kit01: { // 主廚
    enemyHandLimit5: true,
    canQuick: (g, p) => g.followers(p).length > 0,
    *quick(g, p) {
      const f = yield* g.pickOne(p, { prompt: '《主廚》：破壞你場上 1 個信徒', cards: g.followers(p), harm: false });
      if (!f) return;
      const n = symKinds(g, f);
      if (!g.destroy(f)) return;
      yield* g.flushTriggers();
      const who = yield* g.ask(p, `《主廚》：由誰抽 ${n} 張牌？（${g.cname(f)} 的符號種類數）`, [{ key: 'me', label: `我抽 ${n} 張` }, { key: 'opp', label: `敵方抽 ${n} 張` }]);
      g.draw(who === 'me' ? p : g.opp(p), n);
    },
  },
  kit02: { needs: { 凋零: 4, 禁忌: 4 } },
  kit03: { cond: (g, p) => g.P[p].discard.length >= 9 },
  kit04: { needs: { 自然: 4 }, cond: (g, p) => g.P[g.opp(p)].deck.length === 0 },
  kit05: { onDestroyed: onDestroyedQ(function* (g, self, p) { g.log('《迷路的露蹄》被破壞：敵方抽 1 張牌。'); g.draw(g.opp(p), 1); }) },
  kit06: { onDestroyed: onDestroyedQ(function* (g, self, p) { yield* discardN(g, p, 1, '《斷腿兔子》被破壞：棄置你 1 張手牌'); }) },
  kit07: { onDestroyed: onDestroyedQ(function* (g, self, p) {
    const c = yield* g.pickOne(p, { prompt: '《不可觸岩鹽》被破壞：破壞你場上 1 個信徒', cards: g.followers(p), harm: false });
    if (c) g.destroy(c);
  }) },
  kit08: { onDestroyed: onDestroyedQ(function* (g, self, p) {
    const rs = g.P[p].hand.filter(c => T(g, c) === '儀式');
    const sel = yield* g.pick(p, { prompt: '《流淚的罪人》被破壞：可棄置手牌 1 張儀式；若不棄置，則破壞你場上 1 個儀式', cards: rs, min: 0, max: 1, harm: false });
    if (sel[0]) { g.discardFromHand(sel[0]); return; }
    const r = yield* g.pickOne(p, { prompt: '《流淚的罪人》：破壞你場上 1 個儀式', cards: g.rituals(p), harm: false });
    if (r) g.destroy(r);
  }) },
  kit09: { onDestroyed: onDestroyedQ(function* (g, self, p) {
    const c = yield* g.pickOne(p, { prompt: '《臃腫肉團》被破壞：除外你棄牌區另 1 張牌', cards: g.P[p].discard.filter(x => x !== self), harm: false });
    if (!c) { g.log('《臃腫肉團》：棄牌區沒有其他牌，效果中止。'); return; }
    g.exile(c);
    if (['discard', 'conspiracy'].includes(self.zone)) { g.move(self, 'deck'); g.shuffle(g.P[p].deck); g.log('《臃腫肉團》洗回牌庫。'); }
  }) },
  kit10: { *chant(g, p) { // 餐廚學徒
    const n = fl(g.sym(p, '凋零') / 2);
    yield* repeatPick(g, p, n, function* (i) {
      const c = yield* searchToField(g, p, c => T(g, c) === '信徒', `《餐廚學徒》：從棄牌區或牌庫尋找至多 1 個信徒放置到場上（${i + 1}/${n}）`);
      return !!c;
    });
  } },
  kit11: { *chant(g, p) { // 甜點師
    const n = fl(g.sym(p, '禁忌') / 2);
    for (let i = 0; i < n; i++) { g.draw(p, 1); g.draw(g.opp(p), 1); }
  } },
  kit12: { *chant(g, p) { // 洗碗工
    const n = g.countLocType(p, '墓園');
    yield* repeatPick(g, p, n, function* (i) {
      const c = yield* g.pickOne(p, { prompt: `《洗碗工》：將你棄牌區 1 個信徒洗回牌庫（${i + 1}/${n}）`, cards: g.P[p].discard.filter(x => T(g, x) === '信徒'), harm: false });
      if (!c) return false;
      g.move(c, 'deck'); g.shuffle(g.P[p].deck); g.log(`${g.cname(c)} 洗回牌庫。`); return true;
    });
  } },
  kit13: { *chant(g, p) { // 燒烤魔
    const n = g.sym(p, '灰燼');
    const c = yield* g.pickOne(p, { prompt: `《燒烤魔》：破壞場上 1 個聲量 ${n} 以下的信徒`, cards: g.allFollowers().filter(f => (g.vol(f)) <= n), harm: true });
    if (c) g.destroy(c);
  } },
  kit14: { *chant(g, p) { // 調酒師
    const o = g.opp(p);
    g.P[o].noRitualTurn = g.turnNo + 1;
    g.log(`《調酒師》：${g.pname(o)} 下一回合無法執行儀式。`);
  } },
  kit15: { *onCounter(g, p, self, src) { // 櫃檯接待員
    if (!src || src.zone !== 'field' || T(g, src) !== '信徒') return;
    if (g.sym(p, '禁忌') >= 5) { g.log('《櫃檯接待員》：破壞被控訴的信徒。'); g.destroy(src); }
    else { g.log('《櫃檯接待員》：被控訴的信徒拿回手。'); g.toHand(src); }
  } },
  kit16: { // 餐廳經理
    onOwnLeave(g, self, c, t) {
      if (g.active !== self.owner) return;
      const o = g.opp(self.owner);
      if (t === '墓園') g.queue('kit16a', function* () { g.log(`《餐廳經理》：${g.cname(c)}（墓園）離場，敵方抽 1 張牌。`); g.draw(o, 1); }, { label: `餐廳經理：${g.def(c).name} 離場，敵方抽 1 張`, uid: self.uid });
      if (t === '儀式') g.queue('kit16b', function* () { g.log(`《餐廳經理》：${g.cname(c)}（儀式）離場，敵方棄置 1 張手牌。`); yield* discardN(g, o, 1, '《餐廳經理》：棄置你 1 張手牌'); }, { label: `餐廳經理：${g.def(c).name} 離場，敵方棄 1 張`, uid: self.uid });
    },
  },
  kit17: { *locAction(g, p) { // 屠宰場
    const n = fl(g.sym(p, '禁忌') / 3);
    yield* repeatPick(g, p, n, function* (i) {
      const f = yield* g.pickOne(p, { prompt: `《屠宰場》：破壞你場上 1 個信徒（${i + 1}/${n}）`, cards: g.followers(p), harm: false });
      if (!f || !g.destroy(f)) return false;
      yield* g.flushTriggers();
      const c = yield* returnFromDiscard(g, p, () => true, '《屠宰場》：將你棄牌區 1 張牌拿回手');
      return !!c;
    });
  } },
  kit18: { *locAction(g, p, self) { // 惡魔烤箱
    if (g.sym(p, '灰燼') < 4) { g.log('《惡魔烤箱》：灰燼未達 4，沒有效果。'); return; }
    if (g.followers(p).length < 3) { g.log('《惡魔烤箱》：你場上信徒不足 3 個，效果中止。'); return; }
    const fs = yield* g.pick(p, { prompt: '《惡魔烤箱》：破壞你場上 3 個信徒', cards: g.followers(p), min: 3, max: 3, harm: false });
    for (const f of fs) g.destroy(f);
    yield* g.flushTriggers();
    const r = yield* g.pickOne(p, { prompt: '《惡魔烤箱》：完成你場上 1 個儀式', cards: g.rituals(p), harm: false });
    if (!r) { g.log('《惡魔烤箱》：場上沒有儀式，效果中止。'); return; }
    g.complete(r);
    yield* g.flushTriggers();
    g.destroy(self);
  } },
  kit19: { // 冷藏櫃
    *onExecuteRitual(g, self) {
      const p = self.owner;
      const c = yield* g.pickOne(p, { prompt: '《冷藏櫃》：將你棄牌區 1 張牌置入陰謀區', cards: g.P[p].discard.slice(), harm: false });
      if (c) { g.move(c, 'conspiracy'); g.log(`《冷藏櫃》：${g.cname(c)} 置入陰謀區。`); }
    },
    afterOwnComplete(g, self) { g.queue('kit19', function* () { if (self.zone === 'field') { g.log('《冷藏櫃》：你的儀式完成，破壞這個地點。'); g.destroy(self); } }, { label: '冷藏櫃：儀式完成，破壞冷藏櫃', uid: self.uid }); },
  },
  kit20: { beltToConspiracy: true }, // 食材輸送帶
  kit21: { *magic(g, p, self, sd) { // 痛苦調味
    const o = g.opp(p);
    g.draw(o, 1);
    yield* discardN(g, o, 1, '《痛苦調味》：棄置你 1 張手牌');
    if (sd) {
      const r = yield* g.pickOne(p, { prompt: '《痛苦調味》星塵效果：完成敵方場上 1 個儀式', cards: g.rituals(o), harm: false });
      if (!r) { g.log('《痛苦調味》星塵效果：敵方場上沒有儀式，效果中止。'); return; }
      g.complete(r);
      yield* g.flushTriggers();
      const n = fl(g.sym(p, '自然') / 2);
      for (let i = 0; i < n && g.P[o].deck.length; i++) g.exile(g.P[o].deck[g.P[o].deck.length - 1]);
    }
  } },
  kit22: { *magic(g, p, self, sd) { // 開胃菜
    const o = g.opp(p);
    if (sd && (yield* g.ask(p, '《開胃菜》星塵效果：可改為敵方棄置 2 張手牌', [{ key: true, label: '改為敵方棄置 2 張手牌' }, { key: false, label: '敵方抽 2 張牌' }]))) {
      yield* discardN(g, o, 2, '《開胃菜》：棄置你 2 張手牌');
    } else g.draw(o, 2);
  } },
  kit23: { // 精心燉煮
    calMod: (g, p, self, sd) => sd ? g.sym(p, '灰燼') : 0,
    *magic(g, p) {
      const r = yield* g.pickOne(p, { prompt: '《精心燉煮》：完成你場上 1 個滿足條件的儀式', cards: g.rituals(p).filter(x => g.ritualReady(x)), harm: false });
      if (r) g.complete(r); else g.log('《精心燉煮》：沒有滿足條件的儀式。');
    },
  },
  kit24: { *magic(g, p, self, sd) { // 餘興節目
    let n = 0;
    for (const q of [p, g.opp(p)]) for (const r of g.rituals(q)) if (g.destroy(r)) n++;
    if (sd && n) { yield* g.flushTriggers(); yield* discardN(g, g.opp(p), n, `《餘興節目》星塵效果：${n} 個儀式離場，棄置你 ${n} 張手牌`); }
  } },
});

// ======== 門教團 ========
const topDeck = (g, p) => g.P[p].deck[g.P[p].deck.length - 1];
function* ritualOrDestroy(g, p, name) { // 知罪者／流淚的罪人共通
  const sel = yield* g.pick(p, { prompt: `《${name}》：可棄置手牌 1 張儀式；若不棄置，則破壞你場上 1 個儀式`, cards: g.P[p].hand.filter(c => T(g, c) === '儀式'), min: 0, max: 1, harm: false });
  if (sel[0]) { g.discardFromHand(sel[0]); return; }
  const r = yield* g.pickOne(p, { prompt: `《${name}》：破壞你場上 1 個儀式`, cards: g.rituals(p), harm: false });
  if (r) g.destroy(r);
}
Object.assign(EFFECTS, {
  dor01: { // 鑰匙持有人
    magicCalMod: (g, self, p) => p === self.owner ? 1 : 0,
    canQuick: (g, p) => g.rituals(p).length > 0 && g.P[p].discard.some(c => T(g, c) === '魔法'),
    *quick(g, p) {
      const m = yield* g.pickOne(p, { prompt: '《鑰匙持有人》：獻祭你棄牌區 1 張魔法', cards: g.P[p].discard.filter(c => T(g, c) === '魔法'), harm: false });
      if (m) yield* g.sacrifice(p, [m]);
    },
  },
  dor02: { needs: { 知識: 6 } },
  dor03: { needs: { 煉金: 6 } },
  dor04: { needs: { 煉金: 5, 知識: 5 }, cond: (g, p) => g.hasLocType(p, '圖書館') },
  dor05: {},
  dor06: { deconValue: (g, self) => g.sym(self.owner, '知識') >= 3 ? 2 : 1 },
  dor07: { *chant(g, p) { // 門測量員
    for (let i = 0; i < 2; i++) {
      const c = topDeck(g, p);
      if (!c || !g.rituals(p).length) break;
      yield* g.sacrifice(p, [c], '《門測量員》：選擇獻祭給哪個儀式');
    }
  } },
  dor08: { neverGuilty: true },
  dor09: { *chant(g, p) { yield* returnFromDiscard(g, p, c => T(g, c) === '魔法', '《概念術士》：將你棄牌區 1 張魔法拿回手'); } },
  dor10: { *chant(g, p) { // 資料庫管理員
    const n = g.countLocType(p, '圖書館');
    yield* repeatPick(g, p, n, function* (i) {
      const f = yield* g.pickOne(p, { prompt: `《資料庫管理員》：啟動你場上 1 個非罪惡信徒的解構效果（${i + 1}/${n}）`, cards: g.followers(p).filter(x => !x.guilty && g.deconXOf(x)), harm: false });
      if (!f) return false;
      yield* g.offerDecon(p, f);
      return true;
    });
  } },
  dor11: { *chant(g, p) { // Δ議會博士
    const rs = g.P[p].discard.filter(c => T(g, c) === '儀式');
    for (const r of rs) { g.move(r, 'field'); g.log(`《Δ議會博士》：${g.cname(r)} 從棄牌區放置到場上。`); }
  } },
  dor12: { onGuilty(g, self) { g.queue('dor12', () => ritualOrDestroy(g, self.owner, '知罪者'), { label: '知罪者 變為罪惡時的效果', uid: self.uid }); } },
  dor13: { solo: true, attackVol: (g, self) => 2 * g.followers(self.owner).filter(f => !f.guilty && f.deconAt != null).length },
  dor14: { blockStardust: (g, self, p) => p !== self.owner && g.sym(self.owner, '禁忌') >= 4 },
  dor15: { ritualReduceAll: (g, self, r) => r.owner === self.owner && g.sym(self.owner, '知識') >= 4 ? 1 : 0 },
  dor16: { *locAction(g, p) { // 門物質研究間
    const n = fl(g.sym(p, '凋零') / 2);
    if (!n || !g.rituals(p).length) { if (n) g.log('《門物質研究間》：場上沒有儀式，無法獻祭。'); return; }
    const sel = yield* g.pick(p, { prompt: `《門物質研究間》：獻祭你棄牌區至多 ${n} 張牌`, cards: g.P[p].discard.slice(), min: 0, max: n, harm: false });
    yield* g.sacrifice(p, sel);
  } },
  dor17: { *locAction(g, p) { // 研究室中庭
    const n = fl(g.sym(p, '煉金') / 2);
    yield* repeatPick(g, p, n, function* (i) {
      const c = yield* g.pickOne(p, { prompt: `《研究室中庭》：將你場上或棄牌區 1 個信徒洗回牌庫（${i + 1}/${n}）`, cards: g.followers(p).concat(g.P[p].discard.filter(x => T(g, x) === '信徒')), harm: false });
      if (!c) return false;
      g.move(c, 'deck'); g.shuffle(g.P[p].deck); g.log(`${g.cname(c)} 洗回牌庫。`); return true;
    });
  } },
  dor18: { freeFirstMagic: (g, self, p) => p === self.owner && g.sym(p, '凋零') >= 4 },
  dor19: { *magic(g, p, self, sd) { // 物質瓦解
    const c = yield* g.pickOne(p, { prompt: `《物質瓦解》：${sd ? '除外' : '破壞'}場上 1 個信徒或地點`, cards: [0, 1].flatMap(q => g.P[q].field.filter(x => ['信徒', '地點'].includes(T(g, x)))), harm: true });
    if (c) { if (sd) g.exile(c); else g.destroy(c); }
  } },
  dor20: { *magic(g, p, self, sd) { // 現實扭曲
    const o = g.P[g.opp(p)];
    o.noLocActionTurn = g.turnNo + 1;
    g.log(`《現實扭曲》：${o.name} 下一回合無法執行地點行動。`);
    if (sd) { o.noRitualTurn = g.turnNo + 1; g.log(`星塵效果：${o.name} 下一回合無法執行儀式。`); }
  } },
  dor21: { *magic(g, p, self, sd) { // 逆向儀式
    const r = yield* g.pickOne(p, { prompt: '《逆向儀式》：破壞敵方場上 1 個儀式', cards: g.rituals(g.opp(p)), harm: true });
    if (!r) return;
    // 比較目前災厄（含加成），卡面寫「原始災厄」才看卡面
    if (sd && g.sym(p, '禁忌') > g.ritualCalamity(r.owner, r)) { g.log('《逆向儀式》星塵效果：改為除外該儀式。'); g.exile(r); }
    else g.destroy(r);
  } },
  dor22: { *magic(g, p, self, sd) { // 意識轉移
    if (g.rituals(p).length) {
      const fs = yield* g.pick(p, { prompt: '《意識轉移》：獻祭你場上任意數量的信徒', cards: g.followers(p), min: 0, max: 99, harm: false });
      yield* g.sacrifice(p, fs);
    } else g.log('《意識轉移》：場上沒有儀式，無法獻祭。');
    if (sd) {
      const n = fl(g.P[p].under.length / 3);
      g.P[p].flags.ritualCalBonus = (g.P[p].flags.ritualCalBonus || 0) + n;
      g.log(`《意識轉移》星塵效果：你有 ${g.P[p].under.length} 張被獻祭的牌，本回合執行儀式災厄 +${n}。`);
    }
  } },
  dor23: { *magic(g, p, self, sd) { // 整理資料
    const ds = yield* g.pick(p, { prompt: '《整理資料》：棄掉任意數量的手牌，然後抽取等量的牌', cards: g.P[p].hand.slice(), min: 0, max: 99, harm: false, info: 'discard' });
    for (const c of ds) g.discardFromHand(c);
    if (ds.length) g.draw(p, ds.length);
    if (sd) yield* returnFromDiscard(g, p, () => true, '《整理資料》星塵效果：將你棄牌區 1 張牌拿回手');
  } },
  dor24: { *magic(g, p, self, sd) { // 重要的數據
    if (!g.rituals(p).length) g.log('《重要的數據》：場上沒有儀式，無法獻祭。');
    else yield* g.sacrifice(p, [self]);
    if (sd) { const n = fl(g.sym(p, '煉金') / 2); if (n) g.draw(p, n); }
  } },
});

// ======== 瘋人院 ========
const holyCount = g => g.countLocType(0, '聖地') + g.countLocType(1, '聖地');
const ownCounterBonus = (fn) => (g, self, c) => c.owner === self.owner && T(g, c) === '信徒' ? fn(g, self) : 0;
function* attachMagic(g, p, self, cards, prompt, onAttach) {
  const f = yield* g.pickOne(p, { prompt, cards, harm: true });
  if (!f) { g.log(`${g.cname(self)}：沒有可附著的信徒。`); return null; }
  g.move(self, 'field'); self.attachTo = f.uid;
  g.log(`${g.cname(self)} 附著於 ${g.cname(f)}（${g.pname(f.owner)}）。`);
  if (onAttach) yield* onAttach(f);
  return f;
}
Object.assign(EFFECTS, {
  asy01: { // 院長
    counterVolAll: ownCounterBonus(() => 1),
    canQuick: (g, p) => g.P[p].discard.some(c => T(g, c) === '信徒' && (g.vol(c)) <= 2),
    *quick(g, p) { yield* returnFromDiscard(g, p, c => T(g, c) === '信徒' && (g.vol(c)) <= 2, '《院長》：將你棄牌區 1 個聲量 2 以下的信徒拿回手'); },
  },
  asy02: { needs: { 醫藥: 5 } },
  asy03: { cond: (g, p) => g.followers(p).filter(f => !f.guilty).length >= 5 },
  asy04: { needs: { 夜幕: 4 }, cond: (g, p) => g.followers(p).filter(f => f.guilty).length >= 5 },
  asy05: { *onCounter(g, p) { // 排隊的瘋子
    if (g.sym(p, '凋零') < 3) return;
    yield* discardN(g, g.opp(p), 1, '《排隊的瘋子》：棄置你 1 張手牌');
  } },
  asy06: { *onCounter(g, p) { // 艾德與比利
    if (g.sym(p, '煉金') <= g.sym(p, '醫藥')) return;
    yield* returnFromDiscard(g, p, () => true, '《艾德與比利》：將你棄牌區 1 張牌拿回手');
  } },
  asy07: { *onCounter(g, p, self, src) { // 小丑
    if (!src || T(g, src) === '儀式' || !['field', 'stack'].includes(src.zone)) return;
    g.log(`《小丑》：除外被控訴的 ${g.cname(src)}。`); g.exile(src);
  } },
  asy08: { *onCounter(g, p) { // 孤單藝術家
    const n = holyCount(g);
    const c = yield* g.pickOne(p, { prompt: `《孤單藝術家》：破壞場上 1 個聲量 ${n} 以下的信徒（雙方聖地數）`, cards: g.allFollowers().filter(f => (g.vol(f)) <= n), harm: true });
    if (c) g.destroy(c);
  } },
  asy09: { // 誠實的病患
    *onCounter(g, p, self) { g.log('《誠實的病患》控訴時：除外這個信徒。'); g.exile(self); },
    onGuilty(g, self) { g.log('《誠實的病患》變為罪惡：除外這個信徒。'); g.exile(self); },
  },
  asy10: { // 夢遊人
    noAttack: true, neverGuilty: true,
    onLocTriggered(g, self) { g.log('《夢遊人》：觸發地點行動，拿回手。'); g.toHand(self); },
  },
  asy11: { counterVol: (g, self) => ({ 1: 2, 2: 3, 3: 5, 4: 8 })[g.followers(self.owner).filter(f => f.guilty).length] || 0 }, // 數列女士（解構1）
  asy12: { *onMagicPlayed(g, self, m, cal) { // 催眠師
    if (cal < 4) return;
    const p = self.owner;
    const c = yield* g.pickOne(p, { prompt: `《催眠師》：打出災厄 ${cal} 的魔法，將你場上 1 個信徒拿回手`, cards: g.followers(p), harm: false });
    if (c) g.toHand(c);
  } },
  asy13: { *chant(g, p) { // 實習護士
    const n = fl(g.sym(p, '凋零') / 2);
    let k = 0;
    yield* repeatPick(g, p, n, function* (i) {
      const c = yield* g.pickOne(p, { prompt: `《實習護士》：破壞你場上 1 個罪惡信徒（${i + 1}/${n}）`, cards: g.followers(p).filter(f => f.guilty), harm: false });
      if (!c || !g.destroy(c)) return false;
      k++; return true;
    });
    if (!k) return;
    yield* g.flushTriggers();
    const o = g.opp(p);
    const es = yield* g.pick(p, { prompt: `《實習護士》：破壞敵方場上 ${k} 個信徒`, cards: g.followers(o), min: k, max: k, harm: true });
    for (const c of es) g.destroy(c);
  } },
  asy14: { *chant(g, p) { yield* returnFromDiscard(g, p, c => T(g, c) === '信徒', '《主治醫師》：將你棄牌區 1 個信徒拿回手'); } },
  asy15: { counterVolAll: ownCounterBonus((g, self) => fl(g.sym(self.owner, '醫藥') / 3)) }, // 藥劑師
  asy16: { noGuiltyOnCounter: (g, self, p) => p === self.owner && g.sym(p, '醫藥') >= 4 }, // 手術室
  asy17: { *locAction(g, p) { // 廢棄電話亭
    const n = fl(g.sym(p, '夜幕') / 2), o = g.opp(p);
    for (let i = 0; i < n; i++) {
      if (!g.rituals(o).length) { g.log('《廢棄電話亭》：敵方場上沒有儀式，無法獻祭。'); break; }
      const f = yield* g.pickOne(o, { prompt: `《廢棄電話亭》：獻祭你場上 1 個信徒（${i + 1}/${n}）`, cards: g.followers(o), harm: false });
      if (!f) break;
      yield* g.sacrifice(o, [f]);
    }
  } },
  asy18: { *locAction(g, p) { // 瘋人院花園
    const n = fl(g.sym(p, '凋零') / 2);
    yield* repeatPick(g, p, n, function* (i) {
      const c = yield* g.pickOne(p, { prompt: `《瘋人院花園》：將你場上 1 個信徒拿回手（${i + 1}/${n}）`, cards: g.followers(p), harm: false });
      if (!c) return false;
      g.toHand(c); return true;
    });
  } },
  asy19: { counterVolAll: ownCounterBonus((g, self) => fl(g.sym(self.owner, '煉金') / 3)) }, // 諮商室
  asy20: { *magic(g, p, self, sd) { // 狂亂質詢
    const half = sd && (yield* g.ask(p, '《狂亂質詢》星塵效果：可改為雙方破壞自己場上一半數量的信徒（向下取整）', [{ key: true, label: '改為各破壞一半' }, { key: false, label: '各破壞 1 個' }]));
    // 同時機效果由當前（回合）玩家先結算：回合玩家先選並破壞，再輪到對手（設計者裁定）
    for (const q of [g.active, g.opp(g.active)]) {
      const fs = g.followers(q), n = half ? fl(fs.length / 2) : Math.min(1, fs.length);
      if (!n) continue;
      const sel = yield* g.pick(q, { prompt: `《狂亂質詢》：破壞你場上 ${n} 個信徒`, cards: fs, min: n, max: n, harm: false });
      for (const c of sel) g.destroy(c);
      yield* g.flushTriggers();
    }
  } },
  asy21: { // 安眠藥
    calMod: (g, p, self, sd) => sd ? g.sym(p, '醫藥') : 0,
    *magic(g) { for (const f of g.allFollowers()) g.makeGuilty(f); },
  },
  asy22: { // 強制拘束
    restrain: true,
    *magic(g, p, self, sd) {
      yield* attachMagic(g, p, self, g.allFollowers(), '《強制拘束》：附著於場上 1 個信徒（不能襲擊與解除罪惡）', function* (f) { if (sd) g.makeGuilty(f); });
    },
  },
  asy23: { // 深度催眠
    suppress: true, tempControl: true,
    *magic(g, p, self, sd) {
      yield* attachMagic(g, p, self, g.followers(g.opp(p)), '《深度催眠》：附著於敵方場上 1 個信徒（失去效果欄內所有能力）', function* (f) { if (sd) g.takeControl(f, p, self); });
    },
  },
  asy24: { *magic(g, p, self, sd) { // 特殊療法
    for (const q of [p, g.opp(p)]) {
      if (!g.rituals(q).length) { g.log(`${g.pname(q)} 場上沒有儀式，無法獻祭。`); continue; }
      const fs = g.followers(q).filter(f => !f.guilty);
      const sel = yield* g.pick(q, { prompt: '《特殊療法》：獻祭你場上 2 個非罪惡信徒', cards: fs, min: Math.min(2, fs.length), max: 2, harm: false });
      yield* g.sacrifice(q, sel);
    }
    if (sd) {
      const o = g.opp(p);
      for (const r of g.rituals(o)) if (g.P[o].under.filter(u => u.underOf === r.uid).length >= 3) g.destroy(r);
    }
  } },
});

// ======== 疫病中心 ========
const exiledFollowers = (g, p) => g.P[p].exile.filter(c => DEFS_T(g, c) === '信徒').length;
const DEFS_T = (g, c) => g.def({ id: c.id }).type; // 除外區看原始卡種
const wildsOnField = (g, p) => g.locations(p).filter(l => g.locType(l) === '荒野');
const addMagicBonus = (g, p, n) => { g.P[p].flags.magicCalBonus = (g.P[p].flags.magicCalBonus || 0) + n; };
function* playMagicFrom(g, p, cards, prompt) { // 「可打出」：不消耗行動
  const sel = yield* g.pick(p, { prompt, cards, min: 0, max: 1, harm: false });
  if (!sel[0]) return false;
  g.log(`${g.pname(p)} 藉由效果打出 ${g.cname(sel[0])}。`);
  yield* g.playMagic(p, sel[0]);
  yield* g.flushTriggers();
  return true;
}
function* attachVir(g, p, self, cards, prompt, after) {
  const f = yield* g.pickOne(p, { prompt, cards, harm: true });
  if (!f) { g.log(`${g.cname(self)}：沒有可附著的信徒。`); return null; }
  g.move(self, 'field'); self.attachTo = f.uid;
  g.log(`${g.cname(self)} 附著於 ${g.cname(f)}（${g.pname(f.owner)}）。`);
  if (after) yield* after(f);
  return f;
}
function* controlPick(g, p, cards, prompt) {
  const c = yield* g.pickOne(p, { prompt, cards, harm: true });
  if (c) g.takeControl(c, p);
  return c;
}
Object.assign(EFFECTS, {
  vir01: { // 零號病患
    volModAll: (g, self, c) => c.owner !== self.owner && g.attachedMagics().some(m => m.attachTo === c.uid) ? -1 : 0,
    canQuick: (g, p) => g.followers(g.opp(p)).some(f => g.vol(f) <= 0),
    *quick(g, p) { yield* controlPick(g, p, g.followers(g.opp(p)).filter(f => g.vol(f) <= 0), '《零號病患》：獲得敵方場上 1 個聲量 0 以下信徒的控制權'); },
  },
  vir02: { // 毀滅計畫
    cond: (g, p) => exiledFollowers(g, p) >= 4,
    ritualCalMod: (g, self, p, r) => r === self && exiledFollowers(g, self.owner) >= 7 ? 1 : 0,
  },
  vir03: { needs: { 自然: 4 }, cond: g => g.attachedMagics().length >= 3 },
  vir04: { cond: (g, p) => Object.keys(g.symbolsAll(p)).length >= 6 },
  vir05: { volModAll: (g, self, c) => c.owner !== self.owner ? -fl(g.sym(self.owner, '禁忌') / 4) : 0 },
  vir06: { *onCounter(g, p, self, src) { // 慈懷
    if (!src || src.zone !== 'field' || T(g, src) !== '信徒') return;
    const n = g.countLocType(p, '聖地');
    if (g.vol(src) < n) { g.log(`《慈懷》：被控訴的信徒聲量 ${g.vol(src)} 小於你的聖地數 ${n}。`); g.takeControl(src, p); }
  } },
  vir07: { *chant(g, p) { // 感染的聖女
    const fs = yield* g.pick(p, { prompt: '《感染的聖女》：除外你場上至多 2 個信徒（每除外 1 個，將棄牌區 2 個荒野放到場上）', cards: g.followers(p), min: 0, max: 2, harm: false });
    let n = 0;
    for (const f of fs) if (g.exile(f)) n++;
    if (!n) return;
    const ws = g.P[p].discard.filter(c => g.def(c).locationType === '荒野');
    const k = Math.min(ws.length, 2 * n);
    const sel = yield* g.pick(p, { prompt: `《感染的聖女》：將你棄牌區 ${k} 個「荒野」放置到場上`, cards: ws, min: k, max: k, harm: false });
    for (const w of sel) { g.move(w, 'field'); g.log(`${g.cname(w)} 放置到場上。`); }
  } },
  vir08: { *onMagicPlayed(g, self, m, cal) { // 解剖師
    if (cal < 4) return;
    const p = self.owner;
    const f = yield* g.pickOne(p, { prompt: `《解剖師》：打出災厄 ${cal} 的魔法，除外你場上 1 個信徒`, cards: g.followers(p), harm: false });
    if (!f || !g.exile(f)) return;
    yield* returnFromDiscard(g, p, () => true, '《解剖師》：將你棄牌區 1 張牌拿回手');
  } },
  vir09: { *chant(g, p) { // 危險物運送員
    addMagicBonus(g, p, 1); g.log('《危險物運送員》：本回合你的魔法災厄 +1。');
    const pl = g.P[p];
    const sel = yield* g.pick(p, { prompt: '《危險物運送員》：從你牌庫尋找至多 1 張魔法加入手中', cards: pl.deck.filter(c => T(g, c) === '魔法'), min: 0, max: 1, harm: false, info: 'search' });
    if (sel[0]) { g.move(sel[0], 'hand'); g.log(`${pl.name} 從牌庫尋找並展示 ${g.cname(sel[0])}，加入手中。`); }
    g.shuffle(pl.deck);
  } },
  vir10: { *chant(g, p) { // Δ議會花藝師
    const n = wildsOnField(g, p).length;
    for (let i = 0; i < n; i++) {
      const ok = yield* playMagicFrom(g, p, g.P[p].hand.concat(g.P[p].conspiracy).filter(c => T(g, c) === '魔法'), `《Δ議會花藝師》：可打出手牌或陰謀區 1 張魔法（${i + 1}/${n}）`);
      if (!ok) break;
    }
  } },
  vir11: { // Δ議會預言者
    counterVol: (g, self) => g.followers(g.opp(self.owner)).filter(f => f.guilty).length,
    magicCalMod: (g, self, p) => p === self.owner && g.P[p].score.length >= 1 ? 1 : 0,
  },
  vir12: { // 黑蓮
    *chant(g, p) {
      const w = yield* g.pickOne(p, { prompt: '《黑蓮》：破壞你場上 1 個「荒野」', cards: wildsOnField(g, p), harm: false });
      if (!w || !g.destroy(w)) { g.log('《黑蓮》：沒有破壞荒野，效果中止。'); return; }
      yield* g.flushTriggers();
      g.draw(p, 1);
    },
    onOwnLocDestroyed(g, self, loc, lt) {
      if (lt !== '荒野' || g.active !== self.owner) return;
      addMagicBonus(g, self.owner, 1); g.log(`《黑蓮》：${g.cname(loc)}（荒野）被破壞，本回合你的魔法災厄 +1。`);
    },
  },
  vir13: { *locAction(g, p) { // 扭曲書庫
    const n = fl(g.sym(p, '知識') / 2);
    yield* controlPick(g, p, g.followers(g.opp(p)).filter(f => g.vol(f) < n), `《扭曲書庫》：獲得敵方場上 1 個聲量小於 ${n} 的信徒的控制權`);
  } },
  vir14: { *locAction(g, p) { // 隱密製藥廠
    const n = fl(g.sym(p, '醫藥') / 2);
    for (let i = 0; i < n; i++) {
      const pl = g.P[p];
      const ok = yield* playMagicFrom(g, p, pl.hand.concat(pl.conspiracy, pl.discard).filter(c => g.isAttachMagic(c)), `《隱密製藥廠》：可打出手牌、陰謀區或棄牌區 1 張附著魔法（${i + 1}/${n}）`);
      if (!ok) break;
    }
  } },
  vir15: { // 隔離堡
    cantAttackFollower: (g, self, c) => g.vol(c) <= 1,
    volModAll: (g, self) => g.locations(self.owner).length === 1 ? -1 : 0,
  },
  vir16: {}, vir17: {},
  vir18: { *magic(g, p, self, sd) { // 起源地探索
    const pl = g.P[p];
    const cs = pl.deck.concat(pl.discard).filter(c => T(g, c) === '魔法');
    const sel = yield* g.pick(p, { prompt: '《起源地探索》：從你牌庫或棄牌區尋找至多 1 張魔法加入手中', cards: cs, min: 0, max: 1, harm: false, info: 'search' });
    if (sel[0]) { g.move(sel[0], 'hand'); g.log(`${pl.name} 尋找並展示 ${g.cname(sel[0])}，加入手中。`); }
    g.shuffle(pl.deck);
    if (sd) {
      const w = yield* g.pick(p, { prompt: '《起源地探索》星塵效果：可破壞你場上 1 個「荒野」，然後將這個魔法置入陰謀區', cards: wildsOnField(g, p), min: 0, max: 1, harm: false });
      if (w[0] && g.destroy(w[0])) { yield* g.flushTriggers(); if (self.zone === 'stack') { g.move(self, 'conspiracy'); g.log('《起源地探索》置入陰謀區。'); } }
    }
  } },
  vir19: { // 原始樣本-衰弱
    attachVol: -2,
    *magic(g, p, self, sd) {
      yield* attachVir(g, p, self, g.allFollowers(), '《原始樣本-衰弱》：附著於場上 1 個信徒（聲量 -2）', function* (f) {
        if (sd) { const n = g.sym(p, '自然'); f.tempVol = { turn: g.turnNo, val: -n }; g.log(`星塵效果：本回合 ${g.cname(f)} 聲量再 -${n}。`); }
      });
    },
  },
  vir20: { // 原始樣本-遺忘
    grantNeverGuilty: true,
    calMod: (g, p, self, sd) => sd ? g.sym(p, '醫藥') : 0,
    *magic(g, p, self) { yield* attachVir(g, p, self, g.allFollowers(), '《原始樣本-遺忘》：附著於場上 1 個信徒（不會變為罪惡）'); },
  },
  vir21: { // 原始樣本-寄生
    morphWild: true, tempControl: true,
    *magic(g, p, self, sd) {
      yield* attachVir(g, p, self, g.allFollowers().filter(f => f.guilty && g.vol(f) <= 2), '《原始樣本-寄生》：附著於場上 1 個聲量 2 以下的罪惡信徒（改為地點「荒野」）', function* (f) {
        g.morphToWild(f);
        if (sd) g.takeControl(f, p, self);
      });
    },
  },
  vir22: { // 進化樣本-啟示
    attachVol: -2,
    *magic(g, p, self, sd) {
      yield* attachVir(g, p, self, g.allFollowers(), '《進化樣本-啟示》：附著於場上 1 個信徒（聲量 -2）');
      if (!sd) return; // 星塵效果與基本效果獨立
      const n = fl(g.sym(p, '禁忌') / 2);
      yield* repeatPick(g, p, n, function* (i) {
        const c = yield* g.pickOne(p, { prompt: `《進化樣本-啟示》星塵效果：將場上 1 個信徒變為罪惡（${i + 1}/${n}）`, cards: g.allFollowers().filter(x => !x.guilty && !g.neverGuilty(x)), harm: true });
        if (!c) return false;
        g.makeGuilty(c); return true;
      });
    },
  },
  vir23: { // 進化樣本-救贖
    attachVol: -2,
    *magic(g, p, self, sd) {
      const f = yield* attachVir(g, p, self, g.allFollowers(), '《進化樣本-救贖》：附著於場上 1 個信徒（聲量 -2）');
      if (!f || !sd) return;
      const v = g.vol(f);
      yield* controlPick(g, p, g.followers(g.opp(p)).filter(x => x !== f && g.vol(x) < v), `《進化樣本-救贖》星塵效果：獲得敵方場上 1 個聲量小於 ${v} 的信徒的控制權`);
    },
  },
  vir24: { *magic(g, p, self, sd) { // 進化樣本-鼠王
    const f = yield* g.pickOne(p, { prompt: '《進化樣本-鼠王》：除外你場上 1 個信徒', cards: g.followers(p), harm: false });
    if (!f) g.log('《進化樣本-鼠王》：你場上沒有信徒，基本效果無法結算。');
    else {
      const v = g.vol(f);
      if (g.exile(f)) {
        const same = g.allFollowers().filter(x => g.vol(x) === v);
        if (same.length) g.log(`《進化樣本-鼠王》：除外場上所有聲量 ${v} 的信徒。`);
        for (const x of same) g.exile(x);
      }
    }
    if (sd) {
      const ex = exiledFollowers(g, p), onField = g.allFollowers().length;
      g.log(`《進化樣本-鼠王》星塵效果：你除外區信徒 ${ex}，雙方場上信徒 ${onField}。`);
      if (ex > onField) g.win(p, `${g.pname(p)} 以《進化樣本-鼠王》達成勝利條件`);
    }
  } },
});

// ======== 紫靈山 ========
const flagAdd = (g, p, k, n) => { g.P[p].flags[k] = (g.P[p].flags[k] || 0) + n; };
function* triggerDiscardMagic(g, p, filter, prompt, exileAfter) {
  const m = yield* g.pickOne(p, { prompt, cards: g.P[p].discard.filter(c => T(g, c) === '魔法' && filter(c)), harm: false });
  if (!m) { g.log('棄牌區沒有可觸發的魔法。'); return false; }
  yield* g.triggerBase(p, m);
  if (exileAfter && m.zone === 'discard') g.exile(m);
  return true;
}
Object.assign(EFFECTS, {
  cen01: { // 黑蟾法師
    stardustReduce: (g, self, p) => p === self.owner ? 1 : 0,
    canQuick: (g, p) => g.P[p].discard.some(m => T(g, m) === '魔法' && (g.def(m).calamity || 0) >= 4 && g.stardust(p) >= g.stardustNeed(p, m)),
    *quick(g, p) {
      yield* triggerDiscardMagic(g, p, m => (g.def(m).calamity || 0) >= 4 && g.stardust(p) >= g.stardustNeed(p, m), '《黑蟾法師》：觸發你棄牌區 1 張原始災厄 4 以上且滿足星塵需求的魔法基礎效果（之後除外）', true);
    },
  },
  cen02: { needs: { 野性: 4 }, cond: (g, p) => g.followers(p).filter(f => g.vol(f) >= 5).length >= 3 },
  cen03: { cond: (g, p) => g.P[p].exile.length >= 6 },
  cen04: { needs: { 知識: 4, 醫藥: 4 } },
  cen05: { *chant(g, p) { // 千雪
    const n = fl(g.sym(p, '醫藥') / 2);
    yield* repeatPick(g, p, n, function* (i) {
      const c = yield* g.pickOne(p, { prompt: `《千雪》：解除你場上 1 個信徒的罪惡（${i + 1}/${n}）`, cards: g.followers(p).filter(f => f.guilty), harm: false });
      if (!c) return false;
      g.unGuilty(c); return true;
    });
  } },
  cen06: { // 黃石
    counterVol: (g, self) => g.P[self.owner].discard.filter(c => T(g, c) === '魔法').length,
    *onMagicPlayedHand(g, self, m) {
      const p = self.owner;
      if (!g.rituals(p).length || self.zone !== 'hand') return;
      const k = yield* g.ask(p, `你打出了 ${g.cname(m)}：要展示並獻祭手中的《黃石》嗎？`, [{ key: 1, label: '展示並獻祭黃石', uid: self.uid, cardId: self.id }, { key: 0, label: '不要' }], 'yellowstone');
      if (k) { g.log(`${g.pname(p)} 展示手中的《黃石》。`); yield* g.sacrifice(p, [self], '《黃石》：選擇獻祭給哪個儀式'); }
    },
  },
  cen07: { stardustReduce: (g, self, p) => p === self.owner ? fl(g.sym(p, '知識') / 3) : 0 },
  cen08: { onOwnEnter(g, self, c) { // 養殖者
    const p = self.owner;
    if (g.active !== p || (g.def({ id: c.id }).volume || 0) < 5) return;
    g.queue('cen08', function* () {
      if (!g.rituals(p).length || !g.P[p].discard.length) return;
      const sel = yield* g.pick(p, { prompt: `《養殖者》：${g.cname(c)} 進場，可獻祭你棄牌區 1 張牌`, cards: g.P[p].discard.slice(), min: 0, max: 1, harm: false });
      if (sel[0]) yield* g.sacrifice(p, sel, '《養殖者》：選擇獻祭給哪個儀式');
    }, { label: `養殖者：${g.def(c).name} 進場` });
  } },
  cen09: { *chant(g, p) { // 掌中符
    const n = fl(g.sym(p, '煉金') / 2);
    for (let i = 0; i < n; i++) {
      const u = yield* g.pickOne(p, { prompt: `《掌中符》：棄置你 1 張被獻祭的牌（${i + 1}/${n}）`, cards: g.P[p].under.slice(), harm: false, info: 'discard' });
      if (!u) { g.log('《掌中符》：沒有被獻祭的牌，效果中止。'); return; }
      g.move(u, 'discard'); g.log(`${g.pname(p)} 棄置 1 張被獻祭的牌（${g.cname(u)}）。`);
      const f = yield* g.pickOne(p, { prompt: '《掌中符》：除外場上 1 個信徒', cards: g.allFollowers(), harm: true });
      if (f) g.exile(f);
      yield* g.flushTriggers();
    }
  } },
  cen10: { *chant(g, p) { // 霜蟾
    const c = yield* g.pickOne(p, { prompt: '《霜蟾》：除外你場上 1 張有醫藥符號的非教主牌', cards: g.P[p].field.filter(x => T(g, x) !== '教主' && (g.def(x).symbols || []).includes('醫藥')), harm: false });
    if (!c || !g.exile(c)) { g.log('《霜蟾》：沒有除外，效果中止。'); return; }
    yield* g.flushTriggers();
    yield* triggerDiscardMagic(g, p, () => true, '《霜蟾》：觸發你棄牌區 1 張魔法的基礎效果');
  } },
  cen11: { ascendWild: true, neverGuilty: true },
  cen12: { noCounter: true, *chant(g, p, self) { // 修行失敗者
    const sel = yield* g.pick(p, { prompt: '《修行失敗者》：可除外你 1 張手牌（若不除外，破壞你場上 2 個信徒）', cards: g.P[p].hand.slice(), min: 0, max: 1, harm: false, info: 'discard' });
    if (sel[0]) { g.exile(sel[0]); return; }
    const fs = g.followers(p), k = Math.min(2, fs.length);
    const d = yield* g.pick(p, { prompt: `《修行失敗者》：破壞你場上 ${k} 個信徒`, cards: fs, min: k, max: k, harm: false });
    for (const f of d) g.destroy(f);
  } },
  cen13: { *chant(g, p) { // 蝶夫人
    flagAdd(g, p, 'magicCalBonus', 1); g.log('《蝶夫人》：本回合你的魔法災厄 +1。');
    yield* playMagicFrom(g, p, g.P[p].hand.filter(c => T(g, c) === '魔法'), '《蝶夫人》：可打出手牌 1 張魔法');
  } },
  cen14: { *chant(g, p) { // 蜘蛛僧
    const fs = yield* g.pick(p, { prompt: '《蜘蛛僧》：破壞場上至多 2 個信徒', cards: g.allFollowers(), min: 0, max: 2, harm: true });
    for (const f of fs) g.destroy(f);
  } },
  cen15: { stardustReduce: (g, self, p) => p === self.owner ? 2 * g.countLocType(p, '庭院') : 0 },
  cen16: { snakeExile: true, neverGuilty: true },
  cen17: { onOwnFollowerExiled(g, self, c, holder) { // 還魂橋
    const p = self.owner;
    if (g.active !== p || holder !== p) return;
    g.queue('cen17', function* () { yield* returnFromDiscard(g, p, () => true, `《還魂橋》：${g.def(c).name} 被除外，將你棄牌區 1 張牌拿回手`); }, { label: `還魂橋：${g.def(c).name} 被除外` });
  } },
  cen18: { *locAction(g, p) { // 百蠱堂
    const c = yield* g.pickOne(p, { prompt: '《百蠱堂》：除外你棄牌區 1 張牌', cards: g.P[p].discard.slice(), harm: false, info: 'discard' });
    if (!c) { g.log('《百蠱堂》：棄牌區沒有牌，效果中止。'); return; }
    g.exile(c);
    flagAdd(g, p, 'ascendBonus', 1); flagAdd(g, p, 'sdBonus', 2); flagAdd(g, p, 'magicCalBonus', 1);
    g.log('《百蠱堂》：本回合飛升需求 -1、魔法星塵需求 -2、魔法災厄 +1。');
  } },
  cen19: { *locAction(g, p) { // 空蟲院
    const n = g.sym(p, '野性');
    const f = yield* g.pickOne(p, { prompt: `《空蟲院》：除外場上 1 個聲量小於 ${n} 的信徒`, cards: g.allFollowers().filter(x => g.vol(x) < n), harm: true });
    if (f) g.exile(f);
  } },
  cen20: { ascendReduce: (g, self, p) => p === self.owner ? fl(g.sym(p, '醫藥') / 3) : 0 },
  cen21: { *magic(g, p, self, sd) { // 蠱丹法
    flagAdd(g, p, 'ascendBonus', 1); g.log('《蠱丹法》：本回合你的飛升需求 -1。');
    if (!sd || !g.rituals(p).length) return;
    const pl = g.P[p];
    const maxTop = Math.min(4, pl.deck.length);
    const o = [];
    for (let i = 0; i <= maxTop; i++) o.push({ key: i + 1, label: `從牌庫頂獻祭 ${i} 張` });
    const k = (yield* g.ask(p, '《蠱丹法》星塵效果：獻祭牌庫頂、手牌、棄牌區總計至多 4 張；先選牌庫頂張數', o, 'sacTop')) - 1;
    for (let i = 0; i < k; i++) { const c = topDeck(g, p); if (c) yield* g.sacrifice(p, [c], '《蠱丹法》：選擇獻祭給哪個儀式'); }
    const rest = 4 - k;
    if (rest <= 0) return;
    const sel = yield* g.pick(p, { prompt: `《蠱丹法》：再從手牌或棄牌區獻祭至多 ${rest} 張`, cards: pl.hand.concat(pl.discard.filter(c => c !== self)), min: 0, max: rest, harm: false });
    if (sel.length) yield* g.sacrifice(p, sel, '《蠱丹法》：選擇獻祭給哪個儀式');
  } },
  cen22: { *magic(g, p, self, sd) { // 轉生術
    const pl = g.P[p];
    const n = g.sym(p, '煉金');
    let alt = false;
    if (sd && n > 0) alt = (yield* g.ask(p, '《轉生術》星塵效果：要改為每擁有 1 煉金，將棄牌區 1 張牌洗回牌庫嗎？', [{ key: 1, label: `改為洗回至多 ${n} 張任意牌` }, { key: 2, label: '洗回 1 個信徒（基礎效果）' }], 'mode')) === 1;
    const cards = alt ? pl.discard.filter(c => c !== self) : pl.discard.filter(c => T(g, c) === '信徒');
    const k = alt ? n : 1;
    const sel = yield* g.pick(p, { prompt: alt ? `《轉生術》：將你棄牌區至多 ${k} 張牌洗回牌庫` : '《轉生術》：將你棄牌區 1 個信徒洗回牌庫', cards, min: Math.min(alt ? 0 : 1, cards.length), max: Math.min(k, cards.length), harm: false });
    for (const c of sel) g.move(c, 'deck');
    if (sel.length) { g.shuffle(pl.deck); g.log(`${pl.name} 將 ${sel.map(c => g.cname(c)).join('、')} 洗回牌庫。`); }
  } },
  cen23: { // 嚙災
    calMod: (g, p, self, sd) => sd ? g.sym(p, '知識') : 0,
    *magic(g, p) {
      const fs = yield* g.pick(p, { prompt: '《嚙災》：除外場上任意數量的罪惡信徒', cards: g.allFollowers().filter(f => f.guilty), min: 0, max: 99, harm: true });
      for (const f of fs) g.exile(f);
    },
  },
  cen24: { *magic(g, p, self, sd) { // 蠱祖降臨
    g.draw(p, 1);
    const k = Math.min(2, g.P[p].hand.length);
    const ds = yield* g.pick(p, { prompt: `《蠱祖降臨》：棄置 ${k} 張手牌`, cards: g.P[p].hand.slice(), min: k, max: k, harm: false, info: 'discard' });
    for (const c of ds) g.discardFromHand(c);
    if (sd) {
      const w = g.sym(p, '野性'), n = g.followers(g.opp(p)).length;
      g.log(`《蠱祖降臨》星塵效果：你的野性 ${w}，敵方場上信徒 ${n}。`);
      if (w > n) g.win(p, `${g.pname(p)} 以《蠱祖降臨》達成勝利條件`);
    }
  } },
});

module.exports = { EFFECTS };
