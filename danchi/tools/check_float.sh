#!/bin/sh
# Compiles the core for a Cortex-M4F (single-precision FPU only) as a stand-in for the
# FM-1's target, and checks: no double-precision helpers or instructions, no libm calls.
# (The FM-1's actual CPU is not known here; this checks the code, not the device.)
cd "$(dirname "$0")/.."
OUT=${TMPDIR:-/tmp}/danchi_m4
mkdir -p "$OUT"
FLAGS="--target=thumbv7em-none-eabihf -mcpu=cortex-m4 -mfpu=fpv4-sp-d16 -mfloat-abi=hard -O2 -ffreestanding -fno-math-errno -std=c11 -Wall -Wextra -Wdouble-promotion -Wfloat-conversion -Werror"
fail=0
for f in danchi dn_disp; do
  clang $FLAGS -c core/$f.c -o "$OUT/$f.o" || exit 1
done
echo "undefined symbols:"
llvm-nm -u "$OUT/danchi.o" "$OUT/dn_disp.o" | grep -v ":$" | sort -u | sed 's/^/  /'
if llvm-nm -u "$OUT/danchi.o" "$OUT/dn_disp.o" | grep -E "__aeabi_d|__.*df[23]|sin|cos|exp|log|pow|sqrt|floor|tanh" ; then
  echo "FAIL: double helpers or libm calls"; fail=1
else echo "ok: no double-precision helpers, no libm"; fi
if llvm-objdump -d "$OUT/danchi.o" "$OUT/dn_disp.o" | grep -E "\.f64|vmov(\.f64)?\s+d[0-9]|vcvt\.f64|vcvt\.f32\.f64" ; then
  echo "FAIL: double-precision instructions"; fail=1
else echo "ok: no double-precision instructions"; fi
echo "sizes (text = code + constants):"
llvm-size "$OUT/danchi.o" "$OUT/dn_disp.o" | sed 's/^/  /'
exit $fail
