// UNDERFLOW: the processing, one sample at a time, in an AudioWorklet.
// Every stage is its own process with its own definition of negative and extreme values (see the page's notes).
// Messages in: {t:"p", id, v} a parameter; {t:"lfo", id, on, rate, depth, shape}; {t:"order", order}; {t:"on", st, v};
// {t:"src", ...}; {t:"rec", on}; {t:"reset"}. Out: {t:"view", ...} about 30 a second, {t:"rec", l, r}.
const TAU = Math.PI * 2;

class Rng {
  constructor(s) { this.s = s >>> 0 || 1; }
  next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s / 4294967296; }
}

// a radix-2 FFT in place (re, im), n a power of two
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? TAU : -TAU) / len, wr0 = Math.cos(a), wi0 = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const k = i + j + len / 2, xr = re[k] * wr - im[k] * wi, xi = re[k] * wi + im[k] * wr;
        re[k] = re[i + j] - xr; im[k] = im[i + j] - xi; re[i + j] += xr; im[i + j] += xi;
        const t = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = t;
      }
    }
  }
}

const NS_B = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1], [5, -10, 10, -5, 1]];   // (1 - z^-1)^N, after the 1
function ringRead(R, M, pos) { const i = Math.floor(pos), f = pos - i; return R[i & M] + (R[(i + 1) & M] - R[i & M]) * f; }
function lanczos(x) {
  if (x === 0) return 1;
  if (x <= -4 || x >= 4) return 0;
  const px = Math.PI * x;
  return (4 * Math.sin(px) * Math.sin(px / 4)) / (px * px);
}

class Chan {                                     // one channel's state for every stage
  constructor(fs) {
    this.rateRing = new Float32Array(1 << 18); this.rateRp = 0; this.rateXf = 0; this.rateOld = 0;
    this.jit = new Float32Array(4096); this.jw = 0;
    this.aa = [[0, 0, 0, 0], [0, 0, 0, 0]];
    this.srAcc = 0; this.hist = new Float32Array(8); this.srFrozen = false;
    this.revRing = new Float32Array(1 << 17); this.revK = 0; this.revXf = 0; this.revOld = 0;
    this.err = new Float32Array(6); this.qLast = 0;
    this.sdm = new Float64Array(5); this.sdmY = 1; this.sdmPrev = 0;
    this.blk = new Float32Array(8192);
    this.cIn = new Float32Array(1024); this.cOut = new Float32Array(2048); this.cPos = 0; this.cOutPos = 0;
    this.dcx = 0; this.dcy = 0;
  }
}

class Underflow extends AudioWorkletProcessor {
  constructor(opt) {
    super();
    const o = opt.processorOptions;
    this.fs = sampleRate;
    this.p = Object.assign({}, o.params);
    this.lfo = {};
    this.order = o.order.slice();
    this.on = Object.assign({}, o.on);
    this.rng = new Rng(o.seed || 12345);
    this.ch = [new Chan(this.fs), new Chan(this.fs)];
    this.src = { ph: 0, sweepPh: 0, impPh: 0, sawPh: 0 };
    this.w = 0;                                  // samples written (shared write clock)
    this.blkPos = 0; this.blkAct = 0; this.blkPrevAct = 0; this.blkFade = 0;
    this.env = 0; this.nan = 0; this.nanNow = false;
    this.rec = false;
    this.viewN = 0;
    this.scopeIn = new Float32Array(1024); this.scopeOut = new Float32Array(1024); this.scopeI = 0; this.armed = true;
    this.prevIn = 0; this.peakIn = 0; this.peakOut = 0; this.gr = 1;
    this.re = new Float32Array(1024); this.im = new Float32Array(1024);
    this.win = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((TAU * i) / 1024));
    this.mags = new Float32Array(513); this.idx = new Int32Array(513);
    this.keep = new Uint8Array(513); this.oRe = new Float32Array(1024); this.oIm = new Float32Array(1024);
    this.eff = {};
    this.port.onmessage = (e) => this.msg(e.data);
  }
  msg(m) {
    if (m.t === "p") this.p[m.id] = m.v;
    else if (m.t === "lfo") this.lfo[m.id] = { on: m.on, rate: m.rate, depth: m.depth, shape: m.shape, ph: (this.lfo[m.id] || {}).ph || 0, sh: 0 };
    else if (m.t === "order") this.order = m.order.slice();
    else if (m.t === "on") this.on[m.st] = m.v;
    else if (m.t === "rec") this.rec = !!m.on;
    else if (m.t === "reset") this.resetState();
  }
  resetState() {
    this.ch = [new Chan(this.fs), new Chan(this.fs)];
    this.blkPos = 0; this.blkAct = 0;
  }
  // a parameter now: its base plus its LFO (computed once a block)
  val(id) {
    const base = this.p[id];
    const l = this.lfo[id];
    if (!l || !l.on || typeof base !== "number") return base;
    let w;
    const ph = l.ph;
    if (l.shape === "sine") w = Math.sin(TAU * ph);
    else if (l.shape === "tri") w = 1 - 4 * Math.abs(ph - 0.5);
    else if (l.shape === "square") w = ph < 0.5 ? 1 : -1;
    else w = l.sh;
    return base + l.depth * w;
  }
  stepLfos(n) {
    for (const id in this.lfo) {
      const l = this.lfo[id];
      if (!l.on) continue;
      const before = l.ph;
      l.ph += (l.rate * n) / this.fs;
      if (l.ph >= 1 || l.ph < before) { l.ph -= Math.floor(l.ph); l.sh = this.rng.next() * 2 - 1; }
    }
  }

  // ---------------------------------------------------------------- the stages ---
  // 10. recording rate vs playback rate: the input written at 1, read at RATIO (negative: backwards)
  stRate(c, x, ratio) {
    const R = c.rateRing, N = R.length, M = N - 1;
    R[this.w & M] = x;
    if (ratio === 1 && c.rateXf === 0 && c.rateRp === this.w) { c.rateRp = this.w + 1; return x; }
    let d = this.w - c.rateRp;
    if (d < 2 || d > N - 64) {                   // ran into the write, or out of the ring: jump, crossfading
      c.rateOld = c.rateRp; c.rateXf = 256;
      c.rateRp = ratio > 0 ? this.w - N / 2 : this.w - 2;
    }
    let y = ringRead(R, M, c.rateRp);
    if (c.rateXf > 0) { const a = c.rateXf / 256; y = y * (1 - a) + ringRead(R, M, c.rateOld) * a; c.rateOld += ratio; c.rateXf--; }
    c.rateRp += ratio;
    return y;
  }
  // 9. clock jitter: the sampling instant wobbles by up to AMOUNT samples (a sine at PERIOD Hz, or white at 0)
  stJit(c, x, amt, w) {
    const J = c.jit, M = J.length - 1;
    J[c.jw & M] = x;
    const a = Math.min(Math.abs(amt), 1000), d = a + a * w;   // constant latency a; the instant moves +-a
    const i = Math.floor(d), f = d - i, p = c.jw - i;
    const y0 = J[(p + 1) & M], y1 = J[p & M], y2 = J[(p - 1) & M], y3 = J[(p - 2) & M];
    c.jw++;
    // cubic Hermite between y1 and y2 at f
    const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }
  // 1. sample rate: + sample-and-hold (anti-alias, ZOH / linear / sinc); 0 freeze; - the past backwards, held
  stSr(c, x, rate, aa, recon, coef) {
    const fs = this.fs;
    if (rate < 0) {                              // read backwards from the write, a second at most, restart
      const R = c.revRing, M = R.length - 1;
      R[this.w & M] = x;
      let y = R[(this.w - 2 * c.revK) & M];        // k samples since the restart: 2k behind the write
      if (c.revXf > 0) { const a = c.revXf / 64; y = y * (1 - a) + c.revOld * a; c.revXf--; }
      c.revK++;
      if (2 * c.revK >= Math.min(fs, R.length - 8)) { c.revOld = y; c.revXf = 64; c.revK = 0; }
      x = y;
      rate = -rate;
    }
    if (rate === 0) {                            // freeze the sample of this instant
      if (!c.srFrozen) { c.srFrozen = true; c.hist[0] = x; }
      return c.hist[0];
    }
    c.srFrozen = false;
    if (aa && rate < fs) {                       // 4th-order Butterworth low-pass at 0.45 x the new rate
      for (let s = 0; s < 2; s++) {
        const k = coef[s], z = c.aa[s];
        const y = k[0] * x + z[0];
        z[0] = k[1] * x - k[3] * y + z[1];
        z[1] = k[2] * x - k[4] * y;
        x = y;
      }
    }
    c.srAcc += rate / fs;
    if (c.srAcc >= 1) {
      c.srAcc -= Math.floor(c.srAcc);
      for (let k = 7; k > 0; k--) c.hist[k] = c.hist[k - 1];
      c.hist[0] = x;
    }
    if (rate >= fs && recon !== "sinc") return c.hist[0];
    if (recon === "linear") return c.hist[1] + (c.hist[0] - c.hist[1]) * c.srAcc;
    if (recon === "sinc") {                      // Lanczos (a = 4) over the held samples, 4 periods late
      let y = 0;
      const t = c.srAcc - 4;
      for (let k = 0; k < 8; k++) y += c.hist[k] * lanczos(t + k);
      return y;
    }
    return c.hist[0];
  }
  // 6. overflow: gain, then CLIP / WRAP (integer overflow) / MIRROR (fold)
  stOvf(x, g, mode) {
    x *= g;
    if (mode === "clip") return x > 1 ? 1 : x < -1 ? -1 : x;
    if (mode === "wrap") { const u = (x + 1) * 0.5; return (u - Math.floor(u)) * 2 - 1; }
    const u = ((x + 1) * 0.25 - Math.floor((x + 1) * 0.25)) * 4;
    return u < 2 ? u - 1 : 3 - u;
  }
  // 5. floating point: MANT mantissa bits (rounded), EXP exponent bits (IEEE-like bias); below the smallest normal
  // the value goes subnormal (gradual underflow) or to 0 (FTZ); above the largest it saturates
  stFloat(x, mant, expb, ftz) {
    if (x === 0 || !isFinite(x)) return x;
    mant = Math.max(0, Math.min(23, Math.round(mant)));
    expb = Math.max(1, Math.min(8, Math.round(expb)));
    const bias = (1 << (expb - 1)) - 1, kmin = 1 - bias, kmax = bias;
    const s = x < 0 ? -1 : 1, a = Math.abs(x);
    const k = Math.floor(Math.log2(a));
    if (k > kmax) return s * (2 - Math.pow(2, -mant)) * Math.pow(2, kmax);
    if (k < kmin) {
      if (ftz) return 0;
      const step = Math.pow(2, kmin - mant);
      return s * Math.round(a / step) * step;
    }
    const step = Math.pow(2, k - mant);
    return s * Math.round(a / step) * step;
  }
  curveF(x, c) {
    const a = Math.abs(x), s = x < 0 ? -1 : 1;
    if (c === "mu") return s * Math.log1p(255 * Math.min(a, 4)) / Math.log(256);
    if (c === "log") return a < 1e-5 ? 0 : s * Math.max(0, 1 + Math.log2(a) / 16);
    return x;
  }
  curveI(y, c) {
    const a = Math.abs(y), s = y < 0 ? -1 : 1;
    if (c === "mu") return (s * (Math.pow(256, a) - 1)) / 255;
    if (c === "log") return a <= 0 ? 0 : s * Math.pow(2, 16 * (a - 1));
    return y;
  }
  // 2 and 3. bit depth with dither and noise shaping: + quantise; - only the error |BITS| would throw away
  stBits(c, x, bits, curve, dith, amt, order, makeup) {
    if (bits >= 32) return x;
    const L = Math.abs(bits), step = Math.pow(2, 1 - L);
    const v0 = this.curveF(x, curve);
    // error feedback: NTF = (1 - z^-1)^order
    const B = NS_B[Math.max(0, Math.min(5, order | 0))];
    let fb = 0;
    for (let k = 0; k < B.length; k++) fb += B[k] * c.err[k];
    let v = v0 - fb;
    if (!(Math.abs(v) < 8)) { v = v0; c.err.fill(0); }   // an unstable loop (high order, few bits): reset it
    let d = 0;
    if (dith === "rpdf") d = (this.rng.next() - 0.5) * step * amt;
    else if (dith === "tpdf") d = (this.rng.next() + this.rng.next() - 1) * step * amt;
    const q = Math.round((v + d) / step) * step;
    for (let k = 5; k > 0; k--) c.err[k] = c.err[k - 1];
    c.err[0] = q - v;
    if (bits < 0) {                              // what is thrown away (raised so it is heard, if MAKEUP)
      const e = v0 - q;
      return makeup ? e / step : e;
    }
    return this.curveI(q, curve);
  }
  // 4. 1-bit sigma-delta (DSD-like): ORDER integrators at OSR x the rate, then the bits averaged back down
  stSdm(c, x, order, osr) {
    order = Math.max(1, Math.min(5, order | 0));
    osr = Math.max(1, Math.min(256, osr | 0));
    const s = c.sdm, g = order > 2 ? 0.5 : 1, lim = 8;   // a chain of integrators, each fed back the bit
    let acc = 0;
    const x0 = c.sdmPrev, dx = (x - x0) / osr;
    for (let k = 1; k <= osr; k++) {
      let prev = Math.max(-1, Math.min(1, x0 + dx * k)) * 0.5;
      const y = c.sdmY;
      for (let i = 0; i < order; i++) {
        s[i] += g * (prev - y);
        if (s[i] > lim) s[i] = lim; else if (s[i] < -lim) s[i] = -lim;   // integrators limited: stays usable
        prev = s[i];
      }
      c.sdmY = prev >= 0 ? 1 : -1;
      acc += c.sdmY;
    }
    c.sdmPrev = x;
    return (acc / osr) * 2;
  }
  // 7. bit flips on the 16-bit word: AND (masked to 0), XOR (inverted), a random flip with probability PROB
  stFlip(x, and, xor, prob, top) {
    let s = Math.round(Math.max(-1, Math.min(1, x)) * 32767) & 0xffff;
    s &= and; s ^= xor;
    if (prob > 0 && this.rng.next() < prob) s ^= 1 << (top ? 8 + Math.floor(this.rng.next() * 8) : Math.floor(this.rng.next() * 16));
    return ((s << 16) >> 16) / 32768;
  }
  // 8. the bytes misread: swapped (endianness), signed read as unsigned
  stByte(x, swap, sign) {
    let s = Math.round(Math.max(-1, Math.min(1, x)) * 32767) & 0xffff;
    if (swap) s = ((s >> 8) | (s << 8)) & 0xffff;
    if (sign) return s / 32768 - 1;
    return ((s << 16) >> 16) / 32768;
  }
  // 12. compressed bitrate (an STFT approximation, not a real codec): keep the loudest bins the budget pays for,
  // coarsely quantised; negative: only what was thrown away. 1024-point frames, hop 256, sqrt-Hann both ways
  codecFrame(c, kbps) {
    const N = 1024, re = this.re, im = this.im, win = this.win, mags = this.mags, idx = this.idx;
    for (let i = 0; i < N; i++) { re[i] = c.cIn[(c.cPos + i) & 1023] * win[i]; im[i] = 0; }
    fft(re, im, false);
    const b = Math.abs(kbps);
    const bitsPerFrame = (b * 1000) / (this.fs / 256) / 2;
    const q = Math.max(2, Math.min(10, Math.round(b / 40) + 2));
    let K = Math.floor(bitsPerFrame / (10 + 2 * q));
    K = Math.max(0, Math.min(513, K));
    for (let i = 0; i <= 512; i++) { mags[i] = Math.hypot(re[i], im[i]); idx[i] = i; }
    const order = Array.from(idx).sort((a, z) => mags[z] - mags[a]);
    const keep = this.keep, outRe = this.oRe, outIm = this.oIm;
    keep.fill(0); outRe.fill(0); outIm.fill(0);
    for (let i = 0; i < K; i++) keep[order[i]] = 1;
    for (let i = 0; i <= 512; i++) {
      let r = re[i], m = im[i];
      if (keep[i]) {
        if (kbps < 0) { r = 0; m = 0; }
        else {                                   // magnitude on a log grid over 96 dB, phase on 2^q steps
          const mag = mags[i], ph = Math.atan2(m, r);
          const levels = 1 << q;
          const db = 20 * Math.log10(mag + 1e-9), dbq = Math.round(((db + 96) / 96) * levels) / levels * 96 - 96;
          const magq = Math.pow(10, dbq / 20), phq = (Math.round((ph / TAU) * levels) / levels) * TAU;
          r = magq * Math.cos(phq); m = magq * Math.sin(phq);
        }
      } else if (kbps >= 0) { r = 0; m = 0; }
      outRe[i] = r; outIm[i] = m;
      if (i > 0 && i < 512) { outRe[N - i] = r; outIm[N - i] = -m; }
    }
    fft(outRe, outIm, true);
    for (let i = 0; i < N; i++) c.cOut[(c.cOutPos + i) & 2047] += (outRe[i] / N) * win[i] * 0.5;
  }
  stCodec(c, x, kbps) {
    c.cIn[c.cPos & 1023] = x;
    c.cPos = (c.cPos + 1) & 1023;
    const y = c.cOut[c.cOutPos & 2047];
    c.cOut[c.cOutPos & 2047] = 0;
    c.cOutPos = (c.cOutPos + 1) & 2047;
    if ((c.cPos & 255) === 0) this.codecFrame(c, kbps);
    return y;
  }

  // the anti-alias low-pass coefficients for a new rate (two RBJ sections, Butterworth Qs)
  aaCoef(rate) {
    const fc = Math.min(Math.abs(rate) * 0.45, this.fs * 0.45);
    return [0.5412, 1.3066].map((Q) => {
      const w = (TAU * fc) / this.fs, al = Math.sin(w) / (2 * Q), cw = Math.cos(w), a0 = 1 + al;
      return [((1 - cw) / 2) / a0, (1 - cw) / a0, ((1 - cw) / 2) / a0, (-2 * cw) / a0, (1 - al) / a0];
    });
  }

  // ------------------------------------------------------------------ the source ---
  source(inp, n, L, R) {
    const sig = this.p["src.sig"], fs = this.fs;
    const lvl = Math.pow(10, this.val("src.level") / 20), f = Math.max(0.1, Math.min(fs * 0.49, this.val("src.freq")));
    if (sig === "file" || sig === "mic") {
      const a = inp && inp[0], b = inp && (inp[1] || inp[0]);
      for (let i = 0; i < n; i++) { L[i] = a ? a[i] : 0; R[i] = b ? b[i] : 0; }
      return;
    }
    const s = this.src;
    for (let i = 0; i < n; i++) {
      let y = 0;
      if (sig === "sine") { y = Math.sin(TAU * s.ph); s.ph += f / fs; if (s.ph >= 1) s.ph -= 1; }
      else if (sig === "saw") {                  // PolyBLEP: the saw's own aliasing kept out of the picture
        const dt = f / fs; let t = s.sawPh; y = 2 * t - 1;
        if (t < dt) { t /= dt; y -= t + t - t * t - 1; } else if (t > 1 - dt) { t = (t - 1) / dt; y -= t * t + t + t + 1; }
        s.sawPh += dt; if (s.sawPh >= 1) s.sawPh -= 1;
      } else if (sig === "noise") y = this.rng.next() * 2 - 1;
      else if (sig === "impulse") { s.impPh += Math.min(f, 50) / fs; if (s.impPh >= 1) { s.impPh -= 1; y = 1; } }
      else if (sig === "sweep") {                // logarithmic, 20 Hz to Nyquist over SWEEP seconds, looping
        const T = Math.max(0.5, this.p["src.sweep"]);
        s.sweepPh += 1 / (T * fs); if (s.sweepPh >= 1) s.sweepPh -= 1;
        const fr = 20 * Math.pow((fs * 0.5) / 20, s.sweepPh);
        s.ph += fr / fs; if (s.ph >= 1) s.ph -= 1; y = Math.sin(TAU * s.ph);
      }
      L[i] = R[i] = y * lvl;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    this.source(inputs[0], n, L, R);
    this.stepLfos(n);
    // the values for this block
    const v = (id) => this.val(id);
    const ratio = v("rate.ratio"), jitAmt = v("jit.amount"), jitPer = v("jit.period");
    const srRate = v("sr.rate"), aa = this.p["sr.aa"], recon = this.p["sr.recon"];
    const gain = Math.pow(10, v("ovf.gain") / 20), mode = this.p["ovf.mode"];
    const mant = v("float.mant"), expb = v("float.exp"), ftz = this.p["float.ftz"];
    const bits = v("bits.bits"), curve = this.p["bits.curve"], dith = this.p["bits.dither"], damt = v("bits.damt"),
      shape = this.p["bits.shape"], makeup = this.p["bits.makeup"];
    const sdmOrder = v("sdm.order"), sdmOsr = v("sdm.osr");
    const and = this.p["flip.and"] & 0xffff, xor = this.p["flip.xor"] & 0xffff, fprob = Math.max(0, v("flip.prob")), ftop = this.p["flip.top"];
    const swap = this.p["byte.swap"], sign = this.p["byte.sign"];
    const bsize = Math.max(16, Math.min(8192, Math.round(v("block.size")))), bdrop = v("block.drop"), brep = v("block.rep");
    const kbps = v("codec.kbps");
    if (this.aaFor !== srRate) { this.aaFor = srRate; this.aaK = this.aaCoef(srRate); }
    const coef = this.aaK;
    this.eff = { "sr.rate": srRate, "rate.ratio": ratio, "bits.bits": bits, "ovf.gain": v("ovf.gain"), "codec.kbps": kbps,
      "jit.amount": jitAmt, "float.mant": mant, "float.exp": expb, "sdm.osr": sdmOsr, "block.drop": bdrop, "src.freq": v("src.freq") };
    const order = this.order, on = this.on, chs = this.ch;
    let bad = false;
    for (let i = 0; i < n; i++) {
      const inMono = 0.5 * (L[i] + R[i]);
      // the jitter's wobble (shared, so left and right move together)
      let jw;
      if (jitPer > 0) { this.jitPh = ((this.jitPh || 0) + jitPer / this.fs) % 1; jw = Math.sin(TAU * this.jitPh); }
      else jw = this.rng.next() * 2 - 1;
      // the block decision (shared)
      if (on.block && this.blkPos === 0) {
        this.blkPrevAct = this.blkAct;
        const r = this.rng.next();
        this.blkAct = r < bdrop ? 1 : r < bdrop + brep ? 2 : 0;
      }
      for (let k = 0; k < 2; k++) {
        const c = chs[k];
        let x = k === 0 ? L[i] : R[i];
        for (let s = 0; s < order.length; s++) {
          const st = order[s];
          if (!on[st]) continue;
          switch (st) {
            case "rate": x = this.stRate(c, x, ratio); break;
            case "jit": if (jitAmt !== 0) x = this.stJit(c, x, jitAmt, jw); break;
            case "sr": x = this.stSr(c, x, srRate, aa, recon, coef); break;
            case "ovf": x = this.stOvf(x, gain, mode); break;
            case "float": x = this.stFloat(x, mant, expb, ftz); break;
            case "bits": x = this.stBits(c, x, bits, curve, dith, damt, shape, makeup); break;
            case "sdm": x = this.stSdm(c, x, sdmOrder, sdmOsr); break;
            case "flip": x = this.stFlip(x, and, xor, fprob, ftop); break;
            case "byte": if (swap || sign) x = this.stByte(x, swap, sign); break;
            case "block": {
              const pos = this.blkPos;
              if (this.blkAct === 2) x = c.blk[pos];
              else { c.blk[pos] = x; if (this.blkAct === 1) x = 0; }
              if (pos < 32 && this.blkAct !== this.blkPrevAct) x *= pos / 32;
              if (bsize - pos <= 32 && this.blkAct !== 0) x *= (bsize - pos) / 32;
              break;
            }
            case "codec": x = this.stCodec(c, x, kbps); break;
          }
        }
        // the output: DC cut, then (below, with the other channel) the limiter
        c.dcy = x - c.dcx + 0.9995 * c.dcy; c.dcx = x; x = c.dcy;
        if (!isFinite(x) || Math.abs(x) > 1e6) bad = true;
        if (k === 0) L[i] = x; else R[i] = x;
      }
      this.w++;
      if (on.block && ++this.blkPos >= bsize) this.blkPos = 0;
      // the scope: input and output from a rising zero crossing of the input
      if (this.armed && this.prevIn <= 0 && inMono > 0) { this.armed = false; this.scopeI = 0; }
      if (!this.armed && this.scopeI < 1024) { this.scopeIn[this.scopeI] = inMono; this.scopeOut[this.scopeI] = 0.5 * (L[i] + R[i]); this.scopeI++; }
      this.prevIn = inMono;
      this.peakIn = Math.max(this.peakIn, Math.abs(inMono));
    }
    if (bad) {                                   // a NaN or an infinity: this block silent, the states cleared
      for (let i = 0; i < n; i++) { L[i] = 0; R[i] = 0; }
      this.nan++; this.nanNow = true;
      this.resetState();
      this.env = 0;
    }
    // the limiter (-1 dBFS, instant attack, 150 ms release) and MASTER
    const master = Math.pow(10, this.p["master.db"] / 20), ceil = 0.891, rel = Math.exp(-1 / (0.15 * this.fs));
    let grMin = 1;
    for (let i = 0; i < n; i++) {
      const a = L[i], b = R[i], p = Math.max(Math.abs(a), Math.abs(b));
      this.env = p > this.env ? p : this.env * rel + p * (1 - rel);
      const g = this.env > ceil ? ceil / this.env : 1;
      if (g < grMin) grMin = g;
      L[i] = a * g * master; R[i] = b * g * master;
      this.peakOut = Math.max(this.peakOut, Math.abs(L[i]), Math.abs(R[i]));
    }
    this.gr = Math.min(this.gr, grMin);
    if (this.rec) this.port.postMessage({ t: "rec", l: L.slice(), r: R.slice() });
    if (++this.viewN >= Math.max(1, Math.round(this.fs / 128 / 30))) {
      this.viewN = 0;
      const msg = { t: "view", nan: this.nan, nanNow: this.nanNow, peakIn: this.peakIn, peakOut: this.peakOut, gr: this.gr, eff: this.eff };
      if (this.scopeI >= 1024) { msg.si = this.scopeIn.slice(); msg.so = this.scopeOut.slice(); this.armed = true; this.scopeI = 0; }
      else if (this.armed && this.w % 4096 < 128) { this.armed = false; this.scopeI = 0; }   // no crossing: take one anyway
      this.port.postMessage(msg);
      this.peakIn = 0; this.peakOut = 0; this.gr = 1; this.nanNow = false;
    }
    return true;
  }
}
registerProcessor("underflow", Underflow);
