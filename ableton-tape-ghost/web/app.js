(() => {
  const $ = (id) => document.getElementById(id);

  const setupPanel = $('setupPanel');
  const stage = $('stage');
  const startBtn = $('startBtn');
  const stopBtn = $('stopBtn');
  const errBox = $('errBox');
  const liveDot = $('liveDot');
  const bufMinutesSel = $('bufMinutes');
  const inputDeviceSel = $('inputDevice');
  const outputDeviceSel = $('outputDevice');
  const refreshDevicesBtn = $('refreshDevicesBtn');
  const meterFill = $('meterFill');
  const meterWarn = $('meterWarn');

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

  // Device labels are blank until a getUserMedia permission has been granted
  // at least once (browser privacy rule) -- this is the single most common
  // reason "I don't see my interface in the list" happens, so the refresh
  // button explicitly requests a throwaway permission first when needed.
  async function populateDevices(requestPermissionFirst) {
    if (requestPermissionFirst) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch (e) {
        showError('デバイス一覧を見るためのマイク許可が得られませんでした: ' + e.message);
        return;
      }
    }
    let devices;
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (e) {
      return;
    }
    const ins = devices.filter((d) => d.kind === 'audioinput');
    const outs = devices.filter((d) => d.kind === 'audiooutput');
    const fill = (sel, list, defaultLabel) => {
      const prev = sel.value;
      sel.innerHTML = '';
      const def = document.createElement('option');
      def.value = ''; def.textContent = defaultLabel;
      sel.appendChild(def);
      list.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `デバイス ${i + 1}（名前を見るには一度マイクを許可してください）`;
        sel.appendChild(opt);
      });
      if (list.some((d) => d.deviceId === prev)) sel.value = prev;
    };
    fill(inputDeviceSel, ins, 'デフォルト入力');
    fill(outputDeviceSel, outs, 'デフォルト出力');
  }

  refreshDevicesBtn.addEventListener('click', () => populateDevices(true));
  populateDevices(false);
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => populateDevices(false));
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
    const chosenInputId = inputDeviceSel.value;
    const audioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    // omit deviceId entirely for "デフォルト入力" so we don't fight the
    // browser's own default-device selection with an unnecessary constraint
    if (chosenInputId) audioConstraints.deviceId = { exact: chosenInputId };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (e) {
      showError('マイク/ライン入力へのアクセスが許可されませんでした（' + e.message + '）。選んだ入力デバイスが正しいか、他のアプリがそのデバイスを排他利用していないか確認してください。');
      return;
    }
    // now that permission is granted, device labels are unlocked -- refresh
    // so the dropdowns show real names instead of "デバイス N" placeholders
    populateDevices(false);

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const chosenOutputId = outputDeviceSel.value;
    if (chosenOutputId && typeof audioCtx.setSinkId === 'function') {
      try {
        await audioCtx.setSinkId(chosenOutputId);
      } catch (e) {
        showError('出力デバイスの切り替えに失敗しました（' + e.message + '）。デフォルト出力のまま続行します。');
      }
    } else if (chosenOutputId) {
      showError('お使いのブラウザは出力デバイスの切り替え（setSinkId）に対応していません。システム側の既定の出力デバイスをFirefaceに設定してください。');
    }
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
          lastStatus = { writeSec: e.data.writeSec, agoSec: e.data.readAgoSec, loopActive: e.data.loopActive, inputPeak: e.data.inputPeak };
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
            inputPeak: engine.inputPeak,
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

    startedAt = performance.now();
    sendAllParams();
    drawLoop();
  }

  function stop() {
    if (miracleTimer) { clearTimeout(miracleTimer); miracleTimer = null; }
    if (miracle2Timer) { clearTimeout(miracle2Timer); miracle2Timer = null; }
    if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (node) node.disconnect();
    if (sp) sp.disconnect();
    if (audioCtx) audioCtx.close();
    audioCtx = null; node = null; sp = null; engine = null; stream = null;
    setupPanel.style.display = 'block';
    stage.classList.remove('show');
    liveDot.classList.remove('live');
    meterFill.style.width = '0%';
    meterWarn.classList.add('hidden');
    miracleOn = false; miracle2On = false;
    $('miracleBtn').classList.remove('active');
    $('miracleBtn').textContent = 'Miracle 1 OFF';
    $('miracle2Btn').classList.remove('active');
    $('miracle2Btn').textContent = 'Miracle 2 OFF';
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
    send({ type: 'setDelayMix', value: parseFloat($('delayMix').value) / 100 });
    send({ type: 'setDelayTime', value: parseFloat($('delayTime').value) });
    send({ type: 'setDelayFeedback', value: parseFloat($('delayFb').value) / 100 });
  }

  $('mix').addEventListener('input', (e) => {
    $('valMix').textContent = e.target.value + '%';
    send({ type: 'setMix', value: parseFloat(e.target.value) / 100 });
  });
  $('pitch').addEventListener('input', (e) => {
    $('valPitch').textContent = parseFloat(e.target.value).toFixed(2);
    send({ type: 'setPitch', value: parseFloat(e.target.value) });
  });
  $('delayMix').addEventListener('input', (e) => {
    $('valDelayMix').textContent = e.target.value + '%';
    send({ type: 'setDelayMix', value: parseFloat(e.target.value) / 100 });
  });
  $('delayTime').addEventListener('input', (e) => {
    $('valDelayTime').textContent = parseFloat(e.target.value).toFixed(2);
    send({ type: 'setDelayTime', value: parseFloat(e.target.value) });
  });
  $('delayFb').addEventListener('input', (e) => {
    $('valDelayFb').textContent = e.target.value + '%';
    send({ type: 'setDelayFeedback', value: parseFloat(e.target.value) / 100 });
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
    if (!miracleOn && miracle2On) turnOffMiracle2();
    miracleOn = !miracleOn;
    $('miracleBtn').classList.toggle('active', miracleOn);
    $('miracleBtn').textContent = miracleOn ? 'Miracle 1 ON' : 'Miracle 1 OFF';
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
    const speedMul = 0.5 + Math.random() * 1.5; // varies playback rate -> pitch also shifts (tape-style)
    send({ type: 'miracleSegment', startAgoSeconds: startAgo, lenSeconds: lenSec, speedMul });
    const interval = 80 + Math.random() * 500;
    miracleTimer = setTimeout(() => { if (miracleOn) scheduleMiracleTick(); }, interval);
  }

  // ---- Miracle 2: pitch-locked cut-up (speedMul always 1.0), with a few
  // switchable position-picking behaviors instead of pure randomness ----
  let miracle2On = false;
  let miracle2Timer = null;
  let miracle2Mode = 'scatter';
  let miracle2LastStartAgo = 0;
  let miracle2WalkPos = 0;
  let miracle2WalkDir = 1;

  document.querySelectorAll('.m2mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.m2mode').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      miracle2Mode = btn.dataset.mode;
    });
  });

  function turnOffMiracle2() {
    miracle2On = false;
    if (miracle2Timer) { clearTimeout(miracle2Timer); miracle2Timer = null; }
    $('miracle2Btn').classList.remove('active');
    $('miracle2Btn').textContent = 'Miracle 2 OFF';
    send({ type: 'miracleOff' });
  }

  $('miracle2Btn').addEventListener('click', () => {
    if (!miracle2On && miracleOn) {
      miracleOn = false;
      if (miracleTimer) { clearTimeout(miracleTimer); miracleTimer = null; }
      $('miracleBtn').classList.remove('active');
      $('miracleBtn').textContent = 'Miracle 1 OFF';
      send({ type: 'miracleOff' });
    }
    miracle2On = !miracle2On;
    $('miracle2Btn').classList.toggle('active', miracle2On);
    $('miracle2Btn').textContent = miracle2On ? 'Miracle 2 ON' : 'Miracle 2 OFF';
    if (miracle2On) {
      miracle2WalkPos = 0; miracle2WalkDir = 1;
      miracle2LastStartAgo = Math.random() * parseFloat($('m2Window').value);
      scheduleMiracle2Tick();
    } else {
      if (miracle2Timer) { clearTimeout(miracle2Timer); miracle2Timer = null; }
      send({ type: 'miracleOff' });
      $('loopBtn').dataset.state = '0';
      $('loopBtn').textContent = 'Loop Mark: 待機中';
    }
  });

  function pickMiracle2StartAgo(windowSec, lenSec) {
    switch (miracle2Mode) {
      case 'stutter': {
        const jitter = 0.15 + lenSec * 1.5;
        let v = miracle2LastStartAgo + (Math.random() * 2 - 1) * jitter;
        v = Math.max(0, Math.min(windowSec, v));
        miracle2LastStartAgo = v;
        return v;
      }
      case 'walk': {
        miracle2WalkPos = (miracle2WalkPos + lenSec) % Math.max(0.5, windowSec);
        return miracle2WalkPos;
      }
      case 'pingpong': {
        miracle2WalkPos += lenSec * miracle2WalkDir;
        if (miracle2WalkPos >= windowSec) { miracle2WalkPos = windowSec; miracle2WalkDir = -1; }
        if (miracle2WalkPos <= 0) { miracle2WalkPos = 0; miracle2WalkDir = 1; }
        return miracle2WalkPos;
      }
      case 'scatter':
      default:
        return Math.random() * windowSec;
    }
  }

  function scheduleMiracle2Tick() {
    const windowSec = Math.max(0.5, Math.min(parseFloat($('m2Window').value), lastStatus.writeSec));
    const density = parseFloat($('m2Density').value);
    const lenSec = 0.5 + (1 - density) * 2.5 * Math.random();
    const startAgo = pickMiracle2StartAgo(windowSec, lenSec);
    // speedMul is always 1.0 here -- the whole point of Miracle 2 is that the
    // pitch never changes no matter how the cut-up jumps around
    send({ type: 'miracleSegment', startAgoSeconds: startAgo, lenSeconds: lenSec, speedMul: 1.0 });
    const interval = 80 + Math.random() * 500;
    miracle2Timer = setTimeout(() => { if (miracle2On) scheduleMiracle2Tick(); }, interval);
  }

  $('m2Window').addEventListener('input', (e) => { $('valM2Win').textContent = e.target.value; });
  $('m2Density').addEventListener('input', (e) => { $('valM2Dens').textContent = parseFloat(e.target.value).toFixed(2); });

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
  let startedAt = 0;
  function updateStatusUI() {
    $('writeSec').textContent = lastStatus.writeSec.toFixed(1);
    $('agoSec').textContent = lastStatus.agoSec.toFixed(2);
    $('chipRewind').classList.toggle('on', rewindOn);
    $('chipLoop').classList.toggle('on', !!lastStatus.loopActive);
    $('chipMiracle').classList.toggle('on', miracleOn);
    $('chipMiracle2').classList.toggle('on', miracle2On);

    const peak = lastStatus.inputPeak || 0;
    // linear peak -> 0-100% with a dB-ish curve so quiet signals are still
    // visible (a flat linear mapping makes anything under ~-20dB look like 0)
    const db = peak > 0 ? 20 * Math.log10(peak) : -100;
    const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
    meterFill.style.width = pct.toFixed(1) + '%';

    const elapsedSinceStart = (performance.now() - startedAt) / 1000;
    const silentTooLong = elapsedSinceStart > 2.0 && peak < 0.001;
    meterWarn.classList.toggle('hidden', !silentTooLong);
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
