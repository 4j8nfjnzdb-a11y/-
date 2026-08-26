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

  const PERIOD_PRESETS = {
    frequent: [2.5, 7],
    normal: [6, 18],
    rare: [15, 40],
  };
  const AUTO_KEYS = ["frequent", "normal", "rare"];

  const GLITCH_KINDS = ["bitcrush", "stutter", "dropout", "warble", "crackle"];
  const KIND_LABEL = {
    bitcrush: "ビットクラッシュ",
    stutter: "スタッター",
    dropout: "ドロップアウト",
    warble: "ワウ",
    crackle: "クラックル",
  };
  const KIND_DURATION = {
    bitcrush: [0.15, 0.6],
    stutter: [0.1, 0.45],
    dropout: [0.05, 0.3],
    warble: [0.3, 1.1],
    crackle: [0.1, 0.4],
  };
  const KIND_COLOR = {
    bitcrush: "#35f0ff",
    stutter: "#ff2ecb",
    dropout: "#ff5c5c",
    warble: "#b98cff",
    crackle: "#ffd23f",
  };

  let audioCtx = null;
  let stream = null;
  let source = null;
  let workletNode = null;
  let outputGain = null;
  let running = false;

  let periodMode = "normal";
  let autoRangeKey = "normal";
  let schedulerTimer = null;
  let autoDriftTimer = null;

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

  // ---- firing a glitch -------------------------------------------------

  function fireGlitch(forceKind) {
    if (!running || !workletNode) return;
    if (!glitchEnabledBox.checked) return;

    const intensity = +intensitySlider.value / 100;
    const kind = forceKind || GLITCH_KINDS[Math.floor(Math.random() * GLITCH_KINDS.length)];
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
      const kind2 = GLITCH_KINDS[Math.floor(Math.random() * GLITCH_KINDS.length)];
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

  async function start() {
    startBtn.disabled = true;
    statusEl.textContent = "マイクへのアクセスを許可してください…";
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: "interactive",
      });
      await audioCtx.audioWorklet.addModule("glitch-processor.js");

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      source = audioCtx.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioCtx, "glitch-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      outputGain = audioCtx.createGain();
      outputGain.gain.value = +volumeSlider.value / 100;

      source.connect(workletNode).connect(outputGain).connect(audioCtx.destination);

      running = true;
      scheduleNext();
      scheduleAutoDrift();

      startBtn.textContent = "停止";
      startBtn.classList.add("running");
      statusEl.textContent = "入力中 — いつバグるかは分からない";
    } catch (err) {
      statusEl.textContent = "マイクに接続できませんでした: " + err.message;
    } finally {
      startBtn.disabled = false;
    }
  }

  function stop() {
    running = false;
    clearTimeout(schedulerTimer);
    clearTimeout(autoDriftTimer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (workletNode) workletNode.disconnect();
    if (source) source.disconnect();
    if (outputGain) outputGain.disconnect();
    if (audioCtx) audioCtx.close();
    audioCtx = null;
    stream = null;
    source = null;
    workletNode = null;
    outputGain = null;

    startBtn.textContent = "マイク接続 & 開始";
    startBtn.classList.remove("running");
    statusEl.textContent = "停止中";
  }

  startBtn.addEventListener("click", () => {
    if (running) stop();
    else start();
  });

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
