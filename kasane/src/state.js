// Kasane — what the editor is doing right now (selection, playhead, tool, view), the undo history,
// and the handful of commands that the keyboard, the menus and the panels all share.
'use strict';
(() => {
  const U = KS.U, M = KS.M;
  const S = KS.S = {
    project: null, compId: null, t: 0, playing: false, loop: true, rec: false, exporting: false,
    sel: { layers: [], keys: [], mask: null },
    tool: 'select',
    view: { zoom: 1, panX: 0, panY: 0, fit: true, res: 0, dpr: 1, surround: 'mat', checker: false, guides: false, mb: false },
    tl: { pps: 90, sx: 0, open: {}, anim: false },
    ui: { tab: 'tl', hint: true },
  };

  // ---- tiny event bus. 'doc' = the project changed, 'struct' = rows/panels must be rebuilt,
  // 'time', 'sel', 'view', 'tool', 'play' are what they say.
  const subs = {};
  KS.on = (ev, fn) => { (subs[ev] || (subs[ev] = [])).push(fn); };
  KS.emit = (ev, data) => { for (const fn of subs[ev] || []) fn(data); };

  KS.comp = () => (S.project ? M.comp(S.project, S.compId) || S.project.comps[0] || null : null);
  KS.layer = (id) => { const c = KS.comp(); return c ? M.layer(c, id) : null; };
  KS.selLayers = () => { const c = KS.comp(); return c ? c.layers.filter((l) => S.sel.layers.includes(l.id)) : []; };
  KS.firstSel = () => KS.selLayers()[0] || null;
  KS.frameNow = () => new KS.Frame(S.project, KS.comp(), S.t);

  KS.docVer = 0;
  KS.changed = () => { KS.docVer++; KS.emit('doc'); };   // values moved
  KS.restructured = () => { KS.docVer++; KS.emit('struct'); KS.emit('doc'); };   // things were added, removed, reordered

  // ---- history: whole-project snapshots. A project is a few kilobytes of JSON (media lives elsewhere),
  // so this is cheap and can never get out of step with the document.
  const H = KS.H = { stack: [], at: -1, max: 120, lastLabel: '' };
  H.init = () => { H.stack = [JSON.stringify(S.project)]; H.at = 0; };
  KS.commit = (label = '') => {
    const snap = JSON.stringify(S.project);
    if (snap === H.stack[H.at]) return false;
    H.stack.length = H.at + 1;
    H.stack.push(snap); H.lastLabel = label;
    if (H.stack.length > H.max) H.stack.shift();
    H.at = H.stack.length - 1;
    KS.emit('commit', label);
    return true;
  };
  const restore = (i) => {
    H.at = i; S.project = JSON.parse(H.stack[i]);
    if (!M.comp(S.project, S.compId)) S.compId = S.project.active || (S.project.comps[0] && S.project.comps[0].id);
    const c = KS.comp();
    S.sel.layers = S.sel.layers.filter((id) => c && M.layer(c, id));
    S.sel.keys = []; S.sel.mask = null;
    KS.emit('sel'); KS.restructured(); KS.emit('commit', 'undo');
  };
  KS.undo = () => { if (H.at > 0) { restore(H.at - 1); return true; } return false; };
  KS.redo = () => { if (H.at < H.stack.length - 1) { restore(H.at + 1); return true; } return false; };

  // ---- time
  KS.setTime = (t, o = {}) => {
    const c = KS.comp(); if (!c) return;
    t = U.clamp(t, 0, Math.max(0, c.dur - 1 / c.fps));
    if (!o.free) t = M.snap(c, t);
    if (t === S.t) return;
    S.t = t; KS.emit('time');
  };
  KS.step = (frames) => { const c = KS.comp(); if (c) KS.setTime(S.t + frames / c.fps); };

  // ---- selection
  KS.select = (ids, o = {}) => {
    ids = (U.isArr(ids) ? ids : ids ? [ids] : []);
    if (o.toggle) { for (const id of ids) { const i = S.sel.layers.indexOf(id); if (i >= 0) S.sel.layers.splice(i, 1); else S.sel.layers.push(id); } }
    else if (o.add) { for (const id of ids) if (!S.sel.layers.includes(id)) S.sel.layers.push(id); }
    else S.sel.layers = ids.slice();
    if (!o.keepKeys) S.sel.keys = [];
    S.sel.mask = null;
    KS.emit('sel');
  };
  KS.selectKeys = (ids, o = {}) => {
    if (o.toggle) { for (const id of ids) { const i = S.sel.keys.indexOf(id); if (i >= 0) S.sel.keys.splice(i, 1); else S.sel.keys.push(id); } }
    else if (o.add) { for (const id of ids) if (!S.sel.keys.includes(id)) S.sel.keys.push(id); }
    else S.sel.keys = ids.slice();
    KS.emit('sel');
  };
  // all selected keyframes with their layer, property and path
  KS.selKeys = () => {
    const out = [], c = KS.comp(); if (!c || !S.sel.keys.length) return out;
    const want = new Set(S.sel.keys);
    for (const L of c.layers) M.eachKey(L, (key, prop, path) => { if (want.has(key.id)) out.push({ L, key, prop, path }); });
    return out;
  };
  KS.setTool = (tool) => { if (S.tool === tool) return; S.tool = tool; KS.emit('tool'); };
  KS.toast = (msg, kind) => KS.emit('toast', { msg, kind });

  // ---- commands
  const C = KS.cmd = {};
  C.addLayer = (type, o = {}) => {
    const c = KS.comp(); if (!c) return null;
    const L = M.newLayer(type, c, o);
    L.name = M.uniqueName(c, o.name || L.name);
    const first = KS.firstSel(), at = first ? c.layers.indexOf(first) : 0;   // new layers go just above the selection, like a sheet laid on top
    c.layers.splice(Math.max(0, at), 0, L);
    KS.select(L.id); KS.restructured(); KS.commit('add');
    return L;
  };
  C.deleteSel = () => {
    const c = KS.comp(); if (!c) return;
    if (S.sel.keys.length) {
      for (const { prop, key } of KS.selKeys()) M.delKey(prop, key.id);
      S.sel.keys = []; KS.emit('sel'); KS.restructured(); KS.commit('delete keys'); return;
    }
    if (S.sel.mask) {
      const L = KS.firstSel();
      if (L) { L.masks = L.masks.filter((m) => m.id !== S.sel.mask); S.sel.mask = null; KS.emit('sel'); KS.restructured(); KS.commit('delete mask'); return; }
    }
    if (!S.sel.layers.length) return;
    for (const id of S.sel.layers.slice()) M.removeLayer(c, id);
    KS.select([]); KS.restructured(); KS.commit('delete');
  };
  C.duplicate = () => {
    const c = KS.comp(), picked = KS.selLayers(); if (!c || !picked.length) return;
    const ids = [];
    for (const L of picked) { const d = M.cloneLayer(L); d.name = M.uniqueName(c, L.name); c.layers.splice(c.layers.indexOf(L), 0, d); ids.push(d.id); }
    KS.select(ids); KS.restructured(); KS.commit('duplicate');
  };
  C.split = () => {
    const c = KS.comp(), out = [];
    for (const L of KS.selLayers()) { const b = M.splitLayer(c, L, S.t); if (b) out.push(b.id); }
    if (out.length) { KS.select(out); KS.restructured(); KS.commit('split'); }
  };
  C.precompose = () => {
    const c = KS.comp(), ids = S.sel.layers.slice(); if (!c || !ids.length) return;
    const n = S.project.comps.length;
    const L = M.precompose(S.project, c, ids, 'プリコンポ ' + n);
    if (L) { KS.select(L.id); KS.restructured(); KS.commit('precompose'); }
  };
  C.reorder = (dir) => {                         // 1 = towards the front (top of the list)
    const c = KS.comp(), picked = KS.selLayers(); if (!c || !picked.length) return;
    const list = dir > 0 ? picked : picked.slice().reverse();
    for (const L of list) {
      const i = c.layers.indexOf(L), j = dir === 2 ? 0 : dir === -2 ? c.layers.length - 1 : i - dir;
      if (j < 0 || j >= c.layers.length || S.sel.layers.includes(c.layers[j].id) && Math.abs(dir) === 1) continue;
      c.layers.splice(i, 1); c.layers.splice(j, 0, L);
    }
    KS.restructured(); KS.commit('reorder');
  };
  // I / O style trims and moves relative to the playhead
  C.trimIn = () => { for (const L of KS.selLayers()) if (S.t < L.out) L.in = S.t; KS.changed(); KS.commit('trim'); };
  C.trimOut = () => { const c = KS.comp(); for (const L of KS.selLayers()) if (S.t + 1 / c.fps > L.in) L.out = S.t + 1 / c.fps; KS.changed(); KS.commit('trim'); };
  C.moveInTo = () => { for (const L of KS.selLayers()) M.shiftLayer(L, S.t - L.in); KS.changed(); KS.commit('move'); };
  C.setValue = (L, path, v) => {                 // write a value at the playhead (adds a keyframe when the property is animated)
    const prop = M.getProp(L, path); if (!prop) return;
    M.setValue(prop, v, S.t);
  };
  C.toggleAnim = (L, path) => {
    const prop = M.getProp(L, path); if (!prop) return;
    const cur = KS.frameNow().val(L, path);
    M.toggleAnim(prop, S.t, prop.x ? M.evalProp(prop, S.t) : cur);
    S.tl.open[L.id] = S.tl.open[L.id] || 'tr';
    KS.restructured(); KS.commit('stopwatch');
  };
  C.keyNav = (dir) => {                          // J / K: previous or next keyframe of the selected layers (or of everything)
    const c = KS.comp(); if (!c) return;
    const Ls = KS.selLayers().length ? KS.selLayers() : c.layers; let best = null;
    for (const L of Ls) M.eachKey(L, (key) => { if (dir > 0 ? key.t > S.t + 1e-4 : key.t < S.t - 1e-4) if (best === null || (dir > 0 ? key.t < best : key.t > best)) best = key.t; });
    if (best !== null) KS.setTime(best);
  };
  C.ease = (e, hold) => {
    const ks = KS.selKeys(); if (!ks.length) return;
    for (const { key } of ks) { if (hold !== undefined) { if (hold) key.h = 1; else delete key.h; } if (e !== undefined) { if (e) key.e = e.slice(); else delete key.e; } }
    KS.changed(); KS.commit('ease');
  };
  C.addEffect = (type, L = KS.firstSel()) => {
    if (!L || !L.tr) return null;
    const fx = KS.FX.create(type, KS.R.rectOf(L));
    L.fx.push(fx);
    KS.restructured(); KS.commit('add effect');
    return fx;
  };
  C.openComp = (id) => {
    if (!M.comp(S.project, id)) return;
    S.compId = id; S.project.active = id; S.sel.layers = []; S.sel.keys = []; S.sel.mask = null;
    S.t = Math.min(S.t, KS.comp().dur); S.view.fit = true;
    KS.emit('sel'); KS.emit('time'); KS.emit('view'); KS.restructured();
  };

  // ---- animation presets: a few moves most pieces start from, written as ordinary keyframes at the playhead
  const E = U.EASE;
  KS.PRESETS = [
    { id: 'fadeIn', name: 'フェードイン', run: (L, t, f) => { key(L, 'tr.o', t, 0, E.out); key(L, 'tr.o', t + 0.5, f.val(L, 'tr.o')); } },
    { id: 'fadeOut', name: 'フェードアウト', run: (L, t, f) => { key(L, 'tr.o', t, f.val(L, 'tr.o'), E.in); key(L, 'tr.o', t + 0.5, 0); } },
    { id: 'pop', name: 'ポップ', run: (L, t, f) => { const s = f.val(L, 'tr.s'); key(L, 'tr.s', t, [0, 0], E.spring); key(L, 'tr.s', t + 0.45, s); } },
    { id: 'slideL', name: '左から', run: (L, t, f) => slide(L, t, f, -1, 0) },
    { id: 'slideR', name: '右から', run: (L, t, f) => slide(L, t, f, 1, 0) },
    { id: 'slideU', name: '上から', run: (L, t, f) => slide(L, t, f, 0, -1) },
    { id: 'slideD', name: '下から', run: (L, t, f) => slide(L, t, f, 0, 1) },
    { id: 'spin', name: '回って入る', run: (L, t, f) => { const r = f.val(L, 'tr.r'), s = f.val(L, 'tr.s'); key(L, 'tr.r', t, r - 360, E.out); key(L, 'tr.r', t + 0.7, r); key(L, 'tr.s', t, [0, 0], E.out); key(L, 'tr.s', t + 0.7, s); } },
    { id: 'drop', name: '落ちてくる', run: (L, t, f) => { const p = f.val(L, 'tr.p'), h = KS.comp().h; key(L, 'tr.p', t, [p[0], p[1] - h], E.in); key(L, 'tr.p', t + 0.45, p, [0.2, 1.5, 0.5, 1]); key(L, 'tr.p', t + 0.75, p); } },
    { id: 'wiggle', name: 'ゆらす', run: (L) => { L.tr.p.x = 'wiggle(2, 24)'; L.tr.r.x = 'wiggle(1.5, 4)'; } },
    { id: 'type', name: '一文字ずつ', only: 'text', run: (L, t) => { const n = Math.max(1, String(L.d.str).length); key(L, 'p.reveal', t, 0, null); key(L, 'p.reveal', t + Math.min(3, n * 0.07), 100); } },
    { id: 'draw', name: '線を描く', only: 'shape', run: (L, t) => { if (!(M.evalProp(L.p.strokeW, t) > 0)) L.p.strokeW.v = 8; key(L, 'p.trimE', t, 0, E.strong); key(L, 'p.trimE', t + 1, 100); } },
    { id: 'crumpleIn', name: 'くしゃっと丸める', run: (L, t) => { let fx = L.fx.find((x) => x.type === 'crumple'); if (!fx) { fx = KS.FX.create('crumple', KS.R.rectOf(L)); L.fx.push(fx); } const p = `fx.${fx.id}.amount`; key(L, p, t, 0, E.in); key(L, p, t + 0.6, 100); } },
  ];
  function key(L, path, t, v, e) { const c = KS.comp(), prop = M.getProp(L, path); if (prop) M.setKey(prop, M.snap(c, t), v, { e: e === undefined ? E.ease : e }); }
  function slide(L, t, f, dx, dy) { const c = KS.comp(), p = f.val(L, 'tr.p'); key(L, 'tr.p', t, [p[0] + dx * c.w * 0.6, p[1] + dy * c.h * 0.6], E.out); key(L, 'tr.p', t + 0.6, p); key(L, 'tr.o', t, 0, E.out); key(L, 'tr.o', t + 0.3, f.val(L, 'tr.o')); }
  C.preset = (id) => {
    const pr = KS.PRESETS.find((p) => p.id === id), Ls = KS.selLayers().filter((l) => l.tr && (!pr.only || pr.only === l.type));
    if (!pr || !Ls.length) { KS.toast(pr && pr.only ? `「${pr.name}」は${M.TYPES[pr.only]}レイヤーに使えます` : 'レイヤーを選んでください'); return; }
    const f = KS.frameNow();
    for (const L of Ls) { pr.run(L, Math.max(S.t, L.in), f); S.tl.open[L.id] = S.tl.open[L.id] || 'tr'; }
    KS.restructured(); KS.commit('preset');
  };
})();
