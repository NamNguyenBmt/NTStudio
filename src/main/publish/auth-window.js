import { session, BrowserWindow } from "electron";
import { PublishError } from "./http";

let pending = null;
const chromeUa = (ua) => ua.replace(/\s?Electron\/\S+/, "").replace(/\s?omnipage-studio\/\S+/i, "");

const short = (u) => {
  try {
    const x = new URL(u);
    return x.host + x.pathname;
  } catch {
    return u.slice(0, 80);
  }
};

export function openAuthWindow(o) {
  if (pending && !pending.isDestroyed()) {
    pending.focus();
    return Promise.reject(new PublishError("permanent", "Đang có một cửa sổ đăng nhập mở – hoàn tất hoặc đóng nó trước"));
  }
  const ses = session.fromPartition(`oauth-${o.state}`, { cache: false });
  const win = new BrowserWindow({
    width: 560,
    height: 720,
    parent: o.parent ?? void 0,
    modal: false,
    title: o.title,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  pending = win;
  win.webContents.setUserAgent(chromeUa(win.webContents.getUserAgent()));
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!u.startsWith("https://")) return { action: "deny" };
    console.info(`[oauth] ${o.provider}: mở cửa sổ con ${short(u)}`);
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        parent: win,
        width: 520,
        height: 680,
        autoHideMenuBar: true,
        backgroundColor: "#ffffff",
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
      }
    };
  });
  win.webContents.on("did-create-window", (child) => {
    child.webContents.setUserAgent(chromeUa(child.webContents.getUserAgent()));
    guardSchemes(child.webContents);
    child.webContents.on("will-redirect", (e, target) => onUrl(e, target));
    child.webContents.on("will-navigate", (e, target) => onUrl(e, target));
  });
  let onUrl = () => void 0;
  let resumed = 0;
  const guardSchemes = (wc) => {
    wc.on("will-frame-navigate", (e) => {
      if (/^(https?:|about:|data:|blob:)/i.test(e.url)) return;
      e.preventDefault();
      console.info(`[oauth] ${o.provider}: chặn liên kết mở ứng dụng ngoài ${e.url.split(":")[0]}:`);
    });
  };
  guardSchemes(win.webContents);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission !== "openExternal"));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, params) => {
      if (done) return;
      done = true;
      console.info(`[oauth] ${o.provider}: ${err ? `dừng – ${err.message}` : "nhận kết quả đăng nhập"}`);
      clearTimeout(timer);
      pending = null;
      if (!win.isDestroyed()) win.close();
      void ses.clearStorageData().catch(() => void 0);
      if (err) reject(err);
      else resolve(params);
    };
    const timer = setTimeout(() => finish(new PublishError("permanent", `Hết thời gian đăng nhập ${o.provider} (10 phút)`)), 10 * 6e4);
    onUrl = (e, target) => {
      if (!target.startsWith(o.redirectUri)) return;
      e?.preventDefault();
      const u = new URL(target);
      const params = new URLSearchParams(u.search || u.hash.slice(1));
      if (params.get("state") !== o.state) return finish(new PublishError("permanent", "Phản hồi đăng nhập không hợp lệ (state không khớp)"));
      finish(null, params);
    };
    win.webContents.on("will-redirect", (e, target) => onUrl(e, target));
    win.webContents.on("will-navigate", (e, target) => onUrl(e, target));
    win.webContents.on("did-navigate", (_e, target) => {
      console.info(`[oauth] ${o.provider}: ${short(target)}`);
      onUrl(null, target);
      if (done || !o.lostFlow || resumed >= 2) return;
      let u;
      try {
        u = new URL(target);
      } catch {
        return;
      }
      if (o.lostFlow(u)) {
        resumed++;
        console.info(`[oauth] ${o.provider}: rời trang cấp quyền sau đăng nhập → mở lại`);
        void win.loadURL(o.url);
      }
    });
    win.on("closed", () => finish(new PublishError("permanent", "Đã đóng cửa sổ đăng nhập – hủy kết nối")));
    win.webContents.on("did-fail-load", (_e, codeNum, desc, failedUrl, isMainFrame) => {
      if (isMainFrame && !failedUrl.startsWith(o.redirectUri) && codeNum !== -3) finish(new PublishError("transient", `Không tải được trang đăng nhập ${o.provider} (${desc})`));
    });
    if (o.blocked) {
      win.webContents.on("did-finish-load", () => {
        void win.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 800) : ""', true).then((text) => {
          const msg = o.blocked(text);
          if (msg) finish(new PublishError("permanent", msg));
        }).catch(() => void 0);
      });
    }
    void win.loadURL(o.url);
  });
}
