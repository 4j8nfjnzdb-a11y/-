// Kasane — WebGL2 plumbing: shader programs, pooled render targets, the shared shaders.
// One convention everywhere: a texture's v = 0 is the TOP row of the picture (uploads are not flipped,
// and framebuffers are drawn with comp y pointing down), so reading pixels back needs no flip either.
// Colour is premultiplied alpha throughout.
'use strict';
(() => {
  const G = KS.G = { gl: null, gen: 0, floatOK: false, maxTex: 4096, lost: false };

  const VS_QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;
  const VS_LAYER = `#version 300 es
in vec3 aPos; in vec2 aUv;
uniform mat3 uMat; uniform vec2 uView; uniform float uZk, uZs;
out vec2 vUv; out vec3 vP;
void main(){
  vec3 w = uMat * vec3(aPos.xy, 1.);
  vUv = aUv; vP = vec3(w.xy, aPos.z * uZs);
  gl_Position = vec4(w.xy / uView * 2. - 1., clamp(-aPos.z * uZk, -1., 1.), 1.);
}`;
  const HEAD = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
const vec3 LUM = vec3(.2126, .7152, .0722);
`;
  G.SRC = {
    copy: HEAD + `uniform sampler2D uTex; void main(){ o = texture(uTex, vUv); }`,
    // a layer (or a layer's deformed mesh) placed in the frame
    layer: `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec4 uColor; uniform float uEdge, uShade, uBack, uFlip; uniform vec3 uLight, uPaper;
in vec2 vUv; in vec3 vP; out vec4 o;
void main(){
  vec4 c = texture(uTex, vUv) * uColor;
  if (uEdge > .5) { vec2 f = max(fwidth(vUv), vec2(1e-6)); vec2 d = min(vUv, 1. - vUv) / f; c *= clamp(min(d.x, d.y), 0., 1.); }
  if (uBack > 0. && (gl_FrontFacing ? 1. : -1.) * uFlip < 0.) c.rgb = mix(c.rgb, uPaper * c.a, uBack);   // the back of the sheet
  if (uShade > 0.) {
    vec3 n = normalize(cross(dFdx(vP), dFdy(vP))); if (n.z < 0.) n = -n;
    float l = dot(n, uLight);
    c.rgb *= mix(1., clamp(1. + (l - uLight.z) * 1.25, .36, 1.35), uShade);
    c.rgb = min(c.rgb, vec3(c.a));
  }
  o = c;
}`,
    // source over destination with a blend mode and an optional track matte (W3C compositing maths)
    blend: HEAD + `uniform sampler2D uDst, uSrc, uMatte; uniform float uMode, uMatteMode, uOpacity;
float lum(vec3 c){ return dot(c, vec3(.3, .59, .11)); }
vec3 clipc(vec3 c){ float l = lum(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);
  if (n < 0.) c = l + (c - l) * l / (l - n + 1e-6); if (x > 1.) c = l + (c - l) * (1. - l) / (x - l + 1e-6); return c; }
vec3 setlum(vec3 c, float l){ return clipc(c + (l - lum(c))); }
float sat(vec3 c){ return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setsat(vec3 c, float s){ float n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b); return x > n ? (c - n) * s / (x - n) : vec3(0.); }
float sl(float b, float s){ if (s <= .5) return b - (1. - 2. * s) * b * (1. - b); float d = b <= .25 ? ((16. * b - 12.) * b + 4.) * b : sqrt(b); return b + (2. * s - 1.) * (d - b); }
vec3 bl(vec3 b, vec3 s, int m){
  if (m == 1) return b * s;
  if (m == 2) return b + s - b * s;
  if (m == 3) return mix(2. * b * s, 1. - 2. * (1. - b) * (1. - s), step(.5, b));
  if (m == 4) return min(b + s, 1.);
  if (m == 5) return min(b, s);
  if (m == 6) return max(b, s);
  if (m == 7) return mix(min(vec3(1.), b / max(1. - s, 1e-4)), vec3(1.), step(1., s));
  if (m == 8) return mix(1. - min(vec3(1.), (1. - b) / max(s, 1e-4)), vec3(0.), step(s, vec3(0.)));
  if (m == 9) return mix(2. * b * s, 1. - 2. * (1. - b) * (1. - s), step(.5, s));
  if (m == 10) return vec3(sl(b.r, s.r), sl(b.g, s.g), sl(b.b, s.b));
  if (m == 11) return abs(b - s);
  if (m == 12) return b + s - 2. * b * s;
  if (m == 13) return setlum(setsat(s, sat(b)), lum(b));
  if (m == 14) return setlum(setsat(b, sat(s)), lum(b));
  if (m == 15) return setlum(s, lum(b));
  if (m == 16) return setlum(b, lum(s));
  return s;
}
void main(){
  vec4 d = texture(uDst, vUv), s = texture(uSrc, vUv) * uOpacity;
  if (uMatteMode > .5) {
    vec4 m = texture(uMatte, vUv);
    float k = uMatteMode < 2.5 ? m.a : dot(m.rgb, LUM);
    if ((uMatteMode > 1.5 && uMatteMode < 2.5) || uMatteMode > 3.5) k = 1. - k;
    s *= clamp(k, 0., 1.);
  }
  vec3 cb = d.a > 1e-4 ? d.rgb / d.a : vec3(0.), cs = s.a > 1e-4 ? clamp(s.rgb / s.a, 0., 1.) : vec3(0.);
  vec3 B = clamp(bl(cb, cs, int(uMode + .5)), 0., 1.);
  o = vec4(s.a * (1. - d.a) * cs + s.a * d.a * B + (1. - s.a) * d.rgb, s.a + d.a * (1. - s.a));
}`,
    // adjustment layer: the processed picture shows through wherever the layer covers the frame
    adjust: HEAD + `uniform sampler2D uDst, uFx, uCov; void main(){ o = mix(texture(uDst, vUv), texture(uFx, vUv), clamp(texture(uCov, vUv).a, 0., 1.)); }`,
    mask: HEAD + `uniform sampler2D uTex, uMask; void main(){ o = texture(uTex, vUv) * texture(uMask, vUv).r; }`,
    maskIn: HEAD + `uniform sampler2D uTex; uniform float uInv, uOp; void main(){ float m = texture(uTex, vUv).r; o = vec4(vec3(mix(m, 1. - m, uInv) * uOp), 1.); }`,
    // torn paper: the mask's green channel is a slightly wider tear, shown as bare paper fibre
    torn: HEAD + `uniform sampler2D uTex, uMask; uniform vec3 uPaper;
void main(){ vec4 c = texture(uTex, vUv); vec4 m = texture(uMask, vUv); float core = m.r, fringe = max(m.g, m.r);
  o = c * core + vec4(uPaper, 1.) * c.a * (fringe - core); }`,
    flatten: HEAD + `uniform sampler2D uTex; uniform vec4 uBg; uniform float uFlipY;
void main(){ vec4 c = texture(uTex, vec2(vUv.x, mix(vUv.y, 1. - vUv.y, uFlipY))); o = vec4(c.rgb + uBg.rgb * (1. - c.a), 1.); }`,
    // the viewer: the composition lying on the cutting mat
    present: `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uCanvas, uPan, uComp; uniform float uZoom, uDpr, uSurround, uAlpha; uniform vec4 uBg;
out vec4 o;
float grid(vec2 p, float step, float w){ vec2 g = abs(fract(p / step - .5) - .5) * step; return 1. - smoothstep(0., w, min(g.x, g.y)); }
void main(){
  vec2 scr = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 cp = (scr - uPan) / uZoom;
  vec3 mat = vec3(.060, .086, .076);
  if (uSurround > .5) {
    float minor = 50., major = 250.;
    if (uZoom < .22) { minor = 250.; major = 1250.; } else if (uZoom > 2.4) { minor = 10.; major = 50.; }
    float px = 1. / uZoom * uDpr;
    mat += vec3(.030, .044, .038) * grid(cp, minor, px * 1.1) + vec3(.050, .074, .062) * grid(cp, major, px * 1.6);
    vec2 q = scr / uCanvas - .5; mat *= 1. - dot(q, q) * .55;
  } else if (uSurround < -.5) mat = vec3(0.);
  vec2 uv = cp / uComp;
  vec3 col = mat;
  // soft shadow under the sheet
  vec2 e = max(vec2(0.), max(-cp, cp - uComp)) * uZoom / uDpr; float sh = exp(-dot(e, e) / 220.) * .5;
  col *= 1. - sh * step(1e-5, dot(e, e));
  if (uv.x >= 0. && uv.x <= 1. && uv.y >= 0. && uv.y <= 1.) {
    vec4 c = texture(uTex, uv);
    vec2 ch = floor(scr / (9. * uDpr)); float k = mod(ch.x + ch.y, 2.);
    vec3 under = uAlpha > .5 ? mix(vec3(.16), vec3(.22), k) : uBg.rgb;
    col = c.rgb + under * (1. - c.a);
  }
  o = vec4(col, 1.);
}`,
  };

  const progs = new Map();
  let quadVao = null, meshVao = null, meshPos = null, meshUv = null, meshIdx = null, white = null;
  let pool = [];

  G.init = (canvas) => {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) return false;
    G.gl = gl; G.canvas = canvas;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { G.lost = false; setup(); if (G.onRestore) G.onRestore(); });
    setup();
    return true;
  };
  function setup() {
    const gl = G.gl;
    G.gen++; progs.clear(); pool = [];
    G.floatOK = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    G.maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    quadVao = gl.createVertexArray(); gl.bindVertexArray(quadVao);
    const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    meshVao = gl.createVertexArray(); gl.bindVertexArray(meshVao);
    meshPos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, meshPos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    meshUv = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, meshUv); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    meshIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx);
    gl.bindVertexArray(null);
    white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    G.white = white;
  }

  function compile(type, src) {
    const gl = G.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) || '';
      const m = /ERROR: \d+:(\d+)/.exec(log), line = m ? src.split('\n')[+m[1] - 1] : '';
      throw new Error('shader: ' + log.trim() + (line ? '\n> ' + line.trim() : ''));
    }
    return s;
  }
  // fs is the cache key; vs is 'quad' or 'layer'
  G.prog = (fs, vs = 'quad') => {
    let p = progs.get(fs);
    if (p) return p;
    const gl = G.gl, pr = gl.createProgram();
    gl.attachShader(pr, compile(gl.VERTEX_SHADER, vs === 'layer' ? VS_LAYER : VS_QUAD));
    gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(pr, 0, 'aPos'); gl.bindAttribLocation(pr, 1, 'aUv');
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(pr));
    p = { pr, loc: new Map(), samplers: new Map() };
    const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(pr, i), name = info.name.replace(/\[0\]$/, '');
      p.loc.set(name, gl.getUniformLocation(pr, info.name));
      if (info.type === gl.SAMPLER_2D) p.samplers.set(name, unit++);
    }
    progs.set(fs, p);
    return p;
  };
  // uniforms by value shape: number → float, [2|3|4] → vec, [6] → 2-D affine as mat3, WebGLTexture / {tex} → sampler
  G.use = (p, uni) => {
    const gl = G.gl;
    gl.useProgram(p.pr);
    for (const name in uni) {
      const loc = p.loc.get(name);
      if (loc === undefined || loc === null) continue;
      const v = uni[name];
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (typeof v === 'boolean') gl.uniform1f(loc, v ? 1 : 0);
      else if (v instanceof WebGLTexture || (v && v.tex instanceof WebGLTexture)) {
        const unit = p.samplers.get(name);
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v instanceof WebGLTexture ? v : v.tex); gl.uniform1i(loc, unit);
      } else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
      else if (v.length === 6) gl.uniformMatrix3fv(loc, false, [v[0], v[1], 0, v[2], v[3], 0, v[4], v[5], 1]);
    }
  };

  // ---- render targets, pooled by size and format
  G.acquire = (w, h, o = {}) => {
    const gl = G.gl;
    w = Math.max(1, Math.min(G.maxTex, Math.round(w))); h = Math.max(1, Math.min(G.maxTex, Math.round(h)));
    const float = !!o.float && G.floatOK, depth = !!o.depth, key = w + 'x' + h + (float ? 'f' : '') + (depth ? 'd' : '');
    let rt = null;
    for (let i = 0; i < pool.length; i++) if (!pool[i].busy && pool[i].key === key) { rt = pool[i]; break; }
    if (!rt) {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      let rb = null;
      if (depth) { rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
      rt = { tex, fb, rb, w, h, key, float, depth, busy: false, used: 0 };
      pool.push(rt);
    }
    rt.busy = true; rt.used = G.frameNo;
    if (o.clear !== false) { G.target(rt); gl.clearColor(0, 0, 0, 0); if (depth) { gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); } else gl.clear(gl.COLOR_BUFFER_BIT); }
    return rt;
  };
  G.release = (rt) => { if (rt) rt.busy = false; };
  G.frameNo = 0;
  // drop targets nothing has asked for in a while (a resized composition leaves a whole set behind)
  G.sweep = () => {
    const gl = G.gl; G.frameNo++;
    let bytes = 0; for (const rt of pool) bytes += rt.w * rt.h * (rt.float ? 8 : 4);
    if (bytes < 220e6 && pool.length < 40) return;
    pool = pool.filter((rt) => {
      if (rt.busy || G.frameNo - rt.used < 30) return true;
      gl.deleteTexture(rt.tex); gl.deleteFramebuffer(rt.fb); if (rt.rb) gl.deleteRenderbuffer(rt.rb);
      return false;
    });
  };
  G.poolInfo = () => ({ n: pool.length, busy: pool.filter((r) => r.busy).length });

  G.target = (rt) => {
    const gl = G.gl;
    if (rt) { gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb); gl.viewport(0, 0, rt.w, rt.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); }
  };
  G.blend = (mode) => {
    const gl = G.gl;
    if (mode === 'off') { gl.disable(gl.BLEND); return; }
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
    if (mode === 'over') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === 'union') gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
    else if (mode === 'subtract') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
    else if (mode === 'intersect') gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
  };
  G.quad = () => { const gl = G.gl; gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
  // one full-frame pass of a fragment shader into a target
  G.pass = (fs, rt, uni, blend = 'off') => { G.target(rt); G.blend(blend); G.use(G.prog(fs), uni); G.quad(); };
  G.mesh = (pos, uv, idx) => {
    const gl = G.gl;
    gl.bindVertexArray(meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshPos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshUv); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
  };

  // ---- textures from pictures, video frames and canvases
  G.texture = (o = {}) => {
    const gl = G.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  G.upload = (tex, source, mip = false) => {
    const gl = G.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  };
  G.drop = (tex) => { if (tex && G.gl) G.gl.deleteTexture(tex); };
  // straight-alpha RGBA bytes of a (non-float) target, top row first
  G.read = (rt) => {
    const gl = G.gl, px = new Uint8ClampedArray(rt.w * rt.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.readPixels(0, 0, rt.w, rt.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0; i < px.length; i += 4) { const a = px[i + 3]; if (a > 0 && a < 255) { const k = 255 / a; px[i] = px[i] * k; px[i + 1] = px[i + 1] * k; px[i + 2] = px[i + 2] * k; } }
    return px;
  };

  // ---- gaussian blur with one fixed 33-tap kernel; big radii are done on a shrunken copy
  const K = 16, SIG = K / 3;
  const W = []; { let s = 0; for (let i = 0; i <= K; i++) { W[i] = Math.exp(-0.5 * (i / SIG) ** 2); s += i ? 2 * W[i] : W[i]; } for (let i = 0; i <= K; i++) W[i] /= s; }
  const FS_BLUR = HEAD + `uniform sampler2D uTex; uniform vec2 uDir;
const float W[${K + 1}] = float[${K + 1}](${W.map((x) => x.toFixed(7)).join(', ')});
void main(){ vec4 s = texture(uTex, vUv) * W[0]; for (int i = 1; i <= ${K}; i++) { vec2 d = uDir * float(i); s += (texture(uTex, vUv + d) + texture(uTex, vUv - d)) * W[i]; } o = s; }`;
  // returns a new target holding src blurred by sigma (in src pixels) on each axis; src is left untouched
  G.blur = (src, sx, sy = sx) => {
    const big = Math.max(sx, sy);
    let d = 1; while (big / d > 8 && Math.min(src.w, src.h) / d > 8) d *= 2;
    let cur = src, own = false;
    for (let k = d; k > 1; k /= 2) {                                         // halve repeatedly (each step a 2×2 box)
      const nx = G.acquire(Math.max(1, cur.w / 2), Math.max(1, cur.h / 2), { float: src.float, clear: false });
      G.pass(G.SRC.copy, nx, { uTex: cur.tex });
      if (own) G.release(cur);
      cur = nx; own = true;
    }
    const step = (sig) => 3 * (sig / d) / K;
    if (sx > 0.05) { const nx = G.acquire(cur.w, cur.h, { float: src.float, clear: false }); G.pass(FS_BLUR, nx, { uTex: cur.tex, uDir: [step(sx) / cur.w, 0] }); if (own) G.release(cur); cur = nx; own = true; }
    if (sy > 0.05) { const nx = G.acquire(cur.w, cur.h, { float: src.float, clear: false }); G.pass(FS_BLUR, nx, { uTex: cur.tex, uDir: [0, step(sy) / cur.h] }); if (own) G.release(cur); cur = nx; own = true; }
    if (!own || cur.w !== src.w || cur.h !== src.h) {
      const nx = G.acquire(src.w, src.h, { float: src.float, clear: false });
      G.pass(G.SRC.copy, nx, { uTex: cur.tex });
      if (own) G.release(cur);
      cur = nx;
    }
    return cur;
  };
})();
