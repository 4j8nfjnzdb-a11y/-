#!/bin/sh
# app.html = artifact body (page markup + inlined scripts); index.html = the same wrapped as a standalone page.
cd "$(dirname "$0")"
{ cat src/page.html; printf '<script>\n'; cat src/remux.js; printf '\n'; cat src/app.js; printf '</script>\n'; } > app.html
{ printf '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">\n'; cat app.html; printf '\n</body></html>\n'; } > index.html
