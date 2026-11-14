// Kasane — the right-hand panel (what the selected sheet is made of, and what it is tied to) and the
// left-hand one (what can be laid on the composition). Every animatable property gets the same three
// handles: ◆ keyframes, 〜 a relation to a component of the sound or a number sequence, ƒ an expression.
'use strict';
(() => {
  const U = KS.U, M = KS.M, S = KS.S, UI = KS.UI, h = UI.h, SD = KS.Sound, RL = KS.Rel, FX = KS.FX;
  const IN = KS.IN = {};
  let root, binds = [], scopes = [];
  S.ui.link = true; S.ui.relOpen = {}; S.ui.fxClosed = {};

  IN.init = () => {
    root = document.getElementById('insp');
    KS.on('focusText', () => { IN.build(); const t = root.querySelector('textarea.txt'); if (t) { if (window.innerWidth <= 860) KS.setTab('insp'); t.focus(); t.select(); } });
  };
  const commit = (label) => { KS.changed(); KS.commit(label || 'edit'); };
  const rebuild = (label) => { KS.restructured(); KS.commit(label || 'edit'); };
  const sec = (title, ...kids) => h('div.sec', title ? h('h3', title) : null, ...kids);
  const plain = (label, ctl) => h('div.prow.plain', h('span.pl', label), h('span.pv', ctl));

  // ---------------------------------------------------------------- one animatable property
  function propRow(L, path) {
    const prop = M.getProp(L, path), desc = M.desc(L, path); if (!prop || !desc) return null;
    const frame = KS.frameNow(), cur = () => M.evalProp(prop, KS.frameNow().lt(L, S.t)), v0 = cur();
    const set = (v, done) => { M.setValue(prop, v, S.t); KS.changed(); if (done) KS.commit('edit'); };
    const out = []; let ctl;
    if (desc.type === 'enum') return plain(desc.label, UI.select(desc.opts.map((o, i) => [i, o]), prop.v, (v) => { prop.v = +v; rebuild(); }));
    if (desc.type === 'bool') return plain(desc.label, UI.check('', prop.v, (v) => { prop.v = v ? 1 : 0; commit(); }));
    if (desc.type === 'color') { ctl = UI.color({ value: v0, label: desc.label, onInput: set }); binds.push({ prop, L, set: (v) => ctl._set(v) }); }
    else if (desc.type === 'vec2' || desc.type === 'pt') {
      const o = { step: desc.step || 1, min: desc.min, max: desc.max };
      const a = UI.num(Object.assign({ value: v0[0], label: desc.label + ' X', onInput: (x, done) => { const c = cur(); let y = c[1]; if (desc.link && S.ui.link && Math.abs(c[0]) > 1e-6) y = U.round(c[1] * x / c[0], 2); set([x, y], done); if (desc.link && S.ui.link) UI.setNum(b, y); } }, o));
      const b = UI.num(Object.assign({ value: v0[1], label: desc.label + ' Y', onInput: (y, done) => { const c = cur(); let x = c[0]; if (desc.link && S.ui.link && Math.abs(c[1]) > 1e-6) x = U.round(c[0] * y / c[1], 2); set([x, y], done); if (desc.link && S.ui.link) UI.setNum(a, x); } }, o));
      const lk = desc.link ? h('button.pb' + (S.ui.link ? '.kf.on' : ''), { type: 'button', title: '縦横の比を保つ', html: UI.icon('link'), onclick: () => { S.ui.link = !S.ui.link; IN.build(); } }) : null;
      ctl = h('span.pv', lk, a, b); binds.push({ prop, L, set: (v) => { UI.setNum(a, v[0]); UI.setNum(b, v[1]); } });
    } else { ctl = UI.num({ value: v0, step: desc.step || 1, min: desc.min, max: desc.max, int: desc.int, unit: desc.unit && desc.unit.length === 1 ? desc.unit : '', label: desc.label, wide: true, onInput: set }); binds.push({ prop, L, set: (v) => UI.setNum(ctl, v) }); }
    const keyed = !!(prop.k && prop.k.length), tied = !!(prop.r && prop.r.length), hasX = prop.x !== undefined;
    out.push(h('div.prow', { 'data-path': path },
      h('button.pb.kf' + (keyed ? '.on' : ''), { type: 'button', title: keyed ? 'キーフレームをやめる' : 'キーフレームを打つ', 'aria-pressed': String(keyed), html: UI.icon(keyed ? 'keyOn' : 'key'), onclick: () => KS.cmd.toggleAnim(L, path) }),
      h('span.pl', { title: desc.label }, desc.label), desc.type === 'color' ? h('span.pv', ctl) : desc.type === 'num' ? h('span.pv', ctl) : ctl,
      h('button.pb.rl' + (tied ? '.on' : ''), { type: 'button', title: '音の成分や数列と結ぶ', html: UI.icon('tie'), onclick: () => addRel(L, path, prop, desc) }),
      desc.type === 'color' ? h('span') : h('button.pb.xp' + (hasX ? '.on' : ''), { type: 'button', title: '式で動かす', html: UI.icon('func'), onclick: () => { if (hasX) delete prop.x; else prop.x = ''; rebuild('expression'); } })));
    if (hasX) out.push(exprEditor(L, path, prop));
    for (const rel of prop.r || []) out.push(relEditor(L, path, prop, rel, desc));
    return out;
  }
  function exprEditor(L, path, prop) {
    const err = h('div.xerr'), show = () => { err.textContent = (prop.x && (KS.X.check(prop.x) || KS.X.errors.get(L.id + '|' + path))) || ''; };
    const ta = h('textarea', { rows: 2, spellcheck: 'false', placeholder: '例: wiggle(2, 30)　　time * 90　　loopOut("pingpong")', value: prop.x || '', 'aria-label': '式' });
    ta.addEventListener('input', () => { prop.x = ta.value; KS.changed(); setTimeout(show, 60); });
    ta.addEventListener('change', () => KS.commit('expression')); ta.addEventListener('keydown', (e) => e.stopPropagation());
    show();
    return h('div.xrow', ta, err, h('div.chips', KS.X.PRESETS.map(([name, src]) => h('button.chip', { type: 'button', title: src, onclick: () => { prop.x = src; rebuild('expression'); } }, name))));
  }

  // ---------------------------------------------------------------- a relation
  function addRel(L, path, prop, desc) {
    const pick = S.relPick && KS.layer(S.relPick.layer) ? { k: 'snd', layer: S.relPick.layer, sig: S.relPick.sig } : null;
    const comp = KS.comp(), hasSound = RL.soundLayers(comp).length > 0;
    const rel = RL.create(desc, path, pick || (hasSound ? { k: 'snd', layer: null, sig: desc.type === 'color' ? 'tone' : 'hit' } : { k: 'math', gen: 'thue', rate: 4, seed: 1, mul: 1 }));
    if (desc.type === 'color' && rel.src.sig === 'tone') { rel.cm = 'hue'; rel.amt = 360; rel.atk = rel.rel = 0.2; }
    (prop.r || (prop.r = [])).push(rel); S.ui.relOpen[rel.id] = true; S.tl.open[L.id] = S.tl.open[L.id] || 'tr';
    rebuild('relation');
    if (!hasSound && !pick) KS.toast('音がまだないので、数列と結びました。音や動画を読み込むと音の成分を選べます');
  }
  function relEditor(L, path, prop, rel, desc) {
    const comp = KS.comp(), open = !!S.ui.relOpen[rel.id], isMath = rel.src.k === 'math', src = rel.src;
    const N = (label, key, o, obj = rel) => h('label.fld', h('span', { title: o.title || label }, label), UI.num(Object.assign({ value: obj[key] === undefined ? o.def : obj[key], label, onInput: (v, done) => { obj[key] = v; KS.changed(); if (done) KS.commit('relation'); } }, o)));
    const Sel = (label, key, opts, obj = rel) => h('label.fld', h('span', label), UI.select(opts, obj[key], (v) => { obj[key] = isNaN(+v) || v === '' ? v : (typeof obj[key] === 'number' ? +v : v); rebuild('relation'); }));
    const srcSel = UI.select(SD.GROUPS.map(([g, items]) => [g, items.map(([id, n]) => ['snd:' + id, n])]).concat([['数列（音を使わない）', SD.MATH.map(([id, n]) => ['math:' + id, n])]]), isMath ? 'math:' + src.gen : 'snd:' + src.sig, (v) => {
      const [k, id] = v.split(':');
      rel.src = k === 'math' ? { k: 'math', gen: id, rate: src.rate || 4, seed: src.seed || 1, sync: src.sync || false, mul: src.mul || 1 } : { k: 'snd', layer: src.layer || null, sig: id };
      rebuild('relation');
    }, { grouped: true, label: '源' });
    const modeSel = UI.select(RL.MODES.map((m) => [m[0], m[1]]), rel.mode, (v) => { rel.mode = v; if (v === 'step' && rel.atk < 0.04) { rel.atk = rel.rel = 0.06; } rebuild('relation'); }, { label: '態度' });
    let amt;
    if (desc.type === 'color') amt = rel.cm === 'hue' ? N('回す角度', 'amt', { step: 5, unit: '°', def: 360 }) : h('label.fld', h('span', '行き先の色'), UI.color({ value: rel.to || [1, 1, 1, 1], noAlpha: true, onInput: (v, done) => { rel.to = v; KS.changed(); if (done) KS.commit('relation'); } }));
    else if (U.isArr(rel.amt)) { const mk = (i) => UI.num({ value: rel.amt[i], step: desc.step || 1, label: '量', onInput: (v, done) => { rel.amt[i] = v; KS.changed(); if (done) KS.commit('relation'); } }); amt = h('label.fld.full', h('span', '動く量（横・縦）'), h('span.pv', mk(0), mk(1))); }
    else amt = N('動く量', 'amt', { step: desc.step || 1, unit: desc.unit && desc.unit.length === 1 ? desc.unit : '', def: 20 });
    const cv = h('canvas.scope', { width: 420, height: 68, title: '再生位置の前後3秒で、この関係がプロパティに足す量' });
    scopes.push({ cv, L, rel });
    const mode = RL.MODES.find((m) => m[0] === rel.mode) || RL.MODES[0];
    const kids = [
      h('div.relh', srcSel, modeSel,
        h('button.pb' + (rel.on === false ? '' : '.rl.on'), { type: 'button', title: rel.on === false ? 'この関係を入れる' : 'この関係を切る', html: UI.icon(rel.on === false ? 'eyeOff' : 'eye'), onclick: () => { rel.on = rel.on === false; rebuild('relation'); } }),
        h('button.pb', { type: 'button', title: 'この関係を消す', html: UI.icon('trash'), onclick: () => { prop.r = prop.r.filter((r) => r !== rel); if (!prop.r.length) delete prop.r; rebuild('relation'); } })),
      h('p.reln', mode[2]), h('div.relg', amt, desc.type === 'color' ? Sel('色の動かし方', 'cm', [['mix', '別の色へ寄る'], ['hue', '色相を回す']]) : N('余韻', 'rel', { step: 0.01, min: 0.005, max: 8, unit: 's', digits: 2, def: 0.2 })), cv,
      h('button.more', { type: 'button', 'aria-expanded': String(open), onclick: () => { S.ui.relOpen[rel.id] = !open; IN.build(); } }, h('span', { html: UI.icon(open ? 'down' : 'right') }), open ? '閉じる' : '細かく詰める'),
    ];
    if (open) {
      const g = [];
      const snds = RL.soundLayers(comp);
      if (!isMath && snds.length > 1) g.push(Sel('聴く音', 'layer', [['', '最初の音']].concat(snds.map((l) => [l.id, l.name])), src));
      if (isMath) {
        if (snds.length) g.push(h('label.fld', h('span', '音の拍に乗せる'), UI.check('', !!src.sync, (v) => { src.sync = v; rebuild('relation'); })));
        g.push(src.sync ? N('1拍あたりの歩数', 'mul', { step: 0.001, min: 0.05, max: 16, digits: 3, def: 1, title: '1.618 にすると拍に対して少しずつずれていきます' }, src) : N('速さ', 'rate', { step: 0.1, min: 0.01, max: 60, unit: '/s', digits: 2, def: 4 }, src));
        if (src.gen === 'logistic') g.push(N('r', 'a', { step: 0.01, min: 0, max: 4, digits: 3, def: 3.7, title: '3 までは一つの値、3.45 までは二つの値の往復、3.57 を超えると混沌' }, src));
        if (src.gen === 'walk') g.push(N('歩幅', 'a', { step: 0.01, min: 0, max: 1, digits: 2, def: 0.3 }, src));
        if (src.gen === 'ca') g.push(N('規則の番号', 'a', { step: 1, min: 0, max: 255, int: true, def: 30, title: '30 は混沌、90 は入れ子の三角、110 は構造が走る' }, src));
        if (src.gen === 'euclid') { g.push(N('打つ数', 'a', { step: 1, min: 0, max: 64, int: true, def: 5 }, src)); g.push(N('長さ', 'b', { step: 1, min: 1, max: 64, int: true, def: 8 }, src)); }
        if (src.gen === 'sieve') { const inp = h('input.num.wide', { type: 'text', value: src.expr || '3@0|4@1', style: 'width:120px;text-align:left;cursor:text', title: '「割る数@余り」を |（どちらか）と &（両方）でつなぐ', onchange: () => { src.expr = inp.value; rebuild('relation'); }, onkeydown: (e) => e.stopPropagation() }); g.push(h('label.fld.full', h('span', 'ふるいの式'), inp)); }
        if (['walk', 'dice', 'ca'].includes(src.gen)) g.push(N('種', 'seed', { step: 1, min: 0, max: 999, int: true, def: 1 }, src));
      }
      g.push(N('ずらし', 'shift', { step: 0.01, min: -4, max: 4, unit: 's', digits: 2, def: 0, title: '負にすると、音より先に動きます' }));
      g.push(N('先ぶれ', 'pre', { step: 0.01, min: 0, max: 3, unit: 's', digits: 2, def: 0, title: '打点の前から立ち上がり、打点の瞬間に頂点へ届きます' }));
      if (desc.type !== 'color') g.push(N('立ち上がり', 'atk', { step: 0.01, min: 0.001, max: 8, unit: 's', digits: 2, def: 0.02 })); else g.push(N('余韻', 'rel', { step: 0.01, min: 0.005, max: 8, unit: 's', digits: 2, def: 0.2 }));
      g.push(N('しきい値', 'th', { step: 0.01, min: 0, max: 0.95, digits: 2, def: 0, title: 'これより小さい値には反応しません' }));
      g.push(N('曲がり', 'curve', { step: 0.05, min: 0.1, max: 6, digits: 2, def: 1, title: '1 より大きいと強い音にだけ、小さいと弱い音にもよく反応します' }));
      if (rel.mode === 'betray') { g.push(N('従う回数', 'obey', { step: 1, min: 1, max: 32, int: true, def: 3 })); g.push(Sel('回数の決め方', 'obeySeq', RL.OBEY)); g.push(Sel('裏切り方', 'how', RL.HOW)); }
      if (rel.mode === 'step') { g.push(N('段の数', 'steps', { step: 1, min: 2, max: 64, int: true, def: 5 })); g.push(Sel('並び', 'stepPat', RL.STEPS)); }
      if (rel.mode === 'deaf') g.push(N('拍に対する比', 'ratio', { step: 0.001, min: 0.05, max: 8, digits: 3, def: 1.618, title: '1.618（黄金比）や 0.707 は、音の拍といつまでも揃いません' }));
      if (rel.mode === 'store') g.push(N('溜まる量', 'fill', { step: 0.1, min: 0.1, max: 64, digits: 1, def: 2, title: '打点なら何発ぶん、音量なら何秒ぶん溜まると放つか' }));
      if (U.isArr(rel.amt)) g.push(h('label.fld', h('span', '打点ごとに向きを変える'), UI.check('', !!rel.spin, (v) => { rel.spin = v ? 1 : 0; rebuild('relation'); })));
      if (rel.spin || rel.mode === 'step' || rel.obeySeq === 'dice') g.push(N('種', 'seed', { step: 1, min: 0, max: 999, int: true, def: 1 }));
      kids.push(h('div.relg', g));
    }
    return h('div.rel' + (rel.on === false ? '.off' : ''), kids);
  }
  IN.drawScopes = () => {
    const comp = KS.comp(); if (!comp) return;
    for (const s of scopes) {
      if (!s.cv.isConnected) continue;
      const c = s.cv.getContext('2d'), w = s.cv.width, hh = s.cv.height, curve = RL.baked(comp, s.L, s.rel);
      c.clearRect(0, 0, w, hh);
      c.strokeStyle = 'rgba(232,236,230,.14)'; c.beginPath(); c.moveTo(0, hh * 0.66); c.lineTo(w, hh * 0.66); c.stroke();
      c.strokeStyle = '#c9a2f2'; c.lineWidth = 2; c.beginPath();
      for (let x = 0; x <= w; x += 2) { const t = S.t + (x / w - 0.5) * 6, y = hh * 0.66 - U.clamp(RL.sample(curve, t), -0.55, 1.6) * hh * 0.4; if (x) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke();
      c.strokeStyle = '#e9c84a'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, hh); c.stroke();
    }
  };

  // ---------------------------------------------------------------- effects
  IN.fxPicker = (anchor, L) => {
    const list = h('div.menu'), search = h('input.search', { type: 'search', placeholder: 'エフェクトを探す', 'aria-label': 'エフェクトを探す', onkeydown: (e) => e.stopPropagation() });
    const fill = () => {
      const q = search.value.trim().toLowerCase(); list.replaceChildren();
      for (const cat of FX.cats) {
        const items = FX.order.map((id) => FX.defs[id]).filter((d) => d.cat === cat && (!q || (d.name + (FX.HINT[d.id] || '') + d.id).toLowerCase().includes(q)));
        if (!items.length) continue;
        list.append(h('div.msep', cat));
        for (const d of items) list.append(h('button.mi', { type: 'button', onclick: () => { UI.closePop(); const fx = KS.cmd.addEffect(d.id, L); if (fx && d.pins) { KS.setTool('pin'); KS.V.note('レイヤーの上を押すとピンが打てます。<b>ピンをつかんで引くと曲がります</b>', 5000); } } }, h('span.ml', h('b', d.name), FX.HINT[d.id] ? h('small', FX.HINT[d.id]) : null)));
      }
    };
    search.addEventListener('input', fill); fill();
    UI.pop(anchor, h('div', search, list), { width: 300, force: true });
    if (window.innerWidth > 860) search.focus();
  };
  function fxBlock(L, fx, i) {
    const def = FX.defs[fx.type]; if (!def) return null;
    const closed = !!S.ui.fxClosed[fx.id];
    const dice = () => {
      for (const pd of def.params) {
        const p = fx.p[pd.id]; if (!p || (p.k && p.k.length) || pd.type === 'pt' || pd.type === 'bool' || pd.id === 'room' || pd.id === 'mix' || pd.id === 'keep') continue;
        if (pd.type === 'enum') p.v = Math.floor(Math.random() * pd.opts.length);
        else if (pd.type === 'color') p.v = [Math.random(), Math.random(), Math.random(), 1];
        else if (pd.type === 'num') { const lo = pd.min !== undefined ? pd.min : p.v * 0.3 - 20, hi = pd.max !== undefined ? pd.max : p.v * 2 + 20, a = lo + (hi - lo) * (0.5 + (Math.random() - 0.5) * 0.7 * (0.4 + Math.random())); p.v = pd.int ? Math.round(a) : U.round(Math.min(hi, Math.max(lo, pd.px && hi > 300 ? lo + Math.random() * Math.random() * (hi - lo) * 0.5 : a)), 2); }
      }
      rebuild('dice');
    };
    const move = (d) => { const j = i + d; if (j < 0 || j >= L.fx.length) return; L.fx.splice(i, 1); L.fx.splice(j, 0, fx); rebuild('reorder'); };
    const head = h('div.fxh',
      h('button.pb' + (fx.on ? '.kf.on' : ''), { type: 'button', title: fx.on ? '効果を切る' : '効果を入れる', html: UI.icon(fx.on ? 'eye' : 'eyeOff'), onclick: () => { fx.on = !fx.on; rebuild('fx'); } }),
      h('b', { onclick: () => { S.ui.fxClosed[fx.id] = !closed; IN.build(); }, title: FX.HINT[fx.type] || def.name }, def.name),
      h('button.pb', { type: 'button', title: 'サイコロ：値を振り直す', html: UI.icon('dice'), onclick: dice }),
      h('button.pb', { type: 'button', title: '先に掛ける', html: UI.icon('up'), onclick: () => move(-1) }), h('button.pb', { type: 'button', title: '後に掛ける', html: UI.icon('down'), onclick: () => move(1) }),
      h('button.pb', { type: 'button', title: '消す', html: UI.icon('trash'), onclick: () => { L.fx = L.fx.filter((f) => f !== fx); rebuild('remove effect'); } }));
    const body = [];
    if (!closed) {
      for (const pd of def.params) body.push(propRow(L, `fx.${fx.id}.${pd.id}`));
      if (def.pins) { body.push(h('div.row2', h('span', `ピン ${fx.pins.length} 本`), h('button.btn.small', { type: 'button', onclick: () => { KS.setTool('pin'); } }, 'ピンを打つ'), fx.pins.length ? h('button.btn.small', { type: 'button', onclick: () => { fx.pins = []; rebuild('pins'); } }, 'すべて抜く') : null)); for (const q of fx.pins) body.push(propRow(L, `fx.${fx.id}.pin.${q.id}`)); }
      if (def.process) body.push(h('p.hint.pad', 'レイヤーの最初のコマから積み重なる変化です。途中から見ても同じ結果になるよう、必要なぶんを計算し直します。'));
    }
    return h('div.fxb' + (fx.on ? '' : '.off'), head, body);
  }

  // ---------------------------------------------------------------- keyframe easing
  const EASES = [['リニア', null], ['ゆるやか', U.EASE.ease], ['ゆっくり出る', U.EASE.in], ['ゆっくり着く', U.EASE.out], ['強く', U.EASE.strong], ['行き過ぎる', U.EASE.back], ['はずむ', U.EASE.spring], ['一気に', U.EASE.snap]];
  function easeSection() {
    const ks = KS.selKeys(); if (!ks.length) return null;
    const k0 = ks[0].key, comp = KS.comp();
    const cv = h('canvas', { width: 600, height: 260 }), e = () => (k0.e ? k0.e : [0, 0, 1, 1]);
    const draw = () => {
      const c = cv.getContext('2d'), w = cv.width, hh = cv.height, pad = 40, X = (x) => pad + x * (w - 2 * pad), Y = (y) => hh - pad - y * (hh - 2 * pad), b = e();
      c.clearRect(0, 0, w, hh); c.strokeStyle = 'rgba(232,236,230,.12)'; c.lineWidth = 1; c.strokeRect(X(0), Y(1), X(1) - X(0), Y(0) - Y(1));
      c.strokeStyle = 'rgba(232,236,230,.4)'; c.beginPath(); c.moveTo(X(0), Y(0)); c.lineTo(X(b[0]), Y(b[1])); c.moveTo(X(1), Y(1)); c.lineTo(X(b[2]), Y(b[3])); c.stroke();
      c.strokeStyle = '#e9c84a'; c.lineWidth = 3; c.beginPath(); c.moveTo(X(0), Y(0)); c.bezierCurveTo(X(b[0]), Y(b[1]), X(b[2]), Y(b[3]), X(1), Y(1)); c.stroke();
      c.fillStyle = '#e8ece6'; for (const p of [[b[0], b[1]], [b[2], b[3]]]) { c.beginPath(); c.arc(X(p[0]), Y(p[1]), 8, 0, 7); c.fill(); }
    };
    let grab = -1;
    const at = (ev) => { const r = cv.getBoundingClientRect(), pad = 40 * r.width / cv.width; return [(ev.clientX - r.left - pad) / (r.width - 2 * pad), 1 - (ev.clientY - r.top - pad * (r.height / r.width) * (cv.width / cv.height)) / (r.height - 2 * pad * (r.height / r.width) * (cv.width / cv.height))]; };
    cv.addEventListener('pointerdown', (ev) => { const p = at(ev), b = e(); grab = Math.hypot(p[0] - b[0], p[1] - b[1]) < Math.hypot(p[0] - b[2], p[1] - b[3]) ? 0 : 1; cv.setPointerCapture(ev.pointerId); ev.preventDefault(); });
    cv.addEventListener('pointermove', (ev) => { if (grab < 0) return; const p = at(ev), b = e().slice(); b[grab * 2] = U.round(U.clamp(p[0], 0, 1), 3); b[grab * 2 + 1] = U.round(U.clamp(p[1], -1, 2), 3); for (const s of ks) { s.key.e = b.slice(); delete s.key.h; } draw(); KS.changed(); });
    cv.addEventListener('pointerup', () => { if (grab >= 0) { grab = -1; KS.commit('ease'); } });
    draw();
    const same = (a, b) => (!a && !b) || (a && b && a.every((x, i) => Math.abs(x - b[i]) < 0.002));
    return sec(`キーフレーム ${ks.length} 個の動き方`,
      h('div.chips.pad', EASES.map(([name, cur]) => h('button.chip' + (!k0.h && same(k0.e, cur) ? '.on' : ''), { type: 'button', onclick: () => { KS.cmd.ease(cur, false); IN.build(); } }, name)), h('button.chip' + (k0.h ? '.on' : ''), { type: 'button', title: '次のキーまで値を保って、そこで切り替わる', onclick: () => { KS.cmd.ease(undefined, !k0.h); IN.build(); } }, '止めて切り替え')),
      h('div.easebox', cv), ks.length === 1 ? plain('時間', UI.num({ value: k0.t, step: 1 / comp.fps, min: 0, digits: 3, unit: 's', wide: true, onInput: (v, done) => { k0.t = M.snap(comp, v); if (done) { M.sortKeys(ks[0].prop); KS.restructured(); KS.commit('key time'); } else KS.changed(); } })) : null,
      h('p.hint.pad', 'このキーから次のキーまでの、時間に対する進み方です。'));
  }

  // ---------------------------------------------------------------- the panel
  IN.build = () => {
    if (!root) return;
    const top = root.scrollTop, comp = KS.comp(); binds = []; scopes = [];
    if (!comp) { root.replaceChildren(); return; }
    const L = KS.firstSel(), n = S.sel.layers.length, kids = [];
    const es = easeSection(); if (es) kids.push(es);
    if (!L) kids.push(...compPanel(comp));
    else {
      const nameIn = h('input', { type: 'text', value: L.name, 'aria-label': 'レイヤーの名前', onchange: () => { L.name = nameIn.value.trim() || L.name; rebuild('rename'); }, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') nameIn.blur(); } });
      kids.push(h('div.ihead', h('button.chipl', { type: 'button', title: 'ラベルの色を変える', style: `background:${M.LABELS[L.label % M.LABELS.length]}`, onclick: () => { L.label = (L.label + 1) % M.LABELS.length; rebuild('label'); } }), nameIn, h('span', { style: 'color:var(--faint);font-size:11px;flex:none' }, n > 1 ? `ほか ${n - 1}` : M.TYPES[L.type])));
      if (L.tr) kids.push(h('div.acts3',
        h('button.abtn.tie', { type: 'button', title: '音の成分や数列と、このレイヤーの動きを結ぶ', html: UI.icon('tie') + '<span>音と結ぶ</span>', onclick: (e) => methodMenu(e.currentTarget) }),
        h('button.abtn', { type: 'button', html: UI.icon('fx') + '<span>エフェクト</span>', onclick: (e) => IN.fxPicker(e.currentTarget, L) }),
        h('button.abtn', { type: 'button', html: UI.icon('key') + '<span>動きの型</span>', onclick: (e) => UI.menu(e.currentTarget, KS.PRESETS.filter((p) => !p.only || p.only === L.type).map((p) => ({ label: p.name, run: () => KS.cmd.preset(p.id) })), { force: true }) })));
      if (L.type === 'text') {
        const ta = h('textarea.txt', { 'aria-label': '文字', value: L.d.str });
        ta.addEventListener('input', () => { L.d.str = ta.value; KS.changed(); }); ta.addEventListener('change', () => KS.commit('text')); ta.addEventListener('keydown', (e) => e.stopPropagation());
        kids.push(sec('文字', h('div.pad', ta),
          h('div.row2', UI.select(KS.Fonts.list.map((f) => [f.id, f.name]), L.d.font, (v) => { L.d.font = v; rebuild('font'); }, { label: '書体' }), UI.select([[400, '細め'], [700, '太め'], [900, '極太']], L.d.weight, (v) => { L.d.weight = +v; rebuild('weight'); }, { label: '太さ' }), UI.select([['left', '左'], ['center', '中央'], ['right', '右']], L.d.align, (v) => { L.d.align = v; rebuild('align'); }, { label: '揃え' })),
          M.typePropNames(L).map((k) => propRow(L, 'p.' + k))));
      } else if (L.type === 'shape') {
        kids.push(sec('図形', L.d.kind !== 'path' ? plain('形', UI.select([['rect', '四角'], ['ellipse', '円'], ['poly', '多角形'], ['star', '星']], L.d.kind, (v) => { L.d.kind = v; rebuild('shape'); })) : null,
          plain('塗る', UI.check('', L.d.fillOn !== false, (v) => { L.d.fillOn = v; commit('fill'); })), M.typePropNames(L).map((k) => propRow(L, 'p.' + k))));
      } else if (L.type === 'solid') {
        kids.push(sec('平面', propRow(L, 'p.color'), plain('大きさ', h('span.pv', UI.num({ value: L.d.w, min: 1, max: 8192, int: true, onInput: (v, d) => { L.d.w = v; KS.changed(); if (d) KS.commit('size'); } }), UI.num({ value: L.d.h, min: 1, max: 8192, int: true, onInput: (v, d) => { L.d.h = v; KS.changed(); if (d) KS.commit('size'); } })))));
      } else if (L.type === 'video' || L.type === 'audio') {
        const an = SD.get(L.src), busy = SD.pending.has(L.src);
        kids.push(sec('音', L.p.vol ? propRow(L, 'p.vol') : null,
          an ? h('div.row2', h('span', `拍の間隔 ${U.fmtNum(an.period[Math.min(an.n - 1, Math.round(Math.max(0, S.t - L.start) * 100))] / 100, 2)} 秒 · 打点 ${an.onsets.length}`), h('button.btn.small', { type: 'button', onclick: () => { S.tl.open[L.id] = 'tr'; KS.emit('struct'); if (window.innerWidth <= 860) KS.setTab('tl'); } }, '成分を見る'))
            : h('p.hint.pad', busy ? '音を成分に読み分けています…' : KS.Media.audio(L.src) ? '' : L.type === 'video' ? 'この動画には読める音がありません。' : '音を読み込めていません。')));
      } else if (L.type === 'comp') kids.push(sec('コンポジション', h('div.row2', h('button.btn.small', { type: 'button', onclick: () => KS.cmd.openComp(L.comp) }, '中を開く'))));
      if (L.tr) kids.push(sec('置き方', M.TR_ORDER.map((k) => propRow(L, 'tr.' + k)),
        plain('重ね方', UI.select(M.BLENDS, L.blend, (v) => { L.blend = v; rebuild('blend'); })),
        L.tr.p.k && L.tr.p.k.length > 2 ? plain('軌道をなめらかに', UI.check('', !!L.tr.p.sm, (v) => { if (v) L.tr.p.sm = 1; else delete L.tr.p.sm; commit('path'); })) : null));
      // masks
      const mks = L.masks || [];
      if (mks.length) kids.push(sec('マスクとちぎり目', mks.map((mk, i) => h('div.fxb',
        h('div.fxh', h('b', { onclick: () => { S.sel.mask = mk.id; KS.emit('sel'); } }, mk.torn ? `ちぎり目 ${i + 1}` : `マスク ${i + 1}`),
          mk.torn ? null : UI.select([['add', '足す'], ['subtract', '引く'], ['intersect', '重なりだけ']], mk.mode, (v) => { mk.mode = v; rebuild('mask'); }),
          mk.torn ? null : UI.check('反転', mk.inv, (v) => { mk.inv = v; commit('mask'); }),
          h('button.pb', { type: 'button', title: mk.torn ? 'ちぎり目をなくす' : 'マスクを消す', html: UI.icon('trash'), onclick: () => { L.masks = L.masks.filter((m) => m !== mk); rebuild('mask'); } })),
        mk.torn ? [plain('ぎざぎざ', UI.num({ value: mk.torn.rough, min: 0, max: 200, step: 0.5, onInput: (v, d) => { mk.torn.rough = v; KS.changed(); if (d) KS.commit('tear'); } })), plain('紙の白い繊維', UI.num({ value: mk.torn.fibre, min: 0, max: 100, step: 0.5, onInput: (v, d) => { mk.torn.fibre = v; KS.changed(); if (d) KS.commit('tear'); } }))]
          : Object.keys(M.MASK_PROPS).map((k) => propRow(L, `mk.${mk.id}.${k}`))))));
      if (L.tr) kids.push(sec('エフェクト', (L.fx || []).map((fx, i) => fxBlock(L, fx, i)), !(L.fx || []).length ? h('p.hint.pad', 'マスク → エフェクト（上から順）→ 置き方、の順に掛かります。') : null));
      // time and ties to other layers
      const others = comp.layers.filter((l) => l !== L && l.tr);
      kids.push(sec('時間とつながり',
        plain('始まり・終わり', h('span.pv', UI.num({ value: L.in, step: 1 / comp.fps, digits: 2, unit: 's', onInput: (v, d) => { L.in = Math.min(v, L.out - 1 / comp.fps); KS.changed(); if (d) KS.commit('in'); } }), UI.num({ value: L.out, step: 1 / comp.fps, digits: 2, unit: 's', onInput: (v, d) => { L.out = Math.max(v, L.in + 1 / comp.fps); KS.changed(); if (d) KS.commit('out'); } }))),
        ['video', 'audio', 'comp'].includes(L.type) ? plain('速さ', UI.num({ value: (L.speed || 1) * 100, min: 5, max: 1600, step: 1, unit: '%', onInput: (v, d) => { L.speed = v / 100; KS.changed(); if (d) KS.commit('speed'); } })) : null,
        L.tr ? plain('コマ落とし', UI.select([[0, 'しない'], [24, '24'], [15, '15'], [12, '12'], [8, '8'], [6, '6'], [4, '4'], [2, '2']].map(([v, l]) => [v, v ? `毎秒 ${l} コマ` : l]), L.step || 0, (v) => { L.step = +v; rebuild('step'); })) : null,
        L.tr ? plain('親', UI.select([['', 'なし']].concat(others.map((l) => [l.id, l.name])), L.parent || '', (v) => { reparent(L, v || null); rebuild('parent'); })) : null,
        L.tr ? plain('抜き型にする相手', h('span.pv', UI.select([['', 'なし']].concat(others.map((l) => [l.id, l.name])), L.matte ? L.matte.id : '', (v) => { L.matte = v ? { id: v, mode: L.matte ? L.matte.mode : 'a' } : null; const ml = v && KS.layer(v); if (ml) ml.vis = false; rebuild('matte'); }),
          L.matte ? UI.select(M.MATTES, L.matte.mode, (v) => { L.matte.mode = v; rebuild('matte'); }) : null)) : null));
    }
    root.replaceChildren(...kids.flat(4).filter(Boolean));
    root.scrollTop = top;
    IN.drawScopes();
  };
  // keep the layer where it is on screen when its parent changes
  function reparent(L, pid) {
    const f = KS.frameNow(), W = f.world(L); L.parent = pid;
    if (L.tr.p.k || L.tr.r.k || L.tr.s.k) return;
    const P = pid ? f.world(KS.layer(pid)) : U.mIdent(), loc = U.mMul(U.mInv(P), W), a = L.tr.a.v;
    const sx = Math.hypot(loc[0], loc[1]), sy = Math.hypot(loc[2], loc[3]) * (loc[0] * loc[3] - loc[1] * loc[2] < 0 ? -1 : 1), p = U.mApply(loc, a[0], a[1]);
    L.tr.p.v = [U.round(p[0], 2), U.round(p[1], 2)]; L.tr.r.v = U.round(U.mRotOf(loc), 2); L.tr.s.v = [U.round(sx * 100, 2), U.round(sy * 100, 2)];
  }
  function methodMenu(anchor) {
    const comp = KS.comp(), has = RL.soundLayers(comp).length > 0;
    const run = (id) => { for (const L of KS.selLayers()) { if (!L.tr) continue; RL.method(id, L); S.tl.open[L.id] = S.tl.open[L.id] || 'tr'; } rebuild('method'); KS.toast('結びました。プロパティの下の紫の枠で、量や態度を細かく変えられます'); };
    UI.menu(anchor, [
      has ? null : { label: 'まだ音がありません', hint: '音や動画を読み込むと、その成分と結べます。下の「数列」は音がなくても動きます。', run: () => {}, disabled: true },
      { sep: true, label: '音への態度' }, ...RL.METHODS.filter((m) => !m.math).map((m) => ({ label: m.name, hint: m.hint, run: () => run(m.id) })),
      { sep: true, label: '数列で動かす' }, ...RL.METHODS.filter((m) => m.math).map((m) => ({ label: m.name, hint: m.hint, run: () => run(m.id) })),
      { sep: true }, { label: 'このレイヤーの結びをすべてほどく', run: () => { for (const L of KS.selLayers()) for (const p of M.allPaths(L)) { const pr = M.getProp(L, p); if (pr && pr.r) delete pr.r; } rebuild('untie'); } },
    ], { width: 340, force: true });
  }

  // nothing selected: the composition itself, and the rules that re-wire it
  function compPanel(comp) {
    const sizes = [['1920x1080', '横 1920×1080'], ['1080x1920', '縦 1080×1920'], ['1080x1080', '正方形 1080'], ['1280x720', '横 1280×720'], ['3840x2160', '4K 3840×2160']];
    const nameIn = h('input', { type: 'text', value: comp.name, 'aria-label': 'コンポジションの名前', onchange: () => { comp.name = nameIn.value.trim() || comp.name; rebuild('rename'); }, onkeydown: (e) => e.stopPropagation() });
    const dims = (w, hh) => { comp.w = w; comp.h = hh; S.view.fit = true; rebuild('size'); KS.V.fit(); };
    const out = [h('div.ihead', h('span.chipl', { style: 'background:var(--tape)' }), nameIn, h('span', { style: 'color:var(--faint);font-size:11px;flex:none' }, 'コンポジション'))];
    out.push(sec('画面',
      plain('大きさ', h('span.pv', UI.num({ value: comp.w, min: 16, max: 4096, int: true, onInput: (v, d) => { if (d) dims(v, comp.h); } }), UI.num({ value: comp.h, min: 16, max: 4096, int: true, onInput: (v, d) => { if (d) dims(comp.w, v); } }))),
      plain('型', UI.select([['', '—']].concat(sizes), sizes.some((s) => s[0] === comp.w + 'x' + comp.h) ? comp.w + 'x' + comp.h : '', (v) => { if (v) { const [w, hh] = v.split('x').map(Number); dims(w, hh); } })),
      plain('毎秒のコマ数', UI.select([[24, '24'], [25, '25'], [30, '30'], [60, '60']], comp.fps, (v) => { comp.fps = +v; rebuild('fps'); })),
      plain('長さ', UI.num({ value: comp.dur, min: 0.5, max: 1800, step: 0.5, digits: 2, unit: 's', wide: true, onInput: (v, d) => { if (!d) return; const old = comp.dur; comp.dur = v; if (comp.wa[1] >= old - 1e-6 || comp.wa[1] > v) comp.wa[1] = v; comp.wa[0] = Math.min(comp.wa[0], v - 1 / comp.fps); for (const l of comp.layers) if (l.out >= old - 1e-6 && l.type !== 'video' && l.type !== 'audio') l.out = v; rebuild('duration'); KS.TL.fit(); } })),
      plain('地の色', UI.color({ value: comp.bg, onInput: (v, d) => { comp.bg = v; KS.changed(); if (d) KS.commit('bg'); } })),
      plain('シャッター角度', UI.num({ value: comp.mb.angle, min: 1, max: 720, int: true, unit: '°', onInput: (v, d) => { comp.mb.angle = v; KS.changed(); if (d) KS.commit('mb'); } })),
      plain('ブラーの細かさ', UI.num({ value: comp.mb.samples, min: 2, max: 32, int: true, onInput: (v, d) => { comp.mb.samples = v; KS.changed(); if (d) KS.commit('mb'); } }))));
    // rules
    const rules = comp.rules || (comp.rules = []);
    const srcOpts = SD.GROUPS.map(([g, items]) => [g, items.map(([id, n]) => ['snd:' + id, n])]).concat([['数列', SD.MATH.filter((m) => !['lfo', 'saw', 'logistic', 'walk', 'dice'].includes(m[0])).map(([id, n]) => ['math:' + id, n])]]);
    out.push(sec('規則 — 結び方そのものを変える',
      rules.map((rule) => h('div.rulei',
        h('div.relh', UI.select(srcOpts, rule.src.k === 'math' ? 'math:' + rule.src.gen : 'snd:' + rule.src.sig, (v) => { const [k, id] = v.split(':'); rule.src = k === 'math' ? { k: 'math', gen: id, rate: 1, seed: 1 } : { k: 'snd', layer: null, sig: id }; rebuild('rule'); }, { grouped: true, label: 'きっかけ' }),
          UI.select(RL.ACTS, rule.act, (v) => { rule.act = v; rebuild('rule'); }, { label: 'すること' }),
          h('button.pb' + (rule.on ? '.kf.on' : ''), { type: 'button', title: rule.on ? '規則を切る' : '規則を入れる', html: UI.icon(rule.on ? 'eye' : 'eyeOff'), onclick: () => { rule.on = !rule.on; rebuild('rule'); } }),
          h('button.pb', { type: 'button', title: '規則を消す', html: UI.icon('trash'), onclick: () => { comp.rules = rules.filter((r) => r !== rule); rebuild('rule'); } })),
        h('div.relg', h('label.fld', h('span', '何回ごとに'), UI.num({ value: rule.every, min: 1, max: 256, int: true, onInput: (v, d) => { rule.every = v; KS.changed(); if (d) KS.commit('rule'); } })),
          h('label.fld', h('span', '相手'), UI.select([['', 'すべてのレイヤー']].concat(comp.layers.filter((l) => l.tr).map((l) => [l.id, l.name])), rule.target || '', (v) => { rule.target = v || null; rebuild('rule'); }))))),
      h('div.row2', h('button.btn.small', { type: 'button', onclick: () => { rules.push({ id: U.uid('u'), on: true, src: { k: 'snd', layer: null, sig: 'beat' }, every: 8, act: 'rotate', target: null }); rebuild('rule'); } }, '＋ 規則を足す')),
      h('p.hint.pad', '「拍が8回来るたびに、結んである源を隣どうしで交換する」のように、音や数列の出来事をきっかけにして、レイヤーと成分の結び方を曲の途中で組み替えます。')));
    const snds = RL.soundLayers(comp);
    out.push(sec('この画面について', h('p.hint.pad', snds.length ? `音のあるレイヤー ${snds.length} 本。タイムラインでそのレイヤーを開くと、読み分けた成分が帯で見えます。` : 'レイヤーを選ぶと、ここにその中身が出ます。音や動画を読み込むと、音がいくつもの成分に読み分けられ、どのプロパティとも結べるようになります。')));
    return out;
  }
  IN.refresh = () => {
    if (!binds.length && !scopes.length) return;
    const frame = KS.frameNow();
    for (const b of binds) b.set(M.evalProp(b.prop, frame.lt(b.L, S.t)));
    IN.drawScopes();
  };

  // ================================================================ left panel
  const LF = KS.Left = {};
  LF.build = () => {
    const el = document.getElementById('left'), comp = KS.comp(); if (!el || !comp) return;
    const add = (icon, label, fn) => h('button.lbtn', { type: 'button', html: UI.icon(icon) + `<span>${label}</span>`, onclick: fn });
    const shape = (kind, name) => () => KS.cmd.addLayer('shape', { kind, name });
    const assets = S.project.assets;
    const fmt = (a) => (a.kind === 'image' ? `${a.w}×${a.h}` : a.kind === 'video' ? `${a.w}×${a.h} · ${U.fmtNum(a.dur, 1)}秒` : `${U.fmtNum(a.dur, 1)}秒`);
    el.replaceChildren(
      h('div.lsec', h('h3', '重ねる'), h('div.lgrid',
        add('text', '文字', () => { KS.cmd.addLayer('text', {}); KS.emit('focusText'); }), add('rect', '四角', shape('rect', '四角')), add('ellipse', '円', shape('ellipse', '円')),
        add('star', '星', shape('star', '星')), add('solid', '平面', () => KS.cmd.addLayer('solid', { color: U.hex2rgba(M.LABELS[Math.floor(Math.random() * M.LABELS.length)]) })), add('adjust', '調整', () => KS.cmd.addLayer('adjust', { name: '調整レイヤー' })),
        add('nul', 'ヌル', () => KS.cmd.addLayer('null', {})), add('comp', 'まとめる', () => KS.cmd.precompose()), add('plus', '読み込む', () => document.getElementById('fileIn').click()))),
      h('div.lsec', h('h3', '素材', h('button.ib', { type: 'button', title: '写真・動画・音を読み込む', html: UI.icon('plus'), onclick: () => document.getElementById('fileIn').click() })),
        assets.length ? assets.map((a) => {
          const ok = KS.Media.ready(a.id), th = KS.Media.thumb(a.id);
          return h('div.asset' + (ok ? '' : '.off'), { title: ok ? a.name : 'このファイルは手元から読み直す必要があります' },
            h('span.th', th ? { style: `background-image:url(${th})` } : { html: UI.icon(a.kind === 'audio' ? 'sound' : a.kind === 'video' ? 'film' : 'image') }),
            h('span', h('b', a.name), h('small', ok ? fmt(a) + (SD.pending.has(a.id) ? ' · 音を読んでいます' : '') : '見つかりません')),
            ok ? h('button.ib', { type: 'button', title: 'コンポジションに重ねる', html: UI.icon('plus'), onclick: () => KS.cmd.addAsset(a) }) : h('button.ib', { type: 'button', title: 'ファイルを選び直す', html: UI.icon('link'), onclick: () => { S.ui.relink = a.id; document.getElementById('fileIn').click(); } }));
        }) : h('p.hint', '写真・動画・音をここへ。置くだけで読み込めます。ファイルは端末の外へ出ません。')),
      h('div.lsec', h('h3', 'コンポジション', h('button.ib', { type: 'button', title: '新しいコンポジション', html: UI.icon('plus'), onclick: () => { const c = M.newComp({ name: 'コンポ ' + (S.project.comps.length + 1), w: comp.w, h: comp.h, fps: comp.fps, dur: comp.dur }); S.project.comps.push(c); KS.cmd.openComp(c.id); KS.commit('new comp'); } })),
        S.project.comps.map((c) => h('button.compi', { type: 'button', 'aria-current': String(c.id === comp.id), onclick: () => KS.cmd.openComp(c.id) }, h('span', c.name),
          c.id !== comp.id && !M.compUsesComp(S.project, c, comp.id) ? h('span.ib', { title: 'いまのコンポジションに重ねる', html: UI.icon('plus'), style: 'width:22px;height:22px', onclick: (e) => { e.stopPropagation(); KS.cmd.addLayer('comp', { comp: c.id, w: c.w, h: c.h, name: c.name }); } }) : null))));
  };
})();
