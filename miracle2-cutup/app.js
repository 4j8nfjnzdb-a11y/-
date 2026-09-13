// Miracle 2 — pitch-locked random cut-up
//
// Same rolling-buffer engine as rewind sampler, but the scheduler only
// ever plays segments at |rate| == 1 (forward or reverse), so pitch and
// speed never move — only which fragment of the past gets picked, and in
// what order, changes. Four toggles reshape the character of the
// scrambling: fragment length, how far back it searches, whether reversed
// fragments get mixed in, and whether a small stutter gap separates cuts.
// "Freeze" hardware-loops whatever fragment is currently playing.

(() => {
  const startBtn = document.getElementById("startBtn");
  const setupPanel = document.getElementById("setupPanel");
  const runPanel = document.getElementById("runPanel");
  const setupHint = document.getElementById("setupHint");
  const bufferMinutesSel = document.getElementById("bufferMinutes");

  const mixSlider = document.getElementById("mix");
  const mixVal = document.getElementById("mixVal");

  const cutupBtn = document.getElementById("cutupBtn");
  const freezeBtn = document.getElementById("freezeBtn");
  const lengthGroup = document.getElementById("lengthGroup");
  const rangeGroup = document.getElementById("rangeGroup");
  const reverseToggle = document.getElementById("reverseToggle");
  const stutterToggle = document.getElementById("stutterToggle");

  const modeLabel = document.getElementById("modeLabel");
  const posLabel = document.getElementById("posLabel");

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
        this.rate = 0;
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
  let dryGain, wetGain, stutterGate, masterGain;
  let sampleRate = 44100;
  let bufferSeconds = 300;
  let lastPos = { writePtr: 0, readPtr: 0, totalWritten: 0, bufferLength: 0 };

  const norm = (x) => {
    x = x % lastPos.bufferLength;
    if (x < 0) x += lastPos.bufferLength;
    return x;
  };

  let running = false;
  let frozen = false;
  let cutupTimer = null;
  let segMin = 0.3, segMax = 1;
  let rangeMode = "near";
  let reverseMix = false;
  let stutter = false;
  let lastSegment = { startAbs: 0, durSec: 0.5, dir: 1 };

  function sendRate(r) { tapeNode.port.postMessage({ type: "setRate", rate: r }); }
  function sendReadPos(p) { tapeNode.port.postMessage({ type: "setReadPos", pos: p }); }

  function cutupTick() {
    if (!running || frozen) return;
    const durSec = segMin + Math.random() * (segMax - segMin);
    const histSec = Math.max(0.1, Math.min(lastPos.totalWritten / sampleRate, bufferSeconds));
    const searchSec = rangeMode === "near" ? Math.min(15, histSec) : histSec;
    const ageSec = Math.random() * searchSec;
    const startAbs = norm(lastPos.writePtr - Math.round(ageSec * sampleRate));
    const dir = reverseMix && Math.random() < 0.35 ? -1 : 1;

    lastSegment = { startAbs, durSec, dir };
    sendReadPos(startAbs);
    sendRate(dir); // magnitude always 1 -> pitch/speed locked

    modeLabel.textContent =
      "状態: 再生中 (" + (dir > 0 ? "順" : "逆") + " " + durSec.toFixed(2) + "s, " +
      (rangeMode === "near" ? "近距離" : "全域") + ")";

    if (stutter) {
      cutupTimer = setTimeout(() => {
        stutterGate.gain.setTargetAtTime(0, audioCtx.currentTime, 0.005);
        const gapMs = 30 + Math.random() * 150;
        cutupTimer = setTimeout(() => {
          stutterGate.gain.setTargetAtTime(1, audioCtx.currentTime, 0.005);
          cutupTick();
        }, gapMs);
      }, durSec * 1000);
    } else {
      cutupTimer = setTimeout(cutupTick, durSec * 1000);
    }
  }

  function stopCutup() {
    running = false;
    if (cutupTimer) { clearTimeout(cutupTimer); cutupTimer = null; }
    if (tapeNode) {
      tapeNode.port.postMessage({ type: "clearLoop" });
      sendRate(0);
    }
    if (stutterGate) stutterGate.gain.setTargetAtTime(1, audioCtx.currentTime, 0.005);
    cutupBtn.classList.remove("active");
    modeLabel.textContent = "状態: 停止中";
  }

  function startCutup() {
    running = true;
    frozen = false;
    freezeBtn.classList.remove("active");
    cutupBtn.classList.add("active");
    cutupTick();
  }

  function toggleFreeze() {
    if (!running) return;
    frozen = !frozen;
    freezeBtn.classList.toggle("active", frozen);
    if (frozen) {
      if (cutupTimer) { clearTimeout(cutupTimer); cutupTimer = null; }
      const { startAbs, durSec, dir } = lastSegment;
      const lenSamples = Math.round(durSec * sampleRate);
      let loopStart, loopEnd;
      if (dir > 0) {
        loopStart = startAbs;
        loopEnd = norm(startAbs + lenSamples);
      } else {
        loopStart = norm(startAbs - lenSamples);
        loopEnd = startAbs;
      }
      tapeNode.port.postMessage({ type: "setLoop", start: loopStart, end: loopEnd });
      modeLabel.textContent = "状態: フリーズ中(断片をループ)";
    } else {
      tapeNode.port.postMessage({ type: "clearLoop" });
      cutupTick();
    }
  }

  function equalPowerGains(mix01) {
    const t = Math.min(1, Math.max(0, mix01));
    return { dry: Math.cos((t * Math.PI) / 2), wet: Math.sin((t * Math.PI) / 2) };
  }

  async function start() {
    startBtn.disabled = true;
    setupHint.textContent = "入力を初期化中…";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
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
      stutterGate = audioCtx.createGain();
      masterGain = audioCtx.createGain();
      dryGain.gain.value = 1;
      wetGain.gain.value = 0;
      stutterGate.gain.value = 1;

      source.connect(dryGain).connect(masterGain);
      source.connect(tapeNode);
      tapeNode.connect(stutterGate).connect(wetGain).connect(masterGain);
      masterGain.connect(audioCtx.destination);

      setupPanel.hidden = true;
      runPanel.hidden = false;
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

  cutupBtn.addEventListener("click", () => {
    if (!tapeNode) return;
    if (running) stopCutup();
    else startCutup();
  });

  freezeBtn.addEventListener("click", () => {
    if (!tapeNode) return;
    toggleFreeze();
  });

  lengthGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segBtn");
    if (!btn) return;
    for (const b of lengthGroup.querySelectorAll(".segBtn")) b.classList.remove("active");
    btn.classList.add("active");
    segMin = +btn.dataset.min;
    segMax = +btn.dataset.max;
  });

  rangeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".rangeBtn");
    if (!btn) return;
    for (const b of rangeGroup.querySelectorAll(".rangeBtn")) b.classList.remove("active");
    btn.classList.add("active");
    rangeMode = btn.dataset.mode;
  });

  reverseToggle.addEventListener("click", () => {
    reverseMix = !reverseMix;
    reverseToggle.classList.toggle("active", reverseMix);
  });

  stutterToggle.addEventListener("click", () => {
    stutter = !stutter;
    stutterToggle.classList.toggle("active", stutter);
  });
})();
