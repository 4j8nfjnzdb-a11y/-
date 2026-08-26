// pitch-drift-processor.js — AudioWorkletProcessor
//
// A continuous, always-on pitch shifter using the classic two-grain
// delay-line technique: two overlapping read "grains" sweep backward
// through a short ring buffer of recently recorded audio at a rate
// derived from the target pitch offset (in cents), each windowed with
// sin^2 envelopes offset by half a grain so their power sums to exactly
// 1 at every instant — no clicks at the grain wrap points. The target
// pitch itself is driven from the main thread as a slowly-ramped
// AudioParam, so the shift can sit anywhere in its range for as long as
// wanted and glide smoothly to a new value, unlike a naive delay-time
// ramp (which can only sustain a shift by growing its delay without
// bound).

class PitchDriftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "cents", defaultValue: 0, minValue: -1200, maxValue: 1200, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.ringLen = Math.ceil(sampleRate * 1.0);
    this.ring = [new Float32Array(this.ringLen), new Float32Array(this.ringLen)];
    this.writeIdx = 0;
    this.grainSize = Math.floor(sampleRate * 0.12);
    this.lag = Math.floor(sampleRate * 0.35);
    this.phase = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const frames = output[0].length;
    const nOut = output.length;
    const cents = parameters.cents[0];
    const rate = Math.pow(2, cents / 1200);
    const grainSize = this.grainSize;

    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < nOut; ch++) {
        const inCh = input[ch] || input[0];
        this.ring[ch < 2 ? ch : 1][this.writeIdx] = inCh ? inCh[i] : (input[0] ? input[0][i] : 0);
      }
      if (nOut < 2 && input[0]) this.ring[1][this.writeIdx] = this.ring[0][this.writeIdx];

      this.phase += rate;
      if (this.phase >= grainSize) this.phase -= grainSize;
      if (this.phase < 0) this.phase += grainSize;
      const phaseB = (this.phase + grainSize / 2) % grainSize;

      const winA = Math.pow(Math.sin((Math.PI * this.phase) / grainSize), 2);
      const winB = Math.pow(Math.sin((Math.PI * phaseB) / grainSize), 2);

      const readA = (this.writeIdx - this.lag - this.phase + this.ringLen * 8) % this.ringLen;
      const readB = (this.writeIdx - this.lag - phaseB + this.ringLen * 8) % this.ringLen;

      for (let ch = 0; ch < nOut; ch++) {
        const buf = this.ring[ch < 2 ? ch : 1];
        const a0 = Math.floor(readA), a1 = (a0 + 1) % this.ringLen, fa = readA - a0;
        const b0 = Math.floor(readB), b1 = (b0 + 1) % this.ringLen, fb = readB - b0;
        const sampA = buf[a0] * (1 - fa) + buf[a1] * fa;
        const sampB = buf[b0] * (1 - fb) + buf[b1] * fb;
        output[ch][i] = sampA * winA + sampB * winB;
      }
      this.writeIdx = (this.writeIdx + 1) % this.ringLen;
    }
    return true;
  }
}

registerProcessor("pitch-drift-processor", PitchDriftProcessor);
