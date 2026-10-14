"use strict";
const electron = require("electron");
const IpcChannel = {
  WindowMinimize: "window:minimize",
  WindowToggleMaximize: "window:toggle-maximize",
  WindowClose: "window:close",
  WindowStateChanged: "window:state-changed",
  AppInfo: "app:info",
  AppSetTheme: "app:set-theme",
  SystemStats: "system:stats",
  /** Tiến trình chính → giao diện: hộp thư có tin mới */
  InboxChanged: "inbox:changed",
  /** Tiến trình chính → giao diện: mở một trang (vd bấm thông báo hệ thống) */
  AppNavigate: "app:navigate",
  /** Tiến trình chính → giao diện: trạng thái license đổi (hết gói, kích hoạt lại, ngoại tuyến…) */
  LicenseChanged: "license:changed"
};
const API_PREFIX = "api:";
function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  electron.ipcRenderer.on(channel, listener);
  return () => electron.ipcRenderer.removeListener(channel, listener);
}
const api = {
  window: {
    minimize: () => electron.ipcRenderer.send(IpcChannel.WindowMinimize),
    toggleMaximize: () => electron.ipcRenderer.send(IpcChannel.WindowToggleMaximize),
    close: () => electron.ipcRenderer.send(IpcChannel.WindowClose),
    onStateChanged: (cb) => subscribe(IpcChannel.WindowStateChanged, cb)
  },
  app: {
    info: () => electron.ipcRenderer.invoke(IpcChannel.AppInfo),
    setTheme: (theme) => electron.ipcRenderer.send(IpcChannel.AppSetTheme, theme),
    onNavigate: (cb) => subscribe(IpcChannel.AppNavigate, cb),
    onLicenseChanged: (cb) => subscribe(IpcChannel.LicenseChanged, cb)
  },
  system: {
    onStats: (cb) => subscribe(IpcChannel.SystemStats, cb)
  },
  inbox: {
    onChanged: (cb) => subscribe(IpcChannel.InboxChanged, cb)
  },
  api: {
    invoke: (endpoint, input) => {
      if (typeof endpoint !== "string" || !/^[a-z]+\.[a-zA-Z]+$/.test(endpoint)) {
        return Promise.resolve({ ok: false, error: { code: "VALIDATION", message: "Endpoint không hợp lệ" } });
      }
      return electron.ipcRenderer.invoke(API_PREFIX + endpoint, input).catch(
        (err) => ({
          ok: false,
          error: {
            code: "INTERNAL",
            // Thường gặp khi giao diện đã cập nhật nhưng tiến trình chính còn bản cũ (chưa khởi động lại)
            message: /No handler registered/.test(String(err)) ? `Tiến trình chính chưa có chức năng "${endpoint}" – hãy tắt hẳn ứng dụng rồi mở lại` : `Lỗi gọi tiến trình chính: ${err instanceof Error ? err.message : String(err)}`
          }
        })
      );
    }
  }
};
electron.contextBridge.exposeInMainWorld("omni", api);
