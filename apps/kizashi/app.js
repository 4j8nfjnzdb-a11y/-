// kizashi — generative ambient
//
// The idea: build a texture that reads as "repetition" (steady pulse,
// familiar scale, cyclic pads) while every layer runs on its own
// incommensurate clock and a slowly-drifting probability of firing at
// all. The listener's short-term predictive model never quite locks in
// — each layer swerves a little before it would become obvious — but
// nothing is ever pure noise either. That balance is tuned by the
// "swerve" and "density" sliders.

(() => {
  const playBtn = document.getElementById("playBtn");
  const paletteBtn = document.getElementById("paletteBtn");
  const densitySlider = document.getElementById("density");
  const toneSlider = document.getElementById("tone");
  const swerveSlider = document.getElementById("swerve");
  const canvas = document.getElementById("bg");
  const ctx2d = canvas.getContext("2d");

  let audioCtx = null;
  let master, dry, wet, reverbNode, delayA, delayB, delayFeedbackA, delayFeedbackB;
  let padVoices = [];
  let bellLayers = [];
  let running = false;
  let schedulerTimer = null;

  // ---- musical material -------------------------------------------

  const SCALES = {
    // semitone offsets from root, chosen to always sound consonant
    // no matter which degree becomes the melodic center
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
    // tone: 0..100 -> warm..bright
    if (tone < 33) return SCALES.warm;
    if (tone < 66) return SCALES.mid;
    return SCALES.bright;
  }

  function pickDegree(layer) {
    const scale = scaleForTone(+toneSlider.value);
    const degree = scale[Math.floor(Math.random() * scale.length)];
    return palette.root + degree + layer.octave * 12;
  }

  // ---- smoothed randomness (organic "swerve", not white noise) -----

  function makeDrift(min, max, start) {
    let value = start ?? (min + max) / 2;
    let target = value;
    return {
      get value() { return value; },
      tick(rate) {
        if (Math.random() < 0.08) {
          target = min + Math.random() * (max - min);
        }
        value += (target - value) * rate;
        return value;
      },
    };
  }

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

    // two non-multiple delay lines, damped feedback, for a soft
    // shimmering space that never quite settles into a fixed comb
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

  // ---- pad drone layer: slow, cyclic-feeling, never exactly cyclic --

  function buildPads() {
    padVoices.forEach((v) => v.stopAll && v.stopAll());
    padVoices = [];

    const intervals = [0, 7, 12, 16]; // root, fifth, octave, tenth-ish
    intervals.forEach((iv, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      const detune = (Math.random() * 2 - 1) * 6;
      osc.detune.value = detune;

      const gain = audioCtx.createGain();
      gain.gain.value = 0;

      const filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      filter.Q.value = 0.4;

      osc.connect(filter).connect(gain);
      sendToSpace(gain, 0.5, 0.8, 0.25);

      osc.start();

      // each voice's filter LFO period is an irrational-ish multiple
      // of the others, so the ensemble never repeats a combined shape
      const lfoPeriod = 17 + i * 6.28 + Math.random() * 4;
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

  // ---- sparse melodic "bell" layers ----------------------------------
  // Each layer keeps its own clock. On every tick it may or may not
  // fire, governed by a probability that random-walks between a low
  // and high bound — the swerve control widens or narrows that walk.

  function buildBellLayers() {
    bellLayers = [
      { octave: 1, baseInterval: 2.6, gain: 0.16, decayMin: 1.8, decayMax: 4.5,
        prob: makeDrift(0.15, 0.7, 0.4), jitter: makeDrift(-1, 1, 0), nextTime: 0 },
      { octave: 2, baseInterval: 1.7, gain: 0.11, decayMin: 1.2, decayMax: 3.0,
        prob: makeDrift(0.1, 0.65, 0.3), jitter: makeDrift(-1, 1, 0), nextTime: 0 },
      { octave: 3, baseInterval: 4.1, gain: 0.09, decayMin: 2.0, decayMax: 5.5,
        prob: makeDrift(0.08, 0.5, 0.2), jitter: makeDrift(-1, 1, 0), nextTime: 0 },
    ];
    const now = audioCtx.currentTime;
    bellLayers.forEach((l, i) => { l.nextTime = now + 1 + i * 0.7; });
  }

  function triggerBell(layer, time) {
    const midi = pickDegree(layer);
    const freq = midiToFreq(midi);
    const decay = layer.decayMin + Math.random() * (layer.decayMax - layer.decayMin);

    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const partial = audioCtx.createOscillator();
    partial.type = "sine";
    partial.frequency.value = freq * 2.01;
    const partialGain = audioCtx.createGain();
    partialGain.gain.value = 0.18;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(layer.gain, time + 0.03);
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

    spawnParticle(midi, panner.pan.value, decay);
  }

  function scheduleBells() {
    const now = audioCtx.currentTime;
    const lookahead = 0.25;
    const density = +densitySlider.value / 100;
    const swerve = +swerveSlider.value / 100;

    bellLayers.forEach((layer) => {
      while (layer.nextTime < now + lookahead) {
        const t = layer.nextTime;

        // probability itself drifts — this is the "dodge the
        // prediction just before it forms" mechanism
        const walkRate = 0.05 + swerve * 0.25;
        const p = layer.prob.tick(walkRate);
        const effectiveP = Math.min(0.95, p + density * 0.35);

        if (Math.random() < effectiveP) {
          triggerBell(layer, t);
        }

        const jitterAmt = layer.jitter.tick(0.15) * (0.15 + swerve * 0.35);
        const interval = layer.baseInterval * (1 + jitterAmt) / (0.4 + density * 0.9);
        layer.nextTime = t + Math.max(0.35, interval);
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

  // ---- visual: quiet drifting field, loosely tied to note events -----

  let particles = [];
  let hue = palette.hue;

  function resizeCanvas() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function spawnParticle(midi, pan, decay) {
    const w = canvas.width, h = canvas.height;
    const x = ((midi % 24) / 24) * w * 0.8 + w * 0.1;
    const y = h * 0.5 - pan * h * 0.32 + (Math.random() - 0.5) * h * 0.15;
    particles.push({
      x, y,
      r: 4 * devicePixelRatio,
      life: 0,
      maxLife: Math.max(1.5, decay),
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
    });
    if (particles.length > 120) particles.shift();
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
      const r = p.r * (1 + t * 8);
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
