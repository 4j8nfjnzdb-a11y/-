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
    // yaw=0 / pitch=0 looks down world +Z, matching the direction cells are generated in.
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
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', depth: true });
  if (!gl) {
    document.body.innerHTML = '<p style="color:#eaf6ff;padding:2rem;font-family:monospace;">このブラウザは WebGL に対応していません。</p>';
    return;
  }

  const VS_SRC = `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    attribute float aFloor;
    attribute float aSlide;

    uniform mat4 uViewProj;
    uniform vec3 uCamPos;
    uniform float uDoorOpen;
    uniform float uSnap;

    varying vec3 vColor;
    varying float vFloor;
    varying vec3 vWorldPos;
    varying float vFogDist;

    void main() {
      vec3 pos = aPosition;
      pos.x += aSlide * uDoorOpen;
      vColor = aColor;
      vFloor = aFloor;
      vWorldPos = pos;
      vFogDist = distance(pos, uCamPos);
      vec4 clip = uViewProj * vec4(pos, 1.0);
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

      if (vFloor > 0.5) {
        vec2 g = fract(vWorldPos.xz / 2.0);
        float dx = min(g.x, 1.0 - g.x);
        float dz = min(g.y, 1.0 - g.y);
        float d = min(dx, dz);
        float line = 1.0 - smoothstep(0.0, 0.035, d);
        float flicker = 0.82 + 0.18 * sin(uTime * 6.0 + vWorldPos.x * 1.7 + vWorldPos.z * 0.6);
        base = mix(base, uGridColor, line * flicker);
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
    aSlide: gl.getAttribLocation(program, 'aSlide'),
    uViewProj: gl.getUniformLocation(program, 'uViewProj'),
    uCamPos: gl.getUniformLocation(program, 'uCamPos'),
    uDoorOpen: gl.getUniformLocation(program, 'uDoorOpen'),
    uSnap: gl.getUniformLocation(program, 'uSnap'),
    uFogColor: gl.getUniformLocation(program, 'uFogColor'),
    uFogDensity: gl.getUniformLocation(program, 'uFogDensity'),
    uBrightBoost: gl.getUniformLocation(program, 'uBrightBoost'),
    uGridColor: gl.getUniformLocation(program, 'uGridColor'),
    uTime: gl.getUniformLocation(program, 'uTime'),
  };

  const vbo = gl.createBuffer();
  const STRIDE = 8 * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(loc.aPosition);
  gl.enableVertexAttribArray(loc.aColor);
  gl.enableVertexAttribArray(loc.aFloor);
  gl.enableVertexAttribArray(loc.aSlide);
  gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, STRIDE, 0);
  gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, STRIDE, 12);
  gl.vertexAttribPointer(loc.aFloor, 1, gl.FLOAT, false, STRIDE, 24);
  gl.vertexAttribPointer(loc.aSlide, 1, gl.FLOAT, false, STRIDE, 28);

  gl.disable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);

  // ---------------------------------------------------------------------
  // geometry builders
  // ---------------------------------------------------------------------
  function pushQuad(arr, p0, p1, p2, p3, color, isFloor, slide) {
    const pts = [p0, p1, p2, p0, p2, p3];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      arr.push(p[0], p[1], p[2], color[0], color[1], color[2], isFloor ? 1 : 0, slide || 0);
    }
  }

  function pushBox(arr, cx, cy, cz, sx, sy, sz, color) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    const shade = (m) => mulColor(color, m);
    pushQuad(arr, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], shade(1.25), false, 0);
    pushQuad(arr, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shade(0.5), false, 0);
    pushQuad(arr, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], shade(0.85), false, 0);
    pushQuad(arr, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], shade(1.0), false, 0);
    pushQuad(arr, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(0.7), false, 0);
    pushQuad(arr, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], shade(1.1), false, 0);
  }

  function buildCellGeometry(cell) {
    const arr = [];
    if (cell.mode === 'exterior') {
      pushQuad(arr,
        [cell.cx - cell.halfW, 0, cell.z0], [cell.cx + cell.halfW, 0, cell.z0],
        [cell.cx + cell.halfW, 0, cell.z1], [cell.cx - cell.halfW, 0, cell.z1],
        cell.floorColor, true, 0);
      for (let i = 0; i < cell.silhouettes.length; i++) {
        const s = cell.silhouettes[i];
        pushBox(arr, s.x, s.h / 2, s.z, s.w, s.h, s.d, s.color);
      }
    } else {
      pushQuad(arr,
        [cell.cx - cell.halfW, 0, cell.z0], [cell.cx + cell.halfW, 0, cell.z0],
        [cell.cx + cell.halfW, 0, cell.z1], [cell.cx - cell.halfW, 0, cell.z1],
        cell.floorColor, true, 0);
      pushQuad(arr,
        [cell.cx - cell.halfW, cell.height, cell.z0], [cell.cx - cell.halfW, cell.height, cell.z1],
        [cell.cx + cell.halfW, cell.height, cell.z1], [cell.cx + cell.halfW, cell.height, cell.z0],
        cell.ceilColor, false, 0);
      pushQuad(arr,
        [cell.cx - cell.halfW, 0, cell.z0], [cell.cx - cell.halfW, cell.height, cell.z0],
        [cell.cx - cell.halfW, cell.height, cell.z1], [cell.cx - cell.halfW, 0, cell.z1],
        cell.wallColor, false, 0);
      pushQuad(arr,
        [cell.cx + cell.halfW, 0, cell.z0], [cell.cx + cell.halfW, 0, cell.z1],
        [cell.cx + cell.halfW, cell.height, cell.z1], [cell.cx + cell.halfW, cell.height, cell.z0],
        cell.wallColor, false, 0);

      if (cell.hasSofa) {
        const s = cell.sofa;
        pushBox(arr, s.x, s.h / 2, s.z, s.w, s.h, s.d, cell.furnitureColor);
      }

      if (cell.mode === 'threshold') {
        const hw = cell.halfW, h = cell.height - 0.12, z = cell.z1;
        const slideAmt = hw * 0.96;
        pushQuad(arr, [cell.cx - hw, 0, z], [cell.cx, 0, z], [cell.cx, h, z], [cell.cx - hw, h, z], cell.doorColor, false, -slideAmt);
        pushQuad(arr, [cell.cx, 0, z], [cell.cx + hw, 0, z], [cell.cx + hw, h, z], [cell.cx, h, z], cell.doorColor, false, slideAmt);
      }
    }
    return new Float32Array(arr);
  }

  // ---------------------------------------------------------------------
  // procedural world generation
  // ---------------------------------------------------------------------
  const gs = { z: 0, cx: 0, hue: rand(0, 360), mode: 'interior', counter: randInt(5, 9) };

  function makeInterior() {
    const depth = rand(5, 8.5);
    const halfW = rand(2.3, 3.6);
    const height = rand(2.8, 4.2);
    gs.cx = clamp(gs.cx + rand(-0.6, 0.6), -3.2, 3.2);
    gs.hue = (gs.hue + rand(-8, 8) + 360) % 360;
    const wallColor = hsl2rgb(gs.hue, 0.48, 0.22);
    const floorColor = hsl2rgb(gs.hue + 15, 0.4, 0.12);
    const ceilColor = hsl2rgb(gs.hue - 15, 0.38, 0.15);
    const gridColor = hsl2rgb(gs.hue + 180, 0.9, 0.62);
    const furnitureColor = hsl2rgb(gs.hue + 100, 0.65, 0.46);
    const fogColor = hsl2rgb(gs.hue, 0.5, 0.09);
    const z0 = gs.z, z1 = gs.z + depth; gs.z = z1;
    const cell = {
      mode: 'interior', z0, z1, cx: gs.cx, halfW, height,
      wallColor, floorColor, ceilColor, gridColor, furnitureColor, fogColor,
      fogDensity: 0.065, hasSofa: false,
    };
    if (Math.random() < 0.55) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const w = rand(1.3, 1.9), d = rand(0.55, 0.8), h = rand(0.45, 0.6);
      cell.hasSofa = true;
      cell.sofa = {
        x: cell.cx + side * (cell.halfW - 0.55 - d / 2),
        z: cell.z0 + (cell.z1 - cell.z0) * rand(0.3, 0.7),
        w, d, h,
      };
    }
    return cell;
  }

  function makeThreshold() {
    const depth = rand(9, 15);
    const halfW = rand(1.5, 2.1);
    const height = rand(2.6, 3.1);
    const wallColor = hsl2rgb(gs.hue, 0.16, 0.09);
    const floorColor = hsl2rgb(gs.hue, 0.2, 0.06);
    const gridColor = hsl2rgb(gs.hue + 180, 1.0, 0.68);
    const doorColor = hsl2rgb(gs.hue + 180, 0.85, 0.55);
    const fogColor = hsl2rgb(gs.hue, 0.28, 0.035);
    const z0 = gs.z, z1 = gs.z + depth; gs.z = z1;
    return {
      mode: 'threshold', z0, z1, cx: gs.cx, halfW, height,
      wallColor, floorColor, ceilColor: wallColor, gridColor, doorColor, fogColor,
      fogDensity: 0.095, hasSofa: false, doorOpen: 0,
    };
  }

  function makeExterior() {
    const depth = rand(9, 15);
    const halfW = rand(9, 17);
    gs.cx = clamp(gs.cx + rand(-1.2, 1.2), -6, 6);
    gs.hue = (gs.hue + rand(-6, 6) + 360) % 360;
    const floorColor = hsl2rgb(gs.hue, 0.35, 0.09);
    const gridColor = hsl2rgb(gs.hue + 150, 0.8, 0.6);
    const fogColor = hsl2rgb(gs.hue + 25, 0.5, 0.2);
    const z0 = gs.z, z1 = gs.z + depth; gs.z = z1;
    const cell = {
      mode: 'exterior', z0, z1, cx: gs.cx, halfW, height: 0,
      floorColor, gridColor, fogColor, fogDensity: 0.045, hasSofa: false,
    };
    const n = randInt(2, 4);
    const silhouettes = [];
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const dist = rand(halfW + 6, halfW + 30);
      silhouettes.push({
        x: cell.cx + side * dist,
        z: rand(z0, z1),
        h: rand(5, 26),
        w: rand(1.2, 4),
        d: rand(1.2, 4),
        color: mulColor(fogColor, 0.35),
      });
    }
    cell.silhouettes = silhouettes;
    return cell;
  }

  function nextCell() {
    let cell;
    if (gs.mode === 'interior') {
      cell = makeInterior();
      gs.counter--;
      if (gs.counter <= 0) gs.mode = 'threshold_in';
    } else if (gs.mode === 'threshold_in') {
      cell = makeThreshold();
      gs.mode = 'exterior';
      gs.counter = randInt(4, 7);
      gs.hue = (gs.hue + rand(110, 230)) % 360;
    } else if (gs.mode === 'exterior') {
      cell = makeExterior();
      gs.counter--;
      if (gs.counter <= 0) gs.mode = 'threshold_out';
    } else {
      cell = makeThreshold();
      gs.mode = 'interior';
      gs.counter = randInt(5, 9);
      gs.hue = (gs.hue + rand(110, 230)) % 360;
    }
    cell.geometry = buildCellGeometry(cell);
    return cell;
  }

  const LOAD_AHEAD = 45;
  const PRUNE_BEHIND = 18;
  let activeCells = [];
  let vertexCount = 0;

  function rebuildBuffer() {
    let total = 0;
    for (let i = 0; i < activeCells.length; i++) total += activeCells[i].geometry.length;
    const merged = new Float32Array(total);
    let off = 0;
    for (let i = 0; i < activeCells.length; i++) {
      merged.set(activeCells[i].geometry, off);
      off += activeCells[i].geometry.length;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, merged, gl.DYNAMIC_DRAW);
    vertexCount = total / 8;
  }

  function ensureCells(playerZ) {
    let changed = false;
    while (activeCells.length === 0 || activeCells[activeCells.length - 1].z1 < playerZ + LOAD_AHEAD) {
      activeCells.push(nextCell());
      changed = true;
    }
    while (activeCells.length && activeCells[0].z1 < playerZ - PRUNE_BEHIND) {
      activeCells.shift();
      changed = true;
    }
    if (changed) rebuildBuffer();
  }

  function getCellAt(z) {
    for (let i = 0; i < activeCells.length; i++) {
      if (z >= activeCells[i].z0 && z < activeCells[i].z1) return activeCells[i];
    }
    if (activeCells.length) return z < activeCells[0].z0 ? activeCells[0] : activeCells[activeCells.length - 1];
    return null;
  }

  // ---------------------------------------------------------------------
  // player + input (keyboard/mouse for desktop, drag for touch, with
  // Pointer Lock used opportunistically and a drag-look fallback for
  // sandboxes that don't grant it)
  // ---------------------------------------------------------------------
  const player = { x: 0, y: 1.62, z: -2, yaw: 0, pitch: 0 };
  const keys = Object.create(null);
  let locked = false;
  let started = false;
  let paused = false;
  let justLocked = false;
  let walkPhase = 0;
  let movingBlend = 0;
  const LOOK_SENS = 0.0024;

  const startScreenEl = document.getElementById('startScreen');
  const pauseScreenEl = document.getElementById('pauseScreen');
  const crosshairEl = document.getElementById('crosshair');
  const hintEl = document.getElementById('hint');
  const moveStickEl = document.getElementById('moveStick');
  const fxToggleEl = document.getElementById('fxToggle');
  const fxPanelEl = document.getElementById('fxPanel');
  const fxResetEl = document.getElementById('fxReset');
  const noiseLayerEl = document.getElementById('noiseLayer');

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
  });
  window.addEventListener('keyup', (e) => { const k = KEY_MAP[e.code]; if (k) keys[k] = false; });

  // pointer-lock look (desktop, when the host permits it)
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

  // drag-to-look fallback (desktop mouse without pointer lock)
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

  // touch controls: left half = move stick, right half = look drag
  const touchState = { moveId: null, moveVec: { x: 0, z: 0 }, lookId: null, lookX: 0, lookY: 0 };
  function stickVisual(active, x, y, dx, dy) {
    if (!active) { moveStickEl.classList.remove('active'); return; }
    moveStickEl.classList.add('active');
    moveStickEl.style.left = x + 'px';
    moveStickEl.style.top = y + 'px';
    const thumb = moveStickEl.firstElementChild;
    thumb.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  }
  canvas.addEventListener('touchstart', (e) => {
    if (!started || paused) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const isLeft = t.clientX < window.innerWidth / 2;
      if (isLeft && touchState.moveId === null) {
        touchState.moveId = t.identifier;
        touchState.moveX0 = t.clientX; touchState.moveY0 = t.clientY;
        touchState.moveVec = { x: 0, z: 0 };
        stickVisual(true, t.clientX, t.clientY, 0, 0);
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
        stickVisual(true, touchState.moveX0, touchState.moveY0, dx, dy);
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
        stickVisual(false);
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
    crosshairEl.classList.add('visible');
    hintEl.classList.add('visible');
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
    // pointer lock swallows clicks meant for the panel's buttons, so release
    // it whenever the drawer opens; the player can click back into the
    // world to re-lock once they're done picking effects.
    if (willOpen && document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch (e) {} }
  }
  fxToggleEl.addEventListener('click', toggleFxPanel);

  document.querySelectorAll('.fxBtn').forEach((btn) => {
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

  fxResetEl.addEventListener('click', () => {
    activeFx.clear();
    document.querySelectorAll('.fxBtn').forEach((b) => b.classList.remove('active'));
    setLightMode('normal');
    if (noiseTimer) { clearInterval(noiseTimer); noiseTimer = null; }
    noiseLayerEl.classList.remove('active');
    hueSpinDeg = 0;
    applyScreenFilter();
  });

  // ---------------------------------------------------------------------
  // audio (ambient drone + footsteps), self-contained WebAudio
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
    convolver.buffer = makeImpulse(actx, 3.2, 2.4);
    reverbSend = actx.createGain();
    reverbSend.gain.value = 0.55;
    reverbSend.connect(convolver);
    convolver.connect(master);

    const padGain = actx.createGain();
    padGain.gain.value = 0.16;
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.7;

    const freqs = [55, 82.4, 110, 138.6];
    freqs.forEach((f, i) => {
      const osc = actx.createOscillator();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'sine';
      osc.frequency.value = f * (1 + rand(-0.003, 0.003));
      const g = actx.createGain();
      g.gain.value = 0.22 / (i + 1);
      osc.connect(g);
      g.connect(filter);
      osc.start();
    });
    filter.connect(padGain);
    padGain.connect(master);
    padGain.connect(reverbSend);

    const lfo = actx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = actx.createGain();
    lfoGain.gain.value = 380;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    scheduleBlip();
  }

  function scheduleBlip() {
    const delay = rand(14, 32);
    setTimeout(() => {
      if (actx && started) playBlip();
      scheduleBlip();
    }, delay * 1000);
  }

  function playBlip() {
    const osc = actx.createOscillator();
    osc.type = 'sine';
    const base = rand(500, 1400);
    osc.frequency.setValueAtTime(base, actx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(base * rand(0.5, 1.8), actx.currentTime + 0.4);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, actx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.9);
    const pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
    osc.connect(g);
    if (pan) { pan.pan.value = rand(-0.8, 0.8); g.connect(pan); pan.connect(master); pan.connect(reverbSend); }
    else { g.connect(master); g.connect(reverbSend); }
    osc.start();
    osc.stop(actx.currentTime + 1.0);
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
    g.gain.value = 0.28;
    stepSide *= -1;
    const pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
    src.connect(bp);
    bp.connect(g);
    if (pan) { pan.pan.value = stepSide * 0.25; g.connect(pan); pan.connect(master); pan.connect(reverbSend); }
    else { g.connect(master); g.connect(reverbSend); }
    src.start();
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
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------
  // main loop
  // ---------------------------------------------------------------------
  let curFog = hsl2rgb(gs.hue, 0.5, 0.09);
  let curFogDensity = 0.065;
  let curGrid = hsl2rgb(gs.hue + 180, 0.9, 0.62);
  let distSinceStep = 0;
  let lastT = performance.now();
  const WALK_SPEED = 2.6;

  // ---------------------------------------------------------------------
  // screen effects (a photobooth drawer of CSS filters + a couple of
  // shader/scene-level toggles for "lights on/off")
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
    const parts = [];
    activeFx.forEach((id) => { if (CSS_EFFECTS[id]) parts.push(CSS_EFFECTS[id]); });
    if (activeFx.has('blackout')) parts.push('brightness(0.55)');
    if (activeFx.has('lightsOn')) parts.push('brightness(1.25)');
    if (activeFx.has('hueSpin')) parts.push('hue-rotate(' + hueSpinDeg.toFixed(0) + 'deg)');
    const str = parts.length ? parts.join(' ') : 'none';
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

  function update(dt) {
    ensureCells(player.z);
    const cell = getCellAt(player.z) || { mode: 'interior', cx: 0, halfW: 3, fogColor: curFog, fogDensity: curFogDensity, gridColor: curGrid };

    let moveX = 0, moveZ = 0;
    if (paused) {
      // frozen
    } else if (started) {
      if (keys.f) moveZ += 1;
      if (keys.b) moveZ -= 1;
      if (keys.r) moveX += 1;
      if (keys.l) moveX -= 1;
      moveX += touchState.moveVec.x;
      moveZ += touchState.moveVec.z;
    } else {
      moveZ = 1; // idle demo drift before the player clicks start
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

    let desiredX = player.x + dx;
    let desiredZ = player.z + dz;
    const targetCell = getCellAt(desiredZ) || cell;

    if (targetCell.mode !== 'exterior') {
      const margin = 0.4;
      desiredX = clamp(desiredX, targetCell.cx - targetCell.halfW + margin, targetCell.cx + targetCell.halfW - margin);
    } else {
      desiredX = clamp(desiredX, targetCell.cx - targetCell.halfW + 1, targetCell.cx + targetCell.halfW - 1);
    }

    if (targetCell.mode === 'threshold') {
      const distToDoor = targetCell.z1 - player.z;
      if (distToDoor < 3.2) targetCell.doorOpen = clamp(targetCell.doorOpen + dt / 1.3, 0, 1);
      if (targetCell.doorOpen < 0.97 && desiredZ > targetCell.z1 - 0.55) desiredZ = targetCell.z1 - 0.55;
    }

    const moved = Math.hypot(desiredX - player.x, desiredZ - player.z);
    player.x = desiredX;
    player.z = desiredZ;

    if (moving && moved > 0.0001) {
      distSinceStep += moved;
      walkPhase += moved * 2.1;
      if (distSinceStep > 0.78) { distSinceStep = 0; playFootstep(); }
    }

    let doorOpen = 0;
    for (let i = 0; i < activeCells.length; i++) {
      if (activeCells[i].mode === 'threshold' && activeCells[i].z1 > player.z - 2 && activeCells[i].z0 < player.z + LOAD_AHEAD) {
        doorOpen = activeCells[i].doorOpen;
        break;
      }
    }

    const liveCell = getCellAt(player.z) || cell;
    const smoothing = 1 - Math.exp(-dt * 1.4);
    curFog = lerpColor(curFog, liveCell.fogColor, smoothing);
    fogMul = lerp(fogMul, targetFogMul, 1 - Math.exp(-dt * 3));
    curFogDensity = lerp(curFogDensity, liveCell.fogDensity * fogMul, smoothing);
    curGrid = lerpColor(curGrid, liveCell.gridColor, smoothing);
    brightBoost = lerp(brightBoost, targetBright, 1 - Math.exp(-dt * 10));

    if (activeFx.has('hueSpin')) {
      hueSpinDeg = (hueSpinDeg + dt * 70) % 360;
      applyScreenFilter();
    }

    const bob = Math.sin(walkPhase) * 0.045 * movingBlend;
    const roll = Math.sin(walkPhase * 0.5) * 0.012 * movingBlend;
    player.eyeY = 1.62 + bob;
    player.roll = roll;

    return doorOpen;
  }

  function render(doorOpen) {
    gl.clearColor(curFog[0], curFog[1], curFog[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const proj = mat4Perspective((72 * Math.PI) / 180, aspect, 0.08, 90);
    const view = buildViewMatrix({ x: player.x, y: player.eyeY, z: player.z }, player.yaw, player.pitch, player.roll || 0);
    const viewProj = mat4Multiply(proj, view);

    gl.uniformMatrix4fv(loc.uViewProj, false, viewProj);
    gl.uniform3f(loc.uCamPos, player.x, player.eyeY, player.z);
    gl.uniform1f(loc.uDoorOpen, doorOpen);
    gl.uniform1f(loc.uSnap, 130.0);
    gl.uniform3f(loc.uFogColor, curFog[0], curFog[1], curFog[2]);
    gl.uniform1f(loc.uFogDensity, curFogDensity);
    gl.uniform1f(loc.uBrightBoost, brightBoost);
    gl.uniform3f(loc.uGridColor, curGrid[0], curGrid[1], curGrid[2]);
    gl.uniform1f(loc.uTime, performance.now() / 1000);

    if (vertexCount > 0) gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const doorOpen = update(dt);
    render(doorOpen);
    requestAnimationFrame(frame);
  }

  ensureCells(player.z);
  requestAnimationFrame(frame);
})();
