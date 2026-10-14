#!/bin/bash
# usage: try-rollup.sh <version>  — pin rollup via overrides, rebuild, compare against 1.0.2 bundles
V="$1"
S="C:/Users/Admin/AppData/Local/Temp/claude/E--Omnira-Studio/996c103a-9bd1-4db7-ad78-d0de8aa2f28f/scratchpad"
P="/e/Omnira Studio Source"
cd "$P" || exit 1
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.overrides.rollup=process.argv[1];fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")' "$V"
npm install --ignore-scripts >/dev/null 2>&1
echo "rollup $(node -p "require('rollup/package.json').version")"
npx electron-vite build >/dev/null 2>&1 || { echo BUILD_FAILED; exit 1; }
cd "$S/tools"
node compare.js ../v102/m.js "$P/out/main/index.js" | tail -1
node compare.js ../v102/p.js "$P/out/preload/index.js" | tail -1
node compare.js ../v102/r.js "$P/out/renderer/assets/$(ls "$P/out/renderer/assets" | grep '^index.*js$')" | tail -1
