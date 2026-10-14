import { BrowserWindow, dialog, shell, ipcMain } from "electron";
import { existsSync, statSync } from "node:fs";
import { logDir, logFile } from "../logger";
import { ZodError } from "zod";
import { API_PREFIX } from "../../shared/api";
import { PUBLIC_ENDPOINTS, UNLICENSED_ENDPOINTS, contract } from "../../shared/contract";
import { authHandlers } from "./auth";
import { currentUser } from "../paths";
import { dbFilePath } from "../db/index";
import { ApiError } from "../errors";
import { isSeeded } from "../seed";
import { AiError } from "../ai/providers";
import { storageInfo } from "../media/paths";
import { featureForEndpoint } from "../../shared/features";
import { licenseUsable, hasFeature, featureLockedMessage } from "../license/index";
import { localTtsHandlers } from "../tts/clones";
import { channelIds, enforceQuota } from "../quota";
import { cloudHandlers } from "./cloud";
import { dataLocationHandlers } from "./data-location";
import { contentHandlers } from "./content";
import { accountHandlers } from "./accounts";
import { dashboardHandlers } from "./dashboard";
import { inboxHandlers } from "./inbox";
import { schedulerHandlers } from "./scheduler";
import { settingsHandlers } from "./settings";
import { studioHandlers } from "./studio";
import { workspaceHandlers } from "./workspaces";
import { aiHandlers } from "./ai";
import { seriesHandlers } from "./series";
import { mediaHandlers } from "./media";
import { registerMediaScheme } from "../media/protocol";
import { publishingHandlers } from "./publishing";
import { planHandlers } from "./plan";
import { analyticsHandlers } from "./analytics";
import { filmHandlers } from "./film";
import { flowHandlers } from "./flow";
import { backgroundPrefs, setBackgroundPrefs } from "../tray";

const QUOTA_ENDPOINTS = new Set([
  "accounts.create",
  "accounts.connectFacebook",
  "accounts.importFacebook",
  "accounts.connectTiktok",
  "accounts.connectYoutube",
  "channels.createPage",
  "channels.connect"
]);

const handlers = {
  ...authHandlers,
  ...cloudHandlers,
  ...workspaceHandlers,
  ...accountHandlers,
  ...contentHandlers,
  ...inboxHandlers,
  ...dashboardHandlers,
  ...settingsHandlers,
  ...studioHandlers,
  ...schedulerHandlers,
  ...aiHandlers,
  ...mediaHandlers,
  ...publishingHandlers,
  ...seriesHandlers,
  ...dataLocationHandlers,
  ...planHandlers,
  ...analyticsHandlers,
  ...localTtsHandlers,
  ...flowHandlers,
  ...filmHandlers,
  "system.dbInfo": () => ({ path: dbFilePath(), seeded: isSeeded() }),
  "system.pickImage": async () => {
    const opts = {
      title: "Chọn ảnh",
      properties: ["openFile"],
      filters: [{ name: "Ảnh", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }]
    };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? null : res.filePaths[0] ?? null;
  },
  "system.pickMedia": async () => {
    const opts = {
      title: "Chọn ảnh / video để đăng",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Ảnh & video", extensions: ["jpg", "jpeg", "png", "webp", "mp4", "mov", "m4v"] }]
    };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? [] : res.filePaths.slice(0, 10);
  },
  "system.storage": () => storageInfo(),
  "system.logInfo": () => ({ dir: logDir(), file: logFile(), sizeBytes: existsSync(logFile()) ? statSync(logFile()).size : 0 }),
  "system.background": () => backgroundPrefs(),
  "system.setBackground": (patch) => setBackgroundPrefs(patch),
  "system.openLogs": async () => {
    const err = await shell.openPath(logDir());
    if (err) throw new ApiError("INTERNAL", `Không mở được thư mục log: ${err}`);
  }
};

export function registerApi() {
  for (const endpoint of Object.keys(contract)) {
    const schema = contract[endpoint].input;
    const handler = handlers[endpoint];
    ipcMain.handle(API_PREFIX + endpoint, async (_event, raw) => {
      if (!PUBLIC_ENDPOINTS.has(endpoint) && !currentUser()) {
        return { ok: false, error: { code: "AUTH", message: "Phiên đăng nhập đã kết thúc – vui lòng đăng nhập lại" } };
      }
      if (!PUBLIC_ENDPOINTS.has(endpoint) && !UNLICENSED_ENDPOINTS.has(endpoint) && !licenseUsable()) {
        return { ok: false, error: { code: "LICENSE", message: "Chưa có gói đang hoạt động trên máy này – mua / gia hạn gói hoặc kích hoạt lại để tiếp tục" } };
      }
      const feature = featureForEndpoint(endpoint);
      if (feature && !hasFeature(feature)) return { ok: false, error: { code: "FEATURE", message: featureLockedMessage(feature) } };
      try {
        const input = schema.parse(raw);
        if (QUOTA_ENDPOINTS.has(endpoint)) {
          const before = channelIds();
          const data = await handler(input);
          try {
            enforceQuota(new Set([...channelIds()].filter((id) => !before.has(id))));
          } catch (err) {
            console.error("[quota] áp hạn mức kênh lỗi", err);
          }
          return { ok: true, data };
        }
        return { ok: true, data: await handler(input) };
      } catch (err) {
        if (err instanceof ApiError) return { ok: false, error: { code: err.code, message: err.message } };
        if (err instanceof AiError) return { ok: false, error: { code: err.kind === "budget" ? "BUDGET" : "AI", message: err.message } };
        if (err instanceof ZodError) {
          const detail = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
          return { ok: false, error: { code: "VALIDATION", message: detail } };
        }
        console.error(`[api] ${endpoint} failed`, err);
        return { ok: false, error: { code: "INTERNAL", message: "Lỗi nội bộ – xem log ứng dụng" } };
      }
    });
  }
}

registerMediaScheme();
