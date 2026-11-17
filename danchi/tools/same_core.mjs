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
const IN = new Float32Array(w.memory.buffer, w.in_buf(), 128);
let r = 777;
const next = () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0);
for (let b = 0, o = 0; o < out.length; b++, o += 128) {
  for (let i = 0; i < 128; i++) IN[i] = (next() >>> 16) / 65536 - 0.5;
  w.process_in(128);
  out.set(new Float32Array(w.memory.buffer, w.out_l(), 128), o);
  if (b % 2000 === 0) { w.enc(1, 1); w.key(5, 1); w.key(5, 0); }
  if (b === 3000) w.btn(9, 2);
  if (b === 7000) w.btn(10, 0);
  if (b === 11000) {
    const a = new Int16Array(w.memory.buffer, w.samp_area(), 20000);
    for (let i = 0; i < 20000; i++) a[i] = (next() >>> 16) - 32768;
    w.samp_commit(20000);
  }
}
let diff = 0, maxd = 0;
for (let i = 0; i < out.length; i++) { const d = Math.abs(out[i] - nat[i]); if (d > 0) diff++; if (d > maxd) maxd = d; }
console.log(`native vs WebAssembly, 60 s (FM, then live input, a capture, a loaded sound): ${diff} of ${out.length} samples differ, max difference ${maxd}`);
process.exit(diff ? 1 : 0);
