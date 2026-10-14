// Copy generated sources into the project and apply the small hand-written patches.
// usage: node finalize.js <outRoot> <projectDir>
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const [outRoot, proj] = process.argv.slice(2).map((p) => path.resolve(p));
const src = path.join(outRoot, "src");

const hasJsx = (code) => {
  const ast = parser.parse(code, { sourceType: "module", plugins: ["jsx"], tokens: true });
  return ast.tokens.some((t) => t.type && (t.type.label === "jsxTagStart" || t.type === "jsxTagStart"));
};
const generated = new Set();
function copyDir(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const pa = path.join(a, e.name);
    if (e.isDirectory()) { copyDir(pa, path.join(b, e.name)); continue; }
    let name = e.name;
    const code = fs.readFileSync(pa, "utf8");
    if (name.endsWith(".js") && hasJsx(code)) name = name.replace(/\.js$/, ".jsx");
    const pb = path.join(b, name);
    fs.writeFileSync(pb, code);
    generated.add(path.resolve(pb));
  }
}
const roots = ["main", "preload", "shared", "renderer/src"];
for (const d of roots) copyDir(path.join(src, d), path.join(proj, "src", d));

// remove stale generated files from earlier runs (only .js/.jsx, never hand-written assets)
const keep = new Set(["index.css"].map((f) => path.resolve(proj, "src/renderer/src", f)));
function prune(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.resolve(d, e.name);
    if (e.isDirectory()) prune(p);
    else if (/\.(js|jsx)$/.test(e.name) && !generated.has(p) && !keep.has(p)) { fs.unlinkSync(p); console.log("removed stale", path.relative(proj, p)); }
  }
}
for (const d of roots) prune(path.join(proj, "src", d));

// renderer entry: global styles + fonts (ordered as in the shipped CSS)
const mainJsx = path.join(proj, "src/renderer/src/main.jsx");
let code = fs.readFileSync(mainJsx, "utf8");
const css = [
  'import "@fontsource/montserrat/900.css";',
  'import "@fontsource-variable/inter";',
  'import "@fontsource-variable/jetbrains-mono";',
  'import "./index.css";',
].join("\n");
if (!code.includes("./index.css")) {
  const lines = code.split("\n");
  let last = -1;
  lines.forEach((l, i) => { if (/^import /.test(l)) last = i; });
  lines.splice(last + 1, 0, css);
  code = lines.join("\n");
}
fs.writeFileSync(mainJsx, code);
console.log("finalized into", proj, "files", generated.size);
