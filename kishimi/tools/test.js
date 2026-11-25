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
const mad = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]); return s / x.length; };
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;

(async () => {
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

  // saving
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#still')]);
  const stillPath = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(stillPath);
  test('静止画 saves a PNG', /\.png$/.test(dl.suggestedFilename()) && fs.statSync(stillPath).size > 5000, `${dl.suggestedFilename()} ${fs.statSync(stillPath).size} bytes`);
  await page.click('#rec'); await page.waitForTimeout(1600);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#rec')]);
  const recPath = path.join(OUT, dl2.suggestedFilename()); await dl2.saveAs(recPath);
  test('録画 saves a video', /\.(mp4|webm)$/.test(dl2.suggestedFilename()) && fs.statSync(recPath).size > 10000, `${dl2.suggestedFilename()} ${fs.statSync(recPath).size} bytes`);

  // live run for a while with motion on, then screenshots
  await page.evaluate(() => { const K = window.__kishimi; K.applyMode(K.S.stages[0], 'flow'); Object.assign(K.S.stages[0], { P: 'a', Q: 'b', mot: 'pp' }); K.S.stages[1].on = true; K.buildStage(0); K.buildStage(1); });
  await page.waitForTimeout(1500);
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
  await mp.evaluate(() => window.scrollTo(0, 900)); await mp.waitForTimeout(200);
  await mp.screenshot({ path: path.join(OUT, 'phone-scrolled.png') });

  await browser.close();

  console.log(fps);
  const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - bad}/${results.length} passed · output in ${OUT}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
