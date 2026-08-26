// cutup — generative video/image collage
//
// The canvas is repeatedly cut into an irregular set of fragments (a
// binary space partition, redrawn from scratch every so often). Each
// fragment owns an independent clock: its crop window drifts smoothly
// through its source image or video, while its color treatment and,
// for video, its playback position jump on their own asynchronous
// schedules. Nothing is choreographed — every fragment is running its
// own tiny, cheap simulation, the same idea as kizashi's bell layers,
// just applied to pixels and frames instead of notes.

(() => {
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");

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
  const timeaxisSlider = document.getElementById("timeaxis");
  const chaosSlider = document.getElementById("chaos");
  const palettesEl = document.getElementById("palettes");

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

  function makeDrift(min, max, start) {
    let value = start ?? (min + max) / 2;
    let target = value;
    return {
      get value() { return value; },
      tick(rate, flipProb = 0.05) {
        if (rng() < flipProb) target = min + rng() * (max - min);
        value += (target - value) * rate;
        return value;
      },
    };
  }

  // ---- palettes (duotone overlays, vaporwave-leaning) ----------------

  const PALETTES = [
    { name: "なし", a: null, b: null },
    { name: "ネオン", a: "#ff2bd6", b: "#00e5ff" },
    { name: "サンセット", a: "#ff6a3d", b: "#5b3cff" },
    { name: "ミント", a: "#00ffa6", b: "#7a5cff" },
    { name: "モノクロ", a: "#f2f2f2", b: "#101018" },
  ];
  let paletteIndex = 1;

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

  // ---- media pool ------------------------------------------------

  const MAX_INSTANCES_PER_VIDEO = 3;
  let media = []; // { id, type, url, el, w, h, instances:[video,...] }
  let mediaSeq = 0;

  function addImageFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const entry = { id: mediaSeq++, type: "image", url, el: img, w: img.naturalWidth, h: img.naturalHeight, name: file.name };
      media.push(entry);
      addThumb(entry, url);
      claimEmptyCellsFor(entry);
    };
    img.src = url;
  }

  function addVideoFile(file) {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.loop = true; v.playsInline = true; v.src = url;
    v.addEventListener("loadeddata", () => {
      const entry = { id: mediaSeq++, type: "video", url, el: v, w: v.videoWidth, h: v.videoHeight, name: file.name, instances: [v] };
      media.push(entry);
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = 64; thumbCanvas.height = 64;
      const tctx = thumbCanvas.getContext("2d");
      try {
        const s = Math.min(v.videoWidth, v.videoHeight);
        tctx.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, 64, 64);
        addThumb(entry, thumbCanvas.toDataURL(), true);
      } catch (e) {
        addThumb(entry, url, true);
      }
      claimEmptyCellsFor(entry);
    }, { once: true });
    v.play().catch(() => {});
  }

  function addThumb(entry, imgSrc, isVideo) {
    const el = document.createElement("div");
    el.className = "thumb";
    el.innerHTML = `<img src="${imgSrc}" />${isVideo ? '<span class="kind">▶</span>' : ""}<button class="rm">×</button>`;
    el.querySelector(".rm").addEventListener("click", () => removeMedia(entry, el));
    thumbsEl.appendChild(el);
  }

  function removeMedia(entry, thumbEl) {
    media = media.filter((m) => m !== entry);
    thumbEl.remove();
    if (entry.type === "video") {
      entry.instances.forEach((v) => { try { v.pause(); v.src = ""; } catch (e) {} });
    }
    URL.revokeObjectURL(entry.url);
    cells.forEach((c) => { if (c.media === entry) assignSource(c); });
  }

  function claimEmptyCellsFor(entry) {
    cells.forEach((c) => { if (!c.media) assignSource(c, entry); });
  }

  function acquireVideoInstance(entry) {
    const used = new Set(cells.filter((c) => c.media === entry && c.videoEl).map((c) => c.videoEl));
    let free = entry.instances.find((v) => !used.has(v));
    if (!free && entry.instances.length < MAX_INSTANCES_PER_VIDEO) {
      free = document.createElement("video");
      free.muted = true; free.loop = true; free.playsInline = true; free.src = entry.url;
      free.play().catch(() => {});
      entry.instances.push(free);
    }
    if (!free) free = entry.instances[(rng() * entry.instances.length) | 0];
    return free;
  }

  // ---- fragment (cell) model ---------------------------------------

  let cells = [];

  function randomCrop(entry) {
    if (!entry) return { x: 0, y: 0, w: 1, h: 1 };
    const zoom = 1 + rng() * 1.4;
    const w = 1 / zoom, h = 1 / zoom;
    return { x: rng() * (1 - w), y: rng() * (1 - h), w, h };
  }

  function randomEffect() {
    return {
      hue: rng() * 360,
      sat: 0.6 + rng() * 1.8,
      cont: 0.7 + rng() * 1.1,
      bri: 0.75 + rng() * 0.7,
      blur: rng() < 0.12 ? rng() * 3 : 0,
      invert: rng() < 0.08,
      gray: rng() < 0.1,
      flipX: rng() < 0.3,
      flipY: rng() < 0.1,
      rot: [0, 0, 0, 90, 180, 270][(rng() * 6) | 0],
    };
  }

  function assignSource(cell, forceEntry) {
    const entry = forceEntry || (media.length ? media[(rng() * media.length) | 0] : null);
    cell.media = entry;
    cell.crop = randomCrop(entry);
    cell.driftX = makeDrift(-0.15, 0.15, 0);
    cell.driftY = makeDrift(-0.15, 0.15, 0);
    if (entry && entry.type === "video") {
      cell.videoEl = acquireVideoInstance(entry);
      cell.playbackMode = rng() < 0.5 ? "forward" : "jumpy";
      cell.videoEl.playbackRate = cell.playbackMode === "forward" ? 0.6 + rng() * 1.6 : 1;
      cell.nextTimeJump = 0;
    } else {
      cell.videoEl = null;
    }
  }

  function mutateCell(cell) {
    cell.effect = randomEffect();
    assignSource(cell, rng() < 0.7 && cell.media ? cell.media : null);
  }

  function pickWeightedByArea(rects) {
    const areas = rects.map((r) => r.w * r.h);
    const total = areas.reduce((s, a) => s + a, 0);
    let t = rng() * total;
    for (let i = 0; i < areas.length; i++) { t -= areas[i]; if (t <= 0) return i; }
    return rects.length - 1;
  }

  function buildRects(targetCount) {
    let rects = [{ x: 0, y: 0, w: 1, h: 1 }];
    while (rects.length < targetCount) {
      const idx = pickWeightedByArea(rects);
      const r = rects[idx];
      const horizontal = r.w > r.h ? rng() < 0.65 : rng() < 0.35;
      const ratio = 0.28 + rng() * 0.44;
      let a, b;
      if (horizontal) {
        a = { x: r.x, y: r.y, w: r.w * ratio, h: r.h };
        b = { x: r.x + r.w * ratio, y: r.y, w: r.w * (1 - ratio), h: r.h };
      } else {
        a = { x: r.x, y: r.y, w: r.w, h: r.h * ratio };
        b = { x: r.x, y: r.y + r.h * ratio, w: r.w, h: r.h * (1 - ratio) };
      }
      rects.splice(idx, 1, a, b);
    }
    return rects;
  }

  function fragmentCount() {
    return Math.round(3 + (+densitySlider.value / 100) * 15);
  }

  function regenerateLayout() {
    const rects = buildRects(fragmentCount());
    const now = performance.now() / 1000;
    cells = rects.map((r, i) => {
      const cell = { ...r, id: i, nextMutate: now + rng() * 2, phase: rng() * Math.PI * 2 };
      assignSource(cell);
      cell.effect = randomEffect();
      return cell;
    });
  }

  // ---- transport ----------------------------------------------------

  let running = true;
  let lastFullRecut = performance.now() / 1000;

  function setRunning(v) {
    running = v;
    playBtn.textContent = running ? "停止" : "再生";
    playBtn.classList.toggle("stopped", !running);
    media.forEach((m) => {
      if (m.type !== "video") return;
      m.instances.forEach((el) => { if (running) el.play().catch(() => {}); else el.pause(); });
    });
  }

  playBtn.addEventListener("click", () => setRunning(!running));
  recutBtn.addEventListener("click", () => regenerateLayout());
  reseedBtn.addEventListener("click", () => { reseed(); regenerateLayout(); });

  collapseBtn.addEventListener("click", () => dock.classList.toggle("collapsed"));

  addBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => { handleFiles(e.target.files); fileInput.value = ""; });

  function handleFiles(fileList) {
    [...fileList].forEach((f) => {
      if (f.type.startsWith("image/")) addImageFile(f);
      else if (f.type.startsWith("video/")) addVideoFile(f);
    });
  }

  ["dragenter", "dragover"].forEach((ev) =>
    window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add("dragging"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.remove("dragging"); })
  );
  window.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });

  // ---- recording -----------------------------------------------------

  let recorder = null, chunks = [];
  recBtn.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    const stream = canvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      recBtn.classList.remove("active");
      const blob = new Blob(chunks, { type: "video/webm" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cutup-${seed}-${Date.now()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    recorder.start();
    recBtn.classList.add("active");
  });

  // ---- canvas sizing --------------------------------------------------

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- noise / grain tile ---------------------------------------------

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

  // ---- drawing one fragment --------------------------------------------

  function drawCell(cell, t) {
    const px = cell.x * W, py = cell.y * H, pw = cell.w * W, ph = cell.h * H;
    const gap = Math.min(pw, ph) * 0.02 + 1;
    const rx = px + gap, ry = py + gap, rw = Math.max(1, pw - gap * 2), rh = Math.max(1, ph - gap * 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();

    const e = cell.effect;
    ctx.filter = `hue-rotate(${e.hue}deg) saturate(${e.sat}) contrast(${e.cont}) brightness(${e.bri})` +
      (e.blur ? ` blur(${e.blur}px)` : "") + (e.invert ? " invert(1)" : "") + (e.gray ? " grayscale(1)" : "");

    if (cell.media && cell.media.el) {
      const src = cell.media.el;
      const naturalW = cell.media.type === "video" ? (cell.videoEl.videoWidth || cell.media.w) : cell.media.w;
      const naturalH = cell.media.type === "video" ? (cell.videoEl.videoHeight || cell.media.h) : cell.media.h;
      const drawEl = cell.media.type === "video" ? cell.videoEl : src;

      const driftX = cell.driftX.tick(0.02) * 0.02;
      const driftY = cell.driftY.tick(0.02) * 0.02;
      const cx = Math.min(Math.max(cell.crop.x + driftX, 0), 1 - cell.crop.w);
      const cy = Math.min(Math.max(cell.crop.y + driftY, 0), 1 - cell.crop.h);

      const sx = cx * naturalW, sy = cy * naturalH, sw = cell.crop.w * naturalW, sh = cell.crop.h * naturalH;

      ctx.translate(rx + rw / 2, ry + rh / 2);
      ctx.rotate((e.rot * Math.PI) / 180);
      ctx.scale(e.flipX ? -1 : 1, e.flipY ? -1 : 1);
      const drawW = (e.rot === 90 || e.rot === 270) ? rh : rw;
      const drawH = (e.rot === 90 || e.rot === 270) ? rw : rh;
      try {
        if (sw > 0 && sh > 0 && naturalW > 0 && naturalH > 0) {
          ctx.drawImage(drawEl, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
        }
      } catch (err) { /* media not decodable yet this frame */ }
    } else {
      // no source loaded yet: a small generative placeholder so the
      // piece still feels alive before anything is uploaded
      const hue = (cell.phase * 40 + t * 12) % 360;
      const grad = ctx.createLinearGradient(rx, ry, rx + rw, ry + rh);
      grad.addColorStop(0, `hsl(${hue}, 60%, 18%)`);
      grad.addColorStop(1, `hsl(${(hue + 90) % 360}, 60%, 10%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.restore();
  }

  // ---- global post effects --------------------------------------------

  const rgbDrift = makeDrift(0, 1, 0);
  const glitchDrift = makeDrift(0, 1, 0);

  function applyPostEffects(t) {
    const chaos = +chaosSlider.value / 100;

    // chromatic aberration: tinted screen-blended copies offset in x
    const rgbAmt = rgbDrift.tick(0.05, 0.1) * chaos;
    if (rgbAmt > 0.15) {
      const off = rgbAmt * 6;
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
    }

    // block glitch: displace a random horizontal band
    const glitchAmt = glitchDrift.tick(0.08, 0.12);
    if (glitchAmt * chaos > 0.55 && rng() < 0.5) {
      const bandH = 6 + rng() * H * 0.08;
      const bandY = rng() * (H - bandH);
      const dx = (rng() - 0.5) * W * 0.25 * chaos;
      ctx.drawImage(canvas, 0, bandY, W, bandH, dx, bandY, W, bandH);
    }

    // scanlines
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#000";
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.restore();

    // grain
    if (t - lastGrainAt > 0.12) { regenGrain(); lastGrainAt = t; }
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.12 + chaos * 0.18;
    const pattern = ctx.createPattern(grainCanvas, "repeat");
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // duotone palette
    const pal = PALETTES[paletteIndex];
    if (pal.a) {
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

    // vignette
    ctx.save();
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ---- scheduling: mutation + time-axis jump cuts -----------------------

  function scheduleCells(t) {
    const density = +densitySlider.value / 100;
    const timeaxis = +timeaxisSlider.value / 100;
    const chaos = +chaosSlider.value / 100;

    cells.forEach((cell) => {
      if (t >= cell.nextMutate) {
        mutateCell(cell);
        const base = 5 - density * 4; // 5s..1s
        cell.nextMutate = t + Math.max(0.4, base * (0.6 + rng() * 0.8));
      }
      if (cell.media && cell.media.type === "video" && cell.videoEl) {
        if (t >= (cell.nextTimeJump || 0)) {
          const interval = 6 - timeaxis * 5.6; // 6s..0.4s
          cell.nextTimeJump = t + Math.max(0.3, interval * (0.5 + rng()));
          const dur = cell.videoEl.duration;
          if (dur && isFinite(dur) && cell.playbackMode === "jumpy" && rng() < 0.5 + timeaxis * 0.4) {
            try { cell.videoEl.currentTime = rng() * dur; } catch (e) {}
          }
          if (rng() < 0.15 + chaos * 0.2) {
            cell.videoEl.playbackRate = 0.4 + rng() * 2.2;
          }
        }
      }
    });

    // full re-layout on its own slow, chaos/density-modulated clock
    const recutInterval = Math.max(2.5, 14 - density * 8 - chaos * 5);
    if (t - lastFullRecut > recutInterval) {
      lastFullRecut = t;
      regenerateLayout();
    }
  }

  // ---- main loop --------------------------------------------------------

  function frame() {
    const t = performance.now() / 1000;

    if (running) {
      scheduleCells(t);
      const chaos = +chaosSlider.value / 100;
      const clearAlpha = Math.max(0.35, 1 - chaos * 0.5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(5,5,10,${clearAlpha})`;
      ctx.fillRect(0, 0, W, H);

      cells.forEach((cell) => drawCell(cell, t));
      applyPostEffects(t);
    }

    requestAnimationFrame(frame);
  }

  reseed(seed);
  regenerateLayout();
  requestAnimationFrame(frame);
})();
