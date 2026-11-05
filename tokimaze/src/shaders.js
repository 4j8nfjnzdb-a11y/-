// ---------------------------------------------------------------------------
// GLSL. Coordinates: vUv in [0,1]^2; "domain" units are vUv * (aspect, 1), so
// one unit is the height of the dish and distances are isotropic.
// Velocities are stored in domain units per second.
// ---------------------------------------------------------------------------
const SH = (() => {
  const v3 = r => `vec3(${r.map(x => x.toFixed(6)).join(',')})`;
  const MAXB = 96, MAXI = 6;

  const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

  const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
`;

  const LIB = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=0.5; } return s; }
float segD2(vec2 p, vec2 a, vec2 b, out vec2 d){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-10),0.0,1.0); d=pa-ba*h; return dot(d,d); }
float inb(vec2 uv){ return step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0); }
`;

  // Six-band Kubelka–Munk -> linear RGB, and the shared look of the paint layer.
  const PAINT = `
uniform sampler2D uD0, uD1, uAux;
uniform vec3 uDish;
uniform float uOpac;
float KMr(float k){ k=max(k,0.0); return 1.0 + k - sqrt(k*k + 2.0*k); }
vec3 pigmentRGB(vec4 d0, vec4 d1){
  float W = max(d1.z, 1e-6);
  vec3 c = KMr(d0.x/W)*${v3(KM.B2RGB[0])} + KMr(d0.y/W)*${v3(KM.B2RGB[1])} + KMr(d0.z/W)*${v3(KM.B2RGB[2])}
         + KMr(d0.w/W)*${v3(KM.B2RGB[3])} + KMr(d1.x/W)*${v3(KM.B2RGB[4])} + KMr(d1.y/W)*${v3(KM.B2RGB[5])};
  return clamp(c, 0.0, 1.0);
}
const vec3 FERRO = vec3(0.004,0.004,0.006);
vec3 baseAt(vec2 uv, out float A, out vec4 ax){
  vec4 d0 = texture(uD0, uv), d1 = texture(uD1, uv);
  ax = texture(uAux, uv);
  A = max(d1.w, 0.0);
  float al = 1.0 - exp(-uOpac*A);
  vec3 c = d1.z > 1e-5 ? pigmentRGB(d0, d1) : uDish;
  c = mix(uDish, c, al);
  return mix(c, FERRO, smoothstep(0.22, 0.55, ax.z));
}
// A dark studio with two soft windows: flat liquid stays dark, slopes catch light.
float softRect(vec3 r, vec3 L, vec3 U, vec3 V, vec2 size){
  float d = dot(r, L); if (d <= 0.0) return 0.0;
  vec2 q = abs(vec2(dot(r,U), dot(r,V))/d);
  vec2 e = 1.0 - smoothstep(size*0.55, size, q);
  return e.x*e.y;
}
vec3 env(vec3 r){
  vec3 c = mix(vec3(0.010,0.011,0.014), vec3(0.05,0.052,0.06), smoothstep(0.95, 0.2, r.z));
  vec3 L1 = normalize(vec3(-0.50, 0.55, 0.67));
  vec3 U1 = normalize(cross(L1, vec3(0,0,1))); vec3 V1 = cross(U1, L1);
  c += 3.0*softRect(r, L1, U1, V1, vec2(0.42, 0.30))*vec3(1.0,0.97,0.93);
  vec3 L2 = normalize(vec3(0.62,-0.35,0.70));
  vec3 U2 = normalize(cross(L2, vec3(0,0,1))); vec3 V2 = cross(U2, L2);
  c += 1.1*softRect(r, L2, U2, V2, vec2(0.65, 0.07))*vec3(0.82,0.9,1.0);
  return c;
}
vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
`;

  const FS = {};

  // Splats are batched: up to 16 per pass, so a burst of input costs one pass.
  FS.splatVel = HEAD + LIB + `
out vec4 o;
uniform sampler2D uVel;
uniform int uN;
uniform vec4 uV0[16], uV1[16], uV2[16];
uniform float uAspect;
void main(){
  vec2 p = vUv*vec2(uAspect,1.0);
  vec2 v = texture(uVel, vUv).xy;
  for (int i=0;i<16;i++){
    if (i>=uN) break;
    vec4 s0 = uV0[i], s1 = uV1[i];
    vec2 d; float x = segD2(p, s0.xy, s0.zw, d)/s1.x;
    if (x > 12.0) continue;
    float g = exp(-x);
    vec2 n = d/sqrt(s1.x);
    v += g*(uV2[i].xy + s1.y*n + s1.z*vec2(-n.y, n.x));
  }
  o = vec4(v, 0.0, 1.0);
}`;

  FS.splatPaint = HEAD + LIB + `
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
uniform sampler2D uD0, uD1, uAux;
uniform int uN;
uniform vec4 uS0[16], uS1[16], uC0[16], uC1[16], uAdd[16];
uniform float uAspect;
void main(){
  vec2 p = vUv*vec2(uAspect,1.0);
  vec4 d0 = texture(uD0, vUv), d1 = texture(uD1, vUv), ax = texture(uAux, vUv);
  for (int i=0;i<16;i++){
    if (i>=uN) break;
    vec4 s0 = uS0[i], s1 = uS1[i];
    vec2 d; float x = segD2(p, s0.xy, s0.zw, d)/s1.x;
    if (x > 12.0) continue;
    float g = mix(exp(-x), 1.0 - smoothstep(0.5, 1.0, sqrt(x)), s1.z);
    float k = s1.y*g;
    vec4 add = uAdd[i]*g;
    add.w *= smoothstep(0.62, 0.95, hash12(floor(p*700.0) + s1.w))*4.0;
    d0 += uC0[i]*k; d1 += uC1[i]*k; ax += add;
  }
  o0 = d0; o1 = d1; o2 = max(ax, 0.0);
}`;

  FS.fill = HEAD + LIB + `
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
uniform float uAspect, uAmt, uVar, uSeed;
uniform vec4 uC0, uC1;
void main(){
  vec2 p = vUv*vec2(uAspect,1.0);
  float a = uAmt*(1.0 + uVar*(fbm(p*9.0 + uSeed) - 0.5));
  o0 = uC0*a; o1 = uC1*a; o2 = vec4(0.0);
}`;

  FS.copyPaint = HEAD + `
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
uniform sampler2D uD0, uD1, uAux;
void main(){ o0 = texture(uD0, vUv); o1 = texture(uD1, vUv); o2 = texture(uAux, vUv); }`;

  FS.copy = HEAD + `
out vec4 o; uniform sampler2D uT;
void main(){ o = texture(uT, vUv); }`;

  // Mobility K (inverse viscosity) and volume source q for the film flow.
  FS.kq = HEAD + LIB + `
out vec4 o;
uniform sampler2D uD1, uAux, uSurf;
uniform vec4 uBub[${MAXB}]; uniform int uNB;
uniform vec4 uIce[${MAXI}]; uniform int uNI;
uniform float uKp, uKw, uKa, uShear, uNoise, uQs, uQm, uAspect, uKf, uH;
uniform vec4 uMag;
void main(){
  float A = max(texture(uD1, vUv).w, 0.0);
  vec4 ax = texture(uAux, vUv);
  float s = ax.x;
  float K = mix(uKw, uKp, A/(A + 0.25));
  float fs = s/(s + A + 0.06);
  K = mix(K, uKa, fs);
  K *= 1.0 + uShear*length(texture(uSurf, vUv).xy);
  vec2 p = vUv*vec2(uAspect,1.0);
  // uneven ground only matters where alcohol is spreading: it seeds the branches
  K *= max(0.15, 1.0 + uNoise*smoothstep(0.05, 0.4, fs)*(vnoise(p*55.0) + 0.6*vnoise(p*140.0) - 0.8));
  float q = uQs*ax.y + uQm*s;
  float Ac = min(A + ax.z, 1.5);
  for (int i=0;i<${MAXB};i++){ if(i>=uNB) break; vec4 b=uBub[i]; vec2 dd=p-b.xy; float r2=dot(dd,dd)/(b.z*b.z); if(r2<1.0) q += b.w*(1.0-r2)*Ac; }
  for (int i=0;i<${MAXI};i++){ if(i>=uNI) break; vec4 c=uIce[i]; vec2 dd=p-c.xy; float r2=dot(dd,dd)/(c.z*c.z); if(r2<1.0) q += c.w*(1.0-r2)*(0.25+Ac); }
  // magnetic pull on the ferrofluid, as a body force inside the film flow (Hele-Shaw ferrofluid)
  vec2 F = vec2(0.0);
  if (uMag.z > 0.0){ vec2 dm = p - uMag.xy; float B = uMag.z*exp(-dot(dm,dm)/uMag.w); F = uKf*min(ax.z, 1.5)*(-2.0*dm/uMag.w)*B*uH; }
  o = vec4(max(K, 0.02), q, F);
}`;

  // Darcy (Hele-Shaw) pressure: div(K grad p) = -q, p = 0 beyond the edge.
  FS.darcy = HEAD + LIB + `
out vec4 o;
uniform sampler2D uP, uKQ;
uniform vec2 uTexel;
void main(){
  vec4 c = texture(uKQ, vUv); float Ki = c.x;
  vec2 l=vUv-vec2(uTexel.x,0.0), r=vUv+vec2(uTexel.x,0.0), t=vUv+vec2(0.0,uTexel.y), b=vUv-vec2(0.0,uTexel.y);
  vec4 L = texture(uKQ,l), R = texture(uKQ,r), T = texture(uKQ,t), Bq = texture(uKQ,b);
  float kl=0.5*(Ki+L.x), kr=0.5*(Ki+R.x), kt=0.5*(Ki+T.x), kb=0.5*(Ki+Bq.x);
  float fdiv = kr*0.5*(c.z+R.z) - kl*0.5*(c.z+L.z) + kt*0.5*(c.w+T.w) - kb*0.5*(c.w+Bq.w);
  float p = (kl*texture(uP,l).x*inb(l) + kr*texture(uP,r).x*inb(r) + kt*texture(uP,t).x*inb(t) + kb*texture(uP,b).x*inb(b) + c.y - fdiv)/(kl+kr+kt+kb);
  o = vec4(p, 0.0, 0.0, 1.0);
}`;

  // Film (surface) velocity: Darcy push + Marangoni pull away from solvent + spin-off.
  FS.surf = HEAD + LIB + `
out vec4 o;
uniform sampler2D uP, uKQ, uAux, uD1;
uniform vec2 uTexel;
uniform float uH, uSpin2, uAspect;
void main(){
  vec4 c = texture(uKQ, vUv); float K = c.x;
  vec2 l=vUv-vec2(uTexel.x,0.0), r=vUv+vec2(uTexel.x,0.0), t=vUv+vec2(0.0,uTexel.y), b=vUv-vec2(0.0,uTexel.y);
  float pc=texture(uP,vUv).x, pl=texture(uP,l).x*inb(l), pr=texture(uP,r).x*inb(r), pt=texture(uP,t).x*inb(t), pb=texture(uP,b).x*inb(b);
  vec4 L = texture(uKQ,l), R = texture(uKQ,r), T = texture(uKQ,t), Bq = texture(uKQ,b);
  float kl=0.5*(K+L.x), kr=0.5*(K+R.x), kt=0.5*(K+T.x), kb=0.5*(K+Bq.x);
  // face fluxes, the same discretisation the solver used, so velocity and squeeze agree
  float Fr = kr*(-(pr-pc) + 0.5*(c.z+R.z)), Fl = kl*(-(pc-pl) + 0.5*(c.z+L.z));
  float Ft = kt*(-(pt-pc) + 0.5*(c.w+T.w)), Fb = kb*(-(pc-pb) + 0.5*(c.w+Bq.w));
  vec2 u = 0.5*vec2(Fr+Fl, Ft+Fb)*uH;
  float divD = (Fr-Fl) + (Ft-Fb);
  // Explicit film terms, with their divergence counted so paint is conserved:
  // the slide down a tilted dish and the turntable's spin-off, both ~ thickness.
  float A = max(texture(uD1, vUv).w, 0.0);
  float Al = min(max(texture(uD1,l).w,0.0),1.5), Ar = min(max(texture(uD1,r).w,0.0),1.5), At = min(max(texture(uD1,t).w,0.0),1.5), Ab = min(max(texture(uD1,b).w,0.0),1.5);
  float Ah = min(A, 1.5);
  vec2 gA = vec2(Ar-Al, At-Ab)/(2.0*uH);
  vec2 rr = (vUv-0.5)*vec2(uAspect,1.0);
  u += uSpin2*rr*Ah;
  divD += uSpin2*(2.0*Ah + dot(rr, gA));
  float m = length(u); if (m > 0.9) u *= 0.9/m;
  o = vec4(u, divD, 1.0);
}`;

  FS.forces = HEAD + `
out vec4 o;
uniform sampler2D uVel, uSurf, uAux, uD1;
uniform vec2 uTexel;
uniform float uDt, uAspect, uKelvin, uSpin, uSpinDrag, uCouple, uDamp;
uniform vec4 uMag;
uniform vec2 uGrav;
void main(){
  vec2 v = texture(uVel, vUv).xy;
  vec2 p = vUv*vec2(uAspect,1.0);
  vec4 ax = texture(uAux, vUv);
  // Kelvin force on the ferrofluid, f*grad(B). Only its curl moves an incompressible liquid,
  // and the split 1/2(f*grad(B) - B*grad(f)) has that same curl with far less divergence for
  // the projection to cancel, so the ferrofluid is neither crushed to a point nor blown up.
  if (uMag.z > 0.0){
    vec2 dm=p-uMag.xy; float B=uMag.z*exp(-dot(dm,dm)/uMag.w);
    vec2 tx = vec2(uTexel.x, 0.0), ty = vec2(0.0, uTexel.y);
    float fc = min(ax.z, 1.5);
    vec2 gf = vec2(min(texture(uAux,vUv+tx).z,1.5) - min(texture(uAux,vUv-tx).z,1.5), min(texture(uAux,vUv+ty).z,1.5) - min(texture(uAux,vUv-ty).z,1.5))/(2.0*uTexel.y);
    v += uDt*uKelvin*0.5*(fc*(-2.0*dm/uMag.w)*B - B*gf);
  }
  float A = max(texture(uD1, vUv).w, 0.0);
  v += uDt*uGrav*(min(A, 3.0) + 2.5*min(ax.z,1.5));
  if (uSpin != 0.0){ vec2 r=p-vec2(0.5*uAspect,0.5); v += (uSpin*vec2(-r.y,r.x) - v)*(1.0-exp(-uDt*uSpinDrag)); }
  v += uCouple*uDt*texture(uSurf, vUv).xy;
  v *= exp(-uDt*uDamp);
  o = vec4(v, 0.0, 1.0);
}`;

  FS.curl = HEAD + `
out vec4 o; uniform sampler2D uVel; uniform vec2 uTexel;
void main(){
  float L=texture(uVel,vUv-vec2(uTexel.x,0.0)).y, R=texture(uVel,vUv+vec2(uTexel.x,0.0)).y;
  float T=texture(uVel,vUv+vec2(0.0,uTexel.y)).x, B=texture(uVel,vUv-vec2(0.0,uTexel.y)).x;
  o = vec4(0.5*(R-L-T+B), 0.0, 0.0, 1.0);
}`;

  FS.vorticity = HEAD + `
out vec4 o; uniform sampler2D uVel, uCurl; uniform vec2 uTexel; uniform float uCurlK, uDt;
void main(){
  float L=texture(uCurl,vUv-vec2(uTexel.x,0.0)).x, R=texture(uCurl,vUv+vec2(uTexel.x,0.0)).x;
  float T=texture(uCurl,vUv+vec2(0.0,uTexel.y)).x, B=texture(uCurl,vUv-vec2(0.0,uTexel.y)).x, C=texture(uCurl,vUv).x;
  vec2 f = 0.5*vec2(abs(T)-abs(B), abs(R)-abs(L));
  f /= length(f) + 1e-5;
  f *= uCurlK*C; f.y = -f.y;
  vec2 v = clamp(texture(uVel,vUv).xy + f*uDt, -4.0, 4.0);
  o = vec4(v, 0.0, 1.0);
}`;

  FS.divergence = HEAD + `
out vec4 o; uniform sampler2D uVel; uniform vec2 uTexel;
void main(){
  vec2 C = texture(uVel,vUv).xy;
  float L=texture(uVel,vUv-vec2(uTexel.x,0.0)).x, R=texture(uVel,vUv+vec2(uTexel.x,0.0)).x;
  float T=texture(uVel,vUv+vec2(0.0,uTexel.y)).y, B=texture(uVel,vUv-vec2(0.0,uTexel.y)).y;
  if (vUv.x-uTexel.x < 0.0) L = -C.x;
  if (vUv.x+uTexel.x > 1.0) R = -C.x;
  if (vUv.y+uTexel.y > 1.0) T = -C.y;
  if (vUv.y-uTexel.y < 0.0) B = -C.y;
  o = vec4(0.5*(R-L+T-B), 0.0, 0.0, 1.0);
}`;

  FS.pressure = HEAD + `
out vec4 o; uniform sampler2D uP, uDiv; uniform vec2 uTexel;
void main(){
  float L=texture(uP,vUv-vec2(uTexel.x,0.0)).x, R=texture(uP,vUv+vec2(uTexel.x,0.0)).x;
  float T=texture(uP,vUv+vec2(0.0,uTexel.y)).x, B=texture(uP,vUv-vec2(0.0,uTexel.y)).x;
  o = vec4((L+R+T+B - texture(uDiv,vUv).x)*0.25, 0.0, 0.0, 1.0);
}`;

  FS.gradSub = HEAD + `
out vec4 o; uniform sampler2D uP, uVel; uniform vec2 uTexel;
void main(){
  float L=texture(uP,vUv-vec2(uTexel.x,0.0)).x, R=texture(uP,vUv+vec2(uTexel.x,0.0)).x;
  float T=texture(uP,vUv+vec2(0.0,uTexel.y)).x, B=texture(uP,vUv-vec2(0.0,uTexel.y)).x;
  o = vec4(texture(uVel,vUv).xy - 0.5*vec2(R-L, T-B), 0.0, 1.0);
}`;

  FS.scale = HEAD + `
out vec4 o; uniform sampler2D uT; uniform float uK;
void main(){ o = texture(uT, vUv)*uK; }`;

  FS.advectVel = HEAD + `
out vec4 o; uniform sampler2D uVel, uSurf; uniform float uDt, uAspect;
void main(){
  vec2 asp = vec2(uAspect,1.0);
  vec2 u = texture(uVel,vUv).xy + 0.5*texture(uSurf,vUv).xy;
  vec2 back = vUv - uDt*u/asp;
  o = vec4(texture(uVel, back).xy, 0.0, 1.0);
}`;

  // Paint transport: RK2 backtrace, Catmull-Rom sampling clamped to the 2x2
  // neighbourhood (keeps filaments sharp without ringing), compression where the
  // film flow converges or spreads, and the ferrofluid's own drift to the magnet.
  FS.advectPaint = HEAD + `
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
uniform sampler2D uVel, uSurf, uD0, uD1, uAux;
uniform vec2 uDyeSize, uSimTexel;
uniform float uDt, uAspect, uH, uEvap, uPushDecay, uFerroMob, uSharp, uSpread, uCrisp;
uniform vec4 uMag;
// Catmull-Rom (5 taps) plus the bilinear value and 2x2 range at the same spot.
vec4 cr(sampler2D t, vec2 uv, out vec4 lin, out vec4 mn, out vec4 mx){
  vec2 sp = uv*uDyeSize; vec2 tc = floor(sp - 0.5) + 0.5; vec2 f = sp - tc;
  vec2 w0 = f*(-0.5 + f*(1.0 - 0.5*f)), w1 = 1.0 + f*f*(-2.5 + 1.5*f), w2 = f*(0.5 + f*(2.0 - 1.5*f)), w3 = f*f*(-0.5 + 0.5*f);
  vec2 w12 = w1 + w2; vec2 t0 = (tc - 1.0)/uDyeSize, t3 = (tc + 2.0)/uDyeSize, t12 = (tc + w2/w12)/uDyeSize;
  vec4 r = texture(t, vec2(t12.x, t0.y))*(w12.x*w0.y) + texture(t, vec2(t0.x, t12.y))*(w0.x*w12.y)
         + texture(t, t12)*(w12.x*w12.y) + texture(t, vec2(t3.x, t12.y))*(w3.x*w12.y) + texture(t, vec2(t12.x, t3.y))*(w12.x*w3.y);
  r /= (w12.x*w0.y + w0.x*w12.y + w12.x*w12.y + w3.x*w12.y + w12.x*w3.y);
  ivec2 sz = ivec2(uDyeSize) - 1; ivec2 i0 = clamp(ivec2(tc - 0.5), ivec2(0), sz), i1 = clamp(i0 + 1, ivec2(0), sz);
  vec4 a = texelFetch(t, i0, 0), b = texelFetch(t, ivec2(i1.x, i0.y), 0), c = texelFetch(t, ivec2(i0.x, i1.y), 0), d = texelFetch(t, i1, 0);
  vec2 fc = clamp(f, 0.0, 1.0);
  lin = mix(mix(a, b, fc.x), mix(c, d, fc.x), fc.y);
  mn = min(min(a,b),min(c,d)); mx = max(max(a,b),max(c,d));
  return r;
}
vec4 sharp(sampler2D t, vec2 uv){ vec4 l, mn, mx; vec4 r = cr(t, uv, l, mn, mx); return mix(l, clamp(r, mn, mx), uCrisp); }
vec2 vel(vec2 uv){ return texture(uVel, uv).xy + texture(uSurf, uv).xy; }
// ferrofluid drift up the magnet's field gradient, capped, and stopping where it is already piled up
vec2 ferroDrift(vec2 uv){
  vec2 dm = uv*vec2(uAspect,1.0) - uMag.xy; float B = uMag.z*exp(-dot(dm,dm)/uMag.w);
  vec2 uf = uFerroMob*(-2.0*dm/uMag.w)*B;
  float sp = length(uf); if (sp > 0.3) uf *= 0.3/sp;
  return uf*(1.0 - smoothstep(1.3, 2.6, texture(uAux, uv).z));
}
void main(){
  vec2 asp = vec2(uAspect,1.0);
  vec2 mid = vUv - 0.5*uDt*vel(vUv)/asp;
  vec2 u = vel(mid);
  vec2 back = vUv - uDt*u/asp;
  // squeeze = the film's divergence plus whatever the bulk projection left over
  vec2 l=vUv-vec2(uSimTexel.x,0.0), r=vUv+vec2(uSimTexel.x,0.0), t=vUv+vec2(0.0,uSimTexel.y), b=vUv-vec2(0.0,uSimTexel.y);
  float dvb = (texture(uVel,r).x - texture(uVel,l).x + texture(uVel,t).y - texture(uVel,b).y)/(2.0*uH);
  float dv = texture(uSurf, back).z + dvb;
  float comp = exp(-uDt*clamp(dv, -6.0, 6.0));
  // pigment: one choice of weights for both textures, so the ratio sum(w*KS)/sum(w) stays a true mix
  vec4 l1, n1, x1, l0, n0, x0;
  vec4 c1 = cr(uD1, back, l1, n1, x1), c0 = cr(uD0, back, l0, n0, x0);
  bool ok = all(greaterThanEqual(c1.zw, n1.zw*0.98 - 1e-4)) && all(lessThanEqual(c1.zw, x1.zw*1.02 + 1e-4));
  float kc = ok ? uCrisp : 0.0;
  vec4 d0 = mix(l0, c0, kc), d1 = mix(l1, c1, kc);
  vec4 ax = sharp(uAux, back);
  // ferrofluid: immiscible, pulled up the field gradient
  vec2 p = vUv*asp;
  float fe = ax.z, fcomp = comp;
  vec2 bf = back;
  if (uMag.z > 0.0 && uFerroMob > 0.0){
    vec2 uf = ferroDrift(vUv);
    bf = vUv - uDt*(u + uf)/asp;
    fe = sharp(uAux, bf).z;
    // the pull's own squeeze, measured on the same field (it stops where the mound is full)
    vec2 ex = vec2(2.0/uDyeSize.x, 0.0), ey = vec2(0.0, 2.0/uDyeSize.y);
    float divf = (ferroDrift(vUv+ex).x - ferroDrift(vUv-ex).x)/(2.0*ex.x*uAspect) + (ferroDrift(vUv+ey).y - ferroDrift(vUv-ey).y)/(2.0*ey.y);
    fcomp *= exp(-uDt*clamp(divf, -8.0, 8.0));
  }
  fe *= fcomp;
  // excess ferrofluid relaxes outward, thin traces bead up
  vec2 e = 1.5/uDyeSize;
  float eL = max(texture(uAux, bf-vec2(e.x,0.0)).z-1.0,0.0), eR = max(texture(uAux, bf+vec2(e.x,0.0)).z-1.0,0.0);
  float eT = max(texture(uAux, bf+vec2(0.0,e.y)).z-1.0,0.0), eB = max(texture(uAux, bf-vec2(0.0,e.y)).z-1.0,0.0);
  fe += uDt*uSpread*(eL+eR+eT+eB - 4.0*max(fe-1.0,0.0));
  fe += uDt*uSharp*fe*(1.0-min(fe,1.0))*(fe-0.3);
  fe = clamp(fe, 0.0, 12.0);
  o0 = max(d0*comp, 0.0);
  o1 = max(d1*comp, 0.0);
  o2 = vec4(max(ax.x*comp*exp(-uDt*uEvap), 0.0), max(ax.y*exp(-uDt*uPushDecay), 0.0), fe, max(ax.w*comp, 0.0));
}`;

  FS.display = HEAD + LIB + PAINT + `
out vec4 o;
uniform vec2 uDyeTexel;
uniform float uAspect, uTime, uGloss, uRelief, uRefr;
uniform vec4 uMag;
uniform vec4 uIce[${MAXI}]; uniform vec4 uIceB[${MAXI}]; uniform int uNI;
float spikes(vec2 p){
  float k = 6.2831853/0.016;
  float s = cos(k*p.x) + cos(k*(0.5*p.x + 0.8660254*p.y)) + cos(k*(-0.5*p.x + 0.8660254*p.y));
  return pow(clamp((s + 1.5)/4.5, 0.0, 1.0), 5.0);
}
float hAt(vec2 uv){
  float A = max(texture(uD1, uv).w, 0.0);
  vec4 ax = texture(uAux, uv);
  float fm = smoothstep(0.15, 0.7, ax.z);
  float h = uRelief*(min(A, 3.0) + 1.4*fm + 0.6*min(ax.z, 2.5));
  if (uMag.z > 0.01){
    vec2 p = uv*vec2(uAspect,1.0); vec2 dm = p - uMag.xy;
    float B = uMag.z*exp(-dot(dm,dm)/(uMag.w*1.6));
    h += uRelief*9.0*fm*B*spikes(p)*min(ax.z, 2.0);
  }
  return h;
}
float sdBox(vec2 p, float b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
void main(){
  vec2 asp = vec2(uAspect,1.0);
  vec2 p = vUv*asp;
  // ---- ice cubes (top view): refraction through a bevelled block
  float im = 0.0, ith = 0.0, ihm = 1e-4, iseed = 0.0, icloud = 0.0; vec3 inor = vec3(0,0,1); vec2 il = vec2(0.0);
  for (int i=0;i<${MAXI};i++){
    if (i>=uNI) break;
    vec4 a = uIce[i], b = uIceB[i];
    vec2 d = p - a.xy; float c = cos(a.w), s = sin(a.w);
    vec2 l = vec2(c*d.x + s*d.y, -s*d.x + c*d.y);
    float wob = 0.12*a.z*(vnoise(l*30.0/max(a.z,0.01) + b.z) - 0.5);
    float dist = sdBox(l, a.z, b.x) + wob;
    if (dist < 0.003){
      float bev = max(a.z*0.42, 0.004);
      float t = clamp(-dist/bev, 0.0, 1.0);
      float hh = b.y*(t*t*(3.0-2.0*t));
      float e = 0.0012;
      vec2 g = vec2(sdBox(l+vec2(e,0.0),a.z,b.x) - sdBox(l-vec2(e,0.0),a.z,b.x), sdBox(l+vec2(0.0,e),a.z,b.x) - sdBox(l-vec2(0.0,e),a.z,b.x))/(2.0*e);
      g = vec2(c*g.x - s*g.y, s*g.x + c*g.y);
      float dh = b.y*6.0*t*(1.0-t)/bev;
      vec2 nn = g*dh;
      // melting surface: shallow ripples on the top face
      vec2 rp = l*24.0/max(a.z,0.01) + b.z;
      nn += 0.25*vec2(vnoise(rp+vec2(0.6,0.0)) - vnoise(rp-vec2(0.6,0.0)), vnoise(rp+vec2(0.0,0.6)) - vnoise(rp-vec2(0.0,0.6)));
      float m = (1.0 - smoothstep(-0.0012, 0.0012, dist))*b.w;
      if (m > im){ im = m; ith = hh; ihm = max(b.y, 1e-4); iseed = b.z; inor = normalize(vec3(nn, 1.0)); il = l/max(a.z,0.001); icloud = 1.0 - smoothstep(0.0, 0.9, length(l)/max(a.z,0.001)); }
    }
  }
  vec2 uv = vUv;
  if (im > 0.0) uv -= inor.xy*(0.02 + ith*1.6)/asp;
  // ---- the paint film: relief, refraction, gloss
  vec2 e = uDyeTexel*2.5;
  float hl = hAt(uv-vec2(e.x,0.0)), hr = hAt(uv+vec2(e.x,0.0)), ht = hAt(uv+vec2(0.0,e.y)), hb = hAt(uv-vec2(0.0,e.y));
  vec2 g = vec2(hr-hl, ht-hb)/(2.0*e*asp);
  vec3 n = normalize(vec3(-g, 1.0));
  vec2 uv2 = uv - n.xy*uRefr/asp;
  float A; vec4 ax;
  vec3 col = baseAt(uv2, A, ax);
  col *= 0.84 + 0.16*clamp(dot(n, normalize(vec3(-0.4,0.5,0.75)))/0.75, 0.0, 1.5);
  float fm = smoothstep(0.22, 0.55, ax.z);
  float F0 = mix(0.05, 0.3, fm);
  float F = F0 + (1.0-F0)*pow(1.0 - n.z, 5.0);
  vec3 R = reflect(vec3(0.0,0.0,-1.0), n);
  vec3 ev = env(R);
  // ferrofluid: a black mirror, only the windows show in it
  vec3 spec = mix(ev, max(ev - 0.08, 0.0)*1.3, fm)*F*uGloss;
  // mica / glitter: flakes ride the flow, each glints at its own moment
  float mi = ax.w;
  if (mi > 0.02){
    float ph = hash12(floor(uv2*vec2(1.0/uDyeTexel.x, 1.0/uDyeTexel.y)*0.5));
    float tw = pow(0.5 + 0.5*sin(mi*70.0 + uTime*3.0 + ph*40.0), 10.0);
    float fl = smoothstep(0.35, 1.4, mi);
    vec3 tint = mix(vec3(1.0,0.78,0.42), 0.6 + 0.4*cos(6.2831*(ph + vec3(0.0,0.33,0.67))), 0.35);
    col = mix(col, col*0.85 + tint*0.18, smoothstep(0.1, 1.2, mi)*0.35);
    spec += tint*fl*tw*3.2*step(0.55, ph);
  }
  col += spec;
  // ---- ice on top
  if (im > 0.0){
    vec3 ice = col*vec3(0.88,0.95,1.02);
    float cl = icloud*(0.35 + 0.65*fbm(il*3.0 + iseed));
    ice = mix(ice, vec3(0.78,0.86,0.92), 0.16*cl);
    float edge = 1.0 - smoothstep(0.0, 0.45, ith/ihm);
    ice += vec3(0.55,0.62,0.7)*edge*edge*0.35;
    float cracks = smoothstep(0.03, 0.0, abs(fbm(il*2.2 + iseed*1.7) - 0.5))*icloud;
    ice += vec3(0.35,0.4,0.45)*cracks*0.5;
    float Fi = 0.04 + 0.96*pow(1.0 - inor.z, 5.0);
    ice += env(reflect(vec3(0.0,0.0,-1.0), inor))*Fi*uGloss*2.6;
    col = mix(col, ice, im);
  }
  o = vec4(toSRGB(col), 1.0);
}`;

  const BUB_VS = `#version 300 es
in vec2 aPos; in vec4 aB; in vec4 aC;
uniform float uAspect;
out vec2 vQ; out vec4 vB; out vec4 vC;
void main(){
  float k = (1.12 + 0.7*aC.z);
  vQ = aPos*k; vB = aB; vC = aC;
  vec2 w = aB.xy + aPos*aB.z*k;
  vec2 uv = w/vec2(uAspect,1.0);
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
}`;

  FS.bubble = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vQ; in vec4 vB; in vec4 vC;
` + LIB + PAINT + `
out vec4 o;
uniform float uAspect, uTime, uGloss;
float fringe(float opd, float lam, float bw){
  float ph = 6.2831853*opd/lam, dph = 3.14159265*opd*bw/(lam*lam);
  float sx = dph > 1e-3 ? sin(dph)/dph : 1.0;
  return 0.5 - 0.5*cos(ph)*sx;
}
vec3 thinFilm(float d, float cosi){
  float cost = sqrt(1.0 - (1.0 - cosi*cosi)/(1.33*1.33));
  float opd = 2.0*1.33*d*cost;
  vec3 c = fringe(opd,405.0,55.0)*${v3(KM.B2RGB[0])} + fringe(opd,465.0,65.0)*${v3(KM.B2RGB[1])} + fringe(opd,535.0,60.0)*${v3(KM.B2RGB[2])}
         + fringe(opd,595.0,60.0)*${v3(KM.B2RGB[3])} + fringe(opd,660.0,65.0)*${v3(KM.B2RGB[4])} + fringe(opd,720.0,55.0)*${v3(KM.B2RGB[5])};
  return max(c, 0.0);
}
void main(){
  float pop = vC.z, al = vC.w;
  float rr = dot(vQ, vQ), r = sqrt(rr);
  if (pop > 0.0){
    float ring = smoothstep(0.1, 0.0, abs(r - (1.0 + 0.7*pop)))*(1.0 - pop);
    float dots = step(0.82, hash12(floor(vQ*9.0) + vC.x*31.0))*smoothstep(1.0+0.7*pop, 0.6*pop, r)*(1.0-pop);
    float a = clamp(ring*0.55 + dots*0.5, 0.0, 1.0)*al;
    o = vec4(vec3(0.92,0.95,1.0)*a, a); return;
  }
  if (r > 1.0){
    // meniscus: a soft dark collar where the film meets the paint
    float m = smoothstep(1.12, 1.0, r)*0.32*al;
    o = vec4(vec3(0.0), m); return;
  }
  float z = sqrt(max(1.0 - rr, 0.0));
  vec3 n = vec3(vQ, z);
  vec2 w = vB.xy + vQ*vB.z*0.8;
  float A; vec4 ax;
  vec3 under = baseAt(w/vec2(uAspect,1.0), A, ax);
  float t = uTime*0.22 + vC.x*13.0;
  vec2 sw = vQ*1.9 + vec2(sin(t + vQ.y*2.6), cos(t*0.83 + vQ.x*2.9))*0.45;
  float d = vC.y*(0.45 + 0.75*vnoise(sw*1.6 + t*0.7) + 0.35*rr) + 15.0;
  vec3 film = thinFilm(d, z);
  float F = 0.04 + 0.96*pow(1.0 - z, 5.0);
  vec3 col = under*(0.96 - 0.3*F) + film*(0.03 + 0.5*F);
  col += env(reflect(vec3(0.0,0.0,-1.0), n))*F*uGloss*0.9;
  col = mix(col, col*0.6 + film*0.35, smoothstep(0.88, 1.0, r)*0.6);
  float a = (1.0 - smoothstep(0.965, 1.0, r))*al;
  o = vec4(toSRGB(col)*a, a);
}`;

  FS.post = HEAD + LIB + `
out vec4 o;
uniform sampler2D uComp;
uniform vec2 uRes, uFocus;
uniform float uBlur, uBloom, uTime, uAspect, uVig, uGrain;
void main(){
  vec2 d = (vUv - uFocus)*vec2(uAspect,1.0);
  float coc = uBlur*smoothstep(0.1, 0.8, length(d));
  float px = coc*uRes.y;
  vec3 col;
  if (px < 0.8){ col = texture(uComp, vUv).rgb; }
  else {
    float lod = max(0.0, log2(px/5.0));
    col = textureLod(uComp, vUv, lod).rgb*0.4; float ws = 0.4;
    for (int i=0;i<10;i++){
      float a = float(i)*2.39996323, rr = sqrt((float(i)+0.5)/10.0);
      vec2 off = vec2(cos(a), sin(a))*rr*coc/vec2(uAspect,1.0);
      col += textureLod(uComp, vUv + off, lod).rgb; ws += 1.0;
    }
    col /= ws;
  }
  vec3 b = textureLod(uComp, vUv, 3.0).rgb*0.45 + textureLod(uComp, vUv, 5.0).rgb*0.55;
  col += uBloom*max(b - 0.88, 0.0)*2.6;
  vec2 v = (vUv - 0.5)*vec2(uAspect,1.0)/max(uAspect, 1.0);
  col *= mix(1.0, 0.6, smoothstep(0.3, 0.95, length(v)*1.25)*uVig);
  col += (hash12(vUv*uRes + fract(uTime*7.13)*311.0) - 0.5)*uGrain;
  o = vec4(col, 1.0);
}`;

  FS.readback = HEAD + `
out vec4 o;
uniform sampler2D uVel, uSurf, uD1, uAux;
void main(){
  vec2 u = texture(uVel, vUv).xy + texture(uSurf, vUv).xy;
  o = vec4(clamp(u/3.0*0.5 + 0.5, 0.0, 1.0), clamp(texture(uD1, vUv).w/3.0, 0.0, 1.0), clamp(texture(uAux, vUv).z, 0.0, 1.0));
}`;

  return { VS, BUB_VS, FS, MAXB, MAXI };
})();
