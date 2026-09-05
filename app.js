// torso — 4 track sound sculpture / ambient granular mixer
//
// Each of the 4 tracks holds one sample (loaded from a file or recorded
// live from mic/line-in) and can play it back two ways:
//   - loop:    an adjustable in/out window that repeats
//   - scatter: a granular engine that scatters short grains across the
//              sample, wandering through it over time
// "Flux" drives an organic random-walk that nudges position/pitch/pan
// while playing, so the same sample never repeats identically — layered
// with per-track filter, a bitcrush+ringmod "texture" stage, a dual-tap
// ping-pong delay and a shared reverb send, several independent time
// axes end up interleaving. Every knob has its own dice button; every
// track can be randomized as a whole; one big button glitches all four
// at once.

(() => {
  "use strict";

  // ---------------------------------------------------------------- utils

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const semitoneToRate = (s) => Math.pow(2, s / 12);

  // log-uniform spread so auto-dice firings land anywhere from quick
  // successive nudges to glacially slow ones, not a fixed tempo
  function randomAutoDiceInterval() { return 0.5 * Math.pow(90 / 0.5, Math.random()); }

  function makeDrift(min, max, start) {
    let value = start ?? (min + max) / 2;
    let target = value;
    return {
      get value() { return value; },
      tick(rate) {
        if (Math.random() < 0.06) target = rand(min, max);
        value += (target - value) * rate;
        return value;
      },
    };
  }

  function freqFromKnob(v) { // 0..1 -> 70..9000 Hz, log
    return 70 * Math.pow(9000 / 70, v);
  }
  function qFromKnob(v) { return 0.25 + v * 14; }
  function delayTimeFromKnob(v) { return 0.03 + v * 0.9; }

  const AUDIO_EXT = /\.(wav|mp3|ogg|oga|flac|m4a|aac|webm|aif|aiff|opus)$/i;
  function isAudioFile(file) {
    return (file.type && file.type.startsWith("audio/")) || AUDIO_EXT.test(file.name);
  }

  // ---------------------------------------------------------------- audio engine

  let ctx = null;
  let masterGain, compressor, analyser, reverbConvolver, reverbBusGain;
  const tracks = [];
  let schedulerTimer = null;

  // master recorder: taps the final mix post-compressor and captures
  // raw PCM so it can be exported as an actual .wav, not a transcoded
  // webm/opus recording
  let masterRecTap = null, masterRecSilence = null;
  let masterRecording = false;
  let recBuffersL = [], recBuffersR = [];
  let recStartTime = 0, recTimerInterval = null;
  let masterRecBtn = null, masterRecStatus = null;

  function ageFreqFromKnob(v) { return 9000 - v * 8300; } // 0 -> open, 1 -> dull/worn

  function buildImpulseResponse(duration, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  function initAudio() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.9;

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 3.5;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    masterGain.connect(compressor).connect(analyser).connect(ctx.destination);

    reverbConvolver = ctx.createConvolver();
    reverbConvolver.buffer = buildImpulseResponse(6.5, 2.8);
    reverbBusGain = ctx.createGain();
    reverbBusGain.gain.value = 0.9;
    reverbConvolver.connect(reverbBusGain).connect(masterGain);

    setupMasterRecorder();

    tracks.forEach((t) => t.buildGraph());
    startScheduler();
  }

  function setupMasterRecorder() {
    masterRecTap = ctx.createScriptProcessor(4096, 2, 2);
    masterRecSilence = ctx.createGain();
    masterRecSilence.gain.value = 0;
    // tap the compressed final mix in parallel; route through a silent
    // gain to destination so the node is actually pulled for processing
    // without adding an audible duplicate of the signal
    compressor.connect(masterRecTap);
    masterRecTap.connect(masterRecSilence).connect(ctx.destination);
    masterRecTap.onaudioprocess = (e) => {
      if (!masterRecording) return;
      const inBuf = e.inputBuffer;
      recBuffersL.push(inBuf.getChannelData(0).slice());
      recBuffersR.push((inBuf.numberOfChannels > 1 ? inBuf.getChannelData(1) : inBuf.getChannelData(0)).slice());
    };
  }

  function encodeWavBlob(chunksL, chunksR, sampleRate) {
    const totalLen = chunksL.reduce((s, c) => s + c.length, 0);
    const left = new Float32Array(totalLen);
    const right = new Float32Array(totalLen);
    let offset = 0;
    for (let i = 0; i < chunksL.length; i++) {
      left.set(chunksL[i], offset);
      right.set(chunksR[i], offset);
      offset += chunksL[i].length;
    }
    const numChannels = 2;
    const blockAlign = numChannels * 2;
    const dataSize = totalLen * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    let pos = 44;
    for (let i = 0; i < totalLen; i++) {
      const sL = clamp(left[i], -1, 1);
      const sR = clamp(right[i], -1, 1);
      view.setInt16(pos, sL < 0 ? sL * 0x8000 : sL * 0x7fff, true); pos += 2;
      view.setInt16(pos, sR < 0 ? sR * 0x8000 : sR * 0x7fff, true); pos += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  // minimal zero-dependency ZIP writer (stored/uncompressed entries) so
  // a multi-file recording can be offered as a single download — most
  // browsers silently block the 2nd+ of several downloads fired from
  // one click, so one .zip is the only reliable way to hand over more
  // than one file at once
  let crc32Table = null;
  function crc32(bytes) {
    if (!crc32Table) {
      crc32Table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crc32Table[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crc32Table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildZipBlob(files) {
    const encoder = new TextEncoder();
    const now = new Date();
    const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f);
    const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);

    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((f) => {
      const nameBytes = encoder.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const size = data.length;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      localParts.push(new Uint8Array(local.buffer), nameBytes, data);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, dosTime, true);
      central.setUint16(14, dosDate, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, size, true);
      central.setUint32(24, size, true);
      central.setUint16(28, nameBytes.length, true);
      central.setUint16(30, 0, true);
      central.setUint16(32, 0, true);
      central.setUint16(34, 0, true);
      central.setUint16(36, 0, true);
      central.setUint32(38, 0, true);
      central.setUint32(42, offset, true);
      centralParts.push(new Uint8Array(central.buffer), nameBytes);

      offset += 30 + nameBytes.length + size;
    });

    const centralStart = offset;
    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralStart, true);
    end.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  // when running inside a capability-aware host (e.g. a published
  // Artifact), a plain <a download> click is inert — go through the
  // platform's save prompt instead; otherwise (a normal page load)
  // trigger a real browser download directly
  async function saveBlobAsFile(filename, blob) {
    const inHostedFrame = !!(window.claude && typeof window.claude.use === "function");
    if (inHostedFrame) {
      try {
        const dl = await window.claude.use("downloads");
        if (dl) { await dl.save({ filename, data: blob }); return true; }
      } catch (e) { /* fall through to false */ }
      return false;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }

  function startMasterRecording() {
    ensureAudio();
    if (masterRecording) return;
    recBuffersL = [];
    recBuffersR = [];
    masterRecording = true;
    recStartTime = performance.now();
    tracks.forEach((t) => t.startStemRecording());
    if (masterRecBtn) { masterRecBtn.classList.add("active"); masterRecBtn.textContent = "■ STOP REC"; }
    recTimerInterval = setInterval(() => {
      const sec = (performance.now() - recStartTime) / 1000;
      const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
      if (masterRecStatus) masterRecStatus.textContent = `● ${m}:${String(s).padStart(2, "0")}`;
    }, 250);
  }

  async function stopMasterRecording() {
    if (!masterRecording) return;
    masterRecording = false;
    clearInterval(recTimerInterval);
    recTimerInterval = null;
    if (masterRecBtn) { masterRecBtn.classList.remove("active"); masterRecBtn.textContent = "● REC"; }

    const ts = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const baseName = `torso_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;

    const files = [];

    if (recBuffersL.length) {
      const blob = encodeWavBlob(recBuffersL, recBuffersR, ctx.sampleRate);
      recBuffersL = [];
      recBuffersR = [];
      files.push({ name: `${baseName}.wav`, data: new Uint8Array(await blob.arrayBuffer()) });
    }

    // stop + collect each track's stem regardless of whether the master
    // bus captured anything, so they always match what was armed at start
    for (let i = 0; i < tracks.length; i++) {
      const blob = tracks[i].stopStemRecording();
      if (blob) {
        files.push({ name: `${baseName}_track${i + 1}.wav`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
    }

    if (!files.length) { if (masterRecStatus) masterRecStatus.textContent = ""; return; }

    // bundle everything into one .zip: most browsers silently block the
    // 2nd+ of several downloads fired without an extra click, so
    // offering 5 separate files often left only the first one saved
    const zipBlob = buildZipBlob(files);
    const saved = await saveBlobAsFile(`${baseName}.zip`, zipBlob);

    if (masterRecStatus) {
      masterRecStatus.textContent = saved
        ? `saved: ${baseName}.zip (${files.length} files)`
        : "この環境では保存できません（ローカル版でお試しください）";
    }
  }

  function startScheduler() {
    const tick = () => {
      const now = ctx.currentTime;
      tracks.forEach((t) => t.schedulerTick(now));
      schedulerTimer = setTimeout(tick, 40);
    };
    tick();
  }

  // ---------------------------------------------------------------- knob widget

  function createKnob(opts) {
    const {
      label, min, max, value, unit = "", decimals,
      format, onChange, dice, disabled,
    } = opts;

    const dp = decimals ?? (max - min <= 2 ? 2 : (max - min <= 20 ? 1 : 0));
    let v = clamp(value, min, max);
    const defaultValue = v;

    const el = document.createElement("div");
    el.className = "fader";

    const labelEl = document.createElement("div");
    labelEl.className = "fader__label";
    labelEl.textContent = label;

    const body = document.createElement("div");
    body.className = "fader__body";

    const track = document.createElement("div");
    track.className = "fader__track";
    const fill = document.createElement("div");
    fill.className = "fader__fill";
    const cap = document.createElement("div");
    cap.className = "fader__cap";
    track.appendChild(fill);
    track.appendChild(cap);

    const dice_btn = document.createElement("button");
    dice_btn.className = "dieBtn";
    dice_btn.type = "button";
    dice_btn.title = "randomize " + label;
    dice_btn.textContent = "🎲";

    body.appendChild(track);
    body.appendChild(dice_btn);

    const valueEl = document.createElement("div");
    valueEl.className = "fader__value";

    el.appendChild(labelEl);
    el.appendChild(body);
    el.appendChild(valueEl);

    function fmt(val) {
      if (format) return format(val);
      return val.toFixed(dp) + unit;
    }

    function render() {
      const t = (v - min) / (max - min);
      fill.style.height = `${t * 100}%`;
      cap.style.bottom = `${t * 100}%`;
      valueEl.textContent = fmt(v);
    }

    function setValue(nv, { silent } = {}) {
      v = clamp(nv, min, max);
      render();
      if (!silent && onChange) onChange(v);
    }

    // drag interaction: the cap tracks the pointer 1:1, so grabbing
    // anywhere on the track jumps straight to that value (like a real
    // mixer fader) instead of a rotary knob's confusing diagonal drag
    let dragging = false;
    function valueFromClientY(clientY) {
      const rect = track.getBoundingClientRect();
      const t = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
      return min + t * (max - min);
    }
    track.addEventListener("pointerdown", (e) => {
      if (disabled && disabled()) return;
      dragging = true;
      track.setPointerCapture(e.pointerId);
      track.classList.add("dragging");
      setValue(valueFromClientY(e.clientY));
    });
    track.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      setValue(valueFromClientY(e.clientY));
    });
    const endDrag = () => { dragging = false; track.classList.remove("dragging"); };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
    track.addEventListener("dblclick", () => setValue(defaultValue));
    track.addEventListener("wheel", (e) => {
      e.preventDefault();
      const range = max - min;
      setValue(v + (e.deltaY < 0 ? 1 : -1) * range * 0.02);
    }, { passive: false });

    dice_btn.addEventListener("click", () => {
      const nv = dice ? dice() : rand(min, max);
      setValue(nv);
    });

    render();

    return {
      el,
      get value() { return v; },
      set value(nv) { setValue(nv, { silent: true }); },
      setValue,
      roll() { dice_btn.click(); },
    };
  }

  function makeSection(title) {
    const wrap = document.createElement("div");
    wrap.className = "knobGroup";
    const h = document.createElement("div");
    h.className = "knobGroup__title";
    h.textContent = title;
    wrap.appendChild(h);
    const row = document.createElement("div");
    row.className = "knobGroup__row";
    wrap.appendChild(row);
    return { wrap, row };
  }

  // ---------------------------------------------------------------- track

  const TRACK_HUES = [352, 32, 168, 258];

  class Track {
    constructor(index) {
      this.index = index;
      this.hue = TRACK_HUES[index % TRACK_HUES.length];
      this.buffer = null;
      this.reversedBuffer = null;
      this.playing = false;
      this.loopSource = null;
      this.loopVoiceGain = null;
      this.activeGrains = [];
      this.nextGrainTime = 0;
      this.wander = makeDrift(-1, 1, 0);
      this.panDrift = makeDrift(-1, 1, 0);
      this.recording = false;
      this.mediaRecorder = null;
      this.mediaStream = null;
      this.folderFiles = [];
      this.folderName = "";
      this.stemRecording = false;
      this.stemBuffersL = [];
      this.stemBuffersR = [];

      this.params = {
        mode: "loop",
        position: 0,
        spread: 0.55,
        density: 0.3,
        pitch: 0,
        flux: 0.15,
        reverse: false,
        filterType: "lowpass",
        cutoff: 0.75,
        resonance: 0.12,
        texture: 0,
        delayTime: 0.35,
        delayFeedback: 0.28,
        delayMix: 0.22,
        depth: 0.3,
        pan: [-0.6, -0.2, 0.2, 0.6][index % 4],
        level: 0.85,
        lofiCrush: 0,
        lofiWow: 0,
        lofiAge: 0,
      };

      this._lofiHoldL = 0;
      this._lofiHoldR = 0;
      this._lofiCounter = 0;

      this.knobs = {};
      this.autoDice = false;
      this.nextAutoDiceTime = 0;
    }

    // -------- graph (built once audio is unlocked) --------
    buildGraph() {
      const p = this.params;

      this.filterNode = ctx.createBiquadFilter();
      this.filterNode.type = p.filterType;
      this.filterNode.frequency.value = freqFromKnob(p.cutoff);
      this.filterNode.Q.value = qFromKnob(p.resonance);

      this.crusher = ctx.createWaveShaper();
      this.updateTextureCurve();

      this.ringGain = ctx.createGain();
      this.ringGain.gain.value = 1 - p.texture;
      this.ringOsc = ctx.createOscillator();
      this.ringOsc.type = "sine";
      this.ringOsc.frequency.value = 50 + p.texture * 500;
      this.ringOscDepth = ctx.createGain();
      this.ringOscDepth.gain.value = p.texture;
      this.ringOsc.connect(this.ringOscDepth).connect(this.ringGain.gain);
      this.ringOsc.start();

      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = p.pan;

      // lo-fi stage: worn-tape highcut -> wow/flutter pitch wobble ->
      // sample-and-hold decimation, each a fine-grained mood control
      this.ageFilter = ctx.createBiquadFilter();
      this.ageFilter.type = "lowpass";
      this.ageFilter.Q.value = 0.4;
      this.ageFilter.frequency.value = ageFreqFromKnob(p.lofiAge);

      this.wowDelay = ctx.createDelay(0.05);
      this.wowDelay.delayTime.value = 0.008;
      this.wowLFO = ctx.createOscillator();
      this.wowLFO.type = "sine";
      this.wowLFO.frequency.value = 0.6 + p.lofiWow * 3;
      this.wowDepth = ctx.createGain();
      this.wowDepth.gain.value = p.lofiWow * 0.006;
      this.wowLFO.connect(this.wowDepth).connect(this.wowDelay.delayTime);
      this.wowLFO.start();

      this.lofiNode = ctx.createScriptProcessor(1024, 2, 2);
      this.lofiNode.onaudioprocess = (e) => {
        const inL = e.inputBuffer.getChannelData(0);
        const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
        const outL = e.outputBuffer.getChannelData(0);
        const outR = e.outputBuffer.getChannelData(1);
        const holdSamples = Math.max(1, Math.round(1 + this.params.lofiCrush * 30));
        for (let i = 0; i < inL.length; i++) {
          if (this._lofiCounter <= 0) {
            this._lofiHoldL = inL[i];
            this._lofiHoldR = inR[i];
            this._lofiCounter = holdSamples;
          }
          this._lofiCounter--;
          outL[i] = this._lofiHoldL;
          outR[i] = this._lofiHoldR;
        }
      };

      this.filterNode.connect(this.crusher).connect(this.ringGain)
        .connect(this.ageFilter).connect(this.wowDelay).connect(this.lofiNode)
        .connect(this.panner);

      // dual-tap ping-pong delay, always fed, mix controls audibility
      this.delayA = ctx.createDelay(2.0);
      this.delayB = ctx.createDelay(2.0);
      this.delayA.delayTime.value = delayTimeFromKnob(p.delayTime);
      this.delayB.delayTime.value = clamp(delayTimeFromKnob(p.delayTime) * 1.6 + 0.03, 0, 1.95);

      this.dampA = ctx.createBiquadFilter();
      this.dampA.type = "lowpass"; this.dampA.frequency.value = 3200;
      this.dampB = ctx.createBiquadFilter();
      this.dampB.type = "lowpass"; this.dampB.frequency.value = 2800;

      this.fbA = ctx.createGain(); this.fbA.gain.value = p.delayFeedback * 0.85;
      this.fbB = ctx.createGain(); this.fbB.gain.value = p.delayFeedback * 0.8;
      this.crossAB = ctx.createGain(); this.crossAB.gain.value = p.delayFeedback * 0.3;
      this.crossBA = ctx.createGain(); this.crossBA.gain.value = p.delayFeedback * 0.3;

      this.delayA.connect(this.dampA);
      this.delayB.connect(this.dampB);
      this.dampA.connect(this.fbA).connect(this.delayA);
      this.dampB.connect(this.fbB).connect(this.delayB);
      this.dampA.connect(this.crossAB).connect(this.delayB);
      this.dampB.connect(this.crossBA).connect(this.delayA);

      this.panA = ctx.createStereoPanner(); this.panA.pan.value = -0.5;
      this.panB = ctx.createStereoPanner(); this.panB.pan.value = 0.5;
      this.dampA.connect(this.panA);
      this.dampB.connect(this.panB);

      this.delayMixGain = ctx.createGain();
      this.delayMixGain.gain.value = p.delayMix;
      this.panA.connect(this.delayMixGain);
      this.panB.connect(this.delayMixGain);

      this.panner.connect(this.delayA);
      this.panner.connect(this.delayB);

      this.trackSum = ctx.createGain();
      this.panner.connect(this.trackSum);
      this.delayMixGain.connect(this.trackSum);

      this.levelGain = ctx.createGain();
      this.levelGain.gain.value = p.level;
      this.trackSum.connect(this.levelGain).connect(masterGain);

      // reverb send taps post-fader, so level all the way down means
      // truly silent — not just the dry/delay path
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = p.depth * 1.1;
      this.levelGain.connect(this.reverbSend).connect(reverbConvolver);

      // per-track stem recorder: taps this track's own post-fader signal
      // (what it actually contributes to the mix), fires alongside the
      // master recorder
      this.stemTap = ctx.createScriptProcessor(4096, 2, 2);
      this.stemSilence = ctx.createGain();
      this.stemSilence.gain.value = 0;
      this.levelGain.connect(this.stemTap);
      this.stemTap.connect(this.stemSilence).connect(ctx.destination);
      this.stemTap.onaudioprocess = (e) => {
        if (!this.stemRecording) return;
        const inBuf = e.inputBuffer;
        this.stemBuffersL.push(inBuf.getChannelData(0).slice());
        this.stemBuffersR.push((inBuf.numberOfChannels > 1 ? inBuf.getChannelData(1) : inBuf.getChannelData(0)).slice());
      };
    }

    startStemRecording() {
      this.stemBuffersL = [];
      this.stemBuffersR = [];
      this.stemRecording = true;
    }

    stopStemRecording() {
      this.stemRecording = false;
      if (!this.stemBuffersL.length) return null;
      const blob = encodeWavBlob(this.stemBuffersL, this.stemBuffersR, ctx.sampleRate);
      this.stemBuffersL = [];
      this.stemBuffersR = [];
      return blob;
    }

    updateTextureCurve() {
      const amt = this.params.texture;
      const steps = Math.round(clamp(256 - amt * 250, 6, 256));
      const n = 256;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.round(x * steps) / steps;
      }
      if (this.crusher) this.crusher.curve = curve;
    }

    // -------- sample loading / recording --------
    async loadArrayBuffer(arrayBuffer) {
      const buf = await ctx.decodeAudioData(arrayBuffer);
      this.setBuffer(buf);
    }

    setFolderFiles(files, folderName) {
      this.folderFiles = files;
      this.folderName = folderName || "";
      this.onFolderChanged && this.onFolderChanged();
    }

    async pickRandomFromFolder() {
      if (!this.folderFiles.length) return false;
      const f = this.folderFiles[Math.floor(Math.random() * this.folderFiles.length)];
      const ab = await f.arrayBuffer();
      try { await this.loadArrayBuffer(ab); }
      catch (e) { alert(`"${f.name}" の読み込みに失敗しました: ${e.message}`); return false; }
      this.lastFolderFileName = f.name;
      this.onFolderChanged && this.onFolderChanged();
      return true;
    }

    setBuffer(buf) {
      this.stop();
      this.buffer = buf;
      this.reversedBuffer = this.buildReversed(buf);
      this.onBufferChanged && this.onBufferChanged();
    }

    buildReversed(buf) {
      const rev = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch);
        const dst = rev.getChannelData(ch);
        for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
      }
      return rev;
    }

    async startRecording() {
      if (this.recording) return;
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        alert("マイク/ライン入力にアクセスできませんでした: " + e.message);
        return;
      }
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
      let mimeType = "";
      for (const c of candidates) {
        if (c === "" || (window.MediaRecorder && MediaRecorder.isTypeSupported(c))) { mimeType = c; break; }
      }
      const chunks = [];
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.mediaStream, { mimeType })
        : new MediaRecorder(this.mediaStream);
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      this.mediaRecorder.onstop = async () => {
        this.mediaStream.getTracks().forEach((t) => t.stop());
        this.mediaStream = null;
        const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
        const ab = await blob.arrayBuffer();
        try { await this.loadArrayBuffer(ab); }
        catch (e) { alert("録音のデコードに失敗しました: " + e.message); }
        this.onRecordingChanged && this.onRecordingChanged(false);
      };
      this.mediaRecorder.start();
      this.recording = true;
      this.onRecordingChanged && this.onRecordingChanged(true);
    }

    stopRecording() {
      if (!this.recording || !this.mediaRecorder) return;
      this.recording = false;
      this.mediaRecorder.stop();
    }

    // -------- playback --------
    play() {
      if (!this.buffer || this.playing) return;
      this.playing = true;
      if (this.params.mode === "loop") this.restartLoopSource();
      else this.nextGrainTime = ctx.currentTime + 0.03;
      this.onPlayStateChanged && this.onPlayStateChanged(true);
    }

    stop() {
      this.playing = false;
      this.stopLoopSource();
      this.onPlayStateChanged && this.onPlayStateChanged(false);
    }

    stopLoopSource() {
      if (!this.loopSource) return;
      const src = this.loopSource, vg = this.loopVoiceGain;
      const now = ctx.currentTime;
      this.loopSource = null;
      this.loopVoiceGain = null;
      try {
        vg.gain.cancelScheduledValues(now);
        vg.gain.setValueAtTime(vg.gain.value, now);
        vg.gain.linearRampToValueAtTime(0, now + 0.03);
        src.stop(now + 0.04);
      } catch (e) { /* already stopped */ }
    }

    restartLoopSource() {
      if (!this.buffer) return;
      this.stopLoopSource();
      const p = this.params;
      const buf = p.reverse ? this.reversedBuffer : this.buffer;
      const dur = buf.duration;
      const loopLen = clamp(0.02 * dur + p.spread * 0.95 * dur, 0.03, dur);
      const start = clamp(p.position * dur, 0, Math.max(0, dur - 0.02));
      const end = Math.min(dur, start + loopLen);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = start;
      src.loopEnd = end;
      src.playbackRate.value = semitoneToRate(p.pitch);

      const vg = ctx.createGain();
      vg.gain.value = 0;
      src.connect(vg).connect(this.filterNode);

      const now = ctx.currentTime;
      vg.gain.linearRampToValueAtTime(1, now + 0.03);
      src.start(now, start);

      this.loopSource = src;
      this.loopVoiceGain = vg;
      this._visLoop = { start, end, dur };
    }

    applyLoopBounds(now) {
      if (!this.loopSource) return;
      const p = this.params;
      const buf = this.loopSource.buffer;
      const dur = buf.duration;
      const wanderOff = this.wander.value * p.flux * (0.1 + p.spread * 0.4);
      const center = clamp(p.position + wanderOff, 0, 1);
      const loopLen = clamp(0.02 * dur + p.spread * 0.95 * dur, 0.03, dur);
      let start = clamp(center * dur, 0, Math.max(0, dur - 0.02));
      let end = Math.min(dur, start + loopLen);
      if (end - start < 0.02) start = Math.max(0, end - 0.02);
      this.loopSource.loopStart = start;
      this.loopSource.loopEnd = end;
      this._visLoop = { start, end, dur };
    }

    spawnGrain(time) {
      const p = this.params;
      const buf = p.reverse ? this.reversedBuffer : this.buffer;
      if (!buf) return;
      const dur = buf.duration;
      const wanderOff = this.wander.value * p.flux * (0.15 + p.spread * 0.5);
      const center = clamp(p.position + wanderOff, 0, 1);
      const posJitter = (Math.random() * 2 - 1) * p.spread * 0.35;
      const frac = clamp(center + posJitter, 0, 0.97);
      const grainLen = 0.035 + p.spread * 0.5;
      const startOffset = frac * dur;
      const maxLen = Math.max(0.02, dur - startOffset - 0.005);
      const grainDur = Math.min(grainLen, maxLen);
      const rate = semitoneToRate(p.pitch + (Math.random() * 2 - 1) * p.flux * 4);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;

      const env = ctx.createGain();
      const peak = 0.8;
      const atk = Math.max(0.004, grainDur * 0.25);
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(peak, time + atk);
      env.gain.linearRampToValueAtTime(0, time + grainDur);

      src.connect(env).connect(this.filterNode);
      src.start(time, startOffset, grainDur + 0.02);
      src.stop(time + grainDur + 0.05);
      src.onended = () => { try { src.disconnect(); env.disconnect(); } catch (e) {} };

      this.activeGrains.push({ start: time, dur: grainDur, frac });
      if (this.activeGrains.length > 64) this.activeGrains.shift();
    }

    schedulerTick(now) {
      const p = this.params;

      if (this.autoDice && now >= this.nextAutoDiceTime) {
        const keys = Object.keys(this.knobs);
        if (keys.length) {
          const k = keys[Math.floor(Math.random() * keys.length)];
          this.knobs[k].roll();
          this.onAutoDiceFired && this.onAutoDiceFired(k);
        }
        this.nextAutoDiceTime = now + randomAutoDiceInterval();
      }

      if (this.playing) {
        this.wander.tick(0.03 + p.flux * 0.25);
        this.panDrift.tick(0.04 + p.flux * 0.2);
        const targetPan = clamp(p.pan + this.panDrift.value * p.flux * 0.5, -1, 1);
        if (this.panner) this.panner.pan.setTargetAtTime(targetPan, now, 0.4);

        if (p.mode === "scatter") {
          const rate = 1 + p.density * 24;
          // cap iterations so a stale timestamp (e.g. a throttled
          // background tab) can never fire a burst of catch-up grains
          for (let guard = 0; guard < 40 && this.nextGrainTime < now + 0.25; guard++) {
            this.spawnGrain(this.nextGrainTime);
            const jitter = 1 + (Math.random() * 2 - 1) * p.flux * 0.7;
            this.nextGrainTime += Math.max(0.02, (1 / rate) * jitter);
          }
          if (this.nextGrainTime < now) this.nextGrainTime = now + 0.03;
        } else {
          this.applyLoopBounds(now);
        }
      }
      // prune stale grain markers for visualization
      this.activeGrains = this.activeGrains.filter((g) => now - g.start < g.dur + 0.05);
    }

    // -------- param setters used by knobs --------
    setMode(mode) {
      const wasPlaying = this.playing;
      if (wasPlaying) this.stop();
      this.params.mode = mode;
      if (wasPlaying) this.play();
    }

    setReverse(rev) {
      this.params.reverse = rev;
      if (this.params.mode === "loop" && this.playing) this.restartLoopSource();
    }

    jumpPosition(pos) {
      this.params.position = clamp(pos, 0, 1);
      if (this.params.mode === "loop" && this.playing) this.restartLoopSource();
    }
  }

  // ---------------------------------------------------------------- UI building

  function buildTrackUI(track, container) {
    const el = document.createElement("section");
    el.className = "track";
    el.style.setProperty("--accent", `${track.hue}deg`);

    // header ---------------------------------------------------------
    const header = document.createElement("div");
    header.className = "track__header";

    const title = document.createElement("div");
    title.className = "track__title";
    title.textContent = `TRACK ${track.index + 1}`;
    header.appendChild(title);

    const transportRow = document.createElement("div");
    transportRow.className = "track__transport";

    const playBtn = document.createElement("button");
    playBtn.className = "toggleBtn playBtn";
    playBtn.textContent = "▶";
    playBtn.addEventListener("click", () => {
      ensureAudio();
      if (track.playing) track.stop(); else track.play();
    });

    const loadBtn = document.createElement("button");
    loadBtn.className = "toggleBtn";
    loadBtn.textContent = "LOAD";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "audio/*";
    fileInput.hidden = true;
    loadBtn.addEventListener("click", () => { ensureAudio(); fileInput.click(); });
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0];
      if (!f) return;
      const ab = await f.arrayBuffer();
      try { await track.loadArrayBuffer(ab); }
      catch (e) { alert("読み込みに失敗しました: " + e.message); }
    });

    const recBtn = document.createElement("button");
    recBtn.className = "toggleBtn recBtn";
    recBtn.textContent = "● REC";
    recBtn.addEventListener("click", () => {
      ensureAudio();
      if (track.recording) track.stopRecording(); else track.startRecording();
    });

    transportRow.appendChild(playBtn);
    transportRow.appendChild(loadBtn);
    transportRow.appendChild(recBtn);
    header.appendChild(transportRow);
    header.appendChild(fileInput);

    // folder-of-samples: separate from the single-file LOAD above
    const folderRow = document.createElement("div");
    folderRow.className = "track__transport";

    const folderBtn = document.createElement("button");
    folderBtn.className = "toggleBtn";
    folderBtn.textContent = "FOLDER";
    folderBtn.title = "サンプルの入ったフォルダを割り当てる";
    const folderInput = document.createElement("input");
    folderInput.type = "file";
    folderInput.multiple = true;
    folderInput.webkitdirectory = true;
    folderInput.hidden = true;
    folderBtn.addEventListener("click", () => { ensureAudio(); folderInput.click(); });
    folderInput.addEventListener("change", async () => {
      const files = Array.from(folderInput.files).filter(isAudioFile);
      if (!files.length) { alert("フォルダ内に音声ファイルが見つかりませんでした。"); return; }
      const first = folderInput.files[0];
      const folderName = (first.webkitRelativePath || first.name).split("/")[0];
      track.setFolderFiles(files, folderName);
      await track.pickRandomFromFolder();
    });

    const folderRandBtn = document.createElement("button");
    folderRandBtn.className = "toggleBtn";
    folderRandBtn.textContent = "🎲📁";
    folderRandBtn.title = "割り当てたフォルダからランダムに1曲差し替え";
    folderRandBtn.addEventListener("click", async () => {
      ensureAudio();
      if (!track.folderFiles.length) { alert("先に FOLDER でサンプルフォルダを選んでください。"); return; }
      await track.pickRandomFromFolder();
    });

    const folderLabel = document.createElement("div");
    folderLabel.className = "track__folderLabel";
    folderLabel.textContent = "";

    folderRow.appendChild(folderBtn);
    folderRow.appendChild(folderRandBtn);
    header.appendChild(folderRow);
    header.appendChild(folderLabel);
    header.appendChild(folderInput);

    const modeRow = document.createElement("div");
    modeRow.className = "track__modeRow";
    const modeBtn = document.createElement("button");
    modeBtn.className = "cycleBtn";
    modeBtn.textContent = "MODE: LOOP";
    modeBtn.addEventListener("click", () => {
      const next = track.params.mode === "loop" ? "scatter" : "loop";
      track.setMode(next);
      modeBtn.textContent = "MODE: " + next.toUpperCase();
    });

    const revBtn = document.createElement("button");
    revBtn.className = "toggleBtn";
    revBtn.textContent = "REVERSE";
    revBtn.addEventListener("click", () => {
      const nv = !track.params.reverse;
      track.setReverse(nv);
      revBtn.classList.toggle("active", nv);
    });

    const trackRandBtn = document.createElement("button");
    trackRandBtn.className = "dieBtn dieBtn--track";
    trackRandBtn.textContent = "⚄";
    trackRandBtn.title = "randomize this track";
    trackRandBtn.addEventListener("click", () => randomizeTrack(track));

    const autoDiceBtn = document.createElement("button");
    autoDiceBtn.className = "toggleBtn autoDiceBtn";
    autoDiceBtn.textContent = "🎲 AUTO";
    autoDiceBtn.title = "オンにすると、このトラックのどれかのフェーダーをランダムな間隔（早い⇔超ゆっくり）で自動的に振り続ける";
    autoDiceBtn.addEventListener("click", () => {
      ensureAudio();
      track.autoDice = !track.autoDice;
      autoDiceBtn.classList.toggle("active", track.autoDice);
      if (track.autoDice) track.nextAutoDiceTime = ctx.currentTime + randomAutoDiceInterval();
    });

    modeRow.appendChild(modeBtn);
    modeRow.appendChild(revBtn);
    modeRow.appendChild(trackRandBtn);
    modeRow.appendChild(autoDiceBtn);
    header.appendChild(modeRow);

    el.appendChild(header);

    // drag & drop onto whole panel
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("dragOver"); });
    el.addEventListener("dragleave", () => el.classList.remove("dragOver"));
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("dragOver");
      ensureAudio();
      const f = e.dataTransfer.files[0];
      if (!f) return;
      const ab = await f.arrayBuffer();
      try { await track.loadArrayBuffer(ab); }
      catch (err) { alert("読み込みに失敗しました: " + err.message); }
    });

    // waveform ---------------------------------------------------------
    const canvas = document.createElement("canvas");
    canvas.className = "track__waveform";
    el.appendChild(canvas);
    track._canvas = canvas;

    // knobs --------------------------------------------------------
    const knobsWrap = document.createElement("div");
    knobsWrap.className = "track__knobs";

    function addKnob(section, opts) {
      const k = createKnob(opts);
      section.row.appendChild(k.el);
      track.knobs[opts.key] = k;
      return k;
    }

    // SOURCE
    const source = makeSection("source");
    addKnob(source, {
      key: "position", label: "position", min: 0, max: 1, value: track.params.position,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => track.jumpPosition(v),
      dice: () => rand(0, 1),
    });
    addKnob(source, {
      key: "spread", label: "spread", min: 0, max: 1, value: track.params.spread,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => { track.params.spread = v; },
      dice: () => rand(0.03, 1),
    });
    addKnob(source, {
      key: "density", label: "density", min: 0, max: 1, value: track.params.density,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => { track.params.density = v; },
      dice: () => rand(0, 1),
    });
    addKnob(source, {
      key: "pitch", label: "pitch", min: -24, max: 24, value: track.params.pitch, unit: "st",
      onChange: (v) => {
        track.params.pitch = v;
        if (track.loopSource) track.loopSource.playbackRate.setTargetAtTime(semitoneToRate(v), ctx.currentTime, 0.05);
      },
      dice: () => rand(-12, 12),
    });
    addKnob(source, {
      key: "flux", label: "flux", min: 0, max: 1, value: track.params.flux,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => { track.params.flux = v; },
      dice: () => rand(0, 1),
    });
    knobsWrap.appendChild(source.wrap);

    // TONE
    const tone = makeSection("tone");
    const cutoffKnob = addKnob(tone, {
      key: "cutoff", label: "cutoff", min: 0, max: 1, value: track.params.cutoff,
      format: (v) => Math.round(freqFromKnob(v)) + "Hz",
      onChange: (v) => {
        track.params.cutoff = v;
        if (track.filterNode) track.filterNode.frequency.setTargetAtTime(freqFromKnob(v), ctx.currentTime, 0.01);
      },
      dice: () => rand(0, 1),
    });
    addKnob(tone, {
      key: "resonance", label: "reso", min: 0, max: 1, value: track.params.resonance,
      format: (v) => qFromKnob(v).toFixed(1),
      onChange: (v) => {
        track.params.resonance = v;
        if (track.filterNode) track.filterNode.Q.setTargetAtTime(qFromKnob(v), ctx.currentTime, 0.01);
      },
      dice: () => rand(0, 0.7),
    });
    addKnob(tone, {
      key: "texture", label: "texture", min: 0, max: 1, value: track.params.texture,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => {
        track.params.texture = v;
        track.updateTextureCurve();
        if (track.ringGain) {
          const now = ctx.currentTime;
          track.ringGain.gain.setTargetAtTime(1 - v, now, 0.01);
          track.ringOscDepth.gain.setTargetAtTime(v, now, 0.01);
          track.ringOsc.frequency.setTargetAtTime(50 + v * 500, now, 0.05);
        }
      },
      dice: () => rand(0, 1),
    });
    const filterTypeBtn = document.createElement("button");
    filterTypeBtn.className = "cycleBtn cycleBtn--small";
    filterTypeBtn.textContent = "LP";
    const filterTypes = ["lowpass", "highpass", "bandpass"];
    filterTypeBtn.addEventListener("click", () => {
      const i = filterTypes.indexOf(track.params.filterType);
      const nt = filterTypes[(i + 1) % filterTypes.length];
      track.params.filterType = nt;
      if (track.filterNode) track.filterNode.type = nt;
      filterTypeBtn.textContent = nt === "lowpass" ? "LP" : nt === "highpass" ? "HP" : "BP";
    });
    tone.row.appendChild(filterTypeBtn);
    knobsWrap.appendChild(tone.wrap);

    // SPACE
    const space = makeSection("space");
    addKnob(space, {
      key: "delayTime", label: "d.time", min: 0, max: 1, value: track.params.delayTime,
      format: (v) => Math.round(delayTimeFromKnob(v) * 1000) + "ms",
      onChange: (v) => {
        track.params.delayTime = v;
        if (track.delayA) {
          const t = delayTimeFromKnob(v);
          track.delayA.delayTime.setTargetAtTime(t, ctx.currentTime, 0.05);
          track.delayB.delayTime.setTargetAtTime(clamp(t * 1.6 + 0.03, 0, 1.95), ctx.currentTime, 0.05);
        }
      },
      dice: () => rand(0, 1),
    });
    addKnob(space, {
      key: "delayFeedback", label: "d.fbck", min: 0, max: 1, value: track.params.delayFeedback,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => {
        track.params.delayFeedback = v;
        if (track.fbA) {
          track.fbA.gain.setTargetAtTime(v * 0.85, ctx.currentTime, 0.02);
          track.fbB.gain.setTargetAtTime(v * 0.8, ctx.currentTime, 0.02);
          track.crossAB.gain.setTargetAtTime(v * 0.3, ctx.currentTime, 0.02);
          track.crossBA.gain.setTargetAtTime(v * 0.3, ctx.currentTime, 0.02);
        }
      },
      dice: () => rand(0, 0.7),
    });
    addKnob(space, {
      key: "delayMix", label: "d.mix", min: 0, max: 1, value: track.params.delayMix,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => {
        track.params.delayMix = v;
        if (track.delayMixGain) track.delayMixGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
      },
      dice: () => rand(0, 1),
    });
    addKnob(space, {
      key: "depth", label: "depth", min: 0, max: 1, value: track.params.depth,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => {
        track.params.depth = v;
        if (track.reverbSend) track.reverbSend.gain.setTargetAtTime(v * 1.1, ctx.currentTime, 0.02);
      },
      dice: () => rand(0, 1),
    });
    addKnob(space, {
      key: "pan", label: "pan", min: -1, max: 1, value: track.params.pan,
      format: (v) => (v === 0 ? "C" : (v < 0 ? "L" + Math.round(-v * 100) : "R" + Math.round(v * 100))),
      onChange: (v) => {
        track.params.pan = v;
        if (track.panner) track.panner.pan.setTargetAtTime(v, ctx.currentTime, 0.05);
      },
      dice: () => rand(-1, 1),
    });
    knobsWrap.appendChild(space.wrap);

    // LOFI — worn-tape mood shaping: crush (sample-rate decimation),
    // wow (pitch wobble), age (highcut)
    const lofi = makeSection("lofi");
    addKnob(lofi, {
      key: "lofiCrush", label: "crush", min: 0, max: 1, value: track.params.lofiCrush,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => { track.params.lofiCrush = v; },
      dice: () => rand(0, 1),
    });
    addKnob(lofi, {
      key: "lofiWow", label: "wow", min: 0, max: 1, value: track.params.lofiWow,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => {
        track.params.lofiWow = v;
        if (track.wowDepth) {
          const now = ctx.currentTime;
          track.wowDepth.gain.setTargetAtTime(v * 0.006, now, 0.05);
          track.wowLFO.frequency.setTargetAtTime(0.6 + v * 3, now, 0.1);
        }
      },
      dice: () => rand(0, 1),
    });
    addKnob(lofi, {
      key: "lofiAge", label: "age", min: 0, max: 1, value: track.params.lofiAge,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => {
        track.params.lofiAge = v;
        if (track.ageFilter) track.ageFilter.frequency.setTargetAtTime(ageFreqFromKnob(v), ctx.currentTime, 0.02);
      },
      dice: () => rand(0, 1),
    });
    knobsWrap.appendChild(lofi.wrap);

    // OUTPUT
    const output = makeSection("output");
    addKnob(output, {
      key: "level", label: "level", min: 0, max: 1.2, value: track.params.level,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => {
        track.params.level = v;
        if (track.levelGain) track.levelGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
      },
      dice: () => rand(0.5, 1),
    });
    knobsWrap.appendChild(output.wrap);

    el.appendChild(knobsWrap);
    container.appendChild(el);

    // wire status callbacks
    track.onPlayStateChanged = (playing) => {
      playBtn.textContent = playing ? "■" : "▶";
      playBtn.classList.toggle("active", playing);
    };
    track.onRecordingChanged = (rec) => {
      recBtn.classList.toggle("active", rec);
      recBtn.textContent = rec ? "● STOP" : "● REC";
    };
    track.onBufferChanged = () => { drawWaveform(track); };
    track.onFolderChanged = () => {
      const count = track.folderFiles.length;
      if (!count) { folderLabel.textContent = ""; return; }
      const name = track.folderName ? track.folderName + " — " : "";
      folderLabel.textContent = `${name}${count}曲` + (track.lastFolderFileName ? ` / now: ${track.lastFolderFileName}` : "");
    };
    track.onAutoDiceFired = (key) => {
      const k = track.knobs[key];
      if (!k) return;
      k.el.classList.remove("autoFlash");
      // eslint-disable-next-line no-unused-expressions
      k.el.offsetWidth; // restart the animation if it fires again quickly
      k.el.classList.add("autoFlash");
    };

    return el;
  }

  // ---------------------------------------------------------------- randomize

  function randomizeTrack(track) {
    Object.values(track.knobs).forEach((k) => k.roll());
    if (Math.random() < 0.5) {
      const nv = !track.params.reverse;
      track.setReverse(nv);
    }
    if (Math.random() < 0.3) {
      const next = track.params.mode === "loop" ? "scatter" : "loop";
      track.setMode(next);
      track._modeBtn && (track._modeBtn.textContent = "MODE: " + next.toUpperCase());
      const btn = track._el && track._el.querySelector(".cycleBtn");
      if (btn) btn.textContent = "MODE: " + next.toUpperCase();
    }
  }

  function randomizeAll() {
    ensureAudio();
    tracks.forEach((t) => randomizeTrack(t));
  }

  // pick a random subset (1..N) of tracks that have a folder assigned,
  // and load a new random sample from each of their own folders
  function randomizeSamplesFromFolders() {
    ensureAudio();
    const eligible = tracks.filter((t) => t.folderFiles.length > 0);
    if (!eligible.length) {
      alert("フォルダが割り当てられたトラックがありません。各トラックの FOLDER ボタンで先にサンプルフォルダを選んでください。");
      return;
    }
    const shuffled = eligible.slice().sort(() => Math.random() - 0.5);
    const count = 1 + Math.floor(Math.random() * shuffled.length);
    shuffled.slice(0, count).forEach((t) => t.pickRandomFromFolder());
  }

  // ---------------------------------------------------------------- waveform / visuals

  function drawWaveform(track) {
    const canvas = track._canvas;
    if (!canvas || !track.buffer) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 260;
    const h = canvas.clientHeight || 64;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const data = track.buffer.getChannelData(0);
    const buckets = Math.max(1, Math.floor(w * dpr));
    const step = Math.max(1, Math.floor(data.length / buckets));
    const peaks = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const start = i * step;
      const end = Math.min(data.length, start + step);
      for (let j = start; j < end; j++) { const a = Math.abs(data[j]); if (a > max) max = a; }
      peaks[i] = max;
    }
    track._peaks = peaks;
  }

  function renderTrackCanvas(track, now) {
    const canvas = track._canvas;
    if (!canvas) return;
    const c = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    c.clearRect(0, 0, w, h);

    if (!track.buffer) {
      c.fillStyle = `hsla(${track.hue}, 40%, 70%, 0.25)`;
      c.font = `${12 * (window.devicePixelRatio || 1)}px sans-serif`;
      c.fillText("no sample — load / rec / drop", 10 * (window.devicePixelRatio || 1), h / 2);
      return;
    }

    const peaks = track._peaks;
    if (peaks) {
      c.fillStyle = `hsla(${track.hue}, 55%, 65%, 0.55)`;
      const mid = h / 2;
      for (let i = 0; i < peaks.length; i++) {
        const p = peaks[i] * mid * 0.95;
        c.fillRect(i, mid - p, 1, p * 2);
      }
    }

    // loop window
    if (track.params.mode === "loop" && track._visLoop) {
      const { start, end, dur } = track._visLoop;
      const x0 = (start / dur) * w, x1 = (end / dur) * w;
      c.fillStyle = `hsla(${track.hue}, 80%, 70%, 0.16)`;
      c.fillRect(x0, 0, Math.max(1, x1 - x0), h);
      c.strokeStyle = `hsla(${track.hue}, 90%, 75%, 0.8)`;
      c.beginPath(); c.moveTo(x0, 0); c.lineTo(x0, h); c.stroke();
      c.beginPath(); c.moveTo(x1, 0); c.lineTo(x1, h); c.stroke();

      if (track.playing && track.loopSource) {
        const dur2 = end - start || 0.001;
        const rate = track.loopSource.playbackRate.value || 1;
        const elapsed = ((now - (track._playStartRef || now)) * rate) % dur2;
        const x = ((start + elapsed) / dur) * w;
        c.strokeStyle = `hsla(${track.hue}, 100%, 85%, 0.95)`;
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
      }
    }

    // grains
    track.activeGrains.forEach((g) => {
      const age = now - g.start;
      const t = clamp(age / g.dur, 0, 1);
      const alpha = (1 - t) * 0.9;
      const x = g.frac * w;
      const y = h / 2 + Math.sin(t * Math.PI) * h * 0.3 * (g.frac > 0.5 ? 1 : -1);
      const r = (2 + (1 - t) * 5) * (window.devicePixelRatio || 1);
      const grad = c.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `hsla(${track.hue}, 90%, 80%, ${alpha})`);
      grad.addColorStop(1, `hsla(${track.hue}, 90%, 80%, 0)`);
      c.fillStyle = grad;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    });
  }

  // background canvas: soft ambient field, gently reactive to master level
  const bgCanvas = document.getElementById("bg");
  const bgCtx = bgCanvas.getContext("2d");
  function resizeBg() {
    bgCanvas.width = window.innerWidth * (window.devicePixelRatio || 1);
    bgCanvas.height = window.innerHeight * (window.devicePixelRatio || 1);
  }
  window.addEventListener("resize", resizeBg);
  resizeBg();

  let bgT = 0;
  let levelData = null;
  function drawBg() {
    const w = bgCanvas.width, h = bgCanvas.height;
    bgT += 0.0035;
    let level = 0;
    if (analyser) {
      if (!levelData) levelData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(levelData);
      let sum = 0;
      for (let i = 0; i < levelData.length; i++) sum += levelData[i];
      level = sum / levelData.length / 255;
    }
    bgCtx.fillStyle = `rgba(8, 9, 11, ${0.14 + level * 0.05})`;
    bgCtx.fillRect(0, 0, w, h);

    for (let i = 0; i < 4; i++) {
      const hue = TRACK_HUES[i];
      const cx = w * (0.2 + 0.2 * i) + Math.sin(bgT * (0.6 + i * 0.13) + i) * w * 0.06;
      const cy = h * 0.5 + Math.cos(bgT * (0.5 + i * 0.11) + i * 2) * h * 0.22;
      const r = (0.16 + level * 0.12) * Math.min(w, h);
      const grad = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `hsla(${hue}, 55%, 55%, ${0.05 + level * 0.05})`);
      grad.addColorStop(1, `hsla(${hue}, 55%, 55%, 0)`);
      bgCtx.fillStyle = grad;
      bgCtx.beginPath(); bgCtx.arc(cx, cy, r, 0, Math.PI * 2); bgCtx.fill();
    }
  }

  function animate() {
    drawBg();
    if (ctx) {
      const now = ctx.currentTime;
      tracks.forEach((t) => renderTrackCanvas(t, now));
    } else {
      tracks.forEach((t) => renderTrackCanvas(t, 0));
    }
    requestAnimationFrame(animate);
  }

  // ---------------------------------------------------------------- bootstrap

  function ensureAudio() {
    if (!ctx) initAudio();
    if (ctx.state === "suspended") ctx.resume();
  }

  function main() {
    const startOverlay = document.getElementById("startOverlay");
    const startBtn = document.getElementById("startBtn");
    const app = document.getElementById("app");
    const tracksContainer = document.getElementById("tracks");

    for (let i = 0; i < 4; i++) {
      const t = new Track(i);
      tracks.push(t);
      const el = buildTrackUI(t, tracksContainer);
      t._el = el;
    }

    // master knob
    const masterSlot = document.getElementById("masterKnobSlot");
    const masterKnob = createKnob({
      key: "master", label: "master", min: 0, max: 1.2, value: 0.9,
      format: (v) => Math.round(v * 100) + "%",
      onChange: (v) => { if (masterGain) masterGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
      dice: () => rand(0.5, 1),
    });
    masterSlot.appendChild(masterKnob.el);

    document.getElementById("playAllBtn").addEventListener("click", () => {
      ensureAudio();
      tracks.forEach((t) => { if (t.buffer) t.play(); });
    });
    document.getElementById("stopAllBtn").addEventListener("click", () => {
      tracks.forEach((t) => t.stop());
    });
    document.getElementById("randomAllBtn").addEventListener("click", randomizeAll);
    document.getElementById("randomSamplesBtn").addEventListener("click", randomizeSamplesFromFolders);

    masterRecBtn = document.getElementById("masterRecBtn");
    masterRecStatus = document.getElementById("masterRecStatus");
    masterRecBtn.addEventListener("click", () => {
      if (masterRecording) stopMasterRecording(); else startMasterRecording();
    });

    startBtn.addEventListener("click", () => {
      ensureAudio();
      startOverlay.remove();
      app.hidden = false;
    });

    requestAnimationFrame(animate);
  }

  document.addEventListener("DOMContentLoaded", main);
})();
