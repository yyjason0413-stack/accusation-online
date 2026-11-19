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
function connect() {
  if (mode === 'poll') return startPoll();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let opened = false;
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  const fallback = setTimeout(() => { if (!opened && !wsEverOpened) { mode = 'poll'; try { ws.onclose = null; ws.close(); } catch {} startPoll(); } }, 5000);
  ws.onopen = () => { opened = wsEverOpened = true; clearTimeout(fallback); onOpen(); };
  ws.onclose = () => {
    clearTimeout(fallback); connected = false; render();
    if (!opened && !wsEverOpened) { mode = 'poll'; return startPoll(); }
    setTimeout(connect, Math.min(1000 * 2 ** retry++, 8000));
  };
  ws.onmessage = ev => onMsg(JSON.parse(ev.data));
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
    if (m.t === 'joined') { seat = m.seat; joinedCode = m.code; localStorage.setItem(LS, JSON.stringify({ code: m.code, token: m.token })); history.replaceState(null, '', '/?room=' + m.code); }
    else if (m.t === 'state') {
      seat = m.seat; room = m.room;
      const prevSeq = view && view.choice && view.choice.seq;
      view = m.view;
      const seq = view && view.choice && view.choice.seq;
      if (seq !== prevSeq) { ui.sel = []; ui.sheetMin = false; }
      if (!view || !view.choice || view.choice.seq !== ui.busy) { ui.busy = null; document.body.classList.remove('busy'); }
      ui.screen = room.status === 'waiting' ? 'waiting' : 'game';
      render();
    } else if (m.t === 'error') {
      toast(m.msg); ui.busy = null; document.body.classList.remove('busy');
      if (m.gone) { localStorage.removeItem(LS); ui.screen = 'lobby'; room = null; view = null; render(); }
    }
  }
}
const outbox = [];
function send(o) { if (ws && ws.readyState === 1 && connected) ws.send(JSON.stringify(o)); else { outbox.push(o); toast('連線中，稍候會自動送出…', 1500); } }
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
    <div class="sub" style="text-align:left">關閉時，即使沒有可控訴的卡也會詢問你（只能選不控訴），對手無法從等待時間推測你的手牌。</div>` : '';
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
function decksScreen() {
  const sel = selectedDeck();
  $app.innerHTML = `<div class="lobby"><div class="row"><button id="back">‹ 返回</button><h1 style="flex:1;font-size:22px;letter-spacing:3px">牌組</h1><button class="primary" id="newDeck">＋ 新牌組</button></div>
    ${allDecks().map(d => { const v = validate(d.cards); const L = d.cards.find(id => (CARDS[id] || {}).type === '教主');
      return `<div class="deckpick ${sel && sel.id === d.id ? 'on' : ''}">${L ? `<img src="${img(L)}">` : '<div class="back"></div>'}<div style="flex:1"><div style="font-weight:700">${esc(d.name)}</div>
      <div class="sub" style="text-align:left">${v.ok ? `${esc(v.faction)}${v.secondary ? ' ＋ ' + esc(v.secondary) : ''}` : `<span style="color:#e08a7a">不合法：${esc(v.errors[0] || '')}</span>`}</div>
      <div class="row" style="margin-top:6px;flex-wrap:wrap">${v.ok ? `<button class="primary" data-use="${esc(d.id)}">${sel && sel.id === d.id ? '使用中' : '使用'}</button>` : ''}
      ${d.preset ? `<button data-copy="${esc(d.id)}">複製來編輯</button>` : `<button data-edit="${esc(d.id)}">編輯</button><button class="danger" data-del="${esc(d.id)}">刪除</button>`}</div></div></div>`; }).join('')}
    <div class="sub">組牌規則：教主＋固定 3 張儀式，再加 20 張：至少 12 張與教主同教團；其餘至多 8 張，可來自另一個教團（限 1 個）與任意張放逐者。也可以 20 張全用主教團。每張限 1 張。</div></div>`;
  document.getElementById('back').onclick = () => { ui.screen = room ? (room.status === 'waiting' ? 'waiting' : 'game') : 'lobby'; render(); };
  document.getElementById('newDeck').onclick = () => { ui.edit = { id: 'u' + Date.now(), name: '我的牌組', cards: [], tab: 'primary' }; ui.screen = 'edit'; render(); };
  $app.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { localStorage.setItem(DKSEL, b.dataset.use); ui.screen = 'lobby'; render(); });
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
      ${v.ok ? '<div class="okline">✓ 牌組合法，可以使用</div>' : `<div class="errline">${v.errors.map(esc).join('<br>')}</div>`}</div>
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
function leave() { localStorage.removeItem(LS); room = null; view = null; ui.screen = 'lobby'; history.replaceState(null, '', '/'); params.delete('room'); if (ws && mode === 'ws') ws.close(); render(); }

// ---------- 遊戲畫面 ----------
function cardEl(c, opts = {}) {
  const d = CARDS[c.id] || {};
  let cls = 'c';
  if (c.guilty) cls += ' guilty';
  if (opts.act) cls += ' act';
  if (opts.selable) cls += ' selable';
  if (opts.chosen) cls += ' chosen';
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
  return `<div class="${cls}" data-uid="${c.uid}" data-id="${c.id}"><img src="${img(c.id)}" alt="${esc(d.name)}" loading="lazy">${badges}</div>`;
}
const TYPES = id => (CARDS[id] || {}).type;
function symHtml(s) { return `<span class="syms">${Object.entries(s || {}).map(([k, v]) => `<span class="sym ${k}">${k}${v}</span>`).join('')}</span>`; }

function actionMap() {
  const m = {};
  if (view && view.choice && view.choice.info === 'action') view.choice.options.forEach((o, i) => { if (o.uid != null) (m[o.uid] = m[o.uid] || []).push(i); });
  return m;
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
  const ce = c => cardEl(c, { act: !!am[c.uid] || false, selable: ps[c.uid] != null && !ui.sel.includes(ps[c.uid]), chosen: ps[c.uid] != null && ui.sel.includes(ps[c.uid]), locName: locName(c.guardAt) });
  // 敵方地點也可能是可選/可襲擊
  const amAll = actionMap();
  const ceO = c => cardEl(c, { act: !!amAll[c.uid], selable: ps[c.uid] != null && !ui.sel.includes(ps[c.uid]), chosen: ps[c.uid] != null && ui.sel.includes(ps[c.uid]), locName: locName(c.guardAt) });
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
    ${mine ? '' : `<span class="pill">手牌 ${p.handCount}</span>`}
    <span class="pill">牌庫 ${p.deckCount}</span>
    <span class="pill btn" data-zone="${p.idx}:conspiracy">陰謀 ${p.conspiracy.length}</span>
    <span class="pill btn" data-zone="${p.idx}:discard">棄牌 ${p.discard.length}</span>
    <span class="pill btn" data-zone="${p.idx}:exile">除外 ${p.exile.length}</span>
    ${p.underCount ? (mine ? `<span class="pill btn" data-zone="${p.idx}:under">獻祭 ${p.underCount}</span>` : `<span class="pill">獻祭 ${p.underCount}</span>`) : ''}
    <span class="pill btn stars" data-zone="${p.idx}:score">${sc}</span>
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
function game() {
  if (!view) { $app.innerHTML = '<div class="lobby"><h1>控訴</h1><div class="sub">載入中…</div></div>'; return; }
  const me = view.players[seat], op = view.players[1 - seat];
  const am = actionMap(), ps = pickSet();
  const handHtml = (me.hand || []).map(c => cardEl(c, { act: !!am[c.uid], selable: ps[c.uid] != null && !ui.sel.includes(ps[c.uid]), chosen: ps[c.uid] != null && ui.sel.includes(ps[c.uid]) })).join('') || '<span class="empty">沒有手牌</span>';
  const leaderHtml = me.conspiracy.length ? `<div class="zone-label">陰謀區${view.players[0].score.length + view.players[1].score.length === 0 ? '（教主需任一方完成 1 個儀式後才能打出）' : ''}</div><div class="zone-row">${me.conspiracy.map(c => cardEl(c, { act: !!am[c.uid] })).join('')}</div>` : '';
  const stack = [...me.stack, ...op.stack];
  const last = view.log.slice(-1)[0];
  const endIdx = view.choice && view.choice.info === 'action' ? view.choice.options.findIndex(o => o.kind === 'end') : -1;
  const hasActs = view.choice && view.choice.info === 'action' && view.choice.options.length > 1;
  $app.innerHTML = `<div class="game">
    ${zoneBar(op, false)}
    <div class="board">
      ${sideHtml(op, false)}
      ${stack.length ? `<div class="zone-label">結算中</div><div class="zone-row">${stack.map(c => cardEl(c)).join('')}</div>` : ''}
      ${sideHtml(me, true)}
      ${leaderHtml}
    </div>
    <div class="lastlog" id="lastlog">${last ? esc(last.text) : ''}</div>
    <div class="mid"><div class="st">${statusText()}</div>
      <button id="logBtn">日誌</button>
      ${hasActs ? '<button id="actsBtn">行動</button>' : ''}
      ${endIdx >= 0 ? '<button class="primary" id="endBtn">結束回合</button>' : ''}
      <button id="menuBtn">⋯</button></div>
    ${zoneBar(me, true)}
    <div class="hand">${handHtml}</div>
  </div>
  ${sheetHtml()}
  ${overHtml()}
  ${connected ? '' : '<div class="conn">連線中斷，重新連線中…</div>'}`;
  bindGame();
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
  return `<div class="sheet"><div class="grab"></div><div class="pr">${esc(ch.prompt)}</div><div class="opts">${opts}</div>${foot}</div>`;
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
  $app.querySelectorAll('.c').forEach(el => el.onclick = () => openCard(Number(el.dataset.uid), el.dataset.id));
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
    <div class="zeff" style="font-size:12.5px">玩法提示：發亮（金框）的卡可以執行行動，點卡片查看效果與可用行動；藍框代表目前可選擇的目標。罪惡信徒會橫置並變暗。按「行動」可看到所有可用行動。</div>
    <label class="row" style="gap:8px"><input type="checkbox" id="autoSkip2" style="width:auto" ${autoSkip() ? 'checked' : ''}>沒有可控訴的卡時自動跳過</label>
    <div class="acts"><button class="danger" id="concede">投降</button><button id="toLobby2">回大廳（可用連結回來）</button><button class="ghost" data-close>關閉</button></div>`);
  document.getElementById('autoSkip2').onchange = e => { localStorage.setItem('accusation.autoSkip', e.target.checked ? '1' : '0'); send({ t: 'option', autoSkip: e.target.checked }); toast(e.target.checked ? '已開啟自動跳過' : '已關閉自動跳過：每次災厄都會詢問你'); };
  document.getElementById('concede').onclick = () => { if (confirm('確定投降？')) { send({ t: 'concede' }); hideModal(); } };
  document.getElementById('toLobby2').onclick = () => { hideModal(); ui.screen = 'lobby'; history.replaceState(null, '', '/'); params.delete('room'); view = null; room = null; render(); };
}
function render() {
  if (ui.screen === 'decks') return decksScreen();
  if (ui.screen === 'edit') return editScreen();
  if (ui.screen === 'lobby' || !room) return lobby();
  if (ui.screen === 'waiting') return waiting();
  return game();
}
render();
})();
