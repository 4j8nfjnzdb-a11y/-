'use strict';
// ---- detection: MediaPipe (pose masks + face landmarks) and the built-in fallback ----
//
// Every detector returns, in source pixels:
//   persons: [{ box:[x0,y0,x1,y1], mask:{x,y,w,h,gw,gh,data:Uint8Array}, lm:Float32Array(33*3)|null, meanL, score }]
//   faces:   [{ kind:'lm', lm:Float32Array(FACE_IDX.length*2) } | { kind:'ell', ell:[cx,cy,rx,ry,ang] }]  (+ box, width)

const MP_VER = '0.10.35';
const MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/`;
const ASSETS = (window.HITOGATA_ASSETS || './');
const MODEL_SRC = {
  pose: { file: 'pose_landmarker_full.task', url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task' },
  face: { file: 'face_landmarker.task', url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
};

// face landmark subsets (MediaPipe face mesh indices)
const FI = {
  oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  eyeR: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  eyeL: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
  browR: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  browL: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  lips: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
  nose: [1, 2, 4, 5, 195, 98, 327, 64, 294, 49, 279, 129, 358, 97, 326],
};
const FACE_IDX = [].concat(FI.oval, FI.eyeR, FI.eyeL, FI.browR, FI.browL, FI.lips, FI.nose);
const FG = {}; { let o = 0; for (const k of ['oval', 'eyeR', 'eyeL', 'browR', 'browL', 'lips', 'nose']) { FG[k] = [o, FI[k].length]; o += FI[k].length; } }
const fpos = (lm, idx) => { const j = FACE_IDX.indexOf(idx); return [lm[2 * j], lm[2 * j + 1]]; };

const DET = {
  mp: { state: 'idle', msg: '', vision: null, pose: null, face: null, delegate: '', origin: { pose: '', face: '' } },
  tiles: 'none',
  lastMs: 0,
  onStatus: () => {},
};

// ---------------------------------------------------------------- loading ---
async function fetchBytes(url, onProg) {
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !onProg) return new Uint8Array(await r.arrayBuffer());
  const rd = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProg(got, total); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
async function firstBytes(cands, onProg) {
  const errs = [];
  for (const [label, get] of cands) {
    try { const b = await get(); if (b && b.length > 1000) return { bytes: b, origin: label }; errs.push(label + ': 空'); }
    catch (e) { errs.push(label + ': ' + (e && e.message || e)); }
  }
  throw new Error(errs.join(' / '));
}
async function fetchB64(url, onProg) { // the published page keeps models as base64 text next to it
  const txt = new TextDecoder().decode(await fetchBytes(url, onProg)).replace(/\s+/g, '');
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(txt);
  const bin = atob(txt), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function modelBytes(kind, onProg) {
  return firstBytes([
    ['選んだファイル', async () => { const v = await idb.get('model:' + kind); return v ? new Uint8Array(v) : null; }],
    ['同じ場所のファイル', () => fetchB64(ASSETS + 'models/' + MODEL_SRC[kind].file + '.b64.txt', onProg)],
    ['公式の配布元', () => fetchBytes(MODEL_SRC[kind].url, onProg)],
  ]);
}

DET.loadMP = async function (opts = {}) {
  const mp = DET.mp;
  if (mp.state === 'loading') return;
  mp.state = 'loading'; mp.msg = '実行部を読み込んでいます'; DET.onStatus();
  try {
    if (!mp.vision) {
      try { mp.vision = await import(MP_CDN + 'vision_bundle.mjs'); }
      catch (e) { mp.vision = await import(ASSETS + 'mediapipe/vision_bundle.mjs'); }
    }
    let mb = 0;
    const prog = (g, t) => { mp.msg = `読み込み中 ${(g / 1e6).toFixed(1)}${t ? ' / ' + (t / 1e6).toFixed(1) : ''} MB`; if ((g / 4e5 | 0) !== mb) { mb = g / 4e5 | 0; DET.onStatus(); } };
    if (!mp.wasmUrl) { // the runtime fetches the binary itself; find a place that answers
      const errs = [];
      for (const u of [ASSETS + 'mediapipe/vision_wasm_internal.wasm', MP_CDN + 'wasm/vision_wasm_internal.wasm']) {
        try { const r = await fetch(u, { cache: 'force-cache' }); if (r.ok) { if (r.body) r.body.cancel().catch(() => {}); mp.wasmUrl = u; break; } errs.push(`HTTP ${r.status}`); }
        catch (e) { errs.push(e.message || String(e)); }
      }
      if (!mp.wasmUrl) throw new Error('実行部（wasm）を取得できません：' + errs.join(' / '));
    }
    const filesets = [
      { wasmLoaderPath: MP_CDN + 'wasm/vision_wasm_internal.js', wasmBinaryPath: mp.wasmUrl },
      { wasmLoaderPath: ASSETS + 'mediapipe/vision_wasm_internal.js', wasmBinaryPath: mp.wasmUrl },
    ];
    mp.msg = 'モデルを読み込んでいます'; DET.onStatus();
    const pm = await modelBytes('pose', prog), fm = await modelBytes('face', prog);
    mp.origin = { pose: pm.origin, face: fm.origin };
    const make = async (Cls, bytes, extra) => {
      let last;
      for (const fs of filesets) for (const delegate of (opts.cpu ? ['CPU'] : ['GPU', 'CPU'])) {
        try { const t = await Cls.createFromOptions(fs, Object.assign({ baseOptions: { modelAssetBuffer: bytes, delegate }, runningMode: 'IMAGE' }, extra)); mp.delegate = delegate; return t; }
        catch (e) { last = e; }
      }
      throw last;
    };
    mp.msg = '準備しています'; DET.onStatus();
    if (mp.pose) try { mp.pose.close(); } catch (e) { /* */ }
    if (mp.face) try { mp.face.close(); } catch (e) { /* */ }
    mp.pose = await make(mp.vision.PoseLandmarker, pm.bytes, { numPoses: 6, outputSegmentationMasks: true, minPoseDetectionConfidence: 0.35, minPosePresenceConfidence: 0.35, minTrackingConfidence: 0.35 });
    mp.face = await make(mp.vision.FaceLandmarker, fm.bytes, { numFaces: 6, minFaceDetectionConfidence: 0.35, minFacePresenceConfidence: 0.35, outputFaceBlendshapes: false });
    mp.state = 'ready'; mp.msg = '';
  } catch (e) {
    mp.state = 'failed'; mp.msg = String(e && e.message || e).slice(0, 400);
  }
  DET.onStatus();
};
DET.useModelFile = async function (kind, file) {
  const buf = await file.arrayBuffer();
  await idb.put('model:' + kind, buf);
  store.set('modelName:' + kind, file.name);
  DET.mp.state = 'idle';
  await DET.loadMP();
};
DET.forgetModelFiles = async function () { await idb.del('model:pose'); await idb.del('model:face'); store.set('modelName:pose', null); store.set('modelName:face', null); };

// --------------------------------------------------------- shared helpers ---
const _small = makeCanvas(160, 90), _sctx = _small.getContext('2d', { willReadFrequently: true });
function smallLum(img, W, H) { // luminance thumbnail for per-person brightness
  const sw = 160, sh = Math.max(1, Math.round(160 * H / W));
  if (_small.height !== sh) _small.height = sh;
  _sctx.drawImage(img, 0, 0, sw, sh);
  const d = _sctx.getImageData(0, 0, sw, sh).data, L = new Float32Array(sw * sh);
  for (let i = 0; i < L.length; i++) L[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255;
  return { L, sw, sh, sx: sw / W, sy: sh / H };
}
function maskMeanL(m, sl) {
  let s = 0, n = 0;
  const x0 = Math.max(0, Math.floor(m.x * sl.sx)), x1 = Math.min(sl.sw - 1, Math.ceil((m.x + m.w) * sl.sx));
  const y0 = Math.max(0, Math.floor(m.y * sl.sy)), y1 = Math.min(sl.sh - 1, Math.ceil((m.y + m.h) * sl.sy));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const mx = Math.floor(((x + 0.5) / sl.sx - m.x) / m.w * m.gw), my = Math.floor(((y + 0.5) / sl.sy - m.y) / m.h * m.gh);
    if (mx < 0 || my < 0 || mx >= m.gw || my >= m.gh || m.data[my * m.gw + mx] < 128) continue;
    s += sl.L[y * sl.sw + x]; n++;
  }
  return n ? s / n : 0.45;
}
function nmsPersons(c) {
  c.sort((a, b) => (a.trunc - b.trunc) || (b.area - a.area));
  const keep = [];
  for (const p of c) {
    if (keep.some((k) => iou(k.box, p.box) > 0.5 || (overlapMin(k.box, p.box) > 0.8 && (p.box[3] - p.box[1]) < 1.6 * (k.box[3] - k.box[1]) && (k.box[3] - k.box[1]) < 1.6 * (p.box[3] - p.box[1])))) continue;
    keep.push(p);
  }
  return keep;
}
function nmsFaces(c) {
  c.sort((a, b) => b.width - a.width);
  const keep = [];
  for (const f of c) { if (keep.some((k) => iou(k.box, f.box) > 0.3 || overlapMin(k.box, f.box) > 0.6)) continue; keep.push(f); }
  return keep;
}
function tileRects(W, H, mode) {
  const r = [{ x: 0, y: 0, w: W, h: H, full: true }];
  const grid = mode === '2x2' ? [2, 0.6] : mode === '3x3' ? [3, 0.44] : null;
  if (grid) {
    const [n, f] = grid, tw = W * f, th = H * f;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) r.push({ x: Math.round((W - tw) * i / (n - 1)), y: Math.round((H - th) * j / (n - 1)), w: Math.round(tw), h: Math.round(th) });
  }
  return r;
}

// ------------------------------------------------------------- MediaPipe ---
const _tile = makeCanvas(64, 64), _tctx = _tile.getContext('2d');
const _crop = makeCanvas(256, 256), _cctx = _crop.getContext('2d');

function faceFromMP(lms, map) { // lms: normalized landmarks of the crop; map: (x,y)->[sx,sy]
  const lm = new Float32Array(FACE_IDX.length * 2);
  FACE_IDX.forEach((idx, j) => { const p = lms[idx]; const [x, y] = map(p.x, p.y); lm[2 * j] = x; lm[2 * j + 1] = y; });
  const [o0, on] = FG.oval;
  const box = polyBox(lm.subarray(2 * o0, 2 * (o0 + on)));
  const a = fpos(lm, 234), b = fpos(lm, 454);
  return { kind: 'lm', lm, box, width: Math.hypot(b[0] - a[0], b[1] - a[1]) };
}

function detectMP(img, W, H, wantFaces, fMinPx) {
  const mp = DET.mp, persons = [], faces = [];
  const sl = smallLum(img, W, H);
  for (const tl of tileRects(W, H, DET.tiles)) {
    const s = Math.min(1, (tl.full ? 960 : 640) / Math.max(tl.w, tl.h));
    const tw = Math.max(16, Math.round(tl.w * s)), th = Math.max(16, Math.round(tl.h * s));
    if (_tile.width !== tw || _tile.height !== th) { _tile.width = tw; _tile.height = th; }
    _tctx.drawImage(img, tl.x, tl.y, tl.w, tl.h, 0, 0, tw, th);
    mp.pose.detect(_tile, (r) => {
      for (let i = 0; i < r.landmarks.length; i++) {
        const mk = r.segmentationMasks && r.segmentationMasks[i]; if (!mk) continue;
        const m = mk.getAsFloat32Array(), mw = mk.width, mh = mk.height;
        let x0 = mw, y0 = mh, x1 = -1, y1 = -1, area = 0;
        for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (m[y * mw + x] > 0.5) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (area < 30) continue;
        const pad = 3; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(mw - 1, x1 + pad); y1 = Math.min(mh - 1, y1 + pad);
        const gw = x1 - x0 + 1, gh = y1 - y0 + 1, data = new Uint8Array(gw * gh);
        for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) data[y * gw + x] = clamp(m[(y + y0) * mw + x + x0] * 255 + 0.5, 0, 255);
        const kx = tl.w / mw, ky = tl.h / mh;
        const mask = { x: tl.x + x0 * kx, y: tl.y + y0 * ky, w: gw * kx, h: gh * ky, gw, gh, data };
        const lm = new Float32Array(33 * 3); let vis = 0;
        r.landmarks[i].forEach((p, j) => { lm[3 * j] = tl.x + p.x * tl.w; lm[3 * j + 1] = tl.y + p.y * tl.h; lm[3 * j + 2] = p.visibility == null ? 1 : p.visibility; vis += lm[3 * j + 2]; });
        const edge = 2 / s;
        const trunc = tl.full ? 0 : ((mask.x <= tl.x + edge && tl.x > 0) || (mask.y <= tl.y + edge && tl.y > 0) || (mask.x + mask.w >= tl.x + tl.w - edge && tl.x + tl.w < W) || (mask.y + mask.h >= tl.y + tl.h - edge && tl.y + tl.h < H)) ? 1 : 0;
        persons.push({ box: [mask.x, mask.y, mask.x + mask.w, mask.y + mask.h], mask, lm, score: vis / 33, trunc, area: area * kx * ky });
      }
    });
  }
  const keep = nmsPersons(persons);
  for (const p of keep) { p.meanL = maskMeanL(p.mask, sl); delete p.area; delete p.trunc; }
  if (wantFaces) {
    // whole picture first, then a close crop around every head the pose found
    const s = Math.min(1, 960 / Math.max(W, H)), tw = Math.round(W * s), th = Math.round(H * s);
    if (_tile.width !== tw || _tile.height !== th) { _tile.width = tw; _tile.height = th; }
    _tctx.drawImage(img, 0, 0, W, H, 0, 0, tw, th);
    const r0 = mp.face.detect(_tile);
    for (const f of r0.faceLandmarks) faces.push(faceFromMP(f, (x, y) => [x * W, y * H]));
    for (const p of keep) {
      const lm = p.lm, pts = [];
      for (let j = 0; j <= 10; j++) if (lm[3 * j + 2] > 0.5) pts.push([lm[3 * j], lm[3 * j + 1]]);
      if (pts.length < 3) continue;
      const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      const d = (a, b) => Math.hypot(lm[3 * a] - lm[3 * b], lm[3 * a + 1] - lm[3 * b + 1]);
      const est = Math.max(d(7, 8) * 1.05, d(2, 5) * 2.0, (p.box[3] - p.box[1]) * 0.09);
      if (est < fMinPx * 0.55) continue;
      if (faces.some((f) => cx > f.box[0] && cx < f.box[2] && cy > f.box[1] && cy < f.box[3])) continue;
      const side = Math.max(32, est * 2.6), sx = cx - side / 2, sy = cy - side * 0.48;
      _cctx.clearRect(0, 0, 256, 256);
      _cctx.drawImage(img, sx, sy, side, side, 0, 0, 256, 256);
      const r1 = mp.face.detect(_crop);
      for (const f of r1.faceLandmarks) faces.push(faceFromMP(f, (x, y) => [sx + x * side, sy + y * side]));
    }
  }
  return { persons: keep, faces: nmsFaces(faces) };
}

// ------------------------------------------------- built-in (no model) ---
// A still camera is assumed: the empty street ("plate") is the per-pixel median of
// frames spread over the clip; whatever differs from it, and is not a cast shadow, is a person.
const BG = {
  DW: 0, DH: 0, plate: null, W: 0, H: 0, frames: 0,
  cv: makeCanvas(16, 16), ctx: null,
  setSize(W, H) { this.W = W; this.H = H; this.DW = Math.min(480, W); this.DH = Math.max(1, Math.round(this.DW * H / W)); this.cv.width = this.DW; this.cv.height = this.DH; this.ctx = this.cv.getContext('2d', { willReadFrequently: true }); this.plate = null; },
  grab(img) { this.ctx.drawImage(img, 0, 0, this.W, this.H, 0, 0, this.DW, this.DH); return this.ctx.getImageData(0, 0, this.DW, this.DH).data; },
  setPlate(img) { this.plate = new Uint8ClampedArray(this.grab(img)); this.frames = 0; },
  async estimate(grabAt, dur, n = 21, onProg) {
    const shots = [];
    for (let i = 0; i < n; i++) { const img = await grabAt(dur * (i + 0.5) / n); shots.push(new Uint8ClampedArray(this.grab(img))); if (onProg) onProg(i + 1, n); }
    const N = this.DW * this.DH * 4, out = new Uint8ClampedArray(N), col = new Uint8Array(n);
    for (let i = 0; i < N; i++) { if ((i & 3) === 3) { out[i] = 255; continue; } for (let k = 0; k < n; k++) col[k] = shots[k][i]; col.sort(); out[i] = col[n >> 1]; }
    this.plate = out; this.frames = n;
  },
};
function morph(src, w, h, r, dilate) { // separable max (dilate) / min (erode) on a 0/1 map
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1; const a = Math.max(0, x - r), b = Math.min(w - 1, x + r), row = y * w;
    for (let i = a; i <= b; i++) { const s = src[row + i]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } }
    tmp[row + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1; const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
    for (let i = a; i <= b; i++) { const s = tmp[i * w + x]; if (dilate ? s : !s) { v = dilate ? 1 : 0; break; } }
    out[y * w + x] = v;
  }
  return out;
}
function skinYCC(r, g, b) {
  const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b, cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
  return cr > 135 && cr < 175 && cb > 80 && cb < 128 && r > 60 && r > b;
}
const _head = makeCanvas(96, 96), _hctx = _head.getContext('2d', { willReadFrequently: true });

function detectBG(img, W, H, wantFaces, fMinPx) {
  if (!BG.plate || BG.W !== W || BG.H !== H) return { persons: [], faces: [], note: '背景がまだありません' };
  const w = BG.DW, h = BG.DH, d = BG.grab(img), P = BG.plate, N = w * h;
  const dist = new Float32Array(N), fg0 = new Uint8Array(N);
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) {
    const r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2], R = P[4 * i], G = P[4 * i + 1], B = P[4 * i + 2];
    const v = Math.sqrt((r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2); dist[i] = v; hist[Math.min(255, v | 0)]++;
  }
  let acc = 0, med = 0; for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc >= N / 2) { med = k; break; } }
  const thr = Math.max(24, med * 3.2);
  let nfg = 0;
  const sh = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (dist[i] <= thr) continue;
    const r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2], R = P[4 * i], G = P[4 * i + 1], B = P[4 * i + 2];
    const l = r + g + b + 3, L = R + G + B + 3, ratio = l / L;
    const cd = Math.abs(r / l - R / L) + Math.abs(g / l - G / L) + Math.abs(b / l - B / L);
    if (ratio > 0.35 && ratio < 0.95 && cd < 0.07) { sh[i] = 1; continue; } // looks like a cast shadow: darker, same colour
    fg0[i] = 1; nfg++;
  }
  // Grey trousers on grey pavement also look like shadow. A cast shadow lies flat on the ground;
  // a leg hangs straight down from the body. Keep a shadow-like vertical run only when it starts
  // right under a body and is long compared with that body's height.
  {
    const fb = morph(morph(fg0, w, h, 2, true), w, h, 2, false);
    const lab = new Int32Array(N), st = new Int32Array(N), top = [0], bot = [0]; let nl = 0;
    for (let i0 = 0; i0 < N; i0++) {
      if (!fb[i0] || lab[i0]) continue;
      nl++; let sp = 0, y0 = h, y1 = 0; st[sp++] = i0; lab[i0] = nl;
      while (sp) {
        const i = st[--sp], x = i % w, y = (i / w) | 0; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && fb[i - 1] && !lab[i - 1]) { lab[i - 1] = nl; st[sp++] = i - 1; }
        if (x < w - 1 && fb[i + 1] && !lab[i + 1]) { lab[i + 1] = nl; st[sp++] = i + 1; }
        if (y > 0 && fb[i - w] && !lab[i - w]) { lab[i - w] = nl; st[sp++] = i - w; }
        if (y < h - 1 && fb[i + w] && !lab[i + w]) { lab[i + w] = nl; st[sp++] = i + w; }
      }
      top.push(y0); bot.push(y1);
    }
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (!sh[y * w + x]) { y++; continue; }
        const a = y; while (y < h && sh[y * w + x]) y++;
        let c = 0; for (let k = 1; k <= 2 && !c; k++) if (a - k >= 0) c = lab[(a - k) * w + x];
        if (c && y - a >= Math.max(6, 0.12 * (bot[c] - top[c] + 1))) for (let yy = a; yy < y; yy++) { fg0[yy * w + x] = 1; nfg++; }
      }
    }
  }
  let fg = morph(morph(fg0, w, h, 2, true), w, h, 2, false); // close
  fg = morph(morph(fg, w, h, 1, false), w, h, 1, true);      // open
  // fill holes: anything not reachable from the border is inside a person
  const outside = new Uint8Array(N), st = new Int32Array(N); let sp = 0;
  const push = (i) => { if (!fg[i] && !outside[i]) { outside[i] = 1; st[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) { const i = st[--sp], x = i % w, y = (i / w) | 0; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w); }
  for (let i = 0; i < N; i++) if (!outside[i]) fg[i] = 1;
  // connected components
  const lab = new Int32Array(N); let nl = 0; const comps = [];
  for (let i0 = 0; i0 < N; i0++) {
    if (!fg[i0] || lab[i0]) continue;
    nl++; lab[i0] = nl; sp = 0; st[sp++] = i0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    while (sp) {
      const i = st[--sp], x = i % w, y = (i / w) | 0; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && fg[i - 1] && !lab[i - 1]) { lab[i - 1] = nl; st[sp++] = i - 1; }
      if (x < w - 1 && fg[i + 1] && !lab[i + 1]) { lab[i + 1] = nl; st[sp++] = i + 1; }
      if (y > 0 && fg[i - w] && !lab[i - w]) { lab[i - w] = nl; st[sp++] = i - w; }
      if (y < h - 1 && fg[i + w] && !lab[i + w]) { lab[i + w] = nl; st[sp++] = i + w; }
    }
    comps.push({ ids: [nl], x0, y0, x1, y1, area });
  }
  // join pieces of one person split by an occluder or a gap
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < comps.length && !merged; a++) for (let b = a + 1; b < comps.length && !merged; b++) {
      const A = comps[a], B = comps[b];
      const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), minW = Math.min(A.x1 - A.x0, B.x1 - B.x0) + 1;
      const gap = Math.max(A.y0, B.y0) - Math.min(A.y1, B.y1), hh = Math.max(A.y1 - A.y0, B.y1 - B.y0) + 1;
      if (ox > 0.5 * minW && gap < 0.22 * hh) {
        A.ids.push(...B.ids); A.x0 = Math.min(A.x0, B.x0); A.y0 = Math.min(A.y0, B.y0); A.x1 = Math.max(A.x1, B.x1); A.y1 = Math.max(A.y1, B.y1); A.area += B.area;
        comps.splice(b, 1); merged = true;
      }
    }
  }
  const sx = W / w, sy = H / h, persons = [], faces = [];
  let sumL = 0;
  for (const c of comps) {
    if (c.area < N * 0.00035 || c.y1 - c.y0 < 8) continue;
    const ids = new Uint8Array(nl + 1); for (const q of c.ids) ids[q] = 1; const pad = 2;
    const x0 = Math.max(0, c.x0 - pad), y0 = Math.max(0, c.y0 - pad), x1 = Math.min(w - 1, c.x1 + pad), y1 = Math.min(h - 1, c.y1 + pad);
    const gw = x1 - x0 + 1, gh = y1 - y0 + 1, bin = new Uint8Array(gw * gh), data = new Uint8Array(gw * gh);
    let sl = 0, n = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = (y + y0) * w + x + x0; if (!ids[lab[i]]) continue;
      bin[y * gw + x] = 1; sl += 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; n++;
    }
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { // 3x3 soften
      let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) s += bin[yy * gw + xx]; }
      data[y * gw + x] = Math.round(s / 9 * 255);
    }
    const mask = { x: x0 * sx, y: y0 * sy, w: gw * sx, h: gh * sy, gw, gh, data };
    const p = { box: [c.x0 * sx, c.y0 * sy, (c.x1 + 1) * sx, (c.y1 + 1) * sy], mask, lm: null, meanL: n ? sl / n / 255 : 0.45, score: 1 };
    persons.push(p); sumL += c.area;
    if (wantFaces) { const f = faceFromSkin(img, p, fMinPx); if (f) faces.push(f); }
  }
  const note = nfg > N * 0.4 ? '画面の大部分が背景と違います（カメラが動いている？）' : '';
  return { persons, faces, note };
}
function faceFromSkin(img, p, fMinPx) {
  const [bx0, by0, bx1, by1] = p.box, bh = by1 - by0;
  if (bh * 0.115 < fMinPx * 0.55 || bh < 40) return null;
  // head column: where the person's mask is, in the top band
  const m = p.mask; let cx = 0, n = 0;
  const band = Math.floor(m.gh * 0.12);
  for (let y = 0; y < band; y++) for (let x = 0; x < m.gw; x++) if (m.data[y * m.gw + x] > 128) { cx += x; n++; }
  if (!n) return null;
  cx = m.x + (cx / n + 0.5) / m.gw * m.w;
  const side = bh * 0.2, sx = cx - side / 2, sy = by0 - bh * 0.01;
  const S = 96; _hctx.clearRect(0, 0, S, S);
  _hctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
  const d = _hctx.getImageData(0, 0, S, S).data, sk = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const X = sx + (i % S + 0.5) / S * side, Y = sy + ((i / S | 0) + 0.5) / S * side;
    const mx = Math.floor((X - m.x) / m.w * m.gw), my = Math.floor((Y - m.y) / m.h * m.gh);
    if (mx < 0 || my < 0 || mx >= m.gw || my >= m.gh || m.data[my * m.gw + mx] < 100) continue;
    if (skinYCC(d[4 * i], d[4 * i + 1], d[4 * i + 2])) sk[i] = 1;
  }
  // largest skin blob
  const lab = new Int32Array(S * S), st = new Int32Array(S * S); let best = 0, bestN = 0, nl = 0;
  for (let i0 = 0; i0 < S * S; i0++) {
    if (!sk[i0] || lab[i0]) continue; nl++; let sp = 0, cnt = 0; st[sp++] = i0; lab[i0] = nl;
    while (sp) { const i = st[--sp], x = i % S, y = (i / S) | 0; cnt++; for (const j of [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, y > 0 ? i - S : -1, y < S - 1 ? i + S : -1]) if (j >= 0 && sk[j] && !lab[j]) { lab[j] = nl; st[sp++] = j; } }
    if (cnt > bestN) { bestN = cnt; best = nl; }
  }
  if (bestN < S * S * 0.09) return null; // the back of a head, or covered
  // rows: fill holes per row (eyes, mouth) and cut the neck where the blob narrows
  const rows = []; let maxW = 0;
  for (let y = 0; y < S; y++) { let a = -1, b = -1; for (let x = 0; x < S; x++) if (lab[y * S + x] === best) { if (a < 0) a = x; b = x; } rows.push([a, b]); if (a >= 0) maxW = Math.max(maxW, b - a + 1); }
  let top = rows.findIndex((r) => r[0] >= 0), bot = top;
  if (top < 0) return null;
  let widest = top; for (let y = top; y < S; y++) { if (rows[y][0] >= 0 && rows[y][1] - rows[y][0] + 1 >= maxW * 0.97) widest = y; }
  for (let y = top; y < S; y++) { const r = rows[y]; if (r[0] < 0) break; if (y > widest && r[1] - r[0] + 1 < maxW * 0.62) break; bot = y; }
  let m00 = 0, m10 = 0, m01 = 0, m20 = 0, m02 = 0, m11 = 0;
  for (let y = top; y <= bot; y++) { const [a, b] = rows[y]; for (let x = a; x <= b; x++) { m00++; m10 += x; m01 += y; m20 += x * x; m02 += y * y; m11 += x * y; } }
  if (m00 < 30) return null;
  const mx = m10 / m00, my = m01 / m00, cxx = m20 / m00 - mx * mx, cyy = m02 / m00 - my * my, cxy = m11 / m00 - mx * my;
  const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
  let ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy); // major axis angle
  let rx = 2 * Math.sqrt(Math.max(1, l2)), ry = 2 * Math.sqrt(Math.max(1, l1));
  ang -= Math.PI / 2; // measure from the vertical so ry is the face height
  if (ang < -Math.PI / 2) ang += Math.PI; if (ang > Math.PI / 2) ang -= Math.PI;
  if (Math.abs(ang) > 0.6) ang = 0;
  const k = side / S;
  const ell = [sx + (mx + 0.5) * k, sy + (my + 0.5) * k, rx * k * 1.02, ry * k * 1.02, ang, 0];
  ell[5] = clamp((sy + (top + 0.5) * k - ell[1]) / ell[3], -1.2, -0.3); // hairline, in units of ry
  const width = ell[2] * 2;
  if (width < 6) return null;
  return { kind: 'ell', ell, box: [ell[0] - ell[2], ell[1] - ell[3], ell[0] + ell[2], ell[1] + ell[3]], width };
}

// --------------------------------------------------------------- entry ---
// method: 'mp' | 'bg'
DET.detect = function (img, W, H, method, wantFaces, fMinPx) {
  const t0 = performance.now();
  let r;
  if (method === 'mp' && DET.mp.state === 'ready') r = detectMP(img, W, H, wantFaces, fMinPx);
  else r = detectBG(img, W, H, wantFaces, fMinPx);
  DET.lastMs = performance.now() - t0;
  r.method = method; r.W = W; r.H = H;
  return r;
};
