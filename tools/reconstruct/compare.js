// Structural comparison of two bundles: top-level statements, identifiers abstracted.
// usage: node compare.js <original> <rebuilt> [report.txt] [--app-ranges]
const fs = require("fs");
const parser = require("@babel/parser");
const [a, b, report] = process.argv.slice(2);
function stmts(p) {
  const src = fs.readFileSync(p, "utf8");
  const ast = parser.parse(src, { sourceType: "module", tokens: true, plugins: ["jsx"] });
  const toks = ast.tokens;
  let ti = 0;
  return ast.program.body.map((n) => {
    const parts = [];
    while (ti < toks.length && toks[ti].end <= n.start) ti++;
    let j = ti;
    for (; j < toks.length && toks[j].start < n.end; j++) {
      const t = toks[j];
      const label = t.type.label || t.type;
      if (label === "name") {
        const prev = toks[j - 1], next = toks[j + 1];
        const isProp = prev && (prev.type.label === "." || prev.type.label === "?.");
        const isKey = next && next.type.label === ":" && prev && (prev.type.label === "{" || prev.type.label === ",");
        parts.push(isProp || isKey ? "." + t.value : "I");
      } else if (label === "string" || label === "num" || label === "template" || label === "regexp") parts.push(JSON.stringify(t.value));
      else if (label === "eof") {}
      else parts.push(t.value != null && typeof t.value !== "object" ? String(t.value) : label);
    }
    ti = j;
    const code = src.slice(n.start, Math.min(n.end, n.start + 100)).replace(/\s+/g, " ");
    return { key: parts.join(" "), line: n.loc.start.line, code };
  });
}
const A = stmts(a), B = stmts(b);
// multiset diff + order check via LCS on keys (hash to ints)
const ids = new Map(); const id = (k) => { if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
const ka = A.map((s) => id(s.key)), kb = B.map((s) => id(s.key));
// Myers-lite: LCS with DP over rows (memory n*m too big?) -> use patience-ish greedy via unique anchors
const countA = new Map(), countB = new Map();
ka.forEach((k) => countA.set(k, (countA.get(k) || 0) + 1));
kb.forEach((k) => countB.set(k, (countB.get(k) || 0) + 1));
const onlyA = [], onlyB = [];
const usedB = new Map();
for (const s of A) { const k = id(s.key); const u = usedB.get(k) || 0; if (u < (countB.get(k) || 0)) usedB.set(k, u + 1); else onlyA.push(s); }
const usedA = new Map();
for (const s of B) { const k = id(s.key); const u = usedA.get(k) || 0; if (u < (countA.get(k) || 0)) usedA.set(k, u + 1); else onlyB.push(s); }
// order: longest increasing subsequence of positions of matched statements
const posB = new Map(); kb.forEach((k, i) => { if (!posB.has(k)) posB.set(k, []); posB.get(k).push(i); });
const seq = []; const take = new Map();
for (const k of ka) { const arr = posB.get(k); const t = take.get(k) || 0; if (arr && t < arr.length) { seq.push(arr[t]); take.set(k, t + 1); } }
const tails = [];
for (const x of seq) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; } tails[lo] = x; }
const lines = [];
lines.push(`original statements ${A.length}, rebuilt ${B.length}`);
lines.push(`matched ${A.length - onlyA.length}, only-original ${onlyA.length}, only-rebuilt ${onlyB.length}, in-order ${tails.length}/${seq.length}`);
lines.push("--- only in original"); for (const s of onlyA) lines.push(`${s.line}: ${s.code}`);
lines.push("--- only in rebuilt"); for (const s of onlyB) lines.push(`${s.line}: ${s.code}`);
const out = lines.join("\n");
if (report) fs.writeFileSync(report, out);
console.log(lines.slice(0, 2).join("\n"));
if (process.env.ORDER) {
  // rebuilt sequence expressed as original line numbers, collapsed to runs
  const posA = new Map(); A.forEach((s, i) => { const k = id(s.key); if (!posA.has(k)) posA.set(k, []); posA.get(k).push(s.line); });
  const tk = new Map(); const seqL = [];
  for (const s of B) { const k = id(s.key); const arr = posA.get(k); const t = tk.get(k) || 0; if (arr && t < arr.length) { seqL.push(arr[t]); tk.set(k, t + 1); } else seqL.push(-1); }
  const runs = []; let st = 0;
  for (let i = 1; i <= seqL.length; i++) if (i === seqL.length || seqL[i] < seqL[i - 1]) { runs.push(`${seqL[st]}..${seqL[i - 1]}`); st = i; }
  console.log(runs.join("  "));
}
