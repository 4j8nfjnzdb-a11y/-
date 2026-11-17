// Sawari panels: inspector, law matrix, material library, scenes, top bar.
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
let ctlN = 0;
const ghosts = [];  // live "where the laws put it" markers
// a labelled slider. o: {min,max,step,fmt,ghost:key, live}
function slider(label, get, set, o = {}) {
  const id = 'c' + (++ctlN), inp = el('input', { type: 'range', id, min: o.min ?? 0, max: o.max ?? 1, step: o.step ?? 0.01 });
  inp.value = get();
  const out = el('output', { for: id, class: 'val' });
  const fmt = o.fmt || (v => (+v).toFixed(2));
  out.textContent = fmt(+inp.value);
  const track = el('span', { class: 'track' }, inp);
  if (o.ghost) { const gm = el('i', { class: 'ghost', 'aria-hidden': 'true' }); track.append(gm); ghosts.push({ el: gm, key: o.ghost, min: +inp.min, max: +inp.max, out, fmt }); }
  inp.addEventListener('input', () => { set(+inp.value); out.textContent = fmt(+inp.value); if (o.live) o.live(); });
  inp.addEventListener('change', () => { commit(); if (o.after) o.after(); });
  inp.addEventListener('dblclick', () => { if (o.def != null) { inp.value = o.def; set(o.def); out.textContent = fmt(o.def); commit(); if (o.live) o.live(); } });
  return el('div', { class: 'row', title: o.tip || '' }, el('label', { for: id }, label), track, out);
}
function seg(label, opts, get, set, o = {}) {
  const box = el('div', { class: 'seg', role: 'group', 'aria-label': label });
  const draw = () => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(get()))));
  for (const [v, l, tip] of opts) box.append(el('button', { type: 'button', 'data-v': String(v), title: tip || '', onclick: () => { set(v); draw(); commit(); if (o.after) o.after(); } }, l));
  draw();
  return el('div', { class: 'row seg-row' }, label ? el('span', { class: 'lab' }, label) : null, box);
}
function toggle(label, get, set, o = {}) {
  const id = 'c' + (++ctlN), inp = el('input', { type: 'checkbox', id });
  inp.checked = !!get();
  inp.addEventListener('change', () => { set(inp.checked); commit(); if (o.after) o.after(); });
  return el('div', { class: 'row tog-row', title: o.tip || '' }, el('label', { for: id }, inp, el('span', null, label)));
}
const btn = (label, fn, o = {}) => el('button', { type: 'button', class: 'btn ' + (o.cls || ''), title: o.tip || '', onclick: fn }, label);
const section = (title, ...kids) => el('section', { class: 'sec' }, el('h3', null, title), ...kids);
const note = t => el('p', { class: 'note' }, t);

const fmtDb = v => `${v > 0 ? '+' : ''}${(+v).toFixed(1)} dB`;
const fmtSt = v => `${v > 0 ? '+' : ''}${(+v).toFixed(1)}`;
const fmtPct = v => `${Math.round(v * 100)}%`;
const fmtS = v => `${(+v).toFixed(2)} s`;
const fmtX = v => `×${(2 ** v).toFixed(2)}`;
const fmtPan = v => (Math.abs(v) < 0.02 ? '中' : v < 0 ? `左 ${Math.round(-v * 100)}` : `右 ${Math.round(v * 100)}`);
const fmtTone = v => (Math.abs(v) < 0.02 ? '素' : v < 0 ? `暗 ${Math.round(-v * 100)}` : `細 ${Math.round(v * 100)}`);

// ---------- inspector ----------
let inspFor = '';
function renderInspector() {
  const box = $('insp'), objs = selObjs();
  ghosts.length = 0; box.replaceChildren();
  inspFor = objs.map(o => o.id).join(',');
  if (!objs.length) return worldInspector(box);
  if (objs.length > 1) return multiInspector(box, objs);
  const o = objs[0];
  ({ frag: fragInspector, thing: thingInspector, rail: railInspector, train: trainInspector, ripple: rippleInspector, sweep: sweepInspector, scan: scanInspector, flock: flockInspector, room: roomInspector, thread: threadInspector })[o.kind](box, o);
}
function head(box, kind, title, sub) {
  box.append(el('header', { class: 'ihead' }, el('span', { class: 'kind' }, kind), el('h2', null, title), sub ? el('p', { class: 'sub' }, sub) : null));
}
function actions(...bs) { return el('div', { class: 'acts' }, ...bs); }
const delBtn = o => btn('削除', () => { removeIds([o.id]); commit(); }, { cls: 'danger', tip: 'Delete / Backspace' });
const dupBtn = () => btn('複製', () => duplicateSel(), { tip: '⌘D、または Alt を押しながらドラッグ' });

function worldInspector(box) {
  const w = world;
  head(box, '世界', '何も選んでいません', 'ここでは世界全体の決まりを変えます。ものを選ぶと、その性質が出ます。');
  box.append(
    section('時間',
      slider('拍の速さ', () => w.bpm, v => { w.bpm = v; syncTopBar(); if (eng) { eng.syncMaster(); eng.syncRooms(); } }, { min: 30, max: 220, step: 1, fmt: v => `${v} BPM`, def: 92 }),
      slider('糸の伝わる速さ', () => w.threadSpeed, v => { w.threadSpeed = v; }, { min: 40, max: 1600, step: 10, fmt: v => `${v} /s`, def: 420, tip: '糸でつないだ断片は、糸の長さ ÷ この速さだけ遅れて鳴ります' }),
      slider('偶然の度合い', () => w.chance, v => { w.chance = v; }, { min: 0, max: 1, fmt: fmtPct, def: 0.5, tip: '群れの気まぐれ、断片の変わりやすさに効きます' }),
      slider('見た目の遅れ', () => w.vlag, v => { w.vlag = v; }, { min: 0, max: 3, step: 0.05, fmt: fmtS, def: 0, tip: '画面だけを音より遅らせます。音は変わりません' }),
    ),
    section('世界の響き',
      slider('全体の音量', () => w.master.vol, v => { w.master.vol = v; eng && eng.syncMaster(); }, { min: 0, max: 1.4, fmt: fmtPct, def: 0.8 }),
      slider('遠（ディレイ）の間隔', () => w.master.dBeats, v => { w.master.dBeats = v; eng && eng.syncMaster(); }, { min: 0.125, max: 2, step: 0.125, fmt: v => `${v} 拍`, def: 0.75 }),
      slider('遠の繰り返し', () => w.master.dFb, v => { w.master.dFb = v; eng && eng.syncMaster(); }, { min: 0, max: 0.9, fmt: fmtPct, def: 0.38 }),
      slider('遠の明るさ', () => w.master.dTone, v => { w.master.dTone = v; eng && eng.syncMaster(); }, { min: 300, max: 12000, step: 50, fmt: v => `${Math.round(v)} Hz`, def: 3200 }),
      slider('響（残響）の長さ', () => w.master.vSize, v => { w.master.vSize = v; }, { min: 0.3, max: 8, step: 0.1, fmt: fmtS, def: 3.4, after: () => eng && eng.syncMaster() }),
      slider('響のこもり', () => w.master.vDamp, v => { w.master.vDamp = v; }, { min: 0, max: 1, fmt: fmtPct, def: 0.45, after: () => eng && eng.syncMaster() }),
    ),
    section('見え方',
      toggle('断片に名札を出す', () => S.labels, v => { S.labels = v; }),
    ),
    section('始め方',
      note('音声ファイルをこの画面に落とすと、その場に「断片」が置かれます。断片はそれだけでは鳴りません。列車・波紋・掃引・群れが触れたとき、または「触」の道具で触れたときに鳴ります。'),
      note('どの空間の性質（位置・大きさ・向き・近さ…）が、どの音の性質（音量・速さ・音程…）を動かすかは「法則」で決まります。決まりは変えられ、断片ごとに 甲・乙・丙 のどれに従うかを選べます。'),
      actions(btn('音声ファイルを選ぶ', () => $('fileAudio').click()), btn('合成音で試す', () => addSynth())),
    ),
  );
}

function fragInspector(box, f) {
  const src = srcs.get(f.src), P = f.p;
  const sk = W.SKMAP[f.skin.type];
  head(box, '断片', src ? src.name : '（音が見つかりません）', `${f.a.toFixed(2)}–${f.b.toFixed(2)} 秒 · 姿：${sk ? sk.l : ''}`);
  box.append(seg('鳴り方', [['hit', '打', '触れられたときに一度鳴る'], ['loop', '環', '再生中ずっと鳴り続ける。触れると頭に戻る'], ['tape', '帯', '列車や群れや指が通った場所を読む（テープのように）']], () => f.mode, v => { f.mode = v; }, { after: renderInspector }));
  if (src) box.append(waveEditor(f, src));
  const g = k => ({ ghost: k });
  box.append(section('音',
    slider('音量', () => P.vol, v => P.vol = v, { min: -36, max: 12, step: 0.5, fmt: fmtDb, def: 0, ...g('vol') }),
    slider('速さ', () => P.rate, v => P.rate = v, { min: -24, max: 24, step: 0.1, fmt: v => fmtSt(v) + ' 半音', def: 0, tip: 'テープのように、速さと高さが一緒に変わる', ...g('rate') }),
    slider('音程', () => P.pitch, v => P.pitch = v, { min: -24, max: 24, step: 0.1, fmt: v => fmtSt(v) + ' 半音', def: 0, tip: '長さを変えずに高さだけ（粒で処理）', ...g('pitch') }),
    slider('伸縮', () => P.stretch, v => P.stretch = v, { min: -3, max: 3, step: 0.05, fmt: fmtX, def: 0, tip: '高さを変えずに長さだけ（粒で処理）', ...g('stretch') }),
    slider('定位', () => P.pan, v => P.pan = v, { min: -1, max: 1, fmt: fmtPan, def: 0, ...g('pan') }),
    slider('音色', () => P.tone, v => P.tone = v, { min: -1, max: 1, fmt: fmtTone, def: 0, tip: '左で暗く、右で細く', ...g('tone') }),
    slider('頭', () => P.start, v => P.start = v, { min: 0, max: 0.95, fmt: fmtPct, def: 0, tip: '断片のどこから鳴らすか', ...g('start') }),
    slider('長さ', () => P.len, v => P.len = v, { min: 0.02, max: 1, fmt: fmtPct, def: 1, ...g('len') }),
    toggle('逆再生', () => P.rev > 0.5, v => { P.rev = v ? 1 : 0; }),
    slider('入り', () => P.fin, v => P.fin = v, { min: 1, max: 2000, step: 1, fmt: v => `${v} ms`, def: 4, tip: 'フェードイン' }),
    slider('抜け', () => P.fout, v => P.fout = v, { min: 2, max: 2000, step: 1, fmt: v => `${v} ms`, def: 25, tip: 'フェードアウト' }),
  ));
  box.append(section('加工',
    slider('粒', () => P.grain, v => P.grain = v, { min: 0, max: 1, fmt: fmtPct, def: 0, tip: '粒に砕く', ...g('grain') }),
    slider('散', () => P.spray, v => P.spray = v, { min: 0, max: 1, fmt: fmtPct, def: 0.25, tip: '粒の位置と間隔のばらつき', ...g('spray') }),
    slider('歪', () => P.drive, v => P.drive = v, { min: 0, max: 1, fmt: fmtPct, def: 0, ...g('drive') }),
    slider('遠', () => P.dly, v => P.dly = v, { min: 0, max: 1, fmt: fmtPct, def: 0, tip: '世界のディレイへ', ...g('dly') }),
    slider('響', () => P.verb, v => P.verb = v, { min: 0, max: 1, fmt: fmtPct, def: 0.12, tip: '世界の残響へ', ...g('verb') }),
    slider('確率', () => P.prob, v => P.prob = v, { min: 0, max: 1, fmt: fmtPct, def: 1, tip: '触れられても鳴らないことがある', ...g('prob') }),
    slider('ずれ', () => P.lag, v => P.lag = v, { min: 0, max: 2, step: 0.01, fmt: fmtS, def: 0, tip: '見た目の出来事から音が遅れる', ...g('lag') }),
    note('目盛りの上の小さな印は、いま法則がこの断片をどこへ動かしているかです。'),
  ));
  box.append(section('法則',
    seg('', [[0, '甲'], [1, '乙'], [2, '丙'], [-1, '無', '法則に従わない（設定した値のまま）']], () => f.law, v => { f.law = v; }),
    actions(btn('法則の表を開く', () => openLaws(f.law >= 0 ? f.law : 0))),
  ));
  box.append(skinSection(f, true));
  const m = f.move;
  box.append(section('動き',
    seg('', [['none', '静'], ['spin', '自転'], ['orbit', '公転'], ['drift', '漂い'], ['jitter', '震え'], ['breathe', '呼吸']], () => m.type, v => { m.type = v; }, { after: renderInspector }),
    m.type !== 'none' ? slider('速さ', () => m.speed, v => m.speed = v, { min: 0, max: 1, fmt: fmtPct, def: 0.3 }) : null,
    ['orbit', 'drift', 'jitter'].includes(m.type) ? slider('半径', () => m.radius, v => m.radius = v, { min: 5, max: 400, step: 1, fmt: v => `${v}`, def: 60 }) : null,
    m.type !== 'none' ? toggle('動きを音に伝える', () => m.audible, v => { m.audible = v; }, { tip: '切ると、見た目は動くが音にとっては止まったまま' }) : null,
    slider('変わりやすさ', () => f.mut, v => f.mut = v, { min: 0, max: 1, fmt: fmtPct, def: 0, tip: '鳴るたびに、位置・向き・角・頭・大きさが少しずつ変わることがある' }),
  ));
  box.append(actions(btn('鳴らす', () => touchFrag(f, 0.8), { tip: '「触」の道具でも鳴らせます' }), dupBtn(), delBtn(f)));
}
function skinSection(o, isFrag) {
  const sk = o.skin;
  const types = el('div', { class: 'chips' });
  for (const s of W.SKINS) types.append(el('button', { type: 'button', 'aria-pressed': String(sk.type === s.k), onclick: () => { sk.type = s.k; if (W.SKMAP[s.k].solid && !sk.h) sk.h = 50; commit(); renderInspector(); } }, s.l));
  const solid = W.SKMAP[sk.type] && W.SKMAP[sk.type].solid;
  return section('姿',
    note(isFrag ? '姿は音から決まりません。同じ音に別の姿、同じ姿に別の音を与えられます（法則が「形」を読むときだけ音に効きます）。' : '音を持たないものです。まわりの断片にとっての「近さ」「混み」には数えられます。'),
    types,
    slider('大きさ', () => o.r, v => o.r = v, { min: 8, max: 240, step: 1, fmt: v => `${v}`, ghost: null, live: () => sim.refresh() }),
    slider('向き', () => Math.round(((o.ang % C.TAU) + C.TAU) % C.TAU * 180 / Math.PI), v => o.ang = v * Math.PI / 180, { min: 0, max: 359, step: 1, fmt: v => `${v}°`, live: () => sim.refresh() }),
    ['poly', 'star', 'cluster'].includes(sk.type) || isFrag ? slider('角の数', () => sk.sides, v => sk.sides = v, { min: 3, max: 12, step: 1, fmt: v => `${v}` }) : null,
    solid ? slider('高さ', () => sk.h, v => sk.h = v, { min: 0, max: 260, step: 1, fmt: v => `${v}` }) : null,
    slider('色相', () => sk.hue, v => sk.hue = v, { min: 0, max: 359, step: 1, fmt: v => `${v}°` }),
    seg('模様', W.TEXTURES.map(t => [t, { solid: '塗', hatch: '斜', dots: '点', lines: '縞', outline: '線', check: '市松' }[t]]), () => sk.tex, v => { sk.tex = v; }),
    sk.type === 'glyph' ? actions(btn(`記号を変える（${sk.glyph}）`, () => { sk.glyph = W.GLYPHS[(W.GLYPHS.indexOf(sk.glyph) + 1) % W.GLYPHS.length]; commit(); renderInspector(); })) : null,
    actions(btn('姿を振る', () => { o.skin = W.randomSkin(C.makeRng(randSeed())); commit(); renderInspector(); }, { tip: '姿だけを変える。音の設定はそのまま' })),
  );
}
// waveform: drag to choose a stretch, click to set a cut
function waveEditor(f, src) {
  const cv = el('canvas', { class: 'wave', 'aria-label': '波形。ドラッグで範囲を選ぶ。クリックで切る位置を置く' });
  const st = { sel: null, cut: null, head: null };
  const draw = () => {
    const cs = getComputedStyle(document.documentElement);
    D.wave(cv, src.peaks, { dur: src.dur, region: [f.a, f.b], regionFill: cs.getPropertyValue('--region').trim(), sel: st.sel, selFill: cs.getPropertyValue('--selfill').trim(), color: cs.getPropertyValue('--dim').trim(), edge: cs.getPropertyValue('--accent').trim(), marks: st.cut != null ? [st.cut] : null, markColor: cs.getPropertyValue('--rec').trim(), head: st.head, headColor: cs.getPropertyValue('--signal').trim() });
  };
  const tAt = e => { const r = cv.getBoundingClientRect(); return C.clamp((e.clientX - r.left) / r.width, 0, 1) * src.dur; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const t0 = tAt(e); let moved = false;
    const mv = ev => { const t = tAt(ev); if (Math.abs(t - t0) > src.dur * 0.005) moved = true; if (moved) { st.sel = [Math.min(t0, t), Math.max(t0, t)]; st.cut = null; info(); draw(); } };
    const up = ev => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); if (!moved) { st.cut = tAt(ev); st.sel = null; info(); draw(); } };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
  });
  const infoEl = el('p', { class: 'note mono' });
  const info = () => { infoEl.textContent = st.sel ? `選択 ${st.sel[0].toFixed(3)}–${st.sel[1].toFixed(3)} 秒` : st.cut != null ? `切る位置 ${st.cut.toFixed(3)} 秒` : `この断片 ${f.a.toFixed(3)}–${f.b.toFixed(3)} 秒（全体 ${src.dur.toFixed(2)} 秒）`; };
  info();
  requestAnimationFrame(draw);
  const nSel = el('select', { 'aria-label': '等分する数' }, ...[2, 3, 4, 6, 8, 12, 16].map(n => el('option', { value: n }, `${n} 等分`)));
  const listen = () => {
    ensureAudio().then(() => {
      const [a, b] = st.sel || [f.a, f.b]; const r = eng.audition(src, a, b, f.p.rev > 0.5);
      const t0 = performance.now();
      const tick = () => { const el2 = (performance.now() - t0) / 1000; if (el2 > r.len || !cv.isConnected) { st.head = null; draw(); return; } st.head = f.p.rev > 0.5 ? b - el2 : a + el2; draw(); requestAnimationFrame(tick); };
      tick();
    });
  };
  return section('切る・選ぶ', cv, infoEl,
    actions(
      btn('▶ 聴く', listen, { tip: '選んだ範囲（なければこの断片）をそのまま聴く' }),
      btn('範囲を残す', () => { if (!st.sel) return toast('波形をドラッグして範囲を選んでください。'); f.a = st.sel[0]; f.b = st.sel[1]; commit(); renderInspector(); }, { tip: 'トリミング' }),
      btn('切り出す', () => { if (!st.sel) return toast('波形をドラッグして範囲を選んでください。'); extract(f, st.sel[0], st.sel[1]); }, { tip: '選んだ範囲を新しい断片にする' }),
    ),
    actions(
      btn('ここで切る', () => { if (st.cut == null) return toast('波形をクリックして切る位置を置いてください。'); replaceWithPieces(f, [st.cut]); }),
      el('span', { class: 'join' }, nSel, btn('分ける', () => { const n = +nSel.value, cuts = []; for (let i = 1; i < n; i++) cuts.push(f.a + (f.b - f.a) * i / n); replaceWithPieces(f, cuts); })),
      btn('切れ目で刻む', () => sliceByOnsets(f), { tip: '音の立ち上がりで自動的に切る' }),
      btn('全体に戻す', () => { f.a = 0; f.b = src.dur; commit(); renderInspector(); }),
    ),
  );
}
function thingInspector(box, o) {
  head(box, '物', W.SKMAP[o.skin.type]?.l || '物', '音を持たない物体');
  box.append(skinSection(o, false), actions(dupBtn(), delBtn(o)));
}
function railInspector(box, r) {
  const trains = sim.trains.filter(t => t.rail === r.id);
  head(box, '線路', r.closed ? '環状線' : '線路', `長さ ${Math.round(C.railGeom(r).L)} · 列車 ${trains.length}`);
  box.append(section('線路',
    note('列車は線路の近くにある断片を、通りがかりに鳴らします。線の上の点はドラッグで動かせます（Alt + クリックで点を足す）。'),
    toggle('輪にする', () => r.closed, v => { r.closed = v; sim.index(); }),
    actions(btn('列車を足す', () => { const t = W.newTrain(r.id, Math.random()); addObj(t); commit(); }), dupBtn(), delBtn(r)),
  ));
}
function periodControls(o, kind) {
  return [
    toggle('拍に合わせる', () => o.sync, v => { o.sync = v; }, { after: renderInspector, tip: '周期を拍で数える（同期）。切ると秒で数える（非同期）' }),
    o.sync ? slider('周期', () => o.beats, v => o.beats = v, { min: 0.25, max: 64, step: 0.25, fmt: v => `${v} 拍`, def: kind === 'ripple' ? 4 : 8 })
      : slider('周期', () => o.period, v => o.period = v, { min: 0.1, max: 40, step: 0.05, fmt: fmtS, def: kind === 'ripple' ? 2.5 : 6 }),
  ];
}
function trainInspector(box, t) {
  const rail = sim.byId.get(t.rail);
  head(box, '列車', `${t.cars} 両`, '線路の近くの断片を、車両ごとに鳴らします（車両の数だけ繰り返す）');
  box.append(section('走り',
    toggle('一周を拍に合わせる', () => t.sync, v => { t.sync = v; }, { after: renderInspector }),
    t.sync ? slider('一周', () => t.beats, v => t.beats = v, { min: 1, max: 128, step: 1, fmt: v => `${v} 拍`, def: 16 })
      : slider('速さ', () => t.speed, v => t.speed = v, { min: -500, max: 500, step: 1, fmt: v => `${v} /s`, def: 140, tip: '負にすると逆向き' }),
    t.sync ? toggle('逆向き', () => t.speed < 0, v => { t.speed = Math.abs(t.speed) * (v ? -1 : 1); }) : null,
    slider('車両', () => t.cars, v => t.cars = v, { min: 1, max: 8, step: 1, fmt: v => `${v} 両`, def: 2 }),
    slider('届く距離', () => t.reach, v => t.reach = v, { min: 5, max: 260, step: 1, fmt: v => `${v}`, def: 60, tip: '線路からこの距離までの断片を鳴らす' }),
    rail && !rail.closed ? seg('端で', [['bounce', '折り返す'], ['wrap', '始点へ飛ぶ']], () => t.end, v => { t.end = v; }) : null,
  ), actions(delBtn(t)));
}
function rippleInspector(box, r) {
  head(box, '波紋', '波紋の源', '一定の間隔で輪を放ち、輪が届いた断片を鳴らします。距離がそのまま時間になります');
  box.append(section('波',
    ...periodControls(r, 'ripple'),
    slider('広がる速さ', () => r.speed, v => r.speed = v, { min: 20, max: 1600, step: 5, fmt: v => `${v} /s`, def: 240 }),
    slider('届く範囲', () => r.reach, v => r.reach = v, { min: 40, max: 1600, step: 5, fmt: v => `${v}`, def: 520 }),
    slider('位相', () => r.phase, v => r.phase = v, { min: 0, max: 0.99, step: 0.01, fmt: fmtPct, def: 0, tip: '周期の中でいつ放つか' }),
  ), actions(dupBtn(), delBtn(r)));
}
function sweepInspector(box, s) {
  head(box, '掃引', '回る針', '針が通り過ぎた断片を鳴らします。角度がそのまま時間になり、円は反復になります');
  box.append(section('針',
    ...periodControls(s, 'sweep'),
    slider('半径', () => s.r, v => s.r = v, { min: 40, max: 1400, step: 5, fmt: v => `${v}`, def: 320 }),
    seg('向き', [[1, '時計回り'], [-1, '反時計回り']], () => s.dir, v => { s.dir = v; }),
    slider('始まりの角', () => Math.round(s.ang0 * 180 / Math.PI), v => s.ang0 = v * Math.PI / 180, { min: -180, max: 180, step: 1, fmt: v => `${v}°` }),
  ), actions(dupBtn(), delBtn(s)));
}
function scanInspector(box, s) {
  head(box, '走査', '直線の時間', '左から右へ動く線が断片を鳴らします。いちばん普通の「タイムライン」も、世界の中のひとつの物です');
  box.append(section('線',
    ...periodControls(s, 'scan'),
    slider('幅', () => s.w, v => s.w = v, { min: 60, max: 3000, step: 10, fmt: v => `${v}`, def: 800 }),
    slider('高さ', () => s.h, v => s.h = v, { min: 30, max: 2000, step: 10, fmt: v => `${v}`, def: 300 }),
    slider('角度', () => Math.round(s.ang * 180 / Math.PI), v => s.ang = v * Math.PI / 180, { min: -180, max: 180, step: 1, fmt: v => `${v}°`, def: 0 }),
    slider('位相', () => s.phase, v => s.phase = v, { min: 0, max: 0.99, step: 0.01, fmt: fmtPct, def: 0 }),
  ), actions(dupBtn(), delBtn(s)));
}
function flockInspector(box, f) {
  head(box, '群れ', `${f.n} 羽`, '自分で飛び回り、入った断片を鳴らします。帯の断片の上では、通った場所を読みます');
  box.append(section('群れ',
    slider('数', () => f.n, v => { f.n = v; sim.ensureFlock(f); }, { min: 0, max: 24, step: 1, fmt: v => `${v}`, def: 4 }),
    slider('速さ', () => f.speed, v => f.speed = v, { min: 5, max: 600, step: 1, fmt: v => `${v} /s`, def: 110 }),
    slider('気まぐれ', () => f.wander, v => f.wander = v, { min: 0, max: 1, fmt: fmtPct, def: 0.5 }),
    seg('ふるまい', [['wander', '迷う'], ['swarm', '群がる'], ['seek', '訪ねる', '断片から断片へ渡り歩く']], () => f.mode, v => { f.mode = v; }),
    slider('縄張り', () => f.leash, v => f.leash = v, { min: 40, max: 2400, step: 10, fmt: v => `${v}`, def: 420, tip: '中心からこの距離を越えると戻ってくる' }),
    seg('拍に寄せる', [[0, '自由'], [0.25, '16分'], [0.5, '8分'], [1, '4分']], () => f.quant, v => { f.quant = v; }),
  ), actions(dupBtn(), delBtn(f)));
}
function roomInspector(box, m) {
  head(box, '部屋', m.name || '部屋', '中にある断片の音は、この部屋の加工を通ります。上から順に掛かります');
  const name = el('input', { type: 'text', value: m.name || '', id: 'roomName', 'aria-label': '部屋の名前', placeholder: '名前' });
  name.addEventListener('change', () => { m.name = name.value.slice(0, 24); commit(); });
  const list = el('div', { class: 'fxlist' });
  m.fx.forEach((fx, i) => list.append(fxCard(m, fx, i)));
  const add = el('select', { 'aria-label': '加える加工' }, el('option', { value: '' }, '加工を足す…'), ...W.FX_ORDER.map(k => el('option', { value: k }, W.FX[k].l)));
  add.addEventListener('change', () => { if (!add.value) return; m.fx.push(W.newFx(add.value)); eng && eng.syncRooms(); commit(); renderInspector(); });
  box.append(section('部屋', el('div', { class: 'row' }, el('label', { for: 'roomName' }, '名前'), name),
    toggle('壁を閉じる', () => m.walls, v => { m.walls = v; }, { tip: '閉じると、群れは壁を越えられない（中のものは中に、外のものは外に）' })),
    section('加工の連なり', list, add), actions(dupBtn(), delBtn(m)));
}
function fxCard(m, fx, i) {
  const sync = () => eng && eng.syncRooms();
  const ctl = [];
  const s = (label, k, o) => ctl.push(slider(label, () => fx[k], v => { fx[k] = v; if (!o.after) sync(); }, { ...o, after: o.after ? () => sync() : undefined }));
  if (fx.type === 'filter') { ctl.push(seg('型', [['lowpass', '低域'], ['highpass', '高域'], ['bandpass', '帯域'], ['notch', '切欠']], () => fx.ftype || 'lowpass', v => { fx.ftype = v; sync(); })); s('周波数', 'freq', { min: 40, max: 16000, step: 1, fmt: v => `${Math.round(v)} Hz` }); s('鋭さ', 'q', { min: 0.2, max: 20, step: 0.1, fmt: v => (+v).toFixed(1) }); }
  if (fx.type === 'drive') { s('量', 'amt', { min: 0, max: 1, fmt: fmtPct }); s('明るさ', 'tone', { min: 300, max: 16000, step: 10, fmt: v => `${Math.round(v)} Hz` }); s('混ぜ', 'mix', { min: 0, max: 1, fmt: fmtPct }); }
  if (fx.type === 'delay') { ctl.push(toggle('拍に合わせる', () => fx.sync, v => { fx.sync = v; sync(); }, { after: renderInspector })); s('間隔', 'time', fx.sync ? { min: 0.125, max: 4, step: 0.125, fmt: v => `${v} 拍` } : { min: 0.01, max: 4, step: 0.01, fmt: fmtS }); s('繰り返し', 'fb', { min: 0, max: 0.95, fmt: fmtPct }); s('明るさ', 'tone', { min: 300, max: 16000, step: 10, fmt: v => `${Math.round(v)} Hz` }); s('混ぜ', 'mix', { min: 0, max: 1, fmt: fmtPct }); }
  if (fx.type === 'verb') { s('長さ', 'size', { min: 0.2, max: 9, step: 0.1, fmt: fmtS, after: true }); s('こもり', 'damp', { min: 0, max: 1, fmt: fmtPct, after: true }); s('混ぜ', 'mix', { min: 0, max: 1, fmt: fmtPct }); }
  if (fx.type === 'crush') { s('ビット', 'bits', { min: 1, max: 12, step: 1, fmt: v => `${v} bit` }); s('混ぜ', 'mix', { min: 0, max: 1, fmt: fmtPct }); }
  if (fx.type === 'wobble') { s('揺れの速さ', 'rate', { min: 0.02, max: 12, step: 0.01, fmt: v => `${(+v).toFixed(2)} Hz` }); s('深さ', 'depth', { min: 0, max: 1, fmt: fmtPct }); s('戻り', 'fb', { min: 0, max: 0.9, fmt: fmtPct }); s('混ぜ', 'mix', { min: 0, max: 1, fmt: fmtPct }); }
  if (fx.type === 'ring') { s('周波数', 'freq', { min: 1, max: 3000, step: 1, fmt: v => `${Math.round(v)} Hz` }); s('混ぜ', 'mix', { min: 0, max: 1, fmt: fmtPct }); }
  if (fx.type === 'gate') { ctl.push(toggle('拍に合わせる', () => fx.sync, v => { fx.sync = v; sync(); }, { after: renderInspector })); s('刻み', 'rate', fx.sync ? { min: 0.25, max: 16, step: 0.25, fmt: v => `1 拍に ${v}` } : { min: 0.1, max: 30, step: 0.1, fmt: v => `${(+v).toFixed(1)} Hz` }); s('深さ', 'depth', { min: 0, max: 1, fmt: fmtPct }); }
  const move = d => { const j = i + d; if (j < 0 || j >= m.fx.length) return; [m.fx[i], m.fx[j]] = [m.fx[j], m.fx[i]]; sync(); commit(); renderInspector(); };
  return el('div', { class: 'fx' + (fx.on ? '' : ' off') },
    el('div', { class: 'fxh' },
      el('label', null, el('input', { type: 'checkbox', checked: fx.on, onchange: e => { fx.on = e.target.checked; sync(); commit(); renderInspector(); } }), el('b', null, W.FX[fx.type].l)),
      el('span', { class: 'mini' }, btn('↑', () => move(-1), { cls: 'sm', tip: '前へ' }), btn('↓', () => move(1), { cls: 'sm', tip: '後へ' }), btn('×', () => { m.fx.splice(i, 1); sync(); commit(); renderInspector(); }, { cls: 'sm', tip: '外す' }))),
    ...ctl);
}
function threadInspector(box, t) {
  const a = sim.byId.get(t.a), b = sim.byId.get(t.b);
  head(box, '糸', `${srcs.get(a?.src)?.name || '?'} → ${srcs.get(b?.src)?.name || '?'}`, '前の断片が鳴ると、少し遅れて後ろの断片が鳴ります');
  box.append(section('伝わり方',
    slider('伝わる確率', () => t.prob, v => t.prob = v, { min: 0, max: 1, fmt: fmtPct, def: 0.8 }),
    toggle('拍で数える', () => t.sync, v => { t.sync = v; }, { after: renderInspector, tip: '切ると、糸の長さが遅れの時間になる' }),
    t.sync ? slider('遅れ', () => t.beats, v => t.beats = v, { min: 0.125, max: 16, step: 0.125, fmt: v => `${v} 拍`, def: 1 })
      : slider('遅れの倍率', () => t.mul, v => t.mul = v, { min: 0.1, max: 8, step: 0.05, fmt: v => `×${(+v).toFixed(2)}`, def: 1 }),
    note('糸がつながって輪になると、確率が 1 未満である限り、いつか途切れる反復になります。'),
  ), actions(btn('向きを逆に', () => { [t.a, t.b] = [t.b, t.a]; sim.index(); commit(); renderInspector(); }), delBtn(t)));
}
function multiInspector(box, os) {
  const frags = os.filter(o => o.kind === 'frag');
  head(box, '複数', `${os.length} 個を選んでいます`, frags.length ? `うち断片 ${frags.length}` : '');
  const grouped = os.some(o => o.group);
  box.append(section('並べる',
    actions(btn('円に', () => arrange('circle')), btn('列に', () => arrange('line')), btn('散らす', () => arrange('scatter')), btn('入れ替える', () => arrange('shuffle'), { tip: '位置をランダムに入れ替える' }), btn('揺さぶる', () => arrange('shake'))),
    actions(grouped ? btn('まとまりをほどく', () => groupSel(false)) : btn('まとめる', () => groupSel(true), { tip: '⌘G' }), btn('姿を振る', () => arrange('skins')), dupBtn(), btn('削除', () => { removeIds([...S.sel]); commit(); }, { cls: 'danger' })),
  ));
  if (frags.length) box.append(section('断片をまとめて',
    seg('鳴り方', [['hit', '打'], ['loop', '環'], ['tape', '帯']], () => (frags.every(f => f.mode === frags[0].mode) ? frags[0].mode : ''), v => frags.forEach(f => { f.mode = v; })),
    seg('法則', [[0, '甲'], [1, '乙'], [2, '丙'], [-1, '無']], () => (frags.every(f => f.law === frags[0].law) ? frags[0].law : ''), v => frags.forEach(f => { f.law = v; })),
    seg('動き', [['none', '静'], ['spin', '自転'], ['orbit', '公転'], ['drift', '漂い'], ['jitter', '震え'], ['breathe', '呼吸']], () => (frags.every(f => f.move.type === frags[0].move.type) ? frags[0].move.type : ''), v => frags.forEach(f => { f.move.type = v; })),
    actions(btn('糸で順につなぐ', () => { for (let i = 0; i + 1 < frags.length; i++) world.objs.push(W.newThread(frags[i].id, frags[i + 1].id)); sim.index(); commit(); toast(`${frags.length - 1} 本の糸を張りました。`); }, { tip: '選んだ順に連鎖させる' })),
  ));
}
// live ghost markers + labels follow the laws
setInterval(() => {
  if (!ghosts.length) return;
  const o = selObjs()[0]; if (!o || o.kind !== 'frag') return;
  const { P } = sim.probe(o);
  for (const g of ghosts) {
    const v = P[g.key]; if (v == null) continue;
    g.el.style.left = `${C.clamp((v - g.min) / (g.max - g.min), 0, 1) * 100}%`;
    g.el.title = `法則のあと：${g.fmt(v)}`;
  }
}, 150);

// ---------- laws ----------
let lawIdx = 0;
function openLaws(i) { lawIdx = i ?? lawIdx; $('laws').hidden = false; $('lawsBtn').setAttribute('aria-pressed', 'true'); renderLaws(); }
function closeLaws() { $('laws').hidden = true; $('lawsBtn').setAttribute('aria-pressed', 'false'); }
function cellColor(v) {
  if (!v) return '';
  const a = Math.min(1, Math.abs(v));
  return v > 0 ? `color-mix(in oklab, var(--signal) ${Math.round(18 + a * 82)}%, transparent)` : `color-mix(in oklab, var(--accent) ${Math.round(18 + a * 82)}%, transparent)`;
}
function renderLaws() {
  const box = $('laws'); if (box.hidden) return;
  const law = world.laws[lawIdx], used = world.objs.filter(o => o.kind === 'frag' && o.law === lawIdx).length;
  const tabs = el('div', { class: 'seg' }, ...world.laws.map((l, i) => el('button', { type: 'button', 'aria-pressed': String(i === lawIdx), onclick: () => { lawIdx = i; renderLaws(); } }, l.name)));
  const read = el('p', { class: 'lawread mono', id: 'lawread' }, '升目を上下にドラッグすると強さが変わります。ダブルクリックで 0。');
  const grid = el('div', { class: 'grid', style: `grid-template-columns: 4.6em repeat(${W.TARGETS.length}, 1fr)` });
  grid.append(el('span', { class: 'corner' }, '空間 ＼ 音'));
  for (const t of W.TARGETS) grid.append(el('span', { class: 'th', title: t.d }, t.l));
  for (const s of W.SOURCES) {
    grid.append(el('span', { class: 'rh', title: s.d }, s.l));
    for (const t of W.TARGETS) {
      const key = s.k + '>' + t.k, v = law.m[key] || 0;
      const c = el('span', { class: 'cell', tabindex: '0', role: 'slider', 'aria-label': `${s.l} → ${t.l}`, 'aria-valuemin': '-1', 'aria-valuemax': '1', 'aria-valuenow': String(v), style: `background:${cellColor(v)}` });
      c.textContent = v ? (v > 0 ? '+' : '−') + Math.round(Math.abs(v) * 10) : '';
      const setV = nv => { nv = Math.round(C.clamp(nv, -1, 1) * 20) / 20; if (nv) law.m[key] = nv; else delete law.m[key]; c.style.background = cellColor(nv); c.textContent = nv ? (nv > 0 ? '+' : '−') + Math.round(Math.abs(nv) * 10) : ''; c.setAttribute('aria-valuenow', String(nv)); say(nv); };
      const say = nv => { read.textContent = `${s.l}（${s.d}）→ ${t.l}（${t.d}）  ${nv > 0 ? '+' : ''}${nv.toFixed(2)}`; };
      c.addEventListener('pointerenter', () => say(law.m[key] || 0));
      c.addEventListener('pointerdown', e => {
        e.preventDefault(); c.setPointerCapture(e.pointerId);
        const y0 = e.clientY, v0 = law.m[key] || 0;
        const mv = ev => setV(v0 + (y0 - ev.clientY) / 70);
        const up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); commit(); };
        c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up);
      });
      c.addEventListener('dblclick', () => { setV(0); commit(); });
      c.addEventListener('keydown', e => { const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key]; if (d) { e.preventDefault(); setV((law.m[key] || 0) + d); commit(); } if (e.key === 'Backspace' || e.key === '0') { setV(0); commit(); } });
      grid.append(c);
    }
  }
  box.replaceChildren(
    el('header', { class: 'lawhead' }, el('h2', null, '法則'), tabs, el('span', { class: 'sub' }, `この法則に従う断片 ${used}`),
      el('span', { class: 'acts' },
        btn('振る', () => { law.m = W.randomLaw(C.makeRng(randSeed())); commit(); renderLaws(); }, { tip: 'まばらな対応をランダムに作る' }),
        btn('消す', () => { law.m = {}; commit(); renderLaws(); }),
        btn('最初の形', () => { law.m = W.defaultLaws()[lawIdx].m; commit(); renderLaws(); }),
        btn('閉じる', closeLaws, { cls: 'sm' }))),
    el('p', { class: 'note' }, '行は空間が持つ性質、列は音の性質。升目の数字は「その性質が増えると、その音をどれだけ動かすか」。一つの行から何本でも引けます。橙は増やし、青は減らします。'),
    el('div', { class: 'gridwrap' }, grid), read);
}

// ---------- library ----------
function renderLibrary() {
  const box = $('libList'); if (!box) return;
  box.replaceChildren();
  if (!world.sources.length) { box.append(el('p', { class: 'note' }, 'まだ素材がありません。音声ファイルを画面に落とすか、「ファイルを選ぶ」から読み込んでください。')); return; }
  for (const s of world.sources) {
    const rec = srcs.get(s.id), n = world.objs.filter(o => o.kind === 'frag' && o.src === s.id).length;
    const cv = el('canvas', { class: 'mini' });
    const item = el('div', { class: 'src', draggable: 'true', title: 'ドラッグして世界に置く' },
      el('div', { class: 'srch' }, el('b', null, s.name), el('span', { class: 'mono' }, `${(rec ? rec.dur : s.dur).toFixed(2)} 秒 · 断片 ${n}`)),
      cv,
      el('div', { class: 'acts' },
        btn('▶', () => { if (!rec) return; ensureAudio().then(() => eng.audition(rec, 0, rec.dur)); }, { cls: 'sm', tip: '聴く' }),
        btn('置く', () => { const f = W.newFrag(s.id, 0, rec.dur, view.x, view.y, C.makeRng(randSeed())); addObj(f); commit(); }, { cls: 'sm' }),
        btn('刻んで撒く', () => scatterSource(s.id), { cls: 'sm', tip: '音の切れ目で刻み、まわりに散らす' }),
        btn('片づける', () => removeSource(s.id), { cls: 'sm danger' })));
    item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-sawari-src', s.id); e.dataTransfer.effectAllowed = 'copy'; });
    box.append(item);
    if (rec) requestAnimationFrame(() => D.wave(cv, rec.peaks, { dur: rec.dur, color: getComputedStyle(document.documentElement).getPropertyValue('--dim').trim() }));
  }
}
function toggleLibrary(force) {
  const on = force ?? $('lib').hidden;
  $('lib').hidden = !on; $('libBtn').setAttribute('aria-pressed', String(on));
  if (on) renderLibrary();
}

// ---------- scenes ----------
function renderScenes() {
  const box = $('scenes'); box.replaceChildren(el('span', { class: 'lab' }, '場面'));
  S.scenes.forEach((sc, i) => {
    const b = el('button', { type: 'button', class: 'scene' + (sc ? ' full' : ''), title: sc ? `場面 ${i + 1} を呼び出す（${i + 1}）／Shift で上書き` : `いまの世界を場面 ${i + 1} に残す（Shift+${i + 1}）` }, String(i + 1));
    b.addEventListener('click', e => sceneKey(i, e.shiftKey));
    box.append(b);
  });
}
function sceneKey(i, store) {
  if (store || !S.scenes[i]) { S.scenes[i] = snap(); renderScenes(); scheduleAutosave(); toast(`場面 ${i + 1} に残しました。`); return; }
  const keep = world.sources;
  const w = JSON.parse(S.scenes[i]); w.sources = keep.concat(w.sources.filter(s => !keep.find(k => k.id === s.id)));
  restore(JSON.stringify(w)); commit();
  toast(`場面 ${i + 1} を呼び出しました。`, 1500);
}

// ---------- top bar ----------
function syncTopBar() {
  if (document.activeElement !== $('bpm')) $('bpm').value = Math.round(world.bpm);
  if (document.activeElement !== $('seed')) $('seed').value = world.seed;
  $('tilt').value = world.tilt ?? 0.5;
}
function updateEmpty() {
  $('empty').hidden = world.objs.some(o => o.kind === 'frag');
}
