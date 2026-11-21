'use strict';
// DANCHI browser prototype. DN (view indices), WASM_B64 and WORKLET_SRC are injected by tools/build.mjs.
const $ = (id) => document.getElementById(id);
const KIND_JA = ['跳ねさせる', '伸ばす', '先取りさせる', '譲らせる', '貸しを返させる', '部屋を替える', '遠ざける', '重ねる', '間引く', '左右へ動かす'];
const ROOM_JA = ['和室', '洋室', '台所', '浴室', '押入れ', '階段室'];
const PHASE_JA = ['個体', '行列', '塊', '空き部屋'];
const PHASE_NOTE = ['一つずつ聞こえる方へ', '押し合いが列で伝わる方へ', '重なって塊になる方へ', '部屋が空き、間が開く方へ'];
const KEYMAP = ['z', 'x', 'c', 'v', 'a', 's', 'd', 'f', 'q', 'w', 'e', 'r', '1', '2', '3', '4'];
const roomNo = (k) => ((k >> 2) + 1) * 100 + (k & 3) + 1;
const pct = (v) => Math.round(v * 100);
const KNOBS = [
  { k: 0, name: 'テンポ', sub: 'BPM（40〜180）', fmt: (v) => Math.round(40 + 140 * v) },
  { k: 1, name: 'ERASE', sub: '個体 ↔ 塊（求める所）', fmt: pct },
  { k: 2, name: '食い込み', sub: '拍どおり ↔ 先取り（求める所）', fmt: pct },
  { k: 3, name: 'META', sub: 'オペレーターの生き死にの速さ', fmt: pct },
  { k: 4, name: '部屋', sub: '響きのくせの強さ', fmt: pct },
  { k: 5, name: '遠さ', sub: '近い ↔ 遠い', fmt: pct },
  { k: 6, name: '物', sub: '回して選び、押して決める', fmt: null },
  // added knobs: each belongs to a feature switched on and off with its checkbox
  { k: 7, f: 0, name: '生成変化', sub: '自動：今の音を何小節ごとに物に', fmt: (v) => `${[1, 2, 4, 8, 16][Math.round(v * 4)]} 小節ごと` },
  { k: 8, f: 1, name: '部屋ごとの周期', sub: '12〜20 マス、ずれては揃う', fmt: (v) => `±${Math.round(v * 4)} マス` },
  { k: 9, f: 2, name: '管理人の圧', sub: '拍ごとに他の部屋を押し下げる', fmt: pct },
  { k: 10, f: 3, name: '入力で動かす', sub: '弾く大きさで求める所が動く', fmt: pct },
  { k: 11, f: 4, name: '刻み', sub: '伸びた音を打ち直す細かさ', fmt: (v) => `${['1/2', '1/3', '1/4', '1/6'][Math.round(v * 3)]} マス` },
];
const KV = (k) => (k < 7 ? V[DN.V_K0 + k] : V[DN.V_K7 + k - 7]);
// the effect layer: names, and what a value means for each
const FX_JA = ['グリッチ', 'ディレイ', 'ピッチ', 'スタッター', '逆再生'];
const FX_DELAY = [0.5, 0.75, 1, 1.5, 2, 3], FX_SEMI = [-12, -7, -5, -3, 3, 5, 7, 12], FX_STUT = [1, 0.5, 0.25, 0.125];
const fxi = (v, n) => Math.min(n - 1, Math.max(0, Math.floor(v * n)));
const FX_FMT = [
  (v) => `${pct(v)}%`,
  (v) => `${FX_DELAY[fxi(v, 6)]}マス`,
  (v) => { const st = FX_SEMI[fxi(v, 8)]; return (st > 0 ? '+' : '') + st; },
  (v) => `1/${16 / FX_STUT[fxi(v, 4)]}`,
  (v) => `${pct(0.3 + 0.7 * v)}%`,
];
const SEED = 1 + Math.floor(Math.random() * 9999);

// ---------- engine ----------
const wasmBytes = Uint8Array.from(atob(WASM_B64), (c) => c.charCodeAt(0));
let ctx = null, node = null, local = null, sp = null, playing = false, mode = 'preview';
let V = null, FB = null, viewTick = 0, CORE = 'wasm';

function makeLocal() {
  try {
    return new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}).exports;
  } catch (e) {
    // WebAssembly refused (e.g. by a page policy): the same core translated to JS
    if (typeof DANCHI_JS !== 'function') throw e;
    console.warn('WebAssembly unavailable, using the JS translation of the core:', e && e.message);
    CORE = 'js';
    return DANCHI_JS()({});
  }
}
function localView() {
  local.view();
  V = new Float32Array(local.memory.buffer, local.view(), local.view_n()).slice();
  viewTick++;
}
function localScreen() {
  for (let y = 0; y < 240; y += 16) local.draw(y, 16);
  FB = new Uint16Array(local.memory.buffer, local.fb(), 57600).slice();
}
// a silent preview so the page opens in a working state
local = makeLocal();
local.init(44100, SEED);
for (let i = 0; i < 44100 * 6 / 256; i++) local.process(256);
localView(); localScreen();

function send(m) {
  if (node) { node.port.postMessage(m, m.t === 'pcm' ? [m.data.buffer] : []); return; }
  if (!local) return;
  if (m.t === 'pcm') {
    const n = Math.min(m.data.length, local.samp_max());
    new Int16Array(local.memory.buffer, local.samp_area(), n).set(m.data.subarray(0, n));
    local.samp_commit(n);
  } else if (m.t === 'inch') inch = m.v;
  else if (m.t === 'fx') local.fx_set(m.f, m.k, m.v);
  else if (m.t === 'enc') local.enc(m.k, m.d);
  else if (m.t === 'key') local.key(m.u, m.d);
  else if (m.t === 'btn') local.btn(m.b, m.a);
  if (mode === 'preview') { localView(); localScreen(); }
}

async function startAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ sampleRate: 44100, latencyHint: 'playback' }); } catch (e) { ctx = new AC(); }
  const knobs = [];
  for (let k = 0; k < 12; k++) if (k !== 6) knobs.push([k, KV(k)]);
  try {
    if (CORE !== 'wasm') throw new Error('core is JS');
    if (!ctx.audioWorklet || !window.AudioWorkletNode) throw new Error('no worklet');
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await Promise.race([ctx.audioWorklet.addModule(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
    node = new AudioWorkletNode(ctx, 'danchi', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete',
      processorOptions: { wasm: wasmBytes.buffer.slice(0), seed: SEED, knobs },
    });
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'view') { V = m.v; viewTick++; } else if (m.t === 'fb') FB = m.fb;
    };
    node.connect(ctx.destination);
    mode = 'worklet';
  } catch (err) {
    // older browsers: the same core on the main thread
    console.warn('AudioWorklet unavailable, using ScriptProcessor:', err && err.message);
    node = null;
    local.init(ctx.sampleRate, SEED);
    for (const [k, v] of knobs) local.set_knob(k, v);
    const L = () => new Float32Array(local.memory.buffer, local.out_l(), 256);
    const R = () => new Float32Array(local.memory.buffer, local.out_r(), 256);
    const IN = () => new Float32Array(local.memory.buffer, local.in_buf(), 256);
    sp = ctx.createScriptProcessor(CORE === 'js' ? 4096 : 1024, 2, 2);
    sp.onaudioprocess = (e) => {
      const a = e.outputBuffer.getChannelData(0), b = e.outputBuffer.getChannelData(1);
      const ia = e.inputBuffer.getChannelData(0), ib = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : ia;
      for (let o = 0; o < a.length; o += 256) {
        const x = IN();
        if (inch === 0) x.set(ia.subarray(o, o + 256)); else if (inch === 1) x.set(ib.subarray(o, o + 256));
        else for (let i = 0; i < 256; i++) x[i] = 0.5 * (ia[o + i] + ib[o + i]);
        local.process_in(256); a.set(L(), o); b.set(R(), o);
      }
      localView();
      for (let y = 0; y < 240; y += 60) local.draw(y, 60);
      FB = new Uint16Array(local.memory.buffer, local.fb(), 57600).slice();
    };
    sp.connect(ctx.destination);
    mode = 'main';
  }
  $('engine').textContent = `${mode === 'worklet' ? 'AudioWorklet' : 'ScriptProcessor'} · ${CORE === 'wasm' ? 'WebAssembly' : 'JS 変換'} · ${ctx.sampleRate} Hz`;
}
async function setPlaying(on) {
  if (on) {
    await startAudio();
    if (ctx.state !== 'running') await ctx.resume();
  } else if (ctx) await ctx.suspend();
  playing = on;
  $('play').setAttribute('aria-pressed', String(on));
  $('play').textContent = on ? '止める' : '音を出す';
}
async function ensurePlaying() { if (!playing) await setPlaying(true); }
$('play').addEventListener('click', () => setPlaying(!playing));

// ---------- facade (the keyboard: 16 windows) ----------
const wins = [];
(function buildFacade() {
  const f = $('facade');
  for (let floor = 3; floor >= 0; floor--) {
    for (let col = 0; col < 4; col++) {
      const k = floor * 4 + col;
      const w = document.createElement('div');
      w.className = 'win' + (k === 0 ? ' keeper' : '');
      w.setAttribute('role', 'button');
      w.tabIndex = 0;
      w.setAttribute('aria-label', k === 0 ? '101号室 管理人室（押すと拍を守る層を切り替え）' : `${roomNo(k)}号室で鳴らして置く`);
      w.innerHTML = `<span class="flash"></span><span class="no">${roomNo(k)}</span><span class="rm"></span><span class="hand"></span>` +
        (k ? `<button type="button" class="sw" aria-label="${roomNo(k)}号室を出し入れ"></button>` : '');
      f.appendChild(w);
      wins[k] = w;
      const down = async (e) => {
        if (e.target.classList.contains('sw')) return;
        e.preventDefault();
        try { w.setPointerCapture && e.pointerId !== undefined && w.setPointerCapture(e.pointerId); } catch (_) {}
        await ensurePlaying();
        send({ t: 'key', u: k, d: 1 });
        w.dataset.held = '1';
      };
      const up = () => { if (w.dataset.held === '1') { w.dataset.held = ''; send({ t: 'key', u: k, d: 0 }); } };
      w.addEventListener('pointerdown', down);
      w.addEventListener('pointerup', up);
      w.addEventListener('pointercancel', up);
      w.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); e.stopPropagation(); down(e); } });
      w.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); up(); } });
      const sw = w.querySelector('.sw');
      if (sw) sw.addEventListener('click', async (e) => { e.stopPropagation(); await ensurePlaying(); send({ t: 'btn', b: 0, a: k }); });
    }
    const rail = document.createElement('div');
    rail.className = floor ? 'floor-rail' : 'entrance';
    f.appendChild(rail);
  }
})();
const heldKeys = new Set();
window.addEventListener('keydown', async (e) => {
  if (e.target.closest && e.target.closest('input,textarea')) return;
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setPlaying(!playing); return; }
  const k = KEYMAP.indexOf(e.key.toLowerCase());
  if (k < 0 || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  await ensurePlaying();
  if (e.shiftKey) { send({ t: 'btn', b: 0, a: k }); return; }
  heldKeys.add(k);
  send({ t: 'key', u: k, d: 1 });
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP.indexOf(e.key.toLowerCase());
  if (k >= 0 && heldKeys.has(k)) { heldKeys.delete(k); send({ t: 'key', u: k, d: 0 }); }
});

// ---------- knobs: every gesture becomes encoder detents, the same path as the device ----------
const knobEls = [];
(function buildKnobs() {
  for (const K of KNOBS) {
    const box = K.k >= 7 ? $('knobs2') : $('knobs');
    const el = document.createElement('div');
    el.className = 'knob' + (K.k === 6 ? ' obj' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', `${K.name}（${K.sub}）`);
    el.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24" fill="none" stroke="var(--line)" stroke-width="5" stroke-dasharray="113 151" transform="rotate(135 32 32)"/>` +
      `<circle class="arc" cx="32" cy="32" r="24" fill="none" stroke="var(--ink)" stroke-width="5" stroke-dasharray="0 151" transform="rotate(135 32 32)"/>` +
      `<circle cx="32" cy="32" r="15" fill="var(--bg)" stroke="var(--ink)" stroke-width="1.5"/><line class="ptr" x1="32" y1="32" x2="32" y2="19" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/></svg>` +
      `<span class="kn">${K.name}</span><span class="kv">—</span><span class="ks">${K.sub}</span>` +
      (K.f !== undefined ? `<label class="use"><input type="checkbox" data-feat="${K.f}"> 使う</label>` : '');
    box.appendChild(el);
    knobEls[K.k] = el;
    if (K.f !== undefined) {
      const lab = el.querySelector('.use'), cb = lab.querySelector('input');
      lab.addEventListener('pointerdown', (e) => e.stopPropagation());
      cb.addEventListener('keydown', (e) => e.stopPropagation());
      cb.addEventListener('change', async () => { await ensurePlaying(); send({ t: 'btn', b: 12, a: K.f }); });
    }
    let lastY = 0, acc = 0, dragging = false, moved = 0;
    el.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      dragging = true; lastY = e.clientY; acc = 0; moved = 0;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      el.focus({ preventScroll: true });
      ensurePlaying();
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      acc += (lastY - e.clientY) / 6;          // 6 px of drag = one detent
      lastY = e.clientY;
      const d = Math.trunc(acc);
      if (d) { acc -= d; moved += Math.abs(d); turn(K.k, d); }
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (K.k === 6 && moved < 2) applyObject();   // pressing the object knob applies the candidate
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      turn(K.k, e.deltaY < 0 ? 1 : -1);   // one notch = one detent
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); e.stopPropagation(); turn(K.k, e.shiftKey ? d * 4 : d); }
      else if (K.k === 6 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); applyObject(); }
    });
  }
})();
// what the object knob does depends on where the object comes from:
//   FM: turn = number, press = take it;  a file: turn = where in the file, press = take that part;
//   the input / the output: turn = how long a piece, press = take it again (capture / 生成変化)
function objMode() {
  const src = V[DN.V_SRC] | 0, from = V[DN.V_OBJ_FROM] | 0;
  if (src === 2 || (src === 1 && (from === 2 || from === 3))) return from === 3 && src === 1 ? 'out' : 'in';
  if (src === 1 && from === 1 && fileData) return 'file';
  return 'fm';
}
let fileApplied = -1;
function turn(k, d) {
  if (k === 6 && objMode() === 'file') {
    fileStart = Math.max(0, Math.min(fileData.pcm.length - 64, fileStart + Math.round(d * 0.05 * fileData.sr)));
    drawWave(); updateDom();
    return;
  }
  send({ t: 'enc', k, d });
}
function applyObject() {
  if (objMode() === 'file') { applyFile(); return; }
  send({ t: 'btn', b: 5, a: 0 });
}
$('regen').addEventListener('click', async () => { await ensurePlaying(); send({ t: 'btn', b: 11, a: 0 }); });
$('hold').addEventListener('change', () => send({ t: 'btn', b: 12, a: 5 }));
$('objapply').addEventListener('click', applyObject);
$('rec').addEventListener('click', async () => { await ensurePlaying(); send({ t: 'btn', b: 2, a: 0 }); });
$('loop').addEventListener('click', () => send({ t: 'btn', b: 4, a: 0 }));
$('clear').addEventListener('click', () => send({ t: 'btn', b: 3, a: 0 }));
$('rebuild').addEventListener('click', () => send({ t: 'btn', b: 7, a: 0 }));
for (const b of document.querySelectorAll('[data-keeper]')) b.addEventListener('click', () => send({ t: 'btn', b: 1, a: +b.dataset.keeper }));

// ---------- the object's source: FM, a part of a file, or the input ----------
const SRC_FM = 0, SRC_BUF = 1, SRC_LIVE = 2;
let fileData = null, fileStart = 0, inStream = null, inNode = null, inch = 2, srcErr = '', inInfo = '', devices = [], autoPicked = false;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function showPane(which) {
  $('pane-file').hidden = which !== 'file';
  $('pane-in').hidden = which !== 'in';
  for (const b of document.querySelectorAll('[data-src]')) b.setAttribute('aria-pressed', String(b.dataset.src === which));
  if (which === 'file') drawWave();
}
for (const b of document.querySelectorAll('[data-src]')) b.addEventListener('click', async () => {
  const w = b.dataset.src;
  srcErr = '';
  showPane(w);
  if (w === 'fm') { await ensurePlaying(); send({ t: 'btn', b: 9, a: SRC_FM }); }
  else if (w === 'file') { if (fileData) { await ensurePlaying(); applyFile(); } }
  else await openInput($('indev').value || null);
});

// a file: decoded by the browser (WAV, MP3, ...), mixed to mono; about 1.5 s of it becomes the object
const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
const SAMP_MAX = 65536 - 512;
function decodeWith(c, ab) {
  return new Promise((res, rej) => { const p = c.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
}
$('filelabel').addEventListener('click', () => { ensurePlaying(); });   // start the sound while the click still counts
$('file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) loadFile(f); e.target.value = ''; });
async function loadFile(f) {
  srcErr = '';
  $('fname').textContent = `${f.name} を読んでいます…`;
  try {
    await ensurePlaying();
    const ab = await (f.arrayBuffer ? f.arrayBuffer() : new Response(f).arrayBuffer());
    const copy = ab.slice(0);
    let buf;
    try { buf = await decodeWith(ctx, ab); }
    catch (e) { if (!OAC) throw e; buf = await decodeWith(new OAC(2, ctx.sampleRate, ctx.sampleRate), copy); }
    const n = buf.length, ch = buf.numberOfChannels, pcm = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) pcm[i] += d[i] / ch; }
    let pk = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(pcm[i]); if (a > pk) pk = a; }
    if (pk < 1e-4) throw new Error('silent');
    let st = 0;
    for (let i = 0; i < n; i++) if (Math.abs(pcm[i]) > pk * 0.1) { st = i; break; }
    fileData = { name: f.name, pcm, sr: buf.sampleRate, peak: pk };
    fileStart = Math.max(0, st - Math.round(0.005 * buf.sampleRate));
    $('fname').textContent = `${f.name} · ${(n / buf.sampleRate).toFixed(2)} 秒`;
    showPane('file');
    applyFile();
  } catch (e) {
    fileData = null;
    $('fname').textContent = 'ここに落としても入ります';
    srcErr = e && e.message === 'silent' ? `「${f.name}」は無音でした。` : `「${f.name}」を読めませんでした。音声ファイルでないか、このブラウザが読めない形式です（WAV か MP3 で試してください）。`;
    drawWave();
  }
}
function applyFile() {
  if (!fileData) return;
  const { pcm } = fileData, n = Math.min(SAMP_MAX, pcm.length - fileStart);
  if (n < 64) return;
  const k = 32767 * 0.98 / fileData.peak, out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(-32767, Math.min(32767, Math.round(pcm[fileStart + i] * k)));
  send({ t: 'pcm', data: out });
  fileApplied = fileStart;
  drawWave();
}
function drawWave() {
  const cv = $('wave');
  if (cv.offsetParent === null) return;
  const [g, W, H] = fitCanvas(cv);
  g.clearRect(0, 0, W, H);
  if (!fileData) {
    g.fillStyle = C.dim; g.font = '12px ' + getComputedStyle(document.body).fontFamily; g.textBaseline = 'middle';
    g.fillText('WAV / MP3 を選ぶか、ここに落とす', 8, H / 2);
    return;
  }
  const { pcm, peak } = fileData, n = pcm.length, per = n / W, k = (H / 2 - 2) / peak;
  const x0 = fileStart / per, x1 = Math.min(n, fileStart + SAMP_MAX) / per;
  g.fillStyle = C.lamp; g.globalAlpha = 0.25; g.fillRect(x0, 0, Math.max(1, x1 - x0), H); g.globalAlpha = 1;
  g.fillStyle = C.ink;
  for (let x = 0; x < W; x++) {
    const a = Math.floor(x * per), b = Math.min(n, Math.floor((x + 1) * per)), step = Math.max(1, ((b - a) / 48) | 0);
    let mn = 0, mx = 0;
    for (let i = a; i < b; i += step) { const v = pcm[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    g.fillRect(x, H / 2 - mx * k, 1, Math.max(1, (mx - mn) * k));
  }
  g.fillStyle = C.lamp; g.fillRect(x0, 0, 2, H);
}
(function waveInput() {
  const cv = $('wave');
  let drag = false;
  const at = (e) => {
    if (!fileData) return;
    const r = cv.getBoundingClientRect();
    fileStart = Math.max(0, Math.min(fileData.pcm.length - 64, Math.round((e.clientX - r.left) / r.width * fileData.pcm.length)));
    drawWave();
  };
  cv.addEventListener('pointerdown', (e) => { if (!fileData) { $('file').click(); return; } drag = true; try { cv.setPointerCapture(e.pointerId); } catch (_) {} at(e); });
  cv.addEventListener('pointermove', (e) => { if (drag) at(e); });
  const end = () => { if (drag) { drag = false; applyFile(); } };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
})();
(function dropFiles() {
  const box = $('source');
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', (e) => {
    e.preventDefault(); box.classList.remove('drop');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
})();

// the input (an audio interface such as an RME Fireface, or a microphone): no echo cancelling,
// no noise suppression, no automatic gain; the sound as it comes in
async function openInput(deviceId) {
  srcErr = '';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    srcErr = 'この表示では入力を使えません。手元で index.html を開いてください（localhost か https で）。';
    return;
  }
  await ensurePlaying();
  closeInput();
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
  if (deviceId) audio.deviceId = { exact: deviceId };
  try { inStream = await navigator.mediaDevices.getUserMedia({ audio }); }
  catch (e) {
    if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) return openInput(null);
    srcErr = e.name === 'NotAllowedError' || e.name === 'SecurityError'
      ? '入力が許可されませんでした。claude.ai の公開ページでは入力を使えません。手元で index.html を開いてください（localhost か https で）。'
      : e.name === 'NotFoundError' ? '入力機器が見つかりません。' : `入力を開けませんでした（${e.name}）。`;
    return;
  }
  inNode = ctx.createMediaStreamSource(inStream);
  inNode.connect(node || sp);
  const tr = inStream.getAudioTracks()[0], set = tr && tr.getSettings ? tr.getSettings() : {};
  await listDevices(set.deviceId);
  if (!deviceId && !autoPicked) {   // an RME Fireface, if one is connected and nothing was chosen yet
    autoPicked = true;
    const ff = devices.find((d) => /fireface|rme/i.test(d.label));
    if (ff && ff.deviceId !== set.deviceId) return openInput(ff.deviceId);
  }
  inInfo = `${tr ? tr.label || '入力' : '入力'} · ${set.channelCount || '?'} ch を受信`;
  send({ t: 'btn', b: 9, a: SRC_LIVE });
}
function closeInput() {
  if (inNode) { try { inNode.disconnect(); } catch (_) {} inNode = null; }
  if (inStream) { inStream.getTracks().forEach((t) => t.stop()); inStream = null; }
}
async function listDevices(cur) {
  try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch (_) { devices = []; }
  const sel = $('indev');
  sel.textContent = '';
  for (const d of devices) { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || '入力'; sel.appendChild(o); }
  if (cur) sel.value = cur;
}
$('indev').addEventListener('change', (e) => openInput(e.target.value || null));
$('inch').addEventListener('change', (e) => { inch = +e.target.value; send({ t: 'inch', v: inch }); });
$('inlive').addEventListener('click', async () => { srcErr = ''; if (!inStream) await openInput($('indev').value || null); else send({ t: 'btn', b: 9, a: SRC_LIVE }); });
$('incap').addEventListener('click', () => {
  srcErr = '';
  if (!inStream) { srcErr = '先に入力を開いてください（「入力」か「そのまま流す」）。'; return; }
  send({ t: 'btn', b: 10, a: 0 });
});

// ---------- the effect layer: values per unit, checkboxes, dice ----------
const DIE = '<svg class="die" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5" cy="5" r="1.3" fill="currentColor"/><circle cx="11" cy="5" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="5" cy="11" r="1.3" fill="currentColor"/><circle cx="11" cy="11" r="1.3" fill="currentColor"/></svg>';
const fxCells = [];
const fxLocal = {};   // values being dragged, shown before the engine echoes them back
(function buildFx() {
  const head = $('fxhead');
  FX_JA.forEach((name, f) => {
    const th = document.createElement('th');
    th.innerHTML = `<span class="fxh"><label><input type="checkbox" data-fx="${f}"> ${name}</label><button type="button" class="dice1" data-fx="${f}" aria-label="${name}を振る">${DIE}</button></span>`;
    head.appendChild(th);
    th.querySelector('input').addEventListener('change', async () => { await ensurePlaying(); send({ t: 'btn', b: 14, a: f }); });
    th.querySelector('.dice1').addEventListener('click', async () => { await ensurePlaying(); send({ t: 'btn', b: 15, a: f }); });
  });
  const body = $('fxbody');
  for (let k = 15; k >= 1; k--) {                 // top floor first, like the facade and the lanes
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="room">${roomNo(k)}</td>`;
    for (let f = 0; f < FX_JA.length; f++) {
      const td = document.createElement('td');
      td.className = 'fxc';
      td.tabIndex = 0;
      td.setAttribute('role', 'slider');
      td.setAttribute('aria-label', `${roomNo(k)}号室の${FX_JA[f]}`);
      td.innerHTML = '<span class="cell"><span class="bar"><i></i></span><span class="fv"></span></span>';
      tr.appendChild(td);
      fxCells.push({ td, f, k, i: td.querySelector('i'), fv: td.querySelector('.fv') });
      const set = (v) => { v = Math.max(0, Math.min(1, v)); fxLocal[`${f}.${k}`] = { v, t: performance.now() }; send({ t: 'fx', f, k, v }); paintFx(); };
      let drag = false;
      const at = (e) => { const r = td.querySelector('.bar').getBoundingClientRect(); set((e.clientX - r.left) / r.width); };
      td.addEventListener('pointerdown', (e) => { drag = true; try { td.setPointerCapture(e.pointerId); } catch (_) {} at(e); });
      td.addEventListener('pointermove', (e) => { if (drag) at(e); });
      td.addEventListener('pointerup', () => { drag = false; });
      td.addEventListener('pointercancel', () => { drag = false; });
      td.addEventListener('dblclick', () => set(0));
      td.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0;
        if (d) { e.preventDefault(); e.stopPropagation(); set(fxVal(f, k) + d); }
        else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { e.preventDefault(); set(0); }
      });
    }
    body.appendChild(tr);
  }
})();
function fxVal(f, k) {
  const l = fxLocal[`${f}.${k}`];
  if (l && performance.now() - l.t < 400) return l.v;
  return V[DN.V_TRACK0 + k * DN.V_TS + DN.T_FX0 + f];
}
function paintFx() {
  const mask = V[DN.V_FX_MASK] | 0, layer = V[DN.V_FX_LAYER] > 0.5;
  for (const c of fxCells) {
    const v = fxVal(c.f, c.k);
    c.i.style.width = (v * 100).toFixed(0) + '%';
    c.fv.textContent = v > 0 ? FX_FMT[c.f](v) : '—';
    c.td.classList.toggle('zero', !(v > 0));
    c.td.classList.toggle('unchecked', !((mask >> c.f) & 1));
    c.td.setAttribute('aria-valuenow', v.toFixed(2));
  }
  for (const cb of document.querySelectorAll('#fxhead input[data-fx]')) cb.checked = ((mask >> +cb.dataset.fx) & 1) === 1;
  $('fxlayer').checked = layer;
  $('fxsec').classList.toggle('layer-off', !layer);
  const auto = String(V[DN.V_FX_AUTO] | 0);
  if ($('fxauto').value !== auto && document.activeElement !== $('fxauto')) $('fxauto').value = auto;
  $('fxinfo').textContent = layer ? `振った回数 ${V[DN.V_FX_ROLLS] | 0}` : '層は切れています（これまでどおりの音）';
}
$('fxlayer').addEventListener('change', async () => { await ensurePlaying(); send({ t: 'btn', b: 13, a: 0 }); });
$('fxdice').addEventListener('click', async () => { await ensurePlaying(); send({ t: 'btn', b: 15, a: -1 }); });
$('fxauto').addEventListener('change', (e) => send({ t: 'btn', b: 16, a: +e.target.value }));

// ---------- meters (listening) ----------
const METERS = [
  ['輪郭', DN.V_C_CONTOUR, 1], ['密度', DN.V_C_DENS, 1], ['フラム', DN.V_C_FLAM, 1], ['重なり 5ms 未満', DN.V_C_COMB, 1],
  ['干渉', DN.V_C_INTERF, 1], ['中央寄り', DN.V_C_MONO, 1], ['先に入った', DN.V_C_EARLY, 4], ['遅れた', DN.V_C_LATE, 4],
];
const meterEls = METERS.map(([name]) => {
  const n = document.createElement('span'); n.textContent = name;
  const b = document.createElement('span'); b.className = 'bar'; const i = document.createElement('i'); b.appendChild(i);
  const v = document.createElement('span'); v.className = 'v mono';
  $('meters').append(n, b, v);
  return { i, v };
});

// ---------- drawing ----------
let C = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const n of ['bg', 'panel', 'ink', 'dim', 'line', 'rail', 'lamp', 'late', 'warn', 'wall']) C[n] = cs.getPropertyValue('--' + n).trim();
}
readColors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [g, r.width, r.height];
}
const T = (k, f) => V[DN.V_TRACK0 + k * DN.V_TS + f];
const HIT = (k, h, f) => V[DN.V_TRACK0 + k * DN.V_TS + DN.T_HIT0 + h * DN.T_HS + f];

function drawLanes() {
  const cv = $('lanes');
  const [g, W, H] = fitCanvas(cv);
  g.clearRect(0, 0, W, H);
  const LX = 54, top = 18, RH = (H - top - 4) / 16, LW = W - LX - 8, SX = LW / 16;
  g.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--f-mono');
  g.textBaseline = 'middle';
  // grid
  for (let s = 0; s <= 16; s++) {
    const x = LX + s * SX;
    g.strokeStyle = C.line; g.lineWidth = (s & 3) === 0 ? 1.5 : 1;
    g.globalAlpha = (s & 3) === 0 ? 1 : (s & 1) === 0 ? 0.7 : 0.3;
    g.beginPath(); g.moveTo(x, top - 2); g.lineTo(x, H - 2); g.stroke();
    if ((s & 3) === 0 && s < 16) { g.globalAlpha = 1; g.fillStyle = C.dim; g.fillText(String(s / 4 + 1) + '拍', x + 3, 8); }
  }
  g.globalAlpha = 1;
  // playhead
  const pos = V[DN.V_POS];
  g.fillStyle = C.dim; g.globalAlpha = 0.35; g.fillRect(LX + pos * LW - 1, top - 2, 2, H - top); g.globalAlpha = 1;
  const rowY = (k) => top + (15 - k) * RH + RH / 2;   // top floor first, like the facade
  const xOf = (st) => LX + (((st % 16) + 16) % 16) * SX;
  const notes = [];
  for (let k = 0; k < 16; k++) {
    const y = rowY(k), on = T(k, DN.T_ON) > 0.5, keep = T(k, DN.T_KEEP) > 0.5;
    g.fillStyle = keep ? C.rail : on ? C.ink : C.dim;
    g.globalAlpha = on ? 1 : 0.45;
    g.fillText(keep ? '管理人' : roomNo(k) + '', 4, y);
    g.globalAlpha = 1;
    if (!on) continue;
    const nh = T(k, DN.T_NHIT), sw = T(k, DN.T_SWING), str = T(k, DN.T_STRETCH);
    // the effect layer on this unit (only checked effects with a value here)
    const fxOn = V[DN.V_FX_LAYER] > 0.5 && !keep, fmask = V[DN.V_FX_MASK] | 0;
    const fv = (f) => (fxOn && ((fmask >> f) & 1) ? T(k, DN.T_FX0 + f) : 0);
    const fG = fv(0), fD = fv(1), fP = fv(2), fS = fv(3), fR = fv(4);
    if (T(k, DN.T_CYCLE) !== 16 && !keep) { g.fillStyle = C.dim; g.fillText(String(T(k, DN.T_CYCLE) | 0), 38, y); }
    for (let h = 0; h < nh; h++) {
      const bs = HIT(k, h, 4);
      if (bs < 0) continue;                                    // not in this bar (its own cycle)
      const st = bs, cp = HIT(k, h, 1), off = keep ? 0 : HIT(k, h, 2), cause = HIT(k, h, 3);
      const start = st + off;
      const end = st + ((st & 1) ? 0.44 * sw : 0) + 0.9 * str;   // an early entry keeps its end
      const col = keep ? C.rail : off < -0.02 ? C.lamp : off > 0.02 ? C.late : C.ink;
      const bh = Math.max(3, Math.min(RH * 0.55, 3 + cp * 2));
      // the note's length, wrapping over the bar line (a reversed copy is drawn swelling)
      const bar = (a0, len0, alpha) => {
        let a = a0, len = Math.max(0.15, len0);
        while (len > 0) {
          const xa = xOf(a), room = LX + LW - xa, wpx = Math.min(len * SX, room);
          if (fR > 0) {
            const gr = g.createLinearGradient(xa, 0, xa + wpx, 0);
            gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, col);
            g.fillStyle = gr;
          } else g.fillStyle = col;
          g.globalAlpha = alpha;
          g.fillRect(xa, y - bh / 2, wpx, bh);
          len -= wpx / SX; a = 0;
          if (wpx <= 0) break;
        }
        g.globalAlpha = 1;
      };
      const blen = fR > 0 ? (end - start) * (0.3 + 0.7 * fR) : end - start;
      bar(start, blen, fR > 0 ? 0.6 : 0.28);
      if (fD > 0) {                                            // delay: the same copy, later and softer
        const dd = FX_DELAY[fxi(fD, 6)];
        for (let j = 1; j <= 3; j++) bar(start + j * dd, blen, 0.2 * Math.pow(0.55, j - 1));
      }
      if (fS > 0) {                                            // stutter: where it starts again
        const sl = FX_STUT[fxi(fS, 4)];
        g.fillStyle = col;
        for (let u = start + sl; u < start + blen; u += sl) g.fillRect(xOf(u), y - bh / 2 - 1, 1, bh + 2);
      }
      if (fG > 0) {                                            // glitch: broken up
        g.fillStyle = C.bg;
        for (let u = start + 0.15; u < start + blen; u += 0.35) g.fillRect(xOf(u), y - bh / 2, 2, bh);
      }
      if (fP > 0) {                                            // pitch: how far
        const sp = FX_SEMI[fxi(fP, 8)];
        g.fillStyle = col; g.font = '9px ' + getComputedStyle(document.body).getPropertyValue('--f-mono');
        g.fillText((sp > 0 ? '+' : '') + sp, xOf(start) + 3, y + RH * 0.36);
        g.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--f-mono');
      }
      // grid position -> where it actually entered
      const xn = xOf(st), xr = xOf(start);
      g.fillStyle = C.dim; g.fillRect(xn - 0.5, y - RH * 0.38, 1, RH * 0.76);
      if (Math.abs(off) > 0.02 && Math.abs(xr - xn) < LW / 2) { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(xn, y); g.lineTo(xr, y); g.stroke(); }
      g.fillStyle = col; g.fillRect(xr - 2, y - bh / 2 - 1, 4, bh + 2);
      if (cp > 1) { g.fillStyle = C.dim; g.fillText('×' + cp, xr + 4, y - RH * 0.32); }
      if (cause >= 0) notes.push({ k, x: xr, y, cause, self: cause === k });
    }
  }
  // causes: an arc from the unit whose stretched note pushed this one
  for (const n of notes) {
    g.strokeStyle = C.ink; g.globalAlpha = 0.55; g.lineWidth = 1;
    if (n.self) { g.beginPath(); g.arc(n.x + 6, n.y, 3, -Math.PI * 0.8, Math.PI * 0.8); g.stroke(); g.globalAlpha = 1; continue; }
    const yc = rowY(n.cause), xc = n.x + 10;
    g.beginPath(); g.moveTo(xc, yc); g.quadraticCurveTo(xc + 14, (yc + n.y) / 2, n.x + 3, n.y); g.stroke();
    g.beginPath(); g.arc(xc, yc, 2, 0, Math.PI * 2); g.fillStyle = C.ink; g.fill();
    g.globalAlpha = 1;
  }
}

function drawPlane() {
  const cv = $('plane');
  const [g, W] = fitCanvas(cv);
  const H = W, P = 26, S = W - P * 2;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = C.line; g.lineWidth = 1;
  g.strokeRect(P, P, S, S);
  for (let i = 1; i < 4; i++) { g.globalAlpha = 0.5; g.beginPath(); g.moveTo(P + S * i / 4, P); g.lineTo(P + S * i / 4, P + S); g.moveTo(P, P + S * i / 4); g.lineTo(P + S, P + S * i / 4); g.stroke(); }
  g.globalAlpha = 1;
  g.fillStyle = C.dim; g.font = '11px ' + getComputedStyle(document.body).fontFamily;
  g.textBaseline = 'alphabetic';
  g.fillText('個体', P, H - 8); g.textAlign = 'right'; g.fillText('塊', P + S, H - 8);
  g.textAlign = 'left'; g.fillText('食い込み', P, P - 8); g.fillText('拍どおり', P + 4, P + S - 5);
  const X = (e) => P + e * S, Y = (p) => P + (1 - p) * S;
  // trail of the last 64 bars
  g.strokeStyle = C.ink; g.lineWidth = 1.2; g.beginPath();
  let first = true;
  for (let i = 0; i < 64; i++) {
    const e = V[DN.V_TRAIL0 + i * 2], p = V[DN.V_TRAIL0 + i * 2 + 1];
    if (e < 0) continue;
    g.globalAlpha = 0.5;
    if (first) { g.moveTo(X(e), Y(p)); first = false; } else g.lineTo(X(e), Y(p));
  }
  g.stroke(); g.globalAlpha = 1;
  // the knobs, the phase's tilt, and the wanted point
  const ke = V[DN.V_K0 + 1], kp = V[DN.V_K0 + 2], te = V[DN.V_T_ERASE], tp = V[DN.V_T_PUSH];
  g.strokeStyle = C.dim; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(ke), Y(kp)); g.lineTo(X(te), Y(tp)); g.stroke(); g.setLineDash([]);
  g.fillStyle = C.dim; g.fillRect(X(ke) - 3, Y(kp) - 0.5, 6, 1); g.fillRect(X(ke) - 0.5, Y(kp) - 3, 1, 6);
  g.strokeStyle = C.lamp; g.lineWidth = 2; g.beginPath(); g.arc(X(te), Y(tp), 8, 0, Math.PI * 2); g.stroke();
  g.fillStyle = C.ink; g.beginPath(); g.arc(X(V[DN.V_M_ERASE]), Y(V[DN.V_M_PUSH]), 5, 0, Math.PI * 2); g.fill();
}

function drawScreen() {
  if (!FB) return;
  const cv = $('screen'), g = cv.getContext('2d');
  const img = g.createImageData(240, 240), d = img.data;
  for (let i = 0; i < 57600; i++) {
    const p = FB[i];
    d[i * 4] = (p >> 11) << 3; d[i * 4 + 1] = ((p >> 5) & 63) << 2; d[i * 4 + 2] = (p & 31) << 3; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// ---------- DOM state (a few times a second) ----------
let lastLogKey = '';
function updateDom() {
  const ph = V[DN.V_PHASE] | 0;
  $('phasename').textContent = PHASE_JA[ph];
  $('phaseleft').textContent = `${PHASE_NOTE[ph]} · あと ${V[DN.V_PH_LEFT] | 0} / ${V[DN.V_PH_LEN] | 0} 小節`;
  $('clock').textContent = `${V[DN.V_BAR] | 0} 小節`;
  $('bnum').textContent = String(V[DN.V_SEED] | 0).padStart(4, '0');
  const cand = V[DN.V_SEED_CAND] | 0, cur = V[DN.V_SEED] | 0;
  const srcNow = V[DN.V_SRC] | 0;
  const fromNow = V[DN.V_OBJ_FROM] | 0;
  const first = srcNow === 0 ? `${V[DN.V_OBJ_F0].toFixed(1)} Hz · 比 ${V[DN.V_OBJ_RATIO].toFixed(3)}`
    : srcNow === 1 ? `${fromNow === 3 ? `生成変化 ${V[DN.V_GENS] | 0} 代目` : fromNow === 2 ? '入力からつかんだ音' : 'ファイルの音'} · ${V[DN.V_SAMP_LEN].toFixed(2)} 秒` : '入力そのもの · 1 拍遅れ';
  const oi = `${first}<br>${cand !== cur ? `候補 #${String(cand).padStart(4, '0')} ${V[DN.V_CAND_F0].toFixed(1)} Hz` : '物は変わらない'}`;
  if ($('objinfo').innerHTML !== oi) $('objinfo').innerHTML = oi;
  const om = objMode(), capLen = V[DN.V_CAP_LEN].toFixed(2);
  let pend = false, lab = 'この物にする';
  if (om === 'fm') { pend = cand !== cur; lab = pend ? `#${String(cand).padStart(4, '0')} の物にする` : 'この物にする'; }
  else if (om === 'file') { pend = fileStart !== fileApplied; lab = `${(fileStart / fileData.sr).toFixed(2)} 秒からを物にする`; }
  else if (om === 'in') { pend = true; lab = `つかむ（${capLen} 秒）`; }
  else { pend = true; lab = `生成変化（${capLen} 秒）`; }
  $('objapply').disabled = !pend;
  $('objapply').textContent = lab;
  // source
  {
    const src = V[DN.V_SRC] | 0, note = V[DN.V_SRC_NOTE] | 0, len = V[DN.V_SAMP_LEN].toFixed(2);
    let t;
    const from = V[DN.V_OBJ_FROM] | 0;
    if (src === SRC_FM) t = `いまの物：<b>FM の音 #${String(cur).padStart(4, '0')}</b>（${V[DN.V_OBJ_F0].toFixed(1)} Hz、比 ${V[DN.V_OBJ_RATIO].toFixed(3)}）`;
    else if (src === SRC_BUF) t = from === 3 ? `いまの物：<b>生成変化 ${V[DN.V_GENS] | 0} 代目（${len} 秒）</b>`
      : from === 2 ? `いまの物：<b>入力からつかんだ ${len} 秒</b>` : `いまの物：<b>${esc(fileData ? fileData.name : 'ファイル')} の ${len} 秒</b>`;
    else t = `いまの物：<b>入力そのもの</b>（${Math.round(V[DN.V_LIVE_DELAY])} ms ＝ 1 拍前の入力を、各部屋の位置で）${inInfo ? `<br>${esc(inInfo)}` : ''}`;
    if (note === 2 && src !== SRC_LIVE) t += '<br><span class="err">音が小さすぎて、取れませんでした。</span>';
    if (src === SRC_LIVE && note === 2) t += '<br><span class="err">入力が小さすぎて、つかめませんでした。</span>';
    if (srcErr) t += `<br><span class="err">${esc(srcErr)}</span>`;
    if ($('srcnow').innerHTML !== t) $('srcnow').innerHTML = t;
    const lv = Math.min(1, V[DN.V_IN_PEAK]);
    $('inlvl').style.width = (lv * 100).toFixed(0) + '%';
    $('inlvl').classList.toggle('hot', lv > 0.9);
    $('incap').disabled = !inStream;
  }
  // knobs
  const lanes = V[DN.V_MR_LANES] | 0, gest = V[DN.V_MR_GEST] | 0;
  const feat = V[DN.V_FEAT] | 0;
  for (const K of KNOBS) {
    const el = knobEls[K.k];
    let v, kv;
    if (K.k === 6) {
      if (om === 'file') { v = fileStart / Math.max(1, fileData.pcm.length); kv = `${(fileStart / fileData.sr).toFixed(2)} 秒から`; }
      else if (om === 'in' || om === 'out') { v = (V[DN.V_CAP_LEN] - 0.1) / 0.65; kv = `${capLen} 秒`; }
      else { v = (cand - 1) / 9998; kv = `#${String(cand).padStart(4, '0')}`; }
      el.querySelector('.ks').textContent = om === 'file' ? '回して位置、押して決める' : om === 'in' ? '回して長さ、押してつかむ' : om === 'out' ? '回して長さ、押して生成変化' : '回して番号、押して決める';
      el.classList.toggle('pending', pend && (om === 'fm' || om === 'file'));
    } else { v = KV(K.k); kv = K.fmt(v); }
    el.querySelector('.arc').setAttribute('stroke-dasharray', `${(113 * v).toFixed(1)} 151`);
    el.querySelector('.ptr').setAttribute('transform', `rotate(${(-135 + 270 * v).toFixed(1)} 32 32)`);
    el.querySelector('.kv').textContent = kv;
    el.setAttribute('aria-valuenow', kv);
    el.classList.toggle('rec', K.k !== 6 && ((lanes >> K.k) & 1) === 1);
    if (K.f !== undefined) {
      const on = ((feat >> K.f) & 1) === 1;
      el.classList.toggle('off', !on);
      const cb = el.querySelector('input[data-feat]');
      if (cb.checked !== on) cb.checked = on;
    }
  }
  if ($('hold').checked !== (((feat >> 5) & 1) === 1)) $('hold').checked = ((feat >> 5) & 1) === 1;
  paintFx();
  $('rec').setAttribute('aria-pressed', String(V[DN.V_MR_ARMED] > 0.5));
  $('rec').textContent = V[DN.V_MR_ARMED] > 0.5 ? '録っている' : '録る';
  $('loop').textContent = `${V[DN.V_MR_LOOP] | 0}小節`;
  $('mrlanes').innerHTML = KNOBS.filter((K) => K.k !== 6).map((K) => `<i class="${(gest >> K.k) & 1 ? 'live' : (lanes >> K.k) & 1 ? 'has' : ''}" title="${K.name}"></i>`).join('');
  const km = V[DN.V_KEEPER_MODE] | 0;
  for (const b of document.querySelectorAll('[data-keeper]')) b.setAttribute('aria-pressed', String(+b.dataset.keeper === km));
  // windows
  for (let k = 0; k < 16; k++) {
    const w = wins[k], on = T(k, DN.T_ON) > 0.5, hand = T(k, DN.T_HAND) | 0;
    w.classList.toggle('on', on);
    w.classList.toggle('dormant', T(k, DN.T_DORMANT) > 0.5);
    w.querySelector('.rm').textContent = k === 0 ? (on ? '管理人' : '管理人 不在') : `${ROOM_JA[T(k, DN.T_ROOM) | 0]}${T(k, DN.T_DORMANT) > 0.5 ? ' 空' : ''}`;
    w.querySelector('.hand').textContent = hand === 1 ? '手' : hand === 2 ? '閉' : '';
  }
  // meters
  METERS.forEach(([, idx, sc], i) => {
    const v = Math.max(0, Math.min(1, V[idx] * sc));
    meterEls[i].i.style.width = (v * 100).toFixed(0) + '%';
    meterEls[i].v.textContent = V[idx].toFixed(2);
  });
  // operators
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const o = (f) => V[DN.V_OPS0 + i * DN.V_OS + f];
    const kind = o(DN.O_KIND) | 0, en = o(DN.O_ENERGY), since = o(DN.O_SINCE), born = o(DN.O_BORN), rw = o(DN.O_REWARD);
    const acted = since <= 1;
    const tags = (born <= 2 ? '<span class="tag">新</span>' : '') + (o(DN.O_PENDING) > 0.5 ? '<span class="tag">効き待ち</span>' : '');
    rows.push(`<tr class="${acted ? 'acted' : ''}"><td>${KIND_JA[kind]}${tags}</td><td class="num">${roomNo(o(DN.O_TRACK) | 0)}</td>` +
      `<td><span class="en"><i class="${en < 0.25 ? 'low' : born < 6 ? 'young' : ''}" style="width:${Math.max(0, Math.min(100, en * 50)).toFixed(0)}%"></i></span> <span class="num">${en.toFixed(2)}</span></td>` +
      `<td class="num ${since >= 999 ? '' : rw > 0.05 ? 'pos' : rw < -0.05 ? 'neg' : ''}">${since >= 999 ? '—' : (rw >= 0 ? '+' : '') + rw.toFixed(2)}</td>` +
      `<td class="num">${o(DN.O_PERIOD) | 0}小節おき</td><td class="num">${o(DN.O_AGE) | 0}</td></tr>`);
  }
  $('opbody').innerHTML = rows.join('');
  // log
  const items = [];
  let key = '';
  for (let i = 0; i < 8; i++) {
    const l = (f) => V[DN.V_LOG0 + i * DN.V_LS + f];
    const type = l(DN.L_TYPE) | 0;
    if (!type) continue;
    const kind = l(DN.L_KIND) | 0, tr = l(DN.L_TRACK) | 0, val = l(DN.L_VALUE), bar = l(DN.L_BAR) | 0;
    key += `${type}.${bar}.${l(DN.L_ID)};`;
    let txt = '', cls = '';
    if (type === 1) { txt = `「${KIND_JA[kind]}」が ${roomNo(tr)}号室に手を入れた`; cls = 'act'; }
    else if (type === 2) txt = `「${KIND_JA[kind]}」が生まれた（${roomNo(tr)}号室）`;
    else if (type === 3) txt = `「${KIND_JA[kind]}」が力尽きた（${val | 0}小節生きた）`;
    else if (type === 4) txt = `局面「${PHASE_JA[kind]}」へ、${val | 0}小節${tr >= 0 ? `、${ROOM_JA[tr]}が空き部屋に` : ''}`;
    else if (type === 5) txt = `「${KIND_JA[kind]}」（${roomNo(tr)}）の効き ${val >= 0 ? '+' : ''}${val.toFixed(2)}`;
    items.push(`<li class="${cls}"><span class="b">${bar}</span><span>${txt}</span></li>`);
  }
  if (key !== lastLogKey) { $('log').innerHTML = items.join(''); lastLogKey = key; }
}

let domT = 0, seenTick = -1;
function frame(t) {
  if (V) {
    if (viewTick !== seenTick) {
      seenTick = viewTick;
      drawLanes();
      for (let k = 0; k < 16; k++) wins[k].querySelector('.flash').style.opacity = Math.min(0.9, T(k, DN.T_FLASH) * 1.2).toFixed(2);
    }
    if (t - domT > 200) { domT = t; updateDom(); drawPlane(); drawScreen(); }
  }
  requestAnimationFrame(frame);
}
updateDom(); drawLanes(); drawPlane(); drawScreen();
requestAnimationFrame(frame);
window.addEventListener('resize', () => { drawLanes(); drawPlane(); drawWave(); });
