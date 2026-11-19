'use strict';
// UX2 E2E（390×844）：新手教學、音效設定、拖曳指定目標、拖曳襲擊、公開牌組（儲存／瀏覽／使用／刪除）。
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8787';
const SHOTS = process.argv[3] || '/workspace/accusation/shots';
const PFX = process.argv[4] || 'ux2';
const VP = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = []; const cleanup = [];
const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); }); page.on('dialog', d => d.accept()); };
const ok = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
async function drag(page, from, to, onHover) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10); await page.waitForTimeout(16); }
  await page.waitForTimeout(60);
  if (onHover) await onHover();
  await page.mouse.up();
}
const ctr = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function tutorialAndSettings(browser) {
  const ctx = await browser.newContext(VP); const page = await ctx.newPage(); watch(page);
  await page.goto(BASE); await page.fill('#nm', 'Lian');
  ok(await page.$('#mute1') && await page.$('#vol1'), 'lobby sound settings');
  await page.click('#ai'); await page.waitForSelector('.game');
  // 起手調度（不換）後才會出現教學
  for (let i = 0; i < 100 && !(await page.$('#tut .tut-box')); i++) { if (await page.$('#confirm:not([disabled])')) await page.click('#confirm').catch(() => {}); await page.waitForTimeout(150); }
  await page.waitForSelector('#tut .tut-box', { timeout: 5000 });
  let steps = 1;
  await page.click('#tutNext'); steps++;
  await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${PFX}-tutorial.png` });
  while (await page.$('#tutNext')) { await page.click('#tutNext'); steps++; await page.waitForTimeout(60); }
  ok(!(await page.$('#tut')), 'tutorial closed');
  ok(await page.evaluate(() => localStorage.getItem('accusation.tutorialDone')) === '1', 'tutorial flag');
  await page.reload(); await page.waitForSelector('.game'); await page.waitForTimeout(900);
  ok(!(await page.$('#tut')), 'tutorial not shown again');
  // ⋯ 選單：音效設定 + 重看教學
  if (await page.$('#sheetMinBtn')) await page.click('#sheetMinBtn');
  await page.click('#menuBtn'); await page.waitForSelector('#mute2');
  await page.fill('#vol2', '40').catch(() => {}); await page.$eval('#vol2', e => { e.value = '40'; e.dispatchEvent(new Event('change')); });
  await page.click('#mute2'); ok(await page.evaluate(() => localStorage.getItem('accusation.mute')) === '1', 'mute persisted');
  await page.click('#mute2'); ok(await page.evaluate(() => localStorage.getItem('accusation.mute')) === '0', 'unmute persisted');
  ok(await page.evaluate(() => localStorage.getItem('accusation.vol')) === '0.4', 'volume persisted');
  await page.screenshot({ path: `${SHOTS}/${PFX}-settings.png` });
  await page.click('#tutAgain'); await page.waitForSelector('#tut .tut-box'); await page.click('#tutSkip'); ok(!(await page.$('#tut')), 'skip');
  await ctx.close();
  return { tutorialSteps: steps };
}

async function dragGame(browser) {
  const ctx = await browser.newContext(VP);
  await ctx.addInitScript(dbg => { try { localStorage.setItem('accusation.tutorialDone', '1'); localStorage.setItem('accusation.anim', 'fast'); } catch {} window.__intentDbg = dbg; }, !!process.env.DBG);
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE); await page.fill('#nm', 'Lian'); await page.click('#ai'); await page.waitForSelector('.game');
  const st = { targetDrags: 0, attackDrags: 0, steps: 0, over: false, shotT: false, shotA: false };
  while (st.steps++ < 1200) {
    await page.waitForTimeout(100);
    try {
      if (await page.$('.over')) { st.over = true; break; }
      if (await page.$('body.busy')) continue;
      const ask = await page.$$('[data-ask]');
      if (ask.length) { await page.click(`[data-ask="${ask.length - 1}"]`, { timeout: 2000 }); continue; }
      if (await page.$('[data-pick]')) {
        if (await page.$('#sheetMax')) { await page.click('#sheetMax'); continue; }
        if (await page.$('#confirm:not([disabled])')) { await page.click('#confirm'); continue; }
        if (await page.$('#suggestBtn')) { await page.click('#suggestBtn'); await page.click('#confirm'); continue; }
        const offs = await page.$$('[data-pick]:not(.on)'); for (const o of offs) { await o.click({ timeout: 2000 }); if (await page.$('#confirm:not([disabled])')) break; }
        if (await page.$('#confirm:not([disabled])')) await page.click('#confirm');
        continue;
      }
      if (await page.$('#sheetMax')) { await page.click('#sheetMax'); continue; }
      if (!(await page.$('#endBtn'))) continue;
      // 拖曳襲擊
      const atk = await page.$$('.board .c.atk'), mine = await page.$$('.side.me .c.canatk');
      if (atk.length && mine.length && st.attackDrags < 4) {
        const a = await mine[0].boundingBox(), t = await atk[0].boundingBox();
        await drag(page, ctr(a), ctr(t), async () => { if (!st.shotA && await page.$('.c.droptarget')) { st.shotA = true; await page.screenshot({ path: `${SHOTS}/${PFX}-drag-attack.png` }); } });
        st.attackDrags++; await page.waitForTimeout(600); continue;
      }
      // 拖曳手牌到對手場上的卡（指定目標）
      const play = await page.$$('.hand .c.playable'), opp = await page.$$('.side.opp .c[data-uid]');
      const spells = await page.$$('.hand .c.playable:not([data-ty="信徒"])');
      if (play.length && opp.length && st.targetDrags < 16) {
        const pool = spells.length ? spells : play;
        const a = await pool[Math.floor(Math.random() * pool.length)].boundingBox(), t = await opp[Math.floor(Math.random() * opp.length)].boundingBox();
        await drag(page, { x: a.x + a.width / 2, y: a.y + a.height * 0.35 }, ctr(t), async () => { if (!st.shotT && await page.$('.c.droptarget')) { st.shotT = true; await page.screenshot({ path: `${SHOTS}/${PFX}-drag-target.png` }); } });
        st.targetDrags++; await page.waitForTimeout(600); continue;
      }
      if (play.length && Math.random() < 0.5) { const a = await play[0].boundingBox(); await drag(page, ctr(a), { x: 195, y: 300 }); await page.waitForTimeout(500); continue; }
      await page.click('#endBtn');
    } catch (e) { if (!/attached|Timeout|detached|not visible|intercepts/.test(e.message)) throw e; }
  }
  st.intents = await page.evaluate(() => window.__intentLog.slice());
  await ctx.close();
  const k = (kind, step) => st.intents.filter(i => i.kind === kind && i.step === step).length;
  st.summary = { targetStart: k('target', 'start'), targetAuto: k('target', 'auto'), targetPre: k('target', 'preselect'), targetInvalid: k('target', 'invalid'), attackStart: k('attack', 'start'), attackAuto: k('attack', 'auto'), attackPre: k('attack', 'preselect') };
  if (process.env.DBG) console.log(JSON.stringify(st.intents));
  delete st.intents;
  ok(st.summary.targetStart > 0, 'drag-to-target happened');
  ok(st.summary.attackStart > 0, 'drag-attack happened');
  ok(st.summary.attackAuto + st.summary.attackPre >= st.summary.attackStart - 1, 'attack intent applied');
  return st;
}

async function publicDecks(browser) {
  const ctx = await browser.newContext(VP);
  await ctx.addInitScript(() => { try { localStorage.setItem('accusation.tutorialDone', '1'); } catch {} });
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE); await page.fill('#nm', 'Lian');
  await page.click('#decks'); await page.waitForSelector('[data-copy]');
  await page.click('[data-copy]'); await page.waitForSelector('#save');
  const name = 'E2E測試' + Date.now().toString(36).slice(-4);
  cleanup.push(async () => { try { await page.evaluate(async n => { const t = JSON.parse(localStorage.getItem('accusation.pubTokens') || '{}'); for (const [id, tok] of Object.entries(t)) await fetch('/api/decks/' + id, { method: 'DELETE', headers: { 'x-edit-token': tok } }); }, name); } catch {} });
  await page.fill('#dname', name);
  await page.waitForSelector('#publish'); await page.click('#publish');
  await page.waitForSelector('#pbName');
  await page.fill('#pbAuthor', 'Lian'); await page.fill('#pbDesc', '自動測試用牌組 <b>不會被當成 HTML</b>');
  await page.click('#pbGo');
  await page.waitForSelector(`.pubdeck:has-text("${name}")`, { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${PFX}-public-list.png` });
  ok(!(await page.$('.pdesc b')), 'desc escaped');
  await page.selectOption('#pfSort', 'used'); await page.waitForSelector(`.pubdeck:has-text("${name}")`);
  await page.click(`.pubdeck:has-text("${name}")`); await page.waitForSelector('.pubgrid');
  ok((await page.$$('.pubgrid .c')).length === 24, '24 cards in detail');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/${PFX}-deck-detail.png` });
  ok(await page.$('#pdDel'), 'own deck deletable');
  await page.click('#pdUse'); await page.waitForSelector('#ai');
  ok((await page.textContent('.deckpick')).includes(name), 'lobby shows public deck');
  await page.click('#ai'); await page.waitForSelector('.game .hand .c', { timeout: 10000 });
  const uses = await page.evaluate(async n => { const r = await (await fetch('/api/decks?sort=used')).json(); const d = r.decks.find(x => x.name === n); return d && d.uses; }, name);
  ok(uses >= 1, 'use counted');
  // 刪除
  if (await page.$('#sheetMinBtn')) await page.click('#sheetMinBtn');
  await page.click('#menuBtn'); await page.click('#toLobby2'); await page.waitForSelector('#decks');
  await page.click('#decks'); await page.click('#pubBrowse'); await page.click(`.pubdeck:has-text("${name}")`, { timeout: 8000 });
  await page.click('#pdDel'); await page.waitForTimeout(800);
  const left = await page.evaluate(async n => (await (await fetch('/api/decks')).json()).decks.filter(x => x.name === n).length, name);
  ok(left === 0, 'deleted');
  await ctx.close();
  return { name, uses, deleted: true };
}

(async () => {
  const browser = await chromium.launch();
  const out = {};
  if (!process.env.ONLYDRAG) { out.tutorial = await tutorialAndSettings(browser);
  out.publicDecks = await publicDecks(browser); }
  for (let g = 1; g <= 4; g++) { try { out.drag = await dragGame(browser); out.drag.games = g; break; } catch (e) { if (g === 4 || !/happened/.test(e.message)) throw e; } }
  out.errors = errors;
  console.log(JSON.stringify(out));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(async e => { for (const f of cleanup) await f(); console.error(e); console.log(JSON.stringify({ errors })); process.exit(1); });
