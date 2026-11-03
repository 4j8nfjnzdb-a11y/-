// Assembles app.html (the artifact body) from src/, the GenExpr machines and
// a zip of the Max patches. Usage: node tools/build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { translate } from './genexpr.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const KEYS = ['tenki', 'kizu', 'mebuki', 'tsuioku', 'kiri'];

// --- deflate zip with UTF-8 names ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 3;
  for (const [name, data] of files) {
    const nb = Buffer.from(name, 'utf8'), crc = crc32(data), comp = deflateRawSync(data, { level: 9 });
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nb, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

const zfiles = [];
for (const f of readdirSync(join(ROOT, 'max')).sort()) if (f.endsWith('.maxpat') || f === 'README.md') zfiles.push([`harimaze-max/${f}`, readFileSync(join(ROOT, 'max', f))]);
for (const k of KEYS) zfiles.push([`harimaze-max/genexpr/${k}.genexpr`, readFileSync(join(ROOT, 'max/genexpr', k + '.genexpr'))]);
const zipBuf = zip(zfiles);
writeFileSync(join(ROOT, 'harimaze-max.zip'), zipBuf);

// --- machines ---
const genexpr = Object.fromEntries(KEYS.map((k) => [k, rd(`max/genexpr/${k}.genexpr`)]));
const machinesCode = `const MACHINES={\n${KEYS.map((k) => `${k}:${translate(genexpr[k])}`).join(',\n')}\n};`;
const defs = JSON.parse(rd('max/machines.json'));
const safe = (s) => s.replace(/<\//g, '<\\/');

const html = `<title>Harimaze 貼交</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@600;800&family=Zen+Kaku+Gothic+Antique:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap">
<style>
${rd('src/style.css')}
</style>
${rd('src/body.html')}
<script>
${machinesCode}
const MACHINES_SRC=${safe(JSON.stringify(machinesCode))};
const MACHINE_DEFS=${safe(JSON.stringify(defs))};
const GENEXPR=${safe(JSON.stringify(genexpr))};
const ZIP_B64="${zipBuf.toString('base64')}";
${rd('src/data.js')}
${rd('src/lab.js')}
${rd('src/main.js')}
</script>
`;
writeFileSync(join(ROOT, 'app.html'), html);
console.log(`app.html ${(html.length / 1024).toFixed(0)} KB, zip ${(zipBuf.length / 1024).toFixed(0)} KB (${zfiles.length} files)`);
