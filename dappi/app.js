// dappi (脱皮) — generative single-image molt engine
//
// One source image or video, continuously reprocessed by eight
// independent "effect organs" (pixel stretch, scan drift, halftone,
// posterize, invert flash, mirror, RGB shift, grain), each fading in
// and out on its own asynchronous clock so the look never settles.
// On top of that, the engine periodically clips a small region out of
// the current composited frame and releases it as a floating "shed" —
// a little clone that drifts, spins, grows and dissolves on its own,
// as if the base image kept molting pieces of itself.

(() => {
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const work = document.createElement("canvas");
  const workCtx = work.getContext("2d");

  const dock = document.getElementById("dock");
  const collapseBtn = document.getElementById("collapseBtn");
  const addBtn = document.getElementById("addBtn");
  const fileInput = document.getElementById("fileInput");
  const thumbsEl = document.getElementById("thumbs");
  const playBtn = document.getElementById("playBtn");
  const recutBtn = document.getElementById("recutBtn");
  const recBtn = document.getElementById("recBtn");
  const seedVal = document.getElementById("seedVal");
  const reseedBtn = document.getElementById("reseedBtn");
  const densitySlider = document.getElementById("density");
  const speedSlider = document.getElementById("speed");
  const chaosSlider = document.getElementById("chaos");
  const palettesEl = document.getElementById("palettes");
  const chipsEl = document.getElementById("chips");

  // ---- status toast --------------------------------------------------

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 400);
    }, 2600);
  }

  // ---- seeded randomness -------------------------------------------

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let seed = (Math.random() * 1e9) | 0;
  let rng = mulberry32(seed);

  function reseed(newSeed) {
    seed = newSeed ?? ((Math.random() * 1e9) | 0);
    rng = mulberry32(seed);
    seedVal.textContent = seed;
  }

  // ---- palettes (duotone overlays) -----------------------------------

  const PALETTES = [
    { name: "なし", a: null, b: null },
    { name: "ネオン", a: "#ff2bd6", b: "#00e5ff" },
    { name: "サンセット", a: "#ff6a3d", b: "#5b3cff" },
    { name: "ミント", a: "#00ffa6", b: "#7a5cff" },
    { name: "モノクロ", a: "#f2f2f2", b: "#101018" },
  ];
  let paletteIndex = 0;

  PALETTES.forEach((p, i) => {
    const b = document.createElement("button");
    b.className = "swatch" + (i === paletteIndex ? " active" : "");
    b.style.background = p.a ? `linear-gradient(135deg, ${p.a}, ${p.b})` : "#333";
    b.title = p.name;
    b.addEventListener("click", () => {
      paletteIndex = i;
      [...palettesEl.children].forEach((c, ci) => c.classList.toggle("active", ci === i));
    });
    palettesEl.appendChild(b);
  });

  // ---- effect organs: each fades in/out on its own asynchronous clock --

  const EFFECT_DEFS = [
    { key: "pixelStretch", label: "ピクセル伸長" },
    { key: "scanDrift", label: "走査ドリフト" },
    { key: "halftone", label: "ハーフトーン" },
    { key: "posterize", label: "減色" },
    { key: "invertFlash", label: "反転フラッシュ" },
    { key: "mirror", label: "鏡面" },
    { key: "rgbShift", label: "色収差" },
    { key: "grain", label: "粒子" },
  ];
  const gates = {};
  const chipEls = {};
  EFFECT_DEFS.forEach((d) => {
    gates[d.key] = { active: false, value: 0, nextToggle: 0 };
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = d.label;
    chipsEl.appendChild(chip);
    chipEls[d.key] = chip;
  });

  function speedMultiplier() {
    return 0.3 + (+speedSlider.value / 100) * 2.7;
  }

  function updateGates(t, dt) {
    const density = +densitySlider.value / 100;
    const chaos = +chaosSlider.value / 100;
    const sm = speedMultiplier();
    EFFECT_DEFS.forEach((d) => {
      const g = gates[d.key];
      if (t >= g.nextToggle) {
        g.active = rng() < 0.25 + density * 0.35;
        const base = 4 - density * 2.5;
        g.nextToggle = t + Math.max(0.6, base * (0.6 + rng() * 0.9)) / sm;
      }
      const target = g.active ? 0.35 + chaos * 0.65 : 0;
      g.value += (target - g.value) * Math.min(1, dt * (1.4 + chaos * 2) * sm);
      chipEls[d.key].classList.toggle("on", g.value > 0.12);
    });
  }

  function forceReshuffle(t) {
    EFFECT_DEFS.forEach((d) => { gates[d.key].nextToggle = t; });
    for (let i = 0; i < 5; i++) spawnShed();
  }

  // ---- single media source --------------------------------------------

  let source = null; // { type:'image'|'video', url, el|videoEl, w, h, name }

  function clearSource() {
    if (!source) return;
    if (source.type === "video") { try { source.videoEl.pause(); source.videoEl.src = ""; } catch (e) {} }
    URL.revokeObjectURL(source.url);
    source = null;
    thumbsEl.innerHTML = "";
  }

  function setSource(entry) {
    if (source) {
      if (source.type === "video") { try { source.videoEl.pause(); source.videoEl.src = ""; } catch (e) {} }
      URL.revokeObjectURL(source.url);
    }
    source = entry;
  }

  function updateThumb(imgSrc, isVideo) {
    thumbsEl.innerHTML = "";
    const el = document.createElement("div");
    el.className = "thumb";
    el.innerHTML = `<img src="${imgSrc}" />${isVideo ? '<span class="kind">▶</span>' : ""}<button class="rm">×</button>`;
    el.querySelector(".rm").addEventListener("click", () => { clearSource(); toast("素材を外しました"); });
    thumbsEl.appendChild(el);
  }

  function addImageFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setSource({ type: "image", url, el: img, w: img.naturalWidth, h: img.naturalHeight, name: file.name });
      updateThumb(url, false);
      toast(`読み込み: ${file.name}`);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast(`読み込めませんでした: ${file.name}`);
    };
    img.src = url;
  }

  function addVideoFile(file) {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.loop = true; v.playsInline = true; v.src = url;
    v.addEventListener("loadeddata", () => {
      setSource({ type: "video", url, videoEl: v, w: v.videoWidth, h: v.videoHeight, name: file.name });
      v.play().catch(() => {});
      const tc = document.createElement("canvas");
      tc.width = 64; tc.height = 64;
      try {
        const s = Math.min(v.videoWidth, v.videoHeight);
        tc.getContext("2d").drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, 64, 64);
        updateThumb(tc.toDataURL(), true);
      } catch (e) {
        updateThumb(url, true);
      }
      toast(`読み込み: ${file.name}`);
    }, { once: true });
    v.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      toast(`読み込めませんでした: ${file.name}(非対応の形式の可能性)`);
    }, { once: true });
    v.play().catch(() => {});
  }

  function handleFiles(fileList) {
    if (!fileList || !fileList.length) return;
    const f = fileList[0];
    if (f.type.startsWith("image/")) addImageFile(f);
    else if (f.type.startsWith("video/")) addVideoFile(f);
    else toast(`非対応のファイル形式: ${f.name}`);
  }

  addBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => { handleFiles(e.target.files); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach((ev) =>
    window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add("dragging"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.remove("dragging"); })
  );
  window.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });

  // ---- transport ----------------------------------------------------

  let running = true;

  function setRunning(v) {
    running = v;
    playBtn.textContent = running ? "停止" : "再生";
    playBtn.classList.toggle("stopped", !running);
    if (source && source.type === "video") {
      if (running) source.videoEl.play().catch(() => {}); else source.videoEl.pause();
    }
  }

  playBtn.addEventListener("click", () => setRunning(!running));
  recutBtn.addEventListener("click", () => forceReshuffle(performance.now() / 1000));
  reseedBtn.addEventListener("click", () => reseed());
  collapseBtn.addEventListener("click", () => dock.classList.toggle("collapsed"));

  // ---- recording (same reliability approach proven in cutup) -----------

  function pickRecorderMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
    const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || null;
  }

  async function saveViaDownloadsCapability(blob, filename) {
    try {
      if (!window.claude || !window.claude.use) return false;
      const downloads = await window.claude.use("downloads");
      if (!downloads) return false;
      await downloads.save({ filename, data: blob });
      toast(`保存しました: ${filename}`);
      return true;
    } catch (e) {
      if (e && e.code === "declined") { toast("保存をキャンセルしました"); return true; }
      if (e && e.code === "too_large") { toast("録画データが大きすぎます(16MB以内)。短く録り直してください"); return true; }
      return false;
    }
  }

  async function saveBlob(blob, filename) {
    if (await saveViaDownloadsCapability(blob, filename)) return;

    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        toast("共有シートを開きました");
        return;
      }
    } catch (e) { /* fall through */ }

    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(`保存しました: ${filename}`);
    } catch (e) {
      try {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        toast("新しいタブで開きました。長押しで保存してください");
      } catch (e2) {
        toast("書き出しに失敗しました");
      }
    }
  }

  let recorder = null, chunks = [];
  recBtn.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    if (!window.MediaRecorder || !canvas.captureStream) {
      toast("この端末はREC(録画)に対応していません");
      return;
    }
    const mime = pickRecorderMime();
    if (!mime) {
      toast("対応する録画形式が見つかりませんでした");
      return;
    }
    try {
      const stream = canvas.captureStream(30);
      recorder = new MediaRecorder(stream, { mimeType: mime });
    } catch (e) {
      toast("REC開始に失敗しました");
      return;
    }
    chunks = [];
    let recordedBytes = 0;
    const MAX_BYTES = 14 * 1024 * 1024;
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      recordedBytes += e.data.size;
      if (recordedBytes > MAX_BYTES && recorder.state === "recording") {
        toast("上限に近づいたため自動停止しました");
        recorder.stop();
      }
    };
    recorder.onstop = () => {
      recBtn.classList.remove("active");
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      saveBlob(blob, `dappi-${seed}-${Date.now()}.${ext}`);
    };
    recorder.start(1000);
    recBtn.classList.add("active");
    toast("REC開始");
  });

  // ---- canvas sizing --------------------------------------------------

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    work.width = W * DPR; work.height = H * DPR;
    workCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- base image draw (cover-fit + slow breathing scale) --------------

  const breathPhase = rng() * Math.PI * 2;

  function drawCover(destCtx, el, nw, nh, dw, dh) {
    const scale = Math.max(dw / nw, dh / nh);
    const w = nw * scale, h = nh * scale;
    destCtx.drawImage(el, (dw - w) / 2, (dh - h) / 2, w, h);
  }

  function drawPlaceholder(t) {
    const hue = (t * 10) % 360;
    const grad = workCtx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    grad.addColorStop(0, `hsl(${hue}, 55%, 16%)`);
    grad.addColorStop(1, `hsl(${(hue + 120) % 360}, 55%, 6%)`);
    workCtx.fillStyle = grad;
    workCtx.fillRect(0, 0, W, H);
  }

  function drawBaseToWork(t, sm) {
    workCtx.save();
    workCtx.fillStyle = "#05050a";
    workCtx.fillRect(0, 0, W, H);

    if (source) {
      const isVideo = source.type === "video";
      const el = isVideo ? source.videoEl : source.el;
      const nw = isVideo ? (source.videoEl.videoWidth || source.w) : source.w;
      const nh = isVideo ? (source.videoEl.videoHeight || source.h) : source.h;
      if (nw > 0 && nh > 0) {
        const breathe = 1 + Math.sin(t * 0.18 * sm + breathPhase) * 0.06 + Math.sin(t * 0.05 * sm + breathPhase * 1.7) * 0.03;
        workCtx.translate(W / 2, H / 2);
        workCtx.scale(breathe, breathe * (1 + Math.sin(t * 0.09 * sm) * 0.02));
        workCtx.translate(-W / 2, -H / 2);
        try { drawCover(workCtx, el, nw, nh, W, H); } catch (e) {}
      } else {
        drawPlaceholder(t);
      }
    } else {
      drawPlaceholder(t);
    }
    workCtx.restore();
  }

  // ---- effect organs (operate on the work canvas, self-reference safe) -

  let scanBands = [];
  let lastBandRebuild = 0;
  function applyScanDrift(t, intensity, sm) {
    if (intensity <= 0.03) return;
    if (t - lastBandRebuild > 0.15 || !scanBands.length) {
      lastBandRebuild = t;
      scanBands = [];
      let y = 0;
      while (y < H) {
        const h = 6 + rng() * Math.min(60, H * 0.08);
        scanBands.push({ y, h, phase: rng() * Math.PI * 2, freq: 0.5 + rng() * 2, amp: 4 + rng() * 18 });
        y += h;
      }
    }
    scanBands.forEach((b) => {
      const dx = Math.sin(t * b.freq * sm + b.phase) * b.amp * intensity;
      if (Math.abs(dx) < 0.5) return;
      try { workCtx.drawImage(work, 0, b.y, W, b.h, dx, b.y, W, b.h); } catch (e) {}
    });
  }

  function maybePixelStretch(intensity) {
    if (intensity < 0.3 || rng() > 0.05 * intensity) return;
    try {
      if (rng() < 0.5) {
        const bw = 2 + rng() * 6;
        const sx = rng() * Math.max(1, W - bw);
        const destW = bw * (4 + rng() * 10);
        workCtx.drawImage(work, sx, 0, bw, H, Math.max(0, sx + (rng() - 0.5) * 40), 0, destW, H);
      } else {
        const bh = 2 + rng() * 6;
        const sy = rng() * Math.max(1, H - bh);
        const destH = bh * (4 + rng() * 10);
        workCtx.drawImage(work, 0, sy, W, bh, 0, Math.max(0, sy + (rng() - 0.5) * 40), W, destH);
      }
    } catch (e) {}
  }

  const halftoneTiles = {};
  function getHalftoneTile(size) {
    const key = size;
    if (halftoneTiles[key]) return halftoneTiles[key];
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const cx = c.getContext("2d");
    cx.fillStyle = "#000"; cx.fillRect(0, 0, size, size);
    cx.fillStyle = "#fff";
    cx.beginPath(); cx.arc(size / 2, size / 2, size * 0.32, 0, Math.PI * 2); cx.fill();
    halftoneTiles[key] = c;
    return c;
  }
  function applyHalftone(intensity) {
    if (intensity <= 0.03) return;
    const size = Math.max(4, Math.round(6 + (1 - intensity) * 10));
    const tile = getHalftoneTile(size);
    workCtx.save();
    workCtx.globalCompositeOperation = "multiply";
    workCtx.globalAlpha = 0.35 * intensity;
    workCtx.fillStyle = workCtx.createPattern(tile, "repeat");
    workCtx.fillRect(0, 0, W, H);
    workCtx.restore();
  }

  const smallBuf = document.createElement("canvas");
  const smallCtx = smallBuf.getContext("2d");
  function applyPosterize(intensity) {
    if (intensity <= 0.05) return;
    const blocks = Math.max(6, Math.round(90 * (1 - intensity) + 6));
    smallBuf.width = blocks;
    smallBuf.height = Math.max(1, Math.round(blocks * (H / W)));
    smallCtx.imageSmoothingEnabled = false;
    smallCtx.drawImage(work, 0, 0, W, H, 0, 0, smallBuf.width, smallBuf.height);
    workCtx.save();
    workCtx.imageSmoothingEnabled = false;
    workCtx.globalAlpha = intensity;
    workCtx.drawImage(smallBuf, 0, 0, smallBuf.width, smallBuf.height, 0, 0, W, H);
    workCtx.imageSmoothingEnabled = true;
    workCtx.restore();
  }

  function applyMirror(intensity) {
    if (intensity <= 0.3) return;
    try {
      workCtx.save();
      workCtx.globalAlpha = (intensity - 0.3) / 0.7;
      workCtx.translate(W, 0);
      workCtx.scale(-1, 1);
      workCtx.drawImage(work, 0, 0, W / 2, H, W / 2, 0, W / 2, H);
      workCtx.restore();
    } catch (e) {}
  }

  function applyInvertFlash(intensity) {
    if (intensity <= 0.5) return;
    workCtx.save();
    workCtx.globalCompositeOperation = "difference";
    workCtx.fillStyle = "#fff";
    workCtx.globalAlpha = intensity;
    workCtx.fillRect(0, 0, W, H);
    workCtx.restore();
  }

  // ---- global post effects on the main canvas --------------------------

  let grainCanvas = document.createElement("canvas");
  grainCanvas.width = 128; grainCanvas.height = 128;
  function regenGrain() {
    const gctx = grainCanvas.getContext("2d");
    const id = gctx.createImageData(128, 128);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = (rng() * 255) | 0;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    gctx.putImageData(id, 0, 0);
  }
  regenGrain();
  let lastGrainAt = 0;

  function applyRgbShift(intensity) {
    if (intensity <= 0.1) return;
    const off = intensity * 6;
    try {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.5;
      ctx.drawImage(canvas, off, 0, W - off, H, 0, 0, W - off, H);
      ctx.fillStyle = "rgba(255,0,80,0.18)";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(canvas, -off, 0, W - off, H, off, 0, W - off, H);
      ctx.fillStyle = "rgba(0,220,255,0.14)";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } catch (e) {}
  }

  function applyGrain(t, intensity) {
    if (intensity <= 0.03) return;
    if (t - lastGrainAt > 0.12) { regenGrain(); lastGrainAt = t; }
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.1 + intensity * 0.28;
    ctx.fillStyle = ctx.createPattern(grainCanvas, "repeat");
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function applyPaletteDuotone() {
    const pal = PALETTES[paletteIndex];
    if (!pal.a) return;
    ctx.save();
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "color";
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, pal.a);
    grad.addColorStop(1, pal.b);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function applyVignette() {
    ctx.save();
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ---- shed fragments: little clones that drift, spin, and dissolve ----

  let sheds = [];

  function spawnShed() {
    const minWH = Math.min(W, H);
    const size = minWH * (0.08 + rng() * 0.22);
    const sx = rng() * Math.max(1, W - size);
    const sy = rng() * Math.max(1, H - size);
    const bmp = document.createElement("canvas");
    bmp.width = Math.max(1, Math.round(size));
    bmp.height = Math.max(1, Math.round(size));
    try {
      bmp.getContext("2d").drawImage(canvas, sx, sy, size, size, 0, 0, bmp.width, bmp.height);
    } catch (e) { return; }
    const angle = rng() * Math.PI * 2;
    const sm = speedMultiplier();
    const spd = (8 + rng() * 30) * sm;
    sheds.push({
      canvas: bmp,
      x: sx + size / 2, y: sy + size / 2,
      vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
      rot: rng() * Math.PI * 2, vrot: (rng() - 0.5) * 1.1,
      size,
      age: 0,
      life: 2.5 + rng() * 4,
      hue: rng() * 60 - 30,
      mirrored: rng() < 0.3,
    });
    if (sheds.length > 26) sheds.shift();
  }

  let nextShedAt = 0;
  function maybeSpawnShed(t) {
    if (!source) return;
    if (t < nextShedAt) return;
    const density = +densitySlider.value / 100;
    const sm = speedMultiplier();
    nextShedAt = t + Math.max(0.25, (1.8 - density * 1.4) / sm) * (0.6 + rng() * 0.8);
    spawnShed();
  }

  function updateAndDrawSheds(dt) {
    sheds.forEach((s) => {
      s.age += dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.rot += s.vrot * dt;
      const lt = s.age / s.life;
      let env;
      if (lt < 0.15) env = lt / 0.15;
      else if (lt > 0.75) env = Math.max(0, 1 - (lt - 0.75) / 0.25);
      else env = 1;
      const scale = 0.5 + env * 0.7 + Math.sin(lt * Math.PI) * 0.15;
      ctx.save();
      ctx.globalAlpha = env;
      ctx.filter = `hue-rotate(${s.hue}deg)`;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.scale(s.mirrored ? -scale : scale, scale);
      try { ctx.drawImage(s.canvas, -s.size / 2, -s.size / 2, s.size, s.size); } catch (e) {}
      ctx.restore();
    });
    sheds = sheds.filter((s) => s.age < s.life);
  }

  // ---- video time-axis jump cuts ----------------------------------------

  let nextVideoJump = 0;
  function maybeJumpVideo(t, sm) {
    if (!source || source.type !== "video") return;
    if (t < nextVideoJump) return;
    const chaos = +chaosSlider.value / 100;
    nextVideoJump = t + Math.max(0.6, (5 - chaos * 4.2) / sm) * (0.5 + rng());
    const dur = source.videoEl.duration;
    if (dur && isFinite(dur) && rng() < 0.5 + chaos * 0.4) {
      try { source.videoEl.currentTime = rng() * dur; } catch (e) {}
    }
    if (rng() < 0.2 + chaos * 0.3) source.videoEl.playbackRate = 0.4 + rng() * 2.2;
  }

  // ---- main loop --------------------------------------------------------

  let lastT = performance.now() / 1000;

  function frame() {
    const t = performance.now() / 1000;
    const dt = Math.min(0.1, t - lastT);
    lastT = t;

    if (running) {
      const sm = speedMultiplier();
      updateGates(t, dt);
      maybeJumpVideo(t, sm);

      drawBaseToWork(t, sm);
      applyScanDrift(t, gates.scanDrift.value, sm);
      maybePixelStretch(gates.pixelStretch.value);
      applyHalftone(gates.halftone.value);
      applyPosterize(gates.posterize.value);
      applyMirror(gates.mirror.value);
      applyInvertFlash(gates.invertFlash.value);

      ctx.clearRect(0, 0, W, H);
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      try { ctx.drawImage(work, 0, 0, W, H); } catch (e) {}

      applyRgbShift(gates.rgbShift.value);
      applyGrain(t, gates.grain.value);
      applyPaletteDuotone();
      applyVignette();

      maybeSpawnShed(t);
      updateAndDrawSheds(dt);
    }

    requestAnimationFrame(frame);
  }

  reseed(seed);
  requestAnimationFrame(frame);
})();
