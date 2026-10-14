// Harness kiểm thử giao diện (KHÔNG thuộc ứng dụng, không đóng gói).
// Chạy backend thật của mã nguồn dựng lại trên một thư mục dữ liệu tạm + dữ liệu mẫu (OMNI_SEED=1),
// mở song song renderer A (bản phát hành gốc) và renderer B (bản build từ mã nguồn), duyệt từng màn hình
// và so DOM. Các endpoint gọi máy chủ Omnira (auth/cloud/billing) được thay bằng dữ liệu cố định để kết quả
// lặp lại được và không gửi gì ra mạng; trạng thái license là dữ liệu giả chỉ dùng trong harness.
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API_PREFIX } from "../../src/shared/api";
import { contract } from "../../src/shared/contract";
import { ApiError } from "../../src/main/errors";
import { AiError, ensureProviders } from "../../src/main/ai/providers";
import { setCurrentUser } from "../../src/main/paths";
import { openDatabase, getDb } from "../../src/main/db/index";
import { seedIfEmpty } from "../../src/main/seed";
import { vaultAvailable } from "../../src/main/vault";
import { registerMediaScheme, handleMediaProtocol } from "../../src/main/media/protocol";
import { seriesHandlers } from "../../src/main/api/series";
import { planHandlers } from "../../src/main/api/plan";
import { dataLocationHandlers } from "../../src/main/api/data-location";
import { contentHandlers } from "../../src/main/api/content";
import { dashboardHandlers } from "../../src/main/api/dashboard";
import { inboxHandlers } from "../../src/main/api/inbox";
import { schedulerHandlers } from "../../src/main/api/scheduler";
import { settingsHandlers } from "../../src/main/api/settings";
import { studioHandlers } from "../../src/main/api/studio";
import { workspaceHandlers } from "../../src/main/api/workspaces";
import { mediaHandlers } from "../../src/main/api/media";
import { publishingHandlers } from "../../src/main/api/publishing";
import { analyticsHandlers } from "../../src/main/api/analytics";
import { filmHandlers } from "../../src/main/api/film";
import { flowHandlers } from "../../src/main/api/flow";
import { accountHandlers } from "../../src/main/api/accounts";
import { aiHandlers } from "../../src/main/api/ai";
import { localTtsHandlers } from "../../src/main/tts/clones";
import { videoProjects, series, filmProjects } from "../../src/main/db/schema";
import { cloudHandlers } from "../../src/main/api/cloud";
import { storageInfo } from "../../src/main/media/paths";
import { logDir, logFile } from "../../src/main/logger";
import { backgroundPrefs } from "../../src/main/tray";
import { dbFilePath } from "../../src/main/db/index";
import { isSeeded } from "../../src/main/seed";

const OUT = process.env.HARNESS_OUT;
const RENDERER_A = process.env.HARNESS_A; // index.html của bản gốc
const RENDERER_B = process.env.HARNESS_B; // index.html của bản dựng lại
const PRELOAD = process.env.HARNESS_PRELOAD;
const FIXED_NOW = new Date("2026-10-14T03:00:00.000Z");

const USER = { id: "harness-user", email: "harness@example.test", displayName: "Harness", provider: "cloud", createdAt: FIXED_NOW, lastLoginAt: FIXED_NOW, plan: "harness" };
const LICENSE = {
  status: "active", usable: true, message: null, needRelogin: false, plan: "harness", planName: "Harness", trial: false,
  entitlementEndsAt: new Date("2027-01-01T00:00:00Z"), tokenExpiresAt: new Date("2027-01-01T00:00:00Z"),
  maxDevices: 1, maxChannels: 100, flowThreads: 2,
  features: ["STUDIO", "SERIES", "FILM", "FLOW", "CALENDAR", "INBOX", "ANALYTICS"],
  deviceId: "harness-device", lastCheckedAt: FIXED_NOW, lastOnlineAt: FIXED_NOW,
};
const offline = () => { throw new ApiError("OFFLINE", "Harness: không gọi máy chủ Omnira"); };
const fixtures = {
  "auth.state": () => ({ user: USER, hasUsers: true, legacyData: false, lastEmail: USER.email, vaultAvailable: vaultAvailable(), license: LICENSE, cloudUrl: "harness" }),
  "license.state": () => LICENSE,
  "cloud.notifications": () => ({ items: [], unread: 0, offline: true }),
};

const handlers = {
  ...seriesHandlers, ...planHandlers, ...dataLocationHandlers, ...contentHandlers, ...dashboardHandlers, ...inboxHandlers,
  ...schedulerHandlers, ...settingsHandlers, ...studioHandlers, ...workspaceHandlers, ...mediaHandlers, ...publishingHandlers,
  ...analyticsHandlers, ...filmHandlers, ...flowHandlers, ...accountHandlers, ...aiHandlers, ...localTtsHandlers,
  "channels.quota": cloudHandlers["channels.quota"],
  "system.dbInfo": () => ({ path: dbFilePath(), seeded: isSeeded() }),
  "system.storage": () => storageInfo(),
  "system.logInfo": () => ({ dir: logDir(), file: logFile(), sizeBytes: 0 }),
  "system.background": () => backgroundPrefs(),
};
const calls = new Map();

function register() {
  for (const endpoint of Object.keys(contract)) {
    ipcMain.handle(API_PREFIX + endpoint, async (_e, raw) => {
      calls.set(endpoint, (calls.get(endpoint) || 0) + 1);
      let fn = fixtures[endpoint] ?? handlers[endpoint];
      if (/^(auth|cloud|billing|license)\./.test(endpoint) && !fixtures[endpoint]) fn = offline;
      if (!fn) fn = offline;
      try {
        return { ok: true, data: await fn(contract[endpoint].input.parse(raw)) };
      } catch (err) {
        if (err instanceof ApiError) return { ok: false, error: { code: err.code, message: err.message } };
        if (err instanceof AiError) return { ok: false, error: { code: "AI", message: err.message } };
        console.error(`[harness] ${endpoint} lỗi`, err);
        return { ok: false, error: { code: "INTERNAL", message: String(err?.message ?? err) } };
      }
    });
  }
  ipcMain.handle("app:info", () => ({ name: "Omnira Studio", version: "harness", platform: process.platform, electron: process.versions.electron }));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function makeWindow(file) {
  const w = new BrowserWindow({
    // offscreen: hai cửa sổ không che nhau (cửa sổ bị che sẽ ngừng render, ResizeObserver không chạy)
    width: 1440, height: 900, show: false, frame: false, backgroundColor: "#0b1326",
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, spellcheck: false, offscreen: true, backgroundThrottling: false },
  });
  w.loadFile(file);
  return w;
}
const html = (w) => w.webContents.executeJavaScript(`(() => {
  const root = document.getElementById("root");
  // bỏ thuộc tính sinh ngẫu nhiên (id của React useId, style động của framer-motion đang chạy)
  return root.innerHTML.replace(/:r[0-9a-z]+:/g, ":rID:");
})()`);
const errorsOf = new Map();

async function run() {
  const routes = [
    "/", "/accounts", "/content", "/calendar", "/inbox", "/studio", "/series", "/plan", "/analytics", "/workspaces",
    "/billing", "/guide", "/guide?tab=instagram", "/guide?tab=tiktok", "/guide?tab=youtube",
    "/settings?tab=ai", "/settings?tab=publish", "/settings?tab=video", "/settings?tab=system", "/film",
  ];
  const db = getDb();
  const p = db.select({ id: videoProjects.id }).from(videoProjects).all();
  for (const r of p.slice(0, 3)) routes.push(`/studio?project=${r.id}`);
  for (const s of db.select({ id: series.id }).from(series).all().slice(0, 2)) routes.push(`/series?id=${s.id}`);
  for (const f of db.select({ id: filmProjects.id }).from(filmProjects).all().slice(0, 2)) routes.push(`/film/${f.id}`);

  const A = makeWindow(RENDERER_A), B = makeWindow(RENDERER_B);
  for (const [name, w] of [["A", A], ["B", B]]) {
    errorsOf.set(name, []);
    w.webContents.on("console-message", (_e, level, message) => { if (level >= 3) errorsOf.get(name).push(message); });
    w.webContents.on("render-process-gone", (_e, d) => errorsOf.get(name).push("CRASH " + d.reason));
  }
  await wait(6000);
  const report = [];
  for (const route of routes) {
    for (const w of [A, B]) await w.webContents.executeJavaScript(`location.hash = ${JSON.stringify("#" + route)}`);
    await wait(3500);
    let [ha, hb] = await Promise.all([html(A), html(B)]);
    // biểu đồ đo kích thước khung sau khi render, query lỗi còn thử lại 1 lần → chờ ổn định rồi so lại
    for (let k = 0; k < 3 && ha !== hb; k++) { await wait(4000); [ha, hb] = await Promise.all([html(A), html(B)]); }
    const slug = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
    writeFileSync(join(OUT, `${slug}.A.html`), ha);
    writeFileSync(join(OUT, `${slug}.B.html`), hb);
    // cửa sổ offscreen chỉ vẽ khi có thay đổi → ép vẽ lại để ảnh chụp không phải khung hình cũ
    // chụp vài lần: animation chạy liên tục (chấm trạng thái, spinner) cho mỗi lần một pha khác nhau
    for (let shot = 0; shot < 4; shot++) {
      for (const w of [A, B]) w.webContents.invalidate();
      await wait(shot === 0 ? 1500 : 450);
      for (const [n, w] of [["A", A], ["B", B]]) writeFileSync(join(OUT, `${slug}.${n}.${shot}.png`), (await w.webContents.capturePage()).toPNG());
    }
    report.push({ route, same: ha === hb, lenA: ha.length, lenB: hb.length });
    console.log(`${ha === hb ? "SAME" : "DIFF"}  ${route}  (${ha.length} / ${hb.length})`);
  }
  // Thao tác chỉ đổi giao diện (mở hộp thoại / menu, đổi tab, bộ lọc) – không ghi dữ liệu, không gọi mạng
  const interactions = [
    ["/", "14 ngày"], ["/", "7 ngày"], ["/", "Cấu hình"], ["/", "Tất cả không gian (17 kênh)"], ["/", "H"],
    ["/accounts", "Thêm thủ công Ctrl+N"], ["/accounts", "Thêm Fanpage"], ["/accounts", "Nhập bằng token"],
    ["/accounts", "Facebook 5"], ["/accounts", "TikTok 4"], ["/accounts", "Instagram 3"], ["/accounts", "Cần xử lý 3"],
    ["/analytics", "60 ngày"], ["/analytics", "90 ngày"], ["/analytics", "Thêm mục tiêu"],
    ["/calendar", "Theo Tuần"], ["/calendar", "Danh sách"], ["/calendar", "Tạo bài đăng mới Ctrl+N"],
    ["/content", "Thêm nội dung"], ["/content", "Video / Reels (5)"], ["/content", "Ảnh / Carousel (5)"],
    ["/inbox", "Chưa đọc · 3"], ["/inbox", "AI chờ duyệt"], ["/inbox", "FB 3"], ["/inbox", "Thêm luật trả lời"], ["/inbox", "Thêm luật ẩn bình luận"],
    ["/plan", "Top danh sách"], ["/plan", "Review sản phẩm"],
    ["/settings?tab=ai", "Endpoint tùy chỉnh"],
    ["/studio", "Dự án mới"], ["/studio", "Lịch sử render"], ["/studio", "Xuất prompt thủ công (Vids / Flow)"],
    ["/workspaces", "Tạo Không gian mới Ctrl+N"], ["/workspaces", "Cài đặt quy tắc"],
  ];
  const clickJs = (label) => `(() => {
    const norm = (s) => s.replace(/\\s+/g, " ").trim();
    const b = [...document.querySelectorAll("button")].find((x) => norm(x.innerText) === ${JSON.stringify(label)});
    if (!b) return false; b.click(); return true;
  })()`;
  const bodyHtml = (w) => w.webContents.executeJavaScript(`document.body.innerHTML.replace(/:r[0-9a-z]+:/g, ":rID:")`);
  const ireport = [];
  for (const [route, label] of interactions) {
    for (const w of [A, B]) await w.webContents.executeJavaScript(`location.hash = "#/__reset"`);
    await wait(600);
    for (const w of [A, B]) await w.webContents.executeJavaScript(`location.hash = ${JSON.stringify("#" + route)}`);
    await wait(3000);
    const clicked = await Promise.all([A, B].map((w) => w.webContents.executeJavaScript(clickJs(label))));
    await wait(1800);
    let [ha, hb] = await Promise.all([bodyHtml(A), bodyHtml(B)]);
    for (let k = 0; k < 3 && ha !== hb; k++) { await wait(3000); [ha, hb] = await Promise.all([bodyHtml(A), bodyHtml(B)]); }
    const slug = ("i_" + route + "_" + label).replace(/[^a-z0-9]+/gi, "_").slice(0, 80);
    if (ha !== hb) { writeFileSync(join(OUT, `${slug}.A.html`), ha); writeFileSync(join(OUT, `${slug}.B.html`), hb); }
    for (const [n, w] of [["A", A], ["B", B]]) { w.webContents.invalidate(); }
    await wait(800);
    for (const [n, w] of [["A", A], ["B", B]]) writeFileSync(join(OUT, `${slug}.${n}.0.png`), (await w.webContents.capturePage()).toPNG());
    for (const w of [A, B]) w.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    ireport.push({ route, label, clicked, same: ha === hb });
    console.log(`${!clicked[0] || !clicked[1] ? "NOCLICK" : ha === hb ? "SAME" : "DIFF"}  [${route}] ${label}`);
  }
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ report, interactions: ireport, errors: Object.fromEntries(errorsOf), calls: Object.fromEntries(calls) }, null, 1));
  app.quit();
}

registerMediaScheme();
app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  process.env.OMNI_SEED = "1";
  setCurrentUser(USER.id);
  openDatabase();
  seedIfEmpty();
  ensureProviders();
  handleMediaProtocol();
  register();
  await run().catch((e) => { console.error(e); app.exit(1); });
});
