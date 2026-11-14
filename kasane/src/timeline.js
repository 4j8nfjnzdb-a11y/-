// Kasane — the timeline: layers as bars in time, their properties as rows of keyframes, and under a
// sounding layer the components the sound was read into, lane by lane, on the same ruler as everything else.
'use strict';
(() => {
  const U = KS.U, M = KS.M, S = KS.S, UI = KS.UI, h = UI.h;
  const TL = KS.TL = { rows: [], total: 0 };
  const RULER = 22, LH = 26, PH = 22, SH = 16;
  let left, right, cv, c2, cssW = 2, cssH = 2, drag = null, valEls = [];
  const ICON = { solid: 'solid', shape: 'star', text: 'text', image: 'image', video: 'film', audio: 'sound', null: 'nul', adjust: 'adjust', comp: 'comp' };

  TL.init = () => {
    left = document.getElementById('tlLeft'); right = document.getElementById('tlRight'); cv = document.getElementById('tlc'); c2 = cv.getContext('2d');
    new ResizeObserver(resize).observe(right);
    left.addEventListener('scroll', () => KS.touch('timeline'));
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('dblclick', (e) => { const hit = hitTest(e); if (hit && hit.row && hit.row.kind === 'layer' && hit.row.L.type === 'comp' && hit.onBar) KS.cmd.openComp(hit.row.L.comp); });
    const zoom = document.getElementById('tlZoom');
    zoom.addEventListener('input', () => { const mid = (S.tl.sx + cssW / 2) / S.tl.pps; S.tl.pps = 8 * Math.exp(zoom.value / 100 * Math.log(160)); S.tl.sx = Math.max(0, mid * S.tl.pps - cssW / 2); KS.touch('timeline'); });
    resize();
  };
  function resize() {
    const r = right.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = Math.max(2, r.width); cssH = Math.max(2, r.height); cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    KS.touch('timeline');
  }
  TL.fit = () => { const c = KS.comp(); if (!c) return; S.tl.pps = Math.max(8, (cssW - 24) / c.dur); S.tl.sx = 0; const z = document.getElementById('tlZoom'); z.value = Math.round(U.clamp(Math.log(S.tl.pps / 8) / Math.log(160), 0, 1) * 100); KS.touch('timeline'); };
  const xOf = (t) => t * S.tl.pps - S.tl.sx, tOf = (x) => (x + S.tl.sx) / S.tl.pps;

  const propPaths = (L) => {
    const mode = S.tl.open[L.id]; if (!mode) return [];
    const anim = M.animatedPaths(L);
    if (mode === 'anim') return anim;
    return (L.tr ? M.TR_ORDER.map((k) => 'tr.' + k) : []).concat(anim.filter((p) => !p.startsWith('tr.')));
  };
  const lanesOf = (L) => (S.tl.open[L.id] && (L.type === 'audio' || L.type === 'video') && KS.Sound.get(L.src) ? KS.Sound.LANES : []);
  function layout() {
    const comp = KS.comp(), rows = []; let y = 0;
    if (comp) for (const L of comp.layers) {
      rows.push({ kind: 'layer', L, y, h: LH }); y += LH;
      for (const path of propPaths(L)) { rows.push({ kind: 'prop', L, path, y, h: PH }); y += PH; }
      for (const sig of lanesOf(L)) { rows.push({ kind: 'sig', L, sig, y, h: SH }); y += SH; }
    }
    TL.rows = rows; TL.total = y;
  }
  const fmtVal = (v) => (typeof v === 'number' ? U.fmtNum(v, 1) : v.length === 4 ? U.rgba2hex(v) : v.map((x) => U.fmtNum(x, 1)).join(', '));

  // ---------------------------------------------------------------- left column
  TL.build = () => {
    layout();
    const comp = KS.comp(), frame = comp ? KS.frameNow() : null, top = left.scrollTop;
    valEls = [];
    const kids = [];
    for (const row of TL.rows) {
      const L = row.L;
      if (row.kind === 'layer') {
        const sel = S.sel.layers.includes(L.id), open = !!S.tl.open[L.id];
        const sb = (cls, icon, on, title, fn) => h('button.sb.' + cls + (on ? '.on' : ''), { type: 'button', title, 'aria-label': title, 'aria-pressed': String(!!on), html: UI.icon(icon), onclick: (e) => { e.stopPropagation(); fn(); KS.restructured(); KS.commit(cls); } });
        const name = h('span.nm', { title: L.name, ondblclick: (e) => { e.stopPropagation(); rename(L, name); } }, L.name);
        const el = h('div.lrow' + (sel ? '.sel' : '') + (L.vis ? '' : '.off'), { 'data-id': L.id },
          h('button.tw', { type: 'button', title: open ? '閉じる' : 'プロパティを開く', 'aria-expanded': String(open), html: UI.icon(open ? 'down' : 'right'), onclick: (e) => { e.stopPropagation(); if (open) delete S.tl.open[L.id]; else S.tl.open[L.id] = 'tr'; KS.emit('struct'); } }),
          L.tr ? sb('vis', L.vis ? 'eye' : 'eyeOff', L.vis, '表示', () => { L.vis = !L.vis; }) : sb('vis', L.vis ? 'sound' : 'eyeOff', L.vis, '音を出す', () => { L.vis = !L.vis; }),
          h('span.lab', { style: `background:${M.LABELS[L.label % M.LABELS.length]}` }), h('span.ty', { html: UI.icon(ICON[L.type] || 'solid'), title: M.TYPES[L.type] }), name,
          sb('so', 'solo', L.solo, 'このレイヤーだけ表示', () => { L.solo = !L.solo; }),
          L.tr ? sb('mb', 'blur', L.mb, 'モーションブラー', () => { L.mb = !L.mb; }) : null,
          sb('lk', 'lock', L.lock, 'ロック', () => { L.lock = !L.lock; }));
        el.addEventListener('pointerdown', (e) => rowDown(e, L, el));
        kids.push(el);
      } else if (row.kind === 'prop') {
        const prop = M.getProp(L, row.path), desc = M.desc(L, row.path) || { label: row.path }, keyed = !!(prop.k && prop.k.length);
        const val = h('span.pv2'); valEls.push({ el: val, L, path: row.path });
        const hasKeySel = keyed && prop.k.some((k) => S.sel.keys.includes(k.id));
        kids.push(h('div.prow2' + (hasKeySel ? '.sel' : ''),
          h('button.pb.kf' + (keyed ? '.on' : ''), { type: 'button', title: keyed ? 'キーフレームをやめる' : 'キーフレームを打つ', html: UI.icon(keyed ? 'keyOn' : 'key'), onclick: () => KS.cmd.toggleAnim(L, row.path) }),
          h('span.pn', { title: (desc.group ? desc.group + '：' : '') + desc.label, onclick: () => { if (keyed) KS.selectKeys(prop.k.map((k) => k.id)); } }, (desc.group ? desc.group + ' › ' : '') + desc.label, prop.r && prop.r.length ? h('span', { style: 'color:var(--tie)' }, ' 〜') : null, prop.x ? h('span', { style: 'color:var(--blade)' }, ' ƒ') : null),
          val,
          keyed ? h('button.pb', { type: 'button', title: '前のキーへ', html: UI.icon('prev'), onclick: () => navKey(prop, -1) }) : null,
          keyed ? h('button.pb', { type: 'button', title: 'ここにキーを打つ／消す', html: UI.icon('plus'), onclick: () => { const k = M.keyAt(prop, S.t); if (k) M.delKey(prop, k.id); else M.setKey(prop, S.t, KS.frameNow().val(L, row.path)); KS.restructured(); KS.commit('key'); } }) : null,
          keyed ? h('button.pb', { type: 'button', title: '次のキーへ', html: UI.icon('next'), onclick: () => navKey(prop, 1) }) : null));
      } else {
        const pick = S.relPick && S.relPick.layer === L.id && S.relPick.sig === row.sig;
        kids.push(h('div.srow' + (pick ? '.pick' : ''), h('button', { type: 'button', title: 'この成分を選ぶ（プロパティの 〜 で結べます）', onclick: () => { S.relPick = { layer: L.id, sig: row.sig }; KS.toast(`「${KS.Sound.NAME[row.sig]}」を選びました。プロパティの 〜 を押すと、この成分と結びます`); KS.emit('struct'); } }, KS.Sound.NAME[row.sig])));
      }
    }
    kids.push(h('div', { style: 'height:60px' }));
    left.replaceChildren(...kids);
    left.scrollTop = top;
    TL.refresh();
    document.getElementById('tlInfo').textContent = comp ? `${comp.name} · ${comp.w}×${comp.h} · ${comp.fps}fps · ${U.fmtNum(comp.dur, 2)}秒` : '';
    KS.touch('timeline');
  };
  TL.refresh = () => {
    if (!valEls.length) return;
    const frame = KS.frameNow();
    for (const v of valEls) { const x = frame.val(v.L, v.path); if (x !== undefined) v.el.textContent = fmtVal(x); }
  };
  function navKey(prop, dir) { let best = null; for (const k of prop.k) if (dir > 0 ? k.t > S.t + 1e-4 : k.t < S.t - 1e-4) if (best === null || (dir > 0 ? k.t < best : k.t > best)) best = k.t; if (best !== null) KS.setTime(best); }
  function rename(L, span) {
    const inp = h('input.nm', { type: 'text', value: L.name });
    const done = (ok) => { if (ok && inp.value.trim()) { L.name = inp.value.trim(); KS.commit('rename'); } KS.restructured(); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true)); inp.addEventListener('pointerdown', (e) => e.stopPropagation());
    span.replaceWith(inp); inp.focus(); inp.select();
  }
  // click selects; dragging a row up or down changes the stacking order
  function rowDown(e, L, el) {
    if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
    const y0 = e.clientY; let moved = false, target = null;
    if (e.shiftKey || e.metaKey || e.ctrlKey) KS.select(L.id, { toggle: true }); else if (!S.sel.layers.includes(L.id)) KS.select(L.id);
    const clear = () => left.querySelectorAll('.drop-above,.drop-below').forEach((n) => n.classList.remove('drop-above', 'drop-below'));
    const mv = (ev) => {
      if (!moved && Math.abs(ev.clientY - y0) < 6) return;
      moved = true; clear();
      const rows = [...left.querySelectorAll('.lrow')]; target = null;
      for (const r of rows) { const b = r.getBoundingClientRect(); if (ev.clientY >= b.top && ev.clientY < b.bottom) { const above = ev.clientY < b.top + b.height / 2; r.classList.add(above ? 'drop-above' : 'drop-below'); target = { id: r.dataset.id, above }; } }
    };
    const upH = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upH); clear();
      if (!moved) { if (!(e.shiftKey || e.metaKey || e.ctrlKey)) KS.select(L.id); return; }
      const comp = KS.comp(); if (!target || !comp) return;
      const picked = comp.layers.filter((l) => S.sel.layers.includes(l.id)); if (picked.some((l) => l.id === target.id)) return;
      comp.layers = comp.layers.filter((l) => !S.sel.layers.includes(l.id));
      const at = comp.layers.findIndex((l) => l.id === target.id) + (target.above ? 0 : 1);
      comp.layers.splice(at, 0, ...picked);
      KS.restructured(); KS.commit('reorder');
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upH);
  }

  // ---------------------------------------------------------------- canvas
  const css = {};
  const col = (name) => css[name] || (css[name] = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim());
  TL.draw = () => {
    const comp = KS.comp(); if (!comp || !c2) return;
    const dpr = cv.width / cssW; c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.clearRect(0, 0, cssW, cssH);
    const pps = S.tl.pps, sy = left.scrollTop, selKeys = new Set(S.sel.keys);
    const x0 = xOf(0), x1 = xOf(comp.dur);
    c2.fillStyle = 'rgba(232,236,230,.035)'; c2.fillRect(x0, RULER, x1 - x0, cssH);
    c2.save(); c2.beginPath(); c2.rect(0, RULER, cssW, cssH - RULER); c2.clip();
    for (const row of TL.rows) {
      const y = row.y - sy + RULER; if (y + row.h < RULER || y > cssH) continue;
      const L = row.L, lc = M.LABELS[L.label % M.LABELS.length];
      if (row.kind === 'layer') {
        const sel = S.sel.layers.includes(L.id), a = xOf(L.in), b = xOf(L.out);
        if (sel) { c2.fillStyle = 'rgba(111,208,197,.07)'; c2.fillRect(0, y, cssW, row.h); }
        c2.globalAlpha = L.vis ? (sel ? 0.95 : 0.6) : 0.25; c2.fillStyle = lc;
        c2.beginPath(); if (c2.roundRect) c2.roundRect(a, y + 5, Math.max(2, b - a), row.h - 10, 3); else c2.rect(a, y + 5, Math.max(2, b - a), row.h - 10); c2.fill(); c2.globalAlpha = 1;
        const an = (L.type === 'audio' || L.type === 'video') ? KS.Sound.get(L.src) : null;
        if (an) {                               // the sound's outline inside its bar
          c2.strokeStyle = 'rgba(10,14,12,.6)'; c2.lineWidth = 1; c2.beginPath();
          const sp = L.speed || 1, mid = y + row.h / 2, amp = (row.h - 12) / 2;
          for (let x = Math.max(0, Math.floor(a)); x < Math.min(cssW, b); x += 1) { const i = Math.round((tOf(x) - L.start) * sp * 100); if (i < 0 || i >= an.n) continue; c2.moveTo(x + 0.5, mid + an.peaks.min[i] * amp); c2.lineTo(x + 0.5, mid + an.peaks.max[i] * amp + 0.5); }
          c2.stroke();
        }
        if (!S.tl.open[L.id]) {                 // closed: keyframes show as small marks on the bar
          c2.fillStyle = 'rgba(10,14,12,.75)'; const seen = new Set();
          M.eachKey(L, (k) => { const x = Math.round(xOf(k.t)); if (seen.has(x)) return; seen.add(x); c2.fillRect(x - 1, y + row.h - 9, 2, 4); });
        }
        c2.strokeStyle = 'rgba(214,232,222,.045)'; c2.beginPath(); c2.moveTo(0, y + row.h - 0.5); c2.lineTo(cssW, y + row.h - 0.5); c2.stroke();
      } else if (row.kind === 'prop') {
        const prop = M.getProp(L, row.path); if (!prop) continue;
        const mid = y + row.h / 2;
        if (prop.r && prop.r.length) {          // what the sound does to this property, as a faint trace
          c2.strokeStyle = col('tie'); c2.globalAlpha = 0.75; c2.lineWidth = 1; c2.beginPath(); let first = true;
          const curves = prop.r.filter((r) => r.on !== false).map((r) => KS.Rel.baked(comp, L, r));
          for (let x = Math.max(0, x0); x < Math.min(cssW, x1); x += 2) { const t = tOf(x); let v = 0; for (const c of curves) v += KS.Rel.sample(c, t); const yy = mid + 8 - U.clamp(v, -1.2, 1.2) * 8; if (first) { c2.moveTo(x, yy); first = false; } else c2.lineTo(x, yy); }
          c2.stroke(); c2.globalAlpha = 1;
        }
        if (prop.k && prop.k.length) {
          c2.strokeStyle = 'rgba(232,236,230,.16)'; c2.beginPath(); c2.moveTo(xOf(prop.k[0].t), mid); c2.lineTo(xOf(prop.k[prop.k.length - 1].t), mid); c2.stroke();
          for (const k of prop.k) {
            const x = xOf(k.t); if (x < -8 || x > cssW + 8) continue;
            c2.fillStyle = selKeys.has(k.id) ? '#fff' : col('tape'); c2.beginPath();
            if (k.h) c2.rect(x - 4, mid - 4, 8, 8); else if (k.e) { c2.moveTo(x, mid - 5); c2.quadraticCurveTo(x + 5, mid - 5, x + 5, mid); c2.quadraticCurveTo(x + 5, mid + 5, x, mid + 5); c2.quadraticCurveTo(x - 5, mid + 5, x - 5, mid); c2.quadraticCurveTo(x - 5, mid - 5, x, mid - 5); } else { c2.moveTo(x, mid - 5); c2.lineTo(x + 5, mid); c2.lineTo(x, mid + 5); c2.lineTo(x - 5, mid); }
            c2.closePath(); c2.fill();
          }
        }
      } else drawLane(row, y, comp);
    }
    if (drag && drag.kind === 'marquee') { c2.strokeStyle = col('blade'); c2.fillStyle = 'rgba(111,208,197,.12)'; const m = drag; c2.fillRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0); c2.strokeRect(m.x0 + 0.5, m.y0 + 0.5, m.x1 - m.x0, m.y1 - m.y0); }
    c2.restore();
    // ruler
    c2.fillStyle = col('panel'); c2.fillRect(0, 0, cssW, RULER);
    const steps = [1 / comp.fps, 2 / comp.fps, 5 / comp.fps, 10 / comp.fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300], major = steps.find((s) => s * pps >= 64) || 600, minor = major / (major >= 1 ? (major === 15 ? 3 : 5) : major * comp.fps > 5 ? 5 : Math.max(1, Math.round(major * comp.fps)));
    c2.font = `10px ${col('f-num') || 'monospace'}`; c2.textBaseline = 'middle';
    for (let t = Math.max(0, Math.floor(tOf(0) / minor) * minor); t <= Math.min(comp.dur, tOf(cssW)) + 1e-6; t += minor) {
      const x = Math.round(xOf(t)) + 0.5, big = Math.abs(t / major - Math.round(t / major)) < 1e-4;
      c2.strokeStyle = big ? 'rgba(232,236,230,.34)' : 'rgba(232,236,230,.13)'; c2.beginPath(); c2.moveTo(x, big ? 11 : 16); c2.lineTo(x, RULER); c2.stroke();
      if (big) { c2.fillStyle = col('dim'); c2.fillText(U.fmtTime(t, comp.fps), x + 3, 7); }
    }
    const wa = xOf(comp.wa[0]), wb = xOf(comp.wa[1]);
    c2.fillStyle = 'rgba(233,200,74,.16)'; c2.fillRect(wa, RULER - 5, wb - wa, 5); c2.fillStyle = col('tape'); c2.fillRect(wa, RULER - 5, 2, 5); c2.fillRect(wb - 2, RULER - 5, 2, 5);
    c2.strokeStyle = 'rgba(214,232,222,.18)'; c2.beginPath(); c2.moveTo(0, RULER - 0.5); c2.lineTo(cssW, RULER - 0.5); c2.stroke();
    // playhead
    const px = Math.round(xOf(S.t)) + 0.5;
    c2.strokeStyle = col('tape'); c2.lineWidth = 1; c2.beginPath(); c2.moveTo(px, 4); c2.lineTo(px, cssH); c2.stroke();
    c2.fillStyle = col('tape'); c2.beginPath(); c2.moveTo(px - 5, 0); c2.lineTo(px + 5, 0); c2.lineTo(px + 5, 6); c2.lineTo(px, 11); c2.lineTo(px - 5, 6); c2.closePath(); c2.fill();
  };
  function drawLane(row, y, comp) {
    const L = row.L, an = KS.Sound.get(L.src); if (!an) return;
    const a = an.sig[row.sig], kind = an.kind[row.sig], sp = L.speed || 1, hh = row.h - 3, base = y + row.h - 2;
    const xa = Math.max(0, Math.floor(xOf(L.in))), xb = Math.min(cssW, Math.ceil(xOf(L.out)));
    const pick = S.relPick && S.relPick.layer === L.id && S.relPick.sig === row.sig;
    c2.fillStyle = pick ? 'rgba(201,162,242,.12)' : 'rgba(201,162,242,.04)'; c2.fillRect(xa, y, xb - xa, row.h - 1);
    const idx = (x) => Math.round((tOf(x) - L.start) * sp * 100);
    if (row.sig === 'tone') { for (let x = xa; x < xb; x += 2) { const i = idx(x); if (i < 0 || i >= an.n || an.sig.tonal[i] < 0.1) continue; c2.fillStyle = `hsl(${Math.round(a[i] * 360)} 75% 60%)`; c2.fillRect(x, y + 3, 2, row.h - 7); } return; }
    c2.fillStyle = c2.strokeStyle = col('tie'); c2.globalAlpha = pick ? 1 : 0.8;
    if (kind === 'imp') {
      const perPx = sp * 100 / S.tl.pps;
      for (let x = xa; x < xb; x++) { const i0 = idx(x), i1 = Math.max(i0 + 1, Math.round(i0 + perPx)); let v = 0; for (let i = Math.max(0, i0); i < Math.min(an.n, i1); i++) if (a[i] > v) v = a[i]; if (v > 0) c2.fillRect(x, base - Math.max(3, v * hh), 1.5, Math.max(3, v * hh)); }
    } else {
      c2.beginPath(); c2.moveTo(xa, base);
      for (let x = xa; x < xb; x += 2) { const i = idx(x), v = i >= 0 && i < an.n ? a[i] : 0; c2.lineTo(x, kind === 'bip' ? y + row.h / 2 - v * hh / 2 : base - v * hh); }
      if (kind === 'bip') c2.stroke(); else { c2.lineTo(xb, base); c2.closePath(); c2.globalAlpha *= 0.55; c2.fill(); }
    }
    c2.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- pointer on the canvas
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function hitTest(e) {
    const [x, y] = pos(e), comp = KS.comp(); if (!comp) return null;
    if (y < RULER) { const wa = xOf(comp.wa[0]), wb = xOf(comp.wa[1]); return { ruler: true, x, y, wa: y > RULER - 9 && Math.abs(x - wa) < 7 ? 0 : y > RULER - 9 && Math.abs(x - wb) < 7 ? 1 : -1 }; }
    const yy = y - RULER + left.scrollTop, row = TL.rows.find((r) => yy >= r.y && yy < r.y + r.h);
    const out = { x, y, row };
    if (!row) return out;
    if (row.kind === 'layer') { const a = xOf(row.L.in), b = xOf(row.L.out); out.onBar = x >= a - 3 && x <= b + 3; out.edge = out.onBar ? (Math.abs(x - a) < 6 ? 'in' : Math.abs(x - b) < 6 ? 'out' : null) : null; }
    else if (row.kind === 'prop') { const prop = M.getProp(row.L, row.path); let best = null, bd = 8; for (const k of (prop && prop.k) || []) { const d = Math.abs(xOf(k.t) - x); if (d < bd) { bd = d; best = k; } } out.key = best; out.prop = prop; }
    return out;
  }
  function down(e) {
    if (S.exporting) return;
    const hit = hitTest(e), comp = KS.comp(); if (!hit || !comp) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    if (hit.ruler) { if (hit.wa >= 0) drag = { kind: 'wa', i: hit.wa }; else { drag = { kind: 'scrub' }; KS.setTime(tOf(hit.x)); } return; }
    const row = hit.row;
    if (!row) { if (!add) { KS.select([]); } drag = { kind: 'marquee', x0: hit.x, y0: hit.y, x1: hit.x, y1: hit.y }; return; }
    if (row.kind === 'layer') {
      const L = row.L;
      if (add) KS.select(L.id, { toggle: true }); else if (!S.sel.layers.includes(L.id)) KS.select(L.id);
      if (!hit.onBar || L.lock) { drag = { kind: 'none' }; return; }
      const Ls = hit.edge ? [L] : KS.selLayers().filter((l) => !l.lock);
      drag = { kind: hit.edge ? 'trim' : 'slide', edge: hit.edge, x: hit.x, moved: false, items: Ls.map((l) => ({ L: l, in: l.in, out: l.out, start: l.start, keys: (() => { const o = []; M.eachKey(l, (k) => o.push([k, k.t])); return o; })() })) };
    } else if (row.kind === 'prop') {
      if (hit.key) {
        if (add) KS.selectKeys([hit.key.id], { toggle: true }); else if (!S.sel.keys.includes(hit.key.id)) KS.selectKeys([hit.key.id]);
        if (!S.sel.layers.includes(row.L.id)) { S.sel.layers = [row.L.id]; KS.emit('sel'); }
        drag = { kind: 'keys', x: hit.x, moved: false, items: KS.selKeys().map((s) => ({ key: s.key, prop: s.prop, t: s.key.t })) };
      } else { if (!add) KS.selectKeys([]); drag = { kind: 'marquee', x0: hit.x, y0: hit.y, x1: hit.x, y1: hit.y }; }
    } else { S.relPick = { layer: row.L.id, sig: row.sig }; KS.toast(`「${KS.Sound.NAME[row.sig]}」を選びました。プロパティの 〜 を押すと、この成分と結びます`); KS.emit('struct'); drag = { kind: 'none' }; }
  }
  function move(e) {
    const comp = KS.comp(); if (!comp) return;
    const [x, y] = pos(e);
    if (!drag) { const hit = hitTest(e); cv.style.cursor = !hit ? '' : hit.ruler ? (hit.wa >= 0 ? 'ew-resize' : 'col-resize') : hit.edge ? 'ew-resize' : hit.key ? 'pointer' : ''; return; }
    const fr = 1 / comp.fps, snapT = (t) => { const s = M.snap(comp, t); return Math.abs(xOf(S.t) - xOf(s)) < 7 ? S.t : s; };
    switch (drag.kind) {
      case 'scrub': KS.setTime(tOf(x)); if (x > cssW - 20) { S.tl.sx += 12; } else if (x < 20 && S.tl.sx > 0) S.tl.sx = Math.max(0, S.tl.sx - 12); return;
      case 'wa': { const t = U.clamp(M.snap(comp, tOf(x)), 0, comp.dur); if (drag.i === 0) comp.wa[0] = Math.min(t, comp.wa[1] - fr); else comp.wa[1] = Math.max(t, comp.wa[0] + fr); KS.touch('timeline'); return; }
      case 'slide': {
        if (!drag.moved && Math.abs(x - drag.x) < 3) return; drag.moved = true;
        const it0 = drag.items[0], dt = snapT(it0.in + (x - drag.x) / S.tl.pps) - it0.in;
        for (const it of drag.items) { it.L.in = it.in + dt; it.L.out = it.out + dt; it.L.start = it.start + dt; for (const [k, t] of it.keys) k.t = t + dt; }
        break;
      }
      case 'trim': {
        if (!drag.moved && Math.abs(x - drag.x) < 3) return; drag.moved = true;
        const it = drag.items[0], t = snapT(tOf(x));
        if (drag.edge === 'in') it.L.in = Math.min(t, it.L.out - fr); else it.L.out = Math.max(t, it.L.in + fr);
        break;
      }
      case 'keys': {
        if (!drag.moved && Math.abs(x - drag.x) < 3) return; drag.moved = true;
        const k0 = drag.items[0], dt = snapT(k0.t + (x - drag.x) / S.tl.pps) - k0.t;
        for (const it of drag.items) it.key.t = Math.max(0, M.snap(comp, it.t + dt));
        break;
      }
      case 'marquee': drag.x1 = x; drag.y1 = y; KS.touch('timeline'); return;
      default: return;
    }
    KS.changed();
  }
  function up(e) {
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    const d = drag; drag = null; if (!d) return;
    if (d.kind === 'keys' && d.moved) { const ps = new Set(d.items.map((i) => i.prop)); ps.forEach((p) => M.sortKeys(p)); S.sel.keys = S.sel.keys.filter((id) => [...ps].some((p) => p.k && p.k.some((k) => k.id === id))); KS.emit('sel'); KS.restructured(); KS.commit('move keys'); }
    else if ((d.kind === 'slide' || d.kind === 'trim') && d.moved) { KS.changed(); KS.commit(d.kind); }
    else if (d.kind === 'wa') KS.commit('work area');
    else if (d.kind === 'marquee') {
      const xa = Math.min(d.x0, d.x1), xb = Math.max(d.x0, d.x1), ya = Math.min(d.y0, d.y1) - RULER + left.scrollTop, yb = Math.max(d.y0, d.y1) - RULER + left.scrollTop, ids = [];
      if (xb - xa > 3 || yb - ya > 3) for (const row of TL.rows) { if (row.kind !== 'prop' || row.y + row.h < ya || row.y > yb) continue; const prop = M.getProp(row.L, row.path); for (const k of (prop && prop.k) || []) { const x = xOf(k.t); if (x >= xa && x <= xb) ids.push(k.id); } }
      KS.selectKeys(ids, { add: e.shiftKey });
    }
    KS.touch('timeline');
  }
  function wheel(e) {
    e.preventDefault();
    const [x] = pos(e);
    if (e.ctrlKey || e.metaKey) { const t = tOf(x); S.tl.pps = U.clamp(S.tl.pps * Math.exp(-e.deltaY * 0.01), 8, 1280); S.tl.sx = Math.max(0, t * S.tl.pps - x); document.getElementById('tlZoom').value = Math.round(U.clamp(Math.log(S.tl.pps / 8) / Math.log(160), 0, 1) * 100); }
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) S.tl.sx = Math.max(0, S.tl.sx + (e.deltaX || e.deltaY));
    else left.scrollTop += e.deltaY;
    KS.touch('timeline');
  }
  // keep the playhead in sight while playing
  TL.follow = () => { const x = xOf(S.t); if (x > cssW - 30 || x < 0) { S.tl.sx = Math.max(0, S.t * S.tl.pps - 40); } };
})();
