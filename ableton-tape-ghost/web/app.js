(() => {
  const $ = (id) => document.getElementById(id);

  const setupPanel = $('setupPanel');
  const stage = $('stage');
  const startBtn = $('startBtn');
  const stopBtn = $('stopBtn');
  const errBox = $('errBox');
  const liveDot = $('liveDot');
  const bufMinutesSel = $('bufMinutes');

  let audioCtx = null;
  let node = null;       // AudioWorkletNode, when the worklet path works
  let sp = null;         // ScriptProcessorNode, fallback path (e.g. file:// pages)
  let engine = null;     // TapeGhostEngine instance, only used in the fallback path
  let stream = null;
  let mode = 'full'; // 'full' | 'miracle'
  let miracleTimer = null;
  let statusPollTimer = null;
  let lastStatus = { writeSec: 0, agoSec: 0, loopActive: false };

  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
  }

  // Loads the same DSP source used by the worklet into the main thread, for
  // the ScriptProcessorNode fallback. It's the exact tested code -- the
  // AudioWorkletProcessor registration inside it is a no-op here since
  // `AudioWorkletProcessor` doesn't exist in this scope.
  function loadEngineClasses(source) {
    return new Function(source + '\n;return { TapeGhostEngine, RingChannel, GranularPitchShifter, semitonesToRatio };')();
  }

  async function start() {
    errBox.style.display = 'none';
    const bufferSeconds = parseFloat(bufMinutesSel.value) * 60;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
    } catch (e) {
      showError('マイク/ライン入力へのアクセスが許可されませんでした（' + e.message + '）。ブラウザの権限設定を確認してください。');
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);

    let workletOK = false;
    try {
      const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(url);
      node = new AudioWorkletNode(audioCtx, 'tape-ghost-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { sampleRate: audioCtx.sampleRate, bufferSeconds }
      });
      node.port.onmessage = (e) => {
        if (e.data.type === 'status') {
          lastStatus = { writeSec: e.data.writeSec, agoSec: e.data.readAgoSec, loopActive: e.data.loopActive };
          updateStatusUI();
        }
      };
      src.connect(node);
      node.connect(audioCtx.destination);
      workletOK = true;
    } catch (e) {
      // AudioWorklet module loading can fail on some setups (notably a
      // double-clicked local file opened as file://). Fall back to a plain
      // ScriptProcessorNode running the identical engine on the main thread.
      console.warn('AudioWorklet unavailable, falling back to ScriptProcessorNode:', e.message);
    }

    if (!workletOK) {
      try {
        const { TapeGhostEngine } = loadEngineClasses(WORKLET_SOURCE);
        engine = new TapeGhostEngine(audioCtx.sampleRate, bufferSeconds);
        sp = audioCtx.createScriptProcessor(2048, 2, 2);
        sp.onaudioprocess = (e) => {
          const inL = e.inputBuffer.getChannelData(0);
          const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
          const outL = e.outputBuffer.getChannelData(0);
          const outR = e.outputBuffer.getChannelData(1);
          for (let i = 0; i < inL.length; i++) {
            const [l, r] = engine.processSample(inL[i], inR[i]);
            outL[i] = l; outR[i] = r;
          }
        };
        src.connect(sp);
        sp.connect(audioCtx.destination);
        statusPollTimer = setInterval(() => {
          if (!engine) return;
          lastStatus = {
            writeSec: engine.writeCounter / engine.sr,
            agoSec: (engine.writeCounter - engine.readPos) / engine.sr,
            loopActive: engine.loopActive,
          };
          updateStatusUI();
        }, 50);
      } catch (e) {
        showError('オーディオ処理の初期化に失敗しました: ' + e.message);
        return;
      }
    }

    setupPanel.style.display = 'none';
    stage.classList.add('show');
    liveDot.classList.add('live');

    sendAllParams();
    drawLoop();
  }

  function stop() {
    if (miracleTimer) { clearTimeout(miracleTimer); miracleTimer = null; }
    if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (node) node.disconnect();
    if (sp) sp.disconnect();
    if (audioCtx) audioCtx.close();
    audioCtx = null; node = null; sp = null; engine = null; stream = null;
    setupPanel.style.display = 'block';
    stage.classList.remove('show');
    liveDot.classList.remove('live');
    $('miracleBtn').classList.remove('active');
    $('miracleBtn').textContent = 'Miracle OFF';
    $('rewindBtn').classList.remove('active');
    $('loopBtn').dataset.state = '0';
    $('loopBtn').textContent = 'Loop Mark: 待機中';
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);

  // ---- parameter wiring ----
  function send(msg) {
    if (node) node.port.postMessage(msg);
    else if (engine) engine.handleMessage(msg);
  }

  function sendAllParams() {
    send({ type: 'setMix', value: parseFloat($('mix').value) / 100 });
    send({ type: 'setPitch', value: parseFloat($('pitch').value) });
    send({ type: 'setRewindSpeed', value: parseFloat($('rwSpeed').value) });
  }

  $('mix').addEventListener('input', (e) => {
    $('valMix').textContent = e.target.value + '%';
    send({ type: 'setMix', value: parseFloat(e.target.value) / 100 });
  });
  $('pitch').addEventListener('input', (e) => {
    $('valPitch').textContent = parseFloat(e.target.value).toFixed(2);
    send({ type: 'setPitch', value: parseFloat(e.target.value) });
  });
  $('jump').addEventListener('input', (e) => {
    $('valJump').textContent = parseFloat(e.target.value).toFixed(1);
  });
  $('jumpBtn').addEventListener('click', () => {
    send({ type: 'jump', seconds: parseFloat($('jump').value) });
  });
  $('rwSpeed').addEventListener('input', (e) => {
    $('valRwSpeed').textContent = parseFloat(e.target.value).toFixed(1);
    send({ type: 'setRewindSpeed', value: parseFloat(e.target.value) });
  });

  let rewindOn = false;
  $('rewindBtn').addEventListener('click', () => {
    rewindOn = !rewindOn;
    $('rewindBtn').classList.toggle('active', rewindOn);
    $('rewindBtn').textContent = rewindOn ? 'Rewind: ON（もう一度押して停止）' : 'Rewind (押し続け)';
    send({ type: 'rewind', on: rewindOn });
  });

  $('loopBtn').addEventListener('click', () => {
    const cur = parseInt($('loopBtn').dataset.state, 10);
    const next = (cur + 1) % 3;
    $('loopBtn').dataset.state = String(next);
    $('loopBtn').textContent = next === 0 ? 'Loop Mark: 待機中' : next === 1 ? 'Loop Mark: 開始点セット済み（もう一度押して終了点）' : 'Loop Mark: ループ中（もう一度押して解除）';
    send({ type: 'loopMarkClick' });
  });

  $('loopShiftSec').addEventListener('input', (e) => {
    $('valLoopShift').textContent = parseFloat(e.target.value).toFixed(1);
  });
  $('loopShiftBtn').addEventListener('click', () => {
    send({ type: 'loopShift', seconds: parseFloat($('loopShiftSec').value) });
  });

  $('freezeBtn').addEventListener('click', () => {
    send({ type: 'freeze', lenSeconds: 0.18 });
    $('loopBtn').dataset.state = '2';
    $('loopBtn').textContent = 'Loop Mark: ループ中（もう一度押して解除）';
  });

  $('mWindow').addEventListener('input', (e) => { $('valMWin').textContent = e.target.value; });
  $('mDensity').addEventListener('input', (e) => { $('valMDens').textContent = parseFloat(e.target.value).toFixed(2); });

  let miracleOn = false;
  $('miracleBtn').addEventListener('click', () => {
    miracleOn = !miracleOn;
    $('miracleBtn').classList.toggle('active', miracleOn);
    $('miracleBtn').textContent = miracleOn ? 'Miracle ON' : 'Miracle OFF';
    if (miracleOn) {
      scheduleMiracleTick();
    } else {
      if (miracleTimer) { clearTimeout(miracleTimer); miracleTimer = null; }
      send({ type: 'miracleOff' });
      $('loopBtn').dataset.state = '0';
      $('loopBtn').textContent = 'Loop Mark: 待機中';
    }
  });

  function scheduleMiracleTick() {
    const windowSec = parseFloat($('mWindow').value);
    const density = parseFloat($('mDensity').value);
    const startAgo = Math.random() * Math.max(0.5, Math.min(windowSec, lastStatus.writeSec));
    const lenSec = 0.5 + (1 - density) * 2.5 * Math.random();
    const speedMul = 0.5 + Math.random() * 1.5;
    send({ type: 'miracleSegment', startAgoSeconds: startAgo, lenSeconds: lenSec, speedMul });
    const interval = 80 + Math.random() * 500;
    miracleTimer = setTimeout(() => { if (miracleOn) scheduleMiracleTick(); }, interval);
  }

  // ---- mode tabs (Full Control / Miracle Focus) ----
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      mode = tab.dataset.mode;
      const isFull = mode === 'full';
      $('fullOnly1').style.display = isFull ? '' : 'none';
      $('fullOnly2').style.display = isFull ? '' : 'none';
      $('miracleOnly1').style.display = isFull ? 'none' : '';
    });
  });

  // ---- status readout + circular scope visualization ----
  function updateStatusUI() {
    $('writeSec').textContent = lastStatus.writeSec.toFixed(1);
    $('agoSec').textContent = lastStatus.agoSec.toFixed(2);
    $('chipRewind').classList.toggle('on', rewindOn);
    $('chipLoop').classList.toggle('on', !!lastStatus.loopActive);
    $('chipMiracle').classList.toggle('on', miracleOn);
  }

  const scope = $('scope');
  const ctx2d = scope.getContext('2d');
  function drawLoop() {
    if (!audioCtx) return;
    const w = scope.width, h = scope.height;
    const cx = w / 2, cy = h / 2, r = w / 2 - 10;
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.strokeStyle = 'rgba(154,163,178,0.35)';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
    ctx2d.stroke();

    const bufferSeconds = parseFloat(bufMinutesSel.value) * 60;
    const writeFrac = (lastStatus.writeSec % bufferSeconds) / bufferSeconds;
    const readFrac = ((lastStatus.writeSec - lastStatus.agoSec) % bufferSeconds + bufferSeconds) % bufferSeconds / bufferSeconds;

    drawDot(cx, cy, r, writeFrac, '#ff5d5d', 4);
    drawDot(cx, cy, r, readFrac, '#5ddcff', 6);

    requestAnimationFrame(drawLoop);
  }
  function drawDot(cx, cy, r, frac, color, size) {
    const angle = frac * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    ctx2d.fillStyle = color;
    ctx2d.beginPath();
    ctx2d.arc(x, y, size, 0, Math.PI * 2);
    ctx2d.fill();
  }
})();
