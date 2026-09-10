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
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', depth: true, preserveDrawingBuffer: true });
  if (!gl) {
    document.body.innerHTML = '<p style="color:#f5e9e2;padding:2rem;font-family:monospace;">このブラウザは WebGL に対応していません。</p>';
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
        float period = 1.3;
        float col = floor(vWorldPos.x / period);
        float dir = (mod(col, 2.0) < 1.0) ? 1.0 : -1.0;
        float localX = fract(vWorldPos.x / period) * dir;
        float diag = vWorldPos.z / period + localX;
        float band = mod(floor(diag), 2.0);
        if (band < 0.5) base = mix(base, uGridColor, 0.6);
      } else if (vFloor > 0.5) {
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

  function pushWallWithGap(arr, x0, x1, y0, y1, z, color, gapX0, gapX1, gapY1) {
    if (gapX0 > x0) pushQuad(arr, [x0, y0, z], [gapX0, y0, z], [gapX0, y1, z], [x0, y1, z], color, 0);
    if (gapX1 < x1) pushQuad(arr, [gapX1, y0, z], [x1, y0, z], [x1, y1, z], [gapX1, y1, z], color, 0);
    if (gapY1 < y1) pushQuad(arr, [gapX0, gapY1, z], [gapX1, gapY1, z], [gapX1, y1, z], [gapX0, y1, z], color, 0);
  }

  function makeStaticVBO(arr) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    return { vbo: buf, count: arr.length / 7 };
  }

  // ---------------------------------------------------------------------
  // mannequin rig (shared low-poly parts, reused for NPCs and the
  // player's own avatar when the camera is pulled back)
  // ---------------------------------------------------------------------
  const MANNEQUIN_COLOR = [0.74, 0.71, 0.77];
  function buildMannequinParts() {
    const bodyArr = [];
    pushBox(bodyArr, 0, 0.28, 0, 0.38, 0.46, 0.2, MANNEQUIN_COLOR);
    pushBox(bodyArr, 0, 0.63, 0, 0.22, 0.22, 0.22, MANNEQUIN_COLOR);
    const armArr = [];
    pushBox(armArr, 0, -0.21, 0, 0.1, 0.42, 0.1, MANNEQUIN_COLOR);
    const legArr = [];
    pushBox(legArr, 0, -0.25, 0, 0.14, 0.5, 0.14, MANNEQUIN_COLOR);
    return { body: makeStaticVBO(bodyArr), arm: makeStaticVBO(armArr), leg: makeStaticVBO(legArr) };
  }
  const mannequin = buildMannequinParts();
  const HIP_HEIGHT = 0.85;

  function drawMannequin(x, groundY, z, yaw, walkPhase, blend) {
    const root = mat4Multiply(mat4Translation(x, groundY + HIP_HEIGHT, z), mat4RotateY(yaw));
    drawDynamic(mannequin.body, root);
    const legSwing = 0.55, armSwing = 0.4;
    for (let s = -1; s <= 1; s += 2) {
      const legAngle = Math.sin(walkPhase + (s < 0 ? 0 : Math.PI)) * legSwing * blend;
      const legM = mat4Multiply(root, mat4Multiply(mat4Translation(s * 0.11, 0, 0), mat4RotateX(legAngle)));
      drawDynamic(mannequin.leg, legM);
      const armAngle = Math.sin(walkPhase + (s < 0 ? Math.PI : 0)) * armSwing * blend;
      const armM = mat4Multiply(root, mat4Multiply(mat4Translation(s * 0.24, 0.48, 0), mat4RotateX(armAngle)));
      drawDynamic(mannequin.arm, armM);
    }
  }

  // ---------------------------------------------------------------------
  // doors: real hinged leaves, opened/closed by proximity, blocking
  // passage until sufficiently open
  // ---------------------------------------------------------------------
  const MAX_DOOR_ANGLE = 1.7;

  function makeDoor(cx, z, width, height, groundY, hue) {
    const hingeX = cx - width / 2;
    const arr = [];
    pushBox(arr, width / 2, height / 2, 0, width, height, 0.07, hsl2rgb((hue + 190) % 360, 0.5, 0.36));
    const info = makeStaticVBO(arr);
    return {
      z, hingeX, width, height, groundY, angle: 0, wantOpen: false,
      vbo: info.vbo, count: info.count,
    };
  }

  function updateDoors(dt, playerZ) {
    for (let i = 0; i < activeCells.length; i++) {
      const cell = activeCells[i];
      const d = cell.door;
      if (!d) continue;
      const triggerDist = cell.mode === 'portal' ? 3.6 : 2.5;
      d.wantOpen = Math.abs(playerZ - d.z) < triggerDist;
      const target = d.wantOpen ? MAX_DOOR_ANGLE : 0;
      d.angle = lerp(d.angle, target, 1 - Math.exp(-dt * 2.2));
    }
  }
  function drawDoors() {
    for (let i = 0; i < activeCells.length; i++) {
      const d = activeCells[i].door;
      if (!d) continue;
      const m = mat4Multiply(mat4Translation(d.hingeX, d.groundY, d.z), mat4RotateY(-d.angle));
      drawDynamic({ vbo: d.vbo, count: d.count }, m);
    }
  }

  // ---------------------------------------------------------------------
  // procedural world generation
  // ---------------------------------------------------------------------
  const gs = { z: 0, y: 0, cx: 0, hue: rand(0, 360), mode: 'interior', counter: randInt(4, 7), first: true, exteriorFirst: false };

  function makeInteriorRoom() {
    const depth = rand(4.5, 7);
    const halfW = rand(1.8, 2.6);
    const height = rand(2.3, 2.8);
    gs.cx = clamp(gs.cx + rand(-0.35, 0.35), -2.2, 2.2);
    gs.hue = (gs.hue + rand(-6, 6) + 360) % 360;

    const roll = Math.random();
    const gimmick = roll < 0.13 ? 'inverted' : (roll < 0.25 ? 'shrink' : 'normal');
    const zigzag = Math.random() < 0.3;

    const wallColor = hsl2rgb(gs.hue, 0.4, 0.15);
    const floorColor = hsl2rgb(gs.hue + 10, 0.38, 0.09);
    const ceilColor = hsl2rgb(gs.hue - 20, 0.3, 0.07);
    const gridColor = hsl2rgb(gs.hue + 180, 0.85, 0.55);
    const furnitureColor = hsl2rgb((gs.hue + 340) % 360, 0.55, 0.26);
    const lampColor = hsl2rgb(44, 0.9, 0.6);
    const fogColor = hsl2rgb(gs.hue, 0.4, 0.045);
    const z0 = gs.z, z1 = gs.z + depth; gs.z = z1;
    const floorY0 = gs.y, floorY1 = gs.y;
    const doorWidth = rand(1.0, 1.25);

    const cell = {
      mode: 'interior', z0, z1, floorY0, floorY1, cx: gs.cx, halfW, height,
      wallColor, floorColor, ceilColor, gridColor, furnitureColor, lampColor, fogColor,
      fogDensity: 0.078, gimmick, zigzag, first: gs.first,
      hasBed: Math.random() < 0.72, hasLamp: Math.random() < 0.5,
    };
    gs.first = false;

    if (cell.hasBed) {
      const w = rand(1.5, 1.9), d = rand(0.95, 1.25), h = rand(0.42, 0.52);
      cell.bed = { x: cell.cx + rand(-0.25, 0.25), z: cell.z0 + (cell.z1 - cell.z0) * rand(0.4, 0.58), w, d, h };
    }
    if (cell.hasLamp) {
      const side = Math.random() < 0.5 ? -1 : 1;
      cell.lamp = { x: cell.cx + side * (cell.halfW - 0.32), z: cell.z0 + (cell.z1 - cell.z0) * rand(0.2, 0.8), h: rand(0.5, 0.7) };
    }

    cell.door = makeDoor(cell.cx, z1, doorWidth, Math.min(cell.height - 0.25, 2.1), floorY1, gs.hue);
    return cell;
  }

  function makeStairsRoom() {
    const depth = rand(8, 12);
    const halfW = rand(1.3, 1.7);
    const clearance = 2.3;
    const rise = rand(2.2, 3.4) * (Math.random() < 0.5 ? 1 : -1);
    gs.hue = (gs.hue + rand(-6, 6) + 360) % 360;
    const wallColor = hsl2rgb(gs.hue, 0.14, 0.1);
    const floorColor = hsl2rgb(gs.hue, 0.12, 0.08);
    const gridColor = hsl2rgb(gs.hue + 40, 0.7, 0.55);
    const fogColor = hsl2rgb(gs.hue, 0.2, 0.03);
    const z0 = gs.z, z1 = gs.z + depth; gs.z = z1;
    const floorY0 = gs.y, floorY1 = gs.y + rise; gs.y = floorY1;
    const doorWidth = 1.1;
    const cell = {
      mode: 'stairs', z0, z1, floorY0, floorY1, cx: gs.cx, halfW, height: clearance,
      wallColor, floorColor, ceilColor: wallColor, gridColor, fogColor,
      fogDensity: 0.11, gimmick: 'normal', zigzag: false, hasBed: false, hasLamp: false,
    };
    cell.door = makeDoor(cell.cx, z1, doorWidth, clearance - 0.2, floorY1, gs.hue);
    return cell;
  }

  function makePortalRoom(toExterior) {
    const depth = rand(3, 4);
    const halfW = 2.0;
    const height = 2.6;
    const wallColor = hsl2rgb(gs.hue, 0.28, 0.11);
    const floorColor = hsl2rgb(gs.hue, 0.22, 0.06);
    const gridColor = hsl2rgb(gs.hue + 180, 0.9, 0.6);
    const fogColor = hsl2rgb(gs.hue, 0.28, 0.02);
    const z0 = gs.z, z1 = gs.z + depth; gs.z = z1;
    const floorY0 = gs.y, floorY1 = gs.y;
    const doorWidth = 2.0;
    const cell = {
      mode: 'portal', toExterior, z0, z1, floorY0, floorY1, cx: gs.cx, halfW, height,
      wallColor, floorColor, ceilColor: wallColor, gridColor, fogColor,
      fogDensity: 0.095, gimmick: 'normal', zigzag: true, hasBed: false, hasLamp: false,
    };
    cell.door = makeDoor(cell.cx, z1, doorWidth, height - 0.3, floorY1, gs.hue);
    return cell;
  }

  function makeExteriorStretch(isFirst) {
    const depth = rand(9, 14);
    const halfW = rand(9, 16);
    gs.cx = clamp(gs.cx + rand(-1, 1), -6, 6);
    gs.hue = (gs.hue + rand(-5, 5) + 360) % 360;
    const floorColor = hsl2rgb(gs.hue, 0.3, 0.07);
    const gridColor = hsl2rgb(gs.hue + 190, 0.7, 0.5);
    const fogColor = hsl2rgb(gs.hue + 15, 0.4, 0.17);
    const z0 = gs.z, z1 = gs.z + depth; gs.z = z1;
    const floorY0 = gs.y, floorY1 = gs.y;
    const cell = {
      mode: 'exterior', z0, z1, floorY0, floorY1, cx: gs.cx, halfW, height: 0,
      floorColor, gridColor, fogColor, fogDensity: 0.05, hasBed: false, hasLamp: false, gimmick: 'normal', zigzag: false,
    };
    const n = randInt(2, 4);
    const silhouettes = [];
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const dist = rand(halfW + 6, halfW + 26);
      silhouettes.push({ x: cell.cx + side * dist, z: rand(z0, z1), h: rand(4, 16), w: rand(1.2, 3.4), d: rand(1.2, 3.4), color: mulColor(fogColor, 0.3) });
    }
    cell.silhouettes = silhouettes;

    if (isFirst) {
      const towerX = cell.cx + (Math.random() < 0.5 ? -1 : 1) * rand(halfW + 10, halfW + 20);
      const towerZ = rand(z0 + depth * 0.3, z1 - 1);
      const segs = randInt(9, 14);
      const tower = [];
      let tx = towerX, tz = towerZ, ty = 0;
      for (let i = 0; i < segs; i++) {
        const segH = rand(3.5, 5.5);
        const segW = rand(2.2, 4.2);
        tower.push({ x: tx, y: ty + segH / 2, z: tz, w: segW, h: segH, d: segW, color: mulColor(fogColor, 0.26 + i * 0.01) });
        ty += segH;
        tx += rand(-0.9, 0.9);
        tz += rand(-0.9, 0.9);
      }
      cell.tower = tower;
    }

    const npcCount = randInt(1, 3);
    const npcs = [];
    for (let i = 0; i < npcCount; i++) {
      const xMin = cell.cx - Math.min(halfW * 0.55, 7);
      const xMax = cell.cx + Math.min(halfW * 0.55, 7);
      npcs.push({
        z: rand(z0 + 2, z1 - 2), xMin, xMax, x: rand(xMin, xMax),
        dir: Math.random() < 0.5 ? 1 : -1, speed: rand(0.5, 1.0), phase: rand(0, Math.PI * 2),
      });
    }
    cell.npcs = npcs;
    return cell;
  }

  function nextCell() {
    let cell;
    if (gs.mode === 'interior') {
      cell = (!gs.first && Math.random() < 0.22) ? makeStairsRoom() : makeInteriorRoom();
      gs.counter--;
      if (gs.counter <= 0) gs.mode = 'toExit';
    } else if (gs.mode === 'toExit') {
      cell = makePortalRoom(true);
      gs.mode = 'exterior';
      gs.counter = randInt(3, 5);
      gs.exteriorFirst = true;
    } else if (gs.mode === 'exterior') {
      cell = makeExteriorStretch(gs.exteriorFirst);
      gs.exteriorFirst = false;
      gs.counter--;
      if (gs.counter <= 0) gs.mode = 'toEntrance';
    } else {
      cell = makePortalRoom(false);
      gs.hue = (gs.hue + rand(110, 220)) % 360;
      gs.mode = 'interior';
      gs.counter = randInt(4, 7);
    }
    cell.geometry = buildCellGeometry(cell);
    return cell;
  }

  function buildCellGeometry(cell) {
    const arr = [];
    if (cell.mode === 'exterior') {
      pushQuad(arr,
        [cell.cx - cell.halfW, cell.floorY0, cell.z0], [cell.cx + cell.halfW, cell.floorY0, cell.z0],
        [cell.cx + cell.halfW, cell.floorY0, cell.z1], [cell.cx - cell.halfW, cell.floorY0, cell.z1],
        cell.floorColor, 1);
      for (let i = 0; i < cell.silhouettes.length; i++) {
        const s = cell.silhouettes[i];
        pushBox(arr, s.x, s.h / 2, s.z, s.w, s.h, s.d, s.color);
      }
      if (cell.tower) for (let i = 0; i < cell.tower.length; i++) {
        const s = cell.tower[i];
        pushBox(arr, s.x, s.y, s.z, s.w, s.h, s.d, s.color);
      }
      return new Float32Array(arr);
    }

    const x0 = cell.cx - cell.halfW, x1 = cell.cx + cell.halfW;

    if (cell.mode === 'stairs') {
      const stepCount = randInt(12, 16);
      const stepDepth = (cell.z1 - cell.z0) / stepCount;
      const rise = cell.floorY1 - cell.floorY0;
      const stepRise = rise / stepCount;
      let prevY = cell.floorY0;
      for (let i = 0; i < stepCount; i++) {
        const zA = cell.z0 + i * stepDepth, zB = zA + stepDepth;
        const treadY = cell.floorY0 + (i + 1) * stepRise;
        pushQuad(arr, [x0, treadY, zA], [x1, treadY, zA], [x1, treadY, zB], [x0, treadY, zB], cell.floorColor, 1);
        pushQuad(arr, [x0, prevY, zA], [x1, prevY, zA], [x1, treadY, zA], [x0, treadY, zA], mulColor(cell.floorColor, 0.6), 0);
        prevY = treadY;
      }
      const cTop0 = cell.floorY0 + cell.height, cTop1 = cell.floorY1 + cell.height;
      pushQuad(arr, [x0, cTop0, cell.z0], [x0, cTop1, cell.z1], [x1, cTop1, cell.z1], [x1, cTop0, cell.z0], cell.ceilColor, 0);
      const wallTop = Math.max(cTop0, cTop1) + 0.1, wallBot = Math.min(cell.floorY0, cell.floorY1) - 0.6;
      pushQuad(arr, [x0, wallBot, cell.z0], [x0, wallTop, cell.z0], [x0, wallTop, cell.z1], [x0, wallBot, cell.z1], cell.wallColor, 0);
      pushQuad(arr, [x1, wallBot, cell.z0], [x1, wallBot, cell.z1], [x1, wallTop, cell.z1], [x1, wallTop, cell.z0], cell.wallColor, 0);
    } else {
      const surfCode = cell.zigzag ? 2 : 1;
      let floorCode = surfCode, ceilCode = 0;
      if (cell.gimmick === 'inverted') { floorCode = 0; ceilCode = surfCode; }
      pushQuad(arr, [x0, cell.floorY0, cell.z0], [x1, cell.floorY0, cell.z0], [x1, cell.floorY0, cell.z1], [x0, cell.floorY0, cell.z1], cell.floorColor, floorCode);
      const ceilY = cell.floorY0 + cell.height;
      pushQuad(arr, [x0, ceilY, cell.z0], [x0, ceilY, cell.z1], [x1, ceilY, cell.z1], [x1, ceilY, cell.z0], cell.ceilColor, ceilCode);
      pushQuad(arr, [x0, cell.floorY0, cell.z0], [x0, ceilY, cell.z0], [x0, ceilY, cell.z1], [x0, cell.floorY0, cell.z1], cell.wallColor, 0);
      pushQuad(arr, [x1, cell.floorY0, cell.z0], [x1, cell.floorY0, cell.z1], [x1, ceilY, cell.z1], [x1, ceilY, cell.z0], cell.wallColor, 0);

      if (cell.first) {
        pushQuad(arr, [x0, cell.floorY0, cell.z0], [x1, cell.floorY0, cell.z0], [x1, ceilY, cell.z0], [x0, ceilY, cell.z0], cell.wallColor, 0);
      }

      if (cell.hasBed) {
        const b = cell.bed;
        const by = cell.gimmick === 'inverted' ? (ceilY - b.h / 2) : (cell.floorY0 + b.h / 2);
        pushBox(arr, b.x, by, b.z, b.w, b.h, b.d, cell.furnitureColor);
      }
      if (cell.hasLamp) {
        const l = cell.lamp;
        const ly = cell.gimmick === 'inverted' ? (ceilY - l.h / 2) : (cell.floorY0 + l.h / 2);
        pushBox(arr, l.x, ly, l.z, 0.22, l.h, 0.22, cell.lampColor);
      }
    }

    const ceilYFar = (cell.mode === 'stairs') ? (cell.floorY1 + cell.height) : (cell.floorY0 + cell.height);
    const gapX0 = cell.door.hingeX, gapX1 = cell.door.hingeX + cell.door.width, gapY1 = cell.door.groundY + cell.door.height;
    pushWallWithGap(arr, x0, x1, cell.floorY1, ceilYFar, cell.z1, cell.wallColor, gapX0, gapX1, gapY1);

    return new Float32Array(arr);
  }

  const LOAD_AHEAD = 42;
  const PRUNE_BEHIND = 16;
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
    vertexCount = total / 7;
  }

  function ensureCells(playerZ) {
    let changed = false;
    while (activeCells.length === 0 || activeCells[activeCells.length - 1].z1 < playerZ + LOAD_AHEAD) {
      activeCells.push(nextCell());
      changed = true;
    }
    while (activeCells.length && activeCells[0].z1 < playerZ - PRUNE_BEHIND) {
      const old = activeCells.shift();
      if (old.door && old.door.vbo) gl.deleteBuffer(old.door.vbo);
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

  function floorHeightAt(cell, z) {
    if (!cell) return 0;
    if (cell.mode === 'stairs') {
      const t = clamp((z - cell.z0) / Math.max(0.001, cell.z1 - cell.z0), 0, 1);
      return lerp(cell.floorY0, cell.floorY1, t);
    }
    return cell.floorY0;
  }

  const FALLBACK_CELL = { mode: 'interior', cx: 0, halfW: 2, floorY0: 0, fogColor: hsl2rgb(gs.hue, 0.4, 0.045), fogDensity: 0.078, gridColor: hsl2rgb(gs.hue + 180, 0.85, 0.55), gimmick: 'normal' };

  // ---------------------------------------------------------------------
  // exterior mannequins
  // ---------------------------------------------------------------------
  function updateNpcs(dt) {
    for (let i = 0; i < activeCells.length; i++) {
      const cell = activeCells[i];
      if (cell.mode !== 'exterior' || !cell.npcs) continue;
      for (let j = 0; j < cell.npcs.length; j++) {
        const n = cell.npcs[j];
        n.x += n.dir * n.speed * dt;
        if (n.x > n.xMax) { n.x = n.xMax; n.dir = -1; }
        if (n.x < n.xMin) { n.x = n.xMin; n.dir = 1; }
        n.phase += n.speed * dt * 3.2;
      }
    }
  }
  function drawNpcs() {
    for (let i = 0; i < activeCells.length; i++) {
      const cell = activeCells[i];
      if (cell.mode !== 'exterior' || !cell.npcs) continue;
      for (let j = 0; j < cell.npcs.length; j++) {
        const n = cell.npcs[j];
        const yaw = n.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        drawMannequin(n.x, cell.floorY0, n.z, yaw, n.phase, 1.0);
      }
    }
  }

  // ---------------------------------------------------------------------
  // player + input (keyboard/mouse for desktop, drag for touch, with
  // Pointer Lock used opportunistically and a drag-look fallback for
  // sandboxes that don't grant it)
  // ---------------------------------------------------------------------
  const player = { x: 0, y: 0, z: 0.8, yaw: 0, pitch: 0, groundY: 0, eyeY: 1.62 };
  const keys = Object.create(null);
  let locked = false;
  let started = false;
  let paused = false;
  let justLocked = false;
  let walkPhase = 0;
  let movingBlend = 0;
  let cameraMode = 'first';
  const LOOK_SENS = 0.0024;

  const startScreenEl = document.getElementById('startScreen');
  const pauseScreenEl = document.getElementById('pauseScreen');
  const hintEl = document.getElementById('hint');
  const camToggleEl = document.getElementById('camToggle');
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
    if (e.code === 'KeyC' && started && !paused) toggleCamera();
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

  function toggleCamera() {
    cameraMode = cameraMode === 'first' ? 'third' : 'first';
    camToggleEl.classList.toggle('third', cameraMode === 'third');
  }
  camToggleEl.addEventListener('click', toggleCamera);

  document.getElementById('startBtn').addEventListener('click', () => {
    started = true;
    paused = false;
    startScreenEl.classList.add('hidden');
    hintEl.classList.add('visible');
    fxToggleEl.classList.add('visible');
    camToggleEl.classList.add('visible');
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
    padGain.gain.value = 0.14;
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.7;

    const freqs = [49, 73.4, 98, 123.5];
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
    lfo.frequency.value = 0.04;
    const lfoGain = actx.createGain();
    lfoGain.gain.value = 320;
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
    const base = rand(300, 900);
    osc.frequency.setValueAtTime(base, actx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(base * rand(0.5, 1.6), actx.currentTime + 0.5);
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
    g.gain.value = 0.26;
    stepSide *= -1;
    const pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
    src.connect(bp);
    bp.connect(g);
    if (pan) { pan.pan.value = stepSide * 0.25; g.connect(pan); pan.connect(master); pan.connect(reverbSend); }
    else { g.connect(master); g.connect(reverbSend); }
    src.start();
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
  // retro-bug glitch drawer (same five failure modes as VACANCY)
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
    const cell = getCellAt(player.z);
    return [
      'SEG_FAULT @ ' + hex(),
      'PLR X=' + player.x.toFixed(2) + ' Y=' + player.eyeY.toFixed(2) + ' Z=' + player.z.toFixed(2),
      'ROOM ' + (cell ? cell.mode.toUpperCase() : '???') + ' GIMMICK=' + (cell ? cell.gimmick : '?') + ' HUE=' + gs.hue.toFixed(1),
      'VTX=' + vertexCount + ' CELLS=' + activeCells.length + ' CAM=' + cameraMode.toUpperCase(),
      hex() + ' ' + hex() + ' ' + hex() + ' ' + hex(),
      'GUEST LOG: ' + String.fromCharCode(0x25a0, 0x25b2, 0x2665) + hex(),
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
  let curFog = hsl2rgb(gs.hue, 0.4, 0.045);
  let curFogDensity = 0.078;
  let curGrid = hsl2rgb(gs.hue + 180, 0.85, 0.55);
  let distSinceStep = 0;
  let lastT = performance.now();
  const WALK_SPEED = 2.4;
  let eyeHeightCur = 1.62, eyeHeightTarget = 1.62;
  let speedMul = 1.0, speedMulTarget = 1.0;

  function computeCameraEye() {
    if (cameraMode === 'first') return { x: player.x, y: player.eyeY, z: player.z };
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const chaseDist = 2.3;
    return { x: player.x - sy * chaseDist, y: player.groundY + 1.95, z: player.z - cy * chaseDist };
  }

  function update(dt) {
    ensureCells(player.z);
    const cell = getCellAt(player.z) || FALLBACK_CELL;

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
      moveZ = 1;
    }

    const moving = (Math.abs(moveX) > 0.01 || Math.abs(moveZ) > 0.01);
    let dx = 0, dz = 0;
    if (moving) {
      const len = Math.max(1, Math.hypot(moveX, moveZ));
      moveX /= len; moveZ /= len;
      const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
      const speed = WALK_SPEED * speedMul * (started ? 1 : 0.6) * dt;
      dx = (sy * moveZ + cy * moveX) * speed;
      dz = (cy * moveZ - sy * moveX) * speed;
    }
    movingBlend = lerp(movingBlend, moving ? 1 : 0, 1 - Math.exp(-dt * 6));

    let desiredX = player.x + dx;
    let desiredZ = player.z + dz;
    const targetCell = getCellAt(desiredZ) || cell;

    if (targetCell.mode !== 'exterior') {
      const margin = 0.35;
      desiredX = clamp(desiredX, targetCell.cx - targetCell.halfW + margin, targetCell.cx + targetCell.halfW - margin);
    } else {
      desiredX = clamp(desiredX, targetCell.cx - targetCell.halfW + 1, targetCell.cx + targetCell.halfW - 1);
    }

    if (targetCell !== cell && cell.door && desiredZ > player.z) {
      const openFrac = cell.door.angle / MAX_DOOR_ANGLE;
      if (openFrac < 0.5 && desiredZ > cell.z1 - 0.4) desiredZ = cell.z1 - 0.4;
    }

    const moved = Math.hypot(desiredX - player.x, desiredZ - player.z);
    player.x = desiredX;
    player.z = desiredZ;

    if (moving && moved > 0.0001) {
      distSinceStep += moved;
      walkPhase += moved * 2.3;
      if (distSinceStep > 0.72) { distSinceStep = 0; playFootstep(); }
    }

    updateDoors(dt, player.z);
    updateNpcs(dt);

    const liveCell = getCellAt(player.z) || cell;
    const smoothing = 1 - Math.exp(-dt * 1.4);
    curFog = lerpColor(curFog, liveCell.fogColor, smoothing);
    fogMul = lerp(fogMul, targetFogMul, 1 - Math.exp(-dt * 3));
    curFogDensity = lerp(curFogDensity, liveCell.fogDensity * fogMul, smoothing);
    curGrid = lerpColor(curGrid, liveCell.gridColor || curGrid, smoothing);
    brightBoost = lerp(brightBoost, targetBright, 1 - Math.exp(-dt * 10));

    if (activeFx.has('hueSpin')) { hueSpinDeg = (hueSpinDeg + dt * 70) % 360; applyScreenFilter(); }

    eyeHeightTarget = liveCell.gimmick === 'shrink' ? 0.85 : 1.62;
    speedMulTarget = liveCell.gimmick === 'shrink' ? 0.58 : 1.0;
    eyeHeightCur = lerp(eyeHeightCur, eyeHeightTarget, 1 - Math.exp(-dt * 2.4));
    speedMul = lerp(speedMul, speedMulTarget, 1 - Math.exp(-dt * 2.4));

    const groundYTarget = floorHeightAt(liveCell, player.z);
    player.groundY = lerp(player.groundY, groundYTarget, 1 - Math.exp(-dt * 9));

    const bob = Math.sin(walkPhase) * 0.045 * movingBlend;
    const roll = Math.sin(walkPhase * 0.5) * 0.012 * movingBlend;
    player.eyeY = player.groundY + eyeHeightCur + bob;
    player.roll = roll;
  }

  function render() {
    gl.clearColor(curFog[0], curFog[1], curFog[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const proj = mat4Perspective((72 * Math.PI) / 180, aspect, 0.08, 90);
    const eye = computeCameraEye();
    const view = buildViewMatrix(eye, player.yaw, player.pitch, cameraMode === 'first' ? (player.roll || 0) : 0);
    const viewProj = mat4Multiply(proj, view);

    gl.uniformMatrix4fv(loc.uViewProj, false, viewProj);
    gl.uniform3f(loc.uCamPos, eye.x, eye.y, eye.z);
    gl.uniform1f(loc.uSnap, 130.0);
    gl.uniform3f(loc.uFogColor, curFog[0], curFog[1], curFog[2]);
    gl.uniform1f(loc.uFogDensity, curFogDensity);
    gl.uniform1f(loc.uBrightBoost, brightBoost);
    gl.uniform3f(loc.uGridColor, curGrid[0], curGrid[1], curGrid[2]);
    gl.uniform1f(loc.uTime, performance.now() / 1000);

    if (vertexCount > 0) {
      bindForDraw(vbo);
      gl.uniformMatrix4fv(loc.uModel, false, IDENTITY);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }

    drawDoors();
    drawNpcs();
    if (cameraMode === 'third') drawMannequin(player.x, player.groundY, player.z, player.yaw, walkPhase, movingBlend);
  }

  function frame(nowMs) {
    const dt = Math.min(0.05, (nowMs - lastT) / 1000);
    lastT = nowMs;
    const now = nowMs / 1000;
    const frozen = !!(glitchBurst && glitchBurst.type === 'freeze');
    if (!frozen) update(dt);
    render();
    updateGlitchSystem(now);
    requestAnimationFrame(frame);
  }

  ensureCells(player.z);
  requestAnimationFrame(frame);
})();
