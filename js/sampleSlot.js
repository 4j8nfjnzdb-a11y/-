// One sample slot: load a sound, pick a region of it ("ある部分"), and
// play that region two ways at once — a big continuous LOOP and a
// finely retriggered CHOP — each independently enabled, mixed together,
// then sent through the slot's own volume/pan/reverb-depth strip before
// reaching its output port in the patch bay.

import { engine, stepSeconds } from "./audioEngine.js";
import { makeDefaultSample, makeRandomDefaultSample } from "./synthSamples.js";

const ORDERS = ["forward", "reverse", "random", "pingpong"];
const DIVISIONS = ["1/8", "1/8d", "1/16", "1/16t", "1/32"];
const COLORS = ["#58e0c0", "#ff7a59", "#c58cff", "#ffd166"];

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function reverseBuffer(ctx, buffer) {
  const rev = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = rev.getChannelData(ch);
    for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
  }
  return rev;
}

export class SampleSlot {
  constructor(index) {
    this.index = index;
    this.color = COLORS[index % COLORS.length];
    this.buffer = null;
    this.reversedBuffer = null;
    this.region = { start: 0, end: 1 };
    this.loop = { enabled: false, rate: 1, reverse: false };
    this.chop = { enabled: true, steps: 8, division: "1/16", gate: 0.7, probability: 0.9, jitter: 0.15, order: "forward" };
    this.chopCounter = 0;
    this.chopDir = 1;
    this.nextStepTime = 0;
    this.loopSource = null;
    this.loopStartedAt = 0;

    this._buildNodes();
    this._buildUI();
  }

  _buildNodes() {
    const ctx = engine.ctx;
    this.preGain = ctx.createGain();
    this.preGain.gain.value = 1;
    this.panner = ctx.createStereoPanner();
    this.volumeGain = ctx.createGain();
    this.volumeGain.gain.value = 0.85;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.15;
    this.outputBus = ctx.createGain();

    this.preGain.connect(this.panner).connect(this.volumeGain);
    this.volumeGain.connect(this.outputBus);
    this.volumeGain.connect(this.reverbSend);
    this.reverbSend.connect(engine.reverbBus);
  }

  _buildUI() {
    this.rootEl = el(`
      <div class="slot" style="border-color:${this.color}22">
        <div class="slot-head">
          <span class="slot-name"><span class="slot-color-dot" style="background:${this.color}"></span>SLOT ${this.index + 1}</span>
          <span class="slot-file">no sample</span>
        </div>
        <div class="slot-loadrow">
          <button class="loadBtn">読込</button>
          <button class="randBtn">🎲 デフォルト</button>
        </div>
        <div class="wave-wrap">
          <canvas></canvas>
          <div class="wave-region"></div>
          <div class="wave-playhead"></div>
          <div class="wave-empty">サンプル未読込<br />ここにドラッグ&amp;ドロップ</div>
        </div>
        <div class="engine-block loop-block">
          <div class="engine-head">
            <label><input type="checkbox" class="loopEnable" /> LOOP</label>
            <span class="tag">大きくループ</span>
          </div>
          <div class="engine-grid">
            <label class="param">RATE <span class="valnum loopRateVal">1.00x</span>
              <input type="range" class="loopRate" min="0.25" max="4" step="0.01" value="1" />
            </label>
            <label class="param">DIRECTION
              <select class="loopReverse">
                <option value="0">forward</option>
                <option value="1">reverse</option>
              </select>
            </label>
          </div>
        </div>
        <div class="engine-block chop-block">
          <div class="engine-head">
            <label><input type="checkbox" class="chopEnable" checked /> CHOP</label>
            <span class="tag">細かく刻む</span>
          </div>
          <div class="engine-grid">
            <label class="param">STEPS
              <select class="chopSteps">
                <option>4</option><option selected>8</option><option>16</option><option>32</option>
              </select>
            </label>
            <label class="param">RATE
              <select class="chopDivision">
                ${DIVISIONS.map((d) => `<option ${d === "1/16" ? "selected" : ""}>${d}</option>`).join("")}
              </select>
            </label>
            <label class="param">ORDER
              <select class="chopOrder">
                ${ORDERS.map((o) => `<option>${o}</option>`).join("")}
              </select>
            </label>
            <label class="param">GATE <span class="valnum gateVal">70%</span>
              <input type="range" class="chopGate" min="0.05" max="1" step="0.01" value="0.7" />
            </label>
            <label class="param">確率 <span class="valnum probVal">90%</span>
              <input type="range" class="chopProb" min="0" max="1" step="0.01" value="0.9" />
            </label>
            <label class="param">ジッター <span class="valnum jitterVal">15%</span>
              <input type="range" class="chopJitter" min="0" max="1" step="0.01" value="0.15" />
            </label>
          </div>
        </div>
        <div class="engine-block mixer-block">
          <div class="mixer-strip">
            <label class="param">VOL <span class="valnum volVal">85</span>
              <input type="range" class="volSlider" min="0" max="1.2" step="0.01" value="0.85" />
            </label>
            <label class="param">PAN <span class="valnum panVal">C</span>
              <input type="range" class="panSlider" min="-1" max="1" step="0.01" value="0" />
            </label>
            <label class="param">REVERB <span class="valnum revVal">15</span>
              <input type="range" class="revSlider" min="0" max="1" step="0.01" value="0.15" />
            </label>
          </div>
        </div>
        <div class="triggerRow">
          <button class="hitBtn">⚡ HIT</button>
        </div>
      </div>
    `);

    this.fileLabel = this.rootEl.querySelector(".slot-file");
    this.canvas = this.rootEl.querySelector("canvas");
    this.waveWrap = this.rootEl.querySelector(".wave-wrap");
    this.regionEl = this.rootEl.querySelector(".wave-region");
    this.playheadEl = this.rootEl.querySelector(".wave-playhead");
    this.emptyEl = this.rootEl.querySelector(".wave-empty");

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "audio/*";
    this.fileInput.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;";
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files && this.fileInput.files[0];
      this.fileInput.value = "";
      if (file) this._loadFile(file);
    });
    document.body.appendChild(this.fileInput);

    this.rootEl.querySelector(".loadBtn").addEventListener("click", () => this.fileInput.click());
    this.rootEl.querySelector(".randBtn").addEventListener("click", () => this.loadDefault());
    this.rootEl.querySelector(".hitBtn").addEventListener("click", () => this.hit());

    const loopEnable = this.rootEl.querySelector(".loopEnable");
    loopEnable.addEventListener("change", () => this.setLoopEnabled(loopEnable.checked));

    const loopRate = this.rootEl.querySelector(".loopRate");
    const loopRateVal = this.rootEl.querySelector(".loopRateVal");
    loopRate.addEventListener("input", () => {
      this.loop.rate = +loopRate.value;
      loopRateVal.textContent = `${this.loop.rate.toFixed(2)}x`;
      if (this.loopSource) this.loopSource.playbackRate.setTargetAtTime(this.loop.rate, engine.ctx.currentTime, 0.01);
    });

    const loopReverse = this.rootEl.querySelector(".loopReverse");
    loopReverse.addEventListener("change", () => {
      this.loop.reverse = loopReverse.value === "1";
      if (this.loop.enabled) this._restartLoop();
    });

    const chopEnable = this.rootEl.querySelector(".chopEnable");
    chopEnable.addEventListener("change", () => this.setChopEnabled(chopEnable.checked));

    this.rootEl.querySelector(".chopSteps").addEventListener("change", (e) => { this.chop.steps = +e.target.value; });
    this.rootEl.querySelector(".chopDivision").addEventListener("change", (e) => { this.chop.division = e.target.value; });
    this.rootEl.querySelector(".chopOrder").addEventListener("change", (e) => { this.chop.order = e.target.value; this.chopCounter = 0; this.chopDir = 1; });

    const gate = this.rootEl.querySelector(".chopGate");
    const gateVal = this.rootEl.querySelector(".gateVal");
    gate.addEventListener("input", () => { this.chop.gate = +gate.value; gateVal.textContent = `${Math.round(this.chop.gate * 100)}%`; });

    const prob = this.rootEl.querySelector(".chopProb");
    const probVal = this.rootEl.querySelector(".probVal");
    prob.addEventListener("input", () => { this.chop.probability = +prob.value; probVal.textContent = `${Math.round(this.chop.probability * 100)}%`; });

    const jitter = this.rootEl.querySelector(".chopJitter");
    const jitterVal = this.rootEl.querySelector(".jitterVal");
    jitter.addEventListener("input", () => { this.chop.jitter = +jitter.value; jitterVal.textContent = `${Math.round(this.chop.jitter * 100)}%`; });

    const vol = this.rootEl.querySelector(".volSlider");
    const volVal = this.rootEl.querySelector(".volVal");
    vol.addEventListener("input", () => {
      this.volumeGain.gain.setTargetAtTime(+vol.value, engine.ctx.currentTime, 0.01);
      volVal.textContent = Math.round(+vol.value * 100);
    });

    const pan = this.rootEl.querySelector(".panSlider");
    const panVal = this.rootEl.querySelector(".panVal");
    pan.addEventListener("input", () => {
      this.panner.pan.setTargetAtTime(+pan.value, engine.ctx.currentTime, 0.01);
      const v = +pan.value;
      panVal.textContent = Math.abs(v) < 0.03 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;
    });

    const rev = this.rootEl.querySelector(".revSlider");
    const revVal = this.rootEl.querySelector(".revVal");
    rev.addEventListener("input", () => {
      this.reverbSend.gain.setTargetAtTime(+rev.value, engine.ctx.currentTime, 0.01);
      revVal.textContent = Math.round(+rev.value * 100);
    });

    this._bindWaveformDrag();
  }

  async _loadFile(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await engine.ctx.decodeAudioData(arrayBuffer);
      this._setBuffer(buffer, file.name);
    } catch (err) {
      console.warn("failed to load sample", err);
      this.fileLabel.textContent = "読込失敗: 対応形式か確認してください";
    }
  }

  async loadDefault(seedIndex) {
    const { name, buffer } = seedIndex === undefined
      ? await makeRandomDefaultSample()
      : await makeDefaultSample(seedIndex);
    this._setBuffer(buffer, name);
  }

  _setBuffer(buffer, name) {
    this.buffer = buffer;
    this.reversedBuffer = reverseBuffer(engine.ctx, buffer);
    this.region = { start: 0, end: buffer.duration };
    this.fileLabel.textContent = name;
    this.fileLabel.title = name;
    this.emptyEl.style.display = "none";
    this._drawWaveform();
    this._drawRegion();
    if (this.loop.enabled) this._restartLoop();
  }

  _drawWaveform() {
    if (!this.buffer) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.waveWrap.clientWidth || 240;
    const cssH = this.waveWrap.clientHeight || 84;
    const canvas = this.canvas;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, canvas.width, canvas.height);
    const data = this.buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / canvas.width));
    const mid = canvas.height / 2;
    g.strokeStyle = this.color;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x < canvas.width; x++) {
      let min = 1, max = -1;
      const startI = x * step;
      for (let i = 0; i < step; i++) {
        const v = data[startI + i] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      g.moveTo(x, mid + min * mid * 0.92);
      g.lineTo(x, mid + max * mid * 0.92);
    }
    g.stroke();
  }

  _drawRegion() {
    if (!this.buffer) return;
    const dur = this.buffer.duration;
    const leftPct = (this.region.start / dur) * 100;
    const widthPct = ((this.region.end - this.region.start) / dur) * 100;
    this.regionEl.style.left = `${leftPct}%`;
    this.regionEl.style.width = `${Math.max(0.5, widthPct)}%`;
  }

  _bindWaveformDrag() {
    let dragMode = null; // 'new' | 'start' | 'end'
    let dragOriginFrac = 0;

    const fracAt = (clientX) => {
      const rect = this.waveWrap.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };

    this.waveWrap.addEventListener("mousedown", (e) => {
      if (!this.buffer) return;
      const dur = this.buffer.duration;
      const frac = fracAt(e.clientX);
      const startFrac = this.region.start / dur;
      const endFrac = this.region.end / dur;
      const px = frac * this.waveWrap.clientWidth;
      const startPx = startFrac * this.waveWrap.clientWidth;
      const endPx = endFrac * this.waveWrap.clientWidth;

      if (Math.abs(px - startPx) < 7) dragMode = "start";
      else if (Math.abs(px - endPx) < 7) dragMode = "end";
      else { dragMode = "new"; dragOriginFrac = frac; }

      const onMove = (ev) => {
        const f = fracAt(ev.clientX);
        if (dragMode === "start") {
          this.region.start = Math.min(f, endFrac - 0.005) * dur;
        } else if (dragMode === "end") {
          this.region.end = Math.max(f, startFrac + 0.005) * dur;
        } else {
          this.region.start = Math.min(dragOriginFrac, f) * dur;
          this.region.end = Math.max(dragOriginFrac, f) * dur;
        }
        this._drawRegion();
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (this.region.end - this.region.start < 0.02) {
          this.region.end = Math.min(dur, this.region.start + 0.05);
        }
        if (this.loop.enabled) this._restartLoop();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    let dragDepth = 0;
    this.waveWrap.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragDepth++;
      this.waveWrap.classList.add("wave-dragover");
    });
    this.waveWrap.addEventListener("dragover", (e) => e.preventDefault());
    this.waveWrap.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) this.waveWrap.classList.remove("wave-dragover");
    });
    this.waveWrap.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      this.waveWrap.classList.remove("wave-dragover");
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) this._loadFile(file);
    });
  }

  // ---- LOOP engine --------------------------------------------------

  setLoopEnabled(on) {
    this.loop.enabled = on;
    if (on && this.buffer) this._restartLoop();
    else this._stopLoop();
  }

  _restartLoop() {
    this._stopLoop();
    if (!this.buffer) return;
    const ctx = engine.ctx;
    const src = ctx.createBufferSource();
    const dur = this.buffer.duration;
    if (this.loop.reverse) {
      src.buffer = this.reversedBuffer;
      src.loopStart = dur - this.region.end;
      src.loopEnd = dur - this.region.start;
    } else {
      src.buffer = this.buffer;
      src.loopStart = this.region.start;
      src.loopEnd = this.region.end;
    }
    src.loop = true;
    src.playbackRate.value = this.loop.rate;
    const fadeGain = ctx.createGain();
    fadeGain.gain.setValueAtTime(0, ctx.currentTime);
    fadeGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.02);
    src.connect(fadeGain).connect(this.preGain);
    src.start(ctx.currentTime, this.loop.reverse ? dur - this.region.end : this.region.start);
    this.loopSource = src;
    this.loopFadeGain = fadeGain;
    this.loopStartedAt = ctx.currentTime;
  }

  _stopLoop() {
    if (this.loopSource) {
      try {
        const ctx = engine.ctx;
        this.loopFadeGain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
        const src = this.loopSource;
        setTimeout(() => { try { src.stop(); } catch (e) {} }, 80);
      } catch (e) {}
      this.loopSource = null;
    }
  }

  // ---- CHOP engine ----------------------------------------------------

  setChopEnabled(on) {
    this.chop.enabled = on;
    if (on) this.nextStepTime = engine.ctx.currentTime + 0.05;
  }

  _nextChopIndex() {
    const n = this.chop.steps;
    switch (this.chop.order) {
      case "reverse":
        this.chopCounter = (this.chopCounter + 1) % n;
        return n - 1 - this.chopCounter;
      case "random":
        return Math.floor(Math.random() * n);
      case "pingpong": {
        const idx = this.chopCounter;
        this.chopCounter += this.chopDir;
        if (this.chopCounter >= n - 1 || this.chopCounter <= 0) this.chopDir *= -1;
        return Math.max(0, Math.min(n - 1, idx));
      }
      default:
        this.chopCounter = (this.chopCounter + 1) % n;
        return this.chopCounter;
    }
  }

  transportTick(now, lookahead) {
    if (!this.chop.enabled || !this.buffer) return;
    const stepDur = stepSeconds(this.chop.division);
    while (this.nextStepTime < now + lookahead) {
      const t = this.nextStepTime;
      if (Math.random() < this.chop.probability) {
        this._triggerChopSlice(t);
      }
      this.nextStepTime += Math.max(0.01, stepDur);
    }
  }

  _triggerChopSlice(time) {
    const ctx = engine.ctx;
    const dur = this.region.end - this.region.start;
    const steps = this.chop.steps;
    const sliceWidth = dur / steps;
    const idx = this._nextChopIndex();
    const jitterOffset = (Math.random() * 2 - 1) * this.chop.jitter * sliceWidth * 0.5;
    let offset = this.region.start + idx * sliceWidth + jitterOffset;
    offset = Math.min(this.buffer.duration - 0.01, Math.max(0, offset));
    const playDur = Math.max(0.01, sliceWidth * this.chop.gate);
    const rateJitter = 1 + (Math.random() * 2 - 1) * this.chop.jitter * 0.12;

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = rateJitter;

    const env = ctx.createGain();
    const attack = Math.min(0.006, playDur * 0.2);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(1, time + attack);
    env.gain.setValueAtTime(1, time + Math.max(attack, playDur - attack));
    env.gain.linearRampToValueAtTime(0, time + playDur);

    src.connect(env).connect(this.preGain);
    src.start(time, offset, playDur + 0.02);
    src.stop(time + playDur + 0.03);
  }

  // ---- manual trigger --------------------------------------------------

  hit() {
    if (!this.buffer) return;
    const ctx = engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.loop.reverse ? this.reversedBuffer : this.buffer;
    const dur = this.buffer.duration;
    const offset = this.loop.reverse ? dur - this.region.end : this.region.start;
    const playDur = this.region.end - this.region.start;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    env.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.005);
    src.connect(env).connect(this.preGain);
    src.start(ctx.currentTime, offset, playDur);
  }

  // ---- transport lifecycle ---------------------------------------------

  onTransportStart() {
    this.nextStepTime = engine.ctx.currentTime + 0.05;
    if (this.loop.enabled && this.buffer) this._restartLoop();
  }

  onTransportStop() {
    this._stopLoop();
  }

  updatePlayhead() {
    if (!this.buffer || !this.loop.enabled || !this.loopSource) {
      this.playheadEl.style.opacity = 0;
      return;
    }
    const ctx = engine.ctx;
    const dur = this.buffer.duration;
    const loopStart = this.loop.reverse ? dur - this.region.end : this.region.start;
    const loopEnd = this.loop.reverse ? dur - this.region.start : this.region.end;
    const loopLen = Math.max(0.001, loopEnd - loopStart);
    const elapsed = ((ctx.currentTime - this.loopStartedAt) * this.loop.rate) % loopLen;
    const posInBuffer = this.loop.reverse ? (dur - (loopStart + elapsed)) : (loopStart + elapsed);
    const pct = (posInBuffer / dur) * 100;
    this.playheadEl.style.left = `${pct}%`;
    this.playheadEl.style.opacity = 1;
  }
}
