// hibana — realtime input instrument
//
// No transport, no sequencer: every event coming from the person at
// the keyboard or the pointer becomes sound and light immediately.
// Two keyboard rows act as two octaves of a pentatonic scale (any
// combination of notes stays consonant), and dragging the pointer
// works like a small theremin — y bends pitch, x bends brightness
// and stereo position.

(() => {
  const canvas = document.getElementById("bg");
  const ctx2d = canvas.getContext("2d");
  const paletteBtn = document.getElementById("paletteBtn");
  const volumeSlider = document.getElementById("volume");
  const hint = document.getElementById("hint");

  let audioCtx = null;
  let master, compressor, dry, wet, reverbNode, delayNode, delayFeedback;
  let theremin = null; // active drag voice, if any

  const SCALE = [0, 2, 4, 7, 9]; // major pentatonic — any subset stays consonant
  const ROWS = [
    { keys: "asdfghjkl;".split(""), octave: 0 },
    { keys: "qwertyuiop".split(""), octave: 1 },
  ];

  let root = 60; // C4
  let hue = Math.random() * 360;

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function noteForKey(rowIndex, keyIndex) {
    const row = ROWS[rowIndex];
    const octaveStep = Math.floor(keyIndex / SCALE.length);
    return root + row.octave * 12 + octaveStep * 12 + SCALE[keyIndex % SCALE.length];
  }

  function markInteracted() {
    hint.classList.add("faded");
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

  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    master = audioCtx.createGain();
    master.gain.value = (+volumeSlider.value / 100) * 0.9;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 4;
    master.connect(compressor).connect(audioCtx.destination);

    dry = audioCtx.createGain();
    dry.gain.value = 0.8;
    dry.connect(master);

    wet = audioCtx.createGain();
    wet.gain.value = 0.5;
    wet.connect(master);

    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = buildImpulseResponse(audioCtx, 1.6, 2.2);
    reverbNode.connect(wet);

    delayNode = audioCtx.createDelay(1.0);
    delayNode.delayTime.value = 0.22;
    delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.22;
    const damp = audioCtx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2600;
    delayNode.connect(damp).connect(delayFeedback).connect(delayNode);
    delayNode.connect(wet);

    volumeSlider.addEventListener("input", () => {
      master.gain.setTargetAtTime((+volumeSlider.value / 100) * 0.9, audioCtx.currentTime, 0.05);
    });
  }

  function sendToSpace(node, reverbAmt, delayAmt) {
    node.connect(dry);
    const rg = audioCtx.createGain();
    rg.gain.value = reverbAmt;
    node.connect(rg).connect(reverbNode);
    const dg = audioCtx.createGain();
    dg.gain.value = delayAmt;
    node.connect(dg).connect(delayNode);
  }

  // ---- plucked notes (keyboard, taps) --------------------------------

  function pluck(midi, x01, y01) {
    ensureAudio();
    const now = audioCtx.currentTime;
    const freq = midiToFreq(midi);
    const decay = 0.7 + Math.random() * 0.7;

    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    const sub = audioCtx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = freq * 2.005;
    const subGain = audioCtx.createGain();
    subGain.gain.value = 0.2;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(freq * 8 + 800, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 1.5), now + decay);

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.32, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0005, now + decay);

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = clamp(x01 * 2 - 1, -1, 1);

    osc.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(env).connect(panner);
    sendToSpace(panner, 0.35, 0.28);

    osc.start(now);
    sub.start(now);
    osc.stop(now + decay + 0.1);
    sub.stop(now + decay + 0.1);

    spawnBurst(x01, y01, decay);
  }

  // ---- theremin voice (pointer drag) ---------------------------------

  function startTheremin(x01, y01) {
    ensureAudio();
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    osc.type = "sawtooth";

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 4;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.08);

    const panner = audioCtx.createStereoPanner();

    osc.connect(filter).connect(gain).connect(panner);
    sendToSpace(panner, 0.3, 0.18);
    osc.start(now);

    theremin = { osc, filter, gain, panner, startX: x01, startY: y01, moved: false };
    updateTheremin(x01, y01);
  }

  function updateTheremin(x01, y01) {
    if (!theremin) return;
    const now = audioCtx.currentTime;
    if (Math.hypot(x01 - theremin.startX, y01 - theremin.startY) > 0.01) theremin.moved = true;

    const midi = root + 12 + (1 - y01) * 24 - 12; // ~2 octave span around root+12
    const freq = midiToFreq(midi);
    theremin.osc.frequency.setTargetAtTime(freq, now, 0.03);
    theremin.filter.frequency.setTargetAtTime(400 + x01 * 3200, now, 0.05);
    theremin.panner.pan.setTargetAtTime(clamp(x01 * 2 - 1, -1, 1), now, 0.05);

    if (Math.random() < 0.5) spawnTrail(x01, y01);
  }

  function stopTheremin(x01, y01) {
    if (!theremin) return;
    const t = theremin;
    const now = audioCtx.currentTime;
    t.gain.gain.setTargetAtTime(0, now, 0.06);
    setTimeout(() => { try { t.osc.stop(); } catch (e) {} }, 400);

    if (!t.moved) {
      const midi = root + 12 + (1 - y01) * 24 - 12;
      pluck(Math.round(midi), x01, y01);
    }
    theremin = null;
  }

  // ---- input: keyboard --------------------------------------------

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    for (let r = 0; r < ROWS.length; r++) {
      const i = ROWS[r].keys.indexOf(key);
      if (i !== -1) {
        markInteracted();
        const midi = noteForKey(r, i);
        const x01 = i / (ROWS[r].keys.length - 1);
        const y01 = r === 1 ? 0.28 : 0.62; // top row plays higher on screen too
        pluck(midi, x01, y01);
        break;
      }
    }
  });

  // ---- input: pointer -----------------------------------------------

  function toUnit(clientX, clientY) {
    return { x01: clamp(clientX / window.innerWidth, 0, 1), y01: clamp(clientY / window.innerHeight, 0, 1) };
  }

  canvas.addEventListener("pointerdown", (e) => {
    markInteracted();
    const { x01, y01 } = toUnit(e.clientX, e.clientY);
    startTheremin(x01, y01);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    const { x01, y01 } = toUnit(e.clientX, e.clientY);
    if (theremin) {
      updateTheremin(x01, y01);
    } else if (Math.random() < 0.15) {
      spawnTrail(x01, y01, true);
    }
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => {
    canvas.addEventListener(ev, (e) => {
      const { x01, y01 } = toUnit(e.clientX, e.clientY);
      stopTheremin(x01, y01);
    });
  });

  paletteBtn.addEventListener("click", () => {
    const roots = [55, 57, 60, 62, 64];
    root = roots[Math.floor(Math.random() * roots.length)];
    hue = Math.random() * 360;
  });

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ---- visuals ---------------------------------------------------

  let particles = [];

  function resizeCanvas() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function spawnBurst(x01, y01, decay) {
    const w = canvas.width, h = canvas.height;
    const cx = x01 * w, cy = y01 * h;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const speed = (60 + Math.random() * 140) * devicePixelRatio;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        r: 3 * devicePixelRatio,
        life: 0,
        maxLife: Math.max(0.5, decay * 0.7),
        hue: hue + (Math.random() - 0.5) * 30,
        drag: 0.9,
      });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  function spawnTrail(x01, y01, faint) {
    const w = canvas.width, h = canvas.height;
    particles.push({
      x: x01 * w, y: y01 * h,
      vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20,
      r: (faint ? 2 : 3.4) * devicePixelRatio,
      life: 0,
      maxLife: faint ? 0.6 : 0.9,
      hue: hue + (Math.random() - 0.5) * 20,
      drag: 0.94,
    });
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  let lastFrame = performance.now();

  function draw(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    const w = canvas.width, h = canvas.height;
    ctx2d.fillStyle = `hsla(${hue}, 25%, 4%, 0.22)`;
    ctx2d.fillRect(0, 0, w, h);

    // faint breathing glow at center as an idle invitation
    const breathe = 0.5 + 0.5 * Math.sin(now / 1800);
    const g = ctx2d.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.35);
    g.addColorStop(0, `hsla(${hue}, 40%, 60%, ${0.02 + breathe * 0.015})`);
    g.addColorStop(1, `hsla(${hue}, 40%, 60%, 0)`);
    ctx2d.fillStyle = g;
    ctx2d.fillRect(0, 0, w, h);

    particles.forEach((p) => {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      const t = p.life / p.maxLife;
      const alpha = Math.max(0, 1 - t) * 0.8;
      const r = p.r * (1 + t * 5);
      const grad = ctx2d.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `hsla(${p.hue}, 70%, 78%, ${alpha})`);
      grad.addColorStop(1, `hsla(${p.hue}, 70%, 78%, 0)`);
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
