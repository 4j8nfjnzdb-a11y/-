// motion lab — polygon room
//
// A hotel-room-ish, slightly-off horror scene containing two low-poly
// "polygon" humanoid rigs (Character A / Character B). Every joint of
// each rig can be posed and driven by an independent oscillator
// (amplitude / speed / phase / random), left/right sides can be linked
// (independent / symmetric / alternating) or fully separate, and a
// joint can be locked to freeze it while the rest of the body keeps
// moving. This file owns: scene + room construction, the FK rig
// builder, the per-joint motion engine, and the control-panel UI.

// Loaded as classic (non-module) scripts — three.min.js first, this file
// second — so the app runs on browsers/webviews that don't support ES
// module import maps. `THREE` is the global the vendored build exposes.

// Minimal drag-to-orbit / wheel-to-zoom camera control (a compact stand-in
// for three/examples/jsm/controls/OrbitControls, which is ES-module only).
class SimpleOrbitControls {
  constructor(camera, domElement, target) {
    this.camera = camera;
    this.dom = domElement;
    this.target = target.clone();
    this.minDistance = 1.2;
    this.maxDistance = 7;
    this.maxPolarAngle = Math.PI * 0.53;
    this.damping = 0.08;

    const offset = camera.position.clone().sub(this.target);
    this.radius = offset.length();
    this.theta = Math.atan2(offset.x, offset.z);
    this.phi = Math.acos(THREE.MathUtils.clamp(offset.y / this.radius, -1, 1));
    this._targetRadius = this.radius;
    this._targetTheta = this.theta;
    this._targetPhi = this.phi;

    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    this._onDown = (e) => { this._dragging = true; this._lastX = e.clientX; this._lastY = e.clientY; };
    this._onUp = () => { this._dragging = false; };
    this._onMove = (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX; this._lastY = e.clientY;
      this._targetTheta -= dx * 0.006;
      this._targetPhi = THREE.MathUtils.clamp(this._targetPhi - dy * 0.006, 0.15, this.maxPolarAngle);
    };
    this._onWheel = (e) => {
      e.preventDefault();
      this._targetRadius = THREE.MathUtils.clamp(this._targetRadius * (1 + e.deltaY * 0.001), this.minDistance, this.maxDistance);
    };

    domElement.addEventListener("pointerdown", this._onDown);
    window.addEventListener("pointerup", this._onUp);
    window.addEventListener("pointermove", this._onMove);
    domElement.addEventListener("wheel", this._onWheel, { passive: false });
  }

  update() {
    this.theta += (this._targetTheta - this.theta) * this.damping;
    this.phi += (this._targetPhi - this.phi) * this.damping;
    this.radius += (this._targetRadius - this.radius) * this.damping;
    const sinPhiRadius = Math.sin(this.phi) * this.radius;
    this.camera.position.set(
      this.target.x + sinPhiRadius * Math.sin(this.theta),
      this.target.y + Math.cos(this.phi) * this.radius,
      this.target.z + sinPhiRadius * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }
}

// ---------------------------------------------------------------------
// small math helpers
// ---------------------------------------------------------------------

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function makeDrift(min, max) {
  let value = (min + max) / 2;
  let target = value;
  return {
    tick(rate) {
      if (Math.random() < 0.06) target = min + Math.random() * (max - min);
      value += (target - value) * rate;
      return value;
    },
  };
}

// ---------------------------------------------------------------------
// joint definitions
//
// Each joint is built from a "userPivot" (rotation = the value the UI /
// motion engine controls, expressed in the PARENT bone's own frame —
// i.e. x = flex/extend about the parent's mediolateral axis, z = ab/
// duction about the parent's front-back axis, y = rotation about the
// parent's long axis) and a child "bindPivot" carrying a fixed
// reorientation (down the body for limbs, forward for the foot) so the
// next bone continues from the right place. Because the fixed
// reorientation only ever rotates about X or Z, the meaning of the
// user's x/y/z rotation is preserved all the way down the chain.
// ---------------------------------------------------------------------

const HIP_AXES = {
  x: { label: "屈曲 / 伸展", min: -30, max: 110 },
  z: { label: "外転 / 内転", min: -30, max: 45 },
  y: { label: "内旋 / 外旋", min: -40, max: 40 },
};
const KNEE_AXES = { x: { label: "屈曲 / 伸展", min: -10, max: 140 } };
const ANKLE_AXES = {
  x: { label: "背屈 / 底屈", min: -45, max: 25 },
  z: { label: "内外方向の傾き", min: -20, max: 20 },
  y: { label: "回旋", min: -25, max: 25 },
};
const SHOULDER_AXES = {
  x: { label: "屈曲 / 伸展", min: -70, max: 150 },
  z: { label: "外転 / 内転", min: -20, max: 150 },
  y: { label: "内旋 / 外旋", min: -80, max: 80 },
};
const ELBOW_AXES = { x: { label: "屈曲 / 伸展", min: 0, max: 145 } };
const SPINE_AXES = {
  x: { label: "前屈 / 後屈", min: -30, max: 30 },
  z: { label: "左右側屈", min: -20, max: 20 },
  y: { label: "左右回旋", min: -25, max: 25 },
};

const SKIN = { a: 0xfa682e, b: 0x6175a2 };
const SKIN_GLOW = { a: 0xff9a4d, b: 0x6d87c9 };

const JOINT_DEFS = [
  {
    id: "pelvis", label: "骨盤 Pelvis", parentId: null,
    anchor: [0, 0.98, 0], bindDeg: [0, 0, 0], boneLength: 0.14,
    mesh: { size: [0.3, 0.17, 0.18], center: [0, 0.06, 0] },
    axes: {
      x: { label: "前傾 / 後傾", min: -20, max: 20 },
      z: { label: "左右傾斜", min: -15, max: 15 },
      y: { label: "左右回旋", min: -30, max: 30 },
    },
    posAxes: {
      x: { label: "左右移動", min: -0.2, max: 0.2 },
      y: { label: "上下（しゃがみ込み含む）", min: -0.55, max: 0.15 },
      z: { label: "前後", min: -0.3, max: 0.3 },
    },
  },
  {
    id: "spine", label: "脊柱 Spine", parentId: "pelvis",
    anchor: [0, 0.14, 0], bindDeg: [0, 0, 0], boneLength: 0.13,
    mesh: { size: [0.3, 0.14, 0.19], center: [0, 0.07, 0] },
    axes: SPINE_AXES,
  },
  {
    id: "chest", label: "胸郭 Chest", parentId: "spine",
    anchor: [0, 0.13, 0], bindDeg: [0, 0, 0], boneLength: 0.245,
    mesh: { size: [0.42, 0.25, 0.22], center: [0, 0.123, 0] },
    axes: SPINE_AXES,
  },
  {
    id: "neck", label: "首 Neck", parentId: "chest",
    anchor: [0, 0.245, 0], bindDeg: [0, 0, 0], boneLength: 0.07,
    mesh: { size: [0.16, 0.08, 0.15], center: [0, 0.035, 0] },
    axes: {
      x: { label: "前後", min: -25, max: 25 },
      z: { label: "左右傾き", min: -20, max: 20 },
      y: { label: "左右回旋", min: -45, max: 45 },
    },
    tip: { type: "head" },
  },

  { id: "leftShoulder", label: "左肩 Left Shoulder", parentId: "chest", side: "L", pairId: "shoulder",
    anchor: [0.235, 0.215, 0], bindDeg: [0, 0, 180], boneLength: 0.28,
    mesh: { size: [0.11, 0.28, 0.11], center: [0, 0.14, 0] }, axes: SHOULDER_AXES },
  { id: "rightShoulder", label: "右肩 Right Shoulder", parentId: "chest", side: "R", pairId: "shoulder",
    anchor: [-0.235, 0.215, 0], bindDeg: [0, 0, 180], boneLength: 0.28,
    mesh: { size: [0.11, 0.28, 0.11], center: [0, 0.14, 0] }, axes: SHOULDER_AXES },

  { id: "leftElbow", label: "左肘 Left Elbow", parentId: "leftShoulder", side: "L", pairId: "elbow",
    anchor: [0, 0.28, 0], bindDeg: [0, 0, 0], boneLength: 0.25,
    mesh: { size: [0.095, 0.25, 0.1], center: [0, 0.125, 0] }, axes: ELBOW_AXES, tip: { type: "hand" } },
  { id: "rightElbow", label: "右肘 Right Elbow", parentId: "rightShoulder", side: "R", pairId: "elbow",
    anchor: [0, 0.28, 0], bindDeg: [0, 0, 0], boneLength: 0.25,
    mesh: { size: [0.095, 0.25, 0.1], center: [0, 0.125, 0] }, axes: ELBOW_AXES, tip: { type: "hand" } },

  { id: "leftHip", label: "左股関節 Left Hip", parentId: "pelvis", side: "L", pairId: "hip",
    anchor: [0.105, -0.03, 0], bindDeg: [0, 0, 180], boneLength: 0.44,
    mesh: { size: [0.13, 0.44, 0.15], center: [0, 0.22, 0] }, axes: HIP_AXES },
  { id: "rightHip", label: "右股関節 Right Hip", parentId: "pelvis", side: "R", pairId: "hip",
    anchor: [-0.105, -0.03, 0], bindDeg: [0, 0, 180], boneLength: 0.44,
    mesh: { size: [0.13, 0.44, 0.15], center: [0, 0.22, 0] }, axes: HIP_AXES },

  { id: "leftKnee", label: "左膝 Left Knee", parentId: "leftHip", side: "L", pairId: "knee",
    anchor: [0, 0.44, 0], bindDeg: [0, 0, 0], boneLength: 0.42,
    mesh: { size: [0.125, 0.42, 0.135], center: [0, 0.21, 0] }, axes: KNEE_AXES },
  { id: "rightKnee", label: "右膝 Right Knee", parentId: "rightHip", side: "R", pairId: "knee",
    anchor: [0, 0.44, 0], bindDeg: [0, 0, 0], boneLength: 0.42,
    mesh: { size: [0.125, 0.42, 0.135], center: [0, 0.21, 0] }, axes: KNEE_AXES },

  { id: "leftAnkle", label: "左足首 Left Ankle", parentId: "leftKnee", side: "L", pairId: "ankle",
    anchor: [0, 0.42, 0], bindDeg: [90, 0, 0], boneLength: 0.22,
    mesh: { size: [0.12, 0.07, 0.24], center: [0, 0.1, 0.02] }, axes: ANKLE_AXES },
  { id: "rightAnkle", label: "右足首 Right Ankle", parentId: "rightKnee", side: "R", pairId: "ankle",
    anchor: [0, 0.42, 0], bindDeg: [90, 0, 0], boneLength: 0.22,
    mesh: { size: [0.12, 0.07, 0.24], center: [0, 0.1, 0.02] }, axes: ANKLE_AXES },
];

const JOINT_GROUPS = [
  { label: "体幹 Trunk", ids: ["pelvis", "spine", "chest", "neck"] },
  { label: "左腕 Left Arm", ids: ["leftShoulder", "leftElbow"] },
  { label: "右腕 Right Arm", ids: ["rightShoulder", "rightElbow"] },
  { label: "左脚 Left Leg", ids: ["leftHip", "leftKnee", "leftAnkle"] },
  { label: "右脚 Right Leg", ids: ["rightHip", "rightKnee", "rightAnkle"] },
];

const PAIR_IDS = ["hip", "knee", "ankle", "shoulder", "elbow"];
const MIRROR_SIGN = { x: 1, y: -1, z: -1 };

function defaultAxisState() {
  return { base: 0, motionOn: false, amp: 0, speed: 0.3, phase: 0, random: 0 };
}

// ---------------------------------------------------------------------
// rig builder
// ---------------------------------------------------------------------

// procedural vertical scanline texture — fine bright lines running down
// the body, the way the reference figures read.
function makeScanTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.4;
  for (let x = 1; x < 64; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 64);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.2, 2.2);
  return tex;
}
const SCAN_TEXTURE = makeScanTexture();

function buildCharacter(scene, { id, x, z, ry, skin, glow }) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = ry;
  scene.add(root);

  // Flat-shaded, sharp-edged boxes only — no rounded joint markers, no
  // beveling or vertex noise. Segments simply overlap slightly at each
  // pivot so the rig reads as clean rectangular blocks stacked end to end.
  const material = new THREE.MeshStandardMaterial({
    color: skin, roughness: 0.5, metalness: 0.05, flatShading: true,
    emissive: skin, emissiveMap: SCAN_TEXTURE, emissiveIntensity: 1.95,
  });

  const joints = {};

  for (const def of JOINT_DEFS) {
    const parentBind = def.parentId ? joints[def.parentId].bindPivot : root;

    const userPivot = new THREE.Object3D();
    userPivot.position.set(...def.anchor);
    parentBind.add(userPivot);

    const bindPivot = new THREE.Object3D();
    bindPivot.rotation.set(def.bindDeg[0] * DEG, def.bindDeg[1] * DEG, def.bindDeg[2] * DEG);
    userPivot.add(bindPivot);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...def.mesh.size), material);
    mesh.position.set(...def.mesh.center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bindPivot.add(mesh);

    if (def.tip?.type === "head") {
      // a big cube sitting straight on the shoulders, like the reference —
      // the neck segment above is short enough to read as almost no neck
      const headH = 0.225;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.205, headH, 0.2), material);
      head.position.set(0, def.boneLength + headH / 2, 0);
      head.castShadow = true;
      bindPivot.add(head);
    }
    if (def.tip?.type === "hand") {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.08), material);
      hand.position.set(0, def.boneLength + 0.06, 0);
      hand.castShadow = true;
      bindPivot.add(hand);
    }

    const axisState = {};
    for (const axis of Object.keys(def.axes || {})) axisState[axis] = defaultAxisState();
    const posAxisState = {};
    for (const axis of Object.keys(def.posAxes || {})) posAxisState[axis] = defaultAxisState();

    joints[def.id] = {
      def, userPivot, bindPivot, axisState, posAxisState,
      locked: false, lockedSnapshot: null, lockedPos: null,
      drift: { x: makeDrift(-1, 1), y: makeDrift(-1, 1), z: makeDrift(-1, 1) },
    };
  }

  const pairLinkMode = {};
  for (const p of PAIR_IDS) pairLinkMode[p] = "independent";

  return { id, root, joints, pairLinkMode, selectedJointId: "pelvis" };
}

function evalAxis(state, drift, t) {
  if (!state.motionOn) return state.base;
  const osc = state.amp * Math.sin(2 * Math.PI * state.speed * t + state.phase * DEG);
  const rand = state.random > 0 ? drift.tick(0.03) * state.random * 12 : 0;
  return state.base + osc + rand;
}

function applyMotion(character, t) {
  for (const jointId of Object.keys(character.joints)) {
    const j = character.joints[jointId];
    const def = j.def;

    let rx = 0, ry = 0, rz = 0;
    if (def.axes) {
      if (j.locked) {
        ({ x: rx = 0, y: ry = 0, z: rz = 0 } = j.lockedSnapshot || {});
      } else {
        for (const axis of Object.keys(def.axes)) {
          const { min, max } = def.axes[axis];
          const v = clamp(evalAxis(j.axisState[axis], j.drift[axis], t), min, max);
          if (axis === "x") rx = v; else if (axis === "y") ry = v; else rz = v;
        }
      }
    }
    j.userPivot.rotation.set(rx * DEG, ry * DEG, rz * DEG);

    if (def.posAxes) {
      const base = def.anchor;
      let px = base[0], py = base[1], pz = base[2];
      if (j.locked && j.lockedPos) {
        ({ x: px, y: py, z: pz } = j.lockedPos);
      } else {
        for (const axis of Object.keys(def.posAxes)) {
          const { min, max } = def.posAxes[axis];
          const v = clamp(evalAxis(j.posAxisState[axis], j.drift[axis], t), min, max);
          if (axis === "x") px = base[0] + v;
          else if (axis === "y") py = base[1] + v;
          else pz = base[2] + v;
        }
      }
      j.userPivot.position.set(px, py, pz);
    }
  }
}

// ---------------------------------------------------------------------
// left / right link propagation
// ---------------------------------------------------------------------

function pairJointIds(character, pairId) {
  const defs = JOINT_DEFS.filter((d) => d.pairId === pairId);
  const left = defs.find((d) => d.side === "L").id;
  const right = defs.find((d) => d.side === "R").id;
  return { left, right };
}

function syncPair(character, pairId) {
  const mode = character.pairLinkMode[pairId];
  if (mode === "independent") return;
  const { left, right } = pairJointIds(character, pairId);
  const jl = character.joints[left];
  const jr = character.joints[right];
  const phaseShift = mode === "flipped" ? 180 : 0;

  for (const axis of Object.keys(jl.axisState)) {
    const src = jl.axisState[axis];
    const dst = jr.axisState[axis];
    const sign = MIRROR_SIGN[axis];
    dst.base = src.base * sign;
    dst.amp = src.amp;
    dst.speed = src.speed;
    dst.phase = (src.phase + phaseShift + 360) % 360;
    dst.random = src.random;
    dst.motionOn = src.motionOn;
  }
  jr.locked = jl.locked;
  if (jl.locked) {
    const snap = {};
    for (const axis of Object.keys(jl.lockedSnapshot || {})) snap[axis] = jl.lockedSnapshot[axis] * MIRROR_SIGN[axis];
    jr.lockedSnapshot = snap;
  }
}

// ---------------------------------------------------------------------
// scene / room
// ---------------------------------------------------------------------

const canvas = document.getElementById("three-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const roomState = { hue: 265, intensity: 35, flicker: 20, fog: 30 };
scene.fog = new THREE.FogExp2(0x0a0710, 0.06);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.05, 60);
camera.position.set(1.9, 1.7, 3.1);

const controls = new SimpleOrbitControls(camera, renderer.domElement, new THREE.Vector3(0, 1.0, 0));

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- room geometry -----------------------------------------------------

const ROOM = { w: 5.2, d: 4.4, h: 2.6 };

const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a1418, roughness: 0.95 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0c0910, roughness: 1 });
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), ceilMat);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = ROOM.h;
scene.add(ceiling);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x241b23, roughness: 0.9 });
function addWall(w, h, pos, rotY) {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
  wall.position.copy(pos);
  wall.rotation.y = rotY;
  wall.receiveShadow = true;
  scene.add(wall);
  return wall;
}
addWall(ROOM.w, ROOM.h, new THREE.Vector3(0, ROOM.h / 2, -ROOM.d / 2), 0);
addWall(ROOM.d, ROOM.h, new THREE.Vector3(-ROOM.w / 2, ROOM.h / 2, 0), Math.PI / 2);
addWall(ROOM.d, ROOM.h, new THREE.Vector3(ROOM.w / 2, ROOM.h / 2, 0), -Math.PI / 2);

// --- bed ---------------------------------------------------------------

const bed = new THREE.Group();
const woodMat = new THREE.MeshStandardMaterial({ color: 0x1c1210, roughness: 0.85 });
const sheetMat = new THREE.MeshStandardMaterial({ color: 0x4a3f42, roughness: 0.9 });
const pillowMat = new THREE.MeshStandardMaterial({ color: 0x5b4f52, roughness: 0.95 });

const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.32, 2.0), woodMat);
frame.position.y = 0.16;
frame.castShadow = frame.receiveShadow = true;
bed.add(frame);

const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.2, 1.94), sheetMat);
mattress.position.y = 0.42;
mattress.castShadow = mattress.receiveShadow = true;
bed.add(mattress);

const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.08), woodMat);
headboard.position.set(0, 0.65, -0.96);
headboard.castShadow = true;
bed.add(headboard);

const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.35), pillowMat);
pillow.position.set(-0.3, 0.58, -0.75);
pillow.castShadow = true;
bed.add(pillow);

bed.position.set(-1.55, 0, -1.1);
scene.add(bed);

// --- TV with flickering static -----------------------------------------

const tvCanvas = document.createElement("canvas");
tvCanvas.width = 128; tvCanvas.height = 96;
const tvCtx = tvCanvas.getContext("2d");
const tvTexture = new THREE.CanvasTexture(tvCanvas);
tvTexture.colorSpace = THREE.SRGBColorSpace;

function paintStatic(brightness = 1) {
  const img = tvCtx.createImageData(tvCanvas.width, tvCanvas.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) * brightness;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v * 0.96; img.data[i + 3] = 255;
  }
  tvCtx.putImageData(img, 0, 0);
  // faint scanlines
  tvCtx.globalAlpha = 0.15;
  tvCtx.fillStyle = "#000";
  for (let y = 0; y < tvCanvas.height; y += 2) tvCtx.fillRect(0, y, tvCanvas.width, 1);
  tvCtx.globalAlpha = 1;
  tvTexture.needsUpdate = true;
}
paintStatic();

const tvGroup = new THREE.Group();
const tvStand = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.4), woodMat);
tvStand.position.y = 0.275;
tvStand.castShadow = tvStand.receiveShadow = true;
tvGroup.add(tvStand);

const tvBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.08), new THREE.MeshStandardMaterial({ color: 0x08070a, roughness: 0.4 }));
tvBody.position.y = 0.55 + 0.24;
tvBody.castShadow = true;
tvGroup.add(tvBody);

const tvScreenMat = new THREE.MeshBasicMaterial({ map: tvTexture, toneMapped: false });
const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.32), tvScreenMat);
tvScreen.position.set(0, 0.55 + 0.24, 0.045);
tvGroup.add(tvScreen);

const tvLight = new THREE.PointLight(0xbfd9ff, 0.6, 3.2, 2);
tvLight.position.set(0, 0.8, 0.3);
tvGroup.add(tvLight);

tvGroup.position.set(1.85, 0, -1.85);
tvGroup.rotation.y = Math.PI * 0.86;
scene.add(tvGroup);

// --- practical lamp ------------------------------------------------------

const lampGroup = new THREE.Group();
const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 8), woodMat);
lampBase.position.y = 0.25;
lampBase.castShadow = true;
lampGroup.add(lampBase);
const lampShade = new THREE.Mesh(
  new THREE.ConeGeometry(0.18, 0.22, 8, 1, true),
  new THREE.MeshStandardMaterial({ color: 0xcabf9e, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x332a1a, emissiveIntensity: 0.4 })
);
lampShade.position.y = 0.6;
lampGroup.add(lampShade);
const lampLight = new THREE.PointLight(0xffb066, 1.1, 4, 2);
lampLight.position.y = 0.55;
lampLight.castShadow = true;
lampGroup.add(lampLight);
lampGroup.position.set(-1.95, 0, -0.15);
scene.add(lampGroup);

// --- lighting --------------------------------------------------------

const hemi = new THREE.HemisphereLight(0x2a2440, 0x0a0608, 0.35);
scene.add(hemi);

const keyLight = new THREE.PointLight(0x8b6bd6, 1.0, 8, 2);
keyLight.position.set(0, 2.2, 0.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

function applyRoomLighting() {
  const hue = roomState.hue / 360;
  const color = new THREE.Color().setHSL(hue, 0.55, 0.55);
  keyLight.color = color;
  keyLight.intensity = (roomState.intensity / 100) * 2.2 + 0.15;
  scene.fog.color = new THREE.Color().setHSL(hue, 0.4, 0.05);
  scene.fog.density = (roomState.fog / 100) * 0.14 + 0.01;
}
applyRoomLighting();

// ---------------------------------------------------------------------
// characters
// ---------------------------------------------------------------------

const characters = {
  A: buildCharacter(scene, { id: "A", x: -0.55, z: 0.35, ry: 0.35, skin: SKIN.a, glow: SKIN_GLOW.a }),
  B: buildCharacter(scene, { id: "B", x: 0.6, z: -0.05, ry: -0.55, skin: SKIN.b, glow: SKIN_GLOW.b }),
};
for (const c of Object.values(characters)) {
  c.movement = {
    mode: "manual", // manual | idle | wander | approach | retreat | toPoint
    speed: 0.55,
    target: new THREE.Vector2(c.root.position.x, c.root.position.z),
    pauseUntil: 0,
    retargetAt: 0,
    fidgetAt: 0,
    fidgetTarget: null,
  };
}

// ---------------------------------------------------------------------
// locomotion — moving a character through the room. Root translation is
// layered on top of the FK rig: while a character is in an autonomous
// mode it also drives its own leg/arm/pelvis/chest joints (a dynamic
// walk-cycle while moving, idle sway + occasional small fidgets while
// still) so the same joints stay available for manual posing once the
// mode is set back to "manual".
// ---------------------------------------------------------------------

const ROOM_BOUNDS = { minX: -2.25, maxX: 2.25, minZ: -1.85, maxZ: 1.85 };
const KEEPOUTS = [
  { cx: -1.55, cz: -1.1, r: 1.3 }, // bed
  { cx: 1.85, cz: -1.85, r: 0.75 }, // tv stand
  { cx: -1.95, cz: -0.15, r: 0.45 }, // lamp
];

function clampToBounds(v) {
  return new THREE.Vector2(
    clamp(v.x, ROOM_BOUNDS.minX, ROOM_BOUNDS.maxX),
    clamp(v.y, ROOM_BOUNDS.minZ, ROOM_BOUNDS.maxZ)
  );
}

function randomFloorPoint() {
  for (let tries = 0; tries < 24; tries++) {
    const x = ROOM_BOUNDS.minX + Math.random() * (ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX);
    const z = ROOM_BOUNDS.minZ + Math.random() * (ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ);
    const blocked = KEEPOUTS.some((k) => (x - k.cx) ** 2 + (z - k.cz) ** 2 < (k.r + 0.3) ** 2);
    if (!blocked) return new THREE.Vector2(x, z);
  }
  return new THREE.Vector2(0, 0);
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

const FIDGET_POOL = [
  { j: "neck", axis: "y", roll: () => (Math.random() * 2 - 1) * 30 },
  { j: "neck", axis: "x", roll: () => (Math.random() * 2 - 1) * 12 },
  { j: "pelvis", axis: "z", roll: () => (Math.random() * 2 - 1) * 6 },
  { j: "leftShoulder", axis: "z", roll: () => 6 + Math.random() * 10 },
  { j: "rightShoulder", axis: "z", roll: () => 6 + Math.random() * 10 },
  { j: "chest", axis: "z", roll: () => (Math.random() * 2 - 1) * 8 },
];

function applyLocomotionPose(character, moving, speed, t) {
  const j = character.joints;
  const m = character.movement;

  if (moving) {
    const strideHz = 0.4 + speed * 0.85;
    const legAmp = 20 + Math.min(20, speed * 16);
    character.pairLinkMode.hip = "flipped";
    character.pairLinkMode.knee = "flipped";
    character.pairLinkMode.shoulder = "flipped";
    Object.assign(j.leftHip.axisState.x, { base: 12, motionOn: true, amp: legAmp, speed: strideHz, phase: 0 });
    Object.assign(j.leftKnee.axisState.x, { base: 22, motionOn: true, amp: legAmp + 10, speed: strideHz, phase: 190 });
    Object.assign(j.leftAnkle.axisState.x, { base: -5, motionOn: true, amp: 12, speed: strideHz, phase: 40 });
    Object.assign(j.leftShoulder.axisState.x, { base: 0, motionOn: true, amp: legAmp - 4, speed: strideHz, phase: 180 });
    Object.assign(j.leftElbow.axisState.x, { base: 16, motionOn: true, amp: 10, speed: strideHz, phase: 0 });
    Object.assign(j.chest.axisState.y, { base: 0, motionOn: true, amp: 6, speed: strideHz, phase: 180 });
    Object.assign(j.pelvis.posAxisState.y, { base: -0.02, motionOn: true, amp: 0.02, speed: strideHz * 2, phase: 0 });
    for (const p of ["hip", "knee", "shoulder"]) syncPair(character, p);
  } else {
    character.pairLinkMode.hip = "independent";
    character.pairLinkMode.knee = "independent";
    for (const id of ["leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle", "leftElbow", "rightElbow", "leftShoulder", "rightShoulder"]) {
      Object.assign(j[id].axisState.x, { base: 0, motionOn: false });
    }
    Object.assign(j.chest.axisState.y, { base: 0, motionOn: false });
    Object.assign(j.pelvis.posAxisState.y, { base: 0, motionOn: false });
    Object.assign(j.chest.axisState.x, { base: 1, motionOn: true, amp: 2.2, speed: 0.22, phase: 0 });

    if (t > m.fidgetAt) {
      if (m.fidgetTarget) {
        const prev = m.fidgetTarget;
        Object.assign(j[prev.j].axisState[prev.axis], { base: 0, motionOn: false });
      }
      const pick = FIDGET_POOL[Math.floor(Math.random() * FIDGET_POOL.length)];
      Object.assign(j[pick.j].axisState[pick.axis], { base: pick.roll(), motionOn: true, amp: 2, speed: 0.4, phase: 0 });
      m.fidgetTarget = pick;
      m.fidgetAt = t + 2.2 + Math.random() * 4;
    }
  }
}

function updateLocomotion(character, other, dt, t) {
  const m = character.movement;
  if (m.mode === "manual") return;

  const root = character.root;
  const pos2 = new THREE.Vector2(root.position.x, root.position.z);

  if (m.mode === "idle") {
    m.target.copy(pos2);
  } else if (m.mode === "wander") {
    if (t >= m.pauseUntil && pos2.distanceTo(m.target) < 0.12) {
      m.pauseUntil = t + 0.6 + Math.random() * 2.2;
      m.target = randomFloorPoint();
    }
  } else if (m.mode === "approach") {
    const otherPos = new THREE.Vector2(other.root.position.x, other.root.position.z);
    const dir = pos2.clone().sub(otherPos);
    const dist = dir.length();
    const minDist = 0.55;
    m.target = dist > minDist ? otherPos.clone().add(dir.normalize().multiplyScalar(minDist)) : pos2.clone();
  } else if (m.mode === "retreat") {
    if (t > m.retargetAt) {
      const otherPos = new THREE.Vector2(other.root.position.x, other.root.position.z);
      let dir = pos2.clone().sub(otherPos);
      if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, Math.random() - 0.5);
      dir.normalize();
      m.target = clampToBounds(pos2.clone().add(dir.multiplyScalar(3.0)));
      m.retargetAt = t + 1.4;
    }
  } else if (m.mode === "toPoint") {
    if (pos2.distanceTo(m.target) < 0.12) m.mode = "idle";
  }

  const paused = m.mode === "wander" && t < m.pauseUntil;
  const toTarget = m.target.clone().sub(pos2);
  const dist = toTarget.length();
  const moving = !paused && dist > 0.06;

  if (moving) {
    const dir = toTarget.normalize();
    const step = Math.min(dist, m.speed * dt);
    root.position.x += dir.x * step;
    root.position.z += dir.y * step;
    const desiredYaw = Math.atan2(dir.x, dir.y);
    root.rotation.y = lerpAngle(root.rotation.y, desiredYaw, Math.min(1, dt * 6));
  }

  applyLocomotionPose(character, moving, m.speed, t);
}

// ---------------------------------------------------------------------
// fusion — a purely cosmetic transform: the two characters shrink into
// each other and a stand-in mesh (an egg, or a small "legendary" beast)
// takes their place, then "解除" reverses the same animation. Pose and
// room-position data are untouched underneath the whole time — only the
// meshes are hidden/scaled, so releasing always comes back to whatever
// pose/place each character was left in.
// ---------------------------------------------------------------------

function paintVerticalGradient(geo, colorTop, colorBottom) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const span = Math.max(1e-4, max.y - min.y);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cTop = new THREE.Color(colorTop);
  const cBottom = new THREE.Color(colorBottom);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / span;
    c.copy(cBottom).lerp(cTop, t);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildEggMesh() {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.3, 1);
  geo.scale(0.82, 1.18, 0.82);
  paintVerticalGradient(geo, SKIN_GLOW.a, SKIN_GLOW.b);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.35, metalness: 0.25,
    emissive: 0x2a2440, emissiveIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

// "legend water" — a wet, futuristic organism rather than a creature you
// could name: a translucent iridescent blob whose skin keeps deforming,
// with drifting tendrils and a glowing core suspended inside it.
function buildWaterMesh() {
  const group = new THREE.Group();

  const skinGeo = new THREE.SphereGeometry(0.36, 40, 30);
  skinGeo.scale(1.06, 0.92, 1.0);
  // bake a permanent asymmetric warp so the body never reads as a sphere:
  // one swollen lobe, one pinched flank, plus low-frequency lumps
  {
    const pos = skinGeo.attributes.position;
    const lobe = new THREE.Vector3(0.62, 0.35, -0.7).normalize();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const d = v.clone().normalize();
      const bulge = Math.max(0, d.dot(lobe)) ** 2 * 0.42;
      const pinch = Math.max(0, -d.x * 0.8 + d.y * 0.3) * 0.16;
      const lumps =
        Math.sin(d.x * 3.4 + d.y * 2.1) * 0.07 +
        Math.sin(d.z * 4.2 - d.y * 3.1) * 0.06 +
        Math.sin(d.y * 5.5 + d.x * 1.8) * 0.05;
      const k = 1 + bulge - pinch + lumps;
      pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    pos.needsUpdate = true;
    skinGeo.computeVertexNormals();
  }
  const restPos = Float32Array.from(skinGeo.attributes.position.array);
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: 0x1ec8bd, roughness: 0.06, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03,
    iridescence: 1, iridescenceIOR: 1.7,
    emissive: 0x064a52, emissiveIntensity: 0.7,
    transparent: true, opacity: 0.8, side: THREE.DoubleSide,
  });
  const skin = new THREE.Mesh(skinGeo, skinMat);
  group.add(skin);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.15, 2),
    new THREE.MeshStandardMaterial({ color: 0x9ffff4, emissive: 0x4ff0dd, emissiveIntensity: 2.2, roughness: 0.2 })
  );
  group.add(core);

  const tendrilMat = new THREE.MeshPhysicalMaterial({
    color: 0x14a8b8, roughness: 0.05, metalness: 0,
    clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6,
    emissive: 0x0a3f55, emissiveIntensity: 0.8,
    transparent: true, opacity: 0.88,
  });
  const tendrils = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 0.2, -0.12, Math.sin(a) * 0.2);
    const len = 0.44 + (i % 3) * 0.16;
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.028, len, 7), tendrilMat);
    t.position.y = -len / 2;
    pivot.add(t);
    pivot.userData.seed = i * 1.7;
    group.add(pivot);
    tendrils.push(pivot);
  }

  const dropMat = new THREE.MeshPhysicalMaterial({
    color: 0x7ff6ec, roughness: 0.02, clearcoat: 1, iridescence: 1,
    emissive: 0x2ad6c4, emissiveIntensity: 1.4, transparent: true, opacity: 0.85,
  });
  const drops = [];
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), dropMat);
    d.userData.seed = i * 1.9;
    group.add(d);
    drops.push(d);
  }

  function animate(t) {
    const pos = skinGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = restPos[i * 3], y = restPos[i * 3 + 1], z = restPos[i * 3 + 2];
      const n =
        Math.sin(x * 5.1 + t * 1.6) * 0.4 +
        Math.sin(y * 4.3 - t * 1.1) * 0.4 +
        Math.sin(z * 5.7 + t * 1.9) * 0.3 +
        Math.sin((x + y + z) * 3.2 + t * 0.8) * 0.5 +
        Math.sin(x * 2.1 - z * 1.7 + t * 0.45) * 0.8 +
        Math.sin(y * 1.9 + x * 2.3 - t * 0.33) * 0.7;
      const s = 1 + n * 0.115;
      pos.setXYZ(i, x * s, y * s, z * s);
    }
    pos.needsUpdate = true;
    skinGeo.computeVertexNormals();

    core.position.set(Math.sin(t * 0.9) * 0.05, Math.sin(t * 1.3) * 0.05, Math.cos(t * 1.1) * 0.05);
    core.rotation.set(t * 0.4, t * 0.6, 0);
    skinMat.iridescenceIOR = 1.5 + Math.sin(t * 0.7) * 0.4;

    for (const p of tendrils) {
      const s = p.userData.seed;
      p.rotation.x = Math.sin(t * 1.2 + s) * 0.5;
      p.rotation.z = Math.cos(t * 1.0 + s * 1.3) * 0.5;
    }
    for (const d of drops) {
      const s = d.userData.seed;
      const r = 0.42 + Math.sin(t * 0.6 + s) * 0.07;
      d.position.set(Math.cos(t * 0.8 + s) * r, Math.sin(t * 1.1 + s) * 0.22, Math.sin(t * 0.8 + s) * r);
    }
  }

  return { group, animate };
}

// an androgynous, humanlike-but-not-human form: a smooth pearlescent
// figure with no gendered or facial features, tapering into a floating
// base instead of legs.
function buildAndrogyneMesh() {
  const outer = new THREE.Group();
  const group = new THREE.Group();
  group.scale.setScalar(0.82);
  outer.add(group);
  const shell = new THREE.MeshPhysicalMaterial({
    color: 0xf4eefb, roughness: 0.1, metalness: 0.05,
    clearcoat: 1, clearcoatRoughness: 0.04,
    iridescence: 1, iridescenceIOR: 1.45,
    emissive: 0x6a5aa0, emissiveIntensity: 0.9,
  });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 18), shell);
  head.scale.set(0.86, 1.45, 0.86);
  head.position.y = 0.62;
  head.castShadow = true;
  group.add(head);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.12, 14), shell);
  neck.position.y = 0.47;
  group.add(neck);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.095, 0.44, 18), shell);
  torso.scale.z = 0.72;
  torso.position.y = 0.21;
  torso.castShadow = true;
  group.add(torso);

  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.015, 0.56, 18), shell);
  lower.scale.z = 0.72;
  lower.position.y = -0.29;
  lower.castShadow = true;
  group.add(lower);

  const arms = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.1, 0.4, 0);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.026, 0.3, 12), shell);
    upper.position.y = -0.15;
    pivot.add(upper);
    const fore = new THREE.Group();
    fore.position.y = -0.3;
    const foreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.016, 0.32, 12), shell);
    foreMesh.position.y = -0.16;
    fore.add(foreMesh);
    pivot.add(fore);
    pivot.userData.fore = fore;
    pivot.userData.side = side;
    group.add(pivot);
    arms.push(pivot);
  }

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.008, 8, 40),
    new THREE.MeshStandardMaterial({ color: 0xcdb6ff, emissive: 0x8f6ce0, emissiveIntensity: 1.6, roughness: 0.3 })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.82;
  group.add(halo);

  function animate(t) {
    for (const p of arms) {
      const s = p.userData.side;
      p.rotation.x = Math.sin(t * 0.55 + s) * 0.18;
      p.rotation.z = s * (0.1 + Math.sin(t * 0.4) * 0.06);
      p.userData.fore.rotation.x = Math.sin(t * 0.6 + s * 1.4) * 0.22;
    }
    head.rotation.y = Math.sin(t * 0.35) * 0.4;
    halo.rotation.z = t * 0.5;
    halo.position.y = 0.82 + Math.sin(t * 1.1) * 0.02;
    shell.iridescenceIOR = 1.35 + Math.sin(t * 0.5) * 0.25;
  }

  return { group: outer, animate };
}

const eggMesh = buildEggMesh();
const waterForm = buildWaterMesh();
const androgyneForm = buildAndrogyneMesh();

const FUSION_FORMS = {
  egg: { mesh: eggMesh, animate: null },
  water: { mesh: waterForm.group, animate: waterForm.animate },
  androgyne: { mesh: androgyneForm.group, animate: androgyneForm.animate },
};

for (const form of Object.values(FUSION_FORMS)) {
  form.mesh.visible = false;
  form.mesh.scale.setScalar(0.001);
  scene.add(form.mesh);
}

const FUSION_DURATION = 0.9;
const fusionState = { mode: null, phase: "none", t: 0, startA: null, startB: null, center: null };

function fusionMeshFor(mode) { return (FUSION_FORMS[mode] || FUSION_FORMS.egg).mesh; }

function startFuse(mode) {
  if (fusionState.phase !== "none") return;
  const a = characters.A.root.position, b = characters.B.root.position;
  fusionState.mode = mode;
  fusionState.phase = "merging";
  fusionState.t = 0;
  fusionState.startA = a.clone();
  fusionState.startB = b.clone();
  fusionState.center = a.clone().add(b).multiplyScalar(0.5);
  fusionState.center.y = 0.95;
  const mesh = fusionMeshFor(mode);
  mesh.position.copy(fusionState.center);
  mesh.visible = true;
  mesh.scale.setScalar(0.001);
  updateFusionButtons();
}

function releaseFuse() {
  if (fusionState.phase !== "fused") return;
  fusionState.phase = "releasing";
  fusionState.t = 0;
  updateFusionButtons();
}

function updateFusionButtons() {
  const fusing = fusionState.phase !== "none";
  fuseEggBtn.disabled = fusing;
  fuseWaterBtn.disabled = fusing;
  fuseAndrogyneBtn.disabled = fusing;
  fuseReleaseBtn.disabled = fusionState.phase !== "fused";
}

function updateFusion(dt, t) {
  if (fusionState.phase === "none") return;
  const form = FUSION_FORMS[fusionState.mode] || FUSION_FORMS.egg;
  const mesh = form.mesh;
  if (form.animate) form.animate(t);

  if (fusionState.phase === "merging") {
    fusionState.t = Math.min(1, fusionState.t + dt / FUSION_DURATION);
    const e = fusionState.t * fusionState.t * (3 - 2 * fusionState.t); // smoothstep
    characters.A.root.position.lerpVectors(fusionState.startA, fusionState.center, e);
    characters.B.root.position.lerpVectors(fusionState.startB, fusionState.center, e);
    characters.A.root.scale.setScalar(1 - e);
    characters.B.root.scale.setScalar(1 - e);
    mesh.scale.setScalar(e);
    mesh.rotation.y = e * Math.PI * 2;
    if (fusionState.t >= 1) {
      characters.A.root.visible = false;
      characters.B.root.visible = false;
      fusionState.phase = "fused";
      fusionState.t = 0;
      updateFusionButtons();
    }
  } else if (fusionState.phase === "fused") {
    mesh.position.y = fusionState.center.y + Math.sin(t * 1.6) * 0.05;
    mesh.rotation.y = t * 0.6;
  } else if (fusionState.phase === "releasing") {
    fusionState.t = Math.min(1, fusionState.t + dt / (FUSION_DURATION * 0.7));
    const e = fusionState.t;
    characters.A.root.visible = true;
    characters.B.root.visible = true;
    characters.A.root.position.lerpVectors(fusionState.center, fusionState.startA, e);
    characters.B.root.position.lerpVectors(fusionState.center, fusionState.startB, e);
    characters.A.root.scale.setScalar(e);
    characters.B.root.scale.setScalar(e);
    mesh.scale.setScalar((1 - e) * (1 + Math.sin(e * Math.PI) * 0.4));
    mesh.rotation.y += dt * (4 + e * 10);
    if (fusionState.t >= 1) {
      mesh.visible = false;
      characters.A.root.scale.setScalar(1);
      characters.B.root.scale.setScalar(1);
      characters.A.movement.target.set(characters.A.root.position.x, characters.A.root.position.z);
      characters.B.movement.target.set(characters.B.root.position.x, characters.B.root.position.z);
      fusionState.phase = "none";
      fusionState.mode = null;
      updateFusionButtons();
    }
  }
}

// ---------------------------------------------------------------------
// presets — built from the same base/amp/speed/phase parameters the UI
// exposes, not canned animation clips.
// ---------------------------------------------------------------------

function resetJoint(j) {
  j.locked = false;
  j.lockedSnapshot = null;
  j.lockedPos = null;
  for (const axis of Object.keys(j.axisState)) Object.assign(j.axisState[axis], defaultAxisState());
  for (const axis of Object.keys(j.posAxisState)) Object.assign(j.posAxisState[axis], defaultAxisState());
}

// Preset library. Every preset only sets base angles / motion oscillator
// parameters on the same joints the UI exposes — there is no separate
// "animation clip" system. Grouped for the preset dropdown into general
// controls, yoga/stretch poses, gait-dance-sport forms, and rehab/PT
// demonstrations.
const PRESET_GROUPS = [
  {
    id: "general", label: "全般 General",
    presets: [
      { id: "reset", label: "Reset pose", apply() {} },
      {
        id: "stand", label: "Idle stand",
        apply(j, character) {
          Object.assign(j.chest.axisState.x, { base: 3, motionOn: true, amp: 3, speed: 0.22, phase: 0 });
          Object.assign(j.pelvis.axisState.y, { base: 0, motionOn: true, amp: 6, speed: 0.09, phase: 0 });
          Object.assign(j.pelvis.axisState.z, { base: 5 });
          Object.assign(j.spine.axisState.z, { base: -4 });
          Object.assign(j.leftHip.axisState.x, { base: 6 });
          Object.assign(j.leftKnee.axisState.x, { base: 14 });
          Object.assign(j.rightKnee.axisState.x, { base: 6 });
          Object.assign(j.leftShoulder.axisState.z, { base: 12, motionOn: true, amp: 3, speed: 0.18, phase: 0 });
          Object.assign(j.leftElbow.axisState.x, { base: 14 });
          Object.assign(j.rightElbow.axisState.x, { base: 10 });
          Object.assign(j.neck.axisState.y, { base: -12 });
          character.pairLinkMode.shoulder = "flipped";
          syncPair(character, "shoulder");
        },
      },
      {
        id: "wave", label: "Wave",
        apply(j) {
          Object.assign(j.rightShoulder.axisState.x, { base: 40 });
          Object.assign(j.rightShoulder.axisState.z, { base: 115, motionOn: true, amp: 18, speed: 1.6, phase: 0 });
          Object.assign(j.rightElbow.axisState.x, { base: 55, motionOn: true, amp: 25, speed: 1.6, phase: 90 });
          Object.assign(j.leftShoulder.axisState.z, { base: 14 });
          Object.assign(j.spine.axisState.y, { base: -8, motionOn: true, amp: 4, speed: 0.4, phase: 0 });
          Object.assign(j.neck.axisState.y, { base: 14 });
        },
      },
    ],
  },
  {
    id: "yoga", label: "ヨガ・ストレッチ Yoga / Stretch",
    presets: [
      {
        id: "catcow", label: "キャット&カウ Cat-Cow",
        apply(j, character) {
          character.pairLinkMode.hip = "symmetric";
          character.pairLinkMode.knee = "symmetric";
          character.pairLinkMode.shoulder = "symmetric";
          character.pairLinkMode.elbow = "symmetric";
          Object.assign(j.pelvis.posAxisState.y, { base: -0.42 });
          Object.assign(j.pelvis.posAxisState.z, { base: 0.05 });
          Object.assign(j.pelvis.axisState.x, { base: 2, motionOn: true, amp: 12, speed: 0.22, phase: 0 });
          Object.assign(j.spine.axisState.x, { base: 6, motionOn: true, amp: 18, speed: 0.22, phase: 10 });
          Object.assign(j.chest.axisState.x, { base: 6, motionOn: true, amp: 14, speed: 0.22, phase: 25 });
          Object.assign(j.neck.axisState.x, { base: 0, motionOn: true, amp: 10, speed: 0.22, phase: 40 });
          Object.assign(j.leftHip.axisState.x, { base: 82 });
          Object.assign(j.leftKnee.axisState.x, { base: 95 });
          Object.assign(j.leftShoulder.axisState.x, { base: 78 });
          Object.assign(j.leftElbow.axisState.x, { base: 8 });
          for (const p of ["hip", "knee", "shoulder", "elbow"]) syncPair(character, p);
        },
      },
      {
        id: "cobra", label: "コブラ Cobra stretch",
        apply(j, character) {
          character.pairLinkMode.hip = "symmetric";
          character.pairLinkMode.shoulder = "symmetric";
          character.pairLinkMode.elbow = "symmetric";
          Object.assign(j.pelvis.posAxisState.y, { base: -0.5 });
          Object.assign(j.pelvis.axisState.x, { base: -10 });
          Object.assign(j.spine.axisState.x, { base: -22, motionOn: true, amp: 4, speed: 0.15, phase: 0 });
          Object.assign(j.chest.axisState.x, { base: -16, motionOn: true, amp: 3, speed: 0.15, phase: 10 });
          Object.assign(j.neck.axisState.x, { base: -14 });
          Object.assign(j.leftHip.axisState.x, { base: -12 });
          Object.assign(j.leftKnee.axisState.x, { base: 4 });
          Object.assign(j.leftShoulder.axisState.x, { base: -28 });
          Object.assign(j.leftElbow.axisState.x, { base: 18 });
          for (const p of ["hip", "shoulder", "elbow"]) syncPair(character, p);
        },
      },
      {
        id: "fold", label: "前屈 Standing forward fold",
        apply(j, character) {
          character.pairLinkMode.hip = "symmetric";
          character.pairLinkMode.knee = "symmetric";
          character.pairLinkMode.shoulder = "symmetric";
          Object.assign(j.pelvis.axisState.x, { base: 10 });
          Object.assign(j.spine.axisState.x, { base: 34, motionOn: true, amp: 4, speed: 0.18, phase: 0 });
          Object.assign(j.chest.axisState.x, { base: 20 });
          Object.assign(j.neck.axisState.x, { base: 14 });
          Object.assign(j.leftHip.axisState.x, { base: 96 });
          Object.assign(j.leftKnee.axisState.x, { base: 14 });
          Object.assign(j.leftShoulder.axisState.x, { base: 150 });
          for (const p of ["hip", "knee", "shoulder"]) syncPair(character, p);
        },
      },
      {
        id: "sidestretch", label: "脇腹伸ばし Standing side stretch",
        apply(j, character) {
          character.pairLinkMode.hip = "independent";
          character.pairLinkMode.knee = "symmetric";
          Object.assign(j.pelvis.axisState.z, { base: 4 });
          Object.assign(j.spine.axisState.z, { base: 16, motionOn: true, amp: 4, speed: 0.15, phase: 0 });
          Object.assign(j.chest.axisState.z, { base: 12 });
          Object.assign(j.leftShoulder.axisState.x, { base: 165 });
          Object.assign(j.leftShoulder.axisState.z, { base: 10 });
          Object.assign(j.rightShoulder.axisState.z, { base: 30 });
          Object.assign(j.leftKnee.axisState.x, { base: 6 });
          syncPair(character, "knee");
        },
      },
    ],
  },
  {
    id: "gait", label: "歩行・ダンス・スポーツ Gait / Dance / Sport",
    presets: [
      {
        id: "walk", label: "Walk-like",
        apply(j, character) {
          character.pairLinkMode.hip = "flipped";
          character.pairLinkMode.knee = "flipped";
          character.pairLinkMode.shoulder = "flipped";
          Object.assign(j.leftHip.axisState.x, { base: 15, motionOn: true, amp: 28, speed: 0.75, phase: 0 });
          Object.assign(j.leftKnee.axisState.x, { base: 25, motionOn: true, amp: 30, speed: 0.75, phase: 190 });
          Object.assign(j.leftAnkle.axisState.x, { base: -5, motionOn: true, amp: 12, speed: 0.75, phase: 40 });
          Object.assign(j.leftShoulder.axisState.x, { base: 0, motionOn: true, amp: 22, speed: 0.75, phase: 180 });
          Object.assign(j.leftElbow.axisState.x, { base: 18, motionOn: true, amp: 10, speed: 0.75, phase: 0 });
          Object.assign(j.pelvis.axisState.y, { base: 0, motionOn: true, amp: 3, speed: 1.5, phase: 0 });
          Object.assign(j.pelvis.axisState.x, { base: 4, motionOn: true, amp: 2, speed: 0.75, phase: 0 });
          Object.assign(j.chest.axisState.y, { base: 0, motionOn: true, amp: 6, speed: 0.75, phase: 180 });
          for (const p of ["hip", "knee", "shoulder"]) syncPair(character, p);
        },
      },
      {
        id: "run", label: "ランニングフォーム Running form",
        apply(j, character) {
          character.pairLinkMode.hip = "flipped";
          character.pairLinkMode.knee = "flipped";
          character.pairLinkMode.shoulder = "flipped";
          character.pairLinkMode.elbow = "flipped";
          Object.assign(j.chest.axisState.x, { base: 8 });
          Object.assign(j.pelvis.axisState.x, { base: 6 });
          Object.assign(j.pelvis.axisState.y, { base: 0, motionOn: true, amp: 5, speed: 1.7, phase: 0 });
          Object.assign(j.leftHip.axisState.x, { base: 20, motionOn: true, amp: 45, speed: 1.5, phase: 0 });
          Object.assign(j.leftKnee.axisState.x, { base: 45, motionOn: true, amp: 55, speed: 1.5, phase: 170 });
          Object.assign(j.leftAnkle.axisState.x, { base: -8, motionOn: true, amp: 15, speed: 1.5, phase: 60 });
          Object.assign(j.leftShoulder.axisState.x, { base: 10, motionOn: true, amp: 38, speed: 1.5, phase: 180 });
          Object.assign(j.leftElbow.axisState.x, { base: 75, motionOn: true, amp: 15, speed: 1.5, phase: 0 });
          for (const p of ["hip", "knee", "shoulder", "elbow"]) syncPair(character, p);
        },
      },
      {
        id: "dancesway", label: "ダンス旋回 Dance turn / sway",
        apply(j, character) {
          character.pairLinkMode.shoulder = "symmetric";
          character.pairLinkMode.knee = "symmetric";
          Object.assign(j.pelvis.axisState.y, { base: 0, motionOn: true, amp: 40, speed: 0.15, phase: 0 });
          Object.assign(j.spine.axisState.y, { base: 0, motionOn: true, amp: 25, speed: 0.15, phase: 180 });
          Object.assign(j.chest.axisState.y, { base: 0, motionOn: true, amp: 15, speed: 0.15, phase: 180 });
          Object.assign(j.leftShoulder.axisState.z, { base: 65, motionOn: true, amp: 10, speed: 0.15, phase: 0 });
          Object.assign(j.leftKnee.axisState.x, { base: 15, motionOn: true, amp: 8, speed: 0.3, phase: 0 });
          for (const p of ["shoulder", "knee"]) syncPair(character, p);
        },
      },
      {
        id: "golfswing", label: "スイング動作 Golf-swing-like rotation",
        apply(j, character) {
          Object.assign(j.chest.axisState.y, { base: 0, motionOn: true, amp: 45, speed: 0.5, phase: 0 });
          Object.assign(j.spine.axisState.y, { base: 0, motionOn: true, amp: 20, speed: 0.5, phase: 20 });
          Object.assign(j.pelvis.axisState.y, { base: 0, motionOn: true, amp: 20, speed: 0.5, phase: 40 });
          Object.assign(j.pelvis.posAxisState.x, { base: 0, motionOn: true, amp: 0.08, speed: 0.5, phase: 40 });
          Object.assign(j.leftKnee.axisState.x, { base: 20 });
          Object.assign(j.rightKnee.axisState.x, { base: 20 });
        },
      },
    ],
  },
  {
    id: "rehab", label: "リハビリ・理学療法 Rehab / PT",
    presets: [
      {
        id: "seatedcore", label: "座位体幹保持 Seated postural control",
        apply(j, character) {
          character.pairLinkMode.hip = "symmetric";
          character.pairLinkMode.knee = "symmetric";
          Object.assign(j.pelvis.posAxisState.y, { base: -0.4 });
          Object.assign(j.leftHip.axisState.x, { base: 88 });
          Object.assign(j.leftKnee.axisState.x, { base: 88 });
          Object.assign(j.spine.axisState.x, { base: 2, motionOn: true, amp: 2, speed: 0.6, random: 0.3 });
          Object.assign(j.pelvis.axisState.z, { base: 0, motionOn: true, amp: 2, speed: 0.5, random: 0.4 });
          for (const p of ["hip", "knee"]) syncPair(character, p);
        },
      },
      {
        id: "singleleg", label: "片脚立位バランス Single-leg balance",
        apply(j, character) {
          character.pairLinkMode.hip = "independent";
          character.pairLinkMode.knee = "independent";
          character.pairLinkMode.ankle = "independent";
          character.pairLinkMode.shoulder = "independent";
          Object.assign(j.leftHip.axisState.x, { base: 68 });
          Object.assign(j.leftKnee.axisState.x, { base: 78 });
          Object.assign(j.rightAnkle.axisState.x, { base: 0, motionOn: true, amp: 3, speed: 0.5, random: 0.5 });
          Object.assign(j.rightAnkle.axisState.z, { base: 0, motionOn: true, amp: 3, speed: 0.45, random: 0.5 });
          Object.assign(j.pelvis.axisState.z, { base: 6, motionOn: true, amp: 2, speed: 0.4, random: 0.4 });
          Object.assign(j.leftShoulder.axisState.z, { base: 20 });
          Object.assign(j.rightShoulder.axisState.z, { base: -15 });
        },
      },
      {
        id: "hiprehab", label: "股関節屈伸リハビリ Hip flex/extend rep",
        apply(j, character) {
          character.pairLinkMode.hip = "independent";
          Object.assign(j.leftHip.axisState.x, { base: 50, motionOn: true, amp: 45, speed: 0.25, phase: 0 });
          Object.assign(j.leftKnee.axisState.x, { base: 35, motionOn: true, amp: 30, speed: 0.25, phase: 40 });
          Object.assign(j.pelvis.axisState.z, { base: -4 });
        },
      },
      {
        id: "squatcontrol", label: "スクワット骨盤コントロール Squat pelvic control",
        apply(j, character) {
          character.pairLinkMode.hip = "symmetric";
          character.pairLinkMode.knee = "symmetric";
          Object.assign(j.pelvis.posAxisState.y, { base: -0.22 });
          Object.assign(j.leftHip.axisState.x, { base: 35 });
          Object.assign(j.leftKnee.axisState.x, { base: 40 });
          Object.assign(j.spine.axisState.x, { base: 8 });
          Object.assign(j.pelvis.axisState.x, { base: 0, motionOn: true, amp: 8, speed: 0.3, phase: 0 });
          for (const p of ["hip", "knee"]) syncPair(character, p);
        },
      },
    ],
  },
];

const PRESETS_BY_ID = {};
for (const group of PRESET_GROUPS) for (const p of group.presets) PRESETS_BY_ID[p.id] = p;

function applyPreset(character, name) {
  // Autonomous movement (anything but "manual") drives these same joints
  // every frame — leaving it engaged would silently overwrite the preset
  // a moment after it's applied, making the preset look like it did nothing.
  character.movement.mode = "manual";
  for (const id of Object.keys(character.joints)) resetJoint(character.joints[id]);
  for (const p of PAIR_IDS) character.pairLinkMode[p] = "independent";
  const preset = PRESETS_BY_ID[name];
  if (!preset) return;
  preset.apply(character.joints, character);
}

// ---------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------

const charTabsEl = document.getElementById("charTabs");
const jointTreeEl = document.getElementById("jointTree");
const jointEditorEl = document.getElementById("jointEditor");
const jointSummaryEl = document.getElementById("jointSummary");
const presetSelect = document.getElementById("presetSelect");
const motionToggleBtn = document.getElementById("motionToggle");
const swapPosesBtn = document.getElementById("swapPoses");
const uiCollapseBtn = document.getElementById("uiCollapse");
const fuseEggBtn = document.getElementById("fuseEgg");
const fuseWaterBtn = document.getElementById("fuseWater");
const fuseAndrogyneBtn = document.getElementById("fuseAndrogyne");
const fuseReleaseBtn = document.getElementById("fuseRelease");
const panelBodyEl = document.getElementById("panelBody");

let activeCharId = "A";
let motionPlaying = true;

function activeCharacter() { return characters[activeCharId]; }

function jointDisabledForUI(character, jointId) {
  const j = character.joints[jointId];
  if (j.locked) return true;
  const def = j.def;
  if (def.pairId && def.side === "R" && character.pairLinkMode[def.pairId] !== "independent") return true;
  return false;
}

const MOVEMENT_MODES = [
  ["manual", "手動"],
  ["idle", "待機"],
  ["wander", "さまよう"],
  ["approach", "近づく"],
  ["retreat", "離れる"],
];

function renderMovementPanel(character) {
  const wrap = document.createElement("div");
  wrap.className = "movement-panel";

  const label = document.createElement("div");
  label.className = "tree-group-label";
  label.textContent = "移動 Movement";
  wrap.appendChild(label);

  const modeRow = document.createElement("div");
  modeRow.className = "link-mode";
  for (const [mode, text] of MOVEMENT_MODES) {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.className = character.movement.mode === mode || (mode === "manual" && character.movement.mode === "toPoint") ? "active" : "";
    btn.addEventListener("click", () => {
      character.movement.mode = mode;
      renderJointTree();
    });
    modeRow.appendChild(btn);
  }
  wrap.appendChild(modeRow);

  wrap.appendChild(axisRow("速度 Speed (m/s)", character.movement.speed, 0.15, 1.4, 0.05,
    (v) => { character.movement.speed = v; }, false));

  const posLabel = document.createElement("div");
  posLabel.className = "tree-group-label";
  posLabel.textContent = "部屋の中の位置 Position (X / Z)";
  wrap.appendChild(posLabel);

  wrap.appendChild(axisRow("左右 (X)", character.root.position.x, ROOM_BOUNDS.minX, ROOM_BOUNDS.maxX, 0.02, (v) => {
    character.root.position.x = v;
    character.movement.target.x = v;
  }, false));
  wrap.appendChild(axisRow("奥行き (Z)", character.root.position.z, ROOM_BOUNDS.minZ, ROOM_BOUNDS.maxZ, 0.02, (v) => {
    character.root.position.z = v;
    character.movement.target.y = v;
  }, false));

  const status = document.createElement("div");
  status.className = "movement-status";
  const dx = character.root.position.x - (character === characters.A ? characters.B : characters.A).root.position.x;
  const dz = character.root.position.z - (character === characters.A ? characters.B : characters.A).root.position.z;
  const distToOther = Math.hypot(dx, dz).toFixed(2);
  status.textContent = `モード: ${character.movement.mode}\n相手までの距離: ${distToOther} m`;
  wrap.appendChild(status);

  const note = document.createElement("p");
  note.className = "movement-note";
  note.textContent = "※「さまよう/近づく/離れる」中は骨盤・脚・肩の一部関節が自動制御され、プリセットの見た目を上書きします。プリセットを選ぶと自動的に「手動」に戻ります。左右/奥行きスライダーと床クリックはどのモードでも使えます。";
  wrap.appendChild(note);

  return wrap;
}

function renderJointTree() {
  jointTreeEl.innerHTML = "";
  const character = activeCharacter();
  jointTreeEl.appendChild(renderMovementPanel(character));
  for (const group of JOINT_GROUPS) {
    const wrap = document.createElement("div");
    wrap.className = "tree-group";
    const label = document.createElement("div");
    label.className = "tree-group-label";
    label.textContent = group.label;
    wrap.appendChild(label);
    for (const id of group.ids) {
      const j = character.joints[id];
      const btn = document.createElement("button");
      btn.className = "tree-item" + (character.selectedJointId === id ? " selected" : "") + (j.locked ? " locked" : "");
      btn.innerHTML = `<span>${j.def.label}</span><span class="lock-dot"></span>`;
      btn.addEventListener("click", () => {
        character.selectedJointId = id;
        renderJointTree();
        renderEditor();
      });
      wrap.appendChild(btn);
    }
    jointTreeEl.appendChild(wrap);
  }
}

function axisRow(labelText, value, min, max, step, onInput, disabled) {
  const row = document.createElement("label");
  row.className = "field";
  const span = document.createElement("span");
  span.textContent = labelText;
  const input = document.createElement("input");
  input.type = "range";
  input.min = min; input.max = max; input.step = step; input.value = value;
  input.disabled = disabled;
  input.addEventListener("input", () => onInput(parseFloat(input.value)));
  row.appendChild(span);
  row.appendChild(input);
  return row;
}

function buildLinkModeControl(character, pairId, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "link-mode";
  const modes = [["independent", "左右独立"], ["symmetric", "左右対称"], ["flipped", "左右反転"]];
  for (const [mode, text] of modes) {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.className = mode === character.pairLinkMode[pairId] ? "active" : "";
    btn.addEventListener("click", () => {
      character.pairLinkMode[pairId] = mode;
      if (mode !== "independent") syncPair(character, pairId);
      onChange();
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function renderEditor() {
  const character = activeCharacter();
  const jointId = character.selectedJointId;
  jointEditorEl.innerHTML = "";
  if (!jointId) {
    jointEditorEl.innerHTML = '<p class="placeholder">左のリストから関節を選択してください</p>';
    return;
  }
  const j = character.joints[jointId];
  const def = j.def;
  const disabled = jointDisabledForUI(character, jointId);

  const title = document.createElement("h3");
  title.className = "editor-title";
  title.textContent = `${def.label} — Character ${character.id}`;
  jointEditorEl.appendChild(title);

  const sub = document.createElement("p");
  sub.className = "editor-sub";
  sub.textContent = disabled
    ? "この関節は左右リンクにより自動追従しています（左側を編集してください）。"
    : "角度（基準姿勢）と、周期運動のパラメータを設定できます。";
  jointEditorEl.appendChild(sub);

  if (def.pairId && def.side === "L") {
    jointEditorEl.appendChild(buildLinkModeControl(character, def.pairId, () => { renderJointTree(); renderEditor(); }));
  }

  if (def.posAxes) {
    const h = document.createElement("h2");
    h.textContent = "位置 Position";
    jointEditorEl.appendChild(h);
    for (const axis of Object.keys(def.posAxes)) {
      const { label, min, max } = def.posAxes[axis];
      const state = j.posAxisState[axis];
      jointEditorEl.appendChild(buildAxisBlock(character, j, axis, label, min, max, state, disabled, "m"));
    }
  }

  const h2 = document.createElement("h2");
  h2.textContent = "角度 Rotation";
  jointEditorEl.appendChild(h2);
  for (const axis of Object.keys(def.axes || {})) {
    const { label, min, max } = def.axes[axis];
    const state = j.axisState[axis];
    jointEditorEl.appendChild(buildAxisBlock(character, j, axis, label, min, max, state, disabled, "deg"));
  }

  const actions = document.createElement("div");
  actions.className = "joint-actions";
  const lockLabel = document.createElement("label");
  const lockInput = document.createElement("input");
  lockInput.type = "checkbox";
  lockInput.checked = j.locked;
  lockInput.addEventListener("change", () => {
    j.locked = lockInput.checked;
    if (j.locked) {
      const snap = {};
      for (const axis of Object.keys(j.axisState)) snap[axis] = evalAxis(j.axisState[axis], j.drift[axis], clock.getElapsedTime());
      j.lockedSnapshot = snap;
      if (def.posAxes) {
        const posSnap = {};
        for (const axis of Object.keys(j.posAxisState)) posSnap[axis] = def.anchor["xyz".indexOf(axis)] + evalAxis(j.posAxisState[axis], j.drift[axis], clock.getElapsedTime());
        j.lockedPos = posSnap;
      }
    }
    if (def.pairId && character.pairLinkMode[def.pairId] !== "independent") syncPair(character, def.pairId);
    renderJointTree();
  });
  lockLabel.appendChild(lockInput);
  lockLabel.appendChild(document.createTextNode("固定 Lock"));
  actions.appendChild(lockLabel);

  const resetBtn = document.createElement("button");
  resetBtn.className = "ghostBtn";
  resetBtn.textContent = "この関節をリセット";
  resetBtn.addEventListener("click", () => {
    resetJoint(j);
    if (def.pairId && character.pairLinkMode[def.pairId] !== "independent") syncPair(character, def.pairId);
    renderJointTree();
    renderEditor();
  });
  actions.appendChild(resetBtn);
  jointEditorEl.appendChild(actions);

  jointSummaryEl.textContent =
    `Character ${character.id}\n${def.label}\n` +
    (def.pairId ? `連動: ${character.pairLinkMode[def.pairId]}\n` : "") +
    (j.locked ? "固定中\n" : "");
}

function buildAxisBlock(character, j, axis, label, min, max, state, disabled, unit) {
  const block = document.createElement("div");
  block.className = "axis-block" + (disabled ? " disabled" : "");

  const head = document.createElement("div");
  head.className = "axis-head";
  const name = document.createElement("span");
  name.className = "axis-name";
  name.textContent = label;
  const val = document.createElement("span");
  val.className = "axis-val";
  val.textContent = unit === "m" ? `${state.base.toFixed(2)} m` : `${state.base.toFixed(0)}°`;
  head.appendChild(name);
  head.appendChild(val);
  block.appendChild(head);

  const step = unit === "m" ? 0.01 : 1;
  const onBase = (v) => {
    state.base = v;
    val.textContent = unit === "m" ? `${v.toFixed(2)} m` : `${v.toFixed(0)}°`;
    onAxisEdited(character, j, axis);
  };
  block.appendChild(axisRow(unit === "m" ? "基準位置" : "基準角度", state.base, min, max, step, onBase, disabled));

  const motionLabel = document.createElement("label");
  motionLabel.className = "field checkbox";
  const motionInput = document.createElement("input");
  motionInput.type = "checkbox";
  motionInput.checked = state.motionOn;
  motionInput.disabled = disabled;
  motionInput.addEventListener("change", () => { state.motionOn = motionInput.checked; onAxisEdited(character, j, axis); });
  motionLabel.appendChild(motionInput);
  motionLabel.appendChild(document.createTextNode("Motion（周期運動）"));
  block.appendChild(motionLabel);

  const grid = document.createElement("div");
  grid.className = "motion-grid";
  const ampMax = unit === "m" ? (max - min) / 2 : Math.max(10, (max - min) / 2);
  grid.appendChild(axisRow("振幅 Amplitude", state.amp, 0, ampMax, unit === "m" ? 0.005 : 0.5,
    (v) => { state.amp = v; onAxisEdited(character, j, axis); }, disabled));
  grid.appendChild(axisRow("速度 Speed (Hz)", state.speed, 0, 3, 0.02,
    (v) => { state.speed = v; onAxisEdited(character, j, axis); }, disabled));
  grid.appendChild(axisRow("位相 Phase (°)", state.phase, 0, 360, 1,
    (v) => { state.phase = v; onAxisEdited(character, j, axis); }, disabled));
  grid.appendChild(axisRow("ランダム量 Random", state.random, 0, 1, 0.02,
    (v) => { state.random = v; onAxisEdited(character, j, axis); }, disabled));
  block.appendChild(grid);

  return block;
}

function onAxisEdited(character, j, axis) {
  const def = j.def;
  if (def.pairId && def.side === "L" && character.pairLinkMode[def.pairId] !== "independent") {
    syncPair(character, def.pairId);
  }
}

charTabsEl.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeCharId = btn.dataset.char;
    charTabsEl.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    renderJointTree();
    renderEditor();
  });
});

for (const group of PRESET_GROUPS) {
  const og = document.createElement("optgroup");
  og.label = group.label;
  for (const preset of group.presets) {
    const opt = document.createElement("option");
    opt.value = preset.id;
    opt.textContent = preset.label;
    og.appendChild(opt);
  }
  presetSelect.appendChild(og);
}

presetSelect.addEventListener("change", () => {
  const v = presetSelect.value;
  if (!v) return;
  applyPreset(activeCharacter(), v);
  renderJointTree();
  renderEditor();
});

motionToggleBtn.addEventListener("click", () => {
  motionPlaying = !motionPlaying;
  motionToggleBtn.textContent = motionPlaying ? "Motion: Playing" : "Motion: Paused";
  motionToggleBtn.classList.toggle("ghostBtn", true);
});

// swaps every joint's pose data (angles, motion params, locks, left/right
// link mode) between Character A and Character B — each rig keeps its own
// mesh/position, only which pose it's holding changes hands.
swapPosesBtn.addEventListener("click", () => {
  const a = characters.A, b = characters.B;
  for (const id of Object.keys(a.joints)) {
    const ja = a.joints[id], jb = b.joints[id];
    [ja.axisState, jb.axisState] = [jb.axisState, ja.axisState];
    [ja.posAxisState, jb.posAxisState] = [jb.posAxisState, ja.posAxisState];
    [ja.locked, jb.locked] = [jb.locked, ja.locked];
    [ja.lockedSnapshot, jb.lockedSnapshot] = [jb.lockedSnapshot, ja.lockedSnapshot];
    [ja.lockedPos, jb.lockedPos] = [jb.lockedPos, ja.lockedPos];
  }
  [a.pairLinkMode, b.pairLinkMode] = [b.pairLinkMode, a.pairLinkMode];
  renderJointTree();
  renderEditor();
});

uiCollapseBtn.addEventListener("click", () => {
  panelBodyEl.classList.toggle("collapsed");
});

fuseEggBtn.addEventListener("click", () => startFuse("egg"));
fuseWaterBtn.addEventListener("click", () => startFuse("water"));
fuseAndrogyneBtn.addEventListener("click", () => startFuse("androgyne"));
fuseReleaseBtn.addEventListener("click", () => releaseFuse());
updateFusionButtons();

// --- click the floor to walk the selected character there -----------------

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let pointerDownAt = null;

canvas.addEventListener("pointerdown", (e) => { pointerDownAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("pointerup", (e) => {
  if (!pointerDownAt) return;
  const moved = Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y);
  pointerDownAt = null;
  if (moved > 6) return; // was a drag (camera orbit), not a click

  const rect = canvas.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hit = raycaster.intersectObject(floor, false)[0];
  if (!hit) return;

  const character = activeCharacter();
  character.movement.mode = "toPoint";
  character.movement.target = new THREE.Vector2(hit.point.x, hit.point.z);
  renderJointTree();
});

// --- room panel wiring ---------------------------------------------------

document.getElementById("lightHue").addEventListener("input", (e) => { roomState.hue = +e.target.value; applyRoomLighting(); });
document.getElementById("lightIntensity").addEventListener("input", (e) => { roomState.intensity = +e.target.value; applyRoomLighting(); });
document.getElementById("lightFlicker").addEventListener("input", (e) => { roomState.flicker = +e.target.value; });
document.getElementById("fogDensity").addEventListener("input", (e) => { roomState.fog = +e.target.value; applyRoomLighting(); });

let tvOn = true;
let tvFlickerAmt = 55;
document.getElementById("tvOn").addEventListener("change", (e) => { tvOn = e.target.checked; });
document.getElementById("tvFlicker").addEventListener("input", (e) => { tvFlickerAmt = +e.target.value; });

renderJointTree();
renderEditor();

// ---------------------------------------------------------------------
// animation loop
// ---------------------------------------------------------------------

const clock = new THREE.Clock();
let simTime = 0;
let lastTvPaint = 0;
let tvBlackUntil = 0;
const lampDrift = makeDrift(-1, 1);
const keyDrift = makeDrift(-1, 1);

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  if (motionPlaying) {
    simTime += dt;
    if (fusionState.phase === "none") {
      updateLocomotion(characters.A, characters.B, dt, simTime);
      updateLocomotion(characters.B, characters.A, dt, simTime);
    }
    updateFusion(dt, simTime);
  }

  applyMotion(characters.A, simTime);
  applyMotion(characters.B, simTime);

  // TV flicker + static refresh
  const now = clock.getElapsedTime();
  if (tvOn) {
    if (now > tvBlackUntil && Math.random() < (tvFlickerAmt / 100) * 0.02) {
      tvBlackUntil = now + Math.random() * 0.12 * (tvFlickerAmt / 100 + 0.1);
    }
    const blacked = now < tvBlackUntil;
    tvScreenMat.color.setScalar(blacked ? 0.05 : 1);
    tvLight.intensity = blacked ? 0.05 : 0.55 + Math.random() * 0.15;
    if (now - lastTvPaint > 0.06 && !blacked) { paintStatic(0.9 + Math.random() * 0.1); lastTvPaint = now; }
  } else {
    tvScreenMat.color.setScalar(0.02);
    tvLight.intensity = 0.02;
  }

  // ambient light flicker
  const flickerRate = roomState.flicker / 100;
  const lampJ = lampDrift.tick(0.15) * flickerRate * 0.5;
  lampLight.intensity = 1.1 * (1 + lampJ) + (Math.random() < flickerRate * 0.03 ? -0.9 : 0);
  const keyJ = keyDrift.tick(0.1) * flickerRate * 0.35;
  keyLight.intensity = ((roomState.intensity / 100) * 2.2 + 0.15) * (1 + keyJ);

  controls.update();
  renderer.render(scene, camera);
}
tick();
