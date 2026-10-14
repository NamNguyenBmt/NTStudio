import { app, nativeTheme, BrowserWindow, shell } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IpcChannel } from "../shared/ipc";

const themeFile = () => join(app.getPath("userData"), "ui-theme.json");

export function savedTheme() {
  try {
    const v = JSON.parse(readFileSync(themeFile(), "utf8"));
    return v.theme === "light" || v.theme === "dark" ? v.theme : "system";
  } catch {
    return "system";
  }
}

function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? "#0b1326" : "#f6f8fd";
}

export function applyTheme(theme) {
  nativeTheme.themeSource = theme;
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.setBackgroundColor(windowBackground());
  try {
    writeFileSync(themeFile(), JSON.stringify({ theme }));
  } catch {
  }
}

export function createMainWindow({ hidden = false } = {}) {
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    frame: isMac,
    // macOS giữ traffic lights qua titleBarStyle
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    // Bản cài dùng icon gắn trong .exe (electron-builder lấy từ resources/icon.png); khi dev lấy thẳng file
    ...app.isPackaged ? {} : { icon: join(__dirname, "../../resources/icon.png") },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Từ điển chính tả của Chromium không hỗ trợ tiếng Việt → gạch đỏ toàn bộ nội dung
      spellcheck: false
    }
  });
  const sendState = () => {
    if (win.isDestroyed()) return;
    const state = { isMaximized: win.isMaximized(), isFocused: win.isFocused() };
    win.webContents.send(IpcChannel.WindowStateChanged, state);
  };
  for (const evt of ["maximize", "unmaximize", "focus", "blur"]) {
    win.on(evt, sendState);
  }
  win.once("ready-to-show", () => !hidden && win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}
