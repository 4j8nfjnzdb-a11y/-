// Kasane — the compositor. For one moment of one composition it walks the layers from the bottom up:
//   source pixels → masks → effects (all in the layer's own space) → transform into the frame
//   → blend mode / track matte against everything below.
// Adjustment layers process what is already there; nested compositions are rendered first and used as
// a source; motion blur averages the layer's transform over the time the shutter is open.
'use strict';
(() => {
  const U = KS.U, M = KS.M, G = KS.G, FX = KS.FX, RA = KS.Raster;
  const R = KS.R = { rects: new Map(), stats: { ms: 0, layers: 0 } };

  let srcCache = new Map();     // layer.id → { key, tex, rect, rs, gen }   text and shapes
  let maskCache = new Map();    // mask.id  → { key, tex, gen }
  let assetTex = new Map();     // asset.id → { tex, gen, src }             still images
  let videoTex = new Map();     // layer.id → { tex, gen }
  const meshCache = new Map();  // n → { uv, idx }
  const LIGHT = (() => { const v = [-0.45, -0.55, 0.7], l = Math.hypot(...v); return v.map((x) => x / l); })();
  const PAPER = [0.95, 0.93, 0.88];
  const MATTE = { a: 1, ai: 2, l: 3, li: 4 };
  const BLEND = {}; M.BLENDS.forEach((b, i) => { BLEND[b[0]] = i; });

  R.reset = () => { srcCache = new Map(); maskCache = new Map(); assetTex = new Map(); videoTex = new Map(); procs = new Map(); };
  R.forget = (id) => {
    for (const map of [srcCache, maskCache, assetTex, videoTex]) { const e = map.get(id); if (e) { if (e.gen === G.gen) G.drop(e.tex); map.delete(id); } }
  };
  // textures of layers and masks that no longer exist would otherwise pile up over a long session
  R.prune = (project) => {
    const live = new Set();
    for (const c of project.comps) for (const l of c.layers) { live.add(l.id); for (const m of l.masks || []) live.add(m.id); }
    for (const a of project.assets) live.add(a.id);
    for (const map of [srcCache, maskCache, assetTex, videoTex]) for (const id of [...map.keys()]) if (!live.has(id)) R.forget(id);
    const fxLive = new Set(); for (const c of project.comps) for (const l of c.layers) for (const f of l.fx || []) fxLive.add(f.id);
    for (const [id, st] of procs) if (!fxLive.has(id)) { freeProc(st); procs.delete(id); }
  };

  // where a layer's own pixels sit in its own coordinates — also for layers that are hidden or off-screen right now
  R.rectOf = (L) => {
    const r = R.rects.get(L.id); if (r) return r;
    const e = srcCache.get(L.id); if (e) return e.rect;
    if (L.type === 'text' || L.type === 'shape') return { x: -100, y: -100, w: 200, h: 200 };
    return { x: 0, y: 0, w: L.d.w || 100, h: L.d.h || 100 };
  };
  // ---- processes: effects that are applied to their own result, frame after frame
  let procs = new Map();        // fx.id → { key, n, state, cps: [{ n, rt }], sig, docVer }
  let stepBudget = 24;          // how many steps a redraw may catch up; grows on fast machines, shrinks on slow ones
  const freeProc = (st) => { if (st.key.endsWith(':' + G.gen)) { if (st.state) G.release(st.state); for (const c of st.cps) G.release(c.rt); } };
  function runProcess(env, L, t, f, def, ctx, input, p) {
    if (def.float && !G.floatOK) return input;
    const fps = env.comp.fps, fi = Math.max(0, Math.round((env.frame.lt(L, t) - L.in) * fps)), key = input.w + 'x' + input.h + ':' + G.gen;
    let st = procs.get(f.id);
    if (st && st.docVer !== KS.docVer) { const sig = JSON.stringify(L); if (sig !== st.sig) { freeProc(st); st = null; } else st.docVer = KS.docVer; }
    if (st && st.key !== key) { freeProc(st); st = null; }
    if (!st) { st = { key, n: -1, state: null, cps: [], sig: JSON.stringify(L), docVer: KS.docVer }; procs.set(f.id, st); }
    if (fi < st.n) {                              // the playhead went back: resume from the nearest remembered frame
      let best = null; for (const c of st.cps) if (c.n <= fi && (!best || c.n > best.n)) best = c;
      if (st.state) G.release(st.state);
      st.state = best ? FX.copyRt(best.rt) : null; st.n = best ? best.n : -1;
    }
    let budget = env.exporting ? 1e9 : Math.max(1, Math.round(stepBudget));   // catching up is spread over several redraws so the page never locks
    while (st.n < fi && budget-- > 0) {
      const n1 = st.n + 1, tn = L.in + n1 / fps;
      ctx.time = tn; ctx.frameNo = n1;
      const pn = n1 === fi ? p : fxVals(env.frame, L, f, tn);
      if (!st.state) st.state = def.init(ctx, input, pn);
      else { const ns = def.step(ctx, st.state, input, pn); if (ns !== st.state) { G.release(st.state); st.state = ns; } }
      st.n = n1;
      if (n1 > 0 && n1 % 45 === 0 && !st.cps.some((c) => c.n === n1)) { st.cps.push({ n: n1, rt: FX.copyRt(st.state) }); if (st.cps.length > 6) G.release(st.cps.shift().rt); }
    }
    if (st.n < fi) R.more = true;                 // still catching up — the caller asks for another pass
    ctx.time = t; ctx.frameNo = fi;
    return st.state ? def.out(ctx, st.state, input, p) : input;
  }
  R.resetProcesses = () => { for (const st of procs.values()) freeProc(st); procs = new Map(); };
  // one frame of the composition's sound as a 512×1 texture (r = waveform, g = spectrum)
  let waveTex = null, waveGen = -1, waveKey = '';
  function waveFor(env, t) {
    const gl = G.gl, sl = KS.Rel ? KS.Rel.sndLayer(env.comp, null) : null, an = sl ? KS.Sound.get(sl.src) : null;
    const ts = sl ? (t - sl.start) * (sl.speed || 1) : 0, key = (an ? sl.id : '-') + '|' + ts.toFixed(4);
    if (waveGen !== G.gen) { waveTex = G.texture(); waveGen = G.gen; waveKey = ''; }
    if (key !== waveKey) { gl.bindTexture(gl.TEXTURE_2D, waveTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, KS.Sound ? KS.Sound.frameData(an, ts) : new Uint8Array(2048).fill(128)); waveKey = key; }
    return waveTex;
  }

  const fxVals = (frame, L, fx, t) => {
    const def = FX.defs[fx.type], o = {};
    for (const pd of def.params) o[pd.id] = pd.type === 'enum' || pd.type === 'bool' ? fx.p[pd.id].v : frame.val(L, `fx.${fx.id}.${pd.id}`, t);
    return o;
  };
  R.fxVals = fxVals;
  const typeVals = (frame, L, t) => { const o = {}; for (const k in L.p) o[k] = frame.val(L, 'p.' + k, t); return o; };
  const quantRs = (want) => U.clamp(Math.pow(2, Math.round(Math.log2(Math.max(want, 0.05)) * 2) / 2), 0.125, 6);

  // ---------------------------------------------------------------- sources
  function getSource(env, L, t, world) {
    const frame = env.frame;
    if (L.type === 'solid' || L.type === 'adjust') {
      const c = L.type === 'solid' ? frame.val(L, 'p.color', t) : [1, 1, 1, 1];
      return { tex: G.white, rect: { x: 0, y: 0, w: L.d.w, h: L.d.h }, rs: 1, tint: [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]], flat: true, hard: true };
    }
    if (L.type === 'text' || L.type === 'shape') {
      const v = typeVals(frame, L, t), want = hasProcess(L) ? 1 : quantRs(U.mScaleOf(world) * 1.0);   // a process counts in pixels: its grid must not depend on the zoom
      const key = JSON.stringify([L.d, v, want, KS.Fonts.gen]);
      let e = srcCache.get(L.id);
      if (!e || e.key !== key || e.gen !== G.gen) {
        const r = L.type === 'text' ? RA.text(L.d, v, want) : RA.shape(L.d, v, want);
        if (e && e.gen === G.gen) G.drop(e.tex);
        const tex = G.texture(); G.upload(tex, r.canvas);
        e = { key, tex, rect: r.rect, rs: r.rs, gen: G.gen };
        srcCache.set(L.id, e);
      }
      return { tex: e.tex, rect: e.rect, rs: e.rs };
    }
    if (L.type === 'image') {
      const m = KS.Media && KS.Media.image(L.src);
      if (!m) return { tex: G.white, rect: { x: 0, y: 0, w: L.d.w || 320, h: L.d.h || 180 }, rs: 1, tint: [0.16, 0.2, 0.18, 1], flat: true, hard: true, missing: true };
      let e = assetTex.get(L.src);
      if (!e || e.gen !== G.gen || e.src !== m.el) {
        if (e && e.gen === G.gen) G.drop(e.tex);
        const tex = G.texture({ mip: true }); G.upload(tex, m.el, true);
        e = { tex, gen: G.gen, src: m.el }; assetTex.set(L.src, e);
      }
      return { tex: e.tex, rect: { x: 0, y: 0, w: m.w, h: m.h }, rs: 1, hard: true };
    }
    if (L.type === 'video') {
      const tl = (frame.lt(L, t) - L.start) * (L.speed || 1);
      const m = KS.Media && KS.Media.videoFrame(L, tl, env);
      const rect = { x: 0, y: 0, w: L.d.w || 320, h: L.d.h || 180 };
      let e = videoTex.get(L.id);
      if (m && m.el) {
        if (!e || e.gen !== G.gen) { e = { tex: G.texture(), gen: G.gen, has: false }; videoTex.set(L.id, e); }
        try { G.upload(e.tex, m.el); e.has = true; } catch (err) { /* frame not ready; keep the last one */ }
      }
      if (!e || !e.has || e.gen !== G.gen) return { tex: G.white, rect, rs: 1, tint: [0.16, 0.2, 0.18, 1], flat: true, hard: true, missing: true };
      return { tex: e.tex, rect, rs: 1, hard: true };
    }
    if (L.type === 'comp') {
      const nc = M.comp(env.project, L.comp);
      if (!nc || env.depth > 6 || env.stack.includes(nc.id)) return null;
      const tl = (frame.lt(L, t) - L.start) * (L.speed || 1);
      const nres = hasProcess(L) ? 1 : env.res;
      const rt = renderComp(env.project, nc, tl, { res: nres, mb: env.mb, depth: env.depth + 1, stack: env.stack.concat(env.comp.id), exporting: env.exporting, playing: env.playing });
      return { tex: rt.tex, rect: { x: 0, y: 0, w: nc.w, h: nc.h }, rs: nres, own: rt, hard: true };
    }
    return null;
  }

  function maskTexture(mask, expand, geo) {
    const key = JSON.stringify([mask.pts, mask.closed, mask.torn || 0, U.round(expand, 2), geo.bw, geo.bh, U.round(geo.rs, 4), U.round(geo.x, 2), U.round(geo.y, 2)]);
    let e = maskCache.get(mask.id);
    if (!e || e.key !== key || e.gen !== G.gen) {
      if (e && e.gen === G.gen) G.drop(e.tex);
      const tex = G.texture(); G.upload(tex, RA.mask(mask, expand, geo));
      e = { key, tex, gen: G.gen }; maskCache.set(mask.id, e);
    }
    return e.tex;
  }

  const quadPos = new Float32Array(12), quadUv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), quadIdx = new Uint16Array([0, 1, 2, 2, 1, 3]);
  function drawRect(rt, tex, mat, r, color, edge = 0, blend = 'over') {
    quadPos.set([r.x, r.y, 0, r.x + r.w, r.y, 0, r.x, r.y + r.h, 0, r.x + r.w, r.y + r.h, 0]);
    G.target(rt); G.blend(blend);
    G.use(G.prog(G.SRC.layer, 'layer'), { uTex: tex, uMat: mat, uView: [rt.w, rt.h], uZk: 0, uZs: 0, uColor: color, uEdge: edge, uShade: 0, uBack: 0, uFlip: 1, uLight: LIGHT, uPaper: PAPER });
    G.mesh(quadPos, quadUv, quadIdx);
  }

  // masks and effects, in the layer's own pixels. Returns { tex, rect, rs, own } — rect grows by the padding
  // that blurs, glows and shadows need so they aren't cut off at the layer's edge.
  function prepare(env, L, t, src, noFx) {
    const frame = env.frame;
    const masks = (L.masks || []).filter((m) => (m.torn ? m.torn.line.length > 1 : m.pts.length > 2));
    const fxs = noFx ? [] : (L.fx || []).filter((f) => f.on && FX.defs[f.type] && !FX.defs[f.type].mesh);
    if (!masks.length && !fxs.length) return src;
    const vals = fxs.map((f) => fxVals(frame, L, f, t));
    let pad = 0; fxs.forEach((f, i) => { pad += FX.pad(FX.defs[f.type], vals[i]); });
    pad = Math.ceil(Math.min(pad, 800));
    const r = src.rect;
    let rs = src.rs;
    const cap = Math.min(G.maxTex, 4096), big = Math.max(r.w + 2 * pad, r.h + 2 * pad) * rs;
    if (big > cap) rs *= cap / big;
    const bw = Math.max(1, Math.round((r.w + 2 * pad) * rs)), bh = Math.max(1, Math.round((r.h + 2 * pad) * rs));
    let cur = G.acquire(bw, bh);
    drawRect(cur, src.tex, [rs, 0, 0, rs, (pad - r.x) * rs, (pad - r.y) * rs], r, src.tint || [1, 1, 1, 1], 0, 'off');
    if (src.own) { G.release(src.own); }
    const geo = { bw, bh, rs, x: r.x - pad, y: r.y - pad, rect: r };
    const plain = masks.filter((m) => !m.torn);
    if (plain.length) {
      const acc = G.acquire(bw, bh, { clear: false }), gl = G.gl;
      G.target(acc); const start = plain[0].mode === 'add' ? 0 : 1; gl.clearColor(start, start, start, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      for (const m of plain) {
        const mv = (k) => frame.val(L, `mk.${m.id}.${k}`, t);
        const tex = maskTexture(m, mv('expand'), geo), feather = mv('feather');
        let bl = null;
        if (feather > 0.05) bl = G.blur({ tex, w: bw, h: bh, float: false }, feather * rs / 2);
        G.pass(G.SRC.maskIn, acc, { uTex: bl ? bl.tex : tex, uInv: m.inv ? 1 : 0, uOp: U.clamp(mv('opacity'), 0, 100) / 100 }, m.mode === 'subtract' ? 'subtract' : m.mode === 'intersect' ? 'intersect' : 'union');
        if (bl) G.release(bl);
      }
      const nx = G.acquire(bw, bh, { clear: false });
      G.pass(G.SRC.mask, nx, { uTex: cur.tex, uMask: acc.tex });
      G.release(cur); G.release(acc); cur = nx;
    }
    for (const m of masks) {
      if (!m.torn) continue;
      const nx = G.acquire(bw, bh, { clear: false });
      G.pass(G.SRC.torn, nx, { uTex: cur.tex, uMask: maskTexture(m, 0, geo), uPaper: m.torn.paper || [0.95, 0.93, 0.88] });
      G.release(cur); cur = nx;
    }
    const ctx = {
      rs, time: t, seed: 0, frameNo: 0, l0: [pad * rs, pad * rs], ls: [r.w * rs, r.h * rs],
      toPx: (pt) => [(pt[0] - r.x + pad) * rs, (pt[1] - r.y + pad) * rs], wave: () => waveFor(env, t),
    };
    fxs.forEach((f, i) => {
      const def = FX.defs[f.type];
      ctx.seed = (U.hashStr(f.id) % 997) / 10; ctx.time = t;
      const nx = def.process ? runProcess(env, L, t, f, def, ctx, cur, vals[i]) : FX.apply(def, ctx, cur, vals[i]);
      if (nx !== cur) { G.release(cur); cur = nx; }
    });
    return { tex: cur.tex, rect: { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, rs, own: cur, padded: pad > 0 || masks.length > 0, hard: src.hard };
  }

  function gridMesh(n) {
    let m = meshCache.get(n);
    if (!m) {
      const uv = new Float32Array((n + 1) * (n + 1) * 2), idx = new Uint16Array(n * n * 6);
      for (let j = 0, k = 0; j <= n; j++) for (let i = 0; i <= n; i++) { uv[k++] = i / n; uv[k++] = j / n; }
      for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = c; idx[k++] = b; idx[k++] = d; }
      m = { uv, idx, pos: new Float32Array((n + 1) * (n + 1) * 3) };
      meshCache.set(n, m);
    }
    return m;
  }
  const meshFx = (L) => (L.fx || []).filter((f) => f.on && FX.defs[f.type] && FX.defs[f.type].mesh);
  const hasProcess = (L) => (L.fx || []).some((f) => f.on && FX.defs[f.type] && FX.defs[f.type].process);

  // place the prepared layer into rt with the given matrix; deforms the mesh when a tactile effect asks for it
  function place(env, rt, L, t, pre, mat, alpha, blend, mfx) {
    const frame = env.frame, r = pre.rect, gl = G.gl;
    const tint = pre.tint || [1, 1, 1, 1], color = [tint[0] * alpha, tint[1] * alpha, tint[2] * alpha, tint[3] * alpha];
    if (!mfx.length) {
      drawRect(rt, pre.tex, mat, r, color, pre.hard && !pre.padded ? 1 : 0, blend);
      return;
    }
    let n = 8; for (const f of mfx) n = Math.max(n, FX.defs[f.type].grid || 32);
    const mesh = gridMesh(n), pos = mesh.pos, cnt = (n + 1) * (n + 1);
    for (let j = 0, k = 0; j <= n; j++) for (let i = 0; i <= n; i++) { pos[k++] = r.x + r.w * i / n; pos[k++] = r.y + r.h * j / n; pos[k++] = 0; }
    let zr = 0, shade = 0, back = 0;
    const base = env.srcRect || r;
    for (const f of mfx) {
      const def = FX.defs[f.type], p = fxVals(frame, L, f, t);
      const de = { rect: base, time: t, pins: def.pins ? (f.pins || []).map((q) => ({ rest: q.rest, cur: frame.val(L, `fx.${f.id}.pin.${q.id}`, t) })) : null };
      zr = Math.max(zr, def.deform(pos, cnt, p, de) || 0);
      if (def.shade) shade = Math.max(shade, def.shade(p));
      if (def.back) back = Math.max(back, def.back(p));
    }
    G.target(rt); G.blend(blend);
    if (zr > 0 && rt.depth) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); }
    G.use(G.prog(G.SRC.layer, 'layer'), { uTex: pre.tex, uMat: mat, uView: [rt.w, rt.h], uZk: zr > 0 ? 1 / (zr * 1.05) : 0, uZs: U.mScaleOf(mat), uColor: color, uEdge: 0, uShade: zr > 0 ? shade : 0, uBack: zr > 0 ? back : 0, uFlip: mat[0] * mat[3] - mat[1] * mat[2] < 0 ? -1 : 1, uLight: LIGHT, uPaper: PAPER });
    G.mesh(pos, mesh.uv, mesh.idx);
    gl.disable(gl.DEPTH_TEST);
  }

  const animatedTr = (frame, L, depth = 0) => {
    if (L.tr) for (const k of M.TR_ORDER) if (M.isAnimated(L.tr[k])) return true;
    for (const f of meshFx(L)) { for (const k in f.p) if (M.isAnimated(f.p[k])) return true; for (const q of f.pins || []) if (M.isAnimated(q.pos)) return true; if (f.type === 'flutter') return true; }
    const par = L.parent && depth < 16 ? frame.layer(L.parent) : null;
    return par ? animatedTr(frame, par, depth + 1) : false;
  };

  // one layer, fully processed and placed, in a frame-sized target of its own (used for mattes, blend modes,
  // motion blur and deformed meshes). Returns null when the layer has nothing to show.
  function layerTarget(env, L, t, o = {}) {
    const frame = env.frame, res = env.res;
    const world = U.mMul(U.mScale(res), frame.world(L, t));
    const src = getSource(env, L, t, world);
    if (!src) return null;
    if (env.depth === 0) R.rects.set(L.id, src.rect);
    env.srcRect = src.rect;
    const pre = prepare(env, L, t, src, L.type === 'adjust');
    if (pre.tint === undefined && src.tint && pre === src) pre.tint = src.tint;
    const mfx = meshFx(L), opacity = U.clamp(frame.val(L, 'tr.o', t), 0, 100) / 100;
    const blur = env.mb && L.mb && env.comp.mb && env.comp.mb.on && animatedTr(frame, L);
    const needDepth = mfx.some((f) => FX.defs[f.type].shade);
    const T = G.acquire(env.W, env.H, { depth: needDepth, float: blur });
    if (blur) {
      const n = G.floatOK ? U.clamp(env.comp.mb.samples | 0, 2, 32) : 4, shutter = (env.comp.mb.angle || 180) / 360 / env.comp.fps;
      for (let i = 0; i < n; i++) {
        const ts = t + ((i + 0.5) / n - 0.5) * shutter;
        if (needDepth) { G.target(T); G.gl.clear(G.gl.DEPTH_BUFFER_BIT); }
        place(env, T, L, ts, pre, U.mMul(U.mScale(res), frame.world(L, ts)), opacity / n, 'add', mfx);
      }
    } else place(env, T, L, t, pre, world, opacity, 'over', mfx);
    if (pre.own) G.release(pre.own);
    return T;
  }

  function renderComp(project, comp, t, o = {}) {
    const res = o.res || 1, W = Math.max(2, Math.round(comp.w * res)), H = Math.max(2, Math.round(comp.h * res));
    const frame = new KS.Frame(project, comp, t);
    const env = { project, comp, frame, res, W, H, mb: !!o.mb, depth: o.depth || 0, stack: o.stack || [], exporting: !!o.exporting, playing: !!o.playing };
    let acc = G.acquire(W, H), other = G.acquire(W, H, { clear: false });
    const anySolo = comp.layers.some((l) => l.solo);
    const matteIds = new Set(); for (const l of comp.layers) if (l.matte) matteIds.add(l.matte.id);
    if (env.depth === 0) R.rects.clear();
    for (let i = comp.layers.length - 1; i >= 0; i--) {
      const L = comp.layers[i];
      if (!L.tr || L.type === 'null' || L.type === 'audio') { if (L.type === 'null' && env.depth === 0) R.rects.set(L.id, { x: 0, y: 0, w: L.d.w, h: L.d.h }); continue; }
      if (!frame.active(L, t)) continue;
      if (anySolo ? !L.solo : !L.vis) continue;
      R.stats.layers++;
      if (L.type === 'adjust') {
        const fxs = (L.fx || []).filter((f) => f.on && FX.defs[f.type] && !FX.defs[f.type].mesh);
        if (!fxs.length) { if (env.depth === 0) R.rects.set(L.id, { x: 0, y: 0, w: L.d.w, h: L.d.h }); continue; }
        const cov = layerTarget(env, L, t);
        if (!cov) continue;
        let cur = acc;
        const ctx = { rs: res, time: t, seed: 0, frameNo: 0, l0: [0, 0], ls: [W, H], toPx: (pt) => [pt[0] * res, pt[1] * res], wave: () => waveFor(env, t) };
        for (const f of fxs) {
          const def = FX.defs[f.type];
          ctx.seed = (U.hashStr(f.id) % 997) / 10; ctx.time = t;
          const nx = def.process ? runProcess(env, L, t, f, def, ctx, cur, fxVals(frame, L, f, t)) : FX.apply(def, ctx, cur, fxVals(frame, L, f, t));
          if (nx !== cur) { if (cur !== acc) G.release(cur); cur = nx; }
        }
        G.pass(G.SRC.adjust, other, { uDst: acc.tex, uFx: cur.tex, uCov: cov.tex });
        if (cur !== acc) G.release(cur);
        G.release(cov);
        const sw = acc; acc = other; other = sw;
        continue;
      }
      const mode = BLEND[L.blend] || 0;
      const matteL = L.matte ? frame.layer(L.matte.id) : null;
      const mfx = meshFx(L);
      const direct = !mode && !matteL && !(env.mb && L.mb && comp.mb && comp.mb.on) && !mfx.some((f) => FX.defs[f.type].shade);
      if (direct) {
        const world = U.mMul(U.mScale(res), frame.world(L, t));
        const src = getSource(env, L, t, world);
        if (!src) continue;
        if (env.depth === 0) R.rects.set(L.id, src.rect);
        env.srcRect = src.rect;
        const pre = prepare(env, L, t, src, false);
        if (pre === src && src.tint) pre.tint = src.tint;
        place(env, acc, L, t, pre, world, U.clamp(frame.val(L, 'tr.o', t), 0, 100) / 100, 'over', mfx);
        if (pre.own) G.release(pre.own);
        continue;
      }
      const T = layerTarget(env, L, t);
      if (!T) continue;
      let TM = null;
      if (matteL && matteL !== L && matteL.tr && frame.active(matteL, t)) TM = layerTarget(env, matteL, t);
      G.pass(G.SRC.blend, other, { uDst: acc.tex, uSrc: T.tex, uMatte: TM ? TM.tex : G.white, uMode: mode, uMatteMode: TM ? MATTE[L.matte.mode] || 1 : 0, uOpacity: 1 });
      G.release(T); if (TM) G.release(TM);
      const sw = acc; acc = other; other = sw;
    }
    G.release(other);
    return acc;
  }
  R.renderComp = renderComp;

  // ---------------------------------------------------------------- frame-level entry points
  // draw the composition into the viewer canvas, lying on the mat
  R.present = (rt, comp, view) => {
    const gl = G.gl;
    G.target(null); G.blend('off');
    G.use(G.prog(G.SRC.present), {
      uTex: rt.tex, uCanvas: [gl.drawingBufferWidth, gl.drawingBufferHeight], uPan: [view.panX * view.dpr, view.panY * view.dpr],
      uComp: [comp.w, comp.h], uZoom: view.zoom * view.dpr, uDpr: view.dpr, uSurround: view.surround === 'black' ? -1 : view.surround === 'plain' ? 0 : 1,
      uAlpha: view.checker ? 1 : 0, uBg: comp.bg,
    });
    G.quad();
  };
  // the finished frame, opaque, filling the canvas 1:1 (export and stills)
  R.flatten = (rt, comp, target = null) => {
    G.target(target); G.blend('off');
    G.use(G.prog(G.SRC.flatten), { uTex: rt.tex, uBg: comp.bg, uFlipY: target ? 0 : 1 });   // the canvas itself is bottom-up
    G.quad();
  };
  R.frame = (project, comp, t, o = {}) => {
    const t0 = performance.now();
    R.stats.layers = 0; R.more = false;
    const rt = renderComp(project, comp, t, o);
    if (R.more && !o.exporting) G.gl.finish();   // only while catching up: make the time measurement honest
    R.stats.ms = performance.now() - t0;
    if (!o.exporting) stepBudget = R.more ? U.clamp(stepBudget * (R.stats.ms < 14 ? 1.6 : R.stats.ms > 40 ? 0.5 : 1), 1, 240) : Math.max(stepBudget, 12);
    return rt;
  };
  // RGBA pixels of a frame (straight alpha over nothing, or flattened onto the background)
  R.pixels = (project, comp, t, o = {}) => {
    const rt = renderComp(project, comp, t, Object.assign({ res: 1, mb: true }, o));
    let out = rt;
    if (o.flat !== false) { out = G.acquire(rt.w, rt.h, { clear: false }); R.flatten(rt, comp, out); }
    const px = G.read(out), w = out.w, h = out.h;
    if (out !== rt) G.release(out);
    G.release(rt);
    return { px, w, h };
  };
})();
