// Kasane — expressions: a property can be driven by a line of code instead of (or on top of) keyframes,
// with the vocabulary After Effects users already know: time, value, wiggle(), loopOut(), linear(), ...
// This is a small interpreter rather than eval/new Function: a project file may come from someone else,
// and nothing typed into an expression can reach the page, its storage or the network.
'use strict';
(() => {
  const U = KS.U, M = KS.M;
  const X = KS.X = {};

  // ---------------------------------------------------------------- tokenizer
  const PUNCT = ['===', '!==', '**', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '=>',
    '+', '-', '*', '/', '%', '(', ')', '[', ']', '{', '}', ',', ';', '.', '?', ':', '<', '>', '!', '='];
  function lex(src) {
    const out = []; let i = 0; const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '\n') { out.push({ k: 'nl' }); i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
        out.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1, s = '';
        while (j < n && src[j] !== c) { if (src[j] === '\\' && j + 1 < n) { j++; s += src[j] === 'n' ? '\n' : src[j]; } else s += src[j]; j++; }
        if (j >= n) throw new Error('文字列が閉じていません');
        out.push({ k: 'str', v: s }); i = j + 1; continue;
      }
      if (/[A-Za-z_$À-￿]/.test(c)) {
        const m = /^[A-Za-z_$À-￿][\w$À-￿]*/.exec(src.slice(i));
        out.push({ k: 'id', v: m[0] }); i += m[0].length; continue;
      }
      const p = PUNCT.find((q) => src.startsWith(q, i));
      if (!p) throw new Error(`読めない文字: ${c}`);
      out.push({ k: 'p', v: p }); i += p.length;
    }
    out.push({ k: 'eof' });
    return out;
  }

  // ---------------------------------------------------------------- parser (Pratt)
  const BIN = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 7 };
  function parse(src) {
    const tk = lex(src); let pos = 0;
    const peek = () => tk[pos];
    const isP = (v) => tk[pos].k === 'p' && tk[pos].v === v;
    const isId = (v) => tk[pos].k === 'id' && tk[pos].v === v;
    const skipNl = () => { while (tk[pos].k === 'nl') pos++; };
    const eat = (v) => { skipNl(); if (!isP(v)) throw new Error(`「${v}」が必要です`); pos++; };
    const endStmt = () => { while (tk[pos].k === 'nl' || isP(';')) pos++; };

    function block() {
      skipNl();
      if (isP('{')) { pos++; const body = []; endStmt(); while (!isP('}')) { if (peek().k === 'eof') throw new Error('「}」が必要です'); body.push(stmt()); endStmt(); } pos++; return { t: 'block', body }; }
      return stmt();
    }
    function stmt() {
      skipNl();
      if (isId('var') || isId('let') || isId('const')) {
        pos++; const decl = [];
        for (;;) {
          skipNl(); const id = peek(); if (id.k !== 'id') throw new Error('変数名が必要です'); pos++;
          let init = null; if (isP('=')) { pos++; init = expr(); }
          decl.push([id.v, init]);
          if (isP(',')) { pos++; continue; }
          break;
        }
        return { t: 'decl', decl };
      }
      if (isId('if')) {
        pos++; eat('('); const c = expr(); eat(')'); const a = block(); let b = null;
        const save = pos; endStmt();
        if (isId('else')) { pos++; b = block(); } else pos = save;
        return { t: 'if', c, a, b };
      }
      if (isId('return')) { pos++; return { t: 'ret', e: expr() }; }
      if (isP('{')) return block();
      return { t: 'expr', e: expr() };
    }
    function expr() {
      skipNl();
      // assignment to a plain variable
      if (peek().k === 'id' && tk[pos + 1].k === 'p' && ['=', '+=', '-=', '*=', '/='].includes(tk[pos + 1].v)) {
        const name = peek().v, op = tk[pos + 1].v; pos += 2; const e = expr();
        return { t: 'assign', name, op, e };
      }
      const c = binary(0);
      if (isP('?')) { pos++; const a = expr(); eat(':'); const b = expr(); return { t: 'cond', c, a, b }; }
      return c;
    }
    function binary(minPrec) {
      let left = unary();
      for (;;) {
        const tok = peek();
        if (tok.k !== 'p') break;
        const prec = BIN[tok.v];
        if (!prec || prec <= minPrec) break;
        pos++;
        const right = tok.v === '**' ? binary(prec - 1) : binary(prec);
        left = { t: 'bin', op: tok.v, a: left, b: right };
      }
      return left;
    }
    function unary() {
      skipNl();
      if (isP('-')) { pos++; return { t: 'neg', e: unary() }; }
      if (isP('+')) { pos++; return unary(); }
      if (isP('!')) { pos++; return { t: 'not', e: unary() }; }
      return postfix();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (isP('.')) { pos++; const id = peek(); if (id.k !== 'id') throw new Error('名前が必要です'); pos++; e = { t: 'mem', o: e, name: id.v }; }
        else if (isP('[')) { pos++; const i = expr(); eat(']'); e = { t: 'idx', o: e, i }; }
        else if (isP('(')) {
          pos++; const args = []; skipNl();
          if (!isP(')')) for (;;) { args.push(expr()); skipNl(); if (isP(',')) { pos++; continue; } break; }
          eat(')'); e = { t: 'call', f: e, args };
        } else break;
      }
      return e;
    }
    function primary() {
      skipNl();
      const tok = peek();
      if (tok.k === 'num') { pos++; return { t: 'lit', v: tok.v }; }
      if (tok.k === 'str') { pos++; return { t: 'lit', v: tok.v }; }
      if (tok.k === 'id') {
        pos++;
        if (tok.v === 'true') return { t: 'lit', v: true };
        if (tok.v === 'false') return { t: 'lit', v: false };
        if (tok.v === 'null' || tok.v === 'undefined') return { t: 'lit', v: null };
        return { t: 'var', name: tok.v };
      }
      if (isP('(')) { pos++; const e = expr(); eat(')'); return e; }
      if (isP('[')) {
        pos++; const items = []; skipNl();
        if (!isP(']')) for (;;) { items.push(expr()); skipNl(); if (isP(',')) { pos++; skipNl(); if (isP(']')) break; continue; } break; }
        eat(']'); return { t: 'arr', items };
      }
      throw new Error(tok.k === 'eof' ? '式が途中で終わっています' : `ここでは使えません: ${tok.v === undefined ? '改行' : tok.v}`);
    }
    const body = []; endStmt();
    while (peek().k !== 'eof') { body.push(stmt()); endStmt(); }
    return body;
  }

  // ---------------------------------------------------------------- evaluator
  const isVec = U.isArr;
  const zip = (a, b, f) => {
    if (isVec(a) && isVec(b)) { const n = Math.max(a.length, b.length), o = new Array(n); for (let i = 0; i < n; i++) o[i] = f(a[i] || 0, b[i] || 0); return o; }
    if (isVec(a)) return a.map((x) => f(x, b));
    if (isVec(b)) return b.map((x) => f(a, x));
    return f(a, b);
  };
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? +v : isVec(v) ? +v[0] || 0 : parseFloat(v) || 0);
  const RET = { ret: true };

  function evalNode(n, env) {
    switch (n.t) {
      case 'lit': return n.v;
      case 'var': {
        if (n.name in env.vars) return env.vars[n.name];
        const g = env.lib[n.name];
        if (g === undefined) throw new Error(`「${n.name}」は使えません`);
        return typeof g === 'object' && g !== null && g.__lazy ? g.get() : g;
      }
      case 'arr': return n.items.map((e) => { const v = evalNode(e, env); return typeof v === 'number' ? v : num(v); });
      case 'neg': { const v = evalNode(n.e, env); return isVec(v) ? v.map((x) => -x) : -num(v); }
      case 'not': return !evalNode(n.e, env);
      case 'cond': return evalNode(n.c, env) ? evalNode(n.a, env) : evalNode(n.b, env);
      case 'assign': {
        let v = evalNode(n.e, env);
        if (n.op !== '=') { const cur = n.name in env.vars ? env.vars[n.name] : 0; v = arith(n.op[0], cur, v); }
        env.vars[n.name] = v; return v;
      }
      case 'bin': {
        if (n.op === '&&') { const a = evalNode(n.a, env); return a ? evalNode(n.b, env) : a; }
        if (n.op === '||') { const a = evalNode(n.a, env); return a ? a : evalNode(n.b, env); }
        const a = evalNode(n.a, env), b = evalNode(n.b, env);
        switch (n.op) {
          case '==': case '===': return isVec(a) || isVec(b) ? U.veq(a, b) : a === b;
          case '!=': case '!==': return isVec(a) || isVec(b) ? !U.veq(a, b) : a !== b;
          case '<': return num(a) < num(b);
          case '>': return num(a) > num(b);
          case '<=': return num(a) <= num(b);
          case '>=': return num(a) >= num(b);
          default: return arith(n.op, a, b);
        }
      }
      case 'mem': {
        const o = evalNode(n.o, env);
        if (isVec(o) || typeof o === 'string') { if (n.name === 'length') return o.length; throw new Error(`「.${n.name}」は使えません`); }
        if (o && typeof o === 'object' && o.__host) { const v = o.get(n.name); if (v === undefined) throw new Error(`「.${n.name}」は使えません`); return v; }
        throw new Error(`「.${n.name}」は使えません`);
      }
      case 'idx': {
        const o = evalNode(n.o, env), i = evalNode(n.i, env);
        if (isVec(o) || typeof o === 'string') { const v = o[num(i) | 0]; return v === undefined ? 0 : v; }
        throw new Error('[ ] は配列にだけ使えます');
      }
      case 'call': {
        const f = evalNode(n.f, env);
        if (typeof f !== 'function') throw new Error('関数ではありません');
        const args = n.args.map((a) => evalNode(a, env));
        return f.apply(null, args);
      }
      default: throw new Error('式を評価できません');
    }
  }
  function arith(op, a, b) {
    if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return String(a) + String(b);
    if (!isVec(a)) a = num(a);
    if (!isVec(b)) b = num(b);
    switch (op) {
      case '+': return zip(a, b, (x, y) => x + y);
      case '-': return zip(a, b, (x, y) => x - y);
      case '*': return zip(a, b, (x, y) => x * y);
      case '/': return zip(a, b, (x, y) => x / y);
      case '%': return zip(a, b, (x, y) => x % y);
      case '**': return zip(a, b, (x, y) => x ** y);
      default: throw new Error('演算子が使えません');
    }
  }
  function runBody(body, env) {
    let last;
    for (const s of body) { const r = runStmt(s, env); if (r === RET) return RET; if (r !== undefined) last = r; env.last = last; }
    return last;
  }
  function runStmt(s, env) {
    switch (s.t) {
      case 'decl': for (const [name, init] of s.decl) env.vars[name] = init ? evalNode(init, env) : 0; return undefined;
      case 'if': return runBlock(evalNode(s.c, env) ? s.a : s.b, env);
      case 'block': return runBody(s.body, env);
      case 'ret': env.last = evalNode(s.e, env); return RET;
      case 'expr': return evalNode(s.e, env);
      default: return undefined;
    }
  }
  function runBlock(b, env) { return b ? runStmt(b, env) : undefined; }

  // ---------------------------------------------------------------- the library
  const host = (get) => ({ __host: true, get });
  const fn1 = (f) => (v) => (isVec(v) ? v.map(f) : f(num(v)));
  const MATH = (() => {
    const o = Object.create(null);
    for (const k of ['abs', 'floor', 'ceil', 'round', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'sign', 'trunc']) o[k] = (x) => Math[k](num(x));
    o.atan2 = (y, x) => Math.atan2(num(y), num(x));
    o.pow = (a, b) => Math.pow(num(a), num(b));
    o.min = (...a) => Math.min(...a.map(num));
    o.max = (...a) => Math.max(...a.map(num));
    o.PI = Math.PI; o.E = Math.E;
    return host((name) => o[name]);
  })();
  const interp = (shape) => (t, a, b, v1, v2) => {
    if (v1 === undefined) { v1 = a; v2 = b; a = 0; b = 1; }                // linear(t, value1, value2)
    t = num(t); a = num(a); b = num(b);
    let u = b === a ? (t >= b ? 1 : 0) : U.clamp((t - a) / (b - a), 0, 1);
    u = shape(u);
    return zip(v1, v2, (x, y) => x + (y - x) * u);
  };
  const vlen = (a, b) => { if (b !== undefined) a = arith('-', a, b); return isVec(a) ? Math.hypot(...a) : Math.abs(num(a)); };

  function library(frame, layer, path, prop, t, value) {
    const lib = Object.create(null);
    const comp = frame.comp;
    const seedBase = U.hashStr(layer.id + path);
    let seed = 0, timeless = false, calls = 0, now = t;
    const rnd = () => U.hash1((timeless ? 0 : Math.round(now * comp.fps)) * 7919 + (calls++) * 104729 + seed * 31, seedBase);
    const keyed = () => (prop.k && prop.k.length ? prop.k : null);
    const atTime = (tt) => M.evalProp(prop, frame.lt(layer, num(tt)));
    const wig = (freq, amp, oct = 1, mult = 0.5, tt = now) => {
      freq = num(freq); oct = Math.max(1, Math.min(6, num(oct) | 0)); mult = num(mult); tt = num(tt);
      const one = (dim) => { let s = 0, a = 1, f = freq; for (let o = 0; o < oct; o++) { s += a * U.noise1(tt * f + dim * 37.7 + o * 11.3, seedBase + dim * 101 + seed * 13); a *= mult; f *= 2; } return s; };
      const base = tt === now ? value : atTime(tt);
      if (isVec(base)) return base.map((x, i) => x + one(i) * (isVec(amp) ? num(amp[i]) : num(amp)));
      return base + one(0) * num(amp);
    };
    const loop = (dirOut) => (type = 'cycle') => {
      const k = keyed(); if (!k || k.length < 2) return value;
      const t0 = k[0].t, t1 = k[k.length - 1].t, span = t1 - t0;
      if (span <= 0 || (dirOut ? now <= t1 : now >= t0)) return value;
      const d = dirOut ? now - t0 : t1 - now, n = Math.floor(d / span), r = d - n * span;
      const fwd = (x) => M.evalKeys(prop, dirOut ? t0 + x : t1 - x);
      if (type === 'pingpong') return fwd(n % 2 ? span - r : r);
      if (type === 'offset') return zip(fwd(r), zip(dirOut ? k[k.length - 1].v : k[0].v, dirOut ? k[0].v : k[k.length - 1].v, (a, b) => a - b), (a, b) => a + b * n);
      if (type === 'continue') {
        const e = 1 / comp.fps, a = dirOut ? M.evalKeys(prop, t1) : M.evalKeys(prop, t0), b = dirOut ? M.evalKeys(prop, t1 - e) : M.evalKeys(prop, t0 + e);
        const dt = dirOut ? now - t1 : t0 - now;
        return zip(a, b, (x, y) => x + (x - y) / e * dt);
      }
      return fwd(r);
    };
    const layerObj = (L) => {
      const tr = (name) => (L.tr ? frame.val(L, 'tr.' + name, now) : 0);
      const transform = host((n) => ({ position: () => tr('p'), anchorPoint: () => tr('a'), scale: () => tr('s'), rotation: () => tr('r'), opacity: () => tr('o') }[n] || (() => undefined))());
      return host((n) => {
        switch (n) {
          case 'name': return L.name;
          case 'index': return comp.layers.indexOf(L) + 1;
          case 'inPoint': return L.in;
          case 'outPoint': return L.out;
          case 'startTime': return L.start;
          case 'width': return L.d.w || 0;
          case 'height': return L.d.h || 0;
          case 'hasParent': return !!L.parent;
          case 'parent': { const p = L.parent && frame.layer(L.parent); if (!p) throw new Error('親がありません'); return layerObj(p); }
          case 'transform': return transform;
          case 'position': case 'anchorPoint': case 'scale': case 'rotation': case 'opacity': return transform.get(n);
          case 'toComp': return (pt) => U.mApply(frame.world(L, now), num(pt[0]), num(pt[1]));
          default: return undefined;
        }
      });
    };
    const self = layerObj(layer);
    Object.assign(lib, {
      time: { __lazy: true, get: () => now }, value, index: comp.layers.indexOf(layer) + 1,
      thisLayer: self, transform: self.get('transform'), Math: MATH,
      thisComp: host((n) => {
        switch (n) {
          case 'width': return comp.w;
          case 'height': return comp.h;
          case 'duration': return comp.dur;
          case 'frameDuration': return 1 / comp.fps;
          case 'numLayers': return comp.layers.length;
          case 'layer': return (q) => { const L = typeof q === 'number' ? comp.layers[q - 1] : comp.layers.find((l) => l.name === q); if (!L) throw new Error(`レイヤー「${q}」がありません`); return layerObj(L); };
          default: return undefined;
        }
      }),
      wiggle: wig, loopOut: loop(true), loopIn: loop(false), valueAtTime: atTime,
      linear: interp((u) => u), ease: interp((u) => u * u * (3 - 2 * u)), easeIn: interp((u) => u * u), easeOut: interp((u) => 1 - (1 - u) * (1 - u)),
      clamp: (v, a, b) => zip(zip(v, a, Math.max), b, Math.min),
      random: (a, b) => { const r = rnd(); if (a === undefined) return r; if (b === undefined) return isVec(a) ? a.map((x) => x * rnd()) : num(a) * r; return isVec(a) ? a.map((x, i) => x + ((isVec(b) ? b[i] : b) - x) * rnd()) : num(a) + (num(b) - num(a)) * r; },
      gaussRandom: (a = 0, b = 1) => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return num(a) + (num(b) - num(a)) * (s / 6); },
      seedRandom: (s, tl = false) => { seed = num(s) | 0; timeless = !!tl; calls = 0; return 0; },
      noise: (v) => (isVec(v) ? U.noise1(num(v[0]) + num(v[1] || 0) * 57.3, seedBase) : U.noise1(num(v), seedBase)),
      posterizeTime: (fps) => { fps = num(fps); if (fps > 0) { now = Math.floor(t * fps + 1e-6) / fps; lib.value = value = atTime(now); } return 0; },
      length: vlen, add: (a, b) => arith('+', a, b), sub: (a, b) => arith('-', a, b), mul: (a, b) => arith('*', a, b), div: (a, b) => arith('/', a, b),
      normalize: (v) => { const l = vlen(v) || 1; return isVec(v) ? v.map((x) => x / l) : 1; },
      dot: (a, b) => (isVec(a) && isVec(b) ? a.reduce((s, x, i) => s + x * (b[i] || 0), 0) : num(a) * num(b)),
      degreesToRadians: (d) => num(d) * Math.PI / 180, radiansToDegrees: (r) => num(r) * 180 / Math.PI,
      timeToFrames: (tt = now) => Math.round(num(tt) * comp.fps), framesToTime: (f) => num(f) / comp.fps,
      abs: fn1(Math.abs), floor: fn1(Math.floor), ceil: fn1(Math.ceil), round: fn1(Math.round), sin: fn1(Math.sin), cos: fn1(Math.cos), sqrt: fn1(Math.sqrt),
      min: (...a) => Math.min(...a.map(num)), max: (...a) => Math.max(...a.map(num)), PI: Math.PI,
    });
    return lib;
  }

  // ---------------------------------------------------------------- entry points
  const compiled = new Map();
  X.errors = new Map();                         // layerId|path -> message, for the inspector to show
  X.compile = (src) => {
    let c = compiled.get(src);
    if (!c) {
      try { c = { body: parse(src) }; } catch (e) { c = { error: e.message }; }
      if (compiled.size > 400) compiled.clear();
      compiled.set(src, c);
    }
    return c;
  };
  X.check = (src) => X.compile(src).error || null;
  // the result is coerced back to the property's own shape, so a slip in an expression can't break the renderer
  X.run = (frame, layer, path, prop, t, value) => {
    const c = X.compile(prop.x), key = layer.id + '|' + path;
    if (c.error) { X.errors.set(key, c.error); return value; }
    try {
      const env = { vars: Object.create(null), lib: library(frame, layer, path, prop, t, value), last: undefined };
      runBody(c.body, env);
      let r = env.last;
      if (r === undefined || r === null) throw new Error('式が値を返していません');
      if (isVec(value)) {
        if (!isVec(r)) r = value.map(() => num(r));
        else if (r.length < value.length) r = value.map((x, i) => (i < r.length ? num(r[i]) : x));
        else r = r.slice(0, value.length).map(num);
        if (r.some((x) => !isFinite(x))) throw new Error('数にならない値です');
      } else {
        r = num(r);
        if (!isFinite(r)) throw new Error('数にならない値です');
      }
      if (X.errors.has(key)) X.errors.delete(key);
      return r;
    } catch (e) {
      X.errors.set(key, e.message || String(e));
      return value;
    }
  };
  X.PRESETS = [
    ['ゆらす', 'wiggle(2, 30)'],
    ['くり返す', 'loopOut("cycle")'],
    ['行って戻る', 'loopOut("pingpong")'],
    ['回り続ける', 'time * 90'],
    ['点滅', 'Math.sin(time * 8) > 0 ? 100 : 0'],
    ['コマ落としでゆらす', 'posterizeTime(8); wiggle(8, 40)'],
  ];
})();
