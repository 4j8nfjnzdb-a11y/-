import * as THREE from './three.module.min.js';

/* ============================================================
   ROOM 303 — a low-poly love-hotel suite that starts to lie to you.
   Walk it, sit on the sofa, look down on it from above, examine
   things up close, and press EFFECT to make the walls stop
   agreeing with the floor. A corridor leads to a second room that
   remembers you wrong.
   ============================================================ */

const canvasProbe = document.createElement('canvas');
const hasWebGL2 = !!(window.WebGLRenderingContext && canvasProbe.getContext('webgl2'));
if (!hasWebGL2) {
  const unsupportedEl = document.getElementById('unsupported');
  if (unsupportedEl) unsupportedEl.style.display = 'flex';
  throw new Error('WebGL2 not supported');
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const ROOM = { halfW: 4.4, halfD: 2.9, height: 3.15 };
const DOORWAY_HALF = 0.8;
const CORR_HALF = 0.8;
const CORR_LEN = 3.4;
const ROOM2_Z = ROOM.halfD + CORR_LEN + ROOM.halfD; // center-z of the second room
const SPEED = 1.3;
const EYE_HEIGHT = 1.62;

const SIT_POS = new THREE.Vector3(2.7, 0.92, 0.42);
const TV_LOOK = new THREE.Vector3(-3.55, 0.85, 0.5);
const SOFA_SEAT = { x: 3.35, z: 0.5, radius: 1.15 };

const obstacles = [
  { x: 0, z: -1.95, r: 1.45 },              // room 303 bed
  { x: 3.35, z: 0.5, r: 0.85 },             // sofa
  { x: -3.5, z: 0.5, r: 0.72 },             // dresser
  { x: 0, z: ROOM2_Z + 1.95, r: 1.45 },     // room 304 bed
];

// Walkable area as a chain of overlapping rectangles (room / corridor /
// room), so a plain "clamp to nearest rectangle" collision scheme handles
// multi-room movement without a real navmesh.
const CELLS = [
  { xMin: -ROOM.halfW + 0.35, xMax: ROOM.halfW - 0.35, zMin: -ROOM.halfD + 0.35, zMax: ROOM.halfD - 0.35 },
  { xMin: -(CORR_HALF - 0.35), xMax: CORR_HALF - 0.35, zMin: ROOM.halfD - 0.35, zMax: ROOM.halfD + CORR_LEN + 0.35 },
  { xMin: -ROOM.halfW + 0.35, xMax: ROOM.halfW - 0.35, zMin: ROOM2_Z - ROOM.halfD + 0.35, zMax: ROOM2_Z + ROOM.halfD - 0.35 },
];

// ---------------------------------------------------------------
// Renderer / scene / cameras
// ---------------------------------------------------------------

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0104, 0.055);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 60);
camera.rotation.order = 'YXZ';

const mirrorCamera = new THREE.PerspectiveCamera(62, 320 / 600, 0.05, 30);
mirrorCamera.layers.enable(1);

// A generic Object3D's lookAt() orients it with the opposite convention from
// a camera's (+Z-toward-target vs -Z-toward-target), so a plain Object3D used
// here would leave the real camera facing away from the intended target.
// Using a camera avoids that mismatch.
const dummy = new THREE.PerspectiveCamera();

const rtSize = new THREE.Vector2();
renderer.getDrawingBufferSize(rtSize);
const sceneRT = new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, { colorSpace: THREE.SRGBColorSpace });
const mirrorRT = new THREE.WebGLRenderTarget(320, 600, { colorSpace: THREE.SRGBColorSpace });

// ---------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------

function makeCanvasTexture(draw, w = 256, h = 256) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const wallpaperTex = makeCanvasTexture((ctx, w, h) => {
  ctx.fillStyle = '#641a26';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(140, 25, 45, 0.55)';
  ctx.lineWidth = 3;
  for (let x = -h; x < w + h; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.ellipse(Math.random() * w, Math.random() * h, 10 + Math.random() * 26, 6 + Math.random() * 14, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}, 256, 256);
wallpaperTex.repeat.set(3, 1.4);

const corridorPaperTex = makeCanvasTexture((ctx, w, h) => {
  ctx.fillStyle = '#3a0d18';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(90, 15, 30, 0.6)';
  ctx.lineWidth = 2;
  for (let y = 0; y < h; y += 14) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}, 128, 128);
corridorPaperTex.repeat.set(1, 3);

const carpetTex = makeCanvasTexture((ctx, w, h) => {
  ctx.fillStyle = '#210408';
  ctx.fillRect(0, 0, w, h);
  const cell = 16;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const diamond = ((x / cell + Math.floor(y / cell)) % 2) === 0;
      ctx.fillStyle = diamond ? 'rgba(70,10,40,0.7)' : 'rgba(15,60,60,0.35)';
      ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 900; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}, 256, 256);
carpetTex.repeat.set(4, 3);

const tvCanvas = document.createElement('canvas');
tvCanvas.width = 64; tvCanvas.height = 48;
const tvCtx = tvCanvas.getContext('2d');
const tvTex = new THREE.CanvasTexture(tvCanvas);
tvTex.magFilter = THREE.NearestFilter;
tvTex.minFilter = THREE.NearestFilter;
tvTex.colorSpace = THREE.SRGBColorSpace;

function updateTV(glitch) {
  const w = tvCanvas.width, h = tvCanvas.height;
  const img = tvCtx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  tvCtx.putImageData(img, 0, 0);
  if (Math.random() < 0.06 + glitch * 0.5) {
    tvCtx.fillStyle = `hsl(${Math.random() * 360},85%,55%)`;
    tvCtx.fillRect(0, Math.random() * h, w, 2 + Math.random() * 5);
  }
  tvTex.needsUpdate = true;
}

// ---------------------------------------------------------------
// Wobbling room-shell shader (walls / floor / ceiling)
// ---------------------------------------------------------------

const WOBBLE_VERT = `
  uniform float uTime;
  uniform float uGlitch;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec3 p = position;
    float wave = sin(p.x * 2.3 + uTime * 2.6) * cos(p.y * 1.9 - uTime * 1.8);
    p += normal * wave * 0.05 * uGlitch;
    float cell = floor((p.x + p.y) * 2.5);
    float jitter = step(0.986, fract(sin(cell * 12.9898 + floor(uTime * 9.0) * 78.233) * 43758.5453));
    p += normal * jitter * 0.14 * uGlitch;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const WOBBLE_FRAG = `
  uniform vec3 uColor;
  uniform vec3 uLightDir;
  uniform float uAmbient;
  uniform sampler2D uMap;
  uniform float uHasMap;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vec3 base = uColor;
    if (uHasMap > 0.5) base *= texture2D(uMap, vUv).rgb;
    float diff = max(dot(vNormal, uLightDir), 0.0);
    vec3 col = base * (uAmbient + (1.0 - uAmbient) * diff);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const wobbleMaterials = [];

function makeWobbleMaterial(colorHex, mapTex) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGlitch: { value: 0 },
      uColor: { value: new THREE.Color(colorHex) },
      uLightDir: { value: new THREE.Vector3(0.45, 0.75, 0.4).normalize() },
      uAmbient: { value: 0.78 },
      uMap: { value: mapTex || null },
      uHasMap: { value: mapTex ? 1.0 : 0.0 },
    },
    vertexShader: WOBBLE_VERT,
    fragmentShader: WOBBLE_FRAG,
    side: THREE.FrontSide,
  });
  wobbleMaterials.push(mat);
  return mat;
}

function addShellPlane(w, h, x, y, z, rotY, mapTex) {
  const segW = Math.max(6, Math.round(w * 4));
  const segH = Math.max(6, Math.round(h * 4));
  const geo = new THREE.PlaneGeometry(w, h, segW, segH);
  const mesh = new THREE.Mesh(geo, makeWobbleMaterial(0xffffff, mapTex || wallpaperTex));
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  scene.add(mesh);
  return mesh;
}

// A wall spanning [x-w/2, x+w/2] on its local axis; when hasGap is true a
// DOORWAY_HALF-wide opening is left at its center so rooms can connect.
function addWallMaybeGap(w, h, x, y, z, rotY, hasGap) {
  if (!hasGap) { addShellPlane(w, h, x, y, z, rotY); return; }
  const halfW = w / 2;
  const segWidth = halfW - DOORWAY_HALF;
  const leftCenter = x - DOORWAY_HALF - segWidth / 2;
  const rightCenter = x + DOORWAY_HALF + segWidth / 2;
  addShellPlane(segWidth, h, leftCenter, y, z, rotY);
  addShellPlane(segWidth, h, rightCenter, y, z, rotY);
}

const ceilingMeshes = [];
const ceilingFixtures = [];

// doorSign: -1 => opening in the wall at centerZ-halfD, +1 => at centerZ+halfD, 0 => sealed
function buildRoomShell(centerZ, doorSign) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.halfW * 2, ROOM.halfD * 2, 36, 24),
    makeWobbleMaterial(0xb0b0b0, carpetTex)
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = centerZ;
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.halfW * 2, ROOM.halfD * 2, 24, 16),
    makeWobbleMaterial(0x180a10, null)
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, ROOM.height, centerZ);
  scene.add(ceiling);
  ceilingMeshes.push(ceiling);

  addWallMaybeGap(ROOM.halfW * 2, ROOM.height, 0, ROOM.height / 2, centerZ - ROOM.halfD, 0, doorSign === -1);
  addWallMaybeGap(ROOM.halfW * 2, ROOM.height, 0, ROOM.height / 2, centerZ + ROOM.halfD, Math.PI, doorSign === 1);
  addShellPlane(ROOM.halfD * 2, ROOM.height, -ROOM.halfW, ROOM.height / 2, centerZ, Math.PI / 2);
  addShellPlane(ROOM.halfD * 2, ROOM.height, ROOM.halfW, ROOM.height / 2, centerZ, -Math.PI / 2);
}

function buildCorridor() {
  const z0 = ROOM.halfD, z1 = ROOM.halfD + CORR_LEN;
  const len = z1 - z0;
  const cz = (z0 + z1) / 2;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(CORR_HALF * 2, len, 6, 20), makeWobbleMaterial(0x9a9a9a, carpetTex));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, cz);
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(CORR_HALF * 2, len, 6, 20), makeWobbleMaterial(0x140810, null));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, ROOM.height, cz);
  scene.add(ceiling);
  ceilingMeshes.push(ceiling);

  addShellPlane(len, ROOM.height, -CORR_HALF, ROOM.height / 2, cz, Math.PI / 2, corridorPaperTex);
  addShellPlane(len, ROOM.height, CORR_HALF, ROOM.height / 2, cz, -Math.PI / 2, corridorPaperTex);

  const corridorLight = new THREE.PointLight(0xff4d6a, 8, 6, 1.4);
  corridorLight.position.set(0, ROOM.height - 0.3, cz);
  scene.add(corridorLight);
  return corridorLight;
}

// ---------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------

// wrong === true builds the room-304 variant: same bed, rotated to face the
// doorway instead of away from it, and shifted to the room's far wall.
function buildBed(centerZ, wrong) {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a0f14, flatShading: true, roughness: 0.9 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.32, 1.9), frameMat);
  frame.position.y = 0.16;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.26, 1.8),
    new THREE.MeshStandardMaterial({ color: wrong ? 0x581018 : 0x7a1020, flatShading: true, roughness: 0.75 }));
  mattress.position.y = 0.45;
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x3a0d18, flatShading: true, roughness: 0.5, metalness: 0.2 }));
  headboard.position.set(0, 0.9, -0.9);
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xc98fa0, flatShading: true, roughness: 0.8 });
  const pillow1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.5), pillowMat);
  pillow1.position.set(-0.55, 0.65, -0.6);
  const pillow2 = pillow1.clone();
  pillow2.position.x = 0.55;
  g.add(frame, mattress, headboard, pillow1, pillow2);
  g.position.set(0, 0, centerZ + (wrong ? 1.95 : -1.95));
  if (wrong) g.rotation.y = Math.PI;
  scene.add(g);

  if (!wrong) {
    // ceiling accent mirror above the bed — cosmetic, catches the light
    const accent = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24),
      new THREE.MeshPhongMaterial({ color: 0x220a12, specular: 0x996677, shininess: 40 }));
    accent.rotation.x = Math.PI / 2;
    accent.position.set(0, ROOM.height - 0.01, centerZ - 1.95);
    scene.add(accent);
  }

  // an invisible, vertical trigger plane over the pillows, for the examine
  // raycast — it must face back toward whichever side the room is entered
  // from, or a Raycaster (which respects front-face culling) will never hit it.
  const pillowZ = centerZ + (wrong ? 1.95 - 0.6 : -1.95 - 0.6);
  const trigger = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ visible: false }));
  trigger.position.set(0, 0.75, pillowZ);
  if (wrong) trigger.rotation.y = Math.PI;
  scene.add(trigger);
  return trigger;
}

function buildSofa() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x33162e, flatShading: true, roughness: 0.85 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.78), mat);
  base.position.y = 0.2;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 0.18), mat);
  back.position.set(0, 0.55, -0.3);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.78), mat);
  armL.position.set(-0.66, 0.45, 0);
  const armR = armL.clone();
  armR.position.x = 0.66;
  g.add(base, back, armL, armR);
  g.rotation.y = -Math.PI / 2;
  g.position.set(SOFA_SEAT.x, 0, SOFA_SEAT.z);
  scene.add(g);
}

let tvScreenMesh;
function buildDresserAndTV() {
  const g = new THREE.Group();
  const dresser = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x241016, flatShading: true, roughness: 0.8 }));
  dresser.position.y = 0.31;
  const tvBody = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.42, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x0c0c0f, flatShading: true, roughness: 0.4 }));
  tvBody.position.set(0, 0.62 + 0.21, 0.2);
  tvScreenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.32), new THREE.MeshBasicMaterial({ map: tvTex }));
  tvScreenMesh.position.set(0, 0.62 + 0.21, 0.251);
  g.add(dresser, tvBody, tvScreenMesh);
  g.rotation.y = Math.PI / 2;
  g.position.set(-3.5, 0, 0.5);
  scene.add(g);
  tvScreenMesh.updateMatrixWorld(true);
}

let mirrorMesh, mirrorFrameMesh;
function buildMirror() {
  mirrorFrameMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8a6a2a, flatShading: true, metalness: 0.5, roughness: 0.4 }));
  mirrorFrameMesh.position.set(-1.6, 1.7, ROOM.halfD - 0.05);
  mirrorFrameMesh.rotation.y = Math.PI;
  scene.add(mirrorFrameMesh);

  mirrorMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.7),
    new THREE.MeshBasicMaterial({ map: mirrorRT.texture }));
  mirrorMesh.position.set(-1.6, 1.7, ROOM.halfD - 0.09);
  mirrorMesh.rotation.y = Math.PI;
  scene.add(mirrorMesh);
}

let ceilingLight, lampLight, playerLight;
function buildLights() {
  scene.add(new THREE.AmbientLight(0x40121c, 1.4));

  playerLight = new THREE.PointLight(0xffd9d9, 5, 3.6, 1.6);
  scene.add(playerLight);

  ceilingLight = new THREE.PointLight(0xffb3c6, 26, 10, 1.3);
  ceilingLight.position.set(0, ROOM.height - 0.2, 0);
  scene.add(ceilingLight);
  const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff2f5 }));
  fixture.position.set(0, ROOM.height - 0.05, 0);
  scene.add(fixture);
  ceilingFixtures.push(fixture);

  lampLight = new THREE.PointLight(0xff6688, 14, 6, 1.3);
  lampLight.position.set(-3.5, 0.85, 0.5);
  scene.add(lampLight);
  const lampMesh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.22, 6),
    new THREE.MeshStandardMaterial({ color: 0xc98fa0, emissive: 0x552233, flatShading: true }));
  lampMesh.position.set(-3.5, 0.95, 0.5);
  scene.add(lampMesh);
}

let room2Light;
function buildRoom2Light() {
  room2Light = new THREE.PointLight(0x9fffb3, 16, 10, 1.3);
  room2Light.position.set(0, ROOM.height - 0.2, ROOM2_Z);
  scene.add(room2Light);
  const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.3), new THREE.MeshBasicMaterial({ color: 0xdfffe6 }));
  fixture.position.set(0, ROOM.height - 0.05, ROOM2_Z);
  scene.add(fixture);
  ceilingFixtures.push(fixture);
}

function updateLampFlicker() {
  const jitter = Math.sin(state.time * 23.0) * 0.05 + (Math.random() - 0.5) * 0.15;
  ceilingLight.intensity = Math.max(0, 26 + jitter * (10 + state.glitch * 50));
  if (state.glitch > 0.5 && Math.random() < 0.035) ceilingLight.intensity = 1;
  lampLight.intensity = 14 + Math.sin(state.time * 4.0) * 1.2;
  const sick = state.glitch > 0.45 ? Math.random() * 0.4 : 0;
  ceilingLight.color.setHSL(clamp(0.98 + sick, 0, 1), 0.6, 0.75);
  room2Light.intensity = Math.max(0, 16 + Math.sin(state.time * 6.3) * 6 * (state.glitch > 0.3 ? 2 : 1));
}

// ---------------------------------------------------------------
// Doppelganger — real geometry. In room 303 it is only ever visible
// through the mirror (layer 1, excluded from the main camera). Past the
// corridor, in room 304, the same figure becomes directly visible and
// drifts slowly toward the player instead.
// ---------------------------------------------------------------

function buildDoppelganger() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x0a0508 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.75, 0.24), mat);
  torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), mat);
  head.position.y = 1.5;
  head.rotation.z = 0.06;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.85, 0.2), mat);
  legL.position.set(-0.12, 0.42, 0);
  const legR = legL.clone();
  legR.position.x = 0.12;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.62, 0.16), mat);
  armL.position.set(-0.31, 0.92, 0.02);
  armL.rotation.x = 0.1;
  const armR = armL.clone();
  armR.position.x = 0.31;
  armR.rotation.z = 0.15;
  g.add(torso, head, legL, legR, armL, armR);
  g.traverse((o) => { if (o.isMesh) o.layers.set(1); });
  scene.add(g);
  return g;
}

let dopple, dopplePhaseTimer = 2, doppleVisible = false, doppleInRoom2 = false;

function setDoppleMainCameraVisible(visible) {
  dopple.traverse((o) => {
    if (!o.isMesh) return;
    if (visible) o.layers.enable(0); else o.layers.disable(0);
  });
}

function updateDoppelganger(dt) {
  const inSecondArea = player.pos.z > ROOM.halfD - 0.2;

  if (inSecondArea !== doppleInRoom2) {
    doppleInRoom2 = inSecondArea;
    setDoppleMainCameraVisible(inSecondArea);
    if (inSecondArea) dopple.position.set(0, 0, ROOM2_Z + 1.6);
  }

  if (inSecondArea) {
    dopple.visible = true;
    const dx = player.pos.x - dopple.position.x;
    const dz = player.pos.z - dopple.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.7) {
      const step = Math.min(dist - 1.7, dt * 0.5);
      dopple.position.x += (dx / dist) * step;
      dopple.position.z += (dz / dist) * step;
    }
    dopple.lookAt(player.pos.x, dopple.position.y, player.pos.z);
    return;
  }

  dopplePhaseTimer -= dt;
  if (dopplePhaseTimer <= 0) {
    const chance = state.glitch > 0.3 ? 0.85 : 0.32;
    doppleVisible = Math.random() < chance;
    dopplePhaseTimer = 1.1 + Math.random() * (state.glitch > 0.3 ? 1.4 : 3.6);
  }
  dopple.visible = doppleVisible;
  if (doppleVisible) {
    dopple.position.set(
      player.pos.x - dirs.forward.x * 1.15,
      0,
      player.pos.z - dirs.forward.z * 1.15
    );
    dopple.rotation.y = player.yaw;
  }
}

// ---------------------------------------------------------------
// Mirror reflection pass
// ---------------------------------------------------------------

const mirrorPlane = new THREE.Plane();
const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _rFwd = new THREE.Vector3();
const _rUp = new THREE.Vector3();

function updateMirrorCamera() {
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(mirrorMesh.matrixWorld);
  const point = mirrorMesh.getWorldPosition(new THREE.Vector3());
  mirrorPlane.setFromNormalAndCoplanarPoint(normal, point);

  camera.getWorldPosition(_camPos);
  _camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

  const d = mirrorPlane.distanceToPoint(_camPos);
  mirrorCamera.position.copy(_camPos).addScaledVector(mirrorPlane.normal, -2 * d);

  const df = _camFwd.dot(mirrorPlane.normal);
  _rFwd.copy(_camFwd).addScaledVector(mirrorPlane.normal, -2 * df);
  const du = _camUp.dot(mirrorPlane.normal);
  _rUp.copy(_camUp).addScaledVector(mirrorPlane.normal, -2 * du);

  mirrorCamera.up.copy(_rUp);
  mirrorCamera.lookAt(mirrorCamera.position.clone().add(_rFwd));
}

// ---------------------------------------------------------------
// Post-processing (fullscreen glitch pass)
// ---------------------------------------------------------------

const POST_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uGlitch;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  void main() {
    vec2 uv = vUv;

    float bandSeed = floor(uv.y * 40.0);
    float bandNoise = hash(vec2(bandSeed, floor(uTime * 14.0)));
    uv.x += (bandNoise - 0.5) * 0.12 * uGlitch * step(0.82, bandNoise);

    float caAmt = 0.0015 + 0.01 * uGlitch;
    float r = texture2D(tDiffuse, uv + vec2(caAmt, 0.0)).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - vec2(caAmt, 0.0)).b;
    vec3 col = vec3(r, g, b);

    float scan = sin(uv.y * uResolution.y * 1.4) * 0.5 + 0.5;
    col *= mix(1.0, 0.88 + 0.12 * scan, 0.35 + 0.4 * uGlitch);

    float grain = hash(uv * uResolution.xy + uTime * 60.0) - 0.5;
    col += grain * (0.03 + 0.12 * uGlitch);

    vec2 vc = uv - 0.5;
    float edgeAmt = smoothstep(0.25, 0.85, length(vc));
    col *= mix(1.0, 0.55, edgeAmt);

    float flashSeed = hash(vec2(floor(uTime * 9.0), 7.0));
    if (uGlitch > 0.4 && flashSeed > 0.965) col = 1.0 - col;

    col += vec3(0.05, 0.0, 0.02) * uGlitch;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

const postUniforms = {
  tDiffuse: { value: sceneRT.texture },
  uTime: { value: 0 },
  uGlitch: { value: 0 },
  uResolution: { value: new THREE.Vector2(rtSize.x, rtSize.y) },
};

const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({ uniforms: postUniforms, vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false })
);
postScene.add(postQuad);

// ---------------------------------------------------------------
// Player / input state
// ---------------------------------------------------------------

const player = { pos: new THREE.Vector3(0.6, 0, 1.7), yaw: -0.35, pitch: -0.05 };
const dirs = { forward: new THREE.Vector3(), right: new THREE.Vector3() };
const keys = new Set();
const joyVec = { x: 0, y: 0 };

const state = {
  started: false,
  mode: 'fp', // 'fp' | 'top'
  sitting: false,
  zoomTarget: null,
  glitchOn: false,
  glitch: 0,
  time: 0,
};

function updateDirs() {
  dirs.forward.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
  dirs.right.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
}

function resolveCollisions(pos) {
  let bestX = pos.x, bestZ = pos.z, bestDist = Infinity;
  for (const c of CELLS) {
    const cx = clamp(pos.x, c.xMin, c.xMax);
    const cz = clamp(pos.z, c.zMin, c.zMax);
    const dx = cx - pos.x, dz = cz - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) { bestDist = d; bestX = cx; bestZ = cz; }
  }
  pos.x = bestX;
  pos.z = bestZ;
  for (const obs of obstacles) {
    const dx = pos.x - obs.x, dz = pos.z - obs.z;
    const d = Math.hypot(dx, dz);
    if (d < obs.r && d > 1e-4) {
      const push = obs.r - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  }
}

function canSit() {
  const dx = player.pos.x - SOFA_SEAT.x, dz = player.pos.z - SOFA_SEAT.z;
  return Math.hypot(dx, dz) < SOFA_SEAT.radius;
}

function updateMovement(dt) {
  if (state.mode !== 'fp' || state.sitting || state.zoomTarget) return;
  updateDirs();
  const move = new THREE.Vector3();
  if (keys.has('KeyW')) move.add(dirs.forward);
  if (keys.has('KeyS')) move.sub(dirs.forward);
  if (keys.has('KeyD')) move.add(dirs.right);
  if (keys.has('KeyA')) move.sub(dirs.right);
  if (Math.abs(joyVec.x) > 0.05 || Math.abs(joyVec.y) > 0.05) {
    move.addScaledVector(dirs.forward, joyVec.y);
    move.addScaledVector(dirs.right, joyVec.x);
  }
  if (move.lengthSq() > 0) {
    if (move.length() > 1) move.normalize();
    move.multiplyScalar(SPEED * dt);
    player.pos.x += move.x;
    player.pos.z += move.z;
    resolveCollisions(player.pos);
  }
}

// ---------------------------------------------------------------
// Audio — synthesized ambience, no sample files
// ---------------------------------------------------------------

let audioCtx, masterGain, droneOsc1, droneFilter, humGain, noiseGain;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.5;
  masterGain.connect(audioCtx.destination);

  droneFilter = audioCtx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 340;

  droneOsc1 = audioCtx.createOscillator();
  droneOsc1.type = 'sine';
  droneOsc1.frequency.value = 55;
  const droneOsc2 = audioCtx.createOscillator();
  droneOsc2.type = 'triangle';
  droneOsc2.frequency.value = 55 * 1.5;
  droneOsc2.detune.value = -8;

  const droneGain = audioCtx.createGain();
  droneGain.gain.value = 0.22;
  droneOsc1.connect(droneFilter);
  droneOsc2.connect(droneFilter);
  droneFilter.connect(droneGain);
  droneGain.connect(masterGain);
  droneOsc1.start();
  droneOsc2.start();

  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 90;
  lfo.connect(lfoGain);
  lfoGain.connect(droneFilter.frequency);
  lfo.start();

  const hum = audioCtx.createOscillator();
  hum.type = 'square';
  hum.frequency.value = 118;
  humGain = audioCtx.createGain();
  humGain.gain.value = 0.012;
  hum.connect(humGain);
  humGain.connect(masterGain);
  hum.start();

  const tension = audioCtx.createOscillator();
  tension.type = 'sine';
  tension.frequency.value = 4200;
  const tensionGain = audioCtx.createGain();
  tensionGain.gain.value = 0.004;
  tension.connect(tensionGain);
  tensionGain.connect(masterGain);
  tension.start();

  const bufLen = audioCtx.sampleRate * 2;
  const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = buf;
  noiseSource.loop = true;
  noiseGain = audioCtx.createGain();
  noiseGain.gain.value = 0.0;
  noiseSource.connect(noiseGain);
  noiseGain.connect(masterGain);
  noiseSource.start();
}

function updateAudioGlitch() {
  if (!audioCtx) return;
  const g = state.glitch;
  const t = audioCtx.currentTime;
  noiseGain.gain.setTargetAtTime(g > 0.05 ? 0.03 + Math.random() * 0.14 * g : 0.0, t, 0.03);
  droneOsc1.detune.setTargetAtTime((Math.random() - 0.5) * 80 * g, t, 0.05);
  const filterFreq = Math.max(60, 340 + Math.sin(state.time * (g > 0.05 ? 4.0 : 0.3)) * (90 + g * 150));
  droneFilter.frequency.setTargetAtTime(filterFreq, t, 0.03);
  humGain.gain.setTargetAtTime(0.012 + g * 0.02 * Math.random(), t, 0.05);
}

// ---------------------------------------------------------------
// Camera pose resolution (fp / sit / top-down / zoom)
// ---------------------------------------------------------------

const targetPos = new THREE.Vector3();
const targetQuat = new THREE.Quaternion();

function computeTargetPose() {
  if (state.zoomTarget) {
    dummy.position.copy(state.zoomTarget.camPos);
    dummy.lookAt(state.zoomTarget.camLookAt);
    targetPos.copy(state.zoomTarget.camPos);
    targetQuat.copy(dummy.quaternion);
  } else if (state.mode === 'top') {
    const sway = Math.sin(state.time * 0.15) * 0.35;
    dummy.position.set(player.pos.x + sway, 8.0, player.pos.z + 0.9);
    dummy.lookAt(player.pos.x, 0, player.pos.z - 0.4);
    targetPos.copy(dummy.position);
    targetQuat.copy(dummy.quaternion);
  } else if (state.sitting) {
    dummy.position.copy(SIT_POS);
    dummy.lookAt(TV_LOOK);
    targetPos.copy(SIT_POS);
    targetQuat.copy(dummy.quaternion);
  } else {
    targetPos.set(player.pos.x, EYE_HEIGHT, player.pos.z);
    dummy.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    targetQuat.setFromEuler(dummy.rotation);
  }
}

function updateCameraPose() {
  computeTargetPose();
  const smooth = (state.mode === 'fp' && !state.sitting && !state.zoomTarget) ? 1 : 0.09;
  camera.position.lerp(targetPos, smooth);
  camera.quaternion.slerp(targetQuat, smooth);
}

// ---------------------------------------------------------------
// Examine hotspots (click / tap to zoom in on something)
// ---------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const hotspots = [];

function registerHotspot(mesh, camPos, camLookAt, label) {
  hotspots.push({ mesh, camPos: new THREE.Vector3(...camPos), camLookAt: new THREE.Vector3(...camLookAt), label });
}

let hoveredHotspot = null;

function updateHoverHint() {
  if (state.mode !== 'fp' || state.sitting || state.zoomTarget) { hoveredHotspot = null; return; }
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects(hotspots.map((h) => h.mesh), false);
  hoveredHotspot = (hits.length && hits[0].distance < 4.5) ? hotspots.find((h) => h.mesh === hits[0].object) : null;
}

function handlePointerTap(clientX, clientY) {
  if (state.zoomTarget) { state.zoomTarget = null; return; }
  if (state.mode !== 'fp' || state.sitting) return;
  const rect = canvasEl.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(hotspots.map((h) => h.mesh), false);
  if (hits.length) {
    const hit = hotspots.find((h) => h.mesh === hits[0].object);
    if (hit) state.zoomTarget = hit;
  }
}

// ---------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const hud = document.getElementById('hud');
const hudLeft = document.getElementById('hudLeft');
const promptEl = document.getElementById('prompt');
const effectBtn = document.getElementById('effectBtn');
const viewBtn = document.getElementById('viewBtn');
const joystickBase = document.getElementById('joystickBase');
const joystickThumb = document.getElementById('joystickThumb');
const canvasEl = renderer.domElement;

function setPrompt(text) {
  if (!text) {
    promptEl.classList.add('hidden');
  } else {
    promptEl.textContent = text;
    promptEl.classList.remove('hidden');
  }
}

function updatePrompt() {
  if (state.zoomTarget) { setPrompt('タップ / クリックで戻る'); return; }
  if (state.mode !== 'fp') { setPrompt(''); return; }
  if (state.sitting) { setPrompt('[E] / タップで立ち上がる'); return; }
  if (canSit()) { setPrompt('[E] / タップでソファに座る'); return; }
  if (hoveredHotspot) { setPrompt(`クリックして${hoveredHotspot.label}をよく見る`); return; }
  setPrompt('');
}

function updateHud() {
  hudLeft.textContent = player.pos.z > ROOM.halfD ? 'ROOM 304' : 'ROOM 303';
  const showJoystick = state.started && state.mode === 'fp' && !state.sitting && !state.zoomTarget;
  joystickBase.classList.toggle('hidden', !showJoystick);
}

function toggleGlitch() {
  state.glitchOn = !state.glitchOn;
  effectBtn.classList.toggle('active', state.glitchOn);
  document.body.classList.toggle('glitching', state.glitchOn);
}

function toggleView() {
  if (state.zoomTarget) return;
  if (state.mode === 'fp') {
    state.mode = 'top';
    document.body.classList.remove('fp-mode');
    for (const m of ceilingMeshes) m.visible = false;
    for (const m of ceilingFixtures) m.visible = false;
  } else {
    state.mode = 'fp';
    document.body.classList.add('fp-mode');
    for (const m of ceilingMeshes) m.visible = true;
    for (const m of ceilingFixtures) m.visible = true;
  }
  viewBtn.classList.toggle('active', state.mode === 'top');
}

function trySit() {
  if (state.mode !== 'fp' || state.zoomTarget) return;
  if (state.sitting) state.sitting = false;
  else if (canSit()) state.sitting = true;
}

function enter() {
  if (state.started) return;
  state.started = true;
  initAudio();
  overlay.classList.add('hidden');
  hud.classList.remove('hidden');
  document.body.classList.add('entered', 'fp-mode');
}

startBtn.addEventListener('click', enter);
startBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enter(); }
});
effectBtn.addEventListener('click', toggleGlitch);
viewBtn.addEventListener('click', toggleView);

// ---- drag-to-look + tap-to-examine on the canvas (mouse and touch alike) ----

let looking = false;
let lookPointerId = null;
let lastPX = 0, lastPY = 0;
let dragDist = 0;

canvasEl.addEventListener('pointerdown', (e) => {
  if (!state.started || state.mode !== 'fp' || state.sitting) return;
  looking = true;
  lookPointerId = e.pointerId;
  lastPX = e.clientX; lastPY = e.clientY;
  dragDist = 0;
  canvasEl.setPointerCapture(e.pointerId);
});

canvasEl.addEventListener('pointermove', (e) => {
  if (!looking || e.pointerId !== lookPointerId) return;
  const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
  lastPX = e.clientX; lastPY = e.clientY;
  dragDist += Math.hypot(dx, dy);
  if (!state.zoomTarget) {
    player.yaw -= dx * 0.0045;
    player.pitch -= dy * 0.0045;
    player.pitch = clamp(player.pitch, -1.2, 1.2);
  }
});

function endLook(e) {
  if (!looking || e.pointerId !== lookPointerId) return;
  looking = false;
  try { canvasEl.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  if (dragDist < 6) handlePointerTap(e.clientX, e.clientY);
}
canvasEl.addEventListener('pointerup', endLook);
canvasEl.addEventListener('pointercancel', endLook);

// ---- virtual joystick (movement) ----

let joyActive = false, joyPointerId = null;

function updateJoy(e) {
  const rect = joystickBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const maxR = rect.width / 2;
  const d = Math.hypot(dx, dy);
  if (d > maxR) { dx = (dx / d) * maxR; dy = (dy / d) * maxR; }
  joyVec.x = dx / maxR;
  joyVec.y = -dy / maxR;
  joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;
}

function resetJoy() {
  joyVec.x = 0; joyVec.y = 0;
  joystickThumb.style.transform = 'translate(0px, 0px)';
}

joystickBase.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  joyActive = true;
  joyPointerId = e.pointerId;
  joystickBase.setPointerCapture(e.pointerId);
  updateJoy(e);
});
joystickBase.addEventListener('pointermove', (e) => {
  if (!joyActive || e.pointerId !== joyPointerId) return;
  e.stopPropagation();
  updateJoy(e);
});
function endJoy(e) {
  if (e.pointerId !== joyPointerId) return;
  joyActive = false;
  resetJoy();
}
joystickBase.addEventListener('pointerup', endJoy);
joystickBase.addEventListener('pointercancel', endJoy);

window.addEventListener('keydown', (e) => {
  if (!state.started) return;
  if (e.code === 'KeyG') toggleGlitch();
  if (e.code === 'KeyT') toggleView();
  if (e.code === 'KeyE' && !e.repeat) trySit();
  if (e.code === 'Escape' && state.zoomTarget) state.zoomTarget = null;
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(rtSize);
  sceneRT.setSize(rtSize.x, rtSize.y);
  postUniforms.uResolution.value.set(rtSize.x, rtSize.y);
});

// ---------------------------------------------------------------
// Build scene
// ---------------------------------------------------------------

buildRoomShell(0, 1);
buildCorridor();
buildRoomShell(ROOM2_Z, -1);
buildLights();
buildRoom2Light();
buildBed(0, false);
const room2BedTrigger = buildBed(ROOM2_Z, true);
buildSofa();
buildDresserAndTV();
buildMirror();
dopple = buildDoppelganger();

registerHotspot(tvScreenMesh, [-2.25, 0.9, 0.5], [-3.3, 0.83, 0.5], 'テレビ');
registerHotspot(mirrorMesh, [-1.6, 1.55, 1.55], [-1.6, 1.6, 2.81], '鏡');
registerHotspot(room2BedTrigger, [0, 1.3, ROOM2_Z + 0.2], [0, 0.65, ROOM2_Z + 1.35], 'ベッド');

// ---------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------

let last = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  state.time += dt;

  if (state.started) {
    updateMovement(dt);
    updateHoverHint();
    updatePrompt();
    updateHud();
  }

  const idleFlicker = Math.random() < 0.02 ? 0.35 : 0.015;
  const target = state.glitchOn ? 1.0 : idleFlicker;
  state.glitch += (target - state.glitch) * (state.glitchOn ? 0.08 : 0.04);
  state.glitch = clamp(state.glitch, 0, 1);

  for (const mat of wobbleMaterials) {
    mat.uniforms.uTime.value = state.time;
    mat.uniforms.uGlitch.value = state.glitch;
  }
  postUniforms.uTime.value = state.time;
  postUniforms.uGlitch.value = state.glitch;

  updateLampFlicker();
  playerLight.position.copy(camera.position);
  updateDoppelganger(dt);
  if (Math.floor(state.time * 60) % 2 === 0) updateTV(state.glitch);
  updateAudioGlitch();
  updateCameraPose();

  mirrorMesh.visible = false;
  updateMirrorCamera();
  renderer.setRenderTarget(mirrorRT);
  renderer.clear();
  renderer.render(scene, mirrorCamera);
  mirrorMesh.visible = true;

  renderer.setRenderTarget(sceneRT);
  renderer.clear();
  renderer.render(scene, camera);

  renderer.setRenderTarget(null);
  renderer.render(postScene, postCamera);
}

animate();
