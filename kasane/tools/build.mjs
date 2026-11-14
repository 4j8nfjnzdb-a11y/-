// Assembles app.html (the artifact body) from src/. Usage: node tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const JS = ['util', 'model', 'expr', 'sound', 'gl', 'effects', 'raster', 'render', 'state', 'media', 'export', 'ui', 'viewer', 'timeline', 'inspector', 'main'];
const html = `<title>Kasane 重ね</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Murecho:wght@400;500;700&family=M+PLUS+1+Code:wght@400;500&family=Zen+Kurenaido&display=swap">
<style>
${rd('src/style.css')}
</style>
${rd('src/body.html')}
<script>
${JS.map((f) => rd(`src/${f}.js`)).join('\n')}
</script>
`;
writeFileSync(join(ROOT, 'app.html'), html);
console.log(`app.html ${(html.length / 1024).toFixed(0)} KB`);
