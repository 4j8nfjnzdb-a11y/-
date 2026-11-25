// Kishimi engine: a WebGL2 compositor for two or three photos/videos.
//
// One frame runs up to two "stages". Each stage reads three inputs:
//   P and Q, the two pictures that are seen, and
//   F, a field that decides where, in what order, or how hard the mix acts.
// An input can be a loaded source (A, B, C), the first stage's result, the
// previous output frame, or a procedural field (noise, vertical ramp, radial).
// Ten modes combine them; most never average P and Q. A pixel is taken from
// one or the other, or one picture moves or delays the other.
// After the stages, an optional feedback pass folds in the previous frame.

function KishimiEngine(cv) {
  const gl = cv.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  let HALF = !!gl.getExtension('EXT_color_buffer_float');

  const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*.5+.5; gl_Position = vec4(aPos,0.,1.); }`;

  const COMMON = `
float lum(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s/.9375; }
vec3 toYCC(vec3 c){ float y=dot(c,vec3(.299,.587,.114)); return vec3(y, (c.b-y)*.564+.5, (c.r-y)*.713+.5); }
vec3 fromYCC(vec3 v){ float y=v.x, cb=v.y-.5, cr=v.z-.5; return vec3(y+1.403*cr, y-.344*cb-.714*cr, y+1.773*cb); }
// Sample a texture through a fit transform. lod is a blur level in OUTPUT
// pixels; the source's own extra resolution is added so a 4000px photo is
// not aliased onto a 1080px frame.
vec3 sampT(sampler2D s, vec4 x, vec2 uv, float lod){
  vec2 u = uv*x.xy + x.zw;
  vec2 ts = vec2(textureSize(s,0));
  float L = max(0., log2(ts.y*x.y/uRes.y)) + lod;
  if (lod < .5) return textureLod(s,u,L).rgb;
  vec2 d = exp2(L)/ts*.7;
  return .25*(textureLod(s,u+vec2(d.x,d.y*.35),L).rgb + textureLod(s,u+vec2(-d.x*.35,d.y),L).rgb
            + textureLod(s,u-vec2(d.x,d.y*.35),L).rgb + textureLod(s,u-vec2(-d.x*.35,d.y),L).rgb);
}`;

  const FS_STAGE = `#version 300 es
precision highp float; precision highp sampler2DArray;
in vec2 vUv; out vec4 o;
uniform vec2 uRes;
uniform sampler2D uP, uQ, uF, uFlow;
uniform sampler2DArray uHist;
uniform vec4 uXP, uXQ, uXF;
uniform int uKP, uKQ, uKF, uMode;
uniform float uT, uA, uB, uC, uTime, uAsp, uHead, uHN, uRange, uSeed;
${COMMON}
vec3 P(vec2 uv, float l){ return uKP==1 ? vec3(0.) : sampT(uP,uXP,uv,l); }
vec3 Q(vec2 uv, float l){ return uKQ==1 ? vec3(0.) : sampT(uQ,uXQ,uv,l); }
vec3 Fc(vec2 uv, float l){
  if (uKF==0) return sampT(uF,uXF,uv,l);
  if (uKF==2) return vec3(clamp((fbm(vec2(uv.x*uAsp,uv.y)*3.+vec2(uTime*.031,-uTime*.023)+uSeed*7.)-.5)*2.2+.5,0.,1.));
  if (uKF==3) return vec3(uv.y);
  if (uKF==4) return vec3(clamp(length((uv-.5)*vec2(uAsp,1.))*1.35,0.,1.));
  return vec3(0.);
}
float F(vec2 uv, float l){ return lum(Fc(uv,l)); }
vec2 asp(vec2 v){ return v*vec2(1./uAsp,1.); }
float bayer4(vec2 p){
  int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return float(m[int(p.y)*4+int(p.x)]);
}
void main(){
  vec2 uv = vUv; float t = uT; vec3 col;
  if (uMode==0) {            // flow: carry P's shapes onto Q's along matched patches
    vec2 fl = (texture(uFlow,uv).rg-.5)*2.5*uRange; fl.x /= uAsp;
    vec3 a = P(uv-fl*t,0.), b = Q(uv+fl*(1.-t),0.);
    // with the noise field the switch is a fine stipple (a few px) that grows
    // into blobs as 混ざり方 rises, so the warp stays visible underneath
    float n;
    if (uKF==2) { float g = mix(1.5,70.,smoothstep(0.,.7,uC)); n = clamp((fbm(uv*uRes/g+uSeed*7.)-.5)*2.2+.5,0.,1.); }
    else n = F(uv,1.);
    float s = mix(.015,.35,uC), tt = t*(1.+2.*s)-s;
    float m = 1.-smoothstep(tt-s,tt+s,n);
    m = mix(m, t, smoothstep(.75,1.,uC));
    col = mix(a,b,m);
  } else if (uMode==1) {     // threshold: F's brightness is the order of replacement
    float f = F(uv,0.), bands = 1.+floor(uA*9.99);
    float g = abs(fract(f*bands*.5+.5)*2.-1.);
    float s = mix(.003,.2,uB*uB), tt = t*(1.+2.*s)-s;
    float m = 1.-smoothstep(tt-s,tt+s,g);
    vec3 p = P(uv,0.), q = Q(uv,0.);
    col = mix(p,q,m);
    float sw = .004+.06*uC;
    float seam = (1.-smoothstep(0.,sw,abs(g-tt)))*step(.001,uC)*step(.001,t)*step(t,.999);
    col = mix(col, clamp(abs(p-q)*1.8,0.,1.), seam);
  } else if (uMode==2) {     // displace: F pushes P; F itself is not shown
    float L = uC*5., f = F(uv,L);
    vec2 e = exp2(L+1.)/uRes;
    vec2 g = vec2(F(uv+vec2(e.x,0.),L)-F(uv-vec2(e.x,0.),L), F(uv+vec2(0.,e.y),L)-F(uv-vec2(0.,e.y),L));
    float gm = length(g);
    vec2 gv = gm>1e-5 ? g/gm*min(gm*12.,1.) : vec2(0.);
    float a = f*12.5664;
    vec2 v = mix(vec2(cos(a),sin(a)), gv, uB);
    col = P(uv+asp(v)*t*uA*.22, 0.);
  } else if (uMode==3) {     // frequency: P's broad colour under Q's fine detail
    float cut = t*(1.5+uB*6.5);
    vec3 lowP = P(uv,cut), hi = Q(uv,0.)-Q(uv,cut);
    hi = mix(hi, vec3(lum(hi)), uC);
    col = lowP + hi*(.6+uA*2.4);
  } else if (uMode==4) {     // cells: each Voronoi cell is P or Q, in F's order
    float cells = mix(3.,36.,uA*uA);
    vec2 p = vec2(uv.x*uAsp,uv.y)*cells, ip = floor(p), fp = fract(p);
    float d1 = 9., d2 = 9.; vec2 id = vec2(0.), cp = vec2(0.);
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) {
      vec2 g = vec2(i,j), h = hash22(ip+g+uSeed*17.);
      vec2 oo = .5+.4*sin(uTime*.25+6.2831*h), r = g+oo-fp;
      float d = dot(r,r);
      if (d<d1) { d2=d1; d1=d; id=ip+g; cp=ip+g+oo; } else if (d<d2) d2=d;
    }
    vec2 h = hash22(id+3.1);
    vec2 cuv = vec2(cp.x/cells/uAsp, cp.y/cells);
    float dec = uKF==2 ? h.x : mix(F(cuv,3.), h.x, .12);
    vec2 sl = asp(h-.5)*uB*.35;
    col = dec < t*1.02-.01 ? Q(uv+sl,0.) : P(uv+sl,0.);
    float edge = sqrt(d2)-sqrt(d1), bw = uC*.12;
    col *= mix(1., smoothstep(bw*.5,bw,edge), step(.001,uC));
  } else if (uMode==5) {     // bands: torn strips, alternately P and Q, slipped by F
    float ang = uC*3.14159;
    vec2 dir = vec2(cos(ang),sin(ang)), nr = vec2(-dir.y,dir.x);
    vec2 c = vec2((uv.x-.5)*uAsp, uv.y-.5);
    float count = mix(3.,90.,uA*uA), bi = floor(dot(c,nr)*count);
    float h1 = hash12(vec2(bi,5.3+uSeed)), h2 = hash12(vec2(bi,9.1+uSeed));
    vec2 cc = nr*(bi+.5)/count, cuv = vec2(cc.x/uAsp+.5, cc.y+.5);
    float dec = uKF==2 ? h1 : mix(F(cuv,3.), h1, .12);
    float s = (h2-.5)*uB*.5 + (F(uv,2.)-.5)*uB*.25;
    vec2 off = asp(dir*s);
    col = dec < t*1.02-.01 ? Q(uv+off,0.) : P(uv+off,0.);
  } else if (uMode==6) {     // screen: a halftone of Q laid into P; F fattens the dots
    float cell = mix(3.,40.,uA*uA);
    int shape = int(uB*2.+.5);
    vec2 px = uv*uRes; float s;
    if (shape==2) { s = (bayer4(mod(floor(px/max(1.,floor(cell/4.))),4.))+.5)/16.; }
    else {
      float a = .7854; vec2 r = mat2(cos(a),sin(a),-sin(a),cos(a))*px/cell;
      if (shape==0) { vec2 f = fract(r)-.5; s = dot(f,f)*2.; } else s = abs(fract(r.y)-.5)*2.;
    }
    float f = F(uv, log2(cell)*.8);
    float th = clamp(t+(f-.5)*uC*1.5,0.,1.)*1.02-.01;
    float aa = shape==2 ? 0. : fwidth(s)*.75;
    float m = 1.-smoothstep(th-aa,th+aa,s);
    col = mix(P(uv,0.), Q(uv,0.), m);
  } else if (uMode==7) {     // channels: colour components dealt out to P, Q and F
    float g = mix(1.,28.,uB);
    float j = (hash12(floor(uv*uRes/g)+uSeed)-.5)*uB*.9;
    float ph = t*3.+j; vec3 ov;
    for (int c=0;c<3;c++) {
      float a = float(c)*2.0944+.6;
      vec2 u = uv + asp(vec2(cos(a),sin(a)))*uA*.035;
      int k = int(mod(floor(ph)+float(c),3.));
      vec3 sc = k==0 ? P(u,0.) : (k==1 ? Q(u,0.) : Fc(u,0.));
      vec3 v = uC>.5 ? toYCC(sc) : sc;
      ov[c] = v[c];
    }
    col = uC>.5 ? fromYCC(ov) : ov;
  } else if (uMode==8) {     // time: P's recent past, delayed by F's brightness
    float f = F(uv,0.);
    if (uB>.01) { float st = floor(mix(24.,2.,uB)); f = min(floor(f*st)/(st-1.),1.); }
    float d = min(f*t*(uHN-1.)*mix(.15,1.,uA), uHN-1.001);
    float d0 = floor(d), fr = d-d0;
    float l0 = mod(uHead-d0+uHN*4.,uHN), l1 = mod(uHead-d0-1.+uHN*4.,uHN);
    col = mix(texture(uHist,vec3(uv,l0)).rgb, texture(uHist,vec3(uv,l1)).rgb, fr);
    float qm = uC>.001 ? smoothstep(1.-uC,1.-uC+.03,f*t) : 0.;
    col = mix(col, Q(uv,0.), qm);
  } else {                   // disagreement: keep only where P and Q differ
    float L = uA*5.;
    float d = length(P(uv,L)-Q(uv,L))*.75;
    float th = t*.88-.04;
    float keep = smoothstep(th-.03,th+.03,d);
    vec3 p0 = P(uv,0.), q0 = Q(uv,0.);
    float lp = lum(p0), lq = lum(q0);
    int rule = int(uB*2.+.5);
    vec3 w = rule==0 ? (lp>=lq ? p0 : q0) : (rule==1 ? p0 : (lp<lq ? p0 : q0));
    vec3 ag = vec3(lum(p0+q0)*.5)*uC*.6;
    col = mix(ag, w, keep);
  }
  o = vec4(col,1.);
}`;

  // Block matching: for each cell of a low-res grid, find where P's local
  // pattern (zero-mean 3x3 patch) sits in Q, coarse 9x9 search then 5x5 refine.
  const FS_FLOW = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec2 uRes;
uniform sampler2D uP, uQ; uniform vec4 uXP, uXQ; uniform int uKP, uKQ;
uniform float uRange, uReg, uAsp;
${COMMON}
float lP(vec2 uv){ return uKP==1 ? 0. : lum(sampT(uP,uXP,uv,0.)); }
float lQ(vec2 uv){ return uKQ==1 ? 0. : lum(sampT(uQ,uXQ,uv,0.)); }
float pv[9]; float pm;
float cost(vec2 off, vec2 cell){
  float q[9]; float qm = 0.;
  for (int j=0;j<3;j++) for (int i=0;i<3;i++) { float v = lQ(vUv+off+vec2(i-1,j-1)*cell); q[j*3+i]=v; qm+=v; }
  qm /= 9.;
  float c = 0.;
  for (int k=0;k<9;k++) { float d = (q[k]-qm)-pv[k]; c += d*d; }
  c += (qm-pm)*(qm-pm)*2.;
  vec2 on = vec2(off.x*uAsp,off.y)/uRange;
  return c + uReg*dot(on,on)*.04;
}
void main(){
  vec2 cell = 1.5/uRes;
  pm = 0.;
  for (int j=0;j<3;j++) for (int i=0;i<3;i++) { float v = lP(vUv+vec2(i-1,j-1)*cell); pv[j*3+i]=v; pm+=v; }
  pm /= 9.;
  for (int k=0;k<9;k++) pv[k] -= pm;
  vec2 st = vec2(uRange/uAsp,uRange)*.25;
  float best = 1e9; vec2 bo = vec2(0.);
  for (int y=-4;y<=4;y++) for (int x=-4;x<=4;x++) { vec2 off = vec2(x,y)*st; float c = cost(off,cell); if (c<best) { best=c; bo=off; } }
  vec2 b0 = bo, s2 = st*.4;
  for (int y=-2;y<=2;y++) for (int x=-2;x<=2;x++) { if (x==0 && y==0) continue; vec2 off = b0+vec2(x,y)*s2; float c = cost(off,cell); if (c<best) { best=c; bo=off; } }
  vec2 e = vec2(bo.x*uAsp,bo.y)/uRange;
  o = vec4(clamp(e*.4+.5,0.,1.),0.,1.);
}`;

  const FS_SMOOTH = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uRaw, uOld; uniform vec2 uRes; uniform float uSm, uTmp;
void main(){
  float sig = .5+uSm*1.8; vec2 acc = vec2(0.); float w = 0.;
  for (int j=-3;j<=3;j++) for (int i=-3;i<=3;i++) {
    float k = exp(-float(i*i+j*j)/(2.*sig*sig));
    acc += (texture(uRaw, vUv+vec2(i,j)/uRes).rg-.5)*k; w += k;
  }
  vec2 v = acc/w;
  if (uTmp>0.) v = mix(v, texture(uOld,vUv).rg-.5, uTmp);
  o = vec4(v+.5,0.,1.);
}`;

  const FS_COPY = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec2 uRes; uniform sampler2D uP; uniform vec4 uXP; uniform int uKP;
${COMMON}
void main(){ o = vec4(uKP==1 ? vec3(0.) : sampT(uP,uXP,vUv,0.), 1.); }`;

  const FS_POST = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uCur, uPrev; uniform float uAmt, uZoom, uRot, uAsp, uTime; uniform int uBlend;
uniform vec2 uRes;
${COMMON}
void main(){
  vec3 c = texture(uCur,vUv).rgb;
  if (uAmt<=.001) { o = vec4(c,1.); return; }
  vec2 p = (vUv-.5)*vec2(uAsp,1.);
  p = mat2(cos(uRot),sin(uRot),-sin(uRot),cos(uRot))*p/(1.+uZoom);
  p.x /= uAsp; p += .5;
  vec3 q = texture(uPrev,p).rgb, r;
  if (uBlend==0) r = mix(c,q,uAmt);
  else if (uBlend==1) r = max(c,q*uAmt);
  else if (uBlend==2) r = min(c,q*uAmt+(1.-uAmt));
  else r = abs(c-q*uAmt);
  r += (hash12(gl_FragCoord.xy+fract(uTime)*91.)-.5)/255.;
  o = vec4(clamp(r,0.,1.),1.);
}`;

  const FS_SHOW = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o; uniform sampler2D uTex;
void main(){ o = vec4(texture(uTex,vUv).rgb,1.); }`;

  // ---------- GL plumbing ----------
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i), nm = a.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }
  const PR = { stage: program(FS_STAGE), flow: program(FS_FLOW), smooth: program(FS_SMOOTH), copy: program(FS_COPY), post: program(FS_POST), show: program(FS_SHOW) };
  let cur = null;
  const use = (pr) => { gl.useProgram(pr.p); cur = pr; };
  const f1 = (n, v) => { const l = cur.u[n]; if (l) gl.uniform1f(l, v); };
  const i1 = (n, v) => { const l = cur.u[n]; if (l) gl.uniform1i(l, v); };
  const f2 = (n, a, b) => { const l = cur.u[n]; if (l) gl.uniform2f(l, a, b); };
  const f4 = (n, v) => { const l = cur.u[n]; if (l) gl.uniform4f(l, v[0], v[1], v[2], v[3]); };
  const bind = (unit, name, tex, target = gl.TEXTURE_2D) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, tex); i1(name, unit); };
  const draw = (fb, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  function target(w, h, { half = false, mip = false } = {}) {
    const mk = (useHalf) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      const levels = mip ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, useHalf ? gl.RGBA16F : gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.clearColor(0, 0, 0, 1); if (ok) gl.clear(gl.COLOR_BUFFER_BIT);
      return { t, fb, w, h, mip, ok };
    };
    let r = mk(half && HALF);
    if (!r.ok && half && HALF) { free(r); HALF = false; r = mk(false); }
    return r;
  }
  function free(r) { if (!r) return; gl.deleteTexture(r.t); gl.deleteFramebuffer(r.fb); }
  function mipmap(r) { if (!r.mip) return; gl.bindTexture(gl.TEXTURE_2D, r.t); gl.generateMipmap(gl.TEXTURE_2D); }

  const dummy = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, dummy);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  const dummyArr = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, dummyArr);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  // ---------- sources ----------
  const slots = [0, 1, 2].map(() => ({ el: null, kind: null, w: 1, h: 1, tex: null, ver: 0, fresh: false }));
  function setSource(i, el, kind, w, h) {
    const s = slots[i];
    if (!el) { if (s.tex) gl.deleteTexture(s.tex); Object.assign(s, { el: null, kind: null, tex: null, fresh: false, ready: false }); s.ver++; return; }
    if (!s.tex) {
      s.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    }
    Object.assign(s, { el, kind, w, h, fresh: true });
  }
  function upload(s) {
    gl.bindTexture(gl.TEXTURE_2D, s.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.el); gl.generateMipmap(gl.TEXTURE_2D); s.ver++; s.ready = true; }
    catch (e) { /* a video can refuse an upload before its first frame */ }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    s.fresh = false;
  }

  // ---------- frame buffers ----------
  let W = 0, H = 0, ST = [null, null], FIN = [null, null], cf = 0, frame = 0;
  const FLOW = [null, null], HIST = [null, null];
  const HN = 60;
  function resize(w, h) {
    if (w === W && h === H) return;
    W = w; H = h; cv.width = w; cv.height = h;
    for (const r of [...ST, ...FIN]) free(r);
    ST = [target(W, H, { half: true, mip: true }), target(W, H, { half: true, mip: true })];
    FIN = [target(W, H, { half: true, mip: true }), target(W, H, { half: true, mip: true })];
    for (let i = 0; i < 2; i++) { freeFlow(i); freeHist(i); }
  }
  function freeFlow(i) { const f = FLOW[i]; if (!f) return; free(f.raw); free(f.tmp); free(f.s[0]); free(f.s[1]); FLOW[i] = null; }
  function freeHist(i) { const h = HIST[i]; if (!h) return; gl.deleteTexture(h.t); gl.deleteFramebuffer(h.fb); HIST[i] = null; }

  const IDENT = [1, 1, 0, 0];
  function cover(sw, sh) {
    const ca = W / H, sa = sw / sh;
    let sx = 1, sy = 1;
    if (sa > ca) sx = ca / sa; else sy = sa / ca;
    return [sx, sy, (1 - sx) / 2, (1 - sy) / 2];
  }
  // input code -> what the shader needs
  function resolve(code) {
    const si = { a: 0, b: 1, c: 2 }[code];
    if (si !== undefined) {
      const s = slots[si];
      if (!s.tex || !s.ready) return { kind: 1, tex: dummy, xf: IDENT, ver: 'e', dyn: false };
      return { kind: 0, tex: s.tex, xf: cover(s.w, s.h), ver: si + ':' + s.ver, dyn: s.kind === 'video' };
    }
    if (code === 's1') return { kind: 0, tex: ST[0].t, xf: IDENT, ver: 'f' + frame, dyn: true };
    if (code === 'fb') return { kind: 0, tex: FIN[1 - cf].t, xf: IDENT, ver: 'f' + frame, dyn: true };
    const k = { noise: 2, vert: 3, rad: 4 }[code];
    return { kind: k ?? 1, tex: dummy, xf: IDENT, ver: code, dyn: code === 'noise' };
  }

  function doFlow(si, st, I) {
    const fl = 96, fw = W >= H ? fl : Math.max(8, Math.round(fl * W / H)), fh = W >= H ? Math.max(8, Math.round(fl * H / W)) : fl;
    let f = FLOW[si];
    if (!f || f.w !== fw || f.h !== fh) {
      freeFlow(si);
      const mk = () => target(fw, fh, { half: true });
      f = FLOW[si] = { w: fw, h: fh, raw: mk(), tmp: mk(), s: [mk(), mk()], idx: 0, key: '', inKey: '' };
      for (const r of f.s) { gl.bindFramebuffer(gl.FRAMEBUFFER, r.fb); gl.clearColor(.5, .5, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    }
    const range = .03 + st.p[0] * .32, reg = st.p[1] * 1.6;
    const inKey = st.P + '|' + st.Q, key = I.P.ver + '|' + I.Q.ver + '|' + range.toFixed(3) + '|' + reg.toFixed(3) + '|' + W + 'x' + H + '|' + inKey;
    f.range = range;
    if (key === f.key) return;
    const temporal = (f.inKey === inKey && (I.P.dyn || I.Q.dyn)) ? .55 : 0;
    f.key = key; f.inKey = inKey;
    use(PR.flow);
    f2('uRes', fw, fh); f1('uRange', range); f1('uReg', reg); f1('uAsp', W / H);
    bind(0, 'uP', I.P.tex); bind(1, 'uQ', I.Q.tex); f4('uXP', I.P.xf); f4('uXQ', I.Q.xf); i1('uKP', I.P.kind); i1('uKQ', I.Q.kind);
    draw(f.raw.fb, fw, fh);
    use(PR.smooth);
    f2('uRes', fw, fh); f1('uSm', st.p[1]);
    bind(0, 'uRaw', f.raw.t); bind(1, 'uOld', dummy); f1('uTmp', 0);
    draw(f.tmp.fb, fw, fh);
    bind(0, 'uRaw', f.tmp.t); bind(1, 'uOld', f.s[f.idx].t); f1('uTmp', temporal);
    draw(f.s[1 - f.idx].fb, fw, fh);
    f.idx = 1 - f.idx;
  }

  function doHist(si, st, I, time) {
    const L = 400, hw = W >= H ? L : Math.max(16, Math.round(L * W / H)), hh = W >= H ? Math.max(16, Math.round(L * H / W)) : L;
    let h = HIST[si];
    const fresh = !h || h.w !== hw || h.h !== hh || h.src !== st.P;
    if (fresh) {
      if (!h || h.w !== hw || h.h !== hh) {
        freeHist(si);
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, hw, hh, HN);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
        h = HIST[si] = { t, fb: gl.createFramebuffer(), w: hw, h: hh, head: 0, last: -1 };
      }
      h.src = st.P;
    }
    if (!fresh && time - h.last < 1 / 30 && time >= h.last) return;
    h.last = time;
    use(PR.copy);
    f2('uRes', hw, hh); bind(0, 'uP', I.P.tex); f4('uXP', I.P.xf); i1('uKP', I.P.kind);
    gl.bindFramebuffer(gl.FRAMEBUFFER, h.fb);
    const layers = fresh ? [...Array(HN).keys()] : [h.head = (h.head + 1) % HN];
    for (const l of layers) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, h.t, 0, l);
      gl.viewport(0, 0, hw, hh); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  const MODE_INDEX = { flow: 0, thresh: 1, disp: 2, freq: 3, cells: 4, bands: 5, screen: 6, chan: 7, time: 8, diff: 9 };

  function render(S, time) {
    frame++;
    for (const s of slots) if (s.el && s.fresh) upload(s);
    const any = slots.some((s) => s.ready && s.el);
    if (!any || !W) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W || 1, H || 1);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return;
    }
    let last = null;
    S.stages.forEach((st, si) => {
      if (si === 1 && !st.on) return;
      const I = { P: resolve(st.P), Q: resolve(st.Q), F: resolve(st.F) };
      const mode = MODE_INDEX[st.mode];
      if (st.mode === 'flow') doFlow(si, st, I);
      if (st.mode === 'time') doHist(si, st, I, time);
      use(PR.stage);
      f2('uRes', W, H); f1('uAsp', W / H); f1('uTime', time); i1('uMode', mode);
      f1('uT', st.tv); f1('uA', st.p[0]); f1('uB', st.p[1]); f1('uC', st.p[2]); f1('uSeed', st.seed || 0);
      bind(0, 'uP', I.P.tex); bind(1, 'uQ', I.Q.tex); bind(2, 'uF', I.F.kind === 0 ? I.F.tex : dummy);
      f4('uXP', I.P.xf); f4('uXQ', I.Q.xf); f4('uXF', I.F.xf); i1('uKP', I.P.kind); i1('uKQ', I.Q.kind); i1('uKF', I.F.kind);
      const f = FLOW[si];
      bind(3, 'uFlow', st.mode === 'flow' && f ? f.s[f.idx].t : dummy); f1('uRange', f ? f.range : .1);
      const h = HIST[si];
      bind(4, 'uHist', st.mode === 'time' && h ? h.t : dummyArr, gl.TEXTURE_2D_ARRAY); f1('uHead', h ? h.head : 0); f1('uHN', HN);
      draw(ST[si].fb, W, H);
      mipmap(ST[si]);
      last = ST[si];
    });
    const out = FIN[cf], prev = FIN[1 - cf], P = S.post;
    use(PR.post);
    f2('uRes', W, H); f1('uAsp', W / H); f1('uTime', time);
    f1('uAmt', P.amt * .985); i1('uBlend', P.blend);
    f1('uZoom', (P.zoom - .5) * 2 * .05); f1('uRot', (P.rot - .5) * 2 * .04);
    bind(0, 'uCur', last.t); bind(1, 'uPrev', prev.t);
    draw(out.fb, W, H);
    mipmap(out);
    use(PR.show);
    bind(0, 'uTex', out.t);
    draw(null, W, H);
    cf = 1 - cf;
  }

  function clearFeedback() { for (const r of FIN) { gl.bindFramebuffer(gl.FRAMEBUFFER, r.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); } }

  return {
    gl, slots, resize, setSource, render, clearFeedback,
    markFresh(i) { if (slots[i].el) slots[i].fresh = true; },
    get size() { return [W, H]; },
    get half() { return HALF; },
  };
}
