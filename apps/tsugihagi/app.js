// 継ぎ接ぎ (tsugihagi) — generative video cut-up collage
//
// The stage is split into a small number of cells by a layout template
// (full frame / side-by-side / triptych / a floating inset panel...).
// Three independent, randomly-jittered clocks disturb that state over
// time: one reshuffles the whole layout, one swaps a single cell's
// content, one swaps two cells' content across the frame (the left/right
// alternation). Every track also carries a slow continuous "drift" on
// its pan/zoom/color, the same smoothed-random-walk idea used in the
// kizashi ambient sketch, so nothing ever sits fully still.
//
// A "complexity" value random-walks upward over the play session toward
// a user-set ceiling, then keeps breathing below it rather than sitting
// pinned at the top — that's the "irregularity that keeps deepening but
// never fully scatters" behaviour asked for. Everything is driven by
// per-track "dice" (a full manual reroll) or the master dice, echoing
// the randomizer/looper mixers this is a video-side companion to.

(() => {
  const stage = document.getElementById("stage");
  const stageCtx = stage.getContext("2d");
  const stageEmpty = document.getElementById("stageEmpty");
  const W = stage.width, H = stage.height;

  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.width = W; sceneCanvas.height = H;
  const sceneCtx = sceneCanvas.getContext("2d");

  const transitionCanvas = document.createElement("canvas");
  transitionCanvas.width = W; transitionCanvas.height = H;
  const transitionCtx = transitionCanvas.getContext("2d");

  const playBtn = document.getElementById("playBtn");
  const diceBtn = document.getElementById("diceBtn");
  const recBtn = document.getElementById("recBtn");
  const snapBtn = document.getElementById("snapBtn");
  const autoEvolveBox = document.getElementById("autoEvolve");
  const glitchBox = document.getElementById("glitchTex");

  const densitySlider = document.getElementById("density");
  const speedSlider = document.getElementById("speed");
  const chaosSlider = document.getElementById("chaos");
  const fadeBalanceSlider = document.getElementById("fadeBalance");
  const globalHueSlider = document.getElementById("globalHue");
  const globalSatSlider = document.getElementById("globalSat");
  const darknessSlider = document.getElementById("darkness");

  const fileInput = document.getElementById("fileInput");
  const trackList = document.getElementById("trackList");
  const trackListEmpty = trackList.querySelector(".trackListEmpty");

  // ---- small utilities -------------------------------------------------

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function weightedPick(items, weightFn) {
    const weights = items.map(weightFn);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return choice(items);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function makeDrift(min, max, start) {
    let value = start ?? (min + max) / 2;
    let target = value;
    return {
      get value() { return value; },
      tick(rate, jumpChance = 0.04) {
        if (Math.random() < jumpChance) target = rand(min, max);
        value += (target - value) * rate;
        return value;
      },
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const BLEND_POOL = [
    "source-over", "multiply", "screen", "overlay", "darken",
    "lighten", "difference", "exclusion", "color-dodge", "hard-light",
  ];
  const BLEND_LABELS = {
    "source-over": "通常", multiply: "乗算", screen: "スクリーン",
    overlay: "オーバーレイ", darken: "比較(暗)", lighten: "比較(明)",
    difference: "差の絶対値", exclusion: "除外",
    "color-dodge": "覆い焼き", "hard-light": "ハードライト",
  };
  const SIDE_LABELS = { any: "どちらでも", left: "左", right: "右", full: "全面" };

  // ---- global params (wired to sliders below) --------------------------

  let densityParam = +densitySlider.value;
  let speedParam = +speedSlider.value;
  let chaosParam = +chaosSlider.value;
  let fadeBalanceParam = +fadeBalanceSlider.value;
  let globalHueParam = +globalHueSlider.value;
  let globalSatParam = +globalSatSlider.value;
  let darknessParam = +darknessSlider.value;
  let autoEvolveEnabled = autoEvolveBox.checked;
  let glitchEnabled = glitchBox.checked;

  densitySlider.addEventListener("input", () => densityParam = +densitySlider.value);
  speedSlider.addEventListener("input", () => speedParam = +speedSlider.value);
  chaosSlider.addEventListener("input", () => chaosParam = +chaosSlider.value);
  fadeBalanceSlider.addEventListener("input", () => fadeBalanceParam = +fadeBalanceSlider.value);
  globalHueSlider.addEventListener("input", () => globalHueParam = +globalHueSlider.value);
  globalSatSlider.addEventListener("input", () => globalSatParam = +globalSatSlider.value);
  darknessSlider.addEventListener("input", () => darknessParam = +darknessSlider.value);
  autoEvolveBox.addEventListener("change", () => autoEvolveEnabled = autoEvolveBox.checked);
  glitchBox.addEventListener("change", () => glitchEnabled = glitchBox.checked);

  // ---- tracks ------------------------------------------------------------

  let tracks = [];
  let trackSeq = 0;

  function availableTracks() {
    return tracks.filter((t) => !t.muted);
  }

  function trackById(id) {
    return tracks.find((t) => t.id === id);
  }

  function makeThumb(media) {
    const c = document.createElement("canvas");
    c.width = 88; c.height = 88;
    const cx = c.getContext("2d");
    cx.fillStyle = "#000";
    cx.fillRect(0, 0, 88, 88);
    const mw = media.videoWidth || media.naturalWidth || 1;
    const mh = media.videoHeight || media.naturalHeight || 1;
    const scale = Math.max(88 / mw, 88 / mh);
    const dw = mw * scale, dh = mh * scale;
    try { cx.drawImage(media, 44 - dw / 2, 44 - dh / 2, dw, dh); } catch (e) {}
    return c.toDataURL("image/jpeg", 0.72);
  }

  function randomizeTrack(track, magnitude = 1) {
    const m = clamp(magnitude, 0.15, 1);
    const p = track.params;
    p.opacity = rand(1 - 0.8 * m, 1);
    p.brightness = rand(1 - 0.45 * m, 1 + 0.55 * m);
    p.contrast = rand(1 - 0.2 * m, 1 + 0.4 * m);
    p.saturation = rand(Math.max(0, 1 - 0.9 * m), 1 + 0.9 * m);
    p.hue = rand(0, 360);
    p.invert = Math.random() < 0.12 * m ? 1 : 0;
    p.blend = choice(BLEND_POOL);
    p.mirrorX = Math.random() < 0.28;
    p.mirrorY = Math.random() < 0.1;
    syncTrackUI(track);
  }

  function createTrack(name, kind, el) {
    const id = "t" + (trackSeq++);
    const track = {
      id, name, kind, el,
      muted: false,
      locked: false,
      params: {
        opacity: 0.9, brightness: 1, contrast: 1.05, saturation: 1, hue: 0,
        invert: 0, blend: "source-over", mirrorX: false, mirrorY: false,
        sidePref: "any", chance: 1,
      },
      driftState: {
        panX: makeDrift(-0.1, 0.1, 0),
        panY: makeDrift(-0.08, 0.08, 0),
        zoom: makeDrift(1.0, 1.35, 1.05),
        hue: makeDrift(-12, 12, 0),
        opacity: makeDrift(-0.05, 0.05, 0),
        brightness: makeDrift(-0.1, 0.1, 0),
      },
      ui: {},
    };
    randomizeTrack(track, 0.45);
    track.thumbUrl = makeThumb(el);
    tracks.push(track);
    buildTrackRow(track);
    updateEmptyStates();
  }

  function removeTrack(track) {
    tracks = tracks.filter((t) => t !== track);
    cells = cells.filter((c) => c.trackId !== track.id);
    if (track.row) track.row.remove();
    try { track.el.pause && track.el.pause(); } catch (e) {}
    try { URL.revokeObjectURL(track.el.src); } catch (e) {}
    updateEmptyStates();
  }

  function updateEmptyStates() {
    trackListEmpty.style.display = tracks.length ? "none" : "block";
    stageEmpty.style.display = tracks.length ? "none" : "flex";
  }

  function addFilesFromInput(files) {
    Array.from(files).forEach((file) => {
      const isVideo = file.type.startsWith("video");
      const isImage = file.type.startsWith("image");
      if (!isVideo && !isImage) return;
      const url = URL.createObjectURL(file);
      const el = isVideo ? document.createElement("video") : document.createElement("img");
      if (isVideo) {
        el.muted = true; el.loop = true; el.playsInline = true;
        el.addEventListener("loadeddata", () => {
          createTrack(file.name, "video", el);
          if (running) el.play().catch(() => {});
        }, { once: true });
        el.src = url;
        el.load();
      } else {
        el.addEventListener("load", () => createTrack(file.name, "image", el), { once: true });
        el.src = url;
      }
    });
  }

  fileInput.addEventListener("change", (e) => {
    addFilesFromInput(e.target.files);
    fileInput.value = "";
  });

  const stageWrap = document.querySelector(".stageWrap");
  ["dragover", "dragenter"].forEach((ev) =>
    stageWrap.addEventListener(ev, (e) => { e.preventDefault(); })
  );
  stageWrap.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files) addFilesFromInput(e.dataTransfer.files);
  });

  // ---- track UI row -------------------------------------------------------

  function syncTrackUI(track) {
    const ui = track.ui;
    if (!ui.opacity) return;
    ui.opacity.value = track.params.opacity;
    ui.brightness.value = track.params.brightness;
    ui.saturation.value = track.params.saturation;
    ui.hue.value = track.params.hue;
    ui.blend.value = track.params.blend;
  }

  function slider(labelJa, labelEn, min, max, step, value, onInput) {
    const wrap = document.createElement("label");
    wrap.className = "slider";
    const span = document.createElement("span");
    span.innerHTML = `${labelJa} <em>${labelEn}</em>`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = min; input.max = max; input.step = step; input.value = value;
    input.addEventListener("input", () => onInput(+input.value));
    wrap.appendChild(span);
    wrap.appendChild(input);
    return { wrap, input };
  }

  function buildTrackRow(track) {
    const row = document.createElement("div");
    row.className = "track";
    track.row = row;

    const thumb = document.createElement("div");
    thumb.className = "trackThumb";
    thumb.innerHTML = `<img src="${track.thumbUrl}" alt="" /><span class="kind">${track.kind === "video" ? "動画" : "画像"}</span>`;

    const body = document.createElement("div");
    body.className = "trackBody";

    const top = document.createElement("div");
    top.className = "trackTop";

    const name = document.createElement("span");
    name.className = "trackName";
    name.textContent = track.name;
    name.title = track.name;

    const muteBtn = document.createElement("button");
    muteBtn.className = "iconBtn";
    muteBtn.textContent = "🔈 有効";
    muteBtn.addEventListener("click", () => {
      track.muted = !track.muted;
      row.classList.toggle("muted", track.muted);
      muteBtn.textContent = track.muted ? "🔇 無効" : "🔈 有効";
      muteBtn.classList.toggle("active", track.muted);
    });

    const lockBtn = document.createElement("button");
    lockBtn.className = "iconBtn";
    lockBtn.textContent = "🔓";
    lockBtn.title = "自動進化とサイコロから保護";
    lockBtn.addEventListener("click", () => {
      track.locked = !track.locked;
      row.classList.toggle("locked", track.locked);
      lockBtn.textContent = track.locked ? "🔒" : "🔓";
      lockBtn.classList.toggle("active", track.locked);
    });

    const diceOne = document.createElement("button");
    diceOne.className = "iconBtn";
    diceOne.textContent = "🎲";
    diceOne.title = "このトラックだけふる";
    diceOne.addEventListener("click", () => randomizeTrack(track, 0.55 + complexity * 0.7));

    const sideSelect = document.createElement("select");
    Object.entries(SIDE_LABELS).forEach(([val, label]) => {
      const o = document.createElement("option");
      o.value = val; o.textContent = label;
      sideSelect.appendChild(o);
    });
    sideSelect.value = track.params.sidePref;
    sideSelect.addEventListener("change", () => track.params.sidePref = sideSelect.value);

    const removeBtn = document.createElement("button");
    removeBtn.className = "iconBtn danger";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeTrack(track));

    const spacer = document.createElement("span");
    spacer.className = "spacer";

    top.append(name, spacer, sideSelect, muteBtn, lockBtn, diceOne, removeBtn);

    const sliders = document.createElement("div");
    sliders.className = "trackSliders";

    const sOpacity = slider("不透明度", "opacity", 0, 1, 0.01, track.params.opacity, (v) => track.params.opacity = v);
    const sBright = slider("明暗", "bright", 0.2, 2, 0.01, track.params.brightness, (v) => track.params.brightness = v);
    const sSat = slider("彩度", "sat", 0, 2.2, 0.01, track.params.saturation, (v) => track.params.saturation = v);
    const sHue = slider("色相", "hue", 0, 360, 1, track.params.hue, (v) => track.params.hue = v);

    const chanceWrap = slider("出現率", "chance", 0.1, 3, 0.05, track.params.chance, (v) => track.params.chance = v);

    const blendWrap = document.createElement("label");
    blendWrap.className = "slider";
    const blendSpan = document.createElement("span");
    blendSpan.innerHTML = "合成 <em>blend</em>";
    const blendSelect = document.createElement("select");
    BLEND_POOL.forEach((b) => {
      const o = document.createElement("option");
      o.value = b; o.textContent = BLEND_LABELS[b];
      blendSelect.appendChild(o);
    });
    blendSelect.value = track.params.blend;
    blendSelect.addEventListener("change", () => track.params.blend = blendSelect.value);
    blendWrap.append(blendSpan, blendSelect);

    sliders.append(sOpacity.wrap, sBright.wrap, sSat.wrap, sHue.wrap, chanceWrap.wrap, blendWrap);

    track.ui = {
      opacity: sOpacity.input, brightness: sBright.input,
      saturation: sSat.input, hue: sHue.input, blend: blendSelect,
    };

    body.append(top, sliders);
    row.append(thumb, body);
    trackList.appendChild(row);
  }

  // ---- layout templates ----------------------------------------------------

  const LAYOUTS = {
    full: () => [{ x: 0, y: 0, w: 1, h: 1, z: 0 }],
    vsplit: () => {
      const r = rand(0.32, 0.68);
      return [{ x: 0, y: 0, w: r, h: 1, z: 0 }, { x: r, y: 0, w: 1 - r, h: 1, z: 0 }];
    },
    hsplit: () => {
      const r = rand(0.32, 0.68);
      return [{ x: 0, y: 0, w: 1, h: r, z: 0 }, { x: 0, y: r, w: 1, h: 1 - r, z: 0 }];
    },
    vsplitStripe: () => {
      const stripeH = rand(0.14, 0.24);
      const mainH = 1 - stripeH;
      const r = rand(0.35, 0.65);
      const cols = Math.random() < 0.5 ? 2 : 3;
      const cells = [
        { x: 0, y: 0, w: r, h: mainH, z: 0 },
        { x: r, y: 0, w: 1 - r, h: mainH, z: 0 },
      ];
      for (let i = 0; i < cols; i++) {
        cells.push({ x: i / cols, y: mainH, w: 1 / cols, h: stripeH, z: 0 });
      }
      return cells;
    },
    triptych: () => {
      const cols = 3, cells = [];
      for (let i = 0; i < cols; i++) cells.push({ x: i / cols, y: 0, w: 1 / cols, h: 1, z: 0 });
      return cells;
    },
    inset: () => {
      const base = Math.random() < 0.5 ? LAYOUTS.full() : LAYOUTS.vsplit();
      const iw = rand(0.28, 0.48), ih = rand(0.28, 0.48);
      const ix = rand(0.12, 1 - iw - 0.1);
      const iy = rand(0.1, 1 - ih - 0.15);
      base.push({ x: ix, y: iy, w: iw, h: ih, z: 1 });
      return base;
    },
  };

  function pickLayoutName(c) {
    const pool = [
      { name: "full", w: 1.5 - c },
      { name: "vsplit", w: 1.2 },
      { name: "hsplit", w: 0.4 + c * 0.6 },
      { name: "inset", w: 0.25 + c * 1.5 },
      { name: "vsplitStripe", w: 0.1 + c * 1.4 },
      { name: "triptych", w: 0.05 + c * 1.1 },
    ];
    return weightedPick(pool, (p) => Math.max(0.02, p.w)).name;
  }

  function cellZone(cell) {
    if (cell.w >= 0.85) return "full";
    const cx = cell.x + cell.w / 2;
    if (cx < 0.42) return "left";
    if (cx > 0.58) return "right";
    return "any";
  }

  function sideWeight(track, zone) {
    let w = track.params.chance;
    if (track.params.sidePref === "any") w *= 1;
    else if (track.params.sidePref === zone) w *= 3;
    else w *= 0.25;
    return Math.max(0.01, w);
  }

  function assignTracksToCells(cellsGeo, poolTracks) {
    let pool = poolTracks.slice();
    return cellsGeo.map((cell) => {
      if (pool.length === 0) pool = poolTracks.slice();
      const zone = cellZone(cell);
      const chosen = weightedPick(pool, (t) => sideWeight(t, zone));
      pool = pool.filter((t) => t !== chosen);
      return { ...cell, trackId: chosen.id };
    });
  }

  function effectiveDensity() {
    // density is a direct user control, so it stays mostly responsive on
    // its own; complexity only nudges it (roughly 70%..100%+ of the
    // slider) so there's still a sense of things filling in over time.
    const factor = clamp(0.55 + complexity * 0.9, 0.55, 1.5);
    return clamp(Math.round(densityParam * factor), 1, densityParam);
  }

  // ---- structure engine (cells, transitions, scheduler) --------------------

  let cells = [];
  let transition = { active: false, start: 0, duration: 600 };
  let nextStructure = null, nextContent = null, nextSide = null;

  function applyCells(newCells, fade) {
    if (fade) {
      transitionCtx.clearRect(0, 0, W, H);
      transitionCtx.drawImage(sceneCanvas, 0, 0);
      transition.active = true;
      transition.start = performance.now();
      transition.duration = rand(280, 900) * (1 - complexity * 0.25);
    } else {
      transition.active = false;
    }
    cells = newCells;
  }

  function mutateStructure() {
    const trs = availableTracks();
    if (trs.length === 0) return;
    const density = effectiveDensity();
    const layoutName = pickLayoutName(complexity);
    let cellsGeo = LAYOUTS[layoutName]();
    while (cellsGeo.length > Math.max(1, density)) cellsGeo.pop();
    const newCells = assignTracksToCells(cellsGeo, trs);
    const pFade = (fadeBalanceParam / 100) * (1 - complexity * 0.35);
    applyCells(newCells, Math.random() < pFade);
  }

  function contentSwap() {
    const trs = availableTracks();
    if (trs.length === 0 || cells.length === 0) return;
    const idx = Math.floor(Math.random() * cells.length);
    const zone = cellZone(cells[idx]);
    const alt = trs.filter((t) => t.id !== cells[idx].trackId);
    const chosen = weightedPick(alt.length ? alt : trs, (t) => sideWeight(t, zone));
    const newCells = cells.map((c, i) => (i === idx ? { ...c, trackId: chosen.id } : c));
    const pFade = clamp((fadeBalanceParam / 100) * (1 - complexity * 0.3) * 1.1, 0, 1);
    applyCells(newCells, Math.random() < pFade);
  }

  function sideSwap() {
    if (cells.length < 2) return;
    const i = Math.floor(Math.random() * cells.length);
    let j = Math.floor(Math.random() * cells.length);
    if (j === i) j = (j + 1) % cells.length;
    const newCells = cells.map((c) => ({ ...c }));
    const tmp = newCells[i].trackId;
    newCells[i].trackId = newCells[j].trackId;
    newCells[j].trackId = tmp;
    applyCells(newCells, Math.random() < 0.6);
  }

  function scheduler(nowMs) {
    const nowSec = nowMs / 1000;
    if (nextStructure === null) {
      nextStructure = nowSec + rand(3, 6);
      nextContent = nowSec + rand(1, 2);
      nextSide = nowSec + rand(2, 4);
      return;
    }
    const speedMul = clamp(speedParam / 100, 0.1, 3.5);
    const complexityMul = 1 + complexity * 1.8;
    const div = speedMul * complexityMul;

    if (nowSec >= nextStructure) {
      mutateStructure();
      nextStructure = nowSec + rand(3.5, 7) / div;
    }
    if (nowSec >= nextContent && cells.length > 0) {
      contentSwap();
      nextContent = nowSec + rand(1.0, 2.4) / div;
    }
    if (nowSec >= nextSide && cells.length >= 2) {
      sideSwap();
      nextSide = nowSec + rand(2.5, 5) / div;
    }
  }

  // ---- complexity accumulator ("artificial life" growth) --------------------

  let sessionStart = null;
  let complexity = 0.2;
  let complexityTarget = 0.2;

  function currentCeiling(nowMs) {
    const ceiling = chaosParam / 100;
    if (!sessionStart) return Math.min(0.22, ceiling);
    const minutes = (nowMs - sessionStart) / 60000;
    return Math.min(ceiling, 0.18 + minutes / 3);
  }

  function updateComplexity(nowMs, dt) {
    const ceiling = Math.max(0.05, currentCeiling(nowMs));
    if (Math.random() < 0.0035) complexityTarget = rand(Math.min(0.1, ceiling), ceiling);
    complexityTarget = Math.min(complexityTarget, ceiling);
    complexity += (complexityTarget - complexity) * clamp(dt * 0.35, 0, 1);
    complexity = clamp(complexity, 0.05, 1);
  }

  // ---- per-frame drift ------------------------------------------------------

  function tickDrift(dt) {
    if (!autoEvolveEnabled) return;
    const speedMul = clamp(speedParam / 100, 0.1, 3.5);
    const rate = clamp(dt * (0.5 + speedMul * 0.6), 0, 0.25);
    const jump = 0.008 + complexity * 0.05;
    tracks.forEach((t) => {
      if (t.locked) return;
      const d = t.driftState;
      d.panX.tick(rate, jump);
      d.panY.tick(rate, jump);
      d.zoom.tick(rate * 0.7, jump);
      d.hue.tick(rate * 0.5, jump * 0.6);
      d.opacity.tick(rate * 0.6, jump * 0.5);
      d.brightness.tick(rate * 0.6, jump * 0.5);
    });
  }

  // ---- rendering ---------------------------------------------------------

  function drawTrackInCell(ctx, track, cell, isBase) {
    const media = track.el;
    const mw = media.videoWidth || media.naturalWidth || 0;
    const mh = media.videoHeight || media.naturalHeight || 0;
    if (!mw || !mh) return;

    const x = cell.x * W, y = cell.y * H, w = cell.w * W, h = cell.h * H;
    const d = track.driftState;
    const p = track.params;
    const zoom = clamp(d.zoom.value, 0.9, 2.2);
    const scale = Math.max(w / mw, h / mh) * zoom;
    const dw = mw * scale, dh = mh * scale;
    const dx = x + w / 2 - dw / 2 + d.panX.value * w;
    const dy = y + h / 2 - dh / 2 + d.panY.value * h;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.globalAlpha = clamp(p.opacity + d.opacity.value, 0.05, 1);
    // a cell with nothing beneath it (the base tile of the frame) always
    // composites normally — most blend modes read as solid black or
    // no-op against the empty canvas, so they only matter once a second
    // layer (e.g. an inset panel) sits on top of one.
    ctx.globalCompositeOperation = isBase ? "source-over" : p.blend;
    const brightness = clamp(p.brightness + d.brightness.value, 0.15, 2.4);
    const hue = p.hue + d.hue.value;
    ctx.filter = `brightness(${brightness}) contrast(${p.contrast}) saturate(${p.saturation}) hue-rotate(${hue}deg) invert(${p.invert})`;

    const cx = dx + dw / 2, cy = dy + dh / 2;
    ctx.translate(cx, cy);
    ctx.scale(p.mirrorX ? -1 : 1, p.mirrorY ? -1 : 1);
    ctx.translate(-cx, -cy);

    try { ctx.drawImage(media, dx, dy, dw, dh); } catch (e) {}
    ctx.restore();
  }

  let glitchRoll = 0;
  function drawGlitchOverlay() {
    glitchRoll = (glitchRoll + 1.3) % 6;
    stageCtx.save();
    stageCtx.globalAlpha = 0.09;
    stageCtx.globalCompositeOperation = "overlay";
    const lineH = 3;
    for (let y = 0; y < H; y += lineH) {
      stageCtx.fillStyle = Math.floor((y + glitchRoll) / lineH) % 2 === 0 ? "#fff" : "#000";
      stageCtx.fillRect(0, y, W, 1);
    }
    stageCtx.restore();
  }

  function renderScene(nowMs) {
    sceneCtx.globalAlpha = 1;
    sceneCtx.globalCompositeOperation = "source-over";
    sceneCtx.filter = "none";
    sceneCtx.fillStyle = "#000";
    sceneCtx.fillRect(0, 0, W, H);

    cells.forEach((cell) => {
      const track = trackById(cell.trackId);
      if (!track || track.muted) return;
      drawTrackInCell(sceneCtx, track, cell, cell.z === 0);
    });

    if (transition.active) {
      const p = clamp((nowMs - transition.start) / transition.duration, 0, 1);
      sceneCtx.save();
      sceneCtx.globalAlpha = 1 - p;
      sceneCtx.globalCompositeOperation = "source-over";
      sceneCtx.filter = "none";
      sceneCtx.drawImage(transitionCanvas, 0, 0);
      sceneCtx.restore();
      if (p >= 1) transition.active = false;
    }

    stageCtx.clearRect(0, 0, W, H);
    stageCtx.filter = `hue-rotate(${globalHueParam}deg) saturate(${globalSatParam / 100})`;
    stageCtx.drawImage(sceneCanvas, 0, 0);
    stageCtx.filter = "none";

    if (darknessParam > 0) {
      stageCtx.fillStyle = `rgba(0,0,0,${darknessParam / 100})`;
      stageCtx.fillRect(0, 0, W, H);
    }
    if (glitchEnabled) drawGlitchOverlay();
  }

  // ---- transport -----------------------------------------------------------

  let running = false;
  let lastNow = 0;

  function frame(nowMs) {
    const dt = lastNow ? clamp((nowMs - lastNow) / 1000, 0, 0.2) : 0.016;
    lastNow = nowMs;
    if (running) {
      updateComplexity(nowMs, dt);
      scheduler(nowMs);
      tickDrift(dt);
    }
    renderScene(nowMs);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  playBtn.addEventListener("click", () => {
    running = !running;
    if (running) {
      if (!sessionStart) sessionStart = performance.now();
      tracks.forEach((t) => { if (t.kind === "video") t.el.play().catch(() => {}); });
      playBtn.textContent = "停止";
      playBtn.classList.add("playing");
      if (cells.length === 0) mutateStructure();
    } else {
      tracks.forEach((t) => { if (t.kind === "video") t.el.pause(); });
      playBtn.textContent = "再生";
      playBtn.classList.remove("playing");
    }
  });

  diceBtn.addEventListener("click", () => {
    tracks.forEach((t) => { if (!t.locked) randomizeTrack(t, 0.4 + complexity * 0.8); });
    if (availableTracks().length > 0) {
      mutateStructure();
      nextStructure = performance.now() / 1000 + rand(2, 4);
    }
  });

  // ---- recording / snapshot -------------------------------------------------

  let recorder = null;
  recBtn.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    if (typeof MediaRecorder === "undefined" || !stage.captureStream) {
      alert("このブラウザは録画に対応していません。");
      return;
    }
    const stream = stage.captureStream(30);
    let mime = "video/webm;codecs=vp9";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm";
    recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      downloadBlob(blob, `tsugihagi-${Date.now()}.webm`);
      recBtn.textContent = "⏺ 録画";
      recBtn.classList.remove("recording");
    };
    recorder.start();
    recBtn.textContent = "⏹ 停止して保存";
    recBtn.classList.add("recording");
  });

  snapBtn.addEventListener("click", () => {
    stage.toBlob((blob) => {
      if (blob) downloadBlob(blob, `tsugihagi-${Date.now()}.png`);
    }, "image/png");
  });

  updateEmptyStates();
})();
