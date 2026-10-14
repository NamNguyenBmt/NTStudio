// Merge per-bundle split outputs into one src tree; shared modules present in several bundles are merged.
// usage: node merge.js <outRoot>
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const t = require("@babel/types");

const root = path.resolve(process.argv[2]);
const parts = ["_main", "_renderer", "_preload"].map((p) => path.join(root, p)).filter((p) => fs.existsSync(p));
const dest = path.join(root, "src");
const all = new Map(); // rel -> [abs...]
function walk(base, d = base) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(base, p);
    else if (!e.name.startsWith("_")) {
      const rel = path.relative(base, p).split(path.sep).join("/");
      if (!all.has(rel)) all.set(rel, []);
      all.get(rel).push(p);
    }
  }
}
parts.forEach((p) => walk(p));

const parse = (src) => parser.parse(src, { sourceType: "module", plugins: ["jsx"] });
function pieces(src) {
  const ast = parse(src);
  const imports = [], stmts = [];
  for (const n of ast.program.body) {
    if (t.isImportDeclaration(n)) imports.push(n);
    else {
      const exp = t.isExportNamedDeclaration(n) && n.declaration;
      const decl = exp ? n.declaration : n;
      const code = src.slice(exp ? n.declaration.start : n.start, n.end);
      const lead = (n.leadingComments || []).map((c) => src.slice(c.start, c.end)).join("\n");
      stmts.push({ exp: !!exp, code, lead, key: code.replace(/\s+/g, "") });
    }
  }
  return { imports, stmts };
}
function lcsMerge(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].key === b[j].key) { out.push({ ...a[i], exp: a[i].exp || b[j].exp, lead: a[i].lead || b[j].lead }); i++; j++; }
    else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) out.push(a[i++]);
    else out.push(b[j++]);
  }
  return out;
}
let merged = 0, conflicts = [];
for (const [rel, srcs] of all) {
  const target = path.join(dest, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const texts = srcs.map((s) => fs.readFileSync(s, "utf8"));
  if (texts.length === 1 || texts.every((x) => x === texts[0])) { fs.writeFileSync(target, texts[0]); continue; }
  merged++;
  const ps = texts.map(pieces);
  let stmts = ps[0].stmts;
  for (const p of ps.slice(1)) stmts = lcsMerge(stmts, p.stmts);
  // detect duplicate declarations with differing bodies
  const seen = new Map();
  for (const s of stmts) {
    const m = /^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/.exec(s.code);
    if (m) { if (seen.has(m[1])) conflicts.push(`${rel}: ${m[1]}`); seen.set(m[1], 1); }
  }
  // union imports
  const imp = new Map();
  for (const p of ps) for (const d of p.imports) {
    const from = d.source.value;
    if (!imp.has(from)) imp.set(from, { def: null, ns: null, named: new Map() });
    const e = imp.get(from);
    for (const s of d.specifiers) {
      if (t.isImportDefaultSpecifier(s)) e.def = s.local.name;
      else if (t.isImportNamespaceSpecifier(s)) e.ns = s.local.name;
      else e.named.set(s.local.name, s.imported.name || s.imported.value);
    }
  }
  const lines = [];
  for (const [from, e] of imp) {
    if (e.ns) lines.push(`import * as ${e.ns} from ${JSON.stringify(from)};`);
    const ps2 = [];
    if (e.def) ps2.push(e.def);
    if (e.named.size) ps2.push(`{ ${[...e.named].map(([l, i]) => (l === i ? l : `${i} as ${l}`)).join(", ")} }`);
    if (ps2.length) lines.push(`import ${ps2.join(", ")} from ${JSON.stringify(from)};`);
  }
  if (lines.length) lines.push("");
  let prev = "";
  for (const s of stmts) {
    const code = (s.lead ? s.lead + "\n" : "") + (s.exp ? "export " : "") + s.code;
    if (prev && (prev.includes("\n") || code.includes("\n"))) lines.push("");
    lines.push(code); prev = code;
  }
  fs.writeFileSync(target, lines.join("\n") + "\n");
}
console.log(`files ${all.size}, merged ${merged}`);
if (conflicts.length) console.log("CONFLICTS:\n" + conflicts.join("\n"));
