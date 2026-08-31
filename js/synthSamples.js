// Synthesized default drum one-shots, rendered offline into AudioBuffers,
// so every slot has sound immediately without requiring a file upload.

function noiseBuffer(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

async function render(seconds, build) {
  const sr = 44100;
  const off = new OfflineAudioContext(1, Math.ceil(sr * seconds), sr);
  build(off);
  return off.startRendering();
}

async function synthKick() {
  return render(0.5, (ctx) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, 0);
    osc.frequency.exponentialRampToValueAtTime(40, 0.14);
    gain.gain.setValueAtTime(1, 0);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.42);
    osc.connect(gain).connect(ctx.destination);
    osc.start(0);
    osc.stop(0.45);
  });
}

async function synthSnare() {
  return render(0.4, (ctx) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.4);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(1, 0);
    ng.gain.exponentialRampToValueAtTime(0.001, 0.22);
    src.connect(bp).connect(ng).connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 180;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.6, 0);
    og.gain.exponentialRampToValueAtTime(0.001, 0.12);
    osc.connect(og).connect(ctx.destination);

    src.start(0);
    osc.start(0);
    osc.stop(0.15);
  });
}

async function synthHat(open) {
  const dur = open ? 0.5 : 0.12;
  return render(dur, (ctx) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, dur);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, 0);
    g.gain.exponentialRampToValueAtTime(0.001, dur);
    src.connect(hp).connect(g).connect(ctx.destination);
    src.start(0);
  });
}

async function synthPerc() {
  return render(0.35, (ctx) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(900, 0);
    osc.frequency.exponentialRampToValueAtTime(220, 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, 0);
    g.gain.exponentialRampToValueAtTime(0.001, 0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1200;
    osc.connect(bp).connect(g).connect(ctx.destination);
    osc.start(0);
    osc.stop(0.2);
  });
}

export const DEFAULT_SAMPLE_BUILDERS = [
  { name: "kick.synth", build: synthKick },
  { name: "snare.synth", build: synthSnare },
  { name: "hat-closed.synth", build: () => synthHat(false) },
  { name: "hat-open.synth", build: () => synthHat(true) },
  { name: "perc.synth", build: synthPerc },
];

export async function makeDefaultSample(index) {
  const def = DEFAULT_SAMPLE_BUILDERS[index % DEFAULT_SAMPLE_BUILDERS.length];
  const buffer = await def.build();
  return { name: def.name, buffer };
}

export async function makeRandomDefaultSample() {
  const i = Math.floor(Math.random() * DEFAULT_SAMPLE_BUILDERS.length);
  return makeDefaultSample(i);
}
