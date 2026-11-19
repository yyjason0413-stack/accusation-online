'use strict';
// 操作體驗 E2E：單人對 AI，以拖曳出牌為主，並擷取各種 UI 狀態截圖（390×844）。
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8787';
const SHOTS = process.argv[3] || '/workspace/accusation/shots';
const PFX = process.argv[4] || 'ux';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('accusation.tutorialDone', '1'); } catch {} });
    const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.setItem('accusation.autoSkip', '0'); localStorage.setItem('accusation.anim', 'normal'); });
  await page.reload();
  await page.fill('#nm', 'Lian');
  await page.click('#ai');
  await page.waitForSelector('.game');
  const fs = require('fs'); const T = m => process.env.DBG && fs.appendFileSync('/tmp/ux-trace.log', `${Date.now()} ${m}\n`);
  const shot = {}; const take = async (k) => { if (shot[k]) return; shot[k] = true; await page.screenshot({ path: `${SHOTS}/${PFX}-${k}.png` }); };
  let over = false, steps = 0, drags = 0, dragOk = 0, snapBack = 0, attacks = 0;
  const handUids = () => page.$$eval('.hand .c', els => els.map(e => e.dataset.uid));
  while (!over && steps < 900) {
    steps++; if (process.env.DBG && steps % 40 === 0) { console.log('step', steps, drags, dragOk, await page.evaluate(() => [document.body.className, !!document.querySelector('.dragghost'), (document.querySelector('.mid .st')||{}).textContent].join('|'))); await page.screenshot({ path: SHOTS + '/dbg.png' }); }
    await page.waitForTimeout(110);
    try {
      if (await page.$('.over')) { over = true; await page.waitForTimeout(500); await take('victory'); break; }
      if (!shot['turn-banner'] && await page.$('.fxo.turn')) await take('turn-banner');
      if (await page.$('body.busy')) continue;
      T('s' + steps);
      const ask = await page.$$('[data-ask]');
      if (ask.length) {
        T('ask');
        if (await page.$('.sheet.counter')) await take('accusation-window');
        await page.click(`[data-ask="${Math.random() < 0.5 ? ask.length - 1 : 0}"]`, { timeout: 2000 });
        await page.waitForTimeout(80);
        if (!shot['accusation-stamp'] && await page.$('.fxo.stamp')) await take('accusation-stamp');
        continue;
      }
      const n = (await page.$$('[data-pick]')).length;
      if (n) {
        T('pick ' + n);
        if (!shot['target-highlight'] && await page.$('.board .c.selable')) { await page.click('#sheetMinBtn').catch(() => {}); await page.waitForTimeout(150); await take('target-highlight'); await page.click('#sheetMax').catch(() => {}); continue; }
        if (await page.$('#sheetMax')) { await page.click('#sheetMax'); continue; }
        if (await page.$('#suggestBtn')) { await page.click('#suggestBtn'); await page.click('#confirm'); if (attacks && !shot['attack']) { for (let i = 0; i < 30; i++) { if (await page.$('.pop.atk')) { await take('attack'); break; } await page.waitForTimeout(40); } } continue; }
        for (let i = 0; i < n && !(await page.$('#confirm:not([disabled])')); i++) await page.click(`[data-pick="${i}"]`, { timeout: 2000 });
        if (await page.$('#confirm:not([disabled])')) await page.click('#confirm');
        if (attacks && !shot['attack']) { for (let i = 0; i < 30; i++) { if (await page.$('.pop.atk')) { await take('attack'); break; } await page.waitForTimeout(40); } }
        continue;
      }
      if (await page.$('#sheetMax')) { await page.click('#sheetMax'); continue; }
      if (await page.$('#endBtn')) {
        await take('hand-fan');
        const atk = await page.$$('.board .c.atk');
        if (atk.length && Math.random() < 0.8) {
          await atk[0].click(); await page.waitForSelector('#modal .mbox', { timeout: 2000 });
          const b = await page.$$('[data-mact]'); if (b.length) { await b[0].click(); attacks++; } else await page.click('[data-close]');
          continue;
        }
        const playable = await page.$$('.hand .c.playable');
        if (playable.length && (drags < 6 || Math.random() < 0.6)) {
          const el = playable[Math.floor(Math.random() * playable.length)];
          const uid = await el.getAttribute('data-uid');
          const b = await el.boundingBox();
          const sx = b.x + b.width / 2, sy = b.y + b.height * 0.35;
          if (!shot['card-preview']) { // 長按預覽
            await page.mouse.move(sx, sy); await page.mouse.down(); await page.waitForTimeout(550);
            if (await page.$('.peek')) await take('card-preview');
            await page.mouse.up(); await page.waitForTimeout(400);
            continue;
          }
          T('drag ' + uid);
          const invalid = snapBack === 0 && drags === 2;
          await page.mouse.move(sx, sy); await page.mouse.down();
          for (let i = 1; i <= 8; i++) { await page.mouse.move(sx + (195 - sx) * i / 8, sy - (invalid ? 20 : 330) * i / 8); await page.waitForTimeout(16); }
          if (!invalid) await take('drag');
          await page.mouse.up(); drags++;
          await page.waitForTimeout(700);
          const still = (await handUids()).includes(uid);
          if (invalid) { if (still) snapBack++; else throw new Error('invalid drop still played the card'); }
          else if (!still || await page.$('[data-pick], [data-ask], body.busy')) dragOk++;
          continue;
        }
        T('noplay');
        const acts = await page.$$('.zone-row .c.act');
        if (acts.length && Math.random() < 0.5) {
          await acts[0].click(); await page.waitForSelector('#modal .mbox', { timeout: 2000 });
          const b = await page.$$('[data-mact]'); if (b.length) await b[0].click(); else await page.click('[data-close]');
          continue;
        }
        T('end'); await page.click('#endBtn');
      }
      // 襲擊動畫：選完襲擊信徒後瞬間截圖
      if (attacks && !shot['attack'] && await page.$('.pop.atk')) await take('attack');
    } catch (e) { if (!/attached|Timeout|detached|not visible|intercepts/.test(e.message)) throw e; }
  }
  console.log(JSON.stringify({ steps, over, drags, dragOk, snapBack, attacks, shots: Object.keys(shot), errors }));
  await browser.close();
  process.exit(errors.length || !over || !dragOk || !snapBack ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
