// Kasane — shared helpers: 2D affine matrices, easing, colour, noise, path simplification.
// Every source file hangs its exports on KS so the files can be concatenated into one script
// (tools/build.mjs) and also loaded one by one under node for the offline tests.
'use strict';
var KS = globalThis.KS || (globalThis.KS = {});
(() => {
  const U = KS.U = {};

  U.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.isArr = Array.isArray;
  let uidN = 0;
  U.uid = (p = '') => p + (++uidN).toString(36) + Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  U.clone = (o) => JSON.parse(JSON.stringify(o));
  U.round = (x, d = 3) => { const k = 10 ** d; return Math.round(x * k) / k; };

  // ---- matrices: [a, b, c, d, e, f] with x' = a*x + c*y + e, y' = b*x + d*y + f (canvas order)
  U.mIdent = () => [1, 0, 0, 1, 0, 0];
  U.mMul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  U.mInv = (m) => {
    const d = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(d) < 1e-12) return [1, 0, 0, 1, -m[4], -m[5]];
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
  };
  U.mApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  U.mVec = (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];          // direction only, no translation
  // position · rotation · scale · (−anchor): the order After Effects uses for a layer transform
  U.mTRS = (px, py, deg, sx, sy, ax, ay) => {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
    return [a, b, cc, d, px - (a * ax + cc * ay), py - (b * ax + d * ay)];
  };
  U.mScaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));        // area-preserving mean scale
  U.mRotOf = (m) => Math.atan2(m[1], m[0]) * 180 / Math.PI;
  U.mScale = (s, t = s) => [s, 0, 0, t, 0, 0];
  U.mTrans = (x, y) => [1, 0, 0, 1, x, y];

  // ---- cubic-bezier easing, CSS style: e = [x1, y1, x2, y2], maps progress in time to progress in value
  U.bez = (e, x) => {
    if (!e) return x;
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const x1 = U.clamp(e[0], 0, 1), y1 = e[1], x2 = U.clamp(e[2], 0, 1), y2 = e[3];
    if (x1 === y1 && x2 === y2) return x;
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    let t = x;
    for (let i = 0; i < 8; i++) {                                           // Newton
      const xt = ((ax * t + bx) * t + cx) * t - x;
      if (Math.abs(xt) < 1e-6) return ((ay * t + by) * t + cy) * t;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-6) break;
      t -= xt / d;
    }
    let lo = 0, hi = 1; t = x;                                              // bisection when Newton stalls
    for (let i = 0; i < 24; i++) {
      const xt = ((ax * t + bx) * t + cx) * t;
      if (Math.abs(xt - x) < 1e-6) break;
      if (xt < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return ((ay * t + by) * t + cy) * t;
  };
  U.EASE = {
    linear: null, ease: [0.333, 0, 0.667, 1], in: [0.55, 0, 1, 1], out: [0, 0, 0.45, 1],
    strong: [0.8, 0, 0.2, 1], back: [0.3, -0.4, 0.3, 1.45], spring: [0.2, 1.6, 0.4, 1], snap: [0.9, 0, 0.1, 1],
  };

  // ---- values: numbers or arrays of numbers (vectors, colours)
  U.vlerp = (a, b, t) => {
    if (typeof a === 'number') return a + (b - a) * t;
    const n = a.length, o = new Array(n);
    for (let i = 0; i < n; i++) o[i] = a[i] + ((b[i] === undefined ? a[i] : b[i]) - a[i]) * t;
    return o;
  };
  U.veq = (a, b) => {
    if (typeof a === 'number' || typeof b === 'number') return a === b;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  U.vcopy = (a) => (U.isArr(a) ? a.slice() : a);

  // ---- colour: stored as [r, g, b, a] in 0..1, not premultiplied
  U.hex2rgba = (h, a = 1) => {
    h = String(h || '').replace('#', '').trim();
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return [1, 1, 1, a];
    const n = parseInt(h.slice(0, 6), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : a];
  };
  U.rgba2hex = (c) => '#' + [0, 1, 2].map((i) => Math.round(U.clamp(c[i], 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  U.rgbaCss = (c, mul = 1) => `rgba(${Math.round(U.clamp(c[0], 0, 1) * 255)},${Math.round(U.clamp(c[1], 0, 1) * 255)},${Math.round(U.clamp(c[2], 0, 1) * 255)},${U.clamp((c[3] === undefined ? 1 : c[3]) * mul, 0, 1)})`;

  // ---- deterministic randomness
  U.rng = (seed) => {                                                       // mulberry32
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  U.hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  U.hash1 = (n, seed = 0) => { let h = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // smooth 1-D noise in [-1, 1]; what wiggle() and the torn edges are built on
  // (random targets once per unit, joined by a Catmull-Rom spline — it never snaps back to zero on the beat)
  U.noise1 = (x, seed = 0) => {
    const i = Math.floor(x), f = x - i, v = (k) => U.hash1(k, seed) * 2 - 1;
    const p0 = v(i - 1), p1 = v(i), p2 = v(i + 1), p3 = v(i + 2);
    const y = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    return U.clamp(y, -1, 1);
  };

  // ---- Ramer–Douglas–Peucker on n-dimensional points; keeps the first and last point
  U.rdp = (pts, eps) => {
    const n = pts.length;
    if (n < 3) return pts.map((_, i) => i);
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(), A = pts[a], B = pts[b], dim = A.length;
      let len2 = 0; for (let k = 0; k < dim; k++) len2 += (B[k] - A[k]) ** 2;
      let worst = -1, wd = eps * eps;
      for (let i = a + 1; i < b; i++) {
        const P = pts[i]; let t = 0;
        if (len2 > 0) { for (let k = 0; k < dim; k++) t += (P[k] - A[k]) * (B[k] - A[k]); t = U.clamp(t / len2, 0, 1); }
        let d2 = 0; for (let k = 0; k < dim; k++) d2 += (P[k] - (A[k] + (B[k] - A[k]) * t)) ** 2;
        if (d2 > wd) { wd = d2; worst = i; }
      }
      if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
    }
    const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
    return out;
  };

  // ---- time display: m:ss:ff (frames), the way an editing timeline counts
  U.fmtTime = (t, fps) => {
    const neg = t < 0; t = Math.abs(t);
    const f = Math.round(t * fps), ff = f % Math.round(fps), s = Math.floor(f / Math.round(fps));
    return (neg ? '-' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ':' + String(ff).padStart(2, '0');
  };
  U.parseTime = (str, fps) => {
    str = String(str).trim();
    if (/^-?\d+(\.\d+)?s?$/.test(str)) return parseFloat(str);              // plain seconds
    if (/^\d+f$/.test(str)) return parseInt(str, 10) / fps;                  // frames
    const p = str.split(':').map((x) => parseFloat(x) || 0);
    if (p.length === 3) return p[0] * 60 + p[1] + p[2] / fps;
    if (p.length === 2) return p[0] + p[1] / fps;
    return NaN;
  };
  U.fmtNum = (x, d = 1) => { const s = (+x).toFixed(d); return d ? s.replace(/\.?0+$/, '') : s; };

  U.debounce = (fn, ms) => { let h = 0; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
  U.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
})();
