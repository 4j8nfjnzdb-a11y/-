// Assembles app.html (the artifact body) from src/. Usage: node tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const html = `<title>Sawari 触り</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@700&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${rd('src/style.css')}
</style>
${rd('src/body.html')}
<script>
${['core', 'codec', 'world', 'audio', 'draw', 'app', 'panels', 'input'].map(n => rd(`src/${n}.js`)).join('\n')}
</script>
`;
writeFileSync(join(ROOT, 'app.html'), html);
console.log(`app.html ${(html.length / 1024).toFixed(0)} KB`);
