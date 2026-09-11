// son morph — live preview processor
//
// Runs on the audio render thread (AudioWorkletGlobalScope), which has
// no access to the main thread's scripts, so the FFT / phase-vocoder /
// spectral-shaping math here intentionally mirrors dsp.js + engine.js
// rather than importing them. It's the same algorithm, restructured
// from "render everything in one batch loop" into "synthesize one more
// hop's worth of audio whenever the playhead is about to catch up to
// what's already been synthesized" so it can run continuously in real
// time while parameters and the morph trajectory change underneath it.

const TWO_PI = Math.PI * 2;
const EPS = 1e-8;
const MEDIAN_WIN = 9;
const FREQ_WIN = 4;

function fft(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (invert ? 1 : -1) * TWO_PI / len;
    const wlr = Math.cos(ang), wli = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = i + j + half;
        const vr = re[b] * wr - im[b] * wi;
        const vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] = re[a] + vr; im[a] = im[a] + vi;
        const nwr = wr * wlr - wi * wli;
        wi = wr * wli + wi * wlr;
        wr = nwr;
      }
    }
  }
  if (invert) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / (n - 1));
  return w;
}

function wrapPhase(p) {
  p = (p + Math.PI) % TWO_PI;
  if (p < 0) p += TWO_PI;
  return p - Math.PI;
}

function extractFrame(data, startSample, frameSize, window, out) {
  const n = data.length;
  for (let i = 0; i < frameSize; i++) {
    const pos = startSample + i;
    const i0 = Math.floor(pos), frac = pos - i0;
    const s0 = (i0 >= 0 && i0 < n) ? data[i0] : 0;
    const s1 = (i0 + 1 >= 0 && i0 + 1 < n) ? data[i0 + 1] : 0;
    out[i] = (s0 + (s1 - s0) * frac) * window[i];
  }
}

function analyzeFrame(frameSamples, scratchRe, scratchIm, magOut, phaseOut) {
  const n = frameSamples.length;
  scratchRe.set(frameSamples);
  scratchIm.fill(0);
  fft(scratchRe, scratchIm, false);
  const bins = n / 2 + 1;
  for (let b = 0; b < bins; b++) {
    const re = scratchRe[b], im = scratchIm[b];
    magOut[b] = Math.sqrt(re * re + im * im);
    phaseOut[b] = Math.atan2(im, re);
  }
}

function boxFilter(src, radius, dst, prefix) {
  const n = src.length;
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + src[i];
  for (let i = 0; i < n; i++) {
    const lo = i - radius < 0 ? 0 : i - radius;
    const hi = i + radius >= n ? n - 1 : i + radius;
    dst[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
}

function spectralEnvelope(logMag, radius, out, tmp, prefix) {
  boxFilter(logMag, radius, tmp, prefix);
  boxFilter(tmp, radius, out, prefix);
}

function sharpen(w, gamma) {
  const a = Math.pow(Math.min(1, Math.max(0, w)), gamma);
  const b = Math.pow(Math.min(1, Math.max(0, 1 - w)), gamma);
  return a / (a + b || 1);
}

function medianSmall(buf, len) {
  for (let i = 1; i < len; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
    buf[j + 1] = v;
  }
  const m = len >> 1;
  return len % 2 ? buf[m] : (buf[m - 1] + buf[m]) / 2;
}

function pitchShiftBins(mag, phase, ratio, outMag, outPhase) {
  const n = mag.length;
  for (let i = 0; i < n; i++) {
    const srcIdx = i / ratio;
    const i0 = Math.floor(srcIdx), frac = srcIdx - i0;
    if (i0 >= 0 && i0 < n - 1) {
      outMag[i] = mag[i0] + (mag[i0 + 1] - mag[i0]) * frac;
      const dp = wrapPhase(phase[i0 + 1] - phase[i0]);
      outPhase[i] = phase[i0] + dp * frac;
    } else if (i0 === n - 1) {
      outMag[i] = mag[i0]; outPhase[i] = phase[i0];
    } else {
      outMag[i] = 0; outPhase[i] = 0;
    }
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function lookupTable(table, t) {
  if (!table) return t;
  const pos = t * (table.length - 1);
  const i0 = Math.floor(pos), frac = pos - i0;
  const i1 = Math.min(table.length - 1, i0 + 1);
  return table[i0] + (table[i1] - table[i0]) * frac;
}

const DEFAULT_PARAMS = {
  phaseLock: true, formantAmt: 85, harmonicAmt: 100, crossSynthesis: 0,
  transientPreserve: 55, percussionSeparation: 60, toneNoiseBalance: 0,
  overmorph: false,
};

// One source's phase-vocoder analysis + resynthesis onto a common,
// uniformly-hopped output timeline. Two of these (A and B) get combined
// bin-by-bin every frame — mirrors engine.js's per-channel loop body,
// but pulled one frame at a time instead of driven by a batch for-loop.
class ChannelMorpher {
  constructor(dataA, dataB, durA, durB, outSR, frameSize, hop) {
    this.dataA = dataA; this.dataB = dataB;
    this.durA = durA; this.durB = durB;
    this.outSR = outSR; this.frameSize = frameSize; this.hop = hop;
    this.bins = frameSize / 2 + 1;
    this.win = hannWindow(frameSize);
    this.envRadius = Math.max(1, Math.round(frameSize / 128));

    this.params = Object.assign({}, DEFAULT_PARAMS);
    this.trajTable = null;
    this.warpTable = null;
    this.pitchRatioA = 1; this.pitchRatioB = 1;
    this.gainA = 1; this.gainB = 1;
    this.outDuration = durA;

    this.ringSize = frameSize * 3;
    this.ring = new Float32Array(this.ringSize);
    this.ringNorm = new Float32Array(this.ringSize);

    this._allocScratch();
    this.resetState();
  }

  _allocScratch() {
    const bins = this.bins, frameSize = this.frameSize;
    this.scratchRe = new Float32Array(frameSize);
    this.scratchIm = new Float32Array(frameSize);
    this.frameBuf = new Float32Array(frameSize);
    this.magA = new Float32Array(bins); this.phaseA = new Float32Array(bins);
    this.magB = new Float32Array(bins); this.phaseB = new Float32Array(bins);
    this.magAraw = new Float32Array(bins); this.phaseAraw = new Float32Array(bins);
    this.magBraw = new Float32Array(bins); this.phaseBraw = new Float32Array(bins);
    this.logMagA = new Float32Array(bins); this.logMagB = new Float32Array(bins);
    this.envAarr = new Float32Array(bins); this.envBarr = new Float32Array(bins);
    this.resAarr = new Float32Array(bins); this.resBarr = new Float32Array(bins);
    this.finalMag = new Float32Array(bins); this.finalPhase = new Float32Array(bins);
    this.crossMag = new Float32Array(bins);
    this.envScratchTmp = new Float32Array(bins);
    this.envScratchPrefix = new Float32Array(bins + 1);
    this.harmComp = new Float32Array(bins); this.percComp = new Float32Array(bins);
    this.medianTimeBuf = new Float32Array(MEDIAN_WIN);
    this.medianFreqBuf = new Float32Array(FREQ_WIN * 2 + 1);
    this.medianRing = Array.from({ length: MEDIAN_WIN }, () => new Float32Array(bins));
  }

  resetState() {
    this.k = 0;
    this.synthesizedUpTo = 0;
    this.readPos = 0;
    this.ring.fill(0);
    this.ringNorm.fill(0);
    this.synthPhaseA = new Float32Array(this.bins);
    this.synthPhaseB = new Float32Array(this.bins);
    this.prevPhaseArawStore = new Float32Array(this.bins);
    this.prevPhaseBrawStore = new Float32Array(this.bins);
    this.prevSrcPosA = 0; this.prevSrcPosB = 0;
    this.prevFinalMag = new Float32Array(this.bins);
    this.runningFluxMax = 1e-4;
    this.ringPos = 0; this.ringFilled = 0;
  }

  setParams(p) { this.params = p; }
  setTrajTable(t) { this.trajTable = t; }
  setAnalysis(a) {
    this.warpTable = a.warpTable || null;
    this.pitchRatioA = a.pitchRatioA || 1;
    this.pitchRatioB = a.pitchRatioB || 1;
    this.gainA = a.gainA || 1;
    this.gainB = a.gainB || 1;
  }
  setOutDuration(d) { this.outDuration = d; }

  ringIndex(absPos) { return ((absPos % this.ringSize) + this.ringSize) % this.ringSize; }

  synthesizeFrame() {
    const { bins, frameSize, hop, outSR, durA, durB, win } = this;
    const p = this.params;
    const k = this.k++;
    const outStart = k * hop;
    const tOut = outStart / outSR;
    const tNorm = clamp(tOut / Math.max(this.outDuration, 1e-6), 0, 1);
    const wRaw = lookupTable(this.trajTable, tNorm);
    const w = p.overmorph ? clamp(wRaw, -0.4, 1.4) : clamp(wRaw, 0, 1);
    const wClamped = clamp(w, 0, 1);
    const overshoot = w - wClamped;

    const tNormA = tNorm;
    const tNormB = this.warpTable ? lookupTable(this.warpTable, tNormA) : tNorm;
    const srcPosA = tNormA * durA * outSR;
    const srcPosB = tNormB * durB * outSR;

    extractFrame(this.dataA, srcPosA - frameSize / 2, frameSize, win, this.frameBuf);
    analyzeFrame(this.frameBuf, this.scratchRe, this.scratchIm, this.magAraw, this.phaseAraw);
    extractFrame(this.dataB, srcPosB - frameSize / 2, frameSize, win, this.frameBuf);
    analyzeFrame(this.frameBuf, this.scratchRe, this.scratchIm, this.magBraw, this.phaseBraw);

    if (this.pitchRatioA !== 1) pitchShiftBins(this.magAraw, this.phaseAraw, this.pitchRatioA, this.magA, this.phaseA);
    else { this.magA.set(this.magAraw); this.phaseA.set(this.phaseAraw); }
    if (this.pitchRatioB !== 1) pitchShiftBins(this.magBraw, this.phaseBraw, this.pitchRatioB, this.magB, this.phaseB);
    else { this.magB.set(this.magBraw); this.phaseB.set(this.phaseBraw); }

    if (this.gainA !== 1) for (let b = 0; b < bins; b++) this.magA[b] *= this.gainA;
    if (this.gainB !== 1) for (let b = 0; b < bins; b++) this.magB[b] *= this.gainB;

    if (k === 0) {
      this.synthPhaseA.set(this.phaseA);
      this.synthPhaseB.set(this.phaseB);
    } else if (p.phaseLock) {
      const deltaA = srcPosA - this.prevSrcPosA;
      const deltaB = srcPosB - this.prevSrcPosB;
      for (let b = 0; b < bins; b++) {
        const expA = (TWO_PI * b * deltaA) / frameSize;
        const dPA = wrapPhase(this.phaseA[b] - this.prevPhaseArawStore[b] - expA);
        this.synthPhaseA[b] = this.synthPhaseA[b] + expA + dPA;
        const expB = (TWO_PI * b * deltaB) / frameSize;
        const dPB = wrapPhase(this.phaseB[b] - this.prevPhaseBrawStore[b] - expB);
        this.synthPhaseB[b] = this.synthPhaseB[b] + expB + dPB;
      }
    } else {
      this.synthPhaseA.set(this.phaseA);
      this.synthPhaseB.set(this.phaseB);
    }
    this.prevPhaseArawStore.set(this.phaseA);
    this.prevPhaseBrawStore.set(this.phaseB);
    this.prevSrcPosA = srcPosA;
    this.prevSrcPosB = srcPosB;

    for (let b = 0; b < bins; b++) {
      this.logMagA[b] = Math.log(this.magA[b] + EPS);
      this.logMagB[b] = Math.log(this.magB[b] + EPS);
    }
    spectralEnvelope(this.logMagA, this.envRadius, this.envAarr, this.envScratchTmp, this.envScratchPrefix);
    spectralEnvelope(this.logMagB, this.envRadius, this.envBarr, this.envScratchTmp, this.envScratchPrefix);
    for (let b = 0; b < bins; b++) {
      this.resAarr[b] = this.logMagA[b] - this.envAarr[b];
      this.resBarr[b] = this.logMagB[b] - this.envBarr[b];
    }

    const gammaEnv = 1 + ((100 - p.formantAmt) / 100) * 3;
    const gammaRes = 1 + ((100 - p.harmonicAmt) / 100) * 3;
    const wEnv = sharpen(wClamped, gammaEnv) + overshoot;
    const wRes = sharpen(wClamped, gammaRes) + overshoot;

    for (let b = 0; b < bins; b++) {
      const envMix = lerp(this.envAarr[b], this.envBarr[b], wEnv);
      const resMix = lerp(this.resAarr[b], this.resBarr[b], wRes);
      this.finalMag[b] = Math.exp(envMix + resMix);
    }

    if (p.crossSynthesis > 0) {
      const amt = p.crossSynthesis / 100;
      for (let b = 0; b < bins; b++) {
        const envMix = lerp(this.envAarr[b], this.envBarr[b], w);
        const resSwap = lerp(this.resBarr[b], this.resAarr[b], w);
        this.crossMag[b] = Math.exp(envMix + resSwap);
        this.finalMag[b] = lerp(this.finalMag[b], this.crossMag[b], amt);
      }
    }

    for (let b = 0; b < bins; b++) {
      const ux = (1 - w) * Math.cos(this.synthPhaseA[b]) + w * Math.cos(this.synthPhaseB[b]);
      const uy = (1 - w) * Math.sin(this.synthPhaseA[b]) + w * Math.sin(this.synthPhaseB[b]);
      this.finalPhase[b] = Math.atan2(uy, ux);
    }

    if (p.transientPreserve > 0 && k > 0) {
      let flux = 0;
      for (let b = 0; b < bins; b++) flux += Math.max(0, this.finalMag[b] - this.prevFinalMag[b]);
      this.runningFluxMax = Math.max(this.runningFluxMax * 0.98, flux);
      const strength = flux / Math.max(this.runningFluxMax, EPS);
      if (strength > 0.5) {
        const snapTarget = wClamped < 0.5 ? this.magA : this.magB;
        const amt = (p.transientPreserve / 100) * Math.min(1, (strength - 0.5) * 2);
        for (let b = 0; b < bins; b++) this.finalMag[b] = lerp(this.finalMag[b], snapTarget[b], amt);
      }
    }
    this.prevFinalMag.set(this.finalMag);

    if (p.percussionSeparation > 0) {
      this.medianRing[this.ringPos].set(this.finalMag);
      this.ringPos = (this.ringPos + 1) % MEDIAN_WIN;
      this.ringFilled = Math.min(MEDIAN_WIN, this.ringFilled + 1);
      for (let b = 0; b < bins; b++) {
        for (let r = 0; r < this.ringFilled; r++) this.medianTimeBuf[r] = this.medianRing[r][b];
        this.harmComp[b] = medianSmall(this.medianTimeBuf, this.ringFilled);

        const lo = b - FREQ_WIN < 0 ? 0 : b - FREQ_WIN;
        const hi = b + FREQ_WIN >= bins ? bins - 1 : b + FREQ_WIN;
        let flen = 0;
        for (let x = lo; x <= hi; x++) this.medianFreqBuf[flen++] = this.finalMag[x];
        this.percComp[b] = medianSmall(this.medianFreqBuf, flen);
      }
      const tilt = p.toneNoiseBalance / 100;
      const harmGain = 1 + Math.max(0, tilt) * 1.5 - Math.max(0, -tilt) * 0.8;
      const percGain = 1 + Math.max(0, -tilt) * 1.5 - Math.max(0, tilt) * 0.8;
      const blend = p.percussionSeparation / 100;
      for (let b = 0; b < bins; b++) {
        const recombined = this.harmComp[b] * harmGain + this.percComp[b] * percGain;
        this.finalMag[b] = lerp(this.finalMag[b], recombined, blend);
      }
    }

    this.scratchRe.fill(0); this.scratchIm.fill(0);
    for (let b = 0; b < bins; b++) {
      const re = this.finalMag[b] * Math.cos(this.finalPhase[b]);
      const im = this.finalMag[b] * Math.sin(this.finalPhase[b]);
      this.scratchRe[b] = re; this.scratchIm[b] = im;
      if (b > 0 && b < frameSize - b) {
        this.scratchRe[frameSize - b] = re;
        this.scratchIm[frameSize - b] = -im;
      }
    }
    fft(this.scratchRe, this.scratchIm, true);

    // A conservative fixed headroom scalar stands in for offline peak
    // normalization, which needs a whole-file max we don't have here.
    const HEADROOM = 0.85;
    for (let n = 0; n < frameSize; n++) {
      const idx = this.ringIndex(outStart + n);
      const wv = win[n];
      this.ring[idx] += this.scratchRe[n] * wv * HEADROOM;
      this.ringNorm[idx] += wv * wv;
    }
    this.synthesizedUpTo = outStart + hop;
  }

  ensureSynthesized(need) {
    let guard = 0;
    while (this.synthesizedUpTo < need + this.frameSize && guard++ < 64) this.synthesizeFrame();
  }

  nextSample() {
    const outLen = Math.max(1, Math.round(this.outDuration * this.outSR));
    if (this.readPos >= outLen) this.resetState();
    this.ensureSynthesized(this.readPos + 1);
    const idx = this.ringIndex(this.readPos);
    const norm = this.ringNorm[idx];
    const v = norm > 1e-6 ? this.ring[idx] / norm : 0;
    this.ring[idx] = 0; this.ringNorm[idx] = 0;
    this.readPos++;
    return v;
  }

  get tNorm() {
    return clamp(this.readPos / Math.max(1, Math.round(this.outDuration * this.outSR)), 0, 1);
  }
}

class MorphProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = null;
    this.right = null;
    this.ready = false;
    this.posCounter = 0;
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    if (msg.type === "init") {
      const { frameSize, hop, outSR, durA, durB, outDuration, dataAL, dataAR, dataBL, dataBR, params, trajTable, analysis } = msg;
      this.left = new ChannelMorpher(dataAL, dataBL, durA, durB, outSR, frameSize, hop);
      this.right = new ChannelMorpher(dataAR, dataBR, durA, durB, outSR, frameSize, hop);
      [this.left, this.right].forEach((m) => {
        m.setParams(params);
        m.setTrajTable(trajTable);
        m.setAnalysis(analysis);
        m.setOutDuration(outDuration);
      });
      this.ready = true;
      this.port.postMessage({ type: "ready" });
    } else if (msg.type === "params" && this.ready) {
      this.left.setParams(msg.params);
      this.right.setParams(msg.params);
    } else if (msg.type === "traj" && this.ready) {
      this.left.setTrajTable(msg.trajTable);
      this.right.setTrajTable(msg.trajTable);
    } else if (msg.type === "analysis" && this.ready) {
      this.left.setAnalysis(msg.analysis);
      this.right.setAnalysis(msg.analysis);
    } else if (msg.type === "duration" && this.ready) {
      this.left.setOutDuration(msg.outDuration);
      this.right.setOutDuration(msg.outDuration);
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!this.ready || !out || out.length < 1) return true;
    const l = out[0], r = out.length > 1 ? out[1] : out[0];
    for (let i = 0; i < l.length; i++) {
      l[i] = this.left.nextSample();
      r[i] = this.right.nextSample();
    }
    this.posCounter += l.length;
    if (this.posCounter >= 2048) {
      this.posCounter = 0;
      this.port.postMessage({ type: "pos", tNorm: this.left.tNorm });
    }
    return true;
  }
}

if (typeof registerProcessor === "function") {
  registerProcessor("morph-processor", MorphProcessor);
}

// Exposed only for Node-based unit testing of ChannelMorpher; a real
// AudioWorkletGlobalScope has no `module`, so this is a no-op there.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ChannelMorpher };
}
