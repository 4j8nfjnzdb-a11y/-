// Kasane — things that are drawn with the 2-D canvas before they become textures:
// text, vector shapes (with trimmed strokes), masks, and the ragged edge of torn paper.
// Each function returns a canvas plus the rectangle it covers in layer coordinates.
'use strict';
(() => {
  const U = KS.U;
  const R = KS.Raster = {};

  // ---- fonts: three that every device has, and a shelf of Google Fonts fetched on first use
  const F = KS.Fonts = { gen: 0, loaded: new Set(), pending: new Set(), onLoad: null };
  F.list = [
    { id: 'sans', name: 'ゴシック（端末の書体）', css: '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP","Noto Sans CJK JP","IPAPGothic",system-ui,sans-serif' },
    { id: 'serif', name: '明朝（端末の書体）', css: '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif' },
    { id: 'mono', name: '等幅（端末の書体）', css: 'ui-monospace,Menlo,Consolas,monospace' },
    ...[
      ['Noto Sans JP', '400;700;900', 'Noto Sans JP'], ['Noto Serif JP', '400;700;900', 'Noto Serif JP'],
      ['Zen Kaku Gothic New', '400;700;900', 'Zen 角ゴシック'], ['Zen Maru Gothic', '400;700;900', 'Zen 丸ゴシック'], ['Zen Old Mincho', '400;700;900', 'Zen オールド明朝'],
      ['Shippori Mincho B1', '400;700;800', 'しっぽり明朝'], ['Dela Gothic One', '400', 'デラゴシック'], ['RocknRoll One', '400', 'ロックンロール'],
      ['Reggae One', '400', 'レゲエ'], ['Rampart One', '400', 'ランパート'], ['Potta One', '400', 'ポッタ'], ['DotGothic16', '400', 'ドットゴシック'],
      ['Yuji Syuku', '400', '佑字 肅'], ['Kaisei Decol', '400;700', '解星デコール'], ['Klee One', '400;600', 'クレー'], ['Zen Kurenaido', '400', 'Zen 紅道'],
      ['Inter', '400;700;900', 'Inter'], ['Space Grotesk', '400;700', 'Space Grotesk'], ['Bebas Neue', '400', 'Bebas Neue'], ['Anton', '400', 'Anton'],
      ['Archivo Black', '400', 'Archivo Black'], ['Playfair Display', '400;700;900', 'Playfair Display'], ['Abril Fatface', '400', 'Abril Fatface'],
      ['Permanent Marker', '400', 'Permanent Marker'], ['Space Mono', '400;700', 'Space Mono'],
    ].map(([fam, w, name]) => ({ id: 'g:' + fam, name, fam, w, css: `"${fam}","Hiragino Sans","Yu Gothic","Noto Sans CJK JP","IPAPGothic",sans-serif` })),
  ];
  F.get = (id) => F.list.find((f) => f.id === id) || F.list[0];
  F.css = (id) => F.get(id).css;
  // ask for a face; the text is redrawn when it arrives (and simply stays in the fallback face if it never does)
  F.ensure = (id, weight = 400) => {
    const f = F.get(id);
    if (!f.fam || typeof document === 'undefined') return true;
    const key = f.fam + '|' + weight;
    if (F.loaded.has(key)) return true;
    if (F.pending.has(key)) return false;
    F.pending.add(key);
    if (!document.querySelector(`link[data-kf="${f.fam}"]`)) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.kf = f.fam;
      l.href = `https://fonts.googleapis.com/css2?family=${f.fam.replace(/ /g, '+')}:wght@${f.w}&display=swap`;
      document.head.append(l);
    }
    const done = () => { F.pending.delete(key); F.loaded.add(key); F.gen++; if (F.onLoad) F.onLoad(); };
    const tryLoad = (n) => {
      document.fonts.load(`${weight} 48px "${f.fam}"`, 'あAa1').then((faces) => {
        if (faces.length) done(); else if (n < 12) setTimeout(() => tryLoad(n + 1), 400 + n * 200); else F.pending.delete(key);
      }).catch(() => F.pending.delete(key));
    };
    tryLoad(0);
    return false;
  };

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
  const chars = (s) => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));
  let meas = null;

  // ---- text
  R.text = (d, v, rs, maxPx = 4096) => {
    if (!meas) meas = mk(4, 4).getContext('2d');
    F.ensure(d.font, d.weight);
    const size = Math.max(1, v.size), fam = F.css(d.font);
    const fontAt = (px) => `${d.italic ? 'italic ' : ''}${d.weight || 400} ${px}px ${fam}`;
    // measure at a fixed, comfortable size so the layout doesn't shimmer as the raster scale changes
    const MS = 100, k = size / MS;
    meas.font = fontAt(MS);
    const mm = meas.measureText('Hg国');
    const asc = (mm.fontBoundingBoxAscent || MS * 0.88) * k, desc = (mm.fontBoundingBoxDescent || MS * 0.12) * k;
    const lineH = size * v.lead / 100, track = v.track / 1000 * size;
    const lines = String(d.str).split('\n').map((line) => {
      const cs = chars(line), xs = []; let acc = '';
      for (let i = 0; i < cs.length; i++) { xs.push(meas.measureText(acc).width * k + i * track); acc += cs[i]; }
      const w = cs.length ? meas.measureText(acc).width * k + (cs.length - 1) * track : 0;
      return { cs, xs, w };
    });
    const W = Math.max(1, ...lines.map((l) => l.w)), H = (lines.length - 1) * lineH + asc + desc;
    const m = v.strokeW / 2 + size * 0.18 + 2;
    const x0 = d.align === 'left' ? 0 : d.align === 'right' ? -W : -W / 2;
    const rect = { x: x0 - m, y: -H / 2 - m, w: W + 2 * m, h: H + 2 * m };
    rs = Math.min(rs, maxPx / rect.w, maxPx / rect.h);
    const cv = mk(rect.w * rs, rect.h * rs), c = cv.getContext('2d');
    c.setTransform(rs, 0, 0, rs, m * rs, m * rs);
    c.font = fontAt(size); c.textBaseline = 'alphabetic'; c.lineJoin = 'round'; c.lineCap = 'round';
    const total = lines.reduce((s, l) => s + l.cs.length, 0), shown = U.clamp(v.reveal, 0, 100) / 100 * total;
    const each = (fn) => {
      let n = 0;
      lines.forEach((l, li) => {
        const lx = d.align === 'left' ? 0 : d.align === 'right' ? W - l.w : (W - l.w) / 2, by = asc + li * lineH;
        for (let i = 0; i < l.cs.length; i++, n++) {
          const a = U.clamp(shown - n, 0, 1);
          if (a > 0) fn(l.cs[i], lx + l.xs[i], by, a);
        }
      });
    };
    if (v.strokeW > 0 && v.stroke[3] > 0) { c.lineWidth = v.strokeW; each((ch, x, y, a) => { c.strokeStyle = U.rgbaCss(v.stroke, a); c.strokeText(ch, x, y); }); }
    each((ch, x, y, a) => { c.fillStyle = U.rgbaCss(v.fill, a); c.fillText(ch, x, y); });
    return { canvas: cv, rect, rs };
  };

  // ---- shapes: everything is flattened to polylines first, which makes trimming a stroke simple
  const flattenPath = (pts, closed) => {
    const out = [], n = pts.length, segs = closed ? n : n - 1;
    if (!n) return out;
    out.push([pts[0].x, pts[0].y]);
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const c1x = a.x + (a.ox || 0), c1y = a.y + (a.oy || 0), c2x = b.x + (b.ix || 0), c2y = b.y + (b.iy || 0);
      const straight = !(a.ox || a.oy || b.ix || b.iy), steps = straight ? 1 : 24;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, m = 1 - t;
        out.push([m * m * m * a.x + 3 * m * m * t * c1x + 3 * m * t * t * c2x + t * t * t * b.x, m * m * m * a.y + 3 * m * m * t * c1y + 3 * m * t * t * c2y + t * t * t * b.y]);
      }
    }
    if (closed) out.pop();
    return out;
  };
  R.flattenPath = flattenPath;
  R.shapeGeom = (d, v) => {
    const kind = d.kind, w = Math.max(0, v.size ? v.size[0] : 0), h = Math.max(0, v.size ? v.size[1] : 0), pts = [];
    let closed = true;
    if (kind === 'rect') {
      const r = Math.min(Math.max(0, v.round), w / 2, h / 2), hw = w / 2, hh = h / 2;
      if (r < 0.01) pts.push([0, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]);
      else {
        const arc = (cx, cy, a0) => { for (let i = 0; i <= 10; i++) { const a = a0 + i / 10 * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
        pts.push([0, -hh]); arc(hw - r, -hh + r, -Math.PI / 2); arc(hw - r, hh - r, 0); arc(-hw + r, hh - r, Math.PI / 2); arc(-hw + r, -hh + r, Math.PI);
      }
    } else if (kind === 'ellipse') {
      for (let i = 0; i < 96; i++) { const a = -Math.PI / 2 + i / 96 * Math.PI * 2; pts.push([Math.cos(a) * w / 2, Math.sin(a) * h / 2]); }
    } else if (kind === 'poly' || kind === 'star') {
      const n = U.clamp(Math.round(v.points), 3, 64), star = kind === 'star', cnt = star ? n * 2 : n, inner = U.clamp(v.inner, 1, 100) / 100;
      for (let i = 0; i < cnt; i++) { const a = -Math.PI / 2 + i / cnt * Math.PI * 2, k = star && i % 2 ? inner : 1; pts.push([Math.cos(a) * w / 2 * k, Math.sin(a) * h / 2 * k]); }
    } else if (kind === 'path') {
      closed = !!d.closed; pts.push(...flattenPath(d.pts || [], closed));
    }
    return { pts, closed };
  };
  // part of a polyline between two fractions of its length; on a closed path the range may wrap past the start
  R.trim = (pts, closed, s, e, off) => {
    const n = pts.length; if (n < 2) return [];
    if (s > e) { const t = s; s = e; e = t; }
    if (e - s >= 0.9999) return [closed ? pts.concat([pts[0]]) : pts];
    if (e - s <= 1e-5) return [];
    const P = closed ? pts.concat([pts[0]]) : pts, len = [0];
    for (let i = 1; i < P.length; i++) len.push(len[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = len[len.length - 1]; if (L <= 0) return [];
    const at = (d) => { let i = 1; while (i < len.length - 1 && len[i] < d) i++; const t = (d - len[i - 1]) / Math.max(1e-9, len[i] - len[i - 1]); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t]; };
    const piece = (a, b) => { const o = [at(a)]; for (let i = 1; i < len.length - 1; i++) if (len[i] > a && len[i] < b) o.push(P[i]); o.push(at(b)); return o; };
    off = ((off % 1) + 1) % 1;
    const a = (s + off) * L, b = (e + off) * L;
    if (b <= L) return [piece(a, b)];
    if (a >= L) return [piece(a - L, b - L)];
    return [piece(a, L), piece(0, b - L)];
  };
  R.shape = (d, v, rs, maxPx = 4096) => {
    const g = R.shapeGeom(d, v), pts = g.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    if (!pts.length) { x0 = y0 = -1; x1 = y1 = 1; }
    const m = Math.max(0, v.strokeW) / 2 + 3;
    const rect = { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
    rs = Math.min(rs, maxPx / rect.w, maxPx / rect.h);
    const cv = mk(rect.w * rs, rect.h * rs), c = cv.getContext('2d');
    c.setTransform(rs, 0, 0, rs, -rect.x * rs, -rect.y * rs);
    const trace = (pl, close) => { c.beginPath(); pl.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); if (close) c.closePath(); };
    if (d.fillOn !== false && v.fill[3] > 0 && pts.length > 2) { trace(pts, true); c.fillStyle = U.rgbaCss(v.fill); c.fill(); }
    if (v.strokeW > 0 && v.stroke[3] > 0 && pts.length > 1) {
      c.lineWidth = v.strokeW; c.strokeStyle = U.rgbaCss(v.stroke); c.lineJoin = d.join || 'round'; c.lineCap = d.cap || 'round';
      const full = Math.abs(v.trimE - v.trimS) >= 99.99;
      if (full) { trace(pts, g.closed); c.stroke(); }
      else for (const pl of R.trim(pts, g.closed, v.trimS / 100, v.trimE / 100, v.trimO / 360)) { trace(pl, false); c.stroke(); }
    }
    return { canvas: cv, rect, rs };
  };

  // ---- masks. geo maps layer coordinates into the layer buffer: px = (x - geo.x) * geo.rs
  // The result is white on black in the red channel (blue/green follow), ready to be multiplied in.
  R.maskPath = (c, mask) => {
    const p = mask.pts; if (!p.length) return;
    c.beginPath(); c.moveTo(p[0].x, p[0].y);
    const n = p.length, segs = mask.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) { const a = p[i], b = p[(i + 1) % n]; c.bezierCurveTo(a.x + (a.ox || 0), a.y + (a.oy || 0), b.x + (b.ix || 0), b.y + (b.iy || 0), b.x, b.y); }
    if (mask.closed) c.closePath();
  };
  R.mask = (mask, expand, geo) => {
    const cv = mk(geo.bw, geo.bh), c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(geo.rs, 0, 0, geo.rs, -geo.x * geo.rs, -geo.y * geo.rs);
    if (mask.torn) return tornMask(cv, c, mask, geo);
    R.maskPath(c, mask);
    c.fillStyle = '#fff'; c.fill();
    if (Math.abs(expand) > 0.01) { c.lineJoin = 'round'; c.lineWidth = Math.abs(expand) * 2; c.strokeStyle = expand > 0 ? '#fff' : '#000'; c.stroke(); }
    return cv;
  };

  // ---- torn paper
  // The tear is a hand-drawn line across the layer. Both pieces are built from the same roughened line,
  // so they still fit each other; each piece's picture stops a little short of it, leaving bare fibre.
  R.tearLine = (torn, r) => {
    const src = torn.line, diag = Math.hypot(r.w, r.h), D = diag * 1.5;
    if (src.length < 2) return [];
    const dirOf = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    const k = Math.min(src.length - 1, 4);
    const d0 = dirOf(src[k], src[0]), d1 = dirOf(src[src.length - 1 - k], src[src.length - 1]);
    const ext = [[src[0][0] + d0[0] * D, src[0][1] + d0[1] * D], ...src, [src[src.length - 1][0] + d1[0] * D, src[src.length - 1][1] + d1[1] * D]];
    // resample at an even pace, then push each point sideways by a few octaves of noise
    const step = Math.max(2, diag / 420), out = [];
    let carry = 0, s = 0;
    for (let i = 1; i < ext.length; i++) {
      const a = ext[i - 1], b = ext[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1e-6) continue;
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      for (let d = carry; d < len; d += step) {
        const q = (s + d) / diag * 1000, amp = torn.rough * (0.55 * U.noise1(q / 70, torn.seed) + 0.3 * U.noise1(q / 21, torn.seed + 7) + 0.15 * U.noise1(q / 6, torn.seed + 13));
        out.push([a[0] + (b[0] - a[0]) * d / len + nx * amp, a[1] + (b[1] - a[1]) * d / len + ny * amp, nx, ny, q]);
      }
      carry = (carry - len) % step; if (carry < 0) carry += step;
      s += len;
    }
    return out;
  };
  function tornMask(cv, c, mask, geo) {
    const t = mask.torn, line = R.tearLine(t, geo.rect);
    if (line.length < 2) { c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#ff0'; c.fillRect(0, 0, cv.width, cv.height); return cv; }
    const a = line[0], b = line[line.length - 1], cl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const fx = -(b[1] - a[1]) / cl * t.side, fy = (b[0] - a[0]) / cl * t.side, far = Math.hypot(geo.rect.w, geo.rect.h) * 3;   // towards the side that is kept
    const region = (inset) => {
      c.beginPath();
      line.forEach((p, i) => {
        const pull = inset ? t.fibre * (0.3 + 0.7 * Math.abs(U.noise1(p[4] / 9, t.seed + 31 + t.side))) + t.fibre * 0.6 * Math.max(0, U.noise1(p[4] / 2.3, t.seed + 57)) : 0;
        const x = p[0] + p[2] * t.side * pull, y = p[1] + p[3] * t.side * pull;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      });
      c.lineTo(b[0] + fx * far, b[1] + fy * far); c.lineTo(a[0] + fx * far, a[1] + fy * far); c.closePath();
    };
    c.globalCompositeOperation = 'lighter';
    region(false); c.fillStyle = '#00ff00'; c.fill();
    region(true); c.fillStyle = '#ff0000'; c.fill();
    c.globalCompositeOperation = 'source-over';
    return cv;
  }

  // a small picture of an asset or layer for lists
  R.thumb = (source, sw, sh, w = 96, h = 54) => {
    const cv = mk(w, h), c = cv.getContext('2d');
    c.fillStyle = '#0b0f0d'; c.fillRect(0, 0, w, h);
    if (sw && sh) { const k = Math.min(w / sw, h / sh); try { c.drawImage(source, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k); } catch (e) { /* a frame that isn't decodable yet */ } }
    return cv;
  };
})();
