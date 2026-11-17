// Sawari drawing: one oblique view of a ground plane where flat signs, extruded
// buildings, rails, trains, rings and birds share the same space. The renderer
// reads the world at its own time Tv (which can trail the sound on purpose) and
// never decides anything about sound.
const SAWARI_DRAW = (() => {
  const W = SAWARI_WORLD, C = SAWARI_CORE;
  const { clamp, TAU, hash01 } = C;

  class View {
    constructor() { this.x = 0; this.y = 0; this.z = 0.42; this.tilt = 0.5; this.w = 800; this.h = 600; }
    get ct() { return Math.cos(this.tilt); }
    get st() { return Math.sin(this.tilt); }
    sx(x) { return (x - this.x) * this.z + this.w / 2; }
    sy(y, h = 0) { return ((y - this.y) * this.ct - h * this.st) * this.z + this.h / 2; }
    toWorld(px, py, h = 0) { return { x: (px - this.w / 2) / this.z + this.x, y: ((py - this.h / 2) / this.z + h * this.st) / this.ct + this.y }; }
  }

  let PAL = null;
  function readPalette() {
    const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
    const dark = v('--is-dark') === '1';
    PAL = { dark, ground: v('--ground'), grid: v('--grid'), ink: v('--ink'), dim: v('--dim'), faint: v('--faint'), accent: v('--accent'), signal: v('--signal'), rec: v('--rec'), paper: v('--paper'), mono: v('--f-mono'), disp: v('--f-disp') };
    patCache.clear();
    return PAL;
  }
  const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
  function fragColors(hue) {
    return PAL.dark
      ? { fill: hsl(hue, 34, 46), side: hsl(hue, 30, 32), top: hsl(hue, 36, 56), line: hsl(hue, 30, 78) }
      : { fill: hsl(hue, 40, 64), side: hsl(hue, 30, 48), top: hsl(hue, 44, 74), line: hsl(hue, 45, 24) };
  }

  // screen-space textures (like printed screen tone), cached per colour
  const patCache = new Map();
  function pattern(g, tex, color) {
    const key = tex + color;
    if (patCache.has(key)) return patCache.get(key);
    const c = document.createElement('canvas'), s = 8; c.width = c.height = s;
    const x = c.getContext('2d'); x.strokeStyle = color; x.fillStyle = color; x.lineWidth = 1.2;
    if (tex === 'hatch') { x.beginPath(); x.moveTo(0, s); x.lineTo(s, 0); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(s - 2, s + 2); x.lineTo(s + 2, s - 2); x.stroke(); }
    else if (tex === 'dots') { x.beginPath(); x.arc(4, 4, 1.3, 0, TAU); x.fill(); }
    else if (tex === 'lines') { x.fillRect(0, 0, s, 1.4); }
    else if (tex === 'check') { x.fillRect(0, 0, 4, 4); x.fillRect(4, 4, 4, 4); }
    const p = g.createPattern(c, 'repeat'); patCache.set(key, p); return p;
  }

  // local unit shape -> world points
  const place = (pts, p) => { const ca = Math.cos(p.ang), sa = Math.sin(p.ang); return pts.map(([lx, ly]) => [p.x + (lx * ca - ly * sa) * p.r, p.y + (lx * sa + ly * ca) * p.r]); };
  const regular = (n, r = 1, rot = 0) => { const o = []; for (let i = 0; i < n; i++) { const a = rot + i / n * TAU; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; };
  function footprint(sk) {
    const n = clamp(sk.sides || 5, 3, 12);
    switch (sk.type) {
      case 'poly': return regular(n, 1, -Math.PI / 2);
      case 'star': { const o = []; for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i / (n * 2) * TAU, r = i % 2 ? 0.42 : 1; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; }
      case 'blob': { const o = []; for (let i = 0; i < 14; i++) { const a = i / 14 * TAU, r = 0.66 + 0.34 * hash01(sk.seed + ':' + i); o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; }
      case 'strip': return [[-1, -0.32], [1, -0.32], [1, 0.32], [-1, 0.32]];
      case 'box': return [[-0.72, -0.72], [0.72, -0.72], [0.72, 0.72], [-0.72, 0.72]];
      case 'house': return [[-0.75, -0.55], [0.75, -0.55], [0.75, 0.55], [-0.75, 0.55]];
      case 'tower': return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      default: return regular(n, 1, -Math.PI / 2);
    }
  }

  class Renderer {
    constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); this.trails = new Map(); readPalette(); }
    palette() { return readPalette(); }
    resize(w, h, dpr) { this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); this.dpr = dpr; }

    // ---- primitives in world coordinates ----
    path(pts, h = 0, close = true) {
      const g = this.g, V = this.V;
      g.beginPath();
      pts.forEach(([x, y], i) => { const X = V.sx(x), Y = V.sy(y, h); i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
      if (close) g.closePath();
    }
    smoothPath(pts, h = 0) {
      const g = this.g, V = this.V, n = pts.length, P = pts.map(([x, y]) => [V.sx(x), V.sy(y, h)]);
      g.beginPath();
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let m = mid(P[n - 1], P[0]); g.moveTo(m[0], m[1]);
      for (let i = 0; i < n; i++) { const p = P[i], q = mid(P[i], P[(i + 1) % n]); g.quadraticCurveTo(p[0], p[1], q[0], q[1]); }
      g.closePath();
    }
    ellipse(x, y, r, h = 0) { const V = this.V; this.g.beginPath(); this.g.ellipse(V.sx(x), V.sy(y, h), Math.max(0.1, r * V.z), Math.max(0.1, r * V.z * V.ct), 0, 0, TAU); }
    fillTex(tex, col, lineCol) {
      const g = this.g;
      if (tex === 'outline') { g.lineWidth = 2; g.strokeStyle = lineCol; g.stroke(); return; }
      g.fillStyle = col; g.fill();
      if (tex !== 'solid') { g.fillStyle = pattern(g, tex, lineCol); g.globalAlpha *= 0.55; g.fill(); g.globalAlpha /= 0.55; }
    }
    // convex prism with visible sides, then the top
    prism(pts, h, cols, top = true) {
      const g = this.g, n = pts.length;
      let area = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
      const sg = area > 0 ? 1 : -1, faces = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1];
        const ny = sg > 0 ? -ex : ex;
        if (ny > 0) faces.push({ a, b, m: (a[1] + b[1]) / 2, k: clamp(ny / (Math.hypot(ex, ey) || 1), 0, 1) });
      }
      faces.sort((p, q) => p.m - q.m);
      for (const f of faces) {
        this.path([f.a, f.b], 0, false);
        const V = this.V; g.lineTo(V.sx(f.b[0]), V.sy(f.b[1], h)); g.lineTo(V.sx(f.a[0]), V.sy(f.a[1], h)); g.closePath();
        g.fillStyle = cols.side; g.fill(); g.strokeStyle = cols.line; g.lineWidth = 1; g.stroke();
        f.drawn = true;
      }
      if (top) { this.path(pts, h); g.fillStyle = cols.top; g.fill(); g.strokeStyle = cols.line; g.lineWidth = 1; g.stroke(); }
      return faces;
    }
    cylinder(x, y, r, h, cols) {
      const g = this.g, V = this.V, X = V.sx(x), Y0 = V.sy(y), Y1 = V.sy(y, h), rx = r * V.z, ry = r * V.z * V.ct;
      g.beginPath(); g.moveTo(X - rx, Y1); g.lineTo(X - rx, Y0); g.ellipse(X, Y0, rx, ry, 0, Math.PI, 0, true); g.lineTo(X + rx, Y1); g.closePath();
      g.fillStyle = cols.side; g.fill(); g.strokeStyle = cols.line; g.lineWidth = 1; g.stroke();
      g.beginPath(); g.ellipse(X, Y1, rx, ry, 0, 0, TAU); g.fillStyle = cols.top; g.fill(); g.stroke();
    }

    // ---- the whole frame ----
    draw(S) {
      const g = this.g, V = S.view, dpr = this.dpr; this.V = V; this.S = S;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = PAL.ground; g.fillRect(0, 0, V.w, V.h);
      this.drawGround();
      const sim = S.sim, w = S.world, Tv = S.Tv;
      for (const m of sim.rooms) this.drawRoomFloor(m, S.sel.has(m.id));
      for (const sc of sim.scans) this.drawScan(sc, Tv, S.sel.has(sc.id));
      for (const sw of sim.sweeps) this.drawSweepBase(sw, S.sel.has(sw.id));
      for (const r of sim.rails) this.drawRail(r, S.sel.has(r.id));
      for (const rp of sim.ripples) this.drawRings(rp, Tv, S.sel.has(rp.id));
      for (const th of sim.threads) this.drawThread(th, Tv, S.sel.has(th.id));
      // standing things, painter-sorted by ground y
      const items = [];
      for (const f of sim.frags) { const p = sim.pose(f, Tv, false); items.push({ y: p.y, k: 0, o: f, p }); }
      for (const t of sim.things) items.push({ y: t.y, k: 1, o: t, p: { x: t.x, y: t.y, ang: t.ang, r: t.r } });
      for (const tr of sim.trains) sim.trainCars(tr, Tv).forEach((c, j) => items.push({ y: c.y, k: 2, o: tr, c, j }));
      for (const fl of sim.flockObjs) { const ags = sim.flocks.get(fl.id) || []; ags.forEach((a, j) => { const q = sim.agentAt(a, Tv); items.push({ y: q.y, k: 3, o: fl, q, j, a }); }); }
      items.sort((a, b) => a.y - b.y);
      for (const it of items) {
        if (it.k === 0) this.drawFrag(it.o, it.p, S);
        else if (it.k === 1) this.drawSkin(it.o, it.p, S, null, true);
        else if (it.k === 2) this.drawCar(it.o, it.c, it.j, S);
        else this.drawBird(it.o, it.q, it.a, it.j, Tv);
      }
      for (const m of sim.rooms) this.drawRoomWalls(m, S.sel.has(m.id));
      for (const rp of sim.ripples) this.drawEmblem(rp.x, rp.y, 'ripple', S.sel.has(rp.id));
      for (const sw of sim.sweeps) this.drawSweepArm(sw, Tv);
      for (const fl of sim.flockObjs) this.drawEmblem(fl.x, fl.y, 'flock', S.sel.has(fl.id));
      this.drawSelection(S);
      if (S.overlay) S.overlay(g, V);
    }
    drawGround() {
      const g = this.g, V = this.V, B = W.BOUNDS;
      g.strokeStyle = PAL.grid; g.fillStyle = PAL.grid;
      if (V.z > 0.18) {
        const step = V.z > 0.8 ? 50 : 100, r = V.z > 0.8 ? 1 : 1.2;
        const tl = V.toWorld(0, 0), br = V.toWorld(V.w, V.h);
        const x0 = Math.max(B.x0, Math.floor(tl.x / step) * step), x1 = Math.min(B.x1, br.x), y0 = Math.max(B.y0, Math.floor(tl.y / step) * step), y1 = Math.min(B.y1, br.y);
        g.beginPath();
        for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) { const X = V.sx(x), Y = V.sy(y); g.moveTo(X + r, Y); g.arc(X, Y, r, 0, TAU); }
        g.fill();
      }
      // the site boundary, a surveyor's frame with coordinates
      g.setLineDash([2, 5]); g.lineWidth = 1;
      this.path([[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]]); g.stroke(); g.setLineDash([]);
      g.font = `9px ${PAL.mono}`; g.fillStyle = PAL.faint; g.textAlign = 'center';
      for (let x = B.x0; x <= B.x1; x += 400) { g.fillText(String(x), V.sx(x), V.sy(B.y0) - 6); this.path([[x, B.y0 - 14], [x, B.y0]], 0, false); g.strokeStyle = PAL.faint; g.stroke(); }
      g.textAlign = 'right';
      for (let y = B.y0 + 400; y <= B.y1; y += 400) g.fillText(String(y), V.sx(B.x0) - 6, V.sy(y) + 3);
      g.textAlign = 'left';
    }
    drawRoomFloor(m, sel) {
      const g = this.g, x0 = m.x - m.w / 2, x1 = m.x + m.w / 2, y0 = m.y - m.h / 2, y1 = m.y + m.h / 2;
      const hue = Math.floor(hash01(m.id) * 360);
      this.path([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      g.fillStyle = PAL.dark ? hsl(hue, 22, 20, 0.55) : hsl(hue, 30, 80, 0.5); g.fill();
      if (m.walls) { g.fillStyle = pattern(g, 'hatch', PAL.dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'); g.fill(); }
      // floor boards: a few lines that make it read as interior
      g.strokeStyle = PAL.dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'; g.lineWidth = 1;
      for (let y = y0 + 40; y < y1; y += 40) { this.path([[x0, y], [x1, y]], 0, false); g.stroke(); }
    }
    drawRoomWalls(m, sel) {
      const g = this.g, V = this.V, x0 = m.x - m.w / 2, x1 = m.x + m.w / 2, y0 = m.y - m.h / 2, y1 = m.y + m.h / 2, h = m.walls ? 46 : 26;
      const hue = Math.floor(hash01(m.id) * 360);
      const wallFill = PAL.dark ? hsl(hue, 18, 30, 0.35) : hsl(hue, 20, 60, 0.28);
      const edge = sel ? PAL.accent : (PAL.dark ? hsl(hue, 25, 70, 0.8) : hsl(hue, 30, 28, 0.75));
      const walls = [[[x0, y0], [x1, y0]], [[x0, y0], [x0, y1]], [[x1, y0], [x1, y1]], [[x0, y1], [x1, y1]]];
      for (const [a, b] of walls) {
        g.beginPath(); g.moveTo(V.sx(a[0]), V.sy(a[1])); g.lineTo(V.sx(b[0]), V.sy(b[1])); g.lineTo(V.sx(b[0]), V.sy(b[1], h)); g.lineTo(V.sx(a[0]), V.sy(a[1], h)); g.closePath();
        g.fillStyle = wallFill; g.fill();
      }
      g.strokeStyle = edge; g.lineWidth = sel ? 2 : (m.walls ? 2 : 1.2);
      this.path([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], h); g.stroke();
      this.path([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 0); g.stroke();
      // label: name and what the room does, in the corner
      const fx = m.fx.filter(f => f.on).map(f => W.FX[f.type].l).join('・') || '素通し';
      g.font = `600 12px ${PAL.disp}`; g.fillStyle = edge;
      g.fillText(m.name || '部屋', V.sx(x0) + 6, V.sy(y0, h) - 8);
      g.font = `9.5px ${PAL.mono}`; g.fillStyle = PAL.dim;
      g.fillText(fx, V.sx(x0) + 6 + g.measureText(m.name || '部屋').width * 1.25 + 8, V.sy(y0, h) - 8);
    }
    drawRail(r, sel) {
      const g = this.g, pts = r.pts, n = pts.length; if (n < 2) return;
      const geo = C.railGeom(r);
      // sleepers
      g.strokeStyle = sel ? PAL.accent : PAL.dim; g.lineWidth = Math.max(1, 2.2 * this.V.z);
      g.beginPath();
      const V = this.V;
      for (let s = 0; s < geo.L; s += 15) { const p = C.railPoint(r, s), nx = -Math.sin(p.ang) * 8, ny = Math.cos(p.ang) * 8; g.moveTo(V.sx(p.x - nx), V.sy(p.y - ny)); g.lineTo(V.sx(p.x + nx), V.sy(p.y + ny)); }
      g.stroke();
      // two rails
      g.strokeStyle = sel ? PAL.accent : PAL.ink; g.lineWidth = Math.max(0.8, 1.6 * V.z);
      for (const off of [-4.5, 4.5]) {
        g.beginPath();
        const segs = r.closed ? n + 1 : n;
        for (let i = 0; i < segs; i++) {
          const a = pts[(i - 1 + n) % n], b = pts[i % n], c = pts[(i + 1) % n];
          let ang;
          if (!r.closed && i === 0) ang = Math.atan2(c[1] - b[1], c[0] - b[0]);
          else if (!r.closed && i === n - 1) ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          else ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
          const x = b[0] - Math.sin(ang) * off, y = b[1] + Math.cos(ang) * off;
          i ? g.lineTo(V.sx(x), V.sy(y)) : g.moveTo(V.sx(x), V.sy(y));
        }
        g.stroke();
      }
      if (!r.closed) for (const e of [pts[0], pts[n - 1]]) { this.ellipse(e[0], e[1], 9); g.fillStyle = PAL.ground; g.fill(); g.strokeStyle = PAL.ink; g.lineWidth = 1.5; g.stroke(); }
      if (sel) for (const p of pts) { const X = V.sx(p[0]), Y = V.sy(p[1]); g.fillStyle = PAL.ground; g.strokeStyle = PAL.accent; g.lineWidth = 1.5; g.beginPath(); g.rect(X - 3.5, Y - 3.5, 7, 7); g.fill(); g.stroke(); }
    }
    drawRings(rp, Tv, sel) {
      const g = this.g;
      for (const ring of this.S.sim.rings(rp, Tv)) {
        this.ellipse(rp.x, rp.y, ring.r);
        g.strokeStyle = PAL.ink; g.globalAlpha = 0.55 * ring.a; g.lineWidth = 1 + 1.5 * ring.a; g.stroke();
        this.ellipse(rp.x, rp.y, Math.max(0, ring.r - 7)); g.globalAlpha = 0.18 * ring.a; g.lineWidth = 1; g.stroke();
        g.globalAlpha = 1;
      }
      if (sel) { this.ellipse(rp.x, rp.y, rp.reach); g.setLineDash([3, 6]); g.strokeStyle = PAL.accent; g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
    }
    drawEmblem(x, y, kind, sel) {
      const g = this.g, V = this.V, X = V.sx(x), Y = V.sy(y);
      g.lineWidth = 1.5; g.strokeStyle = sel ? PAL.accent : PAL.ink; g.fillStyle = PAL.ground;
      if (kind === 'ripple') {
        g.beginPath(); g.ellipse(X, Y, 11, 11 * V.ct, 0, 0, TAU); g.fill(); g.stroke();
        g.beginPath(); g.ellipse(X, Y, 6, 6 * V.ct, 0, 0, TAU); g.stroke();
        g.beginPath(); g.arc(X, Y, 2, 0, TAU); g.fillStyle = sel ? PAL.accent : PAL.ink; g.fill();
      } else if (kind === 'flock') {
        g.beginPath(); g.moveTo(X - 7, Y); g.lineTo(X, Y - 7); g.lineTo(X + 7, Y); g.lineTo(X, Y + 7); g.closePath(); g.fill(); g.stroke();
        g.beginPath(); g.arc(X, Y, 1.8, 0, TAU); g.fillStyle = sel ? PAL.accent : PAL.ink; g.fill();
      } else if (kind === 'sweep') {
        g.beginPath(); g.rect(X - 6, Y - 6, 12, 12); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(X - 6, Y); g.lineTo(X + 6, Y); g.moveTo(X, Y - 6); g.lineTo(X, Y + 6); g.stroke();
      }
    }
    drawSweepBase(sw, sel) {
      const g = this.g;
      this.ellipse(sw.x, sw.y, sw.r); g.setLineDash([1, 5]); g.strokeStyle = sel ? PAL.accent : PAL.dim; g.lineWidth = 1.2; g.stroke(); g.setLineDash([]);
      this.ellipse(sw.x, sw.y, sw.r * 0.5); g.strokeStyle = PAL.grid; g.stroke();
    }
    drawSweepArm(sw, Tv) {
      const g = this.g, V = this.V, a = this.S.sim.sweepAngle(sw, Tv), dir = sw.dir || 1;
      for (let i = 0; i < 14; i++) {
        const a0 = a - dir * i * 0.045, a1 = a - dir * (i + 1) * 0.045;
        g.beginPath(); g.moveTo(V.sx(sw.x), V.sy(sw.y));
        for (let k = 0; k <= 3; k++) { const aa = a0 + (a1 - a0) * k / 3; g.lineTo(V.sx(sw.x + Math.cos(aa) * sw.r), V.sy(sw.y + Math.sin(aa) * sw.r)); }
        g.closePath(); g.fillStyle = PAL.signal; g.globalAlpha = 0.16 * (1 - i / 14); g.fill();
      }
      g.globalAlpha = 1;
      g.beginPath(); g.moveTo(V.sx(sw.x), V.sy(sw.y)); g.lineTo(V.sx(sw.x + Math.cos(a) * sw.r), V.sy(sw.y + Math.sin(a) * sw.r));
      g.strokeStyle = PAL.signal; g.lineWidth = 2; g.stroke();
      this.drawEmblem(sw.x, sw.y, 'sweep', this.S.sel.has(sw.id));
    }
    drawScan(sc, Tv, sel) {
      const g = this.g, ca = Math.cos(sc.ang), sa = Math.sin(sc.ang);
      const loc = (lx, ly) => [sc.x + lx * ca - ly * sa, sc.y + lx * sa + ly * ca];
      const hw = sc.w / 2, hh = sc.h / 2;
      this.path([loc(-hw, -hh), loc(hw, -hh), loc(hw, hh), loc(-hw, hh)]);
      g.setLineDash([6, 4]); g.strokeStyle = sel ? PAL.accent : PAL.dim; g.lineWidth = 1.2; g.stroke(); g.setLineDash([]);
      // measure ticks along the time axis
      g.strokeStyle = PAL.faint; g.lineWidth = 1;
      for (let i = 0; i <= 16; i++) { const lx = -hw + sc.w * i / 16; this.path([loc(lx, -hh), loc(lx, -hh + (i % 4 ? 8 : 16))], 0, false); g.stroke(); }
      const bx = this.S.sim.scanPos(sc, Tv);
      for (let i = 0; i < 8; i++) { const lx = bx - i * 5; if (lx < -hw) break; this.path([loc(lx, -hh), loc(lx, hh)], 0, false); g.strokeStyle = PAL.signal; g.globalAlpha = 0.5 * (1 - i / 8); g.lineWidth = i ? 2 : 2.5; g.stroke(); }
      g.globalAlpha = 1;
    }
    drawThread(th, Tv, sel) {
      const g = this.g, V = this.V, sim = this.S.sim, a = sim.byId.get(th.a), b = sim.byId.get(th.b);
      if (!a || !b) return;
      const pa = sim.pose(a, Tv, false), pb = sim.pose(b, Tv, false);
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2 + Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.18;
      const pt = t => [(1 - t) * (1 - t) * pa.x + 2 * (1 - t) * t * mx + t * t * pb.x, (1 - t) * (1 - t) * pa.y + 2 * (1 - t) * t * my + t * t * pb.y];
      g.beginPath(); g.moveTo(V.sx(pa.x), V.sy(pa.y)); g.quadraticCurveTo(V.sx(mx), V.sy(my), V.sx(pb.x), V.sy(pb.y));
      g.strokeStyle = sel ? PAL.accent : PAL.dim; g.lineWidth = sel ? 2 : 1.1; g.setLineDash(th.sync ? [1, 3] : []); g.stroke(); g.setLineDash([]);
      const [x1, y1] = pt(0.62), [x2, y2] = pt(0.66), ang = Math.atan2(V.sy(y2) - V.sy(y1), V.sx(x2) - V.sx(x1));
      const X = V.sx(x2), Y = V.sy(y2);
      g.beginPath(); g.moveTo(X + Math.cos(ang) * 6, Y + Math.sin(ang) * 6); g.lineTo(X + Math.cos(ang + 2.5) * 6, Y + Math.sin(ang + 2.5) * 6); g.lineTo(X + Math.cos(ang - 2.5) * 6, Y + Math.sin(ang - 2.5) * 6); g.closePath();
      g.fillStyle = sel ? PAL.accent : PAL.dim; g.fill();
      for (const q of sim.queue) {
        if (q.th !== th.id || Tv < q.t0 || Tv > q.t) continue;
        const [x, y] = pt((Tv - q.t0) / Math.max(1e-3, q.t - q.t0));
        g.beginPath(); g.arc(V.sx(x), V.sy(y), 3.5, 0, TAU); g.fillStyle = PAL.signal; g.fill();
      }
    }

    // ---- fragments and things ----
    drawFrag(f, p, S) {
      const fl = S.flash(f.id);
      this.drawSkin(f, p, S, fl, false);
      const g = this.g, V = this.V;
      // mode marks: a satellite for loops, a reading axis for tape
      if (f.mode === 'loop') {
        const a = S.Tv * 1.7 + hash01(f.id) * TAU, rr = p.r + 8;
        g.beginPath(); g.arc(V.sx(p.x + Math.cos(a) * rr), V.sy(p.y + Math.sin(a) * rr), 2.6, 0, TAU); g.fillStyle = PAL.ink; g.fill();
        this.ellipse(p.x, p.y, rr); g.strokeStyle = PAL.faint; g.lineWidth = 0.8; g.setLineDash([1, 4]); g.stroke(); g.setLineDash([]);
      } else if (f.mode === 'tape') {
        const ca = Math.cos(p.ang), sa = Math.sin(p.ang), r = p.r;
        g.beginPath(); g.moveTo(V.sx(p.x - ca * r), V.sy(p.y - sa * r)); g.lineTo(V.sx(p.x + ca * r), V.sy(p.y + sa * r));
        g.strokeStyle = PAL.ink; g.lineWidth = 1.2; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
        const X = V.sx(p.x + ca * r), Y = V.sy(p.y + sa * r), an = Math.atan2(V.sy(p.y + sa) - V.sy(p.y), V.sx(p.x + ca) - V.sx(p.x));
        g.beginPath(); g.moveTo(X, Y); g.lineTo(X + Math.cos(an + 2.6) * 7, Y + Math.sin(an + 2.6) * 7); g.lineTo(X + Math.cos(an - 2.6) * 7, Y + Math.sin(an - 2.6) * 7); g.closePath(); g.fillStyle = PAL.ink; g.fill();
      }
      if (fl) {
        const k = fl.k, rr = p.r * (1.05 + 0.7 * (1 - k));
        this.ellipse(p.x, p.y, rr);
        g.strokeStyle = fl.silent ? PAL.faint : PAL.signal; g.globalAlpha = k; g.lineWidth = 2.5 * k + 0.5;
        if (fl.silent) g.setLineDash([2, 4]);
        g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      }
      if (S.labels || S.sel.has(f.id)) {
        const src = S.srcName(f.src);
        g.font = `9.5px ${PAL.mono}`; g.fillStyle = PAL.dim; g.textAlign = 'center';
        g.fillText(`${src} ${f.a.toFixed(2)}–${f.b.toFixed(2)}`, V.sx(p.x), V.sy(p.y + p.r) + 14);
        g.textAlign = 'left';
      }
    }
    drawSkin(o, p, S, fl, inert) {
      const g = this.g, V = this.V, sk = o.skin, cols = fragColors(sk.hue), h = sk.h || 0;
      const lit = fl && !fl.silent ? fl.k : 0;
      if (lit) { cols.fill = hsl(sk.hue, 70, PAL.dark ? 62 : 70); cols.top = hsl(sk.hue, 80, PAL.dark ? 70 : 80); }
      if (inert) { cols.fill = PAL.dark ? hsl(sk.hue, 6, 34) : hsl(sk.hue, 6, 70); cols.side = PAL.dark ? hsl(sk.hue, 6, 24) : hsl(sk.hue, 6, 56); cols.top = PAL.dark ? hsl(sk.hue, 6, 42) : hsl(sk.hue, 6, 80); cols.line = PAL.dim; }
      // shadow for anything standing
      if (h > 0 && V.tilt > 0.05) { this.ellipse(p.x + 4, p.y + 4, p.r * 0.85); g.fillStyle = PAL.dark ? 'rgba(0,0,0,.35)' : 'rgba(30,40,50,.12)'; g.fill(); }
      switch (sk.type) {
        case 'box': case 'tower': {
          const pts = place(footprint(sk), p), faces = this.prism(pts, h, cols);
          if (sk.type === 'tower') this.windows(faces, h, lit, sk);
          break;
        }
        case 'house': {
          const pts = place(footprint(sk), p); this.prism(pts, h, cols, false);
          const ridge = place([[-0.75, 0], [0.75, 0]], p), rh = h + p.r * 0.55;
          const faces = [[pts[0], pts[1], ridge[1], ridge[0], 'r'], [pts[3], pts[2], ridge[1], ridge[0], 'r'], [pts[0], pts[3], ridge[0], 'g'], [pts[1], pts[2], ridge[1], 'g']];
          faces.sort((a, b) => (a[0][1] + a[1][1]) - (b[0][1] + b[1][1]));
          for (const f of faces) {
            g.beginPath();
            if (f[4] === 'r') { g.moveTo(V.sx(f[0][0]), V.sy(f[0][1], h)); g.lineTo(V.sx(f[1][0]), V.sy(f[1][1], h)); g.lineTo(V.sx(f[2][0]), V.sy(f[2][1], rh)); g.lineTo(V.sx(f[3][0]), V.sy(f[3][1], rh)); }
            else { g.moveTo(V.sx(f[0][0]), V.sy(f[0][1], h)); g.lineTo(V.sx(f[1][0]), V.sy(f[1][1], h)); g.lineTo(V.sx(f[2][0]), V.sy(f[2][1], rh)); }
            g.closePath(); g.fillStyle = f[3] === 'g' || f[4] === 'g' ? cols.side : cols.top; g.fill(); g.strokeStyle = cols.line; g.lineWidth = 1; g.stroke();
          }
          break;
        }
        case 'pillar': this.cylinder(p.x, p.y, p.r * 0.62, h, cols); break;
        case 'tree': {
          this.cylinder(p.x, p.y, p.r * 0.13, h * 0.55, { side: PAL.dark ? '#4a3d30' : '#7a6248', top: PAL.dark ? '#5a4a3a' : '#8d7458', line: cols.line });
          const X = V.sx(p.x), Y = V.sy(p.y, h * 0.55 + p.r * 0.55);
          g.beginPath(); g.arc(X, Y, p.r * 0.8 * V.z, 0, TAU); g.fillStyle = cols.fill; g.fill();
          g.fillStyle = pattern(g, sk.tex === 'solid' ? 'dots' : sk.tex, cols.line); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
          g.strokeStyle = cols.line; g.lineWidth = 1; g.stroke();
          break;
        }
        case 'ring': {
          const V2 = this.V; g.beginPath();
          g.ellipse(V2.sx(p.x), V2.sy(p.y), p.r * V2.z, p.r * V2.z * V2.ct, 0, 0, TAU);
          g.ellipse(V2.sx(p.x), V2.sy(p.y), p.r * 0.55 * V2.z, p.r * 0.55 * V2.z * V2.ct, 0, TAU, 0, true);
          this.fillTex(sk.tex, cols.fill, cols.line); g.strokeStyle = cols.line; g.lineWidth = 1; g.stroke();
          break;
        }
        case 'cluster': {
          const n = 6 + (sk.sides || 5);
          for (let i = 0; i < n; i++) {
            const a = hash01(sk.seed + 'a' + i) * TAU + p.ang, d = Math.sqrt(hash01(sk.seed + 'd' + i)) * 0.85, rr = 0.1 + 0.12 * hash01(sk.seed + 'r' + i);
            this.ellipse(p.x + Math.cos(a) * d * p.r, p.y + Math.sin(a) * d * p.r, rr * p.r);
            g.fillStyle = i % 3 ? cols.fill : cols.line; g.fill();
          }
          break;
        }
        case 'glyph': {
          g.save(); g.translate(V.sx(p.x), V.sy(p.y)); g.scale(1, V.ct); g.rotate(p.ang);
          g.font = `700 ${Math.max(4, p.r * 1.7 * V.z)}px ${PAL.disp}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = cols.fill; g.fillText(sk.glyph || '※', 0, 0);
          g.lineWidth = 1; g.strokeStyle = cols.line; g.strokeText(sk.glyph || '※', 0, 0);
          g.restore();
          break;
        }
        case 'blob': this.smoothPath(place(footprint(sk), p)); this.fillTex(sk.tex, cols.fill, cols.line); g.strokeStyle = cols.line; g.lineWidth = 1; g.stroke(); break;
        case 'strip': {
          const pts = place(footprint(sk), p); this.path(pts); this.fillTex(sk.tex, cols.fill, cols.line); g.strokeStyle = cols.line; g.lineWidth = 1; g.stroke();
          // ticks like magnetic tape
          const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
          g.beginPath();
          for (let i = -8; i <= 8; i++) { const t = i / 9, hh = 0.32 * (0.35 + 0.65 * hash01(sk.seed + ':' + i)); const x = p.x + ca * t * p.r, y = p.y + sa * t * p.r; g.moveTo(V.sx(x + sa * hh * p.r), V.sy(y - ca * hh * p.r)); g.lineTo(V.sx(x - sa * hh * p.r), V.sy(y + ca * hh * p.r)); }
          g.strokeStyle = cols.line; g.globalAlpha = 0.6; g.stroke(); g.globalAlpha = 1;
          break;
        }
        default: { const pts = place(footprint(sk), p); this.path(pts); this.fillTex(sk.tex, cols.fill, cols.line); g.strokeStyle = cols.line; g.lineWidth = 1; g.stroke(); }
      }
    }
    windows(faces, h, lit, sk) {
      const g = this.g, V = this.V, rows = Math.max(2, Math.floor(h / 16));
      for (const f of faces) {
        const cols = 3;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const t0 = (c + 0.25) / cols, t1 = (c + 0.75) / cols, z0 = (r + 0.3) / rows * h, z1 = (r + 0.7) / rows * h;
          const ax = f.a[0] + (f.b[0] - f.a[0]) * t0, ay = f.a[1] + (f.b[1] - f.a[1]) * t0, bx = f.a[0] + (f.b[0] - f.a[0]) * t1, by = f.a[1] + (f.b[1] - f.a[1]) * t1;
          g.beginPath(); g.moveTo(V.sx(ax), V.sy(ay, z0)); g.lineTo(V.sx(bx), V.sy(by, z0)); g.lineTo(V.sx(bx), V.sy(by, z1)); g.lineTo(V.sx(ax), V.sy(ay, z1)); g.closePath();
          const on = lit && hash01(sk.seed + ':' + r + ':' + c) < 0.3 + lit * 0.7;
          g.fillStyle = on ? PAL.signal : (PAL.dark ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.45)'); g.fill();
        }
      }
    }
    drawCar(tr, c, j, S) {
      const g = this.g, sel = S.sel.has(tr.id), L = 21, Wd = 9.5, h = 14;
      const ca = Math.cos(c.ang), sa = Math.sin(c.ang);
      const pts = [[-L, -Wd], [L, -Wd], [L, Wd], [-L, Wd]].map(([lx, ly]) => [c.x + lx * ca - ly * sa, c.y + lx * sa + ly * ca]);
      const cols = PAL.dark ? { side: '#2b3540', top: sel ? PAL.accent : '#c9d2da', line: '#0d1115' } : { side: '#4b5560', top: sel ? PAL.accent : '#f1f3f4', line: '#1b1f22' };
      const faces = this.prism(pts, h, cols);
      // windows along the visible long side
      const V = this.V;
      for (const f of faces) {
        const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]); if (len < 20) continue;
        for (let k = 0; k < 5; k++) {
          const t0 = (k + 0.2) / 5, t1 = (k + 0.75) / 5;
          const ax = f.a[0] + (f.b[0] - f.a[0]) * t0, ay = f.a[1] + (f.b[1] - f.a[1]) * t0, bx = f.a[0] + (f.b[0] - f.a[0]) * t1, by = f.a[1] + (f.b[1] - f.a[1]) * t1;
          g.beginPath(); g.moveTo(V.sx(ax), V.sy(ay, 5)); g.lineTo(V.sx(bx), V.sy(by, 5)); g.lineTo(V.sx(bx), V.sy(by, 11)); g.lineTo(V.sx(ax), V.sy(ay, 11)); g.closePath();
          g.fillStyle = PAL.signal; g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1;
        }
      }
      if (j === 0) { const X = V.sx(c.x + ca * L), Y = V.sy(c.y + sa * L, 6); g.beginPath(); g.arc(X, Y, 2.4, 0, TAU); g.fillStyle = PAL.signal; g.fill(); }
    }
    drawBird(fl, q, a, j, Tv) {
      const g = this.g, V = this.V, sel = this.S.sel.has(fl.id), H = 26;
      // trail from history
      const key = fl.id + ':' + j;
      g.beginPath();
      for (let k = 0; k < 18; k++) { const p = this.S.sim.agentAt(a, Tv - k * 0.03); const X = V.sx(p.x), Y = V.sy(p.y, H); k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.strokeStyle = PAL.faint; g.lineWidth = 1; g.stroke();
      const p2 = this.S.sim.agentAt(a, Tv - 0.03), ang = Math.atan2(V.sy(q.y, H) - V.sy(p2.y, H), V.sx(q.x) - V.sx(p2.x));
      // shadow on the ground
      g.beginPath(); g.ellipse(V.sx(q.x), V.sy(q.y), 4, 4 * V.ct, 0, 0, TAU); g.fillStyle = PAL.dark ? 'rgba(0,0,0,.4)' : 'rgba(30,40,50,.15)'; g.fill();
      const X = V.sx(q.x), Y = V.sy(q.y, H), flap = Math.sin(Tv * 14 + j * 2) * 0.5;
      g.beginPath();
      g.moveTo(X + Math.cos(ang) * 7, Y + Math.sin(ang) * 7);
      g.lineTo(X + Math.cos(ang + 2.4 + flap * 0.4) * 8, Y + Math.sin(ang + 2.4 + flap * 0.4) * 8);
      g.lineTo(X + Math.cos(ang + Math.PI) * 2, Y + Math.sin(ang + Math.PI) * 2);
      g.lineTo(X + Math.cos(ang - 2.4 - flap * 0.4) * 8, Y + Math.sin(ang - 2.4 - flap * 0.4) * 8);
      g.closePath(); g.fillStyle = sel ? PAL.accent : PAL.ink; g.fill();
    }

    // ---- selection ----
    drawSelection(S) {
      const g = this.g, V = this.V, sim = S.sim;
      for (const id of S.sel) {
        const o = sim.byId.get(id); if (!o) continue;
        if (o.kind === 'frag' || o.kind === 'thing') {
          const p = o.kind === 'frag' ? sim.pose(o, S.Tv, false) : o;
          const h = o.skin.h || 0;
          this.ellipse(p.x, p.y, p.r + 6); g.strokeStyle = PAL.accent; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
          if (h > 0) { g.beginPath(); g.moveTo(V.sx(p.x), V.sy(p.y)); g.lineTo(V.sx(p.x), V.sy(p.y, h)); g.stroke(); }
          if (S.sel.size === 1) {
            const hr = S.handles(o);
            g.beginPath(); g.moveTo(V.sx(o.x), V.sy(o.y)); g.lineTo(V.sx(hr.rot.x), V.sy(hr.rot.y)); g.strokeStyle = PAL.accent; g.lineWidth = 1; g.stroke();
            g.beginPath(); g.arc(V.sx(hr.rot.x), V.sy(hr.rot.y), 5, 0, TAU); g.fillStyle = PAL.ground; g.fill(); g.stroke();
            g.beginPath(); g.rect(V.sx(hr.size.x) - 4.5, V.sy(hr.size.y) - 4.5, 9, 9); g.fillStyle = PAL.accent; g.fill();
          }
        } else if (o.kind === 'room' && S.sel.size === 1) {
          for (const c of S.handles(o).corners) { g.beginPath(); g.rect(V.sx(c.x) - 4.5, V.sy(c.y) - 4.5, 9, 9); g.fillStyle = PAL.accent; g.fill(); }
        } else if ((o.kind === 'scan') && S.sel.size === 1) {
          const hd = S.handles(o);
          for (const c of hd.corners) { g.beginPath(); g.rect(V.sx(c.x) - 4.5, V.sy(c.y) - 4.5, 9, 9); g.fillStyle = PAL.accent; g.fill(); }
        } else if (o.kind === 'sweep' && S.sel.size === 1) {
          const c = S.handles(o).arm; g.beginPath(); g.rect(V.sx(c.x) - 4.5, V.sy(c.y) - 4.5, 9, 9); g.fillStyle = PAL.accent; g.fill();
        } else if (o.kind === 'ripple' && S.sel.size === 1) {
          const c = S.handles(o).reach; g.beginPath(); g.rect(V.sx(c.x) - 4.5, V.sy(c.y) - 4.5, 9, 9); g.fillStyle = PAL.accent; g.fill();
        } else if (o.kind === 'flock' && S.sel.size === 1) {
          this.ellipse(o.x, o.y, o.leash); g.setLineDash([2, 6]); g.strokeStyle = PAL.accent; g.lineWidth = 1; g.stroke(); g.setLineDash([]);
        }
      }
    }
  }

  // small waveform painter for the library and the inspector
  function wave(canvas, peaks, opts = {}) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const n = peaks.length / 2, dur = opts.dur || 1;
    const x = t => t / dur * w;
    if (opts.region) { g.fillStyle = opts.regionFill; g.fillRect(x(opts.region[0]), 0, x(opts.region[1]) - x(opts.region[0]), h); }
    if (opts.sel) { g.fillStyle = opts.selFill; g.fillRect(x(opts.sel[0]), 0, x(opts.sel[1]) - x(opts.sel[0]), h); }
    g.fillStyle = opts.color || '#888';
    const mid = h / 2;
    for (let i = 0; i < w; i++) {
      const k = Math.floor(i / w * n), lo = peaks[k * 2], hi = peaks[k * 2 + 1];
      g.fillRect(i, mid - hi * mid * 0.95, 1, Math.max(1, (hi - lo) * mid * 0.95));
    }
    if (opts.region) { g.fillStyle = opts.edge; g.fillRect(x(opts.region[0]) - 1, 0, 2, h); g.fillRect(x(opts.region[1]) - 1, 0, 2, h); }
    if (opts.marks) { g.fillStyle = opts.markColor; for (const t of opts.marks) g.fillRect(x(t), 0, 1, h); }
    if (opts.head != null) { g.fillStyle = opts.headColor; g.fillRect(x(opts.head), 0, 1.5, h); }
  }

  return { View, Renderer, readPalette, wave, footprint, place };
})();
