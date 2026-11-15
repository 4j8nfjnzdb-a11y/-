'use strict';
// ---- small helpers shared by every part ----------------------------------

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '–');

// integer hash -> [0,1)
function hash01(n) {
  n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
// seeded generator (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// One Euro filter (Casiez et al.): smooths jitter when slow, follows quickly when fast.
// `speedScale` turns the speed into a unit that does not depend on the picture size.
class OneEuro {
  constructor(minCutoff = 1.0, beta = 1.0, dCutoff = 1.0) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.x = null; this.dx = 0; this.t = null; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  reset(x, t) { this.x = x; this.dx = 0; this.t = t; }
  filter(x, t, speedScale = 1) {
    if (this.x === null || this.t === null || t <= this.t || t - this.t > 1) { this.reset(x, t); return x; }
    const dt = t - this.t; this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx) * speedScale;
    this.x += OneEuro.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
  // move without filtering (used while a track is held: shift by its last speed)
  shift(d, t) { if (this.x !== null) this.x += d; this.t = t; }
}

function convexHull(pts) { // pts: array of [x,y]
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  hi.pop(); lo.pop(); return lo.concat(hi);
}
// push every vertex of a convex polygon away from its centroid by `m` px
function inflatePoly(poly, m) {
  let cx = 0, cy = 0; for (const q of poly) { cx += q[0]; cy += q[1]; } cx /= poly.length; cy /= poly.length;
  return poly.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x + dx / l * m, y + dy / l * m]; });
}
function polyBox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) { const x = poly[i], y = poly[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const I = ix * iy, A = (a[2] - a[0]) * (a[3] - a[1]), B = (b[2] - b[0]) * (b[3] - b[1]);
  return I / Math.max(1e-6, A + B - I);
}
function overlapMin(a, b) { // intersection over the smaller box
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return ix * iy / Math.max(1e-6, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])));
}

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// per-viewer conveniences only (remembered model files, test log); never required
const store = {
  get(k, d) { try { const v = localStorage.getItem('hitogata:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('hitogata:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
const idb = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    this._db = await new Promise((res, rej) => { const r = indexedDB.open('hitogata', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return this._db;
  },
  async get(k) { try { const db = await this.open(); return await new Promise((res) => { const q = db.transaction('files').objectStore('files').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } },
  async put(k, v) { try { const db = await this.open(); await new Promise((res) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(v, k); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ } },
  async del(k) { try { const db = await this.open(); await new Promise((res) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(k); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ } },
};
