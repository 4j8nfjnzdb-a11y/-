// PULSAR-23 [SCREW] — glitch drum machine
//
// Every voice is synthesized (no samples). Three forces keep the
// pattern from ever repeating cleanly:
//   MUTATE — individual steps randomly flip on/off while it plays
//   REWIRE — a row's trigger gets replugged to a different voice engine
//            mid-performance (visible in the patch bay); the pattern you
//            drew keeps firing, but what comes out of it drifts
//   SCREW  — per-hit pitch/stutter/skip glitches, plus occasional
//            turntable-style tempo "stalls" (the chopped & screwed nod)

(() => {
  const STEPS = 16;

  const TRACKS = [
    { id: "kick", name: "KICK", abbr: "KIC", color: "#ff3b3b" },
    { id: "snare", name: "SNARE", abbr: "SNR", color: "#ffb930" },
    { id: "clap", name: "CLAP", abbr: "CLP", color: "#ffe14d" },
    { id: "hatc", name: "HAT-C", abbr: "HTC", color: "#4dff9c" },
    { id: "hato", name: "HAT-O", abbr: "HTO", color: "#4de3ff" },
    { id: "tom", name: "TOM", abbr: "TOM", color: "#7a8bff" },
    { id: "perc", name: "PERC", abbr: "PRC", color: "#d16bff" },
    { id: "noise", name: "FX", abbr: "NSE", color: "#ff6bd6" },
  ];

  const DEFAULT_PATTERN = [
    [0, 4, 8, 12],
    [4, 12],
    [],
    [0, 2, 4, 6, 8, 10, 12, 14],
    [14],
    [],
    [6, 13],
    [],
  ];

  const pattern = TRACKS.map((_, i) => {
    const row = new Array(STEPS).fill(0);
    DEFAULT_PATTERN[i].forEach((s) => (row[s] = 1));
    return row;
  });

  const routing = TRACKS.map((_, i) => i); // routing[sourceRow] = voice engine index actually heard
  const muted = TRACKS.map(() => false);
  const trackVolume = TRACKS.map(() => 0.8); // per-track fader, applied to trackGains once audio exists
  const flashRow = new Array(TRACKS.length).fill(0); // ms timestamp until which cable glows

  const playBtn = document.getElementById("playBtn");
  const recBtn = document.getElementById("recBtn");
  const chaosBtn = document.getElementById("chaosBtn");
  const randomBtn = document.getElementById("randomBtn");
  const clearBtn = document.getElementById("clearBtn");
  const bpmSlider = document.getElementById("bpm");
  const bpmVal = document.getElementById("bpmVal");
  const mutateSlider = document.getElementById("mutate");
  const rewireSlider = document.getElementById("rewire");
  const screwSlider = document.getElementById("screw");
  const masterSlider = document.getElementById("master");
  const seqEl = document.getElementById("sequencer");
  const patchCanvas = document.getElementById("patchbay");
  const patchCtx = patchCanvas.getContext("2d");

  const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---- build sequencer grid ------------------------------------------

  const stepEls = TRACKS.map(() => new Array(STEPS));
  const routeEls = [];

  TRACKS.forEach((track, r) => {
    const row = document.createElement("div");
    row.className = "track-row";

    const label = document.createElement("div");
    label.className = "track-label";

    const nameEl = document.createElement("div");
    nameEl.className = "track-name";
    nameEl.textContent = track.name;
    nameEl.style.color = track.color;

    const routeEl = document.createElement("div");
    routeEl.className = "track-route";
    routeEls.push(routeEl);

    const muteBtn = document.createElement("button");
    muteBtn.className = "mute-btn";
    muteBtn.textContent = "M";
    muteBtn.addEventListener("click", () => {
      muted[r] = !muted[r];
      muteBtn.classList.toggle("muted", muted[r]);
      row.style.opacity = muted[r] ? 0.4 : 1;
    });

    const faderRow = document.createElement("div");
    faderRow.className = "fader-row";

    const fader = document.createElement("input");
    fader.type = "range";
    fader.className = "fader";
    fader.min = "0";
    fader.max = "100";
    fader.value = String(Math.round(trackVolume[r] * 100));
    fader.style.setProperty("--fader-color", track.color);
    fader.setAttribute("aria-label", `${track.name} volume`);

    const faderVal = document.createElement("span");
    faderVal.className = "fader-val";
    faderVal.textContent = fader.value;

    fader.addEventListener("input", () => {
      trackVolume[r] = +fader.value / 100;
      faderVal.textContent = fader.value;
      if (trackGains[r]) trackGains[r].gain.setTargetAtTime(trackVolume[r], audioCtx.currentTime, 0.015);
    });

    faderRow.appendChild(fader);
    faderRow.appendChild(faderVal);

    label.appendChild(nameEl);
    label.appendChild(routeEl);
    label.appendChild(muteBtn);
    label.appendChild(faderRow);
    row.appendChild(label);

    for (let s = 0; s < STEPS; s++) {
      const cell = document.createElement("div");
      cell.className = "step" + (s % 4 === 0 && s !== 0 ? " beat4" : "");
      cell.style.setProperty("--step-color", track.color);
      if (pattern[r][s]) cell.classList.add("on");
      cell.addEventListener("click", () => {
        pattern[r][s] = pattern[r][s] ? 0 : 1;
        cell.classList.toggle("on");
      });
      row.appendChild(cell);
      stepEls[r][s] = cell;
    }

    seqEl.appendChild(row);
  });

  function updateRouteLabel(r) {
    const target = routing[r];
    routeEls[r].textContent = target === r ? "direct" : `→ ${TRACKS[target].name}`;
    routeEls[r].classList.toggle("rerouted", target !== r);
  }
  TRACKS.forEach((_, r) => updateRouteLabel(r));

  // ---- audio engine ----------------------------------------------------

  let audioCtx = null;
  let masterGain = null;
  let trackGains = [];
  let noiseBuffer = null;

  function buildNoiseBuffer(ctx) {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = +masterSlider.value / 100;

    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    masterGain.connect(comp).connect(audioCtx.destination);

    trackGains = TRACKS.map((_, i) => {
      const g = audioCtx.createGain();
      g.gain.value = trackVolume[i];
      g.connect(masterGain);
      return g;
    });

    noiseBuffer = buildNoiseBuffer(audioCtx);
  }

  function noiseSource(rate) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.playbackRate.value = rate;
    return src;
  }

  // rateMul: pitch/speed multiplier from the current SCREW tempo "stall"
  // (1 = normal, >1 handled by callers as 1/warp already applied here)

  function playKick(t, { rateMul, screwAmt }) {
    const jitter = 1 + (Math.random() * 2 - 1) * 0.05 * screwAmt;
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    const f0 = 150 * rateMul * jitter;
    const f1 = Math.max(20, 45 * rateMul * jitter);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + 0.15 / rateMul);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32 / rateMul);

    osc.connect(gain).connect(trackGains[0]);
    osc.start(t);
    osc.stop(t + 0.4 / rateMul);

    const click = noiseSource(1);
    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    const clickGain = audioCtx.createGain();
    clickGain.gain.setValueAtTime(0.35, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    click.connect(hp).connect(clickGain).connect(trackGains[0]);
    click.start(t);
    click.stop(t + 0.03);
  }

  function playSnare(t, { rateMul, screwAmt }) {
    const jitter = 1 + (Math.random() * 2 - 1) * 0.06 * screwAmt;
    const noise = noiseSource(rateMul * jitter);
    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const nGain = audioCtx.createGain();
    nGain.gain.setValueAtTime(0.9, t);
    nGain.gain.exponentialRampToValueAtTime(0.0005, t + 0.18 / rateMul);
    noise.connect(bp).connect(nGain).connect(trackGains[1]);
    noise.start(t);
    noise.stop(t + 0.25 / rateMul);

    const tone = audioCtx.createOscillator();
    tone.type = "triangle";
    tone.frequency.value = 190 * rateMul * jitter;
    const tGain = audioCtx.createGain();
    tGain.gain.setValueAtTime(0.5, t);
    tGain.gain.exponentialRampToValueAtTime(0.0005, t + 0.1 / rateMul);
    tone.connect(tGain).connect(trackGains[1]);
    tone.start(t);
    tone.stop(t + 0.15 / rateMul);
  }

  function playClap(t, { rateMul, screwAmt }) {
    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500;
    bp.Q.value = 1.2;
    const pan = audioCtx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.4;
    bp.connect(pan).connect(trackGains[2]);

    const bursts = 3;
    for (let i = 0; i < bursts; i++) {
      const bt = t + (i * 0.011) / rateMul;
      const noise = noiseSource(rateMul);
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.6, bt);
      g.gain.exponentialRampToValueAtTime(0.0005, bt + 0.03 / rateMul);
      noise.connect(g).connect(bp);
      noise.start(bt);
      noise.stop(bt + 0.05);
    }
    const tail = noiseSource(rateMul);
    const tailGain = audioCtx.createGain();
    const tailStart = t + 0.03 / rateMul;
    tailGain.gain.setValueAtTime(0.35, tailStart);
    tailGain.gain.exponentialRampToValueAtTime(0.0005, tailStart + (0.2 + screwAmt * 0.1) / rateMul);
    tail.connect(tailGain).connect(bp);
    tail.start(tailStart);
    tail.stop(tailStart + 0.35);
  }

  function playHat(t, { rateMul, screwAmt }, open) {
    const idx = open ? 4 : 3;
    const noise = noiseSource(rateMul * (1 + (Math.random() * 2 - 1) * 0.04 * screwAmt));
    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const gain = audioCtx.createGain();
    const decay = (open ? 0.28 : 0.045) / rateMul;
    gain.gain.setValueAtTime(open ? 0.4 : 0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    const pan = audioCtx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.5;
    noise.connect(hp).connect(gain).connect(pan).connect(trackGains[idx]);
    noise.start(t);
    noise.stop(t + decay + 0.02);
  }

  function playTom(t, { rateMul, screwAmt }) {
    const jitter = 1 + (Math.random() * 2 - 1) * 0.05 * screwAmt;
    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(210 * rateMul * jitter, t);
    osc.frequency.exponentialRampToValueAtTime(85 * rateMul * jitter, t + 0.25 / rateMul);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.35 / rateMul);
    const pan = audioCtx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.3;
    osc.connect(gain).connect(pan).connect(trackGains[5]);
    osc.start(t);
    osc.stop(t + 0.4 / rateMul);
  }

  function playPerc(t, { rateMul, screwAmt }) {
    const jitter = 1 + (Math.random() * 2 - 1) * 0.1 * screwAmt;
    const osc = audioCtx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 950 * rateMul * jitter;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.08 / rateMul);
    const pan = audioCtx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.6;
    osc.connect(gain).connect(pan).connect(trackGains[6]);
    osc.start(t);
    osc.stop(t + 0.1 / rateMul);
  }

  function playNoiseFX(t, { rateMul, screwAmt }) {
    const noise = noiseSource(rateMul * (0.6 + Math.random() * 0.8));
    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 400 + Math.random() * 4000;
    bp.Q.value = 4 + Math.random() * 8;
    const gain = audioCtx.createGain();
    const decay = (0.15 + Math.random() * 0.3 + screwAmt * 0.2) / rateMul;
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    const pan = audioCtx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    noise.connect(bp).connect(gain).connect(pan).connect(trackGains[7]);
    noise.start(t);
    noise.stop(t + decay + 0.02);
  }

  const VOICES = [
    playKick,
    playSnare,
    playClap,
    (t, o) => playHat(t, o, false),
    (t, o) => playHat(t, o, true),
    playTom,
    playPerc,
    playNoiseFX,
  ];

  function playVoice(index, time, opts) {
    VOICES[index](time, opts);
    flashRow[index] = performance.now() + 140;
  }

  // ---- scheduler -------------------------------------------------------

  let running = false;
  let bpm = +bpmSlider.value;
  let currentStep = 0;
  let nextStepTime = 0;
  let schedulerTimer = null;
  let warpFactor = 1; // >1 = SCREW tempo "stall" (slower + pitched down)
  let warpTarget = 1;
  let glitchTimer = null;

  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.12;

  function stepSeconds() {
    return ((60 / bpm) / 4) * warpFactor;
  }

  function flashGlitch(ms) {
    document.body.classList.add("glitching");
    clearTimeout(glitchTimer);
    glitchTimer = setTimeout(() => document.body.classList.remove("glitching"), ms);
  }

  function doRewireSwap() {
    const a = randInt(0, TRACKS.length - 1);
    let b = randInt(0, TRACKS.length - 1);
    if (a === b) b = (b + 1) % TRACKS.length;
    const tmp = routing[a];
    routing[a] = routing[b];
    routing[b] = tmp;
    updateRouteLabel(a);
    updateRouteLabel(b);
  }

  function mutateRandomStep() {
    const r = randInt(0, TRACKS.length - 1);
    const s = randInt(0, STEPS - 1);
    pattern[r][s] = pattern[r][s] ? 0 : 1;
    stepEls[r][s].classList.toggle("on", !!pattern[r][s]);
  }

  function triggerScrewStall(intensityBoost) {
    const screwAmt = +screwSlider.value / 100;
    const intensity = clamp(0.2 + screwAmt * 0.7 + intensityBoost, 0.2, 1.6);
    warpTarget = 1 + intensity;
    flashGlitch(250 + intensity * 350);
    setTimeout(() => {
      warpTarget = 1;
    }, 450 + intensity * 700);
  }

  function scheduleStep(step, time) {
    const mutateAmt = +mutateSlider.value / 100;
    const rewireAmt = +rewireSlider.value / 100;
    const screwAmt = +screwSlider.value / 100;

    if (Math.random() < mutateAmt * 0.09) mutateRandomStep();
    if (Math.random() < rewireAmt * 0.05) doRewireSwap();
    if (step === 0 && Math.random() < screwAmt * 0.16) triggerScrewStall(0);

    const rateMul = 1 / warpFactor;
    const hits = [];

    for (let r = 0; r < TRACKS.length; r++) {
      if (!pattern[r][step]) continue;
      hits.push({ r, state: "on" });
      if (muted[r]) continue;

      if (Math.random() < screwAmt * 0.12) {
        hits[hits.length - 1].state = "skip";
        continue;
      }

      const voiceIndex = routing[r];
      playVoice(voiceIndex, time, { rateMul, screwAmt });

      if (Math.random() < screwAmt * 0.15) {
        const count = 1 + randInt(0, 1);
        for (let k = 1; k <= count; k++) {
          const st = time + (k * stepSeconds()) / (count + 1);
          playVoice(voiceIndex, st, { rateMul, screwAmt: screwAmt * 0.7 });
        }
      }
    }

    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => updatePlayheadUI(step, hits), delayMs);
  }

  let prevStepEls = [];
  function updatePlayheadUI(step, hits) {
    prevStepEls.forEach((cell) => cell.classList.remove("playhead", "flash", "skip"));
    prevStepEls = [];
    for (let r = 0; r < TRACKS.length; r++) {
      const cell = stepEls[r][step];
      cell.classList.add("playhead");
      prevStepEls.push(cell);
    }
    hits.forEach(({ r, state }) => {
      const cell = stepEls[r][step];
      if (state === "on") cell.classList.add("flash");
      if (state === "skip") cell.classList.add("skip");
    });
  }

  function scheduler() {
    while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(currentStep, nextStepTime);
      nextStepTime += stepSeconds();
      warpFactor += (warpTarget - warpFactor) * 0.18;
      currentStep = (currentStep + 1) % STEPS;
    }
    schedulerTimer = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  function start() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    running = true;
    currentStep = 0;
    nextStepTime = audioCtx.currentTime + 0.05;
    scheduler();
    playBtn.textContent = "■ STOP";
    playBtn.classList.add("playing");
  }

  function stop() {
    running = false;
    clearTimeout(schedulerTimer);
    prevStepEls.forEach((cell) => cell.classList.remove("playhead", "flash", "skip"));
    prevStepEls = [];
    playBtn.textContent = "▶ RUN";
    playBtn.classList.remove("playing");
  }

  playBtn.addEventListener("click", () => (running ? stop() : start()));

  // ---- WAV recorder ----------------------------------------------------
  // Taps the master bus with a ScriptProcessorNode running in parallel to
  // normal playback (routed to a muted gain so it doesn't add an extra
  // audible path), buffers raw stereo float samples, and on stop encodes
  // them straight into a 16-bit PCM WAV file for download.

  let isRecording = false;
  let recProcessor = null;
  let recSilent = null;
  let recChunksL = [];
  let recChunksR = [];
  let recTimer = null;
  let recStartedAt = 0;

  function formatElapsed(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function startRecording() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();

    recChunksL = [];
    recChunksR = [];
    recProcessor = audioCtx.createScriptProcessor(4096, 2, 2);
    recSilent = audioCtx.createGain();
    recSilent.gain.value = 0;
    masterGain.connect(recProcessor);
    recProcessor.connect(recSilent);
    recSilent.connect(audioCtx.destination);
    recProcessor.onaudioprocess = (e) => {
      recChunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      recChunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)));
    };

    isRecording = true;
    recStartedAt = performance.now();
    recBtn.classList.add("recording");
    recTimer = setInterval(() => {
      recBtn.textContent = `■ ${formatElapsed((performance.now() - recStartedAt) / 1000)}`;
    }, 250);
  }

  function encodeWav(chunksL, chunksR, sampleRate) {
    const frameCount = chunksL.reduce((sum, c) => sum + c.length, 0);
    const buffer = new ArrayBuffer(44 + frameCount * 4);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + frameCount * 4, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // stereo
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true); // byte rate (2ch * 2 bytes)
    view.setUint16(32, 4, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, "data");
    view.setUint32(40, frameCount * 4, true);

    let pos = 44;
    for (let c = 0; c < chunksL.length; c++) {
      const l = chunksL[c];
      const r = chunksR[c];
      for (let i = 0; i < l.length; i++) {
        const sl = clamp(l[i], -1, 1);
        const sr = clamp(r[i], -1, 1);
        view.setInt16(pos, sl < 0 ? sl * 0x8000 : sl * 0x7fff, true);
        view.setInt16(pos + 2, sr < 0 ? sr * 0x8000 : sr * 0x7fff, true);
        pos += 4;
      }
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  function stopRecording() {
    isRecording = false;
    clearInterval(recTimer);
    recBtn.textContent = "⏺ REC";
    recBtn.classList.remove("recording");

    if (recProcessor) {
      recProcessor.onaudioprocess = null;
      masterGain.disconnect(recProcessor);
      recProcessor.disconnect();
      recSilent.disconnect();
      recProcessor = null;
      recSilent = null;
    }

    if (recChunksL.length === 0) return;

    const blob = encodeWav(recChunksL, recChunksR, audioCtx.sampleRate);
    recChunksL = [];
    recChunksR = [];

    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `PULSAR-23_${stamp}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  recBtn.addEventListener("click", () => (isRecording ? stopRecording() : startRecording()));

  chaosBtn.addEventListener("click", () => {
    if (!audioCtx) initAudio();
    for (let i = 0; i < 6; i++) mutateRandomStep();
    for (let i = 0; i < 3; i++) doRewireSwap();
    triggerScrewStall(0.6);
    flashGlitch(700);
  });

  randomBtn.addEventListener("click", () => {
    const density = [0.32, 0.22, 0.12, 0.5, 0.12, 0.1, 0.18, 0.1];
    for (let r = 0; r < TRACKS.length; r++) {
      for (let s = 0; s < STEPS; s++) {
        pattern[r][s] = Math.random() < density[r] ? 1 : 0;
        stepEls[r][s].classList.toggle("on", !!pattern[r][s]);
      }
    }
    flashGlitch(200);
  });

  clearBtn.addEventListener("click", () => {
    for (let r = 0; r < TRACKS.length; r++) {
      for (let s = 0; s < STEPS; s++) {
        pattern[r][s] = 0;
        stepEls[r][s].classList.remove("on");
      }
    }
  });

  bpmSlider.addEventListener("input", () => {
    bpm = +bpmSlider.value;
    bpmVal.textContent = bpm;
  });

  masterSlider.addEventListener("input", () => {
    if (masterGain) masterGain.gain.setTargetAtTime(+masterSlider.value / 100, audioCtx.currentTime, 0.02);
  });

  // ---- patch bay visualization ------------------------------------------

  const PB_LEFT_X = 30;
  const PB_RIGHT_X = 190;
  const PB_TOP = 20;
  const PB_BOTTOM = 268;
  const rowY = (i) => PB_TOP + (i * (PB_BOTTOM - PB_TOP)) / (TRACKS.length - 1);

  function drawPatchbay() {
    const w = patchCanvas.width;
    const h = patchCanvas.height;
    patchCtx.clearRect(0, 0, w, h);
    patchCtx.fillStyle = "#0c0f13";
    patchCtx.fillRect(0, 0, w, h);

    const now = performance.now();

    // cables first, behind nodes
    for (let r = 0; r < TRACKS.length; r++) {
      const y0 = rowY(r);
      const y1 = rowY(routing[r]);
      const rerouted = routing[r] !== r;
      const flashing = now < flashRow[routing[r]];
      const alpha = flashing ? 1 : rerouted ? 0.85 : 0.4;

      patchCtx.strokeStyle = TRACKS[r].color;
      patchCtx.globalAlpha = alpha;
      patchCtx.lineWidth = flashing ? 2.6 : rerouted ? 1.8 : 1.1;
      patchCtx.beginPath();
      patchCtx.moveTo(PB_LEFT_X, y0);
      const midX = (PB_LEFT_X + PB_RIGHT_X) / 2;
      patchCtx.bezierCurveTo(midX, y0, midX, y1, PB_RIGHT_X, y1);
      patchCtx.stroke();
    }
    patchCtx.globalAlpha = 1;

    // nodes + labels
    patchCtx.font = "9px 'JetBrains Mono', monospace";
    for (let i = 0; i < TRACKS.length; i++) {
      const y = rowY(i);

      patchCtx.fillStyle = TRACKS[i].color;
      patchCtx.beginPath();
      patchCtx.arc(PB_LEFT_X, y, 4, 0, Math.PI * 2);
      patchCtx.fill();
      patchCtx.textAlign = "right";
      patchCtx.fillText(TRACKS[i].abbr, PB_LEFT_X - 8, y + 3);

      const flashing = now < flashRow[i];
      patchCtx.fillStyle = flashing ? "#ffffff" : TRACKS[i].color;
      patchCtx.beginPath();
      patchCtx.arc(PB_RIGHT_X, y, flashing ? 5 : 4, 0, Math.PI * 2);
      patchCtx.fill();
      patchCtx.textAlign = "left";
      patchCtx.fillStyle = TRACKS[i].color;
      patchCtx.fillText(TRACKS[i].abbr, PB_RIGHT_X + 8, y + 3);
    }

    requestAnimationFrame(drawPatchbay);
  }
  requestAnimationFrame(drawPatchbay);
})();
