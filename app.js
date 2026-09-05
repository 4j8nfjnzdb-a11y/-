// VOICE MORPH STUDIO — record your voice, morph it (pitch / formant /
// robot / bitcrush / chorus / reverb / delay / EQ) with mixer-style
// faders, ride tempo with a pitch-locked speed control + metronome,
// and export the processed result as a WAV file.

(() => {
  // ---------------------------------------------------------------
  // fader / preset definitions
  // ---------------------------------------------------------------

  const FADERS = [
    { id: "pitch", label: "PITCH", min: -12, max: 12, step: 1, def: 0, unit: "st", hue: "#35e6ff" },
    { id: "formant", label: "FORMANT", min: -100, max: 100, step: 1, def: 0, unit: "%", hue: "#ff2fd0" },
    { id: "robot", label: "ROBOT", min: 0, max: 100, step: 1, def: 0, unit: "%", hue: "#b6ff35" },
    { id: "bitcrush", label: "CRUSH", min: 0, max: 100, step: 1, def: 0, unit: "%", hue: "#ffd93b" },
    { id: "chorus", label: "CHORUS", min: 0, max: 100, step: 1, def: 0, unit: "%", hue: "#ff2fd0" },
    { id: "reverb", label: "REVERB", min: 0, max: 100, step: 1, def: 20, unit: "%", hue: "#35e6ff" },
    { id: "delay", label: "DELAY", min: 0, max: 100, step: 1, def: 0, unit: "%", hue: "#b6ff35" },
    { id: "master", label: "MASTER", min: 0, max: 100, step: 1, def: 80, unit: "%", hue: "#f4f0ff" },
  ];

  const ADVANCED = [
    { id: "reverbSize", label: "リバーブサイズ", min: 0, max: 100, step: 1, def: 35 },
    { id: "delayTime", label: "ディレイタイム(ms)", min: 20, max: 800, step: 10, def: 300 },
    { id: "delayFeedback", label: "ディレイ・フィードバック", min: 0, max: 85, step: 1, def: 25 },
    { id: "chorusRate", label: "コーラス速度(Hz)", min: 0.1, max: 5, step: 0.1, def: 1.2 },
    { id: "chorusDepth", label: "コーラス深さ", min: 0, max: 100, step: 1, def: 50 },
    { id: "eqLow", label: "EQ 低音(dB)", min: -20, max: 20, step: 1, def: 0 },
    { id: "eqMid", label: "EQ 中音(dB)", min: -20, max: 20, step: 1, def: 0 },
    { id: "eqHigh", label: "EQ 高音(dB)", min: -20, max: 20, step: 1, def: 0 },
  ];

  const PRESETS = [
    { id: "normal", name: "ノーマル", desc: "素の声", vals: { pitch: 0, formant: 0, robot: 0, bitcrush: 0, chorus: 0, reverb: 15, delay: 0 } },
    { id: "robot", name: "ロボット", desc: "金属質な機械声", vals: { pitch: 0, formant: -20, robot: 70, bitcrush: 35, chorus: 0, reverb: 20, delay: 15 } },
    { id: "female", name: "女性声", desc: "高めで明るい声", vals: { pitch: 6, formant: 35, robot: 0, bitcrush: 0, chorus: 20, reverb: 20, delay: 5 } },
    { id: "male", name: "男性声・低音", desc: "低く太い声", vals: { pitch: -6, formant: -35, robot: 0, bitcrush: 0, chorus: 0, reverb: 15, delay: 0 } },
    { id: "vocaloid", name: "ボカロ風", desc: "透明感のある合成声", vals: { pitch: 4, formant: 20, robot: 15, bitcrush: 10, chorus: 45, reverb: 30, delay: 20 } },
    { id: "chipmunk", name: "チップマンク", desc: "リスのような高音", vals: { pitch: 12, formant: 40, robot: 0, bitcrush: 0, chorus: 10, reverb: 10, delay: 0 } },
    { id: "darklord", name: "ダークヴォイス", desc: "深く不穏な低音", vals: { pitch: -12, formant: -50, robot: 10, bitcrush: 5, chorus: 0, reverb: 45, delay: 25 } },
    { id: "hall", name: "コンサートホール", desc: "広い残響空間", vals: { pitch: 0, formant: 0, robot: 0, bitcrush: 0, chorus: 10, reverb: 60, delay: 30 } },
    { id: "glitch", name: "グリッチ", desc: "壊れたデジタル質感", vals: { pitch: -2, formant: -10, robot: 55, bitcrush: 60, chorus: 0, reverb: 15, delay: 40 } },
  ];

  const params = {};
  FADERS.forEach((f) => (params[f.id] = f.def));
  ADVANCED.forEach((f) => (params[f.id] = f.def));

  // ---------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------

  const recBtn = document.getElementById("recBtn");
  const monitorToggle = document.getElementById("monitorToggle");
  const recStatus = document.getElementById("recStatus");
  const takeList = document.getElementById("takeList");
  const playBtn = document.getElementById("playBtn");
  const loopBtn = document.getElementById("loopBtn");
  const exportBtn = document.getElementById("exportBtn");
  const downloadRawBtn = document.getElementById("downloadRawBtn");
  const presetGrid = document.getElementById("presetGrid");
  const faderRack = document.getElementById("faderRack");
  const advancedGrid = document.getElementById("advancedGrid");
  const scopeCanvas = document.getElementById("scope");
  const scopeCtx = scopeCanvas.getContext("2d");
  const speedSlider = document.getElementById("speedSlider");
  const speedVal = document.getElementById("speedVal");
  const pitchLockToggle = document.getElementById("pitchLockToggle");
  const bpmSlider = document.getElementById("bpmSlider");
  const bpmVal = document.getElementById("bpmVal");
  const metroBtn = document.getElementById("metroBtn");
  const tapBtn = document.getElementById("tapBtn");

  function setStatus(text) {
    recStatus.textContent = text;
  }

  // ---------------------------------------------------------------
  // audio graph — one chain shared by monitor-through and playback
  // ---------------------------------------------------------------

  let audioCtx = null;
  let workletReady = null;
  let liveChain = null;
  let scopeAnalyser = null;

  function buildImpulseResponse(ctx, duration, decay) {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * duration));
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

  function makeBitcrushCurve(amount) {
    const bits = 16 - Math.round((amount / 100) * 13);
    const levels = Math.pow(2, bits);
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    return curve;
  }

  // Builds the full effect chain on a given context (works for both the
  // live AudioContext and a throwaway OfflineAudioContext used for export).
  function buildChain(ctx) {
    const input = ctx.createGain();

    const formantFilter = ctx.createBiquadFilter();
    formantFilter.type = "peaking";
    formantFilter.frequency.value = 2500;
    formantFilter.Q.value = 0.7;

    const pitchNode = new AudioWorkletNode(ctx, "pitch-shift-processor");

    // --- robot (ring modulation) ---
    const ringCarrier = ctx.createOscillator();
    ringCarrier.type = "sine";
    ringCarrier.frequency.value = 55;
    const ringGain = ctx.createGain();
    ringGain.gain.value = 0; // driven entirely by the carrier -> pure multiply
    ringCarrier.connect(ringGain.gain);
    const robotDry = ctx.createGain();
    const robotWet = ctx.createGain();
    const robotMix = ctx.createGain();

    // --- bitcrush (waveshaper quantizer) ---
    const waveshaper = ctx.createWaveShaper();
    waveshaper.curve = makeBitcrushCurve(0);
    const bitDry = ctx.createGain();
    const bitWet = ctx.createGain();
    const bitMix = ctx.createGain();

    // --- chorus (two modulated delay lines) ---
    const chorusDelay1 = ctx.createDelay(0.05);
    const chorusDelay2 = ctx.createDelay(0.05);
    chorusDelay1.delayTime.value = 0.02;
    chorusDelay2.delayTime.value = 0.025;
    const chorusLFO1 = ctx.createOscillator();
    const chorusLFO2 = ctx.createOscillator();
    chorusLFO1.type = "sine";
    chorusLFO2.type = "sine";
    chorusLFO1.frequency.value = 1.2;
    chorusLFO2.frequency.value = 1.5;
    const chorusDepth1 = ctx.createGain();
    const chorusDepth2 = ctx.createGain();
    chorusDepth1.gain.value = 0.003;
    chorusDepth2.gain.value = 0.003;
    chorusLFO1.connect(chorusDepth1).connect(chorusDelay1.delayTime);
    chorusLFO2.connect(chorusDepth2).connect(chorusDelay2.delayTime);
    const chorusWet1 = ctx.createGain();
    const chorusWet2 = ctx.createGain();
    const chorusMixBus = ctx.createGain();

    // --- eq ---
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = "lowshelf";
    eqLow.frequency.value = 250;
    const eqMid = ctx.createBiquadFilter();
    eqMid.type = "peaking";
    eqMid.frequency.value = 1200;
    eqMid.Q.value = 0.8;
    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = "highshelf";
    eqHigh.frequency.value = 3200;

    // --- reverb + delay sends ---
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1;

    const reverbSend = ctx.createGain();
    const reverbConvolver = ctx.createConvolver();
    reverbConvolver.buffer = buildImpulseResponse(ctx, 2.4, 2.5);
    const reverbWet = ctx.createGain();

    const delaySend = ctx.createGain();
    const delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.3;
    const delayFeedbackGain = ctx.createGain();
    delayFeedbackGain.gain.value = 0.25;
    const delayDamp = ctx.createBiquadFilter();
    delayDamp.type = "lowpass";
    delayDamp.frequency.value = 3000;
    delayNode.connect(delayDamp).connect(delayFeedbackGain).connect(delayNode);
    const delayWet = ctx.createGain();

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.8;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 4;

    const output = limiter;

    // --- wiring ---
    input.connect(formantFilter).connect(pitchNode);

    pitchNode.connect(robotDry).connect(robotMix);
    pitchNode.connect(ringGain).connect(robotWet).connect(robotMix);

    robotMix.connect(bitDry).connect(bitMix);
    robotMix.connect(waveshaper).connect(bitWet).connect(bitMix);

    bitMix.connect(chorusMixBus); // dry chorus path
    bitMix.connect(chorusDelay1).connect(chorusWet1).connect(chorusMixBus);
    bitMix.connect(chorusDelay2).connect(chorusWet2).connect(chorusMixBus);

    chorusMixBus.connect(eqLow).connect(eqMid).connect(eqHigh);

    eqHigh.connect(dryGain).connect(masterGain);
    eqHigh.connect(reverbSend).connect(reverbConvolver).connect(reverbWet).connect(masterGain);
    eqHigh.connect(delaySend).connect(delayNode).connect(delayWet).connect(masterGain);

    masterGain.connect(limiter);

    const refs = {
      input, output, formantFilter, pitchNode, ringCarrier, ringGain,
      robotDry, robotWet, waveshaper, bitDry, bitWet,
      chorusLFO1, chorusLFO2, chorusWet1, chorusWet2,
      eqLow, eqMid, eqHigh, dryGain, reverbSend, reverbConvolver, reverbWet,
      delaySend, delayNode, delayFeedbackGain, delayWet, masterGain,
    };

    let started = false;
    function start() {
      if (started) return;
      started = true;
      ringCarrier.start();
      chorusLFO1.start();
      chorusLFO2.start();
    }

    let reverbDuration = 2.4;

    function applyParams(p, opts) {
      const live = !!(opts && opts.live);
      const set = (audioParam, value) => {
        if (live) audioParam.setTargetAtTime(value, ctx.currentTime, 0.02);
        else audioParam.setValueAtTime(value, ctx.currentTime);
      };

      set(formantFilter.gain, (p.formant / 100) * 15);

      const robotAmt = p.robot / 100;
      set(robotDry.gain, 1 - robotAmt);
      set(robotWet.gain, robotAmt);

      const bitAmt = p.bitcrush / 100;
      waveshaper.curve = makeBitcrushCurve(p.bitcrush);
      set(bitDry.gain, 1 - bitAmt);
      set(bitWet.gain, bitAmt);

      const chorusAmt = (p.chorus / 100) * 0.5;
      set(chorusWet1.gain, chorusAmt);
      set(chorusWet2.gain, chorusAmt);
      const depth = (p.chorusDepth / 100) * 0.006;
      chorusDepth1.gain.value = depth;
      chorusDepth2.gain.value = depth * 1.15;
      chorusLFO1.frequency.value = p.chorusRate;
      chorusLFO2.frequency.value = p.chorusRate * 1.25;

      set(eqLow.gain, (p.eqLow || 0));
      set(eqMid.gain, (p.eqMid || 0));
      set(eqHigh.gain, (p.eqHigh || 0));

      set(reverbSend.gain, p.reverb / 100);
      set(reverbWet.gain, 1);
      const wantedDuration = 0.6 + (p.reverbSize / 100) * 4;
      if (Math.abs(wantedDuration - reverbDuration) > 0.15) {
        reverbDuration = wantedDuration;
        reverbConvolver.buffer = buildImpulseResponse(ctx, reverbDuration, 2 + (p.reverbSize / 100) * 2);
      }

      set(delaySend.gain, p.delay / 100);
      set(delayWet.gain, 1);
      set(delayNode.delayTime, p.delayTime / 1000);
      set(delayFeedbackGain.gain, Math.min(0.9, p.delayFeedback / 100));

      set(masterGain.gain, p.master / 100);

      const semitoneRatio = Math.pow(2, p.pitch / 12);
      const speed = (p.speed || 100) / 100;
      const pitchRatio = p.pitchLock ? semitoneRatio / speed : semitoneRatio;
      const ratioParam = pitchNode.parameters.get("pitchRatio");
      if (live) ratioParam.setTargetAtTime(pitchRatio, ctx.currentTime, 0.02);
      else ratioParam.setValueAtTime(pitchRatio, ctx.currentTime);
    }

    return { input, output, refs, start, applyParams };
  }

  function getParamsSnapshot() {
    return Object.assign({}, params, {
      speed: +speedSlider.value,
      pitchLock: pitchLockToggle.checked,
    });
  }

  async function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    workletReady = audioCtx.audioWorklet.addModule("pitch-processor.js");
    await workletReady;
    liveChain = buildChain(audioCtx);
    liveChain.start();
    liveChain.applyParams(getParamsSnapshot(), { live: true });

    scopeAnalyser = audioCtx.createAnalyser();
    scopeAnalyser.fftSize = 1024;
    liveChain.output.connect(scopeAnalyser);
    liveChain.output.connect(audioCtx.destination);
  }

  function updateLiveParams() {
    if (!liveChain) return;
    liveChain.applyParams(getParamsSnapshot(), { live: true });
  }

  // ---------------------------------------------------------------
  // build UI: faders, presets, advanced sliders
  // ---------------------------------------------------------------

  function fmtValue(f, v) {
    if (f.id === "pitch") return (v > 0 ? "+" : "") + v + f.unit;
    return v + (f.unit || "");
  }

  FADERS.forEach((f) => {
    const wrap = document.createElement("div");
    wrap.className = "fader";
    wrap.style.setProperty("--fader-hue", f.hue);

    const label = document.createElement("span");
    label.className = "faderLabel";
    label.textContent = f.label;

    const valueEl = document.createElement("span");
    valueEl.className = "faderValue";
    valueEl.textContent = fmtValue(f, f.def);

    const sliderWrap = document.createElement("div");
    sliderWrap.className = "vslider-wrap";

    const input = document.createElement("input");
    input.type = "range";
    input.className = "vslider";
    input.min = f.min;
    input.max = f.max;
    input.step = f.step;
    input.value = f.def;
    input.id = "fader-" + f.id;

    input.addEventListener("input", () => {
      params[f.id] = +input.value;
      valueEl.textContent = fmtValue(f, +input.value);
      updateLiveParams();
      clearActivePreset();
    });

    sliderWrap.appendChild(input);
    wrap.appendChild(label);
    wrap.appendChild(sliderWrap);
    wrap.appendChild(valueEl);
    faderRack.appendChild(wrap);
  });

  ADVANCED.forEach((f) => {
    const wrap = document.createElement("label");
    wrap.className = "miniSlider";

    const top = document.createElement("span");
    top.innerHTML = f.label + ' <em id="advVal-' + f.id + '">' + f.def + "</em>";

    const input = document.createElement("input");
    input.type = "range";
    input.min = f.min;
    input.max = f.max;
    input.step = f.step;
    input.value = f.def;

    input.addEventListener("input", () => {
      params[f.id] = +input.value;
      document.getElementById("advVal-" + f.id).textContent = input.value;
      updateLiveParams();
    });

    wrap.appendChild(top);
    wrap.appendChild(input);
    advancedGrid.appendChild(wrap);
  });

  function clearActivePreset() {
    presetGrid.querySelectorAll(".presetBtn").forEach((b) => b.classList.remove("active"));
  }

  function applyPreset(preset) {
    Object.entries(preset.vals).forEach(([id, v]) => {
      params[id] = v;
      const el = document.getElementById("fader-" + id);
      if (el) el.value = v;
      const f = FADERS.find((x) => x.id === id);
      const valueEl = el ? el.closest(".fader").querySelector(".faderValue") : null;
      if (valueEl && f) valueEl.textContent = fmtValue(f, v);
    });
    updateLiveParams();
    clearActivePreset();
    const btn = presetGrid.querySelector(`[data-preset="${preset.id}"]`);
    if (btn) btn.classList.add("active");
  }

  PRESETS.forEach((preset) => {
    const btn = document.createElement("button");
    btn.className = "presetBtn";
    btn.dataset.preset = preset.id;
    btn.innerHTML = `<strong>${preset.name}</strong><small>${preset.desc}</small>`;
    btn.addEventListener("click", () => applyPreset(preset));
    presetGrid.appendChild(btn);
  });
  document.querySelector(`[data-preset="normal"]`).classList.add("active");

  // ---------------------------------------------------------------
  // recorder
  // ---------------------------------------------------------------

  let micStream = null;
  let micSource = null;
  let mediaRecorder = null;
  let chunks = [];
  let recording = false;
  let takes = [];
  let takeCounter = 0;
  let currentTake = null;

  async function toggleRecord() {
    if (recording) {
      mediaRecorder.stop();
      return;
    }
    try {
      await ensureAudio();
      if (audioCtx.state === "suspended") await audioCtx.resume();

      if (!micStream) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        micSource = audioCtx.createMediaStreamSource(micStream);
      }

      micSource.connect(scopeAnalyser);
      if (monitorToggle.checked) micSource.connect(liveChain.input);

      chunks = [];
      mediaRecorder = new MediaRecorder(micStream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = onRecordingStop;
      mediaRecorder.start();

      recording = true;
      recBtn.classList.add("recording");
      recBtn.lastChild.textContent = " 停止";
      setStatus("録音中… もう一度押すと停止します。");
    } catch (err) {
      setStatus("マイクを使用できませんでした: " + err.message);
    }
  }

  async function onRecordingStop() {
    recording = false;
    recBtn.classList.remove("recording");
    recBtn.lastChild.textContent = " 録音";
    setStatus("処理中…");

    try {
      micSource.disconnect(scopeAnalyser);
      if (monitorToggle.checked) micSource.disconnect(liveChain.input);
    } catch (e) {}

    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
    const arrayBuf = await blob.arrayBuffer();
    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
    } catch (e) {
      setStatus("録音のデコードに失敗しました。もう一度お試しください。");
      return;
    }

    takeCounter += 1;
    const take = {
      id: takeCounter,
      name: `テイク ${takeCounter}`,
      buffer: audioBuffer,
      blobUrl: URL.createObjectURL(blob),
    };
    takes.push(take);
    renderTakeList();
    selectTake(take);
    setStatus(`録音完了！（${audioBuffer.duration.toFixed(1)}秒） プリセットやフェーダーで声を変えてみましょう。`);
  }

  function renderTakeList() {
    takeList.innerHTML = "";
    takes.forEach((t) => {
      const li = document.createElement("li");
      li.className = "takeItem" + (currentTake === t ? " selected" : "");

      const name = document.createElement("span");
      name.className = "takeName";
      name.textContent = `${t.name} (${t.buffer.duration.toFixed(1)}秒)`;
      name.addEventListener("click", () => selectTake(t));

      const delBtn = document.createElement("button");
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", () => deleteTake(t));

      li.appendChild(name);
      li.appendChild(delBtn);
      takeList.appendChild(li);
    });
  }

  function selectTake(t) {
    currentTake = t;
    renderTakeList();
    playBtn.disabled = false;
    loopBtn.disabled = false;
    exportBtn.disabled = false;
    downloadRawBtn.disabled = false;
  }

  function deleteTake(t) {
    takes = takes.filter((x) => x !== t);
    if (currentTake === t) {
      currentTake = takes[takes.length - 1] || null;
      const hasTake = !!currentTake;
      playBtn.disabled = loopBtn.disabled = exportBtn.disabled = downloadRawBtn.disabled = !hasTake;
    }
    renderTakeList();
  }

  recBtn.addEventListener("click", toggleRecord);

  downloadRawBtn.addEventListener("click", () => {
    if (!currentTake) return;
    const a = document.createElement("a");
    a.href = currentTake.blobUrl;
    a.download = `${currentTake.name}_raw.webm`;
    a.click();
  });

  // ---------------------------------------------------------------
  // playback (through the live effect chain)
  // ---------------------------------------------------------------

  let playingSource = null;
  let looping = false;

  loopBtn.addEventListener("click", () => {
    looping = !looping;
    loopBtn.classList.toggle("active", looping);
  });

  playBtn.addEventListener("click", async () => {
    if (playingSource) {
      stopPlayback();
      return;
    }
    if (!currentTake) return;
    await ensureAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const src = audioCtx.createBufferSource();
    src.buffer = currentTake.buffer;
    src.loop = looping;
    src.playbackRate.value = +speedSlider.value / 100;
    src.connect(liveChain.input);
    src.onended = () => {
      if (playingSource === src) stopPlayback();
    };
    src.start();
    playingSource = src;
    playBtn.textContent = "⏹ 停止";
  });

  function stopPlayback() {
    if (playingSource) {
      try {
        playingSource.stop();
      } catch (e) {}
      try {
        playingSource.disconnect();
      } catch (e) {}
    }
    playingSource = null;
    playBtn.textContent = "▶ エフェクト再生";
  }

  // ---------------------------------------------------------------
  // export to WAV (offline render through a fresh copy of the chain)
  // ---------------------------------------------------------------

  function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numFrames = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const bufferLength = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const channelData = [];
    for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));

    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  exportBtn.addEventListener("click", async () => {
    if (!currentTake) return;
    exportBtn.disabled = true;
    setStatus("書き出し中…（数秒お待ちください）");
    try {
      const speed = +speedSlider.value / 100;
      const tailSeconds = 3;
      const duration = currentTake.buffer.duration / speed + tailSeconds;
      const sampleRate = audioCtx ? audioCtx.sampleRate : 44100;
      const offlineCtx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
      await offlineCtx.audioWorklet.addModule("pitch-processor.js");

      const chain = buildChain(offlineCtx);
      chain.start();
      chain.applyParams(getParamsSnapshot(), { live: false });
      chain.output.connect(offlineCtx.destination);

      const src = offlineCtx.createBufferSource();
      src.buffer = currentTake.buffer;
      src.playbackRate.value = speed;
      src.connect(chain.input);
      src.start();

      const rendered = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(rendered);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentTake.name}_morph.wav`;
      a.click();
      setStatus("書き出し完了！ダウンロードを確認してください。");
    } catch (err) {
      setStatus("書き出しに失敗しました: " + err.message);
    } finally {
      exportBtn.disabled = false;
    }
  });

  // ---------------------------------------------------------------
  // tempo / speed / pitch-lock
  // ---------------------------------------------------------------

  speedSlider.addEventListener("input", () => {
    speedVal.textContent = speedSlider.value + "%";
    if (playingSource) playingSource.playbackRate.value = +speedSlider.value / 100;
    updateLiveParams();
  });

  pitchLockToggle.addEventListener("change", updateLiveParams);

  // ---------------------------------------------------------------
  // metronome
  // ---------------------------------------------------------------

  let metroRunning = false;
  let metroTimer = null;
  let nextClickTime = 0;
  let beatCount = 0;

  function scheduleClick(time, accent) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  function metroLoop() {
    if (!metroRunning) return;
    const lookahead = 0.15;
    const bpm = +bpmSlider.value;
    const secondsPerBeat = 60 / bpm;
    while (nextClickTime < audioCtx.currentTime + lookahead) {
      scheduleClick(nextClickTime, beatCount % 4 === 0);
      beatCount += 1;
      nextClickTime += secondsPerBeat;
    }
    metroTimer = setTimeout(metroLoop, 30);
  }

  metroBtn.addEventListener("click", async () => {
    if (metroRunning) {
      metroRunning = false;
      clearTimeout(metroTimer);
      metroBtn.textContent = "▶ メトロノーム開始";
      metroBtn.classList.remove("active");
      return;
    }
    await ensureAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    metroRunning = true;
    beatCount = 0;
    nextClickTime = audioCtx.currentTime + 0.1;
    metroBtn.textContent = "⏹ メトロノーム停止";
    metroBtn.classList.add("active");
    metroLoop();
  });

  bpmSlider.addEventListener("input", () => {
    bpmVal.textContent = bpmSlider.value;
  });

  let tapTimes = [];
  tapBtn.addEventListener("click", () => {
    const now = performance.now();
    if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length > 8) tapTimes.shift();
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avg);
      if (bpm >= 40 && bpm <= 240) {
        bpmSlider.value = bpm;
        bpmVal.textContent = bpm;
      }
    }
  });

  // ---------------------------------------------------------------
  // oscilloscope visualizer
  // ---------------------------------------------------------------

  function resizeScope() {
    scopeCanvas.width = scopeCanvas.clientWidth * devicePixelRatio;
    scopeCanvas.height = scopeCanvas.clientHeight * devicePixelRatio;
  }
  window.addEventListener("resize", resizeScope);
  resizeScope();

  const scopeData = new Uint8Array(1024);

  function drawScope() {
    requestAnimationFrame(drawScope);
    const w = scopeCanvas.width;
    const h = scopeCanvas.height;
    scopeCtx.fillStyle = "rgba(3, 2, 8, 0.35)";
    scopeCtx.fillRect(0, 0, w, h);

    if (!scopeAnalyser) return;
    scopeAnalyser.getByteTimeDomainData(scopeData);

    scopeCtx.lineWidth = 2 * devicePixelRatio;
    scopeCtx.strokeStyle = "#35e6ff";
    scopeCtx.shadowColor = "#35e6ff";
    scopeCtx.shadowBlur = 12;
    scopeCtx.beginPath();
    const step = w / scopeData.length;
    for (let i = 0; i < scopeData.length; i++) {
      const v = scopeData[i] / 128 - 1;
      const y = h / 2 + v * h * 0.42;
      const x = i * step;
      if (i === 0) scopeCtx.moveTo(x, y);
      else scopeCtx.lineTo(x, y);
    }
    scopeCtx.stroke();
    scopeCtx.shadowBlur = 0;
  }
  requestAnimationFrame(drawScope);
})();
