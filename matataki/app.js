// またたき (matataki) — random blinking light trails
//
// Each orb moves and blinks according to one of four generator engines:
//   - chaos:     a logistic-map iteration drives both the flicker and the
//                turning angle (small seed differences fan out over time,
//                the classic sensitive-dependence signature of chaos)
//   - fibonacci: position follows a golden-angle (phyllotaxis) spiral;
//                brightness beats between two frequencies related by phi,
//                so the pulse pattern never quite repeats
//   - wave:      a Lissajous curve with an irrational frequency ratio for
//                smooth, never-closing motion; brightness is a plain sine
//   - random:    a Brownian walk with Poisson-ish on/off flicker
//
// "timing" controls how the red group's phase relates to the blue group's:
// synced (flash together), alternating (half-period apart), or fully
// independent per-orb randomness.

(() => {
  const canvas = document.getElementById("bg");
  const ctx = canvas.getContext("2d");
  const playBtn = document.getElementById("playBtn");
  const fsBtn = document.getElementById("fsBtn");
  const patternSel = document.getElementById("pattern");
  const timingSel = document.getElementById("timing");
  const speedSlider = document.getElementById("speed");
  const chaosSlider = document.getElementById("chaosAmt");
  const densitySlider = document.getElementById("density");

  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const PHI = 1.6180339887498949;

  let w = 0, h = 0, cx = 0, cy = 0, maxR = 0, dpr = Math.max(1, window.devicePixelRatio || 1);
  let orbs = [];
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

  function makeOrb() {
    const isRed = Math.random() < 0.5;
    const startAngle = rand(0, Math.PI * 2);
    const startR = rand(0, maxR * 0.6);
    const orb = {
      color: isRed ? "red" : "blue",
      hue: isRed ? (Math.random() < 0.5 ? rand(348, 360) : rand(0, 8)) : rand(200, 226),
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
      phase: 0,
      flashUntil: 0,
      brightness: 0,
    };
    orb.px = orb.x; orb.py = orb.y;
    assignPhase(orb);
    return orb;
  }

  function assignPhase(orb) {
    const mode = timingSel.value;
    if (mode === "random") {
      orb.phase = rand(0, Math.PI * 2);
    } else {
      const base = mode === "sync" ? 0 : (orb.color === "red" ? 0 : Math.PI);
      orb.phase = base + rand(-0.3, 0.3);
    }
  }

  function rebuildOrbs() {
    const n = +densitySlider.value;
    orbs = [];
    for (let i = 0; i < n; i++) orbs.push(makeOrb());
  }

  function bounce(orb, margin) {
    if (orb.x < margin) { orb.x = margin; orb.angle = Math.PI - orb.angle; orb.vx = Math.abs(orb.vx); }
    if (orb.x > w - margin) { orb.x = w - margin; orb.angle = Math.PI - orb.angle; orb.vx = -Math.abs(orb.vx); }
    if (orb.y < margin) { orb.y = margin; orb.angle = -orb.angle; orb.vy = Math.abs(orb.vy); }
    if (orb.y > h - margin) { orb.y = h - margin; orb.angle = -orb.angle; orb.vy = -Math.abs(orb.vy); }
  }

  function updateChaos(orb, te, dt, chaosAmt, speed) {
    const tickRate = 3 + chaosAmt * 9;
    const tick = Math.floor(te * tickRate);
    if (tick !== orb.lastTick) {
      orb.lastTick = tick;
      const r = 3.5 + chaosAmt * 0.5;
      orb.chaosVal = r * orb.chaosVal * (1 - orb.chaosVal);
      orb.angle += (orb.chaosVal - 0.5) * 2.4;
    }
    const px = (46 + chaosAmt * 130) * speed * dpr;
    orb.x += Math.cos(orb.angle) * px * dt;
    orb.y += Math.sin(orb.angle) * px * dt;
    bounce(orb, 24 * dpr);
    return orb.chaosVal;
  }

  function updateFibonacci(orb, te, dt, chaosAmt, speed) {
    orb.fibIndex += dt * (1.6 + speed * 4.2);
    const r = (5 + chaosAmt * 4) * Math.sqrt(orb.fibIndex) * dpr;
    const theta = orb.fibIndex * GOLDEN_ANGLE + orb.fibAngleOffset;
    orb.x = cx + r * Math.cos(theta);
    orb.y = cy + r * Math.sin(theta);
    if (r > maxR) {
      orb.fibIndex = rand(0, 6);
      orb.fibAngleOffset = rand(0, Math.PI * 2);
    }
    const b = Math.sin(te * 1.3) * Math.cos(te * 1.3 / PHI);
    return clamp(0.5 + 0.6 * b, 0, 1);
  }

  function updateWave(orb, te, dt, chaosAmt, speed) {
    const A = maxR * (0.55 + chaosAmt * 0.25);
    const f = 0.35 + speed * 0.6;
    orb.x = cx + A * Math.sin(orb.freqX * te * f + orb.phaseX);
    orb.y = cy + A * Math.sin(orb.freqY * te * f + orb.phaseY);
    return 0.5 + 0.5 * Math.sin(te * (1.4 + chaosAmt * 1.2));
  }

  function updateRandom(orb, te, dt, chaosAmt, speed) {
    const tickRate = 1.5 + speed * 7;
    const tick = Math.floor(te * tickRate);
    if (tick !== orb.lastTick) {
      orb.lastTick = tick;
      orb.vx = clamp(orb.vx + rand(-1, 1) * 90 * chaosAmt, -160, 160);
      orb.vy = clamp(orb.vy + rand(-1, 1) * 90 * chaosAmt, -160, 160);
      orb.on = Math.random() < (0.3 + chaosAmt * 0.45);
    }
    orb.x += orb.vx * dt * dpr;
    orb.y += orb.vy * dt * dpr;
    bounce(orb, 24 * dpr);
    return orb.on ? 1 : 0.04;
  }

  function stepOrb(orb, dt, speed, chaosAmt) {
    const te = clock * (0.4 + speed * 1.4) + orb.phase;
    let brightness;
    switch (patternSel.value) {
      case "fibonacci": brightness = updateFibonacci(orb, te, dt, chaosAmt, speed); break;
      case "wave": brightness = updateWave(orb, te, dt, chaosAmt, speed); break;
      case "random": brightness = updateRandom(orb, te, dt, chaosAmt, speed); break;
      default: brightness = updateChaos(orb, te, dt, chaosAmt, speed); break;
    }

    let hue = orb.hue, boosted = 1;
    const flashChance = 0.0009 * (0.4 + speed);
    if (clock < orb.flashUntil) {
      hue = rand(46, 56);
      boosted = 1.4;
    } else if (Math.random() < flashChance) {
      orb.flashUntil = clock + rand(0.22, 0.5);
    }

    orb.brightness += (brightness - orb.brightness) * 0.5;
    return { hue, alpha: clamp(orb.brightness * boosted, 0, 1) };
  }

  function draw(now) {
    const dt = Math.min(0.05, now / 1000 - lastT);
    lastT = now / 1000;
    if (running) clock += dt;

    ctx.fillStyle = "rgba(6, 7, 10, 0.16)";
    ctx.fillRect(0, 0, w, h);

    if (running) {
      const speed = +speedSlider.value / 100;
      const chaosAmt = +chaosSlider.value / 100;

      for (const orb of orbs) {
        orb.px = orb.x;
        orb.py = orb.y;
        const { hue, alpha } = stepOrb(orb, dt, speed, chaosAmt);

        if (alpha > 0.02) {
          ctx.strokeStyle = `hsla(${hue}, 90%, 62%, ${alpha * 0.85})`;
          ctx.lineWidth = 2.2 * dpr;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(orb.px, orb.py);
          ctx.lineTo(orb.x, orb.y);
          ctx.stroke();

          const glowR = (5 + alpha * 10) * dpr;
          const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, glowR);
          grad.addColorStop(0, `hsla(${hue}, 95%, 78%, ${alpha})`);
          grad.addColorStop(1, `hsla(${hue}, 95%, 60%, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(orb.x, orb.y, glowR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  playBtn.addEventListener("click", () => {
    running = !running;
    playBtn.textContent = running ? "一時停止" : "再生";
    playBtn.classList.toggle("playing", running);
  });

  fsBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });

  patternSel.addEventListener("change", rebuildOrbs);
  timingSel.addEventListener("change", () => orbs.forEach(assignPhase));
  densitySlider.addEventListener("input", rebuildOrbs);

  resize();
  rebuildOrbs();
  requestAnimationFrame(draw);
})();
