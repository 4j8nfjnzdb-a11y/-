// JUNK LOOP — a 4-track junk sampler/looper.
//
// Drop a file (or a whole folder) onto a track. CYCLE grabs a random
// window inside that audio — random start point, random length (a
// stutter, a bar, a long smear) — and loops it. Press CYCLE again and
// the window jumps somewhere else. Every track runs its own junk-radio
// effects chain: bitcrush, grit (waveshaper distortion), a squelchy
// filter, and a send to a shared broken-delay bus.

(() => {
  const TRACK_COUNT = 4;

  let audioCtx = null;
  let workletReady = null; // promise
  let masterGain, compressor;
  let delayNode, delayFeedback, delayDamp, delayReturn;
  let staticSource, staticGain, staticFilter;
  let crackleEnabled = false;

  const tracks = [];

  // ---------------------------------------------------------------
  // audio context / master bus
  // ---------------------------------------------------------------

  function ensureAudioContext() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return workletReady;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.8;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    masterGain.connect(compressor).connect(audioCtx.destination);

    buildDelayBus();
    buildStaticLayer();
    scheduleCrackle();

    workletReady = audioCtx.audioWorklet.addModule(bitcrusherWorkletURL()).then(() => {
      tracks.forEach((t) => buildTrackChain(t));
    });

    return workletReady;
  }

  function buildDelayBus() {
    delayNode = audioCtx.createDelay(2.0);
    delayNode.delayTime.value = 0.28 + Math.random() * 0.2;

    delayDamp = audioCtx.createBiquadFilter();
    delayDamp.type = "lowpass";
    delayDamp.frequency.value = 2200;

    delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.4;

    delayNode.connect(delayDamp).connect(delayFeedback).connect(delayNode);

    delayReturn = audioCtx.createGain();
    delayReturn.gain.value = 0.9;
    delayNode.connect(delayReturn).connect(masterGain);
  }

  function buildStaticLayer() {
    const len = audioCtx.sampleRate * 2;
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    staticSource = audioCtx.createBufferSource();
    staticSource.buffer = buf;
    staticSource.loop = true;

    staticFilter = audioCtx.createBiquadFilter();
    staticFilter.type = "bandpass";
    staticFilter.frequency.value = 2600;
    staticFilter.Q.value = 0.7;

    staticGain = audioCtx.createGain();
    staticGain.gain.value = 0;

    staticSource.connect(staticFilter).connect(staticGain).connect(masterGain);
    staticSource.start();
  }

  function scheduleCrackle() {
    const next = 60 + Math.random() * 500;
    setTimeout(() => {
      if (crackleEnabled && audioCtx) fireCrackle();
      scheduleCrackle();
    }, next);
  }

  function fireCrackle() {
    const now = audioCtx.currentTime;
    const dur = 0.01 + Math.random() * 0.02;
    const len = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const g = audioCtx.createGain();
    g.gain.value = 0.35 + Math.random() * 0.35;
    src.connect(g).connect(masterGain);
    src.start(now);
  }

  // Inline AudioWorkletProcessor for lo-fi bit + sample-rate reduction,
  // loaded from a Blob so the app stays a plain set of static files.
  function bitcrusherWorkletURL() {
    const code = `
      class JunkBitcrusher extends AudioWorkletProcessor {
        static get parameterDescriptors() {
          return [
            { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16 },
            { name: 'reduction', defaultValue: 1, minValue: 1, maxValue: 60 },
          ];
        }
        constructor() {
          super();
          this._counter = 0;
          this._held = [0, 0];
        }
        process(inputs, outputs, parameters) {
          const input = inputs[0];
          const output = outputs[0];
          if (!output || !output.length) return true;
          const bitsParam = parameters.bits;
          const redParam = parameters.reduction;
          const frames = output[0].length;
          for (let i = 0; i < frames; i++) {
            const bits = bitsParam.length > 1 ? bitsParam[i] : bitsParam[0];
            const red = Math.max(1, Math.round(redParam.length > 1 ? redParam[i] : redParam[0]));
            const hold = this._counter % red === 0;
            const steps = Math.pow(2, bits);
            for (let ch = 0; ch < output.length; ch++) {
              const inCh = input[ch] || input[0];
              if (hold && inCh) {
                this._held[ch] = Math.round(inCh[i] * steps) / steps;
              }
              output[ch][i] = this._held[ch] || 0;
            }
            this._counter++;
          }
          return true;
        }
      }
      registerProcessor('junk-bitcrusher', JunkBitcrusher);
    `;
    const blob = new Blob([code], { type: "application/javascript" });
    return URL.createObjectURL(blob);
  }

  function makeDistortionCurve(amount) {
    const k = amount;
    const n = 1024;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // ---------------------------------------------------------------
  // knob widget
  // ---------------------------------------------------------------

  function createKnob({ label, min, max, value, step = 1, format, onChange }) {
    const wrap = document.createElement("div");
    wrap.className = "knob";

    const dial = document.createElement("div");
    dial.className = "knob-dial";
    const mark = document.createElement("div");
    mark.className = "knob-mark";
    dial.appendChild(mark);

    const valueEl = document.createElement("div");
    valueEl.className = "knob-value";
    const labelEl = document.createElement("div");
    labelEl.className = "knob-label";
    labelEl.textContent = label;

    wrap.appendChild(dial);
    wrap.appendChild(valueEl);
    wrap.appendChild(labelEl);

    const range = max - min;
    const fmt = format || ((v) => Math.round(v));
    let current = value;

    function render() {
      const frac = (current - min) / range;
      const angle = -135 + frac * 270;
      mark.style.transform = `translateX(-50%) rotate(${angle}deg)`;
      valueEl.textContent = fmt(current);
    }

    function setValue(v, fire) {
      current = Math.min(max, Math.max(min, v));
      render();
      if (fire !== false) onChange(current);
    }

    let dragging = false;
    let startY = 0;
    let startVal = 0;

    dial.addEventListener("pointerdown", (e) => {
      dragging = true;
      startY = e.clientY;
      startVal = current;
      dial.setPointerCapture(e.pointerId);
      wrap.classList.add("active");
    });
    dial.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      setValue(startVal + (dy / 140) * range);
    });
    function endDrag() {
      dragging = false;
      wrap.classList.remove("active");
    }
    dial.addEventListener("pointerup", endDrag);
    dial.addEventListener("pointercancel", endDrag);
    dial.addEventListener("dblclick", () => setValue(value));
    dial.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        setValue(current - Math.sign(e.deltaY) * step * 2);
      },
      { passive: false }
    );

    render();
    return { el: wrap, setValue: (v) => setValue(v, false), getValue: () => current };
  }

  // ---------------------------------------------------------------
  // file handling
  // ---------------------------------------------------------------

  function isAudioFile(file) {
    if (file.type && file.type.startsWith("audio/")) return true;
    return /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus|aiff|aif)$/i.test(file.name);
  }

  async function collectFilesFromDataTransfer(dataTransfer) {
    const items = dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
      const files = [];
      async function walk(entry) {
        if (entry.isFile) {
          const file = await new Promise((res, rej) => entry.file(res, rej));
          if (isAudioFile(file)) files.push(file);
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const readBatch = () => new Promise((res, rej) => reader.readEntries(res, rej));
          let batch;
          do {
            batch = await readBatch();
            for (const e of batch) await walk(e);
          } while (batch.length > 0);
        }
      }
      for (const entry of entries) await walk(entry);
      return files;
    }
    return Array.from(dataTransfer.files || []).filter(isAudioFile);
  }

  function reverseBuffer(buffer) {
    const rev = audioCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = rev.getChannelData(ch);
      const n = src.length;
      for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i];
    }
    return rev;
  }

  function getActiveBuffer(track) {
    const entry = track.pool[track.activeIndex];
    if (!entry) return null;
    if (!track.reversed) return entry.buffer;
    if (!entry.reversedBuffer) entry.reversedBuffer = reverseBuffer(entry.buffer);
    return entry.reversedBuffer;
  }

  async function loadFilesIntoTrack(track, fileList) {
    const files = Array.from(fileList).filter(isAudioFile);
    if (!files.length) return;
    await ensureAudioContext();
    await workletReady;

    const pool = [];
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        pool.push({ name: file.name, buffer: audioBuffer, reversedBuffer: null });
      } catch (err) {
        console.warn("decode failed:", file.name, err);
      }
    }
    if (!pool.length) return;

    stopTrack(track);
    track.pool = pool;
    track.activeIndex = Math.floor(Math.random() * pool.length);
    track.reversed = false;
    track.loopStart = undefined;
    track.loopLength = undefined;
    if (track.revBtn.classList.contains("on")) track.revBtn.classList.remove("on");

    drawWaveform(track);
    updateLoopOverlay(track);
    updateTrackName(track);
    updatePoolCount(track);
    setTrackEnabled(track, true);
  }

  // ---------------------------------------------------------------
  // loop-region picking
  // ---------------------------------------------------------------

  function pickLoopRegion(duration) {
    const rawBuckets = [
      { min: 0.12, max: 0.5, weight: 3 }, // stutter
      { min: 0.5, max: 1.8, weight: 4 }, // short loop
      { min: 1.8, max: 4.5, weight: 2 }, // longer loop
      { min: 4.5, max: 9, weight: 1 }, // long smear
    ];
    const buckets = rawBuckets
      .map((b) => ({ min: Math.min(b.min, duration), max: Math.min(b.max, duration), weight: b.weight }))
      .filter((b) => b.max - b.min > 0.02 || b.max >= duration - 0.001);

    let bucket = buckets[0] || { min: duration * 0.5, max: duration, weight: 1 };
    const totalWeight = buckets.reduce((s, b) => s + b.weight, 0);
    let r = Math.random() * totalWeight;
    for (const b of buckets) {
      if (r < b.weight) {
        bucket = b;
        break;
      }
      r -= b.weight;
    }

    const lo = Math.min(bucket.min, duration);
    const hi = Math.max(lo, Math.min(bucket.max, duration));
    let length = lo + Math.random() * (hi - lo);
    length = Math.max(0.05, Math.min(length, duration));

    const maxStart = Math.max(0, duration - length);
    const start = Math.random() * maxStart;
    return { start, length };
  }

  // ---------------------------------------------------------------
  // per-track audio chain
  // ---------------------------------------------------------------

  function buildTrackChain(track) {
    if (track.chain) return;

    const waveshaper = audioCtx.createWaveShaper();
    waveshaper.curve = makeDistortionCurve(10);
    waveshaper.oversample = "2x";

    const bitcrusher = new AudioWorkletNode(audioCtx, "junk-bitcrusher", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 14000;
    filter.Q.value = 4;

    const trackGain = audioCtx.createGain();
    trackGain.gain.value = 0.8;

    const delaySend = audioCtx.createGain();
    delaySend.gain.value = 0.09;

    const wobbleOsc = audioCtx.createOscillator();
    wobbleOsc.type = "sine";
    wobbleOsc.frequency.value = 3 + Math.random() * 3;
    const wobbleDepth = audioCtx.createGain();
    wobbleDepth.gain.value = 0.015;
    wobbleOsc.connect(wobbleDepth);
    wobbleOsc.start();

    waveshaper.connect(bitcrusher).connect(filter).connect(trackGain);
    trackGain.connect(masterGain);
    trackGain.connect(delaySend).connect(delayNode);

    track.chain = {
      waveshaper,
      bitcrusher,
      filter,
      trackGain,
      delaySend,
      wobbleOsc,
      wobbleDepth,
      inputNode: waveshaper,
    };

    if (track.pendingKnobs) {
      track.pendingKnobs.forEach((fn) => fn());
      track.pendingKnobs = null;
    }
  }

  function stopTrack(track) {
    if (track.source) {
      try {
        track.source.stop();
      } catch (e) {}
      try {
        track.source.disconnect();
      } catch (e) {}
      if (track.chain && track.wobbleConnected) {
        try {
          track.chain.wobbleDepth.disconnect(track.source.playbackRate);
        } catch (e) {}
      }
      track.source = null;
    }
    track.isPlaying = false;
    track.wobbleConnected = false;
    track.playBtn.textContent = "▶ PLAY";
    track.playBtn.classList.remove("playing");
  }

  async function startTrackPlayback(track) {
    await ensureAudioContext();
    await workletReady;
    if (!track.chain) buildTrackChain(track);
    if (!track.pool.length) return;

    const buffer = getActiveBuffer(track);
    if (!buffer) return;

    if (track.loopStart === undefined) {
      const region = pickLoopRegion(buffer.duration);
      track.loopStart = region.start;
      track.loopLength = region.length;
    }

    if (track.source) {
      try {
        track.source.stop();
        track.source.disconnect();
      } catch (e) {}
    }

    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = track.loopStart;
    src.loopEnd = Math.min(track.loopStart + track.loopLength, buffer.duration);
    src.connect(track.chain.inputNode);

    if (track.wobbleEnabled) {
      track.chain.wobbleDepth.connect(src.playbackRate);
      track.wobbleConnected = true;
    } else {
      track.wobbleConnected = false;
    }

    src.start(audioCtx.currentTime, track.loopStart);
    track.source = src;
    track.isPlaying = true;
    track.playStartTime = audioCtx.currentTime;

    track.playBtn.textContent = "■ STOP";
    track.playBtn.classList.add("playing");
  }

  async function cycleTrack(track) {
    await ensureAudioContext();
    await workletReady;
    if (!track.pool.length) return;

    if (track.pool.length > 1 && Math.random() < 0.35) {
      let idx;
      do {
        idx = Math.floor(Math.random() * track.pool.length);
      } while (idx === track.activeIndex);
      track.activeIndex = idx;
      updateTrackName(track);
      drawWaveform(track);
    }

    const buffer = getActiveBuffer(track);
    if (!buffer) return;
    const region = pickLoopRegion(buffer.duration);
    track.loopStart = region.start;
    track.loopLength = region.length;

    await startTrackPlayback(track);
    updateLoopOverlay(track);
    updateLoopInfo(track);
    flashPanel(track);
  }

  function flashPanel(track) {
    track.plate.classList.add("flash");
    clearTimeout(track.flashTimer);
    track.flashTimer = setTimeout(() => track.plate.classList.remove("flash"), 260);
  }

  // ---------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------

  function updateTrackName(track) {
    const entry = track.pool[track.activeIndex];
    if (!entry) {
      track.nameEl.textContent = "— 空 EMPTY —";
      track.nameEl.classList.remove("loaded");
      return;
    }
    track.nameEl.textContent = entry.name + (track.reversed ? " ◄REV" : "");
    track.nameEl.classList.add("loaded");
  }

  function updatePoolCount(track) {
    track.poolCountEl.textContent = track.pool.length > 1 ? `${track.pool.length} files` : "";
  }

  function updateLoopInfo(track) {
    if (track.loopStart === undefined) {
      track.loopInfoEl.textContent = "loop: —";
      return;
    }
    track.loopInfoEl.textContent = `loop: ${track.loopStart.toFixed(2)}s → +${track.loopLength.toFixed(2)}s`;
  }

  function setTrackEnabled(track, enabled) {
    [track.playBtn, track.cycleBtn, track.wobbleBtn, track.revBtn].forEach((b) => (b.disabled = !enabled));
  }

  function resizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      return true;
    }
    return false;
  }

  function drawWaveform(track) {
    const canvas = track.waveformEl;
    resizeCanvas(canvas);
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const entry = track.pool[track.activeIndex];
    if (!entry) return;
    const buffer = entry.buffer;
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.ceil(data.length / w));

    ctx.fillStyle = "rgba(232, 179, 48, 0.85)";
    for (let x = 0; x < w; x++) {
      let min = 1.0;
      let max = -1.0;
      const start = x * step;
      const end = Math.min(data.length, start + step);
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max < min) {
        min = 0;
        max = 0;
      }
      const y1 = ((1 + min) * 0.5) * h;
      const y2 = ((1 + max) * 0.5) * h;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }

  function updateLoopOverlay(track) {
    const entry = track.pool[track.activeIndex];
    if (!entry || track.loopStart === undefined) {
      track.loopOverlayEl.style.display = "none";
      return;
    }
    const buffer = getActiveBuffer(track);
    const duration = buffer.duration;
    const leftPct = (track.loopStart / duration) * 100;
    const widthPct = (track.loopLength / duration) * 100;
    track.loopOverlayEl.style.display = "block";
    track.loopOverlayEl.style.left = leftPct + "%";
    track.loopOverlayEl.style.width = Math.max(0.6, widthPct) + "%";
  }

  // ---------------------------------------------------------------
  // per-track knob params
  // ---------------------------------------------------------------

  function withChain(track, fn) {
    if (track.chain) {
      fn(track.chain);
    } else {
      track.pendingKnobs = track.pendingKnobs || [];
      track.pendingKnobs.push(() => fn(track.chain));
    }
  }

  function setupKnobs(track) {
    const knobRow = track.el.querySelector('[data-role="knobs"]');

    const crush = createKnob({
      label: "CRUSH",
      min: 0,
      max: 100,
      value: 15,
      format: (v) => Math.round(v),
      onChange: (v) => {
        withChain(track, (chain) => {
          const now = audioCtx.currentTime;
          const bits = 16 - (v / 100) * 12;
          const reduction = 1 + (v / 100) * 40;
          chain.bitcrusher.parameters.get("bits").setTargetAtTime(bits, now, 0.01);
          chain.bitcrusher.parameters.get("reduction").setTargetAtTime(reduction, now, 0.01);
        });
      },
    });

    const grit = createKnob({
      label: "GRIT",
      min: 0,
      max: 100,
      value: 10,
      format: (v) => Math.round(v),
      onChange: (v) => {
        withChain(track, (chain) => {
          chain.waveshaper.curve = makeDistortionCurve((v / 100) * 300);
        });
      },
    });

    const filterKnob = createKnob({
      label: "FILTER",
      min: 0,
      max: 100,
      value: 100,
      format: (v) => Math.round(v),
      onChange: (v) => {
        withChain(track, (chain) => {
          const now = audioCtx.currentTime;
          const freq = 300 * Math.pow(14000 / 300, v / 100);
          chain.filter.frequency.setTargetAtTime(freq, now, 0.01);
        });
      },
    });

    const delayKnob = createKnob({
      label: "DELAY",
      min: 0,
      max: 100,
      value: 12,
      format: (v) => Math.round(v),
      onChange: (v) => {
        withChain(track, (chain) => {
          chain.delaySend.gain.setTargetAtTime((v / 100) * 0.6, audioCtx.currentTime, 0.01);
        });
      },
    });

    const vol = createKnob({
      label: "VOL",
      min: 0,
      max: 100,
      value: 80,
      format: (v) => Math.round(v),
      onChange: (v) => {
        withChain(track, (chain) => {
          chain.trackGain.gain.setTargetAtTime(v / 100, audioCtx.currentTime, 0.01);
        });
      },
    });

    [crush, grit, filterKnob, delayKnob, vol].forEach((k) => knobRow.appendChild(k.el));
  }

  // ---------------------------------------------------------------
  // track wiring
  // ---------------------------------------------------------------

  function setupTrack(index) {
    const el = document.querySelector(`.track[data-track="${index}"]`);
    const track = {
      index,
      el,
      plate: el.querySelector(".track-plate"),
      nameEl: el.querySelector('[data-role="name"]'),
      waveformEl: el.querySelector('[data-role="waveform"]'),
      loopOverlayEl: el.querySelector('[data-role="loopOverlay"]'),
      playheadEl: el.querySelector('[data-role="playhead"]'),
      hintEl: el.querySelector('[data-role="hint"]'),
      dropzoneEl: el.querySelector('[data-role="dropzone"]'),
      fileBtn: el.querySelector('[data-role="fileBtn"]'),
      folderBtn: el.querySelector('[data-role="folderBtn"]'),
      fileInput: el.querySelector('[data-role="fileInput"]'),
      folderInput: el.querySelector('[data-role="folderInput"]'),
      poolCountEl: el.querySelector('[data-role="poolCount"]'),
      playBtn: el.querySelector('[data-role="playBtn"]'),
      cycleBtn: el.querySelector('[data-role="cycleBtn"]'),
      wobbleBtn: el.querySelector('[data-role="wobbleBtn"]'),
      revBtn: el.querySelector('[data-role="revBtn"]'),
      loopInfoEl: el.querySelector('[data-role="loopInfo"]'),
      pool: [],
      activeIndex: 0,
      reversed: false,
      wobbleEnabled: false,
      isPlaying: false,
      chain: null,
      source: null,
      loopStart: undefined,
      loopLength: undefined,
    };

    setupKnobs(track);

    track.fileBtn.addEventListener("click", () => track.fileInput.click());
    track.folderBtn.addEventListener("click", () => track.folderInput.click());
    track.fileInput.addEventListener("change", (e) => {
      loadFilesIntoTrack(track, e.target.files);
      e.target.value = "";
    });
    track.folderInput.addEventListener("change", (e) => {
      loadFilesIntoTrack(track, e.target.files);
      e.target.value = "";
    });

    track.dropzoneEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      track.dropzoneEl.classList.add("dragover");
    });
    track.dropzoneEl.addEventListener("dragleave", () => {
      track.dropzoneEl.classList.remove("dragover");
    });
    track.dropzoneEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      track.dropzoneEl.classList.remove("dragover");
      const files = await collectFilesFromDataTransfer(e.dataTransfer);
      if (files.length) loadFilesIntoTrack(track, files);
    });

    track.playBtn.addEventListener("click", () => {
      if (track.isPlaying) {
        stopTrack(track);
      } else {
        startTrackPlayback(track);
      }
    });

    track.cycleBtn.addEventListener("click", () => cycleTrack(track));

    track.wobbleBtn.addEventListener("click", async () => {
      track.wobbleEnabled = !track.wobbleEnabled;
      track.wobbleBtn.classList.toggle("on", track.wobbleEnabled);
      if (track.source && track.chain) {
        if (track.wobbleEnabled && !track.wobbleConnected) {
          track.chain.wobbleDepth.connect(track.source.playbackRate);
          track.wobbleConnected = true;
        } else if (!track.wobbleEnabled && track.wobbleConnected) {
          try {
            track.chain.wobbleDepth.disconnect(track.source.playbackRate);
          } catch (e) {}
          track.wobbleConnected = false;
        }
      }
    });

    track.revBtn.addEventListener("click", () => {
      track.reversed = !track.reversed;
      track.revBtn.classList.toggle("on", track.reversed);
      updateTrackName(track);
      if (track.pool.length) {
        track.loopStart = undefined;
        cycleTrack(track);
      }
    });

    tracks.push(track);
  }

  function setupMaster() {
    const masterKnobRow = document.querySelector('[data-role="masterKnobs"]');
    const masterVol = createKnob({
      label: "MASTER",
      min: 0,
      max: 100,
      value: 80,
      format: (v) => Math.round(v),
      onChange: (v) => {
        if (masterGain) masterGain.gain.setTargetAtTime(v / 100, audioCtx.currentTime, 0.01);
      },
    });
    masterKnobRow.appendChild(masterVol.el);

    const staticBtn = document.getElementById("staticBtn");
    staticBtn.addEventListener("click", async () => {
      await ensureAudioContext();
      const on = staticBtn.classList.toggle("on");
      staticGain.gain.setTargetAtTime(on ? 0.045 : 0, audioCtx.currentTime, 0.4);
    });

    const crackleBtn = document.getElementById("crackleBtn");
    crackleBtn.addEventListener("click", () => {
      crackleEnabled = !crackleEnabled;
      crackleBtn.classList.toggle("on", crackleEnabled);
    });

    const stopAllBtn = document.getElementById("stopAllBtn");
    stopAllBtn.addEventListener("click", () => {
      tracks.forEach((t) => stopTrack(t));
    });
  }

  // ---------------------------------------------------------------
  // playhead animation
  // ---------------------------------------------------------------

  function animate() {
    requestAnimationFrame(animate);
    if (!audioCtx) return;
    for (const track of tracks) {
      if (!track.isPlaying) {
        track.playheadEl.style.display = "none";
        continue;
      }
      const buffer = getActiveBuffer(track);
      if (!buffer) continue;
      const loopLen = track.loopLength || 0.001;
      const elapsed = audioCtx.currentTime - track.playStartTime;
      const posInLoop = track.loopStart + (elapsed % loopLen);
      const frac = posInLoop / buffer.duration;
      track.playheadEl.style.display = "block";
      track.playheadEl.style.left = frac * 100 + "%";
    }
  }

  window.addEventListener("resize", () => {
    tracks.forEach((t) => {
      if (t.pool.length) {
        drawWaveform(t);
        updateLoopOverlay(t);
      }
    });
  });

  for (let i = 0; i < TRACK_COUNT; i++) setupTrack(i);
  setupMaster();
  requestAnimationFrame(animate);
})();
