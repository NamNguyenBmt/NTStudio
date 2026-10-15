import { BrowserWindow, dialog, app, shell } from "electron";
import { existsSync, readdirSync, statSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cp } from "node:fs/promises";
import { DATA_MARKER, dataRoot, defaultDataRoot, setDataRootPointer, writeDataMarker } from "../paths";
import { ApiError } from "../errors";
import { closeSession } from "../auth/session";

function dirSize(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += dirSize(p);
    else if (e.isFile()) total += statSync(p).size;
  }
  return total;
}

const isDataDir = (dir) => existsSync(join(dir, DATA_MARKER)) || existsSync(join(dir, "auth", "users.json"));

async function pickFolder(title) {
  if (process.env.OMNI_PICK_DIR) return process.env.OMNI_PICK_DIR;
  const opts = { title, properties: ["openDirectory", "createDirectory"] };
  const win = BrowserWindow.getFocusedWindow();
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled ? null : res.filePaths[0] ?? null;
}

function relaunchSoon() {
  if (process.env.OMNI_NO_RELAUNCH === "1") return;
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 600);
}

export const dataLocationHandlers = {
  "storage.location": () => {
    const root = dataRoot();
    let freeBytes = null;
    try {
      const fs = statfsSync(root);
      freeBytes = fs.bavail * fs.bsize;
    } catch {
    }
    return {
      root,
      isDefault: resolve(root) === resolve(defaultDataRoot()),
      defaultRoot: defaultDataRoot(),
      sizeBytes: dirSize(join(root, "users")) + dirSize(join(root, "auth")),
      freeBytes
    };
  },
  "storage.openRoot": async () => {
    const err = await shell.openPath(dataRoot());
    if (err) throw new ApiError("INTERNAL", `Không mở được thư mục: ${err}`);
  },
  /** Chép toàn bộ dữ liệu sang thư mục mới rồi khởi động lại app dùng thư mục đó. */
  "storage.move": async () => {
    const picked = await pickFolder("Chọn thư mục mới để lưu dữ liệu NT Studio");
    if (!picked) return { moved: false, root: dataRoot() };
    const from = dataRoot();
    const target = isDataDir(picked) ? picked : readdirSync(picked).length ? join(picked, "OmniPage Data") : picked;
    if (resolve(target) === resolve(from)) throw new ApiError("VALIDATION", "Đây đang là thư mục dữ liệu hiện tại");
    if (resolve(target).startsWith(resolve(from) + "\\") || resolve(target).startsWith(resolve(from) + "/"))
      throw new ApiError("VALIDATION", "Không chọn thư mục nằm bên trong thư mục dữ liệu hiện tại");
    if (isDataDir(target) && existsSync(join(target, "auth", "users.json")))
      throw new ApiError("VALIDATION", 'Thư mục này đã chứa dữ liệu NT Studio khác – chọn thư mục trống, hoặc dùng "Dùng thư mục dữ liệu có sẵn"');
    const need = dirSize(join(from, "users")) + dirSize(join(from, "auth"));
    try {
      const fs = statfsSync(picked);
      if (fs.bavail * fs.bsize < need * 1.05 + 200 * 1024 * 1024) throw new ApiError("VALIDATION", `Ổ đĩa đích không đủ chỗ (cần khoảng ${(need / 1024 ** 3).toFixed(1)} GB)`);
    } catch (err) {
      if (err instanceof ApiError) throw err;
    }
    closeSession();
    console.info(`[data] chuyển dữ liệu ${from} → ${target} (${(need / 1024 ** 2).toFixed(0)} MB)`);
    for (const sub of ["auth", "users"]) if (existsSync(join(from, sub))) await cp(join(from, sub), join(target, sub), { recursive: true, force: false, errorOnExist: false });
    writeDataMarker(target);
    setDataRootPointer(target);
    relaunchSoon();
    return { moved: true, root: target };
  },
  /** Máy mới: trỏ tới thư mục dữ liệu đã sao lưu / chép sang. */
  "storage.useExisting": async () => {
    const picked = await pickFolder("Chọn thư mục dữ liệu NT Studio đã sao lưu");
    if (!picked) return { changed: false, root: dataRoot() };
    const dir = isDataDir(picked) ? picked : isDataDir(join(picked, "OmniPage Data")) ? join(picked, "OmniPage Data") : null;
    if (!dir) throw new ApiError("VALIDATION", "Thư mục này không phải thư mục dữ liệu OmniPage (thiếu omnipage-data.json / auth/users.json)");
    if (resolve(dir) === resolve(dataRoot())) return { changed: false, root: dir };
    closeSession();
    setDataRootPointer(dir);
    console.info(`[data] dùng thư mục dữ liệu có sẵn: ${dir}`);
    relaunchSoon();
    return { changed: true, root: dir };
  }
};
