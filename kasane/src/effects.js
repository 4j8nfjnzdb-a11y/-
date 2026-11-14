// Kasane — effects. Each one is a small fragment shader over the layer's own pixels (before the layer is
// moved into the frame, as in After Effects), a few passes built from the blur helper, or — for the
// "手ざわり" family — a deformation of the layer's mesh so footage can be crumpled, pinched and flapped.
// Lengths are given in layer pixels and scaled to the buffer by uRs; points are layer coordinates.
'use strict';
(() => {
  const U = KS.U, G = KS.G;
  const FX = KS.FX = { defs: {}, order: [], cats: ['うつろい', '手ざわり', 'カラー', 'ぼかし・光', 'ゆがみ', 'スタイライズ', 'うつりかわり', '生成'] };

  const PRELUDE = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRes, uL0, uLs; uniform float uRs, uTime, uSeed;
in vec2 vUv; out vec4 o;
const vec3 LUM = vec3(.2126, .7152, .0722);
vec4 smp(vec2 uv){ return texture(uTex, uv); }
vec4 smpT(vec2 uv){ vec2 q = step(vec2(0.), uv) * step(uv, vec2(1.)); return texture(uTex, uv) * q.x * q.y; }
vec3 unp(vec4 c){ return c.a > 1e-4 ? c.rgb / c.a : vec3(0.); }
vec2 lUv(){ return (vUv * uRes - uL0) / uLs; }
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0., -1./3., 2./3., -1.); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6. * d + 1e-10)), d / (q.x + 1e-10), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1., 2./3., 1./3., 3.); vec3 p = abs(fract(c.xxx + K.xyz) * 6. - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0., 1.), c.y); }
vec2 rot(float deg){ float a = radians(deg); return vec2(cos(a), sin(a)); }
`;
  FX.PRELUDE = PRELUDE;

  // param helpers
  const N = (id, name, def, min, max, o = {}) => Object.assign({ id, name, type: 'num', def, min, max, step: o.step || 1 }, o);
  const PX = (id, name, def, min, max, o = {}) => N(id, name, def, min, max, Object.assign({ unit: 'px', px: true }, o));
  const PC = (id, name, def, o = {}) => N(id, name, def, o.min === undefined ? 0 : o.min, o.max === undefined ? 100 : o.max, Object.assign({ unit: '%' }, o));
  const DEG = (id, name, def, o = {}) => N(id, name, def, undefined, undefined, Object.assign({ unit: '°' }, o));
  const COL = (id, name, def) => ({ id, name, type: 'color', def: U.hex2rgba(def) });
  const PT = (id, name, def = 'c') => ({ id, name, type: 'pt', def, unit: 'px', step: 1 });
  const EN = (id, name, opts, def = 0) => ({ id, name, type: 'enum', opts, def });
  const BO = (id, name, def = false) => ({ id, name, type: 'bool', def: def ? 1 : 0 });

  function add(id, name, cat, params, body, extra) {
    FX.defs[id] = Object.assign({ id, name, cat, params, body }, extra || {});
    FX.order.push(id);
  }
  FX.shader = (def) => {
    if (!def.fs) {
      const decl = def.params.map((p) => `uniform ${p.type === 'color' ? 'vec4' : p.type === 'pt' || p.type === 'vec2' ? 'vec2' : 'float'} u_${p.id};`).join('\n');
      def.fs = PRELUDE + (def.extra || '') + '\n' + decl + '\nvoid main(){\n' + def.body + '\n}';
    }
    return def.fs;
  };
  FX.uniforms = (def, p, ctx, src) => {
    const u = { uTex: src.tex, uRes: [src.w, src.h], uRs: ctx.rs, uTime: ctx.time, uSeed: ctx.seed, uL0: ctx.l0, uLs: ctx.ls };
    if (def.wave && ctx.wave) u.uWave = ctx.wave();
    for (const pd of def.params) {
      const v = p[pd.id];
      if (pd.type === 'pt') u['u_' + pd.id] = ctx.toPx(v);
      else if (pd.type === 'color') u['u_' + pd.id] = v;
      else if (pd.type === 'vec2') u['u_' + pd.id] = pd.px ? [v[0] * ctx.rs, v[1] * ctx.rs] : v;
      else u['u_' + pd.id] = pd.px ? v * ctx.rs : +v;
    }
    return u;
  };
  FX.run = (def, ctx, src, p) => {
    const dst = G.acquire(src.w, src.h, { clear: false });
    G.pass(FX.shader(def), dst, FX.uniforms(def, p, ctx, src));
    return dst;
  };
  FX.apply = (def, ctx, src, p) => (def.render ? def.render(ctx, src, p) : FX.run(def, ctx, src, p));
  // a fresh effect instance for a layer whose source rectangle is r = {x, y, w, h}
  FX.create = (type, r) => {
    const def = FX.defs[type];
    const fx = { id: U.uid('f'), type, on: true, open: true, p: {} };
    const pt = { c: [r.x + r.w / 2, r.y + r.h / 2], t: [r.x + r.w / 2, r.y], b: [r.x + r.w / 2, r.y + r.h], l: [r.x, r.y + r.h / 2], r: [r.x + r.w, r.y + r.h / 2] };
    for (const pd of def.params) fx.p[pd.id] = { v: pd.type === 'pt' ? pt[pd.def].slice() : U.vcopy(pd.def) };
    if (def.pins) fx.pins = [];
    return fx;
  };
  FX.pad = (def, p) => (def.pad ? Math.max(0, def.pad(p)) : 0);

  // ================================================================ 手ざわり (tactile)
  // くしゃ: three things happen as the amount grows.
  //  1. Random straight creases cross the sheet, each a mountain or a valley; between them the paper stays
  //     flat, so it breaks into irregular facets that catch the light differently.
  //  2. The outline is drawn in towards the middle, corners first, into an uneven round wad.
  //  3. Past the halfway mark a few flaps fold right over the top and show the white back of the paper.
  // Every step is continuous across the sheet, so it never comes apart, and it can be keyframed both ways.
  const sstep = (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  add('crumple', 'くしゃ', '手ざわり', [
    PC('amount', 'まるめ具合', 60), N('folds', 'しわの細かさ', 9, 2, 30, { int: true }), N('seed', 'かたち', 1, 0, 999, { int: true }),
    PC('shade', 'かげ', 75), PC('back', '裏の白さ', 85),
  ], null, {
    mesh: true, grid: 110,
    deform(pos, n, p, env) {
      const a = U.clamp(p.amount / 100, 0, 1);
      if (a <= 0) return 0;
      const r = env.rect, cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = Math.hypot(r.w, r.h) / 2;
      const rnd = U.rng(1000 + (p.seed | 0) * 7919), K = 6 + 2 * U.clamp(p.folds | 0, 2, 30);
      const slope = Math.tan(a * 0.95) / Math.sqrt(K / 6), cr = [];
      for (let k = 0; k < K; k++) {
        const ang = rnd() * Math.PI, off = (rnd() * 2 - 1) * 0.85 * R;
        cr.push([Math.cos(ang), Math.sin(ang), off, (k % 2 ? 1 : -1) * (0.35 + 0.65 * rnd()) * slope]);
      }
      // the wad's outline: a radius the sheet can't reach past, wobbling with direction
      const rho = R * (0.42 + 0.6 * (1 - a)) / Math.max(a, 1e-3), hm = [];
      for (let m = 2; m <= 6; m++) hm.push([m, rnd() * Math.PI * 2, (0.5 + rnd()) * 0.085 * a]);
      const b = sstep(0.45, 1, a), flaps = [];
      for (let j = 0; j < 3; j++) {
        const ang = rnd() * Math.PI * 2, phi = b * (0.62 + 0.3 * rnd()) * Math.PI;
        flaps.push([Math.cos(ang), Math.sin(ang), 0.45 + 0.35 * rnd(), 1 - Math.cos(phi), Math.sin(phi), R * 0.025 * (j + 1)]);
      }
      // heights first, in the flat sheet's own coordinates; then take out the overall lean so that
      // the sheet as a whole still faces the viewer and only the facets tilt
      let sxx = 0, syy = 0, sxz = 0, syz = 0, sz = 0;
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3] - cx, y = pos[i * 3 + 1] - cy; let z = 0;
        for (let k = 0; k < K; k++) { const c = cr[k]; z += Math.abs(x * c[0] + y * c[1] - c[2]) * c[3]; }
        pos[i * 3 + 2] = z; sxx += x * x; syy += y * y; sxz += x * z; syz += y * z; sz += z;
      }
      const ax = sxx > 0 ? sxz / sxx : 0, ay = syy > 0 ? syz / syy : 0, az = sz / n;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) {
        let x = pos[i * 3] - cx, y = pos[i * 3 + 1] - cy, z = pos[i * 3 + 2] - ax * x - ay * y - az;
        const rr = Math.hypot(x, y);
        if (rr > 1e-6) {
          const th = Math.atan2(y, x); let w = 1;
          for (let m = 0; m < hm.length; m++) w += Math.sin(hm[m][0] * th + hm[m][1]) * hm[m][2];
          const lim = rho * w, k2 = 1 / Math.sqrt(1 + (rr / lim) * (rr / lim));
          x *= k2; y *= k2; z *= k2;                                     // heights shrink with the sheet, so the facets keep their tilt
          if (b > 0) {
            for (let j = 0; j < 3; j++) {
              const g = flaps[j], d = x * g[0] + y * g[1] - g[2] * lim * k2;
              if (d > 0) { x -= g[0] * d * g[3]; y -= g[1] * d * g[3]; z += d * g[4] * 0.6 + g[5] * g[3] * (1 + a); }
            }
          }
        }
        pos[i * 3] = cx + x; pos[i * 3 + 1] = cy + y; pos[i * 3 + 2] = z;
        if (z < lo) lo = z; if (z > hi) hi = z;
      }
      const mid = (lo + hi) / 2;
      for (let i = 0; i < n; i++) pos[i * 3 + 2] -= mid;
      return Math.max(1, (hi - lo) / 2);
    },
    shade: (p) => (p.amount > 0 ? p.shade / 100 : 0),
    back: (p) => p.back / 100,
  });
  // つまみ: pins hold the picture; dragging one bends everything around it as rigidly as it can
  // (moving-least-squares rigid deformation, Schaefer et al. 2006 — the same idea as a puppet pin tool).
  add('pins', 'つまみ', '手ざわり', [N('stiff', 'かたさ', 1, 0.5, 3, { step: 0.1 })], null, {
    mesh: true, grid: 40, pins: true,
    deform(pos, n, p, env) {
      const pins = env.pins, m = pins.length;
      if (!m) return 0;
      let moved = false; for (const q of pins) if (q.rest[0] !== q.cur[0] || q.rest[1] !== q.cur[1]) moved = true;
      if (!moved) return 0;
      const al = p.stiff, w = new Float64Array(m);
      for (let i = 0; i < n; i++) {
        const vx = pos[i * 3], vy = pos[i * 3 + 1];
        let sw = 0, px = 0, py = 0, qx = 0, qy = 0, exact = -1;
        for (let k = 0; k < m; k++) {
          const dx = pins[k].rest[0] - vx, dy = pins[k].rest[1] - vy, d2 = dx * dx + dy * dy;
          if (d2 < 1e-6) { exact = k; break; }
          const wk = 1 / Math.pow(d2, al); w[k] = wk; sw += wk;
          px += wk * pins[k].rest[0]; py += wk * pins[k].rest[1]; qx += wk * pins[k].cur[0]; qy += wk * pins[k].cur[1];
        }
        if (exact >= 0) { pos[i * 3] = pins[exact].cur[0]; pos[i * 3 + 1] = pins[exact].cur[1]; continue; }
        px /= sw; py /= sw; qx /= sw; qy /= sw;
        if (m === 1) { pos[i * 3] = vx + qx - px; pos[i * 3 + 1] = vy + qy - py; continue; }
        const hx = vx - px, hy = vy - py;
        let fx = 0, fy = 0;
        for (let k = 0; k < m; k++) {
          const ax = pins[k].rest[0] - px, ay = pins[k].rest[1] - py, bx = pins[k].cur[0] - qx, by = pins[k].cur[1] - qy;
          const dot = ax * hx + ay * hy, crs = ax * hy - ay * hx;
          fx += w[k] * (bx * dot - by * crs); fy += w[k] * (bx * crs + by * dot);
        }
        const fl = Math.hypot(fx, fy), hl = Math.hypot(hx, hy);
        if (fl < 1e-9) { pos[i * 3] = qx + hx; pos[i * 3 + 1] = qy + hy; } else { pos[i * 3] = qx + fx / fl * hl; pos[i * 3 + 1] = qy + fy / fl * hl; }
      }
      return 0;
    },
  });
  add('flutter', 'はためき', '手ざわり', [
    PX('amp', '波の高さ', 40, 0, 400, { px: false }), PX('len', '波の長さ', 500, 20, 4000, { px: false }), N('speed', '速さ', 0.6, -5, 5, { step: 0.05 }),
    DEG('angle', '向き', 0), BO('pin', '片側を止める', true), PC('shade', 'かげ', 60),
  ], null, {
    mesh: true, grid: 48,
    deform(pos, n, p, env) {
      const A = p.amp; if (!A) return 0;
      const L = Math.max(p.len, 1), an = p.angle * Math.PI / 180, dx = Math.cos(an), dy = Math.sin(an), ph = env.time * p.speed * Math.PI * 2, r = env.rect;
      const s0 = Math.min(r.x * dx + r.y * dy, (r.x + r.w) * dx + r.y * dy, r.x * dx + (r.y + r.h) * dy, (r.x + r.w) * dx + (r.y + r.h) * dy);
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], s = x * dx + y * dy - s0, c = -x * dy + y * dx;
        const grip = p.pin > 0.5 ? U.clamp(s / (L * 0.6), 0, 1) : 1;
        const z = (Math.sin(s / L * 6.2832 - ph) + 0.35 * Math.sin(s / L * 14.6 - ph * 1.7 + c / L * 3.1)) * A * grip;
        pos[i * 3] = x - dx * Math.abs(z) * 0.12; pos[i * 3 + 1] = y - dy * Math.abs(z) * 0.12 + z * 0.22; pos[i * 3 + 2] = pos[i * 3 + 2] + z;
      }
      return A * 1.4;
    },
    shade: (p) => (p.amp > 0 ? p.shade / 100 : 0),
  });
  add('outline', 'シールのふち', '手ざわり', [PX('width', '太さ', 14, 0, 120), COL('color', '色', '#f1ecdf')], `
  vec4 c = smp(vUv); float a = c.a;
  for (int i = 0; i < 24; i++) { vec2 d = rot(float(i) * 15.) * u_width / uRes; a = max(a, smpT(vUv + d).a); a = max(a, smpT(vUv + d * .5).a); }
  o = c + vec4(u_color.rgb, 1.) * a * (1. - c.a);`, { pad: (p) => p.width + 2 });
  add('paper', '紙の質感', '手ざわり', [PC('amount', '強さ', 45), N('size', '目の細かさ', 1, 0.2, 8, { step: 0.1 }), N('seed', 'かたち', 0, 0, 99, { int: true })], `
  vec4 c = smp(vUv); vec2 px = vUv * uRes / max(uRs, .001);
  float f = fbm(px * .9 / u_size + u_seed * 3.1), g = fbm(px * vec2(.06, .55) / u_size + 40. + u_seed);
  float t = (f - .5) * 1.1 + (g - .5) * .9;
  o = vec4(clamp(unp(c) * (1. + t * u_amount / 100.), 0., 1.) * c.a, c.a);`);

  // ================================================================ カラー
  add('bc', '明るさ・コントラスト', 'カラー', [N('bright', '明るさ', 0, -100, 100), N('contrast', 'コントラスト', 0, -100, 100)], `
  vec4 c = smp(vUv); vec3 r = unp(c);
  float k = u_contrast >= 0. ? 1. + u_contrast / 50. : 1. + u_contrast / 100.;
  r = (r - .5) * k + .5 + u_bright / 100.;
  o = vec4(clamp(r, 0., 1.) * c.a, c.a);`);
  add('hsl', '色相・彩度', 'カラー', [DEG('hue', '色相', 0), N('sat', '彩度', 0, -100, 100), N('light', '明度', 0, -100, 100)], `
  vec4 c = smp(vUv); vec3 h = rgb2hsv(unp(c));
  h.x = fract(h.x + u_hue / 360.); h.y = clamp(h.y * (1. + u_sat / 100.), 0., 1.);
  vec3 r = hsv2rgb(h); r = u_light >= 0. ? mix(r, vec3(1.), u_light / 100.) : r * (1. + u_light / 100.);
  o = vec4(r * c.a, c.a);`);
  add('levels', 'レベル', 'カラー', [PC('inB', '入力の黒', 0), PC('inW', '入力の白', 100), N('gamma', 'ガンマ', 1, 0.1, 5, { step: 0.01 }), PC('outB', '出力の黒', 0), PC('outW', '出力の白', 100)], `
  vec4 c = smp(vUv); vec3 r = unp(c);
  r = clamp((r - u_inB / 100.) / max((u_inW - u_inB) / 100., 1e-4), 0., 1.);
  r = pow(r, vec3(1. / max(u_gamma, .01)));
  r = mix(vec3(u_outB / 100.), vec3(u_outW / 100.), r);
  o = vec4(r * c.a, c.a);`);
  add('tint', '2色に染める', 'カラー', [COL('black', '暗いところ', '#1b2a4a'), COL('white', '明るいところ', '#f4e7c8'), PC('amount', '適用量', 100)], `
  vec4 c = smp(vUv); vec3 r = unp(c);
  o = vec4(mix(r, mix(u_black.rgb, u_white.rgb, dot(r, LUM)), u_amount / 100.) * c.a, c.a);`);
  add('fill', '塗りつぶし', 'カラー', [COL('color', '色', '#e9c84a'), PC('amount', '適用量', 100)], `
  vec4 c = smp(vUv); o = vec4(mix(unp(c), u_color.rgb, u_amount / 100.) * c.a, c.a);`);
  add('invert', '反転', 'カラー', [PC('amount', '適用量', 100)], `
  vec4 c = smp(vUv); vec3 r = unp(c); o = vec4(mix(r, 1. - r, u_amount / 100.) * c.a, c.a);`);
  add('posterize', '階調を減らす', 'カラー', [N('levels', '階調', 5, 2, 32, { int: true })], `
  vec4 c = smp(vUv); float n = max(u_levels, 2.) - 1.; o = vec4(floor(unp(c) * n + .5) / n * c.a, c.a);`);
  add('threshold', '白黒2階調', 'カラー', [PC('level', 'しきい値', 50), PC('soft', 'なめらかさ', 2)], `
  vec4 c = smp(vUv); float l = dot(unp(c), LUM);
  o = vec4(vec3(smoothstep(u_level / 100. - u_soft / 200. - 1e-4, u_level / 100. + u_soft / 200. + 1e-4, l)) * c.a, c.a);`);
  add('chroma', 'クロマキー', 'カラー', [COL('key', '抜く色', '#19c23a'), PC('tol', '許容', 40), PC('soft', 'やわらかさ', 20), PC('spill', '色かぶり除去', 60)], `
  vec4 c = smp(vUv); vec3 r = unp(c);
  vec2 cc = vec2(dot(r, vec3(-.169, -.331, .5)), dot(r, vec3(.5, -.419, -.081)));
  vec2 kk = vec2(dot(u_key.rgb, vec3(-.169, -.331, .5)), dot(u_key.rgb, vec3(.5, -.419, -.081)));
  float d = distance(cc, kk), t = u_tol / 200.;
  float a = smoothstep(t, t + u_soft / 200. + 1e-4, d);
  float l = dot(r, LUM); r = mix(r, mix(vec3(l), r, clamp(d / (t + .12), 0., 1.)), u_spill / 100.);
  o = vec4(r * c.a * a, c.a * a);`);

  // ================================================================ ぼかし・光
  add('blur', 'ブラー', 'ぼかし・光', [PX('radius', '半径', 20, 0, 400), EN('dir', '方向', ['縦と横', '横だけ', '縦だけ'])], null, {
    pad: (p) => p.radius * 1.5,
    render(ctx, src, p) { const s = p.radius * ctx.rs / 2, d = p.dir | 0; return G.blur(src, d === 2 ? 0 : s, d === 1 ? 0 : s); },
  });
  add('dirblur', '方向ブラー', 'ぼかし・光', [DEG('angle', '向き', 0), PX('len', '長さ', 60, 0, 600)], `
  vec2 d = rot(u_angle) * u_len / uRes; vec4 s = vec4(0.); float j = hash(gl_FragCoord.xy) - .5;
  for (int i = 0; i < 28; i++) { float t = (float(i) + .5 + j) / 28. - .5; s += smpT(vUv + d * t); }
  o = s / 28.;`, { pad: (p) => p.len / 2 });
  add('zoomblur', '放射ブラー', 'ぼかし・光', [PC('amount', '量', 25, { max: 200 }), PT('center', '中心')], `
  vec2 ctr = u_center / uRes, d = (vUv - ctr) * u_amount / 100.; vec4 s = vec4(0.); float j = hash(gl_FragCoord.xy);
  for (int i = 0; i < 28; i++) { float t = (float(i) + j) / 28.; s += smpT(vUv - d * t); }
  o = s / 28.;`);
  const FS_GLOW_PRE = PRELUDE + `uniform float u_thr;
void main(){ vec4 c = smp(vUv); float l = dot(unp(c), LUM); o = c * smoothstep(u_thr, u_thr + .12, l); }`;
  const FS_GLOW_MIX = PRELUDE + `uniform sampler2D uGlow; uniform float u_int; uniform vec4 u_color;
void main(){ vec4 b = smp(vUv); vec4 g = texture(uGlow, vUv) * u_int; g.rgb *= u_color.rgb;
  float ga = clamp(max(max(g.r, g.g), g.b), 0., 1.);
  o = vec4(b.rgb + g.rgb * (1. - clamp(b.rgb, 0., 1.)), b.a + ga * (1. - b.a)); }`;
  add('glow', 'グロー', 'ぼかし・光', [PC('threshold', 'しきい値', 55), PX('radius', '広がり', 40, 0, 400), PC('intensity', '強さ', 120, { max: 400 }), COL('color', '色', '#ffffff')], null, {
    pad: (p) => p.radius * 1.5,
    render(ctx, src, p) {
      const pre = G.acquire(src.w, src.h, { clear: false });
      G.pass(FS_GLOW_PRE, pre, { uTex: src.tex, u_thr: p.threshold / 100 });
      const bl = G.blur(pre, p.radius * ctx.rs / 2); G.release(pre);
      const dst = G.acquire(src.w, src.h, { clear: false });
      G.pass(FS_GLOW_MIX, dst, { uTex: src.tex, uGlow: bl.tex, u_int: p.intensity / 100, u_color: p.color });
      G.release(bl);
      return dst;
    },
  });
  const FS_SHADOW = PRELUDE + `uniform sampler2D uBlur; uniform vec2 u_off; uniform vec4 u_color; uniform float u_op, u_only;
void main(){ vec4 c = smp(vUv); vec2 q = vUv - u_off; vec2 in01 = step(vec2(0.), q) * step(q, vec2(1.));
  float a = texture(uBlur, q).a * in01.x * in01.y * u_op; vec4 sh = vec4(u_color.rgb * a, a);
  o = u_only > .5 ? sh : c + sh * (1. - c.a); }`;
  add('shadow', 'ドロップシャドウ', 'ぼかし・光', [COL('color', '色', '#000000'), PC('opacity', '濃さ', 55), DEG('angle', '向き', 45), PX('dist', '距離', 24, 0, 400), PX('soft', 'やわらかさ', 24, 0, 300), BO('only', '影だけ')], null, {
    pad: (p) => p.dist + p.soft * 1.5,
    render(ctx, src, p) {
      const bl = G.blur(src, p.soft * ctx.rs / 2), an = p.angle * Math.PI / 180;
      const dst = G.acquire(src.w, src.h, { clear: false });
      G.pass(FS_SHADOW, dst, { uTex: src.tex, uBlur: bl.tex, u_off: [Math.cos(an) * p.dist * ctx.rs / src.w, Math.sin(an) * p.dist * ctx.rs / src.h], u_color: p.color, u_op: p.opacity / 100, u_only: p.only });
      G.release(bl);
      return dst;
    },
  });

  // ================================================================ ゆがみ
  add('wave', '波', 'ゆがみ', [PX('height', '波の高さ', 20, 0, 400), PX('width', '波の長さ', 200, 4, 4000), DEG('angle', '向き', 0), N('speed', '速さ', 1, -10, 10, { step: 0.05 }), DEG('phase', '位相', 0)], `
  vec2 px = vUv * uRes, dir = rot(u_angle), nrm = vec2(-dir.y, dir.x);
  float ph = dot(px, dir) / max(u_width, 1.) * 6.2831853 - (uTime * u_speed + u_phase / 360.) * 6.2831853;
  o = smpT((px + nrm * sin(ph) * u_height) / uRes);`, { pad: (p) => p.height });
  add('turb', 'ゆらぎ', 'ゆがみ', [PX('amount', '量', 40, 0, 600), PX('size', '大きさ', 160, 4, 2000), N('speed', '速さ', 0.3, -5, 5, { step: 0.05 }), DEG('evo', '展開', 0)], `
  vec2 px = vUv * uRes, q = px / max(u_size, 1.) + uSeed * 7.3; float e = uTime * u_speed + u_evo / 360.;
  vec2 d = vec2(fbm(q + vec2(0., e)), fbm(q + vec2(31.7, -e) + 5.2)) - .47;
  o = smpT((px + d * u_amount * 2.) / uRes);`, { pad: (p) => p.amount });
  add('bulge', 'ふくらみ', 'ゆがみ', [PT('center', '中心'), PX('radius', '半径', 300, 1, 4000), N('amount', '量', 50, -100, 95)], `
  vec2 px = vUv * uRes, d = px - u_center; float r = length(d) / max(u_radius, 1.);
  if (r < 1.) d *= 1. - u_amount / 100. * (1. - r) * (1. - r);
  o = smpT((u_center + d) / uRes);`);
  add('twirl', '渦', 'ゆがみ', [PT('center', '中心'), PX('radius', '半径', 400, 1, 4000), DEG('angle', 'ねじれ', 120)], `
  vec2 px = vUv * uRes, d = px - u_center; float r = length(d) / max(u_radius, 1.);
  if (r < 1.) { float a = radians(u_angle) * (1. - r) * (1. - r), s = sin(a), c = cos(a); d = vec2(c * d.x - s * d.y, s * d.x + c * d.y); }
  o = smpT((u_center + d) / uRes);`);
  add('kaleido', '万華鏡', 'ゆがみ', [N('seg', '面の数', 6, 2, 32, { int: true }), DEG('angle', '回転', 0), PT('center', '中心')], `
  vec2 p = vUv * uRes - u_center; float a = atan(p.y, p.x) - radians(u_angle), r = length(p);
  float sg = 6.2831853 / max(u_seg, 1.); a = abs(mod(a, sg) - sg * .5);
  vec2 uv = (rot(degrees(a) + u_angle) * r + u_center) / uRes;
  o = smp(abs(mod(uv + 1., 2.) - 1.));`);
  add('mirror', '鏡', 'ゆがみ', [PT('center', '軸の位置'), DEG('angle', '軸の向き', 0)], `
  vec2 p = vUv * uRes - u_center, n = rot(u_angle); float d = dot(p, n); if (d > 0.) p -= 2. * d * n;
  o = smpT((p + u_center) / uRes);`);
  add('mosaic', 'モザイク', 'ゆがみ', [PX('size', 'ますの大きさ', 24, 1, 400)], `
  float b = max(u_size, 1.); o = smp((floor((vUv * uRes - uL0) / b) + .5) * b / uRes + uL0 / uRes);`);
  add('offset', '流す', 'ゆがみ', [{ id: 'shift', name: 'ずらし', type: 'vec2', def: [0, 0], unit: 'px', px: true, step: 1 }], `
  vec2 l = fract(lUv() - u_shift / uLs); o = smp((l * uLs + uL0) / uRes);`);

  // ================================================================ スタイライズ
  add('glitch', 'グリッチ', 'スタイライズ', [PC('amount', '量', 35), PX('shift', 'ずれ幅', 80, 0, 1000), PX('block', '帯の高さ', 18, 2, 400), PX('rgb', '色ずれ', 8, 0, 200), N('speed', '速さ', 12, 0, 60, { step: 0.5 })], `
  float t = floor(uTime * u_speed) + uSeed; vec2 px = vUv * uRes; float bh = max(u_block, 2.);
  float row = floor(px.y / bh), r1 = hash(vec2(row, t)), r2 = hash(vec2(row * 1.7 + 3., t + 9.));
  float on = step(1. - u_amount / 100., r1), sh = (r2 - .5) * 2. * u_shift * on;
  float blk = floor(px.y / (bh * 6.)); sh += step(1. - u_amount / 300., hash(vec2(blk, t + 3.))) * (hash(vec2(blk, t + 7.)) - .5) * u_shift * 3.;
  vec2 uv = (px + vec2(sh, 0.)) / uRes; float ca = u_rgb * (.2 + on) / uRes.x;
  vec4 a = smpT(uv + vec2(ca, 0.)), b = smpT(uv), c = smpT(uv - vec2(ca, 0.));
  o = vec4(a.r, b.g, c.b, max(max(a.a, b.a), c.a));`, { pad: (p) => p.rgb * 1.2 });
  add('rgbsplit', '色ずれ', 'スタイライズ', [PX('dist', '距離', 10, 0, 300), DEG('angle', '向き', 0)], `
  vec2 d = rot(u_angle) * u_dist / uRes; vec4 a = smpT(vUv + d), b = smpT(vUv), c = smpT(vUv - d);
  o = vec4(a.r, b.g, c.b, max(max(a.a, b.a), c.a));`, { pad: (p) => p.dist });
  add('noise', '粒子', 'スタイライズ', [PC('amount', '量', 25), PX('size', '粒の大きさ', 1.5, 0.5, 40, { step: 0.5 }), BO('mono', 'モノクロ', true), BO('anim', '動かす', true)], `
  vec4 c = smp(vUv); vec2 p = floor(vUv * uRes / max(u_size, .5)); float t = u_anim > .5 ? floor(uTime * 24.) : 0.;
  vec3 n = vec3(hash(p + t * 17.1 + uSeed), hash(p + t * 23.7 + 91.), hash(p + t * 31.3 + 47.)) - .5; if (u_mono > .5) n = vec3(n.x);
  o = vec4(clamp(unp(c) + n * u_amount / 50., 0., 1.) * c.a, c.a);`);
  add('halftone', '網点', 'スタイライズ', [PX('size', '点の間隔', 14, 3, 200), DEG('angle', '角度', 30), COL('ink', 'インク', '#141a17'), COL('paper', '紙', '#f1ecdf')], `
  vec4 c = smp(vUv); vec2 r = rot(u_angle); mat2 R = mat2(r.x, -r.y, r.y, r.x); vec2 px = R * (vUv * uRes); float s = max(u_size, 2.);
  vec2 cell = (floor(px / s) + .5) * s; float l = dot(unp(smp((transpose(R) * cell) / uRes)), LUM);
  float rad = sqrt(clamp(1. - l, 0., 1.)) * s * .72, k = 1. - smoothstep(rad - 1., rad + 1., length(px - cell));
  o = vec4(mix(u_paper.rgb, u_ink.rgb, k) * c.a, c.a);`);
  add('edges', '輪郭', 'スタイライズ', [PC('amount', '強さ', 60, { max: 300 }), BO('inv', '白地に黒い線', true), PC('mix', '適用量', 100)], `
  vec2 e = 1. / uRes; float g[9]; int k = 0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) g[k++] = dot(unp(smp(vUv + e * vec2(float(x), float(y)))), LUM);
  float gx = g[2] + 2. * g[5] + g[8] - g[0] - 2. * g[3] - g[6], gy = g[6] + 2. * g[7] + g[8] - g[0] - 2. * g[1] - g[2];
  float m = clamp(length(vec2(gx, gy)) * u_amount / 25., 0., 1.); vec4 c = smp(vUv);
  o = vec4(mix(unp(c), vec3(u_inv > .5 ? 1. - m : m), u_mix / 100.) * c.a, c.a);`);
  add('scan', '走査線', 'スタイライズ', [PX('size', '線の間隔', 6, 1, 200), PC('amount', '濃さ', 45), N('speed', '流れる速さ', 0, -20, 20, { step: 0.1 })], `
  vec4 c = smp(vUv); float l = .5 + .5 * sin((vUv.y * uRes.y / max(u_size, 1.) + uTime * u_speed) * 6.2831853);
  o = vec4(unp(c) * mix(1., l, u_amount / 100.) * c.a, c.a);`);
  add('vignette', '周辺を落とす', 'スタイライズ', [PC('amount', '量', 60), PC('size', '明るい範囲', 45), PC('soft', 'やわらかさ', 50), COL('color', '色', '#000000')], `
  vec4 c = smp(vUv); float r = length((lUv() - .5) * 2.) / 1.41421;
  float v = smoothstep(u_size / 100., u_size / 100. + max(u_soft / 100., .001), r);
  o = vec4(mix(unp(c), u_color.rgb, v * u_amount / 100.) * c.a, c.a);`);

  // ================================================================ うつりかわり
  add('wipe', 'ワイプ', 'うつりかわり', [PC('done', '進み具合', 50), DEG('angle', '向き', 0), PX('feather', 'ぼかし', 30, 0, 1000)], `
  vec4 c = smp(vUv); vec2 dir = rot(u_angle), p = (lUv() - .5) * uLs; float ext = abs(dir.x) * uLs.x * .5 + abs(dir.y) * uLs.y * .5;
  float d = dot(p, dir) / max(ext, 1.) * .5 + .5, f = max(u_feather / max(ext * 2., 1.), 1e-4), e = u_done / 100. * (1. + f);
  o = c * smoothstep(e - f, e, d);`);
  add('radialwipe', '時計ワイプ', 'うつりかわり', [PC('done', '進み具合', 50), DEG('start', '始まりの角度', 0), PT('center', '中心'), DEG('feather', 'ぼかし', 4)], `
  vec2 p = vUv * uRes - u_center; float a = fract((atan(p.x, -p.y) - radians(u_start)) / 6.2831853 + 1.);
  float f = max(u_feather / 360., 1e-4), e = u_done / 100. * (1. + f);
  o = smp(vUv) * smoothstep(e - f, e, a);`);
  add('blocks', 'ブロックで消える', 'うつりかわり', [PC('done', '進み具合', 50), PX('size', 'ますの大きさ', 40, 1, 600)], `
  vec2 b = floor((vUv * uRes - uL0) / max(u_size, 1.)); o = smp(vUv) * step(u_done / 100., hash(b + uSeed * 13.7) * .9998 + .0001);`);

  // ================================================================ 生成
  add('gradient', 'グラデーション', '生成', [PT('a', '始点', 't'), PT('b', '終点', 'b'), COL('c1', '始めの色', '#e86a5c'), COL('c2', '終わりの色', '#27304f'), EN('type', '形', ['直線', '円形']), BO('keep', 'レイヤーの形を保つ', true), PC('mix', '適用量', 100)], `
  vec4 c = smp(vUv); vec2 px = vUv * uRes, ab = u_b - u_a;
  float t = u_type < .5 ? dot(px - u_a, ab) / max(dot(ab, ab), 1e-4) : length(px - u_a) / max(length(ab), 1e-4);
  vec4 g = mix(u_c1, u_c2, clamp(t, 0., 1.)); g.rgb *= g.a;
  vec2 in01 = step(vec2(0.), lUv()) * step(lUv(), vec2(1.));
  o = mix(c, g * (u_keep > .5 ? c.a : in01.x * in01.y), u_mix / 100.);`);
  add('fractal', '雲もよう', '生成', [PX('scale', '大きさ', 300, 4, 4000, { px: false }), N('contrast', 'コントラスト', 30, -100, 300), N('bright', '明るさ', 0, -100, 100), PC('warp', 'うねり', 40, { max: 300 }), N('speed', '速さ', 0.15, -5, 5, { step: 0.01 }), DEG('evo', '展開', 0), COL('c1', '暗い色', '#0d1512'), COL('c2', '明るい色', '#e8ece6'), BO('keep', 'レイヤーの形を保つ', true), PC('mix', '適用量', 100)], `
  vec4 c = smp(vUv); vec2 px = vUv * uRes / max(uRs, .001) / max(u_scale, 1.); float e = uTime * u_speed + u_evo / 360.;
  float n = fbm(px + vec2(e * .7, -e * .4) + uSeed * 9.1); n = fbm(px + n * u_warp / 50. + vec2(-e * .3, e * .6));
  n = clamp((n - .5) * (1. + u_contrast / 50.) + .5 + u_bright / 100., 0., 1.);
  vec2 in01 = step(vec2(0.), lUv()) * step(lUv(), vec2(1.));
  o = mix(c, vec4(mix(u_c1.rgb, u_c2.rgb, n), 1.) * (u_keep > .5 ? c.a : in01.x * in01.y), u_mix / 100.);`);

  // ================================================================ うつろい (processes)
  // These don't draw a picture; they keep changing one. Each has a rule that is applied again to its own
  // result, frame after frame, so a plain image grows into something no single setting describes.
  // The stateful ones are stepped from the layer's first frame, which makes them the same on every pass.
  const copyRt = (rt) => { const o = G.acquire(rt.w, rt.h, { float: rt.float, clear: false }); G.pass(G.SRC.copy, o, { uTex: rt.tex }); return o; };
  FX.copyRt = copyRt;
  const base = (ctx, src) => ({ uTex: src.tex, uRes: [src.w, src.h], uRs: ctx.rs, uTime: ctx.time, uSeed: ctx.seed, uL0: ctx.l0, uLs: ctx.ls });

  // とろけ: the picture flows along a field read from the picture itself — its tones decide what runs and what
  // holds, its contours decide how it curls. What is stored is not colour but how far every point has slid,
  // so nothing blurs however long it runs, a playing video keeps playing inside the melt, and "もどる力"
  // can pull it all back.
  const MELT_STEP = PRELUDE + `uniform sampler2D uIn; uniform float u_flow, u_tone, u_swirl, u_spread, u_angle, u_grain, u_heal, u_visc;
float lumAt(vec2 px){ vec2 d = texture(uTex, px / uRes).xy; return dot(texture(uIn, (px + d) / uRes).rgb, LUM); }
void main(){
  vec2 px = vUv * uRes; float e = 3. * uRs + 1.;
  float l = lumAt(px);
  vec2 g = vec2(lumAt(px + vec2(e, 0.)) - lumAt(px - vec2(e, 0.)), lumAt(px + vec2(0., e)) - lumAt(px - vec2(0., e))) / (2. * e) * 40. * uRs;
  float w = u_tone >= 0. ? mix(1., l, u_tone / 100.) : mix(1., 1. - l, -u_tone / 100.); w *= w;
  float nz = vnoise(px / (70. * uRs) + uSeed) - .5;
  vec2 v = rot(u_angle) * w * (1. + nz * u_grain / 40.) + vec2(-g.y, g.x) * u_swirl / 100. * 6. + g * u_spread / 100. * 6.;
  v *= u_flow / 100. * 2.4 * uRs;
  vec2 q = (px - v) / uRes, e2 = (2. * uRs + 1.) / uRes;
  vec2 d = texture(uTex, q).xy;
  vec2 av = (texture(uTex, q + vec2(e2.x, 0.)).xy + texture(uTex, q - vec2(e2.x, 0.)).xy + texture(uTex, q + vec2(0., e2.y)).xy + texture(uTex, q - vec2(0., e2.y)).xy) * .25;
  d = mix(d, av, u_visc / 100. * .6) - v;                               // neighbours drag each other along: thick, not gritty
  o = vec4(d * (1. - u_heal / 100. * .12), 0., 1.);
}`;
  const MELT_OUT = PRELUDE + `uniform sampler2D uIn;
void main(){ vec2 q = vUv + texture(uTex, vUv).xy / uRes; vec2 in01 = step(vec2(0.), q) * step(q, vec2(1.)); o = texture(uIn, q) * in01.x * in01.y; }`;
  add('melt', 'とろけ', 'うつろい', [
    PC('flow', '流れる量', 35), N('tone', '明るいほど流れる ↔ 暗いほど流れる', 60, -100, 100), PC('swirl', '輪郭に沿ってうねる', 30), N('spread', 'にじみ出す ↔ 引きこもる', 0, -100, 100),
    DEG('angle', '流れる向き', 90), PC('visc', 'ねばり', 45), PC('grain', 'むら', 25), PC('heal', 'もどる力', 0), PX('room', 'はみ出す余白', 160, 0, 800),
  ], null, {
    process: true, float: true, pad: (p) => p.room,
    init: (ctx, input) => G.acquire(input.w, input.h, { float: true }),
    step(ctx, state, input, p) {
      const nx = G.acquire(state.w, state.h, { float: true, clear: false });
      G.pass(MELT_STEP, nx, Object.assign(base(ctx, state), { uIn: input.tex, u_flow: p.flow, u_tone: p.tone, u_swirl: p.swirl, u_spread: p.spread, u_angle: p.angle, u_grain: p.grain, u_heal: p.heal, u_visc: p.visc }));
      return nx;
    },
    out(ctx, state, input) { const o = G.acquire(input.w, input.h, { clear: false }); G.pass(MELT_OUT, o, Object.assign(base(ctx, state), { uIn: input.tex })); return o; },
  });

  // しずむ: neighbouring pixels compare themselves and trade places when they are in the wrong order — the
  // odd-even transposition sort, one round per step. Nothing is blurred or invented; the picture's own
  // pixels slowly settle like sediment, and the tones outside the chosen range stay where they are.
  const SETTLE_STEP = PRELUDE + `uniform float uStep, u_dir, u_by, u_lo, u_hi, u_uneven;
float ihash(ivec2 p, int k){ uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u + uint(k) * 2246822519u; h = (h ^ (h >> 13)) * 1274126177u; h ^= h >> 16; return float(h) / 4294967295.; }
float keyOf(vec4 c){ vec3 r = unp(c); if (u_by < .5) return dot(r, LUM); vec3 h = rgb2hsv(r); return u_by < 1.5 ? h.x : h.y; }
void main(){
  ivec2 q = ivec2(gl_FragCoord.xy), sz = textureSize(uTex, 0);
  bool vert = u_dir < 1.5; int c = vert ? q.y : q.x;
  bool first = ((c + int(uStep)) & 1) == 0;
  ivec2 m = q + (vert ? ivec2(0, first ? 1 : -1) : ivec2(first ? 1 : -1, 0));
  vec4 a = texelFetch(uTex, q, 0);
  if (m.x < 0 || m.y < 0 || m.x >= sz.x || m.y >= sz.y) { o = a; return; }
  vec4 b = texelFetch(uTex, m, 0);
  float ka = keyOf(a), kb = keyOf(b), lo = u_lo / 100., hi = u_hi / 100.;
  ivec2 pid = first ? q : m;
  bool can = a.a > .5 && b.a > .5 && ka >= lo && ka <= hi && kb >= lo && kb <= hi && ihash(pid, int(uStep) + int(uSeed * 10.)) >= u_uneven / 100. * .9;
  float kf = first ? ka : kb, ks = first ? kb : ka;
  bool brightFar = u_dir < .5 || (u_dir > 1.5 && u_dir < 2.5);
  o = can && (brightFar ? kf > ks : kf < ks) ? b : a;
}`;
  const MIX2 = PRELUDE + `uniform sampler2D uIn; uniform float uK; void main(){ o = mix(texture(uTex, vUv), texture(uIn, vUv), uK); }`;
  add('settle', 'しずむ', 'うつろい', [
    N('speed', 'はやさ', 6, 0, 32, { int: true }), EN('dir', '向き', ['明るいものが下へ', '明るいものが上へ', '明るいものが右へ', '明るいものが左へ']), EN('by', '比べるもの', ['明るさ', '色相', '彩度']),
    PC('lo', '動く範囲の下', 12), PC('hi', '動く範囲の上', 88), PC('uneven', 'むら', 40), PC('feed', 'もとの絵が戻る', 0),
  ], null, {
    process: true,
    init: (ctx, input) => copyRt(input),
    step(ctx, state, input, p) {
      let cur = state;
      const u = { u_dir: p.dir, u_by: p.by, u_lo: p.lo, u_hi: p.hi, u_uneven: p.uneven };
      for (let i = 0; i < U.clamp(p.speed | 0, 0, 32); i++) {
        const nx = G.acquire(cur.w, cur.h, { clear: false });
        G.pass(SETTLE_STEP, nx, Object.assign(base(ctx, cur), u, { uStep: (ctx.frameNo * 32 + i) % 65536 }));
        if (cur !== state) G.release(cur);
        cur = nx;
      }
      if (p.feed > 0) { const nx = G.acquire(cur.w, cur.h, { clear: false }); G.pass(MIX2, nx, Object.assign(base(ctx, cur), { uIn: input.tex, uK: p.feed / 100 * 0.25 })); if (cur !== state) G.release(cur); cur = nx; }
      return cur;
    },
    out: (ctx, state) => copyRt(state),
  });

  // くずれ: every pixel is put through x → r·x·(1−x) again and again, lightly tied to its neighbours
  // (a coupled map lattice). r is read from the picture's own tones, so some regions come to rest, some
  // fall into a beat of two or four, and some never repeat — one picture sorted into the regimes of one map.
  const CHAOS_STEP = PRELUDE + `uniform sampler2D uIn; uniform float u_rlo, u_rhi, u_couple;
vec3 f(vec3 x, vec3 r){ return r * x * (1. - x); }
void main(){
  vec2 e = 1. / uRes; vec3 r = clamp(mix(u_rlo, u_rhi, dot(unp(texture(uIn, vUv)), LUM)) + vec3(0., .013, -.011), 0., 4.);
  vec3 c = f(texture(uTex, vUv).rgb, r);
  vec3 n = (f(texture(uTex, vUv + vec2(e.x, 0.)).rgb, r) + f(texture(uTex, vUv - vec2(e.x, 0.)).rgb, r) + f(texture(uTex, vUv + vec2(0., e.y)).rgb, r) + f(texture(uTex, vUv - vec2(0., e.y)).rgb, r)) * .25;
  o = vec4(clamp(mix(c, n, u_couple / 200.), 0., 1.), 1.);
}`;
  const CHAOS_INIT = PRELUDE + `void main(){ o = vec4(clamp(unp(smp(vUv)), .015, .985), 1.); }`;
  const CHAOS_FEED = PRELUDE + `uniform sampler2D uIn; uniform float uK; void main(){ o = vec4(mix(texture(uTex, vUv).rgb, clamp(unp(texture(uIn, vUv)), .015, .985), uK), 1.); }`;
  const CHAOS_OUT = PRELUDE + `uniform sampler2D uIn; uniform float u_amount; void main(){ vec4 i = texture(uIn, vUv); o = vec4(mix(unp(i), texture(uTex, vUv).rgb, u_amount / 100.) * i.a, i.a); }`;
  add('chaos', 'くずれ', 'うつろい', [
    PC('amount', '適用量', 100), N('rlo', '暗いところの r', 2.9, 1, 4, { step: 0.01 }), N('rhi', '明るいところの r', 3.95, 1, 4, { step: 0.01 }),
    PC('couple', 'となりとの結びつき', 30), N('iters', '1コマの回数', 2, 1, 8, { int: true }), PC('feed', 'もとの絵が戻る', 2),
  ], null, {
    process: true,
    init(ctx, input) { const o = G.acquire(input.w, input.h, { float: true, clear: false }); G.pass(CHAOS_INIT, o, base(ctx, input)); return o; },
    step(ctx, state, input, p) {
      let cur = state;
      const next = (fs, uni) => { const nx = G.acquire(cur.w, cur.h, { float: true, clear: false }); G.pass(fs, nx, Object.assign(base(ctx, cur), uni)); if (cur !== state) G.release(cur); cur = nx; };
      for (let i = 0; i < U.clamp(p.iters | 0, 1, 8); i++) next(CHAOS_STEP, { uIn: input.tex, u_rlo: p.rlo, u_rhi: p.rhi, u_couple: p.couple });
      if (p.feed > 0) next(CHAOS_FEED, { uIn: input.tex, uK: p.feed / 100 * 0.2 });
      return cur;
    },
    out(ctx, state, input, p) { const o = G.acquire(input.w, input.h, { clear: false }); G.pass(CHAOS_OUT, o, Object.assign(base(ctx, state), { uIn: input.tex, u_amount: p.amount })); return o; },
  });

  // こだま: the last frame is fed back under the new one, slightly moved. One small number, applied to itself.
  const ECHO_STEP = PRELUDE + `uniform sampler2D uIn; uniform float u_decay, u_scale, u_rot, u_hue, u_mode; uniform vec2 u_shift, u_center;
void main(){
  vec2 px = vUv * uRes - u_center, r = rot(-u_rot);
  px = vec2(r.x * px.x - r.y * px.y, r.y * px.x + r.x * px.y) / max(u_scale / 100., .01) - u_shift;
  vec4 s = smpT((px + u_center) / uRes) * (u_decay / 100.);
  if (u_hue != 0.) { vec3 h = rgb2hsv(unp(s)); h.x = fract(h.x + u_hue / 360.); s.rgb = hsv2rgb(h) * s.a; }
  vec4 i = texture(uIn, vUv);
  o = u_mode < .5 ? i + s * (1. - i.a) : u_mode < 1.5 ? s + i * (1. - s.a) : vec4(min(i.rgb + s.rgb, vec3(1.)), max(i.a, s.a));
}`;
  add('echo', 'こだま', 'うつろい', [
    PC('decay', '残る量', 90), N('scale', '広がり', 101.5, 80, 125, { step: 0.1, unit: '%' }), DEG('rot', 'ひねり', 0.4, { step: 0.1 }),
    { id: 'shift', name: 'ずれ', type: 'vec2', def: [0, 0], unit: 'px', px: true, step: 0.5 }, DEG('hue', '色のずれ', 4), EN('mode', '重ね方', ['うしろに残る', '前にかぶさる', '光として足す']),
    PT('center', '中心'), PX('room', 'はみ出す余白', 200, 0, 800),
  ], null, {
    process: true, pad: (p) => p.room,
    init: (ctx, input) => copyRt(input),
    step(ctx, state, input, p) {
      const nx = G.acquire(state.w, state.h, { clear: false });
      G.pass(ECHO_STEP, nx, Object.assign(base(ctx, state), { uIn: input.tex, u_decay: p.decay, u_scale: p.scale, u_rot: p.rot, u_hue: p.hue, u_mode: p.mode, u_shift: [p.shift[0] * ctx.rs, p.shift[1] * ctx.rs], u_center: ctx.toPx(p.center) }));
      return nx;
    },
    out: (ctx, state) => copyRt(state),
  });

  // たたむ: fold the plane over itself, turn it, enlarge it — and do that again to the result. The count can be
  // a fraction, so the picture passes smoothly from itself (0) into something much harder to take in.
  add('fold', 'たたむ', 'うつろい', [
    N('times', '回数', 2, 0, 10, { step: 0.01 }), DEG('angle', 'ひねり', 30), { id: 'offset', name: '折り目の位置', type: 'vec2', def: [25, 12], unit: '%', step: 0.5 },
    N('scale', '拡大', 1.15, 0.5, 2.5, { step: 0.01 }), PT('center', '中心'),
  ], `
  vec2 p = (vUv * uRes - u_center) / uLs.y, off = u_offset / 100., r = rot(u_angle);
  for (int i = 0; i < 10; i++) { float w = clamp(u_times - float(i), 0., 1.); if (w <= 0.) break;
    vec2 q = abs(p) - off; q = vec2(r.x * q.x - r.y * q.y, r.y * q.x + r.x * q.y) * u_scale; p = mix(p, q, w); }
  vec2 uv = (p * uLs.y + u_center - uL0) / uLs;
  o = smp((abs(mod(uv + 1., 2.) - 1.) * uLs + uL0) / uRes);`);

  // 走査: the picture redrawn as scan lines that are lifted by its own brightness and shaken by the sound's
  // actual waveform — the picture treated as a signal, in the line of the scan processors of the 1970s.
  add('raster', '走査', 'うつろい', [
    N('lines', '線の本数', 90, 8, 400, { int: true }), PX('lum', '明るさで持ち上がる', 40, -400, 400), PX('wave', '波形で揺れる', 30, 0, 400), PX('spec', 'スペクトルで持ち上がる', 0, 0, 400),
    PX('thick', '線の太さ', 1.8, 0.5, 30, { step: 0.1 }), BO('mono', '一色で描く'), COL('color', '線の色', '#f1ecdf'), PC('keep', 'もとの絵を残す', 0),
  ], `
  vec2 px = vUv * uRes, lp = px - uL0; float sp = uLs.y / max(u_lines, 2.), k0 = floor(lp.y / sp); vec4 acc = vec4(0.);
  for (int i = -10; i <= 10; i++) {
    float k = k0 + float(i); if (k < 0. || k >= u_lines) continue;
    float yk = (k + .5) * sp; vec4 c = smp((vec2(lp.x, yk) + uL0) / uRes);
    float x01 = lp.x / uLs.x, h = dot(c.rgb, LUM) * u_lum + (texture(uWave, vec2(fract(x01 + k * .137), .5)).r * 2. - 1.) * u_wave + texture(uWave, vec2(x01, .5)).g * u_spec;
    float a = 1. - smoothstep(u_thick * .5 - .75, u_thick * .5 + .75, abs(lp.y - (yk - h)));
    acc = max(acc, (u_mono > .5 ? vec4(u_color.rgb, 1.) * c.a : c) * a);
  }
  vec4 b = smp(vUv) * (u_keep / 100.);
  o = acc + b * (1. - acc.a);`, { pad: (p) => Math.abs(p.lum) + p.wave + p.spec, extra: 'uniform sampler2D uWave;', wave: true });

  // one-line descriptions for the picker
  FX.HINT = {
    melt: '絵が自分の明暗と輪郭に沿って流れ出す', settle: '画素が並べ替わりながら沈んでいく', chaos: '一つの写像を画素にくり返し、静止・点滅・混沌に分かれる', echo: '前のコマが少しずれて残り続ける',
    fold: '折って回して拡げる、をくり返す', raster: '走査線に描き直し、明るさと音の波形で揺らす',
    crumple: '紙のようにくしゃっと丸める', pins: 'ピンを打って、つまんで曲げる', flutter: '布や紙のようにはためかせる', outline: '切り抜きに白いふちをつける', paper: '紙の繊維のむらを足す',
    blur: 'やわらかくぼかす', glow: '明るいところをにじませる', shadow: '影を落とす', glitch: '信号が乱れたように崩す', turb: 'ゆらゆらと歪ませる',
    wave: '波打たせる', chroma: '特定の色を透明にする', wipe: '端から消していく', gradient: '2色のグラデーションを作る', fractal: '動く雲もようを作る',
  };
})();
