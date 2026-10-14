// Classify top-level statements of the original renderer bundle as vendor/app
// by matching normalized statement text against a vendor-only reference bundle.
const fs = require("fs");
const parser = require("@babel/parser");
const t = require("@babel/types");

const [origPath, refPath, outPath] = process.argv.slice(2);
const parse = (src) => parser.parse(src, { sourceType: "module", plugins: [] });

function declNames(node) {
  const names = [];
  if (t.isFunctionDeclaration(node) || t.isClassDeclaration(node)) node.id && names.push(node.id.name);
  else if (t.isVariableDeclaration(node))
    for (const d of node.declarations) Object.keys(t.getBindingIdentifiers(d.id)).forEach((n) => names.push(n));
  return names;
}
const normId = (s) => s.replace(/\$[0-9A-Za-z_$]*/g, "").replace(/([A-Za-z_])\d+\b/g, "$1");
const norm = (s) => normId(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")).replace(/\s+/g, "");
const tokens = (s) => normId(s.replace(/\/\*[\s\S]*?\*\//g, "")).match(/[A-Za-z_$][\w$]*|\d+|"[^"]*"|\S/g) || [];

function stmts(src) {
  const ast = parse(src);
  return ast.program.body.map((n) => {
    const code = src.slice(n.start, n.end);
    return { start: n.loc.start.line, end: n.loc.end.line, names: declNames(n), key: norm(code), code };
  });
}
function sim(a, b) {
  const ma = new Map();
  for (const x of tokens(a)) ma.set(x, (ma.get(x) || 0) + 1);
  let inter = 0, tb = 0;
  for (const x of tokens(b)) { tb++; const c = ma.get(x); if (c) { inter++; ma.set(x, c - 1); } }
  const ta = tokens(a).length;
  return (2 * inter) / (ta + tb || 1);
}

const orig = stmts(fs.readFileSync(origPath, "utf8"));
const ref = stmts(fs.readFileSync(refPath, "utf8"));
const refKeys = new Set(ref.map((r) => r.key));
const refByName = new Map();
for (const r of ref) for (const n of r.names) { const k = normId(n); if (!refByName.has(k)) refByName.set(k, []); refByName.get(k).push(r); }

const out = orig.map((o, i) => {
  let how = null, score = 0;
  if (refKeys.has(o.key)) { how = "exact"; score = 1; }
  else {
    for (const n of o.names) for (const r of refByName.get(normId(n)) || []) {
      const s = sim(o.code, r.code); if (s > score) score = s;
    }
    if (score >= 0.8) how = "fuzzy";
  }
  return { i, start: o.start, end: o.end, names: o.names, vendor: !!how, how, score: +score.toFixed(2) };
});
fs.writeFileSync(outPath, JSON.stringify(out));
const v = out.filter((x) => x.vendor).length;
console.log("total", out.length, "vendor", v, "app", out.length - v);
// run report
const runs = []; let cur = null;
for (const x of out) { const k = x.vendor ? "V" : "A"; if (!cur || cur.k !== k) { cur = { k, a: x.start, b: x.end, n: 0, names: [], sc: [] }; runs.push(cur); } cur.b = x.end; cur.n++; cur.names.push(...x.names); cur.sc.push(x.score); }
fs.writeFileSync(outPath + ".runs.txt", runs.map((r) => `${r.k}\t${r.a}-${r.b}\t${r.n}\t${r.names.slice(0, 8).join(",")}\t[${r.sc.slice(0, 8).join(",")}]`).join("\n"));
