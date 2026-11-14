#!/bin/sh
# Builds app.html (artifact body) from src/, then wraps it into a standalone page.
cd "$(dirname "$0")"
node tools/build.mjs || exit 1
{ printf '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">\n'; cat app.html; printf '\n</body></html>\n'; } > index.html
