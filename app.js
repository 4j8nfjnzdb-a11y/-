// glitchbox — realtime instrument input with irregular, periodic glitches
//
// The signal (guitar, mic, whatever's plugged in) passes straight through
// an AudioWorklet unmodified until the scheduler below decides to fire.
// Scheduling isn't just "every N seconds" and isn't pure white noise
// either: each wait is drawn from a period-dependent range, but with a
// small chance of a very-soon burst or a much-longer silence layered on
// top, so the rhythm never quite settles into something predictable.
// "auto" mode additionally drifts the active period itself over time.

(() => {
  const startBtn = document.getElementById("startBtn");
  const glitchEnabledBox = document.getElementById("glitchEnabled");
  const statusEl = document.getElementById("status");
  const periodButtons = Array.from(document.querySelectorAll(".periodBtn"));
  const intensitySlider = document.getElementById("intensity");
  const volumeSlider = document.getElementById("volume");
  const overlay = document.getElementById("glitchOverlay");
  const uiEl = document.querySelector(".ui");
  const lastGlitchEl = document.getElementById("lastGlitch");
  const deviceSelect = document.getElementById("deviceSelect");
  const pitchEnabledBox = document.getElementById("pitchEnabled");
  const pitchDepthSlider = document.getElementById("pitchDepth");
  const pitchRateSlider = document.getElementById("pitchRate");

  const PERIOD_PRESETS = {
    frequent: [2.5, 7],
    normal: [6, 18],
    rare: [15, 40],
  };
  const AUTO_KEYS = ["frequent", "normal", "rare"];

  // weighted pool: stutter/chop (rearrangements of the real signal) show
  // up more often than the harsher bitcrush/dropout
  const GLITCH_KIND_POOL = [
    "stutter", "stutter", "chop", "chop", "bitcrush", "dropout",
  ];
  const KIND_LABEL = {
    bitcrush: "ビットクラッシュ",
    stutter: "スタッター",
    chop: "チョップ",
    dropout: "ドロップアウト",
  };
  const KIND_DURATION = {
    bitcrush: [0.12, 0.4],
    stutter: [0.08, 0.35],
    chop: [0.15, 0.5],
    dropout: [0.04, 0.18],
  };
  const KIND_COLOR = {
    bitcrush: "#35f0ff",
    stutter: "#ff2ecb",
    chop: "#ffb23f",
    dropout: "#ff5c5c",
  };

  let audioCtx = null;
  let stream = null;
  let source = null;
  let workletNode = null;
  let pitchNode = null;
  let pitchParam = null;
  let outputGain = null;
  let running = false;

  let periodMode = "normal";
  let autoRangeKey = "normal";
  let schedulerTimer = null;
  let autoDriftTimer = null;
  let pitchTimer = null;

  // ---- irregular interval scheduling --------------------------------

  function currentPresetKey() {
    return periodMode === "auto" ? autoRangeKey : periodMode;
  }

  function nextIntervalSeconds() {
    const [min, max] = PERIOD_PRESETS[currentPresetKey()];
    const r = Math.random();
    if (r < 0.12) {
      // burst: something already happened, fire again almost immediately
      return min * (0.12 + Math.random() * 0.3);
    }
    if (r < 0.24) {
      // occasional long silence, breaks the sense of a fixed period
      return max * (1.3 + Math.random() * 1.1);
    }
    return min + Math.random() * (max - min);
  }

  function scheduleNext() {
    if (!running) return;
    const waitMs = nextIntervalSeconds() * 1000;
    schedulerTimer = setTimeout(() => {
      fireGlitch();
      scheduleNext();
    }, waitMs);
  }

  function pickAutoRange(avoid) {
    const choices = AUTO_KEYS.filter((k) => k !== avoid);
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function scheduleAutoDrift() {
    clearTimeout(autoDriftTimer);
    if (periodMode !== "auto" || !running) return;
    const waitMs = (25 + Math.random() * 45) * 1000;
    autoDriftTimer = setTimeout(() => {
      autoRangeKey = pickAutoRange(autoRangeKey);
      scheduleAutoDrift();
    }, waitMs);
  }

  // ---- continuous pitch drift ----------------------------------------
  // Always running once enabled: picks a new random target pitch and
  // glides the AudioParam to it smoothly over the whole interval, then
  // immediately picks the next target — an unhurried, never-resting
  // wander up and down rather than discrete events.

  function pitchLoop() {
    if (!running || !pitchNode) return;
    if (!pitchEnabledBox.checked) {
      pitchTimer = null;
      return;
    }
    const rateVal = +pitchRateSlider.value;
    const legSeconds = 60 - rateVal * 0.55; // 100 -> 5s, 0 -> 60s
    const depthVal = +pitchDepthSlider.value;
    const maxCents = (depthVal / 100) * 1000; // up to ~+/-8.3 semitones

    const now = audioCtx.currentTime;
    const target = maxCents === 0 ? 0 : (Math.random() * 2 - 1) * maxCents;
    pitchParam.cancelScheduledValues(now);
    pitchParam.setValueAtTime(pitchParam.value, now);
    pitchParam.linearRampToValueAtTime(target, now + legSeconds);

    pitchTimer = setTimeout(pitchLoop, legSeconds * 1000);
  }

  function setPitchEnabled(enabled) {
    if (!pitchNode) return;
    clearTimeout(pitchTimer);
    pitchTimer = null;
    if (enabled) {
      pitchLoop();
    } else {
      const now = audioCtx.currentTime;
      pitchParam.cancelScheduledValues(now);
      pitchParam.setValueAtTime(pitchParam.value, now);
      pitchParam.linearRampToValueAtTime(0, now + 2);
    }
  }

  // ---- firing a glitch -------------------------------------------------

  function fireGlitch(forceKind) {
    if (!running || !workletNode) return;
    if (!glitchEnabledBox.checked) return;

    const intensity = +intensitySlider.value / 100;
    const kind = forceKind || GLITCH_KIND_POOL[Math.floor(Math.random() * GLITCH_KIND_POOL.length)];
    const [dmin, dmax] = KIND_DURATION[kind];
    const durationSec = dmin + Math.random() * (dmax - dmin);

    workletNode.port.postMessage({
      type: "trigger",
      kind,
      durationSamples: Math.max(1, Math.floor(durationSec * audioCtx.sampleRate)),
      intensity,
    });

    flashVisual(kind, durationSec);

    // rare overlapping second glitch, more likely at high intensity —
    // the "everything at once" moment
    if (Math.random() < 0.12 * intensity) {
      const kind2 = GLITCH_KIND_POOL[Math.floor(Math.random() * GLITCH_KIND_POOL.length)];
      setTimeout(() => fireGlitch(kind2), 40 + Math.random() * 140);
    }
  }

  function flashVisual(kind, durationSec) {
    overlay.style.setProperty("--glitch-color", KIND_COLOR[kind]);
    overlay.classList.remove("flash");
    void overlay.offsetWidth; // restart animation
    overlay.classList.add("flash");

    uiEl.classList.remove("shake");
    void uiEl.offsetWidth;
    uiEl.classList.add("shake");

    lastGlitchEl.textContent = KIND_LABEL[kind];
    lastGlitchEl.classList.add("show");
    clearTimeout(flashVisual._t);
    flashVisual._t = setTimeout(() => {
      lastGlitchEl.classList.remove("show");
    }, Math.max(400, durationSec * 1000));
  }

  // ---- transport ------------------------------------------------------

  // deviceId "" means "browser default" — no exact constraint
  async function openStream(deviceId) {
    const audioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (deviceId) audioConstraints.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  }

  async function refreshDeviceList(selectedDeviceId) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      deviceSelect.innerHTML = "";
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "既定の入力";
      deviceSelect.appendChild(defaultOpt);
      inputs.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || "入力デバイス " + (i + 1);
        deviceSelect.appendChild(opt);
      });
      deviceSelect.value = selectedDeviceId || "";
      deviceSelect.disabled = false;
    } catch (e) {}
  }

  async function switchDevice(deviceId) {
    if (!running) return;
    deviceSelect.disabled = true;
    statusEl.textContent = "入力デバイスを切り替えています…";
    try {
      const newStream = await openStream(deviceId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (source) source.disconnect();
      stream = newStream;
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(workletNode);
      await refreshDeviceList(deviceId);
      const track = stream.getAudioTracks()[0];
      statusEl.textContent = "入力中: " + (track ? track.label || "既定の入力" : "既定の入力");
    } catch (err) {
      statusEl.textContent = "デバイスを切り替えられませんでした: " + err.message;
    } finally {
      deviceSelect.disabled = false;
    }
  }

  function describeError(err) {
    if (err.name === "NotAllowedError") {
      return "マイクの使用が許可されていません(ブラウザのサイト設定、またはOSのマイク権限を確認してください)";
    }
    if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
      return "指定した入力デバイスが見つかりません。オーディオインターフェースの接続を確認してください";
    }
    if (err.name === "NotReadableError") {
      return "他のアプリがこの入力デバイスを使用中の可能性があります";
    }
    return err.message;
  }

  async function start() {
    startBtn.disabled = true;
    statusEl.textContent = "マイクへのアクセスを許可してください…";
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: "interactive",
      });
      await Promise.all([
        audioCtx.audioWorklet.addModule("glitch-processor.js"),
        audioCtx.audioWorklet.addModule("pitch-drift-processor.js"),
      ]);

      stream = await openStream(deviceSelect.value);

      source = audioCtx.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioCtx, "glitch-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      pitchNode = new AudioWorkletNode(audioCtx, "pitch-drift-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      pitchParam = pitchNode.parameters.get("cents");
      outputGain = audioCtx.createGain();
      outputGain.gain.value = +volumeSlider.value / 100;

      source.connect(workletNode).connect(pitchNode).connect(outputGain).connect(audioCtx.destination);

      running = true;
      scheduleNext();
      scheduleAutoDrift();
      if (pitchEnabledBox.checked) pitchLoop();

      startBtn.textContent = "停止";
      startBtn.classList.add("running");
      const track = stream.getAudioTracks()[0];
      statusEl.textContent = "入力中: " + (track ? track.label || "既定の入力" : "既定の入力");

      await refreshDeviceList(track ? track.getSettings().deviceId : "");
    } catch (err) {
      statusEl.textContent = "マイクに接続できませんでした: " + describeError(err);
    } finally {
      startBtn.disabled = false;
    }
  }

  function stop() {
    running = false;
    clearTimeout(schedulerTimer);
    clearTimeout(autoDriftTimer);
    clearTimeout(pitchTimer);
    pitchTimer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (workletNode) workletNode.disconnect();
    if (pitchNode) pitchNode.disconnect();
    if (source) source.disconnect();
    if (outputGain) outputGain.disconnect();
    if (audioCtx) audioCtx.close();
    audioCtx = null;
    stream = null;
    source = null;
    workletNode = null;
    pitchNode = null;
    pitchParam = null;
    outputGain = null;

    startBtn.textContent = "マイク接続 & 開始";
    startBtn.classList.remove("running");
    statusEl.textContent = "停止中";
    deviceSelect.disabled = true;
  }

  startBtn.addEventListener("click", () => {
    if (running) stop();
    else start();
  });

  pitchEnabledBox.addEventListener("change", () => {
    setPitchEnabled(pitchEnabledBox.checked);
  });

  deviceSelect.addEventListener("change", () => {
    switchDevice(deviceSelect.value);
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      if (running) refreshDeviceList(deviceSelect.value);
    });
  }

  volumeSlider.addEventListener("input", () => {
    if (outputGain) outputGain.gain.value = +volumeSlider.value / 100;
  });

  periodButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      periodButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      periodMode = btn.dataset.period;
      if (periodMode === "auto") {
        autoRangeKey = "normal";
        scheduleAutoDrift();
      } else {
        clearTimeout(autoDriftTimer);
      }
    });
  });

  window.addEventListener("beforeunload", () => {
    if (running) stop();
  });
})();
