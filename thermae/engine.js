// thermae — BBD (bucket-brigade) delay engine
//
// The whole point of THERMAE is that pitch is NOT computed. There is no
// pitch detector and no FFT. There is a bucket-brigade chain whose clock
// speed is changed by a digital brain, and everything already sitting in
// that chain gets flushed out at the new speed — which transposes it.
// Faster clock -> shorter delay -> higher pitch -> tighter, brighter.
// Slower clock -> longer delay -> lower pitch -> smeared, grittier.
//
// So this engine models the chain itself, not the effect:
//
//   input -> compander -> anti-alias LPF (cutoff tracks the clock)
//         -> N buckets clocked at fc -> sample & hold
//         -> reconstruction LPF (cutoff tracks the clock) -> expander
//         -> resonant LPF (tone) -> regen -> back into the chain
//
// Every character trait falls out of that structure for free: octave-down
// steps are noisy and dark because the clock is slow and the filters
// follow it; octave-up steps are clear and chirpy; the repeats degrade
// because each pass goes through the whole chain again.
//
// This class is deliberately self-contained (no imports, no closures over
// module scope) so app.js can stringify it with toString() and hand the
// source to an AudioWorklet, while also running it directly on the main
// thread as a ScriptProcessorNode fallback.

class ThermaeEngine {
  constructor(sampleRate) {
    this.sr = sampleRate || 48000;

    // 4 x MN3005 in series, 4096 stages each. One clock tick shifts the
    // whole chain by one bucket, so delay = stages / clock.
    this.stages = 16384;
    this.buf = new Float32Array(this.stages);
    this.w = 0;
    this.phase = 0;   // clock phase accumulator, ticks when it crosses 1
    this.held = 0;    // sample-and-hold at the end of the chain

    this.p = {
      mix: 0.55,
      regen: 0.45,
      tone: 0.62,       // 0..1 -> 150..8000 Hz
      reso: 0.35,       // filter Q, "musical" rather than corrective
      glide: 0.0,       // 0 = instant jump, 1 = lazy smudge
      int1: -12,        // semitones, null = OFF (step skipped)
      int2: 7,
      baseMs: 500,      // unity delay time (tap tempo)
      divBase: 1, div1: 1, div2: 1,  // step lengths: 1, 0.75, 0.5 of base
      seq: 1,
      stepMode: 0,      // sequencer only advances when triggered
      bounce: 0,        // app extra: 0>1>2>1>0 instead of 0>1>2>0
      modDepth: 0,      // 0..1 -> up to +-12 semitones of clock wobble
      modRate: 0.4,     // Hz
      modWave: 0,       // 0..8
      drive: 0.35,
      grit: 0.35,       // BBD noise floor
      compander: 1,
      slowDepth: 0.8,   // how far the slowdown footswitch drags the clock
      inGain: 1,
      outGain: 1,
      bypass: 0,
      trails: 1,
    };

    // --- sequencer -------------------------------------------------
    this.stepIdx = 0;
    this.stepDir = 1;
    this.stepSamples = 0;
    this.curSemis = 0;

    // --- clock smoothing (glide / portamento, in log space) --------
    this.baseLog = Math.log(this.stages / 0.5);
    this.clkLog = this.baseLog;
    this.slowCur = 0;
    this.slowTarget = 0;

    // --- modulation ------------------------------------------------
    this.lfoPhase = 0;
    this.rndCur = 0;
    this.rndPrev = 0;

    // --- filters ---------------------------------------------------
    this.aa1 = 0; this.aa2 = 0;     // anti-alias, pre-chain
    this.rc1 = 0; this.rc2 = 0;     // reconstruction, post-chain
    this.svfLow = 0; this.svfBand = 0;
    this.dcX = 0; this.dcY = 0;

    // --- compander -------------------------------------------------
    this.envC = 0;
    this.envE = 0;
    this.atk = 1 - Math.exp(-1 / (0.003 * this.sr));
    this.rel = 1 - Math.exp(-1 / (0.090 * this.sr));

    // --- misc ------------------------------------------------------
    this.fbState = 0;
    this.gIn = 1;
    this.gWet = 0.55;
    this.gDry = 1;
    this.limG = 1;
    this.peak = 0;
    this.reportCounter = 0;
    this.reportEvery = Math.floor(this.sr / 30);
    this.onEvent = null;

    this.fcMin = this.stages / 32.0;      // 32 second delay
    this.fcMax = this.stages / 0.025;     // 25 ms delay

    this.resetSeq();
  }

  // -----------------------------------------------------------------
  // parameters & commands
  // -----------------------------------------------------------------

  setParams(obj) {
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(this.p, k)) this.p[k] = obj[k];
    }
    if (this.p.baseMs < 20) this.p.baseMs = 20;
  }

  command(name, value) {
    if (name === 'trigger') {
      this.advanceStep();
    } else if (name === 'slow') {
      this.slowTarget = value ? -Math.log(2) * 6 * this.p.slowDepth : 0;
    } else if (name === 'resync') {
      this.resetSeq();
    } else if (name === 'clear') {
      this.buf.fill(0);
      this.fbState = 0;
      this.svfLow = 0; this.svfBand = 0;
    }
  }

  resetSeq() {
    this.stepIdx = 0;
    this.stepDir = 1;
    this.curSemis = 0;
    this.stepSamples = this.stepLength(0);
    this.emit();
  }

  semisFor(idx) {
    const p = this.p;
    if (idx === 0) return 0;
    const a = p.int1 === null ? 0 : p.int1;
    if (idx === 1) return a;
    // Interval 2 is additive: both knobs at -12 gives -24 on step 3.
    const b = p.int2 === null ? 0 : p.int2;
    return a + b;
  }

  stepLength(idx) {
    const p = this.p;
    const div = idx === 0 ? p.divBase : (idx === 1 ? p.div1 : p.div2);
    return Math.max(64, Math.floor((p.baseMs / 1000) * div * this.sr));
  }

  // The sequence walks unity -> int 1 -> int 2 -> unity, skipping any
  // interval switched OFF. With both OFF it is simply an analog delay.
  advanceStep() {
    const p = this.p;
    const on1 = p.int1 !== null;
    const on2 = p.int2 !== null;
    const order = [0];
    if (on1) order.push(1);
    if (on2) order.push(2);

    if (order.length === 1) {
      this.stepIdx = 0;
    } else if (p.bounce && order.length > 2) {
      let at = order.indexOf(this.stepIdx);
      if (at < 0) at = 0;
      at += this.stepDir;
      if (at >= order.length) { at = order.length - 2; this.stepDir = -1; }
      else if (at < 0) { at = 1; this.stepDir = 1; }
      this.stepIdx = order[at];
    } else {
      let at = order.indexOf(this.stepIdx);
      if (at < 0) at = 0;
      this.stepIdx = order[(at + 1) % order.length];
    }

    this.curSemis = this.semisFor(this.stepIdx);
    this.stepSamples = this.stepLength(this.stepIdx);
    this.emit();
  }

  emit() {
    if (!this.onEvent) return;
    this.onEvent('step', {
      step: this.stepIdx,
      semis: this.curSemis,
      delayMs: (this.stages / Math.exp(this.clkLog)) * 1000,
    });
  }

  // -----------------------------------------------------------------
  // modulation
  // -----------------------------------------------------------------

  lfo() {
    const p = this.p;
    const inc = p.modRate / this.sr;
    this.lfoPhase += inc;
    let wrapped = false;
    while (this.lfoPhase >= 1) { this.lfoPhase -= 1; wrapped = true; }
    if (wrapped) {
      this.rndPrev = this.rndCur;
      this.rndCur = Math.random() * 2 - 1;
    }
    const ph = this.lfoPhase;
    switch (p.modWave) {
      case 0: return Math.sin(2 * Math.PI * ph);                 // sine
      case 1: return 4 * Math.abs(ph - 0.5) - 1;                 // triangle
      case 2: return 2 * ph - 1;                                 // ramp up
      case 3: return 1 - 2 * ph;                                 // ramp down
      case 4: return ph < 0.5 ? 1 : -1;                          // square
      case 5: return this.rndCur;                                // sample & hold
      case 6: return this.rndPrev + (this.rndCur - this.rndPrev) * ph;  // drift
      case 7: return Math.sin(2 * Math.PI * ph) * (0.35 + 0.65 * Math.abs(this.rndCur));
      case 8: return 0.5 * (Math.sin(2 * Math.PI * ph) + Math.sin(2 * Math.PI * ph * 1.618));
      default: return 0;
    }
  }

  // -----------------------------------------------------------------
  // the audio loop
  // -----------------------------------------------------------------

  process(inp, outL, outR, n) {
    const p = this.p;
    const sr = this.sr;
    const len = this.stages;
    const buf = this.buf;

    // glide: one-pole in log(clock) space, so a portamento is musically
    // even whether it is going up or down.
    const glideSec = p.glide * p.glide * 1.6;
    const glideCoef = glideSec < 1 / sr ? 1 : 1 - Math.exp(-1 / (glideSec * sr));
    const slowCoef = 1 - Math.exp(-1 / (0.35 * sr));

    const baseFc = len / (p.baseMs / 1000);
    this.baseLog = Math.log(baseFc);

    const toneHz = 150 * Math.pow(8000 / 150, p.tone);
    const q = 1 / (0.6 + p.reso * 3.2);
    const svfF = 2 * Math.sin(Math.PI * Math.min(toneHz, sr * 0.16) / sr);

    const smooth = 1 - Math.exp(-1 / (0.012 * sr));
    const inTarget = p.bypass ? 0 : 1;
    const wetTarget = p.bypass && !p.trails ? 0 : p.mix * 0.92;
    const dryTarget = p.bypass ? 1 : 1 - p.mix * 0.8;

    const modSemis = p.modDepth * 12;
    const noiseAmp = p.grit * 0.0016;
    const drive = 1 + p.drive * 4;

    for (let i = 0; i < n; i++) {
      // ---- sequencer ---------------------------------------------
      if (p.seq && !p.stepMode) {
        if (--this.stepSamples <= 0) this.advanceStep();
      }

      // ---- clock ---------------------------------------------------
      const mod = p.modDepth > 0 ? this.lfo() * modSemis : 0;
      this.slowCur += (this.slowTarget - this.slowCur) * slowCoef;
      const target = this.baseLog +
        (this.curSemis + mod) * (Math.LN2 / 12) +
        this.slowCur;
      this.clkLog += (target - this.clkLog) * glideCoef;

      let fc = Math.exp(this.clkLog);
      if (fc < this.fcMin) fc = this.fcMin;
      else if (fc > this.fcMax) fc = this.fcMax;

      // ---- input ---------------------------------------------------
      let x = (inp ? inp[i] : 0) * p.inGain;
      // DC blocker
      const dc = x - this.dcX + 0.9975 * this.dcY;
      this.dcX = x; this.dcY = dc;
      x = dc;

      this.gIn += (inTarget - this.gIn) * smooth;
      this.gWet += (wetTarget - this.gWet) * smooth;
      this.gDry += (dryTarget - this.gDry) * smooth;

      let v = x * this.gIn + this.fbState;

      // ---- compander: compress -------------------------------------
      let gC = 1;
      if (p.compander) {
        const a = v < 0 ? -v : v;
        this.envC += (a - this.envC) * (a > this.envC ? this.atk : this.rel);
        gC = Math.pow(Math.max(this.envC, 1e-5) / 0.15, -0.5);
        if (gC > 6) gC = 6; else if (gC < 0.4) gC = 0.4;
        v *= gC;
      }

      // ---- soft saturation (BBD headroom) --------------------------
      // Unity for small signals, squashes what the chain cannot hold.
      v = Math.tanh(v * drive) / drive;

      // ---- anti-alias filter, cutoff follows the clock -------------
      // This is why a slow clock sounds dark: the chain simply cannot
      // carry anything above roughly a third of its own clock rate.
      let cut = fc * 0.33;
      if (cut > 9500) cut = 9500;
      if (cut < 45) cut = 45;
      const ac = 1 - Math.exp(-2 * Math.PI * cut / sr);
      this.aa1 += (v - this.aa1) * ac;
      this.aa2 += (this.aa1 - this.aa2) * ac;
      const toChain = this.aa2;

      // ---- clock the bucket chain ----------------------------------
      this.phase += fc / sr;
      let guard = 0;
      while (this.phase >= 1 && guard < 32) {
        this.phase -= 1;
        guard++;
        this.held = buf[this.w];
        buf[this.w] = toChain + (Math.random() * 2 - 1) * noiseAmp;
        this.w++;
        if (this.w >= len) this.w = 0;
      }
      if (guard >= 32) this.phase = 0;

      // ---- reconstruction filter -----------------------------------
      this.rc1 += (this.held - this.rc1) * ac;
      this.rc2 += (this.rc1 - this.rc2) * ac;
      let y = this.rc2;

      // ---- compander: expand ---------------------------------------
      if (p.compander) {
        const a = y < 0 ? -y : y;
        this.envE += (a - this.envE) * (a > this.envE ? this.atk : this.rel);
        let gE = Math.pow(Math.max(this.envE, 1e-5) / 0.15, 0.5);
        if (gE > 2.5) gE = 2.5; else if (gE < 0.17) gE = 0.17;
        y *= gE;
      }

      // ---- resonant low pass (the "musical" tone control) ----------
      const high = y - this.svfLow - q * this.svfBand;
      this.svfBand += svfF * high;
      this.svfLow += svfF * this.svfBand;
      if (!(this.svfLow > -8 && this.svfLow < 8)) { this.svfLow = 0; this.svfBand = 0; }
      const wet = this.svfLow;

      // ---- regeneration --------------------------------------------
      this.fbState = Math.tanh(wet * p.regen * 1.05);

      // ---- mix & limit ---------------------------------------------
      let o = (x * this.gDry + wet * this.gWet) * p.outGain;
      const ao = o < 0 ? -o : o;
      if (ao * this.limG > 0.95) this.limG += (0.95 / ao - this.limG) * 0.4;
      else this.limG += (1 - this.limG) * 0.0006;
      o *= this.limG;
      if (o > 1) o = 1; else if (o < -1) o = -1;

      outL[i] = o;
      if (outR !== outL) outR[i] = o;

      const am = o < 0 ? -o : o;
      if (am > this.peak) this.peak = am;

      if (++this.reportCounter >= this.reportEvery) {
        this.reportCounter = 0;
        if (this.onEvent) {
          this.onEvent('meter', {
            peak: this.peak,
            delayMs: (len / fc) * 1000,
            fc: fc,
            step: this.stepIdx,
            semis: this.curSemis,
            cents: (this.clkLog - this.baseLog) * 1200 / Math.LN2,
          });
        }
        this.peak = 0;
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = ThermaeEngine;
