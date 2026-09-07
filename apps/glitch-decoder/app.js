// GLITCH DECODER — video corruption toy
//
// Pipeline per frame:
//   1. pull a fresh frame into an offscreen "frame buffer" (skipped while
//      frozen, which is what makes the base image hold still while the
//      corruption layered on top keeps moving)
//   2. blit the buffer onto the visible canvas
//   3. layer chaos-scaled effects on top, each gated by its own toggle
// Everything is driven by one 0-100 "chaos" value; at 0 the output is a
// clean passthrough, at 100 every effect fires large and often.

(() => {
  const canvas = document.getElementById("canvas");
  const mainCtx = canvas.getContext("2d");
  const video = document.getElementById("sourceVideo");
  const dropZone = document.getElementById("dropZone");
  const placeholder = document.getElementById("placeholder");
  const fileInput = document.getElementById("fileInput");
  const sampleBtn = document.getElementById("sampleBtn");
  const loadBtn = document.getElementById("loadBtn");
  const muteBtn = document.getElementById("muteBtn");
  const resetBtn = document.getElementById("resetBtn");
  const playPauseBtn = document.getElementById("playPauseBtn");
  const recordBtn = document.getElementById("recordBtn");
  const downloadLink = document.getElementById("downloadLink");
  const chaosSlider = document.getElementById("chaos");
  const chaosValueLabel = document.getElementById("chaosValueLabel");

  const fx = {
    block: document.getElementById("fxBlock"),
    channel: document.getElementById("fxChannel"),
    scan: document.getElementById("fxScan"),
    freeze: document.getElementById("fxFreeze"),
    sort: document.getElementById("fxSort"),
    noise: document.getElementById("fxNoise"),
  };

  // offscreen working canvases
  const fb = document.createElement("canvas");
  const fbCtx = fb.getContext("2d");
  const tintRed = document.createElement("canvas");
  const tintRedCtx = tintRed.getContext("2d");
  const tintCyan = document.createElement("canvas");
  const tintCyanCtx = tintCyan.getContext("2d");

  let w = 640, h = 360;
  let mode = null; // "video" | "sample"
  let hasSource = false;
  let playing = false;
  let objectUrl = null;
  let sampleTime = 0;
  let lastTs = 0;
  let freezeCountdown = 0;
  let channelDrift = 0;
  let channelDriftTarget = 0;
  let sortFrameCounter = 0;
  let recorder = null;
  let recording = false;
  let recordedChunks = [];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));

  function setWorkSize(nw, nh) {
    const maxW = 900;
    let W = nw, H = nh;
    if (W > maxW) {
      H = Math.round((H * maxW) / W);
      W = maxW;
    }
    w = W;
    h = H;
    canvas.width = w;
    canvas.height = h;
    fb.width = w;
    fb.height = h;
    tintRed.width = w;
    tintRed.height = h;
    tintCyan.width = w;
    tintCyan.height = h;
  }
  setWorkSize(640, 360);

  // ---- sources ---------------------------------------------------

  function loadVideoFile(file) {
    mode = "video";
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.onloadedmetadata = () => {
      setWorkSize(video.videoWidth || 640, video.videoHeight || 360);
      hasSource = true;
      placeholder.style.display = "none";
      playPauseBtn.disabled = false;
      recordBtn.disabled = false;
      muteBtn.disabled = false;
      video.play();
      playing = true;
      updatePlayButton();
    };
  }

  function useSample() {
    mode = "sample";
    sampleTime = 0;
    setWorkSize(640, 360);
    hasSource = true;
    playing = true;
    placeholder.style.display = "none";
    playPauseBtn.disabled = false;
    recordBtn.disabled = false;
    updatePlayButton();
  }

  function drawSamplePattern(ctx, t) {
    const hue = (t * 15) % 360;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${hue}, 50%, 18%)`);
    grad.addColorStop(1, `hsl(${(hue + 80) % 360}, 50%, 10%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const cell = 40;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#fff";
    for (let y = -cell; y < h + cell; y += cell) {
      for (let x = -cell; x < w + cell; x += cell) {
        const ox = (x + t * 20) % (cell * 2);
        if ((Math.floor(ox / cell) + Math.floor(y / cell)) % 2 === 0) {
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
    ctx.restore();

    const bx = w / 2 + Math.sin(t * 0.9) * w * 0.32;
    const by = h / 2 + Math.cos(t * 1.3) * h * 0.28;
    ctx.beginPath();
    ctx.fillStyle = "#ffe62e";
    ctx.arc(bx, by, Math.min(w, h) * 0.06, 0, Math.PI * 2);
    ctx.fill();

    const secs = Math.floor(t);
    const mm = String(Math.floor(secs / 60));
    const ss = String(secs % 60).padStart(2, "0");
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(10, 10, 90, 34);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(`${mm}:${ss}`, 18, 27);

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "12px monospace";
    ctx.fillText("SAMPLE FEED", w - 140, h - 16);
  }

  function pullFrameIntoBuffer() {
    if (mode === "video") {
      if (video.readyState >= 2) fbCtx.drawImage(video, 0, 0, w, h);
    } else if (mode === "sample") {
      drawSamplePattern(fbCtx, sampleTime);
    }
  }

  // ---- glitch effects ---------------------------------------------

  function applyChannelShift(chaosNorm) {
    if (Math.random() < 0.05) channelDriftTarget = Math.random() * 2 - 1;
    channelDrift += (channelDriftTarget - channelDrift) * 0.2;
    const offset = Math.round(channelDrift * chaosNorm * 30);
    if (offset === 0) return;

    // isolate a channel with no per-pixel loop: multiplying by a pure
    // primary zeroes the other two channels (src * 255/255 vs src * 0)
    tintRedCtx.clearRect(0, 0, w, h);
    tintRedCtx.drawImage(canvas, 0, 0, w, h);
    tintRedCtx.globalCompositeOperation = "multiply";
    tintRedCtx.fillStyle = "#ff0000";
    tintRedCtx.fillRect(0, 0, w, h);
    tintRedCtx.globalCompositeOperation = "source-over";

    tintCyanCtx.clearRect(0, 0, w, h);
    tintCyanCtx.drawImage(canvas, 0, 0, w, h);
    tintCyanCtx.globalCompositeOperation = "multiply";
    tintCyanCtx.fillStyle = "#00ffff";
    tintCyanCtx.fillRect(0, 0, w, h);
    tintCyanCtx.globalCompositeOperation = "source-over";

    mainCtx.globalCompositeOperation = "screen";
    mainCtx.drawImage(tintRed, offset, 0);
    mainCtx.drawImage(tintCyan, -offset, 0);
    mainCtx.globalCompositeOperation = "source-over";
  }

  function applyBlockTear(chaosNorm) {
    if (Math.random() > 0.25 + 0.65 * chaosNorm) return;
    const count = 1 + Math.floor(Math.random() * (1 + chaosNorm * 14));
    for (let i = 0; i < count; i++) {
      const bw = Math.min(w, Math.round(8 + chaosNorm * 10 + Math.random() * (20 + chaosNorm * 140)));
      const bh = Math.min(h, Math.round(8 + chaosNorm * 8 + Math.random() * (14 + chaosNorm * 90)));
      const sx = Math.random() * (w - bw);
      const sy = Math.random() * (h - bh);
      const dx = clamp(sx + (Math.random() * 2 - 1) * chaosNorm * 90, 0, w - bw);
      const dy = clamp(sy + (Math.random() * 2 - 1) * chaosNorm * 40, 0, h - bh);
      mainCtx.drawImage(canvas, sx, sy, bw, bh, dx, dy, bw, bh);
    }
  }

  function applyScanlineTear(chaosNorm) {
    if (Math.random() > 0.2 + 0.6 * chaosNorm) return;
    const lines = 1 + Math.floor(chaosNorm * 7);
    for (let i = 0; i < lines; i++) {
      const bh = Math.min(h, Math.round(2 + Math.random() * (2 + chaosNorm * 14)));
      const sy = Math.random() * (h - bh);
      const shift = Math.round((Math.random() * 2 - 1) * (20 + chaosNorm * 220));
      mainCtx.drawImage(canvas, 0, sy, w, bh, shift, sy, w, bh);
    }
  }

  const NOISE_PALETTE = ["#ff2e88", "#2ee6d6", "#ffffff", "#000000", "#ffe62e"];
  function applyNoiseBlocks(chaosNorm) {
    if (Math.random() > 0.3 + 0.5 * chaosNorm) return;
    const count = Math.floor(chaosNorm * 6);
    for (let i = 0; i < count; i++) {
      const bw = Math.round(6 + Math.random() * (10 + chaosNorm * 60));
      const bh = Math.round(4 + Math.random() * (6 + chaosNorm * 30));
      const x = Math.random() * Math.max(1, w - bw);
      const y = Math.random() * Math.max(1, h - bh);
      mainCtx.globalAlpha = 0.35 + Math.random() * 0.5;
      mainCtx.globalCompositeOperation = Math.random() < 0.5 ? "difference" : "source-over";
      mainCtx.fillStyle = NOISE_PALETTE[Math.floor(Math.random() * NOISE_PALETTE.length)];
      mainCtx.fillRect(x, y, bw, bh);
    }
    mainCtx.globalAlpha = 1;
    mainCtx.globalCompositeOperation = "source-over";
  }

  function applyPixelSort(chaosNorm) {
    sortFrameCounter++;
    const every = Math.max(1, 4 - Math.floor(chaosNorm * 3));
    if (sortFrameCounter % every !== 0) return;

    const stripH = Math.max(6, Math.min(h, Math.round(16 + chaosNorm * 90)));
    const y0 = Math.floor(Math.random() * Math.max(1, h - stripH));
    let imgData;
    try {
      imgData = mainCtx.getImageData(0, y0, w, stripH);
    } catch (e) {
      return;
    }
    const data = imgData.data;
    const threshold = 60;

    for (let row = 0; row < stripH; row++) {
      const rowStart = row * w * 4;
      let x = 0;
      while (x < w) {
        const idx = rowStart + x * 4;
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (brightness > threshold) {
          let xEnd = x;
          while (xEnd < w) {
            const idx2 = rowStart + xEnd * 4;
            const b2 = (data[idx2] + data[idx2 + 1] + data[idx2 + 2]) / 3;
            if (b2 <= threshold) break;
            xEnd++;
          }
          const runLen = xEnd - x;
          if (runLen > 1) {
            const pixels = [];
            for (let k = 0; k < runLen; k++) {
              const idx3 = rowStart + (x + k) * 4;
              pixels.push([data[idx3], data[idx3 + 1], data[idx3 + 2], data[idx3 + 3]]);
            }
            pixels.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
            for (let k = 0; k < runLen; k++) {
              const idx3 = rowStart + (x + k) * 4;
              data[idx3] = pixels[k][0];
              data[idx3 + 1] = pixels[k][1];
              data[idx3 + 2] = pixels[k][2];
              data[idx3 + 3] = pixels[k][3];
            }
          }
          x = xEnd;
        } else {
          x++;
        }
      }
    }
    mainCtx.putImageData(imgData, 0, y0);
  }

  // ---- main loop ---------------------------------------------------

  function tick(now) {
    requestAnimationFrame(tick);
    const dt = lastTs ? Math.min(0.1, (now - lastTs) / 1000) : 0;
    lastTs = now;
    if (!hasSource) return;

    if (mode === "sample" && playing) sampleTime += dt;

    const chaosNorm = +chaosSlider.value / 100;

    if (fx.freeze.checked) {
      if (freezeCountdown > 0) {
        freezeCountdown--;
      } else {
        if (playing) pullFrameIntoBuffer();
        if (chaosNorm > 0 && Math.random() < chaosNorm * chaosNorm * 0.06) {
          freezeCountdown = randInt(2, 3 + Math.floor(chaosNorm * 40));
        }
      }
    } else if (playing) {
      pullFrameIntoBuffer();
    }

    mainCtx.clearRect(0, 0, w, h);
    mainCtx.drawImage(fb, 0, 0, w, h);

    if (chaosNorm > 0) {
      if (fx.channel.checked) applyChannelShift(chaosNorm);
      if (fx.block.checked) applyBlockTear(chaosNorm);
      if (fx.scan.checked) applyScanlineTear(chaosNorm);
      if (fx.noise.checked) applyNoiseBlocks(chaosNorm);
      if (fx.sort.checked) applyPixelSort(chaosNorm);
    }
  }
  requestAnimationFrame(tick);

  // ---- transport ----------------------------------------------------

  function updatePlayButton() {
    playPauseBtn.textContent = playing ? "一時停止" : "再生";
    playPauseBtn.classList.toggle("primary", playing);
  }

  function togglePlay() {
    if (!hasSource) return;
    if (mode === "video") {
      if (video.paused) {
        video.play();
        playing = true;
      } else {
        video.pause();
        playing = false;
      }
    } else {
      playing = !playing;
    }
    updatePlayButton();
  }

  playPauseBtn.addEventListener("click", togglePlay);

  muteBtn.addEventListener("click", () => {
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? "🔇 音声" : "🔊 音声";
  });

  resetBtn.addEventListener("click", () => {
    chaosSlider.value = 0;
    chaosValueLabel.textContent = "0";
    freezeCountdown = 0;
    channelDrift = 0;
    channelDriftTarget = 0;
  });

  chaosSlider.addEventListener("input", () => {
    chaosValueLabel.textContent = chaosSlider.value;
  });

  loadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) loadVideoFile(f);
  });

  sampleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    useSample();
  });

  dropZone.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    if (!hasSource) fileInput.click();
    else togglePlay();
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragOver");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragOver");
    })
  );
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) loadVideoFile(file);
  });

  // ---- record / export ----------------------------------------------

  function pickMimeType() {
    const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return candidates.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  }

  function startRecording() {
    const stream = canvas.captureStream(30);
    const mime = pickMimeType();
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recordedChunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) recordedChunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = `glitch-${Date.now()}.webm`;
      downloadLink.style.display = "inline-flex";
      downloadLink.textContent = "ダウンロード";
    };
    recorder.start();
    recording = true;
    recordBtn.textContent = "■ 録画停止";
    recordBtn.classList.add("recording");
  }

  function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recording = false;
    recordBtn.textContent = "● 録画開始";
    recordBtn.classList.remove("recording");
  }

  recordBtn.addEventListener("click", () => {
    if (!recording) startRecording();
    else stopRecording();
  });
})();
