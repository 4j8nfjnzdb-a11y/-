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
  let bitcrusherAvailable = true;
  let masterGain, compressor;
  let delayNode, delayFeedback, delayDamp, delayReturn;
  let staticSource, staticGain, staticFilter;
  let crackleEnabled = false;
  let masterRecActive = false;
  let masterRecProcessor = null;
  let masterRecSilentGain = null;
  let masterRecChunks = [];
  let masterRecUrl = null;
  let masterRecBlob = null;

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

    // AudioWorklet can fail to load its module in some contexts (most
    // notably: the page opened directly via file:// instead of served
    // over http/https) — fall back to a ScriptProcessor bitcrusher
    // rather than leaving every await on workletReady hanging forever.
    workletReady = audioCtx.audioWorklet
      .addModule(bitcrusherWorkletURL())
      .then(() => {
        bitcrusherAvailable = true;
      })
      .catch((err) => {
        console.warn("AudioWorklet unavailable, falling back to a ScriptProcessor bitcrusher:", err);
        bitcrusherAvailable = false;
      })
      .then(() => {
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
    return { el: wrap, min, max, setValue: (v, fire = true) => setValue(v, fire), getValue: () => current };
  }

  // ---------------------------------------------------------------
  // file handling
  // ---------------------------------------------------------------

  function isAudioFile(file) {
    if (file.type && file.type.startsWith("audio/")) return true;
    return /\.(mp3|wav|wave|ogg|oga|m4a|aac|flac|webm|opus|aiff|aif|caf)$/i.test(file.name);
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

  // Encodes mono Float32 samples as a 16-bit PCM WAV Blob — plays and
  // saves everywhere, no MediaRecorder codec/container guessing needed.
  function encodeWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([view], { type: "audio/wav" });
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

  // A loop region picked at a random sample position almost never lands
  // on a zero-crossing, so the waveform jumps at the wrap point — heard
  // as a click/pop every time the loop repeats. Rather than hunting for
  // zero-crossings, cut a standalone buffer for just the loop region and
  // fade both ends toward silence for a few ms, so the seam always meets
  // near zero instead of wherever the waveform happened to be.
  function buildLoopBuffer(sourceBuffer, startSec, lengthSec) {
    const sampleRate = sourceBuffer.sampleRate;
    const startSample = Math.floor(startSec * sampleRate);
    const numSamples = Math.max(1, Math.floor(lengthSec * sampleRate));
    const numChannels = sourceBuffer.numberOfChannels;
    const fadeSamples = Math.max(2, Math.min(Math.floor(sampleRate * 0.008), Math.floor(numSamples * 0.1)));

    const loopBuffer = audioCtx.createBuffer(numChannels, numSamples, sampleRate);
    for (let ch = 0; ch < numChannels; ch++) {
      const src = sourceBuffer.getChannelData(ch);
      const dst = loopBuffer.getChannelData(ch);
      for (let i = 0; i < numSamples; i++) {
        const srcIdx = startSample + i;
        dst[i] = srcIdx < src.length ? src[srcIdx] : 0;
      }
      for (let i = 0; i < fadeSamples; i++) {
        dst[i] *= i / fadeSamples;
        dst[numSamples - 1 - i] *= i / fadeSamples;
      }
    }
    return loopBuffer;
  }

  // Decodes a pool entry's audio on first use and caches the result —
  // loading a folder full of files only has to enumerate filenames
  // up front, not decode every file in it before the track is usable.
  async function ensureEntryBuffer(entry) {
    if (entry.buffer) return entry.buffer;
    if (!entry.file) return null;
    const arrayBuffer = await entry.file.arrayBuffer();
    entry.buffer = await audioCtx.decodeAudioData(arrayBuffer);
    return entry.buffer;
  }

  async function getActiveBuffer(track) {
    const entry = track.pool[track.activeIndex];
    if (!entry) return null;
    let buffer;
    try {
      buffer = await ensureEntryBuffer(entry);
    } catch (err) {
      console.warn("decode failed:", entry.name, err);
      return null;
    }
    if (!buffer) return null;
    if (!track.reversed) return buffer;
    if (!entry.reversedBuffer) entry.reversedBuffer = reverseBuffer(buffer);
    return entry.reversedBuffer;
  }

  // Keeps memory bounded to roughly one decoded buffer per track: once
  // a pool entry stops being the active one, drop its decoded audio so
  // a large folder doesn't accumulate dozens of full decodes over a
  // session (the file itself is kept, so it decodes again if revisited).
  function evictEntryBuffer(track, index) {
    if (index === undefined || index === track.activeIndex) return;
    const entry = track.pool[index];
    if (entry && entry.file) {
      entry.buffer = null;
      entry.reversedBuffer = null;
    }
  }

  function setLoadStatus(track, message) {
    track.loadStatusEl.textContent = message || "";
  }

  async function loadFilesIntoTrack(track, fileList, opts = {}) {
    // The FILE button's <input accept="audio/*,..."> already restricted the
    // OS picker to audio, so a second name/mime re-check here can only ever
    // reject a file the user deliberately chose. Only apply that filter for
    // FOLDER loads and drag-and-drop, where arbitrary non-audio files are
    // likely to be mixed in.
    const applyFilter = opts.filter !== false;
    const candidates = Array.from(fileList);
    const files = applyFilter ? candidates.filter(isAudioFile) : candidates;

    if (!files.length) {
      setLoadStatus(track, candidates.length ? "音声ファイルが見つかりませんでした" : "");
      return;
    }
    await ensureAudioContext();
    await workletReady;

    // Just wrap the File objects — nothing gets decoded here. Decoding
    // every file in a big folder up front is what made loading slow
    // and, once memory pressure hit, made later files fail to decode.
    const pool = files.map((file) => ({ name: file.name, file, buffer: null, reversedBuffer: null }));

    stopTrack(track);
    track.pool = pool;
    track.reversed = false;
    track.loopStart = undefined;
    track.loopLength = undefined;
    if (track.revBtn.classList.contains("on")) track.revBtn.classList.remove("on");

    // Decode just the one file that's about to actually play. If it
    // happens to be unplayable, try a few other random picks rather
    // than leaving the track stuck on a dead file.
    let ready = false;
    const tried = new Set();
    for (let attempt = 0; attempt < Math.min(5, pool.length); attempt++) {
      const idx = Math.floor(Math.random() * pool.length);
      if (tried.has(idx)) continue;
      tried.add(idx);
      track.activeIndex = idx;
      try {
        await ensureEntryBuffer(pool[idx]);
        ready = true;
        break;
      } catch (err) {
        console.warn("decode failed:", pool[idx].name, err);
      }
    }

    if (!ready) {
      setLoadStatus(track, "読み込みに失敗しました(非対応の形式かも)");
      updateTrackName(track);
      updatePoolCount(track);
      setTrackEnabled(track, false);
      return;
    }

    setLoadStatus(track, "");
    drawWaveform(track);
    updateLoopOverlay(track);
    updateTrackName(track);
    updatePoolCount(track);
    setTrackEnabled(track, true);
  }

  // ---------------------------------------------------------------
  // mic recording — captures raw PCM straight off the mic input, so
  // there's no codec/container to fail decoding later.
  // ---------------------------------------------------------------

  async function startRecording(track) {
    if (track.isRecording) return;
    for (const t of tracks) {
      if (t !== track && t.isRecording) stopRecording(t);
    }
    await ensureAudioContext();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setLoadStatus(track, "マイクを使用できませんでした: " + err.message);
      return;
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    const chunks = [];

    processor.onaudioprocess = (e) => {
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(silentGain).connect(audioCtx.destination);

    track.isRecording = true;
    track.mediaStream = stream;
    track.recSource = source;
    track.recProcessor = processor;
    track.recSilentGain = silentGain;
    track.recChunks = chunks;
    track.recBtn.classList.add("recording");
    track.recBtn.textContent = "⏺ REC…";
    setLoadStatus(track, "");
  }

  function stopRecording(track) {
    if (!track.isRecording) return;
    track.isRecording = false;
    track.recBtn.classList.remove("recording");
    track.recBtn.textContent = "🎙 REC";

    track.recProcessor.disconnect();
    track.recSource.disconnect();
    track.recSilentGain.disconnect();
    track.mediaStream.getTracks().forEach((t) => t.stop());

    const chunks = track.recChunks;
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    track.mediaStream = null;
    track.recSource = null;
    track.recProcessor = null;
    track.recSilentGain = null;
    track.recChunks = null;

    if (totalLen < 1024) {
      setLoadStatus(track, "録音が短すぎます。もう一度試してください");
      return;
    }

    const data = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      data.set(c, offset);
      offset += c.length;
    }
    const buffer = audioCtx.createBuffer(1, data.length, audioCtx.sampleRate);
    buffer.getChannelData(0).set(data);

    const stamp = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    stopTrack(track);
    track.pool = [{ name: `🎙 REC ${stamp}`, buffer, reversedBuffer: null }];
    track.activeIndex = 0;
    track.reversed = false;
    track.loopStart = undefined;
    track.loopLength = undefined;
    if (track.revBtn.classList.contains("on")) track.revBtn.classList.remove("on");

    setLoadStatus(track, "");
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
      { min: 0.12, max: 0.5, weight: 3 }, // micro stutter
      { min: 0.5, max: 1.5, weight: 4 }, // ~1s
      { min: 1.5, max: 4, weight: 3 }, // ~2-3s
      { min: 4, max: 9, weight: 2 }, // ~5-8s
      { min: 9, max: 18, weight: 1.5 }, // ~10-15s
      { min: 18, max: 30, weight: 1 }, // ~20-30s, long smear
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

  // Wraps either an AudioWorkletNode (preferred) or a ScriptProcessorNode
  // fallback behind the same {node, setBits, setReduction} shape, so the
  // rest of the chain and the CRUSH knob don't need to know which one is
  // actually running.
  function createBitcrusher() {
    if (bitcrusherAvailable) {
      const node = new AudioWorkletNode(audioCtx, "junk-bitcrusher", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      return {
        node,
        setBits: (v) => node.parameters.get("bits").setTargetAtTime(v, audioCtx.currentTime, 0.01),
        setReduction: (v) => node.parameters.get("reduction").setTargetAtTime(v, audioCtx.currentTime, 0.01),
      };
    }

    const node = audioCtx.createScriptProcessor(1024, 2, 2);
    const state = { bits: 16, reduction: 1, counter: 0, held: [0, 0] };
    node.onaudioprocess = (e) => {
      const input = e.inputBuffer;
      const output = e.outputBuffer;
      const steps = Math.pow(2, state.bits);
      const red = Math.max(1, Math.round(state.reduction));
      for (let ch = 0; ch < output.numberOfChannels; ch++) {
        const inCh = input.getChannelData(Math.min(ch, input.numberOfChannels - 1));
        const outCh = output.getChannelData(ch);
        for (let i = 0; i < outCh.length; i++) {
          if ((state.counter + i) % red === 0) {
            state.held[ch] = Math.round(inCh[i] * steps) / steps;
          }
          outCh[i] = state.held[ch] || 0;
        }
      }
      state.counter += output.getChannelData(0).length;
    };
    return {
      node,
      setBits: (v) => {
        state.bits = v;
      },
      setReduction: (v) => {
        state.reduction = v;
      },
    };
  }

  // ---------------------------------------------------------------
  // per-track audio chain
  // ---------------------------------------------------------------

  function buildTrackChain(track) {
    if (track.chain) return;

    const waveshaper = audioCtx.createWaveShaper();
    waveshaper.curve = makeDistortionCurve(10);
    waveshaper.oversample = "2x";

    const bitcrusher = createBitcrusher();

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

    waveshaper.connect(bitcrusher.node).connect(filter).connect(trackGain);
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

    const buffer = await getActiveBuffer(track);
    if (!buffer) {
      setLoadStatus(track, "この音声を再生できませんでした");
      return;
    }

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

    const loopBuffer = buildLoopBuffer(buffer, track.loopStart, track.loopLength);

    const src = audioCtx.createBufferSource();
    src.buffer = loopBuffer;
    src.loop = true;
    src.playbackRate.value = track.pitchRatio;
    src.connect(track.chain.inputNode);

    if (track.wobbleEnabled) {
      track.chain.wobbleDepth.connect(src.playbackRate);
      track.wobbleConnected = true;
    } else {
      track.wobbleConnected = false;
    }

    src.start(audioCtx.currentTime);
    track.source = src;
    track.activeBufferDuration = buffer.duration;
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
      const previousIndex = track.activeIndex;
      const tried = new Set([previousIndex]);
      const attempts = Math.min(4, track.pool.length - 1);
      for (let attempt = 0; attempt < attempts; attempt++) {
        let idx;
        do {
          idx = Math.floor(Math.random() * track.pool.length);
        } while (tried.has(idx));
        tried.add(idx);
        try {
          await ensureEntryBuffer(track.pool[idx]);
          track.activeIndex = idx;
          evictEntryBuffer(track, previousIndex);
          updateTrackName(track);
          drawWaveform(track);
          break;
        } catch (err) {
          console.warn("skipping unplayable file:", track.pool[idx].name, err);
        }
      }
    }

    const buffer = await getActiveBuffer(track);
    if (!buffer) {
      setLoadStatus(track, "この音声を再生できませんでした");
      return;
    }
    setLoadStatus(track, "");
    const region = pickLoopRegion(buffer.duration);
    track.loopStart = region.start;
    track.loopLength = region.length;

    await startTrackPlayback(track);
    updateLoopOverlay(track);
    updateLoopInfo(track);
    flashPanel(track);
  }

  // ---------------------------------------------------------------
  // manual loop placement — drag across the waveform to pick an exact
  // region by hand, instead of leaving it to CYCLE's dice.
  // ---------------------------------------------------------------

  function getActiveDuration(track) {
    const entry = track.pool[track.activeIndex];
    if (!entry) return null;
    const buffer = track.reversed && entry.reversedBuffer ? entry.reversedBuffer : entry.buffer;
    return buffer ? buffer.duration : null;
  }

  function previewManualSelection(track, fracA, fracB) {
    const left = Math.min(fracA, fracB) * 100;
    const width = Math.max(0.6, Math.abs(fracB - fracA) * 100);
    track.loopOverlayEl.style.display = "block";
    track.loopOverlayEl.style.left = left + "%";
    track.loopOverlayEl.style.width = width + "%";
  }

  async function applyManualLoopSelection(track, fracA, fracB) {
    const duration = getActiveDuration(track);
    if (!duration) return;

    const lo = Math.min(fracA, fracB) * duration;
    const hi = Math.max(fracA, fracB) * duration;
    const dragWidthFrac = Math.abs(fracB - fracA);

    let start, length;
    if (dragWidthFrac < 0.015) {
      // A near-zero drag reads as a click: keep the current loop length
      // and just slide it so it starts at the clicked point.
      length = track.loopLength && track.loopLength <= duration ? track.loopLength : Math.min(1, duration);
      start = Math.min(lo, Math.max(0, duration - length));
    } else {
      start = lo;
      length = Math.max(0.05, hi - lo);
    }

    track.loopStart = start;
    track.loopLength = length;
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

  // Each track rolls its own dice on its own clock, so with several
  // tracks running AUTO the whole rack keeps mutating out of sync with
  // itself instead of everything re-rolling in lockstep.
  function scheduleAutoCycle(track) {
    clearTimeout(track.autoTimer);
    if (!track.autoEnabled) return;
    const delay = 700 + Math.random() * 7000;
    track.autoTimer = setTimeout(async () => {
      if (!track.autoEnabled) return;
      await cycleTrack(track);
      scheduleAutoCycle(track);
    }, delay);
  }

  function setAutoEnabled(track, enabled) {
    track.autoEnabled = enabled;
    track.autoBtn.classList.toggle("on", enabled);
    if (enabled) {
      cycleTrack(track);
      scheduleAutoCycle(track);
    } else {
      clearTimeout(track.autoTimer);
    }
  }

  // ---------------------------------------------------------------
  // "ALL FX" dice — re-rolls every effect knob (crush/grit/filter/
  // delay/pitch) on its own per-track clock, independent of the
  // loop-region dice above.
  // ---------------------------------------------------------------

  let fxAutoEnabled = false;

  function rollTrackEffects(track) {
    if (!track.knobs) return;
    const k = track.knobs;
    k.crush.setValue(Math.random() * 100);
    k.grit.setValue(Math.random() * 100);
    k.filter.setValue(Math.random() * 100);
    k.delay.setValue(Math.random() * 100);
    k.pitch.setValue(k.pitch.min + Math.random() * (k.pitch.max - k.pitch.min));
  }

  function scheduleFxRoll(track) {
    clearTimeout(track.fxTimer);
    if (!fxAutoEnabled) return;
    const delay = 1200 + Math.random() * 8000;
    track.fxTimer = setTimeout(() => {
      if (!fxAutoEnabled) return;
      rollTrackEffects(track);
      scheduleFxRoll(track);
    }, delay);
  }

  function setFxAutoEnabled(enabled, fxAllBtn) {
    fxAutoEnabled = enabled;
    fxAllBtn.classList.toggle("on", enabled);
    tracks.forEach((t) => {
      if (enabled) {
        rollTrackEffects(t);
        scheduleFxRoll(t);
      } else {
        clearTimeout(t.fxTimer);
      }
    });
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
    [track.playBtn, track.cycleBtn, track.wobbleBtn, track.revBtn, track.autoBtn].forEach((b) => (b.disabled = !enabled));
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
    if (!entry || !entry.buffer) return;
    const buffer = track.reversed && entry.reversedBuffer ? entry.reversedBuffer : entry.buffer;
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
    const buffer = track.reversed && entry && entry.reversedBuffer ? entry.reversedBuffer : entry && entry.buffer;
    if (!entry || !buffer || track.loopStart === undefined) {
      track.loopOverlayEl.style.display = "none";
      return;
    }
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
          const bits = 16 - (v / 100) * 12;
          const reduction = 1 + (v / 100) * 40;
          chain.bitcrusher.setBits(bits);
          chain.bitcrusher.setReduction(reduction);
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

    const pitch = createKnob({
      label: "PITCH",
      min: -24,
      max: 24,
      value: 0,
      format: (v) => (v > 0 ? "+" : "") + Math.round(v) + "st",
      onChange: (v) => {
        track.pitchRatio = Math.pow(2, v / 12);
        if (track.source) {
          track.source.playbackRate.setTargetAtTime(track.pitchRatio, audioCtx.currentTime, 0.01);
        }
      },
    });

    track.knobs = { crush, grit, filter: filterKnob, delay: delayKnob, vol, pitch };
    [crush, grit, filterKnob, delayKnob, pitch, vol].forEach((k) => knobRow.appendChild(k.el));
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
      recBtn: el.querySelector('[data-role="recBtn"]'),
      fileInput: el.querySelector('[data-role="fileInput"]'),
      folderInput: el.querySelector('[data-role="folderInput"]'),
      poolCountEl: el.querySelector('[data-role="poolCount"]'),
      loadStatusEl: el.querySelector('[data-role="loadStatus"]'),
      playBtn: el.querySelector('[data-role="playBtn"]'),
      cycleBtn: el.querySelector('[data-role="cycleBtn"]'),
      wobbleBtn: el.querySelector('[data-role="wobbleBtn"]'),
      revBtn: el.querySelector('[data-role="revBtn"]'),
      autoBtn: el.querySelector('[data-role="autoBtn"]'),
      loopInfoEl: el.querySelector('[data-role="loopInfo"]'),
      pool: [],
      activeIndex: 0,
      reversed: false,
      wobbleEnabled: false,
      autoEnabled: false,
      autoTimer: null,
      pitchRatio: 1,
      fxTimer: null,
      isRecording: false,
      mediaStream: null,
      isPlaying: false,
      chain: null,
      source: null,
      loopStart: undefined,
      loopLength: undefined,
    };

    setupKnobs(track);

    track.recBtn.addEventListener("click", () => {
      if (track.isRecording) stopRecording(track);
      else startRecording(track);
    });
    track.fileInput.addEventListener("change", (e) => {
      loadFilesIntoTrack(track, e.target.files, { filter: false });
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

    // Manual loop placement: drag across the waveform to pick an exact
    // region, or just click to slide the current-length loop to that
    // point — an alternative to CYCLE's random pick.
    let manualDragging = false;
    let manualDragStartFrac = 0;

    function fracFromPointer(e) {
      const rect = track.dropzoneEl.getBoundingClientRect();
      if (!rect.width) return 0;
      const x = Math.min(rect.right, Math.max(rect.left, e.clientX));
      return (x - rect.left) / rect.width;
    }

    track.dropzoneEl.addEventListener("pointerdown", (e) => {
      if (!track.pool.length || e.button !== 0) return;
      manualDragging = true;
      manualDragStartFrac = fracFromPointer(e);
      track.dropzoneEl.setPointerCapture(e.pointerId);
      previewManualSelection(track, manualDragStartFrac, manualDragStartFrac);
      e.preventDefault();
    });
    track.dropzoneEl.addEventListener("pointermove", (e) => {
      if (!manualDragging) return;
      previewManualSelection(track, manualDragStartFrac, fracFromPointer(e));
    });
    track.dropzoneEl.addEventListener("pointerup", (e) => {
      if (!manualDragging) return;
      manualDragging = false;
      applyManualLoopSelection(track, manualDragStartFrac, fracFromPointer(e));
    });
    track.dropzoneEl.addEventListener("pointercancel", () => {
      if (!manualDragging) return;
      manualDragging = false;
      updateLoopOverlay(track);
    });

    track.playBtn.addEventListener("click", () => {
      if (track.isPlaying) {
        if (track.autoEnabled) setAutoEnabled(track, false);
        stopTrack(track);
      } else {
        startTrackPlayback(track);
      }
    });

    track.cycleBtn.addEventListener("click", () => cycleTrack(track));

    track.autoBtn.addEventListener("click", () => setAutoEnabled(track, !track.autoEnabled));

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

  // ---------------------------------------------------------------
  // master mix recorder — bounces whatever the rack is currently
  // playing (post-compressor) to a file the user can play back / save.
  // ---------------------------------------------------------------

  async function startMasterRecording(recAllBtn) {
    await ensureAudioContext();

    masterRecChunks = [];
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = (e) => {
      masterRecChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    compressor.connect(processor);
    processor.connect(silentGain).connect(audioCtx.destination);

    masterRecActive = true;
    masterRecProcessor = processor;
    masterRecSilentGain = silentGain;

    recAllBtn.classList.add("recording");
    recAllBtn.textContent = "⏺ REC MIX…";
  }

  function stopMasterRecording(recAllBtn) {
    if (!masterRecActive) return;
    masterRecActive = false;
    recAllBtn.classList.remove("recording");
    recAllBtn.textContent = "⏺ ALL REC";

    try {
      compressor.disconnect(masterRecProcessor);
    } catch (e) {}
    try {
      masterRecProcessor.disconnect();
    } catch (e) {}
    try {
      masterRecSilentGain.disconnect();
    } catch (e) {}
    masterRecProcessor = null;
    masterRecSilentGain = null;

    const chunks = masterRecChunks;
    masterRecChunks = [];
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    if (totalLen < 1024) {
      setMasterRecStatus("録音が短すぎます。もう一度試してください");
      return;
    }

    const data = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      data.set(c, offset);
      offset += c.length;
    }

    const blob = encodeWav(data, audioCtx.sampleRate);
    masterRecBlob = blob;
    if (masterRecUrl) URL.revokeObjectURL(masterRecUrl);
    masterRecUrl = URL.createObjectURL(blob);
    showMasterRecording(masterRecUrl);
  }

  function setMasterRecStatus(message) {
    const el = document.getElementById("recStatus");
    if (el) el.textContent = message || "";
  }

  function showMasterRecording(url) {
    const panel = document.getElementById("recPanel");
    const audioEl = document.getElementById("recAudio");
    const downloadEl = document.getElementById("recDownload");
    audioEl.src = url;
    if (downloadEl) downloadEl.href = url;
    panel.hidden = false;
    setMasterRecStatus("");
  }

  function resetTrackEffects(track) {
    if (!track.knobs) return;
    const k = track.knobs;
    k.crush.setValue(0);
    k.grit.setValue(0);
    k.filter.setValue(100);
    k.delay.setValue(0);
    k.pitch.setValue(0);
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

    const startAllBtn = document.getElementById("startAllBtn");
    startAllBtn.addEventListener("click", () => {
      tracks.forEach((t) => {
        if (t.pool.length) startTrackPlayback(t);
      });
    });

    const autoAllBtn = document.getElementById("autoAllBtn");
    autoAllBtn.addEventListener("click", () => {
      const turnOn = tracks.some((t) => t.pool.length && !t.autoEnabled);
      autoAllBtn.classList.toggle("on", turnOn);
      tracks.forEach((t) => {
        if (t.pool.length) setAutoEnabled(t, turnOn);
      });
    });

    const fxAllBtn = document.getElementById("fxAllBtn");
    fxAllBtn.addEventListener("click", () => setFxAutoEnabled(!fxAutoEnabled, fxAllBtn));

    const fxResetBtn = document.getElementById("fxResetBtn");
    fxResetBtn.addEventListener("click", () => {
      setFxAutoEnabled(false, fxAllBtn);
      tracks.forEach((t) => resetTrackEffects(t));
    });

    const recAllBtn = document.getElementById("recAllBtn");
    recAllBtn.addEventListener("click", () => {
      if (masterRecActive) stopMasterRecording(recAllBtn);
      else startMasterRecording(recAllBtn);
    });

    const stopAllBtn = document.getElementById("stopAllBtn");
    stopAllBtn.addEventListener("click", () => {
      autoAllBtn.classList.remove("on");
      setFxAutoEnabled(false, fxAllBtn);
      if (masterRecActive) stopMasterRecording(recAllBtn);
      tracks.forEach((t) => {
        if (t.autoEnabled) setAutoEnabled(t, false);
        stopTrack(t);
      });
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
      if (!track.source || !track.activeBufferDuration) continue;
      const loopLen = track.loopLength || 0.001;
      const elapsed = audioCtx.currentTime - track.playStartTime;
      const posInLoop = track.loopStart + (elapsed % loopLen);
      const frac = posInLoop / track.activeBufferDuration;
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
