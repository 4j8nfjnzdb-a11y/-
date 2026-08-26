// glitchmix — random glitch video generator
//
// Load one or more images/videos (including iPhone .MOV files, which
// Safari's <video> element decodes natively). Every frame a "director"
// picks a random subset of glitch effects with randomized parameters,
// occasionally cuts to a different loaded source, and mixes sources
// together — so the output never repeats the same sequence twice.
// The final canvas is captured with MediaRecorder to export a video.

(() => {
  "use strict";

  // ---- DOM ------------------------------------------------------------

  const fileInput = document.getElementById("fileInput");
  const pickBtn = document.getElementById("pickBtn");
  const dropzone = document.getElementById("dropzone");
  const mediaListEl = document.getElementById("mediaList");

  const stage = document.getElementById("stage");
  const stageWrap = document.getElementById("stageWrap");
  const stageHint = document.getElementById("stageHint");
  const ctx = stage.getContext("2d", { willReadFrequently: true });

  const playBtn = document.getElementById("playBtn");
  const shuffleBtn = document.getElementById("shuffleBtn");
  const audioToggle = document.getElementById("audioToggle");

  const intensitySlider = document.getElementById("intensity");
  const speedSlider = document.getElementById("speed");

  const durationSelect = document.getElementById("durationSelect");
  const recordBtn = document.getElementById("recordBtn");
  const recordStatus = document.getElementById("recordStatus");
  const downloadLink = document.getElementById("downloadLink");

  // ---- small utilities --------------------------------------------------

  const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
  const clampInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
  const clampByte = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---- media pool ---------------------------------------------------

  const mediaPool = []; // { type:'image'|'video', el, name, w, h, url }
  let activeIndex = -1;
  let activeMedia = null;
  let playing = false;

  function isVideoFile(file) {
    return file.type.startsWith("video/") || /\.(mov|mp4|m4v|qt)$/i.test(file.name);
  }

  function loadFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      if (isVideoFile(file)) {
        const v = document.createElement("video");
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = "auto";
        const onReady = () => {
          v.removeEventListener("loadedmetadata", onReady);
          resolve({ type: "video", el: v, name: file.name, w: v.videoWidth, h: v.videoHeight, url });
        };
        v.addEventListener("loadedmetadata", onReady);
        v.addEventListener("error", () => reject(new Error(`${file.name} を再生できませんでした（未対応の形式の可能性があります）`)));
        v.src = url;
      } else {
        const img = new Image();
        img.onload = () => resolve({ type: "image", el: img, name: file.name, w: img.naturalWidth, h: img.naturalHeight, url });
        img.onerror = () => reject(new Error(`${file.name} を読み込めませんでした`));
        img.src = url;
      }
    });
  }

  function ensureCanvasSize(media) {
    if (stage.dataset.locked === "1") return;
    const MAX_LONG = 960;
    let w = media.w || 640, h = media.h || 360;
    const long = Math.max(w, h);
    if (long > MAX_LONG) {
      const scale = MAX_LONG / long;
      w = Math.max(2, Math.round(w * scale));
      h = Math.max(2, Math.round(h * scale));
    }
    stage.width = w;
    stage.height = h;
    stage.dataset.locked = "1";
    stageWrap.style.aspectRatio = `${w} / ${h}`;
  }

  function resetCanvas() {
    stage.width = 0;
    stage.height = 0;
    stage.dataset.locked = "";
    stageWrap.style.aspectRatio = "";
  }

  function renderMediaList() {
    mediaListEl.innerHTML = "";
    mediaPool.forEach((media, idx) => {
      const li = document.createElement("li");
      if (idx === activeIndex) li.classList.add("active");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = media.name;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `${media.name} を削除`);
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeMedia(idx);
      });
      li.appendChild(name);
      li.appendChild(removeBtn);
      li.addEventListener("click", () => setActiveMedia(idx));
      mediaListEl.appendChild(li);
    });
  }

  function setActiveMedia(idx) {
    if (idx === activeIndex || !mediaPool[idx]) return;
    const prev = mediaPool[activeIndex];
    if (prev && prev.type === "video") prev.el.pause();
    activeIndex = idx;
    activeMedia = mediaPool[idx];
    if (activeMedia.type === "video") {
      activeMedia.el.muted = !audioToggle.checked;
      if (playing) activeMedia.el.play().catch(() => {});
    }
    renderMediaList();
  }

  function switchActiveMedia() {
    if (mediaPool.length < 2) return;
    let idx;
    do { idx = randInt(0, mediaPool.length - 1); } while (idx === activeIndex);
    setActiveMedia(idx);
  }

  function removeMedia(idx) {
    const media = mediaPool[idx];
    if (!media) return;
    if (media.type === "video") { try { media.el.pause(); media.el.src = ""; } catch (e) {} }
    URL.revokeObjectURL(media.url);
    mediaPool.splice(idx, 1);

    if (mediaPool.length === 0) {
      activeIndex = -1;
      activeMedia = null;
      playing = false;
      playBtn.textContent = "再生";
      playBtn.classList.remove("playing");
      playBtn.disabled = true;
      shuffleBtn.disabled = true;
      recordBtn.disabled = true;
      stageHint.hidden = false;
      resetCanvas();
    } else if (idx === activeIndex) {
      activeIndex = -1;
      setActiveMedia(idx >= mediaPool.length ? mediaPool.length - 1 : idx);
    } else if (idx < activeIndex) {
      activeIndex--;
    }
    renderMediaList();
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    for (const file of files) {
      try {
        const media = await loadFile(file);
        ensureCanvasSize(media);
        mediaPool.push(media);
        if (activeIndex === -1) {
          activeIndex = mediaPool.length - 1;
          activeMedia = media;
          if (media.type === "video") media.el.muted = !audioToggle.checked;
          drawMediaFrame(ctx, media, stage.width, stage.height);
          stageHint.hidden = true;
          playBtn.disabled = false;
          shuffleBtn.disabled = false;
          recordBtn.disabled = false;
        }
        recordStatus.textContent = "";
      } catch (err) {
        console.error(err);
        recordStatus.textContent = err.message;
      }
    }
    renderMediaList();
  }

  // ---- drawing: object-fit:cover style crop -----------------------------

  function coverRect(mediaW, mediaH, canvasW, canvasH) {
    const mediaAspect = mediaW / mediaH;
    const canvasAspect = canvasW / canvasH;
    let sw, sh, sx, sy;
    if (mediaAspect > canvasAspect) {
      sh = mediaH;
      sw = sh * canvasAspect;
      sx = (mediaW - sw) / 2;
      sy = 0;
    } else {
      sw = mediaW;
      sh = sw / canvasAspect;
      sx = 0;
      sy = (mediaH - sh) / 2;
    }
    return { sx, sy, sw, sh };
  }

  function drawMediaFrame(c, media, w, h) {
    const r = coverRect(media.w, media.h, w, h);
    try {
      c.drawImage(media.el, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    } catch (e) { /* video frame not ready yet */ }
  }

  // ---- glitch effects -----------------------------------------------

  function applySliceDisplace(c, w, h, amt) {
    const bands = 2 + Math.round(amt / 10);
    for (let i = 0; i < bands; i++) {
      const bandH = randInt(4, Math.max(6, Math.round(h * 0.08)));
      const y = randInt(0, Math.max(0, h - bandH));
      const dx = randInt(-amt * 2, amt * 2);
      c.drawImage(c.canvas, 0, y, w, bandH, dx, y, w, bandH);
    }
  }

  const zoomState = { sx: 0, sy: 0, sw: 1, sh: 1, tsx: 0, tsy: 0, tsw: 1, tsh: 1, inited: false };

  function newZoomTarget(w, h) {
    const scale = 1 + Math.random() * 1.8;
    const tsw = w / scale, tsh = h / scale;
    zoomState.tsx = randInt(0, Math.max(0, w - tsw));
    zoomState.tsy = randInt(0, Math.max(0, h - tsh));
    zoomState.tsw = tsw;
    zoomState.tsh = tsh;
    if (!zoomState.inited) {
      zoomState.sx = zoomState.tsx; zoomState.sy = zoomState.tsy;
      zoomState.sw = zoomState.tsw; zoomState.sh = zoomState.tsh;
      zoomState.inited = true;
    }
  }

  function applyZoomPunch(c, w, h) {
    const z = zoomState;
    z.sx += (z.tsx - z.sx) * 0.12;
    z.sy += (z.tsy - z.sy) * 0.12;
    z.sw += (z.tsw - z.sw) * 0.12;
    z.sh += (z.tsh - z.sh) * 0.12;
    c.drawImage(c.canvas, z.sx, z.sy, z.sw, z.sh, 0, 0, w, h);
  }

  let mirrorTemp = null;
  function applyMirrorGlitch(c, w, h) {
    if (!mirrorTemp) mirrorTemp = document.createElement("canvas");
    if (mirrorTemp.width !== w || mirrorTemp.height !== h) {
      mirrorTemp.width = w; mirrorTemp.height = h;
    }
    const tctx = mirrorTemp.getContext("2d");
    tctx.drawImage(c.canvas, 0, 0);

    c.save();
    if (Math.random() < 0.5) {
      const half = w / 2;
      c.translate(w, 0);
      c.scale(-1, 1);
      if (Math.random() < 0.5) c.drawImage(mirrorTemp, 0, 0, half, h, 0, 0, half, h);
      else c.drawImage(mirrorTemp, half, 0, half, h, half, 0, half, h);
    } else {
      const half = h / 2;
      c.translate(0, h);
      c.scale(1, -1);
      if (Math.random() < 0.5) c.drawImage(mirrorTemp, 0, 0, w, half, 0, 0, w, half);
      else c.drawImage(mirrorTemp, 0, half, w, half, 0, half, w, half);
    }
    c.restore();
  }

  function applyGhostBlend(c, w, h, pool, activeIdx) {
    let alt = null, selfMix = false;
    if (pool.length > 1) {
      let idx;
      do { idx = randInt(0, pool.length - 1); } while (idx === activeIdx);
      alt = pool[idx];
    } else if (pool.length === 1) {
      alt = pool[0];
      selfMix = true;
    }
    if (!alt) return;
    const r = coverRect(alt.w, alt.h, w, h);
    c.save();
    c.globalAlpha = 0.2 + Math.random() * 0.35;
    c.globalCompositeOperation = choice(["screen", "difference", "lighter", "exclusion", "overlay"]);
    if (selfMix) { c.translate(w, 0); c.scale(-1, 1); }
    try {
      c.drawImage(alt.el, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    } catch (e) {}
    c.restore();
  }

  let scanOffset = 0;
  function applyScanlines(c, w, h, amt) {
    scanOffset = (scanOffset + 1 + amt / 20) % 4;
    c.save();
    c.globalAlpha = 0.1 + amt / 300;
    c.fillStyle = "#000";
    for (let y = Math.floor(scanOffset); y < h; y += 3) {
      c.fillRect(0, y, w, 1);
    }
    c.restore();

    if (Math.random() < 0.3) {
      const jig = randInt(-2, 2);
      if (jig !== 0) c.drawImage(c.canvas, jig, 0);
    }
    if (Math.random() < 0.5) {
      c.save();
      c.globalAlpha = 0.05;
      c.fillStyle = Math.random() < 0.5 ? "#fff" : "#000";
      const n = Math.round(amt);
      for (let i = 0; i < n; i++) c.fillRect(randInt(0, w - 1), randInt(0, h - 1), 1, 1);
      c.restore();
    }
  }

  function applyInvertFlicker(c, w, h) {
    c.save();
    c.globalCompositeOperation = "difference";
    c.fillStyle = "#fff";
    c.fillRect(0, 0, w, h);
    c.restore();
  }

  function applyFreezeSmearTick(c, w, h) {
    const dx = randInt(-3, 3), dy = randInt(-2, 2);
    c.save();
    c.globalAlpha = 0.94;
    c.drawImage(c.canvas, dx, dy);
    c.restore();
    if (Math.random() < 0.4) {
      const bw = randInt(Math.round(w * 0.1), Math.round(w * 0.4));
      const bh = randInt(Math.round(h * 0.05), Math.round(h * 0.25));
      const sx = randInt(0, Math.max(0, w - bw));
      const sy = randInt(0, Math.max(0, h - bh));
      const dx2 = clampInt(sx + randInt(-40, 40), 0, Math.max(0, w - bw));
      const dy2 = clampInt(sy + randInt(-40, 40), 0, Math.max(0, h - bh));
      c.drawImage(c.canvas, sx, sy, bw, bh, dx2, dy2, bw, bh);
    }
  }

  // pixel-level effects share one getImageData/putImageData pass per frame

  function channelShiftBuffer(data, original, w, h, amt) {
    const dx = 1 + Math.round(amt / 6);
    for (let y = 0; y < h; y++) {
      const rowStart = y * w * 4;
      for (let x = 0; x < w; x++) {
        const i = rowStart + x * 4;
        const rx = clampInt(x - dx, 0, w - 1);
        const bx = clampInt(x + dx, 0, w - 1);
        data[i] = original[rowStart + rx * 4];
        data[i + 1] = original[rowStart + x * 4 + 1];
        data[i + 2] = original[rowStart + bx * 4 + 2];
      }
    }
  }

  function blockNoiseBuffer(data, w, h, amt) {
    const blocks = 1 + Math.round(amt / 20);
    for (let b = 0; b < blocks; b++) {
      const bw = randInt(Math.max(2, Math.round(w * 0.03)), Math.max(4, Math.round(w * 0.22)));
      const bh = randInt(Math.max(2, Math.round(h * 0.02)), Math.max(4, Math.round(h * 0.12)));
      const bx = randInt(0, Math.max(0, w - bw));
      const by = randInt(0, Math.max(0, h - bh));
      const r = randInt(0, 255), g = randInt(0, 255), bl = randInt(0, 255);
      for (let y = by; y < by + bh && y < h; y++) {
        let i = (y * w + bx) * 4;
        for (let x = bx; x < bx + bw && x < w; x++) {
          data[i] = clampByte(r + randInt(-20, 20));
          data[i + 1] = clampByte(g + randInt(-20, 20));
          data[i + 2] = clampByte(bl + randInt(-20, 20));
          i += 4;
        }
      }
    }
  }

  function sortRun(data, rowStart, start, end) {
    const len = end - start;
    if (len < 2) return;
    const pixels = [];
    for (let x = start; x < end; x++) {
      const i = rowStart + x * 4;
      pixels.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
    }
    pixels.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    for (let k = 0; k < len; k++) {
      const i = rowStart + (start + k) * 4;
      data[i] = pixels[k][0]; data[i + 1] = pixels[k][1]; data[i + 2] = pixels[k][2]; data[i + 3] = pixels[k][3];
    }
  }

  function pixelSortBuffer(data, w, h, amt) {
    const rows = 1 + Math.round(amt / 15);
    const threshold = 90;
    for (let r = 0; r < rows; r++) {
      const y = randInt(0, h - 1);
      const rowStart = y * w * 4;
      let x = 0;
      while (x < w) {
        const i = rowStart + x * 4;
        const bright = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (bright > threshold) {
          const runStart = x;
          while (x < w) {
            const j = rowStart + x * 4;
            const b2 = (data[j] + data[j + 1] + data[j + 2]) / 3;
            if (b2 <= threshold) break;
            x++;
          }
          sortRun(data, rowStart, runStart, x);
        } else {
          x++;
        }
      }
    }
  }

  function applyPixelEffects(c, w, h, fx, amt) {
    const needsChannelShift = fx.has("channelShift");
    const needsBlockNoise = fx.has("blockNoise");
    const needsPixelSort = fx.has("pixelSort");
    if (!needsChannelShift && !needsBlockNoise && !needsPixelSort) return;
    const imgData = c.getImageData(0, 0, w, h);
    const data = imgData.data;
    if (needsChannelShift) {
      const original = data.slice(0);
      channelShiftBuffer(data, original, w, h, amt);
    }
    if (needsBlockNoise) blockNoiseBuffer(data, w, h, amt);
    if (needsPixelSort) pixelSortBuffer(data, w, h, amt);
    c.putImageData(imgData, 0, 0);
  }

  // ---- director: chooses which effects run & when sources switch -------

  const state = {
    activeEffects: new Set(),
    cycleAt: 0,
    cycleDuration: 900,
    sourceSwitchAt: 0,
    sourceSwitchDuration: 4000,
    freezing: false,
    freezeFramesLeft: 0,
    flickerFramesLeft: 0,
  };

  function enabledEffectKeys() {
    return Array.from(document.querySelectorAll("#effectFieldset input[data-fx]:checked")).map((el) => el.dataset.fx);
  }

  function pickNewEffects() {
    const pool = enabledEffectKeys();
    if (!pool.length) { state.activeEffects = new Set(); return; }
    const intensity = +intensitySlider.value;
    const count = clampInt(1 + Math.round((intensity / 100) * 3), 1, Math.min(4, pool.length));
    const shuffled = shuffleArray(pool.slice());
    state.activeEffects = new Set(shuffled.slice(0, count));
    if (state.activeEffects.has("zoomPunch")) newZoomTarget(stage.width, stage.height);
  }

  function speedToDuration(speed) {
    return lerp(2600, 350, speed / 100);
  }

  function updateDirector(nowMs) {
    const speed = +speedSlider.value;
    const intensity = +intensitySlider.value;

    if (nowMs - state.cycleAt > state.cycleDuration) {
      state.cycleAt = nowMs;
      state.cycleDuration = speedToDuration(speed) * (0.6 + Math.random() * 0.8);
      pickNewEffects();
      if (state.activeEffects.has("invertFlicker") && Math.random() < 0.35) {
        state.flickerFramesLeft = randInt(1, 3);
      }
      if (state.activeEffects.has("freezeSmear") && !state.freezing && Math.random() < 0.3 + intensity / 200) {
        state.freezing = true;
        state.freezeFramesLeft = randInt(3, 5 + Math.round(intensity / 8));
      }
    }

    if (mediaPool.length > 1 && nowMs - state.sourceSwitchAt > state.sourceSwitchDuration) {
      state.sourceSwitchAt = nowMs;
      state.sourceSwitchDuration = lerp(7000, 2200, speed / 100) * (0.6 + Math.random() * 0.8);
      switchActiveMedia();
    }
  }

  // ---- main render loop ----------------------------------------------

  function renderFrame(nowMs) {
    requestAnimationFrame(renderFrame);
    if (!playing || !activeMedia || stage.width === 0) return;

    const w = stage.width, h = stage.height;
    updateDirector(nowMs);
    const fx = state.activeEffects;
    const intensity = +intensitySlider.value;

    if (!state.freezing) {
      drawMediaFrame(ctx, activeMedia, w, h);
    } else {
      applyFreezeSmearTick(ctx, w, h);
      state.freezeFramesLeft--;
      if (state.freezeFramesLeft <= 0) state.freezing = false;
    }

    if (!state.freezing) {
      applyPixelEffects(ctx, w, h, fx, intensity);
      if (fx.has("sliceDisplace")) applySliceDisplace(ctx, w, h, intensity);
      if (fx.has("zoomPunch")) applyZoomPunch(ctx, w, h);
      if (fx.has("mirrorGlitch") && Math.random() < 0.5) applyMirrorGlitch(ctx, w, h);
      if (fx.has("ghostBlend")) applyGhostBlend(ctx, w, h, mediaPool, activeIndex);
      if (fx.has("scanlines")) applyScanlines(ctx, w, h, intensity);
    }
    if (fx.has("invertFlicker") && state.flickerFramesLeft > 0) {
      applyInvertFlicker(ctx, w, h);
      state.flickerFramesLeft--;
    }
  }
  requestAnimationFrame(renderFrame);

  // ---- recording --------------------------------------------------

  let recorder = null;
  let chunks = [];
  let recording = false;
  let recordTimeout = null;

  function pickSupportedMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    const candidates = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  function extFor(mime) {
    return mime && mime.includes("mp4") ? "mp4" : "webm";
  }

  function startRecording(durationSec) {
    if (!activeMedia) return;
    if (!window.MediaRecorder || !stage.captureStream) {
      recordStatus.textContent = "この端末・ブラウザは録画に対応していません。";
      return;
    }
    let stream;
    try {
      stream = stage.captureStream(30);
    } catch (e) {
      recordStatus.textContent = "録画を開始できませんでした。";
      return;
    }
    if (audioToggle.checked && activeMedia.type === "video" && activeMedia.el.captureStream) {
      try {
        const audioStream = activeMedia.el.captureStream();
        audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
      } catch (e) { /* audio capture unsupported here, continue without it */ }
    }
    const mimeType = pickSupportedMime();
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (e) {
      recordStatus.textContent = "録画を開始できませんでした。";
      return;
    }

    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      recording = false;
      recordBtn.textContent = "録画開始";
      recordBtn.classList.remove("recording");
      const outType = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunks, { type: outType });
      if (downloadLink.href) URL.revokeObjectURL(downloadLink.href);
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = `glitchmix-${Date.now()}.${extFor(outType)}`;
      downloadLink.hidden = false;
      recordStatus.textContent = "書き出し完了。下のリンクからダウンロードできます。";
    };

    recorder.start();
    recording = true;
    recordBtn.textContent = "録画停止";
    recordBtn.classList.add("recording");
    recordStatus.textContent = "録画中…";

    if (durationSec > 0) {
      recordTimeout = setTimeout(() => { if (recording) stopRecording(); }, durationSec * 1000);
    }
    if (!playing) startPlayback();
  }

  function stopRecording() {
    if (recordTimeout) { clearTimeout(recordTimeout); recordTimeout = null; }
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  // ---- transport -----------------------------------------------------

  function startPlayback() {
    playing = true;
    playBtn.textContent = "一時停止";
    playBtn.classList.add("playing");
    if (activeMedia && activeMedia.type === "video") activeMedia.el.play().catch(() => {});
  }

  function pausePlayback() {
    playing = false;
    playBtn.textContent = "再生";
    playBtn.classList.remove("playing");
    if (activeMedia && activeMedia.type === "video") activeMedia.el.pause();
  }

  playBtn.addEventListener("click", () => { playing ? pausePlayback() : startPlayback(); });

  shuffleBtn.addEventListener("click", () => {
    pickNewEffects();
    state.cycleAt = performance.now();
    state.cycleDuration = speedToDuration(+speedSlider.value);
  });

  audioToggle.addEventListener("change", () => {
    if (activeMedia && activeMedia.type === "video") activeMedia.el.muted = !audioToggle.checked;
  });

  recordBtn.addEventListener("click", () => {
    if (recording) stopRecording();
    else startRecording(+durationSelect.value);
  });

  // ---- file input / drag & drop --------------------------------------

  pickBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragging");
    });
  });
  ["dragleave", "dragend"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragging");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  });

  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    recordStatus.textContent = "この端末・ブラウザは録画に対応していません（プレビューは利用できます）。";
  }
})();
