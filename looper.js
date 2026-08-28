// meguri (巡) — realtime effect looper
//
// Live input is written continuously into a rolling ring buffer (via an
// AudioWorklet, falling back to a ScriptProcessor where worklets aren't
// available). Up to four voices sample short windows out of that ring
// buffer and loop them; each voice's window length, pan and "depth" wander
// on their own slow drift so the same loop never plays back quite the same
// way twice. A voice can also run in "flow" mode, where it keeps
// re-sampling fresh material from the ring buffer on a self-chosen,
// drifting cycle length instead of looping one fixed snapshot forever.
//
// Everything downstream of the voices — pan, depth send, the shared
// feedback-delay pair — is plain AudioParam automation, so the CPU cost
// stays close to "a couple of delay lines", not a granular synth.

(() => {
  const MAX_VOICES = 4;
  const RING_SECONDS = 26; // must comfortably exceed the longest loop
  const VOICE_LETTERS = ["A", "B", "C", "D"];

  // ---- DOM ------------------------------------------------------------

  const el = (id) => document.getElementById(id);

  const startBtn = el("startBtn");
  const deviceSelect = el("deviceSelect");
  const armBtn = el("armBtn");
  const monitorToggle = el("monitorToggle");
  const meterFill = el("meterFill");
  const inputStatus = el("inputStatus");

  const autoSampleToggle = el("autoSampleToggle");
  const autoIntervalSlider = el("autoInterval");
  const autoIntervalLabel = el("autoIntervalLabel");
  const minDurSlider = el("minDur");
  const maxDurSlider = el("maxDur");
  const durRangeLabel = el("durRangeLabel");
  const sampleNowBtn = el("sampleNowBtn");

  const recordBtn = el("recordBtn");
  const recordStatus = el("recordStatus");
  const downloadLink = el("downloadLink");

  const masterVolSlider = el("masterVol");

  const voiceEls = VOICE_LETTERS.map((letter) => ({
    letter,
    root: el(`voice${letter}`),
    active: el(`voice${letter}-active`),
    mode: el(`voice${letter}-mode`),
    reverse: el(`voice${letter}-reverse`),
    speed: el(`voice${letter}-speed`),
    speedLabel: el(`voice${letter}-speedLabel`),
    pan: el(`voice${letter}-pan`),
    depth: el(`voice${letter}-depth`),
    resample: el(`voice${letter}-resample`),
    durLabel: el(`voice${letter}-durLabel`),
  }));

  // ---- smoothed randomness (organic drift, not white noise) ----------

  function makeDrift(min, max, start) {
    let value = start ?? (min + max) / 2;
    let target = value;
    return {
      get value() { return value; },
      retarget() { target = min + Math.random() * (max - min); },
      tick(rate) {
        if (Math.random() < 0.05) target = min + Math.random() * (max - min);
        value += (target - value) * rate;
        return value;
      },
    };
  }

  function randRange(min, max) { return min + Math.random() * (max - min); }

  // ---- audio context + graph ------------------------------------------

  let audioCtx = null;
  let masterGain, compressor, reverbNode, delayA, delayB;
  let inputGain, monitorGain, sourceNode, mediaStream;
  let analyser, meterData;
  let workletSupported = false;

  function buildImpulseResponse(context, duration, decay) {
    const rate = context.sampleRate;
    const length = Math.floor(rate * duration);
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

  async function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = +masterVolSlider.value / 100;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 3.5;
    masterGain.connect(compressor).connect(audioCtx.destination);

    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = buildImpulseResponse(audioCtx, 4.5, 2.6);
    reverbNode.connect(masterGain);

    // the "compound delay" bus: two non-multiple, damped feedback delay
    // lines that every voice can send into via its depth control
    delayA = audioCtx.createDelay(2.5);
    delayA.delayTime.value = 0.372;
    const fbA = audioCtx.createGain();
    fbA.gain.value = 0.4;
    const dampA = audioCtx.createBiquadFilter();
    dampA.type = "lowpass";
    dampA.frequency.value = 2200;
    delayA.connect(dampA).connect(fbA).connect(delayA);
    delayA.connect(masterGain);

    delayB = audioCtx.createDelay(2.5);
    delayB.delayTime.value = 0.551;
    const fbB = audioCtx.createGain();
    fbB.gain.value = 0.35;
    const dampB = audioCtx.createBiquadFilter();
    dampB.type = "lowpass";
    dampB.frequency.value = 1800;
    delayB.connect(dampB).connect(fbB).connect(delayB);
    delayB.connect(masterGain);

    inputGain = audioCtx.createGain();
    inputGain.gain.value = 1.0;

    monitorGain = audioCtx.createGain();
    monitorGain.gain.value = 0;
    inputGain.connect(monitorGain).connect(masterGain);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    meterData = new Uint8Array(analyser.frequencyBinCount);
    inputGain.connect(analyser);

    initRing(audioCtx.sampleRate);

    try {
      await audioCtx.audioWorklet.addModule("ring-capture-processor.js");
      workletSupported = true;
    } catch (err) {
      console.warn("AudioWorklet unavailable, falling back to ScriptProcessor:", err);
      workletSupported = false;
    }

    voices.forEach((v) => buildVoiceChain(v));
    drawMeter();
  }

  // silent sink so tap nodes stay in the render graph across browsers
  function keepAlive(node) {
    const sink = audioCtx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(audioCtx.destination);
    return sink;
  }

  function makeTapNode(onChunk) {
    let node;
    if (workletSupported) {
      node = new AudioWorkletNode(audioCtx, "ring-capture-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 2,
        channelCountMode: "explicit",
      });
      node.port.onmessage = (ev) => onChunk(ev.data.l, ev.data.r);
    } else {
      node = audioCtx.createScriptProcessor(4096, 2, 2);
      node.onaudioprocess = (ev) => {
        const l = ev.inputBuffer.getChannelData(0);
        const r = ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : l;
        onChunk(l.slice(), r.slice());
      };
    }
    // ScriptProcessorNode needs to sit in a path to destination to keep
    // firing in some browsers; a zero-output AudioWorkletNode has no output
    // to route and doesn't need one — it keeps processing as long as its
    // input is connected and the node itself isn't garbage collected.
    if (node.numberOfOutputs > 0) keepAlive(node);
    return node;
  }

  // ---- ring buffer -----------------------------------------------------

  let ringL, ringR, ringLen, ringWritePos = 0, ringSamplesWritten = 0;
  let ringTapNode = null;

  function initRing(sampleRate) {
    ringLen = Math.ceil(RING_SECONDS * sampleRate);
    ringL = new Float32Array(ringLen);
    ringR = new Float32Array(ringLen);
    ringWritePos = 0;
    ringSamplesWritten = 0;
  }

  function writeRingChunk(l, r) {
    const n = l.length;
    for (let i = 0; i < n; i++) {
      ringL[ringWritePos] = l[i];
      ringR[ringWritePos] = r[i];
      ringWritePos = (ringWritePos + 1) % ringLen;
    }
    ringSamplesWritten = Math.min(ringLen, ringSamplesWritten + n);
  }

  function ringSecondsAvailable() {
    return ringSamplesWritten / audioCtx.sampleRate;
  }

  function extractSnapshot(durationSeconds, reverse) {
    const maxN = Math.min(ringSamplesWritten, ringLen - 1);
    const n = Math.max(1, Math.min(Math.round(durationSeconds * audioCtx.sampleRate), maxN));
    const buf = audioCtx.createBuffer(2, n, audioCtx.sampleRate);
    const outL = buf.getChannelData(0);
    const outR = buf.getChannelData(1);
    const start = (ringWritePos - n + ringLen) % ringLen;
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % ringLen;
      outL[i] = ringL[idx];
      outR[i] = ringR[idx];
    }
    if (reverse) {
      outL.reverse();
      outR.reverse();
    }
    return buf;
  }

  // ---- input / recording -----------------------------------------------

  async function listInputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    deviceSelect.innerHTML = "";
    inputs.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `入力 ${i + 1}`;
      deviceSelect.appendChild(opt);
    });
  }

  async function armInput() {
    if (!audioCtx) await initAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const deviceId = deviceSelect.value || undefined;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
        },
      });
    } catch (err) {
      inputStatus.textContent = `入力を開けませんでした: ${err.message}`;
      return;
    }

    if (sourceNode) sourceNode.disconnect();
    if (ringTapNode) ringTapNode.disconnect();

    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    sourceNode.connect(inputGain);

    ringTapNode = makeTapNode(writeRingChunk);
    inputGain.connect(ringTapNode);

    await listInputDevices();
    const track = mediaStream.getAudioTracks()[0];
    inputStatus.textContent = `接続中: ${track.label || "入力デバイス"}`;
    armBtn.textContent = "再接続";
  }

  monitorToggle.addEventListener("change", () => {
    if (!audioCtx) return;
    monitorGain.gain.setTargetAtTime(monitorToggle.checked ? 0.7 : 0, audioCtx.currentTime, 0.05);
  });

  function drawMeter() {
    if (analyser) {
      analyser.getByteTimeDomainData(meterData);
      let peak = 0;
      for (let i = 0; i < meterData.length; i++) {
        peak = Math.max(peak, Math.abs(meterData[i] - 128) / 128);
      }
      meterFill.style.width = `${Math.min(100, peak * 140)}%`;
    }
    requestAnimationFrame(drawMeter);
  }

  // -- internal WAV recorder (records the master bus, not the raw input) --

  let recordTapNode = null;
  let recordChunksL = [];
  let recordChunksR = [];
  let recording = false;

  function onRecordChunk(l, r) {
    if (!recording) return;
    recordChunksL.push(l);
    recordChunksR.push(r);
  }

  function startRecording() {
    if (!audioCtx) return;
    if (!recordTapNode) {
      recordTapNode = makeTapNode(onRecordChunk);
      masterGain.connect(recordTapNode);
    }
    recordChunksL = [];
    recordChunksR = [];
    recording = true;
    recordBtn.textContent = "■ 録音停止";
    recordBtn.classList.add("recording");
    recordStatus.textContent = "録音中…";
  }

  function concatChunks(chunks, total) {
    const out = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  function encodeWAV(left, right, sampleRate) {
    const n = left.length;
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample * 2;
    const dataSize = n * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // stereo
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < n; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
      offset += 2;
      view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function stopRecording() {
    recording = false;
    recordBtn.textContent = "● 録音開始";
    recordBtn.classList.remove("recording");

    const total = recordChunksL.reduce((s, c) => s + c.length, 0);
    if (total === 0) {
      recordStatus.textContent = "録音データがありません";
      return;
    }
    const left = concatChunks(recordChunksL, total);
    const right = concatChunks(recordChunksR, total);
    const blob = encodeWAV(left, right, audioCtx.sampleRate);
    const url = URL.createObjectURL(blob);

    downloadLink.href = url;
    downloadLink.download = `meguri-${Date.now()}.wav`;
    downloadLink.hidden = false;
    downloadLink.textContent = `WAVをダウンロード (${(blob.size / 1e6).toFixed(1)}MB)`;
    const seconds = total / audioCtx.sampleRate;
    recordStatus.textContent = `録音完了: ${seconds.toFixed(1)}秒`;
  }

  recordBtn.addEventListener("click", () => {
    if (!audioCtx) return;
    if (recording) stopRecording(); else startRecording();
  });

  // ---- voices ------------------------------------------------------------

  const voices = VOICE_LETTERS.map((letter, index) => ({
    letter,
    index,
    active: false,
    mode: "fixed", // 'fixed' | 'flow'
    reverse: false,
    speed: 1,
    panAmount: 0,
    depthAmount: 0.3,
    currentSource: null,
    currentGain: null,
    panDrift: makeDrift(-1, 1, 0),
    flowTimer: null,
    currentDuration: 4,
  }));

  function buildVoiceChain(v) {
    v.panNode = audioCtx.createStereoPanner();
    v.depthFilter = audioCtx.createBiquadFilter();
    v.depthFilter.type = "lowpass";
    v.depthFilter.frequency.value = 18000;

    v.dryGain = audioCtx.createGain();
    v.wetGain = audioCtx.createGain();
    v.delaySendGain = audioCtx.createGain();

    v.panNode.connect(v.depthFilter);
    v.depthFilter.connect(v.dryGain).connect(masterGain);
    v.depthFilter.connect(v.wetGain).connect(reverbNode);
    v.depthFilter.connect(v.delaySendGain);
    v.delaySendGain.connect(delayA);
    v.delaySendGain.connect(delayB);

    applyDepth(v);
  }

  function applyDepth(v) {
    const d = v.depthAmount; // 0 near .. 1 far
    const now = audioCtx.currentTime;
    v.depthFilter.frequency.setTargetAtTime(18000 - d * 15500, now, 0.3);
    v.dryGain.gain.setTargetAtTime(1 - d * 0.55, now, 0.3);
    v.wetGain.gain.setTargetAtTime(d * 0.9, now, 0.3);
    v.delaySendGain.gain.setTargetAtTime(d * 0.5, now, 0.3);
  }

  function stopSourceSoon(source, gainNode) {
    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + 0.18);
    try { source.stop(now + 0.2); } catch (e) {}
  }

  function pickDuration() {
    const min = +minDurSlider.value;
    const max = +maxDurSlider.value;
    return randRange(Math.min(min, max), Math.max(min, max));
  }

  function triggerVoice(v, durationOverride) {
    if (!audioCtx || ringSecondsAvailable() < 0.5) return;

    const duration = Math.min(durationOverride ?? pickDuration(), ringSecondsAvailable());
    v.currentDuration = duration;
    if (v.durLabel) v.durLabel.textContent = `${duration.toFixed(1)}s`;

    const buffer = extractSnapshot(duration, v.reverse);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = v.mode === "fixed";
    source.playbackRate.value = v.speed;

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0;
    source.connect(gainNode).connect(v.panNode);

    const now = audioCtx.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + 0.15);

    source.start(now);

    if (v.currentSource) stopSourceSoon(v.currentSource, v.currentGain);
    v.currentSource = source;
    v.currentGain = gainNode;

    if (v.mode === "flow") {
      source.onended = null;
      scheduleFlow(v, duration);
    }

    spawnParticle(v);
  }

  function scheduleFlow(v, justPlayedDuration) {
    clearTimeout(v.flowTimer);
    if (!v.active || v.mode !== "flow") return;
    const nextDuration = pickDuration();
    v.flowTimer = setTimeout(() => {
      if (v.active && v.mode === "flow") triggerVoice(v, nextDuration);
    }, Math.max(300, justPlayedDuration * 1000 * 0.92));
  }

  function setVoiceActive(v, active) {
    v.active = active;
    if (active) {
      triggerVoice(v);
    } else {
      clearTimeout(v.flowTimer);
      if (v.currentSource) {
        stopSourceSoon(v.currentSource, v.currentGain);
        v.currentSource = null;
      }
    }
  }

  // slow pan drift, ticked from the same loop as the meter/canvas
  function updateVoiceDrift() {
    if (!audioCtx) return;
    voices.forEach((v) => {
      if (!v.active || v.panAmount <= 0) return;
      const drift = v.panDrift.tick(0.01);
      v.panNode.pan.setTargetAtTime(drift * v.panAmount, audioCtx.currentTime, 0.4);
    });
  }
  setInterval(updateVoiceDrift, 120);

  // ---- auto-sample (global) ---------------------------------------------

  let autoSampleTimer = null;

  function autoSampleTick() {
    if (!autoSampleToggle.checked) return;
    voices.forEach((v) => {
      if (v.active && v.mode === "fixed") triggerVoice(v);
    });
    scheduleAutoSample();
  }

  function scheduleAutoSample() {
    clearTimeout(autoSampleTimer);
    if (!autoSampleToggle.checked) return;
    const seconds = +autoIntervalSlider.value;
    autoSampleTimer = setTimeout(autoSampleTick, seconds * 1000);
  }

  autoSampleToggle.addEventListener("change", () => {
    if (autoSampleToggle.checked) scheduleAutoSample();
    else clearTimeout(autoSampleTimer);
  });

  autoIntervalSlider.addEventListener("input", () => {
    autoIntervalLabel.textContent = `${autoIntervalSlider.value}s`;
    if (autoSampleToggle.checked) scheduleAutoSample();
  });

  [minDurSlider, maxDurSlider].forEach((s) => {
    s.addEventListener("input", () => {
      durRangeLabel.textContent = `${minDurSlider.value}s – ${maxDurSlider.value}s`;
    });
  });

  sampleNowBtn.addEventListener("click", () => {
    voices.forEach((v) => { if (v.active) triggerVoice(v); });
  });

  // ---- voice UI wiring ----------------------------------------------------

  voiceEls.forEach((ui, i) => {
    const v = voices[i];
    v.durLabel = ui.durLabel;

    ui.active.addEventListener("change", () => setVoiceActive(v, ui.active.checked));

    ui.mode.addEventListener("change", () => {
      v.mode = ui.mode.value;
      ui.root.classList.toggle("flow", v.mode === "flow");
      if (v.active) triggerVoice(v);
    });

    ui.reverse.addEventListener("change", () => {
      v.reverse = ui.reverse.checked;
      if (v.active) triggerVoice(v, v.currentDuration);
    });

    ui.speed.addEventListener("input", () => {
      v.speed = +ui.speed.value / 100;
      ui.speedLabel.textContent = `${v.speed.toFixed(2)}x`;
      if (v.currentSource) {
        v.currentSource.playbackRate.setTargetAtTime(v.speed, audioCtx.currentTime, 0.05);
      }
    });

    ui.pan.addEventListener("input", () => {
      v.panAmount = +ui.pan.value / 100;
    });

    ui.depth.addEventListener("input", () => {
      v.depthAmount = +ui.depth.value / 100;
      if (audioCtx) applyDepth(v);
    });

    ui.resample.addEventListener("click", () => triggerVoice(v));
  });

  // ---- transport / master --------------------------------------------

  masterVolSlider.addEventListener("input", () => {
    if (audioCtx) {
      masterGain.gain.setTargetAtTime(+masterVolSlider.value / 100, audioCtx.currentTime, 0.05);
    }
  });

  startBtn.addEventListener("click", async () => {
    if (!audioCtx) await initAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    startBtn.textContent = "オーディオ起動中";
    startBtn.disabled = true;
  });

  armBtn.addEventListener("click", armInput);

  navigator.mediaDevices?.addEventListener?.("devicechange", () => {
    if (audioCtx) listInputDevices();
  });

  // populate the device list up front so labels appear once permission
  // has already been granted in an earlier visit
  if (navigator.mediaDevices?.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      devices.filter((d) => d.kind === "audioinput").forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `入力 ${i + 1}`;
        deviceSelect.appendChild(opt);
      });
    });
  }

  // ---- background visual: quiet drifting field tied to voice triggers --

  const canvas = el("bg");
  const ctx2d = canvas.getContext("2d");
  let particles = [];
  let hue = 200;

  function resizeCanvas() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx2d.fillStyle = `hsla(${hue}, 25%, 4%, 0.16)`;
    ctx2d.fillRect(0, 0, w, h);

    particles.forEach((p) => {
      p.life += 1 / 60;
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      const t = p.life / p.maxLife;
      const alpha = Math.max(0, 1 - t) * 0.45;
      const r = p.r * (1 + t * 6);
      const grad = ctx2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `hsla(${p.hue}, 55%, 72%, ${alpha})`);
      grad.addColorStop(1, `hsla(${p.hue}, 55%, 72%, 0)`);
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx2d.fill();
    });
    particles = particles.filter((p) => p.life < p.maxLife);

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  const voiceHues = [200, 320, 60, 150];

  function spawnParticle(v) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    particles.push({
      x: w * (0.2 + 0.6 * (v.index / (MAX_VOICES - 1))),
      y: h * 0.5 + (Math.random() - 0.5) * h * 0.2,
      r: 5 * devicePixelRatio,
      life: 0,
      maxLife: Math.max(1.2, Math.min(4, v.currentDuration)),
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      hue: voiceHues[v.index] ?? 200,
    });
    if (particles.length > 100) particles.shift();
  }
})();
