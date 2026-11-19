'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, DATA, validateDeck, presetDeck, isAutomated } = require('./engine/engine');
const { aiAnswer } = require('./engine/bots');

const PORT = Number(process.env.PORT || 8787);
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.avif': 'image/avif', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const FACS = ['白狐神社', '鴉教團', '逐光者', '禁忌廚房', '門教團', '瘋人院', '疫病中心', '紫靈山'];

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  if (u === '/presets.json') { res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-cache' }); return res.end(JSON.stringify(require('./engine/engine').PRESET_DECKS)); }
  if (u === '/cards.json') { res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-cache' }); return res.end(JSON.stringify(DATA.map(c => Object.assign({ auto: isAutomated(c.id) }, c)))); }
  if (u === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (u === '/poll' || u === '/send') return httpTransport(req, res, u);
  const fp = path.normalize(path.join(PUB, u));
  if (!fp.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(fp);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.avif' ? 'public, max-age=604800' : 'no-cache' });
    res.end(buf);
  });
});

// ---- HTTP 長輪詢傳輸（WebSocket 不可用時的備援）----
const httpConns = new Map();
class HttpConn {
  constructor(cid) { this.cid = cid; this.queue = []; this.waiter = null; this.lastSeen = Date.now(); this.isHttp = true; }
  get readyState() { return (this.waiter || Date.now() - this.lastSeen < 35000) ? 1 : 3; }
  send(str) {
    const o = JSON.parse(str);
    if (o.t === 'state') this.queue = this.queue.filter(x => x.t !== 'state');
    this.queue.push(o); this.flush();
  }
  flush() { if (this.waiter && this.queue.length) { const w = this.waiter; this.waiter = null; clearTimeout(w.timer); w.res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' }); w.res.end(JSON.stringify(this.queue.splice(0))); } }
  close() {}
}
function httpTransport(req, res, u) {
  const q = new URL(req.url, 'http://x').searchParams;
  const cid = String(q.get('cid') || '').slice(0, 40);
  if (!/^[a-z0-9]{8,40}$/.test(cid)) { res.writeHead(400); return res.end(); }
  let c = httpConns.get(cid);
  if (!c) { c = new HttpConn(cid); httpConns.set(cid, c); }
  c.lastSeen = Date.now();
  if (u === '/poll') {
    if (c.waiter) { const w = c.waiter; c.waiter = null; clearTimeout(w.timer); w.res.writeHead(200, { 'content-type': MIME['.json'] }); w.res.end('[]'); }
    c.waiter = { res, timer: setTimeout(() => { if (c.waiter && c.waiter.res === res) { c.waiter = null; c.lastSeen = Date.now(); res.writeHead(200, { 'content-type': MIME['.json'] }); res.end('[]'); } }, 20000) };
    req.on('close', () => { if (c.waiter && c.waiter.res === res) { clearTimeout(c.waiter.timer); c.waiter = null; c.lastSeen = Date.now(); } });
    return c.flush();
  }
  let body = '';
  req.on('data', d => { body += d; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => {
    res.writeHead(204); res.end();
    let m; try { m = JSON.parse(body); } catch { return; }
    try { handle(c, m); } catch (e) { console.error(e); send(c, { t: 'error', msg: '伺服器錯誤：' + e.message }); }
  });
}

const rooms = new Map();
function code() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s; do { s = ''; for (let i = 0; i < 4; i++) s += A[crypto.randomInt(A.length)]; } while (rooms.has(s)); return s; }
function token() { return crypto.randomBytes(12).toString('hex'); }

function roomInfo(r) {
  return { code: r.code, mode: r.mode, status: r.game ? (r.game.phase === 'over' ? 'over' : 'playing') : 'waiting',
    seats: r.seats.map(s => s && { name: s.name, faction: s.faction, connected: s.ai || !!(s.ws && s.ws.readyState === 1), ai: !!s.ai }) };
}
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(r) {
  r.touched = Date.now();
  r.seats.forEach((s, i) => { if (s && s.ws) send(s.ws, { t: 'state', seat: i, room: roomInfo(r), view: r.game ? r.game.view(i) : null }); });
  scheduleAI(r);
}
function scheduleAI(r) {
  const g = r.game;
  if (!g || !g.pending || r.aiTimer) return;
  const s = r.seats[g.pending.player];
  if (!s || !s.ai) return;
  const seq = g.pending.seq;
  r.aiTimer = setTimeout(() => {
    r.aiTimer = null;
    if (!g.pending || g.pending.seq !== seq) return;
    try {
      const sel = aiAnswer(g, g.pending, g.pending.player);
      const res = g.answer(g.pending.player, sel);
      if (!res.ok) { const { randomAnswer } = require('./engine/bots'); g.answer(g.pending.player, randomAnswer(g, g.pending)); }
    } catch (e) { console.error('AI error', e); }
    broadcast(r);
  }, g.pending.info === 'action' ? 900 : 600);
}
function seatDeck(m, fallbackFaction) {
  if (Array.isArray(m.deck)) { const v = validateDeck(m.deck); if (v.ok) return { deck: m.deck.slice(), faction: v.faction }; return { error: v.errors.join('；') }; }
  const f = FACS.includes(m.faction) ? m.faction : fallbackFaction;
  return { deck: presetDeck(f), faction: f };
}
function startGame(r) {
  const s = r.seats;
  r.game = new Game({ decks: [s[0].deck, s[1].deck], names: [s[0].name, s[1].name] });
  r.game.P.forEach((pl, i) => { pl.autoSkipCounter = s[i].ai ? true : s[i].autoSkip !== false; });
  r.game.start();
  console.log(`[${r.code}] game start seed=${r.game.seed}`);
}

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try { handle(ws, m); } catch (e) { console.error(e); send(ws, { t: 'error', msg: '伺服器錯誤：' + e.message }); }
  });
  ws.on('close', () => { const r = rooms.get(ws.room); if (r) broadcast(r); });
});
function clean(name, def) { return String(name || def).replace(/[<>&]/g, '').trim().slice(0, 12) || def; }
function handle(ws, m) {
  if (m.t === 'create') {
    const sd = seatDeck(m, FACS[0]);
    if (sd.error) return send(ws, { t: 'error', msg: '牌組不合法：' + sd.error });
    const r = { code: code(), mode: m.mode === 'ai' ? 'ai' : 'pvp', seats: [null, null], game: null, touched: Date.now() };
    const tk = token();
    r.seats[0] = { token: tk, name: clean(m.name, '玩家一'), faction: sd.faction, deck: sd.deck, autoSkip: m.autoSkip !== false, ws };
    if (r.mode === 'ai') { const f = FACS[Math.floor(Math.random() * FACS.length)]; r.seats[1] = { ai: true, name: 'AI 對手', faction: f, deck: presetDeck(f) }; }
    rooms.set(r.code, r);
    ws.room = r.code; ws.seat = 0;
    send(ws, { t: 'joined', code: r.code, seat: 0, token: tk });
    if (r.mode === 'ai') startGame(r);
    return broadcast(r);
  }
  if (m.t === 'join') {
    const r = rooms.get(String(m.code || '').toUpperCase());
    if (!r) return send(ws, { t: 'error', msg: '找不到這個房間，請確認房號。', fatal: true });
    if (r.seats[1]) return send(ws, { t: 'error', msg: '房間已滿。', fatal: true });
    const sd = seatDeck(m, FACS[1]);
    if (sd.error) return send(ws, { t: 'error', msg: '牌組不合法：' + sd.error });
    const tk = token();
    r.seats[1] = { token: tk, name: clean(m.name, '玩家二'), faction: sd.faction, deck: sd.deck, autoSkip: m.autoSkip !== false, ws };
    ws.room = r.code; ws.seat = 1;
    send(ws, { t: 'joined', code: r.code, seat: 1, token: tk });
    startGame(r);
    return broadcast(r);
  }
  if (m.t === 'resume') {
    const r = rooms.get(String(m.code || '').toUpperCase());
    if (!r) return send(ws, { t: 'error', msg: '房間已不存在（伺服器可能重啟過）。', fatal: true, gone: true });
    const i = r.seats.findIndex(s => s && s.token === m.token);
    if (i < 0) return send(ws, { t: 'error', msg: '無法恢復連線：身分驗證失敗。', fatal: true, gone: true });
    const old = r.seats[i].ws;
    r.seats[i].ws = ws; ws.room = r.code; ws.seat = i;
    if (old && old !== ws) { try { old.close(); } catch {} }
    send(ws, { t: 'joined', code: r.code, seat: i, token: m.token });
    return broadcast(r);
  }
  const r = rooms.get(ws.room);
  if (!r) return;
  if (m.t === 'answer') {
    const g = r.game;
    if (!g || !g.pending) return;
    if (m.seq !== g.pending.seq) return send(ws, { t: 'error', msg: '畫面已過期，已重新同步。' }), broadcast(r);
    const res = g.answer(ws.seat, m.sel);
    if (!res.ok) send(ws, { t: 'error', msg: res.err });
    return broadcast(r);
  }
  if (m.t === 'rematch') {
    if (!r.game || r.game.phase !== 'over') return;
    if (m.deck || m.faction) { const sd = seatDeck(m, r.seats[ws.seat].faction); if (sd.error) return send(ws, { t: 'error', msg: '牌組不合法：' + sd.error }); r.seats[ws.seat].deck = sd.deck; r.seats[ws.seat].faction = sd.faction; }
    r.rematch = r.rematch || new Set();
    r.rematch.add(ws.seat);
    const need = r.seats.filter(s => s && !s.ai).length;
    if (r.rematch.size >= need) { r.rematch = null; if (r.mode === 'ai') { const f = FACS[Math.floor(Math.random() * FACS.length)]; r.seats[1].faction = f; r.seats[1].deck = presetDeck(f); } startGame(r); }
    return broadcast(r);
  }
  if (m.t === 'option') {
    const s = r.seats[ws.seat];
    if (typeof m.autoSkip === 'boolean') { s.autoSkip = m.autoSkip; if (r.game) r.game.P[ws.seat].autoSkipCounter = m.autoSkip; }
    return broadcast(r);
  }
  if (m.t === 'concede') {
    const g = r.game;
    if (!g || g.phase === 'over') return;
    g.winner = 1 - ws.seat; g.winReason = `${g.P[ws.seat].name} 投降`; g.log(`🏳 ${g.winReason}。`); g.pending = null; g.phase = 'over';
    return broadcast(r);
  }
}
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  const now = Date.now();
  for (const [k, c] of httpConns) if (!c.waiter && now - c.lastSeen > 10 * 60e3) httpConns.delete(k);
  for (const [k, r] of rooms) if (now - r.touched > 12 * 3600e3) rooms.delete(k);
}, 25000);
server.listen(PORT, '0.0.0.0', () => console.log('控訴 server on :' + PORT));
