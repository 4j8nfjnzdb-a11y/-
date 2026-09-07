"use strict";

/* ---------- geometry helpers ---------- */

const W = 960, H = 600;

function unitToPx(p) { return { x: p.x * W, y: p.y * H }; }

function affineFromParallelogram(srcW, srcH, O, X, Y) {
  return {
    a: (X.x - O.x) / srcW, b: (X.y - O.y) / srcW,
    c: (Y.x - O.x) / srcH, d: (Y.y - O.y) / srcH,
    e: O.x, f: O.y,
  };
}

function invertAffine(t) {
  const det = t.a * t.d - t.b * t.c;
  return {
    a: t.d / det, b: -t.b / det,
    c: -t.c / det, d: t.a / det,
    e: (t.c * t.f - t.d * t.e) / det,
    f: (t.b * t.e - t.a * t.f) / det,
  };
}

function lerp(a, b, p) { return a + (b - a) * p; }
function lerpPt(a, b, p) { return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) }; }

function defaultFrame() {
  return {
    O: { x: 0.34, y: 0.22 },
    X: { x: 0.74, y: 0.19 },
    Y: { x: 0.32, y: 0.62 },
  };
}

function framePx(frame) {
  const O = unitToPx(frame.O), X = unitToPx(frame.X), Y = unitToPx(frame.Y);
  const B = { x: X.x + Y.x - O.x, y: X.y + Y.y - O.y };
  return { O, X, Y, B };
}

/* draw `img` (any drawImage source, logical size srcW x srcH) warped into the
   parallelogram described by `frame` (unit coords), onto ctx (W x H). */
function drawWarped(ctx, img, srcW, srcH, frame, alpha, blurPx) {
  const { O, X, Y, B } = framePx(frame);
  const t = affineFromParallelogram(srcW, srcH, O, X, Y);
  ctx.save();
  // clip to the frame quad first so a blur filter can't bleed past its edge
  // and compound outward over hundreds of feedback-loop frames.
  drawQuad(ctx, O, X, B, Y);
  ctx.clip();
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  if (blurPx) ctx.filter = `blur(${blurPx}px)`;
  ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f);
  ctx.drawImage(img, 0, 0, srcW, srcH);
  ctx.restore();
}

function containRect(sw, sh, dw, dh) {
  const srcRatio = sw / sh, dstRatio = dw / dh;
  let cw, ch;
  if (srcRatio > dstRatio) { cw = dw; ch = dw / srcRatio; } else { ch = dh; cw = dh * srcRatio; }
  return { dx: (dw - cw) / 2, dy: (dh - ch) / 2, dw: cw, dh: ch };
}

/* draws the whole source image/video, uncropped, letterboxed to fit dw x dh */
function drawContain(ctx, img, sw, sh, dw, dh) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, dw, dh);
  const r = containRect(sw, sh, dw, dh);
  ctx.drawImage(img, 0, 0, sw, sh, r.dx, r.dy, r.dw, r.dh);
}

/* ---------- procedural room scene (the built-in "photo") ---------- */

function drawRoomScene(ctx, t, frame) {
  ctx.clearRect(0, 0, W, H);

  const wallGrad = ctx.createLinearGradient(0, 0, 0, H * 0.72);
  wallGrad.addColorStop(0, "#2c3038");
  wallGrad.addColorStop(1, "#1f232a");
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, W, H * 0.72);

  ctx.fillStyle = "#15171b";
  ctx.fillRect(0, H * 0.715, W, 5);

  const floorGrad = ctx.createLinearGradient(0, H * 0.72, 0, H);
  floorGrad.addColorStop(0, "#151619");
  floorGrad.addColorStop(1, "#0a0b0d");
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, H * 0.72, W, H * 0.28);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  const vpx = W * 0.5, vpy = H * 0.72;
  for (let i = 0; i <= 12; i++) {
    const x = (i / 12) * W;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(vpx + (x - vpx) * 0.12, vpy);
    ctx.stroke();
  }

  const wx = W * 0.055, wy = H * 0.1, ww = W * 0.17, wh = H * 0.42;
  const glow = 0.5 + 0.5 * Math.sin(t * 0.6);
  const winGrad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
  winGrad.addColorStop(0, `rgba(212,226,255,${0.55 + 0.15 * glow})`);
  winGrad.addColorStop(1, `rgba(140,160,205,${0.22 + 0.1 * glow})`);
  ctx.fillStyle = winGrad;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.strokeStyle = "#0d0f12";
  ctx.lineWidth = 7;
  ctx.strokeRect(wx, wy, ww, wh);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2);
  ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.stroke();

  const lampSwing = Math.sin(t * 0.9) * 0.05;
  ctx.save();
  ctx.translate(W * 0.86, 0);
  ctx.rotate(lampSwing);
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, H * 0.22); ctx.stroke();
  const bulbGrad = ctx.createRadialGradient(0, H * 0.24, 2, 0, H * 0.24, 46);
  bulbGrad.addColorStop(0, `rgba(255,230,180,${0.85 + 0.1 * glow})`);
  bulbGrad.addColorStop(1, "rgba(255,230,180,0)");
  ctx.fillStyle = bulbGrad;
  ctx.beginPath(); ctx.arc(0, H * 0.24, 46, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#d9c79a";
  ctx.beginPath(); ctx.arc(0, H * 0.24, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const { O, X, Y, B } = framePx(frame);
  const cx = (O.x + X.x + Y.x + B.x) / 4, cy = (O.y + X.y + Y.y + B.y) / 4;
  const expand = (p, k) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k });

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = 7;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#3c3025";
  drawQuad(ctx, expand(O, 1.09), expand(X, 1.09), expand(B, 1.09), expand(Y, 1.09));
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#101215";
  drawQuad(ctx, O, X, B, Y);
  ctx.fill();
}

function drawQuad(ctx, a, b, c, d) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
}

/* ============================================================
   REEL (photo tab) — a queue of photos and videos.
   Photos step through recursive re-photograph generations; videos
   play back live while feeding into themselves the same way the
   dedicated video tab does. After a configurable number of steps
   (photos) or seconds (videos), the reel cuts to the next item.
   ============================================================ */

const photoCanvas = document.getElementById("photoCanvas");
const pctx = photoCanvas.getContext("2d");
const hiddenVideoPool = document.getElementById("hiddenVideoPool");

let photoFrame = defaultFrame();
let photoDepth = 6;
let gens = [];
let currentIndex = 0;
let photoSourceImg = null; // current reel image (null => procedural room scene)

let reelItems = [{ type: "image", img: null, label: "標準" }];
let reelIndex = 0;
let segmentSteps = 0;

function faderValue() { return Number(document.getElementById("segmentLength").value); }
function stepsForFader(v) { return Math.max(1, Math.round(1 + (v / 100) * 29)); } // 1..30 re-photographs
function secondsForFader(v) { return 2 + (v / 100) * 28; } // 2..30s per video segment

function updateLengthReadout() {
  const v = faderValue();
  document.getElementById("lengthVal").textContent = `${stepsForFader(v)}コマ / ${secondsForFader(v).toFixed(0)}秒`;
}

function photoBaseDraw(ctx) {
  if (photoSourceImg) drawContain(ctx, photoSourceImg, photoSourceImg.naturalWidth || photoSourceImg.width, photoSourceImg.naturalHeight || photoSourceImg.height, W, H);
  else drawRoomScene(ctx, 0, photoFrame);
}

function buildGenerations() {
  gens = [];
  let prev = null;
  for (let i = 0; i <= photoDepth; i++) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const cctx = c.getContext("2d");
    photoBaseDraw(cctx);
    if (prev) drawWarped(cctx, prev, W, H, photoFrame);
    gens.push(c);
    prev = c;
  }
  currentIndex = photoDepth;
}

/* step state machine (image items): hold -> zoom -> flash -> hold ... */
let photoPhase = "hold";
let phaseStart = 0;
let photoPlaying = false;
let photoEditing = false;
let soundOn = true;
let pendingAdvance = false;
const HOLD_BASE = 260, ZOOM_MS = 480, FLASH_MS = 110;

/* video-segment feedback buffers, reused for whichever reel item is a video */
const reelAccumA = document.createElement("canvas"); reelAccumA.width = W; reelAccumA.height = H;
const reelAccumB = document.createElement("canvas"); reelAccumB.width = W; reelAccumB.height = H;
let reelUseA = true;
let reelLastDst = reelAccumA;
let videoSegmentStart = 0;

function holdDuration() {
  const speed = Number(document.getElementById("photoSpeed").value); // 0..100
  return HOLD_BASE + (100 - speed) * 14;
}

let audioCtx = null;
function shutterClick() {
  if (!soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    const bufferSize = 2400;
    const buf = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = audioCtx.createBufferSource();
    noise.buffer = buf;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.35, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    noise.connect(gain).connect(audioCtx.destination);
    noise.start(t0);
  } catch (e) { /* audio unavailable, ignore */ }
}

function triggerFlash() {
  shutterClick();
}

function stepForward() {
  if (photoPhase !== "hold") return;
  photoPhase = "zoom";
  phaseStart = performance.now();
}

/* ---------- reel management ---------- */

function enterCurrentReelItem() {
  const item = reelItems[reelIndex];
  if (item.type === "image") {
    photoSourceImg = item.img;
    buildGenerations();
    photoPhase = "hold";
    phaseStart = performance.now();
  } else {
    videoSegmentStart = performance.now();
    reelAccumA.getContext("2d").clearRect(0, 0, W, H);
    reelAccumB.getContext("2d").clearRect(0, 0, W, H);
    reelUseA = true;
    reelLastDst = reelAccumA;
    try { item.videoEl.currentTime = 0; } catch (e) { /* not seekable yet */ }
    if (photoPlaying) item.videoEl.play().catch(() => {});
  }
}

function advanceReelItem() {
  const prev = reelItems[reelIndex];
  if (prev.type === "video") prev.videoEl.pause();
  reelIndex = (reelIndex + 1) % reelItems.length;
  segmentSteps = 0;
  enterCurrentReelItem();
  renderReelList();
}

function removeReelItem(i) {
  const [removed] = reelItems.splice(i, 1);
  if (removed.type === "video") { removed.videoEl.pause(); removed.videoEl.remove(); }
  if (reelItems.length === 0) reelItems.push({ type: "image", img: null, label: "標準" });
  if (reelIndex >= reelItems.length) reelIndex = 0;
  segmentSteps = 0;
  enterCurrentReelItem();
  renderReelList();
}

function renderReelList() {
  const list = document.getElementById("reelList");
  list.innerHTML = "";
  reelItems.forEach((item, i) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (i === reelIndex ? " current" : "");
    const kind = item.type === "image" ? (item.img ? "写真" : "標準") : "動画";
    const text = document.createElement("span");
    text.textContent = `${i + 1} ${kind}`;
    chip.appendChild(text);
    if (reelItems.length > 1) {
      const x = document.createElement("button");
      x.textContent = "×";
      x.className = "chipX";
      x.type = "button";
      x.title = "削除";
      x.addEventListener("click", (ev) => { ev.stopPropagation(); removeReelItem(i); });
      chip.appendChild(x);
    }
    list.appendChild(chip);
  });
}

/* ---------- render loop ---------- */

function tickVideoSegment(videoEl) {
  const src = reelUseA ? reelAccumA : reelAccumB;
  const dst = reelUseA ? reelAccumB : reelAccumA;
  const dctx = dst.getContext("2d");
  dctx.clearRect(0, 0, W, H);
  if (videoEl.readyState >= 2) drawContain(dctx, videoEl, videoEl.videoWidth, videoEl.videoHeight, W, H);
  const loss = 0.18;
  drawWarped(dctx, src, W, H, photoFrame, 1 - loss * 0.4, loss * 3);
  pctx.clearRect(0, 0, W, H);
  pctx.drawImage(dst, 0, 0);
  reelLastDst = dst;
  reelUseA = !reelUseA;
}

function renderPhotoFrame(now) {
  const item = reelItems[reelIndex];

  if (photoEditing) {
    pctx.clearRect(0, 0, W, H);
    if (item.type === "video") drawContain(pctx, item.videoEl, item.videoEl.videoWidth || 1, item.videoEl.videoHeight || 1, W, H);
    else photoBaseDraw(pctx);
    drawFrameHandles(pctx, photoFrame);
    requestAnimationFrame(renderPhotoFrame);
    return;
  }

  if (item.type === "image") {
    if (photoPhase === "hold") {
      pctx.clearRect(0, 0, W, H);
      pctx.drawImage(gens[currentIndex], 0, 0);
      if (photoPlaying && now - phaseStart >= holdDuration()) stepForward();
    } else if (photoPhase === "zoom") {
      let p = (now - phaseStart) / ZOOM_MS;
      if (p >= 1) p = 1;
      const ease = 1 - Math.pow(1 - p, 3);
      const mode = document.querySelector('input[name="photoMode"]:checked').value;
      pctx.clearRect(0, 0, W, H);

      if (mode === "spacy") {
        const full = { O: { x: 0, y: 0 }, X: { x: W, y: 0 }, Y: { x: 0, y: H } };
        const fp = framePx(photoFrame);
        const O = lerpPt(full.O, fp.O, ease), X = lerpPt(full.X, fp.X, ease), Y = lerpPt(full.Y, fp.Y, ease);
        const t = affineFromParallelogram(W, H, O, X, Y);
        const inv = invertAffine(t);
        pctx.save();
        pctx.transform(inv.a, inv.b, inv.c, inv.d, inv.e, inv.f);
        pctx.drawImage(gens[currentIndex], 0, 0, W, H);
        pctx.restore();
      } else {
        const fp = framePx(photoFrame);
        const cx = (fp.O.x + fp.X.x + fp.Y.x + fp.B.x) / 4, cy = (fp.O.y + fp.X.y + fp.Y.y + fp.B.y) / 4;
        const s = 1 + ease * 9;
        pctx.save();
        pctx.translate(W / 2, H / 2);
        pctx.scale(s, s);
        pctx.translate(-cx, -cy);
        pctx.drawImage(gens[currentIndex], 0, 0, W, H);
        pctx.restore();
      }

      if (p >= 1) {
        photoPhase = "flash";
        phaseStart = now;
        triggerFlash();
        if (mode === "spacy") {
          currentIndex -= 1;
          if (currentIndex < 0) currentIndex = photoDepth;
        }
        segmentSteps += 1;
        if (reelItems.length > 1 && segmentSteps >= stepsForFader(faderValue())) pendingAdvance = true;
      }
    } else if (photoPhase === "flash") {
      pctx.drawImage(gens[currentIndex], 0, 0);
      if (now - phaseStart >= FLASH_MS) {
        if (pendingAdvance) { pendingAdvance = false; advanceReelItem(); }
        else { photoPhase = "hold"; phaseStart = now; }
      }
    }
  } else {
    /* video reel item */
    if (photoPlaying) {
      tickVideoSegment(item.videoEl);
      if (reelItems.length > 1 && now - videoSegmentStart >= secondsForFader(faderValue()) * 1000) {
        triggerFlash();
        advanceReelItem();
      }
    } else {
      pctx.clearRect(0, 0, W, H);
      pctx.drawImage(reelLastDst, 0, 0);
    }
  }

  requestAnimationFrame(renderPhotoFrame);
}

function drawFrameHandles(ctx, frame) {
  const { O, X, Y } = framePx(frame);
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(226,185,106,0.8)";
  drawQuad(ctx, O, X, { x: X.x + Y.x - O.x, y: X.y + Y.y - O.y }, Y);
  ctx.stroke();
  const dot = (p, color) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  dot(O, "#e2b96a");
  dot(X, "#7fd1ff");
  dot(Y, "#ff9f7f");
  ctx.restore();
}

/* ---------- photo UI wiring ---------- */

document.getElementById("photoDepth").addEventListener("input", (e) => {
  photoDepth = Number(e.target.value);
  document.getElementById("depthVal").textContent = photoDepth;
  if (reelItems[reelIndex].type === "image") buildGenerations();
});

document.getElementById("segmentLength").addEventListener("input", updateLengthReadout);

const photoPlayBtn = document.getElementById("photoPlay");
photoPlayBtn.addEventListener("click", () => {
  photoPlaying = !photoPlaying;
  photoPlayBtn.textContent = photoPlaying ? "止める" : "駆動する";
  photoPlayBtn.classList.toggle("playing", photoPlaying);
  const item = reelItems[reelIndex];
  if (item.type === "image") {
    if (photoPlaying && photoPhase === "hold") phaseStart = performance.now();
  } else if (photoPlaying) {
    videoSegmentStart = performance.now();
    item.videoEl.play().catch(() => {});
  } else {
    item.videoEl.pause();
  }
});

document.getElementById("photoStep").addEventListener("click", () => {
  if (photoEditing) return;
  const item = reelItems[reelIndex];
  if (item.type === "image") stepForward();
  else { triggerFlash(); advanceReelItem(); }
});

document.querySelectorAll('input[name="photoMode"]').forEach((r) => {
  r.addEventListener("change", () => { photoPhase = "hold"; phaseStart = performance.now(); });
});

document.getElementById("photoSound").addEventListener("change", (e) => { soundOn = e.target.checked; });

const photoEditBtn = document.getElementById("photoEditFrame");
photoEditBtn.addEventListener("click", () => {
  photoEditing = !photoEditing;
  photoEditBtn.classList.toggle("active", photoEditing);
  photoCanvas.classList.toggle("editing", photoEditing);
  if (!photoEditing && reelItems[reelIndex].type === "image") buildGenerations();
});

document.getElementById("photoReset").addEventListener("click", () => {
  reelItems.forEach((it) => { if (it.type === "video") { it.videoEl.pause(); it.videoEl.remove(); } });
  reelItems = [{ type: "image", img: null, label: "標準" }];
  reelIndex = 0;
  segmentSteps = 0;
  photoFrame = defaultFrame();
  enterCurrentReelItem();
  renderReelList();
});

document.getElementById("photoFile").addEventListener("change", (e) => {
  const files = Array.from(e.target.files);
  files.forEach((file) => {
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => { reelItems.push({ type: "image", img }); renderReelList(); };
      img.src = URL.createObjectURL(file);
    } else if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.loop = true;
      hiddenVideoPool.appendChild(v);
      v.addEventListener("loadeddata", () => { reelItems.push({ type: "video", videoEl: v }); renderReelList(); }, { once: true });
      v.src = URL.createObjectURL(file);
    }
  });
  e.target.value = "";
});

let dragKey = null;
function canvasUnitPoint(evt) {
  const rect = photoCanvas.getBoundingClientRect();
  const cx = (evt.clientX - rect.left) / rect.width;
  const cy = (evt.clientY - rect.top) / rect.height;
  return { x: cx, y: cy };
}
photoCanvas.addEventListener("mousedown", (evt) => {
  if (!photoEditing) return;
  const p = canvasUnitPoint(evt);
  const pts = { O: photoFrame.O, X: photoFrame.X, Y: photoFrame.Y };
  let best = null, bestD = 0.02 * 0.02 * 4;
  for (const k in pts) {
    const dx = pts[k].x - p.x, dy = pts[k].y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = k; }
  }
  dragKey = best;
});
window.addEventListener("mousemove", (evt) => {
  if (!dragKey) return;
  const p = canvasUnitPoint(evt);
  photoFrame[dragKey] = { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
});
window.addEventListener("mouseup", () => { dragKey = null; });

renderReelList();
enterCurrentReelItem();
updateLengthReadout();
requestAnimationFrame(renderPhotoFrame);

/* ============================================================
   VIDEO MODE (live recursive feedback)
   ============================================================ */

const videoCanvas = document.getElementById("videoCanvas");
const vctx = videoCanvas.getContext("2d");
const videoEl = document.getElementById("videoSource");

let videoFrame = defaultFrame();
let videoEditing = false;
let videoPlaying = false;
let usingUploadedVideo = false;
let videoStartT = performance.now();

const accumA = document.createElement("canvas"); accumA.width = W; accumA.height = H;
const accumB = document.createElement("canvas"); accumB.width = W; accumB.height = H;
let useA = true;

function videoTick(now) {
  if (videoPlaying && !videoEditing) {
    const t = (now - videoStartT) / 1000;
    const src = useA ? accumA : accumB;
    const dst = useA ? accumB : accumA;
    const dctx = dst.getContext("2d");

    if (usingUploadedVideo && videoEl.readyState >= 2) {
      dctx.clearRect(0, 0, W, H);
      drawContain(dctx, videoEl, videoEl.videoWidth, videoEl.videoHeight, W, H);
    } else {
      drawRoomScene(dctx, t, videoFrame);
    }

    const loss = Number(document.getElementById("videoLoss").value) / 100;
    dctx.save();
    drawWarped(dctx, src, W, H, videoFrame, 1 - loss * 0.4, loss * 3);
    dctx.restore();

    vctx.clearRect(0, 0, W, H);
    vctx.drawImage(dst, 0, 0);
    useA = !useA;
  } else if (videoEditing) {
    vctx.clearRect(0, 0, W, H);
    if (usingUploadedVideo && videoEl.readyState >= 2) drawContain(vctx, videoEl, videoEl.videoWidth, videoEl.videoHeight, W, H);
    else drawRoomScene(vctx, (now - videoStartT) / 1000, videoFrame);
    drawFrameHandles(vctx, videoFrame);
  } else {
    vctx.clearRect(0, 0, W, H);
    if (usingUploadedVideo && videoEl.readyState >= 2) drawContain(vctx, videoEl, videoEl.videoWidth, videoEl.videoHeight, W, H);
    else drawRoomScene(vctx, 0, videoFrame);
  }
  requestAnimationFrame(videoTick);
}
requestAnimationFrame(videoTick);

document.getElementById("lossVal").textContent = document.getElementById("videoLoss").value + "%";
document.getElementById("videoLoss").addEventListener("input", (e) => {
  document.getElementById("lossVal").textContent = e.target.value + "%";
});

const videoPlayBtn = document.getElementById("videoPlay");
videoPlayBtn.addEventListener("click", () => {
  videoPlaying = !videoPlaying;
  videoPlayBtn.textContent = videoPlaying ? "止める" : "駆動する";
  videoPlayBtn.classList.toggle("playing", videoPlaying);
  if (videoPlaying) {
    accumA.getContext("2d").clearRect(0, 0, W, H);
    accumB.getContext("2d").clearRect(0, 0, W, H);
    if (usingUploadedVideo) videoEl.play().catch(() => {});
  } else if (usingUploadedVideo) {
    videoEl.pause();
  }
});

const videoEditBtn = document.getElementById("videoEditFrame");
videoEditBtn.addEventListener("click", () => {
  videoEditing = !videoEditing;
  videoEditBtn.classList.toggle("active", videoEditing);
  videoCanvas.classList.toggle("editing", videoEditing);
});

document.getElementById("videoReset").addEventListener("click", () => {
  usingUploadedVideo = false;
  videoEl.pause();
  videoFrame = defaultFrame();
  accumA.getContext("2d").clearRect(0, 0, W, H);
  accumB.getContext("2d").clearRect(0, 0, W, H);
});

document.getElementById("videoFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  videoEl.src = URL.createObjectURL(file);
  videoEl.addEventListener("loadeddata", () => {
    usingUploadedVideo = true;
    videoFrame = defaultFrame();
    if (videoPlaying) videoEl.play().catch(() => {});
  }, { once: true });
});

let videoDragKey = null;
function videoCanvasUnitPoint(evt) {
  const rect = videoCanvas.getBoundingClientRect();
  return { x: (evt.clientX - rect.left) / rect.width, y: (evt.clientY - rect.top) / rect.height };
}
videoCanvas.addEventListener("mousedown", (evt) => {
  if (!videoEditing) return;
  const p = videoCanvasUnitPoint(evt);
  const pts = { O: videoFrame.O, X: videoFrame.X, Y: videoFrame.Y };
  let best = null, bestD = 0.02 * 0.02 * 4;
  for (const k in pts) {
    const dx = pts[k].x - p.x, dy = pts[k].y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = k; }
  }
  videoDragKey = best;
});
window.addEventListener("mousemove", (evt) => {
  if (!videoDragKey) return;
  const p = videoCanvasUnitPoint(evt);
  videoFrame[videoDragKey] = { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
});
window.addEventListener("mouseup", () => { videoDragKey = null; });

/* ============================================================
   TABS
   ============================================================ */

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    const target = btn.dataset.tab;
    document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.dataset.panel !== target; });
  });
});

/* autoplay: both panels start driving on load, at whatever speed is set */
photoPlayBtn.click();
videoPlayBtn.click();
