// Compare two asar archives: file sets and content hashes. usage: node asardiff.js a.asar b.asar
const asar = require("E:/Omnira Studio Source/node_modules/@electron/asar");
const crypto = require("crypto");
const [a, b] = process.argv.slice(2);
function index(p) {
  const m = new Map();
  for (const f of asar.listPackage(p)) {
    let st; try { st = asar.statFile(p, f.slice(1)); } catch { continue; }
    if (st.files) continue;
    let h = st.unpacked ? "UNPACKED:" + st.size : null;
    if (!h) { try { h = crypto.createHash("sha1").update(asar.extractFile(p, f.slice(1))).digest("hex"); } catch (e) { h = "ERR"; } }
    m.set(f, h);
  }
  return m;
}
const A = index(a), B = index(b);
const onlyA = [...A.keys()].filter((k) => !B.has(k)), onlyB = [...B.keys()].filter((k) => !A.has(k));
const diff = [...A.keys()].filter((k) => B.has(k) && A.get(k) !== B.get(k));
console.log(`files: ${A.size} vs ${B.size}; only-original ${onlyA.length}, only-rebuilt ${onlyB.length}, content-different ${diff.length}`);
const top = (l) => { const m = {}; for (const x of l) { const k = x.split("\\").slice(0, 3).join("/"); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((p, q) => q[1] - p[1]).slice(0, 15); };
console.log("only-original:", JSON.stringify(top(onlyA)));
console.log("only-rebuilt:", JSON.stringify(top(onlyB)));
console.log("different:", diff.slice(0, 15).join(" "));
