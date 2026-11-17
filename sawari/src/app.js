// Sawari app: state, sources, history, persistence, transport, export, recording.
const W = SAWARI_WORLD, C = SAWARI_CORE, A = SAWARI_AUDIO, D = SAWARI_DRAW, K = SAWARI_CODEC;
const $ = id => document.getElementById(id);
const LOOK = 0.1;                 // scheduling lookahead (s)

const randSeed = () => (Math.random() * 1e9) >>> 0;
let world = W.newWorld(randSeed());
let sim = new W.Sim(world);
const srcs = new Map();           // id -> engine source record (buffers, peaks)
const srcFiles = new Map();       // id -> {bytes: Uint8Array, ext, name}
let ctx = null, eng = null;
const view = new D.View();
const S = {
  sel: new Set(), tool: 'select', playing: false, t0: 0, T: 0, hover: null, labels: false,
  flashes: new Map(), scenes: [null, null, null, null, null, null], lastCtl: 0, busy: false,
};
const inViewer = !!(window.claude && typeof window.claude.use === 'function');

// ---------- messages ----------
let toastTimer = 0;
function toast(msg, ms = 3200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.remove('on'); }, ms);
}

// ---------- audio ----------
function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });
  eng = new A.Engine(ctx, world, { srcs, find: id => sim.byId.get(id) });
  return ctx;
}
async function ensureAudio() {
  ensureCtx();
  if (ctx.state !== 'running') { try { await ctx.resume(); } catch (e) {} }
  return ctx;
}
const audioNow = () => (ctx ? ctx.currentTime : performance.now() / 1000);

// ---------- sources ----------
const extOf = name => (name.match(/\.([a-z0-9]+)$/i) || [, 'bin'])[1].toLowerCase();
async function decodeBytes(bytes) {
  ensureCtx();
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const aiff = K.parseAiff(ab);
  if (aiff) return aiff;
  try {
    const b = await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab.slice(0), res, rej); if (p && p.then) p.then(res, rej); });
    const ch = []; for (let k = 0; k < b.numberOfChannels; k++) ch.push(b.getChannelData(k).slice());
    return { sr: b.sampleRate, ch };
  } catch (e) {
    const wav = K.parseWav(ab); if (wav) return wav;
    throw e;
  }
}
function registerSource(id, name, dec, bytes, ext) {
  ensureCtx();
  const rec = A.makeSource(ctx, id, dec.ch, dec.sr);
  rec.name = name;
  srcs.set(id, rec);
  srcFiles.set(id, { bytes, ext, name });
  if (!world.sources.find(s => s.id === id)) world.sources.push({ id, name, dur: +rec.dur.toFixed(4) });
  sim.index();
  idbPutSource(id, { bytes, ext, name });
  return rec;
}
async function addFiles(files, at) {
  const list = [...files].filter(f => /\.(wav|wave|aif|aiff|aifc|mp3|m4a|aac|flac|ogg|oga|opus|webm|caf)$/i.test(f.name) || (f.type || '').startsWith('audio/'));
  const proj = [...files].find(f => /\.(zip|json)$/i.test(f.name));
  if (proj && !list.length) return openProject(proj);
  if (!list.length) { toast('音声ファイル（WAV・AIFF・MP3 など）を選んでください。'); return; }
  const made = [];
  const rng = C.makeRng(randSeed());
  let i = 0;
  for (const file of list) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dec = await decodeBytes(bytes);
      if (!dec.ch.length || !dec.ch[0].length) throw new Error('empty');
      const id = C.uid('a'), name = file.name.replace(/\.[^.]+$/, '');
      const rec = registerSource(id, name, dec, bytes, extOf(file.name));
      const p = at || { x: view.x, y: view.y };
      const ang = i * 2.4, d = i ? 60 + i * 26 : 0;
      const f = W.newFrag(id, 0, rec.dur, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, rng);
      world.objs.push(f); made.push(f); i++;
    } catch (e) {
      toast(`「${file.name}」を読めませんでした。WAV・AIFF・MP3 など、このブラウザで再生できる形式か確かめてください。`, 5000);
    }
  }
  if (made.length) {
    sim.index(); sim.refresh();
    select(made.map(f => f.id));
    commit();
    renderLibrary();
    toast(made.length === 1 ? `「${srcs.get(made[0].src).name}」を断片として置きました。` : `${made.length} 個の音を断片として置きました。`);
  }
  updateEmpty();
}

// ---------- synthesized trial sounds (only when asked) ----------
function synthSounds(sr) {
  const S_ = [], mk = (name, sec, fn) => { const n = Math.round(sec * sr), L = new Float32Array(n), R = new Float32Array(n); fn(L, R, n); S_.push({ name, ch: [L, R] }); };
  const rnd = C.makeRng(9);
  mk('鐘', 2.6, (L, R, n) => { const ps = [[1, 1, 1.4], [2.76, 0.5, 0.9], [5.4, 0.3, 0.5], [8.93, 0.18, 0.3], [2.0, 0.25, 1.1]]; for (let i = 0; i < n; i++) { const t = i / sr; let v = 0; for (const [m, a, d] of ps) v += a * Math.sin(2 * Math.PI * 392 * m * t) * Math.exp(-t / d); v *= 0.32 * Math.min(1, t / 0.002); L[i] = v; R[i] = v * 0.94; } });
  mk('木', 0.42, (L, R, n) => { let y1 = 0, y2 = 0, z1 = 0, z2 = 0; const f1 = 640, f2 = 1720; const c1 = 2 * Math.exp(-90 / sr * 6) * Math.cos(2 * Math.PI * f1 / sr), c2 = 2 * Math.exp(-120 / sr * 6) * Math.cos(2 * Math.PI * f2 / sr); for (let i = 0; i < n; i++) { const x = i < sr * 0.004 ? (rnd() * 2 - 1) : 0; const y = x + c1 * y1 - Math.exp(-90 / sr * 12) * y2; y2 = y1; y1 = y; const z = x + c2 * z1 - Math.exp(-120 / sr * 12) * z2; z2 = z1; z1 = z; const v = (y * 0.06 + z * 0.035) * Math.exp(-i / sr * 9); L[i] = v; R[i] = v; } });
  mk('声', 2.8, (L, R, n) => { let ph = 0; const fm = [[700, 80], [1220, 90], [2600, 120]], st = fm.map(() => [0, 0]); for (let i = 0; i < n; i++) { const t = i / sr, f0 = 130 * (1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t)); ph += f0 / sr; ph -= Math.floor(ph); const x = (ph * 2 - 1) * 0.4; let v = 0; fm.forEach(([f, bw], k) => { const r = Math.exp(-Math.PI * bw / sr), c = 2 * r * Math.cos(2 * Math.PI * f / sr), s = st[k]; const y = (1 - r) * x + c * s[0] - r * r * s[1]; s[1] = s[0]; s[0] = y; v += y / (k + 1); }); const e = Math.min(1, t / 0.25) * Math.min(1, (2.8 - t) / 0.4); L[i] = v * e * 0.9; R[i] = v * e * 0.8; } });
  mk('硝子', 1.5, (L, R, n) => { const fs = [1860, 2310, 2951, 3720, 4410]; for (let i = 0; i < n; i++) { const t = i / sr; let a = 0, b = 0; fs.forEach((f, k) => { const e = Math.exp(-t * (2 + k)); a += Math.sin(2 * Math.PI * f * t) * e; b += Math.sin(2 * Math.PI * (f + 3) * t) * e; }); L[i] = a * 0.08 * Math.min(1, t / 0.001); R[i] = b * 0.08 * Math.min(1, t / 0.001); } });
  mk('弦', 2.0, (L, R, n) => { const p = Math.round(sr / 98), buf = new Float32Array(p); for (let i = 0; i < p; i++) buf[i] = rnd() * 2 - 1; let k = 0; for (let i = 0; i < n; i++) { const a = buf[k], b = buf[(k + 1) % p]; buf[k] = (a + b) * 0.5 * 0.996; L[i] = a * 0.45; R[i] = a * 0.42; k = (k + 1) % p; } });
  mk('雨', 4.0, (L, R, n) => { let lp = 0; for (let i = 0; i < n; i++) { lp += 0.08 * ((rnd() * 2 - 1) - lp); L[i] = lp * 0.18; R[i] = lp * 0.16; } for (let j = 0; j < 140; j++) { const at = Math.floor(rnd() * (n - 2000)), amp = 0.08 + rnd() * 0.3, f = 2000 + rnd() * 5000, pan = rnd(); for (let i = 0; i < 1600; i++) { const v = Math.sin(2 * Math.PI * f * i / sr) * amp * Math.exp(-i / 140); L[at + i] += v * (1 - pan); R[at + i] += v * pan; } } });
  mk('和音', 3.6, (L, R, n) => { const fs = [146.8, 174.6, 220, 261.6, 329.6]; for (let i = 0; i < n; i++) { const t = i / sr, e = Math.min(1, t / 0.9) * Math.min(1, (3.6 - t) / 0.8); let a = 0, b = 0; fs.forEach((f, k) => { a += Math.sin(2 * Math.PI * f * t + k) * (1 / (k + 1.5)); b += Math.sin(2 * Math.PI * f * 1.003 * t + k * 2) * (1 / (k + 1.5)); }); L[i] = a * e * 0.22; R[i] = b * e * 0.22; } });
  mk('拍', 0.55, (L, R, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr, f = 45 + 95 * Math.exp(-t * 28); ph += f / sr; const v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7) * 0.8 + (i < 90 ? (rnd() * 2 - 1) * 0.2 : 0); L[i] = v; R[i] = v; } });
  return S_;
}
function addSynth() {
  ensureCtx();
  const sr = ctx.sampleRate, list = synthSounds(sr), rng = C.makeRng(randSeed()), made = [];
  // spots near what is already in the world, so the first press already sounds
  const rail = sim.rails[0], rip = sim.ripples[0], room = sim.rooms[0];
  const spots = [];
  if (rail) for (let k = 0; k < 5; k++) { const L = C.railGeom(rail).L, p = C.railPoint(rail, (k + 0.3) / 5 * L); spots.push({ x: p.x + (rng() - 0.5) * 50, y: p.y + (rng() - 0.5) * 50 }); }
  if (rip) for (let k = 0; k < 4; k++) { const a = rng() * C.TAU, d = 120 + rng() * 300; spots.push({ x: rip.x + Math.cos(a) * d, y: rip.y + Math.sin(a) * d }); }
  if (room) for (let k = 0; k < 3; k++) spots.push({ x: room.x + (rng() - 0.5) * room.w * 0.7, y: room.y + (rng() - 0.5) * room.h * 0.6 });
  while (spots.length < 12) spots.push({ x: (rng() - 0.5) * 1400, y: (rng() - 0.5) * 900 });
  let j = 0;
  list.forEach((s, i) => {
    const id = C.uid('a'), bytes = K.encodeWav(s.ch, sr, 16);
    const rec = registerSource(id, s.name, { sr, ch: s.ch }, bytes, 'wav');
    const n = i < 4 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const sp = j < spots.length ? spots[j] : { x: (rng() - 0.5) * 1400, y: (rng() - 0.5) * 900 }; j++;
      const f = W.newFrag(id, 0, rec.dur, sp.x, sp.y, rng);
      if (s.name === '雨' || s.name === '和音') { f.mode = k === 0 && s.name === '和音' ? 'loop' : 'hit'; f.p.vol = -10; }
      if (s.name === '声' && k === 1) f.mode = 'tape';
      world.objs.push(f); made.push(f);
    }
  });
  sim.index(); sim.refresh();
  commit(); renderLibrary(); updateEmpty();
  select(made.map(f => f.id));
  toast('合成した 8 つの音を、線路・波紋・部屋のまわりに置きました。▶ で動かしてください。', 4500);
}

// ---------- history ----------
const H = { stack: [], i: -1 };
const snap = () => JSON.stringify(world);
function commit() {
  const s = snap();
  if (H.stack[H.i] === s) return;
  H.stack.length = H.i + 1; H.stack.push(s);
  if (H.stack.length > 160) H.stack.shift();
  H.i = H.stack.length - 1;
  updateUndo(); scheduleAutosave();
}
function restore(json, keepSel = true) {
  const w = JSON.parse(json);
  world = w; sim.w = w; sim.index(); sim.refresh();
  if (eng) eng.setWorld(w);
  if (keepSel) S.sel = new Set([...S.sel].filter(id => sim.byId.has(id))); else S.sel.clear();
  syncTopBar(); renderInspector(); renderLaws(); renderLibrary(); updateEmpty();
}
function undo() { if (H.i <= 0) return; H.i--; restore(H.stack[H.i]); updateUndo(); scheduleAutosave(); toast('取り消しました。', 1200); }
function redo() { if (H.i >= H.stack.length - 1) return; H.i++; restore(H.stack[H.i]); updateUndo(); scheduleAutosave(); toast('やり直しました。', 1200); }
function updateUndo() { $('undo').disabled = H.i <= 0; $('redo').disabled = H.i >= H.stack.length - 1; }

// ---------- objects ----------
function addObj(o, sel = true) { world.objs.push(o); sim.index(); sim.refresh(); if (eng && o.kind === 'room') eng.syncRooms(); if (sel) select([o.id]); updateEmpty(); return o; }
function removeIds(ids) {
  const kill = new Set(ids);
  // rails take their trains, fragments their threads
  for (const o of world.objs) {
    if (o.kind === 'train' && kill.has(o.rail)) kill.add(o.id);
    if (o.kind === 'thread' && (kill.has(o.a) || kill.has(o.b))) kill.add(o.id);
  }
  world.objs = world.objs.filter(o => !kill.has(o.id));
  sim.w = world; sim.index(); sim.refresh(); if (eng) eng.syncRooms();
  for (const id of kill) S.sel.delete(id);
  renderInspector(); updateEmpty();
}
function cloneObj(o, dx = 40, dy = 40) {
  const c = C.deepClone(o);
  c.id = C.uid(o.id[0]);
  if ('x' in c) { c.x += dx; c.y += dy; }
  if (c.kind === 'rail') c.pts = c.pts.map(([x, y]) => [x + dx, y + dy]);
  if (c.kind === 'frag' || c.kind === 'thing') c.group = null;
  return c;
}
function duplicateSel() {
  const ids = [...S.sel], map = new Map(), out = [];
  for (const id of ids) {
    const o = sim.byId.get(id); if (!o || o.kind === 'thread') continue;
    const c = cloneObj(o); map.set(o.id, c.id); out.push(c);
  }
  // keep trains on duplicated rails, threads between duplicated fragments
  for (const c of out) if (c.kind === 'train' && map.has(c.rail)) c.rail = map.get(c.rail);
  for (const o of world.objs) if (o.kind === 'thread' && map.has(o.a) && map.has(o.b)) { const t = cloneObj(o); t.a = map.get(o.a); t.b = map.get(o.b); out.push(t); }
  world.objs.push(...out); sim.index(); sim.refresh(); if (eng) eng.syncRooms();
  select(out.map(o => o.id)); commit();
  return out;
}
function select(ids, add = false) {
  if (!add) S.sel.clear();
  for (const id of ids) {
    const o = sim.byId.get(id); if (!o) continue;
    if (o.group) for (const p of world.objs) if (p.group === o.group) S.sel.add(p.id);
    S.sel.add(id);
  }
  renderInspector();
}
const selObjs = () => [...S.sel].map(id => sim.byId.get(id)).filter(Boolean);

// split / slice / extract: new fragments inherit everything but get their own look
function variantSkin(sk, rng) { const s = C.deepClone(sk); s.hue = (s.hue + Math.round((rng() - 0.5) * 50) + 360) % 360; s.seed = Math.floor(rng() * 1e6); s.sides = C.clamp(s.sides + Math.round((rng() - 0.5) * 3), 3, 9); return s; }
function piecesOf(f, cuts) {
  const rng = C.makeRng(randSeed()), bounds = [f.a, ...cuts.filter(t => t > f.a + 0.01 && t < f.b - 0.01).sort((a, b) => a - b), f.b];
  const n = bounds.length - 1, out = [];
  const ca = Math.cos(f.ang), sa = Math.sin(f.ang), sp = Math.max(f.r * 1.5, 46);
  for (let i = 0; i < n; i++) {
    const g = C.deepClone(f);
    g.id = C.uid('f'); g.a = bounds[i]; g.b = bounds[i + 1]; g.group = null;
    const off = (i - (n - 1) / 2) * sp;
    g.x = f.x + ca * off; g.y = f.y + sa * off;
    g.r = Math.round(C.clamp(f.r * (0.55 + 0.45 * Math.sqrt((g.b - g.a) / (f.b - f.a))), 12, 200));
    g.skin = i ? variantSkin(f.skin, rng) : f.skin;
    out.push(g);
  }
  return out;
}
function replaceWithPieces(f, cuts) {
  const ps = piecesOf(f, cuts);
  if (ps.length < 2) { toast('切る位置が断片の外です。'); return; }
  const i = world.objs.indexOf(f);
  world.objs.splice(i, 1, ...ps);
  // threads that pointed at the whole now point at the first piece / leave from the last
  for (const o of world.objs) if (o.kind === 'thread') { if (o.a === f.id) o.a = ps[ps.length - 1].id; if (o.b === f.id) o.b = ps[0].id; }
  sim.index(); sim.refresh(); select(ps.map(p => p.id)); commit();
  toast(`${ps.length} つに分けました。`);
}
function sliceByOnsets(f) {
  const src = srcs.get(f.src); if (!src) return;
  let cuts = K.onsets(src.mono, src.sr, f.a, f.b, 24).filter(t => t > f.a + 0.03);
  if (cuts.length < 1) { const n = 4; cuts = []; for (let i = 1; i < n; i++) cuts.push(f.a + (f.b - f.a) * i / n); toast('はっきりした切れ目がないので 4 等分しました。'); }
  replaceWithPieces(f, cuts);
}
function extract(f, s0, s1) {
  const g = C.deepClone(f); g.id = C.uid('f'); g.a = s0; g.b = s1; g.group = null;
  const rng = C.makeRng(randSeed());
  g.skin = variantSkin(f.skin, rng);
  g.x = f.x + f.r * 2.2; g.y = f.y + f.r * 0.6;
  g.r = Math.round(C.clamp(f.r * 0.8, 12, 200));
  addObj(g); commit();
  toast('選んだ範囲を新しい断片にしました。');
}
function scatterSource(id) {
  const src = srcs.get(id); if (!src) return;
  const rng = C.makeRng(randSeed());
  let cuts = K.onsets(src.mono, src.sr, 0, src.dur, 16);
  if (cuts.length < 2) { cuts = []; const n = Math.min(8, Math.max(2, Math.round(src.dur / 0.6))); for (let i = 1; i < n; i++) cuts.push(src.dur * i / n); }
  const b = [0, ...cuts.filter(t => t > 0.03 && t < src.dur - 0.03), src.dur], made = [];
  for (let i = 0; i < b.length - 1; i++) {
    const a = rng() * C.TAU, d = Math.sqrt(rng()) * 280;
    const f = W.newFrag(id, b[i], b[i + 1], view.x + Math.cos(a) * d, view.y + Math.sin(a) * d * 0.8, rng);
    world.objs.push(f); made.push(f);
  }
  sim.index(); sim.refresh(); select(made.map(f => f.id)); commit(); updateEmpty();
  toast(`「${src.name}」を ${made.length} 片に刻んで撒きました。`);
}
function removeSource(id) {
  const name = srcs.get(id)?.name || '';
  world.sources = world.sources.filter(s => s.id !== id);
  removeIds(world.objs.filter(o => o.kind === 'frag' && o.src === id).map(o => o.id));
  sim.index(); commit(); renderLibrary();
  toast(`「${name}」とその断片を片づけました（取り消せます）。`);
}

// arrangements of a selection
function arrange(kind) {
  const os = selObjs().filter(o => o.kind === 'frag' || o.kind === 'thing');
  if (os.length < 2) { toast('二つ以上の断片を選んでください。'); return; }
  const cx = os.reduce((a, o) => a + o.x, 0) / os.length, cy = os.reduce((a, o) => a + o.y, 0) / os.length;
  const rAvg = os.reduce((a, o) => a + o.r, 0) / os.length;
  if (kind === 'circle') {
    const R = Math.max(90, os.length * rAvg * 0.55);
    os.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    os.forEach((o, i) => { const a = i / os.length * C.TAU - Math.PI / 2; o.x = cx + Math.cos(a) * R; o.y = cy + Math.sin(a) * R; });
  } else if (kind === 'line') {
    os.sort((a, b) => a.x - b.x);
    const sp = rAvg * 2.4, x0 = cx - (os.length - 1) * sp / 2;
    os.forEach((o, i) => { o.x = x0 + i * sp; o.y = cy; });
  } else if (kind === 'scatter') {
    const R = Math.max(150, Math.sqrt(os.length) * rAvg * 3);
    os.forEach(o => { const a = Math.random() * C.TAU, d = Math.sqrt(Math.random()) * R; o.x = cx + Math.cos(a) * d; o.y = cy + Math.sin(a) * d; });
  } else if (kind === 'shuffle') {
    const pos = os.map(o => [o.x, o.y]);
    for (let i = pos.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pos[i], pos[j]] = [pos[j], pos[i]]; }
    os.forEach((o, i) => { o.x = pos[i][0]; o.y = pos[i][1]; });
  } else if (kind === 'shake') {
    os.forEach(o => { o.x += (Math.random() - 0.5) * 90; o.y += (Math.random() - 0.5) * 90; o.ang += (Math.random() - 0.5) * 0.8; });
  } else if (kind === 'skins') {
    const rng = C.makeRng(randSeed()); os.forEach(o => { o.skin = W.randomSkin(rng); });
  }
  sim.refresh(); commit();
}
function groupSel(on) {
  const os = selObjs().filter(o => o.kind === 'frag' || o.kind === 'thing');
  const g = on ? C.uid('g') : null;
  os.forEach(o => { o.group = g; });
  commit(); renderInspector();
  toast(on ? `${os.length} 個をまとめました。一つを掴むと全部動きます。` : 'まとまりをほどきました。');
}

// ---------- transport ----------
async function play() {
  await ensureAudio();
  if (S.playing) return;
  eng.syncRooms(); eng.syncMaster();
  S.t0 = ctx.currentTime - sim.T + 0.03;
  S.playing = true; S.lastCtl = 0;
  $('play').setAttribute('aria-pressed', 'true'); $('play').title = '一時停止（Space）';
  pump();
}
function pause() {
  if (!S.playing) return;
  S.playing = false; S.T = ctx.currentTime - S.t0;
  eng.hush(ctx.currentTime);
  $('play').setAttribute('aria-pressed', 'false'); $('play').title = '再生（Space）';
}
function rewind() {
  const was = S.playing; if (was) pause();
  sim.reset(); S.T = 0; S.flashes.clear();
  if (was) play();
}
function togglePlay() { S.playing ? pause() : play(); }
function noteFlash(id, at, silent) {
  let a = S.flashes.get(id); if (!a) { a = []; S.flashes.set(id, a); }
  a.push({ at, silent }); if (a.length > 6) a.shift();
}
function pump() {
  if (!S.playing || !ctx) return;
  const now = ctx.currentTime;
  const behind = (now - S.t0) - sim.T;
  if (behind > 0.35) S.t0 += behind;              // the page slept: let the world wait instead of rushing
  const horizon = now - S.t0 + LOOK;
  let n = 0;
  while (sim.T < horizon && n < 200) {
    const evs = sim.step(W.DT); n++;
    for (const e of evs) { eng.handle(e, e.t + S.t0); noteFlash(e.id, e.t + S.t0, e.silent); }
    for (const c of sim.contacts) { eng.contact(c, c.t + S.t0); if (!(sim.steps % 6)) noteFlash(c.id, c.t + S.t0, false); }
  }
  if (sim.mutated) { sim.mutated = 0; scheduleAutosave(); }
  eng.advance(horizon + S.t0);
  if (now - S.lastCtl > 0.033) { eng.controlLoops(sim.loopStates(), now + 0.005); S.lastCtl = now; }
}
setInterval(pump, 20);

// a touch from the person
function touchFrag(f, energy) {
  ensureAudio();
  const T = S.playing ? ctx.currentTime - S.t0 : sim.T;
  const at = ctx.currentTime + 0.012;
  if (f.mode === 'loop' && S.playing) { const e = sim.manual(f.id, energy, T); if (e) { eng.handle(e, at); noteFlash(f.id, at, e.silent); } return; }
  const e = sim.manual(f.id, energy, T);
  if (!e) return;
  e.loop = false;
  eng.handle(e, at); noteFlash(f.id, at, e.silent);
}
function touchTape(f, x, y, vx, vy) {
  ensureAudio();
  const T = S.playing ? ctx.currentTime - S.t0 : sim.T;
  const c = sim.touchTape(f.id, x, y, vx, vy, T); if (!c) return;
  const at = ctx.currentTime + 0.012;
  eng.contact(c, at); eng.advance(at + 0.05); noteFlash(f.id, at, false);
}

// ---------- files out ----------
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
async function deliver(name, bytes, mime) {
  if (inViewer) {
    const dl = await window.claude.use('downloads');
    if (!dl) throw new Error('この表示ではファイルを保存できません。');
    let fname = name, data = bytes;
    if (!/\.(zip|json)$/i.test(name)) { fname = name.replace(/\.[^.]+$/, '') + '.zip'; data = K.zipStore([{ name, data: bytes }]); }
    try { await dl.save({ filename: fname, data: new Blob([data]) }); return fname === name ? `${name} を保存しました。` : `${fname} を保存しました（中に ${name} が入っています）。`; }
    catch (e) { const c = e && e.code; if (c === 'declined') return '保存をやめました。'; if (c === 'rate_limited') throw new Error('保存の確認がまだ開いています。閉じてからもう一度押してください。'); throw new Error('この表示ではファイルを保存できません。'); }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return `${name} を書き出しました。`;
}

// project = ZIP: sawari.json + the original audio files
function projectJson() { return JSON.stringify({ app: 'sawari', v: 1, world, scenes: S.scenes }); }
async function saveProject() {
  const entries = [{ name: 'sawari.json', data: K.encText(projectJson()) }];
  for (const s of world.sources) { const f = srcFiles.get(s.id); if (f) entries.push({ name: `audio/${s.id}.${f.ext}`, data: f.bytes }); }
  try { toast(await deliver(`sawari-${stamp()}.zip`, K.zipStore(entries), 'application/zip')); } catch (e) { toast(e.message, 5000); }
}
async function loadProjectData(json, files) {
  const doc = JSON.parse(json);
  if (!doc.world || !Array.isArray(doc.world.objs)) throw new Error('bad');
  let missing = 0;
  for (const s of doc.world.sources) {
    if (srcs.has(s.id)) continue;
    const key = [...files.keys()].find(k => k.startsWith(`audio/${s.id}.`));
    if (!key) { missing++; continue; }
    const bytes = files.get(key);
    try { const dec = await decodeBytes(bytes); registerSource(s.id, s.name, dec, bytes, extOf(key)); } catch (e) { missing++; }
  }
  if (S.playing) pause();
  S.scenes = Array.isArray(doc.scenes) ? doc.scenes.concat([null, null, null, null, null, null]).slice(0, 6) : [null, null, null, null, null, null];
  restore(JSON.stringify(doc.world), false);
  sim.reset(); commit(); renderScenes(); fitView();
  return missing;
}
async function openProject(file) {
  try {
    const buf = await file.arrayBuffer();
    let json, files = new Map();
    if (/\.json$/i.test(file.name)) json = K.decText(new Uint8Array(buf));
    else { files = await K.unzip(buf); const j = files.get('sawari.json'); if (!j) throw new Error('no json'); json = K.decText(j); }
    const missing = await loadProjectData(json, files);
    toast(missing ? `開きました。${missing} 個の音が見つかりませんでした。` : `「${file.name}」を開きました。`);
  } catch (e) { toast('このファイルは Sawari のプロジェクトとして開けませんでした。', 5000); }
}
function newWorld() {
  if (S.playing) pause();
  const w = W.newWorld(randSeed());
  w.sources = world.sources.slice();
  restore(JSON.stringify(w), false); sim.reset(); commit(); fitView();
  toast('新しい世界にしました。読み込んだ音は「素材」に残っています。取り消しで戻せます。', 4500);
}

// ---------- autosave (IndexedDB, this browser only) ----------
let idbP = null;
function idb() {
  if (idbP) return idbP;
  idbP = new Promise((res) => {
    try {
      const rq = indexedDB.open('sawari', 1);
      rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore('kv'); d.createObjectStore('src'); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return idbP;
}
async function idbDo(store, mode, fn) {
  const d = await idb(); if (!d) return null;
  return new Promise(res => { try { const tx = d.transaction(store, mode), st = tx.objectStore(store), r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => res(null); } catch (e) { res(null); } });
}
const idbPutSource = (id, v) => idbDo('src', 'readwrite', st => st.put(v, id));
let autoTimer = 0;
function scheduleAutosave() { clearTimeout(autoTimer); autoTimer = setTimeout(() => idbDo('kv', 'readwrite', st => st.put(projectJson(), 'project')), 1200); }
async function restoreAutosave() {
  const json = await idbDo('kv', 'readonly', st => st.get('project'));
  if (!json) return false;
  try {
    const doc = JSON.parse(json), files = new Map();
    for (const s of doc.world.sources) { const v = await idbDo('src', 'readonly', st => st.get(s.id)); if (v) files.set(`audio/${s.id}.${v.ext}`, v.bytes); }
    const missing = await loadProjectData(json, files);
    H.stack = [snap()]; H.i = 0; updateUndo();
    toast(missing ? '前回の続きを開きました（一部の音は見つかりませんでした）。' : '前回の続きを開きました。', 3000);
    return true;
  } catch (e) { return false; }
}

// ---------- export (offline, from the beginning, repeatable) ----------
async function exportWav(seconds, asSource) {
  if (S.busy) return;
  if (!world.sources.length) { toast('まだ音がありません。音声ファイルを置いてから書き出してください。'); return; }
  ensureCtx();
  S.busy = true; $('exportGo').disabled = true;
  const prog = $('exportProg');
  try {
    const sr = ctx.sampleRate, tail = 3, total = Math.ceil((seconds + tail) * sr);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oc = new OAC(2, total, sr);
    const w2 = C.deepClone(world), sim2 = new W.Sim(w2);
    const e2 = new A.Engine(oc, w2, { srcs, offline: true, find: id => sim2.byId.get(id) });
    let lastCtl = -1, ended = false;
    const adv = until => {
      const stopAt = seconds, u = Math.min(until, stopAt);
      while (sim2.T < u) {
        const evs = sim2.step(W.DT);
        for (const e of evs) if (e.t < stopAt) e2.handle(e, e.t);
        for (const c of sim2.contacts) e2.contact(c, c.t);
        if (sim2.T - lastCtl >= 0.03) { e2.controlLoops(sim2.loopStates(), sim2.T); lastCtl = sim2.T; }
      }
      if (until >= stopAt && !ended) { ended = true; e2.controlLoops([], stopAt); }
      e2.advance(u + 0.02);
    };
    const CH = 1;
    if (typeof oc.suspend === 'function') {
      adv(CH + 0.3);
      const next = k => { if (k * CH >= seconds + tail - 0.05) return; oc.suspend(k * CH).then(() => { adv((k + 1) * CH + 0.3); prog.textContent = `${Math.round(k * CH / (seconds + tail) * 100)}%`; next(k + 1); oc.resume(); }); };
      next(1);
    } else adv(seconds + 0.5);
    const buf = await oc.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    // trim the silent end of the tail
    let end = L.length; while (end > seconds * sr && Math.abs(L[end - 1]) < 1e-4 && Math.abs(R[end - 1]) < 1e-4) end--;
    const l2 = L.slice(0, end), r2 = R.slice(0, end);
    const bytes = K.encodeWav([l2, r2], sr, 24);
    prog.textContent = '';
    if (asSource) {
      const id = C.uid('a'), name = `書き出し ${world.seed} ${seconds}s`;
      const rec = registerSource(id, name, { sr, ch: [l2, r2] }, K.encodeWav([l2, r2], sr, 16), 'wav');
      const f = W.newFrag(id, 0, rec.dur, view.x, view.y, C.makeRng(randSeed())); f.skin.type = 'strip'; f.mode = 'tape'; f.r = 90;
      addObj(f); commit(); renderLibrary();
    }
    toast(await deliver(`sawari-${world.seed}-${seconds}s.wav`, bytes, 'audio/wav'), 5000);
  } catch (e) { toast(e && e.message ? `書き出せませんでした：${e.message}` : '書き出せませんでした。', 6000); }
  S.busy = false; $('exportGo').disabled = false;
}

// ---------- live recording (what you actually play) ----------
const REC_SRC = `class SawariRec extends AudioWorkletProcessor{constructor(){super();this.on=true;this.n=0;this.L=new Float32Array(8192);this.R=new Float32Array(8192);this.port.onmessage=e=>{if(e.data==='stop'){this.flush();this.on=false;this.port.postMessage('done')}}}
flush(){if(this.n){this.port.postMessage([this.L.slice(0,this.n),this.R.slice(0,this.n)]);this.n=0}}
process(ins,outs){const i=ins[0];if(i&&i.length){const l=i[0],r=i[1]||i[0];for(let k=0;k<l.length;k++){this.L[this.n]=l[k];this.R[this.n]=r[k];this.n++;if(this.n===8192)this.flush()}}return this.on}}
registerProcessor('sawari-rec',SawariRec);`;
let recState = null;
async function toggleRec() {
  await ensureAudio();
  if (recState) { stopRec(); return; }
  const chunks = [], sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
  let node;
  try {
    if (!ctx.audioWorklet) throw new Error('no worklet');
    if (!S.recLoaded) { const url = URL.createObjectURL(new Blob([REC_SRC], { type: 'application/javascript' })); await ctx.audioWorklet.addModule(url); S.recLoaded = true; }
    node = new AudioWorkletNode(ctx, 'sawari-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    node.port.onmessage = e => { if (e.data === 'done') finishRec(); else chunks.push(e.data); };
  } catch (e) {
    node = ctx.createScriptProcessor(4096, 2, 2);
    node.onaudioprocess = ev => { const b = ev.inputBuffer; chunks.push([b.getChannelData(0).slice(), (b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)).slice()]); };
  }
  eng.lim.connect(node); node.connect(sink);
  recState = { node, sink, chunks, t: performance.now() };
  $('rec').setAttribute('aria-pressed', 'true'); $('recLabel').textContent = '0:00';
  recState.tick = setInterval(() => { const s = Math.floor((performance.now() - recState.t) / 1000); $('recLabel').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
  if (!S.playing) play();
  toast('録音しています。もう一度押すと止めて WAV にします。');
}
function stopRec() {
  if (!recState) return;
  clearInterval(recState.tick);
  if (recState.node.port) recState.node.port.postMessage('stop'); else finishRec();
}
async function finishRec() {
  const r = recState; if (!r) return; recState = null;
  try { eng.lim.disconnect(r.node); } catch (e) {}
  try { r.node.disconnect(); r.sink.disconnect(); } catch (e) {}
  $('rec').setAttribute('aria-pressed', 'false'); $('recLabel').textContent = '録音';
  const n = r.chunks.reduce((a, c) => a + c[0].length, 0);
  if (!n) { toast('録音は空でした。'); return; }
  const L = new Float32Array(n), R = new Float32Array(n); let o = 0;
  for (const [l, rr] of r.chunks) { L.set(l, o); R.set(rr, o); o += l.length; }
  try { toast(await deliver(`sawari-rec-${stamp()}.wav`, K.encodeWav([L, R], ctx.sampleRate, 24), 'audio/wav'), 5000); } catch (e) { toast(e.message, 5000); }
}
