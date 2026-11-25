// Browser tests for Kishimi. Usage: node tools/test.js [outdir]
// Generates its own test pictures and a short video inside the browser,
// loads them through the real file inputs, and checks each mode's maths
// on read-back pixels. Screenshots and a contact sheet go to outdir.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, '..', '.test-out');
fs.mkdirSync(OUT, { recursive: true });
const PAGE = 'file://' + path.join(__dirname, '..', 'index.html');
const results = [];
const test = (label, ok, info = '') => { results.push([ok ? 'ok  ' : 'FAIL', label, info]); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${info ? '  (' + info + ')' : ''}`); };

const { fixtures } = require('./fixtures.js');

// render once with the given settings and read the canvas back at 96px
const GRAB = `(cfg)=>{const K=window.__kishimi,S=K.S;
  cfg.stages.forEach((c,i)=>{const st=S.stages[i];if(c.mode&&c.mode!==st.mode)K.applyMode(st,c.mode);Object.assign(st,c,{mot:'none'});if(c.p)st.p=c.p.slice();});
  if(cfg.post)Object.assign(S.post,cfg.post);
  for(const st of S.stages)st.tv=st.t;
  for(let i=0;i<(cfg.frames||3);i++)K.E.render(S,K.clock);
  const cv=document.getElementById('cv'),n=96,c=document.createElement('canvas');c.width=n;c.height=n;const g=c.getContext('2d');g.drawImage(cv,0,0,n,n);
  if(cfg.crop){const [fx,fy]=cfg.crop;g.clearRect(0,0,n,n);g.drawImage(cv,Math.round(cv.width*fx)-48,Math.round(cv.height*fy)-48,96,96,0,0,n,n)}
  const d=g.getImageData(0,0,n,n).data,a=[];for(let i=0;i<d.length;i+=4)a.push(d[i]/255,d[i+1]/255,d[i+2]/255);
  let thumb=null;if(cfg.thumb){const t=document.createElement('canvas'),k=260/Math.max(cv.width,cv.height);t.width=Math.round(cv.width*k);t.height=Math.round(cv.height*k);t.getContext('2d').drawImage(cv,0,0,t.width,t.height);thumb=t.toDataURL('image/jpeg',.85)}
  return {a,thumb}}`;
// a collage set-up: black ground, no depth effects, fragments with plain defaults
const COL = `(cfg)=>{const K=window.__kishimi,S=K.S,C=S.col;
  Object.assign(C,{ground:'black',depth:0,haze:0,shadow:0,edge:0,cam:0,stop:false,reroll:false,touched:true,init:true},cfg.col||{});
  C.frags=(cfg.frags||[]).map((o,i)=>{const f=Object.assign(K.CL.newFrag(i),{life:'still',appear:'none',move:'none',content:'live',blend:'normal',feather:.004,z:0,rot:0,born:K.cc},o);if(o.bornAgo!=null)f.born=K.cc-o.bornAgo;return f});
  C.sel=-1;K.buildCol();for(let i=0;i<(cfg.frames||2);i++)K.renderNow();return true}`;
// an 8x8 average of a screen region [x, y, w, h] (fractions, top-left origin)
const REGION = `(r,N=8)=>{const cv=document.getElementById('cv'),x=Math.round(cv.width*r[0]),y=Math.round(cv.height*r[1]),w=Math.max(8,Math.round(cv.width*r[2])),h=Math.max(8,Math.round(cv.height*r[3]));
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.drawImage(cv,x,y,w,h,0,0,w,h);const d=g.getImageData(0,0,w,h).data,a=new Array(N*N*3).fill(0),n=new Array(N*N).fill(0);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const b=Math.min(N-1,Math.floor(j*N/h))*N+Math.min(N-1,Math.floor(i*N/w)),o=(j*w+i)*4;a[b*3]+=d[o];a[b*3+1]+=d[o+1];a[b*3+2]+=d[o+2];n[b]++}
  return a.map((v,k)=>v/n[Math.floor(k/3)]/255)}`;
const rgb = (a) => { const m = [0, 0, 0]; for (let i = 0; i < a.length; i += 3) { m[0] += a[i]; m[1] += a[i + 1]; m[2] += a[i + 2]; } return m.map((v) => v / (a.length / 3)); };
const maxd = (x, y) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i])); return m; };
const mad = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]); return s / x.length; };
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;

function logicTests() {
  const CL = require('../src/collage.js')();
  let seed = 7; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const ctx = { asp: 4 / 3, H: 720, cc: 0, hasMix: true, avail: ['a', 'b'], dim: (k) => ({ a: [1600, 1200], b: [1080, 1350], g: [960, 720], fb: [960, 720] })[k] || null };
  const all = { count: 1, src: 1, cut: 1, shape: 1, place: 1, depth: 1, size: 1, appear: 1, motion: 1, content: 1, blend: 1, ground: 1 };
  let bad = 0, arrs = new Set(), shapes = new Set(), appears = new Set();
  for (let i = 0; i < 300; i++) {
    const st = { frags: [] }; const r = CL.roll(st, all, ctx, rng); arrs.add(r.arr);
    for (const f of st.frags) { shapes.add(f.shape); appears.add(f.appear); const [x, y, w, h] = f.rect; if (x < -1e-9 || y < -1e-9 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9 || w <= 0 || h <= 0) bad++; }
    const pk = CL.pack(CL.frame(st, rng() * 50, ctx), ctx); for (const v of pk.F) if (!Number.isFinite(v)) bad++;
  }
  test('300 dice rolls: every cut stays inside its source, nothing is NaN', bad === 0, `${bad} bad`);
  test('the dice reach every arrangement, shape and appearance', arrs.size === CL.ARRS.length && shapes.size === CL.SHAPES.length && appears.size === CL.APPEARS.length, `${arrs.size}/${CL.ARRS.length} · ${shapes.size}/${CL.SHAPES.length} · ${appears.size}/${CL.APPEARS.length}`);
  // one roll keeps a rule: most fragments share the main shape (outliers are the exception)
  let share = 0, n = 0;
  for (let i = 0; i < 100; i++) { const st = { frags: [] }; const r = CL.roll(st, Object.assign({}, all, { arr: 'scatter' }), ctx, rng); share += st.frags.filter((f) => f.shape === r.shape).length / st.frags.length; n++; }
  test('a roll keeps a rule: about three quarters of the fragments share its main shape', share / n > .65 && share / n < .92, (share / n).toFixed(2));
  // 継ぎ re-tiles the source: neighbouring cells cut neighbouring source rectangles
  const st = { frags: [] }; CL.roll(st, Object.assign({}, all, { arr: 'joiner', count: 0 }), ctx, rng);
  st.frags.length = 0; for (let i = 0; i < 6; i++) st.frags.push(CL.freshFrag(st));
  CL.roll(st, { arr: 'joiner', src: 1, cut: 1, place: 1 }, ctx, rng);
  const cover = st.frags.reduce((s, f) => s + f.rect[2] * f.rect[3], 0);
  test('継ぎ cuts the cells of one source that together cover all of it (3×2 cells, 4:3 on 4:3)', new Set(st.frags.map((f) => f.src)).size === 1 && Math.abs(cover - 1) < .01, `area ${cover.toFixed(3)}`);
  const f = Object.assign(CL.newFrag(0), { life: 'cycle', appear: 'iris', period: 10, phase: 0, born: 0 });
  const ps = [0, 1, 4, 7.7, 9].map((t) => CL.life(f, t).p);
  test('a cycling fragment appears, holds, leaves and is gone', ps[0] === 0 && ps[1] > .5 && ps[2] === 1 && ps[3] > 0 && ps[3] < 1 && ps[4] === 0, ps.map((v) => v.toFixed(2)).join(' '));
}

(async () => {
  logicTests();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const fx = await fixtures(browser);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(PAGE);
  await page.waitForFunction(() => !!window.__kishimi);
  test('empty state shows the prompt and disables saving', await page.evaluate(() => !document.getElementById('empty').hidden && document.getElementById('still').disabled));
  await page.screenshot({ path: path.join(OUT, 'empty.png') });

  await page.setInputFiles('#file0', fx.land);
  await page.setInputFiles('#file1', fx.face);
  await page.waitForFunction(() => window.__kishimi.E.slots[0].ready && window.__kishimi.E.slots[1].ready, null, { timeout: 10000 });
  const size = await page.evaluate(() => window.__kishimi.E.size);
  test('frame follows A (1600×1200 → 1080×810)', size[0] === 1080 && size[1] === 810, size.join('×'));
  test('stage 2 stays off with only A and B', await page.evaluate(() => !window.__kishimi.S.stages[1].on));
  test('the first material lays out a first collage', await page.evaluate(() => window.__kishimi.S.col.frags.length >= 3));
  await page.evaluate(() => { const C = window.__kishimi.S.col; C.frags = []; C.touched = true; C.sel = -1; window.__kishimi.buildCol(); });
  await page.click('#out button[data-v="720"]'); // software GL is slow; the maths does not depend on size

  const grab = (stages, extra = {}) => page.evaluate(`(${GRAB})(${JSON.stringify({ stages, ...extra })})`);
  const st = (mode, t, p, more = {}) => [{ mode, t, P: 'a', Q: 'b', ...(p ? { p } : {}), ...more }];
  const Pref = (await grab(st('thresh', 0, [0, .08, 0]))).a;
  const Qref = (await grab(st('thresh', 1, [0, .08, 0]))).a;
  test('A and B are different pictures', mad(Pref, Qref) > .1, mad(Pref, Qref).toFixed(3));

  // the ends of t are the pictures themselves where a mode defines them so
  const ends = [
    ['flow', 0, [.45, .5, .12], 'P'], ['flow', 1, [.45, .5, .12], 'Q'],
    ['disp', 0, [.45, .35, .3], 'P'], ['freq', 0, [.35, .6, 0], 'P'],
    ['cells', 0, [.35, 0, 0], 'P'], ['cells', 1, [.35, 0, 0], 'Q'],
    ['bands', 0, [.4, 0, 0], 'P'], ['bands', 1, [.4, 0, 0], 'Q'],
    ['screen', 0, [.35, 0, 0], 'P'], ['screen', 1, [.35, 0, 0], 'Q'],
    ['diff', 0, [.3, .5, .15], 'P'], ['time', .8, [.7, 0, 0], 'P'],
  ];
  for (const [m, t, p, which] of ends) {
    const g = (await grab(st(m, t, p, m === 'time' ? { F: 'vert' } : {}))).a, d = mad(g, which === 'P' ? Pref : Qref);
    test(`${m} at t=${t} gives ${which}${m === 'time' ? ' (still picture: no past to show)' : ''}`, d < .012, d.toFixed(4));
  }
  // every mode at t=.5 is neither picture and not an average of the two
  const sheet = [];
  const avg = Pref.map((v, i) => (v + Qref[i]) / 2);
  for (const m of ['flow', 'thresh', 'disp', 'freq', 'cells', 'bands', 'screen', 'chan', 'time', 'diff']) {
    const cfg = st(m, .5, null, m === 'chan' ? { F: 'vert' } : {});
    const r = await grab(cfg, { thumb: true });
    sheet.push([m, r.thumb]);
    const dp = mad(r.a, Pref), dq = mad(r.a, Qref), da = mad(r.a, avg);
    const isTime = m === 'time', isFreq = m === 'freq';
    test(`${m} at t=.5 ${isTime ? 'shows P unchanged without motion' : isFreq ? 'looks like A from afar (96px), unlike B' : 'is neither A nor B nor their average'}`,
      isTime ? dp < .012 : isFreq ? (dp < .05 && dq > .1) : (dp > .02 && dq > .02 && da > .02 && mean(r.a) > .03), `vs A ${dp.toFixed(3)} · vs B ${dq.toFixed(3)} · vs avg ${da.toFixed(3)}`);
  }
  {
    // 1:1 crop around B's right eye, where B has fine detail
    const at = { crop: [.62, .3] };
    const cP = (await grab(st('thresh', 0, [0, .08, 0]), at)).a, cQ = (await grab(st('thresh', 1, [0, .08, 0]), at)).a;
    const cF = (await grab(st('freq', .5, null), at)).a;
    test('周波 at t=.5 differs from both up close (1:1 crop at B\'s eye)', mad(cF, cP) > .02 && mad(cF, cQ) > .02, `vs A ${mad(cF, cP).toFixed(3)} · vs B ${mad(cF, cQ).toFixed(3)}`);
    const d = [];
    for (const t of [.2, .5, .8]) d.push(mad((await grab(st('thresh', t, [0, .08, 0]))).a, Qref));
    test('threshold moves steadily from A to B as t rises', d[0] > d[1] && d[1] > d[2], d.map((x) => x.toFixed(3)).join(' > '));
    const f = [];
    for (const t of [.25, .5, .75]) f.push(mad((await grab(st('flow', t, [.45, .5, .12]))).a, Qref));
    test('flow moves steadily from A to B as t rises', f[0] > f[1] && f[1] > f[2], f.map((x) => x.toFixed(3)).join(' > '));
    const s0 = (await grab(st('flow', .5, [.45, .5, .12]))).a, s1 = (await grab(st('flow', .5, [.45, .5, 1]))).a;
    test('flow\'s 混ざり方 changes switching into dissolving', mad(s0, s1) > .01, mad(s0, s1).toFixed(3));
    const c0 = (await grab(st('chan', 0, [0, 0, 0], { F: 'b' }))).a;
    let rOk = 0, gOk = 0;
    for (let i = 0; i < c0.length; i += 3) { rOk += Math.abs(c0[i] - Pref[i]); gOk += Math.abs(c0[i + 1] - Qref[i + 1]); }
    test('色層 at t=0 takes red from P and green from Q', rOk / (c0.length / 3) < .012 && gOk / (c0.length / 3) < .012, `${(rOk / (c0.length / 3)).toFixed(4)} ${(gOk / (c0.length / 3)).toFixed(4)}`);
    const dP = (await grab(st('disp', .8, [.6, .35, .3], { F: 'b' }))).a, dN = (await grab(st('disp', .8, [.6, .35, .3], { F: 'noise' }))).a;
    test('変位 depends on what pushes', mad(dP, dN) > .02, mad(dP, dN).toFixed(3));
  }

  // video in C: stage 2 joins automatically and the picture moves
  await page.setInputFiles('#file2', fx.vid);
  await page.waitForFunction(() => window.__kishimi.E.slots[2].ready, null, { timeout: 10000 });
  test('loading C switches stage 2 on as 一段 × C', await page.evaluate(() => { const s = window.__kishimi.S.stages[1]; return s.on && s.P === 's1' && s.Q === 'c'; }));
  await page.evaluate(() => window.__kishimi.S.stages[1].on = false);
  const v1 = (await grab([{ mode: 'thresh', t: 0, P: 'c', Q: 'b', p: [0, .08, 0] }])).a;
  await page.waitForTimeout(400);
  const v2 = (await grab([{ mode: 'thresh', t: 0, P: 'c', Q: 'b', p: [0, .08, 0] }])).a;
  test('video frames reach the picture', mad(v1, v2) > .01, mad(v1, v2).toFixed(3));
  // time mode on the video: let the history fill, then compare no delay with full delay
  await page.evaluate(() => { const K = window.__kishimi, s = K.S.stages[0]; K.applyMode(s, 'time'); Object.assign(s, { P: 'c', Q: 'b', F: 'vert', t: 1, mot: 'none', p: [.7, 1, 0] }); });
  await page.waitForTimeout(2200);
  const tm = await page.evaluate(`(()=>{const K=window.__kishimi,S=K.S,s=S.stages[0],cv=document.getElementById('cv');const rd=()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.drawImage(cv,0,0,64,64);return Array.from(g.getImageData(0,0,64,64).data)};
    s.t=0;s.tv=0;K.E.render(S,K.clock);const a=rd();s.t=1;s.tv=1;K.E.render(S,K.clock);const b=rd();
    let top=0,bot=0;for(let y=0;y<64;y++)for(let x=0;x<64;x++)for(let k=0;k<3;k++){const i=(y*64+x)*4+k,d=Math.abs(a[i]-b[i])/255;if(y<28)top+=d;else if(y>35)bot+=d}return [top/(28*64*3),bot/(28*64*3)]})()`);
  test('時間 (縦, two steps) delays the top half and leaves the bottom half at now', tm[0] > .02 && tm[1] < .004, `top ${tm[0].toFixed(3)} · bottom ${tm[1].toFixed(3)}`);
  await page.evaluate(() => { const K = window.__kishimi; K.applyMode(K.S.stages[0], 'flow'); Object.assign(K.S.stages[0], { P: 'a', Q: 'b' }); });

  // two stages and feedback
  const one = (await grab([{ mode: 'flow', t: .5, P: 'a', Q: 'b' }])).a;
  const two = (await grab([{ mode: 'flow', t: .5, P: 'a', Q: 'b' }, { on: true, mode: 'screen', t: .5, P: 's1', Q: 'c' }])).a;
  test('stage 2 changes the result', mad(one, two) > .02, mad(one, two).toFixed(3));
  await page.evaluate(() => { window.__kishimi.S.stages[1].on = false; });
  const fb0 = (await grab([{ mode: 'cells', t: .5, P: 'a', Q: 'b' }], { post: { amt: 0 } })).a;
  const fb1 = (await grab([{ mode: 'cells', t: .5, P: 'a', Q: 'b' }], { post: { amt: .9, blend: 0, zoom: .8, rot: .6 }, frames: 30 })).a;
  test('残像 folds earlier frames in', mad(fb0, fb1) > .02, mad(fb0, fb1).toFixed(3));
  const fbIn = (await grab([{ mode: 'thresh', t: .5, P: 'fb', Q: 'b', F: 'noise' }], { post: { amt: 0 }, frames: 20 })).a;
  test('「前」as an input runs without errors and is not black', mean(fbIn) > .03, mean(fbIn).toFixed(3));
  await page.evaluate(() => Object.assign(window.__kishimi.S.post, { amt: 0, zoom: .5, rot: .5 }));


  // ---------- fragments ----------
  const col = (cfg) => page.evaluate(`(${COL})(${JSON.stringify(cfg)})`);
  const region = (r, n = 8) => page.evaluate(`(${REGION})(${JSON.stringify(r)},${n})`);
  const mid = [.44, .44, .12, .12];
  const TEAL = { src: 'b', rect: [0, 0, 1, .12], x: .5, y: .5, s: .3 }, RED = { src: 'b', rect: [0, .86, 1, .14], x: .5, y: .5, s: .3 };
  await col({ frags: [TEAL] }); const top = rgb(await region(mid));
  await col({ frags: [RED] }); const bot = rgb(await region(mid));
  test('a cut from the top of B shows B\'s top (teal), from the bottom B\'s bottom (red/white)', top[1] > top[0] + .12 && bot[0] > bot[1] + .1, `top rgb ${top.map((v) => v.toFixed(2))} · bottom ${bot.map((v) => v.toFixed(2))}`);
  await col({ col: { stop: true }, frags: [{ ...TEAL, life: 'once', appear: 'iris', period: 8, bornAgo: 0 }] }); const hid = rgb(await region(mid));
  await col({ col: { stop: true }, frags: [{ ...TEAL, life: 'once', appear: 'iris', period: 8, bornAgo: 100 }] }); const shown = rgb(await region(mid));
  test('a fragment that has not appeared yet is not there; once appeared it is', hid[0] + hid[1] + hid[2] < .03 && shown[1] > .2, `before ${hid.map((v) => v.toFixed(2))} · after ${shown.map((v) => v.toFixed(2))}`);
  await col({ frags: [{ ...TEAL, z: 0 }, { ...RED, z: 1 }] }); const near1 = rgb(await region(mid));
  await col({ frags: [{ ...TEAL, z: 1 }, { ...RED, z: 0 }] }); const near2 = rgb(await region(mid));
  test('the nearer fragment covers the farther one', near1[1] > near1[0] && near2[0] > near2[1], `teal near ${near1.map((v) => v.toFixed(2))} · red near ${near2.map((v) => v.toFixed(2))}`);
  {
    const blendBase = { src: 'b', rect: [.2, .2, .6, .6], x: .5, y: .5, s: .55 };
    await page.evaluate(() => { const K = window.__kishimi, s = K.S.stages[0]; K.S.stages[1].on = false; K.applyMode(s, 'thresh'); Object.assign(s, { P: 'a', Q: 'b', t: 0, tv: 0, mot: 'none', p: [0, .08, 0] }); });
    const zone = [.35, .3, .3, .4];
    await col({ col: { ground: 'mix' }, frags: [blendBase] }); const normal = await region(zone);
    const same = [];
    for (const [b] of (await page.evaluate(() => window.__kishimi.CL.BLENDS)).slice(1)) { await col({ col: { ground: 'mix' }, frags: [{ ...blendBase, blend: b }] }); if (mad(await region(zone), normal) < .02) same.push(b); }
    test('every way of laying a fragment over the ground looks different from 普通', same.length === 0, same.join(',') || '9 ways');
    await col({ col: { ground: 'mix', stop: true }, frags: [{ ...blendBase, life: 'once', appear: 'iris', period: 8, bornAgo: 100 }] }); const full = await region(zone, 32);
    const flat = [];
    for (const [a] of (await page.evaluate(() => window.__kishimi.CL.APPEARS)).slice(1)) {
      let differs = false;
      for (const ago of a === 'flicker' ? [.2, .5, .9, 1.3, 1.7] : [1]) { await col({ col: { ground: 'mix', stop: true }, frags: [{ ...blendBase, life: 'once', appear: a, period: 8, bornAgo: ago }] }); if (mad(await region(zone, 32), full) > .01) differs = true; }
      if (!differs) flat.push(a);
    }
    test('every way of appearing is visible half-way through', flat.length === 0, flat.join(',') || '12 ways');
    const shp = [];
    await col({ col: { ground: 'mix' }, frags: [blendBase] }); const rect = await region([.2, .15, .6, .7], 32);
    for (const sh of ['ellipse', 'torn', 'skew', 'bright', 'dark']) { await col({ col: { ground: 'mix' }, frags: [{ ...blendBase, shape: sh }] }); if (maxd(await region([.2, .15, .6, .7], 32), rect) < .08) shp.push(sh); }
    test('every cut shape differs from the rectangle', shp.length === 0, shp.join(',') || '5 shapes');
  }
  // frozen versus live from the video in C
  await col({ col: { ground: 'black' }, frags: [{ src: 'c', rect: [0, 0, 1, 1], x: .25, y: .5, s: .35, content: 'frozen' }, { src: 'c', rect: [0, 0, 1, 1], x: .75, y: .5, s: .35, content: 'live' }], frames: 3 });
  const L1 = await region([.12, .4, .2, .2]), R1 = await region([.68, .4, .2, .2]);
  await page.waitForTimeout(700);
  const L2 = await region([.12, .4, .2, .2]), R2 = await region([.68, .4, .2, .2]);
  test('a frozen fragment holds its frame while a live one plays', mad(L1, L2) < .006 && mad(R1, R2) > .02, `frozen ${mad(L1, L2).toFixed(4)} · live ${mad(R1, R2).toFixed(3)}`);
  // stopping motion
  await col({ frags: [{ src: 'a', move: 'flow', speed: 1, x: .5, y: .5, s: .3 }], col: { stop: true } });
  const x1 = await page.evaluate(() => window.__kishimi.recs[0].q.x); await page.waitForTimeout(400); const x2 = await page.evaluate(() => window.__kishimi.recs[0].q.x);
  await page.evaluate(() => { window.__kishimi.S.col.stop = false; }); await page.waitForTimeout(400); const x3 = await page.evaluate(() => window.__kishimi.recs[0].q.x);
  test('動きを止める holds a flowing fragment; releasing it lets it go on', x1 === x2 && x3 !== x2, `${x1.toFixed(4)} → ${x2.toFixed(4)} → ${x3.toFixed(4)}`);
  // dragging on the screen
  await col({ frags: [{ src: 'a', rect: [.25, .25, .5, .5], x: .5, y: .5, s: .4 }] });
  const cr = await page.evaluate(() => { const r = document.getElementById('cv').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.move(cr.x + cr.w / 2, cr.y + cr.h / 2); await page.mouse.down(); await page.mouse.move(cr.x + cr.w / 2 + 100, cr.y + cr.h / 2 + 40, { steps: 6 }); await page.mouse.up();
  const dragged = await page.evaluate(() => { const C = window.__kishimi.S.col; return { sel: C.sel, x: C.frags[0].x, y: C.frags[0].y }; });
  test('dragging a fragment on the screen selects and moves it', dragged.sel === 0 && Math.abs(dragged.x - (.5 + 100 / cr.w)) < .01 && Math.abs(dragged.y - (.5 + 40 / cr.h)) < .01, `x ${dragged.x.toFixed(3)} y ${dragged.y.toFixed(3)}`);
  await page.locator('#col .cut').scrollIntoViewIfNeeded();
  const bx = await page.locator('#col .cutbox').boundingBox(), cw = (await page.locator('#col .cut').boundingBox()).width;
  await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.down(); await page.mouse.move(bx.x + bx.width / 2 + 30, bx.y + bx.height / 2, { steps: 4 }); await page.mouse.up();
  const rx = await page.evaluate(() => window.__kishimi.S.col.frags[0].rect[0]);
  test('dragging the cut box changes where the fragment is cut from', Math.abs(rx - (.25 + 30 / cw)) < .015, `x ${rx.toFixed(3)} (expected ${(.25 + 30 / cw).toFixed(3)})`);
  await page.screenshot({ path: path.join(OUT, 'editor.png'), fullPage: true });
  // dice: only the checked items change
  await page.evaluate(() => { const K = window.__kishimi; for (const k in K.S.dice.cats) K.S.dice.cats[k] = true; K.diceRoll(false); });
  const fBefore = await page.evaluate(() => JSON.stringify(window.__kishimi.S.col.frags.map((f) => [f.x, f.y, f.s, f.rect, f.src, f.blend])));
  await page.evaluate(() => { const K = window.__kishimi; for (const k in K.S.dice.cats) K.S.dice.cats[k] = k === 'appear'; K.buildCol(); });
  await page.click('#roll');
  const fAfter = await page.evaluate(() => JSON.stringify(window.__kishimi.S.col.frags.map((f) => [f.x, f.y, f.s, f.rect, f.src, f.blend])));
  test('with only 出現 checked, the dice leave places, cuts, sources and blends alone', fBefore === fAfter);
  await page.evaluate(() => { const K = window.__kishimi; for (const k in K.S.dice.cats) K.S.dice.cats[k] = true; });
  const r0 = await page.evaluate(() => window.__kishimi.S.dice.rolls);
  await page.click('#dice button[data-v="3"]'); await page.waitForTimeout(3700);
  const r1 = await page.evaluate(() => window.__kishimi.S.dice.rolls);
  await page.click('#dice button[data-v="0"]');
  test('振り続ける rolls again by itself', r1 > r0, `${r0} → ${r1}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'collage.png') });

  // UI: clicking a mode, the swap button, shake, aspect
  await page.evaluate(() => { const s = window.__kishimi.S.stages[0]; s.mot = 'pp'; window.__kishimi.buildStage(0); });
  await page.click('#st0 .mode:nth-child(7)');
  test('clicking 網 selects it', await page.evaluate(() => window.__kishimi.S.stages[0].mode === 'screen'));
  const before = await page.evaluate(() => { const s = window.__kishimi.S.stages[0]; return [s.P, s.Q]; });
  await page.click('#st0 .cardHead .btn');
  const after = await page.evaluate(() => { const s = window.__kishimi.S.stages[0]; return [s.P, s.Q]; });
  test('⇄ swaps P and Q', after[0] === before[1] && after[1] === before[0], `${before.join('/')} → ${after.join('/')}`);
  for (let i = 0; i < 6; i++) { await page.click('#shake'); await page.waitForTimeout(60); }
  test('揺さぶる reports what it moved', (await page.textContent('#msg')).startsWith('揺さぶり'));
  await page.click('#out button[data-v="9:16"]');
  const s916 = await page.evaluate(() => window.__kishimi.E.size);
  test('9:16 at 720 gives 406×720', s916[0] === 406 && s916[1] === 720, s916.join('×'));
  await page.click('#out button[data-v="a"]');
  // a loop that only sees 前 must not go black when the frame is rebuilt
  await page.evaluate(() => { const K = window.__kishimi, s = K.S.stages[0]; K.S.col.frags = []; K.S.col.ground = 'mix'; K.S.stages[1].on = false; K.buildStage(1); K.buildCol(); K.applyMode(s, 'disp'); Object.assign(s, { P: 'fb', F: 'noise' }); K.buildStage(0); });
  await page.click('#out button[data-v="1:1"]'); await page.waitForTimeout(300);
  const lum = await page.evaluate(() => { const cv = document.getElementById('cv'), c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); g.drawImage(cv, 0, 0, 32, 32); const d = g.getImageData(0, 0, 32, 32).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (32 * 32 * 3); });
  test('a loop on 前 alone survives a resize (not black)', lum > 20, `mean ${lum.toFixed(1)}`);
  await page.click('#out button[data-v="a"]');
  await page.evaluate(() => { const K = window.__kishimi, s = K.S.stages[0]; K.applyMode(s, 'cells'); Object.assign(s, { P: 'a', Q: 'b', F: 'noise' }); K.buildStage(0); });

  // saving
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#still')]);
  const stillPath = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(stillPath);
  test('静止画 saves a PNG with a picture in it', /\.png$/.test(dl.suggestedFilename()) && fs.statSync(stillPath).size > 40000, `${dl.suggestedFilename()} ${fs.statSync(stillPath).size} bytes`);
  await page.click('#rec'); await page.waitForTimeout(1600);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#rec')]);
  const recPath = path.join(OUT, dl2.suggestedFilename()); await dl2.saveAs(recPath);
  test('録画 saves a video', /\.(mp4|webm)$/.test(dl2.suggestedFilename()) && fs.statSync(recPath).size > 10000, `${dl2.suggestedFilename()} ${fs.statSync(recPath).size} bytes`);

  // live run for a while with motion on, then screenshots
  await page.evaluate(() => { const K = window.__kishimi; K.applyMode(K.S.stages[0], 'flow'); Object.assign(K.S.stages[0], { P: 'a', Q: 'b', mot: 'pp' }); K.S.stages[1].on = true; K.buildStage(0); K.buildStage(1); K.diceRoll(false); });
  await page.waitForTimeout(2500);
  const fps = await page.textContent('#readout');
  await page.screenshot({ path: path.join(OUT, 'desktop.png') });
  test('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // contact sheet of the ten modes at t=.5
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: 1400, height: 560 });
  await sp.setContent(`<body style="margin:0;background:#13120f;color:#ece6da;font:14px sans-serif;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:8px">${sheet.map(([m, u]) => `<figure style="margin:0"><img src="${u}" style="width:100%;display:block"><figcaption>${m}</figcaption></figure>`).join('')}</body>`);
  await sp.screenshot({ path: path.join(OUT, 'modes.png'), fullPage: true });

  // phone width: no sideways scroll
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mp.goto(PAGE);
  await mp.setInputFiles('#file0', fx.land); await mp.setInputFiles('#file1', fx.face);
  await mp.waitForFunction(() => window.__kishimi.E.slots[1].ready);
  await mp.waitForTimeout(500);
  const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  test('phone width has no sideways scroll', ov <= 0, `overflow ${ov}px`);
  await mp.screenshot({ path: path.join(OUT, 'phone.png') });
  test('phone: a first collage is laid out', await mp.evaluate(() => window.__kishimi.S.col.frags.length >= 3));
  await mp.evaluate(() => document.querySelector('#col .frags button').click()); await mp.waitForTimeout(500);
  test('phone starts at 720 on the long side', await mp.evaluate(() => Math.max(...window.__kishimi.E.size) === 720));
  const ov2 = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  test('phone width with the fragment editor open has no sideways scroll', ov2 <= 0, `overflow ${ov2}px`);
  await mp.evaluate(() => document.getElementById('col').scrollIntoView()); await mp.waitForTimeout(300);
  await mp.screenshot({ path: path.join(OUT, 'phone-editor.png') });
  await mp.evaluate(() => window.scrollTo(0, 900)); await mp.waitForTimeout(200);
  await mp.screenshot({ path: path.join(OUT, 'phone-scrolled.png') });

  await browser.close();

  console.log(fps);
  const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - bad}/${results.length} passed · output in ${OUT}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
