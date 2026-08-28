// kizami — realtime granular looper
//
// Architecture, and why: an AudioWorklet just forwards the live input
// in ~46ms chunks (see granular-worklet.js) — no DSP on the audio
// thread beyond that copy, so it never glitches under load. The main
// thread writes those chunks into a 6-second ring buffer (a plain
// Float32Array pair) with a leaky-integrator mix for overdub ("sustain"),
// which is unconditionally stable — no clipping runaway to guard against.
// Grains are then just native AudioBufferSourceNodes reading directly
// out of that ring buffer via start(when, offset, duration): no per-grain
// copying, no AudioWorklet DSP, so the cost of raising density stays a
// browser-side node count rather than JS-side sample math. Everything
// after a grain (filter/drive/space) is shared, summed once, not
// duplicated per grain.

(() => {
  const startBtn = document.getElementById("startBtn");
  const audioError = document.getElementById("audioError");
  const freezeBtn = document.getElementById("freezeBtn");
  const reverseBtn = document.getElementById("reverseBtn");
  const stutterBtn = document.getElementById("stutterBtn");
  const clearBtn = document.getElementById("clearBtn");

  const sustainSlider = document.getElementById("sustain");
  const positionSlider = document.getElementById("position");
  const driftSlider = document.getElementById("drift");

  const sizeSlider = document.getElementById("size");
  const densitySlider = document.getElementById("density");
  const spraySlider = document.getElementById("spray");
  const pitchSlider = document.getElementById("pitch");
  const pitchSpraySlider = document.getElementById("pitchSpray");
  const reverseProbSlider = document.getElementById("reverseProb");
  const spreadSlider = document.getElementById("spread");
  const contourSelect = document.getElementById("contour");

  const filterFreqSlider = document.getElementById("filterFreq");
  const filterQSlider = document.getElementById("filterQ");
  const filterTypeSelect = document.getElementById("filterType");
  const driveSlider = document.getElementById("drive");
  const spaceSlider = document.getElementById("space");

  const canvas = document.getElementById("bg");
  const ctx2d = canvas.getContext("2d");

  const RING_SECONDS = 6;
  const MAX_GRAINS = 40;

  let audioCtx = null;
  let micStream = null;
  let captureNode = null;
  let liveBuffer = null, dataL = null, dataR = null;
  let ringLength = 0, sampleRate = 44100;
  let writeHead = 0;
  let frozen = false;
  let reverseMacro = false;
  let stutter = null;

  let grainBus, filterNode, driveNode, driveShaperAmount = 0, postGain;
  let dryGain, spaceSend, reverbNode, delayA, delayB, master;

  let running = false;
  let nextGrainTime = 0;
  let activeGrains = 0;
  let driftPhase = Math.random() * Math.PI * 2;
  let schedulerTimer = null;

  // ---- grain envelope shapes, precomputed once, shared by all grains --

  function makeCurve(shape) {
    const N = 64;
    const arr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      let v;
      if (shape === "click") {
        const a = 0.06;
        v = t < a ? t / a : Math.pow(1 - (t - a) / (1 - a), 2.5);
      } else if (shape === "swell") {
        const a = 0.94;
        v = t < a ? Math.pow(t / a, 2.5) : 1 - (t - a) / (1 - a);
      } else if (shape === "pluck") {
        const a = 0.03;
        v = t < a ? t / a : Math.pow(1 - (t - a) / (1 - a), 1.2);
      } else {
        v = 0.5 * (1 - Math.cos(2 * Math.PI * t)); // smooth / hann
      }
      arr[i] = Math.max(0, Math.min(1, v));
    }
    return arr;
  }

  const CURVES = {
    smooth: makeCurve("smooth"),
    click: makeCurve("click"),
    swell: makeCurve("swell"),
    pluck: makeCurve("pluck"),
  };

  function mapDensity(v) {
    return 2 + (v / 100) * 46; // grains/sec, 2..48
  }

  function mapFilterFreq(v) {
    const min = 80, max = 12000;
    return min * Math.pow(max / min, v / 100);
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

  function rebuildDriveCurve() {
    if (!driveNode) return;
    const amt = +driveSlider.value / 100;
    const k = 1 + amt * 18;
    const n = 256;
    const curve = new Float32Array(n);
    const norm = Math.tanh(k) || 1;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    driveNode.curve = curve;
  }

  function updateFilter() {
    if (!audioCtx) return;
    filterNode.type = filterTypeSelect.value;
    const now = audioCtx.currentTime;
    filterNode.frequency.setTargetAtTime(mapFilterFreq(+filterFreqSlider.value), now, 0.02);
    filterNode.Q.setTargetAtTime(0.1 + (+filterQSlider.value / 100) * 16, now, 0.02);
  }

  function updateSpace() {
    if (!audioCtx) return;
    spaceSend.gain.setTargetAtTime(+spaceSlider.value / 100, audioCtx.currentTime, 0.05);
  }

  // ---- audio graph -----------------------------------------------------

  async function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sampleRate = audioCtx.sampleRate;
    ringLength = Math.floor(RING_SECONDS * sampleRate);

    liveBuffer = audioCtx.createBuffer(2, ringLength, sampleRate);
    dataL = liveBuffer.getChannelData(0);
    dataR = liveBuffer.getChannelData(1);

    master = audioCtx.createGain();
    master.gain.value = 0.9;
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 4;
    master.connect(compressor).connect(audioCtx.destination);

    grainBus = audioCtx.createGain();
    grainBus.gain.value = 1.0;

    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = filterTypeSelect.value;

    driveNode = audioCtx.createWaveShaper();
    driveNode.oversample = "2x";
    rebuildDriveCurve();

    postGain = audioCtx.createGain();
    postGain.gain.value = 0.9;

    grainBus.connect(filterNode).connect(driveNode).connect(postGain);

    dryGain = audioCtx.createGain();
    dryGain.gain.value = 0.85;
    postGain.connect(dryGain).connect(master);

    spaceSend = audioCtx.createGain();
    spaceSend.gain.value = +spaceSlider.value / 100;
    postGain.connect(spaceSend);

    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = buildImpulseResponse(audioCtx, 4, 2.6);
    const reverbGain = audioCtx.createGain();
    reverbGain.gain.value = 0.9;
    reverbNode.connect(reverbGain).connect(master);
    spaceSend.connect(reverbNode);

    delayA = audioCtx.createDelay(1.0);
    delayA.delayTime.value = 0.33;
    const fbA = audioCtx.createGain();
    fbA.gain.value = 0.32;
    const dampA = audioCtx.createBiquadFilter();
    dampA.type = "lowpass";
    dampA.frequency.value = 2600;
    delayA.connect(dampA).connect(fbA).connect(delayA);
    spaceSend.connect(delayA);
    delayA.connect(master);

    delayB = audioCtx.createDelay(1.0);
    delayB.delayTime.value = 0.47;
    const fbB = audioCtx.createGain();
    fbB.gain.value = 0.28;
    const dampB = audioCtx.createBiquadFilter();
    dampB.type = "lowpass";
    dampB.frequency.value = 2000;
    delayB.connect(dampB).connect(fbB).connect(delayB);
    spaceSend.connect(delayB);
    delayB.connect(master);

    updateFilter();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
    });

    await audioCtx.audioWorklet.addModule("granular-worklet.js");
    const micSource = audioCtx.createMediaStreamSource(micStream);
    captureNode = new AudioWorkletNode(audioCtx, "capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: "explicit",
    });
    captureNode.port.onmessage = (e) => writeChunk(e.data.l, e.data.r);
    micSource.connect(captureNode);
  }

  function writeChunk(l, r) {
    if (frozen || !dataL) return;
    const sustainAmt = Math.min(0.99, +sustainSlider.value / 100);
    const inputGain = 1 - sustainAmt;
    const n = l.length;
    for (let i = 0; i < n; i++) {
      const idx = writeHead;
      dataL[idx] = dataL[idx] * sustainAmt + l[i] * inputGain;
      dataR[idx] = dataR[idx] * sustainAmt + r[i] * inputGain;
      writeHead++;
      if (writeHead >= ringLength) writeHead = 0;
    }
  }

  // ---- grain scheduling --------------------------------------------------

  function spawnGrain(time) {
    if (activeGrains >= MAX_GRAINS) return;
    const ringSec = ringLength / sampleRate;

    let sizeSec = Math.max(0.008, +sizeSlider.value / 1000);
    let readSec;

    if (stutter) {
      readSec = stutter.readSec;
      sizeSec = stutter.sizeSec;
    } else {
      const positionFrac = +positionSlider.value / 100;
      const driftAmt = +driftSlider.value / 100;
      const driftSec = Math.sin(driftPhase) * driftAmt * ringSec * 0.5;
      const sprayAmt = +spraySlider.value / 100;
      const spraySec = (Math.random() * 2 - 1) * sprayAmt * Math.min(1.5, ringSec * 0.3);

      let behindSec = positionFrac * ringSec + driftSec + spraySec;
      behindSec = ((behindSec % ringSec) + ringSec) % ringSec;

      const writeSec = writeHead / sampleRate;
      readSec = ((writeSec - behindSec) % ringSec + ringSec) % ringSec;
    }

    const isReverse = reverseMacro || Math.random() < (+reverseProbSlider.value / 100);
    const semis = (+pitchSlider.value) + (Math.random() * 2 - 1) * (+pitchSpraySlider.value);
    const rate = Math.pow(2, semis / 12);

    const envGain = audioCtx.createGain();
    envGain.gain.value = 0;
    const panner = audioCtx.createStereoPanner();
    const spreadAmt = +spreadSlider.value / 100;
    panner.pan.value = Math.max(-1, Math.min(1, (Math.random() * 2 - 1) * spreadAmt));

    const src = audioCtx.createBufferSource();

    if (isReverse) {
      const lenSamples = Math.max(1, Math.min(Math.floor(sizeSec * sampleRate), ringLength - 1));
      const startIdx = Math.floor(readSec * sampleRate);
      const snap = audioCtx.createBuffer(2, lenSamples, sampleRate);
      const outL = snap.getChannelData(0), outR = snap.getChannelData(1);
      for (let i = 0; i < lenSamples; i++) {
        const srcIdx = ((startIdx - i) % ringLength + ringLength) % ringLength;
        outL[i] = dataL[srcIdx];
        outR[i] = dataR[srcIdx];
      }
      src.buffer = snap;
      src.playbackRate.value = rate;
      src.start(time, 0, lenSamples / sampleRate);
    } else {
      src.buffer = liveBuffer;
      src.playbackRate.value = rate;
      src.start(time, readSec, sizeSec);
    }

    const curve = CURVES[contourSelect.value] || CURVES.smooth;
    envGain.gain.setValueCurveAtTime(curve, time, sizeSec);

    src.connect(envGain).connect(panner).connect(grainBus);

    activeGrains++;
    src.onended = () => {
      activeGrains--;
      try { src.disconnect(); } catch (e) {}
      try { envGain.disconnect(); } catch (e) {}
      try { panner.disconnect(); } catch (e) {}
    };
    try { src.stop(time + sizeSec + 0.03); } catch (e) {}

    spawnGrainParticle(readSec / ringSec, panner.pan.value);
  }

  function schedulerLoop() {
    if (!running) return;
    const now = audioCtx.currentTime;
    const lookahead = 0.2;
    const density = stutter ? 30 : mapDensity(+densitySlider.value);
    const interval = 1 / density;

    while (nextGrainTime < now + lookahead) {
      spawnGrain(nextGrainTime);
      nextGrainTime += interval;
    }

    const driftAmt = +driftSlider.value / 100;
    driftPhase += 0.04 * (0.03 + driftAmt * 0.6);

    schedulerTimer = setTimeout(schedulerLoop, 40);
  }

  // ---- transport / macros ------------------------------------------------

  function explainAudioError(err) {
    if (!window.isSecureContext) {
      return "このページは file:// または http:// で開かれているため、ブラウザがマイクへのアクセスを許可しません。" +
        "python3 -m http.server などでローカルサーバーを立て、http://localhost:.../granular.html として開いてください。";
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return "このブラウザは録音入力（getUserMedia）に対応していません。最新のChromeまたはFirefoxでお試しください。";
    }
    const name = err && err.name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "マイクの使用が拒否されています。アドレスバーのマイクアイコン（または設定）から許可し、再読み込みしてください。" +
        "OS側（システム設定 → プライバシーとセキュリティ → マイク）でブラウザの許可がオンになっているかもご確認ください。";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "マイク／オーディオ入力デバイスが見つかりません。接続と、OSの入力デバイス設定をご確認ください。";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "マイクが他のアプリで使用中のようです。他の通話・録音アプリを閉じてから再度お試しください。";
    }
    return `マイクにアクセスできません（${name || err}）。ページを再読み込みしてもう一度お試しください。`;
  }

  async function start() {
    startBtn.disabled = true;
    startBtn.textContent = "接続中…";
    audioError.hidden = true;
    try {
      if (!audioCtx) await initAudio();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      running = true;
      nextGrainTime = audioCtx.currentTime + 0.05;
      schedulerLoop();
      startBtn.textContent = "動作中";
      startBtn.classList.add("playing");
    } catch (err) {
      startBtn.textContent = "マイク入力を開始";
      audioError.textContent = explainAudioError(err);
      audioError.hidden = false;
      console.error(err);
    } finally {
      startBtn.disabled = false;
    }
  }

  startBtn.addEventListener("click", () => {
    if (!running) start();
  });

  freezeBtn.addEventListener("click", () => {
    frozen = !frozen;
    freezeBtn.classList.toggle("active", frozen);
  });

  reverseBtn.addEventListener("click", () => {
    reverseMacro = !reverseMacro;
    reverseBtn.classList.toggle("active", reverseMacro);
  });

  function beginStutter() {
    if (!audioCtx || !dataL) return;
    const ringSec = ringLength / sampleRate;
    const positionFrac = +positionSlider.value / 100;
    const writeSec = writeHead / sampleRate;
    const readSec = ((writeSec - positionFrac * ringSec) % ringSec + ringSec) % ringSec;
    stutter = { readSec, sizeSec: 0.04 + Math.random() * 0.05 };
    stutterBtn.classList.add("active");
  }
  function endStutter() {
    stutter = null;
    stutterBtn.classList.remove("active");
  }
  stutterBtn.addEventListener("pointerdown", beginStutter);
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    stutterBtn.addEventListener(ev, endStutter)
  );

  clearBtn.addEventListener("click", () => {
    if (!dataL) return;
    dataL.fill(0);
    dataR.fill(0);
  });

  [filterFreqSlider, filterQSlider, filterTypeSelect].forEach((el) =>
    el.addEventListener("input", updateFilter)
  );
  driveSlider.addEventListener("input", rebuildDriveCurve);
  spaceSlider.addEventListener("input", updateSpace);

  // ---- visual: ring-buffer waveform + write/read heads + grain flashes --

  let waveformCache = new Float32Array(0);
  let lastWaveformUpdate = 0;
  const WAVE_POINTS = 420;

  function updateWaveformCache() {
    if (!dataL) return;
    if (waveformCache.length !== WAVE_POINTS) waveformCache = new Float32Array(WAVE_POINTS);
    const stride = Math.max(1, Math.floor(ringLength / WAVE_POINTS));
    for (let i = 0; i < WAVE_POINTS; i++) {
      let peak = 0;
      const base = i * stride;
      for (let j = 0; j < stride; j += 5) {
        const v = Math.abs(dataL[base + j] || 0);
        if (v > peak) peak = v;
      }
      waveformCache[i] = peak;
    }
  }

  let particles = [];
  let hue = 24;

  function resizeCanvas() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function spawnGrainParticle(posFrac, pan) {
    const w = canvas.width, h = canvas.height;
    const x = posFrac * w;
    const y = h * 0.62 + pan * h * 0.12;
    particles.push({
      x, y, life: 0, maxLife: 0.5 + Math.random() * 0.4,
      r: 3 * devicePixelRatio,
    });
    if (particles.length > 160) particles.shift();
  }

  function draw(tMs) {
    const t = tMs / 1000;
    const w = canvas.width, h = canvas.height;

    if (t - lastWaveformUpdate > 0.15) {
      updateWaveformCache();
      lastWaveformUpdate = t;
    }

    ctx2d.fillStyle = `hsla(${hue}, 25%, 4%, 0.22)`;
    ctx2d.fillRect(0, 0, w, h);

    if (waveformCache.length) {
      const baseY = h * 0.62;
      const barW = w / WAVE_POINTS;
      ctx2d.fillStyle = `hsla(${hue}, 45%, 65%, 0.35)`;
      for (let i = 0; i < WAVE_POINTS; i++) {
        const amp = waveformCache[i] * h * 0.3;
        ctx2d.fillRect(i * barW, baseY - amp, Math.max(1, barW - 1), amp * 2);
      }

      if (ringLength) {
        const writeX = (writeHead / ringLength) * w;
        ctx2d.strokeStyle = "rgba(255, 157, 92, 0.85)";
        ctx2d.lineWidth = 2 * devicePixelRatio;
        ctx2d.beginPath();
        ctx2d.moveTo(writeX, baseY - h * 0.34);
        ctx2d.lineTo(writeX, baseY + h * 0.34);
        ctx2d.stroke();

        const ringSec = ringLength / sampleRate;
        const positionFrac = +positionSlider.value / 100;
        const driftAmt = +driftSlider.value / 100;
        const driftSec = Math.sin(driftPhase) * driftAmt * ringSec * 0.5;
        const behindSec = ((positionFrac * ringSec + driftSec) % ringSec + ringSec) % ringSec;
        const readFrac = (((writeHead / sampleRate - behindSec) % ringSec) + ringSec) % ringSec / ringSec;
        const readX = readFrac * w;
        ctx2d.strokeStyle = "rgba(234, 230, 223, 0.55)";
        ctx2d.lineWidth = 1.5 * devicePixelRatio;
        ctx2d.beginPath();
        ctx2d.moveTo(readX, baseY - h * 0.34);
        ctx2d.lineTo(readX, baseY + h * 0.34);
        ctx2d.stroke();
      }
    }

    particles.forEach((p) => {
      p.life += 1 / 60;
      const lt = p.life / p.maxLife;
      const alpha = Math.max(0, 1 - lt) * 0.6;
      const r = p.r * (1 + lt * 10);
      const grad = ctx2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `hsla(${hue}, 70%, 75%, ${alpha})`);
      grad.addColorStop(1, `hsla(${hue}, 70%, 75%, 0)`);
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx2d.fill();
    });
    particles = particles.filter((p) => p.life < p.maxLife);

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
