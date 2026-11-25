// Kishimi collage: fragments cut from the sources and placed in depth.
//
// A fragment takes a rectangle out of one source (A, B, C, 地 = the mix, or
// 前 = the previous frame), cuts it to a shape, and places it on the screen
// at a position, size, angle and depth. Over its life it appears and
// disappears in one of thirteen ways, moves in one of eight, and its picture
// can play live, step in stop-motion, or be frozen at one moment.
//
// The dice never roll every property independently: that converges on the
// same uniform chaos every time. A roll first picks a rule (an arrangement, a
// main shape, a main way of appearing, ...) and then lets about a quarter of
// the fragments break it.
//
// Pure logic, no DOM or GL: tools/test.js runs parts of it in Node too.

function KishimiCollage() {
  const SHAPES = [['rect', '四角'], ['ellipse', '楕円'], ['torn', '破れ'], ['skew', '斜め'], ['bright', '明部'], ['dark', '暗部']];
  const APPEARS = [['none', 'そのまま'], ['fade', '溶ける'], ['wipe', '拭う'], ['iris', '開く'], ['grain', '粒'], ['grow', '伸びる'], ['scan', '走査'],
    ['drop', '落ちる'], ['glitch', 'ずれ'], ['focus', '焦点'], ['dots', '網'], ['flicker', '明滅'], ['blinds', '帯']];
  const LIVES = [['still', '常に'], ['once', '一度'], ['cycle', '巡る']];
  const MOVES = [['none', '静止'], ['drift', '漂う'], ['flow', '流れる'], ['spin', '回る'], ['sway', '揺れる'], ['pulse', '脈打つ'], ['pan', '中が動く'], ['push', '寄る']];
  const CONTENTS = [['live', '生'], ['step', 'コマ落とし'], ['frozen', '凍結']];
  const BLENDS = [['normal', '普通'], ['lighten', '明るい方'], ['darken', '暗い方'], ['diff', '差'], ['multiply', '乗算'], ['window', '窓'], ['lens', 'レンズ'], ['displace', '変位'], ['dots', '網']];
  const ARRS = [['scatter', '散らす'], ['grid', '格子'], ['joiner', '継ぎ'], ['strips', '帯'], ['ring', '環'], ['tunnel', '奥へ'], ['trail', '連なり'], ['pile', '山'], ['edges', '縁']];
  const SRC_INDEX = { a: 0, b: 1, c: 2, g: 3, fb: 4 };
  const code = (list, id) => Math.max(0, list.findIndex((x) => x[0] === id));
  const MAX = 16;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const bounce = (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; };
  const wrap = (v, m) => { const r = 1 + 2 * m; return ((((v + m) % r) + r) % r) - m; };

  function newFrag(id) {
    return { id, layer: id, src: 'a', rect: [.25, .25, .5, .5], shape: 'rect', feather: .01, key: .5,
      x: .5, y: .5, s: .4, rot: 0, z: .5, appear: 'iris', life: 'cycle', period: 8, phase: 0,
      move: 'none', speed: .5, content: 'live', step: .5, blend: 'normal', seed: (id * 7.31) % 10, born: 0 };
  }

  // the picture's own aspect for a fragment (width/height on screen)
  function aspectOf(f, ctx) {
    const d = ctx.dim(f.src) || [1, 1];
    return clamp((f.rect[2] * d[0]) / Math.max(1e-6, f.rect[3] * d[1]), .05, 20);
  }

  // a rectangle in the source with the wanted on-screen aspect
  function rectFor(fa, src, ctx, rng, big) {
    const d = ctx.dim(src) || [1, 1];
    let rh = big ? .5 + rng() * .45 : .22 + rng() * .5;
    let rw = rh * fa * d[1] / d[0];
    if (rw > .98) { rh *= .98 / rw; rw = .98; }
    if (rh > .98) { rw *= .98 / rh; rh = .98; }
    return [rng() * (1 - rw), rng() * (1 - rh), rw, rh];
  }
  // the source rectangle that a screen cell covers (cover fit), for 継ぎ
  function rectFromCell(cell, src, ctx) {
    const [x0, y0, x1, y1] = cell;
    if (src === 'g' || src === 'fb') return [x0, y0, x1 - x0, y1 - y0];
    const d = ctx.dim(src) || [ctx.asp, 1], sa = d[0] / d[1], ca = ctx.asp;
    let sx = 1, sy = 1; if (sa > ca) sx = ca / sa; else sy = sa / ca;
    return [(1 - sx) / 2 + x0 * sx, (1 - sy) / 2 + y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy];
  }

  // where N fragments go under each arrangement: x, y (0..1, y down), s (height
  // as a share of the screen), rot, z (0 near .. 1 far), fa (aspect) and, for
  // 継ぎ, the screen cell each fragment re-tiles
  function slots(arr, N, asp, rng) {
    const out = [], ph = rng() * 6.283;
    const g = () => { let u = 0; for (let i = 0; i < 4; i++) u += rng(); return (u - 2) / 1.15; };
    const pickFa = () => [.66, .75, 1, 1, 1.33, 1.5, 1.78][Math.floor(rng() * 7)];
    if (arr === 'grid' || arr === 'joiner') {
      const cols = Math.max(1, Math.round(Math.sqrt(N * asp))), rows = Math.ceil(N / cols), cw = 1 / cols, ch = 1 / rows;
      for (let k = 0; k < N; k++) {
        const c = k % cols, r = Math.floor(k / cols), cell = [c * cw, r * ch, (c + 1) * cw, (r + 1) * ch];
        const j = arr === 'joiner';
        out.push({ x: (c + .5) * cw + (j ? (rng() - .5) * cw * .12 : 0), y: (r + .5) * ch + (j ? (rng() - .5) * ch * .12 : 0),
          s: ch * (j ? 1.02 + rng() * .12 : .96), rot: (rng() - .5) * (j ? .16 : .04), z: rng() * (j ? .5 : .25), fa: (cw * asp) / ch, cell });
      }
    } else if (arr === 'strips') {
      for (let k = 0; k < N; k++) out.push({ x: (k + .5) / N, y: .5 + (rng() - .5) * .05, s: 1 + rng() * .06, rot: (rng() - .5) * .02, z: rng() * .3, fa: asp / N });
    } else if (arr === 'ring') {
      const R = .3 + rng() * .08;
      for (let k = 0; k < N; k++) { const a = ph + k / N * 6.283; out.push({ x: .5 + Math.cos(a) * R / asp, y: .5 + Math.sin(a) * R, s: .2 + rng() * .1, rot: a + 1.5708, z: rng() * .6, fa: pickFa() }); }
    } else if (arr === 'tunnel') {
      for (let k = 0; k < N; k++) { const t = N > 1 ? k / (N - 1) : 0, a = ph + k * .95, rad = (1 - t) * .38; out.push({ x: .5 + Math.cos(a) * rad / asp, y: .5 + Math.sin(a) * rad, s: .34, rot: k * .18, z: t, fa: pickFa() }); }
    } else if (arr === 'trail') {
      const flip = rng() < .5;
      for (let k = 0; k < N; k++) { const t = N > 1 ? k / (N - 1) : .5; out.push({ x: flip ? .88 - t * .76 : .12 + t * .76, y: .78 - t * .56 + Math.sin(t * 3.14159) * .12 * (flip ? -1 : 1), s: .3 + rng() * .06, rot: (t - .5) * .5 + (rng() - .5) * .1, z: t * .9, fa: pickFa() }); }
    } else if (arr === 'pile') {
      for (let k = 0; k < N; k++) out.push({ x: clamp(.5 + g() * .13 / asp * 1.4, .1, .9), y: clamp(.5 + g() * .12, .1, .9), s: .28 + rng() * .16, rot: (rng() - .5) * 1.1, z: rng(), fa: pickFa() });
    } else if (arr === 'edges') {
      for (let k = 0; k < N; k++) {
        const u = (k + rng() * .7) / N * 4, side = Math.floor(u) % 4, f = u - Math.floor(u), m = .1;
        const p = side === 0 ? [m + f * (1 - 2 * m), m] : side === 1 ? [1 - m, m + f * (1 - 2 * m)] : side === 2 ? [1 - m - f * (1 - 2 * m), 1 - m] : [m, 1 - m - f * (1 - 2 * m)];
        out.push({ x: p[0], y: p[1], s: .18 + rng() * .14, rot: (rng() - .5) * .35, z: rng(), fa: pickFa() });
      }
    } else { // scatter: best-candidate, so pieces spread without a grid
      for (let k = 0; k < N; k++) {
        let best = null, bd = -1;
        for (let c = 0; c < 14; c++) {
          const p = [.1 + rng() * .8, .1 + rng() * .8];
          let d = 9; for (const q of out) d = Math.min(d, Math.hypot((p[0] - q.x) * asp, p[1] - q.y));
          if (d > bd) { bd = d; best = p; }
        }
        out.push({ x: best[0], y: best[1], s: .2 + rng() * .32, rot: (rng() - .5) * .5, z: rng(), fa: pickFa() });
      }
    }
    return out;
  }
  const COUNT = { scatter: [4, 11], grid: [6, 16], joiner: [6, 16], strips: [4, 10], ring: [5, 10], tunnel: [6, 12], trail: [4, 9], pile: [5, 12], edges: [5, 12] };

  function weighted(rng, table) {
    let s = 0; for (const k in table) s += table[k];
    let r = rng() * s; for (const k in table) { r -= table[k]; if (r <= 0) return k; }
    return Object.keys(table)[0];
  }
  const W_SHAPE = { rect: 3, ellipse: 1, torn: 2, skew: 1, bright: 1.2, dark: 1 };
  const W_APPEAR = { fade: .6, wipe: 1.2, iris: 1.2, grain: 1, grow: 1, scan: 1, drop: 1, glitch: 1, focus: 1, dots: 1, flicker: .7, blinds: 1, none: .5 };
  const W_MOVE = { none: 2, drift: 2, flow: 1, spin: .6, sway: 1.2, pulse: .8, pan: 1.2, push: 1 };
  const W_BLEND = { lighten: 1, darken: 1, diff: 1, multiply: .8, window: 1.4, lens: .8, displace: .8, dots: .8 };
  const W_ARR = { scatter: 1.2, grid: 1, joiner: 1.3, strips: 1, ring: .8, tunnel: 1, trail: .9, pile: 1.1, edges: .8 };

  // roll the checked categories. state = { frags, arr, ground, depth, shadow, edge, cam },
  // ctx = { asp, dim(src) -> [w,h] | null, avail: ['a','b',...], cc }
  function roll(state, cats, ctx, rng = Math.random) {
    const R = rng, pick = (a) => a[Math.floor(R() * a.length)];
    const odd = (p = .25) => R() < p;
    if (cats.arr) state.arr = cats.arr;
    else if (cats.place || !state.arr) state.arr = weighted(R, W_ARR);
    const arr = state.arr;
    if (cats.count || !state.frags.length) {
      const [lo, hi] = COUNT[arr] || [4, 10];
      const N = Math.min(MAX, lo + Math.floor(R() * (hi - lo + 1)));
      while (state.frags.length > N) state.frags.pop();
      while (state.frags.length < N) state.frags.push(freshFrag(state));
    }
    const N = state.frags.length, sl = slots(arr, N, ctx.asp, R);
    const avail = ctx.avail.length ? ctx.avail : ['a'];
    // one rule per category, then outliers
    const mainSrc = pick(avail), second = pick(avail);
    const mainShape = arr === 'grid' || arr === 'joiner' ? 'rect' : weighted(R, W_SHAPE), mainAppear = weighted(R, W_APPEAR), mainMove = weighted(R, W_MOVE);
    const mainLife = weighted(R, { cycle: 5, once: 3, still: 2 });
    const blendRule = R() < .55 ? 'normal' : weighted(R, W_BLEND);
    const contentRule = weighted(R, { live: 5, mixed: 3, frozen: 2 });
    const period = 4 + R() * 12, speed = .2 + R() * .6, feather = R() < .5 ? .004 : .01 + R() * .06;
    state.frags.forEach((f, k) => {
      const s = sl[k];
      if (cats.src) f.src = arr === 'joiner' ? mainSrc : odd(.1) && ctx.hasMix ? pick(['g', 'fb']) : odd(.3) ? (odd(.5) ? second : pick(avail)) : mainSrc;
      if (cats.place) { f.x = s.x; f.y = s.y; f.rot = s.rot; }
      if (cats.size) f.s = s.s * (arr === 'grid' || arr === 'joiner' || arr === 'strips' ? 1 : .8 + R() * .4);
      if (cats.depth) f.z = s.z;
      if (cats.cut) {
        if (arr === 'joiner' && s.cell) f.rect = rectFromCell(s.cell, f.src, ctx);
        else f.rect = rectFor(cats.place ? s.fa : aspectOf(f, ctx), f.src, ctx, R, f.shape === 'bright' || f.shape === 'dark');
        f.key = .35 + R() * .3;
      }
      if (cats.shape) { f.shape = odd(arr === 'joiner' || arr === 'grid' ? .2 : .25) ? weighted(R, W_SHAPE) : mainShape; f.feather = odd() ? R() * .08 : feather; }
      if (cats.appear) {
        f.appear = odd() ? weighted(R, W_APPEAR) : mainAppear;
        f.life = odd(.15) ? weighted(R, { cycle: 1, once: 1, still: 1 }) : mainLife;
        f.period = period * (.7 + R() * .6); f.phase = R(); f.born = ctx.cc;
      }
      if (cats.motion) { f.move = odd() ? weighted(R, W_MOVE) : mainMove; f.speed = speed * (.6 + R() * .8); }
      if (cats.content) {
        f.content = contentRule === 'mixed' ? pick(['live', 'step', 'frozen']) : odd(.15) ? pick(['live', 'step', 'frozen']) : contentRule;
        f.step = .15 + R() * 1.2;
        f._hasCap = false; f._capAt = f.content === 'frozen' ? ctx.cc + R() * 2.5 : null;
      }
      if (cats.blend) f.blend = blendRule === 'normal' ? (odd(.12) ? weighted(R, W_BLEND) : 'normal') : (R() < .55 ? blendRule : 'normal');
      f.seed = R() * 10;
    });
    if (cats.ground) {
      state.ground = weighted(R, { mix: 5, black: 2, paper: 2 });
      state.shadow = R() < .6 ? .3 + R() * .6 : 0;
      state.edge = R() < .3 ? .2 + R() * .6 : 0;
      state.cam = R() < .5 ? R() * .8 : 0;
    }
    if (cats.depth && !cats.arr) { state.depth = .3 + R() * .65; state.haze = R() * .8; }
    return { arr, N: state.frags.length, shape: cats.shape && mainShape, appear: cats.appear && mainAppear, move: cats.motion && mainMove,
      blend: cats.blend && blendRule, content: cats.content && contentRule, life: cats.appear && mainLife };
  }
  function freshFrag(state) {
    const used = new Set(state.frags.map((f) => f.layer));
    let layer = 0; while (used.has(layer)) layer++;
    const ids = state.frags.map((f) => f.id);
    const f = newFrag(ids.length ? Math.max(...ids) + 1 : 0);
    f.layer = layer;
    return f;
  }

  // life: how far a fragment has appeared (p 0..1) at collage time cc
  function life(f, cc) {
    if (f.life === 'still' || f.appear === 'none') return { p: 1, cycle: 0 };
    const age = Math.max(0, cc - f.born);
    if (f.life === 'once') return { p: clamp(age / Math.max(.4, f.period * .25), 0, 1), cycle: 0 };
    const x = age / f.period + f.phase, cycle = Math.floor(x), ph = x - cycle;
    let p;
    if (ph < .2) p = easeOut(ph / .2);
    else if (ph < .68) p = 1;
    else if (ph < .86) p = 1 - easeIn((ph - .68) / .18);
    else p = 0;
    return { p, cycle };
  }

  // where a fragment is right now: motion, appearance geometry and depth
  function pose(f, cc, ctx, g) {
    let x = f.x, y = f.y, s = f.s, rot = f.rot;
    const rect = f.rect.slice(), v = f.speed, t = cc, sd = f.seed;
    switch (f.move) {
      case 'drift': x += (noise1(t * v * .25 + sd * 3) - .5) * .14; y += (noise1(t * v * .25 + sd * 3 + 40) - .5) * .14; rot += (noise1(t * v * .2 + sd + 80) - .5) * .25; break;
      case 'flow': { const a = sd * 6.283; x = wrap(x + Math.cos(a) * t * v * .05, .35); y = wrap(y + Math.sin(a) * t * v * .05, .35); break; }
      case 'spin': rot += t * v * .5 * (sd % 2 < 1 ? 1 : -1); break;
      case 'sway': rot += Math.sin(t * v * 1.6 + sd) * .14; x += Math.sin(t * v * .9 + sd) * .012; y += Math.sin(t * v * 1.3 + sd * 2) * .01; break;
      case 'pulse': s *= 1 + .16 * Math.sin(t * v * 2.2 + sd); break;
      case 'pan': {
        const [rx, ry, rw, rh] = rect;
        rect[0] = clamp(rx + Math.sin(t * v * .35 + sd) * Math.max(rw * .5, .05), 0, Math.max(0, 1 - rw));
        rect[1] = clamp(ry + Math.sin(t * v * .27 + sd * 2) * Math.max(rh * .5, .05), 0, Math.max(0, 1 - rh));
        break;
      }
      case 'push': { const k = .5 - .5 * Math.cos(t * v * .3 + sd), sc = 1 - .42 * k, [rx, ry, rw, rh] = rect; rect[0] = rx + rw * (1 - sc) / 2; rect[1] = ry + rh * (1 - sc) / 2; rect[2] = rw * sc; rect[3] = rh * sc; break; }
    }
    const L = life(f, cc), p = L.p;
    let alpha = p > 0 ? 1 : 0;
    if (p < 1) {
      if (f.appear === 'grow') s *= easeOut(p);
      else if (f.appear === 'drop') y -= (1 - bounce(p)) * 1.25;
      else if (f.appear === 'fade') alpha = p;
      else if (f.appear === 'focus') alpha = clamp(p / .35, 0, 1);
      else if (f.appear === 'flicker') {
        // like a tube starting: on-time grows with p; at most 2.5 flashes a second
        const dur = f.life === 'once' ? Math.max(.4, f.period * .25) : f.period * .2, k = clamp(Math.floor(dur * 2.5), 1, 6), u = p * k;
        alpha = p > 0 && u - Math.floor(u) < .25 + .75 * p ? 1 : 0;
      }
    }
    // depth: deeper is smaller, moves less with the camera, and is hazier (shader)
    const D = g.depth, z = f.z;
    s = s / (1 + 1.6 * D * z);
    if (g.cam > 0) { x += Math.sin(cc * .11) * .06 * g.cam * (1.25 - z) * D; y += Math.sin(cc * .083 + 1) * .04 * g.cam * (1.25 - z) * D; }
    return { x, y, s, rot, rect, p, alpha, cycle: L.cycle };
  }

  // everything the engine needs, far fragments first
  function frame(state, cc, ctx) {
    const recs = [];
    for (const f of state.frags) {
      const q = pose(f, cc, ctx, state);
      const fa = (q.rect[2] * (ctx.dim(f.src) || [1, 1])[0]) / Math.max(1e-6, q.rect[3] * (ctx.dim(f.src) || [1, 1])[1]);
      recs.push({ f, q, fa: clamp(fa, .05, 20) });
    }
    recs.sort((a, b) => b.f.z - a.f.z || a.f.id - b.f.id);
    return recs;
  }
  function pack(recs, ctx) {
    const n = Math.min(MAX, recs.length), F = new Float32Array(7 * MAX * 4);
    const put = (arr, i, a, b, c, d) => { const o = (arr * MAX + i) * 4; F[o] = a; F[o + 1] = b; F[o + 2] = c; F[o + 3] = d; };
    for (let i = 0; i < n; i++) {
      const { f, q, fa } = recs[i];
      const cx = q.x, cy = 1 - q.y, th = -q.rot, [rx, ry, rw, rh] = q.rect;
      const frozen = (f.content === 'frozen' || f.content === 'step') && f._hasCap;
      const d = ctx.dim(f.src) || [1, 1], texH = frozen ? 512 : (f.src === 'g' || f.src === 'fb' ? ctx.H : d[1]);
      const lod = Math.max(0, Math.log2(((frozen ? 1 : rh) * texH) / Math.max(1, q.s * ctx.H)));
      const hx = q.s * fa / 2, hy = q.s / 2, c = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
      const ex = c * hx + sn * hy + .06, ey = sn * hx + c * hy + .06;
      const wide = f.appear === 'glitch' && q.p < 1;
      put(0, i, cx, cy, q.s, th);
      put(1, i, rx, 1 - ry - rh, rw, rh);
      put(2, i, SRC_INDEX[f.src] ?? 0, code(SHAPES, f.shape), f.feather, code(BLENDS, f.blend));
      put(3, i, code(APPEARS, f.appear), q.p, q.alpha, f.z);
      put(4, i, fa, lod, f.key, f.seed);
      put(5, i, wide ? -1 : cx - ex / ctx.asp, cy - ey, wide ? 2 : cx + ex / ctx.asp, cy + ey);
      put(6, i, frozen ? f.layer : -1, 0, 0, 0);
    }
    return { n, F };
  }

  // the nearest fragment under a point (x, y in 0..1, y down)
  function hit(recs, x, y, asp) {
    const u = x, v = 1 - y;
    for (let i = recs.length - 1; i >= 0; i--) {
      const { q, fa } = recs[i]; if (q.alpha <= 0 && q.p <= 0) continue;
      const th = -q.rot, dx = (u - q.x) * asp, dy = v - (1 - q.y);
      const lx = (Math.cos(th) * dx + Math.sin(th) * dy) / (q.s * fa) + .5, ly = (-Math.sin(th) * dx + Math.cos(th) * dy) / q.s + .5;
      if (lx >= 0 && lx <= 1 && ly >= 0 && ly <= 1) return recs[i].f;
    }
    return null;
  }

  return { SHAPES, APPEARS, LIVES, MOVES, CONTENTS, BLENDS, ARRS, MAX, newFrag, freshFrag, slots, roll, life, pose, frame, pack, hit, aspectOf, rectFor, rectFromCell, clamp };
}
if (typeof module !== 'undefined') module.exports = KishimiCollage;
