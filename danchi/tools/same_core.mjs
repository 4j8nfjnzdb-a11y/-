// Checks that the browser runs the same core: renders 60 s with the WebAssembly build and compares it,
// sample by sample, with the native build (tools/sim raw). Usage: node tools/same_core.mjs SIM_BINARY
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const sim = process.argv[2];
const rawPath = join(ROOT, 'build/native.raw');
execFileSync(sim, ['raw', '60', rawPath]);
const nat = new Float32Array(readFileSync(rawPath).buffer.slice(0));
const w = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(ROOT, 'build/danchi.wasm'))), {}).exports;
w.init(44100, 42);
const out = new Float32Array(nat.length);
for (let b = 0, o = 0; o < out.length; b++, o += 128) {
  w.process(128);
  out.set(new Float32Array(w.memory.buffer, w.out_l(), 128), o);
  if (b % 2000 === 0) { w.enc(1, 1); w.key(5, 1); w.key(5, 0); }
}
let diff = 0, maxd = 0;
for (let i = 0; i < out.length; i++) { const d = Math.abs(out[i] - nat[i]); if (d > 0) diff++; if (d > maxd) maxd = d; }
console.log(`native vs WebAssembly, 60 s: ${diff} of ${out.length} samples differ, max difference ${maxd}`);
process.exit(diff ? 1 : 0);
