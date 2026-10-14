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

// nodes created by the splitter remember the source range of the node they replace (text-mode printing)
function markNew(node, old) { node._new = true; node._range = [old._range ? old._range[0] : old.start, old._range ? old._range[1] : old.end]; return node; }

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
  for (let k = 1; k < children.length; k++)
    if (t.isJSXText(children[k]) && t.isJSXText(children[k - 1])) children[k] = t.jsxExpressionContainer(t.stringLiteral(children[k].value));
  if (fragment) {
    if (attrs.length) {
      // keyed fragment -> <Fragment key>
      name = t.jsxIdentifier("Fragment"); usedFragment.add(node);
    } else {
      jsxConverted++;
      const fr = t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), children);
      fr._call = node;
      return fr;
    }
  }
  jsxConverted++;
  const selfClosing = children.length === 0;
  const el = t.jsxElement(t.jsxOpeningElement(name, attrs, selfClosing), selfClosing ? null : t.jsxClosingElement(t.cloneNode(name)), children, selfClosing);
  el._call = node;
  return el;
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
          if (r) { if (t.isJSXElement(r) && r.openingElement.name.name === "Fragment") fragmentFiles.add(stmtFile[i]); p.replaceWith(markNew(r, p.node)); }
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
  else if (kind === "default") e.def = local; else if (kind === "ns") e.ns = local; else if (kind === "side") e.side = true;
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
        paths.forEach((p) => p.parentPath.replaceWith(markNew(t.identifier(alias.get(p.parentPath.node.property.name)), p.parentPath.node)));
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
        pp.replaceWith(markNew(t.identifier(local), pp.node));
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
// ---------- exact module order (rollup DFS post-order) ----------
// T = modules in original layout order (= rollup's execution order, a DFS post-order of the imports).
// The tree is parsed back from T; where the recovered graph lacks an edge the original had (imports used only by
// tree-shaken code) a side-effect import is added. CJS externals are required in DFS *pre-order* of first meeting,
// which pins down ancestors too: the solver adds "S must be an ancestor of f" constraints until both orders match.
const vendorPos = new Map(); // renderer: package -> any line inside its (contiguous) block
for (const [v, vm] of Object.entries(vendorMap)) {
  if (!bindingStmt.has(v)) continue;
  const line = stmtPaths[bindingStmt.get(v)].node.loc.start.line;
  vendorPos.set(vm.from, Math.min(vendorPos.get(vm.from) ?? Infinity, line));
}
if (cfg.jsxRuntimeLine) vendorPos.set("react/jsx-runtime", cfg.jsxRuntimeLine);
const isTNode = (n) => !!n && (!n.startsWith("ext:") || vendorPos.has(n.slice(4)));
const tPos = (n) => (n.startsWith("ext:") ? vendorPos.get(n.slice(4)) : fileMinLine.get(n));
const hasJsx = (f) => cfg.jsx && files.get(f).stmts.some((i) => { let h = false; const walk = (n) => { if (h || !n || typeof n.type !== "string") return; if (n._new && (t.isJSXElement(n) || t.isJSXFragment(n))) { h = true; return; } for (const k of t.VISITOR_KEYS[n.type] || []) { const c = n[k]; Array.isArray(c) ? c.forEach(walk) : walk(c); } }; walk(stmtPaths[i].node); return h; });
const jsxFiles = new Set([...files.keys()].filter(hasJsx));
const realDeps = (n) => {
  if (n.startsWith("ext:")) return [];
  const ds = [...(imports.get(n) || new Map()).keys()].map((from) => nodeOf(n, from)).filter(isTNode);
  if (jsxFiles.has(n) && vendorPos.has("react/jsx-runtime")) ds.unshift("ext:react/jsx-runtime");
  return [...new Set(ds)];
};
const tNodes = new Set(files.keys());
for (const f of files.keys()) for (const d of realDeps(f)) tNodes.add(d);
const T = [...tNodes].sort((a, b) => tPos(a) - tPos(b));
const tIndex = new Map(T.map((n, i) => [n, i]));
const entryNode = T[T.length - 1];
const requireLine = new Map();
for (const [v, mod] of Object.entries(requireInfo)) requireLine.set(mod, Math.min(requireLine.get(mod) ?? Infinity, stmtPaths[bindingStmt.get(v)].node.loc.start.line));
const extOf = (f) => [...(imports.get(f) || new Map()).keys()].filter((from) => !isTNode(nodeOf(f, from)));
const E = [...new Set(Object.values(requireInfo))].filter((m) => [...files.keys()].some((f) => extOf(f).includes(m))).sort((a, b) => requireLine.get(a) - requireLine.get(b));
const importersOf = new Map(E.map((x) => [x, [...files.keys()].filter((f) => extOf(f).includes(x))]));

function buildTree(rule, mustContain, mustNot) {
  const treeChildren = new Map(), synthetic = new Map(), parent = new Map(); let cost = 0;
  const stack = [];
  const rootOf = (d) => { let x = d; while (parent.has(x)) x = parent.get(x); return x; };
  for (const n of T) {
    const ds = new Set(realDeps(n));
    let k = stack.length;
    if (rule === "zero") { while (k > 0 && ds.has(stack[k - 1])) k--; }
    else { for (let i = 0; i < stack.length; i++) if (ds.has(stack[i])) { k = i; break; } }
    if (jsxFiles.has(n)) { const j = stack.indexOf("ext:react/jsx-runtime"); if (j >= 0) k = Math.min(k, j); }
    for (const d of mustContain.get(n) || []) { if (!parent.has(d) && !stack.includes(d)) continue; const j = stack.indexOf(rootOf(d)); if (j >= 0) k = Math.min(k, j); }
    for (const d of mustNot.get(n) || []) { if (!parent.has(d) && !stack.includes(d)) continue; const j = stack.indexOf(rootOf(d)); if (j >= 0) k = Math.max(k, j + 1); }
    if (n === entryNode) k = 0; // the entry adopts whatever is left
    const ch = stack.splice(k);
    for (const c of ch) parent.set(c, n);
    const syn = ch.filter((c) => !ds.has(c));
    cost += syn.length; synthetic.set(n, syn); treeChildren.set(n, ch);
    stack.push(n);
  }
  const subtree = new Map();
  const sub = (n) => { if (subtree.has(n)) return subtree.get(n); const s = new Set([n]); subtree.set(n, s); for (const c of treeChildren.get(n) || []) for (const x of sub(c)) s.add(x); return s; };
  T.forEach(sub);
  return { treeChildren, synthetic, cost, parent, subtree };
}
function keyFor(tree, f, from) {
  const n = nodeOf(f, from);
  if (!isTNode(n)) return [-2, requireLine.get(from) ?? 0, 0];
  const ch = tree.treeChildren.get(f) || [];
  const k = ch.indexOf(n);
  if (k >= 0) return [k, 0, 0];
  for (let i = 0; i < ch.length; i++) if (tree.subtree.get(ch[i]).has(n)) return [i, 1, tIndex.get(n)];
  return [-1, tIndex.get(n), 0];
}
const keyCmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
// Walk the tree in import order and place every external import where the pre-order walk must meet it.
function simulateExternals(tree) {
  const finalOrder = new Map(); let failure = null;
  let ptr = 0; const met = new Set(); const seen = new Set();
  const visit = (f) => {
    seen.add(f);
    const exts = new Set(extOf(f));
    const before = [...exts].filter((x) => met.has(x));
    const synFrom = (tree.synthetic.get(f) || []).filter((c) => !c.startsWith("ext:")).map((c) => relPath(f, c));
    const internal = [...new Set([...(imports.get(f) || new Map()).keys(), ...synFrom])].filter((from) => isTNode(nodeOf(f, from))).sort((a, b) => keyCmp(keyFor(tree, f, a), keyFor(tree, f, b)));
    const out = [];
    const flush = () => { while (ptr < E.length && exts.has(E[ptr]) && !met.has(E[ptr])) { out.push(E[ptr]); met.add(E[ptr]); ptr++; } };
    flush();
    for (const from of internal) {
      out.push(from);
      const n = nodeOf(f, from);
      if (!n.startsWith("ext:") && !seen.has(n)) visit(n);
      flush();
    }
    for (const x of exts) if (!out.includes(x) && !before.includes(x)) {
      if (!met.has(x)) { if (!failure) failure = { f, x, expected: E[ptr] }; met.add(x); }
      out.push(x);
    }
    finalOrder.set(f, [...before, ...out]);
  };
  if (files.has(entryNode)) visit(entryNode);
  for (const f of files.keys()) if (!seen.has(f)) visit(f);
  return { finalOrder, failure };
}
const mustContain = new Map(), mustNot = new Map();
let tree, sim, rounds = 0;
for (;;) {
  const cands = ["zero", "deep"].map((r) => buildTree(r, mustContain, mustNot));
  tree = cands.reduce((a, b) => (b.cost < a.cost ? b : a));
  sim = simulateExternals(tree);
  if (!sim.failure || ++rounds > 60) break;
  // the expected external must be met before `f` starts: make one of its importers (laid out after f) an ancestor of f
  const { f, expected } = sim.failure;
  const add = (m, a, b) => { if (!m.has(a)) m.set(a, new Set()); if (m.get(a).has(b)) return false; m.get(a).add(b); return true; };
  // an external expected earlier is met inside f's own subtree -> f must not contain that meeting module
  const earlier = E.slice(0, E.indexOf(expected));
  const importersY = new Set(importersOf.get(expected) || []);
  // chain f .. (child of the nearest ancestor that imports the expected external)
  const chain = [f];
  for (let p = tree.parent.get(f); p && !importersY.has(p); p = tree.parent.get(p)) chain.push(p);
  const hasAncestorImporter = (() => { for (let p = tree.parent.get(f); p; p = tree.parent.get(p)) if (importersY.has(p)) return true; return false; })();
  let changed = false;
  if (hasAncestorImporter) for (const c of chain) for (const x of earlier) for (const m of importersOf.get(x) || []) if (m !== c && tree.subtree.get(c)?.has(m)) changed = add(mustNot, c, m) || changed;
  if (!changed) {
    const S = (importersOf.get(expected) || []).filter((s) => tIndex.get(s) > tIndex.get(f) && !(mustContain.get(s) || new Set()).has(f)).sort((a, b) => tIndex.get(a) - tIndex.get(b))[0];
    if (!S) { warn.push(`REQUIRE ORDER: cannot place ${expected} before ${f}`); break; }
    add(mustContain, S, f);
  }
}
if (sim.failure) warn.push(`REQUIRE ORDER: ${sim.failure.f} meets ${sim.failure.x} before ${sim.failure.expected}`);
if (process.env.TREEDEBUG) {
  const chain = (n) => { const c = [n]; for (let p = tree.parent.get(n); p; p = tree.parent.get(p)) c.push(p); return c.map((x) => `${tPos(x)}:${x.replace(/^.*\//, "")}`).join(" <- "); };
  for (const n of process.env.TREEDEBUG.split(",")) { const f = [...files.keys()].find((x) => x.endsWith(n)); if (f) console.log("CHAIN", chain(f), "| children:", (tree.treeChildren.get(f) || []).map((x) => tPos(x) + ":" + x.replace(/^.*\//, "")).join(" ")); }
  console.log("mustContain", JSON.stringify([...mustContain].map(([k, v]) => [k, [...v]])));
}
const { treeChildren, subtree } = tree;
for (const n of T) for (const d of realDeps(n)) if (tIndex.get(d) > tIndex.get(n)) {
  let a = false; for (let p = tree.parent.get(n); p; p = tree.parent.get(p)) if (p === d) { a = true; break; }
  if (!a) warn.push(`ORDER: ${n} imports ${d} which is laid out later`);
}
console.log(`module order: ${T.length} nodes, ${tree.cost} side-effect imports, ${mustContain.size} ancestor constraints, ${rounds} repair rounds`);
for (const [n, syn] of tree.synthetic) for (const c of syn) {
  if (c.startsWith("ext:")) { if (c !== "ext:react/jsx-runtime") addImport(n, c.slice(4), "side"); continue; }
  addImport(n, relPath(n, c), "side");
}
const importKey = (f, from) => keyFor(tree, f, from);
const finalOrder = Object.keys(requireInfo).length ? sim.finalOrder : new Map();
const importRankOf = (f, from) => (finalOrder.has(f) ? finalOrder.get(f).indexOf(from) : null);
// ---------- text-mode printing: original bundle text + minimal patches ----------
// Keeps esbuild's layout (which mirrors the original source line structure), so rebuilding reproduces the bundle.
const PURE_RE = /^\s*[@#]__PURE__\s*$/;
const pureComments = (ast.comments || []).filter((c) => PURE_RE.test(c.value));
const lineStartAt = (pos) => src.lastIndexOf("\n", pos - 1) + 1;
const lineIndentAt = (pos) => { const s = lineStartAt(pos); let i = s; while (src[i] === " ") i++; return i - s; };
function reindent(text, from, to) {
  if (from === to || !text.includes("\n")) return text;
  return text.split("\n").map((l, k) => {
    if (k === 0) return l;
    let i = 0; while (i < l.length && l[i] === " ") i++;
    return " ".repeat(Math.max(0, i - from + to)) + l.slice(i);
  }).join("\n");
}
const KEYS = t.VISITOR_KEYS;
function patchedText(rootNode, start, end) {
  const edits = [];
  const walk = (n, parent) => {
    if (!n || typeof n.type !== "string") return;
    if (n._new) {
      const code = t.isJSXElement(n) || t.isJSXFragment(n) ? printJsx(n, lineIndentAt(n._range[0])) : generate(n, { jsescOption: { minimal: true } }).code;
      edits.push([n._range[0], n._range[1], code]);
      return;
    }
    if (t.isObjectProperty(n) && !n.computed && t.isIdentifier(n.key) && n.key.start != null) {
      const wasShorthand = n.value && n.value.start === n.key.start; // parser clones the key for `{ a }`
      const v = n.value;
      if (wasShorthand) {
        if (t.isIdentifier(v) && v.name !== n.key.name) { edits.push([n.start, n.end, `${n.key.name}: ${v.name}`]); return; }
        if (t.isAssignmentPattern(v) && t.isIdentifier(v.left) && v.left.name !== n.key.name) { edits.push([v.left.start, v.left.end, `${n.key.name}: ${v.left.name}`]); }
      } else {
        // `token: token2` that became `token: token` -> shorthand again (rollup had expanded it)
        if (t.isIdentifier(v) && v.name === n.key.name && src.slice(v.start, v.end) !== v.name) { edits.push([n.start, n.end, v.name]); return; }
        if (t.isAssignmentPattern(v) && t.isIdentifier(v.left) && v.left.name === n.key.name && src.slice(v.left.start, v.left.end) !== v.left.name && t.isObjectPattern(parent)) { edits.push([n.key.start, v.left.end, v.left.name]); }
      }
    }
    if ((t.isIdentifier(n) || t.isJSXIdentifier(n)) && n.start != null && src.slice(n.start, n.end) !== n.name) edits.push([n.start, n.end, n.name]);
    for (const k of KEYS[n.type] || []) {
      const c = n[k];
      if (Array.isArray(c)) c.forEach((x) => walk(x, n)); else walk(c, n);
    }
  };
  walk(rootNode, null);
  for (const c of pureComments) if (c.start >= start && c.end <= end) {
    let e = c.end; if (src[e] === " ") e++;
    edits.push([c.start, e, ""]);
  }
  edits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = "", pos = start, lastEnd = -1;
  for (const [s, e, r] of edits) {
    if (s < lastEnd) continue; // nested inside an earlier replacement
    out += src.slice(pos, s) + r; pos = e; lastEnd = e;
  }
  return out + src.slice(pos, end);
}
// Text of an expression re-indented to `ind` (its first line continues the current line).
function exprText(e, ind) {
  if (e._new) return t.isJSXElement(e) || t.isJSXFragment(e) ? printJsx(e, ind) : generate(e, { jsescOption: { minimal: true } }).code;
  if (e.start == null) return generate(e, { jsescOption: { minimal: true } }).code;
  return reindent(patchedText(e, e.start, e.end), lineIndentAt(e.start), ind);
}
const jsxNameText = (n) => (t.isJSXMemberExpression(n) ? `${jsxNameText(n.object)}.${n.property.name}` : t.isJSXNamespacedName(n) ? `${n.namespace.name}:${n.name.name}` : n.name);
function printJsx(n, ind) {
  const call = n._call;
  // esbuild splits jsx( across lines iff the opening tag had a line break outside attribute values
  const expanded = !!call && src[call.callee.end] === "(" && src[call.callee.end + 1] === "\n";
  const pad = (k) => " ".repeat(k);
  const isFrag = t.isJSXFragment(n);
  const name = isFrag ? "" : jsxNameText(n.openingElement.name);
  const attrs = isFrag ? [] : n.openingElement.attributes.map((a) => {
    const ai = expanded ? ind + 2 : ind;
    if (t.isJSXSpreadAttribute(a)) return `{...${exprText(a.argument, ai)}}`;
    const an = jsxNameText(a.name);
    if (!a.value) return an;
    if (t.isStringLiteral(a.value)) return `${an}="${a.value.value}"`;
    return `${an}={${exprText(a.value.expression, ai)}}`;
  });
  const kids = n.children.map((c) => {
    if (t.isJSXText(c)) return c.value;
    if (t.isJSXElement(c) || t.isJSXFragment(c)) return printJsx(c, ind + 2);
    return `{${exprText(c.expression, ind + 2)}}`;
  });
  let open;
  if (!attrs.length) open = `<${name}`;
  else if (expanded) open = `<${name}\n${attrs.map((a) => pad(ind + 2) + a).join("\n")}\n${pad(ind)}`;
  else open = `<${name} ${attrs.join(" ")}`;
  if (!kids.length) return isFrag ? "<></>" : open + (expanded ? "/>" : " />");
  const close = `</${name}>`;
  const inline = `${open}>${kids.join("")}${close}`;
  if (!expanded && !inline.includes("\n") && ind + inline.length <= 120) return inline;
  return `${open}>\n${kids.map((k) => pad(ind + 2) + k).join("\n")}\n${pad(ind)}${close}`;
}
function statementText(i, exp) {
  const sp = stmtPaths[i], n = sp.node;
  const lead = (n.leadingComments || []).filter((c) => !PURE_RE.test(c.value) && !printedComments.has(c.start));
  lead.forEach((c) => printedComments.add(c.start));
  const trail = (n.trailingComments || []).filter((c) => !PURE_RE.test(c.value) && c.loc.start.line === n.loc.end.line);
  trail.forEach((c) => printedComments.add(c.start));
  const end = trail.length ? trail[trail.length - 1].end : n.end;
  const head = lead.length ? src.slice(lead[0].start, n.start) : "";
  return head + (exp && t.isDeclaration(n) ? "export " : "") + patchedText(n, n.start, end);
}

let written = 0;
const printedComments = new Set();
for (const [f, F] of files) {
  const out = [];
  const imp = imports.get(f) || new Map();
  if (fragmentFiles.has(f)) {
    if (!imp.has("react")) imp.set("react", { named: new Map(), def: null, ns: null });
    imp.get("react").named.set("Fragment\0Fragment", ["Fragment", "Fragment"]);
  }
  const entries = [...imp.entries()].sort((a, b) => finalOrder.has(f) ? importRankOf(f, a[0]) - importRankOf(f, b[0]) : keyCmp(importKey(f, a[0]), importKey(f, b[0])));
  for (const [from, e] of entries) {
    const parts = [];
    if (e.def) parts.push(e.def);
    if (e.ns) { if (e.def) out.push(`import ${e.def} from ${JSON.stringify(from)};`); out.push(`import * as ${e.ns} from ${JSON.stringify(from)};`); if (!e.named.size) continue; parts.length = 0; }
    const named = [...e.named.values()].map(([i, l]) => (i === l ? i : `${i} as ${l}`));
    if (named.length) parts.push(`{ ${named.join(", ")} }`);
    if (parts.length) out.push(`import ${parts.join(", ")} from ${JSON.stringify(from)};`);
    else if (e.side && !e.ns && !e.def) out.push(`import ${JSON.stringify(from)};`);
  }
  if (out.length) out.push("");
  for (const i of F.stmts) {
    const n = stmtPaths[i].node;
    const names = Object.keys(t.getBindingIdentifiers(n, false, true));
    const origNames = Object.keys(bindings).filter((b) => bindingStmt.get(b) === i);
    const exp = origNames.some((b) => exportsNeeded.has(b) || (cfg.forceExport || []).includes(b));
    if (cfg.textMode) {
      const code = statementText(i, exp);
      const prev = out.length ? out[out.length - 1] : "";
      if (prev !== "" && (prev.includes("\n") || code.includes("\n"))) out.push("");
      out.push(code);
      continue;
    }
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
