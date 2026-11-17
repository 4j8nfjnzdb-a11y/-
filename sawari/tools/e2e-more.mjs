// Second browser pass: the remaining tools, rooms, scenes, autonomy and load.
// Usage: NODE_PATH=$(npm root -g) node tools/e2e-more.mjs [outdir]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.argv[2] || join(ROOT, '.e2e'); mkdirSync(OUT, { recursive: true });
const results = [];
const test = (label, ok, info = '') => { results.push(ok); console.log(ok ? 'ok  ' : 'FAIL', label, info === '' ? '' : `(${info})`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('file://' + join(ROOT, 'index.html')); await page.waitForTimeout(500);
await page.evaluate(() => indexedDB.deleteDatabase('sawari'));
await page.click('#eSynth'); await page.waitForTimeout(300);
await page.evaluate(() => { S.sel.clear(); renderInspector(); });

// visible, unobstructed fragments to work with
const pick = async (n) => page.evaluate(n => sim.frags.filter(f => { const x = view.sx(f.x), y = view.sy(f.y); return x > 120 && x < 1050 && y > 120 && y < 820 && (hitTest({ x, y }) || { o: {} }).o.id === f.id; }).slice(0, n).map(f => ({ id: f.id, x: view.sx(f.x), y: view.sy(f.y) })), n);
const [a, b] = await pick(2);

// thread tool
await page.keyboard.press('w');
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
test('thread tool ties two fragments', await page.evaluate(([a, b]) => sim.threads.some(t => t.a === a && t.b === b), [a.id, b.id]));
// sweep: click = radar, drag = scan
await page.keyboard.press('s');
await page.mouse.click(980, 220);
await page.mouse.move(150, 760); await page.mouse.down(); await page.mouse.move(600, 820, { steps: 5 }); await page.mouse.up();
test('sweep tool: click makes a radar, drag makes a scan', await page.evaluate(() => sim.sweeps.length === 1 && sim.scans.length === 1));
// flock + ripple + thing
await page.keyboard.press('d'); await page.mouse.click(600, 300);
await page.keyboard.press('p'); await page.mouse.click(300, 250);
await page.keyboard.press('o'); await page.mouse.click(1000, 600);
test('flock, ripple and thing tools place objects', await page.evaluate(() => sim.flockObjs.length === 2 && sim.ripples.length === 2 && sim.things.length === 3));
await page.keyboard.press('v');

// room effect chain: add a unit, the engine builds it
await page.evaluate(() => ensureAudio());
const room = await page.evaluate(() => { const m = sim.rooms[0]; select([m.id]); return m.id; });
await page.selectOption('#insp select:last-of-type', 'crush');
const units = await page.evaluate(id => { eng.syncRooms(); return { fx: sim.byId.get(id).fx.map(f => f.type), units: eng.rooms.get(id).units.length }; }, room);
test('a room takes a new effect and the engine chains it', units.fx.includes('crush') && units.units === units.fx.length, JSON.stringify(units));
await page.screenshot({ path: join(OUT, '11-room.png') });

// scenes: store, change, recall
await page.evaluate(() => { S.sel.clear(); renderInspector(); });
await page.keyboard.press('Shift+Digit1');
const x0 = await page.evaluate(id => { const f = sim.byId.get(id); const x = f.x; f.x += 300; commit(); return x; }, a.id);
await page.keyboard.press('1');
test('scene 1 stores and recalls the arrangement', await page.evaluate(([id, x]) => Math.abs(sim.byId.get(id).x - x) < 1e-6, [a.id, x0]));

// multi-select: marquee, group, arrange in a circle
await page.mouse.move(80, 110); await page.mouse.down(); await page.mouse.move(1090, 830, { steps: 6 }); await page.mouse.up();
const nsel = await page.evaluate(() => S.sel.size);
test('marquee selects many', nsel > 6, nsel);
await page.evaluate(() => { select(sim.frags.slice(0, 5).map(f => f.id)); arrange('circle'); });
const circ = await page.evaluate(() => { const fs = sim.frags.slice(0, 5), cx = fs.reduce((s, f) => s + f.x, 0) / 5, cy = fs.reduce((s, f) => s + f.y, 0) / 5; const ds = fs.map(f => Math.hypot(f.x - cx, f.y - cy)); return Math.max(...ds) - Math.min(...ds); });
test('arrange in a circle', circ < 1e-6, circ);
await page.keyboard.press('Meta+g');
test('grouping: picking one picks all', await page.evaluate(() => { const g = sim.frags[0].group; S.sel.clear(); select([sim.frags[0].id]); return !!g && S.sel.size === 5; }));

// autonomy: a loop fragment holds a continuous voice; mutation changes the world by itself
await page.evaluate(() => { sim.frags.forEach(f => { f.mut = 1; }); sim.frags[1].mode = 'loop'; sim.frags[1].move = { type: 'spin', speed: 0.6, radius: 60, audible: true }; world.laws[sim.frags[1].law >= 0 ? sim.frags[1].law : 0].m['turn>rate'] = 1; commit(); });
const before = await page.evaluate(() => JSON.stringify(sim.frags.map(f => [f.x, f.y, f.ang, f.r, f.p.start, f.skin.sides])));
await page.click('#play'); await page.waitForTimeout(4000);
const auto = await page.evaluate(b => ({ loops: eng.loops.size, changed: JSON.stringify(sim.frags.map(f => [f.x, f.y, f.ang, f.r, f.p.start, f.skin.sides])) !== b, rate: eng.loops.get(sim.frags[1].id)?.node.s.playbackRate.value }), before);
test('loop fragments hold continuous voices', auto.loops >= 1, auto.loops);
test('a spinning loop glides its speed through the law', auto.rate && Math.abs(auto.rate - 1) > 0.01, auto.rate && auto.rate.toFixed(3));
test('mutation changes fragments as they sound', auto.changed);

// tape: scrub with the touch tool
const tp = await page.evaluate(() => { const f = sim.frags[2]; f.mode = 'tape'; f.r = 90; f.ang = 0; sim.refresh(); const q = sim.pose(f, visT(), false); return { id: f.id, x: view.sx(q.x), y: view.sy(q.y), r: q.r * view.z }; });
await page.keyboard.press('f');
await page.evaluate(() => { window.__tapes = 0; const orig = eng.contact.bind(eng); eng.contact = (c, at) => { __tapes++; return orig(c, at); }; });
await page.mouse.move(tp.x - tp.r * 0.8, tp.y); await page.mouse.down(); await page.mouse.move(tp.x + tp.r * 0.8, tp.y, { steps: 12 }); await page.mouse.up();
test('touch scrubs a tape fragment', await page.evaluate(() => __tapes) >= 8, await page.evaluate(() => __tapes));
await page.keyboard.press('v');

// load: 160 fragments, 3 trains, 3 ripples, 2 flocks — frame time and voices
await page.evaluate(() => {
  const rng = C.makeRng(5), ids = world.sources.map(s => s.id);
  for (let i = 0; i < 140; i++) { const sid = ids[i % ids.length], d = srcs.get(sid).dur; world.objs.push(W.newFrag(sid, 0, d, (rng() - 0.5) * 2600, (rng() - 0.5) * 1600, rng)); }
  for (let i = 0; i < 2; i++) { const r = W.newRail(C.circlePts((rng() - 0.5) * 1600, (rng() - 0.5) * 800, 250 + rng() * 200, 30), true); world.objs.push(r, Object.assign(W.newTrain(r.id, rng()), { cars: 3, speed: 260 })); }
  world.objs.push(W.newRipple(-600, 300), Object.assign(W.newFlock(500, -300), { n: 10, speed: 220 }));
  sim.index(); sim.refresh(); fitView();
});
await page.waitForTimeout(500);
const perf = await page.evaluate(() => new Promise(res => { const ts = []; let maxLoad = 0; const t0 = performance.now(); const f = t => { ts.push(t); maxLoad = Math.max(maxLoad, eng.load()); if (t - t0 < 5000) requestAnimationFrame(f); else { const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b); res({ frags: sim.frags.length, median: d[d.length >> 1], p95: d[Math.floor(d.length * 0.95)], maxLoad, behind: (ctx.currentTime - S.t0) - sim.T }); } }; requestAnimationFrame(f); }));
test('160 fragments: drawing stays fluid (p95 frame < 40 ms)', perf.p95 < 40, JSON.stringify(perf));
test('scheduler keeps ahead of the audio clock', perf.behind < 0, perf.behind.toFixed(3));
await page.screenshot({ path: join(OUT, '12-busy.png') });
await page.click('#play');

test('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter(r => !r).length;
console.log(fail ? `\n${fail} failed` : `\nall ${results.length} passed`);
process.exit(fail ? 1 : 0);
