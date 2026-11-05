// ---------------------------------------------------------------------------
// The app: palette, tools, fingers, settings, saving.
// ---------------------------------------------------------------------------
(() => {
const $ = id => document.getElementById(id);
const inViewer = !!(window.claude && typeof window.claude.use === 'function');
const store = {
  get(k, d) { try { const v = localStorage.getItem('tokimaze:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tokimaze:' + k, JSON.stringify(v)); } catch (e) {} },
};

// ---- colour sets ------------------------------------------------------------
const SETS = [
  { name: '絵具箱', colors: [['白', '#F2F0EA', 0.9], ['レモン', '#F6D21A', 1], ['朱', '#E4462A', 1.1], ['紅', '#C2185B', 1.25], ['群青', '#23389C', 1.2], ['ターコイズ', '#00897E', 1.2], ['黄土', '#C88B2E', 0.95], ['黒', '#141414', 1]] },
  { name: '三原色', colors: [['シアン', '#00A0E0', 1.1], ['マゼンタ', '#E4007F', 1.1], ['イエロー', '#FFE100', 1], ['白', '#FFFFFF', 0.9], ['黒', '#111111', 1]] },
  { name: '夜の色', colors: [['桃', '#FF2D8A', 1], ['電気の青', '#2F5BFF', 1.1], ['ライム', '#A8F02A', 1], ['橙', '#FF7A00', 1], ['菫', '#8A2BE2', 1.15], ['水色', '#2FD8F5', 1], ['白', '#FFFFFF', 0.85]] },
  { name: '岩絵具', colors: [['群青', '#1F3C88', 1.1], ['緑青', '#1B7F5C', 1.1], ['辰砂', '#C1352D', 1.1], ['石黄', '#E8B520', 1], ['紫水晶', '#7B4A9E', 1.1], ['胡粉', '#F4F0E6', 0.9], ['墨', '#1A1A1A', 1]] },
];
const SPECIAL = [
  { kind: 'water', name: '水', cls: 'water' },
  { kind: 'ferro', name: '磁性流体', cls: 'ferro' },
  { kind: 'mica', name: 'ラメ', cls: 'mica' },
];
const ICONS = {
  paint: '<path d="M12 3c3.5 4.6 5.5 7.8 5.5 10.3A5.5 5.5 0 0 1 6.5 13.3C6.5 10.8 8.5 7.6 12 3z"/><path d="M9.6 14.2a2.6 2.6 0 0 0 2.4 2.3"/>',
  stir: '<path d="M4 12c2-4 5-6 8-6s6 2.5 6 6-3 5-5.5 5S9 15.5 9 13.5 10.5 10.5 12.5 10.5"/>',
  comb: '<path d="M4 6h16"/><path d="M6 6v12M9.2 6v12M12.4 6v12M15.6 6v12M18.8 6v12"/>',
  alcohol: '<path d="M12 12l0 0"/><path d="M12 12l-6-4M12 12l7-3M12 12l-2 8M12 12l6 6M12 12l-7 4"/><path d="M6 8l-2-3M6 8L3 9M19 9l2-3M18 18l1 3M18 18l3 0M5 16l-2 2"/>',
  bubble: '<circle cx="9" cy="10" r="5"/><circle cx="16.5" cy="15" r="3.5"/><circle cx="16" cy="6" r="1.8"/><path d="M6.5 8.2a3 3 0 0 1 2.2-1.6"/>',
  ice: '<path d="M5 8.5L12 5l7 3.5v7L12 19l-7-3.5z"/><path d="M5 8.5L12 12l7-3.5M12 12v7"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h3M15 8h3"/><path d="M9 4v8a3 3 0 0 0 6 0V4"/>',
};

// ---- engine ------------------------------------------------------------------
const cv = $('cv');
let liq;
try { liq = new Liquid(cv); }
catch (e) {
  $('fail').hidden = false;
  if (String(e.message).startsWith('shader') || String(e.message).startsWith('link')) $('failMsg').textContent = '描画の準備に失敗しました：' + e.message.slice(0, 160);
  console.error(e);
  return;
}
const world = new World(liq);

const app = {
  liq, world,
  tool: store.get('tool', 'paint'),
  set: Math.min(SETS.length - 1, store.get('set', 0)),
  custom: store.get('custom', []),
  sel: store.get('sel', 'c:4'),
  size: 1,
  ferroUsed: false,
  swatches: [],
  colorSwatches() { return this.swatches.filter(s => s.kind === 'paint'); },
  waterSwatch() { return { kind: 'water' }; },
  ferroSwatch() { return { kind: 'ferro' }; },
  focusOn(x, y) { liq.focusT = [x / liq.aspect, y]; },
  current() { return this.swatches.find(s => s.id === this.sel) || this.swatches[0]; },
  // amt is paint thickness added at the centre; the puddle then levels out by itself
  drop(s, amt, r, dt = 0) {
    const sw = s.swatch, R = r * s.size, p = [s.x, s.y];
    // the push spreads the puddle (pressure-solved, so the paint is conserved); amount keeps it ~1 thick
    const push = dt ? 4.5 * dt : 1.1;
    if (sw.kind === 'paint') liq.splatPaint(p, p, R, sw.pig, amt, [0, push, 0, 0], 1);
    else if (sw.kind === 'water') liq.splatPaint(p, p, R, null, 0, [0, dt ? 4 * dt : 1.4, 0, 0], 0.7);
    else if (sw.kind === 'ferro') { liq.splatPaint(p, p, R * 0.75, null, 0, [0, 0, Math.min(amt, 1.2) * 0.9, 0], 0.9); this.ferroUsed = true; }
    else if (sw.kind === 'mica') liq.splatPaint(p, p, R, null, 0, [0, push, 0, amt * 0.8], 0.4);
  },
  trail(s, amt, r) {
    const sw = s.swatch, R = r * s.size, a = [s.px, s.py], b = [s.x, s.y];
    if (sw.kind === 'paint') liq.splatPaint(a, b, R, sw.pig, amt, [0, 0.05 * amt, 0, 0], 0.6);
    else if (sw.kind === 'water') liq.splatPaint(a, b, R, null, 0, [0, 0.8 * amt, 0, 0], 0.5);
    else if (sw.kind === 'ferro') { liq.splatPaint(a, b, R * 0.8, null, 0, [0, 0.05 * amt, amt * 0.9, 0], 0.7); this.ferroUsed = true; }
    else if (sw.kind === 'mica') liq.splatPaint(a, b, R, null, 0, [0, 0.05 * amt, 0, amt * 0.8], 0.4);
  },
  alcohol(s, amt, r, dt = 0, trail = false) {
    const sw = s.swatch, R = r * s.size, a = trail ? [s.px, s.py] : [s.x, s.y], b = [s.x, s.y];
    const ink = sw.kind === 'paint' ? sw.pig : null;
    const k = this.alcK || 5;
    const push = k * (trail ? 0.6 * amt : (dt ? 3.5 * dt : 1.7));
    liq.splatPaint(a, b, R, ink, ink ? amt * 0.35 : 0, [k * 1.15 * amt, push, sw.kind === 'ferro' ? amt * 0.6 : 0, sw.kind === 'mica' ? amt : 0], 0.95);
  },
};

// ---- palette ----------------------------------------------------------------
function buildSwatches() {
  const set = SETS[app.set];
  const list = set.colors.map(([name, hex, tint], i) => ({ id: 'c:' + i, kind: 'paint', name, hex, tint, pig: KM.pigment(hex, tint) }));
  app.custom.forEach((hex, i) => list.push({ id: 'u:' + i, kind: 'paint', name: '選んだ色', hex, tint: 1, pig: KM.pigment(hex, 1) }));
  SPECIAL.forEach(s => list.push({ id: 's:' + s.kind, ...s }));
  app.swatches = list;
  if (!list.some(s => s.id === app.sel)) app.sel = list[0].id;
}
function renderPalette() {
  buildSwatches();
  $('setLabel').textContent = SETS[app.set].name;
  const pal = $('pal'); pal.textContent = '';
  for (const s of app.swatches) {
    const b = document.createElement('button');
    b.className = 'well' + (s.kind !== 'paint' ? ' special ' + s.cls : '');
    if (s.kind === 'paint') b.style.setProperty('--c', s.hex);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(s.id === app.sel));
    b.setAttribute('aria-label', s.name);
    b.title = s.name;
    b.onclick = () => { app.sel = s.id; store.set('sel', app.sel); renderPalette(); toast(swatchNote(s)); };
    pal.append(b);
  }
  const add = document.createElement('button');
  add.className = 'well add'; add.textContent = '+'; add.title = '色を足す'; add.setAttribute('aria-label', '色を足す');
  add.onclick = () => { const ci = $('colorIn'); try { ci.showPicker ? ci.showPicker() : ci.click(); } catch (e) { ci.click(); } };
  pal.append(add);
}
function swatchNote(s) {
  if (s.kind === 'water') return '水：絵具を押しのけて薄める。アルコールで使うと透明なアルコールになる。';
  if (s.kind === 'ferro') return '磁性流体：水と混ざらない黒い液体。磁石で動かせる。';
  if (s.kind === 'mica') return 'ラメ：流れに乗ってきらめく雲母の粉。';
  const others = app.colorSwatches().filter(o => o.id !== s.id && o.kind === 'paint');
  const o = others.find(c => c.name !== '白' && c.name !== '黒' && c.name !== '胡粉' && c.name !== '墨') || others[0];
  if (!o) return s.name;
  return `${s.name}　—　${o.name}と混ぜると ${KM.mix([[s.hex, 1, s.tint], [o.hex, 1, o.tint]])}`;
}
$('colorIn').addEventListener('change', e => {
  app.custom = [...app.custom, e.target.value].slice(-4);
  store.set('custom', app.custom);
  app.sel = 'u:' + (app.custom.length - 1); store.set('sel', app.sel);
  renderPalette();
});
$('setName').onclick = () => { app.set = (app.set + 1) % SETS.length; store.set('set', app.set); app.sel = 'c:0'; renderPalette(); toast(`色の組：${SETS[app.set].name}`); };

// ---- tools ------------------------------------------------------------------
function renderTools() {
  const box = $('tools'); box.textContent = '';
  for (const k of Object.keys(TOOLS)) {
    const b = document.createElement('button');
    b.className = 'tool'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === app.tool));
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span>${TOOLS[k].name}</span>`;
    b.onclick = () => { app.tool = k; store.set('tool', k); renderTools(); showHint(); };
    box.append(b);
  }
}
let hintTimer = 0;
function showHint() {
  const h = $('hint'); h.textContent = TOOLS[app.tool].hint; h.style.opacity = 1;
  clearTimeout(hintTimer); hintTimer = setTimeout(() => { h.style.opacity = 0.0; }, 6000);
}
$('size').addEventListener('input', e => { app.size = +e.target.value; });

// ---- toast ------------------------------------------------------------------
let toastTimer = 0;
function toast(msg, err = false) {
  const t = $('toast'); t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), err ? 4200 : 2600);
}

// ---- fingers -----------------------------------------------------------------
const strokes = new Map();
function toDomain(e) {
  const r = cv.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width * liq.aspect, 1 - (e.clientY - r.top) / r.height];
}
cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  const [x, y] = toDomain(e);
  const s = { id: e.pointerId, x, y, px: x, py: y, nx: x, ny: y, vx: 0, vy: 0, t: 0, swatch: app.current(), size: app.size, tool: app.tool, cx: e.clientX, cy: e.clientY };
  strokes.set(e.pointerId, s);
  auto.touch();
  app.focusOn(x, y);
  const T = TOOLS[s.tool]; T.begin && T.begin(app, s);
  if (s.tool === 'magnet') placeRing(e.clientX, e.clientY, true);
  if (!hinted) { hinted = true; store.set('hinted', true); }
});
cv.addEventListener('pointermove', e => {
  const s = strokes.get(e.pointerId); if (!s) return;
  const [x, y] = toDomain(e); s.nx = x; s.ny = y; s.cx = e.clientX; s.cy = e.clientY;
  if (s.tool === 'magnet') placeRing(e.clientX, e.clientY, true);
});
function endStroke(e) {
  const s = strokes.get(e.pointerId); if (!s) return;
  strokes.delete(e.pointerId);
  const T = TOOLS[s.tool]; T.end && T.end(app, s);
  if (s.tool === 'magnet') placeRing(0, 0, false);
}
cv.addEventListener('pointerup', endStroke);
cv.addEventListener('pointercancel', endStroke);
cv.addEventListener('lostpointercapture', endStroke);
cv.addEventListener('contextmenu', e => e.preventDefault());
function placeRing(x, y, on) {
  const r = $('ring'); r.hidden = !on;
  if (on) { const b = cv.getBoundingClientRect(); r.style.left = (x - b.left) + 'px'; r.style.top = (y - b.top) + 'px'; }
}
function processStrokes(dt) {
  for (const s of strokes.values()) {
    const T = TOOLS[s.tool];
    s.px = s.x; s.py = s.y; s.x = s.nx; s.y = s.ny; s.t += dt;
    const ivx = (s.x - s.px) / dt, ivy = (s.y - s.py) / dt, k = 1 - Math.exp(-dt * 18);
    s.vx += (ivx - s.vx) * k; s.vy += (ivy - s.vy) * k;
    if (Math.hypot(s.x - s.px, s.y - s.py) > 1e-4) { T.move && T.move(app, s, dt); app.focusOn(s.x, s.y); }
    else { s.vx *= 0.7; s.vy *= 0.7; T.hold && T.hold(app, s, dt); }
  }
}

// ---- auto painter ------------------------------------------------------------
const auto = new AutoPainter(app);
auto.on = store.get('auto', true);
function syncAuto() { $('autoBtn').setAttribute('aria-pressed', String(auto.on)); }
$('autoBtn').onclick = () => { auto.on = !auto.on; store.set('auto', auto.on); syncAuto(); toast(auto.on ? 'ひとりでに：触っていない間、皿がひとりでに描き続けます。' : 'ひとりでに：止めました。'); };
syncAuto();

// ---- settings ----------------------------------------------------------------
const P = liq.params;
const START = {
  dark: { dish: '#050506', fill: null },
  whiteLayer: { dish: '#050506', fill: '#F2F0EA' },
  blackLayer: { dish: '#0b0b0d', fill: '#121212' },
  light: { dish: '#EAE7E1', fill: null },
};
let startMode = store.get('start', 'dark');
if (!START[startMode]) startMode = 'dark';
function segSync(id, v) { for (const b of $(id).children) b.setAttribute('aria-checked', String(b.dataset.v === String(v))); }
$('startSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; startMode = b.dataset.v; store.set('start', startMode); segSync('startSeg', startMode); };
segSync('startSeg', startMode);
let resetArm = 0;
$('resetBtn').onclick = () => {
  const b = $('resetBtn');
  if (!resetArm) { resetArm = setTimeout(() => { resetArm = 0; b.classList.remove('confirm'); b.textContent = 'この状態からやり直す'; }, 3000); b.classList.add('confirm'); b.textContent = 'もう一度押すと今の絵が消えます'; return; }
  clearTimeout(resetArm); resetArm = 0; b.classList.remove('confirm'); b.textContent = 'この状態からやり直す';
  startScene(startMode, false);
  toast('はじめからにしました。');
};
function startScene(mode, seed) {
  const m = START[mode];
  P.dish = KM.lin01(m.dish);
  world.bubbles.forEach(b => b.pop = 1); world.ice.length = 0; app.ferroUsed = false;
  liq.fill(m.fill ? KM.pigment(m.fill, 1) : null, m.fill ? 1.0 : 0, 0.14);
  intro = [];
  if (seed) seedScene();
}
const sliders = {
  sDamp: [v => { P.damp = 0.25 + 2.6 * v; }, v => Math.round(v * 100)],
  sCurl: [v => { P.curl = 30 * v; }, v => Math.round(v * 100)],
  sSpin: [v => { P.spin = v * 2.4; P.spin2 = v * v * 0.55; }, v => v === 0 ? '止' : (v > 0 ? '左' : '右') + Math.round(Math.abs(v) * 100)],
  sBlur: [v => { P.blur = 0.024 * v * v; }, v => Math.round(v * 100)],
  sGloss: [v => { P.gloss = 14 * v; }, v => Math.round(v * 100)],
  sRelief: [v => { P.relief = 0.0045 * v; }, v => Math.round(v * 100)],
};
for (const [id, [fn, fmt]] of Object.entries(sliders)) {
  const el = $(id), out = $('o' + id.slice(1));
  const saved = store.get(id, null); if (saved !== null) el.value = saved;
  const apply = () => { const v = +el.value; fn(v); out.textContent = fmt(v); };
  el.addEventListener('input', () => { apply(); store.set(id, +el.value); });
  apply();
}
function openSheet(on) { $('sheet').hidden = !on; $('setBtn').setAttribute('aria-expanded', String(on)); }
$('setBtn').onclick = () => openSheet($('sheet').hidden);
$('sheetClose').onclick = () => openSheet(false);

// tilt pad
const G = 0.55;
let tilt = [0, 0], motionOn = false;
function setTilt(x, y) {
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  tilt = [x, y];
  $('tiltKnob').style.transform = `translate(${x * 40}px, ${-y * 40}px)`;
  P.grav = [x * G, y * G];
  $('tilt').setAttribute('aria-valuetext', l < 0.02 ? '水平' : `傾き ${Math.round(Math.min(1, l) * 100)}`);
}
(() => {
  const pad = $('tilt'); let drag = false;
  const at = e => { const r = pad.getBoundingClientRect(); setTilt((e.clientX - r.left - r.width / 2) / 40, -(e.clientY - r.top - r.height / 2) / 40); };
  pad.addEventListener('pointerdown', e => { drag = true; pad.setPointerCapture(e.pointerId); at(e); motionOn = false; $('motionChk').checked = false; });
  pad.addEventListener('pointermove', e => { if (drag) at(e); });
  pad.addEventListener('pointerup', () => { drag = false; });
  pad.addEventListener('keydown', e => {
    const d = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[e.key];
    if (d) { e.preventDefault(); setTilt(tilt[0] + d[0], tilt[1] + d[1]); }
  });
})();
$('levelBtn').onclick = () => { setTilt(0, 0); motionOn = false; $('motionChk').checked = false; };
if (window.DeviceOrientationEvent && !inViewer) {
  $('motionWrap').hidden = false;
  $('motionChk').addEventListener('change', async e => {
    if (!e.target.checked) { motionOn = false; setTilt(0, 0); return; }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') throw new Error('denied');
      }
      motionOn = true; toast('スマホを傾けると、絵具が低い方へ流れます。');
    } catch (err) { e.target.checked = false; toast('傾きセンサーを使えませんでした。丸をずらして傾けてください。', true); }
  });
  window.addEventListener('deviceorientation', e => {
    if (!motionOn || e.beta === null) return;
    const rad = Math.PI / 180;
    setTilt(Math.sin((e.gamma || 0) * rad) * 1.6, -Math.sin((e.beta || 0) * rad) * 1.6);
  });
}
setTilt(0, 0);

// quality
let quality = store.get('q', Math.min(screen.width, screen.height) < 600 ? 1 : 2);
segSync('qSeg', quality);
$('qSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; quality = +b.dataset.v; store.set('q', quality); segSync('qSeg', quality); liq.quality = quality; resize(true); };
liq.quality = quality;

// ---- size --------------------------------------------------------------------
function resize() {
  const r = cv.getBoundingClientRect();
  liq.resize(Math.max(1, r.width), Math.max(1, r.height), window.devicePixelRatio || 1);
}
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(resize, 120); });
cv.addEventListener('webglcontextlost', e => { e.preventDefault(); $('fail').hidden = false; $('failMsg').textContent = '描画が止まりました。ページを読み込み直してください。'; });

// ---- saving -------------------------------------------------------------------
function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
async function deliver(name, blob) {
  if (inViewer) {
    const dl = await window.claude.use('downloads');
    if (!dl) throw new Error('この表示ではファイルを保存できません。');
    try { await dl.save({ filename: name, data: blob }); return `${name} を保存しました。`; }
    catch (e) {
      const c = e && e.code;
      if (c === 'declined') return '保存をやめました。';
      if (c === 'rate_limited') throw new Error('保存の確認がまだ開いています。閉じてからもう一度押してください。');
      throw new Error('この表示ではファイルを保存できません。');
    }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return `${name} を書き出しました。`;
}
let snapWanted = false;
$('snapBtn').onclick = () => { snapWanted = true; };
function doSnap() {
  cv.toBlob(async b => {
    if (!b) { toast('静止画を作れませんでした。', true); return; }
    try { toast(await deliver(`tokimaze-${stamp()}.png`, b)); } catch (e) { toast(e.message, true); }
  }, 'image/png');
}
function pickMime() {
  if (!window.MediaRecorder || !cv.captureStream) return null;
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
  }
  return '';
}
let mime = pickMime(), rec = null, recChunks = [], recStart = 0, recTick = 0;
if (mime === null) $('recBtn').hidden = true;
$('recBtn').onclick = () => rec ? stopRec() : startRec();
function startRec() {
  let r;
  try {
    const stream = cv.captureStream(30);
    r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : { videoBitsPerSecond: 12e6 });
  } catch (e) { toast('録画を始められませんでした。', true); return; }
  rec = r; recChunks = [];
  r.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
  r.onstop = async () => {
    const type = r.mimeType || mime || 'video/webm', ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recChunks, { type });
    if (blob.size < 4096) { toast('録画が空でした。画面を表示したまま、もう一度録ってください。', true); return; }
    try { toast(await deliver(`tokimaze-${stamp()}.${ext}`, blob)); } catch (e) { toast(e.message, true); }
  };
  r.start(500); recStart = performance.now();
  $('recBtn').setAttribute('aria-pressed', 'true'); $('recTime').hidden = false;
  recTick = setInterval(() => { const s = Math.floor((performance.now() - recStart) / 1000); $('recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
  toast('録画しています。もう一度押すと止めて保存します。');
}
function stopRec() {
  const r = rec; rec = null; clearInterval(recTick);
  $('recBtn').setAttribute('aria-pressed', 'false'); $('recTime').hidden = true; $('recTime').textContent = '0:00';
  try { r.stop(); } catch (e) {}
}

// ---- opening scene: played live in the first seconds, so the dish is moving at once ----
let intro = [];
function seedScene() {
  const A = liq.aspect, cols = app.colorSwatches().filter(s => !/^(白|黒|胡粉|墨)$/.test(s.name));
  const pick = i => cols[i % cols.length];
  const mk = (x, y, sw, size = 1) => ({ x, y, px: x, py: y, vx: 0, vy: 0, t: 0, swatch: sw, size });
  const pour = (t, u, v, sw, dur, size) => intro.push({ t, dur, s: mk(u * A, v, sw, size), tool: 'paint' });
  const spots = [[0.3, 0.68], [0.7, 0.6], [0.48, 0.38], [0.22, 0.28], [0.8, 0.24], [0.56, 0.84]];
  spots.forEach(([u, v], i) => pour(i * 0.12, u, v, pick(i * 2 + 1), 0.55, 1.05));
  [0, 1, 2].forEach(k => pour(1.0 + k * 0.45, 0.48, 0.38, pick(k + 2), 0.3, 0.95));
  intro.push({ t: 2.3, dur: 1.6, tool: 'stir', s: mk(0.7 * A, 0.52, null, 1.2), path: u => [(0.5 + 0.2 * Math.cos(u * 2.6)) * A, 0.52 + 0.17 * Math.sin(u * 2.6)] });
  intro.push({ t: 3.6, dur: 0.3, tool: 'alcohol', s: mk(0.34 * A, 0.56, { kind: 'water' }, 1.1) });
  intro.push({ t: 4.4, dur: 0.05, tool: 'bubble', s: mk(0.72 * A, 0.36, null, 1.1) });
}
function playIntro(dt) {
  for (const g of intro) {
    if (g.done) continue;
    g.t -= dt; if (g.t > 0) continue;
    const T = TOOLS[g.tool], s = g.s;
    if (!g.started) { g.started = true; g.el = 0; if (g.path) { const [x, y] = g.path(0); s.x = s.px = x; s.y = s.py = y; } T.begin && T.begin(app, s); continue; }
    g.el += dt; s.t += dt;
    const u = Math.min(1, g.el / g.dur);
    if (g.path) { const [x, y] = g.path(u); s.px = s.x; s.py = s.y; s.x = x; s.y = y; s.vx = (x - s.px) / dt; s.vy = (y - s.py) / dt; T.move && T.move(app, s, dt); }
    else T.hold && T.hold(app, s, dt);
    if (u >= 1) { T.end && T.end(app, s); g.done = true; }
  }
  if (intro.length && intro.every(g => g.done)) intro = [];
}

// ---- main loop ------------------------------------------------------------------
let hinted = store.get('hinted', false);
renderPalette(); renderTools();
resize();
startScene(startMode, true);
showHint();
if (!hinted) setTimeout(() => toast('下の道具と色を選んで、皿に触れてください。'), 900);

let last = performance.now(), frameNo = 0;
app.manual = false;
// deterministic stepping for tests: app.tick(frames, dt)
app.tick = (n, dt = 1 / 30) => {
  for (let i = 0; i < n; i++) {
    processStrokes(dt); if (intro.length) playIntro(dt);
    auto.update(dt, strokes.size > 0 || intro.length > 0); world.update(dt); liq.step(dt);
    if (i % 3 === 0) liq.readback();
  }
};
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (app.manual) { liq.render(); requestAnimationFrame(frame); return; }
  if (!(dt > 0)) dt = 1 / 60;
  dt = Math.min(dt, 1 / 24);
  processStrokes(dt);
  if (intro.length) playIntro(dt);
  auto.update(dt, strokes.size > 0 || intro.length > 0);
  world.update(dt);
  liq.step(dt);
  liq.render();
  if (snapWanted) { snapWanted = false; doSnap(); }
  if (++frameNo % 3 === 0) liq.readback();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
app.auto = auto; app.startScene = startScene; app.strokes = strokes;
window.__tokimaze = app;
})();
