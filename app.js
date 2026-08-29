// ひまわり — fibonacci spiral music
//
// Inspired by Fibonacci-pulse ("time quasicrystal") driving schemes and by
// phyllotaxis — the golden-angle spiral sunflower seeds and pinecone
// scales grow in. The idea carried over here is not the physics itself,
// just its aesthetic core: a rule as simple as "add the previous two" or
// "step by one golden angle each time" produces a pattern that is
// perfectly ordered yet never exactly repeats.
//
// - Rhythm: each layer walks a Sturmian / mechanical word built from a
//   single ratio r. At r = 1/2 this is the plain alternating word ABAB...
//   (periodic, "resonant"). As r slides toward 1/φ it becomes the
//   Fibonacci word A→AB, B→A: AABABAABA... — the least periodic,
//   least resonant sequence of long (A) and short (B) pulses there is.
// - Melody: a running phase advances by r*scaleLength each step (a Beatty
//   sequence), spreading scale degrees as evenly and non-repeatingly as
//   the same ratio allows.
// - Visual: every triggered note is placed at angle i*r turns and radius
//   c*sqrt(i) from center — Vogel's model of a sunflower head. At r=1/2
//   the "spiral" collapses into two straight rows; near r=1/φ it opens
//   into the familiar interlocking spiral arms.
// - Timing/velocity carry a small 1/f (pink) noise wobble — the same
//   "1/fゆらぎ" fluctuation prized in acoustics and design, layered on
//   top of the deterministic rule rather than replacing it.

(() => {
  const playBtn = document.getElementById("playBtn");
  const paletteBtn = document.getElementById("paletteBtn");
  const densitySlider = document.getElementById("density");
  const toneSlider = document.getElementById("tone");
  const goldenSlider = document.getElementById("golden");
  const canvas = document.getElementById("bg");
  const ctx2d = canvas.getContext("2d");

  const PHI = (1 + Math.sqrt(5)) / 2;
  const GOLDEN_CONJ = PHI - 1; // ~0.6180339887

  let audioCtx = null;
  let master, dry, wet, reverbNode, delayA, delayB, delayFeedbackA, delayFeedbackB;
  let padVoices = [];
  let bellLayers = [];
  let running = false;
  let schedulerTimer = null;

  // ---- musical material -------------------------------------------

  const SCALES = {
    warm: [0, 2, 3, 7, 9, 10],      // dorian-ish, dusky
    mid: [0, 2, 4, 7, 9, 11],       // major/ionian, open
    bright: [0, 2, 4, 6, 9, 11],    // lydian-ish, lifted
  };

  const ROOTS = [48, 50, 53, 55, 57]; // C, D, F, G, A (midi, low register)

  let palette = makePalette();

  function makePalette() {
    const roots = ROOTS.slice();
    const root = roots[Math.floor(Math.random() * roots.length)];
    const hue = Math.random() * 360;
    return { root, hue };
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function scaleForTone(tone) {
    if (tone < 33) return SCALES.warm;
    if (tone < 66) return SCALES.mid;
    return SCALES.bright;
  }

  // r: 0..1 -> ratio between 1/2 (periodic) and 1/φ (golden, most quasi-periodic)
  function currentRatio() {
    const g = +goldenSlider.value / 100;
    return 0.5 + g * (GOLDEN_CONJ - 0.5);
  }

  // ---- 1/f (pink) noise, for organic micro-timing/velocity wobble ----

  function makePinkNoise() {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    return function pink() {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      return out * 0.11; // roughly in [-1, 1]
    };
  }
  const pink = makePinkNoise();

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

  function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    master = audioCtx.createGain();
    master.gain.value = 0.85;

    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;

    master.connect(compressor).connect(audioCtx.destination);

    dry = audioCtx.createGain();
    dry.gain.value = 0.55;
    dry.connect(master);

    wet = audioCtx.createGain();
    wet.gain.value = 0.9;

    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = buildImpulseResponse(audioCtx, 5.5, 3.0);
    reverbNode.connect(wet);
    wet.connect(master);

    delayA = audioCtx.createDelay(2.0);
    delayA.delayTime.value = 0.372;
    delayFeedbackA = audioCtx.createGain();
    delayFeedbackA.gain.value = 0.38;
    const dampA = audioCtx.createBiquadFilter();
    dampA.type = "lowpass";
    dampA.frequency.value = 2200;
    delayA.connect(dampA).connect(delayFeedbackA).connect(delayA);
    delayA.connect(wet);

    delayB = audioCtx.createDelay(2.0);
    delayB.delayTime.value = 0.551;
    delayFeedbackB = audioCtx.createGain();
    delayFeedbackB.gain.value = 0.33;
    const dampB = audioCtx.createBiquadFilter();
    dampB.type = "lowpass";
    dampB.frequency.value = 1800;
    delayB.connect(dampB).connect(delayFeedbackB).connect(delayB);
    delayB.connect(wet);

    buildPads();
    buildBellLayers();
  }

  function sendToSpace(node, delayAmt, reverbAmt, dryAmt) {
    const dg = audioCtx.createGain();
    dg.gain.value = dryAmt;
    node.connect(dg).connect(dry);

    const rg = audioCtx.createGain();
    rg.gain.value = reverbAmt;
    node.connect(rg).connect(reverbNode);

    const dla = audioCtx.createGain();
    dla.gain.value = delayAmt;
    node.connect(dla).connect(delayA);
    node.connect(dla).connect(delayB);
  }

  // ---- pad drone layer -------------------------------------------
  // Each voice's filter LFO period is the previous one times φ, so no
  // two layers' cycles ever line back up on each other.

  function buildPads() {
    padVoices.forEach((v) => v.stopAll && v.stopAll());
    padVoices = [];

    const intervals = [0, 7, 12, 16]; // root, fifth, octave, tenth-ish
    intervals.forEach((iv, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.detune.value = (Math.random() * 2 - 1) * 6;

      const gain = audioCtx.createGain();
      gain.gain.value = 0;

      const filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      filter.Q.value = 0.4;

      osc.connect(filter).connect(gain);
      sendToSpace(gain, 0.5, 0.8, 0.25);

      osc.start();

      const lfoPeriod = 12 * Math.pow(PHI, i);
      padVoices.push({
        osc, gain, filter, interval: iv,
        lfoPeriod, phase: Math.random() * Math.PI * 2,
        targetGain: 0.05 + Math.random() * 0.03,
        stopAll() { try { osc.stop(); } catch (e) {} },
      });
    });

    crossfadePadsToPalette(4);
  }

  function crossfadePadsToPalette(rampSeconds) {
    const now = audioCtx.currentTime;
    padVoices.forEach((v) => {
      const freq = midiToFreq(palette.root + v.interval);
      v.osc.frequency.cancelScheduledValues(now);
      v.osc.frequency.setValueAtTime(v.osc.frequency.value || freq, now);
      v.osc.frequency.linearRampToValueAtTime(freq, now + rampSeconds);

      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + rampSeconds * 0.5);
      v.gain.gain.linearRampToValueAtTime(v.targetGain, now + rampSeconds * 2);
    });
  }

  function updatePads(t) {
    padVoices.forEach((v) => {
      const lfo = Math.sin((t / v.lfoPeriod) * Math.PI * 2 + v.phase);
      const tone = +toneSlider.value / 100;
      const base = 500 + tone * 1400;
      v.filter.frequency.setTargetAtTime(base + lfo * 260, audioCtx.currentTime, 0.6);
    });
  }

  // ---- fibonacci-word bell layers -------------------------------------
  // Each layer has its own pulse period (successive Fibonacci numbers ×
  // a base unit, so the layers' tempi are themselves near-golden-ratio
  // multiples of each other) and its own Sturmian accumulator: every
  // step it adds the shared ratio r and fires a "long" (A) pulse when
  // the accumulator rolls over 1, a "short" (B) pulse otherwise. At
  // r = 1/φ this bit stream *is* the Fibonacci word.
  //
  // Pitch comes from a second accumulator (a Beatty sequence) stepping
  // through the current scale by r×scaleLength each time — same ratio,
  // same never-quite-repeating spread, applied to melody instead of time.

  const LAYER_FIB_PERIODS = [3, 5, 8]; // consecutive Fibonacci numbers

  function buildBellLayers() {
    bellLayers = LAYER_FIB_PERIODS.map((fibN, i) => ({
      octave: i + 1,
      period: 0.24 * fibN,
      gain: [0.17, 0.12, 0.09][i],
      decayMin: [1.6, 1.1, 1.9][i],
      decayMax: [3.8, 2.6, 5.0][i],
      acc: Math.random(),
      melodicAcc: Math.random() * 6,
      nextTime: 0,
    }));
    const now = audioCtx.currentTime;
    bellLayers.forEach((l, i) => { l.nextTime = now + 1 + i * 0.5; });
  }

  let noteIndex = 0;
  const SPIRAL_N = 320;

  function triggerBell(layer, time, long, r) {
    const scale = scaleForTone(+toneSlider.value);
    const scaleLen = scale.length;
    layer.melodicAcc = (layer.melodicAcc + r * scaleLen) % scaleLen;
    const degree = scale[Math.floor(layer.melodicAcc)];
    const midi = palette.root + degree + layer.octave * 12;
    const freq = midiToFreq(midi);
    const decay = layer.decayMin + Math.random() * (layer.decayMax - layer.decayMin);

    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    // a soft partial at the golden ratio itself, not a harmonic multiple
    const partial = audioCtx.createOscillator();
    partial.type = "sine";
    partial.frequency.value = freq * PHI;
    const partialGain = audioCtx.createGain();
    partialGain.gain.value = 0.15;

    const velocityWobble = 1 + pink() * 0.18;
    const level = layer.gain * (long ? 1.15 : 0.8) * velocityWobble;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(Math.max(0.01, level), time + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0005, time + decay);

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    const tone = +toneSlider.value / 100;
    filter.frequency.value = 700 + tone * 3500;
    filter.Q.value = 0.6;

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = (Math.random() * 2 - 1) * 0.7;

    osc.connect(filter);
    partial.connect(partialGain).connect(filter);
    filter.connect(env).connect(panner);

    sendToSpace(panner, 0.55, 0.7, 0.35);

    osc.start(time);
    partial.start(time);
    osc.stop(time + decay + 0.2);
    partial.stop(time + decay + 0.2);

    spawnParticle(midi, r, decay, long);
  }

  function scheduleBells() {
    const now = audioCtx.currentTime;
    const lookahead = 0.25;
    const density = +densitySlider.value / 100;
    const r = currentRatio();

    bellLayers.forEach((layer) => {
      while (layer.nextTime < now + lookahead) {
        const t = layer.nextTime;

        layer.acc += r;
        let long = false;
        if (layer.acc >= 1) {
          layer.acc -= 1;
          long = true;
        }

        // long ("A") pulses are the backbone of the fibonacci word and
        // fire almost every time; short ("B") pulses are optional
        // accents gated by density
        const fireProb = long ? 0.85 + density * 0.15 : density * 0.6;
        if (Math.random() < fireProb) {
          const jitter = pink() * 0.022; // seconds, the 1/f wobble
          triggerBell(layer, Math.max(now, t + jitter), long, r);
        }

        layer.nextTime = t + layer.period;
      }
    });
  }

  // ---- transport -------------------------------------------------

  let lastPadUpdate = 0;

  function schedulerLoop() {
    if (!running) return;
    scheduleBells();
    const t = audioCtx.currentTime;
    if (t - lastPadUpdate > 0.08) {
      updatePads(t);
      lastPadUpdate = t;
    }
    schedulerTimer = setTimeout(schedulerLoop, 60);
  }

  function start() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    running = true;
    schedulerLoop();
    playBtn.textContent = "停止";
    playBtn.classList.add("playing");
  }

  function stop() {
    running = false;
    clearTimeout(schedulerTimer);
    if (audioCtx) {
      const now = audioCtx.currentTime;
      master.gain.setTargetAtTime(0, now, 0.3);
      setTimeout(() => {
        if (!running) master.gain.setTargetAtTime(0.85, audioCtx.currentTime, 0.01);
      }, 1200);
    }
    playBtn.textContent = "再生";
    playBtn.classList.remove("playing");
  }

  playBtn.addEventListener("click", () => {
    if (running) stop(); else start();
  });

  paletteBtn.addEventListener("click", () => {
    palette = makePalette();
    if (audioCtx) crossfadePadsToPalette(6);
  });

  // ---- visual: golden-angle spiral (Vogel's sunflower model) -----
  // Note i is placed at angle i·r turns and radius c·√i from center.
  // r = 1/2 collapses the spiral into two straight rows; r → 1/φ opens
  // it into the interlocking arms seen in real sunflower heads.

  let particles = [];
  let hue = palette.hue;

  function resizeCanvas() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function spawnParticle(midi, r, decay, long) {
    const i = noteIndex++ % SPIRAL_N;
    const angle = i * r * Math.PI * 2;
    const w = canvas.width, h = canvas.height;
    const maxRadius = Math.min(w, h) * 0.44;
    const radius = maxRadius * Math.sqrt(i / SPIRAL_N);
    const cx = w / 2, cy = h / 2;
    particles.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      r: (long ? 5 : 3.2) * devicePixelRatio,
      life: 0,
      maxLife: Math.max(1.5, decay),
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3,
    });
    if (particles.length > 220) particles.shift();
  }

  function draw() {
    const w = canvas.width, h = canvas.height;
    hue = (hue + 0.01) % 360;
    const targetHue = palette.hue;
    hue += (targetHue - hue) * 0.0015;

    ctx2d.fillStyle = `hsla(${hue}, 30%, 4%, 0.18)`;
    ctx2d.fillRect(0, 0, w, h);

    particles.forEach((p) => {
      p.life += 1 / 60;
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      const t = p.life / p.maxLife;
      const alpha = Math.max(0, 1 - t) * 0.5;
      const r = p.r * (1 + t * 6);
      const grad = ctx2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `hsla(${hue}, 60%, 75%, ${alpha})`);
      grad.addColorStop(1, `hsla(${hue}, 60%, 75%, 0)`);
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
