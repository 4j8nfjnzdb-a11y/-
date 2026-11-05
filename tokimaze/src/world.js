// ---------------------------------------------------------------------------
// World: things that float on the liquid and are tracked on the CPU —
// soap bubbles (thin-film colour, drift, merge, coarsen, thin out and pop) and
// ice cubes (melt, drift, push meltwater). Plus the magnet under the dish.
// ---------------------------------------------------------------------------
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);

class World {
  constructor(liq) {
    this.liq = liq;
    this.bubbles = [];
    this.ice = [];
    this.mag = { on: false, x: 0, y: 0, s: 0 };
    this.convT = 0;
  }
  get aspect() { return this.liq.aspect; }

  // ---- bubbles -------------------------------------------------------
  spawnBubbles(x, y, n, spread, sizeK = 1) {
    for (let i = 0; i < n; i++) {
      if (this.bubbles.length >= SH.MAXB) {
        const old = this.bubbles.find(b => b.pop <= 0);
        if (old) this.pop(old, true); else break;
      }
      const a = rnd(Math.PI * 2), d = spread * Math.sqrt(Math.random());
      const r = Math.min(0.09, (0.008 + 0.034 * Math.pow(Math.random(), 1.8)) * sizeK);
      this.bubbles.push({
        x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r, vx: 0, vy: 0, life: 0, max: rnd(9, 46),
        seed: Math.random(), thick0: rnd(700, 1250), thick: 900, pop: 0, alpha: 0, press: 2.6,
      });
    }
  }
  bubbleAt(x, y) {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (b.pop <= 0 && (b.x - x) ** 2 + (b.y - y) ** 2 < b.r * b.r) return b;
    }
    return null;
  }
  pop(b, quiet = false) {
    if (b.pop > 0) return;
    b.pop = 1e-4;
    if (quiet) return;
    const p = [b.x, b.y];
    this.liq.splatVel(p, p, b.r * 1.4, [0, 0], 0.5 + b.r * 6, 0);
    this.liq.splatPaint(p, p, b.r * 0.9, null, 0, [0.15, 0.9, 0, 0], 0.5);
  }

  // ---- ice -------------------------------------------------------------
  addIce(x, y, size = 1) {
    if (this.ice.length >= SH.MAXI) this.ice.shift();
    const s0 = Math.min(0.11, rnd(0.045, 0.065) * size);
    this.ice.push({ x, y, s0, s: s0, rot: rnd(-0.6, 0.6), vr: rnd(-0.12, 0.12), vx: 0, vy: 0, melt: 0, T: rnd(38, 60), seed: rnd(100), alpha: 0, grab: null });
  }
  iceAt(x, y) {
    for (let i = this.ice.length - 1; i >= 0; i--) {
      const c = this.ice[i];
      if (Math.abs(c.x - x) < c.s * 1.25 && Math.abs(c.y - y) < c.s * 1.25) return c;
    }
    return null;
  }

  update(dt) {
    const liq = this.liq, A = this.aspect;
    // magnet
    const m = this.mag;
    m.s += ((m.on ? 1 : 0) - m.s) * (1 - Math.exp(-dt * (m.on ? 7 : 4)));
    liq.mag = [m.x, m.y, m.s > 0.004 ? m.s : 0, 0.0065];

    // bubbles
    const B = this.bubbles;
    for (const b of B) {
      b.life += dt;
      if (b.pop > 0) { b.pop += dt / 0.2; continue; }
      b.alpha = Math.min(1, b.alpha + dt * 5);
      if (b.life > b.max) { this.pop(b); continue; }
      const s = liq.sample(b.x, b.y);
      const k = 1 - Math.exp(-dt * 4);
      b.vx += (s[0] * 0.9 - b.vx) * k;
      b.vy += (s[1] * 0.9 - b.vy) * k;
      const f = Math.max(0, 1 - b.life / b.max);
      b.thick = 18 + b.thick0 * Math.pow(f, 0.85);
    }
    for (let i = 0; i < B.length; i++) {
      const a = B[i]; if (a.pop > 0) continue;
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j]; if (b.pop > 0) continue;
        let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1e-6, rs = a.r + b.r;
        if (d >= rs) continue;
        if (d < 0.32 * rs && Math.random() < dt * 3) {
          // merge: the bigger one swallows the other (area is kept)
          const [big, small] = a.r >= b.r ? [a, b] : [b, a];
          big.r = Math.min(0.12, Math.sqrt(big.r * big.r + small.r * small.r));
          small.pop = 1e-4; continue;
        }
        // packed foam: push apart, and gas seeps from the small one into the big one
        const ov = (rs * 0.94 - d); dx /= d; dy /= d;
        if (ov > 0) {
          const wa = b.r * b.r / (a.r * a.r + b.r * b.r), wb = 1 - wa;
          a.x -= dx * ov * wa * 0.5; a.y -= dy * ov * wa * 0.5;
          b.x += dx * ov * wb * 0.5; b.y += dy * ov * wb * 0.5;
        }
        const [big, small] = a.r >= b.r ? [a, b] : [b, a];
        const dr = dt * 0.00018 * (1 / small.r - 1 / big.r);
        small.r -= dr; big.r = Math.sqrt(big.r * big.r + 2 * small.r * dr);
        if (small.r < 0.005) small.pop = 1e-4;
      }
    }
    for (const b of B) {
      if (b.pop > 0) continue;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.3; }
      if (b.x > A - b.r) { b.x = A - b.r; b.vx = -Math.abs(b.vx) * 0.3; }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.3; }
      if (b.y > 1 - b.r) { b.y = 1 - b.r; b.vy = -Math.abs(b.vy) * 0.3; }
    }
    this.bubbles = B.filter(b => b.pop < 1);
    liq.setBubbles(this.bubbles.map(b => ({ x: b.x, y: b.y, r: b.r, life: b.life, seed: b.seed, thick: b.thick, pop: b.pop, alpha: b.alpha, press: b.press * b.alpha })));

    // ice
    this.convT += dt;
    const conv = this.convT > 0.22; if (conv) this.convT = 0;
    for (const c of this.ice) {
      c.melt = Math.min(1, c.melt + dt / c.T);
      c.alpha = c.melt >= 1 ? Math.max(0, c.alpha - dt * 0.8) : Math.min(1, c.alpha + dt * 4);
      c.s = c.s0 * Math.pow(1 - c.melt * 0.92, 0.75);
      if (c.grab) {
        c.vx = (c.grab[0] - c.x) / Math.max(dt, 1e-3); c.vy = (c.grab[1] - c.y) / Math.max(dt, 1e-3);
        c.x = c.grab[0]; c.y = c.grab[1];
      } else {
        const s = liq.sample(c.x, c.y), k = 1 - Math.exp(-dt * 0.9);
        c.vx += (s[0] * 0.6 - c.vx) * k; c.vy += (s[1] * 0.6 - c.vy) * k;
        c.x = Math.min(A - c.s, Math.max(c.s, c.x + c.vx * dt));
        c.y = Math.min(1 - c.s, Math.max(c.s, c.y + c.vy * dt));
      }
      c.rot += c.vr * dt;
      if (conv && c.alpha > 0.2 && c.melt < 1) {
        // cold meltwater sinks in fingers: small swirls around the edge
        const a = rnd(Math.PI * 2), d = c.s * rnd(1.0, 1.6);
        const p = [c.x + Math.cos(a) * d, c.y + Math.sin(a) * d];
        liq.splatVel(p, p, c.s * 0.5, [Math.cos(a) * 0.06, Math.sin(a) * 0.06], 0, rnd(-0.12, 0.12));
      }
    }
    this.ice = this.ice.filter(c => c.alpha > 0 || c.melt < 1);
    liq.setIce(this.ice.map(c => ({
      x: c.x, y: c.y, s: c.s, rot: c.rot, round: c.s * (0.16 + 0.7 * c.melt), h: 0.02 * Math.pow(1 - c.melt, 0.5) + 0.002,
      seed: c.seed, alpha: c.alpha, q: c.melt < 1 ? 0.9 * (0.35 + c.melt) * c.alpha : 0,
    })));
  }
}

// ---------------------------------------------------------------------------
// Tools. A stroke is {x,y,px,py,vx,vy,t,dist,swatch,size}; positions in domain
// units. The same functions serve fingers and the auto painter.
// ---------------------------------------------------------------------------
const TOOLS = {
  paint: {
    name: '垂らす', hint: '押すと絵具が落ちて広がる。押し続けると注ぎ続け、なぞると線になる。',
    begin(app, s) { app.drop(s, 2.6, 0.032); },
    hold(app, s, dt) { app.drop(s, 7 * dt, 0.028 * (1 + 0.2 * Math.min(s.t, 3)), dt); },
    move(app, s, dt) {
      const d = Math.hypot(s.x - s.px, s.y - s.py);
      app.trail(s, Math.min(1.6, d * 30), 0.018);
      app.liq.splatVel([s.px, s.py], [s.x, s.y], 0.03 * s.size, [s.vx * 0.3, s.vy * 0.3]);
    },
  },
  stir: {
    name: '混ぜる', hint: 'なぞった方へ液体が流れる。速く動かすと渦が生まれる。',
    move(app, s) { app.liq.splatVel([s.px, s.py], [s.x, s.y], 0.042 * s.size, [s.vx * 0.9, s.vy * 0.9]); },
  },
  comb: {
    name: '櫛', hint: '七本の歯で引く。墨流しのように縞が並ぶ。',
    move(app, s) {
      const l = Math.hypot(s.vx, s.vy); if (l < 1e-4) return;
      const nx = -s.vy / l, ny = s.vx / l, gap = 0.034 * s.size;
      for (let k = -3; k <= 3; k++) {
        const ox = nx * gap * k, oy = ny * gap * k;
        app.liq.splatVel([s.px + ox, s.py + oy], [s.x + ox, s.y + oy], 0.0075 * s.size, [s.vx * 1.15, s.vy * 1.15]);
      }
    },
  },
  alcohol: {
    name: 'アルコール', hint: '絵具を押しのけて穴を開け、枝分かれして広がる。色を選ぶとアルコールインクになる。',
    begin(app, s) { app.alcohol(s, 1, 0.03); },
    hold(app, s, dt) { app.alcohol(s, 1.6 * dt, 0.022, dt); },
    move(app, s) { const d = Math.hypot(s.x - s.px, s.y - s.py); app.alcohol(s, Math.min(1, d * 12), 0.015, 0, true); },
  },
  bubble: {
    name: '泡', hint: '泡を浮かべる。泡は絵具を押しのけ、薄くなって弾ける。泡を押すと割れる。',
    begin(app, s) {
      const b = app.world.bubbleAt(s.x, s.y);
      if (b) { s.popping = true; app.world.pop(b); return; }
      app.world.spawnBubbles(s.x, s.y, Math.round(7 + 7 * s.size), 0.045 * s.size, s.size);
      app.liq.splatPaint([s.x, s.y], [s.x, s.y], 0.05 * s.size, null, 0, [0.35, 0.5, 0, 0], 0.3);
      s.acc = 0;
    },
    move(app, s) {
      if (s.popping) { const b = app.world.bubbleAt(s.x, s.y); if (b) app.world.pop(b); return; }
      s.acc = (s.acc || 0) + Math.hypot(s.x - s.px, s.y - s.py);
      while (s.acc > 0.03) { s.acc -= 0.03; app.world.spawnBubbles(s.x, s.y, 2, 0.015, s.size * 0.8); }
    },
  },
  ice: {
    name: '氷', hint: '氷を置く。溶けた水が絵具を押しのけ、冷たい筋が流れる。氷はつかんで動かせる。',
    begin(app, s) {
      const c = app.world.iceAt(s.x, s.y);
      if (c) { s.ice = c; c.grab = [s.x, s.y]; return; }
      app.world.addIce(s.x, s.y, s.size);
    },
    move(app, s) { if (s.ice) { s.ice.grab = [s.x, s.y]; app.liq.splatVel([s.px, s.py], [s.x, s.y], s.ice.s * 1.2, [s.vx * 0.5, s.vy * 0.5]); } },
    end(app, s) { if (s.ice) s.ice.grab = null; },
  },
  magnet: {
    name: '磁石', hint: '皿の下から磁石を当てる。磁性流体が寄ってきて棘が立つ。先に磁性流体を垂らしておく。',
    begin(app, s) { const m = app.world.mag; m.on = true; m.x = s.x; m.y = s.y; },
    move(app, s) { const m = app.world.mag; m.x = s.x; m.y = s.y; },
    end(app) { app.world.mag.on = false; },
  },
};

// ---------------------------------------------------------------------------
// Auto painter: when nobody is touching, it keeps the dish alive with the same
// tools a hand would use — pours, concentric drops, alcohol, stirs, combs,
// bubbles, a magnet sweep, an ice cube now and then.
// ---------------------------------------------------------------------------
class AutoPainter {
  constructor(app) { this.app = app; this.on = true; this.wait = 0.4; this.idle = 0; this.gest = []; this.recent = []; }
  touch() { this.idle = 0; }
  update(dt, userActive) {
    if (userActive) this.idle = 0; else this.idle += dt;
    for (const g of this.gest) this._advance(g, dt);
    this.gest = this.gest.filter(g => !g.done);
    if (!this.on || this.idle < 3.5) return;
    this.wait -= dt;
    if (this.wait <= 0 && this.gest.length < 2) { this.wait = rnd(1.1, 3.6); this._launch(); }
  }
  _pt(m = 0.12) { const A = this.app.liq.aspect; return [rnd(m * Math.min(A, 1), A - m * Math.min(A, 1)), rnd(m, 1 - m)]; }
  _color() {
    const cols = this.app.colorSwatches();
    let i; do { i = Math.floor(Math.random() * cols.length); } while (this.recent.includes(i) && cols.length > 3 && Math.random() < 0.85);
    this.recent.push(i); if (this.recent.length > 2) this.recent.shift();
    return cols[i];
  }
  _go(tool, swatch, path, dur, size = 1) { this.gest.push({ tool, swatch, path, dur, t: 0, size, s: null }); }
  _launch() {
    const A = this.app.liq.aspect, w = this.app.world;
    const pick = Math.random();
    const hasFerro = this.app.ferroUsed;
    if (pick < 0.3) {
      const p = this._pt(); this._go('paint', this._color(), () => p, rnd(0.2, 1.6), rnd(0.8, 1.5));
    } else if (pick < 0.42) {
      // concentric drops, one into the other
      const p = this._pt(0.2), n = 2 + Math.floor(rnd(3));
      for (let i = 0; i < n; i++) setTimeout(() => this._go('paint', this._color(), () => p, rnd(0.35, 0.8), rnd(0.8, 1.3)), i * 650);
    } else if (pick < 0.56) {
      const p = this._pt(0.15);
      if (Math.random() < 0.35) {
        const q = this._pt(0.15); this._go('alcohol', Math.random() < 0.5 ? this._color() : this.app.waterSwatch(), t => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], rnd(0.8, 1.6));
      } else this._go('alcohol', Math.random() < 0.6 ? this._color() : this.app.waterSwatch(), () => p, rnd(0.1, 0.7), rnd(0.8, 1.4));
    } else if (pick < 0.74) {
      const c = this._pt(0.25), r = rnd(0.08, 0.28), a0 = rnd(6.28), turn = rnd(1.2, 4) * (Math.random() < 0.5 ? -1 : 1);
      this._go('stir', null, t => [c[0] + Math.cos(a0 + turn * t) * r * (1 - 0.4 * t), c[1] + Math.sin(a0 + turn * t) * r * (1 - 0.4 * t)], rnd(1.0, 2.4), rnd(0.8, 1.4));
    } else if (pick < 0.8) {
      const horiz = Math.random() < 0.5, y = rnd(0.3, 0.7), x = rnd(0.3, 0.7) * A, dir = Math.random() < 0.5 ? -1 : 1;
      this._go('comb', null, t => horiz ? [A * (dir > 0 ? 0.08 + 0.84 * t : 0.92 - 0.84 * t), y] : [x, dir > 0 ? 0.08 + 0.84 * t : 0.92 - 0.84 * t], rnd(1.6, 2.6), rnd(0.7, 1.1));
    } else if (pick < 0.88) {
      const p = this._pt(0.2); this._go('bubble', null, () => p, 0.05, rnd(0.7, 1.3));
    } else if (pick < 0.95) {
      if (!hasFerro) { const p = this._pt(0.25); this._go('paint', this.app.ferroSwatch(), () => p, rnd(0.6, 1.1), 1); }
      else {
        const c = this._pt(0.3), r = rnd(0.05, 0.18), a0 = rnd(6.28);
        this._go('magnet', null, t => [c[0] + Math.cos(a0 + t * 5) * r, c[1] + Math.sin(a0 + t * 5) * r], rnd(2.5, 4.5));
      }
    } else if (w.ice.length < 2) {
      const p = this._pt(0.2); this._go('ice', null, () => p, 0.05, rnd(0.8, 1.2));
    }
  }
  _advance(g, dt) {
    const app = this.app, T = TOOLS[g.tool];
    g.t += dt;
    const u = Math.min(1, g.t / g.dur), [x, y] = g.path(u);
    if (!g.s) {
      g.s = { x, y, px: x, py: y, vx: 0, vy: 0, t: 0, swatch: g.swatch, size: g.size, auto: true };
      app.focusOn(x, y);
      T.begin && T.begin(app, g.s);
      return;
    }
    const s = g.s;
    s.px = s.x; s.py = s.y; s.x = x; s.y = y; s.t += dt;
    s.vx = (s.x - s.px) / Math.max(dt, 1e-3); s.vy = (s.y - s.py) / Math.max(dt, 1e-3);
    if (Math.hypot(s.x - s.px, s.y - s.py) > 1e-4) T.move && T.move(app, s, dt);
    else T.hold && T.hold(app, s, dt);
    if (u >= 1) { T.end && T.end(app, s); g.done = true; }
  }
}
