// breaks — a mutating breakbeat diffuser
//
// Inspired by feedback-loop generative audio tools: each loop's pattern
// is not regenerated from scratch, it is a mutated copy of the loop that
// just played. A "prompt word cloud" biases which instruments are most
// likely to change on the next mutation. Nothing here calls out to a
// model — everything is synthesized locally with the Web Audio API so
// the page needs no server, no API key, and no network.

(() => {
  const STEPS_PER_BEAT = 4; // 16th notes

  const els = {
    playBtn: document.getElementById("playBtn"),
    freezeBtn: document.getElementById("freezeBtn"),
    reseedBtn: document.getElementById("reseedBtn"),
    recordBtn: document.getElementById("recordBtn"),
    recordTime: document.getElementById("recordTime"),
    tempo: document.getElementById("tempo"),
    volume: document.getElementById("volume"),
    loopBeats: document.getElementById("loopBeats"),
    mutation: document.getElementById("mutation"),
    mutationInterval: document.getElementById("mutationInterval"),
    density: document.getElementById("density"),
    swing: document.getElementById("swing"),
    humanize: document.getElementById("humanize"),
    grid: document.getElementById("grid"),
    wordCloud: document.getElementById("wordCloud"),
    wordInput: document.getElementById("wordInput"),
    addWordBtn: document.getElementById("addWordBtn"),
    genCount: document.getElementById("genCount"),
    loopInfo: document.getElementById("loopInfo"),
    nextMutInfo: document.getElementById("nextMutInfo"),
    stepInfo: document.getElementById("stepInfo"),
    recordingsList: document.getElementById("recordingsList"),
    waveCanvas: document.getElementById("waveCanvas"),
    freqCanvas: document.getElementById("freqCanvas"),
  };

  // ---- instrument definitions -----------------------------------------

  const INSTRUMENTS = [
    { key: "kick", label: "Kick", color: "#ff6b6b", aliases: ["kick", "bd", "bass drum", "boom"] },
    { key: "snare", label: "Snare", color: "#ffd166", aliases: ["snare", "sd", "snap"] },
    { key: "hatClosed", label: "Hat", color: "#06d6a0", aliases: ["hat", "hihat", "hi-hat", "closed"] },
    { key: "hatOpen", label: "Open Hat", color: "#5ee6bf", aliases: ["open", "openhat", "open hat"] },
    { key: "clap", label: "Clap", color: "#118ab2", aliases: ["clap", "clp"] },
    { key: "tom", label: "Tom/Perc", color: "#ef476f", aliases: ["tom", "perc", "percussion", "conga"] },
    { key: "glitch", label: "Glitch", color: "#b892ff", aliases: ["glitch", "noise", "fx", "chaos", "crash", "stutter"] },
  ];

  let bpm = +els.tempo.value;
  let loopBeats = +els.loopBeats.value;
  let totalSteps = loopBeats * STEPS_PER_BEAT;

  let running = false;
  let frozen = false;
  let genCount = 0;
  let loopsSinceMutation = 0;

  let audioCtx = null;
  let master, compressor, drumBus, recordDest, analyser, freqAnalyser;
  let noiseBuffer = null;
  let openHatGain = null;

  // ---- pattern state ----------------------------------------------------
  // Each instrument keeps a flat array of {on, vel, micro} across totalSteps.

  function makeEmptySteps(n) {
    return Array.from({ length: n }, () => ({ on: false, vel: 0.8, micro: 0 }));
  }

  const pattern = {};
  INSTRUMENTS.forEach((inst) => { pattern[inst.key] = makeEmptySteps(totalSteps); });

  // ---- word cloud / tag weighting ---------------------------------------

  let tags = [
    { text: "kick", strength: 2 },
    { text: "snare", strength: 2 },
    { text: "hat", strength: 1 },
  ];

  function normalize(s) { return s.trim().toLowerCase(); }

  function tagMatchesInstrument(tagText, inst) {
    const t = normalize(tagText);
    if (!t) return false;
    return inst.aliases.some((a) => t.includes(a) || a.includes(t));
  }

  function tagWeight(inst) {
    let w = 1;
    tags.forEach((tag) => {
      if (tagMatchesInstrument(tag.text, inst)) w += tag.strength * 0.7;
    });
    return Math.min(w, 6);
  }

  function renderWordCloud() {
    els.wordCloud.innerHTML = "";
    tags.forEach((tag, i) => {
      const chip = document.createElement("div");
      chip.className = "tagChip";
      const label = document.createElement("span");
      label.textContent = tag.text;
      const minus = document.createElement("button");
      minus.textContent = "−";
      minus.title = "弱める";
      minus.addEventListener("click", () => {
        tag.strength = Math.max(1, tag.strength - 1);
        renderWordCloud();
      });
      const strength = document.createElement("span");
      strength.className = "strength";
      strength.textContent = tag.strength;
      const plus = document.createElement("button");
      plus.textContent = "+";
      plus.title = "強める";
      plus.addEventListener("click", () => {
        tag.strength = Math.min(5, tag.strength + 1);
        renderWordCloud();
      });
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = "削除";
      remove.addEventListener("click", () => {
        tags.splice(i, 1);
        renderWordCloud();
      });
      chip.append(label, minus, strength, plus, remove);
      els.wordCloud.appendChild(chip);
    });
  }

  function addTagFromInput() {
    const text = els.wordInput.value.trim();
    if (!text) return;
    const existing = tags.find((t) => normalize(t.text) === normalize(text));
    if (existing) existing.strength = Math.min(5, existing.strength + 1);
    else tags.push({ text, strength: 2 });
    els.wordInput.value = "";
    renderWordCloud();
  }

  els.addWordBtn.addEventListener("click", addTagFromInput);
  els.wordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTagFromInput();
  });

  // ---- seeding / reseeding -----------------------------------------------
  // Classic breakbeat skeleton (kick / snare backbeat, rolling hats)
  // biased by density, then reshaped per-instrument by its tag weight.

  function seedPattern() {
    const density = +els.density.value / 100;
    INSTRUMENTS.forEach((inst) => {
      const steps = makeEmptySteps(totalSteps);
      const w = tagWeight(inst);
      for (let i = 0; i < totalSteps; i++) {
        const beat = Math.floor(i / STEPS_PER_BEAT) % 4;
        const sub = i % STEPS_PER_BEAT;
        let p = 0;
        if (inst.key === "kick") {
          p = (beat === 0 && sub === 0) || (beat === 2 && sub === 2) ? 0.85 : 0.05;
        } else if (inst.key === "snare") {
          p = (beat === 1 || beat === 3) && sub === 0 ? 0.9 : 0.04;
        } else if (inst.key === "hatClosed") {
          p = sub === 0 || sub === 2 ? 0.55 : 0.3;
        } else if (inst.key === "hatOpen") {
          p = sub === 2 && beat % 2 === 1 ? 0.2 : 0.02;
        } else if (inst.key === "clap") {
          p = beat === 3 && sub === 0 ? 0.25 : 0.02;
        } else if (inst.key === "tom") {
          p = 0.06;
        } else if (inst.key === "glitch") {
          p = 0.03;
        }
        p = Math.min(0.95, p * (0.5 + density) * (0.6 + w * 0.15));
        const on = Math.random() < p;
        steps[i] = {
          on,
          vel: on ? 0.55 + Math.random() * 0.45 : 0.7,
          micro: 0,
        };
      }
      pattern[inst.key] = steps;
    });
    genCount = 0;
    loopsSinceMutation = 0;
    updateStatus();
    renderGrid();
  }

  // ---- mutation: the loop feeds into itself ------------------------------

  function mutate() {
    const amt = +els.mutation.value / 100;
    const density = +els.density.value / 100;
    if (amt <= 0) return;
    INSTRUMENTS.forEach((inst) => {
      const w = tagWeight(inst);
      const steps = pattern[inst.key];
      const chance = amt * 0.5 * w * 0.4;
      for (let i = 0; i < steps.length; i++) {
        if (Math.random() < chance) {
          const st = steps[i];
          const r = Math.random();
          if (r < 0.45) {
            const turnOnBias = 0.4 + density * 0.4;
            st.on = Math.random() < turnOnBias ? true : !st.on;
            if (st.on) st.vel = 0.5 + Math.random() * 0.5;
          } else if (r < 0.8 && st.on) {
            st.vel = Math.min(1, Math.max(0.15, st.vel + (Math.random() * 0.5 - 0.25)));
          } else {
            st.micro = Math.min(0.04, Math.max(-0.04, (st.micro || 0) + (Math.random() * 0.04 - 0.02)));
          }
        }
      }
      // occasional echo-shift: the pattern rotates by one step, as if
      // the previous loop's output bled slightly into the next input
      if (Math.random() < 0.06 * amt) {
        steps.unshift(steps.pop());
      }
    });
    genCount++;
    renderGrid();
  }

  // ---- DOM grid ------------------------------------------------------------

  const cellEls = {};

  function renderGrid() {
    els.grid.innerHTML = "";
    cellEls.__clear = {};
    INSTRUMENTS.forEach((inst) => {
      const row = document.createElement("div");
      row.className = "instRow";
      const label = document.createElement("div");
      label.className = "instLabel";
      label.textContent = inst.label;
      row.appendChild(label);

      const stepsWrap = document.createElement("div");
      stepsWrap.className = "steps";
      const cells = [];
      pattern[inst.key].forEach((st, i) => {
        const cell = document.createElement("div");
        cell.className = "step" + (i % STEPS_PER_BEAT === 0 ? " beat0" : "");
        applyCellVisual(cell, inst, st);
        stepsWrap.appendChild(cell);
        cells.push(cell);
      });
      row.appendChild(stepsWrap);
      els.grid.appendChild(row);
      cellEls[inst.key] = cells;
    });
  }

  function applyCellVisual(cell, inst, st) {
    if (st.on) {
      cell.style.background = inst.color;
      cell.style.opacity = String(0.35 + st.vel * 0.65);
      cell.style.color = inst.color;
    } else {
      cell.style.background = "rgba(255,255,255,0.06)";
      cell.style.opacity = "1";
      cell.style.color = "transparent";
    }
  }

  function refreshGridVisuals() {
    INSTRUMENTS.forEach((inst) => {
      const cells = cellEls[inst.key];
      if (!cells) return;
      pattern[inst.key].forEach((st, i) => applyCellVisual(cells[i], inst, st));
    });
  }

  function highlightStep(stepIndex) {
    INSTRUMENTS.forEach((inst) => {
      const cells = cellEls[inst.key];
      if (!cells) return;
      cells.forEach((c, i) => c.classList.toggle("playing", i === stepIndex));
    });
  }

  function updateStatus() {
    els.genCount.textContent = genCount;
    const secs = (totalSteps / STEPS_PER_BEAT) * (60 / bpm);
    els.loopInfo.textContent = `${loopBeats} beats · ${secs.toFixed(1)}s`;
    const interval = +els.mutationInterval.value;
    const remaining = interval - loopsSinceMutation;
    els.nextMutInfo.textContent = frozen
      ? "frozen"
      : remaining <= 1
      ? "this loop"
      : `in ${remaining} loops`;
  }

  // ---- audio graph ---------------------------------------------------------

  function buildNoiseBuffer(ctx) {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuffer = buildNoiseBuffer(audioCtx);

    drumBus = audioCtx.createGain();
    drumBus.gain.value = 1;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;

    master = audioCtx.createGain();
    master.gain.value = +els.volume.value / 100;

    drumBus.connect(compressor).connect(master);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    freqAnalyser = audioCtx.createAnalyser();
    freqAnalyser.fftSize = 256;

    master.connect(audioCtx.destination);
    master.connect(analyser);
    master.connect(freqAnalyser);

    recordDest = audioCtx.createMediaStreamDestination();
    master.connect(recordDest);
  }

  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  function envGain(node, time, peak, attack, release) {
    node.gain.setValueAtTime(0.0001, time);
    node.gain.linearRampToValueAtTime(peak, time + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, time + attack + release);
  }

  function noiseSource(time, stop) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    src.start(time);
    src.stop(stop);
    return src;
  }

  function triggerKick(time, vel) {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    const g = audioCtx.createGain();
    envGain(g, time, 0.9 * vel, 0.002, 0.26);
    osc.connect(g).connect(drumBus);
    osc.start(time);
    osc.stop(time + 0.3);

    const click = noiseSource(time, time + 0.04);
    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    const cg = audioCtx.createGain();
    envGain(cg, time, 0.22 * vel, 0.001, 0.025);
    click.connect(hp).connect(cg).connect(drumBus);
  }

  function triggerSnare(time, vel) {
    const noise = noiseSource(time, time + 0.2);
    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const ng = audioCtx.createGain();
    envGain(ng, time, 0.65 * vel, 0.001, 0.15);
    noise.connect(bp).connect(ng).connect(drumBus);

    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(120, time + 0.1);
    const og = audioCtx.createGain();
    envGain(og, time, 0.32 * vel, 0.001, 0.11);
    osc.connect(og).connect(drumBus);
    osc.start(time);
    osc.stop(time + 0.15);
  }

  function triggerHatClosed(time, vel) {
    if (openHatGain) {
      const g = openHatGain;
      g.gain.cancelScheduledValues(time);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
      openHatGain = null;
    }
    const noise = noiseSource(time, time + 0.06);
    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = audioCtx.createGain();
    envGain(g, time, 0.28 * vel, 0.001, 0.045);
    noise.connect(hp).connect(g).connect(drumBus);
  }

  function triggerHatOpen(time, vel) {
    const noise = noiseSource(time, time + 0.38);
    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6500;
    const g = audioCtx.createGain();
    envGain(g, time, 0.26 * vel, 0.001, 0.32);
    noise.connect(hp).connect(g).connect(drumBus);
    openHatGain = g;
  }

  function triggerClap(time, vel) {
    [0, 0.012, 0.024].forEach((offset, i) => {
      const t = time + offset;
      const noise = noiseSource(t, t + 0.12);
      const bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1700;
      bp.Q.value = 1.1;
      const g = audioCtx.createGain();
      envGain(g, t, (0.4 - i * 0.06) * vel, 0.001, i === 2 ? 0.1 : 0.02);
      noise.connect(bp).connect(g).connect(drumBus);
    });
  }

  const TOM_PITCHES = [90, 110, 140, 175];

  function triggerTom(time, vel) {
    const freq = TOM_PITCHES[Math.floor(Math.random() * TOM_PITCHES.length)];
    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq * 1.4, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.8, time + 0.14);
    const g = audioCtx.createGain();
    envGain(g, time, 0.5 * vel, 0.002, 0.22);
    osc.connect(g).connect(drumBus);
    osc.start(time);
    osc.stop(time + 0.26);
  }

  function triggerGlitch(time, vel) {
    const hits = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < hits; i++) {
      const t = time + i * (0.012 + Math.random() * 0.01);
      const noise = noiseSource(t, t + 0.02);
      const bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2000 + Math.random() * 4000;
      bp.Q.value = 4;
      const pan = audioCtx.createStereoPanner();
      pan.pan.value = Math.random() * 2 - 1;
      const g = audioCtx.createGain();
      envGain(g, t, 0.28 * vel * (1 - i / hits), 0.0005, 0.015);
      noise.connect(bp).connect(pan).connect(g).connect(drumBus);
    }
  }

  const SYNTH = {
    kick: triggerKick,
    snare: triggerSnare,
    hatClosed: triggerHatClosed,
    hatOpen: triggerHatOpen,
    clap: triggerClap,
    tom: triggerTom,
    glitch: triggerGlitch,
  };

  // ---- scheduler (lookahead technique) --------------------------------------

  let currentStep = 0;
  let nextNoteTime = 0;
  let timerID = null;
  const lookaheadMs = 25;
  const scheduleAheadTime = 0.1;
  let notesInQueue = [];

  function scheduleStep(stepNumber, time) {
    const swing = +els.swing.value / 100;
    const humanize = +els.humanize.value / 100;
    const secondsPerBeat = 60 / bpm;
    const sixteenth = secondsPerBeat / STEPS_PER_BEAT;

    let t = time;
    if (stepNumber % 2 === 1) t += swing * sixteenth * 0.5;

    INSTRUMENTS.forEach((inst) => {
      const st = pattern[inst.key][stepNumber];
      if (!st || !st.on) return;
      const humanOffset = (Math.random() * 2 - 1) * humanize * 0.02;
      const humanVel = clamp01(st.vel + (Math.random() * 2 - 1) * humanize * 0.25);
      const fireTime = t + (st.micro || 0) + humanOffset;
      SYNTH[inst.key](Math.max(audioCtx.currentTime, fireTime), humanVel);
    });

    notesInQueue.push({ step: stepNumber, time: t });
  }

  function advanceNote() {
    const secondsPerBeat = 60 / bpm;
    nextNoteTime += 0.25 * secondsPerBeat;
    currentStep++;
    if (currentStep >= totalSteps) {
      currentStep = 0;
      onLoopBoundary();
    }
  }

  function onLoopBoundary() {
    loopsSinceMutation++;
    const interval = +els.mutationInterval.value;
    if (!frozen && loopsSinceMutation >= interval) {
      mutate();
      loopsSinceMutation = 0;
    }
    updateStatus();
  }

  function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
      scheduleStep(currentStep, nextNoteTime);
      advanceNote();
    }
    timerID = setTimeout(scheduler, lookaheadMs);
  }

  // ---- visual playhead loop (reads the note queue against real time) -------

  function visualLoop() {
    if (audioCtx) {
      while (notesInQueue.length && notesInQueue[0].time < audioCtx.currentTime) {
        const note = notesInQueue.shift();
        highlightStep(note.step);
        els.stepInfo.textContent = `${note.step + 1} / ${totalSteps}`;
      }
      drawScopes();
    }
    requestAnimationFrame(visualLoop);
  }
  requestAnimationFrame(visualLoop);

  function drawScopes() {
    if (!analyser) return;
    const waveCtx = els.waveCanvas.getContext("2d");
    const freqCtx = els.freqCanvas.getContext("2d");
    sizeCanvas(els.waveCanvas);
    sizeCanvas(els.freqCanvas);

    const timeData = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeData);
    const w = els.waveCanvas.width, h = els.waveCanvas.height;
    waveCtx.clearRect(0, 0, w, h);
    waveCtx.strokeStyle = "#eae6df";
    waveCtx.lineWidth = 1.5;
    waveCtx.beginPath();
    for (let i = 0; i < timeData.length; i++) {
      const x = (i / timeData.length) * w;
      const y = (timeData[i] / 255) * h;
      if (i === 0) waveCtx.moveTo(x, y); else waveCtx.lineTo(x, y);
    }
    waveCtx.stroke();

    const freqData = new Uint8Array(freqAnalyser.frequencyBinCount);
    freqAnalyser.getByteFrequencyData(freqData);
    const fw = els.freqCanvas.width, fh = els.freqCanvas.height;
    freqCtx.clearRect(0, 0, fw, fh);
    freqCtx.fillStyle = "#eae6df";
    const barW = fw / freqData.length;
    freqData.forEach((v, i) => {
      const barH = (v / 255) * fh;
      freqCtx.fillRect(i * barW, fh - barH, Math.max(1, barW - 1), barH);
    });
  }

  function sizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // ---- transport ------------------------------------------------------------

  function start() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (Object.values(pattern).every((steps) => steps.every((s) => !s.on))) seedPattern();
    running = true;
    currentStep = 0;
    nextNoteTime = audioCtx.currentTime + 0.05;
    notesInQueue = [];
    scheduler();
    els.playBtn.textContent = "停止";
    els.playBtn.classList.add("playing");
  }

  function stop() {
    running = false;
    clearTimeout(timerID);
    notesInQueue = [];
    highlightStep(-1);
    els.playBtn.textContent = "再生";
    els.playBtn.classList.remove("playing");
  }

  els.playBtn.addEventListener("click", () => (running ? stop() : start()));

  els.freezeBtn.addEventListener("click", () => {
    frozen = !frozen;
    els.freezeBtn.textContent = frozen ? "ミューテーション再開" : "ミューテーション停止";
    els.freezeBtn.setAttribute("aria-pressed", String(frozen));
    updateStatus();
  });

  els.reseedBtn.addEventListener("click", () => {
    seedPattern();
  });

  els.tempo.addEventListener("change", () => {
    bpm = Math.min(220, Math.max(60, +els.tempo.value || 160));
    els.tempo.value = bpm;
    updateStatus();
  });

  els.volume.addEventListener("input", () => {
    if (master) master.gain.setTargetAtTime(+els.volume.value / 100, audioCtx.currentTime, 0.02);
  });

  els.loopBeats.addEventListener("change", () => {
    loopBeats = +els.loopBeats.value;
    totalSteps = loopBeats * STEPS_PER_BEAT;
    seedPattern();
  });

  els.mutationInterval.addEventListener("change", updateStatus);
  els.mutation.addEventListener("input", updateStatus);

  // ---- recording --------------------------------------------------------------

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordStart = 0;
  let recordTimer = null;

  function pad(n) { return String(n).padStart(2, "0"); }

  function pickMimeType() {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    return candidates.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  }

  function startRecording() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    recordedChunks = [];
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(recordDest.stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      addRecording(blob);
    };
    mediaRecorder.start();
    recordStart = performance.now();
    els.recordBtn.textContent = "■ 録音停止";
    els.recordBtn.classList.add("recording");
    recordTimer = setInterval(() => {
      const secs = Math.floor((performance.now() - recordStart) / 1000);
      els.recordTime.textContent = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
    }, 250);
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    clearInterval(recordTimer);
    els.recordBtn.textContent = "● 録音";
    els.recordBtn.classList.remove("recording");
    els.recordTime.textContent = "";
  }

  function addRecording(blob) {
    const url = URL.createObjectURL(blob);
    const ts = new Date();
    const ext = (blob.type.includes("ogg")) ? "ogg" : "webm";
    const name = `breaks-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.${ext}`;

    const item = document.createElement("div");
    item.className = "recordingItem";
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = name;
    const audioEl = document.createElement("audio");
    audioEl.controls = true;
    audioEl.src = url;
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.textContent = "ダウンロード";
    item.append(label, audioEl, link);
    els.recordingsList.prepend(item);
  }

  els.recordBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
    else startRecording();
  });

  // ---- init ------------------------------------------------------------------

  renderWordCloud();
  seedPattern();
  updateStatus();
})();
