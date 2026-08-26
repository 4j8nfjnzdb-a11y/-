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
      readPos: 0,
    };

    if (kind === "stutter") {
      const lenSec = 0.02 + Math.random() * 0.09 * (0.4 + intensity);
      a.stutterLen = Math.max(8, Math.floor(lenSec * sampleRate));
      a.stutterStart = (this.writeIdx - a.stutterLen - 64 + this.ringLen * 4) % this.ringLen;
    }

    this.active = a;
  }

  // pick a fresh short grain from recently recorded (real, played) audio
  rerollChopGrain(a) {
    const lenSec = 0.008 + Math.random() * 0.045 * (0.3 + a.intensity);
    a.chopLen = Math.max(4, Math.floor(lenSec * sampleRate));
    const back = 120 + Math.floor(Math.random() * (this.ringLen - 400));
    a.chopStart = (this.writeIdx - back + this.ringLen * 4) % this.ringLen;
    a.chopReadPos = 0;
  }

  applyGlitch(xs) {
    const a = this.active;
    switch (a.kind) {
      case "bitcrush": {
        // sample-and-hold + bit reduction — crushed but still recognizably
        // the input, not full static
        const holdEvery = 2 + Math.floor(a.intensity * 9);
        a.crushCounter++;
        if (a.crushCounter >= holdEvery) {
          a.crushCounter = 0;
          a.crushHold = xs.slice();
        }
        const bits = Math.max(3, 8 - Math.floor(a.intensity * 4));
        const levels = Math.pow(2, bits);
        return a.crushHold.map((v) => Math.round(v * levels) / levels);
      }
      case "stutter": {
        // loops one fixed short grain of real audio for the whole event
        const len = a.stutterLen;
        const idx = (a.stutterStart + (a.readPos % len) + this.ringLen) % this.ringLen;
        a.readPos++;
        return [this.ring[0][idx], this.ring[1][idx]];
      }
      case "chop": {
        // re-picks a new short grain of real audio every few ms — a
        // stumbling, chattering rearrangement of what was just played
        if (!a.chopLen || a.chopReadPos >= a.chopLen) this.rerollChopGrain(a);
        const idx = (a.chopStart + a.chopReadPos + this.ringLen) % this.ringLen;
        a.chopReadPos++;
        return [this.ring[0][idx], this.ring[1][idx]];
      }
      case "dropout": {
        // the signal briefly cuts out entirely
        return [0, 0];
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
