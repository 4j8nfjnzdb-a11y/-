// Browser test: drives the real page in Chromium with real Web Audio.
// Usage: node tools/e2e.mjs [outdir]   (needs playwright)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // run with NODE_PATH=$(npm root -g) when installed globally
const K = require('../src/codec.js');
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.argv[2] || join(ROOT, '.e2e');
mkdirSync(OUT, { recursive: true });
const results = [];
const test = (label, ok, info = '') => { results.push([ok ? 'ok  ' : 'FAIL', label, info]); console.log(ok ? 'ok  ' : 'FAIL', label, info === '' ? '' : `(${info})`); };
const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|net::/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto('file://' + join(ROOT, 'index.html'));
await page.waitForTimeout(600);
await page.evaluate(() => indexedDB.deleteDatabase('sawari'));
test('page boots with the empty-state invitation', await page.isVisible('#empty'));
await page.screenshot({ path: join(OUT, '01-empty.png') });

// trial sounds
await page.click('#eSynth');
await page.waitForTimeout(400);
const nFrags = await page.evaluate(() => sim.frags.length);
test('trial sounds become fragments', nFrags >= 10, nFrags);
test('empty state hides once there are fragments', !(await page.isVisible('#empty')));

// play, and listen to the output
await page.evaluate(() => { S.sel.clear(); renderInspector(); });
await page.click('#play');
await page.evaluate(() => { window.__an = ctx.createAnalyser(); __an.fftSize = 2048; eng.lim.connect(__an); window.__lv = []; window.__lvT = setInterval(() => { const a = new Float32Array(2048); __an.getFloatTimeDomainData(a); let s = 0; for (const v of a) s += v * v; __lv.push(Math.sqrt(s / a.length)); }, 50); });
await page.waitForTimeout(6000);
const lv = await page.evaluate(() => { clearInterval(__lvT); return { lv: __lv, state: ctx.state, T: sim.T, flashes: [...S.flashes.values()].reduce((a, b) => a + b.length, 0) }; });
const loud = lv.lv.filter(v => v > 0.003).length;
test('audio context runs', lv.state === 'running', lv.state);
test('the world sounds while playing', loud > lv.lv.length * 0.3, `${loud}/${lv.lv.length} frames above -50 dB, peak ${Math.max(...lv.lv).toFixed(3)}`);
test('events fire (flashes recorded)', lv.flashes > 5, lv.flashes);
test('world time advances with the audio clock', lv.T > 5.5 && lv.T < 7, lv.T.toFixed(2));
await page.screenshot({ path: join(OUT, '02-playing.png') });

// pause silences
await page.click('#play');
await page.waitForTimeout(700);
const quiet = await page.evaluate(() => { const a = new Float32Array(2048); __an.getFloatTimeDomainData(a); let s = 0; for (const v of a) s += v * v; return Math.sqrt(s / a.length); });
test('pause hushes running voices (loops, grains)', quiet < 0.02, quiet.toFixed(4));

// select + drag a fragment, then undo
const fr = await page.evaluate(() => { const f = sim.frags.find(f => f.mode === 'hit' && (hitTest({ x: view.sx(f.x), y: view.sy(f.y) }) || { o: {} }).o.id === f.id && view.sx(f.x) > 120 && view.sx(f.x) < 1000); return { id: f.id, x: f.x, y: f.y, sx: view.sx(f.x), sy: view.sy(f.y) }; });
await page.mouse.move(fr.sx, fr.sy); await page.mouse.down(); await page.mouse.move(fr.sx + 80, fr.sy + 40, { steps: 6 }); await page.mouse.up();
const moved = await page.evaluate(id => { const f = sim.byId.get(id); return { x: f.x, y: f.y, sel: [...S.sel] }; }, fr.id);
test('dragging moves the fragment in world units', Math.abs(moved.x - fr.x) > 50 && moved.sel.includes(fr.id), `${fr.x.toFixed(0)}→${moved.x.toFixed(0)}`);
test('inspector shows the fragment', (await page.textContent('#insp')).includes('鳴り方'));
await page.screenshot({ path: join(OUT, '03-selected.png') });
await page.keyboard.press('Meta+z');
const undone = await page.evaluate(id => sim.byId.get(id).x, fr.id);
test('undo restores the position', Math.abs(undone - fr.x) < 0.01, undone.toFixed(1));
await page.keyboard.press('Meta+Shift+z');
const redone = await page.evaluate(id => sim.byId.get(id).x, fr.id);
test('redo re-applies it', Math.abs(redone - moved.x) < 0.01);

// laws change the sound parameters for the same placement
const before = await page.evaluate(id => { const f = sim.byId.get(id); f.law = 2; world.laws[2].m = {}; return sim.probe(f).P.rate; }, fr.id);
await page.evaluate(() => openLaws(2));
const cell = page.locator('#laws .cell[aria-label="横 → 速さ"]');
const box = await cell.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 5 }); await page.mouse.up();
const after = await page.evaluate(id => ({ m: world.laws[2].m['x>rate'], rate: sim.probe(sim.byId.get(id)).P.rate }), fr.id);
test('dragging a law cell sets its strength', after.m > 0.5, after.m);
test('the law moves the fragment\'s speed by its x position', Math.abs(after.rate - before) > 0.1, `${before} → ${after.rate.toFixed(2)}`);
await page.screenshot({ path: join(OUT, '04-laws.png') });
await page.evaluate(() => closeLaws());

// split into 4 from the inspector
await page.evaluate(id => select([id]), fr.id);
await page.selectOption('#insp select', '4');
await page.click('#insp button:has-text("分ける")');
const split = await page.evaluate(() => [...S.sel].map(id => sim.byId.get(id)).map(f => [f.a, f.b]));
const contiguous = split.length === 4 && split.every((r, i) => !i || Math.abs(r[0] - split[i - 1][1]) < 1e-9);
test('split into 4 contiguous pieces', contiguous, split.map(r => r.map(v => v.toFixed(2)).join('-')).join(' '));

// tools: rail stroke creates a rail with a train; ripple click; room drag
await page.keyboard.press('r');
await page.mouse.move(300, 700); await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(300 + i * 25, 700 - Math.sin(i / 3) * 40);
await page.mouse.up();
test('rail tool: a stroke lays a rail and a train', await page.evaluate(() => sim.rails.length === 2 && sim.trains.length === 2));
await page.keyboard.press('b');
await page.mouse.move(700, 200); await page.mouse.down(); await page.mouse.move(900, 320, { steps: 4 }); await page.mouse.up();
test('room tool: drag builds a room', await page.evaluate(() => sim.rooms.length === 2));
await page.keyboard.press('Escape'); await page.keyboard.press('v');

// touch tool sounds a fragment directly
await page.keyboard.press('f');
const tf = await page.evaluate(() => { const f = sim.frags.find(f => f.mode === 'hit'); const q = sim.pose(f, visT(), false); f.p.prob = 1; return { id: f.id, sx: view.sx(q.x), sy: view.sy(q.y) }; });
await page.evaluate(() => S.flashes.clear());
await page.mouse.move(tf.sx, tf.sy); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
test('touch tool triggers the fragment under the finger', await page.evaluate(id => S.flashes.has(id), tf.id));
await page.keyboard.press('v');

// export: offline render from the start, repeatable
await page.click('#exportBtn');
await page.fill('#exportLen', '6');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exportGo')]);
const p1 = join(OUT, 'export-1.wav'); await dl.saveAs(p1);
const w1 = K.parseWav(readFileSync(p1).buffer.slice(0));
const r1 = rms(Array.from(w1.ch[0].subarray(0, w1.ch[0].length)));
test('export writes a stereo WAV of the asked length (+tail)', w1.ch.length === 2 && w1.ch[0].length / w1.sr >= 6 && w1.ch[0].length / w1.sr <= 9.1, `${(w1.ch[0].length / w1.sr).toFixed(2)} s @ ${w1.sr}`);
test('export is not silent', r1 > 0.003, r1.toFixed(4));
await page.waitForTimeout(300);
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exportGo')]);
const p2 = join(OUT, 'export-2.wav'); await dl2.saveAs(p2);
const w2 = K.parseWav(readFileSync(p2).buffer.slice(0));
let diff = 0; const n = Math.min(w1.ch[0].length, w2.ch[0].length);
for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(w1.ch[0][i] - w2.ch[0][i]));
test('same seed exports the same audio', diff < 1e-3 && Math.abs(w1.ch[0].length - w2.ch[0].length) < w1.sr * 0.05, `max diff ${diff.toExponential(2)}`);

// save project, start a new world, open it again
const [dz] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]);
const pz = join(OUT, 'project.zip'); await dz.saveAs(pz);
const z = await K.unzip(readFileSync(pz).buffer.slice(0));
const doc = JSON.parse(K.decText(z.get('sawari.json')));
test('project zip holds the world and every audio file', doc.world.objs.length > 10 && doc.world.sources.every(s => [...z.keys()].some(k => k.startsWith('audio/' + s.id))), `${z.size} entries`);
const counts = await page.evaluate(() => ({ objs: world.objs.length, frags: sim.frags.length }));
await page.reload(); await page.waitForTimeout(500);
await page.evaluate(() => indexedDB.deleteDatabase('sawari'));
await page.reload(); await page.waitForTimeout(500);
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#openBtn')]);
await fc.setFiles(pz); await page.waitForTimeout(1500);
const reopened = await page.evaluate(() => ({ objs: world.objs.length, frags: sim.frags.length, srcs: srcs.size }));
test('opening the project restores world and sounds', reopened.objs === counts.objs && reopened.frags === counts.frags && reopened.srcs >= 8, JSON.stringify(reopened));

// autosave: reload brings the world back
await page.waitForTimeout(1800);
await page.reload(); await page.waitForTimeout(2000);
const auto = await page.evaluate(() => ({ frags: sim.frags.length, srcs: srcs.size }));
test('autosave restores the last world after reload', auto.frags === counts.frags && auto.srcs >= 8, JSON.stringify(auto));

// live recording
await page.click('#rec');
await page.waitForTimeout(2500);
const [dr] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#rec')]);
const pr = join(OUT, 'rec.wav'); await dr.saveAs(pr);
const wr = K.parseWav(readFileSync(pr).buffer.slice(0));
test('recording captures what plays', wr.ch[0].length / wr.sr > 1.8 && rms(Array.from(wr.ch[0])) > 0.002, `${(wr.ch[0].length / wr.sr).toFixed(2)} s rms ${rms(Array.from(wr.ch[0])).toFixed(4)}`);
await page.click('#play');

// AIFF file through the drop path (Chrome cannot decode AIFF natively)
const aiff = (() => { const sr = 44100, n = 22050, len = n * 2; const total = 4 + 26 + 8 + 8 + len; const b = new ArrayBuffer(8 + total), dv = new DataView(b); let o = 0; const tag = s => { for (const c of s) dv.setUint8(o++, c.charCodeAt(0)); };
  tag('FORM'); dv.setUint32(o, total); o += 4; tag('AIFF'); tag('COMM'); dv.setUint32(o, 18); o += 4; dv.setInt16(o, 1); o += 2; dv.setUint32(o, n); o += 4; dv.setInt16(o, 16); o += 2; dv.setUint16(o, 0x400E); dv.setUint32(o + 2, 0xAC440000); dv.setUint32(o + 6, 0); o += 10;
  tag('SSND'); dv.setUint32(o, 8 + len); o += 4; dv.setUint32(o, 0); o += 4; dv.setUint32(o, 0); o += 4; for (let i = 0; i < n; i++) { dv.setInt16(o, Math.round(Math.sin(i / 8) * 12000 * Math.exp(-i / 9000))); o += 2; } return Buffer.from(b); })();
writeFileSync(join(OUT, 'test.aif'), aiff);
const [fa] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => $('fileAudio').click())]);
await fa.setFiles(join(OUT, 'test.aif')); await page.waitForTimeout(800);
test('AIFF loads as a fragment', await page.evaluate(() => [...srcs.values()].some(s => s.name === 'test' && Math.abs(s.dur - 0.5) < 0.01)));

// dark theme render + help
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
await page.evaluate(() => { S.sel.clear(); renderInspector(); });
await page.screenshot({ path: join(OUT, '05-dark.png') });
await page.keyboard.press('?');
await page.screenshot({ path: join(OUT, '06-help.png') });
await page.keyboard.press('Escape');
// phone width
await page.setViewportSize({ width: 400, height: 820 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
test('no horizontal page scroll at phone width', !overflow);
await page.screenshot({ path: join(OUT, '07-phone.png') });

test('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const fail = results.filter(r => r[0] === 'FAIL').length;
console.log(fail ? `\n${fail} failed` : `\nall ${results.length} passed`);
process.exit(fail ? 1 : 0);
