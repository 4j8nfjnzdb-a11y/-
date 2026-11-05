// ---------------------------------------------------------------------------
// Liquid: the WebGL2 engine. Two velocity fields share the work:
//  - the bulk flow (incompressible, swirls, carries momentum: stirring, combs,
//    magnet and tilt forces, the turntable), solved with a pressure projection;
//  - the film flow (compressible, no memory): a Darcy/Hele-Shaw push from drops,
//    bubbles and ice, with mobility set by what is there (alcohol is runny, paint
//    is thick, so alcohol fingers into paint), plus a Marangoni pull away from
//    solvent and the turntable's spin-off. Paint piles up where it converges.
// ---------------------------------------------------------------------------
class Liquid {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    const hasF = gl.getExtension('EXT_color_buffer_float');
    const hasH = gl.getExtension('EXT_color_buffer_half_float');
    if (!hasF && !hasH) throw new Error('float-targets');
    gl.getExtension('OES_texture_float_linear');
    this.time = 0;
    this.quality = 1;
    this.params = {
      damp: 0.9, curl: 10, kp: 1.0, kw: 5.0, ka: 45, shear: 2.0, noise: 1.5, qs: 4.0, qm: 3.0, pdKeep: 0.9, slide: 0.12, couple: 2.2,
      evap: 0.1, pushDecay: 3.2, ferroMob: 0.0, kelvin: 0.0, kf: 400, sharp: 2.2, spread: 1.4, crisp: 0.85,
      spin: 0, spinDrag: 0.7, spin2: 0, grav: [0, 0], opac: 2.6, gloss: 9, relief: 0.0042, refr: 0.012,
      blur: 0.0, bloom: 0.5, vig: 1.0, grain: 0.018, dish: [0.006, 0.006, 0.008], pressIters: 22, darcyIters: 26,
    };
    this.focus = [0.5, 0.5];
    this.focusT = [0.5, 0.5];
    this.mag = [0, 0, 0, 0.004];
    this.queue = [];
    this.bubbleData = new Float32Array(SH.MAXB * 8);
    this.nBubbles = 0;
    this.kqBub = new Float32Array(SH.MAXB * 4); this.nKqBub = 0;
    this.ice = new Float32Array(SH.MAXI * 4); this.iceB = new Float32Array(SH.MAXI * 4); this.iceQ = new Float32Array(SH.MAXI * 4); this.nIce = 0;
    this._build();
  }

  // ---- programs ---------------------------------------------------------
  _compile(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(log, src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      throw new Error('shader: ' + log);
    }
    return s;
  }
  _program(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aB');
    gl.bindAttribLocation(p, 2, 'aC');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
    }
    return { p, u };
  }
  _build() {
    const gl = this.gl;
    this.prog = {};
    for (const k of Object.keys(SH.FS)) this.prog[k] = this._program(k === 'bubble' ? SH.BUB_VS : SH.VS, SH.FS[k]);
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // bubbles: instanced quads
    this.bubVao = gl.createVertexArray();
    gl.bindVertexArray(this.bubVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.bubBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bubBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.bubbleData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  // ---- textures & framebuffers -------------------------------------------
  _tex(w, h, half = true, mip = false) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }
  _fbo(texs, w, h) {
    const gl = this.gl, fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo ' + st);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { fb, t: texs, w, h };
  }
  _single(w, h, half = true) { return this._fbo([this._tex(w, h, half)], w, h); }
  _double(w, h, n = 1) {
    const mk = () => this._fbo(Array.from({ length: n }, () => this._tex(w, h)), w, h);
    const d = { read: mk(), write: mk(), swap() { const x = this.read; this.read = this.write; this.write = x; } };
    return d;
  }
  _free(f) { if (!f) return; const gl = this.gl; if (f.read) { this._free(f.read); this._free(f.write); return; } f.t.forEach(t => gl.deleteTexture(t)); gl.deleteFramebuffer(f.fb); }

  resize(cssW, cssH, dpr) {
    const gl = this.gl;
    const Q = [{ sim: 104, dye: 400, dpr: 1 }, { sim: 136, dye: 600, dpr: 1.6 }, { sim: 176, dye: 860, dpr: 2 }][this.quality];
    const r = Math.min(dpr, Q.dpr);
    const cw = Math.max(2, Math.round(cssW * r)), ch = Math.max(2, Math.round(cssH * r));
    const aspect = cssW / cssH;
    const dims = base => aspect >= 1 ? [Math.round(base * aspect), base] : [base, Math.round(base / aspect)];
    const [sw, sh] = dims(Q.sim), [dw, dh] = dims(Q.dye);
    const simChanged = !this.vel || sw !== this.sw || sh !== this.sh;
    const dyeChanged = !this.paint || dw !== this.dw || dh !== this.dh;
    this.canvas.width = cw; this.canvas.height = ch;
    this.cw = cw; this.ch = ch; this.aspect = aspect;
    if (simChanged) {
      const old = this.vel;
      this.sw = sw; this.sh = sh;
      this.vel = this._double(sw, sh);
      if (old) { this._run('copy', this.vel.write, { uT: old.read.t[0] }); this.vel.swap(); }
      [this.pres, this.pd, this.kqF, this.surf, this.divF, this.curlF].forEach(f => this._free(f));
      this._free(old);
      this.pres = this._double(sw, sh); this.pd = this._double(sw, sh);
      this.kqF = this._single(sw, sh); this.surf = this._single(sw, sh);
      this.divF = this._single(sw, sh); this.curlF = this._single(sw, sh);
      const rh = 36, rw = Math.max(8, Math.round(36 * aspect));
      this._free(this.rb);
      this.rb = this._single(rw, rh, false);
      this.rbData = new Uint8Array(rw * rh * 4); this.rbW = rw; this.rbH = rh; this.rbReady = false;
      if (this.pbo) gl.deleteBuffer(this.pbo);
      this.pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, rw * rh * 4, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.sync = null;
    }
    if (dyeChanged) {
      const old = this.paint;
      this.dw = dw; this.dh = dh;
      this.paint = this._double(dw, dh, 3);
      if (old) { this._run('copyPaint', this.paint.write, { uD0: old.read.t[0], uD1: old.read.t[1], uAux: old.read.t[2] }); this.paint.swap(); this._free(old); }
    }
    if (!this.comp || this.comp.w !== cw || this.comp.h !== ch) {
      this._free(this.comp);
      this.comp = this._fbo([this._tex(cw, ch, false, true)], cw, ch);
    }
  }

  // ---- running a pass --------------------------------------------------------
  _run(name, target, vals, vao) {
    const gl = this.gl, P = this.prog[name];
    gl.useProgram(P.p);
    if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, target.w, target.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.cw, this.ch); }
    let unit = 0;
    for (const k in vals) {
      const u = P.u[k]; if (!u) continue;
      const v = vals[k];
      switch (u.type) {
        case gl.SAMPLER_2D: gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v); gl.uniform1i(u.loc, unit++); break;
        case gl.FLOAT: gl.uniform1f(u.loc, v); break;
        case gl.INT: gl.uniform1i(u.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      }
    }
    if (vao) return;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---- inputs (queued, applied at the start of the next step) -----------------
  // a, b: segment ends in domain units; r: radius (domain)
  splatVel(a, b, r, force, radial = 0, swirl = 0) { this.queue.push({ k: 'v', a, b, r, force, radial, swirl }); }
  splatPaint(a, b, r, pig, amt, add, hard = 0.6) { this.queue.push({ k: 'p', a, b, r, pig, amt, add, hard }); }
  fill(pig, amt, variation = 0.12) { this.queue.push({ k: 'f', pig, amt, variation }); }

  _applyQueue() {
    const asp = this.aspect, q = this.queue;
    const V = this._vb || (this._vb = { v0: new Float32Array(64), v1: new Float32Array(64), v2: new Float32Array(64) });
    const S = this._sb || (this._sb = { s0: new Float32Array(64), s1: new Float32Array(64), c0: new Float32Array(64), c1: new Float32Array(64), add: new Float32Array(64) });
    let nv = 0, np = 0;
    const flushV = () => {
      if (!nv) return;
      this._run('splatVel', this.vel.write, { uVel: this.vel.read.t[0], uN: nv, uV0: V.v0, uV1: V.v1, uV2: V.v2, uAspect: asp });
      this.vel.swap(); nv = 0;
    };
    const flushP = () => {
      if (!np) return;
      const P = this.paint.read.t;
      this._run('splatPaint', this.paint.write, { uD0: P[0], uD1: P[1], uAux: P[2], uN: np, uS0: S.s0, uS1: S.s1, uC0: S.c0, uC1: S.c1, uAdd: S.add, uAspect: asp });
      this.paint.swap(); np = 0;
    };
    const Z = [0, 0, 0, 0];
    for (const s of q) {
      if (s.k === 'v') {
        const o = nv * 4;
        V.v0.set([s.a[0], s.a[1], s.b[0], s.b[1]], o);
        V.v1.set([s.r * s.r, s.radial, s.swirl, 0], o);
        V.v2.set([s.force[0], s.force[1], 0, 0], o);
        if (++nv === 16) flushV();
      } else if (s.k === 'p') {
        const o = np * 4;
        S.s0.set([s.a[0], s.a[1], s.b[0], s.b[1]], o);
        S.s1.set([s.r * s.r, s.amt, s.hard, Math.random() * 100], o);
        S.c0.set(s.pig ? s.pig.c0 : Z, o); S.c1.set(s.pig ? s.pig.c1 : Z, o); S.add.set(s.add || Z, o);
        if (++np === 16) flushP();
      } else if (s.k === 'f') {
        flushP();
        this._run('fill', this.paint.write, { uAspect: asp, uAmt: s.amt, uVar: s.variation, uSeed: Math.random() * 50, uC0: s.pig ? s.pig.c0 : Z, uC1: s.pig ? s.pig.c1 : Z });
        this.paint.swap();
        flushV(); this._run('scale', this.vel.write, { uT: this.vel.read.t[0], uK: 0 }); this.vel.swap();
        this._run('scale', this.pd.write, { uT: this.pd.read.t[0], uK: 0 }); this.pd.swap();
      }
    }
    flushV(); flushP();
    q.length = 0;
  }

  setBubbles(list, aspect) {
    // list: [{x,y,r,life,seed,thick,pop,alpha,press}]
    const n = Math.min(list.length, SH.MAXB);
    const d = this.bubbleData, k = this.kqBub;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const b = list[i], o = i * 8;
      d[o] = b.x; d[o + 1] = b.y; d[o + 2] = b.r; d[o + 3] = b.life; d[o + 4] = b.seed; d[o + 5] = b.thick; d[o + 6] = b.pop; d[o + 7] = b.alpha;
      if (b.pop <= 0 && b.press > 0) { k[m * 4] = b.x; k[m * 4 + 1] = b.y; k[m * 4 + 2] = b.r * 0.92; k[m * 4 + 3] = b.press; m++; }
    }
    this.nBubbles = n; this.nKqBub = m;
  }
  setIce(list) {
    const n = Math.min(list.length, SH.MAXI);
    for (let i = 0; i < n; i++) {
      const c = list[i], o = i * 4;
      this.ice.set([c.x, c.y, c.s, c.rot], o);
      this.iceB.set([c.round, c.h, c.seed, c.alpha], o);
      this.iceQ.set([c.x, c.y, c.s * 1.55, c.q], o);
    }
    this.nIce = n;
  }

  // ---- one simulation step ------------------------------------------------------
  step(dt) {
    const gl = this.gl, P = this.params, asp = this.aspect;
    this.time += dt;
    gl.disable(gl.BLEND);
    this._applyQueue();
    const simTexel = [1 / this.sw, 1 / this.sh], H = 1 / this.sh;
    const paint = () => this.paint.read.t;
    // film flow
    this._run('kq', this.kqF, {
      uD1: paint()[1], uAux: paint()[2], uSurf: this.surf.t[0], uBub: this.kqBub, uNB: this.nKqBub, uIce: this.iceQ, uNI: this.nIce,
      uKp: P.kp, uKw: P.kw, uKa: P.ka, uShear: P.shear, uNoise: P.noise, uQs: P.qs, uQm: P.qm, uAspect: asp, uKf: P.kf, uH: 1 / this.sh, uMag: this.mag,
    });
    // let old push fade, so the film only moves while something is pushing
    this._run('scale', this.pd.write, { uT: this.pd.read.t[0], uK: P.pdKeep }); this.pd.swap();
    const iters = this.mag[2] > 0.01 ? Math.max(P.darcyIters, 80) : P.darcyIters;
    for (let i = 0; i < iters; i++) {
      this._run('darcy', this.pd.write, { uP: this.pd.read.t[0], uKQ: this.kqF.t[0], uTexel: simTexel });
      this.pd.swap();
    }
    this._run('surf', this.surf, { uP: this.pd.read.t[0], uKQ: this.kqF.t[0], uAux: paint()[2], uD1: paint()[1], uTexel: simTexel, uH: H, uSpin2: P.spin2, uAspect: asp });
    // bulk flow
    this._run('forces', this.vel.write, {
      uVel: this.vel.read.t[0], uSurf: this.surf.t[0], uAux: paint()[2], uD1: paint()[1], uDt: dt, uAspect: asp, uTexel: simTexel,
      uMag: this.mag, uKelvin: P.kelvin, uGrav: P.grav, uSpin: P.spin, uSpinDrag: P.spinDrag, uCouple: P.couple, uDamp: P.damp,
    });
    this.vel.swap();
    if (P.curl > 0) {
      this._run('curl', this.curlF, { uVel: this.vel.read.t[0], uTexel: simTexel });
      this._run('vorticity', this.vel.write, { uVel: this.vel.read.t[0], uCurl: this.curlF.t[0], uTexel: simTexel, uCurlK: P.curl, uDt: dt });
      this.vel.swap();
    }
    this._run('divergence', this.divF, { uVel: this.vel.read.t[0], uTexel: simTexel });
    this._run('scale', this.pres.write, { uT: this.pres.read.t[0], uK: 0.8 }); this.pres.swap();
    for (let i = 0; i < P.pressIters; i++) {
      this._run('pressure', this.pres.write, { uP: this.pres.read.t[0], uDiv: this.divF.t[0], uTexel: simTexel });
      this.pres.swap();
    }
    this._run('gradSub', this.vel.write, { uP: this.pres.read.t[0], uVel: this.vel.read.t[0], uTexel: simTexel });
    this.vel.swap();
    this._run('advectVel', this.vel.write, { uVel: this.vel.read.t[0], uSurf: this.surf.t[0], uDt: dt, uAspect: asp });
    this.vel.swap();
    // paint
    this._run('advectPaint', this.paint.write, {
      uVel: this.vel.read.t[0], uSurf: this.surf.t[0], uD0: paint()[0], uD1: paint()[1], uAux: paint()[2],
      uDyeSize: [this.dw, this.dh], uSimTexel: simTexel, uDt: dt, uAspect: asp, uH: H,
      uEvap: P.evap, uPushDecay: P.pushDecay, uFerroMob: P.ferroMob, uSharp: P.sharp, uSpread: P.spread, uCrisp: P.crisp, uMag: this.mag,
    });
    this.paint.swap();
  }

  // ---- drawing -------------------------------------------------------------------
  render() {
    const gl = this.gl, P = this.params, asp = this.aspect, T = this.paint.read.t;
    this.focus[0] += (this.focusT[0] - this.focus[0]) * 0.05;
    this.focus[1] += (this.focusT[1] - this.focus[1]) * 0.05;
    gl.disable(gl.BLEND);
    this._run('display', this.comp, {
      uD0: T[0], uD1: T[1], uAux: T[2], uDish: P.dish, uOpac: P.opac, uDyeTexel: [1 / this.dw, 1 / this.dh], uAspect: asp, uTime: this.time,
      uGloss: P.gloss, uRelief: P.relief, uRefr: P.refr, uMag: this.mag, uIce: this.ice, uIceB: this.iceB, uNI: this.nIce,
    });
    if (this.nBubbles) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bubBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.bubbleData, 0, this.nBubbles * 8);
      this._run('bubble', this.comp, { uD0: T[0], uD1: T[1], uAux: T[2], uDish: P.dish, uOpac: P.opac, uAspect: asp, uTime: this.time, uGloss: P.gloss }, true);
      gl.bindVertexArray(this.bubVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nBubbles);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.comp.t[0]);
    gl.generateMipmap(gl.TEXTURE_2D);
    this._run('post', null, {
      uComp: this.comp.t[0], uRes: [this.cw, this.ch], uFocus: this.focus, uBlur: P.blur, uBloom: P.bloom, uTime: this.time, uAspect: asp, uVig: P.vig, uGrain: P.grain,
    });
  }

  // ---- slow CPU view of the flow (for bubbles, ice and the auto painter) ------------
  readback() {
    const gl = this.gl;
    if (this.sync) {
      const st = gl.getSyncParameter(this.sync, gl.SYNC_STATUS);
      if (st !== gl.SIGNALED) return;
      gl.deleteSync(this.sync); this.sync = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.rbData);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.rbReady = true;
    }
    const T = this.paint.read.t;
    this._run('readback', this.rb, { uVel: this.vel.read.t[0], uSurf: this.surf.t[0], uD1: T[1], uAux: T[2] });
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, this.rbW, this.rbH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  }
  // sample the CPU view at a domain point: [vx, vy, amount, ferro]
  sample(x, y) {
    if (!this.rbReady) return [0, 0, 1, 0];
    const W = this.rbW, Hh = this.rbH, d = this.rbData;
    const fx = Math.min(W - 1.001, Math.max(0, x / this.aspect * W - 0.5)), fy = Math.min(Hh - 1.001, Math.max(0, y * Hh - 0.5));
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const out = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const g = (i, j) => d[((iy + j) * W + ix + i) * 4 + c] / 255;
      out[c] = (g(0, 0) * (1 - tx) + g(1, 0) * tx) * (1 - ty) + (g(0, 1) * (1 - tx) + g(1, 1) * tx) * ty;
    }
    return [(out[0] - 0.5) * 6, (out[1] - 0.5) * 6, out[2] * 3, out[3]];
  }
}
