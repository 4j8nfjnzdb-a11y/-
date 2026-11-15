'use strict';
// ---- built-in sample: a street with pedestrians, drawn frame by frame ------
// Not a recording: a small pseudo-3D scene so the tool can be tried without a file.
// Every walker has its own gait (cadence, stride, arm swing, lean) and one of them
// hesitates, stops and looks back. Faces are drawn with eyes, brows, nose and mouth.

const SAMPLE = (() => {
  const W = 1280, H = 720, FPS = 30, DUR = 14;
  const HOR = 212, FOC = 860, CAMH = 1.25;
  const LIGHT = [-0.62, -0.78]; // screen direction toward the light (upper left)
  const proj = (x, y, z) => [W / 2 + FOC * x / z, HOR - FOC * (y - CAMH) / z];

  const shade = (c, f) => `rgb(${clamp(c[0] * f, 0, 255) | 0},${clamp(c[1] * f, 0, 255) | 0},${clamp(c[2] * f, 0, 255) | 0})`;

  // ---- people -------------------------------------------------------------
  // path: [t, x, z] keys (linear between keys); equal positions = standing still
  const PEOPLE = [
    { name: 'approach', k: 1.0, path: [[0, 1.4, 12.5], [7.4, 0.1, 2.15], [9.4, 0.02, 2.0], [14, 4.6, 2.5]], cad: 1.0, amp: 1.0, arm: 1.0, lean: 0.05,
      top: [44, 58, 92], bot: [92, 94, 100], skin: [226, 184, 152], hair: [48, 34, 26], sleeve: 1, seed: 11 },
    { name: 'hesitate', k: 0.96, path: [[0, 4.6, 4.2], [4.4, 0.9, 4.2], [6.4, 0.85, 4.2], [14, -4.2, 4.2]], cad: 1.06, amp: 0.92, arm: 0.7, lean: 0.03,
      top: [196, 150, 52], bot: [40, 40, 46], skin: [176, 124, 92], hair: [22, 18, 16], sleeve: 1, seed: 23,
      look: [[4.9, 0], [5.3, 1.9], [5.9, 1.9], [6.3, 0]] },
    { name: 'pairA', k: 1.02, path: [[0, -6.2, 6.4], [14, 6.0, 6.4]], cad: 0.97, amp: 1.05, arm: 1.1, lean: 0.06,
      top: [232, 232, 226], bot: [56, 82, 124], skin: [214, 166, 132], hair: [60, 42, 30], sleeve: 0, seed: 37 },
    { name: 'pairB', k: 0.93, path: [[0, -5.6, 7.0], [14, 6.6, 7.0]], cad: 1.08, amp: 0.95, arm: 0.85, lean: 0.02,
      top: [92, 104, 64], bot: [28, 28, 30], skin: [140, 98, 74], hair: [16, 14, 12], sleeve: 1, seed: 41 },
    { name: 'away', k: 0.98, path: [[0, -1.5, 2.7], [14, -0.8, 10.5]], cad: 0.86, amp: 0.7, arm: 0.55, lean: 0.08,
      top: [120, 122, 128], bot: [70, 64, 58], skin: [222, 180, 146], hair: [34, 26, 22], sleeve: 1, seed: 53 },
    { name: 'far1', k: 1.0, path: [[0, 6.5, 10.5], [14, -6.5, 10.5]], cad: 1.1, amp: 1.0, arm: 1.0, lean: 0.04,
      top: [150, 52, 46], bot: [60, 60, 66], skin: [210, 162, 128], hair: [30, 24, 20], sleeve: 1, seed: 61 },
    { name: 'far2', k: 0.95, path: [[0, -7.5, 13.5], [14, 6.5, 13.5]], cad: 0.95, amp: 0.95, arm: 0.9, lean: 0.03,
      top: [70, 92, 110], bot: [150, 132, 104], skin: [190, 140, 108], hair: [40, 30, 24], sleeve: 0, seed: 71 },
    { name: 'far3', k: 1.04, path: [[0, 4.4, 16.5], [14, -5.8, 16.5]], cad: 0.9, amp: 0.85, arm: 0.8, lean: 0.05,
      top: [36, 36, 40], bot: [88, 90, 96], skin: [230, 190, 160], hair: [90, 70, 50], sleeve: 1, seed: 83 },
  ];
  const OCCLUDERS = [
    { kind: 'pole', x: -1.9, z: 5.3 },
    { kind: 'planter', x: 2.9, z: 9.6 },
  ];

  function along(path, t) { // -> {x, z, vx, vz, speed}
    if (t <= path[0][0]) return { x: path[0][1], z: path[0][2], vx: 0, vz: 0 };
    for (let i = 1; i < path.length; i++) {
      const [t1, x1, z1] = path[i], [t0, x0, z0] = path[i - 1];
      if (t <= t1) { const u = (t - t0) / (t1 - t0); return { x: lerp(x0, x1, u), z: lerp(z0, z1, u), vx: (x1 - x0) / (t1 - t0), vz: (z1 - z0) / (t1 - t0) }; }
    }
    const l = path[path.length - 1]; return { x: l[1], z: l[2], vx: 0, vz: 0 };
  }
  function keyed(keys, t) {
    if (!keys) return 0; if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const u = smooth01((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])); return lerp(keys[i - 1][1], keys[i][1], u); }
    return keys[keys.length - 1][1];
  }
  // distance walked up to t (integrated numerically once per person) and smoothed speed
  for (const p of PEOPLE) {
    const n = DUR * 60 + 1; p.dist = new Float32Array(n); p.spd = new Float32Array(n); p.dir = new Float32Array(n * 2);
    let d = 0, fx = 0, fz = -1;
    for (let i = 0; i < n; i++) {
      const t = i / 60, a = along(p.path, t), s = Math.hypot(a.vx, a.vz);
      if (s > 1e-3) { fx = a.vx / s; fz = a.vz / s; }
      p.dist[i] = d; p.spd[i] = s; p.dir[2 * i] = fx; p.dir[2 * i + 1] = fz; d += s / 60;
    }
    // ease the speed so stopping and starting take a few steps
    const sm = new Float32Array(n); let v = p.spd[0];
    for (let i = 0; i < n; i++) { v += (p.spd[i] - v) * 0.07; sm[i] = v; }
    p.spdS = sm;
    // the very first frames: start already walking
    for (let i = 0; i < 40 && i < n; i++) sm[i] = p.spd[i];
    // smooth heading so turns are not instant
    let hx = p.dir[0], hz = p.dir[1];
    for (let i = 0; i < n; i++) { hx += (p.dir[2 * i] - hx) * 0.05; hz += (p.dir[2 * i + 1] - hz) * 0.05; const l = Math.hypot(hx, hz) || 1; p.dir[2 * i] = hx / l; p.dir[2 * i + 1] = hz / l; }
    const r = rng(p.seed); p.jit = Array.from({ length: 64 }, () => r() * 2 - 1); // step-to-step irregularity
  }

  // ---- skeleton -----------------------------------------------------------
  function pose(p, t) {
    const i = clamp(Math.round(t * 60), 0, p.dist.length - 1);
    const a = along(p.path, t), k = p.k;
    const fx = p.dir[2 * i], fz = p.dir[2 * i + 1];
    const rx = fz, rz = -fx; // the walker's right
    const spd = p.spdS[i];
    const amp = clamp(spd / 1.15, 0, 1.15) * p.amp;
    const stride = 1.42 * k * (0.8 + 0.2 * p.amp);
    const steps = p.dist[i] / stride;
    const jj = p.jit[Math.floor(steps * 2) & 63] * 0.06;
    const ph = steps * Math.PI * 2 * p.cad + jj;
    const L1 = 0.45 * k, L2 = 0.44 * k;
    const leg = (phase) => {
      const th = amp * 0.42 * Math.sin(phase);
      const tk = 0.08 + amp * 0.85 * Math.pow(Math.max(0, Math.cos(phase + 0.45)), 3);
      return { th, tk, req: 0.075 * k + L1 * Math.cos(th) + L2 * Math.cos(th - tk) };
    };
    const lr = leg(ph + Math.PI), ll = leg(ph); // right / left
    const pelY = Math.min(lr.req, ll.req, 0.95 * k);
    const sway = 0.018 * k * Math.sin(ph) * amp;
    const pelRot = 0.07 * amp * Math.sin(ph);
    const lean = p.lean + 0.04 * amp;
    // local (r, y, f) -> world
    const W3 = (r, y, f) => [a.x + rx * r + fx * f, y, a.z + rz * r + fz * f];
    const J = {};
    const rot = (r, f, ang) => [r * Math.cos(ang) - f * Math.sin(ang), r * Math.sin(ang) + f * Math.cos(ang)];
    for (const [side, s, L] of [['R', 1, lr], ['L', -1, ll]]) {
      const [hr, hf] = rot(s * 0.095 * k, 0, pelRot);
      const hip = [hr + sway, pelY, hf];
      const knee = [hip[0], hip[1] - L1 * Math.cos(L.th), hip[2] + L1 * Math.sin(L.th)];
      const sa = L.th - L.tk;
      const ank = [knee[0], knee[1] - L2 * Math.cos(sa), knee[2] + L2 * Math.sin(sa)];
      const toe = [ank[0], Math.max(0.02 * k, ank[1] - 0.055 * k), ank[2] + 0.19 * k];
      J['hip' + side] = W3(...hip); J['knee' + side] = W3(...knee); J['ank' + side] = W3(...ank); J['toe' + side] = W3(...toe);
      J['flexK' + side] = L.tk;
    }
    const pel = [sway, pelY, 0];
    const neck = [sway * 0.4, pelY + 0.52 * k, lean * 0.5 * k];
    const shRot = -pelRot * 1.3;
    for (const [side, s, lph] of [['R', 1, ph + Math.PI], ['L', -1, ph]]) {
      const [sr, sf] = rot(s * 0.185 * k, 0, shRot);
      const sh = [neck[0] + sr, neck[1] - 0.03 * k, neck[2] + sf];
      const ts = -amp * 0.36 * p.arm * Math.sin(lph);
      const te = 0.22 + amp * 0.28 * p.arm * (0.5 + 0.5 * Math.sin(lph + 0.3));
      const el = [sh[0] + s * 0.025 * k, sh[1] - 0.29 * k * Math.cos(ts), sh[2] + 0.29 * k * Math.sin(ts)];
      const wr = [el[0] + s * 0.01 * k, el[1] - 0.26 * k * Math.cos(ts + te), el[2] + 0.26 * k * Math.sin(ts + te)];
      J['sh' + side] = W3(...sh); J['el' + side] = W3(...el); J['wr' + side] = W3(...wr); J['flexE' + side] = te;
    }
    J.pel = W3(...pel); J.neck = W3(...neck);
    J.head = W3(neck[0], neck[1] + 0.165 * k, neck[2] + 0.02 * k);
    // facing relative to the camera ray (0 = toward the camera)
    const ray = Math.atan2(a.x, a.z);
    const bodyYaw = Math.atan2(fx, -fz) + ray; // walker heading vs. view direction
    const headYaw = bodyYaw + keyed(p.look, t) * (fx >= 0 ? 1 : -1);
    J.bodyYaw = bodyYaw; J.headYaw = headYaw; J.z = a.z;
    return J;
  }

  // ---- drawing --------------------------------------------------------------
  function capsule(ctx, A, B, wM, col, z) {
    const [ax, ay] = proj(...A), [bx, by] = proj(...B);
    const w = Math.max(1, wM * FOC / z);
    let dx = bx - ax, dy = by - ay; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    let nx = -dy, ny = dx; if (nx * LIGHT[0] + ny * LIGHT[1] < 0) { nx = -nx; ny = -ny; }
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const g = ctx.createLinearGradient(mx + nx * w / 2, my + ny * w / 2, mx - nx * w / 2, my - ny * w / 2);
    g.addColorStop(0, shade(col, 1.18)); g.addColorStop(0.4, shade(col, 1.0)); g.addColorStop(1, shade(col, 0.58));
    ctx.strokeStyle = g; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    return { ax, ay, bx, by, w, nx, ny, dx, dy };
  }
  function folds(ctx, s, at, n, amount, col) { // short dark creases across a limb near `at` (0..1 along it)
    if (amount < 0.05 || s.w < 3) return;
    ctx.strokeStyle = shade(col, 0.5); ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const u = at + (i - (n - 1) / 2) * 0.07;
      const cx = lerp(s.ax, s.bx, u), cy = lerp(s.ay, s.by, u);
      ctx.globalAlpha = clamp(amount, 0, 1) * 0.55;
      ctx.lineWidth = Math.max(0.6, s.w * 0.07);
      ctx.beginPath();
      ctx.moveTo(cx + s.nx * s.w * 0.42, cy + s.ny * s.w * 0.42);
      ctx.quadraticCurveTo(cx + s.dx * s.w * 0.18, cy + s.dy * s.w * 0.18, cx - s.nx * s.w * 0.3, cy - s.ny * s.w * 0.3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function torso(ctx, J, p) {
    const z = (J.pel[2] + J.neck[2]) / 2, k = p.k;
    const [px, py] = proj(...J.pel), [nx, ny] = proj(...J.neck);
    const c = Math.abs(Math.cos(J.bodyYaw)), s = Math.abs(Math.sin(J.bodyYaw));
    const half = (rr, ff) => Math.sqrt((rr * c) ** 2 + (ff * s) ** 2) * k * FOC / z;
    const wS = half(0.205, 0.12), wW = half(0.16, 0.11), wH = half(0.175, 0.12);
    let dx = nx - px, dy = ny - py; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const ox = -dy, oy = dx;
    const at = (u, w) => [lerp(px, nx, u), lerp(py, ny, u), w];
    const rows = [at(-0.04, wH), at(0.35, wW), at(0.82, wS), at(1.0, wS * 0.78)];
    ctx.beginPath();
    rows.forEach(([x, y, w], i) => (i ? ctx.lineTo(x + ox * w, y + oy * w) : ctx.moveTo(x + ox * w, y + oy * w)));
    for (let i = rows.length - 1; i >= 0; i--) { const [x, y, w] = rows[i]; ctx.lineTo(x - ox * w, y - oy * w); }
    ctx.closePath();
    let lx = ox, ly = oy; if (lx * LIGHT[0] + ly * LIGHT[1] < 0) { lx = -lx; ly = -ly; }
    const mx = (px + nx) / 2, my = (py + ny) / 2;
    const g = ctx.createLinearGradient(mx + lx * wS, my + ly * wS, mx - lx * wS, my - ly * wS);
    g.addColorStop(0, shade(p.top, 1.15)); g.addColorStop(0.45, shade(p.top, 0.98)); g.addColorStop(1, shade(p.top, 0.55));
    ctx.fillStyle = g; ctx.fill();
    // creases from the chest toward the waist, shifting with the twist
    ctx.save(); ctx.clip();
    const tw = Math.sin(J.bodyYaw * 2) * 0.2;
    ctx.strokeStyle = shade(p.top, 0.6); ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const u = (i - 1.5) * 0.32 + tw;
      ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(0.6, wS * 0.06);
      const [x0, y0] = at(0.75, 0), [x1, y1] = at(0.22, 0);
      ctx.beginPath(); ctx.moveTo(x0 + ox * wS * u, y0 + oy * wS * u);
      ctx.quadraticCurveTo(x0 * 0.5 + x1 * 0.5 + ox * wS * (u * 0.5 + 0.12), y0 * 0.5 + y1 * 0.5 + oy * wS * (u * 0.5 + 0.12), x1 + ox * wW * u * 0.8, y1 + oy * wW * u * 0.8);
      ctx.stroke();
    }
    // hem line
    ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(0.8, wW * 0.08);
    const [hx, hy] = at(0.02, 0); ctx.beginPath(); ctx.moveTo(hx + ox * wH * 1.1, hy + oy * wH * 1.1); ctx.lineTo(hx - ox * wH * 1.1, hy - oy * wH * 1.1); ctx.stroke();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function head(ctx, J, p) {
    const z = J.head[2], k = p.k;
    const [cx, cy] = proj(...J.head);
    const rw = 0.098 * k * FOC / z, rh = 0.122 * k * FOC / z;
    const b = J.headYaw, cb = Math.cos(b), sb = Math.sin(b);
    // neck
    const [nx, ny] = proj(...J.neck);
    ctx.strokeStyle = shade(p.skin, 0.86); ctx.lineWidth = rw * 0.95; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(nx, ny + rh * 0.15); ctx.lineTo(cx, cy + rh * 0.5); ctx.stroke();
    // skin
    const g = ctx.createRadialGradient(cx - rw * 0.35, cy - rh * 0.3, rw * 0.1, cx, cy, rh * 1.15);
    g.addColorStop(0, shade(p.skin, 1.1)); g.addColorStop(0.55, shade(p.skin, 0.98)); g.addColorStop(1, shade(p.skin, 0.68));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
    // ears
    for (const u of [Math.PI / 2, -Math.PI / 2]) {
      const c = Math.cos(b + u); if (c < -0.25 || c > 0.6) continue;
      const ex = cx + Math.sin(b + u) * rw * 0.97;
      ctx.fillStyle = shade(p.skin, 0.85); ctx.beginPath(); ctx.ellipse(ex, cy + rh * 0.02, rw * 0.13, rh * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    // features
    const vis = (u) => Math.cos(b + u);
    const X = (u, f = 0.93) => cx + Math.sin(b + u) * rw * f;
    if (cb > -0.1) {
      for (const u of [0.42, -0.42]) {
        const c = vis(u); if (c < 0.2) continue;
        const ex = X(u), ey = cy - rh * 0.04, ew = rw * 0.24 * c;
        ctx.fillStyle = shade(p.skin, 0.72); ctx.beginPath(); ctx.ellipse(ex, ey - rh * 0.015, ew * 0.75, rh * 0.075, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ece8e2'; ctx.beginPath(); ctx.ellipse(ex, ey, ew * 0.55, rh * 0.042, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a1d16'; ctx.beginPath(); ctx.ellipse(ex + sb * ew * 0.12, ey, Math.max(0.6, rh * 0.036 * Math.min(1, c * 1.3)), rh * 0.038, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#2b1f18'; ctx.lineWidth = Math.max(0.6, rh * 0.018); ctx.beginPath(); ctx.ellipse(ex, ey + rh * 0.006, ew * 0.58, rh * 0.046, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
        // brow
        ctx.strokeStyle = shade(p.hair, 1.1); ctx.lineWidth = Math.max(0.7, rh * 0.04);
        ctx.beginPath(); ctx.ellipse(ex, cy - rh * 0.12, ew * 0.7, rh * 0.07, 0, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      }
      if (vis(0) > 0.1) {
        const c = vis(0), nxp = X(0, 0.98);
        // nose: side shadow, tip, nostrils
        ctx.strokeStyle = shade(p.skin, 0.72); ctx.lineWidth = Math.max(0.6, rw * 0.06); ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.moveTo(nxp + rw * 0.05, cy - rh * 0.02); ctx.quadraticCurveTo(nxp + rw * 0.1, cy + rh * 0.12, nxp + rw * 0.04, cy + rh * 0.2); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = shade(p.skin, 0.45);
        for (const u of [0.13, -0.13]) { if (vis(u) < 0.2) continue; ctx.beginPath(); ctx.ellipse(X(u, 0.96), cy + rh * 0.215, rw * 0.045 * c, rh * 0.022, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = shade(p.skin, 1.12); ctx.beginPath(); ctx.ellipse(nxp - rw * 0.02, cy + rh * 0.12, rw * 0.05, rh * 0.04, 0, 0, Math.PI * 2); ctx.fill();
        // mouth
        const mw = rw * 0.3 * c;
        ctx.fillStyle = shade([176, 92, 84], p.skin[0] / 220);
        ctx.beginPath(); ctx.ellipse(X(0, 0.95), cy + rh * 0.43, mw, rh * 0.048, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#3a1c18'; ctx.lineWidth = Math.max(0.6, rh * 0.017);
        ctx.beginPath(); ctx.moveTo(X(0, 0.95) - mw * 0.95, cy + rh * 0.43); ctx.quadraticCurveTo(X(0, 0.95), cy + rh * 0.45, X(0, 0.95) + mw * 0.95, cy + rh * 0.43); ctx.stroke();
      }
      if (Math.abs(sb) > 0.55 && cb > -0.3) { // profile: the nose stands out of the outline
        const sx = cx + Math.sign(sb) * rw * 0.96;
        ctx.fillStyle = shade(p.skin, 0.95);
        ctx.beginPath(); ctx.moveTo(sx, cy - rh * 0.05); ctx.lineTo(sx + Math.sign(sb) * rw * 0.2 * Math.abs(sb), cy + rh * 0.17); ctx.lineTo(sx, cy + rh * 0.22); ctx.fill();
      }
    }
    // hair: the head minus the face region; whole head when seen from behind
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, cy - rh * 0.02, rw * 1.05, rh * 1.04, 0, 0, Math.PI * 2);
    const fv = clamp((cb + 0.2) / 1.2, 0, 1);
    if (fv > 0.01) {
      const fx = cx + sb * rw * 0.32, frx = rw * (0.25 + 0.6 * fv) * (0.55 + 0.45 * Math.abs(cb)), fry = rh * 0.8;
      ctx.ellipse(fx, cy + rh * 0.2, frx, fry, 0, 0, Math.PI * 2);
    }
    const hg = ctx.createLinearGradient(cx - rw, cy - rh, cx + rw, cy + rh);
    hg.addColorStop(0, shade(p.hair, 1.6)); hg.addColorStop(0.5, shade(p.hair, 1.0)); hg.addColorStop(1, shade(p.hair, 0.7));
    ctx.fillStyle = hg; ctx.fill('evenodd');
    ctx.restore();
  }
  function drawPerson(ctx, p, t) {
    const J = pose(p, t), z = J.z, k = p.k;
    const [gx, gy] = proj((J.ankR[0] + J.ankL[0]) / 2, 0, (J.ankR[2] + J.ankL[2]) / 2);
    // soft cast shadow toward the right and back
    const sw = 0.5 * FOC / z, sh = 0.12 * FOC / z;
    ctx.save(); ctx.translate(gx + sw * 0.55, gy - sh * 0.2); ctx.scale(1, sh / sw);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, sw); sg.addColorStop(0, 'rgba(20,22,26,0.26)'); sg.addColorStop(1, 'rgba(20,22,26,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, sw, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // parts back to front
    const parts = [];
    for (const s of ['R', 'L']) {
      parts.push({ z: (J['hip' + s][2] + J['ank' + s][2]) / 2 + 0.001, f: () => {
        const th = capsule(ctx, J['hip' + s], J['knee' + s], 0.15 * k, p.bot, z);
        const sn = capsule(ctx, J['knee' + s], J['ank' + s], 0.115 * k, p.bot, z);
        folds(ctx, th, 0.88, 3, J['flexK' + s] * 1.2, p.bot); folds(ctx, sn, 0.1, 2, J['flexK' + s], p.bot);
        capsule(ctx, J['ank' + s], J['toe' + s], 0.085 * k, [34, 32, 32], z);
      } });
      parts.push({ z: (J['sh' + s][2] + J['wr' + s][2]) / 2, f: () => {
        const ua = capsule(ctx, J['sh' + s], J['el' + s], 0.1 * k, p.top, z);
        const fa = capsule(ctx, J['el' + s], J['wr' + s], 0.082 * k, p.sleeve ? p.top : p.skin, z);
        folds(ctx, ua, 0.9, 2, J['flexE' + s] * 1.4, p.top);
        const [wx, wy] = proj(...J['wr' + s]);
        ctx.fillStyle = shade(p.skin, 0.9); ctx.beginPath(); ctx.arc(wx, wy, 0.045 * k * FOC / z, 0, Math.PI * 2); ctx.fill();
      } });
    }
    parts.push({ z: J.pel[2], f: () => torso(ctx, J, p) });
    parts.push({ z: J.head[2] - 0.01, f: () => head(ctx, J, p) });
    parts.sort((a, b) => b.z - a.z).forEach((q) => q.f());
  }
  function drawOccluder(ctx, o) {
    if (o.kind === 'pole') {
      const [x0, y0] = proj(o.x, 0, o.z), [, y1] = proj(o.x, 4.6, o.z), w = 0.13 * FOC / o.z;
      const g = ctx.createLinearGradient(x0 - w / 2, 0, x0 + w / 2, 0); g.addColorStop(0, '#6f757b'); g.addColorStop(0.35, '#4a4f55'); g.addColorStop(1, '#25282c');
      ctx.fillStyle = g; ctx.fillRect(x0 - w / 2, y1, w, y0 - y1);
      ctx.fillStyle = '#2b2f33'; ctx.fillRect(x0 - w * 0.9, y0 - w * 0.6, w * 1.8, w * 0.6);
    } else {
      const [x0, y0] = proj(o.x - 0.9, 0, o.z), [x1, y1] = proj(o.x + 0.9, 0.62, o.z);
      ctx.fillStyle = '#7d7a72'; ctx.fillRect(x0, y1, x1 - x0, y0 - y1);
      ctx.fillStyle = '#5f5c55'; ctx.fillRect(x0, y1, x1 - x0, (y0 - y1) * 0.12);
      const r = rng(5);
      for (let i = 0; i < 60; i++) { const bx = lerp(x0, x1, r()), by = y1 - r() * (y0 - y1) * 0.9, br = (0.12 + r() * 0.18) * FOC / o.z; ctx.fillStyle = `rgb(${50 + r() * 30 | 0},${80 + r() * 40 | 0},${48 + r() * 24 | 0})`; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // ---- static backdrop (drawn once) ---------------------------------------
  const backdrop = makeCanvas(W, H);
  (function drawBackdrop() {
    const ctx = backdrop.getContext('2d'), r = rng(7);
    const zF = 26, [, yBase] = proj(0, 0, zF);
    ctx.fillStyle = '#a9aaa5'; ctx.fillRect(0, 0, W, yBase);
    for (let i = 0; i < 2200; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,40,40'},${r() * 0.05})`; ctx.fillRect(r() * W, r() * yBase, 1 + r() * 3, 1 + r() * 3); }
    // upper floors: windows
    for (let fl = 0; fl < 5; fl++) {
      const yb = 4.0 + fl * 3.1;
      for (let x = -16; x < 16; x += 2.6) {
        const [ax, ay] = proj(x + 0.5, yb + 2.0, zF), [bx, by] = proj(x + 2.0, yb, zF);
        if (by < 0) continue;
        ctx.fillStyle = '#5f676c'; ctx.fillRect(ax - 2, ay - 2, bx - ax + 4, by - ay + 4);
        const g = ctx.createLinearGradient(ax, ay, bx, by); g.addColorStop(0, '#5b7380'); g.addColorStop(0.6, '#33424b'); g.addColorStop(1, '#27323a');
        ctx.fillStyle = g; ctx.fillRect(ax, ay, bx - ax, by - ay);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(ax, ay, (bx - ax) * 0.35, by - ay);
      }
      const [, ly] = proj(0, yb - 0.25, zF); ctx.fillStyle = '#8f908b'; ctx.fillRect(0, ly, W, 3);
    }
    // ground floor: shop fronts
    const [, gfTop] = proj(0, 3.4, zF);
    ctx.fillStyle = '#4c5156'; ctx.fillRect(0, gfTop, W, yBase - gfTop);
    for (let x = -16; x < 16; x += 4.2) {
      const [ax, ay] = proj(x + 0.35, 3.0, zF), [bx, by] = proj(x + 3.85, 0.05, zF);
      const g = ctx.createLinearGradient(0, ay, 0, by); g.addColorStop(0, '#2d3a40'); g.addColorStop(0.5, '#44545a'); g.addColorStop(1, '#232c31');
      ctx.fillStyle = g; ctx.fillRect(ax, ay, bx - ax, by - ay);
      ctx.fillStyle = 'rgba(210,220,225,0.12)';
      ctx.beginPath(); ctx.moveTo(ax + (bx - ax) * 0.1, ay); ctx.lineTo(ax + (bx - ax) * 0.3, ay); ctx.lineTo(ax + (bx - ax) * 0.12, by); ctx.lineTo(ax, by); ctx.fill();
      const [sx, sy] = proj(x + 0.9, 3.25, zF), [tx, ty] = proj(x + 3.3, 3.05, zF);
      ctx.fillStyle = ['#38645c', '#6b4a3a', '#3d4f72', '#6a6a40'][Math.abs(Math.round(x)) % 4]; ctx.fillRect(sx, sy, tx - sx, ty - sy);
    }
    // pavement in perspective
    const g = ctx.createLinearGradient(0, yBase, 0, H); g.addColorStop(0, '#8e8d88'); g.addColorStop(1, '#b4b2ab');
    ctx.fillStyle = g; ctx.fillRect(0, yBase, W, H - yBase);
    ctx.strokeStyle = 'rgba(60,60,58,0.28)'; ctx.lineWidth = 1;
    for (let z = 1.2; z < zF; z += 0.6) { const [, y] = proj(0, 0, z); ctx.globalAlpha = clamp(1.4 - z / 20, 0.15, 1); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (let x = -30; x <= 30; x += 0.6) { const [ax, ay] = proj(x, 0, zF), [bx, by] = proj(x, 0, 1.2); ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 9000; i++) { const y = yBase + Math.pow(r(), 0.7) * (H - yBase); ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '30,30,30'},${r() * 0.07})`; ctx.fillRect(r() * W, y, 1 + r() * 2, 1); }
    ctx.fillStyle = 'rgba(40,40,40,0.25)'; ctx.fillRect(0, yBase - 1, W, 3);
  })();
  // grain tiles: the sample looks like it came from a camera, so the face filter has real grain to match
  const grain = Array.from({ length: 6 }, (_, n) => {
    const c = makeCanvas(256, 256), x = c.getContext('2d'), im = x.createImageData(256, 256), r = rng(100 + n);
    for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (r() + r() + r() - 1.5) * 40; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    x.putImageData(im, 0, 0); return c;
  });

  const canvas = makeCanvas(W, H), ctx = canvas.getContext('2d');
  const plate = makeCanvas(W, H);
  (function () { const c = plate.getContext('2d'); c.drawImage(backdrop, 0, 0); OCCLUDERS.slice().sort((a, b) => b.z - a.z).forEach((o) => drawOccluder(c, o)); })();

  function render(t) {
    t = ((t % DUR) + DUR) % DUR;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(backdrop, 0, 0);
    const items = PEOPLE.map((p) => ({ z: along(p.path, t).z, f: () => drawPerson(ctx, p, t) }))
      .concat(OCCLUDERS.map((o) => ({ z: o.z, f: () => drawOccluder(ctx, o) })));
    items.sort((a, b) => b.z - a.z).forEach((q) => q.f());
    const gi = Math.floor(t * FPS) % grain.length;
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.32;
    const pat = ctx.createPattern(grain[gi], 'repeat'); const off = (Math.floor(t * FPS) * 97) % 256;
    ctx.save(); ctx.translate(-off, -((off * 3) % 256)); ctx.fillStyle = pat; ctx.fillRect(off, (off * 3) % 256, W, H); ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    return canvas;
  }

  // ---- sample felt: tileable fibres on an off-white wool ground ------------
  function felt(size = 512) {
    const c = makeCanvas(size, size), x = c.getContext('2d'), r = rng(2024);
    x.fillStyle = 'rgb(128,142,158)'; x.fillRect(0, 0, size, size);
    // low-frequency mottling (clumps of wool)
    for (let i = 0; i < 260; i++) {
      const cx = r() * size, cy = r() * size, rad = 10 + r() * 46, dark = r() < 0.5;
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
        g.addColorStop(0, dark ? 'rgba(70,82,98,0.14)' : 'rgba(200,210,222,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
      }
    }
    // fibres
    x.lineCap = 'round';
    for (let i = 0; i < 14000; i++) {
      const cx = r() * size, cy = r() * size, a = r() * Math.PI * 2, len = 3 + r() * 13, bend = (r() - 0.5) * 0.9;
      const v = r(), col = v < 0.45 ? `rgba(62,74,90,${0.14 + r() * 0.18})` : `rgba(206,216,228,${0.14 + r() * 0.22})`;
      x.strokeStyle = col; x.lineWidth = 0.5 + r() * 0.9;
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        const sx = cx + ox, sy = cy + oy; if (sx < -30 || sy < -30 || sx > size + 30 || sy > size + 30) continue;
        x.beginPath(); x.moveTo(sx, sy);
        x.quadraticCurveTo(sx + Math.cos(a + bend) * len * 0.5, sy + Math.sin(a + bend) * len * 0.5, sx + Math.cos(a) * len, sy + Math.sin(a) * len); x.stroke();
      }
    }
    // a few pills
    for (let i = 0; i < 160; i++) { const cx = r() * size, cy = r() * size, rad = 0.8 + r() * 1.8; x.fillStyle = r() < 0.5 ? 'rgba(66,78,92,0.35)' : 'rgba(214,222,232,0.45)'; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill(); }
    return c;
  }

  return { W, H, FPS, DUR, render, plate, felt, frames: Math.round(DUR * FPS) };
})();
