// Kasane — start-up and the things that tie the panels together: the redraw loop, playback, shortcuts,
// menus, export, autosave, and the sample that is on the mat when the page first opens.
'use strict';
(() => {
  const U = KS.U, M = KS.M, S = KS.S, UI = KS.UI, h = UI.h, V = KS.V, TL = KS.TL, IN = KS.IN, LF = KS.Left, MD = KS.Media, EX = KS.Export, C = KS.cmd;
  const $ = (id) => document.getElementById(id);
  const dirty = { render: true, overlay: true, timeline: true, values: true, left: true, insp: true, rows: true };
  KS.touch = (k) => { dirty[k] = true; };

  // ---------------------------------------------------------------- playback
  let playEnd = 0, playOnce = false;
  const P = KS.Play = {
    start(o = {}) {
      if (S.playing || S.exporting) return;
      const comp = KS.comp(); let t = S.t; const [a, b] = comp.wa;
      playOnce = !!o.once; playEnd = playOnce ? comp.dur : b;
      if (!playOnce && (t >= b - 1.5 / comp.fps || t < a)) t = a;
      S.playing = true; S.t = t; MD.play(S.project, comp, t, playEnd); KS.emit('play'); KS.emit('time');
    },
    stop() { if (!S.playing) return; S.playing = false; MD.stop(); MD.pauseAll(); KS.emit('play'); KS.emit('time'); },
    toggle() { if (S.playing) P.stop(); else P.start(); },
  };
  function advance() {
    const comp = KS.comp(); let t = MD.time(); if (t === null) return;
    if (t >= playEnd - 1e-4) {
      if (S.loop && !playOnce) { MD.play(S.project, comp, comp.wa[0], playEnd); t = comp.wa[0]; }
      else { const last = Math.max(0, playEnd - 1 / comp.fps); if (V.sketching()) { S.t = last; return; } P.stop(); S.t = last; KS.emit('time'); return; }
    }
    t = Math.floor(t * comp.fps + 1e-6) / comp.fps;
    if (t !== S.t) { S.t = t; KS.emit('time'); TL.follow(); }
  }

  // ---------------------------------------------------------------- the loop: every panel redraws at most once a frame
  function loop() {
    requestAnimationFrame(loop);
    if (S.exporting) return;
    if (S.playing) advance();
    try {
      if (dirty.left) { dirty.left = false; LF.build(); }
      if (dirty.rows) { dirty.rows = false; TL.build(); }
      if (dirty.insp) { dirty.insp = false; IN.build(); }
      if (dirty.values) { dirty.values = false; TL.refresh(); IN.refresh(); const c = KS.comp(); if (c) $('tcBtn').textContent = U.fmtTime(S.t, c.fps); }
      if (dirty.render) { dirty.render = false; V.render(); }
      if (dirty.overlay) { dirty.overlay = false; V.overlay(); }
      if (dirty.timeline) { dirty.timeline = false; TL.draw(); }
    } catch (e) { console.error(e); }
  }
  KS.on('doc', () => { dirty.render = dirty.overlay = dirty.timeline = dirty.values = true; save(); });
  KS.on('struct', () => { dirty.insp = dirty.rows = dirty.left = true; });
  KS.on('sel', () => { dirty.insp = dirty.rows = dirty.overlay = dirty.timeline = true; });
  KS.on('time', () => { dirty.render = dirty.overlay = dirty.timeline = dirty.values = true; });
  KS.on('view', () => { dirty.render = dirty.overlay = true; hud(); });
  KS.on('videoFrame', () => { dirty.render = true; });
  KS.on('sound', () => { dirty.left = dirty.overlay = true; });
  KS.on('toast', ({ msg, kind }) => UI.toast(msg, kind));
  KS.on('commit', () => { $('undoBtn').disabled = KS.H.at <= 0; $('redoBtn').disabled = KS.H.at >= KS.H.stack.length - 1; save(); });
  KS.on('play', () => { const b = $('playBtn'); b.innerHTML = UI.icon(S.playing ? 'pause' : 'play'); b.setAttribute('aria-pressed', String(S.playing)); b.setAttribute('aria-label', S.playing ? '停止' : '再生'); $('recBtn').setAttribute('aria-pressed', String(S.rec)); });
  KS.on('tool', () => { for (const b of $('tools').querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool)); $('ov').style.cursor = { hand: 'grab', text: 'text', select: 'default' }[S.tool] || 'crosshair'; if (S.tool !== 'pen') V.cancel(); dirty.overlay = true; });
  KS.setTab = (tab) => { $('app').dataset.tab = tab; for (const b of $('tabs').children) b.setAttribute('aria-pressed', String(b.dataset.tab === tab)); dirty.timeline = true; };

  // ---------------------------------------------------------------- saving (the project is small; the footage lives in IndexedDB)
  const save = U.debounce(() => { try { localStorage.setItem('kasane.project', JSON.stringify(S.project)); } catch (e) { /* storage unavailable: the project file is the way to keep work */ } }, 900);
  function adopt(project, o = {}) {
    P.stop();
    S.project = project; S.compId = project.active && M.comp(project, project.active) ? project.active : project.comps[0].id;
    S.sel = { layers: [], keys: [], mask: null }; S.t = o.t || 0; S.tl.open = o.open || {}; S.view.fit = true; S.relPick = null;
    KS.Rel.cache.clear(); KS.R.resetProcesses && V.ok && KS.R.resetProcesses();
    KS.H.init(); KS.emit('commit'); KS.emit('sel'); KS.emit('time'); KS.restructured();
    if (V.ok) V.fit(); TL.fit();
    MD.restore(project).then((missing) => { if (missing) KS.toast(`素材 ${missing} 個が見つかりません。「素材」から選び直せます`, 'warn'); });
  }

  // ---------------------------------------------------------------- more commands
  C.addAsset = (a) => {
    const comp = KS.comp(); let L;
    if (a.kind === 'image') L = C.addLayer('image', { src: a.id, w: a.w, h: a.h, name: a.name });
    else {
      L = C.addLayer(a.kind, { src: a.id, w: a.w, h: a.h, name: a.name, in: S.t, start: S.t, out: S.t + a.dur });
      if (L.out > comp.dur + 1e-6) {            // sound decides how long the piece is
        const old = comp.dur; comp.dur = Math.min(1500, Math.ceil(L.out * 10) / 10); L.out = Math.min(L.out, comp.dur);
        if (comp.wa[1] >= old - 1e-6) comp.wa[1] = comp.dur;
        for (const l of comp.layers) if (l !== L && l.out >= old - 1e-6 && l.type !== 'video' && l.type !== 'audio') l.out = comp.dur;
        KS.toast(`コンポジションの長さを ${U.fmtNum(comp.dur, 1)} 秒に延ばしました`); TL.fit();
      }
      if (a.kind === 'audio') { comp.layers.splice(comp.layers.indexOf(L), 1); comp.layers.push(L); }   // sound has no place in the stack; keep it at the bottom
      if (a.kind === 'audio' || a.hasAudio) S.tl.open[L.id] = 'tr';
    }
    KS.restructured(); KS.commit('add footage');
    return L;
  };
  const importFiles = async (files) => {
    files = [...files]; if (!files.length) return;
    if (S.ui.relink) { const a = M.asset(S.project, S.ui.relink); S.ui.relink = null; if (a) { try { await MD.relink(a, files[0]); KS.toast('素材をつなぎ直しました'); } catch (e) { KS.toast(e.message, 'warn'); } } return; }
    const proj = files.find((f) => /\.json$/i.test(f.name));
    if (proj) { try { adopt(await EX.readProject(proj)); KS.toast('プロジェクトを開きました'); } catch (e) { KS.toast(e.message, 'warn'); } return; }
    KS.toast('読み込んでいます…');
    const assets = await MD.importFiles(files);
    for (const a of assets) C.addAsset(a);
    if (assets.length) KS.toast(assets.some((a) => a.kind !== 'image') ? '重ねました。音は成分に読み分けています' : '重ねました');
  };
  const deliver = async (r) => { try { KS.toast(await EX.deliver(r.name, r.blob) + (r.note ? ' ' + r.note : '')); } catch (e) { KS.toast(e.message, 'warn'); } };

  // ---------------------------------------------------------------- menus and dialogs
  function fileMenu(anchor) {
    UI.menu(anchor, [
      { label: '新しいプロジェクト', run: () => UI.confirm('新しいプロジェクト', 'いまの内容を閉じて、まっさらな画面から始めます。残したい場合は先に保存してください。', '始める', () => { const p = M.newProject(), c = M.newComp({ name: 'コンポ 1' }); p.comps.push(c); p.active = c.id; adopt(p); }) },
      { label: 'プロジェクトを開く…', run: () => $('projIn').click() },
      { label: 'プロジェクトを保存', key: '⌘S', run: () => deliver(EX.projectFile()) },
      { sep: true },
      { label: '素材を読み込む…', hint: '写真・動画・音', run: () => $('fileIn').click() },
      { label: 'いまのコマを画像で保存', run: () => EX.still(false).then(deliver) },
      { label: 'いまのコマを透明つきで保存', run: () => EX.still(true).then(deliver) },
      { sep: true },
      { label: 'サンプルを開く', run: () => UI.confirm('サンプルを開く', 'いまの内容を閉じて、サンプルを開きます。', '開く', () => adopt(KS.demo(), { t: 3.6 })) },
      { label: '使い方', run: help },
    ]);
  }
  function addMenu(anchor) {
    const sh = (kind, name) => () => C.addLayer('shape', { kind, name });
    UI.menu(anchor, [
      { icon: 'text', label: '文字', run: () => { C.addLayer('text', {}); KS.emit('focusText'); } },
      { icon: 'rect', label: '四角', run: sh('rect', '四角') }, { icon: 'ellipse', label: '円', run: sh('ellipse', '円') }, { icon: 'star', label: '星', run: sh('star', '星') },
      { icon: 'solid', label: '平面', hint: '一色の面', run: () => C.addLayer('solid', {}) },
      { icon: 'adjust', label: '調整レイヤー', hint: '下にあるものすべてにエフェクトを掛ける', run: () => C.addLayer('adjust', { name: '調整レイヤー' }) },
      { icon: 'nul', label: 'ヌル', hint: '見えない持ち手。ほかのレイヤーの親にする', run: () => C.addLayer('null', {}) },
      { sep: true }, { icon: 'image', label: '写真・動画・音を読み込む…', run: () => $('fileIn').click() },
      { icon: 'comp', label: '選んだレイヤーをひとつにまとめる', hint: 'プリコンポーズ', run: () => C.precompose(), disabled: !S.sel.layers.length },
    ]);
  }
  function exportDialog() {
    const comp = KS.comp(), o = { format: 'mp4', scale: 1, range: 'work', audio: true, quality: 'high' };
    const info = h('p.hint'), upd = () => { const [a, b] = o.range === 'all' ? [0, comp.dur] : comp.wa; info.textContent = `${Math.round(comp.w * o.scale / 2) * 2}×${Math.round(comp.h * o.scale / 2) * 2} · ${comp.fps}fps · ${U.fmtNum(b - a, 2)} 秒 · ${Math.round((b - a) * comp.fps)} コマ。1コマずつ正確に描いて書き出します（モーションブラーつき）。`; };
    const sel = (key, opts) => UI.select(opts, o[key], (v) => { o[key] = isNaN(+v) ? v : +v; upd(); });
    upd();
    UI.modal('書き出す', h('div', h('div.form',
      h('label', '形式'), sel('format', [['mp4', 'MP4（H.264）'], ['webm', 'WebM（VP9）']]),
      h('label', '大きさ'), sel('scale', [[1, '100%'], [0.5, '50%'], [0.25, '25%']]),
      h('label', '範囲'), sel('range', [['work', '作業範囲（ルーラーの黄色い帯）'], ['all', 'コンポジション全体']]),
      h('label', '画質'), sel('quality', [['veryhigh', 'とても高い'], ['high', '高い'], ['medium', 'ふつう']]),
      h('label', '音'), UI.check('音も入れる', o.audio, (v) => { o.audio = v; })), info),
    [{ label: 'やめる', run: () => {} }, { label: '書き出す', primary: true, run: () => { runExport(o); } }]);
  }
  async function runExport(o) {
    P.stop();
    const box = $('exp'); box.hidden = false; $('expBar').style.width = '0%'; $('expInfo').textContent = '準備しています';
    try {
      const r = await EX.video(o, (p, msg) => { $('expBar').style.width = Math.round(p * 100) + '%'; $('expInfo').textContent = msg || ''; });
      box.hidden = true;
      if (r && !r.canceled) await deliver(r); else if (r) KS.toast('書き出しをやめました');
    } catch (e) { box.hidden = true; console.error(e); KS.toast('書き出せませんでした：' + e.message, 'warn'); }
    dirty.render = dirty.overlay = dirty.timeline = true;
  }
  function help() {
    const sc = [['スペース', '再生・停止'], [', と .', '1コマ戻る・進む（Shift で10コマ）'], ['J / K', '前・次のキーフレームへ'], ['B / N', '作業範囲の始まり・終わりをここに'], ['[ / ]', 'レイヤーの始まり・終わりをここへ動かす（Alt で切り詰め）'],
      ['V H Q G X', '選ぶ・手のひら・図形・ペン・文字'], ['C Y W', 'ちぎる・つまむ・くしゃ'], ['⌘D / ⇧⌘D', '複製・再生位置で分割'], ['F9', '選んだキーをゆるやかに'], ['U', '動いているプロパティだけ開く・閉じる'], ['F / + −', '全体を表示・拡大縮小'], ['⌘Z / ⇧⌘Z', '取り消す・やり直す']];
    UI.modal('重ね Kasane の使い方', h('div',
      h('p', '映像の素材をレイヤーとして重ね、時間に沿って動かす道具です。レイヤーはビューアで直接つかんで動かせます。'),
      h('h4', '動かす'), h('p', 'プロパティの ◆ を押すと、いまの時間にキーフレームが打たれます。時間を進めて値を変えると、そのあいだが動きになります。●（記録）を押してからレイヤーをつかんで動かすと、手の動きがそのままキーフレームになります。'),
      h('h4', '音と結ぶ'), h('p', '音や動画を読み込むと、音がいくつもの成分に読み分けられます：音量と帯域、打点、P·M·V·R·S（拍・長短・速度感・呼吸・無音）、そして「予測された打点／予測になかった打点／来なかった打点」。タイムラインで音のレイヤーを開くと帯で見えます。'),
      h('p', 'プロパティの 〜 を押すと、成分のひとつと結べます。結び方には態度があります：なぞる、逆らう、溜めて放つ、数えて裏切る、一歩ずつ、聴かない。「先ぶれ」を入れると、音が鳴る前に動き出して鳴った瞬間に届きます。音の代わりに数列（トゥエ・モース列、ふるい、ロジスティック写像など）とも結べます。'),
      h('p', 'レイヤーを選ばずに右のパネルを見ると「規則」があります。拍や無音などの出来事をきっかけに、結び方そのものを曲の途中で組み替えます。'),
      h('h4', 'うつろい'), h('p', '「とろけ」「しずむ」「くずれ」「こだま」は、同じ操作を自分の結果にくり返し掛けていくエフェクトです。レイヤーの最初のコマから積み重なるので、時間が進むほど元の絵から離れていきます。量を音と結ぶと、鳴っているあいだだけ進みます。'),
      h('h4', '手ざわりの道具'), h('p', 'ちぎる：レイヤーの上をなぞると、その線で二枚に裂けます。つまむ：ピンを打って引くと、絵が曲がります。くしゃ：つかんで中心へ押し込むと、紙のように丸まります。'),
      h('h4', 'キーボード'), h('dl', sc.map(([k, d]) => [h('dt', k), h('dd', d)])),
      h('p.hint', '素材のファイルは端末の中だけで扱われ、どこにも送られません。プロジェクトはこのブラウザに自動で残りますが、確実に残すには「ファイル › プロジェクトを保存」を使ってください。')), [{ label: '閉じる', primary: true, run: () => {} }]);
  }
  function hud() {
    $('zoomBtn').textContent = Math.round(S.view.zoom * 100) + '%';
    $('resBtn').textContent = S.view.res ? '1/' + Math.round(1 / S.view.res) : '自動';
    $('mbBtn').setAttribute('aria-pressed', String(!!S.view.mb));
  }

  // ---------------------------------------------------------------- keyboard
  function keys(e) {
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const mod = e.metaKey || e.ctrlKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key, comp = KS.comp();
    if (!$('modal').hidden) { if (k === 'Escape') { $('modal').hidden = true; $('modal').replaceChildren(); } return; }
    if (S.exporting || !comp) return;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) KS.redo(); else KS.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); KS.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); deliver(EX.projectFile()); return; }
    if (typing) return;
    const fr = 1 / comp.fps;
    if (mod) {
      if (k === 'd') { e.preventDefault(); if (e.shiftKey) C.split(); else C.duplicate(); }
      else if (k === 'a') { e.preventDefault(); KS.select(comp.layers.map((l) => l.id)); }
      else if (k === ']' || k === '[') { e.preventDefault(); C.reorder(k === ']' ? (e.shiftKey ? 2 : 1) : (e.shiftKey ? -2 : -1)); }
      return;
    }
    const tools = { v: 'select', h: 'hand', g: 'pen', x: 'text', c: 'tear', y: 'pin', w: 'crumple' };
    if (tools[k]) { KS.setTool(tools[k]); return; }
    if (k === 'q') { KS.setTool(S.tool === 'rect' ? 'ellipse' : S.tool === 'ellipse' ? 'star' : 'rect'); return; }
    switch (k) {
      case ' ': e.preventDefault(); P.toggle(); break;
      case ',': case 'PageUp': e.preventDefault(); P.stop(); KS.step(e.shiftKey ? -10 : -1); break;
      case '.': case 'PageDown': e.preventDefault(); P.stop(); KS.step(e.shiftKey ? 10 : 1); break;
      case 'Home': KS.setTime(0); break;
      case 'End': KS.setTime(comp.dur); break;
      case 'j': C.keyNav(-1); break;
      case 'k': C.keyNav(1); break;
      case 'b': comp.wa[0] = Math.min(S.t, comp.wa[1] - fr); KS.changed(); KS.commit('work area'); break;
      case 'n': comp.wa[1] = Math.max(S.t + fr, comp.wa[0] + fr); KS.changed(); KS.commit('work area'); break;
      case 'i': { const L = KS.firstSel(); if (L) KS.setTime(L.in); break; }
      case 'o': { const L = KS.firstSel(); if (L) KS.setTime(L.out - fr); break; }
      case '[': if (e.altKey) C.trimIn(); else C.moveInTo(); break;
      case ']': if (e.altKey) C.trimOut(); else { for (const L of KS.selLayers()) M.shiftLayer(L, S.t + fr - L.out); KS.changed(); KS.commit('move'); } break;
      case 'u': { const Ls = KS.selLayers(); const any = Ls.some((L) => S.tl.open[L.id]); for (const L of Ls) { if (any) delete S.tl.open[L.id]; else S.tl.open[L.id] = 'anim'; } KS.emit('struct'); break; }
      case 'F9': e.preventDefault(); C.ease(U.EASE.ease, false); dirty.insp = true; break;
      case 'f': V.fit(); break;
      case '+': case '=': case ';': V.zoomAt(1.25); break;
      case '-': V.zoomAt(0.8); break;
      case "'": S.view.guides = !S.view.guides; dirty.overlay = true; break;
      case 'Delete': case 'Backspace': e.preventDefault(); C.deleteSel(); break;
      case 'Enter': if (V.pen) V.penFinish(false); break;
      case 'Escape': if (!V.cancel()) { if (S.tool !== 'select') KS.setTool('select'); else KS.select([]); } break;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        e.preventDefault();
        const Ls = KS.selLayers().filter((L) => L.tr && !L.lock), d = e.shiftKey ? 10 : 1, dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
        if (!Ls.length) { if (dx) { P.stop(); KS.step(dx); } break; }
        for (const L of Ls) { const p = M.evalProp(L.tr.p, S.t); M.setValue(L.tr.p, [p[0] + dx, p[1] + dy], S.t); }
        KS.changed(); KS.commit('nudge'); break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------- the sample on the mat at first visit
  KS.demo = () => {
    const E = U.EASE, P1 = M.newProject(), comp = M.newComp({ name: 'サンプル', w: 1920, h: 1080, fps: 30, dur: 8, bg: [0.075, 0.092, 0.086, 1] });
    P1.name = 'サンプル'; P1.comps.push(comp); P1.active = comp.id;
    const add = (type, o) => { const L = M.newLayer(type, comp, o); comp.layers.unshift(L); return L; };
    const key = (L, path, t, v, e) => M.setKey(M.getProp(L, path), t, v, { e: e === undefined ? E.ease : e });
    const math = (gen, o) => Object.assign({ k: 'math', gen, rate: 4, seed: 1, mul: 1 }, o);
    const tie = (L, path, src, o) => { const prop = M.getProp(L, path); (prop.r || (prop.r = [])).push(KS.Rel.create(M.desc(L, path), path, src, o)); };
    // a sheet of paper that gets torn in two; the torn-off piece drifts away
    const paper = add('solid', { name: '紙', w: 720, h: 480, color: [0.945, 0.925, 0.875, 1] }); paper.tr.p.v = [560, 500]; paper.tr.r.v = -4; paper.label = 7;
    const line = [[430, -20], [452, 96], [414, 214], [466, 330], [438, 500]];
    const torn = (side) => { const m = M.newMask([]); m.torn = { line, side, seed: 41, rough: 13, fibre: 8 }; return m; };
    paper.fx = [KS.FX.create('paper', { x: 0, y: 0, w: 720, h: 480 })];
    const piece = M.cloneLayer(paper); piece.name = '紙 ちぎれ'; comp.layers.unshift(piece);
    paper.masks = [torn(1)]; piece.masks = [torn(-1)];
    key(piece, 'tr.p', 1.2, [560, 500], E.out); key(piece, 'tr.p', 2.4, [668, 548]); key(piece, 'tr.r', 1.2, -4, E.out); key(piece, 'tr.r', 2.4, 7);
    const cr = KS.FX.create('crumple', { x: 0, y: 0, w: 720, h: 480 }); piece.fx.push(cr);
    cr.p.amount.v = 0; M.setKey(cr.p.amount, 5.6, 0, { e: E.in }); M.setKey(cr.p.amount, 6.5, 78, { e: null }); cr.p.seed.v = 5;
    // a sun that melts along its own tones from 3 s on
    const sun = add('shape', { name: '太陽', kind: 'ellipse', size: [360, 360], fill: [0.93, 0.44, 0.24, 1] }); sun.tr.p.v = [1370, 420]; sun.in = 0; sun.label = 0;
    const gr = KS.FX.create('gradient', { x: -183, y: -183, w: 366, h: 366 }); gr.p.c1.v = [0.97, 0.82, 0.36, 1]; gr.p.c2.v = [0.86, 0.27, 0.25, 1]; sun.fx.push(gr);
    const melt = KS.FX.create('melt', { x: -183, y: -183, w: 366, h: 366 }); melt.p.flow.v = 0; melt.p.room.v = 420; melt.p.swirl.v = 55; sun.fx.push(melt);
    M.setKey(melt.p.flow, 2.8, 0, { e: E.in }); M.setKey(melt.p.flow, 3.4, 46, { e: null });
    // a ring that pulses on the Thue–Morse sequence, obeying three times and then answering the other way
    const ring = add('shape', { name: '輪', kind: 'ellipse', size: [520, 520], fillOn: false, strokeW: 10, stroke: [0.44, 0.82, 0.77, 1] }); ring.d.fillOn = false; ring.tr.p.v = [1370, 420]; ring.label = 3;
    key(ring, 'p.trimE', 0.2, 0, E.strong); key(ring, 'p.trimE', 1.4, 100);
    tie(ring, 'tr.s', math('thue', { rate: 5 }), { mode: 'betray', obey: 3, obeySeq: 'fib', how: 'opp', amt: [9, 9], rel: 0.16 });
    tie(ring, 'tr.r', math('logistic', { rate: 2.5, a: 3.72 }), { mode: 'follow', amt: 70, atk: 0.12, rel: 0.12 });
    const title = add('text', { name: '題', str: '重ねる、\nちぎる、とろける。', size: 96, weight: 700, align: 'left', fill: [0.945, 0.925, 0.875, 1] }); title.tr.p.v = [150, 880]; title.label = 1;
    key(title, 'p.reveal', 0.4, 0, null); key(title, 'p.reveal', 2.2, 100);
    const cap = add('text', { name: '注記', str: 'これはサンプルです。つかんで動かす／消して自分の素材を重ねる', size: 30, weight: 400, align: 'left', fill: [0.6, 0.65, 0.62, 1] }); cap.tr.p.v = [152, 1012];
    return P1;
  };

  // ---------------------------------------------------------------- start
  function boot() {
    // toolbar
    const tools = [['select', '選ぶ・動かす (V)'], ['hand', '画面を動かす (H)'], null, ['rect', '四角を描く (Q)'], ['ellipse', '円を描く (Q)'], ['star', '星を描く (Q)'], ['pen', 'ペン：選んだレイヤーにマスク、何も選ばなければ線や形 (G)'], ['text', '文字を置く (X)'], null,
      ['tear', 'ちぎる：レイヤーの上をなぞると、その線で二枚に裂ける (C)', 1], ['pin', 'つまむ：ピンを打って引くと絵が曲がる (Y)', 1], ['crumple', 'くしゃ：つかんで中心へ押し込むと丸まる (W)', 1]];
    $('tools').replaceChildren(...tools.map((t) => (t ? h('button.tool' + (t[2] ? '.lab' : ''), { type: 'button', title: t[1], 'aria-label': t[1], 'data-tool': t[0], 'aria-pressed': String(t[0] === S.tool), html: UI.icon(t[0]), onclick: () => KS.setTool(t[0]) }) : h('span.tsep'))));
    for (const [id, icon] of [['firstBtn', 'first'], ['prevBtn', 'prev'], ['playBtn', 'play'], ['nextBtn', 'next'], ['loopBtn', 'loop'], ['recBtn', 'rec']]) $(id).innerHTML = UI.icon(icon);
    $('mFile').onclick = (e) => fileMenu(e.currentTarget); $('mAdd').onclick = (e) => addMenu(e.currentTarget);
    $('undoBtn').onclick = () => KS.undo(); $('redoBtn').onclick = () => KS.redo(); $('helpBtn').onclick = help; $('exportBtn').onclick = exportDialog;
    $('expCancel').onclick = () => { EX.cancel = true; };
    $('playBtn').onclick = () => P.toggle(); $('firstBtn').onclick = () => { P.stop(); KS.setTime(KS.comp().wa[0]); };
    $('prevBtn').onclick = () => { P.stop(); KS.step(-1); }; $('nextBtn').onclick = () => { P.stop(); KS.step(1); };
    $('loopBtn').onclick = () => { S.loop = !S.loop; $('loopBtn').setAttribute('aria-pressed', String(S.loop)); };
    $('recBtn').onclick = () => { S.rec = !S.rec; $('recBtn').setAttribute('aria-pressed', String(S.rec)); if (S.rec) { KS.setTool('select'); V.note('●記録中：<b>レイヤーをつかんで動かす</b>と、離すまでの動きがキーフレームになります', 6000); } };
    $('tcBtn').onclick = (e) => { const comp = KS.comp(), inp = h('input.search', { type: 'text', value: U.fmtTime(S.t, comp.fps), 'aria-label': '移動先の時間', onkeydown: (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { const t = U.parseTime(inp.value, comp.fps); if (isFinite(t)) KS.setTime(t); UI.closePop(); } } }); UI.pop(e.currentTarget, h('div', inp, h('p.hint', { style: 'margin:0 4px 4px' }, '分:秒:コマ、または秒数（例 2.5）')), { width: 200, force: true }); inp.focus(); inp.select(); };
    $('zoomBtn').onclick = (e) => UI.menu(e.currentTarget, [['全体を表示', 'fit'], ['50%', 0.5], ['100%', 1], ['200%', 2], ['400%', 4]].map(([label, z]) => ({ label, run: () => V.zoomTo(z) })).concat([{ sep: true }, { label: 'ガイドを表示', checked: S.view.guides, run: () => { S.view.guides = !S.view.guides; dirty.overlay = true; } }, { label: 'カッターマットの上に置く', checked: S.view.surround === 'mat', run: () => { S.view.surround = S.view.surround === 'mat' ? 'black' : 'mat'; dirty.render = true; } }]), { force: true });
    $('resBtn').onclick = (e) => UI.menu(e.currentTarget, [['自動（表示倍率に合わせる）', 0], ['フル', 1], ['1/2', 0.5], ['1/4', 0.25]].map(([label, r]) => ({ label, checked: S.view.res === r, run: () => { S.view.res = r; KS.emit('view'); } })), { force: true });
    $('mbBtn').onclick = () => { S.view.mb = !S.view.mb; KS.emit('view'); };
    for (const b of $('tabs').children) b.onclick = () => KS.setTab(b.dataset.tab);
    $('fileIn').onchange = (e) => { importFiles(e.target.files); e.target.value = ''; };
    $('projIn').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { adopt(await EX.readProject(f)); KS.toast('プロジェクトを開きました'); } catch (err) { KS.toast(err.message, 'warn'); } };
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('drop').hidden = false; } });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
    window.addEventListener('keydown', keys);
    window.addEventListener('resize', () => { dirty.timeline = true; });
    KS.Fonts.onLoad = () => { dirty.render = true; };

    V.init(); TL.init(); IN.init();
    let project = null, restored = false;
    try { const raw = localStorage.getItem('kasane.project'); if (raw) { const p = JSON.parse(raw); if (p && p.app === 'kasane' && p.comps && p.comps.length) { project = p; restored = true; } } } catch (e) { project = null; }
    adopt(project || KS.demo(), { t: restored ? 0 : 3.6 });
    KS.emit('play'); KS.emit('tool'); hud();
    if (!restored && V.ok) V.note('これはサンプルです。<b>レイヤーをつかんで動かせます</b>。スペースで再生', 7000);
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
