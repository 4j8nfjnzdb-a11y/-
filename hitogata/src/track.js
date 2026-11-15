'use strict';
// ---- tracking and temporal smoothing -------------------------------------
// Only the masks and anchor points are smoothed. The picture itself is never
// interpolated: every output frame is built from that frame's own pixels.
//
// Flicker control for body masks (per person, on a fixed grid):
//  1. two thresholds: in above 0.6, out below 0.4, otherwise each cell keeps its last decision,
//  2. a cell joins at once (the leading edge never lags) but leaves only after two frames
//     in a row say so, which removes one-frame drop-outs,
//  3. when detection drops, the last mask is kept for the hold time, moving at the last speed.
// On the built-in sample this cuts cells that flip and flip back from 447 to 95 per frame.
// Shifting the old mask by the person's motion before comparing was tried and made it worse
// (1519): the centre of a walking body sways with the legs, so the shift itself jitters.

const HI = 0.6, LO = 0.4;
const REID = 1.2; // seconds a lost track is remembered so the same person keeps its number

class Tracker {
  constructor() { this.reset(16, 16); }
  reset(W, H) {
    this.W = W; this.H = H;
    this.gs = Math.min(1, 960 / Math.max(W, H));
    this.GW = Math.max(1, Math.round(W * this.gs)); this.GH = Math.max(1, Math.round(H * this.gs));
    this.persons = []; this.faces = []; this.nextP = 1; this.nextF = 1; this.lastT = null;
    this.union = new Uint8Array(this.GW * this.GH); this.label = new Uint8Array(this.GW * this.GH);
    this.pool = [];
  }
  clear() { this.reset(this.W, this.H); }
  _buf() { return this.pool.pop() || new Uint8Array(this.GW * this.GH); }
  _free(t) { if (t.st) { for (const b of t.st.concat(t.pd)) { b.fill(0); b.__r = null; this.pool.push(b); } t.st = null; t.pd = null; } }

  // det: detector output for this frame; t: seconds; P: parameters; withMasks: false for the fast scan analysis
  update(det, t, P, withMasks = true) {
    const dt = this.lastT === null ? 0 : t - this.lastT;
    if (this.lastT !== null && (dt <= 0 || dt > 1.0)) { // a jump in time (seek): start over
      for (const tr of this.persons) this._free(tr);
      this.persons = []; this.faces = [];
    }
    this.lastT = t;
    const hold = P.hold;
    this._persons(det.persons || [], t, Math.max(0, dt), hold, withMasks);
    this._faces(det.faces || [], t, Math.max(0, dt), hold);
    return this.state(t, P, withMasks);
  }

  // ------------------------------------------------------------- persons ---
  _persons(dets, t, dt, hold, withMasks) {
    const tracks = this.persons;
    const pred = tracks.map((tr) => { const e = tr.state === 'held' ? dt : Math.min(t - tr.lastSeen, 1); const ox = tr.vx * e, oy = tr.vy * e; return [tr.box[0] + ox, tr.box[1] + oy, tr.box[2] + ox, tr.box[3] + oy]; });
    const pairs = [];
    tracks.forEach((tr, i) => dets.forEach((d, j) => {
      const s = iou(pred[i], d.box);
      if (s > 0.15) pairs.push([s, i, j]);
      else {
        const h = Math.max(pred[i][3] - pred[i][1], d.box[3] - d.box[1]);
        const dist = Math.hypot((pred[i][0] + pred[i][2] - d.box[0] - d.box[2]) / 2, (pred[i][1] + pred[i][3] - d.box[1] - d.box[3]) / 2);
        const hr = (d.box[3] - d.box[1]) / Math.max(1, pred[i][3] - pred[i][1]);
        if (dist < 0.5 * h && hr > 0.6 && hr < 1.66) pairs.push([0.1 * (1 - dist / (0.5 * h)), i, j]);
      }
    }));
    pairs.sort((a, b) => b[0] - a[0]);
    const ut = new Set(), ud = new Set();
    for (const [, i, j] of pairs) { if (ut.has(i) || ud.has(j)) continue; ut.add(i); ud.add(j); this._seePerson(tracks[i], dets[j], t, withMasks); }
    tracks.forEach((tr, i) => { if (!ut.has(i)) this._missPerson(tr, t, dt, hold, withMasks); });
    dets.forEach((d, j) => { if (!ud.has(j)) { const tr = this._newPerson(d, t); tracks.push(tr); this._seePerson(tr, d, t, withMasks); } });
    this.persons = tracks.filter((tr) => { if (t - tr.lastSeen > REID) { this._free(tr); return false; } return true; });
  }
  _newPerson(d, t) {
    const id = this.nextP++;
    return { id, rand: hash01(id * 7919 + 13), born: t, lastSeen: t, seen: 0, box: d.box.slice(), vx: 0, vy: 0,
      fx: new OneEuro(1.2, 0.8), fy: new OneEuro(1.2, 0.8), fh: new OneEuro(0.5, 0.3), fax: new OneEuro(1.0, 0.8), fay: new OneEuro(1.0, 0.8),
      aoff: [0, 0], meanL: d.meanL || 0.45, lm: null, st: null, cur: 0, rect: null, sub: [0, 0], applied: false, fresh: true, state: 'seen' };
  }
  _seePerson(tr, d, t, withMasks) {
    const ncx = (d.box[0] + d.box[2]) / 2, ncy = (d.box[1] + d.box[3]) / 2;
    const gap = t - tr.lastSeen, cen = Tracker.centroid(d.mask), oc = tr.cen;
    if (gap > 0 && gap < 0.5 && !tr.fresh && oc) { const k = 1 - Math.exp(-gap / 0.12); tr.vx += ((cen[0] - oc[0]) / gap - tr.vx) * k; tr.vy += ((cen[1] - oc[1]) / gap - tr.vy) * k; }
    const relost = tr.state === 'lost';
    // compared in place: moving the old mask by the person's motion made edges flicker more (measured)
    if (withMasks) this._maskUpdate(tr, d.mask, relost || tr.fresh ? null : [0, 0]);
    tr.cen = cen;
    tr.box = d.box.slice(); tr.lastSeen = t; tr.seen++; tr.fresh = false; tr.state = 'seen';
    tr.meanL += ((d.meanL || tr.meanL) - tr.meanL) * 0.3;
    tr.lm = d.lm;
    const h = d.box[3] - d.box[1];
    tr.sx = tr.fx.filter(ncx, t, 1 / h); tr.sy = tr.fy.filter(ncy, t, 1 / h); tr.sh = tr.fh.filter(h, t, 1 / h);
    // texture anchor: the torso when the pose is known, else the box centre (kept continuous)
    let ax = ncx + tr.aoff[0], ay = ncy + tr.aoff[1];
    if (d.lm) {
      let x = 0, y = 0, n = 0;
      for (const j of [11, 12, 23, 24]) if (d.lm[3 * j + 2] > 0.5) { x += d.lm[3 * j]; y += d.lm[3 * j + 1]; n++; }
      if (n >= 3) { ax = x / n; ay = y / n; tr.aoff[0] += (ax - ncx - tr.aoff[0]) * 0.3; tr.aoff[1] += (ay - ncy - tr.aoff[1]) * 0.3; }
    }
    tr.ax = tr.fax.filter(ax, t, 1 / h); tr.ay = tr.fay.filter(ay, t, 1 / h);
  }
  _missPerson(tr, t, dt, hold, withMasks) {
    const since = t - tr.lastSeen;
    if (since <= hold + 1e-6 && tr.state !== 'lost') {
      tr.state = 'held';
      const ox = tr.vx * dt, oy = tr.vy * dt;
      tr.box = [tr.box[0] + ox, tr.box[1] + oy, tr.box[2] + ox, tr.box[3] + oy];
      tr.fx.shift(ox, t); tr.fy.shift(oy, t); tr.fax.shift(ox, t); tr.fay.shift(oy, t);
      tr.sx += ox; tr.sy += oy; tr.ax += ox; tr.ay += oy;
      if (withMasks) this._maskShift(tr, ox * this.gs, oy * this.gs);
      if (tr.cen) tr.cen = [tr.cen[0] + ox, tr.cen[1] + oy];
    } else tr.state = 'lost';
  }
  _maskUpdate(tr, m, shift) {
    const GW = this.GW, GH = this.GH, gs = this.gs;
    if (!tr.st) { tr.st = [this._buf(), this._buf()]; tr.pd = [this._buf(), this._buf()]; tr.cur = 0; tr.rect = null; }
    const A = tr.st[tr.cur], B = tr.st[1 - tr.cur], PA = tr.pd[tr.cur], PB = tr.pd[1 - tr.cur];
    let sx = 0, sy = 0;
    if (shift) { tr.sub[0] += shift[0]; tr.sub[1] += shift[1]; sx = Math.round(tr.sub[0]); sy = Math.round(tr.sub[1]); tr.sub[0] -= sx; tr.sub[1] -= sy; }
    const prevR = shift && tr.rect ? tr.rect : null;
    const nx0 = clamp(Math.floor(m.x * gs) - 1, 0, GW - 1), ny0 = clamp(Math.floor(m.y * gs) - 1, 0, GH - 1);
    const nx1 = clamp(Math.ceil((m.x + m.w) * gs) + 1, 0, GW - 1), ny1 = clamp(Math.ceil((m.y + m.h) * gs) + 1, 0, GH - 1);
    let x0 = nx0, y0 = ny0, x1 = nx1, y1 = ny1;
    if (prevR) { x0 = Math.min(x0, clamp(prevR[0] + sx, 0, GW - 1)); y0 = Math.min(y0, clamp(prevR[1] + sy, 0, GH - 1)); x1 = Math.max(x1, clamp(prevR[2] + sx, 0, GW - 1)); y1 = Math.max(y1, clamp(prevR[3] + sy, 0, GH - 1)); }
    if (B.__r) { const r = B.__r; for (let y = r[1]; y <= r[3]; y++) { B.fill(0, y * GW + r[0], y * GW + r[2] + 1); PB.fill(0, y * GW + r[0], y * GW + r[2] + 1); } }
    const kx = m.gw / m.w, ky = m.gh / m.h;
    let rx0 = GW, ry0 = GH, rx1 = -1, ry1 = -1;
    for (let y = y0; y <= y1; y++) {
      const sy0 = ((y + 0.5) / gs - m.y) * ky - 0.5;
      for (let x = x0; x <= x1; x++) {
        let v = 0; // this frame's detection, bilinear
        const sx0 = ((x + 0.5) / gs - m.x) * kx - 0.5;
        if (sx0 > -1 && sy0 > -1 && sx0 < m.gw && sy0 < m.gh) {
          const ix = Math.floor(sx0), iy = Math.floor(sy0), fx = sx0 - ix, fy = sy0 - iy;
          const g = (i, j) => (i < 0 || j < 0 || i >= m.gw || j >= m.gh ? 0 : m.data[j * m.gw + i]);
          v = ((g(ix, iy) * (1 - fx) + g(ix + 1, iy) * fx) * (1 - fy) + (g(ix, iy + 1) * (1 - fx) + g(ix + 1, iy + 1) * fx) * fy) / 255;
        }
        let pv = 0, pp = 0;
        if (prevR) { const px = x - sx, py = y - sy; if (px >= prevR[0] && px <= prevR[2] && py >= prevR[1] && py <= prevR[3]) { pv = A[py * GW + px]; pp = PA[py * GW + px]; } }
        // two thresholds; leaving takes two frames in a row, entering is immediate (no lag at the leading edge)
        let inside, pend = 0;
        if (!prevR) inside = v > 0.5;
        else if (pv >= 128) { if (v < LO) { pend = pp + 1; inside = pend < 2; if (!inside) pend = 0; } else inside = true; }
        else inside = v > HI;
        const o = inside ? Math.max(128, Math.round(v * 255)) : Math.min(127, Math.round(v * 255));
        const i = y * GW + x; B[i] = o; PB[i] = pend;
        if (o >= 8) { if (x < rx0) rx0 = x; if (x > rx1) rx1 = x; if (y < ry0) ry0 = y; if (y > ry1) ry1 = y; }
      }
    }
    B.__r = [x0, y0, x1, y1];
    tr.rect = rx1 >= 0 ? [rx0, ry0, rx1, ry1] : null;
    tr.cur = 1 - tr.cur;
  }
  _maskShift(tr, dx, dy) {
    if (!tr.st || !tr.rect) return;
    tr.sub[0] += dx; tr.sub[1] += dy;
    const sx = Math.round(tr.sub[0]), sy = Math.round(tr.sub[1]); tr.sub[0] -= sx; tr.sub[1] -= sy;
    if (!sx && !sy) return;
    const GW = this.GW, GH = this.GH, A = tr.st[tr.cur], B = tr.st[1 - tr.cur], PA = tr.pd[tr.cur], PB = tr.pd[1 - tr.cur], r = tr.rect;
    if (B.__r) { const q = B.__r; for (let y = q[1]; y <= q[3]; y++) { B.fill(0, y * GW + q[0], y * GW + q[2] + 1); PB.fill(0, y * GW + q[0], y * GW + q[2] + 1); } }
    const n = [clamp(r[0] + sx, 0, GW - 1), clamp(r[1] + sy, 0, GH - 1), clamp(r[2] + sx, 0, GW - 1), clamp(r[3] + sy, 0, GH - 1)];
    for (let y = n[1]; y <= n[3]; y++) for (let x = n[0]; x <= n[2]; x++) { const px = x - sx, py = y - sy, i = y * GW + x; if (px >= r[0] && px <= r[2] && py >= r[1] && py <= r[3]) { B[i] = A[py * GW + px]; PB[i] = PA[py * GW + px]; } }
    B.__r = n; tr.rect = n; tr.cur = 1 - tr.cur;
  }
  static centroid(m) { // centre of mass of the mask: steadier than the box centre while legs swing
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < m.gh; y++) for (let x = 0; x < m.gw; x++) if (m.data[y * m.gw + x] >= 128) { sx += x; sy += y; n++; }
    return n ? [m.x + (sx / n + 0.5) / m.gw * m.w, m.y + (sy / n + 0.5) / m.gh * m.h] : [m.x + m.w / 2, m.y + m.h / 2];
  }

  // --------------------------------------------------------------- faces ---
  _faces(dets, t, dt, hold) {
    const tracks = this.faces;
    const pairs = [];
    tracks.forEach((tr, i) => dets.forEach((d, j) => {
      const e = Math.min(t - tr.lastSeen, 1), ox = tr.vx * e, oy = tr.vy * e;
      const pb = [tr.box[0] + ox, tr.box[1] + oy, tr.box[2] + ox, tr.box[3] + oy];
      const s = iou(pb, d.box);
      if (s > 0.1) pairs.push([s, i, j]);
      else { const dist = Math.hypot((pb[0] + pb[2] - d.box[0] - d.box[2]) / 2, (pb[1] + pb[3] - d.box[1] - d.box[3]) / 2); if (dist < 0.6 * Math.max(tr.width, d.width)) pairs.push([0.05 * (1 - dist / (0.6 * Math.max(tr.width, d.width))), i, j]); }
    }));
    pairs.sort((a, b) => b[0] - a[0]);
    const ut = new Set(), ud = new Set();
    for (const [, i, j] of pairs) { if (ut.has(i) || ud.has(j)) continue; ut.add(i); ud.add(j); this._seeFace(tracks[i], dets[j], t); }
    tracks.forEach((tr, i) => {
      if (ut.has(i)) return;
      if (t - tr.lastSeen <= hold + 1e-6 && tr.state !== 'lost') {
        tr.state = 'held'; const ox = tr.vx * dt, oy = tr.vy * dt;
        tr.box = [tr.box[0] + ox, tr.box[1] + oy, tr.box[2] + ox, tr.box[3] + oy];
        tr.cx.shift(ox, t); tr.cy.shift(oy, t); tr.c[0] += ox; tr.c[1] += oy;
      } else tr.state = 'lost';
    });
    dets.forEach((d, j) => { if (!ud.has(j)) { const tr = { id: this.nextF++, born: t, lastSeen: t, kind: d.kind, vx: 0, vy: 0, fresh: true, applied: false, state: 'seen', box: d.box, width: d.width }; tr.rand = hash01(tr.id * 104729 + 7); tracks.push(tr); this._seeFace(tr, d, t); } });
    this.faces = tracks.filter((tr) => t - tr.lastSeen <= REID);
  }
  _seeFace(tr, d, t) {
    if (tr.kind !== d.kind) { tr.kind = d.kind; tr.fresh = true; }
    const ocx = (tr.box[0] + tr.box[2]) / 2, ocy = (tr.box[1] + tr.box[3]) / 2, ncx = (d.box[0] + d.box[2]) / 2, ncy = (d.box[1] + d.box[3]) / 2;
    const gap = t - tr.lastSeen;
    if (!tr.fresh && gap > 0 && gap < 0.5) { const k = 1 - Math.exp(-gap / 0.12); tr.vx += ((ncx - ocx) / gap - tr.vx) * k; tr.vy += ((ncy - ocy) / gap - tr.vy) * k; }
    tr.box = d.box; tr.lastSeen = t; tr.state = 'seen';
    const w = d.width;
    if (tr.fresh) { tr.cx = new OneEuro(1.5, 1.0); tr.cy = new OneEuro(1.5, 1.0); tr.fw = new OneEuro(0.8, 0.4); tr.fr = new OneEuro(1.2, 0.6); tr.q = null; }
    if (d.kind === 'lm') {
      const lm = d.lm, n = lm.length / 2;
      let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += lm[2 * i]; cy += lm[2 * i + 1]; } cx /= n; cy /= n;
      const a = fpos(lm, 33), b = fpos(lm, 263), roll = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const c = Math.cos(-roll), s = Math.sin(-roll), q = new Float32Array(lm.length);
      for (let i = 0; i < n; i++) { const dx = lm[2 * i] - cx, dy = lm[2 * i + 1] - cy; q[2 * i] = (c * dx - s * dy) / w; q[2 * i + 1] = (s * dx + c * dy) / w; }
      const k = tr.q && !tr.fresh ? 1 - Math.exp(-Math.max(gap, 1 / 60) / 0.05) : 1;
      if (!tr.q || tr.fresh) tr.q = q; else for (let i = 0; i < q.length; i++) tr.q[i] += (q[i] - tr.q[i]) * k;
      tr.c = [tr.cx.filter(cx, t, 1 / w), tr.cy.filter(cy, t, 1 / w)];
      tr.roll = tr.fr.filter(roll, t, 1);
    } else {
      const [ex, ey, rx, ry, ang, top] = d.ell;
      if (tr.fresh) { tr.frx = new OneEuro(0.8, 0.4); tr.fry = new OneEuro(0.8, 0.4); tr.ftop = new OneEuro(0.6, 0.2); }
      tr.c = [tr.cx.filter(ex, t, 1 / w), tr.cy.filter(ey, t, 1 / w)];
      tr.rx = tr.frx.filter(rx, t, 1 / w); tr.ry = tr.fry.filter(ry, t, 1 / w); tr.roll = tr.fr.filter(ang, t, 1);
      tr.top = tr.ftop.filter(top == null ? -1 : top, t, 1);
    }
    tr.width = tr.fw.filter(w, t, 1 / w);
    tr.fresh = false;
  }
  faceGeom(tr) {
    const c = tr.c, w = tr.width, roll = tr.roll, cs = Math.cos(roll), sn = Math.sin(roll);
    const toW = (qx, qy) => [c[0] + (cs * qx - sn * qy) * w, c[1] + (sn * qx + cs * qy) * w];
    if (tr.kind === 'lm') {
      const q = tr.q, grp = (k) => { const [o, n] = FG[k]; const r = []; for (let i = 0; i < n; i++) r.push([q[2 * (o + i)], q[2 * (o + i) + 1]]); return r; };
      const ovalL = grp('oval');
      const brows = grp('browR').concat(grp('browL'));
      const browTop = Math.min(...brows.map((p) => p[1])), ys = ovalL.map((p) => p[1]);
      const fh = Math.max(...ys) - Math.min(...ys);
      const cut = browTop - 0.14 * fh; // keep the forehead and fringe untouched
      const oval = ovalL.map(([x, y]) => toW(x, Math.max(y, cut)));
      const m = 0.03 + 1.2 / Math.max(1, w);
      const feats = ['eyeR', 'eyeL', 'browR', 'browL', 'lips', 'nose'].map((k) => inflatePoly(convexHull(grp(k)), k === 'lips' ? m * 1.2 : m).map(([x, y]) => toW(x, y)));
      return { oval, feats, center: c, width: w, roll, dark: false };
    }
    const n = 32, oval = [];
    const cut = (tr.top == null ? -1 : tr.top) * tr.ry / w + 0.03; // keep the hairline untouched
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; oval.push(toW(Math.cos(a) * tr.rx / w, Math.max(cut, Math.sin(a) * tr.ry / w))); }
    return { oval, feats: [], center: c, width: w, roll, dark: true };
  }

  // ------------------------------------------------------- frame state ---
  state(t, P, withMasks) {
    const out = { t, persons: [], faces: [], c: { pSeen: 0, pHeld: 0, pApplied: 0, pSize: 0, pRate: 0, fSeen: 0, fHeld: 0, fApplied: 0, fSize: 0, fRate: 0, noFace: 0 } };
    const C = out.c;
    for (const tr of this.persons) {
      if (tr.state === 'lost') continue;
      const h = tr.sh;
      const lo = tr.applied ? P.hMin * 0.96 : P.hMin, hi = tr.applied ? P.hMax * 1.04 : P.hMax;
      const sizeOK = h >= lo && h <= hi, rateOK = tr.rand * 100 < P.rate1;
      tr.applied = P.mode === 1 && sizeOK && rateOK;
      if (tr.state === 'seen') C.pSeen++; else C.pHeld++;
      if (P.mode === 1) { if (tr.applied) C.pApplied++; else if (!sizeOK) C.pSize++; else C.pRate++; }
      out.persons.push({ id: tr.id, state: tr.state, applied: tr.applied, reason: tr.applied ? '' : (!sizeOK ? 'size' : 'rate'), box: [tr.sx - (tr.box[2] - tr.box[0]) / 2, tr.sy - h / 2, tr.sx + (tr.box[2] - tr.box[0]) / 2, tr.sy + h / 2], rawBox: tr.box, anchor: [tr.ax, tr.ay], scale: h, height: h, meanL: tr.meanL, rand: tr.rand, since: t - tr.lastSeen, track: tr });
    }
    // faces: link to the person whose head they sit on (so "per person" rates agree)
    for (const tr of this.faces) {
      if (tr.state === 'lost') continue;
      const cx = tr.c[0], cy = tr.c[1];
      let owner = null;
      for (const p of out.persons) { const b = p.rawBox, hh = b[3] - b[1]; if (cx > b[0] && cx < b[2] && cy > b[1] - hh * 0.05 && cy < b[1] + hh * 0.3) { owner = p; break; } }
      const rand = owner ? owner.rand : tr.rand;
      const lo = tr.applied ? P.fMin * 0.96 : P.fMin, hi = tr.applied ? P.fMax * 1.04 : P.fMax;
      const sizeOK = tr.width >= lo && tr.width <= hi, rateOK = rand * 100 < P.rate2;
      tr.applied = P.mode === 2 && sizeOK && rateOK;
      if (tr.state === 'seen') C.fSeen++; else C.fHeld++;
      if (P.mode === 2) { if (tr.applied) C.fApplied++; else if (!sizeOK) C.fSize++; else C.fRate++; }
      const g = this.faceGeom(tr);
      out.faces.push(Object.assign(g, { id: tr.id, state: tr.state, applied: tr.applied, reason: tr.applied ? '' : (!sizeOK ? 'size' : 'rate'), box: tr.box, personId: owner ? owner.id : 0, since: t - tr.lastSeen }));
      if (owner) owner.hasFace = true;
    }
    // persons whose pose shows a face we did not find (MediaPipe only)
    for (const p of out.persons) {
      const lm = p.track.lm; if (!lm || p.hasFace || p.state !== 'seen') continue;
      if (lm[2] > 0.85 && lm[3 * 2 + 2] > 0.85 && lm[3 * 5 + 2] > 0.85) {
        const est = Math.max(Math.hypot(lm[21] - lm[24], lm[22] - lm[25]) * 1.05, Math.hypot(lm[6] - lm[15], lm[7] - lm[16]) * 2.0);
        if (est >= P.fMin) { p.faceMissing = true; C.noFace++; }
      }
    }
    if (withMasks) this.compose(out);
    return out;
  }
  // union of applied masks + which person owns each grid cell
  compose(out) {
    const U = this.union, Lb = this.label, GW = this.GW;
    U.fill(0); Lb.fill(0);
    let slot = 0; out.rect = null;
    const ap = out.persons.filter((p) => p.applied && p.track.st && p.track.rect);
    for (const p of ap) {
      if (slot >= 31) break;
      p.slot = ++slot;
      const tr = p.track, A = tr.st[tr.cur], r = tr.rect;
      for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) {
        const i = y * GW + x, v = A[i];
        if (v > U[i] || (v === U[i] && v > 0 && p.height > (ap[Lb[i] - 1] || p).height)) { U[i] = v; Lb[i] = slot; }
      }
      out.rect = out.rect ? [Math.min(out.rect[0], r[0]), Math.min(out.rect[1], r[1]), Math.max(out.rect[2], r[2]), Math.max(out.rect[3], r[3])] : r.slice();
    }
    out.slots = ap.filter((p) => p.slot);
  }
}
