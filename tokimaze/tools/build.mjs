// Assembles app.html (the artifact body) from src/. Usage: node tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const html = `<title>Tokimaze 溶き混ぜ</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@600&family=Zen+Maru+Gothic:wght@400;500;700&display=swap">
<style>
${rd('src/style.css')}
</style>
${rd('src/body.html')}
<script>
${rd('src/km.js')}
${rd('src/shaders.js')}
${rd('src/liquid.js')}
${rd('src/world.js')}
${rd('src/ui.js')}
</script>
`;
writeFileSync(join(ROOT, 'app.html'), html);
console.log(`app.html ${(html.length / 1024).toFixed(0)} KB`);
