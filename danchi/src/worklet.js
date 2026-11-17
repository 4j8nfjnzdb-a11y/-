// AudioWorklet: runs the C core (compiled to WebAssembly) and posts what the screens show.
class DanchiProc extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = opts.processorOptions;
    this.w = new WebAssembly.Instance(new WebAssembly.Module(o.wasm), {}).exports;
    this.w.init(sampleRate, o.seed);
    for (const [k, v] of o.knobs || []) this.w.set_knob(k, v);
    const buf = this.w.memory.buffer;
    this.L = new Float32Array(buf, this.w.out_l(), 256);
    this.R = new Float32Array(buf, this.w.out_r(), 256);
    this.V = new Float32Array(buf, this.w.view(), this.w.view_n());
    this.FB = new Uint16Array(buf, this.w.fb(), 240 * 240);
    this.IN = new Float32Array(buf, this.w.in_buf(), 256);
    this.inch = 2;
    this.n = 0; this.row = 0; this.cpu = 0;
    this.port.onmessage = (e) => {
      const m = e.data, w = this.w;
      if (m.t === 'enc') w.enc(m.k, m.d);
      else if (m.t === 'key') w.key(m.u, m.d);
      else if (m.t === 'btn') w.btn(m.b, m.a);
      else if (m.t === 'knob') w.set_knob(m.k, m.v);
      else if (m.t === 'inch') this.inch = m.v;
      else if (m.t === 'pcm') {
        // a sound for the object: 16-bit mono, written where the core keeps it, then committed
        const n = Math.min(m.data.length, w.samp_max());
        new Int16Array(w.memory.buffer, w.samp_area(), n).set(m.data.subarray(0, n));
        w.samp_commit(n);
      }
    };
  }
  process(ins, outs) {
    const out = outs[0], n = out[0].length, inp = ins[0];
    if (inp && inp.length) {
      const a = inp[0], b = inp[1] || inp[0], IN = this.IN;
      if (this.inch === 0) IN.set(a);
      else if (this.inch === 1) IN.set(b);
      else for (let i = 0; i < n; i++) IN[i] = 0.5 * (a[i] + b[i]);
      this.w.process_in(n);
    } else this.w.process(n);
    out[0].set(this.L.subarray(0, n));
    if (out[1]) out[1].set(this.R.subarray(0, n));
    // the device screen is drawn 8 rows at a time, between audio blocks, as it would be on the device
    this.w.draw(this.row, 8);
    this.row += 8;
    if (this.row >= 240) {
      this.row = 0;
      const fb = this.FB.slice();
      this.port.postMessage({ t: 'fb', fb }, [fb.buffer]);
    }
    if (++this.n % 5 === 0) {
      this.w.view();
      const v = this.V.slice();
      this.port.postMessage({ t: 'view', v }, [v.buffer]);
    }
    return true;
  }
}
registerProcessor('danchi', DanchiProc);
