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

  // Every track re-samples a fixed-length window and only ever changes
  // pitch/speed via `rate` (a deliberate tape-style knob) - loop length and
  // delay time are never live-modulated, since ramping either is what
  // caused the pitch "funyan" wobble. min=0.25/max=3.25 puts rate=1x
  // (no pitch change) exactly at the default 25% slider position.
  const SPATIAL_TRACKS = ["spatial1", "spatial2", "spatial3", "spatial4"];
  const SPATIAL_LOOP_LEN_CFG = { min: 0.5, max: 14, exp: 1.4, unit: "s", decimals: 2 };

  const FX_PARAM_CONFIGS = {
    looper: {
      time: { min: 0.05, max: 30, exp: 1.6, unit: "s", decimals: 2 },
      feedback: { min: 0, max: 100, exp: 1, unit: "%", randomRange: [0, 85] },
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
  SPATIAL_TRACKS.forEach((key) => {
    FX_PARAM_CONFIGS[key] = {
      rate: { min: 0.25, max: 3.25, exp: 1, unit: "x", decimals: 2, randomRange: [0.4, 2.6] },
      mix: { min: 0, max: 100, exp: 1, unit: "%" },
    };
  });

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
    // Deliberately NOT connected to wetBusNode yet. A module with no path
    // to the destination is skipped entirely by the browser's audio graph
    // (standard reachability pruning) - so a bypassed module costs
    // essentially nothing, instead of silently running its full DSP (very
    // much including the AudioWorklet-based spatial tracks) forever just
    // to be multiplied by zero downstream.

    function setMix(pct, now) {
      const mix = Math.max(0, Math.min(100, pct)) / 100;
      dryGainNode.gain.setTargetAtTime(Math.cos(mix * Math.PI / 2), now, 0.03);
      wetGainNode.gain.setTargetAtTime(Math.sin(mix * Math.PI / 2), now, 0.03);
    }

    let connectedToWetBus = false;
    let disconnectTimer = null;
    function setEnabled(on, now) {
      clearTimeout(disconnectTimer);
      if (on) {
        if (!connectedToWetBus) {
          enableGain.connect(wetBusNode);
          connectedToWetBus = true;
        }
        enableGain.gain.setTargetAtTime(1, now, 0.05);
      } else {
        enableGain.gain.setTargetAtTime(0, now, 0.05);
        // wait for the ramp to actually reach ~silence before pruning the
        // connection, so bypassing never clicks
        disconnectTimer = setTimeout(() => {
          if (connectedToWetBus) {
            try { enableGain.disconnect(wetBusNode); } catch (e) {}
            connectedToWetBus = false;
          }
        }, 300);
      }
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

  // ---- effect 2: spatial delay bank track ---------------------------
  //
  // A track continuously records into a ring buffer (spatial-track-
  // processor.js) and loops a fixed-length recent window of it. The loop
  // boundary only ever changes via an explicit "recapture" (instant cut +
  // 20ms crossfade in the worklet) - never a live ramp - so nothing about
  // the loop's timing can ever cause the delay-time pitch wobble. Pitch/
  // speed change only comes from the `rate` param (deliberate, tape-style),
  // and position (pan + a distance cue via filtering/gain) drifts
  // independently per track.

  function buildSpatialTrack(ctx, shell, index) {
    const worklet = new AudioWorkletNode(ctx, "spatial-track-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    shell.input.connect(worklet);
    worklet.port.onmessage = (e) => {
      if (e.data && e.data.type === "error") {
        log(`Track ${index + 1}: 内部エラーから自動復帰しました (${e.data.message})`, "err");
      }
    };
    const rateParam = worklet.parameters.get("rate");

    const depthFilter = ctx.createBiquadFilter();
    depthFilter.type = "lowpass";
    depthFilter.frequency.value = 18000;
    const depthGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = (index - 1.5) * 0.4;

    worklet.connect(depthFilter).connect(depthGain).connect(panner).connect(shell.wetTap);

    let manualReverse = false;
    let reverseRandomEnabled = false;
    let lastLoopLenSeconds = 2;
    let autoTimer = null;

    function setRate(v, now) { rateParam.setTargetAtTime(v, now, 0.15); }

    function setLoopLenSeconds(sec) { lastLoopLenSeconds = sec; }
    function setManualReverse(on) { manualReverse = on; }
    function getManualReverse() { return manualReverse; }
    function setReverseRandom(on) { reverseRandomEnabled = on; }

    function recapture(forceReverse) {
      const reverse = forceReverse !== undefined
        ? forceReverse
        : (reverseRandomEnabled ? Math.random() < 0.5 : manualReverse);
      worklet.port.postMessage({ type: "recapture", loopLenSeconds: lastLoopLenSeconds, reverse });
      scheduleAutoRecapture();
    }
    function scheduleAutoRecapture() {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => recapture(), (4 + Math.random() * 16) * 1000);
    }

    function setPosition(pan, depth01, now) {
      panner.pan.setTargetAtTime(pan, now, 0.15);
      depthFilter.frequency.setTargetAtTime(700 + (1 - depth01) * 17300, now, 0.15);
      depthGain.gain.setTargetAtTime(1 - depth01 * 0.7, now, 0.15);
    }

    scheduleAutoRecapture();

    return { setRate, setLoopLenSeconds, setManualReverse, getManualReverse, setReverseRandom, setPosition, recapture };
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

  async function buildGraphOnce() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx = ctx;
    try {
      await buildGraphInto(ctx);
    } catch (err) {
      // A half-built graph is worse than no graph: with audioCtx left
      // non-null, every later Start click would skip buildGraphOnce
      // entirely (`if (!audioCtx)`) and crash on nodes that were never
      // created. Tear down and null it out so the next attempt is a full,
      // clean retry instead of getting stuck broken forever.
      log(`グラフ構築エラー: ${err.name}: ${err.message}`, "err");
      try { await ctx.close(); } catch (e) {}
      audioCtx = null;
      throw err;
    }
  }

  // addModule() requires the response to carry a JavaScript MIME type
  // (text/javascript etc). Some local static servers (older Python
  // versions, misconfigured mimetypes on the OS) send .js as text/plain
  // or application/octet-stream instead, which Chrome/Firefox refuse to
  // load as a module - fetch()+Blob sidesteps that entirely by setting
  // the MIME type ourselves, independent of whatever header the server
  // actually sent.
  async function loadWorkletModule(ctx, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} の取得に失敗 (HTTP ${res.status})`);
      const code = await res.text();
      const blobUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } catch (fetchErr) {
      // fetch() to a file:// URL is blocked outright by Chrome/Firefox as a
      // security measure (even a same-folder file, even though a plain
      // <script src> to that same URL works fine) - this is exactly what
      // "TypeError: Failed to fetch" under protocol:file: means, and no
      // amount of retrying will ever fix it. addModule()'s own internal
      // module-fetching algorithm is the same one <script src> uses and
      // isn't subject to that restriction, so fall back to handing it the
      // URL directly. This sacrifices the MIME-type workaround for that
      // one case, but a file:// page was never going to hit a server MIME
      // mismatch in the first place.
      try {
        await ctx.audioWorklet.addModule(url);
      } catch (directErr) {
        throw fetchErr; // the fetch error is usually the more informative one
      }
    }
  }

  async function tryLoadSpatialWorklet(audioCtx) {
    // Retry a couple of times before giving up: a transient blip on the
    // very first fetch() of a fresh page load (cold cache, a moment where
    // the local server or the OS network stack isn't quite ready yet) was
    // found to be enough to disable the spatial bank for the rest of the
    // session - and once audioCtx exists, buildGraphOnce/buildGraphInto
    // never run again, so that one bad first attempt used to be permanent
    // no matter what device got selected afterward.
    const attempts = 3;
    for (let i = 1; i <= attempts; i++) {
      try {
        log(`spatial-track-processor.js を読み込み中… (試行 ${i}/${attempts})`);
        await loadWorkletModule(audioCtx, "spatial-track-processor.js");
        log("AudioWorklet読み込み成功", "ok");
        return true;
      } catch (err) {
        log(`AudioWorklet読み込み失敗 (試行 ${i}/${attempts}): ${err.name}: ${err.message}`, "err");
        if (i < attempts) await new Promise((r) => setTimeout(r, 400));
      }
    }
    log("空間ディレイ・バンクのみ無効化して続行します(「🔄 空間ディレイ・バンクを再試行」でいつでも再試行できます)", "err");
    return false;
  }

  async function buildGraphInto(audioCtx) {
    const spatialBankAvailable = await tryLoadSpatialWorklet(audioCtx);

    inputTrim = audioCtx.createGain();
    // A pro interface like Fireface can hand back a track with far more
    // than 2 channels (its full input bank, not just the pair you picked).
    // Everything downstream - especially the spatial-bank AudioWorklet,
    // which only ever reads channel 0/1 - assumes stereo. Forcing it down
    // to exactly 2 channels right here, at the very first node the input
    // touches, means nothing later in the graph ever has to deal with
    // anything else, regardless of which input device is selected.
    inputTrim.channelCount = 2;
    inputTrim.channelCountMode = "explicit";
    inputTrim.channelInterpretation = "speakers";
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
      grmdelay: buildGrmDelay,
      chaos: buildChaos,
      vibrato: buildVibrato,
    };
    Object.keys(builders).forEach((key) => {
      const shell = createModuleShell(audioCtx, preFX, wetBus);
      modules[key] = { shell, fx: builders[key](audioCtx, shell) };
    });
    if (spatialBankAvailable) {
      SPATIAL_TRACKS.forEach((key, index) => {
        const shell = createModuleShell(audioCtx, preFX, wetBus);
        modules[key] = { shell, fx: buildSpatialTrack(audioCtx, shell, index) };
      });
    } else {
      markSpatialBankUnavailable();
    }

    applyMasterMix();
    applyMasterVolume();
    applyAllParamsFromUI();
    if (spatialBankAvailable) initSpatialTracksFromUI();
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
  registerFxPanel("grmdelay", ["attack", "sustain", "tone", "mix"]);
  registerFxPanel("chaos", ["rate", "density", "crush", "mix"]);
  registerFxPanel("vibrato", ["rate", "depth", "mix"]);
  SPATIAL_TRACKS.forEach((key) => registerFxPanel(key, ["rate", "mix"]));

  // ---- spatial track bespoke controls: loop length, reverse, radar -------
  //
  // These don't go through the generic bindParam system because they need
  // different semantics: loop length only takes effect on the *next*
  // recapture (never a live ramp), and radar position is a 2D pad, not a
  // fader.

  function wireLoopLenSlider(panelKey) {
    const panel = document.querySelector(`.panel.fx[data-fx="${panelKey}"]`);
    const root = panel.querySelector('.param[data-param="loopLen"]');
    const slider = root.querySelector(".param-slider");
    const valueEl = root.querySelector(".param-value");

    function display(pct) {
      const v = toValue(pct, SPATIAL_LOOP_LEN_CFG);
      valueEl.textContent = formatVal(v, SPATIAL_LOOP_LEN_CFG);
      return v;
    }
    display(+slider.value);

    slider.addEventListener("input", () => display(+slider.value));
    slider.addEventListener("change", () => {
      const v = display(+slider.value);
      if (modules[panelKey]) {
        modules[panelKey].fx.setLoopLenSeconds(v);
        modules[panelKey].fx.recapture(); // instant cut+crossfade, not a ramp — no wobble
      }
    });
  }

  function wireReverseControls(panelKey) {
    const panel = document.querySelector(`.panel.fx[data-fx="${panelKey}"]`);
    const btn = panel.querySelector(".reverse-btn");
    const rndToggle = panel.querySelector(".reverse-rnd-toggle");
    const resampleBtn = panel.querySelector(".resample-btn");

    btn.addEventListener("click", () => {
      if (!modules[panelKey]) return;
      const next = !modules[panelKey].fx.getManualReverse();
      modules[panelKey].fx.setManualReverse(next);
      btn.classList.toggle("active", next);
      modules[panelKey].fx.recapture(next);
    });
    rndToggle.addEventListener("change", () => {
      if (modules[panelKey]) modules[panelKey].fx.setReverseRandom(rndToggle.checked);
      rndToggle.closest(".rnd").classList.toggle("active", rndToggle.checked);
    });
    resampleBtn.addEventListener("click", () => {
      if (modules[panelKey]) modules[panelKey].fx.recapture();
    });
  }

  const spatialRadarState = {};

  function setupRadar(panelKey, defaultPan, defaultDepth) {
    const panel = document.querySelector(`.panel.fx[data-fx="${panelKey}"]`);
    const canvas = panel.querySelector("canvas.radar");
    const rndToggle = panel.querySelector(".radar-rnd-toggle");
    const g = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 4;

    const state = {
      pan: defaultPan,
      depth01: defaultDepth,
      randomEnabled: false,
      panDrift: makeDrift(-1, 1, defaultPan),
      depthDrift: makeDrift(0, 1, defaultDepth),
    };
    spatialRadarState[panelKey] = state;

    function applyPosition() {
      const now = audioCtx ? audioCtx.currentTime : 0;
      if (modules[panelKey]) modules[panelKey].fx.setPosition(state.pan, state.depth01, now);
    }

    function draw() {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "rgba(234, 230, 223, 0.15)";
      g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx, cy, r * 0.5, 0, Math.PI * 2); g.stroke();
      g.beginPath();
      g.moveTo(4, cy); g.lineTo(w - 4, cy);
      g.moveTo(cx, 4); g.lineTo(cx, h - 4);
      g.stroke();

      const px = cx + state.pan * (w / 2 - 8);
      const py = 8 + state.depth01 * (h - 16);
      const grad = g.createRadialGradient(px, py, 0, px, py, 9);
      grad.addColorStop(0, "rgba(255, 180, 84, 0.9)");
      grad.addColorStop(1, "rgba(255, 180, 84, 0)");
      g.fillStyle = grad;
      g.beginPath(); g.arc(px, py, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#ffb454";
      g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill();
    }

    function setFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      state.pan = Math.max(-1, Math.min(1, (x / w) * 2 - 1));
      state.depth01 = Math.max(0, Math.min(1, y / h));
      applyPosition();
      draw();
    }

    let dragging = false;
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      setFromEvent(e);
    });
    canvas.addEventListener("pointermove", (e) => { if (dragging) setFromEvent(e); });
    canvas.addEventListener("pointerup", () => { dragging = false; });

    rndToggle.addEventListener("change", () => {
      state.randomEnabled = rndToggle.checked;
      rndToggle.closest(".rnd").classList.toggle("active", rndToggle.checked);
    });

    state.draw = draw;
    state.applyPosition = applyPosition;
    draw();
  }

  SPATIAL_TRACKS.forEach((key, index) => {
    wireLoopLenSlider(key);
    wireReverseControls(key);
    setupRadar(key, (index - 1.5) * 0.4, 0.25 + index * 0.12);
  });

  function markSpatialBankUnavailable() {
    SPATIAL_TRACKS.forEach((key) => {
      const panel = document.querySelector(`.panel.fx[data-fx="${key}"]`);
      if (!panel || panel.querySelector(".unavailable-note")) return;
      panel.style.opacity = "0.45";
      const note = document.createElement("p");
      note.className = "fxdesc unavailable-note";
      note.textContent = "このブラウザ/環境ではAudioWorkletを読み込めなかったため無効です(診断ログ参照)。";
      panel.insertBefore(note, panel.firstChild.nextSibling);
    });

    const bankLabel = document.querySelector(".bank-label");
    if (bankLabel && !bankLabel.querySelector(".retry-worklet-btn")) {
      const btn = document.createElement("button");
      btn.className = "ghostBtn small retry-worklet-btn";
      btn.textContent = "🔄 空間ディレイ・バンクを再試行";
      btn.style.marginTop = "0.6rem";
      btn.addEventListener("click", retrySpatialBank);
      bankLabel.appendChild(btn);
    }
  }

  function clearSpatialBankUnavailable() {
    SPATIAL_TRACKS.forEach((key) => {
      const panel = document.querySelector(`.panel.fx[data-fx="${key}"]`);
      if (!panel) return;
      panel.style.opacity = "";
      const note = panel.querySelector(".unavailable-note");
      if (note) note.remove();
    });
    const retryBtn = document.querySelector(".retry-worklet-btn");
    if (retryBtn) retryBtn.remove();
  }

  // Recovers the spatial bank without a page reload: buildGraphOnce only
  // ever runs once per page, so a worklet failure on that first attempt
  // used to be permanent for the rest of the session (no matter which
  // input device got selected afterward) until this existed.
  let retryingSpatialBank = false;
  async function retrySpatialBank() {
    if (retryingSpatialBank || !audioCtx || modules.spatial1) return;
    retryingSpatialBank = true;
    log("空間ディレイ・バンクを手動で再試行中…");
    const ok = await tryLoadSpatialWorklet(audioCtx);
    if (ok) {
      SPATIAL_TRACKS.forEach((key, index) => {
        const shell = createModuleShell(audioCtx, preFX, wetBus);
        modules[key] = { shell, fx: buildSpatialTrack(audioCtx, shell, index) };
      });
      clearSpatialBankUnavailable();
      initSpatialTracksFromUI();
      SPATIAL_TRACKS.forEach((key) => {
        const panel = document.querySelector(`.panel.fx[data-fx="${key}"]`);
        const checkbox = panel && panel.querySelector(".fx-enable");
        if (checkbox && modules[key]) modules[key].shell.setEnabled(checkbox.checked, audioCtx.currentTime);
      });
      log("空間ディレイ・バンクが復旧しました", "ok");
    }
    retryingSpatialBank = false;
  }

  function initSpatialTracksFromUI() {
    SPATIAL_TRACKS.forEach((key) => {
      const mod = modules[key];
      if (!mod) return;
      const panel = document.querySelector(`.panel.fx[data-fx="${key}"]`);
      const loopSlider = panel.querySelector('.param[data-param="loopLen"] .param-slider');
      mod.fx.setLoopLenSeconds(toValue(+loopSlider.value, SPATIAL_LOOP_LEN_CFG));
      const reverseBtn = panel.querySelector(".reverse-btn");
      mod.fx.setManualReverse(reverseBtn.classList.contains("active"));
      mod.fx.recapture();
      const st = spatialRadarState[key];
      if (st) mod.fx.setPosition(st.pan, st.depth01, audioCtx.currentTime);
    });
  }

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
    SPATIAL_TRACKS.forEach((key) => {
      const st = spatialRadarState[key];
      if (!st || !st.randomEnabled) return; // static position: nothing to update or redraw
      st.pan = st.panDrift.tick(0.02 * rateMul);
      st.depth01 = st.depthDrift.tick(0.02 * rateMul);
      st.applyPosition();
      st.draw();
    });
  }, 90);

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

      if (!audioCtx) await buildGraphOnce();
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
