// This text is concatenated after dsp-core.js and loaded into an AudioWorklet
// via a Blob URL (see app.js). Keep it dependency-free (no imports) since the
// blob has no meaningful base URL for module resolution.
//
// TapeGhostEngine holds all the actual per-sample logic and is plain JS with
// no AudioWorklet dependency, so the exact same class is also loaded under
// Node in test-engine.js for offline scenario testing.

class TapeGhostEngine {
  constructor(sr, bufferSeconds) {
    this.sr = sr;
    this.bufferSamples = Math.max(1, Math.round(bufferSeconds * sr));
    this.minGuard = Math.round(0.05 * sr);

    this.ringL = new RingChannel(this.bufferSamples);
    this.ringR = new RingChannel(this.bufferSamples);

    this.writeCounter = 0;
    this.readPos = 0;
    this.idleAnchored = false;
    this.minDelaySamples = Math.round(2.0 * sr);

    this.rewindOn = false;
    this.rewindSpeed = 1.0;

    this.loopActive = false;
    this.loopGain = 0.0;
    this.loopGainStep = 1 / (0.015 * sr);
    this.loopStartAbs = 0;
    this.loopLen = Math.round(0.2 * sr);
    this.loopLocal = 0;
    this.loopRate = 1.0;
    this.loopClickState = 0;
    this.pendingLoopStart = 0;
    this.loopEdgeFadeSamples = Math.round(0.006 * sr); // ~6ms declick at each segment's own start/end

    this.mix = 0.0;
    this.mixSmoothed = 0.0;
    this.mixSmoothStep = 1 / (0.03 * sr);

    // input level meter (peak with decay) -- exists purely so the UI can show
    // "is any signal actually arriving from the selected input device at
    // all", independent of Mix/effect state, since that's the first thing to
    // check when an audio interface "makes no sound" through a web page.
    this.inputPeak = 0.0;
    this.inputPeakDecay = Math.pow(0.001, 1 / (0.3 * sr)); // ~300ms fall to -60dB

    this.pitchSemitones = 0.0;
    this.pitchShifterL = new GranularPitchShifter(sr, 0.08);
    this.pitchShifterR = new GranularPitchShifter(sr, 0.08);

    // feedback echo/delay applied to the wet (post pitch-shift) signal, so the
    // scrubbed/looped/cut-up material can trail off into repeats instead of
    // cutting dry. Off by default (mix 0) so it doesn't change prior behavior
    // until the user dials it in.
    const delayBufSeconds = 3.0;
    this.delayBufL = new RingChannel(Math.round(delayBufSeconds * sr));
    this.delayBufR = new RingChannel(Math.round(delayBufSeconds * sr));
    this.delayCounter = 0;
    this.delayTimeSec = 0.3;
    this.delayFeedback = 0.35;
    this.delayMix = 0.0;
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'setMix': this.mix = msg.value; break;
      case 'setPitch':
        this.pitchSemitones = msg.value;
        this.pitchShifterL.setRatio(semitonesToRatio(this.pitchSemitones));
        this.pitchShifterR.setRatio(semitonesToRatio(this.pitchSemitones));
        break;
      case 'setDelayTime': this.delayTimeSec = Math.max(0.02, Math.min(3.0, msg.value)); break;
      case 'setDelayFeedback': this.delayFeedback = Math.max(0, Math.min(0.95, msg.value)); break;
      case 'setDelayMix': this.delayMix = Math.max(0, Math.min(1, msg.value)); break;
      case 'setRewindSpeed': this.rewindSpeed = msg.value; break;
      case 'rewind': this.rewindOn = !!msg.on; break;
      case 'jump': {
        const back = Math.max(0, msg.seconds) * this.sr;
        let target = this.writeCounter - back;
        target = Math.max(this.writeCounter - (this.bufferSamples - this.minGuard), target);
        this.readPos = target;
        break;
      }
      case 'loopMarkClick': {
        this.loopClickState = (this.loopClickState + 1) % 3;
        if (this.loopClickState === 1) {
          this.pendingLoopStart = this.readPos;
        } else if (this.loopClickState === 2) {
          const start = this.pendingLoopStart;
          const end = this.readPos;
          this.loopStartAbs = start;
          this.loopLen = Math.max(Math.round(0.05 * this.sr), Math.round(end - start));
          this.loopLocal = 0;
          this.loopRate = 1.0;
          this.loopActive = true;
        } else {
          this.loopActive = false;
        }
        break;
      }
      case 'loopShift': {
        const shiftSamples = Math.max(0, msg.seconds) * this.sr;
        this.loopStartAbs -= shiftSamples;
        this.loopLocal = 0;
        this.loopRate = 1.0;
        this.loopActive = true;
        break;
      }
      case 'freeze': {
        this.loopStartAbs = this.readPos;
        this.loopLen = Math.max(Math.round(0.05 * this.sr), Math.round((msg.lenSeconds || 0.2) * this.sr));
        this.loopLocal = 0;
        this.loopRate = 1.0;
        this.loopActive = true;
        this.loopClickState = 2;
        break;
      }
      case 'miracleSegment': {
        const startAgo = Math.max(0, msg.startAgoSeconds) * this.sr;
        let start = this.writeCounter - startAgo;
        start = Math.max(this.writeCounter - (this.bufferSamples - this.minGuard), start);
        this.loopStartAbs = start;
        this.loopLen = Math.max(Math.round(0.05 * this.sr), Math.round(msg.lenSeconds * this.sr));
        this.loopLocal = 0;
        this.loopRate = msg.speedMul || 1.0;
        this.loopActive = true;
        this.loopClickState = 2;
        break;
      }
      case 'miracleOff':
      case 'loopOff': {
        this.loopActive = false;
        this.loopClickState = 0;
        break;
      }
    }
  }

  // returns [outL, outR]
  processSample(sampleL, sampleR) {
    const inAbs = Math.max(Math.abs(sampleL), Math.abs(sampleR));
    this.inputPeak = Math.max(inAbs, this.inputPeak * this.inputPeakDecay);

    this.ringL.write(this.writeCounter, sampleL);
    this.ringR.write(this.writeCounter, sampleR);
    this.writeCounter++;

    if (!this.idleAnchored && this.writeCounter >= this.minDelaySamples) {
      this.readPos = this.writeCounter - this.minDelaySamples;
      this.idleAnchored = true;
    }

    if (this.rewindOn) {
      this.readPos -= this.rewindSpeed;
    } else {
      this.readPos += 1;
    }
    const minReadPos = this.writeCounter - (this.bufferSamples - this.minGuard);
    if (this.readPos < minReadPos) this.readPos = minReadPos;
    if (this.readPos > this.writeCounter) this.readPos = this.writeCounter;

    const scrubL = this.ringL.readInterp(this.readPos);
    const scrubR = this.ringR.readInterp(this.readPos);

    const targetLoopGain = this.loopActive ? 1 : 0;
    if (this.loopGain < targetLoopGain) this.loopGain = Math.min(targetLoopGain, this.loopGain + this.loopGainStep);
    else if (this.loopGain > targetLoopGain) this.loopGain = Math.max(targetLoopGain, this.loopGain - this.loopGainStep);

    let wetL = scrubL, wetR = scrubR;
    if (this.loopGain > 0) {
      this.loopLocal = (this.loopLocal + this.loopRate) % this.loopLen;
      const loopPos = this.loopStartAbs + this.loopLocal;
      let loopL = this.ringL.readInterp(loopPos);
      let loopR = this.ringR.readInterp(loopPos);

      // Every new Loop/Miracle segment jumps loopStartAbs and resets
      // loopLocal to 0 with no crossfade of its own -- fine for an occasional
      // manual Loop Mark, but Miracle re-triggers this every 80-580ms, so an
      // uncovered hard waveform discontinuity there reads as constant
      // crackling ("bu-tsu-bu-tsu") rather than a single click. A short
      // fade in/out at each segment's own start/end (not the loopGain
      // crossfade above, which only covers scrub<->loop, not loop<->loop)
      // covers exactly that transition.
      const edgeFade = Math.min(this.loopEdgeFadeSamples, this.loopLen / 4);
      if (edgeFade > 0) {
        let env = 1.0;
        if (this.loopLocal < edgeFade) env = this.loopLocal / edgeFade;
        else if (this.loopLocal > this.loopLen - edgeFade) env = (this.loopLen - this.loopLocal) / edgeFade;
        loopL *= env;
        loopR *= env;
      }

      wetL = scrubL * (1 - this.loopGain) + loopL * this.loopGain;
      wetR = scrubR * (1 - this.loopGain) + loopR * this.loopGain;
    }

    const pitchedL = this.pitchShifterL.process(wetL);
    const pitchedR = this.pitchShifterR.process(wetR);

    // feedback delay/echo, tapped in parallel (dry pitched signal blended
    // with the delayed tap by delayMix) so delayMix=0 is an exact passthrough
    const delayTimeSamples = this.delayTimeSec * this.sr;
    const dL = this.delayBufL.readInterp(this.delayCounter - delayTimeSamples);
    const dR = this.delayBufR.readInterp(this.delayCounter - delayTimeSamples);
    this.delayBufL.write(this.delayCounter, pitchedL + dL * this.delayFeedback);
    this.delayBufR.write(this.delayCounter, pitchedR + dR * this.delayFeedback);
    this.delayCounter++;
    const echoedL = pitchedL * (1 - this.delayMix) + dL * this.delayMix;
    const echoedR = pitchedR * (1 - this.delayMix) + dR * this.delayMix;

    if (this.mixSmoothed < this.mix) this.mixSmoothed = Math.min(this.mix, this.mixSmoothed + this.mixSmoothStep);
    else if (this.mixSmoothed > this.mix) this.mixSmoothed = Math.max(this.mix, this.mixSmoothed - this.mixSmoothStep);

    const outL = sampleL * (1 - this.mixSmoothed) + echoedL * this.mixSmoothed;
    const outR = sampleR * (1 - this.mixSmoothed) + echoedR * this.mixSmoothed;
    return [outL, outR];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.TapeGhostEngine = TapeGhostEngine;
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class TapeGhostProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() { return []; }

    constructor(options) {
      super();
      const opts = options.processorOptions || {};
      this.engine = new TapeGhostEngine(opts.sampleRate || sampleRate, opts.bufferSeconds || 300);
      this.statusCounter = 0;
      this.port.onmessage = (e) => this.engine.handleMessage(e.data);
    }

    process(inputs, outputs) {
      const input = inputs[0];
      const output = outputs[0];
      const inL = (input && input[0]) || null;
      const inR = (input && input[1]) || (input && input[0]) || null;
      const outL = output[0];
      const outR = output[1] || output[0];
      const n = outL.length;

      for (let i = 0; i < n; i++) {
        const [l, r] = this.engine.processSample(inL ? inL[i] : 0, inR ? inR[i] : 0);
        outL[i] = l;
        outR[i] = r;
      }

      this.statusCounter += n;
      if (this.statusCounter >= this.engine.sr * 0.05) {
        this.statusCounter = 0;
        this.port.postMessage({
          type: 'status',
          writeSec: this.engine.writeCounter / this.engine.sr,
          readAgoSec: (this.engine.writeCounter - this.engine.readPos) / this.engine.sr,
          loopActive: this.engine.loopActive,
          inputPeak: this.engine.inputPeak,
        });
      }
      return true;
    }
  }

  registerProcessor('tape-ghost-processor', TapeGhostProcessor);
}
