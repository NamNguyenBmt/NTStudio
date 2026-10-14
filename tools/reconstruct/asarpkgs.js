// List every package.json (path -> version) in two asars and show differences; also diff the root package.json.
const asar = require("E:/Omnira Studio Source/node_modules/@electron/asar");
const [a, b] = process.argv.slice(2);
const B = String.fromCharCode(92);
function pkgs(p) {
  const m = new Map();
  for (const f of asar.listPackage(p)) {
    if (!/node_modules\\(@[^\\]+\\)?[^\\]+\\package\.json$/.test(f) || /node_modules\\[^\\]+\\node_modules\\[^\\]+\\[^\\]+\\/.test(f) && false) continue;
    const rel = f.slice(1).replace(/\\package\.json$/, "");
    if (rel.split(B).filter((x) => x === "node_modules").length === 0) continue;
    try { const j = JSON.parse(asar.extractFile(p, f.slice(1))); m.set(rel.split(B).join("/"), j.version); } catch {}
  }
  return m;
}
const A = pkgs(a), Bm = pkgs(b);
for (const k of new Set([...A.keys(), ...Bm.keys()])) if (A.get(k) !== Bm.get(k)) console.log(`${k}: ${A.get(k) ?? "-"}  vs  ${Bm.get(k) ?? "-"}`);
console.log("--- root package.json");
console.log(asar.extractFile(a, "package.json").toString());
console.log(asar.extractFile(b, "package.json").toString());
