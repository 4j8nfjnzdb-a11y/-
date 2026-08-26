// ikimono — polymetric sample life
//
// Load one or more samples. Each "layer" is a small creature that lives on
// its own beat cycle (3, 5, 7, 9, 11... beats long). Every cycle it chews
// through a stretch of the sample, one grain per beat, then keeps reading
// onward from where it left off. Layers drift on their own over time, and
// pressing "変異させる" (mutate) forces every layer to jump to a new spot,
// a new reading speed, or even reverse direction — so the same sample keeps
// turning into a different DJ mix that never repeats.

(() => {
  "use strict";

  // ---------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const loaderStatus = document.getElementById("loaderStatus");
  const sampleListEl = document.getElementById("sampleList");

  const playBtn = document.getElementById("playBtn");
  const evolveBtn = document.getElementById("evolveBtn");
  const shuffleBtn = document.getElementById("shuffleBtn");
  const genCountEl = document.getElementById("genCount");

  const bpmSlider = document.getElementById("bpm");
  const bpmVal = document.getElementById("bpmVal");
  const tapBtn = document.getElementById("tapBtn");
  const mutationSlider = document.getElementById("mutation");
  const mutVal = document.getElementById("mutVal");
  const driftSlider = document.getElementById("drift");
  const driftVal = document.getElementById("driftVal");
  const masterVolSlider = document.getElementById("masterVol");
  const volVal = document.getElementById("volVal");
  const masterFilterSlider = document.getElementById("masterFilter");
  const filtVal = document.getElementById("filtVal");
  const reverbSendSlider = document.getElementById("reverbSend");
  const verbVal = document.getElementById("verbVal");

  const newMeterInput = document.getElementById("newMeter");
  const addLayerBtn = document.getElementById("addLayerBtn");
  const layersEl = document.getElementById("layers");

  // ---------------------------------------------------------------
  // state
  // ---------------------------------------------------------------
  let audioCtx = null;
  let masterGain, masterFilter, compressor, dryGain, reverbGain, reverbNode;
  let running = false;
  let schedulerTimer = null;
  let generation = 0;

  const samples = []; // { name, buffer, peaks, duration }
  const layers = [];  // layer objects, see makeLayer()
  let layerSeq = 0;

  let bpm = 100;

  const LOOKAHEAD = 0.15; // seconds scheduled ahead
  const TICK_MS = 25;

  const DEFAULT_METERS = [3, 5, 7, 9, 11];

  // ---------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = (v, len) => {
    if (!(len > 0)) return 0;
    let r = v % len;
    if (r < 0) r += len;
    return r;
  };
  const randRange = (a, b) => a + Math.random() * (b - a);

  function hueForMeter(n) {
    const known = { 3: 178, 5: 322, 7: 40, 9: 148, 11: 265 };
    if (known[n] !== undefined) return known[n];
    return (n * 47) % 360;
  }
  function colorForLayer(layer) {
    return `hsl(${layer.hue} 70% 62%)`;
  }

  function setStatus(msg, isError) {
    loaderStatus.textContent = msg;
    loaderStatus.classList.toggle("error", !!isError);
  }

  // ---------------------------------------------------------------
  // audio graph
  // ---------------------------------------------------------------
  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = (+masterVolSlider.value / 100) ** 1.5;

    masterFilter = audioCtx.createBiquadFilter();
    masterFilter.type = "lowpass";
    masterFilter.frequency.value = 18000;
    masterFilter.Q.value = 0.3;

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 3.2;

    dryGain = audioCtx.createGain();
    dryGain.gain.value = 1;

    reverbGain = audioCtx.createGain();
    reverbGain.gain.value = +reverbSendSlider.value / 100;

    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = buildImpulseResponse(audioCtx, 2.6, 2.4);

    dryGain.connect(masterFilter);
    reverbGain.connect(reverbNode).connect(masterFilter);
    masterFilter.connect(compressor).connect(masterGain).connect(audioCtx.destination);
  }

  function buildImpulseResponse(ctx, duration, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  // ---------------------------------------------------------------
  // sample loading
  // ---------------------------------------------------------------
  function computePeaks(buffer, buckets) {
    const data = buffer.getChannelData(0);
    const chunk = Math.max(1, Math.floor(data.length / buckets));
    const peaks = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) {
      const start = i * chunk;
      const end = Math.min(start + chunk, data.length);
      let max = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return peaks;
  }

  async function handleFiles(fileList) {
    ensureAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const files = Array.from(fileList).filter((f) => f.type.startsWith("audio") || /\.(wav|mp3|m4a|ogg|flac|aiff?|webm)$/i.test(f.name));
    if (files.length === 0) {
      setStatus("音声ファイルが見つかりませんでした。", true);
      return;
    }

    for (const file of files) {
      setStatus(`読み込み中… ${file.name}`);
      try {
        const arrayBuf = await file.arrayBuffer();
        const audioBuf = await audioCtx.decodeAudioData(arrayBuf.slice(0));
        const sample = {
          name: file.name,
          buffer: audioBuf,
          duration: audioBuf.duration,
          peaks: computePeaks(audioBuf, 360),
        };
        samples.push(sample);
        renderSampleList();
        assignSampleToEmptyLayers(samples.length - 1);
        setStatus(`読み込み完了: ${file.name} (${audioBuf.duration.toFixed(2)}秒)`);
      } catch (err) {
        console.error(err);
        setStatus(`読み込み失敗: ${file.name} — このファイル形式はブラウザで再生できないようです。`, true);
      }
    }

    if (layers.length === 0 && samples.length > 0) {
      buildDefaultLayers();
    }
  }

  function renderSampleList() {
    sampleListEl.innerHTML = "";
    samples.forEach((s, idx) => {
      const chip = document.createElement("div");
      chip.className = "sampleChip";

      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = s.name;
      name.title = s.name;
      const rm = document.createElement("button");
      rm.className = "rm";
      rm.textContent = "×";
      rm.title = "このサンプルを削除";
      rm.addEventListener("click", () => removeSample(idx));
      row.appendChild(name);
      row.appendChild(rm);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${s.duration.toFixed(2)}秒`;

      const canvas = document.createElement("canvas");
      canvas.width = 220;
      canvas.height = 28;
      drawWave(canvas, s.peaks, null, "rgba(234,230,223,0.5)");

      chip.appendChild(row);
      chip.appendChild(meta);
      chip.appendChild(canvas);
      sampleListEl.appendChild(chip);
    });
    refreshAllSampleSelects();
  }

  function removeSample(idx) {
    samples.splice(idx, 1);
    layers.forEach((l) => {
      if (l.sampleIndex === idx) l.sampleIndex = null;
      else if (l.sampleIndex != null && l.sampleIndex > idx) l.sampleIndex -= 1;
    });
    renderSampleList();
    layers.forEach(renderLayerCard);
  }

  function assignSampleToEmptyLayers(idx) {
    layers.forEach((l) => {
      if (l.sampleIndex == null) {
        setLayerSample(l, idx);
      }
    });
  }

  // ---------------------------------------------------------------
  // layers
  // ---------------------------------------------------------------
  function makeLayer(meter) {
    const layer = {
      id: layerSeq++,
      meter,
      hue: hueForMeter(meter),
      enabled: true,
      sampleIndex: samples.length > 0 ? 0 : null,
      regionStart: 0,
      scanStep: 0, // seconds advanced per grain; set once BPM known
      volume: 0.85,
      pan: randRange(-0.4, 0.4),
      nextCycleTime: 0,
      gainNode: null,
      pannerNode: null,
      canvas: null,
      cardEl: null,
    };
    if (audioCtx) buildLayerNodes(layer);
    randomizeRegion(layer, true);
    return layer;
  }

  function buildLayerNodes(layer) {
    layer.gainNode = audioCtx.createGain();
    layer.gainNode.gain.value = layer.volume;
    layer.pannerNode = audioCtx.createStereoPanner();
    layer.pannerNode.pan.value = layer.pan;
    layer.gainNode.connect(layer.pannerNode);
    layer.pannerNode.connect(dryGain);
    layer.pannerNode.connect(reverbGain);
  }

  function beatDur() {
    return 60 / bpm;
  }

  function randomizeRegion(layer, resetScan) {
    const s = samples[layer.sampleIndex];
    const dur = s ? s.duration : 4;
    layer.regionStart = Math.random() * dur;
    if (resetScan) {
      layer.scanStep = beatDur() * (Math.random() < 0.15 ? -1 : 1) * randRange(0.85, 1.15);
    }
  }

  function setLayerSample(layer, idx) {
    layer.sampleIndex = idx;
    randomizeRegion(layer, true);
    renderLayerCard(layer);
  }

  function buildDefaultLayers() {
    DEFAULT_METERS.forEach((n) => addLayer(n));
  }

  function addLayer(meter) {
    meter = clamp(Math.round(meter), 2, 32);
    const layer = makeLayer(meter);
    layers.push(layer);
    renderLayerCard(layer);
    return layer;
  }

  function removeLayer(layer) {
    const i = layers.indexOf(layer);
    if (i === -1) return;
    if (layer.gainNode) {
      try { layer.gainNode.disconnect(); } catch (e) {}
      try { layer.pannerNode.disconnect(); } catch (e) {}
    }
    layers.splice(i, 1);
    if (layer.cardEl) layer.cardEl.remove();
  }

  function refreshAllSampleSelects() {
    layers.forEach(renderLayerCard);
  }

  // ---- layer card UI ----

  function renderLayerCard(layer) {
    let card = layer.cardEl;
    const fresh = !card;
    if (fresh) {
      card = document.createElement("div");
      card.className = "layerCard";
      layer.cardEl = card;
      layersEl.appendChild(card);
    }
    card.style.setProperty("--layer-color", colorForLayer(layer));
    card.classList.toggle("enabled", layer.enabled);
    card.innerHTML = "";

    const top = document.createElement("div");
    top.className = "top";
    const label = document.createElement("div");
    label.className = "meterLabel";
    label.innerHTML = `${layer.meter}拍子<small>layer #${layer.id}</small>`;
    const topBtns = document.createElement("div");
    topBtns.className = "topBtns";
    const toggle = document.createElement("button");
    toggle.className = "toggle";
    toggle.textContent = layer.enabled ? "●" : "○";
    toggle.title = "ミュート切り替え";
    toggle.addEventListener("click", () => {
      layer.enabled = !layer.enabled;
      renderLayerCard(layer);
    });
    const rmBtn = document.createElement("button");
    rmBtn.className = "rmBtn";
    rmBtn.textContent = "×";
    rmBtn.title = "レイヤーを削除";
    rmBtn.addEventListener("click", () => removeLayer(layer));
    topBtns.appendChild(toggle);
    topBtns.appendChild(rmBtn);
    top.appendChild(label);
    top.appendChild(topBtns);

    const select = document.createElement("select");
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "— サンプル未選択 —";
    select.appendChild(noneOpt);
    samples.forEach((s, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = s.name;
      if (layer.sampleIndex === idx) opt.selected = true;
      select.appendChild(opt);
    });
    if (layer.sampleIndex == null) noneOpt.selected = true;
    select.addEventListener("change", () => {
      const v = select.value;
      setLayerSample(layer, v === "" ? null : +v);
    });

    const canvas = document.createElement("canvas");
    canvas.className = "wave";
    canvas.width = 300;
    canvas.height = 46;
    layer.canvas = canvas;

    const miniRow = document.createElement("div");
    miniRow.className = "miniRow";

    const volLabel = document.createElement("label");
    volLabel.className = "miniSlider";
    volLabel.innerHTML = "音量";
    const volInput = document.createElement("input");
    volInput.type = "range";
    volInput.min = "0";
    volInput.max = "100";
    volInput.value = String(Math.round(layer.volume * 100));
    volInput.addEventListener("input", () => {
      layer.volume = +volInput.value / 100;
      if (layer.gainNode) layer.gainNode.gain.setTargetAtTime(layer.volume, audioCtx.currentTime, 0.02);
    });
    volLabel.appendChild(volInput);

    const panLabel = document.createElement("label");
    panLabel.className = "miniSlider";
    panLabel.innerHTML = "定位";
    const panInput = document.createElement("input");
    panInput.type = "range";
    panInput.min = "-100";
    panInput.max = "100";
    panInput.value = String(Math.round(layer.pan * 100));
    panInput.addEventListener("input", () => {
      layer.pan = +panInput.value / 100;
      if (layer.pannerNode) layer.pannerNode.pan.setTargetAtTime(layer.pan, audioCtx.currentTime, 0.02);
    });
    panLabel.appendChild(panInput);

    miniRow.appendChild(volLabel);
    miniRow.appendChild(panLabel);

    const stateLine = document.createElement("div");
    stateLine.className = "stateLine";
    layer.stateLineEl = stateLine;

    card.appendChild(top);
    card.appendChild(select);
    card.appendChild(canvas);
    card.appendChild(miniRow);
    card.appendChild(stateLine);

    drawLayerWave(layer);
    updateStateLine(layer);
  }

  function updateStateLine(layer) {
    if (!layer.stateLineEl) return;
    const dir = layer.scanStep >= 0 ? "→" : "←";
    const speed = beatDur() > 0 ? Math.abs(layer.scanStep) / beatDur() : 1;
    layer.stateLineEl.textContent = `開始 ${layer.regionStart.toFixed(2)}s ${dir} 速度×${speed.toFixed(2)}`;
  }

  function drawWave(canvas, peaks, regionInfo, color) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.0)";
    ctx.fillRect(0, 0, w, h);

    if (regionInfo) {
      ctx.fillStyle = regionInfo.color;
      ctx.globalAlpha = 0.22;
      ctx.fillRect(regionInfo.x0 * w, 0, Math.max(2, (regionInfo.x1 - regionInfo.x0) * w), h);
      ctx.globalAlpha = 1;
    }

    if (peaks && peaks.length) {
      const mid = h / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < peaks.length; i++) {
        const x = (i / peaks.length) * w;
        const amp = peaks[i] * mid * 0.95;
        ctx.moveTo(x, mid - amp);
        ctx.lineTo(x, mid + amp);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(234,230,223,0.35)";
      ctx.font = "11px sans-serif";
      ctx.fillText("サンプル未選択", 8, h / 2 + 4);
    }
  }

  function drawLayerWave(layer) {
    if (!layer.canvas) return;
    const s = layer.sampleIndex != null ? samples[layer.sampleIndex] : null;
    if (!s) {
      drawWave(layer.canvas, null, null, colorForLayer(layer));
      return;
    }
    const span = layer.meter * Math.abs(layer.scanStep || beatDur());
    const x0 = clamp(layer.regionStart / s.duration, 0, 1);
    const x1 = clamp((layer.regionStart + span * Math.sign(layer.scanStep || 1)) / s.duration, 0, 1);
    drawWave(layer.canvas, s.peaks, { x0: Math.min(x0, x1), x1: Math.max(x0, x1), color: colorForLayer(layer) }, "rgba(234,230,223,0.55)");
  }

  function flashLayer(layer) {
    if (!layer.cardEl) return;
    layer.cardEl.animate(
      [{ boxShadow: `0 0 0 0 ${colorForLayer(layer)}` }, { boxShadow: `0 0 18px 1px ${colorForLayer(layer)}` }, { boxShadow: `0 0 0 0 transparent` }],
      { duration: Math.max(120, beatDur() * 900), easing: "ease-out" }
    );
  }

  // ---------------------------------------------------------------
  // grain playback + scheduling
  // ---------------------------------------------------------------
  function playGrain(layer, buffer, offset, dur, when, rateVar, panJitter) {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rateVar;

    const env = audioCtx.createGain();
    const atk = Math.min(0.006, dur * 0.25);
    const rel = Math.min(0.025, dur * 0.35);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + atk);
    env.gain.setValueAtTime(1, Math.max(when + atk, when + dur - rel));
    env.gain.linearRampToValueAtTime(0, when + dur);

    const jitterPan = audioCtx.createStereoPanner();
    jitterPan.pan.value = clamp(panJitter, -1, 1);

    src.connect(env).connect(jitterPan).connect(layer.gainNode);

    const safeOffset = clamp(offset, 0, Math.max(0, buffer.duration - 0.001));
    src.start(when, safeOffset, dur + 0.05);
    src.stop(when + dur + 0.08);
  }

  function maybeAutoDrift(layer) {
    const driftAmt = +driftSlider.value / 100;
    if (driftAmt <= 0) return;
    if (Math.random() < driftAmt * 0.35) {
      const s = samples[layer.sampleIndex];
      const dur = s ? s.duration : 4;
      layer.regionStart = wrap(layer.regionStart + (Math.random() * 2 - 1) * beatDur() * randRange(1, 4), dur);
    }
    if (Math.random() < driftAmt * 0.15) {
      layer.scanStep *= 1 + (Math.random() * 2 - 1) * 0.12;
    }
  }

  function scheduleCycle(layer, cycleStart) {
    const s = samples[layer.sampleIndex];
    if (!s) {
      layer.nextCycleTime = cycleStart + layer.meter * beatDur();
      return;
    }
    maybeAutoDrift(layer);

    const bd = beatDur();
    const N = layer.meter;
    for (let i = 0; i < N; i++) {
      const t = cycleStart + i * bd;
      const off = wrap(layer.regionStart + i * layer.scanStep, s.duration);
      const dur = bd * 0.9;
      const rateVar = 1 + (Math.random() * 2 - 1) * 0.012;
      const panJ = layer.pan + (Math.random() * 2 - 1) * 0.1;
      playGrain(layer, s.buffer, off, dur, t, rateVar, panJ);

      const delayMs = (t - audioCtx.currentTime) * 1000;
      setTimeout(() => flashLayer(layer), Math.max(0, delayMs));
    }
    layer.regionStart = wrap(layer.regionStart + N * layer.scanStep, s.duration);
    layer.nextCycleTime = cycleStart + N * bd;

    drawLayerWave(layer);
    updateStateLine(layer);
  }

  function schedulerTick() {
    if (!running) return;
    const now = audioCtx.currentTime;
    layers.forEach((layer) => {
      if (!layer.enabled || layer.sampleIndex == null) return;
      let guard = 0;
      while (layer.nextCycleTime < now + LOOKAHEAD && guard < 32) {
        scheduleCycle(layer, Math.max(layer.nextCycleTime, now));
        guard++;
      }
    });
    schedulerTimer = setTimeout(schedulerTick, TICK_MS);
  }

  // ---------------------------------------------------------------
  // transport
  // ---------------------------------------------------------------
  function start() {
    ensureAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (layers.length === 0 && samples.length > 0) buildDefaultLayers();
    layers.forEach((l) => {
      if (!l.gainNode) buildLayerNodes(l);
      l.nextCycleTime = audioCtx.currentTime + 0.05;
    });
    running = true;
    schedulerTick();
    playBtn.textContent = "停止";
    playBtn.classList.add("playing");
  }

  function stop() {
    running = false;
    clearTimeout(schedulerTimer);
    playBtn.textContent = "再生";
    playBtn.classList.remove("playing");
  }

  playBtn.addEventListener("click", () => {
    if (running) stop();
    else start();
  });

  evolveBtn.addEventListener("click", () => {
    const amt = +mutationSlider.value / 100;
    generation++;
    genCountEl.textContent = String(generation);
    layers.forEach((layer) => {
      const s = samples[layer.sampleIndex];
      const dur = s ? s.duration : 4;
      layer.regionStart = wrap(layer.regionStart + (Math.random() * 2 - 1) * amt * dur * 0.6, dur);
      if (Math.random() < 0.12 + amt * 0.3) layer.scanStep *= -1;
      layer.scanStep *= 1 + (Math.random() * 2 - 1) * amt * 0.8;
      const minStep = beatDur() * 0.15;
      if (Math.abs(layer.scanStep) < minStep) layer.scanStep = minStep * Math.sign(layer.scanStep || 1);
      drawLayerWave(layer);
      updateStateLine(layer);
    });
  });

  shuffleBtn.addEventListener("click", () => {
    generation++;
    genCountEl.textContent = String(generation);
    layers.forEach((layer) => {
      randomizeRegion(layer, true);
      drawLayerWave(layer);
      updateStateLine(layer);
    });
  });

  // ---------------------------------------------------------------
  // BPM / tap tempo
  // ---------------------------------------------------------------
  bpmSlider.addEventListener("input", () => {
    bpm = +bpmSlider.value;
    bpmVal.textContent = String(bpm);
  });

  let tapTimes = [];
  tapBtn.addEventListener("click", () => {
    const now = performance.now();
    tapTimes = tapTimes.filter((t) => now - t < 2500);
    tapTimes.push(now);
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const newBpm = clamp(Math.round(60000 / avg), 40, 200);
      bpm = newBpm;
      bpmSlider.value = String(newBpm);
      bpmVal.textContent = String(newBpm);
    }
  });

  // ---------------------------------------------------------------
  // misc sliders
  // ---------------------------------------------------------------
  mutationSlider.addEventListener("input", () => {
    mutVal.textContent = (+mutationSlider.value / 100).toFixed(2);
  });
  driftSlider.addEventListener("input", () => {
    driftVal.textContent = (+driftSlider.value / 100).toFixed(2);
  });
  masterVolSlider.addEventListener("input", () => {
    volVal.textContent = masterVolSlider.value;
    if (masterGain) masterGain.gain.setTargetAtTime((+masterVolSlider.value / 100) ** 1.5, audioCtx.currentTime, 0.03);
  });
  masterFilterSlider.addEventListener("input", () => {
    const pct = +masterFilterSlider.value / 100;
    const freq = 120 * Math.pow(18000 / 120, pct);
    filtVal.textContent = freq >= 1000 ? `${(freq / 1000).toFixed(1)}k` : `${Math.round(freq)}`;
    if (masterFilter) masterFilter.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.02);
  });
  reverbSendSlider.addEventListener("input", () => {
    verbVal.textContent = reverbSendSlider.value;
    if (reverbGain) reverbGain.gain.setTargetAtTime(+reverbSendSlider.value / 100, audioCtx.currentTime, 0.05);
  });

  addLayerBtn.addEventListener("click", () => {
    ensureAudio();
    const n = clamp(Math.round(+newMeterInput.value) || 13, 2, 32);
    const layer = addLayer(n);
    if (running) layer.nextCycleTime = audioCtx.currentTime + 0.05;
  });

  // ---------------------------------------------------------------
  // file input / drag-drop
  // ---------------------------------------------------------------
  fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

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
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  });
  dropzone.addEventListener("click", (e) => {
    if (e.target === dropzone) fileInput.click();
  });

  // initial BPM label
  bpmVal.textContent = bpmSlider.value;
})();
