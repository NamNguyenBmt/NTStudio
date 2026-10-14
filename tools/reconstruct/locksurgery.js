// Rearrange package-lock.json so the production layout matches the shipped app.asar.
// usage: node locksurgery.js <projectDir>
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const proj = process.argv[2];
const semver = require(path.resolve(proj, "node_modules/app-builder-lib/node_modules/semver"));
const lockPath = path.join(proj, "package-lock.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const P = lock.packages;
const meta = (name, version) => {
  const j = JSON.parse(execSync(`npm view ${name}@${version} dist.tarball dist.integrity dependencies license engines --json`, { encoding: "utf8" }));
  return j;
};
function move(from, to) {
  if (!P[from]) throw new Error("missing " + from);
  if (P[to]) throw new Error("occupied " + to);
  P[to] = P[from]; delete P[from];
  // nested children move too
  for (const k of Object.keys(P)) if (k.startsWith(from + "/")) { P[to + k.slice(from.length)] = P[k]; delete P[k]; }
  console.log("moved", from, "->", to);
}
function setEntry(key, name, version, dev) {
  const m = meta(name, version);
  const e = { version, resolved: m["dist.tarball"], integrity: m["dist.integrity"] };
  if (dev) e.dev = true;
  if (m.license) e.license = m.license;
  if (m.dependencies) e.dependencies = m.dependencies;
  P[key] = e;
  console.log("set", key, version, dev ? "(dev)" : "");
}
move("node_modules/json-schema-to-ts/node_modules/@babel/runtime", "node_modules/@babel/runtime");
move("node_modules/axios/node_modules/follow-redirects", "node_modules/follow-redirects");
// string_decoder 1.3.0 + safe-buffer 5.2.1 at the top; old ones nested for readable-stream@2 users (dev)
const old = { sd: P["node_modules/string_decoder"], sb: P["node_modules/safe-buffer"] };
setEntry("node_modules/string_decoder", "string_decoder", "1.3.0", false);
setEntry("node_modules/safe-buffer", "safe-buffer", "5.2.1", false);
for (const owner of ["node_modules/archiver-utils", "node_modules/lazystream"]) {
  P[owner + "/node_modules/string_decoder"] = { ...old.sd, dev: true };
  P[owner + "/node_modules/safe-buffer"] = { ...old.sb, dev: true };
  console.log("nested old string_decoder/safe-buffer under", owner);
}
// validate: every dependency of every package resolves (node algorithm) to a satisfying version
const resolveFrom = (key, dep) => {
  let base = key;
  for (;;) {
    const cand = (base ? base + "/" : "") + "node_modules/" + dep;
    if (P[cand]) return cand;
    if (!base) return null;
    const i = base.lastIndexOf("/node_modules/");
    base = i >= 0 ? base.slice(0, i) : "";
  }
};
let bad = 0;
for (const [key, e] of Object.entries(P)) {
  for (const [dep, range] of Object.entries({ ...(e.dependencies || {}), ...(key === "" ? e.devDependencies || {} : {}) })) {
    const r = resolveFrom(key, dep);
    if (!r) { if (!(e.optionalDependencies || {})[dep]) { console.log("UNRESOLVED", key || "<root>", dep); bad++; } continue; }
    const v = P[r].version;
    if (v && !/^(file|link|npm|git|http)/.test(range) && !semver.satisfies(v, range, { includePrerelease: true })) { console.log("UNSATISFIED", key || "<root>", dep, range, "->", r, v); bad++; }
  }
}
console.log("problems:", bad);
if (!bad) fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
