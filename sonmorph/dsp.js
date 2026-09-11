// son morph — spectral morphing DSP core
//
// Everything here is plain signal processing: a radix-2 FFT, a
// phase-vocoder analysis/resynthesis pair that can run two sources at
// independent, time-varying stretch rates, and a handful of spectral
// shaping stages (formant/envelope split, cross-synthesis, harmonic /
// percussive reshaping, transient snapping) that get combined per
// output frame according to the morph trajectory.

(function (root) {
  const TWO_PI = Math.PI * 2;

  // ---- FFT --------------------------------------------------------
  // In-place iterative radix-2 Cooley-Tukey. `re`/`im` length must be a
  // power of two.
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
    if (invert) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
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

  // ---- frame extraction --------------------------------------------
  // Pulls `frameSize` samples starting at a (possibly fractional)
  // sample offset, linearly interpolated, zero-padded past the edges,
  // and applies `window`.
  function extractFrame(data, startSample, frameSize, window, out) {
    out = out || new Float32Array(frameSize);
    const n = data.length;
    for (let i = 0; i < frameSize; i++) {
      const pos = startSample + i;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = (i0 >= 0 && i0 < n) ? data[i0] : 0;
      const s1 = (i0 + 1 >= 0 && i0 + 1 < n) ? data[i0 + 1] : 0;
      out[i] = (s0 + (s1 - s0) * frac) * window[i];
    }
    return out;
  }

  // Analyses one real frame -> magnitude/phase for bins [0..N/2].
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

  // ---- spectral envelope (cheap cepstral-style smoothing) -----------
  // Smooths log-magnitude across frequency with a couple of box-filter
  // passes (approximates a low-order cepstral lifter without the
  // extra FFT round trip).
  function boxFilter(src, radius, dst) {
    const n = src.length;
    for (let i = 0; i < n; i++) {
      let sum = 0, count = 0;
      for (let k = -radius; k <= radius; k++) {
        const idx = i + k;
        if (idx >= 0 && idx < n) { sum += src[idx]; count++; }
      }
      dst[i] = sum / count;
    }
    return dst;
  }

  function spectralEnvelope(logMag, radius, out) {
    const n = logMag.length;
    out = out || new Float32Array(n);
    const tmp = new Float32Array(n);
    boxFilter(logMag, radius, tmp);
    boxFilter(tmp, radius, out);
    return out;
  }

  // ---- small median filter (for harmonic/percussive reshaping) -----
  function median(arr) {
    const a = Array.prototype.slice.call(arr).sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // ---- pitch estimate (autocorrelation) -----------------------------
  function estimatePitch(data, sampleRate, centerSample, windowSize) {
    const start = Math.max(0, Math.min(data.length - windowSize, Math.round(centerSample - windowSize / 2)));
    const minLag = Math.floor(sampleRate / 800);
    const maxLag = Math.floor(sampleRate / 60);
    let bestLag = -1, bestVal = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < windowSize - lag; i++) {
        sum += data[start + i] * data[start + i + lag];
      }
      if (sum > bestVal) { bestVal = sum; bestLag = lag; }
    }
    if (bestLag <= 0) return null;
    return sampleRate / bestLag;
  }

  function rmsEnergyContour(data, sampleRate, points) {
    const contour = new Float32Array(points);
    const winSize = Math.max(1, Math.floor(data.length / points));
    for (let p = 0; p < points; p++) {
      const start = p * winSize;
      const end = Math.min(data.length, start + winSize);
      let sum = 0;
      for (let i = start; i < end; i++) sum += data[i] * data[i];
      contour[p] = Math.sqrt(sum / Math.max(1, end - start));
    }
    return contour;
  }

  // ---- DTW alignment -------------------------------------------------
  // Aligns B's energy contour to A's, returns a function mapping a
  // normalized position in A's timeline (0..1) to a normalized
  // position in B's timeline (0..1).
  function dtwWarp(envA, envB) {
    const n = envA.length, m = envB.length;
    const INF = Infinity;
    const cost = new Float32Array(n * m).fill(INF);
    const at = (i, j) => cost[i * m + j];
    const set = (i, j, v) => { cost[i * m + j] = v; };
    const d = (i, j) => Math.abs(envA[i] - envB[j]);
    set(0, 0, d(0, 0));
    for (let i = 1; i < n; i++) set(i, 0, at(i - 1, 0) + d(i, 0));
    for (let j = 1; j < m; j++) set(0, j, at(0, j - 1) + d(0, j));
    for (let i = 1; i < n; i++) {
      for (let j = 1; j < m; j++) {
        const best = Math.min(at(i - 1, j), at(i, j - 1), at(i - 1, j - 1));
        set(i, j, best + d(i, j));
      }
    }
    // backtrack
    const path = [];
    let i = n - 1, j = m - 1;
    path.push([i, j]);
    while (i > 0 || j > 0) {
      if (i === 0) { j--; }
      else if (j === 0) { i--; }
      else {
        const choices = [at(i - 1, j), at(i, j - 1), at(i - 1, j - 1)];
        const idx = choices.indexOf(Math.min.apply(null, choices));
        if (idx === 0) i--; else if (idx === 1) j--; else { i--; j--; }
      }
      path.push([i, j]);
    }
    path.reverse();
    // Build a lookup: for each A-index, the (last) matching B-index.
    const aToB = new Float32Array(n);
    let pi = 0;
    for (let ai = 0; ai < n; ai++) {
      while (pi < path.length - 1 && path[pi][0] < ai) pi++;
      aToB[ai] = path[pi][1];
    }
    return function (tNorm) {
      const pos = tNorm * (n - 1);
      const i0 = Math.floor(pos), frac = pos - i0;
      const i1 = Math.min(n - 1, i0 + 1);
      const bIdx = aToB[i0] + (aToB[i1] - aToB[i0]) * frac;
      return bIdx / Math.max(1, m - 1);
    };
  }

  // ---- curve shaping for the morph trajectory -----------------------
  function sCurve(t, tension) {
    // tension 0..100 -> steepness; 50 is a "classic" smoothstep.
    const k = 1 + (tension / 50 - 1) * 3; // ~ -2..4 exponent bias
    const x = Math.min(1, Math.max(0, t));
    const shaped = Math.pow(x, k) / (Math.pow(x, k) + Math.pow(1 - x, k) || 1);
    return shaped;
  }

  function sharpen(w, gamma) {
    const a = Math.pow(Math.min(1, Math.max(0, w)), gamma);
    const b = Math.pow(Math.min(1, Math.max(0, 1 - w)), gamma);
    return a / (a + b || 1);
  }

  // ---- WAV encode (16 or 24 bit, optional TPDF dither) ---------------
  function encodeWav(channels, sampleRate, bitDepth, dither) {
    const numCh = channels.length;
    const numFrames = channels[0].length;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numCh * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    function writeStr(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    const maxInt = Math.pow(2, bitDepth - 1) - 1;
    let offset = 44;
    for (let f = 0; f < numFrames; f++) {
      for (let c = 0; c < numCh; c++) {
        let s = channels[c][f];
        if (dither) {
          const tpdf = (Math.random() - Math.random()) / maxInt;
          s += tpdf;
        }
        s = Math.max(-1, Math.min(1, s));
        const v = Math.round(s * maxInt);
        if (bitDepth === 16) {
          view.setInt16(offset, v, true); offset += 2;
        } else {
          // 24-bit little endian
          view.setUint8(offset, v & 0xff);
          view.setUint8(offset + 1, (v >> 8) & 0xff);
          view.setUint8(offset + 2, (v >> 16) & 0xff);
          offset += 3;
        }
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  root.SonMorphDSP = {
    fft, hannWindow, wrapPhase, extractFrame, analyzeFrame,
    spectralEnvelope, median, estimatePitch, rmsEnergyContour,
    dtwWarp, sCurve, sharpen, encodeWav,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) {
  module.exports = globalThis.SonMorphDSP;
}
