#!/bin/bash
# usage: csstry.sh <head-variant>   — write index.css with the given head, build, report CSS diff size
S="C:/Users/Admin/AppData/Local/Temp/claude/E--Omnira-Studio/996c103a-9bd1-4db7-ad78-d0de8aa2f28f/scratchpad"
P="/e/Omnira Studio Source"
HEAD_VARIANT="$1" python -I "$S/tools/mkindexcss.py" "$S/v102/ex/out/renderer/assets/index-ZTwIRBBu.css" "$P/src/renderer/src/index.css" >/dev/null
cd "$P" && npx electron-vite build >/dev/null 2>&1 || { echo BUILD_FAILED; exit 1; }
B="$P/out/renderer/assets/$(ls "$P/out/renderer/assets" | grep '\.css$')"
A="$S/v102/ex/out/renderer/assets/index-ZTwIRBBu.css"
if cmp -s "$A" "$B"; then echo "CSS BYTE-IDENTICAL ($B)"; else echo "differs: $(python -I "$S/tools/bdiff.py" "$A" "$B" 100000 | grep -c '^[-+][^-+]') lines"; python -I "$S/tools/bdiff.py" "$A" "$B" 24; fi
