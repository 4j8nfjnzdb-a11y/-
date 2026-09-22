/* 粉砕 FUNSAI — audio engine (AudioWorklet processor)
 *
 * The whole processor lives inside one self-contained function so app.js can
 * stringify it into a Blob (or data:) URL. That keeps this file ordinary,
 * highlightable JavaScript with no build step, and lets the app run from
 * file:// as well as over http.
 *
 * Nothing in here may close over the outer scope.
 *
 * Model: 4 lanes, each with its own bus (chain 0..3) feeding a master chain
 * (4). A lane holds tracker-style per-step events rather than a plain on/off
 * pattern, so every single hit carries its own slice, pitch, direction,
 * retrigger count and destructive effect. The rewrite engine re-decides those
 * values as each step fires, which is why a bar never repeats exactly.
 */
function funsaiWorkletCode() {
  'use strict';

  var RING_SEC = 4;
  var TAU = 6.283185307179586;
  var NSTEP = 64;              // max steps per lane
  var NLANE = 4;

  /* musical divisions, in beats: half note .. 1/128 */
  var DIVS = [2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.1875, 0.125, 0.09375, 0.0625, 0.03125];
  var ODDS = [3, 5, 7, 9, 11, 13, 15, 17];

  var PADS = ['stut', 'roll', 'frz', 'rev',
              'pshf', 'odd', 'scrm', 'rnd',
              'stop', 'gate', 'crsh', 'ring',
              'filt', 'dly', 'smr', 'dstr'];

  /* pads that take over playback from the capture ring */
  var CAPTURE = { stut: 1, roll: 1, frz: 1, rev: 1, odd: 1, scrm: 1, rnd: 1, pshf: 1, stop: 1 };

  /* rewrite palettes */
  var RW_PITCH = [-24, -12, -12, -7, -5, -3, 0, 0, 0, 0, 2, 3, 5, 7, 12, 12, 19, 24];
  var RW_RTG = [1, 1, 1, 2, 2, 3, 4, 4, 6, 8, 8, 12, 16];
  var RW_METER = [0, 0, 0, 3, 5, 7, 9, 11, 13, 6, 10];   // 0 = keep full length

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

  function onePole(f, sr) { return 1 - Math.exp(-TAU * f / sr); }

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
      this.fx[PADS[i]] = { man: false, auto: false, on: false, rnd: false, x: 0.5, y: 0.5 };
    }
    this.stack = [];                  // capture owners, oldest first
    this.rndq = [];                   // pads whose x/y the engine randomised

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

    if (now && f.rnd) this.rollPad(id);

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

  Chain.prototype.rollPad = function (id) {
    var f = this.fx[id];
    f.x = this.rnd();
    f.y = this.rnd();
    this.rndq.push(id);
  };

  /* re-roll every held pad that has its R switch on */
  Chain.prototype.stepRandom = function (clk) {
    var any = false;
    for (var i = 0; i < PADS.length; i++) {
      var id = PADS[i];
      var f = this.fx[id];
      if (f.on && f.rnd && !CAPTURE[id]) { this.rollPad(id); any = true; }
    }
    if (any && this.cap.on) this.refresh(clk);
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
    var i;
    cap.rep++;

    /* R switch: capture pads re-roll on every repeat */
    var rolled = false;
    for (i = 0; i < PADS.length; i++) {
      var id = PADS[i];
      var pf = this.fx[id];
      if (pf.on && pf.rnd && CAPTURE[id]) { this.rollPad(id); rolled = true; }
    }
    if (rolled) this.refresh(clk);

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
   * Voice — one hit, with its own destructive effect.
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
    this.fx = 0;
    this.fxa = 0;
    this.cCnt = 0; this.cL = 0; this.cR = 0;
    this.fL = 0; this.fR = 0;
    this.rph = 0;
    this.stopK = 1; this.stopD = 1;
    this.skipAcc = 0; this.skipLen = 1; this.skipJump = 0;
    this.life = 0;
    this.seed = 1;
  }

  /* ------------------------------------------------------------------ *
   * Lane — one drummer. Tracker events, not a loop.
   * ------------------------------------------------------------------ */
  function Lane(sr) {
    this.sr = sr;
    this.buf = null;                 // {l, r, len}
    this.sliced = false;             // true = index into slices, false = one shot
    this.slices = 16;
    this.len = 16;
    this.effLen = 16;                // meter changes shorten this
    this.res = 1;
    this.role = 0;                   // 0 full, 1 low, 2 mid, 3 high
    this.gain = 0.9;
    this.pan = 0;
    this.mute = false;
    this.keep = false;               // survives a drop
    this.fit = true;

    this.ev = {
      slice: new Int8Array(NSTEP),
      vel: new Uint8Array(NSTEP),
      pitch: new Int8Array(NSTEP),
      rev: new Uint8Array(NSTEP),
      rtg: new Uint8Array(NSTEP),
      racc: new Int8Array(NSTEP),
      fx: new Uint8Array(NSTEP),
      fxa: new Uint8Array(NSTEP)
    };
    for (var s = 0; s < NSTEP; s++) { this.ev.slice[s] = -1; this.ev.rtg[s] = 1; }

    this.acc = 0;
    this.step = -1;

    /* pending retrigger burst */
    this.rtgN = 0; this.rtgIdx = 0; this.rtgAcc = 0; this.rtgDur = 0;
    this.rtgK = 1; this.rtgSum = 1; this.rtgTotal = 0;
    this.rtgEv = { slice: 0, vel: 3, pitch: 0, rev: 0, fx: 0, fxa: 0 };
    this.rtgV = null;

    this.voices = [];
    for (var i = 0; i < 10; i++) this.voices.push(new Voice());

    /* role band filter state (cascaded one poles) */
    this.lp1L = 0; this.lp2L = 0; this.lp1R = 0; this.lp2R = 0;
    this.hp1L = 0; this.hp2L = 0; this.hp1R = 0; this.hp2R = 0;
    this.setRole(this.role);
  }

  Lane.prototype.setRole = function (role) {
    this.role = role;
    var sr = this.sr;
    /* lpA: upper bound, hpA: lower bound. 0 disables that half. */
    if (role === 1) { this.lpA = onePole(260, sr); this.hpA = 0; this.makeup = 1.1; }
    else if (role === 2) { this.lpA = onePole(3000, sr); this.hpA = onePole(240, sr); this.makeup = 1.6; }
    else if (role === 3) { this.lpA = 0; this.hpA = onePole(1600, sr); this.makeup = 2.2; }
    else { this.lpA = 0; this.hpA = 0; this.makeup = 1; }
  };

  Lane.prototype.alloc = function () {
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
    this.bpm = 174;
    this.swing = 0;
    this.running = false;
    this.master = 0.85;
    this.timeMul = 1;
    this.timeMulWant = 1;

    this.chains = [];
    for (var i = 0; i < 5; i++) this.chains.push(new Chain(sr));

    this.lanes = [];
    for (var t = 0; t < NLANE; t++) this.lanes.push(new Lane(sr));

    this.phase = 0;                  // samples since bar start
    this.clk = { barPhase: 0, spb: sr * 60 / this.bpm, barLen: sr * 60 / this.bpm * 4 };
    this.gStep = -1;
    this.gAcc = 0;

    this.auto = { on: false, amt: 0.35 };
    this.autoHeld = [];

    /* rewrite engine */
    this.rw = {
      on: false, amt: 0.4,
      slice: true, pitch: true, rev: true, rtg: true,
      fx: true, rest: true, meter: false, half: false, drop: true
    };
    this.dropLeft = 0;

    this.tmp = { slice: 0, vel: 3, pitch: 0, rev: 0, rtg: 1, racc: 0, fx: 0, fxa: 0 };

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
    var i, ln;
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
      case 'timemul': this.timeMulWant = m.v; break;

      case 'lane':
        ln = this.lanes[m.i];
        if (m.sliced !== undefined) ln.sliced = !!m.sliced;
        if (m.slices !== undefined) ln.slices = m.slices;
        if (m.len !== undefined) { ln.len = m.len; ln.effLen = m.len; if (ln.step >= m.len) ln.step = m.len - 1; }
        if (m.res !== undefined) ln.res = m.res;
        if (m.role !== undefined) ln.setRole(m.role);
        if (m.gain !== undefined) ln.gain = m.gain;
        if (m.pan !== undefined) ln.pan = m.pan;
        if (m.mute !== undefined) ln.mute = !!m.mute;
        if (m.keep !== undefined) ln.keep = !!m.keep;
        if (m.fit !== undefined) ln.fit = !!m.fit;
        break;

      case 'lanebuf':
        ln = this.lanes[m.i];
        ln.buf = { l: m.l, r: m.r || m.l, len: m.l.length };
        if (m.slices) ln.slices = m.slices;
        if (m.sliced !== undefined) ln.sliced = !!m.sliced;
        break;

      case 'events':
        ln = this.lanes[m.i];
        for (i = 0; i < NSTEP; i++) {
          ln.ev.slice[i] = m.slice[i];
          ln.ev.vel[i] = m.vel[i];
          ln.ev.pitch[i] = m.pitch[i];
          ln.ev.rev[i] = m.rev[i];
          ln.ev.rtg[i] = m.rtg[i] || 1;
          ln.ev.racc[i] = m.racc[i];
          ln.ev.fx[i] = m.fx[i];
          ln.ev.fxa[i] = m.fxa[i];
        }
        break;

      case 'rewrite':
        this.rw.on = !!m.on;
        if (m.amt !== undefined) this.rw.amt = m.amt;
        if (m.flags) {
          for (var k in m.flags) if (this.rw.hasOwnProperty(k)) this.rw[k] = !!m.flags[k];
        }
        if (!this.rw.on) this.dropLeft = 0;
        break;

      case 'fx':
        this.chains[m.target].setPad(m.id, true, m.on, this.clk);
        if (m.x !== undefined) this.chains[m.target].setXY(m.id, m.x, m.y, this.clk);
        break;
      case 'fxxy':
        this.chains[m.target].setXY(m.id, m.x, m.y, this.clk);
        break;
      case 'fxrnd':
        this.chains[m.target].fx[m.id].rnd = !!m.on;
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
        this.dropLeft = 0;
        this.allNotesOff();
        break;
      case 'trig':
        this.preview(m.i, m.step === undefined ? -1 : m.step);
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
    for (var t = 0; t < NLANE; t++) {
      var ln = this.lanes[t];
      for (var i = 0; i < ln.voices.length; i++) ln.voices[i].on = false;
      ln.rtgN = 0;
    }
  };

  FunsaiEngine.prototype.resync = function () {
    this.phase = 0;
    this.gAcc = 0;
    this.gStep = -1;
    for (var t = 0; t < NLANE; t++) {
      var ln = this.lanes[t];
      ln.acc = 0;
      ln.step = -1;
      ln.effLen = ln.len;
      ln.rtgN = 0;
    }
  };

  FunsaiEngine.prototype.preview = function (i, step) {
    var ln = this.lanes[i];
    if (!ln.buf) return;
    var e = this.tmp;
    if (step >= 0) {
      e.slice = ln.ev.slice[step] < 0 ? 0 : ln.ev.slice[step];
      e.vel = ln.ev.vel[step] || 3;
      e.pitch = ln.ev.pitch[step];
      e.rev = ln.ev.rev[step];
      e.fx = ln.ev.fx[step];
      e.fxa = ln.ev.fxa[step];
    } else {
      e.slice = 0; e.vel = 3; e.pitch = 0; e.rev = 0; e.fx = 0; e.fxa = 0;
    }
    this.fire(ln, e, this.clk.spb * 0.25);
  };

  /* --- firing a hit -------------------------------------------------- */

  /* `reuse` makes the hit take over one specific voice instead of a free
     one. A retrigger is monophonic -- each repeat cuts the one before it --
     otherwise 16 overlapping copies comb-filter into a smear rather than
     the impulse train that turns into a pitch as it speeds up. */
  FunsaiEngine.prototype.fire = function (ln, e, stepDur, reuse) {
    if (!ln.buf || ln.mute) return null;
    if (this.dropLeft > 0 && !ln.keep) return null;
    var v = reuse || ln.alloc();
    var s0, end, rate;

    if (ln.sliced) {
      var sliceLen = ln.buf.len / ln.slices;
      var idx = e.slice;
      if (idx < 0) return null;
      idx = idx % ln.slices;
      s0 = Math.floor(idx * sliceLen);
      end = Math.min(ln.buf.len - 2, s0 + Math.ceil(sliceLen));
      rate = ln.fit ? (sliceLen / stepDur) : 1;
    } else {
      s0 = 0;
      end = ln.buf.len - 2;
      rate = 1;
    }
    if (end <= s0 + 2) return null;

    rate *= Math.pow(2, e.pitch / 12);

    v.on = true;
    v.bl = ln.buf.l;
    v.br = ln.buf.r;
    v.s0 = s0;
    v.end = end;
    v.gain = ln.gain * (0.34 + e.vel * 0.22);
    var pan = ln.pan;
    v.pl = Math.cos((pan + 1) * Math.PI / 4);
    v.pr = Math.sin((pan + 1) * Math.PI / 4);
    v.age = 0;
    v.fx = e.fx;
    v.fxa = e.fxa;
    v.cCnt = 0; v.cL = 0; v.cR = 0;
    v.fL = 0; v.fR = 0;
    v.rph = 0;
    v.stopK = 1;
    /* Hard lifetime. STOP freezes the playhead and SKIP rewinds it, so
       neither would ever reach `end` -- without this the voice never frees
       and the slots fill up with silent or repeating hits. */
    v.life = Math.ceil((end - s0) / Math.max(0.02, Math.abs(rate))) + 256;
    v.seed = (Math.imul(this.seed ^ (s0 + 1), 1664525) + 1013904223) | 0;

    /* per hit effect setup */
    if (e.fx === 5) {            // tape stop inside the hit
      var stopSamples = Math.max(64, (1 - e.fxa / 16) * stepDur * 2 + 256);
      v.stopD = Math.exp(-1 / stopSamples);
    } else if (e.fx === 6) {     // skip / CD stutter
      v.skipLen = Math.max(32, Math.floor(stepDur / (1 + e.fxa)));
      v.skipJump = v.skipLen * (e.fxa % 2 === 0 ? 1 : -1) * 2;
      v.skipAcc = 0;
    }

    if (e.rev) {
      v.pos = end - 1;
      v.rate = -rate;
    } else {
      v.pos = s0;
      v.rate = rate;
    }
    return v;
  };

  FunsaiEngine.prototype.renderVoice = function (v) {
    var p = v.pos;
    if (p < v.s0 || p >= v.end || v.life <= 0) { v.on = false; this.vl = 0; this.vr = 0; return; }
    v.life--;
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

    /* ---- per hit destruction ---------------------------------------- */
    var fx = v.fx;
    if (fx === 1) {                                   // crush
      var hold = 1 + v.fxa * 5;
      v.cCnt++;
      if (v.cCnt >= hold) {
        v.cCnt = 0;
        var bits = Math.max(1, 12 - v.fxa * 0.7);
        var q = Math.pow(2, bits - 1);
        v.cL = Math.round(sl * q) / q;
        v.cR = Math.round(sr2 * q) / q;
      }
      sl = v.cL; sr2 = v.cR;
    } else if (fx === 2) {                            // drive / fold
      var d = 1.4 + v.fxa * 5;
      sl = fold(sl * d) * 0.6;
      sr2 = fold(sr2 * d) * 0.6;
    } else if (fx === 3) {                            // darkening filter
      var a = onePole(120 * Math.pow(2, v.fxa * 0.55), this.sr);
      v.fL += (sl - v.fL) * a;
      v.fR += (sr2 - v.fR) * a;
      sl = v.fL; sr2 = v.fR;
    } else if (fx === 4) {                            // ring
      var rf = 18 * Math.pow(2, v.fxa * 0.62);
      v.rph += rf / this.sr;
      if (v.rph >= 1) v.rph -= 1;
      var mm = Math.sin(v.rph * TAU);
      sl *= mm; sr2 *= mm;
    }

    /* advance */
    var rate = v.rate;
    if (fx === 5) {
      v.stopK *= v.stopD;
      rate *= v.stopK;
      var mg = v.stopK;
      if (mg < 0.05) env *= mg * 20;
    }
    v.pos += rate;
    if (fx === 6) {
      v.skipAcc++;
      if (v.skipAcc >= v.skipLen) {
        v.skipAcc = 0;
        var span = v.end - v.s0;
        var rel = (v.pos + v.skipJump) - v.s0;
        rel = ((rel % span) + span) % span;     // wrap, never pile on the attack
        v.pos = v.s0 + rel;
      }
    }
    v.age++;
    this.vl = sl * env * v.pl;
    this.vr = sr2 * env * v.pr;
  };

  /* --- the rewrite engine -------------------------------------------- *
   * Rather than replaying the stored pattern, decide what this step is
   * as it fires. The stored events stay untouched, so switching rewrite
   * off returns to what is written in the tracker.
   */
  FunsaiEngine.prototype.evalStep = function (ln, s) {
    var e = ln.ev;
    var o = this.tmp;
    o.slice = e.slice[s];
    o.vel = e.vel[s];
    o.pitch = e.pitch[s];
    o.rev = e.rev[s];
    o.rtg = e.rtg[s] || 1;
    o.racc = e.racc[s];
    o.fx = e.fx[s];
    o.fxa = e.fxa[s];

    var rw = this.rw;
    if (!rw.on) return o;
    var a = rw.amt;

    if (rw.slice) {
      if (o.slice >= 0 && ln.sliced && this.rnd() < a * 0.55) {
        o.slice = Math.floor(this.rnd() * ln.slices);
      } else if (o.slice < 0 && this.rnd() < a * 0.22) {
        o.slice = ln.sliced ? Math.floor(this.rnd() * ln.slices) : 0;
        o.vel = this.rnd() < 0.6 ? 2 : 3;
      }
    }
    if (rw.rest && o.slice >= 0 && this.rnd() < a * 0.16) o.slice = -1;
    if (o.slice < 0) return o;

    if (rw.pitch && this.rnd() < a * 0.45) {
      o.pitch = RW_PITCH[Math.floor(this.rnd() * RW_PITCH.length)];
    }
    if (rw.rev && this.rnd() < a * 0.18) o.rev = 1;
    if (rw.rtg && this.rnd() < a * 0.3) {
      o.rtg = RW_RTG[Math.floor(this.rnd() * RW_RTG.length)];
      o.racc = Math.floor(this.rnd() * 9) - 4;
    }
    if (rw.fx && this.rnd() < a * 0.35) {
      o.fx = 1 + Math.floor(this.rnd() * 6);
      o.fxa = Math.floor(this.rnd() * 16);
    }
    return o;
  };

  /* start a step: either one hit or a retrigger burst */
  FunsaiEngine.prototype.startStep = function (ln, e, stepDur) {
    if (e.slice < 0) { ln.rtgN = 0; return; }
    var n = clamp(e.rtg | 0, 1, 32);
    if (n <= 1) {
      ln.rtgN = 0;
      this.fire(ln, e, stepDur);
      return;
    }
    /* intervals follow a geometric series that exactly fills the step, so
       a positive racc tightens the burst into a pitched buzz and a
       negative one lets it tumble open. */
    var k = Math.pow(2, -e.racc / 5);
    var sum;
    if (Math.abs(k - 1) < 1e-6) { k = 1; sum = n; }
    else sum = (1 - Math.pow(k, n)) / (1 - k);

    ln.rtgN = n;
    ln.rtgIdx = 0;
    ln.rtgK = k;
    ln.rtgSum = sum;
    ln.rtgTotal = stepDur;
    ln.rtgAcc = 0;
    ln.rtgDur = Math.max(24, stepDur / sum);
    var re = ln.rtgEv;
    re.slice = e.slice; re.vel = e.vel; re.pitch = e.pitch;
    re.rev = e.rev; re.fx = e.fx; re.fxa = e.fxa;
    /* rate always comes from the STEP length, never the burst interval:
       a retrigger repeats the same hit, it does not play the slice n times
       faster (which would just transpose it n octaves up). Each repeat is
       cut off by the next one through voice stealing. */
    ln.rtgV = this.fire(ln, re, stepDur);
  };

  FunsaiEngine.prototype.advanceRtg = function (ln) {
    if (ln.rtgN <= 0) return;
    ln.rtgAcc++;
    if (ln.rtgAcc < ln.rtgDur) return;
    ln.rtgAcc -= ln.rtgDur;
    ln.rtgIdx++;
    if (ln.rtgIdx >= ln.rtgN) { ln.rtgN = 0; return; }
    ln.rtgDur = Math.max(24, ln.rtgTotal * Math.pow(ln.rtgK, ln.rtgIdx) / ln.rtgSum);
    ln.rtgV = this.fire(ln, ln.rtgEv, ln.rtgTotal, ln.rtgV);
  };

  /* advance the sequencers by one sample */
  FunsaiEngine.prototype.clockSample = function () {
    var clk = this.clk;
    var stepDur = clk.spb * 0.25 / this.timeMul;
    var sw = this.swing * 0.34;

    this.phase++;
    if (this.phase >= clk.barLen) {
      this.phase -= clk.barLen;
      /* half / double time only switches on a bar line */
      if (this.timeMul !== this.timeMulWant) this.timeMul = this.timeMulWant;
      if (this.rw.on && this.rw.half && this.rnd() < this.rw.amt * 0.18) {
        var opts = [0.5, 1, 1, 2];
        this.timeMul = this.timeMulWant = opts[Math.floor(this.rnd() * opts.length)];
      }
    }
    clk.barPhase = this.phase;

    /* global 16th, drives auto chaos, drops and the R switch */
    this.gAcc++;
    if (this.gAcc >= stepDur) {
      this.gAcc -= stepDur;
      this.gStep = (this.gStep + 1) & 15;
      if (this.dropLeft > 0) this.dropLeft--;
      if (this.rw.on && this.rw.drop && this.dropLeft <= 0 && this.rnd() < this.rw.amt * 0.03) {
        this.dropLeft = 2 + Math.floor(this.rnd() * 14);
      }
      for (var c = 0; c < 5; c++) this.chains[c].stepRandom(clk);
      this.autoStep();
    }

    for (var t = 0; t < NLANE; t++) {
      var ln = this.lanes[t];
      this.advanceRtg(ln);
      var sd = stepDur / ln.res;
      var d = ln.res === 1 ? sd * (((ln.step + 1) & 1) ? (1 - sw) : (1 + sw)) : sd;
      ln.acc++;
      if (ln.acc >= d) {
        ln.acc -= d;
        var nx = ln.step + 1;
        if (nx >= ln.effLen) {
          nx = 0;
          /* meter change lands on the cycle boundary */
          if (this.rw.on && this.rw.meter && this.rnd() < this.rw.amt * 0.3) {
            var pick = RW_METER[Math.floor(this.rnd() * RW_METER.length)];
            ln.effLen = pick === 0 ? ln.len : clamp(pick, 1, ln.len);
          } else {
            ln.effLen = ln.len;
          }
        }
        ln.step = nx;
        this.startStep(ln, this.evalStep(ln, nx), sd);
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

    var target = 4;
    if (this.rnd() < amt * 0.5) target = Math.floor(this.rnd() * NLANE);

    /* if any pad on this bus has its R switch on, auto only picks from
       those: the R switches double as "which effects may fire by itself" */
    var pool = [];
    var ch = this.chains[target];
    for (i = 0; i < PADS.length; i++) if (ch.fx[PADS[i]].rnd) pool.push(PADS[i]);
    if (!pool.length) pool = PADS;

    var id = pool[Math.floor(this.rnd() * pool.length)];
    for (i = 0; i < this.autoHeld.length; i++) {
      if (this.autoHeld[i].id === id && this.autoHeld[i].target === target) return;
    }
    var x = this.rnd();
    var y = this.rnd();
    var left = 1 + Math.floor(this.rnd() * (1 + amt * 7));
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

      for (var t = 0; t < NLANE; t++) {
        var ln = this.lanes[t];
        var tl = 0, tr = 0;
        for (var j = 0; j < ln.voices.length; j++) {
          if (!ln.voices[j].on) continue;
          this.renderVoice(ln.voices[j]);
          tl += this.vl;
          tr += this.vr;
        }
        /* role band: two one poles each side, cheap but decisive enough to
           keep a low drummer and a hat drummer out of each other's way */
        if (ln.hpA > 0) {
          ln.hp1L += (tl - ln.hp1L) * ln.hpA; var t1 = tl - ln.hp1L;
          ln.hp2L += (t1 - ln.hp2L) * ln.hpA; tl = t1 - ln.hp2L;
          ln.hp1R += (tr - ln.hp1R) * ln.hpA; var t2 = tr - ln.hp1R;
          ln.hp2R += (t2 - ln.hp2R) * ln.hpA; tr = t2 - ln.hp2R;
        }
        if (ln.lpA > 0) {
          ln.lp1L += (tl - ln.lp1L) * ln.lpA;
          ln.lp2L += (ln.lp1L - ln.lp2L) * ln.lpA;
          tl = ln.lp2L;
          ln.lp1R += (tr - ln.lp1R) * ln.lpA;
          ln.lp2R += (ln.lp1R - ln.lp2R) * ln.lpA;
          tr = ln.lp2R;
        }
        if (ln.makeup !== 1) { tl *= ln.makeup; tr *= ln.makeup; }
        var ch = this.chains[t];
        ch.process(tl, tr, clk);
        mixL += ch.outL;
        mixR += ch.outR;
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
      var c;
      for (c = 0; c < 5; c++) { peaks[c] = this.chains[c].peak; this.chains[c].peak = 0; }
      var rq = null;
      for (c = 0; c < 5; c++) {
        var q = this.chains[c].rndq;
        if (!q.length) continue;
        if (!rq) rq = [];
        for (var z = 0; z < q.length; z++) {
          rq.push({ t: c, id: q[z], x: this.chains[c].fx[q[z]].x, y: this.chains[c].fx[q[z]].y });
        }
        q.length = 0;
      }
      this.port.postMessage({
        type: 'pos',
        steps: [this.lanes[0].step, this.lanes[1].step, this.lanes[2].step, this.lanes[3].step],
        eff: [this.lanes[0].effLen, this.lanes[1].effLen, this.lanes[2].effLen, this.lanes[3].effLen],
        peaks: peaks,
        drop: this.dropLeft > 0,
        mul: this.timeMul,
        rnd: rq
      });
    }
    return true;
  };

  registerProcessor('funsai-engine', FunsaiEngine);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { funsaiWorkletCode: funsaiWorkletCode };
