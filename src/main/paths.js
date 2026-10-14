import { app } from "electron";
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const pointerFile = () => join(app.getPath("userData"), "data-location.json");
export const DATA_MARKER = "omnipage-data.json";
let rootCache = null;

export function dataRoot() {
  if (rootCache) return rootCache;
  let root = app.getPath("userData");
  try {
    const v = JSON.parse(readFileSync(pointerFile(), "utf8"));
    if (v.root && existsSync(v.root)) root = v.root;
    else if (v.root) console.error(`[data] không tìm thấy thư mục dữ liệu đã chọn (${v.root}) – dùng thư mục mặc định`);
  } catch {
  }
  rootCache = root;
  return root;
}

export const defaultDataRoot = () => app.getPath("userData");

export function setDataRootPointer(root) {
  const tmp = pointerFile() + ".tmp";
  writeFileSync(tmp, JSON.stringify(root && resolve(root) !== resolve(defaultDataRoot()) ? { root: resolve(root) } : {}, null, 2));
  renameSync(tmp, pointerFile());
  rootCache = null;
}

export function writeDataMarker(root = dataRoot()) {
  const f = join(root, DATA_MARKER);
  if (existsSync(f)) return;
  mkdirSync(root, { recursive: true });
  writeFileSync(f, JSON.stringify({ app: "Omnira Studio", version: 1, createdAt: (new Date()).toISOString() }, null, 2));
}

export const authRoot = () => join(dataRoot(), "auth");
let currentUserId = null;

export function setCurrentUser(id) {
  currentUserId = id;
}

export function currentUser() {
  return currentUserId;
}

function usersRoot() {
  return join(dataRoot(), "users");
}

export function userDir(id) {
  const uid = id ?? currentUserId;
  if (!uid) throw new Error("Chưa đăng nhập – không có thư mục dữ liệu người dùng");
  return join(usersRoot(), uid);
}

export const legacyPaths = () => ({
  db: join(app.getPath("userData"), "data", "omnipage.db"),
  dataDir: join(app.getPath("userData"), "data"),
  media: join(app.getPath("userData"), "media"),
  vault: join(app.getPath("userData"), "vault")
});
