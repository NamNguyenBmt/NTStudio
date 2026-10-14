// For each package, print the latest version (matching an optional prefix) published before a cutoff date.
const { execSync } = require("child_process");
const cutoff = process.argv[2];
for (const spec of process.argv.slice(3)) {
  const [name, prefix = ""] = spec.split("@").reduce((acc, p, i, arr) => (spec.startsWith("@") ? (i === 1 ? ["@" + p, arr[2] || ""] : acc) : [arr[0], arr[1] || ""]), []);
  const time = JSON.parse(execSync(`npm view ${name} time --json`, { encoding: "utf8" }));
  const vs = Object.entries(time).filter(([v, d]) => /^\d+\.\d+\.\d+$/.test(v) && v.startsWith(prefix) && d < cutoff).sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const last = vs[vs.length - 1];
  console.log(`${name}${prefix ? "@" + prefix : ""}: ${last ? last[0] + "  (" + last[1].slice(0, 10) + ")" : "-"}`);
}
