// Split a rollup (electron-vite) bundle back into source modules.
// usage: node split.js <config.json>
// config: {
//   bundle, outDir, mode: "main"|"renderer"|"preload",
//   manifest: [[startLine, "relative/file.js"], ...]   // statement start line -> file (until next entry)
//   cls?: classification json (renderer; vendor statements dropped)
//   vendorMap?: { localName: { from, name } | { from, ns: true } | { from, default: true } }
//   externals?: { requireVar: { from, nice? } }   // main: CJS require vars
//   jsx?: true
// }
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");

const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const src = fs.readFileSync(cfg.bundle, "utf8");
const ast = parser.parse(src, { sourceType: "module", attachComment: true });
const body = ast.program.body;
const warn = [];

// ---------- classify statements ----------
const vendorLines = new Set();
if (cfg.cls) for (const c of JSON.parse(fs.readFileSync(cfg.cls, "utf8"))) if (c.vendor || c.forceVendor) vendorLines.add(c.start);
for (const l of cfg.extraVendorLines || []) vendorLines.add(l);
const manifest = [...cfg.manifest].sort((a, b) => a[0] - b[0]);
function fileForLine(line) {
  let f = null;
  for (const [l, file] of manifest) { if (l <= line) f = file; else break; }
  return f;
}
const externals = cfg.externals || {};
const vendorMap = cfg.vendorMap || {};

let programPath;
traverse(ast, { Program(p) { programPath = p; p.stop(); } });
const pscope = programPath.scope;
const stmtPaths = programPath.get("body");

const stmtFile = []; // file or null (dropped)
const stmtKind = []; // "app" | "vendor" | "external" | "directive"
stmtPaths.forEach((sp, i) => {
  const n = sp.node, line = n.loc.start.line;
  if (cfg.mode === "main" || cfg.mode === "preload") {
    if (t.isVariableDeclaration(n) && n.declarations.length === 1 && t.isCallExpression(n.declarations[0].init) &&
        t.isIdentifier(n.declarations[0].init.callee, { name: "require" })) {
      stmtKind[i] = "external"; stmtFile[i] = null; return;
    }
  }
  if (vendorLines.has(line) && !(cfg.appRanges && cfg.appRanges.some(([a, b]) => line >= a && line <= b))) { stmtKind[i] = "vendor"; stmtFile[i] = null; return; }
  if (cfg.appRanges && !cfg.appRanges.some(([a, b]) => line >= a && line <= b)) { stmtKind[i] = "vendor"; stmtFile[i] = null; return; }
  const f = fileForLine(line);
  if (!f) { stmtKind[i] = "vendor"; stmtFile[i] = null; warn.push(`no file for line ${line}`); return; }
  if (nsMembers(n)) { stmtKind[i] = "namespace"; stmtFile[i] = null; return; }
  stmtKind[i] = "app"; stmtFile[i] = f;
});

// rollup synthetic namespace object for `import * as X from "./mod"`:
// const X = Object.freeze(Object.defineProperty({ __proto__: null, a, b: c }, Symbol.toStringTag, { value: "Module" }))
function nsMembers(n) {
  if (!t.isVariableDeclaration(n) || n.declarations.length !== 1) return null;
  let e = n.declarations[0].init;
  if (!t.isCallExpression(e) || !t.isMemberExpression(e.callee) || !t.isIdentifier(e.callee.property, { name: "freeze" })) return null;
  e = e.arguments[0];
  if (!t.isCallExpression(e) || !t.isMemberExpression(e.callee) || !t.isIdentifier(e.callee.property, { name: "defineProperty" })) return null;
  const obj = e.arguments[0];
  if (!t.isObjectExpression(obj)) return null;
  const members = [];
  for (const p of obj.properties) {
    if (!t.isObjectProperty(p)) return null;
    const k = t.isIdentifier(p.key) ? p.key.name : p.key.value;
    if (k === "__proto__") continue;
    if (!t.isIdentifier(p.value)) return null;
    members.push([k, p.value.name]);
  }
  return members;
}

// binding -> statement index
const bindingStmt = new Map();
for (const [name, b] of Object.entries(pscope.bindings)) {
  let p = b.path; while (p.parentPath && p.parentPath !== programPath) p = p.parentPath;
  bindingStmt.set(name, p.key);
}
const fileOfBinding = (name) => stmtFile[bindingStmt.get(name)];

// external require info (main)
const requireInfo = {}; // var -> module
stmtPaths.forEach((sp, i) => {
  if (stmtKind[i] !== "external") return;
  const d = sp.node.declarations[0];
  requireInfo[d.id.name] = d.init.arguments[0].value;
});

// ---------- strip PURE annotations ----------
traverse(ast, {
  enter(p) {
    for (const k of ["leadingComments", "trailingComments", "innerComments"]) {
      if (p.node[k]) p.node[k] = p.node[k].filter((c) => !/^\s*[@#]__PURE__\s*$/.test(c.value));
    }
  },
});

// ---------- JSX restoration ----------
const JSX_OBJ = cfg.jsxObject || "jsxRuntimeExports";
function isJsxCall(n) {
  return t.isCallExpression(n) && t.isMemberExpression(n.callee) && t.isIdentifier(n.callee.object, { name: JSX_OBJ }) &&
    t.isIdentifier(n.callee.property) && ["jsx", "jsxs"].includes(n.callee.property.name);
}
const isFragmentRef = (n) => t.isMemberExpression(n) && t.isIdentifier(n.object, { name: JSX_OBJ }) && t.isIdentifier(n.property, { name: "Fragment" });
function toJsxName(n) {
  if (t.isStringLiteral(n)) return t.jsxIdentifier(n.value);
  if (t.isIdentifier(n)) return t.jsxIdentifier(n.name);
  if (t.isMemberExpression(n) && !n.computed && t.isIdentifier(n.object) && (cfg.vendorMap || {})[n.object.name]?.members) {
    const vm = cfg.vendorMap[n.object.name];
    jsxExtraImports.push([currentFile, vm.from, n.property.name]);
    return t.jsxIdentifier(n.property.name);
  }
  if (t.isMemberExpression(n) && !n.computed) {
    const obj = toJsxName(n.object); if (!obj) return null;
    return t.jsxMemberExpression(obj, t.jsxIdentifier(n.property.name));
  }
  return null;
}
const validAttr = (s) => /^[A-Za-z_$][\w$-]*(:[\w$-]+)?$/.test(s);
function attrValue(v) {
  if (t.isStringLiteral(v) && !/["\\\n\r{}<>]/.test(v.value) && !/&/.test(v.value)) return t.stringLiteral(v.value);
  return t.jsxExpressionContainer(v);
}
function childNode(c) {
  if (t.isJSXElement(c) || t.isJSXFragment(c)) return c;
  if (t.isStringLiteral(c)) {
    const s = c.value;
    if (s.length && !/[{}<>&\n\r]/.test(s) && s.trim() === s && s.trim().length) return t.jsxText(s);
    return t.jsxExpressionContainer(c);
  }
  return t.jsxExpressionContainer(c);
}
let jsxConverted = 0, jsxFailed = 0;
function convertJsx(node) {
  const [type, props, key] = node.arguments;
  const isStatic = node.callee.property.name === "jsxs";
  const fragment = isFragmentRef(type);
  let name = fragment ? null : toJsxName(type);
  if (!fragment && !name) { jsxFailed++; return null; }
  if (name && t.isJSXIdentifier(name) && t.isIdentifier(type) && /^[a-z]/.test(type.name)) {
    // lowercase component variable would be treated as an intrinsic tag
    jsxFailed++; return null;
  }
  const attrs = []; let children = [];
  if (key !== undefined) attrs.push(t.jsxAttribute(t.jsxIdentifier("key"), t.jsxExpressionContainer(key)));
  if (props && t.isObjectExpression(props)) {
    for (const p of props.properties) {
      if (t.isSpreadElement(p)) { attrs.push(t.jsxSpreadAttribute(p.argument)); continue; }
      if (!t.isObjectProperty(p) || p.computed) { jsxFailed++; return null; }
      const k = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : null;
      if (k == null || !validAttr(k)) { jsxFailed++; return null; }
      if (k === "children") {
        if (isStatic && t.isArrayExpression(p.value) && p.value.elements.every((e) => e && !t.isSpreadElement(e))) children = p.value.elements.map(childNode);
        else children = [childNode(p.value)];
        if (!isStatic && t.isArrayExpression(p.value)) children = [t.jsxExpressionContainer(p.value)];
        continue;
      }
      const nm = k.includes(":") ? t.jsxNamespacedName(t.jsxIdentifier(k.split(":")[0]), t.jsxIdentifier(k.split(":")[1])) : t.jsxIdentifier(k);
      attrs.push(t.jsxAttribute(nm, attrValue(p.value)));
    }
  } else if (props && !t.isNullLiteral(props)) {
    attrs.push(t.jsxSpreadAttribute(props));
  }
  if (fragment) {
    if (attrs.length) {
      // keyed fragment -> <Fragment key>
      name = t.jsxIdentifier("Fragment"); usedFragment.add(node);
    } else {
      jsxConverted++;
      return t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), children);
    }
  }
  jsxConverted++;
  const selfClosing = children.length === 0;
  return t.jsxElement(t.jsxOpeningElement(name, attrs, selfClosing), selfClosing ? null : t.jsxClosingElement(t.cloneNode(name)), children, selfClosing);
}
const usedFragment = new Set();
const jsxExtraImports = [];
let currentFile = null;
const fragmentFiles = new Set();
if (cfg.jsx) {
  stmtPaths.forEach((sp, i) => {
    if (stmtKind[i] !== "app") return;
    currentFile = stmtFile[i];
    sp.traverse({
      CallExpression: {
        exit(p) {
          if (!isJsxCall(p.node)) return;
          const r = convertJsx(p.node);
          if (r) { if (t.isJSXElement(r) && r.openingElement.name.name === "Fragment") fragmentFiles.add(stmtFile[i]); p.replaceWith(r); }
        },
      },
    });
  });
  // leftover references to the JSX runtime (failed conversions)
  console.log(`jsx converted ${jsxConverted}, failed ${jsxFailed}`);
}

// re-crawl scope after JSX replacement
programPath.scope.crawl();
const pscope2 = programPath.scope;
const bindings = pscope2.bindings;

// ---------- per-file analysis ----------
const files = new Map(); // file -> { stmts:[i], deps:Map(binding->true), extUse: Map(var -> Set(member|"*")) }
stmtPaths.forEach((sp, i) => {
  if (stmtKind[i] !== "app") return;
  const f = stmtFile[i];
  if (!files.has(f)) files.set(f, { stmts: [], names: new Set(), globals: new Set(), deps: new Set() });
  files.get(f).stmts.push(i);
});

// collect every binding name used in nested scopes per file + global references
stmtPaths.forEach((sp, i) => {
  if (stmtKind[i] !== "app") return;
  const F = files.get(stmtFile[i]);
  sp.traverse({
    Scope(p) { for (const n of Object.keys(p.scope.bindings)) F.names.add(n); },
    "Identifier|JSXIdentifier"(p) {
      const n = p.node.name;
      if (p.isJSXIdentifier() && !/^[A-Z]/.test(n) && !p.parentPath.isJSXMemberExpression()) return;
      if (p.isIdentifier() && !p.isReferencedIdentifier()) return;
      if (!p.scope.hasBinding(n, true)) F.globals.add(n);
    },
  });
  // own top-level declarations are handled separately
});

// references to program-level bindings, by file
const refsByFile = new Map(); // file -> Map(bindingName -> [paths])
function addRef(f, name, p) {
  if (!refsByFile.has(f)) refsByFile.set(f, new Map());
  const m = refsByFile.get(f); if (!m.has(name)) m.set(name, []); m.get(name).push(p);
}
for (const [name, b] of Object.entries(bindings)) {
  const all = [...b.referencePaths, ...b.constantViolations];
  for (const rp of all) {
    let p = rp; while (p.parentPath && p.parentPath !== programPath) p = p.parentPath;
    const si = p.key; if (stmtKind[si] !== "app") continue;
    addRef(stmtFile[si], name, rp);
  }
}
// cross-file reassignment check
for (const [name, b] of Object.entries(bindings)) {
  const owner = fileOfBinding(name);
  for (const cv of b.constantViolations) {
    let p = cv; while (p.parentPath && p.parentPath !== programPath) p = p.parentPath;
    const f = stmtFile[p.key];
    if (stmtKind[p.key] === "app" && owner && f !== owner) warn.push(`REASSIGN ${name} (owner ${owner}) in ${f}`);
  }
}

// ---------- naming ----------
const baseName = (n) => n.replace(/\$[0-9A-Za-z_$]+$/, "");
const localName = new Map(); // `${file}\0${binding}` -> name
const exportName = new Map(); // binding -> exported name
const taken = new Map(); // file -> Set
for (const [f, F] of files) {
  const s = new Set([...F.names, ...F.globals]);
  // remove top-level binding names (re-added as assigned)
  for (const n of Object.keys(bindings)) s.delete(n);
  // but nested bindings with same names as top-level ones remain in F.names; recompute nested-only
  const nested = new Set();
  for (const i of F.stmts) stmtPaths[i].traverse({ Scope(p) { for (const n of Object.keys(p.scope.bindings)) nested.add(n); } });
  for (const n of nested) s.add(n);
  for (const n of F.globals) s.add(n);
  taken.set(f, s);
}
const reserved = new Set(["React", "Fragment", "default"]);
function claim(f, want, fallback) {
  const s = taken.get(f);
  let n = want;
  if (s.has(n) || reserved.has(n) && want !== fallback) n = fallback;
  let k = 2; const b = n; while (s.has(n)) n = `${b}${k++}`;
  s.add(n); return n;
}
// own top-level bindings first
for (const [f, F] of files) {
  for (const i of F.stmts) {
    for (const name of Object.keys(t.getBindingIdentifiers(stmtPaths[i].node, false, true) || {})) { /* noop */ }
  }
}
for (const [name] of Object.entries(bindings)) {
  const f = fileOfBinding(name); if (!f || stmtKind[bindingStmt.get(name)] !== "app") continue;
  const n = claim(f, baseName(name), name);
  localName.set(`${f}\0${name}`, n);
  exportName.set(name, n);
}

// ---------- imports ----------
const imports = new Map(); // file -> Map(from -> {named: Map(imported->local), def, ns})
function addImport(f, from, kind, imported, local) {
  if (!imports.has(f)) imports.set(f, new Map());
  const m = imports.get(f); if (!m.has(from)) m.set(from, { named: new Map(), def: null, ns: null, side: false });
  const e = m.get(from);
  if (kind === "named") e.named.set(imported + "\0" + local, [imported, local]);
  else if (kind === "default") e.def = local; else if (kind === "ns") e.ns = local;
}
function relPath(from, to) {
  let r = path.posix.relative(path.posix.dirname(from), to).replace(/\.(jsx?|tsx?)$/, "");
  if (!r.startsWith(".")) r = "./" + r;
  return r;
}
const exportsNeeded = new Set();
const NICE_NS = { node_fs: "fs", node_path: "path", node_crypto: "crypto", node_child_process: "childProcess", node_util: "util", node_stream: "stream", node_http: "http", node_url: "url", "promises$1": "fsp", promises: "streamPromises", sqliteCore: "sqliteCore", drizzleOrm: "drizzleOrm" };

for (const [f, refs] of refsByFile) {
  for (const [name, paths] of refs) {
    const si = bindingStmt.get(name);
    const kind = stmtKind[si];
    if (kind === "app") {
      const owner = stmtFile[si];
      const ln = localName.get(`${f}\0${name}`) || (() => {
        const n = claim(f, exportName.get(name), name); localName.set(`${f}\0${name}`, n); return n;
      })();
      for (const p of paths) setName(p, ln);
      if (owner !== f) { addImport(f, relPath(f, owner), "named", exportName.get(name), ln); exportsNeeded.add(name); }
    } else if (kind === "external") {
      const mod = requireInfo[name];
      const members = paths.map((p) => (p.parentPath.isMemberExpression({ object: p.node, computed: false }) && !p.parentPath.parentPath.isAssignmentExpression({ left: p.parentPath.node }) ? p.parentPath.node.property.name : null));
      const allMember = members.every((m) => m);
      if ((cfg.defaultImports || []).includes(name)) {
        // the original bundle named this require after a default import's local (e.g. `import os from "node:os"`)
        const local = claim(f, name, name + "$1");
        addImport(f, mod, "default", null, local); for (const p of paths) setName(p, local);
        continue;
      }
      if (allMember && !members.includes("default")) {
        // named imports; a member that clashes with a local name gets an alias (scrypt -> cryptoScrypt)
        const alias = new Map();
        const prefix = (NICE_NS[name] || baseName(name)).replace(/^node_/, "");
        for (const m of new Set(members)) {
          let local = m;
          if (taken.get(f).has(m)) local = claim(f, prefix + m[0].toUpperCase() + m.slice(1), `${m}$1`);
          else taken.get(f).add(m);
          alias.set(m, local);
          addImport(f, mod, "named", m, local);
        }
        paths.forEach((p) => p.parentPath.replaceWith(t.identifier(alias.get(p.parentPath.node.property.name))));
        continue;
      }
      if (allMember) {
        const nice = claim(f, NICE_NS[name] || baseName(name), name);
        addImport(f, mod, "ns", null, nice); for (const p of paths) setName(p, nice);
      } else {
        const nice = claim(f, NICE_NS[name] || baseName(name), name);
        addImport(f, mod, "default", null, nice); for (const p of paths) setName(p, nice);
      }
    } else if (kind === "vendor") {
      handleVendor(f, name, paths);
    } else if (kind === "namespace") {
      const members = nsMembers(stmtPaths[si].node);
      const target = fileOfBinding(members[0][1]);
      for (const [, b] of members) exportsNeeded.add(b);
      const local = localNameFor(f, name, baseName(name));
      addImport(f, relPath(f, target), "ns", null, local);
      paths.forEach((p) => setName(p, local));
    }
  }
}
function setName(p, n) {
  if (p.isIdentifier() || p.isJSXIdentifier()) p.node.name = n;
  else if (p.isAssignmentExpression() || p.isUpdateExpression()) {
    const ids = p.getBindingIdentifiers ? p.getBindingIdentifiers() : {};
    for (const id of Object.values(ids)) if (id) id.name = n;
    if (p.isUpdateExpression() && t.isIdentifier(p.node.argument)) p.node.argument.name = n;
  } else warn.push(`setName on ${p.type}`);
}
// declaration identifiers of own bindings
for (const [name, b] of Object.entries(bindings)) {
  const f = fileOfBinding(name); if (!f || stmtKind[bindingStmt.get(name)] !== "app") continue;
  b.identifier.name = localName.get(`${f}\0${name}`);
}

function handleVendor(f, name, paths) {
  const vm = vendorMap[name];
  if (!vm) { warn.push(`UNMAPPED vendor ${name} in ${f}`); return; }
  if (vm.members) {
    // CJS-style namespace object like reactExports: member -> named import
    for (const p of paths) {
      const pp = p.parentPath;
      if (pp.isMemberExpression({ object: p.node, computed: false })) {
        const m = pp.node.property.name;
        let local = m;
        if (taken.get(f).has(m) && !(imports.get(f)?.get(vm.from)?.named.has(m + "\0" + m))) local = claim(f, m, `${m}$${vm.from.replace(/\W/g, "")}`);
        else taken.get(f).add(m);
        addImport(f, vm.from, "named", m, local);
        pp.replaceWith(t.identifier(local));
      } else {
        const local = claim(f, vm.nsName || "React", name);
        addImport(f, vm.from, "ns", null, local); setName(p, local);
      }
    }
    return;
  }
  if (vm.default) { const l = localNameFor(f, name, vm.local || baseName(name)); addImport(f, vm.from, "default", null, l); paths.forEach((p) => setName(p, l)); return; }
  if (vm.ns) { const l = localNameFor(f, name, vm.local || baseName(name)); addImport(f, vm.from, "ns", null, l); paths.forEach((p) => setName(p, l)); return; }
  const l = localNameFor(f, name, vm.name);
  addImport(f, vm.from, "named", vm.name, l); paths.forEach((p) => setName(p, l));
}
function localNameFor(f, binding, want) {
  const key = `${f}\0${binding}`;
  if (localName.has(key)) return localName.get(key);
  const n = claim(f, want, binding); localName.set(key, n); return n;
}

for (const [f, from, name] of jsxExtraImports) { taken.get(f).add(name); addImport(f, from, "named", name, name); }
// ---------- restore rollup-deconflicted local names (foo2 -> foo) ----------
const RESERVED = new Set("break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw try typeof var void while with yield let static enum await implements package protected interface private public null true false undefined arguments eval".split(" "));
const origTop = new Set();
for (const n of Object.keys(bindings)) { origTop.add(n); origTop.add(baseName(n)); }
for (const n of Object.keys(requireInfo)) origTop.add(n);
let localRenamed = 0;
if (!cfg.noLocalRename) for (const [f, F] of files) {
  const top = new Set();
  for (const [k, v] of localName) if (k.startsWith(f + "\u0000")) top.add(v);
  for (const [from, e] of imports.get(f) || []) { if (e.def) top.add(e.def); if (e.ns) top.add(e.ns); for (const [, l] of e.named.values()) top.add(l); }
  for (const i of F.stmts) {
    const scopeVisitor = {
      Scope(p) {
        if (p.scope === programPath.scope) return;
        for (const [name, b] of Object.entries(p.scope.bindings)) {
          const m = /^([A-Za-z_$](?:[\w$]*?[A-Za-z_$])?)([2-9])$/.exec(name);
          if (!m) continue;
          const B = m[1];
          if (RESERVED.has(B) || !origTop.has(B) || top.has(B)) continue;
          let ok = true;
          for (let sc = b.scope; sc && sc !== programPath.scope; sc = sc.parent) if (sc.hasOwnBinding(B)) { ok = false; break; }
          if (!ok) continue;
          b.scope.path.traverse({
            Scope(q) { if (q.scope.hasOwnBinding(B)) ok = false; },
            "Identifier|JSXIdentifier"(q) { if (q.node.name === B && (q.isReferencedIdentifier() || q.isBindingIdentifier())) ok = false; },
          });
          if (!ok) continue;
          b.identifier.name = B;
          for (const r of b.referencePaths) { if (r.node.type === "Identifier" || r.node.type === "JSXIdentifier") r.node.name = B; }
          for (const c of b.constantViolations) {
            for (const id of Object.values(c.getBindingIdentifiers())) if (id && id.name === name) id.name = B;
            if (c.isUpdateExpression() && c.node.argument.name === name) c.node.argument.name = B;
          }
          b.scope.bindings[B] = b; delete b.scope.bindings[name];
          localRenamed++;
        }
      },
    };
    if (stmtPaths[i].isScope()) scopeVisitor.Scope(stmtPaths[i]);
    stmtPaths[i].traverse(scopeVisitor);
    stmtPaths[i].traverse({
      ObjectProperty(p) {
        const n = p.node;
        if (n.computed || !t.isIdentifier(n.key)) return;
        if (t.isIdentifier(n.value) && n.value.name === n.key.name) n.shorthand = true;
        else if (t.isAssignmentPattern(n.value) && t.isIdentifier(n.value.left) && n.value.left.name === n.key.name && p.parentPath.isObjectPattern()) n.shorthand = true;
        else n.shorthand = false;
      },
    });
  }
}
console.log("local names restored", localRenamed);
// ---------- emit ----------
// Import order reproduces the original module order: rollup lays modules out depth-first in import order,
// so each file lists its imports sorted by where the imported module sits in the original bundle.
const fileMinLine = new Map();
for (const [f, F] of files) fileMinLine.set(f, Math.min(...F.stmts.map((i) => stmtPaths[i].node.loc.start.line)));
const modulePos = new Map();
for (const [v, mod] of Object.entries(requireInfo)) {
  const line = stmtPaths[bindingStmt.get(v)].node.loc.start.line;
  modulePos.set(mod, Math.min(modulePos.get(mod) ?? Infinity, line));
}
for (const [v, vm] of Object.entries(vendorMap)) {
  if (!bindingStmt.has(v)) continue;
  const line = stmtPaths[bindingStmt.get(v)].node.loc.start.line;
  modulePos.set(vm.from, Math.min(modulePos.get(vm.from) ?? Infinity, line));
}
// CJS externals have no code of their own: rollup emits their require() when the first importer is reached,
// so they take the position just before their earliest importer.
for (const mod of new Set(Object.values(requireInfo))) {
  let best = Infinity;
  for (const [f, m] of imports) if (m.has(mod)) best = Math.min(best, fileMinLine.get(f) - 0.5);
  if (best < Infinity) modulePos.set(mod, best);
}
const fileByNoExt = new Map([...files.keys()].map((f) => [f.replace(/\.(jsx?|tsx?)$/, ""), f]));
const nodeOf = (f, from) => (from.startsWith(".") ? fileByNoExt.get(path.posix.join(path.posix.dirname(f), from)) : "ext:" + from);
const nodePos = (n) => (n && n.startsWith("ext:") ? modulePos.get(n.slice(4)) ?? 0 : fileMinLine.get(n) ?? Infinity);
function importPos(f, from) { return nodePos(nodeOf(f, from)); }
// Simulate rollup's depth-first module ordering and choose, for every file, the import order that reproduces
// the original layout: at each step take the import whose not-yet-visited dependency closure starts earliest.
const depsOf = (n) => (n.startsWith("ext:") ? [] : [...(imports.get(n) || new Map()).keys()].map((from) => nodeOf(n, from)).filter(Boolean));
const chosenOrder = new Map(); // file -> [from...]
const simEmit = [];
{
  const visited = new Set();
  const closureMin = (n) => {
    let best = Infinity; const seen = new Set(); const st = [n];
    while (st.length) { const x = st.pop(); if (seen.has(x) || visited.has(x)) continue; seen.add(x); best = Math.min(best, nodePos(x)); for (const d of depsOf(x)) st.push(d); }
    return best;
  };
  const closurePositions = (n) => {
    const out = []; const seen = new Set(); const st = [n];
    while (st.length) { const x = st.pop(); if (seen.has(x) || visited.has(x)) continue; seen.add(x); out.push(nodePos(x)); for (const d of depsOf(x)) st.push(d); }
    return out.sort((a, b) => a - b);
  };
  const lexLess = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i];
    return a.length < b.length;
  };
  const visit = (f) => {
    visited.add(f);
    const froms = [...(imports.get(f) || new Map()).keys()];
    const order = [];
    let rest = froms.slice();
    while (rest.length) {
      const live = rest.filter((fr) => !visited.has(nodeOf(f, fr)));
      if (!live.length) break;
      let pick = null, pm = null;
      for (const fr of live) {
        const m = closurePositions(nodeOf(f, fr));
        if (process.env.SIMDEBUG && f.endsWith("router.js")) simEmit.push(`   cand ${fr}: ${m.slice(0, 8).join(",")}`);
        if (!pm || lexLess(m, pm)) { pm = m; pick = fr; }
      }
      order.push(pick); rest = rest.filter((x) => x !== pick);
      const n = nodeOf(f, pick);
      if (n.startsWith("ext:")) visited.add(n); else visit(n);
    }
    rest.sort((a, b) => importPos(f, a) - importPos(f, b));
    chosenOrder.set(f, [...order, ...rest]);
    if (process.env.SIMDEBUG) simEmit.push(`${fileMinLine.get(f)} ${f}  <= ${chosenOrder.get(f).map((x) => `${x}@${importPos(f, x)}`).join(" ")}`);
  };
  const entry = [...files.keys()].reduce((a, b) => (fileMinLine.get(a) > fileMinLine.get(b) ? a : b));
  visit(entry);
  for (const f of [...files.keys()].sort((a, b) => fileMinLine.get(a) - fileMinLine.get(b))) if (!visited.has(f)) { warn.push(`unreachable from entry: ${f}`); visit(f); }
}
// renderer: vendor packages are split into many small modules (one per lucide icon, framer-motion internals...),
// so a plain sort by original position tracks the layout better than the closure simulation.
const importRank = cfg.orderMode === "position" ? (f, from) => importPos(f, from) : (f, from) => chosenOrder.get(f).indexOf(from);
if (process.env.SIMDEBUG) { fs.mkdirSync(cfg.outDir, { recursive: true }); fs.writeFileSync(path.join(cfg.outDir, "_sim.txt"), simEmit.join("\n")); }
let written = 0;
const printedComments = new Set();
for (const [f, F] of files) {
  const out = [];
  const imp = imports.get(f) || new Map();
  if (fragmentFiles.has(f)) {
    if (!imp.has("react")) imp.set("react", { named: new Map(), def: null, ns: null });
    imp.get("react").named.set("Fragment\0Fragment", ["Fragment", "Fragment"]);
  }
  const entries = [...imp.entries()].sort((a, b) => importRank(f, a[0]) - importRank(f, b[0]));
  for (const [from, e] of entries) {
    const parts = [];
    if (e.def) parts.push(e.def);
    if (e.ns) { if (e.def) out.push(`import ${e.def} from ${JSON.stringify(from)};`); out.push(`import * as ${e.ns} from ${JSON.stringify(from)};`); if (!e.named.size) continue; parts.length = 0; }
    const named = [...e.named.values()].map(([i, l]) => (i === l ? i : `${i} as ${l}`));
    if (named.length) parts.push(`{ ${named.join(", ")} }`);
    if (parts.length) out.push(`import ${parts.join(", ")} from ${JSON.stringify(from)};`);
  }
  if (out.length) out.push("");
  for (const i of F.stmts) {
    const n = stmtPaths[i].node;
    const names = Object.keys(t.getBindingIdentifiers(n, false, true));
    const origNames = Object.keys(bindings).filter((b) => bindingStmt.get(b) === i);
    const exp = origNames.some((b) => exportsNeeded.has(b) || (cfg.forceExport || []).includes(b));
    for (const k of ["leadingComments", "trailingComments"]) if (n[k]) n[k] = n[k].filter((c) => { if (printedComments.has(c.start)) return false; printedComments.add(c.start); return true; });
    let node = n;
    if (exp && t.isDeclaration(n)) {
      node = t.exportNamedDeclaration(n, []);
      node.leadingComments = n.leadingComments; n.leadingComments = null;
    }
    const code = generate(node, { comments: true, jsescOption: { minimal: true } }).code;
    if (exp && t.isDeclaration(n)) { n.leadingComments = node.leadingComments; }
    const prev = out.length ? out[out.length - 1] : "";
    if (prev !== "" && (prev.includes("\n") || code.includes("\n"))) out.push("");
    out.push(code);
  }
  const target = path.join(cfg.outDir, f);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out.join("\n") + "\n");
  written++;
}
// statements dropped / summary
fs.writeFileSync(path.join(cfg.outDir, "_split-warnings.txt"), warn.join("\n"));
console.log(`files ${written}, warnings ${warn.length}`);
