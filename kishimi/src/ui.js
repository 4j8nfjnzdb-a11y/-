(() => {
const $ = (id) => document.getElementById(id);
const cv = $('cv');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
let msgTimer = 0;
function msg(text, err) { const m = $('msg'); m.textContent = text || ''; m.classList.toggle('err', !!err); clearTimeout(msgTimer); if (text && !err) msgTimer = setTimeout(() => { if (m.textContent === text) m.textContent = ''; }, 9000); }

let E = null;
try { E = KishimiEngine(cv); } catch (e) { console.error(e); }
if (!E) { msg('この画面では WebGL2 が使えないため動きません。新しめの Chrome、Safari、Firefox で開いてください。', true); $('empty').querySelector('p').textContent = 'WebGL2 が使えないブラウザです。'; return; }

// ---------- the ten ways of mixing ----------
// roles: which inputs the mode reads and what each one does there.
// p: three parameters; a `choice` parameter is stored as 0..1 and shown as buttons.
const MODES = [
  { id: 'flow', k: '流れ', r: 'nagare', desc: '似た模様どうしを探して対応させ、P の形を Q の形へ運びます。いちばん「モーフィング」らしい混ぜ方です。',
    roles: { P: '出発', Q: '行き先', F: '切り替わる順' }, defF: 'noise',
    p: [{ n: '探す範囲', d: .45 }, { n: '硬さ', d: .5, lo: 'ばらばら', hi: 'まとまる' }, { n: '混ざり方', d: .12, lo: '粒で入れ替わる', hi: '溶け合う' }] },
  { id: 'thresh', k: '閾', r: 'shikii', desc: 'F の明るさを順番にして、暗い所から P が Q に置き換わります。帯を増やすと等高線のように切れます。',
    roles: { P: '残る', Q: '入ってくる', F: '順番' }, defF: 'noise',
    p: [{ n: '帯の数', d: 0, fmt: (v) => String(1 + Math.floor(v * 9.99)) }, { n: '境の柔らかさ', d: .08 }, { n: '継ぎ目', d: .35, lo: 'なし', hi: '差が光る' }] },
  { id: 'disp', k: '変位', r: 'hen-i', desc: 'F の明るさと傾きの向きに P を押し流します。F そのものは見えず、押した跡だけが残ります。',
    roles: { P: '見える', F: '押す' }, defF: 'Q',
    p: [{ n: '強さ', d: .6 }, { n: '押す向き', d: .35, lo: '明るさで回る', hi: '輪郭に沿う' }, { n: 'なめらかさ', d: .3 }] },
  { id: 'freq', k: '周波', r: 'shūha', desc: 'P の大まかな色の上に Q の細部を載せます。近くで見ると Q、離れて見ると P に見えます。',
    roles: { P: '大まか', Q: '細部' },
    p: [{ n: '細部の強さ', d: .35 }, { n: '切る深さ', d: .6 }, { n: '細部の色', d: 0, lo: '色ごと', hi: '明暗だけ' }] },
  { id: 'cells', k: '細胞', r: 'saibō', desc: '画面を細胞に割り、細胞ごとに P か Q を見せます。F の暗い細胞から順に入れ替わり、細胞は少しずつ動きます。',
    roles: { P: '地', Q: '入ってくる', F: '順番' }, defF: 'noise',
    p: [{ n: '細かさ', d: .35 }, { n: 'ずれ', d: .3 }, { n: '境界線', d: .15 }] },
  { id: 'bands', k: '帯', r: 'obi', desc: '画面を帯に裂いて、P と Q を互い違いに置きます。帯は一本ごとに、また F の明るさに応じてずれます。',
    roles: { P: '地', Q: '入ってくる', F: 'ずらす' }, defF: 'noise',
    p: [{ n: '本数', d: .4 }, { n: 'ずれ', d: .35 }, { n: '角度', d: 0, fmt: (v) => Math.round(v * 180) + '°' }] },
  { id: 'screen', k: '網', r: 'ami', desc: '網点のように Q を P の中へ細かく置きます。近くでは粒、離れると目の中で混ざります。F が明るい所ほど粒が太ります。',
    roles: { P: '地', Q: '網の粒', F: '粒を太らせる' }, defF: 'P',
    p: [{ n: '網の細かさ', d: .35 }, { n: '形', d: 0, choice: ['点', '線', '方眼'] }, { n: 'F の効き', d: .6 }] },
  { id: 'chan', k: '色層', r: 'shikisō', desc: '色を三つの成分に分けて、P・Q・F に一つずつ割り振ります。度合いを動かすと割り振りが一巡します。',
    roles: { P: '一つ目', Q: '二つ目', F: '三つ目' }, defF: 'c',
    p: [{ n: '版ずれ', d: .2 }, { n: '粒', d: .3 }, { n: '分け方', d: 0, choice: ['赤・緑・青', '明暗・色味'] }] },
  { id: 'time', k: '時間', r: 'jikan', desc: 'P の直前 2 秒ほどを覚えておき、F の明るい所ほど遅れた場面を見せます。P に動画か「前」を選ぶと効きます。',
    roles: { P: '遅らせる', Q: '最も古い所', F: '遅れの地図' }, defF: 'vert',
    p: [{ n: '深さ', d: .7 }, { n: '段', d: 0, lo: 'なめらか', hi: '階段' }, { n: 'Q の入る量', d: 0 }] },
  { id: 'diff', k: '不一致', r: 'fuitchi', desc: 'P と Q が食い違う所だけを残し、一致する所は消します。度合いを上げるほど、強い食い違いだけが残ります。',
    roles: { P: '一つ目', Q: '二つ目' },
    p: [{ n: '比べる粗さ', d: .3 }, { n: '残す側', d: 0, choice: ['明るい方', 'P', '暗い方'] }, { n: '一致の跡', d: .15 }] },
];
const MI = Object.fromEntries(MODES.map((m, i) => [m.id, i]));
const LABEL = { a: 'A', b: 'B', c: 'C', s1: '一段', fb: '前', noise: '雑音', vert: '縦', rad: '円' };
const TIP = { s1: '一段目の結果', fb: '直前のこま（自分の出力）', noise: 'ゆっくり動く雑音', vert: '下から上への明るさの傾斜', rad: '中心からの距離' };
const PICS = (si) => si ? ['s1', 'a', 'b', 'c', 'fb'] : ['a', 'b', 'c', 'fb'];
const FIELDS = (si) => [...PICS(si), 'noise', 'vert', 'rad'];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOTIONS = [['none', '止める'], ['pp', '往復'], ['drift', '揺らぎ'], ['saw', '一方向']];
const secs = (v) => .5 * Math.pow(2, v * 6);

function mkStage(si, mode, P, Q) {
  const st = { on: si === 0, mode, P, Q, F: 'noise', t: .5, mot: reduce ? 'none' : 'pp', amp: 1, per: si ? .79 : .667, tv: .5, phase: si ? .37 : .75, seed: si * 3.7, p: [0, 0, 0] };
  applyMode(st, mode);
  return st;
}
function applyMode(st, mode) {
  const m = MODES[MI[mode]];
  st.mode = mode; st.p = m.p.map((x) => x.d);
  if (m.roles.F) {
    let f = m.defF || 'noise';
    if (f === 'P') f = st.P; else if (f === 'Q') f = st.Q;
    if (f === 'c' && !E.slots[2].el) f = 'vert';
    st.F = f;
  }
}

const S = {
  aspect: 'a', res: Math.min(screen.width, screen.height) < 700 ? 720 : 1080, playing: true,
  stages: [mkStage(0, 'flow', 'a', 'b'), mkStage(1, 'thresh', 's1', 'c')],
  post: { amt: 0, blend: 0, zoom: .5, rot: .5 },
  st2Touched: false,
};

// ---------- sizing ----------
function aspectValue() {
  if (S.aspect !== 'a') { const [w, hh] = S.aspect.split(':').map(Number); return w / hh; }
  const s = E.slots.find((x) => x.el);
  return s ? clamp(s.w / s.h, .4, 2.5) : 1;
}
function applySize() {
  const a = aspectValue(), L = S.res;
  let w = a >= 1 ? L : L * a, hh = a >= 1 ? L / a : L;
  w = Math.max(2, Math.round(w / 2) * 2); hh = Math.max(2, Math.round(hh / 2) * 2);
  E.resize(w, hh);
  $('stage').style.setProperty('--asp', (w / hh).toFixed(4));
  document.querySelector('.stageCol').style.setProperty('--asp', (w / hh).toFixed(4));
}

// ---------- materials ----------
const files = [0, 1, 2].map((i) => $('file' + i));
const slotUI = [];
const URLS = [null, null, null];
const LETTERS = ['A', 'B', 'C'];
function buildSlots() {
  const wrap = $('slots');
  for (let i = 0; i < 3; i++) {
    const drop = h('button', { class: 'drop', type: 'button', 'aria-label': `${LETTERS[i]} に写真か動画を入れる`, onclick: () => files[i].click() },
      h('span', { class: 'ltr' }, LETTERS[i]), h('span', { class: 'ph' }, '写真・動画'));
    const nm = h('span', { class: 'nm' }, '空き');
    const x = h('button', { class: 'x', type: 'button', hidden: true, onclick: () => clearSlot(i) }, '外す');
    const el = h('div', { class: 'slot', 'data-i': i }, drop, h('div', { class: 'meta' }, nm, x));
    wrap.append(el);
    slotUI.push({ drop, nm, x });
    files[i].addEventListener('change', () => { const f = files[i].files[0]; if (f) loadFile(i, f); files[i].value = ''; });
    dropZone(drop, (fl) => loadFile(i, fl[0]));
  }
}
function dropZone(el, onFiles) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('on'); });
  el.addEventListener('dragleave', () => el.classList.remove('on'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('on'); const fl = [...(e.dataTransfer?.files || [])].filter((f) => /^(image|video)\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv|jpe?g|png|gif|webp|heic|avif)$/i.test(f.name)); if (fl.length) onFiles(fl); });
}
function loadFile(i, file) {
  const isVid = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);
  const url = URL.createObjectURL(file);
  const fail = () => { URL.revokeObjectURL(url); msg(`「${file.name}」を開けませんでした。${isVid ? 'このブラウザで再生できる動画形式（MP4 や WebM）か確かめてください。' : 'JPEG や PNG で試してください（HEIC は Safari 以外では開けないことがあります）。'}`, true); };
  if (isVid) {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.preload = 'auto';
    v.addEventListener('loadeddata', () => {
      place(i, v, 'video', v.videoWidth, v.videoHeight, url, file.name, `動画 ${fmtDur(v.duration)}`);
      if ('requestVideoFrameCallback' in v) { const cb = () => { if (E.slots[i].el !== v) return; E.markFresh(i); v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); }
      else v._poll = true;
      if (!S.playing) v.pause();
    }, { once: true });
    v.addEventListener('error', fail, { once: true });
    v.src = url;
    // iOS Safari loads no frame until playback starts; muted inline play is allowed without a tap
    v.play().catch(() => {});
  } else {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      let w = img.naturalWidth, hh = img.naturalHeight, src = img;
      const max = 2560;
      if (Math.max(w, hh) > max) { const k = max / Math.max(w, hh), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); src = c; w = c.width; hh = c.height; }
      place(i, src, 'image', w, hh, url, file.name, `写真 ${img.naturalWidth}×${img.naturalHeight}`, img);
    };
    img.onerror = fail;
    img.src = url;
  }
}
function fmtDur(d) { if (!isFinite(d)) return ''; const s = Math.round(d); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function place(i, el, kind, w, hh, url, name, info, thumbEl) {
  const old = E.slots[i].el;
  if (old && old.tagName === 'VIDEO') { old.pause(); old.removeAttribute('src'); old.load(); }
  if (URLS[i]) URL.revokeObjectURL(URLS[i]);
  URLS[i] = url;
  E.setSource(i, el, kind, w, hh);
  const u = slotUI[i];
  u.drop.querySelectorAll('img,video,canvas').forEach((n) => n.remove());
  u.drop.querySelector('.ph').hidden = true;
  u.drop.append(thumbEl || el);
  u.drop.classList.add('full');
  u.nm.textContent = name; u.nm.title = `${name}（${info}）`;
  u.x.hidden = false;
  if (i === 2 && !S.st2Touched && !S.stages[1].on) { S.stages[1].on = true; buildStage(1); msg('C が入ったので、二段目を「一段目 × C」でつなぎました。'); }
  else msg(`${LETTERS[i]} に「${name}」を入れました。`);
  refreshInputs();
  applySize();
  if (!S.col.init) {
    S.col.init = true;
    CL.roll(S.col, { arr: Math.random() < .5 ? 'scatter' : 'pile', count: true, src: true, cut: true, shape: true, place: true, depth: true, size: true, appear: true, motion: true, content: false, blend: false }, cctx());
    S.col.depth = .6; buildCol();
  } else if (!S.col.touched && S.col.frags.length) { CL.roll(S.col, { src: true, cut: true }, cctx()); buildCol(); }
}
function clearSlot(i) {
  const old = E.slots[i].el;
  if (old && old.tagName === 'VIDEO') { old.pause(); old.removeAttribute('src'); old.load(); }
  E.setSource(i, null);
  if (URLS[i]) { URL.revokeObjectURL(URLS[i]); URLS[i] = null; }
  const u = slotUI[i];
  u.drop.querySelectorAll('img,video,canvas').forEach((n) => n.remove());
  u.drop.querySelector('.ph').hidden = false; u.drop.classList.remove('full');
  u.nm.textContent = '空き'; u.nm.title = ''; u.x.hidden = true;
  refreshInputs(); applySize();
}
function refreshInputs() {
  const any = E.slots.some((s) => s.el);
  $('empty').hidden = any;
  $('stage').classList.toggle('loaded', any);
  $('still').disabled = !any; $('rec').disabled = !any || mime === null;
  document.querySelectorAll('.seg button[data-code]').forEach((b) => { const k = { a: 0, b: 1, c: 2 }[b.dataset.code]; if (k !== undefined) b.classList.toggle('missing', !E.slots[k].el); });
}
document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => files[+b.dataset.pick].click()));
dropZone($('stage'), (fl) => {
  let k = 0;
  for (const f of fl) {
    while (k < 3 && E.slots[k].el) k++;
    if (k >= 3) { msg('空いている枠がありません。差し替えるときは素材の枠に直接ドロップしてください。'); break; }
    loadFile(k, f); k++;
  }
});

// ---------- controls ----------
function slider({ id, label, get, set, fmt, def, lo, hi, cls }) {
  const out = h('output', { for: id });
  const inp = h('input', { type: 'range', id, min: 0, max: 1000, step: 1, value: Math.round(get() * 1000) });
  const upd = () => { out.textContent = fmt ? fmt(get()) : get().toFixed(2); };
  inp.addEventListener('input', () => { set(inp.value / 1000); upd(); });
  inp.addEventListener('dblclick', () => { if (def == null) return; set(def); inp.value = Math.round(def * 1000); upd(); });
  upd();
  return h('div', { class: 'sl' + (cls ? ' ' + cls : '') }, h('label', { for: id }, h('span', {}, label), out), inp,
    lo || hi ? h('div', { class: 'ends' }, h('span', {}, lo || ''), h('span', {}, hi || '')) : null);
}
function seg(opts, get, set, extra) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const sync = () => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(get()))));
  for (const [v, text, title, cls] of opts) wrap.append(h('button', { type: 'button', 'data-v': v, title, class: cls, 'data-code': extra?.codes ? v : null, onclick: () => { set(v); sync(); } }, text));
  sync();
  return wrap;
}
function codeOpts(list) { return list.map((c) => [c, LABEL[c], TIP[c] || null, { a: 'k-a', b: 'k-b', c: 'k-c' }[c] || null]); }

const stageEls = [$('st0'), $('st1')];
function buildStage(si) {
  const st = S.stages[si], m = MODES[MI[st.mode]], el = stageEls[si];
  el.textContent = '';
  const head = h('div', { class: 'cardHead' }, h('h2', {}, si ? '二段目' : '一段目'));
  if (si === 1) head.append(h('button', { class: 'switch', type: 'button', 'aria-pressed': String(st.on), onclick: () => { st.on = !st.on; S.st2Touched = true; buildStage(1); } }, h('i'), st.on ? '使う' : '使わない'));
  head.append(h('span', { class: 'grow' }));
  if (st.on && m.roles.Q) head.append(h('button', { class: 'btn small', type: 'button', title: 'P と Q を入れ替える', onclick: () => { [st.P, st.Q] = [st.Q, st.P]; buildStage(si); } }, '⇄ 入れ替え'));
  el.append(head);
  if (!st.on) { el.append(h('p', { class: 'note' }, '一段目の結果に、もう一つ混ぜ方を重ねます。C を入れると自動でつながります。')); refreshInputs(); return; }
  const grid = h('div', { class: 'modes', role: 'group', 'aria-label': '混ぜ方' });
  for (const md of MODES) grid.append(h('button', { class: 'mode', type: 'button', 'aria-pressed': String(md.id === st.mode), title: md.desc, onclick: () => { applyMode(st, md.id); buildStage(si); } }, h('b', {}, md.k), h('i', {}, md.r)));
  el.append(grid, h('p', { class: 'desc' }, m.desc));

  const roles = h('div', { class: 'roles' });
  for (const r of ['P', 'Q', 'F']) {
    if (!m.roles[r]) continue;
    roles.append(h('div', { class: 'role' }, h('span', {}, h('em', {}, r), m.roles[r]),
      seg(codeOpts(r === 'F' ? FIELDS(si) : PICS(si)), () => st[r], (v) => { st[r] = v; }, { codes: true })));
  }
  el.append(roles);

  // degree t with its motion
  const tWrap = h('div', { class: 'tsl' + (st.mot === 'none' ? ' still' : '') });
  const tsl = slider({ id: `t${si}`, label: '度合い', get: () => st.t, set: (v) => { st.t = v; }, def: .5, fmt: (v) => st.mot === 'none' ? v.toFixed(2) : `中心 ${v.toFixed(2)}` });
  const inp = tsl.querySelector('input'); const trk = h('div', { class: 'trk' }); inp.replaceWith(trk); trk.append(inp, h('i', { class: 'tick' }));
  tWrap.append(tsl);
  const mot = h('div', { class: 'motion' }, seg(MOTIONS.map(([v, t]) => [v, t]), () => st.mot, (v) => { st.mot = v; buildStage(si); }));
  if (st.mot !== 'none') mot.append(h('div', { class: 'params' },
    slider({ id: `amp${si}`, label: '振れ幅', get: () => st.amp, set: (v) => { st.amp = v; }, def: 1 }),
    slider({ id: `per${si}`, label: '周期', get: () => st.per, set: (v) => { st.per = v; }, def: .667, fmt: (v) => secs(v).toFixed(1) + ' 秒' })));
  tWrap.append(mot);
  el.append(tWrap);

  const ps = h('div', { class: 'params' });
  m.p.forEach((pd, k) => {
    if (pd.choice) {
      const n = pd.choice.length, idx = () => Math.round(st.p[k] * (n - 1));
      ps.append(h('div', { class: 'sl choice' }, h('span', { class: 'lab' }, h('span', {}, pd.n)),
        seg(pd.choice.map((c, j) => [String(j), c]), () => String(idx()), (v) => { st.p[k] = n > 1 ? +v / (n - 1) : 0; })));
    } else ps.append(slider({ id: `p${si}${k}`, label: pd.n, get: () => st.p[k], set: (v) => { st.p[k] = v; }, def: pd.d, fmt: pd.fmt, lo: pd.lo, hi: pd.hi }));
  });
  el.append(ps);
  refreshInputs();
}

function buildPost() {
  const el = $('post'); el.textContent = '';
  el.append(h('div', { class: 'cardHead' }, h('h2', {}, '残像'), h('span', { class: 'hint' }, '直前のこまを重ねて、時間に跡を残す')));
  el.append(h('div', { class: 'params' },
    slider({ id: 'pamt', label: '残る量', get: () => S.post.amt, set: (v) => { S.post.amt = v; }, def: 0 }),
    h('div', { class: 'sl choice' }, h('span', { class: 'lab' }, h('span', {}, '重ね方')),
      seg([['0', '混ぜる'], ['1', '明るい方'], ['2', '暗い方'], ['3', '差']], () => String(S.post.blend), (v) => { S.post.blend = +v; })),
    slider({ id: 'pzoom', label: '寄り・引き', get: () => S.post.zoom, set: (v) => { S.post.zoom = v; }, def: .5, fmt: (v) => ((v - .5) * 2).toFixed(2), lo: '引く', hi: '寄る' }),
    slider({ id: 'prot', label: '回転', get: () => S.post.rot, set: (v) => { S.post.rot = v; }, def: .5, fmt: (v) => ((v - .5) * 2).toFixed(2), lo: '左', hi: '右' })));
  el.append(h('p', { class: 'note' }, '入力に「前」を選ぶと、残像そのものを素材にして混ぜられます。'));
}
function buildOut() {
  const el = $('out'); el.textContent = '';
  el.append(h('div', { class: 'cardHead' }, h('h2', {}, '出力')));
  el.append(h('div', { class: 'role' }, h('span', {}, '縦横比'),
    seg([['a', '素材に合わせる', 'A（空なら次の素材）の縦横比'], ['1:1', '1:1'], ['4:5', '4:5'], ['9:16', '9:16'], ['16:9', '16:9']], () => S.aspect, (v) => { S.aspect = v; applySize(); })));
  el.append(h('div', { class: 'role' }, h('span', {}, '長い辺'),
    seg([['720', '720'], ['1080', '1080'], ['1440', '1440']], () => String(S.res), (v) => { S.res = +v; applySize(); })));
  el.append(h('p', { class: 'note' }, '重いときは長い辺を 720 に。素材はすべてこの端末の中で処理され、どこにも送られません。'));
}

// ---------- shake: move away from the current state, not reset ----------
function shake() {
  const notes = [], R = Math.random;
  S.stages.forEach((st, si) => {
    if (si === 1 && !st.on) return;
    const nm = si ? '二段目' : '一段目';
    if (R() < .4) {
      const others = MODES.filter((m) => m.id !== st.mode), m = others[Math.floor(R() * others.length)];
      notes.push(`${nm}を${MODES[MI[st.mode]].k}から${m.k}へ`);
      applyMode(st, m.id);
    }
    const m = MODES[MI[st.mode]];
    st.p = st.p.map((v, k) => m.p[k].choice ? (R() < .35 ? Math.floor(R() * m.p[k].choice.length) / Math.max(1, m.p[k].choice.length - 1) : v) : clamp(v + (R() - .5) * .5, 0, 1));
    if (m.roles.F && R() < .3) { const fs = FIELDS(si), f = fs[Math.floor(R() * fs.length)]; if (f !== st.F) { st.F = f; notes.push(`${nm}の F を${LABEL[f]}に`); } }
    if (m.roles.Q && R() < .2) { [st.P, st.Q] = [st.Q, st.P]; notes.push(`${nm}の P と Q を入れ替え`); }
    if (st.mot !== 'none') st.per = clamp(st.per + (R() - .5) * .3, 0, 1);
    st.seed = R() * 10;
    buildStage(si);
  });
  if (S.col.frags.length) {
    for (const f of S.col.frags) {
      f.x = clamp(f.x + (R() - .5) * .1, 0, 1); f.y = clamp(f.y + (R() - .5) * .1, 0, 1); f.s = clamp(f.s * (.85 + R() * .3), .03, 2);
      f.rot += (R() - .5) * .35; f.z = clamp(f.z + (R() - .5) * .3, 0, 1);
      const [x, y, w, hh] = f.rect; f.rect = [clamp(x + (R() - .5) * .08, 0, 1 - w), clamp(y + (R() - .5) * .08, 0, 1 - hh), w, hh]; f._recap = true;
    }
    notes.push('断片の位置と抜き出しを少しずらした'); buildCol();
  }
  if (S.post.amt > 0 && R() < .5) { S.post.zoom = clamp(S.post.zoom + (R() - .5) * .2, 0, 1); S.post.rot = clamp(S.post.rot + (R() - .5) * .2, 0, 1); buildPost(); }
  msg('揺さぶり：' + (notes.length ? notes.join('、') + '。値も少しずらしました。' : '値を少しずつずらしました。'));
}

// ---------- fragments (断片) ----------
const CL = KishimiCollage();
const PAPER = [.925, .902, .851];
const SRC_LABEL = { a: 'A', b: 'B', c: 'C', g: '地', fb: '前' };
const SRC_TIP = { g: '地（混ぜ方の結果）から抜き出す', fb: '直前のこま（出力）から抜き出す' };
const CATS = [['count', '数'], ['src', '素材'], ['cut', '抜き出し'], ['shape', '形'], ['place', '配置'], ['depth', '奥行き'], ['size', '大きさ'],
  ['appear', '出現'], ['motion', '動き'], ['content', '映像'], ['blend', '重ね方'], ['ground', '地・影・縁'], ['mix', '混ぜ方']];
S.col = { frags: [], arr: 'scatter', ground: 'mix', depth: .6, haze: .45, shadow: .4, edge: 0, cam: 0, stop: false, reroll: false, sel: -1, init: false, touched: false };
S.dice = { cats: Object.fromEntries(CATS.map(([k]) => [k, true])), every: 0, lastRoll: 0, rolls: 0 };
let cc = 0, lastRecs = null;
const lab = (list, id) => (list.find((x) => x[0] === id) || [, id])[1];
function cctx() {
  const [W, H] = E.size;
  return { asp: W / H, H, cc, hasMix: true, avail: ['a', 'b', 'c'].filter((k, i) => E.slots[i].el),
    dim: (k) => { const i = { a: 0, b: 1, c: 2 }[k]; if (i !== undefined) { const s = E.slots[i]; return s.el ? [s.w, s.h] : null; } return [W, H]; } };
}
const selFrag = () => S.col.frags.find((f) => f.id === S.col.sel) || null;
function select(id) { if (S.col.sel === id) return; S.col.sel = id; buildCol(); }

function rollMix(R = Math.random) {
  const avail = cctx().avail; if (!avail.length) return;
  const pick = (a) => a[Math.floor(R() * a.length)];
  const s0 = S.stages[0], m0 = pick(MODES).id;
  s0.P = pick(avail); s0.Q = avail.length > 1 ? pick(avail.filter((x) => x !== s0.P)) : s0.P;
  applyMode(s0, m0);
  s0.p = s0.p.map((v, k) => MODES[MI[m0]].p[k].choice ? Math.floor(R() * MODES[MI[m0]].p[k].choice.length) / Math.max(1, MODES[MI[m0]].p[k].choice.length - 1) : R());
  if (MODES[MI[m0]].roles.F && R() < .4) s0.F = pick(FIELDS(0));
  s0.mot = reduce ? 'none' : pick(['pp', 'pp', 'drift', 'saw', 'none']); s0.per = .4 + R() * .5; s0.t = .3 + R() * .4; s0.seed = R() * 10;
  const s1 = S.stages[1];
  s1.on = E.slots[2].el ? R() < .8 : R() < .3;
  if (s1.on) { const m1 = pick(MODES).id; s1.P = 's1'; s1.Q = pick(avail); applyMode(s1, m1); s1.mot = reduce ? 'none' : pick(['pp', 'drift', 'none']); s1.per = .5 + R() * .45; s1.seed = R() * 10; }
}
function diceRoll(auto) {
  const ctx = cctx();
  if (!ctx.avail.length) { if (!auto) msg('先に素材を入れてください。'); return; }
  const cats = S.dice.cats, colCats = CATS.map(([k]) => k).filter((k) => k !== 'mix' && cats[k]);
  const parts = [];
  if (colCats.length) {
    const r = CL.roll(S.col, cats, ctx);
    parts.push(`${lab(CL.ARRS, r.arr)}・${r.N} 片`);
    if (r.shape) parts.push(`主な形は${lab(CL.SHAPES, r.shape)}`);
    if (r.appear) parts.push(`${lab(CL.APPEARS, r.appear)}で${lab(CL.LIVES, r.life)}`);
    if (r.move) parts.push(`動きは${lab(CL.MOVES, r.move)}`);
    if (r.blend && r.blend !== 'normal') parts.push(`重ね方に${lab(CL.BLENDS, r.blend)}`);
    if (r.content && r.content !== 'live') parts.push(r.content === 'frozen' ? '映像は凍結' : '映像は生・コマ落とし・凍結の混在');
  }
  if (cats.mix) { rollMix(); parts.push(`地は${MODES[MI[S.stages[0].mode]].k}${S.stages[1].on ? '＋' + MODES[MI[S.stages[1].mode]].k : ''}`); }
  S.dice.lastRoll = performance.now(); S.dice.rolls++; S.col.touched = true;
  if (!selFrag()) S.col.sel = -1;
  buildCol(); buildStage(0); buildStage(1);
  const b = $('roll'); b.classList.remove('rolled'); void b.offsetWidth; b.classList.add('rolled');
  if (!auto || !S.dice.every) msg('振りました：' + (parts.join('、') || '選んだ項目がありません') + '。');
}

function buildDice() {
  const el = $('dice'); el.textContent = '';
  el.append(h('div', { class: 'cardHead' }, h('h2', {}, 'サイコロ'), h('span', { class: 'hint' }, '選んだものだけを振る'), h('span', { class: 'grow' }),
    h('button', { class: 'btn primary small', type: 'button', onclick: () => diceRoll(false) }, '振る')));
  const cats = h('div', { class: 'cats', role: 'group', 'aria-label': '振る項目' });
  const sync = () => cats.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(!!S.dice.cats[b.dataset.k])));
  for (const [k, t] of CATS) cats.append(h('button', { type: 'button', 'data-k': k, onclick: () => { S.dice.cats[k] = !S.dice.cats[k]; sync(); } }, t));
  sync();
  el.append(cats);
  el.append(h('div', { class: 'row' },
    h('button', { class: 'btn small', type: 'button', onclick: () => { for (const [k] of CATS) S.dice.cats[k] = true; sync(); } }, '全部'),
    h('button', { class: 'btn small', type: 'button', onclick: () => { for (const [k] of CATS) S.dice.cats[k] = false; sync(); } }, '外す'),
    h('span', { class: 'grow' })));
  el.append(h('div', { class: 'role' }, h('span', {}, '振り続ける'),
    seg([['0', '切'], ['3', '3 秒'], ['6', '6 秒'], ['12', '12 秒'], ['24', '24 秒']], () => String(S.dice.every), (v) => { S.dice.every = +v; S.dice.lastRoll = performance.now(); })));
  el.append(h('p', { class: 'note' }, '一回ごとに、まず配置・形・現れ方などの決まりを一つ振り、断片の四分の一ほどにだけその決まりを破らせます。全部を別々に振るより、回ごとの違いがはっきり出ます。'));
}

function arrangeAll(arr) {
  const ctx = cctx(); if (!S.col.frags.length) return;
  CL.roll(S.col, { arr, place: true, size: true, depth: true, cut: arr === 'grid' || arr === 'joiner' || arr === 'strips' }, ctx);
  S.col.touched = true; buildCol();
}
function addFrag() {
  if (S.col.frags.length >= CL.MAX) { msg(`断片は ${CL.MAX} 枚までです。`); return; }
  const ctx = cctx(), f = CL.freshFrag(S.col);
  const tmp = { frags: [f], arr: 'scatter' };
  CL.roll(tmp, { arr: 'scatter', src: true, cut: true, shape: true, place: true, depth: true, size: true, appear: true, motion: true, content: false, blend: false }, ctx);
  f.born = cc; f.life = 'once'; S.col.frags.push(f); S.col.sel = f.id; S.col.touched = true; buildCol();
}
function removeFrag(id) { S.col.frags = S.col.frags.filter((f) => f.id !== id); if (S.col.sel === id) S.col.sel = -1; S.col.touched = true; buildCol(); }
function setCount(n) {
  n = clamp(n, 0, CL.MAX);
  while (S.col.frags.length > n) S.col.frags.pop();
  while (S.col.frags.length < n) addFragQuiet();
  if (!selFrag()) S.col.sel = -1; S.col.touched = true; buildCol();
}
function addFragQuiet() { const sel = S.col.sel; addFrag(); S.col.sel = sel; }
function rollOne(f) {
  const tmp = { frags: [f], arr: 'scatter' };
  const keepId = f.id, keepLayer = f.layer;
  CL.roll(tmp, Object.assign({}, S.dice.cats, { arr: 'scatter', count: false, ground: false, mix: false, place: false }), cctx());
  // a lone fragment has no arrangement to follow: give it its own spot when placement is rolled
  if (S.dice.cats.place) { f.x = .12 + Math.random() * .76; f.y = .12 + Math.random() * .76; f.rot = (Math.random() - .5) * .6; }
  f.id = keepId; f.layer = keepLayer; f.born = cc; f.phase = 0; f._hasCap = false;
}

function fragSliders(f) {
  const P = (id, label, get, set, def, fmt, lo, hi) => slider({ id: `f${id}`, label, get, set: (v) => { set(v); S.col.touched = true; }, def, fmt, lo, hi });
  return h('div', { class: 'params' },
    P('x', '横の位置', () => f.x, (v) => { f.x = v; }, .5, (v) => v.toFixed(2), '左', '右'),
    P('y', '縦の位置', () => f.y, (v) => { f.y = v; }, .5, (v) => v.toFixed(2), '上', '下'),
    P('s', '大きさ', () => clamp((f.s - .04) / 1.4, 0, 1), (v) => { f.s = .04 + v * 1.4; }, .25, () => `${Math.round(f.s * 100)}%`),
    P('r', '回転', () => (f.rot / Math.PI + 1) / 2, (v) => { f.rot = (v * 2 - 1) * Math.PI; }, .5, () => `${Math.round(f.rot * 180 / Math.PI)}°`),
    P('z', '奥行き', () => f.z, (v) => { f.z = v; }, .5, (v) => v.toFixed(2), '手前', '奥'));
}
const pvRefresh = { fn: null, t: 0 };
function cutEditor(f) {
  const pv = h('canvas', { width: 300, height: 200 });
  const hdl = h('i', { class: 'hdl' });
  const box = h('div', { class: 'cutbox' }, hdl);
  const wrap = h('div', { class: 'cut', title: '枠を動かす・角で大きさを変える・外を押して引くと新しい枠' }, pv, box);
  const srcEl = () => { const i = { a: 0, b: 1, c: 2 }[f.src]; return i !== undefined ? E.slots[i].el : cv; };
  const place = () => { const [x, y, w, hh] = f.rect; Object.assign(box.style, { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: hh * 100 + '%' }); };
  const draw = () => {
    const el = srcEl(); if (!el) return;
    const d = cctx().dim(f.src) || [4, 3], w = 300, hh = Math.max(40, Math.round(w * d[1] / d[0]));
    if (pv.width !== w || pv.height !== hh) { pv.width = w; pv.height = hh; }
    try { pv.getContext('2d').drawImage(el, 0, 0, w, hh); } catch (e) {}
  };
  draw(); place();
  pvRefresh.fn = () => { if (!wrap.isConnected) { pvRefresh.fn = null; return; } const el = srcEl(); if (el && (el.tagName === 'VIDEO' || el === cv)) draw(); };
  let op = null;
  wrap.addEventListener('pointerdown', (e) => {
    e.preventDefault(); wrap.setPointerCapture(e.pointerId);
    const r = wrap.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height, [x, y, w, hh] = f.rect;
    if (e.target === hdl) op = { k: 'size', px, py, r0: f.rect.slice() };
    else if (px >= x && px <= x + w && py >= y && py <= y + hh) op = { k: 'move', px, py, r0: f.rect.slice() };
    else op = { k: 'new', px, py };
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!op) return;
    const r = wrap.getBoundingClientRect(), px = clamp((e.clientX - r.left) / r.width, 0, 1), py = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (op.k === 'move') { const [x, y, w, hh] = op.r0; f.rect = [clamp(x + px - op.px, 0, 1 - w), clamp(y + py - op.py, 0, 1 - hh), w, hh]; }
    else if (op.k === 'size') { const [x, y] = op.r0; f.rect = [x, y, clamp(px - x, .02, 1 - x), clamp(py - y, .02, 1 - y)]; }
    else { const x0 = Math.min(op.px, px), y0 = Math.min(op.py, py); f.rect = [x0, y0, Math.max(.02, Math.abs(px - op.px)), Math.max(.02, Math.abs(py - op.py))]; }
    f._recap = true; S.col.touched = true; place();
  });
  const end = () => { op = null; };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
  return wrap;
}

function buildCol() {
  const el = $('col'), C = S.col; el.textContent = '';
  const n = C.frags.length;
  el.append(h('div', { class: 'cardHead' }, h('h2', {}, '断片'), h('span', { class: 'hint' }, '素材から抜き出して貼る'), h('span', { class: 'grow' }),
    h('span', { class: 'count' }, h('button', { type: 'button', 'aria-label': '一枚減らす', onclick: () => setCount(n - 1) }, '−'), h('output', {}, String(n)), h('button', { type: 'button', 'aria-label': '一枚足す', onclick: () => setCount(n + 1) }, '＋'))));
  el.append(h('div', { class: 'role' }, h('span', {}, '並べ方'), seg(CL.ARRS.map(([v, t]) => [v, t]), () => C.arr, (v) => { C.arr = v; arrangeAll(v); })));
  el.append(h('div', { class: 'role' }, h('span', {}, '地'), seg([['mix', '混ぜ方'], ['black', '黒'], ['paper', '紙']], () => C.ground, (v) => { C.ground = v; C.touched = true; })));
  el.append(h('div', { class: 'params' },
    slider({ id: 'cdep', label: '奥行きの強さ', get: () => C.depth, set: (v) => { C.depth = v; }, def: .6 }),
    slider({ id: 'chaze', label: '奥の霞', get: () => C.haze, set: (v) => { C.haze = v; }, def: .45 }),
    slider({ id: 'cshadow', label: '影', get: () => C.shadow, set: (v) => { C.shadow = v; }, def: .4 }),
    slider({ id: 'cedge', label: '紙の縁', get: () => C.edge, set: (v) => { C.edge = v; }, def: 0 }),
    slider({ id: 'ccam', label: '視点の揺れ', get: () => C.cam, set: (v) => { C.cam = v; }, def: 0, lo: '止まる', hi: '視差が出る' })));
  el.append(h('div', { class: 'toggles' },
    h('button', { class: 'switch', type: 'button', 'aria-pressed': String(C.stop), onclick: () => { C.stop = !C.stop; buildCol(); } }, h('i'), '動きを止める'),
    h('button', { class: 'switch', type: 'button', 'aria-pressed': String(C.reroll), title: '巡る断片が消えるたびに、サイコロの設定で振り直す', onclick: () => { C.reroll = !C.reroll; buildCol(); } }, h('i'), '消えるたびに振り直す')));
  el.append(h('div', { class: 'role' }, h('span', {}, '映像を全部'), seg(CL.CONTENTS.map(([v, t]) => [v, t]), () => '', (v) => {
    for (const f of C.frags) { f.content = v; f._hasCap = false; f._capAt = null; } C.touched = true; buildCol();
  })));
  const list = h('div', { class: 'frags', role: 'group', 'aria-label': '断片の一覧' });
  C.frags.forEach((f, k) => list.append(h('button', { type: 'button', class: `k-${f.src}${missing(f) ? ' off' : ''}`, 'aria-pressed': String(f.id === C.sel), title: `${k + 1}：${SRC_LABEL[f.src]}・${lab(CL.SHAPES, f.shape)}・${lab(CL.APPEARS, f.appear)}`, onclick: () => select(f.id === C.sel ? -1 : f.id) }, String(k + 1), h('i', {}, SRC_LABEL[f.src]))));
  list.append(h('button', { type: 'button', onclick: addFrag, title: '断片を一枚足す' }, '＋ 足す'));
  el.append(list);
  const f = selFrag();
  if (!f) { el.append(h('p', { class: 'note' }, n ? '画面の断片か、上の番号を押すと、その断片の抜き出し・置き場所・現れ方を変えられます。' : '＋で足すか、サイコロを振ると断片が貼られます。')); return; }
  const k = C.frags.indexOf(f) + 1, ed = h('div', { class: 'fed' });
  ed.append(h('div', { class: 'cardHead' }, h('h3', {}, `断片 ${k}`), h('span', { class: 'grow' }),
    h('button', { class: 'btn small', type: 'button', onclick: () => { rollOne(f); C.touched = true; buildCol(); } }, 'これだけ振る'),
    h('button', { class: 'btn small', type: 'button', onclick: () => { if (C.frags.length >= CL.MAX) return; const nf = CL.freshFrag(C), g = Object.assign(JSON.parse(JSON.stringify(f)), { id: nf.id, layer: nf.layer, x: clamp(f.x + .04, 0, 1), y: clamp(f.y + .04, 0, 1), _hasCap: false, _recap: false }); C.frags.push(g); C.sel = g.id; C.touched = true; buildCol(); } }, '複製'),
    h('button', { class: 'btn small', type: 'button', onclick: () => removeFrag(f.id) }, '消す')));
  const row = (label, node) => h('div', { class: 'role' }, h('span', {}, label), node);
  const re = () => buildCol();
  ed.append(row('素材', seg(['a', 'b', 'c', 'g', 'fb'].map((c) => [c, SRC_LABEL[c], SRC_TIP[c] || null, { a: 'k-a', b: 'k-b', c: 'k-c' }[c] || null]), () => f.src, (v) => { f.src = v; f._recap = true; C.touched = true; re(); }, { codes: true })));
  ed.append(h('div', { class: 'sub' }, h('b', {}, '抜き出し'), cutEditor(f),
    row('形', seg(CL.SHAPES.map(([v, t]) => [v, t]), () => f.shape, (v) => { f.shape = v; re(); })),
    h('div', { class: 'params' },
      slider({ id: 'ffe', label: '縁のぼかし', get: () => clamp(f.feather / .15, 0, 1), set: (v) => { f.feather = v * .15; }, def: .07 }),
      f.shape === 'bright' || f.shape === 'dark' ? slider({ id: 'fkey', label: '明暗の境', get: () => f.key, set: (v) => { f.key = v; }, def: .5 }) : null)));
  ed.append(h('div', { class: 'sub' }, h('b', {}, '置き場所'), fragSliders(f)));
  ed.append(h('div', { class: 'sub' }, h('b', {}, '出現'),
    seg(CL.APPEARS.map(([v, t]) => [v, t]), () => f.appear, (v) => { f.appear = v; f.born = cc; f.phase = 0; }),
    row('巡り方', seg(CL.LIVES.map(([v, t]) => [v, t]), () => f.life, (v) => { f.life = v; f.born = cc; f.phase = 0; re(); })),
    f.life === 'still' ? null : h('div', { class: 'params' }, slider({ id: 'fper', label: f.life === 'once' ? '現れる長さ' : '一巡の長さ', get: () => Math.log(f.period) / Math.log(30), set: (v) => { f.period = Math.max(1, Math.pow(30, v)); }, def: Math.log(8) / Math.log(30), fmt: () => (f.life === 'once' ? f.period * .25 : f.period).toFixed(1) + ' 秒' }))));
  ed.append(h('div', { class: 'sub' }, h('b', {}, '動き'),
    seg(CL.MOVES.map(([v, t]) => [v, t]), () => f.move, (v) => { f.move = v; re(); }),
    f.move === 'none' ? null : h('div', { class: 'params' }, slider({ id: 'fspd', label: '速さ', get: () => f.speed, set: (v) => { f.speed = v; }, def: .5 }))));
  ed.append(h('div', { class: 'sub' }, h('b', {}, '映像'),
    seg(CL.CONTENTS.map(([v, t]) => [v, t]), () => f.content, (v) => { f.content = v; f._hasCap = false; f._capAt = null; re(); }),
    f.content === 'step' ? h('div', { class: 'params' }, slider({ id: 'fstep', label: 'コマの間', get: () => clamp((f.step - .05) / 2, 0, 1), set: (v) => { f.step = .05 + v * 2; }, def: .2, fmt: () => f.step.toFixed(2) + ' 秒' })) : null,
    f.content === 'frozen' ? h('button', { class: 'btn small', type: 'button', style: 'align-self:flex-start', onclick: () => { f._recap = true; f._capAt = null; msg('今のこまで凍らせ直しました。'); } }, '今のこまで凍らせ直す') : null));
  ed.append(h('div', { class: 'sub' }, h('b', {}, '重ね方'), seg(CL.BLENDS.map(([v, t]) => [v, t]), () => f.blend, (v) => { f.blend = v; }),
    h('p', { class: 'note' }, { window: '窓：抜き出さずに、その場所の素材をそのまま覗かせます。', lens: 'レンズ：下の地を拡大して見せます。', displace: '変位：断片は見えず、明暗で下の地を歪めます。', dots: '網：明るい所だけ網点で重ねます。' }[f.blend] || '')));
  el.append(ed);
  refreshInputs();
}
function missing(f) { const i = { a: 0, b: 1, c: 2 }[f.src]; return i !== undefined && !E.slots[i].el; }

// grab fragments on the screen: drag to move, wheel or two fingers to size and turn
const ptrs = new Map();
let drag = null, pinch = null;
function toUv(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r }; }
cv.addEventListener('pointerdown', (e) => {
  if (!lastRecs || !E.slots.some((s) => s.el)) return;
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const p = toUv(e), [W, H] = E.size;
  if (ptrs.size === 1) {
    const f = CL.hit(lastRecs, p.x, p.y, W / H);
    if (f) { drag = { f, x0: f.x, y0: f.y, px: e.clientX, py: e.clientY, moved: false }; if (S.col.sel !== f.id) { S.col.sel = f.id; buildCol(); } }
    else { drag = null; if (S.col.sel !== -1) { S.col.sel = -1; buildCol(); } }
  } else if (ptrs.size === 2 && selFrag()) {
    const [a, b] = [...ptrs.values()], f = selFrag();
    pinch = { f, d0: Math.hypot(b.x - a.x, b.y - a.y), a0: Math.atan2(b.y - a.y, b.x - a.x), s0: f.s, r0: f.rot }; drag = null;
  }
});
cv.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    pinch.f.s = clamp(pinch.s0 * Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, pinch.d0), .03, 2);
    pinch.f.rot = pinch.r0 + Math.atan2(b.y - a.y, b.x - a.x) - pinch.a0; S.col.touched = true;
  } else if (drag) {
    const r = cv.getBoundingClientRect();
    drag.f.x = clamp(drag.x0 + (e.clientX - drag.px) / r.width, -.2, 1.2); drag.f.y = clamp(drag.y0 + (e.clientY - drag.py) / r.height, -.2, 1.2);
    drag.moved = true; S.col.touched = true;
  }
});
const ptrEnd = (e) => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2 && pinch) { pinch = null; buildCol(); }
  if (!ptrs.size && drag) { if (drag.moved) buildCol(); drag = null; }
};
cv.addEventListener('pointerup', ptrEnd); cv.addEventListener('pointercancel', ptrEnd);
cv.addEventListener('wheel', (e) => {
  const f = selFrag(); if (!f) return;
  e.preventDefault();
  if (e.shiftKey) f.rot += e.deltaY * .003; else f.s = clamp(f.s * Math.exp(-e.deltaY * .0015), .03, 2);
  S.col.touched = true;
  clearTimeout(cv._wt); cv._wt = setTimeout(buildCol, 250);
}, { passive: false });
function updateSelBox() {
  const box = $('selbox'), f = selFrag();
  const r = f && lastRecs ? lastRecs.find((x) => x.f === f) : null;
  if (!r) { box.hidden = true; return; }
  const cr = cv.getBoundingClientRect(), sr = $('stage').getBoundingClientRect();
  box.hidden = false;
  box.style.left = (cr.left - sr.left + r.q.x * cr.width) + 'px';
  box.style.top = (cr.top - sr.top + r.q.y * cr.height) + 'px';
  box.style.width = Math.max(2, r.q.s * r.fa * cr.height) + 'px';
  box.style.height = Math.max(2, r.q.s * cr.height) + 'px';
  box.style.transform = `translate(-50%,-50%) rotate(${r.q.rot}rad)`;
}

// one collage frame: poses, rerolls, frozen captures, and the packet for the engine
function collageFrame() {
  const ctx = cctx(), C = S.col;
  let recs = CL.frame(C, cc, ctx);
  if (C.reroll) {
    let any = false;
    for (const r of recs) {
      const f = r.f;
      if (f.life === 'cycle' && f._cyc !== undefined && r.q.cycle > f._cyc) { rollOne(f); f.life = 'cycle'; any = true; }
      f._cyc = f.life === 'cycle' ? CL.life(f, cc).cycle : undefined;
    }
    if (any) { recs = CL.frame(C, cc, ctx); if (selFrag()) buildCol(); }
  }
  const caps = [];
  for (const r of recs) {
    const f = r.f;
    if (f.content === 'live' || missing(f)) continue;
    if (f.content === 'frozen' && f._hasCap && !f._recap) continue;
    if (!f._hasCap && f._capAt != null && cc < f._capAt) continue;
    if (f.content === 'step' && f._hasCap && !f._recap && clock - (f._lastCap || 0) < f.step) continue;
    const [rx, ry, rw, rh] = r.q.rect;
    caps.push({ layer: f.layer, src: f.src, rect: [rx, 1 - ry - rh, rw, rh], f });
  }
  const pk = CL.pack(recs, ctx);
  lastRecs = recs;
  const g = { mix: 0, black: 1, paper: 2 }[C.ground];
  return { n: pk.n, F: pk.F, caps, ground: g, paper: PAPER, hazeCol: g === 2 ? PAPER : g === 1 ? [0, 0, 0] : [.05, .05, .055], depth: C.depth, shadow: C.shadow, edge: C.edge, haze: C.haze };
}

// ---------- transport ----------
function setPlaying(p) {
  S.playing = p;
  const b = $('play'); b.setAttribute('aria-pressed', String(p)); b.textContent = p ? '一時停止' : '再生';
  for (const s of E.slots) if (s.el && s.el.tagName === 'VIDEO') { if (p) s.el.play().catch(() => {}); else s.el.pause(); }
}
$('play').addEventListener('click', () => setPlaying(!S.playing));
$('shake').addEventListener('click', shake);
$('roll').addEventListener('click', () => diceRoll(false));

// saving: inside the claude.ai viewer files go through the downloads capability
const inViewer = !!(window.claude && typeof window.claude.use === 'function');
const DLP = inViewer ? window.claude.use('downloads').catch(() => null) : null;
function stamp() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
async function deliver(name, blob) {
  if (inViewer) {
    const dl = await DLP;
    if (!dl) { msg('この表示ではファイルを保存できません。', true); return; }
    try { await dl.save({ filename: name, data: blob }); msg(`「${name}」を保存しました。`); }
    catch (e) { const c = e && e.code; msg(c === 'declined' ? '保存をやめました。' : c === 'rate_limited' ? '保存の確認がまだ開いています。閉じてからもう一度押してください。' : c === 'host_unavailable' ? 'このアプリでは保存できません。ブラウザかパソコンで開いてください。' : 'この表示ではファイルを保存できません。', c !== 'declined'); }
    return;
  }
  const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  msg(`「${name}」を書き出しました。`);
}
$('still').addEventListener('click', () => {
  cv.toBlob((b) => { if (b) deliver(`kishimi-${stamp()}.png`, b); else msg('静止画を作れませんでした。', true); }, 'image/png');
});

function pickMime() {
  if (!window.MediaRecorder || !cv.captureStream) return null;
  for (const m of ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
  return '';
}
const mime = pickMime();
let rec = null, recChunks = [], recStart = 0;
function toggleRec() {
  if (rec) { rec.stop(); return; }
  if (mime === null) { msg('このブラウザは録画に対応していません。静止画は保存できます。', true); return; }
  const stream = cv.captureStream(30);
  const [W] = E.size;
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: W >= 1400 ? 16e6 : W >= 1000 ? 12e6 : 8e6 } : { videoBitsPerSecond: 10e6 }); }
  catch (e) { msg('録画を始められませんでした：' + e.message, true); rec = null; return; }
  recChunks = [];
  const r = rec;
  r.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  r.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const type = r.mimeType || mime || 'video/webm', ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recChunks, { type });
    rec = null; recChunks = [];
    $('rec').setAttribute('aria-pressed', 'false'); $('recLabel').textContent = '録画'; $('recBadge').hidden = true;
    if (blob.size) deliver(`kishimi-${stamp()}.${ext}`, blob); else msg('録画が空でした。もう一度試してください。', true);
  };
  r.start(500);
  recStart = performance.now();
  $('rec').setAttribute('aria-pressed', 'true'); $('recLabel').textContent = '止めて保存'; $('recBadge').hidden = false;
}
$('rec').addEventListener('click', toggleRec);

// ---------- the loop ----------
function wave(st, time) {
  if (st.mot === 'none') return st.t;
  const x = time / secs(st.per) + st.phase, TAU = Math.PI * 2;
  let w;
  if (st.mot === 'pp') w = Math.sin(TAU * x);
  else if (st.mot === 'drift') w = (Math.sin(TAU * x) * .6 + Math.sin(TAU * x * 2.17 + 1.3) * .3 + Math.sin(TAU * x * 3.71 + .4) * .2) / 1.1;
  else w = (x - Math.floor(x)) * 2 - 1;
  return clamp(st.t + w * st.amp * .5, 0, 1);
}
let last = performance.now(), clock = 0, fpsN = 0, fpsT = 0, fps = 0, roT = 0;
function renderNow() {
  try {
    const C = E.slots.some((s) => s.el) ? collageFrame() : null;
    const got = E.render(S, clock, C) || [];
    if (C) for (const c of C.caps) if (got.includes(c.layer)) { c.f._hasCap = true; c.f._recap = false; c.f._lastCap = clock; }
  } catch (e) { console.error(e); }
  updateSelBox();
}
function loop(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  if (S.playing) clock += dt;
  if (S.playing && !S.col.stop) cc += dt;
  // real seconds: the app clock is capped per frame and runs slow on a slow device
  if (S.dice.every && S.playing && E.slots.some((s) => s.el) && now - S.dice.lastRoll >= S.dice.every * 1000) diceRoll(true);
  for (let i = 0; i < 3; i++) { const s = E.slots[i]; if (s.el && s.el._poll && !s.el.paused) E.markFresh(i); }
  S.stages.forEach((st, si) => { st.tv = wave(st, clock); stageEls[si].style.setProperty('--tv', st.tv.toFixed(4)); });
  renderNow();
  if (pvRefresh.fn && now - pvRefresh.t > 300) { pvRefresh.t = now; pvRefresh.fn(); }
  fpsN++; fpsT += dt;
  if (fpsT > .5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  if (now - roT > 250) {
    roT = now;
    const [W, H] = E.size, parts = [`${W}×${H}`];
    S.stages.forEach((st, si) => { if (si === 0 || st.on) parts.push(`${si ? '二段' : '一段'} ${MODES[MI[st.mode]].k} ${st.tv.toFixed(2)}`); });
    if (S.col.frags.length) parts.push(`断片 ${S.col.frags.length}${S.col.stop ? '（静止）' : ''}`);
    parts.push(`${fps.toFixed(0)} fps`);
    $('readout').textContent = parts.join(' · ');
    if (rec) { const s = Math.floor((now - recStart) / 1000); $('recTime').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  }
  requestAnimationFrame(loop);
}

cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); msg('描画が止まりました（GPU の都合）。ページを読み込み直してください。', true); });

buildSlots(); buildDice(); buildCol(); buildStage(0); buildStage(1); buildPost(); buildOut();
applySize(); refreshInputs();
if (mime === null) $('rec').title = 'このブラウザは録画に対応していません';
requestAnimationFrame(loop);

// handle for the offline tests (tools/test.js)
window.__kishimi = { S, E, MODES, CL, buildStage, buildCol, applyMode, setPlaying, diceRoll, collageFrame, renderNow, get clock() { return clock; }, set clock(v) { clock = v; }, get cc() { return cc; }, set cc(v) { cc = v; }, get recs() { return lastRecs; } };
})();
