#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# bunki.dock onto an FM-1 that runs fm1-dock, over the USB cable, from a terminal (fm1-dock's tools/dock.py).
#   bunki/fm1/deploy.sh             put BUNKI on the FM-1; it starts at once (a few seconds)
#   bunki/fm1/deploy.sh check       does the FM-1 answer? its build, the free room, the modules on it
#   bunki/fm1/deploy.sh delete      take BUNKI off again (nothing else changes)
#   bunki/fm1/deploy.sh logs        fm1-dock's log and crash record, when something went wrong
#   ... --port NAME                 only when the FM-1's MIDI port is not found by itself
# Needs git, python3 and python-rtmidi (pip3 install python-rtmidi), or uv (then nothing to install).
set -e
REV=60a89df6554f6df3823f03a4c893b6715bfef9b5     # the fm1-dock revision bunki.dock was built and tested with
HERE=$(cd "$(dirname "$0")" && pwd)
DOCK=${FM1_DOCK:-$HERE/build/fm1-dock}
if [ ! -d "$DOCK/.git" ]; then
    mkdir -p "$(dirname "$DOCK")"
    git clone -q https://github.com/joakimeriksson/fm1-dock "$DOCK"
fi
(cd "$DOCK" && { git cat-file -e "$REV^{commit}" 2>/dev/null || git fetch -q origin; } && git checkout -q "$REV")

if command -v uv >/dev/null 2>&1; then
    run() { uv run -q --with python-rtmidi python3 "$DOCK/tools/dock.py" "$@"; }
elif python3 -c 'import rtmidi' 2>/dev/null; then
    run() { python3 "$DOCK/tools/dock.py" "$@"; }
else
    echo "deploy.sh: needs python-rtmidi (pip3 install python-rtmidi) or uv" >&2
    exit 1
fi

what=${1:-deploy}
[ $# -gt 0 ] && shift
case "$what" in
    deploy) run deploy "$HERE/bunki.dock" "$@" ;;
    check)  run info "$@"; run modules "$@" ;;
    delete) run delete BUNKI "$@" ;;
    logs)   run logs "$@" ;;
    *)      sed -n '3,8p' "$0"; exit 2 ;;
esac
