/* 粉砕 FUNSAI — audio engine (AudioWorklet processor)
 *
 * The whole processor lives inside one self-contained function so app.js can
 * stringify it into a Blob URL. That keeps this file ordinary, highlightable
 * JavaScript with no build step, and lets the app run from file:// as well as
 * over http (addModule() on a relative path fails under file://).
 *
 * Nothing in here may close over the outer scope.
 */
function funsaiWorkletCode() {
  'use strict';

  var RING_SEC = 4;          // capture ring per chain
  var TAU = 6.283185307179586;

  /* musical divisions, in beats: half note .. 1/128 */
  var DIVS = [2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.1875, 0.125, 0.09375, 0.0625, 0.03125];
  var ODDS = [3, 5, 7, 9, 11, 13, 15, 17];

  var PADS = ['stut', 'roll', 'frz', 'rev',
              'pshf', 'odd', 'scrm', 'rnd',
              'stop', 'gate', 'crsh', 'ring',
              'filt', 'dly', 'smr', 'dstr'];

  /* pads that take over playback from the capture ring */
  var CAPTURE = { stut: 1, roll: 1, frz: 1, rev: 1, odd: 1, scrm: 1, rnd: 1, pshf: 1, stop: 1 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function expMap(x, lo, hi) { return lo * Math.pow(hi / lo, clamp(x, 0, 1)); }

  function pickDiv(x) { return DIVS[clamp(Math.floor(x * DIVS.length), 0, DIVS.length - 1)]; }

  /* triangle wavefolder, safe for any input magnitude */
  function fold(x) {
    var y = (x - 1) % 4;
    if (y < 0) y += 4;
    return Math.abs(y - 2) - 1;
  }

  function softclip(x) {
    if (x > 3) return 1;
    if (x < -3) return -1;
    return x * (27 + x * x) / (27 + 9 * x * x);
  }

  /* ------------------------------------------------------------------ *
   * Chain: capture ring + the whole mangling FX rack for one bus.
   * ------------------------------------------------------------------ */
  function Chain(sr) {
    var n = Math.max(1024, Math.floor(sr * RING_SEC));
    this.sr = sr;
    this.n = n;
    this.rl = new Float32Array(n);
    this.rr = new Float32Array(n);
    this.w = 0;                       // monotonic write counter

    this.fx = {};
    for (var i = 0; i < PADS.length; i++) {
      this.fx[PADS[i]] = { man: false, auto: false, on: false, x: 0.5, y: 0.5 };
    }
    this.stack = [];                  // capture owners, oldest first

    this.cap = {
      on: false, owner: '', start: 0, pos: 0, len: 4800, fade: 96,
      rate: 1, base: 1, dir: 1, rep: 0, brake: 1, back: 0, backApplied: 0, lenApplied: 4800
    };

    var dn = Math.max(1024, Math.floor(sr * 1.2));
    this.dn = dn;
    this.dbl = new Float32Array(dn);
    this.dbr = new Float32Array(dn);
    this.dw = 0;
    this.dtime = sr * 0.25;
    this.dlpL = 0;
    this.dlpR = 0;

    this.f1l = 0; this.f2l = 0; this.f1r = 0; this.f2r = 0;
    this.chCnt = 0; this.chL = 0; this.chR = 0;
    this.rph = 0; this.rlfo = 0;
    this.genv = 1;

    this.grains = [];
    for (var g = 0; g < 8; g++) this.grains.push({ on: false, pos: 0, len: 1, off: 0, rate: 1 });
    this.gspawn = 0;

    this.seed = (1 + Math.floor(Math.random() * 2000000)) | 0;
    this.peak = 0;
  }

  /* Math.imul keeps the multiply exact in 32 bits. A plain `seed * k`
     overflows the float mantissa and collapses the period to ~16k, which
     is audible as a 0.34s buzz in DSTR instead of noise. */
  Chain.prototype.rnd = function () {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  };

  Chain.prototype.rd = function (buf, idx) {
    var n = this.n;
    var i = idx % n;
    if (i < 0) i += n;
    var i0 = i | 0;
    var f = i - i0;
    var i1 = i0 + 1;
    if (i1 >= n) i1 = 0;
    var a = buf[i0];
    return a + (buf[i1] - a) * f;
  };

  Chain.prototype.rdD = function (buf, idx) {
    var n = this.dn;
    var i = idx % n;
    if (i < 0) i += n;
    var i0 = i | 0;
    var f = i - i0;
    var i1 = i0 + 1;
    if (i1 >= n) i1 = 0;
    var a = buf[i0];
    return a + (buf[i1] - a) * f;
  };

  /* --- pad state ---------------------------------------------------- */

  Chain.prototype.setPad = function (id, manual, on, clk) {
    var f = this.fx[id];
    if (!f) return;
    if (manual) f.man = on; else f.auto = on;
    var now = f.man || f.auto;
    if (now === f.on) return;
    f.on = now;

    if (CAPTURE[id]) {
      var at = this.stack.indexOf(id);
      if (now && at < 0) this.stack.push(id);
      if (!now && at >= 0) this.stack.splice(at, 1);
      this.syncCapture(clk);
    } else if (id === 'dly' && now) {
      this.dtime = expMap(this.fx.dly.x, 0.004, 0.7) * this.sr;
    }
    if (id === 'stop' && now) this.cap.brake = 1;
  };

  Chain.prototype.setXY = function (id, x, y, clk) {
    var f = this.fx[id];
    if (!f) return;
    f.x = x;
    f.y = y;
    if (this.cap.on && CAPTURE[id]) this.refresh(clk);
  };

  Chain.prototype.syncCapture = function (clk) {
    var owner = this.stack.length ? this.stack[0] : '';
    var cap = this.cap;
    if (!owner) {
      cap.on = false;
      cap.owner = '';
      return;
    }
    if (cap.on && cap.owner === owner) { this.refresh(clk); return; }
    cap.on = true;
    cap.owner = owner;
    cap.rep = 0;
    cap.brake = 1;
    this.refresh(clk);
    this.anchor(clk);
  };

  /* (re)point the capture window at the most recent complete slice */
  Chain.prototype.anchor = function (clk) {
    var cap = this.cap;
    var len = cap.len;
    var back = Math.min(cap.back, this.n - 2048 - len);
    if (back < 0) back = 0;
    if (cap.owner === 'frz') {
      cap.start = this.w - len - back;
    } else {
      var phase = clk.barPhase % len;
      cap.start = this.w - phase - len - back;
    }
    cap.backApplied = cap.back;
    cap.lenApplied = len;
    cap.pos = cap.dir < 0 ? len - 1 : 0;
  };

  /* recompute length / rate / direction without restarting the loop */
  Chain.prototype.refresh = function (clk) {
    var cap = this.cap;
    var F = this.fx;
    var owner = cap.owner;
    if (!owner) return;
    var f = F[owner];
    var spb = clk.spb;
    var maxLen = this.n - 2048;
    var len = cap.len;
    var base = 1;
    var dir = 1;

    cap.back = 0;
    if (owner === 'stut') {
      len = pickDiv(f.x) * spb;
      cap.back = Math.floor(f.y * 8) * len;   // loop a slice from further back
    } else if (owner === 'roll') {
      if (cap.rep === 0) len = pickDiv(f.x * 0.6) * spb;
    } else if (owner === 'frz') {
      len = expMap(f.x, 0.0015, 0.4) * this.sr;
      base = expMap(f.y, 0.25, 4);
    } else if (owner === 'rev') {
      len = pickDiv(f.x) * spb;
      base = expMap(f.y, 0.5, 2);
    } else if (owner === 'odd') {
      var nn = ODDS[clamp(Math.floor(f.x * ODDS.length), 0, ODDS.length - 1)];
      len = spb * 4 * nn / 16;
    } else if (owner === 'scrm') {
      len = pickDiv(0.25 + f.x * 0.6) * spb;
    } else if (owner === 'rnd') {
      if (cap.rep === 0) len = pickDiv(0.2 + f.y * 0.75) * spb;
    } else if (owner === 'pshf') {
      len = spb * 0.25;
    } else if (owner === 'stop') {
      len = spb * 2;
    }

    if (F.rev.on) dir = -1;

    cap.len = clamp(len, 24, maxLen);
    cap.fade = Math.min(96, cap.len * 0.12);
    cap.base = base;
    cap.dir = dir;
    if (cap.rep === 0) cap.rate = base;
    if (cap.pos >= cap.len) cap.pos = cap.len - 1;
  };

  /* called every time the capture loop wraps */
  Chain.prototype.onRepeat = function (clk) {
    var cap = this.cap;
    var F = this.fx;
    var spb = clk.spb;
    cap.rep++;

    var rate = cap.base;

    /* STAIR — pitch ladders up or down, one step per repeat */
    if (F.pshf.on) {
      var semi = (F.pshf.x - 0.5) * 2 * 7;
      var span = 2 + Math.floor(F.pshf.y * 14);
      var k = cap.rep % span;
      rate *= Math.pow(2, semi * k / 12);
    }

    /* ROLL — the loop shrinks every repeat: gallop into a buzz */
    if (F.roll.on) {
      var shrink = 1 - (0.06 + F.roll.y * 0.34);
      cap.len = Math.max(32, cap.len * shrink);
      cap.fade = Math.min(96, cap.len * 0.12);
      rate *= 1 + F.roll.x * 0.15 * cap.rep;
      if (cap.len <= 34) cap.len = pickDiv(F.roll.x * 0.6) * spb;
    }

    /* SCRM — jump to a random slice inside the last bar or two */
    if (F.scrm.on) {
      var range = 1 + Math.floor(F.scrm.y * 15);
      var jump = Math.floor(this.rnd() * range) * cap.len;
      var phaseS = clk.barPhase % cap.len;
      cap.start = this.w - phaseS - cap.len - jump;
    }

    /* CHAOS — re-roll everything */
    if (F.rnd.on) {
      if (this.rnd() < F.rnd.x) {
        var rates = [0.25, 0.5, 0.5, 0.75, 1, 1, 1, 1.5, 2, 3, -1, -0.5, -2];
        rate = rates[Math.floor(this.rnd() * rates.length)];
      }
      if (this.rnd() < F.rnd.x * 0.8) {
        cap.len = clamp(pickDiv(this.rnd()) * spb, 24, this.n - 2048);
        cap.fade = Math.min(96, cap.len * 0.12);
      }
      if (this.rnd() < F.rnd.x * 0.6) {
        var back = Math.floor(this.rnd() * 8) * cap.len;
        cap.start = this.w - (clk.barPhase % cap.len) - cap.len - back;
      }
    }

    /* ODD — nudge the window so the meter keeps slipping */
    if (F.odd.on && F.odd.y > 0.02 && this.rnd() < F.odd.y) {
      cap.start -= Math.floor(this.rnd() * F.odd.y * spb);
    }

    /* Re-snap to the bar grid when the window itself was retuned mid-hold.
       Only when it changed: otherwise a held stutter would chase the live
       playhead every repeat instead of looping the same slice. ROLL and
       CHAOS are excluded because they mutate the length on purpose. */
    if (cap.owner !== 'roll' && cap.owner !== 'rnd' && cap.owner !== 'scrm' &&
        (cap.back !== cap.backApplied || cap.len !== cap.lenApplied)) {
      this.anchor(clk);
    }

    cap.rate = rate;
    if (cap.start < this.w - (this.n - 2048)) cap.start = this.w - (this.n - 2048);
  };

  Chain.prototype.panic = function () {
    for (var i = 0; i < PADS.length; i++) {
      var f = this.fx[PADS[i]];
      f.man = false; f.auto = false; f.on = false;
    }
    this.stack.length = 0;
    this.cap.on = false;
    this.cap.owner = '';
  };

  /* --- per sample --------------------------------------------------- */

  Chain.prototype.process = function (l, r, clk) {
    var n = this.n;
    var wi = this.w % n;
    this.rl[wi] = l;
    this.rr[wi] = r;
    this.w++;

    var F = this.fx;
    var cap = this.cap;
    var sr = this.sr;

    /* ---- capture playback (stutter / freeze / reverse / scramble) --- */
    if (cap.on) {
      var p = cap.pos;
      var a = cap.start + p;
      l = this.rd(this.rl, a);
      r = this.rd(this.rr, a);

      var fade = cap.fade;
      var env = 1;
      if (p < fade) env = p / fade;
      else if (p > cap.len - fade) env = (cap.len - p) / fade;
      if (env < 0) env = 0;

      /* STOP — tape brake toward a floor rate */
      if (F.stop.on) {
        var tau = expMap(F.stop.x, 0.04, 3) * sr;
        var k = Math.exp(-1 / tau);
        var floorR = F.stop.y * 0.6;
        cap.brake = cap.brake * k + floorR * (1 - k);
      } else if (cap.brake !== 1) {
        cap.brake += (1 - cap.brake) * 0.002;
      }

      var rate = cap.rate * cap.dir * cap.brake;
      var mag = rate < 0 ? -rate : rate;
      if (mag < 0.05) env *= mag * 20;   // fade out as the tape halts

      l *= env;
      r *= env;

      cap.pos += rate;
      if (cap.pos >= cap.len) {
        cap.pos -= cap.len;
        if (cap.pos >= cap.len || cap.pos < 0) cap.pos = 0;
        this.onRepeat(clk);
      } else if (cap.pos < 0) {
        cap.pos += cap.len;
        if (cap.pos < 0 || cap.pos >= cap.len) cap.pos = cap.len - 1;
        this.onRepeat(clk);
      }
    }

    /* ---- SMEAR — grain cloud from the ring -------------------------- */
    if (F.smr.on) {
      var size = expMap(F.smr.x, 0.008, 0.3) * sr;
      var spread = (0.02 + F.smr.y * 1.6) * sr;
      this.gspawn--;
      if (this.gspawn <= 0) {
        this.gspawn = Math.max(48, size * 0.35);
        for (var gi = 0; gi < this.grains.length; gi++) {
          var gg = this.grains[gi];
          if (!gg.on) {
            gg.on = true;
            gg.pos = 0;
            gg.len = size;
            gg.rate = (F.smr.y > 0.5 && this.rnd() < 0.3) ? -1 : 1;
            gg.off = this.w - 256 - this.rnd() * spread;
            if (gg.rate < 0) gg.off += size;
            break;
          }
        }
      }
      var sl = 0, srr = 0;
      for (var gj = 0; gj < this.grains.length; gj++) {
        var g = this.grains[gj];
        if (!g.on) continue;
        var gph = g.pos / g.len;
        var genv = 0.5 - 0.5 * Math.cos(gph * TAU);
        var gidx = g.off + g.pos * g.rate;
        sl += this.rd(this.rl, gidx) * genv;
        srr += this.rd(this.rr, gidx) * genv;
        g.pos++;
        if (g.pos >= g.len) g.on = false;
      }
      l = l * 0.25 + sl * 0.65;
      r = r * 0.25 + srr * 0.65;
    }

    /* ---- GATE ------------------------------------------------------- */
    if (F.gate.on) {
      var gd = pickDiv(F.gate.x) * clk.spb;
      var duty = 0.04 + F.gate.y * 0.92;
      var gp = (clk.barPhase % gd) / gd;
      var want = gp < duty ? 1 : 0;
      this.genv += (want - this.genv) * 0.02;
      l *= this.genv;
      r *= this.genv;
    } else if (this.genv < 1) {
      this.genv += (1 - this.genv) * 0.02;
    }

    /* ---- CRSH — sample rate reduce + bit crush ---------------------- */
    if (F.crsh.on) {
      var hold = Math.max(1, Math.round(expMap(F.crsh.x, 1, 110)));
      this.chCnt++;
      if (this.chCnt >= hold) {
        this.chCnt = 0;
        var bits = Math.max(1, Math.round(16 - F.crsh.y * 15));
        var q = Math.pow(2, bits - 1);
        this.chL = Math.round(l * q) / q;
        this.chR = Math.round(r * q) / q;
      }
      l = this.chL;
      r = this.chR;
    }

    /* ---- DSTR — drive, fold, digital noise -------------------------- */
    if (F.dstr.on) {
      var drv = expMap(F.dstr.x, 1.5, 90);
      var nz = F.dstr.y;
      if (nz > 0.01) {
        l += (this.rnd() * 2 - 1) * nz * 0.4;
        r += (this.rnd() * 2 - 1) * nz * 0.4;
      }
      l = fold(l * drv) * 0.55;
      r = fold(r * drv) * 0.55;
    }

    /* ---- RING ------------------------------------------------------- */
    if (F.ring.on) {
      var rf = expMap(F.ring.x, 6, 3200);
      var sw = F.ring.y;
      if (sw > 0.02) {
        this.rlfo += (0.15 + sw * 26) / sr;
        if (this.rlfo >= 1) this.rlfo -= 1;
        var tri = Math.abs(this.rlfo * 2 - 1) * 2 - 1;
        rf *= Math.pow(2, tri * sw * 4);
      }
      this.rph += rf / sr;
      if (this.rph >= 1) this.rph -= 1;
      var m = Math.sin(this.rph * TAU);
      l *= m;
      r *= m;
    }

    /* ---- FILT — state variable lowpass, screams at high Q ----------- */
    if (F.filt.on) {
      var fc = clamp(expMap(F.filt.x, 28, 16000), 20, sr * 0.45);
      var qq = 0.5 + F.filt.y * 16;
      var gT = Math.tan(Math.PI * fc / sr);
      var kk = 1 / qq;
      var a1 = 1 / (1 + gT * (gT + kk));
      var a2 = gT * a1;
      var a3 = gT * a2;

      var v3 = l - this.f2l;
      var v1 = a1 * this.f1l + a2 * v3;
      var v2 = this.f2l + a2 * this.f1l + a3 * v3;
      this.f1l = 2 * v1 - this.f1l;
      this.f2l = 2 * v2 - this.f2l;
      l = v2;

      v3 = r - this.f2r;
      v1 = a1 * this.f1r + a2 * v3;
      v2 = this.f2r + a2 * this.f1r + a3 * v3;
      this.f1r = 2 * v1 - this.f1r;
      this.f2r = 2 * v2 - this.f2r;
      r = v2;
    }

    /* ---- DLY — always running so a press echoes instantly ----------- */
    var fb = 0;
    if (F.dly.on) {
      var target = expMap(F.dly.x, 0.004, 0.7) * sr;
      this.dtime += (target - this.dtime) * 0.0009;   // slew = tape pitch bend
      fb = Math.min(1.02, F.dly.y * 1.05);
    } else {
      this.dtime = expMap(F.dly.x, 0.004, 0.7) * sr;
    }
    var rp = this.dw - clamp(this.dtime, 8, this.dn - 4);
    var wetL = this.rdD(this.dbl, rp);
    var wetR = this.rdD(this.dbr, rp);
    this.dlpL += (wetL - this.dlpL) * 0.42;
    this.dlpR += (wetR - this.dlpR) * 0.42;
    wetL = this.dlpL;
    wetR = this.dlpR;
    var di = this.dw % this.dn;
    this.dbl[di] = softclip(l + wetR * fb);   // ping pong
    this.dbr[di] = softclip(r + wetL * fb);
    this.dw++;
    if (F.dly.on) {
      l = l * 0.55 + wetL;
      r = r * 0.55 + wetR;
    }

    var ap = l < 0 ? -l : l;
    if (ap > this.peak) this.peak = ap;

    this.outL = l;
    this.outR = r;
  };

  /* ------------------------------------------------------------------ *
   * Voices / tracks
   * ------------------------------------------------------------------ */
  function Voice() {
    this.on = false;
    this.bl = null;
    this.br = null;
    this.pos = 0;
    this.s0 = 0;
    this.end = 0;
    this.rate = 1;
    this.gain = 1;
    this.pl = 1;
    this.pr = 1;
    this.age = 0;
  }

  function Track() {
    this.buf = null;                 // {l, r, len}
    this.pat = new Uint8Array(32);
    this.len = 16;
    this.res = 1;                    // step rate multiplier
    this.gain = 0.9;
    this.pan = 0;
    this.pitch = 1;
    this.mute = false;
    this.acc = 0;
    this.step = -1;
    this.voices = [];
    for (var i = 0; i < 6; i++) this.voices.push(new Voice());
    this.rr = 0;
  }

  Track.prototype.alloc = function () {
    var best = null;
    var bestAge = -1;
    for (var i = 0; i < this.voices.length; i++) {
      var v = this.voices[i];
      if (!v.on) return v;
      if (v.age > bestAge) { bestAge = v.age; best = v; }
    }
    return best;
  };

  /* ------------------------------------------------------------------ */

  class FunsaiEngine extends AudioWorkletProcessor {
  constructor() {
    super();
    var sr = sampleRate;
    this.sr = sr;
    this.mode = 'kit';
    this.bpm = 174;
    this.swing = 0;
    this.running = false;
    this.master = 0.85;

    this.chains = [];
    for (var i = 0; i < 5; i++) this.chains.push(new Chain(sr));

    this.tracks = [];
    for (var t = 0; t < 4; t++) this.tracks.push(new Track());

    this.mono = {
      buf: null, slices: 16, len: 16, fit: true,
      seq: new Int16Array(32), rev: new Uint8Array(32),
      acc: 0, step: -1, voices: [], rr: 0
    };
    for (var v = 0; v < 8; v++) this.mono.voices.push(new Voice());
    for (var s = 0; s < 32; s++) this.mono.seq[s] = s % 16;

    this.phase = 0;                  // samples since bar start
    this.clk = { barPhase: 0, spb: sr * 60 / this.bpm, barLen: sr * 60 / this.bpm * 4 };
    this.gStep = -1;
    this.gAcc = 0;

    this.auto = { on: false, amt: 0.35 };
    this.autoHeld = [];

    this.tick = 0;
    this.seed = 12345;

    var self = this;
    this.port.onmessage = function (e) { self.onmsg(e.data); };
  }
  }

  FunsaiEngine.prototype.rnd = function () {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  };

  FunsaiEngine.prototype.onmsg = function (m) {
    var i;
    switch (m.type) {
      case 'transport':
        this.running = !!m.running;
        if (this.running && m.reset) this.resync();
        break;
      case 'bpm':
        this.bpm = m.bpm;
        this.clk.spb = this.sr * 60 / this.bpm;
        this.clk.barLen = this.clk.spb * 4;
        break;
      case 'swing': this.swing = m.swing; break;
      case 'master': this.master = m.gain; break;
      case 'mode':
        this.mode = m.mode;
        this.allNotesOff();
        this.resync();
        break;
      case 'kitbuf':
        this.tracks[m.slot].buf = { l: m.l, r: m.r || m.l, len: m.l.length };
        break;
      case 'monobuf':
        this.mono.buf = { l: m.l, r: m.r || m.l, len: m.l.length };
        this.mono.slices = m.slices;
        break;
      case 'pattern':
        var tr = this.tracks[m.track];
        for (i = 0; i < 32; i++) tr.pat[i] = m.pat[i] || 0;
        tr.len = m.len;
        tr.res = m.res;
        if (tr.step >= tr.len) tr.step = tr.len - 1;
        break;
      case 'monopat':
        for (i = 0; i < 32; i++) {
          this.mono.seq[i] = m.seq[i];
          this.mono.rev[i] = m.rev[i];
        }
        this.mono.len = m.len;
        this.mono.fit = !!m.fit;
        if (this.mono.step >= this.mono.len) this.mono.step = this.mono.len - 1;
        break;
      case 'trackparam':
        var tp = this.tracks[m.track];
        if (m.gain !== undefined) tp.gain = m.gain;
        if (m.pan !== undefined) tp.pan = m.pan;
        if (m.pitch !== undefined) tp.pitch = m.pitch;
        if (m.mute !== undefined) tp.mute = m.mute;
        break;
      case 'fx':
        this.chains[m.target].setPad(m.id, true, m.on, this.clk);
        if (m.x !== undefined) this.chains[m.target].setXY(m.id, m.x, m.y, this.clk);
        break;
      case 'fxxy':
        this.chains[m.target].setXY(m.id, m.x, m.y, this.clk);
        break;
      case 'auto':
        this.auto.on = !!m.on;
        this.auto.amt = m.amt;
        if (!this.auto.on) this.clearAuto();
        break;
      case 'resync': this.resync(); break;
      case 'panic':
        for (i = 0; i < 5; i++) this.chains[i].panic();
        this.autoHeld.length = 0;
        this.allNotesOff();
        break;
      case 'trig':
        this.fire(m.track, 3);
        break;
    }
  };

  FunsaiEngine.prototype.clearAuto = function () {
    for (var i = 0; i < this.autoHeld.length; i++) {
      var h = this.autoHeld[i];
      this.chains[h.target].setPad(h.id, false, false, this.clk);
      this.port.postMessage({ type: 'autopad', target: h.target, id: h.id, on: false });
    }
    this.autoHeld.length = 0;
  };

  FunsaiEngine.prototype.allNotesOff = function () {
    for (var t = 0; t < 4; t++) {
      for (var i = 0; i < this.tracks[t].voices.length; i++) this.tracks[t].voices[i].on = false;
    }
    for (var j = 0; j < this.mono.voices.length; j++) this.mono.voices[j].on = false;
  };

  FunsaiEngine.prototype.resync = function () {
    this.phase = 0;
    this.gAcc = 0;
    this.gStep = -1;
    for (var t = 0; t < 4; t++) { this.tracks[t].acc = 0; this.tracks[t].step = -1; }
    this.mono.acc = 0;
    this.mono.step = -1;
  };

  /* fire one kit voice */
  FunsaiEngine.prototype.fire = function (ti, vel) {
    var tr = this.tracks[ti];
    if (!tr.buf || tr.mute) return;
    var v = tr.alloc();
    v.on = true;
    v.bl = tr.buf.l;
    v.br = tr.buf.r;
    v.s0 = 0;
    v.pos = 0;
    v.end = tr.buf.len - 2;
    v.rate = tr.pitch;
    v.gain = tr.gain * (0.34 + vel * 0.22);
    var pan = tr.pan;
    v.pl = Math.cos((pan + 1) * Math.PI / 4);
    v.pr = Math.sin((pan + 1) * Math.PI / 4);
    v.age = 0;
  };

  /* fire one break slice */
  FunsaiEngine.prototype.fireSlice = function (idx, reverse, stepDur) {
    var mo = this.mono;
    if (!mo.buf || idx < 0) return;
    var sliceLen = mo.buf.len / mo.slices;
    var s0 = Math.floor(idx * sliceLen);
    var end = Math.min(mo.buf.len - 2, s0 + Math.ceil(sliceLen));
    var v = null;
    var oldest = -1;
    for (var i = 0; i < mo.voices.length; i++) {
      var c = mo.voices[i];
      if (!c.on) { v = c; break; }
      if (c.age > oldest) { oldest = c.age; v = c; }
    }
    v.on = true;
    v.bl = mo.buf.l;
    v.br = mo.buf.r;
    v.s0 = s0;
    v.end = end;
    v.gain = 1;
    v.pl = 1;
    v.pr = 1;
    v.age = 0;
    var rate = mo.fit ? (sliceLen / stepDur) : 1;
    if (reverse) {
      v.pos = end - 1;
      v.rate = -rate;
    } else {
      v.pos = s0;
      v.rate = rate;
    }
  };

  FunsaiEngine.prototype.renderVoice = function (v) {
    var p = v.pos;
    if (p < v.s0 || p >= v.end) { v.on = false; this.vl = 0; this.vr = 0; return; }
    var i0 = p | 0;
    var f = p - i0;
    var i1 = i0 + 1;
    if (i1 >= v.end) i1 = i0;
    var al = v.bl[i0];
    var ar = v.br[i0];
    var sl = al + (v.bl[i1] - al) * f;
    var sr2 = ar + (v.br[i1] - ar) * f;

    var env = 1;
    var din = v.rate < 0 ? (v.end - p) : (p - v.s0);
    var dout = v.rate < 0 ? (p - v.s0) : (v.end - p);
    if (din < 48) env = din / 48;
    if (dout < 192) env *= dout / 192;
    if (env < 0) env = 0;
    env *= v.gain;

    v.pos += v.rate;
    v.age++;
    this.vl = sl * env * v.pl;
    this.vr = sr2 * env * v.pr;
  };

  /* advance the sequencers by one sample */
  FunsaiEngine.prototype.clockSample = function () {
    var clk = this.clk;
    var stepDur = clk.spb * 0.25;
    var sw = this.swing * 0.34;

    this.phase++;
    if (this.phase >= clk.barLen) this.phase -= clk.barLen;
    clk.barPhase = this.phase;

    /* global 16th, only used for auto-chaos + UI */
    this.gAcc++;
    if (this.gAcc >= stepDur) {
      this.gAcc -= stepDur;
      this.gStep = (this.gStep + 1) & 15;
      this.autoStep();
    }

    if (this.mode === 'mono') {
      var mo = this.mono;
      var dur = stepDur * (((mo.step + 1) & 1) ? (1 - sw) : (1 + sw));
      mo.acc++;
      if (mo.acc >= dur) {
        mo.acc -= dur;
        mo.step = (mo.step + 1) % Math.max(1, mo.len);
        var si = mo.seq[mo.step];
        if (si >= 0) this.fireSlice(si, mo.rev[mo.step], stepDur);
      }
      return;
    }

    for (var t = 0; t < 4; t++) {
      var tr = this.tracks[t];
      var sd = stepDur / tr.res;
      var d = tr.res === 1 ? sd * (((tr.step + 1) & 1) ? (1 - sw) : (1 + sw)) : sd;
      tr.acc++;
      if (tr.acc >= d) {
        tr.acc -= d;
        tr.step = (tr.step + 1) % Math.max(1, tr.len);
        var vel = tr.pat[tr.step];
        if (vel > 0) this.fire(t, vel);
      }
    }
  };

  /* automatic self-mangling */
  FunsaiEngine.prototype.autoStep = function () {
    var i, h;
    for (i = this.autoHeld.length - 1; i >= 0; i--) {
      h = this.autoHeld[i];
      h.left--;
      if (h.left <= 0) {
        this.chains[h.target].setPad(h.id, false, false, this.clk);
        this.port.postMessage({ type: 'autopad', target: h.target, id: h.id, on: false });
        this.autoHeld.splice(i, 1);
      }
    }
    if (!this.auto.on || !this.running) return;
    var amt = this.auto.amt;
    if (this.rnd() > amt * 0.45) return;
    if (this.autoHeld.length >= 3) return;

    var id = PADS[Math.floor(this.rnd() * PADS.length)];
    var target = 4;
    if (this.mode === 'kit' && this.rnd() < amt * 0.5) target = Math.floor(this.rnd() * 4);
    for (i = 0; i < this.autoHeld.length; i++) {
      if (this.autoHeld[i].id === id && this.autoHeld[i].target === target) return;
    }
    var x = this.rnd();
    var y = this.rnd();
    var left = 1 + Math.floor(this.rnd() * (1 + amt * 7));
    var ch = this.chains[target];
    ch.setXY(id, x, y, this.clk);
    ch.setPad(id, false, true, this.clk);
    this.autoHeld.push({ target: target, id: id, left: left });
    this.port.postMessage({ type: 'autopad', target: target, id: id, on: true, x: x, y: y });
  };

  FunsaiEngine.prototype.process = function (inputs, outputs) {
    var out = outputs[0];
    var oL = out[0];
    var oR = out.length > 1 ? out[1] : out[0];
    var nf = oL.length;
    var clk = this.clk;
    var mg = this.master;

    for (var i = 0; i < nf; i++) {
      var mixL = 0, mixR = 0;

      if (this.running) this.clockSample();

      if (this.mode === 'mono') {
        var sl = 0, sr2 = 0;
        var mv = this.mono.voices;
        for (var v = 0; v < mv.length; v++) {
          if (!mv[v].on) continue;
          this.renderVoice(mv[v]);
          sl += this.vl;
          sr2 += this.vr;
        }
        this.chains[0].process(sl, sr2, clk);
        mixL = this.chains[0].outL;
        mixR = this.chains[0].outR;
      } else {
        for (var t = 0; t < 4; t++) {
          var tr = this.tracks[t];
          var tl = 0, trr = 0;
          for (var j = 0; j < tr.voices.length; j++) {
            if (!tr.voices[j].on) continue;
            this.renderVoice(tr.voices[j]);
            tl += this.vl;
            trr += this.vr;
          }
          var ch = this.chains[t];
          ch.process(tl, trr, clk);
          mixL += ch.outL;
          mixR += ch.outR;
        }
      }

      var m = this.chains[4];
      m.process(mixL, mixR, clk);
      oL[i] = softclip(m.outL * mg);
      oR[i] = softclip(m.outR * mg);
    }

    this.tick += nf;
    if (this.tick >= 1024) {
      this.tick = 0;
      var peaks = new Array(5);
      for (var c = 0; c < 5; c++) { peaks[c] = this.chains[c].peak; this.chains[c].peak = 0; }
      this.port.postMessage({
        type: 'pos',
        mono: this.mono.step,
        t: [this.tracks[0].step, this.tracks[1].step, this.tracks[2].step, this.tracks[3].step],
        peaks: peaks
      });
    }
    return true;
  };

  registerProcessor('funsai-engine', FunsaiEngine);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { funsaiWorkletCode: funsaiWorkletCode };
