// Browser test: does the sound actually change? Reads the live Web Audio graph.
// Usage: NODE_PATH=$(npm root -g) node tools/e2e-live.mjs [outdir]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.argv[2] || join(ROOT, '.e2e'); mkdirSync(OUT, { recursive: true });
const results = [];
const test = (label, ok, info = '') => { results.push(ok); console.log(ok ? 'ok  ' : 'FAIL', label, info === '' ? '' : `(${info})`); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('file://' + join(ROOT, 'index.html')); await page.waitForTimeout(500);
await page.evaluate(() => indexedDB.deleteDatabase('sawari'));
await page.click('#eSynth'); await page.waitForTimeout(300);
await page.evaluate(() => { S.sel.clear(); renderInspector(); });

// A. what plays is varied: each activator transforms differently
await page.evaluate(() => { window.__ev = []; const h = eng.handle.bind(eng); eng.handle = (e, at) => { if (e && !e.silent) __ev.push({ via: e.via, rate: Math.round(e.P.rate * 10) / 10, tone: Math.round(e.P.tone * 10) / 10 }); return h(e, at); }; });
await page.click('#play'); await page.waitForTimeout(9000);
const A = await page.evaluate(() => ({ n: __ev.length, rates: [...new Set(__ev.map(e => e.rate))].length, tones: [...new Set(__ev.map(e => e.tone))].length, vias: [...new Set(__ev.map(e => e.via))] }));
test('9 s of play: many different pitches', A.rates >= 6, `${A.n} events, ${A.rates} distinct rates, ${A.tones} tones`);
test('several kinds of activators sound', A.vias.length >= 3, A.vias.join(','));
const sounding = await page.evaluate(() => eng.sounding(ctx.currentTime).length);
test('sounding fragments are reported for drawing', sounding >= 1, sounding);
await page.screenshot({ path: join(OUT, '21-playing.png') });

// B. a sounding voice follows its fragment while it plays (up = higher with law 甲)
await page.click('#play'); await page.waitForTimeout(300);
const B0 = await page.evaluate(() => { const f = sim.frags.find(f => srcs.get(f.src).name === '和音') || sim.frags[0]; f.mode = 'hit'; f.law = 0; f.p.prob = 1; f.move.type = 'none'; f.y = 300; sim.refresh(); touchFrag(f, 0.8); return f.id; });
await page.waitForTimeout(250);
const r0 = await page.evaluate(id => { const v = eng.voices.find(v => v.id === id && !v.dead); return v ? (v.s ? v.s.playbackRate.value : v.pitchRate) : null; }, B0);
await page.evaluate(id => { const f = sim.byId.get(id); f.y = -700; sim.refresh(); }, B0);
await page.waitForTimeout(350);
const r1 = await page.evaluate(id => { const v = eng.voices.find(v => v.id === id && !v.dead); return v ? (v.s ? v.s.playbackRate.value : v.pitchRate) : null; }, B0);
test('moving a sounding fragment up raises it while it sounds', r0 && r1 && r1 > r0 * 1.15, `${r0 && r0.toFixed(3)} → ${r1 && r1.toFixed(3)}`);

// C. drag to hear: grabbing a fragment sounds it, and the drag itself bends it (motion → pitch)
await page.evaluate(() => { eng.hush(); });
await page.waitForTimeout(200);
const fr = await page.evaluate(() => { const f = sim.frags.find(f => { const x = view.sx(f.x), y = view.sy(f.y); return f.mode === 'hit' && x > 150 && x < 1000 && y > 150 && y < 800 && (hitTest({ x, y }) || { o: {} }).o.id === f.id; }); f.p.prob = 1; f.law = 0; return { id: f.id, x: view.sx(f.x), y: view.sy(f.y) }; });
const before = await page.evaluate(id => eng.voices.filter(v => v.id === id).length, fr.id);
await page.mouse.move(fr.x, fr.y); await page.mouse.down();
for (let i = 1; i <= 14; i++) { await page.mouse.move(fr.x + i * 18, fr.y - i * 6); await page.waitForTimeout(25); }
const C1 = await page.evaluate(id => ({ voices: eng.voices.filter(v => v.id === id).length, motion: sim.dragMotion && sim.dragMotion.get(id), pitch: sim.liveP({ id, mod: null }).pitch }), fr.id);
await page.mouse.up();
test('grabbing a fragment makes it sound', C1.voices > before, `${before} → ${C1.voices} voices`);
test('dragging fast registers as motion (motion → pitch in law 甲)', C1.motion > 0.05 && C1.pitch > 0.3, `motion ${C1.motion && C1.motion.toFixed(2)} pitch +${C1.pitch.toFixed(2)}`);

// D. the ear: moving the view changes a loop's level and side
await page.evaluate(() => { const f = sim.frags.find(f => srcs.get(f.src).name === '雨') || sim.frags[1]; f.mode = 'loop'; f.move.type = 'none'; window.__loopId = f.id; view.x = f.x; view.y = f.y; world.ear.mode = 'view'; commit(); });
await page.click('#play'); await page.waitForTimeout(700);
const g0 = await page.evaluate(() => eng.loops.get(__loopId).ch.vol.gain.value);
await page.evaluate(() => { const f = sim.byId.get(__loopId); view.x = f.x + 2600; });
await page.waitForTimeout(600);
const g1 = await page.evaluate(() => eng.loops.get(__loopId).ch.vol.gain.value);
test('moving the view away makes a loop quieter (the screen is the ear)', g1 < g0 * 0.4, `${(20 * Math.log10(g0)).toFixed(1)} → ${(20 * Math.log10(g1)).toFixed(1)} dB`);
const pan = await page.evaluate(() => eng.loops.get(__loopId).ch.pan.pan.value);
test('…and pans it to the side it is on', pan < -0.5, pan.toFixed(2));

// E. knob A (law 甲: knobA → tone) darkens what is sounding, live
await page.evaluate(() => { const f = sim.byId.get(__loopId); view.x = f.x; view.y = f.y; world.circuit.knobs[0].v = 0.5; });
await page.waitForTimeout(500);
await page.keyboard.press('k');
const lp0 = await page.evaluate(() => eng.loops.get(__loopId).ch.lp.frequency.value);
await page.evaluate(() => { const s = $('knob0'); s.value = 0; s.dispatchEvent(new Event('input')); });
await page.waitForTimeout(500);
const lp1 = await page.evaluate(() => eng.loops.get(__loopId).ch.lp.frequency.value);
test('turning knob A down closes the filter on a sounding loop', lp1 < lp0 * 0.3, `${Math.round(lp0)} → ${Math.round(lp1)} Hz`);
await page.screenshot({ path: join(OUT, '22-circuit.png') });

// F. train doppler: a train-triggered voice bends while it sounds
await page.evaluate(() => { world.circuit.knobs[0].v = 0.5; const tr = sim.trains[0]; const rail = sim.byId.get(tr.rail); for (let i = 0; i < 3; i++) { const p = C.railPoint(rail, C.railGeom(rail).L * (0.15 + i * 0.3)); const f = sim.frags[i]; f.x = p.x + 30; f.y = p.y; f.mode = 'hit'; f.p.prob = 1; f.move.type = 'none'; f.law = 2; f.a = 0; f.b = srcs.get(f.src).dur; } tr.doppler = 1; tr.speed = 320; sim.index(); sim.refresh(); });
const bends = await page.evaluate(() => new Promise(res => { const seen = new Set(); const t0 = performance.now(); const iv = setInterval(() => { for (const v of eng.voices) if (v.src && v.src.k === 'train' && v.s && !v.dead) { (v.__r = v.__r || []).push(v.rate); seen.add(v); } if (performance.now() - t0 > 6000) { clearInterval(iv); res([...seen].filter(v => v.__r.length > 3).map(v => Math.min(...v.__r) / Math.max(...v.__r))); } }, 50); }));
test('a passing train bends the pitch of what it set off (doppler)', bends.length > 0 && Math.min(...bends) < 0.85, bends.map(b => b.toFixed(2)).join(' '));

// G. ride the train: the ear and the view move with it
await page.evaluate(() => { world.ear.mode = 'ride'; world.ear.target = sim.trains[0].id; });
const v0 = await page.evaluate(() => ({ x: view.x, y: view.y }));
await page.waitForTimeout(1500);
const v1 = await page.evaluate(() => ({ x: view.x, y: view.y }));
test('riding a train moves the screen with it', Math.hypot(v1.x - v0.x, v1.y - v0.y) > 80, `${Math.round(Math.hypot(v1.x - v0.x, v1.y - v0.y))} units`);
await page.screenshot({ path: join(OUT, '23-ride.png') });
await page.evaluate(() => { world.ear.mode = 'view'; });

// H. audio input (fake device): level, input object, rings on onsets, capture
await page.click('#circuit button:has-text("入力を使う")');
await page.waitForTimeout(2500);
const H1 = await page.evaluate(() => ({ inp: !!(eng && eng.inp), inputs: sim.inputs.length, label: CIR.label }));
test('input starts and an input object is placed', H1.inp && H1.inputs === 1, JSON.stringify(H1));
const lvMax = await page.evaluate(() => new Promise(res => { let m = 0; const t0 = performance.now(); const iv = setInterval(() => { m = Math.max(m, CIR.level); if (performance.now() - t0 > 2500) { clearInterval(iv); res(m); } }, 30); }));
test('input level is measured', lvMax > 0.01, lvMax.toFixed(3));
const rings = await page.evaluate(() => new Promise(res => { const o = sim.inputs[0]; o.thr = 0.02; o.trig = 'ripple'; let n = 0; const add = sim.addRing.bind(sim); sim.addRing = (...a) => { n++; return add(...a); }; setTimeout(() => res(n), 4000); }));
test('input onsets send rings into the world', rings >= 1, rings);
const cap = await page.evaluate(() => { const n0 = world.sources.length; captureNow(sim.inputs[0]); const s = world.sources[world.sources.length - 1]; return { added: world.sources.length - n0, name: s.name, dur: srcs.get(s.id).dur }; });
test('capturing the input makes a new sound and fragment', cap.added === 1 && cap.dur > 3, JSON.stringify(cap));
const inVoice = await page.evaluate(() => eng.inputs.size);
test('the input object sounds from where it stands', inVoice === 1, inVoice);
await page.screenshot({ path: join(OUT, '24-input.png') });

// I. MIDI (messages fed to the same handler a device would use)
await page.click('#play'); await page.waitForTimeout(200);
const I = await page.evaluate(() => {
  const f = sim.frags.find(f => f.mode === 'hit'); f.p.prob = 1; select([f.id]);
  const n0 = eng.voices.length; onMidi([0x90, 67, 110]);
  const v = eng.voices[eng.voices.length - 1];
  CIR.learn = 1; onMidi([0xB0, 21, 0]); const learned = world.circuit.knobs[1].cc;
  onMidi([0xB0, 21, 127]); const val = world.circuit.knobs[1].v;
  onMidi([0xE0, 127, 127]); const bend = sim.ext.bend;
  return { newVoice: eng.voices.length > n0, st: v && v.mod && v.mod.st, learned, val, bend };
});
test('a MIDI key plays the selected fragment at that pitch (G4 = +7)', I.newVoice && I.st === 7, JSON.stringify(I));
test('MIDI learn ties a controller to knob B, and it moves it', I.learned === 21 && I.val === 1);
test('pitch bend reaches the world', I.bend > 0.99);

test('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fail = results.filter(r => !r).length;
console.log(fail ? `\n${fail} failed` : `\nall ${results.length} passed`);
process.exit(fail ? 1 : 0);
