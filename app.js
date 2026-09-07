// EMULSION — turns video/photo input into light, noise and drifting particles.
// Pipeline: media -> 2D source canvas -> WebGL feedback/grain/scratch shader -> additive particle points.

(() => {
  'use strict';

  const SRC_W = 640, SRC_H = 360;
  const SAMPLE_W = 96, SAMPLE_H = 54;
  const MAX_PARTICLES = 3200;

  const glCanvas = document.getElementById('gl');
  const gl = glCanvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true })
    || glCanvas.getContext('experimental-webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });

  if (!gl) {
    document.body.innerHTML = '<p style="color:#eee;font-family:sans-serif;padding:2rem;">このブラウザは WebGL に対応していません。</p>';
    return;
  }

  // ---------- shader helpers ----------
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      throw new Error('shader compile failed');
    }
    return sh;
  }

  function program(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
      throw new Error('program link failed');
    }
    return p;
  }

  const QUAD_VS = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const COMPOSITE_FS = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uSource;
    uniform sampler2D uFeedback;
    uniform float uTime;
    uniform float uSeed;
    uniform sampler2D uScratchTex;
    uniform float uFlickerSlot;
    uniform float uTrail;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uScratch;
    uniform float uFlicker;
    uniform float uDriftAngle;
    uniform float uDriftScale;
    uniform float uAspect;
    uniform int uColorMode;
    uniform vec3 uShadow;
    uniform vec3 uHigh;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float ca = uAberration * 0.012;
      float r = texture2D(uSource, uv + dir * ca).r;
      float g = texture2D(uSource, uv).g;
      float b = texture2D(uSource, uv - dir * ca).b;
      vec3 src = vec3(r, g, b);

      vec2 fc = uv - 0.5;
      float ang = uDriftAngle;
      mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      vec2 fbUv = rot * fc * uDriftScale + 0.5;
      vec3 fb = vec3(0.0);
      if (fbUv.x > 0.0 && fbUv.x < 1.0 && fbUv.y > 0.0 && fbUv.y < 1.0) {
        fb = texture2D(uFeedback, fbUv).rgb;
      }

      vec3 col = src * (1.0 - uTrail * 0.55) + fb * uTrail;

      float grainN = hash(uv * vec2(640.0, 360.0) + uSeed) - 0.5;
      col += grainN * uGrain * 0.5;

      vec2 sUv = vec2(uv.x * uAspect, uv.y);
      float sh = texture2D(uScratchTex, vec2(sUv.x, 0.5)).r;
      float scratchOn = step(1.0 - uScratch * 0.5, sh);
      float within = smoothstep(0.5, 0.0, abs(fract(sUv.x * 260.0) - 0.5) * 2.0);
      float scratch = scratchOn * within * (0.6 + 0.4 * hash(vec2(sh * 97.0, sUv.x)));
      col += scratch * vec3(1.0, 0.97, 0.9);

      float flickerN = hash(vec2(uFlickerSlot, 7.0));
      float flick = 1.0 - uFlicker * 0.5 * flickerN;
      col *= flick;

      float vig = smoothstep(0.98, 0.25, length(fc * vec2(1.0, 1.0)));
      col *= mix(0.55, 1.0, vig);

      if (uColorMode == 1) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = vec3(l);
      } else if (uColorMode == 2) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(uShadow, uHigh, clamp(l, 0.0, 1.0));
      } else if (uColorMode == 3) {
        col = 1.0 - col;
      }

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  const COPY_FS = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    void main() {
      gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
    }
  `;

  const PARTICLE_VS = `
    attribute vec2 aPos;
    attribute float aSize;
    attribute vec4 aColor;
    varying vec4 vColor;
    void main() {
      vColor = aColor;
      gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
      gl_PointSize = aSize;
    }
  `;

  const PARTICLE_FS = `
    precision mediump float;
    varying vec4 vColor;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float dist = length(d) * 2.0;
      float a = smoothstep(1.0, 0.0, dist);
      a = pow(a, 1.6) * vColor.a;
      gl_FragColor = vec4(vColor.rgb * a, a);
    }
  `;

  const compositeProg = program(QUAD_VS, COMPOSITE_FS);
  const copyProg = program(QUAD_VS, COPY_FS);
  const particleProg = program(PARTICLE_VS, PARTICLE_FS);

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  function drawQuad(prog) {
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---------- textures & FBOs ----------
  function makeTexture(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }

  function makeFBO(w, h) {
    const tex = makeTexture(w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  const sourceTex = makeTexture(SRC_W, SRC_H);

  // Scratch pattern is genuine JS-side randomness uploaded as a 1D texture — a
  // GLSL hash fed integer column/slot indices produces a low-discrepancy (evenly
  // spaced, not random-looking) sequence, which read as a rigid grid on screen.
  const SCRATCH_TEX_W = 400;
  const scratchTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, scratchTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const scratchData = new Uint8Array(SCRATCH_TEX_W);
  function randomizeScratchTex() {
    for (let i = 0; i < SCRATCH_TEX_W; i++) scratchData[i] = (Math.random() * 256) | 0;
    gl.bindTexture(gl.TEXTURE_2D, scratchTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, SCRATCH_TEX_W, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, scratchData);
  }
  randomizeScratchTex();

  let fboA, fboB;
  let readFBO, writeFBO;

  function rebuildFBOs() {
    const w = glCanvas.width, h = glCanvas.height;
    fboA = makeFBO(w, h);
    fboB = makeFBO(w, h);
    readFBO = fboA;
    writeFBO = fboB;
  }

  // ---------- resize ----------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
      rebuildFBOs();
    }
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- source canvas (2D) ----------
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = SRC_W; srcCanvas.height = SRC_H;
  const srcCtx = srcCanvas.getContext('2d');

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = SAMPLE_W; sampleCanvas.height = SAMPLE_H;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  let sampleData = null;

  function drawCover(ctx, media, mw, mh, dw, dh) {
    const scale = Math.max(dw / mw, dh / mh);
    const sw = dw / scale, sh = dh / scale;
    const sx = (mw - sw) / 2, sy = (mh - sh) / 2;
    ctx.drawImage(media, sx, sy, sw, sh, 0, 0, dw, dh);
  }

  // ---------- media state ----------
  const state = {
    mode: 'sample',        // 'sample' | 'video' | 'photo'
    sampleName: 'waves',
    videoEl: null,
    photoImg: null,
    playing: true,
    stream: null,
  };

  const videoEl = document.createElement('video');
  videoEl.loop = true;
  videoEl.muted = true;
  videoEl.playsInline = true;

  function stopWebcam() {
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
  }

  function loadVideoFile(file) {
    stopWebcam();
    const url = URL.createObjectURL(file);
    videoEl.src = url;
    videoEl.onloadeddata = () => { videoEl.play().catch(() => {}); };
    state.mode = 'video';
    state.videoEl = videoEl;
    state.playing = true;
    updatePlayBtn();
  }

  function loadPhotoFile(file) {
    stopWebcam();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { state.photoImg = img; };
    img.src = url;
    state.mode = 'photo';
  }

  async function useWebcam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false });
      stopWebcam();
      state.stream = stream;
      videoEl.srcObject = stream;
      videoEl.onloadeddata = () => { videoEl.play().catch(() => {}); };
      state.mode = 'video';
      state.videoEl = videoEl;
      state.playing = true;
      updatePlayBtn();
    } catch (e) {
      alert('カメラにアクセスできませんでした: ' + e.message);
    }
  }

  // ---------- procedural samples ----------
  function renderSample(name, t, ctx, w, h) {
    if (name === 'waves') {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#020210');
      grad.addColorStop(1, '#0a1030');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) {
        const phase = t * (0.3 + i * 0.05) + i;
        const y = h * 0.5 + Math.sin(phase) * h * 0.28;
        const hue = (200 + i * 18 + t * 12) % 360;
        ctx.strokeStyle = `hsla(${hue}, 90%, 65%, ${0.35 - i * 0.02})`;
        ctx.lineWidth = 2 + i * 0.6;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const yy = y + Math.sin(x * 0.02 + phase * 1.7) * (30 + i * 6);
          if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      const cx = w * (0.5 + Math.sin(t * 0.4) * 0.3);
      const cy = h * (0.5 + Math.cos(t * 0.33) * 0.25);
      const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.3);
      g2.addColorStop(0, 'rgba(255,220,160,0.55)');
      g2.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
    } else if (name === 'city') {
      ctx.fillStyle = '#020203';
      ctx.fillRect(0, 0, w, h);
      const cols = 22, rows = 12;
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          const seed = cx * 17.3 + cy * 91.7;
          const flick = (Math.sin(t * (2 + (seed % 5)) + seed) + 1) / 2;
          if (flick < 0.55) continue;
          const x = (cx / cols) * w + (w / cols) * 0.5;
          const y = (cy / rows) * h + (h / rows) * 0.5;
          const hue = (seed * 37) % 360;
          const size = 3 + flick * 6;
          ctx.fillStyle = `hsla(${hue}, 85%, ${50 + flick * 25}%, ${0.5 + flick * 0.5})`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (name === 'bloom') {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#160a1e');
      grad.addColorStop(1, '#3a1420');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const blobs = [
        [0.4, 0.42, 0.32, '255,190,150'],
        [0.6, 0.5, 0.22, '255,225,190'],
        [0.5, 0.62, 0.28, '200,120,140'],
      ];
      for (const [bx, by, br, rgb] of blobs) {
        const g = ctx.createRadialGradient(w * bx, h * by, 0, w * bx, h * by, w * br);
        g.addColorStop(0, `rgba(${rgb},0.85)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  // ---------- particle system ----------
  class Particles {
    constructor(max) {
      this.max = max;
      this.x = new Float32Array(max);
      this.y = new Float32Array(max);
      this.vx = new Float32Array(max);
      this.vy = new Float32Array(max);
      this.age = new Float32Array(max);
      this.life = new Float32Array(max);
      this.size = new Float32Array(max);
      this.r = new Float32Array(max);
      this.g = new Float32Array(max);
      this.b = new Float32Array(max);
      this.active = new Uint8Array(max);
      this.cursor = 0;
      this.buf = new Float32Array(max * 7);
      this.glBuf = gl.createBuffer();
    }

    spawn(n, params) {
      if (!sampleData) return;
      for (let i = 0; i < n; i++) {
        const idx = this.cursor;
        this.cursor = (this.cursor + 1) % this.max;

        let px = 0, py = 0, br = 0.5, rr = 200, gg = 200, bb = 200;
        for (let attempt = 0; attempt < 5; attempt++) {
          px = (Math.random() * SAMPLE_W) | 0;
          py = (Math.random() * SAMPLE_H) | 0;
          const di = (py * SAMPLE_W + px) * 4;
          rr = sampleData[di]; gg = sampleData[di + 1]; bb = sampleData[di + 2];
          br = (rr + gg + bb) / (3 * 255);
          if (Math.random() < Math.pow(br, 0.55) + 0.05) break;
        }

        this.x[idx] = (px + 0.5) / SAMPLE_W;
        this.y[idx] = (py + 0.5) / SAMPLE_H;
        const ang = Math.random() * Math.PI * 2;
        const spd = params.speed * (0.15 + Math.random() * 0.35);
        this.vx[idx] = Math.cos(ang) * spd;
        this.vy[idx] = Math.sin(ang) * spd;
        this.age[idx] = 0;
        this.life[idx] = 1.6 + Math.random() * 2.2;
        this.size[idx] = params.size * (0.5 + br * 1.2) * (0.6 + Math.random() * 0.8);
        this.r[idx] = rr / 255; this.g[idx] = gg / 255; this.b[idx] = bb / 255;
        this.active[idx] = 1;
      }
    }

    update(dt, t, params) {
      for (let i = 0; i < this.max; i++) {
        if (!this.active[i]) continue;
        this.age[i] += dt;
        if (this.age[i] >= this.life[i]) { this.active[i] = 0; continue; }

        const x = this.x[i], y = this.y[i];
        const n = Math.sin(x * 6.0 + t * 0.7) * Math.cos(y * 6.0 - t * 0.55);
        const turbAng = n * Math.PI * 2;
        this.vx[i] += Math.cos(turbAng) * params.turb * dt * 0.6;
        this.vy[i] += Math.sin(turbAng) * params.turb * dt * 0.6;

        if (params.flow === 'up') {
          this.vy[i] -= params.speed * 0.25 * dt;
        } else if (params.flow === 'out') {
          const dx = x - 0.5, dy = y - 0.5;
          const d = Math.hypot(dx, dy) + 0.0001;
          this.vx[i] += (dx / d) * params.speed * 0.2 * dt;
          this.vy[i] += (dy / d) * params.speed * 0.2 * dt;
        } else if (params.flow === 'swirl') {
          const dx = x - 0.5, dy = y - 0.5;
          this.vx[i] += -dy * params.speed * 0.6 * dt;
          this.vy[i] += dx * params.speed * 0.6 * dt;
        }

        this.vx[i] *= 0.985;
        this.vy[i] *= 0.985;
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
      }
    }

    buildBuffer() {
      let n = 0;
      const buf = this.buf;
      for (let i = 0; i < this.max; i++) {
        if (!this.active[i]) continue;
        const t = this.age[i] / this.life[i];
        const envelope = Math.min(t * 8, 1) * Math.min((1 - t) * 3, 1);
        const alpha = Math.max(0, envelope);
        if (alpha <= 0.002) continue;
        const o = n * 7;
        buf[o] = this.x[i];
        buf[o + 1] = this.y[i];
        buf[o + 2] = this.size[i] * (0.4 + 0.6 * envelope);
        buf[o + 3] = this.r[i];
        buf[o + 4] = this.g[i];
        buf[o + 5] = this.b[i];
        buf[o + 6] = alpha;
        n++;
      }
      this.count = n;
    }

    draw() {
      if (this.count === 0) return;
      gl.useProgram(particleProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.buf.subarray(0, this.count * 7), gl.DYNAMIC_DRAW);
      const stride = 7 * 4;
      const aPos = gl.getAttribLocation(particleProg, 'aPos');
      const aSize = gl.getAttribLocation(particleProg, 'aSize');
      const aColor = gl.getAttribLocation(particleProg, 'aColor');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(aSize);
      gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(aColor);
      gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 12);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, this.count);
    }
  }

  const particles = new Particles(MAX_PARTICLES);

  // ---------- UI ----------
  const $ = id => document.getElementById(id);
  const ui = {
    trail: $('trail'), grain: $('grain'), aberration: $('aberration'),
    scratches: $('scratches'), flicker: $('flicker'),
    pDensity: $('pDensity'), pSize: $('pSize'), pSpeed: $('pSpeed'), pTurb: $('pTurb'), pFlow: $('pFlow'),
    colorMode: $('colorMode'), colorShadow: $('colorShadow'), colorHigh: $('colorHigh'),
    duotoneRow: $('duotoneRow'),
    sampleSelect: $('sampleSelect'), loadSampleBtn: $('loadSampleBtn'),
    videoInput: $('videoInput'), photoInput: $('photoInput'), webcamBtn: $('webcamBtn'),
    playBtn: $('playBtn'), randomBtn: $('randomBtn'), resetBtn: $('resetBtn'),
    saveFrameBtn: $('saveFrameBtn'), recordBtn: $('recordBtn'), fullscreenBtn: $('fullscreenBtn'),
    panel: $('panel'), uiToggle: $('uiToggle'), dropHint: $('dropHint'),
  };

  const DEFAULTS = {
    trail: 55, grain: 35, aberration: 30, scratches: 25, flicker: 12,
    pDensity: 55, pSize: 45, pSpeed: 40, pTurb: 35, pFlow: 'up', colorMode: 'color',
  };

  function applyDefaults() {
    ui.trail.value = DEFAULTS.trail;
    ui.grain.value = DEFAULTS.grain;
    ui.aberration.value = DEFAULTS.aberration;
    ui.scratches.value = DEFAULTS.scratches;
    ui.flicker.value = DEFAULTS.flicker;
    ui.pDensity.value = DEFAULTS.pDensity;
    ui.pSize.value = DEFAULTS.pSize;
    ui.pSpeed.value = DEFAULTS.pSpeed;
    ui.pTurb.value = DEFAULTS.pTurb;
    ui.pFlow.value = DEFAULTS.pFlow;
    ui.colorMode.value = DEFAULTS.colorMode;
    ui.duotoneRow.hidden = true;
  }
  applyDefaults();

  ui.colorMode.addEventListener('change', () => {
    ui.duotoneRow.hidden = ui.colorMode.value !== 'duotone';
  });

  ui.loadSampleBtn.addEventListener('click', () => {
    stopWebcam();
    state.mode = 'sample';
    state.sampleName = ui.sampleSelect.value;
  });

  ui.videoInput.addEventListener('change', e => {
    if (e.target.files[0]) loadVideoFile(e.target.files[0]);
  });
  ui.photoInput.addEventListener('change', e => {
    if (e.target.files[0]) loadPhotoFile(e.target.files[0]);
  });
  ui.webcamBtn.addEventListener('click', useWebcam);

  function updatePlayBtn() {
    ui.playBtn.textContent = state.playing ? '一時停止' : '再生';
  }
  ui.playBtn.addEventListener('click', () => {
    if (state.mode !== 'video') return;
    state.playing = !state.playing;
    if (state.playing) videoEl.play().catch(() => {}); else videoEl.pause();
    updatePlayBtn();
  });

  ui.randomBtn.addEventListener('click', () => {
    const r = (min, max) => Math.round(min + Math.random() * (max - min));
    ui.trail.value = r(20, 88);
    ui.grain.value = r(10, 80);
    ui.aberration.value = r(0, 70);
    ui.scratches.value = r(0, 70);
    ui.flicker.value = r(0, 35);
    ui.pDensity.value = r(20, 90);
    ui.pSize.value = r(20, 80);
    ui.pSpeed.value = r(15, 85);
    ui.pTurb.value = r(10, 80);
    const flows = ['up', 'out', 'swirl', 'none'];
    ui.pFlow.value = flows[(Math.random() * flows.length) | 0];
  });

  ui.resetBtn.addEventListener('click', applyDefaults);

  ui.uiToggle.addEventListener('click', () => ui.panel.classList.toggle('hidden'));
  window.addEventListener('keydown', e => {
    if (e.key === 'h' || e.key === 'H') ui.panel.classList.toggle('hidden');
    if (e.key === ' ') { e.preventDefault(); ui.playBtn.click(); }
    if (e.key === 'r' || e.key === 'R') ui.randomBtn.click();
  });

  ui.fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });

  ui.saveFrameBtn.addEventListener('click', () => {
    glCanvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `emulsion-${Date.now()}.png`;
      a.click();
    });
  });

  let recorder = null, recordedChunks = [];
  ui.recordBtn.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    const stream = glCanvas.captureStream(30);
    recordedChunks = [];
    let mime = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = e => { if (e.data.size) recordedChunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `emulsion-${Date.now()}.webm`;
      a.click();
      ui.recordBtn.classList.remove('active');
      ui.recordBtn.textContent = '● 録画';
    };
    recorder.start();
    ui.recordBtn.classList.add('active');
    ui.recordBtn.textContent = '■ 停止';
  });

  // drag & drop
  ['dragenter', 'dragover'].forEach(ev =>
    window.addEventListener(ev, e => { e.preventDefault(); document.body.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(ev =>
    window.addEventListener(ev, e => { e.preventDefault(); document.body.classList.remove('dragging'); }));
  window.addEventListener('drop', e => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (file.type.startsWith('video/')) loadVideoFile(file);
    else if (file.type.startsWith('image/')) loadPhotoFile(file);
  });

  // ---------- main loop ----------
  let last = performance.now();
  let sampleFrameCounter = 0;
  let frameCount = 0;
  const startTime = performance.now();
  // Small, bounded pseudo-random seeds refreshed on a short cadence — avoids feeding
  // an ever-growing time value into the shader's hash(), which loses precision on
  // mediump-only fragment shaders (many mobile GPUs) and degenerates into banding.
  let grainSeed = Math.random() * 100;
  let flickerSlotSeed = Math.random() * 1000;

  function updateSourceCanvas(t) {
    if (state.mode === 'video' && state.videoEl && state.videoEl.readyState >= 2) {
      const vw = state.videoEl.videoWidth || SRC_W, vh = state.videoEl.videoHeight || SRC_H;
      drawCover(srcCtx, state.videoEl, vw, vh, SRC_W, SRC_H);
    } else if (state.mode === 'photo' && state.photoImg) {
      drawCover(srcCtx, state.photoImg, state.photoImg.naturalWidth, state.photoImg.naturalHeight, SRC_W, SRC_H);
    } else {
      renderSample(state.sampleName, t, srcCtx, SRC_W, SRC_H);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = (now - startTime) / 1000;
    frameCount++;

    grainSeed = Math.random() * 100;
    if (frameCount % 10 === 0) randomizeScratchTex();
    if (frameCount % 3 === 0) flickerSlotSeed = Math.random() * 1000;

    updateSourceCanvas(t);

    sampleFrameCounter++;
    if (sampleFrameCounter % 2 === 0) {
      sampleCtx.drawImage(srcCanvas, 0, 0, SAMPLE_W, SAMPLE_H);
      sampleData = sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    }

    gl.bindTexture(gl.TEXTURE_2D, sourceTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);

    const pDensity = ui.pDensity.value / 100;
    const spawnCount = Math.round(pDensity * pDensity * 26);
    particles.spawn(spawnCount, {
      speed: ui.pSpeed.value / 100 * 0.6,
      size: 6 + (ui.pSize.value / 100) * 46,
    });
    particles.update(dt, t, {
      turb: (ui.pTurb.value / 100) * 1.6,
      speed: ui.pSpeed.value / 100 * 0.6,
      flow: ui.pFlow.value,
    });
    particles.buildBuffer();

    // composite pass -> writeFBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.fbo);
    gl.viewport(0, 0, writeFBO.w, writeFBO.h);
    gl.disable(gl.BLEND);
    gl.useProgram(compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex);
    gl.uniform1i(gl.getUniformLocation(compositeProg, 'uSource'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readFBO.tex);
    gl.uniform1i(gl.getUniformLocation(compositeProg, 'uFeedback'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, scratchTex);
    gl.uniform1i(gl.getUniformLocation(compositeProg, 'uScratchTex'), 2);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uTime'), t);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uSeed'), grainSeed);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uFlickerSlot'), flickerSlotSeed);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uTrail'), ui.trail.value / 100);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uGrain'), ui.grain.value / 100);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uAberration'), ui.aberration.value / 100);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uScratch'), ui.scratches.value / 100);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uFlicker'), ui.flicker.value / 100);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uDriftAngle'), 0.0028);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uDriftScale'), 1.0035);
    gl.uniform1f(gl.getUniformLocation(compositeProg, 'uAspect'), glCanvas.width / glCanvas.height);
    const modeMap = { color: 0, mono: 1, duotone: 2, invert: 3 };
    gl.uniform1i(gl.getUniformLocation(compositeProg, 'uColorMode'), modeMap[ui.colorMode.value] || 0);
    const shadow = hexToRgb(ui.colorShadow.value);
    const high = hexToRgb(ui.colorHigh.value);
    gl.uniform3f(gl.getUniformLocation(compositeProg, 'uShadow'), shadow[0], shadow[1], shadow[2]);
    gl.uniform3f(gl.getUniformLocation(compositeProg, 'uHigh'), high[0], high[1], high[2]);
    drawQuad(compositeProg);

    // copy writeFBO -> screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.useProgram(copyProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, writeFBO.tex);
    gl.uniform1i(gl.getUniformLocation(copyProg, 'uTex'), 0);
    drawQuad(copyProg);

    // particles additive on top
    particles.draw();
    gl.disable(gl.BLEND);

    // swap
    const tmp = readFBO; readFBO = writeFBO; writeFBO = tmp;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  requestAnimationFrame(frame);
})();
