#!/bin/bash
# usage: try-eb.sh <electron-builder version> — pin, package --dir, compare asar with original 1.0.2
V="$1"
S="C:/Users/Admin/AppData/Local/Temp/claude/E--Omnira-Studio/996c103a-9bd1-4db7-ad78-d0de8aa2f28f/scratchpad"
P="/e/Omnira Studio Source"
cd "$P" || exit 1
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.devDependencies["electron-builder"]=process.argv[1];fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")' "$V"
npm install --ignore-scripts >/dev/null 2>&1
echo "electron-builder $(npx electron-builder --version)"
timeout 1200 npx electron-builder --win --x64 --dir --publish never > "/tmp/eb-$V.log" 2>&1 || { echo "PACK FAILED"; grep "⨯" "/tmp/eb-$V.log" | head -3; exit 1; }
node "$S/tools/asardiff.js" "$S/v102/nsis/resources/app.asar" "$P/dist/win-unpacked/resources/app.asar"
