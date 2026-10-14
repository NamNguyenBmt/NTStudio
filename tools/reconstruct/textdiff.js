// For statements matched by token key, compare exact source text; report kinds of textual differences.
const fs = require("fs");
const parser = require("@babel/parser");
const [a, b] = process.argv.slice(2);
function stmts(p) {
  const src = fs.readFileSync(p, "utf8");
  const ast = parser.parse(src, { sourceType: "module", tokens: true, plugins: ["jsx"] });
  const toks = ast.tokens; let ti = 0;
  return ast.program.body.map((n) => {
    const parts = [];
    while (ti < toks.length && toks[ti].end <= n.start) ti++;
    let j = ti;
    for (; j < toks.length && toks[j].start < n.end; j++) {
      const t = toks[j]; const l = t.type.label || t.type;
      parts.push(l === "name" ? "I" : JSON.stringify(t.value ?? l));
    }
    ti = j;
    return { key: parts.join(" "), text: src.slice(n.start, n.end), line: n.loc.start.line };
  });
}
const A = stmts(a), B = stmts(b);
const pool = new Map();
for (const s of B) { if (!pool.has(s.key)) pool.set(s.key, []); pool.get(s.key).push(s); }
let same = 0, diff = 0; const samples = [];
for (const s of A) {
  const c = pool.get(s.key)?.shift();
  if (!c) continue;
  if (c.text === s.text) same++; else { diff++; if (samples.length < (+process.env.N || 8)) samples.push([s, c]); }
}
console.log(`text-identical ${same}, text-different ${diff}`);
for (const [s, c] of samples) {
  let i = 0; while (i < s.text.length && s.text[i] === c.text[i]) i++;
  console.log(`--- orig line ${s.line}:\n  A: ${JSON.stringify(s.text.slice(Math.max(0, i - 60), i + 80))}\n  B: ${JSON.stringify(c.text.slice(Math.max(0, i - 60), i + 80))}`);
}
