// Offline test of the five machines: runs the GenExpr code (translated to JS)
// against synthetic sources and checks that the output stays finite and
// bounded, that it is not silent, and that each machine's events happen.
// Usage: node tools/test.mjs
import { readFileSync } from 'node:fs';
import { translate } from './genexpr.mjs';

const SR = 48000;
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
  const s = run(m, 30);
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
// empty buffers must not produce NaN
for (const n of ['tenki', 'kizu', 'mebuki', 'tsuioku', 'kiri']) {
  const m = make(n); const s = run(m, 1);
  test(`${n} with empty buffers is finite`, s.nan === 0, `nan ${s.nan}`);
}

let fail = 0;
for (const [r, l, i] of results) { console.log(r, l, '—', i); if (r === 'FAIL') fail++; }
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
