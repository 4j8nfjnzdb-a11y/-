// strips — digital noise converter
//
// Inspired by the idea behind Gerhard Richter's "Strip" works (repeatedly
// halving a scanned image vertically until it becomes thousands of thin
// strips, then reassembling them) — but not a reproduction of any specific
// piece. This is a general-purpose tool: load your own image or video,
// slice it into N vertical strips, and animate each strip independently
// (slide / tear / jitter / RGB channel split) to turn it into a moving
// digital-noise pattern.

(() => {
  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");

  const stripsSlider = document.getElementById("strips");
  const stripsValue = document.getElementById("stripsValue");
  const speedSlider = document.getElementById("speed");
  const intensitySlider = document.getElementById("intensity");

  const slideToggle = document.getElementById("slideToggle");
  const tearToggle = document.getElementById("tearToggle");
  const jitterToggle = document.getElementById("jitterToggle");
  const colorToggle = document.getElementById("colorToggle");

  const playBtn = document.getElementById("playBtn");
  const randomizeBtn = document.getElementById("randomizeBtn");
  const saveBtn = document.getElementById("saveBtn");
  const recordBtn = document.getElementById("recordBtn");
  const recHint = document.getElementById("recHint");

  const MAX_DIM = 1400;

  // offscreen source (current frame, at working resolution)
  const srcCanvas = document.createElement("canvas");
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: false });

  // per-channel tinted copies, used for the color-split effect
  const redCanvas = document.createElement("canvas");
  const greenCanvas = document.createElement("canvas");
  const blueCanvas = document.createElement("canvas");
  const redCtx = redCanvas.getContext("2d");
  const greenCtx = greenCanvas.getContext("2d");
  const blueCtx = blueCanvas.getContext("2d");

  let mediaEl = null; // <img> or <video>
  let isVideo = false;
  let sourceDrawn = false;
  let objectUrl = null;

  let playing = true;
  let rafId = null;
  let tearState = [];
  let seedOffset = Math.random() * 1000;

  let mediaRecorder = null;
  let recordedChunks = [];

  // ---- loading -----------------------------------------------------

  function resetTransport() {
    playing = true;
    playBtn.textContent = "一時停止";
  }

  function loadFile(file) {
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (mediaEl && isVideo) {
      mediaEl.pause();
      mediaEl.src = "";
    }
    sourceDrawn = false;
    updateChannelCanvases.done = false;
    objectUrl = URL.createObjectURL(file);

    if (file.type.startsWith("video/")) {
      isVideo = true;
      const video = document.createElement("video");
      video.src = objectUrl;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.addEventListener("loadedmetadata", () => {
        setupCanvasSize(video.videoWidth, video.videoHeight);
        mediaEl = video;
        video.play();
        dropZone.classList.add("hasMedia");
        resetTransport();
      });
    } else if (file.type.startsWith("image/")) {
      isVideo = false;
      const img = new Image();
      img.onload = () => {
        setupCanvasSize(img.naturalWidth, img.naturalHeight);
        mediaEl = img;
        dropZone.classList.add("hasMedia");
        resetTransport();
      };
      img.src = objectUrl;
    }
  }

  function setupCanvasSize(w, h) {
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    [srcCanvas, redCanvas, greenCanvas, blueCanvas, canvas].forEach((c) => {
      c.width = cw;
      c.height = ch;
    });
    initTearState();
  }

  // ---- strip state ---------------------------------------------------

  function getStripCount() {
    const exp = +stripsSlider.value;
    return Math.pow(2, exp);
  }

  function initTearState() {
    const n = getStripCount();
    tearState = new Array(n).fill(0).map(() => ({ offset: 0, holdUntil: 0 }));
  }

  stripsSlider.addEventListener("input", () => {
    const n = getStripCount();
    stripsValue.textContent = n >= 1000 ? `${(n / 1000).toFixed(1)}k本` : `${n}本`;
    initTearState();
  });
  stripsValue.textContent = `${getStripCount()}本`;

  // ---- channel canvases for color-split effect -----------------------

  function updateChannelCanvases() {
    [
      [redCtx, "#ff0000"],
      [greenCtx, "#00ff00"],
      [blueCtx, "#0000ff"],
    ].forEach(([c, color]) => {
      c.globalCompositeOperation = "source-over";
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
      c.drawImage(srcCanvas, 0, 0);
      c.globalCompositeOperation = "multiply";
      c.fillStyle = color;
      c.fillRect(0, 0, c.canvas.width, c.canvas.height);
      c.globalCompositeOperation = "source-over";
    });
  }

  function drawChannelStrip(sx, sw, dx, dw, spread) {
    const sh = srcCanvas.height;
    const h = canvas.height;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(redCanvas, sx, 0, sw, sh, dx - spread, 0, dw + 1, h);
    ctx.drawImage(greenCanvas, sx, 0, sw, sh, dx, 0, dw + 1, h);
    ctx.drawImage(blueCanvas, sx, 0, sw, sh, dx + spread, 0, dw + 1, h);
    ctx.restore();
  }

  // ---- render loop -----------------------------------------------------

  function renderFrame(timestamp) {
    rafId = requestAnimationFrame(renderFrame);
    if (!mediaEl || !playing) return;

    if (isVideo) {
      srcCtx.drawImage(mediaEl, 0, 0, srcCanvas.width, srcCanvas.height);
    } else if (!sourceDrawn) {
      srcCtx.drawImage(mediaEl, 0, 0, srcCanvas.width, srcCanvas.height);
      sourceDrawn = true;
    }

    const doColor = colorToggle.checked;
    if (doColor && (isVideo || !updateChannelCanvases.done)) {
      updateChannelCanvases();
      if (!isVideo) updateChannelCanvases.done = true;
    }

    const w = canvas.width;
    const h = canvas.height;
    const n = getStripCount();
    if (tearState.length !== n) initTearState();

    const stripW = w / n;
    const srcStripW = srcCanvas.width / n;
    const speed = +speedSlider.value / 100;
    const intensity = +intensitySlider.value / 100;
    const t = timestamp * 0.001 * (0.3 + speed * 2.2) + seedOffset;

    ctx.clearRect(0, 0, w, h);

    const doSlide = slideToggle.checked;
    const doTear = tearToggle.checked;
    const doJitter = jitterToggle.checked;

    for (let i = 0; i < n; i++) {
      const sx = i * srcStripW;
      const dxBase = i * stripW;
      let offset = 0;

      if (doSlide) {
        offset += Math.sin(t * 0.6 + i * 0.15) * stripW * 1.8 * intensity;
      }

      if (doTear) {
        const st = tearState[i];
        if (timestamp > st.holdUntil) {
          if (Math.random() < 0.015 + intensity * 0.05) {
            st.offset = (Math.random() - 0.5) * w * 0.5 * intensity;
            st.holdUntil = timestamp + 40 + Math.random() * 220;
          } else {
            st.offset *= 0.85;
            st.holdUntil = timestamp + 30;
          }
        }
        offset += st.offset;
      }

      if (doJitter) {
        offset += (Math.random() - 0.5) * 10 * intensity * (0.3 + speed);
      }

      const dx = dxBase + offset;

      if (doColor) {
        const spread = (2 + intensity * 14) * (0.5 + 0.5 * Math.sin(t * 0.8 + i * 0.3));
        drawChannelStrip(sx, srcStripW, dx, stripW, spread);
      } else {
        ctx.drawImage(srcCanvas, sx, 0, srcStripW, srcCanvas.height, dx, 0, stripW + 1, h);
      }
    }
  }
  rafId = requestAnimationFrame(renderFrame);

  // ---- input wiring ----------------------------------------------------

  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    });
  });
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "一時停止" : "再生";
    if (isVideo && mediaEl) {
      if (playing) mediaEl.play();
      else mediaEl.pause();
    }
  });

  randomizeBtn.addEventListener("click", () => {
    seedOffset = Math.random() * 1000;
    tearState.forEach((st) => {
      st.offset = 0;
      st.holdUntil = 0;
    });
  });

  saveBtn.addEventListener("click", () => {
    if (!mediaEl) return;
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `strips-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  });

  recordBtn.addEventListener("click", () => {
    if (!mediaEl) return;
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    if (typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
      recHint.textContent = "このブラウザは動画書き出しに対応していません。";
      return;
    }
    const stream = canvas.captureStream(30);
    const mimeCandidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `strips-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(a.href);
      recordBtn.textContent = "動画で書き出し";
      recordBtn.classList.remove("recording");
      recHint.textContent = "";
    };
    mediaRecorder.start();
    recordBtn.textContent = "停止して保存";
    recordBtn.classList.add("recording");
    recHint.textContent = "録画中… もう一度クリックで停止して保存します。";
  });

  // ---- presets -----------------------------------------------------

  const presets = {
    slide: () => {
      slideToggle.checked = true;
      tearToggle.checked = false;
      jitterToggle.checked = false;
      colorToggle.checked = false;
      speedSlider.value = 35;
      intensitySlider.value = 45;
    },
    tear: () => {
      slideToggle.checked = false;
      tearToggle.checked = true;
      jitterToggle.checked = false;
      colorToggle.checked = false;
      speedSlider.value = 55;
      intensitySlider.value = 55;
    },
    jitter: () => {
      slideToggle.checked = false;
      tearToggle.checked = false;
      jitterToggle.checked = true;
      colorToggle.checked = false;
      speedSlider.value = 75;
      intensitySlider.value = 50;
    },
    color: () => {
      slideToggle.checked = false;
      tearToggle.checked = false;
      jitterToggle.checked = false;
      colorToggle.checked = true;
      speedSlider.value = 40;
      intensitySlider.value = 60;
    },
    all: () => {
      slideToggle.checked = true;
      tearToggle.checked = true;
      jitterToggle.checked = true;
      colorToggle.checked = true;
      speedSlider.value = 50;
      intensitySlider.value = 45;
    },
  };

  document.querySelectorAll(".presetBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = presets[btn.dataset.preset];
      if (p) p();
      updateChannelCanvases.done = false;
    });
  });
})();
