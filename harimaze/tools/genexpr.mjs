// Translates the GenExpr subset used by the harimaze machines into plain
// JavaScript, so the exact code inside the Max gen~ codeboxes can be tested
// offline and run in the browser lab.
//
// The subset: Buffer / Data / History / Param declarations at the top,
// then statements (assignments, if / else if / else, for loops) using the
// gen operators listed in FUNCS. The checks below enforce the conventions
// the codeboxes rely on: every local is first assigned at the top level
// (so gen's block scoping never hides it), nothing is read before it is
// assigned, Params are never written, and no name shadows a gen operator.

const FUNCS = new Set([
  'floor', 'ceil', 'abs', 'sign', 'min', 'max', 'clamp', 'wrap', 'fold', 'mix',
  'pow', 'exp', 'sqrt', 'sin', 'cos', 'tanh', 'noise', 'mstosamps',
  'peek', 'poke', 'dim', 'channels',
]);
const KEYWORDS = new Set(['if', 'else', 'for', 'return']);
const CONSTS = { samplerate: 'SR', twopi: 'TWOPI', pi: 'PI' };

// gen operator and keyword names a variable must not take
const GEN_OPS = new Set([
  ...FUNCS, ...Object.keys(CONSTS), ...KEYWORDS,
  'add', 'sub', 'mul', 'div', 'mod', 'neg', 'not', 'and', 'or', 'xor', 'gt', 'lt', 'eq', 'neq',
  'gte', 'lte', 'absdiff', 'rsub', 'rdiv', 'pass', 'int', 'bool', 'float', 'trunc', 'round', 'fract',
  'phasor', 'cycle', 'train', 'triangle', 'rate', 'delta', 'change', 'latch', 'sah', 'gate', 'selector',
  'switch', 'counter', 'accum', 'plusequals', 'mulequals', 'history', 'delay', 'slide', 'dcblock',
  'elapsed', 'vectorsize', 'fixdenorm', 'fixnan', 'isdenorm', 'isnan', 'step', 'smoothstep', 'scale',
  'clip', 'sample', 'lookup', 'wave', 'buffer', 'data', 'in', 'out', 'param', 'e', 'halfpi', 'invpi',
  'degrees', 'radians', 'ln', 'log', 'log2', 'log10', 'exp2', 'atan', 'atan2', 'tan', 'asin', 'acos',
  'sinh', 'cosh', 'hypot', 'mtof', 'ftom', 'atodb', 'dbtoa', 'sampstoms', 't60', 't60time', 'interp',
  'noise', 'poltocar', 'cartopol', 'constant', 'expr', 'send', 'receive', 'voice', 'mc_channel',
]);

export function parse(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const decl = { buffers: [], datas: [], histories: [], params: [] };
  let body = code;
  body = body.replace(/^\s*Buffer\s+(\w+)\s*\(\s*"([^"]+)"\s*\)\s*;/gm, (_, n, b) => { decl.buffers.push({ name: n, buffer: b }); return ''; });
  body = body.replace(/^\s*Data\s+(\w+)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*;/gm, (_, n, f, c) => { decl.datas.push({ name: n, frames: +f, channels: +c }); return ''; });
  body = body.replace(/^\s*History\s+(\w+)\s*\(\s*(-?[\d.]+)\s*\)\s*;/gm, (_, n, v) => { decl.histories.push({ name: n, init: +v }); return ''; });
  body = body.replace(/^\s*Param\s+(\w+)\s*\(\s*(-?[\d.]+)\s*\)\s*;/gm, (_, n, v) => { decl.params.push({ name: n, def: +v }); return ''; });
  if (/\b(Buffer|Data|History|Param|Delay)\b/.test(body)) throw new Error('declaration not at the top or in an unsupported form');
  return { decl, body };
}

function braceDepthAt(body, index) {
  let d = 0;
  for (let i = 0; i < index; i++) { if (body[i] === '{') d++; else if (body[i] === '}') d--; }
  return d;
}

export function check(src) {
  const { decl, body } = parse(src);
  const errors = [];
  const hist = new Set(decl.histories.map(h => h.name));
  const params = new Set(decl.params.map(p => p.name));
  const bufs = new Set([...decl.buffers.map(b => b.name), ...decl.datas.map(d => d.name)]);
  const all = [...hist, ...params, ...bufs];
  for (const n of all) if (GEN_OPS.has(n)) errors.push(`declared name "${n}" shadows a gen operator`);
  if (new Set(all).size !== all.length) errors.push('duplicate declaration name');

  // locals = assignment targets that are not declared names or outputs
  const locals = new Set();
  for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=|=(?!=))/g)) {
    const n = m[1];
    if (params.has(n)) errors.push(`Param "${n}" is assigned`);
    if (hist.has(n) || params.has(n) || /^out\d+$/.test(n) || KEYWORDS.has(n)) continue;
    locals.add(n);
  }
  for (const n of locals) {
    if (GEN_OPS.has(n)) errors.push(`local "${n}" shadows a gen operator`);
    const first = body.search(new RegExp(`\\b${n}\\b`));
    const after = body.slice(first + n.length);
    if (!/^\s*=(?!=)/.test(after)) errors.push(`local "${n}" is read before it is assigned`);
    if (braceDepthAt(body, first) !== 0) errors.push(`local "${n}" is first assigned inside a block`);
  }
  // every identifier must be known
  for (const m of body.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
    const n = m[1];
    if (KEYWORDS.has(n) || CONSTS[n] || locals.has(n) || hist.has(n) || params.has(n) || bufs.has(n)) continue;
    if (/^(in|out)\d+$/.test(n)) continue;
    if (FUNCS.has(n)) { if (!/^\s*\(/.test(body.slice(m.index + n.length))) errors.push(`operator "${n}" used without a call`); continue; }
    errors.push(`unknown identifier "${n}"`);
  }
  // balanced braces and parentheses
  for (const [o, c] of [['{', '}'], ['(', ')']]) {
    let d = 0; for (const ch of body) { if (ch === o) d++; else if (ch === c) d--; if (d < 0) break; }
    if (d !== 0) errors.push(`unbalanced ${o}${c}`);
  }
  // every statement line ends with ; { or }
  body.split('\n').forEach((line, k) => {
    const t = line.trim();
    if (t && !/[;{}]$/.test(t)) errors.push(`line ${k + 1} does not end a statement: ${t}`);
  });
  // highest in / out used
  let nin = 0, nout = 0;
  for (const m of body.matchAll(/\bin(\d+)\b/g)) nin = Math.max(nin, +m[1]);
  for (const m of body.matchAll(/\bout(\d+)\b/g)) nout = Math.max(nout, +m[1]);
  return { errors: [...new Set(errors)], decl, body, locals: [...locals], nin, nout };
}

// Returns JS source of `function(SR){...}` that builds a machine instance.
export function translate(src) {
  const r = check(src);
  if (r.errors.length) throw new Error(r.errors.join('\n'));
  const { decl, body, locals, nin } = r;
  const hist = new Set(decl.histories.map(h => h.name));
  const params = new Set(decl.params.map(p => p.name));
  const bufs = new Set([...decl.buffers.map(b => b.name), ...decl.datas.map(d => d.name)]);
  const js = body.replace(/\b([A-Za-z_]\w*)\b/g, (n) => {
    if (KEYWORDS.has(n) || locals.includes(n)) return n;
    if (CONSTS[n]) return CONSTS[n];
    if (hist.has(n)) return `S.${n}`;
    if (params.has(n)) return `P.${n}`;
    if (bufs.has(n)) return `B.${n}`;
    if (/^in\d+$/.test(n)) return n;
    const o = n.match(/^out(\d+)$/); if (o) return `O[${+o[1] - 1}]`;
    if (FUNCS.has(n)) return `G.${n}`;
    throw new Error('unexpected identifier ' + n);
  });
  const ins = Array.from({ length: Math.max(nin, 2) }, (_, k) => `in${k + 1}`).join(',');
  return `function(SR){
const PI=Math.PI,TWOPI=2*Math.PI;
const G={floor:Math.floor,ceil:Math.ceil,abs:Math.abs,sign:Math.sign,min:Math.min,max:Math.max,pow:Math.pow,exp:Math.exp,sqrt:Math.sqrt,sin:Math.sin,cos:Math.cos,tanh:Math.tanh,
clamp:(x,a,b)=>x<a?a:(x>b?b:x),
wrap:(x,a,b)=>{const r=b-a;if(!(r>0))return a;let y=(x-a)%r;if(y<0)y+=r;return y+a},
fold:(x,a,b)=>{const r=b-a;if(!(r>0))return a;let y=(x-a)%(2*r);if(y<0)y+=2*r;return a+(y>r?2*r-y:y)},
mix:(a,b,t)=>a+(b-a)*t,
noise:()=>Math.random()*2-1,
mstosamps:ms=>ms*SR/1000,
peek:(B,i,c)=>{i=Math.floor(i);c=Math.floor(c);if(i<0||i>=B.frames||c<0||c>=B.channels)return 0;return B.data[c][i]},
poke:(B,v,i,c)=>{i=Math.floor(i);c=Math.floor(c);if(i<0||i>=B.frames||c<0||c>=B.channels)return;B.data[c][i]=v},
dim:B=>B.frames,channels:B=>B.channels};
const S={${decl.histories.map(h => `${h.name}:${h.init}`).join(',')}};
const P={${decl.params.map(p => `${p.name}:${p.def}`).join(',')}};
const empty=()=>({frames:0,channels:1,data:[new Float32Array(0)]});
const B={${[...decl.buffers.map(b => `${b.name}:empty()`), ...decl.datas.map(d => `${d.name}:{frames:${d.frames},channels:${d.channels},data:Array.from({length:${d.channels}},()=>new Float64Array(${d.frames}))}`)].join(',')}};
const O=[0,0,0,0];
function tick(${ins}){
let ${locals.map(n => `${n}=0`).join(',')};
${js}
}
return {S,P,B,O,tick,buffers:${JSON.stringify(Object.fromEntries(decl.buffers.map(b => [b.name, b.buffer])))}};
}`;
}
