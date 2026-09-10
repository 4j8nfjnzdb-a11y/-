// ZURE — a single video clip, endlessly re-broken.
//
// One file is loaded, a short window (a few seconds) is captured into a
// frame buffer, and from then on that buffer is the only material: it is
// played forward, backward, frozen, torn, discolored and ghosted, but
// never re-fetched from the source until the person explicitly asks for
// a new sample. The point is obsessive engagement with one piece of
// footage rather than a library of clips — closer to a structural-film
// exercise than a video editor.

(() => {
  const video = document.getElementById("srcVideo");
  const loader = document.getElementById("loader");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const stageSection = document.getElementById("stage");
  const canvasWrap = document.getElementById("canvasWrap");
  const stageCanvas = document.getElementById("stageCanvas");
  const spectralCanvas = document.getElementById("spectralCanvas");
  const statusLine = document.getElementById("statusLine");
  const loadBar = document.getElementById("loadBar");
  const loadBarFill = document.getElementById("loadBarFill");
  const loadHint = document.getElementById("loadHint");

  const rangeLenSlider = document.getElementById("rangeLenSlider");
  const rangeLenLabel = document.getElementById("rangeLenLabel");
  const resampleBtn = document.getElementById("resampleBtn");
  const trimStartSlider = document.getElementById("trimStart");
  const trimEndSlider = document.getElementById("trimEnd");
  const trimLabel = document.getElementById("trimLabel");

  const diceBtn = document.getElementById("diceBtn");
  const fadersDiceBtn = document.getElementById("fadersDiceBtn");
  const recordBtn = document.getElementById("recordBtn");
  const autoDiceToggle = document.getElementById("autoDice");
  const specToggle = document.getElementById("specToggle");
  const muteToggle = document.getElementById("muteToggle");
  const zoomAutoToggle = document.getElementById("zoomAutoToggle");

  const speedSlider = document.getElementById("speedSlider");
  const zoomSlider = document.getElementById("zoomSlider");
  const ghostSlider = document.getElementById("ghostSlider");
  const blurSlider = document.getElementById("blurSlider");
  const hueSlider = document.getElementById("hueSlider");
  const glitchSlider = document.getElementById("glitchSlider");

  const newFileBtn = document.getElementById("newFileBtn");
  const refToggle = document.getElementById("refToggle");
  const refPanel = document.getElementById("refPanel");

  const stageCtx = stageCanvas.getContext("2d");
  const spectralCtx = spectralCanvas.getContext("2d", { willReadFrequently: true });
  const W = stageCanvas.width, H = stageCanvas.height;

  const workCanvas = document.createElement("canvas");
  workCanvas.width = W; workCanvas.height = H;
  const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });

  const trailCanvas = document.createElement("canvas");
  trailCanvas.width = W; trailCanvas.height = H;
  const trailCtx = trailCanvas.getContext("2d");

  // ---- helpers ----------------------------------------------------

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clampInt = (v, lo, hi) => Math.round(clamp(v, lo, hi));

  // ---- capture buffer ----------------------------------------------

  let buffer = [];
  let capturing = false;
  let captureStart = 0, captureEnd = 0;
  const CAPTURE_FPS = 12;

  function computeFit(vw, vh) {
    const scale = Math.min(W / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh };
  }

  function seekTo(t) {
    return new Promise((resolve) => {
      // If we're already essentially there (common for short clips whose
      // random start lands on 0, the video's resting position), setting
      // currentTime is a no-op and "seeked" never fires — resolve directly
      // instead of hanging capture forever.
      if (Math.abs(video.currentTime - t) < 0.03) { resolve(); return; }
      function onSeeked() { video.removeEventListener("seeked", onSeeked); resolve(); }
      video.addEventListener("seeked", onSeeked);
      video.currentTime = t;
    });
  }

  function grabFrame(fit) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const cctx = c.getContext("2d");
    cctx.fillStyle = "#000";
    cctx.fillRect(0, 0, W, H);
    cctx.drawImage(video, fit.dx, fit.dy, fit.dw, fit.dh);
    buffer.push(c);
  }

  async function doCapture(startSec, lengthSec) {
    if (!video.duration || capturing) return;
    capturing = true;
    clearAudioLoop();
    updateStatus("サンプリング中…");
    loadHint.hidden = false;
    loadBar.hidden = false;
    loadBarFill.style.width = "0%";

    buffer = [];
    const fit = computeFit(video.videoWidth, video.videoHeight);
    const endSec = Math.min(video.duration - 0.02, startSec + lengthSec);
    captureStart = startSec;
    captureEnd = endSec;

    await seekTo(startSec);

    // Sampling plays the source in real time to grab frames, so a long
    // range otherwise means a long silent wait. Play it back faster
    // (up to 4x) so capture wraps up in ~1.5s regardless of range length.
    const captureRate = clamp(lengthSec / 1.5, 1, 4);
    video.playbackRate = captureRate;

    const minInterval = 1000 / CAPTURE_FPS;
    let lastCapTs = -Infinity;
    const expectedFrames = Math.min(CAPTURE_FPS * 10, Math.ceil(lengthSec * CAPTURE_FPS));
    const maxFrames = CAPTURE_FPS * 10;

    await new Promise((resolve) => {
      function step(nowTs, metadata) {
        const mediaTime = metadata ? metadata.mediaTime : video.currentTime;
        if (mediaTime >= endSec || buffer.length >= maxFrames) {
          finish();
          return;
        }
        if (nowTs - lastCapTs >= minInterval - 2) {
          lastCapTs = nowTs;
          grabFrame(fit);
          loadBarFill.style.width = `${Math.min(100, (buffer.length / expectedFrames) * 100)}%`;
        }
        schedule();
      }
      function schedule() {
        if ("requestVideoFrameCallback" in video) {
          video.requestVideoFrameCallback(step);
        } else {
          requestAnimationFrame((t) => step(t, null));
        }
      }
      function finish() {
        video.pause();
        resolve();
      }
      video.play().then(schedule).catch(() => resolve());
    });

    loadBarFill.style.width = "100%";
    loadHint.hidden = true;
    loadBar.hidden = true;

    capturing = false;
    trimStart = 0; trimEnd = 100;
    trimStartSlider.value = 0; trimEndSlider.value = 100;
    updateTrimLabel();
    playhead = 0; pingDir = 1;
    updateStatus();
    startAudioLoop(captureStart, captureEnd);
    recordBtn.disabled = false;
  }

  function randomStart(duration, len) {
    return Math.random() * Math.max(0, duration - len);
  }

  // ---- audio (analysis + a steady loop of the sampled range) -------

  let audioCtx = null, analyser = null, gainNode = null, recDest = null;
  let audioLoopHandler = null;
  let spectralBuf = null;

  function initAudioGraph() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaElementSource(video);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      gainNode = audioCtx.createGain();
      gainNode.gain.value = muteToggle.checked ? 0 : 1;
      source.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      recDest = audioCtx.createMediaStreamDestination();
      gainNode.connect(recDest);
    } catch (e) {
      // Web Audio unavailable — silent visual-only mode.
    }
  }

  function clearAudioLoop() {
    if (audioLoopHandler) video.removeEventListener("timeupdate", audioLoopHandler);
    audioLoopHandler = null;
  }

  function startAudioLoop(start, end) {
    clearAudioLoop();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    video.currentTime = start;
    video.playbackRate = clamp(+speedSlider.value / 100, 0.25, 4);
    video.play().catch(() => {});
    audioLoopHandler = () => {
      if (video.currentTime >= end - 0.03) video.currentTime = start;
    };
    video.addEventListener("timeupdate", audioLoopHandler);
  }

  function drawSpectralColumn() {
    if (!analyser) return;
    if (!spectralBuf || spectralBuf.length !== analyser.frequencyBinCount) {
      spectralBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(spectralBuf);
    const img = spectralCtx.getImageData(1, 0, W - 1, H);
    spectralCtx.putImageData(img, 0, 0);
    const bins = spectralBuf.length;
    for (let y = 0; y < H; y++) {
      const t = 1 - y / H;
      const bin = Math.min(bins - 1, Math.floor(t * t * bins));
      const v = spectralBuf[bin];
      const hue = 140 - (v / 255) * 140;
      const light = 4 + (v / 255) * 55;
      spectralCtx.fillStyle = `hsl(${hue}, 90%, ${light}%)`;
      spectralCtx.fillRect(W - 1, y, 1, 1);
    }
  }

  // ---- playback engine ----------------------------------------------

  let mode = "forward";
  let playhead = 0;
  let pingDir = 1;
  let stutterHoldUntil = 0;
  let lastTs = null;

  const toggles = { ghost: false, blurOn: false, invert: false, chroma: false, slice: false };
  let trimStart = 0, trimEnd = 100;

  function setMode(name) {
    mode = name;
    document.querySelectorAll(".pad.mode").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === name);
    });
    if (name === "pingpong") pingDir = 1;
    updateStatus();
  }

  function syncToggleButtons() {
    document.querySelectorAll(".pad.toggle").forEach((b) => {
      b.classList.toggle("active", !!toggles[b.dataset.toggle]);
    });
  }

  function clearTrail() {
    trailCtx.clearRect(0, 0, W, H);
  }

  function bounds() {
    const lo = Math.floor((trimStart / 100) * (buffer.length - 1));
    const hi = Math.max(lo + 1, Math.ceil((trimEnd / 100) * (buffer.length - 1)));
    return { lo, hi, span: Math.max(1, hi - lo) };
  }

  function advance(dtMs) {
    const { lo, hi, span } = bounds();
    const speedMag = +speedSlider.value / 100;
    const framesDelta = dtMs * (CAPTURE_FPS / 1000) * speedMag;

    switch (mode) {
      case "forward":
        playhead += framesDelta;
        if (playhead > hi) playhead = lo + ((playhead - lo) % span);
        break;
      case "reverse":
        playhead -= framesDelta;
        if (playhead < lo) playhead = hi - ((lo - playhead) % span);
        break;
      case "rewind":
        playhead -= framesDelta * 2.5;
        if (playhead < lo) playhead = hi - ((lo - playhead) % span);
        break;
      case "fastforward":
        playhead += framesDelta * 2.5;
        if (playhead > hi) playhead = lo + ((playhead - lo) % span);
        break;
      case "pingpong":
        playhead += framesDelta * pingDir;
        if (playhead > hi) { playhead = hi - (playhead - hi); pingDir = -1; }
        if (playhead < lo) { playhead = lo + (lo - playhead); pingDir = 1; }
        break;
      case "freeze":
        break;
      case "stutter": {
        const now = performance.now();
        if (now > stutterHoldUntil) {
          const glitch = +glitchSlider.value / 100;
          if (Math.random() < 0.15 + glitch * 0.5) {
            playhead = lo + Math.random() * span;
            stutterHoldUntil = now + 60 + Math.random() * 220 * (0.3 + glitch);
          } else {
            playhead += framesDelta;
            if (playhead > hi) playhead = lo;
          }
        }
        break;
      }
    }
    playhead = clamp(playhead, lo, hi);
  }

  function applySliceGlitch(idx) {
    const intensity = +glitchSlider.value / 100;
    if (Math.random() > 0.12 + intensity * 0.5) return;
    const bands = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bands; i++) {
      const bandH = Math.max(4, Math.floor(Math.random() * H * 0.18));
      const y = Math.floor(Math.random() * Math.max(1, H - bandH));
      const otherIdx = clampInt(idx + (Math.random() - 0.5) * buffer.length * 0.6, 0, buffer.length - 1);
      const other = buffer[otherIdx];
      const xShift = Math.floor((Math.random() - 0.5) * W * 0.3);
      workCtx.drawImage(other, 0, y, W, bandH, xShift, y, W, bandH);
    }
  }

  function applyChromaShift() {
    const intensity = +glitchSlider.value / 100;
    const dx = Math.max(1, Math.round(2 + intensity * 10));
    const imgData = workCtx.getImageData(0, 0, W, H);
    const src = imgData.data;
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < H; y++) {
      const rowStart = y * W;
      for (let x = 0; x < W; x++) {
        const i = (rowStart + x) * 4;
        const rx = Math.min(W - 1, x + dx);
        const bx = Math.max(0, x - dx);
        const ri = (rowStart + rx) * 4;
        const bi = (rowStart + bx) * 4;
        out[i] = src[ri];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[bi + 2];
        out[i + 3] = src[i + 3];
      }
    }
    workCtx.putImageData(new ImageData(out, W, H), 0, 0);
  }

  function renderFrame(idx) {
    idx = clampInt(idx, 0, buffer.length - 1);
    const bmp = buffer[idx];

    workCtx.clearRect(0, 0, W, H);
    workCtx.filter = "none";
    workCtx.globalAlpha = 1;

    const zoomScale = 1 + (clamp(+zoomSlider.value, 0, 100) / 100) * 2.5;
    if (zoomScale > 1.001) {
      const srcW = W / zoomScale, srcH = H / zoomScale;
      workCtx.drawImage(bmp, (W - srcW) / 2, (H - srcH) / 2, srcW, srcH, 0, 0, W, H);
    } else {
      workCtx.drawImage(bmp, 0, 0, W, H);
    }

    if (toggles.slice) applySliceGlitch(idx);
    if (toggles.chroma) applyChromaShift();

    const filters = [];
    if (toggles.invert) filters.push("invert(1)");
    const hueDeg = +hueSlider.value;
    if (hueDeg > 0) filters.push(`hue-rotate(${hueDeg}deg)`);
    if (toggles.blurOn) {
      const blurPx = (+blurSlider.value / 100) * 18;
      if (blurPx > 0.1) filters.push(`blur(${blurPx}px)`);
    }
    const filterStr = filters.length ? filters.join(" ") : "none";

    stageCtx.clearRect(0, 0, W, H);

    if (toggles.ghost) {
      const ghostAmt = clamp(+ghostSlider.value / 100, 0, 0.98);
      trailCtx.save();
      trailCtx.globalCompositeOperation = "destination-out";
      trailCtx.globalAlpha = 1 - ghostAmt;
      trailCtx.fillStyle = "#000";
      trailCtx.fillRect(0, 0, W, H);
      trailCtx.restore();

      trailCtx.globalCompositeOperation = "source-over";
      trailCtx.globalAlpha = 0.85;
      trailCtx.filter = filterStr;
      trailCtx.drawImage(workCanvas, 0, 0);
      trailCtx.globalAlpha = 1;
      trailCtx.filter = "none";

      stageCtx.drawImage(trailCanvas, 0, 0);
    }

    stageCtx.filter = filterStr;
    stageCtx.globalAlpha = 1;
    stageCtx.drawImage(workCanvas, 0, 0);
    stageCtx.filter = "none";
  }

  function modeLabel(name) {
    return {
      forward: "FWD", reverse: "REV", pingpong: "PING", freeze: "FRZ",
      rewind: "RWD", fastforward: "FF", stutter: "STUT",
    }[name] || name;
  }

  function updateStatus(customMsg) {
    if (customMsg) { statusLine.textContent = customMsg; return; }
    if (!buffer.length) { statusLine.textContent = ""; return; }
    const speedMag = (+speedSlider.value / 100).toFixed(2);
    const zoomScale = (1 + (clamp(+zoomSlider.value, 0, 100) / 100) * 2.5).toFixed(1);
    statusLine.textContent = `${modeLabel(mode)} ×${speedMag} / zoom ${zoomScale}x / ${buffer.length}f`;
  }

  let loopStarted = false;
  let zoomAutoPhase = 0;
  let lastStatusTs = 0;

  // A slow, continuous zoom drift — Michael Snow's single unbroken zoom
  // (Wavelength) as an automatic mode, ~50s to complete one push in and back.
  function advanceZoomAuto(dtMs) {
    if (!zoomAutoToggle.checked) return;
    zoomAutoPhase += dtMs * 0.000126;
    zoomSlider.value = Math.round((Math.sin(zoomAutoPhase) * 0.5 + 0.5) * 100);
  }

  function tick(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(100, ts - lastTs);
    lastTs = ts;

    advanceZoomAuto(dt);

    if (buffer.length > 1) {
      advance(dt);
      renderFrame(Math.round(playhead));
    }
    if (specToggle.checked) drawSpectralColumn();
    if (ts - lastStatusTs > 250) {
      lastStatusTs = ts;
      updateStatus();
    }

    requestAnimationFrame(tick);
  }

  function startPlaybackLoopOnce() {
    if (loopStarted) return;
    loopStarted = true;
    requestAnimationFrame(tick);
  }

  // ---- dice / auto-drift ---------------------------------------------

  const MODES = ["forward", "reverse", "pingpong", "freeze", "rewind", "fastforward", "stutter"];

  function dice() {
    setMode(MODES[Math.floor(Math.random() * MODES.length)]);

    toggles.ghost = Math.random() < 0.5;
    toggles.blurOn = Math.random() < 0.3;
    toggles.invert = Math.random() < 0.25;
    toggles.chroma = Math.random() < 0.3;
    toggles.slice = Math.random() < 0.3;
    syncToggleButtons();
    if (!toggles.ghost) clearTrail();

    speedSlider.value = Math.round(20 + Math.random() * 300);
    video.playbackRate = clamp(+speedSlider.value / 100, 0.25, 4);
    zoomSlider.value = Math.round(Math.random() * 100);
    ghostSlider.value = Math.round(Math.random() * 100);
    blurSlider.value = Math.round(Math.random() * 70);
    hueSlider.value = Math.round(Math.random() * 360);
    glitchSlider.value = Math.round(Math.random() * 100);

    updateStatus();
  }

  // Randomizes only the fader row (speed/zoom/ghost/blur/hue/glitch),
  // leaving the current mode and toggle layers untouched — a lighter
  // shuffle than the full dice() reshuffle.
  function randomizeFaders() {
    speedSlider.value = Math.round(20 + Math.random() * 300);
    video.playbackRate = clamp(+speedSlider.value / 100, 0.25, 4);
    zoomSlider.value = Math.round(Math.random() * 100);
    ghostSlider.value = Math.round(Math.random() * 100);
    blurSlider.value = Math.round(Math.random() * 100);
    hueSlider.value = Math.round(Math.random() * 360);
    glitchSlider.value = Math.round(Math.random() * 100);
    updateStatus();
  }

  let autoDiceTimer = null;

  function driftOneParam() {
    const actions = [
      () => setMode(MODES[Math.floor(Math.random() * MODES.length)]),
      () => { toggles.ghost = !toggles.ghost; if (!toggles.ghost) clearTrail(); syncToggleButtons(); },
      () => { toggles.blurOn = !toggles.blurOn; syncToggleButtons(); },
      () => { toggles.invert = !toggles.invert; syncToggleButtons(); },
      () => { toggles.chroma = !toggles.chroma; syncToggleButtons(); },
      () => { toggles.slice = !toggles.slice; syncToggleButtons(); },
      () => { speedSlider.value = Math.round(20 + Math.random() * 300); video.playbackRate = clamp(+speedSlider.value / 100, 0.25, 4); },
      () => { zoomSlider.value = Math.round(Math.random() * 100); },
      () => { hueSlider.value = Math.round(Math.random() * 360); },
      () => { ghostSlider.value = Math.round(Math.random() * 100); },
      () => { blurSlider.value = Math.round(Math.random() * 70); },
      () => { glitchSlider.value = Math.round(Math.random() * 100); },
    ];
    actions[Math.floor(Math.random() * actions.length)]();
    updateStatus();
  }

  function scheduleAutoDice() {
    clearTimeout(autoDiceTimer);
    if (!autoDiceToggle.checked) return;
    const delay = 1800 + Math.random() * 4500;
    autoDiceTimer = setTimeout(() => {
      driftOneParam();
      scheduleAutoDice();
    }, delay);
  }

  // ---- recording: capture the rendered canvas + live audio to a file --

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordTimer = null;
  let recordStartTs = 0;

  function pickRecordingMimeType() {
    const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  function startRecording() {
    if (mediaRecorder || !window.MediaRecorder) return;
    const combined = new MediaStream();
    stageCanvas.captureStream(30).getVideoTracks().forEach((t) => combined.addTrack(t));
    if (recDest) recDest.stream.getAudioTracks().forEach((t) => combined.addTrack(t));

    const mimeType = pickRecordingMimeType();
    try {
      mediaRecorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
    } catch (e) {
      updateStatus("この端末では録画に対応していません");
      return;
    }
    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zure-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      mediaRecorder = null;
    };
    mediaRecorder.start();
    recordStartTs = performance.now();
    recordBtn.classList.add("recording");
    recordTimer = setInterval(() => {
      const sec = Math.floor((performance.now() - recordStartTs) / 1000);
      const m = Math.floor(sec / 60), s = sec % 60;
      recordBtn.textContent = `⏹ 録画停止 ${m}:${String(s).padStart(2, "0")}`;
    }, 500);
  }

  function stopRecording() {
    if (!mediaRecorder) return;
    mediaRecorder.stop();
    clearInterval(recordTimer);
    recordBtn.classList.remove("recording");
    recordBtn.textContent = "⏺ 録画してダウンロード";
  }

  // ---- UI wiring -------------------------------------------------

  function updateRangeLenLabel() {
    rangeLenLabel.textContent = `${(+rangeLenSlider.value).toFixed(1)}s`;
  }

  function updateTrimLabel() {
    trimLabel.textContent = `${trimStart}–${trimEnd}%`;
  }

  function handleFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    video.src = url;
    video.load();
    loader.hidden = true;
    stageSection.hidden = false;
    video.addEventListener("loadedmetadata", onMetadataLoaded, { once: true });
  }

  function onMetadataLoaded() {
    initAudioGraph();
    const dur = video.duration;
    const maxLen = clamp(Math.floor(Math.max(1, dur - 0.1) * 2) / 2, 1, 8);
    rangeLenSlider.max = maxLen;
    const desiredLen = clamp(+(3 + Math.random() * 2).toFixed(1), 1, maxLen);
    rangeLenSlider.value = desiredLen;
    updateRangeLenLabel();
    const start = randomStart(dur, desiredLen);
    startPlaybackLoopOnce();
    doCapture(start, desiredLen);
  }

  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });
  fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

  newFileBtn.addEventListener("click", () => fileInput.click());

  refToggle.addEventListener("click", () => {
    const willShow = refPanel.hidden;
    refPanel.hidden = !willShow;
    refToggle.textContent = willShow ? "参考 / references ▴" : "参考 / references ▾";
  });

  document.querySelectorAll(".pad.mode").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });
  document.querySelectorAll(".pad.toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.toggle;
      toggles[key] = !toggles[key];
      if (key === "ghost" && !toggles.ghost) clearTrail();
      syncToggleButtons();
    });
  });
  setMode("forward");
  syncToggleButtons();

  diceBtn.addEventListener("click", dice);
  fadersDiceBtn.addEventListener("click", randomizeFaders);
  recordBtn.addEventListener("click", () => {
    if (mediaRecorder) stopRecording(); else startRecording();
  });
  autoDiceToggle.addEventListener("change", scheduleAutoDice);

  specToggle.addEventListener("change", () => {
    spectralCanvas.hidden = !specToggle.checked;
    if (specToggle.checked) {
      spectralCtx.fillStyle = "#000";
      spectralCtx.fillRect(0, 0, W, H);
    }
  });

  muteToggle.addEventListener("change", () => {
    if (gainNode) gainNode.gain.value = muteToggle.checked ? 0 : 1;
  });

  speedSlider.addEventListener("input", () => {
    video.playbackRate = clamp(+speedSlider.value / 100, 0.25, 4);
  });

  // interactive zoom: mouse wheel, and two-finger pinch on touch devices
  canvasWrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -4 : 4;
    zoomSlider.value = clamp(+zoomSlider.value + delta, 0, 100);
  }, { passive: false });

  let pinchStartDist = null;
  let pinchStartZoom = 0;
  function touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }
  canvasWrap.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      pinchStartDist = touchDist(e.touches);
      pinchStartZoom = +zoomSlider.value;
    }
  }, { passive: true });
  canvasWrap.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && pinchStartDist) {
      e.preventDefault();
      const ratio = touchDist(e.touches) / pinchStartDist;
      zoomSlider.value = clamp(pinchStartZoom + (ratio - 1) * 140, 0, 100);
    }
  }, { passive: false });
  canvasWrap.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) pinchStartDist = null;
  }, { passive: true });

  rangeLenSlider.addEventListener("input", updateRangeLenLabel);
  resampleBtn.addEventListener("click", () => {
    if (!video.duration || capturing) return;
    const len = +rangeLenSlider.value;
    doCapture(randomStart(video.duration, len), len);
  });

  trimStartSlider.addEventListener("input", () => {
    trimStart = Math.min(+trimStartSlider.value, +trimEndSlider.value - 1);
    trimStartSlider.value = trimStart;
    updateTrimLabel();
  });
  trimEndSlider.addEventListener("input", () => {
    trimEnd = Math.max(+trimEndSlider.value, +trimStartSlider.value + 1);
    trimEndSlider.value = trimEnd;
    updateTrimLabel();
  });

  updateRangeLenLabel();
  updateTrimLabel();
})();
