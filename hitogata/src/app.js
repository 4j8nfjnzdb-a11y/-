'use strict';
// ---- the app: parameters, playback, checks, scan and export --------------

const MB_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.65.0/dist/bundles/mediabunny.min.mjs';
const FACE_MIN_DETECT = 20; // px: smaller heads are not searched for faces (independent of the apply range)

// every number carries a unit; defaults show the effect clearly
const DEFS = [
  { k: 'hold', label: '保持時間（検出が途切れたとき）', unit: '秒', min: 0, max: 1, step: 0.01, v: 0.2 },
  { k: 'texSize', label: '質感の大きさ（身長に対して）', unit: '%', min: 5, max: 200, step: 1, v: 45, mode: 0 },
  { k: 'shade', label: '陰影の残し具合', unit: '%', min: 0, max: 100, step: 1, v: 70, mode: 0 },
  { k: 'dilate', label: '膨張', unit: 'px', min: 0, max: 20, step: 0.5, v: 6, mode: 1 },
  { k: 'feather', label: '縁のぼかし', unit: 'px', min: 0, max: 20, step: 0.5, v: 3, mode: 1 },
  { k: 'depth', label: '縁の内側の影：深さ', unit: 'px', min: 0, max: 80, step: 1, v: 22, mode: 1 },
  { k: 'shadowAmt', label: '縁の内側の影：濃さ', unit: '%', min: 0, max: 100, step: 1, v: 45, mode: 1 },
  { k: 'furLen', label: '長さ', unit: 'px', min: 0, max: 20, step: 0.5, v: 3, mode: 1 },
  { k: 'furDen', label: '密度（縁の画素のうち毛の生える割合）', unit: '%', min: 0, max: 100, step: 1, v: 30, mode: 1 },
  { k: 'hMin', label: '身長の下限', unit: 'px', min: 0, max: 2000, step: 1, v: 0, mode: 1 },
  { k: 'hMax', label: '身長の上限', unit: 'px', min: 0, max: 2000, step: 1, v: 2000, mode: 1, top: true },
  { k: 'rate1', label: '適用率（人ごとにランダムで固定）', unit: '%', min: 0, max: 100, step: 1, v: 100, mode: 1 },
  { k: 'detail', label: '取り除く細部の大きさ', unit: 'px', min: 2, max: 40, step: 0.5, v: 10, mode: 2 },
  { k: 'grain', label: '肌のきめの量（頬と比べて）', unit: '%', min: 0, max: 200, step: 1, v: 100, mode: 2 },
  { k: 'faceFeather', label: '輪郭の縁のぼかし', unit: 'px', min: 0, max: 20, step: 0.5, v: 5, mode: 2 },
  { k: 'fMin', label: '顔幅の下限', unit: 'px', min: 0, max: 600, step: 1, v: 60, mode: 2 },
  { k: 'fMax', label: '顔幅の上限', unit: 'px', min: 0, max: 2000, step: 1, v: 2000, mode: 2, top: true },
  { k: 'rate2', label: '適用率（人ごとにランダムで固定）', unit: '%', min: 0, max: 100, step: 1, v: 100, mode: 2 },
  { k: 'diffGain', label: '差分の強調', unit: '倍', min: 1, max: 16, step: 0.5, v: 4 },
  { k: 'rangeA', label: '開始', unit: '秒', min: 0, max: 14, step: 0.01, v: 0 },
  { k: 'rangeB', label: '終了', unit: '秒', min: 0, max: 14, step: 0.01, v: 14, top: true },
];
const DEF = Object.fromEntries(DEFS.map((d) => [d.k, d]));
const P = Object.assign({ mode: 1, faceKind: 'skin' }, Object.fromEntries(DEFS.map((d) => [d.k, d.v])));

const S = {
  src: null, method: 'bg', view: 0, hold: false, showDet: true,
  t: 0, playing: false, frameIdx: -1, t0: 0, p0: 0,
  lastDet: null, lastFS: null, lastM: null, img: null,
  stats: { n: 0, p: 0, f: 0 },
  cache: null, scan: null, test: null, zoomId: 0, busy: null, result: null,
  tex: { kind: 'sample', name: '見本のフェルト', video: null, file: null, lastT: -1 },
};
let R = null; const TR = new Tracker();
// hidden players: kept in the page and barely visible (some browsers stop presenting frames of
// elements that are fully transparent); no crossOrigin, which can refuse a blob: URL in a sandbox
function hiddenVideo(loop) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = !!loop;
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  Object.assign(v.style, { position: 'fixed', left: '0', bottom: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' });
  return v;
}
const video = hiddenVideo(false);       // the clip being worked on
const plateVideo = hiddenVideo(false);  // a second player for estimating the empty street, so the preview is never blocked
const texVideo = hiddenVideo(true);     // the felt / fur material
const texCanvas = makeCanvas(16, 16), texCtx = texCanvas.getContext('2d');
let MB = null;
const yieldUI = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
async function loadMB() {
  if (MB) return MB;
  try { MB = await import(MB_URL); } catch (e) { MB = await import(ASSETS + 'mediabunny.min.mjs'); }
  return MB;
}

// ------------------------------------------------------------ parameters ---
function decimals(step) { const s = String(step); return s.includes('.') ? s.split('.')[1].length : 0; }
function mountParam(d) {
  const host = $('pp-' + d.k); if (!host) return;
  const id = 'p_' + d.k;
  host.innerHTML = `<div class="prm"><label for="${id}" title="ダブルクリックで初期値">${d.label}</label><input type="number" id="${id}" min="${d.min}" max="${d.max}" step="${d.step}"><span class="u">${d.unit}</span><input type="range" id="${id}_r" min="${d.min}" max="${d.max}" step="${d.step}" aria-label="${d.label}（${d.unit}）"></div>`;
  const num = $(id), rg = $(id + '_r');
  rg.addEventListener('input', () => setParam(d.k, +rg.value));
  num.addEventListener('change', () => { const v = +num.value; setParam(d.k, Number.isFinite(v) ? clamp(v, d.min, d.max) : d.v); });
  host.querySelector('label').addEventListener('dblclick', () => setParam(d.k, d.v));
  syncParam(d.k);
}
function syncParam(k) {
  const d = DEF[k], num = $('p_' + k), rg = $('p_' + k + '_r'); if (!num) return;
  num.value = (+P[k]).toFixed(decimals(d.step)); rg.value = P[k];
}
function setLimit(k, max, keepTop) {
  const d = DEF[k], wasTop = P[k] >= d.max - 1e-9;
  d.max = max; if (d.top) d.v = max;
  const num = $('p_' + k), rg = $('p_' + k + '_r'); if (num) { num.max = max; rg.max = max; }
  if ((keepTop && wasTop) || P[k] > max) P[k] = max;
  syncParam(k);
}
function setParam(k, v) {
  P[k] = v; syncParam(k);
  if (k === 'rangeA' && P.rangeB < v) { P.rangeB = v; syncParam('rangeB'); }
  if (k === 'rangeB' && P.rangeA > v) { P.rangeA = v; syncParam('rangeA'); }
  if (k === 'rangeA' || k === 'rangeB') { scanSummary(); return; }
  rerender();
  if (S.cache && ['hold', 'hMin', 'hMax', 'rate1', 'fMin', 'fMax', 'rate2'].includes(k)) analyzeSoon();
}

// --------------------------------------------------------------- helpers ---
function seg(id, attr, val) { for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset[attr] === String(val))); }
function busy(text, frac) {
  $('busy').hidden = false; $('busyText').textContent = text;
  $('busyBar').style.width = frac == null ? '0' : (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
}
function busyEnd() { $('busy').hidden = true; S.busy = null; }
function effMethod() { return S.method === 'mp' && DET.mp.state === 'ready' ? 'mp' : 'bg'; }
function frameDur() { return 1 / (S.src ? S.src.fps : 30); }
function waitEvent(el, ev) { return new Promise((res) => el.addEventListener(ev, res, { once: true })); }
// resolves on the event, rejects on a media error or after `ms`
function waitMedia(el, ev, ms) {
  return new Promise((res, rej) => {
    const done = (f, x) => { clearTimeout(tm); el.removeEventListener(ev, onEv); el.removeEventListener('error', onErr); f(x); };
    const onEv = () => done(res), onErr = () => done(rej, new Error(mediaError(el)));
    const tm = setTimeout(() => done(rej, new Error(`${(ms / 1000).toFixed(0)} 秒待っても応答がありません`)), ms);
    el.addEventListener(ev, onEv); el.addEventListener('error', onErr);
  });
}
function mediaError(el) {
  const c = el.error && el.error.code;
  return c === 4 ? 'この形式はこのブラウザで再生できません（HEVC/H.265 の MOV などは開けないことがあります。H.264 の MP4 で試してください）'
    : c === 3 ? '動画の中身を読めませんでした（ファイルが壊れているか、対応していない符号化です）'
      : c === 2 ? 'ファイルを読み込めませんでした' : '動画を開けませんでした';
}
async function seekEl(el, t, ms = 5000) {
  if (Math.abs(el.currentTime - t) < 1e-4 && el.readyState >= 2) return;
  const p = waitMedia(el, 'seeked', ms); el.currentTime = t;
  try { await p; } catch (e) { /* a slow seek must not freeze the page */ }
  if (el.readyState < 2) { try { await waitMedia(el, 'canplay', 2000); } catch (e) { /* */ } }
}
const seekVideo = (t) => seekEl(video, t);
function fixDuration(v) { // files written by a recorder may report an infinite duration until the end is read
  return new Promise((res) => { const on = () => { v.removeEventListener('durationchange', on); const d = v.duration; v.currentTime = 0; res(isFinite(d) && d > 0 ? d : 10); }; v.addEventListener('durationchange', on); v.currentTime = 1e7; setTimeout(on, 4000); });
}

// ---------------------------------------------------------------- sources ---
async function setSource(src) {
  S.src = src; S.cache = null; S.scan = null; S.result = null; $('saveBtn').hidden = true; $('expInfo').textContent = '';
  R.resize(src.W, src.H, Math.max(1, Math.round(src.W * Math.min(1, 960 / Math.max(src.W, src.H)))), Math.max(1, Math.round(src.H * Math.min(1, 960 / Math.max(src.W, src.H)))));
  TR.reset(src.W, src.H);
  BG.setSize(src.W, src.H);
  document.documentElement.style.setProperty('--asp', (src.W / src.H).toFixed(4));
  setLimit('hMin', Math.round(src.H * 1.5)); setLimit('hMax', Math.round(src.H * 1.5), true);
  setLimit('fMin', Math.round(src.W * 0.6)); setLimit('fMax', Math.round(src.W), true);
  setLimit('rangeA', +src.dur.toFixed(2)); setLimit('rangeB', +src.dur.toFixed(2), true);
  P.rangeA = 0; P.rangeB = +src.dur.toFixed(2); syncParam('rangeA'); syncParam('rangeB');
  S.stats = { n: 0, p: 0, f: 0 }; S.zoomId = 0;
  $('srcInfo').textContent = `${src.name}　${src.W}×${src.H} px・${src.fps.toFixed(2)} コマ/秒・${src.dur.toFixed(2)} 秒`;
  $('seek').max = Math.max(1, Math.round(src.dur * src.fps));
  scanSummary(); renderMisses(); fmtNote();
}
async function useSample() {
  stop();
  video.removeAttribute('src'); video.load();
  await setSource({ kind: 'sample', id: 'sample', name: '見本（描いた街の映像・音なし）', W: SAMPLE.W, H: SAMPLE.H, fps: SAMPLE.FPS, dur: SAMPLE.DUR, firstTs: 0 });
  BG.setPlate(SAMPLE.plate);
  setMethod('bg', true);
  S.t = 2.0; showSampleFrame(); play();
}
async function openFile(file) {
  if (!file) return;
  if (!(file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name))) { setVerdict('none', '開けません', '動画のファイルを選んでください（MP4・MOV・WebM など）。'); return; }
  stop();
  const prevUrl = S.src && S.src.url;
  setVerdict('weak', '読み込み中', `${file.name} を開いています…`);
  $('srcInfo').textContent = `${file.name} を開いています…`;
  const url = URL.createObjectURL(file);
  video.src = url; video.load();
  try { await waitMedia(video, 'loadedmetadata', 20000); }
  catch (e) {
    URL.revokeObjectURL(url);
    const msg = `${file.name} を開けませんでした：${e.message}`;
    setVerdict('none', '開けません', msg); $('srcInfo').textContent = msg;
    if (S.src && S.src.kind === 'file' && prevUrl) { video.src = prevUrl; video.load(); }
    return;
  }
  if (prevUrl) URL.revokeObjectURL(prevUrl);
  let dur = video.duration; if (!isFinite(dur) || !(dur > 0)) dur = await fixDuration(video);
  if (!video.videoWidth || !video.videoHeight) { setVerdict('none', '開けません', `${file.name} には映像がありません。`); return; }
  const src = { kind: 'file', id: `${file.name}|${file.size}|${file.lastModified}`, name: file.name, file, url, W: video.videoWidth, H: video.videoHeight, fps: 30, dur, firstTs: 0 };
  await setSource(src);
  // show the first picture before anything slow happens
  await seekVideo(0.001);
  showVideoFrame(true);
  if (DET.mp.state === 'idle' || DET.mp.state === 'failed') DET.loadMP();
  setMethod(DET.mp.state === 'failed' ? 'bg' : 'mp', true);
  // exact frame rate and first timestamp, in the background (used by the scan and export)
  (async () => {
    try {
      const mb = await loadMB();
      const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
      const tr = await input.getPrimaryVideoTrack();
      if (tr && S.src === src) {
        const st = await tr.computePacketStats(120); if (st.averagePacketRate > 1) src.fps = st.averagePacketRate;
        src.firstTs = await tr.getFirstTimestamp();
        if (S.src === src) { $('srcInfo').textContent = `${src.name}　${src.W}×${src.H} px・${src.fps.toFixed(2)} コマ/秒・${src.dur.toFixed(2)} 秒`; $('seek').max = Math.max(1, Math.round(src.dur * src.fps)); }
      }
    } catch (e) { /* stays at 30 frames per second */ }
  })();
}
function setTextureCanvas(c, name) {
  const s = Math.min(1, 1024 / Math.max(c.width, c.height));
  texCanvas.width = Math.max(1, Math.round(c.width * s)); texCanvas.height = Math.max(1, Math.round(c.height * s));
  texCtx.drawImage(c, 0, 0, texCanvas.width, texCanvas.height);
  R.uploadTexture(texCanvas, texCanvas.width, texCanvas.height);
  const pv = $('texPrev').getContext('2d'); pv.drawImage(texCanvas, 0, 0, 96, 64);
  if (name) $('texInfo').textContent = name;
}
function useSampleTexture() {
  texVideo.pause(); texVideo.removeAttribute('src');
  S.tex = { kind: 'sample', name: '見本のフェルト（描いたもの）', video: null, file: null, lastT: -1 };
  setTextureCanvas(SAMPLE.felt(512), S.tex.name); rerender();
}
async function openTexture(file) {
  if (!file) return;
  if (file.type.startsWith('image/')) {
    const bmp = await createImageBitmap(file);
    texVideo.pause(); S.tex = { kind: 'image', name: file.name, video: null, file, lastT: -1 };
    setTextureCanvas(bmp, `${file.name}　${bmp.width}×${bmp.height} px（静止画）`); rerender(); return;
  }
  texVideo.src = URL.createObjectURL(file);
  try { await waitEvent(texVideo, 'loadeddata'); } catch (e) { return; }
  texVideo.play().catch(() => {});
  S.tex = { kind: 'video', name: file.name, video: texVideo, file, lastT: -1 };
  setTextureCanvas(texVideo, `${file.name}　${texVideo.videoWidth}×${texVideo.videoHeight} px・${texVideo.duration.toFixed(1)} 秒（繰り返し）`);
  rerender();
}
function updateTexture() {
  const v = S.tex.video; if (!v || v.readyState < 2) return;
  if (v.currentTime === S.tex.lastT) return;
  S.tex.lastT = v.currentTime; setTextureCanvas(v);
}

// -------------------------------------------------------------- detection ---
function setMethod(m, quiet) {
  S.method = m; seg('methodSeg', 'm', m);
  if (m === 'mp' && (DET.mp.state === 'idle' || DET.mp.state === 'failed') && !quiet) DET.loadMP();
  if (effMethod() === 'bg' && S.src && S.src.kind === 'file' && !BG.plate) estimatePlate();
  methodUI(); redetect();
}
function methodUI() {
  const mp = DET.mp, m = S.method;
  $('mpBox').hidden = m !== 'mp'; $('bgBox').hidden = m !== 'bg' && effMethod() !== 'bg';
  const stTxt = { idle: 'まだ読み込んでいません', loading: '読み込み中：' + mp.msg, ready: `読み込み済み（${mp.delegate}）・姿勢モデル：${mp.origin.pose}・顔モデル：${mp.origin.face}`, failed: '読み込めませんでした：' + mp.msg };
  $('mpStatus').textContent = 'MediaPipe：' + stTxt[mp.state];
  $('mpHelp').open = mp.state === 'failed';
  let note = '';
  if (m === 'mp' && mp.state !== 'ready') note = 'MediaPipe の準備ができるまで、内蔵の検出で動かしています。';
  if (S.src && S.src.kind === 'sample' && m === 'mp') note += '見本の人は描いた絵なので、MediaPipe ではほとんど見つかりません。';
  if (S.src && S.src.kind === 'sample' && m === 'bg') note = '見本は背景が動かないので、内蔵の背景差分で検出しています。';
  $('methodNote').textContent = note; $('methodNote').hidden = !note;
  const job = plateJob && S.src && plateJob.src === S.src ? plateJob : null;
  $('bgStatus').textContent = BG.plate ? (S.src && S.src.kind === 'sample' ? '背景：見本の空の街並み（人のいない画面）' : `背景：${BG.frames} コマの中央値から推定`)
    : job && job.err ? '背景を推定できませんでした：' + job.err : job ? `背景（人のいない画面）を推定しています ${job.i} / ${job.n}。終わるまで内蔵の検出は働きません。` : '背景：まだ推定していません';
  $('bgRedo').hidden = !S.src || S.src.kind === 'sample';
}
DET.onStatus = () => {
  methodUI();
  if (DET.mp.state === 'ready' && S.method === 'mp') { S.cache = null; redetect(); }
  if (DET.mp.state === 'failed' && S.method === 'mp' && S.src && S.src.kind === 'file' && !BG.plate) estimatePlate();
};
// the empty street for the built-in detector: estimated on a second player, so the preview keeps going
let plateJob = null;
function estimatePlate() {
  if (!S.src || S.src.kind !== 'file') return Promise.resolve();
  if (plateJob && plateJob.src === S.src) return plateJob.p;
  const src = S.src, job = { src, i: 0, n: 21, err: '' };
  plateJob = job;
  job.p = (async () => {
    methodUI();
    try {
      plateVideo.src = src.url; plateVideo.load();
      await waitMedia(plateVideo, 'loadeddata', 20000);
      const plate = await BG.estimate(async (t) => { await seekEl(plateVideo, t, 4000); return plateVideo; }, src.dur, job.n, (i) => { job.i = i; methodUI(); });
      if (S.src === src) BG.plate = plate;
    } catch (e) { job.err = e.message || String(e); }
    plateVideo.removeAttribute('src'); plateVideo.load();
    if (S.src === src) { methodUI(); redetect(); }
  })();
  return job.p;
}
function cacheGet(t) {
  const C = S.cache; if (!C || C.key !== cacheKey() || !(P.mode === 1 || C.faces)) return null;
  let lo = 0, hi = C.times.length - 1; if (hi < 0) return null;
  while (lo < hi) { const m = (lo + hi) >> 1; if (C.times[m] < t) lo = m + 1; else hi = m; }
  let best = lo; if (lo > 0 && Math.abs(C.times[lo - 1] - t) < Math.abs(C.times[lo] - t)) best = lo - 1;
  return Math.abs(C.times[best] - t) < 0.5 * frameDur() ? C.dets[best] : null;
}
function cacheKey() { const m = effMethod(); return `${S.src.id}|${m}|${m === 'mp' ? DET.tiles + DET.mp.origin.pose : BG.frames}`; }

// ------------------------------------------------------------ the frame ---
function processFrame(img, t, o = {}) {
  const src = S.src;
  let det = cacheGet(t);
  if (!det) det = DET.detect(img, src.W, src.H, effMethod(), P.mode === 2, FACE_MIN_DETECT);
  S.lastDet = det;
  R.upload(img);
  const fs = (TR.lastT === null || Math.abs(t - TR.lastT) > 1e-6) ? TR.update(det, t, P, P.mode === 1) : TR.state(t, P, P.mode === 1);
  S.lastFS = fs; S.t = t;
  if (P.mode === 1) R.uploadMasks(TR.union, TR.label);
  if (!o.export) updateTexture();
  R.process(fs, P);
  if (o.count) { S.stats.n++; if (fs.c.pSeen) S.stats.p++; if (fs.c.fSeen) S.stats.f++; }
  return fs;
}
function show(o = {}) {
  const T = S.test;
  const mode = T && T.phase === 'show' ? (T.cond ? 0 : 1) : (S.hold ? 1 : S.view);
  R.display(mode, P.diffGain);
  if (o.export) return;
  S.lastM = (T || !S.lastFS) ? null : R.measure();
  drawOverlay(); verdict(); drawZoom(); timecode();
}
function rerender() {
  if (!S.lastDet || !S.src || S.busy) return;
  // recompose with the current tracks; detection is only redone when its inputs change
  guard(() => {
    const fs = TR.state(S.t, P, P.mode === 1); S.lastFS = fs;
    if (P.mode === 1) R.uploadMasks(TR.union, TR.label);
    R.process(fs, P); show();
  });
}
function redetect() {
  if (!S.src || S.busy) return;
  TR.clear();
  guard(() => {
    if (S.src.kind === 'sample') { const tf = S.frameIdx / S.src.fps; processFrame(SAMPLE.render(tf), tf); show(); }
    else if (video.readyState >= 2) { processFrame(video, S.t); show(); }
  });
}
function showSampleFrame(count) {
  const fi = Math.floor(S.t * SAMPLE.FPS + 1e-6) % SAMPLE.frames;
  S.frameIdx = fi; const tf = fi / SAMPLE.FPS;
  guard(() => { processFrame(SAMPLE.render(tf), tf, { count }); show(); });
}
function showVideoFrame(force, mediaTime) {
  const t = mediaTime != null ? mediaTime : video.currentTime;
  if (!force && Math.abs(t - TR.lastT) < 1e-6) return;
  if (video.readyState < 2) return;
  guard(() => { processFrame(video, t, { count: S.playing }); show(); });
}

// --------------------------------------------------------------- playback ---
function play() {
  if (!S.src || S.busy) return;
  S.playing = true; $('play').textContent = '停止'; $('play').setAttribute('aria-pressed', 'true');
  if (S.src.kind === 'file') video.play().catch(() => {});
  else { S.t0 = S.t; S.p0 = performance.now(); }
}
function stop() {
  S.playing = false; $('play').textContent = '再生'; $('play').setAttribute('aria-pressed', 'false');
  if (!video.paused) video.pause();
}
async function seekTo(t) {
  if (!S.src) return;
  t = clamp(t, 0, Math.max(0, S.src.dur - frameDur() * 0.5));
  if (S.src.kind === 'sample') { S.t = t; S.t0 = t; S.p0 = performance.now(); showSampleFrame(); }
  else { await seekVideo(t + 1e-3); if (!('requestVideoFrameCallback' in video)) showVideoFrame(true); }
}
function step(n) { stop(); seekTo((S.src.kind === 'sample' ? S.frameIdx / S.src.fps : S.t) + n * frameDur()); }
function onVideoFrame(now, meta) {
  video.requestVideoFrameCallback(onVideoFrame); // first, so an error below cannot stop the loop
  if (S.src && S.src.kind === 'file' && !S.busy) showVideoFrame(false, meta.mediaTime);
}
// an error in one frame must not stop playback or leave the screen silent
function guard(fn) {
  try { fn(); }
  catch (e) { console.error(e); setVerdict('none', 'エラー', '処理中にエラーが起きました：' + (e && e.message || e)); }
}
function tick(now) {
  requestAnimationFrame(tick);
  if (S.src && S.src.kind === 'sample' && S.playing && !S.busy) {
    S.t = (S.t0 + (now - S.p0) / 1000) % S.src.dur;
    const fi = Math.floor(S.t * SAMPLE.FPS) % SAMPLE.frames;
    if (fi !== S.frameIdx) showSampleFrame(true);
  }
  if (S.src && S.src.kind === 'file' && !('requestVideoFrameCallback' in video) && !S.busy && Math.abs(video.currentTime - TR.lastT) > 1e-4) showVideoFrame(false);
}
function timecode() {
  const src = S.src; if (!src) return;
  const fi = Math.round(S.t * src.fps);
  $('tc').textContent = `${S.t.toFixed(2)} / ${src.dur.toFixed(2)} 秒・コマ ${fi}`;
  if (document.activeElement !== $('seek')) $('seek').value = fi;
}

// ------------------------------------------------- overlay and the verdict ---
const COL = {};
function readColors() { const cs = getComputedStyle(document.documentElement); for (const k of ['ok', 'held', 'off', 'bad', 'face', 'ink']) COL[k] = cs.getPropertyValue('--' + k).trim(); }
function drawOverlay() {
  const ov = $('ov'), cv = $('cv'), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  ov.style.left = cv.offsetLeft + 'px'; ov.style.top = cv.offsetTop + 'px'; ov.style.width = w + 'px'; ov.style.height = h + 'px';
  if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) { ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr); }
  const c = ov.getContext('2d'); c.clearRect(0, 0, ov.width, ov.height);
  const fs = S.lastFS; if (!S.showDet || S.test || !fs || !S.src) return;
  const k = ov.width / S.src.W;
  c.font = `${Math.round(11 * dpr)}px ${getComputedStyle(document.body).fontFamily}`; c.textBaseline = 'bottom';
  const tag = (x, y, text, col) => {
    const pw = c.measureText(text).width + 8 * dpr, ph = 15 * dpr;
    y = Math.max(ph, y);
    c.fillStyle = col; c.fillRect(x, y - ph, pw, ph); c.fillStyle = '#fff'; c.fillText(text, x + 4 * dpr, y - 2 * dpr);
  };
  for (const p of fs.persons) {
    const b = p.rawBox, col = p.state === 'held' ? COL.held : p.applied ? COL.ok : COL.off;
    c.strokeStyle = col; c.lineWidth = (p.applied ? 2 : 1.25) * dpr; c.setLineDash(p.applied && p.state !== 'held' ? [] : [5 * dpr, 4 * dpr]);
    c.strokeRect(b[0] * k, b[1] * k, (b[2] - b[0]) * k, (b[3] - b[1]) * k);
    let t = `#${p.id} 身長 ${Math.round(p.height)}px`;
    if (p.state === 'held') t += ` 保持 ${p.since.toFixed(2)}秒`;
    if (p.approx) t += ' 形は骨格から近似';
    if (P.mode === 1 && !p.applied) t += p.reason === 'size' ? ' 範囲外' : ' 適用率で外す';
    tag(b[0] * k, b[1] * k, t, col);
    if (p.faceMissing && P.mode === 2) tag(b[0] * k, b[1] * k + 17 * dpr, '顔が見えているのに顔を検出できていない', COL.bad);
    if (p.id === S.zoomId) { c.setLineDash([]); c.strokeStyle = COL.ink; c.lineWidth = 1 * dpr; c.strokeRect(b[0] * k - 3 * dpr, b[1] * k - 3 * dpr, (b[2] - b[0]) * k + 6 * dpr, (b[3] - b[1]) * k + 6 * dpr); }
  }
  for (const f of fs.faces) {
    const col = f.state === 'held' ? COL.held : f.applied ? COL.face : COL.off;
    c.strokeStyle = col; c.lineWidth = (f.applied ? 2 : 1.25) * dpr; c.setLineDash(f.applied && f.state !== 'held' ? [] : [4 * dpr, 3 * dpr]);
    c.beginPath(); f.oval.forEach(([x, y], i) => (i ? c.lineTo(x * k, y * k) : c.moveTo(x * k, y * k))); c.closePath(); c.stroke();
    let t = `顔#${f.id} 幅 ${Math.round(f.width)}px`;
    if (f.state === 'held') t += ' 保持';
    if (P.mode === 2 && !f.applied) t += f.reason === 'size' ? ' 範囲外' : ' 適用率で外す';
    const bx = Math.min(...f.oval.map((q) => q[0])), by = Math.max(...f.oval.map((q) => q[1]));
    tag(bx * k, by * k + 17 * dpr, t, col);
  }
  c.setLineDash([]);
}
function setVerdict(kind, pill, text) {
  const v = $('verdict'); v.className = 'verdict ' + kind; $('vPill').textContent = pill; $('vText').textContent = text;
}
function verdict() {
  const fs = S.lastFS, m = S.lastM; if (!fs) return;
  const c = fs.c, eff = effMethod();
  const meth = eff === 'mp' ? `MediaPipe（${DET.mp.delegate}）` : '内蔵（背景差分）';
  const note = (S.lastDet && S.lastDet.note ? `・${S.lastDet.note}` : '') + (fs.persons.some((p) => p.approx) ? '・人の形を骨格から近似しています（マスクが得られなかったため）' : '');
  const pct = (x) => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
  if (P.mode === 1) {
    const n = c.pSeen + c.pHeld;
    if (!n) setVerdict('none', '検出なし', `このコマでは人を検出していません（${meth}${note}）。効果が見えないのは検出の失敗です。`);
    else if (!c.pApplied) setVerdict('out', '範囲外', `人を ${n} 人検出していますが、適用は 0 人です（身長が範囲外 ${c.pSize} 人・適用率で外れた ${c.pRate} 人）。`);
    else if (m && m.mean < 0.03) setVerdict('weak', '効果が弱い', `${c.pApplied} 人に適用していますが、変化はわずかです（変わった部分の平均の差 ${pct(m.mean)}）。設定が弱めです。`);
    else setVerdict('on', '適用中', `${c.pApplied} / ${n} 人に適用しています。画面の ${m ? pct(m.area) : '–'} が変わり、変わった部分の平均の差は ${m ? pct(m.mean) : '–'} です。${fs.persons.some((p) => p.approx) ? '一部の人は形を骨格から近似しています。' : ''}`);
  } else {
    const n = c.fSeen + c.fHeld, np = c.pSeen + c.pHeld;
    if (!n) setVerdict('none', '検出なし', np ? `人は ${np} 人いますが、顔を検出していません（${meth}${note}）。${c.noFace ? `うち ${c.noFace} 人は顔が見えているはずです。` : '後ろ向きか、顔が小さすぎる可能性があります。'}` : `このコマでは人も顔も検出していません（${meth}${note}）。効果が見えないのは検出の失敗です。`);
    else if (!c.fApplied) setVerdict('out', '範囲外', `顔を ${n} つ検出していますが、適用は 0 です（顔幅が範囲外 ${c.fSize}・適用率で外れた ${c.fRate}）。`);
    else if (m && m.mean < 0.02) setVerdict('weak', '効果が弱い', `${c.fApplied} つの顔に適用していますが、変化はわずかです（平均の差 ${pct(m.mean)}）。`);
    else setVerdict('on', '適用中', `${c.fApplied} / ${n} の顔に適用しています。画面の ${m ? pct(m.area) : '–'} が変わり、平均の差は ${m ? pct(m.mean) : '–'} です。${c.noFace ? `顔を検出できていない人が ${c.noFace} 人います。` : ''}`);
  }
  const chips = [
    `検出 <b>${meth}</b>`, `処理 <b>${DET.lastMs.toFixed(0)} ms</b>/コマ`,
    `人 <b>検出 ${c.pSeen}・保持 ${c.pHeld}</b>`,
  ];
  if (P.mode === 2) chips.push(`顔 <b>検出 ${c.fSeen}・保持 ${c.fHeld}</b>`);
  $('chips').innerHTML = chips.map((s) => `<span>${s}</span>`).join('');
  const st = S.stats;
  $('detRate').textContent = st.n ? `再生中に処理したコマ ${st.n}：人を検出 ${(st.p / st.n * 100).toFixed(0)}%${P.mode === 2 ? `・顔を検出 ${(st.f / st.n * 100).toFixed(0)}%` : ''}` : '再生すると、検出できたコマの割合をここに出します。';
  zoomOptions();
}

// ---------------------------------------------------------- close look ---
function zoomOptions() {
  const sel = $('zoomSel'), fs = S.lastFS; if (!fs) return;
  const ids = fs.persons.map((p) => p.id).sort((a, b) => a - b);
  if (S.zoomId && !ids.includes(S.zoomId)) ids.push(S.zoomId);
  const key = ids.join(',');
  if (sel.dataset.key === key) return;
  sel.dataset.key = key;
  sel.innerHTML = '<option value="">（映像の人をクリック）</option>' + ids.map((id) => `<option value="${id}">人 #${id}</option>`).join('');
  sel.value = S.zoomId ? String(S.zoomId) : '';
}
function drawZoom() {
  const zc = $('zoom'), fs = S.lastFS;
  if (S.test) { zc.hidden = true; $('zoomEmpty').hidden = false; $('zoomEmpty').textContent = '閾値テスト中は隠しています。'; return; }
  if (!S.zoomId || !fs) { zc.hidden = true; $('zoomEmpty').hidden = false; $('zoomEmpty').textContent = '映像の中の人をクリックすると、その人を切り出して等倍（1画素＝1画素）で見せます。'; return; }
  const p = fs.persons.find((q) => q.id === S.zoomId);
  if (!p) { zc.hidden = true; $('zoomEmpty').hidden = false; $('zoomEmpty').textContent = `人 #${S.zoomId} はこのコマにいません（検出されていないか、画面の外です）。`; return; }
  zc.hidden = false; $('zoomEmpty').hidden = true;
  const dpr = window.devicePixelRatio || 1, cw = Math.max(120, zc.parentElement.clientWidth), w = Math.round(cw * dpr), h = Math.round(w * 4 / 3);
  if (zc.width !== w || zc.height !== h) { zc.width = w; zc.height = h; }
  let cx = (p.box[0] + p.box[2]) / 2, cy = (p.box[1] + p.box[3]) / 2;
  if (P.mode === 2) { const f = fs.faces.find((q) => q.personId === p.id); if (f) { cx = f.center[0]; cy = f.center[1] + h * 0.15; } }
  const sx = Math.round(cx - w / 2), sy = Math.round(cy - h / 2), x = zc.getContext('2d');
  x.imageSmoothingEnabled = false; x.fillStyle = '#9aa0a6'; x.fillRect(0, 0, w, h);
  const ix = Math.max(0, sx), iy = Math.max(0, sy), iw = Math.min(S.src.W, sx + w) - ix, ih = Math.min(S.src.H, sy + h) - iy;
  if (iw > 0 && ih > 0) x.drawImage($('cv'), ix, iy, iw, ih, ix - sx, iy - sy, iw, ih);
}

// --------------------------------------------------------- threshold test ---
function testDesc() {
  if (P.mode === 1) return `ぬいぐるみ・陰影 ${P.shade}%・質感 ${P.texSize}%・膨張 ${P.dilate}px・ぼかし ${P.feather}px・影 ${P.depth}px/${P.shadowAmt}%・毛羽 ${P.furLen}px/${P.furDen}%・身長 ${P.hMin}–${P.hMax}px・適用率 ${P.rate1}%`;
  return `のっぺらぼう（${P.faceKind === 'skin' ? '肌' : 'フェルト'}）・細部 ${P.detail}px・きめ ${P.grain}%・縁 ${P.faceFeather}px・顔幅 ${P.fMin}–${P.fMax}px・適用率 ${P.rate2}%`;
}
function testStart() {
  if (!S.src || S.busy) return;
  S.test = { phase: 'show', cond: true, trials: [], timer: 0 };
  $('testStart').hidden = true; $('testStop').hidden = false; $('chips').hidden = true; $('verdict').hidden = true;
  testNext();
}
function testStop() {
  if (!S.test) return; clearTimeout(S.test.timer); S.test = null;
  $('testCover').hidden = true; $('testStart').hidden = false; $('testStop').hidden = true; $('chips').hidden = false; $('verdict').hidden = false; $('testNow').textContent = '';
  stop(); rerender();
}
async function testNext() {
  const T = S.test; if (!T) return;
  T.cond = Math.random() < 0.5; T.phase = 'show'; $('testCover').hidden = true;
  const n = T.trials.length % 20;
  $('testNow').textContent = `${n + 1} / 20 回目を見せています`;
  stop(); await seekTo(Math.random() * Math.max(0, S.src.dur - 3.2)); play();
  T.timer = setTimeout(() => { if (S.test !== T) return; stop(); T.phase = 'ask'; $('testCover').hidden = false; $('testCount').textContent = `${n + 1} / 20 回目`; $('testNow').textContent = '答えを待っています'; }, 3000);
}
function testAnswer(yes) {
  const T = S.test; if (!T || T.phase !== 'ask') return;
  T.trials.push({ cond: T.cond, ans: yes });
  if (T.trials.length % 20 === 0) {
    const last = T.trials.slice(-20), ok = last.filter((x) => x.cond === x.ans).length;
    const hits = last.filter((x) => x.cond && x.ans).length, fa = last.filter((x) => !x.cond && x.ans).length;
    const log = store.get('testlog', []);
    log.unshift({ at: new Date().toLocaleString('ja-JP'), ok, n: 20, hits, nOn: last.filter((x) => x.cond).length, fa, nOff: last.filter((x) => !x.cond).length, desc: testDesc(), src: S.src.name });
    store.set('testlog', log.slice(0, 200)); S.testLog = log; renderTestLog();
  }
  testNext();
}
function renderTestLog() {
  const log = S.testLog || store.get('testlog', []);
  $('testLog').querySelector('tbody').innerHTML = log.length ? log.map((e) => `<tr><td>${e.at}</td><td>${Math.round(e.ok / e.n * 100)}%（${e.ok}/${e.n}）<br>加工ありを「あり」${e.hits}/${e.nOn}・加工なしを「あり」${e.fa}/${e.nOff}</td><td>${e.desc}<br>${e.src}</td></tr>`).join('') : '<tr><td colspan="3">まだ記録はありません。</td></tr>';
}

// ------------------------------------------------------------------ scan ---
async function scan() {
  if (!S.src || S.busy) return;
  stop(); testStop();
  const src = S.src, t0 = P.rangeA, t1 = P.rangeB, method = effMethod();
  if (method === 'bg' && !BG.plate) { await estimatePlate(); if (!BG.plate) return; }
  S.busy = { cancel: false };
  const C = { key: cacheKey(), faces: P.mode === 2, times: [], dets: [], t0, t1 };
  const total = Math.max(1, Math.round((t1 - t0) * src.fps));
  const t00 = performance.now();
  const step = (t, img) => {
    const d = DET.detect(img, src.W, src.H, method, C.faces, FACE_MIN_DETECT);
    for (const p of d.persons) delete p.score;
    C.times.push(t); C.dets.push(d);
    const n = C.times.length, el = (performance.now() - t00) / 1000;
    busy(`走査中 ${n} / 約 ${total} コマ（残り約 ${Math.max(0, el / n * (total - n)).toFixed(0)} 秒）`, n / total);
  };
  try {
    if (src.kind === 'sample') {
      for (let i = Math.ceil(t0 * src.fps - 1e-6); i / src.fps < t1 - 1e-6; i++) { if (S.busy.cancel) break; const t = i / src.fps; step(t, SAMPLE.render(t)); if (i % 4 === 0) await yieldUI(); }
    } else {
      const mb = await loadMB();
      const input = new mb.Input({ source: new mb.BlobSource(src.file), formats: mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      const sink = new mb.CanvasSink(track, { poolSize: 2 });
      let i = 0;
      for await (const wc of sink.canvases(src.firstTs + t0, src.firstTs + t1)) { if (S.busy.cancel) break; step(wc.timestamp - src.firstTs, wc.canvas); if (++i % 2 === 0) await yieldUI(); }
    }
  } catch (e) { busyEnd(); $('scanSum').textContent = '走査できませんでした：' + (e.message || e); return; }
  const cancelled = S.busy.cancel; busyEnd();
  S.cache = C; C.partial = cancelled;
  analyze(); TR.clear(); seekTo(S.t);
}
let analyzeTimer = 0;
function analyzeSoon() { clearTimeout(analyzeTimer); analyzeTimer = setTimeout(analyze, 150); }
function analyze() {
  const C = S.cache; if (!C || !S.src) return;
  const src = S.src, tr = new Tracker(); tr.reset(src.W, src.H);
  const fr = [];
  for (let i = 0; i < C.times.length; i++) {
    const fs = tr.update(C.dets[i], C.times[i], P, false);
    fr.push({ p: new Map(fs.persons.map((p) => [p.id, p])), f: new Map(fs.faces.map((f) => [f.id, f])), c: fs.c });
  }
  const items = [], mode = P.mode, fd = frameDur();
  const gaps = (kind, label) => {
    const by = new Map();
    fr.forEach((x, i) => x[kind].forEach((v, id) => { if (!by.has(id)) by.set(id, []); by.get(id).push(i); }));
    for (const [id, idx] of by) for (let j = 1; j < idx.length; j++) if (idx[j] - idx[j - 1] > 1) {
      const a = fr[idx[j - 1]][kind].get(id), b = fr[idx[j]][kind].get(id);
      if (a.applied || b.applied) items.push({ a: idx[j - 1] + 1, b: idx[j] - 1, id, text: `${label} #${id} の検出が途切れ、<b>処理されていない</b>` });
    }
    return by;
  };
  let pIds;
  if (mode === 1) pIds = gaps('p', '人'); else { gaps('f', '顔'); pIds = new Map(); fr.forEach((x, i) => x.p.forEach((v, id) => { if (!pIds.has(id)) pIds.set(id, []); pIds.get(id).push(i); })); }
  if (mode === 2) { // a face that should be visible but was not found, merged into runs
    const runs = new Map();
    fr.forEach((x, i) => x.p.forEach((p, id) => {
      if (!p.faceMissing) return;
      const r = runs.get(id); if (r && r.b === i - 1) r.b = i; else { if (r) items.push(r); runs.set(id, { a: i, b: i, id, text: `人 #${id} の顔が見えているのに<b>顔を検出できていない</b>` }); }
    }));
    for (const r of runs.values()) items.push(r);
  }
  // people who appear or vanish in the middle of the picture: frames before/after may have been missed
  const W = src.W, H = src.H, inside = (b) => b[0] > W * 0.02 && b[2] < W * 0.98 && b[1] > H * 0.02 && b[3] < H * 0.98;
  for (const [id, idx] of pIds) {
    if (idx.length < src.fps * 0.6) continue;
    const first = fr[idx[0]].p.get(id), last = fr[idx[idx.length - 1]].p.get(id);
    if (mode === 1 && !first.applied && !last.applied) continue;
    if (idx[0] > 0 && inside(first.rawBox)) items.push({ a: idx[0], b: idx[0], id, text: `人 #${id} が画面の中で急に現れる（前のコマで見落としの可能性・要確認）` });
    if (idx[idx.length - 1] < fr.length - 1 && inside(last.rawBox)) items.push({ a: idx[idx.length - 1], b: idx[idx.length - 1], id, text: `人 #${id} が画面の中で急に消える（後のコマで見落としの可能性・要確認）` });
  }
  items.sort((x, y) => x.a - y.a);
  const n = fr.length, pF = fr.filter((x) => x.c.pSeen > 0).length, fF = fr.filter((x) => x.c.fSeen > 0).length;
  const cov = []; for (const idx of pIds.values()) cov.push(idx.length / (idx[idx.length - 1] - idx[0] + 1));
  S.scan = { n, pF, fF, cov: cov.length ? cov.reduce((a, b) => a + b, 0) / cov.length : 0, items, mode, faces: C.faces, partial: C.partial };
  scanSummary(); renderMisses();
}
function scanSummary() {
  const s = S.scan, C = S.cache, el = $('scanSum');
  if (!s || !C) { el.textContent = 'まだ走査していません。'; return; }
  const stale = C.key !== cacheKey() || (P.mode === 2 && !C.faces) || Math.abs(C.t0 - P.rangeA) > 1e-6 || Math.abs(C.t1 - P.rangeB) > 1e-6;
  const pct = (a) => (a / Math.max(1, s.n) * 100).toFixed(1) + '%';
  el.innerHTML = `${C.t0.toFixed(2)}–${C.t1.toFixed(2)} 秒・${s.n} コマ${s.partial ? '（途中で中止）' : ''}<br>人を検出したコマ ${pct(s.pF)}（${s.pF}/${s.n}）${C.faces ? `・顔を検出したコマ ${pct(s.fF)}（${s.fF}/${s.n}）` : ''}<br>人ごとの検出率（現れてから消えるまで）平均 ${(s.cov * 100).toFixed(1)}%<br>処理されていない疑いのある箇所 ${s.items.length} 件${stale ? '<br><b>設定・範囲・検出方式が走査のときと違います。走査し直してください。</b>' : ''}`;
}
function renderMisses() {
  const ol = $('misses'), s = S.scan, C = S.cache;
  if (!s || !C) { ol.innerHTML = ''; return; }
  if (!s.items.length) { ol.innerHTML = '<li class="note">見つかりませんでした。</li>'; return; }
  ol.innerHTML = s.items.slice(0, 400).map((it, i) => {
    const a = C.times[it.a], b = C.times[it.b], n = it.b - it.a + 1;
    return `<li><button type="button" data-i="${i}"><span class="t">${a.toFixed(2)}${n > 1 ? '–' + b.toFixed(2) : ''}秒</span><span class="k">${n > 1 ? n + 'コマ・' : ''}${it.text}</span></button></li>`;
  }).join('');
}
async function jumpTo(i) {
  const it = S.scan.items[i], t = S.cache.times[it.a];
  stop(); testStop(); S.showDet = true; $('showDet').checked = true; S.zoomId = it.id;
  // run the tracker up to this frame from a little earlier so hold and smoothing match the export
  const C = S.cache; TR.clear();
  const from = Math.max(0, it.a - Math.ceil(S.src.fps * 1.5));
  for (let j = from; j < it.a; j++) TR.update(C.dets[j], C.times[j], P, P.mode === 1);
  await seekTo(t);
}

// ---------------------------------------------------------------- export ---
async function pickFormat(mb, W, H) {
  try { if (await mb.canEncodeVideo('avc', { width: W, height: H })) return { container: 'mp4', vcodec: 'avc', ext: 'mp4', label: 'MP4（H.264）' }; } catch (e) { /* */ }
  for (const c of ['vp9', 'vp8']) { try { if (await mb.canEncodeVideo(c, { width: W, height: H })) return { container: 'webm', vcodec: c, ext: 'webm', label: `WebM（${c.toUpperCase()}）` }; } catch (e) { /* */ } }
  return null;
}
async function fmtNote() {
  const el = $('fmtNote'); el.textContent = '書き出しの形式を調べています…';
  try {
    const mb = await loadMB(); const f = await pickFormat(mb, S.src.W, S.src.H);
    el.textContent = f ? `${f.label}・${S.src.W}×${S.src.H} px（元の解像度）・コマごとに処理${S.src.kind === 'file' ? '・音声は元の動画から' : '・見本は音なし'}${f.container === 'webm' ? '。このブラウザでは H.264 で書き出せないため WebM にします。' : ''}` : 'このブラウザでは動画を書き出せません（WebCodecs の動画エンコーダーがありません）。';
  } catch (e) { el.textContent = '書き出し用の部品を読み込めませんでした：' + (e.message || e); }
}
async function texFeeder(mb) {
  const tx = S.tex;
  if (tx.kind !== 'video') return { at: async () => {} };
  const input = new mb.Input({ source: new mb.BlobSource(tx.file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  const first = await track.getFirstTimestamp(), dur = Math.max(1e-3, (await track.computeDuration()) - first);
  const s = Math.min(1, 1024 / Math.max(track.displayWidth, track.displayHeight));
  const sink = new mb.CanvasSink(track, { width: Math.max(2, Math.round(track.displayWidth * s)), height: Math.max(2, Math.round(track.displayHeight * s)), poolSize: 3 });
  let it = null, cur = null, nxt = null;
  return {
    async at(tt) {
      const q = first + (tt % dur);
      if (!it || (cur && q < cur.timestamp - 1e-6)) { it = sink.canvases(first); cur = (await it.next()).value || null; nxt = (await it.next()).value || null; }
      while (nxt && nxt.timestamp <= q + 1e-6) { cur = nxt; nxt = (await it.next()).value || null; }
      if (cur) R.uploadTexture(cur.canvas, cur.canvas.width, cur.canvas.height);
    },
  };
}
async function doExport() {
  if (!S.src || S.busy) return;
  stop(); testStop();
  const src = S.src, t0 = P.rangeA, t1 = P.rangeB;
  if (t1 - t0 < frameDur()) { $('expInfo').textContent = '範囲が短すぎます。'; return; }
  if (effMethod() === 'bg' && !BG.plate) { await estimatePlate(); if (!BG.plate) return; }
  S.busy = { cancel: false }; S.result = null; $('saveBtn').hidden = true;
  busy('書き出しの準備をしています', 0);
  const total = Math.max(1, Math.round((t1 - t0) * src.fps)); let n = 0; const tStart = performance.now();
  const prog = () => { const el = (performance.now() - tStart) / 1000; busy(`書き出し中 ${n} / 約 ${total} コマ（残り約 ${Math.max(0, el / Math.max(1, n) * (total - n)).toFixed(0)} 秒）`, n / total); };
  let blob = null, fmt = null, audioNote = '';
  try {
    const mb = await loadMB();
    fmt = await pickFormat(mb, src.W, src.H);
    if (!fmt) throw new Error('このブラウザには動画のエンコーダーがありません');
    const tex = await texFeeder(mb);
    TR.clear();
    const output = new mb.Output({ format: fmt.container === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
    const cv = $('cv');
    if (src.kind === 'file') {
      const input = new mb.Input({ source: new mb.BlobSource(src.file), formats: mb.ALL_FORMATS });
      const conv = await mb.Conversion.init({
        input, output, trim: { start: src.firstTs + t0, end: src.firstTs + t1 },
        video: {
          codec: fmt.vcodec, forceTranscode: true, allowTransformationMetadata: false, quality: mb.QUALITY_HIGH, processedWidth: src.W, processedHeight: src.H,
          process: async (sample) => {
            if (S.busy && S.busy.cancel) { conv.cancel(); return null; }
            const t = t0 + sample.timestamp;
            await tex.at(t - t0);
            processFrame(sample.toCanvasImageSource(), t, { export: true }); show({ export: true });
            n++; if (n % 3 === 0) { prog(); await yieldUI(); }
            return new VideoFrame(cv, { timestamp: sample.microsecondTimestamp, duration: sample.microsecondDuration });
          },
        },
        audio: fmt.container === 'mp4' ? {} : { codec: 'opus' },
      });
      if (!conv.isValid) throw new Error('変換を組めませんでした：' + conv.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(', '));
      const da = conv.discardedTracks.filter((d) => d.track.type === 'audio');
      const ua = conv.utilizedTracks.filter((tk) => tk.type === 'audio');
      audioNote = ua.length ? '・音声あり（元の動画から）' : da.length ? `・音声なし（${da.map((d) => d.reason).join(', ')}）` : '・元の動画に音声なし';
      await conv.execute();
    } else {
      const vs = new mb.CanvasSource(cv, { codec: fmt.vcodec, bitrate: mb.QUALITY_HIGH });
      output.addVideoTrack(vs, { frameRate: src.fps });
      await output.start();
      for (let i = Math.ceil(t0 * src.fps - 1e-6); i / src.fps < t1 - 1e-6; i++) {
        if (S.busy.cancel) break;
        const t = i / src.fps;
        await tex.at(t - t0);
        processFrame(SAMPLE.render(t), t, { export: true }); show({ export: true });
        await vs.add(t - Math.ceil(t0 * src.fps - 1e-6) / src.fps, 1 / src.fps);
        n++; if (n % 3 === 0) { prog(); await yieldUI(); }
      }
      if (S.busy.cancel) { await output.cancel(); throw new Error('中止しました'); }
      await output.finalize();
      audioNote = '・見本は音なし';
    }
    blob = new Blob([output.target.buffer], { type: fmt.container === 'mp4' ? 'video/mp4' : 'video/webm' });
  } catch (e) {
    busyEnd(); TR.clear();
    $('expInfo').textContent = (S.busy && S.busy.cancel) || /cancel/i.test(String(e && e.name)) ? '中止しました。' : '書き出せませんでした：' + (e && e.message || e);
    redetect(); return;
  }
  busyEnd(); TR.clear();
  const base = (src.kind === 'sample' ? 'mihon' : src.name.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]/g, '_');
  const name = `${base}_hitogata_${P.mode === 1 ? 'nuigurumi' : 'nopperabo'}_${t0.toFixed(1)}-${t1.toFixed(1)}s.${fmt.ext}`;
  S.result = { blob, name };
  $('expInfo').textContent = `${name}\n${fmt.label}・${src.W}×${src.H} px・${(t1 - t0).toFixed(2)} 秒・${n} コマ・${(blob.size / 1e6).toFixed(1)} MB${audioNote}・処理 ${((performance.now() - tStart) / 1000).toFixed(0)} 秒`;
  $('saveBtn').hidden = false;
  seekTo(t0);
}
async function save() {
  const r = S.result; if (!r) return;
  const dl = (window.claude && window.claude.use) ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) {
    try { await dl.save({ filename: r.name, data: r.blob }); $('expInfo').textContent += '\n保存しました。'; }
    catch (e) { $('expInfo').textContent += `\n保存できませんでした（${e && e.code || e}）。`; }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = r.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ------------------------------------------------------------------ wiring ---
function modeUI() {
  seg('modeSeg', 'mode', P.mode); seg('kindSeg', 'k', P.faceKind);
  $('m1box').hidden = P.mode !== 1; $('m2box').hidden = P.mode !== 2;
  $('texBox').hidden = !(P.mode === 1 || P.faceKind === 'felt');
  $('pp-grain').hidden = P.faceKind !== 'skin';
}
function boot() {
  readColors();
  try { R = new Renderer($('cv')); }
  catch (e) { setVerdict('none', '動きません', 'このブラウザでは WebGL2 が使えないため動きません：' + e.message); return; }
  for (const d of DEFS) mountParam(d);
  document.body.appendChild(video); document.body.appendChild(plateVideo); document.body.appendChild(texVideo);
  $('play').onclick = () => (S.playing ? stop() : play());
  $('stepB').onclick = () => step(-1); $('stepF').onclick = () => step(1);
  $('seek').addEventListener('input', () => { stop(); seekTo(+$('seek').value / S.src.fps); });
  const hold = (on) => { S.hold = on; $('holdOrig').classList.toggle('on', on); if (S.lastFS) show(); };
  const ho = $('holdOrig');
  ho.addEventListener('pointerdown', (e) => { ho.setPointerCapture(e.pointerId); hold(true); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) ho.addEventListener(ev, () => hold(false));
  ho.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); hold(true); } });
  ho.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hold(false); });
  $('viewSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.view = +b.dataset.v; seg('viewSeg', 'v', S.view); if (S.lastFS) show(); });
  $('showDet').addEventListener('change', () => { S.showDet = $('showDet').checked; drawOverlay(); });
  $('fileIn').addEventListener('change', () => { openFile($('fileIn').files[0]); $('fileIn').value = ''; });
  $('useSample').onclick = () => useSample();
  $('texIn').addEventListener('change', () => { openTexture($('texIn').files[0]); $('texIn').value = ''; });
  $('texSample').onclick = () => useSampleTexture();
  const stage = $('stage');
  stage.addEventListener('dragover', (e) => { e.preventDefault(); });
  stage.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
  $('methodSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMethod(b.dataset.m); });
  $('tileSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; DET.tiles = b.dataset.t; seg('tileSeg', 't', DET.tiles); redetect(); scanSummary(); });
  $('poseIn').addEventListener('change', () => { const f = $('poseIn').files[0]; if (f) DET.useModelFile('pose', f); $('poseIn').value = ''; });
  $('faceIn').addEventListener('change', () => { const f = $('faceIn').files[0]; if (f) DET.useModelFile('face', f); $('faceIn').value = ''; });
  $('mpRetry').onclick = () => { DET.mp.state = 'idle'; DET.loadMP(); };
  $('mpForget').onclick = async () => { await DET.forgetModelFiles(); DET.mp.state = 'idle'; DET.loadMP(); };
  $('bgRedo').onclick = () => { BG.plate = null; S.cache = null; plateJob = null; estimatePlate(); };
  $('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; P.mode = +b.dataset.mode; modeUI(); redetect(); scanSummary(); if (S.cache) analyzeSoon(); });
  $('kindSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; P.faceKind = b.dataset.k; modeUI(); rerender(); });
  $('resetAll').onclick = () => { for (const d of DEFS) if (d.mode === P.mode || (d.mode === 0)) { P[d.k] = d.v; syncParam(d.k); } rerender(); if (S.cache) analyzeSoon(); };
  $('zoomSel').addEventListener('change', () => { S.zoomId = +$('zoomSel').value || 0; drawZoom(); drawOverlay(); });
  $('cv').addEventListener('click', (e) => {
    const fs = S.lastFS; if (!fs || S.test) return;
    const r = $('cv').getBoundingClientRect(), x = (e.clientX - r.left) / r.width * S.src.W, y = (e.clientY - r.top) / r.height * S.src.H;
    const hit = fs.persons.filter((p) => x >= p.rawBox[0] && x <= p.rawBox[2] && y >= p.rawBox[1] && y <= p.rawBox[3]).sort((a, b) => (a.rawBox[2] - a.rawBox[0]) * (a.rawBox[3] - a.rawBox[1]) - (b.rawBox[2] - b.rawBox[0]) * (b.rawBox[3] - b.rawBox[1]))[0];
    S.zoomId = hit ? hit.id : 0; zoomOptions(); $('zoomSel').value = S.zoomId ? String(S.zoomId) : ''; drawZoom(); drawOverlay();
  });
  $('testStart').onclick = testStart; $('testStop').onclick = testStop;
  $('ansYes').onclick = () => testAnswer(true); $('ansNo').onclick = () => testAnswer(false);
  $('testCopy').onclick = () => {
    const log = store.get('testlog', []);
    const txt = log.map((e) => `${e.at}\t${Math.round(e.ok / e.n * 100)}%\t${e.ok}/${e.n}\t${e.desc}\t${e.src}`).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
  };
  $('testClear').onclick = () => { store.set('testlog', []); S.testLog = []; renderTestLog(); };
  renderTestLog();
  $('scanBtn').onclick = scan; $('expBtn').onclick = doExport; $('saveBtn').onclick = save;
  $('misses').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) jumpTo(+b.dataset.i); });
  $('busyCancel').onclick = () => { if (S.busy) S.busy.cancel = true; };
  window.addEventListener('resize', () => { drawOverlay(); drawZoom(); });
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onVideoFrame);
  video.addEventListener('ended', () => { if (S.playing && !S.test) { video.currentTime = 0; video.play().catch(() => {}); } });
  modeUI();
  useSampleTexture();
  useSample();
  requestAnimationFrame(tick);
  DET.loadMP({ cpu: !!window.HITOGATA_CPU });
}
boot();
