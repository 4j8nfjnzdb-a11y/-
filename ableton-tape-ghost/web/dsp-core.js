// Shared DSP core: circular recording buffer with variable-rate scrub readout,
// plus a simple delay-line granular pitch shifter. Written as plain functions/
// classes so the exact same code can be (a) unit-tested under Node and
// (b) embedded verbatim into the AudioWorkletProcessor that runs in the browser.

class RingChannel {
  constructor(length) {
    this.length = length | 0;
    this.data = new Float32Array(this.length);
  }
  write(absIndex, value) {
    const i = absIndex % this.length;
    this.data[i < 0 ? i + this.length : i] = value;
  }
  readInterp(pos) {
    const i0f = Math.floor(pos);
    const frac = pos - i0f;
    let i0 = i0f % this.length; if (i0 < 0) i0 += this.length;
    let i1 = i0 + 1; if (i1 >= this.length) i1 = 0;
    const a = this.data[i0], b = this.data[i1];
    return a + (b - a) * frac;
  }
}

// Simple real-time delay-line "granular" pitch shifter (two crossfading taps
// with a triangular window), the standard DIY DSP recipe for click-free-ish
// pitch shifting without FFT. `ratio` = 2^(semitones/12).
class GranularPitchShifter {
  constructor(sampleRate, windowSeconds = 0.08) {
    this.sampleRate = sampleRate;
    this.windowSamples = Math.max(64, Math.round(sampleRate * windowSeconds));
    // generous history so posA/posB never chase past what's been written, even
    // at extreme ratios (each tap can only drift ~ratio*windowSamples per grain)
    this.bufLen = this.windowSamples * 16;
    this.buf = new Float32Array(this.bufLen);
    this.writePos = 0;
    this.ratio = 1.0;

    this.grainPhaseA = 0;
    this.grainPhaseB = Math.floor(this.windowSamples / 2);
    this.posA = -this.windowSamples;
    this.posB = -this.windowSamples;
  }
  setRatio(r) { this.ratio = r; }
  _tri(x) {
    const t = x / this.windowSamples; // 0..1
    return 1 - Math.abs(2 * t - 1);
  }
  process(sample) {
    this.buf[this.writePos % this.bufLen] = sample;
    this.writePos++;

    // advance grain clocks in real time; on wrap, re-anchor that tap's read
    // position windowSamples behind "now" -- inaudible because the triangular
    // envelope is exactly 0 at phase 0.
    // Reset anchors subtract one extra `ratio` because the `+= ratio` just
    // below always runs afterward too; without this, every reset would add a
    // spurious +ratio jump (a slow pitch/position drift that's invisible at
    // ratio=1 only by accident of testing with short signals).
    this.grainPhaseA++;
    if (this.grainPhaseA >= this.windowSamples) {
      this.grainPhaseA = 0;
      this.posA = this.writePos - this.windowSamples - this.ratio;
    }
    this.grainPhaseB++;
    if (this.grainPhaseB >= this.windowSamples) {
      this.grainPhaseB = 0;
      this.posB = this.writePos - this.windowSamples - this.ratio;
    }

    // each tap's own read pointer moves at `ratio` samples per sample of real
    // time -- THIS is what shifts the pitch (independent of the fixed-rate
    // grain/window clock above, which only governs crossfade timing).
    this.posA += this.ratio;
    this.posB += this.ratio;

    const outA = this._readBuf(this.posA) * this._tri(this.grainPhaseA);
    const outB = this._readBuf(this.posB) * this._tri(this.grainPhaseB);
    return outA + outB;
  }
  _readBuf(pos) {
    const i0f = Math.floor(pos);
    const frac = pos - i0f;
    let i0 = i0f % this.bufLen; if (i0 < 0) i0 += this.bufLen;
    let i1 = i0 + 1; if (i1 >= this.bufLen) i1 = 0;
    const a = this.buf[i0], b = this.buf[i1];
    return a + (b - a) * frac;
  }
}

function semitonesToRatio(semi) {
  return Math.pow(2, semi / 12);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RingChannel, GranularPitchShifter, semitonesToRatio };
}
