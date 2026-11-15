'use strict';
// ---- WebGL2 compositing ---------------------------------------------------
// All textures are stored top row first; FBO pixel (x, y) is picture pixel (x, y).
// Only the final pass to the canvas flips.

const GLSL = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp isampler2D;\n';
const VS_FULL = GLSL + 'layout(location=0) in vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';
const VS_POLY = GLSL + 'layout(location=0) in vec2 a; uniform vec2 uSize; void main(){ gl_Position = vec4(a / uSize * 2.0 - 1.0, 0.0, 1.0); }';

const FS_COLOR = GLSL + 'uniform vec4 uColor; out vec4 o; void main(){ o = uColor; }';

const FS_SEED = GLSL + `
uniform sampler2D uMask; uniform vec2 uSize; layout(location=0) out ivec4 o;
float m(vec2 p){ return texture(uMask, p / uSize).r; }
void main(){
  vec2 p = gl_FragCoord.xy;
  bool b = m(p) >= 0.5 && (m(p + vec2(1, 0)) < 0.5 || m(p - vec2(1, 0)) < 0.5 || m(p + vec2(0, 1)) < 0.5 || m(p - vec2(0, 1)) < 0.5);
  o = b ? ivec4(ivec2(p), 0, 0) : ivec4(-1, -1, 0, 0);
}`;

const FS_JFA = GLSL + `
uniform isampler2D uSeed; uniform int uStep; layout(location=0) out ivec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy), sz = textureSize(uSeed, 0);
  ivec2 best = ivec2(-1); float bd = 1e20;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 q = p + ivec2(i, j) * uStep;
    if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) continue;
    ivec2 s = texelFetch(uSeed, q, 0).xy;
    if (s.x < 0) continue;
    vec2 d = vec2(s - p); float dd = dot(d, d);
    if (dd < bd) { bd = dd; best = s; }
  }
  o = ivec4(best, 0, 0);
}`;

const HASH = `
vec4 hash4(vec2 p){ vec4 q = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099)); q += dot(q, q.wzxy + 33.33); return fract((q.xxyz + q.yzzw) * q.zywx); }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }`;

const FS_PLUSH = GLSL + HASH + `
uniform sampler2D uSrc, uMask, uLabel, uTex, uBase; uniform isampler2D uSeed;
uniform vec2 uSize, uBaseScale; uniform float uTexAspect, uTexFrac;
uniform vec2 uAnchor[32]; uniform float uScale[32]; uniform vec2 uOff[32]; uniform float uMeanL[32]; uniform float uRand[32];
uniform float uDilate, uFeather, uShadeG, uDepth, uShadowAmt, uFurLen, uFurDen;
out vec4 o;
int slotAt(vec2 p){ return int(texture(uLabel, p / uSize).r * 255.0 + 0.5); }
vec2 tcoord(vec2 p, int k){ float th = max(uScale[k] * uTexFrac, 2.0); return vec2((p.x - uAnchor[k].x) / (th * uTexAspect), (p.y - uAnchor[k].y) / th) + uOff[k]; }
void main(){
  vec2 p = gl_FragCoord.xy, uv = p / uSize;
  vec3 src = texture(uSrc, uv).rgb;
  bool inside = texture(uMask, uv).r >= 0.5;
  ivec2 sd = texelFetch(uSeed, ivec2(p), 0).xy;
  float dist; vec2 seed; int slot;
  if (sd.x < 0) { if (!inside) { o = vec4(src, 1.0); return; } dist = 1e4; seed = p; slot = slotAt(p); }
  else { seed = vec2(sd) + 0.5; dist = length(seed - p); slot = inside ? slotAt(p) : slotAt(seed); if (slot <= 0) slot = slotAt(seed); }
  if (slot <= 0) { o = vec4(src, 1.0); return; }
  int k = slot - 1;
  float e = (inside ? -dist : dist) - uDilate;      // signed distance to the puffed outline, < 0 inside
  if (e > uFeather * 0.5 + uFurLen + 1.0) { o = vec4(src, 1.0); return; }
  // brightness of this body under the felt, read 3.5 px inside the outline near the edge
  // (edge pixels are mixed with the background). It is split into a broad part (colour of the
  // clothes, light across the body) and the relief (folds, twist): the relief is kept as set,
  // the broad part only at 40%, so a black shirt becomes darker felt, not a black hole.
  vec2 inw = inside ? (p - seed) / max(dist, 1e-3) : (seed - p) / max(dist, 1e-3);
  vec2 qs = (dist < 1e3 && (!inside || dist < 3.5)) ? seed + inw * 3.5 : p;
  float L = lum(texture(uSrc, qs / uSize).rgb) + 0.02;
  vec4 bb = texture(uBase, qs * uBaseScale);
  float B = (bb.g > 1e-3 ? bb.r / bb.g : L - 0.02) + 0.02;
  float ld = log(L / B), lb = log(B / (uMeanL[k] + 0.02));
  ld = ld > 0.0 ? ld / (1.0 + 0.9 * ld) : ld; lb = lb > 0.0 ? lb / (1.0 + 0.9 * lb) : lb;
  float S = exp(uShadeG * (clamp(ld, -2.0, 1.0) + 0.4 * clamp(lb, -2.2, 1.0)));
  float dn = clamp(-e / max(uDepth, 1e-3), 0.0, 1.0);
  float sh = uDepth > 0.0 ? 1.0 - uShadowAmt * pow(1.0 - dn, 1.6) : 1.0;
  vec3 body = texture(uTex, tcoord(p, k)).rgb * S * sh;
  float aBody = 1.0 - smoothstep(-uFeather * 0.5 - 0.5, uFeather * 0.5 + 0.5, e);
  float aFur = 0.0; vec3 fur = vec3(0.0);
  if (uFurLen > 0.0 && e > -0.5 && e < uFurLen + 0.5 && dist < 1e3) {
    vec2 an = uAnchor[k];
    vec2 nrm = (p - seed) / max(dist, 1e-3); if (inside) nrm = -nrm;
    vec2 tg = vec2(-nrm.y, nrm.x);
    float lean = (hash4(floor((seed - an) / 3.0) + uRand[k] * 913.0).x - 0.5) * 0.9;
    vec2 root = seed;
    ivec2 s2 = texelFetch(uSeed, ivec2(p - tg * lean * max(e, 0.0)), 0).xy;
    if (s2.x >= 0) root = vec2(s2) + 0.5;
    vec4 h = hash4(floor(root - an) + uRand[k] * 1777.0);
    float len = uFurLen * (0.35 + 0.65 * h.y);
    if (h.x < uFurDen && e < len) {
      float tt = max(e, 0.0) / len;
      aFur = (1.0 - tt) * 0.92;
      fur = texture(uTex, tcoord(root, k)).rgb * S * (1.0 - 0.5 * uShadowAmt * step(0.0, uDepth - 0.001)) * mix(0.95, 1.12, tt) * (0.85 + 0.3 * h.z);
    }
  }
  float a = max(aBody, aFur);
  vec3 col = aBody >= aFur ? body : fur;
  o = vec4(mix(src, col, a), 1.0);
}`;

// luminance inside the body masks and the mask itself, at a reduced size
const FS_LUMM = GLSL + HASH + `
uniform sampler2D uSrc, uMask; uniform int uF; out vec4 o;
void main(){
  vec2 sz = vec2(textureSize(uSrc, 0)), base = floor(gl_FragCoord.xy) * float(uF);
  float s = 0.0, m = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 q = (base + (vec2(i, j) + 0.5) * float(uF) / 4.0) / sz;
    float mm = step(0.5, texture(uMask, q).r);
    s += lum(texture(uSrc, q).rgb) * mm; m += mm;
  }
  o = vec4(s / 16.0, m / 16.0, 0.0, 1.0);
}`;

const FS_DOWN = GLSL + `
uniform sampler2D uSrc; uniform int uF; out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy) * uF, sz = textureSize(uSrc, 0);
  vec4 s = vec4(0.0); float n = 0.0;
  int st = max(1, uF / 4);
  for (int j = 0; j < 8; j++) { if (j * st >= uF) break; for (int i = 0; i < 8; i++) { if (i * st >= uF) break;
    ivec2 q = min(p + ivec2(i, j) * st, sz - 1); s += texelFetch(uSrc, q, 0); n += 1.0; } }
  o = s / n;
}`;

const FS_BLUR = GLSL + `
uniform sampler2D uT; uniform vec2 uDir; uniform float uSigma; out vec4 o;
void main(){
  vec2 sz = vec2(textureSize(uT, 0)), uv = gl_FragCoord.xy / sz;
  if (uSigma < 0.35) { o = texture(uT, uv); return; }
  float stp = max(1.0, uSigma * 3.0 / 20.0);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -20; i <= 20; i++) {
    float x = float(i) * stp; if (abs(x) > uSigma * 3.0 + stp) continue;
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    acc += w * texture(uT, uv + uDir * x / sz); ws += w;
  }
  o = acc / ws;
}`;

// weights for the smooth face layer: inside the face, not on eyes/brows/mouth/nose,
// and (where asked) not much darker or redder than the skin around it
const FS_WEIGHT = GLSL + HASH + `
uniform sampler2D uD, uE, uM; uniform int uPass; out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 d = texelFetch(uD, p, 0).rgb; vec4 e = texelFetch(uE, p, 0);
  float w = e.b * (1.0 - e.r);
  if (uPass == 1) {
    vec4 m = texelFetch(uM, p, 0);
    if (m.a > 1e-4) {
      vec3 mean = m.rgb / m.a;
      w *= 1.0 - smoothstep(0.03, 0.09, lum(mean) - lum(d));
      w *= 1.0 - smoothstep(0.03, 0.08, (d.r - d.g) - (mean.r - mean.g));
    }
  }
  o = vec4(d * w, w);
}`;

const FS_LOW = GLSL + `
uniform sampler2D uN1, uN2, uD; out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uN1, p, 0), b = texelFetch(uN2, p, 0); vec3 d = texelFetch(uD, p, 0).rgb;
  vec3 lb = b.a > 1e-4 ? b.rgb / b.a : d;
  vec3 la = a.a > 1e-4 ? a.rgb / a.a : lb;
  o = vec4(mix(lb, la, smoothstep(0.06, 0.3, a.a)), 1.0);
}`;

// face: the smooth layer plus skin grain. Plain skin keeps its own detail; eyes, brows, nose,
// mouth and small dark spots get the smooth layer plus grain cut from the cheeks in small square
// pieces; each piece's source is chosen at random among cheek spots that the weight map
// marks as plain skin, so an eye corner or a nostril can never be repeated over the face.
// Four offset layers with tent weights hide the piece edges.
const FS_FACE = GLSL + HASH + `
uniform sampler2D uSrc, uLow, uSoft, uLab, uTex, uW, uE, uN1, uEB; uniform vec2 uSize, uLowScale;
uniform vec2 uC[16]; uniform vec2 uRot[16]; uniform float uPatch[16], uFW[16], uSeed[16], uKeepY[16]; uniform vec2 uOff[16];
uniform float uGrain, uKind, uShadeG, uTexFrac, uTexAspect; out vec4 o;
vec3 low(vec2 p){ return texture(uLow, p * uLowScale).rgb; }
float ok(vec2 p){ return texture(uW, p * uLowScale).a; }
vec2 rot(vec2 v, vec2 r){ return vec2(r.x * v.x - r.y * v.y, r.y * v.x + r.x * v.y); }
vec3 piece(int i, vec2 q, vec2 off, out float w){
  vec2 qq = q + off, cell = floor(qq), r = fract(qq) - 0.5;
  w = (1.0 - 2.0 * abs(r.x)) * (1.0 - 2.0 * abs(r.y));
  float P = uPatch[i], W = uFW[i];
  vec2 src = vec2(-1e9);
  for (int k = 0; k < 8; k++) {
    vec4 h = hash4(cell * 1.37 + off * 9.1 + float(k) * 17.31 + uSeed[i]);
    vec2 l = vec2((h.x < 0.5 ? -1.0 : 1.0) * mix(0.1, 0.33, h.y), mix(-0.02, 0.26, h.z)) * W;
    if (k >= 6) l = vec2(mix(-0.3, 0.3, h.y), mix(-0.2, 0.35, h.z)) * W; // anywhere on plain skin
    vec2 c = uC[i] + rot(l, uRot[i]);
    if (ok(c) > 0.9 && ok(c + rot(vec2(P, P) * 0.6, uRot[i])) > 0.9 && ok(c - rot(vec2(P, P) * 0.6, uRot[i])) > 0.9
        && ok(c + rot(vec2(P, -P) * 0.6, uRot[i])) > 0.9 && ok(c - rot(vec2(P, -P) * 0.6, uRot[i])) > 0.9) { src = c; break; }
  }
  if (src.x < -1e8) { w = 0.0; return vec3(0.0); }
  vec4 h2 = hash4(cell * 2.11 + off * 5.3 + uSeed[i] + 3.7);
  if (h2.x < 0.5) r.x = -r.x;
  if (h2.y < 0.5) r = r.yx;
  vec2 sp = src + rot(r * P, uRot[i]);
  // only the finest grain (pores, sensor noise): the pixel minus its 3x3 neighbourhood
  vec2 px = 1.0 / uSize, u = sp * px; vec3 n9 = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i2 = -1; i2 <= 1; i2++) n9 += texture(uSrc, u + vec2(i2, j) * px).rgb * (j == 0 ? 2.0 : 1.0) * (i2 == 0 ? 2.0 : 1.0);
  return clamp(texture(uSrc, u).rgb - n9 / 16.0, -0.05, 0.05);
}
void main(){
  vec2 p = gl_FragCoord.xy, uv = p / uSize;
  vec3 src = texture(uSrc, uv).rgb;
  float F = texture(uSoft, uv).r;
  int i = int(texture(uLab, uv).r * 255.0 + 0.5) - 1;
  if (F < 0.002 || i < 0) { o = vec4(src, 1.0); return; }
  vec2 d = p - uC[i];
  vec2 lq = rot(d, vec2(uRot[i].x, -uRot[i].y));
  // hair over the forehead and temples stays: dark, above the brows, away from eyes and brows
  float near = texture(uE, p * uLowScale).g;
  float ky = uKeepY[i] + smoothstep(0.25, 0.4, abs(lq.x) / uFW[i]) * 0.15 * uFW[i]; // lower at the temples
  float keep = smoothstep(0.05, 0.14, lum(low(p)) - lum(src)) * (1.0 - near) * (1.0 - smoothstep(ky - 2.0, ky + 2.0, lq.y));
  F *= 1.0 - keep;
  vec3 res;
  if (uKind < 0.5) {
    vec2 q = lq / uPatch[i];
    float w0, w1, w2, w3;
    vec3 g = piece(i, q, vec2(0.0), w0) * w0 + piece(i, q, vec2(0.5, 0.0), w1) * w1 + piece(i, q, vec2(0.0, 0.5), w2) * w2 + piece(i, q, vec2(0.5), w3) * w3;
    float n = sqrt(w0 * w0 + w1 * w1 + w2 * w2 + w3 * w3);
    vec3 H = n > 1e-3 ? g / n : vec3(0.0);
    // plain skin keeps its own detail (it is the skin's own grain); only where the weight map
    // marks eyes, brows, nose, mouth or small dark spots is the detail replaced by cheek grain
    // plain = skin here and within about one "detail size" around (so creases around the eyes and lips go too)
    float frac = texture(uN1, p * uLowScale).a / max(texture(uEB, p * uLowScale).b, 1e-3);
    float plain = smoothstep(0.55, 0.95, ok(p)) * smoothstep(0.8, 0.97, frac);
    res = low(p) + mix(H * uGrain, src - low(p), plain);
  } else {
    float th = max(uFW[i] * 7.0 * uTexFrac, 2.0);
    vec2 tuv = vec2(lq.x / (th * uTexAspect), lq.y / th) + uOff[i];
    float lr = log((lum(low(p)) + 0.02) / (lum(low(uC[i])) + 0.02)); lr = lr > 0.0 ? lr / (1.0 + 0.9 * lr) : lr;
    float S = exp(uShadeG * clamp(lr, -2.2, 1.0));
    res = texture(uTex, tuv).rgb * S;
  }
  o = vec4(mix(src, clamp(res, 0.0, 1.0), F), 1.0);
}`;

const FS_DISP = GLSL + HASH + `
uniform sampler2D uOut, uSrc; uniform vec2 uSize; uniform int uMode; uniform float uGain; out vec4 o;
void main(){
  vec2 uv = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uSize;
  vec3 a = texture(uOut, uv).rgb, b = texture(uSrc, uv).rgb, c;
  if (uMode == 0) c = a; else if (uMode == 1) c = b;
  else c = clamp(vec3(lum(b) * 0.22) + abs(a - b) * uGain, 0.0, 1.0);
  o = vec4(c, 1.0);
}`;

const FS_MEASURE = GLSL + `
uniform sampler2D uOut, uSrc; out vec4 o;
void main(){
  vec2 cell = gl_FragCoord.xy - 0.5, n = vec2(64.0, 36.0);
  float sum = 0.0, cnt = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 uv = (cell + (vec2(i, j) + 0.5) / 4.0) / n;
    vec3 d = abs(texture(uOut, uv).rgb - texture(uSrc, uv).rgb);
    float m = max(d.r, max(d.g, d.b));
    if (m > 3.0 / 255.0) { sum += m; cnt += 1.0; }
  }
  o = vec4(sum / 16.0, cnt / 16.0, 0.0, 1.0);
}`;

class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 が使えません');
    this.gl = gl; this.canvas = canvas;
    this.half = !!gl.getExtension('EXT_color_buffer_float');
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const P = (vs, fs) => this._prog(vs, fs);
    this.p = {
      color: P(VS_POLY, FS_COLOR), seed: P(VS_FULL, FS_SEED), jfa: P(VS_FULL, FS_JFA), plush: P(VS_FULL, FS_PLUSH),
      down: P(VS_FULL, FS_DOWN), lumm: P(VS_FULL, FS_LUMM), blur: P(VS_FULL, FS_BLUR), weight: P(VS_FULL, FS_WEIGHT), low: P(VS_FULL, FS_LOW),
      face: P(VS_FULL, FS_FACE), disp: P(VS_FULL, FS_DISP), measure: P(VS_FULL, FS_MEASURE),
    };
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.fullBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.fullBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.polyBuf = gl.createBuffer();
    gl.enableVertexAttribArray(0);
    this.W = 0; this.H = 0; this.tex = {}; this.work = null;
    this.texAspect = 1;
    this.tex.felt = this._tex(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.measureFbo = this._target(64, 36, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.measureBuf = new Uint8Array(64 * 36 * 4);
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }
  _prog(vs, fs) {
    const gl = this.gl, mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 3).join(' ')); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); const name = a.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }
  _tex(w, h, ifmt, fmt, type, filter, wrap) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap || gl.CLAMP_TO_EDGE);
    t.w = w; t.h = h; return t;
  }
  _target(w, h, ifmt, fmt, type, filter) {
    const gl = this.gl, t = this._tex(w, h, ifmt, fmt, type, filter), f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    t.fbo = f; return t;
  }
  _free(t) { if (!t) return; const gl = this.gl; if (t.fbo) gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t); }
  resize(W, H, GW, GH) {
    const gl = this.gl;
    if (W > this.maxSize || H > this.maxSize) throw new Error(`この端末では ${this.maxSize}px より大きい映像を扱えません`);
    this.canvas.width = W; this.canvas.height = H;
    for (const k of ['src', 'out', 'seedA', 'seedB', 'lab', 'soft', 'softT', 'mask', 'label']) { this._free(this.tex[k]); this.tex[k] = null; }
    this._freeWork();
    this.W = W; this.H = H;
    const T = this.tex;
    T.src = this._target(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    T.out = this._target(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    T.seedA = this._target(W, H, gl.RG16I, gl.RG_INTEGER, gl.SHORT, gl.NEAREST);
    T.seedB = this._target(W, H, gl.RG16I, gl.RG_INTEGER, gl.SHORT, gl.NEAREST);
    T.lab = this._target(W, H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST);
    T.soft = this._target(W, H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR);
    T.softT = this._target(W, H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR);
    T.mask = this._tex(GW, GH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR);
    T.label = this._tex(GW, GH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.GW = GW; this.GH = GH;
  }
  _freeWork() { if (!this.work) return; for (const k in this.work) if (this.work[k] && this.work[k].fbo) this._free(this.work[k]); this.work = null; }
  _ensureWork(f) {
    if (this.work && this.work.f === f) return this.work;
    this._freeWork();
    const gl = this.gl, w = Math.ceil(this.W / f), h = Math.ceil(this.H / f);
    const ff = this.half ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    const mk = () => this._target(w, h, ...ff, gl.LINEAR);
    this.work = { f, w, h, D: mk(), E: this._target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR), M: mk(), T: mk(), A: mk(), N1: mk(), N2: mk(), low: mk() };
    return this.work;
  }
  upload(img) { // source frame
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.tex.src);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }
  uploadTexture(img, w, h) { // the felt / fur material
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.tex.felt);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    this.texAspect = w / h;
  }
  uploadMasks(union, label) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex.mask); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.GW, this.GH, gl.RED, gl.UNSIGNED_BYTE, union);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.label); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.GW, this.GH, gl.RED, gl.UNSIGNED_BYTE, label);
  }
  _use(pr, target, w, h) {
    const gl = this.gl; gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w || (target ? target.w : this.W), h || (target ? target.h : this.H));
  }
  _bind(pr, name, unit, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(pr.u[name], unit); }
  _full() { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.fullBuf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  _poly(pts) { // convex / star-shaped polygon as a fan around its centroid
    const gl = this.gl, n = pts.length; if (n < 3) return;
    let cx = 0, cy = 0; for (const q of pts) { cx += q[0]; cy += q[1]; }
    const a = new Float32Array((n + 2) * 2); a[0] = cx / n; a[1] = cy / n;
    for (let i = 0; i <= n; i++) { const q = pts[i % n]; a[2 + 2 * i] = q[0]; a[3 + 2 * i] = q[1]; }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.polyBuf); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STREAM_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLE_FAN, 0, n + 2);
  }
  _blur(src, tmp, dst, sigma) {
    const gl = this.gl, pr = this.p.blur;
    this._use(pr, tmp); this._bind(pr, 'uT', 0, src); gl.uniform2f(pr.u.uDir, 1, 0); gl.uniform1f(pr.u.uSigma, sigma); this._full();
    this._use(pr, dst); this._bind(pr, 'uT', 0, tmp); gl.uniform2f(pr.u.uDir, 0, 1); gl.uniform1f(pr.u.uSigma, sigma); this._full();
  }
  _copySrcToOut() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.tex.src.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.tex.out.fbo);
    gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  // ---------------------------------------------------------------- plush ---
  plush(fs, P) {
    const gl = this.gl, T = this.tex, slots = fs.slots || [];
    if (!slots.length) { this._copySrcToOut(); return 0; }
    // seeds on the outline, then jump flooding out to the furthest distance any setting reaches
    let pr = this.p.seed; this._use(pr, T.seedA); this._bind(pr, 'uMask', 0, T.mask); gl.uniform2f(pr.u.uSize, this.W, this.H); this._full();
    const reach = P.dilate + P.feather + P.furLen + P.depth + 4;
    let step = 1; while (step < reach) step *= 2;
    let a = T.seedA, b = T.seedB;
    pr = this.p.jfa;
    for (; step >= 1; step >>= 1) { this._use(pr, b); this._bind(pr, 'uSeed', 0, a); gl.uniform1i(pr.u.uStep, step); this._full(); [a, b] = [b, a]; }
    // broad brightness of the bodies: normalized blur of luminance inside the masks
    const hs = slots.map((q) => q.scale).sort((x, y) => x - y), sb = clamp(hs[hs.length >> 1] * 0.06, 3, 80);
    const f = clamp(Math.round(sb / 3), 2, 8), Wk = this._ensureWork(f);
    pr = this.p.lumm; this._use(pr, Wk.D); this._bind(pr, 'uSrc', 0, T.src); this._bind(pr, 'uMask', 1, T.mask); gl.uniform1i(pr.u.uF, f); this._full();
    this._blur(Wk.D, Wk.A, Wk.M, sb / f);
    pr = this.p.plush; this._use(pr, T.out);
    this._bind(pr, 'uSrc', 0, T.src); this._bind(pr, 'uMask', 1, T.mask); this._bind(pr, 'uLabel', 2, T.label); this._bind(pr, 'uTex', 3, T.felt); this._bind(pr, 'uSeed', 4, a); this._bind(pr, 'uBase', 5, Wk.M);
    gl.uniform2f(pr.u.uBaseScale, 1 / (Wk.w * f), 1 / (Wk.h * f));
    const n = 32, an = new Float32Array(n * 2), sc = new Float32Array(n), off = new Float32Array(n * 2), ml = new Float32Array(n), rd = new Float32Array(n);
    for (const s of slots) { const k = s.slot - 1; an[2 * k] = s.anchor[0]; an[2 * k + 1] = s.anchor[1]; sc[k] = s.scale; off[2 * k] = hash01(s.id * 31 + 1) * 7.3; off[2 * k + 1] = hash01(s.id * 57 + 3) * 5.1; ml[k] = s.meanL; rd[k] = s.rand; }
    gl.uniform2fv(pr.u.uAnchor, an); gl.uniform1fv(pr.u.uScale, sc); gl.uniform2fv(pr.u.uOff, off); gl.uniform1fv(pr.u.uMeanL, ml); gl.uniform1fv(pr.u.uRand, rd);
    gl.uniform2f(pr.u.uSize, this.W, this.H); gl.uniform1f(pr.u.uTexAspect, this.texAspect); gl.uniform1f(pr.u.uTexFrac, P.texSize / 100);
    gl.uniform1f(pr.u.uDilate, P.dilate); gl.uniform1f(pr.u.uFeather, P.feather); gl.uniform1f(pr.u.uShadeG, P.shade / 100);
    gl.uniform1f(pr.u.uDepth, P.depth); gl.uniform1f(pr.u.uShadowAmt, P.shadowAmt / 100); gl.uniform1f(pr.u.uFurLen, P.furLen); gl.uniform1f(pr.u.uFurDen, P.furDen / 100);
    this._full();
    return slots.length;
  }

  // ---------------------------------------------------------- no face ---
  face(fs, P) {
    const gl = this.gl, T = this.tex;
    const faces = fs.faces.filter((f) => f.applied).slice(0, 16);
    if (!faces.length) { this._copySrcToOut(); return 0; }
    const f = clamp(Math.round(P.detail / 3), 1, 8), sig = P.detail / f, Wk = this._ensureWork(f);
    // E: r = features, g = around the features (hair is never kept there), b = face region (work resolution)
    let pr = this.p.color; this._use(pr, Wk.E); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform2f(pr.u.uSize, this.W, this.H);
    for (const fc of faces) {
      gl.uniform4f(pr.u.uColor, 0, 0, 1, 0); this._poly(fc.oval);
      for (const h of fc.feats) { gl.uniform4f(pr.u.uColor, 0, 1, 0, 0); this._poly(inflatePoly(h, fc.width * 0.05 + 2)); }
      for (const h of fc.feats) { gl.uniform4f(pr.u.uColor, 1, 0, 0, 0); this._poly(h); }
    }
    // label (full res, slightly larger than the soft mask) and the soft mask itself
    pr = this.p.color; this._use(pr, T.lab); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform2f(pr.u.uSize, this.W, this.H);
    faces.forEach((fc, i) => { gl.uniform4f(pr.u.uColor, (i + 1) / 255, 0, 0, 0); this._poly(inflatePoly(fc.oval, P.faceFeather + 3)); });
    this._use(pr, T.soft); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform2f(pr.u.uSize, this.W, this.H); gl.uniform4f(pr.u.uColor, 1, 0, 0, 0);
    for (const fc of faces) this._poly(inflatePoly(fc.oval, -P.faceFeather * 0.5));
    gl.disable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
    if (P.faceFeather > 0.3) this._blur(T.soft, T.softT, T.soft, P.faceFeather / 2.5);
    // smooth face layer: down-sample, local mean, outlier weights, two widths of normalized blur
    pr = this.p.down; this._use(pr, Wk.D); this._bind(pr, 'uSrc', 0, T.src); gl.uniform1i(pr.u.uF, f); this._full();
    pr = this.p.weight; this._use(pr, Wk.T); this._bind(pr, 'uD', 0, Wk.D); this._bind(pr, 'uE', 1, Wk.E); this._bind(pr, 'uM', 2, Wk.D); gl.uniform1i(pr.u.uPass, 0); this._full();
    this._blur(Wk.T, Wk.A, Wk.M, sig);
    pr = this.p.weight; this._use(pr, Wk.T); this._bind(pr, 'uD', 0, Wk.D); this._bind(pr, 'uE', 1, Wk.E); this._bind(pr, 'uM', 2, Wk.M); gl.uniform1i(pr.u.uPass, 1); this._full();
    this._blur(Wk.T, Wk.A, Wk.N1, sig);
    this._blur(Wk.T, Wk.A, Wk.N2, sig * 3.5);
    pr = this.p.low; this._use(pr, Wk.low); this._bind(pr, 'uN1', 0, Wk.N1); this._bind(pr, 'uN2', 1, Wk.N2); this._bind(pr, 'uD', 2, Wk.D); this._full();
    this._blur(Wk.E, Wk.A, Wk.M, sig); // face region blurred like the weights, to tell "near a feature" from "near the edge"
    // composite
    pr = this.p.face; this._use(pr, T.out);
    this._bind(pr, 'uSrc', 0, T.src); this._bind(pr, 'uLow', 1, Wk.low); this._bind(pr, 'uSoft', 2, T.soft); this._bind(pr, 'uLab', 3, T.lab); this._bind(pr, 'uTex', 4, T.felt); this._bind(pr, 'uW', 5, Wk.T); this._bind(pr, 'uE', 6, Wk.E); this._bind(pr, 'uN1', 7, Wk.N1); this._bind(pr, 'uEB', 8, Wk.M);
    const n = 16, C = new Float32Array(n * 2), R = new Float32Array(n * 2), Pt = new Float32Array(n), FW = new Float32Array(n), SD = new Float32Array(n), O = new Float32Array(n * 2), KY = new Float32Array(n);
    faces.forEach((fc, i) => {
      C[2 * i] = fc.center[0]; C[2 * i + 1] = fc.center[1]; R[2 * i] = Math.cos(fc.roll); R[2 * i + 1] = Math.sin(fc.roll);
      Pt[i] = Math.max(3, fc.width * 0.09); FW[i] = fc.width; SD[i] = hash01(fc.id * 13 + 1) * 97; KY[i] = fc.keepY == null ? -1e9 : fc.keepY;
      O[2 * i] = hash01(fc.id * 17 + 5) * 6.1; O[2 * i + 1] = hash01(fc.id * 29 + 9) * 4.3;
    });
    gl.uniform2fv(pr.u.uC, C); gl.uniform2fv(pr.u.uRot, R); gl.uniform1fv(pr.u.uPatch, Pt); gl.uniform1fv(pr.u.uFW, FW);
    gl.uniform1fv(pr.u.uSeed, SD); gl.uniform2fv(pr.u.uOff, O); gl.uniform1fv(pr.u.uKeepY, KY);
    gl.uniform2f(pr.u.uSize, this.W, this.H); gl.uniform2f(pr.u.uLowScale, 1 / (Wk.w * f), 1 / (Wk.h * f));
    gl.uniform1f(pr.u.uGrain, P.grain / 100); gl.uniform1f(pr.u.uKind, P.faceKind === 'felt' ? 1 : 0);
    gl.uniform1f(pr.u.uShadeG, P.shade / 100); gl.uniform1f(pr.u.uTexFrac, P.texSize / 100); gl.uniform1f(pr.u.uTexAspect, this.texAspect);
    this._full();
    return faces.length;
  }

  process(fs, P) { return P.mode === 1 ? this.plush(fs, P) : this.face(fs, P); }
  display(mode, gain) { // 0 processed, 1 original, 2 difference
    const gl = this.gl, pr = this.p.disp; this._use(pr, null, this.W, this.H);
    this._bind(pr, 'uOut', 0, this.tex.out); this._bind(pr, 'uSrc', 1, this.tex.src);
    gl.uniform2f(pr.u.uSize, this.W, this.H); gl.uniform1i(pr.u.uMode, mode); gl.uniform1f(pr.u.uGain, gain); this._full();
  }
  measure() { // share of the picture that changed, and how much on average where it did
    const gl = this.gl, pr = this.p.measure; this._use(pr, this.measureFbo);
    this._bind(pr, 'uOut', 0, this.tex.out); this._bind(pr, 'uSrc', 1, this.tex.src); this._full();
    gl.readPixels(0, 0, 64, 36, gl.RGBA, gl.UNSIGNED_BYTE, this.measureBuf);
    let s = 0, c = 0; for (let i = 0; i < 64 * 36; i++) { s += this.measureBuf[4 * i]; c += this.measureBuf[4 * i + 1]; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { area: c / (64 * 36 * 255), mean: c > 0 ? s / c : 0 };
  }
}
