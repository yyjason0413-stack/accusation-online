// 《控訴》Online — Cloudflare Workers + Durable Objects（每個房間一個 DO）
// 規則引擎沿用 ../../engine（CommonJS，由 wrangler/esbuild 打包）。
import { DurableObject } from 'cloudflare:workers';
import engine from '../../engine/engine.js';
import bots from '../../engine/bots.js';
import INDEX_HTML from '../../public/index.html';
import APP_JS from '../../public/app.js';
import STYLE_CSS from '../../public/style.css';

const { Game, DATA, validateDeck, presetDeck, isAutomated, PRESET_DECKS } = engine;
const { aiAnswer, randomAnswer } = bots;
const FACS = ['白狐神社', '鴉教團', '逐光者', '禁忌廚房', '門教團', '瘋人院', '疫病中心', '紫靈山'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL = 12 * 3600e3;
const JSON_H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' };

let cardsJson = null, presetsJson = null;
const rnd = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[rnd(CODE_CHARS.length)]).join('');
const token = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/healthz') return new Response('ok');
    if (p === '/config.json') return new Response(JSON.stringify({ poll: false, host: 'cloudflare' }), { headers: JSON_H });
    if (p === '/cards.json') return new Response(cardsJson ||= JSON.stringify(DATA.map(c => Object.assign({ auto: isAutomated(c.id) }, c))), { headers: JSON_H });
    if (p === '/presets.json') return new Response(presetsJson ||= JSON.stringify(PRESET_DECKS), { headers: JSON_H });
    if (p === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const room = (url.searchParams.get('room') || '').toUpperCase();
      if (url.searchParams.get('new')) {
        for (let i = 0; i < 10; i++) {
          const code = newCode();
          const res = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req, { headers: withHeaders(req, { 'x-code': code, 'x-new': '1' }) });
          if (res.status !== 409) return res;
        }
        return new Response('no free room code', { status: 503 });
      }
      if (room && !/^[A-Z0-9]{4}$/.test(room)) return new Response('bad room', { status: 400 });
      const name = room || '_lobby';
      return env.ROOMS.get(env.ROOMS.idFromName(name)).fetch(req, { headers: withHeaders(req, { 'x-code': name }) });
    }
    if (p === '/poll' || p === '/send') return new Response('websocket only', { status: 404 });
    // 靜態檔：有 Workers Static Assets 時由平台直接供應（不會進到這裡）；
    // 以 API 直接上傳 Worker（無 assets）時改由內嵌檔案與卡圖代理供應。
    if (env.ASSETS) { const r = await env.ASSETS.fetch(req); if (r.status !== 404) return r; }
    const emb = EMBED[p === '/' ? '/index.html' : p];
    if (emb) return new Response(emb[1], { headers: { 'content-type': emb[0], 'cache-control': 'no-cache' } });
    const im = p.match(/^\/img\/([a-z]{3}\d{2}-w(?:320|640)\.avif)$/);
    if (im) return cardImage(im[1], req);
    return new Response('not found', { status: 404 });
  },
};
const EMBED = {
  '/index.html': ['text/html; charset=utf-8', INDEX_HTML],
  '/app.js': ['text/javascript; charset=utf-8', APP_JS],
  '/style.css': ['text/css; charset=utf-8', STYLE_CSS],
};
// 卡圖：來源為原作者的卡表站（與 public/img 相同檔案），快取在邊緣節點
const IMG_ORIGIN = 'https://accusation-card-tool.pages.dev/images/';
async function cardImage(name, req) {
  const cache = caches.default;
  const key = new Request(new URL('/img/' + name, req.url).toString());
  let res = await cache.match(key);
  if (res) return res;
  const up = await fetch(IMG_ORIGIN + name, { cf: { cacheEverything: true, cacheTtl: 604800 } });
  if (!up.ok) return new Response('not found', { status: 404 });
  res = new Response(up.body, { headers: { 'content-type': 'image/avif', 'cache-control': 'public, max-age=604800, immutable' } });
  await cache.put(key, res.clone());
  return res;
}
function withHeaders(req, extra) { const h = new Headers(req.headers); for (const k in extra) h.set(k, extra[k]); return h; }

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.r = undefined; // 房間（持久化）
    this.g = null;      // Game 物件（由事件重播重建）
    this.aiTimer = null;
    ctx.blockConcurrencyWhile(async () => { await this.load(); });
  }

  async load() {
    this.r = (await this.ctx.storage.get('room')) || null;
    this.g = null;
    if (this.r && this.r.game) this.g = this.rebuild(this.r.game);
  }
  rebuild(gs) {
    const g = new Game({ seed: gs.seed, decks: gs.decks, names: gs.names });
    g.P.forEach((pl, i) => { pl.autoSkipCounter = gs.auto[i]; });
    g.start();
    for (const ev of gs.ev) this.applyEvent(g, ev);
    return g;
  }
  applyEvent(g, ev) {
    if (ev[0] === 'a') return g.answer(ev[1], ev[2]);
    if (ev[0] === 'o') { g.P[ev[1]].autoSkipCounter = ev[2]; return { ok: true }; }
    if (ev[0] === 'c') { const s = ev[1]; g.winner = 1 - s; g.winReason = `${g.P[s].name} 投降`; g.log(`🏳 ${g.winReason}。`); g.pending = null; g.phase = 'over'; return { ok: true }; }
  }
  record(ev) { if (ev[0] === 'a') ev = ['a', ev[1], Array.isArray(ev[2]) ? ev[2].slice() : ev[2]]; const res = this.applyEvent(this.g, ev); if (res && res.ok) this.r.game.ev.push(ev); return res; }
  async save() {
    this.r.touched = Date.now();
    await this.ctx.storage.put('room', this.r);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL);
  }
  async alarm() {
    if (this.r && Date.now() - this.r.touched < ROOM_TTL - 60e3) return this.ctx.storage.setAlarm(this.r.touched + ROOM_TTL);
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(4001, 'room expired'); } catch {} }
    await this.ctx.storage.deleteAll();
    this.r = null; this.g = null;
  }

  async fetch(req) {
    const code = req.headers.get('x-code');
    if (req.headers.get('x-new') && this.r) return new Response('taken', { status: 409 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code, seat: null, isNew: !!req.headers.get('x-new') });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try { await this.handle(ws, m); }
    catch (e) { console.error(e && e.stack || e); this.send(ws, { t: 'error', msg: '伺服器錯誤：' + (e && e.message) }); }
  }
  async webSocketClose(ws) { try { ws.close(); } catch {} if (this.r) this.broadcast(ws); }
  async webSocketError(ws) { if (this.r) this.broadcast(ws); }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  sockets(exclude) { return this.ctx.getWebSockets().filter(w => w !== exclude && w.readyState === 1); }
  roomInfo(exclude) {
    const r = this.r, g = this.g;
    const live = new Set(this.sockets(exclude).map(w => (w.deserializeAttachment() || {}).seat));
    return { code: r.code, mode: r.mode, status: g ? (g.phase === 'over' ? 'over' : 'playing') : 'waiting',
      seats: r.seats.map((s, i) => s && { name: s.name, faction: s.faction, connected: !!s.ai || live.has(i), ai: !!s.ai }) };
  }
  broadcast(exclude) {
    const info = this.roomInfo(exclude);
    for (const w of this.sockets(exclude)) {
      const a = w.deserializeAttachment() || {};
      if (a.seat == null) continue;
      this.send(w, { t: 'state', seat: a.seat, room: info, view: this.g ? this.g.view(a.seat) : null });
    }
    this.scheduleAI();
  }
  scheduleAI() {
    const g = this.g;
    if (!g || !g.pending || this.aiTimer) return;
    const s = this.r.seats[g.pending.player];
    if (!s || !s.ai) return;
    const seq = g.pending.seq;
    this.aiTimer = setTimeout(async () => {
      this.aiTimer = null;
      if (!this.g || this.g !== g || !g.pending || g.pending.seq !== seq) return;
      try {
        const p = g.pending.player;
        let res = this.record(['a', p, aiAnswer(g, g.pending, p)]);
        if (!res.ok) res = this.record(['a', p, randomAnswer(g, g.pending)]);
        await this.save();
      } catch (e) { console.error('AI error', e && e.stack || e); }
      this.broadcast();
    }, g.pending.info === 'action' ? 900 : 600);
  }
  seatDeck(m, fallback) {
    if (Array.isArray(m.deck)) { const v = validateDeck(m.deck); if (v.ok) return { deck: m.deck.slice(), faction: v.faction }; return { error: v.errors.join('；') }; }
    const f = FACS.includes(m.faction) ? m.faction : fallback;
    return { deck: presetDeck(f), faction: f };
  }
  startGame() {
    const s = this.r.seats;
    const gs = { seed: Math.floor(Math.random() * 2 ** 31), decks: [s[0].deck, s[1].deck], names: [s[0].name, s[1].name],
      auto: s.map(x => x.ai ? true : x.autoSkip !== false), ev: [] };
    this.r.game = gs; this.r.rematch = null;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    this.g = this.rebuild(gs);
  }
  aiSeat() { const f = FACS[rnd(FACS.length)]; return { ai: true, name: 'AI 對手', faction: f, deck: presetDeck(f) }; }

  async handle(ws, m) {
    const att = ws.deserializeAttachment() || {};
    const setSeat = seat => ws.serializeAttachment(Object.assign({}, att, { seat }));
    if (att.code === '_lobby') return this.send(ws, { t: 'error', msg: '請重新整理頁面後再試一次。' });
    const clean = (n, d) => String(n || d).replace(/[<>&]/g, '').trim().slice(0, 12) || d;
    if (m.t === 'create') {
      if (!att.isNew || this.r) return this.send(ws, { t: 'error', msg: '建立房間失敗，請再試一次。', fatal: true });
      const sd = this.seatDeck(m, FACS[0]);
      if (sd.error) return this.send(ws, { t: 'error', msg: '牌組不合法：' + sd.error });
      const tk = token();
      this.r = { code: att.code, mode: m.mode === 'ai' ? 'ai' : 'pvp', seats: [null, null], game: null, rematch: null, touched: Date.now() };
      this.r.seats[0] = { token: tk, name: clean(m.name, '玩家一'), faction: sd.faction, deck: sd.deck, autoSkip: m.autoSkip !== false };
      if (this.r.mode === 'ai') { this.r.seats[1] = this.aiSeat(); this.startGame(); }
      await this.save();
      setSeat(0);
      this.send(ws, { t: 'joined', code: this.r.code, seat: 0, token: tk });
      return this.broadcast();
    }
    if (m.t === 'join') {
      if (!this.r || this.r.code !== String(m.code || '').toUpperCase()) return this.send(ws, { t: 'error', msg: '找不到這個房間，請確認房號。', fatal: true });
      if (this.r.seats[1]) return this.send(ws, { t: 'error', msg: '房間已滿。', fatal: true });
      const sd = this.seatDeck(m, FACS[1]);
      if (sd.error) return this.send(ws, { t: 'error', msg: '牌組不合法：' + sd.error });
      const tk = token();
      this.r.seats[1] = { token: tk, name: clean(m.name, '玩家二'), faction: sd.faction, deck: sd.deck, autoSkip: m.autoSkip !== false };
      this.startGame();
      await this.save();
      setSeat(1);
      this.send(ws, { t: 'joined', code: this.r.code, seat: 1, token: tk });
      return this.broadcast();
    }
    if (m.t === 'resume') {
      if (!this.r || this.r.code !== String(m.code || '').toUpperCase()) return this.send(ws, { t: 'error', msg: '房間已不存在（可能已過期）。', fatal: true, gone: true });
      const i = this.r.seats.findIndex(s => s && s.token === m.token);
      if (i < 0) return this.send(ws, { t: 'error', msg: '無法恢復連線：身分驗證失敗。', fatal: true, gone: true });
      for (const w of this.sockets(ws)) if ((w.deserializeAttachment() || {}).seat === i) { try { w.close(4000, 'replaced'); } catch {} }
      setSeat(i);
      this.send(ws, { t: 'joined', code: this.r.code, seat: i, token: m.token });
      return this.broadcast();
    }
    if (!this.r || att.seat == null) return;
    const seat = att.seat;
    const g = this.g;
    if (m.t === 'answer') {
      if (!g || !g.pending) return;
      if (m.seq !== g.pending.seq) { this.send(ws, { t: 'error', msg: '畫面已過期，已重新同步。' }); return this.broadcast(); }
      const res = this.record(['a', seat, m.sel]);
      if (!res.ok) this.send(ws, { t: 'error', msg: res.err }); else await this.save();
      return this.broadcast();
    }
    if (m.t === 'rematch') {
      if (!g || g.phase !== 'over') return;
      const me = this.r.seats[seat];
      if (m.deck || m.faction) { const sd = this.seatDeck(m, me.faction); if (sd.error) return this.send(ws, { t: 'error', msg: '牌組不合法：' + sd.error }); me.deck = sd.deck; me.faction = sd.faction; }
      const set = new Set(this.r.rematch || []); set.add(seat); this.r.rematch = [...set];
      const need = this.r.seats.filter(s => s && !s.ai).length;
      if (set.size >= need) { if (this.r.mode === 'ai') this.r.seats[1] = this.aiSeat(); this.startGame(); }
      await this.save();
      return this.broadcast();
    }
    if (m.t === 'option') {
      if (typeof m.autoSkip === 'boolean') { this.r.seats[seat].autoSkip = m.autoSkip; if (g) this.record(['o', seat, m.autoSkip]); await this.save(); }
      return this.broadcast();
    }
    if (m.t === 'concede') {
      if (!g || g.phase === 'over') return;
      this.record(['c', seat]); await this.save();
      return this.broadcast();
    }
  }
}
