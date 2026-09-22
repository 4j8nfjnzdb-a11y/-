/* 粉砕 FUNSAI — drum synthesis, pattern library, break renderer.
 * Everything is generated from code, so the app ships with no audio assets
 * and the breaks can be re-rendered at whatever BPM the transport is at.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  /* Math.imul keeps the multiply exact in 32 bits; a plain float multiply
     overflows the mantissa and shortens the period to ~16k samples, which
     makes snare and hat noise tonal instead of white. */
  function noise(state) {
    state.s = (Math.imul(state.s, 1664525) + 1013904223) | 0;
    return (state.s >>> 0) / 2147483648 - 1;
  }

  /* one pole helpers ------------------------------------------------- */
  function lp(buf, coef) {
    var z = 0;
    for (var i = 0; i < buf.length; i++) { z += (buf[i] - z) * coef; buf[i] = z; }
  }
  function hp(buf, coef) {
    var z = 0;
    for (var i = 0; i < buf.length; i++) { z += (buf[i] - z) * coef; buf[i] = buf[i] - z; }
  }

  function env(i, n, curve) { return Math.pow(1 - i / n, curve); }

  /* --- voices -------------------------------------------------------- */

  function kick(sr, o) {
    var n = Math.floor(sr * o.dur);
    var b = new Float32Array(n);
    var ph = 0;
    var st = { s: 991 };
    for (var i = 0; i < n; i++) {
      var t = i / n;
      var f = o.f1 + (o.f0 - o.f1) * Math.pow(1 - t, o.pbend);
      ph += f / sr;
      var e = env(i, n, o.curve);
      var s = Math.sin(ph * TAU) * e;
      if (o.click && i < sr * 0.004) s += noise(st) * o.click * (1 - i / (sr * 0.004));
      if (o.drive > 1) s = Math.tanh(s * o.drive) / Math.tanh(o.drive) * 1.0;
      b[i] = s * o.amp;
    }
    return b;
  }

  function snare(sr, o) {
    var n = Math.floor(sr * o.dur);
    var b = new Float32Array(n);
    var nz = new Float32Array(n);
    var st = { s: 4441 };
    var p1 = 0, p2 = 0;
    for (var i = 0; i < n; i++) {
      var e = env(i, n, o.curve);
      var eb = env(i, Math.floor(n * o.bodyDur), 2.2);
      if (i > n * o.bodyDur) eb = 0;
      p1 += o.t1 / sr;
      p2 += o.t2 / sr;
      b[i] = (Math.sin(p1 * TAU) + Math.sin(p2 * TAU) * 0.7) * eb * o.body;
      nz[i] = noise(st) * e;
    }
    hp(nz, o.nzHp);
    lp(nz, o.nzLp);
    for (var j = 0; j < n; j++) {
      var s = b[j] + nz[j] * o.snap;
      if (o.drive > 1) s = Math.tanh(s * o.drive) / Math.tanh(o.drive);
      b[j] = s * o.amp;
    }
    return b;
  }

  /* metallic source: inharmonic square stack (808 style) */
  function metal(sr, n, base, ratios, st) {
    var b = new Float32Array(n);
    var ph = new Float32Array(ratios.length);
    for (var i = 0; i < n; i++) {
      var acc = 0;
      for (var k = 0; k < ratios.length; k++) {
        ph[k] += base * ratios[k] / sr;
        if (ph[k] >= 1) ph[k] -= 1;
        acc += ph[k] < 0.5 ? 1 : -1;
      }
      b[i] = acc / ratios.length;
    }
    return b;
  }

  function hat(sr, o) {
    var n = Math.floor(sr * o.dur);
    var st = { s: 7717 };
    var m = metal(sr, n, o.base, o.ratios, st);
    var b = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      b[i] = m[i] * (1 - o.noise) + noise(st) * o.noise;
    }
    hp(b, o.hpc);
    for (var j = 0; j < n; j++) b[j] *= env(j, n, o.curve) * o.amp;
    return b;
  }

  function cymbal(sr, o) {
    var n = Math.floor(sr * o.dur);
    var st = { s: 3331 };
    var m = metal(sr, n, o.base, o.ratios, st);
    var b = new Float32Array(n);
    for (var i = 0; i < n; i++) b[i] = m[i] * 0.55 + noise(st) * 0.45;
    hp(b, o.hpc);
    lp(b, o.lpc);
    for (var j = 0; j < n; j++) {
      var e = env(j, n, o.curve);
      if (j < 300) e *= j / 300 + 0.2;
      b[j] *= e * o.amp;
    }
    return b;
  }

  /* --- kits ---------------------------------------------------------- */

  var KITS = [
    {
      id: 'hagane', name: '鋼', sub: 'HAGANE / 909系',
      bd: { dur: 0.34, f0: 210, f1: 48, pbend: 3.2, curve: 2.6, amp: 1.0, click: 0.5, drive: 2.2 },
      sd: { dur: 0.22, t1: 190, t2: 330, body: 0.55, bodyDur: 0.35, snap: 0.85, curve: 2.4,
            nzHp: 0.32, nzLp: 0.74, amp: 0.9, drive: 1.6 },
      hh: { dur: 0.048, base: 420, ratios: [1, 1.41, 1.87, 2.51, 3.17, 4.07], noise: 0.35,
            hpc: 0.55, curve: 3.4, amp: 0.55 },
      cy: { dur: 1.1, base: 300, ratios: [1, 1.34, 1.73, 2.29, 3.11, 4.21], hpc: 0.3, lpc: 0.85,
            curve: 2.2, amp: 0.42 }
    },
    {
      id: 'tsuchi', name: '土', sub: 'TSUCHI / 808系',
      bd: { dur: 0.85, f0: 120, f1: 36, pbend: 5.5, curve: 1.5, amp: 1.0, click: 0.22, drive: 1.1 },
      sd: { dur: 0.19, t1: 172, t2: 268, body: 0.75, bodyDur: 0.5, snap: 0.55, curve: 2.8,
            nzHp: 0.24, nzLp: 0.6, amp: 0.85, drive: 1.0 },
      hh: { dur: 0.035, base: 380, ratios: [1, 1.47, 1.93, 2.63, 3.31, 4.11], noise: 0.12,
            hpc: 0.62, curve: 3.8, amp: 0.5 },
      cy: { dur: 1.5, base: 240, ratios: [1, 1.41, 1.88, 2.44, 3.29, 4.58], hpc: 0.22, lpc: 0.78,
            curve: 1.6, amp: 0.4 }
    },
    {
      id: 'niku', name: '肉', sub: 'NIKU / 生ドラム寄り',
      bd: { dur: 0.3, f0: 165, f1: 55, pbend: 2.2, curve: 2.1, amp: 0.95, click: 0.7, drive: 1.5 },
      sd: { dur: 0.26, t1: 205, t2: 385, body: 0.42, bodyDur: 0.28, snap: 1.0, curve: 1.9,
            nzHp: 0.38, nzLp: 0.82, amp: 0.95, drive: 1.4 },
      hh: { dur: 0.062, base: 520, ratios: [1, 1.51, 2.13, 2.79, 3.61, 4.83], noise: 0.68,
            hpc: 0.6, curve: 2.6, amp: 0.5 },
      cy: { dur: 1.3, base: 340, ratios: [1, 1.29, 1.81, 2.37, 3.03, 4.37], hpc: 0.34, lpc: 0.9,
            curve: 1.9, amp: 0.45 }
    },
    {
      id: 'tetsu', name: '鉄', sub: 'TETSU / ガバ・工業',
      bd: { dur: 0.42, f0: 260, f1: 42, pbend: 4.0, curve: 1.4, amp: 1.0, click: 0.4, drive: 22 },
      sd: { dur: 0.16, t1: 240, t2: 460, body: 0.4, bodyDur: 0.3, snap: 1.0, curve: 2.0,
            nzHp: 0.45, nzLp: 0.9, amp: 0.95, drive: 8 },
      hh: { dur: 0.04, base: 640, ratios: [1, 1.33, 2.07, 2.91, 3.77, 5.13], noise: 0.5,
            hpc: 0.68, curve: 3.0, amp: 0.55 },
      cy: { dur: 0.9, base: 420, ratios: [1, 1.44, 2.11, 2.93, 3.87, 5.31], hpc: 0.42, lpc: 0.95,
            curve: 1.5, amp: 0.5 }
    },
    {
      id: 'den', name: '電', sub: 'DEN / デジタル・グリッチ',
      bd: { dur: 0.18, f0: 420, f1: 60, pbend: 8, curve: 3.6, amp: 0.95, click: 0.9, drive: 5 },
      sd: { dur: 0.1, t1: 520, t2: 880, body: 0.7, bodyDur: 0.6, snap: 0.9, curve: 3.2,
            nzHp: 0.6, nzLp: 0.98, amp: 0.85, drive: 3 },
      hh: { dur: 0.022, base: 900, ratios: [1, 1.61, 2.24, 3.37, 4.19, 6.11], noise: 0.25,
            hpc: 0.74, curve: 4.5, amp: 0.5 },
      cy: { dur: 0.5, base: 700, ratios: [1, 1.77, 2.53, 3.91, 5.13, 7.29], hpc: 0.5, lpc: 0.99,
            curve: 3.0, amp: 0.45 }
    }
  ];

  /* crush a buffer for the digital kit */
  function crush(buf, bits, hold) {
    var q = Math.pow(2, bits - 1);
    var held = 0;
    for (var i = 0; i < buf.length; i++) {
      if (i % hold === 0) held = Math.round(buf[i] * q) / q;
      buf[i] = held;
    }
  }

  /* the four voices come out at wildly different levels, so pin each one
     to a target peak and keep the balance the same across kits */
  var PEAKS = { bd: 1.0, sd: 0.9, hh: 0.6, cy: 0.58 };
  function normalize(buf, target) {
    var peak = 0;
    for (var i = 0; i < buf.length; i++) {
      var a = buf[i] < 0 ? -buf[i] : buf[i];
      if (a > peak) peak = a;
    }
    if (peak < 1e-6) return;
    var g = target / peak;
    for (var j = 0; j < buf.length; j++) buf[j] *= g;
  }

  function buildKit(sr, id) {
    var k = null;
    for (var i = 0; i < KITS.length; i++) if (KITS[i].id === id) k = KITS[i];
    if (!k) k = KITS[0];
    var out = {
      bd: kick(sr, k.bd),
      hh: hat(sr, k.hh),
      sd: snare(sr, k.sd),
      cy: cymbal(sr, k.cy)
    };
    normalize(out.bd, PEAKS.bd);
    normalize(out.sd, PEAKS.sd);
    normalize(out.hh, PEAKS.hh);
    normalize(out.cy, PEAKS.cy);
    if (id === 'den') {
      crush(out.bd, 5, 3);
      crush(out.sd, 4, 4);
      crush(out.hh, 3, 2);
      crush(out.cy, 5, 3);
    }
    return out;
  }

  /* --- patterns ------------------------------------------------------ *
   * Lanes are written at 16th resolution (16 chars per bar) or 32nd
   * resolution (32 chars per bar). '-' is a rest, 1-3 is velocity.
   */

  function expand(str) {
    if (str.length % 32 === 0) return str;
    var out = '';
    for (var i = 0; i < str.length; i++) out += str[i] + '-';
    return out;
  }

  /* Lane notation: one character per 32nd note, 32 chars per bar.
   * '-' rest, '2' ghost / soft, '3' accent (velocity feeds both the KIT
   * grid colours and the rendered break's gain).
   */
  var PATTERNS = [
    { id: 'amen', name: 'AMEN', bars: 2, bpm: 174,
      bd: '3-------------------3-----------' +
          '----3---------------3-----------',
      sd: '--------3-----2---------3-------' +
          '--------3-----2-------3-----3---',
      hh: '3---2---2---2---3---2---2---2---' +
          '3---2---2---2---3---2---2---2---',
      cy: '3-------------------------------' +
          '2-------------------------------' },

    { id: 'think', name: 'THINK', bars: 1, bpm: 170,
      bd: '3-----------3---------------3---',
      sd: '--------3-----------2---3-------',
      hh: '3---2---2---2---3-2-2---2---2---',
      cy: '3-------------------------------' },

    { id: 'apache', name: 'APACHE', bars: 1, bpm: 166,
      bd: '3-------------------3-----------',
      sd: '--------3---------------3-------',
      hh: '3-2-2-2-3-2-2-2-3-2-2-2-3-2-2-2-',
      cy: '--------------------------------' },

    { id: 'funky', name: 'FUNKY', bars: 1, bpm: 160,
      bd: '3-----------3-------3-----------',
      sd: '--------3-----2-------2-3---2-2-',
      hh: '3-2-2-2-3-2-2-2-3-2-2-2-3-2-2-2-',
      cy: '--------------------------------' },

    { id: 'gabber', name: 'GABBER', bars: 1, bpm: 190,
      bd: '3-------3-------3-------3-------',
      sd: '----------------3---------------',
      hh: '----2-------2-------2-------2---',
      cy: '3-------------------------------' },

    { id: 'footwork', name: 'FOOTWORK', bars: 1, bpm: 160,
      bd: '3-----3-----3-------3-----3-----',
      sd: '--------3---------------3-------',
      hh: '----2---2-------2---2---2-------',
      cy: '--------------------------------' },

    { id: 'blast', name: 'BLAST', bars: 1, bpm: 200, kitRes: [2, 2, 2, 1],
      bd: '3-3-3-3-3-3-3-3-3-3-3-3-3-3-3-3-',
      sd: '-3-3-3-3-3-3-3-3-3-3-3-3-3-3-3-3',
      hh: '32223222322232223222322232223222',
      cy: '3-------3-------3-------3-------' },

    { id: 'drill', name: 'DRILL', bars: 2, bpm: 178,
      bd: '3---------------3---3-----------' +
          '3-----------3-------3-----------',
      sd: '--------3---------------3-----2-' +
          '--------3---------------3-----2-',
      hh: '3-2-2-2-2-2-2-2-3-2-2-2-2-2-2-2-' +
          '3-2-2-2-2-2-2-2-3-2-2-2-2-2-2-2-',
      cy: '--------------------------------' +
          '--------------------------------' },

    { id: 'halftime', name: 'HALFTIME', bars: 1, bpm: 172,
      bd: '3-------------------------3-----',
      sd: '----------------3---------------',
      hh: '3---2-------2-------2-------2---',
      cy: '3-------------------------------' },

    { id: 'jungle', name: 'JUNGLE', bars: 2, bpm: 174,
      bd: '3-----------3-------------------' +
          '3-----------3-----------3-------',
      sd: '--------3-----------2-----3-----' +
          '--------3-----------2-----3-----',
      hh: '3---2---2---2---2---2---2---2---' +
          '3---2---2---2---2---2---2---2---',
      cy: '3-------------------------------' +
          '2-------------------------------' }
  ];

  function laneSteps(str, bars) {
    var s = expand(str);
    var want = bars * 32;
    var out = new Uint8Array(want);
    for (var i = 0; i < want; i++) {
      var c = s[i % s.length];
      out[i] = (c >= '1' && c <= '3') ? (c.charCodeAt(0) - 48) : 0;
    }
    return out;
  }

  function getPattern(id) {
    for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].id === id) return PATTERNS[i];
    return PATTERNS[0];
  }

  /* Convert a pattern to the 4 x 32 step grid used by KIT mode.
   * Lanes run at 16th resolution by default, folding any 32nd detail into
   * the nearest 16th. A pattern can set kitRes[i] = 2 to keep a lane at
   * 32nd resolution instead; the track then plays at res x2.
   */
  function patternGrid(id) {
    var p = getPattern(id);
    var lanes = ['bd', 'hh', 'sd', 'cy'];
    var grid = [];
    for (var i = 0; i < 4; i++) {
      var full = laneSteps(p[lanes[i]], p.bars);
      var res = (p.kitRes && p.kitRes[i]) || 1;
      var row = new Uint8Array(32);
      var len;
      if (res === 2) {
        len = Math.min(32, p.bars * 32);
        for (var q = 0; q < len; q++) row[q] = full[q];
      } else {
        len = Math.min(32, p.bars * 16);
        for (var s = 0; s < len; s++) row[s] = Math.max(full[s * 2], full[s * 2 + 1]);
      }
      grid.push({ pat: row, len: len, res: res });
    }
    return { grid: grid, bpm: p.bpm, bars: p.bars };
  }

  /* Render a pattern into one continuous break buffer at the given bpm. */
  function renderBreak(sr, kitId, patId, bpm) {
    var p = getPattern(patId);
    var kit = buildKit(sr, kitId);
    var spb = sr * 60 / bpm;
    var stepDur = spb * 0.125;                   // 32nd note
    var total = Math.ceil(p.bars * 32 * stepDur);
    var out = new Float32Array(total + sr);      // headroom for tails
    var lanes = [['bd', kit.bd], ['sd', kit.sd], ['hh', kit.hh], ['cy', kit.cy]];

    for (var li = 0; li < lanes.length; li++) {
      var steps = laneSteps(p[lanes[li][0]], p.bars);
      var smp = lanes[li][1];
      for (var s = 0; s < steps.length; s++) {
        if (!steps[s]) continue;
        var at = Math.floor(s * stepDur);
        var g = 0.55 + steps[s] * 0.15;
        for (var i = 0; i < smp.length && at + i < out.length; i++) {
          out[at + i] += smp[i] * g;
        }
      }
    }
    /* fold the tail back to the head so the loop is seamless */
    var body = new Float32Array(total);
    for (var j = 0; j < total; j++) body[j] = out[j];
    for (var k = total; k < out.length; k++) body[(k - total) % total] += out[k] * 0.6;

    var peak = 0;
    for (var m = 0; m < total; m++) { var a = Math.abs(body[m]); if (a > peak) peak = a; }
    if (peak > 0) { var g2 = 0.92 / peak; for (var q = 0; q < total; q++) body[q] *= g2; }
    return body;
  }

  global.FunsaiKits = {
    KITS: KITS,
    PATTERNS: PATTERNS,
    buildKit: buildKit,
    patternGrid: patternGrid,
    renderBreak: renderBreak,
    getPattern: getPattern
  };
})(typeof window !== 'undefined' ? window : globalThis);
