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
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const semitoneToRate = (s) => Math.pow(2, s / 12);

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

  // ---------------------------------------------------------------- audio engine

  let ctx = null;
  let masterGain, compressor, analyser, reverbConvolver, reverbBusGain;
  const tracks = [];
  let schedulerTimer = null;

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

    tracks.forEach((t) => t.buildGraph());
    startScheduler();
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
    el.className = "knob";

    const dial = document.createElement("div");
    dial.className = "knob__dial";
    const pointer = document.createElement("div");
    pointer.className = "knob__pointer";
    dial.appendChild(pointer);

    const labelEl = document.createElement("div");
    labelEl.className = "knob__label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "knob__value";

    const dice_btn = document.createElement("button");
    dice_btn.className = "dieBtn";
    dice_btn.type = "button";
    dice_btn.title = "randomize " + label;
    dice_btn.textContent = "🎲";

    const row = document.createElement("div");
    row.className = "knob__row";
    row.appendChild(dial);
    row.appendChild(dice_btn);

    el.appendChild(labelEl);
    el.appendChild(row);
    el.appendChild(valueEl);

    function fmt(val) {
      if (format) return format(val);
      return val.toFixed(dp) + unit;
    }

    function render() {
      const t = (v - min) / (max - min);
      const deg = lerp(-135, 135, t);
      pointer.style.transform = `rotate(${deg}deg)`;
      dial.style.setProperty("--pct", t);
      valueEl.textContent = fmt(v);
    }

    function setValue(nv, { silent } = {}) {
      v = clamp(nv, min, max);
      render();
      if (!silent && onChange) onChange(v);
    }

    // drag interaction
    let dragging = false, startY = 0, startV = 0;
    dial.addEventListener("pointerdown", (e) => {
      if (disabled && disabled()) return;
      dragging = true;
      startY = e.clientY;
      startV = v;
      dial.setPointerCapture(e.pointerId);
      dial.classList.add("dragging");
    });
    dial.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      const range = max - min;
      const sensitivity = e.shiftKey ? 600 : 160;
      setValue(startV + (dy / sensitivity) * range);
    });
    const endDrag = () => { dragging = false; dial.classList.remove("dragging"); };
    dial.addEventListener("pointerup", endDrag);
    dial.addEventListener("pointercancel", endDrag);
    dial.addEventListener("dblclick", () => setValue(defaultValue));
    dial.addEventListener("wheel", (e) => {
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
      };

      this.knobs = {};
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

      this.filterNode.connect(this.crusher).connect(this.ringGain).connect(this.panner);

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

      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = p.depth * 1.1;
      this.panner.connect(this.reverbSend).connect(reverbConvolver);

      this.trackSum = ctx.createGain();
      this.panner.connect(this.trackSum);
      this.delayMixGain.connect(this.trackSum);

      this.levelGain = ctx.createGain();
      this.levelGain.gain.value = p.level;
      this.trackSum.connect(this.levelGain).connect(masterGain);
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
      if (this.playing) {
        this.wander.tick(0.03 + p.flux * 0.25);
        this.panDrift.tick(0.04 + p.flux * 0.2);
        const targetPan = clamp(p.pan + this.panDrift.value * p.flux * 0.5, -1, 1);
        if (this.panner) this.panner.pan.setTargetAtTime(targetPan, now, 0.4);

        if (p.mode === "scatter") {
          const rate = 1 + p.density * 24;
          while (this.nextGrainTime < now + 0.25) {
            this.spawnGrain(this.nextGrainTime);
            const jitter = 1 + (Math.random() * 2 - 1) * p.flux * 0.7;
            this.nextGrainTime += Math.max(0.02, (1 / rate) * jitter);
          }
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

    modeRow.appendChild(modeBtn);
    modeRow.appendChild(revBtn);
    modeRow.appendChild(trackRandBtn);
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

    startBtn.addEventListener("click", () => {
      ensureAudio();
      startOverlay.remove();
      app.hidden = false;
    });

    requestAnimationFrame(animate);
  }

  document.addEventListener("DOMContentLoaded", main);
})();
