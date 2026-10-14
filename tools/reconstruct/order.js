// Compare module order: sequence of uniquely-named top-level declarations
const fs = require("fs");
const parser = require("@babel/parser");
const [a, b] = process.argv.slice(2);
const base = (n) => n.replace(/\$[0-9A-Za-z_$]+$/, "");
function decls(p) {
  const ast = parser.parse(fs.readFileSync(p, "utf8"), { sourceType: "module", plugins: ["jsx"] });
  return ast.program.body.map((n) => {
    const names = n.type === "VariableDeclaration" ? n.declarations.map((d) => d.id.name).filter(Boolean) : n.id ? [n.id.name] : [];
    return { name: names[0] ? base(names[0]) : null, line: n.loc.start.line };
  }).filter((d) => d.name);
}
const A = decls(a), B = decls(b);
const cnt = (L) => { const m = new Map(); L.forEach((d) => m.set(d.name, (m.get(d.name) || 0) + 1)); return m; };
const ca = cnt(A), cb = cnt(B);
const uniq = (d) => ca.get(d.name) === 1 && cb.get(d.name) === 1;
const sa = A.filter(uniq).map((d) => d.name), sb = B.filter(uniq).map((d) => d.name);
const lineA = new Map(A.filter(uniq).map((d) => [d.name, d.line]));
let shown = 0;
for (let i = 0, j = 0; i < sa.length && j < sb.length && shown < 25; ) {
  if (sa[i] === sb[j]) { i++; j++; continue; }
  console.log(`diverge at original #${i} ${sa[i]}@${lineA.get(sa[i])}  rebuilt has ${sb[j]}@orig${lineA.get(sb[j])}`);
  shown++;
  // resync: skip rebuilt element
  j++;
}
