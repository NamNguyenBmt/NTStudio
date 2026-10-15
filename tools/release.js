// Phát hành bản mới: tăng phiên bản → build → đăng bộ cài lên GitHub Releases → commit, tag, push mã nguồn.
// App đã cài sẽ thấy bản mới trong vòng 30 phút (hoặc lần mở app kế tiếp) và hỏi cập nhật.
// Dùng: npm run release            (1.0.4 → 1.0.5)
//       npm run release -- minor   (1.0.4 → 1.1.0)
//       npm run release -- major   (1.0.4 → 2.0.0)
const { execSync } = require("child_process");
const { readFileSync } = require("fs");
const { join } = require("path");

const root = join(__dirname, "..");
const bump = process.argv[2] ?? "patch";
if (!["patch", "minor", "major"].includes(bump)) {
  console.error(`Kiểu tăng phiên bản không hợp lệ: ${bump} (patch | minor | major)`);
  process.exit(1);
}

const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();

if (out("git rev-parse --abbrev-ref HEAD") !== "main") {
  console.error("Chỉ phát hành từ nhánh main");
  process.exit(1);
}

// Token để đăng release: lấy từ biến môi trường hoặc từ GitHub CLI đã đăng nhập
let token = process.env.GH_TOKEN;
if (!token) {
  try {
    token = out("gh auth token");
  } catch {
    console.error("Cần GH_TOKEN hoặc đăng nhập GitHub CLI (gh auth login)");
    process.exit(1);
  }
}

run(`npm version ${bump} --no-git-tag-version`, { stdio: "ignore" });
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
console.log(`\n== Phát hành NT Studio ${version}\n`);

try {
  run("npm run build");
} catch {
  console.error(`\nBuild ${version} lỗi – trả lại số phiên bản cũ`);
  run("git checkout -- package.json package-lock.json");
  process.exit(1);
}

// Đẩy mã nguồn lên trước: GitHub tạo tag v<version> cho release tại commit mới nhất của main
run("git add -A");
run(`git commit -q -m "Phát hành v${version}"`);
run("git push -q origin main");

try {
  run("npx electron-builder --win --x64 --publish always", { env: { ...process.env, GH_TOKEN: token } });
} catch {
  console.error(`\nĐăng release ${version} lỗi – mã nguồn đã push; chạy lại: npx electron-builder --win --x64 --publish always`);
  process.exit(1);
}
run("git fetch -q origin --tags");
console.log(`\n== Đã phát hành ${version}: https://github.com/NamNguyenBmt/NTStudio/releases/tag/v${version}`);
