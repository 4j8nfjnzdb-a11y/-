// Sawari world: the design model (what is saved, undone and exported) and the
// simulation that turns space into time. Nothing here touches audio or the DOM:
// the simulation emits timed events and continuous states, the audio engine
// plays them, the renderer draws the same state at its own (possibly late) time.
const SAWARI_WORLD = (() => {
  const C = typeof SAWARI_CORE !== 'undefined' ? SAWARI_CORE : require('./core.js');
  const { clamp, lerp, TAU, hash01, noise1, uid, railGeom, railPoint, railNearest, makeRng } = C;

  const BOUNDS = { x0: -1600, x1: 1600, y0: -1000, y1: 1000 };
  const DT = 0.01;           // simulation step (s)
  const HIST = 256;          // flock position history (steps) for late drawing

  // ---- what space can say (law sources), each 0..1 ----
  const SOURCES = [
    { k: 'x', l: '横', d: '左右の位置' },
    { k: 'y', l: '縦', d: '上下の位置' },
    { k: 'size', l: '大きさ', d: '断片の大きさ' },
    { k: 'turn', l: '向き', d: '回転の角度（0° と 180° が両端）' },
    { k: 'shape', l: '形', d: '姿の種類と角の数' },
    { k: 'height', l: '高さ', d: '立体の高さ' },
    { k: 'near', l: '近さ', d: 'いちばん近いものとの距離（近いほど大きい）' },
    { k: 'crowd', l: '混み', d: 'まわりにあるものの数' },
    { k: 'center', l: '中心', d: '世界の中心への近さ' },
    { k: 'room', l: '奥', d: '部屋のどれだけ奥にいるか' },
    { k: 'motion', l: '動き', d: '断片そのものの速さ' },
    { k: 'force', l: '勢い', d: '鳴らしたもの（列車・波紋・群れ・指）の勢い' },
    { k: 'sway', l: '揺らぎ', d: '見えない、ゆっくりした波' },
    { k: 'chance', l: '偶然', d: '鳴るたびに変わる乱数' },
  ];
  // ---- what sound can do (law targets) ----
  // span: how far one law at full strength moves the value; base is the fragment's own setting
  const TARGETS = [
    { k: 'vol', l: '音量', u: 'dB', span: 18, min: -60, max: 12, d: '大きさ（dB）' },
    { k: 'rate', l: '速さ', u: '半音', span: 12, min: -36, max: 36, d: 'テープのように速さと高さが一緒に変わる' },
    { k: 'pitch', l: '音程', u: '半音', span: 12, min: -24, max: 24, d: '長さを保ったまま高さだけ変える' },
    { k: 'stretch', l: '伸縮', u: '倍', span: 2, min: -3, max: 3, d: '高さを保ったまま長さを変える（2 の累乗）' },
    { k: 'pan', l: '定位', u: '', span: 1, min: -1, max: 1, d: '左右' },
    { k: 'tone', l: '音色', u: '', span: 1, min: -1, max: 1, d: '負で暗く（ローパス）、正で細く（ハイパス）' },
    { k: 'start', l: '頭', u: '', span: 0.5, min: 0, max: 0.95, d: '断片のどこから鳴らすか' },
    { k: 'len', l: '長さ', u: '', span: 0.5, min: 0.02, max: 1, d: '断片のどこまで鳴らすか' },
    { k: 'grain', l: '粒', u: '', span: 0.5, min: 0, max: 1, d: '粒に砕く度合い' },
    { k: 'spray', l: '散', u: '', span: 0.5, min: 0, max: 1, d: '粒の位置と間隔のばらつき' },
    { k: 'rev', l: '逆', u: '', span: 0.5, min: 0, max: 1, d: '0.5 を超えると逆再生' },
    { k: 'drive', l: '歪', u: '', span: 0.5, min: 0, max: 1, d: '歪み' },
    { k: 'dly', l: '遠', u: '', span: 0.5, min: 0, max: 1, d: '世界のディレイへ送る量' },
    { k: 'verb', l: '響', u: '', span: 0.5, min: 0, max: 1, d: '世界の残響へ送る量' },
    { k: 'prob', l: '確率', u: '', span: 0.5, min: 0, max: 1, d: '鳴る確率（鳴らなくても見た目は反応する）' },
    { k: 'lag', l: 'ずれ', u: '秒', span: 0.5, min: 0, max: 2, d: '見た目の出来事から音が遅れる時間' },
  ];
  const TMAP = Object.fromEntries(TARGETS.map(t => [t.k, t]));
  const baseParams = () => ({ vol: 0, rate: 0, pitch: 0, stretch: 0, pan: 0, tone: 0, start: 0, len: 1, grain: 0, spray: 0.25, rev: 0, drive: 0, dly: 0, verb: 0.12, prob: 1, lag: 0, fin: 4, fout: 25 });

  // ---- skins: how a thing looks; `sv` is the hidden "shape" value a law can read ----
  const SKINS = [
    { k: 'poly', l: '多角', sv: 0.05, solid: false },
    { k: 'star', l: '星', sv: 0.14, solid: false },
    { k: 'blob', l: '塊', sv: 0.23, solid: false },
    { k: 'ring', l: '輪', sv: 0.32, solid: false },
    { k: 'cluster', l: '群点', sv: 0.41, solid: false },
    { k: 'glyph', l: '記号', sv: 0.5, solid: false },
    { k: 'strip', l: '帯', sv: 0.59, solid: false },
    { k: 'box', l: '箱', sv: 0.68, solid: true },
    { k: 'pillar', l: '柱', sv: 0.77, solid: true },
    { k: 'house', l: '家', sv: 0.86, solid: true },
    { k: 'tower', l: '塔', sv: 0.93, solid: true },
    { k: 'tree', l: '木', sv: 1.0, solid: true },
  ];
  const SKMAP = Object.fromEntries(SKINS.map(s => [s.k, s]));
  const TEXTURES = ['solid', 'hatch', 'dots', 'lines', 'outline', 'check'];
  const GLYPHS = ['※', '◎', '山', '門', '∴', '≋', '田', '品', '音', '〒', '♭', '§', '∞', '火', '水', '川', '回', '井', '◇', '¶'];
  const shapeValue = s => clamp((SKMAP[s.type] ? SKMAP[s.type].sv : 0.5) + ((s.sides || 5) - 6) * 0.012, 0, 1);

  function randomSkin(rng, prefer) {
    const type = prefer || SKINS[Math.floor(rng() * SKINS.length)].k;
    return {
      type, sides: 3 + Math.floor(rng() * 6), tex: TEXTURES[Math.floor(rng() * TEXTURES.length)],
      hue: Math.floor(rng() * 360), h: SKMAP[type] && SKMAP[type].solid ? Math.round(20 + rng() * (type === 'tower' ? 160 : 70)) : 0,
      glyph: GLYPHS[Math.floor(rng() * GLYPHS.length)], seed: Math.floor(rng() * 1e6),
    };
  }

  // ---- room effects: shared by the inspector and the audio engine ----
  const FX = {
    filter: { l: 'フィルター', p: { ftype: 'lowpass', freq: 1200, q: 2 } },
    drive: { l: '歪み', p: { amt: 0.5, tone: 4000, mix: 1 } },
    delay: { l: '反響', p: { time: 0.5, fb: 0.45, tone: 3000, mix: 0.4, sync: true } },
    verb: { l: '残響', p: { size: 3.5, damp: 0.5, mix: 0.5 } },
    crush: { l: '砕き', p: { bits: 5, mix: 1 } },
    wobble: { l: '揺れ', p: { rate: 0.6, depth: 0.5, fb: 0.3, mix: 0.5 } },
    ring: { l: '輪変調', p: { freq: 180, mix: 0.6 } },
    gate: { l: '刻み', p: { rate: 4, depth: 0.9, sync: true } },
  };
  const FX_ORDER = ['filter', 'drive', 'delay', 'verb', 'crush', 'wobble', 'ring', 'gate'];
  const newFx = type => ({ type, on: true, ...JSON.parse(JSON.stringify(FX[type].p)) });

  // ---- laws ----
  function defaultLaws() {
    return [
      { name: '甲', m: { 'size>vol': 0.3, 'size>rate': -0.45, 'x>pan': 0.8, 'y>tone': -0.45, 'turn>start': 0.7, 'near>verb': 0.6, 'crowd>grain': 0.55, 'force>vol': 0.35, 'motion>pitch': 0.5, 'height>rate': -0.4, 'chance>spray': 0.4, 'sway>tone': 0.2, 'room>len': -0.3 } },
      { name: '乙', m: { 'x>rate': 0.6, 'y>start': 0.8, 'size>stretch': 0.6, 'turn>pitch': 0.7, 'near>rev': 0.7, 'crowd>prob': -0.5, 'sway>pan': 0.9, 'chance>lag': 0.25, 'shape>grain': 0.7, 'force>drive': 0.5, 'center>dly': 0.7, 'height>verb': 0.6 } },
      { name: '丙', m: {} },
    ];
  }
  function randomLaw(rng, density = 0.035) {
    const m = {};
    for (const s of SOURCES) for (const t of TARGETS) if (rng() < density) m[s.k + '>' + t.k] = Math.round((rng() * 2 - 1) * 20) / 20;
    if (!Object.keys(m).length) m['x>pan'] = 0.7;
    return m;
  }

  // ---- factories ----
  function newFrag(src, a, b, x, y, rng, dur) {
    const len = b - a;
    return {
      id: uid('f'), kind: 'frag', src, a, b, x, y,
      r: Math.round(clamp(24 + 11 * Math.log2(1 + len) + rng() * 14, 14, 120)), ang: rng() * TAU,
      mode: 'hit', law: 0, mut: 0, group: null,
      skin: randomSkin(rng), p: baseParams(),
      move: { type: 'none', speed: 0.3, radius: 60, audible: true },
    };
  }
  function newThing(x, y, rng, type) {
    const skin = randomSkin(rng, type);
    return { id: uid('o'), kind: 'thing', x, y, r: Math.round(30 + rng() * 40), ang: rng() * TAU, skin, group: null };
  }
  const newRail = (pts, closed) => ({ id: uid('r'), kind: 'rail', pts, closed });
  const newTrain = (rail, s0) => ({ id: uid('t'), kind: 'train', rail, s0, speed: 140, cars: 2, reach: 60, end: 'bounce', sync: false, beats: 16 });
  const newRipple = (x, y) => ({ id: uid('w'), kind: 'ripple', x, y, period: 2.5, sync: true, beats: 4, speed: 240, reach: 520, phase: 0 });
  const newSweep = (x, y) => ({ id: uid('s'), kind: 'sweep', x, y, r: 320, period: 6, sync: true, beats: 8, dir: 1, ang0: -Math.PI / 2 });
  const newScan = (x, y, w, h) => ({ id: uid('c'), kind: 'scan', x, y, w, h, ang: 0, period: 8, sync: true, beats: 16, phase: 0 });
  const newFlock = (x, y) => ({ id: uid('b'), kind: 'flock', x, y, n: 4, speed: 110, wander: 0.5, mode: 'wander', leash: 420, quant: 0 });
  const newRoom = (x, y, w, h, fx) => ({ id: uid('m'), kind: 'room', x, y, w, h, walls: false, name: '', fx: fx || [newFx('verb')] });
  const newThread = (a, b) => ({ id: uid('l'), kind: 'thread', a, b, prob: 0.8, sync: false, beats: 1, mul: 1 });

  function newWorld(seed) {
    const rng = makeRng(seed);
    const rail = newRail(C.circlePts(-560, 40, 330, 36), true);
    const train = newTrain(rail.id, 0); train.cars = 2; train.speed = 130;
    const rip = newRipple(330, -250);
    const room = newRoom(470, 330, 560, 300, [newFx('delay'), newFx('verb')]); room.name = '響の間';
    room.fx[0].mix = 0.35; room.fx[1].mix = 0.55;
    const flock = newFlock(60, 40); flock.n = 3;
    const t1 = newThing(-80, 380, rng, 'tower'); t1.r = 34; t1.skin.h = 150;
    const t2 = newThing(820, -420, rng, 'tree'); t2.r = 40;
    return {
      v: 1, seed: seed >>> 0, bpm: 92, chance: 0.5, threadSpeed: 420, vlag: 0, tilt: 0.5,
      master: { vol: 0.8, dBeats: 0.75, dFb: 0.38, dTone: 3200, vSize: 3.4, vDamp: 0.45 },
      sources: [], objs: [room, rail, train, rip, flock, t1, t2], laws: defaultLaws(),
    };
  }

  // ---- simulation ----
  const mod = (a, n) => ((a % n) + n) % n;
  // fraction (0,1] of the step at which coordinate u crosses target + k*P, or -1
  function crossFrac(u0, u1, target, P) {
    if (u1 === u0) return -1;
    const k0 = Math.floor((u0 - target) / P), k1 = Math.floor((u1 - target) / P);
    if (k0 === k1) return -1;
    const b = Math.max(k0, k1) * P + target;
    return (b - u0) / (u1 - u0);
  }

  class Sim {
    constructor(world) { this.w = world; this.reset(); }
    reset() {
      this.T = 0; this.steps = 0;
      this.rng = makeRng((this.w.seed ^ 0x9e3779b9) >>> 0);
      this.flocks = new Map();      // flock id -> agents
      this.queue = [];              // pending thread events
      this.last = new Map();        // frag id -> last event time (retrigger guard)
      this.proj = new Map();        // rail id -> Map(frag id -> projection)
      this.poses = new Map();       // id -> sound pose at T
      this.prevPoses = new Map();
      this.index();
      this.updatePoses(0);
      this.prevPoses = new Map(this.poses);
    }
    // rebuild lookups; call after the object list changes (undo, load, add, delete)
    index() {
      const byId = new Map(), frags = [], things = [], rails = [], trains = [], ripples = [], sweeps = [], scans = [], flocks = [], rooms = [], threads = [];
      for (const o of this.w.objs) {
        byId.set(o.id, o);
        ({ frag: frags, thing: things, rail: rails, train: trains, ripple: ripples, sweep: sweeps, scan: scans, flock: flocks, room: rooms, thread: threads })[o.kind]?.push(o);
      }
      Object.assign(this, { byId, frags, things, rails, trains, ripples, sweeps, scans, flockObjs: flocks, rooms, threads });
      this.srcIds = new Set(this.w.sources.map(s => s.id));
      this.threadsFrom = new Map();
      for (const t of threads) { if (!this.threadsFrom.has(t.a)) this.threadsFrom.set(t.a, []); this.threadsFrom.get(t.a).push(t); }
      for (const fl of flocks) this.ensureFlock(fl);
      for (const id of [...this.flocks.keys()]) if (!byId.has(id)) this.flocks.delete(id);
    }
    beat() { return 60 / clamp(this.w.bpm || 92, 20, 300); }

    // ---- poses ----
    pose(f, T, forSound) {
      let x = f.x, y = f.y, ang = f.ang || 0, r = f.r;
      const m = f.move;
      if (m && m.type !== 'none' && (!forSound || m.audible)) {
        const sp = clamp(m.speed, 0, 1), R = m.radius || 0, ph = hash01(f.id) * TAU;
        if (m.type === 'spin') ang += T * (0.03 + sp * 1.2) * TAU * (m.dir || 1);
        else if (m.type === 'orbit') { const a = ph + TAU * T / lerp(40, 2.5, sp) * (m.dir || 1); x += Math.cos(a) * R; y += Math.sin(a) * R; }
        else if (m.type === 'drift') { const q = 0.04 + sp * 0.5; x += (noise1(f.id + 'x', T * q) - 0.5) * 2 * R; y += (noise1(f.id + 'y', T * q + 7) - 0.5) * 2 * R; ang += (noise1(f.id + 'a', T * q * 0.5) - 0.5) * 1.2; }
        else if (m.type === 'jitter') { const q = 3 + sp * 22; x += (noise1(f.id + 'x', T * q) - 0.5) * R * 0.4; y += (noise1(f.id + 'y', T * q + 3) - 0.5) * R * 0.4; ang += (noise1(f.id + 'a', T * q) - 0.5) * 0.5; }
        else if (m.type === 'breathe') r *= 1 + 0.45 * Math.sin(ph + TAU * T * (0.04 + sp * 0.9));
      }
      return { x, y, ang, r };
    }
    updatePoses(T) {
      const swap = this.prevPoses; this.prevPoses = this.poses; this.poses = swap; this.poses.clear();
      for (const f of this.frags) this.poses.set(f.id, this.pose(f, T, true));
      for (const t of this.things) this.poses.set(t.id, { x: t.x, y: t.y, ang: t.ang, r: t.r });
    }
    // recompute poses after an edit while time is not running
    refresh() { this.updatePoses(this.T); this.prevPoses = new Map(this.poses); }
    roomAt(x, y) {
      let best = null, area = Infinity;
      for (const m of this.rooms) {
        if (Math.abs(x - m.x) <= m.w / 2 && Math.abs(y - m.y) <= m.h / 2 && m.w * m.h < area) { best = m; area = m.w * m.h; }
      }
      return best;
    }

    // ---- what space says about a fragment (all 0..1) ----
    features(f, p, energy, atEvent) {
      const B = BOUNDS, T = this.T;
      const ft = {
        x: clamp((p.x - B.x0) / (B.x1 - B.x0), 0, 1),
        y: clamp((p.y - B.y0) / (B.y1 - B.y0), 0, 1),
        size: clamp((Math.log2(Math.max(p.r, 1)) - 3) / (Math.log2(240) - 3), 0, 1),
        turn: (1 - Math.cos(p.ang)) / 2,
        shape: shapeValue(f.skin),
        height: clamp((f.skin.h || 0) / 220, 0, 1),
      };
      let dmin = Infinity, crowd = 0;
      for (const [id, q] of this.poses) {
        if (id === f.id) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        const edge = d - p.r - q.r;
        if (edge < dmin) dmin = edge;
        if (edge < 160) crowd++;
      }
      ft.near = dmin === Infinity ? 0 : 1 - clamp(dmin / 260, 0, 1);
      ft.crowd = clamp(crowd / 6, 0, 1);
      ft.center = 1 - clamp(Math.hypot(p.x, p.y) / 1500, 0, 1);
      const rm = this.roomAt(p.x, p.y);
      ft.room = rm ? clamp(Math.min(p.x - (rm.x - rm.w / 2), rm.x + rm.w / 2 - p.x, p.y - (rm.y - rm.h / 2), rm.y + rm.h / 2 - p.y) / (Math.min(rm.w, rm.h) / 2), 0, 1) : 0;
      const pp = this.prevPoses.get(f.id);
      ft.motion = pp ? clamp((Math.hypot(p.x - pp.x, p.y - pp.y) + Math.abs(p.ang - pp.ang) * p.r * 0.5 + Math.abs(p.r - pp.r)) / DT / 220, 0, 1) : 0;
      ft.force = clamp(energy, 0, 1);
      ft.sway = 0.5 + 0.5 * Math.sin(hash01(f.id + 's') * TAU + TAU * T / (5 + 12 * hash01(f.id + 'p')));
      ft.chance = atEvent ? this.rng() : noise1(f.id + 'c', T * 0.6);
      ft._room = rm;
      return ft;
    }
    resolve(f, ft) {
      const b = f.p, law = f.law >= 0 ? this.w.laws[f.law] : null, P = {};
      const m = law ? law.m : null;
      for (const t of TARGETS) {
        let v = b[t.k] ?? 0;
        if (m) for (const s of SOURCES) { const a = m[s.k + '>' + t.k]; if (a) v += a * (ft[s.k] - 0.5) * 2 * t.span; }
        P[t.k] = clamp(v, t.min, t.max);
      }
      P.fin = b.fin; P.fout = b.fout;
      return P;
    }
    // full parameter picture for the inspector (no randomness consumed)
    probe(f) {
      const p = this.poses.get(f.id) || this.pose(f, this.T, true);
      const save = this.rng.get();
      const ft = this.features(f, p, 0.5, false);
      this.rng.set(save);
      return { ft, P: this.resolve(f, ft) };
    }

    // ---- activators, analytic in time so drawing can ask about any moment ----
    trainSpeed(tr) {
      const rail = this.byId.get(tr.rail); if (!rail) return 0;
      if (tr.sync) { const L = railGeom(rail).L; return (L / (Math.max(1, tr.beats) * this.beat())) * (tr.speed < 0 ? -1 : 1) * (rail.closed ? 1 : 2); }
      return tr.speed;
    }
    trainU(tr, T) { const rail = this.byId.get(tr.rail); const L = railGeom(rail).L; return tr.s0 * L + this.trainSpeed(tr) * T; }
    // unwrapped coordinate -> arc length on the rail (and travel direction sign)
    railS(rail, tr, u) {
      const L = railGeom(rail).L;
      if (rail.closed || tr.end === 'wrap') return { s: mod(u, L), d: 1 };
      const m = mod(u, 2 * L);
      return m <= L ? { s: m, d: 1 } : { s: 2 * L - m, d: -1 };
    }
    carGap() { return 50; }
    trainCars(tr, T) {
      const rail = this.byId.get(tr.rail);
      if (!rail || rail.pts.length < 2) return [];
      const u = this.trainU(tr, T), sg = this.trainSpeed(tr) < 0 ? -1 : 1, out = [];
      for (let j = 0; j < tr.cars; j++) {
        const { s, d } = this.railS(rail, tr, u - j * this.carGap() * sg);
        const p = railPoint(rail, s);
        out.push({ x: p.x, y: p.y, ang: p.ang + (d * sg < 0 ? Math.PI : 0) });
      }
      return out;
    }
    ripplePeriod(rp) { return Math.max(0.05, rp.sync ? rp.beats * this.beat() : rp.period); }
    rings(rp, T) {
      const per = this.ripplePeriod(rp), life = rp.reach / Math.max(1, rp.speed), out = [];
      const k1 = Math.floor(T / per - rp.phase), k0 = Math.max(0, Math.ceil((T - life) / per - rp.phase));
      for (let k = k0; k <= k1; k++) { const t0 = (k + rp.phase) * per; if (t0 < 0) continue; const r = (T - t0) * rp.speed; if (r >= 0 && r <= rp.reach) out.push({ r, a: 1 - r / rp.reach, k }); }
      return out;
    }
    sweepPeriod(sw) { return Math.max(0.1, sw.sync ? sw.beats * this.beat() : sw.period); }
    sweepAngle(sw, T) { return sw.ang0 + (sw.dir || 1) * TAU * T / this.sweepPeriod(sw); }
    scanPos(sc, T) { const per = this.sweepPeriod(sc); return -sc.w / 2 + sc.w * mod(T / per + (sc.phase || 0), 1); }

    // ---- flocks ----
    ensureFlock(fl) {
      let a = this.flocks.get(fl.id);
      const n = clamp(Math.round(fl.n), 0, 64);
      if (!a) { a = []; this.flocks.set(fl.id, a); }
      while (a.length < n) {
        const r = makeRng((hash01(fl.id + a.length) * 4294967296) >>> 0), ang = r() * TAU, d = r() * 60;
        a.push({ x: fl.x + Math.cos(ang) * d, y: fl.y + Math.sin(ang) * d, vx: Math.cos(ang + 1), vy: Math.sin(ang + 1), turn: 0, ins: new Set(), tgt: null, hx: new Float32Array(HIST), hy: new Float32Array(HIST), sp: 0.8 + r() * 0.4 });
      }
      if (a.length > n) a.length = n;
      return a;
    }
    agentAt(ag, T) {
      const k = Math.round(T / DT);
      if (k <= this.steps && k > this.steps - HIST + 2 && k >= 0) { const i = mod(k, HIST); return { x: ag.hx[i], y: ag.hy[i] }; }
      return { x: ag.x, y: ag.y };
    }
    stepFlock(fl, T0, dt, out, contacts) {
      const ags = this.ensureFlock(fl), rng = this.rng, n = ags.length;
      let cx = 0, cy = 0; for (const a of ags) { cx += a.x; cy += a.y; } if (n) { cx /= n; cy /= n; }
      const base = Math.max(5, fl.speed), wander = clamp(fl.wander, 0, 1);
      for (const a of ags) {
        let hx = a.vx, hy = a.vy;
        a.turn = a.turn * 0.94 + (rng() - 0.5) * wander * 0.9 * (0.5 + this.w.chance);
        const ca = Math.cos(a.turn * dt * 8), sa = Math.sin(a.turn * dt * 8);
        [hx, hy] = [hx * ca - hy * sa, hx * sa + hy * ca];
        let sx = 0, sy = 0;
        if (fl.mode === 'swarm' && n > 1) {
          sx += (cx - a.x) * 0.004; sy += (cy - a.y) * 0.004;
          for (const b of ags) { if (b === a) continue; const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy; if (d2 < 900 && d2 > 0) { sx += dx / d2 * 6; sy += dy / d2 * 6; } }
        } else if (fl.mode === 'seek' && this.frags.length) {
          if (!a.tgt || !this.byId.has(a.tgt) || rng() < 0.002 * (0.5 + this.w.chance)) a.tgt = this.frags[Math.floor(rng() * this.frags.length)].id;
          const q = this.poses.get(a.tgt);
          if (q) { const dx = q.x - a.x, dy = q.y - a.y, d = Math.hypot(dx, dy) || 1; sx += dx / d * 0.08; sy += dy / d * 0.08; if (d < q.r * 0.6) a.tgt = null; }
        }
        const lx = a.x - fl.x, ly = a.y - fl.y, ld = Math.hypot(lx, ly);
        if (ld > fl.leash) { sx -= lx / ld * 0.05 * (ld / fl.leash); sy -= ly / ld * 0.05 * (ld / fl.leash); }
        hx += sx; hy += sy;
        const hn = Math.hypot(hx, hy) || 1; hx /= hn; hy /= hn;
        a.vx = hx; a.vy = hy;
        const v = base * a.sp;
        let nx = a.x + hx * v * dt, ny = a.y + hy * v * dt;
        const B = BOUNDS;
        if (nx < B.x0 || nx > B.x1) { a.vx = -a.vx; nx = a.x; }
        if (ny < B.y0 || ny > B.y1) { a.vy = -a.vy; ny = a.y; }
        for (const m of this.rooms) {
          if (!m.walls) continue;
          const inO = Math.abs(a.x - m.x) <= m.w / 2 && Math.abs(a.y - m.y) <= m.h / 2;
          const inN = Math.abs(nx - m.x) <= m.w / 2 && Math.abs(ny - m.y) <= m.h / 2;
          if (inO !== inN) {
            if ((Math.abs(a.x - m.x) <= m.w / 2) !== (Math.abs(nx - m.x) <= m.w / 2)) a.vx = -a.vx;
            if ((Math.abs(a.y - m.y) <= m.h / 2) !== (Math.abs(ny - m.y) <= m.h / 2)) a.vy = -a.vy;
            nx = a.x; ny = a.y;
          }
        }
        a.x = nx; a.y = ny;
        // contacts
        const energy = clamp(v / 260, 0.1, 1);
        for (const f of this.frags) {
          const q = this.poses.get(f.id); if (!q) continue;
          const inside = Math.hypot(q.x - nx, q.y - ny) < q.r;
          const had = a.ins.has(f.id);
          if (inside && !had) {
            a.ins.add(f.id);
            if (f.mode !== 'tape') {
              let t = T0 + dt;
              if (fl.quant > 0) { const g = fl.quant * this.beat(); t = Math.ceil(t / g - 1e-9) * g; }
              out.push({ t, id: f.id, energy, via: 'flock', gen: 0 });
            }
          } else if (!inside && had) a.ins.delete(f.id);
          if (inside && f.mode === 'tape') contacts.push(this.tapeContact(f, q, nx, ny, a.vx * v, a.vy * v, T0 + dt, fl.id + ':' + ags.indexOf(a), energy));
        }
      }
    }
    tapeContact(f, q, x, y, vx, vy, t, key, energy) {
      const ax = Math.cos(q.ang), ay = Math.sin(q.ang);
      const lx = (x - q.x) * ax + (y - q.y) * ay;
      const along = vx * ax + vy * ay;
      return { t, id: f.id, key: f.id + '|' + key, pos: clamp((lx + q.r) / (2 * q.r), 0, 1), dir: along < 0 ? -1 : 1, energy, speed: Math.abs(along) };
    }

    // ---- one step: returns sound events; tape contacts in this.contacts ----
    step(dt = DT) {
      const T0 = this.T, T1 = T0 + dt, raw = [], contacts = [];
      this.T = T1; this.steps++;
      this.updatePoses(T1);
      const live = f => f && this.srcIds.has(f.src);

      // trains
      for (const tr of this.trains) {
        const rail = this.byId.get(tr.rail);
        if (!rail || rail.pts.length < 2) continue;
        const g = railGeom(rail), L = g.L, sp = this.trainSpeed(tr);
        if (!sp) continue;
        const bounce = !rail.closed && tr.end !== 'wrap', Pd = bounce ? 2 * L : L, sg = sp < 0 ? -1 : 1;
        let cache = this.proj.get(rail.id);
        if (!cache || cache.ver !== g.ver) { cache = { ver: g.ver, m: new Map() }; this.proj.set(rail.id, cache); }
        for (const f of this.frags) {
          if (!live(f)) continue;
          const q = this.poses.get(f.id);
          let pr = cache.m.get(f.id);
          if (!pr || Math.abs(pr.x - q.x) + Math.abs(pr.y - q.y) > 0.5) { const n = railNearest(rail, q.x, q.y); pr = { x: q.x, y: q.y, s: n.s, d: n.d }; cache.m.set(f.id, pr); }
          if (pr.d > tr.reach + q.r * 0.6) continue;
          if (f.mode === 'tape') continue;
          const targets = bounce ? [pr.s, 2 * L - pr.s] : [pr.s];
          for (let j = 0; j < tr.cars; j++) {
            const u0 = tr.s0 * L + sp * T0 - j * this.carGap() * sg, u1 = u0 + sp * dt;
            for (const tg of targets) {
              const fr = crossFrac(u0, u1, tg, Pd);
              if (fr >= 0) raw.push({ t: T0 + fr * dt, id: f.id, energy: clamp(Math.abs(sp) / 300, 0.15, 1) * (1 - 0.5 * pr.d / (tr.reach + q.r)), via: 'train', gen: 0, car: j });
            }
          }
        }
        // tape: cars passing over tape fragments read them
        const cars = this.trainCars(tr, T1);
        for (let j = 0; j < cars.length; j++) {
          const c = cars[j], vx = Math.cos(c.ang) * Math.abs(sp), vy = Math.sin(c.ang) * Math.abs(sp);
          for (const f of this.frags) {
            if (f.mode !== 'tape' || !live(f)) continue;
            const q = this.poses.get(f.id);
            if (Math.hypot(q.x - c.x, q.y - c.y) < q.r) contacts.push(this.tapeContact(f, q, c.x, c.y, vx, vy, T1, tr.id + ':' + j, clamp(Math.abs(sp) / 300, 0.15, 1)));
          }
        }
      }
      // ripples
      for (const rp of this.ripples) {
        const per = this.ripplePeriod(rp), life = rp.reach / Math.max(1, rp.speed);
        const k0 = Math.max(0, Math.ceil((T0 - life) / per - rp.phase - 1)), k1 = Math.floor(T1 / per - rp.phase);
        for (let k = k0; k <= k1; k++) {
          const tk = (k + rp.phase) * per; if (tk < 0) continue;
          for (const f of this.frags) {
            if (!live(f)) continue;
            const q = this.poses.get(f.id), d = Math.max(0, Math.hypot(q.x - rp.x, q.y - rp.y) - q.r * 0.7);
            if (d > rp.reach) continue;
            const th = tk + d / rp.speed;
            if (th > T0 && th <= T1) raw.push({ t: th, id: f.id, energy: clamp(1 - d / rp.reach, 0.12, 1), via: 'ripple', gen: 0 });
          }
        }
      }
      // radar sweeps
      for (const sw of this.sweeps) {
        const per = this.sweepPeriod(sw), dir = sw.dir || 1;
        for (const f of this.frags) {
          if (!live(f)) continue;
          const q = this.poses.get(f.id), d = Math.hypot(q.x - sw.x, q.y - sw.y);
          if (d > sw.r + q.r * 0.5 || d < 1) continue;
          const phi = Math.atan2(q.y - sw.y, q.x - sw.x);
          const base = dir * (sw.ang0 - phi) / TAU;
          const u0 = base + T0 / per, u1 = base + T1 / per;
          if (Math.floor(u1) > Math.floor(u0)) raw.push({ t: T0 + (Math.floor(u1) - u0) / (u1 - u0) * dt, id: f.id, energy: clamp(1 - 0.6 * d / sw.r, 0.2, 1), via: 'sweep', gen: 0 });
        }
      }
      // line scans
      for (const sc of this.scans) {
        const per = this.sweepPeriod(sc), ca = Math.cos(-sc.ang), sa = Math.sin(-sc.ang);
        for (const f of this.frags) {
          if (!live(f)) continue;
          const q = this.poses.get(f.id), dx = q.x - sc.x, dy = q.y - sc.y;
          const lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
          if (Math.abs(ly) > sc.h / 2 + q.r * 0.3 || Math.abs(lx) > sc.w / 2) continue;
          const off = (lx + sc.w / 2) / sc.w;
          const u0 = T0 / per + (sc.phase || 0) - off, u1 = T1 / per + (sc.phase || 0) - off;
          if (Math.floor(u1) > Math.floor(u0)) raw.push({ t: T0 + (Math.floor(u1) - u0) / (u1 - u0) * dt, id: f.id, energy: 0.6, via: 'scan', gen: 0 });
        }
      }
      // flocks
      for (const fl of this.flockObjs) {
        this.stepFlock(fl, T0, dt, raw, contacts);
        const ags = this.flocks.get(fl.id), i = mod(this.steps, HIST);
        if (ags) for (const a of ags) { a.hx[i] = a.x; a.hy[i] = a.y; }
      }
      // threads: pending propagation
      if (this.queue.length) {
        const keep = [];
        for (const q of this.queue) (q.t <= T1 ? raw : keep).push(q);
        this.queue = keep;
      }
      raw.sort((a, b) => a.t - b.t);
      const out = [];
      for (const r of raw) { const e = this.fire(r); if (e) out.push(e); }
      // tape contacts carry resolved parameters too
      this.contacts = [];
      for (const c of contacts) {
        const f = this.byId.get(c.id); if (!f) continue;
        const save = this.rng.get();
        const ft = this.features(f, this.poses.get(f.id), c.energy, false); this.rng.set(save);
        c.P = this.resolve(f, ft); c.room = ft._room ? ft._room.id : null;
        this.contacts.push(c);
      }
      return out;
    }
    // turn a raw trigger into a sound event (or a silent one), with chance, mutation and threads
    fire(r) {
      const f = this.byId.get(r.id);
      if (!f || f.kind !== 'frag' || !this.srcIds.has(f.src)) return null;
      const lt = this.last.get(f.id);
      if (lt !== undefined && r.t - lt < 0.035 && r.t >= lt) return null;
      this.last.set(f.id, r.t);
      const q = this.poses.get(f.id) || this.pose(f, r.t, true);
      const ft = this.features(f, q, r.energy, true);
      const P = this.resolve(f, ft);
      const sounds = this.rng() < P.prob;
      const e = { t: r.t, id: f.id, P, energy: r.energy, via: r.via, gen: r.gen || 0, room: ft._room ? ft._room.id : null, silent: !sounds, loop: f.mode === 'loop', from: r.from || null };
      if (sounds) {
        if (f.mut > 0 && this.rng() < f.mut * 0.3 * (0.4 + this.w.chance)) this.mutate(f);
        const ths = this.threadsFrom.get(f.id);
        if (ths && e.gen < 24) for (const th of ths) {
          if (this.rng() >= th.prob) continue;
          const b = this.byId.get(th.b); if (!b) continue;
          const qa = q, qb = this.poses.get(th.b) || b;
          const delay = th.sync ? Math.max(0.02, th.beats * this.beat()) : Math.max(0.02, Math.hypot(qb.x - qa.x, qb.y - qa.y) / Math.max(20, this.w.threadSpeed) * (th.mul || 1));
          this.queue.push({ t: r.t + delay, id: th.b, energy: r.energy * 0.92, via: 'thread', gen: e.gen + 1, from: f.id, t0: r.t, th: th.id });
        }
      }
      return e;
    }
    mutate(f) {
      const r = this.rng, c = 0.5 + this.w.chance;
      const kind = Math.floor(r() * 5);
      if (kind === 0) { f.x = clamp(f.x + (r() - 0.5) * 70 * c, BOUNDS.x0, BOUNDS.x1); f.y = clamp(f.y + (r() - 0.5) * 70 * c, BOUNDS.y0, BOUNDS.y1); }
      else if (kind === 1) f.ang += (r() - 0.5) * 1.4 * c;
      else if (kind === 2) f.skin.sides = clamp(f.skin.sides + (r() < 0.5 ? -1 : 1), 3, 9);
      else if (kind === 3) f.p.start = clamp(f.p.start + (r() - 0.5) * 0.25, 0, 0.9);
      else f.r = clamp(Math.round(f.r * (0.85 + r() * 0.3)), 10, 200);
      this.mutated = (this.mutated || 0) + 1;
    }
    // a direct touch from the person; t is world time
    manual(id, energy, t) {
      const f = this.byId.get(id);
      if (!f || f.kind !== 'frag') return null;
      const keepT = this.T; this.T = t;
      const e = this.fire({ t, id, energy, via: 'touch', gen: 0 });
      this.T = keepT;
      return e;
    }
    touchTape(id, x, y, vx, vy, t) {
      const f = this.byId.get(id); if (!f || !this.srcIds.has(f.src)) return null;
      const q = this.poses.get(f.id) || this.pose(f, this.T, true);
      const sp = Math.hypot(vx, vy);
      const c = this.tapeContact(f, q, x, y, vx, vy, t, 'touch', clamp(sp / 600, 0.15, 1));
      const save = this.rng.get(); const ft = this.features(f, q, c.energy, false); this.rng.set(save);
      c.P = this.resolve(f, ft); c.room = ft._room ? ft._room.id : null;
      return c;
    }
    // continuous voices: every loop fragment with its current parameters
    loopStates() {
      const out = [];
      const save = this.rng.get();
      for (const f of this.frags) {
        if (f.mode !== 'loop' || !this.srcIds.has(f.src)) continue;
        const ft = this.features(f, this.poses.get(f.id), 0.5, false);
        out.push({ id: f.id, f, P: this.resolve(f, ft), room: ft._room ? ft._room.id : null });
      }
      this.rng.set(save);
      return out;
    }
  }

  return { BOUNDS, DT, HIST, SOURCES, TARGETS, TMAP, SKINS, SKMAP, TEXTURES, GLYPHS, FX, FX_ORDER, newFx, baseParams, randomSkin, shapeValue, defaultLaws, randomLaw, newFrag, newThing, newRail, newTrain, newRipple, newSweep, newScan, newFlock, newRoom, newThread, newWorld, Sim, crossFrac };
})();
if (typeof module === 'object' && module.exports) module.exports = SAWARI_WORLD;
