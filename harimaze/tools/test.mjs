// Offline test of the five machines: runs the GenExpr code (translated to JS)
// against synthetic sources and checks that the output stays finite and
// bounded, that it is not silent, and that each machine's events happen.
// Usage: node tools/test.mjs
import { readFileSync } from 'node:fs';
import { translate } from './genexpr.mjs';

const SR = 48000;
// deterministic runs: the machines draw noise() from Math.random
let seed = 12345;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const here = new URL('..', import.meta.url).pathname;
const make = (name) => (0, eval)('(' + translate(readFileSync(`${here}max/genexpr/${name}.genexpr`, 'utf8')) + ')')(SR);

function bells(sec) {
  const n = SR * sec, L = new Float32Array(n), R = new Float32Array(n);
  const notes = [0, 2, 4, 7, 9, 12, 9, 7];
  for (let k = 0; k < sec * 2; k++) {
    const f = 330 * Math.pow(2, notes[k % notes.length] / 12), t0 = k * SR / 2;
    for (let i = 0; i < SR / 2; i++) {
      const t = i / SR, e = Math.exp(-t * 5);
      const v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.76 * t)) * e * 0.4;
      L[t0 + i] += v; R[t0 + i] += v * 0.8;
    }
  }
  for (let i = 0; i < n; i++) { const hiss = (Math.random() * 2 - 1) * 0.03; L[i] += hiss; R[i] -= hiss; }
  return { frames: n, channels: 2, data: [L, R] };
}
function pad(sec) {
  const n = SR * sec, M = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; M[i] = 0.15 * (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 164.8 * t) + Math.sin(2 * Math.PI * 220.5 * t)); }
  return { frames: n, channels: 1, data: [M] };
}
const zeros = (sec, ch) => ({ frames: SR * sec, channels: ch, data: Array.from({ length: ch }, () => new Float32Array(SR * sec)) });

function run(m, sec, opts = {}) {
  const n = SR * sec, stats = { nan: 0, peak: 0, silentSec: 0, states: {}, fwd: 0, back: 0, jumps: 0 };
  let secSum = 0, prev3 = null;
  for (let i = 0; i < n; i++) {
    const trig = opts.trigEvery && i % opts.trigEvery < 10 ? 1 : 0;
    m.tick(opts.input ? opts.input(i) : trig, 0);
    const [a, b, c0, d] = m.O; const c = opts.track === 4 ? d : c0;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) { stats.nan++; continue; }
    stats.peak = Math.max(stats.peak, Math.abs(a), Math.abs(b));
    secSum += a * a + b * b;
    if ((i + 1) % SR === 0) { if (Math.sqrt(secSum / SR / 2) < 1e-4) stats.silentSec++; secSum = 0; }
    if (i % 480 === 0) {
      stats.states[d.toFixed(2)] = (stats.states[d.toFixed(2)] || 0) + 1;
      if (prev3 !== null) { const dp = c - prev3; if (Math.abs(dp) > 0.2) stats.jumps++; else if (dp > 1e-7) stats.fwd++; else if (dp < -1e-7) stats.back++; }
      prev3 = c;
    }
  }
  return stats;
}

const results = [];
function test(label, cond, info) { results.push([cond ? 'ok  ' : 'FAIL', label, info]); }
const src = bells(8);

// TENKI
{
  const m = make('tenki'); m.B.src = src; m.P.weather = 0.8;
  const s = run(m, 90);
  test('tenki finite & bounded', s.nan === 0 && s.peak < 2, `peak ${s.peak.toFixed(3)}`);
  test('tenki not silent', s.silentSec < 3, `silent s ${s.silentSec}`);
  const st = Object.keys(s.states);
  test('tenki weather states seen (stop/rewind/freeze/leap)', ['1.00', '2.00', '3.00', '4.00'].every(k => st.includes(k)), JSON.stringify(s.states));
  test('tenki time runs forwards and backwards', s.fwd > 50 && s.back > 20, `fwd ${s.fwd} back ${s.back} jumps ${s.jumps}`);
  const m2 = make('tenki'); m2.B.src = src; m2.P.weather = 0; m2.P.drift = 0;
  const s2 = run(m2, 10);
  test('tenki calm when weather 0', Object.keys(s2.states).length === 1 && s2.back === 0, JSON.stringify(s2.states));
  const m3 = make('tenki'); m3.B.src = src; m3.P.weather = 0;
  const s3 = run(m3, 10, { trigEvery: SR });
  test('tenki trigger forces events', Object.keys(s3.states).length > 1, JSON.stringify(s3.states));
}
// KIZU
{
  const m = make('kizu'); m.B.src = src; m.P.damage = 0.7;
  const s = run(m, 30);
  test('kizu finite & bounded', s.nan === 0 && s.peak < 2, `peak ${s.peak.toFixed(3)}`);
  test('kizu not silent', s.silentSec < 3, `silent s ${s.silentSec}`);
  test('kizu faults seen (stick/drop/zip/skip)', ['1.00', '2.00', '3.00', '4.00'].every(k => Object.keys(s.states).includes(k)), JSON.stringify(s.states));
  const m2 = make('kizu'); m2.B.src = src; m2.P.damage = 0;
  const s2 = run(m2, 10);
  test('kizu clean when damage 0', Object.keys(s2.states).length === 1, JSON.stringify(s2.states));
}
// MEBUKI
{
  const m = make('mebuki'); m.B.srca = src; m.B.srcb = pad(6); m.P.morph = 0.5; m.P.density = 40; m.P.toy = 1; m.P.pspray = 12; m.P.scan = -0.3;
  const s = run(m, 20);
  test('mebuki finite & bounded', s.nan === 0 && s.peak < 2, `peak ${s.peak.toFixed(3)}`);
  test('mebuki not silent', s.silentSec < 2, `silent s ${s.silentSec}`);
  test('mebuki scan runs backwards when scan < 0', s.back > s.fwd, `fwd ${s.fwd} back ${s.back}`);
  // morph 1 + bloom 0: every grain from B, so silencing A changes nothing
  const m2 = make('mebuki'); m2.B.srca = zeros(4, 1); m2.B.srcb = pad(6); m2.P.morph = 1; m2.P.bloom = 0;
  const s2 = run(m2, 5);
  test('mebuki morph 1 takes grains from B', s2.silentSec === 0 && s2.peak > 0.05, `peak ${s2.peak.toFixed(3)}`);
  const m3 = make('mebuki'); m3.B.srca = zeros(4, 1); m3.B.srcb = pad(6); m3.P.morph = 0; m3.P.bloom = 0;
  const s3 = run(m3, 5);
  test('mebuki morph 0 takes grains from A only', s3.peak === 0, `peak ${s3.peak}`);
}
// TSUIOKU
{
  const m = make('tsuioku'); m.B.tape = zeros(32, 2); m.B.feed = src; m.P.recall = 0.7;
  const s = run(m, 60);
  test('tsuioku finite & bounded', s.nan === 0 && s.peak < 3, `peak ${s.peak.toFixed(3)}`);
  test('tsuioku not silent', s.silentSec < 2, `silent s ${s.silentSec}`);
  // heads only (no dry, no new input after 10 s) must still sound: memories
  const m2 = make('tsuioku'); m2.B.tape = zeros(32, 2); m2.B.feed = src; m2.P.dry = 0; m2.P.recall = 0.6;
  run(m2, 12); m2.P.ingain = 0;
  const s2 = run(m2, 40, { track: 4 });
  test('tsuioku heads recall the past after input stops', s2.silentSec < 8, `silent s ${s2.silentSec} peak ${s2.peak.toFixed(3)}`);
  test('tsuioku head reads both directions', s2.back > 0 && s2.fwd > 0, `fwd ${s2.fwd} back ${s2.back}`);
  // worst case: max feedback, max erosion, heads recalling constantly
  const m3 = make('tsuioku'); m3.B.tape = zeros(32, 2); m3.B.feed = src; m3.P.feedback = 0.99; m3.P.erode = 1; m3.P.recall = 1; m3.P.ingain = 1;
  const s3 = run(m3, 60);
  test('tsuioku stays bounded at feedback 0.99', s3.nan === 0 && s3.peak < 4, `peak ${s3.peak.toFixed(3)}`);
  // live input path (source 0)
  const m4 = make('tsuioku'); m4.B.tape = zeros(32, 2); m4.B.feed = zeros(1, 1); m4.P.source = 0;
  const s4 = run(m4, 10, { input: i => 0.3 * Math.sin(2 * Math.PI * 220 * i / SR) });
  test('tsuioku live input path sounds', s4.silentSec < 2 && s4.peak > 0.05, `peak ${s4.peak.toFixed(3)}`);
}
// KIRI
{
  const m = make('kiri'); m.B.src = src; m.P.mutate = 0.5;
  const s = run(m, 20);
  test('kiri finite & bounded', s.nan === 0 && s.peak < 2, `peak ${s.peak.toFixed(3)}`);
  test('kiri not silent', s.silentSec < 2, `silent s ${s.silentSec}`);
  test('kiri walks 16 steps', Object.keys(s.states).length > 4, `${Object.keys(s.states).length} slice values`);
  const m2 = make('kiri'); m2.B.src = src; m2.P.mutate = 0; m2.P.order = 0; m2.P.rest = 0; m2.P.rev = 0; m2.P.pitch = 0; m2.P.ratchet = 0;
  run(m2, 1);
  const straight = Array.from({ length: 16 }, (_, j) => m2.B.pat.data[0][j]).join(',');
  test('kiri order 0 keeps original slice order', straight === Array.from({ length: 16 }, (_, j) => j).join(','), straight);
  const before = m2.B.pat.data[0].join(','); m2.P.order = 1; m2.P.reroll = 1; run(m2, 0.1);
  test('kiri reroll rewrites the pattern', m2.B.pat.data[0].join(',') !== before, m2.B.pat.data[0].join(','));
  const m3 = make('kiri'); m3.B.src = src; m3.P.bpm = 20;
  const s3 = run(m3, 4, { trigEvery: SR / 8 });
  test('kiri external clock advances steps', Object.keys(s3.states).length > 4, `${Object.keys(s3.states).length} values`);
}
// BAKE
{
  const m = make('bake'); m.B.src = src; m.P.rot = 0.7;
  const s = run(m, 20);
  test('bake finite & bounded', s.nan === 0 && s.peak < 2, `peak ${s.peak.toFixed(3)}`);
  test('bake not silent', s.silentSec < 2, `silent s ${s.silentSec}`);
  test('bake faults re-roll', Object.keys(s.states).length > 2, JSON.stringify(s.states));
  const m2 = make('bake'); m2.B.src = src; m2.P.rot = 0; m2.P.stutter = 0;
  const s2 = run(m2, 5);
  test('bake clean when rot 0', Object.keys(s2.states).length === 1 && s2.states['0.00'], JSON.stringify(s2.states));
  // xor with every bit flipped equals 65535 - u: check the bit loop directly
  const m3 = make('bake'); m3.B.src = { frames: 4, channels: 1, data: [new Float32Array([0.25, 0.25, 0.25, 0.25])] };
  m3.P.rot = 0; m3.P.stutter = 0; m3.P.tame = 0; m3.S.mask = 65535; m3.P.level = 1;
  for (let i = 0; i < 10; i++) m3.tick(0, 0);
  test('bake xor with all bits set turns 0.25 into -0.25', Math.abs(m3.S.lp1 + 0.25) < 1e-6, `got ${m3.S.lp1}`);
}
// WA
{
  const m = make('wa'); m.B.src = src; m.P.period = 3000; m.P.frag = 900;
  const s = run(m, 30);
  test('wa finite & bounded', s.nan === 0 && s.peak < 2, `peak ${s.peak.toFixed(3)}`);
  test('wa not silent (silences are part of the design)', s.silentSec < 8, `silent s ${s.silentSec}`);
  test('wa loops drift in and out (sounding share varies)', Object.keys(s.states).length > 3, JSON.stringify(s.states));
  const m2 = make('wa'); m2.B.src = src; m2.P.voices = 1;
  const s2 = run(m2, 10);
  test('wa voices 1 sounds at most one loop', Object.keys(s2.states).every(k => k === '0.00' || k === '1.00'), JSON.stringify(s2.states));
}
// HIBIKI
{
  const m = make('hibiki'); m.B.feed = src; m.P.changes = 0.8;
  const s = run(m, 20);
  test('hibiki finite & bounded', s.nan === 0 && s.peak < 1.5, `peak ${s.peak.toFixed(3)}`);
  test('hibiki not silent', s.silentSec < 2, `silent s ${s.silentSec}`);
  test('hibiki chord root changes', Object.keys(s.states).length > 1, JSON.stringify(s.states));
  m.P.freeze = 1; m.P.wet = 1;
  const s2 = run(m, 8);
  test('hibiki freeze keeps ringing', s2.silentSec === 0 && s2.nan === 0, `silent s ${s2.silentSec} peak ${s2.peak.toFixed(3)}`);
  const m3 = make('hibiki'); m3.B.feed = zeros(1, 1); m3.P.source = 0;
  const s3 = run(m3, 5, { input: () => (Math.random() * 2 - 1) * 0.2 });
  test('hibiki turns live noise into sound', s3.silentSec === 0 && s3.peak > 0.05, `peak ${s3.peak.toFixed(3)}`);
}
// KOSURI
{
  const m = make('kosuri'); m.B.src = src; m.P.gesture = 0.9;
  const s = run(m, 30);
  test('kosuri finite & bounded', s.nan === 0 && s.peak < 2, `peak ${s.peak.toFixed(3)}`);
  test('kosuri not silent', s.silentSec < 3, `silent s ${s.silentSec}`);
  test('kosuri gestures seen (baby/chirp/transformer/spinback/drag)', ['1.00', '2.00', '3.00', '4.00', '5.00'].every(k => Object.keys(s.states).includes(k)), JSON.stringify(s.states));
  test('kosuri needle goes back and forth', s.back > 20 && s.fwd > 50, `fwd ${s.fwd} back ${s.back}`);
  const m2 = make('kosuri'); m2.B.src = src; m2.P.grab = 1; m2.P.hand = 0.7; m2.P.crackle = 0;
  run(m2, 1);
  test('kosuri hand pulls the needle to the target', Math.abs(m2.O[2] - 0.7) < 0.01, `needle ${m2.O[2].toFixed(4)}`);
}
// NI
{
  const m = make('ni'); m.B.src = src;
  run(m, 0.5);
  test('ni analysis finishes within 0.5 s', m.S.adone === 1, `adone ${m.S.adone}`);
  const s = run(m, 20);
  test('ni finite & bounded', s.nan === 0 && s.peak < 2, `peak ${s.peak.toFixed(3)}`);
  test('ni not silent', s.silentSec < 2, `silent s ${s.silentSec}`);
  const spreadOf = (st) => { const v = Object.entries(st).flatMap(([k, n]) => Array(n).fill(+k)); const mu = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length) };
  const near = make('ni'); near.B.src = src; near.P.similarity = 1; near.P.sweep = 0; const sn = run(near, 15);
  const far = make('ni'); far.B.src = src; far.P.similarity = 0; far.P.sweep = 0; const sf = run(far, 15);
  test('ni similarity 1 stays in a narrower feature range than 0', spreadOf(sn.states) < spreadOf(sf.states), `sd ${spreadOf(sn.states).toFixed(3)} vs ${spreadOf(sf.states).toFixed(3)}`);
}
// KODAMA
{
  const m = make('kodama'); m.B.dl = zeros(8, 2); m.B.feed = src; m.P.jump = 0.6;
  const s = run(m, 20);
  test('kodama finite & bounded', s.nan === 0 && s.peak < 2.5, `peak ${s.peak.toFixed(3)}`);
  test('kodama not silent', s.silentSec < 2, `silent s ${s.silentSec}`);
  test('kodama delay time jumps', Object.keys(s.states).length > 2, `${Object.keys(s.states).length} delay values`);
  m.P.freeze = 1; m.P.dry = 0;
  const s2 = run(m, 6);
  test('kodama freeze keeps echoes circling', s2.silentSec === 0, `silent s ${s2.silentSec}`);
  const m3 = make('kodama'); m3.B.dl = zeros(8, 2); m3.B.feed = src; m3.P.feedback = 1.05; m3.P.res = 1; m3.P.sparse = 0;
  const s3 = run(m3, 30);
  test('kodama bounded at max feedback', s3.nan === 0 && s3.peak < 3, `peak ${s3.peak.toFixed(3)}`);
}
// empty buffers must not produce NaN
for (const n of ['tenki', 'kizu', 'mebuki', 'tsuioku', 'kiri', 'bake', 'wa', 'hibiki', 'kosuri', 'ni', 'kodama']) {
  const m = make(n); const s = run(m, 1);
  test(`${n} with empty buffers is finite`, s.nan === 0, `nan ${s.nan}`);
}

let fail = 0;
for (const [r, l, i] of results) { console.log(r, l, '—', i); if (r === 'FAIL') fail++; }
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
