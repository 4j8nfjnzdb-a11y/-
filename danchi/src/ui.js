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
  if (node) { node.port.postMessage(m); return; }
  if (!local) return;
  if (m.t === 'enc') local.enc(m.k, m.d);
  else if (m.t === 'key') local.key(m.u, m.d);
  else if (m.t === 'btn') local.btn(m.b, m.a);
  if (mode === 'preview') { localView(); localScreen(); }
}

async function startAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ sampleRate: 44100, latencyHint: 'playback' }); } catch (e) { ctx = new AC(); }
  const knobs = [];
  for (let k = 0; k < 6; k++) knobs.push([k, V[DN.V_K0 + k]]);
  try {
    if (CORE !== 'wasm') throw new Error('core is JS');
    if (!ctx.audioWorklet || !window.AudioWorkletNode) throw new Error('no worklet');
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await Promise.race([ctx.audioWorklet.addModule(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
    node = new AudioWorkletNode(ctx, 'danchi', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
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
    sp = ctx.createScriptProcessor(CORE === 'js' ? 4096 : 1024, 0, 2);
    sp.onaudioprocess = (e) => {
      const a = e.outputBuffer.getChannelData(0), b = e.outputBuffer.getChannelData(1);
      for (let o = 0; o < a.length; o += 256) { local.process(256); a.set(L(), o); b.set(R(), o); }
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
  const box = $('knobs');
  for (const K of KNOBS) {
    const el = document.createElement('div');
    el.className = 'knob' + (K.k === 6 ? ' obj' : '');
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', `${K.name}（${K.sub}）`);
    el.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24" fill="none" stroke="var(--line)" stroke-width="5" stroke-dasharray="113 151" transform="rotate(135 32 32)"/>` +
      `<circle class="arc" cx="32" cy="32" r="24" fill="none" stroke="var(--ink)" stroke-width="5" stroke-dasharray="0 151" transform="rotate(135 32 32)"/>` +
      `<circle cx="32" cy="32" r="15" fill="var(--bg)" stroke="var(--ink)" stroke-width="1.5"/><line class="ptr" x1="32" y1="32" x2="32" y2="19" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/></svg>` +
      `<span class="kn">${K.name}</span><span class="kv">—</span><span class="ks">${K.sub}</span>`;
    box.appendChild(el);
    knobEls[K.k] = el;
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
      if (d) { acc -= d; moved += Math.abs(d); send({ t: 'enc', k: K.k, d }); }
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
      send({ t: 'enc', k: K.k, d: e.deltaY < 0 ? 1 : -1 });   // one notch = one detent
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); e.stopPropagation(); send({ t: 'enc', k: K.k, d: e.shiftKey ? d * 4 : d }); }
      else if (K.k === 6 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); applyObject(); }
    });
  }
})();
function applyObject() { send({ t: 'btn', b: 5, a: 0 }); }
$('objapply').addEventListener('click', applyObject);
$('rec').addEventListener('click', async () => { await ensurePlaying(); send({ t: 'btn', b: 2, a: 0 }); });
$('loop').addEventListener('click', () => send({ t: 'btn', b: 4, a: 0 }));
$('clear').addEventListener('click', () => send({ t: 'btn', b: 3, a: 0 }));
$('rebuild').addEventListener('click', () => send({ t: 'btn', b: 7, a: 0 }));
for (const b of document.querySelectorAll('[data-keeper]')) b.addEventListener('click', () => send({ t: 'btn', b: 1, a: +b.dataset.keeper }));

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
    for (let h = 0; h < nh; h++) {
      const st = HIT(k, h, 0), cp = HIT(k, h, 1), off = keep ? 0 : HIT(k, h, 2), cause = HIT(k, h, 3);
      const start = st + off;
      const end = st + ((st & 1) ? 0.44 * sw : 0) + 0.9 * str;   // an early entry keeps its end
      const col = keep ? C.rail : off < -0.02 ? C.lamp : off > 0.02 ? C.late : C.ink;
      const bh = Math.max(3, Math.min(RH * 0.55, 3 + cp * 2));
      // the note's length, wrapping over the bar line
      g.globalAlpha = 0.28; g.fillStyle = col;
      let a = start, len = Math.max(0.15, end - start);
      while (len > 0) {
        const xa = xOf(a), room = LX + LW - xa, wpx = Math.min(len * SX, room);
        g.fillRect(xa, y - bh / 2, wpx, bh);
        len -= wpx / SX; a = 0;
        if (wpx <= 0) break;
      }
      g.globalAlpha = 1;
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
  $('objinfo').innerHTML = `${V[DN.V_OBJ_F0].toFixed(1)} Hz · 比 ${V[DN.V_OBJ_RATIO].toFixed(3)}<br>${cand !== cur ? `候補 #${String(cand).padStart(4, '0')} ${V[DN.V_CAND_F0].toFixed(1)} Hz` : '物は変わらない'}`;
  $('objapply').disabled = cand === cur;
  $('objapply').textContent = cand !== cur ? `#${String(cand).padStart(4, '0')} の物にする` : 'この物にする';
  // knobs
  const lanes = V[DN.V_MR_LANES] | 0, gest = V[DN.V_MR_GEST] | 0;
  for (const K of KNOBS) {
    const el = knobEls[K.k], v = K.k === 6 ? (cand - 1) / 9998 : V[DN.V_K0 + K.k];
    el.querySelector('.arc').setAttribute('stroke-dasharray', `${(113 * v).toFixed(1)} 151`);
    el.querySelector('.ptr').setAttribute('transform', `rotate(${(-135 + 270 * v).toFixed(1)} 32 32)`);
    el.querySelector('.kv').textContent = K.k === 6 ? `#${String(cand).padStart(4, '0')}` : K.fmt(v);
    el.setAttribute('aria-valuenow', String(K.k === 6 ? cand : K.fmt(v)));
    el.classList.toggle('rec', K.k < 6 && ((lanes >> K.k) & 1) === 1);
  }
  $('rec').setAttribute('aria-pressed', String(V[DN.V_MR_ARMED] > 0.5));
  $('rec').textContent = V[DN.V_MR_ARMED] > 0.5 ? '録っている' : '録る';
  $('loop').textContent = `${V[DN.V_MR_LOOP] | 0}小節`;
  $('mrlanes').innerHTML = KNOBS.slice(0, 6).map((K) => `<i class="${(gest >> K.k) & 1 ? 'live' : (lanes >> K.k) & 1 ? 'has' : ''}" title="${K.name}"></i>`).join('');
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
window.addEventListener('resize', () => { drawLanes(); drawPlane(); });
