(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // small utils
  // ---------------------------------------------------------------------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mulColor(c, m) { return [clamp01(c[0] * m), clamp01(c[1] * m), clamp01(c[2] * m)]; }
  function lerpColor(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return [f(0), f(8), f(4)];
  }

  // ---------------------------------------------------------------------
  // mat4 (column-major, matches WebGL)
  // ---------------------------------------------------------------------
  function mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
        out[col * 4 + row] = sum;
      }
    }
    return out;
  }
  function mat4Perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
    return out;
  }
  function mat4Translation(x, y, z) {
    const out = mat4Identity(); out[12] = x; out[13] = y; out[14] = z; return out;
  }
  function mat4RotateX(r) {
    const c = Math.cos(r), s = Math.sin(r);
    const out = mat4Identity();
    out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
    return out;
  }
  function mat4RotateY(r) {
    const c = Math.cos(r), s = Math.sin(r);
    const out = mat4Identity();
    out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
    return out;
  }
  function mat4RotateZ(r) {
    const c = Math.cos(r), s = Math.sin(r);
    const out = mat4Identity();
    out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
    return out;
  }
  function buildViewMatrix(pos, yaw, pitch, roll) {
    const t = mat4Translation(-pos.x, -pos.y, -pos.z);
    const ry = mat4RotateY(Math.PI - yaw);
    const rx = mat4RotateX(-pitch);
    const rz = mat4RotateZ(-roll);
    return mat4Multiply(rz, mat4Multiply(rx, mat4Multiply(ry, t)));
  }

  // ---------------------------------------------------------------------
  // GL setup
  // ---------------------------------------------------------------------
  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', depth: true, preserveDrawingBuffer: true });
  if (!gl) {
    document.body.innerHTML = '<p style="color:#eef0ff;padding:2rem;font-family:monospace;">このブラウザは WebGL に対応していません。</p>';
    return;
  }

  const VS_SRC = `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    attribute float aFloor;

    uniform mat4 uViewProj;
    uniform mat4 uModel;
    uniform vec3 uCamPos;
    uniform float uSnap;

    varying vec3 vColor;
    varying float vFloor;
    varying vec3 vWorldPos;
    varying float vFogDist;

    void main() {
      vec4 world = uModel * vec4(aPosition, 1.0);
      vColor = aColor;
      vFloor = aFloor;
      vWorldPos = world.xyz;
      vFogDist = distance(world.xyz, uCamPos);
      vec4 clip = uViewProj * world;
      if (uSnap > 0.0 && clip.w > 0.0) {
        float w = clip.w;
        clip.xy = floor(clip.xy / w * uSnap) / uSnap * w;
      }
      gl_Position = clip;
    }
  `;

  const FS_SRC = `
    precision mediump float;
    varying vec3 vColor;
    varying float vFloor;
    varying vec3 vWorldPos;
    varying float vFogDist;

    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform vec3 uGridColor;
    uniform float uTime;
    uniform float uBrightBoost;

    void main() {
      vec3 base = vColor;

      if (vFloor > 1.5) {
        float d = length(vWorldPos.xz);
        float ring = sin(d * 1.6 - uTime * 1.1);
        float line = smoothstep(0.55, 1.0, ring);
        base = mix(base, uGridColor, line * 0.75);
      } else if (vFloor > 0.5) {
        vec2 g = fract(vWorldPos.xz / 2.0);
        float dx = min(g.x, 1.0 - g.x);
        float dz = min(g.y, 1.0 - g.y);
        float d2 = min(dx, dz);
        float line2 = 1.0 - smoothstep(0.0, 0.035, d2);
        base = mix(base, uGridColor, line2 * 0.85);
      }

      float fog = 1.0 - exp(-uFogDensity * vFogDist);
      fog = clamp(fog, 0.0, 1.0);
      vec3 color = mix(base, uFogColor, fog);
      color = pow(color, vec3(0.82));
      color = clamp(color * uBrightBoost, 0.0, 1.0);

      float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float levels = 22.0;
      color = floor(color * levels + noise) / levels;

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compileShader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      throw new Error('shader compile failed');
    }
    return sh;
  }
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VS_SRC));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FS_SRC));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    throw new Error('program link failed');
  }
  gl.useProgram(program);

  const loc = {
    aPosition: gl.getAttribLocation(program, 'aPosition'),
    aColor: gl.getAttribLocation(program, 'aColor'),
    aFloor: gl.getAttribLocation(program, 'aFloor'),
    uViewProj: gl.getUniformLocation(program, 'uViewProj'),
    uModel: gl.getUniformLocation(program, 'uModel'),
    uCamPos: gl.getUniformLocation(program, 'uCamPos'),
    uSnap: gl.getUniformLocation(program, 'uSnap'),
    uFogColor: gl.getUniformLocation(program, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(program, 'uFogDensity'),
    uBrightBoost: gl.getUniformLocation(program, 'uBrightBoost'),
    uGridColor: gl.getUniformLocation(program, 'uGridColor'),
    uTime: gl.getUniformLocation(program, 'uTime'),
  };

  const STRIDE = 7 * 4;
  const vbo = gl.createBuffer();
  gl.enableVertexAttribArray(loc.aPosition);
  gl.enableVertexAttribArray(loc.aColor);
  gl.enableVertexAttribArray(loc.aFloor);

  gl.disable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);

  const IDENTITY = mat4Identity();

  function bindForDraw(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, STRIDE, 12);
    gl.vertexAttribPointer(loc.aFloor, 1, gl.FLOAT, false, STRIDE, 24);
  }
  function drawDynamic(info, modelMatrix) {
    bindForDraw(info.vbo);
    gl.uniformMatrix4fv(loc.uModel, false, modelMatrix);
    gl.drawArrays(gl.TRIANGLES, 0, info.count);
  }

  // ---------------------------------------------------------------------
  // geometry builders
  // ---------------------------------------------------------------------
  function pushQuad(arr, p0, p1, p2, p3, color, floorCode) {
    const pts = [p0, p1, p2, p0, p2, p3];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      arr.push(p[0], p[1], p[2], color[0], color[1], color[2], floorCode || 0);
    }
  }

  function pushBox(arr, cx, cy, cz, sx, sy, sz, color) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    const shade = (m) => mulColor(color, m);
    pushQuad(arr, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], shade(1.25), 0);
    pushQuad(arr, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shade(0.5), 0);
    pushQuad(arr, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], shade(0.85), 0);
    pushQuad(arr, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], shade(1.0), 0);
    pushQuad(arr, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(0.7), 0);
    pushQuad(arr, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], shade(1.1), 0);
  }

  function pushFloorWithHole(arr, x0, x1, z0, z1, y, color, floorCode, gx0, gx1, gz0, gz1) {
    pushQuad(arr, [x0, y, z0], [x1, y, z0], [x1, y, gz0], [x0, y, gz0], color, floorCode);
    pushQuad(arr, [x0, y, gz1], [x1, y, gz1], [x1, y, z1], [x0, y, z1], color, floorCode);
    pushQuad(arr, [x0, y, gz0], [gx0, y, gz0], [gx0, y, gz1], [x0, y, gz1], color, floorCode);
    pushQuad(arr, [gx1, y, gz0], [x1, y, gz0], [x1, y, gz1], [gx1, y, gz1], color, floorCode);
  }

  function makeStaticVBO(arr) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    return { vbo: buf, count: arr.length / 7 };
  }
  function uploadMain(arr) {
    const data = new Float32Array(arr);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return data.length / 7;
  }

  function makeFloater(size, color) {
    const arr = [];
    pushBox(arr, 0, 0, 0, size, size, size, color);
    return makeStaticVBO(arr);
  }

  // ---------------------------------------------------------------------
  // world: an endless dream of plazas you fall out of, until you land at
  // the foot of a tower and climb it, then fall again from the top.
  // ---------------------------------------------------------------------
  let vertexCount = 0;
  let state = 'plaza'; // 'plaza' | 'falling' | 'stairs' | 'towertop'
  let currentArea = null;   // { half, holeHalf, floaters[] }  (plaza or towertop)
  let currentStairs = null; // { stepCount, stepDepth, stepRise, halfW, spiralAmp, spiralFreq, totalDepth }
  let fallState = null;     // { vel, elapsed, duration, debris[], camBlend }
  let fallsUntilTower = randInt(3, 5);

  function disposeArea(a) {
    if (!a) return;
    for (let i = 0; i < a.floaters.length; i++) gl.deleteBuffer(a.floaters[i].mesh.vbo);
  }
  function disposeFallState(f) {
    if (!f) return;
    for (let i = 0; i < f.debris.length; i++) gl.deleteBuffer(f.debris[i].mesh.vbo);
  }

  function makeFloaters(half, hue) {
    const list = [];
    const n = randInt(1, 3);
    for (let i = 0; i < n; i++) {
      const size = rand(0.4, 0.85);
      const color = hsl2rgb(hue + 150 + rand(-20, 20), 0.55, 0.62);
      list.push({
        x: rand(-half * 0.55, half * 0.55), z: rand(-half * 0.55, half * 0.55),
        baseY: rand(2.4, 5.5), phase: rand(0, Math.PI * 2),
        mesh: makeFloater(size, color),
      });
    }
    return list;
  }

  function makeArea(isTowerTop) {
    const half = isTowerTop ? rand(7, 10) : rand(13, 19);
    const holeHalf = rand(1.25, 1.7);
    const hue = rand(0, 360);
    const floorColor = hsl2rgb(hue, isTowerTop ? 0.22 : 0.26, isTowerTop ? 0.16 : 0.2);
    const rippleColor = hsl2rgb(hue + 40, 0.55, 0.66);
    const fogColor = hsl2rgb(hue + 10, isTowerTop ? 0.42 : 0.32, isTowerTop ? 0.5 : 0.4);
    const propColor = hsl2rgb(hue - 30, 0.28, 0.3);

    const arr = [];
    pushFloorWithHole(arr, -half, half, -half, half, 0, floorColor, 2, -holeHalf, holeHalf, -holeHalf, holeHalf);

    if (isTowerTop) {
      const n = randInt(3, 6);
      for (let i = 0; i < n; i++) {
        const ang = rand(0, Math.PI * 2);
        const dist = rand(half + 8, half + 40);
        const h = rand(4, 22);
        const w = rand(1.4, 4);
        pushBox(arr, Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist, w, h, w, mulColor(fogColor, 0.32));
      }
    } else {
      const n = randInt(4, 7);
      for (let i = 0; i < n; i++) {
        const ang = rand(0, Math.PI * 2);
        const r = rand(half * 0.4, half * 0.85);
        const h = rand(2.2, 6);
        pushBox(arr, Math.cos(ang) * r, h / 2, Math.sin(ang) * r, rand(0.4, 0.7), h, rand(0.4, 0.7), propColor);
      }
    }

    return {
      isTowerTop, half, holeHalf, fogColor,
      fogDensity: isTowerTop ? 0.028 : 0.042,
      gridColor: rippleColor,
      floaters: makeFloaters(half, hue),
      vertexCount: uploadMain(arr),
    };
  }

  function spawnInArea(area) {
    player.x = 0;
    player.z = area.half * 0.55;
    player.y = 0;
    player.groundY = 0;
    player.yaw = Math.PI;
  }

  function startPlaza() {
    disposeArea(currentArea);
    currentArea = makeArea(false);
    currentStairs = null;
    spawnInArea(currentArea);
    state = 'plaza';
  }

  function startTowerTop() {
    disposeArea(currentArea);
    currentArea = makeArea(true);
    currentStairs = null;
    spawnInArea(currentArea);
    state = 'towertop';
  }

  function buildStairsGeometry(cfg) {
    const arr = [];
    let prevY = 0;
    for (let i = 0; i < cfg.stepCount; i++) {
      const z0 = i * cfg.stepDepth, z1 = z0 + cfg.stepDepth;
      const treadY = (i + 1) * cfg.stepRise;
      const cxA = Math.sin(z0 * cfg.spiralFreq) * cfg.spiralAmp;
      const cxB = Math.sin(z1 * cfg.spiralFreq) * cfg.spiralAmp;
      const cx = (cxA + cxB) / 2;
      const x0 = cx - cfg.halfW, x1 = cx + cfg.halfW;
      pushQuad(arr, [x0, treadY, z0], [x1, treadY, z0], [x1, treadY, z1], [x0, treadY, z1], cfg.floorColor, 1);
      pushQuad(arr, [x0, prevY, z0], [x1, prevY, z0], [x1, treadY, z0], [x0, treadY, z0], mulColor(cfg.floorColor, 0.55), 0);
      const wallTop = treadY + cfg.clearance;
      pushQuad(arr, [cxA - cfg.halfW, 0, z0], [cxA - cfg.halfW, wallTop, z0], [cxB - cfg.halfW, wallTop, z1], [cxB - cfg.halfW, 0, z1], cfg.wallColor, 0);
      pushQuad(arr, [cxA + cfg.halfW, 0, z0], [cxB + cfg.halfW, 0, z1], [cxB + cfg.halfW, wallTop, z1], [cxA + cfg.halfW, wallTop, z0], cfg.wallColor, 0);
      if (i % 7 === 3) {
        pushBox(arr, cx + cfg.halfW - 0.12, treadY + 1.3, (z0 + z1) / 2, 0.2, 0.3, 0.2, cfg.lampColor);
      }
      prevY = treadY;
    }
    return arr;
  }

  function startStairs() {
    disposeArea(currentArea);
    currentArea = null;
    const stepCount = randInt(72, 108);
    const stepRise = rand(0.22, 0.26);
    const stepDepth = rand(0.85, 1.05);
    const halfW = rand(2.0, 2.6);
    const clearance = rand(2.5, 3.0);
    const spiralAmp = rand(1.0, 2.4);
    const spiralFreq = rand(0.05, 0.11);
    const hue = rand(0, 360);
    const cfg = {
      stepCount, stepRise, stepDepth, halfW, clearance, spiralAmp, spiralFreq,
      floorColor: hsl2rgb(hue, 0.16, 0.13),
      wallColor: hsl2rgb(hue, 0.2, 0.08),
      lampColor: hsl2rgb(42, 0.85, 0.6),
    };
    const arr = buildStairsGeometry(cfg);
    currentStairs = Object.assign(cfg, {
      totalDepth: stepCount * stepDepth,
      totalRise: stepCount * stepRise,
      fogColor: hsl2rgb(hue, 0.22, 0.05),
      fogDensity: 0.09,
      gridColor: hsl2rgb(hue + 180, 0.7, 0.55),
      vertexCount: uploadMain(arr),
    });
    player.x = 0; player.z = 0.5; player.y = 0; player.groundY = 0; player.yaw = 0;
    state = 'stairs';
  }

  const FALL_GRAVITY = 22, FALL_TERMINAL = 46;
  function estimateFallDistance(duration) {
    const tAccel = FALL_TERMINAL / FALL_GRAVITY;
    if (duration <= tAccel) return 0.5 * FALL_GRAVITY * duration * duration;
    return 0.5 * FALL_GRAVITY * tAccel * tAccel + FALL_TERMINAL * (duration - tAccel);
  }

  function startFalling() {
    disposeFallState(fallState);
    const duration = rand(4.2, 5.8);
    const maxDist = estimateFallDistance(duration);
    const debris = [];
    const n = randInt(16, 26);
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2), r = rand(2.2, 9);
      const size = rand(0.3, 1.1);
      const color = mulColor(hsl2rgb(rand(0, 360), 0.4, 0.5), 0.65);
      debris.push({
        x: player.x + Math.cos(ang) * r,
        z: player.z + Math.sin(ang) * r,
        y: player.y - rand(2, maxDist + 10),
        spin: rand(0.15, 0.5) * (Math.random() < 0.5 ? -1 : 1),
        mesh: makeFloater(size, color),
      });
    }
    fallState = { vel: 0, elapsed: 0, duration, debris, camBlend: 0, startYaw: player.yaw };
    startWind();
    state = 'falling';
  }

  function endFalling() {
    disposeFallState(fallState);
    fallState = null;
    stopWind();
    fallsUntilTower--;
    if (fallsUntilTower <= 0) {
      fallsUntilTower = randInt(3, 5);
      startStairs();
    } else {
      startPlaza();
    }
  }

  function drawFloaters(list, t) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const y = f.baseY + Math.sin(t * 0.6 + f.phase) * 0.4;
      const m = mat4Multiply(mat4Translation(f.x, y, f.z), mat4RotateY(t * 0.3 + f.phase));
      drawDynamic(f.mesh, m);
    }
  }
  function drawDebris(list, t) {
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const m = mat4Multiply(mat4Translation(d.x, d.y, d.z), mat4RotateY(t * d.spin));
      drawDynamic(d.mesh, m);
    }
  }

  // ---------------------------------------------------------------------
  // player + input (keyboard/mouse for desktop, drag for touch, with
  // Pointer Lock used opportunistically and a drag-look fallback for
  // sandboxes that don't grant it)
  // ---------------------------------------------------------------------
  const player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, groundY: 0, eyeY: 1.62 };
  const keys = Object.create(null);
  let locked = false;
  let started = false;
  let paused = false;
  let justLocked = false;
  let walkPhase = 0;
  let movingBlend = 0;
  const LOOK_SENS = 0.0019;

  const startScreenEl = document.getElementById('startScreen');
  const pauseScreenEl = document.getElementById('pauseScreen');
  const fxToggleEl = document.getElementById('fxToggle');
  const fxPanelEl = document.getElementById('fxPanel');
  const fxResetEl = document.getElementById('fxReset');
  const noiseLayerEl = document.getElementById('noiseLayer');
  const glitchLayerEl = document.getElementById('glitchLayer');
  const memoryOverlayEl = document.getElementById('memoryOverlay');

  const KEY_MAP = {
    'KeyW': 'f', 'ArrowUp': 'f',
    'KeyS': 'b', 'ArrowDown': 'b',
    'KeyA': 'l', 'ArrowLeft': 'l',
    'KeyD': 'r', 'ArrowRight': 'r',
  };

  window.addEventListener('keydown', (e) => {
    const k = KEY_MAP[e.code];
    if (k) keys[k] = true;
    if (e.code === 'Escape' && started && !paused) {
      paused = true;
      pauseScreenEl.classList.remove('hidden');
      if (document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch (e2) {} }
    }
    if (e.code === 'KeyF' && started && !paused) toggleFxPanel();
    if (e.code === 'KeyH' && started && !paused) toggleUiHidden();
  });
  window.addEventListener('keyup', (e) => { const k = KEY_MAP[e.code]; if (k) keys[k] = false; });

  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    if (justLocked) { justLocked = false; return; }
    player.yaw -= e.movementX * LOOK_SENS;
    player.pitch = clamp(player.pitch - e.movementY * LOOK_SENS, -1.25, 1.25);
  });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (locked) justLocked = true;
  });

  let dragging = false, dragX = 0, dragY = 0;
  canvas.addEventListener('mousedown', (e) => {
    if (!started || paused || locked) return;
    dragging = true; dragX = e.clientX; dragY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging || locked) return;
    const dx = e.clientX - dragX, dy = e.clientY - dragY;
    dragX = e.clientX; dragY = e.clientY;
    player.yaw -= dx * LOOK_SENS;
    player.pitch = clamp(player.pitch - dy * LOOK_SENS, -1.25, 1.25);
  });

  const touchState = { moveId: null, moveVec: { x: 0, z: 0 }, lookId: null, lookX: 0, lookY: 0 };
  canvas.addEventListener('touchstart', (e) => {
    if (!started || paused) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const isLeft = t.clientX < window.innerWidth / 2;
      if (isLeft && touchState.moveId === null) {
        touchState.moveId = t.identifier;
        touchState.moveX0 = t.clientX; touchState.moveY0 = t.clientY;
        touchState.moveVec = { x: 0, z: 0 };
      } else if (!isLeft && touchState.lookId === null) {
        touchState.lookId = t.identifier;
        touchState.lookX = t.clientX; touchState.lookY = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === touchState.moveId) {
        const R = 42;
        let dx = t.clientX - touchState.moveX0, dy = t.clientY - touchState.moveY0;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx = dx / len * R; dy = dy / len * R; }
        touchState.moveVec = { x: dx / R, z: -dy / R };
      } else if (t.identifier === touchState.lookId) {
        const dx = t.clientX - touchState.lookX, dy = t.clientY - touchState.lookY;
        touchState.lookX = t.clientX; touchState.lookY = t.clientY;
        player.yaw -= dx * LOOK_SENS * 1.3;
        player.pitch = clamp(player.pitch - dy * LOOK_SENS * 1.3, -1.25, 1.25);
      }
    }
    e.preventDefault();
  }, { passive: false });
  function touchEnd(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === touchState.moveId) {
        touchState.moveId = null;
        touchState.moveVec = { x: 0, z: 0 };
      } else if (t.identifier === touchState.lookId) {
        touchState.lookId = null;
      }
    }
  }
  canvas.addEventListener('touchend', touchEnd, { passive: false });
  canvas.addEventListener('touchcancel', touchEnd, { passive: false });

  document.getElementById('startBtn').addEventListener('click', () => {
    started = true;
    paused = false;
    startScreenEl.classList.add('hidden');
    fxToggleEl.classList.add('visible');
    initAudio();
    try { canvas.requestPointerLock(); } catch (e) {}
  });
  document.getElementById('resumeBtn').addEventListener('click', () => {
    paused = false;
    pauseScreenEl.classList.add('hidden');
    try { canvas.requestPointerLock(); } catch (e) {}
  });
  canvas.addEventListener('click', () => {
    if (started && !paused && !locked) { try { canvas.requestPointerLock(); } catch (e) {} }
  });

  // ---------------------------------------------------------------------
  // screen-effects drawer
  // ---------------------------------------------------------------------
  const noiseCtx = noiseLayerEl.getContext('2d');
  const noiseImgData = noiseCtx.createImageData(64, 64);
  let noiseTimer = null;
  function drawNoise() {
    const d = noiseImgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    noiseCtx.putImageData(noiseImgData, 0, 0);
  }

  function toggleFxPanel() {
    const willOpen = fxPanelEl.classList.contains('hidden');
    fxPanelEl.classList.toggle('hidden', !willOpen);
    fxToggleEl.classList.toggle('open', willOpen);
    fxToggleEl.setAttribute('aria-expanded', String(willOpen));
    if (willOpen && document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch (e) {} }
  }
  fxToggleEl.addEventListener('click', toggleFxPanel);

  let uiHidden = false;
  function toggleUiHidden() {
    uiHidden = !uiHidden;
    document.body.classList.toggle('uiHidden', uiHidden);
    if (uiHidden && !fxPanelEl.classList.contains('hidden')) toggleFxPanel();
  }

  document.querySelectorAll('.fxBtn:not(.glitchBtn)').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.fx;
      if (id === 'blackout' || id === 'lightsOn') {
        const turningOn = !activeFx.has(id);
        activeFx.delete('blackout'); activeFx.delete('lightsOn');
        document.querySelectorAll('.fxBtn[data-fx="blackout"],.fxBtn[data-fx="lightsOn"]').forEach((b) => b.classList.remove('active'));
        if (turningOn) {
          activeFx.add(id);
          btn.classList.add('active');
          setLightMode(id === 'lightsOn' ? 'on' : 'off');
        } else {
          setLightMode('normal');
        }
      } else {
        if (activeFx.has(id)) { activeFx.delete(id); btn.classList.remove('active'); }
        else { activeFx.add(id); btn.classList.add('active'); }
        if (id === 'staticNoise') {
          const active = activeFx.has('staticNoise');
          noiseLayerEl.classList.toggle('active', active);
          if (active && !noiseTimer) { noiseTimer = setInterval(drawNoise, 70); drawNoise(); }
          else if (!active && noiseTimer) { clearInterval(noiseTimer); noiseTimer = null; }
        }
        if (id === 'hueSpin' && !activeFx.has('hueSpin')) hueSpinDeg = 0;
      }
      applyScreenFilter();
    });
  });

  document.querySelectorAll('.glitchBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.glitch;
      if (activeGlitch.has(id)) { activeGlitch.delete(id); btn.classList.remove('active'); }
      else { activeGlitch.add(id); btn.classList.add('active'); scheduleNextGlitch(performance.now() / 1000, true); }
    });
  });

  fxResetEl.addEventListener('click', () => {
    activeFx.clear();
    activeGlitch.clear();
    endGlitchBurst();
    document.querySelectorAll('.fxBtn').forEach((b) => b.classList.remove('active'));
    setLightMode('normal');
    if (noiseTimer) { clearInterval(noiseTimer); noiseTimer = null; }
    noiseLayerEl.classList.remove('active');
    hueSpinDeg = 0;
    applyScreenFilter();
  });

  // ---------------------------------------------------------------------
  // audio (ambient drone + footsteps + falling wind), self-contained WebAudio
  // ---------------------------------------------------------------------
  let actx = null, master = null, reverbSend = null;
  function makeImpulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function initAudio() {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }

    master = actx.createGain();
    master.gain.value = 0.5;
    master.connect(actx.destination);

    const convolver = actx.createConvolver();
    convolver.buffer = makeImpulse(actx, 3.6, 2.2);
    reverbSend = actx.createGain();
    reverbSend.gain.value = 0.5;
    reverbSend.connect(convolver);
    convolver.connect(master);

    const padGain = actx.createGain();
    padGain.gain.value = 0.13;
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 650;
    filter.Q.value = 0.6;

    const freqs = [65.4, 98, 130.8, 164.8];
    freqs.forEach((f, i) => {
      const osc = actx.createOscillator();
      osc.type = i % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.value = f * (1 + rand(-0.003, 0.003));
      const g = actx.createGain();
      g.gain.value = 0.2 / (i + 1);
      osc.connect(g);
      g.connect(filter);
      osc.start();
    });
    filter.connect(padGain);
    padGain.connect(master);
    padGain.connect(reverbSend);

    const lfo = actx.createOscillator();
    lfo.frequency.value = 0.035;
    const lfoGain = actx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    scheduleBlip();
  }

  function scheduleBlip() {
    const delay = rand(16, 34);
    setTimeout(() => {
      if (actx && started) playBlip();
      scheduleBlip();
    }, delay * 1000);
  }

  function playBlip() {
    const osc = actx.createOscillator();
    osc.type = 'sine';
    const base = rand(400, 1100);
    osc.frequency.setValueAtTime(base, actx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(base * rand(0.5, 1.7), actx.currentTime + 0.5);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.045, actx.currentTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 1.1);
    const pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
    osc.connect(g);
    if (pan) { pan.pan.value = rand(-0.8, 0.8); g.connect(pan); pan.connect(master); pan.connect(reverbSend); }
    else { g.connect(master); g.connect(reverbSend); }
    osc.start();
    osc.stop(actx.currentTime + 1.2);
  }

  let stepSide = 1;
  function playFootstep() {
    if (!actx) return;
    const bufSize = actx.sampleRate * 0.05;
    const buf = actx.createBuffer(1, bufSize, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(500, 900);
    bp.Q.value = 1.2;
    const g = actx.createGain();
    g.gain.value = 0.24;
    stepSide *= -1;
    const pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
    src.connect(bp);
    bp.connect(g);
    if (pan) { pan.pan.value = stepSide * 0.25; g.connect(pan); pan.connect(master); pan.connect(reverbSend); }
    else { g.connect(master); g.connect(reverbSend); }
    src.start();
  }

  let windSrc = null, windFilter = null, windGain = null;
  function startWind() {
    if (!actx) return;
    const bufSize = actx.sampleRate * 2;
    const buf = actx.createBuffer(1, bufSize, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
    windSrc = actx.createBufferSource();
    windSrc.buffer = buf; windSrc.loop = true;
    windFilter = actx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 220; windFilter.Q.value = 0.55;
    windGain = actx.createGain(); windGain.gain.value = 0;
    windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
    windSrc.start();
    windGain.gain.linearRampToValueAtTime(0.16, actx.currentTime + 0.5);
  }
  function updateWind(vel) {
    if (!windFilter || !actx) return;
    windFilter.frequency.setTargetAtTime(180 + vel * 7, actx.currentTime, 0.15);
  }
  function stopWind() {
    if (!windSrc || !actx) return;
    windGain.gain.linearRampToValueAtTime(0, actx.currentTime + 0.35);
    const s = windSrc;
    setTimeout(() => { try { s.stop(); } catch (e) {} }, 400);
    windSrc = null;
  }

  function glitchAudioZap(type) {
    if (!actx) return;
    const now = actx.currentTime;
    if (type === 'freeze') {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0.04, now + 0.03);
      master.gain.linearRampToValueAtTime(0.5, now + 0.3);
      return;
    }
    const osc = actx.createOscillator();
    osc.type = 'square';
    const g = actx.createGain();
    g.gain.value = 0.0001;
    osc.connect(g); g.connect(master); g.connect(reverbSend);
    const steps = type === 'memory' ? 11 : 5;
    const stepLen = type === 'memory' ? 0.045 : 0.04;
    for (let i = 0; i < steps; i++) {
      const tt = now + i * stepLen;
      osc.frequency.setValueAtTime(rand(110, 1900), tt);
      g.gain.setValueAtTime(0.1, tt);
      g.gain.exponentialRampToValueAtTime(0.0005, tt + stepLen * 0.6);
    }
    osc.start(now);
    osc.stop(now + steps * stepLen + 0.05);
  }

  // ---------------------------------------------------------------------
  // retro-bug glitch drawer (same five failure modes as the rest of the series)
  // ---------------------------------------------------------------------
  const activeGlitch = new Set();
  let glitchBurst = null;
  let nextGlitchAt = Infinity;
  let glitchFilterOverride = null;
  const glitchCtx = glitchLayerEl.getContext('2d');
  const glitchBuf = document.createElement('canvas');
  const glitchBufCtx = glitchBuf.getContext('2d');
  const frameHistory = [];
  const FRAME_HISTORY_MAX = 3;
  const PALETTE_STEPS = [
    'invert(1) saturate(3)',
    'hue-rotate(270deg) saturate(4) brightness(1.4)',
    'grayscale(1) invert(1) contrast(1.6)',
    'hue-rotate(90deg) saturate(5) contrast(1.3)',
  ];

  function scheduleNextGlitch(now, immediate) {
    nextGlitchAt = now + (immediate ? rand(0.15, 0.9) : rand(1.6, 4.4));
  }

  function pushFrameHistory() {
    const w = glitchLayerEl.width, h = glitchLayerEl.height;
    if (w === 0 || h === 0) return;
    const snap = document.createElement('canvas');
    snap.width = w; snap.height = h;
    snap.getContext('2d').drawImage(canvas, 0, 0);
    frameHistory.push(snap);
    if (frameHistory.length > FRAME_HISTORY_MAX) frameHistory.shift();
  }

  function drawTearFrame() {
    const w = glitchLayerEl.width, h = glitchLayerEl.height;
    if (w === 0 || h === 0) return;
    glitchBuf.width = w; glitchBuf.height = h;
    glitchBufCtx.drawImage(canvas, 0, 0);
    glitchCtx.clearRect(0, 0, w, h);
    const bandCount = randInt(6, 14);
    let y = 0;
    for (let i = 0; i < bandCount && y < h; i++) {
      const bh = Math.min(h - y, Math.max(1, Math.round(h / bandCount + rand(-3, 3))));
      const xOff = Math.round(rand(-18, 18));
      glitchCtx.drawImage(glitchBuf, 0, y, w, bh, xOff, y, w, bh);
      y += bh;
    }
  }

  function drawBlockFrame() {
    const w = glitchLayerEl.width, h = glitchLayerEl.height;
    if (w === 0 || h === 0) return;
    pushFrameHistory();
    glitchCtx.clearRect(0, 0, w, h);
    glitchCtx.drawImage(canvas, 0, 0);
    const blocks = randInt(4, 9);
    for (let i = 0; i < blocks; i++) {
      const src = frameHistory[randInt(0, frameHistory.length - 1)];
      const bw = randInt(Math.round(w * 0.08), Math.round(w * 0.32));
      const bh = randInt(Math.round(h * 0.04), Math.round(h * 0.18));
      const sx = randInt(0, Math.max(0, w - bw));
      const sy = randInt(0, Math.max(0, h - bh));
      const dx = randInt(0, Math.max(0, w - bw));
      const dy = randInt(0, Math.max(0, h - bh));
      glitchCtx.drawImage(src, sx, sy, bw, bh, dx, dy, bw, bh);
    }
  }

  function drawFreezeFrame(b, now) {
    const w = glitchLayerEl.width, h = glitchLayerEl.height;
    if (w === 0 || h === 0 || !b.frozenFrame) return;
    glitchCtx.clearRect(0, 0, w, h);
    const jitter = Math.floor((now - b.start) / 0.09) % 2 === 0 ? 0 : 1;
    glitchCtx.drawImage(b.frozenFrame, jitter, 0);
  }

  function drawPaletteFrame(t, duration) {
    const idx = Math.floor((t / duration) * PALETTE_STEPS.length) % PALETTE_STEPS.length;
    glitchFilterOverride = PALETTE_STEPS[idx];
    applyScreenFilter();
  }

  function buildMemoryDump() {
    const hex = () => '0x' + Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
    return [
      'SEG_FAULT @ ' + hex(),
      'PLR X=' + player.x.toFixed(2) + ' Y=' + player.eyeY.toFixed(2) + ' Z=' + player.z.toFixed(2),
      'STATE ' + state.toUpperCase() + ' FALLS_TIL_TOWER=' + fallsUntilTower,
      'VTX=' + vertexCount,
      hex() + ' ' + hex() + ' ' + hex() + ' ' + hex(),
      'DREAM LOG: ' + String.fromCharCode(0x25a0, 0x25b2, 0x2665) + hex(),
    ].join('\n');
  }

  function drawMemoryFrame(b, now) {
    if (now - (b.lastText || 0) > 0.075) {
      b.lastText = now;
      memoryOverlayEl.textContent = buildMemoryDump();
      memoryOverlayEl.style.left = rand(2, 40) + '%';
      memoryOverlayEl.style.top = rand(4, 70) + '%';
    }
    memoryOverlayEl.classList.add('active');
  }

  const GLITCH_DURATIONS = { tear: [0.2, 0.5], block: [0.25, 0.6], freeze: [0.12, 0.35], palette: [0.1, 0.24], memory: [0.4, 0.9] };

  function startGlitchBurst(type, now) {
    const range = GLITCH_DURATIONS[type] || [0.2, 0.4];
    glitchBurst = { type, start: now, duration: rand(range[0], range[1]), lastText: 0 };
    const w = glitchLayerEl.width, h = glitchLayerEl.height;
    if (w > 0 && h > 0) glitchCtx.clearRect(0, 0, w, h);
    if (type === 'freeze') {
      const snap = document.createElement('canvas');
      snap.width = w; snap.height = h;
      snap.getContext('2d').drawImage(canvas, 0, 0);
      glitchBurst.frozenFrame = snap;
    }
    glitchAudioZap(type);
  }

  function endGlitchBurst() {
    glitchBurst = null;
    const w = glitchLayerEl.width, h = glitchLayerEl.height;
    if (w > 0 && h > 0) glitchCtx.clearRect(0, 0, w, h);
    memoryOverlayEl.classList.remove('active');
    if (glitchFilterOverride) { glitchFilterOverride = null; applyScreenFilter(); }
    scheduleNextGlitch(performance.now() / 1000);
  }

  function updateGlitchSystem(now) {
    if (!started || paused) {
      if (glitchBurst) endGlitchBurst();
      nextGlitchAt = Infinity;
      return;
    }
    if (glitchBurst) {
      const t = now - glitchBurst.start;
      if (t > glitchBurst.duration) { endGlitchBurst(); return; }
      if (glitchBurst.type === 'tear') drawTearFrame();
      else if (glitchBurst.type === 'block') drawBlockFrame();
      else if (glitchBurst.type === 'freeze') drawFreezeFrame(glitchBurst, now);
      else if (glitchBurst.type === 'palette') drawPaletteFrame(t, glitchBurst.duration);
      else if (glitchBurst.type === 'memory') drawMemoryFrame(glitchBurst, now);
      return;
    }
    if (activeGlitch.size === 0) { nextGlitchAt = Infinity; return; }
    if (nextGlitchAt === Infinity) { scheduleNextGlitch(now); return; }
    if (now >= nextGlitchAt) {
      const pool = Array.from(activeGlitch);
      startGlitchBurst(pool[randInt(0, pool.length - 1)], now);
    }
  }

  // ---------------------------------------------------------------------
  // resize
  // ---------------------------------------------------------------------
  const TARGET_H = 210;
  let aspect = 16 / 9;
  function resize() {
    aspect = window.innerWidth / window.innerHeight;
    const h = TARGET_H;
    const w = Math.max(160, Math.round(h * aspect));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    glitchLayerEl.width = w;
    glitchLayerEl.height = h;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------
  // screen effects (CSS-filter drawer + shader/scene-level "lights" toggle)
  // ---------------------------------------------------------------------
  const CSS_EFFECTS = {
    mist: 'blur(1.5px) contrast(0.88) brightness(1.06)',
    blur: 'blur(5px)',
    vhs: 'sepia(0.65) contrast(1.15) saturate(1.5) brightness(0.95)',
    mono: 'grayscale(1) contrast(1.25)',
    negative: 'invert(1) hue-rotate(180deg)',
    vivid: 'saturate(3) contrast(1.15)',
    thermal: 'hue-rotate(120deg) saturate(4) contrast(1.3) brightness(1.15)',
    nightVision: 'grayscale(0.5) sepia(1) hue-rotate(62deg) saturate(4.5) brightness(1.3) contrast(1.2)',
  };
  const activeFx = new Set();
  let hueSpinDeg = 0;
  let lightMode = 'normal';
  let brightBoost = 1.0, targetBright = 1.0;
  let fogMul = 1.0, targetFogMul = 1.0;

  const screenEls = [canvas, document.querySelector('.scanlines'), document.querySelector('.vignette')];
  function applyScreenFilter() {
    let str;
    if (glitchFilterOverride) {
      str = glitchFilterOverride;
    } else {
      const parts = [];
      activeFx.forEach((id) => { if (CSS_EFFECTS[id]) parts.push(CSS_EFFECTS[id]); });
      if (activeFx.has('blackout')) parts.push('brightness(0.55)');
      if (activeFx.has('lightsOn')) parts.push('brightness(1.25)');
      if (activeFx.has('hueSpin')) parts.push('hue-rotate(' + hueSpinDeg.toFixed(0) + 'deg)');
      str = parts.length ? parts.join(' ') : 'none';
    }
    for (let i = 0; i < screenEls.length; i++) if (screenEls[i]) screenEls[i].style.filter = str;
  }

  function setLightMode(mode) {
    lightMode = mode;
    if (mode === 'on') {
      targetFogMul = 0.18;
      const seq = [0.3, 1.7, 0.35, 1.8, 1.0, 1.55];
      seq.forEach((v, i) => setTimeout(() => { if (lightMode === 'on') targetBright = v; }, i * 70));
    } else if (mode === 'off') {
      targetBright = 0.4;
      targetFogMul = 2.4;
    } else {
      targetBright = 1.0;
      targetFogMul = 1.0;
    }
  }

  // ---------------------------------------------------------------------
  // main loop
  // ---------------------------------------------------------------------
  let curFog = [0.05, 0.03, 0.1];
  let curFogDensity = 0.042;
  let curGrid = [0.7, 0.55, 1.0];
  let distSinceStep = 0;
  let lastT = performance.now();
  const WALK_SPEED = 2.4;

  function computeCameraEye() {
    if (state === 'falling') {
      const t = fallState.camBlend;
      return {
        x: player.x,
        y: player.y + lerp(1.6, 9.5, t),
        z: player.z + lerp(0, 5.5, t),
      };
    }
    return { x: player.x, y: player.eyeY, z: player.z };
  }

  function updatePlazaMovement(dt) {
    let moveX = 0, moveZ = 0;
    if (paused) {
    } else if (started) {
      if (keys.f) moveZ += 1;
      if (keys.b) moveZ -= 1;
      if (keys.r) moveX += 1;
      if (keys.l) moveX -= 1;
      moveX += touchState.moveVec.x;
      moveZ += touchState.moveVec.z;
    } else {
      moveZ = 1;
    }
    const moving = (Math.abs(moveX) > 0.01 || Math.abs(moveZ) > 0.01);
    let dx = 0, dz = 0;
    if (moving) {
      const len = Math.max(1, Math.hypot(moveX, moveZ));
      moveX /= len; moveZ /= len;
      const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
      const speed = WALK_SPEED * (started ? 1 : 0.6) * dt;
      dx = (sy * moveZ + cy * moveX) * speed;
      dz = (cy * moveZ - sy * moveX) * speed;
    }
    movingBlend = lerp(movingBlend, moving ? 1 : 0, 1 - Math.exp(-dt * 6));

    const half = currentArea.half - 0.5;
    const nx = clamp(player.x + dx, -half, half);
    const nz = clamp(player.z + dz, -half, half);
    const moved = Math.hypot(nx - player.x, nz - player.z);
    player.x = nx; player.z = nz;
    player.groundY = lerp(player.groundY, 0, 1 - Math.exp(-dt * 9));

    if (moving && moved > 0.0001) {
      distSinceStep += moved;
      walkPhase += moved * 2.3;
      if (distSinceStep > 0.72) { distSinceStep = 0; playFootstep(); }
    }

    if (Math.abs(player.x) < currentArea.holeHalf && Math.abs(player.z) < currentArea.holeHalf) {
      startFalling();
    }
  }

  function updateStairsMovement(dt) {
    let moveX = 0, moveZ = 0;
    if (started && !paused) {
      if (keys.f) moveZ += 1;
      if (keys.b) moveZ -= 1;
      if (keys.r) moveX += 1;
      if (keys.l) moveX -= 1;
      moveX += touchState.moveVec.x;
      moveZ += touchState.moveVec.z;
    }
    const moving = (Math.abs(moveX) > 0.01 || Math.abs(moveZ) > 0.01);
    let dx = 0, dz = 0;
    if (moving) {
      const len = Math.max(1, Math.hypot(moveX, moveZ));
      moveX /= len; moveZ /= len;
      const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
      const speed = WALK_SPEED * dt;
      dx = (sy * moveZ + cy * moveX) * speed;
      dz = (cy * moveZ - sy * moveX) * speed;
    }
    movingBlend = lerp(movingBlend, moving ? 1 : 0, 1 - Math.exp(-dt * 6));

    const nz = clamp(player.z + dz, 0.3, currentStairs.totalDepth - 0.05);
    const cxAt = Math.sin(nz * currentStairs.spiralFreq) * currentStairs.spiralAmp;
    const nx = clamp(player.x + dx, cxAt - (currentStairs.halfW - 0.35), cxAt + (currentStairs.halfW - 0.35));
    const moved = Math.hypot(nx - player.x, nz - player.z);
    player.x = nx; player.z = nz;

    const stepIndex = clamp(Math.floor(nz / currentStairs.stepDepth), 0, currentStairs.stepCount - 1);
    const targetY = (stepIndex + 1) * currentStairs.stepRise;
    player.groundY = lerp(player.groundY, targetY, 1 - Math.exp(-dt * 8));

    if (moving && moved > 0.0001) {
      distSinceStep += moved;
      walkPhase += moved * 2.3;
      if (distSinceStep > 0.6) { distSinceStep = 0; playFootstep(); }
    }

    if (nz >= currentStairs.totalDepth - 0.1) startTowerTop();
  }

  function updateFallingMovement(dt) {
    fallState.vel = Math.min(FALL_TERMINAL, fallState.vel + FALL_GRAVITY * dt);
    player.y -= fallState.vel * dt;
    fallState.elapsed += dt;
    fallState.camBlend = Math.min(1, fallState.camBlend + dt / 1.1);
    updateWind(fallState.vel);

    let moveX = 0, moveZ = 0;
    if (started && !paused) {
      if (keys.f) moveZ += 1;
      if (keys.b) moveZ -= 1;
      if (keys.r) moveX += 1;
      if (keys.l) moveX -= 1;
      moveX += touchState.moveVec.x;
      moveZ += touchState.moveVec.z;
    }
    if (Math.abs(moveX) > 0.01 || Math.abs(moveZ) > 0.01) {
      const len = Math.max(1, Math.hypot(moveX, moveZ));
      moveX /= len; moveZ /= len;
      const yaw = player.yaw + fallState.elapsed * 0.15;
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const drift = 1.4 * dt;
      player.x += (sy * moveZ + cy * moveX) * drift;
      player.z += (cy * moveZ - sy * moveX) * drift;
    }

    if (fallState.elapsed >= fallState.duration) endFalling();
  }

  function update(dt) {
    if (state === 'plaza' || state === 'towertop') updatePlazaMovement(dt);
    else if (state === 'stairs') updateStairsMovement(dt);
    else if (state === 'falling') updateFallingMovement(dt);

    let liveFog, liveFogDensity, liveGrid;
    if (state === 'stairs') {
      liveFog = currentStairs.fogColor; liveFogDensity = currentStairs.fogDensity; liveGrid = currentStairs.gridColor;
    } else if (state === 'falling') {
      liveFog = [0.02, 0.01, 0.05]; liveFogDensity = 0.05; liveGrid = [0.6, 0.4, 0.9];
    } else {
      liveFog = currentArea.fogColor; liveFogDensity = currentArea.fogDensity; liveGrid = currentArea.gridColor;
    }
    const smoothing = 1 - Math.exp(-dt * 1.4);
    curFog = lerpColor(curFog, liveFog, smoothing);
    fogMul = lerp(fogMul, targetFogMul, 1 - Math.exp(-dt * 3));
    curFogDensity = lerp(curFogDensity, liveFogDensity * fogMul, smoothing);
    curGrid = lerpColor(curGrid, liveGrid, smoothing);
    brightBoost = lerp(brightBoost, targetBright, 1 - Math.exp(-dt * 10));

    if (activeFx.has('hueSpin')) { hueSpinDeg = (hueSpinDeg + dt * 70) % 360; applyScreenFilter(); }

    const bob = state === 'plaza' || state === 'towertop' || state === 'stairs' ? Math.sin(walkPhase) * 0.045 * movingBlend : 0;
    const roll = state === 'falling' ? Math.sin(fallState.elapsed * 3.1) * 0.05 : Math.sin(walkPhase * 0.5) * 0.012 * movingBlend;
    player.eyeY = player.groundY + 1.62 + bob;
    player.roll = roll;
  }

  function render() {
    gl.clearColor(curFog[0], curFog[1], curFog[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const proj = mat4Perspective((72 * Math.PI) / 180, aspect, 0.08, 140);
    const eye = computeCameraEye();
    const pitch = state === 'falling' ? lerp(player.pitch, -1.35, fallState.camBlend) : player.pitch;
    const yaw = state === 'falling' ? player.yaw + fallState.elapsed * 0.15 : player.yaw;
    const view = buildViewMatrix(eye, yaw, pitch, player.roll || 0);
    const viewProj = mat4Multiply(proj, view);

    gl.uniformMatrix4fv(loc.uViewProj, false, viewProj);
    gl.uniform3f(loc.uCamPos, eye.x, eye.y, eye.z);
    gl.uniform1f(loc.uSnap, 130.0);
    gl.uniform3f(loc.uFogColor, curFog[0], curFog[1], curFog[2]);
    gl.uniform1f(loc.uFogDensity, curFogDensity);
    gl.uniform1f(loc.uBrightBoost, brightBoost);
    gl.uniform3f(loc.uGridColor, curGrid[0], curGrid[1], curGrid[2]);
    const t = performance.now() / 1000;
    gl.uniform1f(loc.uTime, t);

    if (vertexCount > 0) {
      bindForDraw(vbo);
      gl.uniformMatrix4fv(loc.uModel, false, IDENTITY);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }

    if ((state === 'plaza' || state === 'towertop') && currentArea) drawFloaters(currentArea.floaters, t);
    if (state === 'falling' && fallState) drawDebris(fallState.debris, t);
  }

  function frame(nowMs) {
    const dt = Math.min(0.05, (nowMs - lastT) / 1000);
    lastT = nowMs;
    const now = nowMs / 1000;
    const frozen = !!(glitchBurst && glitchBurst.type === 'freeze');
    if (!frozen) update(dt);
    vertexCount = state === 'stairs' ? currentStairs.vertexCount : (currentArea ? currentArea.vertexCount : vertexCount);
    render();
    updateGlitchSystem(now);
    requestAnimationFrame(frame);
  }

  startPlaza();
  requestAnimationFrame(frame);
})();
