/* RENSETSU engine.
   Material analysis (candidate boundaries only), cutting a unit anew for every choice,
   and the anti-grouping choice of the next unit, its cut and the next interval.
   Pure: no DOM, no Web Audio, no Math.random. The same seed, the same material and the
   same events (taps and parameter changes at the same unit numbers) give the same output. */
var RS = (function () {
'use strict';
const HOP = 256, WIN = 1024, NB = WIN / 2 + 1, PN = 4096;
const CUES = ['a', 'b', 'c', 'd', 'e'];
const CUE_NAME = { a: '時間的近接', b: '音高近接', c: '音色の類似', d: '音量の強勢', e: 'パターン反復' };
// band each cue is kept in: above TH_HI a grouping settles, below TH_LO nothing can be heard out
const TH_HI = { a: 0.7, b: 0.7, c: 0.7, d: 0.7, e: 0.45 }, TH_LO = 0.15;
const SCALE = { a: 0.5, b: 0.35, c: 0.6, d: 0.5 };
const LEVELS = [0, -4, -8, -12, -16];          // dB below the reference output level
const OUT_REF = -14;                            // dBFS, loudest frame of a unit at level 0
const REC = 0.65;                               // recency weight per gap
const MAXC = 96;                                // cuts examined per choice
const ETA = 0.12;                               // model update per tap
const SUPP_DECAY = 0.7;                         // tap suppression fades over the next units
const REACT = 0.15;                             // assumed reaction time of a tap (s)

// simple integer ratios the intervals must stay away from (log2, tolerance)
const LR = [];
for (const [p, q] of [[1, 1], [2, 1], [3, 2], [4, 3], [5, 4], [3, 1], [5, 3], [5, 2], [4, 1]]) {
  const r = Math.log2(p / q);
  LR.push([r, p === q ? 0.085 : 0.03]);
  if (p !== q) LR.push([-r, 0.03]);
}
function nearSimple(a, b, tol) {
  const r = Math.log2(a / b);
  for (const [x, t] of LR) if (Math.abs(r - x) < (tol || t)) return true;
  return false;
}

// ---------- deterministic generator (a tool inside the engine, never the result) ----------
function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- FFT ----------
const TW = {};
function tables(n) {
  if (TW[n]) return TW[n];
  const rev = new Uint32Array(n), bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float64Array(n >> 1), sin = new Float64Array(n >> 1);
  for (let i = 0; i < n >> 1; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
  return (TW[n] = { rev, cos, sin });
}
function fft(re, im, n, inv) {
  const { rev, cos, sin } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cos[k], wi = inv ? -sin[k] : sin[k], a = i + j, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}
const HANN = new Float64Array(WIN); let HSQ = 0;
for (let i = 0; i < WIN; i++) { HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN); HSQ += HANN[i] * HANN[i]; }
const PRE = new Float64Array(PN), PIM = new Float64Array(PN), PQ = new Float64Array(2049);
const NOPITCH = { f0: 0, clar: 0 };

// ---------- material: a continuous recording with candidate boundaries ----------
// Positions are absolute sample indices. A live material is a ring: [start, end) slides on.
class Mat {
  constructor(id, sr, cap, ring) {
    this.id = id; this.sr = sr; this.ring = !!ring;
    this.C = Math.max(WIN * 2, cap | 0);
    this.d = new Float32Array(this.C);
    this.start = 0; this.end = 0;
    this.CF = Math.ceil(this.C / HOP) + 8;
    this.rms = new Float32Array(this.CF); this.cen = new Float32Array(this.CF);
    this.fla = new Float32Array(this.CF); this.flx = new Float32Array(this.CF);
    this.fNext = 0; this.pNext = 0;
    this.prev = new Float64Array(NB); this.hasPrev = false;
    this.peaks = [];                    // {pos, str}, sorted by pos; the candidates
    this.fmean = 0; this.fglobal = 0; this.rmsMax = 1e-6;
    this.fc = new Map(); this.pc = new Map();
    this.defer = false; this.frozen = false;
    this._re = new Float64Array(WIN); this._im = new Float64Array(WIN);
  }
  x(i) { return this.d[i % this.C]; }
  get dur() { return (this.end - this.start) / this.sr; }
  append(ch) {
    const C = this.C, d = this.d; let e = this.end;
    for (let i = 0; i < ch.length; i++) { d[e % C] = ch[i]; e++; }
    this.end = e;
    if (e - this.start > C) this.start = e - C;
    this._frames();
    if (!this.defer) this._pick(this.fNext - 9);
    if (this.ring) this._prune();
  }
  _f0() { return Math.ceil(this.start / HOP); }
  _frames() {
    const f0 = this._f0();
    if (this.fNext < f0) { this.fNext = f0; this.hasPrev = false; }
    while (this.fNext * HOP + WIN <= this.end) { this._frame(this.fNext); this.fNext++; }
  }
  _frame(f) {
    const s0 = f * HOP, re = this._re, im = this._im, C = this.C, d = this.d;
    let e2 = 0;
    for (let k = 0; k < WIN; k++) { const v = d[(s0 + k) % C] * HANN[k]; re[k] = v; im[k] = 0; e2 += v * v; }
    const r = Math.sqrt(e2 / HSQ);
    fft(re, im, WIN, false);
    let num = 0, den = 0, lsum = 0, psum = 0, flux = 0;
    const prev = this.prev, hp = this.hasPrev;
    for (let b = 1; b < NB; b++) {
      const p = re[b] * re[b] + im[b] * im[b], m = Math.sqrt(p);
      num += b * m; den += m; lsum += Math.log(p + 1e-12); psum += p + 1e-12;
      const lm = Math.log(1 + 100 * m);
      if (hp) { const dd = lm - prev[b]; if (dd > 0) flux += dd; }
      prev[b] = lm;
    }
    this.hasPrev = true;
    const i = f % this.CF;
    this.rms[i] = r;
    this.cen[i] = den > 1e-9 ? num / den * this.sr / WIN : 0;
    this.fla[i] = Math.exp(lsum / (NB - 1)) / (psum / (NB - 1));
    this.flx[i] = flux;
    if (r > this.rmsMax) this.rmsMax = r;
    this.fmean = this.fmean === 0 ? flux : this.fmean + (flux - this.fmean) / 600;
  }
  // spectral-flux peaks become candidates; nothing is decided here
  _pick(upto) {
    const f0 = this._f0(), fl = this.flx, CF = this.CF, last = this.fNext - 1;
    if (this.pNext < f0) this.pNext = f0;
    const minGap = Math.round(0.025 * this.sr), gate = this.rmsMax * 0.003;
    const scale = (this.fglobal || this.fmean) + 1e-9;
    for (let f = this.pNext; f < upto; f++) {
      const v = fl[f % CF];
      if (v <= 0) continue;
      let ok = true;
      for (let k = 1; k <= 3 && ok; k++) {
        if (f - k >= f0 && fl[(f - k) % CF] >= v) ok = false;
        if (f + k <= last && fl[(f + k) % CF] > v) ok = false;
      }
      if (!ok) continue;
      let sum = 0, n = 0;
      for (let k = Math.max(f0, f - 8); k <= Math.min(last, f + 8); k++) { sum += fl[k % CF]; n++; }
      const str = (v - sum / n) / scale;
      if (str < 0.12) continue;
      let r = 0;
      for (let k = f; k <= Math.min(last, f + 4); k++) r = Math.max(r, this.rms[k % CF]);
      if (r < gate) continue;
      const pos = this._refine(f);
      if (pos < 0 || this._lvl(pos, Math.round(0.012 * this.sr)) < gate) continue;
      const P = this.peaks, L = P[P.length - 1];
      if (L && pos - L.pos < minGap) {
        if (str > L.str && (P.length < 2 || pos - P[P.length - 2].pos >= minGap)) P[P.length - 1] = { pos, str };
        continue;
      }
      if (L && pos <= L.pos) continue;
      P.push({ pos, str });
    }
    if (upto > this.pNext) this.pNext = upto;
  }
  // the onset is where the energy jumps most inside (or just after) the frame's window
  _refine(f) {
    const s0 = f * HOP, C = this.C, d = this.d, B = 64;
    const a = Math.max(this.start, s0), b = Math.min(this.end, s0 + WIN + 256);
    const nb = Math.floor((b - a) / B);
    if (nb < 3) return Math.max(this.start, s0 + (WIN >> 1));
    let best = -1, bestV = 0, e1 = 0, e2 = 0;
    for (let k = 0; k < nb; k++) {
      let e = 0;
      for (let i = a + k * B, j = 0; j < B; i++, j++) { const v = d[i % C]; e += v * v; }
      e = Math.sqrt(e / B);
      if (k >= 2) { const up = e - Math.max(e1, e2); if (up > bestV) { bestV = up; best = k; } }
      e2 = e1; e1 = e;
    }
    if (best < 0) return -1;   // nothing rises here (e.g. the click of a sound being cut off)
    // first sample of that block that reaches a third of its peak, then a short pre-roll
    const s1 = a + best * B; let pk = 0;
    for (let i = s1; i < s1 + B; i++) pk = Math.max(pk, Math.abs(d[i % C]));
    let i = s1 - B;
    while (i < s1 + B && Math.abs(d[i % C]) < pk / 3) i++;
    return Math.max(this.start, i - Math.round(0.0015 * this.sr));
  }
  _lvl(pos, n) {
    let e = 0; const b = Math.min(this.end, pos + n);
    for (let i = pos; i < b; i++) { const v = this.d[i % this.C]; e += v * v; }
    return b > pos ? Math.sqrt(e / (b - pos)) : 0;
  }
  _prune() {
    const s = this.start; let k = 0;
    while (k < this.peaks.length && this.peaks[k].pos < s) k++;
    if (k) this.peaks.splice(0, k);
    if (this.fc.size > 4000) this.fc.clear();
    if (this.pc.size > 4000) this.pc.clear();
  }
  finalize() {
    const f0 = this._f0(); let s = 0, n = 0;
    for (let f = f0; f < this.fNext; f++) { s += this.flx[f % this.CF]; n++; }
    this.fglobal = n ? s / n : 0;
    this.peaks = []; this.pNext = f0; this.defer = false;
    this._pick(this.fNext);
  }
  lb(pos) {
    const P = this.peaks; let lo = 0, hi = P.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].pos < pos) lo = m + 1; else hi = m; }
    return lo;
  }
  cands(thr, a, b) {
    const P = this.peaks, out = [];
    for (let i = this.lb(a); i < P.length && P[i].pos < b; i++) if (P[i].str >= thr) out.push(P[i].pos);
    return out;
  }
  next(thr, pos) {
    const P = this.peaks;
    for (let i = this.lb(pos); i < P.length; i++) if (P[i].str >= thr) return P[i].pos;
    return -1;
  }
  count(thr) { let n = 0; for (const p of this.peaks) if (p.str >= thr) n++; return n; }

  // features of the span [s, e) taken as one unit
  feat(s, e) {
    const key = s + ':' + e, hit = this.fc.get(key);
    if (hit) return hit;
    const sr = this.sr, CF = this.CF, fv = this._f0(), fl = this.fNext - 1;
    let fa = Math.max(fv, Math.ceil((s - WIN / 2) / HOP)), fb = Math.min(fl, Math.floor((e - WIN / 2) / HOP));
    if (fb < fa) { fa = fb = Math.max(fv, Math.min(fl, Math.round((s - WIN / 2) / HOP))); }
    // spectrum from the analysis frames
    let w = 0, cw = 0, flw = 0;
    for (let f = fa; f <= fb; f++) {
      const i = f % CF, r = this.rms[i], e2 = r * r;
      w += e2; cw += e2 * this.cen[i]; flw += e2 * this.fla[i];
    }
    // level, attack and decay from the samples of the span itself (frames bleed in the neighbours)
    const BL = 256, nb = Math.max(1, Math.ceil((e - s) / BL)), blk = new Float64Array(nb);
    let pk = 0;
    for (let i = s, b = 0, acc = 0, n = 0; i < e; i++) {
      const v = this.d[i % this.C], a = Math.abs(v);
      if (a > pk) pk = a;
      acc += v * v; n++;
      if (n === BL || i === e - 1) { blk[b++] = Math.sqrt(acc / n); acc = 0; n = 0; }
    }
    let rmax = 0, bmax = 0;
    for (let b = 0; b < nb; b++) if (blk[b] > rmax) { rmax = blk[b]; bmax = b; }
    const third = Math.max(1, Math.floor(nb / 3));
    let r1 = 0, r2 = 0;
    for (let k = 0; k < third; k++) { r1 += blk[k]; r2 += blk[nb - 1 - k]; }
    const cent = w > 0 ? cw / w : 1000, fla = w > 0 ? flw / w : 0.5;
    const rise = Math.max(1, (bmax + 0.5) * BL / sr * 1000);
    const pt = this.pitch(s, e), voiced = pt.clar > 0.7;
    const hz = voiced ? pt.f0 : Math.max(60, cent);
    const F = {
      len: (e - s) / sr, f0: voiced ? pt.f0 : 0, clar: pt.clar, voiced,
      h: 69 + 12 * Math.log2(hz / 440), cent, fla,
      L0: 20 * Math.log10(rmax + 1e-9), rise, pk, decaying: nb < 3 || r2 < 0.6 * r1,
      T: [Math.log2(Math.max(cent, 50) / 1000) * 0.8, fla * 2, Math.log2(rise / 8) * 0.3, voiced ? 0 : 0.5],
    };
    this.fc.set(key, F);
    return F;
  }
  // YIN on the start of the unit; the autocorrelation goes through the FFT
  pitch(s, e) {
    const sr = this.sr, skip = Math.round(0.004 * sr);
    const W = Math.min(2048, (e - s - skip) & ~255);
    if (W < 480) return NOPITCH;
    const key = s + ':' + W, hit = this.pc.get(key);
    if (hit) return hit;
    const re = PRE, im = PIM, q = PQ;
    re.fill(0); im.fill(0); q[0] = 0;
    for (let k = 0; k < W; k++) { const v = this.d[(s + skip + k) % this.C]; re[k] = v; q[k + 1] = q[k] + v * v; }
    let res = NOPITCH;
    if (q[W] > 1e-7 * W) {
      fft(re, im, PN, false);
      for (let k = 0; k < PN; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
      fft(re, im, PN, true);
      const tmin = Math.max(2, Math.floor(sr / 1500)), tmax = Math.min(Math.floor(sr / 55), W >> 1);
      const dn = new Float64Array(tmax + 2);
      let run = 0;
      for (let t = 1; t <= tmax + 1; t++) {
        const d = q[W - t] + (q[W] - q[t]) - 2 * re[t] / PN;
        run += d; dn[t] = run > 0 ? d * t / run : 1;
      }
      let best = tmin, bestV = 1e9, found = -1;
      for (let t = tmin; t <= tmax; t++) {
        if (dn[t] < bestV) { bestV = dn[t]; best = t; }
        if (dn[t] < 0.15) { let u = t; while (u + 1 <= tmax && dn[u + 1] < dn[u]) u++; found = u; break; }
      }
      const t0 = found > 0 ? found : best;
      let tt = t0;
      if (t0 > tmin && t0 < tmax) {
        const a = dn[t0 - 1], b = dn[t0], c = dn[t0 + 1], den = a - 2 * b + c;
        if (Math.abs(den) > 1e-12) tt = t0 + 0.5 * (a - c) / den;
      }
      res = { f0: sr / tt, clar: Math.max(0, Math.min(1, 1 - dn[t0])) };
    }
    this.pc.set(key, res);
    return res;
  }
}

async function analyzeFile(mat, data, prog) {
  mat.defer = true;
  const CH = 1 << 15;
  for (let i = 0, k = 0; i < data.length; i += CH, k++) {
    mat.append(data.subarray(i, Math.min(data.length, i + CH)));
    if (k % 8 === 7) { if (prog) prog(i / data.length); await new Promise(r => setTimeout(r, 0)); }
  }
  mat.finalize();
}

function hashMat(mat) {
  let h = 0x811c9dc5;
  for (let i = mat.start; i < mat.end; i++) {
    const v = Math.round(mat.x(i) * 32767) & 0xffff;
    h ^= v & 255; h = Math.imul(h, 16777619);
    h ^= v >>> 8; h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------- parameters ----------
const sensThr = sens => 3.5 * Math.pow(0.05, sens / 100);
const ioiCenter = density => 0.9 * Math.pow(0.07 / 0.9, density / 100);
const usableEnd = mat => mat.ring ? Math.max(mat.start, mat.end - Math.round(0.3 * mat.sr)) : mat.end;
const gl = g => g + '|' + (g + 1);

function gainDb(F, target) {
  return Math.min(target - F.L0, 20 * Math.log10(0.9 / Math.max(F.pk, 1e-6)), 36);
}

// ---------- engine state ----------
function newState(seed) {
  return {
    seed: seed >>> 0, rng: rng32(seed), n: 0, hist: [],
    cur: { m: 0, pos: -1 },
    w: { a: 0.2, b: 0.2, c: 0.2, d: 0.2, e: 0.2 },   // the listener model: a hypothesis, not the listener
    supp: { a: 0, b: 0, c: 0, d: 0, e: 0 },
    tapGaps: [], tapPeriod: 0, tapSig: '',
    pendingTaps: [],
    stat: { ON: { pairs: 0, simple: 0 }, OFF: { pairs: 0, simple: 0 } },
  };
}

function weights(st, P) {
  const M = {}; let s = 0, n = 0;
  for (const x of CUES) if (P.cues[x]) { s += st.w[x]; n++; }
  for (const x of CUES) M[x] = P.cues[x] && s > 0 ? st.w[x] / (s / n) : 0;
  return M;
}

// ---------- how strongly each cue segments the recent units, and where ----------
function tdist(A, B) {
  let s = 0;
  for (let i = 0; i < A.length; i++) { const d = A[i] - B[i]; s += d * d; }
  return Math.sqrt(s);
}
function contrastN(arr, j, n) {
  let nb = 0, k = 0;
  if (j > 0) { nb += arr[j - 1]; k++; }
  if (j + 1 < n) { nb += arr[j + 1]; k++; }
  return Math.max(0, arr[j] - (k ? nb / k : 0));
}
function udist(U, i, i2) {
  const A = U[i], Ap = U[i - 1], B = U[i2], Bp = U[i2 - 1];
  const dh1 = (A.h - Ap.h) * (A.v && Ap.v ? 1 : 0.5), dh2 = (B.h - Bp.h) * (B.v && Bp.v ? 1 : 0.5);
  const li = Math.log2(A.ioi / B.ioi), dl = (A.L - Ap.L) - (B.L - Bp.L), dt = tdist(A.T, B.T);
  // mostly the pitch-interval and interval sequences; level and timbre count for less
  const a = (dh1 - dh2) / 3, b = li / 0.2, c = dl / 6, d = dt / 0.8;
  return a * a + b * b + 0.5 * c * c + 0.25 * d * d;
}
// the part of the repetition test that only involves units already played
function prepE(Ueb) {
  const Ke = Ueb.length + 1, out = [];
  for (let k = 2; 2 * k <= Ke - 1; k++) {
    let sum = 0, n = 0;
    for (let i = Ke - k; i < Ke - 1; i++) { const i2 = i - k; if (i2 < 1) continue; sum += udist(Ueb, i, i2); n++; }
    out[k] = { sum, n };
  }
  return out;
}
const LOC = 3;   // the boundary fight is fought over the last three gaps (A|BC against AB|C)
function pairDis(dist, str, M, G0, G, W) {
  for (const c of CUES) { const d = dist[c]; if (!d) continue; const r = W.sq[c]; for (let j = G0; j < G; j++) r[j] = Math.sqrt(d[j]); }
  let num = 0, den = 0;
  for (let i = 0; i < 5; i++) for (let k = i + 1; k < 5; k++) {
    const X = CUES[i], Y = CUES[k], wxy = M[X] * M[Y];
    if (!wxy) continue;
    den += wxy;
    if (!dist[X] || !dist[Y]) continue;
    const rx = W.sq[X], ry = W.sq[Y];
    let bc = 0;
    for (let j = G0; j < G; j++) bc += rx[j] * ry[j];
    num += wxy * Math.min(str[X], str[Y]) * (1 - bc);
  }
  return den ? num / den : 0;
}
// working arrays for evaluate: reused while searching, fresh for results that are kept
function mkScratch(n) {
  const f = () => new Float64Array(n), o = () => ({ a: f(), b: f(), c: f(), d: f(), e: f() });
  return { n, x: new Float64Array(n + 1), y: f(), z: f(), q: f(), rec: f(), cons: f(), b: o(), pa: o(), la: o(), sq: o() };
}
const RECP = []; for (let j = 0; j < 64; j++) RECP[j] = Math.pow(REC, j);
// U: the last N units (a..d), Ue: the last 2N units (e). Gap j lies between U[j] and U[j+1].
function evaluate(U, Ue, M, pre, W) {
  const K = U.length, G = K - 1;
  const S = { a: 0, b: 0, c: 0, d: 0, e: 0 };
  const res = { S, G, b: null, p: null, cons: null, dis: 0, disG: 0 };
  if (G < 1) return res;
  if (!W || W.n < G) W = mkScratch(G);
  const x = W.x, y = W.y, z = W.z, q = W.q, rec = W.rec, b = W.b;
  for (let j = 0; j < K; j++) { const u = U[j]; x[j] = Math.log2(u.ioi) + 0.5 * Math.max(0, u.ioi - u.snd) / u.ioi; }
  for (let j = 0; j < G; j++) {
    const A = U[j], B = U[j + 1];
    y[j] = Math.abs(B.h - A.h) * (A.v && B.v ? 1 : 0.5);
    z[j] = tdist(A.T, B.T);
    const dl = B.L - A.L; q[j] = dl > 0 ? dl : -0.5 * dl;
  }
  for (let j = 0; j < G; j++) {
    b.a[j] = Math.max(0, x[j] - (j > 0 ? 0.5 * (x[j - 1] + x[j + 1]) : x[j + 1]));
    b.b[j] = contrastN(y, j, G) / 12;
    b.c[j] = contrastN(z, j, G);
    b.d[j] = contrastN(q, j, G) / 12;
    b.e[j] = 0;
    rec[j] = RECP[G - 1 - j];
  }
  // pattern repetition: does the latest stretch of k units repeat the k before it?
  const Ke = Ue.length, off = Ke - K;
  for (let k = 2; 2 * k <= Ke - 1; k++) {
    let dist = 0, n = 0;
    if (pre && pre[k]) {
      dist = pre[k].sum; n = pre[k].n;
      if (Ke - 1 - k >= 1) { dist += udist(Ue, Ke - 1, Ke - 1 - k); n++; }
    } else {
      for (let i = Ke - k; i < Ke; i++) { const i2 = i - k; if (i2 < 1) continue; dist += udist(Ue, i, i2); n++; }
    }
    if (!n) continue;
    const sim = Math.exp(-0.5 * dist / n);
    if (sim > S.e) S.e = sim;
    let j = Ke - k - 1 - off; if (j >= 0 && j < G && sim > b.e[j]) b.e[j] = sim;
    j = Ke - 2 * k - 1 - off; if (j >= 0 && j < G && sim > b.e[j]) b.e[j] = sim;
  }
  for (const c of ['a', 'b', 'c', 'd']) {
    let mx = 0; const bc = b[c];
    for (let j = 0; j < G; j++) { const v = bc[j] * (0.4 + 0.6 * rec[j]); if (v > mx) mx = v; }
    S[c] = 1 - Math.exp(-mx / SCALE[c]);
  }
  // where each cue puts the boundary, as a distribution over the gaps (window-wide, by recency),
  // and over the last LOC gaps alone, with each cue's strength there
  const G0 = Math.max(0, G - LOC), p = {}, pl = {}, sl = {};
  for (const c of CUES) {
    const bc = b[c], pc = W.pa[c], lc = W.la[c];
    let s = 0, sL = 0, mx = 0;
    for (let j = 0; j < G; j++) {
      pc[j] = bc[j] * rec[j]; s += pc[j];
      if (j >= G0) { lc[j] = bc[j]; sL += bc[j]; if (bc[j] > mx) mx = bc[j]; } else lc[j] = 0;
    }
    if (s > 1e-9) { for (let j = 0; j < G; j++) pc[j] /= s; p[c] = pc; } else p[c] = null;
    if (sL > 1e-9) { for (let j = G0; j < G; j++) lc[j] /= sL; pl[c] = lc; } else pl[c] = null;
    sl[c] = c === 'e' ? mx : 1 - Math.exp(-mx / SCALE[c]);
  }
  // disagreement: strong cues that put their boundaries in different places
  res.dis = pairDis(pl, sl, M, G0, G, W);
  res.disG = pairDis(p, S, M, 0, G, W);
  res.sl = sl;
  const cons = W.cons; let mw = 0;
  for (let j = 0; j < G; j++) cons[j] = 0;
  for (const c of CUES) mw += M[c];
  for (const c of CUES) if (M[c] && p[c]) for (let j = 0; j < G; j++) cons[j] += M[c] * S[c] * p[c][j];
  if (mw) for (let j = 0; j < G; j++) cons[j] /= mw;
  res.b = b; res.p = p; res.cons = cons;
  return res;
}
function argmax(a, n) { let k = 0; for (let j = 1; j < n; j++) if (a[j] > a[k]) k = j; return k; }
function predOf(ev, nBase) {
  const out = {};
  for (const c of CUES) out[c] = ev.p && ev.p[c] ? gl(nBase + argmax(ev.p[c], ev.G)) : '-';
  return out;
}

// ---------- cutting: the same place can be one sound, two, or the tail of the one before ----------
function cutsIn(mat, k, a, b, thr, maxL, minL, rng, out) {
  const ue = usableEnd(mat);
  a = Math.max(a, mat.start); b = Math.min(b, ue - minL);
  if (b <= a) return;
  const cs = mat.cands(thr, a, Math.min(ue, b + 4 * maxL));
  const push = (s, e, ks, ke, absorbed, skipped) => {
    if (e - s < minL || e > ue || s < mat.start) return;
    out.push({ m: k, s, e, ks, ke, absorbed, skipped });
  };
  for (let i = 0; i < cs.length && cs[i] < b; i++) {
    const c = cs[i], n1 = i + 1 < cs.length ? cs[i + 1] : ue;
    const n2 = i + 2 < cs.length ? cs[i + 2] : -1, n3 = i + 3 < cs.length ? cs[i + 3] : -1, lim = c + maxL;
    push(c, Math.min(n1, lim), 'cand', n1 > lim ? 'cap' : (n1 === ue ? 'end' : 'next'), [], n1 > lim && n1 < ue ? [n1] : []);
    if (n2 > 0 && n1 < lim) push(c, Math.min(n2, lim), 'cand', 'merge', [n1], n2 > lim ? [n2] : []);
    if (n3 > 0 && n2 > 0 && n2 < lim) push(c, Math.min(n3, lim), 'cand', 'merge', [n1, n2], n3 > lim ? [n3] : []);
    const len0 = Math.min(n1, lim) - c, f = 0.3 + 0.35 * rng();
    if (len0 * f >= minL) push(c, c + Math.round(len0 * f), 'cand', 'trunc', [], n1 < ue ? [n1] : []);
    if (n1 - c >= 3 * minL) {
      const g = 0.25 + 0.4 * rng(), ts = c + 128 * Math.round(g * Math.min(n1 - c, 2 * maxL) / 128);
      if (n1 - ts >= minL) {
        const merge = n2 > 0 && n1 - ts < maxL * 0.6 && rng() < 0.5;
        const e = merge ? Math.min(n2, ts + maxL) : Math.min(n1, ts + maxL);
        push(ts, e, 'tail', merge ? 'merge' : (n1 > ts + maxL ? 'cap' : 'next'), merge ? [n1] : [], [c]);
      }
    }
  }
}

// the material's own next unit from a position (what OFF plays, and the reference for ON)
function natural(mat, k, pos, thr, maxL, wait) {
  const ue = usableEnd(mat);
  const c = mat.next(thr, pos);
  if (c < 0 || c >= ue - Math.round(0.01 * mat.sr)) return null;
  let cn = mat.next(thr, c + 1), atEnd = false;
  if (cn < 0 || cn >= ue) { if (wait) return null; cn = ue; atEnd = true; }
  const e = Math.min(cn, c + maxL);
  return {
    m: k, s: c, e, ks: 'cand', ke: e < cn ? 'cap' : (atEnd ? 'end' : 'next'),
    absorbed: [], skipped: e < cn && !atEnd ? [cn] : [], ioi: Math.min(6, Math.max(0.005, (cn - c) / mat.sr)), next: cn,
  };
}

function fixCursor(st, mats) {
  if (st.cur.m < 0 || st.cur.m >= mats.length) st.cur = { m: 0, pos: mats[0].start };
  const mt = mats[st.cur.m], ue = usableEnd(mt);
  if (st.cur.pos < mt.start) st.cur.pos = mt.start;
  if (st.cur.pos >= ue) {
    if (mt.ring && !mt.frozen) st.cur.pos = Math.max(mt.start, ue - 1);
    else if (mt.ring) st.cur.pos = mt.start;
    else { const k = (st.cur.m + 1) % mats.length; st.cur = { m: k, pos: mats[k].start }; }
  }
}

function decideOff(st, mats, P) {
  const thr = sensThr(P.sens);
  for (let tries = 0; tries <= mats.length; tries++) {
    const mat = mats[st.cur.m], maxL = Math.round(P.maxLen / 1000 * mat.sr);
    const live = mat.ring && !mat.frozen;
    const u = natural(mat, st.cur.m, st.cur.pos, thr, maxL, live);
    if (u) {
      u.F = mat.feat(u.s, u.e);
      const gdb = gainDb(u.F, OUT_REF + 3 + u.F.L0 - 20 * Math.log10(mat.rmsMax + 1e-9));
      u.gain = Math.pow(10, gdb / 20); u.L = u.F.L0 + gdb; u.lv = null;
      u.adv = u.next >= usableEnd(mat) ? usableEnd(mat) : u.next;
      u.broken = '-';
      return u;
    }
    if (live) return null;
    const k = (st.cur.m + 1) % mats.length;
    st.cur = { m: k, pos: mats[k].start };
  }
  return null;
}

// how well the recent intervals sit on one period and its multiples (a grid with jitter)
function gridFit(hist, ioi) {
  const v = hist.concat([ioi]); let best = 0;
  for (const base of v) for (let div = 1; div <= 3; div++) {
    const T = base / div; if (T < 0.025) continue;
    let fit = 0;
    for (const x of v) { const k = Math.round(x / T); if (k >= 1 && k <= 4 && Math.abs(Math.log2(x / (k * T))) < 0.07) fit++; }
    if (fit > best) best = fit;
  }
  return best / v.length;
}
function scoreCand(ctx, c, L, ioi, keep) {
  const F = c.F, st = ctx.st, M = ctx.M;
  const snd = Math.max(0.005, Math.min(F.len, ioi - 0.003));
  const u = { n: st.n + 1, h: F.h, v: F.voiced, T: F.T, L, ioi, snd };
  ctx.U[ctx.U.length - 1] = u; ctx.Ue[ctx.Ue.length - 1] = u;
  const ev = evaluate(ctx.U, ctx.Ue, M, ctx.pre, keep ? null : ctx.W);
  let sc = ev.dis + 0.5 * ev.disG, en = 0, sumS = 0;
  for (const x of CUES) {
    if (!M[x]) continue;
    en++; sumS += ev.S[x];
    sc -= M[x] * (3 * Math.max(0, ev.S[x] - TH_HI[x]) + 0.3 * Math.max(0, TH_LO - ev.S[x]) + 0.8 * st.supp[x] * ev.S[x]);
  }
  if (en) sc -= 2 * Math.max(0, TH_LO - sumS / en);
  let gf = ctx.grid.get(ioi);
  if (gf === undefined) { gf = gridFit(ctx.hIoi, ioi); ctx.grid.set(ioi, gf); }
  if (gf > 0.55) sc -= 2 * (gf - 0.55);
  // density sets where the intervals sit on average, not each interval
  const u0 = Math.log2(ioi / ctx.c0), mu = (ctx.hLog + u0) / (ctx.hIoi.length + 1);
  sc -= 0.8 * mu * mu + 0.04 * u0 * u0;
  if (ev.cons) {
    // a tapped grouping must not come back at the same spacing
    if (st.tapPeriod && st.tapGaps.length) {
      const lastG = st.tapGaps[st.tapGaps.length - 1];
      for (const g of [lastG + st.tapPeriod, lastG + 2 * st.tapPeriod]) {
        const j = g - ctx.nBase;
        if (j >= 0 && j < ev.G) sc -= 0.5 * ev.cons[j];
      }
    }
    // nor be held up by the same cues again at the newest gap
    if (st.tapSig) {
      const j = ev.G - 1;
      if (ev.cons[j] > 0.15 && sigAt(ev, j) === st.tapSig) sc -= 0.3;
    }
  }
  return { sc, ev };
}
function sigAt(ev, j) {
  let s = '';
  for (const c of CUES) {
    const bc = ev.b[c]; let mx = 0;
    for (let i = 0; i < ev.G; i++) if (bc[i] > mx) mx = bc[i];
    if (mx > 1e-9 && bc[j] >= 0.5 * mx && ev.S[c] > 0.2) s += c;
  }
  return s;
}

function brokenText(evR, evC, M, nBase) {
  if (!evR.cons || !evC.cons) return '-';
  const G0 = Math.max(0, evR.G - LOC); let jb = G0;
  for (let j = G0 + 1; j < evR.G; j++) if (evR.cons[j] > evR.cons[jb]) jb = j;
  const agree = CUES.filter(x => M[x] > 0 && evR.S[x] > 0.12 && evR.p[x] && argmax(evR.p[x], evR.G) === jb);
  if (agree.length >= 2) {
    const still = CUES.filter(x => M[x] > 0 && evC.S[x] > 0.12 && evC.p[x] && argmax(evC.p[x], evC.G) === jb);
    return `${gl(nBase + jb)} ${agree.join('+')} ${evR.cons[jb].toFixed(2)}→${evC.cons[jb].toFixed(2)}${still.length >= 2 ? ' 残' : ''}`;
  }
  const over = CUES.filter(x => M[x] > 0 && evR.S[x] > TH_HI[x]);
  if (over.length) return over.map(x => `${x}過剰 ${evR.S[x].toFixed(2)}→${evC.S[x].toFixed(2)}`).join(' ');
  return '-';
}

function decideOn(st, mats, P) {
  const mat0 = mats[st.cur.m], sr = mat0.sr, thr = sensThr(P.sens), rng = st.rng;
  const maxL = Math.max(Math.round(0.03 * sr), Math.round(P.maxLen / 1000 * sr)), minL = Math.round(0.025 * sr);
  const N = Math.max(3, P.N | 0), M = weights(st, P);
  const live0 = mat0.ring && !mat0.frozen;
  const nat = natural(mat0, st.cur.m, st.cur.pos, thr, maxL, live0);
  const cuts = [];
  const wins = [[st.cur.m, st.cur.pos - Math.round(1.5 * sr), st.cur.pos + Math.round(2.5 * sr)]];
  if (mats.length > 1) {
    const rel = (st.cur.pos - mat0.start) / Math.max(1, usableEnd(mat0) - mat0.start);
    for (let k = 0; k < mats.length; k++) if (k !== st.cur.m) {
      const mk = mats[k], c = mk.start + Math.round(rel * (usableEnd(mk) - mk.start));
      wins.push([k, c - Math.round(1.0 * sr), c + Math.round(1.5 * sr)]);
    }
  }
  for (const [k, a, b] of wins) cutsIn(mats[k], k, a, b, thr, maxL, minL, rng, cuts);
  if (!cuts.length) for (let k = 0; k < mats.length; k++) cutsIn(mats[k], k, mats[k].start, usableEnd(mats[k]), thr, maxL, minL, rng, cuts);
  if (!cuts.length) return null;
  if (cuts.length > MAXC) {
    for (let i = 0; i < MAXC; i++) {
      const j = i + Math.floor(rng() * (cuts.length - i));
      const t = cuts[i]; cuts[i] = cuts[j]; cuts[j] = t;
    }
    cuts.length = MAXC;
  }
  if (nat) cuts.unshift(nat);
  const pool = [];
  for (const c of cuts) {
    const mt = mats[c.m];
    c.F = mt.feat(c.s, c.e);
    if (c.F.L0 < 20 * Math.log10(mt.rmsMax + 1e-9) - 45) continue;
    pool.push(c);
  }
  if (!pool.length) return null;
  // the next interval: spread over a wide range, kept off simple ratios with the last two
  const H = st.hist, last = H[H.length - 1], prev = H[H.length - 2];
  const c0 = ioiCenter(P.density), o = rng();
  let iois = [];
  for (let k = 0; k < 20; k++) {
    const v = Math.min(3, Math.max(0.04, c0 * Math.pow(2, -1.0 + (k + o) * (2.1 / 20))));
    if (last && nearSimple(v, last.ioi)) continue;
    if (prev && nearSimple(v, prev.ioi)) continue;
    iois.push(v);
  }
  if (!iois.length) iois = [c0 * Math.pow(2, 0.37 + 0.1 * o)];
  const Ub = H.slice(-(N - 1)), Ueb = H.slice(-(2 * N - 1));
  const ctx = { U: Ub.concat([null]), Ue: Ueb.concat([null]), M, st, nBase: st.n + 1 - Ub.length, pre: prepE(Ueb), W: mkScratch(N), grid: new Map(), hIoi: H.slice(-(N - 1)).map(u => u.ioi), c0 };
  ctx.hLog = ctx.hIoi.reduce((s, v) => s + Math.log2(v / c0), 0);
  const recent = new Set(), recentS = new Set();
  for (const u of H.slice(-N)) { recent.add(u.m + ':' + u.s + ':' + u.e); recentS.add(u.m + ':' + u.s); }
  // stage A: every cut at every level, with one probe interval; stage B: the best of those with every interval
  const probe = iois[Math.floor(iois.length * 0.5)];
  const A = [];
  for (const c of pool) {
    let pen = recent.has(c.m + ':' + c.s + ':' + c.e) ? 0.3 : recentS.has(c.m + ':' + c.s) ? 0.12 : 0;
    pen += c.m === st.cur.m ? 0.008 * Math.abs(c.s - st.cur.pos) / sr : 0.02;
    c.pen = pen;
    for (const lv of LEVELS) {
      const gdb = gainDb(c.F, OUT_REF + lv), L = c.F.L0 + gdb;
      A.push({ c, lv, gdb, L, sc: scoreCand(ctx, c, L, probe).sc - pen });
    }
  }
  A.sort((x, y) => y.sc - x.sc);
  let B = null;
  for (const t of A.slice(0, 16)) for (const v of iois) {
    const sc = scoreCand(ctx, t.c, t.L, v).sc - t.c.pen;
    if (!B || sc > B.sc) B = { t, ioi: v, sc };
  }
  B.ev = scoreCand(ctx, B.t.c, B.t.L, B.ioi, true).ev;
  const c = B.t.c;
  const rec = {
    m: c.m, s: c.s, e: c.e, ks: c.ks, ke: c.ke, absorbed: c.absorbed, skipped: c.skipped,
    F: c.F, L: B.t.L, gain: Math.pow(10, B.t.gdb / 20), lv: B.t.lv, ioi: B.ioi, sc: B.sc,
    nc: pool.length, ni: iois.length, ev: B.ev, nBase: ctx.nBase, broken: '-',
  };
  if (nat && nat.F && nat.F.L0 >= 20 * Math.log10(mat0.rmsMax + 1e-9) - 45) {
    const refL = last ? last.L : nat.F.L0 + gainDb(nat.F, OUT_REF);
    const refIoi = Math.min(c0 * 2.1, Math.max(c0 * 0.5, nat.ioi));
    rec.broken = brokenText(scoreCand(ctx, nat, refL, refIoi, true).ev, B.ev, M, ctx.nBase);
  }
  return rec;
}

// taps arrive as evidence of a grouping that is settling; applied at the next choice
function applyTaps(st, P, on) {
  const out = [];
  while (st.pendingTaps.length) {
    const tp = st.pendingTaps.shift();
    const N = Math.max(3, P.N | 0), U = st.hist.slice(-N), M = weights(st, P);
    tp.atUnit = st.n + 1; tp.applied = false; tp.support = null;
    if (U.length >= 2) {
      const ev = evaluate(U, st.hist.slice(-2 * N), M), j = tp.u - 1 - U[0].n;
      if (ev.b && j >= 0 && j < ev.G) {
        const sup = {};
        for (const c of CUES) {
          let mx = 0; for (let i = 0; i < ev.G; i++) if (ev.b[c][i] > mx) mx = ev.b[c][i];
          sup[c] = mx > 1e-9 ? ev.b[c][j] / mx * Math.min(1, ev.S[c] / TH_LO) : 0;
        }
        tp.support = sup;
        if (on) {
          let tot = 0, wen = 0;
          for (const c of CUES) if (P.cues[c]) { tot += sup[c]; wen += st.w[c]; }
          if (tot > 0) {
            // the enabled cues keep their share; within it, weight moves toward what held this boundary up
            for (const c of CUES) if (P.cues[c]) st.w[c] = (1 - ETA) * st.w[c] + ETA * wen * sup[c] / tot;
            let s = 0; for (const c of CUES) { st.w[c] = Math.max(0.04, st.w[c]); s += st.w[c]; }
            for (const c of CUES) st.w[c] /= s;
          }
          for (const c of CUES) st.supp[c] = Math.min(1.5, st.supp[c] + sup[c]);
          const g = tp.u - 1, lastG = st.tapGaps[st.tapGaps.length - 1];
          if (lastG !== undefined) { const k = g - lastG; st.tapPeriod = k >= 2 && k <= 16 ? k : 0; }
          st.tapGaps.push(g); if (st.tapGaps.length > 8) st.tapGaps.shift();
          st.tapSig = CUES.filter(c => sup[c] >= 0.5).join('');
          tp.applied = true;
        }
      }
    }
    out.push(tp);
  }
  return out;
}

function commit(st, rec, mats, P, on) {
  const mat = mats[rec.m], sr = mat.sr, N = Math.max(3, P.N | 0);
  st.n++; rec.n = st.n; rec.eng = on ? 'ON' : 'OFF';
  rec.snd = Math.max(0.005, Math.min(rec.F.len, rec.ioi - 0.003));
  const last = st.hist[st.hist.length - 1];
  if (last) { const k = st.stat[rec.eng]; k.pairs++; if (nearSimple(rec.ioi, last.ioi, 0.02)) k.simple++; }
  st.hist.push({ n: st.n, m: rec.m, s: rec.s, e: rec.e, h: rec.F.h, v: rec.F.voiced, T: rec.F.T, L: rec.L, ioi: rec.ioi, snd: rec.snd });
  if (st.hist.length > 64) st.hist.shift();
  const U = st.hist.slice(-N);
  const ev = on && rec.ev ? rec.ev : evaluate(U, st.hist.slice(-2 * N), weights(st, P));
  rec.S = Object.assign({}, ev.S); rec.dis = ev.dis;
  rec.pred = predOf(ev, U[0].n);
  rec.w = Object.assign({}, st.w);
  delete rec.ev;
  if (on) st.cur = { m: st.cur.m, pos: st.cur.pos + Math.round(rec.ioi * sr) };
  else st.cur = { m: rec.m, pos: rec.adv };
  for (const c of CUES) st.supp[c] *= SUPP_DECAY;
}

function decide(st, mats, P, on) {
  if (!mats.length) return null;
  fixCursor(st, mats);
  const taps = applyTaps(st, P, on);
  const rec = on ? decideOn(st, mats, P) : decideOff(st, mats, P);
  if (!rec) return null;
  rec.taps = taps;
  commit(st, rec, mats, P, on);
  return rec;
}

// a unit as it sounds: attack + decay, faded at its end
function render(mat, rec) {
  const sr = mat.sr, span = rec.e - rec.s;
  const n = Math.max(8, Math.min(span, Math.round(rec.snd * sr)));
  const out = new Float32Array(n), g = rec.gain;
  const cut = n < span || rec.ke === 'cap' || rec.ke === 'trunc';
  const atk = Math.max(2, Math.min(Math.round(0.002 * sr), n >> 2));
  const fade = Math.max(2, Math.min(Math.round((cut ? 0.010 : 0.005) * sr), n >> 1));
  const dbEnd = rec.F.decaying ? 6 : 18, k = (dbEnd / 8.6859) / n;
  for (let i = 0; i < n; i++) {
    let env = Math.exp(-i * k);
    if (i < atk) env *= 0.5 - 0.5 * Math.cos(Math.PI * i / atk);
    const r = n - 1 - i;
    if (r < fade) env *= 0.5 - 0.5 * Math.cos(Math.PI * r / fade);
    out[i] = mat.x(rec.s + i) * env * g;
  }
  return out;
}

return {
  Mat, analyzeFile, hashMat, newState, decide, render, evaluate, nearSimple, sensThr, ioiCenter, usableEnd,
  CUES, CUE_NAME, TH_HI, TH_LO, LEVELS, OUT_REF, REACT, HOP, WIN, version: '1.0',
};
})();
if (typeof module !== 'undefined') module.exports = RS;
