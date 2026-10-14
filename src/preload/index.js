import { ipcRenderer, contextBridge } from "electron";
import { IpcChannel } from "../shared/ipc";
import { API_PREFIX } from "../shared/api";

function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  window: {
    minimize: () => ipcRenderer.send(IpcChannel.WindowMinimize),
    toggleMaximize: () => ipcRenderer.send(IpcChannel.WindowToggleMaximize),
    close: () => ipcRenderer.send(IpcChannel.WindowClose),
    onStateChanged: (cb) => subscribe(IpcChannel.WindowStateChanged, cb)
  },
  app: {
    info: () => ipcRenderer.invoke(IpcChannel.AppInfo),
    setTheme: (theme) => ipcRenderer.send(IpcChannel.AppSetTheme, theme),
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
      return ipcRenderer.invoke(API_PREFIX + endpoint, input).catch(
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

contextBridge.exposeInMainWorld("omni", api);
