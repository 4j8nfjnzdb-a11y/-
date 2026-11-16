#!/bin/sh
# Assembles one project as an fm1-base app directory, then (optionally) builds it with fm1-base.
#   fm1/assemble.sh PROJECT                      -> fm1/build/PROJECT/ (app.c, app.h, fm1.toml, words.tsv, src/, tests/)
#   fm1/assemble.sh PROJECT host  FM1_BASE       -> and the host simulator, then its tests (no toolchain needed)
#   fm1/assemble.sh PROJECT fwsc  FM1_BASE       -> and the firmware package (JieLi toolchain + AC79 SDK: docs/INSTALL.md)
# PROJECT: kuzushi henka sen feldman pmvrs tekiou (or all).
# fm1-base only compiles sources inside the app's own directory, so the shared C (src/) is copied in.
set -e
cd "$(dirname "$0")"
FM1=$(pwd)
ROOT=$(cd .. && pwd)

one() {
  p=$1
  case $p in
    kuzushi) src=e1_kuzushi; id=FM-1_61; tag="the numbers of the sound, broken, fed back into FM" ;;
    henka)   src=e2_henka;   id=FM-1_62; tag="locks, conditions and polymeter on the inside of a sound" ;;
    sen)     src=e3_sen;     id=FM-1_63; tag="a line of single sounds, one change a pass, never back" ;;
    feldman) src=e4_feldman; id=FM-1_64; tag="nearly the same, never the same: small, quiet, sustained" ;;
    pmvrs)   src=e5_pmvrs;   id=FM-1_65; tag="five kinds of time, cut, never mixed" ;;
    tekiou)  src=e6_tekiou;  id=FM-1_66; tag="it listens to itself and rewires itself" ;;
    *) echo "unknown project: $p" >&2; exit 2 ;;
  esac
  NAME=$(echo "$p" | tr a-z A-Z)
  D="$FM1/build/$p"
  rm -rf "$D"
  mkdir -p "$D/src" "$D/tests"
  cp "$FM1/app.c" "$D/app.c"
  sed "s/@NAME@/$NAME/g" "$FM1/app.h.in" > "$D/app.h"
  sed -e "s/@NAME@/$NAME/g" -e "s/@ID@/$id/g" -e "s/@TAGLINE@/$tag/" "$FM1/fm1.toml.in" > "$D/fm1.toml"
  printf '# musubime %s: the screen'"'"'s words for a screen reader (fm1-reader)\n# url: https://example.invalid/musubime/words/\n%s\t%s\n' "$NAME" "$NAME" "$p" > "$D/words.tsv"
  cp "$ROOT/src/m.h" "$ROOT/src/hw.h" "$ROOT/src/mz.h" "$ROOT/src/par.h" "$ROOT/src/fm.h" "$ROOT/src/fmvox.h" "$ROOT/src/font5x7.h" "$D/src/"
  cp "$ROOT/src/shell.c" "$ROOT/src/body.c" "$ROOT/src/scr.c" "$ROOT/src/$src.c" "$D/src/"
  cp "$FM1/tests/$p.txt" "$D/tests/basic.txt"
  echo "assembled $D"
  case $2 in
    host)
      python3 -I "$3/tools/build.py" "$D" --host
      mkdir -p "$D/build/out"
      "$D/build/host/${p}_host" "$D/tests/basic.txt" "$D/build/out"
      ;;
    fwsc)
      python3 -I "$3/tools/build.py" "$D"
      ;;
  esac
}

if [ "$1" = all ]; then
  for p in kuzushi henka sen feldman pmvrs tekiou; do one $p "$2" "$3"; done
else
  one "$1" "$2" "$3"
fi
