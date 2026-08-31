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
  const bgAnimToggle = el("bgAnimToggle");

  const voiceEls = VOICE_LETTERS.map((letter) => ({
    letter,
    root: el(`voice${letter}`),
    active: el(`voice${letter}-active`),
    mode: el(`voice${letter}-mode`),
    reverse: el(`voice${letter}-reverse`),
    pitchRandom: el(`voice${letter}-pitchRandom`),
    locked: el(`voice${letter}-locked`),
    speed: el(`voice${letter}-speed`),
    speedLabel: el(`voice${letter}-speedLabel`),
    speedHalf: el(`voice${letter}-speedHalf`),
    speedDouble: el(`voice${letter}-speedDouble`),
    level: el(`voice${letter}-level`),
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
      // jump both value and target to v — used when something else (a new
      // grain) wants to re-place this drift immediately instead of it
      // wandering back from wherever it happened to be
      set(v) { value = v; target = v; },
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
  let masterGain, compressor, limiter, reverbNode, delayA, delayB;
  let inputGain, monitorGain, sourceNode, mediaStream;
  let analyser, meterData;
  let workletSupported = false;

  // a tanh soft-clip curve: approaches but mathematically never exceeds
  // +/-1, so whatever the compressor lets through on a transient pile-up
  // (four voices re-triggering close together, plus reverb/delay tails)
  // still can't produce a hard digital clip
  function buildSoftClipCurve(amount, samples) {
    const curve = new Float32Array(samples);
    const norm = Math.tanh(amount);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1;
      curve[i] = Math.tanh(amount * x) / norm;
    }
    return curve;
  }

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
    // "playback" latency hint trades a bit of extra output delay for a
    // much larger hardware buffer, which is what actually matters for
    // avoiding crackling — this is an ambient/generative effect, not a
    // low-latency performance monitor, so the tradeoff is free
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "playback" });

    masterGain = audioCtx.createGain();
    masterGain.gain.value = +masterVolSlider.value / 100;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.2;

    limiter = audioCtx.createWaveShaper();
    limiter.curve = buildSoftClipCurve(2.2, 2048);
    limiter.oversample = "4x";

    masterGain.connect(compressor).connect(limiter).connect(audioCtx.destination);

    reverbNode = audioCtx.createConvolver();
    // convolution cost scales directly with impulse-response length; 4.5s
    // was audibly nice but heavier than this app needs — this still reads
    // as a real room/space, at well under half the CPU cost
    reverbNode.buffer = buildImpulseResponse(audioCtx, 2.0, 2.6);
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

  // bulk TypedArray.set() copies instead of a per-sample loop — with loops
  // up to 30s long this used to be a multi-million-iteration JS loop right
  // on the main thread at every re-trigger, which is exactly what produces
  // audible crackling: it blocks whatever else is due to run (including,
  // on the ScriptProcessor fallback path, audio rendering itself)
  function writeRingChunk(l, r) {
    const n = l.length;
    const spaceToEnd = ringLen - ringWritePos;
    if (n <= spaceToEnd) {
      ringL.set(l, ringWritePos);
      ringR.set(r, ringWritePos);
    } else {
      ringL.set(l.subarray(0, spaceToEnd), ringWritePos);
      ringR.set(r.subarray(0, spaceToEnd), ringWritePos);
      ringL.set(l.subarray(spaceToEnd), 0);
      ringR.set(r.subarray(spaceToEnd), 0);
    }
    ringWritePos = (ringWritePos + n) % ringLen;
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
    if (start + n <= ringLen) {
      outL.set(ringL.subarray(start, start + n));
      outR.set(ringR.subarray(start, start + n));
    } else {
      const firstPart = ringLen - start;
      outL.set(ringL.subarray(start, ringLen));
      outR.set(ringR.subarray(start, ringLen));
      outL.set(ringL.subarray(0, n - firstPart), firstPart);
      outR.set(ringR.subarray(0, n - firstPart), firstPart);
    }
    if (reverse) {
      outL.reverse();
      outR.reverse();
    }
    return buf;
  }

  // ---- input / recording -----------------------------------------------

  // device labels stay blank until a permission grant unlocks them, and
  // rebuilding <select> naively resets its selection — both of which made
  // picking a specific input (e.g. a laptop's built-in mic vs an
  // interface) look like it silently failed to "take"
  let labelsUnlocked = false;

  async function listInputDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      const previousValue = deviceSelect.value;
      deviceSelect.innerHTML = "";
      inputs.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `入力 ${i + 1}`;
        deviceSelect.appendChild(opt);
      });
      if (inputs.some((d) => d.deviceId === previousValue)) {
        deviceSelect.value = previousValue;
      }
    } catch (err) {
      // device enumeration itself can be blocked (e.g. no mediaDevices in
      // this context) — leave whatever the select already had rather than
      // letting this bubble up and silently abort the caller
      console.warn("listInputDevices failed:", err);
    }
  }

  async function unlockDeviceLabels() {
    if (labelsUnlocked) return;
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      labelsUnlocked = true;
    } catch (err) {
      // permission denied outright; listInputDevices() below will still
      // run and just keep showing generic labels
    }
    await listInputDevices();
  }

  async function armInput() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        inputStatus.textContent =
          "このページではマイク入力(getUserMedia)を使えません。埋め込みプレビューだとブラウザ側でブロックされることがあります。";
        return;
      }

      if (!audioCtx) await initAudio();
      if (audioCtx.state === "suspended") await audioCtx.resume();

      inputStatus.textContent = "許可を確認中…";

      // first pass: unlock real device labels so "内蔵マイク" vs the audio
      // interface are actually distinguishable, then let the (now correctly
      // labeled) selection decide which device to actually open
      await unlockDeviceLabels();

      const deviceId = deviceSelect.value || undefined;
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
        },
      });

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

      bootstrapActiveVoices();
    } catch (err) {
      // whatever failed above (permission denial, no secure context, no
      // audio hardware, AudioContext blocked, …) — always leave a visible
      // message instead of failing silently
      inputStatus.textContent = `入力を開けませんでした: ${(err && err.message) || err}`;
      console.error("armInput failed:", err);
    }
  }

  // picking a different device from the dropdown reconnects immediately,
  // instead of requiring a second click on "再接続"
  deviceSelect.addEventListener("change", () => {
    if (audioCtx) armInput();
  });

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
      // tap after the compressor/limiter, not masterGain — otherwise the
      // recording gets the raw, unprotected sum of all four layers plus
      // reverb/delay tails, while the speakers hear the limited version.
      // Four voices re-triggering close together can easily push that raw
      // sum well past 0dBFS, which is exactly "録音すると音割れ" while
      // live listening sounds fine.
      limiter.connect(recordTapNode);
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
    mode: "flow", // 'fixed' | 'flow'
    reverse: false,
    speed: 1,
    level: 0.85,
    panAmount: 0,
    depthAmount: 0.3,
    pitchRandom: false,
    locked: false,
    currentSource: null,
    currentGain: null,
    panDrift: makeDrift(-1, 1, 0),
    pitchDrift: makeDrift(-7, 7, 0), // semitones, continuous (microtonal) around v.speed
    flowTimer: null,
    currentDuration: 4,
  }));

  function buildVoiceChain(v) {
    v.panNode = audioCtx.createStereoPanner();
    v.levelGain = audioCtx.createGain(); // the mixer fader for this layer
    v.levelGain.gain.value = v.level;
    v.depthFilter = audioCtx.createBiquadFilter();
    v.depthFilter.type = "lowpass";
    v.depthFilter.frequency.value = 18000;

    v.dryGain = audioCtx.createGain();
    v.wetGain = audioCtx.createGain();
    v.delaySendGain = audioCtx.createGain();

    v.panNode.connect(v.levelGain);
    v.levelGain.connect(v.depthFilter);
    v.depthFilter.connect(v.dryGain).connect(masterGain);
    v.depthFilter.connect(v.wetGain).connect(reverbNode);
    v.depthFilter.connect(v.delaySendGain);
    v.delaySendGain.connect(delayA);
    v.delaySendGain.connect(delayB);

    applyDepth(v);
  }

  function applyDepth(v, amountOverride) {
    const d = amountOverride ?? v.depthAmount; // 0 near .. 1 far
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

    if (v.pitchRandom) {
      v.pitchDrift.set(randRange(-7, 7));
    }
    const initialRate = v.pitchRandom ? v.speed * Math.pow(2, v.pitchDrift.value / 12) : v.speed;

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = v.mode === "fixed";
    source.playbackRate.value = initialRate;

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0;
    source.connect(gainNode).connect(v.panNode);

    const now = audioCtx.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + 0.15);

    // give this grain its own place in the field right away, instead of
    // waiting for the slow continuous wobble to happen to wander there —
    // the ongoing drift then continues from this new spot rather than
    // snapping back to wherever it was
    if (v.panAmount > 0) {
      const panJitter = randRange(-1, 1) * v.panAmount;
      v.panDrift.set(panJitter);
      v.panNode.pan.setTargetAtTime(panJitter, now, 0.06);
    }
    const depthJitter = Math.min(1, Math.max(0, v.depthAmount + randRange(-0.12, 0.12)));
    applyDepth(v, depthJitter);

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
    if (!v.active || v.mode !== "flow" || v.locked) return;
    const nextDuration = pickDuration();
    v.flowTimer = setTimeout(() => {
      if (v.active && v.mode === "flow" && !v.locked) triggerVoice(v, nextDuration);
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

  // voices that are checked "active" by default in the markup never fire a
  // change event, and the very first trigger attempt right after arming
  // usually lands before the ring buffer has any material — so wait for
  // enough signal, then kick off every voice the UI already shows as on
  let bootstrapPoll = null;
  function bootstrapActiveVoices() {
    clearInterval(bootstrapPoll);
    bootstrapPoll = setInterval(() => {
      if (ringSecondsAvailable() < 0.6) return;
      // triggerVoice() clamps its random duration down to whatever's
      // actually in the ring buffer, and right at connect time that's a
      // near-identical tiny number for every voice fired in the same
      // instant — every layer's random pick then gets clamped to the same
      // ceiling and they all start out looking identical. Staggering the
      // first trigger per voice gives each one a different (and growing)
      // ceiling to land on, so they diverge immediately instead of only
      // after their first flow re-trigger.
      voiceEls.forEach((ui, i) => {
        const v = voices[i];
        if (!ui.active.checked || v.active) return;
        setTimeout(() => {
          if (ui.active.checked && !v.active) setVoiceActive(v, true);
        }, i * 400);
      });
      clearInterval(bootstrapPoll);
    }, 150);
  }

  // slow pan drift, ticked from the same loop as the meter/canvas
  function updateVoiceDrift() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    voices.forEach((v) => {
      if (!v.active) return;

      if (v.panAmount > 0) {
        // at 0.01 the drift's own ~2.4s average retarget interval was
        // shorter than its ~12-36s time constant to actually get anywhere —
        // it just sat within a hair of center indefinitely, which read as
        // "pan doesn't do anything". 0.06 lets it swing across the field in
        // a few seconds while still wandering, not snapping.
        const drift = v.panDrift.tick(0.06);
        v.panNode.pan.setTargetAtTime(drift * v.panAmount, now, 0.4);
      }

      if (v.pitchRandom && v.currentSource) {
        const semitones = v.pitchDrift.tick(0.06);
        const rate = v.speed * Math.pow(2, semitones / 12);
        v.currentSource.playbackRate.setTargetAtTime(rate, now, 0.4);
      }
    });
  }
  setInterval(updateVoiceDrift, 120);

  // ---- auto-sample (global) ---------------------------------------------

  let autoSampleTimer = null;

  function autoSampleTick() {
    if (!autoSampleToggle.checked) return;
    voices.forEach((v) => {
      if (v.active && v.mode === "fixed" && !v.locked) triggerVoice(v);
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
    voices.forEach((v) => { if (v.active && !v.locked) triggerVoice(v); });
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

    ui.pitchRandom.addEventListener("change", () => {
      v.pitchRandom = ui.pitchRandom.checked;
      if (!v.pitchRandom && v.currentSource && audioCtx) {
        // snap cleanly back to the slider's exact speed instead of leaving
        // it wherever the drift last wandered to
        v.currentSource.playbackRate.setTargetAtTime(v.speed, audioCtx.currentTime, 0.15);
      }
    });

    // locking a layer exempts it from every *automatic* re-trigger (the
    // global auto-sample timer, flow mode's own self-scheduling, and the
    // "今すぐ全レイヤーを再サンプル" bulk button) — the only way its
    // content changes once locked is this voice's own 再サンプル button
    ui.locked.addEventListener("change", () => {
      v.locked = ui.locked.checked;
      clearTimeout(v.flowTimer);
    });

    function applySpeed() {
      v.speed = +ui.speed.value / 100;
      ui.speedLabel.textContent = `${v.speed.toFixed(2)}x`;
      if (v.currentSource) {
        v.currentSource.playbackRate.setTargetAtTime(v.speed, audioCtx.currentTime, 0.05);
      }
    }

    ui.speed.addEventListener("input", applySpeed);

    const speedMin = +ui.speed.min, speedMax = +ui.speed.max;
    function setSpeedMultiplier(multiplier) {
      ui.speed.value = Math.round(Math.min(speedMax, Math.max(speedMin, multiplier * 100)));
      applySpeed();
    }
    ui.speedHalf.addEventListener("click", () => setSpeedMultiplier(0.5));
    ui.speedDouble.addEventListener("click", () => setSpeedMultiplier(2));

    ui.level.addEventListener("input", () => {
      v.level = +ui.level.value / 100;
      if (audioCtx) v.levelGain.gain.setTargetAtTime(v.level, audioCtx.currentTime, 0.05);
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
    try {
      if (!audioCtx) await initAudio();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      startBtn.textContent = "オーディオ起動中";
      startBtn.disabled = true;
    } catch (err) {
      inputStatus.textContent = `オーディオの初期化に失敗しました: ${(err && err.message) || err}`;
      console.error("initAudio failed:", err);
    }
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

  // a full-screen canvas cleared every frame at real devicePixelRatio gets
  // expensive fast on 2x/3x displays and was competing with the audio
  // thread for CPU — capping it keeps the visual nearly as sharp for a
  // fraction of the fill-rate cost
  const CANVAS_DPR = Math.min(devicePixelRatio || 1, 1.5);

  function resizeCanvas() {
    canvas.width = window.innerWidth * CANVAS_DPR;
    canvas.height = window.innerHeight * CANVAS_DPR;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // this is decorative, not part of the audio path, but a full-screen
  // canvas repainted at 60fps with per-particle radial gradients was real
  // GPU/CPU load competing for the same core the audio needs — flat fills
  // instead of gradients, ~30fps instead of 60, and an outright off switch
  // off by default — this is the single biggest lever for a struggling
  // machine, so don't make people find the switch after the fact
  let bgAnimEnabled = !!bgAnimToggle?.checked;
  let lastDrawTime = 0;
  const FRAME_INTERVAL = 1000 / 30;

  function draw(now) {
    if (!bgAnimEnabled) return;
    requestAnimationFrame(draw);
    if (now - lastDrawTime < FRAME_INTERVAL) return;
    const dt = lastDrawTime ? (now - lastDrawTime) / 1000 : FRAME_INTERVAL / 1000;
    lastDrawTime = now;

    const w = canvas.width, h = canvas.height;
    ctx2d.fillStyle = `hsla(${hue}, 25%, 4%, 0.3)`;
    ctx2d.fillRect(0, 0, w, h);

    particles.forEach((p) => {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.maxLife;
      const alpha = Math.max(0, 1 - t) * 0.5;
      const r = p.r * (1 + t * 6);
      ctx2d.globalAlpha = alpha;
      ctx2d.fillStyle = `hsl(${p.hue}, 55%, 72%)`;
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx2d.fill();
    });
    ctx2d.globalAlpha = 1;
    particles = particles.filter((p) => p.life < p.maxLife);
  }

  function setBgAnimEnabled(enabled) {
    bgAnimEnabled = enabled;
    if (enabled) {
      lastDrawTime = 0;
      requestAnimationFrame(draw);
    } else {
      ctx2d.fillStyle = "#0b0d10";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  setBgAnimEnabled(bgAnimEnabled);

  if (bgAnimToggle) {
    bgAnimToggle.addEventListener("change", () => setBgAnimEnabled(bgAnimToggle.checked));
  }

  const voiceHues = [200, 320, 60, 150];

  function spawnParticle(v) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    particles.push({
      x: w * (0.2 + 0.6 * (v.index / (MAX_VOICES - 1))),
      y: h * 0.5 + (Math.random() - 0.5) * h * 0.2,
      r: 5 * CANVAS_DPR,
      life: 0,
      maxLife: Math.max(1.2, Math.min(4, v.currentDuration)),
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      hue: voiceHues[v.index] ?? 200,
    });
    if (particles.length > 60) particles.shift();
  }
})();
