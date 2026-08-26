// glitch-processor.js — AudioWorkletProcessor
//
// Passes the live input straight through until the main thread posts a
// {type:"trigger"} message. For the requested duration it corrupts the
// signal with one of a handful of "something's wrong" artifacts, then
// snaps back to clean passthrough. All timing/scheduling (when to
// trigger, how often) lives on the main thread — this processor only
// knows how to render one glitch once told to.

class GlitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringLen = Math.ceil(sampleRate * 0.75);
    this.ring = [new Float32Array(this.ringLen), new Float32Array(this.ringLen)];
    this.writeIdx = 0;
    this.active = null;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "trigger") this.startGlitch(msg);
      else if (msg.type === "clear") this.active = null;
    };
  }

  startGlitch({ kind, durationSamples, intensity }) {
    const a = {
      kind,
      remaining: durationSamples,
      total: durationSamples,
      intensity,
      crushCounter: 0,
      crushHold: [0, 0],
      warblePhase: Math.random() * Math.PI * 2,
      readPos: 0,
    };

    if (kind === "stutter") {
      const lenSec = 0.02 + Math.random() * 0.09 * (0.4 + intensity);
      a.stutterLen = Math.max(8, Math.floor(lenSec * sampleRate));
      a.stutterStart = (this.writeIdx - a.stutterLen - 64 + this.ringLen * 4) % this.ringLen;
    }

    this.active = a;
  }

  applyGlitch(xs) {
    const a = this.active;
    switch (a.kind) {
      case "bitcrush": {
        const holdEvery = 2 + Math.floor(a.intensity * 18);
        a.crushCounter++;
        if (a.crushCounter >= holdEvery) {
          a.crushCounter = 0;
          a.crushHold = xs.slice();
        }
        const bits = Math.max(2, 8 - Math.floor(a.intensity * 6));
        const levels = Math.pow(2, bits);
        return a.crushHold.map((v) => Math.round(v * levels) / levels);
      }
      case "stutter": {
        const len = a.stutterLen;
        const idx = (a.stutterStart + (a.readPos % len) + this.ringLen) % this.ringLen;
        a.readPos++;
        return [this.ring[0][idx], this.ring[1][idx]];
      }
      case "dropout": {
        const click = Math.random() < 0.025 ? (Math.random() * 2 - 1) * 0.25 : 0;
        return [click, click];
      }
      case "warble": {
        const rate = 3 + a.intensity * 9;
        a.warblePhase += (2 * Math.PI * rate) / sampleRate;
        const depthSamples = 30 + a.intensity * 220;
        const delay = 140 + Math.sin(a.warblePhase) * depthSamples;
        const idx = Math.floor((this.writeIdx - delay + this.ringLen * 4) % this.ringLen);
        const idxNext = (idx + 1) % this.ringLen;
        const frac = delay - Math.floor(delay);
        return [0, 1].map((ch) => {
          const buf = this.ring[ch];
          return buf[idx] * (1 - frac) + buf[idxNext] * frac;
        });
      }
      case "crackle": {
        const prob = 0.04 + a.intensity * 0.22;
        return xs.map((v) =>
          Math.random() < prob ? (Math.random() * 2 - 1) * (0.35 + a.intensity * 0.55) : v
        );
      }
      default:
        return xs;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const frames = output[0].length;
    const nOut = output.length;

    for (let i = 0; i < frames; i++) {
      const xs = [0, 0];
      for (let ch = 0; ch < nOut; ch++) {
        const inCh = input[ch] || input[0];
        xs[ch] = inCh ? inCh[i] : 0;
      }
      if (nOut < 2) xs[1] = xs[0];

      this.ring[0][this.writeIdx] = xs[0];
      this.ring[1][this.writeIdx] = xs[1];

      let ys = xs;
      if (this.active) {
        ys = this.applyGlitch(xs);
        this.active.remaining--;
        if (this.active.remaining <= 0) this.active = null;
      }

      for (let ch = 0; ch < nOut; ch++) output[ch][i] = ys[ch];
      this.writeIdx = (this.writeIdx + 1) % this.ringLen;
    }
    return true;
  }
}

registerProcessor("glitch-processor", GlitchProcessor);
