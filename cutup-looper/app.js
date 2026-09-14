// CUTUP//LOOP — 4ch live cut-up sampler
//
// One mic input is recorded continuously into a ~3 minute mono ring
// buffer. Four independent tracks each pull random short "grains" out
// of that shared history and play them back-to-back with a tiny
// crossfade (so joints never click), each through its own
// pan/delay/reverb/depth send and its own mix fader. Pressing LOOP
// freezes the last few seconds into a seamless repeating loop; RANGE
// keeps the cut-up random but confines it to a snapshot window.
// Recording never stops while the engine is running, in either mode.

(() => {
  const BUFFER_SECONDS = 180;
  const LOOKAHEAD = 0.25;
  const SCHEDULE_INTERVAL_MS = 40;
  const CAPTURE_CHUNK = 4096;

  // ---- shared ring buffer -------------------------------------------

  class RingBuffer {
    constructor(seconds, sampleRate) {
      this.sampleRate = sampleRate;
      this.length = Math.floor(seconds * sampleRate);
      this.data = new Float32Array(this.length);
      this.writePos = 0;
      this.totalWritten = 0;
    }
    write(chunk) {
      const n = chunk.length;
      if (n >= this.length) {
        this.data.set(chunk.subarray(n - this.length));
        this.writePos = 0;
      } else {
        const end = this.writePos + n;
        if (end <= this.length) {
          this.data.set(chunk, this.writePos);
        } else {
          const firstPart = this.length - this.writePos;
          this.data.set(chunk.subarray(0, firstPart), this.writePos);
          this.data.set(chunk.subarray(firstPart), 0);
        }
        this.writePos = end % this.length;
      }
      this.totalWritten += n;
    }
    availableSamples() {
      return Math.min(this.totalWritten, this.length);
    }
    readRange(startAbs, len, out) {
      const idx = ((startAbs % this.length) + this.length) % this.length;
      const firstPart = Math.min(len, this.length - idx);
      out.set(this.data.subarray(idx, idx + firstPart), 0);
      if (firstPart < len) {
        out.set(this.data.subarray(0, len - firstPart), firstPart);
      }
      return out;
    }
  }

  // ---- dom -------------------------------------------------------

  const startBtn = document.getElementById("startBtn");
  const recDot = document.getElementById("recDot");
  const bufferTimeEl = document.getElementById("bufferTime");
  const inputMeterEl = document.getElementById("inputMeter");
  const masterFaderEl = document.getElementById("masterFader");
  const masterScopeCanvas = document.getElementById("masterScope");
  const masterScopeCtx = masterScopeCanvas.getContext("2d");
  const tracksEl = document.getElementById("tracks");
  const trackTemplate = document.getElementById("trackTemplate");

  const TRACK_DEFAULTS = [
    { fader: 85, pan: -55 },
    { fader: 0, pan: -18 },
    { fader: 0, pan: 18 },
    { fader: 0, pan: 55 },
  ];

  let audioCtx = null;
  let ringBuffer = null;
  let micStream = null;
  let micSource = null;
  let captureNode = null;
  let inputAnalyser = null;
  let masterGain, masterFader, masterCompressor, masterAnalyser;
  let reverbSend = null; // shared convolver
  let tracks = [];
  let running = false;
  let schedulerTimer = null;
  let meterTimer = null;
  const inputMeterData = new Float32Array(512);

  // ---- audio graph setup -------------------------------------------

  function buildImpulseResponse(context, duration, decay) {
    const rate = context.sampleRate;
    const length = Math.max(1, Math.floor(rate * duration));
    const impulse = context.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  function buildMasterChain() {
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;

    masterFader = audioCtx.createGain();
    masterFader.gain.value = (+masterFaderEl.value) / 100;

    masterCompressor = audioCtx.createDynamicsCompressor();
    masterCompressor.threshold.value = -12;
    masterCompressor.knee.value = 18;
    masterCompressor.ratio.value = 4;
    masterCompressor.attack.value = 0.003;
    masterCompressor.release.value = 0.15;

    masterAnalyser = audioCtx.createAnalyser();
    masterAnalyser.fftSize = 1024;

    masterGain.connect(masterFader).connect(masterCompressor);
    masterCompressor.connect(masterAnalyser);
    masterCompressor.connect(audioCtx.destination);

    reverbSend = audioCtx.createConvolver();
    reverbSend.buffer = buildImpulseResponse(audioCtx, 2.4, 2.6);
    const reverbReturn = audioCtx.createGain();
    reverbReturn.gain.value = 0.9;
    reverbSend.connect(reverbReturn).connect(masterGain);
  }

  async function startCapture() {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    ringBuffer = new RingBuffer(BUFFER_SECONDS, audioCtx.sampleRate);

    buildMasterChain();

    micSource = audioCtx.createMediaStreamSource(micStream);

    inputAnalyser = audioCtx.createAnalyser();
    inputAnalyser.fftSize = 512;
    micSource.connect(inputAnalyser);

    // ScriptProcessor here only copies samples into the ring buffer
    // (cheap memcpy) — it is never used to render playback audio, so
    // it cannot itself be a source of glitches/clicks.
    captureNode = audioCtx.createScriptProcessor(CAPTURE_CHUNK, 1, 1);
    captureNode.onaudioprocess = (e) => {
      ringBuffer.write(e.inputBuffer.getChannelData(0));
    };
    const silentSink = audioCtx.createGain();
    silentSink.gain.value = 0;
    micSource.connect(captureNode);
    captureNode.connect(silentSink);
    silentSink.connect(audioCtx.destination);

    tracks.forEach((track) => setupTrackGraph(track));
  }

  function stopCapture() {
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    if (captureNode) captureNode.onaudioprocess = null;
  }

  // ---- track -------------------------------------------------------

  class Track {
    constructor(index, el) {
      this.index = index;
      this.el = el;
      this.mode = "free"; // free | range | lock
      this.windowSeconds = 2;
      this.chop = 0.4;
      this.faderValue = TRACK_DEFAULTS[index].fader / 100;
      this.muted = false;
      this.nextGrainTime = 0;
      this.rangeWindow = null;
      this.lockSource = null;
      this.lockEnv = null;
      this.flashUntil = 0;

      this.bindUi();
    }

    bindUi() {
      const el = this.el;
      this.badgeEl = el.querySelector(".track-mode-badge");
      this.scopeCanvas = el.querySelector(".track-scope");
      this.scopeCtx = this.scopeCanvas.getContext("2d");
      this.rangeBtn = el.querySelector(".range-btn");
      this.lockBtn = el.querySelector(".lock-btn");
      this.muteBtn = el.querySelector(".mute-btn");
      this.winSlider = el.querySelector(".win-slider");
      this.winVal = el.querySelector(".win-val");
      this.chopSlider = el.querySelector(".chop-slider");
      this.chopVal = el.querySelector(".chop-val");
      this.panSlider = el.querySelector(".pan-slider");
      this.panVal = el.querySelector(".pan-val");
      this.delaySlider = el.querySelector(".delay-slider");
      this.delayVal = el.querySelector(".delay-val");
      this.reverbSlider = el.querySelector(".reverb-slider");
      this.reverbVal = el.querySelector(".reverb-val");
      this.depthSlider = el.querySelector(".depth-slider");
      this.depthVal = el.querySelector(".depth-val");
      this.faderSlider = el.querySelector(".fader-slider");

      el.querySelector(".track-name").textContent = `TRK ${this.index + 1}`;
      this.panSlider.value = TRACK_DEFAULTS[this.index].pan;
      this.faderSlider.value = TRACK_DEFAULTS[this.index].fader;
      this.panVal.textContent = TRACK_DEFAULTS[this.index].pan;

      this.rangeBtn.addEventListener("click", () => this.setMode(this.mode === "range" ? "free" : "range"));
      this.lockBtn.addEventListener("click", () => this.setMode(this.mode === "lock" ? "free" : "lock"));
      this.muteBtn.addEventListener("click", () => {
        this.muted = !this.muted;
        this.muteBtn.classList.toggle("active", this.muted);
        this.applyFader();
      });

      this.winSlider.addEventListener("input", () => {
        this.windowSeconds = +this.winSlider.value;
        this.winVal.textContent = `${this.windowSeconds.toFixed(1)}s`;
      });
      this.chopSlider.addEventListener("input", () => {
        this.chop = (+this.chopSlider.value) / 100;
        this.chopVal.textContent = this.chopSlider.value;
      });
      this.panSlider.addEventListener("input", () => {
        this.panVal.textContent = this.panSlider.value;
        if (this.pannerNode && audioCtx) {
          this.pannerNode.pan.setTargetAtTime((+this.panSlider.value) / 100, audioCtx.currentTime, 0.02);
        }
      });
      this.delaySlider.addEventListener("input", () => {
        this.delayVal.textContent = this.delaySlider.value;
        if (this.delaySendGain && audioCtx) {
          this.delaySendGain.gain.setTargetAtTime((+this.delaySlider.value) / 100, audioCtx.currentTime, 0.03);
        }
      });
      this.reverbSlider.addEventListener("input", () => {
        this.reverbVal.textContent = this.reverbSlider.value;
        if (this.reverbSendGain && audioCtx) {
          this.reverbSendGain.gain.setTargetAtTime((+this.reverbSlider.value) / 100, audioCtx.currentTime, 0.03);
        }
      });
      this.depthSlider.addEventListener("input", () => {
        this.depthVal.textContent = this.depthSlider.value;
        this.applyDepth();
      });
      this.faderSlider.addEventListener("input", () => {
        this.faderValue = (+this.faderSlider.value) / 100;
        this.applyFader();
      });
    }

    setupGraph(ctx) {
      this.grainBus = ctx.createGain();
      this.grainBus.gain.value = 1;

      this.depthFilter = ctx.createBiquadFilter();
      this.depthFilter.type = "lowpass";

      this.pannerNode = ctx.createStereoPanner();
      this.pannerNode.pan.value = (+this.panSlider.value) / 100;

      this.faderGain = ctx.createGain();
      this.faderGain.gain.value = 0;

      this.delayNode = ctx.createDelay(2.0);
      this.delayNode.delayTime.value = 0.24 + this.index * 0.05;
      this.delayFeedback = ctx.createGain();
      this.delayFeedback.gain.value = 0.4;
      this.delayDamp = ctx.createBiquadFilter();
      this.delayDamp.type = "lowpass";
      this.delayDamp.frequency.value = 2400;
      this.delayNode.connect(this.delayDamp).connect(this.delayFeedback).connect(this.delayNode);
      this.delaySendGain = ctx.createGain();
      this.delaySendGain.gain.value = (+this.delaySlider.value) / 100;

      this.reverbSendGain = ctx.createGain();
      this.reverbSendGain.gain.value = (+this.reverbSlider.value) / 100;

      this.grainBus.connect(this.depthFilter).connect(this.pannerNode);
      this.pannerNode.connect(this.faderGain).connect(masterGain);
      this.pannerNode.connect(this.delaySendGain).connect(this.delayNode);
      this.delayNode.connect(this.faderGain);
      this.pannerNode.connect(this.reverbSendGain).connect(reverbSend);

      this.applyDepth();
      this.applyFader();
    }

    applyDepth() {
      const depth = (+this.depthSlider.value) / 100;
      const freq = 16000 - depth * 13500; // near=bright, far=muffled
      if (this.depthFilter && audioCtx) {
        this.depthFilter.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
      }
    }

    applyFader() {
      if (!this.faderGain || !audioCtx) return;
      const target = this.muted ? 0 : this.faderValue;
      this.faderGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.015);
    }

    setMode(mode) {
      if (!audioCtx || !ringBuffer) return;
      if (this.mode === "lock") this.disengageLock();
      this.mode = mode;
      this.rangeWindow = null;

      if (mode === "range") {
        const winSamples = Math.floor(this.windowSeconds * audioCtx.sampleRate);
        const avail = ringBuffer.availableSamples();
        const len = Math.max(1, Math.min(winSamples, avail));
        this.rangeWindow = { startAbs: ringBuffer.totalWritten - len, lengthAbs: len };
      } else if (mode === "lock") {
        this.engageLock();
      } else {
        this.nextGrainTime = audioCtx.currentTime + 0.03;
      }

      this.rangeBtn.classList.toggle("active", mode === "range");
      this.lockBtn.classList.toggle("active", mode === "lock");
      this.badgeEl.textContent = mode.toUpperCase();
      this.badgeEl.className = `track-mode-badge ${mode}`;
    }

    engageLock() {
      const lenSamples = Math.max(1024, Math.floor(this.windowSeconds * audioCtx.sampleRate));
      const avail = ringBuffer.availableSamples();
      const useLen = Math.max(1024, Math.min(lenSamples, avail));
      const startAbs = ringBuffer.totalWritten - useLen;

      const buf = audioCtx.createBuffer(1, useLen, audioCtx.sampleRate);
      const ch = buf.getChannelData(0);
      ringBuffer.readRange(startAbs, useLen, ch);

      // crossfade the wrap point so the loop repeats seamlessly
      const seam = Math.min(Math.floor(0.02 * audioCtx.sampleRate), Math.floor(useLen / 4));
      for (let i = 0; i < seam; i++) {
        const g = i / seam;
        const head = ch[i];
        const tailIdx = useLen - seam + i;
        ch[tailIdx] = ch[tailIdx] * (1 - g) + head * g;
      }

      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = useLen / audioCtx.sampleRate;

      const env = audioCtx.createGain();
      env.gain.setValueAtTime(0, audioCtx.currentTime);
      env.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.02);

      src.connect(env).connect(this.grainBus);
      src.start();

      this.lockSource = src;
      this.lockEnv = env;
    }

    resetToFree() {
      if (this.mode === "lock") this.disengageLock();
      this.mode = "free";
      this.rangeWindow = null;
      this.rangeBtn.classList.remove("active");
      this.lockBtn.classList.remove("active");
      this.badgeEl.textContent = "FREE";
      this.badgeEl.className = "track-mode-badge free";
    }

    disengageLock() {
      if (!this.lockSource) return;
      const now = audioCtx.currentTime;
      this.lockEnv.gain.cancelScheduledValues(now);
      this.lockEnv.gain.setValueAtTime(this.lockEnv.gain.value, now);
      this.lockEnv.gain.linearRampToValueAtTime(0, now + 0.02);
      const src = this.lockSource;
      const env = this.lockEnv;
      setTimeout(() => {
        try { src.stop(); src.disconnect(); env.disconnect(); } catch (e) {}
      }, 40);
      this.lockSource = null;
      this.lockEnv = null;
    }

    triggerGrain(startAbs, lenSamples, time) {
      const buf = audioCtx.createBuffer(1, lenSamples, audioCtx.sampleRate);
      const ch = buf.getChannelData(0);
      ringBuffer.readRange(startAbs, lenSamples, ch);

      const reverse = Math.random() < 0.06 + this.chop * 0.14;
      if (reverse) ch.reverse();

      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const rate = 1 + (Math.random() * 2 - 1) * (0.01 + this.chop * 0.05);
      src.playbackRate.value = rate;

      const rawDur = lenSamples / audioCtx.sampleRate;
      const dur = rawDur / rate;
      const fade = Math.min(0.015, dur * 0.3);

      const env = audioCtx.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(1, time + fade);
      env.gain.setValueAtTime(1, Math.max(time + fade, time + dur - fade));
      env.gain.linearRampToValueAtTime(0, time + dur);

      src.connect(env).connect(this.grainBus);
      src.start(time);
      src.stop(time + dur + 0.02);
      src.onended = () => { try { src.disconnect(); env.disconnect(); } catch (e) {} };

      const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
      setTimeout(() => { this.flashUntil = performance.now() + Math.min(180, dur * 1000); }, delayMs);

      return dur;
    }

    schedule(now) {
      if (this.mode === "lock") return;
      while (this.nextGrainTime < now + LOOKAHEAD) {
        const t = this.nextGrainTime;
        const chop = this.chop;
        const minLen = 0.5 - chop * 0.42;
        const maxLen = 0.75 - chop * 0.5;
        const lenSeconds = Math.max(0.03, minLen + Math.random() * Math.max(0.01, maxLen - minLen));
        const lenSamples = Math.max(256, Math.floor(lenSeconds * audioCtx.sampleRate));

        let startAbs;
        if (this.mode === "range" && this.rangeWindow) {
          const { startAbs: rs, lengthAbs: rl } = this.rangeWindow;
          const span = Math.max(1, rl - lenSamples);
          startAbs = rs + Math.floor(Math.random() * span);
        } else {
          const avail = ringBuffer.availableSamples();
          const earliestAbs = ringBuffer.totalWritten - avail;
          const span = Math.max(1, avail - lenSamples);
          startAbs = earliestAbs + Math.floor(Math.random() * span);
        }

        const dur = this.triggerGrain(startAbs, lenSamples, t);
        const overlap = Math.min(0.015, dur * 0.3);
        let gap = 0;
        if (chop > 0.5 && Math.random() < (chop - 0.5) * 0.6) {
          gap = Math.random() * 0.12 * chop;
        }
        this.nextGrainTime = t + Math.max(0.02, dur - overlap) + gap;
      }
    }

    drawScope() {
      const ctx2d = this.scopeCtx;
      const w = this.scopeCanvas.width;
      const h = this.scopeCanvas.height;
      ctx2d.fillStyle = "#050607";
      ctx2d.fillRect(0, 0, w, h);
      const lit = performance.now() < this.flashUntil;
      if (!this.accentColor) {
        this.accentColor = (getComputedStyle(this.el).getPropertyValue("--c") || "#5ff0c0").trim();
      }
      if (lit) {
        ctx2d.fillStyle = this.accentColor;
        const bars = 14;
        for (let i = 0; i < bars; i++) {
          if (Math.random() < 0.6) continue;
          const bw = w / bars;
          const bh = Math.random() * h;
          ctx2d.globalAlpha = 0.5 + Math.random() * 0.5;
          ctx2d.fillRect(i * bw, (h - bh) / 2, bw * 0.7, bh);
        }
        ctx2d.globalAlpha = 1;
      } else {
        ctx2d.strokeStyle = "rgba(255,255,255,0.12)";
        ctx2d.beginPath();
        ctx2d.moveTo(0, h / 2);
        ctx2d.lineTo(w, h / 2);
        ctx2d.stroke();
      }
    }
  }

  function setupTrackGraph(track) {
    track.setupGraph(audioCtx);
  }

  function createTracks() {
    tracksEl.innerHTML = "";
    tracks = [];
    for (let i = 0; i < 4; i++) {
      const node = trackTemplate.content.firstElementChild.cloneNode(true);
      tracksEl.appendChild(node);
      tracks.push(new Track(i, node));
    }
  }

  // ---- scheduler / meters / visuals ---------------------------------

  function schedulerLoop() {
    if (!running || !audioCtx) return;
    const now = audioCtx.currentTime;
    tracks.forEach((t) => t.schedule(now));
    schedulerTimer = setTimeout(schedulerLoop, SCHEDULE_INTERVAL_MS);
  }

  function updateBufferReadout() {
    if (!ringBuffer) return;
    const secs = Math.min(BUFFER_SECONDS, ringBuffer.availableSamples() / audioCtx.sampleRate);
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = Math.floor(secs % 60).toString().padStart(2, "0");
    bufferTimeEl.textContent = `${m}:${s} / 03:00`;
  }

  function updateInputMeter() {
    if (!inputAnalyser) return;
    inputAnalyser.getFloatTimeDomainData(inputMeterData);
    let sum = 0;
    for (let i = 0; i < inputMeterData.length; i++) sum += inputMeterData[i] * inputMeterData[i];
    const rms = Math.sqrt(sum / inputMeterData.length);
    const pct = Math.min(100, rms * 320);
    inputMeterEl.style.width = `${pct}%`;
  }

  let masterScopeData = null;

  function drawMasterScope() {
    if (!running || !masterAnalyser) {
      requestAnimationFrame(drawMasterScope);
      return;
    }
    if (!masterScopeData || masterScopeData.length !== masterAnalyser.fftSize) {
      masterScopeData = new Float32Array(masterAnalyser.fftSize);
    }
    const w = masterScopeCanvas.width;
    const h = masterScopeCanvas.height;
    const data = masterScopeData;
    masterAnalyser.getFloatTimeDomainData(data);
    masterScopeCtx.fillStyle = "#050607";
    masterScopeCtx.fillRect(0, 0, w, h);
    masterScopeCtx.strokeStyle = "#5ff0c0";
    masterScopeCtx.beginPath();
    for (let i = 0; i < w; i++) {
      const idx = Math.floor((i / w) * data.length);
      const y = h / 2 + data[idx] * h * 0.45;
      if (i === 0) masterScopeCtx.moveTo(i, y); else masterScopeCtx.lineTo(i, y);
    }
    masterScopeCtx.stroke();
    requestAnimationFrame(drawMasterScope);
  }

  function drawTrackScopes() {
    tracks.forEach((t) => t.drawScope());
    requestAnimationFrame(drawTrackScopes);
  }

  // ---- transport -----------------------------------------------------

  masterFaderEl.addEventListener("input", () => {
    if (masterFader && audioCtx) {
      masterFader.gain.setTargetAtTime((+masterFaderEl.value) / 100, audioCtx.currentTime, 0.02);
    }
  });

  async function start() {
    startBtn.disabled = true;
    try {
      await startCapture();
    } catch (err) {
      startBtn.disabled = false;
      alert("マイクを使用できませんでした: " + err.message);
      return;
    }
    running = true;
    tracks.forEach((t) => {
      t.nextGrainTime = audioCtx.currentTime + 0.1;
      t.rangeBtn.disabled = false;
      t.lockBtn.disabled = false;
    });
    schedulerLoop();
    meterTimer = setInterval(() => { updateInputMeter(); updateBufferReadout(); }, 66);
    recDot.classList.add("live");
    startBtn.textContent = "STOP";
    startBtn.classList.add("on");
    startBtn.disabled = false;
  }

  function stop() {
    running = false;
    clearTimeout(schedulerTimer);
    clearInterval(meterTimer);
    tracks.forEach((t) => {
      t.resetToFree();
      t.faderGain && t.faderGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.03);
      t.rangeBtn.disabled = true;
      t.lockBtn.disabled = true;
    });
    if (masterGain) masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    setTimeout(() => {
      stopCapture();
      if (audioCtx) { audioCtx.close(); audioCtx = null; }
      ringBuffer = null;
      recDot.classList.remove("live");
      bufferTimeEl.textContent = "00:00 / 03:00";
      inputMeterEl.style.width = "0%";
    }, 250);
    startBtn.textContent = "MIC START";
    startBtn.classList.remove("on");
  }

  startBtn.addEventListener("click", () => {
    if (running) stop(); else start();
  });

  createTracks();
  requestAnimationFrame(drawMasterScope);
  requestAnimationFrame(drawTrackScopes);
})();
