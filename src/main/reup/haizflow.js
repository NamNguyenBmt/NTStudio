// Cầu nối tới HaizFlow (https://github.com/MachHongHai/HaizFlow) – ứng dụng reup của tác giả Mạch Hồng Hải.
// HaizFlow theo giấy phép "Source-Available 1.0": KHÔNG được nhúng/phân phối lại mã nguồn hay bộ cài trong NT Studio.
// Vì vậy NT Studio chỉ: tải bộ cài CHÍNH THỨC từ GitHub Releases của tác giả, mở bản đã cài, và gom video thành phẩm vào Kho nội dung.
import { app, shell } from "electron";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { ApiError } from "../errors";
import { getSetting, putSetting } from "../flow/session";
import { mediaDir } from "../media/paths";

export const HAIZFLOW_REPO = "MachHongHai/HaizFlow";
export const HAIZFLOW_SITE = "https://haizflow.pages.dev/";
const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{799AE20D-E7A5-4D79-96DE-708E161BF32A}_is1";
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm"]);
const SCAN_DEPTH = 4;
const SCAN_LIMIT = 400;

const download = { state: "idle", received: 0, total: 0, version: null, error: null };

const prefs = () => getSetting("reup.haizflow", { exePath: null, folders: [], imported: {} });
const savePrefs = (patch) => putSetting("reup.haizflow", { ...prefs(), ...patch });

function regValue(name) {
  return new Promise((resolve) => {
    execFile("reg", ["query", UNINSTALL_KEY, "/v", name], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = String(stdout).match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`));
      resolve(m ? m[1].trim() : null);
    });
  });
}

/** Tìm HaizFlow.exe: đường dẫn người dùng chọn → khóa gỡ cài đặt của Inno Setup → thư mục mặc định */
async function findExe() {
  const custom = prefs().exePath;
  if (custom && existsSync(custom)) return custom;
  const location = await regValue("InstallLocation");
  const candidates = [
    location && join(location, "HaizFlow.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "HaizFlow", "HaizFlow.exe")
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Thư mục có video thành phẩm: thư mục xuất gần nhất của HaizFlow + dự án HaizFlow + thư mục người dùng thêm */
function watchFolders(exe) {
  const out = [];
  const add = (path, label, auto) => {
    if (path && existsSync(path) && !out.some((f) => f.path.toLowerCase() === path.toLowerCase())) out.push({ path, label, auto });
  };
  if (exe) {
    const data = join(dirname(exe), "runtime", "data");
    add(readJson(join(data, "desktop-settings.json"))?.last_export_directory, "Thư mục xuất của HaizFlow", true);
    add(join(data, "projects"), "Dự án HaizFlow", true);
  }
  for (const f of prefs().folders) add(f, "Thư mục bạn thêm", false);
  return out;
}

function scan(dir, depth, found) {
  if (depth < 0 || found.length >= SCAN_LIMIT) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // Bỏ thư mục tạm / bộ nhớ đệm của HaizFlow (clip TTS, bản xem trước…)
      if (!/^(temp|tmp|cache|input|\..*)$/i.test(e.name)) scan(p, depth - 1, found);
    } else if (VIDEO_EXT.has(extname(e.name).toLowerCase())) {
      try {
        const st = statSync(p);
        if (st.size > 0) found.push({ path: p, name: e.name, sizeBytes: st.size, modifiedAt: st.mtimeMs });
      } catch {
      }
    }
    if (found.length >= SCAN_LIMIT) return;
  }
}

export async function haizflowStatus() {
  const exe = await findExe();
  const version = exe ? await regValue("DisplayVersion") : null;
  return {
    installed: !!exe,
    exePath: exe,
    version,
    repo: `https://github.com/${HAIZFLOW_REPO}`,
    site: HAIZFLOW_SITE,
    download: { ...download },
    folders: watchFolders(exe)
  };
}

export async function listOutputs() {
  const exe = await findExe();
  const imported = prefs().imported ?? {};
  const found = [];
  for (const f of watchFolders(exe)) scan(f.path, SCAN_DEPTH, found);
  const seen = new Set();
  return found
    .filter((v) => !seen.has(v.path.toLowerCase()) && seen.add(v.path.toLowerCase()))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, 200)
    .map((v) => ({ ...v, contentId: imported[v.path.toLowerCase()] ?? null }));
}

export async function launch() {
  const exe = await findExe();
  if (!exe) throw new ApiError("NOT_FOUND", "Chưa cài HaizFlow – bấm \"Tải & cài HaizFlow\" trước");
  spawn(exe, [], { cwd: dirname(exe), detached: true, stdio: "ignore" }).unref();
}

export function setExePath(path) {
  if (path && basename(path).toLowerCase() !== "haizflow.exe") throw new ApiError("VALIDATION", "Hãy chọn đúng file HaizFlow.exe");
  savePrefs({ exePath: path });
}

export function addFolder(path) {
  savePrefs({ folders: [...new Set([...prefs().folders, path])] });
}

export function removeFolder(path) {
  savePrefs({ folders: prefs().folders.filter((f) => f !== path) });
}

export function markImported(path, contentId) {
  savePrefs({ imported: { ...prefs().imported, [path.toLowerCase()]: contentId } });
}

/** Chép video thành phẩm vào thư mục media của NT Studio (xóa dự án bên HaizFlow không làm hỏng bài đăng) */
export function copyIntoMedia(src) {
  if (!existsSync(src)) throw new ApiError("NOT_FOUND", `Không tìm thấy ${basename(src)}`);
  const dir = join(mediaDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  const name = `reup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${extname(src).toLowerCase()}`;
  copyFileSync(src, join(dir, name));
  return `uploads/${name}`;
}

async function githubJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "NT-Studio" } });
  if (!res.ok) throw new ApiError("NETWORK", `GitHub trả lỗi ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "NT-Studio" } });
  if (!res.ok) throw new ApiError("NETWORK", `Không tải được ${basename(url)} (${res.status})`);
  return res.text();
}

/** Bản phát hành mới nhất trên GitHub của tác giả */
export async function latestRelease() {
  const rel = await githubJson(`https://api.github.com/repos/${HAIZFLOW_REPO}/releases/latest`);
  const setup = rel.assets?.find((a) => /^HaizFlow-[\d.]+-Setup\.exe$/i.test(a.name));
  const sha = rel.assets?.find((a) => a.name === `${setup?.name}.sha256`);
  return {
    version: String(rel.tag_name ?? "").replace(/^v/, ""),
    publishedAt: rel.published_at ?? null,
    notes: String(rel.body ?? "").slice(0, 4e3),
    url: rel.html_url,
    setup: setup ? { name: setup.name, url: setup.browser_download_url, size: setup.size, sha256Url: sha?.browser_download_url ?? null } : null
  };
}

/** Tải bộ cài chính thức (kiểm SHA-256 của tác giả) rồi mở trình cài đặt – người dùng tự bấm cài */
export async function downloadAndInstall() {
  if (download.state === "downloading") throw new ApiError("CONFLICT", "Đang tải bộ cài HaizFlow");
  const rel = await latestRelease();
  if (!rel.setup) throw new ApiError("NOT_FOUND", "Bản phát hành mới nhất chưa có bộ cài – mở trang tải chính thức");
  Object.assign(download, { state: "downloading", received: 0, total: rel.setup.size, version: rel.version, error: null });
  const dir = join(app.getPath("temp"), "nt-studio-haizflow");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, rel.setup.name);
  try {
    const expected = rel.setup.sha256Url ? (await fetchText(rel.setup.sha256Url)).trim().split(/\s+/)[0].toLowerCase() : null;
    const res = await fetch(rel.setup.url, { headers: { "User-Agent": "NT-Studio" } });
    if (!res.ok || !res.body) throw new ApiError("NETWORK", `Tải bộ cài lỗi (${res.status})`);
    const hash = createHash("sha256");
    const out = createWriteStream(file);
    for await (const chunk of res.body) {
      hash.update(chunk);
      download.received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise((resolve, reject) => out.end((err) => err ? reject(err) : resolve()));
    if (expected && hash.digest("hex") !== expected) {
      rmSync(file, { force: true });
      throw new ApiError("INTEGRITY", "Bộ cài tải về không khớp SHA-256 của tác giả – đã xóa, hãy thử lại");
    }
    download.state = "installing";
    const err = await shell.openPath(file);
    if (err) throw new ApiError("INTERNAL", `Không mở được bộ cài: ${err}`);
    download.state = "done";
    return { file, version: rel.version };
  } catch (err) {
    download.state = "error";
    download.error = err instanceof Error ? err.message : String(err);
    throw err;
  }
}
