// Orchestrate: split main + renderer, merge shared modules, format. usage: node run.js <outRoot>
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const S = __dirname;
const outRoot = path.resolve(process.argv[2]);
const readManifest = (f, prefix) =>
  fs.readFileSync(path.join(S, f), "utf8").trim().split(/\r?\n/).map((l) => {
    const [a, b] = l.trim().split(/\s+/);
    return [+a, b.replace(/^R\//, prefix)];
  });

const appRanges = [[3628, 3677], [15152, 15167], [18486, 18582], [26858, 27294], [27493, 30073], [33821, 39844], [40423, 48167]];
const mainCfg = { bundle: path.join(S, "input/main.js"), outDir: path.join(outRoot, "_main"), mode: "main", defaultImports: ["os"], manifest: readManifest("main-manifest.txt", "") };
const rCfg = {
  bundle: path.join(S, "input/renderer.js"), outDir: path.join(outRoot, "_renderer"), mode: "renderer", orderMode: "position", cls: path.join(S, "cls.json"), jsx: true,
  appRanges, vendorMap: JSON.parse(fs.readFileSync(path.join(S, "vendormap.json"), "utf8")), manifest: readManifest("r-manifest.txt", "renderer/src/"),
};
const preCfg = { bundle: path.join(S, "input/preload.js"), outDir: path.join(outRoot, "_preload"), mode: "preload", manifest: [[1, "shared/ipc.js"], [18, "shared/api.js"], [19, "preload/index.js"]] };
for (const [name, c] of [["main", mainCfg], ["renderer", rCfg], ["preload", preCfg]]) {
  const f = path.join(S, `cfg-${name}.json`);
  fs.writeFileSync(f, JSON.stringify(c));
  console.log(`--- split ${name}`);
  process.stdout.write(execFileSync("node", [path.join(__dirname, "split.js"), f], { encoding: "utf8", maxBuffer: 1 << 26 }));
  const w = fs.readFileSync(path.join(c.outDir, "_split-warnings.txt"), "utf8").trim();
  if (w) console.log("WARN:\n" + w);
}
