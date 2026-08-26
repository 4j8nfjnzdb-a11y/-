// kirikizami — cut-up glitch collage
//
// Load up to three video/photo materials. On play, the app runs a
// cut-up sequencer: it constantly reassembles very short fragments of
// the sources — single frozen frames, brief scrubs of motion, and
// stutter-loops that scratch back and forth over a tiny window of a
// video — rather than lingering on one continuous clip. Photos get a
// random crop each cut; density/swerve tune how short and how erratic
// the cuts get. The composited canvas can be recorded and downloaded
// as a webm file.

(() => {
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const stageOverlay = document.getElementById("stageOverlay");

  const playBtn = document.getElementById("playBtn");
  const cutBtn = document.getElementById("cutBtn");
  const recBtn = document.getElementById("recBtn");
  const downloadLink = document.getElementById("downloadLink");

  const densityEl = document.getElementById("density");
  const swerveEl = document.getElementById("swerve");
  const zoomEl = document.getElementById("zoom");
  const glitchToggle = document.getElementById("glitchToggle");

  const loadHint = document.getElementById("loadHint");

  const SLOT_COUNT = 3;
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => ({
    index: i,
    type: null,
    el: null,
    url: null,
    name: null,
    duration: null,
    ready: false,
    thumbURL: null,
    viewFrom: null,
    viewTo: null,
    activeStart: 0,
    activeDuration: 1000,
    stutter: null,
  }));

  const slotDoms = Array.from({ length: SLOT_COUNT }, (_, i) => ({
    root: document.getElementById(`slot${i}`),
    input: document.getElementById(`slotInput${i}`),
    drop: document.getElementById(`slotDrop${i}`),
    thumb: document.getElementById(`slotThumb${i}`),
    label: document.getElementById(`slotLabel${i}`),
    clearBtn: document.getElementById(`slotClear${i}`),
  }));

  let running = false;
  let recording = false;
  let currentIndex = -1;
  let nextSwitchAt = 0;
  let sliceWindow = null; // { start, end, intensity }
  let recorder = null;
  let recordedChunks = [];
  let lastDownloadUrl = null;

  // ---- helpers ------------------------------------------------------

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => t * t * (3 - 2 * t);

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function readySlots() {
    return slots.filter((s) => s.ready);
  }

  function randomView(zoomAmt) {
    const scale = 1 + zoomAmt * (0.3 + Math.random() * 1.8);
    return { scale, cx: Math.random(), cy: Math.random() };
  }

  // maps a source's natural size + a normalized "view" (scale/cx/cy)
  // onto a source rect that covers the canvas aspect ratio
  function computeSourceRect(srcW, srcH, view) {
    const targetAspect = canvas.width / canvas.height;
    const srcAspect = srcW / srcH;
    let coverW, coverH;
    if (srcAspect > targetAspect) {
      coverH = srcH;
      coverW = srcH * targetAspect;
    } else {
      coverW = srcW;
      coverH = srcW / targetAspect;
    }
    const coverX0 = (srcW - coverW) / 2;
    const coverY0 = (srcH - coverH) / 2;
    const scale = Math.max(1, view.scale);
    const w = coverW / scale;
    const h = coverH / scale;
    const x = coverX0 + (coverW - w) * view.cx;
    const y = coverY0 + (coverH - h) * view.cy;
    return { x, y, w, h };
  }

  // ---- material loading ----------------------------------------------

  function loadFile(index, file) {
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      alert("動画か画像ファイルを選んでください");
      return;
    }

    const slot = slots[index];
    if (slot.url) URL.revokeObjectURL(slot.url);
    if (slot.el && slot.el.tagName === "VIDEO") {
      slot.el.pause();
      slot.el.src = "";
      slot.el.remove();
    }

    const url = URL.createObjectURL(file);
    let el;

    if (isVideo) {
      el = document.createElement("video");
      // set as literal attributes too — some WebKit/iOS versions only
      // honor playsinline/muted reliably as HTML attributes on elements
      // created via document.createElement
      el.setAttribute("muted", "");
      el.setAttribute("playsinline", "");
      el.setAttribute("webkit-playsinline", "");
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.preload = "auto";
      // kept attached (but invisible) rather than display:none — some
      // browsers throttle or stall decoding of detached/hidden video
      el.style.cssText = "position:fixed; left:0; top:0; width:2px; height:2px; opacity:0; pointer-events:none;";
      document.body.appendChild(el);
      el.src = url;
      el.load();
      // iOS Safari can ignore preload="auto" (e.g. on cellular data or
      // Low Power Mode) and simply never start buffering until play()
      // is actually called — so kick it immediately rather than
      // waiting for the user to press play, then pause right back
      const primeKick = el.play();
      if (primeKick && typeof primeKick.catch === "function") {
        primeKick.then(() => el.pause()).catch(() => {});
      }

      el.addEventListener("loadedmetadata", () => {
        slot.duration = el.duration;
      });
      // "ready" is decided by loadeddata (guaranteed once a frame is
      // decoded) rather than "seeked" — setting currentTime to a value
      // the video is already at may never fire seeked, which left the
      // slot stuck in "loading" forever with no error shown
      const readyTimeout = setTimeout(() => {
        if (!slot.ready) {
          alert(`「${file.name}」の読み込みに時間がかかりすぎています。この動画・この環境では再生できない可能性があります。`);
        }
      }, 8000);
      el.addEventListener("loadeddata", () => {
        clearTimeout(readyTimeout);
        slot.ready = true;
        makeThumb(slot);
        checkReadyState();
        if (el.duration && isFinite(el.duration) && el.duration > 0.3) {
          const onSeeked = () => {
            makeThumb(slot);
            el.removeEventListener("seeked", onSeeked);
          };
          el.addEventListener("seeked", onSeeked);
          el.currentTime = Math.min(0.15, el.duration / 2);
        }
      }, { once: true });
      el.addEventListener("error", () => {
        clearTimeout(readyTimeout);
        alert(`「${file.name}」を読み込めませんでした。対応していない形式の可能性があります。`);
        clearSlot(index);
      }, { once: true });
    } else {
      el = new Image();
      el.onload = () => {
        slot.ready = true;
        makeThumb(slot);
        checkReadyState();
      };
      el.onerror = () => {
        alert(`「${file.name}」を読み込めませんでした。対応していない形式の可能性があります。`);
        clearSlot(index);
      };
      el.src = url;
    }

    slot.type = isVideo ? "video" : "image";
    slot.el = el;
    slot.url = url;
    slot.name = file.name;
    slot.duration = null;
    slot.ready = false;
    slot.viewFrom = null;
    slot.viewTo = null;

    updateSlotUI(index);
    checkReadyState();
  }

  function clearSlot(index) {
    const slot = slots[index];
    if (slot.type === "video" && slot.el) {
      slot.el.pause();
      slot.el.src = "";
      slot.el.load();
      slot.el.remove();
    }
    if (slot.url) URL.revokeObjectURL(slot.url);
    Object.assign(slot, {
      type: null, el: null, url: null, name: null, duration: null,
      ready: false, thumbURL: null, viewFrom: null, viewTo: null,
    });
    updateSlotUI(index);
    checkReadyState();

    if (currentIndex === index && running) {
      const others = readySlots();
      if (others.length) {
        activateSlot(others[Math.floor(Math.random() * others.length)].index);
      } else {
        stopPlayback();
      }
    }
  }

  function makeThumb(slot) {
    const srcW = slot.type === "video" ? slot.el.videoWidth : slot.el.naturalWidth;
    const srcH = slot.type === "video" ? slot.el.videoHeight : slot.el.naturalHeight;
    if (!srcW || !srcH) return;
    const tCanvas = document.createElement("canvas");
    tCanvas.width = 160;
    tCanvas.height = 90;
    const tctx = tCanvas.getContext("2d");
    const r = computeSourceRect(srcW, srcH, { scale: 1, cx: 0.5, cy: 0.5 });
    tctx.drawImage(slot.el, r.x, r.y, r.w, r.h, 0, 0, 160, 90);
    slot.thumbURL = tCanvas.toDataURL("image/jpeg", 0.75);
    updateSlotUI(slot.index);
  }

  function updateSlotUI(index) {
    const slot = slots[index];
    const dom = slotDoms[index];
    if (slot.ready) {
      dom.thumb.style.backgroundImage = slot.thumbURL ? `url(${slot.thumbURL})` : "none";
      dom.label.innerHTML = `${escapeHtml(slot.name)}<br><em>${slot.type === "video" ? "動画" : "写真"}</em>`;
      dom.clearBtn.style.display = "flex";
      dom.drop.classList.add("loaded");
    } else {
      dom.thumb.style.backgroundImage = "none";
      dom.label.innerHTML = `素材 ${index + 1}<br><em>クリックまたはドロップ</em>`;
      dom.clearBtn.style.display = "none";
      dom.drop.classList.remove("loaded");
    }
  }

  function checkReadyState() {
    const anyReady = readySlots().length > 0;
    playBtn.disabled = !anyReady;
    cutBtn.disabled = !running;
    recBtn.disabled = !running;
    loadHint.textContent = anyReady
      ? "準備完了。再生を押すと切り刻みが始まります。"
      : "写真・動画をあわせて2〜3点、ドラッグ&ドロップか選択して読み込んでください。";
  }

  slotDoms.forEach((dom, i) => {
    dom.drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      dom.drop.classList.add("dragover");
    });
    dom.drop.addEventListener("dragleave", () => dom.drop.classList.remove("dragover"));
    dom.drop.addEventListener("drop", (e) => {
      e.preventDefault();
      dom.drop.classList.remove("dragover");
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFile(i, file);
    });
    dom.input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) loadFile(i, file);
      e.target.value = "";
    });
    dom.clearBtn.addEventListener("click", () => clearSlot(i));
  });

  // ---- scheduling / switching -----------------------------------------
  //
  // A cut-up sequencer, not a slideshow: every cut is short, and each
  // one is independently assigned a kind —
  //   flash:    a single frozen frame (video paused mid-seek, or a photo
  //             crop) — the bulk of the cuts, for a rapid-fire montage
  //   scrub:    the video actually plays forward for the cut's length
  //   stutter:  a tiny window of video (~50-200ms) that loops/scratches
  //             back and forth for the whole cut
  // "density" shortens the average cut; "swerve" both widens the
  // duration spread and shifts the kind mix toward stutter/flash chaos.

  function pickCutDuration(density, swerve) {
    const ceiling = 1.9 - density * 1.4; // 1.9s .. 0.5s
    const floor = 0.05 + swerve * 0.03;
    // squaring a uniform random skews short: frequent quick cuts,
    // occasional longer "breath" cuts
    return Math.max(0.05, floor + Math.random() * Math.random() * ceiling);
  }

  function activateSlot(index) {
    const slot = slots[index];
    if (!slot.ready) return;
    const now = performance.now();
    currentIndex = index;

    const density = +densityEl.value / 100;
    const swerve = +swerveEl.value / 100;
    const durSec = pickCutDuration(density, swerve);

    let kind = "flash";
    if (slot.type === "video" && slot.duration) {
      const roll = Math.random();
      const stutterProb = durSec > 0.25 ? 0.12 + swerve * 0.28 : 0;
      const scrubProb = 0.35 - swerve * 0.15;
      if (roll < stutterProb) kind = "stutter";
      else if (roll < stutterProb + scrubProb) kind = "scrub";
      else kind = "flash";
    }

    if (slot.type === "video" && slot.duration) {
      const minSeg = 0.15;
      const maxStart = Math.max(0, slot.duration - minSeg);
      const t0 = Math.random() * maxStart;
      slot.el.currentTime = t0;
      if (kind === "stutter") {
        const winLen = Math.min(0.05 + Math.random() * 0.15, Math.max(0.02, slot.duration - t0 - 0.01));
        slot.stutter = { start: t0, len: winLen };
        slot.el.play().catch(() => {});
      } else if (kind === "scrub") {
        slot.stutter = null;
        slot.el.play().catch(() => {});
      } else {
        slot.stutter = null;
        slot.el.pause();
      }
    } else {
      slot.stutter = null;
    }
    slots.forEach((s, i) => {
      if (i !== index && s.type === "video" && s.el) s.el.pause();
    });

    const zoomAmt = +zoomEl.value / 100;
    slot.viewFrom = randomView(zoomAmt);
    // short cuts have no time to visibly drift — only let the longer
    // "breath" cuts pan/zoom (Ken Burns)
    slot.viewTo = durSec > 0.6 ? randomView(zoomAmt) : slot.viewFrom;

    slot.activeStart = now;
    slot.activeDuration = durSec * 1000;
    nextSwitchAt = now + durSec * 1000;

    scheduleSliceGlitch(now, durSec * 1000, swerve);
  }

  function scheduleSliceGlitch(startNow, durMs, swerve) {
    sliceWindow = null;
    if (!glitchToggle.checked) return;
    if (Math.random() < 0.25 + swerve * 0.35) {
      const start = startNow + Math.random() * durMs * 0.7;
      const len = Math.min(durMs * 0.6, 50 + Math.random() * 130);
      sliceWindow = { start, end: start + len, intensity: 0.4 + Math.random() * 0.6 };
    }
  }

  function nextRandomIndex(excludeIndex) {
    const ready = readySlots().map((s) => s.index);
    if (!ready.length) return -1;
    const pool = ready.filter((i) => i !== excludeIndex);
    const candidates = pool.length ? pool : ready;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // ---- rendering --------------------------------------------------------

  function drawSlot(slot, now) {
    if (!slot || !slot.ready) return;
    const el = slot.el;
    const srcW = slot.type === "video" ? el.videoWidth : el.naturalWidth;
    const srcH = slot.type === "video" ? el.videoHeight : el.naturalHeight;
    if (!srcW || !srcH) return;

    const viewFrom = slot.viewFrom || { scale: 1, cx: 0.5, cy: 0.5 };
    const viewTo = slot.viewTo || viewFrom;
    const t = clamp((now - slot.activeStart) / (slot.activeDuration || 1), 0, 1);
    const eased = smoothstep(t);
    const view = {
      scale: lerp(viewFrom.scale, viewTo.scale, eased),
      cx: lerp(viewFrom.cx, viewTo.cx, eased),
      cy: lerp(viewFrom.cy, viewTo.cy, eased),
    };
    const r = computeSourceRect(srcW, srcH, view);
    ctx.drawImage(el, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  }

  function applySliceGlitch(intensity) {
    const bands = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bands; i++) {
      const bandH = Math.max(2, Math.round(6 + Math.random() * 46));
      const y = Math.floor(Math.random() * Math.max(1, canvas.height - bandH));
      const offset = Math.round((Math.random() * 2 - 1) * 44 * intensity);
      try {
        const imgData = ctx.getImageData(0, y, canvas.width, bandH);
        ctx.putImageData(imgData, offset, y);
      } catch (e) {
        // ignore
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;

    if (now >= nextSwitchAt) {
      const next = nextRandomIndex(currentIndex);
      if (next >= 0) activateSlot(next);
    }

    const active = currentIndex >= 0 ? slots[currentIndex] : null;
    if (active && active.stutter && active.type === "video" && active.el) {
      const { start, len } = active.stutter;
      if (active.el.currentTime >= start + len || active.el.currentTime < start) {
        active.el.currentTime = start;
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (active) drawSlot(active, now);

    if (sliceWindow && now >= sliceWindow.start && now <= sliceWindow.end) {
      applySliceGlitch(sliceWindow.intensity);
    }
  }
  requestAnimationFrame(frame);

  // ---- transport ----------------------------------------------------

  function startPlayback() {
    const ready = readySlots();
    if (!ready.length) return;
    running = true;
    playBtn.textContent = "停止";
    playBtn.classList.add("playing");
    stageOverlay.classList.add("hidden");
    checkReadyState();
    activateSlot(ready[Math.floor(Math.random() * ready.length)].index);
  }

  function stopPlayback() {
    running = false;
    playBtn.textContent = "再生";
    playBtn.classList.remove("playing");
    stageOverlay.classList.remove("hidden");
    slots.forEach((s) => { if (s.type === "video" && s.el) s.el.pause(); });
    if (recording) stopRecording();
    checkReadyState();
  }

  playBtn.addEventListener("click", () => {
    if (running) stopPlayback(); else startPlayback();
  });

  cutBtn.addEventListener("click", () => {
    if (!running) return;
    const next = nextRandomIndex(currentIndex);
    if (next >= 0) activateSlot(next);
  });

  // ---- recording ----------------------------------------------------

  function startRecording() {
    if (!running) return;
    let stream;
    try {
      stream = canvas.captureStream(30);
    } catch (e) {
      alert("この環境では録画に対応していません");
      return;
    }
    let mime = "video/webm;codecs=vp9";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm;codecs=vp8";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm";

    recordedChunks = [];
    downloadLink.style.display = "none";
    if (lastDownloadUrl) {
      URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = null;
    }

    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    } catch (e) {
      alert("録画を開始できませんでした");
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mime });
      const url = URL.createObjectURL(blob);
      lastDownloadUrl = url;
      downloadLink.href = url;
      downloadLink.download = `kirikizami-${Date.now()}.webm`;
      downloadLink.style.display = "inline-flex";
    };
    recorder.start();
    recording = true;
    recBtn.textContent = "録画停止";
    recBtn.classList.add("recording");
  }

  function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recording = false;
    recBtn.textContent = "録画開始";
    recBtn.classList.remove("recording");
  }

  recBtn.addEventListener("click", () => {
    if (!running) return;
    if (recording) stopRecording(); else startRecording();
  });

  checkReadyState();
})();
