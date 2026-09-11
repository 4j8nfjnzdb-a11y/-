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
  const MAX_SAMPLES = 30; // caps decoded-PCM memory from repeated "add audio"
  const MAX_VISUALS = 6;  // videos especially are expensive to keep decoding
  const MAX_VOICES = 40;  // hard ceiling on overlapping one-shot voices
  const VISUAL_MAX_DIM = 1024; // photos get downscaled to this on load

  // ---- dom -----------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const playBtn = $("playBtn");
  const newPhraseBtn = $("newPhraseBtn");
  const recutBtn = $("recutBtn");
  const randomReplaceBtn = $("randomReplaceBtn");
  const randomMuteBtn = $("randomMuteBtn");
  const undoBtn = $("undoBtn");
  const recordBtn = $("recordBtn");

  const bpmSlider = $("bpm"), bpmVal = $("bpmVal");
  const densitySlider = $("density"), densityVal = $("densityVal");
  const chaosSlider = $("chaos"), chaosVal = $("chaosVal");

  const fxTone = $("fxTone"), fxCrush = $("fxCrush"), fxDelay = $("fxDelay"), fxSpace = $("fxSpace");

  const addAudioBtn = $("addAudioBtn"), audioFileInput = $("audioFileInput");
  const loadDemoBtn = $("loadDemoBtn"), clearAudioBtn = $("clearAudioBtn");
  const addVisualBtn = $("addVisualBtn"), visualFileInput = $("visualFileInput");
  const clearVisualBtn = $("clearVisualBtn");
  const visualList = $("visualList"), visualCount = $("visualCount");

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
  let mediaDest = null;

  let mediaRecorder = null;
  let recordedChunks = [];
  let recording = false;
  let recordSafetyTimer = null;
  const MAX_RECORD_MS = 5 * 60 * 1000;

  const samples = []; // {id, name, buffer, selected}
  const lanes = [];   // {id, sampleId, muted, solo, hue}
  const patterns = new Map(); // laneId -> Array(STEPS) of hit|null
  const history = [];

  let sampleUid = 0, laneUid = 0, visualUid = 0;

  let playing = false;
  let schedulerTimer = null;
  let currentStep = 0;
  let nextStepTime = 0;

  const visuals = []; // {id, name, kind, el, objectUrl}
  let fallbackVisual = null; // HTMLCanvasElement, used when no visuals are loaded
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

    mediaDest = audioCtx.createMediaStreamDestination();
    compressor.connect(mediaDest); // parallel tap for recording; doesn't touch the audible path

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

  // ---- recording (record → WAV download) ------------------------------

  function pickRecorderMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "";
  }

  function encodeWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const len = buffer.length;
    const sampleRate = buffer.sampleRate;
    const bytes = new ArrayBuffer(44 + len * numCh * 2);
    const view = new DataView(bytes);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + len * numCh * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numCh * 2, true);
    view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, len * numCh * 2, true);

    const channels = [];
    for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
    let offset = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([bytes], { type: "audio/wav" });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  async function finishRecording() {
    const chunks = recordedChunks;
    recordedChunks = [];
    if (!chunks.length) return;
    recordBtn.textContent = "書き出し中…";
    try {
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const arrayBuf = await blob.arrayBuffer();
      const buffer = await audioCtx.decodeAudioData(arrayBuf);
      downloadBlob(encodeWav(buffer), `kizami_${timestamp()}.wav`);
    } catch (e) {
      console.warn("recording export failed", e);
      statusEl.textContent = "録音の書き出しに失敗しました";
    }
    recordBtn.textContent = "● 録音";
    recordBtn.classList.remove("recording");
  }

  function startRecording() {
    ensureAudio();
    if (!window.MediaRecorder) {
      statusEl.textContent = "このブラウザは録音に対応していません";
      return;
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    const mimeType = pickRecorderMime();
    mediaRecorder = mimeType ? new MediaRecorder(mediaDest.stream, { mimeType }) : new MediaRecorder(mediaDest.stream);
    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordedChunks.push(e.data); };
    mediaRecorder.onstop = finishRecording;
    mediaRecorder.start();
    recording = true;
    recordBtn.textContent = "■ 停止して書き出し";
    recordBtn.classList.add("recording");
    if (!playing) start();
    recordSafetyTimer = setTimeout(stopRecording, MAX_RECORD_MS);
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    clearTimeout(recordSafetyTimer);
    mediaRecorder.stop();
  }

  // ---- sample loading -----------------------------------------------------

  async function decodeFiles(files) {
    ensureAudio();
    for (const file of files) {
      if (samples.length >= MAX_SAMPLES) {
        statusEl.textContent = `音源は最大${MAX_SAMPLES}個まで(メモリ保護のため)。不要なものを削除してください`;
        break;
      }
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

  function removeSample(id) {
    const idx = samples.findIndex((s) => s.id === id);
    if (idx === -1) return;
    samples.splice(idx, 1);
    lanes.filter((l) => l.sampleId === id).forEach((l) => patterns.delete(l.id));
    for (let i = lanes.length - 1; i >= 0; i--) {
      if (lanes[i].sampleId === id) lanes.splice(i, 1);
    }
    renderLibrary();
    renderLanes();
    updateStatus();
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

  // large phone-camera photos decode to huge in-memory bitmaps (a 12MP
  // photo is ~50MB uncompressed); downscaling to a canvas up front keeps
  // several loaded photos from adding up to real crash-risk memory
  function downscaleImage(img) {
    const scale = Math.min(1, VISUAL_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return img;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function loadVisualFiles(files) {
    for (const file of files) {
      if (visuals.length >= MAX_VISUALS) {
        statusEl.textContent = `写真/動画は最大${MAX_VISUALS}個まで(メモリ保護のため)。不要なものを削除してください`;
        break;
      }
      const objectUrl = URL.createObjectURL(file);
      const isVideo = file.type.startsWith("video/");
      const entry = { id: ++visualUid, name: file.name, kind: isVideo ? "video" : "image", el: null, objectUrl };
      if (isVideo) {
        const video = document.createElement("video");
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.src = objectUrl;
        video.play().catch(() => {});
        entry.el = video;
      } else {
        const img = new Image();
        img.onload = () => { entry.el = downscaleImage(img); };
        img.src = objectUrl;
      }
      visuals.push(entry);
    }
    renderVisualList();
  }

  function removeVisual(id) {
    const idx = visuals.findIndex((v) => v.id === id);
    if (idx === -1) return;
    URL.revokeObjectURL(visuals[idx].objectUrl);
    visuals.splice(idx, 1);
    renderVisualList();
  }

  function clearVisuals() {
    visuals.forEach((v) => URL.revokeObjectURL(v.objectUrl));
    visuals.length = 0;
    renderVisualList();
  }

  function renderVisualList() {
    visualCount.textContent = `${visuals.length}/${MAX_VISUALS} visuals`;
    visualList.innerHTML = "";
    visuals.forEach((v) => {
      const row = document.createElement("div");
      row.className = "visItem";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = v.name;
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => removeVisual(v.id));
      row.append(name, remove);
      visualList.appendChild(row);
    });
  }

  // resolves which visual element a hit should draw from, falling back to
  // the generated gradient when nothing (or the assigned index) is loaded
  function resolveVisual(visIndex) {
    if (visIndex >= 0 && visIndex < visuals.length) return visuals[visIndex].el;
    return fallbackVisual;
  }

  // ---- pattern generation -----------------------------------------------------

  // slice length/position: "auto" (dice) keeps re-rolling a fresh cut on
  // every hit; otherwise the lane's own len/pos sliders decide, live, so
  // dragging them (or the per-lane reroll button) is heard immediately
  // without needing to regenerate the phrase
  function computeSlice(lane) {
    if (lane.autoRoll) {
      return { offset: Math.random() * 0.75, len: 0.03 + Math.random() * 0.5 };
    }
    return { offset: lane.posRatio * 0.85, len: 0.03 + lane.lenRatio * 0.7 };
  }

  function rerollSlice(lane) {
    lane.posRatio = Math.random() * 0.85;
    lane.lenRatio = Math.random();
  }

  function randomHit() {
    const vw = 0.28 + Math.random() * 0.42;
    const vh = 0.28 + Math.random() * 0.42;
    return {
      rate: 1 + (Math.random() * 2 - 1) * (0.05 + chaos() * 0.35),
      gain: 0.55 + Math.random() * 0.4,
      pan: (Math.random() * 2 - 1) * 0.8,
      // visual chop: which loaded photo/video, which crop of it, and where
      // it lands on the stage — regenerated together with the audio slice
      // by new phrase / recut / random replace, and restored by undo
      visIndex: visuals.length ? Math.floor(Math.random() * visuals.length) : -1,
      vsx: Math.random(),
      vsy: Math.random(),
      vw, vh,
      vx: Math.random(),
      vy: Math.random(),
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
    history.push({
      patterns: snapshotPatterns(),
      muted: new Map(lanes.map((l) => [l.id, l.muted])),
    });
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

  // "replace2": rather than reslicing audio, randomly silences a chunk of
  // lanes so the phrase gets actual blank/silent space between the parts
  // that still play
  function randomMute() {
    if (!lanes.length) return;
    pushHistory();
    const muteFraction = 0.25 + Math.random() * 0.4;
    lanes.forEach((lane) => { lane.muted = Math.random() < muteFraction; });
    if (lanes.every((l) => l.muted)) {
      lanes[Math.floor(Math.random() * lanes.length)].muted = false;
    }
    renderLanes();
  }

  function undoPhrase() {
    const snap = history.pop();
    if (!snap) return;
    patterns.clear();
    snap.patterns.forEach((pat, id) => patterns.set(id, pat));
    lanes.forEach((lane) => {
      if (snap.muted.has(lane.id)) lane.muted = snap.muted.get(lane.id);
    });
    renderLanes();
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
      const lane = {
        id: ++laneUid, sampleId: s.id, muted: false, solo: false, hue: Math.random() * 360,
        autoRoll: true, lenRatio: 0.2 + Math.random() * 0.3, posRatio: Math.random() * 0.6,
      };
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

  let activeVoices = 0;

  function playHit(lane, hit, time) {
    // hard ceiling: cranking bpm/density/lane-count way up can otherwise
    // pile up overlapping voices faster than the browser reclaims them,
    // which is what eventually crashes the tab — so just drop the hit
    if (activeVoices >= MAX_VOICES) return;
    const sample = sampleById(lane.sampleId);
    if (!sample) return;
    const slice = computeSlice(lane);
    const src = audioCtx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = hit.rate;

    const g = audioCtx.createGain();
    const dur = Math.min(slice.len, Math.max(0.02, sample.buffer.duration - slice.offset * sample.buffer.duration - 0.01));
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(hit.gain, time + 0.005);
    g.gain.setValueAtTime(hit.gain, Math.max(time + 0.006, time + dur - 0.02));
    g.gain.linearRampToValueAtTime(0, time + dur);

    const pan = audioCtx.createStereoPanner();
    pan.pan.value = hit.pan;

    src.connect(g).connect(pan).connect(filterNode);
    src.start(time, slice.offset * sample.buffer.duration, dur + 0.02);
    src.stop(time + dur + 0.05);

    activeVoices++;
    src.onended = () => {
      activeVoices--;
      // Safari in particular is slow to reclaim Web Audio nodes on its
      // own; disconnecting explicitly once the voice is done keeps node
      // count from creeping up over a long play session
      try { src.disconnect(); g.disconnect(); pan.disconnect(); } catch (e) {}
    };

    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => spawnFlash(lane, hit, dur), delayMs);
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

  function spawnFlash(lane, hit, dur) {
    const source = resolveVisual(hit.visIndex);
    if (!source) return;
    if (flashes.length >= MAX_FLASHES) flashes.shift();
    flashes.push({
      source,
      hue: lane.hue,
      x: hit.vx, y: hit.vy,
      w: hit.vw, h: hit.vh,
      sx: hit.vsx, sy: hit.vsy,
      born: performance.now(),
      life: Math.max(220, dur * 1000 * 5),
    });
    ensureVisualLoop();
  }

  function sourceDims(src) {
    if (src instanceof HTMLVideoElement) return [src.videoWidth || 1, src.videoHeight || 1];
    return [src.width || 1, src.height || 1];
  }

  function sourceReady(src) {
    if (src instanceof HTMLVideoElement) return src.readyState >= 2;
    if (src instanceof HTMLImageElement) return src.complete && src.naturalWidth > 0;
    return true; // canvas fallback
  }

  function drawVisualFrame() {
    const w = canvas.width, h = canvas.height;
    if (w === 0 || h === 0) { visualLoopRunning = false; return; }

    vctx.fillStyle = "rgba(244, 242, 236, 0.16)";
    vctx.fillRect(0, 0, w, h);

    const now = performance.now();
    flashes = flashes.filter((f) => now - f.born < f.life);

    // plain alpha compositing so real photos/video show their true colors —
    // the earlier "lighten" blend hid anything but the brightest pixels
    for (const f of flashes) {
      if (!sourceReady(f.source)) continue;
      const t = (now - f.born) / f.life;
      const alpha = Math.max(0, 1 - t) * 0.72;
      if (alpha <= 0) continue;

      const [sw0, sh0] = sourceDims(f.source);
      const sw = sw0 * f.w, sh = sh0 * f.h;
      const sx = f.sx * Math.max(0, sw0 - sw);
      const sy = f.sy * Math.max(0, sh0 - sh);
      const dw = f.w * w, dh = f.h * h;
      const dx = f.x * (w - dw), dy = f.y * (h - dh);

      vctx.globalAlpha = alpha;
      try { vctx.drawImage(f.source, sx, sy, sw, sh, dx, dy, dw, dh); } catch (e) {}

      vctx.globalAlpha = alpha * 0.5;
      vctx.strokeStyle = `hsl(${f.hue}, 70%, 55%)`;
      vctx.lineWidth = Math.max(1, w / 300);
      vctx.strokeRect(dx, dy, dw, dh);
    }
    vctx.globalAlpha = 1;

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
    libraryCount.textContent = `${samples.length}/${MAX_SAMPLES} files`;
    libraryList.innerHTML = "";
    samples.forEach((s) => {
      const row = document.createElement("div");
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
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "×";
      remove.title = "この音源を削除(メモリ解放)";
      remove.addEventListener("click", () => removeSample(s.id));
      row.append(cb, name, dur, remove);
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

      const top = document.createElement("div");
      top.className = "laneTop";
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
      const auto = document.createElement("button");
      auto.className = "laneToggle dice" + (lane.autoRoll ? " on" : "");
      auto.textContent = "🎲";
      auto.title = "auto: 鳴るたびに長さ・位置を変え続ける";
      top.append(name, auto, mute, solo);

      const cut = document.createElement("div");
      cut.className = "laneCut";
      const lenSlider = document.createElement("input");
      lenSlider.type = "range"; lenSlider.min = 0; lenSlider.max = 100;
      lenSlider.value = Math.round(lane.lenRatio * 100);
      lenSlider.title = "length";
      lenSlider.addEventListener("input", () => { lane.lenRatio = +lenSlider.value / 100; });
      const posSlider = document.createElement("input");
      posSlider.type = "range"; posSlider.min = 0; posSlider.max = 100;
      posSlider.value = Math.round(lane.posRatio * 100);
      posSlider.title = "position";
      posSlider.addEventListener("input", () => { lane.posRatio = +posSlider.value / 100; });
      const reroll = document.createElement("button");
      reroll.className = "laneToggle";
      reroll.textContent = "↻";
      reroll.title = "この音の長さ・位置を一回だけ変える";
      reroll.addEventListener("click", () => {
        rerollSlice(lane);
        lenSlider.value = Math.round(lane.lenRatio * 100);
        posSlider.value = Math.round(lane.posRatio * 100);
      });

      function syncCutDisabled() {
        cut.classList.toggle("disabled", lane.autoRoll);
      }
      auto.addEventListener("click", () => {
        lane.autoRoll = !lane.autoRoll;
        auto.classList.toggle("on", lane.autoRoll);
        if (!lane.autoRoll) rerollSlice(lane); // fresh, sensible starting point
        lenSlider.value = Math.round(lane.lenRatio * 100);
        posSlider.value = Math.round(lane.posRatio * 100);
        syncCutDisabled();
      });
      syncCutDisabled();

      cut.append(lenSlider, posSlider, reroll);
      row.append(top, cut);
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
  randomMuteBtn.addEventListener("click", randomMute);
  undoBtn.addEventListener("click", undoPhrase);
  recordBtn.addEventListener("click", () => { recording ? stopRecording() : startRecording(); });

  bpmSlider.addEventListener("input", () => { bpmVal.textContent = bpmSlider.value; updateStatus(); });
  densitySlider.addEventListener("input", () => { densityVal.textContent = densitySlider.value; });
  chaosSlider.addEventListener("input", () => { chaosVal.textContent = chaosSlider.value; });

  addAudioBtn.addEventListener("click", () => audioFileInput.click());
  audioFileInput.addEventListener("change", (e) => { decodeFiles(Array.from(e.target.files)); e.target.value = ""; });
  loadDemoBtn.addEventListener("click", loadDemoKit);
  clearAudioBtn.addEventListener("click", clearAudio);

  addVisualBtn.addEventListener("click", () => visualFileInput.click());
  visualFileInput.addEventListener("change", (e) => {
    loadVisualFiles(Array.from(e.target.files));
    e.target.value = "";
  });
  clearVisualBtn.addEventListener("click", clearVisuals);

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

  fallbackVisual = defaultVisual();
  renderVisualList();
  renderLibrary();
  resizeCanvas();
  ensureVisualLoop();
  updateStatus();
})();
