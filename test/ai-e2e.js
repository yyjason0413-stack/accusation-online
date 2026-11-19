'use strict';
// 單人對 AI：透過 UI 玩到結束，並截圖手機畫面（390x844）
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8787';
const SHOTS = process.argv[3] || '/workspace/accusation/shots';
const DECK = process.argv[4] || 'preset-cro01';
const TAG = DECK === 'preset-cro01' ? '' : '-' + DECK.replace('preset-', '');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/00-lobby.png` });
  await page.fill('#nm', 'Lian');
  await page.click('#decks'); await page.click(`[data-use="${DECK}"]`);
  await page.click('#ai');
  await page.waitForSelector('.game');
  let over = false, steps = 0, myTurns = 0, shot = false;
  while (!over && steps < 800) {
    steps++;
    await page.waitForTimeout(120);
    try {
      if (await page.$('.over')) { over = true; break; }
      if (await page.$('body.busy')) continue;
      const ask = await page.$$('[data-ask]');
      if (ask.length) { await page.click(`[data-ask="${Math.random() < 0.6 ? ask.length - 1 : 0}"]`, { timeout: 2000 }); continue; }
      const n = (await page.$$('[data-pick]')).length;
      if (n) {
        if (await page.$('#suggestBtn')) { await page.click('#suggestBtn'); await page.click('#confirm'); continue; }
        for (let i = 0; i < n && !(await page.$('#confirm:not([disabled])')); i++) await page.click(`[data-pick="${i}"]`, { timeout: 2000 });
        if (await page.$('#confirm:not([disabled])')) await page.click('#confirm');
        continue;
      }
      if (await page.$('#endBtn')) {
        const acts = await page.$$('.hand .c.act, .zone-row .c.act');
        if (acts.length && Math.random() < 0.85) {
          await acts[Math.floor(Math.random() * acts.length)].click();
          await page.waitForSelector('#modal .mbox', { timeout: 2000 });
          if (!shot && myTurns >= 4) { await page.screenshot({ path: `${SHOTS}/06-card-zoom${TAG}.png` }); }
          const b = await page.$$('[data-mact]');
          if (b.length) await b[0].click(); else await page.click('[data-close]');
        } else {
          myTurns++;
          if (!shot && myTurns === 5) { await page.screenshot({ path: `${SHOTS}/mobile${TAG}-390x844.png` }); shot = true; }
          await page.click('#endBtn');
        }
      }
    } catch (e) { if (!/attached|Timeout|detached/.test(e.message)) throw e; }
  }
  await page.screenshot({ path: `${SHOTS}/07-ai-final${TAG}.png` });
  await page.click('#logBtn', { force: true }).catch(() => {});
  console.log(JSON.stringify({ steps, over, myTurns, errors }));
  await browser.close();
  process.exit(errors.length || !over ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
