// spectrum lab — a Photosounder-inspired spectrogram paint/fx toy.
// Load a sample, look at its waveform + STFT spectrogram, paint directly
// on the spectrogram, then run it through a small stack of spectral and
// time-domain effects and re-synthesize (ISTFT) the result.

(() => {
  const FFT_SIZE = 2048;
  const HOP = 512;
  const BINS = FFT_SIZE / 2 + 1;
  const MAX_DURATION = 20; // seconds, keeps analysis snappy

  const $ = (id) => document.getElementById(id);

  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const testToneBtn = $("testToneBtn");
  const sampleInfo = $("sampleInfo");

  const waveformCanvas = $("waveformCanvas");
  const waveformOverlay = $("waveformOverlay");
  const waveformColor = $("waveformColor");

  const spectrogramCanvas = $("spectrogramCanvas");
  const spectrogramOverlay = $("spectrogramOverlay");
  const paletteSelect = $("paletteSelect");
  const brushMode = $("brushMode");
  const brushSize = $("brushSize");
  const brushStrength = $("brushStrength");
  const resetPaintBtn = $("resetPaintBtn");

  const speedRange = $("speedRange"), speedVal = $("speedVal");
  const stretchRange = $("stretchRange"), stretchVal = $("stretchVal");
  const blurTime = $("blurTime"), blurTimeVal = $("blurTimeVal");
  const blurFreq = $("blurFreq"), blurFreqVal = $("blurFreqVal");
  const gateThreshold = $("gateThreshold"), gateVal = $("gateVal");
  const robotToggle = $("robotToggle");
  const crushBits = $("crushBits"), crushBitsVal = $("crushBitsVal");
  const crushRate = $("crushRate"), crushRateVal = $("crushRateVal");
  const ringFreq = $("ringFreq"), ringFreqVal = $("ringFreqVal");
  const ringDepth = $("ringDepth"), ringDepthVal = $("ringDepthVal");
  const reverseToggle = $("reverseToggle");
  const freezeToggle = $("freezeToggle");
  const freezePos = $("freezePos"), freezePosVal = $("freezePosVal");
  const freezeDur = $("freezeDur"), freezeDurVal = $("freezeDurVal");

  const renderBtn = $("renderBtn");
  const renderStatus = $("renderStatus");
  const playBtn = $("playBtn");
  const stopBtn = $("stopBtn");
  const loopToggle = $("loopToggle");
  const volumeRange = $("volumeRange");
  const downloadBtn = $("downloadBtn");

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // ---- FFT (iterative radix-2, in place) ------------------------------

  function fft(re, im) {
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
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curWr = 1, curWi = 0;
        const half = len >> 1;
        for (let k = 0; k < half; k++) {
          const ai = i + k, bi = i + k + half;
          const vr = re[bi] * curWr - im[bi] * curWi;
          const vi = re[bi] * curWi + im[bi] * curWr;
          re[bi] = re[ai] - vr; im[bi] = im[ai] - vi;
          re[ai] = re[ai] + vr; im[ai] = im[ai] + vi;
          const nwr = curWr * wr - curWi * wi;
          const nwi = curWr * wi + curWi * wr;
          curWr = nwr; curWi = nwi;
        }
      }
    }
  }

  function ifft(re, im) {
    const n = re.length;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
  }

  function hannWindow(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    return w;
  }
  const WIN = hannWindow(FFT_SIZE);

  // ---- STFT / ISTFT -----------------------------------------------------

  function stft(samples) {
    const N = FFT_SIZE, hop = HOP;
    const frames = samples.length >= N ? Math.ceil((samples.length - N) / hop) + 1 : 1;
    const paddedLen = (frames - 1) * hop + N;
    const padded = new Float32Array(paddedLen);
    padded.set(samples.subarray(0, Math.min(samples.length, paddedLen)));

    const mag = new Float32Array(frames * BINS);
    const phase = new Float32Array(frames * BINS);
    const re = new Float32Array(N), im = new Float32Array(N);

    for (let f = 0; f < frames; f++) {
      const off = f * hop;
      for (let i = 0; i < N; i++) { re[i] = padded[off + i] * WIN[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < BINS; k++) {
        mag[f * BINS + k] = Math.hypot(re[k], im[k]);
        phase[f * BINS + k] = Math.atan2(im[k], re[k]);
      }
    }
    return { mag, phase, frames, bins: BINS, N, hop };
  }

  function istft(mag, phase, frames, bins, N, hop, forceZeroPhase) {
    const outLen = (frames - 1) * hop + N;
    const out = new Float32Array(outLen);
    const wsum = new Float32Array(outLen);
    const re = new Float32Array(N), im = new Float32Array(N);

    for (let f = 0; f < frames; f++) {
      for (let k = 0; k < bins; k++) {
        const m = mag[f * bins + k];
        const p = forceZeroPhase ? 0 : phase[f * bins + k];
        re[k] = m * Math.cos(p);
        im[k] = m * Math.sin(p);
      }
      for (let k = 1; k < bins - 1; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }

      ifft(re, im);
      const off = f * hop;
      for (let i = 0; i < N; i++) {
        out[off + i] += re[i] * WIN[i];
        wsum[off + i] += WIN[i] * WIN[i];
      }
    }
    for (let i = 0; i < outLen; i++) if (wsum[i] > 1e-6) out[i] /= wsum[i];
    return out;
  }

  // ---- spectral effects on mag/phase arrays ------------------------------

  function phaseVocoderStretch(mag, phase, frames, bins, N, hop, factor) {
    if (Math.abs(factor - 1) < 1e-3) return { mag, phase, frames };
    const framesOut = Math.max(1, Math.round(frames * factor));
    const mag2 = new Float32Array(framesOut * bins);
    const phase2 = new Float32Array(framesOut * bins);
    const expectedAdv = new Float32Array(bins);
    for (let k = 0; k < bins; k++) expectedAdv[k] = (2 * Math.PI * k * hop) / N;
    const accum = new Float32Array(bins);
    for (let k = 0; k < bins; k++) accum[k] = phase[k];

    for (let f2 = 0; f2 < framesOut; f2++) {
      const posA = f2 / factor;
      const i0 = Math.min(frames - 1, Math.floor(posA));
      const i1 = Math.min(frames - 1, i0 + 1);
      const frac = posA - Math.floor(posA);
      for (let k = 0; k < bins; k++) {
        const m0 = mag[i0 * bins + k], m1 = mag[i1 * bins + k];
        mag2[f2 * bins + k] = m0 + (m1 - m0) * frac;
        if (f2 === 0) {
          phase2[f2 * bins + k] = accum[k];
        } else {
          let dphi = phase[i1 * bins + k] - phase[i0 * bins + k] - expectedAdv[k];
          dphi -= 2 * Math.PI * Math.round(dphi / (2 * Math.PI));
          accum[k] += expectedAdv[k] + dphi;
          phase2[f2 * bins + k] = accum[k];
        }
      }
    }
    return { mag: mag2, phase: phase2, frames: framesOut };
  }

  function freezeSpectrum(mag, phase, frames, bins, N, hop, sampleRate, posRatio, durationSec) {
    const freezeIdx = Math.min(frames - 1, Math.max(0, Math.round(posRatio * (frames - 1))));
    const framesOut = Math.max(1, Math.round((durationSec * sampleRate) / hop));
    const mag2 = new Float32Array(framesOut * bins);
    const phase2 = new Float32Array(framesOut * bins);
    const expectedAdv = new Float32Array(bins);
    for (let k = 0; k < bins; k++) expectedAdv[k] = (2 * Math.PI * k * hop) / N;
    const accum = new Float32Array(bins);
    for (let k = 0; k < bins; k++) accum[k] = phase[freezeIdx * bins + k];

    for (let f2 = 0; f2 < framesOut; f2++) {
      for (let k = 0; k < bins; k++) {
        mag2[f2 * bins + k] = mag[freezeIdx * bins + k];
        if (f2 > 0) accum[k] += expectedAdv[k];
        phase2[f2 * bins + k] = accum[k];
      }
    }
    return { mag: mag2, phase: phase2, frames: framesOut };
  }

  function blurMag(mag, frames, bins, radiusT, radiusF) {
    let out = mag;
    if (radiusT > 0) {
      const tmp = new Float32Array(frames * bins);
      for (let k = 0; k < bins; k++) {
        for (let f = 0; f < frames; f++) {
          let sum = 0, count = 0;
          for (let d = -radiusT; d <= radiusT; d++) {
            const ff = f + d;
            if (ff < 0 || ff >= frames) continue;
            sum += out[ff * bins + k]; count++;
          }
          tmp[f * bins + k] = sum / count;
        }
      }
      out = tmp;
    }
    if (radiusF > 0) {
      const tmp = new Float32Array(frames * bins);
      for (let f = 0; f < frames; f++) {
        const base = f * bins;
        for (let k = 0; k < bins; k++) {
          let sum = 0, count = 0;
          for (let d = -radiusF; d <= radiusF; d++) {
            const kk = k + d;
            if (kk < 0 || kk >= bins) continue;
            sum += out[base + kk]; count++;
          }
          tmp[base + k] = sum / count;
        }
      }
      out = tmp;
    }
    return out;
  }

  function gateMag(mag, frames, bins, thresholdDb) {
    if (thresholdDb <= -60) return mag;
    let maxM = 0;
    for (let i = 0; i < mag.length; i++) if (mag[i] > maxM) maxM = mag[i];
    if (maxM <= 0) return mag;
    const out = new Float32Array(mag.length);
    const floor = Math.pow(10, thresholdDb / 20) * maxM;
    for (let i = 0; i < mag.length; i++) out[i] = mag[i] < floor ? 0 : mag[i];
    return out;
  }

  // ---- time-domain effects ------------------------------------------------

  function resampleSpeed(samples, factor) {
    if (Math.abs(factor - 1) < 1e-3) return samples;
    const outLen = Math.max(1, Math.round(samples.length / factor));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcPos = i * factor;
      const i0 = Math.floor(srcPos);
      const i1 = Math.min(samples.length - 1, i0 + 1);
      const frac = srcPos - i0;
      const s0 = samples[Math.min(i0, samples.length - 1)];
      out[i] = s0 + (samples[i1] - s0) * frac;
    }
    return out;
  }

  function bitcrush(samples, bits, holdFactor) {
    if (bits >= 16 && holdFactor <= 1) return samples;
    const levels = Math.pow(2, bits);
    const out = new Float32Array(samples.length);
    let held = 0;
    for (let i = 0; i < samples.length; i++) {
      if (i % holdFactor === 0) held = Math.round(samples[i] * levels) / levels;
      out[i] = held;
    }
    return out;
  }

  function ringMod(samples, sampleRate, freq, depth) {
    if (depth <= 0) return samples;
    const out = new Float32Array(samples.length);
    const w = (2 * Math.PI * freq) / sampleRate;
    for (let i = 0; i < samples.length; i++) {
      const mod = Math.sin(w * i);
      out[i] = samples[i] * (1 - depth) + samples[i] * mod * depth;
    }
    return out;
  }

  function normalize(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
    if (peak > 0.98) { const s = 0.95 / peak; for (let i = 0; i < samples.length; i++) samples[i] *= s; }
    return samples;
  }

  // ---- state -----------------------------------------------------------

  let analysis = null; // {mag, magOriginal, phase, frames, bins, N, hop, sampleRate, duration}
  let processedBuffer = null;
  let sourceNode = null;
  let gainNode = null;
  let playStartCtxTime = 0;
  let playheadRAF = null;

  function setSampleInfo(text) { sampleInfo.textContent = text; }

  async function loadFile(file) {
    const ctx = ensureAudio();
    setSampleInfo("読み込み中…");
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    let mono = mixToMono(audioBuf);
    const cap = MAX_DURATION * audioBuf.sampleRate;
    let trimmed = false;
    if (mono.length > cap) { mono = mono.subarray(0, cap); trimmed = true; }
    analyzeAndDraw(mono, audioBuf.sampleRate, `${file.name}（${(mono.length / audioBuf.sampleRate).toFixed(1)}s${trimmed ? " / 先頭" + MAX_DURATION + "sに切り詰め" : ""}）`);
  }

  function mixToMono(audioBuf) {
    const ch = audioBuf.numberOfChannels;
    const len = audioBuf.length;
    const out = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const d = audioBuf.getChannelData(c);
      for (let i = 0; i < len; i++) out[i] += d[i] / ch;
    }
    return out;
  }

  function generateTestTone() {
    const ctx = ensureAudio();
    const sr = ctx.sampleRate;
    const dur = 4;
    const len = dur * sr;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const sweep = Math.sin(2 * Math.PI * (200 + (1800 * t) / dur) * t) * 0.25;
      const chord = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) * 0.08;
      const env = Math.min(1, t * 6) * Math.min(1, (dur - t) * 3);
      const noiseBurst = t > 1.6 && t < 1.75 ? (Math.random() * 2 - 1) * 0.5 : 0;
      out[i] = (sweep + chord + noiseBurst) * env;
    }
    analyzeAndDraw(out, sr, `テスト音（${dur}s）`);
  }

  function analyzeAndDraw(monoSamples, sampleRate, infoText) {
    setSampleInfo("解析中…");
    renderBtn.disabled = true;
    setTimeout(() => {
      const { mag, phase, frames, bins, N, hop } = stft(monoSamples);
      analysis = {
        mag, magOriginal: Float32Array.from(mag), phase, frames, bins, N, hop,
        sampleRate, duration: monoSamples.length / sampleRate, monoSamples,
      };
      drawWaveform(monoSamples);
      drawSpectrogram();
      setSampleInfo(infoText);
      renderBtn.disabled = false;
      renderStatus.textContent = "";
      playBtn.disabled = true;
      stopBtn.disabled = true;
      downloadBtn.disabled = true;
    }, 10);
  }

  // ---- waveform drawing --------------------------------------------------

  function drawWaveform(samples) {
    const dpr = window.devicePixelRatio || 1;
    const rect = waveformCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round((rect.height || 144) * dpr));
    waveformCanvas.width = w; waveformCanvas.height = h;
    waveformOverlay.width = w; waveformOverlay.height = h;
    const ctx = waveformCanvas.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);

    const mid = h / 2;
    const perPixel = samples.length / w;
    ctx.strokeStyle = waveformColor.value;
    ctx.fillStyle = waveformColor.value + "33";
    ctx.beginPath();
    const tops = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const start = Math.floor(x * perPixel);
      const end = Math.max(start + 1, Math.floor((x + 1) * perPixel));
      let mn = 1, mx = -1;
      for (let i = start; i < end && i < samples.length; i++) {
        const s = samples[i];
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
      if (mn > mx) { mn = 0; mx = 0; }
      tops[x] = mx;
      const y1 = mid - mx * mid * 0.95, y2 = mid - mn * mid * 0.95;
      ctx.moveTo(x, y1); ctx.lineTo(x, y2);
    }
    ctx.stroke();
  }

  // ---- spectrogram color palettes + drawing ------------------------------

  const PALETTES = {
    photosounder: [
      [0, 6, 8, 20], [0.15, 30, 20, 120], [0.4, 20, 140, 200],
      [0.6, 60, 220, 120], [0.8, 255, 210, 40], [1, 255, 60, 40],
    ],
    inferno: [
      [0, 0, 0, 4], [0.25, 80, 18, 90], [0.5, 190, 40, 80],
      [0.75, 250, 130, 40], [1, 255, 240, 160],
    ],
    viridis: [
      [0, 10, 5, 40], [0.3, 40, 70, 110], [0.55, 30, 140, 130],
      [0.8, 140, 200, 70], [1, 250, 250, 90],
    ],
    mono: [[0, 0, 0, 0], [1, 235, 246, 246]],
  };

  function paletteColor(name, t) {
    const stops = PALETTES[name] || PALETTES.photosounder;
    t = Math.min(1, Math.max(0, t));
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (t >= a[0] && t <= b[0]) {
        const f = (t - a[0]) / (b[0] - a[0] || 1);
        return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
      }
    }
    const last = stops[stops.length - 1];
    return [last[1], last[2], last[3]];
  }

  let spectroImageData = null;

  function drawSpectrogram() {
    if (!analysis) return;
    const { mag, frames, bins } = analysis;
    spectrogramCanvas.width = frames;
    spectrogramCanvas.height = bins;
    spectrogramOverlay.width = spectrogramCanvas.getBoundingClientRect().width * (window.devicePixelRatio || 1) || frames;
    spectrogramOverlay.height = spectrogramCanvas.getBoundingClientRect().height * (window.devicePixelRatio || 1) || bins;

    let maxM = 0;
    for (let i = 0; i < mag.length; i++) if (mag[i] > maxM) maxM = mag[i];
    if (maxM <= 0) maxM = 1;

    const ctx = spectrogramCanvas.getContext("2d");
    const img = ctx.createImageData(frames, bins);
    const palette = paletteSelect.value;
    for (let f = 0; f < frames; f++) {
      for (let k = 0; k < bins; k++) {
        const m = mag[f * bins + k];
        const db = 20 * Math.log10(m / maxM + 1e-8);
        const t = (db + 60) / 60;
        const [r, g, b] = paletteColor(palette, t);
        const row = bins - 1 - k;
        const idx = (row * frames + f) * 4;
        img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 255;
      }
    }
    spectroImageData = img;
    ctx.putImageData(img, 0, 0);
  }

  function redrawSpectrogramRegion(f0, f1, k0, k1) {
    if (!analysis || !spectroImageData) return;
    const { mag, frames, bins } = analysis;
    let maxM = 0;
    for (let i = 0; i < mag.length; i++) if (mag[i] > maxM) maxM = mag[i];
    if (maxM <= 0) maxM = 1;
    const palette = paletteSelect.value;
    const img = spectroImageData;
    f0 = Math.max(0, f0); f1 = Math.min(frames - 1, f1);
    k0 = Math.max(0, k0); k1 = Math.min(bins - 1, k1);
    for (let f = f0; f <= f1; f++) {
      for (let k = k0; k <= k1; k++) {
        const m = mag[f * bins + k];
        const db = 20 * Math.log10(m / maxM + 1e-8);
        const t = (db + 60) / 60;
        const [r, g, b] = paletteColor(palette, t);
        const row = bins - 1 - k;
        const idx = (row * frames + f) * 4;
        img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 255;
      }
    }
    const ctx = spectrogramCanvas.getContext("2d");
    ctx.putImageData(img, 0, 0, f0, bins - 1 - k1, f1 - f0 + 1, k1 - k0 + 1);
  }

  // ---- spectrogram painting ----------------------------------------------

  let painting = false;

  function canvasPos(evt, canvas) {
    const rect = canvas.getBoundingClientRect();
    const cx = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const cy = evt.touches ? evt.touches[0].clientY : evt.clientY;
    const xRatio = (cx - rect.left) / rect.width;
    const yRatio = (cy - rect.top) / rect.height;
    return { xRatio, yRatio };
  }

  function paintAt(xRatio, yRatio) {
    if (!analysis) return;
    const { mag, frames, bins } = analysis;
    const f = Math.floor(xRatio * frames);
    const rowFromTop = Math.floor(yRatio * bins);
    const k = bins - 1 - rowFromTop;
    const radius = Number(brushSize.value);
    const strength = Number(brushStrength.value) / 100;
    const erase = brushMode.value === "erase";

    const f0 = f - radius, f1 = f + radius, k0 = k - radius, k1 = k + radius;
    for (let ff = Math.max(0, f0); ff <= Math.min(frames - 1, f1); ff++) {
      for (let kk = Math.max(0, k0); kk <= Math.min(bins - 1, k1); kk++) {
        const d = Math.hypot(ff - f, kk - k) / radius;
        if (d > 1) continue;
        const weight = 1 - d;
        const idx = ff * bins + kk;
        if (erase) mag[idx] *= 1 - strength * weight;
        else mag[idx] *= 1 + strength * weight * 2;
      }
    }
    redrawSpectrogramRegion(f0, f1, k0, k1);
  }

  function bindPaintEvents() {
    const start = (e) => { painting = true; const p = canvasPos(e, spectrogramCanvas); paintAt(p.xRatio, p.yRatio); e.preventDefault(); };
    const move = (e) => { if (!painting) return; const p = canvasPos(e, spectrogramCanvas); paintAt(p.xRatio, p.yRatio); e.preventDefault(); };
    const end = () => { painting = false; };
    spectrogramCanvas.addEventListener("mousedown", start);
    spectrogramCanvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    spectrogramCanvas.addEventListener("touchstart", start, { passive: false });
    spectrogramCanvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
  }

  resetPaintBtn.addEventListener("click", () => {
    if (!analysis) return;
    analysis.mag.set(analysis.magOriginal);
    drawSpectrogram();
  });

  paletteSelect.addEventListener("change", () => drawSpectrogram());
  waveformColor.addEventListener("input", () => { if (analysis) drawWaveform(analysis.monoSamples); });

  // ---- render pipeline ----------------------------------------------------

  function render() {
    if (!analysis) return;
    renderBtn.disabled = true;
    renderStatus.textContent = "処理中…";
    setTimeout(() => {
      const { mag, phase, frames, bins, N, hop, sampleRate } = analysis;
      let work;

      if (freezeToggle.checked) {
        work = freezeSpectrum(mag, phase, frames, bins, N, hop, sampleRate, Number(freezePos.value) / 100, Number(freezeDur.value));
      } else {
        const stretched = phaseVocoderStretch(mag, phase, frames, bins, N, hop, Number(stretchRange.value));
        work = { mag: Float32Array.from(stretched.mag), phase: stretched.phase, frames: stretched.frames };
      }

      work.mag = blurMag(work.mag, work.frames, bins, Number(blurTime.value), Number(blurFreq.value));
      work.mag = gateMag(work.mag, work.frames, bins, Number(gateThreshold.value));

      let out = istft(work.mag, work.phase, work.frames, bins, N, hop, robotToggle.checked);

      out = resampleSpeed(out, Number(speedRange.value));
      out = bitcrush(out, Number(crushBits.value), Number(crushRate.value));
      out = ringMod(out, sampleRate, Number(ringFreq.value), Number(ringDepth.value) / 100);
      if (reverseToggle.checked) out = Float32Array.from(out).reverse();
      normalize(out);

      const ctx = ensureAudio();
      const buf = ctx.createBuffer(1, Math.max(1, out.length), sampleRate);
      buf.getChannelData(0).set(out);
      processedBuffer = buf;

      renderStatus.textContent = `完成（${buf.duration.toFixed(2)}s）`;
      renderBtn.disabled = false;
      playBtn.disabled = false;
      downloadBtn.disabled = false;
      drawWaveform(out);
    }, 10);
  }

  renderBtn.addEventListener("click", render);

  // ---- transport ----------------------------------------------------------

  function stopPlayback() {
    if (sourceNode) { try { sourceNode.stop(); } catch (e) {} sourceNode = null; }
    if (playheadRAF) { cancelAnimationFrame(playheadRAF); playheadRAF = null; }
    playBtn.disabled = !processedBuffer;
    stopBtn.disabled = true;
    playBtn.classList.remove("playing");
    clearPlayhead();
  }

  function startPlayback() {
    if (!processedBuffer) return;
    const ctx = ensureAudio();
    stopPlayback();
    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = processedBuffer;
    sourceNode.loop = loopToggle.checked;
    gainNode = ctx.createGain();
    gainNode.gain.value = Number(volumeRange.value) / 100;
    sourceNode.connect(gainNode).connect(ctx.destination);
    const thisNode = sourceNode;
    sourceNode.onended = () => { if (sourceNode === thisNode && !loopToggle.checked) stopPlayback(); };
    sourceNode.start();
    playStartCtxTime = ctx.currentTime;
    playBtn.disabled = true;
    stopBtn.disabled = false;
    playBtn.classList.add("playing");
    animatePlayhead();
  }

  function animatePlayhead() {
    const ctx = audioCtx;
    const dur = processedBuffer.duration;
    const draw = () => {
      if (!sourceNode) return;
      let elapsed = ctx.currentTime - playStartCtxTime;
      let ratio = loopToggle.checked ? (elapsed % dur) / dur : Math.min(1, elapsed / dur);
      drawPlayhead(ratio);
      if (!loopToggle.checked && ratio >= 1) return;
      playheadRAF = requestAnimationFrame(draw);
    };
    playheadRAF = requestAnimationFrame(draw);
  }

  function drawPlayhead(ratio) {
    [waveformOverlay, spectrogramOverlay].forEach((c) => {
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = Math.max(1, c.width * 0.0015);
      const x = ratio * c.width;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke();
    });
  }

  function clearPlayhead() {
    [waveformOverlay, spectrogramOverlay].forEach((c) => c.getContext("2d").clearRect(0, 0, c.width, c.height));
  }

  playBtn.addEventListener("click", startPlayback);
  stopBtn.addEventListener("click", stopPlayback);
  volumeRange.addEventListener("input", () => { if (gainNode) gainNode.gain.value = Number(volumeRange.value) / 100; });

  // ---- WAV export -----------------------------------------------------

  function encodeWav(buffer) {
    const samples = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample;
    const dataSize = samples.length * bytesPerSample;
    const arrBuf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrBuf);
    const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    let off = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Blob([arrBuf], { type: "audio/wav" });
  }

  downloadBtn.addEventListener("click", () => {
    if (!processedBuffer) return;
    const blob = encodeWav(processedBuffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "spectrum-lab.wav";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  // ---- slider value labels ----------------------------------------------

  function bindLabel(input, out, fmt) { const upd = () => out.textContent = fmt(input.value); input.addEventListener("input", upd); upd(); }
  bindLabel(speedRange, speedVal, (v) => Number(v).toFixed(2) + "x");
  bindLabel(stretchRange, stretchVal, (v) => Number(v).toFixed(2) + "x");
  bindLabel(blurTime, blurTimeVal, (v) => v);
  bindLabel(blurFreq, blurFreqVal, (v) => v);
  bindLabel(gateThreshold, gateVal, (v) => v + "dB");
  bindLabel(crushBits, crushBitsVal, (v) => v + "bit");
  bindLabel(crushRate, crushRateVal, (v) => v);
  bindLabel(ringFreq, ringFreqVal, (v) => v + "Hz");
  bindLabel(ringDepth, ringDepthVal, (v) => v + "%");
  bindLabel(freezePos, freezePosVal, (v) => v + "%");
  bindLabel(freezeDur, freezeDurVal, (v) => v + "s");

  // ---- file input wiring ---------------------------------------------

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });
  ["dragover", "dragenter"].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("drag"); }));
  dropZone.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
  testToneBtn.addEventListener("click", generateTestTone);

  bindPaintEvents();

  window.addEventListener("resize", () => { if (analysis) { drawWaveform(analysis.monoSamples); } });
})();
