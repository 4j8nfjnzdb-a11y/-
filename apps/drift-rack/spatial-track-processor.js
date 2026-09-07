// spatial-track-processor.js
//
// One instance = one "track" of the spatial delay bank. It continuously
// writes the live input into a long ring buffer (always sampling the last
// ~18 seconds, mirroring how a tape loop always has fresh material under
// the head) and separately plays back a *fixed-length window* of that
// buffer on loop.
//
// The loop's start point and length only change at an explicit "recapture"
// (grabbing a fresh recent window), never as a continuous ramp - that's
// deliberate: smoothly ramping a delay/loop time is what causes the
// pitch-bending "wobble" (moving where you read from a buffer while it
// plays is the same physics as varispeed). Recapture instead performs an
// instant cut with a short crossfade, so the loop point itself is always
// rock steady, and pitch/speed changes only ever come from the explicit
// `rate` AudioParam (a deliberate tape-style knob) or `reverse` flag.

class SpatialTrackProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "rate", defaultValue: 1, minValue: 0.1, maxValue: 4, automationRate: "a-rate" },
    ];
  }

  constructor() {
    super();
    this.maxSeconds = 18; // comfortably above the UI's 14s max loop length
    this.bufferLength = Math.ceil(sampleRate * this.maxSeconds);
    this.ringL = new Float32Array(this.bufferLength);
    this.ringR = new Float32Array(this.bufferLength);
    this.writeHead = 0;

    this.loopStartSamples = 0;
    this.loopLenSamples = Math.floor(sampleRate * 2);
    this.playPos = 0;
    this.reverse = false;

    this.fadeSamples = Math.floor(sampleRate * 0.02); // 20ms
    this.fadeCounter = null; // null = not fading

    this.pendingRecapture = null;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === "recapture") {
        this.pendingRecapture = {
          loopLenSamples: Math.max(1, Math.min(this.bufferLength - 2, Math.floor(d.loopLenSeconds * sampleRate))),
          reverse: !!d.reverse,
        };
      }
    };
  }

  _wrap(i) {
    i %= this.bufferLength;
    if (i < 0) i += this.bufferLength;
    return i;
  }

  _applyRecapture() {
    const { loopLenSamples, reverse } = this.pendingRecapture;
    this.pendingRecapture = null;
    this.loopLenSamples = loopLenSamples;
    this.reverse = reverse;
    // grab the most recent loopLenSamples ending "now" at the write head
    this.loopStartSamples = this._wrap(this.writeHead - this.loopLenSamples);
    this.playPos = reverse ? this.loopLenSamples - 1 : 0;
    this.fadeCounter = 0;
  }

  // A browser stops calling process() forever on a node the instant it
  // throws once - so any transient glitch (an interface renegotiating its
  // channel count on connect, a driver clock hiccup feeding a NaN/Infinity
  // sample, anything not anticipated here) would otherwise permanently and
  // silently kill this track for the rest of the session. Route every call
  // through this wrapper: on an unexpected error, report it once to the
  // main thread (so it shows up in the on-page diagnostics log instead of
  // vanishing) and output silence for that quantum instead of dying, so a
  // transient cause can recover on its own.
  process(inputs, outputs, parameters) {
    try {
      this._process(inputs, outputs, parameters);
    } catch (err) {
      if (!this._reportedError) {
        this._reportedError = true;
        this.port.postMessage({ type: "error", message: String((err && err.message) || err) });
      }
      const output = outputs[0];
      if (output) for (const channel of output) channel.fill(0);
    }
    return true;
  }

  _process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input.length > 1 ? input[1] : inL;
    const rateArr = parameters.rate;
    const n = outL.length;

    for (let i = 0; i < n; i++) {
      // sanitize: a single NaN/Infinity sample written into the ring
      // buffer would otherwise poison every interpolated read that
      // touches it for as long as it stays in the loop window
      let sampleL = inL ? inL[i] : 0;
      let sampleR = inR ? inR[i] : 0;
      if (!Number.isFinite(sampleL)) sampleL = 0;
      if (!Number.isFinite(sampleR)) sampleR = 0;
      this.ringL[this.writeHead] = sampleL;
      this.ringR[this.writeHead] = sampleR;

      if (this.pendingRecapture && this.fadeCounter === null) {
        this._applyRecapture();
      }

      const rate = rateArr.length > 1 ? rateArr[i] : rateArr[0];
      const step = this.reverse ? -rate : rate;

      // loopStartSamples is in [0, bufferLength) and playPos is always
      // kept within [0, loopLenSamples), so the sum overshoots bufferLength
      // by at most loopLenSamples - a single conditional subtraction is
      // enough to wrap it, avoiding a `%` in the hottest part of the loop
      let readIndex = this.loopStartSamples + this.playPos;
      if (readIndex >= this.bufferLength) readIndex -= this.bufferLength;
      const i0 = readIndex | 0;
      const frac = readIndex - i0;
      let i1 = i0 + 1;
      if (i1 >= this.bufferLength) i1 = 0;

      let sL = this.ringL[i0] * (1 - frac) + this.ringL[i1] * frac;
      let sR = this.ringR[i0] * (1 - frac) + this.ringR[i1] * frac;

      if (this.fadeCounter !== null) {
        const g = this.fadeCounter / this.fadeSamples;
        sL *= g;
        sR *= g;
        this.fadeCounter++;
        if (this.fadeCounter >= this.fadeSamples) this.fadeCounter = null;
      }

      outL[i] = sL;
      outR[i] = sR;

      this.playPos += step;
      if (this.loopLenSamples > 0) {
        while (this.playPos >= this.loopLenSamples) this.playPos -= this.loopLenSamples;
        while (this.playPos < 0) this.playPos += this.loopLenSamples;
      }

      this.writeHead++;
      if (this.writeHead >= this.bufferLength) this.writeHead = 0;
    }
  }
}

registerProcessor("spatial-track-processor", SpatialTrackProcessor);
