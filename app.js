// がらくた (GARAKUTA) — a found-footage cut-up machine
//
// Bruce Conner's method, reduced to a mechanism: don't shoot anything.
// Take material that already exists (here: procedurally generated
// "stock" textures — leader countdowns, test cards, scratch and
// static — plus whatever the viewer throws in), cut it into fragments,
// splice the fragments back together at a rhythm nobody chose on
// purpose, zoom into a random detail instead of the whole frame, and
// lay a soundtrack under it that has nothing to do with the picture.
// The "dice" don't just pick footage — they pick which *kind* of edit
// is currently happening (a slow drift, a strobe of jump cuts, a
// stutter of repeated frames), because Conner's films aren't cut at
// one rhythm either.

(() => {
  const stage = document.getElementById("stage");
  const sctx = stage.getContext("2d");
  const flashEl = document.getElementById("flash");
  const playBtn = document.getElementById("playBtn");
  const diceBtn = document.getElementById("diceBtn");
  const fileInput = document.getElementById("fileInput");
  const tempoSlider = document.getElementById("tempo");
  const chaosSlider = document.getElementById("chaos");
  const grainSlider = document.getElementById("grain");
  const hintEl = document.getElementById("regimeHint");

  const SRC_W = 640, SRC_H = 360;
  const source = document.createElement("canvas");
  source.width = SRC_W; source.height = SRC_H;
  const sourceCtx = source.getContext("2d");

  let overlayFX = document.createElement("canvas");
  let overlayFXCtx = overlayFX.getContext("2d");
  let grainTile = document.createElement("canvas");
  let grainPattern = null;
  let prevFrame = document.createElement("canvas");
  const prevCtx = prevFrame.getContext("2d");

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---- procedural "found" material -----------------------------------
  // Nothing here is footage of anything in particular — it's the kind
  // of anonymous stock texture (leaders, bars, scratched black, dust,
  // stamped catalog cards) that a scavenger like Conner would have had
  // a drawer full of.

  function addSpecks(ctx, w, h, n) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = Math.random() * 1.4;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function leaderCountdown(ctx, w, h, t) {
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.32;
    ctx.strokeStyle = "rgba(230,230,223,0.85)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
      ctx.lineTo(cx + Math.cos(a) * r * 1.02, cy + Math.sin(a) * r * 1.02);
      ctx.stroke();
    }
    const num = 9 - (Math.floor(t * 1.6) % 9);
    ctx.fillStyle = "rgba(230,230,223,0.9)";
    ctx.font = `${Math.floor(r * 1.1)}px Georgia, serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(num), cx, cy + r * 0.04);
    const a2 = ((t * 1.6) % 1) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = "rgba(230,230,223,0.6)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r); ctx.stroke();
    addSpecks(ctx, w, h, 14);
  }

  function testBars(ctx, w, h, t) {
    const colors = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
    const bw = w / colors.length;
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(i * bw + Math.sin(t * 3 + i) * 1.5, 0, bw + 2, h * 0.75);
    });
    ctx.fillStyle = "#111"; ctx.fillRect(0, h * 0.75, w, h * 0.25);
    addSpecks(ctx, w, h, 10);
  }

  function scratchLeader(ctx, w, h, t) {
    ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 6; i++) {
      const x = (Math.sin(t * 13 + i * 7.1) * 0.5 + 0.5) * w;
      ctx.lineWidth = 0.5 + Math.random() * 1.2;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (Math.random() - 0.5) * 10, h); ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "italic 20px Georgia";
    ctx.textAlign = "left";
    const labels = ["REEL 4", "A", "No. 118", "LEADER", "X"];
    ctx.fillText(labels[Math.floor(t * 2) % labels.length], w * 0.08, h * 0.85);
    addSpecks(ctx, w, h, 40);
  }

  function sunburst(ctx, w, h, t) {
    ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, rays = 24;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + t * 0.3;
      const len = Math.min(w, h) * (0.5 + 0.15 * Math.sin(t * 4 + i));
      const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      grad.addColorStop(0, "rgba(255,230,200,0.55)");
      grad.addColorStop(1, "rgba(255,230,200,0)");
      ctx.strokeStyle = grad; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); ctx.stroke();
    }
    addSpecks(ctx, w, h, 10);
  }

  function textCard(ctx, w, h, t) {
    ctx.fillStyle = "#1c1a16"; ctx.fillRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "rgba(255,255,255,0.05)");
    grad.addColorStop(1, "rgba(0,0,0,0.2)");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const words = ["STOCK FOOTAGE", "DO NOT PROJECT", "CLASSIFIED", "PROPERTY OF", "REEL 2 OF 7", "DAMAGED", "ARCHIVE COPY", "NO SOUND"];
    const word = words[Math.floor(t * 0.7) % words.length];
    ctx.fillStyle = "rgba(230,225,215,0.85)";
    ctx.font = 'bold 34px "Courier New", monospace';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.sin(t * 0.5) * 0.02);
    ctx.fillText(word, 0, 0);
    ctx.restore();
    addSpecks(ctx, w, h, 20);
  }

  function staticNoise(ctx, w, h) {
    const nw = 80, nh = 45;
    if (!staticNoise._c) {
      staticNoise._c = document.createElement("canvas");
      staticNoise._c.width = nw; staticNoise._c.height = nh;
      staticNoise._ctx = staticNoise._c.getContext("2d");
    }
    const nctx = staticNoise._ctx;
    const imgData = nctx.createImageData(nw, nh);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const v = Math.random() * 255;
      imgData.data[i] = v; imgData.data[i + 1] = v; imgData.data[i + 2] = v; imgData.data[i + 3] = 255;
    }
    nctx.putImageData(imgData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staticNoise._c, 0, 0, nw, nh, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  const PROCEDURAL = [
    { kind: "procedural", name: "leader", draw: leaderCountdown },
    { kind: "procedural", name: "bars", draw: testBars },
    { kind: "procedural", name: "scratch", draw: scratchLeader },
    { kind: "procedural", name: "sunburst", draw: sunburst },
    { kind: "procedural", name: "card", draw: textCard },
    { kind: "procedural", name: "static", draw: staticNoise },
  ];

  let userMaterials = [];
  let materials = PROCEDURAL.slice();

  function addUserMaterial(m) {
    userMaterials.push(m);
    if (userMaterials.length > 10) {
      const old = userMaterials.shift();
      if (old.kind === "video") { try { old.el.pause(); } catch (e) {} }
      URL.revokeObjectURL(old.url);
    }
    materials = PROCEDURAL.concat(userMaterials);
  }

  fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => addUserMaterial({ kind: "image", el: img, url });
        img.src = url;
      } else if (file.type.startsWith("video/")) {
        const vid = document.createElement("video");
        vid.muted = true; vid.loop = true; vid.playsInline = true;
        const url = URL.createObjectURL(file);
        vid.src = url;
        vid.addEventListener("loadeddata", () => {
          if (running) vid.play().catch(() => {});
          addUserMaterial({ kind: "video", el: vid, url });
        });
      }
    });
    e.target.value = "";
  });

  function coverDraw(ctx, el, iw, ih, dw, dh) {
    if (!iw || !ih) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, dw, dh); return; }
    const scale = Math.max(dw / iw, dh / ih);
    const sw = dw / scale, sh = dh / scale;
    const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.drawImage(el, sx, sy, sw, sh, 0, 0, dw, dh);
  }

  function drawMaterialToSource(material, t) {
    sourceCtx.save();
    sourceCtx.filter = "none";
    if (material.kind === "procedural") {
      material.draw(sourceCtx, SRC_W, SRC_H, t);
    } else if (material.kind === "image") {
      coverDraw(sourceCtx, material.el, material.el.naturalWidth, material.el.naturalHeight, SRC_W, SRC_H);
    } else if (material.kind === "video") {
      if (material.el.readyState >= 2) {
        coverDraw(sourceCtx, material.el, material.el.videoWidth, material.el.videoHeight, SRC_W, SRC_H);
      } else {
        sourceCtx.fillStyle = "#000"; sourceCtx.fillRect(0, 0, SRC_W, SRC_H);
      }
    }
    sourceCtx.restore();
  }

  // ---- editing regimes -------------------------------------------------
  // Each regime is a bias on how the dice land: how long a shot holds,
  // how often it's interrupted by a splice flash or a stuttered repeat,
  // how far it zooms, what it does to the image once it's cropped.

  const TREATMENTS = {
    none: "none",
    invert: "invert(1)",
    threshold: "grayscale(1) contrast(2.2) brightness(1.05)",
    hue: "hue-rotate(180deg) saturate(2.2)",
    sepia: "sepia(0.65) contrast(1.15) brightness(0.95)",
  };

  const REGIMES = {
    drift: { minDur: 1.8, maxDur: 4.0, flashChance: 0.05, stutterChance: 0, zoomRange: [0.65, 1.35], treatments: ["none", "none", "sepia"] },
    flicker: { minDur: 0.05, maxDur: 0.22, flashChance: 0.35, stutterChance: 0.1, zoomRange: [0.85, 1.2], treatments: ["invert", "none", "threshold"] },
    stutter: { minDur: 0.08, maxDur: 0.3, flashChance: 0.1, stutterChance: 0.55, zoomRange: [0.9, 1.1], treatments: ["none", "invert"] },
    assault: { minDur: 0.15, maxDur: 0.6, flashChance: 0.22, stutterChance: 0.15, zoomRange: [0.5, 1.7], treatments: ["none", "invert", "hue", "sepia"] },
    archive: { minDur: 1.2, maxDur: 2.6, flashChance: 0.08, stutterChance: 0, zoomRange: [0.8, 1.2], treatments: ["sepia", "none"] },
  };
  const REGIME_NAMES = Object.keys(REGIMES);

  const HINTS = {
    drift: ["同じ場面をただ見つめ続けるだけで、何かが変わって見えてくる。", "ズームは何かを説明しない。ただ寄っていくだけ。"],
    flicker: ["カットが速すぎて、何を見たのか誰も答えられない。", "コマとコマの間に、見えないフィルムが挟まっている。"],
    stutter: ["同じコマが引っかかって、何度も同じ場所に戻る。", "フィルムが噛んだ。それも編集の一部にする。"],
    assault: ["無関係な映像が、無関係な音楽の上で殴り合っている。", "誰かが捨てたフィルムだけで、世界はもう一度作れる。"],
    archive: ["これは記録映像です。何の記録かは分かりません。", "倉庫の奥にあったリールに、ラベルはもう読めない。"],
  };

  function pickRegime(exclude) {
    let name;
    do { name = pick(REGIME_NAMES); } while (REGIME_NAMES.length > 1 && name === exclude);
    return name;
  }

  function updateHint(regimeName) {
    hintEl.style.opacity = 0;
    setTimeout(() => {
      hintEl.textContent = pick(HINTS[regimeName]);
      hintEl.style.opacity = 0.65;
    }, 220);
  }

  let currentRegimeName = pickRegime();

  // ---- shot rolling ------------------------------------------------

  let currentShot = null;
  let shotElapsed = 0;
  let lastMaterial = null;
  let cutCount = 0;
  let running = false;
  let clock = 0;

  function randomCrop(regime) {
    const cx = rand(0.15, 0.85), cy = rand(0.15, 0.85);
    const base = rand(0.25, 0.8);
    const w0 = base * rand(0.8, 1.2), h0 = base * rand(0.8, 1.2);
    const zoom = rand(regime.zoomRange[0], regime.zoomRange[1]);
    const w1 = clamp(w0 * zoom, 0.08, 1.4), h1 = clamp(h0 * zoom, 0.08, 1.4);
    const rectFor = (w, h) => {
      w = Math.min(w, 1); h = Math.min(h, 1);
      return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
    };
    return { from: rectFor(w0, h0), to: rectFor(w1, h1) };
  }

  function tempoScale() {
    const tempo = +tempoSlider.value / 100;
    return 1.7 - tempo * 1.35;
  }
  function chaosAmt() { return +chaosSlider.value / 100; }

  function rollShot() {
    cutCount++;
    if (cutCount % 5 === 0 && Math.random() < 0.35) {
      currentRegimeName = pickRegime(currentRegimeName);
      updateHint(currentRegimeName);
    }
    const regime = REGIMES[currentRegimeName];
    const chaos = chaosAmt();

    if (Math.random() < regime.flashChance * (0.5 + chaos)) {
      currentShot = { kind: "flash", color: Math.random() < 0.5 ? "#fff" : "#000", dur: rand(0.03, 0.09) };
      shotElapsed = 0;
      triggerSplicePop();
      return;
    }

    if (lastMaterial && Math.random() < regime.stutterChance) {
      currentShot = {
        kind: "shot",
        material: lastMaterial,
        crop: randomCrop(regime),
        filter: TREATMENTS[pick(regime.treatments)],
        mirror: Math.random() < 0.15,
        dur: Math.max(0.05, rand(0.06, 0.2) * tempoScale()),
      };
      shotElapsed = 0;
      triggerSplicePop();
      return;
    }

    let material = pick(materials);
    if (materials.length > 1 && material === lastMaterial) material = pick(materials);
    lastMaterial = material;

    let dur = rand(regime.minDur, regime.maxDur) * tempoScale();
    dur *= 1 + (Math.random() * 2 - 1) * chaos * 0.6;
    dur = Math.max(0.05, dur);

    currentShot = {
      kind: "shot",
      material,
      crop: randomCrop(regime),
      filter: TREATMENTS[pick(regime.treatments)],
      mirror: Math.random() < 0.12,
      dur,
    };
    shotElapsed = 0;
    triggerSplicePop();
    if (material.kind === "procedural" && material.name === "static") triggerStaticBurst(dur);
  }

  // ---- rendering ------------------------------------------------------

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    stage.width = innerWidth * dpr;
    stage.height = innerHeight * dpr;
    overlayFX.width = stage.width; overlayFX.height = stage.height;
    prevFrame.width = stage.width; prevFrame.height = stage.height;
    buildOverlayFX();
  }
  window.addEventListener("resize", resize);

  function buildOverlayFX() {
    const w = overlayFX.width, h = overlayFX.height;
    overlayFXCtx.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) {
      overlayFXCtx.fillStyle = "rgba(0,0,0,0.08)";
      overlayFXCtx.fillRect(0, y, w, 1);
    }
    const grad = overlayFXCtx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.6)");
    overlayFXCtx.fillStyle = grad;
    overlayFXCtx.fillRect(0, 0, w, h);
  }

  function buildGrainTile() {
    const size = 200;
    grainTile.width = size; grainTile.height = size;
    const gctx = grainTile.getContext("2d");
    const imgData = gctx.createImageData(size, size);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const v = Math.random() * 255;
      imgData.data[i] = v; imgData.data[i + 1] = v; imgData.data[i + 2] = v;
      imgData.data[i + 3] = Math.random() * 255;
    }
    gctx.putImageData(imgData, 0, 0);
    grainPattern = sctx.createPattern(grainTile, "repeat");
  }

  function drawGrainAndOverlay() {
    const grainAmt = +grainSlider.value / 100;
    if (grainAmt > 0.01) {
      sctx.save();
      sctx.globalAlpha = grainAmt * 0.35;
      sctx.globalCompositeOperation = "overlay";
      sctx.translate(Math.random() * 200, Math.random() * 200);
      sctx.fillStyle = grainPattern;
      sctx.fillRect(-200, -200, stage.width + 400, stage.height + 400);
      sctx.restore();
    }
    sctx.drawImage(overlayFX, 0, 0);
  }

  function renderShot(shot, p) {
    if (shot.kind === "flash") {
      sctx.fillStyle = shot.color;
      sctx.fillRect(0, 0, stage.width, stage.height);
      return;
    }
    drawMaterialToSource(shot.material, clock);

    const c = shot.crop;
    const eased = p;
    const x = lerp(c.from.x, c.to.x, eased);
    const y = lerp(c.from.y, c.to.y, eased);
    const w = lerp(c.from.w, c.to.w, eased);
    const h = lerp(c.from.h, c.to.h, eased);

    sctx.save();
    sctx.filter = shot.filter;
    if (shot.mirror) {
      sctx.translate(stage.width, 0);
      sctx.scale(-1, 1);
    }
    sctx.drawImage(
      source,
      x * SRC_W, y * SRC_H, w * SRC_W, h * SRC_H,
      0, 0, stage.width, stage.height
    );
    sctx.restore();

    // a faint double-exposed trace of the previous cut — print-through,
    // the kind of ghosting spliced work-print film picks up
    const ghostAmt = 0.08 * (0.5 + chaosAmt());
    sctx.save();
    sctx.globalAlpha = ghostAmt;
    sctx.globalCompositeOperation = "lighten";
    sctx.drawImage(prevFrame, rand(-4, 4), rand(-4, 4));
    sctx.restore();
  }

  function renderIdle() {
    drawMaterialToSource(PROCEDURAL[0], clock);
    sctx.save();
    sctx.filter = "brightness(0.55)";
    sctx.drawImage(source, 0, 0, SRC_W, SRC_H, 0, 0, stage.width, stage.height);
    sctx.restore();
  }

  let prevTs = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = prevTs ? Math.min((ts - prevTs) / 1000, 0.1) : 0;
    prevTs = ts;
    clock += dt;

    if (running) {
      if (!currentShot || shotElapsed >= currentShot.dur) {
        rollShot();
      } else {
        shotElapsed += dt;
      }
      const p = currentShot.dur > 0 ? clamp(shotElapsed / currentShot.dur, 0, 1) : 1;
      renderShot(currentShot, p);
    } else {
      renderIdle();
    }

    drawGrainAndOverlay();
    prevCtx.clearRect(0, 0, prevFrame.width, prevFrame.height);
    prevCtx.drawImage(stage, 0, 0);
  }

  // ---- audio: a soundtrack that has nothing to do with the picture ----

  let audioCtx = null;
  let master = null;
  let droneGain = null;
  let noiseBuffer = null;
  let pulseTimer = null;
  let nextPulseAt = 0;

  function buildNoiseBuffer(context, duration) {
    const length = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    master = audioCtx.createGain();
    master.gain.value = 0.8;
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.ratio.value = 4;
    master.connect(compressor).connect(audioCtx.destination);

    noiseBuffer = buildNoiseBuffer(audioCtx, 1.0);

    // a low, slightly detuned drone under everything — the "unrelated
    // music" that Conner would lay across footage it was never cut for
    droneGain = audioCtx.createGain();
    droneGain.gain.value = 0.09;
    droneGain.connect(master);

    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 500;
    lowpass.connect(droneGain);

    [55, 55.6, 110].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = i === 2 ? "triangle" : "sawtooth";
      osc.frequency.value = freq;
      osc.connect(lowpass);
      osc.start();
    });

    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = audioCtx.createGain();
    lfoDepth.gain.value = 0.05;
    lfo.connect(lfoDepth).connect(droneGain.gain);
    lfo.start();
  }

  function triggerSplicePop() {
    if (!audioCtx || !running) return;
    const now = audioCtx.currentTime;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    const band = audioCtx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = rand(900, 2600);
    band.Q.value = 2.5;
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.3, now + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    src.connect(band).connect(env).connect(master);
    src.start(now);
    src.stop(now + 0.08);
  }

  function triggerStaticBurst(duration) {
    if (!audioCtx || !running) return;
    const now = audioCtx.currentTime;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const high = audioCtx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 2000;
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.18, now + 0.03);
    env.gain.setTargetAtTime(0.0001, now + duration * 0.7, 0.05);
    src.connect(high).connect(env).connect(master);
    src.start(now);
    src.stop(now + duration + 0.2);
  }

  function triggerThump(time) {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(rand(70, 100), time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.18);
    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(0.28, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
    osc.connect(env).connect(master);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  function pulseScheduler() {
    if (!running || !audioCtx) return;
    const now = audioCtx.currentTime;
    const tempo = +tempoSlider.value / 100;
    const chaos = chaosAmt();
    const interval = lerp(1.05, 0.42, tempo);
    while (nextPulseAt < now + 0.2) {
      if (nextPulseAt < now) nextPulseAt = now;
      if (Math.random() > chaos * 0.4) triggerThump(nextPulseAt);
      nextPulseAt += interval * rand(0.92, 1.08);
    }
    pulseTimer = setTimeout(pulseScheduler, 60);
  }

  // ---- transport --------------------------------------------------

  function start() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    running = true;
    currentShot = null;
    nextPulseAt = audioCtx.currentTime + 0.1;
    pulseScheduler();
    materials.forEach((m) => { if (m.kind === "video") m.el.play().catch(() => {}); });
    master.gain.setTargetAtTime(0.8, audioCtx.currentTime, 0.05);
    playBtn.textContent = "停止";
    playBtn.classList.add("playing");
    updateHint(currentRegimeName);
  }

  function stop() {
    running = false;
    clearTimeout(pulseTimer);
    materials.forEach((m) => { if (m.kind === "video") { try { m.el.pause(); } catch (e) {} } });
    if (audioCtx) master.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.2);
    playBtn.textContent = "上映開始";
    playBtn.classList.remove("playing");
  }

  playBtn.addEventListener("click", () => { running ? stop() : start(); });

  diceBtn.addEventListener("click", () => {
    currentRegimeName = pickRegime(currentRegimeName);
    updateHint(currentRegimeName);
    flashEl.style.transition = "none";
    flashEl.style.opacity = "0.4";
    requestAnimationFrame(() => {
      flashEl.style.transition = "opacity 0.35s ease";
      flashEl.style.opacity = "0";
    });
    if (running) currentShot = null; // force an immediate cut
  });

  resize();
  buildGrainTile();
  updateHint(currentRegimeName);
  requestAnimationFrame(loop);
})();
