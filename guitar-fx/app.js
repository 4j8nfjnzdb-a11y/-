// drift rack — realtime guitar fx
//
// Signal path:
//   input device -> inputTrim -> highpass -> preFX
//   preFX -> dryGain -----------------------------\
//   preFX -> [5 effect modules, each with its own   } -> masterSum -> masterVolume -> limiter -> out
//            internal dry/wet mix + enable/bypass] /             \-> recordDest (MediaRecorder)
//            -> wetBus -> masterWetGain -----------/
//
// Every effect module is built from a shared "shell" (input tap, internal
// dry/wet crossfade, bypass smoothing) plus effect-specific DSP that reads
// from shell.input and writes into shell.wetTap.
//
// Every UI fader is bound once at load time through bindParam(); its
// on-screen value and the live AudioParam are always the same code path,
// whether the slider is moved by hand or nudged by the random-walk ticker.
// That's what lets the "R" checkboxes hand control of a single parameter
// to the randomizer without touching anything else.

(() => {
  // ---- DOM refs ------------------------------------------------------

  const deviceSelect = document.getElementById("deviceSelect");
  const outputSelect = document.getElementById("outputSelect");
  const testToneBtn = document.getElementById("testToneBtn");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const statusEl = document.getElementById("status");
  const inputTrimSlider = document.getElementById("inputTrim");
  const inputTrimVal = document.getElementById("inputTrimVal");
  const meterCanvas = document.getElementById("meterCanvas");
  const masterMixSlider = document.getElementById("masterMix");
  const masterMixVal = document.getElementById("masterMixVal");
  const masterVolSlider = document.getElementById("masterVol");
  const masterVolVal = document.getElementById("masterVolVal");
  const randomSpeedSlider = document.getElementById("randomSpeed");
  const randomSpeedVal = document.getElementById("randomSpeedVal");
  const randomizeNowBtn = document.getElementById("randomizeNowBtn");
  const recordBtn = document.getElementById("recordBtn");
  const takesEl = document.getElementById("takes");
  const secureWarning = document.getElementById("secureWarning");
  const diagLog = document.getElementById("diagLog");
  const clearLogBtn = document.getElementById("clearLog");

  // ---- on-page diagnostics log ------------------------------------------
  // Real-world failures here are almost always browser permission/security
  // behavior that never shows up in devtools unless someone thinks to look,
  // so every meaningful step is logged directly on the page.

  function log(msg, cls) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    const t = new Date().toLocaleTimeString("ja-JP");
    line.textContent = `[${t}] ${msg}`;
    diagLog.appendChild(line);
    diagLog.scrollTop = diagLog.scrollHeight;
  }
  clearLogBtn.addEventListener("click", () => { diagLog.innerHTML = ""; });

  function explainError(err) {
    const hints = {
      NotAllowedError:
        "マイクの権限が拒否されています。アドレスバー左のサイト情報アイコン(鍵/ⓘ)→「マイク」を「許可」に変更してからページを再読み込みしてください。",
      PermissionDeniedError:
        "マイクの権限が拒否されています。ブラウザのサイト設定でマイクを許可してからページを再読み込みしてください。",
      NotFoundError: "使用できるマイク/オーディオ入力デバイスが見つかりません。",
      DevicesNotFoundError: "使用できるマイク/オーディオ入力デバイスが見つかりません。",
      NotReadableError:
        "デバイスが他のアプリ(TotalMix、他のブラウザタブ、他のアプリ等)に排他利用されている可能性があります。それらを閉じて再試行してください。",
      TrackStartError:
        "デバイスが他のアプリ(TotalMix、他のブラウザタブ、他のアプリ等)に排他利用されている可能性があります。それらを閉じて再試行してください。",
      OverconstrainedError: "選択したデバイスがその設定に対応していません。",
      SecurityError: "セキュリティコンテキストの制約でマイクを利用できません(file://で開いていませんか?)。",
      TimeoutError:
        "マイクの許可ダイアログが一定時間たっても応答しませんでした。macOSの「システム設定→プライバシーとセキュリティ→マイク」でブラウザ(Chrome/Firefox本体)自体に許可が出ているか確認し、出ていなければON にしてブラウザを再起動してから再試行してください。",
    };
    return hints[err.name] || `${err.name || "Error"}: ${err.message}`;
  }

  const GUM_TIMEOUT_MS = 12000;
  function getUserMediaWithTimeout(constraints) {
    return Promise.race([
      navigator.mediaDevices.getUserMedia(constraints),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })), GUM_TIMEOUT_MS)
      ),
    ]);
  }

  // ---- audio graph state ----------------------------------------------

  let audioCtx = null;
  let mediaStream = null;
  let sourceNode = null;
  let inputTrim, inputHPF, preFX, dryGain, wetBus, masterWetGain, masterSum;
  let masterVolume, limiter, analyser, recordDest;
  const modules = {}; // panelKey -> { shell, fx }

  let mediaRecorder = null;
  let recordedChunks = [];

  // ---- smoothed random walk -------------------------------------------

  function makeDrift(min, max, start) {
    let value = start ?? (min + max) / 2;
    let target = value;
    return {
      get value() { return value; },
      reroll(jump) {
        target = min + Math.random() * (max - min);
        if (jump) value += (target - value) * 0.6;
      },
      tick(rate) {
        if (Math.random() < 0.06) target = min + Math.random() * (max - min);
        value += (target - value) * rate;
        value = Math.max(min, Math.min(max, value));
        return value;
      },
    };
  }

  // ---- param mapping helpers -------------------------------------------

  function toValue(pct, cfg) {
    const t = Math.pow(Math.max(0, Math.min(100, pct)) / 100, cfg.exp || 1);
    return cfg.min + t * (cfg.max - cfg.min);
  }

  function fromValue(v, cfg) {
    const t = (v - cfg.min) / (cfg.max - cfg.min);
    return Math.pow(Math.max(0, Math.min(1, t)), 1 / (cfg.exp || 1)) * 100;
  }

  function formatVal(v, cfg) {
    if (cfg.unit === "%") return Math.round(v) + "%";
    return v.toFixed(cfg.decimals ?? 2) + cfg.unit;
  }

  const FX_PARAM_CONFIGS = {
    looper: {
      time: { min: 0.05, max: 30, exp: 1.6, unit: "s", decimals: 2, randomRange: [5, 95] },
      feedback: { min: 0, max: 100, exp: 1, unit: "%", randomRange: [0, 85] },
      mix: { min: 0, max: 100, exp: 1, unit: "%" },
    },
    delay16: {
      time: { min: 0.05, max: 16, exp: 1.6, unit: "s", decimals: 2, randomRange: [3, 97] },
      feedback: { min: 0, max: 100, exp: 1, unit: "%", randomRange: [0, 85] },
      wobble: { min: 0, max: 100, exp: 1, unit: "%", randomRange: [0, 100] },
      mix: { min: 0, max: 100, exp: 1, unit: "%" },
    },
    grmdelay: {
      attack: { min: 0, max: 100, exp: 1, unit: "%", randomRange: [0, 100] },
      sustain: { min: 0, max: 100, exp: 1, unit: "%", randomRange: [0, 90] },
      tone: { min: 0, max: 100, exp: 1, unit: "%", randomRange: [0, 100] },
      mix: { min: 0, max: 100, exp: 1, unit: "%" },
    },
    chaos: {
      rate: { min: 0, max: 100, exp: 1, unit: "%" },
      density: { min: 0, max: 100, exp: 1, unit: "%" },
      crush: { min: 0, max: 100, exp: 1, unit: "%", randomRange: [0, 100] },
      mix: { min: 0, max: 100, exp: 1, unit: "%" },
    },
    vibrato: {
      rate: { min: 0.05, max: 8, exp: 1.4, unit: "Hz", decimals: 2, randomRange: [5, 90] },
      depth: { min: 0, max: 100, exp: 1, unit: "%", randomRange: [0, 100] },
      mix: { min: 0, max: 100, exp: 1, unit: "%" },
    },
  };

  // ---- generic per-module dry/wet + bypass shell ------------------------

  function createModuleShell(ctx, preFXNode, wetBusNode) {
    const input = ctx.createGain();
    preFXNode.connect(input);

    const dryGainNode = ctx.createGain();
    const wetGainNode = ctx.createGain();
    dryGainNode.gain.value = 0.5;
    wetGainNode.gain.value = 0.5;
    input.connect(dryGainNode);

    const wetTap = ctx.createGain();
    wetTap.connect(wetGainNode);

    const sum = ctx.createGain();
    dryGainNode.connect(sum);
    wetGainNode.connect(sum);

    const enableGain = ctx.createGain();
    enableGain.gain.value = 0;
    sum.connect(enableGain);
    enableGain.connect(wetBusNode);

    function setMix(pct, now) {
      const mix = Math.max(0, Math.min(100, pct)) / 100;
      dryGainNode.gain.setTargetAtTime(Math.cos(mix * Math.PI / 2), now, 0.03);
      wetGainNode.gain.setTargetAtTime(Math.sin(mix * Math.PI / 2), now, 0.03);
    }
    function setEnabled(on, now) {
      enableGain.gain.setTargetAtTime(on ? 1 : 0, now, 0.05);
    }

    return { input, wetTap, setMix, setEnabled };
  }

  // ---- effect 1: time-machine looper -----------------------------------

  function buildLooper(ctx, shell) {
    const inputGate = ctx.createGain();
    const delay = ctx.createDelay(30);
    delay.delayTime.value = 8;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 6000;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.22;

    shell.input.connect(inputGate);
    inputGate.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(shell.wetTap);

    let frozen = false;
    let lastFeedbackPct = 25;

    function setTime(v, now) { delay.delayTime.setTargetAtTime(v, now, 0.05); }
    function setFeedback(v, now) {
      lastFeedbackPct = v;
      if (!frozen) feedback.gain.setTargetAtTime(v / 100 * 0.9, now, 0.05);
    }
    function toggleFreeze() {
      frozen = !frozen;
      const now = ctx.currentTime;
      inputGate.gain.setTargetAtTime(frozen ? 0 : 1, now, 0.05);
      feedback.gain.setTargetAtTime(frozen ? 0.97 : lastFeedbackPct / 100 * 0.9, now, 0.05);
      return frozen;
    }
    function jump() {
      const now = ctx.currentTime;
      const t = 0.3 + Math.random() * 19.5;
      delay.delayTime.setTargetAtTime(t, now, 0.01);
      return t;
    }

    return { setTime, setFeedback, toggleFreeze, jump };
  }

  // ---- effect 2: EHX-inspired 16 second delay ---------------------------

  function buildDelay16(ctx, shell) {
    const delay = ctx.createDelay(16);
    delay.delayTime.value = 4;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 5000;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;

    // always-on subtle wobble: modulating delay time is exactly what makes
    // a BBD/tape-style delay pitch-bend as you change its clock — this is
    // the mechanism the real EHX 16 Second Digital Delay relies on.
    const wobbleLFO = ctx.createOscillator();
    wobbleLFO.type = "sine";
    wobbleLFO.frequency.value = 0.3;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 0.003;
    wobbleLFO.connect(wobbleDepth).connect(delay.delayTime);
    wobbleLFO.start();

    shell.input.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(shell.wetTap);

    function setTime(v, now) { delay.delayTime.setTargetAtTime(v, now, 0.08); }
    function setFeedback(v, now) { feedback.gain.setTargetAtTime(v / 100 * 0.92, now, 0.05); }
    function setWobble(v, now) { wobbleDepth.gain.setTargetAtTime(0.0005 + v / 100 * 0.014, now, 0.05); }

    return { setTime, setFeedback, setWobble };
  }

  // ---- effect 3: GRM-style delay with attack / sustain -------------------

  function buildGrmDelay(ctx, shell) {
    const delay = ctx.createDelay(4);
    delay.delayTime.value = 0.35;
    const tone = ctx.createBiquadFilter();
    tone.type = "bandpass";
    tone.frequency.value = 1500;
    tone.Q.value = 0.7;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4;

    shell.input.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);

    const baseWetGain = ctx.createGain();
    baseWetGain.gain.value = 0.5;
    tone.connect(baseWetGain);
    baseWetGain.connect(shell.wetTap);

    // envelope follower (rectify + lowpass) drives the wet gain, so the
    // repeats visibly "swell in" — attack sets how fast that follower
    // reacts, sustain is the feedback amount (tail length).
    const rectifier = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.abs(x);
    }
    rectifier.curve = curve;
    const envLowpass = ctx.createBiquadFilter();
    envLowpass.type = "lowpass";
    envLowpass.frequency.value = 6;
    const envScale = ctx.createGain();
    envScale.gain.value = 0.6;

    shell.input.connect(rectifier);
    rectifier.connect(envLowpass);
    envLowpass.connect(envScale);
    envScale.connect(baseWetGain.gain);

    function setAttack(v, now) {
      const hz = 0.6 + Math.pow(v / 100, 1.3) * 18;
      envLowpass.frequency.setTargetAtTime(hz, now, 0.05);
    }
    function setSustain(v, now) { feedback.gain.setTargetAtTime(v / 100 * 0.93, now, 0.05); }
    function setTone(v, now) {
      const hz = 300 + Math.pow(v / 100, 1.4) * 4200;
      tone.frequency.setTargetAtTime(hz, now, 0.06);
    }

    return { setAttack, setSustain, setTone };
  }

  // ---- effect 4: random switch / chaos gate ------------------------------

  function buildChaos(ctx, shell) {
    const crush = ctx.createWaveShaper();
    const gateGain = ctx.createGain();
    gateGain.gain.value = 1;

    shell.input.connect(crush);
    crush.connect(gateGain);
    gateGain.connect(shell.wetTap);

    let ratePct = 40, densityPct = 50;
    let nextFlip = 0;
    let isOn = true;

    function setRate(v) { ratePct = v; }
    function setDensity(v) { densityPct = v; }
    function setCrush(v) {
      const amt = v / 100;
      const steps = Math.max(2, Math.round(64 - amt * 60));
      const n = 256;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.round(x * steps) / steps;
      }
      crush.curve = curve;
    }
    function triggerNow() {
      const now = ctx.currentTime;
      isOn = !isOn;
      gateGain.gain.setTargetAtTime(isOn ? 1 : 0, now, 0.006);
    }
    function tick(now) {
      if (now < nextFlip) return;
      const p = densityPct / 100;
      isOn = Math.random() < (0.25 + p * 0.7);
      gateGain.gain.setTargetAtTime(isOn ? 1 : 0, now, 0.006);
      const minInt = 0.05, maxInt = 1.3;
      const interval = maxInt - (ratePct / 100) * (maxInt - minInt);
      nextFlip = now + interval * (0.5 + Math.random());
    }

    setCrush(30);
    return { setRate, setDensity, setCrush, triggerNow, tick };
  }

  // ---- effect 5: drifting vibrato -----------------------------------------

  function buildVibrato(ctx, shell) {
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.015;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 4;
    const depthGain = ctx.createGain();
    depthGain.gain.value = 0.003;
    lfo.connect(depthGain).connect(delay.delayTime);
    lfo.start();

    shell.input.connect(delay);
    delay.connect(shell.wetTap);

    function setRate(hz, now) { lfo.frequency.setTargetAtTime(hz, now, 0.1); }
    function setDepth(v, now) { depthGain.gain.setTargetAtTime(v / 100 * 0.012, now, 0.1); }

    return { setRate, setDepth };
  }

  // ---- build the persistent graph (once) ---------------------------------

  function buildGraphOnce() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    inputTrim = audioCtx.createGain();
    inputTrim.gain.value = +inputTrimSlider.value / 100;
    inputHPF = audioCtx.createBiquadFilter();
    inputHPF.type = "highpass";
    inputHPF.frequency.value = 40;
    preFX = audioCtx.createGain();
    inputTrim.connect(inputHPF).connect(preFX);

    dryGain = audioCtx.createGain();
    wetBus = audioCtx.createGain();
    masterWetGain = audioCtx.createGain();
    masterSum = audioCtx.createGain();

    preFX.connect(dryGain).connect(masterSum);
    wetBus.connect(masterWetGain).connect(masterSum);

    masterVolume = audioCtx.createGain();
    masterVolume.gain.value = +masterVolSlider.value / 100;

    limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;

    masterSum.connect(masterVolume).connect(limiter).connect(analyser).connect(audioCtx.destination);

    recordDest = audioCtx.createMediaStreamDestination();
    analyser.connect(recordDest);

    const builders = {
      looper: buildLooper,
      delay16: buildDelay16,
      grmdelay: buildGrmDelay,
      chaos: buildChaos,
      vibrato: buildVibrato,
    };
    Object.keys(builders).forEach((key) => {
      const shell = createModuleShell(audioCtx, preFX, wetBus);
      modules[key] = { shell, fx: builders[key](audioCtx, shell) };
    });

    applyMasterMix();
    applyMasterVolume();
    applyAllParamsFromUI();
  }

  function applyMasterMix() {
    const pct = +masterMixSlider.value;
    masterMixVal.textContent = pct;
    if (!audioCtx) return;
    const mix = pct / 100;
    const now = audioCtx.currentTime;
    dryGain.gain.setTargetAtTime(Math.cos(mix * Math.PI / 2), now, 0.03);
    masterWetGain.gain.setTargetAtTime(Math.sin(mix * Math.PI / 2), now, 0.03);
  }
  function applyMasterVolume() {
    const pct = +masterVolSlider.value;
    masterVolVal.textContent = pct + "%";
    if (!audioCtx) return;
    masterVolume.gain.setTargetAtTime(pct / 100, audioCtx.currentTime, 0.03);
  }
  function applyInputTrim() {
    const pct = +inputTrimSlider.value;
    inputTrimVal.textContent = pct + "%";
    if (!audioCtx) return;
    inputTrim.gain.setTargetAtTime(pct / 100, audioCtx.currentTime, 0.02);
  }

  masterMixSlider.addEventListener("input", applyMasterMix);
  masterVolSlider.addEventListener("input", applyMasterVolume);
  inputTrimSlider.addEventListener("input", applyInputTrim);
  randomSpeedSlider.addEventListener("input", () => {
    randomSpeedVal.textContent = randomSpeedSlider.value;
  });

  // ---- generic param binding (fader <-> AudioParam <-> random walk) -----

  const allParamEntries = [];
  const paramIndex = {};

  function onChangeFor(panelKey, paramKey) {
    return (v, now) => {
      const mod = modules[panelKey];
      if (!mod) return;
      if (paramKey === "mix") { mod.shell.setMix(v, now); return; }
      const setterName = "set" + paramKey[0].toUpperCase() + paramKey.slice(1);
      if (typeof mod.fx[setterName] === "function") mod.fx[setterName](v, now);
    };
  }

  function bindParam(panelKey, key, cfg) {
    const panel = document.querySelector(`.panel.fx[data-fx="${panelKey}"]`);
    const root = panel.querySelector(`.param[data-param="${key}"]`);
    const slider = root.querySelector(".param-slider");
    const valueEl = root.querySelector(".param-value");
    const rndToggle = root.querySelector(".rnd-toggle");
    const onChange = onChangeFor(panelKey, key);

    function apply(pct) {
      const v = toValue(pct, cfg);
      const now = audioCtx ? audioCtx.currentTime : 0;
      onChange(v, now);
      valueEl.textContent = formatVal(v, cfg);
    }

    slider.addEventListener("input", () => apply(+slider.value));
    apply(+slider.value);

    const entry = { panelKey, key, slider, valueEl, rndToggle, apply, cfg };
    paramIndex[panelKey + ":" + key] = entry;

    if (rndToggle) {
      rndToggle.closest(".rnd").classList.toggle("active", rndToggle.checked);
      rndToggle.addEventListener("change", () => {
        rndToggle.closest(".rnd").classList.toggle("active", rndToggle.checked);
      });
      if (cfg.randomRange) {
        entry.drift = makeDrift(cfg.randomRange[0], cfg.randomRange[1], +slider.value);
        entry.driftBaseRate = cfg.driftRate || 0.06;
        allParamEntries.push(entry);
      }
    }
    return entry;
  }

  function registerFxPanel(panelKey, paramKeys) {
    paramKeys.forEach((pk) => bindParam(panelKey, pk, FX_PARAM_CONFIGS[panelKey][pk]));
    const panel = document.querySelector(`.panel.fx[data-fx="${panelKey}"]`);
    const enableCb = panel.querySelector(".fx-enable");
    enableCb.addEventListener("change", () => {
      const now = audioCtx ? audioCtx.currentTime : 0;
      if (modules[panelKey]) modules[panelKey].shell.setEnabled(enableCb.checked, now);
    });
  }

  registerFxPanel("looper", ["time", "feedback", "mix"]);
  registerFxPanel("delay16", ["time", "feedback", "wobble", "mix"]);
  registerFxPanel("grmdelay", ["attack", "sustain", "tone", "mix"]);
  registerFxPanel("chaos", ["rate", "density", "crush", "mix"]);
  registerFxPanel("vibrato", ["rate", "depth", "mix"]);

  function applyAllParamsFromUI() {
    Object.values(paramIndex).forEach((entry) => entry.apply(+entry.slider.value));
    document.querySelectorAll(".panel.fx").forEach((panel) => {
      const key = panel.dataset.fx;
      const checkbox = panel.querySelector(".fx-enable");
      if (modules[key]) modules[key].shell.setEnabled(checkbox.checked, audioCtx.currentTime);
    });
  }

  // ---- looper / chaos buttons -------------------------------------------

  document.querySelector('[data-fx="looper"] .fx-freeze').addEventListener("click", (e) => {
    if (!modules.looper) return;
    const frozen = modules.looper.fx.toggleFreeze();
    e.currentTarget.classList.toggle("active", frozen);
  });
  document.querySelector('[data-fx="looper"] .fx-jump').addEventListener("click", () => {
    if (!modules.looper) return;
    const t = modules.looper.fx.jump();
    const entry = paramIndex["looper:time"];
    if (entry) {
      entry.slider.value = fromValue(t, entry.cfg);
      entry.apply(+entry.slider.value);
    }
  });
  document.querySelector('[data-fx="chaos"] .fx-trigger').addEventListener("click", () => {
    if (modules.chaos) modules.chaos.fx.triggerNow();
  });

  // ---- randomize now ------------------------------------------------------

  randomizeNowBtn.addEventListener("click", () => {
    allParamEntries.forEach((entry) => {
      if (entry.rndToggle && entry.rndToggle.checked && entry.drift) entry.drift.reroll(true);
    });
  });

  // ---- shared logic tick (random walk + chaos gate) ------------------------

  setInterval(() => {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const speed = +randomSpeedSlider.value / 100;
    const rateMul = 0.15 + speed * 1.6;
    allParamEntries.forEach((entry) => {
      if (entry.rndToggle && entry.rndToggle.checked) {
        const pct = entry.drift.tick(entry.driftBaseRate * rateMul);
        entry.slider.value = pct;
        entry.apply(pct);
      }
    });
    if (modules.chaos) modules.chaos.fx.tick(now);
  }, 70);

  // ---- input device handling ----------------------------------------------
  //
  // This mirrors the proven flow from an earlier working app (glitchbox):
  // ONE button both requests mic permission and starts, in a single real
  // user gesture (satisfies every browser's activation requirement, unlike
  // a separate priming step). The device list only gets populated *after*
  // that first connection succeeds (that's the only point real labels are
  // unlocked), and picking a different device from the dropdown afterward
  // hot-swaps the input live via its own getUserMedia call. Every step is
  // also written to the on-page diagnostics log.

  log(`secure context: ${window.isSecureContext ? "yes" : "no"}, protocol: ${location.protocol}`);
  const mediaDevicesAvailable = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  log(`mediaDevices API: ${mediaDevicesAvailable ? "available" : "NOT available"}`);

  if (!mediaDevicesAvailable) {
    secureWarning.hidden = false;
    statusEl.textContent = "マイクAPIが利用できません (file://で開いていませんか?)";
    startBtn.disabled = true;
    deviceSelect.innerHTML = '<option value="">(利用不可)</option>';
  } else if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "microphone" }).then(
      (status) => {
        log(`microphone permission state: ${status.state}`);
        if (status.state === "denied") {
          log("以前マイクがブロックされています。ブラウザのサイト設定から許可に変更してください。", "err");
        }
      },
      () => log("permissions API: microphoneクエリ非対応 (Safari等)")
    );
  }

  // ---- output check (works with no mic at all) --------------------------
  //
  // The whole input-permission flow can be 100% correct and the user can
  // still hear nothing, because Web Audio's destination just plays through
  // whatever the OS/browser currently considers the default output device
  // — on a Mac with a Fireface that's a very common mismatch (e.g. system
  // output set to the Fireface but TotalMix not routing the computer
  // return to the monitored output, or vice versa with built-in speakers).
  // This button proves or disproves that in one click, independent of any
  // mic/getUserMedia code path above.

  const sinkIdSupported =
    typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
  if (!sinkIdSupported) {
    log("AudioContext.setSinkId 非対応ブラウザ — 出力デバイスの切り替えはOS/ブラウザ側で行ってください");
  }

  let testToneCtx = null;
  testToneBtn.addEventListener("click", async () => {
    testToneBtn.disabled = true;
    try {
      const ctx = audioCtx || (testToneCtx = testToneCtx || new (window.AudioContext || window.webkitAudioContext)());
      if (ctx.state === "suspended") await ctx.resume();
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 440;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.25, now + 0.05);
      g.gain.setValueAtTime(0.25, now + 0.7);
      g.gain.linearRampToValueAtTime(0, now + 0.9);
      osc.start(now);
      osc.stop(now + 1);
      log(`テスト音再生 (440Hz/1秒) — AudioContext state: ${ctx.state}, sinkId: ${ctx.sinkId ?? "(既定)"}`, "ok");
      await refreshOutputDeviceList();
    } catch (err) {
      log(`テスト音エラー: ${err.name}: ${err.message}`, "err");
    } finally {
      setTimeout(() => { testToneBtn.disabled = false; }, 300);
    }
  });

  async function refreshOutputDeviceList() {
    if (!mediaDevicesAvailable) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      log(`enumerateDevices: ${outputs.length}件の出力デバイス`);
      if (!sinkIdSupported || outputs.length === 0) return;
      const prev = outputSelect.value;
      outputSelect.innerHTML = "";
      const defOpt = document.createElement("option");
      defOpt.value = "";
      defOpt.textContent = "既定の出力";
      outputSelect.appendChild(defOpt);
      outputs.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `出力デバイス ${i + 1}`;
        outputSelect.appendChild(opt);
      });
      if (outputs.some((d) => d.deviceId === prev)) outputSelect.value = prev;
      outputSelect.disabled = false;
    } catch (err) {
      log(`出力デバイス一覧取得失敗: ${err.name}: ${err.message}`, "err");
    }
  }

  outputSelect.addEventListener("change", async () => {
    const ctx = audioCtx || testToneCtx;
    if (!ctx || !sinkIdSupported) return;
    try {
      await ctx.setSinkId(outputSelect.value);
      log(`出力デバイスを切り替え: ${outputSelect.selectedOptions[0]?.textContent}`, "ok");
    } catch (err) {
      log(`出力切り替え失敗: ${err.name}: ${err.message}`, "err");
    }
  });

  // deviceId "" means "browser default" — no exact constraint
  function openStream(deviceId) {
    const constraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    };
    if (deviceId) constraints.deviceId = { exact: deviceId };
    return getUserMediaWithTimeout({ audio: constraints });
  }

  async function refreshDeviceList(selectedDeviceId) {
    if (!mediaDevicesAvailable) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      log(`enumerateDevices: ${inputs.length}件の入力デバイス`);
      deviceSelect.innerHTML = "";
      const defOpt = document.createElement("option");
      defOpt.value = "";
      defOpt.textContent = "既定の入力";
      deviceSelect.appendChild(defOpt);
      inputs.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `入力デバイス ${i + 1}`;
        deviceSelect.appendChild(opt);
      });
      deviceSelect.value = selectedDeviceId || "";
      deviceSelect.disabled = false;
      await refreshOutputDeviceList();
    } catch (err) {
      log(`enumerateDevices失敗: ${err.name}: ${err.message}`, "err");
    }
  }

  async function switchDevice(deviceId) {
    if (!mediaStream) return; // not running yet — nothing to switch
    deviceSelect.disabled = true;
    statusEl.textContent = "入力デバイスを切り替えています…";
    log(`デバイス切り替え: ${deviceSelect.selectedOptions[0]?.textContent || deviceId || "既定"} をリクエスト中…`);
    try {
      const newStream = await openStream(deviceId);
      mediaStream.getTracks().forEach((t) => t.stop());
      if (sourceNode) sourceNode.disconnect();
      mediaStream = newStream;
      sourceNode = audioCtx.createMediaStreamSource(mediaStream);
      sourceNode.connect(inputTrim);
      const track = mediaStream.getAudioTracks()[0];
      log(`切り替え成功: ${track ? track.label : "既定の入力"}`, "ok");
      await refreshDeviceList(deviceId);
      statusEl.textContent = "入力中: " + (track ? track.label || "既定の入力" : "既定の入力");
    } catch (err) {
      log(`切り替え失敗: ${err.name}: ${err.message}`, "err");
      statusEl.textContent = "デバイスを切り替えられませんでした: " + explainError(err);
    } finally {
      deviceSelect.disabled = false;
    }
  }

  deviceSelect.addEventListener("change", () => switchDevice(deviceSelect.value));
  if (mediaDevicesAvailable && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      log("devicechangeイベント検出");
      if (mediaStream) refreshDeviceList(deviceSelect.value);
    });
  }

  // ---- start / stop --------------------------------------------------------

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    statusEl.textContent = "マイクへのアクセスを許可してください…";
    log("起動: getUserMediaをリクエスト中(ブラウザの許可ダイアログを確認してください)…");
    try {
      mediaStream = await openStream(deviceSelect.value);
      const track = mediaStream.getAudioTracks()[0];
      log(`getUserMedia成功: ${track ? track.label : "(no label)"}`, "ok");

      if (!audioCtx) buildGraphOnce();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      log(`AudioContext state: ${audioCtx.state}, sampleRate: ${audioCtx.sampleRate}`);

      sourceNode = audioCtx.createMediaStreamSource(mediaStream);
      sourceNode.connect(inputTrim);

      statusEl.textContent = "入力中: " + (track ? track.label || "既定の入力" : "既定の入力");
      stopBtn.disabled = false;
      recordBtn.disabled = false;
      await refreshDeviceList(track ? track.getSettings().deviceId : "");
    } catch (err) {
      log(`起動失敗: ${err.name}: ${err.message}`, "err");
      statusEl.textContent = "マイクに接続できませんでした: " + explainError(err);
    } finally {
      startBtn.disabled = false;
    }
  });

  stopBtn.addEventListener("click", () => {
    if (sourceNode) { try { sourceNode.disconnect(); } catch (e) {} sourceNode = null; }
    if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
    log("停止しました");
    statusEl.textContent = "停止中";
    startBtn.disabled = false;
    stopBtn.disabled = true;
    deviceSelect.disabled = true;
    deviceSelect.innerHTML = '<option value="">接続すると一覧が表示されます</option>';
  });

  // ---- recording -------------------------------------------------------

  function pickMimeType() {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  function addTake(url) {
    const div = document.createElement("div");
    div.className = "take";
    const time = new Date().toLocaleTimeString("ja-JP");
    const label = document.createElement("span");
    label.textContent = time;
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = url;
    const a = document.createElement("a");
    a.href = url;
    a.download = `drift-rack-${Date.now()}.webm`;
    a.textContent = "ダウンロード";
    div.appendChild(label);
    div.appendChild(audio);
    div.appendChild(a);
    takesEl.prepend(div);
  }

  recordBtn.addEventListener("click", () => {
    if (!recordDest) return;
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      recordedChunks = [];
      const mime = pickMimeType();
      mediaRecorder = mime
        ? new MediaRecorder(recordDest.stream, { mimeType: mime })
        : new MediaRecorder(recordDest.stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        addTake(URL.createObjectURL(blob));
      };
      mediaRecorder.start();
      recordBtn.textContent = "■ 録音停止";
      recordBtn.classList.add("active");
    } else {
      mediaRecorder.stop();
      recordBtn.textContent = "● 録音開始";
      recordBtn.classList.remove("active");
    }
  });

  // ---- level meter --------------------------------------------------------

  const meterCtx = meterCanvas.getContext("2d");
  let meterData = null;

  function drawMeter() {
    requestAnimationFrame(drawMeter);
    meterCtx.clearRect(0, 0, meterCanvas.width, meterCanvas.height);
    meterCtx.fillStyle = "rgba(234, 230, 223, 0.06)";
    meterCtx.fillRect(0, 0, meterCanvas.width, meterCanvas.height);
    if (!analyser) return;
    if (!meterData) meterData = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(meterData);
    let peak = 0;
    for (let i = 0; i < meterData.length; i++) {
      const v = Math.abs(meterData[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    const w = Math.min(meterCanvas.width, peak * meterCanvas.width * 1.4);
    meterCtx.fillStyle = peak > 0.85 ? "#ff6b6b" : peak > 0.6 ? "#ffd166" : "#7fd6ff";
    meterCtx.fillRect(0, 0, w, meterCanvas.height);
  }
  requestAnimationFrame(drawMeter);
})();
