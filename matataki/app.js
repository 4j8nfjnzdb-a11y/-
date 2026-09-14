// またたき (matataki) — a color cue light for two performers
//
// The whole scene shares ONE color at a time — red, blue, or yellow —
// chosen by a scheduler and shown as a large steady beacon (so it reads
// at a glance) plus a swarm of smaller drifting/trailing lights for
// atmosphere. A moving swarm of independently-colored dots would be
// ambiguous as a cue; a single shared color is not.
//
// The scheduler is built from two independent pieces, both adjustable:
//   - WHICH color comes next: weighted by the red/blue/yellow sliders,
//     with "alternation strength" suppressing (or, at 100%, forbidding)
//     immediate repeats of the same color.
//   - WHEN the next change happens: a base tempo, perturbed by a
//     "jitter" amount and flavored by the selected pattern —
//     chaos (logistic map bursts), fibonacci (long/short beats related
//     by the golden ratio), wave (smooth sinusoidal breathing), or
//     plain random.

(() => {
  const canvas = document.getElementById("bg");
  const ctx = canvas.getContext("2d");
  const uiEl = document.getElementById("ui");
  const playBtn = document.getElementById("playBtn");
  const fsBtn = document.getElementById("fsBtn");
  const diceBtn = document.getElementById("diceBtn");
  const patternSel = document.getElementById("pattern");
  const speedSlider = document.getElementById("speed");
  const jitterSlider = document.getElementById("jitter");
  const altSlider = document.getElementById("alt");
  const densitySlider = document.getElementById("density");
  const wRed = document.getElementById("wRed");
  const wBlue = document.getElementById("wBlue");
  const wYellow = document.getElementById("wYellow");

  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const PHI = 1.6180339887498949;
  const HUES = { red: 355, blue: 215, yellow: 48 };

  let w = 0, h = 0, cx = 0, cy = 0, maxR = 0, dpr = Math.max(1, window.devicePixelRatio || 1);
  let swarm = [];
  let running = true;
  let lastT = performance.now() / 1000;
  let clock = 0;

  function resize() {
    w = canvas.width = window.innerWidth * dpr;
    h = canvas.height = window.innerHeight * dpr;
    cx = w / 2;
    cy = h / 2;
    maxR = Math.min(w, h) * 0.44;
    ctx.fillStyle = "#06070a";
    ctx.fillRect(0, 0, w, h);
  }
  window.addEventListener("resize", resize);

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerpHue(a, b, t) {
    const diff = (((b - a) % 360) + 540) % 360 - 180;
    return (a + diff * t + 360) % 360;
  }

  // ---- cue scheduler: which color, and when the next one comes -------

  const cue = {
    color: "blue",
    hueCurrent: HUES.blue,
    hueTarget: HUES.blue,
    changeAt: 0.6,
  };
  let cueChaosVal = Math.random();
  let fibToggle = false;
  let waveT = 0;

  function pickNextColor(prev) {
    const alt = +altSlider.value / 100;
    const pool = [
      { c: "red", w: +wRed.value },
      { c: "blue", w: +wBlue.value },
      { c: "yellow", w: +wYellow.value },
    ].map((p) => (p.c === prev ? { c: p.c, w: p.w * (1 - alt) } : p));
    const total = pool.reduce((s, p) => s + p.w, 0);
    if (total <= 0) return prev;
    let r = Math.random() * total;
    for (const p of pool) {
      if (r < p.w) return p.c;
      r -= p.w;
    }
    return pool[pool.length - 1].c;
  }

  function nextInterval() {
    const speed = +speedSlider.value / 100;
    const jitterAmt = +jitterSlider.value / 100;
    const base = Math.max(0.15, 1.9 - speed * 1.65);
    switch (patternSel.value) {
      case "fibonacci": {
        fibToggle = !fibToggle;
        const ratio = fibToggle ? PHI : 1 / PHI;
        return Math.max(0.12, base * ratio * (1 + rand(-1, 1) * jitterAmt * 0.4));
      }
      case "wave": {
        waveT += base;
        return Math.max(0.12, base * (1 + 0.6 * Math.sin(waveT * 0.9)));
      }
      case "random":
        return Math.max(0.12, base * (1 + rand(-1, 1) * jitterAmt));
      default: {
        const r = 3.5 + jitterAmt * 0.5;
        cueChaosVal = r * cueChaosVal * (1 - cueChaosVal);
        return Math.max(0.12, base * (0.4 + cueChaosVal * 1.6));
      }
    }
  }

  function updateCue(dt) {
    if (clock >= cue.changeAt) {
      cue.color = pickNextColor(cue.color);
      cue.hueTarget = HUES[cue.color];
      cue.changeAt = clock + nextInterval();
    }
    const rate = 1 - Math.exp(-dt / 0.06);
    cue.hueCurrent = lerpHue(cue.hueCurrent, cue.hueTarget, rate);
  }

  // ---- beacon: one large, always-visible pulse in the current color --

  const beacon = { chaosVal: Math.random(), on: true, lastTick: -1 };

  function beaconPulse(te) {
    const speed = +speedSlider.value / 100;
    const jitterAmt = +jitterSlider.value / 100;
    switch (patternSel.value) {
      case "fibonacci":
        return clamp(0.5 + 0.5 * Math.sin(te * 1.3) * Math.cos(te * 1.3 / PHI), 0, 1);
      case "wave":
        return 0.5 + 0.5 * Math.sin(te * 1.7);
      case "random": {
        const tick = Math.floor(te * (1.2 + speed * 3));
        if (tick !== beacon.lastTick) {
          beacon.lastTick = tick;
          beacon.on = Math.random() < 0.7;
        }
        return beacon.on ? 1 : 0.15;
      }
      default: {
        const tick = Math.floor(te * (2 + jitterAmt * 6));
        if (tick !== beacon.lastTick) {
          beacon.lastTick = tick;
          const r = 3.5 + jitterAmt * 0.5;
          beacon.chaosVal = r * beacon.chaosVal * (1 - beacon.chaosVal);
        }
        return beacon.chaosVal;
      }
    }
  }

  function drawBeacon(te) {
    const value = beaconPulse(te);
    const alpha = 0.5 + 0.5 * value;
    const baseR = Math.min(w, h) * 0.16;
    const r = baseR * (0.85 + value * 0.3);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `hsla(${cue.hueCurrent}, 95%, 80%, ${alpha})`);
    grad.addColorStop(0.5, `hsla(${cue.hueCurrent}, 95%, 62%, ${alpha * 0.55})`);
    grad.addColorStop(1, `hsla(${cue.hueCurrent}, 95%, 55%, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // faint full-screen wash so the color reads in peripheral vision too
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.75);
    wash.addColorStop(0, `hsla(${cue.hueCurrent}, 90%, 55%, ${0.05 + value * 0.05})`);
    wash.addColorStop(1, `hsla(${cue.hueCurrent}, 90%, 55%, 0)`);
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
  }

  // ---- decorative swarm: independent motion, shared cue color ---------

  function makeSwarmDot() {
    const startAngle = rand(0, Math.PI * 2);
    const startR = rand(maxR * 0.2, maxR * 0.9);
    const dot = {
      hueOffset: rand(-5, 5),
      x: cx + Math.cos(startAngle) * startR,
      y: cy + Math.sin(startAngle) * startR,
      px: 0, py: 0,
      angle: rand(0, Math.PI * 2),
      chaosVal: Math.random(),
      fibIndex: rand(0, 40),
      fibAngleOffset: rand(0, Math.PI * 2),
      freqX: rand(0.55, 1.15) * (Math.random() < 0.5 ? 1 : Math.SQRT2),
      freqY: rand(0.55, 1.15) * (Math.random() < 0.5 ? 1 : Math.sqrt(3)),
      phaseX: rand(0, Math.PI * 2),
      phaseY: rand(0, Math.PI * 2),
      vx: rand(-40, 40),
      vy: rand(-40, 40),
      on: false,
      lastTick: -1,
      phase: rand(0, Math.PI * 2),
      brightness: 0,
    };
    dot.px = dot.x; dot.py = dot.y;
    return dot;
  }

  function rebuildSwarm() {
    const n = +densitySlider.value;
    swarm = [];
    for (let i = 0; i < n; i++) swarm.push(makeSwarmDot());
  }

  function bounce(dot, margin) {
    if (dot.x < margin) { dot.x = margin; dot.angle = Math.PI - dot.angle; dot.vx = Math.abs(dot.vx); }
    if (dot.x > w - margin) { dot.x = w - margin; dot.angle = Math.PI - dot.angle; dot.vx = -Math.abs(dot.vx); }
    if (dot.y < margin) { dot.y = margin; dot.angle = -dot.angle; dot.vy = Math.abs(dot.vy); }
    if (dot.y > h - margin) { dot.y = h - margin; dot.angle = -dot.angle; dot.vy = -Math.abs(dot.vy); }
  }

  function stepChaos(dot, te, dt, jitterAmt, speed) {
    const tick = Math.floor(te * (3 + jitterAmt * 9));
    if (tick !== dot.lastTick) {
      dot.lastTick = tick;
      const r = 3.5 + jitterAmt * 0.5;
      dot.chaosVal = r * dot.chaosVal * (1 - dot.chaosVal);
      dot.angle += (dot.chaosVal - 0.5) * 2.4;
    }
    const px = (46 + jitterAmt * 130) * speed * dpr;
    dot.x += Math.cos(dot.angle) * px * dt;
    dot.y += Math.sin(dot.angle) * px * dt;
    bounce(dot, 24 * dpr);
    return dot.chaosVal;
  }

  function stepFibonacci(dot, te, dt, jitterAmt, speed) {
    dot.fibIndex += dt * (1.6 + speed * 4.2);
    const r = (5 + jitterAmt * 4) * Math.sqrt(dot.fibIndex) * dpr;
    const theta = dot.fibIndex * GOLDEN_ANGLE + dot.fibAngleOffset;
    dot.x = cx + r * Math.cos(theta);
    dot.y = cy + r * Math.sin(theta);
    if (r > maxR) {
      dot.fibIndex = rand(0, 6);
      dot.fibAngleOffset = rand(0, Math.PI * 2);
    }
    const b = Math.sin(te * 1.3) * Math.cos(te * 1.3 / PHI);
    return clamp(0.5 + 0.6 * b, 0, 1);
  }

  function stepWave(dot, te, dt, jitterAmt, speed) {
    const A = maxR * (0.55 + jitterAmt * 0.25);
    const f = 0.35 + speed * 0.6;
    dot.x = cx + A * Math.sin(dot.freqX * te * f + dot.phaseX);
    dot.y = cy + A * Math.sin(dot.freqY * te * f + dot.phaseY);
    return 0.5 + 0.5 * Math.sin(te * (1.4 + jitterAmt * 1.2));
  }

  function stepRandom(dot, te, dt, jitterAmt, speed) {
    const tick = Math.floor(te * (1.5 + speed * 7));
    if (tick !== dot.lastTick) {
      dot.lastTick = tick;
      dot.vx = clamp(dot.vx + rand(-1, 1) * 90 * jitterAmt, -160, 160);
      dot.vy = clamp(dot.vy + rand(-1, 1) * 90 * jitterAmt, -160, 160);
      dot.on = Math.random() < (0.3 + jitterAmt * 0.45);
    }
    dot.x += dot.vx * dt * dpr;
    dot.y += dot.vy * dt * dpr;
    bounce(dot, 24 * dpr);
    return dot.on ? 1 : 0.04;
  }

  function stepDot(dot, dt, speed, jitterAmt) {
    const te = clock * (0.4 + speed * 1.4) + dot.phase;
    let brightness;
    switch (patternSel.value) {
      case "fibonacci": brightness = stepFibonacci(dot, te, dt, jitterAmt, speed); break;
      case "wave": brightness = stepWave(dot, te, dt, jitterAmt, speed); break;
      case "random": brightness = stepRandom(dot, te, dt, jitterAmt, speed); break;
      default: brightness = stepChaos(dot, te, dt, jitterAmt, speed); break;
    }
    dot.brightness += (brightness - dot.brightness) * 0.5;
    return dot.brightness;
  }

  // ---- main loop -------------------------------------------------

  function draw(now) {
    const dt = Math.min(0.05, now / 1000 - lastT);
    lastT = now / 1000;

    if (!running) {
      // frozen: leave the last drawn frame on screen as a stable cue
      requestAnimationFrame(draw);
      return;
    }

    clock += dt;

    ctx.fillStyle = "rgba(6, 7, 10, 0.16)";
    ctx.fillRect(0, 0, w, h);

    updateCue(dt);

    const speed = +speedSlider.value / 100;
    const jitterAmt = +jitterSlider.value / 100;

    for (const dot of swarm) {
      dot.px = dot.x;
      dot.py = dot.y;
      const alpha = clamp(stepDot(dot, dt, speed, jitterAmt), 0, 1);
      if (alpha > 0.02) {
        const hue = cue.hueCurrent + dot.hueOffset;
        ctx.strokeStyle = `hsla(${hue}, 90%, 62%, ${alpha * 0.8})`;
        ctx.lineWidth = 2.2 * dpr;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(dot.px, dot.py);
        ctx.lineTo(dot.x, dot.y);
        ctx.stroke();

        const glowR = (4 + alpha * 8) * dpr;
        const grad = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, glowR);
        grad.addColorStop(0, `hsla(${hue}, 95%, 78%, ${alpha})`);
        grad.addColorStop(1, `hsla(${hue}, 95%, 60%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const te = clock * (0.4 + speed * 1.4);
    drawBeacon(te);

    requestAnimationFrame(draw);
  }

  // ---- dice: animate every fader to a fresh random value -------------

  function animateSlider(el, target, { duration = 550, live = true } = {}) {
    const start = +el.value;
    const t0 = performance.now();
    return new Promise((resolve) => {
      function step(now) {
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.value = Math.round(start + (target - start) * eased);
        if (live) el.dispatchEvent(new Event("input"));
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          if (!live) el.dispatchEvent(new Event("input"));
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  function shufflePattern() {
    const options = Array.from(patternSel.options).map((o) => o.value);
    let i = 0;
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        patternSel.value = options[Math.floor(Math.random() * options.length)];
        i++;
        if (i >= 8) {
          clearInterval(timer);
          patternSel.dispatchEvent(new Event("change"));
          resolve();
        }
      }, 55);
    });
  }

  function randomizeAll() {
    diceBtn.classList.remove("rolling");
    void diceBtn.offsetWidth; // restart the animation if clicked again mid-roll
    diceBtn.classList.add("rolling");

    animateSlider(speedSlider, Math.round(rand(0, 100)));
    animateSlider(jitterSlider, Math.round(rand(0, 100)));
    animateSlider(altSlider, Math.round(rand(0, 100)));
    animateSlider(wRed, Math.round(rand(+wRed.min, +wRed.max)));
    animateSlider(wBlue, Math.round(rand(+wBlue.min, +wBlue.max)));
    animateSlider(wYellow, Math.round(rand(+wYellow.min, +wYellow.max)));
    animateSlider(densitySlider, Math.round(rand(+densitySlider.min, +densitySlider.max)), { live: false });
    shufflePattern();
  }

  // ---- transport, fullscreen, keyboard ---------------------------

  function togglePlay() {
    running = !running;
    playBtn.textContent = running ? "一時停止" : "再生";
    playBtn.classList.toggle("playing", running);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  document.addEventListener("fullscreenchange", () => {
    document.body.classList.toggle("immersive", !!document.fullscreenElement);
  });

  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    const isFormEl = tag === "INPUT" || tag === "SELECT" || tag === "BUTTON" || tag === "TEXTAREA";
    if (isFormEl) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "f" || e.key === "F") {
      toggleFullscreen();
    } else if (e.key === "r" || e.key === "R") {
      randomizeAll();
    }
  });

  playBtn.addEventListener("click", togglePlay);
  fsBtn.addEventListener("click", toggleFullscreen);
  diceBtn.addEventListener("click", randomizeAll);
  patternSel.addEventListener("change", rebuildSwarm);
  densitySlider.addEventListener("input", rebuildSwarm);

  resize();
  rebuildSwarm();
  requestAnimationFrame(draw);
})();
