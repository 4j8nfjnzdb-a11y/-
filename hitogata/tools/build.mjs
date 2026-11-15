// Assembles app.html (the artifact body) from src/. Usage: node tools/build.mjs
// DEV_OUT=<file> also writes a test page that loads MediaPipe and the models from /assets/.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const js = ['util.js', 'sample.js', 'detect.js', 'track.js', 'render.js', 'app.js'].map((f) => rd('src/' + f)).join('\n');
const html = `<title>ひとがた Hitogata</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=IBM+Plex+Mono:wght@400;500&family=Zen+Old+Mincho:wght@500&display=swap">
<style>
${rd('src/style.css')}
</style>
${rd('src/body.html')}
<script>
${js}
</script>
`;
writeFileSync(join(ROOT, 'app.html'), html);
console.log(`app.html ${(html.length / 1024).toFixed(0)} KB`);
if (process.env.DEV_OUT) {
  const dev = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">
<script>window.HITOGATA_ASSETS='/assets/'; window.HITOGATA_CPU=${process.env.DEV_CPU ? 'true' : 'false'};</script>
${html}</body></html>`;
  writeFileSync(process.env.DEV_OUT, dev);
}
