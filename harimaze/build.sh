#!/bin/sh
# Rebuilds the Max patches and app.html (artifact body), then wraps app.html
# into a standalone page for direct browser use.
cd "$(dirname "$0")"
python3 tools/make_patches.py >/dev/null && node tools/build.mjs || exit 1
{ printf '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">\n'; cat app.html; printf '\n</body></html>\n'; } > index.html
