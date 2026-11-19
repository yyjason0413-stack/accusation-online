'use strict';
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8787', OUT = process.argv[3] || '/workspace/accusation/shots/ux-desktop.png';
(async () => {
  const b = await chromium.launch(); const cx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await cx.addInitScript(() => { try { localStorage.setItem('accusation.tutorialDone', '1'); } catch {} }); const p = await cx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE); await p.fill('#nm', 'Lian'); await p.click('#ai'); await p.waitForSelector('.game');
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(250); if (await p.$('#endBtn')) break; const s = await p.$('#suggestBtn'); if (s) { await s.click(); await p.click('#confirm'); } const a = await p.$('[data-ask]'); if (a) await a.click(); const c = await p.$('#confirm:not([disabled])'); if (c) await c.click(); }
  const h = await p.$('.hand .c.playable'); if (h) await h.hover();
  await p.waitForTimeout(400); await p.screenshot({ path: OUT });
  console.log(JSON.stringify({ errors })); await b.close(); process.exit(errors.length ? 1 : 0);
})();
