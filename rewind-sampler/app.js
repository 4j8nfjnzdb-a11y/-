// rewind sampler — 巻き戻りサンプラー
//
// Always-on rolling recorder (AudioWorklet circular buffer) with an
// independent, variable-rate read head. Raising the mix fader crossfades
// from the live input to whatever the read head is doing: trailing a few
// seconds behind by default, rewinding, jumping, looping (with the loop
// window shiftable through history), or picking random cut-up fragments
// ("Miracle" mode). Pitch is just the read head's playback rate, so it is
// continuous (microtonal), tape-style, and coupled to speed by design.

(() => {
  const startBtn = document.getElementById("startBtn");
  const setupPanel = document.getElementById("setupPanel");
  const runPanel = document.getElementById("runPanel");
  const setupHint = document.getElementById("setupHint");
  const bufferMinutesSel = document.getElementById("bufferMinutes");

  const mixSlider = document.getElementById("mix");
  const mixVal = document.getElementById("mixVal");
  const pitchSlider = document.getElementById("pitch");
  const pitchVal = document.getElementById("pitchVal");

  const rewindBtn = document.getElementById("rewindBtn");
  const loopBtn = document.getElementById("loopBtn");
  const miracleBtn = document.getElementById("miracleBtn");
  const liveBtn = document.getElementById("liveBtn");

  const jumpSecondsInput = document.getElementById("jumpSeconds");
  const jumpBtn = document.getElementById("jumpBtn");
  const loopShiftSecondsInput = document.getElementById("loopShiftSeconds");
  const loopShiftBack = document.getElementById("loopShiftBack");
  const loopShiftFwd = document.getElementById("loopShiftFwd");

  const modeLabel = document.getElementById("modeLabel");
  const posLabel = document.getElementById("posLabel");

  // ---- the AudioWorkletProcessor, built at runtime as a Blob URL so the
  // whole device stays a single self-contained app.js -------------------
  const PROCESSOR_SRC = `
    class TapeProcessor extends AudioWorkletProcessor {
      constructor(options) {
        super();
        const { bufferSeconds, channels } = options.processorOptions;
        this.channels = channels || 2;
        this.bufferLength = Math.max(1, Math.round(bufferSeconds * sampleRate));
        this.buf = [];
        for (let c = 0; c < this.channels; c++) this.buf.push(new Float32Array(this.bufferLength));
        this.writePtr = 0;
        this.readPtr = 0;
        this.rate = 0; // signed playback speed; 0 = silent until first command
        this.loopActive = false;
        this.loopStart = 0;
        this.loopEnd = 0;
        this.totalWritten = 0;
        this.reportCounter = 0;

        const norm = (x) => {
          x = x % this.bufferLength;
          if (x < 0) x += this.bufferLength;
          return x;
        };
        this.norm = norm;

        this.port.onmessage = (e) => {
          const m = e.data;
          if (m.type === "setRate") {
            this.rate = m.rate;
          } else if (m.type === "setReadPos") {
            this.readPtr = norm(m.pos);
          } else if (m.type === "setLoop") {
            this.loopActive = true;
            this.loopStart = norm(m.start);
            this.loopEnd = norm(m.end);
            if (!this.inRangeForward(this.readPtr, this.loopStart, this.loopEnd)) {
              this.readPtr = this.loopStart;
            }
          } else if (m.type === "clearLoop") {
            this.loopActive = false;
          }
        };
      }

      inRangeForward(p, start, end) {
        if (start <= end) return p >= start && p < end;
        return p >= start || p < end;
      }

      process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        const chCount = this.channels;
        const blockSize = (output[0] && output[0].length) || 128;
        const norm = this.norm;

        for (let i = 0; i < blockSize; i++) {
          for (let c = 0; c < chCount; c++) {
            const inCh = input && input.length > 0 ? (input[c] || input[0]) : null;
            const sample = inCh && inCh.length ? inCh[i] : 0;
            this.buf[c][this.writePtr] = sample;
          }
          this.writePtr++;
          if (this.writePtr >= this.bufferLength) this.writePtr = 0;
          if (this.totalWritten < this.bufferLength) this.totalWritten++;

          let rp = this.readPtr;
          let i0 = Math.floor(rp);
          const frac = rp - i0;
          i0 = norm(i0);
          let i1 = i0 + 1;
          if (i1 >= this.bufferLength) i1 = 0;

          for (let c = 0; c < chCount; c++) {
            const outCh = output[c] || output[0];
            if (!outCh) continue;
            const s0 = this.buf[c][i0];
            const s1 = this.buf[c][i1];
            outCh[i] = s0 + (s1 - s0) * frac;
          }

          rp += this.rate;
          rp = norm(rp);
          if (this.loopActive) {
            if (this.rate >= 0) {
              if (!this.inRangeForward(rp, this.loopStart, this.loopEnd)) rp = this.loopStart;
            } else {
              if (!this.inRangeForward(rp, this.loopStart, this.loopEnd)) rp = this.loopEnd;
            }
          }
          this.readPtr = rp;
        }

        this.reportCounter++;
        if (this.reportCounter >= 8) {
          this.reportCounter = 0;
          this.port.postMessage({
            type: "pos",
            writePtr: this.writePtr,
            readPtr: this.readPtr,
            totalWritten: this.totalWritten,
            bufferLength: this.bufferLength,
          });
        }
        return true;
      }
    }
    registerProcessor("tape-processor", TapeProcessor);
  `;

  let audioCtx = null;
  let tapeNode = null;
  let dryGain, wetGain, masterGain;
  let sampleRate = 44100;
  let bufferSeconds = 300;
  let lastPos = { writePtr: 0, readPtr: 0, totalWritten: 0, bufferLength: 0 };

  let mode = "trail"; // trail | rewind | loop-armed | loop-active | miracle
  let loopArmPos = 0;
  let miracleTimer = null;
  const norm = (x) => {
    x = x % lastPos.bufferLength;
    if (x < 0) x += lastPos.bufferLength;
    return x;
  };

  function pitchToRateMagnitude(cents) {
    return Math.pow(2, cents / 1200);
  }

  function currentPitchCents() {
    return +pitchSlider.value;
  }

  function setModeLabel(text) {
    modeLabel.textContent = "モード: " + text;
  }

  function sendRate(signedRate) {
    tapeNode.port.postMessage({ type: "setRate", rate: signedRate });
  }

  function sendReadPos(absSamples) {
    tapeNode.port.postMessage({ type: "setReadPos", pos: absSamples });
  }

  function stopMiracle() {
    if (miracleTimer) {
      clearTimeout(miracleTimer);
      miracleTimer = null;
    }
  }

  function enterTrail() {
    stopMiracle();
    tapeNode.port.postMessage({ type: "clearLoop" });
    mode = "trail";
    rewindBtn.classList.remove("active");
    loopBtn.classList.remove("active");
    miracleBtn.classList.remove("active");
    const trailSeconds = Math.min(3, lastPos.totalWritten / sampleRate);
    sendReadPos(lastPos.writePtr - Math.round(trailSeconds * sampleRate));
    sendRate(pitchToRateMagnitude(currentPitchCents()));
    setModeLabel("通常再生(約3秒トレイル)");
  }

  function enterRewind() {
    stopMiracle();
    tapeNode.port.postMessage({ type: "clearLoop" });
    mode = "rewind";
    rewindBtn.classList.add("active");
    loopBtn.classList.remove("active");
    miracleBtn.classList.remove("active");
    sendRate(-pitchToRateMagnitude(currentPitchCents()));
    setModeLabel("巻き戻し中(逆再生)");
  }

  let currentLoopStart = 0;
  let currentLoopEnd = 0;
  let loopDirection = 1;

  function handleLoopButton() {
    if (mode !== "loop-armed" && mode !== "loop-active") {
      stopMiracle();
      mode = "loop-armed";
      loopArmPos = lastPos.readPtr;
      loopBtn.classList.add("active");
      rewindBtn.classList.remove("active");
      miracleBtn.classList.remove("active");
      setModeLabel("ループ始点セット済み — もう一度押して終点を確定");
    } else if (mode === "loop-armed") {
      currentLoopStart = loopArmPos;
      currentLoopEnd = lastPos.readPtr;
      if (currentLoopStart === currentLoopEnd) {
        currentLoopEnd = (currentLoopEnd + Math.round(0.25 * sampleRate)) % lastPos.bufferLength;
      }
      loopDirection = 1;
      sendRate(loopDirection * pitchToRateMagnitude(currentPitchCents()));
      tapeNode.port.postMessage({ type: "setLoop", start: currentLoopStart, end: currentLoopEnd });
      mode = "loop-active";
      setModeLabel("ループ再生中");
    } else {
      tapeNode.port.postMessage({ type: "clearLoop" });
      loopBtn.classList.remove("active");
      enterTrail();
    }
  }

  function shiftLoop(deltaSeconds) {
    if (mode !== "loop-active") return;
    const deltaSamples = Math.round(deltaSeconds * sampleRate);
    currentLoopStart = norm(currentLoopStart - deltaSamples);
    currentLoopEnd = norm(currentLoopEnd - deltaSamples);
    tapeNode.port.postMessage({ type: "setLoop", start: currentLoopStart, end: currentLoopEnd });
    setModeLabel("ループ再生中(移動済み)");
  }

  function doJump() {
    const secs = Math.max(0, +jumpSecondsInput.value || 0);
    const clamped = Math.min(secs, lastPos.totalWritten / sampleRate);
    sendReadPos(lastPos.writePtr - Math.round(clamped * sampleRate));
    posLabel.textContent = "位置: -" + clamped.toFixed(1) + "秒 (ジャンプ)";
  }

  function miracleTick() {
    if (mode !== "miracle") return;
    const durSec = 0.5 + Math.random() * 2.5;
    const histSec = Math.max(0.1, Math.min(lastPos.totalWritten / sampleRate, bufferSeconds));
    const ageSec = Math.random() * histSec;
    const startAbs = norm(lastPos.writePtr - Math.round(ageSec * sampleRate));
    const dir = Math.random() < 0.5 ? 1 : -1;
    const speedVariation = 0.6 + Math.random() * 1.8; // 0.6x–2.4x, "buggy" pitch/speed drift
    sendReadPos(startAbs);
    sendRate(dir * speedVariation);
    setModeLabel("Miracle: " + (dir > 0 ? "順" : "逆") + " " + speedVariation.toFixed(2) + "x / " + durSec.toFixed(1) + "s片");
    miracleTimer = setTimeout(miracleTick, durSec * 1000);
  }

  function enterMiracle() {
    tapeNode.port.postMessage({ type: "clearLoop" });
    mode = "miracle";
    miracleBtn.classList.add("active");
    rewindBtn.classList.remove("active");
    loopBtn.classList.remove("active");
    miracleTick();
  }

  function equalPowerGains(mix01) {
    const t = Math.min(1, Math.max(0, mix01));
    return {
      dry: Math.cos((t * Math.PI) / 2),
      wet: Math.sin((t * Math.PI) / 2),
    };
  }

  async function start() {
    startBtn.disabled = true;
    setupHint.textContent = "入力を初期化中…";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 2,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = audioCtx.sampleRate;
      bufferSeconds = (+bufferMinutesSel.value) * 60;

      const blob = new Blob([PROCESSOR_SRC], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(url);

      const source = audioCtx.createMediaStreamSource(stream);

      tapeNode = new AudioWorkletNode(audioCtx, "tape-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: "explicit",
        processorOptions: { bufferSeconds, channels: 2 },
      });
      tapeNode.port.onmessage = (e) => {
        if (e.data.type === "pos") {
          lastPos = e.data;
          const ageSec = norm(lastPos.writePtr - lastPos.readPtr) / sampleRate;
          posLabel.textContent = "位置: -" + ageSec.toFixed(2) + "秒";
        }
      };

      dryGain = audioCtx.createGain();
      wetGain = audioCtx.createGain();
      masterGain = audioCtx.createGain();
      dryGain.gain.value = 1;
      wetGain.gain.value = 0;

      source.connect(dryGain).connect(masterGain);
      source.connect(tapeNode);
      tapeNode.connect(wetGain).connect(masterGain);
      masterGain.connect(audioCtx.destination);

      setupPanel.hidden = true;
      runPanel.hidden = false;

      // wait briefly for the first position report before establishing trail
      setTimeout(() => {
        if (lastPos.bufferLength > 0) enterTrail();
      }, 400);
    } catch (err) {
      setupHint.textContent = "入力の取得に失敗しました: " + err.message;
      startBtn.disabled = false;
    }
  }

  startBtn.addEventListener("click", start);

  mixSlider.addEventListener("input", () => {
    const mix01 = (+mixSlider.value) / 100;
    mixVal.textContent = Math.round(mix01 * 100) + "%";
    if (!dryGain) return;
    const g = equalPowerGains(mix01);
    dryGain.gain.setTargetAtTime(g.dry, audioCtx.currentTime, 0.02);
    wetGain.gain.setTargetAtTime(g.wet, audioCtx.currentTime, 0.02);
  });

  pitchSlider.addEventListener("input", () => {
    const cents = +pitchSlider.value;
    const semi = cents / 100;
    pitchVal.textContent = (semi >= 0 ? "+" : "") + semi.toFixed(2) + " semi";
    if (!tapeNode) return;
    if (mode === "rewind") sendRate(-pitchToRateMagnitude(cents));
    else if (mode === "trail") sendRate(pitchToRateMagnitude(cents));
    else if (mode === "loop-active") sendRate(loopDirection * pitchToRateMagnitude(cents));
    // miracle keeps its own randomized rate
  });

  rewindBtn.addEventListener("click", () => {
    if (!tapeNode) return;
    if (mode === "rewind") enterTrail();
    else enterRewind();
  });

  loopBtn.addEventListener("click", () => {
    if (!tapeNode) return;
    handleLoopButton();
  });

  miracleBtn.addEventListener("click", () => {
    if (!tapeNode) return;
    if (mode === "miracle") enterTrail();
    else enterMiracle();
  });

  liveBtn.addEventListener("click", () => {
    if (!tapeNode) return;
    enterTrail();
  });

  jumpBtn.addEventListener("click", () => {
    if (!tapeNode) return;
    doJump();
  });

  loopShiftBack.addEventListener("click", () => {
    shiftLoop(+loopShiftSecondsInput.value || 0);
  });
  loopShiftFwd.addEventListener("click", () => {
    shiftLoop(-(+loopShiftSecondsInput.value || 0));
  });
})();
