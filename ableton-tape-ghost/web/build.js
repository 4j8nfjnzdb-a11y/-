const fs = require('fs');
const path = require('path');

const dir = __dirname;
const dspCore = fs.readFileSync(path.join(dir, 'dsp-core.js'), 'utf8');
const workletProc = fs.readFileSync(path.join(dir, 'worklet-processor.js'), 'utf8');
const appJs = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
let template = fs.readFileSync(path.join(dir, 'index.template.html'), 'utf8');

const workletSource = dspCore + '\n' + workletProc;

template = template.replace('__WORKLET_SOURCE__', JSON.stringify(workletSource));
template = template.replace('<script src="app.js"></script>', `<script>\n${appJs}\n</script>`);

// Fragment version: no <!doctype>/<html>/<head>/<body> of its own -- this is
// what the Artifact tool wraps in its own skeleton (which supplies charset).
fs.writeFileSync(path.join(dir, 'artifact.html'), template);
console.log('Built artifact.html (' + template.length + ' bytes)');

// Standalone version: a real, complete HTML document with its own charset
// declaration, since this file is also handed out directly for local/offline
// use (double-click open), where nothing else supplies <meta charset>. The
// fragment's <title> is pulled out into <head>; everything else (style,
// markup, script) is valid directly inside <body>.
const titleMatch = template.match(/<title>[\s\S]*?<\/title>/);
const title = titleMatch ? titleMatch[0] : '<title>Tape Ghost</title>';
const bodyContent = titleMatch ? template.replace(titleMatch[0], '') : template;
const standalone = `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${title}
</head>
<body>
${bodyContent}
</body>
</html>
`;
fs.writeFileSync(path.join(dir, 'index.html'), standalone);
console.log('Built index.html (' + standalone.length + ' bytes)');
