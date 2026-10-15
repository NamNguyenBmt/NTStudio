import { BrowserWindow, dialog, shell } from "electron";
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { ApiError } from "../errors";
import { contentHandlers } from "./content";
import { addFolder, copyIntoMedia, downloadAndInstall, haizflowStatus, latestRelease, launch, listOutputs, markImported, removeFolder, setExePath } from "../reup/haizflow";

async function pick(opts) {
  const win = BrowserWindow.getFocusedWindow();
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled ? null : res.filePaths[0] ?? null;
}

const titleOf = (path) => basename(path, extname(path)).replace(/[_-]+/g, " ").trim().slice(0, 300) || "Video reup";

export const reupHandlers = {
  "reup.status": () => haizflowStatus(),
  "reup.latest": () => latestRelease(),
  "reup.install": () => downloadAndInstall(),
  "reup.launch": () => launch(),
  "reup.outputs": () => listOutputs(),
  "reup.pickExe": async () => {
    const path = await pick({ title: "Chọn HaizFlow.exe", properties: ["openFile"], filters: [{ name: "HaizFlow", extensions: ["exe"] }] });
    if (path) setExePath(path);
    return path;
  },
  "reup.resetExe": () => setExePath(null),
  "reup.addFolder": async () => {
    const path = await pick({ title: "Chọn thư mục chứa video đã reup", properties: ["openDirectory"] });
    if (path) addFolder(path);
    return path;
  },
  "reup.removeFolder": ({ path }) => removeFolder(path),
  "reup.reveal": ({ path }) => {
    if (!existsSync(path)) throw new ApiError("NOT_FOUND", "Không tìm thấy file");
    shell.showItemInFolder(path);
  },
  /** Đưa video thành phẩm vào Kho nội dung (bản nháp) để lên lịch đăng */
  "reup.import": async ({ paths, workspaceId, aspect }) => {
    const created = [];
    for (const src of paths) {
      const mediaPath = copyIntoMedia(src);
      const row = await contentHandlers["content.create"]({
        workspaceId: workspaceId ?? null,
        kind: aspect === "9:16" ? "reel" : "video",
        title: titleOf(src),
        aspect: aspect ?? null,
        status: "draft",
        mediaPaths: [mediaPath]
      });
      markImported(src, row.id);
      created.push(row.id);
    }
    return { created };
  }
};
