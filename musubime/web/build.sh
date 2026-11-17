#!/bin/sh
# Builds the browser preview: each project's C (src/) to WebAssembly with clang, embedded in one page.
#   web/build.sh   ->  app.html (the page's body, as the other apps in this repository) and index.html
# Needs clang with the wasm32 target and wasm-ld (no Emscripten, no libc).
set -e
cd "$(dirname "$0")/.."
OUT=web/build
mkdir -p "$OUT"
for p in e1_kuzushi e2_henka e3_sen e4_feldman e5_pmvrs e6_tekiou e7_ruten e8_rendo; do
  clang --target=wasm32 -O2 -nostdlib -ffp-contract=off -fno-builtin -Wall -Wextra -Wno-unused-parameter -Werror \
    -Isrc -Wl,--no-entry -Wl,--initial-memory=4194304 -Wl,-z,stack-size=131072 \
    -o "$OUT/$p.wasm" src/shell.c src/body.c src/scr.c "src/$p.c" web/hw_web.c
done
python3 - <<'PY'
import base64, json, pathlib
root = pathlib.Path(".")
wasm = {p.stem: base64.b64encode(p.read_bytes()).decode() for p in sorted((root / "web/build").glob("*.wasm"))}
page = (root / "web/page.html").read_text()
worklet = (root / "web/worklet.js").read_text()
page = page.replace("/*WASM*/", "const WASM = " + json.dumps(wasm) + ";")
page = page.replace("/*WORKLET*/", "const WORKLET_SRC = " + json.dumps(worklet) + ";")
(root / "app.html").write_text(page)
head = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">\n'
(root / "index.html").write_text(head + page + "\n</body></html>\n")
print("app.html", len(page), "bytes;", ", ".join(f"{k} {len(v)*3//4} B" for k, v in wasm.items()))
PY
