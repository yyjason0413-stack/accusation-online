'use strict';
// 隨機合法行動機器人（測試用）與簡易 AI（單人練習用）。
// 襲擊信徒選擇：先試非「只能單獨」的貪婪組合，再試單一的單獨襲擊者
function attackPick(g, ch) {
  const opts = ch.options;
  const solo = i => { const c = opts[i].uid != null && g.findAny(opts[i].uid); return !!(c && g.def(c).solo); };
  const idx = opts.map((o, i) => i).sort((a, b) => (opts[b].val || 0) - (opts[a].val || 0));
  const s = []; let sum = 0;
  for (const i of idx.filter(i => !solo(i))) { if (sum >= (ch.sumMin || 0) && s.length >= ch.min) break; s.push(i); sum += opts[i].val || 0; }
  if (g.validAnswer(s)) return s;
  for (const i of idx.filter(solo).reverse()) if (g.validAnswer([i])) return [i];
  return null;
}
function randomAnswer(g, ch, rng = Math.random) {
  const n = ch.options.length;
  if (ch.type === 'ask') return [Math.floor(rng() * n)];
  const ok = s => g.validAnswer ? g.validAnswer(s) : true;
  for (let t = 0; t < 60; t++) {
    const k = ch.min + Math.floor(rng() * (ch.max - ch.min + 1));
    const idx = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const s = idx.slice(0, k);
    if (ok(s)) return s;
  }
  const all = [...Array(Math.min(ch.max, n)).keys()];
  if (ok(all)) return all;
  if (ch.suggest && ok(ch.suggest)) return ch.suggest.slice();
  if (ch.info === 'attackers') { const a = attackPick(g, ch); if (a) return a; }
  const some = [...Array(ch.min).keys()];
  return some;
}

function cardValue(g, uid) {
  for (const pl of g.P) { const c = pl.all.find(x => x.uid === uid); if (c) {
    const d = g.def(c);
    if (d.type === '儀式') return 10;
    if (d.type === '信徒') return 2 + (d.volume || 0);
    if (d.type === '地點') return 4;
    return 3;
  } }
  return 0;
}

function ratKingBest(g, me) {
  let best = null, bs = -99;
  for (const f of g.followers(me)) {
    const v = g.vol(f);
    const hit = g.allFollowers().filter(x => g.vol(x) === v);
    const en = hit.filter(x => x.owner !== me).length, mine = hit.length - en;
    const ex = g.P[me].exile.filter(x => g.def({ id: x.id }).type === '信徒').length + mine;
    const left = g.allFollowers().length - hit.length;
    const win = g.stardust(me) >= 5 && ex > left;
    const sc = win ? 100 : en * 2 - mine - (f.guilty ? -1 : 0);
    if (sc > bs) { bs = sc; best = f; }
  }
  return best ? Object.assign({ score: bs }, { uid: best.uid }) : null;
}
function ratKingScore(g, me) { const b = ratKingBest(g, me); return !b ? -8 : b.score >= 100 ? 40 : b.score >= 2 ? 3 : -5; }

function aiAnswer(g, ch, me, rng = Math.random) {
  const opts = ch.options;
  if (ch.type === 'ask') {
    if (ch.info === 'action') {
      let best = -1, bi = opts.length - 1;
      opts.forEach((o, i) => {
        let s = 0;
        const c = o.uid != null ? g.P.flatMap(p => p.all).find(x => x.uid === o.uid) : null;
        const d = c ? g.def(c) : null;
        switch (o.kind) {
          case 'end': s = 0.5; break;
          case 'quick': s = c.id === 'cro01' ? (g.P[me].hand.length >= 6 ? 3 : 0.2) : c.id === 'dor01' ? 6 : c.id === 'asy01' ? 6 : c.id === 'kit01' ? (g.followers(me).some(f => f.guilty) ? 3 : 0) : c.id === 'mot01' ? (g.followers(me).filter(f => f.guilty && (g.def(f).volume || 0) >= 3).length && g.locations(me).length >= 3 ? 2 : 0) : 8; break;
          case 'attack': s = g.def(c).type === '信徒' ? 5 : 7 + (g.def(c).locationType === '聖地' ? 1 : 0); break;
          case 'crusade': s = 5 + (d.volume || 0) * 0.5; break;
          case 'ritualback': s = g.rituals(me).length < 2 ? 3 : 0.3; break;
          case 'loc': {
            if (c.id === 'fox20') s = g.locGuard(c) >= 10 && g.rituals(me).length ? 30 : 0;
            else if (c.id === 'fox19') s = g.rituals(me).length < 2 ? 6 : 0.3;
            else if (c.id === 'cro16') s = Math.floor(g.sym(me, '禁忌') / 2) && g.followers(1 - me).length ? 6 : 0;
            else if (c.id === 'fox15') s = Math.floor(g.sym(me, '知識') / 2) && g.followers(me).some(f => f.guilty) ? 5 : 0;
            else if (c.id === 'cro19') s = g.sym(me, '凋零') >= 2 && g.P[me].discard.some(x => g.def(x).type === '信徒') ? 4 : 0;
            else if (c.id === 'exi13') s = g.P[me].hand.length && g.rituals(me).length && g.P[me].discard.length >= 6 ? 3 : 0;
            else if (c.id === 'exi14') s = g.P[me].discard.filter(x => g.def(x).locationType === '荒野').length >= 2 ? 6 : 0;
            else if (c.id === 'asy17') s = Math.floor(g.sym(me, '夜幕') / 2) && g.rituals(1 - me).length ? 1 : 0;
            else if (c.id === 'asy18') s = 0.2;
            else if (c.id === 'dor16') s = Math.floor(g.sym(me, '凋零') / 2) && g.rituals(me).length && g.P[me].discard.length ? 5 : 0;
            else if (c.id === 'dor17') s = 0.2;
            else if (c.id === 'kit18') s = g.sym(me, '灰燼') >= 4 && g.followers(me).length >= 3 && g.rituals(me).length ? 25 : 0;
            else if (c.id === 'kit17') s = Math.floor(g.sym(me, '禁忌') / 3) && g.followers(me).some(f => f.guilty || g.def(f).offering) ? 3 : 0;
            else if (c.id === 'mot17') s = Math.floor(g.sym(me, '自然') / 2) && g.followers(1 - me).some(f => !f.guilty) ? 5 : 0;
            else if (c.id === 'vir13') { const n = Math.floor(g.sym(me, '知識') / 2); s = g.followers(1 - me).some(f => g.vol(f) < n) ? 7 : 0; }
            else if (c.id === 'vir14') { const pl = g.P[me]; s = Math.floor(g.sym(me, '醫藥') / 2) && pl.hand.concat(pl.conspiracy, pl.discard).some(x => g.isAttachMagic(x)) && g.allFollowers().length ? 5 : 0; }
            else if (c.id === 'cen18') s = g.P[me].discard.length && (g.P[me].hand.some(x => g.def(x).ascend || g.def(x).type === '魔法')) ? 4 : 0;
            else if (c.id === 'cen19') { const n = g.sym(me, '野性'); s = g.followers(1 - me).some(f => g.vol(f) < n) ? 7 : 0; }
            else if (c.id === 'cro20') s = g.P[me].discard.filter(x => g.def(x).type === '信徒').length >= 2 && g.P[me].discard.some(x => g.def(x).type === '魔法') ? 3 : 0;
            break;
          }
          case 'play': {
            // 依自己儀式需要的符號加分
            const need = {};
            for (const r of g.P[me].all.filter(x => g.def(x).type === '儀式' && ['hand', 'field'].includes(x.zone))) {
              for (const m of (g.def(r).effect || '').matchAll(/\((\d+)\*(\S{2})\)/g)) need[m[2]] = Math.max(need[m[2]] || 0, Number(m[1]));
              if (/地點/.test(g.def(r).effect) && d.type === '地點') s += 1.5;
              if (/夜幕信徒/.test(g.def(r).effect) && d.type === '信徒' && (d.symbols || []).includes('夜幕')) s += 1.5;
            }
            for (const sy of d.symbols || []) if (need[sy] && g.sym(me, sy) < need[sy]) s += 1.5;
            if (d.type === '教主') s = 12;
            else if (d.type === '儀式') s = g.rituals(me).length < 2 ? 6 : 1;
            else if (d.type === '地點') s += 5;
            else if (d.type === '信徒') s += 4 + (d.volume || 0) * 0.2 - (d.volume >= 4 && !d.ascend ? 1.5 : 0) + (c.id === 'cen12' ? -3 : 0);
            else if (c.id === 'asy21') s += g.followers(1 - me).filter(f => !f.guilty).length - g.followers(me).filter(f => !f.guilty).length >= 2 ? 4 : -6;
            else if (c.id === 'asy20') s += g.followers(1 - me).length >= g.followers(me).length ? 2 : -3;
            else if (c.id === 'asy24') s += g.rituals(1 - me).some(r => g.P[1 - me].under.filter(u => u.underOf === r.uid).length >= 1) ? 1 : 0;
            else if (c.id === 'asy23' || c.id === 'asy22') s += g.followers(1 - me).some(f => !f.guilty) ? 4 : -5;
            else if (c.id === 'vir24') { s += ratKingScore(g, me); }
            else if (c.id === 'vir21') s += g.allFollowers().some(f => f.guilty && f.owner !== me && g.vol(f) <= 2) ? 4 : -6;
            else if (c.id === 'vir20') s += g.followers(me).some(f => !f.guilty) ? 1 : -4;
            else if (c.id === 'vir18') s += 1;
            else if (c.id === 'cen24') s += g.stardust(me) >= g.stardustNeed(me, c) && g.sym(me, '野性') > g.followers(1 - me).length ? 50 : -2;
            else if (c.id === 'cen23') s += g.followers(1 - me).some(f => f.guilty) ? 4 : -6;
            else if (c.id === 'cen22') s += g.P[me].discard.some(x => g.def(x).type === '信徒') ? 0 : -6;
            else if (c.id === 'cen21') s += g.rituals(me).length && g.stardust(me) >= g.stardustNeed(me, c) ? 3 : 0;
            else if (c.id === 'dor21') s += g.rituals(1 - me).length ? 6 : -6;
            else if (c.id === 'dor22') s += g.rituals(me).length && g.followers(me).some(f => f.guilty) ? 3 : -4;
            else if (c.id === 'dor24') s += g.rituals(me).length ? 3 : -4;
            else if (c.id === 'kit21') s += g.stardust(me) >= 3 && g.rituals(1 - me).length ? -8 : 2;
            else if (c.id === 'kit23') s += g.rituals(me).some(r => g.ritualReady(r)) ? 9 : -5;
            else if (c.id === 'kit24') s += g.rituals(1 - me).length > g.rituals(me).length ? 4 : -6;
            else if (c.id === 'mot21') s += g.locations(1 - me).length - g.locations(me).length >= 2 ? 4 : -5;
            else if (c.id === 'mot22') s += g.followers(1 - me).length - g.followers(me).length >= 2 ? 4 : -5;
            else s += g.followers(1 - me).length || c.id === 'fox23' ? 3 : 1;
            break;
          }
        }
        s += rng() * 1.5;
        if (s > best) { best = s; bi = i; }
      });
      return [bi];
    }
    if (ch.info === 'counter') {
      const elig = opts.map((o, i) => ({ o, i })).filter(x => x.o.key);
      if (!elig.length) return [0];
      const isRitual = /執行儀式/.test(ch.prompt);
      if (isRitual || rng() < 0.7) {
        elig.sort((a, b) => cardValue(g, a.o.key) - cardValue(g, b.o.key));
        return [elig[0].i];
      }
      return [0];
    }
    if (ch.info === 'ritual') return [0];
    if (ch.info === 'order') { const i = opts.findIndex(o => /敵方棄/.test(o.label)); return [Math.max(0, i)]; }
    if (ch.info === 'guard') {
      // 駐守在守護最高的地點（較易滿足返靈舞/遺忘神龕）
      return [0];
    }
    // 其他 ask：偏好第一個有卡的選項（例如魂燈棄最低價值的信徒）
    const withCard = opts.map((o, i) => ({ o, i })).filter(x => x.o.uid);
    if (withCard.length) { withCard.sort((a, b) => cardValue(g, a.o.uid) - cardValue(g, b.o.uid)); return [withCard[0].i]; }
    return [0];
  }
  // pick
  if (ch.info === 'mulligan') { // 《回歸原始》在手上會讓遊戲開始時棄光其他手牌 → 放回牌庫底
    const i = opts.findIndex(o => o.cardId === 'mot03');
    return i >= 0 ? [i] : [];
  }
  if (ch.info === 'attackers') {
    const s = attackPick(g, ch);
    if (s) return s;
    return randomAnswer(g, ch, rng);
  }
  // 紫靈山：飛升——找價值最低的合法組合
  if (ch.info === 'ascend') { // 飛升：張數固定，找價值最低（罪惡、無用的先）的合法組合
    const val = i => { const o = opts[i]; const c = g.P[me].field.find(x => x.uid === o.uid); if (!c) return 0; const d = g.def(c); return (d.type === '儀式' ? 30 : d.type === '地點' ? 6 : cardValue(g, o.uid)) - (c.guilty ? 4 : 0) + (d.type === '魔法' ? -1 : 0); };
    const order = opts.map((o, i) => i).sort((a, b) => val(a) - val(b));
    let best = null, bv = Infinity, tries = 0;
    const rec = (start, cur, v) => {
      if (++tries > 20000 || v >= bv) return;
      if (cur.length === ch.min) { if (g.validAnswer(cur)) { bv = v; best = cur.slice(); } return; }
      for (let k = start; k < order.length; k++) { cur.push(order[k]); rec(k + 1, cur, v + val(order[k])); cur.pop(); }
    };
    rec(0, [], 0);
    if (best) return best;
  }
  // 疫病中心：除外自己的信徒（感染的聖女／解剖師／鼠王）
  if (/除外你場上/.test(ch.prompt)) {
    if (/鼠王/.test(ch.prompt)) { const b = ratKingBest(g, me); const i = opts.findIndex(o => o.uid === (b && b.uid)); if (i >= 0) return [i]; }
    const sorted = opts.map((o, i) => ({ i, v: cardValue(g, o.uid) - (g.P[me].field.find(x => x.uid === o.uid && x.guilty) ? 3 : 0) })).sort((a, b) => a.v - b.v);
    let k = ch.min;
    const doom = g.P[me].all.some(x => x.id === 'vir02' && ['hand', 'field'].includes(x.zone)) && g.P[me].exile.filter(x => g.def({ id: x.id }).type === '信徒').length < 4;
    if (/感染的聖女/.test(ch.prompt)) k = Math.min(ch.max, doom ? ch.max : Math.floor(g.P[me].discard.filter(x => g.def(x).locationType === '荒野').length / 2), sorted.length);
    k = Math.max(ch.min, Math.min(k, ch.max));
    return sorted.slice(0, k).map(x => x.i);
  }
  if (/附著/.test(ch.prompt) && ch.type === 'pick') {
    const own = /不會變為罪惡/.test(ch.prompt) || (/救贖/.test(ch.prompt) && g.stardust(me) >= 3);
    const sc = opts.map((o, i) => { const c = g.P.flatMap(p => p.field).find(x => x.uid === o.uid); return { i, s: (own ? (o.owner === me ? 10 : -10) : (o.owner !== me ? 10 : -10)) + (c ? (own ? g.vol(c) : g.vol(c) * 0.3) - (c.guilty ? 2 : 0) : 0) + rng() * 0.3 }; }).sort((a, b) => b.s - a.s);
    if (sc.length) return [sc[0].i];
  }
  const scored = opts.map((o, i) => {
    let s = 0;
    if (ch.harm === true) s = (o.owner !== me ? 10 : -10) + cardValue(g, o.uid) * 0.1;
    else if (ch.harm === false) s = (o.owner === me ? 5 : -5) + (ch.info === 'discard' || /棄置/.test(ch.prompt) || /破壞你場上/.test(ch.prompt) ? -cardValue(g, o.uid) : cardValue(g, o.uid));
    return { i, s: s + rng() * 0.5 };
  }).sort((a, b) => b.s - a.s);
  let k = ch.max;
  if (ch.harm === true) k = Math.max(ch.min, scored.filter(x => x.s > 0).length);
  else if (ch.harm === false && ch.min === 0) k = Math.max(ch.min, scored.filter(x => x.s > 0).length);
  k = Math.min(Math.max(k, ch.min), ch.max);
  for (let kk = k; kk >= ch.min; kk--) {
    const s = scored.slice(0, kk).map(x => x.i);
    if (g.validAnswer(s)) return s;
  }
  return randomAnswer(g, ch, rng);
}

module.exports = { randomAnswer, aiAnswer };
