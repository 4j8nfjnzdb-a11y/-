// たゆたう — pitch drift player
//
// You give it a sound. It plays that sound back on a loop while the pitch
// wanders — always centered on the note you gave it, never far from it,
// changing direction and taking a random amount of time to get there each
// time. Every step is eased in and out with zero velocity at both ends
// (a smootherstep curve), so the motion never has a corner: no sudden
// bend the ear can catch as a "change happening", just a continuous glide.
// The reverb tail is built from the same, already-drifting signal, so it
// glides along with it for free — and its wet level does its own slow,
// independent ebb and flow on top.

(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const dropLabel = document.getElementById("dropLabel");
  const filenameEl = document.getElementById("filename");
  const playBtn = document.getElementById("playBtn");
  const loopToggle = document.getElementById("loopToggle");
  const widthSlider = document.getElementById("width");
  const widthValue = document.getElementById("widthValue");
  const slownessSlider = document.getElementById("slowness");
  const slownessValue = document.getElementById("slownessValue");
  const reverbSlider = document.getElementById("reverb");
  const reverbValue = document.getElementById("reverbValue");
  const canvas = document.getElementById("scope");
  const ctx2d = canvas.getContext("2d");

  let audioCtx = null;
  let audioBuffer = null;
  let source = null;
  let master, dry, wet, reverbNode, wetGain;
  let running = false;
  let schedulerTimer = null;

  // ---- smootherstep: C2-continuous ease, zero velocity + zero
  // acceleration at both ends, so consecutive segments never kink -----

  function smootherstep(t) {
    t = Math.min(1, Math.max(0, t));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function buildCurve(fromVal, toVal, steps) {
    const arr = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const e = smootherstep(i / (steps - 1));
      arr[i] = fromVal + (toVal - fromVal) * e;
    }
    return arr;
  }

  // ---- a slow wandering param: schedules eased segments back-to-back,
  // each with a random target (within bounds) and a random duration,
  // always resolving toward "value" so the caller can inspect it -----

  function makeWanderer({ getBounds, getDurationRange, curveSteps = 180 }) {
    let value = 0;
    let nextStart = 0;
    return {
      get value() { return value; },
      reset(v, now) {
        value = v;
        nextStart = now;
      },
      tick(param, now, lookahead) {
        while (nextStart < now + lookahead) {
          const [lo, hi] = getBounds();
          const target = lo + Math.random() * (hi - lo);
          const [minDur, maxDur] = getDurationRange();
          const dur = minDur + Math.random() * (maxDur - minDur);
          const startAt = Math.max(nextStart, now);
          const curve = buildCurve(value, target, curveSteps);
          param.cancelScheduledValues(startAt);
          param.setValueCurveAtTime(curve, startAt, dur);
          value = target;
          nextStart = startAt + dur;
        }
      },
    };
  }

  let detuneWanderer, wetWanderer;

  // ---- audio graph ---------------------------------------------------

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

  function ensureContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function ensureGraph() {
    if (wet) return; // already built

    master = audioCtx.createGain();
    master.gain.value = 0.9;

    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    master.connect(compressor).connect(audioCtx.destination);

    dry = audioCtx.createGain();
    dry.gain.value = 0.8;
    dry.connect(master);

    wet = audioCtx.createGain();
    wet.gain.value = 1;
    wet.connect(master);

    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = buildImpulseResponse(audioCtx, 4.5, 2.6);

    wetGain = audioCtx.createGain();
    wetGain.gain.value = 0.4;
    reverbNode.connect(wetGain).connect(wet);

    detuneWanderer = makeWanderer({
      getBounds: () => {
        const cents = +widthSlider.value * 100;
        return [-cents, cents];
      },
      getDurationRange: () => {
        const base = +slownessSlider.value;
        return [base * 0.7, base * 1.6];
      },
    });

    wetWanderer = makeWanderer({
      getBounds: () => {
        const amt = +reverbSlider.value / 100;
        const span = 0.1 + amt * 0.55;
        const center = 0.15 + amt * 0.35;
        return [Math.max(0.02, center - span / 2), center + span / 2];
      },
      getDurationRange: () => {
        const base = +slownessSlider.value;
        return [base * 0.9, base * 2.0];
      },
    });
  }

  function startSource() {
    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = loopToggle.checked;

    const splitDry = audioCtx.createGain();
    splitDry.gain.value = 1;
    source.connect(splitDry);
    splitDry.connect(dry);
    splitDry.connect(reverbNode);

    source.detune.value = detuneWanderer.value;
    source.onended = () => {
      if (source && !source.loop) stop();
    };
    source.start();
    return source;
  }

  // ---- transport -------------------------------------------------

  function schedulerLoop() {
    if (!running || !source) return;
    const now = audioCtx.currentTime;
    const lookahead = 1.0;
    detuneWanderer.tick(source.detune, now, lookahead);
    wetWanderer.tick(wetGain.gain, now, lookahead);
    recordSample();
    schedulerTimer = setTimeout(schedulerLoop, 200);
  }

  function start() {
    if (!audioBuffer) return;
    ensureContext();
    ensureGraph();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    detuneWanderer.reset(detuneWanderer.value || 0, now);
    wetWanderer.reset(wetGain.gain.value, now);

    source = startSource();
    running = true;
    schedulerLoop();
    playBtn.textContent = "停止";
    playBtn.classList.add("playing");
  }

  function stop() {
    running = false;
    clearTimeout(schedulerTimer);
    if (source) {
      try { source.stop(); } catch (e) {}
      source = null;
    }
    playBtn.textContent = "再生";
    playBtn.classList.remove("playing");
  }

  playBtn.addEventListener("click", () => {
    if (running) stop(); else start();
  });

  // ---- file loading ------------------------------------------------

  async function loadFile(file) {
    if (!file) return;
    ensureContext();
    if (running) stop();

    dropLabel.textContent = "読み込み中…";
    try {
      const arrayBuffer = await file.arrayBuffer();
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      filenameEl.textContent = file.name;
      dropLabel.textContent = "音声ファイルをドラッグ、またはクリックして選択";
      playBtn.disabled = false;
      ensureGraph();
    } catch (err) {
      dropLabel.textContent = "読み込みに失敗しました。別のファイルをお試しください";
      playBtn.disabled = true;
      console.error(err);
    }
  }

  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => loadFile(e.target.files[0]));

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  loopToggle.addEventListener("change", () => {
    if (source) source.loop = loopToggle.checked;
  });

  // ---- slider readouts ------------------------------------------------

  function updateReadouts() {
    widthValue.textContent = `±${(+widthSlider.value).toFixed(1)}半音`;
    slownessValue.textContent = `約${slownessSlider.value}秒`;
    const r = +reverbSlider.value;
    reverbValue.textContent = r < 25 ? "小" : r < 60 ? "中" : "大";
  }
  [widthSlider, slownessSlider, reverbSlider].forEach((s) =>
    s.addEventListener("input", updateReadouts)
  );
  updateReadouts();

  // ---- visualization: scrolling strip chart of pitch + reverb -----

  const history = []; // { t, semis, wet }
  const HISTORY_SECONDS = 240;

  function recordSample() {
    // read the AudioParams' live, automation-interpolated values — not the
    // wanderers' internal "value", which jumps to each segment's target the
    // instant it's scheduled (that's what the next segment glides from, but
    // it is not what's actually sounding right now).
    const semis = (source ? source.detune.value : 0) / 100;
    const wetLevel = wetGain.gain.value;
    history.push({ t: performance.now() / 1000, semis, wet: wetLevel });
    const cutoff = performance.now() / 1000 - HISTORY_SECONDS;
    while (history.length && history[0].t < cutoff) history.shift();
  }

  function resizeCanvas() {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);

    ctx2d.fillStyle = "rgba(11, 13, 16, 0.9)";
    ctx2d.fillRect(0, 0, w, h);

    const midY = h * 0.55;
    const maxSemis = Math.max(0.5, +widthSlider.value);
    const scaleY = (h * 0.4) / maxSemis;

    // zero line
    ctx2d.strokeStyle = "rgba(234, 230, 223, 0.18)";
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(0, midY);
    ctx2d.lineTo(w, midY);
    ctx2d.stroke();

    if (history.length > 1) {
      const now = performance.now() / 1000;
      const oldest = now - HISTORY_SECONDS;

      const toXY = (p, key, scale, offset) => {
        const x = ((p.t - oldest) / HISTORY_SECONDS) * w;
        const y = offset - p[key] * scale;
        return [x, y];
      };

      // reverb wet level, faint fill
      ctx2d.beginPath();
      history.forEach((p, i) => {
        const [x, y] = toXY(p, "wet", h * 0.5, h * 0.98);
        if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
      });
      ctx2d.strokeStyle = "rgba(143, 184, 201, 0.55)";
      ctx2d.lineWidth = 1.5 * devicePixelRatio;
      ctx2d.stroke();

      // pitch, brighter line
      ctx2d.beginPath();
      history.forEach((p, i) => {
        const [x, y] = toXY(p, "semis", scaleY, midY);
        if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
      });
      ctx2d.strokeStyle = "rgba(234, 230, 223, 0.85)";
      ctx2d.lineWidth = 2 * devicePixelRatio;
      ctx2d.stroke();
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
