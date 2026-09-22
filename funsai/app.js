/* 粉砕 FUNSAI — UI, state and wiring. */
(function () {
  'use strict';

  var NSTEP = 64;
  var NLANE = 4;

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
  function pad2(v) { var s = String(Math.abs(v)); return s.length < 2 ? '0' + s : s; }

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
  var DRUMS = [{ k: 'bd', n: 'BD', jp: 'バス' }, { k: 'hh', n: 'HH', jp: 'ハット' },
               { k: 'sd', n: 'SD', jp: 'スネア' }, { k: 'cy', n: 'CY', jp: 'シンバル' }];
  var ROLES = [{ v: 0, n: '全' }, { v: 1, n: '低' }, { v: 2, n: '中' }, { v: 3, n: '高' }];
  var RES = [{ v: 0.5, n: '½' }, { v: 1, n: '×1' }, { v: 1.5, n: '1.5' },
             { v: 2, n: '×2' }, { v: 3, n: '×3' }, { v: 4, n: '×4' }];
  var LENS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 24, 32, 48, 64];

  /* per hit destruction, matching engine voice fx ids */
  var HITFX = ['··', '砕', '歪', '濾', '環', '停', '飛'];
  var HITFXN = ['なし', 'ビット粉砕', '歪ませる', 'フィルタ', 'リング', 'テープ停止', '音飛び'];

  /* tracker columns */
  var TCOLS = [
    { k: 'slice', n: '切', lo: -1, hi: 31 },
    { k: 'pitch', n: '音', lo: -24, hi: 24 },
    { k: 'rev', n: '逆', lo: 0, hi: 1 },
    { k: 'rtg', n: '連', lo: 1, hi: 16 },
    { k: 'racc', n: '速', lo: -4, hi: 4 },
    { k: 'fx', n: '加', lo: 0, hi: 6 },
    { k: 'fxa', n: '量', lo: 0, hi: 15 }
  ];

  var RWFLAGS = [
    { k: 'slice', n: '切片' }, { k: 'pitch', n: '音程' }, { k: 'rev', n: '逆' },
    { k: 'rtg', n: '連打' }, { k: 'fx', n: '加工' }, { k: 'rest', n: '抜き' },
    { k: 'meter', n: '拍子' }, { k: 'half', n: '倍速' }, { k: 'drop', n: '無音' }
  ];

  /* --- state --------------------------------------------------------- */
  function newEvents() {
    return {
      slice: new Int8Array(NSTEP), vel: new Uint8Array(NSTEP),
      pitch: new Int8Array(NSTEP), rev: new Uint8Array(NSTEP),
      rtg: new Uint8Array(NSTEP), racc: new Int8Array(NSTEP),
      fx: new Uint8Array(NSTEP), fxa: new Uint8Array(NSTEP)
    };
  }

  var S = {
    preset: 'layers', bpm: 174, swing: 0, playing: false, timeMul: 1,
    kit: 'niku', pat: 'amen', target: 4, sel: 0, view: 'grid',
    latch: false, xyhold: false, auto: false, autoAmt: 0.35,
    rw: { on: false, amt: 0.4,
          flags: { slice: true, pitch: true, rev: true, rtg: true, fx: true,
                   rest: true, meter: false, half: false, drop: true } },
    lanes: [], fx: [], peaks: [0, 0, 0, 0, 0],
    pos: { steps: [-1, -1, -1, -1], eff: [16, 16, 16, 16], drop: false, mul: 1 }
  };

  for (var li = 0; li < NLANE; li++) {
    S.lanes.push({
      src: { kind: 'break', id: 'amen', name: 'AMEN' },
      sliced: true, slices: 16, len: 16, res: 1, role: 0,
      mute: false, keep: false, gain: 0.9, user: false, fit: true,
      ev: newEvents()
    });
  }
  for (var ci = 0; ci < 5; ci++) {
    var o = {};
    for (var pi = 0; pi < PADS.length; pi++) {
      o[PADS[pi].id] = { on: false, auto: false, rnd: false, x: 0.5, y: 0.5 };
    }
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
    /* A blob URL is the efficient path, but on a file:// page the blob gets
       an opaque origin (blob:null/...) and addModule() refuses it. A data:
       URL is accepted from both origins, so fall back to it. */
    var blobUrl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    var load = ctx.audioWorklet.addModule(blobUrl)
      .then(function () { URL.revokeObjectURL(blobUrl); })
      .catch(function () {
        URL.revokeObjectURL(blobUrl);
        return ctx.audioWorklet.addModule('data:application/javascript,' + encodeURIComponent(src));
      });
    return load.then(function () {
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
      send({ type: 'timemul', v: S.timeMul });
      applyPreset(S.preset, true);
      pushAllFx();
      sendRewrite();
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
      S.pos.steps = m.steps;
      S.pos.eff = m.eff;
      S.pos.drop = m.drop;
      S.peaks = m.peaks;
      if (m.mul !== S.pos.mul) { S.pos.mul = m.mul; paintTimeMul(); }
      if (m.rnd) {
        for (var i = 0; i < m.rnd.length; i++) {
          var r = m.rnd[i];
          var f = S.fx[r.t][r.id];
          f.x = r.x; f.y = r.y;
          if (r.t === S.target) paintPad(r.id);
        }
      }
    } else if (m.type === 'autopad') {
      var af = S.fx[m.target][m.id];
      af.auto = m.on;
      if (m.on) { af.x = m.x; af.y = m.y; }
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

  /* ================================================================== *
   * sources
   * ================================================================== */
  var kitCache = {};
  function buildKitCached(id) {
    var key = id + '@' + ctx.sampleRate;
    if (!kitCache[key]) kitCache[key] = FunsaiKits.buildKit(ctx.sampleRate, id);
    return kitCache[key];
  }

  function srcLabel(src) {
    if (src.kind === 'user') return '⤒ ' + src.name;
    if (src.kind === 'break') return FunsaiKits.getPattern(src.id).name;
    if (src.kind === 'material') {
      var m = FunsaiKits.getMaterial(src.id);
      return m.name + ' ' + m.sub;
    }
    for (var i = 0; i < DRUMS.length; i++) if (DRUMS[i].k === src.id) return DRUMS[i].n;
    return '—';
  }

  function renderSource(kind, id) {
    var sr = ctx.sampleRate;
    if (kind === 'break') {
      var p = FunsaiKits.getPattern(id);
      return { buf: FunsaiKits.renderBreak(sr, S.kit, id, S.bpm),
               slices: Math.min(32, p.bars * 16), sliced: true };
    }
    if (kind === 'material') {
      var bars = id === 'chord' ? 2 : 1;
      return { buf: FunsaiKits.renderMaterial(sr, id, S.bpm, bars),
               slices: Math.min(32, bars * 16), sliced: true };
    }
    return { buf: buildKitCached(S.kit)[id], slices: 1, sliced: false };
  }

  /* identity slice run: reproduces the source as recorded */
  function identityEvents(ln) {
    var ev = ln.ev;
    for (var i = 0; i < NSTEP; i++) {
      ev.slice[i] = ln.sliced ? (i % ln.slices) : 0;
      ev.vel[i] = 3;
      ev.pitch[i] = 0; ev.rev[i] = 0; ev.rtg[i] = 1;
      ev.racc[i] = 0; ev.fx[i] = 0; ev.fxa[i] = 0;
    }
  }

  function setLaneSource(i, kind, id, keepEvents) {
    var ln = S.lanes[i];
    var r = renderSource(kind, id);
    ln.src = { kind: kind, id: id };
    ln.user = false;
    ln.sliced = r.sliced;
    ln.slices = r.slices;
    if (!keepEvents) {
      if (r.sliced) { ln.len = r.slices; identityEvents(ln); }
      else { ln.len = 16; identityEvents(ln); }
    }
    var copy = new Float32Array(r.buf);
    send({ type: 'lanebuf', i: i, l: copy, slices: r.slices, sliced: r.sliced }, [copy.buffer]);
    sendLane(i);
    sendEvents(i);
  }

  function sendLane(i) {
    var ln = S.lanes[i];
    send({ type: 'lane', i: i, sliced: ln.sliced, slices: ln.slices, len: ln.len,
           res: ln.res, role: ln.role, gain: ln.gain, mute: ln.mute,
           keep: ln.keep, fit: ln.fit });
  }

  function sendEvents(i) {
    var ev = S.lanes[i].ev;
    send({ type: 'events', i: i,
           slice: Array.prototype.slice.call(ev.slice),
           vel: Array.prototype.slice.call(ev.vel),
           pitch: Array.prototype.slice.call(ev.pitch),
           rev: Array.prototype.slice.call(ev.rev),
           rtg: Array.prototype.slice.call(ev.rtg),
           racc: Array.prototype.slice.call(ev.racc),
           fx: Array.prototype.slice.call(ev.fx),
           fxa: Array.prototype.slice.call(ev.fxa) });
  }

  function sendRewrite() {
    send({ type: 'rewrite', on: S.rw.on, amt: S.rw.amt, flags: S.rw.flags });
  }

  /* LAYERS: several drummers at once, split by register, plus a harmony
     layer that survives the drops. KIT: four one shot drums. */
  function applyPreset(name, initial) {
    S.preset = name;
    var i;
    if (name === 'layers') {
      var plan = [
        { kind: 'break', id: 'amen', role: 1, res: 1 },
        { kind: 'break', id: 'funky', role: 3, res: 1 },
        { kind: 'break', id: 'think', role: 2, res: 1 },
        { kind: 'material', id: 'chord', role: 0, res: 0.5 }
      ];
      for (i = 0; i < NLANE; i++) {
        var ln = S.lanes[i];
        ln.role = plan[i].role;
        ln.res = plan[i].res;
        ln.mute = false;
        ln.keep = i === 3;
        ln.gain = i === 3 ? 0.5 : 0.78;   // three breaks stack: leave headroom
        setLaneSource(i, plan[i].kind, plan[i].id);
      }
    } else {
      for (i = 0; i < NLANE; i++) {
        var l2 = S.lanes[i];
        l2.role = 0; l2.res = 1; l2.mute = false; l2.keep = false; l2.gain = 0.9;
        setLaneSource(i, 'drum', DRUMS[i].k);
      }
      applyPattern(S.pat);
    }
    if (!initial) { S.sel = 0; }
    buildGrid();
    buildTracker();
    buildTargets();
    buildSourceRow();
  }

  /* fill the four one shot lanes from a drum pattern */
  function applyPattern(id) {
    var g = FunsaiKits.patternGrid(id);
    for (var i = 0; i < NLANE; i++) {
      var ln = S.lanes[i];
      if (ln.sliced) continue;                 // a sliced lane has no drum grid
      var row = g.grid[i].pat;
      ln.len = g.grid[i].len;
      ln.res = g.grid[i].res || 1;
      for (var s = 0; s < NSTEP; s++) {
        var v = s < row.length ? row[s] : 0;
        ln.ev.slice[s] = v > 0 ? 0 : -1;
        ln.ev.vel[s] = v > 0 ? v : 0;
        ln.ev.pitch[s] = 0; ln.ev.rev[s] = 0; ln.ev.rtg[s] = 1;
        ln.ev.racc[s] = 0; ln.ev.fx[s] = 0; ln.ev.fxa[s] = 0;
      }
      sendLane(i);
      sendEvents(i);
    }
  }

  /* re-render built in sources at the new tempo; never touch a user file */
  var srcTimer = null;
  function rerenderSources() {
    for (var i = 0; i < NLANE; i++) {
      var ln = S.lanes[i];
      if (ln.user) continue;                   // the reported bug: don't clobber loads
      if (ln.src.kind === 'drum') continue;    // one shots don't follow tempo
      var r = renderSource(ln.src.kind, ln.src.id);
      var copy = new Float32Array(r.buf);
      send({ type: 'lanebuf', i: i, l: copy, slices: r.slices, sliced: r.sliced }, [copy.buffer]);
    }
  }

  function loadUserBuffer(audioBuf, name) {
    var i = S.sel;
    var ln = S.lanes[i];
    var l = audioBuf.getChannelData(0);
    var r = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : l;
    var cl = new Float32Array(l), cr = new Float32Array(r);

    var barSec = 60 / S.bpm * 4;
    var sliced = audioBuf.duration > 0.6;      // anything longer than a hit gets chopped
    var slices = sliced ? (audioBuf.duration > barSec * 1.5 ? 32 : 16) : 1;

    ln.src = { kind: 'user', id: name, name: name };
    ln.user = true;
    ln.sliced = sliced;
    ln.slices = slices;
    ln.fit = true;
    ln.len = sliced ? slices : ln.len;
    identityEvents(ln);

    send({ type: 'lanebuf', i: i, l: cl, r: cr, slices: slices, sliced: sliced }, [cl.buffer, cr.buffer]);
    sendLane(i);
    sendEvents(i);
    buildGrid();
    buildTracker();
    buildSourceRow();
    flash($('loadLabel'), (i + 1) + '← ' + name.slice(0, 10));
  }

  function pushAllFx() {
    for (var tg = 0; tg < 5; tg++) {
      for (var i = 0; i < PADS.length; i++) {
        var id = PADS[i].id;
        var f = S.fx[tg][id];
        send({ type: 'fxxy', target: tg, id: id, x: f.x, y: f.y });
        if (f.rnd) send({ type: 'fxrnd', target: tg, id: id, on: true });
      }
    }
  }

  /* ================================================================== *
   * lane grid (quick editor)
   * ================================================================== */
  var gridRows = [];
  function buildGrid() {
    var host = $('grid');
    if (!host) return;
    host.innerHTML = '';
    gridRows = [];
    for (var i = 0; i < NLANE; i++) {
      var ln = S.lanes[i];
      var row = document.createElement('div');
      row.className = 'row' + (i === S.sel ? ' sel' : '');
      row.dataset.lane = i;

      var head = document.createElement('div');
      head.className = 'rowHead';

      var nm = document.createElement('button');
      nm.className = 'trName';
      nm.innerHTML = '<b>' + (i + 1) + '</b><em>' + srcLabel(ln.src) + '</em>';
      nm.dataset.lane = i;
      nm.dataset.act = 'sel';
      head.appendChild(nm);

      head.appendChild(mkSel(i, 'role', ROLES, ln.role, '役'));
      head.appendChild(mkSel(i, 'len', LENS.map(function (v) { return { v: v, n: v }; }), ln.len, '長'));
      head.appendChild(mkSel(i, 'res', RES, ln.res, '速'));

      var mute = document.createElement('button');
      mute.className = 'mute' + (ln.mute ? ' on' : '');
      mute.textContent = 'M';
      mute.dataset.lane = i;
      mute.dataset.act = 'mute';
      head.appendChild(mute);

      var fit = document.createElement('button');
      fit.className = 'mute fit' + (ln.fit ? ' on' : '');
      fit.textContent = '尺';
      fit.title = '切片を1ステップ長に合わせる（切ると元の速さ・音程のまま鳴る）';
      fit.dataset.lane = i;
      fit.dataset.act = 'fit';
      head.appendChild(fit);

      var keep = document.createElement('button');
      keep.className = 'mute keep' + (ln.keep ? ' on' : '');
      keep.textContent = '残';
      keep.title = '無音ドロップでも鳴らし続ける';
      keep.dataset.lane = i;
      keep.dataset.act = 'keep';
      head.appendChild(keep);

      row.appendChild(head);

      var cells = document.createElement('div');
      cells.className = 'cells';
      for (var s = 0; s < ln.len; s++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.lane = i;
        cell.dataset.step = s;
        cells.appendChild(cell);
      }
      row.appendChild(cells);
      host.appendChild(row);
      gridRows.push({ nodes: cells.children });
    }
    paintGrid();
  }

  function mkSel(lane, kind, opts, val, title) {
    var sel = document.createElement('select');
    sel.className = 'mini';
    sel.title = title;
    opts.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.v; op.textContent = o.n;
      sel.appendChild(op);
    });
    sel.value = String(val);
    sel.dataset.lane = lane;
    sel.dataset.kind = kind;
    return sel;
  }

  function paintGrid() {
    for (var i = 0; i < gridRows.length; i++) {
      var nodes = gridRows[i].nodes;
      var ln = S.lanes[i];
      var ev = ln.ev;
      for (var s = 0; s < nodes.length; s++) {
        var c = 'cell';
        var on = ev.slice[s] >= 0;
        if (on) c += ev.vel[s] >= 3 ? ' hit' : ' ghost';
        if (ev.rtg[s] > 1) c += ' rtg';
        if (ev.fx[s] > 0) c += ' hfx';
        if (ev.rev[s]) c += ' rv';
        var node = nodes[s];
        node.className = c;
        /* On a sliced lane every step fires, so on/off says nothing. Shade
           by slice index instead: the untouched run reads as a smooth ramp
           and any reordering shows up as noise. */
        if (on && ln.sliced) {
          var t = ln.slices > 1 ? ev.slice[s] / (ln.slices - 1) : 0;
          var lig = (ev.vel[s] >= 3 ? 27 : 18) + t * 42;
          node.style.background = 'hsl(' + (55 - t * 30) + ',' + (58 + t * 20) + '%,' + lig + '%)';
        } else if (node.style.background) {
          node.style.background = '';
        }
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
      var ti = +el.dataset.lane, si = +el.dataset.step;
      var ev = S.lanes[ti].ev;
      var cur = ev.slice[si] >= 0 ? ev.vel[si] : 0;
      if (cur === v) return;
      if (v === 0) { ev.slice[si] = -1; ev.vel[si] = 0; }
      else {
        if (ev.slice[si] < 0) ev.slice[si] = S.lanes[ti].sliced ? (si % S.lanes[ti].slices) : 0;
        ev.vel[si] = v;
      }
      paintGrid();
      paintTracker();
      sendEvents(ti);
    }
    host.addEventListener('pointerdown', function (e) {
      var tgt = e.target;
      var act = tgt.dataset ? tgt.dataset.act : null;
      if (!act && tgt.parentElement && tgt.parentElement.dataset) act = tgt.parentElement.dataset.act;
      var holder = act ? (tgt.dataset && tgt.dataset.act ? tgt : tgt.parentElement) : null;
      if (act === 'sel') {
        selectLane(+holder.dataset.lane);
        send({ type: 'trig', i: +holder.dataset.lane });
        return;
      }
      if (act === 'mute' || act === 'keep' || act === 'fit') {
        var mi = +holder.dataset.lane;
        var ln = S.lanes[mi];
        if (act === 'mute') ln.mute = !ln.mute;
        else if (act === 'keep') ln.keep = !ln.keep;
        else ln.fit = !ln.fit;
        holder.classList.toggle('on', act === 'mute' ? ln.mute : act === 'keep' ? ln.keep : ln.fit);
        sendLane(mi);
        return;
      }
      if (!tgt.classList.contains('cell')) return;
      var ti = +tgt.dataset.lane, si = +tgt.dataset.step;
      var ev = S.lanes[ti].ev;
      var cur = ev.slice[si] >= 0 ? ev.vel[si] : 0;
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
      var ti = +sel.dataset.lane;
      var ln = S.lanes[ti];
      var k = sel.dataset.kind;
      if (k === 'len') { ln.len = +sel.value; buildGrid(); buildTracker(); }
      else if (k === 'res') ln.res = +sel.value;
      else if (k === 'role') ln.role = +sel.value;
      sendLane(ti);
    });
  })();

  function selectLane(i) {
    S.sel = i;
    var rows = document.querySelectorAll('#grid .row');
    for (var r = 0; r < rows.length; r++) rows[r].classList.toggle('sel', +rows[r].dataset.lane === i);
    buildTracker();
    buildSourceRow();
  }

  /* ================================================================== *
   * tracker (per hit editor)
   * ================================================================== */
  var trkCells = [];
  function buildTracker() {
    var host = $('tracker');
    if (!host) return;
    host.innerHTML = '';
    trkCells = [];
    var ln = S.lanes[S.sel];

    var head = document.createElement('div');
    head.className = 'trkRow trkHead';
    head.appendChild(mkTrkCell('行', 'idx'));
    for (var c = 0; c < TCOLS.length; c++) head.appendChild(mkTrkCell(TCOLS[c].n, 'h'));
    host.appendChild(head);

    for (var s = 0; s < ln.len; s++) {
      var row = document.createElement('div');
      row.className = 'trkRow' + (s % 4 === 0 ? ' beat' : '');
      row.dataset.step = s;
      var n = mkTrkCell(pad2(s + 1), 'idx');
      row.appendChild(n);
      var cs = [];
      for (var k = 0; k < TCOLS.length; k++) {
        var cell = mkTrkCell('', 'v');
        cell.dataset.step = s;
        cell.dataset.col = k;
        row.appendChild(cell);
        cs.push(cell);
      }
      host.appendChild(row);
      trkCells.push({ row: row, cells: cs });
    }
    paintTracker();
  }

  function mkTrkCell(txt, cls) {
    var d = document.createElement('div');
    d.className = 'trkCell ' + cls;
    d.textContent = txt;
    return d;
  }

  function trkText(ln, s, k) {
    var ev = ln.ev;
    if (k === 'slice') {
      if (ev.slice[s] < 0) return '··';
      return ln.sliced ? pad2(ev.slice[s] + 1) : (ev.vel[s] >= 3 ? '██' : '▒▒');
    }
    if (k === 'pitch') return ev.pitch[s] === 0 ? '···' : (ev.pitch[s] > 0 ? '+' : '−') + pad2(ev.pitch[s]);
    if (k === 'rev') return ev.rev[s] ? '◄' : '·';
    if (k === 'rtg') return (ev.rtg[s] || 1) <= 1 ? '··' : pad2(ev.rtg[s]);
    if (k === 'racc') return ev.racc[s] === 0 ? '··' : (ev.racc[s] > 0 ? '▲' : '▼') + Math.abs(ev.racc[s]);
    if (k === 'fx') return HITFX[ev.fx[s]] || '··';
    if (k === 'fxa') return ev.fx[s] === 0 ? '··' : pad2(ev.fxa[s]);
    return '';
  }

  function paintTracker() {
    var ln = S.lanes[S.sel];
    for (var i = 0; i < trkCells.length; i++) {
      var rest = ln.ev.slice[i] < 0;
      trkCells[i].row.classList.toggle('rest', rest);
      for (var k = 0; k < TCOLS.length; k++) {
        var cell = trkCells[i].cells[k];
        var kk = TCOLS[k].k;
        cell.textContent = trkText(ln, i, kk);
        cell.classList.toggle('zero', cell.textContent.indexOf('·') === 0);
      }
    }
  }

  function trkAdjust(s, col, delta, tap) {
    var ln = S.lanes[S.sel];
    var ev = ln.ev;
    var c = TCOLS[col];
    var k = c.k;
    if (k === 'slice') {
      if (tap) {
        if (ev.slice[s] >= 0) { ev.slice[s] = -1; ev.vel[s] = 0; }
        else { ev.slice[s] = ln.sliced ? (s % ln.slices) : 0; ev.vel[s] = 3; }
      } else {
        var hi = ln.sliced ? ln.slices - 1 : 0;
        var v = ev.slice[s] + delta;
        ev.slice[s] = clamp(v, -1, hi);
        ev.vel[s] = ev.slice[s] < 0 ? 0 : (ev.vel[s] || 3);
      }
    } else if (k === 'rev') {
      ev.rev[s] = tap ? (ev.rev[s] ? 0 : 1) : clamp(ev.rev[s] + delta, 0, 1);
    } else if (k === 'fx') {
      ev.fx[s] = tap ? (ev.fx[s] + 1) % 7 : clamp(ev.fx[s] + delta, 0, 6);
    } else if (k === 'rtg') {
      if (tap) {
        var cyc = [1, 2, 4, 8, 16];
        var at = cyc.indexOf(ev.rtg[s] || 1);
        ev.rtg[s] = cyc[(at + 1) % cyc.length];
      } else ev.rtg[s] = clamp((ev.rtg[s] || 1) + delta, 1, 16);
    } else if (k === 'pitch') {
      ev.pitch[s] = tap ? 0 : clamp(ev.pitch[s] + delta, -24, 24);
    } else if (k === 'racc') {
      ev.racc[s] = tap ? 0 : clamp(ev.racc[s] + delta, -4, 4);
    } else if (k === 'fxa') {
      ev.fxa[s] = tap ? (ev.fxa[s] + 4) % 16 : clamp(ev.fxa[s] + delta, 0, 15);
    }
    paintTracker();
    paintGrid();
    sendEvents(S.sel);
  }

  (function trackerInput() {
    var host = $('tracker');
    var drag = null;
    host.addEventListener('pointerdown', function (e) {
      var el = e.target;
      if (!el.classList || !el.classList.contains('v')) return;
      host.setPointerCapture(e.pointerId);
      drag = { s: +el.dataset.step, col: +el.dataset.col, y: e.clientY, last: 0, moved: false };
      e.preventDefault();
    });
    host.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var steps = Math.round((drag.y - e.clientY) / 11);
      if (steps === drag.last) return;
      if (Math.abs(steps) >= 1) drag.moved = true;
      trkAdjust(drag.s, drag.col, steps - drag.last, false);
      drag.last = steps;
    });
    function end() {
      if (!drag) return;
      if (!drag.moved) trkAdjust(drag.s, drag.col, 0, true);
      drag = null;
    }
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
  })();

  function setView(v) {
    S.view = v;
    $('gridWrap').hidden = false;
    $('trkWrap').hidden = v !== 'tracker';
    var bs = document.querySelectorAll('#viewSwitch button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].dataset.view === v);
    if (v === 'tracker') buildTracker();
  }

  /* ================================================================== *
   * source row for the selected lane
   * ================================================================== */
  function buildSourceRow() {
    var sel = $('laneSrc');
    if (!sel) return;
    var ln = S.lanes[S.sel];
    sel.innerHTML = '';

    var g1 = document.createElement('optgroup');
    g1.label = 'ブレイク';
    FunsaiKits.PATTERNS.forEach(function (p) {
      var op = document.createElement('option');
      op.value = 'break:' + p.id;
      op.textContent = p.name;
      g1.appendChild(op);
    });
    sel.appendChild(g1);

    var g2 = document.createElement('optgroup');
    g2.label = '素材（ドラム以外）';
    FunsaiKits.MATERIALS.forEach(function (m) {
      var op = document.createElement('option');
      op.value = 'material:' + m.id;
      op.textContent = m.name + ' ' + m.sub;
      g2.appendChild(op);
    });
    sel.appendChild(g2);

    var g3 = document.createElement('optgroup');
    g3.label = '単発（ドラム）';
    DRUMS.forEach(function (d) {
      var op = document.createElement('option');
      op.value = 'drum:' + d.k;
      op.textContent = d.n + ' ' + d.jp;
      g3.appendChild(op);
    });
    sel.appendChild(g3);

    if (ln.src.kind === 'user') {
      var og = document.createElement('option');
      og.value = 'user';
      og.textContent = '⤒ ' + ln.src.name;
      sel.insertBefore(og, sel.firstChild);
      sel.value = 'user';
    } else {
      sel.value = ln.src.kind + ':' + ln.src.id;
    }
    $('selLane').textContent = String(S.sel + 1);
    $('patWrap').hidden = S.preset !== 'kit';
  }

  /* ================================================================== *
   * targets
   * ================================================================== */
  function buildTargets() {
    var host = $('targets');
    host.innerHTML = '';
    var list = [{ i: 4, jp: '総', en: 'MST' }];
    for (var i = 0; i < NLANE; i++) {
      list.push({ i: i, jp: srcLabel(S.lanes[i].src).slice(0, 6), en: String(i + 1) });
    }
    if (list.map(function (x) { return x.i; }).indexOf(S.target) < 0) S.target = 4;
    list.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'tgt' + (d.i === S.target ? ' on' : '');
      b.innerHTML = '<b>' + d.en + '</b><em>' + d.jp + '</em>';
      b.dataset.i = d.i;
      b.addEventListener('click', function () {
        S.target = d.i;
        buildTargets();
        paintAllPads();
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
        '<button class="rbtn" data-r="' + d.id + '" title="この効果を乱数で振る／自動破壊の対象にする">R</button>' +
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
    el.classList.toggle('rnd', f.rnd);
    el.querySelector('.rbtn').classList.toggle('on', f.rnd);
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

  function toggleRnd(id) {
    var f = S.fx[S.target][id];
    f.rnd = !f.rnd;
    send({ type: 'fxrnd', target: S.target, id: id, on: f.rnd });
    paintPad(id);
  }

  (function padInput() {
    var host = $('pads');
    var active = {};

    function xyIn(el, e) {
      var r = el.getBoundingClientRect();
      return {
        x: clamp((e.clientX - r.left) / r.width, 0, 1),
        y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1),
        w: r.width, h: r.height
      };
    }

    host.addEventListener('pointerdown', function (e) {
      if (e.target.dataset && e.target.dataset.r) {     // the R switch, not the pad
        e.preventDefault();
        e.stopPropagation();
        toggleRnd(e.target.dataset.r);
        return;
      }
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
    setTimeout(function () { el.textContent = old; }, 1100);
  }

  function paintTimeMul() {
    var bs = document.querySelectorAll('#mulSwitch button');
    for (var i = 0; i < bs.length; i++) {
      bs[i].classList.toggle('on', +bs[i].dataset.mul === S.pos.mul);
    }
  }

  /* re-roll the tracker events themselves */
  function dice() {
    var ln = S.lanes[S.sel];
    var ev = ln.ev;
    for (var s = 0; s < ln.len; s++) {
      var r = Math.random();
      if (ln.sliced) {
        ev.slice[s] = r < 0.42 ? (s % ln.slices) : Math.floor(Math.random() * ln.slices);
        if (Math.random() < 0.1) ev.slice[s] = -1;
      } else {
        ev.slice[s] = Math.random() < 0.38 ? 0 : -1;
      }
      ev.vel[s] = ev.slice[s] < 0 ? 0 : (Math.random() < 0.7 ? 3 : 2);
      ev.pitch[s] = Math.random() < 0.25 ? [-12, -7, -5, 3, 5, 7, 12][Math.floor(Math.random() * 7)] : 0;
      ev.rev[s] = Math.random() < 0.1 ? 1 : 0;
      ev.rtg[s] = Math.random() < 0.18 ? [2, 3, 4, 6, 8, 12, 16][Math.floor(Math.random() * 7)] : 1;
      ev.racc[s] = ev.rtg[s] > 1 ? Math.floor(Math.random() * 9) - 4 : 0;
      ev.fx[s] = Math.random() < 0.2 ? 1 + Math.floor(Math.random() * 6) : 0;
      ev.fxa[s] = Math.floor(Math.random() * 16);
    }
    paintGrid();
    paintTracker();
    sendEvents(S.sel);
  }

  function toggleRec() {
    if (!recDest || typeof MediaRecorder === 'undefined') { flash($('rec'), '非対応'); return; }
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    var mt = '';
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) { mt = types[i]; break; }
    }
    try {
      recorder = mt ? new MediaRecorder(recDest.stream, { mimeType: mt, audioBitsPerSecond: 256000 })
                    : new MediaRecorder(recDest.stream);
    } catch (e) { flash($('rec'), '非対応'); return; }
    recChunks = [];
    recorder.ondataavailable = function (e) { if (e.data.size) recChunks.push(e.data); };
    recorder.onstop = function () {
      var blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
      var mime = recorder.mimeType || '';
      var ext = mime.indexOf('mp4') >= 0 ? 'm4a' : mime.indexOf('ogg') >= 0 ? 'ogg' : 'webm';
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
    sctx.fillStyle = S.pos.drop ? 'rgba(26,10,10,0.95)' : 'rgba(10,10,9,0.9)';
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
      sctx.strokeStyle = S.pos.drop ? '#e25032' : '#e9d64a';
      sctx.lineWidth = Math.max(1, h / 44);
      sctx.stroke();
    }

    for (var c = 0; c < 5; c++) {
      var lv = Math.min(1, S.peaks[c] || 0);
      var bw = w / 5;
      sctx.fillStyle = lv > 0.98 ? 'rgba(226,80,50,0.65)' : 'rgba(233,214,74,0.22)';
      sctx.fillRect(c * bw + 2, h - 3 - lv * (h * 0.3), bw - 4, lv * (h * 0.3) + 2);
    }

    for (var g = 0; g < gridRows.length; g++) {
      var nodes = gridRows[g].nodes;
      var st = S.pos.steps[g];
      var eff = S.pos.eff[g];
      for (var s2 = 0; s2 < nodes.length; s2++) {
        var cl = nodes[s2].classList;
        if (s2 === st) cl.add('now'); else if (cl.contains('now')) cl.remove('now');
        var outside = s2 >= eff;
        if (outside !== cl.contains('past')) cl.toggle('past', outside);
      }
    }
    if (S.view === 'tracker') {
      var sel = S.pos.steps[S.sel];
      for (var t = 0; t < trkCells.length; t++) {
        trkCells[t].row.classList.toggle('now', t === sel);
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
    kitSel.addEventListener('change', function () {
      S.kit = kitSel.value;
      for (var i = 0; i < NLANE; i++) {
        var ln = S.lanes[i];
        if (ln.user) continue;
        setLaneSource(i, ln.src.kind, ln.src.id, true);
      }
      buildTargets();
    });

    var patSel = $('patSel');
    FunsaiKits.PATTERNS.forEach(function (p) {
      var op = document.createElement('option');
      op.value = p.id;
      op.textContent = p.name;
      patSel.appendChild(op);
    });
    patSel.value = S.pat;
    patSel.addEventListener('change', function () {
      S.pat = patSel.value;
      var p = FunsaiKits.getPattern(S.pat);
      S.bpm = p.bpm;
      $('bpm').value = p.bpm;
      $('bpmv').textContent = p.bpm;
      send({ type: 'bpm', bpm: S.bpm });
      applyPattern(S.pat);
      buildGrid();
      buildTracker();
    });

    $('laneSrc').addEventListener('change', function () {
      var v = this.value;
      if (v === 'user') return;
      var parts = v.split(':');
      setLaneSource(S.sel, parts[0], parts[1]);
      buildGrid();
      buildTracker();
      buildTargets();
      buildSourceRow();
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
      clearTimeout(srcTimer);
      srcTimer = setTimeout(rerenderSources, 350);
    });
    $('swing').addEventListener('input', function () {
      S.swing = +this.value / 100;
      $('swingv').textContent = this.value;
      send({ type: 'swing', swing: S.swing });
    });
    $('vol').addEventListener('input', function () {
      if (masterGain) masterGain.gain.value = +this.value / 100;
    });

    var muls = document.querySelectorAll('#mulSwitch button');
    for (var mi = 0; mi < muls.length; mi++) {
      (function (b) {
        b.addEventListener('click', function () {
          S.timeMul = +b.dataset.mul;
          S.pos.mul = S.timeMul;
          send({ type: 'timemul', v: S.timeMul });
          paintTimeMul();
        });
      })(muls[mi]);
    }

    var ps = document.querySelectorAll('#presetSwitch button');
    for (var i2 = 0; i2 < ps.length; i2++) {
      (function (b) {
        b.addEventListener('click', function () {
          var bs = document.querySelectorAll('#presetSwitch button');
          for (var q = 0; q < bs.length; q++) bs[q].classList.toggle('on', bs[q] === b);
          applyPreset(b.dataset.preset);
        });
      })(ps[i2]);
    }

    var vs = document.querySelectorAll('#viewSwitch button');
    for (var i3 = 0; i3 < vs.length; i3++) {
      (function (b) { b.addEventListener('click', function () { setView(b.dataset.view); }); })(vs[i3]);
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

    /* rewrite panel */
    var fh = $('rwFlags');
    RWFLAGS.forEach(function (f) {
      var b = document.createElement('button');
      b.className = 'flag' + (S.rw.flags[f.k] ? ' on' : '');
      b.textContent = f.n;
      b.dataset.k = f.k;
      b.addEventListener('click', function () {
        S.rw.flags[f.k] = !S.rw.flags[f.k];
        b.classList.toggle('on', S.rw.flags[f.k]);
        sendRewrite();
      });
      fh.appendChild(b);
    });
    $('rw').addEventListener('click', function () {
      S.rw.on = !S.rw.on;
      this.classList.toggle('on', S.rw.on);
      $('rwPanel').classList.toggle('live', S.rw.on);
      sendRewrite();
    });
    $('rwAmt').addEventListener('input', function () {
      S.rw.amt = +this.value / 100;
      $('rwAmtV').textContent = this.value;
      sendRewrite();
    });

    $('file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f || !ctx) return;
      flash($('loadLabel'), '解析中');
      f.arrayBuffer().then(function (ab) { return ctx.decodeAudioData(ab); })
        .then(function (b) { loadUserBuffer(b, f.name.replace(/\.[^.]+$/, '')); })
        .catch(function () { flash($('loadLabel'), '失敗'); });
      this.value = '';
    });

    buildPads();
    buildTargets();
    buildGrid();
    buildTracker();
    buildSourceRow();
    setView('grid');
    paintTimeMul();

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
