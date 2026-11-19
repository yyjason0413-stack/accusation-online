'use strict';
// 公開牌組：共用邏輯（Node 伺服器與 Cloudflare Durable Object 共用）
// store 介面（可同步或非同步）：list({faction, sort, limit}) / get(id) / insert(rec) / remove(id) / countByAuthor(hash) / incUse(id) / count()
const { validateDeck, DATA } = require('../engine/engine');

const LIM = { name: 20, author: 12, desc: 200, perAuthor: 10, postsPerHour: 8, total: 3000, list: 100 };
const BY_ID = Object.fromEntries(DATA.map(c => [c.id, c]));
const FACTIONS = ['白狐神社', '鴉教團', '逐光者', '禁忌廚房', '門教團', '瘋人院', '疫病中心', '紫靈山'];
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>&"`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const cleanDesc = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f<>&"`]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
function hex(bytes) { return [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''); }
function rid(n) { const a = new Uint8Array(n); globalThis.crypto.getRandomValues(a); return hex(a); }
async function sha256(s) { const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))); return hex(new Uint8Array(d)); }
function pub(rec) {
  if (!rec) return null;
  const { authorHash, editHash, ...o } = rec;
  return o;
}

class DeckApi {
  constructor(store, opts = {}) { this.store = store; this.rate = new Map(); this.useSeen = new Map(); this.now = opts.now || (() => Date.now()); }
  hit(key, max, windowMs) {
    const now = this.now();
    const arr = (this.rate.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) { this.rate.set(key, arr); return false; }
    arr.push(now); this.rate.set(key, arr);
    if (this.rate.size > 5000) for (const [k, v] of this.rate) if (!v.length || now - v[v.length - 1] > windowMs) this.rate.delete(k);
    return true;
  }
  // req: { method, path, query: URLSearchParams|object, body: object|null, ip, editToken }
  async handle(req) {
    const m = req.path.match(/^\/api\/decks(?:\/([a-f0-9]{8,32}))?(\/use)?\/?$/);
    if (!m) return { status: 404, body: { error: '找不到' } };
    const id = m[1], isUse = !!m[2];
    const q = req.query instanceof URLSearchParams ? Object.fromEntries(req.query) : (req.query || {});
    try {
      if (req.method === 'GET' && !id) {
        const faction = FACTIONS.includes(q.faction) ? q.faction : null;
        const sort = q.sort === 'used' ? 'used' : 'new';
        const list = await this.store.list({ faction, sort, limit: LIM.list });
        return { status: 200, body: { decks: list.map(pub) } };
      }
      if (req.method === 'GET' && id && !isUse) {
        const d = await this.store.get(id);
        return d ? { status: 200, body: { deck: pub(d) } } : { status: 404, body: { error: '找不到這副公開牌組' } };
      }
      if (req.method === 'POST' && id && isUse) {
        const d = await this.store.get(id);
        if (!d) return { status: 404, body: { error: '找不到這副公開牌組' } };
        const key = req.ip + '|' + id, now = this.now();
        if (now - (this.useSeen.get(key) || 0) > 10 * 60e3) { this.useSeen.set(key, now); await this.store.incUse(id); d.uses = (d.uses || 0) + 1; }
        if (this.useSeen.size > 20000) this.useSeen.clear();
        return { status: 200, body: { uses: d.uses } };
      }
      if (req.method === 'POST' && !id) {
        const b = req.body || {};
        if (!this.hit('post|' + req.ip, LIM.postsPerHour, 3600e3)) return { status: 429, body: { error: '發布太頻繁，請稍後再試（每小時最多 ' + LIM.postsPerHour + ' 次）' } };
        const name = clean(b.name, LIM.name), author = clean(b.author, LIM.author), desc = cleanDesc(b.desc, LIM.desc);
        if (!name) return { status: 400, body: { error: '請輸入牌組名稱' } };
        if (!author) return { status: 400, body: { error: '請輸入作者暱稱' } };
        const tok = String(b.authorToken || '');
        if (!/^[a-f0-9]{16,64}$/.test(tok)) return { status: 400, body: { error: '缺少作者識別碼' } };
        const cards = Array.isArray(b.cards) ? b.cards.slice(0, 40).map(String) : [];
        if (!cards.every(x => BY_ID[x])) return { status: 400, body: { error: '牌組含有不存在的卡' } };
        const v = validateDeck(cards);
        if (!v.ok) return { status: 400, body: { error: '牌組不合法：' + v.errors.join('；') } };
        const authorHash = await sha256('author:' + tok);
        if ((await this.store.countByAuthor(authorHash)) >= LIM.perAuthor) return { status: 403, body: { error: `每位作者最多公開 ${LIM.perAuthor} 副牌組，請先刪除舊的` } };
        if ((await this.store.count()) >= LIM.total) return { status: 503, body: { error: '公開牌組已達上限' } };
        const leader = cards.find(x => BY_ID[x].type === '教主');
        const secondary = [...new Set(cards.map(x => BY_ID[x]).filter(c => c.type !== '教主' && c.type !== '儀式' && c.faction !== v.faction && c.faction !== '放逐者').map(c => c.faction))][0] || null;
        const editToken = rid(16);
        const rec = { id: rid(6), name, author, desc, cards, faction: v.faction, leader, secondary, uses: 0, created: this.now(), authorHash, editHash: await sha256('edit:' + editToken) };
        await this.store.insert(rec);
        return { status: 201, body: { deck: pub(rec), editToken } };
      }
      if (req.method === 'DELETE' && id && !isUse) {
        const d = await this.store.get(id);
        if (!d) return { status: 404, body: { error: '找不到這副公開牌組' } };
        if (!req.editToken || (await sha256('edit:' + req.editToken)) !== d.editHash) return { status: 403, body: { error: '只有作者可以刪除' } };
        await this.store.remove(id);
        return { status: 200, body: { ok: true } };
      }
      return { status: 405, body: { error: '不支援的操作' } };
    } catch (e) { return { status: 500, body: { error: '伺服器錯誤：' + e.message } }; }
  }
}

// 記憶體／檔案儲存（Node 伺服器用）
class MemoryStore {
  // io（可選）：{ read() => string|null, write(string) }，由 Node 伺服器注入檔案讀寫
  constructor(io) {
    this.io = io || null; this.map = new Map();
    if (this.io) { try { const t = this.io.read(); if (t) for (const r of JSON.parse(t)) this.map.set(r.id, r); } catch {} }
  }
  persist() { if (this.io) this.io.write(JSON.stringify([...this.map.values()])); }
  list({ faction, sort, limit }) {
    let a = [...this.map.values()];
    if (faction) a = a.filter(r => r.faction === faction);
    a.sort(sort === 'used' ? (x, y) => (y.uses - x.uses) || (y.created - x.created) : (x, y) => y.created - x.created);
    return a.slice(0, limit);
  }
  get(id) { const r = this.map.get(id); return r ? Object.assign({}, r) : null; }
  insert(r) { this.map.set(r.id, r); this.persist(); }
  remove(id) { this.map.delete(id); this.persist(); }
  countByAuthor(h) { let n = 0; for (const r of this.map.values()) if (r.authorHash === h) n++; return n; }
  incUse(id) { const r = this.map.get(id); if (r) { r.uses = (r.uses || 0) + 1; this.persist(); } }
  count() { return this.map.size; }
}

module.exports = { DeckApi, MemoryStore, LIM, clean };
