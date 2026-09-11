(() => {
  'use strict';

  // ---------- effect definitions ----------

  const FX_DEFS = [
    { key: 'block',   label: 'ブロックずれ',     group: 'グリッチ' },
    { key: 'corrupt', label: '破損ブロック',       group: 'グリッチ' },
    { key: 'noise',   label: 'デジタルノイズ',     group: 'エラー' },
    { key: 'freeze',  label: 'フレーム凍結',       group: 'エラー' },
    { key: 'rgb',     label: 'RGBズレ',           group: 'カラー' },
    { key: 'color',   label: 'カラーエラー',       group: 'カラー' },
    { key: 'scan',    label: '走査線',            group: 'アナログ故障' },
    { key: 'vhs',     label: 'トラッキング/揺れ',  group: 'アナログ故障' },
  ];

  const PRESETS = {
    clear:   {},
    glitch:  { block: 55, corrupt: 40, rgb: 30 },
    error:   { corrupt: 65, noise: 50, freeze: 35, color: 20 },
    analog:  { scan: 50, vhs: 60, noise: 25, rgb: 15 },
    colorfail: { color: 60, rgb: 45, scan: 15 },
    chaos:   { block: 60, corrupt: 60, noise: 45, freeze: 25, rgb: 55, color: 45, scan: 40, vhs: 55 },
  };

  // ---------- state ----------

  const state = {
    effects: {},   // key -> { enabled, amount, checkboxEl, rangeEl, valEl, rowEl }
    master: 100,
    masterEl: null,
    masterValEl: null,
    autoEnabled: false,
    autoFreq: 30,
    smashing: false,
    smashTimeoutId: null,
    smashSnapshotEffects: null,
    smashSnapshotMaster: 100,
    freezeFrames: 0,
    hasFrame: false,
    noiseFrameCounter: 0,
  };

  FX_DEFS.forEach(d => { state.effects[d.key] = { enabled: false, amount: 30 }; });

  // ---------- dom refs ----------

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const stage = document.getElementById('stage');
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  const playBtn = document.getElementById('playBtn');
  const seek = document.getElementById('seek');
  const timeLabel = document.getElementById('timeLabel');
  const loopBtn = document.getElementById('loopBtn');
  const newFileBtn = document.getElementById('newFileBtn');

  const masterEl = document.getElementById('master');
  const masterValEl = document.getElementById('masterVal');
  const smashBtn = document.getElementById('smashBtn');
  const autoEnabledEl = document.getElementById('autoEnabled');
  const autoFreqEl = document.getElementById('autoFreq');

  const fxGrid = document.getElementById('fxGrid');

  const recordBtn = document.getElementById('recordBtn');
  const downloadLink = document.getElementById('downloadLink');
  const recStatus = document.getElementById('recStatus');

  state.masterEl = masterEl;
  state.masterValEl = masterValEl;

  // ---------- helpers ----------

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function randColor() {
    const colors = ['#ff2d95', '#22f0e0', '#f6ff2d', '#ffffff', '#ff4444', '#3d2bff'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatTime(t) {
    if (!isFinite(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ---------- build fx grid UI ----------

  function buildFxGrid() {
    let currentGroup = null;
    FX_DEFS.forEach(def => {
      if (def.group !== currentGroup) {
        currentGroup = def.group;
        const h = document.createElement('div');
        h.className = 'fxGroupLabel';
        h.textContent = currentGroup;
        fxGrid.appendChild(h);
      }

      const row = document.createElement('div');
      row.className = 'fxRow disabled';

      const cb = document.createElement('input');
      cb.type = 'checkbox';

      const label = document.createElement('span');
      label.className = 'fxLabel';
      label.textContent = def.label;

      const range = document.createElement('input');
      range.type = 'range';
      range.min = 0;
      range.max = 100;
      range.value = state.effects[def.key].amount;

      const val = document.createElement('span');
      val.className = 'fxVal';
      val.textContent = `${range.value}%`;

      cb.addEventListener('change', () => {
        const newVal = cb.checked;
        cancelSmash(); // may resync this checkbox back to the pre-smash value
        cb.checked = newVal;
        state.effects[def.key].enabled = newVal;
        row.classList.toggle('disabled', !newVal);
      });

      range.addEventListener('input', () => {
        const newVal = Number(range.value);
        cancelSmash(); // may resync this slider back to the pre-smash value
        range.value = newVal;
        state.effects[def.key].amount = newVal;
        val.textContent = `${newVal}%`;
      });

      row.appendChild(cb);
      row.appendChild(label);
      row.appendChild(range);
      row.appendChild(val);
      fxGrid.appendChild(row);

      state.effects[def.key].checkboxEl = cb;
      state.effects[def.key].rangeEl = range;
      state.effects[def.key].valEl = val;
      state.effects[def.key].rowEl = row;
    });
  }

  function syncFxUIFromState() {
    FX_DEFS.forEach(def => {
      const e = state.effects[def.key];
      e.checkboxEl.checked = e.enabled;
      e.rangeEl.value = e.amount;
      e.valEl.textContent = `${Math.round(e.amount)}%`;
      e.rowEl.classList.toggle('disabled', !e.enabled);
    });
    masterEl.value = state.master;
    masterValEl.textContent = `${Math.round(state.master)}%`;
  }

  function cancelSmash() {
    if (state.smashTimeoutId !== null) {
      clearTimeout(state.smashTimeoutId);
      state.smashTimeoutId = null;
    }
    if (state.smashing) {
      // a burst was interrupted mid-flight: restore the pre-smash baseline
      // (including master) before the caller applies its own new change.
      Object.entries(state.smashSnapshotEffects).forEach(([k, v]) => {
        state.effects[k].enabled = v.enabled;
        state.effects[k].amount = v.amount;
      });
      state.master = state.smashSnapshotMaster;
      syncFxUIFromState();
      state.smashing = false;
    }
  }

  function applyPreset(name) {
    cancelSmash();
    const preset = PRESETS[name];
    if (!preset) return;
    FX_DEFS.forEach(def => {
      const amt = preset[def.key];
      state.effects[def.key].enabled = amt !== undefined;
      state.effects[def.key].amount = amt !== undefined ? amt : state.effects[def.key].amount;
    });
    syncFxUIFromState();
  }

  buildFxGrid();

  masterEl.addEventListener('input', () => {
    const newVal = Number(masterEl.value);
    cancelSmash(); // may resync master back to the pre-smash value
    masterEl.value = newVal;
    state.master = newVal;
    masterValEl.textContent = `${newVal}%`;
  });

  document.querySelectorAll('.presets button').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  autoEnabledEl.addEventListener('change', () => { state.autoEnabled = autoEnabledEl.checked; });
  autoFreqEl.addEventListener('input', () => { state.autoFreq = Number(autoFreqEl.value); });

  // ---------- smash ----------

  function triggerSmash() {
    if (state.smashing) return;
    state.smashSnapshotEffects = JSON.parse(JSON.stringify(
      Object.fromEntries(Object.entries(state.effects).map(([k, v]) => [k, { enabled: v.enabled, amount: v.amount }]))
    ));
    state.smashSnapshotMaster = state.master;

    state.smashing = true;

    const keys = shuffle(FX_DEFS.map(d => d.key));
    const n = 3 + Math.floor(Math.random() * 4);
    keys.slice(0, n).forEach(k => {
      state.effects[k].enabled = true;
      state.effects[k].amount = 55 + Math.random() * 45;
    });
    state.master = clamp(state.master + 50 + Math.random() * 50, 0, 200);
    syncFxUIFromState();

    const duration = 300 + Math.random() * 700;
    state.smashTimeoutId = setTimeout(() => {
      state.smashTimeoutId = null;
      state.smashing = false; // clear before cancelSmash-style restore below
      Object.entries(state.smashSnapshotEffects).forEach(([k, v]) => {
        state.effects[k].enabled = v.enabled;
        state.effects[k].amount = v.amount;
      });
      state.master = state.smashSnapshotMaster;
      syncFxUIFromState();
    }, duration);
  }

  smashBtn.addEventListener('click', triggerSmash);

  // ---------- file loading ----------

  let objectUrl = null;

  function loadFile(file) {
    if (!file || !file.type.startsWith('video/')) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.load();
  }

  video.addEventListener('loadedmetadata', () => {
    const maxW = 640;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 360;
    const scale = Math.min(1, maxW / vw);
    canvas.width = Math.max(2, Math.round(vw * scale));
    canvas.height = Math.max(2, Math.round(vh * scale));
    setupNoiseCanvas();
    setupScanPattern();

    dropZone.hidden = true;
    stage.hidden = false;
    state.hasFrame = false;

    video.play().catch(() => {});
  });

  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));

  ['dragenter', 'dragover'].forEach(ev => {
    dropZone.addEventListener(ev, e => {
      e.preventDefault();
      dropZone.classList.add('dragOver');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropZone.addEventListener(ev, e => {
      e.preventDefault();
      dropZone.classList.remove('dragOver');
    });
  });
  dropZone.addEventListener('drop', e => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(file);
  });

  newFileBtn.addEventListener('click', () => {
    stopRecording();
    video.pause();
    video.removeAttribute('src');
    video.load();
    stage.hidden = true;
    dropZone.hidden = false;
    downloadLink.hidden = true;
    recStatus.textContent = '';
    fileInput.value = '';
  });

  // ---------- transport ----------

  playBtn.addEventListener('click', () => {
    if (video.paused) video.play(); else video.pause();
  });

  video.addEventListener('play', () => { playBtn.textContent = '❚❚'; });
  video.addEventListener('pause', () => { playBtn.textContent = '▶'; });

  video.addEventListener('timeupdate', () => {
    if (!seekDragging && video.duration) {
      seek.value = Math.round((video.currentTime / video.duration) * 1000);
    }
    timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  });

  let seekDragging = false;
  seek.addEventListener('input', () => {
    seekDragging = true;
    if (video.duration) video.currentTime = (seek.value / 1000) * video.duration;
  });
  seek.addEventListener('change', () => { seekDragging = false; });

  loopBtn.addEventListener('click', () => {
    video.loop = !video.loop;
    loopBtn.classList.toggle('active', video.loop);
  });

  // ---------- svg channel filters (RGB split) ----------

  const hasSvgFilters = true;

  // ---------- noise canvas ----------

  let noiseCanvas, noiseCtx, noiseW = 160, noiseH = 90;

  function setupNoiseCanvas() {
    noiseCanvas = document.createElement('canvas');
    const aspect = canvas.height / canvas.width;
    noiseW = 160;
    noiseH = Math.max(2, Math.round(noiseW * aspect));
    noiseCanvas.width = noiseW;
    noiseCanvas.height = noiseH;
    noiseCtx = noiseCanvas.getContext('2d');
  }

  function refreshNoiseCanvas(strength) {
    const refreshRate = Math.max(1, Math.floor(4 - clamp(strength, 0, 1) * 3));
    if (state.noiseFrameCounter % refreshRate !== 0) return;
    const imgData = noiseCtx.createImageData(noiseW, noiseH);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
      d[i + 3] = Math.random() < 0.7 ? 255 * Math.random() : 255;
    }
    noiseCtx.putImageData(imgData, 0, 0);
  }

  // ---------- scanline pattern ----------

  let scanPattern = null;

  function setupScanPattern() {
    const p = document.createElement('canvas');
    p.width = 1;
    p.height = 4;
    const pc = p.getContext('2d');
    pc.fillStyle = 'rgba(0,0,0,0)';
    pc.fillRect(0, 0, 1, 4);
    pc.fillStyle = 'rgba(0,0,0,0.85)';
    pc.fillRect(0, 0, 1, 1);
    scanPattern = ctx.createPattern(p, 'repeat');
  }

  // ---------- render loop ----------

  function amtOf(key) {
    const e = state.effects[key];
    if (!e.enabled) return 0;
    return (e.amount / 100) * (state.master / 100);
  }

  function drawFrame() {
    const w = canvas.width, h = canvas.height;
    if (w < 2 || h < 2) return;

    state.noiseFrameCounter++;

    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // ---- frame freeze bookkeeping ----
    const freezeAmt = amtOf('freeze');
    if (state.freezeFrames > 0) {
      state.freezeFrames--;
    } else if (freezeAmt > 0.02 && Math.random() < freezeAmt * 0.04) {
      state.freezeFrames = Math.floor(2 + Math.random() * freezeAmt * 25);
    }

    const shouldDrawVideo = state.freezeFrames <= 0 || !state.hasFrame;

    if (shouldDrawVideo) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      const rgbAmt = amtOf('rgb');
      if (rgbAmt > 0.02) {
        const maxShift = 2 + rgbAmt * 40;
        const rdx = rand(-maxShift, maxShift), rdy = rand(-maxShift * 0.2, maxShift * 0.2);
        const gdx = rand(-maxShift, maxShift) * 0.4, gdy = 0;
        const bdx = rand(-maxShift, maxShift), bdy = rand(-maxShift * 0.2, maxShift * 0.2);

        ctx.filter = 'url(#fRed)';
        ctx.drawImage(video, rdx, rdy, w, h);
        ctx.globalCompositeOperation = 'screen';
        ctx.filter = 'url(#fGreen)';
        ctx.drawImage(video, gdx, gdy, w, h);
        ctx.filter = 'url(#fBlue)';
        ctx.drawImage(video, bdx, bdy, w, h);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-over';
      } else {
        let jdx = 0, jdy = 0;
        const vhsAmtPre = amtOf('vhs');
        if (vhsAmtPre > 0.02) {
          jdx = rand(-1, 1) * vhsAmtPre * 6;
          jdy = rand(-1, 1) * vhsAmtPre * 4;
        }
        ctx.drawImage(video, jdx, jdy, w, h);
      }
      state.hasFrame = true;
    }

    // ---- block displacement ----
    const blockAmt = amtOf('block');
    if (blockAmt > 0.02) {
      const bands = Math.floor(1 + blockAmt * 8);
      for (let i = 0; i < bands; i++) {
        if (Math.random() > 0.55) continue;
        const bh = Math.max(2, Math.floor(rand(2, h * 0.15)));
        const y = Math.floor(Math.random() * Math.max(1, h - bh));
        const shift = Math.floor(rand(-w * 0.4, w * 0.4) * blockAmt);
        ctx.drawImage(canvas, 0, y, w, bh, shift, y, w, bh);
      }
    }

    // ---- corruption blocks ----
    const corruptAmt = amtOf('corrupt');
    if (corruptAmt > 0.02) {
      const n = Math.floor(1 + corruptAmt * 10);
      for (let i = 0; i < n; i++) {
        const bw = Math.max(2, Math.floor(rand(4, w * 0.25)));
        const bh = Math.max(2, Math.floor(rand(2, h * 0.08)));
        const sx = Math.floor(Math.random() * Math.max(1, w - bw));
        const sy = Math.floor(Math.random() * Math.max(1, h - bh));
        const dx = Math.floor(Math.random() * Math.max(1, w - bw));
        const dy = Math.floor(Math.random() * Math.max(1, h - bh));
        ctx.drawImage(canvas, sx, sy, bw, bh, dx, dy, bw, bh);
        if (Math.random() < 0.3) {
          ctx.globalAlpha = 0.35 * corruptAmt;
          ctx.fillStyle = randColor();
          ctx.fillRect(dx, dy, bw, bh);
          ctx.globalAlpha = 1;
        }
      }
    }

    // ---- noise / static ----
    const noiseAmt = amtOf('noise');
    if (noiseAmt > 0.02) {
      refreshNoiseCanvas(noiseAmt);
      ctx.globalAlpha = Math.min(0.9, 0.15 + noiseAmt * 0.6);
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(noiseCanvas, 0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- scanlines ----
    const scanAmt = amtOf('scan');
    if (scanAmt > 0.02 && scanPattern) {
      ctx.globalAlpha = Math.min(0.85, scanAmt);
      ctx.fillStyle = scanPattern;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // ---- vhs tracking / chroma bleed ----
    const vhsAmt = amtOf('vhs');
    if (vhsAmt > 0.02) {
      if (Math.random() < 0.04 + vhsAmt * 0.12) {
        const bh = Math.max(2, Math.floor(rand(3, h * 0.1) * vhsAmt + 2));
        const y = Math.floor(Math.random() * Math.max(1, h - bh));
        refreshNoiseCanvas(1);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(noiseCanvas, 0, y, w, bh, 0, y, w, bh);
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 0.25 * vhsAmt;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(canvas, rand(-4, 4) * vhsAmt, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- color error (final pass) ----
    const colorAmt = amtOf('color');
    if (colorAmt > 0.02) {
      const hue = Math.random() < 0.5 ? rand(0, 360) * colorAmt : 0;
      const invert = Math.random() < colorAmt * 0.3 ? 1 : 0;
      const sat = 1 + colorAmt * rand(0.5, 3);
      const contrast = 1 + colorAmt * rand(0, 1.5);
      ctx.filter = `hue-rotate(${hue}deg) saturate(${sat}) contrast(${contrast}) invert(${invert})`;
      ctx.drawImage(canvas, 0, 0, w, h);
      ctx.filter = 'none';
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    if (video.readyState >= 2) {
      drawFrame();
    }
    // auto-random glitch trigger
    if (state.autoEnabled && !state.smashing) {
      const p = (state.autoFreq / 100) * 0.02;
      if (Math.random() < p) triggerSmash();
    }
  }
  requestAnimationFrame(tick);

  // ---------- recording ----------

  let audioCtx, sourceNode, streamDest, recorder, chunks = [];

  function ensureAudioGraph() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaElementSource(video);
    streamDest = audioCtx.createMediaStreamDestination();
    sourceNode.connect(audioCtx.destination);
    sourceNode.connect(streamDest);
  }

  function pickMimeType() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    return candidates.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || 'video/webm';
  }

  function startRecording() {
    ensureAudioGraph();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (video.paused) video.play().catch(() => {});

    const canvasStream = canvas.captureStream(30);
    const mixedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...streamDest.stream.getAudioTracks(),
    ]);

    chunks = [];
    recorder = new MediaRecorder(mixedStream, { mimeType: pickMimeType() });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.hidden = false;
      recStatus.textContent = '完了！ ダウンロードできます';
    };
    recorder.start();

    recordBtn.textContent = '■ 録画停止';
    recordBtn.classList.add('recording');
    recStatus.textContent = '録画中...';
    downloadLink.hidden = true;
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recordBtn.textContent = '● 録画開始';
    recordBtn.classList.remove('recording');
  }

  recordBtn.addEventListener('click', () => {
    if (!recorder || recorder.state === 'inactive') startRecording();
    else stopRecording();
  });

})();
