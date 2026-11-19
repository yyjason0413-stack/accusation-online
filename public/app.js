'use strict';
(() => {
const $app = document.getElementById('app'), $modal = document.getElementById('modal'), $toast = document.getElementById('toast');
const LS = 'accusation.session';
const FACS = [{ name: '白狐神社', leader: 'fox01' }, { name: '鴉教團', leader: 'cro01' }, { name: '逐光者', leader: 'mot01' }, { name: '禁忌廚房', leader: 'kit01' }, { name: '門教團', leader: 'dor01' }, { name: '瘋人院', leader: 'asy01' }, { name: '疫病中心', leader: 'vir01' }, { name: '紫靈山', leader: 'cen01' }];
let CARDS = {}, ws = null, connected = false, seat = null, room = null, view = null, joinedCode = null;
let ui = { name: localStorage.getItem('accusation.name') || '', faction: localStorage.getItem('accusation.faction') || '白狐神社', screen: 'lobby', sel: [], sheetMin: false, lastSeq: null, logOpen: false };
const params = new URLSearchParams(location.search);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (id, w = 320) => `/img/${id}-w${w}.avif`;
function toast(msg, ms = 2600) { $toast.textContent = msg; $toast.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => $toast.classList.add('hidden'), ms); }

let CARD_LIST = [];
let PRESET_OVR = {};
fetch('/presets.json').then(r => r.json()).then(o => { PRESET_OVR = o || {}; render(); }).catch(() => {});
fetch('/cards.json').then(r => r.json()).then(list => { CARD_LIST = list; for (const c of list) CARDS[c.id] = c; render(); });

// ---------- 牌組 ----------
const DK = 'accusation.decks', DKSEL = 'accusation.deckSel';
const isMain = c => c.type !== '教主' && c.type !== '儀式';
function presets() {
  return FACS.map(f => ({ id: 'preset-' + f.leader, name: `${f.name}（預設）`, preset: true, cards: PRESET_OVR[f.name] ? PRESET_OVR[f.name].slice() : CARD_LIST.filter(c => c.faction === f.name).map(c => c.id) }));
}
function userDecks() { try { return JSON.parse(localStorage.getItem(DK) || '[]'); } catch { return []; } }
function saveUserDecks(d) { localStorage.setItem(DK, JSON.stringify(d)); }
function allDecks() { return presets().concat(userDecks()); }
function selectedDeck() { const id = localStorage.getItem(DKSEL); const all = allDecks(); return all.find(d => d.id === id && validate(d.cards).ok) || all.find(d => d.preset && d.cards.includes((FACS.find(f => f.name === ui.faction) || FACS[0]).leader)) || all[0]; }
function validate(ids) {
  const errors = [];
  if (!CARD_LIST.length) return { ok: false, errors: ['載入中'] };
  if (ids.length !== 24) errors.push(`牌組需為 24 張（目前 ${ids.length} 張）`);
  if (new Set(ids).size !== ids.length) errors.push('有重複卡牌');
  const cs = ids.map(id => CARDS[id]).filter(Boolean);
  const na = cs.filter(c => !c.auto);
  if (na.length) errors.push('尚未支援的卡：' + na.map(c => c.name).join('、'));
  const leaders = cs.filter(c => c.type === '教主');
  if (leaders.length !== 1) { errors.push(`需要剛好 1 張教主（目前 ${leaders.length} 張）`); return { ok: false, errors, primaryCount: 0, mainCount: cs.filter(isMain).length }; }
  const faction = leaders[0].faction;
  const fixed = CARD_LIST.filter(c => c.faction === faction && c.type === '儀式').map(c => c.id);
  const rit = cs.filter(c => c.type === '儀式').map(c => c.id);
  if (rit.length !== fixed.length || !fixed.every(r => rit.includes(r))) errors.push('儀式必須是教主固定的 3 張');
  const main = cs.filter(isMain);
  const prim = main.filter(c => c.faction === faction).length;
  if (prim < 12) errors.push(`與教主同教團的卡至少 12 張（目前 ${prim} 張）`);
  const secN = main.filter(c => c.faction !== faction).length;
  if (secN > 8) errors.push(`其他來源（另一個教團＋放逐者）至多 8 張（目前 ${secN} 張）`);
  const others = [...new Set(main.map(c => c.faction).filter(f => f !== faction && f !== '放逐者'))];
  if (others.length > 1) errors.push(`另一個教團只能選 1 個（目前：${others.join('、')}）`);
  return { ok: !errors.length, errors, faction, secondary: others[0] || null, primaryCount: prim, mainCount: main.length };
}
const autoSkip = () => localStorage.getItem('accusation.autoSkip') !== '0';
function deckPayload() {
  const d = CARD_LIST.length ? selectedDeck() : null;
  if (!d || !validate(d.cards).ok) return { faction: ui.faction, autoSkip: autoSkip() };
  return { deck: d.cards, autoSkip: autoSkip() };
}

// ---------- 連線 ----------
let retry = 0, mode = params.get('transport') === 'poll' ? 'poll' : 'ws', wsEverOpened = false;
function onOpen() {
  connected = true; retry = 0;
  const s = JSON.parse(localStorage.getItem(LS) || 'null');
  if (s && s.code && s.token && !outbox.some(o => o.t === 'create' || o.t === 'join')) ws.send(JSON.stringify({ t: 'resume', code: s.code, token: s.token }));
  flushOutbox();
  render();
}
// 連線目標：'new'＝建立新房間、4 碼房號＝該房間、null＝大廳（Cloudflare 版每個房間是獨立的 Durable Object）
let wsTarget = (() => { try { const s = JSON.parse(localStorage.getItem(LS) || 'null'); return s && s.code || null; } catch { return null; } })();
let pollAllowed = true;
fetch('/config.json', { cache: 'no-store' }).then(r => r.json()).then(c => { pollAllowed = c.poll !== false; }).catch(() => {});
function retarget(t) {
  if (t === wsTarget || mode === 'poll') return;
  wsTarget = t;
  if (ws) { try { ws.onclose = null; ws.close(); } catch {} }
  connected = false; ws = null; connect();
}
function connect() {
  if (mode === 'poll') return startPoll();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let opened = false;
  const q = wsTarget === 'new' ? '?new=1' : wsTarget ? '?room=' + encodeURIComponent(wsTarget) : '';
  const sock = ws = new WebSocket(`${proto}://${location.host}/ws${q}`);
  const fallback = setTimeout(() => { if (!opened && !wsEverOpened && pollAllowed) { mode = 'poll'; try { sock.onclose = null; sock.close(); } catch {} startPoll(); } }, 5000);
  sock.onopen = () => { if (ws !== sock) return; opened = wsEverOpened = true; clearTimeout(fallback); onOpen(); };
  sock.onclose = () => {
    clearTimeout(fallback); if (ws !== sock) return;
    connected = false; render();
    if (!opened && !wsEverOpened && pollAllowed) { mode = 'poll'; return startPoll(); }
    setTimeout(() => { if (ws === sock) connect(); }, Math.min(1000 * 2 ** retry++, 8000));
  };
  sock.onmessage = ev => { if (ws === sock) onMsg(JSON.parse(ev.data)); };
}
// HTTP 長輪詢備援
const cid = sessionStorage.getItem('accusation.cid') || (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(0, 20).padEnd(10, 'x');
sessionStorage.setItem('accusation.cid', cid);
let polling = false;
async function startPoll() {
  if (polling) return; polling = true;
  ws = { readyState: 1, send: str => fetch('/send?cid=' + cid, { method: 'POST', body: str, headers: { 'content-type': 'application/json' } }).catch(() => toast('傳送失敗，請重試')), close() {} };
  let first = true;
  while (true) {
    try {
      const p = fetch('/poll?cid=' + cid, { cache: 'no-store' });
      if (first) { first = false; setTimeout(onOpen, 300); }
      const r = await p;
      if (!r.ok) throw new Error(r.status);
      const msgs = await r.json();
      if (!connected) { onOpen(); }
      for (const m of msgs) onMsg(m);
      retry = 0;
    } catch (e) {
      connected = false; render();
      await new Promise(res => setTimeout(res, Math.min(1000 * 2 ** retry++, 8000)));
      first = true;
    }
  }
}
function onMsg(m) {
  {
    if (m.t === 'joined') { wsTarget = m.code; seat = m.seat; joinedCode = m.code; localStorage.setItem(LS, JSON.stringify({ code: m.code, token: m.token })); history.replaceState(null, '', '/?room=' + m.code); }
    else if (m.t === 'state') {
      seat = m.seat; room = m.room;
      const prevSeq = view && view.choice && view.choice.seq;
      view = m.view;
      const seq = view && view.choice && view.choice.seq;
      if (seq !== prevSeq) { ui.sel = []; ui.sheetMin = false; }
      if (seq !== prevSeq) applyIntent();
      if (!view || !view.choice || view.choice.seq !== ui.busy) { ui.busy = null; document.body.classList.remove('busy'); }
      ui.screen = room.status === 'waiting' ? 'waiting' : 'game';
      render();
    } else if (m.t === 'error') {
      toast(m.msg); ui.busy = null; document.body.classList.remove('busy');
      if (m.gone) { localStorage.removeItem(LS); wsTarget = null; ui.screen = 'lobby'; room = null; view = null; render(); }
    }
  }
}
const outbox = [];
function send(o) {
  const want = o.t === 'create' ? 'new' : o.t === 'join' ? String(o.code || '').toUpperCase() : undefined;
  if (want !== undefined && mode === 'ws' && want !== wsTarget) { outbox.push(o); return retarget(want); }
  if (ws && ws.readyState === 1 && connected) ws.send(JSON.stringify(o)); else { outbox.push(o); toast('連線中，稍候會自動送出…', 1500); }
}
function flushOutbox() { while (outbox.length && ws && ws.readyState === 1) ws.send(JSON.stringify(outbox.shift())); }
connect();

// ---------- 大廳 ----------
function lobby() {
  const joinCode = (params.get('room') || '').toUpperCase();
  const sd = selectedDeck();
  const sdv = sd ? validate(sd.cards) : null;
  const leader = sd ? sd.cards.find(id => (CARDS[id] || {}).type === '教主') : null;
  const facHtml = sd ? `<div class="deckpick">${leader ? `<img src="${img(leader)}" alt="">` : ''}<div style="flex:1"><div class="ztitle" style="font-size:16px">${esc(sd.name)}</div><div class="sub" style="text-align:left">${esc(sdv && sdv.faction || '')}${sdv && sdv.secondary ? ' ＋ ' + esc(sdv.secondary) : ''} · 24 張</div></div><button id="decks">換牌組／組牌</button></div>
    <label class="row" style="gap:8px;font-size:13px"><input type="checkbox" id="autoSkip" style="width:auto" ${autoSkip() ? 'checked' : ''}>沒有可控訴的卡時自動跳過</label>
    <div class="sub" style="text-align:left">關閉時，即使沒有可控訴的卡也會詢問你（只能選不控訴），對手無法從等待時間推測你的手牌。</div>
    ${settingsHtml('1')}` : '';
  $app.innerHTML = `<div class="lobby">
    <h1>控訴</h1><div class="sub">線上對戰版 · 白狐神社 ／ 鴉教團 ／ 逐光者 ／ 禁忌廚房 ／ 門教團 ／ 瘋人院 ／ 疫病中心 ／ 紫靈山 ／ 放逐者（全自動規則）</div>
    <div class="card-box"><label>你的名字</label><input id="nm" maxlength="12" placeholder="玩家" value="${esc(ui.name)}">
      <label>牌組</label>${facHtml}</div>
    ${joinCode ? `<div class="card-box"><div>加入朋友的房間</div><div class="code">${esc(joinCode)}</div><button class="primary" id="join">加入對戰</button><button class="ghost" id="cancelJoin">改為建立自己的房間</button></div>` : `
    <button class="primary" id="create">建立房間，邀請朋友對戰</button>
    <button id="ai">單人練習（對戰 AI）</button>
    <div class="card-box"><div>輸入房號加入</div><div class="row"><input id="code" maxlength="4" placeholder="例如 AB3K" style="text-transform:uppercase"><button id="join2">加入</button></div></div>`}
    <div class="sub">卡牌資料與卡圖：愚人古堡工作室《控訴》</div>
  </div>`;
  const saveName = () => { ui.name = document.getElementById('nm').value.trim(); localStorage.setItem('accusation.name', ui.name); };
  const dk = document.getElementById('decks'); if (dk) dk.onclick = () => { saveName(); ui.screen = 'decks'; render(); };
  bindSettings('1');
  const as = document.getElementById('autoSkip'); if (as) as.onchange = () => localStorage.setItem('accusation.autoSkip', as.checked ? '1' : '0');
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = () => { saveName(); fn(); }; };
  on('create', () => { localStorage.removeItem(LS); send(Object.assign({ t: 'create', name: ui.name, mode: 'pvp' }, deckPayload())); });
  on('ai', () => { localStorage.removeItem(LS); send(Object.assign({ t: 'create', name: ui.name, mode: 'ai' }, deckPayload())); });
  on('join', () => { localStorage.removeItem(LS); send(Object.assign({ t: 'join', code: joinCode, name: ui.name }, deckPayload())); });
  on('join2', () => { const c = document.getElementById('code').value.trim().toUpperCase(); if (c.length === 4) { localStorage.removeItem(LS); send(Object.assign({ t: 'join', code: c, name: ui.name }, deckPayload())); } });
  on('cancelJoin', () => { history.replaceState(null, '', '/'); params.delete('room'); render(); });
}
function waiting() {
  const link = `${location.origin}/?room=${room.code}`;
  $app.innerHTML = `<div class="lobby"><h1>控訴</h1>
    <div class="card-box"><div>房號</div><div class="code">${room.code}</div>
    <div class="sub">把連結傳給朋友，對方打開後選擇教團即可開始。</div>
    <input readonly value="${link}" id="lnk"><button class="primary" id="share">分享邀請連結</button></div>
    <div class="sub">等待對手加入…（你的教團：${esc(room.seats[0] && room.seats[0].faction)}）</div>
    <button class="ghost" id="leave">離開房間</button></div>`;
  document.getElementById('share').onclick = async () => {
    try { if (navigator.share) await navigator.share({ title: '控訴 對戰邀請', text: `來跟我玩《控訴》！房號 ${room.code}`, url: link }); else { await navigator.clipboard.writeText(link); toast('已複製連結'); } }
    catch { document.getElementById('lnk').select(); }
  };
  document.getElementById('leave').onclick = leave;
}
// ---------- 公開牌組 ----------
const PUBTOK = 'accusation.pubTokens', AUTHTOK = 'accusation.authorToken';
function authorToken() {
  let t = localStorage.getItem(AUTHTOK);
  if (!/^[0-9a-f]{32}$/.test(t || '')) { const a = new Uint8Array(16); crypto.getRandomValues(a); t = [...a].map(x => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem(AUTHTOK, t); }
  return t;
}
function pubTokens() { try { return JSON.parse(localStorage.getItem(PUBTOK) || '{}'); } catch { return {}; } }
async function api(method, path, body, headers = {}) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
function publishForm(cards, name) {
  const v = validate(cards); if (!v.ok) return toast('牌組不合法，無法公開');
  showModal(`<div class="ztitle">儲存為公開牌組</div><div class="sub" style="text-align:left">公開後所有玩家都能檢視與使用這副牌組。只有這台裝置可以刪除它。</div>
    <label>牌組名稱（最多 20 字）</label><input id="pbName" maxlength="20" value="${esc(name || '')}">
    <label>作者暱稱（最多 12 字）</label><input id="pbAuthor" maxlength="12" value="${esc(localStorage.getItem('accusation.pubAuthor') || ui.name || '')}">
    <label>說明（選填，最多 200 字）</label><textarea id="pbDesc" maxlength="200" rows="3" placeholder="打法、核心組合…"></textarea>
    <div class="acts"><button class="primary" id="pbGo">公開</button><button class="ghost" data-close>取消</button></div>`);
  document.getElementById('pbGo').onclick = async ev => {
    const b = ev.target; const n = document.getElementById('pbName').value.trim(), a = document.getElementById('pbAuthor').value.trim(), ds = document.getElementById('pbDesc').value.trim();
    if (!n || !a) return toast('請填寫名稱與作者暱稱');
    b.disabled = true;
    try {
      const r = await api('POST', '/api/decks', { name: n, author: a, desc: ds, cards, authorToken: authorToken() });
      const t = pubTokens(); t[r.deck.id] = r.editToken; localStorage.setItem(PUBTOK, JSON.stringify(t));
      localStorage.setItem('accusation.pubAuthor', a);
      hideModal(); toast('已公開！'); ui.pub = { ...(ui.pub || {}), sort: 'new' }; ui.screen = 'pub'; render();
    } catch (e) { b.disabled = false; toast('公開失敗：' + e.message, 3600); }
  };
}
function pubScreen() {
  const P = ui.pub = ui.pub || { faction: '', sort: 'new' };
  const facs = [...new Set(CARD_LIST.filter(c => c.type === '教主' && c.auto).map(c => c.faction))];
  $app.innerHTML = `<div class="lobby"><div class="row"><button id="back">‹ 返回</button><h1 style="flex:1;font-size:22px;letter-spacing:3px">公開牌組</h1></div>
    <div class="row" style="gap:8px"><select id="pfFac" class="sel"><option value="">全部教團</option>${facs.map(f => `<option ${P.faction === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
      <select id="pfSort" class="sel"><option value="new" ${P.sort === 'new' ? 'selected' : ''}>最新</option><option value="used" ${P.sort === 'used' ? 'selected' : ''}>最多人使用</option></select></div>
    <div id="pubList"><div class="sub">載入中…</div></div></div>`;
  document.getElementById('back').onclick = () => { ui.screen = 'decks'; render(); };
  document.getElementById('pfFac').onchange = e => { P.faction = e.target.value; render(); };
  document.getElementById('pfSort').onchange = e => { P.sort = e.target.value; render(); };
  const q = new URLSearchParams({ sort: P.sort }); if (P.faction) q.set('faction', P.faction);
  const my = pubTokens();
  api('GET', '/api/decks?' + q).then(r => {
    const box = document.getElementById('pubList'); if (!box || ui.screen !== 'pub') return;
    P.cache = Object.fromEntries(r.decks.map(d => [d.id, d]));
    box.innerHTML = r.decks.length ? r.decks.map(d => `<div class="deckpick pubdeck" data-pid="${esc(d.id)}"><img src="${img(d.leader)}"><div style="flex:1;min-width:0"><div style="font-weight:700">${esc(d.name)}${my[d.id] ? ' <span class="pill ok">我的</span>' : ''}</div>
      <div class="sub" style="text-align:left">${esc(d.faction)}${d.secondary ? ' ＋ ' + esc(d.secondary) : ''} · ${esc(d.author)} · 使用 ${d.uses} 次 · ${new Date(d.created).toLocaleDateString('zh-TW')}</div>
      ${d.desc ? `<div class="pdesc">${esc(d.desc)}</div>` : ''}</div></div>`).join('') : '<div class="sub">還沒有公開牌組。到「牌組」裡把你組好的牌組公開吧！</div>';
    box.querySelectorAll('[data-pid]').forEach(el => el.onclick = () => pubDetail(P.cache[el.dataset.pid]));
  }).catch(e => { const box = document.getElementById('pubList'); if (box) box.innerHTML = `<div class="errline">無法載入：${esc(e.message)}</div>`; });
}
function sortCards(ids) { const ord = { 教主: 0, 儀式: 1 }; return ids.slice().sort((a, b) => (ord[(CARDS[a] || {}).type] ?? 2) - (ord[(CARDS[b] || {}).type] ?? 2) || ((CARDS[a] || {}).faction || '').localeCompare((CARDS[b] || {}).faction || '') || a.localeCompare(b)); }
function pubDetail(d) {
  if (!d) return;
  const tok = pubTokens()[d.id];
  showModal(`<div class="ztitle">${esc(d.name)}</div><div class="sub" style="text-align:left">${esc(d.faction)}${d.secondary ? ' ＋ ' + esc(d.secondary) : ''} · 作者 ${esc(d.author)} · 使用 ${d.uses} 次</div>
    ${d.desc ? `<div class="pdesc full">${esc(d.desc)}</div>` : ''}
    <div class="grid pubgrid">${sortCards(d.cards).map(id => `<div class="c bc" data-zoomid="${id}"><img src="${img(id)}" loading="lazy" alt="${esc((CARDS[id] || {}).name || id)}"></div>`).join('')}</div>
    <div class="acts"><button class="primary" id="pdUse">使用這副牌組</button><button id="pdCopy">複製到我的牌組編輯</button>${tok ? '<button class="danger" id="pdDel">刪除（我公開的）</button>' : ''}<button class="ghost" data-close>關閉</button></div>`);
  $modal.querySelectorAll('[data-zoomid]').forEach(el => el.onclick = () => { const id = el.dataset.zoomid; openCard(null, id); });
  document.getElementById('pdUse').onclick = () => {
    const ds = userDecks(); const id = 'pub-' + d.id; const deck = { id, name: d.name, cards: d.cards.slice(), pub: d.id };
    const i = ds.findIndex(x => x.id === id); if (i >= 0) ds[i] = deck; else ds.push(deck);
    saveUserDecks(ds); localStorage.setItem(DKSEL, id);
    api('POST', `/api/decks/${encodeURIComponent(d.id)}/use`).catch(() => {});
    hideModal(); toast(`已選用「${d.name}」`); ui.screen = room ? (room.status === 'waiting' ? 'waiting' : 'game') : 'lobby'; render();
  };
  document.getElementById('pdCopy').onclick = () => { hideModal(); ui.edit = { id: 'u' + Date.now(), name: d.name.slice(0, 14) + ' 改', cards: d.cards.slice(), tab: 'primary' }; ui.screen = 'edit'; render(); };
  const del = document.getElementById('pdDel');
  if (del) del.onclick = async () => {
    if (!confirm('確定要刪除這副公開牌組？')) return;
    try { await api('DELETE', `/api/decks/${encodeURIComponent(d.id)}`, null, { 'x-edit-token': tok }); const t = pubTokens(); delete t[d.id]; localStorage.setItem(PUBTOK, JSON.stringify(t)); hideModal(); toast('已刪除'); render(); }
    catch (e) { toast('刪除失敗：' + e.message); }
  };
}
function decksScreen() {
  const sel = selectedDeck();
  $app.innerHTML = `<div class="lobby"><div class="row"><button id="back">‹ 返回</button><h1 style="flex:1;font-size:22px;letter-spacing:3px">牌組</h1><button class="primary" id="newDeck">＋ 新牌組</button></div>
    <button id="pubBrowse">🌐 瀏覽公開牌組</button>
    ${allDecks().map(d => { const v = validate(d.cards); const L = d.cards.find(id => (CARDS[id] || {}).type === '教主');
      return `<div class="deckpick ${sel && sel.id === d.id ? 'on' : ''}">${L ? `<img src="${img(L)}">` : '<div class="back"></div>'}<div style="flex:1"><div style="font-weight:700">${esc(d.name)}</div>
      <div class="sub" style="text-align:left">${v.ok ? `${esc(v.faction)}${v.secondary ? ' ＋ ' + esc(v.secondary) : ''}` : `<span style="color:#e08a7a">不合法：${esc(v.errors[0] || '')}</span>`}</div>
      <div class="row" style="margin-top:6px;flex-wrap:wrap">${v.ok ? `<button class="primary" data-use="${esc(d.id)}">${sel && sel.id === d.id ? '使用中' : '使用'}</button>` : ''}
      ${v.ok && !d.preset && !d.pub ? `<button data-pub="${esc(d.id)}">公開</button>` : ''}${d.preset ? `<button data-copy="${esc(d.id)}">複製來編輯</button>` : `<button data-edit="${esc(d.id)}">編輯</button><button class="danger" data-del="${esc(d.id)}">刪除</button>`}</div></div></div>`; }).join('')}
    <div class="sub">組牌規則：教主＋固定 3 張儀式，再加 20 張：至少 12 張與教主同教團；其餘至多 8 張，可來自另一個教團（限 1 個）與任意張放逐者。也可以 20 張全用主教團。每張限 1 張。</div></div>`;
  document.getElementById('back').onclick = () => { ui.screen = room ? (room.status === 'waiting' ? 'waiting' : 'game') : 'lobby'; render(); };
  document.getElementById('newDeck').onclick = () => { ui.edit = { id: 'u' + Date.now(), name: '我的牌組', cards: [], tab: 'primary' }; ui.screen = 'edit'; render(); };
  $app.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { localStorage.setItem(DKSEL, b.dataset.use); ui.screen = 'lobby'; render(); });
  document.getElementById('pubBrowse').onclick = () => { ui.screen = 'pub'; render(); };
  $app.querySelectorAll('[data-pub]').forEach(b => b.onclick = () => { const d = userDecks().find(x => x.id === b.dataset.pub); if (d) publishForm(d.cards, d.name); });
  $app.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { const d = allDecks().find(x => x.id === b.dataset.copy); ui.edit = { id: 'u' + Date.now(), name: d.name.replace('（預設）', '') + ' 改', cards: d.cards.slice(), tab: 'primary' }; ui.screen = 'edit'; render(); });
  $app.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const d = userDecks().find(x => x.id === b.dataset.edit); ui.edit = { id: d.id, name: d.name, cards: d.cards.slice(), tab: 'primary' }; ui.screen = 'edit'; render(); });
  $app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (confirm('刪除這個牌組？')) { saveUserDecks(userDecks().filter(x => x.id !== b.dataset.del)); render(); } });
}
function editScreen() {
  const e = ui.edit;
  const v = validate(e.cards);
  const leaderId = e.cards.find(id => (CARDS[id] || {}).type === '教主');
  const fac = leaderId ? CARDS[leaderId].faction : null;
  const leaders = CARD_LIST.filter(c => c.type === '教主' && c.auto);
  const factions = [...new Set(CARD_LIST.filter(c => c.auto).map(c => c.faction))];
  const tabs = fac ? [['primary', fac + '（主）'], ...factions.filter(f => f !== fac).map(f => [f, f])] : [];
  const tab = e.tab === 'primary' || !factions.includes(e.tab) ? 'primary' : e.tab;
  const pool = fac ? CARD_LIST.filter(c => c.auto && isMain(c) && c.faction === (tab === 'primary' ? fac : tab)) : [];
  const ritu = fac ? CARD_LIST.filter(c => c.faction === fac && c.type === '儀式') : [];
  const mainN = v.mainCount || 0;
  $app.innerHTML = `<div class="builder">
    <div class="bhead"><div class="row"><button id="cancel">‹</button><input id="dname" value="${esc(e.name)}" maxlength="16"><button class="primary" id="save">儲存</button></div>
      <div class="row bstat"><span class="pill ${e.cards.length === 24 ? 'ok' : ''}">總數 ${e.cards.length}/24</span><span class="pill ${(v.primaryCount || 0) >= 12 ? 'ok' : ''}">主教團 ${v.primaryCount || 0}（≥12）</span><span class="pill ${mainN - (v.primaryCount || 0) <= 8 ? 'ok' : ''}">其他 ${Math.max(0, mainN - (v.primaryCount || 0))}（≤8）</span><span class="pill">另一教團：${esc(v.secondary || '—')}</span><span class="pill">牌庫主牌 ${mainN}/20</span></div>
      ${v.ok ? '<div class="okline">✓ 牌組合法，可以使用 <button id="publish" class="mini">儲存為公開牌組</button></div>' : `<div class="errline">${v.errors.map(esc).join('<br>')}</div>`}</div>
    <div class="bbody">
      <div class="zone-label">1. 選擇教主（自動帶入固定 3 張儀式）</div>
      <div class="grid">${leaders.map(c => `<div class="c bc ${leaderId === c.id ? 'chosen' : ''}" data-leader="${c.id}"><img src="${img(c.id)}"><span class="badge b-st">${esc(c.faction)}</span><span class="zi" data-zoomid="${c.id}">ⓘ</span></div>`).join('')}</div>
      ${fac ? `<div class="zone-label">固定儀式</div><div class="grid">${ritu.map(c => `<div class="c bc chosen"><img src="${img(c.id)}"><span class="zi" data-zoomid="${c.id}">ⓘ</span></div>`).join('')}</div>
      <div class="zone-label">2. 選擇其餘 20 張（點卡片加入／移除，ⓘ 看效果）</div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'primary' : ''}" data-tab="${esc(k)}">${esc(l)}</button>`).join('')}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap"><button data-all="1">全選此頁</button><button data-all="0">清除此頁</button></div>
      <div class="grid">${pool.map(c => `<div class="c bc ${e.cards.includes(c.id) ? 'chosen' : 'dim'}" data-card="${c.id}"><img src="${img(c.id)}"><span class="zi" data-zoomid="${c.id}">ⓘ</span></div>`).join('')}</div>` : '<div class="sub">先選擇教主。</div>'}
    </div></div>`;
  const q = s => document.getElementById(s);
  q('dname').oninput = ev => { e.name = ev.target.value; };
  q('cancel').onclick = () => { ui.screen = 'decks'; render(); };
  if (q('publish')) q('publish').onclick = () => { q('save').onclick(); publishForm(e.cards.slice(), e.name.trim()); };
  q('save').onclick = () => {
    const ds = userDecks(); const i = ds.findIndex(d => d.id === e.id);
    const d = { id: e.id, name: e.name.trim() || '我的牌組', cards: e.cards.slice() };
    if (i >= 0) ds[i] = d; else ds.push(d);
    saveUserDecks(ds);
    if (v.ok) localStorage.setItem(DKSEL, d.id);
    toast(v.ok ? '已儲存並設為使用中' : '已儲存（尚未合法，無法用於對戰）'); ui.screen = 'decks'; render();
  };
  $app.querySelectorAll('[data-zoomid]').forEach(el => el.onclick = ev => { ev.stopPropagation(); openCard(null, el.dataset.zoomid); });
  $app.querySelectorAll('[data-leader]').forEach(el => el.onclick = () => {
    const L = CARDS[el.dataset.leader];
    const keep = e.cards.filter(id => isMain(CARDS[id]));
    e.cards = [L.id, ...CARD_LIST.filter(c => c.faction === L.faction && c.type === '儀式').map(c => c.id), ...keep]; e.tab = 'primary'; render();
  });
  $app.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { e.tab = el.dataset.tab; render(); });
  $app.querySelectorAll('[data-card]').forEach(el => el.onclick = () => {
    const id = el.dataset.card, i = e.cards.indexOf(id);
    if (i >= 0) e.cards.splice(i, 1); else { if (e.cards.length >= 24) return toast('已滿 24 張'); e.cards.push(id); }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  });
  $app.querySelectorAll('[data-all]').forEach(el => el.onclick = () => {
    for (const c of pool) { const i = e.cards.indexOf(c.id); if (el.dataset.all === '1') { if (i < 0 && e.cards.length < 24) e.cards.push(c.id); } else if (i >= 0) e.cards.splice(i, 1); }
    render();
  });
}
function leave() { localStorage.removeItem(LS); wsTarget = null; room = null; view = null; ui.screen = 'lobby'; history.replaceState(null, '', '/'); params.delete('room'); if (ws && mode === 'ws') ws.close(); render(); }

// ---------- 遊戲畫面 ----------
function cardEl(c, opts = {}) {
  const d = CARDS[c.id] || {};
  let cls = 'c';
  if (c.guilty) cls += ' guilty';
  if (opts.act) cls += ' act';
  if (opts.selable) cls += ' selable';
  if (opts.chosen) cls += ' chosen';
  if (opts.atk) cls += ' atk';
  if (opts.playable) cls += ' playable';
  if (opts.dim) cls += ' dim';
  let badges = '';
  if (c.curGuard != null) badges += `<span class="badge b-guard">守${c.curGuard}</span>`;
  if (c.guilty) badges += `<span class="badge b-guilty">罪惡</span>`;
  if (c.vol != null) badges += `<span class="badge b-st">聲量${c.vol}</span>`;
  if (c.asType) badges += `<span class="badge b-st">寄生→荒野</span>`;
  if (c.guardAt != null && opts.locName) badges += `<span class="badge b-st">駐→${esc(opts.locName)}</span>`;
  if (c.ready) badges += `<span class="badge b-ready">可執行</span>`;
  if (c.sacrificed) badges += `<span class="badge b-sac">獻祭${c.sacrificed}</span>`;
  if (c.deconAt != null) { const r = findCard(c.deconAt); badges += `<span class="badge b-st">解構→${esc(r ? (CARDS[r.c.id] || {}).name : '')}</span>`; }
  if (c.attachTo != null) { const r = findCard(c.attachTo); badges += `<span class="badge b-st">附著→${esc(r ? (CARDS[r.c.id] || {}).name : '')}</span>`; }
  if (c.locType) badges += `<span class="badge b-st">→${esc(c.locType)}</span>`;
  if (c.ctrlFrom != null) badges += `<span class="badge b-off">控制中</span>`;
  if (c.restrained) badges += `<span class="badge b-guilty">拘束</span>`;
  if (c.offering) badges += `<span class="badge b-off">供品</span>`;
  if (c.suppressed) badges += `<span class="badge b-guilty">失去能力</span>`;
  const ty = c.asType || d.type;
  if (opts.canatk && ty === '信徒' && (!opts.atkers || opts.atkers.includes(c.uid))) cls += ' canatk';
  return `<div class="${cls}" data-uid="${c.uid}" data-id="${c.id}" data-ty="${esc(ty)}"><img src="${img(c.id)}" alt="${esc(d.name)}" loading="lazy">${badges}</div>`;
}
const TYPES = id => (CARDS[id] || {}).type;
function symHtml(s) { return `<span class="syms">${Object.entries(s || {}).map(([k, v]) => `<span class="sym ${k}">${k}${v}</span>`).join('')}</span>`; }

function actionMap() {
  const m = {};
  if (view && view.choice && view.choice.info === 'action') view.choice.options.forEach((o, i) => { if (o.uid != null) (m[o.uid] = m[o.uid] || []).push(i); });
  return m;
}
function attackSet() {
  const s = new Set();
  if (view && view.choice && view.choice.info === 'action') view.choice.options.forEach(o => { if (o.kind === 'attack' || o.kind === 'crusade') s.add(o.uid); });
  return s;
}
function pickSet() {
  const s = {};
  if (view && view.choice && view.choice.type === 'pick') view.choice.options.forEach((o, i) => { s[o.uid] = i; });
  return s;
}
function sideHtml(p, mine) {
  const am = mine ? actionMap() : {}, ps = pickSet();
  const all = p.field;
  const locName = uid => { const l = all.find(x => x.uid === uid); return l ? (CARDS[l.id] || {}).name : ''; };
  const ce = c => cardEl(c, { canatk: mine && attackSet().size > 0, atkers: mine && p.attackers, act: !!am[c.uid] && !attackSet().has(c.uid), atk: attackSet().has(c.uid), selable: ps[c.uid] != null && !ui.sel.includes(ps[c.uid]), chosen: ps[c.uid] != null && ui.sel.includes(ps[c.uid]), locName: locName(c.guardAt) });
  // 敵方地點也可能是可選/可襲擊
  const amAll = actionMap();
  const atkSet = attackSet();
  const ceO = c => cardEl(c, { act: !!amAll[c.uid] && !atkSet.has(c.uid), atk: atkSet.has(c.uid), selable: ps[c.uid] != null && !ui.sel.includes(ps[c.uid]), chosen: ps[c.uid] != null && ui.sel.includes(ps[c.uid]), locName: locName(c.guardAt) });
  const f = mine ? ce : ceO;
  const TY = c => c.asType || TYPES(c.id);
  const top = all.filter(c => ['教主', '儀式', '魔法'].includes(TY(c)));
  const locs = all.filter(c => TY(c) === '地點');
  const fols = all.filter(c => TY(c) === '信徒');
  const row = (label, arr) => `<div class="zone-label">${label}</div><div class="zone-row">${arr.length ? arr.map(f).join('') : '<span class="empty">—</span>'}</div>`;
  const rows = [row('教主／儀式', top), row('地點', locs), row('信徒', fols)];
  return `<div class="side ${mine ? 'me' : 'opp'}">${(mine ? rows.reverse() : rows).join('')}</div>`;
}
function zoneBar(p, mine) {
  const sc = '★'.repeat(p.score.length) + '☆'.repeat(Math.max(0, 2 - p.score.length));
  return `<div class="bar"><span class="nm">${esc(p.name)}</span><span class="pill">${esc(p.faction)}</span>
    
    <span class="pill" data-pile="${p.idx}:deck">牌庫 ${p.deckCount}</span>
    <span class="pill btn" data-zone="${p.idx}:conspiracy" data-pile="${p.idx}:conspiracy">陰謀 ${p.conspiracy.length}</span>
    <span class="pill btn" data-zone="${p.idx}:discard" data-pile="${p.idx}:discard">棄牌 ${p.discard.length}</span>
    <span class="pill btn" data-zone="${p.idx}:exile" data-pile="${p.idx}:exile">除外 ${p.exile.length}</span>
    ${p.underCount ? (mine ? `<span class="pill btn" data-zone="${p.idx}:under">獻祭 ${p.underCount}</span>` : `<span class="pill">獻祭 ${p.underCount}</span>`) : ''}
    <span class="pill btn stars" data-zone="${p.idx}:score" data-pile="${p.idx}:score">${sc}</span>
    <span class="pill">星塵 ${p.stardust}</span>${p.cannotAttack ? '<span class="pill" style="background:#6b2620">本回合無法襲擊</span>' : ''}
    ${symHtml(p.symbols)}</div>`;
}
function statusText() {
  if (!view) return '';
  const me = view.players[seat], op = view.players[1 - seat];
  if (view.winner != null) return view.winner === seat ? '<b>你獲勝了！</b>' : '對手獲勝';
  if (view.choice) {
    if (view.choice.info === 'action') return `<b>你的回合</b> · 剩餘行動 <b>${view.actionsLeft}</b>`;
    if (view.choice.info === 'counter') return '<b>對手執行災厄效果，可以控訴！</b>';
    return '<b>請做出選擇</b>';
  }
  if (view.waiting) {
    const w = { counter: '對手正在考慮是否控訴…', mulligan: '對手正在調度起手…', action: `對手回合（剩餘行動 ${view.actionsLeft}）` }[view.waiting.info] || '等待對手選擇…';
    return `<span class="wait">${w}</span>`;
  }
  return '';
}
// ---------- 音效（WebAudio 即時合成，無外部音檔）----------
const SFX = (() => {
  let ctx = null, master = null;
  const muted = () => localStorage.getItem('accusation.mute') === '1';
  const vol = () => { const v = Number(localStorage.getItem('accusation.vol')); return Number.isFinite(v) && localStorage.getItem('accusation.vol') != null ? Math.min(1, Math.max(0, v)) : 0.6; };
  function unlock() {
    try {
      if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
    } catch {}
  }
  function env(g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function tone(f, t, dur, type = 'sine', peak = 0.3, f2 = null, a = 0.005) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    env(g, t, a, dur, peak); o.connect(g); g.connect(master); o.start(t); o.stop(t + a + dur + 0.05);
  }
  let nbuf = null;
  function noise(t, dur, peak = 0.3, freq = 1200, ftype = 'lowpass', f2 = null) {
    if (!nbuf) { nbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = nbuf; f.type = ftype; f.frequency.setValueAtTime(freq, t); if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    env(g, t, 0.004, dur, peak); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }
  const N = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, A4: 440, D5: 587.33, F4: 349.23, Ab4: 415.3, Eb4: 311.13, C4: 261.63, G4: 392 };
  const S = {
    tap: t => tone(1400, t, 0.03, 'triangle', 0.12),
    draw: t => { noise(t, 0.12, 0.18, 2500, 'highpass', 6000); tone(900, t + 0.02, 0.05, 'sine', 0.05, 1300); },
    play: t => { tone(170, t, 0.16, 'sine', 0.45, 60); noise(t, 0.08, 0.15, 900); },
    stamp: t => { tone(95, t, 0.35, 'sine', 0.6, 45); noise(t, 0.18, 0.35, 700); tone(220, t + 0.01, 0.12, 'square', 0.08, 110); },
    hit: t => { noise(t, 0.14, 0.4, 1800, 'lowpass', 300); tone(240, t, 0.15, 'square', 0.12, 70); },
    destroy: t => { noise(t, 0.45, 0.25, 3000, 'lowpass', 150); tone(300, t, 0.4, 'sawtooth', 0.05, 60); },
    ritual: t => [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => { tone(f, t + i * 0.09, 0.5, 'triangle', 0.16); tone(f * 2, t + i * 0.09, 0.25, 'sine', 0.04); }),
    turn: t => { tone(N.G4, t, 0.25, 'triangle', 0.15); tone(N.C5, t + 0.12, 0.4, 'triangle', 0.17); },
    win: t => [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6].forEach((f, i) => tone(f, t + i * 0.11, i > 3 ? 0.6 : 0.2, 'triangle', 0.18)),
    lose: t => [N.G4, N.Eb4, N.C4].forEach((f, i) => tone(f, t + i * 0.22, 0.45, 'sine', 0.2, f * 0.97)),
    counter: t => { tone(N.A4, t, 0.12, 'square', 0.06); tone(N.A4, t + 0.16, 0.12, 'square', 0.06); },
  };
  let lastAt = {};
  function play(name) {
    if (muted() || !ctx || ctx.state !== 'running' || !S[name]) return;
    const now = ctx.currentTime;
    if (lastAt[name] && now - lastAt[name] < 0.06) return; // 避免同時疊太多
    lastAt[name] = now;
    master.gain.setValueAtTime(vol(), now);
    try { S[name](now + 0.01); } catch {}
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));
  return { play, unlock, muted, vol };
})();
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button,.opt,select,[data-zone]'); if (b) SFX.play('tap'); }, true);
// ---------- 新手教學（只顯示一次，可從選單重看）----------
const TUT_KEY = 'accusation.tutorialDone';
const TUT_STEPS = [
  { sel: '.hand', title: '拖曳出牌', text: '發金光的手牌可以打出：按住往上拖到場上放開即可。拖到場上的某張卡上，會直接把它當作效果目標。點一下手牌開啟動作選單；長按約半秒可放大看完整效果。' },
  { sel: '.board', title: '高亮顏色', text: '金色＝可以執行行動的卡。紅色⚔＝可以襲擊的目標：把自己的信徒拖到紅框上就能襲擊，之後可再加入其他信徒一起襲擊。藍色＝目前可以選擇的目標。' },
  { sel: '.mid', title: '控訴時機', text: '對手執行災厄效果（詠頌、魔法、地點行動、儀式）時，畫面下方會出現紅色「⚖ 控訴時機」提示，你可以展示手牌控訴它。' },
  { sel: '#endBtn', alt: '.mid', title: '結束回合', text: '行動用完或不想再行動時，按「結束回合」。行動用完時這個按鈕會閃爍提醒。' },
  { sel: '#menuBtn', title: '⋯ 選單', text: '這裡可以調整動畫速度、音效（靜音／音量）、震動、自動跳過控訴，也可以重看這份教學或投降。' },
];
let tutStep = -1;
const tutReady = () => ui.screen === 'game' && view && view.winner == null && (!view.choice || view.choice.type === 'action') && !document.querySelector('.sheet [data-pick], .sheet [data-ask]') && !drag;
function maybeTutorial() { if (localStorage.getItem(TUT_KEY) !== '1' && tutStep < 0 && tutReady()) setTimeout(() => { if (tutStep < 0 && localStorage.getItem(TUT_KEY) !== '1' && tutReady()) startTutorial(); }, 500); }
function startTutorial() { hideModal(); tutStep = 0; drawTutorial(); }
function endTutorial() { tutStep = -1; localStorage.setItem(TUT_KEY, '1'); const t = document.getElementById('tut'); if (t) t.remove(); }
function drawTutorial() {
  let t = document.getElementById('tut'); if (!t) { t = document.createElement('div'); t.id = 'tut'; document.body.appendChild(t); }
  const st = TUT_STEPS[tutStep]; if (!st) return endTutorial();
  const el = document.querySelector(st.sel) || (st.alt && document.querySelector(st.alt));
  const r = el ? el.getBoundingClientRect() : { left: 20, top: 200, width: window.innerWidth - 40, height: 80 };
  const pad = 6, top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad), w = Math.min(window.innerWidth - left - 4, r.width + pad * 2), h = r.height + pad * 2;
  const below = top + h / 2 < window.innerHeight / 2;
  t.innerHTML = `<div class="tut-hole" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px"></div>
    <div class="tut-box" style="${below ? `top:${Math.min(window.innerHeight - 220, top + h + 12)}px` : `bottom:${Math.max(12, window.innerHeight - top + 12)}px`}">
      <div class="tut-step">${tutStep + 1} / ${TUT_STEPS.length}</div><div class="tut-title">${esc(st.title)}</div><div class="tut-text">${esc(st.text)}</div>
      <div class="row"><button class="ghost" id="tutSkip">略過教學</button><span style="flex:1"></span>${tutStep > 0 ? '<button id="tutPrev">上一步</button>' : ''}<button class="primary" id="tutNext">${tutStep === TUT_STEPS.length - 1 ? '開始遊戲' : '下一步'}</button></div></div>`;
  document.getElementById('tutSkip').onclick = endTutorial;
  document.getElementById('tutNext').onclick = () => { tutStep++; if (tutStep >= TUT_STEPS.length) endTutorial(); else drawTutorial(); };
  const pv = document.getElementById('tutPrev'); if (pv) pv.onclick = () => { tutStep--; drawTutorial(); };
}
window.addEventListener('resize', () => { if (tutStep >= 0) drawTutorial(); });
// ---------- 設定：動畫／震動 ----------
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const animMode = () => localStorage.getItem('accusation.anim') || (reduceMotion() ? 'off' : 'normal');
const animK = () => ({ normal: 1, fast: 0.55, off: 0 })[animMode()] ?? 1;
const hapticOn = () => localStorage.getItem('accusation.haptic') !== '0';
function buzz(p) { if (hapticOn() && navigator.vibrate) try { navigator.vibrate(p); } catch {} }
function settingsHtml(sfx) {
  const m = animMode();
  return `<label class="row setrow">動畫<select id="animSel${sfx}" class="sel mini">${[['normal', '正常'], ['fast', '快速'], ['off', '關閉']].map(([v, t]) => `<option value="${v}" ${m === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="row setrow"><input type="checkbox" id="haptic${sfx}" style="width:auto" ${hapticOn() ? 'checked' : ''}>震動回饋（支援的裝置）</label>
    <label class="row setrow"><input type="checkbox" id="mute${sfx}" style="width:auto" ${SFX.muted() ? 'checked' : ''}>靜音</label>
    <label class="row setrow">音量<input type="range" id="vol${sfx}" min="0" max="100" step="5" value="${Math.round(SFX.vol() * 100)}" class="vol"></label>`;
}
function bindSettings(sfx) {
  const a = document.getElementById('animSel' + sfx); if (a) a.onchange = () => { localStorage.setItem('accusation.anim', a.value); toast(a.value === 'off' ? '已關閉動畫' : '動畫：' + a.options[a.selectedIndex].text); };
  const mu = document.getElementById('mute' + sfx); if (mu) mu.onchange = () => { localStorage.setItem('accusation.mute', mu.checked ? '1' : '0'); if (!mu.checked) { SFX.unlock(); setTimeout(() => SFX.play('turn'), 50); } };
  const vo = document.getElementById('vol' + sfx); if (vo) vo.onchange = () => { localStorage.setItem('accusation.vol', String(Number(vo.value) / 100)); SFX.unlock(); setTimeout(() => SFX.play('play'), 50); };
  const h = document.getElementById('haptic' + sfx); if (h) h.onchange = () => { localStorage.setItem('accusation.haptic', h.checked ? '1' : '0'); if (h.checked) buzz(20); };
}

// ---------- 遊戲畫面 ----------
let prevView = null, prevSeat = null, drag = null, renderPending = false, overShownSeq = null;
function game() {
  if (!view) { $app.innerHTML = '<div class="lobby"><h1>控訴</h1><div class="sub">載入中…</div></div>'; return; }
  if (drag) { renderPending = true; return; }
  const me = view.players[seat], op = view.players[1 - seat];
  const am = actionMap(), ps = pickSet();
  const ch = view.choice;
  const actionPhase = ch && ch.info === 'action';
  const handCards = me.hand || [];
  const handHtml = handCards.map(c => cardEl(c, { act: !!am[c.uid], playable: playIdx(c.uid) >= 0, dim: actionPhase && !am[c.uid], selable: ps[c.uid] != null && !ui.sel.includes(ps[c.uid]), chosen: ps[c.uid] != null && ui.sel.includes(ps[c.uid]) })).join('');
  const leaderHtml = me.conspiracy.length ? `<div class="zone-label">陰謀區${view.players[0].score.length + view.players[1].score.length === 0 ? '（教主需任一方完成 1 個儀式後才能打出）' : ''}</div><div class="zone-row consp">${me.conspiracy.map(c => cardEl(c, { act: !!am[c.uid], playable: playIdx(c.uid) >= 0, selable: ps[c.uid] != null && !ui.sel.includes(ps[c.uid]), chosen: ps[c.uid] != null && ui.sel.includes(ps[c.uid]) })).join('')}</div>` : '';
  const stack = [...me.stack, ...op.stack];
  const last = view.log.slice(-1)[0];
  const endIdx = actionPhase ? ch.options.findIndex(o => o.kind === 'end') : -1;
  const hasActs = actionPhase && ch.options.length > 1;
  const nBacks = Math.min(op.handCount, 12);
  const backs = Array.from({ length: nBacks }, (_, i) => { const t = nBacks > 1 ? (i - (nBacks - 1) / 2) / ((nBacks - 1) / 2) : 0; return `<span class="cb" style="transform:translateY(${(t * t * 4).toFixed(1)}px) rotate(${(-t * 8).toFixed(1)}deg)"></span>`; }).join('');
  const myTurn = view.active === seat && view.winner == null;
  const boardEl = $app.querySelector('.board');
  const scrollTop = boardEl ? boardEl.scrollTop : null;
  const snapshot = snap();
  $app.innerHTML = `<div class="game ${myTurn ? 'myturn' : 'opturn'}">
    <div class="topwrap ${!myTurn && view.winner == null ? 'active' : ''}">${zoneBar(op, false)}
      <div class="opphand" id="oppHand" data-pile="${op.idx}:hand"><span class="backs">${backs}</span><span class="hc">手牌 ${op.handCount}</span></div></div>
    <div class="board">
      ${sideHtml(op, false)}
      ${stack.length ? `<div class="zone-label">結算中</div><div class="zone-row stackrow">${stack.map(c => cardEl(c)).join('')}</div>` : ''}
      ${sideHtml(me, true)}
      ${leaderHtml}
      <div class="dropzone">放開以打出</div>
    </div>
    <div class="lastlog" id="lastlog">${last ? esc(last.text) : ''}</div>
    <div class="mid ${ch && ch.info === 'counter' ? 'counter' : ''}"><div class="st">${statusText()}</div>
      <button id="logBtn">日誌</button>
      ${hasActs ? '<button id="actsBtn">行動</button>' : ''}
      ${endIdx >= 0 ? `<button class="primary ${view.actionsLeft === 0 ? 'glow' : ''}" id="endBtn">結束回合</button>` : ''}
      <button id="menuBtn" aria-label="選單">⋯</button></div>
    <div class="botwrap ${myTurn ? 'active' : ''}">${zoneBar(me, true)}</div>
    <div class="hand fan" data-pile="${me.idx}:hand">${handHtml || '<span class="empty">沒有手牌</span>'}</div>
  </div>
  ${sheetHtml()}
  ${overHtml()}
  ${connected ? '' : '<div class="conn">連線中斷，重新連線中…</div>'}`;
  document.documentElement.style.setProperty('--k', String(animK() || 0.001));
  document.body.classList.toggle('noanim', !animK());
  layoutHand();
  const nb = $app.querySelector('.board');
  if (nb && scrollTop != null) nb.scrollTop = scrollTop;
  bindGame();
  try { sfxFx(prevSeat === seat ? prevView : null, view); } catch (e) { console.warn('sfx', e); }
  try { runFx(prevSeat === seat ? prevView : null, view, snapshot); } catch (e) { console.warn('fx', e); }
  prevView = view; prevSeat = seat;
  maybeTutorial();
}
function playIdx(uid) {
  const ch = view && view.choice;
  if (!ch || ch.info !== 'action') return -1;
  return ch.options.findIndex(o => o.uid === uid && o.kind === 'play');
}
function layoutHand() {
  const h = $app.querySelector('.hand.fan'); if (!h) return;
  const cs = [...h.querySelectorAll('.c')]; const n = cs.length; if (!n) return;
  const W = h.clientWidth, cw = cs[0].offsetWidth || 78;
  const spacing = n > 1 ? Math.min(cw + 6, (W - 28 - cw) / (n - 1)) : 0;
  const total = spacing * (n - 1) + cw, left0 = (W - total) / 2;
  const maxRot = Math.min(12, n * 1.6);
  cs.forEach((el, i) => {
    const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
    el.style.left = (left0 + i * spacing).toFixed(1) + 'px';
    el.style.zIndex = 10 + i;
    el.style.transform = `translateY(${(t * t * 12).toFixed(1)}px) rotate(${(t * maxRot).toFixed(1)}deg)`;
  });
}
window.addEventListener('resize', () => { if (ui.screen === 'game') layoutHand(); });

// ---------- 動畫（依狀態差異與日誌事件驅動，不阻擋操作）----------
function snap() {
  const m = new Map();
  $app.querySelectorAll('.game [data-uid]').forEach(el => m.set(el.dataset.uid, { r: el.getBoundingClientRect(), html: el.outerHTML, id: el.dataset.id, base: el.style.transform || '', hand: !!el.closest('.hand') }));
  return m;
}
function zoneMap(v) {
  const m = new Map();
  if (!v) return m;
  for (const p of v.players) for (const z of ['field', 'hand', 'conspiracy', 'discard', 'exile', 'score', 'stack', 'under']) for (const c of (p[z] || [])) m.set(String(c.uid), { p: p.idx, z, c });
  return m;
}
function pileRect(p, z) {
  let el = $app.querySelector(`[data-pile="${p}:${z}"]`);
  if (!el && z === 'field') el = $app.querySelector(p === seat ? '.side.me' : '.side.opp');
  if (!el && (z === 'stack')) el = $app.querySelector('.stackrow');
  if (!el) el = $app.querySelector(`[data-pile="${p}:deck"]`);
  return el ? el.getBoundingClientRect() : null;
}
const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const nameOf = id => (CARDS[id] || {}).name;
function boardElByName(name, prefer) {
  const els = [...$app.querySelectorAll('.board .c[data-id]')].filter(e => nameOf(e.dataset.id) === name);
  return (prefer && els.find(e => e.closest(prefer))) || els[0] || null;
}
let fxQueue = [], fxBusy = false;
function queueOverlay(fn) { if (fxQueue.length > 3) fxQueue.shift(); fxQueue.push(fn); if (!fxBusy) nextOverlay(); }
function nextOverlay() {
  const fn = fxQueue.shift(); if (!fn) { fxBusy = false; return; }
  fxBusy = true; const ms = fn(); setTimeout(nextOverlay, Math.max(80, ms || 0));
}
function overlay(cls, html, ms) {
  const k = animK(); if (!k) return 0;
  const d = Math.round(ms * k);
  const el = document.createElement('div'); el.className = 'fxo ' + cls; el.innerHTML = html; el.style.setProperty('--d', d + 'ms');
  document.body.appendChild(el); setTimeout(() => el.remove(), d + 60);
  return d;
}
function ghostOf(s) {
  const g = document.createElement('div'); g.className = 'fxghost'; g.innerHTML = s.html;
  Object.assign(g.style, { left: s.r.left + 'px', top: s.r.top + 'px', width: s.r.width + 'px', height: s.r.height + 'px' });
  const inner = g.firstElementChild; if (inner) inner.removeAttribute('style');
  document.body.appendChild(g); return g;
}
function popNum(r, text, cls = '') {
  const k = animK(); if (!k || !r) return;
  const e = document.createElement('div'); e.className = 'pop ' + cls; e.textContent = text;
  const c = center(r); e.style.left = c.x + 'px'; e.style.top = c.y + 'px'; e.style.setProperty('--d', Math.round(600 * k) + 'ms');
  document.body.appendChild(e); setTimeout(() => e.remove(), 650 * k + 50);
}
function sfxFx(pv, v) {
  if (!pv || v.turnNo < pv.turnNo) return;
  const q = []; const at = (ms, n) => q.push([ms, n]);
  const pm = zoneMap(pv), nm = zoneMap(v);
  let draw = 0, play = 0, destroy = 0;
  for (const [uid, now] of nm) { const was = pm.get(uid);
    if (now.z === 'hand' && now.p === seat && !was) draw++;
    if (now.z === 'field' && (!was || was.z !== 'field')) play++; }
  for (const [uid, was] of pm) { const now = nm.get(uid); if (was.z === 'field' && (!now || now.z !== 'field')) destroy++; }
  const lastN = (pv.log.slice(-1)[0] || {}).n ?? -1;
  let t = 0;
  for (const l of v.log.filter(l => l.n > lastN)) {
    if (/^⚖/.test(l.text)) at(t, 'stamp'), t += 250;
    else if (/^⚔/.test(l.text)) at(t + 250, 'hit'), t += 300;
    else if (/^★/.test(l.text)) at(t, 'ritual'), t += 400;
    else if (/^——/.test(l.text) && v.active === seat) at(t + 150, 'turn');
  }
  if (play) at(0, 'play');
  if (draw) at(80, 'draw');
  if (destroy) at(t + 300, 'destroy');
  if (v.winner != null && pv.winner == null) at(t + 500, v.winner === seat ? 'win' : 'lose');
  for (const [ms, n] of q) setTimeout(() => SFX.play(n), ms);
}
function runFx(pv, v, snapshot) {
  const k = animK();
  const nm = zoneMap(v);
  // 勝負畫面
  if (v.winner != null && overShownSeq !== v.log.length + ':' + v.turnNo) {
    overShownSeq = v.log.length + ':' + v.turnNo;
    if (pv && pv.winner == null) { const o = $app.querySelector('.over'); if (o) o.classList.add(v.winner === seat ? 'win' : 'lose', 'fx-in'); buzz(v.winner === seat ? [30, 40, 60] : 80); }
  }
  if (!pv || !k || v.turnNo < pv.turnNo) return;
  const pm = zoneMap(pv);
  const D = ms => Math.round(ms * k);
  const ease = 'cubic-bezier(.2,.8,.2,1)';
  // 1) 進場／移動（FLIP）
  let drawN = 0;
  $app.querySelectorAll('.game [data-uid]').forEach(el => {
    const uid = el.dataset.uid, s = snapshot.get(uid), base = el.style.transform || '';
    const r = el.getBoundingClientRect();
    const was = pm.get(uid), now = nm.get(uid);
    if (s) {
      const dx = s.r.left - r.left, dy = s.r.top - r.top;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        const played = was && was.z !== 'field' && now && now.z === 'field';
        el.animate(played
          ? [{ transform: `translate(${dx}px,${dy}px) ${s.base}`, zIndex: 30 }, { transform: `translate(${dx * 0.3}px,${dy * 0.3}px) scale(1.25)`, offset: 0.55 }, { transform: base || 'none' }]
          : [{ transform: `translate(${dx}px,${dy}px) ${s.base}` }, { transform: base || 'none' }], { duration: D(played ? 480 : 320), easing: ease });
        if (played) setTimeout(() => el.classList.add('fx-land'), D(400));
      }
    } else if (now) {
      let src = was ? pileRect(was.p, was.z) : null;
      if (!src) src = now.z === 'hand' ? pileRect(now.p, 'deck') : (now.p === seat ? pileRect(now.p, 'deck') : pileRect(now.p, 'hand'));
      if (!src) return;
      const a = center(src), b = center(r);
      const isDraw = now.z === 'hand' && !was;
      const delay = isDraw ? D(70 * drawN++) : 0;
      const fromField = now.z === 'field';
      el.animate([{ transform: `translate(${a.x - b.x}px,${a.y - b.y}px) scale(.3) ${isDraw ? 'rotate(-20deg)' : ''}`, opacity: 0.2 },
        fromField ? { transform: 'scale(1.25)', opacity: 1, offset: 0.6 } : { opacity: 1, offset: 0.5 },
        { transform: base || 'none', opacity: 1 }], { duration: D(fromField ? 500 : 420), delay, easing: ease, fill: 'backwards' });
      if (fromField) setTimeout(() => el.classList.add('fx-land'), D(450));
    }
    // 罪惡、可執行、聲量變化
    if (was && now && was.z === 'field' && now.z === 'field') {
      if (!was.c.guilty && now.c.guilty) { el.classList.add('fx-guilty'); popNum(r, '罪惡', 'bad'); }
      else if (was.c.guilty && !now.c.guilty) el.classList.add('fx-clear');
      if (!was.c.ready && now.c.ready) el.classList.add('fx-pulse');
      if (was.c.vol != null && now.c.vol != null && was.c.vol !== now.c.vol) popNum(r, (now.c.vol > was.c.vol ? '+' : '') + (now.c.vol - was.c.vol), now.c.vol > was.c.vol ? 'good' : 'bad');
    }
  });
  // 2) 離場：殘影飛向目的區（棄牌／除外／計分…）
  const atk = v.log.filter(l => l.n > ((pv.log.slice(-1)[0] || {}).n ?? -1));
  const hadAttack = atk.some(l => /^⚔/.test(l.text));
  for (const [uid, s] of snapshot) {
    if ($app.querySelector(`.game [data-uid="${uid}"]`)) continue;
    const now = nm.get(uid), was = pm.get(uid);
    const z = now ? now.z : 'hand';
    const p = now ? now.p : (was ? was.p : 1 - seat);
    const dst = pileRect(p, z);
    const g = ghostOf(s);
    const wait = hadAttack && was && was.z === 'field' ? D(260) : 0;
    let frames;
    if (z === 'exile') frames = [{ transform: s.base || 'none', filter: 'none', opacity: 1 }, { transform: `translateY(-26px) scale(1.12)`, filter: 'blur(5px) brightness(1.8) saturate(0)', opacity: 0 }];
    else if (dst) {
      const a = center(s.r), b = center(dst);
      const burn = z === 'discard' && was && was.z === 'field';
      frames = [{ transform: s.base || 'none', filter: 'none', opacity: 1 },
        burn ? { transform: 'scale(1.05)', filter: 'sepia(1) brightness(1.6) saturate(3) hue-rotate(-20deg)', opacity: 1, offset: 0.35 } : { opacity: 1, offset: 0.2 },
        { transform: `translate(${b.x - a.x}px,${b.y - a.y}px) scale(.25) rotate(${z === 'score' ? 0 : 25}deg)`, filter: burn ? 'sepia(1) brightness(.4)' : 'none', opacity: z === 'score' ? 0.9 : 0 }];
    } else frames = [{ opacity: 1 }, { opacity: 0, transform: 'scale(.6)' }];
    const anim = g.animate(frames, { duration: D(z === 'exile' ? 520 : 460), delay: wait, easing: 'ease-in', fill: 'both' });
    anim.onfinish = () => g.remove(); setTimeout(() => g.remove(), D(1200) + 200);
  }
  // 3) 日誌事件
  let turnLine = null;
  for (const l of atk) {
    const t = l.text;
    if (/^⚖/.test(t)) {
      buzz([40, 30, 60]);
      const m = t.match(/控訴 《(.+?)》/);
      const tgt = m && boardElByName(m[1]); if (tgt) tgt.classList.add('fx-accused');
      queueOverlay(() => overlay('stamp', `<div class="stampbox"><div class="big">控訴！</div><div class="small">${esc(t.replace(/^⚖\s*/, ''))}</div></div>`, 600));
    } else if (/^⚔/.test(t)) {
      buzz(30);
      const m = t.match(/^⚔ .+? 以 (.*) (?:聖戰|襲擊) 《([^》]+)》（襲擊聲量 (\d+)/);
      if (m) {
        const attackers = [...m[1].matchAll(/《(.+?)》/g)].map(x => x[1]);
        const tName = m[2];
        let tEl = boardElByName(tName); let tRect = tEl ? tEl.getBoundingClientRect() : null;
        if (!tRect) for (const [, s] of snapshot) if (nameOf(s.id) === tName) { tRect = s.r; break; }
        const side = view.active === seat ? '.side.me' : '.side.opp';
        attackers.forEach((nmx, i) => {
          const a = boardElByName(nmx, side); if (!a || !tRect) return;
          const ar = a.getBoundingClientRect(), A = center(ar), B = center(tRect);
          const dx = (B.x - A.x) * 0.55, dy = (B.y - A.y) * 0.55;
          a.animate([{ transform: 'none' }, { transform: `translate(${-dx * 0.08}px,${-dy * 0.08}px) scale(1.08)`, offset: 0.25 }, { transform: `translate(${dx}px,${dy}px) scale(1.12)`, offset: 0.55 }, { transform: 'none' }], { duration: D(520), delay: D(i * 70), easing: 'ease-in-out' });
        });
        if (tEl) setTimeout(() => tEl.animate([{ transform: 'none' }, { transform: 'translateX(-6px) rotate(-3deg)' }, { transform: 'translateX(6px) rotate(3deg)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: D(300) }), D(280));
        setTimeout(() => popNum(tRect, '⚔ ' + m[3], 'atk'), D(280));
        if (tRect) setTimeout(() => overlay('flash', '', 220), D(270));
      }
    } else if (/^★/.test(t)) {
      buzz([20, 30, 20]);
      const m = t.match(/完成儀式 《(.+?)》/);
      queueOverlay(() => overlay('ritual', `<div class="ritbox">★ 完成儀式<div class="small">${esc(m ? m[1] : '')}</div></div>`, 600));
      const sc = $app.querySelectorAll('.stars'); sc.forEach(e => e.classList.add('fx-pulse'));
    } else if (/飛升 《/.test(t)) {
      const m = t.match(/飛升 《(.+?)》/); const e = m && boardElByName(m[1]); if (e) e.classList.add('fx-ascend');
    } else if (/^—— 第/.test(t)) turnLine = l;
  }
  if (turnLine) {
    const mine = v.active === seat;
    if (mine) buzz(25);
    queueOverlay(() => overlay('turn ' + (mine ? 'mine' : 'theirs'), `<div class="tb">${mine ? '你的回合' : '對手回合'}</div>`, 600));
  }
  if (v.choice && v.choice.info === 'counter' && !(pv.choice && pv.choice.info === 'counter')) buzz([15, 40, 15]);
}

// ---------- 手勢：點擊（預覽）、長按（放大檢視）、拖曳出牌 ----------
let peekEl = null, suppressClick = false;
function showPeek(id) {
  hidePeek();
  const d = CARDS[id] || {};
  peekEl = document.createElement('div'); peekEl.className = 'peek';
  peekEl.innerHTML = `<img src="${img(id, 640)}" alt=""><div class="pk"><b>${esc(d.name || '')}</b><span>${esc([d.type, d.faction, d.volume != null ? '聲量 ' + d.volume : '', d.calamity != null ? '災厄 ' + d.calamity : '', d.guard != null ? '守護 ' + d.guard : ''].filter(Boolean).join(' · '))}</span><div>${esc(d.effect || '')}</div></div>`;
  document.body.appendChild(peekEl); buzz(10);
}
function hidePeek() { if (peekEl) { peekEl.remove(); peekEl = null; } }
function bindCardGestures(el) {
  const uid = Number(el.dataset.uid), id = el.dataset.id;
  const inHand = !!el.closest('.hand') || !!el.closest('.zone-row.consp');
  let sx = 0, sy = 0, timer = null, pid = null;
  const move = e => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!drag && !peekEl && Math.hypot(dx, dy) > 9) {
      clearTimeout(timer);
      const pi = playIdx(uid);
      const busy = document.body.classList.contains('busy');
      const canAtk = !inHand && el.classList.contains('canatk') && attackSet().size > 0;
      if (inHand && pi >= 0 && !busy) startDrag(el, e, { mode: 'play', pi });
      else if (canAtk && !busy) startDrag(el, e, { mode: 'attack' });
      else return release();
    }
    if (drag && drag.el === el) { e.preventDefault(); moveDrag(e); }
  };
  const up = e => {
    if (e.pointerId !== pid) return;
    release();
    if (peekEl) { hidePeek(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 350); }
    if (drag && drag.el === el) { endDrag(e); suppressClick = true; setTimeout(() => { suppressClick = false; }, 350); }
  };
  const cancel = e => { if (e.pointerId !== pid) return; release(); hidePeek(); if (drag && drag.el === el) cancelDrag(); };
  function release() { clearTimeout(timer); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); }
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    sx = e.clientX; sy = e.clientY; pid = e.pointerId;
    release();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    timer = setTimeout(() => { if (!drag) { showPeek(id); suppressClick = true; } }, 380);
  });
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    const ps = pickSet();
    if (view && view.choice && view.choice.type === 'pick' && ps[uid] != null) { buzz(8); return togglePick(ps[uid]); }
    openCard(uid, id);
  });
}
function startDrag(el, e, opt) {
  const r = el.getBoundingClientRect();
  const g = document.createElement('div'); g.className = 'dragghost' + (opt.mode === 'attack' ? ' atkghost' : '');
  g.innerHTML = el.innerHTML;
  const sc = opt.mode === 'attack' ? 0.85 : 1;
  Object.assign(g.style, { width: r.width * sc + 'px', height: r.height * sc + 'px', left: '0px', top: '0px' });
  document.body.appendChild(g);
  drag = { el, g, pi: opt.pi, mode: opt.mode, uid: Number(el.dataset.uid), r, ox: (e.clientX - r.left) * sc, oy: (e.clientY - r.top) * sc, over: false, hover: null };
  el.classList.add('dragging'); document.body.classList.add('dragmode', opt.mode === 'attack' ? 'atkdrag' : 'playdrag'); buzz(10); SFX.play('draw');
  moveDrag(e);
}
function hoverCard(e) {
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const c = t && t.closest && t.closest('.board .c[data-uid]');
  return c && c !== (drag && drag.el) ? c : null;
}
function dropOk(e) {
  if (drag && drag.mode === 'attack') { const h = hoverCard(e); return !!(h && h.classList.contains('atk')); }
  const h = $app.querySelector('.hand'); return h && e.clientY < h.getBoundingClientRect().top - 12;
}
function moveDrag(e) {
  const d = drag; if (!d) return;
  const x = e.clientX - d.ox, y = e.clientY - d.oy;
  const over = dropOk(e);
  const hc = hoverCard(e);
  const hv = d.mode === 'attack' ? (hc && hc.classList.contains('atk') ? hc : null) : (over ? hc : null);
  if (hv !== d.hover) { if (d.hover) d.hover.classList.remove('droptarget'); d.hover = hv; if (hv) { hv.classList.add('droptarget'); buzz(6); } }
  d.g.style.transform = `translate(${x}px,${y}px) scale(${over ? (hv ? 1.05 : 1.2) : 1.1}) rotate(${over ? 0 : -4}deg)`;
  if (over !== d.over) { d.over = over; document.body.classList.toggle('dropover', over); if (over) buzz(6); }
  const dz = $app.querySelector('.dropzone'); if (dz) dz.textContent = d.mode === 'attack' ? (hv ? '放開以襲擊' : '拖到紅框目標上襲擊') : (hv ? `放開打出 · 指定《${esc(nameOf(hv.dataset.id) || '')}》（若效果需要目標）` : '放開以打出');
}
const intentLog = window.__intentLog = [];
function endDrag(e) {
  const d = drag; if (!d) return;
  if (!dropOk(e)) return cancelDrag();
  const hv = d.hover;
  const k = animK();
  d.g.animate([{ opacity: 1 }, { opacity: 0, transform: d.g.style.transform + ' scale(1.15)' }], { duration: Math.max(1, 220 * k), fill: 'forwards' }).onfinish = () => d.g.remove();
  setTimeout(() => d.g.remove(), 400);
  finishDrag();
  const ch = view && view.choice;
  if (!ch) return;
  if (d.mode === 'attack') {
    const tu = Number(hv.dataset.uid);
    let idx = ch.options.findIndex(o => o.uid === tu && o.kind === 'attack');
    if (idx < 0) idx = ch.options.findIndex(o => o.uid === tu && o.kind === 'crusade');
    if (idx < 0) return toast('這個目標目前無法襲擊');
    ui.intent = { kind: 'attack', uid: d.uid, seq: ch.seq, t: Date.now() };
    intentLog.push({ kind: 'attack', step: 'start', attacker: d.uid, target: tu });
    answer([idx]);
  } else {
    ui.intent = hv ? { kind: 'target', uid: Number(hv.dataset.uid), seq: ch.seq, t: Date.now() } : null;
    if (hv) intentLog.push({ kind: 'target', step: 'start', target: Number(hv.dataset.uid) });
    answer([d.pi]);
  }
}
// 拖曳意圖：出牌後第一個「選擇目標」或襲擊後「選擇襲擊信徒」時自動帶入
function applyIntent() {
  const it = ui.intent; if (!it || !view) return;
  const ch = view.choice;
  if (Date.now() - it.t > 30000 || view.winner != null) { ui.intent = null; return; }
  if (!ch || ch.seq === it.seq) return;
  if (window.__intentDbg) intentLog.push({ kind: it.kind, step: 'seen', type: ch.type, prompt: ch.prompt, n: ch.options.length, uids: ch.options.map(o => o.uid) });
  if (ch.type === 'pick') {
    ui.intent = null;
    const i = ch.options.findIndex(o => o.uid === it.uid);
    if (i < 0) { intentLog.push({ kind: it.kind, step: 'invalid' }); if (it.kind === 'target') toast('拖曳的卡不是這個效果可選的目標，請在下方選擇'); return; }
    ui.sel = [i];
    if (it.kind === 'target') {
      if (ch.max === 1 && pickOk(ch)) { intentLog.push({ kind: 'target', step: 'auto' }); setTimeout(() => { if (view && view.choice && view.choice.seq === ch.seq) answer([i]); }, 0); }
      else intentLog.push({ kind: 'target', step: 'preselect' });
    } else {
      if (pickOk(ch) && ch.options.length === 1) { intentLog.push({ kind: 'attack', step: 'auto' }); setTimeout(() => { if (view && view.choice && view.choice.seq === ch.seq) answer([i]); }, 0); }
      else { intentLog.push({ kind: 'attack', step: 'preselect' }); toast(pickOk(ch) ? '可以再加入其他信徒一起襲擊，按「確定」送出' : '聲量不足，請再加入其他信徒一起襲擊', 3200); }
    }
    return;
  }
  ui.intent = null;
}
function cancelDrag() {
  const d = drag; if (!d) return;
  const k = animK();
  const cur = d.g.style.transform;
  const anim = d.g.animate([{ transform: cur }, { transform: `translate(${d.r.left}px,${d.r.top}px)` }], { duration: Math.max(1, 260 * k), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  anim.onfinish = () => d.g.remove(); setTimeout(() => d.g.remove(), 500);
  finishDrag();
}
function finishDrag() {
  const d = drag; drag = null;
  if (d) d.el.classList.remove('dragging');
  if (d && d.hover) d.hover.classList.remove('droptarget');
  document.body.classList.remove('dragmode', 'dropover', 'atkdrag', 'playdrag');
  if (renderPending) { renderPending = false; render(); }
}
function sheetHtml() {
  const ch = view.choice;
  if (!ch || ch.info === 'action') return ui.actsOpen && ch ? actsSheet(ch) : '';
  if (ui.sheetMin) return `<div class="sheet min"><div class="row"><div class="pr" style="flex:1">${esc(ch.prompt)}</div><button id="sheetMax" class="primary">展開選擇</button></div></div>`;
  let opts = '';
  if (ch.type === 'ask') opts = ch.options.map((o, i) => `<button class="opt" data-ask="${i}">${o.cardId ? `<img src="${img(o.cardId)}">` : ''}<span>${esc(o.label)}</span>${o.cardId ? `<span class="zoom" data-zoomid="${o.cardId}">查看</span>` : ''}</button>`).join('');
  else opts = ch.options.map((o, i) => `<button class="opt ${ui.sel.includes(i) ? 'on' : ''}" data-pick="${i}"><img src="${img(o.cardId)}"><span>${esc(o.label)}${o.val != null ? `（${o.val}）` : ''}<br><small style="color:#9b8b74">${zoneName(o.zone)}</small></span><span class="zoom" data-zoomid="${o.cardId}">查看</span></button>`).join('');
  let foot = '';
  if (ch.type === 'pick') {
    const ok = pickOk(ch);
    const sum = ch.options.some(o => o.val != null) ? ui.sel.reduce((s, i) => s + (ch.options[i].val || 0), 0) : null;
    foot = `<div class="foot"><button id="sheetMinBtn" class="ghost">看場面</button>${ch.suggest ? '<button id="suggestBtn" class="ghost">自動選擇</button>' : ''}<button id="confirm" class="primary" ${ok ? '' : 'disabled'}>確定（${ui.sel.length}${ch.max > 1 || ch.min !== ch.max ? `／${ch.min === ch.max ? ch.min : ch.min + '~' + ch.max}` : ''}）${sum != null ? ` 合計 ${sum}` : ''}</button></div>`;
  } else foot = `<div class="foot"><button id="sheetMinBtn" class="ghost">看場面</button></div>`;
  const cban = ch.info === 'counter' ? '<div class="cban">⚖ 控訴時機：要展示手牌控訴這個效果嗎？</div>' : '';
  return `<div class="sheet ${ch.info === 'counter' ? 'counter' : ''}"><div class="grab"></div>${cban}<div class="pr">${esc(ch.prompt)}</div><div class="opts">${opts}</div>${foot}</div>`;
}
function actsSheet(ch) {
  return `<div class="sheet"><div class="grab"></div><div class="pr">選擇行動（剩餘 ${view.actionsLeft}）</div><div class="opts">${ch.options.map((o, i) => `<button class="opt" data-act="${i}">${o.cardId ? `<img src="${img(o.cardId)}">` : ''}<span>${esc(o.label)}</span></button>`).join('')}</div><div class="foot"><button id="closeActs" class="ghost">關閉</button></div></div>`;
}
const ZN = { deck: '牌庫', hand: '手牌', field: '場上', conspiracy: '陰謀區', discard: '棄牌區', exile: '除外區', score: '計分區', stack: '結算中', under: '獻祭（蓋放於儀式下）' };
const zoneName = z => ZN[z] || '';
function pickOk(ch) {
  const n = ui.sel.length;
  if (n < ch.min || n > ch.max) return false;
  const hasVal = ch.options.some(o => o.val != null);
  if (hasVal) {
    const sum = ui.sel.reduce((s, i) => s + (ch.options[i].val || 0), 0);
    if (ch.sumMin != null && sum < ch.sumMin) return false;
    if (ch.sumMax != null && sum > ch.sumMax) return false;
  }
  return true;
}
function overHtml() {
  if (view.winner == null) return '';
  const win = view.winner === seat;
  const meReady = false;
  return `<div class="over"><div class="mbox" style="text-align:center"><div class="ztitle" style="font-size:26px">${win ? '🏆 勝利！' : '敗北'}</div><div>${esc(view.winReason)}</div>
    <label class="sub">下一局牌組</label><select id="rdeck" class="sel">${allDecks().filter(d => validate(d.cards).ok).map(d => `<option value="${esc(d.id)}" ${selectedDeck() && selectedDeck().id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    <button class="primary" id="rematch">再來一局</button><button id="viewBoard" class="ghost">查看最終盤面</button><button class="ghost" id="toLobby">回大廳</button></div></div>`;
}
function answer(sel) {
  if (!view || !view.choice) return;
  if (ui.busy === view.choice.seq) return; // 防止重複送出
  ui.busy = view.choice.seq;
  send({ t: 'answer', seq: view.choice.seq, sel }); ui.actsOpen = false;
  document.body.classList.add('busy');
}
function bindGame() {
  const q = s => $app.querySelector(s);
  $app.querySelectorAll('.game .c[data-uid]').forEach(bindCardGestures);
  $app.querySelectorAll('[data-zone]').forEach(el => el.onclick = () => { const [p, z] = el.dataset.zone.split(':'); openZone(Number(p), z); });
  $app.querySelectorAll('[data-ask]').forEach(el => el.onclick = e => { if (e.target.dataset.zoomid) return; answer([Number(el.dataset.ask)]); });
  $app.querySelectorAll('[data-act]').forEach(el => el.onclick = () => answer([Number(el.dataset.act)]));
  $app.querySelectorAll('[data-pick]').forEach(el => el.onclick = e => { if (e.target.dataset.zoomid) return; togglePick(Number(el.dataset.pick)); });
  $app.querySelectorAll('[data-zoomid]').forEach(el => el.onclick = e => { e.stopPropagation(); openCard(null, el.dataset.zoomid); });
  const rd = q('#rdeck'); if (rd) rd.onchange = () => localStorage.setItem(DKSEL, rd.value);
  const on = (id, fn) => { const e = q('#' + id); if (e) e.onclick = fn; };
  on('confirm', () => answer(ui.sel.slice()));
  on('sheetMinBtn', () => { ui.sheetMin = true; render(); });
  on('suggestBtn', () => { const ch = view && view.choice; if (ch && ch.suggest) { ui.sel = ch.suggest.slice(); render(); } });
  on('sheetMax', () => { ui.sheetMin = false; render(); });
  on('logBtn', openLog);
  on('lastlog', openLog);
  on('actsBtn', () => { ui.actsOpen = true; render(); });
  on('closeActs', () => { ui.actsOpen = false; render(); });
  on('endBtn', () => { const i = view.choice.options.findIndex(o => o.kind === 'end'); if (view.actionsLeft > 0 && !confirm(`還有 ${view.actionsLeft} 個行動，確定結束回合？`)) return; answer([i]); });
  on('menuBtn', openMenu);
  on('rematch', () => { send(Object.assign({ t: 'rematch' }, deckPayload())); toast('已送出再來一局，等待對手…'); });
  on('toLobby', leave);
  on('viewBoard', () => { const o = $app.querySelector('.over'); if (o) o.remove(); });
}
function togglePick(i) {
  const ch = view.choice;
  const k = ui.sel.indexOf(i);
  if (k >= 0) ui.sel.splice(k, 1);
  else { if (ch.max === 1) ui.sel = [i]; else if (ui.sel.length < ch.max) ui.sel.push(i); else return toast(`最多選 ${ch.max} 張`); }
  render();
}
function findCard(uid) {
  if (!view) return null;
  for (const p of view.players) for (const z of ['field', 'hand', 'conspiracy', 'discard', 'exile', 'score', 'stack', 'under']) { const c = (p[z] || []).find(x => x.uid === uid); if (c) return { c, z, p }; }
  return null;
}
function openCard(uid, id) {
  const d = CARDS[id] || {};
  const f = uid != null ? findCard(uid) : null;
  const c = f && f.c;
  const meta = [d.type, d.faction, d.volume != null ? `聲量 ${d.volume}` : '', d.calamity != null ? `災厄 ${d.calamity}` : '', d.guard != null ? `守護 ${d.guard}` : '', d.locationType ? `類型：${d.locationType}` : '', d.stardust != null ? `星塵 ${d.stardust}` : ''].filter(Boolean);
  let st = [];
  if (c) {
    if (c.guilty) st.push('罪惡');
    if (c.curGuard != null) st.push(`目前守護 ${c.curGuard}`);
    if (c.guardAt != null) { const l = findCard(c.guardAt); st.push('駐守中' + (l ? `：${CARDS[l.c.id].name}` : '')); }
    if (c.curCal != null) st.push(`執行災厄 ${c.curCal}`);
    if (c.reduction) st.push(`符號需求減少 ${c.reduction}（獻祭 ${c.sacrificed || 0}）`);
    if (c.deconAt != null) { const l = findCard(c.deconAt); st.push('解構中' + (l ? `：${CARDS[l.c.id].name}` : '')); }
    if (c.attachTo != null) { const l = findCard(c.attachTo); st.push('附著於' + (l ? `：${CARDS[l.c.id].name}` : '')); }
    if (c.underOf != null) { const l = findCard(c.underOf); st.push('獻祭給' + (l ? `：${CARDS[l.c.id].name}` : '')); }
    if (c.offering) st.push('供品：無法控訴、無法襲擊，可被敵方信徒襲擊');
    if (c.suppressed) st.push('被附著：失去效果欄內所有能力');
    if (c.ctrlFrom != null) st.push('被取得控制權（已成為控制者的牌，離場時進入控制者的對應區域；附著魔法給予的控制權在魔法離場時歸還）');
    if (c.restrained) st.push('被強制拘束：不能襲擊與解除罪惡');
    if (c.ready != null) st.push(c.ready ? '條件已滿足' : '條件未滿足');
    st.push(`位置：${f.p.idx === seat ? '我方' : '敵方'}${zoneName(f.z)}`);
  }
  let acts = '';
  if (view && view.choice && uid != null) {
    const ch = view.choice;
    if (ch.info === 'action') acts = ch.options.map((o, i) => o.uid === uid ? `<button class="primary" data-mact="${i}">${esc(o.label)}</button>` : '').join('');
    else if (ch.type === 'pick') { const i = ch.options.findIndex(o => o.uid === uid); if (i >= 0) acts = `<button class="primary" data-mpick="${i}">${ui.sel.includes(i) ? '取消選擇' : '選擇這張'}</button>`; }
    else if (ch.type === 'ask') acts = ch.options.map((o, i) => o.uid === uid ? `<button class="primary" data-mask="${i}">${esc(o.label)}</button>` : '').join('');
  }
  showModal(`<img class="zoomimg" src="${img(id, 640)}"><div class="ztitle">${esc(d.name)}</div><div class="zmeta">${meta.map(esc).join(' · ')}</div>
    ${d.symbols && d.symbols.length ? `<div>${d.symbols.map(s => `<span class="sym ${s}">${s}</span>`).join(' ')}</div>` : ''}
    <div class="zeff">${esc(d.effect || '')}</div>${st.length ? `<div class="zmeta">${st.map(esc).join(' · ')}</div>` : ''}
    <div class="acts">${acts}<button class="ghost" data-close>關閉</button></div>`);
  $modal.querySelectorAll('[data-mact]').forEach(b => b.onclick = () => { hideModal(); answer([Number(b.dataset.mact)]); });
  $modal.querySelectorAll('[data-mask]').forEach(b => b.onclick = () => { hideModal(); answer([Number(b.dataset.mask)]); });
  $modal.querySelectorAll('[data-mpick]').forEach(b => b.onclick = () => { hideModal(); ui.sheetMin = false; togglePick(Number(b.dataset.mpick)); });
}
function showModal(html) { $modal.innerHTML = `<div class="mbox">${html}</div>`; $modal.classList.remove('hidden'); $modal.querySelectorAll('[data-close]').forEach(b => b.onclick = hideModal); }
function hideModal() { $modal.classList.add('hidden'); $modal.innerHTML = ''; }
$modal.onclick = e => { if (e.target === $modal) hideModal(); };
function openZone(p, z) {
  const pl = view.players[p];
  const cards = pl[z] || [];
  showModal(`<div class="ztitle">${esc(pl.name)} · ${zoneName(z)}（${cards.length}）</div><div class="grid">${cards.map(c => cardEl(c)).join('') || '<span class="empty">空</span>'}</div><button class="ghost" data-close>關閉</button>`);
  $modal.querySelectorAll('.c').forEach(el => el.onclick = () => openCard(Number(el.dataset.uid), el.dataset.id));
}
function openLog() {
  let html = '', lastTurn = -1;
  for (const l of view.log.slice().reverse()) html += `<div class="${/^——/.test(l.text) ? 't' : ''}">${esc(l.text)}</div>`;
  showModal(`<div class="ztitle">遊戲日誌</div><div class="log">${html}</div><button class="ghost" data-close>關閉</button>`);
}
function openMenu() {
  showModal(`<div class="ztitle">選單</div><div class="sub">房號 ${room ? room.code : ''} · ${room && room.mode === 'ai' ? '對戰 AI' : '線上對戰'}</div>
    <div class="zeff" style="font-size:12.5px">玩法提示：金色發光的卡可以執行行動，手牌可直接拖曳到場上打出（拖到某張卡上即指定為目標）；點卡片查看效果與可用行動，長按可放大檢視。紅框（⚔）是可以襲擊的目標，把自己的信徒拖到紅框上即可襲擊，藍框是目前可選擇的目標。罪惡信徒會橫置並變暗。</div>
    <label class="row" style="gap:8px"><input type="checkbox" id="autoSkip2" style="width:auto" ${autoSkip() ? 'checked' : ''}>沒有可控訴的卡時自動跳過</label>
    ${settingsHtml('2')}
    <div class="acts"><button id="tutAgain">重看教學</button><button class="danger" id="concede">投降</button><button id="toLobby2">回大廳（可用連結回來）</button><button class="ghost" data-close>關閉</button></div>`);
  document.getElementById('autoSkip2').onchange = e => { localStorage.setItem('accusation.autoSkip', e.target.checked ? '1' : '0'); send({ t: 'option', autoSkip: e.target.checked }); toast(e.target.checked ? '已開啟自動跳過' : '已關閉自動跳過：每次災厄都會詢問你'); };
  bindSettings('2');
  document.getElementById('tutAgain').onclick = () => { hideModal(); startTutorial(); };
  document.getElementById('concede').onclick = () => { if (confirm('確定投降？')) { send({ t: 'concede' }); hideModal(); } };
  document.getElementById('toLobby2').onclick = () => { hideModal(); ui.screen = 'lobby'; history.replaceState(null, '', '/'); params.delete('room'); view = null; room = null; render(); };
}
function render() {
  if (drag && ui.screen === 'game') { renderPending = true; return; }
  if (ui.screen === 'decks') return decksScreen();
  if (ui.screen === 'edit') return editScreen();
  if (ui.screen === 'pub') return pubScreen();
  if (ui.screen === 'lobby' || !room) return lobby();
  if (ui.screen === 'waiting') return waiting();
  return game();
}
render();
})();
