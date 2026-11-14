// Kasane — the document: project → compositions → layers → properties → keyframes.
// The shape follows After Effects on purpose: every animatable thing is a property that either holds
// one value or a list of keyframes, and a layer is drawn as masks → effects → transform.
// Everything here is plain JSON so that undo, autosave and project files are one JSON.stringify away.
'use strict';
(() => {
  const U = KS.U;
  const M = KS.M = {};

  M.BLENDS = [
    ['normal', '通常'], ['multiply', '乗算'], ['screen', 'スクリーン'], ['overlay', 'オーバーレイ'], ['add', '加算'],
    ['darken', '比較（暗）'], ['lighten', '比較（明）'], ['colordodge', '覆い焼き'], ['colorburn', '焼き込み'],
    ['hardlight', 'ハードライト'], ['softlight', 'ソフトライト'], ['difference', '差の絶対値'], ['exclusion', '除外'],
    ['hue', '色相'], ['saturation', '彩度'], ['color', 'カラー'], ['luminosity', '輝度'],
  ];
  M.MATTES = [['a', 'アルファ'], ['ai', 'アルファ反転'], ['l', 'ルミナンス'], ['li', 'ルミナンス反転']];
  M.TYPES = {
    solid: '平面', shape: '図形', text: 'テキスト', image: '画像', video: '動画', audio: '音', null: 'ヌル', adjust: '調整', comp: 'コンポ',
  };
  // washi-tape label colours for layers
  M.LABELS = ['#e86a5c', '#e9c84a', '#7fc97a', '#57c2c9', '#6f8fe8', '#b07ce8', '#e77fb3', '#c9a06a'];
  M.TYPE_LABEL = { solid: 0, shape: 3, text: 1, image: 2, video: 4, audio: 7, null: 6, adjust: 5, comp: 5 };

  // ---- property descriptors (what the inspector and the timeline need to show and edit a property)
  const TR = {
    a: { label: 'アンカー', type: 'vec2', unit: 'px', step: 1 },
    p: { label: '位置', type: 'vec2', unit: 'px', step: 1 },
    s: { label: 'スケール', type: 'vec2', unit: '%', step: 1, link: true },
    r: { label: '回転', type: 'num', unit: '°', step: 1 },
    o: { label: '不透明度', type: 'num', unit: '%', min: 0, max: 100, step: 1 },
  };
  M.TR_ORDER = ['a', 'p', 's', 'r', 'o'];
  const TYPE_PROPS = {
    solid: { color: { label: '色', type: 'color' } },
    shape: {
      size: { label: 'サイズ', type: 'vec2', unit: 'px', min: 0, step: 1, link: false },
      round: { label: '角の丸み', type: 'num', unit: 'px', min: 0, step: 1 },
      points: { label: '頂点の数', type: 'num', min: 3, max: 64, step: 1, int: true },
      inner: { label: '内側の半径', type: 'num', unit: '%', min: 1, max: 100, step: 1 },
      fill: { label: '塗り', type: 'color' },
      stroke: { label: '線の色', type: 'color' },
      strokeW: { label: '線の太さ', type: 'num', unit: 'px', min: 0, step: 0.5 },
      trimS: { label: '線の開始', type: 'num', unit: '%', min: 0, max: 100, step: 1 },
      trimE: { label: '線の終了', type: 'num', unit: '%', min: 0, max: 100, step: 1 },
      trimO: { label: '線のずらし', type: 'num', unit: '°', step: 1 },
    },
    text: {
      size: { label: '文字サイズ', type: 'num', unit: 'px', min: 1, step: 1 },
      track: { label: '字間', type: 'num', min: -200, max: 2000, step: 5 },
      lead: { label: '行送り', type: 'num', unit: '%', min: 50, max: 400, step: 1 },
      fill: { label: '文字の色', type: 'color' },
      stroke: { label: 'ふちの色', type: 'color' },
      strokeW: { label: 'ふちの太さ', type: 'num', unit: 'px', min: 0, step: 0.5 },
      reveal: { label: '表示する文字', type: 'num', unit: '%', min: 0, max: 100, step: 1 },
    },
    video: { vol: { label: '音量', type: 'num', unit: '%', min: 0, max: 200, step: 1 } },
    audio: { vol: { label: '音量', type: 'num', unit: '%', min: 0, max: 200, step: 1 } },
  };
  const MASK_PROPS = {
    feather: { label: 'ぼかし', type: 'num', unit: 'px', min: 0, step: 1 },
    expand: { label: '拡張', type: 'num', unit: 'px', step: 1 },
    opacity: { label: '不透明度', type: 'num', unit: '%', min: 0, max: 100, step: 1 },
  };
  M.MASK_PROPS = MASK_PROPS;
  M.shapeProps = (kind) => {
    const base = { rect: ['size', 'round'], ellipse: ['size'], poly: ['size', 'points'], star: ['size', 'points', 'inner'], path: [] }[kind] || [];
    return base.concat(['fill', 'stroke', 'strokeW', 'trimS', 'trimE', 'trimO']);
  };
  M.typePropNames = (layer) => {
    if (layer.type === 'shape') return M.shapeProps(layer.d.kind);
    return Object.keys(TYPE_PROPS[layer.type] || {});
  };

  M.getProp = (layer, path) => {
    const s = path.split('.');
    if (s[0] === 'tr') return layer.tr ? layer.tr[s[1]] : null;
    if (s[0] === 'p') return layer.p ? layer.p[s[1]] : null;
    if (s[0] === 'fx') {
      const fx = layer.fx && layer.fx.find((f) => f.id === s[1]);
      if (!fx) return null;
      if (s[2] === 'pin') { const pin = fx.pins && fx.pins.find((q) => q.id === s[3]); return pin ? pin.pos : null; }
      return fx.p[s[2]] || null;
    }
    if (s[0] === 'mk') { const mk = layer.masks && layer.masks.find((m) => m.id === s[1]); return mk ? mk.p[s[2]] : null; }
    return null;
  };
  M.desc = (layer, path) => {
    const s = path.split('.');
    if (s[0] === 'tr') return TR[s[1]];
    if (s[0] === 'p') return (TYPE_PROPS[layer.type] || {})[s[1]];
    if (s[0] === 'fx') {
      const fx = layer.fx && layer.fx.find((f) => f.id === s[1]);
      if (!fx) return null;
      const def = KS.FX && KS.FX.defs[fx.type];
      if (s[2] === 'pin') { const i = fx.pins.findIndex((q) => q.id === s[3]); return { label: 'ピン ' + (i + 1), type: 'vec2', unit: 'px', step: 1, group: def ? def.name : '' }; }
      const pd = def && def.params.find((q) => q.id === s[2]);
      return pd ? Object.assign({ group: fx.name || def.name }, pd, { label: pd.name }) : null;
    }
    if (s[0] === 'mk') { const i = (layer.masks || []).findIndex((m) => m.id === s[1]); return Object.assign({ group: 'マスク ' + (i + 1) }, MASK_PROPS[s[2]]); }
    return null;
  };
  // every animatable property of a layer, in display order
  M.allPaths = (layer) => {
    const out = [];
    if (layer.tr) for (const k of M.TR_ORDER) out.push('tr.' + k);
    for (const k of M.typePropNames(layer)) if (layer.p && layer.p[k]) out.push('p.' + k);
    for (const mk of layer.masks || []) for (const k of Object.keys(MASK_PROPS)) out.push(`mk.${mk.id}.${k}`);
    for (const fx of layer.fx || []) {
      const def = KS.FX && KS.FX.defs[fx.type];
      if (def) for (const pd of def.params) if (pd.type !== 'enum' && pd.type !== 'bool' && fx.p[pd.id]) out.push(`fx.${fx.id}.${pd.id}`);
      for (const pin of fx.pins || []) out.push(`fx.${fx.id}.pin.${pin.id}`);
    }
    return out;
  };
  M.isAnimated = (prop) => !!(prop && ((prop.k && prop.k.length) || prop.x || (prop.r && prop.r.length)));
  M.animatedPaths = (layer) => M.allPaths(layer).filter((p) => M.isAnimated(M.getProp(layer, p)));

  // ---- keyframes
  // key: { id, t, v, e?: [x1,y1,x2,y2] easing of the stretch that starts at this key, h?: 1 hold }
  M.keySeg = (k, t) => {                       // index i with k[i].t <= t < k[i+1].t ; -1 before the first key
    let lo = 0, hi = k.length - 1;
    if (t < k[0].t) return -1;
    if (t >= k[hi].t) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (k[mid].t <= t) lo = mid; else hi = mid; }
    return lo;
  };
  const catmull = (p0, p1, p2, p3, u) => {
    const u2 = u * u, u3 = u2 * u, o = new Array(p1.length);
    for (let i = 0; i < p1.length; i++) o[i] = 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3);
    return o;
  };
  M.evalKeys = (prop, t) => {
    const k = prop.k, n = k.length;
    const i = M.keySeg(k, t);
    if (i < 0) return k[0].v;
    if (i >= n - 1) return k[n - 1].v;
    const a = k[i], b = k[i + 1];
    if (a.h) return a.v;
    const span = b.t - a.t;
    const u = span > 0 ? U.bez(a.e, (t - a.t) / span) : 1;
    if (prop.sm && U.isArr(a.v) && n > 2) return catmull(k[Math.max(0, i - 1)].v, a.v, b.v, k[Math.min(n - 1, i + 2)].v, u);
    return U.vlerp(a.v, b.v, u);
  };
  M.evalProp = (prop, t) => (prop.k && prop.k.length ? M.evalKeys(prop, t) : prop.v);
  M.keyAt = (prop, t, tol = 1e-4) => (prop.k ? prop.k.find((q) => Math.abs(q.t - t) < tol) : null);
  M.setKey = (prop, t, v, opts = {}) => {
    if (!prop.k) prop.k = [];
    let key = M.keyAt(prop, t);
    if (key) { key.v = U.vcopy(v); return key; }
    key = { id: U.uid('k'), t, v: U.vcopy(v) };
    const i = prop.k.length ? M.keySeg(prop.k, t) : -1;
    if (opts.e !== undefined) { if (opts.e) key.e = opts.e.slice(); }
    else if (i >= 0 && prop.k[i].e) key.e = prop.k[i].e.slice();
    else if (i < 0 && M.defaultEase) key.e = M.defaultEase.slice();
    if (opts.h || (i >= 0 && prop.k[i].h && opts.h === undefined)) key.h = 1;
    prop.k.splice(i + 1, 0, key);
    prop.v = U.vcopy(v);
    return key;
  };
  M.defaultEase = U.EASE.ease.slice();
  M.delKey = (prop, id) => {
    if (!prop.k) return;
    const i = prop.k.findIndex((q) => q.id === id);
    if (i < 0) return;
    const last = prop.k[i].v;
    prop.k.splice(i, 1);
    if (!prop.k.length) { delete prop.k; prop.v = U.vcopy(last); }
  };
  M.sortKeys = (prop) => {
    if (!prop.k) return;
    prop.k.sort((a, b) => a.t - b.t);
    for (let i = prop.k.length - 1; i > 0; i--) if (Math.abs(prop.k[i].t - prop.k[i - 1].t) < 1e-4) prop.k.splice(i - 1, 1);   // a moved key replaces the one it lands on
  };
  // the stopwatch: turn animation on (first keyframe at t) or off (keep the value the viewer shows now)
  M.toggleAnim = (prop, t, current) => {
    if (prop.k && prop.k.length) { prop.v = U.vcopy(current); delete prop.k; return false; }
    M.setKey(prop, t, current === undefined ? prop.v : current);
    return true;
  };
  M.setValue = (prop, v, t) => {
    if (prop.k && prop.k.length) return M.setKey(prop, t, v);
    prop.v = U.vcopy(v);
    return null;
  };
  M.snap = (comp, t) => Math.round(t * comp.fps) / comp.fps;
  M.eachKey = (layer, fn) => { for (const path of M.allPaths(layer)) { const p = M.getProp(layer, path); if (p && p.k) for (const key of p.k) fn(key, p, path); } };
  M.findKey = (layer, id) => { let hit = null; M.eachKey(layer, (key, prop, path) => { if (key.id === id) hit = { key, prop, path }; }); return hit; };

  // ---- factories
  const P = (v) => ({ v });
  M.newProject = () => ({ v: 1, app: 'kasane', name: '無題', comps: [], assets: [], active: null });
  M.newComp = (o = {}) => ({
    id: U.uid('c'), name: o.name || 'コンポ 1', w: o.w || 1920, h: o.h || 1080, fps: o.fps || 30, dur: o.dur || 8,
    bg: o.bg || [0.06, 0.07, 0.07, 1], layers: [], wa: [0, o.dur || 8], mb: { on: true, angle: 180, samples: 8 },
  });
  M.newLayer = (type, comp, o = {}) => {
    const cx = comp.w / 2, cy = comp.h / 2;
    const L = {
      id: U.uid('l'), type, name: o.name || M.TYPES[type], label: M.TYPE_LABEL[type] || 0,
      in: o.in === undefined ? 0 : o.in, out: o.out === undefined ? comp.dur : o.out, start: o.start === undefined ? (o.in || 0) : o.start,
      vis: true, solo: false, lock: false, mb: false, blend: 'normal', parent: null, matte: null, step: 0, speed: 1,
      tr: { a: P([0, 0]), p: P([cx, cy]), s: P([100, 100]), r: P(0), o: P(100) },
      p: {}, d: {}, fx: [], masks: [],
    };
    if (type === 'solid' || type === 'adjust') {
      L.d.w = o.w || comp.w; L.d.h = o.h || comp.h;
      L.tr.a.v = [L.d.w / 2, L.d.h / 2];
      if (type === 'solid') L.p.color = P(o.color || [0.91, 0.42, 0.36, 1]);
    } else if (type === 'shape') {
      L.d.kind = o.kind || 'rect'; L.d.fillOn = o.fillOn !== false; L.d.cap = 'round';
      if (o.pts) { L.d.pts = o.pts; L.d.closed = !!o.closed; }
      L.p = {
        size: P(o.size || [360, 360]), round: P(o.round || 0), points: P(o.points || 5), inner: P(50),
        fill: P(o.fill || [0.34, 0.76, 0.79, 1]), stroke: P(o.stroke || [0.95, 0.93, 0.87, 1]), strokeW: P(o.strokeW || 0),
        trimS: P(0), trimE: P(100), trimO: P(0),
      };
    } else if (type === 'text') {
      L.d.str = o.str === undefined ? 'テキスト' : o.str; L.d.font = o.font || 'sans'; L.d.weight = o.weight || 700; L.d.align = o.align || 'center'; L.d.italic = false;
      L.p = { size: P(o.size || 140), track: P(0), lead: P(125), fill: P(o.fill || [0.95, 0.93, 0.87, 1]), stroke: P([0.06, 0.07, 0.07, 1]), strokeW: P(0), reveal: P(100) };
    } else if (type === 'image' || type === 'video' || type === 'audio') {
      L.src = o.src; L.d.w = o.w || 0; L.d.h = o.h || 0;
      if (type !== 'audio') {
        L.tr.a.v = [L.d.w / 2, L.d.h / 2];
        const fit = Math.min(1, comp.w / (L.d.w || 1), comp.h / (L.d.h || 1));       // footage larger than the frame comes in fitted
        if (fit < 1) L.tr.s.v = [U.round(fit * 100, 1), U.round(fit * 100, 1)];
      } else delete L.tr;
      if (type !== 'image') L.p.vol = P(100);
    } else if (type === 'null') {
      L.d.w = 120; L.d.h = 120; L.tr.a.v = [60, 60];
    } else if (type === 'comp') {
      L.comp = o.comp; L.d.w = o.w; L.d.h = o.h; L.tr.a.v = [o.w / 2, o.h / 2];
    }
    return L;
  };
  M.newMask = (pts, o = {}) => ({
    id: U.uid('m'), mode: o.mode || 'add', inv: false, closed: o.closed !== false, pts,
    p: { feather: P(o.feather || 0), expand: P(0), opacity: P(100) },
  });

  // ---- lookups and structural edits
  M.comp = (project, id) => project.comps.find((c) => c.id === id) || null;
  M.layer = (comp, id) => comp.layers.find((l) => l.id === id) || null;
  M.asset = (project, id) => project.assets.find((a) => a.id === id) || null;
  M.uniqueName = (comp, base) => {
    const names = new Set(comp.layers.map((l) => l.name));
    if (!names.has(base)) return base;
    const stem = base.replace(/ \d+$/, '');
    for (let i = 2; ; i++) if (!names.has(`${stem} ${i}`)) return `${stem} ${i}`;
  };
  // deep copy with fresh ids, so the copy never shares keyframes, effects or masks with the original
  M.cloneLayer = (layer) => {
    const c = U.clone(layer);
    c.id = U.uid('l');
    const remap = {};
    for (const fx of c.fx || []) { const n = U.uid('f'); remap[fx.id] = n; fx.id = n; for (const pin of fx.pins || []) pin.id = U.uid('q'); }
    for (const mk of c.masks || []) mk.id = U.uid('m');
    M.eachKey(c, (key) => { key.id = U.uid('k'); });
    for (const path of M.allPaths(c)) { const pr = M.getProp(c, path); if (pr && pr.r) for (const r of pr.r) r.id = U.uid('r'); }
    return c;
  };
  M.shiftLayer = (layer, dt) => {
    layer.in += dt; layer.out += dt; layer.start += dt;
    M.eachKey(layer, (key) => { key.t += dt; });
  };
  M.removeLayer = (comp, id) => {
    comp.layers = comp.layers.filter((l) => l.id !== id);
    for (const l of comp.layers) { if (l.parent === id) l.parent = null; if (l.matte && l.matte.id === id) l.matte = null; }
  };
  M.compUsesComp = (project, comp, targetId, depth = 0) => {                 // guards against a composition containing itself
    if (comp.id === targetId) return true;
    if (depth > 16) return true;
    return comp.layers.some((l) => l.type === 'comp' && (l.comp === targetId || (M.comp(project, l.comp) && M.compUsesComp(project, M.comp(project, l.comp), targetId, depth + 1))));
  };
  M.precompose = (project, comp, ids, name) => {
    const picked = comp.layers.filter((l) => ids.includes(l.id));
    if (!picked.length) return null;
    const nc = M.newComp({ name: name || 'プリコンポ', w: comp.w, h: comp.h, fps: comp.fps, dur: comp.dur, bg: [0, 0, 0, 0] });
    nc.mb = U.clone(comp.mb);
    const at = comp.layers.indexOf(picked[0]);
    nc.layers = picked;
    for (const l of picked) { if (l.parent && !ids.includes(l.parent)) l.parent = null; if (l.matte && !ids.includes(l.matte.id)) l.matte = null; }
    comp.layers = comp.layers.filter((l) => !ids.includes(l.id));
    for (const l of comp.layers) { if (ids.includes(l.parent)) l.parent = null; if (l.matte && ids.includes(l.matte.id)) l.matte = null; }
    const cl = M.newLayer('comp', comp, { comp: nc.id, w: nc.w, h: nc.h, name: nc.name });
    comp.layers.splice(Math.min(at, comp.layers.length), 0, cl);
    project.comps.push(nc);
    return cl;
  };
  M.splitLayer = (comp, layer, t) => {
    if (t <= layer.in + 1e-6 || t >= layer.out - 1e-6) return null;
    const b = M.cloneLayer(layer);
    b.name = M.uniqueName(comp, layer.name);
    layer.out = t; b.in = t;
    comp.layers.splice(comp.layers.indexOf(layer), 0, b);
    return b;
  };

  // ---- evaluation of one moment
  // A Frame answers "what is this property worth at time t", including expressions and parenting,
  // and remembers the answers so that a layer referenced by many others is only worked out once.
  class Frame {
    constructor(project, comp, t) {
      this.project = project; this.comp = comp; this.t = t; this.cache = new Map(); this.guard = 0; this.byId = null;
    }
    layer(id) {
      if (!this.byId) { this.byId = new Map(); for (const l of this.comp.layers) this.byId.set(l.id, l); }
      return this.byId.get(id) || null;
    }
    // "コマ落とし": the layer only moves N times a second, like stop motion shot on twos
    lt(layer, t) { return layer.step > 0 ? Math.floor((t - layer.in) * layer.step + 1e-6) / layer.step + layer.in : t; }
    val(layer, path, t = this.t) {
      const tq = this.lt(layer, t), key = layer.id + '|' + path + '|' + tq;
      const hit = this.cache.get(key);
      if (hit !== undefined) return hit;
      const prop = M.getProp(layer, path);
      if (!prop) return undefined;
      let v = M.evalProp(prop, tq);
      if (prop.x && KS.X && this.guard < 24) {
        this.guard++;
        try { v = KS.X.run(this, layer, path, prop, tq, v); } finally { this.guard--; }
      }
      if (prop.r && prop.r.length && KS.Rel) v = KS.Rel.apply(this, layer, path, prop, tq, v);   // what the sound (or a number sequence) adds
      this.cache.set(key, v);
      return v;
    }
    local(layer, t = this.t) {
      if (!layer.tr) return U.mIdent();
      const a = this.val(layer, 'tr.a', t), p = this.val(layer, 'tr.p', t), s = this.val(layer, 'tr.s', t), r = this.val(layer, 'tr.r', t);
      return U.mTRS(p[0], p[1], r, s[0] / 100, s[1] / 100, a[0], a[1]);
    }
    world(layer, t = this.t, depth = 0) {
      const l = this.local(layer, t);
      const par = layer.parent && depth < 32 ? this.layer(layer.parent) : null;
      return par && par.tr ? U.mMul(this.world(par, t, depth + 1), l) : l;
    }
    parentWorld(layer, t = this.t) {
      const par = layer.parent ? this.layer(layer.parent) : null;
      return par && par.tr ? this.world(par, t, 1) : U.mIdent();
    }
    active(layer, t = this.t) { return t >= layer.in - 1e-6 && t < layer.out - 1e-6; }
  }
  KS.Frame = Frame;
})();
