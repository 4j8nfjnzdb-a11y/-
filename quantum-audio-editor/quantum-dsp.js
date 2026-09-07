// quantum-dsp.js — signal processing engine
//
// Every effect below is a direct sonification of an actual quantum
// mechanics formula, not just quantum-flavored naming:
//
//  - Heisenberg uncertainty: STFT window size trades Δt for Δf, and the
//    two are shown live as Δt·Δf.
//  - Quantum harmonic oscillator eigenstates ψ_n(x) = H_n(x) e^{-x²/2}
//    (Hermite polynomials) used as spectral filter envelopes |ψ_n(x)|².
//  - Free-particle Schrödinger dispersion relation ω(k) ∝ k², applied as
//    a frequency-squared, time-growing phase shift (wave-packet spreading).
//  - Quantum tunneling transmission coefficient through a rectangular
//    barrier, T = 1 / (1 + sinh²(κL) / (4E(V0-E))), used as the per-echo
//    gain of a delay line.
//  - Born rule |amplitude|² used as a probability distribution for
//    resequencing grains (a discrete Gaussian "wavepacket" over grain
//    position), i.e. wavefunction-collapse granular synthesis.
//  - Bell-state correlation E(a,b) = -cos(a-b), sonified as the phase
//    relationship between two channels' amplitude modulation.

(function (global) {
  "use strict";

  // ---- FFT (iterative radix-2 Cooley-Tukey, power-of-two only) --------

  function fftInPlace(re, im, invert) {
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
      const ang = (invert ? 2 : -2) * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let curWr = 1, curWi = 0;
        for (let j = 0; j < half; j++) {
          const aRe = re[i + j], aIm = im[i + j];
          const bRe0 = re[i + j + half], bIm0 = im[i + j + half];
          const bRe = bRe0 * curWr - bIm0 * curWi;
          const bIm = bRe0 * curWi + bIm0 * curWr;
          re[i + j] = aRe + bRe;
          im[i + j] = aIm + bIm;
          re[i + j + half] = aRe - bRe;
          im[i + j + half] = aIm - bIm;
          const nextWr = curWr * wr - curWi * wi;
          const nextWi = curWr * wi + curWi * wr;
          curWr = nextWr; curWi = nextWi;
        }
      }
    }
    if (invert) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }

  function nextPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  function hannWindow(N) {
    const w = new Float32Array(N);
    if (N === 1) { w[0] = 1; return w; }
    for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    return w;
  }

  // ---- STFT / ISTFT overlap-add engine ---------------------------------
  //
  // effectFn(mag, phase, frameIndex, N, sampleRate) mutates mag/phase for
  // bins 0..N/2 in place (real-signal spectra are conjugate-symmetric, so
  // only the non-negative-frequency half needs to be touched).

  function stftProcess(input, sampleRate, windowSize, hopSize, effectFn) {
    const N = windowSize;
    const hop = hopSize;
    const win = hannWindow(N);
    const inLen = input.length;
    const pad = N;
    const padded = new Float32Array(inLen + 2 * pad);
    padded.set(input, pad);

    const output = new Float32Array(padded.length);
    const norm = new Float32Array(padded.length);
    const numFrames = Math.floor((padded.length - N) / hop) + 1;
    const half = N / 2;

    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const mag = new Float32Array(half + 1);
    const phase = new Float32Array(half + 1);

    for (let f = 0; f < numFrames; f++) {
      const offset = f * hop;
      for (let i = 0; i < N; i++) {
        re[i] = padded[offset + i] * win[i];
        im[i] = 0;
      }
      fftInPlace(re, im, false);
      for (let k = 0; k <= half; k++) {
        mag[k] = Math.hypot(re[k], im[k]);
        phase[k] = Math.atan2(im[k], re[k]);
      }

      effectFn(mag, phase, f, N, sampleRate);

      for (let k = 0; k <= half; k++) {
        re[k] = mag[k] * Math.cos(phase[k]);
        im[k] = mag[k] * Math.sin(phase[k]);
      }
      for (let k = 1; k < half; k++) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
      im[0] = 0;
      if (N % 2 === 0) im[half] = 0;

      fftInPlace(re, im, true);

      for (let i = 0; i < N; i++) {
        output[offset + i] += re[i] * win[i];
        norm[offset + i] += win[i] * win[i];
      }
    }

    const result = new Float32Array(inLen);
    for (let i = 0; i < inLen; i++) {
      const idx = i + pad;
      result[i] = norm[idx] > 1e-8 ? output[idx] / norm[idx] : 0;
    }
    return result;
  }

  // ---- quantum harmonic oscillator eigenstates -------------------------

  function hermite(n, x) {
    if (n === 0) return 1;
    if (n === 1) return 2 * x;
    let h0 = 1, h1 = 2 * x;
    for (let k = 2; k <= n; k++) {
      const h2 = 2 * x * h1 - 2 * (k - 1) * h0;
      h0 = h1;
      h1 = h2;
    }
    return h1;
  }

  // |ψ_n(x)|² sampled across bins 0..half, x spanning [-4, 4], normalized
  // so the envelope peaks at 1 (a filter shape, not a probability here).
  function qhoEnvelope(n, half) {
    const env = new Float32Array(half + 1);
    let maxVal = 0;
    for (let k = 0; k <= half; k++) {
      const x = -4 + (8 * k) / half;
      const psi = hermite(n, x) * Math.exp(-(x * x) / 2);
      const p = psi * psi;
      env[k] = p;
      if (p > maxVal) maxVal = p;
    }
    if (maxVal > 0) for (let k = 0; k <= half; k++) env[k] /= maxVal;
    return env;
  }

  function buildQuantumSpectralEffect(params) {
    const { qhoN, qhoMix, dispersion, qftDepth, hopSize } = params;
    let cachedEnv = null;
    let cachedKey = "";

    return function effectFn(mag, phase, frameIndex, N, sampleRate) {
      const half = N / 2;

      if (qhoMix > 0) {
        const key = qhoN + ":" + half;
        if (key !== cachedKey) {
          cachedEnv = qhoEnvelope(qhoN, half);
          cachedKey = key;
        }
        for (let k = 0; k <= half; k++) {
          mag[k] = mag[k] * (1 - qhoMix) + mag[k] * cachedEnv[k] * qhoMix;
        }
      }

      if (dispersion !== 0) {
        // free-particle Schrödinger dispersion: phase ∝ k² · t
        const tau = (frameIndex * hopSize) / sampleRate;
        for (let k = 0; k <= half; k++) {
          const omega = k / half;
          phase[k] += dispersion * 25 * omega * omega * tau;
        }
      }

      if (qftDepth !== 0) {
        // QFT twiddle-factor structure e^{2πi·k/N}, reused as a
        // per-bin controlled-phase rotation
        for (let k = 0; k <= half; k++) {
          phase[k] += 2 * Math.PI * ((k * qftDepth) % 1);
        }
      }
    };
  }

  // ---- Born-rule granular resequencing (wavefunction collapse) --------

  function grainCollapse(input, grainSize, sigmaGrains) {
    const G = Math.max(64, Math.floor(grainSize));
    const hop = Math.max(1, Math.floor(G / 2));
    const win = hannWindow(G);
    const numGrains = Math.floor((input.length - G) / hop) + 1;
    if (numGrains <= 0) return input.slice();

    const output = new Float32Array(input.length);
    const norm = new Float32Array(input.length);

    for (let i = 0; i < numGrains; i++) {
      let j = i;
      if (sigmaGrains > 0) {
        // Box–Muller sample from the Gaussian "position wavepacket"
        // centered on i, then collapse to the nearest integer grain index
        const u1 = Math.random() || 1e-9;
        const u2 = Math.random();
        const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        j = Math.round(i + g * sigmaGrains);
      }
      j = Math.max(0, Math.min(numGrains - 1, j));

      const srcOff = j * hop;
      const dstOff = i * hop;
      for (let s = 0; s < G; s++) {
        output[dstOff + s] += input[srcOff + s] * win[s];
        norm[dstOff + s] += win[s] * win[s];
      }
    }

    // Divide by a floored normalization rather than the raw window-energy
    // sum: near a grain's edge norm[i] -> 0 while output[i] -> 0 just as
    // fast, so dividing by the true (near-zero) value blows the ratio up
    // into a spike. Flooring makes the boundary fade out smoothly instead.
    const floor = 0.05;
    const result = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      result[i] = output[i] / Math.max(norm[i], floor);
    }
    return result;
  }

  // ---- quantum tunneling transmission coefficient ----------------------
  //
  // Rectangular barrier, dimensionless units (ħ = m = V0 = 1):
  //   κ = √(2(1-E)),  T = 1 / (1 + sinh²(κL) / (4E(1-E)))

  function computeTunnelingT(E, L) {
    const e = Math.min(Math.max(E, 0.001), 0.999);
    const kappa = Math.sqrt(2 * (1 - e));
    const sh = Math.sinh(kappa * L);
    return 1 / (1 + (sh * sh) / (4 * e * (1 - e)));
  }

  function tunnelingTaps(E, L, delaySamples, wet) {
    const T = computeTunnelingT(E, L);
    const taps = [];
    let amp = T;
    for (let n = 1; n <= 60; n++) {
      if (amp < 0.001) break;
      taps.push({ offset: n * delaySamples, gain: amp * wet });
      amp *= T;
    }
    return { T, taps };
  }

  function applyTunnelingEcho(channels, sampleRate, opts) {
    const delaySamples = Math.max(1, Math.round(opts.delayTime * sampleRate));
    const { T, taps } = tunnelingTaps(opts.E, opts.L, delaySamples, opts.wet);
    const maxOffset = taps.length ? taps[taps.length - 1].offset : 0;
    const outLen = channels[0].length + maxOffset;

    const out = channels.map((ch) => {
      const buf = new Float32Array(outLen);
      buf.set(ch, 0);
      for (const tap of taps) {
        for (let i = 0; i < ch.length; i++) {
          const idx = i + tap.offset;
          if (idx < outLen) buf[idx] += ch[i] * tap.gain;
        }
      }
      return buf;
    });

    return { channels: out, T, tapCount: taps.length };
  }

  // ---- Bell-correlation stereo modulation --------------------------------
  //
  // E(a,b) = -cos(a - b) is the quantum correlation between spin
  // measurements at angles a, b on a singlet pair. Here the "measurement
  // angle difference" becomes the phase offset between two channels'
  // tremolo modulation, and its cosine is displayed live as "correlation".

  function entangledStereo(left, right, sampleRate, opts) {
    const { rate, depth, angleRad } = opts;
    const n = left.length;
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    const w = (2 * Math.PI * rate) / sampleRate;
    for (let i = 0; i < n; i++) {
      const theta = i * w;
      const modL = 1 - depth * 0.5 * (1 - Math.cos(theta));
      const modR = 1 - depth * 0.5 * (1 - Math.cos(theta + angleRad));
      outL[i] = left[i] * modL;
      outR[i] = (right[i] !== undefined ? right[i] : left[i]) * modR;
    }
    return [outL, outR];
  }

  // ---- WAV encoding -----------------------------------------------------

  function encodeWav(sampleRate, channelData) {
    const numCh = channelData.length;
    const len = channelData[0].length;
    const blockAlign = numCh * 2;
    const dataSize = len * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeStr(off, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    }

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
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, channelData[c][i]));
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(offset, s, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  global.QuantumDSP = {
    fftInPlace,
    nextPow2,
    hannWindow,
    stftProcess,
    hermite,
    qhoEnvelope,
    buildQuantumSpectralEffect,
    grainCollapse,
    computeTunnelingT,
    applyTunnelingEcho,
    entangledStereo,
    encodeWav,
  };
})(window);
