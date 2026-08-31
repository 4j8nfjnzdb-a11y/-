// GlitchProcessor — a Pure-Data-style live re-slicer.
//
// It continuously records its input into a rolling ring buffer, and on
// every step of an internal clock decides where to read from next,
// according to `mode`:
//   through  - plain pass-through (bypass)
//   chop     - retrigger the most recent window at the start of every step
//              (classic gated buffer-chop)
//   stutter  - latch one short window and repeat it, occasionally
//              relatching to a newer window
//   random   - jump to a random point in recent history each step,
//              forward or backward
//   reverse  - replay the most recent window backwards
//   freeze   - grab one grain once and loop it until the mode changes
//
// Params (sent via port.postMessage({...})): mode, stepSec, gate (0..1
// audible fraction of the step), probability (0..1 chance a step plays
// at all), jitter (0..1 randomises the read start point), mix (0..1
// dry/wet).

const MAX_SECONDS = 2.5;
const FADE_SAMPLES = 48;

class GlitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufLen = Math.ceil(sampleRate * MAX_SECONDS);
    this.ring = [new Float32Array(this.bufLen), new Float32Array(this.bufLen)];
    this.clock = 0;
    this.stepSamples = Math.round(sampleRate * 0.125);
    this.currentStepIndex = -1;
    this.sliceStart = 0;
    this.direction = 1;
    this.stepAudible = true;
    this.latchOffset = 0;
    this.hasLatched = false;

    this.params = {
      mode: "through",
      gate: 0.85,
      probability: 1,
      jitter: 0,
      mix: 1,
    };
    this.prevMode = "through";

    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (typeof msg.stepSec === "number" && msg.stepSec > 0.002) {
        this.stepSamples = Math.max(64, Math.round(sampleRate * msg.stepSec));
      }
      Object.assign(this.params, msg);
    };
  }

  wrap(pos) {
    const m = this.bufLen;
    return ((Math.floor(pos) % m) + m) % m;
  }

  onStepBoundary() {
    const p = this.params;
    const modeChanged = p.mode !== this.prevMode;
    this.prevMode = p.mode;

    this.stepAudible = Math.random() < p.probability;

    const jitterSamples = p.jitter * this.stepSamples * 0.5 * (Math.random() * 2 - 1);
    const recent = this.clock - this.stepSamples;
    const maxLookback = this.bufLen - this.stepSamples - 8;

    switch (p.mode) {
      case "stutter": {
        const shouldRelatch = !this.hasLatched || modeChanged || Math.random() > p.probability + 0.05;
        if (shouldRelatch) {
          this.latchOffset = recent + jitterSamples;
          this.hasLatched = true;
        }
        this.sliceStart = this.latchOffset;
        this.direction = 1;
        break;
      }
      case "chop": {
        this.sliceStart = recent + jitterSamples;
        this.direction = 1;
        break;
      }
      case "random": {
        const lookback = Math.random() * Math.max(1, maxLookback);
        this.sliceStart = this.clock - this.stepSamples - lookback;
        this.direction = Math.random() < 0.5 ? -1 : 1;
        break;
      }
      case "reverse": {
        this.sliceStart = this.clock;
        this.direction = -1;
        break;
      }
      case "freeze": {
        if (!this.hasLatched || modeChanged) {
          this.latchOffset = recent;
          this.hasLatched = true;
        }
        this.sliceStart = this.latchOffset;
        this.direction = 1;
        break;
      }
      default:
        this.hasLatched = false;
        break;
    }
  }

  readRing(ch, pos) {
    return this.ring[ch][this.wrap(pos)];
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const chCount = Math.max(1, output.length);
    const inCh0 = input && input[0] ? input[0] : null;
    const inCh1 = input && input[1] ? input[1] : inCh0;
    const frames = output[0].length;
    const p = this.params;

    for (let i = 0; i < frames; i++) {
      const stepIndex = Math.floor(this.clock / this.stepSamples);
      if (stepIndex !== this.currentStepIndex) {
        this.currentStepIndex = stepIndex;
        this.onStepBoundary();
      }

      const s0 = inCh0 ? inCh0[i] : 0;
      const s1 = inCh1 ? inCh1[i] : s0;
      this.ring[0][this.wrap(this.clock)] = s0;
      this.ring[1][this.wrap(this.clock)] = s1;

      let wet0 = s0, wet1 = s1;

      if (p.mode !== "through") {
        const sampleInStep = this.clock - this.currentStepIndex * this.stepSamples;
        const gateSamples = this.stepSamples * Math.max(0.02, p.gate);
        const audible = this.stepAudible && sampleInStep < gateSamples;

        if (audible) {
          const readPos = this.sliceStart + this.direction * sampleInStep;
          wet0 = this.readRing(0, readPos);
          wet1 = this.readRing(1, readPos);

          if (sampleInStep < FADE_SAMPLES) {
            const g = sampleInStep / FADE_SAMPLES;
            wet0 *= g; wet1 *= g;
          } else if (gateSamples - sampleInStep < FADE_SAMPLES) {
            const g = Math.max(0, (gateSamples - sampleInStep) / FADE_SAMPLES);
            wet0 *= g; wet1 *= g;
          }
        } else {
          wet0 = 0; wet1 = 0;
        }
      }

      const mix = p.mix;
      const out0 = s0 * (1 - mix) + wet0 * mix;
      const out1 = s1 * (1 - mix) + wet1 * mix;

      for (let ch = 0; ch < chCount; ch++) {
        output[ch][i] = ch === 0 ? out0 : out1;
      }

      this.clock++;
    }

    return true;
  }
}

registerProcessor("glitch-processor", GlitchProcessor);

// CrushProcessor — bit-depth quantization + sample-and-hold rate reduction,
// the other classic IDM texture: dirty, aliased, stepped.
class CrushProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.params = { bits: 8, hold: 4, mix: 1 };
    this.holdCounter = 0;
    this.held = [0, 0];
    this.port.onmessage = (e) => Object.assign(this.params, e.data || {});
  }

  quantize(x) {
    const levels = Math.pow(2, Math.max(1, Math.min(16, this.params.bits)));
    return Math.round(x * levels) / levels;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inCh0 = input && input[0] ? input[0] : null;
    const inCh1 = input && input[1] ? input[1] : inCh0;
    const frames = output[0].length;
    const hold = Math.max(1, Math.round(this.params.hold));
    const mix = this.params.mix;

    for (let i = 0; i < frames; i++) {
      const s0 = inCh0 ? inCh0[i] : 0;
      const s1 = inCh1 ? inCh1[i] : s0;

      if (this.holdCounter === 0) {
        this.held[0] = this.quantize(s0);
        this.held[1] = this.quantize(s1);
      }
      this.holdCounter = (this.holdCounter + 1) % hold;

      const out0 = s0 * (1 - mix) + this.held[0] * mix;
      const out1 = s1 * (1 - mix) + this.held[1] * mix;
      for (let ch = 0; ch < output.length; ch++) {
        output[ch][i] = ch === 0 ? out0 : out1;
      }
    }
    return true;
  }
}

registerProcessor("crush-processor", CrushProcessor);
