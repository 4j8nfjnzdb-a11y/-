// kizami — phrase collage
//
// Load a handful of audio samples, chop each into short random slices,
// scatter those slices across a step grid per "lane", and let the whole
// thing loop. "new phrase" rerolls everything, "recut" keeps the rhythm
// but reslices the audio, "random replace" rerolls a few lanes only, and
// "undo phrase" steps back. A visual (image or muted video) gets torn
// into overlapping crops that flash in time with whichever lane just hit.
//
// Kept deliberately light: one-shot AudioBufferSourceNodes (no persistent
// synth voices), a static always-connected FX send chain (no reconnect
// clicks/GC churn), and a canvas loop that only runs while something is
// actually animating.

(() => {
  const STEPS = 64;
  const MAX_LANES = 16;
  const MAX_FLASHES = 24;
  const LOOKAHEAD = 0.12; // seconds scheduled ahead
  const TICK_MS = 25;
  const HISTORY_LIMIT = 8;

  // ---- dom -----------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const playBtn = $("playBtn");
  const newPhraseBtn = $("newPhraseBtn");
  const recutBtn = $("recutBtn");
  const randomReplaceBtn = $("randomReplaceBtn");
  const undoBtn = $("undoBtn");

  const bpmSlider = $("bpm"), bpmVal = $("bpmVal");
  const densitySlider = $("density"), densityVal = $("densityVal");
  const chaosSlider = $("chaos"), chaosVal = $("chaosVal");

  const fxTone = $("fxTone"), fxCrush = $("fxCrush"), fxDelay = $("fxDelay"), fxSpace = $("fxSpace");

  const addAudioBtn = $("addAudioBtn"), audioFileInput = $("audioFileInput");
  const loadDemoBtn = $("loadDemoBtn"), clearAudioBtn = $("clearAudioBtn");
  const addVisualBtn = $("addVisualBtn"), visualFileInput = $("visualFileInput");
  const clearVisualBtn = $("clearVisualBtn");

  const libraryList = $("libraryList"), libraryCount = $("libraryCount");
  const randomEightBtn = $("randomEightBtn"), clearSelectionBtn = $("clearSelectionBtn");
  const replaceLanesBtn = $("replaceLanesBtn"), addLanesBtn = $("addLanesBtn");

  const lanesList = $("lanesList"), lanesCount = $("lanesCount"), hideLanesBtn = $("hideLanesBtn");
  const statusEl = $("status");

  const canvas = $("visual");
  const vctx = canvas.getContext("2d");

  // ---- state -----------------------------------------------------------

  let audioCtx = null;
  let masterGain, compressor, filterNode, splitGain;
  let crushShaper, crushReturn, delayNode, delayFeedback, delayReturn, convolver, reverbReturn;

  const samples = []; // {id, name, buffer, selected}
  const lanes = [];   // {id, sampleId, muted, solo, hue}
  const patterns = new Map(); // laneId -> Array(STEPS) of hit|null
  const history = [];

  let sampleUid = 0, laneUid = 0;

  let playing = false;
  let schedulerTimer = null;
  let currentStep = 0;
  let nextStepTime = 0;

  let visualSource = null; // HTMLCanvasElement | HTMLImageElement | HTMLVideoElement
  let visualObjectUrl = null;
  let flashes = [];
  let visualLoopRunning = false;

  // ---- helpers -----------------------------------------------------------

  function laneById(id) { return lanes.find((l) => l.id === id); }
  function sampleById(id) { return samples.find((s) => s.id === id); }

  function bpm() { return +bpmSlider.value; }
  function stepDuration() { return 60 / bpm() / 4; } // 16th notes
  function density() { return +densitySlider.value / 100; }
  function chaos() { return +chaosSlider.value / 100; }

  // ---- audio graph -----------------------------------------------------

  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 4;
    masterGain.connect(compressor).connect(audioCtx.destination);

    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = "lowpass";
    filterNode.frequency.value = 18000;
    filterNode.Q.value = 0.3;

    splitGain = audioCtx.createGain();
    splitGain.gain.value = 1;
    filterNode.connect(splitGain);
    splitGain.connect(masterGain); // always-on dry/filtered path

    // crush: cheap waveshaper drive, no ScriptProcessor needed
    crushShaper = audioCtx.createWaveShaper();
    crushShaper.curve = makeCrushCurve(0);
    crushShaper.oversample = "2x";
    crushReturn = audioCtx.createGain();
    crushReturn.gain.value = 0;
    splitGain.connect(crushShaper).connect(crushReturn).connect(masterGain);

    // delay send
    delayNode = audioCtx.createDelay(1.2);
    delayNode.delayTime.value = 0.28;
    delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.32;
    delayNode.connect(delayFeedback).connect(delayNode);
    delayReturn = audioCtx.createGain();
    delayReturn.gain.value = 0;
    splitGain.connect(delayNode);
    delayNode.connect(delayReturn).connect(masterGain);

    // reverb send
    convolver = audioCtx.createConvolver();
    convolver.buffer = buildImpulse(audioCtx, 1.6, 2.6);
    reverbReturn = audioCtx.createGain();
    reverbReturn.gain.value = 0;
    splitGain.connect(convolver).connect(reverbReturn).connect(masterGain);

    applyFxParams();
  }

  function buildImpulse(ctx, duration, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const buf = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buf;
  }

  function makeCrushCurve(amount) {
    // amount 0..1 -> quantization steps from ~64 down to ~4
    const steps = Math.max(4, Math.round(64 - amount * 60));
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  }

  let lastCrushAmount = -1;
  function applyFxParams() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const tone = +fxTone.value / 100;
    filterNode.frequency.setTargetAtTime(400 + tone * tone * 17000, now, 0.03);

    const crushAmt = +fxCrush.value / 100;
    crushReturn.gain.setTargetAtTime(crushAmt * 0.8, now, 0.03);
    if (Math.abs(crushAmt - lastCrushAmount) > 0.03) {
      crushShaper.curve = makeCrushCurve(crushAmt);
      lastCrushAmount = crushAmt;
    }

    delayReturn.gain.setTargetAtTime((+fxDelay.value / 100) * 0.55, now, 0.03);
    reverbReturn.gain.setTargetAtTime((+fxSpace.value / 100) * 0.7, now, 0.03);
  }

  [fxTone, fxCrush, fxDelay, fxSpace].forEach((el) => el.addEventListener("input", applyFxParams));

  // ---- sample loading -----------------------------------------------------

  async function decodeFiles(files) {
    ensureAudio();
    for (const file of files) {
      try {
        const arrayBuf = await file.arrayBuffer();
        const buffer = await audioCtx.decodeAudioData(arrayBuf);
        samples.push({ id: ++sampleUid, name: file.name, buffer, selected: true });
      } catch (e) {
        console.warn("decode failed", file.name, e);
      }
    }
    renderLibrary();
  }

  function synthBuffer(kind, seed) {
    ensureAudio();
    const rate = audioCtx.sampleRate;
    const dur = kind === "click" ? 0.08 : 0.3 + seed * 0.5;
    const len = Math.floor(rate * dur);
    const buf = audioCtx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    const freq = 110 * Math.pow(2, Math.floor(seed * 12) / 12);
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.exp(-t * (kind === "click" ? 60 : 6 + seed * 6));
      let v = 0;
      if (kind === "pluck") v = Math.sin(2 * Math.PI * freq * t) * 0.8 + Math.sin(2 * Math.PI * freq * 2.01 * t) * 0.2;
      else if (kind === "tone") v = Math.sin(2 * Math.PI * freq * 1.5 * t);
      else if (kind === "noise") v = Math.random() * 2 - 1;
      else if (kind === "click") v = (Math.random() * 2 - 1) * Math.exp(-t * 400);
      else v = Math.sin(2 * Math.PI * (freq + t * 400) * t); // sweep
      d[i] = v * env;
    }
    return buf;
  }

  function loadDemoKit() {
    ensureAudio();
    const kinds = ["pluck", "tone", "noise", "click", "sweep", "pluck", "tone", "noise"];
    kinds.forEach((kind, i) => {
      const buffer = synthBuffer(kind, (i + 1) / kinds.length);
      samples.push({ id: ++sampleUid, name: `demo_${kind}_${i + 1}.wav`, buffer, selected: true });
    });
    renderLibrary();
  }

  function clearAudio() {
    samples.length = 0;
    lanes.length = 0;
    patterns.clear();
    history.length = 0;
    renderLibrary();
    renderLanes();
    updateStatus();
  }

  // ---- visual loading -----------------------------------------------------

  function defaultVisual() {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 512;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, "#0ea5b0");
    grad.addColorStop(0.5, "#173b3f");
    grad.addColorStop(1, "#f4f2ec");
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.05})`;
      const r = 10 + Math.random() * 120;
      g.beginPath();
      g.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  function setVisualFile(file) {
    if (visualObjectUrl) URL.revokeObjectURL(visualObjectUrl);
    visualObjectUrl = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = visualObjectUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(() => {});
      visualSource = video;
    } else {
      const img = new Image();
      img.onload = () => { visualSource = img; };
      img.src = visualObjectUrl;
    }
  }

  function clearVisual() {
    if (visualObjectUrl) { URL.revokeObjectURL(visualObjectUrl); visualObjectUrl = null; }
    visualSource = defaultVisual();
  }

  // ---- pattern generation -----------------------------------------------------

  function randomHit() {
    return {
      offset: Math.random() * 0.75,
      len: 0.04 + Math.random() * (0.08 + chaos() * 0.4),
      rate: 1 + (Math.random() * 2 - 1) * (0.05 + chaos() * 0.35),
      gain: 0.55 + Math.random() * 0.4,
      pan: (Math.random() * 2 - 1) * 0.8,
    };
  }

  function generateLanePattern() {
    const pat = new Array(STEPS).fill(null);
    const p = density();
    for (let i = 0; i < STEPS; i++) {
      if (Math.random() < p) pat[i] = randomHit();
    }
    return pat;
  }

  function snapshotPatterns() {
    const snap = new Map();
    patterns.forEach((pat, id) => snap.set(id, pat.map((h) => (h ? { ...h } : null))));
    return snap;
  }

  function pushHistory() {
    history.push(snapshotPatterns());
    if (history.length > HISTORY_LIMIT) history.shift();
  }

  function newPhrase() {
    if (!lanes.length) return;
    pushHistory();
    lanes.forEach((lane) => patterns.set(lane.id, generateLanePattern()));
  }

  function recut() {
    if (!lanes.length) return;
    pushHistory();
    lanes.forEach((lane) => {
      const pat = patterns.get(lane.id) || generateLanePattern();
      patterns.set(lane.id, pat.map((h) => (h ? randomHit() : null)));
    });
  }

  function randomReplace() {
    if (!lanes.length) return;
    pushHistory();
    const count = Math.max(1, Math.round(lanes.length * 0.3));
    const pool = lanes.slice();
    for (let i = 0; i < count && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const lane = pool.splice(idx, 1)[0];
      patterns.set(lane.id, generateLanePattern());
    }
  }

  function undoPhrase() {
    const snap = history.pop();
    if (!snap) return;
    patterns.clear();
    snap.forEach((pat, id) => patterns.set(id, pat));
  }

  // ---- lanes -----------------------------------------------------------

  function addLanesFromSelection(replace) {
    ensureAudio();
    const selected = samples.filter((s) => s.selected);
    if (!selected.length) return;
    if (replace) { lanes.length = 0; patterns.clear(); }
    for (const s of selected) {
      if (lanes.length >= MAX_LANES) break;
      if (lanes.some((l) => l.sampleId === s.id)) continue;
      const lane = { id: ++laneUid, sampleId: s.id, muted: false, solo: false, hue: Math.random() * 360 };
      lanes.push(lane);
      patterns.set(lane.id, generateLanePattern());
    }
    renderLanes();
    updateStatus();
  }

  function randomEight() {
    if (!samples.length) return;
    samples.forEach((s) => (s.selected = false));
    const pool = samples.slice();
    const n = Math.min(8, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      pool.splice(idx, 1)[0].selected = true;
    }
    renderLibrary();
  }

  // ---- scheduler -----------------------------------------------------

  function playHit(lane, hit, time) {
    const sample = sampleById(lane.sampleId);
    if (!sample) return;
    const src = audioCtx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = hit.rate;

    const g = audioCtx.createGain();
    const dur = Math.min(hit.len, Math.max(0.02, sample.buffer.duration - hit.offset * sample.buffer.duration - 0.01));
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(hit.gain, time + 0.005);
    g.gain.setValueAtTime(hit.gain, Math.max(time + 0.006, time + dur - 0.02));
    g.gain.linearRampToValueAtTime(0, time + dur);

    const pan = audioCtx.createStereoPanner();
    pan.pan.value = hit.pan;

    src.connect(g).connect(pan).connect(filterNode);
    src.start(time, hit.offset * sample.buffer.duration, dur + 0.02);
    src.stop(time + dur + 0.05);

    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => spawnFlash(lane, hit), delayMs);
    setTimeout(() => flashLaneRow(lane.id), delayMs);
  }

  function scheduleStep(step, time) {
    const anySolo = lanes.some((l) => l.solo);
    lanes.forEach((lane) => {
      const audible = anySolo ? lane.solo : !lane.muted;
      if (!audible) return;
      const pat = patterns.get(lane.id);
      const hit = pat && pat[step];
      if (hit) playHit(lane, hit, time);
    });
    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => { if (playing) updateStatus(step); }, delayMs);
  }

  function schedulerLoop() {
    if (!playing) return;
    while (nextStepTime < audioCtx.currentTime + LOOKAHEAD) {
      scheduleStep(currentStep, nextStepTime);
      nextStepTime += stepDuration();
      currentStep = (currentStep + 1) % STEPS;
    }
    schedulerTimer = setTimeout(schedulerLoop, TICK_MS);
  }

  function start() {
    ensureAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (!lanes.length && samples.length) addLanesFromSelection(true);
    if (!lanes.length) {
      statusEl.textContent = "add audio か load demo kit で音源を読み込んでください";
      return;
    }
    playing = true;
    currentStep = 0;
    nextStepTime = audioCtx.currentTime + 0.05;
    schedulerLoop();
    ensureVisualLoop();
    playBtn.textContent = "停止";
    playBtn.classList.add("playing");
  }

  function stop() {
    playing = false;
    clearTimeout(schedulerTimer);
    playBtn.textContent = "再生";
    playBtn.classList.remove("playing");
    updateStatus(null);
  }

  // ---- visual (flash collage) -----------------------------------------------------

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }
  window.addEventListener("resize", resizeCanvas);

  function spawnFlash(lane, hit) {
    if (flashes.length >= MAX_FLASHES) flashes.shift();
    const w = 0.28 + Math.random() * 0.42;
    const h = 0.28 + Math.random() * 0.42;
    flashes.push({
      hue: lane.hue,
      x: Math.random(),
      y: Math.random(),
      w, h,
      sx: Math.random(),
      sy: Math.random(),
      born: performance.now(),
      life: Math.max(160, hit.len * 1000 * 4),
    });
    ensureVisualLoop();
  }

  function sourceDims(src) {
    if (src instanceof HTMLVideoElement) return [src.videoWidth || 1, src.videoHeight || 1];
    return [src.width || 1, src.height || 1];
  }

  function drawVisualFrame() {
    const w = canvas.width, h = canvas.height;
    if (w === 0 || h === 0) { visualLoopRunning = false; return; }

    vctx.fillStyle = "rgba(244, 242, 236, 0.14)";
    vctx.fillRect(0, 0, w, h);

    const now = performance.now();
    flashes = flashes.filter((f) => now - f.born < f.life);

    if (visualSource && flashes.length) {
      const [sw0, sh0] = sourceDims(visualSource);
      vctx.globalCompositeOperation = "lighten";
      for (const f of flashes) {
        const t = (now - f.born) / f.life;
        const alpha = Math.max(0, 1 - t) * 0.6;
        if (alpha <= 0) continue;
        vctx.globalAlpha = alpha;
        vctx.filter = `hue-rotate(${f.hue}deg) saturate(1.4)`;
        const sw = sw0 * f.w, sh = sh0 * f.h;
        const sx = f.sx * Math.max(0, sw0 - sw);
        const sy = f.sy * Math.max(0, sh0 - sh);
        const dw = f.w * w, dh = f.h * h;
        const dx = f.x * (w - dw), dy = f.y * (h - dh);
        try { vctx.drawImage(visualSource, sx, sy, sw, sh, dx, dy, dw, dh); } catch (e) {}
      }
      vctx.filter = "none";
      vctx.globalAlpha = 1;
      vctx.globalCompositeOperation = "source-over";
    }

    if (playing || flashes.length) {
      requestAnimationFrame(drawVisualFrame);
    } else {
      visualLoopRunning = false;
    }
  }

  function ensureVisualLoop() {
    if (visualLoopRunning) return;
    visualLoopRunning = true;
    requestAnimationFrame(drawVisualFrame);
  }

  // ---- ui rendering -----------------------------------------------------

  function renderLibrary() {
    libraryCount.textContent = `${samples.length} files`;
    libraryList.innerHTML = "";
    samples.forEach((s) => {
      const row = document.createElement("label");
      row.className = "libItem";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = s.selected;
      cb.addEventListener("change", () => { s.selected = cb.checked; });
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = s.name;
      const dur = document.createElement("span");
      dur.className = "dur";
      dur.textContent = `${s.buffer.duration.toFixed(2)}s`;
      row.append(cb, name, dur);
      libraryList.appendChild(row);
    });
  }

  function renderLanes() {
    lanesCount.textContent = `lanes ${lanes.length}/${MAX_LANES}`;
    lanesList.innerHTML = "";
    lanes.forEach((lane) => {
      const s = sampleById(lane.sampleId);
      const row = document.createElement("div");
      row.className = "laneRow";
      row.dataset.laneId = lane.id;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = s ? s.name : "?";
      const mute = document.createElement("button");
      mute.className = "laneToggle" + (lane.muted ? " on" : "");
      mute.textContent = "m";
      mute.addEventListener("click", () => { lane.muted = !lane.muted; mute.classList.toggle("on", lane.muted); });
      const solo = document.createElement("button");
      solo.className = "laneToggle" + (lane.solo ? " on" : "");
      solo.textContent = "s";
      solo.addEventListener("click", () => { lane.solo = !lane.solo; solo.classList.toggle("on", lane.solo); });
      row.append(name, mute, solo);
      lanesList.appendChild(row);
    });
  }

  function flashLaneRow(laneId) {
    const row = lanesList.querySelector(`[data-lane-id="${laneId}"]`);
    if (!row) return;
    row.classList.add("hit");
    setTimeout(() => row.classList.remove("hit"), 140);
  }

  function updateStatus(step) {
    const pos = step == null ? "—" : (step + 1);
    statusEl.textContent = `sources: ${samples.length} · lanes ${lanes.length}/${MAX_LANES} · position ${pos} / ${STEPS} · bpm ${bpm()}`;
  }

  // ---- wiring -----------------------------------------------------

  playBtn.addEventListener("click", () => { playing ? stop() : start(); });
  newPhraseBtn.addEventListener("click", newPhrase);
  recutBtn.addEventListener("click", recut);
  randomReplaceBtn.addEventListener("click", randomReplace);
  undoBtn.addEventListener("click", undoPhrase);

  bpmSlider.addEventListener("input", () => { bpmVal.textContent = bpmSlider.value; updateStatus(); });
  densitySlider.addEventListener("input", () => { densityVal.textContent = densitySlider.value; });
  chaosSlider.addEventListener("input", () => { chaosVal.textContent = chaosSlider.value; });

  addAudioBtn.addEventListener("click", () => audioFileInput.click());
  audioFileInput.addEventListener("change", (e) => { decodeFiles(Array.from(e.target.files)); e.target.value = ""; });
  loadDemoBtn.addEventListener("click", loadDemoKit);
  clearAudioBtn.addEventListener("click", clearAudio);

  addVisualBtn.addEventListener("click", () => visualFileInput.click());
  visualFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) setVisualFile(file);
    e.target.value = "";
  });
  clearVisualBtn.addEventListener("click", clearVisual);

  randomEightBtn.addEventListener("click", randomEight);
  clearSelectionBtn.addEventListener("click", () => { samples.forEach((s) => (s.selected = false)); renderLibrary(); });
  replaceLanesBtn.addEventListener("click", () => addLanesFromSelection(true));
  addLanesBtn.addEventListener("click", () => addLanesFromSelection(false));

  hideLanesBtn.addEventListener("click", () => {
    const hidden = lanesList.classList.toggle("hidden");
    hideLanesBtn.textContent = hidden ? "show lanes" : "hide lanes";
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      playing ? stop() : start();
    }
  });

  // ---- init -----------------------------------------------------

  visualSource = defaultVisual();
  resizeCanvas();
  ensureVisualLoop();
  updateStatus();
})();
