// son morph — UI glue: file loading, spectrogram drawing, the
// trajectory editor, parameter wiring, and render/playback orchestration.
// All the actual signal processing lives in dsp.js / engine.js.

(() => {
  const D = window.SonMorphDSP;
  const E = window.SonMorphEngine;
  const TARGET_SR = 48000;

  const el = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const state = {
    sources: { A: null, B: null },
    playing: { A: null, B: null, out: null },
    trajectory: {
      mode: "segment",
      nodes: [{ t: 0.33, v: 0 }, { t: 0.66, v: 1 }],
      curveType: "s-curve",
      tension: 50,
      overmorph: false,
      freehand: null,
    },
    lengthT: 0.5,
    rendered: null,
    audioCtx: null,
  };

  function getAudioCtx() {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return state.audioCtx;
  }

  function mixDown(channels) {
    const n = channels[0].length;
    const out = new Float32Array(n);
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
    }
    return out;
  }

  function setStatus(msg) { el("statusLine").textContent = msg; }

  // ---------------------------------------------------------------
  // WAV header sniffing (for honest metadata display; falls back
  // gracefully for compressed formats decodeAudioData can still read)
  // ---------------------------------------------------------------
  function parseWavHeader(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 44) return null;
    const str = (o, l) => String.fromCharCode.apply(null, new Uint8Array(arrayBuffer, o, l));
    if (str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") return null;
    let offset = 12;
    let fmt = null;
    while (offset + 8 <= dv.byteLength) {
      const id = str(offset, 4);
      const size = dv.getUint32(offset + 4, true);
      if (id === "fmt ") {
        fmt = {
          numChannels: dv.getUint16(offset + 10, true),
          sampleRate: dv.getUint32(offset + 12, true),
          bitsPerSample: dv.getUint16(offset + 22, true),
        };
      }
      offset += 8 + size + (size % 2);
    }
    return fmt;
  }

  async function decodeAndResample(arrayBuffer, targetSR) {
    const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await tmpCtx.decodeAudioData(arrayBuffer.slice(0));
    tmpCtx.close();
    if (Math.round(decoded.sampleRate) === targetSR) {
      return { buffer: decoded, resampled: false };
    }
    const offline = new OfflineAudioContext(
      decoded.numberOfChannels,
      Math.ceil(decoded.duration * targetSR) + 1,
      targetSR
    );
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    return { buffer: rendered, resampled: true, origSampleRate: decoded.sampleRate };
  }

  async function loadFile(slot, file) {
    setStatus(`${slot} を読み込み中…`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const wavInfo = parseWavHeader(arrayBuffer);
      const { buffer, resampled, origSampleRate } = await decodeAndResample(arrayBuffer, TARGET_SR);
      const channels = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
      const mono = channels.length > 1 ? mixDown(channels) : channels[0];
      const source = {
        fileName: file.name,
        channels,
        mono,
        sampleRate: TARGET_SR,
        duration: channels[0].length / TARGET_SR,
        origSampleRate: origSampleRate || buffer.sampleRate,
        origChannels: buffer.numberOfChannels,
        origBits: wavInfo ? wavInfo.bitsPerSample : null,
        resampled,
      };
      source.specCols = computeSpectrogramColumns(mono, TARGET_SR, 256, 1024);
      state.sources[slot] = source;
      renderSourceCard(slot);
      updateLengthLabel();
      updateRenderReadiness();
      drawTrajectory();
      setStatus("READY");
    } catch (err) {
      console.error(err);
      setStatus(`読み込みエラー: ${err.message}`);
    }
  }

  function renderSourceCard(slot) {
    const src = state.sources[slot];
    el("name" + slot).textContent = src.fileName;
    const bitsStr = src.origBits ? `${src.origBits} bit` : "bit深度不明";
    const convStr = src.resampled
      ? `→ ${(TARGET_SR / 1000).toFixed(0)} kHz へ変換`
      : `そのまま ${(TARGET_SR / 1000).toFixed(0)} kHz`;
    el("info" + slot).textContent =
      `${(src.origSampleRate / 1000).toFixed(1)} kHz · ${bitsStr} · ${src.origChannels} ch · ${src.duration.toFixed(2)} s ${convStr}`;
    drawFullCanvas(el("spec" + slot), src.specCols, slot === "A" ? "#e3a548" : "#57c7e3");
    ["play", "stop", "clear"].forEach((a) => {
      const btn = document.querySelector(`[data-action="${a}"][data-slot="${slot}"]`);
      if (btn) btn.disabled = false;
    });
  }

  function resetCardVisual(slot) {
    el("name" + slot).textContent = "未読み込み";
    el("info" + slot).innerHTML = "&nbsp;";
    const c = el("spec" + slot);
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ["play", "stop", "clear"].forEach((a) => {
      const btn = document.querySelector(`[data-action="${a}"][data-slot="${slot}"]`);
      if (btn) btn.disabled = true;
    });
  }

  // ---------------------------------------------------------------
  // Spectrogram computation + drawing
  // ---------------------------------------------------------------
  // Renders on a log-frequency axis (like a real spectrogram / like
  // the ear) so bass and midrange content — where most musical energy
  // sits — isn't squeezed into a sliver at the bottom of a linear scale.
  function computeSpectrogramColumns(mono, sr, numCols, fftSize, numRows) {
    numRows = numRows || 160;
    const win = D.hannWindow(fftSize);
    const re = new Float32Array(fftSize), im = new Float32Array(fftSize);
    const bins = fftSize / 2 + 1;
    const mag = new Float32Array(bins), phase = new Float32Array(bins);
    const frame = new Float32Array(fftSize);
    const hop = mono.length / numCols;
    let maxDb = -Infinity;
    const raw = [];
    for (let c = 0; c < numCols; c++) {
      const center = c * hop;
      D.extractFrame(mono, center - fftSize / 2, fftSize, win, frame);
      D.analyzeFrame(frame, re, im, mag, phase);
      const db = new Float32Array(bins);
      for (let b = 0; b < bins; b++) {
        db[b] = 20 * Math.log10(mag[b] + 1e-6);
        if (db[b] > maxDb) maxDb = db[b];
      }
      raw.push(db);
    }
    const floor = maxDb - 68;
    const minFreq = 30, maxFreq = sr / 2;
    const logMin = Math.log(minFreq), logMax = Math.log(maxFreq);
    const cols = [];
    for (let c = 0; c < numCols; c++) {
      const db = raw[c];
      const norm = new Float32Array(numRows);
      for (let r = 0; r < numRows; r++) {
        const freq = Math.exp(logMin + (r / (numRows - 1)) * (logMax - logMin));
        const binPos = clamp((freq / sr) * fftSize, 0, bins - 1);
        const b0 = Math.floor(binPos), frac = binPos - b0;
        const b1 = Math.min(bins - 1, b0 + 1);
        const dbVal = db[b0] + (db[b1] - db[b0]) * frac;
        norm[r] = clamp((dbVal - floor) / (maxDb - floor), 0, 1);
      }
      cols.push(norm);
    }
    return cols;
  }

  function hexToRgb(hex) {
    const v = hex.replace("#", "");
    return [parseInt(v.substr(0, 2), 16), parseInt(v.substr(2, 2), 16), parseInt(v.substr(4, 2), 16)];
  }

  function colsToOffscreen(cols, colorHex) {
    const numCols = cols.length, numRows = cols[0].length;
    const off = document.createElement("canvas");
    off.width = numCols; off.height = numRows;
    const octx = off.getContext("2d");
    const img = octx.createImageData(numCols, numRows);
    const [r, g, b] = hexToRgb(colorHex);
    for (let c = 0; c < numCols; c++) {
      const col = cols[c];
      for (let y = 0; y < numRows; y++) {
        const bin = numRows - 1 - y;
        const v = col[bin];
        const idx = (y * numCols + c) * 4;
        img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b;
        img.data[idx + 3] = Math.round(255 * Math.min(1, v * 1.2));
      }
    }
    octx.putImageData(img, 0, 0);
    return off;
  }

  function drawFullCanvas(canvas, cols, colorHex) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round((rect.height || 96) * dpr));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#05070a"; ctx.fillRect(0, 0, w, h);
    if (cols && cols.length) {
      const off = colsToOffscreen(cols, colorHex);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, w, h);
    }
  }

  function drawStripInto(ctx, cols, x, y, w, h, colorHex) {
    ctx.fillStyle = "#05070a"; ctx.fillRect(x, y, w, h);
    if (!cols || !cols.length) return;
    const off = colsToOffscreen(cols, colorHex);
    ctx.drawImage(off, 0, 0, off.width, off.height, x, y, w, h);
  }

  // ---------------------------------------------------------------
  // Trajectory model + evaluation (also used by the render engine)
  // ---------------------------------------------------------------
  function shapeCurve(t, type, tension) {
    switch (type) {
      case "linear": return t;
      case "ease-in": return t * t;
      case "ease-out": return 1 - (1 - t) * (1 - t);
      default: return D.sCurve(t, tension);
    }
  }

  function evalTrajectory(t) {
    const traj = state.trajectory;
    if (traj.mode === "freehand" && traj.freehand) {
      const arr = traj.freehand;
      const pos = t * (arr.length - 1);
      const i0 = Math.floor(pos), frac = pos - i0;
      const i1 = Math.min(arr.length - 1, i0 + 1);
      return arr[i0] + (arr[i1] - arr[i0]) * frac;
    }
    const nodes = traj.nodes;
    if (t <= nodes[0].t) return nodes[0].v;
    const last = nodes[nodes.length - 1];
    if (t >= last.t) return last.v;
    for (let i = 0; i < nodes.length - 1; i++) {
      const n0 = nodes[i], n1 = nodes[i + 1];
      if (t >= n0.t && t <= n1.t) {
        const local = (t - n0.t) / Math.max(1e-6, n1.t - n0.t);
        const shaped = shapeCurve(local, traj.curveType, traj.tension);
        return n0.v + (n1.v - n0.v) * shaped;
      }
    }
    return last.v;
  }

  function mapVToY(v) {
    const lo = state.trajectory.overmorph ? -0.4 : 0;
    const hi = state.trajectory.overmorph ? 1.4 : 1;
    return clamp((v - lo) / (hi - lo), 0, 1);
  }
  function mapYToV(yFrac) {
    const lo = state.trajectory.overmorph ? -0.4 : 0;
    const hi = state.trajectory.overmorph ? 1.4 : 1;
    return lo + yFrac * (hi - lo);
  }

  const STRIP_FRAC = 0.22;
  function yFracToMidFrac(yFrac) { return clamp((yFrac - STRIP_FRAC) / (1 - 2 * STRIP_FRAC), 0, 1); }
  function nodeScreenY(v) { return STRIP_FRAC + mapVToY(v) * (1 - 2 * STRIP_FRAC); }

  function updateReadout() {
    const N = 200;
    let aCount = 0, bCount = 0;
    for (let i = 0; i < N; i++) {
      const v = clamp(evalTrajectory(i / (N - 1)), 0, 1);
      if (v < 0.15) aCount++; else if (v > 0.85) bCount++;
    }
    const aPct = Math.round((aCount / N) * 100);
    const bPct = Math.round((bCount / N) * 100);
    const morphPct = 100 - aPct - bPct;
    el("trajReadout").textContent = `A ${aPct}% / Morph ${morphPct}% / B ${bPct}%`;
  }

  function drawTrajectory() {
    const canvas = el("trajCanvas");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    const stripH = h * STRIP_FRAC;
    const midTop = stripH, midBottom = h - stripH, midH = midBottom - midTop;

    drawStripInto(ctx, state.sources.A ? state.sources.A.specCols : null, 0, 0, w, stripH, "#e3a548");
    drawStripInto(ctx, state.sources.B ? state.sources.B.specCols : null, 0, midBottom, w, stripH, "#57c7e3");

    ctx.fillStyle = "#0a0d11";
    ctx.fillRect(0, midTop, w, midH);

    const N = 240;
    const ys = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) ys[i] = midTop + mapVToY(evalTrajectory(i / N)) * midH;

    ctx.beginPath();
    ctx.moveTo(0, midTop);
    for (let i = 0; i <= N; i++) ctx.lineTo((i / N) * w, ys[i]);
    ctx.lineTo(w, midTop);
    ctx.closePath();
    ctx.fillStyle = "rgba(227,165,72,0.15)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, midBottom);
    for (let i = 0; i <= N; i++) ctx.lineTo((i / N) * w, ys[i]);
    ctx.lineTo(w, midBottom);
    ctx.closePath();
    ctx.fillStyle = "rgba(87,199,227,0.15)";
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * w;
      if (i === 0) ctx.moveTo(x, ys[i]); else ctx.lineTo(x, ys[i]);
    }
    ctx.strokeStyle = "#e7e9ec";
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    if (state.trajectory.mode !== "freehand") {
      state.trajectory.nodes.forEach((node, idx) => {
        const x = node.t * w, y = midTop + mapVToY(node.v) * midH;
        ctx.strokeStyle = "rgba(231,233,236,0.25)";
        ctx.setLineDash([2 * dpr, 3 * dpr]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = idx === 0 ? "#e3a548" : (idx === state.trajectory.nodes.length - 1 ? "#57c7e3" : "#e7e9ec");
        ctx.fill();
      });
    }

    ctx.font = `${10 * dpr}px sans-serif`;
    ctx.fillStyle = "rgba(231,233,236,0.45)";
    ctx.fillText("A 100%", 4 * dpr, midTop + 12 * dpr);
    ctx.fillText("B 100%", 4 * dpr, midBottom + stripH - 4 * dpr);

    updateReadout();
  }

  // ---- trajectory pointer interaction --------------------------------
  const trajCanvas = el("trajCanvas");
  let activeDrag = null;
  let lastFreehand = null;

  function canvasPoint(evt) {
    const rect = trajCanvas.getBoundingClientRect();
    return {
      x: clamp((evt.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((evt.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function nearestNodeIndex(x, y) {
    let best = null, bestD = 0.09;
    state.trajectory.nodes.forEach((n, i) => {
      const d = Math.hypot(x - n.t, y - nodeScreenY(n.v));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function moveNode(idx, t, vFrac) {
    const nodes = state.trajectory.nodes;
    let v = mapYToV(vFrac);
    v = state.trajectory.overmorph ? clamp(v, -0.4, 1.4) : clamp(v, 0, 1);
    let tClamped = clamp(t, 0, 1);
    const eps = 0.015;
    if (nodes[idx - 1]) tClamped = Math.max(tClamped, nodes[idx - 1].t + eps);
    if (nodes[idx + 1]) tClamped = Math.min(tClamped, nodes[idx + 1].t - eps);
    nodes[idx] = { t: tClamped, v };
  }

  function insertNode(t, vFrac) {
    const nodes = state.trajectory.nodes;
    if (nodes.length >= 10) return;
    let v = mapYToV(vFrac);
    v = state.trajectory.overmorph ? clamp(v, -0.4, 1.4) : clamp(v, 0, 1);
    nodes.push({ t: clamp(t, 0.02, 0.98), v });
    nodes.sort((a, b) => a.t - b.t);
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i].t - nodes[i - 1].t < 0.02) nodes[i].t = nodes[i - 1].t + 0.02;
    }
  }

  function paintFreehand(x, y) {
    const arr = state.trajectory.freehand;
    let v = mapYToV(yFracToMidFrac(y));
    v = state.trajectory.overmorph ? clamp(v, -0.4, 1.4) : clamp(v, 0, 1);
    const idx = Math.round(x * (arr.length - 1));
    if (lastFreehand) {
      const i0 = Math.round(lastFreehand.x * (arr.length - 1));
      const lo = Math.min(i0, idx), hi = Math.max(i0, idx);
      for (let i = lo; i <= hi; i++) {
        const frac = hi === lo ? 1 : (i - lo) / (hi - lo);
        arr[i] = lastFreehand.v + (v - lastFreehand.v) * frac;
      }
    } else {
      arr[idx] = v;
    }
    lastFreehand = { x, v };
  }

  trajCanvas.addEventListener("pointerdown", (e) => {
    trajCanvas.setPointerCapture(e.pointerId);
    const { x, y } = canvasPoint(e);
    const mode = state.trajectory.mode;
    if (mode === "freehand") {
      if (!state.trajectory.freehand) {
        const arr = new Float32Array(400);
        for (let i = 0; i < 400; i++) arr[i] = evalTrajectory(i / 399);
        state.trajectory.freehand = arr;
      }
      lastFreehand = null;
      activeDrag = { type: "freehand" };
      paintFreehand(x, y);
    } else if (mode === "segment") {
      const idx = nearestNodeIndex(x, y);
      if (idx != null) activeDrag = { type: "node", idx };
    } else if (mode === "node") {
      const idx = nearestNodeIndex(x, y);
      if (idx != null) {
        activeDrag = { type: "node", idx };
      } else {
        insertNode(x, yFracToMidFrac(y));
        let closest = 0, bestD = Infinity;
        state.trajectory.nodes.forEach((n, i) => { const d = Math.abs(n.t - x); if (d < bestD) { bestD = d; closest = i; } });
        activeDrag = { type: "node", idx: closest };
      }
    }
    drawTrajectory();
  });

  trajCanvas.addEventListener("pointermove", (e) => {
    if (!activeDrag) return;
    const { x, y } = canvasPoint(e);
    if (activeDrag.type === "freehand") paintFreehand(x, y);
    else if (activeDrag.type === "node") moveNode(activeDrag.idx, x, yFracToMidFrac(y));
    drawTrajectory();
  });

  function endDrag() { activeDrag = null; lastFreehand = null; }
  trajCanvas.addEventListener("pointerup", endDrag);
  trajCanvas.addEventListener("pointercancel", endDrag);

  trajCanvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (state.trajectory.mode !== "node") return;
    const { x, y } = canvasPoint(e);
    const idx = nearestNodeIndex(x, y);
    if (idx != null && state.trajectory.nodes.length > 2) {
      state.trajectory.nodes.splice(idx, 1);
      drawTrajectory();
    }
  });

  document.querySelectorAll(".modeBtn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modeBtn[data-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.trajectory.mode = btn.dataset.mode;
      if (state.trajectory.mode === "freehand" && !state.trajectory.freehand) {
        const arr = new Float32Array(400);
        for (let i = 0; i < 400; i++) arr[i] = evalTrajectory(i / 399);
        state.trajectory.freehand = arr;
      }
      if (state.trajectory.mode === "segment" && state.trajectory.nodes.length > 2) {
        const nodes = state.trajectory.nodes;
        state.trajectory.nodes = [nodes[0], nodes[nodes.length - 1]];
      }
      drawTrajectory();
    });
  });

  el("resetTrajBtn").addEventListener("click", () => {
    state.trajectory.mode = "segment";
    state.trajectory.nodes = [{ t: 0.33, v: 0 }, { t: 0.66, v: 1 }];
    state.trajectory.freehand = null;
    state.trajectory.curveType = "s-curve";
    state.trajectory.tension = 50;
    document.querySelectorAll(".modeBtn[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === "segment"));
    el("curveType").value = "s-curve";
    el("tension").value = 50;
    el("tensionVal").textContent = "50";
    updateTensionEnabled();
    drawTrajectory();
  });

  function updateTensionEnabled() { el("tension").disabled = el("curveType").value !== "s-curve"; }

  el("curveType").addEventListener("change", (e) => {
    state.trajectory.curveType = e.target.value;
    updateTensionEnabled();
    drawTrajectory();
  });
  el("tension").addEventListener("input", (e) => {
    state.trajectory.tension = +e.target.value;
    el("tensionVal").textContent = e.target.value;
    drawTrajectory();
  });
  el("overmorph").addEventListener("change", (e) => {
    state.trajectory.overmorph = e.target.checked;
    if (!state.trajectory.overmorph) {
      state.trajectory.nodes.forEach((n) => { n.v = clamp(n.v, 0, 1); });
      if (state.trajectory.freehand) {
        for (let i = 0; i < state.trajectory.freehand.length; i++) {
          state.trajectory.freehand[i] = clamp(state.trajectory.freehand[i], 0, 1);
        }
      }
    }
    drawTrajectory();
  });

  // ---------------------------------------------------------------
  // Length slider
  // ---------------------------------------------------------------
  function updateLengthLabel() {
    const A = state.sources.A, B = state.sources.B;
    el("lengthValue").textContent = (A && B) ? `${(A.duration + (B.duration - A.duration) * state.lengthT).toFixed(2)} s` : "—";
  }
  el("lengthSlider").addEventListener("input", (e) => {
    state.lengthT = +e.target.value / 100;
    updateLengthLabel();
  });

  // ---------------------------------------------------------------
  // Parameter sliders
  // ---------------------------------------------------------------
  function bindSlider(id, suffix) {
    const inp = el(id), out = el(id + "Val");
    const update = () => { out.textContent = inp.value + suffix; };
    inp.addEventListener("input", update);
    update();
  }
  ["formantAmt", "harmonicAmt", "crossSynthesis", "transientPreserve", "percussionSeparation"].forEach((id) => bindSlider(id, "%"));
  bindSlider("toneNoiseBalance", "");
  updateTensionEnabled();

  function collectParams() {
    return {
      prePitch: el("prePitch").value,
      phaseLock: el("phaseLock").checked,
      formantAmt: +el("formantAmt").value,
      denseSynthesis: el("denseSynthesis").checked,
      harmonicAmt: +el("harmonicAmt").value,
      autoTimeAlign: el("autoTimeAlign").checked,
      crossSynthesis: +el("crossSynthesis").value,
      loudnessMatch: el("loudnessMatch").checked,
      transientPreserve: +el("transientPreserve").value,
      peakNormalize: el("peakNormalize").checked,
      percussionSeparation: +el("percussionSeparation").value,
      tpdfDither: el("tpdfDither").checked,
      toneNoiseBalance: +el("toneNoiseBalance").value,
      overmorph: state.trajectory.overmorph,
    };
  }

  // ---------------------------------------------------------------
  // Source card actions
  // ---------------------------------------------------------------
  document.querySelectorAll(".fileInput").forEach((inp) => {
    inp.addEventListener("change", async (e) => {
      const slot = inp.id.slice(-1);
      const file = e.target.files[0];
      if (file) await loadFile(slot, file);
      inp.value = "";
    });
  });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { action, slot } = btn.dataset;
      if (action === "load") el("file" + slot).click();
      else if (action === "play") playSource(slot);
      else if (action === "stop") stopSource(slot);
      else if (action === "clear") clearSource(slot);
    });
  });

  function playSource(slot) {
    const src = state.sources[slot];
    if (!src) return;
    stopSource(slot);
    const ctx = getAudioCtx();
    const buffer = ctx.createBuffer(src.channels.length, src.channels[0].length, TARGET_SR);
    src.channels.forEach((data, c) => buffer.getChannelData(c).set(data));
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.onended = () => { if (state.playing[slot] === node) state.playing[slot] = null; };
    node.start();
    state.playing[slot] = node;
  }
  function stopSource(slot) {
    const node = state.playing[slot];
    if (node) { try { node.stop(); } catch (e) {} state.playing[slot] = null; }
  }
  function clearSource(slot) {
    stopSource(slot);
    state.sources[slot] = null;
    resetCardVisual(slot);
    updateLengthLabel();
    updateRenderReadiness();
    drawTrajectory();
  }

  el("swapBtn").addEventListener("click", () => {
    const tmp = state.sources.A;
    state.sources.A = state.sources.B;
    state.sources.B = tmp;
    ["A", "B"].forEach((slot) => {
      if (state.sources[slot]) renderSourceCard(slot); else resetCardVisual(slot);
    });
    updateLengthLabel();
    drawTrajectory();
  });

  function updateRenderReadiness() {
    el("renderBtn").disabled = !(state.sources.A && state.sources.B);
  }

  // ---------------------------------------------------------------
  // Render + playback of the morphed result
  // ---------------------------------------------------------------
  let rendering = false;
  el("renderBtn").addEventListener("click", async () => {
    if (rendering || !state.sources.A || !state.sources.B) return;
    rendering = true;
    el("renderBtn").disabled = true;
    el("playMorphBtn").disabled = true;
    el("downloadBtn").disabled = true;
    el("progressFill").style.width = "0%";
    setStatus("Rendering…");
    const t0 = performance.now();
    try {
      const params = collectParams();
      const result = await E.render(state.sources.A, state.sources.B, {
        outSampleRate: TARGET_SR,
        fftSize: +el("fftSize").value,
        lengthT: state.lengthT,
        trajectory: evalTrajectory,
        params,
      }, (p) => { el("progressFill").style.width = `${(p * 100).toFixed(1)}%`; });
      const renderMs = performance.now() - t0;
      const mono = result.channels.length > 1 ? mixDown(result.channels) : result.channels[0];
      result.specCols = computeSpectrogramColumns(mono, result.sampleRate, 260, 1024);
      state.rendered = result;
      drawFullCanvas(el("specOut"), result.specCols, "#e7e9ec");
      setStatus(`DONE — ${result.duration.toFixed(2)} s / ${result.channels.length} ch · rendered in ${(renderMs / 1000).toFixed(1)} s`);
      el("playMorphBtn").disabled = false;
      el("downloadBtn").disabled = false;
    } catch (err) {
      console.error(err);
      setStatus(`エラー: ${err.message}`);
    } finally {
      rendering = false;
      el("renderBtn").disabled = false;
    }
  });

  el("playMorphBtn").addEventListener("click", () => {
    if (!state.rendered) return;
    stopMorph();
    const ctx = getAudioCtx();
    const r = state.rendered;
    const buffer = ctx.createBuffer(r.channels.length, r.channels[0].length, r.sampleRate);
    r.channels.forEach((data, c) => buffer.getChannelData(c).set(data));
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.onended = () => { if (state.playing.out === node) { state.playing.out = null; el("stopMorphBtn").disabled = true; } };
    node.start();
    state.playing.out = node;
    el("stopMorphBtn").disabled = false;
  });
  function stopMorph() {
    const n = state.playing.out;
    if (n) { try { n.stop(); } catch (e) {} state.playing.out = null; }
    el("stopMorphBtn").disabled = true;
  }
  el("stopMorphBtn").addEventListener("click", stopMorph);

  el("downloadBtn").addEventListener("click", () => {
    if (!state.rendered) return;
    const dither = el("tpdfDither").checked;
    const blob = D.encodeWav(state.rendered.channels, state.rendered.sampleRate, 24, dither);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseA = (state.sources.A ? state.sources.A.fileName : "A").replace(/\.[^.]+$/, "");
    const baseB = (state.sources.B ? state.sources.B.fileName : "B").replace(/\.[^.]+$/, "");
    a.href = url;
    a.download = `sonmorph_${baseA}_x_${baseB}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  // ---------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.sources.A) drawFullCanvas(el("specA"), state.sources.A.specCols, "#e3a548");
      if (state.sources.B) drawFullCanvas(el("specB"), state.sources.B.specCols, "#57c7e3");
      if (state.rendered) drawFullCanvas(el("specOut"), state.rendered.specCols, "#e7e9ec");
      drawTrajectory();
    }, 150);
  });

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  drawTrajectory();
  updateLengthLabel();
  updateRenderReadiness();
  setStatus("READY");
})();
