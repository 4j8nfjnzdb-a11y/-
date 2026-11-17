// Offline tests for the RENSETSU engine. Usage: node tools/test.js
const RS = require('../src/engine.js');
const SR = 48000;
const results = [];
const test = (label, ok, info) => results.push([ok ? 'ok  ' : 'FAIL', label, info || '']);

// synthetic material: clicks, plucked tones, noise bursts and tones with an inner onset, at irregular times
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function makeMaterial(sec, seed) {
  const r = lcg(seed), n = Math.round(SR * sec), x = new Float32Array(n), onsets = [];
  let t = 0.25;
  while (t < sec - 0.5) {
    const at = Math.round(t * SR), kind = Math.floor(r() * 4), amp = 0.08 + 0.5 * r();
    onsets.push(at);
    if (kind === 0) { // click
      const len = Math.round(0.004 * SR);
      for (let i = 0; i < len; i++) x[at + i] += amp * (r() * 2 - 1) * Math.exp(-i / (0.0008 * SR));
    } else if (kind === 1) { // pluck
      const f = 120 * Math.pow(2, r() * 3.3), len = Math.round((0.15 + 0.4 * r()) * SR);
      for (let i = 0; i < len && at + i < n; i++) { const e = Math.exp(-i / (0.08 * SR)); x[at + i] += amp * e * (Math.sin(2 * Math.PI * f * i / SR) + 0.4 * Math.sin(4 * Math.PI * f * i / SR)); }
    } else if (kind === 2) { // noise burst through a one-pole filter
      const len = Math.round((0.03 + 0.12 * r()) * SR), a = 0.05 + 0.9 * r(); let y = 0;
      for (let i = 0; i < len && at + i < n; i++) { y = a * y + (1 - a) * (r() * 2 - 1); x[at + i] += amp * 2 * y * Math.exp(-i / (0.04 * SR)); }
    } else { // tone with a second attack inside it
      const f = 200 * Math.pow(2, r() * 2), len = Math.round(0.35 * SR), in2 = Math.round(0.09 * SR);
      onsets.push(at + in2);
      for (let i = 0; i < len && at + i < n; i++) { const e = Math.exp(-i / (0.2 * SR)) * (i >= in2 ? 1.8 : 1) * Math.min(1, i / 60); x[at + i] += amp * 0.6 * e * Math.sin(2 * Math.PI * f * i / SR) * (i >= in2 ? (1 + 0.5 * Math.sin(2 * Math.PI * f * 1.5 * i / SR)) : 1); }
    }
    t += 0.06 + 0.5 * Math.pow(r(), 1.7) + (r() < 0.06 ? 1.2 : 0);
  }
  return { x, onsets };
}

// a material whose own cues agree: an ostinato of three close rising notes, an accent on the first, then a gap
function makeGrouped(sec, seed) {
  const r = lcg(seed), n = Math.round(SR * sec), x = new Float32Array(n);
  let t = 0.2;
  while (t < sec - 1) {
    for (let k = 0; k < 3; k++) {
      const at = Math.round(t * SR), f = 330 * Math.pow(2, k * 2 / 12), len = Math.round(0.11 * SR), amp = (k === 0 ? 0.5 : 0.22) * (0.95 + 0.1 * r());
      for (let i = 0; i < len && at + i < n; i++) x[at + i] += amp * Math.exp(-i / (0.035 * SR)) * Math.min(1, i / 30, (len - i) / 240) * Math.sin(2 * Math.PI * f * i / SR);
      t += 0.13;
    }
    t += 0.33;
  }
  return { x };
}
async function load(sec, seed, id) {
  const { x, onsets } = makeMaterial(sec, seed);
  const m = new RS.Mat(id, SR, x.length, false);
  await RS.analyzeFile(m, x);
  return { m, onsets };
}

const P0 = () => ({ maxLen: 200, sens: 50, density: 50, N: 8, cues: { a: true, b: true, c: true, d: true, e: true } });
function run(mats, seed, steps, on, P, hook) {
  const st = RS.newState(seed), out = [];
  for (let i = 0; i < steps; i++) {
    if (hook) hook(st, i, out);
    const r = RS.decide(st, mats, P || P0(), typeof on === 'function' ? on(i) : on);
    if (!r) break;
    out.push(r);
  }
  return { st, out };
}
const sig = recs => JSON.stringify(recs.map(r => [r.m, r.s, r.e, r.ioi.toFixed(9), r.L.toFixed(6), r.ks, r.ke]));
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

(async () => {
  const A = await load(30, 7, 1), B = await load(12, 99, 2);
  const mats = [A.m, B.m];

  // --- analysis: candidates near the true onsets ---
  {
    const thr = RS.sensThr(50), c = A.m.cands(thr, 0, A.m.end);
    const tol = Math.round(0.02 * SR);
    const hit = A.onsets.filter(o => c.some(p => Math.abs(p - o) <= tol)).length;
    const prec = c.filter(p => A.onsets.some(o => Math.abs(p - o) <= tol)).length;
    test('candidate boundaries find most onsets at sensitivity 50', hit / A.onsets.length > 0.8, `recall ${(hit / A.onsets.length).toFixed(2)} precision ${(prec / c.length).toFixed(2)} (${c.length} candidates, ${A.onsets.length} onsets)`);
    const c0 = A.m.count(RS.sensThr(0)), c100 = A.m.count(RS.sensThr(100));
    test('sensitivity changes how many candidates there are', c0 < c.length && c.length < c100, `${c0} < ${c.length} < ${c100}`);
  }

  // --- determinism ---
  const t0 = Date.now();
  const r1 = run(mats, 0x3a91f2c4, 600, true);
  const ms = (Date.now() - t0) / 600;
  const r2 = run(mats, 0x3a91f2c4, 600, true);
  const r3 = run(mats, 0x12345678, 600, true);
  test('same seed and material give the same output', sig(r1.out) === sig(r2.out), `${r1.out.length} units`);
  test('another seed gives another output', sig(r1.out) !== sig(r3.out));
  test('a choice takes little time', ms < 25, `${ms.toFixed(1)} ms per unit`);

  // --- ON: no grid, monophonic, units within the length limit ---
  const on = r1.out;
  {
    let simple = 0;
    for (let i = 1; i < on.length; i++) if (RS.nearSimple(on[i].ioi, on[i - 1].ioi, 0.02)) simple++;
    test('engine ON: consecutive intervals avoid simple ratios', simple === 0, `${simple}/${on.length - 1} near simple ratios`);
    const lg = on.map(r => Math.log2(r.ioi)), m = mean(lg), sd = Math.sqrt(mean(lg.map(v => (v - m) ** 2)));
    test('engine ON: intervals are not grid + jitter (spread)', sd > 0.25, `log2 sd ${sd.toFixed(2)}, mean ${(Math.pow(2, m) * 1000).toFixed(0)} ms`);
    test('engine ON: density sets the mean interval', Math.abs(m - Math.log2(RS.ioiCenter(50))) < 0.25, `mean ${(Math.pow(2, m) * 1000).toFixed(0)} ms, density 50 → ${(RS.ioiCenter(50) * 1000).toFixed(0)} ms`);
    {
      const P = P0(); P.density = 85;
      const d = run(mats, 0x3a91f2c4, 200, true, P).out.slice(20), md = mean(d.map(r => Math.log2(r.ioi)));
      test('engine ON: higher density, shorter intervals', md < m - 0.6, `density 85 → mean ${(Math.pow(2, md) * 1000).toFixed(0)} ms`);
    }
    let gridy = 0;
    for (let i = 8; i < on.length; i++) {
      const v = on.slice(i - 8, i).map(r => r.ioi); let best = 0;
      for (const base of v) for (let div = 1; div <= 3; div++) { const T = base / div; let f = 0; for (const x of v) { const k = Math.round(x / T); if (k >= 1 && k <= 4 && Math.abs(Math.log2(x / (k * T))) < 0.05) f++; } best = Math.max(best, f); }
      if (best >= 7) gridy++;
    }
    test('engine ON: no stretch of 8 intervals sits on one grid', gridy / (on.length - 8) < 0.02, `${gridy} of ${on.length - 8} windows`);
    test('engine ON: one sound at a time (sounding ≤ interval)', on.every(r => r.snd <= r.ioi - 0.0029));
    test('engine ON: unit length ≤ 200 ms', on.every(r => (r.e - r.s) / SR <= 0.2 + 1e-6));
    const kinds = {}; for (const r of on) { const k = r.ks + '/' + r.ke; kinds[k] = (kinds[k] || 0) + 1; }
    test('engine ON: several ways of cutting are used', Object.keys(kinds).length >= 4, JSON.stringify(kinds));
    // the same place: one unit, part of a merged unit, a tail
    const roles = new Map();
    for (const r of on) {
      const key = r.m + ':';
      if (r.ks === 'cand') roles.set(key + r.s, (roles.get(key + r.s) || new Set()).add(r.ke === 'merge' ? 'merge' : 'one'));
      for (const p of r.absorbed) roles.set(key + p, (roles.get(key + p) || new Set()).add('absorbed'));
      if (r.ks === 'tail') for (const p of r.skipped) roles.set(key + p, (roles.get(key + p) || new Set()).add('tail-of'));
    }
    const multi = [...roles.values()].filter(s => s.size >= 2).length;
    test('the same candidate is cut differently at different times', multi >= 5, `${multi} places with 2+ roles`);
    const lv = new Set(on.map(r => r.lv)); test('engine ON: levels vary', lv.size >= 3, [...lv].join(','));
    const Sm = {}; for (const c of RS.CUES) Sm[c] = mean(on.slice(20).map(r => r.S[c]));
    const over = {}; for (const c of RS.CUES) over[c] = on.slice(20).filter(r => r.S[c] > RS.TH_HI[c]).length / (on.length - 20);
    test('engine ON: no cue stays above its threshold', Object.values(over).every(v => v < 0.2), 'mean S ' + JSON.stringify(Object.fromEntries(Object.entries(Sm).map(([k, v]) => [k, +v.toFixed(2)]))) + ' over ' + JSON.stringify(Object.fromEntries(Object.entries(over).map(([k, v]) => [k, +v.toFixed(2)]))));
    test('engine ON: cues are present (not pure continuum)', mean(Object.values(Sm)) > RS.TH_LO);
    const dOn = mean(on.slice(20).map(r => r.dis));
    const off = run(mats, 0x3a91f2c4, 600, false).out;
    const dOff = mean(off.slice(20).map(r => r.dis));
    test('engine ON makes cues disagree more than the material on its own', dOn > dOff * 1.3, `ON ${dOn.toFixed(3)} OFF ${dOff.toFixed(3)}`);
    const brk = on.filter(r => r.broken !== '-').length;
    test('broken boundaries are logged', brk > 10, `${brk} entries, e.g. ${on.filter(r => r.broken !== '-').slice(0, 3).map(r => r.broken).join(' / ')}`);
    // repetition of patterns
    const eMean = mean(on.slice(20).map(r => r.S.e)), eOff = mean(off.slice(20).map(r => r.S.e));
    test('pattern repetition stays low', eMean < RS.TH_HI.e, `ON ${eMean.toFixed(2)} OFF ${eOff.toFixed(2)}`);
  }

  // --- OFF: the material's own order and intervals ---
  {
    const off = run(mats, 1, 400, false).out;
    let ordered = true, recIoi = true;
    for (let i = 1; i < off.length; i++) {
      const a = off[i - 1], b = off[i];
      if (a.m === b.m && b.s <= a.s) ordered = false;
      if (a.m === b.m && a.ke === 'next' && Math.abs((b.s - a.s) / SR - a.ioi) > 1e-9) recIoi = false;
    }
    test('engine OFF: units follow the recording in order', ordered);
    test('engine OFF: intervals are the recorded ones', recIoi);
    test('engine OFF: goes on to the next material', off.some(r => r.m === 1) && off.some(r => r.m === 0));
  }

  // --- switching keeps the place ---
  {
    const sw = run(mats, 5, 300, i => (Math.floor(i / 40) % 2) === 0).out;
    let jumpOk = true;
    for (let i = 40; i < sw.length; i += 80) { const a = sw[i - 1], b = sw[i]; if (b.m === a.m && Math.abs(b.s - a.s) > 4 * SR) jumpOk = false; }
    test('switching ON→OFF continues near the same place', jumpOk && sw.length === 300, sw.slice(38, 42).map(r => `${r.eng}@${(r.s / SR).toFixed(2)}`).join(' '));
  }

  // --- taps ---
  {
    const res = run(mats, 9, 200, true, null, (st, i, out) => {
      if (i === 80 || i === 86 || i === 92) st.pendingTaps.push({ id: i, u: out[out.length - 2].n });
    });
    const t = res.out.flatMap(r => r.taps || []);
    test('taps are applied when ON', t.length === 3 && t.every(x => x.applied && x.support), JSON.stringify(t.map(x => x.support && Object.fromEntries(Object.entries(x.support).map(([k, v]) => [k, +v.toFixed(2)])))));
    const w = res.st.w; test('the listener model changes with taps', Object.values(w).some(v => Math.abs(v - 0.2) > 0.005), JSON.stringify(Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +v.toFixed(3)]))));
    const base = run(mats, 9, 200, true).out;
    test('taps change what follows', sig(base.slice(81)) !== sig(res.out.slice(81)) && sig(base.slice(0, 80)) === sig(res.out.slice(0, 80)));
    const rOff = run(mats, 9, 120, false, null, (st, i, out) => { if (i === 60) st.pendingTaps.push({ id: 1, u: out[out.length - 2].n }); });
    const bOff = run(mats, 9, 120, false).out;
    test('taps with engine OFF are recorded only', sig(rOff.out) === sig(bOff) && Object.values(rOff.st.w).every(v => v === 0.2) && rOff.out.flatMap(r => r.taps || []).length === 1);
  }

  // --- a grouped material: OFF keeps its groups, ON breaks them ---
  {
    const { x } = makeGrouped(40, 3), m = new RS.Mat(5, SR, x.length, false);
    await RS.analyzeFile(m, x);
    const gOff = run([m], 4, 250, false).out.slice(20), gOn = run([m], 4, 250, true).out.slice(20);
    const d0 = mean(gOff.map(r => r.dis)), d1 = mean(gOn.map(r => r.dis));
    const o0 = gOff.filter(r => r.S.e > RS.TH_HI.e).length / gOff.length, o1 = gOn.filter(r => r.S.e > RS.TH_HI.e).length / gOn.length;
    test('grouped material: ON makes the cues disagree where OFF lets them agree', d1 > d0 * 1.5, `dis OFF ${d0.toFixed(3)} ON ${d1.toFixed(3)}`);
    test('grouped material: the repeating pattern settles in OFF, not in ON', o0 > 0.3 && o1 < 0.05, `units with repetition above threshold: OFF ${(o0 * 100).toFixed(0)}% ON ${(o1 * 100).toFixed(0)}%`);
  }

  // --- disabling cues ---
  {
    const P = P0(); P.cues = { a: true, b: false, c: true, d: false, e: true };
    const o = run(mats, 3, 200, true, P).out;
    test('cue toggles change the choice', sig(o) !== sig(r1.out.slice(0, 200)));
  }

  // --- live material: a ring that keeps sliding ---
  {
    const { x } = makeMaterial(40, 5);
    const m = new RS.Mat(9, SR, 10 * SR, true), st = RS.newState(42), P = P0(); let made = 0, waited = 0;
    for (let i = 0; i < x.length; i += 2048) {
      m.append(x.subarray(i, i + 2048));
      if (i % (2048 * 8) === 0 && m.dur > 1.5) { const r = RS.decide(st, [m], P, true); if (r) { made++; if (r.s < m.start || r.e > m.end) made = -1e9; } else waited++; }
    }
    test('live ring keeps the last N seconds', Math.abs(m.dur - 10) < 0.05 && m.peaks.every(p => p.pos >= m.start), `${m.dur.toFixed(2)} s, ${m.peaks.length} candidates`);
    test('engine picks units inside the live buffer', made > 50, `${made} units, waited ${waited}`);
    m.frozen = true; let ok = 0;
    for (let i = 0; i < 300; i++) if (RS.decide(st, [m], P, i % 2 === 0)) ok++;
    test('a frozen live buffer goes round', ok === 300);
  }

  // --- render ---
  {
    const r = on[10], out = RS.render(mats[r.m], r);
    let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v));
    test('rendered unit: attack from silence, faded end, no clipping', Math.abs(out[0]) < 1e-3 && Math.abs(out[out.length - 1]) < 1e-3 && pk <= 0.95, `len ${out.length} peak ${pk.toFixed(2)}`);
  }

  for (const [s, l, i] of results) console.log(s, l, i ? '— ' + i : '');
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
