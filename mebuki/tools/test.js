// Offline tests for the Mebuki DSP. Usage: node tools/test.js
const MEBUKI_DSP = require('../src/dsp.js');
const D = MEBUKI_DSP();
const SR = 48000;
let seed = 99; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const results = [];
const test = (label, ok, info) => results.push([ok ? 'ok  ' : 'FAIL', label, info]);

// --- spectral stage on its own ---
{
  const s = new (D.Engine)(SR).spec, N = 1023, n = SR;
  const S = { mode: 0, m: 0, shift: 0, smear: 0, freeze: false };
  let err = 0, ref = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.sin(2 * Math.PI * 440 * i / SR) * 0.5 + Math.sin(2 * Math.PI * 1234 * i / SR) * 0.2;
    s.tick(x, x, 0, 0, S);
    if (i > 4 * N) { const d = Math.sin(2 * Math.PI * 440 * (i - N) / SR) * 0.5 + Math.sin(2 * Math.PI * 1234 * (i - N) / SR) * 0.2; err += (s.o[0] - d) ** 2; ref += d * d; }
  }
  test('spectral pass-through reconstructs the input exactly (latency 1023)', err / ref < 1e-6, `rel err ${(err / ref).toExponential(2)}`);
  for (const [mode, m, which] of [[2, 0, 'A'], [2, 1, 'B'], [3, 1, 'B']]) {
    const t = new (D.Engine)(SR).spec; const S2 = { mode, m, shift: 0, smear: 0, freeze: false };
    let e = 0, r = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.sin(2 * Math.PI * 300 * i / SR) * 0.5, b = Math.sin(2 * Math.PI * 900 * i / SR) * 0.4;
      t.tick(a, a, b, b, S2);
      if (i > 4 * N) { const j = i - N, d = which === 'A' ? Math.sin(2 * Math.PI * 300 * j / SR) * 0.5 : Math.sin(2 * Math.PI * 900 * j / SR) * 0.4; e += (t.o[0] - d) ** 2; r += d * d; }
    }
    test(`mode ${mode === 2 ? 'spectral' : 'cross'} at ${m} gives ${which}`, e / r < 1e-3, `rel err ${(e / r).toExponential(2)}`);
  }
  // freeze: input stops, sound continues
  const f = new (D.Engine)(SR).spec; const S3 = { mode: 0, m: 0, shift: 0, smear: 0, freeze: false };
  for (let i = 0; i < SR; i++) { const x = Math.sin(2 * Math.PI * 330 * i / SR) * 0.5; f.tick(x, x, 0, 0, S3); }
  S3.freeze = true; let e2 = 0;
  for (let i = 0; i < SR * 2; i++) { f.tick(0, 0, 0, 0, S3); if (i > SR) e2 += f.o[0] ** 2; }
  test('spectral freeze holds the sound after the input stops', Math.sqrt(e2 / SR) > 0.05, `rms ${Math.sqrt(e2 / SR).toFixed(3)}`);
}

// --- whole engine ---
function src(kind, sec) {
  const n = SR * sec, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (kind === 'pad') { const v = 0.2 * (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 165 * t) + Math.sin(2 * Math.PI * 220.5 * t)); L[i] = v; R[i] = v; }
    else { const v = (Math.random() * 2 - 1) * 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t)) + 0.3 * Math.sin(2 * Math.PI * 880 * t) * Math.exp(-((t * 2) % 1) * 6); L[i] = v; R[i] = v * 0.9; }
  }
  return { frames: n, data: [L, R] };
}
function render(e, sec) {
  const B = 128, L = new Float32Array(B), R = new Float32Array(B); let nan = 0, peak = 0, sum = 0, cnt = 0;
  const t0 = Date.now();
  for (let k = 0; k < sec * SR / B; k++) {
    e.render(L, R, B);
    for (let i = 0; i < B; i++) { const a = L[i], b = R[i]; if (!Number.isFinite(a) || !Number.isFinite(b)) nan++; peak = Math.max(peak, Math.abs(a), Math.abs(b)); sum += a * a + b * b; cnt += 2; }
    if (k % 8 === 0) e.status();
  }
  return { nan, peak, rms: Math.sqrt(sum / cnt), ms: Date.now() - t0 };
}
const MODES = ['配分 grain', '混合 blend', '音色 spectral', '交差 cross', '掛合 ring'];
{
  const e = new (D.Engine)(SR);
  e.handle({ t: 'run', v: 1 });
  const silent = render(e, 1);
  test('silent with no sources loaded', silent.rms === 0 && silent.nan === 0, `rms ${silent.rms}`);
  const a = src('rain', 6), b = src('pad', 6);
  e.handle({ t: 'buf', track: 0, frames: a.frames, data: a.data }); e.handle({ t: 'buf', track: 1, frames: b.frames, data: b.data });
  for (let mode = 0; mode < 5; mode++) {
    e.handle({ t: 'p', k: 'm.mode', v: mode }); e.handle({ t: 'p', k: 'm.amount', v: 0.5 });
    const r = render(e, 4);
    test(`mode ${MODES[mode]}: finite, bounded, sounding`, r.nan === 0 && r.peak <= 1 && r.rms > 0.01, `rms ${r.rms.toFixed(3)} peak ${r.peak.toFixed(3)}`);
  }
  // every effect at its extreme at once
  const ext = { 'a.tone': -1, 'a.res': 1, 'a.drive': 1, 'a.crush': 1, 'a.wow': 1, 'a.dsend': 1, 'a.rsend': 1, 'b.tone': 1, 'b.res': 1, 'b.drive': 1, 'b.crush': 1, 'b.wow': 1, 'b.dsend': 1, 'b.rsend': 1,
    'b.density': 120, 'b.size': 1500, 'b.pitch': 24, 'b.pspray': 12, 'm.mode': 2, 'm.smear': 0.98, 'm.shift': 1, 'm.freeze': 0, 'x.tone': 0.5, 'x.res': 1, 'x.drive': 1, 'x.crush': 0.5, 'x.dfb': 0.97, 'x.dret': 1, 'x.rsize': 1, 'x.rret': 1, 'x.level': 1.2 };
  for (const k in ext) e.handle({ t: 'p', k, v: ext[k] });
  const r = render(e, 8);
  test('all effects at extremes stay finite and bounded', r.nan === 0 && r.peak <= 1, `peak ${r.peak.toFixed(3)} rms ${r.rms.toFixed(3)}`);
  e.handle({ t: 'p', k: 'm.freeze', v: 1 }); e.handle({ t: 'p', k: 'a.mute', v: 1 }); e.handle({ t: 'p', k: 'b.mute', v: 1 });
  const fr = render(e, 3);
  test('freeze keeps sounding with both tracks muted', fr.rms > 0.005 && fr.nan === 0, `rms ${fr.rms.toFixed(4)}`);
}
{
  // solo: only the soloed track reaches the output (blend at 0 would hide B, so use grain share 0.5)
  const e = new (D.Engine)(SR); e.handle({ t: 'run', v: 1 });
  const a = src('rain', 4); e.handle({ t: 'buf', track: 0, frames: a.frames, data: a.data });
  e.handle({ t: 'p', k: 'b.solo', v: 1 }); e.handle({ t: 'p', k: 'x.rret', v: 0 });
  const r = render(e, 2);
  test('soloing the empty track silences the other', r.rms < 1e-3, `rms ${r.rms.toExponential(2)}`);
}
{
  // CPU: worst case should run well faster than real time
  const e = new (D.Engine)(SR); e.handle({ t: 'run', v: 1 });
  const a = src('rain', 6), b = src('pad', 6);
  e.handle({ t: 'buf', track: 0, frames: a.frames, data: a.data }); e.handle({ t: 'buf', track: 1, frames: b.frames, data: b.data });
  for (const [k, v] of [['m.mode', 3], ['a.density', 120], ['b.density', 120], ['a.size', 1500], ['b.size', 1500], ['a.wow', 1], ['b.wow', 1], ['m.smear', 0.5]]) e.handle({ t: 'p', k, v });
  const r = render(e, 10);
  test('worst case renders 10 s faster than 3 s', r.ms < 3000, `${r.ms} ms for 10 s`);
}
let fail = 0;
for (const [r, l, i] of results) { console.log(r, l, '—', i); if (r === 'FAIL') fail++; }
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
