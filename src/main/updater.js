import { app, dialog } from "electron";
import electronUpdater from "electron-updater";

// Tự cập nhật từ GitHub Releases của repo công khai NamNguyenBmt/NTStudio (electron-builder.yml → publish).
// Phát hành bản mới: npm run release (tools/release.js).
// Có bản mới → hỏi; đồng ý → tải về → tự tắt, cài đè, mở lại bản mới.
const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 30 * 6e4;

let getWindow = () => null;
let asking = false;
let downloading = false;
let skipped = null;

const win = () => {
  const w = getWindow();
  return w && !w.isDestroyed() ? w : null;
};

function progress(value) {
  win()?.setProgressBar(value);
}

async function onAvailable(info) {
  if (asking || downloading || skipped === info.version) return;
  asking = true;
  const w = win();
  const { response } = await dialog.showMessageBox(w ?? void 0, {
    type: "info",
    title: "NT Studio – có phiên bản mới",
    message: `Đã có NT Studio ${info.version} (bạn đang dùng ${app.getVersion()}).`,
    detail: "Cập nhật ngay? App sẽ tải bản mới, tự tắt, cài đặt rồi mở lại. Các tác vụ đang chạy (render, đăng bài) sẽ dừng lúc cài.",
    buttons: ["Cập nhật ngay", "Để sau"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  asking = false;
  if (response !== 0) {
    skipped = info.version;
    return;
  }
  downloading = true;
  progress(2);
  autoUpdater.downloadUpdate().catch((err) => {
    downloading = false;
    progress(-1);
    console.error("[update] tải bản mới lỗi", err);
    dialog.showErrorBox("NT Studio – cập nhật lỗi", `Không tải được bản mới: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export function setupUpdater(windowGetter) {
  getWindow = windowGetter;
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = { info: (m) => console.info("[update]", m), warn: (m) => console.warn("[update]", m), error: (m) => console.error("[update]", m), debug: () => void 0 };
  autoUpdater.on("update-available", (info) => void onAvailable(info));
  autoUpdater.on("download-progress", (p) => progress(Math.max(0.02, p.percent / 100)));
  autoUpdater.on("update-downloaded", (info) => {
    progress(-1);
    console.info(`[update] đã tải ${info.version} – tắt app để cài`);
    // Cài im lặng (không hiện bộ cài) rồi mở lại app
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
  autoUpdater.on("error", (err) => {
    if (downloading) return;
    console.warn("[update] kiểm tra bản mới lỗi", err instanceof Error ? err.message : err);
  });
  const check = () => {
    if (downloading) return;
    autoUpdater.checkForUpdates().catch(() => void 0);
  };
  setTimeout(check, 1e4);
  setInterval(check, CHECK_EVERY_MS);
}
