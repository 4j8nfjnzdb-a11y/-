#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Builds bunki/fm1/bunki (the fm1-dock module) into bunki/fm1/bunki.dock with fm1-dock's own tools.
#   bunki/fm1/build.sh            (Linux x86-64; on macOS fm1-dock's tools run the toolchain in Docker)
#   FM1_DOCK=DIR                  an fm1-dock checkout (default: bunki/fm1/build/fm1-dock, cloned here)
#   JIELI_TOOLCHAIN=DIR           JieLi's toolchain (default: ~/.jieli/toolchain, fetched by fm1-dock's
#                                 tools/get_toolchain.sh from pkgman.jieliapp.com if it is not there)
# The fm1-dock revision this was built and tested with (in fm1-emu, on fm1-dock 0.7's package):
set -e
REV=60a89df6554f6df3823f03a4c893b6715bfef9b5
HERE=$(cd "$(dirname "$0")" && pwd)
DOCK=${FM1_DOCK:-$HERE/build/fm1-dock}
if [ ! -d "$DOCK/.git" ]; then
    mkdir -p "$(dirname "$DOCK")"
    git clone https://github.com/joakimeriksson/fm1-dock "$DOCK"
fi
(cd "$DOCK" && git cat-file -e "$REV^{commit}" 2>/dev/null || git fetch origin; git checkout -q "$REV")
export JIELI_TOOLCHAIN="${JIELI_TOOLCHAIN:-$HOME/.jieli/toolchain}"
[ -x "$JIELI_TOOLCHAIN/pi32v2/bin/clang" ] || "$DOCK/tools/get_toolchain.sh" "$(dirname "$JIELI_TOOLCHAIN")"
(cd "$DOCK" && python3 tools/hbmod.py "$HERE/bunki")
cp "$DOCK/build/modules/bunki.dock" "$HERE/bunki.dock"
python3 "$DOCK/tools/hbmod.py" --info "$HERE/bunki.dock"
