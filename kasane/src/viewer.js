// Kasane — the viewer: the sheet on the mat, and everything done to it by hand. Layers are picked up and
// moved, turned and stretched where they lie; they can be torn in two along a line drawn across them,
// pinned and pulled, squeezed into a wad; and with ● armed, whatever the hand does is written down as motion.
'use strict';
(() => {
  const U = KS.U, M = KS.M, S = KS.S, G = KS.G, R = KS.R;
  const V = KS.V = { ok: false, pen: null, exportMode: null, hover: null };
  let stage, glc, ov, o2, cssW = 2, cssH = 2;
  let drag = null;
  const ptrs = new Map();
  const SK = { on: false, props: [], t0: 0 };

  V.init = () => {
    stage = document.getElementById('stage'); glc = document.getElementById('gl'); ov = document.getElementById('ov'); o2 = ov.getContext('2d');
    V.ok = G.init(glc);
    if (!V.ok) { document.getElementById('fail').hidden = false; return false; }
    G.onRestore = () => { R.reset(); KS.touch('render'); };
    new ResizeObserver(() => { V.resize(); }).observe(stage);
    ov.addEventListener('pointerdown', down); ov.addEventListener('pointermove', move);
    ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    ov.addEventListener('dblclick', dbl);
    ov.addEventListener('wheel', wheel, { passive: false });
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    V.resize();
    return true;
  };
  V.resize = () => {
    if (V.exportMode) return;
    const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = Math.max(2, r.width); cssH = Math.max(2, r.height); S.view.dpr = dpr;
    for (const c of [glc, ov]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
    if (S.view.fit) V.fit(); else KS.emit('view');
  };
  V.fit = () => {
    const comp = KS.comp(); if (!comp) return;
    const m = cssW < 500 ? 12 : 30, z = Math.min((cssW - 2 * m) / comp.w, (cssH - 2 * m) / comp.h);
    S.view.zoom = Math.max(0.02, z); S.view.panX = (cssW - comp.w * S.view.zoom) / 2; S.view.panY = (cssH - comp.h * S.view.zoom) / 2; S.view.fit = true;
    KS.emit('view');
  };
  V.zoomAt = (k, sx = cssW / 2, sy = cssH / 2) => {
    const v = S.view, z = U.clamp(v.zoom * k, 0.02, 32), c = V.toComp(sx, sy);
    v.zoom = z; v.panX = sx - c[0] * z; v.panY = sy - c[1] * z; v.fit = false;
    KS.emit('view');
  };
  V.zoomTo = (z) => { if (z === 'fit') return V.fit(); V.zoomAt(z / S.view.zoom); };
  V.toScreen = (x, y) => [S.view.panX + x * S.view.zoom, S.view.panY + y * S.view.zoom];
  V.toComp = (sx, sy) => [(sx - S.view.panX) / S.view.zoom, (sy - S.view.panY) / S.view.zoom];
  const autoRes = () => { const z = S.view.zoom * S.view.dpr; return z > 0.76 ? 1 : z > 0.38 ? 0.5 : 0.25; };
  V.res = () => S.view.res || autoRes();

  V.render = () => {
    if (!V.ok || G.lost || V.exportMode) return;
    const comp = KS.comp(); if (!comp) return;
    let rt;
    try { rt = R.frame(S.project, comp, S.t, { res: V.res(), mb: S.view.mb, playing: S.playing }); }
    catch (e) { console.error(e); V.note('描画でエラーが起きました: ' + e.message); return; }
    R.present(rt, comp, S.view); G.release(rt); G.sweep(); KS.Media.endFrame();
    if (R.more) KS.touch('render');
  };
  V.exportBegin = (w, h) => { V.exportMode = { w: glc.width, h: glc.height }; glc.width = w; glc.height = h; glc.style.objectFit = 'contain'; o2.setTransform(1, 0, 0, 1, 0, 0); o2.clearRect(0, 0, ov.width, ov.height); };
  V.exportEnd = () => { if (!V.exportMode) return; glc.style.objectFit = ''; V.exportMode = null; V.resize(); KS.touch('render'); };
  let noteT = 0;
  V.note = (html, ms = 3200) => { const n = document.getElementById('note'); n.innerHTML = html; n.hidden = false; clearTimeout(noteT); if (ms) noteT = setTimeout(() => { n.hidden = true; }, ms); };

  // ---------------------------------------------------------------- geometry of a layer on screen
  const geom = (frame, L) => {
    const r = R.rectOf(L), W = frame.world(L), P = (x, y) => { const c = U.mApply(W, x, y); return V.toScreen(c[0], c[1]); };
    const a = L.tr ? frame.val(L, 'tr.a') : [0, 0];
    const c = [P(r.x, r.y), P(r.x + r.w, r.y), P(r.x + r.w, r.y + r.h), P(r.x, r.y + r.h)];
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const m = [mid(c[0], c[1]), mid(c[1], c[2]), mid(c[2], c[3]), mid(c[3], c[0])];
    const up = [c[0][0] - c[3][0], c[0][1] - c[3][1]], ul = Math.hypot(up[0], up[1]) || 1;
    return { r, W, c, m, an: P(a[0], a[1]), rot: [m[0][0] + up[0] / ul * 24, m[0][1] + up[1] / ul * 24], P };
  };
  const inQuad = (c, x, y) => { let s = 0; for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4], cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (cr === 0) continue; if (s === 0) s = Math.sign(cr); else if (Math.sign(cr) !== s) return false; } return true; };
  const pickable = (frame, comp, L) => L.tr && L.type !== 'audio' && !L.lock && frame.active(L) && (comp.layers.some((l) => l.solo) ? L.solo : L.vis);
  // is this point of the layer (in its own coordinates) still there after its masks and tears?
  const covered = (L, x, y) => {
    const mks = L.masks || []; if (!mks.length) return true;
    const plain = mks.filter((m) => !m.torn && m.pts.length > 2);
    let cov = true;
    if (plain.length) {
      cov = plain[0].mode !== 'add';
      for (const m of plain) { KS.Raster.maskPath(o2, m); o2.save(); o2.setTransform(1, 0, 0, 1, 0, 0); const inP = o2.isPointInPath(x, y) !== !!m.inv; o2.restore(); cov = m.mode === 'add' ? cov || inP : m.mode === 'subtract' ? cov && !inP : cov && inP; }
      o2.beginPath();
    }
    for (const m of mks) {
      if (!cov || !m.torn || m.torn.line.length < 2) continue;
      const ln = m.torn.line; let best = Infinity, side = 0;
      for (let i = 0; i + 1 < ln.length; i++) {
        const a = ln[i], b = ln[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
        let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2; if (i > 0) t = Math.max(0, t); if (i + 2 < ln.length) t = Math.min(1, t);   // the two end stretches run on to the edge
        const d = Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
        if (d < best) { best = d; side = dx * (y - a[1]) - dy * (x - a[0]); }
      }
      cov = side * m.torn.side > 0;
    }
    return cov;
  };
  V.pick = (sx, sy) => {
    const comp = KS.comp(), frame = KS.frameNow(), c = V.toComp(sx, sy);
    for (const L of comp.layers) {
      if (!pickable(frame, comp, L) || L.type === 'adjust') continue;
      const g = geom(frame, L); if (!inQuad(g.c, sx, sy)) continue;
      const lp = U.mApply(U.mInv(g.W), c[0], c[1]);
      if (covered(L, lp[0], lp[1])) return L;
    }
    return null;
  };
  const near = (p, x, y, rad) => Math.hypot(p[0] - x, p[1] - y) <= rad;
  const pinsFx = (L) => (L && L.fx ? L.fx.find((f) => f.type === 'pins' && f.on) : null);
  const editMasks = (L) => (L ? (L.masks || []).filter((m) => !m.torn) : []);

  // ---------------------------------------------------------------- overlay
  V.overlay = () => {
    const dpr = S.view.dpr; o2.setTransform(dpr, 0, 0, dpr, 0, 0); o2.clearRect(0, 0, cssW, cssH);
    if (V.exportMode) return;
    const comp = KS.comp(); if (!comp) return;
    const frame = KS.frameNow(), cs = getComputedStyle(document.documentElement);
    const blade = cs.getPropertyValue('--blade').trim() || '#6fd0c5', tape = cs.getPropertyValue('--tape').trim() || '#e9c84a', tie = cs.getPropertyValue('--tie').trim() || '#c9a2f2';
    const z = S.view.zoom, a = V.toScreen(0, 0);
    o2.lineWidth = 1; o2.strokeStyle = 'rgba(232,236,230,.22)'; o2.strokeRect(Math.round(a[0]) - 0.5, Math.round(a[1]) - 0.5, Math.round(comp.w * z) + 1, Math.round(comp.h * z) + 1);
    if (S.view.guides) {
      o2.strokeStyle = 'rgba(232,236,230,.28)'; o2.setLineDash([4, 4]);
      o2.strokeRect(a[0] + comp.w * z * 0.05, a[1] + comp.h * z * 0.05, comp.w * z * 0.9, comp.h * z * 0.9);
      o2.beginPath(); o2.moveTo(a[0] + comp.w * z / 2, a[1]); o2.lineTo(a[0] + comp.w * z / 2, a[1] + comp.h * z); o2.moveTo(a[0], a[1] + comp.h * z / 2); o2.lineTo(a[0] + comp.w * z, a[1] + comp.h * z / 2); o2.stroke(); o2.setLineDash([]);
    }
    for (const L of comp.layers) {                 // null objects have no pixels; show where they are
      if (L.type !== 'null' || !L.vis || !frame.active(L)) continue;
      const g = geom(frame, L); o2.strokeStyle = 'rgba(231,127,179,.8)'; o2.setLineDash([3, 3]); o2.beginPath(); g.c.forEach((p, i) => (i ? o2.lineTo(p[0], p[1]) : o2.moveTo(p[0], p[1]))); o2.closePath(); o2.stroke(); o2.setLineDash([]);
    }
    const sel = KS.selLayers().filter((L) => L.tr), prim = sel[0];
    for (const L of sel) {
      const g = geom(frame, L);
      o2.strokeStyle = blade; o2.lineWidth = 1.25; o2.beginPath(); g.c.forEach((p, i) => (i ? o2.lineTo(p[0], p[1]) : o2.moveTo(p[0], p[1]))); o2.closePath(); o2.stroke();
      if (L !== prim || S.tool !== 'select') continue;
      // motion path
      const pp = L.tr.p;
      if (pp.k && pp.k.length > 1 && !pp.x) {
        const t0 = pp.k[0].t, t1 = pp.k[pp.k.length - 1].t, n = Math.min(240, Math.max(2, Math.round((t1 - t0) * comp.fps))), PW = frame.parentWorld(L);
        o2.strokeStyle = 'rgba(233,200,74,.75)'; o2.lineWidth = 1; o2.setLineDash([2, 3]); o2.beginPath();
        for (let i = 0; i <= n; i++) { const v = M.evalKeys(pp, t0 + (t1 - t0) * i / n), c = U.mApply(PW, v[0], v[1]), s = V.toScreen(c[0], c[1]); if (i) o2.lineTo(s[0], s[1]); else o2.moveTo(s[0], s[1]); }
        o2.stroke(); o2.setLineDash([]);
        for (const k of pp.k) { const c = U.mApply(PW, k.v[0], k.v[1]), s = V.toScreen(c[0], c[1]); o2.fillStyle = S.sel.keys.includes(k.id) ? '#fff' : tape; o2.fillRect(s[0] - 3, s[1] - 3, 6, 6); }
      }
      o2.fillStyle = '#0f1412'; o2.strokeStyle = blade; o2.lineWidth = 1.25;
      for (const p of g.c.concat(g.m)) { o2.beginPath(); o2.rect(p[0] - 4, p[1] - 4, 8, 8); o2.fill(); o2.stroke(); }
      o2.beginPath(); o2.moveTo(g.m[0][0], g.m[0][1]); o2.lineTo(g.rot[0], g.rot[1]); o2.stroke();
      o2.beginPath(); o2.arc(g.rot[0], g.rot[1], 5, 0, 7); o2.fill(); o2.stroke();
      o2.beginPath(); o2.arc(g.an[0], g.an[1], 5, 0, 7); o2.moveTo(g.an[0] - 9, g.an[1]); o2.lineTo(g.an[0] + 9, g.an[1]); o2.moveTo(g.an[0], g.an[1] - 9); o2.lineTo(g.an[0], g.an[1] + 9); o2.stroke();
    }
    if (prim) {
      const g = geom(frame, prim);
      // masks
      for (const mk of editMasks(prim)) {
        const on = S.sel.mask === mk.id || editMasks(prim).length === 1;
        o2.strokeStyle = on ? tape : 'rgba(233,200,74,.45)'; o2.lineWidth = 1.2; o2.beginPath();
        const n = mk.pts.length, segs = mk.closed ? n : n - 1;
        mk.pts.forEach((p, i) => { const s = g.P(p.x, p.y); if (!i) o2.moveTo(s[0], s[1]); });
        for (let i = 0; i < segs; i++) { const p = mk.pts[i], q = mk.pts[(i + 1) % n], c1 = g.P(p.x + (p.ox || 0), p.y + (p.oy || 0)), c2 = g.P(q.x + (q.ix || 0), q.y + (q.iy || 0)), e = g.P(q.x, q.y); o2.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]); }
        o2.stroke();
        if (S.tool === 'select' || S.tool === 'pen') for (const p of mk.pts) {
          const s = g.P(p.x, p.y);
          if (on && (p.ox || p.oy || p.ix || p.iy)) { const h1 = g.P(p.x + (p.ox || 0), p.y + (p.oy || 0)), h2 = g.P(p.x + (p.ix || 0), p.y + (p.iy || 0)); o2.strokeStyle = 'rgba(233,200,74,.5)'; o2.beginPath(); o2.moveTo(h2[0], h2[1]); o2.lineTo(s[0], s[1]); o2.lineTo(h1[0], h1[1]); o2.stroke(); o2.fillStyle = tape; for (const hh of [h1, h2]) { o2.beginPath(); o2.arc(hh[0], hh[1], 3, 0, 7); o2.fill(); } }
          o2.fillStyle = '#0f1412'; o2.strokeStyle = tape; o2.beginPath(); o2.rect(s[0] - 3.5, s[1] - 3.5, 7, 7); o2.fill(); o2.stroke();
        }
      }
      // pins
      const pf = pinsFx(prim);
      if (pf) for (const q of pf.pins) { const c = frame.val(prim, `fx.${pf.id}.pin.${q.id}`), s = g.P(c[0], c[1]); o2.fillStyle = tape; o2.strokeStyle = '#1b1705'; o2.lineWidth = 1.5; o2.beginPath(); o2.arc(s[0], s[1], 6, 0, 7); o2.fill(); o2.stroke(); o2.beginPath(); o2.arc(s[0], s[1], 1.6, 0, 7); o2.fillStyle = '#1b1705'; o2.fill(); }
    }
    if (V.pen) {                                   // path being drawn
      const g = V.pen.layer ? geom(frame, KS.layer(V.pen.layer)) : null, P = (x, y) => (g ? g.P(x, y) : V.toScreen(x, y));
      o2.strokeStyle = tape; o2.lineWidth = 1.4; o2.beginPath();
      V.pen.pts.forEach((p, i) => { const s = P(p.x, p.y); if (!i) { o2.moveTo(s[0], s[1]); return; } const q = V.pen.pts[i - 1], c1 = P(q.x + (q.ox || 0), q.y + (q.oy || 0)), c2 = P(p.x + (p.ix || 0), p.y + (p.iy || 0)); o2.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], s[0], s[1]); });
      if (V.hover && V.pen.pts.length) o2.lineTo(V.hover[0], V.hover[1]);
      o2.stroke();
      V.pen.pts.forEach((p, i) => { const s = P(p.x, p.y); o2.fillStyle = i ? '#0f1412' : tape; o2.strokeStyle = tape; o2.beginPath(); o2.rect(s[0] - 4, s[1] - 4, 8, 8); o2.fill(); o2.stroke(); });
    }
    if (drag && drag.kind === 'tear' && drag.scr.length > 1) {
      o2.strokeStyle = '#fff'; o2.lineWidth = 2; o2.setLineDash([1, 5]); o2.lineCap = 'round'; o2.beginPath(); drag.scr.forEach((p, i) => (i ? o2.lineTo(p[0], p[1]) : o2.moveTo(p[0], p[1]))); o2.stroke(); o2.setLineDash([]); o2.lineCap = 'butt';
    }
    if (drag && drag.kind === 'shape') { o2.strokeStyle = tape; o2.lineWidth = 1.2; const b = drag; if (S.tool === 'ellipse') { o2.beginPath(); o2.ellipse((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.abs(b.x1 - b.x0) / 2, Math.abs(b.y1 - b.y0) / 2, 0, 0, 7); o2.stroke(); } else o2.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); }
    if (SK.on) { o2.fillStyle = cs.getPropertyValue('--rec').trim() || '#ff5a4f'; o2.beginPath(); o2.arc(cssW - 16, 16, 6, 0, 7); o2.fill(); }
    if (tie && KS.Sound && KS.Sound.pending.size) { o2.fillStyle = tie; o2.font = '11px sans-serif'; o2.textAlign = 'right'; o2.fillText('音を読んでいます…', cssW - 10, cssH - 12); o2.textAlign = 'left'; }
  };

  // ---------------------------------------------------------------- writing values while dragging
  const stored = (L, path) => { const p = M.getProp(L, path); return U.vcopy(M.evalProp(p, KS.frameNow().lt(L, S.t))); };
  const put = (L, path, v) => {
    const prop = M.getProp(L, path); if (!prop) return;
    if (SK.on) { M.setKey(prop, M.snap(KS.comp(), S.t), v, { e: null }); if (!SK.props.some((q) => q.prop === prop)) SK.props.push({ prop, L, path }); }
    else M.setValue(prop, v, S.t);
  };
  // ● armed: the first movement starts the clock; every later frame gets a key; on release the keys are thinned
  function sketchBegin(list) {
    if (!S.rec || S.playing) return;
    const comp = KS.comp();
    SK.on = true; SK.t0 = S.t; SK.props = [];
    for (const [L, path] of list) { const prop = M.getProp(L, path); if (!prop) continue; const cur = stored(L, path); if (prop.k) prop.k = prop.k.filter((k) => k.t <= S.t + 1e-6); M.setKey(prop, M.snap(comp, S.t), cur, { e: null }); SK.props.push({ prop, L, path }); S.tl.open[L.id] = S.tl.open[L.id] || 'tr'; }
    KS.Play.start({ once: true });
  }
  function sketchEnd() {
    if (!SK.on) return;
    KS.Play.stop(); SK.on = false;
    for (const { prop } of SK.props) {
      if (!prop.k) continue;
      const span = prop.k.filter((k) => k.t >= SK.t0 - 1e-6);
      if (span.length < 3) continue;
      const vec = U.isArr(span[0].v), pts = span.map((k) => [k.t * (vec ? 240 : 60)].concat(vec ? k.v : [k.v]));
      const keep = new Set(U.rdp(pts, vec ? 2.2 : 0.6).map((i) => span[i].id));
      prop.k = prop.k.filter((k) => k.t < SK.t0 - 1e-6 || keep.has(k.id));
    }
    KS.toast(`動きを記録しました（${U.fmtNum(S.t - SK.t0, 1)} 秒）`);
  }
  V.sketching = () => SK.on;

  // ---------------------------------------------------------------- pointer
  const pos = (e) => { const r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function down(e) {
    if (S.exporting) return;
    const [x, y] = pos(e);
    ptrs.set(e.pointerId, [x, y]);
    try { ov.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    if (ptrs.size === 2) return beginGesture();
    if (ptrs.size > 2) return;
    const comp = KS.comp(), frame = KS.frameNow(), touch = e.pointerType === 'touch', rad = touch ? 16 : 8;
    const c = V.toComp(x, y);
    if (e.button === 1 || S.tool === 'hand' || (e.button === 2)) { drag = { kind: 'pan', x, y, px: S.view.panX, py: S.view.panY }; return; }
    const prim = KS.selLayers().filter((L) => L.tr)[0];
    if (S.tool === 'rect' || S.tool === 'ellipse' || S.tool === 'star') { drag = { kind: 'shape', x0: x, y0: y, x1: x, y1: y }; return; }
    if (S.tool === 'text') { const L = KS.cmd.addLayer('text', { str: 'テキスト' }); L.tr.p.v = [Math.round(c[0]), Math.round(c[1])]; KS.setTool('select'); KS.restructured(); KS.commit('text'); KS.emit('focusText'); return; }
    if (S.tool === 'pen') return penDown(x, y, prim, frame, rad);
    if (S.tool === 'tear') { drag = { kind: 'tear', prim, scr: [[x, y]] }; return; }   // which layer it is gets decided by what the line crosses
    if (S.tool === 'pin') {
      let L = prim, pf = pinsFx(L);
      if (L && pf) { const g = geom(frame, L); for (const q of pf.pins) { const cur = frame.val(L, `fx.${pf.id}.pin.${q.id}`); if (near(g.P(cur[0], cur[1]), x, y, rad + 2)) return beginPin(L, pf, q); } }
      if (!L || !inQuad(geom(frame, L).c, x, y)) { L = V.pick(x, y); if (L) KS.select(L.id); }
      if (!L) { V.note('ピンを打ちたいレイヤーの上を押してください'); return; }
      pf = pinsFx(L) || KS.cmd.addEffect('pins', L);
      const lp = U.mApply(U.mInv(frame.world(L)), c[0], c[1]), q = { id: U.uid('q'), rest: [U.round(lp[0], 1), U.round(lp[1], 1)], pos: { v: [U.round(lp[0], 1), U.round(lp[1], 1)] } };
      pf.pins.push(q); KS.restructured();
      return beginPin(L, pf, q);
    }
    if (S.tool === 'crumple') {
      const L = prim && inQuad(geom(frame, prim).c, x, y) ? prim : V.pick(x, y);
      if (!L) { V.note('丸めたいレイヤーをつかんで、中心へ向かって押し込んでください'); return; }
      if (L !== prim) KS.select(L.id);
      let fx = L.fx.find((f) => f.type === 'crumple');
      if (!fx) { fx = KS.cmd.addEffect('crumple', L); fx.p.amount.v = 0; }
      const g = geom(frame, L), ctr = [(g.c[0][0] + g.c[2][0]) / 2, (g.c[0][1] + g.c[2][1]) / 2], path = `fx.${fx.id}.amount`;
      drag = { kind: 'crumple', L, path, ctr, d0: Math.max(20, Math.hypot(x - ctr[0], y - ctr[1])), v0: stored(L, path) };
      sketchBegin([[L, path]]); return;
    }
    // ---- select tool
    if (prim && !prim.lock) {
      const g = geom(frame, prim), pf = pinsFx(prim);
      if (pf) for (const q of pf.pins) { const cur = frame.val(prim, `fx.${pf.id}.pin.${q.id}`); if (near(g.P(cur[0], cur[1]), x, y, rad)) return beginPin(prim, pf, q); }
      for (const mk of editMasks(prim)) for (let i = 0; i < mk.pts.length; i++) {
        const p = mk.pts[i];
        for (const hk of ['o', 'i']) if ((p[hk + 'x'] || p[hk + 'y']) && near(g.P(p.x + p[hk + 'x'], p.y + p[hk + 'y']), x, y, rad)) { S.sel.mask = mk.id; drag = { kind: 'maskh', L: prim, mk, i, hk, inv: U.mInv(g.W) }; return; }
        if (near(g.P(p.x, p.y), x, y, rad)) { S.sel.mask = mk.id; KS.emit('sel'); drag = { kind: 'maskpt', L: prim, mk, i, inv: U.mInv(g.W), alt: e.altKey }; return; }
      }
      if (near(g.rot, x, y, rad + 2)) { drag = { kind: 'rotate', L: prim, an: g.an, a0: Math.atan2(y - g.an[1], x - g.an[0]), last: 0, acc: 0, r0: stored(prim, 'tr.r') }; sketchBegin([[prim, 'tr.r']]); return; }
      if (near(g.an, x, y, rad)) { drag = { kind: 'anchor', L: prim, inv: U.mInv(g.W), local: frame.local(prim), a0: stored(prim, 'tr.a'), p0: stored(prim, 'tr.p') }; return; }
      const hs = g.c.concat(g.m);
      for (let i = 0; i < 8; i++) if (near(hs[i], x, y, rad)) {
        const ux = U.mVec(g.W, 1, 0), uy = U.mVec(g.W, 0, 1), nx = Math.hypot(ux[0], ux[1]) || 1, ny = Math.hypot(uy[0], uy[1]) || 1;
        drag = { kind: 'scale', L: prim, hi: i, an: g.an, ux: [ux[0] / nx, ux[1] / nx], uy: [uy[0] / ny, uy[1] / ny], v0: [x - g.an[0], y - g.an[1]], s0: stored(prim, 'tr.s') };
        sketchBegin([[prim, 'tr.s']]); return;
      }
      const pp = prim.tr.p;
      if (pp.k && !pp.x) { const PW = frame.parentWorld(prim); for (const k of pp.k) { const cc = U.mApply(PW, k.v[0], k.v[1]); if (near(V.toScreen(cc[0], cc[1]), x, y, rad)) { KS.selectKeys([k.id]); drag = { kind: 'pathkey', L: prim, key: k, v0: k.v.slice(), x, y, pinv: U.mInv(PW) }; return; } } }
    }
    const hit = V.pick(x, y);
    if (!hit) { if (!e.shiftKey) KS.select([]); drag = { kind: 'none' }; return; }
    if (e.shiftKey) KS.select(hit.id, { toggle: true }); else if (!S.sel.layers.includes(hit.id)) KS.select(hit.id);
    const movers = KS.selLayers().filter((L) => L.tr && !L.lock);
    if (e.altKey && movers.length) { KS.cmd.duplicate(); }
    const list = KS.selLayers().filter((L) => L.tr && !L.lock);
    drag = { kind: 'move', x, y, moved: false, items: list.map((L) => ({ L, p0: stored(L, 'tr.p'), pinv: U.mInv(frame.parentWorld(L)) })) };
  }
  function beginPin(L, pf, q) { const path = `fx.${pf.id}.pin.${q.id}`; drag = { kind: 'pin', L, path, inv: U.mInv(KS.frameNow().world(L)) }; sketchBegin([[L, path]]); }

  function move(e) {
    const [x, y] = pos(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [x, y]);
    V.hover = [x, y];
    if (drag && (drag.kind === 'gesture' || drag.kind === 'viewgesture')) return moveGesture();
    if (!drag) { if (V.pen) KS.touch('overlay'); return; }
    const c = V.toComp(x, y), z = S.view.zoom;
    switch (drag.kind) {
      case 'pan': S.view.panX = drag.px + x - drag.x; S.view.panY = drag.py + y - drag.y; S.view.fit = false; KS.emit('view'); return;
      case 'move': {
        let dx = (x - drag.x) / z, dy = (y - drag.y) / z;
        if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 3) return;
        if (!drag.moved) { drag.moved = true; sketchBegin(drag.items.map((it) => [it.L, 'tr.p'])); }
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        for (const it of drag.items) { const d = U.mVec(it.pinv, dx, dy); put(it.L, 'tr.p', [U.round(it.p0[0] + d[0], 2), U.round(it.p0[1] + d[1], 2)]); }
        break;
      }
      case 'scale': {
        const v = [x - drag.an[0], y - drag.an[1]], a0 = drag.v0[0] * drag.ux[0] + drag.v0[1] * drag.ux[1], b0 = drag.v0[0] * drag.uy[0] + drag.v0[1] * drag.uy[1];
        const a1 = v[0] * drag.ux[0] + v[1] * drag.ux[1], b1 = v[0] * drag.uy[0] + v[1] * drag.uy[1];
        let kx = Math.abs(a0) > 3 ? a1 / a0 : 1, ky = Math.abs(b0) > 3 ? b1 / b0 : 1;
        if (drag.hi < 4) { if (!e.shiftKey) { const k = (v[0] * drag.v0[0] + v[1] * drag.v0[1]) / (drag.v0[0] ** 2 + drag.v0[1] ** 2 || 1); kx = ky = k; } }
        else if (drag.hi === 4 || drag.hi === 6) kx = 1; else ky = 1;
        put(drag.L, 'tr.s', [U.round(drag.s0[0] * kx, 2), U.round(drag.s0[1] * ky, 2)]);
        break;
      }
      case 'rotate': {
        let d = Math.atan2(y - drag.an[1], x - drag.an[0]) - drag.a0;
        let step = d - drag.last; while (step > Math.PI) step -= 2 * Math.PI; while (step < -Math.PI) step += 2 * Math.PI;
        drag.acc += step; drag.last = d;
        let r = drag.r0 + drag.acc * 180 / Math.PI; if (e.shiftKey) r = Math.round(r / 15) * 15;
        put(drag.L, 'tr.r', U.round(r, 2));
        break;
      }
      case 'anchor': {
        const a = U.mApply(drag.inv, c[0], c[1]), na = [U.round(a[0], 1), U.round(a[1], 1)], np = U.mApply(drag.local, na[0], na[1]);
        M.setValue(drag.L.tr.a, na, S.t); M.setValue(drag.L.tr.p, [U.round(np[0], 2), U.round(np[1], 2)], S.t);
        drag.local = U.mMul(drag.local, [1, 0, 0, 1, 0, 0]);
        break;
      }
      case 'pin': { const p = U.mApply(drag.inv, c[0], c[1]); put(drag.L, drag.path, [U.round(p[0], 1), U.round(p[1], 1)]); break; }
      case 'crumple': { const d = Math.hypot(x - drag.ctr[0], y - drag.ctr[1]); put(drag.L, drag.path, U.round(U.clamp(drag.v0 + (drag.d0 - d) / drag.d0 * 130, 0, 100), 1)); break; }
      case 'maskpt': { const p = U.mApply(drag.inv, c[0], c[1]), q = drag.mk.pts[drag.i]; if (drag.alt) { q.ox = U.round(p[0] - q.x, 1); q.oy = U.round(p[1] - q.y, 1); q.ix = -q.ox; q.iy = -q.oy; } else { q.x = U.round(p[0], 1); q.y = U.round(p[1], 1); } break; }
      case 'maskh': { const p = U.mApply(drag.inv, c[0], c[1]), q = drag.mk.pts[drag.i], k = drag.hk, o = k === 'o' ? 'i' : 'o'; q[k + 'x'] = U.round(p[0] - q.x, 1); q[k + 'y'] = U.round(p[1] - q.y, 1); if (!e.altKey) { q[o + 'x'] = -q[k + 'x']; q[o + 'y'] = -q[k + 'y']; } break; }
      case 'pathkey': { const d = U.mVec(drag.pinv, (x - drag.x) / z, (y - drag.y) / z); drag.key.v = [U.round(drag.v0[0] + d[0], 2), U.round(drag.v0[1] + d[1], 2)]; break; }
      case 'tear': { const last = drag.scr[drag.scr.length - 1]; if (Math.hypot(x - last[0], y - last[1]) > 3) drag.scr.push([x, y]); KS.touch('overlay'); return; }
      case 'shape': drag.x1 = x; drag.y1 = y; KS.touch('overlay'); return;
      case 'pen': { const p = V.pen.pts[V.pen.pts.length - 1], q = drag.inv ? U.mApply(drag.inv, c[0], c[1]) : c; if (Math.hypot(x - drag.x, y - drag.y) > 4) { p.ox = U.round(q[0] - p.x, 1); p.oy = U.round(q[1] - p.y, 1); p.ix = -p.ox; p.iy = -p.oy; } KS.touch('overlay'); return; }
      default: return;
    }
    KS.changed();
  }

  function up(e) {
    ptrs.delete(e.pointerId);
    try { ov.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    if (!drag) return;
    if (drag.kind === 'gesture' || drag.kind === 'viewgesture') { if (ptrs.size < 2) { const g = drag; drag = null; if (g.kind === 'gesture') { sketchEnd(); KS.restructured(); KS.commit('transform'); } } return; }
    const d = drag; drag = null;
    const comp = KS.comp();
    switch (d.kind) {
      case 'move': if (d.moved) { sketchEnd(); KS.restructured(); KS.commit('move'); } break;
      case 'scale': case 'rotate': case 'pin': case 'crumple': sketchEnd(); KS.restructured(); KS.commit(d.kind); break;
      case 'anchor': case 'maskpt': case 'maskh': case 'pathkey': KS.changed(); KS.commit(d.kind); break;
      case 'tear': doTear(d); break;
      case 'shape': {
        const a = V.toComp(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1)), b = V.toComp(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
        let w = b[0] - a[0], h = b[1] - a[1], cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
        if (w < 8 || h < 8) { w = h = Math.round(Math.min(comp.w, comp.h) * 0.3); }
        const L = KS.cmd.addLayer('shape', { kind: S.tool, size: [Math.round(w), Math.round(h)], name: { rect: '四角', ellipse: '円', star: '星' }[S.tool] });
        L.tr.p.v = [Math.round(cx), Math.round(cy)]; KS.setTool('select'); KS.restructured(); KS.commit('shape');
        break;
      }
      default: break;
    }
    KS.touch('overlay');
  }
  function dbl(e) {
    if (S.tool === 'pen' && V.pen) { V.pen.pts.pop(); return V.penFinish(true); }
    const [x, y] = pos(e), L = V.pick(x, y);
    if (L && L.type === 'comp') KS.cmd.openComp(L.comp);
    else if (L && L.type === 'text') KS.emit('focusText');
  }
  function wheel(e) {
    e.preventDefault();
    const [x, y] = pos(e);
    if (e.ctrlKey || e.metaKey) V.zoomAt(Math.exp(-e.deltaY * 0.01), x, y);
    else { S.view.panX -= e.deltaX; S.view.panY -= e.deltaY; S.view.fit = false; KS.emit('view'); }
  }

  // ---- two fingers: on a held layer they move, turn and size it at once (paper on a desk); elsewhere they move the view
  const two = () => { const p = [...ptrs.values()]; return { cx: (p[0][0] + p[1][0]) / 2, cy: (p[0][1] + p[1][1]) / 2, d: Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) || 1, a: Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) }; };
  function beginGesture() {
    const t = two(), frame = KS.frameNow();
    if (drag && drag.kind === 'move' && drag.items.length) {
      const L = drag.items[0].L, cc = V.toComp(t.cx, t.cy), aw = U.mApply(frame.world(L), ...frame.val(L, 'tr.a'));
      drag = { kind: 'gesture', L, t, cc, aw, pinv: U.mInv(frame.parentWorld(L)), s0: stored(L, 'tr.s'), r0: stored(L, 'tr.r') };
      sketchBegin([[L, 'tr.p'], [L, 'tr.s'], [L, 'tr.r']]);
    } else drag = { kind: 'viewgesture', t, z: S.view.zoom, cc: V.toComp(t.cx, t.cy) };
  }
  function moveGesture() {
    if (ptrs.size < 2) return;
    const t = two(), g = drag;
    if (g.kind === 'viewgesture') { const z = U.clamp(g.z * t.d / g.t.d, 0.02, 32); S.view.zoom = z; S.view.panX = t.cx - g.cc[0] * z; S.view.panY = t.cy - g.cc[1] * z; S.view.fit = false; KS.emit('view'); return; }
    const k = t.d / g.t.d, da = t.a - g.t.a, c1 = V.toComp(t.cx, t.cy), co = Math.cos(da), si = Math.sin(da);
    const vx = g.aw[0] - g.cc[0], vy = g.aw[1] - g.cc[1], nw = [c1[0] + (co * vx - si * vy) * k, c1[1] + (si * vx + co * vy) * k], np = U.mApply(g.pinv, nw[0], nw[1]);
    put(g.L, 'tr.p', [U.round(np[0], 2), U.round(np[1], 2)]); put(g.L, 'tr.s', [U.round(g.s0[0] * k, 2), U.round(g.s0[1] * k, 2)]); put(g.L, 'tr.r', U.round(g.r0 + da * 180 / Math.PI, 2));
    KS.changed();
  }

  // ---------------------------------------------------------------- tearing
  function doTear(d) {
    const comp = KS.comp(), frame = KS.frameNow();
    const len = d.scr.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - d.scr[i - 1][0], p[1] - d.scr[i - 1][1]) : 0), 0);
    if (len < 24 || d.scr.length < 2) { V.note('ちぎりたいレイヤーを横切るように、線を引いてください'); return; }
    // the selected layer if the line crosses it; otherwise the first layer the line runs over
    let L = d.prim && !d.prim.lock && d.scr.some((p) => inQuad(geom(frame, d.prim).c, p[0], p[1])) ? d.prim : null;
    if (!L) for (const p of d.scr) { L = V.pick(p[0], p[1]); if (L) break; }
    if (!L) { V.note('線がどのレイヤーにも掛かっていません。ちぎりたいレイヤーを横切るように引いてください'); return; }
    const inv = U.mInv(frame.world(L)), r = R.rectOf(L), diag = Math.hypot(r.w, r.h);
    d.pts = d.scr.map((p) => { const c = V.toComp(p[0], p[1]); return U.mApply(inv, c[0], c[1]); });
    const keep = U.rdp(d.pts, Math.max(0.6, diag / 500)), line = keep.map((i) => [U.round(d.pts[i][0], 1), U.round(d.pts[i][1], 1)]);
    const seed = Math.floor(Math.random() * 9000) + 1, torn = (side) => { const m = M.newMask([]); m.torn = { line, side, seed, rough: U.round(diag / 60, 1), fibre: U.round(diag / 110, 1) }; return m; };
    const B = M.cloneLayer(L); B.name = M.uniqueName(comp, L.name.replace(/ ちぎれ.*$/, '') + ' ちぎれ');
    L.masks.push(torn(1)); B.masks.push(torn(-1));
    comp.layers.splice(comp.layers.indexOf(L), 0, B);
    KS.select(B.id); KS.setTool('select'); KS.restructured(); KS.commit('tear');
    V.note('ちぎれました。<b>つかんで引き離せます</b>');
  }

  // ---------------------------------------------------------------- pen: a mask on the selected layer, or a new path
  function penDown(x, y, prim, frame, rad) {
    const c = V.toComp(x, y);
    if (!V.pen) V.pen = { layer: prim && prim.type !== 'audio' ? prim.id : null, pts: [] };
    const L = V.pen.layer ? KS.layer(V.pen.layer) : null, inv = L ? U.mInv(frame.world(L)) : null, p = inv ? U.mApply(inv, c[0], c[1]) : c;
    if (V.pen.pts.length > 2) { const f = V.pen.pts[0], g = L ? geom(frame, L) : null, s = g ? g.P(f.x, f.y) : V.toScreen(f.x, f.y); if (near(s, x, y, rad + 2)) return V.penFinish(true); }
    V.pen.pts.push({ x: U.round(p[0], 1), y: U.round(p[1], 1) });
    drag = { kind: 'pen', x, y, inv };
    if (V.pen.pts.length === 1) V.note(L ? '点を打ってマスクを描きます。<b>最初の点を押すと閉じます</b>' : '点を打って線を描きます。最初の点で閉じる／<b>Enter で線のまま確定</b>', 5000);
    KS.touch('overlay');
  }
  V.penFinish = (closed) => {
    const pen = V.pen; V.pen = null; drag = null;
    if (!pen || pen.pts.length < 2) { KS.touch('overlay'); return; }
    const comp = KS.comp(), L = pen.layer ? KS.layer(pen.layer) : null;
    if (L) {
      if (pen.pts.length < 3) { KS.touch('overlay'); return; }
      const mk = M.newMask(pen.pts, { closed: true }); L.masks.push(mk); S.sel.mask = mk.id;
    } else {
      let cx = 0, cy = 0; for (const p of pen.pts) { cx += p.x; cy += p.y; } cx /= pen.pts.length; cy /= pen.pts.length;
      const pts = pen.pts.map((p) => Object.assign({}, p, { x: U.round(p.x - cx, 1), y: U.round(p.y - cy, 1) }));
      const N = KS.cmd.addLayer('shape', { kind: 'path', pts, closed, name: closed ? '形' : '線', strokeW: closed ? 0 : 8 });
      N.d.fillOn = closed; N.tr.p.v = [U.round(cx, 1), U.round(cy, 1)];
    }
    KS.setTool('select'); KS.restructured(); KS.commit('pen');
  };
  V.cancel = () => { if (V.pen) { V.pen = null; KS.touch('overlay'); return true; } return false; };
})();
