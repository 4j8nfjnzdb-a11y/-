// Builds the browser prototype: compiles the C core to WebAssembly and assembles app.html.
// Usage: node tools/build.mjs   (needs clang with the wasm32 target)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
mkdirSync(join(ROOT, 'build'), { recursive: true });
const wasmPath = join(ROOT, 'build/danchi.wasm');
execFileSync('clang', [
  '--target=wasm32', '-O2', '-nostdlib', '-ffreestanding', '-fno-math-errno', '-mnontrapping-fptoint', '-mbulk-memory',
  '-std=c11', '-Wall', '-Wextra', '-Wdouble-promotion', '-Wfloat-conversion', '-Werror',
  '-Wl,--no-entry', '-Wl,--initial-memory=1048576', '-Wl,-z,stack-size=65536', '-Wl,--strip-all',
  'core/danchi.c', 'core/dn_disp.c', 'core/dn_wasm.c', '-o', wasmPath,
], { cwd: ROOT, stdio: 'inherit' });
const wasm = readFileSync(wasmPath);

// Fallback for pages where WebAssembly may not be compiled: the same compiled core, translated to
// plain JS by binaryen's wasm2js (bit-identical output, much slower). Skipped if wasm2js is unavailable.
let jsCore = '';
try {
  const jsPath = join(ROOT, 'build/danchi.wasm.js');
  execFileSync('npx', ['--yes', '-p', 'binaryen@116.0.0', 'wasm2js', wasmPath, '-O2', '--enable-bulk-memory',
    '--enable-nontrapping-float-to-int', '-o', jsPath], { cwd: ROOT, stdio: 'pipe' });
  const src = readFileSync(jsPath, 'utf8');
  const cut = src.indexOf('var retasmFunc');
  if (cut < 0) throw new Error('unexpected wasm2js output');
  jsCore = `function DANCHI_JS() {\n${src.slice(0, cut)}\nreturn asmFunc;\n}`;
} catch (e) {
  console.warn('wasm2js fallback not built:', e.message.split('\n')[0]);
}

// view indices come straight from danchi.h, so C and JS cannot disagree
const defs = {};
for (const m of rd('core/danchi.h').matchAll(/^#define\s+(\w+)\s+([^\n/]+?)\s*(?:\/\*.*)?$/gm)) {
  if (!/^[\w\s()+*\-]+$/.test(m[2])) continue;
  const expr = m[2].replace(/[A-Za-z_]\w*/g, (n) => (n in defs ? String(defs[n]) : 'NaN'));
  const v = Function(`return (${expr})`)();
  if (Number.isFinite(v)) defs[m[1]] = v;
}
const DN = Object.fromEntries(Object.entries(defs).filter(([k]) => /^(V_|T_|O_|L_)/.test(k)));

const html = `<title>団地 DANCHI</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Zen+Kaku+Gothic+New:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
${rd('src/style.css')}
</style>
${rd('src/body.html')}
${jsCore ? `<script>\n${jsCore}\n</script>` : ''}
<script>
const DN = ${JSON.stringify(DN)};
const WASM_B64 = "${wasm.toString('base64')}";
const WORKLET_SRC = ${JSON.stringify(rd('src/worklet.js'))};
${rd('src/ui.js')}
</script>
`;
writeFileSync(join(ROOT, 'app.html'), html);
console.log(`danchi.wasm ${(wasm.length / 1024).toFixed(1)} KB, JS fallback ${(jsCore.length / 1024).toFixed(0)} KB, app.html ${(html.length / 1024).toFixed(0)} KB, ${Object.keys(DN).length} view indices`);
