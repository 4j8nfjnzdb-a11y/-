// 間 — ma
//
// A question, made playable: is a beat still music when the sound is
// gone? Twelve points on a ring hold a rhythm. A hand sweeps the ring
// at whatever tempo you set. Where you've placed a mark, something
// happens — a flash of light, a short vibration on a phone, and,
// only if "音" is on, one plain sine tone. Turn the sound off and the
// light and the pulse keep going exactly as before. The structure was
// never the sound; the sound was one possible skin over the structure.
//
// The center keeps breathing on its own, independent of play/stop —
// a pulse that was already there before you decided to make anything
// of it.

(() => {
  const STEPS = 12;
  const ring = document.getElementById("ring");
  const breath = document.getElementById("breath");
  const playhead = document.getElementById("playhead");
  const playBtn = document.getElementById("playBtn");
  const soundBtn = document.getElementById("soundBtn");
  const tempoSlider = document.getElementById("tempo");
  const promptEl = document.getElementById("prompt");

  // a modest default pattern so the ring isn't silent on first load
  const pattern = [true, false, false, true, false, false, true, false, false, false, true, false];
  let stepEls = [];

  let running = false;
  let soundOn = true;
  let rafId = null;
  let startTime = 0;
  let lastStepIndex = -1;

  let audioCtx = null;
  let master = null;

  const PROMPTS_SOUND_ON = [
    "拍だけがある。音がなくても、間は続く。",
    "音は、構造の一つの現れ方にすぎない。",
    "刺激ではなく、構造をきく。",
  ];
  const PROMPTS_SOUND_OFF = [
    "音を消した。それでも、間は続いている。",
    "見えているものは、まだ音楽だろうか。",
    "鳴っていなくても、拍は数えられる。",
  ];
  let promptTimer = null;

  // ---- layout: place the 12 points on the ring ------------------------

  function layoutRing() {
    const rect = ring.getBoundingClientRect();
    const radius = rect.width / 2;
    stepEls.forEach((el, i) => {
      const angle = (i / STEPS) * Math.PI * 2 - Math.PI / 2;
      const x = radius + Math.cos(angle) * radius * 0.92;
      const y = radius + Math.sin(angle) * radius * 0.92;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
  }

  function buildSteps() {
    for (let i = 0; i < STEPS; i++) {
      const btn = document.createElement("button");
      btn.className = "step" + (pattern[i] ? " active" : "");
      btn.setAttribute("aria-label", `拍 ${i + 1}`);
      btn.addEventListener("click", () => {
        pattern[i] = !pattern[i];
        btn.classList.toggle("active", pattern[i]);
      });
      ring.appendChild(btn);
      stepEls.push(btn);
    }
    layoutRing();
  }
  buildSteps();
  window.addEventListener("resize", layoutRing);

  // ---- audio: one plain tone, nothing more -----------------------------

  function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    master = audioCtx.createGain();
    master.gain.value = 0.7;
    master.connect(audioCtx.destination);
  }

  function ping(pan) {
    if (!soundOn || !audioCtx) return;
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 220;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.5, now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0006, now + 0.9);

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = pan;

    osc.connect(env).connect(panner).connect(master);
    osc.start(now);
    osc.stop(now + 1.0);
  }

  // ---- the one event a step firing causes -------------------------------

  function fireStep(i) {
    const el = stepEls[i];
    if (pattern[i]) {
      el.classList.add("hit");
      setTimeout(() => el.classList.remove("hit"), 180);

      breath.style.animationPlayState = "running";
      breath.style.transform = "scale(1.12)";
      setTimeout(() => { breath.style.transform = ""; }, 160);

      if (navigator.vibrate) navigator.vibrate(16);

      const pan = Math.cos((i / STEPS) * Math.PI * 2 - Math.PI / 2);
      ping(pan);
    }
  }

  // ---- transport: a hand sweeping the ring ------------------------------

  function loop(now) {
    if (!running) return;
    const elapsed = (now - startTime) / 1000;
    const tempo = +tempoSlider.value;
    const cycleSeconds = (60 / tempo) * 4; // 4 beats per full turn
    const frac = (elapsed % cycleSeconds) / cycleSeconds;

    playhead.style.transform = `rotate(${frac * 360}deg)`;

    const stepIndex = Math.floor(frac * STEPS);
    if (stepIndex !== lastStepIndex) {
      lastStepIndex = stepIndex;
      fireStep(stepIndex);
    }

    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (soundOn && !audioCtx) initAudio();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    running = true;
    lastStepIndex = -1;
    startTime = performance.now();
    rafId = requestAnimationFrame(loop);
    playBtn.textContent = "停止";
    playBtn.classList.add("playing");
    cyclePrompt();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    playBtn.textContent = "再生";
    playBtn.classList.remove("playing");
    clearTimeout(promptTimer);
  }

  playBtn.addEventListener("click", () => {
    if (running) stop(); else start();
  });

  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    if (soundOn && !audioCtx) initAudio();
    soundBtn.textContent = soundOn ? "音: オン" : "音: オフ";
    soundBtn.classList.toggle("muted", !soundOn);
    showPrompt(true);
  });

  // ---- quiet, occasional text — a question, not a caption ---------------

  function showPrompt(immediate) {
    const pool = soundOn ? PROMPTS_SOUND_ON : PROMPTS_SOUND_OFF;
    const text = pool[Math.floor(Math.random() * pool.length)];
    const set = () => { promptEl.textContent = text; promptEl.classList.remove("fade"); };
    if (immediate) { set(); return; }
    promptEl.classList.add("fade");
    setTimeout(set, 800);
  }

  function cyclePrompt() {
    if (!running) return;
    showPrompt(false);
    promptTimer = setTimeout(cyclePrompt, 14000);
  }
})();
