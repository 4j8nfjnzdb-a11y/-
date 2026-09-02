// Captures the final mix (post-compressor, pre-destination) as raw PCM via
// the recorder-processor worklet, and encodes it to a WAV Blob on stop —
// no MediaRecorder/codec involved, so the export is lossless.

import { engine } from "./audioEngine.js";

const MAX_SECONDS = 600; // safety cap so an accidentally-left-on recording can't run away

let recorderNode = null;
let silentGain = null;
let chunks = { ch0: [], ch1: [] };
let recording = false;
let startedAt = 0;
let autoStopTimer = null;

function ensureNode() {
  if (recorderNode) return;
  const ctx = engine.ctx;
  recorderNode = new AudioWorkletNode(ctx, "recorder-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: "explicit",
  });
  recorderNode.port.onmessage = (e) => {
    if (!recording) return;
    chunks.ch0.push(e.data.ch0);
    chunks.ch1.push(e.data.ch1);
  };
  // A worklet node only runs while it's reachable from the destination, so
  // its own (otherwise-unused) output is routed through a muted gain — the
  // tap stays silent but still gets processed every block.
  silentGain = ctx.createGain();
  silentGain.gain.value = 0;
  engine.compressor.connect(recorderNode);
  recorderNode.connect(silentGain).connect(ctx.destination);
}

export function recorderAvailable() {
  return engine.glitchWorkletReady;
}

export function isRecording() {
  return recording;
}

export function startRecording() {
  if (!recorderAvailable() || recording) return false;
  ensureNode();
  chunks = { ch0: [], ch1: [] };
  recording = true;
  startedAt = engine.ctx.currentTime;
  recorderNode.port.postMessage("start");
  autoStopTimer = setTimeout(() => stopRecording(), MAX_SECONDS * 1000);
  return true;
}

function concat(arrs) {
  const total = arrs.reduce((sum, a) => sum + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  arrs.forEach((a) => { out.set(a, offset); offset += a.length; });
  return out;
}

function encodeWav(ch0, ch1, sampleRate) {
  const length = ch0.length;
  const blockAlign = 4; // 2 channels * 16-bit
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const s0 = Math.max(-1, Math.min(1, ch0[i]));
    view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    offset += 2;
    const s1 = Math.max(-1, Math.min(1, ch1[i]));
    view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function stopRecording() {
  if (!recording) return null;
  recording = false;
  clearTimeout(autoStopTimer);
  if (recorderNode) recorderNode.port.postMessage("stop");

  const ch0 = concat(chunks.ch0);
  const ch1 = concat(chunks.ch1);
  chunks = { ch0: [], ch1: [] };
  if (!ch0.length) return null;

  return { blob: encodeWav(ch0, ch1, engine.ctx.sampleRate), seconds: ch0.length / engine.ctx.sampleRate };
}
