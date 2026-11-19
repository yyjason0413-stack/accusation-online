'use strict';
// 《控訴》規則引擎 —— 權威伺服器端使用。
// 以 generator 驅動：需要玩家決定時 yield 一個 choice，伺服器送給該玩家，答覆後繼續。
// 卡片效果以「鉤子」寫在 effects.js（見檔頭說明），引擎只處理通用規則。
const DATA = require('./cards-data.json');
const { EFFECTS } = require('./effects');

const DEFS = {};
// 飛升(1*知識)(1*醫藥)。→ { 知識:1, 醫藥:1 }
function parseAscend(t) { const m = /^飛升((?:\(\d+\*\S{2}\))+)/.exec(t || ''); if (!m) return null; const r = {}; for (const x of m[1].matchAll(/\((\d+)\*(\S{2})\)/g)) r[x[2]] = (r[x[2]] || 0) + Number(x[1]); return r; }
for (const c of DATA) {
  const g = /駐守(\d+)/.exec(c.effect || ''), d = /解構(\d+)/.exec(c.effect || '');
  const kw = (c.effect || '').split(/[。：]/)[0];
  DEFS[c.id] = Object.assign({ guardX: g ? Number(g[1]) : 0, deconX: d ? Number(d[1]) : 0,
    offering: /^供品/.test(c.effect || ''), crusade: /^聖戰/.test(c.effect || ''), ascend: parseAscend(c.effect) }, c, EFFECTS[c.id] || {});
}
// 已完成全自動化的教團
const AUTOMATED = new Set(['白狐神社', '鴉教團', '放逐者', '逐光者', '禁忌廚房', '門教團', '瘋人院', '疫病中心', '紫靈山']);
const LEADER_FACTIONS = ['白狐神社', '鴉教團', '逐光者', '禁忌廚房', '門教團', '瘋人院', '疫病中心', '紫靈山'];
const FACTIONS = { '白狐神社': 'fox', '鴉教團': 'cro' };
const ZONE_NAMES = { deck: '牌庫', hand: '手牌', field: '場上', conspiracy: '陰謀區', discard: '棄牌區', exile: '除外區', score: '計分區', stack: '結算中', under: '儀式下（獻祭）' };
const ZONES = ['deck', 'hand', 'field', 'conspiracy', 'discard', 'exile', 'score', 'stack', 'under'];

class GameOver extends Error { constructor() { super('game over'); } }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Game {
  constructor(opts = {}) {
    this.seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31);
    this.rng = mulberry32(this.seed);
    this.uidSeq = 1;
    this.turnNo = 0;
    this.active = 0;
    this.actionsLeft = 0;
    this.winner = null;
    this.winReason = '';
    this.logs = [];
    this.pending = null;
    this.phase = 'setup';
    this.firstPlayer = 0;
    this.flowSeq = 0;
    this.eventSeq = 0;
    this.triggers = [];
    const factions = opts.factions || ['白狐神社', '鴉教團'];
    const names = opts.names || ['玩家一', '玩家二'];
    this.P = [0, 1].map(i => this.makePlayer(i, factions[i], names[i], opts.decks && opts.decks[i]));
  }

  makePlayer(i, faction, name, deckIds) {
    if (deckIds) {
      const v = validateDeck(deckIds);
      if (!v.ok) throw new Error('牌組不合法：' + v.errors.join('；'));
      faction = v.faction;
    }
    if (!LEADER_FACTIONS.includes(faction)) throw new Error('不支援的教團：' + faction);
    const ids = deckIds || presetDeck(faction);
    const pl = { idx: i, name, faction, flags: { chantSeqs: [] }, noCounterTurn: -1, noCounterChantTurn: -1, noRitualTurn: -1, cannotAttackTurn: -1, turnsTaken: 0, autoSkipCounter: true };
    for (const z of ZONES) pl[z] = [];
    pl.all = ids.map(id => this.newCard(id, i, 'deck'));
    return pl;
  }
  newCard(id, owner, zone) { return { uid: this.uidSeq++, id, owner, zone, guilty: false, guardAt: null, deconAt: null, attachTo: null, underOf: null, enteredSeq: 0 }; }

  // ---------- 基礎工具 ----------
  def(c) { return c.morph || DEFS[c.id]; }
  // 《原始樣本-寄生》：信徒改為地點「荒野」，守護為原始聲量
  morphToWild(c) {
    const d = DEFS[c.id];
    c.morphGuilty = c.guilty; c.guilty = false; c.guardAt = null; c.deconAt = null;
    c.morph = { id: d.id, name: d.name, faction: d.faction, type: '地點', locationType: '荒野', guard: d.volume || 0, calamity: 0, symbols: d.symbols || [], effect: '（被改為地點「荒野」）', morphed: true };
    this.log(`${this.cname(c)} 改為地點「荒野」（守護 ${d.volume || 0}）。`);
  }
  unmorph(c) {
    if (!c.morph) return;
    c.morph = null;
    if (c.zone === 'field') { c.guilty = !!c.morphGuilty; for (const pl of this.P) for (const f of pl.field) if (f.guardAt === c.uid) f.guardAt = null; this.log(`${this.cname(c)} 恢復為信徒。`); }
  }
  // 目前聲量（場上信徒受附著魔法、效果影響；可為負數）
  vol(c) {
    const d = this.def(c); let v = d.volume || 0;
    if (c.zone !== 'field' || d.type !== '信徒') return v;
    for (const pl of this.P) for (const m of pl.field) if (m.attachTo === c.uid && this.def(m).attachVol) v += this.def(m).attachVol;
    v += this.hookSum('volModAll', c);
    if (c.tempVol && c.tempVol.turn === this.turnNo) v += c.tempVol.val;
    return v;
  }
  isAttachMagic(c) { const d = DEFS[c.id]; return d.type === '魔法' && /^附著/.test(d.effect || ''); }
  attachedMagics() { return [...this.P[0].field, ...this.P[1].field].filter(m => m.attachTo != null && this.def(m).type === '魔法'); }
  win(p, reason) { this.lose(this.opp(p), reason); }
  // ----- 紫靈山：飛升 -----
  ascendReduce(p) { return this.hookSum('ascendReduce', p) + (p === this.active ? (this.P[p].flags.ascendBonus || 0) : 0); }
  // 飛升：每張被除外的牌只提供 1 個符號（《著魔煉丹師》可當任意符號）；需求減少可抵銷符號
  ascendSlots(req) { const r = []; for (const s in req) for (let i = 0; i < req[s]; i++) r.push(s); return r; }
  ascendNeed(p, req) { return Math.max(0, this.ascendSlots(req).length - this.ascendReduce(p)); }
  // 最大配對：cards → 需求符號格
  ascendMatch(req, cards) {
    const slots = this.ascendSlots(req), owner = new Array(slots.length).fill(-1);
    const ok = (c, s) => this.abil(c, 'ascendWild') || (this.def(c).symbols || []).includes(s);
    const tryK = (k, seen) => { for (let j = 0; j < slots.length; j++) if (!seen[j] && ok(cards[k], slots[j])) { seen[j] = true; if (owner[j] < 0 || tryK(owner[j], seen)) { owner[j] = k; return true; } } return false; };
    let m = 0; for (let k = 0; k < cards.length; k++) if (tryK(k, [])) m++;
    return m;
  }
  // 合法支付：剛好除外「需要的張數」，且每張都對應到不同的需求符號（除外直到滿足為止，不可多付）
  ascendCovers(p, req, cards) { const n = this.ascendNeed(p, req); return cards.length === n && this.ascendMatch(req, cards) === n; }
  ascendPayers(p, c) { return this.P[p].field.filter(f => f !== c && this.def(f).type !== '教主'); }
  canAscend(p, c) { const req = this.def(c).ascend; if (!req) return true; const n = this.ascendNeed(p, req); return this.ascendMatch(req, this.ascendPayers(p, c)) >= n; }
  // 飛升信徒只能以飛升方式（回合行動打出）進場
  canEnterByEffect(c) { return !DEFS[c.id].ascend; }
  stardustNeed(p, m) { return Math.max(0, this.def(m).stardust - this.hookSum('stardustReduce', p, m) - (p === this.active ? (this.P[p].flags.sdBonus || 0) : 0)); }
  // 觸發魔法的基礎效果（不算打出、不能被控訴、不啟動星塵效果）
  *triggerBase(p, m) {
    this.log(`${this.pname(p)} 觸發 ${this.cname(m)} 的基礎效果。`);
    const back = m.zone;
    this.move(m, 'stack');
    yield* this.def(m).magic(this, p, m, false);
    yield* this.flushTriggers();
    if (m.zone === 'stack') this.move(m, back);
  }
  opp(p) { return 1 - p; }
  rand(n) { return Math.floor(this.rng() * n); }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = this.rand(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  cname(c) { return '《' + this.def(c).name + '》'; }
  pname(p) { return this.P[p].name; }
  log(text, to = null) { this.logs.push({ n: this.logs.length, text, to, turn: this.turnNo }); }
  findCard(p, uid) { return this.P[p].all.find(c => c.uid === uid); }
  findAny(uid) { return this.findCard(0, uid) || this.findCard(1, uid); }

  zoneArr(c) { return this.P[c.owner][c.zone]; }
  move(c, zone, { top = true } = {}) {
    if (zone === 'field' && c.zone !== 'field' && DEFS[c.id].ascend && !c.ascending) { this.log(`${this.cname(c)} 是飛升信徒，只能以飛升方式進場。`); return c; }
    c.ascending = false;
    const from = this.zoneArr(c);
    const i = from.indexOf(c);
    if (i >= 0) from.splice(i, 1);
    const wasField = c.zone === 'field';
    const tempCtrlTarget = wasField && c.attachTo != null && this.def(c).tempControl ? this.findAny(c.attachTo) : null;
    if (wasField && c.attachTo != null && this.def(c).morphWild) { const t = this.findAny(c.attachTo); if (t) this.unmorph(t); }
    if (wasField && c.morph) { c.morph = null; }
    const leftType = wasField ? (this.def(c).type === '地點' ? this.locType(c) : this.def(c).type) : null;
    const leftFrom = c.owner;
    // 控制權（設計者裁定 2026-11-13）：被取得控制權的牌完全成為控制者的牌，離場時進入控制者的對應區域
    if (zone !== 'field') { c.ctrlFrom = null; c.ctrlBy = null; }
    c.zone = zone;
    if (zone === 'field') c.enteredSeq = ++this.eventSeq;
    c.guilty = false; c.guardAt = null; c.deconAt = null; c.attachTo = null; c.tempAtk = null; c.tempVol = null;
    if (zone !== 'under') c.underOf = null;
    if (wasField) this.onLeaveField(c);
    const to = this.P[c.owner][zone];
    if (zone === 'deck' && !top) to.unshift(c); else to.push(c);
    if (zone === 'field' && this.def(c).type === '信徒') for (const h of this.activeCards(c.owner)) if (h !== c && this.def(h).onOwnEnter) this.def(h).onOwnEnter(this, h, c);
    // 「你場上的…離場時」（《餐廳經理》）
    if (wasField) for (const h of this.activeCards(leftFrom)) if (this.def(h).onOwnLeave) this.def(h).onOwnLeave(this, h, c, leftType);
    // 附著魔法給予的控制權（《深度催眠》《原始樣本-寄生》）：魔法離場而該牌仍在場上時，控制權回到原持有者
    if (tempCtrlTarget && tempCtrlTarget.zone === 'field' && tempCtrlTarget.ctrlBy === c.uid && tempCtrlTarget.ctrlFrom != null) {
      this.log(`${this.cname(c)} 離場，${this.cname(tempCtrlTarget)} 的控制權回到原持有者。`);
      this.takeControl(tempCtrlTarget, tempCtrlTarget.ctrlFrom);
    }
    return c;
  }
  // 離場的連帶處理：駐守/解構者移到場上；附著的魔法回持有者棄牌區；儀式下的獻祭牌置入棄牌區
  onLeaveField(c) {
    for (const pl of this.P) for (const f of pl.field.slice()) {
      if (f.guardAt === c.uid) f.guardAt = null;
      if (f.deconAt === c.uid) f.deconAt = null;
      if (f.attachTo === c.uid) { this.move(f, 'discard'); this.log(`附著的 ${this.cname(f)} 回到棄牌區。`); }
    }
    for (const pl of this.P) for (const u of pl.under.filter(x => x.underOf === c.uid)) this.move(u, 'discard');
  }
  // 牌庫頂 = 陣列尾端
  draw(p, n = 1) {
    const pl = this.P[p];
    let got = 0;
    for (let k = 0; k < n; k++) {
      if (!pl.deck.length) { this.log(`${pl.name} 牌庫已空，無法抽牌。`); break; }
      const c = pl.deck[pl.deck.length - 1];
      this.move(c, 'hand');
      this.log(`你抽到 ${this.cname(c)}。`, p);
      got++;
    }
    if (got) this.log(`${pl.name} 抽了 ${got} 張牌。`);
    return got;
  }

  field(p, type) { return this.P[p].field.filter(c => !type || this.def(c).type === type); }
  followers(p) { return this.field(p, '信徒'); }
  allFollowers() { return [...this.followers(0), ...this.followers(1)]; }
  locations(p) { return this.field(p, '地點'); }
  rituals(p) { return this.field(p, '儀式'); }
  leaderOf(p) { return this.P[p].field.find(c => this.def(c).type === '教主'); }
  leaderOnField(p, id) { return this.P[p].field.find(c => c.id === id && this.def(c).type === '教主'); }
  suppressed(c) { return this.P.some(pl => pl.field.some(m => m.attachTo === c.uid && this.def(m).suppress)); }
  attachedWith(c, key) { return this.P.some(pl => pl.field.some(m => m.attachTo === c.uid && this.def(m)[key])); }
  // 效果欄能力（被《深度催眠》等附著而失去能力時無效）
  abil(c, key) { return c.zone === 'field' && this.suppressed(c) ? undefined : this.def(c)[key]; }
  // 取得控制權：放到 p 的場上，視為 p 的卡
  takeControl(c, p, by = null) {
    if (c.zone !== 'field' || c.owner === p) return false;
    const old = c.owner;
    const from = this.P[old].field; from.splice(from.indexOf(c), 1);
    const ai = this.P[old].all.indexOf(c); if (ai >= 0) this.P[old].all.splice(ai, 1);
    this.P[p].all.push(c);
    if (c.ctrlFrom === p) { c.ctrlFrom = null; c.ctrlBy = null; }
    else { if (c.ctrlFrom == null) c.ctrlFrom = old; c.ctrlBy = by ? by.uid : null; }
    c.owner = p; c.guardAt = null; c.deconAt = null;
    for (const f of this.P[old].field) { if (f.guardAt === c.uid) f.guardAt = null; if (f.deconAt === c.uid) f.deconAt = null; }
    this.P[p].field.push(c);
    this.log(`${this.pname(p)} 取得 ${this.cname(c)} 的控制權。`);
    return true;
  }
  // 有效（效果生效中）：在場上；罪惡信徒只提供符號、不具效果；被《推倒聖像》附著的教主失去能力
  active_(c) {
    if (c.zone !== 'field') return false;
    const t = this.def(c).type;
    if (t === '信徒' && c.guilty) return false;
    if (this.suppressed(c)) return false;
    return true;
  }
  activeCards(p) { return (p == null ? [...this.P[0].field, ...this.P[1].field] : this.P[p].field).filter(c => this.active_(c)); }
  hasActive(p, id) { return this.P[p].field.some(c => c.id === id && this.active_(c)); }
  anyActive(id) { return this.hasActive(0, id) || this.hasActive(1, id); }
  leaderActive(p, id) { const l = this.leaderOnField(p, id); return !!l && this.active_(l); }
  // 對所有有效卡呼叫數值鉤子並加總
  hookSum(name, ...args) {
    let s = 0;
    for (const c of this.activeCards()) { const h = this.def(c)[name]; if (h) s += h(this, c, ...args) || 0; }
    return s;
  }
  hookAny(name, ...args) { return this.activeCards().some(c => { const h = this.def(c)[name]; return h && h(this, c, ...args); }); }

  sym(p, s) {
    let n = 0;
    for (const c of this.P[p].field) for (const x of this.def(c).symbols || []) if (x === s) n++;
    return n;
  }
  symbolsAll(p) {
    const r = {};
    for (const c of this.P[p].field) for (const x of this.def(c).symbols || []) r[x] = (r[x] || 0) + 1;
    return r;
  }
  stardust(p) { return this.followers(p).filter(c => !c.guilty).length; }
  // 地點目前的類型（《寄生的信者》駐守時改為「荒野」）
  locType(l) {
    if (l.zone === 'field') for (const f of this.P[l.owner].field) if (f.guardAt === l.uid && !f.guilty && this.def(f).guardSetType) return this.def(f).guardSetType;
    return this.def(l).locationType;
  }
  hasLocType(p, t) { return this.locations(p).some(c => this.locType(c) === t); }
  countLocType(p, t) { return this.locations(p).filter(c => this.locType(c) === t).length; }
  // 地點類型改變後，不能駐守該類型的信徒（《沼澤女巫》）移出該地點，維持非罪惡
  fixGuards() {
    for (const pl of this.P) for (const f of pl.field) {
      const ct = this.def(f).cantGuardType;
      if (ct && f.guardAt != null) { const l = this.findAny(f.guardAt); if (l && this.locType(l) === ct) { f.guardAt = null; this.log(`${this.cname(f)} 不能駐守「${ct}」，移出 ${this.cname(l)}（維持非罪惡）。`); } }
    }
  }
  isCrusader(c) { return !!this.abil(c, 'crusade') || this.P.some(pl => pl.field.some(m => m.attachTo === c.uid && this.def(m).grantCrusade)); }
  guardingCount(p) { return this.followers(p).filter(c => !c.guilty && c.guardAt != null).length; }

  locGuard(loc) {
    let g = this.def(loc).guard || 0;
    for (const pl of this.P) for (const f of pl.field) if (f.guardAt === loc.uid && !f.guilty) g += this.guardX(f);
    return g;
  }
  guardX(f) { return this.def(f).guardX; }
  deconXOf(f) { const d = this.def(f); return d.deconValue ? d.deconValue(this, f) : d.deconX; }
  attackVolume(c) {
    const d = this.def(c); let v = this.vol(c);
    if (d.attackVol && this.active_(c)) v += d.attackVol(this, c);
    v += this.hookSum('attackVolAll', c);
    if (c.tempAtk && c.tempAtk.turn === this.turnNo) v += c.tempAtk.val;
    return Math.max(0, v);
  }
  counterVolume(c) { const d = this.def(c); let v = d.volume || 0; if (d.counterVol) v += d.counterVol(this, c); v += this.hookSum('counterVolAll', c); return v; }
  isOffering(c) { return this.def(c).offering && this.active_(c); }
  canCounterWith(c) { const d = this.def(c); return d.type === '信徒' && !d.noCounter && !d.offering && !d.ascend; }
  neverGuilty(c) { return !!this.abil(c, 'neverGuilty') || (c.zone === 'field' && this.attachedWith(c, 'grantNeverGuilty')); }

  // ----- 儀式條件（含獻祭/解構減免）-----
  ritualReduction(r) {
    const p = r.owner;
    let n = this.P[p].under.filter(u => u.underOf === r.uid).length;
    for (const f of this.followers(p)) if (f.deconAt === r.uid && !f.guilty) n += this.deconXOf(f);
    n += this.hookSum('ritualReduceAll', r);
    return n;
  }
  symbolDeficit(p, needs) { let d = 0; for (const s in needs) d += Math.max(0, needs[s] - this.sym(p, s)); return d; }
  ritualReady(r) {
    const p = r.owner, d = this.def(r);
    if (d.needs && this.symbolDeficit(p, d.needs) > this.ritualReduction(r)) return false;
    if (d.cond && !d.cond(this, p, r)) return false;
    return true;
  }
  ritualCalamity(p, r) {
    let cal = this.def(r).calamity || 0;
    cal += this.hookSum('ritualCalMod', p, r);
    if (p === this.active) cal += this.P[p].flags.ritualCalBonus || 0;
    return cal;
  }
  magicCalamity(p, m, sd) {
    const d = this.def(m);
    let cal = d.calamity || 0;
    if (d.calMod) cal += d.calMod(this, p, m, sd) || 0;
    cal += this.hookSum('magicCalMod', p, m);
    if (p === this.active) cal += this.P[p].flags.magicCalBonus || 0;
    return cal;
  }
  ritualsProtected(p) { return this.activeCards(p).some(c => { const h = this.def(c).protectRituals; return h && h(this, c); }); }

  // ----- 觸發佇列：效果中途觸發的新效果，於下一次選擇前（或效果結束時）先結算 -----
  // 觸發佇列。opts.label：讓回合玩家選擇順序時顯示；opts.after：「後」類效果，排在「時」類之後
  queue(name, gen, opts = {}) {
    const label = opts.label || (DEFS[name] ? `${this.def({ id: name }).name} 的效果` : name);
    this.triggers.push({ name, gen, label, after: !!opts.after, uid: opts.uid });
  }
  // 同時觸發的效果：「時」先於「後」；同一類有多個不同效果時由回合玩家決定順序；
  // 結算某個效果中新產生的觸發，先於剩下的效果結算（最新的先結算）。
  *flushTriggers() {
    this.fixGuards();
    while (this.triggers.length) {
      const batch = this.triggers.splice(0);
      while (batch.length) {
        let cand = batch.filter(t => !t.after);
        if (!cand.length) cand = batch;
        let t = cand[cand.length - 1];
        if (new Set(cand.map(x => x.label)).size > 1 && this.winner == null) {
          const opts = cand.map((x, i) => ({ key: i, label: `先結算：${x.label}`, uid: x.uid }));
          const k = yield* this.ask(this.active, '多個效果同時觸發，選擇先結算哪一個', opts, 'order');
          t = cand[k];
        }
        batch.splice(batch.indexOf(t), 1);
        yield* t.gen();
        yield* this.flushTriggers();
      }
    }
  }

  makeGuilty(c) {
    if (c.zone !== 'field' || this.def(c).type !== '信徒') return false;
    if (this.neverGuilty(c)) { this.log(`${this.cname(c)} 不會變為罪惡。`); return false; }
    if (c.guilty) return false;
    const wasActive = this.active_(c);
    c.guilty = true; c.guardAt = null; c.deconAt = null;
    this.log(`${this.cname(c)}（${this.pname(c.owner)}）變為罪惡。`);
    if (wasActive && this.def(c).onGuilty) this.def(c).onGuilty(this, c);
    return true;
  }
  unGuilty(c) {
    if (c.zone !== 'field' || !c.guilty) return false;
    if (this.attachedWith(c, 'restrain')) { this.log(`${this.cname(c)} 被《強制拘束》，不能解除罪惡。`); return false; }
    c.guilty = false;
    this.log(`${this.cname(c)}（${this.pname(c.owner)}）解除罪惡。`);
    return true;
  }
  destroy(c) {
    if (c.zone !== 'field') return false;
    const d = this.def(c);
    if (d.type === '儀式' && this.ritualsProtected(c.owner)) { this.log(`${this.cname(c)} 受保護，不會被破壞。`); return false; }
    const wasActive = this.active_(c);
    if (wasActive && d.replaceDestroy) { d.replaceDestroy(this, c); return true; }
    const lt = d.type === '地點' ? this.locType(c) : null;
    // 《食材輸送帶》：你場上的信徒被破壞「後」改為置入陰謀區（先結算被破壞時效果）
    const belt = d.type === '信徒' && this.activeCards(c.owner).find(h => this.def(h).beltToConspiracy);
    this.move(c, 'discard');
    this.log(`${this.cname(c)}（${this.pname(c.owner)}）被破壞。`);
    if (belt) this.queue('belt', function* () { if (c.zone === 'discard') { this.move(c, 'conspiracy'); this.log(`${this.cname(belt)}：${this.cname(c)} 改為置入陰謀區。`); } }.bind(this), { after: true, label: `食材輸送帶：${this.def(c).name} 改為置入陰謀區` });
    if (wasActive && d.onDestroyed) d.onDestroyed(this, c);
    if (lt) for (const h of this.activeCards(c.owner)) if (this.def(h).onOwnLocDestroyed) this.def(h).onOwnLocDestroyed(this, h, c, lt);
    return true;
  }
  exile(c) {
    if (c.zone === 'exile') return false;
    if (c.zone === 'field' && this.def(c).type === '儀式' && this.ritualsProtected(c.owner)) { this.log(`${this.cname(c)} 受保護，不會被除外。`); return false; }
    const from = ZONE_NAMES[c.zone];
    const fieldFollower = c.zone === 'field' && this.def(c).type === '信徒', holder = c.owner;
    this.move(c, 'exile');
    this.log(`${this.cname(c)}（${this.pname(c.owner)}）從${from}被除外。`);
    if (fieldFollower) for (const h of this.activeCards(holder)) if (this.def(h).onOwnFollowerExiled) this.def(h).onOwnFollowerExiled(this, h, c, holder);
    return true;
  }
  toHand(c) {
    const from = ZONE_NAMES[c.zone];
    this.move(c, 'hand');
    this.log(`${this.pname(c.owner)} 將 ${this.cname(c)} 從${from}拿回手。`);
  }
  discardFromHand(c, random = false) {
    this.move(c, 'discard');
    this.log(`${this.pname(c.owner)} ${random ? '隨機' : ''}棄置了 ${this.cname(c)}。`);
  }
  revealHand(p, to, except = null) {
    const h = this.P[p].hand.filter(c => c !== except);
    this.log(`${this.pname(p)} 向 ${this.pname(to)} 展示手牌（${h.length} 張）。`);
    this.log(`${this.pname(p)} 的手牌：${h.map(c => this.def(c).name).join('、') || '（無）'}`, to);
  }
  // 獻祭：蓋在自己場上 1 個儀式下方（場上沒有儀式就不能獻祭）
  *sacrifice(p, cards, prompt = '選擇要獻祭給哪個儀式') {
    let n = 0;
    for (const c of cards) {
      const rs = this.rituals(p);
      if (!rs.length) { this.log('場上沒有儀式，無法獻祭。'); break; }
      const r = rs.length === 1 ? rs[0] : yield* this.pickOne(p, { prompt: `${prompt}（${c.zone === 'deck' ? '牌庫頂 1 張，獻祭後才能察看' : this.def(c).name}）`, cards: rs, harm: false });
      const from = ZONE_NAMES[c.zone];
      this.move(c, 'under'); c.underOf = r.uid;
      this.log(`${this.pname(p)} 從${from}獻祭 1 張牌給 ${this.cname(r)}。`);
      this.log(`（你獻祭了 ${this.cname(c)}）`, p);
      n++;
    }
    return n;
  }
  complete(r) {
    const p = r.owner;
    const hs = this.activeCards(p).filter(h => this.def(h).afterOwnComplete);
    this.move(r, 'score');
    this.log(`★ ${this.pname(p)} 完成儀式 ${this.cname(r)}！（計分區 ${this.P[p].score.length}/2）`);
    for (const h of hs) this.def(h).afterOwnComplete(this, h, r);
    this.checkWin();
  }
  checkWin() {
    for (const p of [this.active, this.opp(this.active)]) {
      if (this.P[p].score.length >= 2 && this.winner == null) {
        this.winner = p; this.winReason = `${this.pname(p)} 完成了 2 個儀式`;
        this.log(`🏆 ${this.winReason}，獲得勝利！`);
      }
    }
    if (this.winner != null) throw new GameOver();
  }
  lose(p, reason) {
    this.winner = this.opp(p); this.winReason = reason;
    this.log(`🏆 ${reason}，${this.pname(this.winner)} 獲得勝利！`);
    throw new GameOver();
  }

  // ---------- 選擇介面 ----------
  *pick(p, { prompt, cards, min = 1, max = 1, harm = null, validate = null, info = null, vals = null, sumMin = null, sumMax = null, suggest = null, errMsg = null }) {
    yield* this.flushTriggers();
    if (!cards.length) return [];
    min = Math.min(min, cards.length);
    max = Math.min(max, cards.length);
    if (max <= 0) return [];
    const options = cards.map(c => ({ uid: c.uid, cardId: c.id, owner: c.owner, zone: c.zone, label: this.def(c).name + (c.owner !== p ? '（敵方）' : ''), val: vals ? vals(c) : undefined }));
    const sg = suggest ? suggest.map(c => cards.indexOf(c)).filter(i => i >= 0) : null;
    const sel = yield { player: p, type: 'pick', prompt, options, min, max, harm, info, sumMin, sumMax, suggest: sg, errMsg,
      validate: validate ? (idx => validate(idx.map(i => cards[i]))) : null };
    return sel.map(i => cards[i]);
  }
  *pickOne(p, opts) { const r = yield* this.pick(p, Object.assign({ min: 1, max: 1 }, opts)); return r[0] || null; }
  *ask(p, prompt, opts, info = null) {
    yield* this.flushTriggers();
    const options = opts.map(o => ({ label: o.label, key: o.key, uid: o.uid, cardId: o.cardId, kind: o.kind }));
    const sel = yield { player: p, type: 'ask', prompt, options, min: 1, max: 1, info };
    return opts[sel[0]].key;
  }
  *confirm(p, prompt) { return (yield* this.ask(p, prompt, [{ key: true, label: '是' }, { key: false, label: '否' }])) === true; }

  // ---------- 外部介面 ----------
  start() { this.flow = this.main(); this.advance(undefined); return this; }
  advance(ans) {
    let res;
    try { res = this.flow.next(ans); }
    catch (e) { if (e instanceof GameOver) { this.pending = null; this.phase = 'over'; return; } throw e; }
    if (res.done) { this.pending = null; this.phase = 'over'; return; }
    this.pending = res.value;
    this.pending.seq = ++this.flowSeq;
  }
  validAnswer(sel) {
    const ch = this.pending;
    if (!ch || !Array.isArray(sel)) return false;
    if (sel.length < ch.min || sel.length > ch.max) return false;
    if (new Set(sel).size !== sel.length) return false;
    for (const i of sel) if (!Number.isInteger(i) || i < 0 || i >= ch.options.length) return false;
    if (ch.validate && !ch.validate(sel)) return false;
    return true;
  }
  answer(player, sel) {
    if (!this.pending) return { ok: false, err: '目前沒有待決定的事項' };
    if (this.pending.player !== player) return { ok: false, err: '還沒輪到你' };
    if (!this.validAnswer(sel)) return { ok: false, err: this.pending.errMsg || '選擇不合法' };
    this.advance(sel);
    return { ok: true };
  }

  // ---------- 流程 ----------
  *main() {
    try {
      for (const pl of this.P) {
        const leader = pl.all.find(c => this.def(c).type === '教主');
        const rituals = pl.all.filter(c => this.def(c).type === '儀式');
        for (const c of pl.all) c.zone = 'deck';
        pl.deck = pl.all.filter(c => c !== leader && !rituals.includes(c));
        leader.zone = 'conspiracy'; pl.conspiracy = [leader];
        for (const r of rituals) r.zone = 'hand';
        pl.hand = rituals.slice();
        this.shuffle(pl.deck);
        this.draw(pl.idx, 6 - pl.hand.length);
      }
      this.firstPlayer = this.rand(2);
      this.active = this.firstPlayer;
      this.log(`擲硬幣決定先手：${this.pname(this.firstPlayer)}。`);
      this.phase = 'mulligan';
      for (const p of [this.firstPlayer, this.opp(this.firstPlayer)]) {
        const pl = this.P[p];
        const back = yield* this.pick(p, { prompt: '起手調度（只有一次）：選擇任意張手牌置於牌庫底，再抽回同樣張數。不換請直接確定。', cards: pl.hand.slice(), min: 0, max: pl.hand.length, harm: false, info: 'mulligan' });
        if (back.length) {
          for (const c of back) this.move(c, 'deck', { top: false });
          this.log(`${pl.name} 調度了 ${back.length} 張手牌。`);
          this.draw(p, back.length);
        } else this.log(`${pl.name} 不調度。`);
      }
      // 遊戲開始時的效果（《回歸原始》）
      for (const p of [this.firstPlayer, this.opp(this.firstPlayer)]) for (const c of this.P[p].hand.slice()) if (this.def(c).atGameStart && c.zone === 'hand') this.def(c).atGameStart(this, p, c);
      this.phase = 'play';
      yield* this.loop();
    } catch (e) {
      if (!(e instanceof GameOver)) throw e;
    }
  }
  *loop() { while (this.winner == null) { yield* this.turn(); this.active = this.opp(this.active); } }

  *turn() {
    const p = this.active, pl = this.P[p];
    this.turnNo++;
    pl.turnsTaken++;
    pl.flags = { chantTriggered: false, chantSeqs: [], nestUsed: false, leaderUsed: false, attackBonus: 0, ritualCalBonus: 0, attacks: 0 };
    this.actionsLeft = (p === this.firstPlayer && pl.turnsTaken === 1) ? 1 : 2;
    this.log(`—— 第 ${this.turnNo} 回合：${pl.name}（${this.actionsLeft} 個行動）——`);
    while (true) {
      const acts = this.legalActions(p);
      const key = yield* this.ask(p, `你的回合：剩餘 ${this.actionsLeft} 個行動`, acts, 'action');
      if (key.kind === 'end') break;
      yield* this.doAction(p, key);
      yield* this.flushTriggers();
    }
    // 回合結束：執行儀式
    this.phase = 'end';
    const noRit = pl.noRitualTurn === this.turnNo;
    if (noRit) this.log(`（${pl.name} 本回合無法執行儀式）`);
    const ready = noRit ? [] : this.rituals(p).filter(r => this.ritualReady(r));
    const deckEmpty = pl.deck.length === 0;
    if (ready.length) {
      const opts = ready.map(r => ({ key: r.uid, uid: r.uid, cardId: r.id, label: `執行儀式 ${this.def(r).name}（災厄 ${this.ritualCalamity(p, r)}）` }));
      if (!deckEmpty) opts.push({ key: 0, label: '不執行儀式' });
      const k = yield* this.ask(p, deckEmpty ? '牌庫已空：必須執行 1 個儀式，否則落敗。' : '回合結束：可執行場上 1 個已滿足條件的儀式。', opts, 'ritual');
      if (k) yield* this.executeRitual(p, ready.find(x => x.uid === k));
      yield* this.flushTriggers();
    } else if (deckEmpty) {
      this.lose(p, `${pl.name} 牌庫已空且無法執行儀式`);
    }
    // 《主廚》：敵方回合結束時手牌上限改為 5
    const lim = this.activeCards(this.opp(p)).some(h => this.def(h).enemyHandLimit5) ? 5 : 6;
    if (pl.hand.length > lim) {
      const n = pl.hand.length - lim;
      const ds = yield* this.pick(p, { prompt: `手牌超過 ${lim} 張，請棄置 ${n} 張。`, cards: pl.hand.slice(), min: n, max: n, harm: false, info: 'discard' });
      for (const c of ds) this.discardFromHand(c);
    }
    this.draw(p, 2);
    this.phase = 'play';
  }

  legalActions(p) {
    const pl = this.P[p], acts = [];
    if (this.actionsLeft > 0) {
      const anyDone = this.P[0].score.length + this.P[1].score.length > 0;
      for (const c of pl.conspiracy) if ((anyDone || this.def(c).type !== '教主') && this.canAscend(p, c)) acts.push({ key: { kind: 'play', uid: c.uid }, uid: c.uid, cardId: c.id, kind: 'play', label: `打出 ${this.def(c).name}（陰謀區）` });
      const fm = this.freeMagic(p) ? '（不花費行動）' : '';
      for (const c of pl.hand) if (this.canAscend(p, c)) acts.push({ key: { kind: 'play', uid: c.uid }, uid: c.uid, cardId: c.id, kind: 'play', label: `打出 ${this.def(c).name}${this.def(c).type === '魔法' ? fm : ''}` });
      for (const l of this.locations(p)) if (this.def(l).locAction && !(pl.noLocActionTurn === this.turnNo))
        acts.push({ key: { kind: 'loc', uid: l.uid }, uid: l.uid, cardId: l.id, kind: 'loc', label: `地點行動：${this.def(l).name}（災厄 ${this.def(l).calamity}）` });
      if (this.actionsLeft >= 2) for (const r of pl.discard.filter(c => this.def(c).type === '儀式'))
        acts.push({ key: { kind: 'ritualback', uid: r.uid }, uid: r.uid, cardId: r.id, kind: 'ritualback', label: `特殊行動（2 行動）：將棄牌區的 ${this.def(r).name} 放到場上` });
    }
    if (this.actionsLeft <= 0 && this.freeMagic(p)) {
      for (const c of [...pl.conspiracy, ...pl.hand]) if (this.def(c).type === '魔法') acts.push({ key: { kind: 'play', uid: c.uid }, uid: c.uid, cardId: c.id, kind: 'play', label: `打出 ${this.def(c).name}${c.zone === 'conspiracy' ? '（陰謀區）' : ''}（不花費行動）` });
    }
    const free = this.freeAttack(p);
    if ((this.actionsLeft > 0 || free) && this.canAttack(p)) {
      const tag = free ? '（不花費行動）' : '';
      for (const t of this.attackTargets(p)) if (this.canReach(p, t, 0))
        acts.push({ key: { kind: 'attack', uid: t.uid }, uid: t.uid, cardId: t.id, kind: 'attack', label: `襲擊 ${this.def(t).name}（${this.def(t).type === '地點' ? '守護' : '供品聲量'} ${this.targetValue(t)}）${tag}` });
      for (const t of this.crusadeTargets(p)) if (this.canReach(p, t, 0, true))
        acts.push({ key: { kind: 'crusade', uid: t.uid }, uid: t.uid, cardId: t.id, kind: 'crusade', label: `聖戰：襲擊罪惡信徒 ${this.def(t).name}（聲量 ${this.targetValue(t)}）${tag}` });
    }
    const leader = this.leaderOf(p);
    if (leader && this.active_(leader) && !pl.flags.leaderUsed && this.def(leader).canQuick && this.def(leader).canQuick(this, p))
      acts.push({ key: { kind: 'quick', uid: leader.uid }, uid: leader.uid, cardId: leader.id, kind: 'quick', label: `快速行動：${this.def(leader).name}` });
    acts.push({ key: { kind: 'end' }, kind: 'end', label: '結束回合' });
    return acts;
  }
  // 《漆黑樹洞》：每回合第一次襲擊不花費回合行動
  freeAttack(p) { return p === this.active && !this.P[p].flags.attacks && this.hookAny('freeFirstAttack', p); }
  // 《增幅管道》：每回合打出的第一張魔法不消耗回合行動
  freeMagic(p) { return p === this.active && !this.P[p].flags.magics && this.hookAny('freeFirstMagic', p); }
  canAttack(p) { return this.P[p].cannotAttackTurn !== this.turnNo; }
  // 可襲擊目標：敵方地點（受保護者除外）與敵方的供品信徒
  attackTargets(p) {
    const o = this.opp(p);
    const locs = this.locations(o).filter(l => !this.activeCards(o).some(c => { const h = this.def(c).noAttackOn; return h && h(this, c, l); }));
    return locs.concat(this.followers(o).filter(f => this.isOffering(f)));
  }
  crusadeTargets(p) { return this.followers(this.opp(p)).filter(f => f.guilty); }
  targetValue(t) { return this.def(t).type === '地點' ? this.locGuard(t) : this.vol(t); }
  attackers(p, crusade = false) {
    return this.followers(p).filter(c => !c.guilty && !this.abil(c, 'offering') && !this.abil(c, 'noAttack') && !this.attachedWith(c, 'restrain') && !this.hookAny('cantAttackFollower', c) && this.attackVolume(c) >= 1 && (!crusade || this.isCrusader(c)));
  }
  // 能否以某組合達到需求（考慮「只能單獨襲擊」）
  canReach(p, t, base, crusade = false) {
    const atk = this.attackers(p, crusade);
    const need = this.targetValue(t) - base - (this.P[p].flags.attackBonus || 0);
    const group = atk.filter(c => !this.abil(c, 'solo')).reduce((s, c) => s + this.attackVolume(c), 0);
    const groupOk = atk.some(c => !this.abil(c, 'solo')) && group >= need;
    const soloOk = base === 0 && atk.some(c => this.abil(c, 'solo') && this.attackVolume(c) >= need);
    return groupOk || soloOk || (base > 0 && need <= 0);
  }
  maxAttack(p, noSolo = false) { return this.attackers(p).filter(c => !(noSolo && this.abil(c, 'solo'))).reduce((s, c) => s + this.attackVolume(c), 0); }

  *doAction(p, key) {
    const pl = this.P[p];
    const c = this.findAny(key.uid);
    if (key.kind === 'play') {
      if (this.def(c).type === '魔法' && this.freeMagic(p)) this.log('《增幅管道》：這張魔法不消耗回合行動。');
      else if (!this.def(c).freeAction || !this.def(c).freeAction(this, p, c)) this.actionsLeft--;
      yield* this.playCard(p, c, true);
    }
    else if (key.kind === 'attack' || key.kind === 'crusade') {
      if (this.freeAttack(p)) this.log('《漆黑樹洞》：這次襲擊不花費回合行動。'); else this.actionsLeft--;
      yield* this.attack(p, c, 0, true, key.kind === 'crusade');
    }
    else if (key.kind === 'loc') { this.actionsLeft--; yield* this.locationAction(p, c); }
    else if (key.kind === 'ritualback') {
      this.actionsLeft -= 2; this.move(c, 'field');
      this.log(`${pl.name} 以特殊行動將 ${this.cname(c)} 從棄牌區放到場上。`);
    } else if (key.kind === 'quick') {
      pl.flags.leaderUsed = true;
      this.log(`${pl.name} 發動 ${this.cname(c)} 的快速行動。`);
      yield* this.def(c).quick(this, p, c);
    }
  }

  *playCard(p, c, byAction = false) {
    const d = this.def(c), pl = this.P[p];
    const from = c.zone;
    if (d.type === '教主' || d.type === '地點' || d.type === '儀式') {
      this.move(c, 'field');
      this.log(`${pl.name} 打出${d.type} ${this.cname(c)}${from === 'conspiracy' ? '（陰謀區）' : ''}。`);
      return;
    }
    if (d.type === '信徒') return yield* this.playFollower(p, c, byAction);
    if (d.type === '魔法') return yield* this.playMagic(p, c);
  }

  *playFollower(p, c, byAction = true) {
    const d = this.def(c);
    if (d.ascend) {
      const req = d.ascend;
      if (!byAction) { this.log(`${this.cname(c)} 是飛升信徒，只能以飛升方式打出。`); return; }
      if (!this.canAscend(p, c)) { this.log(`${this.cname(c)}：無法滿足飛升需求，不能打出。`); return; }
      const reqTxt = Object.entries(req).map(([s, n]) => `${n}*${s}`).join('、');
      const red = this.ascendReduce(p), need = this.ascendNeed(p, req);
      const payers = this.ascendPayers(p, c);
      let best = null;
      const rec = (start, cur) => { if (best) return; if (cur.length === need) { if (this.ascendCovers(p, req, cur)) best = cur.slice(); return; } for (let i = start; i < payers.length; i++) { cur.push(payers[i]); rec(i + 1, cur); cur.pop(); if (best) return; } };
      rec(0, []);
      let sel = [];
      if (need > 0) sel = yield* this.pick(p, { suggest: best, errMsg: `需剛好除外 ${need} 張，每張提供 1 個不同的需求符號（可按「自動選擇」）`,
        prompt: `飛升 ${d.name}（需求 ${reqTxt}${red ? `，減少 ${red}` : ''}）：除外你場上 ${need} 張非教主牌，每張提供 1 個符號`, cards: payers, min: need, max: need, harm: false, info: 'ascend',
        validate: cs => this.ascendCovers(p, req, cs) });
      if (sel.length) this.log(`${this.pname(p)} 飛升 ${this.cname(c)}：除外 ${sel.map(x => this.cname(x)).join('、')}。`);
      else this.log(`${this.pname(p)} 飛升 ${this.cname(c)}（需求全數減免）。`);
      for (const f of sel) this.exile(f);
      yield* this.flushTriggers();
      c.ascending = true;
    }
    this.move(c, 'field');
    this.log(`${this.pname(p)} 打出信徒 ${this.cname(c)}。`);
    if (d.chant) {
      const countered = yield* this.calamityCheck(p, c, d.calamity, 'chant');
      if (countered) { this.log(`${this.cname(c)} 被控訴：詠頌不結算，信徒留在場上（不能啟動駐守／解構）。`); return; }
      yield* this.doChant(p, c);
    }
    yield* this.flushTriggers();
    // 駐守／解構只在「用回合行動打出」時可啟動
    if (byAction && c.zone === 'field' && !c.guilty) {
      if (d.guardX) yield* this.offerGuard(p, c);
      if (this.deconXOf(c)) yield* this.offerDecon(p, c);
    }
  }

  *offerGuard(p, c) {
    const locs = this.locations(p).filter(l => !(this.def(c).cantGuardType && this.locType(l) === this.def(c).cantGuardType));
    if (!locs.length) return;
    const opts = locs.map(l => ({ key: l.uid, uid: l.uid, cardId: l.id, label: `駐守 ${this.def(l).name}（守護 ${this.locGuard(l)} → ${this.locGuard(l) + this.guardX(c)}）` }));
    opts.push({ key: 0, label: '不駐守' });
    const k = yield* this.ask(p, `${this.def(c).name}：駐守${this.guardX(c)}，選擇要駐守的地點`, opts, 'guard');
    if (!k || c.zone !== 'field' || c.guilty) return;
    c.guardAt = k;
    const l = this.findAny(k);
    this.log(`${this.cname(c)} 駐守 ${this.cname(l)}（守護變為 ${this.locGuard(l)}）。`);
    if (this.def(c).guardSetType) this.log(`${this.cname(l)} 的類型改為「${this.def(c).guardSetType}」。`);
    this.fixGuards();
  }
  *offerDecon(p, c) {
    const rs = this.rituals(p);
    if (!rs.length) return;
    const x = this.deconXOf(c);
    const opts = rs.map(r => ({ key: r.uid, uid: r.uid, cardId: r.id, label: `解構 ${this.def(r).name}（符號需求 -${x}）` }));
    opts.push({ key: 0, label: '不解構' });
    const k = yield* this.ask(p, `${this.def(c).name}：解構${x}，選擇要解構的儀式`, opts, 'decon');
    if (!k || c.zone !== 'field' || c.guilty) return;
    c.deconAt = k;
    this.log(`${this.cname(c)} 解構 ${this.cname(this.findAny(k))}。`);
  }

  *doChant(p, c) {
    const pl = this.P[p];
    const nest = this.activeCards(p).find(x => this.def(x).nest);
    const chantSeq = ++this.eventSeq;
    const first = !!nest && !pl.flags.chantSeqs.some(s => s > nest.enteredSeq);
    pl.flags.chantSeqs.push(chantSeq);
    pl.flags.chantTriggered = true;
    this.log(`${this.cname(c)} 觸發詠頌。`);
    for (const h of this.activeCards(p)) if (this.def(h).onChant) this.def(h).onChant(this, h, c);
    yield* this.def(c).chant(this, p, c);
    yield* this.flushTriggers();
    if (first && !pl.flags.nestUsed && nest.zone === 'field' && this.def(nest).nest(this, nest)) {
      pl.flags.nestUsed = true;
      this.log(`${this.cname(nest)}：${this.cname(c)} 的詠頌額外再觸發 1 次。`);
      for (const h of this.activeCards(p)) if (this.def(h).onChant) this.def(h).onChant(this, h, c);
      yield* this.def(c).chant(this, p, c);
      yield* this.flushTriggers();
    }
  }

  // 災厄 → 敵方可控訴。回傳是否被控訴。
  *calamityCheck(p, src, cal, kind) {
    const o = this.opp(p), op = this.P[o];
    if (op.noCounterTurn === this.turnNo) { this.log(`（${op.name} 本回合無法控訴）`); return false; }
    if (kind === 'chant' && op.noCounterChantTurn === this.turnNo) { this.log(`（${op.name} 本回合無法控訴詠頌）`); return false; }
    const elig = op.hand.filter(c => this.canCounterWith(c) && this.counterVolume(c) >= cal);
    if (!elig.length && op.autoSkipCounter) return false;
    const kindName = { chant: '詠頌', magic: '魔法', loc: '地點行動', ritual: '執行儀式' }[kind];
    const opts = [{ key: 0, label: '不控訴' }].concat(elig.map(c => ({ key: c.uid, uid: c.uid, cardId: c.id, label: `以 ${this.def(c).name}（控訴聲量 ${this.counterVolume(c)}）控訴` })));
    const k = yield* this.ask(o, `${this.pname(p)} 的 ${this.def(src).name}（${kindName}，災厄 ${cal}）——要控訴嗎？${elig.length ? '' : '（你沒有可控訴的卡）'}`, opts, 'counter');
    if (!k) { this.log(`${op.name} 沒有控訴。`); return false; }
    const c = elig.find(x => x.uid === k);
    this.log(`⚖ ${op.name} 展示 ${this.cname(c)}（控訴聲量 ${this.counterVolume(c)}）控訴 ${this.cname(src)}！`);
    // 控訴「時」效果（可能被《惱人廣播器》無效）
    if (this.def(c).onCounter) {
      const blocker = [this.active, this.opp(this.active)].map(q => this.activeCards(q).find(x => this.def(x).nullifyCounterEffect)).find(Boolean);
      if (blocker) {
        this.log(`${this.cname(blocker)}：${this.cname(c)} 的控訴時效果被無效，${this.cname(blocker)} 置入陰謀區。`);
        this.move(blocker, 'conspiracy');
      } else yield* this.def(c).onCounter(this, o, c, src);
    }
    if (c.zone === 'hand') {
      this.move(c, 'field');
      if (this.neverGuilty(c)) this.log(`${this.cname(c)} 放到場上（不會變為罪惡）。`);
      else if (this.hookAny('noGuiltyOnCounter', o)) this.log(`${this.cname(c)} 放到場上（《手術室》：控訴後不會變為罪惡）。`);
      else {
        c.guilty = true; this.log(`${this.cname(c)} 以罪惡狀態放到場上。`);
        if (this.def(c).onGuilty) this.def(c).onGuilty(this, c);
      }
      // 控訴「後」效果（如《鐘塔》）
      if (c.zone === 'field' && this.hookAny('destroyAfterCounter', c)) { this.log('控訴後的信徒被破壞（《鐘塔》）。'); this.destroy(c); }
    }
    yield* this.flushTriggers();
    return true;
  }

  *playMagic(p, c) {
    const d = this.def(c);
    this.move(c, 'stack');
    this.P[p].flags.magics = (this.P[p].flags.magics || 0) + 1;
    const sdNeed = this.stardustNeed(p, c);
    const sd = this.stardust(p) >= sdNeed && !this.hookAny('blockStardust', p, c);
    const cal = this.magicCalamity(p, c, sd);
    this.log(`${this.pname(p)} 打出魔法 ${this.cname(c)}（星塵 ${this.stardust(p)}/${sdNeed}${sd ? '，星塵效果啟動' : ''}，災厄 ${cal}）。`);
    // 「當你打出魔法時」的效果（如《空白》），在控訴前結算
    for (const h of this.activeCards(p)) if (this.def(h).onMagicPlayed) yield* this.def(h).onMagicPlayed(this, h, c, cal);
    // 手牌中的「當你打出魔法時」（《黃石》）
    for (const h of this.P[p].hand.slice()) if (this.def(h).onMagicPlayedHand) yield* this.def(h).onMagicPlayedHand(this, h, c);
    const countered = yield* this.calamityCheck(p, c, cal, 'magic');
    if (!countered) { yield* d.magic(this, p, c, sd); yield* this.flushTriggers(); }
    else this.log(`${this.cname(c)} 被控訴，無效，置入棄牌區。`);
    if (c.zone === 'stack') this.move(c, 'discard');
  }

  *locationAction(p, l) {
    const d = this.def(l);
    this.log(`${this.pname(p)} 執行地點行動 ${this.cname(l)}（災厄 ${d.calamity}）。`);
    const countered = yield* this.calamityCheck(p, l, d.calamity, 'loc');
    if (countered) { this.log(`${this.cname(l)} 的地點行動被控訴，不結算（地點留在場上）。`); return; }
    // 「當你觸發地點行動時」（《夢遊人》）
    for (const h of this.activeCards(p)) if (this.def(h).onLocTriggered) this.def(h).onLocTriggered(this, h, l);
    yield* d.locAction(this, p, l);
  }

  *executeRitual(p, r) {
    const cal = this.ritualCalamity(p, r);
    this.log(`${this.pname(p)} 執行儀式 ${this.cname(r)}（災厄 ${cal}）。`);
    // 「當你執行儀式時」（《冷藏櫃》），不受控訴影響
    for (const h of this.activeCards(p)) if (this.def(h).onExecuteRitual) yield* this.def(h).onExecuteRitual(this, h, r);
    const countered = yield* this.calamityCheck(p, r, cal, 'ritual');
    if (countered) { this.log(`${this.cname(r)} 被控訴：儀式未完成，留在場上。`); return; }
    if (r.zone === 'field') this.complete(r);
  }

  // 襲擊（含聖戰）。base：額外基礎聲量（結靈星塵）；needAttacker：至少需要 1 個信徒
  *attack(p, target, base, needAttacker, crusade = false) {
    const pl = this.P[p];
    const bonus = pl.flags.attackBonus || 0;
    const tv = this.targetValue(target);
    const atk = this.attackers(p, crusade).filter(c => !(base > 0 && this.abil(c, 'solo')));
    const need = tv - base - bonus;
    const sum = cs => cs.reduce((s, c) => s + this.attackVolume(c), 0);
    const label = this.def(target).type === '地點' ? `守護 ${tv}` : `聲量 ${tv}`;
    let sug = [];
    { let sum0 = 0; for (const c of atk.filter(c => !this.abil(c, 'solo')).sort((x, y) => this.attackVolume(y) - this.attackVolume(x))) { if (sum0 >= need && (!needAttacker || sug.length)) break; sug.push(c); sum0 += this.attackVolume(c); }
      if (sum0 < need || (needAttacker && !sug.length)) { const so = atk.filter(c => this.abil(c, 'solo') && this.attackVolume(c) >= need).sort((x, y) => this.attackVolume(x) - this.attackVolume(y))[0]; sug = so ? [so] : null; } }
    const sel = yield* this.pick(p, { suggest: sug, errMsg: '襲擊聲量不足，或「只能單獨襲擊」的信徒和其他信徒一起選了',
      prompt: `${crusade ? '聖戰' : '襲擊'} ${this.def(target).name}（${label}）：選擇${crusade ? '聖戰' : ''}信徒，聲量合計需 ≥ ${Math.max(need, 0)}${base || bonus ? `（已有加成 ${base + bonus}）` : ''}`,
      cards: atk, min: needAttacker ? 1 : 0, max: atk.length, harm: false, info: 'attackers',
      validate: cs => sum(cs) >= need && (!needAttacker || cs.length >= 1) && !(cs.length > 1 && cs.some(c => this.abil(c, 'solo'))),
      vals: c => this.attackVolume(c), sumMin: need,
    });
    const total = sum(sel) + base + bonus;
    pl.flags.attackBonus = 0;
    pl.flags.attacks = (pl.flags.attacks || 0) + 1;
    this.log(`⚔ ${pl.name} 以 ${sel.map(c => this.cname(c)).join('、') || '（無信徒）'} ${crusade ? '聖戰' : '襲擊'} ${this.cname(target)}（襲擊聲量 ${total} ≥ ${tv}）。`);
    const exiler = sel.find(c => this.def(c).attackExile);
    for (const c of sel) this.makeGuilty(c);
    // 「當你襲擊時」（《誘蛾林道》）
    for (const h of this.activeCards(p)) if (this.def(h).onAttack) yield* this.def(h).onAttack(this, h, target);
    let snake = !exiler && sel.find(c => c.zone === 'field' && this.abil(c, 'snakeExile'));
    if (snake && this.P[p].under.length >= 2) {
      const us = yield* this.pick(p, { prompt: `${this.cname(snake)}：可棄置你 2 張被獻祭的牌，讓被襲擊的牌改為除外`, cards: this.P[p].under.slice(), min: 0, max: 2, harm: false, validate: cs => cs.length === 0 || cs.length === 2 });
      if (us.length === 2) { for (const u of us) this.move(u, 'discard'); this.log(`${this.cname(snake)}：棄置 2 張被獻祭的牌，${this.cname(target)} 改為除外。`); this.exile(target); }
      else snake = null;
    } else snake = null;
    if (snake) { /* 已除外 */ }
    else if (exiler) {
      this.log(`${this.cname(exiler)}：被襲擊的牌改為除外，然後除外這個信徒。`);
      this.exile(target);
      if (exiler.zone === 'field') this.exile(exiler);
    } else this.destroy(target);
    // 「襲擊後」（《鶚面祭司》）
    for (const c of sel) if (this.def(c).afterAttack) yield* this.def(c).afterAttack(this, c, target);
    yield* this.flushTriggers();
  }

  // ---------- 測試用：直接載入局面 ----------
  // spec: { active, players:[{hand:[], field:[], deck:[], discard:[], conspiracy:[], exile:[], score:[]}, ...] }
  // 卡片可寫 'cro05' 或 { id, guilty, guard:'locId', decon:'ritualId', under:'ritualId', attach:'targetId' }
  loadScenario(spec) {
    this.active = spec.active || 0;
    this.firstPlayer = 1 - this.active;
    this.turnNo = spec.turnNo || 4;
    this.phase = 'play';
    const later = [];
    for (const p of [0, 1]) {
      const pl = this.P[p], ps = spec.players[p] || {};
      pl.all = []; pl.turnsTaken = 3;
      if (ps.autoSkipCounter === false) pl.autoSkipCounter = false;
      for (const z of ZONES) {
        pl[z] = [];
        for (const it of ps[z] || []) {
          const o = typeof it === 'string' ? { id: it } : it;
          if (!DEFS[o.id]) throw new Error('unknown card ' + o.id);
          const c = this.newCard(o.id, p, z);
          c.guilty = !!o.guilty;
          if (o.entered) c.enteredSeq = o.entered;
          pl.all.push(c); pl[z].push(c);
          later.push([p, c, o]);
        }
      }
    }
    for (const [p, c, o] of later) {
      const f = (q, id) => this.P[q].field.find(x => x.id === id).uid;
      const fAny = (q, id) => (this.P[q].field.find(x => x.id === id) || this.P[1 - q].field.find(x => x.id === id)).uid;
      if (o.guard) c.guardAt = f(p, o.guard);
      if (o.decon) c.deconAt = f(p, o.decon);
      if (o.under) c.underOf = f(p, o.under);
      if (o.attach) c.attachTo = fAny(1 - p, o.attach);
    }
    this.flow = (function* (self) { try { yield* self.loop(); } catch (e) { if (!(e instanceof GameOver)) throw e; } })(this);
    this.advance(undefined);
    return this;
  }

  // ---------- 視角 ----------
  cardView(c, me) {
    const v = { uid: c.uid, id: c.id, guilty: c.guilty, guardAt: c.guardAt, deconAt: c.deconAt, attachTo: c.attachTo, owner: c.owner };
    const d = this.def(c);
    if (c.zone === 'field') {
      if (d.type === '地點') { v.curGuard = this.locGuard(c); if (this.locType(c) !== d.locationType) v.locType = this.locType(c); }
      if (d.type === '儀式') {
        v.ready = this.ritualReady(c); v.curCal = this.ritualCalamity(c.owner, c);
        v.reduction = this.ritualReduction(c);
        v.sacrificed = this.P[c.owner].under.filter(u => u.underOf === c.uid).length;
      }
      if (this.suppressed(c)) v.suppressed = true;
      if (c.morph) v.asType = '地點';
      if (d.type === '信徒' && this.vol(c) !== (DEFS[c.id].volume || 0)) v.vol = this.vol(c);
      if (c.ctrlFrom != null) v.ctrlFrom = c.ctrlFrom;
      if (this.attachedWith(c, 'restrain')) v.restrained = true;
      if (this.isOffering(c)) v.offering = true;
    }
    return v;
  }
  view(me) {
    const pv = (p) => {
      const pl = this.P[p];
      const cv = c => this.cardView(c, me);
      const o = {
        idx: p, name: pl.name, faction: pl.faction, handCount: pl.hand.length, deckCount: pl.deck.length,
        field: pl.field.map(cv), conspiracy: pl.conspiracy.map(cv), discard: pl.discard.map(cv), exile: pl.exile.map(cv),
        score: pl.score.map(cv), stack: pl.stack.map(cv), underCount: pl.under.length,
        symbols: this.symbolsAll(p), stardust: this.stardust(p),
        cannotAttack: pl.cannotAttackTurn >= this.turnNo, autoSkipCounter: pl.autoSkipCounter,
      };
      if (p === me) { o.hand = pl.hand.map(cv); o.under = pl.under.map(c => Object.assign(cv(c), { underOf: c.underOf })); }
      // 介面提示用：目前可參與襲擊／聖戰的信徒（唯讀，不影響規則）
      if (p === me && this.active === me) { try { o.attackers = [...new Set([...this.attackers(p), ...this.attackers(p, true)].map(c => c.uid))]; } catch { o.attackers = []; } }
      return o;
    };
    const v = {
      me, turnNo: this.turnNo, active: this.active, actionsLeft: this.actionsLeft, phase: this.phase,
      firstPlayer: this.firstPlayer, winner: this.winner, winReason: this.winReason,
      players: [pv(0), pv(1)],
      log: this.logs.filter(l => l.to == null || l.to === me).slice(-100).map(l => ({ n: l.n, text: l.text, turn: l.turn })),
    };
    if (this.pending) {
      if (this.pending.player === me) {
        const { player, type, prompt, options, min, max, info, seq, sumMin, sumMax } = this.pending;
        v.choice = { player, type, prompt, options, min, max, info, seq, sumMin, sumMax, suggest: this.pending.suggest || null };
      } else v.waiting = { player: this.pending.player, info: this.pending.info };
    }
    return v;
  }
}

// ---------- 組牌 ----------
// 規則：教主 + 固定 3 張儀式，再加 20 張：至少 12 張與教主同教團；其餘（至多 8 張）來自「另一個」教團與任意數量的放逐者。每張限 1 張。
const DISABLED_CARDS = new Set();
function isAutomated(id) { const d = DEFS[id]; return !!d && AUTOMATED.has(d.faction) && !DISABLED_CARDS.has(id); }
// 預設牌組：預設為整個教團；疫病中心的《疫苗研製》需 6 種符號，改搭白狐神社＋放逐者（14 主教團＋6 副）
const PRESET_DECKS = {
  疫病中心: ['vir01', 'vir02', 'vir03', 'vir04', 'vir07', 'vir08', 'vir09', 'vir10', 'vir12', 'vir14', 'vir16', 'vir17', 'vir19', 'vir20', 'vir21', 'vir22', 'vir23', 'vir24',
    'fox17', 'fox18', 'fox12', 'exi01', 'exi03', 'exi02'],
};
function presetDeck(faction) { return PRESET_DECKS[faction] ? PRESET_DECKS[faction].slice() : DATA.filter(c => c.faction === faction).map(c => c.id); }
const MIN_PRIMARY = 12;
function validateDeck(ids) {
  const errors = [];
  if (!Array.isArray(ids)) return { ok: false, errors: ['牌組格式錯誤'] };
  if (ids.length !== 24) errors.push(`牌組需為 24 張（目前 ${ids.length} 張）`);
  const seen = new Set();
  for (const id of ids) { if (seen.has(id)) errors.push(`重複卡牌：${DEFS[id] ? DEFS[id].name : id}`); seen.add(id); }
  const unknown = ids.filter(id => !DEFS[id]);
  if (unknown.length) return { ok: false, errors: errors.concat(['未知卡牌：' + unknown.join(',')]) };
  const notAuto = ids.filter(id => !isAutomated(id));
  if (notAuto.length) errors.push('尚未支援自動化的卡：' + notAuto.map(id => DEFS[id].name).join('、'));
  const leaders = ids.filter(id => DEFS[id].type === '教主');
  if (leaders.length !== 1) { errors.push(`需要剛好 1 張教主（目前 ${leaders.length} 張）`); return { ok: false, errors }; }
  const faction = DEFS[leaders[0]].faction;
  const fixedRituals = DATA.filter(c => c.faction === faction && c.type === '儀式').map(c => c.id);
  const rituals = ids.filter(id => DEFS[id].type === '儀式');
  if (rituals.length !== fixedRituals.length || !fixedRituals.every(r => rituals.includes(r))) errors.push(`儀式必須是教主固定的 ${fixedRituals.length} 張：${fixedRituals.map(r => DEFS[r].name).join('、')}`);
  const main = ids.filter(id => !['教主', '儀式'].includes(DEFS[id].type));
  const prim = main.filter(id => DEFS[id].faction === faction).length;
  if (prim < MIN_PRIMARY) errors.push(`與教主同教團的卡至少 ${MIN_PRIMARY} 張（目前 ${prim} 張）`);
  const others = [...new Set(main.map(id => DEFS[id].faction).filter(f => f !== faction && f !== '放逐者'))];
  if (others.length > 1) errors.push(`另一個教團只能選 1 個（目前：${others.join('、')}）`);
  return { ok: errors.length === 0, errors, faction, secondary: others[0] || null, primaryCount: prim, mainCount: main.length };
}

module.exports = { PRESET_DECKS, Game, DEFS, DATA, GameOver, FACTIONS, AUTOMATED, LEADER_FACTIONS, validateDeck, presetDeck, isAutomated, DISABLED_CARDS, MIN_PRIMARY };
