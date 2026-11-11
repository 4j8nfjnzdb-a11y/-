#!/bin/sh
# Wraps app.html (artifact body) into a standalone page for direct browser use.
cd "$(dirname "$0")"
{ printf '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">\n'; cat app.html; printf '\n</body></html>\n'; } > index.html
