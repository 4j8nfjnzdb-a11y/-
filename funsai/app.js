/* 粉砕 FUNSAI — UI, state and wiring. */
(function () {
  'use strict';

  var DIVS = [2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.1875, 0.125, 0.09375, 0.0625, 0.03125];
  var DIVN = ['1/2', '1/4.', '1/4', '1/8.', '1/8', '1/16.', '1/16', '1/32.', '1/32', '1/64.', '1/64', '1/128'];
  var ODDS = [3, 5, 7, 9, 11, 13, 15, 17];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function em(x, lo, hi) { return lo * Math.pow(hi / lo, clamp(x, 0, 1)); }
  function divIdx(x) { return clamp(Math.floor(x * DIVS.length), 0, DIVS.length - 1); }
  function fDiv(x) { return DIVN[divIdx(x)]; }
  function fPct(x) { return Math.round(x * 100) + '%'; }
  function fHz(x, lo, hi) {
    var f = em(x, lo, hi);
    return f >= 1000 ? (f / 1000).toFixed(2) + 'k' : f.toFixed(0) + 'Hz';
  }
  function fTime(x, lo, hi) {
    var t = em(x, lo, hi);
    return t < 1 ? Math.round(t * 1000) + 'ms' : t.toFixed(2) + 's';
  }
  function semis(rate) { return (12 * Math.log(rate) / Math.LN2).toFixed(1); }

  /* --- the 16 pads -------------------------------------------------- */
  var PADS = [
    { id: 'stut', jp: '刻', en: 'STUT', xn: '分割', yn: '巻戻',
      xf: fDiv, yf: function (y) { return '−' + Math.floor(y * 8); } },
    { id: 'roll', jp: '連', en: 'ROLL', xn: '初速', yn: '加速',
      xf: function (x) { return fDiv(x * 0.6); }, yf: fPct },
    { id: 'frz', jp: '凍', en: 'FRZ', xn: '粒', yn: '音程',
      xf: function (x) { return fTime(x, 0.0015, 0.4); },
      yf: function (y) { return semis(em(y, 0.25, 4)) + 'st'; } },
    { id: 'rev', jp: '逆', en: 'REV', xn: '分割', yn: '速度',
      xf: fDiv, yf: function (y) { return '×' + em(y, 0.5, 2).toFixed(2); } },

    { id: 'pshf', jp: '階', en: 'STAIR', xn: '音程幅', yn: '段数',
      xf: function (x) { return ((x - 0.5) * 14).toFixed(1) + 'st'; },
      yf: function (y) { return (2 + Math.floor(y * 14)) + '段'; } },
    { id: 'odd', jp: '変', en: 'ODD', xn: '拍子', yn: '揺れ',
      xf: function (x) { return ODDS[clamp(Math.floor(x * ODDS.length), 0, 7)] + '/16'; }, yf: fPct },
    { id: 'scrm', jp: '散', en: 'SCRM', xn: '粒度', yn: '範囲',
      xf: function (x) { return fDiv(0.25 + x * 0.6); },
      yf: function (y) { return '±' + (1 + Math.floor(y * 15)); } },
    { id: 'rnd', jp: '混', en: 'CHAOS', xn: '確率', yn: '粒度',
      xf: fPct, yf: function (y) { return fDiv(0.2 + y * 0.75); } },

    { id: 'stop', jp: '停', en: 'STOP', xn: '時間', yn: '底',
      xf: function (x) { return fTime(x, 0.04, 3); }, yf: fPct },
    { id: 'gate', jp: '断', en: 'GATE', xn: '速度', yn: '開度', xf: fDiv, yf: fPct },
    { id: 'crsh', jp: '砕', en: 'CRSH', xn: '間引', yn: 'ビット',
      xf: function (x) { return '÷' + Math.round(em(x, 1, 110)); },
      yf: function (y) { return Math.max(1, Math.round(16 - y * 15)) + 'bit'; } },
    { id: 'ring', jp: '環', en: 'RING', xn: '周波数', yn: '掃引',
      xf: function (x) { return fHz(x, 6, 3200); }, yf: fPct },

    { id: 'filt', jp: '濾', en: 'FILT', xn: '開き', yn: '共鳴',
      xf: function (x) { return fHz(x, 28, 16000); },
      yf: function (y) { return 'Q' + (0.5 + y * 16).toFixed(1); } },
    { id: 'dly', jp: '遅', en: 'DLY', xn: '時間', yn: '帰還',
      xf: function (x) { return fTime(x, 0.004, 0.7); }, yf: fPct },
    { id: 'smr', jp: '滲', en: 'SMEAR', xn: '粒長', yn: '拡散',
      xf: function (x) { return fTime(x, 0.008, 0.3); },
      yf: function (y) { return fTime(y, 0.02, 1.62); } },
    { id: 'dstr', jp: '壊', en: 'DSTR', xn: '歪', yn: '雑音',
      xf: function (x) { return '×' + Math.round(em(x, 1.5, 90)); }, yf: fPct }
  ];

  var KEYS = '1234qwerasdfzxcv';
  var TRACKS = [
    { jp: 'バス', en: 'BD' },
    { jp: 'ハット', en: 'HH' },
    { jp: 'スネア', en: 'SD' },
    { jp: 'シンバル', en: 'CY' }
  ];
  var RES = [
    { v: 0.5, n: '½' }, { v: 1, n: '×1' }, { v: 1.5, n: '×1.5' },
    { v: 2, n: '×2' }, { v: 3, n: '×3' }, { v: 4, n: '×4' }
  ];

  /* --- state --------------------------------------------------------- */
  var S = {
    mode: 'mono', bpm: 174, swing: 0, playing: false,
    kit: 'niku', pat: 'amen', target: 4,
    latch: false, xyhold: false, auto: false, autoAmt: 0.35,
    slices: 32, monoLen: 32, fit: true,
    slot: new Int16Array(32), on: new Uint8Array(32), rev: new Uint8Array(32),
    tracks: [], fx: [], peaks: [0, 0, 0, 0, 0],
    pos: { mono: -1, t: [-1, -1, -1, -1] }
  };
  for (var t = 0; t < 4; t++) {
    S.tracks.push({ pat: new Uint8Array(32), len: 16, res: 1, mute: false });
  }
  for (var c = 0; c < 5; c++) {
    var o = {};
    for (var p = 0; p < PADS.length; p++) o[PADS[p].id] = { on: false, auto: false, x: 0.5, y: 0.5 };
    S.fx.push(o);
  }

  var ctx = null, node = null, masterGain = null, analyser = null, scopeData = null;
  var recDest = null, recorder = null, recChunks = [];
  var booted = false;

  var $ = function (id) { return document.getElementById(id); };

  /* ================================================================== *
   * audio
   * ================================================================== */
  function boot() {
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    var src = '(' + funsaiWorkletCode.toString() + ')();';
    var url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    return ctx.audioWorklet.addModule(url).then(function () {
      URL.revokeObjectURL(url);
      node = new AudioWorkletNode(ctx, 'funsai-engine', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]
      });
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.85;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      scopeData = new Uint8Array(analyser.fftSize);
      node.connect(masterGain);
      masterGain.connect(analyser);
      analyser.connect(ctx.destination);
      try {
        recDest = ctx.createMediaStreamDestination();
        masterGain.connect(recDest);
      } catch (e) { recDest = null; }
      node.port.onmessage = onEngine;
      booted = true;
      window.FUNSAI = { ctx: ctx, node: node, analyser: analyser, state: S, pads: PADS };

      send({ type: 'bpm', bpm: S.bpm });
      send({ type: 'swing', swing: S.swing });
      send({ type: 'mode', mode: S.mode });
      loadKit(S.kit);
      loadBreak();
      loadGrid(S.pat);
      pushAllFx();
    });
  }

  function send(m, transfer) {
    if (!node) return;
    if (transfer) node.port.postMessage(m, transfer);
    else node.port.postMessage(m);
  }

  function onEngine(e) {
    var m = e.data;
    if (m.type === 'pos') {
      S.pos.mono = m.mono;
      S.pos.t = m.t;
      S.peaks = m.peaks;
    } else if (m.type === 'autopad') {
      var f = S.fx[m.target][m.id];
      f.auto = m.on;
      if (m.on) { f.x = m.x; f.y = m.y; }
      if (m.target === S.target) paintPad(m.id);
      paintTargetActivity();
    }
  }

  /* light up a bus button when anything is mangling it, even off-screen */
  function paintTargetActivity() {
    var btns = document.querySelectorAll('#targets .tgt');
    for (var b = 0; b < btns.length; b++) {
      var tg = +btns[b].dataset.i;
      var busy = false;
      for (var i = 0; i < PADS.length; i++) {
        var f = S.fx[tg][PADS[i].id];
        if (f.on || f.auto) { busy = true; break; }
      }
      btns[b].classList.toggle('busy', busy);
    }
  }

  var kitCache = {};
  function buildKitCached(id) {
    var key = id + '@' + ctx.sampleRate;
    if (!kitCache[key]) kitCache[key] = FunsaiKits.buildKit(ctx.sampleRate, id);
    return kitCache[key];
  }

  function loadKit(id) {
    var k = buildKitCached(id);
    var order = [k.bd, k.hh, k.sd, k.cy];
    for (var i = 0; i < 4; i++) {
      var copy = new Float32Array(order[i]);
      send({ type: 'kitbuf', slot: i, l: copy }, [copy.buffer]);
    }
  }

  var breakTimer = null;
  function loadBreak(keepSeq) {
    if (!booted) return;
    var buf = FunsaiKits.renderBreak(ctx.sampleRate, S.kit, S.pat, S.bpm);
    var pat = FunsaiKits.getPattern(S.pat);
    var sl = Math.min(32, pat.bars * 16);
    var changed = sl !== S.slices;
    S.slices = sl;
    if (!keepSeq || changed) {
      S.monoLen = sl;
      for (var i = 0; i < 32; i++) {
        S.slot[i] = i % sl;
        S.on[i] = 1;
        S.rev[i] = 0;
      }
      buildSlices();
      fillMonoLen();
    }
    send({ type: 'monobuf', l: buf, slices: sl }, [buf.buffer]);
    sendMono();
  }

  function loadUserBuffer(audioBuf) {
    var l = audioBuf.getChannelData(0);
    var r = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : l;
    var cl = new Float32Array(l), cr = new Float32Array(r);
    if (S.mode === 'mono') {
      var barSec = 60 / S.bpm * 4;
      var sl = audioBuf.duration > barSec * 1.5 ? 32 : 16;
      S.slices = sl;
      S.monoLen = sl;
      for (var i = 0; i < 32; i++) { S.slot[i] = i % sl; S.on[i] = 1; S.rev[i] = 0; }
      S.fit = true;
      $('fit').checked = true;
      buildSlices();
      fillMonoLen();
      send({ type: 'monobuf', l: cl, r: cr, slices: sl }, [cl.buffer, cr.buffer]);
      sendMono();
    } else {
      var slot = S.target < 4 ? S.target : 0;
      send({ type: 'kitbuf', slot: slot, l: cl, r: cr }, [cl.buffer, cr.buffer]);
      send({ type: 'trig', track: slot });
      flash($('loadLabel'), TRACKS[slot].en + ' ←');
    }
  }

  function sendMono() {
    var seq = [];
    for (var i = 0; i < 32; i++) seq.push(S.on[i] ? S.slot[i] : -1);
    send({ type: 'monopat', seq: seq, rev: Array.prototype.slice.call(S.rev), len: S.monoLen, fit: S.fit });
  }

  function sendTrack(i) {
    var tr = S.tracks[i];
    send({ type: 'pattern', track: i, pat: Array.prototype.slice.call(tr.pat), len: tr.len, res: tr.res });
    send({ type: 'trackparam', track: i, mute: tr.mute });
  }

  function loadGrid(id) {
    var g = FunsaiKits.patternGrid(id);
    for (var i = 0; i < 4; i++) {
      S.tracks[i].pat = g.grid[i].pat;
      S.tracks[i].len = g.grid[i].len;
      S.tracks[i].res = g.grid[i].res || 1;
    }
    buildGrid();
    for (var j = 0; j < 4; j++) sendTrack(j);
  }

  function pushAllFx() {
    for (var tg = 0; tg < 5; tg++) {
      for (var i = 0; i < PADS.length; i++) {
        var id = PADS[i].id;
        var f = S.fx[tg][id];
        send({ type: 'fxxy', target: tg, id: id, x: f.x, y: f.y });
      }
    }
  }

  /* ================================================================== *
   * slice sequencer (MONO)
   * ================================================================== */
  var sliceEls = [];
  function buildSlices() {
    var host = $('slices');
    host.innerHTML = '';
    sliceEls = [];
    for (var i = 0; i < S.monoLen; i++) {
      var el = document.createElement('div');
      el.className = 'slice';
      el.dataset.i = i;
      var n = document.createElement('b');
      el.appendChild(n);
      host.appendChild(el);
      sliceEls.push(el);
    }
    paintSlices();
  }

  function paintSlices() {
    for (var i = 0; i < sliceEls.length; i++) {
      var el = sliceEls[i];
      el.classList.toggle('off', !S.on[i]);
      el.classList.toggle('rev', !!S.rev[i]);
      el.classList.toggle('moved', S.slot[i] !== i % S.slices);
      el.firstChild.textContent = S.on[i] ? (S.slot[i] + 1) : '·';
    }
  }

  function fillMonoLen() {
    var sel = $('monoLen');
    sel.innerHTML = '';
    var opts = [4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 24, 32];
    for (var i = 0; i < opts.length; i++) {
      if (opts[i] > 32) continue;
      var op = document.createElement('option');
      op.value = opts[i];
      op.textContent = opts[i];
      sel.appendChild(op);
    }
    sel.value = String(S.monoLen);
  }

  (function sliceInput() {
    var host = $('slices');
    var drag = null;
    host.addEventListener('pointerdown', function (e) {
      var el = e.target.closest ? e.target.closest('.slice') : null;
      if (!el) return;
      host.setPointerCapture(e.pointerId);
      drag = { el: el, i: +el.dataset.i, y: e.clientY, base: S.slot[+el.dataset.i], moved: false };
      e.preventDefault();
    });
    host.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = drag.y - e.clientY;
      if (Math.abs(dy) < 9) return;
      drag.moved = true;
      var d = Math.round(dy / 13);
      var v = drag.base + d;
      v = ((v % S.slices) + S.slices) % S.slices;
      if (v !== S.slot[drag.i]) {
        S.slot[drag.i] = v;
        S.on[drag.i] = 1;
        paintSlices();
        sendMono();
      }
    });
    function end() {
      if (!drag) return;
      if (!drag.moved) {
        var i = drag.i;
        if (S.on[i] && !S.rev[i]) S.rev[i] = 1;
        else if (S.on[i] && S.rev[i]) { S.on[i] = 0; S.rev[i] = 0; }
        else { S.on[i] = 1; S.rev[i] = 0; }
        paintSlices();
        sendMono();
      }
      drag = null;
    }
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
  })();

  /* ================================================================== *
   * step grid (KIT)
   * ================================================================== */
  var gridRows = [];
  function buildGrid() {
    var host = $('grid');
    host.innerHTML = '';
    gridRows = [];
    for (var i = 0; i < 4; i++) {
      var tr = S.tracks[i];
      var row = document.createElement('div');
      row.className = 'row';

      var head = document.createElement('div');
      head.className = 'rowHead';

      var nm = document.createElement('button');
      nm.className = 'trName';
      nm.innerHTML = '<b>' + TRACKS[i].en + '</b><em>' + TRACKS[i].jp + '</em>';
      nm.dataset.track = i;
      head.appendChild(nm);

      var lenSel = document.createElement('select');
      lenSel.className = 'mini';
      [4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 24, 32].forEach(function (v) {
        var op = document.createElement('option');
        op.value = v; op.textContent = v;
        lenSel.appendChild(op);
      });
      lenSel.value = String(tr.len);
      lenSel.dataset.track = i;
      lenSel.dataset.kind = 'len';
      head.appendChild(lenSel);

      var resSel = document.createElement('select');
      resSel.className = 'mini';
      RES.forEach(function (r) {
        var op = document.createElement('option');
        op.value = r.v; op.textContent = r.n;
        resSel.appendChild(op);
      });
      resSel.value = String(tr.res);
      resSel.dataset.track = i;
      resSel.dataset.kind = 'res';
      head.appendChild(resSel);

      var mute = document.createElement('button');
      mute.className = 'mute' + (tr.mute ? ' on' : '');
      mute.textContent = 'M';
      mute.dataset.track = i;
      head.appendChild(mute);

      row.appendChild(head);

      var cells = document.createElement('div');
      cells.className = 'cells';
      cells.dataset.track = i;
      for (var s = 0; s < tr.len; s++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.track = i;
        cell.dataset.step = s;
        cells.appendChild(cell);
      }
      row.appendChild(cells);
      host.appendChild(row);
      gridRows.push({ cells: cells, nodes: cells.children });
    }
    paintGrid();
  }

  function paintGrid() {
    for (var i = 0; i < gridRows.length; i++) {
      var nodes = gridRows[i].nodes;
      var tr = S.tracks[i];
      for (var s = 0; s < nodes.length; s++) {
        var v = tr.pat[s];
        nodes[s].className = 'cell' + (v === 3 ? ' hit' : v === 2 ? ' ghost' : '');
      }
    }
  }

  (function gridInput() {
    var host = $('grid');
    var paint = -1;
    function cellAt(e) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      return el && el.classList && el.classList.contains('cell') ? el : null;
    }
    function apply(el, v) {
      var ti = +el.dataset.track, si = +el.dataset.step;
      if (S.tracks[ti].pat[si] === v) return;
      S.tracks[ti].pat[si] = v;
      paintGrid();
      sendTrack(ti);
    }
    host.addEventListener('pointerdown', function (e) {
      var tgt = e.target;
      if (tgt.classList.contains('trName') || (tgt.parentElement && tgt.parentElement.classList.contains('trName'))) {
        var b = tgt.classList.contains('trName') ? tgt : tgt.parentElement;
        send({ type: 'trig', track: +b.dataset.track });
        return;
      }
      if (tgt.classList.contains('mute')) {
        var mi = +tgt.dataset.track;
        S.tracks[mi].mute = !S.tracks[mi].mute;
        tgt.classList.toggle('on', S.tracks[mi].mute);
        sendTrack(mi);
        return;
      }
      if (!tgt.classList.contains('cell')) return;
      var ti = +tgt.dataset.track, si = +tgt.dataset.step;
      var cur = S.tracks[ti].pat[si];
      paint = cur === 0 ? 3 : cur === 3 ? 2 : 0;
      host.setPointerCapture(e.pointerId);
      apply(tgt, paint);
      e.preventDefault();
    });
    host.addEventListener('pointermove', function (e) {
      if (paint < 0) return;
      var el = cellAt(e);
      if (el) apply(el, paint);
    });
    function end() { paint = -1; }
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('change', function (e) {
      var sel = e.target;
      if (sel.tagName !== 'SELECT') return;
      var ti = +sel.dataset.track;
      if (sel.dataset.kind === 'len') {
        S.tracks[ti].len = +sel.value;
        buildGrid();
      } else {
        S.tracks[ti].res = +sel.value;
      }
      sendTrack(ti);
    });
  })();

  /* ================================================================== *
   * targets
   * ================================================================== */
  function buildTargets() {
    var host = $('targets');
    host.innerHTML = '';
    var list = S.mode === 'mono'
      ? [{ i: 0, jp: '素', en: 'SRC' }, { i: 4, jp: '総', en: 'MST' }]
      : [{ i: 4, jp: '総', en: 'MST' },
         { i: 0, jp: 'バス', en: 'BD' }, { i: 1, jp: 'ハット', en: 'HH' },
         { i: 2, jp: 'スネア', en: 'SD' }, { i: 3, jp: 'シンバル', en: 'CY' }];
    if (list.map(function (x) { return x.i; }).indexOf(S.target) < 0) S.target = list[0].i;
    list.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'tgt' + (d.i === S.target ? ' on' : '');
      b.innerHTML = '<b>' + d.en + '</b><em>' + d.jp + '</em><i class="lv"></i>';
      b.dataset.i = d.i;
      b.addEventListener('click', function () {
        S.target = d.i;
        buildTargets();
        paintAllPads();
        if (S.mode === 'kit') {
          $('loadLabel').textContent = '読込→' + TRACKS[S.target < 4 ? S.target : 0].en;
        }
      });
      host.appendChild(b);
    });
    paintTargetActivity();
  }

  /* ================================================================== *
   * pads
   * ================================================================== */
  var padEls = {};
  function buildPads() {
    var host = $('pads');
    host.innerHTML = '';
    padEls = {};
    PADS.forEach(function (d, i) {
      var el = document.createElement('div');
      el.className = 'pad';
      el.dataset.id = d.id;
      el.innerHTML =
        '<i class="cross"></i>' +
        '<i class="vline"></i><i class="hline"></i>' +
        '<div class="lbl"><b>' + d.jp + '</b><em>' + d.en + '</em></div>' +
        '<div class="key">' + KEYS[i].toUpperCase() + '</div>' +
        '<div class="vals"><span class="vx"></span><span class="vy"></span></div>';
      host.appendChild(el);
      padEls[d.id] = el;
    });
    paintAllPads();
  }

  function padDef(id) {
    for (var i = 0; i < PADS.length; i++) if (PADS[i].id === id) return PADS[i];
    return null;
  }

  function paintPad(id) {
    var el = padEls[id];
    if (!el) return;
    var f = S.fx[S.target][id];
    var d = padDef(id);
    el.classList.toggle('on', f.on);
    el.classList.toggle('bot', f.auto && !f.on);
    el.style.setProperty('--px', (f.x * 100).toFixed(1) + '%');
    el.style.setProperty('--py', ((1 - f.y) * 100).toFixed(1) + '%');
    el.querySelector('.vx').textContent = d.xn + ' ' + d.xf(f.x);
    el.querySelector('.vy').textContent = d.yn + ' ' + d.yf(f.y);
  }

  function paintAllPads() {
    for (var i = 0; i < PADS.length; i++) paintPad(PADS[i].id);
  }

  function setPadXY(id, x, y) {
    var f = S.fx[S.target][id];
    f.x = clamp(x, 0, 1);
    f.y = clamp(y, 0, 1);
    send({ type: 'fxxy', target: S.target, id: id, x: f.x, y: f.y });
    paintPad(id);
  }

  function pressPad(id, x, y) {
    var f = S.fx[S.target][id];
    if (x !== undefined) { f.x = clamp(x, 0, 1); f.y = clamp(y, 0, 1); }
    f.on = true;
    send({ type: 'fx', target: S.target, id: id, on: true, x: f.x, y: f.y });
    paintPad(id);
    paintTargetActivity();
  }

  function releasePad(id, target) {
    var tg = target === undefined ? S.target : target;
    var f = S.fx[tg][id];
    f.on = false;
    send({ type: 'fx', target: tg, id: id, on: false });
    if (tg === S.target) paintPad(id);
    paintTargetActivity();
  }

  (function padInput() {
    var host = $('pads');
    var active = {};   // pointerId -> {id, target, x0, y0, cx, cy}

    function xyIn(el, e) {
      var r = el.getBoundingClientRect();
      return {
        x: clamp((e.clientX - r.left) / r.width, 0, 1),
        y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1),
        w: r.width, h: r.height
      };
    }

    host.addEventListener('pointerdown', function (e) {
      var el = e.target.closest ? e.target.closest('.pad') : null;
      if (!el) return;
      var id = el.dataset.id;
      var f = S.fx[S.target][id];
      var pt = xyIn(el, e);
      el.setPointerCapture(e.pointerId);
      e.preventDefault();

      if (S.latch && f.on) { releasePad(id); return; }

      var use = S.xyhold ? { x: f.x, y: f.y } : { x: pt.x, y: pt.y };
      active[e.pointerId] = {
        id: id, target: S.target, latched: S.latch,
        cx: e.clientX, cy: e.clientY, x0: use.x, y0: use.y, w: pt.w, h: pt.h
      };
      pressPad(id, use.x, use.y);
    });

    host.addEventListener('pointermove', function (e) {
      var a = active[e.pointerId];
      if (!a) return;
      var el = padEls[a.id];
      if (S.xyhold) {
        setPadXY(a.id, a.x0 + (e.clientX - a.cx) / a.w, a.y0 - (e.clientY - a.cy) / a.h);
      } else {
        var pt = xyIn(el, e);
        setPadXY(a.id, pt.x, pt.y);
      }
    });

    function up(e) {
      var a = active[e.pointerId];
      if (!a) return;
      delete active[e.pointerId];
      if (!a.latched) releasePad(a.id, a.target);
    }
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
  })();

  /* keyboard */
  var keyHeld = {};
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    var k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); togglePlay(); return; }
    if (k === '0') { e.preventDefault(); panic(); return; }
    var i = KEYS.indexOf(k);
    if (i < 0) return;
    e.preventDefault();
    if (keyHeld[k]) return;
    keyHeld[k] = PADS[i].id;
    var f = S.fx[S.target][PADS[i].id];
    if (S.latch && f.on) releasePad(PADS[i].id);
    else pressPad(PADS[i].id);
  });
  document.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase();
    if (!keyHeld[k]) return;
    if (!S.latch) releasePad(keyHeld[k]);
    delete keyHeld[k];
  });

  /* ================================================================== *
   * transport / controls
   * ================================================================== */
  function togglePlay() {
    if (!booted) return;
    S.playing = !S.playing;
    send({ type: 'transport', running: S.playing, reset: S.playing });
    $('play').textContent = S.playing ? '■' : '▶';
    $('play').classList.toggle('on', S.playing);
  }

  function panic() {
    send({ type: 'panic' });
    for (var tg = 0; tg < 5; tg++) {
      for (var i = 0; i < PADS.length; i++) {
        S.fx[tg][PADS[i].id].on = false;
        S.fx[tg][PADS[i].id].auto = false;
      }
    }
    keyHeld = {};
    paintAllPads();
    paintTargetActivity();
  }

  function flash(el, msg) {
    var old = el.textContent;
    el.textContent = msg;
    setTimeout(function () { el.textContent = old; }, 900);
  }

  function setMode(m) {
    S.mode = m;
    panic();
    send({ type: 'mode', mode: m });
    $('seqMono').hidden = m !== 'mono';
    $('seqKit').hidden = m !== 'kit';
    var btns = document.querySelectorAll('#modeSwitch .mode');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].dataset.mode === m);
    $('loadLabel').textContent = m === 'mono' ? '読込' : '読込→' + TRACKS[S.target < 4 ? S.target : 0].en;
    buildTargets();
    paintAllPads();
  }

  function dice() {
    if (S.mode === 'mono') {
      for (var i = 0; i < S.monoLen; i++) {
        var r = Math.random();
        S.slot[i] = Math.floor(Math.random() * S.slices);
        if (r < 0.45) S.slot[i] = i % S.slices;             // keep some of the groove
        S.rev[i] = Math.random() < 0.13 ? 1 : 0;
        S.on[i] = Math.random() < 0.08 ? 0 : 1;
      }
      paintSlices();
      sendMono();
    } else {
      var dens = [0.3, 0.55, 0.22, 0.08];
      for (var tk = 0; tk < 4; tk++) {
        var tr = S.tracks[tk];
        if (Math.random() < 0.3) tr.len = [16, 16, 12, 14, 15, 32][Math.floor(Math.random() * 6)];
        if (Math.random() < 0.25) tr.res = [1, 1, 2, 0.5, 3][Math.floor(Math.random() * 5)];
        tr.pat = new Uint8Array(32);
        for (var s = 0; s < tr.len; s++) {
          var on = Math.random() < dens[tk];
          if (tk === 0 && s === 0) on = true;
          if (tk === 2 && (s % 8) === 4) on = Math.random() < 0.8;
          tr.pat[s] = on ? (Math.random() < 0.7 ? 3 : 2) : 0;
        }
      }
      buildGrid();
      for (var j = 0; j < 4; j++) sendTrack(j);
    }
  }

  function toggleRec() {
    if (!recDest || typeof MediaRecorder === 'undefined') {
      flash($('rec'), '非対応');
      return;
    }
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    var mt = '';
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) { mt = types[i]; break; }
    }
    try {
      recorder = mt ? new MediaRecorder(recDest.stream, { mimeType: mt, audioBitsPerSecond: 256000 })
                    : new MediaRecorder(recDest.stream);
    } catch (e) {
      flash($('rec'), '非対応');
      return;
    }
    recChunks = [];
    recorder.ondataavailable = function (e) { if (e.data.size) recChunks.push(e.data); };
    recorder.onstop = function () {
      var blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
      var ext = (recorder.mimeType || '').indexOf('mp4') >= 0 ? 'm4a'
              : (recorder.mimeType || '').indexOf('ogg') >= 0 ? 'ogg' : 'webm';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'funsai-' + Date.now() + '.' + ext;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      $('rec').classList.remove('rec');
      $('rec').textContent = '●録音';
    };
    recorder.start();
    $('rec').classList.add('rec');
    $('rec').textContent = '■停止';
  }

  /* ================================================================== *
   * scope
   * ================================================================== */
  var scope = null, sctx = null;
  function sizeScope() {
    if (!scope) return;
    var r = scope.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    scope.width = Math.max(1, Math.floor(r.width * dpr));
    scope.height = Math.max(1, Math.floor(r.height * dpr));
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!sctx) return;
    var w = scope.width, h = scope.height;
    sctx.clearRect(0, 0, w, h);
    sctx.fillStyle = 'rgba(10,10,9,0.9)';
    sctx.fillRect(0, 0, w, h);

    if (analyser) {
      analyser.getByteTimeDomainData(scopeData);
      sctx.beginPath();
      var n = scopeData.length;
      for (var i = 0; i < n; i++) {
        var v = (scopeData[i] - 128) / 128;
        var x = i / (n - 1) * w;
        var y = h * 0.5 - v * h * 0.46;
        if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
      }
      sctx.strokeStyle = '#e9d64a';
      sctx.lineWidth = Math.max(1, h / 44);
      sctx.stroke();
    }

    /* per-bus level ticks */
    var labels = ['1', '2', '3', '4', 'M'];
    for (var c = 0; c < 5; c++) {
      var lv = Math.min(1, S.peaks[c] || 0);
      var bw = w / 5;
      sctx.fillStyle = lv > 0.98 ? 'rgba(226,80,50,0.65)' : 'rgba(233,214,74,0.22)';
      sctx.fillRect(c * bw + 2, h - 3 - lv * (h * 0.3), bw - 4, lv * (h * 0.3) + 2);
    }

    /* playhead ticks */
    if (S.mode === 'mono') {
      for (var i2 = 0; i2 < sliceEls.length; i2++) {
        sliceEls[i2].classList.toggle('now', i2 === S.pos.mono);
      }
    } else {
      for (var g = 0; g < gridRows.length; g++) {
        var nodes = gridRows[g].nodes;
        var st = S.pos.t[g];
        for (var s2 = 0; s2 < nodes.length; s2++) {
          if (s2 === st) nodes[s2].classList.add('now');
          else if (nodes[s2].classList.contains('now')) nodes[s2].classList.remove('now');
        }
      }
    }
  }

  /* ================================================================== *
   * wiring
   * ================================================================== */
  function initUI() {
    var kitSel = $('kitSel');
    FunsaiKits.KITS.forEach(function (k) {
      var op = document.createElement('option');
      op.value = k.id;
      op.textContent = k.name + ' ' + k.sub.split(' / ')[1];
      kitSel.appendChild(op);
    });
    kitSel.value = S.kit;

    var patSel = $('patSel');
    FunsaiKits.PATTERNS.forEach(function (p) {
      var op = document.createElement('option');
      op.value = p.id;
      op.textContent = p.name;
      patSel.appendChild(op);
    });
    patSel.value = S.pat;

    kitSel.addEventListener('change', function () {
      S.kit = kitSel.value;
      loadKit(S.kit);
      if (S.mode === 'mono') loadBreak(true);
    });
    patSel.addEventListener('change', function () {
      S.pat = patSel.value;
      var p = FunsaiKits.getPattern(S.pat);
      S.bpm = p.bpm;
      $('bpm').value = p.bpm;
      $('bpmv').textContent = p.bpm;
      send({ type: 'bpm', bpm: S.bpm });
      loadBreak(false);
      loadGrid(S.pat);
    });

    $('play').addEventListener('click', togglePlay);
    $('panic').addEventListener('click', panic);
    $('dice').addEventListener('click', dice);
    $('resync').addEventListener('click', function () { send({ type: 'resync' }); });
    $('rec').addEventListener('click', toggleRec);

    $('bpm').addEventListener('input', function () {
      S.bpm = +this.value;
      $('bpmv').textContent = S.bpm;
      send({ type: 'bpm', bpm: S.bpm });
      if (S.mode === 'mono') {
        clearTimeout(breakTimer);
        breakTimer = setTimeout(function () { loadBreak(true); }, 350);
      }
    });
    $('swing').addEventListener('input', function () {
      S.swing = +this.value / 100;
      $('swingv').textContent = this.value;
      send({ type: 'swing', swing: S.swing });
    });
    $('vol').addEventListener('input', function () {
      if (masterGain) masterGain.gain.value = +this.value / 100;
    });
    $('fit').addEventListener('change', function () { S.fit = this.checked; sendMono(); });
    $('monoLen').addEventListener('change', function () {
      S.monoLen = +this.value;
      buildSlices();
      sendMono();
    });

    var ms = document.querySelectorAll('#modeSwitch .mode');
    for (var i = 0; i < ms.length; i++) {
      (function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); })(ms[i]);
    }

    $('latch').addEventListener('click', function () {
      S.latch = !S.latch;
      this.classList.toggle('on', S.latch);
      if (!S.latch) panic();
    });
    $('xyhold').addEventListener('click', function () {
      S.xyhold = !S.xyhold;
      this.classList.toggle('on', S.xyhold);
    });
    $('auto').addEventListener('click', function () {
      S.auto = !S.auto;
      this.classList.toggle('on', S.auto);
      send({ type: 'auto', on: S.auto, amt: S.autoAmt });
    });
    $('autoAmt').addEventListener('input', function () {
      S.autoAmt = +this.value / 100;
      send({ type: 'auto', on: S.auto, amt: S.autoAmt });
    });

    $('file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f || !ctx) return;
      flash($('loadLabel'), '解析中');
      f.arrayBuffer().then(function (ab) { return ctx.decodeAudioData(ab); })
        .then(loadUserBuffer)
        .catch(function () { flash($('loadLabel'), '失敗'); });
      this.value = '';
    });

    buildPads();
    buildTargets();
    buildSlices();
    buildGrid();

    scope = $('scope');
    sctx = scope.getContext('2d');
    sizeScope();
    window.addEventListener('resize', sizeScope);
    draw();
  }

  $('start').addEventListener('click', function () {
    var splash = $('splash');
    $('start').disabled = true;
    $('start').textContent = '生成中…';
    boot().then(function () {
      return ctx.resume();
    }).then(function () {
      splash.classList.add('gone');
      setTimeout(function () { splash.style.display = 'none'; }, 400);
      sizeScope();
      togglePlay();
    }).catch(function (err) {
      $('start').disabled = false;
      $('start').textContent = '起動に失敗: ' + (err && err.message ? err.message : err);
    });
  });

  initUI();
})();
