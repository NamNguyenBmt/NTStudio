import { BrowserWindow, ipcMain, app, nativeTheme, dialog, Notification } from "electron";
import { savedTheme, applyTheme, createMainWindow } from "./window";
import { IpcChannel } from "../shared/ipc";
import { startSystemStats } from "./system-stats";
import { registerApi } from "./api/index";
import { initLogger, attachRendererLogging } from "./logger";
import { dataRoot, writeDataMarker } from "./paths";
import { onLicenseState } from "./license/index";
import { closeFlowChrome } from "./flow/session";
import { stopEngine } from "./tts/local-engine";
import { bindInboxEvents } from "./inbox/worker";
import { bindEarlyCheckEvents } from "./analytics/early-check";
import { forgetSession, restoreSession } from "./auth/store";
import { onQuotaChange } from "./quota";
import { openSession, closeSession } from "./auth/session";
import { handleMediaProtocol } from "./media/protocol";
import { startHidden, showWindow, setupTray, hideOnClose } from "./tray";

let mainWindow = null;
let stopStats = null;

function registerIpc() {
  const current = (e) => BrowserWindow.fromWebContents(e.sender);
  ipcMain.on(IpcChannel.WindowMinimize, (e) => current(e)?.minimize());
  ipcMain.on(IpcChannel.WindowToggleMaximize, (e) => {
    const win = current(e);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(IpcChannel.WindowClose, (e) => current(e)?.close());
  ipcMain.on(IpcChannel.AppSetTheme, (_e, theme) => {
    if (theme === "system" || theme === "dark" || theme === "light") applyTheme(theme);
  });
  ipcMain.handle(IpcChannel.AppInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron
  }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(() => {
    app.setAppUserModelId("com.omnipage.studio");
    initLogger();
    try {
      writeDataMarker();
      console.info(`[data] thư mục dữ liệu: ${dataRoot()}`);
    } catch (err) {
      console.error("[data] không ghi được dấu thư mục dữ liệu", err);
    }
    nativeTheme.themeSource = savedTheme();
    const remembered = restoreSession();
    if (remembered) {
      try {
        openSession(remembered);
      } catch (err) {
        console.error("[auth] không mở được dữ liệu của phiên đã ghi nhớ", err);
        forgetSession(remembered.id);
        dialog.showErrorBox("OmniPage Studio – lỗi dữ liệu", `Không mở được dữ liệu của tài khoản ${remembered.email}:
${err instanceof Error ? err.message : String(err)}`);
      }
    }
    registerIpc();
    registerApi();
    handleMediaProtocol();
    mainWindow = createMainWindow({ hidden: startHidden() });
    hideOnClose(mainWindow);
    setupTray(() => mainWindow);
    attachRendererLogging(mainWindow.webContents);
    onLicenseState(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcChannel.LicenseChanged);
    });
    onQuotaChange(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcChannel.LicenseChanged);
    });
    stopStats = startSystemStats((stats) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcChannel.SystemStats, stats);
    });
    let lastNotify = 0;
    bindInboxEvents({
      isActive: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused() && !mainWindow.isMinimized(),
      onChange: (c) => {
        const win = mainWindow;
        if (!win || win.isDestroyed()) return;
        win.webContents.send(IpcChannel.InboxChanged, c);
        if (win.isFocused() || !Notification.isSupported() || Date.now() - lastNotify < 2e4) return;
        lastNotify = Date.now();
        const n = new Notification({ title: `${c.newMessages} tin mới trong Hộp thư`, body: c.channels.join(", ").slice(0, 120), silent: false });
        n.on("click", () => {
          if (win.isDestroyed()) return;
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
          win.webContents.send(IpcChannel.AppNavigate, "/inbox");
        });
        n.show();
      }
    });
    bindEarlyCheckEvents((posts) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({
        title: posts.length === 1 ? "Bài đăng đang phân phối kém" : `${posts.length} bài đăng đang phân phối kém`,
        body: posts.slice(0, 3).map((p) => `${p.channelName}: ${p.title.slice(0, 50)} (${p.flag === "zero" ? "0" : `${p.metric} / thường ~${p.baseline}`})`).join("\n")
      });
      n.on("click", () => {
        showWindow();
        mainWindow?.webContents.send(IpcChannel.AppNavigate, "/");
      });
      n.show();
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        hideOnClose(mainWindow);
      } else showWindow();
    });
  });
  app.on("window-all-closed", () => {
    stopStats?.();
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => {
    closeSession();
    void stopEngine();
    void closeFlowChrome();
  });
}
