#!/bin/sh
# Builds UNDERFLOW: the worklet (src/worklet.js) embedded in the page (src/page.html) -> app.html (the page's body, as
# the other apps in this repository) and index.html (a standalone page).
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import json, pathlib
page = pathlib.Path("src/page.html").read_text()
worklet = pathlib.Path("src/worklet.js").read_text()
page = page.replace("/*WORKLET*/", "const WORKLET_SRC = " + json.dumps(worklet) + ";")
pathlib.Path("app.html").write_text(page)
head = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">\n'
pathlib.Path("index.html").write_text(head + page + "\n</body></html>\n")
print("app.html", len(page), "bytes")
PY
