"use strict";

/* ---------- Audio engine setup ---------- */

let audioCtx = null;
let masterGain = null;
let exportDest = null;
let mediaRecorderExport = null;
let exportChunks = [];

let audioBuffer = null; // decoded AudioBuffer ("the tape")
let isPlaying = false;
let schedulerTimer = null;
let scanEnabled = false;
let scanPosition = 0; // 0..1, used when scanEnabled
const SCAN_SWEEP_SECONDS = 24; // full sweep across the buffer

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.15;

function ensureAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(audioCtx.destination);
  exportDest = audioCtx.createMediaStreamDestination();
  masterGain.connect(exportDest);
  document.getElementById("engineStatus").textContent =
    "Web Audio: " + audioCtx.sampleRate + "Hz";
}

/* ---------- Cursor (playhead) model ---------- */

function defaultCursorParams() {
  return {
    enabled: true,
    position: 0.5, // 0..1 within buffer
    duration: 80, // ms
    mix: 0.8, // 0..1 output level
    fade: 0.5, // 0..1 fraction of grain used for attack+release
    spread: 0.1, // 0..1 random position jitter (fraction of buffer)
    slant: 0, // -1..1 attack/release balance
    gain: 1, // 0..1.5 extra gain
    ease: 0.3, // 0..1 curve shape
    declick: 0.4, // 0..1 minimum ramp floor
    density: 0.6, // 0..1 grain overlap amount
    nextGrainTime: 0,
  };
}

const cursors = [defaultCursorParams()];
let selectedCursor = 0;

function addCursor() {
  if (cursors.length >= 8) return;
  const base = { ...cursors[selectedCursor] };
  base.nextGrainTime = 0;
  // slightly offset the new cursor so it's audibly distinct
  base.position = clamp(base.position + 0.15, 0, 1);
  cursors.push(base);
  selectedCursor = cursors.length - 1;
  renderCursorTabs();
  syncParamInputsFromCursor();
  drawWaveform();
}

function removeCursor() {
  if (cursors.length <= 1) return;
  cursors.splice(selectedCursor, 1);
  selectedCursor = Math.max(0, selectedCursor - 1);
  renderCursorTabs();
  syncParamInputsFromCursor();
  drawWaveform();
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/* ---------- Envelope curve for a single grain ---------- */

function buildEnvelopeCurve(fade, slant, ease, declick, points) {
  points = points || 48;
  const declickFloor = 0.02 + declick * 0.13; // 2%..15% of grain length
  let attackFrac = Math.max(fade * (0.5 - slant * 0.5), declickFloor);
  let releaseFrac = Math.max(fade * (0.5 + slant * 0.5), declickFloor);
  let sustainFrac = 1 - attackFrac - releaseFrac;
  if (sustainFrac < 0) {
    const scale = 1 / (attackFrac + releaseFrac);
    attackFrac *= scale;
    releaseFrac *= scale;
    sustainFrac = 0;
  }
  const exponent = 1 + ease * 4; // 1..5
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    let v;
    if (t < attackFrac) {
      const u = attackFrac > 0 ? t / attackFrac : 1;
      v = Math.pow(u, exponent);
    } else if (t < attackFrac + sustainFrac) {
      v = 1;
    } else {
      const u = releaseFrac > 0 ? (t - (attackFrac + sustainFrac)) / releaseFrac : 0;
      v = Math.pow(1 - u, exponent);
    }
    curve[i] = Math.max(0.0001, v); // WebAudio curves can't contain 0 mid-array on some impls
  }
  return curve;
}

/* ---------- Grain scheduling ---------- */

function scheduleGrain(cursor, time) {
  if (!audioBuffer) return;
  const bufDur = audioBuffer.duration;
  const durSec = Math.max(0.005, cursor.duration / 1000);
  const jitter = (Math.random() * 2 - 1) * cursor.spread * bufDur * 0.5;
  const centerPos = scanEnabled ? scanPosition : cursor.position;
  let posSec = centerPos * bufDur + jitter;
  posSec = clamp(posSec, 0, Math.max(0, bufDur - durSec));

  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;

  const env = audioCtx.createGain();
  const curve = buildEnvelopeCurve(cursor.fade, cursor.slant, cursor.ease, cursor.declick);
  env.gain.setValueCurveAtTime(curve, time, durSec);

  const cGain = audioCtx.createGain();
  cGain.gain.value = cursor.mix * cursor.gain;

  src.connect(env).connect(cGain).connect(masterGain);
  src.start(time, posSec, durSec);
  src.stop(time + durSec + 0.02);
  src.onended = () => {
    src.disconnect();
    env.disconnect();
    cGain.disconnect();
  };
}

function schedulerTick() {
  if (!audioCtx || !audioBuffer) return;
  const now = audioCtx.currentTime;

  if (scanEnabled) {
    scanPosition = (scanPosition + LOOKAHEAD_MS / 1000 / SCAN_SWEEP_SECONDS) % 1;
  }

  for (const cursor of cursors) {
    if (!cursor.enabled) continue;
    if (cursor.nextGrainTime < now) cursor.nextGrainTime = now;
    while (cursor.nextGrainTime < now + SCHEDULE_AHEAD_SEC) {
      scheduleGrain(cursor, cursor.nextGrainTime);
      const overlap = 0.5 + cursor.density * 0.45; // 0.5..0.95
      const ioi = Math.max(0.004, (cursor.duration / 1000) * (1 - overlap));
      cursor.nextGrainTime += ioi;
    }
  }

  updateTimeReadout();
  drawWaveform();
}

function startPlayback() {
  ensureAudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (!audioBuffer) return;
  isPlaying = true;
  for (const c of cursors) c.nextGrainTime = audioCtx.currentTime;
  schedulerTimer = setInterval(schedulerTick, LOOKAHEAD_MS);
  document.getElementById("btnPlay").classList.add("active");
  document.getElementById("btnPlay").textContent = "❚❚";
}

function stopPlayback() {
  isPlaying = false;
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  document.getElementById("btnPlay").classList.remove("active");
  document.getElementById("btnPlay").textContent = "▶";
}

/* ---------- File loading (drag/drop + file picker) ---------- */

async function loadArrayBufferAsAudio(arrayBuffer, name) {
  ensureAudioContext();
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    audioBuffer = decoded;
    document.getElementById("trackName").textContent = name || "(untitled)";
    document.getElementById("dropHint").style.display = "none";
    drawWaveform();
  } catch (err) {
    alert("音声ファイルのデコードに失敗しました: " + err.message);
  }
}

function handleFiles(files) {
  const file = files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadArrayBufferAsAudio(reader.result, file.name);
  reader.readAsArrayBuffer(file);
}

/* ---------- Microphone recording into the buffer ---------- */

let micStream = null;
let micRecorder = null;
let micChunks = [];
let isRecording = false;

async function toggleMicRecord() {
  ensureAudioContext();
  const btn = document.getElementById("btnRecord");
  if (!isRecording) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert("マイクにアクセスできませんでした: " + err.message);
      return;
    }
    micChunks = [];
    micRecorder = new MediaRecorder(micStream);
    micRecorder.ondataavailable = (e) => micChunks.push(e.data);
    micRecorder.onstop = async () => {
      const blob = new Blob(micChunks, { type: micRecorder.mimeType });
      const arrayBuffer = await blob.arrayBuffer();
      loadArrayBufferAsAudio(arrayBuffer, "recording");
      micStream.getTracks().forEach((t) => t.stop());
    };
    micRecorder.start();
    isRecording = true;
    btn.classList.add("active");
  } else {
    micRecorder.stop();
    isRecording = false;
    btn.classList.remove("active");
  }
}

/* ---------- Export (record master bus to a downloadable file) ---------- */

let isExporting = false;

function toggleExport() {
  ensureAudioContext();
  const btn = document.getElementById("btnExport");
  if (!isExporting) {
    exportChunks = [];
    mediaRecorderExport = new MediaRecorder(exportDest.stream);
    mediaRecorderExport.ondataavailable = (e) => exportChunks.push(e.data);
    mediaRecorderExport.onstop = () => {
      const blob = new Blob(exportChunks, { type: mediaRecorderExport.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "graindeck-export.webm";
      a.click();
      URL.revokeObjectURL(url);
    };
    mediaRecorderExport.start();
    isExporting = true;
    btn.classList.add("active");
    btn.textContent = "⏺ Exporting…";
  } else {
    mediaRecorderExport.stop();
    isExporting = false;
    btn.classList.remove("active");
    btn.textContent = "💾 Export";
  }
}

/* ---------- Waveform drawing ---------- */

const canvas = document.getElementById("waveform");
const ctx2d = canvas.getContext("2d");
let showGrid = false;
let waveformPeaks = null;

function computePeaks(buffer, targetWidth) {
  const data = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / targetWidth));
  const peaks = new Float32Array(targetWidth);
  for (let i = 0; i < targetWidth; i++) {
    let max = 0;
    const start = i * blockSize;
    const end = Math.min(data.length, start + blockSize);
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

function resizeCanvasForDPR() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawWaveform() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx2d.clearRect(0, 0, w, h);
  const mid = h / 2;

  if (audioBuffer) {
    if (!waveformPeaks || waveformPeaks.length !== Math.floor(w)) {
      waveformPeaks = computePeaks(audioBuffer, Math.max(1, Math.floor(w)));
    }
    ctx2d.strokeStyle = "#5ec9c0";
    ctx2d.globalAlpha = 0.9;
    ctx2d.beginPath();
    for (let x = 0; x < waveformPeaks.length; x++) {
      const amp = waveformPeaks[x] * (h * 0.45);
      ctx2d.moveTo(x, mid - amp);
      ctx2d.lineTo(x, mid + amp);
    }
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;
  } else {
    ctx2d.strokeStyle = "#2c333e";
    ctx2d.beginPath();
    ctx2d.moveTo(0, mid);
    ctx2d.lineTo(w, mid);
    ctx2d.stroke();
  }

  // cursor markers
  cursors.forEach((c, idx) => {
    const pos = scanEnabled ? scanPosition : c.position;
    const x = pos * w;
    const isSel = idx === selectedCursor;
    ctx2d.strokeStyle = isSel ? "#e8945a" : c.enabled ? "#5ec9c0" : "#8b95a3";
    ctx2d.globalAlpha = isSel ? 1 : 0.55;
    ctx2d.lineWidth = isSel ? 2 : 1;
    ctx2d.beginPath();
    ctx2d.moveTo(x, 0);
    ctx2d.lineTo(x, h);
    ctx2d.stroke();

    // small handle + label
    ctx2d.fillStyle = ctx2d.strokeStyle;
    ctx2d.beginPath();
    ctx2d.arc(x, 14, 6, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    ctx2d.fillStyle = "#0b0e12";
    ctx2d.font = "9px sans-serif";
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    ctx2d.fillText(String(idx + 1), x, 14);
  });
  ctx2d.globalAlpha = 1;
}

function updateTimeReadout() {
  if (!audioBuffer) return;
  const pos = scanEnabled ? scanPosition : cursors[selectedCursor].position;
  const t = pos * audioBuffer.duration;
  const mm = Math.floor(t / 60);
  const ss = (t % 60).toFixed(3).padStart(6, "0");
  document.getElementById("timeReadout").textContent = `${mm}:${ss}`;
}

/* ---------- Waveform pointer interaction (scrub position) ---------- */

let draggingWaveform = false;

function positionFromPointerEvent(e) {
  const rect = canvas.getBoundingClientRect();
  let x = (e.clientX - rect.left) / rect.width;
  x = clamp(x, 0, 1);
  if (showGrid) {
    const steps = 32;
    x = Math.round(x * steps) / steps;
  }
  return x;
}

canvas.addEventListener("pointerdown", (e) => {
  draggingWaveform = true;
  const pos = positionFromPointerEvent(e);
  cursors[selectedCursor].position = pos;
  scanEnabled = false;
  document.getElementById("btnScan").classList.remove("active");
  syncParamInputsFromCursor();
  drawWaveform();
  updateTimeReadout();
});
window.addEventListener("pointermove", (e) => {
  if (!draggingWaveform) return;
  const pos = positionFromPointerEvent(e);
  cursors[selectedCursor].position = pos;
  syncParamInputsFromCursor();
  drawWaveform();
  updateTimeReadout();
});
window.addEventListener("pointerup", () => {
  draggingWaveform = false;
});

/* ---------- Drag & drop ---------- */

const dropZone = document.querySelector(".waveform-wrap");
["dragenter", "dragover"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "#5ec9c0";
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "";
  })
);
dropZone.addEventListener("drop", (e) => {
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    handleFiles(e.dataTransfer.files);
  }
});
dropZone.addEventListener("dblclick", () => document.getElementById("fileInput").click());

/* ---------- Param UI wiring ---------- */

const paramDefs = [
  { key: "position", input: "pPosition", val: "vPosition", fmt: (v) => Math.round(v * 100) + "%" },
  { key: "duration", input: "pDuration", val: "vDuration", fmt: (v) => Math.round(v) + "ms" },
  { key: "mix", input: "pMix", val: "vMix", fmt: (v) => Math.round(v * 100) + "%" },
  { key: "fade", input: "pFade", val: "vFade", fmt: (v) => Math.round(v * 100) + "%" },
  { key: "spread", input: "pSpread", val: "vSpread", fmt: (v) => Math.round(v * 100) + "%" },
  { key: "slant", input: "pSlant", val: "vSlant", fmt: (v) => v.toFixed(2) },
  { key: "gain", input: "pGain", val: "vGain", fmt: (v) => Math.round(v * 100) + "%" },
  { key: "ease", input: "pEase", val: "vEase", fmt: (v) => Math.round(v * 100) + "%" },
  { key: "declick", input: "pDeclick", val: "vDeclick", fmt: (v) => Math.round(v * 100) + "%" },
  { key: "density", input: "pDensity", val: "vDensity", fmt: (v) => Math.round(v * 100) + "%" },
];

function syncParamInputsFromCursor() {
  const c = cursors[selectedCursor];
  for (const def of paramDefs) {
    const input = document.getElementById(def.input);
    input.value = c[def.key];
    document.getElementById(def.val).textContent = def.fmt(c[def.key]);
  }
}

paramDefs.forEach((def) => {
  const input = document.getElementById(def.input);
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    cursors[selectedCursor][def.key] = v;
    document.getElementById(def.val).textContent = def.fmt(v);
    drawWaveform();
  });
});

/* ---------- Cursor tabs UI ---------- */

function renderCursorTabs() {
  const wrap = document.getElementById("cursorTabs");
  wrap.innerHTML = "";
  cursors.forEach((c, idx) => {
    const btn = document.createElement("button");
    btn.className = "cursor-tab" + (idx === selectedCursor ? " selected" : "") + (c.enabled ? " enabled" : "");
    btn.textContent = String(idx + 1);
    btn.title = "クリックで選択、Shift+クリックで有効/無効を切替";
    btn.addEventListener("click", (e) => {
      if (e.shiftKey) {
        c.enabled = !c.enabled;
      } else {
        selectedCursor = idx;
        syncParamInputsFromCursor();
      }
      renderCursorTabs();
      drawWaveform();
    });
    wrap.appendChild(btn);
  });
}

/* ---------- Buttons ---------- */

document.getElementById("btnPlay").addEventListener("click", () => {
  if (isPlaying) stopPlayback();
  else startPlayback();
});
document.getElementById("btnStop").addEventListener("click", stopPlayback);
document.getElementById("btnScan").addEventListener("click", (e) => {
  scanEnabled = !scanEnabled;
  e.target.classList.toggle("active", scanEnabled);
  if (scanEnabled) scanPosition = cursors[selectedCursor].position;
});
document.getElementById("btnRecord").addEventListener("click", toggleMicRecord);
document.getElementById("btnExport").addEventListener("click", toggleExport);
document.getElementById("btnOpen").addEventListener("click", () => document.getElementById("fileInput").click());
document.getElementById("fileInput").addEventListener("change", (e) => handleFiles(e.target.files));
document.getElementById("btnGrid").addEventListener("click", (e) => {
  showGrid = !showGrid;
  e.target.classList.toggle("active", showGrid);
});
document.getElementById("btnAddCursor").addEventListener("click", addCursor);
document.getElementById("btnDelCursor").addEventListener("click", removeCursor);

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT") {
    e.preventDefault();
    if (isPlaying) stopPlayback();
    else startPlayback();
  }
});

window.addEventListener("resize", () => {
  waveformPeaks = null;
  drawWaveform();
});

/* ---------- Init ---------- */

renderCursorTabs();
syncParamInputsFromCursor();
drawWaveform();
