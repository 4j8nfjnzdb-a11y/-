// Kasane — reading sound, and tying it to pictures.
//
// 1. A sound is cut into components from several viewpoints at once, none of them privileged:
//      loudness and bands · attacks · P/M/V/R/S (pulse, long/short, sense of speed, breathing, silence)
//      · what a listener would expect next, and where the sound keeps or breaks that promise · pitch class.
// 2. A "relation" ties one component to one property of a layer, with an attitude: trace it, oppose it,
//    store it up and release, count and betray, take one step per event, or refuse to listen.
//    Number sequences (Thue–Morse, sieves, the logistic map ...) can stand in for the sound.
// 3. Rules can re-wire the relations while the piece runs.
// Everything is worked out ahead of time over the whole duration, so scrubbing, looping and export
// always give the same result — and a picture may answer a sound before it happens.
'use strict';
(() => {
  const U = KS.U, M = KS.M;
  const SD = KS.Sound = { CR: 100, an: new Map(), pending: new Set(), ver: 0 };
  const CR = 100, N = 1024, HALF = N / 2;

  // ---------------------------------------------------------------- FFT
  const rev = new Uint16Array(N), cosT = new Float32Array(HALF), sinT = new Float32Array(HALF), hann = new Float32Array(N);
  { const bits = Math.log2(N); for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); }
    for (let k = 0; k < HALF; k++) { cosT[k] = Math.cos(2 * Math.PI * k / N); sinT[k] = Math.sin(2 * Math.PI * k / N); } }
  function fft(re, im) {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half, tr = re[b] * cosT[k] + im[b] * sinT[k], ti = im[b] * cosT[k] - re[b] * sinT[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  SD.fft = fft; SD.N = N;
  const pct = (a, p) => { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };
  const smooth = (a, r) => {                    // zero-phase moving average, radius r frames
    const n = a.length, o = new Float32Array(n), ps = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + a[i];
    for (let i = 0; i < n; i++) { const lo = Math.max(0, i - r), hi = Math.min(n, i + r + 1); o[i] = (ps[hi] - ps[lo]) / (hi - lo); }
    return o;
  };

  // ---------------------------------------------------------------- analysis
  // mono: Float32Array of samples. Returns { n, dur, sig: {name: Float32Array @100 Hz}, kind: {name: 'cont'|'imp'|'bip'},
  //   beats: [frame], onsets: [{n, s}], period: Float32Array (frames per beat), peaks }
  SD.analyzeMono = async (mono, sr, onProgress) => {
    const L = mono.length, hop = sr / CR, nF = Math.max(8, Math.floor(L / hop));
    const F = () => new Float32Array(nF);
    const rms = F(), wave = F(), pkMin = F(), pkMax = F(), flux = F(), fxl = F(), fxm = F(), fxh = F(), cent = F(), flat = F(), toneRaw = F(), tonal = F();
    const bl = [F(), F(), F(), F()];
    const re = new Float32Array(N), im = new Float32Array(N), lm = new Float32Array(HALF + 1), plm = new Float32Array(HALF + 1);
    const hz = sr / N, bin = (f) => U.clamp(Math.round(f / hz), 1, HALF);
    const edges = [bin(20), bin(150), bin(600), bin(2500), bin(12000)], kLo = bin(150), kHi = bin(2500), c0 = bin(60), c1 = bin(10000), f0 = bin(100), f1 = bin(8000);
    const pcOf = new Int8Array(HALF + 1).fill(-1);
    for (let k = bin(80); k <= bin(4000); k++) pcOf[k] = ((Math.round(12 * Math.log2(k * hz / 440)) % 12) + 12 + 9) % 12;   // C = 0
    const chroma = new Float32Array(12);
    for (let n = 0; n < nF; n++) {
      const c = Math.round(n * hop), s0 = c - HALF, hEnd = Math.min(L, Math.round((n + 1) * hop));
      for (let i = 0; i < N; i++) { const j = s0 + i; re[i] = j >= 0 && j < L ? mono[j] * hann[i] : 0; im[i] = 0; }
      let sum = 0, mn = 0, mx = 0, pk = 0;
      for (let i = c; i < hEnd; i++) { const x = mono[i]; sum += x * x; if (x < mn) mn = x; if (x > mx) mx = x; if (Math.abs(x) > Math.abs(pk)) pk = x; }
      rms[n] = Math.sqrt(sum / Math.max(1, hEnd - c)); pkMin[n] = mn; pkMax[n] = mx; wave[n] = pk;
      fft(re, im);
      let fl = 0, fL = 0, fM = 0, fH = 0, cs = 0, cw = 0, gs = 0, as = 0, gc = 0;
      const be = [0, 0, 0, 0]; chroma.fill(0);
      for (let k = 1; k <= HALF; k++) {
        const mag = Math.hypot(re[k], im[k]) / (N / 4), l = Math.log(1 + 50 * mag), d = l - plm[k];
        lm[k] = l;
        if (d > 0) { fl += d; if (k < kLo) fL += d; else if (k < kHi) fM += d; else fH += d; }
        for (let b = 0; b < 4; b++) if (k >= edges[b] && k < edges[b + 1]) be[b] += mag * mag;
        if (k >= c0 && k <= c1) { cs += k * hz * mag; cw += mag; }
        if (k >= f0 && k <= f1) { gs += Math.log(mag + 1e-7); as += mag; gc++; }
        if (pcOf[k] >= 0) chroma[pcOf[k]] += mag * mag;
      }
      plm.set(lm);
      flux[n] = fl; fxl[n] = fL; fxm[n] = fM; fxh[n] = fH;
      for (let b = 0; b < 4; b++) bl[b][n] = Math.sqrt(be[b]);
      cent[n] = cw > 1e-6 ? U.clamp((Math.log2(cs / cw) - Math.log2(120)) / (Math.log2(7000) - Math.log2(120)), 0, 1) : 0;
      flat[n] = gc && as > 1e-6 ? U.clamp(Math.exp(gs / gc) / (as / gc + 1e-7), 0, 1) : 0;
      let cm = 0, ci = 0, ct = 0; for (let i = 0; i < 12; i++) { ct += chroma[i]; if (chroma[i] > cm) { cm = chroma[i]; ci = i; } }
      toneRaw[n] = ci; tonal[n] = ct > 1e-9 ? U.clamp((cm / ct - 1 / 12) * 2.2, 0, 1) : 0;
      if (n % 400 === 399) { if (onProgress) onProgress(n / nF * 0.8); await new Promise((r) => setTimeout(r, 0)); }
    }

    // ---- scale everything to 0..1 against the piece itself (a quiet piece is still full-range inside its own world)
    const sig = {}, kind = {};
    const put = (name, arr, k = 'cont') => { sig[name] = arr; kind[name] = k; };
    const peak = Math.max(pct(rms, 0.98), 1e-5), level = F();
    for (let n = 0; n < nF; n++) level[n] = U.clamp((20 * Math.log10(rms[n] / peak + 1e-7) + 48) / 48, 0, 1);
    put('level', level);
    ['low', 'lowmid', 'mid', 'high'].forEach((name, b) => {
      const ref = Math.max(pct(bl[b], 0.98), 1e-6), o = F();
      for (let n = 0; n < nF; n++) o[n] = U.clamp((20 * Math.log10(bl[b][n] / ref + 1e-7) + 40) / 40, 0, 1);
      put(name, o);
    });
    const norm = (a) => { const r = Math.max(pct(a, 0.98), 1e-6), o = F(); for (let n = 0; n < nF; n++) o[n] = Math.min(1.5, a[n] / r); return o; };
    const fluxN = norm(flux);
    put('flux', smooth(fluxN, 1).map((x) => Math.min(1, x)));
    put('bright', smooth(cent, 2)); put('noisy', smooth(flat, 2)); put('tonal', smooth(tonal, 4));
    const wpk = Math.max(pct(wave.map(Math.abs), 0.995), 1e-5); put('wave', wave.map((x) => U.clamp(x / wpk, -1, 1)), 'bip');
    // pitch class as a place on the circle of fifths (neighbouring hues = neighbouring keys); held while the pitch is unclear
    { const o = F(); let cur = 0; for (let n = 0; n < nF; n++) { if (tonal[n] > 0.12 && level[n] > 0.1) cur = ((toneRaw[n] * 7) % 12) / 12; o[n] = cur; } put('tone', o); }

    // ---- attacks: peaks of spectral flux above their surroundings
    const pick = (a) => {
      const s = smooth(a, 1), mean = smooth(a, 10), imp = F(), list = [];
      let last = -99;
      for (let n = 2; n < nF - 2; n++) {
        const th = mean[n] * 1.35 + 0.05;
        if (s[n] > th && s[n] >= s[n - 1] && s[n] >= s[n + 1] && s[n] >= s[n - 2] && s[n] >= s[n + 2]) {
          const st = Math.min(1, (s[n] - th) / 0.9 + 0.25);
          if (n - last < 5) { if (st > imp[last]) { imp[last] = 0; list.pop(); } else continue; }
          imp[n] = st; list.push({ n, s: st }); last = n;
        }
      }
      return { imp, list };
    };
    const on = pick(fluxN); put('hit', on.imp, 'imp');
    put('hitL', pick(norm(fxl)).imp, 'imp'); put('hitM', pick(norm(fxm)).imp, 'imp'); put('hitH', pick(norm(fxh)).imp, 'imp');
    const onsets = on.list;
    if (onProgress) onProgress(0.85);

    // ---- P: pulse. Local period from the autocorrelation of the attack curve, then beats by dynamic programming
    // (Ellis 2007). "pulseness" says how much of a pulse there is to speak of, so nothing has to pretend.
    const env = smooth(fluxN, 1);
    const acf = (a, b) => {
      const len = b - a; let mean = 0; for (let i = a; i < b; i++) mean += env[i]; mean /= len;
      let r0 = 0; for (let i = a; i < b; i++) r0 += (env[i] - mean) ** 2;
      let best = -1, bl2 = 50, br = 0;
      for (let lag = 25; lag <= Math.min(160, len >> 1); lag++) {
        let r = 0; for (let i = a; i < b - lag; i++) r += (env[i] - mean) * (env[i + lag] - mean);
        r /= Math.max(1e-9, r0) * (len - lag) / len;
        const w = Math.exp(-0.5 * (Math.log2(lag / 55) / 1.2) ** 2), sc = r * w;
        if (sc > best) { best = sc; bl2 = lag; br = r; }
      }
      return { lag: bl2, conf: U.clamp(br * 1.5, 0, 1) };
    };
    const win = Math.min(800, nF), hopW = 200, wins = [];
    for (let a = 0; a + win <= nF || !wins.length; a += hopW) { const s = Math.min(a, Math.max(0, nF - win)); wins.push(Object.assign({ c: s + win / 2 }, acf(s, Math.min(nF, s + win)))); if (a + win >= nF) break; }
    for (let i = 0; i < wins.length; i++) {      // median of neighbours steadies the period
      const ls = []; for (let j = Math.max(0, i - 2); j <= Math.min(wins.length - 1, i + 2); j++) ls.push(wins[j].lag);
      ls.sort((x, y) => x - y); wins[i].p = ls[ls.length >> 1];
    }
    const period = F(), pulseness = F();
    for (let n = 0, w = 0; n < nF; n++) {
      while (w < wins.length - 1 && Math.abs(wins[w + 1].c - n) < Math.abs(wins[w].c - n)) w++;
      period[n] = wins[w].p; pulseness[n] = wins[w].conf;
    }
    put('pulseness', smooth(pulseness, 60));
    let sd = 0; for (let n = 0; n < nF; n++) sd += env[n] * env[n]; sd = Math.sqrt(sd / nF) || 1;
    const score = new Float32Array(nF), prev = new Int32Array(nF).fill(-1);
    for (let n = 0; n < nF; n++) {
      const P = period[n], lo = Math.max(0, n - Math.round(2 * P)), hi = n - Math.round(P / 2);
      let best = 0, bi = -1;
      for (let m = lo; m <= hi; m++) { const d = Math.log((n - m) / P), v = score[m] - 100 * d * d; if (v > best) { best = v; bi = m; } }
      score[n] = env[n] / sd + best; prev[n] = bi;
    }
    let end = nF - 1; { const from = Math.max(0, nF - Math.round(period[nF - 1] * 1.5)); for (let n = from; n < nF; n++) if (score[n] > score[end]) end = n; }
    const beats = []; for (let n = end; n >= 0; n = prev[n]) { beats.push(n); if (prev[n] < 0) break; }
    beats.reverse();
    // fill the edges so there is a grid from start to finish
    while (beats.length && beats[0] - period[beats[0]] > 0) beats.unshift(Math.round(beats[0] - period[beats[0]]));
    while (beats.length && beats[beats.length - 1] + period[beats[beats.length - 1]] < nF) beats.push(Math.round(beats[beats.length - 1] + period[beats[beats.length - 1]]));
    if (beats.length < 2) { beats.length = 0; for (let n = 0; n < nF; n += 50) beats.push(n); }
    const pulse = F(), beat = F(), pn = sig.pulseness;
    for (let i = 0; i < beats.length; i++) {
      const a = beats[i], b = i + 1 < beats.length ? beats[i + 1] : nF;
      if (a >= 0 && a < nF) beat[a] = 0.35 + 0.65 * pn[a];
      for (let n = Math.max(0, a); n < Math.min(nF, b); n++) pulse[n] = (n - a) / Math.max(1, b - a);
    }
    put('pulse', pulse); put('beat', beat, 'imp');

    // ---- expectation: the finest grid that most attacks sit on. Then every grid point is either kept (an attack
    // arrives) or broken (nothing comes), and every attack is either on the grid or a surprise.
    const near = (g, tol) => { let lo = 0, hi = onsets.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (onsets[mid].n < g) lo = mid + 1; else hi = mid; } let d = 1e9; for (const j of [lo - 1, lo]) if (j >= 0 && j < onsets.length) d = Math.min(d, Math.abs(onsets[j].n - g)); return d <= tol; };
    const gridOf = (s) => { const g = []; for (let i = 0; i + 1 < beats.length; i++) for (let j = 0; j < s; j++) g.push({ n: Math.round(beats[i] + (beats[i + 1] - beats[i]) * j / s), main: j === 0, gap: (beats[i + 1] - beats[i]) / s }); if (beats.length > 1) g.push({ n: beats[beats.length - 1], main: true, gap: (beats[beats.length - 1] - beats[beats.length - 2]) / s }); return g; };
    let sub = 1, cover4 = 0;
    const cover = (s) => { const g = gridOf(s); if (!onsets.length) return 0; let hit = 0; const set = new Int32Array(nF).fill(-1); g.forEach((p) => { if (p.n >= 0 && p.n < nF) set[p.n] = 1; }); for (const o of onsets) { const tol = Math.max(2, Math.round((g[0] ? g[0].gap : 50) * 0.16)); let ok = false; for (let d = -tol; d <= tol && !ok; d++) if (set[o.n + d] === 1) ok = true; if (ok) hit += o.s; } let tot = 0; for (const o of onsets) tot += o.s; return hit / Math.max(1e-6, tot); };
    cover4 = cover(4); for (const s of [1, 2, 3, 4]) if (cover(s) >= cover4 * 0.9 || s === 4) { sub = s; break; }
    const grid = gridOf(sub), expected = F(), omission = F(), surprise = F();
    // "something was being played here": an attack within the last two seconds
    const heard = new Uint8Array(nF); for (const o of onsets) for (let n = o.n; n < Math.min(nF, o.n + 200); n++) heard[n] = 1;
    const onGrid = new Uint8Array(nF);
    for (const g of grid) {
      if (g.n < 0 || g.n >= nF) continue;
      const tol = Math.max(2, Math.round(g.gap * 0.18)), w = (g.main ? 1 : 0.55) * (0.25 + 0.75 * pn[g.n]);
      expected[g.n] = w;
      for (let d = -tol; d <= tol; d++) if (g.n + d >= 0 && g.n + d < nF) onGrid[g.n + d] = 1;
      if (!near(g.n, tol) && pn[g.n] > 0.25 && heard[g.n]) omission[g.n] = w;
    }
    for (const o of onsets) if (!onGrid[o.n] && pn[o.n] > 0.2) surprise[o.n] = o.s;
    put('expected', expected, 'imp'); put('omission', omission, 'imp'); put('surprise', surprise, 'imp');
    // a change of colour in the sound as a whole: the last half second against the four seconds before it
    { const feats = [sig.low, sig.lowmid, sig.mid, sig.high, sig.bright, sig.noisy], sh = feats.map((f) => smooth(f, 20)), lg = feats.map((f) => smooth(f, 200)), o = F();
      for (let n = 0; n < nF; n++) { const m = Math.max(0, n - 220); let d = 0; for (let k = 0; k < feats.length; k++) d += (sh[k][n] - lg[k][m]) ** 2; o[n] = Math.sqrt(d); }
      put('novel', norm(smooth(o, 8)).map((x) => Math.min(1, x))); }

    // ---- M: long and short. Each attack starts a sound that lasts until it has faded or the next one arrives.
    const long = F(), short = F(), durs = [];
    for (let i = 0; i < onsets.length; i++) {
      const a = onsets[i].n, b = i + 1 < onsets.length ? onsets[i + 1].n : nF;
      let pk = 0; for (let n = a; n < Math.min(b, a + 15); n++) pk = Math.max(pk, level[n]);
      let e = a + 1; while (e < b && level[e] > pk * 0.55) e++;
      durs.push({ a, e, d: (e - a) / CR });
    }
    for (let i = 0; i < durs.length; i++) {
      const loc = []; for (let j = Math.max(0, i - 12); j <= Math.min(durs.length - 1, i + 12); j++) loc.push(durs[j].d);
      loc.sort((x, y) => x - y); const med = loc[loc.length >> 1] || 0.2, d = durs[i];
      if (d.d > med * 1.6 && d.d > 0.25) for (let n = d.a; n < d.e; n++) long[n] = 1;
      else if (d.d < med * 0.7 || d.d < 0.12) short[d.a] = Math.max(0.4, onsets[i].s);
    }
    put('long', long); put('short', short, 'imp');
    // ---- V: sense of speed — how many things happen per second
    { const o = F(); let j0 = 0, j1 = 0; for (let n = 0; n < nF; n++) { while (j1 < onsets.length && onsets[j1].n < n + 100) j1++; while (j0 < onsets.length && onsets[j0].n < n - 100) j0++; o[n] = (j1 - j0) / 2; } put('velocity', norm(smooth(o, 30)).map((x) => Math.min(1, x))); }
    // ---- R: breathing — loudness on the scale of seconds, and whether it is drawing in or letting go
    { const br = smooth(level, 125), o = F(); for (let n = 1; n < nF - 1; n++) o[n] = br[n + 1] - br[n - 1]; const r = Math.max(pct(o.map(Math.abs), 0.97), 1e-6); put('breath', br); put('swell', o.map((x) => U.clamp(x / r, -1, 1)), 'bip'); }
    // ---- S: silence, and how long it has lasted
    // (the gap between two notes of a steady figure is not silence: a stretch has to outlast the usual spacing of events)
    { const sil = F(), quiet = F(); let run = 0;
      const ioi = []; for (let i = 1; i < onsets.length; i++) ioi.push(onsets[i].n - onsets[i - 1].n); ioi.sort((a, b) => a - b);
      const need = Math.max(30, Math.min(150, Math.round((ioi[ioi.length >> 1] || 20) * 1.5)));
      for (let n = 0; n <= nF; n++) {
        if (n < nF && level[n] < 0.08) { run++; continue; }
        if (run >= need) for (let k = n - run; k < n; k++) { sil[k] = 1; quiet[k] = Math.min(1, (k - (n - run)) / (CR * 4)); }
        run = 0;
      }
      put('silence', sil); put('quiet', quiet); }
    if (onProgress) onProgress(1);
    return { n: nF, dur: L / sr, sr, sig, kind, beats, onsets, period, sub, peaks: { min: pkMin, max: pkMax } };
  };
  SD.analyze = (buf, onProgress) => {
    const L = buf.length, ch = buf.numberOfChannels, mono = new Float32Array(L);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < L; i++) mono[i] += d[i] / ch; }
    return SD.analyzeMono(mono, buf.sampleRate, onProgress).then((an) => { an.mono = mono; return an; });
  };
  SD.get = (assetId) => SD.an.get(assetId) || null;
  // one frame of raw sound for effects that are driven by the wave itself: 512 samples and 256 spectrum bins
  const fr = new Float32Array(N), fi = new Float32Array(N);
  SD.frameData = (an, ts) => {
    const out = new Uint8Array(512 * 4);
    if (!an || !an.mono) { for (let i = 0; i < 512; i++) out[i * 4] = 128; return out; }
    const c = Math.round(ts * an.sr), span = Math.round(an.sr / 30), L = an.mono.length;
    for (let i = 0; i < N; i++) { const j = c - HALF + i; fr[i] = j >= 0 && j < L ? an.mono[j] * hann[i] : 0; fi[i] = 0; }
    fft(fr, fi);
    for (let i = 0; i < 512; i++) {
      const j = c + Math.round(i / 512 * span), x = j >= 0 && j < L ? an.mono[j] : 0, k = 1 + Math.floor(Math.pow(i / 512, 2) * (HALF - 2));
      out[i * 4] = U.clamp(Math.round(128 + x * 127), 0, 255);
      out[i * 4 + 1] = U.clamp(Math.round(Math.log(1 + 40 * Math.hypot(fr[k], fi[k]) / (N / 4)) / Math.log(41) * 255), 0, 255);
      out[i * 4 + 3] = 255;
    }
    return out;
  };

  // names for the pickers, grouped by viewpoint
  SD.GROUPS = [
    ['大きさと帯域', [['level', '音量'], ['low', '低い音'], ['lowmid', '中低'], ['mid', '中ほど'], ['high', '高い音'], ['bright', '明るさ'], ['noisy', 'ざらつき'], ['wave', '波形そのもの']]],
    ['打点', [['hit', 'すべての打点'], ['hitL', '低い打点'], ['hitM', '中の打点'], ['hitH', '高い打点'], ['flux', '変化の量']]],
    ['P·M·V·R·S', [['beat', 'P 拍'], ['pulse', 'P 拍の中の位置'], ['pulseness', 'P 拍らしさ'], ['long', 'M 長い音'], ['short', 'M 短い音'], ['velocity', 'V 速度感'], ['breath', 'R 呼吸'], ['swell', 'R 吸う・吐く'], ['silence', 'S 無音'], ['quiet', 'S 無音の長さ']]],
    ['予測と裏切り', [['expected', '予測された打点'], ['surprise', '予測になかった打点'], ['omission', '来なかった打点'], ['novel', '音色の変わり目']]],
    ['色', [['tone', '音名（五度圏）'], ['tonal', '音程のはっきりさ']]],
  ];
  SD.NAME = {}; for (const [, items] of SD.GROUPS) for (const [id, name] of items) SD.NAME[id] = name;
  SD.LANES = ['level', 'low', 'mid', 'high', 'hit', 'beat', 'long', 'short', 'velocity', 'breath', 'silence', 'expected', 'surprise', 'omission', 'novel', 'tone'];

  // ================================================================ number sequences
  const PHI = (1 + Math.sqrt(5)) / 2;
  const popc = (n) => { let c = 0; while (n) { c += n & 1; n >>>= 1; } return c; };
  const SEQ = KS.Seq = {
    thue: (k) => popc(k) & 1,                                               // 0110 1001 1001 0110 ... never periodic, never random
    fib: (k) => Math.floor((k + 2) / PHI) - Math.floor((k + 1) / PHI),      // the Fibonacci word
    primes: (k) => { if (k < 2) return 0; for (let d = 2; d * d <= k; d++) if (k % d === 0) return 0; return 1; },
    euclid: (k, hits, len, rot = 0) => { len = Math.max(1, len | 0); hits = U.clamp(hits | 0, 0, len); const i = (((k + rot) % len) + len) % len; return (i * hits) % len < hits ? 1 : 0; },
    // Xenakis-style sieve: residue classes joined by | (either) and & (both), e.g. "3@0|4@1" or "2@0&5@3|7@2"
    sieve: (k, expr) => String(expr || '3@0|4@1').split('|').some((term) => term.split('&').every((c) => { const m = /(\d+)\s*@\s*(\d+)/.exec(c); if (!m) return false; const mod = Math.max(1, +m[1]); return k % mod === (+m[2]) % mod; })) ? 1 : 0,
  };
  SD.MATH = [
    ['lfo', 'ゆれ（サイン）'], ['saw', 'のこぎり'], ['thue', 'トゥエ・モース列'], ['fib', 'フィボナッチ語'], ['sieve', 'ふるい'], ['euclid', 'ユークリッド'],
    ['primes', '素数'], ['logistic', 'ロジスティック写像'], ['ca', 'セル・オートマトン'], ['walk', '酔歩'], ['dice', 'サイコロ'],
  ];
  SD.MATHNAME = {}; for (const [id, name] of SD.MATH) SD.MATHNAME[id] = name;

  // ================================================================ relations
  const RL = KS.Rel = { cache: new Map() };
  RL.MODES = [
    ['follow', 'なぞる', '成分の動きにそのまま従う'], ['oppose', '逆らう', '大きいときに引き、小さいときに出る'],
    ['store', '溜めて放つ', '力が溜まったときだけ、自分の間で動く'], ['betray', '数えて裏切る', '何度か従ってから、次の一回を裏切る'],
    ['step', '一歩ずつ', '打点のたびに次の位置へ進んで、そこに留まる'], ['deaf', '聴かない', '音の拍に近いが決して揃わない、自分の拍で動く'],
  ];
  RL.HOW = [['skip', '黙る'], ['opp', '逆へ動く'], ['double', '倍で返す'], ['late', '遅れて返す']];
  RL.OBEY = [['fixed', 'いつも同じ回数'], ['thue', 'トゥエ・モース列で伸び縮み'], ['fib', 'フィボナッチ語で伸び縮み'], ['dice', 'サイコロで決める']];
  RL.STEPS = [['up', '順に上がる'], ['pend', '行って戻る'], ['gold', '黄金比で散らす'], ['rand', 'ばらばら']];
  RL.defAmt = (desc, path) => {
    if (!desc) return 20;
    if (desc.type === 'color') return 100;
    if (path === 'tr.p') return [0, -90];
    if (path === 'tr.s') return [18, 18];
    if (desc.type === 'vec2' || desc.type === 'pt') return [60, 0];
    if (desc.unit === '%') return 35;
    if (desc.unit === '°') return 25;
    if (desc.min !== undefined && desc.max !== undefined) return U.round((desc.max - desc.min) * 0.3, 2);
    return 30;
  };
  RL.create = (desc, path, src, o = {}) => Object.assign({
    id: U.uid('r'), on: true, src: src || { k: 'snd', layer: null, sig: 'hit' }, mode: 'follow', amt: RL.defAmt(desc, path),
    shift: 0, pre: 0, atk: 0.02, rel: 0.22, th: 0, curve: 1, obey: 3, obeySeq: 'thue', how: 'skip', steps: 5, stepPat: 'gold', ratio: 1.618, fill: 2, spin: 0, seed: 1,
    cm: desc && desc.type === 'color' ? 'mix' : undefined, to: desc && desc.type === 'color' ? [0.91, 0.78, 0.29, 1] : undefined,
  }, o);

  const hasSound = (L) => (L.type === 'audio' || L.type === 'video') && KS.Media && KS.Media.audio(L.src);
  RL.soundLayers = (comp) => comp.layers.filter(hasSound);
  RL.sndLayer = (comp, id) => { const L = id ? M.layer(comp, id) : null; return L && hasSound(L) ? L : RL.soundLayers(comp)[0] || null; };
  const compN = (comp) => Math.ceil(comp.dur * CR) + 2;

  // a component of a sounding layer laid out along the composition's own time
  function sndSeries(comp, L, name, shift) {
    const Nc = compN(comp), x = new Float32Array(Nc), an = L ? SD.get(L.src) : null;
    if (!an || !an.sig[name]) return { x, kind: 'cont', ok: false };
    const a = an.sig[name], kind = an.kind[name], sp = L.speed || 1;
    for (let n = 0; n < Nc; n++) {
      const tc = n / CR + shift;
      if (tc < L.in || tc >= L.out) { x[n] = name === 'silence' ? 1 : 0; continue; }
      const f = (tc - L.start) * sp * CR;
      if (kind === 'imp') {                       // an attack must never fall between two samples and vanish
        const i0 = Math.floor(f), i1 = Math.floor(((n + 1) / CR + shift - L.start) * sp * CR); let v = 0;
        for (let i = i0; i < Math.max(i0 + 1, i1); i++) if (i >= 0 && i < an.n && a[i] > v) v = a[i];
        x[n] = v;
      } else { const i = U.clamp(Math.round(f), 0, an.n - 1); x[n] = f >= 0 && f < an.n ? a[i] : 0; }
    }
    return { x, kind, ok: true };
  }
  // beats of a sounding layer in composition frames (for clocks that run against the music)
  function beatFrames(comp, L) {
    const an = L ? SD.get(L.src) : null, out = [];
    if (!an) return out;
    for (const b of an.beats) { const tc = b / CR / (L.speed || 1) + L.start; if (tc >= L.in - 2 && tc < L.out + 2) out.push(tc * CR); }
    return out;
  }
  function mathSeries(comp, src, shift) {
    const Nc = compN(comp), x = new Float32Array(Nc), g = src.gen || 'thue', seed = (src.seed | 0) + 1;
    const rate = Math.max(0.01, src.rate || 2), cont = ['lfo', 'saw', 'logistic', 'walk', 'dice'].includes(g);
    // step boundaries: an even clock, or the beats of a sound multiplied by any number (1.618 makes a grid that drifts)
    const syncL = src.sync ? RL.sndLayer(comp, src.sync === true ? null : src.sync) : null, bf = syncL ? beatFrames(comp, syncL) : null;
    const stepAt = new Float64Array(Nc);
    if (bf && bf.length > 1) {
      const mul = src.mul || 1; let bi = 0;
      for (let n = 0; n < Nc; n++) { const f = n + shift * CR; while (bi < bf.length - 2 && bf[bi + 1] <= f) bi++; stepAt[n] = (bi + (f - bf[bi]) / Math.max(1, bf[bi + 1] - bf[bi])) * mul; }
    } else for (let n = 0; n < Nc; n++) stepAt[n] = (n / CR + shift) * rate;
    let v = 0.37 + U.hash1(seed, 3) * 0.3, w = 0.5, cells = new Uint8Array(31), last = -1e9;
    if (g === 'ca') { if (src.seed) for (let i = 0; i < 31; i++) cells[i] = U.hash1(i, seed) < 0.35 ? 1 : 0; else cells[15] = 1; }
    for (let n = 0; n < Nc; n++) {
      const s = stepAt[n], k = Math.floor(s);
      if (g === 'lfo') { x[n] = 0.5 + 0.5 * Math.sin(s * Math.PI * 2); continue; }
      if (g === 'saw') { x[n] = s - k; continue; }
      const fresh = k !== last && k >= 0;
      if (fresh) {
        const steps = last < -1e8 ? 1 : Math.min(64, k - last); last = k;
        for (let q = 0; q < steps; q++) {
          if (g === 'logistic') { const r = U.clamp(src.a === undefined ? 3.7 : src.a, 0, 4); v = r * v * (1 - v); }
          else if (g === 'walk') { w += (U.hash1(k - steps + 1 + q, seed) - 0.5) * (src.a === undefined ? 0.3 : src.a); if (w < 0) w = -w; if (w > 1) w = 2 - w; w = U.clamp(w, 0, 1); }
          else if (g === 'ca') { const rule = (src.a === undefined ? 30 : src.a) | 0, nx = new Uint8Array(31); for (let i = 0; i < 31; i++) nx[i] = (rule >> ((cells[(i + 30) % 31] << 2) | (cells[i] << 1) | cells[(i + 1) % 31])) & 1; cells = nx; }
        }
        if (!cont) {
          const bit = g === 'thue' ? SEQ.thue(k) : g === 'fib' ? SEQ.fib(k) : g === 'primes' ? SEQ.primes(k) : g === 'euclid' ? SEQ.euclid(k, src.a === undefined ? 5 : src.a, src.b === undefined ? 8 : src.b)
            : g === 'sieve' ? SEQ.sieve(k, src.expr) : g === 'ca' ? cells[15] : 0;
          if (bit) x[n] = 1;
        }
      }
      if (g === 'logistic') x[n] = v; else if (g === 'walk') x[n] = w; else if (g === 'dice') x[n] = U.hash1(k, seed);
    }
    return { x, kind: cont ? 'cont' : 'imp', ok: true };
  }
  RL.series = (comp, src, shift = 0) => (src.k === 'math' ? mathSeries(comp, src, shift) : sndSeries(comp, RL.sndLayer(comp, src.layer), src.sig, shift));
  RL.srcName = (comp, src) => {
    if (src.k === 'math') return SD.MATHNAME[src.gen] || '数列';
    return SD.NAME[src.sig] || src.sig;
  };

  // rules: when something happens in the sound, the wiring itself changes
  RL.ACTS = [['rotate', '源を隣と交換する'], ['flip', '向きを裏返す'], ['reseed', '乱数を振り直す']];
  function schedule(comp, L) {
    const out = [];
    for (const rule of comp.rules || []) {
      if (!rule.on || (rule.target && rule.target !== L.id)) continue;
      const s = RL.series(comp, rule.src || { k: 'snd', layer: null, sig: 'beat' }), every = Math.max(1, rule.every | 0);
      let c = 0, armed = true;
      for (let n = 0; n < s.x.length; n++) {
        const v = s.kind === 'bip' ? Math.abs(s.x[n]) : s.x[n];
        const ev = s.kind === 'imp' ? v > 0 : (armed && v > 0.5);
        if (s.kind !== 'imp') { if (ev) armed = false; else if (v < 0.35) armed = true; }
        if (ev && ++c % every === 0) out.push({ n, act: rule.act });
      }
    }
    return out.sort((a, b) => a.n - b.n);
  }

  // the heart of it: one relation turned into a curve over the whole composition
  function bake(comp, L, rel, siblings) {
    const srcs = siblings.map((r) => RL.series(comp, r.src, r.shift || 0));
    const own = siblings.indexOf(rel), Nc = compN(comp), sched = schedule(comp, L);
    const y = new Float32Array(Nc), I = new Float32Array(Nc), dirs = rel.spin ? new Float32Array(Nc) : null;
    const th = U.clamp(rel.th || 0, 0, 0.95), cv = Math.max(0.05, rel.curve || 1), mode = rel.mode;
    const kA = 1 - Math.exp(-1 / (Math.max(0.001, rel.atk || 0.001) * CR)), kR = Math.exp(-1 / (Math.max(0.005, rel.rel || 0.005) * CR)), kP = rel.pre > 0 ? Math.exp(-1 / (rel.pre * CR)) : 0;
    const shape = (v) => (v <= th ? 0 : Math.pow((v - th) / (1 - th), cv));
    const bfr = mode === 'deaf' ? beatFrames(comp, RL.sndLayer(comp, rel.src.k === 'snd' ? rel.src.layer : null)) : null;
    const obeyN = (round) => { const b = Math.max(1, rel.obey | 0); return rel.obeySeq === 'thue' ? b + SEQ.thue(round) : rel.obeySeq === 'fib' ? b + SEQ.fib(round) : rel.obeySeq === 'dice' ? 1 + Math.floor(U.hash1(round, (rel.seed | 0) + 77) * (2 * b - 1)) : b; };
    const stepVal = (i, seed) => { const k = Math.max(2, rel.steps | 0); return rel.stepPat === 'up' ? (i % k) / (k - 1) : rel.stepPat === 'pend' ? 1 - Math.abs(((i % (2 * k - 2)) / (k - 1)) - 1) : rel.stepPat === 'rand' ? Math.floor(U.hash1(i, seed + 5) * k) / (k - 1) : Math.round(((i * 0.6180339887) % 1) * (k - 1)) / (k - 1); };
    let si = Math.max(0, own), seed = rel.seed | 0, sp = 0;
    let e = 0, acc = 0, cnt = 0, round = 0, stepI = 0, hold = 0, phase = 0, armed = true, evI = 0, dir = U.hash1(0, seed) * Math.PI * 2, lastEv = -1e9, gap = CR * 0.5, lateAt = -1, lateS = 0, bi = 0;
    for (let n = 0; n < Nc; n++) {
      while (sp < sched.length && sched[sp].n <= n) { const a = sched[sp++].act; if (a === 'rotate') si = (si + 1) % srcs.length; else if (a === 'reseed') seed += 1; }
      const S = srcs[si], raw = S.x[n], mag = S.kind === 'bip' ? Math.abs(raw) : raw;
      let ev = 0;
      if (S.kind === 'imp') { if (mag > th) ev = mag; }
      else { const lim = th > 0 ? th : 0.5; if (armed && mag > lim) { ev = 1; armed = false; } else if (mag < lim * 0.8) armed = true; }
      let imp = 0, c = null;
      if (mode === 'follow' || mode === 'oppose') { if (S.kind === 'imp') imp = ev ? shape(ev) : 0; else c = S.kind === 'bip' ? Math.sign(raw) * shape(mag) : shape(mag); }
      else if (mode === 'store') {
        const cap = Math.max(0.1, rel.fill || 2);
        acc += S.kind === 'imp' ? ev : shape(mag) / CR;
        if (acc >= cap) { imp = 1; acc = 0; }
      } else if (mode === 'betray') {
        if (ev) {
          gap = Math.min(CR * 2, n - lastEv); lastEv = n;
          if (cnt < obeyN(round)) { imp = ev; cnt++; }
          else { cnt = 0; round++; if (rel.how === 'opp') imp = -ev; else if (rel.how === 'double') imp = 2 * ev; else if (rel.how === 'late') { lateAt = n + Math.max(3, Math.round(Math.min(gap * 0.5, CR * 0.3))); lateS = ev; } }
        }
        if (n === lateAt) imp = lateS;
      } else if (mode === 'step') { if (ev) { stepI++; hold = stepVal(stepI, seed); } c = hold; }
      else if (mode === 'deaf') {
        let P = 50; if (bfr && bfr.length > 1) { while (bi < bfr.length - 2 && bfr[bi + 1] <= n) bi++; P = Math.max(8, bfr[bi + 1] - bfr[bi]); }
        phase += 1 / (P * Math.max(0.05, rel.ratio || PHI));
        if (phase >= 1) { phase -= 1; imp = 1; }
      }
      if (imp !== 0) { I[n] = imp; if (Math.abs(imp) >= Math.abs(e) || Math.sign(imp) !== Math.sign(e)) e = imp; dir = U.hash1(++evI, seed) * Math.PI * 2; }
      else if (c !== null) e += (c - e) * (Math.abs(c) > Math.abs(e) ? kA : 1 - kR);
      else e *= kR;
      y[n] = e; if (dirs) dirs[n] = dir;
    }
    // looking ahead: the answer swells in before the event and lands exactly on it
    if (kP > 0) { let b = 0, d = 0; for (let n = Nc - 1; n >= 0; n--) { if (I[n] !== 0 && Math.abs(I[n]) > Math.abs(b)) { b = I[n]; if (dirs) d = dirs[n]; } if (Math.abs(b) > Math.abs(y[n])) { y[n] = b; if (dirs) dirs[n] = d; } b *= kP; } }
    if (mode === 'oppose') for (let n = 0; n < Nc; n++) y[n] = 1 - y[n];
    if (sched.some((s) => s.act === 'flip')) { let p = 1, q = 0; for (let n = 0; n < Nc; n++) { while (q < sched.length && sched[q].n <= n) { if (sched[q].act === 'flip') p = -p; q++; } if (p < 0) y[n] = mode === 'oppose' ? 1 - y[n] : -y[n]; } }
    return { y, dirs };
  }
  const relsOf = (L) => { const out = []; for (const path of M.allPaths(L)) { const p = M.getProp(L, path); if (p && p.r) for (const r of p.r) if (r.on !== false) out.push(r); } return out; };
  RL.relsOf = relsOf;
  RL.baked = (comp, L, rel) => {
    const sl = RL.sndLayer(comp, rel.src.k === 'snd' ? rel.src.layer : rel.src.sync === true ? null : rel.src.sync);
    const rules = (comp.rules || []).length ? JSON.stringify(comp.rules) + JSON.stringify(relsOf(L).map((r) => r.src)) : '';
    const key = JSON.stringify(rel) + '|' + comp.dur + '|' + SD.ver + '|' + (sl ? [sl.id, sl.src, sl.start, sl.in, sl.out, sl.speed].join(',') : '') + '|' + rules;
    let c = RL.cache.get(rel.id);
    if (!c || c.key !== key) {
      const sib = rules ? relsOf(L) : [rel];
      c = Object.assign({ key }, bake(comp, L, rel, sib.includes(rel) ? sib : [rel]));
      if (RL.cache.size > 600) RL.cache.clear();
      RL.cache.set(rel.id, c);
    }
    return c;
  };
  RL.sample = (c, t) => { const f = t * CR, i = Math.floor(f), n = c.y.length; if (i < 0) return c.y[0]; if (i >= n - 1) return c.y[n - 1]; return c.y[i] + (c.y[i + 1] - c.y[i]) * (f - i); };
  const rgb2hsv = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 1e-6) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; } return [h, mx > 1e-6 ? d / mx : 0, mx]; };
  const hsv2rgb = (h, s, v) => { const f = (k) => { const q = (k + h * 6) % 6; return v - v * s * Math.max(0, Math.min(q, 4 - q, 1)); }; return [f(5), f(3), f(1)]; };
  // add what the relations say on top of the keyframed / expressed value
  RL.apply = (frame, L, path, prop, t, v) => {
    for (const rel of prop.r) {
      if (rel.on === false) continue;
      const c = RL.baked(frame.comp, L, rel), y = RL.sample(c, t);
      if (typeof v === 'number') v += y * (typeof rel.amt === 'number' ? rel.amt : rel.amt[0]);
      else if (rel.cm) {                           // colour: lean towards another colour, or turn the hue
        const a = typeof rel.amt === 'number' ? rel.amt : 100;
        if (rel.cm === 'hue') { const h = rgb2hsv(v[0], v[1], v[2]), q = hsv2rgb(((h[0] + y * a / 360) % 1 + 1) % 1, h[1], h[2]); v = [q[0], q[1], q[2], v[3]]; }
        else { const k = U.clamp(y * a / 100, 0, 1), to = rel.to || [1, 1, 1, 1]; v = [v[0] + (to[0] - v[0]) * k, v[1] + (to[1] - v[1]) * k, v[2] + (to[2] - v[2]) * k, v[3]]; }
      } else {
        const a = U.isArr(rel.amt) ? rel.amt : [rel.amt, rel.amt];
        if (c.dirs) { const d = c.dirs[U.clamp(Math.round(t * CR), 0, c.dirs.length - 1)], m = Math.hypot(a[0], a[1]); v = [v[0] + Math.cos(d) * m * y, v[1] + Math.sin(d) * m * y].concat(v.slice(2)); }
        else v = [v[0] + a[0] * y, v[1] + a[1] * y].concat(v.slice(2));
      }
    }
    return v;
  };

  // ================================================================ methods: one press ties a layer to the sound with a stance
  const bind = (L, path, o) => {
    const prop = M.getProp(L, path), desc = M.desc(L, path); if (!prop) return null;
    const r = RL.create(desc, path, o.src, o); (prop.r || (prop.r = [])).push(r); return r;
  };
  const snd = (sig) => ({ k: 'snd', layer: null, sig });
  const fxParam = (L, type, param) => { let fx = L.fx.find((f) => f.type === type); if (!fx) { fx = KS.FX.create(type, KS.R.rectOf(L)); L.fx.push(fx); } return `fx.${fx.id}.${param}`; };
  RL.METHODS = [
    { id: 'trace', name: 'なぞる', hint: '打点に合わせて素直に動く。まずここから崩していく', run: (L) => { bind(L, 'tr.s', { src: snd('hitL'), amt: [16, 16], rel: 0.2 }); bind(L, 'tr.r', { src: snd('hitH'), amt: 5, rel: 0.12, spin: 0 }); } },
    { id: 'ahead', name: '先回りする', hint: '音が鳴る前にふくらみ、鳴った瞬間に止まる。原因と結果が入れ替わる', run: (L) => { bind(L, 'tr.s', { src: snd('hit'), amt: [20, 20], pre: 0.22, rel: 0.03 }); bind(L, 'tr.p', { src: snd('hitL'), amt: [70, 0], pre: 0.3, rel: 0.04, spin: 1 }); } },
    { id: 'dodge', name: 'かわす', hint: '打点では動かず、来るはずだったのに来なかった拍でだけ動く', run: (L) => { bind(L, 'tr.p', { src: snd('omission'), amt: [110, 0], rel: 0.35, spin: 1 }); bind(L, 'tr.r', { src: snd('surprise'), amt: 14, rel: 0.4 }); } },
    { id: 'silence', name: '沈黙で動く', hint: '音のあいだは止まり、無音が続くほど大きく動き出す', run: (L) => { bind(L, 'tr.r', { src: snd('quiet'), amt: 140, atk: 0.4, rel: 0.25, curve: 1.6 }); bind(L, 'tr.s', { src: snd('silence'), amt: [35, 35], atk: 1.2, rel: 0.15 }); } },
    { id: 'store', name: '溜めて放つ', hint: '音量を溜め込み、いっぱいになったときだけ自分の間で跳ねる', run: (L) => { bind(L, 'tr.p', { src: snd('level'), mode: 'store', fill: 1.4, amt: [150, 0], rel: 0.5, spin: 1 }); bind(L, 'tr.s', { src: snd('hit'), mode: 'store', fill: 5, amt: [40, 40], rel: 0.3 }); } },
    { id: 'betray', name: '数えて裏切る', hint: '数回は拍に従い、次の一回で逆へ動く。回数はトゥエ・モース列で伸び縮みする', run: (L) => { bind(L, 'tr.s', { src: snd('beat'), mode: 'betray', obey: 3, obeySeq: 'thue', how: 'opp', amt: [22, 22], rel: 0.25 }); bind(L, 'tr.r', { src: snd('hitH'), mode: 'betray', obey: 2, obeySeq: 'fib', how: 'late', amt: 12, rel: 0.18 }); } },
    { id: 'deaf', name: '聴かない', hint: '音の拍の黄金比倍で、いつまでも揃わない自分の拍を打つ', run: (L) => { bind(L, 'tr.s', { src: snd('beat'), mode: 'deaf', ratio: 1.618, amt: [18, 18], rel: 0.2 }); bind(L, 'tr.r', { src: snd('beat'), mode: 'deaf', ratio: 0.7071, amt: 9, rel: 0.25 }); } },
    { id: 'walk', name: '一歩ずつ歩く', hint: '打点のたびに黄金比で次の場所へ移り、そこに留まる', run: (L) => { bind(L, 'tr.p', { src: snd('hit'), mode: 'step', steps: 8, stepPat: 'gold', amt: [360, 0], atk: 0.05, rel: 0.05 }); bind(L, 'tr.r', { src: snd('hitL'), mode: 'step', steps: 5, stepPat: 'pend', amt: 60, atk: 0.08, rel: 0.08 }); } },
    { id: 'hue', name: '音名を色にする', hint: '鳴っている音の高さを五度圏に置き、その角度で色相を回す', run: (L) => { const cp = L.type === 'solid' ? 'p.color' : L.type === 'shape' || L.type === 'text' ? 'p.fill' : null; if (cp) bind(L, cp, { src: snd('tone'), cm: 'hue', amt: 360, atk: 0.25, rel: 0.25 }); else bind(L, fxParam(L, 'hsl', 'hue'), { src: snd('tone'), amt: 360, atk: 0.25, rel: 0.25 }); } },
    { id: 'melt', name: '音で溶かす', hint: '鳴っているあいだ絵が自分の明暗に沿って流れ、静かになると戻ろうとする', run: (L) => { const p = fxParam(L, 'melt', 'flow'); M.getProp(L, p).v = 0; bind(L, p, { src: snd('level'), amt: 70, atk: 0.1, rel: 0.6, curve: 1.5 }); } },
    { id: 'fold', name: '密度で折りたたむ', hint: '出来事が増えるほど絵が折り重なって複雑になる', run: (L) => { const p = fxParam(L, 'fold', 'times'); M.getProp(L, p).v = 0; bind(L, p, { src: snd('velocity'), amt: 5, atk: 0.5, rel: 0.8 }); } },
    { id: 'm-thue', math: true, name: 'トゥエ・モース列で脈を打つ', hint: '周期を持たないのに乱数でもない並びで動く', run: (L) => { bind(L, 'tr.s', { src: { k: 'math', gen: 'thue', rate: 6, seed: 1, mul: 1 }, amt: [14, 14], rel: 0.14 }); bind(L, 'tr.r', { src: { k: 'math', gen: 'fib', rate: 3, seed: 1, mul: 1 }, mode: 'step', steps: 7, stepPat: 'pend', amt: 40, atk: 0.08, rel: 0.08 }); } },
    { id: 'm-logistic', math: true, name: 'ロジスティック写像で歩く', hint: 'r が 3.2 なら二点の往復、3.57 を超えると二度と同じ所へ戻らない', run: (L) => { bind(L, 'tr.p', { src: { k: 'math', gen: 'logistic', rate: 3, a: 3.72, seed: 1, mul: 1 }, amt: [420, 0], atk: 0.1, rel: 0.1 }); } },
    { id: 'm-sieve', math: true, name: 'ふるいで打つ', hint: '3と4と7の倍数だけが鳴る。単純な数の重なりが不規則に聞こえる', run: (L) => { bind(L, 'tr.s', { src: { k: 'math', gen: 'sieve', expr: '3@0|4@1|7@3', rate: 8, seed: 1, mul: 1 }, amt: [16, 16], rel: 0.1 }); } },
    { id: 'm-ca', math: true, name: 'セル・オートマトン（規則30）で回る', hint: '一行の単純な規則から、予測のつかない並びが出る', run: (L) => { bind(L, 'tr.r', { src: { k: 'math', gen: 'ca', a: 30, rate: 6, seed: 0, mul: 1 }, mode: 'step', steps: 12, stepPat: 'gold', amt: 180, atk: 0.05, rel: 0.05 }); } },
  ];
  RL.method = (id, L) => { const m = RL.METHODS.find((q) => q.id === id); if (m && L && L.tr) m.run(L); };
})();
