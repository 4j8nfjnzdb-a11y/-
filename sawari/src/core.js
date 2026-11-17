// Sawari core: seeded randomness, small maths and polyline geometry.
// Pure functions only, so the same code runs in the page and in Node tests.
const SAWARI_CORE = (() => {
  // mulberry32: small, fast, good enough for musical chance; state is one uint32
  function makeRng(seed) {
    let s = seed >>> 0;
    const r = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.get = () => s;
    r.set = v => { s = v >>> 0; };
    return r;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  // string/number -> stable [0,1)
  function hash01(v) {
    const s = String(v);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  // smooth 1-D value noise in [0,1], deterministic from a seed value
  function noise1(seed, t) {
    const i = Math.floor(t), f = t - i;
    const a = hash01(seed + ':' + i), b = hash01(seed + ':' + (i + 1));
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }
  let idCount = 0;
  const idSalt = Math.floor(Math.random() * 46656).toString(36);
  function uid(prefix) { idCount++; return prefix + idSalt + idCount.toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  // ---- polylines (rails) ----
  // cached on the rail as a non-enumerable property so it never reaches JSON
  function railGeom(rail) {
    const pts = rail.pts;
    let sig = pts.length + (rail.closed ? 'c' : 'o');
    for (let i = 0; i < pts.length; i++) sig += ',' + pts[i][0].toFixed(1) + ',' + pts[i][1].toFixed(1);
    const c = rail._g;
    if (c && c.sig === sig) return c;
    const n = pts.length, segs = rail.closed ? n : n - 1, cum = [0];
    let L = 0;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      L += Math.hypot(b[0] - a[0], b[1] - a[1]);
      cum.push(L);
    }
    const g = { sig, cum, L: Math.max(L, 1e-6), segs, ver: (c ? c.ver + 1 : 1) };
    Object.defineProperty(rail, '_g', { value: g, writable: true, configurable: true, enumerable: false });
    return g;
  }
  // point and tangent angle at arc length s (s already wrapped into [0, L])
  function railPoint(rail, s) {
    const g = railGeom(rail), pts = rail.pts, n = pts.length;
    if (n < 2) return { x: n ? pts[0][0] : 0, y: n ? pts[0][1] : 0, ang: 0 };
    s = clamp(s, 0, g.L);
    let lo = 0, hi = g.segs;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g.cum[m] <= s) lo = m; else hi = m; }
    const a = pts[lo], b = pts[(lo + 1) % n];
    const seg = g.cum[lo + 1] - g.cum[lo] || 1e-6, t = (s - g.cum[lo]) / seg;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  // closest point on the rail: arc length s and distance d
  function railNearest(rail, x, y) {
    const g = railGeom(rail), pts = rail.pts, n = pts.length;
    let best = { s: 0, d: Infinity, x: 0, y: 0 };
    for (let i = 0; i < g.segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
      let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best.d) best = { s: g.cum[i] + t * Math.sqrt(l2), d, x: px, y: py };
    }
    return best;
  }
  // thin out a freehand stroke: drop points closer than `min` to the last kept one
  function thin(pts, min) {
    if (pts.length < 3) return pts.slice();
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const l = out[out.length - 1];
      if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) >= min) out.push(pts[i]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function circlePts(cx, cy, r, n) {
    const out = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return out;
  }
  function distToSeg(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - ax - dx * t, y - ay - dy * t);
  }
  const deepClone = o => JSON.parse(JSON.stringify(o));
  return { makeRng, clamp, lerp, TAU, hash01, noise1, uid, railGeom, railPoint, railNearest, thin, circlePts, distToSeg, deepClone };
})();
if (typeof module === 'object' && module.exports) module.exports = SAWARI_CORE;
