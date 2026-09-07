// app.js — UI glue for the quantum sample editor
(() => {
  const DSP = window.QuantumDSP;

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const browseBtn = document.getElementById("browseBtn");
  const fileInfo = document.getElementById("fileInfo");

  const waveOrig = document.getElementById("waveOrig");
  const waveProc = document.getElementById("waveProc");
  const playOrigBtn = document.getElementById("playOrig");
  const playProcBtn = document.getElementById("playProc");

  const applyBtn = document.getElementById("applyBtn");
  const exportBtn = document.getElementById("exportBtn");
  const statusEl = document.getElementById("status");

  const WINDOW_SIZES = [128, 256, 512, 1024, 2048, 4096, 8192];

  let audioCtx = null;
  let originalBuffer = null; // { sampleRate, channels: [Float32Array, ...] }
  let processedBuffer = null;
  let currentSource = null;

  function ctx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  // ---- file loading -----------------------------------------------------

  function setStatus(msg) { statusEl.textContent = msg; }

  async function loadFile(file) {
    setStatus("読み込み中…");
    try {
      const arrayBuf = await file.arrayBuffer();
      const audioBuffer = await ctx().decodeAudioData(arrayBuf);
      const channels = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        channels.push(Float32Array.from(audioBuffer.getChannelData(c)));
      }
      originalBuffer = { sampleRate: audioBuffer.sampleRate, channels };
      processedBuffer = null;

      const dur = (audioBuffer.length / audioBuffer.sampleRate).toFixed(2);
      fileInfo.textContent = `${file.name} — ${dur}s, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz`;

      drawWaveform(waveOrig, originalBuffer.channels[0]);
      clearCanvas(waveProc);
      updateHeisenbergReadout();

      playOrigBtn.disabled = false;
      playProcBtn.disabled = true;
      applyBtn.disabled = false;
      exportBtn.disabled = true;
      setStatus("読み込み完了。パラメータを選んで実行してください。");
    } catch (err) {
      console.error(err);
      setStatus("読み込みに失敗しました: " + err.message);
    }
  }

  browseBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  // ---- waveform drawing ---------------------------------------------------

  function clearCanvas(canvas) {
    const c = canvas.getContext("2d");
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    c.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawWaveform(canvas, data) {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    const c = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "rgba(0,0,0,0)";
    c.strokeStyle = "#8f6bff";
    c.lineWidth = Math.max(1, devicePixelRatio);
    c.beginPath();

    const step = Math.max(1, Math.floor(data.length / w));
    for (let x = 0; x < w; x++) {
      const start = x * step;
      let min = 1, max = -1;
      for (let i = 0; i < step && start + i < data.length; i++) {
        const v = data[start + i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = (0.5 - min * 0.48) * h;
      const y2 = (0.5 - max * 0.48) * h;
      c.moveTo(x, y1);
      c.lineTo(x, y2);
    }
    c.stroke();
  }

  window.addEventListener("resize", () => {
    if (originalBuffer) drawWaveform(waveOrig, originalBuffer.channels[0]);
    if (processedBuffer) drawWaveform(waveProc, processedBuffer.channels[0]);
  });

  // ---- playback -----------------------------------------------------------

  function play(buf, btn) {
    if (currentSource) {
      try { currentSource.stop(); } catch (e) {}
    }
    const c = ctx();
    const audioBuffer = c.createBuffer(buf.channels.length, buf.channels[0].length, buf.sampleRate);
    for (let ch = 0; ch < buf.channels.length; ch++) {
      audioBuffer.copyToChannel(buf.channels[ch], ch);
    }
    const src = c.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(c.destination);
    src.start();
    currentSource = src;
    btn.textContent = "■ 停止";
    src.onended = () => { btn.textContent = "▶ 再生"; };
    btn.dataset.playing = "1";
  }

  playOrigBtn.addEventListener("click", () => {
    if (playOrigBtn.dataset.playing === "1" && currentSource) {
      currentSource.stop();
      playOrigBtn.textContent = "▶ 再生";
      playOrigBtn.dataset.playing = "0";
      return;
    }
    play(originalBuffer, playOrigBtn);
  });
  playProcBtn.addEventListener("click", () => {
    if (playProcBtn.dataset.playing === "1" && currentSource) {
      currentSource.stop();
      playProcBtn.textContent = "▶ 再生";
      playProcBtn.dataset.playing = "0";
      return;
    }
    play(processedBuffer, playProcBtn);
  });

  // ---- live parameter readouts ---------------------------------------------

  const el = (id) => document.getElementById(id);

  function updateHeisenbergReadout() {
    const N = WINDOW_SIZES[+el("windowSize").value];
    el("winLabel").textContent = `${N} sample`;
    if (!originalBuffer) {
      el("heisenbergReadout").textContent = "";
      return;
    }
    const sr = originalBuffer.sampleRate;
    const dt = (N / sr) * 1000;
    const df = sr / N;
    el("heisenbergReadout").textContent =
      `Δt ≈ ${dt.toFixed(1)} ms, Δf ≈ ${df.toFixed(1)} Hz, Δt·Δf ≈ ${((dt / 1000) * df).toFixed(2)}`;
  }

  function updateTunnelReadout() {
    const E = +el("tunnelE").value / 100;
    const L = +el("tunnelL").value / 10;
    el("tunnelELabel").textContent = E.toFixed(2);
    el("tunnelLLabel").textContent = L.toFixed(1);
    const T = DSP.computeTunnelingT(E, L);
    el("tunnelReadout").textContent = `透過係数 T = ${T.toFixed(4)} （1回の透過ごとの振幅倍率）`;
  }

  function updateEntangleReadout() {
    const angleDeg = +el("entAngle").value;
    el("entAngleLabel").textContent = `${angleDeg}°`;
    const corr = -Math.cos((angleDeg * Math.PI) / 180);
    el("entangleReadout").textContent = `相関 E(a,b) = −cos(Δθ) = ${corr.toFixed(3)}`;
  }

  [
    ["windowSize", updateHeisenbergReadout],
    ["qhoN", () => { el("qhoNLabel").textContent = `n = ${el("qhoN").value}`; }],
    ["qhoMix", () => { el("qhoMixLabel").textContent = `${el("qhoMix").value}%`; }],
    ["dispersion", () => { el("dispersionLabel").textContent = `${el("dispersion").value}%`; }],
    ["qftDepth", () => { el("qftLabel").textContent = `${el("qftDepth").value}%`; }],
    ["grainSize", () => { el("grainSizeLabel").textContent = `${el("grainSize").value} ms`; }],
    ["grainSigma", () => { el("grainSigmaLabel").textContent = `${(+el("grainSigma").value / 10).toFixed(1)} grains`; }],
    ["tunnelE", updateTunnelReadout],
    ["tunnelL", updateTunnelReadout],
    ["tunnelDelay", () => { el("tunnelDelayLabel").textContent = `${el("tunnelDelay").value} ms`; }],
    ["tunnelWet", () => { el("tunnelWetLabel").textContent = `${el("tunnelWet").value}%`; }],
    ["entRate", () => { el("entRateLabel").textContent = `${(+el("entRate").value / 10).toFixed(1)} Hz`; }],
    ["entDepth", () => { el("entDepthLabel").textContent = `${el("entDepth").value}%`; }],
    ["entAngle", updateEntangleReadout],
  ].forEach(([id, fn]) => {
    el(id).addEventListener("input", fn);
    fn();
  });

  // ---- render pipeline ------------------------------------------------------

  function render() {
    const sr = originalBuffer.sampleRate;
    let channels = originalBuffer.channels.map((c) => c.slice());

    // 1. Born-rule granular resequencing (time domain, pre-spectral)
    if (el("granularEnable").checked) {
      const grainSamples = Math.round((+el("grainSize").value / 1000) * sr);
      const sigma = +el("grainSigma").value / 10;
      channels = channels.map((c) => DSP.grainCollapse(c, grainSamples, sigma));
    }

    // 2. STFT-domain quantum spectral effects
    const anyQhoDispQft =
      el("qhoEnable").checked || el("dispersionEnable").checked || el("qftEnable").checked;
    if (anyQhoDispQft) {
      const N = WINDOW_SIZES[+el("windowSize").value];
      const hop = Math.max(1, Math.floor(N / 4));
      const params = {
        qhoN: el("qhoEnable").checked ? +el("qhoN").value : 0,
        qhoMix: el("qhoEnable").checked ? +el("qhoMix").value / 100 : 0,
        dispersion: el("dispersionEnable").checked ? +el("dispersion").value / 100 : 0,
        qftDepth: el("qftEnable").checked ? +el("qftDepth").value / 100 : 0,
        hopSize: hop,
      };
      channels = channels.map((c) => {
        const effect = DSP.buildQuantumSpectralEffect(params);
        return DSP.stftProcess(c, sr, N, hop, effect);
      });
    }

    // 3. Quantum tunneling echo (time domain, post)
    if (el("tunnelEnable").checked) {
      const E = +el("tunnelE").value / 100;
      const L = +el("tunnelL").value / 10;
      const delayTime = +el("tunnelDelay").value / 1000;
      const wet = +el("tunnelWet").value / 100;
      const result = DSP.applyTunnelingEcho(channels, sr, { E, L, delayTime, wet });
      channels = result.channels;
    }

    // 4. Bell-correlated stereo modulation (needs 2 channels)
    if (el("entangleEnable").checked) {
      if (channels.length === 1) channels = [channels[0], channels[0].slice()];
      const rate = +el("entRate").value / 10;
      const depth = +el("entDepth").value / 100;
      const angleRad = (+el("entAngle").value * Math.PI) / 180;
      const [l, r] = DSP.entangledStereo(channels[0], channels[1], sr, { rate, depth, angleRad });
      channels = [l, r];
    }

    // safety: peaks above 0dBFS are scaled down uniformly rather than
    // hard-clipped, since stacking several effects can add constructively
    let peak = 0;
    for (const c of channels) for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
    }
    if (peak > 1) {
      const scale = 1 / peak;
      channels = channels.map((c) => {
        const out = new Float32Array(c.length);
        for (let i = 0; i < c.length; i++) out[i] = c[i] * scale;
        return out;
      });
    }

    return { sampleRate: sr, channels };
  }

  applyBtn.addEventListener("click", () => {
    if (!originalBuffer) return;
    setStatus("波動関数を崩壊させています…");
    applyBtn.disabled = true;
    setTimeout(() => {
      try {
        const start = performance.now();
        processedBuffer = render();
        const ms = (performance.now() - start).toFixed(0);
        drawWaveform(waveProc, processedBuffer.channels[0]);
        playProcBtn.disabled = false;
        exportBtn.disabled = false;
        setStatus(`崩壊完了 (${ms} ms)。再生またはエクスポートできます。`);
      } catch (err) {
        console.error(err);
        setStatus("処理中にエラーが発生しました: " + err.message);
      } finally {
        applyBtn.disabled = false;
      }
    }, 20);
  });

  exportBtn.addEventListener("click", () => {
    if (!processedBuffer) return;
    const blob = DSP.encodeWav(processedBuffer.sampleRate, processedBuffer.channels);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quantum-collapsed.wav";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });

  // ---- background: electron-cloud visualization tied to QHO n -----------

  const cloudCanvas = document.getElementById("cloud");
  const cloudCtx = cloudCanvas.getContext("2d");
  let points = [];

  function resizeCloud() {
    cloudCanvas.width = window.innerWidth * devicePixelRatio;
    cloudCanvas.height = window.innerHeight * devicePixelRatio;
  }
  window.addEventListener("resize", resizeCloud);
  resizeCloud();

  function regeneratePoints() {
    const n = +el("qhoN").value;
    const w = cloudCanvas.width, h = cloudCanvas.height;
    const cx = w / 2, cy = h / 2;
    const scale = Math.min(w, h) * 0.09;
    points = [];
    for (let i = 0; i < 260; i++) {
      // rejection-sample x from |psi_n(x)|^2 on [-5,5]
      let x, accept = false, tries = 0;
      while (!accept && tries < 30) {
        x = (Math.random() * 2 - 1) * 5;
        const psi = DSP.hermite(n, x) * Math.exp(-(x * x) / 2);
        const p = psi * psi;
        accept = Math.random() < p / (n + 1);
        tries++;
      }
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.abs(x || 0) * scale + Math.random() * scale * 0.3;
      points.push({
        angle,
        radius,
        speed: (Math.random() - 0.5) * 0.0025,
        r: 1 + Math.random() * 1.6,
      });
    }
  }
  el("qhoN").addEventListener("input", regeneratePoints);
  regeneratePoints();

  function drawCloud() {
    const w = cloudCanvas.width, h = cloudCanvas.height;
    const cx = w / 2, cy = h / 2;
    cloudCtx.fillStyle = "rgba(8,7,15,0.14)";
    cloudCtx.fillRect(0, 0, w, h);
    points.forEach((p) => {
      p.angle += p.speed;
      const x = cx + Math.cos(p.angle) * p.radius;
      const y = cy + Math.sin(p.angle) * p.radius * 0.6;
      const grad = cloudCtx.createRadialGradient(x, y, 0, x, y, p.r * 6);
      grad.addColorStop(0, "rgba(143,107,255,0.5)");
      grad.addColorStop(1, "rgba(143,107,255,0)");
      cloudCtx.fillStyle = grad;
      cloudCtx.beginPath();
      cloudCtx.arc(x, y, p.r * 6, 0, Math.PI * 2);
      cloudCtx.fill();
    });
    requestAnimationFrame(drawCloud);
  }
  requestAnimationFrame(drawCloud);
})();
