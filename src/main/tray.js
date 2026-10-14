import { app, nativeImage, Menu, Tray, Notification } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HIDDEN_ARG = "--hidden";
const prefsFile = () => join(app.getPath("userData"), "background.json");

function load() {
  try {
    return { closeToTray: true, hintShown: false, ...JSON.parse(readFileSync(prefsFile(), "utf8")) };
  } catch {
    return { closeToTray: true, hintShown: false };
  }
}

function save(patch) {
  writeFileSync(prefsFile(), JSON.stringify({ ...load(), ...patch }, null, 2));
}

export function backgroundPrefs() {
  return {
    closeToTray: load().closeToTray,
    // Bản dev chạy electron.exe – không đăng ký khởi động cùng Windows
    launchAtLoginSupported: app.isPackaged && process.platform !== "linux",
    launchAtLogin: app.isPackaged && app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin
  };
}

export function setBackgroundPrefs(p) {
  if (p.closeToTray != null) save({ closeToTray: p.closeToTray });
  if (p.launchAtLogin != null && app.isPackaged) app.setLoginItemSettings({ openAtLogin: p.launchAtLogin, args: [HIDDEN_ARG] });
  refreshMenu();
  return backgroundPrefs();
}

export const startHidden = () => process.argv.includes(HIDDEN_ARG);
let tray = null;
let quitting = false;
let getWindow = () => null;

export function showWindow() {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quit() {
  quitting = true;
  app.quit();
}

function iconImage() {
  const file = app.isPackaged ? join(process.resourcesPath, "icon.png") : join(__dirname, "../../resources/icon.png");
  return nativeImage.createFromPath(file).resize({ width: 32, height: 32, quality: "best" });
}

function refreshMenu() {
  if (!tray) return;
  const p = backgroundPrefs();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Mở NT Studio", click: showWindow },
      { type: "separator" },
      { label: "Chạy nền khi đóng cửa sổ", type: "checkbox", checked: p.closeToTray, click: (i) => setBackgroundPrefs({ closeToTray: i.checked }) },
      {
        label: "Khởi động cùng Windows (ẩn dưới khay)",
        type: "checkbox",
        checked: p.launchAtLogin,
        enabled: p.launchAtLoginSupported,
        click: (i) => setBackgroundPrefs({ launchAtLogin: i.checked })
      },
      { type: "separator" },
      { label: "Thoát hẳn (dừng lập lịch đăng bài)", click: quit }
    ])
  );
}

export function setupTray(win) {
  getWindow = win;
  app.on("before-quit", () => {
    quitting = true;
  });
  tray = new Tray(iconImage());
  tray.setToolTip("NT Studio – đang chạy nền (lập lịch đăng bài, hộp thư, render)");
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  refreshMenu();
}

export function hideOnClose(w) {
  w.on("close", (e) => {
    if (quitting || !tray || !load().closeToTray) return;
    e.preventDefault();
    w.hide();
    const s = load();
    if (!s.hintShown && Notification.isSupported()) {
      save({ hintShown: true });
      const n = new Notification({
        title: "NT Studio vẫn đang chạy nền",
        body: "Lập lịch đăng bài và hộp thư vẫn hoạt động. Mở lại hoặc thoát hẳn từ biểu tượng ở khay hệ thống (góc phải thanh taskbar)."
      });
      n.on("click", showWindow);
      n.show();
    }
  });
}
