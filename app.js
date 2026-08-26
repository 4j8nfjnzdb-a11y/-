// glitch cam — camera video that randomly, periodically corrupts itself,
// with an audio glitch fired at the exact same moment so the two always
// read as one broken event rather than two coincidental ones.

(() => {
  const video = document.getElementById("camera");
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const placeholder = document.getElementById("placeholder");
  const statusEl = document.getElementById("status");

  const startBtn = document.getElementById("startBtn");
  const switchBtn = document.getElementById("switchBtn");
  const recordBtn = document.getElementById("recordBtn");
  const freqSlider = document.getElementById("frequency");
  const intensitySlider = document.getElementById("intensity");
  const monitorCheckbox = document.getElementById("monitorAudio");
  const downloadLink = document.getElementById("downloadLink");

  const MAX_DIM = 640; // internal processing resolution cap, for perf

  let stream = null;
  let facingMode = "environment";
  let running = false;
  let rafId = null;
  let glitchTimer = null;

  let audioCtx = null;
  let micSource, dryGain, wetGain, gateGain, ringModGain, ringOsc,
      waveshaper, bandpass, sumBus, monitorGain, destNode, noiseBuffer;

  let mediaRecorder = null;
  let recordedChunks = [];

  // ---- glitch state -------------------------------------------------

  let glitchActive = false;
  let glitchEndAt = 0;
  let activeEffects = [];
  let skipVideoDraw = false;
  let scratch = document.createElement("canvas");
  let scratchCtx = scratch.getContext("2d");

  const EFFECT_POOL = ["slice", "block", "rgb", "pixelate", "invert", "jitter", "freeze"];

  function pickEffects(intensity) {
    const count = 1 + Math.floor(Math.random() * (1 + intensity * 3));
    const pool = EFFECT_POOL.slice();
    const chosen = [];
    for (let i = 0; i < count && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      chosen.push(pool.splice(idx, 1)[0]);
    }
    return chosen;
  }

  // ---- visual effects (operate directly on ctx / canvas) -----------

  function fxSlice(w, h, intensity) {
    const bands = 2 + Math.floor(Math.random() * 5 * (0.4 + intensity));
    for (let i = 0; i < bands; i++) {
      const bandH = 4 + Math.random() * (h * 0.12);
      const y = Math.random() * (h - bandH);
      const dx = (Math.random() * 2 - 1) * w * 0.25 * (0.3 + intensity);
      ctx.drawImage(canvas, 0, y, w, bandH, dx, y, w, bandH);
    }
  }

  function fxBlock(w, h, intensity) {
    const blocks = 2 + Math.floor(Math.random() * 8 * (0.4 + intensity));
    for (let i = 0; i < blocks; i++) {
      const bw = 10 + Math.random() * w * 0.3;
      const bh = 6 + Math.random() * h * 0.12;
      const x = Math.random() * (w - bw);
      const y = Math.random() * (h - bh);
      if (Math.random() < 0.5) {
        ctx.globalCompositeOperation = Math.random() < 0.5 ? "difference" : "exclusion";
        ctx.fillStyle = `hsl(${Math.random() * 360}, 90%, 55%)`;
        ctx.fillRect(x, y, bw, bh);
        ctx.globalCompositeOperation = "source-over";
      } else {
        const sx = Math.random() * (w - bw);
        const sy = Math.random() * (h - bh);
        ctx.drawImage(canvas, sx, sy, bw, bh, x, y, bw, bh);
      }
    }
  }

  function fxRgb(w, h, intensity) {
    const dx = Math.round(2 + Math.random() * 18 * intensity);
    let frame;
    try {
      frame = ctx.getImageData(0, 0, w, h);
    } catch (e) {
      return; // canvas tainted or unavailable this frame; skip
    }
    const src = frame.data;
    const out = ctx.createImageData(w, h);
    const dst = out.data;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        const i = row + x * 4;
        const xr = Math.min(w - 1, Math.max(0, x + dx));
        const xb = Math.min(w - 1, Math.max(0, x - dx));
        const ir = row + xr * 4;
        const ib = row + xb * 4;
        dst[i] = src[ir];         // R shifted
        dst[i + 1] = src[i + 1];  // G stays
        dst[i + 2] = src[ib + 2]; // B shifted opposite
        dst[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  function fxPixelate(w, h, intensity) {
    const bw = 40 + Math.random() * w * 0.4;
    const bh = 30 + Math.random() * h * 0.3;
    const x = Math.random() * (w - bw);
    const y = Math.random() * (h - bh);
    const factor = Math.max(2, Math.round(16 * (0.3 + intensity)));
    const sw = Math.max(1, Math.round(bw / factor));
    const sh = Math.max(1, Math.round(bh / factor));
    scratch.width = sw;
    scratch.height = sh;
    scratchCtx.drawImage(canvas, x, y, bw, bh, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, sw, sh, x, y, bw, bh);
    ctx.imageSmoothingEnabled = true;
  }

  function fxInvert() {
    // handled at draw time via ctx.filter, see currentFilter
  }

  function fxJitter() {
    // handled at draw time via drawOffset, see below
  }

  let drawOffsetX = 0, drawOffsetY = 0;
  let currentFilter = "none";

  function applyEffects(w, h, intensity) {
    activeEffects.forEach((name) => {
      if (name === "slice") fxSlice(w, h, intensity);
      else if (name === "block") fxBlock(w, h, intensity);
      else if (name === "rgb" && Math.random() < 0.7) fxRgb(w, h, intensity);
      else if (name === "pixelate") fxPixelate(w, h, intensity);
    });
  }

  // ---- render loop ----------------------------------------------------

  function resizeStage() {
    const vw = video.videoWidth || 4;
    const vh = video.videoHeight || 3;
    const scale = Math.min(1, MAX_DIM / Math.max(vw, vh));
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
  }

  function renderLoop() {
    if (!running) return;
    const w = canvas.width, h = canvas.height;

    if (glitchActive && performance.now() > glitchEndAt) {
      glitchActive = false;
      skipVideoDraw = false;
      drawOffsetX = 0;
      drawOffsetY = 0;
      currentFilter = "none";
    }

    if (!skipVideoDraw) {
      ctx.filter = currentFilter;
      ctx.drawImage(video, drawOffsetX, drawOffsetY, w, h);
      ctx.filter = "none";
    }

    if (glitchActive) {
      const intensity = +intensitySlider.value / 100;
      applyEffects(w, h, intensity);
    }

    rafId = requestAnimationFrame(renderLoop);
  }

  // ---- glitch trigger: fires the visual + audio break together -----

  function triggerGlitch() {
    if (!running) return;
    const intensity = +intensitySlider.value / 100;
    const durationMs = 70 + Math.random() * 380 * (0.4 + intensity);

    activeEffects = pickEffects(intensity);
    glitchActive = true;
    glitchEndAt = performance.now() + durationMs;

    skipVideoDraw = activeEffects.includes("freeze") && Math.random() < 0.7;
    drawOffsetX = activeEffects.includes("jitter") ? (Math.random() * 2 - 1) * 24 * (0.3 + intensity) : 0;
    drawOffsetY = activeEffects.includes("jitter") ? (Math.random() * 2 - 1) * 14 * (0.3 + intensity) : 0;
    currentFilter = activeEffects.includes("invert")
      ? `invert(1) hue-rotate(${Math.round(Math.random() * 360)}deg) saturate(3)`
      : "none";

    triggerAudioGlitch(durationMs / 1000, intensity);
  }

  function scheduleNextGlitch() {
    const freq = +freqSlider.value; // glitches per minute
    const meanGapMs = 60000 / Math.max(1, freq);
    const gap = meanGapMs * (0.35 + Math.random() * 1.3);
    glitchTimer = setTimeout(() => {
      if (running) {
        triggerGlitch();
        scheduleNextGlitch();
      }
    }, gap);
  }

  // ---- audio graph -----------------------------------------------------

  function buildNoiseBuffer(ctxA) {
    const dur = 1.0;
    const rate = ctxA.sampleRate;
    const len = Math.floor(dur * rate);
    const buf = ctxA.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeBitcrushCurve(steps) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  }

  function setupAudioGraph() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    micSource = audioCtx.createMediaStreamSource(stream);

    dryGain = audioCtx.createGain();
    dryGain.gain.value = 1;

    gateGain = audioCtx.createGain();
    gateGain.gain.value = 1;

    ringModGain = audioCtx.createGain();
    ringModGain.gain.value = 0;
    ringOsc = audioCtx.createOscillator();
    ringOsc.type = "square";
    ringOsc.frequency.value = 90;
    ringOsc.connect(ringModGain.gain);
    ringOsc.start();

    waveshaper = audioCtx.createWaveShaper();
    waveshaper.curve = makeBitcrushCurve(8);
    waveshaper.oversample = "none";

    bandpass = audioCtx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 1200;
    bandpass.Q.value = 8;

    wetGain = audioCtx.createGain();
    wetGain.gain.value = 0;

    micSource.connect(dryGain);
    micSource.connect(gateGain);
    gateGain.connect(ringModGain);
    ringModGain.connect(waveshaper);
    waveshaper.connect(bandpass);
    bandpass.connect(wetGain);

    sumBus = audioCtx.createGain();
    sumBus.gain.value = 1;
    dryGain.connect(sumBus);
    wetGain.connect(sumBus);

    destNode = audioCtx.createMediaStreamDestination();
    sumBus.connect(destNode);

    monitorGain = audioCtx.createGain();
    monitorGain.gain.value = monitorCheckbox.checked ? 1 : 0;
    sumBus.connect(monitorGain).connect(audioCtx.destination);

    noiseBuffer = buildNoiseBuffer(audioCtx);
  }

  function playNoiseBurst(startTime, dur, intensity) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.loopEnd = Math.min(0.4, noiseBuffer.duration);
    const g = audioCtx.createGain();
    const peak = 0.22 + intensity * 0.35;
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(peak, startTime + 0.006);
    g.gain.setValueAtTime(peak, Math.max(startTime + 0.006, startTime + dur * 0.7));
    g.gain.linearRampToValueAtTime(0, startTime + dur);
    src.connect(g).connect(sumBus);
    src.start(startTime);
    src.stop(startTime + dur + 0.05);
  }

  function triggerAudioGlitch(durationSec, intensity) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const wetTarget = 0.5 + intensity * 0.5;
    const dryTarget = Math.max(0.15, 1 - intensity * 0.7);

    dryGain.gain.cancelScheduledValues(now);
    dryGain.gain.setValueAtTime(dryGain.gain.value, now);
    dryGain.gain.linearRampToValueAtTime(dryTarget, now + 0.01);

    wetGain.gain.cancelScheduledValues(now);
    wetGain.gain.setValueAtTime(wetGain.gain.value, now);
    wetGain.gain.linearRampToValueAtTime(wetTarget, now + 0.01);

    bandpass.frequency.setValueAtTime(200 + Math.random() * 3500, now);
    bandpass.Q.setValueAtTime(4 + Math.random() * 16, now);
    ringOsc.frequency.setValueAtTime(40 + Math.random() * 400, now);

    gateGain.gain.cancelScheduledValues(now);
    let t = now;
    while (t < now + durationSec) {
      const roll = Math.random();
      const level = roll < 0.3 ? 0 : roll < 0.55 ? 0.2 + Math.random() * 0.4 : 1;
      gateGain.gain.setValueAtTime(level, t);
      t += 0.02 + Math.random() * 0.05;
    }
    gateGain.gain.setValueAtTime(1, now + durationSec);

    if (Math.random() < 0.45 + intensity * 0.4) {
      playNoiseBurst(now, Math.min(durationSec, 0.15 + Math.random() * 0.3), intensity);
    }

    dryGain.gain.setValueAtTime(dryTarget, now + durationSec);
    dryGain.gain.linearRampToValueAtTime(1, now + durationSec + 0.08);
    wetGain.gain.setValueAtTime(wetTarget, now + durationSec);
    wetGain.gain.linearRampToValueAtTime(0, now + durationSec + 0.08);
  }

  monitorCheckbox.addEventListener("change", () => {
    if (monitorGain) monitorGain.gain.value = monitorCheckbox.checked ? 1 : 0;
  });

  // ---- camera lifecycle ------------------------------------------------

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  async function startCamera() {
    try {
      setStatus("カメラとマイクへのアクセスを要求中…");
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: true,
      });
    } catch (err) {
      setStatus(`カメラ/マイクを開始できませんでした（${err.name}）`);
      return;
    }

    video.srcObject = stream;
    await video.play();
    resizeStage();
    setupAudioGraph();

    placeholder.hidden = true;
    running = true;
    setStatus("グリッチ待機中…");

    startBtn.textContent = "カメラを停止";
    startBtn.classList.add("active");
    switchBtn.disabled = false;
    recordBtn.disabled = false;

    rafId = requestAnimationFrame(renderLoop);
    scheduleNextGlitch();
  }

  function stopCamera() {
    running = false;
    cancelAnimationFrame(rafId);
    clearTimeout(glitchTimer);
    glitchActive = false;
    skipVideoDraw = false;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }

    video.srcObject = null;
    placeholder.hidden = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    startBtn.textContent = "カメラを開始";
    startBtn.classList.remove("active");
    switchBtn.disabled = true;
    recordBtn.disabled = true;
    recordBtn.textContent = "録画開始";
    recordBtn.classList.remove("recording");
    setStatus("");
  }

  startBtn.addEventListener("click", () => {
    if (running) stopCamera();
    else startCamera();
  });

  switchBtn.addEventListener("click", async () => {
    facingMode = facingMode === "environment" ? "user" : "environment";
    const wasRecording = mediaRecorder && mediaRecorder.state === "recording";
    stopCamera();
    await startCamera();
    if (wasRecording) setStatus("カメラ切替のため録画は停止しました");
  });

  // ---- recording ---------------------------------------------------

  recordBtn.addEventListener("click", () => {
    if (!running) return;
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      const videoStream = canvas.captureStream(30);
      const combined = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...destNode.stream.getAudioTracks(),
      ]);
      let mime = "video/webm;codecs=vp9,opus";
      if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm";
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(combined, { mimeType: mime });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        downloadLink.href = url;
        downloadLink.download = `glitch-cam-${Date.now()}.webm`;
        downloadLink.hidden = false;
        downloadLink.textContent = "書き出した動画をダウンロード";
      };
      mediaRecorder.start();
      recordBtn.textContent = "録画停止";
      recordBtn.classList.add("recording");
    } else {
      mediaRecorder.stop();
      recordBtn.textContent = "録画開始";
      recordBtn.classList.remove("recording");
    }
  });

  window.addEventListener("beforeunload", () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  });
})();
