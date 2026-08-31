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
    paramDefs: [
      { key: "bits", label: "ビット深度", type: "range", min: 1, max: 16, step: 1, format: (v) => `${v}bit` },
      { key: "hold", label: "サンプル間引き", type: "range", min: 1, max: 40, step: 1, format: (v) => `x${v}` },
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

const FACTORIES = {
  glitch: makeGlitchBox,
  filter: makeFilterBox,
  crush: makeCrushBox,
  delay: makeDelayBox,
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
