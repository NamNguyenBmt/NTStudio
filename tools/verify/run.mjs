// Build harness (esbuild) rồi chạy bằng Electron. Dùng: node tools/verify/run.mjs [thư-mục-kết-quả]
// Cần chạy `npm run build` trước (dùng out/preload và out/renderer của bản dựng lại).
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outFile = join(root, "out/harness/index.js"); // cùng độ sâu với out/main để đường dẫn drizzle/, resources/ đúng
await build({
  entryPoints: [join(here, "harness-main.js")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron", ...Object.keys(pkg.dependencies)],
  logLevel: "warning",
});
const out = resolve(process.argv[2] ?? join(root, "out/harness-report"));
const userData = mkdtempSync(join(tmpdir(), "omnira-harness-"));
const env = {
  ...process.env,
  HARNESS_OUT: out,
  HARNESS_A: join(here, "baseline/renderer/index.html"),
  HARNESS_B: join(root, "out/renderer/index.html"),
  HARNESS_PRELOAD: join(root, "out/preload/index.js"),
};
const electron = join(root, "node_modules/electron/dist/electron.exe");
const r = spawnSync(electron, [outFile, `--user-data-dir=${userData}`], { env, stdio: "inherit", cwd: root });
console.log(`kết quả: ${out}  (dữ liệu tạm: ${userData})`);
process.exit(r.status ?? 1);
