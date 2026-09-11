// son morph — render engine
//
// Turns two loaded sources + a trajectory function + a parameter set
// into a rendered stereo buffer. Each source is analysed with its own
// phase vocoder (so it can be time-stretched to the output length at a
// non-uniform rate, e.g. via DTW warp) and the two coherent spectra are
// combined bin-by-bin according to the morph weight at that instant.

(function (root) {
  const D = root.SonMorphDSP;
  const EPS = 1e-8;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function pitchShiftBins(mag, phase, ratio, outMag, outPhase) {
    const n = mag.length;
    for (let i = 0; i < n; i++) {
      const srcIdx = i / ratio;
      const i0 = Math.floor(srcIdx), frac = srcIdx - i0;
      if (i0 >= 0 && i0 < n - 1) {
        outMag[i] = mag[i0] + (mag[i0 + 1] - mag[i0]) * frac;
        const dp = D.wrapPhase(phase[i0 + 1] - phase[i0]);
        outPhase[i] = phase[i0] + dp * frac;
      } else if (i0 === n - 1) {
        outMag[i] = mag[i0]; outPhase[i] = phase[i0];
      } else {
        outMag[i] = 0; outPhase[i] = 0;
      }
    }
  }

  function rms(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / Math.max(1, data.length));
  }

  const MEDIAN_WIN = 9;

  async function render(A, B, opts, onProgress) {
    const outSR = opts.outSampleRate;
    const durA = A.duration, durB = B.duration;
    const outDuration = lerp(durA, durB, opts.lengthT);
    const outLength = Math.max(1, Math.round(outDuration * outSR));
    const frameSize = opts.fftSize;
    const p = opts.params;
    const hop = p.denseSynthesis ? frameSize / 8 : frameSize / 4;
    const numFrames = Math.ceil(outLength / hop) + 2;
    const bins = frameSize / 2 + 1;
    const win = D.hannWindow(frameSize);
    const envRadius = Math.max(1, Math.round(frameSize / 128));

    // -- optional analysis passes on mono mixdowns --------------------
    const monoA = A.mono, monoB = B.mono;

    let pitchRatioA = 1, pitchRatioB = 1;
    if (p.prePitch !== "off") {
      const f0A = D.estimatePitch(monoA, outSR, monoA.length / 2, 4096);
      const f0B = D.estimatePitch(monoB, outSR, monoB.length / 2, 4096);
      if (f0A && f0B) {
        if (p.prePitch === "toA") pitchRatioB = f0A / f0B;
        else pitchRatioA = f0B / f0A;
      }
    }

    let warpFn = null;
    if (p.autoTimeAlign) {
      const pts = 150;
      const envA = D.rmsEnergyContour(monoA, outSR, pts);
      const envB = D.rmsEnergyContour(monoB, outSR, pts);
      const maxA = Math.max(...envA, EPS), maxB = Math.max(...envB, EPS);
      for (let i = 0; i < pts; i++) { envA[i] /= maxA; envB[i] /= maxB; }
      warpFn = D.dtwWarp(envA, envB);
    }

    let gainA = 1, gainB = 1;
    if (p.loudnessMatch) {
      const rA = rms(monoA), rB = rms(monoB);
      const target = (rA + rB) / 2;
      gainA = target / Math.max(rA, EPS);
      gainB = target / Math.max(rB, EPS);
    }

    const numChannels = Math.max(A.channels.length, B.channels.length);
    const outChannels = [];
    let totalWork = numChannels * numFrames, doneWork = 0;
    let lastYield = Date.now();

    for (let c = 0; c < numChannels; c++) {
      const dataA = A.channels[c] || A.channels[0];
      const dataB = B.channels[c] || B.channels[0];

      const output = new Float32Array(outLength + frameSize);
      const normEnv = new Float32Array(outLength + frameSize);

      const scratchRe = new Float32Array(frameSize);
      const scratchIm = new Float32Array(frameSize);
      const frameBuf = new Float32Array(frameSize);

      const magA = new Float32Array(bins), phaseA = new Float32Array(bins);
      const magB = new Float32Array(bins), phaseB = new Float32Array(bins);
      const magAraw = new Float32Array(bins), phaseAraw = new Float32Array(bins);
      const magBraw = new Float32Array(bins), phaseBraw = new Float32Array(bins);

      let synthPhaseA = new Float32Array(bins), synthPhaseB = new Float32Array(bins);
      let prevPhaseArawStore = new Float32Array(bins), prevPhaseBrawStore = new Float32Array(bins);
      let prevSrcPosA = 0, prevSrcPosB = 0;

      const logMagA = new Float32Array(bins), logMagB = new Float32Array(bins);
      const envAarr = new Float32Array(bins), envBarr = new Float32Array(bins);
      const resAarr = new Float32Array(bins), resBarr = new Float32Array(bins);
      const finalMag = new Float32Array(bins), finalPhase = new Float32Array(bins);
      const crossMag = new Float32Array(bins);

      let prevFinalMag = new Float32Array(bins);
      let runningFluxMax = 1e-4;

      const medianRing = p.percussionSeparation > 0
        ? Array.from({ length: MEDIAN_WIN }, () => new Float32Array(bins))
        : null;
      let ringPos = 0, ringFilled = 0;
      const harmComp = new Float32Array(bins), percComp = new Float32Array(bins);

      for (let k = 0; k < numFrames; k++) {
        const outStart = k * hop;
        const tOut = outStart / outSR;
        const tNorm = clamp(tOut / outDuration, 0, 1);
        const wRaw = opts.trajectory(tNorm);
        const w = p.overmorph ? clamp(wRaw, -0.4, 1.4) : clamp(wRaw, 0, 1);
        const wClamped = clamp(w, 0, 1);
        const overshoot = w - wClamped;

        const tNormA = tNorm;
        const tNormB = warpFn ? warpFn(tNormA) : tNorm;
        const srcPosA = tNormA * durA * outSR;
        const srcPosB = tNormB * durB * outSR;

        D.extractFrame(dataA, srcPosA - frameSize / 2, frameSize, win, frameBuf);
        D.analyzeFrame(frameBuf, scratchRe, scratchIm, magAraw, phaseAraw);
        D.extractFrame(dataB, srcPosB - frameSize / 2, frameSize, win, frameBuf);
        D.analyzeFrame(frameBuf, scratchRe, scratchIm, magBraw, phaseBraw);

        if (pitchRatioA !== 1) pitchShiftBins(magAraw, phaseAraw, pitchRatioA, magA, phaseA);
        else { magA.set(magAraw); phaseA.set(phaseAraw); }
        if (pitchRatioB !== 1) pitchShiftBins(magBraw, phaseBraw, pitchRatioB, magB, phaseB);
        else { magB.set(magBraw); phaseB.set(phaseBraw); }

        if (gainA !== 1) for (let b = 0; b < bins; b++) magA[b] *= gainA;
        if (gainB !== 1) for (let b = 0; b < bins; b++) magB[b] *= gainB;

        if (k === 0) {
          synthPhaseA.set(phaseA);
          synthPhaseB.set(phaseB);
        } else if (p.phaseLock) {
          const deltaA = srcPosA - prevSrcPosA;
          const deltaB = srcPosB - prevSrcPosB;
          for (let b = 0; b < bins; b++) {
            const expA = (2 * Math.PI * b * deltaA) / frameSize;
            const dPA = D.wrapPhase(phaseA[b] - prevPhaseArawStore[b] - expA);
            synthPhaseA[b] = synthPhaseA[b] + expA + dPA;
            const expB = (2 * Math.PI * b * deltaB) / frameSize;
            const dPB = D.wrapPhase(phaseB[b] - prevPhaseBrawStore[b] - expB);
            synthPhaseB[b] = synthPhaseB[b] + expB + dPB;
          }
        } else {
          synthPhaseA.set(phaseA);
          synthPhaseB.set(phaseB);
        }
        prevPhaseArawStore.set(phaseA);
        prevPhaseBrawStore.set(phaseB);
        prevSrcPosA = srcPosA;
        prevSrcPosB = srcPosB;

        for (let b = 0; b < bins; b++) {
          logMagA[b] = Math.log(magA[b] + EPS);
          logMagB[b] = Math.log(magB[b] + EPS);
        }
        D.spectralEnvelope(logMagA, envRadius, envAarr);
        D.spectralEnvelope(logMagB, envRadius, envBarr);
        for (let b = 0; b < bins; b++) {
          resAarr[b] = logMagA[b] - envAarr[b];
          resBarr[b] = logMagB[b] - envBarr[b];
        }

        const gammaEnv = 1 + ((100 - p.formantAmt) / 100) * 3;
        const gammaRes = 1 + ((100 - p.harmonicAmt) / 100) * 3;
        const wEnv = D.sharpen(wClamped, gammaEnv) + overshoot;
        const wRes = D.sharpen(wClamped, gammaRes) + overshoot;

        for (let b = 0; b < bins; b++) {
          const envMix = lerp(envAarr[b], envBarr[b], wEnv);
          const resMix = lerp(resAarr[b], resBarr[b], wRes);
          finalMag[b] = Math.exp(envMix + resMix);
        }

        if (p.crossSynthesis > 0) {
          const amt = p.crossSynthesis / 100;
          for (let b = 0; b < bins; b++) {
            const envMix = lerp(envAarr[b], envBarr[b], w);
            const resSwap = lerp(resBarr[b], resAarr[b], w);
            crossMag[b] = Math.exp(envMix + resSwap);
            finalMag[b] = lerp(finalMag[b], crossMag[b], amt);
          }
        }

        for (let b = 0; b < bins; b++) {
          const ux = (1 - w) * Math.cos(synthPhaseA[b]) + w * Math.cos(synthPhaseB[b]);
          const uy = (1 - w) * Math.sin(synthPhaseA[b]) + w * Math.sin(synthPhaseB[b]);
          finalPhase[b] = Math.atan2(uy, ux);
        }

        if (p.transientPreserve > 0 && k > 0) {
          let flux = 0;
          for (let b = 0; b < bins; b++) flux += Math.max(0, finalMag[b] - prevFinalMag[b]);
          runningFluxMax = Math.max(runningFluxMax * 0.98, flux);
          const strength = flux / Math.max(runningFluxMax, EPS);
          if (strength > 0.5) {
            const snapTarget = wClamped < 0.5 ? magA : magB;
            const amt = (p.transientPreserve / 100) * Math.min(1, (strength - 0.5) * 2);
            for (let b = 0; b < bins; b++) finalMag[b] = lerp(finalMag[b], snapTarget[b], amt);
          }
        }
        prevFinalMag.set(finalMag);

        if (medianRing) {
          medianRing[ringPos].set(finalMag);
          ringPos = (ringPos + 1) % MEDIAN_WIN;
          ringFilled = Math.min(MEDIAN_WIN, ringFilled + 1);
          const tmpArr = new Array(ringFilled);
          for (let b = 0; b < bins; b++) {
            for (let r = 0; r < ringFilled; r++) tmpArr[r] = medianRing[r][b];
            harmComp[b] = D.median(tmpArr);
          }
          const freqWin = 4;
          for (let b = 0; b < bins; b++) {
            const lo = Math.max(0, b - freqWin), hi = Math.min(bins - 1, b + freqWin);
            const seg = [];
            for (let x = lo; x <= hi; x++) seg.push(finalMag[x]);
            percComp[b] = D.median(seg);
          }
          const tilt = p.toneNoiseBalance / 100;
          const harmGain = 1 + Math.max(0, tilt) * 1.5 - Math.max(0, -tilt) * 0.8;
          const percGain = 1 + Math.max(0, -tilt) * 1.5 - Math.max(0, tilt) * 0.8;
          const blend = p.percussionSeparation / 100;
          for (let b = 0; b < bins; b++) {
            const recombined = harmComp[b] * harmGain + percComp[b] * percGain;
            finalMag[b] = lerp(finalMag[b], recombined, blend);
          }
        }

        scratchRe.fill(0); scratchIm.fill(0);
        for (let b = 0; b < bins; b++) {
          const re = finalMag[b] * Math.cos(finalPhase[b]);
          const im = finalMag[b] * Math.sin(finalPhase[b]);
          scratchRe[b] = re; scratchIm[b] = im;
          if (b > 0 && b < frameSize - b) {
            scratchRe[frameSize - b] = re;
            scratchIm[frameSize - b] = -im;
          }
        }
        D.fft(scratchRe, scratchIm, true);

        for (let n = 0; n < frameSize; n++) {
          const idx = outStart + n;
          if (idx < output.length) {
            const wv = win[n];
            output[idx] += scratchRe[n] * wv;
            normEnv[idx] += wv * wv;
          }
        }

        doneWork++;
        if (Date.now() - lastYield > 60) {
          lastYield = Date.now();
          if (onProgress) onProgress(doneWork / totalWork);
          await new Promise((r) => requestAnimationFrame(r));
        }
      }

      for (let i = 0; i < outLength; i++) output[i] /= Math.max(normEnv[i], 1e-6);
      outChannels.push(output.slice(0, outLength));
    }

    if (p.peakNormalize) {
      let peak = 0;
      for (const ch of outChannels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
      const target = 0.891; // ~ -1 dBFS
      if (peak > EPS) {
        const g = target / peak;
        for (const ch of outChannels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
      }
    }

    if (onProgress) onProgress(1);
    return {
      channels: outChannels,
      sampleRate: outSR,
      duration: outLength / outSR,
    };
  }

  root.SonMorphEngine = { render };
})(typeof window !== "undefined" ? window : globalThis);
