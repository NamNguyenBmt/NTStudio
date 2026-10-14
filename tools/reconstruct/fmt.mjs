import fs from "node:fs";
import path from "node:path";
import * as prettier from "prettier";
const dir = process.argv[2];
const opts = { printWidth: 120, objectWrap: "collapse", arrowParens: "always", trailingComma: "all" };
let n = 0, bad = [];
async function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) await walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name)) {
      try {
        const src = fs.readFileSync(p, "utf8");
        fs.writeFileSync(p, await prettier.format(src, { ...opts, parser: "babel" }));
        n++;
      } catch (err) { bad.push(p + ": " + String(err.message).split("\n")[0]); }
    }
  }
}
await walk(dir);
console.log("formatted", n, "failed", bad.length); bad.forEach((b) => console.log(b));
