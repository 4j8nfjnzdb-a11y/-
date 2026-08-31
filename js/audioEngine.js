// Shared audio context, master bus, reverb send, and the tempo clock that
// every slot's loop/chop engine and every patch-bay glitch box reads from.

export const engine = {
  ctx: null,
  master: null,
  compressor: null,
  reverbBus: null,
  reverbNode: null,
  analyser: null,
  analyserData: null,
  glitchWorkletReady: false,
  bpm: 120,
  running: false,
};

function buildImpulseResponse(ctx, duration, decay) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return impulse;
}

export async function initAudioEngine() {
  if (engine.ctx) return engine;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  engine.ctx = ctx;

  const master = ctx.createGain();
  master.gain.value = 0.85;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.ratio.value = 3.5;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  engine.analyser = analyser;
  engine.analyserData = new Float32Array(analyser.fftSize);

  master.connect(compressor).connect(analyser).connect(ctx.destination);
  engine.master = master;
  engine.compressor = compressor;

  const reverbBus = ctx.createGain();
  reverbBus.gain.value = 1;
  const reverbNode = ctx.createConvolver();
  reverbNode.buffer = buildImpulseResponse(ctx, 3.2, 2.6);
  reverbBus.connect(reverbNode).connect(master);
  engine.reverbBus = reverbBus;
  engine.reverbNode = reverbNode;

  try {
    await ctx.audioWorklet.addModule("worklets/glitch-processor.js");
    engine.glitchWorkletReady = true;
  } catch (err) {
    console.warn("Glitch worklet failed to load; GLITCH boxes will be silent passthrough.", err);
    engine.glitchWorkletReady = false;
  }

  return engine;
}

export async function resumeEngine() {
  if (!engine.ctx) await initAudioEngine();
  if (engine.ctx.state === "suspended") await engine.ctx.resume();
}

export function stepSeconds(division) {
  // division like "1/4","1/8","1/16","1/16t","1/8d","1/32"
  const beat = 60 / engine.bpm;
  const map = {
    "1/4": beat,
    "1/8": beat / 2,
    "1/8d": (beat / 2) * 1.5,
    "1/8t": (beat / 2) * (2 / 3),
    "1/16": beat / 4,
    "1/16t": (beat / 4) * (2 / 3),
    "1/32": beat / 8,
  };
  return map[division] ?? beat / 4;
}

export function readMeterLevel() {
  if (!engine.analyser) return 0;
  engine.analyser.getFloatTimeDomainData(engine.analyserData);
  let sum = 0;
  for (let i = 0; i < engine.analyserData.length; i++) {
    sum += engine.analyserData[i] * engine.analyserData[i];
  }
  return Math.sqrt(sum / engine.analyserData.length);
}
