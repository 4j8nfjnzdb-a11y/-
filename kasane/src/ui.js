// Kasane — small interface parts shared by the panels: icons, popovers, dialogs, toasts,
// and the number field that can be dragged sideways like a slider or typed into.
'use strict';
(() => {
  const U = KS.U;
  const UI = KS.UI = {};

  const P = {
    select: '<path d="M5 3.5l9.5 5.6-4.2 1.1 2.6 4.6-1.9 1.1-2.6-4.6L5 14.5z"/>',
    hand: '<path d="M7 10V5.2a1.1 1.1 0 0 1 2.2 0V9m0-4.6V4a1.1 1.1 0 0 1 2.2 0v5m0-4a1.1 1.1 0 0 1 2.2 0v5.2m0-3a1.1 1.1 0 0 1 2.2 0V12a5 5 0 0 1-5 5h-.8a4.6 4.6 0 0 1-3.8-2L4.6 12.6a1.2 1.2 0 0 1 1.9-1.4L7 12"/>',
    rect: '<rect x="3.5" y="5" width="13" height="10" rx="1"/>',
    ellipse: '<ellipse cx="10" cy="10" rx="6.5" ry="5.5"/>',
    star: '<path d="M10 3l2.1 4.5 4.9.6-3.6 3.4.9 4.9L10 14l-4.3 2.4.9-4.9L3 8.1l4.9-.6z"/>',
    pen: '<path d="M4 16l1.3-4.5L13 3.8l3.2 3.2-7.7 7.7z"/><path d="M11.5 5.3l3.2 3.2"/>',
    text: '<path d="M4.5 5h11M10 5v10.5M7.5 15.5h5"/>',
    pin: '<path d="M10 12.5V17M6.5 4h7l-1 4 2.2 3.2H5.3L7.5 8z"/>',
    tear: '<path d="M3.5 4.5H9l-1.4 2.8 2 2.6-2 2.6L9 15.5H3.5z"/><path d="M16.5 4.5h-3.8l-1.4 2.8 2 2.6-2 2.6 1.4 3h3.8z"/>',
    crumple: '<path d="M9.5 3l5.5 2 2 4.8-2.6 5.4-6 1.6-4.7-3.6L3.2 8z"/><path d="M9.5 3l-1 5.6 5.9 6.6M3.2 8l5.3.6L15 5M3.7 13.2l4.8-4.6"/>',
    play: '<path d="M6 4l10 6-10 6z" fill="currentColor"/>',
    pause: '<path d="M6 4.5v11M14 4.5v11" stroke-width="2.6"/>',
    first: '<path d="M5 4.5v11M15 5l-7 5 7 5z"/>',
    prev: '<path d="M13 5l-6 5 6 5"/>',
    next: '<path d="M7 5l6 5-6 5"/>',
    loop: '<path d="M5 8.5a4 4 0 0 1 4-4h5.5M12.5 2l2.3 2.5-2.3 2.5M15 11.5a4 4 0 0 1-4 4H5.5M7.5 18l-2.3-2.5 2.3-2.5"/>',
    rec: '<circle cx="10" cy="10" r="5" fill="currentColor"/>',
    undo: '<path d="M7 4L3.5 7.5 7 11M3.5 7.5h8a5 5 0 0 1 0 10H8"/>',
    redo: '<path d="M13 4l3.5 3.5L13 11M16.5 7.5h-8a5 5 0 0 0 0 10H12"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    eye: '<path d="M2.5 10s3-5.5 7.5-5.5 7.5 5.5 7.5 5.5-3 5.5-7.5 5.5S2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2.2"/>',
    eyeOff: '<path d="M3 3l14 14M8 5a7 7 0 0 1 2-.5c4.5 0 7.5 5.5 7.5 5.5a13 13 0 0 1-2.4 3M12.6 15a7 7 0 0 1-2.6.5C5.500 15.500 2.500 10 2.500 10a13 13 0 0 1 3-3.500"/>',
    lock: '<rect x="5" y="9" width="10" height="7.500" rx="1.500"/><path d="M7 9V6.500a3 3 0 0 1 6 0V9"/>',
    key: '<path d="M10 3.5l5.5 6.5-5.5 6.5L4.5 10z"/>',
    keyOn: '<path d="M10 3.5l5.5 6.5-5.5 6.5L4.5 10z" fill="currentColor"/>',
    tie: '<path d="M2.500 10c1.700-4 3.300-4 5 0s3.300 4 5 0 3.300-4 5 0"/>',
    fx: '<path d="M10 2.500l1.700 4.800 4.800 1.700-4.800 1.700L10 15.500l-1.700-4.800L3.500 9l4.800-1.700z"/>',
    func: '<path d="M12.500 4.500c-2 0-2.500 1.200-2.800 3L8.500 15c-.300 1.800-.800 3-2.800 3M6.500 9h6"/>',
    dice: '<rect x="3.500" y="3.500" width="13" height="13" rx="2.500"/><circle cx="7.200" cy="7.200" r=".9" fill="currentColor"/><circle cx="12.800" cy="12.800" r=".9" fill="currentColor"/><circle cx="10" cy="10" r=".9" fill="currentColor"/>',
    trash: '<path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.600L14 6"/>',
    down: '<path d="M5 8l5 5 5-5"/>',
    right: '<path d="M8 5l5 5-5 5"/>',
    up: '<path d="M5 12l5-5 5 5"/>',
    x: '<path d="M5 5l10 10M15 5L5 15"/>',
    film: '<rect x="3" y="4" width="14" height="12" rx="1.500"/><path d="M6.500 4v12M13.500 4v12M3 8h3.500M3 12h3.500M13.500 8H17M13.500 12H17"/>',
    image: '<rect x="3" y="4" width="14" height="12" rx="1.500"/><path d="M3 13.500l4-4 3.500 3.500 2.500-2.500 4 4"/><circle cx="13" cy="7.800" r="1.200"/>',
    sound: '<path d="M4 8v4M7 5.500v9M10 3.500v13M13 6.500v7M16 8.500v3"/>',
    solid: '<rect x="4" y="4" width="12" height="12" rx="1" fill="currentColor" fill-opacity=".35"/>',
    nul: '<rect x="4.500" y="4.500" width="11" height="11" stroke-dasharray="2.500 2"/>',
    adjust: '<circle cx="10" cy="10" r="6"/><path d="M10 4v12" /><path d="M10 4a6 6 0 0 1 0 12z" fill="currentColor"/>',
    comp: '<rect x="3" y="6" width="11" height="9" rx="1"/><path d="M6 6V4h11v9h-3"/>',
    blur: '<circle cx="10" cy="10" r="2"/><circle cx="10" cy="10" r="5" stroke-dasharray="1.500 2.500"/><circle cx="10" cy="10" r="7.500" stroke-dasharray="1 3.500"/>',
    help: '<circle cx="10" cy="10" r="7"/><path d="M7.800 8a2.300 2.300 0 1 1 3.200 2.100c-.700.300-1 .800-1 1.500M10 14.200v.100"/>',
    fit: '<path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/>',
    more: '<circle cx="5" cy="10" r="1.200" fill="currentColor"/><circle cx="10" cy="10" r="1.200" fill="currentColor"/><circle cx="15" cy="10" r="1.200" fill="currentColor"/>',
    link: '<path d="M8.500 11.500a3 3 0 0 0 4.200 0l2.500-2.500a3 3 0 0 0-4.200-4.200l-1 1M11.500 8.500a3 3 0 0 0-4.200 0L4.800 11a3 3 0 0 0 4.200 4.200l1-1"/>',
    rule: '<path d="M4 5h6M4 10h12M4 15h8"/><circle cx="13" cy="5" r="1.800"/><circle cx="14.500" cy="15" r="1.800"/>',
    solo: '<path d="M13 6.500c-.500-1-1.600-1.500-3-1.500-1.800 0-3 .900-3 2.300 0 3.200 6.200 1.400 6.200 4.700 0 1.400-1.300 2.500-3.200 2.500-1.600 0-2.800-.600-3.400-1.800"/>',
  };
  UI.icon = (name) => `<svg class="ic" viewBox="0 0 20 20" aria-hidden="true">${P[name] || ''}</svg>`;

  // h('div.cls#id', {attrs/on*}, children...)
  UI.h = (spec, attrs, ...kids) => {
    const m = /^([a-z0-9]+)?(.*)$/i.exec(spec), el = document.createElement(m[1] || 'div');
    for (const part of m[2].match(/[.#][^.#]+/g) || []) { if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1); }
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const put = (c) => { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) c.forEach(put); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
    kids.forEach(put);
    return el;
  };
  const h = UI.h;
  UI.btn = (icon, title, onclick, cls = '') => h('button.ib' + (cls ? '.' + cls : ''), { type: 'button', title, 'aria-label': title, html: UI.icon(icon), onclick });

  // ---- popover
  let popEl = null, popAnchor = null;
  UI.closePop = () => { if (popEl) { popEl.hidden = true; popEl.replaceChildren(); popAnchor = null; } };
  UI.pop = (anchor, content, o = {}) => {
    popEl = popEl || document.getElementById('pop');
    if (popAnchor === anchor && !popEl.hidden && !o.force) { UI.closePop(); return null; }
    popEl.replaceChildren(content); popEl.hidden = false; popAnchor = anchor;
    popEl.style.maxWidth = (o.width || 320) + 'px'; popEl.style.left = '0px'; popEl.style.top = '0px';
    const a = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }, vw = window.innerWidth, vh = window.innerHeight;
    const r = popEl.getBoundingClientRect();
    let x = Math.min(a.left, vw - r.width - 8), y = a.bottom + 6;
    if (y + r.height > vh - 8) y = Math.max(8, a.top - r.height - 6);
    popEl.style.left = Math.max(8, x) + 'px'; popEl.style.top = Math.max(8, y) + 'px';
    return popEl;
  };
  UI.menu = (anchor, items, o = {}) => {
    const list = h('div.menu', { role: 'menu' });
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { list.append(h('div.msep', it.label ? { text: it.label } : null)); continue; }
      list.append(h('button.mi' + (it.checked ? '.on' : ''), { type: 'button', role: 'menuitem', disabled: it.disabled, onclick: () => { if (!it.keep) UI.closePop(); it.run(); } },
        it.icon ? h('span.mic', { html: UI.icon(it.icon) }) : null, h('span.ml', h('b', it.label), it.hint ? h('small', it.hint) : null), it.key ? h('kbd', it.key) : null));
    }
    return UI.pop(anchor, list, o);
  };
  document.addEventListener('pointerdown', (e) => { if (popEl && !popEl.hidden && !popEl.contains(e.target) && !(popAnchor && popAnchor.contains && popAnchor.contains(e.target))) UI.closePop(); }, true);

  // ---- dialog (the viewer has no confirm(); everything is asked inside the page)
  UI.modal = (title, body, buttons = []) => {
    const m = document.getElementById('modal');
    const close = () => { m.hidden = true; m.replaceChildren(); };
    const box = h('div.mbox', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div.mhead', h('h2', title), UI.btn('x', '閉じる', close)), h('div.mbody', body),
      buttons.length ? h('div.mfoot', buttons.map((b) => h('button.btn' + (b.primary ? '.primary' : ''), { type: 'button', onclick: () => { if (b.run() !== false) close(); } }, b.label))) : null);
    m.replaceChildren(box); m.hidden = false;
    m.onclick = (e) => { if (e.target === m) close(); };
    return { close, box };
  };
  UI.confirm = (title, text, yes, run) => UI.modal(title, h('p', text), [{ label: 'やめる', run: () => {} }, { label: yes, primary: true, run }]);

  let toastT = 0;
  UI.toast = (msg, kind) => { const t = document.getElementById('toast'); t.textContent = msg; t.dataset.kind = kind || ''; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), kind === 'warn' ? 5200 : 2800); };

  // ---- number field: drag sideways to change, click to type. o: { value, step, min, max, digits, unit, wide, onInput(v, done) }
  UI.num = (o) => {
    const digits = o.digits !== undefined ? o.digits : (o.step && o.step < 1 ? (o.step < 0.1 ? 2 : 1) : (o.int ? 0 : 1));
    const fmt = (v) => U.fmtNum(v, digits);
    const el = h('input.num' + (o.wide ? '.wide' : ''), { type: 'text', inputmode: 'decimal', value: fmt(o.value), title: o.title || 'ドラッグで増減、クリックで入力', 'aria-label': o.label || '', autocomplete: 'off', spellcheck: 'false' });
    let val = o.value, drag = null;
    const lim = (v) => { if (o.int) v = Math.round(v); if (o.min !== undefined) v = Math.max(o.min, v); if (o.max !== undefined) v = Math.min(o.max, v); return v; };
    el._set = (v) => { val = v; if (document.activeElement !== el || drag) el.value = fmt(v); };
    el.addEventListener('pointerdown', (e) => { if (document.activeElement === el) return; drag = { x: e.clientX, v: val, moved: false, id: e.pointerId }; el.setPointerCapture(e.pointerId); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 4) return;
      drag.moved = true; el.classList.add('scrub');
      const st = (o.step || 1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      val = lim(U.round(drag.v + Math.round(dx / 2) * st, 4)); el.value = fmt(val); o.onInput(val, false);
    });
    const up = (e) => {
      if (!drag) return;
      const d = drag; drag = null; el.classList.remove('scrub');
      try { el.releasePointerCapture(d.id); } catch (err) { /* already released */ }
      if (d.moved) o.onInput(val, true); else if (e.type === 'pointerup') { el.focus(); el.select(); }
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { el.blur(); return; }
      if (e.key === 'Escape') { el.value = fmt(val); el.blur(); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); val = lim(U.round(val + (e.key === 'ArrowUp' ? 1 : -1) * (o.step || 1) * (e.shiftKey ? 10 : 1), 4)); el.value = fmt(val); o.onInput(val, true); }
      e.stopPropagation();
    });
    el.addEventListener('change', () => { const v = parseFloat(el.value.replace(/[^\d.eE+-]/g, '')); if (isFinite(v)) { val = lim(v); o.onInput(val, true); } el.value = fmt(val); });
    return o.unit ? h('span.numw', el, h('i', o.unit)) : el;
  };
  UI.setNum = (wrap, v) => { const el = wrap.tagName === 'INPUT' ? wrap : wrap.querySelector('input'); if (el && el._set) el._set(v); };

  // colour: [r,g,b,a] 0..1
  UI.color = (o) => {
    let c = o.value.slice();
    const inp = h('input', { type: 'color', value: U.rgba2hex(c), 'aria-label': o.label || '色' });
    const sw = h('span.sw2'), paint = () => { sw.style.background = U.rgbaCss(c); };
    const al = UI.num({ value: Math.round((c[3] === undefined ? 1 : c[3]) * 100), min: 0, max: 100, step: 1, int: true, unit: '%', title: '不透明度', onInput: (v, done) => { c[3] = v / 100; paint(); o.onInput(c.slice(), done); } });
    inp.addEventListener('input', () => { const n = U.hex2rgba(inp.value, c[3]); c = [n[0], n[1], n[2], c[3] === undefined ? 1 : c[3]]; paint(); o.onInput(c.slice(), false); });
    inp.addEventListener('change', () => o.onInput(c.slice(), true));
    paint();
    const el = h('span.colw', h('label.col', inp, sw), o.noAlpha ? null : al);
    el._set = (v) => { c = v.slice(); if (document.activeElement !== inp) inp.value = U.rgba2hex(c); paint(); if (!o.noAlpha) UI.setNum(al, Math.round((c[3] === undefined ? 1 : c[3]) * 100)); };
    return el;
  };
  // options: [[value, label], ...] or groups [[groupLabel, [[value,label],...]], ...] when o.grouped
  UI.select = (options, value, onChange, o = {}) => {
    const mk = ([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l);
    const el = h('select.sel', { 'aria-label': o.label || '', onchange: () => onChange(el.value) }, o.grouped ? options.map(([g, items]) => h('optgroup', { label: g }, items.map(mk))) : options.map(mk));
    el.value = String(value);
    return el;
  };
  UI.check = (label, value, onChange) => { const i = h('input', { type: 'checkbox', checked: !!value, onchange: () => onChange(i.checked) }); return h('label.chk', i, h('span', label)); };
})();
