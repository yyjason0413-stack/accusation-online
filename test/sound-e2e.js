'use strict';
// 音效與頁尾 E2E：node test/sound-e2e.js BASE [chromium|webkit] [autoplay|gesture] [shots]
const pw = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8787';
const BR = process.argv[3] || 'chromium', MODE = process.argv[4] || 'gesture', SHOTS = process.argv[5] || '';
const LINKS = {
  Facebook: 'https://www.facebook.com/share/1ES9zzG6EW/?mibextid=wwXIfr',
  YouTube: 'https://youtube.com/@li4n13?si=Sb0s1Rea62LwrT40',
  Patreon: 'https://www.patreon.com/Lian413?utm_campaign=creatorshare_creator',
};
const ok = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const args = BR === 'chromium' && MODE === 'autoplay' ? ['--autoplay-policy=no-user-gesture-required'] : [];
  const browser = await pw[BR].launch({ args, ...(BR === 'chromium' && MODE !== 'autoplay' ? { ignoreDefaultArgs: ['--autoplay-policy=no-user-gesture-required'] } : {}) });
  const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
  if (BR === 'chromium') opts.isMobile = true;
  const ctx = await browser.newContext(opts);
  // 模擬舊版留下的靜音值，確認不會讓新版一直靜音
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', '1'); localStorage.setItem('accusation.mute', '1'); localStorage.setItem('accusation.vol', '0'); localStorage.setItem('accusation.tutorialDone', '1'); localStorage.setItem('accusation.sfxDebug', '1'); } } catch {} });
  if (MODE === 'strict') {
    // 模擬 iOS／嚴格自動播放政策：AudioContext 一律以 suspended 起始，只有在「使用者啟動」當下呼叫 resume() 才會變成 running；
    // 並移除 navigator.audioSession，走無聲 <audio> 的備援路徑。
    await ctx.addInitScript(() => {
      const Real = window.AudioContext; window.__strict = { resumeTries: 0, resumeOk: 0, audioPlays: 0 };
      try { delete Navigator.prototype.audioSession; } catch {}
      const HP = HTMLMediaElement.prototype, rp = HP.play; HP.play = function () { window.__strict.audioPlays++; return rp.call(this).catch(() => {}); };
      class Strict extends Real {
        constructor(o) { super(o); this.__ok = false; super.suspend(); }
        get state() { return this.__ok ? super.state : 'suspended'; }
        resume() { window.__strict.resumeTries++; if (navigator.userActivation && navigator.userActivation.isActive) { this.__ok = true; window.__strict.resumeOk++; const r = super.resume(); r.then(() => this.onstatechange && this.onstatechange()); return r; } return Promise.reject(new DOMException('not allowed', 'NotAllowedError')); }
      }
      window.AudioContext = Strict; window.webkitAudioContext = Strict;
    });
  }
  const page = await ctx.newPage();
  const errors = [], sfxLog = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.text().startsWith('[sfx]')) sfxLog.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('.sitefoot');
  const out = { browser: BR, mode: MODE };
  // 頁尾
  const links = await page.$$eval('.sitefoot a', as => as.map(a => ({ label: a.getAttribute('aria-label'), href: a.href, target: a.target, rel: a.rel, svg: !!a.querySelector('svg') })));
  ok((await page.textContent('.footline')).includes('本站由勵恩架設設計，若願意支持請給予追蹤與訂閱'), 'footer text');
  for (const [k, v] of Object.entries(LINKS)) { const l = links.find(x => x.label === k); ok(l && l.href === v && l.target === '_blank' && /noopener/.test(l.rel) && l.svg, 'link ' + k); }
  out.footerLinks = links.length;
  out.defaults = await page.evaluate(() => ({ muted: localStorage.getItem('accusation.mute2'), vol: localStorage.getItem('accusation.vol'), state: window.__sfx.state }));
  ok(out.defaults.muted === '0' && out.defaults.vol == null, 'legacy mute/vol reset');
  if (SHOTS) { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(200); await page.screenshot({ path: `${SHOTS}/footer.png` }); await page.screenshot({ path: `${SHOTS}/footer-full.png`, fullPage: true }); }
  // 測試音效按鈕（真正的點擊手勢）
  await page.evaluate(() => window.scrollTo(0, 0));
  if (BR === 'chromium') await page.tap('#sndTest1'); else await page.click('#sndTest1');
  await page.waitForTimeout(500);
  out.afterTest = await page.evaluate(() => ({ state: window.__sfx.state, played: { ...window.__sfx.played }, unlocks: window.__sfx.unlocks }));
  ok(out.afterTest.state === 'running', 'AudioContext running after tap: ' + out.afterTest.state);
  ok(out.afterTest.played.ritual >= 1, 'test sound played');
  if (MODE === 'strict') { out.strict = await page.evaluate(() => window.__strict); ok(out.strict.resumeOk >= 1 && out.strict.audioPlays >= 1, 'strict unlock path'); }
  // 遊戲中音效觸發
  await page.fill('#nm', 'Lian'); await page.click('#ai'); await page.waitForSelector('.game');
  for (let i = 0; i < 160; i++) {
    await page.waitForTimeout(120);
    const p = await page.evaluate(() => window.__sfx.played);
    if ((p.draw || 0) && (p.turn || 0) && (p.play || 0)) break;
    try {
      if (await page.$('body.busy')) continue;
      if (await page.$('[data-ask]')) { await page.click('[data-ask]', { timeout: 1500 }); continue; }
      if (await page.$('#confirm:not([disabled])')) { await page.click('#confirm', { timeout: 1500 }); continue; }
      if (await page.$('#suggestBtn')) { await page.click('#suggestBtn', { timeout: 1500 }); continue; }
      const pl = await page.$('.hand .c.playable');
      if (pl && Math.random() < 0.7) { await pl.click({ timeout: 1500 }); const b = await page.$('[data-mact]'); if (b) await b.click({ timeout: 1500 }); else await page.click('[data-close]').catch(() => {}); continue; }
      if (await page.$('#endBtn')) await page.click('#endBtn', { timeout: 1500 });
    } catch {}
  }
  out.game = await page.evaluate(() => ({ calls: window.__sfx.calls, played: window.__sfx.played, state: window.__sfx.state }));
  ok((out.game.played.tap || 0) > 0 && (out.game.played.draw || 0) > 0, 'game sounds played');
  // ⋯ 選單的測試音效
  if (await page.$('#sheetMinBtn')) await page.click('#sheetMinBtn');
  await page.click('#menuBtn'); await page.waitForSelector('#sndTest2');
  const before = await page.evaluate(() => window.__sfx.played.ritual || 0);
  await page.click('#sndTest2'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__sfx.played.ritual || 0) > before, 'menu test sound');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sound-settings.png` });
  out.sfxLogSample = sfxLog.slice(0, 4);
  out.errors = errors;
  console.log(JSON.stringify(out));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
