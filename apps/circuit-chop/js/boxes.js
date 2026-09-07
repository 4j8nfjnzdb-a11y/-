// Patch-bay "box" definitions. Every box exposes a uniform shape:
//   { id, type, title, input, output, paramDefs, getParam, setParam, dispose }
// `input`/`output` are AudioNodes so the patch bay can freely
// `.connect()`/`.disconnect()` them regardless of what's inside.

import { engine, stepSeconds } from "./audioEngine.js";

let nextBoxId = 1;

const DIVISIONS = ["1/4", "1/8", "1/8d", "1/8t", "1/16", "1/16t", "1/32"];
const pct = (v) => `${Math.round(v * 100)}%`;

function makeGlitchBox() {
  const ctx = engine.ctx;
  const node = engine.glitchWorkletReady
    ? new AudioWorkletNode(ctx, "glitch-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
      })
    : ctx.createGain(); // silent fallback bypass if worklet failed to load

  const state = { mode: "chop", division: "1/16", gate: 0.8, probability: 1, jitter: 0.15, mix: 1 };

  function push() {
    if (!(node instanceof AudioWorkletNode)) return;
    node.port.postMessage({
      mode: state.mode,
      stepSec: stepSeconds(state.division),
      gate: state.gate,
      probability: state.probability,
      jitter: state.jitter,
      mix: state.mix,
    });
  }
  push();

  return {
    type: "glitch",
    title: "GLITCH",
    input: node,
    output: node,
    modTargetKey: "probability",
    paramDefs: [
      { key: "mode", label: "モード", type: "select", options: ["chop", "stutter", "random", "reverse", "freeze", "through"] },
      { key: "division", label: "レート", type: "select", options: DIVISIONS },
      { key: "gate", label: "ゲート", type: "range", min: 0.05, max: 1, step: 0.01, format: pct },
      { key: "probability", label: "確率", type: "range", min: 0, max: 1, step: 0.01, format: pct },
      { key: "jitter", label: "ジッター", type: "range", min: 0, max: 1, step: 0.01, format: pct },
      { key: "mix", label: "MIX", type: "range", min: 0, max: 1, step: 0.01, format: pct },
    ],
    getParam: (k) => state[k],
    setParam(k, v) { state[k] = v; push(); },
    dispose() { if (node.disconnect) node.disconnect(); },
  };
}

function makeFilterBox() {
  const ctx = engine.ctx;
  const node = ctx.createBiquadFilter();
  node.type = "lowpass";
  node.frequency.value = 1800;
  node.Q.value = 0.7;
  const state = { filterType: "lowpass", freq: 1800, q: 0.7 };

  return {
    type: "filter",
    title: "FILTER",
    input: node,
    output: node,
    modTargetKey: "freq",
    paramDefs: [
      { key: "filterType", label: "種類", type: "select", options: ["lowpass", "highpass", "bandpass", "notch"] },
      { key: "freq", label: "周波数", type: "range", min: 80, max: 12000, step: 10, format: (v) => `${Math.round(v)}Hz` },
      { key: "q", label: "Q", type: "range", min: 0.1, max: 18, step: 0.1 },
    ],
    getParam: (k) => state[k],
    setParam(k, v) {
      state[k] = v;
      if (k === "filterType") node.type = v;
      if (k === "freq") node.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
      if (k === "q") node.Q.setTargetAtTime(v, ctx.currentTime, 0.01);
    },
    dispose() { node.disconnect(); },
  };
}

function makeCrushBox() {
  const ctx = engine.ctx;
  const node = engine.glitchWorkletReady
    ? new AudioWorkletNode(ctx, "crush-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
      })
    : ctx.createGain();

  const state = { bits: 6, hold: 6, mix: 1 };
  function push() {
    if (!(node instanceof AudioWorkletNode)) return;
    node.port.postMessage(state);
  }
  push();

  return {
    type: "crush",
    title: "CRUSH",
    input: node,
    output: node,
    modTargetKey: "hold",
    paramDefs: [
      { key: "bits", label: "ビット深度", type: "range", min: 1, max: 16, step: 1, format: (v) => `${v}bit` },
      { key: "hold", label: "サンプル間引き", type: "range", min: 1, max: 40, step: 1, format: (v) => `x${Math.round(v)}` },
      { key: "mix", label: "MIX", type: "range", min: 0, max: 1, step: 0.01, format: pct },
    ],
    getParam: (k) => state[k],
    setParam(k, v) { state[k] = v; push(); },
    dispose() { if (node.disconnect) node.disconnect(); },
  };
}

function makeDelayBox() {
  const ctx = engine.ctx;
  const inputGain = ctx.createGain();
  const outputGain = ctx.createGain();
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const feedbackGain = ctx.createGain();
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 3500;
  const delayNode = ctx.createDelay(2.0);
  delayNode.delayTime.value = 0.3;

  inputGain.connect(dryGain).connect(outputGain);
  inputGain.connect(delayNode);
  delayNode.connect(damp).connect(feedbackGain).connect(delayNode);
  delayNode.connect(wetGain).connect(outputGain);

  const state = { division: "1/8d", feedback: 0.4, mix: 0.35 };
  dryGain.gain.value = 1 - state.mix;
  wetGain.gain.value = state.mix;
  feedbackGain.gain.value = state.feedback;

  function applyDivision() {
    delayNode.delayTime.setTargetAtTime(stepSeconds(state.division), ctx.currentTime, 0.01);
  }
  applyDivision();

  return {
    type: "delay",
    title: "DELAY",
    input: inputGain,
    output: outputGain,
    modTargetKey: "feedback",
    paramDefs: [
      { key: "division", label: "レート", type: "select", options: DIVISIONS },
      { key: "feedback", label: "フィードバック", type: "range", min: 0, max: 0.92, step: 0.01, format: pct },
      { key: "mix", label: "MIX", type: "range", min: 0, max: 1, step: 0.01, format: pct },
    ],
    getParam: (k) => state[k],
    setParam(k, v) {
      state[k] = v;
      if (k === "division") applyDivision();
      if (k === "feedback") feedbackGain.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
      if (k === "mix") {
        dryGain.gain.setTargetAtTime(1 - v, ctx.currentTime, 0.01);
        wetGain.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
      }
    },
    dispose() {
      inputGain.disconnect(); outputGain.disconnect(); dryGain.disconnect();
      wetGain.disconnect(); feedbackGain.disconnect(); damp.disconnect(); delayNode.disconnect();
    },
  };
}

function buildReverbImpulse(ctx, duration, decay) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const buf = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

function makeReverbBox() {
  const ctx = engine.ctx;
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const convolver = ctx.createConvolver();
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";

  input.connect(dry).connect(output);
  input.connect(convolver).connect(damp).connect(wet).connect(output);

  const state = { size: 2.2, damp: 4500, mix: 0.4 };
  dry.gain.value = 1 - state.mix;
  wet.gain.value = state.mix;
  damp.frequency.value = state.damp;

  let rebuildTimer = null;
  function buildImpulse() { convolver.buffer = buildReverbImpulse(ctx, state.size, 2.5); }
  function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(buildImpulse, 120); }
  buildImpulse();

  return {
    type: "reverb",
    title: "REVERB",
    input,
    output,
    modTargetKey: "size",
    paramDefs: [
      { key: "size", label: "サイズ", type: "range", min: 0.3, max: 6, step: 0.1, format: (v) => `${v.toFixed(1)}s` },
      { key: "damp", label: "ダンプ", type: "range", min: 800, max: 12000, step: 100, format: (v) => `${Math.round(v)}Hz` },
      { key: "mix", label: "MIX", type: "range", min: 0, max: 1, step: 0.01, format: pct },
    ],
    getParam: (k) => state[k],
    setParam(k, v) {
      state[k] = v;
      if (k === "size") scheduleRebuild();
      if (k === "damp") damp.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
      if (k === "mix") {
        dry.gain.setTargetAtTime(1 - v, ctx.currentTime, 0.01);
        wet.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
      }
    },
    dispose() {
      clearTimeout(rebuildTimer);
      input.disconnect(); output.disconnect(); dry.disconnect();
      wet.disconnect(); convolver.disconnect(); damp.disconnect();
    },
  };
}

function makePitchBox() {
  const ctx = engine.ctx;
  const node = engine.glitchWorkletReady
    ? new AudioWorkletNode(ctx, "pitch-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
      })
    : ctx.createGain();

  const state = { semitones: 5, mix: 1 };
  function push() {
    if (!(node instanceof AudioWorkletNode)) return;
    node.port.postMessage(state);
  }
  push();

  return {
    type: "pitch",
    title: "PITCH",
    input: node,
    output: node,
    modTargetKey: "semitones",
    paramDefs: [
      { key: "semitones", label: "半音", type: "range", min: -12, max: 12, step: 1, format: (v) => `${v >= 0 ? "+" : ""}${Math.round(v)}st` },
      { key: "mix", label: "MIX", type: "range", min: 0, max: 1, step: 0.01, format: pct },
    ],
    getParam: (k) => state[k],
    setParam(k, v) { state[k] = v; push(); },
    dispose() { if (node.disconnect) node.disconnect(); },
  };
}

function makeGateBox() {
  const ctx = engine.ctx;
  const gainNode = ctx.createGain();
  gainNode.gain.value = 1;
  const state = { division: "1/8", probability: 0.45, smooth: 8 };
  let nextStepTime = 0;
  let started = false;

  return {
    type: "gate",
    title: "GATE",
    input: gainNode,
    output: gainNode,
    modTargetKey: "probability",
    paramDefs: [
      { key: "division", label: "間隔", type: "select", options: DIVISIONS },
      { key: "probability", label: "開く確率", type: "range", min: 0, max: 1, step: 0.01, format: pct },
      { key: "smooth", label: "なめらかさ", type: "range", min: 1, max: 40, step: 1, format: (v) => `${v}ms` },
    ],
    getParam: (k) => state[k],
    setParam(k, v) { state[k] = v; },
    onTransportStart() { started = false; },
    tick(now, lookahead) {
      if (!started) { nextStepTime = now + 0.02; started = true; }
      while (nextStepTime < now + lookahead) {
        const t = nextStepTime;
        const open = Math.random() < state.probability;
        const smoothSec = Math.max(0.001, state.smooth / 1000);
        gainNode.gain.linearRampToValueAtTime(open ? 1 : 0, t + smoothSec);
        nextStepTime += Math.max(0.02, stepSeconds(state.division));
      }
    },
    dispose() { gainNode.disconnect(); },
  };
}

function pseudoRandom(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function makeModBox() {
  const state = { shape: "drift", division: "1/4", depth: 0.6 };
  let driftValue = Math.random();
  let driftTarget = driftValue;
  let lastStepAt = 0;

  function getValue(t) {
    const period = Math.max(0.05, stepSeconds(state.division) * 4);
    switch (state.shape) {
      case "sine":
        return 0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2);
      case "pulse":
        return (t % period) / period < 0.5 ? 1 : 0;
      case "sh":
        return pseudoRandom(Math.floor(t / period));
      default: {
        if (t - lastStepAt > period * 0.25) {
          lastStepAt = t;
          if (Math.random() < 0.3) driftTarget = Math.random();
        }
        driftValue += (driftTarget - driftValue) * 0.05;
        return driftValue;
      }
    }
  }

  return {
    type: "mod",
    title: "MOD",
    input: null,
    output: null,
    isModSource: true,
    paramDefs: [
      { key: "shape", label: "波形", type: "select", options: ["drift", "sine", "sh", "pulse"] },
      { key: "division", label: "サイクル", type: "select", options: DIVISIONS },
      { key: "depth", label: "深さ", type: "range", min: 0, max: 1, step: 0.01, format: pct },
    ],
    getParam: (k) => state[k],
    setParam(k, v) { state[k] = v; },
    getValue,
    dispose() {},
  };
}

const FACTORIES = {
  glitch: makeGlitchBox,
  filter: makeFilterBox,
  crush: makeCrushBox,
  delay: makeDelayBox,
  reverb: makeReverbBox,
  pitch: makePitchBox,
  gate: makeGateBox,
  mod: makeModBox,
};

export function createBox(type) {
  const factory = FACTORIES[type];
  if (!factory) throw new Error(`unknown box type: ${type}`);
  const box = factory();
  box.id = `box${nextBoxId++}`;
  box.defaults = {};
  box.paramDefs.forEach((d) => { box.defaults[d.key] = box.getParam(d.key); });
  return box;
}
