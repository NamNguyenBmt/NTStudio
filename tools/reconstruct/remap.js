// Map statement start lines of an old bundle onto a new bundle (same statement = same declared name + occurrence,
// or identical normalized text for anonymous statements).
// usage: node remap.js <oldBundle> <newBundle> <in-manifest> <out-manifest>   (lines "<line> <file>")
//        node remap.js <oldBundle> <newBundle> --ranges '<json [[a,b],...]>'  -> prints remapped ranges
const fs = require("fs");
const parser = require("@babel/parser");
const t = require("@babel/types");
const [oldP, newP, a3, a4] = process.argv.slice(2);
const normId = (s) => s.replace(/\$[0-9A-Za-z_$]*/g, "");
function stmts(p) {
  const src = fs.readFileSync(p, "utf8");
  const ast = parser.parse(src, { sourceType: "module" });
  const seen = new Map();
  return ast.program.body.map((n) => {
    let names = [];
    if (t.isFunctionDeclaration(n) || t.isClassDeclaration(n)) names = n.id ? [n.id.name] : [];
    else if (t.isVariableDeclaration(n)) names = n.declarations.flatMap((d) => Object.keys(t.getBindingIdentifiers(d.id)));
    const text = normId(src.slice(n.start, n.end)).replace(/\s+/g, "");
    const key = names.length ? "N:" + names.map(normId).join(",") : "T:" + text.slice(0, 400);
    const k = (seen.get(key) || 0) + 1; seen.set(key, k);
    const tk = "X:" + text; const kt = (seen.get(tk) || 0) + 1; seen.set(tk, kt);
    return { start: n.loc.start.line, end: n.loc.end.line, id: key + "#" + k, tid: tk + "#" + kt, names };
  });
}
const O = stmts(oldP), N = stmts(newP);
// prefer an identical statement (text + occurrence); fall back to same name + occurrence for edited statements
const byTid = new Map(N.map((s) => [s.tid, s]));
const byName = new Map(N.map((s) => [s.id, s]));
const byId = { get: (id) => { const o = O.find((s) => s.id === id); return (o && byTid.get(o.tid)) || byName.get(id); } };
const oldIdx = new Map(O.map((s, i) => [s.start, i]));
const oldEnd = new Map(O.map((s, i) => [s.end, i]));
function mapStart(line) {
  const i = oldIdx.get(line);
  if (i == null) throw new Error("no statement starts at old line " + line);
  const hit = byId.get(O[i].id);
  if (!hit) throw new Error(`statement ${O[i].id} (old line ${line}) not found in new bundle`);
  return hit.start;
}
function mapEnd(line) {
  const i = oldEnd.get(line);
  if (i == null) throw new Error("no statement ends at old line " + line);
  const hit = byId.get(O[i].id);
  if (!hit) throw new Error(`statement ${O[i].id} (old end ${line}) not found in new bundle`);
  return hit.end;
}
if (a3 === "--ranges") {
  console.log(JSON.stringify(JSON.parse(a4).map(([a, b]) => [mapStart(a), mapEnd(b)])));
} else {
  const out = fs.readFileSync(a3, "utf8").trim().split(/\r?\n/).map((l) => {
    const [line, file] = l.trim().split(/\s+/);
    return `${mapStart(+line)} ${file}`;
  });
  fs.writeFileSync(a4, out.join("\n") + "\n");
  console.log("mapped", out.length);
}
// report new statements (not present in old bundle) for review
if (process.env.NEWSTMTS) {
  const oldIds = new Set(O.map((s) => s.id));
  for (const s of N) if (!oldIds.has(s.id) && s.names.length) console.log("NEW", s.start, s.names.join(","));
}
