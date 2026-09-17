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

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

const SKIN = { a: 0xf07a2c, b: 0x1c2440 };
const SKIN_GLOW = { a: 0xff9a4d, b: 0x5f79c9 };

const JOINT_DEFS = [
  {
    id: "pelvis", label: "骨盤 Pelvis", parentId: null,
    anchor: [0, 0.98, 0], bindDeg: [0, 0, 0], boneLength: 0.14,
    mesh: { size: [0.32, 0.22, 0.2], center: [0, 0.07, 0] },
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
    anchor: [0, 0.14, 0], bindDeg: [0, 0, 0], boneLength: 0.16,
    mesh: { size: [0.24, 0.16, 0.16], center: [0, 0.08, 0] },
    axes: SPINE_AXES,
  },
  {
    id: "chest", label: "胸郭 Chest", parentId: "spine",
    anchor: [0, 0.16, 0], bindDeg: [0, 0, 0], boneLength: 0.2,
    mesh: { size: [0.34, 0.22, 0.2], center: [0, 0.1, 0] },
    axes: SPINE_AXES,
  },
  {
    id: "neck", label: "首 Neck", parentId: "chest",
    anchor: [0, 0.2, 0], bindDeg: [0, 0, 0], boneLength: 0.1,
    mesh: { size: [0.11, 0.1, 0.11], center: [0, 0.05, 0] },
    axes: {
      x: { label: "前後", min: -25, max: 25 },
      z: { label: "左右傾き", min: -20, max: 20 },
      y: { label: "左右回旋", min: -45, max: 45 },
    },
    tip: { type: "head" },
  },

  { id: "leftShoulder", label: "左肩 Left Shoulder", parentId: "chest", side: "L", pairId: "shoulder",
    anchor: [0.2, 0.16, 0], bindDeg: [0, 0, 180], boneLength: 0.28,
    mesh: { size: [0.11, 0.28, 0.11], center: [0, 0.14, 0] }, axes: SHOULDER_AXES },
  { id: "rightShoulder", label: "右肩 Right Shoulder", parentId: "chest", side: "R", pairId: "shoulder",
    anchor: [-0.2, 0.16, 0], bindDeg: [0, 0, 180], boneLength: 0.28,
    mesh: { size: [0.11, 0.28, 0.11], center: [0, 0.14, 0] }, axes: SHOULDER_AXES },

  { id: "leftElbow", label: "左肘 Left Elbow", parentId: "leftShoulder", side: "L", pairId: "elbow",
    anchor: [0, 0.28, 0], bindDeg: [0, 0, 0], boneLength: 0.25,
    mesh: { size: [0.09, 0.25, 0.09], center: [0, 0.125, 0] }, axes: ELBOW_AXES, tip: { type: "hand" } },
  { id: "rightElbow", label: "右肘 Right Elbow", parentId: "rightShoulder", side: "R", pairId: "elbow",
    anchor: [0, 0.28, 0], bindDeg: [0, 0, 0], boneLength: 0.25,
    mesh: { size: [0.09, 0.25, 0.09], center: [0, 0.125, 0] }, axes: ELBOW_AXES, tip: { type: "hand" } },

  { id: "leftHip", label: "左股関節 Left Hip", parentId: "pelvis", side: "L", pairId: "hip",
    anchor: [0.1, -0.03, 0], bindDeg: [0, 0, 180], boneLength: 0.44,
    mesh: { size: [0.15, 0.44, 0.15], center: [0, 0.22, 0] }, axes: HIP_AXES },
  { id: "rightHip", label: "右股関節 Right Hip", parentId: "pelvis", side: "R", pairId: "hip",
    anchor: [-0.1, -0.03, 0], bindDeg: [0, 0, 180], boneLength: 0.44,
    mesh: { size: [0.15, 0.44, 0.15], center: [0, 0.22, 0] }, axes: HIP_AXES },

  { id: "leftKnee", label: "左膝 Left Knee", parentId: "leftHip", side: "L", pairId: "knee",
    anchor: [0, 0.44, 0], bindDeg: [0, 0, 0], boneLength: 0.42,
    mesh: { size: [0.12, 0.42, 0.12], center: [0, 0.21, 0] }, axes: KNEE_AXES },
  { id: "rightKnee", label: "右膝 Right Knee", parentId: "rightHip", side: "R", pairId: "knee",
    anchor: [0, 0.44, 0], bindDeg: [0, 0, 0], boneLength: 0.42,
    mesh: { size: [0.12, 0.42, 0.12], center: [0, 0.21, 0] }, axes: KNEE_AXES },

  { id: "leftAnkle", label: "左足首 Left Ankle", parentId: "leftKnee", side: "L", pairId: "ankle",
    anchor: [0, 0.42, 0], bindDeg: [90, 0, 0], boneLength: 0.22,
    mesh: { size: [0.1, 0.07, 0.24], center: [0, 0.11, 0.02] }, axes: ANKLE_AXES },
  { id: "rightAnkle", label: "右足首 Right Ankle", parentId: "rightKnee", side: "R", pairId: "ankle",
    anchor: [0, 0.42, 0], bindDeg: [90, 0, 0], boneLength: 0.22,
    mesh: { size: [0.1, 0.07, 0.24], center: [0, 0.11, 0.02] }, axes: ANKLE_AXES },
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

// procedural diagonal scanline texture — gives the low-poly body a
// faint holographic/CRT sheen instead of a flat matte fill.
function makeScanTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2.4;
  ctx.save();
  ctx.translate(32, 32);
  ctx.rotate(-Math.PI / 5);
  ctx.translate(-32, -32);
  for (let x = -64; x < 128; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, -32);
    ctx.lineTo(x, 96);
    ctx.stroke();
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.4, 1.4);
  return tex;
}
const SCAN_TEXTURE = makeScanTexture();

function buildCharacter(scene, { id, x, z, ry, skin, glow }) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = ry;
  scene.add(root);

  const material = new THREE.MeshStandardMaterial({
    color: skin, roughness: 0.45, metalness: 0.2, flatShading: true,
    emissive: glow, emissiveMap: SCAN_TEXTURE, emissiveIntensity: 0.45,
  });
  const jointMat = new THREE.MeshStandardMaterial({
    color: skin, roughness: 0.4, metalness: 0.2, flatShading: true,
    emissive: glow, emissiveIntensity: 0.6,
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

    const geo = new THREE.BoxGeometry(...def.mesh.size);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(...def.mesh.center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bindPivot.add(mesh);

    // small sphere marking the joint itself, softens the box seams
    const jointBall = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(...def.mesh.size) * 0.34, 0), jointMat);
    jointBall.castShadow = true;
    userPivot.add(jointBall);

    if (def.tip?.type === "head") {
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.115, 1), material);
      head.position.set(0, def.boneLength + 0.1, 0);
      head.castShadow = true;
      bindPivot.add(head);
    }
    if (def.tip?.type === "hand") {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.05), material);
      hand.position.set(0, def.boneLength + 0.05, 0);
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

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 7;
controls.minDistance = 1.2;
controls.maxPolarAngle = Math.PI * 0.53;

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
          Object.assign(j.chest.axisState.x, { base: 1, motionOn: true, amp: 2.2, speed: 0.22, phase: 0 });
          Object.assign(j.pelvis.axisState.y, { base: 0, motionOn: true, amp: 4, speed: 0.09, phase: 0 });
          Object.assign(j.leftShoulder.axisState.z, { base: 4, motionOn: true, amp: 3, speed: 0.18, phase: 0 });
          character.pairLinkMode.shoulder = "flipped";
          syncPair(character, "shoulder");
        },
      },
      {
        id: "wave", label: "Wave",
        apply(j) {
          Object.assign(j.rightShoulder.axisState.x, { base: 95 });
          Object.assign(j.rightShoulder.axisState.z, { base: 15, motionOn: true, amp: 22, speed: 1.6, phase: 0 });
          Object.assign(j.rightElbow.axisState.x, { base: 40, motionOn: true, amp: 18, speed: 1.6, phase: 90 });
          Object.assign(j.spine.axisState.y, { base: -6, motionOn: true, amp: 3, speed: 0.4, phase: 0 });
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
          Object.assign(j.leftHip.axisState.x, { base: 45, motionOn: true, amp: 35, speed: 0.25, phase: 0 });
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
const uiCollapseBtn = document.getElementById("uiCollapse");
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

function renderJointTree() {
  jointTreeEl.innerHTML = "";
  const character = activeCharacter();
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
  presetSelect.value = "";
});

motionToggleBtn.addEventListener("click", () => {
  motionPlaying = !motionPlaying;
  motionToggleBtn.textContent = motionPlaying ? "Motion: Playing" : "Motion: Paused";
  motionToggleBtn.classList.toggle("ghostBtn", true);
});

uiCollapseBtn.addEventListener("click", () => {
  panelBodyEl.classList.toggle("collapsed");
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
  if (motionPlaying) simTime += dt;

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
