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
    if (kind === 'pad') { const v = 0.15 * (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 165 * t) + Math.sin(2 * Math.PI * 220.5 * t)); L[i] = v; R[i] = v; }
    else if (kind === 'melody') { const f = [330, 392, 440, 523, 587][Math.floor(t * 2) % 5], e = Math.exp(-((t * 2) % 1) * 3); const v = 0.35 * Math.sin(2 * Math.PI * f * t) * e; L[i] = v; R[i] = v * 0.8; }
    else { const v = (Math.random() * 2 - 1) * 0.25 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t)) + 0.25 * Math.sin(2 * Math.PI * 880 * t) * Math.exp(-((t * 2) % 1) * 6); L[i] = v; R[i] = v * 0.9; }
  }
  return { frames: n, data: [L, R] };
}
function render(e, sec, capture) {
  const B = 128, L = new Float32Array(B), R = new Float32Array(B); let nan = 0, peak = 0, sum = 0, cnt = 0;
  const t0 = Date.now(), out = capture ? new Float32Array(Math.round(sec * SR)) : null;
  for (let k = 0; k < sec * SR / B; k++) {
    e.render(L, R, B);
    for (let i = 0; i < B; i++) { const a = L[i], b = R[i]; if (!Number.isFinite(a) || !Number.isFinite(b)) nan++; peak = Math.max(peak, Math.abs(a), Math.abs(b)); sum += a * a + b * b; cnt += 2; if (out) out[k * B + i] = a; }
    if (k % 8 === 0) e.status();
  }
  return { nan, peak, rms: Math.sqrt(sum / cnt), ms: Date.now() - t0, out };
}
const MODES = ['混合 mix', '配分 exchange', '音色 spectral', '交差 cross', '掛合 ring'];
const mel = src('melody', 6);
const fresh = (params = {}) => {
  seed = 4242; const e = new (D.Engine)(SR); e.handle({ t: 'run', v: 1 });
  e.handle({ t: 'buf', track: 0, frames: mel.frames, data: mel.data });
  for (const k in params) e.handle({ t: 'p', k, v: params[k] });
  return e;
};
{
  // the heart of the request: load a file, touch nothing, hear the file
  const r = render(fresh(), 4, true), lag = 144 + 1023;
  let xy = 0, xx = 0, yy = 0;
  for (let i = SR; i < 4 * SR; i++) { const x = mel.data[0][(i - lag) % mel.frames] * 0.9, y = r.out[i]; xy += x * y; xx += x * x; yy += y * y; }
  const corr = xy / Math.sqrt(xx * yy);
  test('defaults play the file as it is (correlation with the original)', corr > 0.995, `corr ${corr.toFixed(5)}`);
  const base = r.out;
  // phase-blind distance for faders that move time or pitch: long-term magnitude spectra in dB
  const FFTN = 2048, fft = D.makeFFT(FFTN);
  const ltas = (o) => { const acc = new Float64Array(FFTN / 2), re = new Float64Array(FFTN), im = new Float64Array(FFTN); let fr = 0;
    for (let st = SR; st + FFTN < 4 * SR; st += FFTN / 2, fr++) { for (let i = 0; i < FFTN; i++) { re[i] = o[st + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFTN)); im[i] = 0 } fft(re, im, false); for (let k = 0; k < FFTN / 2; k++) acc[k] += Math.hypot(re[k], im[k]) }
    const db = acc.map(v => 20 * Math.log10(v / fr + 1e-9)), mx = Math.max(...db); return db.map(v => Math.max(v, mx - 60)); };
  const baseL = ltas(base);
  {
    // grain path at pitch 0 rebuilds the original: force grains (exchange mode, all from A) and compare
    const e = fresh({ 'm.mode': 1, 'm.amount': 0 }); const o = render(e, 4, true).out;
    let xy = 0, xx = 0, yy = 0; for (let i = SR; i < 4 * SR; i++) { const x = base[i], y = o[i]; xy += x * y; xx += x * x; yy += y * y; }
    test('grain path at rest matches plain playback (correlation)', xy / Math.sqrt(xx * yy) > 0.98, `corr ${(xy / Math.sqrt(xx * yy)).toFixed(4)}`);
  }
  const sdev = (o) => { const l = ltas(o); let d = 0, c = 0; for (let k = 2; k < 350; k++) { d += Math.abs(l[k] - baseL[k]); c++ } return d / c; };
  const dev = (o) => { let d = 0, b = 0; for (let i = SR; i < 4 * SR; i++) { d += (o[i] - base[i]) ** 2; b += base[i] ** 2; } return Math.sqrt(d / b); };
  const FADERS = [['a.speed', [0.95, 0.8, 0.5]], ['a.stretch', [0.1, 0.4, 0.9]], ['a.grain', [0.1, 0.4, 1]], ['a.pitch', [0.5, 3, 12]], ['a.pspray', [0.3, 2, 8]], ['a.rev', [0.1, 0.4, 1]],
    ['a.width', [1.2, 1.6, 2]], ['a.tone', [-0.1, -0.4, -0.8]], ['a.drive', [0.1, 0.4, 1]], ['a.crush', [0.1, 0.4, 1]], ['a.wow', [0.1, 0.4, 1]], ['a.comb', [0.1, 0.4, 1]],
    ['a.dsend', [0.1, 0.4, 1]], ['a.rsend', [0.1, 0.4, 1]], ['x.damt', [0.1, 0.4, 1]], ['x.ramt', [0.1, 0.4, 1]], ['x.tone', [-0.1, -0.4, -0.8]], ['x.drive', [0.1, 0.4, 1]], ['x.crush', [0.1, 0.4, 1]],
    ['m.smear', [0.2, 0.5, 0.9]], ['m.shift', [0.05, 0.3, 1]]];
  // pitch: how far the spectral centroid moved, in octaves (should track the semitones)
  const centroid = (o) => { const re = new Float64Array(FFTN), im = new Float64Array(FFTN); let num = 0, den = 0;
    for (let st = SR; st + FFTN < 4 * SR; st += FFTN) { for (let i = 0; i < FFTN; i++) { re[i] = o[st + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFTN)); im[i] = 0 } fft(re, im, false); for (let k = 1; k < FFTN / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * k; den += m } }
    return num / den; };
  const c0 = centroid(base);
  const cdev = (o) => Math.abs(Math.log2(centroid(o) / c0));
  const TIMEY = new Set(['a.speed', 'a.stretch', 'a.pspray']);
  for (const [k, vals] of FADERS) {
    const f = k === 'a.pitch' ? cdev : TIMEY.has(k) ? sdev : dev;
    const d = vals.map(v => f(render(fresh({ [k]: v }), 4, true).out));
    const ok = d[0] > 0.002 && d[2] > d[0] * 1.3 && d.every(Number.isFinite);
    test(`${k} changes the sound gradually`, ok, d.map(x => x.toFixed(3)).join(' → '));
  }
}
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
  const ext = { 'a.tone': -1, 'a.res': 1, 'a.drive': 1, 'a.crush': 1, 'a.wow': 1, 'a.comb': 1, 'a.dsend': 1, 'a.rsend': 1, 'a.grain': 1, 'a.stretch': 1, 'b.tone': 1, 'b.res': 1, 'b.drive': 1, 'b.crush': 1,
    'b.wow': 1, 'b.comb': 1, 'b.dsend': 1, 'b.rsend': 1, 'b.speed': -2, 'b.dmul': 3, 'b.size': 400, 'b.pitch': 24, 'b.pspray': 12, 'm.mode': 2, 'm.smear': 0.98, 'm.shift': 1,
    'x.tone': 0.5, 'x.res': 1, 'x.drive': 1, 'x.crush': 0.5, 'x.dfb': 0.97, 'x.damt': 1, 'x.rsize': 1, 'x.ramt': 1, 'x.level': 1.2 };
  for (const k in ext) e.handle({ t: 'p', k, v: ext[k] });
  const r = render(e, 8);
  test('all effects at extremes stay finite and bounded', r.nan === 0 && r.peak <= 1, `peak ${r.peak.toFixed(3)} rms ${r.rms.toFixed(3)}`);
  e.handle({ t: 'p', k: 'm.freeze', v: 1 }); e.handle({ t: 'p', k: 'a.mute', v: 1 }); e.handle({ t: 'p', k: 'b.mute', v: 1 });
  const fr = render(e, 3);
  test('freeze keeps sounding with both tracks muted', fr.rms > 0.005 && fr.nan === 0, `rms ${fr.rms.toFixed(4)}`);
}
{
  // mix at the centre: one loaded track plays at full level; exchange reads B's file through A's grains
  const e = fresh({ 'b.solo': 1, 'x.ramt': 0 });
  const r = render(e, 2);
  test('soloing the empty track silences the other', r.rms < 1e-3, `rms ${r.rms.toExponential(2)}`);
  const pad = src('pad', 6), e2 = fresh({ 'm.mode': 1, 'm.amount': 1, 'b.mute': 1 });
  e2.handle({ t: 'buf', track: 1, frames: pad.frames, data: pad.data });
  const r2 = render(e2, 3);
  test('exchange at B end: track A sounds with B material', r2.rms > 0.02 && r2.nan === 0, `rms ${r2.rms.toFixed(3)}`);
  const e3 = fresh(); e3.handle({ t: 'seek', track: 0, pos: 0.5 }); render(e3, 0.01);
  test('seek moves the playhead', Math.abs(e3.status().pa_h - 0.5) < 0.01, `pos ${e3.status().pa_h.toFixed(3)}`);
}
{
  const e = new (D.Engine)(SR); e.handle({ t: 'run', v: 1 });
  const a = src('rain', 6), b = src('pad', 6);
  e.handle({ t: 'buf', track: 0, frames: a.frames, data: a.data }); e.handle({ t: 'buf', track: 1, frames: b.frames, data: b.data });
  for (const [k, v] of [['m.mode', 3], ['a.grain', 1], ['b.grain', 1], ['a.dmul', 3], ['b.dmul', 3], ['a.size', 400], ['b.size', 400], ['a.wow', 1], ['b.wow', 1], ['a.comb', 1], ['m.smear', 0.5]]) e.handle({ t: 'p', k, v });
  const r = render(e, 10);
  test('worst case renders 10 s faster than 3.5 s', r.ms < 3500, `${r.ms} ms for 10 s`);
}
let fail = 0;
for (const [r, l, i] of results) { console.log(r, l, '—', i); if (r === 'FAIL') fail++; }
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
