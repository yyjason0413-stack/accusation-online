'use strict';
// 兩個手機瀏覽器（Playwright）透過 UI 實際連線對戰的端對端測試。
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8787';
const STEPS = Number(process.argv[3] || 150);
const SHOTS = process.argv[4] || '/workspace/accusation/shots';
(async () => {
  const browser = await chromium.launch();
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent });
    await ctx.addInitScript(() => { try { localStorage.setItem('accusation.tutorialDone', '1'); } catch {} });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
    return page;
  };
  const A = await mk(), B = await mk();
  await A.goto(BASE);
  await A.fill('#nm', 'Lian');
  await A.click('#create');
  await A.waitForSelector('.code');
  const code = (await A.textContent('.code')).trim();
  console.log('room', code);
  await A.screenshot({ path: `${SHOTS}/01-waiting.png` });
  await B.goto(`${BASE}/?room=${code}`);
  await B.fill('#nm', '朋友');
  await B.click('#decks'); await B.click('[data-use="preset-cro01"]');
  await B.click('#join');
  await A.waitForSelector('.game'); await B.waitForSelector('.game');
  await A.waitForTimeout(500);
  await A.screenshot({ path: `${SHOTS}/02-mulligan.png` });
  let shotsTaken = 0, plays = 0, steps = 0, over = false;
  async function step(page, name) {
    if (await page.$('.over')) { over = true; return true; }
    if (await page.$('body.busy')) return false;
    const ask = await page.$$('[data-ask]');
    if (ask.length) {
      // 控訴時偶爾控訴
      const pick = Math.random() < 0.5 ? ask[ask.length - 1] : ask[0];
      await pick.click(); return true;
    }
    const n = (await page.$$('[data-pick]')).length;
    if (n) {
      for (let i = 0; i < n; i++) {
        if (await page.$('#confirm:not([disabled])')) break;
        await page.click(`[data-pick="${i}"]`, { timeout: 2000 });
        await page.waitForTimeout(30);
      }
      if (await page.$('#confirm:not([disabled])')) { await page.click('#confirm'); return true; }
      for (let i = 0; i < n; i++) {
        if (await page.$(`[data-pick="${i}"].on`)) { await page.click(`[data-pick="${i}"]`); await page.waitForTimeout(30); }
        if (await page.$('#confirm:not([disabled])')) { await page.click('#confirm'); return true; }
      }
      return false;
    }
    const sheetMax = await page.$('#sheetMax'); if (sheetMax) { await sheetMax.click(); return true; }
    if (await page.$('#endBtn')) {
      const acts = await page.$$('.hand .c.act, .side .c.act, .zone-row .c.act');
      if (acts.length && Math.random() < 0.8) {
        await acts[Math.floor(Math.random() * acts.length)].click();
        await page.waitForSelector('#modal .mbox');
        const b = await page.$$('[data-mact]');
        if (b.length) { await b[0].click(); plays++; }
        else await page.click('[data-close]');
        if (plays === 3 && shotsTaken < 1) { await page.waitForTimeout(400); shotsTaken++; }
        return true;
      }
      await page.click('#endBtn'); return true;
    }
    return false;
  }
  for (; steps < STEPS && !over; steps++) {
    let moved = false;
    for (const [p, n] of [[A, 'A'], [B, 'B']]) {
      try { if (await step(p, n)) { moved = true; await p.waitForTimeout(150); } }
      catch (e) { if (!/not attached|detached|Timeout/.test(e.message)) throw e; await p.waitForTimeout(150); }
    }
    if (!moved) await A.waitForTimeout(200);
    if (steps === 25) { await A.screenshot({ path: `${SHOTS}/03-midgame-A.png` }); await B.screenshot({ path: `${SHOTS}/03-midgame-B.png` }); }
  }
  await A.screenshot({ path: `${SHOTS}/04-final-A.png` });
  await B.screenshot({ path: `${SHOTS}/04-final-B.png` });
  // 卡片放大
  if (!over) {
    try { await A.click('.hand .c', { timeout: 3000, force: true }); await A.waitForTimeout(600); await A.screenshot({ path: `${SHOTS}/05-zoom.png` }); } catch (e) { console.log('zoom skipped', e.message.split('\n')[0]); }
  }
  // 斷線重連測試：重新整理 B
  await B.reload(); await B.waitForSelector('.game', { timeout: 10000 });
  const reconnected = !!(await B.$('.game'));
  console.log(JSON.stringify({ steps, plays, over, reconnected, errorsA: A.errors, errorsB: B.errors }));
  await browser.close();
  process.exit(A.errors.length || B.errors.length || !reconnected ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
