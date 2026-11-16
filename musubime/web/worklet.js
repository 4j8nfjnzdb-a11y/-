// musubime: the AudioWorklet that runs a project's WebAssembly (the same C as the FM-1's firmware).
// The engine runs at 44.1 kHz, as on the FM-1; at another context rate it is resampled (linear) both ways.
// About 60 times a second (every 735 engine samples) it runs the UI frame and sends the screen if it changed.
class MusubimeProc extends AudioWorkletProcessor {
  constructor(opt) {
    super();
    const bytes = opt.processorOptions.wasm;
    const mod = new WebAssembly.Module(bytes);
    this.w = new WebAssembly.Instance(mod, {}).exports;
    this.mem = this.w.memory;
    this.w.wb_init(opt.processorOptions.seed >>> 0);
    this.engineSamples = 0;
    this.sinceFrame = 735;
    this.ratio = 44100 / sampleRate;           // engine samples per output sample
    this.pos = 0;                               // fractional read position in the engine FIFO
    this.fifoL = new Float32Array(1024);
    this.fifoR = new Float32Array(1024);
    this.fifoN = 0;
    this.inFifoL = new Float32Array(2048);
    this.inFifoR = new Float32Array(2048);
    this.inN = 0;
    this.inPos = 0;
    this.lastFb = 0;
    this.recording = false;
    this.gain = opt.processorOptions.gain || 0.125;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }
  onMsg(m) {
    const w = this.w;
    if (m.t === "enc") w.wb_enc(m.i, m.d);
    else if (m.t === "btn") w.wb_buttons(m.mask >>> 0);
    else if (m.t === "key") w.wb_key(m.k, m.down ? 1 : 0, m.vel | 0);
    else if (m.t === "prs") w.wb_pressure(m.k, m.p | 0);
    else if (m.t === "gain") this.gain = m.g;
    else if (m.t === "rec") this.recording = !!m.on;
  }
  runEngine(n) {
    const w = this.w;
    // the input, if any, already at the engine's rate in inFifo
    if (this.inN >= n) {
      const il = new Float32Array(this.mem.buffer, w.wb_in_l(), 256);
      const ir = new Float32Array(this.mem.buffer, w.wb_in_r(), 256);
      il.set(this.inFifoL.subarray(0, n));
      ir.set(this.inFifoR.subarray(0, n));
      this.inFifoL.copyWithin(0, n, this.inN);
      this.inFifoR.copyWithin(0, n, this.inN);
      this.inN -= n;
      w.wb_in_on(1);
    } else {
      w.wb_in_on(0);
    }
    w.wb_render(n);
    const ol = new Float32Array(this.mem.buffer, w.wb_out_l(), 256);
    const or = new Float32Array(this.mem.buffer, w.wb_out_r(), 256);
    this.fifoL.set(ol.subarray(0, n), this.fifoN);
    this.fifoR.set(or.subarray(0, n), this.fifoN);
    this.fifoN += n;
    this.engineSamples += n;
    this.sinceFrame += n;
    if (this.sinceFrame >= 735) {
      this.sinceFrame -= 735;
      w.wb_ms(Math.floor((this.engineSamples * 1000) / 44100));
      w.wb_frame();
      if (w.wb_fb_dirty() || currentTime - this.lastFb > 0.5) {
        if (currentTime - this.lastFb > 0.033) {
          this.lastFb = currentTime;
          const fb = new Uint16Array(this.mem.buffer, w.wb_fb(), 240 * 240).slice();
          this.port.postMessage({ t: "fb", fb, b: w.wb_led_b(), k: w.wb_led_k(), d: w.wb_led_d(), db: w.wb_led_db(), bad: w.wb_bad() }, [fb.buffer]);
        }
      }
    }
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const n = L.length;
    // the input into the engine's rate
    const inp = inputs[0];
    if (inp && inp.length && inp[0]) {
      const a = inp[0], b = inp[1] || inp[0];
      if (this.ratio === 1) {
        if (this.inN + a.length <= 2048) {
          this.inFifoL.set(a, this.inN);
          this.inFifoR.set(b, this.inN);
          this.inN += a.length;
        }
      } else {
        // linear resample from sampleRate to 44100
        const step = 1 / this.ratio;
        let p = this.inPos;
        while (p < a.length - 1 && this.inN < 2048) {
          const i = Math.floor(p), f = p - i;
          this.inFifoL[this.inN] = a[i] + (a[i + 1] - a[i]) * f;
          this.inFifoR[this.inN] = b[i] + (b[i + 1] - b[i]) * f;
          this.inN++;
          p += step;
        }
        this.inPos = p - (a.length - 1);
      }
    }
    const g = this.gain;
    for (let i = 0; i < n; i++) {
      // enough engine samples for this one?
      while (this.fifoN < Math.floor(this.pos) + 2) this.runEngine(128);
      const k = Math.floor(this.pos), f = this.pos - k;
      L[i] = (this.fifoL[k] + (this.fifoL[k + 1] - this.fifoL[k]) * f) * g;
      R[i] = (this.fifoR[k] + (this.fifoR[k + 1] - this.fifoR[k]) * f) * g;
      this.pos += this.ratio;
    }
    const used = Math.floor(this.pos);
    if (used > 0) {
      this.fifoL.copyWithin(0, used, this.fifoN);
      this.fifoR.copyWithin(0, used, this.fifoN);
      this.fifoN -= used;
      this.pos -= used;
    }
    if (this.recording) this.port.postMessage({ t: "rec", l: L.slice(), r: R.slice() });
    return true;
  }
}
registerProcessor("musubime-proc", MusubimeProc);
