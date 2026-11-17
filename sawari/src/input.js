// Sawari input: tools, pointer and keyboard, hit testing, drop, the frame loop, boot.
const canvas = $('world');
const R = new D.Renderer(canvas);
const TOOLS = {
  select: { k: 'v', l: '選', n: '選ぶ・動かす', hint: 'クリックで選ぶ／ドラッグで動かす（Alt で複製）／空いた所をドラッグで囲む／丸い取っ手で回し、四角で大きさ' },
  touch: { k: 'f', l: '触', n: '触れて鳴らす', hint: '断片に触れると鳴ります。なぞると次々に。帯の断片はなぞった場所と向きで読まれます' },
  rail: { k: 'r', l: '線', n: '線路を敷く', hint: 'ドラッグで自由に描く／クリックで点を打ち、ダブルクリックか Enter で終える／Shift+ドラッグで円' },
  train: { k: 't', l: '車', n: '列車を置く', hint: '線路の上をクリックで列車を足す。何もない所なら小さな環状線ごと置く' },
  ripple: { k: 'p', l: '波', n: '波紋を置く', hint: 'クリックで波紋の源を置く。輪が届くまでの距離が、そのまま時間になります' },
  sweep: { k: 's', l: '掃', n: '掃引を置く', hint: 'クリックで回る針（円＝反復）／ドラッグで走査線の枠（直線の時間）' },
  flock: { k: 'd', l: '群', n: '群れを放つ', hint: 'クリックで群れを放つ。勝手に飛び回り、入った断片を鳴らします' },
  room: { k: 'b', l: '室', n: '部屋を建てる', hint: 'ドラッグで部屋を建てる。中にある断片の音は部屋の加工を通ります' },
  thread: { k: 'w', l: '糸', n: '糸を張る', hint: '断片から断片へドラッグ。前が鳴ると、糸の長さぶん遅れて後ろが鳴ります' },
  thing: { k: 'o', l: '物', n: '物を置く', hint: 'クリックで音のない物を置く。まわりの断片の「近さ」「混み」を変えます' },
  hand: { k: 'h', l: '手', n: '見る場所を動かす', hint: 'ドラッグで見る場所を動かす。二本指のスクロールでも、⌘ / ピンチで拡大縮小' },
};
let drag = null, draft = null, spaceDown = false, lastPtr = { x: 0, y: 0 };
const visT = () => (S.playing && ctx ? ctx.currentTime - S.t0 : S.T) - (world.vlag || 0);

function setTool(t) {
  S.tool = t; draft = null;
  document.querySelectorAll('#tools button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  $('hint').textContent = TOOLS[t].hint;
  canvas.dataset.tool = t;
}
function buildTools() {
  const box = $('tools');
  for (const [k, t] of Object.entries(TOOLS)) {
    box.append(el('button', { type: 'button', 'data-tool': k, title: `${t.n}（${t.k.toUpperCase()}）`, onclick: () => setTool(k) }, el('b', null, t.l), el('small', null, t.k.toUpperCase())));
  }
}

// ---------- geometry ----------
function ptr(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
const W2 = (p, h = 0) => view.toWorld(p.x, p.y, h);
const scr = (x, y, h = 0) => ({ x: view.sx(x), y: view.sy(y, h) });
const sdist = (p, x, y, h = 0) => Math.hypot(p.x - view.sx(x), p.y - view.sy(y, h));
function handles(o) {
  const z = view.z;
  if (o.kind === 'frag' || o.kind === 'thing') {
    const a = o.ang - Math.PI / 2, d = o.r + 28 / z;
    return { rot: { x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d }, size: { x: o.x + o.r * 0.72, y: o.y + o.r * 0.72 } };
  }
  if (o.kind === 'room') return { corners: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: o.x + i * o.w / 2, y: o.y + j * o.h / 2, i, j })) };
  if (o.kind === 'scan') { const ca = Math.cos(o.ang), sa = Math.sin(o.ang); return { corners: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: o.x + (i * o.w / 2) * ca - (j * o.h / 2) * sa, y: o.y + (i * o.w / 2) * sa + (j * o.h / 2) * ca, i, j })) }; }
  if (o.kind === 'sweep') return { arm: { x: o.x + Math.cos(o.ang0) * o.r, y: o.y + Math.sin(o.ang0) * o.r } };
  if (o.kind === 'ripple') return { reach: { x: o.x + o.reach, y: o.y } };
  return {};
}
function fragUnder(p, Tv, list) {
  const out = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i], q = f.kind === 'frag' ? sim.pose(f, Tv, false) : f, h = f.skin.h || 0;
    const hs = h > 0 ? [0, h * 0.5, h] : [0];
    for (const hh of hs) { const w = W2(p, hh); if (Math.hypot(w.x - q.x, w.y - q.y) <= q.r * 0.95 + 4 / view.z) { out.push({ f, q }); break; } }
  }
  out.sort((a, b) => b.q.y - a.q.y);
  return out.map(x => x.f);
}
function hitTest(p) {
  const Tv = visT();
  if (S.sel.size === 1) {
    const o = selObjs()[0];
    if (o) {
      const hd = handles(o);
      if (hd.rot && sdist(p, hd.rot.x, hd.rot.y) < 10) return { o, part: 'rot' };
      if (hd.size && sdist(p, hd.size.x, hd.size.y) < 10) return { o, part: 'size' };
      if (hd.corners) for (let i = 0; i < 4; i++) if (sdist(p, hd.corners[i].x, hd.corners[i].y) < 10) return { o, part: 'corner', i };
      if (hd.arm && sdist(p, hd.arm.x, hd.arm.y) < 10) return { o, part: 'arm' };
      if (hd.reach && sdist(p, hd.reach.x, hd.reach.y) < 10) return { o, part: 'reach' };
      if (o.kind === 'rail') for (let i = 0; i < o.pts.length; i++) if (sdist(p, o.pts[i][0], o.pts[i][1]) < 8) return { o, part: 'vertex', i };
    }
  }
  const stand = fragUnder(p, Tv, [...sim.frags, ...sim.things]);
  if (stand.length) return { o: stand[0] };
  for (const tr of sim.trains) for (const c of sim.trainCars(tr, Tv)) if (sdist(p, c.x, c.y, 6) < 16) return { o: tr };
  for (const fl of sim.flockObjs) {
    if (sdist(p, fl.x, fl.y) < 11) return { o: fl };
    for (const a of sim.flocks.get(fl.id) || []) { const q = sim.agentAt(a, Tv); if (sdist(p, q.x, q.y, 26) < 9) return { o: fl }; }
  }
  for (const r of sim.ripples) if (sdist(p, r.x, r.y) < 13) return { o: r };
  for (const s of sim.sweeps) if (sdist(p, s.x, s.y) < 11) return { o: s };
  for (const th of sim.threads) {
    const a = sim.byId.get(th.a), b = sim.byId.get(th.b); if (!a || !b) continue;
    const pa = sim.pose(a, Tv, false), pb = sim.pose(b, Tv, false), mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2 + Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.18;
    for (let k = 1; k < 20; k++) { const t = k / 20, x = (1 - t) * (1 - t) * pa.x + 2 * (1 - t) * t * mx + t * t * pb.x, y = (1 - t) * (1 - t) * pa.y + 2 * (1 - t) * t * my + t * t * pb.y; if (sdist(p, x, y) < 7) return { o: th }; }
  }
  const w = W2(p);
  for (const r of sim.rails) { const n = C.railNearest(r, w.x, w.y); if (n.d * view.z < 9) return { o: r }; }
  for (const s of sim.scans) {
    const ca = Math.cos(-s.ang), sa = Math.sin(-s.ang), dx = w.x - s.x, dy = w.y - s.y, lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
    const ex = Math.abs(Math.abs(lx) - s.w / 2) * view.z, ey = Math.abs(Math.abs(ly) - s.h / 2) * view.z;
    if ((ex < 7 && Math.abs(ly) <= s.h / 2) || (ey < 7 && Math.abs(lx) <= s.w / 2)) return { o: s };
    const bx = sim.scanPos(s, Tv); if (Math.abs(lx - bx) * view.z < 6 && Math.abs(ly) <= s.h / 2) return { o: s };
  }
  for (const m of [...sim.rooms].sort((a, b) => a.w * a.h - b.w * b.h)) {
    const x0 = m.x - m.w / 2, x1 = m.x + m.w / 2, y0 = m.y - m.h / 2, y1 = m.y + m.h / 2, h = m.walls ? 46 : 26;
    for (const hh of [0, h]) {
      const q = W2(p, hh);
      const nearX = (Math.abs(q.x - x0) * view.z < 7 || Math.abs(q.x - x1) * view.z < 7) && q.y >= y0 && q.y <= y1;
      const nearY = (Math.abs(q.y - y0) * view.z < 7 || Math.abs(q.y - y1) * view.z < 7) && q.x >= x0 && q.x <= x1;
      if (nearX || nearY) return { o: m };
    }
    const lx = view.sx(x0), ly = view.sy(y0, h);
    if (p.x >= lx && p.x <= lx + 160 && p.y >= ly - 22 && p.y <= ly) return { o: m };
  }
  return null;
}
function roomInside(p) { const w = W2(p); return sim.roomAt(w.x, w.y); }

// ---------- pointer ----------
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const p = ptr(e); lastPtr = p;
  if (e.button === 1 || e.button === 2 || spaceDown || S.tool === 'hand') { drag = { kind: 'pan', p0: p, x: view.x, y: view.y }; canvas.classList.add('panning'); return; }
  const w = W2(p), T = S.tool;
  if (T === 'select') {
    const hit = hitTest(p);
    if (hit && hit.part) { drag = { kind: 'handle', hit, p0: p, w0: w, orig: C.deepClone(hit.o) }; return; }
    if (hit) {
      if (e.shiftKey && S.sel.has(hit.o.id)) { S.sel.delete(hit.o.id); renderInspector(); return; }
      if (!S.sel.has(hit.o.id)) select([hit.o.id], e.shiftKey);
      if (e.altKey) duplicateSel();
      drag = { kind: 'move', p0: p, w0: w, moved: false, items: selObjs().map(o => ({ o, x: o.x, y: o.y, pts: o.pts ? o.pts.map(q => q.slice()) : null })) };
      return;
    }
    drag = { kind: 'marquee', p0: p, p1: p, add: e.shiftKey };
    return;
  }
  if (T === 'touch') { ensureAudio(); drag = { kind: 'touch', last: p, t: performance.now(), inside: new Set() }; touchAt(p, 0, 0); return; }
  if (T === 'rail') {
    if (e.shiftKey) { drag = { kind: 'railCircle', c: w, r: 0 }; return; }
    drag = { kind: 'railStroke', pts: [[w.x, w.y]], p0: p, moved: false };
    return;
  }
  if (T === 'sweep' || T === 'room') { drag = { kind: T + 'Rect', p0: p, w0: w, w1: w }; return; }
  if (T === 'thread') { const f = fragUnder(p, visT(), sim.frags)[0]; if (f) drag = { kind: 'thread', from: f, p }; else toast('糸は断片から引き始めます。'); return; }
  if (T === 'train') {
    let best = null;
    for (const r of sim.rails) { const n = C.railNearest(r, w.x, w.y); if (n.d * view.z < 30 && (!best || n.d < best.n.d)) best = { r, n }; }
    if (best) { const t = W.newTrain(best.r.id, 0); const L = C.railGeom(best.r).L; t.s0 = (((best.n.s - sim.trainSpeed(t) * visT()) / L) % 1 + 1) % 1; addObj(t); commit(); return; }
    const rail = W.newRail(C.circlePts(w.x, w.y, 170, 28), true); world.objs.push(rail); sim.index();
    const t = W.newTrain(rail.id, 0); t.cars = 1; addObj(t); commit();
    toast('小さな環状線ごと列車を置きました。');
    return;
  }
  if (T === 'ripple') { addObj(W.newRipple(w.x, w.y)); commit(); return; }
  if (T === 'flock') { addObj(W.newFlock(w.x, w.y)); commit(); return; }
  if (T === 'thing') { const types = ['tower', 'box', 'tree', 'house', 'pillar', 'glyph', 'cluster']; const rng = C.makeRng(randSeed()); addObj(W.newThing(w.x, w.y, rng, types[Math.floor(rng() * types.length)])); commit(); return; }
});
canvas.addEventListener('pointermove', e => {
  const p = ptr(e); lastPtr = p;
  if (!drag) { hoverAt(p); return; }
  const w = W2(p);
  const d = drag;
  if (d.kind === 'pan') { view.x = d.x - (p.x - d.p0.x) / view.z; view.y = d.y - (p.y - d.p0.y) / (view.z * view.ct); return; }
  if (d.kind === 'move') {
    const dx = w.x - d.w0.x, dy = w.y - d.w0.y;
    if (Math.hypot(p.x - d.p0.x, p.y - d.p0.y) > 2) d.moved = true;
    for (const it of d.items) {
      const o = it.o;
      if (it.pts) o.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
      else if (o.kind === 'train') { const r = sim.byId.get(o.rail); if (r) { const n = C.railNearest(r, w.x, w.y), L = C.railGeom(r).L; o.s0 = (((n.s - sim.trainSpeed(o) * visT()) / L) % 1 + 1) % 1; } }
      else if ('x' in o && o.kind !== 'thread') { o.x = it.x + dx; o.y = it.y + dy; }
    }
    if (!S.playing) sim.refresh();
    return;
  }
  if (d.kind === 'handle') {
    const o = d.hit.o, part = d.hit.part;
    if (part === 'rot') { let a = Math.atan2(w.y - o.y, w.x - o.x) + Math.PI / 2; if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); o.ang = a; }
    else if (part === 'size') { o.r = Math.round(C.clamp(Math.hypot(w.x - o.x, w.y - o.y) / 1.018, 8, 300)); }
    else if (part === 'corner' && o.kind === 'room') { const c = handles(d.orig).corners[(d.hit.i + 2) % 4]; const x0 = Math.min(c.x, w.x), x1 = Math.max(c.x, w.x), y0 = Math.min(c.y, w.y), y1 = Math.max(c.y, w.y); o.x = (x0 + x1) / 2; o.y = (y0 + y1) / 2; o.w = Math.max(60, x1 - x0); o.h = Math.max(60, y1 - y0); }
    else if (part === 'corner' && o.kind === 'scan') { const ca = Math.cos(-o.ang), sa = Math.sin(-o.ang), dx = w.x - o.x, dy = w.y - o.y; o.w = Math.max(40, Math.abs(dx * ca - dy * sa) * 2); o.h = Math.max(30, Math.abs(dx * sa + dy * ca) * 2); }
    else if (part === 'arm') { o.r = Math.max(30, Math.hypot(w.x - o.x, w.y - o.y)); o.ang0 = Math.atan2(w.y - o.y, w.x - o.x); }
    else if (part === 'reach') { o.reach = Math.max(30, Math.hypot(w.x - o.x, w.y - o.y)); }
    else if (part === 'vertex') { o.pts[d.hit.i] = [w.x, w.y]; }
    if (!S.playing) sim.refresh();
    d.changed = true;
    return;
  }
  if (d.kind === 'marquee') { d.p1 = p; return; }
  if (d.kind === 'touch') {
    const dt = Math.max(1, performance.now() - d.t) / 1000;
    const vx = (p.x - d.last.x) / view.z / dt, vy = (p.y - d.last.y) / (view.z * view.ct) / dt;
    d.last = p; d.t = performance.now();
    touchAt(p, vx, vy);
    return;
  }
  if (d.kind === 'railStroke') { if (Math.hypot(p.x - d.p0.x, p.y - d.p0.y) > 6) d.moved = true; if (d.moved) d.pts.push([w.x, w.y]); return; }
  if (d.kind === 'railCircle') { d.r = Math.hypot(w.x - d.c.x, w.y - d.c.y); return; }
  if (d.kind === 'sweepRect' || d.kind === 'roomRect') { d.w1 = w; return; }
  if (d.kind === 'thread') { d.p = p; return; }
});
canvas.addEventListener('pointerup', e => {
  const p = ptr(e), d = drag; drag = null; canvas.classList.remove('panning');
  if (!d) return;
  const w = W2(p);
  if (d.kind === 'move') { if (d.moved) { sim.refresh(); commit(); renderInspectorIfShape(); } return; }
  if (d.kind === 'handle') { if (d.changed) { sim.index(); sim.refresh(); commit(); renderInspector(); } return; }
  if (d.kind === 'marquee') {
    const x0 = Math.min(d.p0.x, d.p1.x), x1 = Math.max(d.p0.x, d.p1.x), y0 = Math.min(d.p0.y, d.p1.y), y1 = Math.max(d.p0.y, d.p1.y);
    if (x1 - x0 < 4 && y1 - y0 < 4) { if (!d.add) { S.sel.clear(); renderInspector(); } return; }
    const Tv = visT(), ids = [];
    const inBox = (x, y) => { const X = view.sx(x), Y = view.sy(y); return X >= x0 && X <= x1 && Y >= y0 && Y <= y1; };
    for (const f of sim.frags) { const q = sim.pose(f, Tv, false); if (inBox(q.x, q.y)) ids.push(f.id); }
    for (const o of [...sim.things, ...sim.ripples, ...sim.sweeps, ...sim.flockObjs, ...sim.rooms, ...sim.scans]) if (inBox(o.x, o.y)) ids.push(o.id);
    select(ids, d.add);
    return;
  }
  if (d.kind === 'touch') return;
  if (d.kind === 'railCircle') { if (d.r * view.z > 12) makeRail(C.circlePts(d.c.x, d.c.y, d.r, Math.max(16, Math.round(d.r / 14))), true); return; }
  if (d.kind === 'railStroke') {
    if (d.moved) {
      let pts = C.thin(d.pts, 14 / Math.max(0.3, view.z) * 0.6);
      if (pts.length < 2) return;
      const first = pts[0], last = pts[pts.length - 1];
      const closed = pts.length > 4 && Math.hypot(first[0] - last[0], first[1] - last[1]) * view.z < 28;
      if (closed) pts.pop();
      makeRail(pts, closed); draft = null; return;
    }
    // click: polyline mode
    if (!draft) draft = { pts: [] };
    const f = draft.pts[0];
    if (f && draft.pts.length >= 3 && sdist(p, f[0], f[1]) < 12) { makeRail(draft.pts, true); draft = null; return; }
    draft.pts.push([w.x, w.y]);
    return;
  }
  if (d.kind === 'sweepRect') {
    const dx = d.w1.x - d.w0.x, dy = d.w1.y - d.w0.y;
    if (Math.hypot(dx, dy) * view.z > 14) addObj(W.newScan((d.w0.x + d.w1.x) / 2, (d.w0.y + d.w1.y) / 2, Math.max(60, Math.abs(dx)), Math.max(40, Math.abs(dy))));
    else addObj(W.newSweep(d.w0.x, d.w0.y));
    commit(); return;
  }
  if (d.kind === 'roomRect') {
    const dx = d.w1.x - d.w0.x, dy = d.w1.y - d.w0.y;
    let m;
    if (Math.hypot(dx, dy) * view.z > 14) m = W.newRoom((d.w0.x + d.w1.x) / 2, (d.w0.y + d.w1.y) / 2, Math.max(60, Math.abs(dx)), Math.max(60, Math.abs(dy)));
    else m = W.newRoom(d.w0.x, d.w0.y, 420, 260);
    const names = ['奥の間', '石の部屋', '長い廊下', '物置', '水の部屋', '屋根裏', '控えの間', '鉄の部屋'];
    m.name = names[sim.rooms.length % names.length];
    addObj(m); commit(); return;
  }
  if (d.kind === 'thread') {
    const t = fragUnder(p, visT(), sim.frags)[0];
    if (t && t.id !== d.from.id) { addObj(W.newThread(d.from.id, t.id)); commit(); }
    return;
  }
});
canvas.addEventListener('dblclick', e => {
  const p = ptr(e);
  if (S.tool === 'rail' && draft) { if (draft.pts.length >= 2) makeRail(draft.pts, false); draft = null; return; }
  if (S.tool !== 'select') return;
  const hit = hitTest(p);
  if (hit && hit.o.kind === 'frag') { touchFrag(hit.o, 0.8); return; }
  if (hit && hit.o.kind === 'rail' && e.altKey === false) return;
  if (!hit) { const m = roomInside(p); if (m) select([m.id]); }
});
canvas.addEventListener('click', e => {
  // Alt+click on a selected rail inserts a point
  if (S.tool !== 'select' || !e.altKey) return;
  const o = selObjs()[0]; if (!o || o.kind !== 'rail' || S.sel.size !== 1) return;
  const w = W2(ptr(e)); let best = -1, bd = Infinity; const n = o.pts.length, segs = o.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) { const a = o.pts[i], b = o.pts[(i + 1) % n], dd = C.distToSeg(w.x, w.y, a[0], a[1], b[0], b[1]); if (dd < bd) { bd = dd; best = i; } }
  if (best >= 0 && bd * view.z < 12) { o.pts.splice(best + 1, 0, [w.x, w.y]); commit(); }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const p = ptr(e);
  if (e.ctrlKey || e.metaKey) {
    const before = W2(p), k = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0105));
    view.z = C.clamp(view.z * k, 0.08, 4);
    const after = W2(p); view.x += before.x - after.x; view.y += before.y - after.y;
  } else {
    const m = e.deltaMode ? 30 : 1;
    view.x += e.deltaX * m / view.z; view.y += e.deltaY * m / (view.z * view.ct);
  }
}, { passive: false });
function makeRail(pts, closed) {
  const r = W.newRail(pts.map(q => [Math.round(q[0]), Math.round(q[1])]), closed);
  world.objs.push(r); sim.index();
  const t = W.newTrain(r.id, 0); t.cars = 1; t.speed = closed ? 140 : 160;
  addObj(t); select([r.id]); commit();
  toast(closed ? '環状線を敷き、列車を一両走らせました。' : '線路を敷き、列車を一両走らせました。端で折り返します。');
}
function renderInspectorIfShape() { renderInspector(); }
function touchAt(p, vx, vy) {
  const d = drag; if (!d) return;
  const under = fragUnder(p, visT(), sim.frags), speed = Math.hypot(vx, vy);
  const now = new Set();
  for (const f of under) {
    now.add(f.id);
    if (f.mode === 'tape') { const w = W2(p); touchTape(f, w.x, w.y, vx || 1, vy); continue; }
    if (!d.inside.has(f.id)) touchFrag(f, C.clamp(0.35 + speed / 1500, 0.2, 1));
  }
  d.inside = now;
}
function hoverAt(p) {
  if (S.tool === 'select') { const h = hitTest(p); canvas.style.cursor = h ? (h.part === 'rot' ? 'grab' : h.part ? 'nwse-resize' : 'move') : ''; S.hover = h ? h.o.id : null; }
  else { canvas.style.cursor = ''; S.hover = null; }
}

// overlay: drafts, marquee, thread preview, hover
function overlay(g, V) {
  const P = R.palette ? null : null;
  const css = getComputedStyle(document.documentElement), acc = css.getPropertyValue('--accent').trim();
  g.strokeStyle = acc; g.fillStyle = acc; g.lineWidth = 1.5;
  if (S.hover && !drag) {
    const o = sim.byId.get(S.hover);
    if (o && (o.kind === 'frag' || o.kind === 'thing') && !S.sel.has(o.id)) { const q = o.kind === 'frag' ? sim.pose(o, visT(), false) : o; R.V = V; R.ellipse(q.x, q.y, q.r + 4); g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1; }
  }
  const d = drag;
  if (d && d.kind === 'marquee') { g.setLineDash([4, 3]); g.strokeRect(Math.min(d.p0.x, d.p1.x), Math.min(d.p0.y, d.p1.y), Math.abs(d.p1.x - d.p0.x), Math.abs(d.p1.y - d.p0.y)); g.setLineDash([]); }
  if (d && d.kind === 'railStroke' && d.moved) { g.beginPath(); d.pts.forEach(([x, y], i) => i ? g.lineTo(V.sx(x), V.sy(y)) : g.moveTo(V.sx(x), V.sy(y))); g.stroke(); }
  if (d && d.kind === 'railCircle') { R.V = V; R.ellipse(d.c.x, d.c.y, d.r); g.stroke(); }
  if (draft && draft.pts.length) {
    g.beginPath(); draft.pts.forEach(([x, y], i) => i ? g.lineTo(V.sx(x), V.sy(y)) : g.moveTo(V.sx(x), V.sy(y))); g.lineTo(lastPtr.x, lastPtr.y); g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]);
    for (const [x, y] of draft.pts) { g.beginPath(); g.arc(V.sx(x), V.sy(y), 3, 0, Math.PI * 2); g.fill(); }
  }
  if (d && (d.kind === 'sweepRect' || d.kind === 'roomRect')) {
    const a = d.w0, b = d.w1;
    g.setLineDash([5, 4]); g.beginPath(); g.moveTo(V.sx(a.x), V.sy(a.y)); g.lineTo(V.sx(b.x), V.sy(a.y)); g.lineTo(V.sx(b.x), V.sy(b.y)); g.lineTo(V.sx(a.x), V.sy(b.y)); g.closePath(); g.stroke(); g.setLineDash([]);
  }
  if (d && d.kind === 'thread') { const q = sim.pose(d.from, visT(), false); g.beginPath(); g.moveTo(V.sx(q.x), V.sy(q.y)); g.lineTo(d.p.x, d.p.y); g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]); }
}

// ---------- keyboard ----------
const typing = e => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !(t.tagName === 'INPUT' && /^(range|checkbox|button)$/.test(t.type))); };
window.addEventListener('keydown', e => {
  if (typing(e)) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key;
  if (k === ' ') { e.preventDefault(); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); spaceDown = true; if (!e.repeat) S.spaceT = performance.now(); return; }
  if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); if (S.sel.size) duplicateSel(); return; }
  if (mod && k === 'g') { e.preventDefault(); groupSel(!e.shiftKey); return; }
  if (mod && k === 'a') { e.preventDefault(); select(sim.frags.map(f => f.id)); return; }
  if (mod && k === 's') { e.preventDefault(); saveProject(); return; }
  if (mod && k === 'o') { e.preventDefault(); $('fileProj').click(); return; }
  if (mod) return;
  if (k === 'Escape') { if (draft) { draft = null; return; } if (!$('help').hidden) { $('help').hidden = true; return; } if (!$('exportPop').hidden || !$('menuPop').hidden) { closePops(); return; } if (S.sel.size) { S.sel.clear(); renderInspector(); return; } setTool('select'); return; }
  if (k === 'Enter' && draft) { if (draft.pts.length >= 2) makeRail(draft.pts, false); draft = null; return; }
  if (k === 'Backspace' || k === 'Delete') { if (S.sel.size) { e.preventDefault(); removeIds([...S.sel]); commit(); } return; }
  if (k === 'Tab') { e.preventDefault(); document.body.classList.toggle('bare'); return; }
  if (/^[1-6]$/.test(k) || (e.shiftKey && /^Digit[1-6]$/.test(e.code))) { const i = +(e.code.replace('Digit', '')) - 1; if (i >= 0 && i < 6) { sceneKey(i, e.shiftKey); return; } }
  if (k === '0') { fitView(); return; }
  if (k === '?' ) { $('help').hidden = !$('help').hidden; return; }
  if (k === 'l' || k === 'L') { $('laws').hidden ? openLaws() : closeLaws(); return; }
  if (k === 'm' || k === 'M') { toggleLibrary(); return; }
  const tool = Object.entries(TOOLS).find(([, t]) => t.k === k.toLowerCase());
  if (tool) { setTool(tool[0]); return; }
  const os = selObjs();
  if (k.startsWith('Arrow') && os.length) {
    e.preventDefault(); const s = e.shiftKey ? 25 : 5, dx = k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, dy = k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0;
    for (const o of os) { if (o.pts) o.pts = o.pts.map(([x, y]) => [x + dx, y + dy]); else if ('x' in o) { o.x += dx; o.y += dy; } }
    sim.refresh(); clearTimeout(S.nudgeT); S.nudgeT = setTimeout(commit, 400); return;
  }
  if ((k === '[' || k === ']') && os.length) { for (const o of os) if ('ang' in o) o.ang += (k === ']' ? 1 : -1) * Math.PI / 12; sim.refresh(); commit(); return; }
  if ((k === '-' || k === '=' || k === '+') && os.some(o => 'r' in o && (o.kind === 'frag' || o.kind === 'thing'))) { for (const o of os) if (o.kind === 'frag' || o.kind === 'thing') o.r = Math.round(C.clamp(o.r * (k === '-' ? 0.9 : 1.1), 8, 300)); sim.refresh(); commit(); return; }
  if (k === '-' || k === '=' || k === '+') { view.z = C.clamp(view.z * (k === '-' ? 0.85 : 1.18), 0.08, 4); return; }
});
window.addEventListener('keyup', e => {
  if (e.key === ' ') { spaceDown = false; if (!typing(e) && performance.now() - (S.spaceT || 0) < 300 && !S.spacePanned) togglePlay(); S.spacePanned = false; }
});
canvas.addEventListener('pointermove', () => { if (spaceDown && drag && drag.kind === 'pan') S.spacePanned = true; });

// ---------- drop ----------
let dragDepth = 0;
window.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; $('drop').hidden = false; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  const p = ptr(e), w = W2(p);
  const sid = e.dataTransfer.getData('text/x-sawari-src');
  if (sid && srcs.has(sid)) { const f = W.newFrag(sid, 0, srcs.get(sid).dur, w.x, w.y, C.makeRng(randSeed())); addObj(f); commit(); return; }
  if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, w);
});

// ---------- view ----------
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = window.innerWidth, h = window.innerHeight;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  R.resize(w, h, dpr); view.w = w; view.h = h;
}
function fitView() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  for (const o of world.objs) {
    if (o.kind === 'rail') o.pts.forEach(([x, y]) => add(x, y));
    else if (o.kind === 'room' || o.kind === 'scan') { add(o.x - o.w / 2, o.y - o.h / 2); add(o.x + o.w / 2, o.y + o.h / 2); }
    else if (o.kind === 'sweep') add(o.x, o.y, o.r);
    else if (o.kind === 'ripple') add(o.x, o.y, Math.min(o.reach, 300));
    else if ('x' in o) add(o.x, o.y, o.r || 40);
  }
  if (!isFinite(x0)) { x0 = -800; x1 = 800; y0 = -500; y1 = 500; }
  const narrow = window.innerWidth < 760;
  const padL = narrow ? 16 : 70, padR = narrow ? 16 : ($('insp').offsetWidth + 30), padT = 70, padB = narrow ? 200 : 60;
  const aw = Math.max(200, view.w - padL - padR), ah = Math.max(200, view.h - padT - padB);
  view.tilt = world.tilt ?? 0.5;
  view.z = C.clamp(Math.min(aw / (x1 - x0 + 80), ah / ((y1 - y0 + 80) * view.ct)), 0.1, 1.6);
  view.x = (x0 + x1) / 2 - ((padL - padR) / 2) / view.z;
  view.y = (y0 + y1) / 2 - ((padT - padB) / 2) / (view.z * view.ct);
}
function flash(id) {
  const a = S.flashes.get(id); if (!a) return null;
  const now = audioNow() - (world.vlag || 0);
  for (let i = a.length - 1; i >= 0; i--) {
    const age = now - a[i].at;
    if (age < 0) continue;
    if (age > 0.7) return null;
    return { k: 1 - age / 0.7, silent: a[i].silent };
  }
  return null;
}
const srcName = id => (srcs.get(id) || world.sources.find(s => s.id === id) || { name: '?' }).name;
function frame() {
  requestAnimationFrame(frame);
  if (S.playing) pump();
  view.tilt = world.tilt ?? 0.5;
  const Tv = visT();
  R.draw({ world, sim, view, Tv, sel: S.sel, flash, labels: S.labels, srcName, handles, overlay });
  const T = Math.max(0, S.playing && ctx ? ctx.currentTime - S.t0 : S.T), beat = 60 / world.bpm;
  const bar = Math.floor(T / (beat * 4)) + 1, bt = Math.floor(T / beat) % 4 + 1;
  $('clock').textContent = `${Math.floor(T / 60)}:${(T % 60).toFixed(1).padStart(4, '0')}  ${bar}.${bt}`;
}

// ---------- top bar & popovers ----------
function closePops() { $('exportPop').hidden = true; $('menuPop').hidden = true; }
function wire() {
  $('play').onclick = togglePlay;
  $('stop').onclick = rewind;
  $('bpm').addEventListener('change', () => { world.bpm = C.clamp(+$('bpm').value || 92, 20, 300); syncTopBar(); if (eng) { eng.syncMaster(); eng.syncRooms(); } commit(); renderInspector(); });
  $('seed').addEventListener('change', () => { world.seed = (+$('seed').value >>> 0); commit(); rewind(); toast('種を変えました。最初から、別の偶然で動きます。'); });
  $('reseed').onclick = () => { world.seed = randSeed(); syncTopBar(); commit(); rewind(); toast(`種 ${world.seed}：同じ配置から別の偶然が生まれます。この種を残せば、同じ展開を何度でも書き出せます。`, 4200); };
  $('lawsBtn').onclick = () => ($('laws').hidden ? openLaws() : closeLaws());
  $('libBtn').onclick = () => toggleLibrary();
  $('undo').onclick = undo; $('redo').onclick = redo;
  $('rec').onclick = toggleRec;
  $('exportBtn').onclick = e => { e.stopPropagation(); const on = $('exportPop').hidden; closePops(); $('exportPop').hidden = !on; };
  $('exportGo').onclick = () => exportWav(C.clamp(+$('exportLen').value || 60, 2, 900), $('exportAsSrc').checked);
  $('saveBtn').onclick = saveProject;
  $('openBtn').onclick = () => $('fileProj').click();
  $('menuBtn').onclick = e => { e.stopPropagation(); const on = $('menuPop').hidden; closePops(); $('menuPop').hidden = !on; };
  $('mNew').onclick = () => { closePops(); newWorld(); };
  $('mSynth').onclick = () => { closePops(); addSynth(); };
  $('mFiles').onclick = () => { closePops(); $('fileAudio').click(); };
  $('mHelp').onclick = () => { closePops(); $('help').hidden = false; };
  $('mFit').onclick = () => { closePops(); fitView(); };
  $('helpClose').onclick = () => { $('help').hidden = true; };
  $('libFiles').onclick = () => $('fileAudio').click();
  $('libSynth').onclick = () => addSynth();
  $('libClose').onclick = () => toggleLibrary(false);
  $('eFiles').onclick = () => $('fileAudio').click();
  $('eSynth').onclick = () => addSynth();
  $('fileAudio').addEventListener('change', e => { const fs = e.target.files; if (fs && fs.length) addFiles(fs); e.target.value = ''; });
  $('fileProj').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) openProject(f); e.target.value = ''; });
  $('tilt').addEventListener('input', () => { world.tilt = +$('tilt').value; });
  $('tilt').addEventListener('change', () => commit());
  $('fit').onclick = fitView;
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.pop') && !e.target.closest('#exportBtn') && !e.target.closest('#menuBtn')) closePops(); });
  window.addEventListener('resize', resize);
  const re = () => { R.palette(); renderLibrary(); if (selObjs().length === 1 && selObjs()[0].kind === 'frag') renderInspector(); };
  if (window.matchMedia) { const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener && mq.addEventListener('change', re); }
  new MutationObserver(re).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.playing) pump(); });
}

// ---------- boot ----------
(async function boot() {
  buildTools(); wire(); resize(); R.palette();
  setTool('select'); syncTopBar(); renderScenes(); renderInspector(); updateEmpty(); renderLibrary();
  fitView();
  H.stack = [snap()]; H.i = 0; updateUndo();
  requestAnimationFrame(frame);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => R.palette());
  await restoreAutosave();
})();
