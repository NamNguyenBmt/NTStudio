"use strict";
const electron = require("electron");
const node_fs = require("node:fs");
const node_path = require("node:path");
const os = require("node:os");
const node_child_process = require("node:child_process");
const node_util = require("node:util");
const zod = require("zod");
const node_crypto = require("node:crypto");
const drizzleOrm = require("drizzle-orm");
const Database = require("better-sqlite3");
const betterSqlite3 = require("drizzle-orm/better-sqlite3");
const migrator = require("drizzle-orm/better-sqlite3/migrator");
const sqliteCore = require("drizzle-orm/sqlite-core");
const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");
const node_stream = require("node:stream");
const promises = require("node:stream/promises");
const Anthropic = require("@anthropic-ai/sdk");
const playwrightCore = require("playwright-core");
const msedgeTts = require("msedge-tts");
const promises$1 = require("node:fs/promises");
const node_http = require("node:http");
const node_url = require("node:url");
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
const themeFile = () => node_path.join(electron.app.getPath("userData"), "ui-theme.json");
function savedTheme() {
  try {
    const v = JSON.parse(node_fs.readFileSync(themeFile(), "utf8"));
    return v.theme === "light" || v.theme === "dark" ? v.theme : "system";
  } catch {
    return "system";
  }
}
function windowBackground() {
  return electron.nativeTheme.shouldUseDarkColors ? "#0b1326" : "#f6f8fd";
}
function applyTheme(theme) {
  electron.nativeTheme.themeSource = theme;
  for (const w of electron.BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.setBackgroundColor(windowBackground());
  try {
    node_fs.writeFileSync(themeFile(), JSON.stringify({ theme }));
  } catch {
  }
}
function createMainWindow({ hidden = false } = {}) {
  const isMac = process.platform === "darwin";
  const win = new electron.BrowserWindow({
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
    ...electron.app.isPackaged ? {} : { icon: node_path.join(__dirname, "../../resources/icon.png") },
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
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
    const state2 = { isMaximized: win.isMaximized(), isFocused: win.isFocused() };
    win.webContents.send(IpcChannel.WindowStateChanged, state2);
  };
  for (const evt of ["maximize", "unmaximize", "focus", "blur"]) {
    win.on(evt, sendState);
  }
  win.once("ready-to-show", () => !hidden && win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void electron.shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
function sampleCpu() {
  let idle = 0;
  let total2 = 0;
  for (const cpu of os.cpus()) {
    const t2 = cpu.times;
    idle += t2.idle;
    total2 += t2.user + t2.nice + t2.sys + t2.irq + t2.idle;
  }
  return { idle, total: total2 };
}
function startSystemStats(emit2, intervalMs = 2e3) {
  let prev = sampleCpu();
  const tick2 = () => {
    const cur = sampleCpu();
    const totalDiff = cur.total - prev.total;
    const cpu = totalDiff > 0 ? (1 - (cur.idle - prev.idle) / totalDiff) * 100 : 0;
    prev = cur;
    const appMemoryKb = electron.app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0);
    emit2({
      cpu: Math.round(cpu * 10) / 10,
      appMemoryMb: Math.round(appMemoryKb / 1024),
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024)
    });
  };
  const timer2 = setInterval(tick2, intervalMs);
  tick2();
  return () => clearInterval(timer2);
}
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;
let file = null;
function logDir() {
  return node_path.join(electron.app.getPath("userData"), "logs");
}
function logFile() {
  return node_path.join(logDir(), "main.log");
}
function rotate() {
  if (!file || !node_fs.existsSync(file) || node_fs.statSync(file).size < MAX_BYTES) return;
  node_fs.rmSync(`${file}.${KEEP}`, { force: true });
  for (let i = KEEP - 1; i >= 1; i--) if (node_fs.existsSync(`${file}.${i}`)) node_fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
  node_fs.renameSync(file, `${file}.1`);
  ensureBom();
}
function ensureBom() {
  if (!file) return;
  if (!node_fs.existsSync(file)) return node_fs.writeFileSync(file, "\uFEFF", "utf8");
  try {
    const buf = node_fs.readFileSync(file);
    if (!(buf[0] === 239 && buf[1] === 187 && buf[2] === 191)) node_fs.writeFileSync(file, Buffer.concat([Buffer.from([239, 187, 191]), buf]));
  } catch {
  }
}
let writes = 0;
function write(level, args) {
  if (!file) return;
  try {
    if (++writes % 200 === 0) rotate();
    node_fs.appendFileSync(file, `${(/* @__PURE__ */ new Date()).toISOString()} [${level}] ${node_util.format(...args)}
`, "utf8");
  } catch {
  }
}
function initLogger() {
  node_fs.mkdirSync(logDir(), { recursive: true });
  file = logFile();
  rotate();
  ensureBom();
  if (process.platform === "win32" && !electron.app.isPackaged) {
    try {
      node_child_process.spawnSync("chcp", ["65001"], { shell: true, stdio: "ignore", windowsHide: true });
    } catch {
    }
  }
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      write(level === "log" ? "info" : level, args);
    };
  }
  process.on("uncaughtException", (err) => console.error("[main] uncaughtException", err));
  process.on("unhandledRejection", (reason) => console.error("[main] unhandledRejection", reason));
  console.info(`[app] khởi động ${electron.app.getName()} ${electron.app.getVersion()} · Electron ${process.versions.electron} · ${process.platform}`);
}
function attachRendererLogging(wc) {
  wc.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2) write(level === 2 ? "warn" : "error", [`[renderer] ${message} (${sourceId.split("/").pop()}:${line})`]);
  });
  wc.on("render-process-gone", (_e, d) => write("error", [`[renderer] tiến trình giao diện dừng: ${d.reason} (mã ${d.exitCode})`]));
}
const API_PREFIX = "api:";
const platform = zod.z.enum(["facebook", "tiktok", "instagram", "youtube"]);
const id$1 = zod.z.string().min(1);
const optionalWorkspace = zod.z.object({ workspaceId: id$1.nullish() }).default({});
const none = zod.z.void().or(zod.z.undefined());
const byId = zod.z.object({ id: id$1 });
const hhmm = zod.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const WorkspaceInput = zod.z.object({
  name: zod.z.string().trim().min(1).max(80),
  color: zod.z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: zod.z.string().max(40).nullish(),
  description: zod.z.string().max(500).nullish(),
  brandVoice: zod.z.string().max(2e3).nullish(),
  /** Kiến thức trả lời khách cho AI: giá, size, ship, đổi trả… */
  knowledge: zod.z.string().max(8e3).nullish(),
  watermarkPath: zod.z.string().max(1024).nullish(),
  watermarkPosition: zod.z.enum(["tl", "tr", "bl", "br", "center"]).optional(),
  watermarkOpacity: zod.z.number().min(0.05).max(1).optional(),
  tags: zod.z.array(zod.z.string().trim().min(1).max(40)).max(10).optional(),
  aiBudgetUsd: zod.z.number().min(0).max(1e5).nullish(),
  goldenHours: zod.z.array(zod.z.object({ start: hhmm, end: hhmm, weight: zod.z.number().min(0).max(1) })).optional(),
  aiTokenQuota: zod.z.number().int().positive().nullish()
});
const ProxyInput = zod.z.object({
  workspaceId: id$1.nullish(),
  label: zod.z.string().trim().min(1).max(80),
  protocol: zod.z.enum(["socks5", "http", "https"]).default("socks5"),
  host: zod.z.string().trim().min(1).max(255),
  port: zod.z.number().int().min(1).max(65535),
  username: zod.z.string().max(255).nullish(),
  country: zod.z.string().max(8).nullish(),
  kind: zod.z.enum(["residential", "datacenter", "mobile", "isp"]).nullish()
});
const AccountInput = zod.z.object({
  workspaceId: id$1.nullish(),
  platform,
  displayName: zod.z.string().trim().min(1).max(120),
  handle: zod.z.string().trim().max(100).nullish(),
  externalId: zod.z.string().trim().max(100).nullish(),
  proxyId: id$1.nullish(),
  twoFactorEnabled: zod.z.boolean().optional(),
  note: zod.z.string().max(500).nullish()
});
const PageInput = zod.z.object({
  accountId: id$1,
  name: zod.z.string().trim().min(1).max(160),
  externalId: zod.z.string().trim().max(100).nullish(),
  role: zod.z.enum(["admin", "editor", "moderator", "advertiser"]).nullish(),
  nicheTag: zod.z.string().max(60).nullish()
});
const ProjectInput = zod.z.object({
  workspaceId: id$1.nullish(),
  targetChannelId: id$1.nullish(),
  topic: zod.z.string().trim().min(1).max(1e3),
  /** 10 giây – 15 phút (phim dài render theo từng cảnh rồi ghép) */
  targetDurationSec: zod.z.number().int().min(10).max(900).optional(),
  aspect: zod.z.enum(["9:16", "16:9", "1:1"]).optional(),
  transition: zod.z.enum(["cut", "fade_black"]).optional(),
  ttsProvider: zod.z.string().max(40).optional(),
  voiceId: zod.z.string().max(120).nullish(),
  renderMode: zod.z.enum(["stock", "semi_ai", "full_ai"]).optional(),
  subtitleStyle: zod.z.string().max(60).optional(),
  bgmTrack: zod.z.string().max(200).nullish(),
  bgmVolume: zod.z.number().min(0).max(1).optional(),
  clipAudio: zod.z.enum(["tts", "mix", "clip"]).optional(),
  clipAudioVolume: zod.z.number().min(0).max(1).optional(),
  /** false = không lời thoại (chỉ hình + tiếng clip + nhạc nền) */
  narration: zod.z.boolean().optional(),
  /** Mẫu định dạng (shared/formats.ts) */
  format: zod.z.string().max(80).nullish(),
  /** Ảnh tham chiếu chung (sản phẩm, logo, nhân vật) – đường dẫn media/uploads do media.importClips trả về */
  referenceImages: zod.z.array(zod.z.string().max(300)).max(6).optional(),
  /** Video dài: dàn ý theo hồi (sửa tên / tóm tắt / thời lượng hồi) */
  acts: zod.z.array(zod.z.object({ title: zod.z.string().trim().min(1).max(120), summary: zod.z.string().max(800), targetSec: zod.z.number().int().min(10).max(900) })).max(10).nullish()
});
const SceneInput = zod.z.object({
  label: zod.z.string().max(80).nullish(),
  voiceover: zod.z.string().max(2e3),
  durationSec: zod.z.number().min(0.5).max(120),
  /** Prompt video đầy đủ (tiếng Anh) */
  mediaPrompt: zod.z.string().max(2e3).nullish(),
  /** Từ khóa ngắn tìm video stock */
  searchQuery: zod.z.string().max(120).nullish(),
  mediaSource: zod.z.enum(["stock", "fal", "kling", "upload"]).nullish(),
  /** Phim ngắn: nhân vật nói + giọng riêng (giữ nguyên khi sửa phân cảnh) */
  speakerId: zod.z.string().max(60).nullish(),
  voiceId: zod.z.string().max(120).nullish(),
  /** Hồi (0-based) – video dài */
  act: zod.z.number().int().min(0).max(9).optional(),
  /** Nguồn hình của cảnh (auto = theo chế độ render của dự án) */
  mediaMode: zod.z.enum(["auto", "stock", "image", "veo", "upload", "none"]).optional(),
  /** Clip/ảnh của người dùng (chỉ dùng khi mediaMode = upload): đường dẫn trong thư mục media, do media.importClips trả về */
  mediaPath: zod.z.string().max(300).nullish(),
  /** Veo: ảnh khung đầu / khung cuối (media/uploads) */
  startImage: zod.z.string().max(300).nullish(),
  endImage: zod.z.string().max(300).nullish(),
  /** Ảnh tham chiếu riêng của cảnh (≤ 3); null = tự động */
  sceneRefs: zod.z.array(zod.z.string().max(300)).max(3).nullish()
});
const isoDate$1 = zod.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD");
const SeriesInput = zod.z.object({
  workspaceId: id$1.nullish(),
  title: zod.z.string().trim().min(1).max(120),
  logline: zod.z.string().trim().max(600).nullish(),
  genre: zod.z.string().trim().max(80).nullish(),
  visualStyle: zod.z.string().trim().max(400).nullish(),
  /** 30/60/90 giây (phim ngắn) hoặc 3–15 phút (viết theo hồi) */
  episodeLengthSec: zod.z.union([zod.z.literal(30), zod.z.literal(60), zod.z.literal(90), zod.z.literal(180), zod.z.literal(300), zod.z.literal(600), zod.z.literal(900)]).optional(),
  ttsProvider: zod.z.string().max(40).optional(),
  narratorVoiceId: zod.z.string().max(120).nullish(),
  renderMode: zod.z.enum(["stock", "semi_ai", "full_ai"]).optional(),
  targetChannelId: id$1.nullish(),
  /** video = Xưởng Video AI; film = Xưởng Phim (khóa khi đã có tập được sản xuất) */
  productionMode: zod.z.enum(["video", "film"]).optional(),
  /** Series kiểu Phim: ngôn ngữ thoại, ghi chú thêm (tiếng Việt được) */
  dialogueLanguage: zod.z.string().trim().min(1).max(60).optional(),
  notes: zod.z.string().max(2e3).nullish()
});
const ContentInput = zod.z.object({
  workspaceId: id$1.nullish(),
  kind: zod.z.enum(["video", "reel", "image", "carousel", "text"]),
  title: zod.z.string().trim().min(1).max(300),
  caption: zod.z.string().max(5e3).nullish(),
  hashtags: zod.z.array(zod.z.string().max(100)).max(60).optional(),
  aspect: zod.z.enum(["9:16", "1:1", "4:5", "16:9"]).nullish(),
  status: zod.z.enum(["draft", "ready"]).optional(),
  /** Bình luận đầu tiên tự đăng sau khi bài lên (Facebook, Instagram) */
  firstComment: zod.z.string().max(2e3).nullish(),
  /** File ảnh/video đính kèm: đường dẫn tuyệt đối (chọn qua system.pickMedia) hoặc tương đối thư mục media */
  mediaPaths: zod.z.array(zod.z.string().min(1).max(1e3)).max(10).optional()
});
const def = () => (input) => ({ input, output: void 0 });
const contentStatus = zod.z.enum(["draft", "ready", "scheduled", "published", "failed"]);
const email = zod.z.string().trim().toLowerCase().email("Email không hợp lệ").max(160);
const password = zod.z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(200);
const PUBLIC_ENDPOINTS = /* @__PURE__ */ new Set([
  "auth.state",
  "auth.login",
  "auth.register",
  "auth.registerVerify",
  "auth.registerResend",
  "auth.forgotPassword",
  "auth.resetPassword",
  "auth.checkReferral",
  "cloud.appInfo",
  "system.logInfo",
  "system.openLogs",
  "storage.location",
  "storage.useExisting",
  "storage.openRoot"
]);
const UNLICENSED_ENDPOINTS = /* @__PURE__ */ new Set([
  "auth.logout",
  "auth.changePassword",
  "auth.updateProfile",
  "license.state",
  "license.refresh",
  "license.activate",
  "license.devices",
  "license.removeDevice",
  "billing.plans",
  "billing.createOrder",
  "billing.order",
  "billing.orders",
  "cloud.notifications",
  "cloud.notificationsSeen",
  "system.openExternal"
]);
const contract = {
  // Đăng nhập bằng tài khoản Omnira (cloud); dữ liệu vẫn lưu trên máy theo từng tài khoản
  "auth.state": def()(none),
  // Thư mục dữ liệu (chọn nơi lưu, chuyển máy)
  "storage.location": def()(none),
  "storage.openRoot": def()(none),
  "storage.move": def()(none),
  "storage.useExisting": def()(none),
  /** Đăng ký bước 1: gửi mã xác thực 6 số tới email (chưa tạo tài khoản) */
  "auth.register": def()(
    zod.z.object({
      email,
      displayName: zod.z.string().trim().min(1, "Nhập tên hiển thị").max(80),
      password,
      phone: zod.z.string().trim().max(30).optional(),
      /** Mã giới thiệu của AM / Sale (tùy chọn) */
      referralCode: zod.z.string().trim().max(20).optional(),
      remember: zod.z.boolean().default(true),
      /** Chuyển dữ liệu của bản trước khi có đăng nhập vào tài khoản này (người dùng chọn) */
      adoptLegacy: zod.z.boolean().default(false)
    })
  ),
  /** Đăng ký bước 2: nhập đúng mã → tạo tài khoản và đăng nhập luôn */
  "auth.registerVerify": def()(zod.z.object({ email, code: zod.z.string().trim().regex(/^\d{6}$/, "Mã xác thực gồm 6 chữ số") })),
  "auth.registerResend": def()(zod.z.object({ email })),
  /** Quên mật khẩu bước 1: gửi mã 6 số tới email (trả lời như nhau dù email có tài khoản hay không) */
  "auth.forgotPassword": def()(zod.z.object({ email })),
  /** Quên mật khẩu bước 2: đúng mã → đặt mật khẩu mới và đăng nhập luôn */
  "auth.resetPassword": def()(
    zod.z.object({ email, code: zod.z.string().trim().regex(/^\d{6}$/, "Mã xác thực gồm 6 chữ số"), newPassword: password, remember: zod.z.boolean().default(true) })
  ),
  "auth.login": def()(zod.z.object({ email, password: zod.z.string().min(1).max(200), remember: zod.z.boolean().default(true) })),
  "auth.logout": def()(none),
  "auth.changePassword": def()(zod.z.object({ currentPassword: zod.z.string().min(1).max(200), newPassword: password })),
  "auth.updateProfile": def()(zod.z.object({ displayName: zod.z.string().trim().min(1).max(80) })),
  /** Kiểm tra mã giới thiệu trước khi đăng ký → tên AM */
  "auth.checkReferral": def()(zod.z.object({ code: zod.z.string().trim().min(1).max(20) })),
  // License & mua gói (Omnira Cloud)
  "license.state": def()(none),
  /** Kiểm tra lại với cloud ngay (heartbeat) */
  "license.refresh": def()(none),
  /** Kích hoạt lại máy này (sau khi gỡ bớt máy khác / bị gỡ) */
  "license.activate": def()(none),
  "license.devices": def()(none),
  "license.removeDevice": def()(byId),
  /** Hạn mức kênh: đang dùng / tối đa, kênh ngoài hạn mức */
  "channels.quota": def()(none),
  /** Chọn kênh dùng (≤ hạn mức) – kênh còn lại chuyển "Ngoài hạn mức" */
  "channels.setQuota": def()(zod.z.object({ activeIds: zod.z.array(zod.z.string().min(1).max(64)).max(1e5) })),
  "billing.plans": def()(none),
  "billing.createOrder": def()(zod.z.object({ planCode: zod.z.string().min(1).max(40), gateway: zod.z.enum(["VIETQR", "PAYOS"]).optional() })),
  /** Hỏi trạng thái đơn (app hỏi định kỳ khi khách đang thanh toán; PAID → tự làm mới license) */
  "billing.order": def()(zod.z.object({ code: zod.z.string().min(1).max(30) })),
  "billing.orders": def()(none),
  /** Phiên bản mới / bắt buộc cập nhật, thông báo từ quản trị */
  "cloud.appInfo": def()(none),
  /** Chuông thông báo: thông báo quản trị viên gửi + thông báo tự động (thanh toán thành công) */
  "cloud.notifications": def()(none),
  /** Mở chuông → đánh dấu mọi thông báo đã đọc */
  "cloud.notificationsSeen": def()(none),
  /** Mở link ngoài (trang thanh toán PayOS, tải bản cập nhật) bằng trình duyệt mặc định */
  "system.openExternal": def()(zod.z.object({ url: zod.z.string().url().max(2e3) })),
  // Workspaces
  "workspaces.list": def()(none),
  "workspaces.create": def()(WorkspaceInput),
  "workspaces.update": def()(zod.z.object({ id: id$1, patch: WorkspaceInput.partial() })),
  "workspaces.archive": def()(byId),
  /** Bật/tắt nhiễu Canvas cho mọi profile trình duyệt thuộc Pocket */
  "workspaces.setCanvasNoise": def()(zod.z.object({ id: id$1, enabled: zod.z.boolean() })),
  /** Xuất cấu hình (không gồm bí mật) ra file JSON qua hộp thoại lưu; null = người dùng hủy */
  "workspaces.export": def()(none),
  // Tài khoản / kênh / proxy
  "accounts.tree": def()(optionalWorkspace),
  "accounts.get": def()(byId),
  /** TikTok/Instagram: tự tạo kênh tương ứng. Facebook (VIA): thêm Fanpage bằng `channels.createPage`. */
  "accounts.create": def()(AccountInput),
  "accounts.update": def()(
    zod.z.object({ id: id$1, patch: AccountInput.omit({ platform: true }).partial() })
  ),
  "accounts.delete": def()(byId),
  "channels.createPage": def()(PageInput),
  "channels.delete": def()(byId),
  /**
   * Kết nối API đăng bài: dán Page token / User token (FB, IG – tự tìm trang khớp) hoặc Access token TikTok.
   * Token lưu mã hóa trong két, không bao giờ trả về renderer.
   */
  "channels.connect": def()(
    zod.z.object({
      channelId: id$1,
      token: zod.z.string().trim().min(20).max(4e3),
      refreshToken: zod.z.string().trim().max(4e3).nullish(),
      clientKey: zod.z.string().trim().max(200).nullish(),
      clientSecret: zod.z.string().trim().max(200).nullish()
    })
  ),
  "channels.verify": def()(byId),
  /** Ứng dụng Meta (App ID + App Secret) dùng cho "Kết nối Facebook" – khai báo một lần */
  /** viaCloud: chưa tự cấu hình ứng dụng riêng → kết nối bằng ứng dụng Omnira trên cloud */
  "integrations.meta": def()(none),
  /** Kết nối Facebook thì lấy luôn tài khoản Instagram liên kết với Fanpage (mặc định bật) */
  "integrations.setInstagram": def()(zod.z.object({ enabled: zod.z.boolean() })),
  "integrations.setMeta": def()(
    zod.z.object({ appId: zod.z.string().trim().regex(/^\d{5,20}$/, "App ID là dãy số"), appSecret: zod.z.string().trim().regex(/^[0-9a-f]{32}$/i, "App Secret gồm 32 ký tự 0-9, a-f").nullish(), configId: zod.z.string().trim().regex(/^\d{5,25}$/, "Configuration ID là dãy số").nullish().or(zod.z.literal("")), redirectUri: zod.z.string().trim().url("Redirect URI không hợp lệ").max(500).nullish().or(zod.z.literal("")), instagram: zod.z.boolean().optional() })
  ),
  /** Ứng dụng YouTube (OAuth Client loại Desktop app trong Google Cloud) – khai báo một lần */
  "integrations.youtube": def()(none),
  "integrations.setYoutube": def()(
    zod.z.object({
      clientId: zod.z.string().trim().regex(/^[\w-]+\.apps\.googleusercontent\.com$/, "Client ID có dạng …apps.googleusercontent.com"),
      clientSecret: zod.z.string().trim().min(10).max(200).nullish()
    })
  ),
  "integrations.setYoutubePublish": def()(
    zod.z.object({
      privacy: zod.z.enum(["public", "unlisted", "private"]).optional(),
      categoryId: zod.z.string().regex(/^\d{1,3}$/).optional(),
      declareSynthetic: zod.z.boolean().optional(),
      notifySubscribers: zod.z.boolean().optional()
    })
  ),
  /** "Kết nối YouTube": đăng nhập Google qua trình duyệt → tạo/cập nhật kênh YouTube */
  "accounts.connectYoutube": def()(
    zod.z.object({ accountId: id$1.optional(), workspaceId: id$1.nullish() }).default({})
  ),
  /** Hủy phiên đăng nhập YouTube đang chờ trình duyệt */
  "accounts.cancelYoutubeLogin": def()(none),
  /** Ứng dụng TikTok (Client Key + Secret) cho "Kết nối TikTok" – khai báo một lần */
  "integrations.tiktok": def()(none),
  "integrations.setTiktok": def()(
    zod.z.object({
      clientKey: zod.z.string().trim().min(8, "Client Key không hợp lệ").max(100),
      clientSecret: zod.z.string().trim().max(200).nullish(),
      redirectUri: zod.z.string().trim().url("Redirect URI không hợp lệ").max(500).nullish().or(zod.z.literal("")),
      scopes: zod.z.string().trim().max(300).regex(/^[a-z._,\s]*$/, "Scope gồm chữ thường, dấu chấm, phẩy").nullish()
    })
  ),
  /** Đăng nhập TikTok (OAuth + PKCE) → tạo/cập nhật tài khoản + kênh TikTok */
  "accounts.connectTiktok": def()(
    zod.z.object({ accountId: id$1.optional(), workspaceId: id$1.nullish() }).default({})
  ),
  /** Đăng nhập Facebook (OAuth) → tạo/cập nhật tài khoản VIA + mọi Fanpage/Instagram được cấp quyền */
  "accounts.connectFacebook": def()(
    zod.z.object({ accountId: id$1.optional(), workspaceId: id$1.nullish() }).default({})
  ),
  "channels.disconnect": def()(byId),
  /** Nhập mọi Fanpage (+ Instagram Business liên kết) từ User token của VIA; App ID/Secret → đổi token dài hạn */
  "accounts.importFacebook": def()(
    zod.z.object({
      accountId: id$1,
      userToken: zod.z.string().trim().min(20).max(4e3),
      appId: zod.z.string().trim().max(40).nullish(),
      appSecret: zod.z.string().trim().max(100).nullish()
    })
  ),
  "channels.list": def()(
    zod.z.object({ workspaceId: id$1.nullish(), platform: platform.optional() }).default({})
  ),
  "proxies.list": def()(optionalWorkspace),
  "proxies.create": def()(ProxyInput),
  "proxies.delete": def()(byId),
  // Kho nội dung
  "content.list": def()(
    zod.z.object({ workspaceId: id$1.nullish(), status: zod.z.array(contentStatus).optional(), search: zod.z.string().max(200).optional() }).default({})
  ),
  "content.create": def()(ContentInput),
  "content.delete": def()(byId),
  "content.update": def()(zod.z.object({ id: id$1, patch: ContentInput.partial() })),
  "content.bulkMove": def()(zod.z.object({ ids: zod.z.array(id$1).min(1).max(500), workspaceId: id$1.nullable() })),
  "content.bulkDelete": def()(zod.z.object({ ids: zod.z.array(id$1).min(1).max(500) })),
  "content.stats": def()(optionalWorkspace),
  /** AI Spin: sinh `count` biến thể caption cho mỗi nội dung (chạy tuần tự) */
  "content.spin": def()(
    zod.z.object({ ids: zod.z.array(id$1).min(1).max(50), count: zod.z.number().int().min(1).max(10).default(3) })
  ),
  "content.variants": def()(byId),
  /** Dùng biến thể làm caption + hashtag chính của nội dung */
  "content.applyVariant": def()(byId),
  "content.deleteVariant": def()(byId),
  /** Chấm điểm Hook (40% kỹ thuật + 60% AI giám khảo). platform bỏ trống = đoán theo kênh đã lên lịch / định dạng; force = chấm lại dù bài chưa đổi */
  "content.hookScore": def()(
    zod.z.object({ id: id$1, platform: zod.z.enum(["facebook", "tiktok", "instagram", "youtube"]).optional(), force: zod.z.boolean().default(false) })
  ),
  "content.hashtags": def()(zod.z.object({ ids: zod.z.array(id$1).min(1).max(50) })),
  // Xưởng Video AI
  "studio.projects": def()(optionalWorkspace),
  "studio.get": def()(byId),
  "studio.create": def()(ProjectInput),
  "studio.update": def()(zod.z.object({ id: id$1, patch: ProjectInput.partial() })),
  "studio.delete": def()(byId),
  /** Ghi đè toàn bộ danh sách phân cảnh theo đúng thứ tự gửi lên */
  "studio.saveScenes": def()(zod.z.object({ projectId: id$1, scenes: zod.z.array(SceneInput).max(200) })),
  /** Tạo (hoặc cập nhật) mục Kho nội dung gắn với dự án */
  "studio.toContent": def()(byId),
  /** Dữ liệu soạn prompt thủ công cho Google Vids / Flow (không gọi AI) */
  "studio.promptExport": def()(byId),
  /** Sinh kịch bản + phân cảnh bằng LLM; ghi đè phân cảnh hiện có */
  "studio.generateScript": def()(byId),
  /** Lập lại bộ nhận diện hình ảnh theo ảnh tham chiếu (AI xem ảnh) → cập nhật prompt hình các cảnh; updated = số cảnh đổi prompt */
  "studio.bibleFromRefs": def()(byId),
  /** Lưu bộ nhận diện người dùng sửa (tiếng Việt) → AI dịch sang tiếng Anh cho prompt hình → cập nhật prompt các cảnh */
  "studio.updateBible": def()(
    zod.z.object({
      id: id$1,
      bible: zod.z.object({
        style: zod.z.string().trim().max(800),
        characters: zod.z.array(zod.z.object({ name: zod.z.string().trim().min(1).max(60), look: zod.z.string().trim().min(1).max(800) })).max(8),
        product: zod.z.object({ name: zod.z.string().trim().min(1).max(80), look: zod.z.string().trim().min(1).max(800) }).nullable()
      })
    })
  ),
  /** Video dài: viết (lại) phân cảnh của một hồi theo dàn ý */
  "studio.writeAct": def()(zod.z.object({ projectId: id$1, act: zod.z.number().int().min(0).max(9) })),
  // Phân tích & mục tiêu kênh
  "analytics.overview": def()(
    zod.z.object({ workspaceId: id$1.nullish(), channelId: id$1.nullish(), days: zod.z.union([zod.z.literal(30), zod.z.literal(60), zod.z.literal(90)]).default(30) })
  ),
  "analytics.goals": def()(zod.z.object({ workspaceId: id$1.nullish(), channelId: id$1.nullish() }).default({})),
  "analytics.saveGoal": def()(
    zod.z.object({
      id: id$1.optional(),
      channelId: id$1,
      metric: zod.z.enum(["followers", "watch_minutes_60d", "views_30d", "videos_30d", "engagements_30d"]),
      target: zod.z.number().int().min(1).max(1e9),
      label: zod.z.string().trim().max(120).nullish()
    })
  ),
  "analytics.deleteGoal": def()(byId),
  // Kế hoạch nội dung (ngày dạng YYYY-MM-DD)
  "plan.list": def()(zod.z.object({ workspaceId: id$1.nullish(), from: isoDate$1, to: isoDate$1 })),
  /** AI lập kế hoạch N ngày theo ngách + bài hiệu quả của page (+ xu hướng tìm kiếm nếu bật) */
  "plan.generate": def()(
    zod.z.object({
      workspaceId: id$1.nullish(),
      startDate: isoDate$1,
      days: zod.z.number().int().min(1).max(30),
      perDay: zod.z.number().int().min(1).max(3),
      formats: zod.z.array(zod.z.string().max(80)).max(20).default([]),
      useTrends: zod.z.boolean().default(false)
    })
  ),
  "plan.save": def()(
    zod.z.object({
      id: id$1.optional(),
      workspaceId: id$1.nullish(),
      plannedDate: isoDate$1.nullish(),
      title: zod.z.string().trim().min(1).max(200),
      format: zod.z.string().max(80).default("free"),
      hook: zod.z.string().trim().max(300).nullish(),
      description: zod.z.string().trim().max(1e3).nullish(),
      status: zod.z.enum(["idea", "in_progress", "done", "dropped"]).optional()
    })
  ),
  "plan.delete": def()(byId),
  "plan.toVideo": def()(byId),
  "plan.toPost": def()(byId),
  // Series phim ngắn AI
  "series.list": def()(optionalWorkspace),
  "series.get": def()(byId),
  "series.create": def()(SeriesInput),
  "series.update": def()(zod.z.object({ id: id$1, patch: SeriesInput.partial() })),
  "series.delete": def()(byId),
  /** Series kiểu Phim: tạo (hoặc mở) phim của tập trong Xưởng Phim → id phim */
  "series.makeFilm": def()(zod.z.object({ episodeId: id$1 })),
  /** AI: thêm nhân vật còn thiếu + dàn ý N tập tiếp theo (tối đa 30; > 10 tập chia đợt 10, có mạch cả mùa – có thể mất vài phút) */
  "series.develop": def()(zod.z.object({ id: id$1, episodes: zod.z.number().int().min(1).max(30).default(5) })),
  "series.saveCharacter": def()(
    zod.z.object({
      id: id$1.optional(),
      seriesId: id$1,
      name: zod.z.string().trim().min(1).max(60),
      role: zod.z.string().trim().max(80).nullish(),
      appearance: zod.z.string().trim().max(600),
      personality: zod.z.string().trim().max(400).nullish(),
      /** Tuyến phát triển qua các tập */
      arc: zod.z.string().trim().max(600).nullish(),
      voiceId: zod.z.string().max(120).nullish(),
      /** Series kiểu Phim: nguồn giọng cố định + hồ sơ giọng (tiếng Anh) – dùng chung mọi tập */
      voiceProvider: zod.z.string().max(40).nullish(),
      voiceProfile: zod.z.string().max(300).nullish(),
      /** "Sửa prompt tiếng Anh (nâng cao)": true → dùng nguyên imagePrompt; false → AI viết lại từ mô tả tiếng Việt */
      promptManual: zod.z.boolean().optional(),
      /** Chỉ dùng khi promptManual = true */
      imagePrompt: zod.z.string().trim().max(1500).nullish()
    })
  ),
  /** Prompt ảnh nhân vật chuẩn (tiếng Anh) – AI viết từ mô tả tiếng Việt; còn khớp mô tả thì dùng lại */
  "series.characterPrompt": def()(zod.z.object({ id: id$1, force: zod.z.boolean().default(false) })),
  "series.deleteCharacter": def()(byId),
  /** Tạo ảnh tham chiếu nhân vật bằng ảnh AI (Nano Banana / Fal) */
  "series.characterImage": def()(byId),
  /** Ảnh nhân vật tải từ máy (đường dẫn chọn qua system.pickImage); null = gỡ ảnh */
  "series.setCharacterImage": def()(zod.z.object({ id: id$1, sourcePath: zod.z.string().min(1).max(1e3).nullable() })),
  "series.saveEpisode": def()(
    zod.z.object({
      id: id$1.optional(),
      seriesId: id$1,
      title: zod.z.string().trim().min(1).max(120),
      synopsis: zod.z.string().trim().max(1500),
      cliffhanger: zod.z.string().trim().max(400).nullish()
    })
  ),
  "series.deleteEpisode": def()(byId),
  /** AI viết kịch bản tập → dự án Xưởng video (thoại theo nhân vật, giọng riêng) */
  "series.writeEpisode": def()(byId),
  // Lịch đăng (from/to: epoch ms)
  "posts.range": def()(zod.z.object({ from: zod.z.number().int(), to: zod.z.number().int(), workspaceId: id$1.nullish() })),
  "posts.schedule": def()(zod.z.object({ contentItemId: id$1, channelId: id$1, scheduledAt: zod.z.number().int() })),
  /** Trả giờ đăng thật (có thể bị lùi vài phút do giãn cách bài trùng giờ) */
  "posts.reschedule": def()(zod.z.object({ id: id$1, scheduledAt: zod.z.number().int() })),
  "posts.cancel": def()(byId),
  /** Đăng ngay / thử lại bài đang chờ hoặc bị lỗi */
  "posts.publishNow": def()(byId),
  "posts.worker": def()(none),
  /** Đồng bộ số liệu thật (Insights) của mọi kênh đã kết nối API */
  "insights.sync": def()(none),
  "insights.last": def()(none),
  /** Giờ vàng học từ số liệu bài đã đăng (90 ngày) */
  "insights.bestHours": def()(optionalWorkspace),
  "posts.setWorker": def()(zod.z.object({ enabled: zod.z.boolean() })),
  /** Giãn cách bài trùng giờ giữa các kênh (áp dụng khi xếp / dời lịch) */
  "posts.stagger": def()(none),
  "posts.setStagger": def()(
    zod.z.object({ enabled: zod.z.boolean().optional(), minMinutes: zod.z.number().int().min(1).max(60).optional(), maxMinutes: zod.z.number().int().min(1).max(120).optional() })
  ),
  /**
   * Tự xếp lịch: mỗi nội dung → kênh phù hợp định dạng (ít bài nhất 7 ngày tới) trong Pocket của nó,
   * vào khung giờ vàng sớm nhất còn trống, cách bài khác cùng kênh ≥ spacingHours.
   */
  "posts.autoSchedule": def()(
    zod.z.object({ contentIds: zod.z.array(id$1).min(1).max(200), spacingHours: zod.z.number().min(1).max(24).default(4) })
  ),
  // Hộp thư hợp nhất
  "inbox.conversations": def()(
    zod.z.object({ workspaceId: id$1.nullish(), platform: platform.optional(), unreadOnly: zod.z.boolean().optional() }).default({})
  ),
  "inbox.messages": def()(zod.z.object({ conversationId: id$1 })),
  "inbox.markRead": def()(zod.z.object({ conversationId: id$1 })),
  "inbox.quickReplies": def()(optionalWorkspace),
  "inbox.stats": def()(optionalWorkspace),
  /** Xếp tin trả lời vào outbox ("Chờ gửi"); worker gửi thật qua Graph API ngay sau đó. */
  "inbox.send": def()(
    zod.z.object({
      conversationId: id$1,
      body: zod.z.string().trim().max(4e3),
      /** Tệp đính kèm đã chép vào media/inbox (inbox.pickAttachments) */
      attachments: zod.z.array(zod.z.string().max(300)).max(5).default([])
    }).refine((v) => v.body.length > 0 || v.attachments.length > 0, "Nhập nội dung hoặc đính kèm tệp")
  ),
  /** Chọn ảnh / tệp để gửi kèm tin nhắn → chép vào media/inbox, trả đường dẫn */
  "inbox.pickAttachments": def()(zod.z.object({ images: zod.z.boolean().default(false), multiple: zod.z.boolean().default(true) })),
  "inbox.update": def()(
    zod.z.object({
      conversationId: id$1,
      tags: zod.z.array(zod.z.string().trim().min(1).max(40)).max(12).optional(),
      status: zod.z.enum(["open", "pending", "resolved"]).optional()
    })
  ),
  "inbox.rules": def()(optionalWorkspace),
  "inbox.toggleRule": def()(zod.z.object({ id: id$1, enabled: zod.z.boolean() })),
  /** Tạo (không có id) hoặc sửa luật tự động */
  "inbox.saveRule": def()(
    zod.z.object({
      id: id$1.optional(),
      workspaceId: id$1.nullish(),
      channelId: id$1.nullish(),
      name: zod.z.string().trim().min(1).max(80),
      keywords: zod.z.array(zod.z.string().trim().min(1).max(60)).min(1).max(30),
      action: zod.z.enum(["reply_comment", "send_dm", "hide_comment"]),
      template: zod.z.string().trim().max(1e3).nullish(),
      minDelaySec: zod.z.number().int().min(0).max(600),
      maxDelaySec: zod.z.number().int().min(0).max(600),
      enabled: zod.z.boolean().optional()
    })
  ),
  "inbox.deleteRule": def()(byId),
  /** Đồng bộ ngay (một kênh hoặc tất cả kênh FB/IG đã kết nối) */
  "inbox.sync": def()(zod.z.object({ channelId: id$1.optional() }).default({})),
  "inbox.worker": def()(none),
  "inbox.setAutoSync": def()(zod.z.object({ enabled: zod.z.boolean() })),
  /** Gửi lại tin bị lỗi */
  "inbox.resend": def()(byId),
  /** AI tự trả lời + Page tự thích bình luận + gắn nhãn khách tiềm năng */
  "inbox.aiSettings": def()(none),
  "inbox.setAiSettings": def()(
    zod.z.object({
      mode: zod.z.enum(["off", "draft", "auto"]).optional(),
      comments: zod.z.boolean().optional(),
      messages: zod.z.boolean().optional(),
      minConfidence: zod.z.number().min(0.5).max(1).optional(),
      minDelaySec: zod.z.number().int().min(0).max(600).optional(),
      maxDelaySec: zod.z.number().int().min(0).max(900).optional(),
      maxPerHour: zod.z.number().int().min(1).max(500).optional(),
      autoLike: zod.z.boolean().optional(),
      tagLeads: zod.z.boolean().optional()
    })
  ),
  /** Duyệt câu trả lời AI (có thể sửa) → gửi ngay */
  "inbox.approveDraft": def()(zod.z.object({ id: id$1, body: zod.z.string().trim().max(4e3).nullish() })),
  "inbox.discardDraft": def()(byId),
  /** AI Co-Pilot: gợi ý câu trả lời tiếp theo (không tự gửi) */
  "inbox.suggestReply": def()(zod.z.object({ conversationId: id$1 })),
  // Tổng quan / cảnh báo / nhật ký
  "dashboard.summary": def()(optionalWorkspace),
  "dashboard.topChannels": def()(
    zod.z.object({ workspaceId: id$1.nullish(), limit: zod.z.number().int().min(1).max(20).default(3) }).default({})
  ),
  "dashboard.daemon": def()(optionalWorkspace),
  "alerts.open": def()(none),
  "alerts.resolve": def()(byId),
  "activity.recent": def()(zod.z.object({ limit: zod.z.number().int().min(1).max(200).default(20) }).default({})),
  // BYOK – chỉ metadata; key thật chỉ được đọc trong main (P3)
  "ai.providers": def()(none),
  "ai.updateProvider": def()(
    zod.z.object({
      id: id$1,
      patch: zod.z.object({
        defaultModel: zod.z.string().max(120).optional(),
        enabled: zod.z.boolean().optional(),
        /** Endpoint tùy chỉnh (gateway/proxy nội bộ); null = mặc định của nhà cung cấp */
        baseUrl: zod.z.string().url().max(300).nullable().optional()
      })
    })
  ),
  /** Lưu API key vào két (AES-256-GCM). Key không bao giờ quay lại renderer. */
  /** Lưu key rồi tự kiểm tra kết nối + tải danh sách model (cả nhà cung cấp dùng chung key) */
  "ai.setKey": def()(zod.z.object({ providerId: id$1, key: zod.z.string().trim().min(8).max(500) })),
  /** Gọi thử model đang chọn bằng một câu rất ngắn – phát hiện model 404 / quá tải trước khi dùng thật */
  "ai.testModel": def()(byId),
  "ai.removeKey": def()(zod.z.object({ providerId: id$1 })),
  /** Gọi endpoint xác thực của nhà cung cấp (không phát sinh phí), đo độ trễ, lấy danh sách model */
  "ai.test": def()(byId),
  "ai.testAll": def()(none),
  "ai.routing": def()(none),
  /** AI Omnira (AI văn bản mặc định của cloud): đang dùng không (chưa có key văn bản riêng) + hạn mức còn lại */
  "ai.omnira": def()(none),
  /** Sắp lại thứ tự ưu tiên các nhà cung cấp text (đầu danh sách = gọi trước) */
  "ai.reorder": def()(zod.z.object({ ids: zod.z.array(id$1).min(1).max(20) })),
  "ai.setFallback": def()(zod.z.object({ enabled: zod.z.boolean() })),
  "ai.pricing": def()(none),
  "ai.setPrice": def()(
    zod.z.object({ model: zod.z.string().trim().min(1).max(120), price: zod.z.object({ input: zod.z.number().min(0).max(1e3), output: zod.z.number().min(0).max(1e3) }).nullable() })
  ),
  "vault.info": def()(none),
  "settings.budget": def()(none),
  "settings.setBudget": def()(zod.z.object({ hardCapUsd: zod.z.number().min(0).max(1e5), circuitBreaker: zod.z.boolean() })),
  // Media Engine (P4)
  "media.info": def()(none),
  /** Dò lại encoder phần cứng (mỗi encoder mã hóa thử 0.2s) */
  "media.detect": def()(none),
  "media.setEncoder": def()(zod.z.object({ encoder: zod.z.enum(["auto", "h264_nvenc", "h264_amf", "h264_qsv", "libx264"]) })),
  "media.status": def()(none),
  "media.voices": def()(zod.z.object({ provider: zod.z.string().max(40) })),
  /** Giọng đọc local (VieNeu-TTS, GPU NVIDIA): trạng thái engine (detect = dò lại GPU) */
  // ── Xưởng Phim (shared/film.ts) ──
  /** Đủ điều kiện mở Xưởng Phim: key Veo (Gemini) hoặc Seedance (fal) + nguồn ảnh */
  "film.gate": def()(none),
  "film.list": def()(optionalWorkspace),
  "film.create": def()(
    zod.z.object({
      title: zod.z.string().trim().min(1).max(160),
      idea: zod.z.string().max(4e3).default(""),
      style: zod.z.string().max(400).default(""),
      genre: zod.z.string().trim().max(120).nullish(),
      visualStyle: zod.z.string().trim().max(300).nullish(),
      dialogueLanguage: zod.z.string().trim().min(1).max(60).default("Tiếng Việt"),
      subtitleVi: zod.z.boolean().optional(),
      notes: zod.z.string().max(2e3).nullish(),
      aspect: zod.z.enum(["9:16", "16:9", "1:1"]).default("16:9"),
      targetSec: zod.z.number().int().min(15).max(900).default(120),
      videoEngine: zod.z.enum(["seedance", "veo"]).optional(),
      workspaceId: id$1.nullish()
    })
  ),
  "film.get": def()(byId),
  "film.update": def()(
    zod.z.object({
      id: id$1,
      patch: zod.z.object({
        title: zod.z.string().trim().min(1).max(160),
        idea: zod.z.string().max(4e3),
        logline: zod.z.string().max(600).nullable(),
        voiceMode: zod.z.enum(["clip", "convert", "dub"]),
        style: zod.z.string().max(600),
        genre: zod.z.string().trim().max(120).nullable(),
        visualStyle: zod.z.string().trim().max(300).nullable(),
        dialogueLanguage: zod.z.string().trim().min(1).max(60),
        subtitleVi: zod.z.boolean(),
        notes: zod.z.string().max(2e3).nullable(),
        aspect: zod.z.enum(["9:16", "16:9", "1:1"]),
        targetSec: zod.z.number().int().min(15).max(900),
        videoEngine: zod.z.enum(["seedance", "veo"]),
        imageEngine: zod.z.enum(["google", "fal"]),
        takesPerRun: zod.z.number().int().min(1).max(4),
        videoResolution: zod.z.enum(["480p", "720p", "1080p"]),
        videoAudio: zod.z.boolean(),
        videoTier: zod.z.enum(["fast", "standard"]),
        workspaceId: id$1.nullable()
      }).partial()
    })
  ),
  "film.delete": def()(byId),
  /** AI viết kịch bản → thay toàn bộ nhân vật, bối cảnh, cảnh quay */
  "film.generateScript": def()(byId),
  /** Duyệt nhân vật AI đề xuất: episode = chỉ tập này, series = thêm vào dàn nhân vật series, drop = bỏ */
  "film.resolveProposals": def()(
    zod.z.object({ filmId: id$1, decisions: zod.z.array(zod.z.object({ assetId: id$1, action: zod.z.enum(["episode", "series", "drop"]) })).min(1).max(20) })
  ),
  /** Bối cảnh đã có ảnh ở các tập khác của cùng series (để dùng lại cho tập này) */
  "film.seriesLocations": def()(zod.z.object({ filmId: id$1 })),
  /** Dùng bối cảnh của tập khác: chép ảnh đã chọn (+ mô tả nếu copyText) vào bối cảnh `assetId` của phim này */
  "film.adoptLocation": def()(zod.z.object({ filmId: id$1, assetId: id$1, sourceAssetId: id$1, copyText: zod.z.boolean().default(true) })),
  /** Bảng nhân vật đã chọn → ảnh chuẩn của nhân vật series (các tập sau dùng) */
  "film.promoteToSeries": def()(zod.z.object({ assetId: id$1 })),
  /** Thêm (không có id) / sửa một mục */
  "film.saveAsset": def()(
    zod.z.object({
      filmId: id$1,
      id: id$1.optional(),
      kind: zod.z.enum(["character", "location", "shot"]),
      patch: zod.z.object({
        name: zod.z.string().trim().min(1).max(80),
        summary: zod.z.string().max(600),
        description: zod.z.string().max(1500),
        characterIds: zod.z.array(id$1).max(6),
        locationId: id$1.nullable(),
        camera: zod.z.string().max(300),
        durationSec: zod.z.number().int().min(3).max(15),
        dialogue: zod.z.string().max(800).nullable(),
        /** Cảnh quay: phụ đề tiếng Việt */
        subtitle: zod.z.string().max(800).nullable(),
        /** Nhân vật: hồ sơ giọng (tiếng Anh) + giọng cố định */
        voiceProfile: zod.z.string().max(300).nullable(),
        voiceProvider: zod.z.string().max(40).nullable(),
        voiceId: zod.z.string().max(120).nullable(),
        /** Bật = dùng nguyên prompt tiếng Anh người dùng sửa; tắt = AI dịch lại từ tóm tắt tiếng Việt khi tạo */
        promptManual: zod.z.boolean()
      }).partial()
    })
  ),
  /** Cập nhật ngay prompt tiếng Anh của một mục theo tóm tắt tiếng Việt hiện tại (để xem trước) */
  "film.refreshPrompt": def()(zod.z.object({ filmId: id$1, id: id$1 })),
  "film.deleteAsset": def()(byId),
  "film.reorder": def()(zod.z.object({ filmId: id$1, ids: zod.z.array(id$1).max(200) })),
  /** Ước tính chi phí trước khi xếp hàng (takes: số bản mỗi mục, mặc định theo phim) */
  "film.estimate": def()(
    zod.z.object({ filmId: id$1, assetIds: zod.z.array(id$1).min(1).max(200), takes: zod.z.number().int().min(1).max(4).optional(), kind: zod.z.enum(["image", "video"]).default("image") })
  ),
  /** Xếp hàng tạo ảnh (mặc định) hoặc video (cảnh quay, khung đầu = khung hình đã chọn) */
  "film.generate": def()(
    zod.z.object({ filmId: id$1, assetIds: zod.z.array(id$1).min(1).max(200), takes: zod.z.number().int().min(1).max(4).optional(), kind: zod.z.enum(["image", "video"]).default("image") })
  ),
  /** Chọn bản (ảnh hoặc video – theo loại của bản). takeId null + video → bỏ chọn video */
  /** Nâng cấp độ phân giải video đã tạo (1080p / 4K) bằng Google Flow hoặc FFmpeg trên máy → bản tạo mới */
  "film.upscale": def()(zod.z.object({ takeId: id$1, quality: zod.z.enum(["1080p", "4k"]), method: zod.z.enum(["flow", "local"]) })),
  "film.selectTake": def()(zod.z.object({ assetId: id$1, takeId: id$1.nullable(), video: zod.z.boolean().optional() })),
  "film.deleteTake": def()(byId),
  "film.cancel": def()(zod.z.object({ filmId: id$1, takeIds: zod.z.array(id$1).max(500).optional() })),
  /** Ghép tập: video đã chọn của các cảnh → MP4 (chạy nền, theo dõi qua film.assembleStatus) */
  "film.assemble": def()(
    zod.z.object({
      filmId: id$1,
      options: zod.z.object({
        transition: zod.z.enum(["cut", "fade_black"]),
        clipAudio: zod.z.boolean(),
        clipVolume: zod.z.number().min(0).max(2),
        bgmTrack: zod.z.string().max(200).nullable(),
        bgmVolume: zod.z.number().min(0).max(1),
        subtitleStyle: zod.z.string().max(60)
      })
    })
  ),
  "film.assembleStatus": def()(zod.z.object({ filmId: id$1 })),
  "film.assembleCancel": def()(zod.z.object({ filmId: id$1 })),
  "film.renders": def()(zod.z.object({ filmId: id$1 })),
  "film.deleteRender": def()(zod.z.object({ filmId: id$1, file: zod.z.string().max(400) })),
  /** Lưu bản ghép vào Kho nội dung → trả id nội dung */
  "film.renderToContent": def()(zod.z.object({ filmId: id$1, file: zod.z.string().max(400) })),
  /** Tối ưu lại từ khóa phong cách (tiếng Anh) từ thể loại / phong cách / ghi chú */
  "film.optimizeStyle": def()(byId),
  "film.queue": def()(zod.z.object({ filmId: id$1.nullish() }).default({})),
  "film.setQueue": def()(
    zod.z.object({ paused: zod.z.boolean().optional(), imageConcurrency: zod.z.number().int().min(1).max(8).optional(), videoConcurrency: zod.z.number().int().min(1).max(4).optional() })
  ),
  /** Google Flow: tạo video Veo bằng tài khoản Google của khách (Chrome trên máy) thay cho Veo API */
  "flow.status": def()(none),
  "flow.setSource": def()(zod.z.object({ source: zod.z.enum(["api", "flow"]) })),
  "flow.setPrefs": def()(zod.z.object({ hidden: zod.z.boolean().optional(), concurrency: zod.z.number().int().min(1).max(4).optional(), images: zod.z.boolean().optional() })),
  "flow.setModel": def()(zod.z.object({ model: zod.z.enum(["Veo 3.1 - Fast", "Veo 3.1 - Lite", "Veo 3.1 - Quality", "Omni 1.1 Flash"]) })),
  /** Mở Chrome (profile riêng) ở trang Flow để người dùng tự đăng nhập Google */
  "flow.openLogin": def()(none),
  "flow.check": def()(none),
  /** Đọc lại credit Google Flow còn lại (mở Chrome ẩn nếu cần; đang tạo video thì giữ số cũ) */
  "flow.refreshCredits": def()(none),
  "flow.close": def()(none),
  /** Đăng xuất: đóng Chrome + xóa profile (phiên Google) khỏi máy */
  "flow.reset": def()(none),
  /** dryRun: kiểm tra giao diện (mọi bước trừ bấm tạo – không tốn credit, kèm tải khung hình mẫu) → diagnostics = thư mục ảnh chụp */
  "flow.test": def()(
    zod.z.object({ prompt: zod.z.string().trim().min(3).max(1e3), aspect: zod.z.enum(["9:16", "16:9", "1:1"]).default("16:9"), dryRun: zod.z.boolean().default(false) })
  ),
  "flow.cancelTest": def()(none),
  "flow.openDiagnostics": def()(none),
  "localtts.status": def()(zod.z.object({ detect: zod.z.boolean().default(false) }).default({})),
  /** Bắt đầu tải & cài engine (chạy nền – theo dõi qua localtts.status) */
  "localtts.install": def()(none),
  "localtts.cancel": def()(none),
  "localtts.uninstall": def()(none),
  "localtts.clones": def()(none),
  /** Chọn file giọng mẫu → giọng clone mới (null = hủy). consent: người dùng xác nhận có quyền dùng giọng này */
  "localtts.addClone": def()(zod.z.object({ name: zod.z.string().max(60), consent: zod.z.literal(true) })),
  "localtts.renameClone": def()(zod.z.object({ id: id$1, name: zod.z.string().trim().min(1).max(60) })),
  "localtts.removeClone": def()(byId),
  /** Nghe thử giọng: đọc câu mẫu (lưu file vào media/voice-samples – lần sau phát lại, không gọi API); trả đường dẫn media tương đối */
  "media.previewVoice": def()(zod.z.object({ provider: zod.z.string().max(40), voiceId: zod.z.string().max(120).nullish(), workspaceId: id$1.nullish() })),
  "media.bgmList": def()(none),
  /** Chọn file nhạc → chép vào media/bgm; trả tên file (null = hủy) */
  "media.importBgm": def()(none),
  /** Xóa file tạm của job cũ & cache media không dùng > 30 ngày */
  "media.cleanup": def()(none),
  /** Nhạc nền AI (tùy chọn) → lưu vào thư viện nhạc nền; trả tên file */
  "media.generateMusic": def()(
    zod.z.object({
      provider: zod.z.enum(["google_lyria", "elevenlabs_music"]),
      prompt: zod.z.string().trim().min(3).max(500),
      durationSec: zod.z.number().min(10).max(180).default(30),
      instrumental: zod.z.boolean().default(true),
      workspaceId: id$1.nullish()
    })
  ),
  /** Nguồn ảnh AI ưu tiên cho chế độ Bán tự động */
  "media.imageEngine": def()(none),
  "media.setImageEngine": def()(zod.z.object({ engine: zod.z.enum(["auto", "google_image", "fal"]) })),
  "render.start": def()(zod.z.object({ projectId: id$1 })),
  /** Ước tính chi phí render (Veo, ảnh AI, giọng đọc trả phí) – cảnh đã có trong cache không tính */
  "render.estimate": def()(zod.z.object({ projectId: id$1 })),
  /** Chọn clip/ảnh của người dùng → chép vào thư mục media/uploads, trả đường dẫn để gắn vào cảnh */
  "media.importClips": def()(zod.z.object({ multiple: zod.z.boolean().default(false), images: zod.z.boolean().default(false) }).default({})),
  "render.cancel": def()(byId),
  "render.jobs": def()(zod.z.object({ projectId: id$1.nullish(), limit: zod.z.number().int().min(1).max(100).default(20) }).default({})),
  /** Mở thư mục chứa file (chỉ trong thư mục media) */
  "media.showInFolder": def()(zod.z.object({ path: zod.z.string().min(1).max(500) })),
  /** Nâng cấp độ phân giải video (đường dẫn trong thư mục media) – xem shared/upscale.ts */
  "media.upscaleInfo": def()(zod.z.object({ path: zod.z.string().min(1).max(500) })),
  "media.upscale": def()(zod.z.object({ path: zod.z.string().min(1).max(500), quality: zod.z.enum(["1080p", "4k"]), method: zod.z.enum(["flow", "local"]) })),
  "media.upscaleProgress": def()(zod.z.object({ path: zod.z.string().min(1).max(500) })),
  "media.cancelUpscale": def()(zod.z.object({ path: zod.z.string().min(1).max(500) })),
  // Hệ thống
  "system.dbInfo": def()(none),
  /** Hộp thoại chọn ảnh (watermark…); null = hủy */
  "system.pickImage": def()(none),
  /** Chọn nhiều file ảnh/video để đăng (hộp thoại hệ thống) */
  "system.pickMedia": def()(none),
  "system.storage": def()(none),
  /** Thư mục & file log của ứng dụng */
  "system.logInfo": def()(none),
  "system.openLogs": def()(none),
  /** Chạy nền dưới khay hệ thống / khởi động cùng Windows (theo máy) */
  "system.background": def()(none),
  "system.setBackground": def()(zod.z.object({ closeToTray: zod.z.boolean().optional(), launchAtLogin: zod.z.boolean().optional() }))
};
const pointerFile = () => node_path.join(electron.app.getPath("userData"), "data-location.json");
const DATA_MARKER = "omnipage-data.json";
let rootCache = null;
function dataRoot() {
  if (rootCache) return rootCache;
  let root2 = electron.app.getPath("userData");
  try {
    const v = JSON.parse(node_fs.readFileSync(pointerFile(), "utf8"));
    if (v.root && node_fs.existsSync(v.root)) root2 = v.root;
    else if (v.root) console.error(`[data] không tìm thấy thư mục dữ liệu đã chọn (${v.root}) – dùng thư mục mặc định`);
  } catch {
  }
  rootCache = root2;
  return root2;
}
const defaultDataRoot = () => electron.app.getPath("userData");
function setDataRootPointer(root2) {
  const tmp = pointerFile() + ".tmp";
  node_fs.writeFileSync(tmp, JSON.stringify(root2 && node_path.resolve(root2) !== node_path.resolve(defaultDataRoot()) ? { root: node_path.resolve(root2) } : {}, null, 2));
  node_fs.renameSync(tmp, pointerFile());
  rootCache = null;
}
function writeDataMarker(root2 = dataRoot()) {
  const f = node_path.join(root2, DATA_MARKER);
  if (node_fs.existsSync(f)) return;
  node_fs.mkdirSync(root2, { recursive: true });
  node_fs.writeFileSync(f, JSON.stringify({ app: "Omnira Studio", version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2));
}
const authRoot = () => node_path.join(dataRoot(), "auth");
let currentUserId = null;
function setCurrentUser(id2) {
  currentUserId = id2;
}
function currentUser() {
  return currentUserId;
}
function usersRoot() {
  return node_path.join(dataRoot(), "users");
}
function userDir(id2) {
  const uid = id2 ?? currentUserId;
  if (!uid) throw new Error("Chưa đăng nhập – không có thư mục dữ liệu người dùng");
  return node_path.join(usersRoot(), uid);
}
const legacyPaths = () => ({
  db: node_path.join(electron.app.getPath("userData"), "data", "omnipage.db"),
  dataDir: node_path.join(electron.app.getPath("userData"), "data"),
  media: node_path.join(electron.app.getPath("userData"), "media"),
  vault: node_path.join(electron.app.getPath("userData"), "vault")
});
const id = () => sqliteCore.text("id").primaryKey();
const createdAt = () => sqliteCore.integer("created_at", { mode: "timestamp_ms" }).notNull().default(drizzleOrm.sql`(unixepoch() * 1000)`);
const updatedAt = () => sqliteCore.integer("updated_at", { mode: "timestamp_ms" }).notNull().default(drizzleOrm.sql`(unixepoch() * 1000)`);
const ts$1 = (name) => sqliteCore.integer(name, { mode: "timestamp_ms" });
const json = (name) => sqliteCore.text(name, { mode: "json" }).$type();
const PLATFORMS = ["facebook", "tiktok", "instagram", "youtube"];
const workspaces = sqliteCore.sqliteTable("workspaces", {
  id: id(),
  name: sqliteCore.text("name").notNull(),
  color: sqliteCore.text("color").notNull().default("#c0c1ff"),
  icon: sqliteCore.text("icon"),
  description: sqliteCore.text("description"),
  brandVoice: sqliteCore.text("brand_voice"),
  /** Kiến thức để AI trả lời khách: bảng giá, size, phí ship, chính sách đổi trả, giờ mở cửa… */
  knowledge: sqliteCore.text("knowledge"),
  watermarkPath: sqliteCore.text("watermark_path"),
  watermarkPosition: sqliteCore.text("watermark_position", { enum: ["tl", "tr", "bl", "br", "center"] }).default("br"),
  watermarkOpacity: sqliteCore.real("watermark_opacity").notNull().default(0.85),
  /** Hashtag / nhãn ngách hiển thị trên thẻ Pocket */
  tags: json("tags").notNull().default([]),
  /** Ngân sách AI (USD/tháng) riêng của Pocket – null = dùng hạn mức chung */
  aiBudgetUsd: sqliteCore.real("ai_budget_usd"),
  goldenHours: json("golden_hours").notNull().default([]),
  /** Hạn mức token AI / tháng cho Pocket (null = không giới hạn) */
  aiTokenQuota: sqliteCore.integer("ai_token_quota"),
  sortOrder: sqliteCore.integer("sort_order").notNull().default(0),
  archivedAt: ts$1("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
const proxies = sqliteCore.sqliteTable(
  "proxies",
  {
    id: id(),
    workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    label: sqliteCore.text("label").notNull(),
    protocol: sqliteCore.text("protocol", { enum: ["socks5", "http", "https"] }).notNull().default("socks5"),
    host: sqliteCore.text("host").notNull(),
    port: sqliteCore.integer("port").notNull(),
    username: sqliteCore.text("username"),
    /** → secrets.id (kind = proxy_password) */
    passwordSecretId: sqliteCore.text("password_secret_id"),
    country: sqliteCore.text("country"),
    kind: sqliteCore.text("kind", { enum: ["residential", "datacenter", "mobile", "isp"] }),
    exitIp: sqliteCore.text("exit_ip"),
    latencyMs: sqliteCore.integer("latency_ms"),
    health: sqliteCore.text("health", { enum: ["ok", "warn", "error", "idle"] }).notNull().default("idle"),
    lastCheckedAt: ts$1("last_checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [sqliteCore.index("proxies_workspace_idx").on(t2.workspaceId)]
);
const browserProfiles = sqliteCore.sqliteTable("browser_profiles", {
  id: id(),
  workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  name: sqliteCore.text("name").notNull(),
  userAgent: sqliteCore.text("user_agent"),
  locale: sqliteCore.text("locale").default("vi-VN"),
  timezone: sqliteCore.text("timezone").default("Asia/Ho_Chi_Minh"),
  canvasNoise: sqliteCore.integer("canvas_noise", { mode: "boolean" }).notNull().default(true),
  webrtcShield: sqliteCore.integer("webrtc_shield", { mode: "boolean" }).notNull().default(true),
  webglVendor: sqliteCore.text("webgl_vendor"),
  /** Thư mục userData của profile, tương đối với app userData */
  dataDir: sqliteCore.text("data_dir"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
const accounts = sqliteCore.sqliteTable(
  "accounts",
  {
    id: id(),
    workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    platform: sqliteCore.text("platform", { enum: PLATFORMS }).notNull(),
    displayName: sqliteCore.text("display_name").notNull(),
    handle: sqliteCore.text("handle"),
    externalId: sqliteCore.text("external_id"),
    avatarUrl: sqliteCore.text("avatar_url"),
    proxyId: sqliteCore.text("proxy_id").references(() => proxies.id, { onDelete: "set null" }),
    browserProfileId: sqliteCore.text("browser_profile_id").references(() => browserProfiles.id, { onDelete: "set null" }),
    twoFactorEnabled: sqliteCore.integer("two_factor_enabled", { mode: "boolean" }).notNull().default(false),
    sessionStatus: sqliteCore.text("session_status", { enum: ["valid", "expiring", "expired", "checkpoint", "unknown"] }).notNull().default("unknown"),
    sessionExpiresAt: ts$1("session_expires_at"),
    health: sqliteCore.text("health", { enum: ["ok", "warn", "error", "idle"] }).notNull().default("idle"),
    note: sqliteCore.text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [
    sqliteCore.index("accounts_workspace_idx").on(t2.workspaceId),
    sqliteCore.uniqueIndex("accounts_platform_external_uq").on(t2.platform, t2.externalId)
  ]
);
const channels = sqliteCore.sqliteTable(
  "channels",
  {
    id: id(),
    workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    accountId: sqliteCore.text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    platform: sqliteCore.text("platform", { enum: PLATFORMS }).notNull(),
    kind: sqliteCore.text("kind", { enum: ["fb_page", "tiktok_account", "ig_account", "yt_channel"] }).notNull(),
    name: sqliteCore.text("name").notNull(),
    handle: sqliteCore.text("handle"),
    externalId: sqliteCore.text("external_id"),
    avatarUrl: sqliteCore.text("avatar_url"),
    /** Quyền của account trên kênh (Fanpage: admin/editor…) */
    role: sqliteCore.text("role"),
    followers: sqliteCore.integer("followers").notNull().default(0),
    nicheTag: sqliteCore.text("niche_tag"),
    tokenStatus: sqliteCore.text("token_status", { enum: ["valid", "expiring", "expired", "missing"] }).notNull().default("missing"),
    tokenExpiresAt: ts$1("token_expires_at"),
    status: sqliteCore.text("status", { enum: ["active", "paused", "error"] }).notNull().default("active"),
    /** Ngoài hạn mức kênh của gói: tạm dừng (status = paused), không đăng bài; bật lại khi còn chỗ / nâng gói */
    quotaBlocked: sqliteCore.integer("quota_blocked", { mode: "boolean" }).notNull().default(false),
    health: sqliteCore.text("health", { enum: ["ok", "warn", "error", "idle"] }).notNull().default("idle"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [
    sqliteCore.index("channels_workspace_idx").on(t2.workspaceId),
    sqliteCore.index("channels_account_idx").on(t2.accountId),
    sqliteCore.uniqueIndex("channels_platform_external_uq").on(t2.platform, t2.externalId)
  ]
);
const channelMetricsDaily = sqliteCore.sqliteTable(
  "channel_metrics_daily",
  {
    channelId: sqliteCore.text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    day: sqliteCore.text("day").notNull(),
    views: sqliteCore.integer("views").notNull().default(0),
    engagements: sqliteCore.integer("engagements").notNull().default(0),
    followers: sqliteCore.integer("followers").notNull().default(0),
    /** Phút xem video trong ngày (Facebook page_video_view_time) */
    watchMinutes: sqliteCore.integer("watch_minutes").notNull().default(0)
  },
  (t2) => [sqliteCore.uniqueIndex("channel_metrics_day_uq").on(t2.channelId, t2.day)]
);
const secrets = sqliteCore.sqliteTable(
  "secrets",
  {
    id: id(),
    kind: sqliteCore.text("kind", { enum: ["cookie", "access_token", "proxy_password", "totp_secret", "api_key"] }).notNull(),
    /** integration: cấu hình tích hợp (vd App Secret của Meta App, ownerId = 'meta') */
    ownerType: sqliteCore.text("owner_type", { enum: ["account", "channel", "proxy", "ai_provider", "integration"] }).notNull(),
    ownerId: sqliteCore.text("owner_id").notNull(),
    ciphertext: sqliteCore.text("ciphertext").notNull(),
    iv: sqliteCore.text("iv").notNull(),
    authTag: sqliteCore.text("auth_tag").notNull(),
    /** Phần hiển thị đã che, vd "EAAG…QZDD" */
    preview: sqliteCore.text("preview"),
    expiresAt: ts$1("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [sqliteCore.uniqueIndex("secrets_owner_kind_uq").on(t2.ownerType, t2.ownerId, t2.kind)]
);
const aiProviders = sqliteCore.sqliteTable("ai_providers", {
  id: id(),
  /** openai | gemini | deepseek | anthropic | elevenlabs | edge_tts | fal | replicate | pexels | kling … */
  provider: sqliteCore.text("provider").notNull(),
  category: sqliteCore.text("category", { enum: ["text", "tts", "media", "music"] }).notNull(),
  label: sqliteCore.text("label").notNull(),
  defaultModel: sqliteCore.text("default_model"),
  baseUrl: sqliteCore.text("base_url"),
  enabled: sqliteCore.integer("enabled", { mode: "boolean" }).notNull().default(true),
  status: sqliteCore.text("status", { enum: ["untested", "valid", "invalid", "rate_limited"] }).notNull().default("untested"),
  lastTestedAt: ts$1("last_tested_at"),
  lastLatencyMs: sqliteCore.integer("last_latency_ms"),
  /** Lỗi gần nhất (loại + mô tả ngắn, không chứa nội dung prompt/key) */
  lastError: sqliteCore.text("last_error"),
  /** Thứ tự ưu tiên trong chuỗi fallback cùng category */
  priority: sqliteCore.integer("priority").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
const aiUsage = sqliteCore.sqliteTable(
  "ai_usage",
  {
    id: id(),
    providerId: sqliteCore.text("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    model: sqliteCore.text("model"),
    feature: sqliteCore.text("feature"),
    inputTokens: sqliteCore.integer("input_tokens").notNull().default(0),
    outputTokens: sqliteCore.integer("output_tokens").notNull().default(0),
    characters: sqliteCore.integer("characters").notNull().default(0),
    costUsd: sqliteCore.real("cost_usd").notNull().default(0),
    ok: sqliteCore.integer("ok", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt()
  },
  (t2) => [sqliteCore.index("ai_usage_created_idx").on(t2.createdAt)]
);
const contentItems = sqliteCore.sqliteTable(
  "content_items",
  {
    id: id(),
    workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    kind: sqliteCore.text("kind", { enum: ["video", "reel", "image", "carousel", "text"] }).notNull(),
    title: sqliteCore.text("title").notNull(),
    caption: sqliteCore.text("caption"),
    hashtags: json("hashtags").notNull().default([]),
    mediaPaths: json("media_paths").notNull().default([]),
    thumbnailPath: sqliteCore.text("thumbnail_path"),
    durationSec: sqliteCore.real("duration_sec"),
    aspect: sqliteCore.text("aspect", { enum: ["9:16", "1:1", "4:5", "16:9"] }),
    status: sqliteCore.text("status", { enum: ["draft", "ready", "scheduled", "published", "failed"] }).notNull().default("draft"),
    source: sqliteCore.text("source", { enum: ["studio", "manual", "import", "film"] }).notNull().default("manual"),
    spinVariants: sqliteCore.integer("spin_variants").notNull().default(0),
    /** Bình luận đầu tiên tự đăng ngay sau khi bài lên (link, hashtag…) – Facebook & Instagram */
    firstComment: sqliteCore.text("first_comment"),
    aiReviewed: sqliteCore.integer("ai_reviewed", { mode: "boolean" }).notNull().default(false),
    /** Điểm Hook lần chấm gần nhất (shared/hook.ts) */
    hookScore: json("hook_score"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [sqliteCore.index("content_workspace_idx").on(t2.workspaceId), sqliteCore.index("content_status_idx").on(t2.status)]
);
const contentVariants = sqliteCore.sqliteTable(
  "content_variants",
  {
    id: id(),
    contentItemId: sqliteCore.text("content_item_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
    caption: sqliteCore.text("caption").notNull(),
    hashtags: json("hashtags").notNull().default([]),
    model: sqliteCore.text("model"),
    createdAt: createdAt()
  },
  (t2) => [sqliteCore.index("variants_content_idx").on(t2.contentItemId)]
);
const videoProjects = sqliteCore.sqliteTable("video_projects", {
  id: id(),
  workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  contentItemId: sqliteCore.text("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
  targetChannelId: sqliteCore.text("target_channel_id").references(() => channels.id, { onDelete: "set null" }),
  topic: sqliteCore.text("topic").notNull(),
  targetDurationSec: sqliteCore.integer("target_duration_sec").notNull().default(30),
  ttsProvider: sqliteCore.text("tts_provider").notNull().default("edge_tts"),
  voiceId: sqliteCore.text("voice_id"),
  renderMode: sqliteCore.text("render_mode", { enum: ["stock", "semi_ai", "full_ai"] }).notNull().default("stock"),
  subtitleStyle: sqliteCore.text("subtitle_style").notNull().default("montserrat-kara-pop"),
  bgmTrack: sqliteCore.text("bgm_track"),
  bgmVolume: sqliteCore.real("bgm_volume").notNull().default(0.15),
  /** Âm thanh của clip video (Veo / clip của người dùng): tts = chỉ giọng đọc; mix = giọng đọc + tiếng clip làm nền; clip = dùng tiếng clip (Veo tự lồng tiếng) */
  clipAudio: sqliteCore.text("clip_audio", { enum: ["tts", "mix", "clip"] }).notNull().default("tts"),
  /** Âm lượng tiếng clip khi trộn dưới giọng đọc (0–1) */
  clipAudioVolume: sqliteCore.real("clip_audio_volume").notNull().default(0.35),
  /** false = video KHÔNG lời thoại (teaser, video công nghệ, cảnh hình): không giọng đọc, không phụ đề, giữ tiếng clip + nhạc nền */
  narration: sqliteCore.integer("narration", { mode: "boolean" }).notNull().default(true),
  /** Mẫu định dạng nội dung (top list, tin nhanh, đố vui, tập phim…) – định hướng AI viết kịch bản */
  format: sqliteCore.text("format"),
  /** Khung hình xuất (shared/video.ts) – video dài mặc định 16:9 */
  aspect: sqliteCore.text("aspect", { enum: ["9:16", "16:9", "1:1"] }).notNull().default("9:16"),
  /** Chuyển cảnh giữa các phân cảnh. Dự án mới: mờ qua đen ($defaultFn – giữ DEFAULT SQL cũ để khỏi tạo lại bảng) */
  transition: sqliteCore.text("transition", { enum: ["cut", "fade_black"] }).notNull().default("cut").$defaultFn(() => "fade_black"),
  /** Video dài: dàn ý theo hồi (AI viết dàn ý trước, rồi viết từng hồi) – cảnh thuộc hồi qua video_scenes.act */
  acts: json("acts"),
  /** Ảnh tham chiếu chung của dự án (sản phẩm, logo, nhân vật…) – đường dẫn trong media/uploads */
  referenceImages: json("reference_images").notNull().default([]),
  /** Bộ nhận diện hình ảnh: phong cách chung + mô tả cố định nhân vật / sản phẩm (shared/shot.ts) – giữ nhất quán giữa các cảnh */
  visualBible: json("visual_bible"),
  status: sqliteCore.text("status", { enum: ["draft", "scripted", "rendering", "rendered", "failed"] }).notNull().default("draft"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
const videoScenes = sqliteCore.sqliteTable(
  "video_scenes",
  {
    id: id(),
    projectId: sqliteCore.text("project_id").notNull().references(() => videoProjects.id, { onDelete: "cascade" }),
    position: sqliteCore.integer("position").notNull(),
    label: sqliteCore.text("label"),
    voiceover: sqliteCore.text("voiceover").notNull().default(""),
    durationSec: sqliteCore.real("duration_sec").notNull().default(4),
    mediaPrompt: sqliteCore.text("media_prompt"),
    mediaSource: sqliteCore.text("media_source", { enum: ["stock", "pixabay", "fal", "nano_banana", "veo", "kling", "upload"] }),
    mediaPath: sqliteCore.text("media_path"),
    /** Ghi công nguồn media (vd "Video: Tên tác giả / Pexels") */
    mediaCredit: sqliteCore.text("media_credit"),
    /** Phim ngắn theo tập: nhân vật nói câu thoại (null = người dẫn truyện) */
    speakerId: sqliteCore.text("speaker_id"),
    /** Giọng đọc riêng của cảnh (theo nhân vật) – null = giọng của dự án */
    voiceId: sqliteCore.text("voice_id"),
    /** Thuộc hồi số mấy (0-based) trong dàn ý của dự án; clip ngắn luôn 0 */
    act: sqliteCore.integer("act").notNull().default(0),
    /** Nguồn hình người dùng chọn cho cảnh: auto = theo chế độ render của dự án; upload = clip/ảnh của người dùng (media_path) */
    mediaMode: sqliteCore.text("media_mode", { enum: ["auto", "stock", "image", "veo", "upload", "none"] }).notNull().default("auto"),
    /** Veo: ảnh khung đầu (image-to-video) và khung cuối (nội suy) – media/uploads */
    startImage: sqliteCore.text("start_image"),
    endImage: sqliteCore.text("end_image"),
    /** Ảnh tham chiếu riêng của cảnh (tối đa 3); null = tự động (nhân vật trong cảnh + ảnh tham chiếu dự án) */
    sceneRefs: json("scene_refs"),
    /** Từ khóa ngắn tìm video stock (prompt video đầy đủ nằm ở media_prompt) */
    searchQuery: sqliteCore.text("search_query")
  },
  (t2) => [sqliteCore.index("scenes_project_idx").on(t2.projectId, t2.position)]
);
const renderJobs = sqliteCore.sqliteTable(
  "render_jobs",
  {
    id: id(),
    projectId: sqliteCore.text("project_id").notNull().references(() => videoProjects.id, { onDelete: "cascade" }),
    status: sqliteCore.text("status", { enum: ["queued", "running", "done", "failed", "cancelled"] }).notNull().default("queued"),
    encoder: sqliteCore.text("encoder"),
    progress: sqliteCore.real("progress").notNull().default(0),
    /** Bước đang chạy (hiển thị cho người dùng) */
    stage: sqliteCore.text("stage"),
    /** Cảnh báo không làm hỏng job (vd thiếu key Pexels → dùng nền màu) */
    notes: json("notes").notNull().default([]),
    outputPath: sqliteCore.text("output_path"),
    error: sqliteCore.text("error"),
    startedAt: ts$1("started_at"),
    finishedAt: ts$1("finished_at"),
    createdAt: createdAt()
  },
  (t2) => [sqliteCore.index("render_jobs_status_idx").on(t2.status)]
);
const scheduledPosts = sqliteCore.sqliteTable(
  "scheduled_posts",
  {
    id: id(),
    contentItemId: sqliteCore.text("content_item_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
    channelId: sqliteCore.text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    scheduledAt: ts$1("scheduled_at").notNull(),
    status: sqliteCore.text("status", { enum: ["queued", "publishing", "published", "failed", "cancelled"] }).notNull().default("queued"),
    isGoldenHour: sqliteCore.integer("is_golden_hour", { mode: "boolean" }).notNull().default(false),
    attempts: sqliteCore.integer("attempts").notNull().default(0),
    publishedAt: ts$1("published_at"),
    externalPostId: sqliteCore.text("external_post_id"),
    /** Link xem bài trên nền tảng (khi API trả về) */
    permalink: sqliteCore.text("permalink"),
    /** Thời điểm worker được thử lại sau lỗi tạm thời (null = theo scheduledAt) */
    nextAttemptAt: ts$1("next_attempt_at"),
    /** Ghi chú không phải lỗi, vd "TikTok: ứng dụng chưa duyệt → đăng ở chế độ riêng tư" */
    note: sqliteCore.text("note"),
    /** Số liệu của bài sau khi đăng (đồng bộ Insights) */
    reach: sqliteCore.integer("reach"),
    views: sqliteCore.integer("views"),
    engagements: sqliteCore.integer("engagements"),
    /** Thời gian xem trung bình (giây) – video/Reels */
    avgWatchSec: sqliteCore.real("avg_watch_sec"),
    metricsAt: ts$1("metrics_at"),
    /** Kiểm tra sớm ~2 giờ sau đăng: số liệu lúc đó, mức thường lệ của kênh, kết quả (low/zero = phân phối kém) */
    earlyMetric: sqliteCore.integer("early_metric"),
    earlyBaseline: sqliteCore.integer("early_baseline"),
    earlyFlag: sqliteCore.text("early_flag", { enum: ["ok", "low", "zero", "unknown"] }),
    earlyCheckedAt: ts$1("early_checked_at"),
    error: sqliteCore.text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [sqliteCore.index("posts_scheduled_idx").on(t2.scheduledAt), sqliteCore.index("posts_channel_idx").on(t2.channelId)]
);
const conversations = sqliteCore.sqliteTable(
  "conversations",
  {
    id: id(),
    workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    channelId: sqliteCore.text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    platform: sqliteCore.text("platform", { enum: PLATFORMS }).notNull(),
    source: sqliteCore.text("source", { enum: ["messenger", "comment", "direct"] }).notNull(),
    externalId: sqliteCore.text("external_id"),
    customerName: sqliteCore.text("customer_name").notNull(),
    customerExternalId: sqliteCore.text("customer_external_id"),
    customerAvatarUrl: sqliteCore.text("customer_avatar_url"),
    /** Bài viết gốc khi hội thoại bắt đầu từ bình luận */
    contextPostId: sqliteCore.text("context_post_id"),
    contextPostTitle: sqliteCore.text("context_post_title"),
    tags: json("tags").notNull().default([]),
    status: sqliteCore.text("status", { enum: ["open", "pending", "resolved"] }).notNull().default("open"),
    unreadCount: sqliteCore.integer("unread_count").notNull().default(0),
    lastMessageAt: ts$1("last_message_at"),
    lastMessagePreview: sqliteCore.text("last_message_preview"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [sqliteCore.index("conversations_last_idx").on(t2.lastMessageAt), sqliteCore.index("conversations_channel_idx").on(t2.channelId)]
);
const messages = sqliteCore.sqliteTable(
  "messages",
  {
    id: id(),
    conversationId: sqliteCore.text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    direction: sqliteCore.text("direction", { enum: ["in", "out"] }).notNull(),
    author: sqliteCore.text("author", { enum: ["customer", "agent", "bot", "system"] }).notNull(),
    body: sqliteCore.text("body").notNull(),
    attachments: json("attachments").notNull().default([]),
    externalId: sqliteCore.text("external_id"),
    /** draft = AI soạn sẵn, chờ người duyệt (outbox không gửi) */
    deliveryStatus: sqliteCore.text("delivery_status", { enum: ["pending", "sent", "failed", "draft"] }),
    /** Tin đi ra: `message` = gửi nội dung; `hide` = ẩn bình luận `targetId` (luật chống cướp khách); `like` = Page thích bình luận */
    action: sqliteCore.text("action", { enum: ["message", "hide", "like"] }).notNull().default("message"),
    /** Bình luận đích khi trả lời / ẩn / nhắn riêng từ bình luận */
    targetId: sqliteCore.text("target_id"),
    /** Luật tự động đã tạo tin này */
    ruleId: sqliteCore.text("rule_id"),
    /** Outbox chỉ gửi khi tới thời điểm này (độ trễ tự nhiên của luật, thử lại sau lỗi) */
    sendAfter: ts$1("send_after"),
    attempts: sqliteCore.integer("attempts").notNull().default(0),
    error: sqliteCore.text("error"),
    /** AI: lý do cần duyệt / ý định khách / độ tin cậy */
    aiNote: sqliteCore.text("ai_note"),
    createdAt: createdAt()
  },
  (t2) => [sqliteCore.index("messages_conversation_idx").on(t2.conversationId, t2.createdAt), sqliteCore.index("messages_external_idx").on(t2.externalId), sqliteCore.index("messages_outbox_idx").on(t2.deliveryStatus, t2.sendAfter)]
);
const quickReplies = sqliteCore.sqliteTable("quick_replies", {
  id: id(),
  workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  /** "/size" */
  shortcut: sqliteCore.text("shortcut").notNull(),
  title: sqliteCore.text("title").notNull(),
  body: sqliteCore.text("body").notNull(),
  createdAt: createdAt()
});
const autoReplyRules = sqliteCore.sqliteTable("auto_reply_rules", {
  id: id(),
  workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  channelId: sqliteCore.text("channel_id").references(() => channels.id, { onDelete: "cascade" }),
  name: sqliteCore.text("name").notNull(),
  keywords: json("keywords").notNull().default([]),
  /** reply_comment | send_dm | hide_comment (vd: bình luận chứa SĐT) */
  action: sqliteCore.text("action", { enum: ["reply_comment", "send_dm", "hide_comment"] }).notNull(),
  template: sqliteCore.text("template"),
  minDelaySec: sqliteCore.integer("min_delay_sec").notNull().default(15),
  maxDelaySec: sqliteCore.integer("max_delay_sec").notNull().default(35),
  enabled: sqliteCore.integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
const alerts = sqliteCore.sqliteTable(
  "alerts",
  {
    id: id(),
    severity: sqliteCore.text("severity", { enum: ["info", "warn", "error"] }).notNull(),
    kind: sqliteCore.text("kind", {
      enum: ["cookie_expired", "token_invalid", "proxy_latency", "proxy_dead", "checkpoint", "render_failed", "publish_failed", "budget", "low_reach"]
    }).notNull(),
    entityType: sqliteCore.text("entity_type", { enum: ["account", "channel", "proxy", "render_job", "post", "ai_provider"] }),
    entityId: sqliteCore.text("entity_id"),
    title: sqliteCore.text("title").notNull(),
    message: sqliteCore.text("message").notNull(),
    resolvedAt: ts$1("resolved_at"),
    createdAt: createdAt()
  },
  (t2) => [sqliteCore.index("alerts_open_idx").on(t2.resolvedAt, t2.createdAt)]
);
const activityLog = sqliteCore.sqliteTable(
  "activity_log",
  {
    id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
    level: sqliteCore.text("level", { enum: ["ok", "info", "warn", "error"] }).notNull(),
    scope: sqliteCore.text("scope").notNull(),
    message: sqliteCore.text("message").notNull(),
    createdAt: createdAt()
  },
  (t2) => [sqliteCore.index("activity_created_idx").on(t2.createdAt)]
);
const settings = sqliteCore.sqliteTable("settings", {
  key: sqliteCore.text("key").primaryKey(),
  value: json("value").notNull(),
  updatedAt: updatedAt()
});
const series = sqliteCore.sqliteTable("series", {
  id: id(),
  workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  title: sqliteCore.text("title").notNull(),
  /** Một câu tóm tắt ý tưởng series */
  logline: sqliteCore.text("logline"),
  genre: sqliteCore.text("genre"),
  /** Phong cách hình ảnh cố định cho mọi cảnh, vd "anime 2D, tông ấm, ánh sáng điện ảnh" */
  visualStyle: sqliteCore.text("visual_style"),
  /** Phong cách hình ảnh dạng từ khóa tiếng Anh (AI chuyển từ visual_style) – ghép vào prompt hình từng cảnh */
  visualStyleEn: sqliteCore.text("visual_style_en"),
  /** visual_style lúc dịch – khác thì dịch lại */
  visualStyleFor: sqliteCore.text("visual_style_for"),
  episodeLengthSec: sqliteCore.integer("episode_length_sec").notNull().default(60),
  ttsProvider: sqliteCore.text("tts_provider").notNull().default("edge_tts"),
  /** Giọng người dẫn truyện */
  narratorVoiceId: sqliteCore.text("narrator_voice_id"),
  renderMode: sqliteCore.text("render_mode", { enum: ["stock", "semi_ai", "full_ai"] }).notNull().default("semi_ai"),
  targetChannelId: sqliteCore.text("target_channel_id").references(() => channels.id, { onDelete: "set null" }),
  /** Kiểu sản xuất: video = Xưởng Video AI (giọng đọc + ảnh/stock); film = Xưởng Phim (phim chuyên nghiệp) */
  productionMode: sqliteCore.text("production_mode", { enum: ["video", "film"] }).notNull().default("video"),
  /** Series kiểu Phim: ngôn ngữ thoại + ghi chú thêm (tiếng Việt được) */
  dialogueLanguage: sqliteCore.text("dialogue_language").notNull().default("Tiếng Việt"),
  notes: sqliteCore.text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
const seriesCharacters = sqliteCore.sqliteTable(
  "series_characters",
  {
    id: id(),
    seriesId: sqliteCore.text("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
    name: sqliteCore.text("name").notNull(),
    /** Vai trò trong truyện: nhân vật chính, phản diện… */
    role: sqliteCore.text("role"),
    /** Ngoại hình cố định – người dùng viết tiếng Việt; AI chuyển thành prompt tiếng Anh (image_prompt, appearance_en) */
    appearance: sqliteCore.text("appearance").notNull().default(""),
    personality: sqliteCore.text("personality"),
    /** Prompt tạo ảnh nhân vật chuẩn (tiếng Anh, AI viết từ mô tả) – dùng cho "Ảnh AI" và "Chép prompt" */
    imagePrompt: sqliteCore.text("image_prompt"),
    /** Mô tả ngoại hình ngắn gọn tiếng Anh – ghép vào prompt hình của từng cảnh trong tập phim */
    appearanceEn: sqliteCore.text("appearance_en"),
    /** Dấu của mô tả lúc tạo prompt – mô tả đổi thì prompt được tạo lại */
    imagePromptFor: sqliteCore.text("image_prompt_for"),
    /** Người dùng bật "Sửa prompt tiếng Anh (nâng cao)" → dùng nguyên image_prompt, AI không viết lại từ mô tả tiếng Việt */
    promptManual: sqliteCore.integer("prompt_manual", { mode: "boolean" }).notNull().default(false),
    voiceId: sqliteCore.text("voice_id"),
    /** Series kiểu Phim: nguồn giọng của nhân vật (elevenlabs / edge_tts / openai_tts / local_tts) – voiceId thuộc nguồn này */
    voiceProvider: sqliteCore.text("voice_provider"),
    /** Hồ sơ giọng (tiếng Anh, chèn vào prompt video): giới tính, tuổi, chất giọng, vùng miền – giống nhau mọi tập */
    voiceProfile: sqliteCore.text("voice_profile"),
    /** Ảnh tham chiếu nhân vật (tương đối thư mục media) – series kiểu Phim: bảng nhân vật chuẩn */
    referenceImage: sqliteCore.text("reference_image"),
    /** Tuyến phát triển nhân vật qua các tập (AI gợi ý, sửa được) – ngoại hình cố định, tâm lý / vị trí thay đổi */
    arc: sqliteCore.text("arc"),
    sortOrder: sqliteCore.integer("sort_order").notNull().default(0),
    createdAt: createdAt()
  },
  (t2) => [sqliteCore.index("series_characters_series_idx").on(t2.seriesId)]
);
const seriesEpisodes = sqliteCore.sqliteTable(
  "series_episodes",
  {
    id: id(),
    seriesId: sqliteCore.text("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
    number: sqliteCore.integer("number").notNull(),
    title: sqliteCore.text("title").notNull(),
    synopsis: sqliteCore.text("synopsis").notNull().default(""),
    /** Kết treo dẫn sang tập sau */
    cliffhanger: sqliteCore.text("cliffhanger"),
    projectId: sqliteCore.text("project_id").references(() => videoProjects.id, { onDelete: "set null" }),
    /** Series kiểu Phim: phim của tập trong Xưởng Phim (film_projects – không khai báo khóa ngoại vì bảng khai báo sau) */
    filmId: sqliteCore.text("film_id"),
    status: sqliteCore.text("status", { enum: ["planned", "scripted", "rendered", "published"] }).notNull().default("planned"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [sqliteCore.uniqueIndex("series_episodes_number_uq").on(t2.seriesId, t2.number)]
);
const contentIdeas = sqliteCore.sqliteTable(
  "content_ideas",
  {
    id: id(),
    workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD – ngày dự kiến đăng */
    plannedDate: sqliteCore.text("planned_date"),
    title: sqliteCore.text("title").notNull(),
    /** Mẫu định dạng (xem shared/formats.ts) */
    format: sqliteCore.text("format").notNull().default("free"),
    /** Câu mở đầu giữ chân người xem trong 3 giây đầu */
    hook: sqliteCore.text("hook"),
    description: sqliteCore.text("description"),
    status: sqliteCore.text("status", { enum: ["idea", "in_progress", "done", "dropped"] }).notNull().default("idea"),
    projectId: sqliteCore.text("project_id").references(() => videoProjects.id, { onDelete: "set null" }),
    contentItemId: sqliteCore.text("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    source: sqliteCore.text("source", { enum: ["ai", "manual"] }).notNull().default("manual"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [sqliteCore.index("content_ideas_date_idx").on(t2.workspaceId, t2.plannedDate)]
);
const channelGoals = sqliteCore.sqliteTable(
  "channel_goals",
  {
    id: id(),
    channelId: sqliteCore.text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    metric: sqliteCore.text("metric", { enum: ["followers", "watch_minutes_60d", "views_30d", "videos_30d", "engagements_30d"] }).notNull(),
    target: sqliteCore.integer("target").notNull(),
    label: sqliteCore.text("label"),
    createdAt: createdAt()
  },
  (t2) => [sqliteCore.index("channel_goals_channel_idx").on(t2.channelId)]
);
const filmProjects = sqliteCore.sqliteTable("film_projects", {
  id: id(),
  workspaceId: sqliteCore.text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  title: sqliteCore.text("title").notNull(),
  idea: sqliteCore.text("idea").notNull().default(""),
  logline: sqliteCore.text("logline"),
  /** Từ khóa phong cách tiếng Anh ĐÃ TỐI ƯU (ghép vào mọi prompt) – hệ thống tạo từ thể loại / phong cách / ghi chú */
  style: sqliteCore.text("style").notNull().default(""),
  /** Lựa chọn của người dùng (shared/film-style.ts – lựa chọn sẵn hoặc tự nhập, tiếng Việt được) */
  genre: sqliteCore.text("genre"),
  visualStyle: sqliteCore.text("visual_style"),
  dialogueLanguage: sqliteCore.text("dialogue_language").notNull().default("Tiếng Việt"),
  notes: sqliteCore.text("notes"),
  /** Dấu của lựa chọn lúc tạo `style` – đổi lựa chọn thì tối ưu lại; "manual:…" = người dùng tự sửa `style` */
  styleFor: sqliteCore.text("style_for"),
  /** Giọng nhân vật khi ghép: clip = giữ giọng model tạo · convert = đổi sang giọng nhân vật (ElevenLabs, giữ khẩu hình) · dub = lồng tiếng bằng giọng đọc */
  voiceMode: sqliteCore.text("voice_mode", { enum: ["clip", "convert", "dub"] }).notNull().default("clip"),
  /** Thoại không phải tiếng Việt: ghép tập kèm phụ đề tiếng Việt (bản dịch lời thoại từng cảnh) */
  subtitleVi: sqliteCore.integer("subtitle_vi", { mode: "boolean" }).notNull().default(false),
  aspect: sqliteCore.text("aspect", { enum: ["9:16", "16:9", "1:1"] }).notNull().default("16:9"),
  targetSec: sqliteCore.integer("target_sec").notNull().default(120),
  videoEngine: sqliteCore.text("video_engine", { enum: ["seedance", "veo"] }).notNull().default("seedance"),
  imageEngine: sqliteCore.text("image_engine", { enum: ["google", "fal"] }).notNull().default("google"),
  takesPerRun: sqliteCore.integer("takes_per_run").notNull().default(2),
  /** Phim của một tập series (series kiểu Phim) */
  seriesId: sqliteCore.text("series_id").references(() => series.id, { onDelete: "set null" }),
  episodeId: sqliteCore.text("episode_id").references(() => seriesEpisodes.id, { onDelete: "set null" }),
  /** Id nhân vật series phim đã biết (đã nhập vào phim) – nhân vật series MỚI ngoài danh sách này được thêm khi mở phim */
  castKnown: json("cast_known"),
  /** Video: độ phân giải, có tạo âm thanh (tiếng động + lời thoại khớp môi), bản Seedance (fast rẻ hơn) */
  videoResolution: sqliteCore.text("video_resolution", { enum: ["480p", "720p", "1080p"] }).notNull().default("720p"),
  videoAudio: sqliteCore.integer("video_audio", { mode: "boolean" }).notNull().default(true),
  videoTier: sqliteCore.text("video_tier", { enum: ["fast", "standard"] }).notNull().default("fast"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
const filmAssets = sqliteCore.sqliteTable(
  "film_assets",
  {
    id: id(),
    filmId: sqliteCore.text("film_id").notNull().references(() => filmProjects.id, { onDelete: "cascade" }),
    kind: sqliteCore.text("kind", { enum: ["character", "location", "shot"] }).notNull(),
    position: sqliteCore.integer("position").notNull().default(0),
    name: sqliteCore.text("name").notNull(),
    summary: sqliteCore.text("summary").notNull().default(""),
    description: sqliteCore.text("description").notNull().default(""),
    /** Tóm tắt tiếng Việt mà `description` (prompt tiếng Anh) được viết theo – tóm tắt đổi thì AI cập nhật prompt trước khi tạo ảnh / video */
    descriptionSrc: sqliteCore.text("description_src"),
    /** Người dùng bật "Sửa prompt tiếng Anh (nâng cao)" → dùng nguyên `description`, không dịch lại từ tiếng Việt */
    promptManual: sqliteCore.integer("prompt_manual", { mode: "boolean" }).notNull().default(false),
    characterIds: json("character_ids").notNull().default([]),
    locationId: sqliteCore.text("location_id"),
    camera: sqliteCore.text("camera").notNull().default(""),
    durationSec: sqliteCore.integer("duration_sec").notNull().default(6),
    dialogue: sqliteCore.text("dialogue"),
    /** Cảnh quay: phụ đề tiếng Việt (bản dịch lời thoại – sửa tay được) */
    subtitle: sqliteCore.text("subtitle"),
    /** Lời thoại mà `subtitle` được dịch / viết theo – khác lời thoại hiện tại thì dịch lại khi ghép */
    subtitleSrc: sqliteCore.text("subtitle_src"),
    selectedTakeId: sqliteCore.text("selected_take_id"),
    /** Cảnh quay: bản video đã chọn (khung hình đã chọn nằm ở selectedTakeId) */
    selectedVideoTakeId: sqliteCore.text("selected_video_take_id"),
    /** Nhân vật lấy từ dàn nhân vật series (bản gốc) */
    seriesCharacterId: sqliteCore.text("series_character_id").references(() => seriesCharacters.id, { onDelete: "set null" }),
    /** Nhân vật: hồ sơ giọng (tiếng Anh – chèn vào prompt video) + giọng cố định (đổi giọng / lồng tiếng khi ghép) */
    voiceProfile: sqliteCore.text("voice_profile"),
    voiceProvider: sqliteCore.text("voice_provider"),
    voiceId: sqliteCore.text("voice_id"),
    /** Nhân vật AI đề xuất khi viết kịch bản, chờ người dùng duyệt */
    proposal: sqliteCore.text("proposal", { enum: ["pending"] }),
    /** Phạm vi AI đề xuất: chỉ tập này / thêm vào dàn nhân vật series */
    proposedScope: sqliteCore.text("proposed_scope", { enum: ["episode", "series"] }),
    proposalReason: sqliteCore.text("proposal_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t2) => [sqliteCore.index("film_assets_film_idx").on(t2.filmId, t2.kind, t2.position)]
);
const filmTakes = sqliteCore.sqliteTable(
  "film_takes",
  {
    id: id(),
    filmId: sqliteCore.text("film_id").notNull().references(() => filmProjects.id, { onDelete: "cascade" }),
    assetId: sqliteCore.text("asset_id").notNull().references(() => filmAssets.id, { onDelete: "cascade" }),
    kind: sqliteCore.text("kind", { enum: ["image", "video"] }).notNull(),
    status: sqliteCore.text("status", { enum: ["queued", "running", "done", "failed", "cancelled"] }).notNull().default("queued"),
    file: sqliteCore.text("file"),
    /** Prompt + ảnh tham chiếu lúc xếp hàng (chụp lại – sửa mô tả sau đó không đổi bản đang chờ) */
    prompt: sqliteCore.text("prompt").notNull(),
    refs: json("refs").notNull().default([]),
    model: sqliteCore.text("model"),
    /** Video: thời lượng clip yêu cầu (giây) */
    durationSec: sqliteCore.integer("duration_sec"),
    costUsd: sqliteCore.real("cost_usd").notNull().default(0),
    error: sqliteCore.text("error"),
    attempts: sqliteCore.integer("attempts").notNull().default(0),
    /** Thử lại sau lỗi tạm thời (quá tải / giới hạn) không sớm hơn mốc này */
    notBefore: ts$1("not_before"),
    /** Bản nâng cấp độ phân giải của bản `sourceTakeId` (shared/upscale.ts) – hàng đợi chạy nâng cấp thay vì tạo mới */
    upscale: sqliteCore.text("upscale"),
    sourceTakeId: sqliteCore.text("source_take_id"),
    createdAt: createdAt(),
    startedAt: ts$1("started_at"),
    finishedAt: ts$1("finished_at")
  },
  (t2) => [sqliteCore.index("film_takes_queue_idx").on(t2.status, t2.kind, t2.createdAt), sqliteCore.index("film_takes_asset_idx").on(t2.assetId)]
);
const schema = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  PLATFORMS,
  accounts,
  activityLog,
  aiProviders,
  aiUsage,
  alerts,
  autoReplyRules,
  browserProfiles,
  channelGoals,
  channelMetricsDaily,
  channels,
  contentIdeas,
  contentItems,
  contentVariants,
  conversations,
  filmAssets,
  filmProjects,
  filmTakes,
  messages,
  proxies,
  quickReplies,
  renderJobs,
  scheduledPosts,
  secrets,
  series,
  seriesCharacters,
  seriesEpisodes,
  settings,
  videoProjects,
  videoScenes,
  workspaces
}, Symbol.toStringTag, { value: "Module" }));
let sqlite = null;
let db = null;
function migrationsFolder() {
  return electron.app.isPackaged ? node_path.join(process.resourcesPath, "drizzle") : node_path.join(__dirname, "../../drizzle");
}
function dbFilePath() {
  return process.env["OMNI_DB_PATH"] ?? node_path.join(userDir(), "data", "omnipage.db");
}
function openDatabase() {
  if (db) return db;
  const file2 = dbFilePath();
  node_fs.mkdirSync(node_path.join(file2, ".."), { recursive: true });
  sqlite = new Database(file2);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  db = betterSqlite3.drizzle(sqlite, { schema });
  migrator.migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}
function getDb() {
  if (!db) throw new Error("Chưa đăng nhập – cơ sở dữ liệu của người dùng chưa được mở");
  return db;
}
function closeDatabase() {
  sqlite?.close();
  sqlite = null;
  db = null;
}
function newId() {
  return crypto.randomUUID();
}
class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const notFound = (what) => new ApiError("NOT_FOUND", `Không tìm thấy ${what}`);
let masterKey = null;
function masterKeyPath() {
  return node_path.join(userDir(), "vault", "master.bin");
}
function resetVaultCache() {
  masterKey = null;
}
function vaultAvailable() {
  return electron.safeStorage.isEncryptionAvailable();
}
function getMasterKey() {
  if (masterKey) return masterKey;
  if (!vaultAvailable()) {
    throw new ApiError("INTERNAL", "Hệ điều hành không cung cấp kho khóa an toàn (safeStorage) – không thể lưu bí mật");
  }
  const file2 = masterKeyPath();
  if (node_fs.existsSync(file2)) {
    masterKey = Buffer.from(electron.safeStorage.decryptString(node_fs.readFileSync(file2)), "base64");
    if (masterKey.length !== 32) throw new ApiError("INTERNAL", "Master key hỏng – không đúng 32 byte");
  } else {
    masterKey = node_crypto.randomBytes(32);
    node_fs.mkdirSync(node_path.join(file2, ".."), { recursive: true });
    node_fs.writeFileSync(file2, electron.safeStorage.encryptString(masterKey.toString("base64")), { mode: 384 });
  }
  return masterKey;
}
const PORTABLE_N = 1 << 15;
const portablePath = (userId) => node_path.join(userDir(userId), "vault", "master.portable");
const machinePath = (userId) => node_path.join(userDir(userId), "vault", "master.bin");
function portableKey(password2, salt) {
  return node_crypto.scryptSync(password2.normalize("NFKC"), salt, 32, { N: PORTABLE_N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
}
function writePortableKey(userId, password2) {
  if (currentUser() !== userId) return;
  const key2 = getMasterKey();
  const salt = node_crypto.randomBytes(16);
  const iv = node_crypto.randomBytes(12);
  const c = node_crypto.createCipheriv("aes-256-gcm", portableKey(password2, salt), iv);
  const data = Buffer.concat([c.update(key2), c.final()]);
  const out = {
    v: 1,
    kdf: "scrypt",
    N: PORTABLE_N,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    data: data.toString("base64")
  };
  const file2 = portablePath(userId);
  node_fs.mkdirSync(node_path.join(file2, ".."), { recursive: true });
  node_fs.writeFileSync(file2 + ".tmp", JSON.stringify(out), { mode: 384 });
  node_fs.renameSync(file2 + ".tmp", file2);
}
function recoverVaultOnThisMachine(userId, password2) {
  const machine = machinePath(userId);
  const portable = portablePath(userId);
  if (!node_fs.existsSync(portable) || !vaultAvailable()) return false;
  if (node_fs.existsSync(machine)) {
    try {
      const k = Buffer.from(electron.safeStorage.decryptString(node_fs.readFileSync(machine)), "base64");
      if (k.length === 32) return false;
    } catch {
    }
  }
  const p = JSON.parse(node_fs.readFileSync(portable, "utf8"));
  const d = node_crypto.createDecipheriv("aes-256-gcm", portableKey(password2, Buffer.from(p.salt, "base64")), Buffer.from(p.iv, "base64"));
  d.setAuthTag(Buffer.from(p.tag, "base64"));
  const key2 = Buffer.concat([d.update(Buffer.from(p.data, "base64")), d.final()]);
  if (key2.length !== 32) throw new ApiError("INTERNAL", "Khóa di chuyển hỏng");
  if (node_fs.existsSync(machine)) node_fs.renameSync(machine, machine + `.may-cu-${Date.now()}`);
  node_fs.writeFileSync(machine, electron.safeStorage.encryptString(key2.toString("base64")), { mode: 384 });
  masterKey = null;
  console.info(`[vault] đã mở két bằng khóa di chuyển cho tài khoản ${userId.slice(0, 8)} (dữ liệu chép từ máy khác)`);
  return true;
}
function vaultFingerprint() {
  if (!vaultAvailable() || !node_fs.existsSync(masterKeyPath())) return null;
  return node_crypto.createHash("sha256").update(getMasterKey()).digest("hex").slice(0, 8);
}
const aad = (ownerType, ownerId, kind) => Buffer.from(`${ownerType}:${ownerId}:${kind}`, "utf8");
function maskSecret(value) {
  const v = value.trim();
  if (v.length <= 12) return "•".repeat(Math.max(4, v.length));
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}
function putSecret(input) {
  const key2 = getMasterKey();
  const iv = node_crypto.randomBytes(12);
  const cipher = node_crypto.createCipheriv("aes-256-gcm", key2, iv);
  cipher.setAAD(aad(input.ownerType, input.ownerId, input.kind));
  const ciphertext = Buffer.concat([cipher.update(input.value, "utf8"), cipher.final()]);
  const row = {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    preview: maskSecret(input.value),
    expiresAt: input.expiresAt ?? null,
    updatedAt: /* @__PURE__ */ new Date()
  };
  getDb().insert(secrets).values({ id: newId(), kind: input.kind, ownerType: input.ownerType, ownerId: input.ownerId, ...row }).onConflictDoUpdate({ target: [secrets.ownerType, secrets.ownerId, secrets.kind], set: row }).run();
}
function readSecret(ownerType, ownerId, kind) {
  const row = getDb().select().from(secrets).where(drizzleOrm.and(drizzleOrm.eq(secrets.ownerType, ownerType), drizzleOrm.eq(secrets.ownerId, ownerId), drizzleOrm.eq(secrets.kind, kind))).get();
  if (!row) return null;
  const decipher = node_crypto.createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(row.iv, "base64"));
  decipher.setAAD(aad(ownerType, ownerId, kind));
  decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
function rekeyFromLegacy(legacyKeyFile) {
  if (!vaultAvailable() || !node_fs.existsSync(legacyKeyFile)) return { rekeyed: 0, unreadable: 0 };
  const legacy = Buffer.from(electron.safeStorage.decryptString(node_fs.readFileSync(legacyKeyFile)), "base64");
  if (legacy.length !== 32) return { rekeyed: 0, unreadable: 0 };
  const decryptWith = (key2, r) => {
    try {
      const d = node_crypto.createDecipheriv("aes-256-gcm", key2, Buffer.from(r.iv, "base64"));
      d.setAAD(aad(r.ownerType, r.ownerId, r.kind));
      d.setAuthTag(Buffer.from(r.authTag, "base64"));
      return Buffer.concat([d.update(Buffer.from(r.ciphertext, "base64")), d.final()]).toString("utf8");
    } catch {
      return null;
    }
  };
  const current2 = getMasterKey();
  let rekeyed = 0;
  let unreadable = 0;
  for (const r of getDb().select().from(secrets).all()) {
    if (decryptWith(current2, r) != null) continue;
    const value = decryptWith(legacy, r);
    if (value == null) {
      unreadable++;
      continue;
    }
    const iv = node_crypto.randomBytes(12);
    const c = node_crypto.createCipheriv("aes-256-gcm", current2, iv);
    c.setAAD(aad(r.ownerType, r.ownerId, r.kind));
    const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
    getDb().update(secrets).set({ ciphertext: ct.toString("base64"), iv: iv.toString("base64"), authTag: c.getAuthTag().toString("base64") }).where(drizzleOrm.eq(secrets.id, r.id)).run();
    rekeyed++;
  }
  return { rekeyed, unreadable };
}
function deleteSecret(ownerType, ownerId, kind) {
  const res = getDb().delete(secrets).where(drizzleOrm.and(drizzleOrm.eq(secrets.ownerType, ownerType), drizzleOrm.eq(secrets.ownerId, ownerId), drizzleOrm.eq(secrets.kind, kind))).run();
  return res.changes > 0;
}
const SEED_KEY = "demo.seeded";
const DAY$7 = 864e5;
const HOUR$2 = 36e5;
function isSeeded() {
  return getDb().select().from(settings).where(drizzleOrm.eq(settings.key, SEED_KEY)).get() != null;
}
function seedIfEmpty() {
  const allowed = process.env["OMNI_SEED"] === "1";
  if (!allowed) return false;
  const db2 = getDb();
  if (db2.select({ id: workspaces.id }).from(workspaces).limit(1).get()) return false;
  db2.transaction((tx) => seed(tx, Date.now()));
  return true;
}
function rng(seed2) {
  let t2 = seed2 >>> 0;
  return () => {
    t2 += 1831565813;
    let r = Math.imul(t2 ^ t2 >>> 15, 1 | t2);
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
function at(base, dayOffset, hhmm2) {
  const d = new Date(base + dayOffset * DAY$7);
  const [h, m] = hhmm2.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
function seed(db2, now2) {
  const ago = (ms) => new Date(now2 - ms);
  const goldenFashion = [
    { start: "06:00", end: "08:30", weight: 0.14 },
    { start: "11:00", end: "13:30", weight: 0.39 },
    { start: "14:00", end: "17:30", weight: 0.12 },
    { start: "19:30", end: "22:00", weight: 0.42 }
  ];
  const ws = {
    fashion: newId(),
    beauty: newId(),
    game: newId(),
    health: newId()
  };
  db2.insert(workspaces).values([
    {
      id: ws.fashion,
      name: "Thời Trang Nữ & Công sở",
      color: "#c0c1ff",
      icon: "shirt",
      description: "Dàn kênh thời trang công sở, váy cưới, phụ kiện",
      brandVoice: 'Thân thiện, xưng "em" – gọi khách là "chị/nàng", ngắn gọn, nhấn mạnh tôn dáng & chất liệu.',
      goldenHours: goldenFashion,
      tags: ["#Fashion", "#Reels", "#TikTokShop"],
      aiBudgetUsd: 40,
      watermarkPath: "watermark_glamour_v2.png",
      sortOrder: 0
    },
    {
      id: ws.beauty,
      name: "Mỹ phẩm & Chăm sóc da",
      color: "#4edea3",
      icon: "sparkles",
      description: "Mỹ phẩm organic, skincare, son",
      brandVoice: "Chuyên gia dịu dàng, giải thích thành phần rõ ràng, không cam kết công dụng y khoa.",
      goldenHours: [
        { start: "12:00", end: "13:00", weight: 0.3 },
        { start: "20:00", end: "22:30", weight: 0.5 }
      ],
      tags: ["#Beauty", "#KOC", "#Review"],
      aiBudgetUsd: 20,
      sortOrder: 1
    },
    {
      id: ws.game,
      name: "Game & Công nghệ Giải trí",
      color: "#4cd7f6",
      icon: "gamepad-2",
      description: "Review game, tin công nghệ",
      brandVoice: "Năng động, dùng thuật ngữ game thủ, hài hước vừa phải.",
      goldenHours: [{ start: "21:00", end: "23:59", weight: 0.6 }],
      tags: ["#Gaming", "#Esports", "#Shorts"],
      aiBudgetUsd: 25,
      sortOrder: 2
    },
    {
      id: ws.health,
      name: "Sức khỏe & Healthy Living",
      color: "#F59E0B",
      icon: "heart-pulse",
      description: "Gym, dinh dưỡng, lối sống lành mạnh",
      goldenHours: [
        { start: "05:30", end: "07:00", weight: 0.35 },
        { start: "18:00", end: "20:00", weight: 0.4 }
      ],
      tags: ["#Health", "#Yoga", "#Gym"],
      aiBudgetUsd: 15,
      sortOrder: 3
    }
  ]).run();
  const px = (workspaceId, label, host, port, country, latencyMs, health, kind = "residential") => {
    const id2 = newId();
    db2.insert(proxies).values({ id: id2, workspaceId, label, host, port, country, latencyMs, health, kind, exitIp: host, lastCheckedAt: ago(5 * 6e4) }).run();
    return id2;
  };
  const proxy = {
    vnFpt: px(ws.fashion, "VN-FPT-01", "103.14.129.44", 9080, "VN", 42, "ok"),
    us02: px(ws.fashion, "US-02 Residential", "198.54.110.12", 4430, "US", 482, "warn"),
    sg04: px(ws.fashion, "SG-04", "128.199.70.21", 1080, "SG", 61, "ok", "datacenter"),
    usDallas: px(ws.fashion, "US-Dallas-01", "45.92.17.208", 1080, "US", 188, "ok"),
    usMiami: px(ws.fashion, "US-Miami-02", "45.92.19.77", 1080, "US", 236, "ok"),
    vnHn: px(ws.fashion, "VN-HN-02", "113.160.4.9", 1080, "VN", null, "error", "mobile"),
    vnVnpt: px(ws.fashion, "VN-VNPT-08", "14.177.66.3", 1080, "VN", 55, "ok"),
    vnHcm: px(ws.beauty, "VN-HCM-04", "103.14.130.12", 9080, "VN", 38, "ok"),
    vnViettel: px(ws.beauty, "VN-Viettel-03", "27.72.98.15", 1080, "VN", 47, "ok", "mobile"),
    sgGame: px(ws.game, "SG-GAME-01", "159.89.192.4", 1080, "SG", 72, "ok", "datacenter"),
    vnHealth: px(ws.health, "VN-FPT-07", "103.14.131.90", 9080, "VN", 40, "ok")
  };
  const profile = (workspaceId, name, userAgent) => {
    const id2 = newId();
    db2.insert(browserProfiles).values({ id: id2, workspaceId, name, userAgent, webglVendor: "Google Inc. (NVIDIA)" }).run();
    return id2;
  };
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const prof = {
    fashion: profile(ws.fashion, "Win10 Chrome 126 #9812", ua),
    beauty: profile(ws.beauty, "Win11 Chrome 126 #4410", ua),
    game: profile(ws.game, "Win10 Chrome 125 #7731", ua),
    health: profile(ws.health, "macOS Chrome 126 #2209", ua.replace("Windows NT 10.0; Win64; x64", "Macintosh; Intel Mac OS X 10_15_7"))
  };
  const channelIds2 = [];
  const addAccount = (a, chans) => {
    const accountId = newId();
    db2.insert(accounts).values({ id: accountId, ...a }).run();
    const kind = a.platform === "facebook" ? "fb_page" : a.platform === "tiktok" ? "tiktok_account" : "ig_account";
    const ids = chans.map((c2) => {
      const id2 = newId();
      db2.insert(channels).values({ id: id2, accountId, platform: a.platform, workspaceId: a.workspaceId, kind, ...c2 }).run();
      channelIds2.push({ id: id2, platform: a.platform, followers: c2.followers ?? 0, name: c2.name });
      return id2;
    });
    return { accountId, channelIds: ids };
  };
  const tokenOk = { tokenStatus: "valid", tokenExpiresAt: new Date(now2 + 58 * DAY$7), health: "ok" };
  const old = ago(90 * DAY$7);
  const via1 = addAccount(
    { workspaceId: ws.fashion, platform: "facebook", displayName: "NguyenVanA (VIA Cổ Kháng 902)", externalId: "1000849201", proxyId: proxy.vnFpt, browserProfileId: prof.fashion, twoFactorEnabled: true, sessionStatus: "valid", health: "ok", createdAt: old },
    [
      { name: "Thời Trang Nữ Công Sở", externalId: "fb_page_99182", role: "admin", followers: 128400, nicheTag: "Công sở", ...tokenOk, createdAt: old },
      { name: "Váy Cưới Cao Cấp Luxury", externalId: "fb_page_99183", role: "editor", followers: 54200, nicheTag: "Váy cưới", ...tokenOk, createdAt: old },
      { name: "Đầm Dạ Hội Hà Nội", externalId: "fb_page_99184", role: "admin", followers: 37900, nicheTag: "Đầm dạ hội", ...tokenOk, createdAt: ago(3 * DAY$7) }
    ]
  );
  const via2 = addAccount(
    { workspaceId: ws.fashion, platform: "facebook", displayName: "TranThiB (VIA Ngoại US Nuôi 6 Tháng)", externalId: "1000723145", proxyId: proxy.us02, browserProfileId: prof.fashion, twoFactorEnabled: true, sessionStatus: "expiring", sessionExpiresAt: new Date(now2 - 40 * 6e4), health: "warn", note: "Cư dân US", createdAt: old },
    [
      { name: "Giày Nữ HOT Trend", externalId: "fb_page_88102", role: "admin", followers: 21300, nicheTag: "Giày", tokenStatus: "expired", tokenExpiresAt: ago(2 * HOUR$2), status: "paused", health: "error", createdAt: old },
      { name: "Túi Xách Quảng Châu Cao Cấp", externalId: "fb_page_88103", role: "admin", followers: 44800, nicheTag: "Túi xách", ...tokenOk, createdAt: old }
    ]
  );
  const via3 = addAccount(
    { workspaceId: ws.beauty, platform: "facebook", displayName: "LeHoangNam (VIA XMDT BM50)", externalId: "1000912448", proxyId: proxy.vnHcm, browserProfileId: prof.beauty, twoFactorEnabled: true, sessionStatus: "valid", health: "ok", createdAt: old },
    [
      { name: "Mỹ Phẩm Organic Việt", externalId: "fb_page_77201", role: "admin", followers: 66100, nicheTag: "Organic", ...tokenOk, createdAt: old },
      { name: "Son Kem Lì Store", externalId: "fb_page_77202", role: "admin", followers: 31500, nicheTag: "Son", ...tokenOk, createdAt: ago(5 * DAY$7) }
    ]
  );
  const via4 = addAccount(
    { workspaceId: ws.game, platform: "facebook", displayName: "PhamDucGame (VIA Cổ 2015)", externalId: "1000655310", proxyId: proxy.sgGame, browserProfileId: prof.game, twoFactorEnabled: false, sessionStatus: "valid", health: "ok", createdAt: old },
    [
      { name: "Game Thủ Việt", externalId: "fb_page_66301", role: "admin", followers: 212e3, nicheTag: "Game", ...tokenOk, createdAt: old },
      { name: "Tech Review 247", externalId: "fb_page_66302", role: "editor", followers: 48700, nicheTag: "Công nghệ", ...tokenOk, createdAt: old }
    ]
  );
  const via5 = addAccount(
    { workspaceId: ws.health, platform: "facebook", displayName: "VuThiHoa (VIA Healthy)", externalId: "1000588217", proxyId: proxy.vnHealth, browserProfileId: prof.health, twoFactorEnabled: true, sessionStatus: "valid", health: "ok", createdAt: old },
    [{ name: "Fanpage Sức Khỏe Mỗi Ngày", externalId: "fb_page_55401", role: "admin", followers: 73400, nicheTag: "Gym", ...tokenOk, createdAt: old }]
  );
  const session = (days) => ({ sessionStatus: "valid", sessionExpiresAt: new Date(now2 + days * DAY$7) });
  const tt1 = addAccount(
    { workspaceId: ws.fashion, platform: "tiktok", displayName: "Thời Trang Eva Official", handle: "thoitrangeva", externalId: "tt_70011", proxyId: proxy.usDallas, browserProfileId: prof.fashion, health: "ok", ...session(28), createdAt: old },
    [{ name: "Thời Trang Eva Official", handle: "thoitrangeva", externalId: "tt_70011", followers: 142500, nicheTag: "Công sở", tokenStatus: "valid", health: "ok", createdAt: old }]
  );
  addAccount(
    { workspaceId: ws.fashion, platform: "tiktok", displayName: "Phối Đồ Nàng Thơ", handle: "outfit_congso_giare", externalId: "tt_70012", proxyId: proxy.usMiami, browserProfileId: prof.fashion, health: "warn", note: "1 clip mute âm thanh", ...session(12), createdAt: old },
    [{ name: "Phối Đồ Nàng Thơ", handle: "outfit_congso_giare", externalId: "tt_70012", followers: 45200, nicheTag: "Nữ sinh", tokenStatus: "valid", health: "warn", createdAt: old }]
  );
  const tt3 = addAccount(
    { workspaceId: ws.beauty, platform: "tiktok", displayName: "Mẹo Đẹp Da", handle: "tips_lamdep_moingay", externalId: "tt_70013", proxyId: proxy.vnHcm, browserProfileId: prof.beauty, health: "ok", ...session(21), createdAt: old },
    [{ name: "Mẹo Đẹp Da", handle: "tips_lamdep_moingay", externalId: "tt_70013", followers: 89100, nicheTag: "Skincare", tokenStatus: "valid", health: "ok", createdAt: old }]
  );
  const tt4 = addAccount(
    { workspaceId: ws.fashion, platform: "tiktok", displayName: "Kho Sỉ Đầm Váy Giá Xưởng", handle: "kho_si_damvay", externalId: "tt_70014", proxyId: proxy.vnHn, browserProfileId: prof.fashion, sessionStatus: "expired", sessionExpiresAt: ago(1 * DAY$7), health: "error", note: "Tự động đăng nhập lại thất bại", createdAt: old },
    [{ name: "Kho Sỉ Đầm Váy Giá Xưởng", handle: "kho_si_damvay", externalId: "tt_70014", followers: 22800, nicheTag: "Đầm váy", tokenStatus: "expired", status: "error", health: "error", createdAt: old }]
  );
  const ig1 = addAccount(
    { workspaceId: ws.fashion, platform: "instagram", displayName: "Aura Luxe Fashion", handle: "auraluxe_official", externalId: "ig_481028", proxyId: proxy.sg04, browserProfileId: prof.fashion, health: "ok", ...session(45), createdAt: old },
    [{ name: "Aura Luxe Fashion", handle: "auraluxe_official", externalId: "ig_481028", followers: 38400, nicheTag: "Luxury", tokenStatus: "valid", health: "ok", createdAt: old }]
  );
  addAccount(
    { workspaceId: ws.fashion, platform: "instagram", displayName: "Eva Lookbook Daily", handle: "eva_lookbook_daily", externalId: "ig_481030", proxyId: proxy.vnVnpt, browserProfileId: prof.fashion, health: "ok", ...session(30), createdAt: ago(2 * DAY$7) },
    [{ name: "Eva Lookbook Daily", handle: "eva_lookbook_daily", externalId: "ig_481030", followers: 12600, nicheTag: "Lookbook", tokenStatus: "valid", health: "ok", createdAt: ago(2 * DAY$7) }]
  );
  addAccount(
    { workspaceId: ws.beauty, platform: "instagram", displayName: "Mỹ Phẩm Hữu Cơ", handle: "beauty_organic_vn", externalId: "ig_481029", proxyId: proxy.vnViettel, browserProfileId: prof.beauty, health: "ok", ...session(40), createdAt: old },
    [{ name: "Mỹ Phẩm Hữu Cơ", handle: "beauty_organic_vn", externalId: "ig_481029", followers: 19200, nicheTag: "Organic", tokenStatus: "valid", health: "ok", createdAt: old }]
  );
  const rand = rng(20251001);
  const metricRows = [];
  for (const c2 of channelIds2) {
    const base = c2.followers * (c2.platform === "tiktok" ? 0.35 : c2.platform === "facebook" ? 0.06 : 0.12);
    for (let i = 59; i >= 0; i--) {
      const trend = 1 + (59 - i) / 59 * 0.6;
      const weekend = [0, 6].includes(new Date(now2 - i * DAY$7).getDay()) ? 1.2 : 1;
      const views = Math.round(base * trend * weekend * (0.7 + rand() * 0.6));
      metricRows.push({
        channelId: c2.id,
        day: new Date(now2 - i * DAY$7).toISOString().slice(0, 10),
        views,
        engagements: Math.round(views * (0.05 + rand() * 0.04)),
        followers: Math.round(c2.followers * (0.9 + (59 - i) / 59 * 0.1))
      });
    }
  }
  for (let i = 0; i < metricRows.length; i += 200) db2.insert(channelMetricsDaily).values(metricRows.slice(i, i + 200)).run();
  const content = (v) => {
    const id2 = newId();
    db2.insert(contentItems).values({ id: id2, ...v }).run();
    return id2;
  };
  const c = {
    tips5: content({ workspaceId: ws.fashion, kind: "video", title: "5 mẹo phối đồ công sở hack dáng", caption: "Nàng nấm lùn lưu ngay 5 mẹo này nhé!", hashtags: ["#congso", "#phoido", "#hackdang"], aspect: "9:16", durationSec: 28, status: "scheduled", source: "studio", aiReviewed: true }),
    son: content({ workspaceId: ws.beauty, kind: "carousel", title: "BST Son Kem Lì Kháng Nước Mùa Hè", caption: "4 tông màu hot nhất hè này", hashtags: ["#sonkem", "#makeup"], aspect: "4:5", status: "scheduled", source: "manual" }),
    desk: content({ workspaceId: ws.game, kind: "reel", title: "3 mẹo tự động hóa bàn làm việc", aspect: "9:16", durationSec: 32, status: "published", source: "studio" }),
    gym: content({ workspaceId: ws.health, kind: "carousel", title: "Lịch tập Gym giảm mỡ 7 ngày khoa học cho người mới bắt đầu", aspect: "4:5", status: "ready", source: "manual", aiReviewed: true }),
    tee: content({ workspaceId: ws.fashion, kind: "image", title: "Xả kho áo thun unisex chỉ 79k", caption: "Số lượng có hạn – inbox shop ngay!", aspect: "1:1", status: "published", source: "manual" }),
    aloe: content({ workspaceId: ws.beauty, kind: "video", title: "Hướng dẫn làm trắng da ban đêm bằng nha đam tươi nguyên chất", aspect: "9:16", durationSec: 32, status: "ready", source: "studio" }),
    review: content({ workspaceId: ws.beauty, kind: "text", title: "Review son kem lì không lem khi ăn uống, chống trôi 12h", status: "ready", source: "manual", spinVariants: 24, aiReviewed: true }),
    outfit: content({ workspaceId: ws.fashion, kind: "reel", title: "Top 3 outfit dạo phố cuối tuần cho nàng công sở năng động", aspect: "9:16", durationSec: 24, status: "ready", source: "studio" }),
    flash: content({ workspaceId: ws.fashion, kind: "image", title: "Flash sale cuối tháng – giảm 50% toàn bộ áo khoác", aspect: "1:1", status: "scheduled", source: "manual" }),
    highlight: content({ workspaceId: ws.game, kind: "video", title: "Highlight giải đấu cuối tuần", aspect: "16:9", durationSec: 58, status: "failed", source: "import" }),
    tweed: content({ workspaceId: ws.fashion, kind: "carousel", title: "BST Thu Đông 2024: Áo khoác Tweed Parisian", aspect: "4:5", status: "published", source: "manual" })
  };
  const [fbCongSo, , fbDamDa] = via1.channelIds;
  const [fbGiay] = via2.channelIds;
  const [fbOrganic] = via3.channelIds;
  const [fbGame] = via4.channelIds;
  const [fbHealth] = via5.channelIds;
  const post = (contentItemId, channelId, when, status2, extra = {}) => db2.insert(scheduledPosts).values({ id: newId(), contentItemId, channelId, scheduledAt: when, status: status2, publishedAt: status2 === "published" ? when : null, ...extra }).run();
  post(c.tee, fbCongSo, at(now2, -9, "08:00"), "published", { isGoldenHour: true, externalPostId: "fb_post_1" });
  post(c.tweed, fbCongSo, at(now2, -4, "19:00"), "published", { isGoldenHour: true, externalPostId: "fb_post_2" });
  post(c.desk, fbGame, at(now2, -3, "21:30"), "published", { isGoldenHour: true, externalPostId: "fb_post_3" });
  post(c.tweed, ig1.channelIds[0], at(now2, -2, "14:00"), "published", { externalPostId: "ig_post_1" });
  post(c.highlight, fbGame, at(now2, -1, "21:00"), "failed", { attempts: 3, error: "Lỗi Proxy – kết nối bị từ chối (thử lại)" });
  post(c.tips5, tt1.channelIds[0], at(now2, 0, "11:30"), "queued", { isGoldenHour: true });
  post(c.flash, fbGiay, at(now2, 1, "19:45"), "queued");
  post(c.son, fbOrganic, at(now2, 2, "20:30"), "queued", { isGoldenHour: true });
  post(c.son, tt3.channelIds[0], at(now2, 3, "12:00"), "queued", { isGoldenHour: true });
  post(c.tips5, fbDamDa, at(now2, 5, "19:00"), "queued", { isGoldenHour: true });
  post(c.flash, fbCongSo, at(now2, 8, "08:30"), "queued");
  post(c.gym, fbHealth, at(now2, 10, "06:00"), "queued", { isGoldenHour: true });
  const convo = (v, msgs) => {
    const id2 = newId();
    const last = msgs[msgs.length - 1];
    db2.insert(conversations).values({ id: id2, ...v, lastMessageAt: ago(last.minutesAgo * 6e4), lastMessagePreview: msgs.filter((m) => m.direction === "in").at(-1)?.body ?? last.body }).run();
    db2.insert(messages).values(
      msgs.map((m) => ({
        id: newId(),
        conversationId: id2,
        direction: m.direction,
        author: m.author,
        body: m.body,
        deliveryStatus: m.direction === "out" ? "sent" : null,
        createdAt: ago(m.minutesAgo * 6e4)
      }))
    ).run();
  };
  convo(
    { workspaceId: ws.fashion, channelId: fbCongSo, platform: "facebook", source: "comment", customerName: "Minh Thảo", customerExternalId: "CUS-88492", contextPostTitle: "BST Thu Đông 2024: Áo khoác Tweed Parisian", tags: ["Hỏi giá", "VIP Khách cũ"], unreadCount: 1 },
    [
      { direction: "in", author: "customer", body: "Set dạ tweed màu be còn size M không shop? Có giao Hỏa tốc trong chiều nay qua Landmark 81 được không ạ? Mình cần gấp tối nay đi tiệc.", minutesAgo: 3 },
      { direction: "out", author: "bot", body: "Dạ chào chị Minh Thảo! Set dạ Tweed Parisian hiện shop vẫn còn sẵn 02 bộ size M tại kho trung tâm ạ. Shop đã nhắn tin riêng để hỗ trợ điều phối shipper giao gấp cho chị nhé!", minutesAgo: 2 }
    ]
  );
  convo(
    { workspaceId: ws.fashion, channelId: tt1.channelIds[0], platform: "tiktok", source: "direct", customerName: "Hoàng Long Auto", tags: ["Tích cực", "TikTok Ads"], unreadCount: 1 },
    [{ direction: "in", author: "customer", body: "Chất vải dày dặn đúng chuẩn clip review, tư vấn mình size L cho nam cao 1m75 nhé", minutesAgo: 4 }]
  );
  convo(
    { workspaceId: ws.fashion, channelId: ig1.channelIds[0], platform: "instagram", source: "direct", customerName: "Thanh Mai Vũ", tags: ["Tư vấn size"], status: "pending", unreadCount: 0 },
    [{ direction: "in", author: "customer", body: "Cao 1m62 nặng 54kg thì vừa mẫu nào shop ơi? Váy xếp ly phối với áo blazer được không?", minutesAgo: 18 }]
  );
  convo(
    { workspaceId: ws.fashion, channelId: fbCongSo, platform: "facebook", source: "comment", customerName: "Đức Cường Trần", contextPostTitle: "Xả kho áo thun unisex chỉ 79k", tags: ["Khiếu nại"], unreadCount: 1 },
    [{ direction: "in", author: "customer", body: "Shipper gọi mà không giao kịp giờ hẹn trước 12h như lúc chốt đơn. Shop xử lý giúp mình với.", minutesAgo: 35 }]
  );
  convo(
    { workspaceId: ws.beauty, channelId: fbOrganic, platform: "facebook", source: "messenger", customerName: "Lan Phương", tags: ["Hỏi giá"], unreadCount: 2 },
    [
      { direction: "in", author: "customer", body: "Serum nha đam dùng cho da dầu mụn được không shop?", minutesAgo: 65 },
      { direction: "in", author: "customer", body: "Giá combo 2 chai bao nhiêu ạ?", minutesAgo: 64 }
    ]
  );
  db2.insert(quickReplies).values([
    { id: newId(), workspaceId: ws.fashion, shortcut: "/size", title: "Bảng size chuẩn", body: "Dạ chị tham khảo bảng size: S (45-50kg), M (50-55kg), L (55-60kg), XL (60-66kg) ạ." },
    { id: newId(), workspaceId: null, shortcut: "/ship", title: "Phí ship Hỏa tốc", body: "Dạ nội thành giao Hỏa tốc 1-2h, phí 25-35k tùy khoảng cách ạ." },
    { id: newId(), workspaceId: null, shortcut: "/doitra", title: "Chính sách đổi trả", body: "Shop hỗ trợ đổi size/mẫu trong 7 ngày, sản phẩm còn tem mác và chưa qua sử dụng ạ." }
  ]).run();
  db2.insert(autoReplyRules).values([
    { id: newId(), workspaceId: ws.fashion, name: "Hỏi giá → nhắn tin riêng", keywords: ["giá", "bao nhiêu", "ib", "size", "còn không"], action: "send_dm", template: "Dạ shop đã nhắn tin riêng báo giá và ưu đãi cho {name} rồi ạ!", minDelaySec: 15, maxDelaySec: 35 },
    { id: newId(), workspaceId: ws.fashion, name: "Ẩn bình luận chứa số điện thoại", keywords: ["{phone}"], action: "hide_comment", minDelaySec: 0, maxDelaySec: 1 }
  ]).run();
  db2.insert(alerts).values([
    { id: newId(), severity: "error", kind: "cookie_expired", entityType: "account", entityId: via2.accountId, title: "Nick VIA: TranThiB", message: "Phiên đăng nhập Facebook hết hạn 40 phút trước. Cần làm mới cookie hoặc đăng nhập lại.", createdAt: ago(40 * 6e4) },
    { id: newId(), severity: "warn", kind: "proxy_latency", entityType: "proxy", entityId: proxy.us02, title: "Proxy US-02 Residential", message: "Độ trễ 482ms (>450ms), có rủi ro nghẽn khi đăng tải Reels dung lượng lớn.", createdAt: ago(25 * 6e4) },
    { id: newId(), severity: "error", kind: "token_invalid", entityType: "channel", entityId: fbGiay, title: "Page: Giày Nữ HOT Trend", message: "Token Page mất quyền (hết hạn 2 giờ trước). Lịch đăng 3 bài bị hoãn.", createdAt: ago(2 * HOUR$2) },
    { id: newId(), severity: "error", kind: "checkpoint", entityType: "account", entityId: tt4.accountId, title: "TikTok: @kho_si_damvay", message: "Hết hạn phiên, tự động đăng nhập lại thất bại. Cần đăng nhập thủ công.", createdAt: ago(1 * DAY$7) }
  ]).run();
  db2.insert(activityLog).values([
    { level: "info", scope: "auto-reply", message: "Tự động trả lời 42 bình luận", createdAt: ago(1 * DAY$7) },
    { level: "warn", scope: "proxy", message: "Proxy US-02 Residential: độ trễ 482ms", createdAt: ago(25 * 6e4) },
    { level: "ok", scope: "token", message: "Kiểm tra Token Graph API: 8/9 hợp lệ", createdAt: ago(9 * HOUR$2) },
    { level: "ok", scope: "publish", message: 'Đăng bài tự động lên Page "Thời Trang Nữ Công Sở"', createdAt: ago(4 * HOUR$2) }
  ]).run();
  db2.insert(aiProviders).values([
    { id: newId(), provider: "openai", category: "text", label: "OpenAI GPT-4o", defaultModel: "gpt-4o", priority: 1 },
    { id: newId(), provider: "gemini", category: "text", label: "Gemini Flash", defaultModel: "gemini-2.5-flash", priority: 2 },
    { id: newId(), provider: "deepseek", category: "text", label: "DeepSeek V3 / R1", defaultModel: "deepseek-chat", priority: 0 },
    { id: newId(), provider: "anthropic", category: "text", label: "Claude", defaultModel: "claude-opus-5-5", priority: 3 },
    { id: newId(), provider: "elevenlabs", category: "tts", label: "ElevenLabs", defaultModel: "eleven_multilingual_v2", priority: 0 },
    { id: newId(), provider: "openai_tts", category: "tts", label: "OpenAI Audio", defaultModel: "gpt-4o-mini-tts", priority: 1 },
    { id: newId(), provider: "edge_tts", category: "tts", label: "Edge-TTS (Miễn phí)", defaultModel: "vi-VN-HoaiMyNeural", priority: 2, status: "valid" },
    { id: newId(), provider: "fal", category: "media", label: "Fal.ai (Flux)", defaultModel: "fal-ai/flux/schnell", priority: 0 },
    { id: newId(), provider: "replicate", category: "media", label: "Replicate", priority: 1 },
    { id: newId(), provider: "pexels", category: "media", label: "Pexels Stock", priority: 2 }
  ]).run();
  const providerId = (name) => db2.select({ id: aiProviders.id }).from(aiProviders).where(drizzleOrm.eq(aiProviders.provider, name)).get()?.id;
  const monthStart2 = new Date(new Date(now2).getFullYear(), new Date(now2).getMonth(), 1).getTime();
  const usageRows = [];
  const usage = (workspaceId, provider, model, feature, costUsd, n) => {
    const pid = providerId(provider);
    for (let i = 0; i < n; i++) {
      usageRows.push({
        id: newId(),
        providerId: pid,
        workspaceId,
        model,
        feature,
        inputTokens: provider === "elevenlabs" ? 0 : 1800,
        outputTokens: provider === "elevenlabs" ? 0 : 650,
        characters: provider === "elevenlabs" ? 900 : 0,
        costUsd: Math.round(costUsd / n * 1e4) / 1e4,
        createdAt: new Date(Math.min(now2, monthStart2 + rand() * Math.max(1, now2 - monthStart2)))
      });
    }
  };
  usage(ws.fashion, "deepseek", "deepseek-chat", "script", 3.1, 18);
  usage(ws.fashion, "elevenlabs", "eleven_multilingual_v2", "tts", 2.4, 6);
  usage(ws.beauty, "openai", "gpt-4o", "caption", 1.2, 5);
  usage(ws.game, "deepseek", "deepseek-chat", "script", 0.6, 4);
  if (usageRows.length) db2.insert(aiUsage).values(usageRows).run();
  const projectId = newId();
  db2.insert(videoProjects).values({ id: projectId, workspaceId: ws.fashion, contentItemId: c.tips5, targetChannelId: tt1.channelIds[0], topic: "5 mẹo phối đồ công sở mùa đông hack dáng cao thêm 5cm cho nàng nấm lùn", targetDurationSec: 30, ttsProvider: "elevenlabs", voiceId: "Ngọc Mai", renderMode: "stock", bgmTrack: "Chill Lofi #12", status: "scripted" }).run();
  db2.insert(videoScenes).values([
    { id: newId(), projectId, position: 0, label: "Hook Giật gân", voiceover: "Đừng mặc áo khoác dạ nếu nàng cao dưới 1m55 mà chưa biết mẹo này!", durationSec: 4, mediaPrompt: "woman coat street hanoi autumn", mediaSource: "stock" },
    { id: newId(), projectId, position: 1, label: "Mẹo #1 · Tỷ lệ 1/3", voiceover: "Quy tắc vàng: Chiều dài áo chỉ qua gối 5cm, kết hợp cùng boots cao cổ cùng tông màu để tạo hiệu ứng kéo dài chân.", durationSec: 8, mediaPrompt: "knee-length coat office woman", mediaSource: "stock" },
    { id: newId(), projectId, position: 2, label: "Mẹo #2 · Thắt eo cao", voiceover: "Tuyệt đối chọn áo có đai thắt cao hơn rốn 3cm. Điểm thắt này sẽ tái định vị vòng eo, ăn gian tỉ lệ cơ thể.", durationSec: 8, mediaPrompt: "high waist belt coat", mediaSource: "stock" },
    { id: newId(), projectId, position: 3, label: "CTA Chốt đơn", voiceover: "Lưu ngay video này và ghé shop để chọn mẫu áo khoác hack dáng nhé!", durationSec: 8, mediaPrompt: "fashion store coats rack", mediaSource: "stock" }
  ]).run();
  db2.insert(settings).values([
    { key: "budget.monthlyHardCapUsd", value: 50 },
    { key: "ai.fallbackOnError", value: true },
    { key: SEED_KEY, value: { at: now2 } }
  ]).run();
}
const CLOUD_URL = (process.env.OMNI_CLOUD_URL ?? "https://api.omnira.io.vn").replace(/\/+$/, "");
class CloudError extends Error {
  constructor(code, message, status2) {
    super(message);
    this.code = code;
    this.status = status2;
  }
  get offline() {
    return this.code === "OFFLINE";
  }
}
async function cloud(path, init = {}) {
  let res;
  try {
    res = await fetch(CLOUD_URL + path, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...init.body !== void 0 ? { "Content-Type": "application/json" } : {},
        ...init.token ? { Authorization: `Bearer ${init.token}` } : {}
      },
      body: init.body === void 0 ? void 0 : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 2e4)
    });
  } catch (err) {
    throw new CloudError("OFFLINE", `Không kết nối được Omnira Cloud (${err instanceof Error ? err.message : String(err)}) – kiểm tra mạng`, 0);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
  }
  if (!res.ok) {
    const e = data ?? {};
    if (res.status >= 500 && !e.code) throw new CloudError("OFFLINE", `Omnira Cloud đang lỗi (HTTP ${res.status}) – thử lại sau`, res.status);
    throw new CloudError(e.code ?? `HTTP_${res.status}`, e.message ?? `Omnira Cloud báo lỗi HTTP ${res.status}`, res.status);
  }
  return data;
}
const deviceFile = () => node_path.join(authRoot(), "device.json");
const sessionFile$1 = (localUserId) => node_path.join(authRoot(), `cloud-${localUserId}.bin`);
function deviceId() {
  try {
    const d = JSON.parse(node_fs.readFileSync(deviceFile(), "utf8"));
    if (d.id && /^[A-Za-z0-9_-]{16,128}$/.test(d.id)) return d.id;
  } catch {
  }
  const id2 = `omn-${node_crypto.randomBytes(20).toString("hex")}`;
  node_fs.mkdirSync(authRoot(), { recursive: true });
  node_fs.writeFileSync(deviceFile(), JSON.stringify({ id: id2, createdAt: Date.now() }), { mode: 384 });
  return id2;
}
function readCloudSession(localUserId) {
  const f = sessionFile$1(localUserId);
  if (!node_fs.existsSync(f) || !electron.safeStorage.isEncryptionAvailable()) return null;
  try {
    return JSON.parse(electron.safeStorage.decryptString(node_fs.readFileSync(f)));
  } catch {
    return null;
  }
}
function writeCloudSession(localUserId, s) {
  if (!electron.safeStorage.isEncryptionAvailable()) return;
  node_fs.mkdirSync(authRoot(), { recursive: true });
  const f = sessionFile$1(localUserId);
  node_fs.writeFileSync(f + ".tmp", electron.safeStorage.encryptString(JSON.stringify({ ...s, updatedAt: Date.now() })), { mode: 384 });
  node_fs.renameSync(f + ".tmp", f);
}
function patchCloudSession(localUserId, patch) {
  const cur = readCloudSession(localUserId);
  if (cur) writeCloudSession(localUserId, { ...cur, ...patch });
}
function clearCloudSession(localUserId) {
  node_fs.rmSync(sessionFile$1(localUserId), { force: true });
}
const MANAGED_PROVIDERS = /* @__PURE__ */ new Set(["pexels", "pixabay"]);
let cache$1 = null;
let current$1 = () => ({ userId: null, token: null });
function bindCloudSession(fn) {
  current$1 = fn;
}
function managedKey(provider) {
  if (!MANAGED_PROVIDERS.has(provider)) return null;
  const { userId } = current$1();
  if (!userId) return null;
  if (cache$1?.userId !== userId) cache$1 = { userId, keys: readCloudSession(userId)?.managedKeys ?? {} };
  return cache$1.keys[provider] || null;
}
async function syncAppConfig() {
  const { userId, token: token2 } = current$1();
  if (!userId || !token2) return;
  try {
    const r = await cloud("/api/client/v1/app-config", { token: token2, timeoutMs: 15e3 });
    const keys = r.stockKeys ?? {};
    patchCloudSession(userId, { managedKeys: keys });
    cache$1 = { userId, keys };
  } catch (e) {
    console.warn("[cloud] chưa lấy được cấu hình dùng chung", e instanceof Error ? e.message : e);
  }
}
const PROVIDERS = {
  // ── Văn bản ──
  openai: {
    label: "OpenAI GPT-4o",
    category: "text",
    tagline: "GPT-4o & GPT-4o-mini",
    keyPlaceholder: "sk-proj-…",
    priority: 1,
    models: [
      { id: "gpt-4o", label: "gpt-4o (Chất lượng)" },
      { id: "gpt-4o-mini", label: "gpt-4o-mini (Tiết kiệm)" }
    ]
  },
  gemini: {
    label: "Gemini Flash",
    category: "text",
    tagline: "Gemini Flash (key dùng chung cho Nano Banana, Veo, Lyria)",
    keyPlaceholder: "AIza…",
    priority: 2,
    models: [
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }
    ]
  },
  deepseek: {
    label: "DeepSeek V3 / R1",
    category: "text",
    tagline: "DeepSeek V3 / R1 (Reasoning)",
    keyPlaceholder: "sk-…",
    priority: 0,
    models: [
      { id: "deepseek-chat", label: "deepseek-v3 (chat)" },
      { id: "deepseek-reasoner", label: "deepseek-r1 (reasoner)" }
    ]
  },
  anthropic: {
    label: "Claude",
    category: "text",
    tagline: "Claude Opus / Sonnet / Haiku",
    keyPlaceholder: "sk-ant-…",
    priority: 3,
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
    ]
  },
  // ── Giọng đọc ──
  elevenlabs: {
    label: "ElevenLabs",
    category: "tts",
    tagline: "Giọng đọc đa ngôn ngữ chất lượng cao",
    keyPlaceholder: "xi-…",
    priority: 0,
    models: [
      { id: "eleven_multilingual_v2", label: "Multilingual v2" },
      { id: "eleven_turbo_v2_5", label: "Turbo v2.5" }
    ]
  },
  openai_tts: {
    label: "OpenAI Audio",
    category: "tts",
    tagline: "Dùng chung API key OpenAI",
    keyFrom: "openai",
    priority: 1,
    models: [
      { id: "gpt-4o-mini-tts", label: "gpt-4o-mini-tts" },
      { id: "tts-1-hd", label: "tts-1-hd" }
    ]
  },
  google_tts: {
    label: "Google Gemini TTS",
    category: "tts",
    tagline: "Giọng đọc AI của Google, đọc tốt tiếng Việt – dùng chung key Gemini",
    keyFrom: "gemini",
    priority: 1,
    models: [
      { id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS" },
      { id: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro TTS (hay hơn, đắt hơn)" }
    ]
  },
  edge_tts: {
    label: "Edge-TTS (Miễn phí)",
    category: "tts",
    tagline: "Miễn phí – không cần API key",
    keyless: true,
    priority: 2,
    models: [
      { id: "vi-VN-HoaiMyNeural", label: "HoaiMy (Nữ)" },
      { id: "vi-VN-NamMinhNeural", label: "NamMinh (Nam)" }
    ]
  },
  local_tts: {
    label: "VieNeu-TTS (Local)",
    category: "tts",
    tagline: "Chạy trên máy bạn – miễn phí, clone giọng; GPU NVIDIA (nhanh) hoặc CPU; cài engine ở Cài đặt",
    keyless: true,
    priority: 3,
    models: [{ id: "vieneu-v3-turbo", label: "VieNeu v3 Turbo" }]
  },
  // ── Hình ảnh / video ──
  google_image: {
    label: "Google Gemini – Ảnh AI",
    category: "media",
    tagline: "Model tạo ảnh Nano Banana của Gemini – dùng chung key Gemini, không cần key riêng (key cần bật billing: gói Free không được tạo ảnh qua API)",
    keyFrom: "gemini",
    priority: 0,
    models: [
      { id: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image" },
      { id: "gemini-3.1-flash-lite-image", label: "Gemini 3.1 Flash-Lite Image (rẻ)" },
      { id: "gemini-3-pro-image", label: "Gemini 3 Pro Image" }
    ]
  },
  fal: {
    label: "Fal.ai (Flux)",
    category: "media",
    tagline: "Flux Schnell / Dev – ảnh AI",
    keyPlaceholder: "fal-…",
    priority: 1,
    models: [
      { id: "fal-ai/flux/schnell", label: "Flux Schnell" },
      { id: "fal-ai/flux/dev", label: "Flux Dev" }
    ]
  },
  google_veo: {
    label: "Google Veo 3.1",
    category: "media",
    tagline: "Video AI (thay VideoFX) cho chế độ Full AI – dùng key Gemini",
    keyFrom: "gemini",
    priority: 2,
    models: [
      { id: "veo-3.1-lite-generate-preview", label: "Veo 3.1 Lite (rẻ nhất)" },
      { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast" },
      { id: "veo-3.1-generate-preview", label: "Veo 3.1 Standard" }
    ]
  },
  seedance: {
    label: "ByteDance Seedance 2.0 (qua fal)",
    category: "media",
    tagline: "Video AI cho Xưởng Phim – nhiều ảnh tham chiếu, khung đầu/cuối, có âm thanh; dùng chung key Fal.ai",
    keyFrom: "fal",
    priority: 3,
    models: [
      { id: "bytedance/seedance-2.0/fast/reference-to-video", label: "Seedance 2.0 Fast (rẻ hơn)" },
      { id: "bytedance/seedance-2.0/reference-to-video", label: "Seedance 2.0 (chất lượng cao)" }
    ]
  },
  pexels: {
    label: "Pexels Stock",
    category: "media",
    tagline: "B-roll video stock miễn phí",
    keyPlaceholder: "Pexels API key",
    priority: 3,
    models: [{ id: "videos", label: "Video search" }]
  },
  pixabay: {
    label: "Pixabay Stock",
    category: "media",
    tagline: "Video & ảnh stock miễn phí (key miễn phí)",
    keyPlaceholder: "Pixabay API key",
    priority: 4,
    models: [{ id: "videos", label: "Video search" }]
  },
  replicate: {
    label: "Replicate",
    category: "media",
    tagline: "Kling AI & Hunyuan Video (chưa dùng trong render)",
    keyPlaceholder: "r8_…",
    priority: 5,
    models: [
      { id: "kwaivgi/kling-v1.6-standard", label: "Kling v1.6" },
      { id: "tencent/hunyuan-video", label: "Hunyuan Video" }
    ]
  },
  // ── Nhạc nền AI (tùy chọn) ──
  google_lyria: {
    label: "Google Lyria",
    category: "music",
    tagline: "Nhạc AI của Google (thay MusicFX) – dùng key Gemini",
    keyFrom: "gemini",
    priority: 0,
    models: [
      { id: "lyria-3-clip-preview", label: "Lyria 3 Clip (30 giây)" },
      { id: "lyria-3.5", label: "Lyria 3.5 (cả bài)" }
    ]
  },
  elevenlabs_music: {
    label: "ElevenLabs Music",
    category: "music",
    tagline: "Nhạc AI có quyền thương mại – dùng key ElevenLabs",
    keyFrom: "elevenlabs",
    priority: 1,
    models: [
      { id: "music_v2_5", label: "Music v2.5" },
      { id: "music_v2", label: "Music v2" }
    ]
  }
};
function isUsableModel(provider, id2) {
  switch (provider) {
    case "openai":
      return /^(gpt-|o\d|chatgpt-)/.test(id2) && !/(audio|realtime|transcribe|tts|image|search|embedding|moderation)/.test(id2);
    case "gemini":
      return /^gemini-/.test(id2) && !/(embedding|tts|image|live|native-audio)/.test(id2);
    case "google_image":
      return /^gemini-.*image/.test(id2);
    case "google_tts":
      return /^gemini-.*tts/.test(id2);
    case "google_veo":
      return /^veo-/.test(id2);
    case "google_lyria":
      return /^lyria-/.test(id2);
    default:
      return true;
  }
}
function preferredModel(provider, available) {
  if (!available.length) return null;
  if (provider === "gemini") {
    const stable = available.map((id2) => ({ id: id2, v: id2.match(/^gemini-(\d+(?:\.\d+)?)-flash$/)?.[1] })).filter((x) => x.v != null).sort((a, b) => Number(b.v) - Number(a.v));
    if (stable[0]) return stable[0].id;
  }
  const known = PROVIDERS[provider]?.models.map((m) => m.id) ?? [];
  return known.find((k) => available.includes(k)) ?? available[0];
}
const providerInfo = (provider) => PROVIDERS[provider] ?? { label: provider, category: "media", tagline: "", models: [], keyPlaceholder: "API key" };
class AiError extends Error {
  constructor(kind, message, status2) {
    super(message);
    this.kind = kind;
    this.status = status2;
  }
  /** Lỗi tạm thời hoặc do nhà cung cấp → thử provider kế tiếp trong chuỗi */
  get retryable() {
    return ["rate_limit", "overloaded", "timeout", "network", "bad_request", "auth", "refusal", "invalid_output", "unknown"].includes(this.kind);
  }
}
function providerRow(provider) {
  return getDb().select().from(aiProviders).where(drizzleOrm.eq(aiProviders.provider, provider)).get();
}
function keyOwner(row) {
  const from = providerInfo(row.provider).keyFrom;
  if (!from || readSecret("ai_provider", row.id, "api_key") != null) return row;
  return providerRow(from) ?? row;
}
function resolveKey(row) {
  const managed = managedKey(row.provider);
  if (managed) return { key: managed, baseUrl: row.baseUrl ?? null, owner: row };
  const owner = keyOwner(row);
  const key2 = readSecret("ai_provider", owner.id, "api_key");
  const from = providerInfo(row.provider).keyFrom;
  return key2 ? { key: key2, baseUrl: row.baseUrl ?? (from ? providerRow(from)?.baseUrl ?? null : null), owner } : null;
}
function requireKey(provider) {
  const row = providerRow(provider);
  if (!row) throw new AiError("no_provider", `Chưa có nhà cung cấp ${provider}`);
  if (MANAGED_PROVIDERS.has(provider)) {
    const k2 = resolveKey(row);
    if (!k2) throw new AiError("no_provider", "Kho video miễn phí chưa sẵn sàng – kiểm tra kết nối mạng / gói Omnira");
    return { key: k2.key, baseUrl: k2.baseUrl, row };
  }
  if (!row.enabled) throw new AiError("no_provider", `${row.label} đang tắt trong Cài đặt`);
  const k = resolveKey(row);
  if (!k) {
    const owner = keyOwner(row);
    throw new AiError(
      "no_provider",
      `${owner.id !== row.id ? `${row.label} dùng key ${owner.label}, nhưng ${owner.label}` : row.label} chưa có API key – nhập ở Cài đặt & Khóa API`
    );
  }
  return { key: k.key, baseUrl: k.baseUrl, row };
}
function isReady(provider) {
  const row = providerRow(provider);
  if (row && MANAGED_PROVIDERS.has(provider)) return resolveKey(row) != null;
  if (!row || !row.enabled) return false;
  return providerInfo(provider).keyless === true || resolveKey(row) != null;
}
function ensureProviders() {
  const db2 = getDb();
  const existing = new Set(
    db2.select({ provider: aiProviders.provider }).from(aiProviders).all().map((r) => r.provider)
  );
  const renamed = { google_image: ["Google Nano Banana"], local_tts: ["VieNeu-TTS (Local · GPU)"] };
  for (const [provider, oldLabels] of Object.entries(renamed)) {
    const label = PROVIDERS[provider]?.label;
    if (label)
      for (const old of oldLabels)
        db2.update(aiProviders).set({ label }).where(drizzleOrm.and(drizzleOrm.eq(aiProviders.provider, provider), drizzleOrm.eq(aiProviders.label, old))).run();
  }
  for (const [provider, info] of Object.entries(PROVIDERS)) {
    if (existing.has(provider)) continue;
    db2.insert(aiProviders).values({
      id: newId(),
      provider,
      category: info.category,
      label: info.label,
      defaultModel: info.models[0]?.id ?? null,
      priority: info.priority ?? 9,
      status: info.keyless ? "valid" : "untested"
    }).run();
  }
}
function mediaDir() {
  const dir = node_path.join(userDir(), "media");
  node_fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function dirSize$2(dir) {
  let total2 = 0;
  for (const entry of node_fs.readdirSync(dir, { withFileTypes: true })) {
    const p = node_path.join(dir, entry.name);
    if (entry.isDirectory()) total2 += dirSize$2(p);
    else if (entry.isFile()) total2 += node_fs.statSync(p).size;
  }
  return total2;
}
function storageInfo() {
  const dir = mediaDir();
  let diskFreeBytes = null;
  let diskTotalBytes = null;
  try {
    const fs = node_fs.statfsSync(dir);
    diskFreeBytes = fs.bavail * fs.bsize;
    diskTotalBytes = fs.blocks * fs.bsize;
  } catch {
  }
  return { mediaDir: dir, usedBytes: dirSize$2(dir), diskFreeBytes, diskTotalBytes };
}
const unpacked = (p) => p.replace(`app.asar${process.platform === "win32" ? "\\" : "/"}`, `app.asar.unpacked${process.platform === "win32" ? "\\" : "/"}`);
function ffmpegPath() {
  const custom = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "media.ffmpegPath")).get()?.value;
  if (typeof custom === "string" && custom && node_fs.existsSync(custom)) return custom;
  if (!ffmpegStatic) throw new Error("Không tìm thấy FFmpeg cho hệ điều hành này");
  return unpacked(ffmpegStatic);
}
function ffprobePath() {
  return unpacked(ffprobeStatic.path);
}
function fontsDir() {
  return electron.app.isPackaged ? node_path.join(process.resourcesPath, "fonts") : node_path.join(__dirname, "../../resources/fonts");
}
class FfmpegError extends Error {
  constructor(message, stderrTail) {
    super(message);
    this.stderrTail = stderrTail;
  }
}
function runFfmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const full = ["-hide_banner", "-nostdin", "-y", ...opts.onProgress ? ["-progress", "pipe:1", "-nostats"] : [], ...args];
    const child = node_child_process.spawn(ffmpegPath(), full, { cwd: opts.cwd, windowsHide: true });
    let stderr = "";
    let buf = "";
    const onAbort = () => {
      child.kill("SIGKILL");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d) => {
      if (!opts.onProgress || !opts.totalSec) return;
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/);
        if (m) opts.onProgress(Math.min(1, Number(m[1]) / 1e6 / opts.totalSec));
      }
    });
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-8e3);
    });
    child.on("error", (err) => reject(new FfmpegError(`Không chạy được FFmpeg: ${err.message}`, stderr)));
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new FfmpegError("Đã hủy", stderr));
      if (code === 0) return resolve();
      const tail = stderr.trim().split(/\r?\n/).slice(-6).join("\n");
      reject(new FfmpegError(`FFmpeg lỗi (mã ${code}): ${tail.split("\n").pop() ?? ""}`, tail));
    });
  });
}
function ffmpegOutput(args) {
  return new Promise((resolve) => {
    const child = node_child_process.spawn(ffmpegPath(), ["-hide_banner", ...args], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => out += d.toString());
    child.stderr.on("data", (d) => out += d.toString());
    child.on("error", (err) => resolve({ code: -1, out: err.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}
async function hasAudioStream(file2) {
  const r = await ffmpegOutput(["-i", file2]);
  return /Stream #\d+:\d+[^\n]*Audio:/.test(r.out);
}
function probeDuration(file2) {
  return new Promise((resolve, reject) => {
    const child = node_child_process.spawn(ffprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file2], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => out += d.toString());
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      const v = Number(out.trim());
      if (code === 0 && Number.isFinite(v)) resolve(v);
      else reject(new Error(`Không đọc được thời lượng: ${file2}`));
    });
  });
}
const ORDER = ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"];
const CACHE_KEY = "media.encoders";
const PREF_KEY = "media.preferredEncoder";
const encoderLabel = {
  h264_nvenc: "NVIDIA NVENC",
  h264_amf: "AMD AMF",
  h264_qsv: "Intel QuickSync",
  libx264: "CPU libx264"
};
function getSetting$3(key2) {
  return getDb().select().from(settings).where(drizzleOrm.eq(settings.key, key2)).get()?.value;
}
function setSetting$2(key2, value) {
  getDb().insert(settings).values({ key: key2, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: /* @__PURE__ */ new Date() } }).run();
}
async function detectEncoders() {
  const version2 = (await ffmpegOutput(["-version"])).out.split(/\r?\n/)[0] ?? "";
  const listed = (await ffmpegOutput(["-encoders"])).out;
  const tested = [];
  for (const enc of ORDER) {
    if (!new RegExp(`\\b${enc}\\b`).test(listed)) {
      tested.push({ encoder: enc, ok: false, error: "Bản FFmpeg không có encoder này" });
      continue;
    }
    try {
      await runFfmpeg(["-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x256:r=30:d=0.2", "-c:v", enc, "-f", "null", "-"]);
      tested.push({ encoder: enc, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tested.push({ encoder: enc, ok: false, error: msg.length > 160 ? `${msg.slice(0, 160)}…` : msg });
    }
  }
  const info = { version: version2, tested, detectedAt: Date.now(), chosen: "libx264", preferred: getSetting$3(PREF_KEY) ?? "auto" };
  info.chosen = pick(info);
  setSetting$2(CACHE_KEY, { version: version2, tested, detectedAt: info.detectedAt });
  return info;
}
function pick(info) {
  const ok = (e) => info.tested.some((t2) => t2.encoder === e && t2.ok);
  if (info.preferred !== "auto" && ok(info.preferred)) return info.preferred;
  return ORDER.find(ok) ?? "libx264";
}
function cachedEncoders() {
  const c = getSetting$3(CACHE_KEY);
  if (!c) return null;
  const info = { ...c, preferred: getSetting$3(PREF_KEY) ?? "auto", chosen: "libx264" };
  info.chosen = pick(info);
  return info;
}
function setPreferredEncoder(enc) {
  setSetting$2(PREF_KEY, enc);
}
async function currentEncoder() {
  return (cachedEncoders() ?? await detectEncoders()).chosen;
}
function encoderArgs(enc) {
  switch (enc) {
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "23", "-b:v", "8M", "-maxrate", "12M", "-bufsize", "16M"];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", "balanced", "-rc", "vbr_peak", "-b:v", "8M", "-maxrate", "12M"];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", "23", "-maxrate", "12M"];
    default:
      return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-maxrate", "12M", "-bufsize", "16M"];
  }
}
const DEFAULT_PRICING = {
  // Anthropic
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // DeepSeek (V3.2 – chat & reasoner cùng giá)
  "deepseek-chat": { input: 0.28, output: 0.42 },
  "deepseek-reasoner": { input: 0.28, output: 0.42 },
  // Google (Gemini 3.x: giá niêm yết tra cứu 10/2026)
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.8-flash": { input: 0.375, output: 1.88 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 }
};
function priceFor(model, overrides = {}) {
  return overrides[model] ?? DEFAULT_PRICING[model] ?? null;
}
function estimateCostUsd(model, inputTokens, outputTokens, overrides) {
  const p = priceFor(model, overrides);
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1e6;
}
const UNIT_PRICES = {
  "tts-1": { per: "char", usd: 15 / 1e6, note: "$15 / 1M ký tự" },
  "tts-1-hd": { per: "char", usd: 30 / 1e6, note: "$30 / 1M ký tự" },
  "gpt-4o-mini-tts": { per: "char", usd: 15 / 1e6, note: "≈ $15 / 1M ký tự (ước tính)" },
  // Gemini TTS tính theo token audio đầu ra (~$10/1M token Flash, ~$20/1M Pro) → quy đổi thô theo ký tự
  "gemini-2.5-flash-preview-tts": { per: "char", usd: 20 / 1e6, note: "≈ $20 / 1M ký tự (ước tính)" },
  "gemini-2.5-pro-preview-tts": { per: "char", usd: 40 / 1e6, note: "≈ $40 / 1M ký tự (ước tính)" },
  "fal-ai/flux/schnell": { per: "image", usd: 3e-3, note: "≈ $0.003 / ảnh (ước tính)" },
  "fal-ai/flux/dev": { per: "image", usd: 0.025, note: "≈ $0.025 / ảnh (ước tính)" },
  "gemini-3.1-flash-image": { per: "image", usd: 0.039, note: "≈ $0.039 / ảnh 1K (ước tính)" },
  // Nano Banana qua fal (Xưởng Phim – người chỉ có key fal)
  "fal-ai/nano-banana": { per: "image", usd: 0.039, note: "≈ $0.039 / ảnh (ước tính)" },
  "fal-ai/nano-banana/edit": { per: "image", usd: 0.039, note: "≈ $0.039 / ảnh (ước tính)" },
  "gemini-3.1-flash-lite-image": { per: "image", usd: 0.02, note: "≈ $0.02 / ảnh (ước tính)" },
  "gemini-3-pro-image": { per: "image", usd: 0.134, note: "≈ $0.134 / ảnh (ước tính)" },
  "veo-3.1-lite-generate-preview": { per: "second", usd: 0.05, note: "$0.05 / giây (720p)" },
  "veo-3.1-fast-generate-preview": { per: "second", usd: 0.1, note: "$0.10 / giây (720p)" },
  "veo-3.1-generate-preview": { per: "second", usd: 0.4, note: "$0.40 / giây (720p)" },
  "lyria-3.5": { per: "song", usd: 0.08, note: "$0.08 / bài" },
  "lyria-3-clip-preview": { per: "song", usd: 0.04, note: "≈ $0.04 / clip 30 giây (ước tính)" },
  music_v2_5: { per: "minute", usd: 0.15, note: "$0.15 / phút" },
  music_v2: { per: "minute", usd: 0.15, note: "$0.15 / phút" },
  music_v1: { per: "minute", usd: 0.15, note: "$0.15 / phút" }
};
function unitCost(model, amount) {
  const u = UNIT_PRICES[model];
  return u ? u.usd * amount : 0;
}
const EFFORT_MODELS = /^claude-(opus-5|opus-5-5|sonnet-5|sonnet-5-5|fable-5|fable-5-1|opus-4-[6-8]|sonnet-4-6)$/;
const FALLBACK_MODELS = /* @__PURE__ */ new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);
function client(ctx) {
  return new Anthropic({ apiKey: ctx.apiKey, baseURL: ctx.baseUrl ?? void 0, maxRetries: 0, timeout: 12e4 });
}
function mapError(err) {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AiError("timeout", "Hết thời gian chờ phản hồi");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout", "Hết thời gian chờ phản hồi");
  if (err instanceof Anthropic.APIConnectionError) return new AiError("network", "Không kết nối được tới Anthropic API");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AiError("auth", `HTTP ${err.status} – key không hợp lệ hoặc thiếu quyền`, err.status);
  if (err instanceof Anthropic.RateLimitError) return new AiError("rate_limit", "HTTP 429 – vượt giới hạn tần suất", 429);
  if (err instanceof Anthropic.InternalServerError) return new AiError("overloaded", `HTTP ${err.status} – Anthropic quá tải`, err.status);
  if (err instanceof Anthropic.APIError) {
    const status2 = err.status ?? 0;
    return new AiError(status2 === 529 ? "overloaded" : "bad_request", `HTTP ${status2} – ${err.message.slice(0, 200)}`, status2);
  }
  return new AiError("unknown", err instanceof Error ? err.message : String(err));
}
const anthropicAdapter = {
  async test(ctx) {
    try {
      const models = [];
      for await (const m of client(ctx).models.list({ limit: 100 }, { signal: ctx.signal })) models.push(m.id);
      return { models: models.sort() };
    } catch (err) {
      throw mapError(err);
    }
  },
  async chat(ctx, req) {
    const prompt = req.json ? `${req.prompt}

Chỉ trả về đúng một object JSON hợp lệ, không kèm giải thích hay markdown.` : req.prompt;
    try {
      const res = await client(ctx).beta.messages.create(
        {
          model: ctx.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [
            {
              role: "user",
              content: req.images?.length ? [...req.images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } })), { type: "text", text: prompt }] : prompt
            }
          ],
          ...EFFORT_MODELS.test(ctx.model) ? { output_config: { effort: "low" } } : {},
          ...FALLBACK_MODELS.has(ctx.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}
        },
        { signal: ctx.signal }
      );
      if (res.stop_reason === "refusal") {
        throw new AiError("refusal", `Claude từ chối yêu cầu${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}`);
      }
      const text = res.content.map((b) => b.type === "text" ? b.text : "").join("");
      return { text, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    } catch (err) {
      throw mapError(err);
    }
  }
};
function errorFromStatus(status2, detail2) {
  const msg = `HTTP ${status2}${detail2 ? ` – ${detail2}` : ""}`;
  if (status2 === 401 || status2 === 403) return new AiError("auth", msg, status2);
  if (status2 === 429) return new AiError("rate_limit", msg, status2);
  if (status2 === 408) return new AiError("timeout", msg, status2);
  if (status2 >= 500) return new AiError("overloaded", msg, status2);
  if (status2 >= 400) return new AiError("bad_request", msg, status2);
  return new AiError("unknown", msg, status2);
}
function errorDetail(body) {
  const first = Array.isArray(body) ? body[0] : body;
  if (!first || typeof first !== "object") return "";
  const b = first;
  const raw = typeof b.error === "string" ? b.error : b.error?.message ?? b.message ?? "";
  return String(raw).slice(0, 200);
}
async function requestJson(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal.aborted) throw new AiError("timeout", "Hết thời gian chờ phản hồi");
    throw new AiError("network", `Không kết nối được: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw errorFromStatus(res.status, errorDetail(body) || text.slice(0, 120));
  return body;
}
async function probeAuth(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal.aborted) throw new AiError("timeout", "Hết thời gian chờ phản hồi");
    throw new AiError("network", `Không kết nối được: ${err instanceof Error ? err.message : String(err)}`);
  }
  await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) throw errorFromStatus(res.status, "Key không hợp lệ");
  if (res.status === 429) throw errorFromStatus(429, "");
  return res.status;
}
function repairJson(raw) {
  let out = "";
  let inStr = false;
  let esc = false;
  const src = raw.replace(/[“”]/g, (q, i, s) => /[{,:\[]\s*$/.test(s.slice(0, i)) || /^\s*[:,}\]]/.test(s.slice(i + 1)) ? '"' : q);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') {
        if (/^\s*([,:}\]]|$)/.test(src.slice(i + 1, i + 40))) inStr = false;
        else {
          out += '\\"';
          continue;
        }
      } else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r") continue;
      else if (ch === "	") {
        out += "\\t";
        continue;
      }
    } else if (ch === '"') inStr = true;
    else if (ch === "#") {
      const tag = src.slice(i).match(/^#[^\s,\]}"]*/)[0];
      out += JSON.stringify(tag);
      i += tag.length - 1;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}
function topLevelValues(s) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start2 = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") {
      if (depth === 0) start2 = i;
      depth++;
    } else if ((ch === "}" || ch === "]") && depth > 0) {
      depth--;
      if (depth === 0 && start2 >= 0) {
        parts.push(s.slice(start2, i + 1));
        start2 = -1;
      }
    }
  }
  return { parts, truncated: depth > 0 || inStr };
}
function closeTruncated(s) {
  const stack = [];
  let inStr = false;
  let esc = false;
  let cut = -1;
  let open = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (!stack.length) return null;
      cut = i;
      open = [...stack];
    }
  }
  return cut < 0 ? null : s.slice(0, cut + 1) + open.reverse().join("");
}
const parseLoose = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return JSON.parse(repairJson(s));
  }
};
function extractJson(text, salvage = false) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const arrStart = candidate.indexOf("[");
  const objStart = candidate.indexOf("{");
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart) && candidate.lastIndexOf("]") > arrStart)
    try {
      return parseLoose(candidate.slice(arrStart, candidate.lastIndexOf("]") + 1));
    } catch {
    }
  const start2 = objStart;
  const end = candidate.lastIndexOf("}");
  if (start2 < 0 || end <= start2) throw new AiError("invalid_output", "Phản hồi không chứa JSON");
  const raw = candidate.slice(start2, end + 1);
  try {
    return parseLoose(raw);
  } catch (first) {
    const { parts, truncated } = topLevelValues(candidate.slice(start2));
    if (parts.length >= 2) {
      const values = parts.map((p) => {
        try {
          return parseLoose(p);
        } catch {
          return null;
        }
      }).filter((v) => !!v && typeof v === "object" && !Array.isArray(v));
      if (values.length === 1) return values[0];
      if (values.length) return { items: values.flatMap((v) => Array.isArray(v.items) ? v.items : [v]) };
    }
    if (truncated && salvage) {
      const closed = closeTruncated(candidate.slice(start2));
      if (closed)
        try {
          const v = parseLoose(closed);
          console.warn(`[ai] JSON bị cắt giữa chừng → giữ phần hoàn chỉnh (${closed.length}/${text.length} ký tự)`);
          return v;
        } catch {
        }
    }
    console.warn(
      `[ai] JSON lỗi: ${first instanceof Error ? first.message : String(first)} · dài ${text.length} ký tự · ${truncated ? "bị cắt giữa chừng" : `đủ ngoặc, ${parts.length} khối JSON`}`
    );
    throw new AiError("invalid_output", truncated ? "AI trả về JSON bị cắt giữa chừng" : "JSON trả về không hợp lệ");
  }
}
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const geminiAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    const res = await requestJson(`${base}/models?pageSize=200`, {
      headers: { "x-goog-api-key": ctx.apiKey },
      signal: ctx.signal
    });
    return { models: res.models.map((m) => m.name.replace(/^models\//, "")).sort() };
  },
  async chat(ctx, req) {
    const base = (ctx.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    const res = await requestJson(`${base}/models/${encodeURIComponent(ctx.model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": ctx.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [...(req.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })), { text: req.prompt }] }],
        generationConfig: {
          // Gemini 2.5+/3.x tính cả token "suy nghĩ" vào giới hạn → giới hạn nhỏ dễ trả về rỗng; chỉ trả tiền token thực dùng
          maxOutputTokens: Math.max(req.maxTokens, 8192),
          ...req.temperature != null ? { temperature: req.temperature } : {},
          ...req.json ? { responseMimeType: "application/json" } : {}
        }
      }),
      signal: ctx.signal
    });
    if (res.promptFeedback?.blockReason) throw new AiError("refusal", `Gemini chặn nội dung: ${res.promptFeedback.blockReason}`);
    const cand = res.candidates?.[0];
    if (cand?.finishReason === "SAFETY") throw new AiError("refusal", "Gemini từ chối vì chính sách an toàn");
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text.trim() && cand?.finishReason === "MAX_TOKENS") throw new AiError("invalid_output", `Gemini (${ctx.model}) hết giới hạn token trước khi trả lời`);
    if (req.json && cand?.finishReason === "MAX_TOKENS") throw new AiError("invalid_output", `Gemini (${ctx.model}) bị cắt giữa chừng do hết giới hạn token (${req.maxTokens})`);
    return {
      text,
      model: res.modelVersion ?? ctx.model,
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0
    };
  }
};
const elevenlabsAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
    const user = await requestJson(`${base}/v1/user`, {
      headers: { "xi-api-key": ctx.apiKey },
      signal: ctx.signal
    });
    const sub = user.subscription;
    return { note: sub ? `Gói ${sub.tier ?? "?"} · đã dùng ${sub.character_count ?? 0}/${sub.character_limit ?? "?"} ký tự` : void 0 };
  }
};
const replicateAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://api.replicate.com").replace(/\/$/, "");
    const acc = await requestJson(`${base}/v1/account`, { headers: { Authorization: `Bearer ${ctx.apiKey}` }, signal: ctx.signal });
    return { note: acc.username ? `Tài khoản: ${acc.username}` : void 0 };
  }
};
const pexelsAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://api.pexels.com").replace(/\/$/, "");
    await requestJson(`${base}/videos/search?query=city&per_page=1`, { headers: { Authorization: ctx.apiKey }, signal: ctx.signal });
    return {};
  }
};
const pixabayAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://pixabay.com/api").replace(/\/$/, "");
    const res = await fetch(`${base}/videos/?key=${encodeURIComponent(ctx.apiKey)}&q=city&per_page=3`, { signal: ctx.signal });
    if (res.status === 400 || res.status === 401) throw new AiError("auth", "HTTP " + res.status + " – key không hợp lệ", res.status);
    if (!res.ok) throw errorFromStatus(res.status, "");
    return {};
  }
};
const falAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://queue.fal.run").replace(/\/$/, "");
    await probeAuth(`${base}/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status`, {
      headers: { Authorization: `Key ${ctx.apiKey}` },
      signal: ctx.signal
    });
    return { note: "Key được chấp nhận (kiểm tra xác thực, không tạo ảnh)" };
  }
};
function openaiCompatible(defaultBase, flavor) {
  const base = (ctx) => (ctx.baseUrl ?? defaultBase).replace(/\/$/, "");
  const headers = (key2) => ({ Authorization: `Bearer ${key2}`, "Content-Type": "application/json" });
  return {
    async test(ctx) {
      const res = await requestJson(`${base(ctx)}/models`, { headers: headers(ctx.apiKey), signal: ctx.signal });
      return { models: res.data.map((m) => m.id).sort() };
    },
    async chat(ctx, req) {
      const reasoning = /^(o\d|gpt-5)/.test(ctx.model) || ctx.model === "deepseek-reasoner";
      const body = {
        model: ctx.model,
        messages: [
          { role: "system", content: req.system },
          {
            role: "user",
            content: req.images?.length && flavor === "openai" ? [...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } })), { type: "text", text: req.prompt }] : req.prompt
          }
        ],
        ...flavor === "openai" ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens },
        ...req.temperature != null && !reasoning ? { temperature: req.temperature } : {},
        ...req.json && ctx.model !== "deepseek-reasoner" ? { response_format: { type: "json_object" } } : {}
      };
      const res = await requestJson(`${base(ctx)}/chat/completions`, {
        method: "POST",
        headers: headers(ctx.apiKey),
        body: JSON.stringify(body),
        signal: ctx.signal
      });
      return {
        text: res.choices[0]?.message.content ?? "",
        model: res.model || ctx.model,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0
      };
    }
  };
}
const OMNIRA_AI_LABEL = "AI Omnira";
function token$1() {
  const uid = currentUser();
  const t2 = uid ? readCloudSession(uid)?.customerToken : null;
  if (!t2) throw new AiError("no_provider", "Chưa đăng nhập Omnira – không dùng được AI Omnira");
  return t2;
}
const KIND = {
  AI_DAILY: "quota",
  AI_MONTHLY: "quota",
  AI_NOT_IN_PLAN: "quota",
  AI_NO_SUBSCRIPTION: "quota",
  AI_DISABLED: "no_provider",
  AI_PAUSED: "overloaded",
  AI_NO_KEY: "overloaded",
  AI_UNAVAILABLE: "overloaded",
  AI_CONFIG: "overloaded",
  RATE_LIMITED: "rate_limit",
  AI_REFUSED: "refusal",
  AI_TOO_LONG: "bad_request",
  AI_TRUNCATED: "invalid_output"
};
async function omniraChat(req) {
  try {
    const r = await cloud("/api/client/v1/ai/chat", {
      method: "POST",
      body: {
        system: req.system,
        prompt: req.prompt,
        json: !!req.json,
        maxTokens: req.maxTokens,
        temperature: req.temperature ?? null,
        ...req.images?.length ? { images: req.images } : {}
      },
      token: token$1(),
      // Câu trả lời dài (kế hoạch nhiều ngày, kịch bản dài) có thể mất vài phút
      timeoutMs: 3e5
    });
    return { text: r.text, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, imagesSeen: r.imagesSeen ?? 0 };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof CloudError) throw new AiError(err.offline ? "network" : KIND[err.code] ?? "unknown", err.message, err.status || void 0);
    throw new AiError("unknown", err instanceof Error ? err.message : String(err));
  }
}
async function omniraQuota() {
  try {
    return await cloud("/api/client/v1/ai/quota", { token: token$1(), timeoutMs: 1e4 });
  } catch {
    return null;
  }
}
const ADAPTERS = {
  openai: openaiCompatible("https://api.openai.com/v1", "openai"),
  deepseek: openaiCompatible("https://api.deepseek.com", "deepseek"),
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  elevenlabs: elevenlabsAdapter,
  replicate: replicateAdapter,
  pexels: pexelsAdapter,
  pixabay: pixabayAdapter,
  fal: falAdapter
};
const CHAT_TIMEOUT_MS = 9e4;
const TEST_TIMEOUT_MS = 15e3;
function getSetting$2(key2, fallback) {
  const row = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, key2)).get();
  return row ? row.value : fallback;
}
function setSetting$1(key2, value) {
  getDb().insert(settings).values({ key: key2, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: /* @__PURE__ */ new Date() } }).run();
}
const modelsKey = (providerId) => `ai.models.${providerId}`;
const pricingOverrides = () => getSetting$2("ai.pricing", {});
function withTimeout$1(ms, run2) {
  const ctl2 = new AbortController();
  const timer2 = setTimeout(() => ctl2.abort(), ms);
  return run2(ctl2.signal).finally(() => clearTimeout(timer2));
}
function markProvider(id2, patch) {
  getDb().update(aiProviders).set({ ...patch, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(aiProviders.id, id2)).run();
}
function testAdapterFor(p) {
  const from = providerInfo(p.provider).keyFrom;
  return ADAPTERS[p.provider] ?? (from ? ADAPTERS[from] : void 0);
}
async function testProvider(id2) {
  const p = getDb().select().from(aiProviders).where(drizzleOrm.eq(aiProviders.id, id2)).get();
  if (!p) throw new AiError("no_provider", "Không tìm thấy nhà cung cấp");
  if (providerInfo(p.provider).keyless) {
    markProvider(id2, { status: "valid", lastTestedAt: /* @__PURE__ */ new Date(), lastError: null });
    return { ok: true, status: "valid", latencyMs: null, message: "Không cần API key" };
  }
  const k = resolveKey(p);
  if (!k) {
    const owner = keyOwner(p);
    return { ok: false, status: "untested", latencyMs: null, message: owner.id !== p.id ? `Chưa lưu API key ${owner.label}` : "Chưa lưu API key" };
  }
  const adapter = testAdapterFor(p);
  if (!adapter) return { ok: false, status: p.status, latencyMs: null, message: "Chưa hỗ trợ kiểm tra nhà cung cấp này" };
  const started2 = performance.now();
  try {
    const res = await withTimeout$1(TEST_TIMEOUT_MS, (signal) => adapter.test({ apiKey: k.key, baseUrl: k.baseUrl, signal }));
    const latencyMs = Math.round(performance.now() - started2);
    let modelCount;
    let switched = "";
    let defaultModel = p.defaultModel;
    if (res.models) {
      const models = res.models.filter((m) => isUsableModel(p.provider, m));
      if (models.length) {
        setSetting$1(modelsKey(id2), models);
        modelCount = models.length;
        if (defaultModel && !models.includes(defaultModel)) {
          const pick2 = preferredModel(p.provider, models);
          if (pick2) {
            switched = ` · "${defaultModel}" không còn khả dụng → đã chuyển sang "${pick2}"`;
            defaultModel = pick2;
          }
        }
      }
    }
    markProvider(id2, { status: "valid", lastLatencyMs: latencyMs, lastError: null, lastTestedAt: /* @__PURE__ */ new Date(), defaultModel });
    const base = res.note ?? (modelCount != null ? `${modelCount} model khả dụng` : "Kết nối thành công");
    if (switched) console.info(`[ai] ${p.provider}: model ${p.defaultModel} → ${defaultModel}`);
    return { ok: true, status: "valid", latencyMs, message: base + switched, modelCount };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError("unknown", String(err));
    const latencyMs = Math.round(performance.now() - started2);
    const status2 = e.kind === "auth" ? "invalid" : e.kind === "rate_limit" ? "rate_limited" : p.status;
    markProvider(id2, { status: status2, lastError: `${e.kind}: ${e.message}`, lastTestedAt: /* @__PURE__ */ new Date(), ...e.kind === "rate_limit" ? { lastLatencyMs: latencyMs } : {} });
    console.warn(`[ai] test ${p.provider} → ${e.kind}${e.status ? ` (${e.status})` : ""}`);
    return { ok: false, status: status2, latencyMs: null, message: e.message };
  }
}
async function testWithDependents(id2) {
  const p = getDb().select().from(aiProviders).where(drizzleOrm.eq(aiProviders.id, id2)).get();
  if (!p) throw new AiError("no_provider", "Không tìm thấy nhà cung cấp");
  const outcome = await testProvider(id2);
  if (outcome.ok) {
    const dependents = getDb().select().from(aiProviders).all().filter((r) => providerInfo(r.provider).keyFrom === p.provider);
    await Promise.all(dependents.map((d) => testProvider(d.id)));
  }
  return outcome;
}
async function testModel(id2) {
  const p = getDb().select().from(aiProviders).where(drizzleOrm.eq(aiProviders.id, id2)).get();
  if (!p) throw new AiError("no_provider", "Không tìm thấy nhà cung cấp");
  const adapter = ADAPTERS[p.provider];
  const model = p.defaultModel ?? providerInfo(p.provider).models[0]?.id ?? null;
  if (!adapter?.chat || !model) return { ok: false, status: p.status, latencyMs: null, message: "Chỉ thử được model văn bản", model };
  const k = resolveKey(p);
  if (!k) return { ok: false, status: p.status, latencyMs: null, message: "Chưa lưu API key", model };
  const started2 = performance.now();
  try {
    const res = await withTimeout$1(
      3e4,
      (signal) => adapter.chat({ apiKey: k.key, baseUrl: k.baseUrl, model, signal }, { system: "Trả lời đúng một từ.", prompt: "Trả lời: OK", maxTokens: 16 })
    );
    const latencyMs = Math.round(performance.now() - started2);
    recordUsage$2(p, null, "settings.testModel", res.model || model, res.inputTokens, res.outputTokens, true);
    markProvider(id2, { status: "valid", lastLatencyMs: latencyMs, lastError: null });
    return { ok: true, status: "valid", latencyMs, message: `Model "${model}" trả lời bình thường`, model };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError("unknown", String(err));
    markProvider(id2, { lastError: `${e.kind}: ${e.message}` });
    const hint = e.status === 404 ? " – model không tồn tại hoặc đã bị nhà cung cấp tắt, bấm Check Connection để chọn lại" : e.kind === "overloaded" ? " – máy chủ nhà cung cấp đang quá tải, thử lại sau hoặc chọn model khác" : "";
    return { ok: false, status: p.status, latencyMs: null, message: e.message + hint, model };
  }
}
function monthStart() {
  const d = /* @__PURE__ */ new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function spentUsd(workspaceId) {
  const row = getDb().select({ usd: drizzleOrm.sum(aiUsage.costUsd).mapWith(Number) }).from(aiUsage).where(drizzleOrm.and(drizzleOrm.gte(aiUsage.createdAt, monthStart()), workspaceId ? drizzleOrm.eq(aiUsage.workspaceId, workspaceId) : void 0)).get();
  return row?.usd ?? 0;
}
function assertBudget(workspaceId) {
  const db2 = getDb();
  const cap = getSetting$2("budget.monthlyHardCapUsd", 50);
  const breaker = getSetting$2("budget.circuitBreaker", true);
  const total2 = spentUsd();
  if (breaker && total2 >= cap) {
    const open = db2.select({ id: alerts.id }).from(alerts).where(drizzleOrm.and(drizzleOrm.eq(alerts.kind, "budget"), drizzleOrm.isNull(alerts.resolvedAt), drizzleOrm.gte(alerts.createdAt, monthStart()))).get();
    if (!open) {
      db2.insert(alerts).values({
        id: newId(),
        severity: "error",
        kind: "budget",
        entityType: "ai_provider",
        title: "Circuit Breaker đã ngắt",
        message: `Chi phí AI tháng này $${total2.toFixed(2)} đã chạm hạn mức $${cap.toFixed(2)}. Mọi tác vụ AI tạm dừng.`
      }).run();
    }
    throw new AiError("budget", `Đã chạm hạn mức chi tiêu tháng ($${total2.toFixed(2)} / $${cap.toFixed(2)}) – Circuit Breaker đang ngắt`);
  }
  if (workspaceId) {
    const ws = db2.select({ name: workspaces.name, budget: workspaces.aiBudgetUsd }).from(workspaces).where(drizzleOrm.eq(workspaces.id, workspaceId)).get();
    if (ws?.budget != null) {
      const used = spentUsd(workspaceId);
      if (used >= ws.budget) throw new AiError("budget", `Pocket "${ws.name}" đã dùng hết ngân sách AI tháng ($${used.toFixed(2)} / $${ws.budget.toFixed(2)})`);
    }
  }
}
function recordUsage$2(p, workspaceId, feature, model, inTok, outTok, ok) {
  const cost = ok ? estimateCostUsd(model, inTok, outTok, pricingOverrides()) : 0;
  getDb().insert(aiUsage).values({ id: newId(), providerId: p.id, workspaceId: workspaceId ?? null, model, feature, inputTokens: inTok, outputTokens: outTok, costUsd: cost ?? 0, ok }).run();
  return cost;
}
async function omniraText(req, opts) {
  try {
    const res = await omniraChat(req);
    getDb().insert(aiUsage).values({ id: newId(), providerId: null, workspaceId: opts.workspaceId ?? null, model: res.model, feature: opts.feature, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: 0, ok: true }).run();
    return { text: res.text, providerLabel: OMNIRA_AI_LABEL, model: res.model, costUsd: 0, attempts: [{ provider: OMNIRA_AI_LABEL }], imagesSeen: res.imagesSeen ?? 0 };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError("unknown", err instanceof Error ? err.message : String(err));
    console.warn(`[ai] ${opts.feature} · AI Omnira → ${e.kind}${e.status ? ` (${e.status})` : ""}`);
    throw e;
  }
}
function textChain() {
  return getDb().select().from(aiProviders).where(drizzleOrm.and(drizzleOrm.eq(aiProviders.category, "text"), drizzleOrm.eq(aiProviders.enabled, true))).orderBy(drizzleOrm.asc(aiProviders.priority)).all().filter((p) => p.status !== "invalid" && ADAPTERS[p.provider]?.chat && resolveKey(p) != null);
}
async function chatWithRetry(p, ctx, req) {
  const delays = [1500, 4e3];
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout$1(CHAT_TIMEOUT_MS, (signal) => ADAPTERS[p.provider].chat({ ...ctx, signal }, req));
    } catch (err) {
      const retryable = err instanceof AiError && (err.kind === "overloaded" || err.kind === "timeout");
      if (!retryable || attempt >= delays.length) throw err;
      console.warn(`[ai] ${p.provider}/${ctx.model} quá tải → thử lại sau ${delays[attempt]}ms`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
const VISION_PROVIDERS = /* @__PURE__ */ new Set(["gemini", "openai", "anthropic"]);
async function aiText(req, opts) {
  assertBudget(opts.workspaceId);
  const chain = textChain();
  if (!chain.length) return omniraText(req, opts);
  const fallback = getSetting$2("ai.fallbackOnError", true);
  if (req.images?.length) {
    const vision = chain.filter((p) => VISION_PROVIDERS.has(p.provider));
    if (vision.length) chain.splice(0, chain.length, ...vision);
    else {
      console.warn(`[ai] ${opts.feature}: không có AI văn bản nào đọc được ảnh → gửi không kèm ảnh`);
      req = { ...req, images: void 0 };
    }
  }
  const attempts = [];
  let lastErr = null;
  for (const p of fallback ? chain : chain.slice(0, 1)) {
    const k = resolveKey(p);
    if (!k) continue;
    const model = p.defaultModel ?? providerInfo(p.provider).models[0]?.id;
    if (!model) continue;
    const started2 = performance.now();
    try {
      const res = await chatWithRetry(p, { apiKey: k.key, baseUrl: k.baseUrl, model }, req);
      if (!res.text.trim()) throw new AiError("invalid_output", "Phản hồi rỗng");
      markProvider(p.id, { status: "valid", lastLatencyMs: Math.round(performance.now() - started2), lastError: null });
      const costUsd = recordUsage$2(p, opts.workspaceId, opts.feature, res.model || model, res.inputTokens, res.outputTokens, true);
      attempts.push({ provider: p.label });
      return { text: res.text, providerLabel: p.label, model: res.model || model, costUsd, attempts, imagesSeen: req.images?.length ?? 0 };
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError("unknown", err instanceof Error ? err.message : String(err));
      lastErr = e;
      attempts.push({ provider: p.label, error: e.message });
      console.warn(`[ai] ${opts.feature} · ${p.provider}/${model} → ${e.kind}${e.status ? ` (${e.status})` : ""}`);
      if (e.kind === "auth") markProvider(p.id, { status: "invalid", lastError: `${e.kind}: ${e.message}` });
      else if (e.kind === "rate_limit") markProvider(p.id, { status: "rate_limited", lastError: `${e.kind}: ${e.message}` });
      else markProvider(p.id, { lastError: `${e.kind}: ${e.message}` });
      recordUsage$2(p, opts.workspaceId, opts.feature, model, 0, 0, false);
      if (!e.retryable) break;
    }
  }
  const tried = attempts.map((a) => `${a.provider}: ${a.error}`).join(" → ");
  throw new AiError(lastErr?.kind ?? "unknown", attempts.length > 1 ? `Tất cả nhà cung cấp đều lỗi (${tried})` : lastErr?.message ?? "Lỗi không xác định");
}
const FEATURE_LABEL = {
  STUDIO: "Xưởng video AI",
  SERIES: "Series AI",
  FILM: "Xưởng phim",
  FLOW: "Tạo ảnh / video bằng Google Flow",
  CALENDAR: "Lịch đăng bài",
  INBOX: "Hộp thư hợp nhất",
  ANALYTICS: "Phân tích số liệu"
};
const isFeatureCode = (s) => s in FEATURE_LABEL;
const LEGACY_LABEL = {
  "xưởng video ai": "STUDIO",
  "series ai": "SERIES",
  "xưởng phim": "FILM",
  "lịch đăng bài": "CALENDAR",
  "hộp thư hợp nhất": "INBOX"
};
function normalizeFeatures(list2) {
  const out = /* @__PURE__ */ new Set();
  for (const raw of list2 ?? []) {
    const s = raw.trim();
    const code = isFeatureCode(s.toUpperCase()) ? s.toUpperCase() : LEGACY_LABEL[s.toLowerCase()];
    if (code) out.add(code);
  }
  return [...out];
}
const FEATURE_NAMESPACES = [
  ["film.", "FILM"],
  ["series.", "SERIES"],
  ["studio.", "STUDIO"],
  ["render.start", "STUDIO"],
  ["plan.toVideo", "STUDIO"],
  ["flow.", "FLOW"],
  ["posts.", "CALENDAR"],
  ["inbox.", "INBOX"],
  ["analytics.", "ANALYTICS"],
  ["insights.", "ANALYTICS"]
];
const VIEW_ONLY = /* @__PURE__ */ new Set([
  "film.gate",
  "film.list",
  "film.get",
  "film.estimate",
  "film.renders",
  "film.queue",
  "film.assembleStatus",
  "series.list",
  "series.get",
  "studio.projects",
  "studio.get",
  "flow.status",
  "posts.range",
  "posts.worker",
  "posts.stagger",
  "inbox.conversations",
  "inbox.messages",
  "inbox.stats",
  "inbox.quickReplies",
  "inbox.rules",
  "inbox.aiSettings",
  "inbox.worker",
  "analytics.overview",
  "analytics.goals",
  "insights.last",
  "insights.bestHours"
]);
function featureForEndpoint(endpoint) {
  if (VIEW_ONLY.has(endpoint)) return null;
  for (const [prefix, code] of FEATURE_NAMESPACES) if (prefix.endsWith(".") ? endpoint.startsWith(prefix) : endpoint === prefix) return code;
  return null;
}
const LICENSE_KEY_ID = "p5JDXbsSf9Pqaw_JsbE5bUWGRH_rhENAbYP4Zzp4jQE";
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA11kPKElIkEc2daYQkvuc
1HyOCpxrWySW6GoHy6/na6Re+Mlb2NxUuSQfY+QjNZNwhLWsZysKpigqTcFmGGlL
17gSiudRmKOs2YDnYphL+atcVjVkquSeS6rhGyRXMsAnWPulsYogOnIC5Nk4eAP6
VEDpDn6aIYgpH9vGm9GRbfp0VjjC9EI4JJ1Qcs6Exce/Wz9Tl3HMq6Yfvwz1pYhs
reaVWWM2lxy29REPy+4M5Ayh7+v7UOsHRO1iTRuVbvCE0BNa8jc5WxscXrtZek4e
CROlvxl+8TnaGHdITwnW1g5nacIe9mVFVGNxYsKedxVGOsxugThPi8AfphBF4U3K
7wIDAQAB
-----END PUBLIC KEY-----`;
const HEARTBEAT_MS = 6 * 36e5;
let publicKey = null;
const key = () => publicKey ??= node_crypto.createPublicKey(process.env.OMNI_LICENSE_PUBLIC_KEY ?? LICENSE_PUBLIC_KEY);
const b64 = (s) => Buffer.from(s, "base64url");
function verifyLicenseToken(token2, now2 = Date.now()) {
  if (!token2) return null;
  const parts = token2.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64(parts[0]).toString());
    if (header.alg !== "RS256") return null;
    if (header.kid && header.kid !== LICENSE_KEY_ID && !process.env.OMNI_LICENSE_PUBLIC_KEY) return null;
    if (!node_crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key(), b64(parts[2]))) return null;
    const c = JSON.parse(b64(parts[1]).toString());
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (c.typ !== "license" || !aud.includes("omnira-studio") || c.did !== deviceId()) return null;
    if (!c.exp || c.exp * 1e3 <= now2) return null;
    return c;
  } catch {
    return null;
  }
}
let state = null;
let timer$4 = null;
let inflight = null;
let queue$1 = Promise.resolve();
const serial = (fn) => {
  const run2 = queue$1.then(fn, fn);
  queue$1 = run2.catch(() => void 0);
  return run2;
};
const listeners$1 = /* @__PURE__ */ new Set();
const stateListeners = /* @__PURE__ */ new Set();
const usableStatus = (s) => s === "active" || s === "offline";
function onLicenseState(fn) {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}
function onLicenseChange(fn) {
  listeners$1.add(fn);
  return () => listeners$1.delete(fn);
}
function set(patch) {
  if (!state) return;
  const before = usableStatus(state.status);
  state = { ...state, ...patch };
  const after = usableStatus(state.status);
  if (before !== after) listeners$1.forEach((l) => l(after));
  stateListeners.forEach((l) => l());
}
bindCloudSession(() => ({ userId: state?.localUserId ?? null, token: state ? readCloudSession(state.localUserId)?.customerToken ?? null : null }));
function cloudCustomerToken() {
  return state ? readCloudSession(state.localUserId)?.customerToken ?? null : null;
}
function licenseUsable() {
  return !!state && usableStatus(state.status);
}
function hasFeature(code) {
  return normalizeFeatures(state?.claims?.features).includes(code);
}
const featureLockedMessage = (code) => `${FEATURE_LABEL[code]} không có trong gói ${state?.claims?.planName ?? "hiện tại"} – nâng cấp gói để mở khóa`;
function licenseLimits() {
  const c = state?.claims;
  return { maxChannels: c?.maxChannels ?? null, flowThreads: c?.flowThreads ?? null, maxDevices: c?.maxDevices ?? null };
}
function licenseView() {
  const c = state?.claims ?? null;
  return {
    status: state?.status ?? "checking",
    usable: licenseUsable(),
    message: state?.message ?? null,
    needRelogin: state?.needRelogin ?? false,
    plan: c?.plan ?? null,
    planName: c?.planName ?? null,
    trial: c?.trial ?? false,
    entitlementEndsAt: c?.entitlementEndsAt ? new Date(c.entitlementEndsAt * 1e3) : null,
    tokenExpiresAt: c ? new Date(c.exp * 1e3) : null,
    maxDevices: c?.maxDevices ?? null,
    maxChannels: c?.maxChannels ?? null,
    flowThreads: c?.flowThreads ?? null,
    features: normalizeFeatures(c?.features),
    deviceId: deviceId(),
    lastCheckedAt: state?.lastCheckedAt ? new Date(state.lastCheckedAt) : null,
    lastOnlineAt: state?.lastOnlineAt ? new Date(state.lastOnlineAt) : null
  };
}
function activeChannelCount() {
  try {
    return Number(getDb().select({ n: drizzleOrm.sql`count(*)` }).from(channels).where(drizzleOrm.inArray(channels.status, ["active", "error"])).get()?.n ?? 0);
  } catch {
    return void 0;
  }
}
const deviceBody = () => ({
  deviceId: deviceId(),
  name: os.hostname().slice(0, 120),
  os: `${os.type()} ${os.release()}`.slice(0, 80),
  appVersion: electron.app.getVersion(),
  activeChannels: activeChannelCount()
});
function applyError(e) {
  const now2 = Date.now();
  const err = e instanceof CloudError ? e : new CloudError("OFFLINE", e instanceof Error ? e.message : String(e), 0);
  if (err.offline) {
    const claims = verifyLicenseToken(readCloudSession(state.localUserId)?.licenseToken);
    set(
      claims ? { claims, status: "offline", message: "Đang dùng ngoại tuyến – app sẽ tự kiểm tra lại license khi có mạng", lastCheckedAt: now2 } : { claims: null, status: "expired", message: "Cần kết nối mạng để kiểm tra license (đã quá thời gian dùng ngoại tuyến)", lastCheckedAt: now2 }
    );
    return;
  }
  const map = {
    NO_SUBSCRIPTION: "no_subscription",
    DEVICE_LIMIT: "device_limit",
    DEVICE_REVOKED: "revoked",
    ACCOUNT_LOCKED: "locked"
  };
  if (err.status === 401 || err.code === "UNAUTHORIZED") {
    const claims = verifyLicenseToken(readCloudSession(state.localUserId)?.licenseToken);
    set({ claims, status: claims ? "active" : "relogin", needRelogin: true, message: "Phiên đăng nhập Omnira đã hết hạn – đăng xuất rồi đăng nhập lại", lastCheckedAt: now2 });
    return;
  }
  set({ claims: null, status: map[err.code] ?? "expired", message: err.message, lastCheckedAt: now2, lastOnlineAt: now2 });
}
function accept(token2) {
  const now2 = Date.now();
  const claims = verifyLicenseToken(token2);
  if (!claims) {
    set({ claims: null, status: "expired", message: "Token license không hợp lệ (sai chữ ký / sai máy) – liên hệ hỗ trợ", lastCheckedAt: now2, lastOnlineAt: now2 });
    return;
  }
  patchCloudSession(state.localUserId, { licenseToken: token2 });
  set({ claims, status: "active", message: null, needRelogin: false, lastCheckedAt: now2, lastOnlineAt: now2 });
  void syncAppConfig();
}
function activateLicense() {
  return serial(activateNow);
}
async function activateNow() {
  if (!state) throw new Error("Chưa đăng nhập");
  const token2 = readCloudSession(state.localUserId)?.customerToken;
  if (!token2) {
    set({ status: "relogin", needRelogin: true, message: "Đăng nhập lại tài khoản Omnira" });
    return licenseView();
  }
  try {
    accept((await cloud("/api/client/v1/license/activate", { method: "POST", body: deviceBody(), token: token2 })).token);
  } catch (e) {
    applyError(e);
  }
  return licenseView();
}
function refreshLicense() {
  inflight ??= serial(async () => {
    try {
      if (!state) return licenseView();
      const token2 = readCloudSession(state.localUserId)?.customerToken;
      if (!token2) {
        applyError(new CloudError("UNAUTHORIZED", "Chưa đăng nhập Omnira", 401));
        return licenseView();
      }
      try {
        accept((await cloud("/api/client/v1/license/heartbeat", { method: "POST", body: deviceBody(), token: token2 })).token);
      } catch (e) {
        if (e instanceof CloudError && (e.code === "DEVICE_NOT_ACTIVATED" || e.code === "DEVICE_REVOKED")) {
          if (e.code === "DEVICE_REVOKED") applyError(e);
          else return await activateNow();
        } else applyError(e);
      }
      return licenseView();
    } finally {
      inflight = null;
    }
  });
  return inflight;
}
function startLicense(localUserId) {
  stopLicense();
  const claims = verifyLicenseToken(readCloudSession(localUserId)?.licenseToken);
  state = {
    localUserId,
    claims,
    status: claims ? "active" : "checking",
    message: null,
    needRelogin: false,
    lastCheckedAt: null,
    lastOnlineAt: null
  };
  if (claims) listeners$1.forEach((l) => l(true));
  void refreshLicense();
  timer$4 = setInterval(() => {
    if (state?.claims && state.claims.exp * 1e3 <= Date.now()) set({ claims: null, status: "expired", message: "License hết hạn dùng ngoại tuyến – cần kết nối mạng" });
    if (!state?.lastCheckedAt || Date.now() - state.lastCheckedAt >= HEARTBEAT_MS || !licenseUsable()) void refreshLicense();
  }, 10 * 6e4);
}
function stopLicense() {
  if (timer$4) clearInterval(timer$4);
  timer$4 = null;
  if (state && licenseUsable()) listeners$1.forEach((l) => l(false));
  state = null;
}
async function deactivateLicense(customerToken) {
  if (!customerToken) return;
  try {
    await cloud("/api/client/v1/license/deactivate", { method: "POST", body: { deviceId: deviceId() }, token: customerToken, timeoutMs: 6e3 });
  } catch (e) {
    console.warn("[license] không trả được chỗ máy khi đăng xuất", e instanceof Error ? e.message : e);
  }
}
const FLOW_URL = process.env.OMNI_FLOW_URL || "https://labs.google/fx/tools/flow";
const GEN_TIMEOUT_MS = 10 * 6e4;
const TOP_TILES = 4;
function getSetting$1(key2, fallback) {
  const row = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, key2)).get();
  return row ? row.value : fallback;
}
function putSetting$2(key2, value) {
  getDb().insert(settings).values({ key: key2, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: /* @__PURE__ */ new Date() } }).run();
}
const veoSource = () => getSetting$1("veo.source", "api") === "flow" ? "flow" : "api";
const setVeoSource = (s) => putSetting$2("veo.source", s);
const loginState = () => getSetting$1("flow.login", { loggedIn: false, email: null, checkedAt: null });
const creditsState = () => getSetting$1("flow.credits", { credits: null, tier: null, at: null });
const flowHidden = () => getSetting$1("flow.hidden", true) !== false;
const flowMaxThreads = () => Math.min(4, Math.max(1, licenseLimits().flowThreads ?? 4));
const flowConcurrency = () => Math.min(flowMaxThreads(), Math.max(1, Number(getSetting$1("flow.concurrency", 2)) || 2));
const setFlowConcurrency = (n) => putSetting$2("flow.concurrency", Math.min(4, Math.max(1, Math.round(n))));
const flowReady = () => veoSource() === "flow" && loginState().loggedIn;
function findChrome() {
  const env2 = process.env;
  const list2 = process.platform === "win32" ? [env2.PROGRAMFILES, env2["PROGRAMFILES(X86)"], env2.LOCALAPPDATA].filter((b) => !!b).flatMap((b) => [node_path.join(b, "Google", "Chrome", "Application", "chrome.exe")]).concat([env2["PROGRAMFILES(X86)"], env2.PROGRAMFILES].filter((b) => !!b).map((b) => node_path.join(b, "Microsoft", "Edge", "Application", "msedge.exe"))) : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"] : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return list2.find((p) => node_fs.existsSync(p)) ?? null;
}
const profileDir = () => node_path.join(userDir(), "flow-chrome");
const diagRoot = () => node_path.join(userDir(), "flow-diagnostics");
let chrome = null;
let loginProc = null;
let loginCheck = null;
const sleep$1 = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(port, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      return await playwrightCore.chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 3e3 });
    } catch {
      await sleep$1(500);
    }
  }
  return null;
}
async function ensureChrome() {
  const user = currentUser();
  if (!user) throw new Error("Chưa đăng nhập app");
  if (chrome?.user === user && chrome.browser.isConnected()) return chrome.browser;
  if (loginProc) throw new Error("Cửa sổ đăng nhập Google Flow đang mở – đăng nhập xong hãy đóng cửa sổ Chrome đó rồi thử lại");
  await closeFlowChrome();
  const dir = profileDir();
  node_fs.mkdirSync(dir, { recursive: true });
  const portFile = node_path.join(dir, "DevToolsActivePort");
  if (node_fs.existsSync(portFile)) {
    const port2 = Number(node_fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
    const b2 = port2 ? await connect(port2, 1) : null;
    if (b2) {
      chrome = { user, browser: b2, proc: null };
      b2.on("disconnected", () => chrome?.browser === b2 && (chrome = null));
      return b2;
    }
  }
  const exe = findChrome();
  if (!exe) throw new Error("Không tìm thấy Google Chrome (hoặc Microsoft Edge) trên máy – cài Chrome rồi thử lại");
  node_fs.rmSync(portFile, { force: true });
  const proc = node_child_process.spawn(
    exe,
    [
      `--user-data-dir=${dir}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--lang=en-US",
      "--window-size=1280,900",
      // Chạy ẩn: đặt cửa sổ ngoài màn hình; vẫn là Chrome có giao diện bình thường (không headless)
      ...flowHidden() ? [OFFSCREEN_ARG] : [],
      // Cửa sổ bị che / ngoài màn hình vẫn chạy đủ tốc độ (Chrome mặc định giảm tốc tab nền)
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "about:blank"
    ],
    { stdio: "ignore" }
  );
  let exited = false;
  proc.once("exit", () => exited = true);
  let port = 0;
  for (let i = 0; i < 60 && !port && !exited; i++) {
    await sleep$1(500);
    if (node_fs.existsSync(portFile)) port = Number(node_fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0]) || 0;
  }
  const b = port ? await connect(port, 20) : null;
  if (!b) {
    if (!exited) proc.kill();
    throw new Error("Không nối được với Chrome. Nếu cửa sổ Chrome của Google Flow đang mở sẵn, hãy đóng nó rồi thử lại.");
  }
  chrome = { user, browser: b, proc };
  b.on("disconnected", () => chrome?.browser === b && (chrome = null));
  proc.once("exit", () => chrome?.proc === proc && (chrome = null));
  return b;
}
const OFFSCREEN = { left: -32e3, top: -32e3 };
const OFFSCREEN_ARG = `--window-position=${OFFSCREEN.left},${OFFSCREEN.top}`;
async function placeWindows(hidden) {
  const b = chrome?.browser;
  if (!b?.isConnected()) return;
  const pages = b.contexts().flatMap((c) => c.pages());
  const seen = /* @__PURE__ */ new Set();
  for (const p of pages) {
    try {
      const s = await p.context().newCDPSession(p);
      const { windowId } = await s.send("Browser.getWindowForTarget");
      if (seen.has(windowId)) continue;
      seen.add(windowId);
      await s.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      await s.send("Browser.setWindowBounds", { windowId, bounds: hidden ? OFFSCREEN : { left: 80, top: 60, width: 1280, height: 900 } });
      await s.detach();
    } catch {
    }
  }
}
async function setFlowHidden(hidden) {
  putSetting$2("flow.hidden", hidden);
  await placeWindows(hidden);
}
const context = (b) => {
  const ctx = b.contexts()[0];
  if (!ctx) throw new Error("Chrome chưa sẵn sàng");
  return ctx;
};
async function closeFlowChrome() {
  slotPages.clear();
  slotConfig.clear();
  if (loginProc) {
    loginProc.kill();
    loginProc = null;
  }
  const c = chrome;
  chrome = null;
  if (!c) return;
  try {
    const s = await c.browser.newBrowserCDPSession();
    await s.send("Browser.close").catch(() => void 0);
  } catch {
  }
  await c.browser.close().catch(() => void 0);
  c.proc?.kill();
}
async function openFlowLogin() {
  if (!currentUser()) throw new Error("Chưa đăng nhập app");
  if (loginProc) return;
  if (running$3 > 0) throw new Error("Đang tạo video bằng Flow – chờ xong rồi đăng nhập lại");
  const exe = findChrome();
  if (!exe) throw new Error("Không tìm thấy Google Chrome (hoặc Microsoft Edge) trên máy – cài Chrome rồi thử lại");
  if (chrome) {
    await closeFlowChrome();
    await sleep$1(1500);
  }
  const dir = profileDir();
  node_fs.mkdirSync(dir, { recursive: true });
  const proc = node_child_process.spawn(exe, [`--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", FLOW_URL], { stdio: "ignore" });
  loginProc = proc;
  proc.once("exit", () => {
    if (loginProc !== proc) return;
    loginProc = null;
    loginCheck = sleep$1(1500).then(() => checkFlowLogin()).catch((err) => console.warn("[flow] kiểm tra đăng nhập lỗi", err)).finally(() => {
      loginCheck = null;
      void closeFlowChrome();
    });
  });
  proc.once("error", () => loginProc === proc && (loginProc = null));
}
async function readLogin(page) {
  const at2 = Date.now();
  if (/accounts\.google\.com/.test(page.url())) return { loggedIn: false, email: null, checkedAt: at2 };
  const s = await page.evaluate(async () => {
    try {
      const r = await fetch("/fx/api/auth/session", { credentials: "include" });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }).catch(() => null);
  if (s?.user) return { loggedIn: true, email: s.user.email ?? s.user.name ?? null, checkedAt: at2 };
  const account = await page.locator('a[aria-label*="@"], [role=button][aria-label*="@"]').first().getAttribute("aria-label", { timeout: 5e3 }).catch(() => null);
  const email2 = account?.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  if (email2) return { loggedIn: true, email: email2, checkedAt: at2 };
  const signIn = await page.getByRole("button", { name: /sign in|đăng nhập/i }).or(page.getByRole("link", { name: /sign in|đăng nhập/i })).count();
  const app = await newProjectButton(page).count() + await promptCandidates(page).count();
  return { loggedIn: signIn === 0 && app > 0, email: null, checkedAt: at2 };
}
async function checkFlowLogin() {
  const ctx = context(await ensureChrome());
  const page = await ctx.newPage();
  try {
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 6e4 });
    await visible(page.locator('a[aria-label*="@"]').or(newProjectButton(page)).or(page.getByRole("link", { name: /sign in|đăng nhập/i })), 2e4);
    const st = await readLogin(page);
    putSetting$2("flow.login", st);
    if (st.loggedIn) await refreshCredits(page);
    return st;
  } finally {
    await page.close().catch(() => void 0);
  }
}
async function resetFlowProfile() {
  await closeFlowChrome();
  await sleep$1(800);
  node_fs.rmSync(profileDir(), { recursive: true, force: true });
  putSetting$2("flow.login", { loggedIn: false, email: null, checkedAt: Date.now() });
  putSetting$2("flow.credits", { credits: null, tier: null, at: null });
}
const accountButton = (page) => page.locator(".header-user-button").or(page.getByRole("button", { name: /thông tin về tài khoản|account info/i }));
const CREDIT_TEXT = /(\d[\d.,\s]*)\s*(?:tín dụng|(?:google flow |ai )?credits?\b)/i;
async function readCredits(page) {
  const btn = accountButton(page).first();
  if (!await visible(btn, 5e3)) return null;
  const tierLabel = await page.locator('[aria-label$=" tier" i]').first().getAttribute("aria-label", { timeout: 1e3 }).catch(() => null);
  const tier = tierLabel?.replace(/\s*tier$/i, "").trim() || null;
  await btn.click({ timeout: 5e3 });
  try {
    const line = page.getByText(CREDIT_TEXT).first();
    if (!await visible(line, 8e3)) return null;
    const m = (await line.textContent({ timeout: 2e3 }) ?? "").match(CREDIT_TEXT);
    const credits = m ? Number(m[1].replace(/\D/g, "")) : NaN;
    return Number.isFinite(credits) ? { credits, tier, at: Date.now() } : null;
  } finally {
    const closed = await clickFirst([page.locator("button.close-btn"), iconButton(page, "close")], 1e3).catch(() => false);
    if (!closed) await page.keyboard.press("Escape").catch(() => void 0);
    await sleep$1(400);
  }
}
async function refreshFlowCredits() {
  if (running$3 > 0 || waiting.length > 0 || loginProc || loginCheck) return;
  const wasOpen = !!chrome?.browser.isConnected();
  try {
    await checkFlowLogin();
  } finally {
    if (!wasOpen && running$3 === 0 && waiting.length === 0) await closeFlowChrome();
  }
}
async function refreshCredits(page) {
  try {
    const c = await readCredits(page);
    if (c) putSetting$2("flow.credits", c);
    else console.warn("[flow] không đọc được credit trên trang Flow");
  } catch (err) {
    console.warn("[flow] đọc credit lỗi", err);
  }
}
function flowStatus() {
  const st = loginState();
  const cr = creditsState();
  let profile = false;
  let diagnostics = 0;
  try {
    profile = node_fs.existsSync(profileDir());
    diagnostics = node_fs.existsSync(diagRoot()) ? node_fs.readdirSync(diagRoot()).length : 0;
  } catch {
  }
  return {
    source: veoSource(),
    model: flowModel(),
    chromePath: findChrome(),
    running: !!chrome?.browser.isConnected(),
    loginWindow: !!loginProc,
    checking: !!loginCheck,
    profile,
    loggedIn: st.loggedIn,
    email: st.email,
    checkedAt: st.checkedAt ? new Date(st.checkedAt) : null,
    credits: st.loggedIn ? cr.credits : null,
    tier: st.loggedIn ? cr.tier : null,
    creditsAt: st.loggedIn && cr.at ? new Date(cr.at) : null,
    busy: running$3 > 0 || waiting.length > 0,
    active: running$3,
    waiting: waiting.length,
    concurrency: flowConcurrency(),
    maxConcurrency: flowMaxThreads(),
    hidden: flowHidden(),
    images: flowImagesEnabled(),
    diagnosticsDir: diagnostics ? diagRoot() : null
  };
}
const flowDiagnosticsDir = () => diagRoot();
const newProjectButton = (page) => page.getByRole("button", { name: /new project|dự án mới/i }).or(page.getByRole("link", { name: /new project|dự án mới/i }));
const promptCandidates = (page) => page.locator('[contenteditable="true"]:visible, textarea:visible, [role="textbox"]:visible');
async function visible(l, timeout) {
  try {
    await l.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}
async function clickFirst(cands, timeout = 3e3) {
  for (const c of cands) {
    if (await visible(c, timeout)) {
      await c.first().click();
      return true;
    }
  }
  return false;
}
const iconButton = (page, icon) => page.locator("button", { has: page.locator(`mat-icon:text-is("${icon}"), i:text-is("${icon}"), span:text-is("${icon}")`) });
const sendButton = (page) => page.getByRole("button", { name: /bắt đầu tạo|^generate|^create|arrow_forward/i }).or(iconButton(page, "arrow_forward"));
const settingsButton = (page) => page.getByRole("button", { name: /điều kiện kích hoạt cài đặt|settings trigger|generation settings/i }).or(page.locator("button", { hasText: /crop_(16_9|9_16|square|landscape|portrait)/ }));
const radio = (page, text) => page.getByRole("radio").filter({ hasText: text });
async function checkRadio(page, text, what, required) {
  const r = radio(page, text);
  if (!await visible(r, 2500)) {
    if (required) throw new Error(`Không tìm thấy lựa chọn "${what}" trong cài đặt Flow`);
    return;
  }
  if (await r.first().getAttribute("aria-checked") !== "true") {
    await r.first().click();
    await sleep$1(500);
  }
}
const FLOW_MODELS = ["Veo 3.1 - Fast", "Veo 3.1 - Lite", "Veo 3.1 - Quality", "Omni 1.1 Flash"];
const flowModel = () => {
  const m = getSetting$1("flow.model", "Veo 3.1 - Fast");
  return FLOW_MODELS.includes(m) ? m : "Veo 3.1 - Fast";
};
const setFlowModel = (m) => putSetting$2("flow.model", m);
const flowSeconds = (sec) => sec <= 4 ? 4 : sec <= 6 ? 6 : sec <= 8 ? 8 : 10;
const flowClipSeconds = (sec) => flowModel().startsWith("Veo") ? 8 : flowSeconds(sec);
async function configure(page, o) {
  if (!await clickFirst([settingsButton(page)], 8e3)) throw new Error("Không tìm thấy nút cài đặt tạo (model / tỉ lệ) trong Flow");
  await sleep$1(800);
  await checkRadio(page, /video/i, "Video", true);
  const frames = o.input === "frames";
  await checkRadio(page, frames ? /khung hình|frames?/i : /thành phần|ingredients?/i, frames ? "Khung hình" : "Thành phần", o.input !== "text");
  await checkRadio(page, o.aspect === "9:16" ? /9:16/ : /16:9/, o.aspect === "9:16" ? "9:16" : "16:9", false);
  const want = flowModel();
  const modelBtn = page.getByRole("button", { name: /chọn nhóm mô hình|select model|model/i }).or(page.locator("button", { hasText: /arrow_drop_down/ }));
  if (await visible(modelBtn, 2500)) {
    const cur = await modelBtn.first().textContent() ?? "";
    if (!cur.includes(want)) {
      await modelBtn.first().click();
      await sleep$1(700);
      const item = page.getByRole("menuitem").filter({ hasText: want });
      if (!await visible(item, 3e3)) throw new Error(`Flow không có model "${want}" – chọn model khác ở Cài đặt › Google Flow`);
      await item.first().click();
      await sleep$1(700);
    }
  } else throw new Error("Không tìm thấy nút chọn model trong Flow");
  await checkRadio(page, /^\s*720p\s*$/i, "720p", false);
  await checkRadio(page, new RegExp(`^\\s*${flowSeconds(o.seconds)}\\s*(giây|s|sec|seconds?)\\s*$`, "i"), `${flowSeconds(o.seconds)} giây`, false);
  await checkRadio(page, /^\s*x1\s*$/, "x1", false);
  await page.keyboard.press("Escape").catch(() => void 0);
  await sleep$1(600);
  const summary = await settingsButton(page).first().textContent().catch(() => "") ?? "";
  if (!/video/i.test(summary)) throw new Error("Không chuyển được Flow sang chế độ Video");
}
async function acceptUploadConsent(page) {
  const dialog = page.getByRole("dialog").filter({ hasText: /quyền sử dụng hình ảnh|rights to use|image rights|các quyền cần thiết|necessary rights/i });
  const agree = dialog.getByRole("button", { name: /tôi đồng ý|i agree|^\s*agree\s*$/i });
  if (!await agree.first().isVisible().catch(() => false)) return false;
  await agree.first().click();
  await sleep$1(800);
  return true;
}
async function attachStartFrame(page, file2) {
  const name = `omnira-${Date.now().toString(36)}${node_path.extname(file2).toLowerCase() || ".png"}`;
  const tmp = node_path.join(os.tmpdir(), name);
  node_fs.copyFileSync(file2, tmp);
  try {
    const slot = page.getByRole("button", { name: /^\s*(bắt đầu|start|first frame)\s*$/i });
    if (!await clickFirst([slot], 6e3)) throw new Error('Không tìm thấy ô khung hình đầu ("Bắt đầu") trong Flow');
    await sleep$1(1200);
    const chooser = page.waitForEvent("filechooser", { timeout: 15e3 });
    if (!await clickFirst([page.getByRole("button", { name: /tải nội dung nghe nhìn lên|upload/i })], 6e3))
      throw new Error("Không tìm thấy nút tải ảnh lên trong Flow");
    await (await chooser).setFiles(tmp);
    const item = page.getByRole("option").filter({ hasText: name });
    const t0 = Date.now();
    for (; ; ) {
      await acceptUploadConsent(page);
      const txt2 = await item.first().textContent({ timeout: 1e3 }).catch(() => null) ?? "";
      if (txt2 && !/đang tải lên|uploading/i.test(txt2)) break;
      if (Date.now() - t0 > 9e4) throw new Error("Tải khung hình lên Flow quá lâu");
      await sleep$1(1e3);
    }
    await acceptUploadConsent(page);
    await item.first().click();
    await sleep$1(1200);
    await acceptUploadConsent(page);
    await clickFirst([page.getByRole("button", { name: /thêm vào câu lệnh|add to prompt/i })], 1500);
    await sleep$1(800);
    await acceptUploadConsent(page);
    if (await slot.first().isVisible().catch(() => false)) throw new Error("Flow chưa nhận khung hình đầu");
  } finally {
    node_fs.rmSync(tmp, { force: true });
  }
}
async function tiles(page) {
  return page.$$eval(
    "flow-grid-tile-container",
    (els) => (
      // Chạy trong trang (DOM) – main process không có kiểu DOM
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      els.map((e, i) => {
        const v = e.querySelector("video");
        const thumb = e.querySelector("img")?.getAttribute("src") || "";
        const id2 = e.querySelector("[data-media-id]")?.getAttribute("data-media-id") || thumb.match(/flow-content\.google\/(?:image|video)\/([0-9a-f-]{16,})/i)?.[1] || // hoặc link ảnh dạng flow.google.com/asb/<mã> (lấy 48 ký tự đầu của mã – đủ phân biệt, dùng được trong bộ chọn CSS)
        thumb.match(/\/asb\/([\w-]{20,})/)?.[1]?.slice(0, 48) || null;
        const src = v ? v.currentSrc || v.src || v.querySelector("source")?.src || "" : "";
        const isVideo = !!e.querySelector("flow-video-tile") || !!v;
        const icons = [...e.querySelectorAll("mat-icon")].map((m) => (m.textContent || "").trim());
        return {
          id: id2,
          key: id2 || src || `pending:${e.getAttribute("aria-label") || ""}#${i}`,
          done: isVideo && !!id2 && !!thumb && icons.includes("play_circle"),
          video: src || null,
          text: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300)
        };
      })
    )
  ).catch(() => []);
}
async function hoverVideoSrc(page, id2) {
  const tile = page.locator("flow-grid-tile-container", { has: page.locator(`img[src*="${id2}"], [data-media-id="${id2}"]`) }).first();
  if (!await tile.count()) return null;
  await tile.scrollIntoViewIfNeeded().catch(() => void 0);
  await tile.hover({ timeout: 5e3 }).catch(() => void 0);
  for (let i = 0; i < 20; i++) {
    const src = await tile.evaluate((e) => e.querySelector("video")?.currentSrc || e.querySelector("video")?.src || "").catch(() => "");
    if (src) {
      await page.mouse.move(0, 0).catch(() => void 0);
      return src;
    }
    await sleep$1(250);
  }
  return null;
}
const FAIL_TEXT = /generation failed|failed to generate|couldn'?t generate|something went wrong|violat|policy|unsafe|out of credits|not enough credits|không thể tạo|tạo không thành công|không thành công|thất bại|đã xảy ra lỗi|vi phạm|chính sách|không đủ tín dụng|hết tín dụng/i;
const TRANSIENT_TEXT = /hoạt động bất thường|unusual activity|chưa bị tính phí|(?:not|n'?t) been charged|something went wrong|đã xảy ra lỗi|try again|thử lại/i;
const FATAL_TEXT = /violat|policy|unsafe|out of credits|not enough credits|vi phạm|chính sách|không đủ tín dụng|hết tín dụng/i;
class FlowTransientError extends Error {
}
function flowFailure(text) {
  const msg = `Google Flow báo lỗi: ${text.slice(0, 200)}`;
  return TRANSIENT_TEXT.test(text) && !FATAL_TEXT.test(text) ? new FlowTransientError(msg) : new Error(msg);
}
const FLOW_RETRY_WAIT_MS = [2e4, 6e4];
let cooldownUntil = 0;
async function waitCooldown(signal, onStatus) {
  while (Date.now() < cooldownUntil) {
    if (signal.aborted) throw new DOMException("Đã hủy", "AbortError");
    onStatus?.(`Google Flow từ chối tạm thời – tạo lại sau ${Math.ceil((cooldownUntil - Date.now()) / 1e3)}s…`, 0);
    await sleep$1(Math.min(1e3, Math.max(50, cooldownUntil - Date.now())));
  }
}
async function withFlowRetry(what, signal, onStatus, run2, attemptTimeoutMs) {
  for (let i = 0; ; i++) {
    await waitCooldown(signal, onStatus);
    const attempt = attemptTimeoutMs ? AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]) : signal;
    try {
      return await run2(attempt);
    } catch (err) {
      if (signal.aborted) throw err;
      if (attempt.aborted) throw new Error(`Google Flow tạo ${what} quá lâu (>${Math.round((attemptTimeoutMs ?? 0) / 1e3)}s)`);
      if (!(err instanceof FlowTransientError)) throw err;
      if (i >= FLOW_RETRY_WAIT_MS.length)
        throw new FlowTransientError(`${err.message} – đã tạo lại ${i} lần vẫn lỗi (Google có thể đang tạm giới hạn tài khoản; thử lại sau ít phút hoặc giảm số luồng Flow)`);
      const wait = FLOW_RETRY_WAIT_MS[i];
      cooldownUntil = Math.max(cooldownUntil, Date.now() + wait);
      console.warn(`[flow] tạo ${what}: Flow từ chối tạm thời → tạo lại sau ${wait / 1e3}s (lần ${i + 2}/${FLOW_RETRY_WAIT_MS.length + 1})`, err.message.slice(0, 160));
    }
  }
}
async function saveDiagnostics(page, label) {
  try {
    const root2 = diagRoot();
    node_fs.mkdirSync(root2, { recursive: true });
    const old = node_fs.readdirSync(root2).sort();
    for (const d of old.slice(0, Math.max(0, old.length - 14))) node_fs.rmSync(node_path.join(root2, d), { recursive: true, force: true });
    const dir = node_path.join(root2, `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${label}`);
    node_fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: node_path.join(dir, "screen.png") }).catch(() => void 0);
    node_fs.writeFileSync(node_path.join(dir, "page.html"), await page.content().catch(() => ""));
    node_fs.writeFileSync(node_path.join(dir, "url.txt"), page.url());
    return dir;
  } catch {
    return null;
  }
}
async function download$2(page, src, dest) {
  let buf;
  if (/^https?:/i.test(src)) {
    const r = await page.context().request.get(src, { timeout: 18e4 });
    if (!r.ok()) throw new Error(`Tải video Flow lỗi HTTP ${r.status()}`);
    buf = await r.body();
  } else {
    const b642 = await page.evaluate(async (u) => {
      const blob = await (await fetch(u)).blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(s);
    }, src);
    buf = Buffer.from(b642, "base64");
  }
  if (buf.length < 2e4) throw new Error("File video Flow tải về quá nhỏ (có thể là ảnh xem trước)");
  node_fs.writeFileSync(dest, buf);
}
const projectBase = (url) => url.replace(/\/edit\/.*$/, "").replace(/[?#].*$/, "");
const isEditView = (page) => /\/edit\//.test(page.url());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const editMediaId = (url) => url.match(/\/edit\/([0-9a-f-]{36})/i)?.[1] ?? null;
const flowRefFile = (video) => `${video}.flow.json`;
function writeFlowRef(video, ref) {
  try {
    node_fs.writeFileSync(flowRefFile(video), JSON.stringify(ref));
  } catch {
  }
}
function readFlowRef(video) {
  try {
    const r = JSON.parse(node_fs.readFileSync(flowRefFile(video), "utf8"));
    return r.project && r.media && UUID.test(r.media) && /^https?:\/\/[^/]+\/.*project\//.test(r.project) ? { project: r.project, media: r.media } : null;
  } catch {
    return null;
  }
}
const slotPages = /* @__PURE__ */ new Map();
const slotConfig = /* @__PURE__ */ new Map();
async function videoSources(page) {
  return page.$$eval("video", (vs) => vs.map((v) => v.currentSrc || v.src || v.querySelector("source")?.src || "").filter(Boolean)).catch(() => []);
}
async function backToGrid(page, slot) {
  if (!isEditView(page)) return;
  const base = projectBase(page.url());
  await clickFirst([page.getByRole("button", { name: /quay lại|go back|^back/i }), iconButton(page, "arrow_back")], 2e3);
  for (let i = 0; i < 20 && isEditView(page); i++) await sleep$1(250);
  if (isEditView(page)) {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 6e4 });
    slotConfig.delete(slot);
  }
}
const agentToggle = (page) => page.locator("button[aria-pressed]").filter({ hasText: /^\s*(tác nhân|agent)\s*$/i });
const agentPanelClose = (page) => page.locator("flow-agent-panel").getByRole("button", { name: /^(đóng|close)$/i });
async function creationBar(page, timeout) {
  const until = Date.now() + timeout;
  let tries = 0;
  while (Date.now() < until) {
    if (await settingsButton(page).first().isVisible().catch(() => false)) return true;
    if (tries < 3) {
      const toggle = agentToggle(page).first();
      if (await toggle.isVisible().catch(() => false) && await toggle.getAttribute("aria-pressed").catch(() => null) === "true") {
        tries++;
        await toggle.click().catch(() => void 0);
        await sleep$1(800);
        continue;
      }
      const close = agentPanelClose(page).first();
      if (await close.isVisible().catch(() => false)) {
        tries++;
        await close.click().catch(() => void 0);
        await sleep$1(800);
        continue;
      }
    }
    await sleep$1(500);
  }
  return false;
}
async function openProject(page, slot, onStatus) {
  const urls = getSetting$1("flow.projectUrls", []);
  const saved = urls[slot] ?? (slot === 0 ? getSetting$1("flow.projectUrl", null) : null);
  if (saved) {
    if (projectBase(page.url()) === projectBase(saved)) await backToGrid(page, slot);
    else {
      onStatus("Google Flow: mở dự án…");
      await page.goto(projectBase(saved), { waitUntil: "domcontentloaded", timeout: 6e4 });
      slotConfig.delete(slot);
    }
    if (isEditView(page)) await backToGrid(page, slot);
    if (/\/project\//.test(page.url()) && !isEditView(page) && await creationBar(page, 2e4)) return;
  }
  onStatus("Google Flow: tạo dự án mới…");
  slotConfig.delete(slot);
  await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 6e4 });
  await visible(newProjectButton(page), 15e3);
  const login = await readLogin(page);
  if (!login.loggedIn) {
    putSetting$2("flow.login", login);
    throw new Error('Chưa đăng nhập Google Flow – vào Cài đặt › Google Flow, bấm "Mở Chrome để đăng nhập"');
  }
  if (!await clickFirst([newProjectButton(page)], 15e3)) throw new Error('Không tìm thấy nút "Dự án mới" trong Flow');
  if (!await creationBar(page, 3e4)) throw new Error("Không tìm thấy ô tạo video trong dự án Flow mới");
  if (/\/project\//.test(page.url())) {
    const next = [...getSetting$1("flow.projectUrls", [])];
    next[slot] = projectBase(page.url());
    putSetting$2("flow.projectUrls", next);
  }
}
function sampleFramePng() {
  const f = node_path.join(os.tmpdir(), "omnira-flow-sample.png");
  if (!node_fs.existsSync(f)) node_fs.writeFileSync(f, Buffer.from(SAMPLE_FRAME_B64, "base64"));
  return f;
}
const SAMPLE_FRAME_B64 = "iVBORw0KGgoAAAANSUhEUgAAAoAAAAFoCAIAAABIUN0GAAAACXBIWXMAAAABAAAAAQBPJcTWAAAFlklEQVR4nO3VMQ0AIQDAQEhQhAYs4N/Ku6DD3yno1rnPHQDAW6sOAIA/MmAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQOADDxEGaSzMxjAAAAAASUVORK5CYII=";
let running$3 = 0;
const busySlots = /* @__PURE__ */ new Set();
const waiting = [];
async function acquire(signal) {
  while (busySlots.size >= flowConcurrency())
    await new Promise((ok, fail2) => {
      const go = () => (signal.removeEventListener("abort", stop), ok());
      const stop = () => {
        const i = waiting.indexOf(go);
        if (i >= 0) waiting.splice(i, 1);
        fail2(new DOMException("Đã hủy", "AbortError"));
      };
      waiting.push(go);
      signal.addEventListener("abort", stop, { once: true });
    });
  let slot = 0;
  while (busySlots.has(slot)) slot++;
  busySlots.add(slot);
  running$3++;
  return {
    slot,
    release: () => {
      busySlots.delete(slot);
      running$3--;
      waiting.shift()?.();
    }
  };
}
async function flowGenerate(o) {
  if (o.dryRun) return generateVideoOnce(o);
  return withFlowRetry("video", o.signal, o.onStatus, (signal) => generateVideoOnce({ ...o, signal }));
}
function requireFlowFeature() {
  if (!hasFeature("FLOW")) throw new ApiError("FEATURE", featureLockedMessage("FLOW"));
}
async function generateVideoOnce(o) {
  requireFlowFeature();
  const refs = o.start ? [] : (o.refs ?? []).filter((f) => node_fs.existsSync(f)).slice(0, 3);
  const input = o.start ? "frames" : refs.length ? "ingredients" : "text";
  o.onStatus?.("Google Flow: đang chờ lượt…", 0);
  const { slot, release } = await acquire(o.signal);
  let page = null;
  let broken = false;
  try {
    const ctx = context(await ensureChrome());
    const kept = slotPages.get(slot);
    page = kept && !kept.isClosed() && kept.context() === ctx ? kept : await ctx.newPage();
    if (page !== kept) slotConfig.delete(slot);
    slotPages.set(slot, page);
    const p = page;
    const abort = () => {
      broken = true;
      void p.close().catch(() => void 0);
    };
    o.signal.addEventListener("abort", abort, { once: true });
    try {
      if (flowHidden()) await placeWindows(true);
      await openProject(p, slot, (t2) => o.onStatus?.(t2, 0));
      const want = `${o.aspect}|${input}|${flowModel()}`;
      if (slotConfig.get(slot) !== want) {
        o.onStatus?.("Google Flow: chọn chế độ Video & model…", 0);
        await configure(p, { aspect: o.aspect, input, seconds: o.seconds ?? 8 });
        slotConfig.set(slot, want);
      }
      if (o.start) {
        o.onStatus?.("Google Flow: tải khung hình đầu…", 0);
        await attachStartFrame(p, o.start);
      } else if (refs.length) {
        o.onStatus?.(`Google Flow: tải ${refs.length} ảnh tham chiếu…`, 0);
        await attachRefs(p, refs);
      }
      const box = promptCandidates(p).last();
      await box.click();
      await p.keyboard.press("Control+A").catch(() => void 0);
      await p.keyboard.press("Delete").catch(() => void 0);
      await box.fill(o.prompt);
      if (o.dryRun) {
        if (!await visible(sendButton(p), 3e3)) throw new Error('Không tìm thấy nút "Bắt đầu tạo" trong Flow');
        const dir = await saveDiagnostics(p, "kiem-tra-ok");
        await box.click().catch(() => void 0);
        await p.keyboard.press("Control+A").catch(() => void 0);
        await p.keyboard.press("Delete").catch(() => void 0);
        return dir;
      }
      for (let i = 0; i < 16; i++) {
        const top = (await tiles(p)).slice(0, TOP_TILES * 2);
        if (top.every((t2) => t2.id || FAIL_TEXT.test(t2.text))) break;
        await sleep$1(500);
      }
      const known = (ts2) => ts2.forEach((t2) => (before.add(t2.key), t2.id && beforeIds.add(t2.id)));
      const before = /* @__PURE__ */ new Set();
      const beforeIds = /* @__PURE__ */ new Set();
      known((await tiles(p)).filter((t2) => !t2.key.startsWith("pending:")));
      const beforeVideos = new Set(await videoSources(p));
      const isNew = (t2) => !before.has(t2.key) && !(t2.id && beforeIds.has(t2.id));
      if (!await clickFirst([sendButton(p)], 5e3)) await box.press("Enter");
      const t0 = Date.now();
      let src = null;
      let media = null;
      let started2 = false;
      while (!src) {
        if (o.signal.aborted) throw new DOMException("Đã hủy", "AbortError");
        const sec = Math.round((Date.now() - t0) / 1e3);
        if (Date.now() - t0 > GEN_TIMEOUT_MS) throw new Error("Google Flow tạo video quá lâu (>10 phút)");
        if (isEditView(p)) {
          src = (await videoSources(p)).find((s) => !beforeVideos.has(s)) ?? null;
          media = editMediaId(p.url());
        }
        if (src) break;
        const all = await tiles(p);
        known(all.slice(TOP_TILES).filter((t2) => !t2.key.startsWith("pending:")));
        const fresh = all.slice(0, TOP_TILES).filter(isNew);
        const failed = fresh.find((t2) => FAIL_TEXT.test(t2.text));
        if (failed) throw flowFailure(failed.text);
        if (fresh.some((t2) => !t2.done)) started2 = true;
        if (started2) {
          const withVideo = fresh.find((t2) => t2.done && t2.video && !beforeVideos.has(t2.video));
          src = withVideo?.video ?? null;
          const ready = withVideo ?? fresh.find((t2) => t2.done && t2.id);
          if (!src && ready?.id) src = await hoverVideoSrc(p, ready.id);
          media = ready?.id && UUID.test(ready.id) ? ready.id : null;
          if (src) break;
        } else
          known(fresh.filter((t2) => t2.done));
        if (sec > 90 && !started2 && !isEditView(p)) throw new Error("Flow không bắt đầu tạo video (không thấy kết quả mới sau khi gửi)");
        const pct = fresh.map((t2) => t2.text.match(/\b(\d{1,3})\s?%/)?.[1]).find(Boolean);
        o.onStatus?.(`Google Flow đang tạo video… ${pct ? `${pct}% · ` : ""}${sec}s`, sec);
        await sleep$1(1500);
      }
      o.onStatus?.("Google Flow: tải video về máy…", Math.round((Date.now() - t0) / 1e3));
      await download$2(p, src, o.dest);
      if (media) writeFlowRef(o.dest, { project: projectBase(p.url()), media });
      await backToGrid(p, slot).catch(() => broken = true);
      if (!broken) await refreshCredits(p);
      return null;
    } finally {
      o.signal.removeEventListener("abort", abort);
    }
  } catch (err) {
    broken = true;
    if (o.signal.aborted || err instanceof DOMException && err.name === "AbortError") throw new DOMException("Đã hủy", "AbortError");
    const dir = page && !page.isClosed() ? await saveDiagnostics(page, "generate") : null;
    const msg = err instanceof Error ? err.message : String(err);
    const Err = err instanceof FlowTransientError ? FlowTransientError : Error;
    throw new Err(dir ? `${msg} (ảnh chụp chẩn đoán: ${dir})` : msg);
  } finally {
    if (broken) {
      slotPages.delete(slot);
      slotConfig.delete(slot);
      await page?.close().catch(() => void 0);
    }
    release();
  }
}
const UPSCALE_TIMEOUT_MS = 15 * 6e4;
async function flowUpscale(o) {
  requireFlowFeature();
  if (!loginState().loggedIn) throw new Error("Chưa đăng nhập Google Flow – vào Cài đặt › Google Flow để đăng nhập");
  const label = o.quality === "4k" ? "4K" : "1080p";
  o.onStatus?.("Google Flow: đang chờ lượt…");
  const { slot, release } = await acquire(o.signal);
  let page = null;
  let broken = false;
  try {
    const ctx = context(await ensureChrome());
    const kept = slotPages.get(slot);
    page = kept && !kept.isClosed() && kept.context() === ctx ? kept : await ctx.newPage();
    slotPages.set(slot, page);
    slotConfig.delete(slot);
    const p = page;
    const abort = () => {
      broken = true;
      void p.close().catch(() => void 0);
    };
    o.signal.addEventListener("abort", abort, { once: true });
    try {
      if (flowHidden()) await placeWindows(true);
      o.onStatus?.("Google Flow: mở video…");
      await p.goto(`${o.ref.project}/edit/${o.ref.media}`, { waitUntil: "domcontentloaded", timeout: 6e4 });
      const dlButton = p.getByRole("button", { name: /tải nội dung nghe nhìn xuống|^\s*download/i }).or(iconButton(p, "download"));
      if (!await visible(dlButton, 3e4)) {
        const login = await readLogin(p);
        if (!login.loggedIn) {
          putSetting$2("flow.login", login);
          throw new Error("Phiên Google Flow đã hết – đăng nhập lại ở Cài đặt › Google Flow");
        }
        throw new Error('Không mở được video trong Google Flow (video có thể đã bị xóa khỏi dự án Flow) – dùng cách "Trên máy"');
      }
      await dlButton.first().click();
      await sleep$1(900);
      const item = p.getByRole("menuitem").filter({ hasText: o.quality === "4k" ? /\b4k\b|2160/i : /1080/ });
      if (!await visible(item, 5e3) || await item.first().getAttribute("aria-disabled") === "true") {
        await p.keyboard.press("Escape").catch(() => void 0);
        throw new Error(`Google Flow không có lựa chọn nâng cấp ${label} cho video này${o.quality === "4k" ? " (4K cần gói Google AI hỗ trợ)" : ""}`);
      }
      const download2 = p.waitForEvent("download", { timeout: UPSCALE_TIMEOUT_MS });
      download2.catch(() => void 0);
      await item.first().click();
      await sleep$1(1200);
      const confirm = p.getByRole("dialog").getByRole("button", { name: /nâng cấp|upscale|tiếp tục|continue|xác nhận|confirm|đồng ý|agree/i });
      if (await visible(confirm, 2500)) await confirm.first().click();
      const t0 = Date.now();
      let done = false;
      void download2.then(() => done = true).catch(() => done = true);
      while (!done) {
        if (o.signal.aborted) throw new DOMException("Đã hủy", "AbortError");
        const sec = Math.round((Date.now() - t0) / 1e3);
        const failed = await p.getByRole("alert").or(p.locator('[role="status"]')).filter({ hasText: FAIL_TEXT }).first().textContent({ timeout: 500 }).catch(() => null);
        if (failed) throw new Error(`Google Flow báo lỗi: ${failed.trim().slice(0, 200)}`);
        o.onStatus?.(`Google Flow đang nâng cấp ${label}… ${sec}s`);
        await sleep$1(2e3);
      }
      const d = await download2.catch((e) => {
        throw new Error(`Google Flow nâng cấp ${label} quá lâu hoặc không tải được (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
      });
      o.onStatus?.("Google Flow: lưu video về máy…");
      await d.saveAs(o.dest);
      if (!node_fs.existsSync(o.dest) || node_fs.statSync(o.dest).size < 2e4) throw new Error("File nâng cấp tải về quá nhỏ");
      writeFlowRef(o.dest, o.ref);
      await refreshCredits(p);
    } finally {
      o.signal.removeEventListener("abort", abort);
    }
  } catch (err) {
    broken = true;
    if (o.signal.aborted || err instanceof DOMException && err.name === "AbortError") throw new DOMException("Đã hủy", "AbortError");
    const dir = page && !page.isClosed() ? await saveDiagnostics(page, "upscale") : null;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(dir ? `${msg} (ảnh chụp chẩn đoán: ${dir})` : msg);
  } finally {
    if (broken) {
      slotPages.delete(slot);
      slotConfig.delete(slot);
      await page?.close().catch(() => void 0);
    }
    release();
  }
}
const flowImagesEnabled = () => getSetting$1("flow.images", true) !== false;
const setFlowImages = (on) => putSetting$2("flow.images", on);
const flowImagesReady = () => flowImagesEnabled() && loginState().loggedIn;
async function configureImage(page, aspect) {
  if (!await clickFirst([settingsButton(page)], 8e3)) throw new Error("Không tìm thấy nút cài đặt tạo trong Flow");
  await sleep$1(800);
  await checkRadio(page, /hình ảnh|image/i, "Hình ảnh", true);
  await checkRadio(page, new RegExp(`^\\s*(crop_\\w+\\s*)?${aspect.replace(":", "\\:")}\\s*$`), aspect, false);
  const modelBtn = page.getByRole("button", { name: /chọn nhóm mô hình|select model|model/i }).or(page.locator("button", { hasText: /arrow_drop_down/ }));
  if (await visible(modelBtn, 2500)) {
    const cur = await modelBtn.first().textContent() ?? "";
    if (!/nano banana/i.test(cur)) {
      await modelBtn.first().click();
      await sleep$1(700);
      const item = page.getByRole("menuitem").filter({ hasText: /nano banana/i });
      if (!await visible(item, 3e3)) throw new Error("Flow không có model Nano Banana");
      await item.first().click();
      await sleep$1(700);
    }
  }
  await checkRadio(page, /^\s*x1\s*$/, "x1", false);
  await page.keyboard.press("Escape").catch(() => void 0);
  await sleep$1(600);
  const summary = await settingsButton(page).first().textContent().catch(() => "") ?? "";
  if (/video/i.test(summary)) throw new Error("Không chuyển được Flow sang chế độ Hình ảnh");
}
async function uploadAndPick(page, file2, what) {
  const name = `omnira-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${node_path.extname(file2).toLowerCase() || ".png"}`;
  const tmp = node_path.join(os.tmpdir(), name);
  node_fs.copyFileSync(file2, tmp);
  try {
    const chooser = page.waitForEvent("filechooser", { timeout: 15e3 });
    if (!await clickFirst([page.getByRole("button", { name: /tải nội dung nghe nhìn lên|upload/i })], 6e3)) throw new Error(`Không tìm thấy nút tải ${what} lên trong Flow`);
    await (await chooser).setFiles(tmp);
    const item = page.getByRole("option").filter({ hasText: name });
    const t0 = Date.now();
    for (; ; ) {
      await acceptUploadConsent(page);
      const txt2 = await item.first().textContent({ timeout: 1e3 }).catch(() => null) ?? "";
      if (txt2 && !/đang tải lên|uploading/i.test(txt2)) break;
      if (Date.now() - t0 > 9e4) throw new Error(`Tải ${what} lên Flow quá lâu`);
      await sleep$1(700);
    }
    await acceptUploadConsent(page);
    await item.first().click();
    await sleep$1(900);
    await acceptUploadConsent(page);
    await clickFirst([page.getByRole("button", { name: /thêm vào câu lệnh|add to prompt/i })], 1200);
    await sleep$1(600);
    await acceptUploadConsent(page);
  } finally {
    node_fs.rmSync(tmp, { force: true });
  }
}
async function attachRefs(page, refs) {
  for (const f of refs) {
    const add = page.getByRole("button", { name: /thêm thành phần vào ô nhập câu lệnh|add ingredient|add to prompt/i });
    if (!await clickFirst([add], 5e3)) throw new Error("Không tìm thấy nút thêm ảnh tham chiếu trong Flow");
    await sleep$1(900);
    await uploadAndPick(page, f, "ảnh tham chiếu");
    if (await page.getByRole("button", { name: /tải nội dung nghe nhìn lên|upload/i }).first().isVisible().catch(() => false)) await page.keyboard.press("Escape");
  }
}
async function gridImages(page) {
  return page.$$eval(
    "flow-grid-tile-container",
    (els) => els.map((e) => {
      const img = e.querySelector("flow-image-tile img[data-media-id]");
      return {
        id: img?.getAttribute("data-media-id") || "",
        title: (e.getAttribute("aria-label") || "") + " " + (e.querySelector(".footer-title")?.textContent || ""),
        src: img?.currentSrc || img?.getAttribute("src") || "",
        loaded: !!img && img.complete && img.naturalWidth > 0
      };
    }).filter((t2) => t2.id)
  ).catch(() => []);
}
async function flowGenerateImage(o) {
  const { attemptTimeoutMs, ...rest } = o;
  return withFlowRetry("ảnh", o.signal, o.onStatus, (signal) => generateImageOnce({ ...rest, signal }), attemptTimeoutMs);
}
async function generateImageOnce(o) {
  const aspect = o.aspect === "9:16" || o.aspect === "1:1" || o.aspect === "3:4" ? o.aspect : "16:9";
  const refs = (o.refs ?? []).filter((f) => node_fs.existsSync(f)).slice(0, 3);
  requireFlowFeature();
  o.onStatus?.("Google Flow: đang chờ lượt…", 0);
  const { slot, release } = await acquire(o.signal);
  let page = null;
  let broken = false;
  try {
    const ctx = context(await ensureChrome());
    const kept = slotPages.get(slot);
    page = kept && !kept.isClosed() && kept.context() === ctx ? kept : await ctx.newPage();
    if (page !== kept) slotConfig.delete(slot);
    slotPages.set(slot, page);
    const p = page;
    const abort = () => {
      broken = true;
      void p.close().catch(() => void 0);
    };
    o.signal.addEventListener("abort", abort, { once: true });
    try {
      if (flowHidden()) await placeWindows(true);
      await openProject(p, slot, (t2) => o.onStatus?.(t2, 0));
      const want = `image|${aspect}`;
      if (slotConfig.get(slot) !== want) {
        o.onStatus?.("Google Flow: chọn chế độ Hình ảnh (Nano Banana)…", 0);
        await configureImage(p, aspect);
        slotConfig.set(slot, want);
      }
      if (refs.length) {
        o.onStatus?.(`Google Flow: tải ${refs.length} ảnh tham chiếu…`, 0);
        await attachRefs(p, refs);
      }
      const box = promptCandidates(p).last();
      await box.click();
      await p.keyboard.press("Control+A").catch(() => void 0);
      await p.keyboard.press("Delete").catch(() => void 0);
      await box.fill(o.prompt);
      const seen = new Set((await gridImages(p)).map((t2) => t2.id));
      const beforeFails = (await tiles(p)).filter((x) => FAIL_TEXT.test(x.text)).length;
      if (!await clickFirst([sendButton(p)], 5e3)) await box.press("Enter");
      const t0 = Date.now();
      let src = null;
      while (!src) {
        if (o.signal.aborted) throw new DOMException("Đã hủy", "AbortError");
        const sec = Math.round((Date.now() - t0) / 1e3);
        if (Date.now() - t0 > 5 * 6e4) throw new Error("Google Flow tạo ảnh quá lâu (>5 phút)");
        if (isEditView(p)) {
          await backToGrid(p, slot);
          continue;
        }
        const failed = (await tiles(p)).filter((x) => FAIL_TEXT.test(x.text));
        if (failed.length > beforeFails) throw flowFailure(failed[0].text);
        const grid = await gridImages(p);
        const fresh = grid.slice(0, 6).find((t2) => !seen.has(t2.id) && !/omnira-/i.test(t2.title) && t2.loaded && t2.src);
        if (fresh) {
          src = fresh.src;
          break;
        }
        for (const t2 of grid.slice(6)) seen.add(t2.id);
        o.onStatus?.(`Google Flow đang tạo ảnh… ${sec}s`, sec);
        await sleep$1(1e3);
      }
      o.onStatus?.("Google Flow: tải ảnh về máy…", Math.round((Date.now() - t0) / 1e3));
      const r = await p.context().request.get(src, { timeout: 12e4 });
      if (!r.ok()) throw new Error(`Tải ảnh Flow lỗi HTTP ${r.status()}`);
      const type = r.headers()["content-type"] ?? "";
      const body = await r.body();
      if (body.length < 5e3) throw new Error("Ảnh Flow tải về quá nhỏ");
      let file2;
      if (/webp/.test(type)) {
        const tmp = `${o.destBase}.webp`;
        node_fs.writeFileSync(tmp, body);
        file2 = `${o.destBase}.jpg`;
        try {
          node_child_process.execFileSync(ffmpegPath(), ["-y", "-loglevel", "error", "-i", tmp, "-q:v", "2", file2], { windowsHide: true });
          node_fs.rmSync(tmp, { force: true });
        } catch {
          file2 = tmp;
        }
      } else {
        file2 = `${o.destBase}${/png/.test(type) ? ".png" : ".jpg"}`;
        node_fs.writeFileSync(file2, body);
      }
      await backToGrid(p, slot).catch(() => broken = true);
      return file2;
    } finally {
      o.signal.removeEventListener("abort", abort);
    }
  } catch (err) {
    broken = true;
    if (o.signal.aborted || err instanceof DOMException && err.name === "AbortError") throw new DOMException("Đã hủy", "AbortError");
    const dir = page && !page.isClosed() ? await saveDiagnostics(page, "image") : null;
    const msg = err instanceof Error ? err.message : String(err);
    const Err = err instanceof FlowTransientError ? FlowTransientError : Error;
    throw new Err(dir ? `${msg} (ảnh chụp chẩn đoán: ${dir})` : msg);
  } finally {
    if (broken) {
      slotPages.delete(slot);
      slotConfig.delete(slot);
      await page?.close().catch(() => void 0);
    }
    release();
  }
}
const framing$1 = (a) => a === "16:9" ? "Horizontal 16:9" : a === "1:1" ? "Square 1:1" : "Vertical 9:16";
const aspectKey = (a) => a === "9:16" ? [] : [a];
const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const hasProvider = isReady;
const veoAvailable = () => veoSource() === "flow" ? flowReady() : isReady("google_veo");
const FLOW_VEO_MODEL = "flow-veo";
const flowCacheModel = () => flowModel().startsWith("Veo") ? FLOW_VEO_MODEL : `flow-${flowModel().toLowerCase().replace(/[^a-z0-9.]+/g, "-")}`;
async function providerError(provider, res, hints = {}) {
  let detail2 = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const d = j.detail ?? j.message ?? j.error;
      detail2 = typeof d === "string" ? d : d && typeof d === "object" && "message" in d ? String(d.message) : d ? JSON.stringify(d) : "";
    } catch {
      detail2 = text;
    }
  } catch {
  }
  detail2 = detail2.replace(/\s+/g, " ").trim().slice(0, 200);
  const hint = hints[res.status];
  const base = errorFromStatus(res.status, "");
  return new AiError(base.kind, `${provider} HTTP ${res.status}${hint ? ` – ${hint}` : ""}${detail2 ? ` (${detail2})` : ""}`, res.status);
}
function cacheDir(sub) {
  const dir = node_path.join(mediaDir(), "cache", sub);
  node_fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const hashOf = (...parts) => node_crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
const refKey = (refs) => refs.length ? [`refs:${refs.map((f) => `${f.split(/[\\/]/).pop()}:${node_fs.existsSync(f) ? node_fs.statSync(f).size : 0}`).join(",")}`] : [];
const refMime = (f) => /\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg";
const FLOW_IMAGE_MODEL = "flow-nano-banana";
const flowImageCacheBase = (prompt, aspect, refs = []) => node_path.join(cacheDir("ai"), `flowimg-${hashOf(FLOW_IMAGE_MODEL, prompt, ...aspectKey(aspect), ...refKey(refs))}`);
const IMG_EXT = [".jpg", ".png", ".webp"];
const flowImageCached = (prompt, aspect, refs = []) => IMG_EXT.map((e) => flowImageCacheBase(prompt, aspect, refs) + e).find((f) => node_fs.existsSync(f)) ?? null;
async function flowImage(prompt, signal, aspect = "9:16", refs = []) {
  const hit = flowImageCached(prompt, aspect, refs);
  if (hit) return { file: hit, kind: "image", source: "nano_banana", credit: "AI: Nano Banana (Google Flow)" };
  const text = `${prompt}. ${framing$1(aspect)} photo, photorealistic, no text, no watermark.${refs.length ? " Keep the characters exactly as in the attached reference images (face, hair, outfit)." : ""}`;
  const file2 = await flowGenerateImage({
    prompt: text,
    aspect,
    refs: refs.slice(0, 3),
    destBase: flowImageCacheBase(prompt, aspect, refs),
    signal,
    attemptTimeoutMs: 1e5
  });
  return { file: file2, kind: "image", source: "nano_banana", credit: "AI: Nano Banana (Google Flow)" };
}
const falCacheFile = (model, prompt, aspect) => node_path.join(cacheDir("ai"), `fal-${hashOf(model, prompt, ...aspectKey(aspect))}.jpg`);
const googleImageCacheFiles = (model, prompt, aspect, refs = []) => {
  const jpg = node_path.join(cacheDir("ai"), `gimg-${hashOf(model, prompt, ...aspectKey(aspect), ...refKey(refs))}.jpg`);
  return [jpg, jpg.replace(/\.jpg$/, ".png")];
};
const veoAspectOf = (aspect) => aspect === "9:16" ? "9:16" : "16:9";
const veoSeconds = (sceneSec, refs = [], _frames = {}) => refs.length ? 8 : veoDuration(sceneSec);
const veoCacheFile = (model, prompt, sceneSec, aspect, refs = [], frames = {}) => node_path.join(
  cacheDir("ai"),
  `veo-${hashOf(
    model,
    prompt,
    String(veoSeconds(sceneSec, refs, frames)),
    ...aspectKey(veoAspectOf(aspect)),
    ...refKey(refs),
    ...frames.start ? [`start:${refKey([frames.start])[0]}`] : [],
    ...frames.start && frames.end ? [`end:${refKey([frames.end])[0]}`] : []
  )}.mp4`
);
const veoImage = (f, style) => {
  const data = node_fs.readFileSync(f).toString("base64");
  return style === "bytes" ? { bytesBase64Encoded: data, mimeType: refMime(f) } : { inlineData: { mimeType: refMime(f), data } };
};
const veoImageStyleOf = /* @__PURE__ */ new Map();
function recordUsage$1(providerId, workspaceId, model, feature, costUsd) {
  getDb().insert(aiUsage).values({ id: newId(), providerId, workspaceId, model, feature, costUsd, ok: true }).run();
}
async function download$1(url, dest, signal, headers) {
  const res = await fetch(url, { signal, headers, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Tải media lỗi HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  try {
    await promises.pipeline(node_stream.Readable.fromWeb(res.body), node_fs.createWriteStream(tmp), { signal });
    node_fs.renameSync(tmp, dest);
  } catch (err) {
    node_fs.rmSync(tmp, { force: true });
    throw err;
  }
}
function findInlineData(node, kind) {
  if (!node || typeof node !== "object") return null;
  const o = node;
  const mime = o.mime_type ?? o.mimeType;
  if (typeof o.data === "string" && o.data.length > 100 && (o.type === kind || mime?.startsWith(`${kind}/`))) return { data: o.data, mime: mime ?? `${kind}/*` };
  for (const v of Object.values(o)) {
    const found = Array.isArray(v) ? v.map((x) => findInlineData(x, kind)).find(Boolean) : findInlineData(v, kind);
    if (found) return found;
  }
  return null;
}
async function pexelsVideo(query, minDuration, exclude, signal, aspect = "9:16") {
  const { key: key2, baseUrl } = requireKey("pexels");
  const base = (baseUrl ?? "https://api.pexels.com").replace(/\/$/, "");
  const res = await fetch(
    `${base}/videos/search?query=${encodeURIComponent(query)}&orientation=${aspect === "16:9" ? "landscape" : aspect === "1:1" ? "square" : "portrait"}&size=medium&per_page=15`,
    { headers: { Authorization: key2 }, signal }
  );
  if (!res.ok) throw await providerError("Pexels", res, { 401: "key không hợp lệ", 429: "vượt giới hạn yêu cầu, thử lại sau" });
  const { videos } = await res.json();
  const fresh = videos.filter((v) => !exclude.has(`pexels-${v.id}`));
  const candidates = fresh.length ? fresh : videos;
  const pick2 = candidates.find((v) => v.duration >= minDuration) ?? [...candidates].sort((a, b) => b.duration - a.duration)[0];
  if (!pick2) return null;
  const wantLandscape = aspect === "16:9";
  const mp4 = pick2.video_files.filter((f) => f.file_type === "video/mp4" && f.width && f.height);
  const oriented = mp4.filter((f) => wantLandscape ? f.width >= f.height : f.height >= f.width);
  const size = (f) => wantLandscape ? f.width : f.height;
  const file2 = (oriented.length ? oriented : mp4).sort((a, b) => Math.abs(size(a) - 1920) - Math.abs(size(b) - 1920))[0];
  if (!file2) return null;
  const dest = node_path.join(cacheDir("stock"), `pexels-${pick2.id}-${file2.id}.mp4`);
  if (!node_fs.existsSync(dest)) await download$1(file2.link, dest, signal);
  return { file: dest, kind: "video", source: "stock", credit: "Kho video miễn phí", stockId: `pexels-${pick2.id}` };
}
async function pixabayVideo(query, minDuration, exclude, signal, aspect = "9:16") {
  const { key: key2, baseUrl } = requireKey("pixabay");
  const base = (baseUrl ?? "https://pixabay.com/api").replace(/\/$/, "");
  const res = await fetch(`${base}/videos/?key=${encodeURIComponent(key2)}&q=${encodeURIComponent(query.slice(0, 100))}&per_page=20&safesearch=true`, { signal });
  if (!res.ok) throw await providerError("Pixabay", res, { 400: "key không hợp lệ", 401: "key không hợp lệ", 429: "vượt giới hạn yêu cầu, thử lại sau" });
  const { hits } = await res.json();
  const fresh = hits.filter((h) => !exclude.has(`pixabay-${h.id}`));
  const usable = fresh.length ? fresh : hits;
  const portrait = (h) => {
    const v2 = h.videos.large ?? h.videos.medium;
    return !!v2 && (aspect === "16:9" ? v2.width > v2.height : v2.height > v2.width);
  };
  const pick2 = usable.find((h) => portrait(h) && h.duration >= minDuration) ?? usable.find(portrait) ?? usable.find((h) => h.duration >= minDuration) ?? usable[0];
  if (!pick2) return null;
  const v = [pick2.videos.large, pick2.videos.medium, pick2.videos.small].find((x) => x && x.url);
  if (!v) return null;
  const dest = node_path.join(cacheDir("stock"), `pixabay-${pick2.id}-${v.width}x${v.height}.mp4`);
  if (!node_fs.existsSync(dest)) await download$1(v.url, dest, signal);
  return { file: dest, kind: "video", source: "pixabay", credit: "Kho video miễn phí", stockId: `pixabay-${pick2.id}` };
}
async function falImage(prompt, workspaceId, signal, aspect = "9:16") {
  const { key: key2, baseUrl, row } = requireKey("fal");
  const model = row.defaultModel ?? "fal-ai/flux/schnell";
  const dest = falCacheFile(model, prompt, aspect);
  if (node_fs.existsSync(dest)) return { file: dest, kind: "image", source: "fal", credit: `AI: ${model}` };
  assertBudget(workspaceId);
  const base = (baseUrl ?? "https://fal.run").replace(/\/$/, "");
  const res = await fetch(`${base}/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key2}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `${prompt}, ${framing$1(aspect).toLowerCase()} composition, photorealistic, high detail`,
      image_size: aspect === "16:9" ? "landscape_16_9" : aspect === "1:1" ? "square_hd" : "portrait_16_9",
      num_images: 1,
      enable_safety_checker: true
    }),
    signal
  });
  if (!res.ok)
    throw await providerError("Fal.ai", res, {
      401: "key không hợp lệ",
      403: "tài khoản bị khóa hoặc hết số dư – kiểm tra tại fal.ai/dashboard/billing",
      429: "vượt giới hạn, thử lại sau"
    });
  const body = await res.json();
  const imageUrl = body.images?.[0]?.url;
  if (!imageUrl) throw new AiError("invalid_output", "Fal.ai không trả về ảnh (có thể bị bộ lọc an toàn chặn)");
  await download$1(imageUrl, dest, signal);
  recordUsage$1(row.id, workspaceId, model, "render.image", unitCost(model, 1));
  return { file: dest, kind: "image", source: "fal", credit: `AI: ${model}` };
}
async function googleImage(prompt, workspaceId, signal, aspect = "9:16", refs = []) {
  const { key: key2, baseUrl, row } = requireKey("google_image");
  const model = row.defaultModel ?? "gemini-3.1-flash-image";
  const [cachedJpg, cachedPng] = googleImageCacheFiles(model, prompt, aspect, refs);
  for (const f of [cachedJpg, cachedPng]) if (node_fs.existsSync(f)) return { file: f, kind: "image", source: "nano_banana", credit: `AI: ${model}` };
  assertBudget(workspaceId);
  const base = (baseUrl ?? GOOGLE_BASE).replace(/\/$/, "");
  const body = await requestJson(`${base}/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": key2, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          type: "text",
          text: `${prompt}. ${framing$1(aspect)} photo for a ${aspect === "9:16" ? "short social" : "social"} video, photorealistic, no text, no watermark.${refs.length ? " Keep the characters exactly as in the attached reference images (face, hair, outfit)." : ""}`
        },
        // Ảnh tham chiếu nhân vật (tối đa 3) – giữ khuôn mặt/trang phục đồng nhất giữa các cảnh
        ...refs.slice(0, 3).map((f) => ({ type: "image", data: node_fs.readFileSync(f).toString("base64"), mime_type: refMime(f) }))
      ],
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: aspect, image_size: "1K" }
    }),
    signal
  });
  const img = findInlineData(body, "image");
  if (!img) throw new AiError("invalid_output", "Nano Banana không trả về ảnh (có thể bị chặn bởi bộ lọc an toàn)");
  const dest = img.mime.includes("png") ? cachedPng : cachedJpg;
  node_fs.writeFileSync(dest, Buffer.from(img.data, "base64"));
  recordUsage$1(row.id, workspaceId, model, "render.image", unitCost(model, 1));
  return { file: dest, kind: "image", source: "nano_banana", credit: `AI: ${model}` };
}
function imageEngineIssue() {
  if (imageEngines().length) return null;
  const g = providerRow("google_image");
  const gemini = providerRow("gemini");
  const hasGeminiKey = !!gemini && !!readSecret("ai_provider", gemini.id, "api_key");
  if (hasGeminiKey && g && !g.enabled)
    return 'Ảnh AI Gemini (Nano Banana) đang TẮT – bật lại dòng "Google Gemini – Ảnh AI" trong Cài đặt (dùng chung key Gemini, không cần key riêng)';
  if (!hasGeminiKey) return "Chưa có key Gemini (hoặc Fal.ai) để tạo ảnh AI – nhập key Gemini trong Cài đặt, ảnh AI dùng chung key này";
  return 'Ảnh AI Gemini đang tắt hoặc chưa sẵn sàng – kiểm tra dòng "Google Gemini – Ảnh AI" trong Cài đặt';
}
const IMAGE_ENGINE_LABEL = { flow: "Google Flow (Nano Banana)", google_image: "Ảnh Gemini", fal: "Fal.ai" };
function imageEngines() {
  const pref = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "media.imageEngine")).get()?.value;
  const order = pref === "fal" ? ["fal", "google_image"] : ["google_image", "fal"];
  return [...flowImagesReady() ? ["flow"] : [], ...order.filter((p) => isReady(p))];
}
function imageBy(eng, prompt, workspaceId, signal, aspect = "9:16", refs = []) {
  return eng === "flow" ? flowImage(prompt, signal, aspect, refs) : eng === "google_image" ? googleImage(prompt, workspaceId, signal, aspect, refs) : falImage(prompt, workspaceId, signal, aspect);
}
const veoDuration = (sec) => sec <= 4 ? 4 : sec <= 6 ? 6 : 8;
async function veoClip(prompt, sceneSec, workspaceId, signal, onWait, aspect = "9:16", refs = [], frames = {}, destOverride) {
  if (veoSource() === "flow") {
    const start22 = frames.start && node_fs.existsSync(frames.start) ? frames.start : null;
    const flowRefs = start22 ? [] : refs.filter((f) => node_fs.existsSync(f)).slice(0, 3);
    const dest2 = destOverride ?? veoCacheFile(flowCacheModel(), prompt, sceneSec, aspect, flowRefs, { start: start22 });
    if (!destOverride && node_fs.existsSync(dest2)) return { file: dest2, kind: "video", source: "veo", credit: "AI: Veo (Google Flow)" };
    await flowGenerate({ prompt, aspect, seconds: sceneSec, start: start22, refs: flowRefs, dest: dest2, signal, onStatus: (t2, sec) => onWait?.(sec, t2) });
    return { file: dest2, kind: "video", source: "veo", credit: "AI: Veo (Google Flow)" };
  }
  const veoAspect = veoAspectOf(aspect);
  const { key: key2, baseUrl, row } = requireKey("google_veo");
  const model = row.defaultModel ?? "veo-3.1-lite-generate-preview";
  const start2 = frames.start && node_fs.existsSync(frames.start) ? frames.start : null;
  const end = start2 && frames.end && node_fs.existsSync(frames.end) ? frames.end : null;
  const duration = veoSeconds(sceneSec, refs, {});
  const dest = destOverride ?? veoCacheFile(model, prompt, sceneSec, aspect, refs, { start: start2, end });
  if (!destOverride && node_fs.existsSync(dest)) return { file: dest, kind: "video", source: "veo", credit: `AI: ${model}` };
  assertBudget(workspaceId);
  const base = (baseUrl ?? GOOGLE_BASE).replace(/\/$/, "");
  const headers = { "x-goog-api-key": key2, "Content-Type": "application/json" };
  const begin = (withRefs, style) => requestJson(`${base}/models/${encodeURIComponent(model)}:predictLongRunning`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      instances: [
        {
          prompt: `${prompt}. ${framing$1(veoAspect)} video, cinematic, smooth camera motion, no on-screen text.`,
          ...start2 ? { image: veoImage(start2, style) } : {},
          ...end ? { lastFrame: veoImage(end, style) } : {},
          ...withRefs ? { referenceImages: refs.slice(0, 3).map((f) => ({ image: veoImage(f, style), referenceType: "asset" })) } : {}
        }
      ],
      parameters: {
        aspectRatio: veoAspect,
        durationSeconds: withRefs ? 8 : duration,
        resolution: "720p",
        // Tạo từ ảnh (khung đầu / cuối / tham chiếu): API chỉ cho "allow_adult"
        ...start2 || withRefs ? { personGeneration: "allow_adult" } : {}
      }
    }),
    signal
  });
  const isFormatError = (err) => err instanceof AiError && err.kind === "bad_request" && /inlineData|bytesBase64Encoded/i.test(err.message);
  const attempt = async (withRefs) => {
    const first = veoImageStyleOf.get(model) ?? "inline";
    try {
      const r = await begin(withRefs, first);
      if (start2 || withRefs) veoImageStyleOf.set(model, first);
      return r;
    } catch (err) {
      if (!(start2 || withRefs) || !isFormatError(err)) throw err;
      const other = first === "inline" ? "bytes" : "inline";
      console.warn(`[veo] model ${model} không nhận ảnh dạng ${first} → thử dạng ${other}`);
      const r = await begin(withRefs, other);
      veoImageStyleOf.set(model, other);
      return r;
    }
  };
  let op;
  try {
    op = await attempt(refs.length > 0);
  } catch (err) {
    if (!refs.length || !(err instanceof AiError) || err.kind !== "bad_request") throw err;
    console.warn(`[veo] model ${model} không nhận ảnh tham chiếu (${err.message.slice(0, 120)}) → tạo không kèm ảnh tham chiếu`);
    op = await attempt(false);
  }
  const started2 = Date.now();
  for (; ; ) {
    if (signal.aborted) throw new Error("Đã hủy");
    if (Date.now() - started2 > 10 * 6e4) throw new AiError("timeout", "Veo chưa xong sau 10 phút");
    await new Promise((r) => setTimeout(r, 8e3));
    onWait?.(Math.round((Date.now() - started2) / 1e3));
    const st = await requestJson(`${base}/${op.name}`, { headers: { "x-goog-api-key": key2 }, signal });
    if (!st.done) continue;
    if (st.error) throw new AiError("bad_request", `Veo lỗi: ${st.error.message ?? "không rõ"}`);
    const gvr = st.response?.generateVideoResponse;
    const uri = gvr?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new AiError("refusal", `Veo không trả video${gvr?.raiMediaFilteredReasons?.length ? ` (bị lọc: ${gvr.raiMediaFilteredReasons.join("; ")})` : ""}`);
    const host = new URL(uri).host;
    const trusted = host.endsWith(".googleapis.com") || host === new URL(base).host;
    await download$1(uri, dest, signal, trusted ? { "x-goog-api-key": key2 } : void 0);
    break;
  }
  recordUsage$1(row.id, workspaceId, model, "render.video", unitCost(model, duration));
  return { file: dest, kind: "video", source: "veo", credit: `AI: ${model}` };
}
const YELLOW = "&H0000D4FF&";
function ts(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 36e4);
  const m = Math.floor(cs % 36e4 / 6e3);
  const s = Math.floor(cs % 6e3 / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}
const clean$2 = (s) => s.replace(/[{}]/g, "").replace(/\\/g, "/").replace(/\s+/g, " ").trim();
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const CJK_SPLIT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー][、。，！？；：…」』）》,.!?]*|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu;
const tokenize = (text) => clean$2(text).split(" ").filter(Boolean).flatMap((t2) => CJK.test(t2) ? t2.match(CJK_SPLIT) ?? [t2] : [t2]);
const joinWords = (raw, shown = raw) => shown.reduce((acc, w, i) => {
  if (i === 0) return w;
  const prev = raw[i - 1].slice(-1);
  const tight = CJK.test(prev) || /[、。，！？；：」』）》]/.test(prev) || CJK.test(raw[i][0]);
  return acc + (tight ? "" : " ") + w;
}, "");
function proportional(text, duration) {
  const words = tokenize(text);
  const total2 = words.reduce((a, w) => a + w.length + 1, 0) || 1;
  let t2 = 0.05;
  const usable = Math.max(0.3, duration - 0.1);
  return words.map((w) => {
    const d = (w.length + 1) / total2 * usable;
    const out = { text: w, start: t2, end: t2 + d };
    t2 += d;
    return out;
  });
}
function timings(scene) {
  const words = tokenize(scene.text);
  if (scene.words && scene.words.length === words.length) return scene.words.map((w, i) => ({ ...w, text: words[i] }));
  return proportional(scene.text, scene.audioDuration);
}
function chunks(words) {
  const out = [];
  let cur = [];
  let weight = 0;
  for (const w of words) {
    cur.push(w);
    weight += CJK.test(w.text) ? 5 / 12 : 1;
    if (weight >= 5 || /[.,!?;:…。，！？；：、]$/.test(w.text)) {
      out.push(cur);
      cur = [];
      weight = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}
const LOOKS = {
  "montserrat-kara-pop": {
    upper: true,
    size: [68, 72],
    marginPortrait: 0.16,
    primary: "&H00FFFFFF",
    outlineColour: "&H00000000",
    back: "&H96000000",
    borderStyle: 1,
    outline: 6,
    shadow: 3,
    active: `\\c${YELLOW}`
  },
  // Kiểu "Alex Hormozi": từ đang đọc xanh lá và phóng to nhẹ
  "hormozi-green": {
    upper: true,
    size: [68, 72],
    marginPortrait: 0.16,
    primary: "&H00FFFFFF",
    outlineColour: "&H00000000",
    back: "&H96000000",
    borderStyle: 1,
    outline: 7,
    shadow: 2,
    active: "\\c&H006BFF3B&\\fscx118\\fscy118"
  },
  // Từ đang đọc xanh neon, viền cùng màu được làm mờ → phát sáng
  "neon-glow": {
    upper: false,
    size: [64, 66],
    marginPortrait: 0.16,
    primary: "&H00FFFFFF",
    outlineColour: "&H00301010",
    back: "&H00000000",
    borderStyle: 1,
    outline: 4,
    shadow: 0,
    active: "\\c&H00FFE500&\\3c&H00FFE500&\\blur6"
  },
  "bold-outline": {
    upper: true,
    size: [66, 68],
    marginPortrait: 0.16,
    primary: "&H00FFFFFF",
    outlineColour: "&H00000000",
    back: "&H80000000",
    borderStyle: 1,
    outline: 8,
    shadow: 0,
    active: null
  },
  // Phụ đề phim: chữ vàng nhạt, viền mảnh, đặt thấp
  "movie-yellow": {
    upper: false,
    size: [54, 52],
    marginPortrait: 0.12,
    primary: "&H0060F0FF",
    outlineColour: "&H00000000",
    back: "&H80000000",
    borderStyle: 1,
    outline: 3,
    shadow: 2,
    active: null
  },
  "clean-white": {
    upper: false,
    size: [56, 56],
    marginPortrait: 0.14,
    primary: "&H00FFFFFF",
    outlineColour: "&H00000000",
    back: "&H80000000",
    borderStyle: 3,
    outline: 14,
    shadow: 0,
    active: null
  }
};
function buildAss(scenes, style, size = { w: 1080, h: 1920 }) {
  const look = LOOKS[style] ?? LOOKS["montserrat-kara-pop"];
  const portrait = size.h > size.w;
  const fontSize = portrait ? look.size[0] : look.size[1];
  const marginV = Math.round(size.h * (portrait ? look.marginPortrait : size.w === size.h ? 0.16 : 0.09));
  const marginH = Math.round(size.w * (portrait ? 0.075 : 0.08));
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${size.w}`,
    `PlayResY: ${size.h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Main,Montserrat Black,${fontSize},${look.primary},${look.primary},${look.outlineColour},${look.back},0,0,0,0,100,100,0,0,${look.borderStyle},${look.outline},${look.shadow},2,${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  const events = [];
  for (const scene of scenes) {
    const sceneEnd = scene.start + scene.duration;
    const groups = chunks(timings(scene));
    for (const [gi, group2] of groups.entries()) {
      const next = groups[gi + 1];
      const groupEnd = Math.min(sceneEnd, scene.start + group2[group2.length - 1].end + 0.35, next ? scene.start + next[0].start : Infinity);
      const words = group2.map((w) => look.upper ? w.text.toLocaleUpperCase("vi") : w.text);
      const active2 = look.active;
      if (!active2) {
        const start2 = scene.start + group2[0].start;
        if (groupEnd - start2 >= 0.02) events.push(`Dialogue: 0,${ts(start2)},${ts(groupEnd)},Main,,0,0,0,,${joinWords(words)}`);
        continue;
      }
      group2.forEach((w, i) => {
        const start2 = scene.start + w.start;
        const end = i < group2.length - 1 ? scene.start + group2[i + 1].start : groupEnd;
        if (end - start2 < 0.02) return;
        const text = joinWords(
          words,
          words.map((x, j) => j === i ? `{${active2}}${x}{\\r}` : x)
        );
        events.push(`Dialogue: 0,${ts(start2)},${ts(end)},Main,,0,0,0,,${text}`);
      });
    }
  }
  return [...header, ...events, ""].join("\n");
}
const ENGINE_SCRIPT = String.raw`import json, sys, os, traceback

proto = sys.stdout
sys.stdout = sys.stderr  # print() của thư viện không được lẫn vào kênh giao tiếp


def send(obj):
    proto.write(json.dumps(obj, ensure_ascii=False) + "\n")
    proto.flush()


def main():
    device, gpu = "cpu", None
    try:
        import torch
        if torch.cuda.is_available():
            device, gpu = "cuda", torch.cuda.get_device_name(0)
    except Exception:
        pass
    from vieneu import Vieneu
    tts = Vieneu(mode="v3turbo")
    send({"ready": True, "backend": getattr(tts, "backend", "?"), "device": device, "gpu": gpu})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = {}
        try:
            req = json.loads(line)
            op = req.get("op")
            if op == "voices":
                send({"id": req["id"], "ok": True, "voices": [[label, vid] for label, vid in tts.list_preset_voices()]})
            elif op == "synth":
                ref = req.get("ref")
                audio = tts.infer(req["text"], voice=None if ref else req.get("voice"), ref_audio=ref)
                tts.save(audio, req["out"])
                send({"id": req["id"], "ok": True, "seconds": round(len(audio) / tts.sample_rate, 3)})
            elif op == "ping":
                send({"id": req["id"], "ok": True})
            else:
                send({"id": req.get("id"), "ok": False, "error": "op không hợp lệ: %s" % op})
        except Exception as e:
            traceback.print_exc()
            send({"id": req.get("id"), "ok": False, "error": "%s: %s" % (type(e).__name__, e)})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        send({"fatal": "%s: %s" % (type(e).__name__, e)})
        sys.exit(1)
`;
const UV_URL = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip";
const TORCH = ["torch==2.8.0", "torchaudio==2.8.0"];
const TORCH_INDEX = "https://download.pytorch.org/whl/cu128";
const VIENEU = "vieneu==3.8.3";
const GPU_EXTRA = ["transformers==4.57.6"];
const VERSION = "VieNeu-TTS 3.8.3 · v3 Turbo";
const MIN_VRAM_MB = 3e3;
const IDLE_MS = 5 * 6e4;
const SIZE_GB = { cuda: { download: 4, disk: 7 }, cpu: { download: 1.5, disk: 3 } };
const root = () => node_path.join(electron.app.getPath("userData"), "local-tts");
const venvPython = () => node_path.join(root(), "venv", "Scripts", "python.exe");
const manifestFile = () => node_path.join(root(), "installed.json");
function manifest() {
  try {
    const m = JSON.parse(node_fs.readFileSync(manifestFile(), "utf8"));
    return node_fs.existsSync(venvPython()) ? m : null;
  } catch {
    return null;
  }
}
function env(offline) {
  return {
    ...process.env,
    HF_HOME: node_path.join(root(), "hf"),
    UV_PYTHON_INSTALL_DIR: node_path.join(root(), "python"),
    UV_CACHE_DIR: node_path.join(root(), "uv-cache"),
    // Windows: Python mặc định cp1252 → lỗi khi in tiếng Việt
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    // Cài xong thì model đã nằm sẵn trong hf/ – không gọi mạng khi chạy
    ...offline ? { HF_HUB_OFFLINE: "1" } : {}
  };
}
let gpuCache = null;
function nvidiaSmi() {
  const candidates = ["nvidia-smi", node_path.join(process.env.ProgramFiles ?? "C:\\Program Files", "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe")];
  const tryOne = (i) => i >= candidates.length ? Promise.resolve(null) : new Promise(
    (res) => node_child_process.execFile(
      candidates[i],
      ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
      { timeout: 8e3, windowsHide: true },
      (err, out) => err ? res(tryOne(i + 1)) : res(out)
    )
  );
  return tryOne(0);
}
async function detectGpu(force = false) {
  if (gpuCache && !force) return gpuCache.gpu;
  let gpu = null;
  if (process.platform === "win32") {
    const out = await nvidiaSmi();
    for (const line of out?.split(/\r?\n/) ?? []) {
      const [name, vram, driver] = line.split(",").map((s) => s.trim());
      const vramMb = Number(vram);
      if (!name || !Number.isFinite(vramMb)) continue;
      if (!gpu || vramMb > gpu.vramMb) gpu = { name, vramMb, driver: driver ?? "", driverOk: Number.parseFloat(driver ?? "0") >= 570 };
    }
  }
  gpuCache = { gpu };
  return gpu;
}
const gpuUsable = (gpu) => !!gpu && gpu.vramMb >= MIN_VRAM_MB && gpu.driverOk;
function diskFreeGb() {
  try {
    const s = node_fs.statfsSync(electron.app.getPath("userData"));
    return s.bavail * s.bsize / 1024 ** 3;
  } catch {
    return null;
  }
}
function assessHardware(gpu) {
  const list2 = os.cpus();
  const threads = list2.length;
  const ramGb = os.totalmem() / 1024 ** 3;
  const variant = gpuUsable(gpu) ? "cuda" : "cpu";
  const notes = [];
  let rating = variant === "cuda" ? "good" : "slow";
  if (gpu && gpuUsable(gpu)) notes.push(`GPU ${gpu.name} (${(gpu.vramMb / 1024).toFixed(0)} GB VRAM) – đọc nhanh hơn thời gian thực nhiều lần`);
  else if (gpu && gpu.vramMb < MIN_VRAM_MB) notes.push(`GPU ${gpu.name} chỉ có ${(gpu.vramMb / 1024).toFixed(1)} GB VRAM (cần từ 3 GB) → chạy bằng CPU`);
  else if (gpu) notes.push(`Driver NVIDIA ${gpu.driver} cũ (cần 570+) → chạy bằng CPU. Cập nhật driver rồi bấm "Dò lại" để dùng GPU`);
  else notes.push("Không có GPU rời NVIDIA → chạy bằng CPU: đọc ~1 giây audio mất ~1 giây, mỗi giọng clone lần đầu cần ~1 phút để phân tích");
  if (ramGb < 6) {
    rating = "poor";
    notes.push(`RAM ${ramGb.toFixed(0)} GB – nên có từ 8 GB (model chiếm ~1–2 GB khi chạy)`);
  } else if (ramGb < 8 && rating === "good") rating = "slow";
  if (threads < 4) {
    rating = "poor";
    notes.push(`CPU chỉ ${threads} luồng – nên có từ 4 luồng`);
  } else if (variant === "cpu" && threads < 8) notes.push(`CPU ${threads} luồng – video dài (nhiều cảnh) sẽ đọc lâu hơn`);
  const disk = diskFreeGb();
  if (disk != null && disk < SIZE_GB[variant].disk) notes.push(`Ổ đĩa còn ${disk.toFixed(1)} GB – cần trống ${SIZE_GB[variant].disk} GB để cài`);
  return {
    cpu: (list2[0]?.model ?? "CPU").replace(/\s+/g, " ").trim(),
    threads,
    ramGb: Math.round(ramGb * 10) / 10,
    diskFreeGb: disk == null ? null : Math.round(disk * 10) / 10,
    rating,
    notes,
    variant,
    downloadGb: SIZE_GB[variant].download
  };
}
const install = { running: false, stage: "", progress: 0, startedAt: null, error: null, log: [] };
let installAbort = null;
function log$1(line) {
  const s = line.trimEnd();
  if (!s) return;
  install.log.push(s.length > 300 ? `${s.slice(0, 300)}…` : s);
  if (install.log.length > 200) install.log.splice(0, install.log.length - 200);
}
function stage(name, progress2) {
  install.stage = name;
  install.progress = progress2;
  log$1(`── ${name}`);
}
function run(cmd, args, signal) {
  return new Promise((resolve, reject) => {
    const p = node_child_process.spawn(cmd, args, { cwd: root(), env: env(false), windowsHide: true });
    const tail = [];
    const onData = (b) => {
      for (const l of b.toString("utf8").split(/\r?\n|\r/)) {
        if (!l.trim()) continue;
        log$1(l);
        tail.push(l);
        if (tail.length > 8) tail.shift();
      }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    const onAbort = () => void p.kill();
    signal.addEventListener("abort", onAbort, { once: true });
    p.on("error", (e) => (signal.removeEventListener("abort", onAbort), reject(e)));
    p.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(new Error("Đã hủy"));
      else if (code === 0) resolve();
      else reject(new Error(`${cmd.split(/[\\/]/).pop()} thoát mã ${code}: ${tail.slice(-3).join(" | ")}`));
    });
  });
}
async function download(url, file2, signal, from, to) {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Tải ${url} lỗi HTTP ${res.status}`);
  const total2 = Number(res.headers.get("content-length")) || 0;
  let got = 0;
  const body = node_stream.Readable.fromWeb(res.body);
  body.on("data", (c) => {
    got += c.length;
    if (total2) install.progress = from + (to - from) * got / total2;
  });
  await promises.pipeline(body, node_fs.createWriteStream(file2));
}
function findFile(dir, name) {
  for (const e of node_fs.readdirSync(dir, { withFileTypes: true })) {
    const p = node_path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    }
  }
  return null;
}
function dirSize$1(dir) {
  let n = 0;
  if (!node_fs.existsSync(dir)) return 0;
  for (const e of node_fs.readdirSync(dir, { withFileTypes: true })) {
    const p = node_path.join(dir, e.name);
    try {
      n += e.isDirectory() ? dirSize$1(p) : node_fs.statSync(p).size;
    } catch {
    }
  }
  return n;
}
async function doInstall(variant, signal) {
  node_fs.mkdirSync(root(), { recursive: true });
  node_fs.rmSync(manifestFile(), { force: true });
  stage("Tải công cụ cài đặt (uv)", 0.01);
  const uvDir = node_path.join(root(), "uv");
  let uv = node_fs.existsSync(uvDir) ? findFile(uvDir, "uv.exe") : null;
  if (!uv) {
    node_fs.mkdirSync(uvDir, { recursive: true });
    const zip = node_path.join(uvDir, "uv.zip");
    await download(UV_URL, zip, signal, 0.01, 0.04);
    await run(node_path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", uvDir], signal);
    node_fs.rmSync(zip, { force: true });
    uv = findFile(uvDir, "uv.exe");
    if (!uv) throw new Error("Không tìm thấy uv.exe sau khi giải nén");
  }
  stage("Tải Python 3.11", 0.05);
  if (!node_fs.existsSync(venvPython())) {
    node_fs.rmSync(node_path.join(root(), "venv"), { recursive: true, force: true });
    await run(uv, ["venv", node_path.join(root(), "venv"), "--python", "3.11"], signal);
  }
  if (variant === "cuda") {
    stage("Tải PyTorch CUDA 12.8 (~2.5 GB – mất vài phút tùy mạng)", 0.12);
    await run(uv, ["pip", "install", "--python", venvPython(), ...TORCH, "--index-url", TORCH_INDEX], signal);
  }
  stage(variant === "cuda" ? "Cài VieNeu-TTS" : "Cài VieNeu-TTS (bản CPU)", variant === "cuda" ? 0.7 : 0.15);
  await run(uv, ["pip", "install", "--python", venvPython(), VIENEU, ...variant === "cuda" ? GPU_EXTRA : []], signal);
  stage("Tải model giọng & chạy thử (lần đầu ~1–2 phút)", 0.8);
  node_fs.writeFileSync(node_path.join(root(), "engine.py"), ENGINE_SCRIPT, "utf8");
  await stopEngine();
  signal.addEventListener("abort", () => void stopEngine(), { once: true });
  const eng = await startEngine(false);
  log$1(`Engine: ${eng.info.backend} trên ${eng.info.device}${eng.info.gpu ? ` (${eng.info.gpu})` : ""}`);
  if (variant === "cuda" && eng.info.device !== "cuda") log$1("⚠ PyTorch không dùng được GPU (driver cũ?) – engine chạy bằng CPU, vẫn dùng được nhưng chậm hơn");
  const voices = (await eng.request({ op: "voices" }, signal, 6e4)).voices;
  const testDir = node_path.join(root(), "test");
  node_fs.mkdirSync(testDir, { recursive: true });
  const sample = node_path.join(testDir, "preset.wav");
  install.progress = 0.88;
  await eng.request({ op: "synth", text: "Xin chào, đây là giọng đọc chạy trên máy của bạn.", voice: voices[0]?.[1], out: sample }, signal, 5 * 6e4);
  install.progress = 0.93;
  await eng.request({ op: "synth", text: "Thử clone giọng.", ref: sample, out: node_path.join(testDir, "clone.wav") }, signal, 5 * 6e4);
  await stopEngine();
  node_fs.rmSync(testDir, { recursive: true, force: true });
  stage("Dọn file tạm", 0.98);
  node_fs.rmSync(node_path.join(root(), "uv-cache"), { recursive: true, force: true });
  const m = { version: VERSION, variant, installedAt: Date.now(), sizeBytes: dirSize$1(root()), voices };
  node_fs.writeFileSync(manifestFile(), JSON.stringify(m, null, 2));
  stage("Đã cài xong", 1);
}
async function startInstall() {
  if (install.running) return;
  const s = await status();
  if (!s.eligible || !s.hardware) throw new Error(s.reason ?? "Máy không đủ điều kiện");
  const variant = s.hardware.variant;
  installAbort = new AbortController();
  Object.assign(install, { running: true, stage: "Bắt đầu", progress: 0, startedAt: Date.now(), error: null, log: [] });
  doInstall(variant, installAbort.signal).catch((e) => {
    install.error = installAbort?.signal.aborted ? "Đã hủy cài đặt" : e instanceof Error ? e.message : String(e);
    log$1(`✖ ${install.error}`);
    void stopEngine();
  }).finally(() => {
    install.running = false;
    installAbort = null;
  });
}
function cancelInstall() {
  installAbort?.abort();
}
async function uninstall() {
  if (install.running) throw new Error("Đang cài đặt – hủy cài trước");
  await stopEngine();
  node_fs.rmSync(root(), { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  Object.assign(install, { stage: "", progress: 0, startedAt: null, error: null, log: [] });
}
async function status(forceDetect = false) {
  const platformSupported = process.platform === "win32" && process.arch === "x64";
  const gpu = platformSupported ? await detectGpu(forceDetect) : null;
  const hardware = platformSupported ? assessHardware(gpu) : null;
  let reason = null;
  if (!platformSupported) reason = "Giọng local hiện chỉ hỗ trợ Windows 64-bit";
  else if (hardware?.diskFreeGb != null && hardware.diskFreeGb < SIZE_GB[hardware.variant].disk)
    reason = `Ổ đĩa không đủ chỗ: còn ${hardware.diskFreeGb} GB, cần trống ${SIZE_GB[hardware.variant].disk} GB`;
  const m = manifest();
  return {
    platformSupported,
    gpu,
    hardware,
    // Cấu hình yếu vẫn cho cài – giao diện hiện đánh giá & khuyến nghị
    eligible: platformSupported && reason == null,
    reason,
    installed: m ? { version: m.version, variant: m.variant ?? "cuda", installedAt: m.installedAt, sizeBytes: m.sizeBytes, voices: m.voices.length } : null,
    install: { ...install, log: install.log.slice(-60) },
    engine: { running: !!engine, device: engine?.info.device ?? null, gpu: engine?.info.gpu ?? null, backend: engine?.info.backend ?? null }
  };
}
class Engine {
  constructor(proc) {
    this.proc = proc;
    let onReady;
    let onFail;
    this.ready = new Promise((res, rej) => (onReady = res, onFail = rej));
    const startTimer = setTimeout(() => (onFail(new Error("Engine giọng local khởi động quá 5 phút")), proc.kill()), 5 * 6e4);
    proc.stdout.on("data", (b) => {
      this.buf += b.toString("utf8");
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.ready) {
          clearTimeout(startTimer);
          this.info = { backend: String(msg.backend), device: String(msg.device), gpu: msg.gpu ?? null };
          onReady();
        } else if (msg.fatal) {
          clearTimeout(startTimer);
          onFail(new Error(String(msg.fatal)));
        } else if (typeof msg.id === "number") {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.ok) p?.resolve(msg);
          else p?.reject(new Error(`Giọng local lỗi: ${String(msg.error)}`));
          this.touch();
        }
      }
    });
    proc.stderr.on("data", (b) => {
      for (const l of b.toString("utf8").split(/\r?\n/)) {
        if (!l.trim()) continue;
        this.stderr.push(l);
        if (this.stderr.length > 30) this.stderr.shift();
        if (install.running) log$1(l);
      }
    });
    proc.on("close", (code) => {
      clearTimeout(startTimer);
      if (this.idle) clearTimeout(this.idle);
      const err = new Error(`Engine giọng local đã dừng (mã ${code})${this.stderr.length ? `: ${this.stderr.slice(-3).join(" | ")}` : ""}`);
      onFail(err);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      if (engine === this) engine = null;
    });
    proc.on("error", (e) => onFail(e));
    proc.stdin.on("error", () => void 0);
  }
  info = { backend: "?", device: "?", gpu: null };
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  stderr = [];
  buf = "";
  idle = null;
  ready;
  /** Hẹn tắt sau IDLE_MS không dùng (trả VRAM/RAM) */
  touch() {
    if (this.idle) clearTimeout(this.idle);
    if (!this.pending.size) this.idle = setTimeout(() => void this.stop(), IDLE_MS);
  }
  async request(payload, signal, timeoutMs = 5 * 6e4) {
    await this.ready;
    if (this.idle) clearTimeout(this.idle);
    const id2 = this.nextId++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (e, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer2);
        signal?.removeEventListener("abort", onAbort);
        if (e) reject(e);
        else resolve(v);
      };
      const timer2 = setTimeout(() => finish(new Error("Giọng local quá thời gian chờ")), timeoutMs);
      const onAbort = () => finish(new Error("Đã hủy"));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id2, { resolve: (v) => finish(null, v), reject: (e) => finish(e) });
      this.proc.stdin.write(JSON.stringify({ id: id2, ...payload }) + "\n");
    });
  }
  stop() {
    return new Promise((res) => {
      if (this.proc.exitCode != null) return res();
      this.proc.once("close", () => res());
      this.proc.stdin.end();
      setTimeout(() => this.proc.exitCode == null && this.proc.kill(), 3e3);
    });
  }
}
let engine = null;
let starting = null;
function startEngine(offline = true) {
  if (engine) return engine.ready.then(() => engine);
  if (starting) return starting;
  starting = (async () => {
    const proc = node_child_process.spawn(venvPython(), [node_path.join(root(), "engine.py")], { cwd: root(), env: env(offline), windowsHide: true });
    const e = new Engine(proc);
    engine = e;
    try {
      await e.ready;
      return e;
    } catch (err) {
      if (engine === e) engine = null;
      proc.kill();
      throw err;
    }
  })().finally(() => starting = null);
  return starting;
}
async function stopEngine() {
  const e = engine;
  engine = null;
  await e?.stop();
}
function requireInstalled() {
  const m = manifest();
  if (!m) throw new Error("Chưa cài engine giọng local (Cài đặt → Giọng đọc local)");
  return m;
}
function presetVoices() {
  return requireInstalled().voices.map(([label, id2]) => ({ id: id2, label: label.replace(/^⭐\s*/, "★ ") }));
}
async function synthesizeLocal(opts) {
  const m = requireInstalled();
  if (!engine) node_fs.writeFileSync(node_path.join(root(), "engine.py"), ENGINE_SCRIPT, "utf8");
  const voice = opts.voice && m.voices.some(([, id2]) => id2 === opts.voice) ? opts.voice : m.voices[0]?.[1] ?? null;
  const eng = await startEngine(true);
  const r = await eng.request({ op: "synth", text: opts.text, voice: opts.ref ? null : voice, ref: opts.ref, out: opts.out }, opts.signal);
  return r.seconds;
}
const KEY$2 = "localtts.clones";
const CLONE_PREFIX = "clone:";
const MIN_SEC = 3;
const MAX_SEC = 15;
function listClones() {
  return getDb().select().from(settings).where(drizzleOrm.eq(settings.key, KEY$2)).get()?.value ?? [];
}
function saveClones(list2) {
  getDb().insert(settings).values({ key: KEY$2, value: list2 }).onConflictDoUpdate({ target: settings.key, set: { value: list2, updatedAt: /* @__PURE__ */ new Date() } }).run();
}
function cloneRef(voiceId) {
  if (!voiceId?.startsWith(CLONE_PREFIX)) return null;
  const c = listClones().find((x) => x.id === voiceId.slice(CLONE_PREFIX.length));
  const abs = c && node_path.join(mediaDir(), c.file);
  return abs && node_fs.existsSync(abs) ? abs : null;
}
const cloneVoiceId = (c) => `${CLONE_PREFIX}${c.id}`;
const localTtsHandlers = {
  "localtts.status": ({ detect }) => status(detect),
  "localtts.install": () => startInstall(),
  "localtts.cancel": () => cancelInstall(),
  "localtts.uninstall": () => uninstall(),
  "localtts.clones": () => listClones(),
  "localtts.addClone": async ({ name }) => {
    const opts = {
      title: "Chọn file giọng mẫu (3–15 giây, một người nói, không nhạc nền)",
      properties: ["openFile"],
      filters: [{ name: "Âm thanh / video", extensions: ["wav", "mp3", "m4a", "aac", "ogg", "flac", "mp4", "mov", "webm"] }]
    };
    const win = electron.BrowserWindow.getFocusedWindow();
    const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    const src = res.canceled ? null : res.filePaths[0];
    if (!src) return null;
    const dir = node_path.join(mediaDir(), "voice-clones");
    node_fs.mkdirSync(dir, { recursive: true });
    const id2 = newId();
    const file2 = `voice-clones/${id2}.wav`;
    const abs = node_path.join(mediaDir(), file2);
    await runFfmpeg(["-y", "-i", src, "-vn", "-ac", "1", "-ar", "24000", "-t", String(MAX_SEC), "-c:a", "pcm_s16le", abs]);
    const durationSec = await probeDuration(abs);
    if (durationSec < MIN_SEC) {
      node_fs.rmSync(abs, { force: true });
      throw new ApiError("VALIDATION", `Giọng mẫu chỉ dài ${durationSec.toFixed(1)} giây – cần ít nhất ${MIN_SEC} giây`);
    }
    const clone = { id: id2, name: name.trim() || node_path.basename(src, node_path.extname(src)), file: file2, durationSec, createdAt: Date.now() };
    saveClones([...listClones(), clone]);
    return clone;
  },
  "localtts.renameClone": ({ id: id2, name }) => {
    saveClones(listClones().map((c) => c.id === id2 ? { ...c, name } : c));
  },
  "localtts.removeClone": ({ id: id2 }) => {
    const list2 = listClones();
    const c = list2.find((x) => x.id === id2);
    if (!c) return;
    node_fs.rmSync(node_path.join(mediaDir(), c.file), { force: true });
    saveClones(list2.filter((x) => x.id !== id2));
  }
};
const EDGE_VOICES$1 = [
  { id: "vi-VN-HoaiMyNeural", label: "HoaiMy (Nữ miền Bắc)" },
  { id: "vi-VN-NamMinhNeural", label: "NamMinh (Nam miền Bắc)" }
];
const OPENAI_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"].map((v) => ({ id: v, label: v }));
const GOOGLE_TTS_VOICES = [
  ["Kore", "Nữ · chắc, rõ ràng"],
  ["Aoede", "Nữ · nhẹ nhàng"],
  ["Leda", "Nữ · trẻ trung"],
  ["Zephyr", "Nữ · tươi sáng"],
  ["Autonoe", "Nữ · sáng"],
  ["Callirrhoe", "Nữ · thoải mái"],
  ["Despina", "Nữ · mượt"],
  ["Erinome", "Nữ · trong trẻo"],
  ["Laomedeia", "Nữ · vui tươi"],
  ["Achernar", "Nữ · mềm"],
  ["Gacrux", "Nữ · trưởng thành"],
  ["Pulcherrima", "Nữ · dứt khoát"],
  ["Sulafat", "Nữ · ấm"],
  ["Vindemiatrix", "Nữ · dịu dàng"],
  ["Puck", "Nam · sôi nổi"],
  ["Charon", "Nam · kể chuyện, đều giọng"],
  ["Fenrir", "Nam · hào hứng"],
  ["Orus", "Nam · chắc"],
  ["Enceladus", "Nam · trầm, thì thầm"],
  ["Iapetus", "Nam · rõ ràng"],
  ["Umbriel", "Nam · thoải mái"],
  ["Algieba", "Nam · mượt"],
  ["Algenib", "Nam · khàn"],
  ["Rasalgethi", "Nam · truyền cảm"],
  ["Alnilam", "Nam · vững"],
  ["Schedar", "Nam · đều"],
  ["Achird", "Nam · thân thiện"],
  ["Zubenelgenubi", "Nam · bình dân"],
  ["Sadachbia", "Nam · sinh động"],
  ["Sadaltager", "Nam · hiểu biết"]
].map(([id2, desc]) => ({ id: id2, label: `${id2} (${desc})` }));
const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
function recordUsage(providerId, workspaceId, model, chars) {
  const unit = UNIT_PRICES[model];
  getDb().insert(aiUsage).values({ id: newId(), providerId, workspaceId, model, feature: "render.tts", characters: chars, costUsd: unit?.per === "char" ? unit.usd * chars : 0, ok: true }).run();
}
function bounded(p, ms, signal, onGiveUp) {
  return new Promise((resolve, reject) => {
    const stop = (err) => {
      clearTimeout(timer2);
      signal?.removeEventListener("abort", onAbort);
      onGiveUp();
      reject(err);
    };
    const onAbort = () => stop(new Error("Đã hủy"));
    const timer2 = setTimeout(() => stop(new Error(`Edge-TTS không phản hồi sau ${Math.round(ms / 1e3)} giây`)), ms);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        clearTimeout(timer2);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer2);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}
async function edgeTts(text, voice, dir, signal) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new Error("Đã hủy");
    try {
      return await edgeTtsOnce(text, voice, dir, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
      console.warn(`[tts] Edge-TTS lần ${attempt + 1}/3 lỗi: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw new Error(`Edge-TTS lỗi sau 3 lần thử: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
async function edgeTtsOnce(text, voice, dir, signal) {
  const tts = new msedgeTts.MsEdgeTTS();
  const limitMs = 15e3 + text.length * 150;
  const giveUp = () => {
    try {
      tts.close();
    } catch {
    }
  };
  try {
    const { audioFilePath, metadataFilePath } = await bounded(
      (async () => {
        await tts.setMetadata(voice, msedgeTts.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
        return tts.toFile(dir, escapeXml(text));
      })(),
      limitMs,
      signal,
      giveUp
    );
    let words = null;
    if (metadataFilePath) {
      const meta2 = JSON.parse(node_fs.readFileSync(metadataFilePath, "utf8"));
      words = (meta2.Metadata ?? []).filter((m) => m.Type === "WordBoundary").map((m) => ({ text: m.Data.text.Text, start: m.Data.Offset / 1e7, end: (m.Data.Offset + m.Data.Duration) / 1e7 }));
    }
    return { file: audioFilePath, durationSec: await probeDuration(audioFilePath), words: words?.length ? words : null, provider: "edge_tts" };
  } finally {
    tts.close();
  }
}
async function elevenTts(text, voice, model, dir, workspaceId, signal) {
  const { key: key2, baseUrl, row } = requireKey("elevenlabs");
  assertBudget(workspaceId);
  const base = (baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key2, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model }),
    // Hủy render hoặc quá 120s đều dừng request
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12e4)]) : AbortSignal.timeout(12e4)
  });
  if (!res.ok) throw await providerError("ElevenLabs", res, { 401: "key không hợp lệ", 404: "không tìm thấy giọng (voice id)", 429: "vượt giới hạn / hết ký tự của gói" });
  const body = await res.json();
  const file2 = node_path.join(dir, "audio.mp3");
  node_fs.writeFileSync(file2, Buffer.from(body.audio_base64, "base64"));
  recordUsage(row.id, workspaceId, model, text.length);
  let words = null;
  const a = body.alignment;
  if (a?.characters?.length) {
    words = [];
    let cur = null;
    a.characters.forEach((ch, i) => {
      if (/\s/.test(ch)) {
        if (cur) words.push(cur);
        cur = null;
      } else if (cur) {
        cur.text += ch;
        cur.end = a.character_end_times_seconds[i];
      } else {
        cur = { text: ch, start: a.character_start_times_seconds[i], end: a.character_end_times_seconds[i] };
      }
    });
    if (cur) words.push(cur);
  }
  return { file: file2, durationSec: await probeDuration(file2), words, provider: "elevenlabs" };
}
async function openaiTts(text, voice, model, dir, workspaceId, signal) {
  const { key: key2, baseUrl, row } = requireKey("openai_tts");
  assertBudget(workspaceId);
  const base = (baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key2}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
    // Hủy render hoặc quá 120s đều dừng request
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12e4)]) : AbortSignal.timeout(12e4)
  });
  if (!res.ok) throw await providerError("OpenAI Audio", res, { 401: "key không hợp lệ", 429: "vượt giới hạn hoặc hết hạn mức thanh toán" });
  const file2 = node_path.join(dir, "audio.mp3");
  node_fs.writeFileSync(file2, Buffer.from(await res.arrayBuffer()));
  recordUsage(row.id, workspaceId, model, text.length);
  return { file: file2, durationSec: await probeDuration(file2), words: null, provider: "openai_tts" };
}
async function googleTts(text, voice, model, dir, workspaceId, signal) {
  const { key: key2, baseUrl, row } = requireKey("google_tts");
  assertBudget(workspaceId);
  const base = (baseUrl ?? GOOGLE_BASE).replace(/\/$/, "");
  const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key2, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
    }),
    // Hủy render hoặc quá 120s đều dừng request
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12e4)]) : AbortSignal.timeout(12e4)
  });
  if (!res.ok)
    throw await providerError("Google Gemini TTS", res, {
      400: "yêu cầu không hợp lệ (model hoặc giọng không hỗ trợ)",
      403: "key không có quyền hoặc chưa bật Gemini API",
      404: "không tìm thấy model TTS – bấm Kiểm tra kết nối để cập nhật danh sách model",
      429: "vượt hạn mức – key miễn phí giới hạn rất thấp, cần bật thanh toán trong Google AI Studio"
    });
  const audio = findInlineData(await res.json(), "audio");
  if (!audio) throw new AiError("invalid_output", "Gemini TTS không trả về âm thanh (có thể bị chặn bởi bộ lọc an toàn)");
  const rate = Number(audio.mime.match(/rate=(\d+)/)?.[1] ?? 24e3);
  const pcm = node_path.join(dir, "audio.pcm");
  const file2 = node_path.join(dir, "audio.mp3");
  node_fs.writeFileSync(pcm, Buffer.from(audio.data, "base64"));
  try {
    await runFfmpeg(["-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", pcm, "-c:a", "libmp3lame", "-b:a", "128k", file2], { signal });
  } finally {
    node_fs.rmSync(pcm, { force: true });
  }
  recordUsage(row.id, workspaceId, model, text.length);
  return { file: file2, durationSec: await probeDuration(file2), words: null, provider: "google_tts" };
}
async function localTts(text, voiceId, dir, signal) {
  const wav = node_path.join(dir, "audio.wav");
  const file2 = node_path.join(dir, "audio.mp3");
  const ref = cloneRef(voiceId);
  try {
    await synthesizeLocal({ text, voice: ref ? null : voiceId, ref, out: wav, signal });
    await runFfmpeg(["-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", "160k", file2], { signal });
  } finally {
    node_fs.rmSync(wav, { force: true });
  }
  return { file: file2, durationSec: await probeDuration(file2), words: null, provider: "local_tts" };
}
async function synthesize(opts) {
  node_fs.mkdirSync(opts.dir, { recursive: true });
  const row = providerRow(opts.provider);
  switch (opts.provider) {
    case "elevenlabs":
      if (!opts.voiceId || opts.voiceId.length < 15) throw new Error("Chưa chọn giọng ElevenLabs (voice id) cho dự án");
      return elevenTts(opts.text, opts.voiceId, row?.defaultModel ?? "eleven_multilingual_v2", opts.dir, opts.workspaceId, opts.signal);
    case "openai_tts":
      return openaiTts(
        opts.text,
        OPENAI_VOICES.some((v) => v.id === opts.voiceId) ? opts.voiceId : "nova",
        row?.defaultModel ?? "gpt-4o-mini-tts",
        opts.dir,
        opts.workspaceId,
        opts.signal
      );
    case "google_tts":
      return googleTts(
        opts.text,
        GOOGLE_TTS_VOICES.some((v) => v.id === opts.voiceId) ? opts.voiceId : "Kore",
        row?.defaultModel ?? "gemini-2.5-flash-preview-tts",
        opts.dir,
        opts.workspaceId,
        opts.signal
      );
    case "local_tts":
      return localTts(opts.text, opts.voiceId, opts.dir, opts.signal);
    default:
      return edgeTts(opts.text, EDGE_VOICES$1.some((v) => v.id === opts.voiceId) ? opts.voiceId : EDGE_VOICES$1[0].id, opts.dir, opts.signal);
  }
}
const PREVIEW_TEXT = "Xin chào! Đây là giọng đọc mẫu cho video của bạn. Bạn thấy giọng này thế nào?";
async function previewVoice(provider, voiceId, workspaceId, root2) {
  const model = providerRow(provider)?.defaultModel ?? "";
  const key2 = node_crypto.createHash("sha1").update([provider, model, voiceId ?? "", PREVIEW_TEXT].join("|")).digest("hex").slice(0, 16);
  const rel2 = `voice-samples/${key2}`;
  const dir = node_path.join(root2, rel2);
  const cached = node_fs.existsSync(dir) ? node_fs.readdirSync(dir).find((f) => f.endsWith(".mp3")) : void 0;
  if (cached) return `${rel2}/${cached}`;
  try {
    const out = await synthesize({ provider, voiceId, text: PREVIEW_TEXT, dir, workspaceId, signal: AbortSignal.timeout(6e4) });
    return `${rel2}/${node_path.basename(out.file)}`;
  } catch (e) {
    node_fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
async function listVoices(provider) {
  if (provider === "openai_tts") return OPENAI_VOICES;
  if (provider === "google_tts") return GOOGLE_TTS_VOICES;
  if (provider === "local_tts") return [...listClones().map((c) => ({ id: cloneVoiceId(c), label: `🎙 ${c.name} (giọng clone)` })), ...presetVoices()];
  if (provider === "elevenlabs") {
    const { key: key2, baseUrl } = requireKey("elevenlabs");
    const base = (baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
    const res = await fetch(`${base}/v1/voices`, { headers: { "xi-api-key": key2 }, signal: AbortSignal.timeout(15e3) });
    if (!res.ok) throw new AiError(res.status === 401 ? "auth" : "unknown", `ElevenLabs HTTP ${res.status}${res.status === 401 ? " – key không hợp lệ" : ""}`);
    const body = await res.json();
    return body.voices.map((v) => ({ id: v.voice_id, label: [v.name, v.labels?.gender, v.labels?.accent].filter(Boolean).join(" · ") }));
  }
  return EDGE_VOICES$1;
}
const ASPECT_SIZE = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 }
};
const isLongForm = (sec) => sec > 90;
const modeOfRender = (r) => r === "full_ai" ? "veo" : r === "semi_ai" ? "image" : "stock";
const effectiveMode = (m, r) => !m || m === "auto" ? modeOfRender(r) : m;
const CLIP_VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "mkv"];
const CLIP_IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];
const clipKind = (path) => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return CLIP_VIDEO_EXT.includes(ext) ? "video" : CLIP_IMAGE_EXT.includes(ext) ? "image" : null;
};
const attachmentKind = (path) => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (["mp3", "m4a", "wav", "ogg", "aac"].includes(ext)) return "audio";
  return "file";
};
const clean$1 = (s) => (s ?? "").trim().replace(/\s+/g, " ").replace(/[.;,\s]+$/, "");
function composeShotPrompt(shot, bible) {
  const byName = new Map((bible?.characters ?? []).map((c) => [c.name.trim().toLowerCase(), c]));
  const subjects = [
    ...shot.characters.map((n) => {
      const c = byName.get(n.trim().toLowerCase());
      return c ? `${c.name} (${clean$1(c.look)})` : clean$1(n);
    }),
    ...shot.product && bible?.product ? [`the ${bible.product.name} (${clean$1(bible.product.look)})`] : []
  ].filter(Boolean);
  const parts = [
    clean$1(shot.cameraAngle) && clean$1(shot.cameraMovement) ? `${clean$1(shot.cameraAngle)}, ${clean$1(shot.cameraMovement)}` : clean$1(shot.cameraAngle) || clean$1(shot.cameraMovement),
    subjects.length ? `Subject: ${subjects.join("; ")}` : "",
    clean$1(shot.action) ? `Action: ${clean$1(shot.action)}` : "",
    clean$1(shot.setting) ? `Setting: ${clean$1(shot.setting)}` : "",
    clean$1(shot.lighting) ? `Lighting: ${clean$1(shot.lighting)}` : "",
    clean$1(shot.look) ? `Look: ${clean$1(shot.look)}` : "",
    [clean$1(shot.style), clean$1(bible?.style)].filter(Boolean).length ? `Style: ${[clean$1(shot.style), clean$1(bible?.style)].filter(Boolean).join(", ")}` : "",
    clean$1(shot.sound) ? `Sound: ${clean$1(shot.sound)}` : "",
    "No on-screen text, no subtitles, no watermark"
  ].filter(Boolean);
  return parts.join(". ") + ".";
}
function stillImagePrompt(prompt) {
  return prompt.replace(/(^|\.\s*)Sound:[^.]*\./i, "$1").replace(/,\s*(slow |smooth |fast )?(dolly|push|pull|pan|tilt|tracking|crane|handheld|orbit|zoom)[^.]*\./i, ".").trim();
}
function bibleBrief(bible) {
  if (!bible) return "";
  return [
    `Visual bible (dùng xuyên suốt, KHÔNG đổi): style = ${bible.style}`,
    bible.characters.length ? `Nhân vật: ${bible.characters.map((c) => `${c.name} = ${c.look}`).join(" | ")}` : "",
    bible.product ? `Sản phẩm: ${bible.product.name} = ${bible.product.look}` : ""
  ].filter(Boolean).join("\n");
}
const replaceAll = (s, from, to) => from ? s.split(from).join(to) : s;
function rebiblePrompt(prompt, prev, next) {
  let out = prompt;
  prev.characters.forEach((c, i) => {
    const n = next.characters[i];
    out = replaceAll(out, `${c.name} (${clean$1(c.look)})`, n ? `${n.name} (${clean$1(n.look)})` : c.name);
  });
  if (prev.product) {
    const p = prev.product;
    out = replaceAll(out, `the ${p.name} (${clean$1(p.look)})`, next.product ? `the ${next.product.name} (${clean$1(next.product.look)})` : `the ${p.name}`);
  }
  const oldStyle = clean$1(prev.style);
  const newStyle = clean$1(next.style);
  if (oldStyle && out.includes(oldStyle)) out = replaceAll(out, oldStyle, newStyle);
  else if (!oldStyle && newStyle) {
    out = /Style: [^.]*\./.test(out) ? out.replace(/Style: ([^.]*)\./, `Style: $1, ${newStyle}.`) : out.replace(/No on-screen text/, `Style: ${newStyle}. No on-screen text`);
  }
  return out.replace(/Style: , /, "Style: ").replace(/, \./g, ".");
}
const FPS$1 = 30;
const SAMPLE_RATE$1 = 44100;
const SAMPLES_PER_FRAME$1 = SAMPLE_RATE$1 / FPS$1;
const FADE_SEC$1 = 0.25;
const SEGMENT_VERSION = 1;
const FALLBACK_COLORS = ["0x1d2433", "0x2b2440", "0x1f3b33", "0x3b1e2f", "0x1e2a3b"];
function splitPrompt(query) {
  const sound = query.match(/(?:^|\.\s*)Sound:\s*([^.]*)\./i)?.[1]?.trim() || null;
  const visual = query.replace(/(^|\.\s*)Sound:[^.]*\./i, "$1").replace(/\s*No on-screen text[^.]*\.?\s*$/i, "").trim().replace(/[.\s]*$/, ".");
  return { visual, sound };
}
function voicedPrompt(query, speaker2, line) {
  const { visual, sound } = splitPrompt(query);
  const who = speaker2 ?? "The on-screen presenter (or a voice-over narrator if nobody is on screen)";
  return [
    `${who} speaks in Vietnamese (tiếng Việt), saying exactly: "${line}"`,
    "Lip-synced, natural Vietnamese pronunciation and intonation.",
    visual,
    `Audio: the only speech is that Vietnamese line – no English, no other words or dialogue${sound ? `; background: ${sound}` : ""}.`,
    "No on-screen text, no subtitles, no watermark."
  ].join(" ");
}
function noSpeechPrompt(query) {
  const { visual, sound } = splitPrompt(query);
  return `${visual} Audio: ${sound ? `${sound}, ` : ""}ambient sound only – no dialogue, no speech, no narration, nobody talks. No on-screen text, no subtitles, no watermark.`;
}
const SOURCE_LABEL = { stock: "Kho video", pixabay: "Kho video", fal: "Fal.ai", nano_banana: "Ảnh Gemini", veo: "Veo", upload: "Clip của bạn" };
const rel$3 = (abs) => abs.slice(mediaDir().length + 1).replace(/\\/g, "/");
const segmentsDir = (projectId) => node_path.join(mediaDir(), "segments", projectId);
function watermarkPos(pos, h) {
  const top = Math.round(h * 0.083);
  const bottom = Math.round(h * 0.156);
  switch (pos) {
    case "tl":
      return `48:${top}`;
    case "tr":
      return `W-w-48:${top}`;
    case "bl":
      return `48:H-h-${bottom}`;
    case "center":
      return "(W-w)/2:(H-h)/2";
    default:
      return `W-w-48:H-h-${bottom}`;
  }
}
const concatLine$1 = (file2) => `file '${file2.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
const ttsCacheDir = (provider, voiceId, text) => node_path.join(cacheDir("tts"), hashOf(provider, voiceId ?? "", text));
async function ttsCached(opts) {
  const dir = ttsCacheDir(opts.provider, opts.voiceId, opts.text);
  const metaFile = node_path.join(dir, "result.json");
  if (node_fs.existsSync(metaFile)) {
    try {
      const m = JSON.parse(node_fs.readFileSync(metaFile, "utf8"));
      const file2 = node_path.join(dir, m.name);
      if (node_fs.existsSync(file2)) return { file: file2, durationSec: m.durationSec, words: m.words, provider: m.provider };
    } catch {
    }
  }
  node_fs.rmSync(dir, { recursive: true, force: true });
  const r = await synthesize({ ...opts, dir });
  node_fs.writeFileSync(metaFile, JSON.stringify({ name: node_path.basename(r.file), durationSec: r.durationSec, words: r.words, provider: r.provider }));
  return r;
}
function sceneRefs(projectId) {
  const db2 = getDb();
  const abs = (p) => node_path.join(mediaDir(), p);
  const project = db2.select({ referenceImages: videoProjects.referenceImages }).from(videoProjects).where(drizzleOrm.eq(videoProjects.id, projectId)).get();
  const projectRefs = (project?.referenceImages ?? []).filter((p) => node_fs.existsSync(abs(p)));
  const ep = db2.select({ seriesId: seriesEpisodes.seriesId }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.projectId, projectId)).get();
  const chars = ep ? db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, ep.seriesId)).all().filter((c) => c.referenceImage && node_fs.existsSync(abs(c.referenceImage))) : [];
  return (s) => {
    if (s.sceneRefs)
      return s.sceneRefs.filter((p) => node_fs.existsSync(abs(p))).slice(0, 3).map(abs);
    const fromChars = chars.filter((c) => c.id === s.speakerId || (s.mediaPrompt ?? "").includes(`${c.name}: `)).map((c) => c.referenceImage);
    return [.../* @__PURE__ */ new Set([...fromChars, ...projectRefs])].slice(0, 3).map(abs);
  };
}
const sceneFrames = (s) => {
  const start2 = s.startImage && node_fs.existsSync(node_path.join(mediaDir(), s.startImage)) ? node_path.join(mediaDir(), s.startImage) : null;
  return { start: start2, end: start2 && s.endImage && node_fs.existsSync(node_path.join(mediaDir(), s.endImage)) ? node_path.join(mediaDir(), s.endImage) : null };
};
function stockQueryOf(s) {
  if (s.searchQuery?.trim()) return s.searchQuery.trim();
  const p = s.mediaPrompt?.trim() ?? "";
  const setting2 = p.match(/Setting:\s*([^.]+)/i)?.[1];
  return (setting2 ?? p ?? "").split(/\s+/).filter(Boolean).slice(0, 6).join(" ") || s.voiceover.split(/\s+/).slice(0, 4).join(" ");
}
async function renderProject(jobId, signal, report) {
  const db2 = getDb();
  const job = db2.select().from(renderJobs).where(drizzleOrm.eq(renderJobs.id, jobId)).get();
  if (!job) throw new Error("Không tìm thấy job render");
  const project = db2.select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, job.projectId)).get();
  if (!project) throw new Error("Dự án đã bị xóa");
  const scenes = db2.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, project.id)).orderBy(drizzleOrm.asc(videoScenes.position)).all().map((s) => project.narration ? s : { ...s, voiceover: "" });
  if (!scenes.length) throw new Error("Dự án chưa có phân cảnh");
  const channel = project.targetChannelId ? db2.select().from(channels).where(drizzleOrm.eq(channels.id, project.targetChannelId)).get() : void 0;
  const workspaceId = project.workspaceId ?? channel?.workspaceId ?? null;
  const ws = workspaceId ? db2.select().from(workspaces).where(drizzleOrm.eq(workspaces.id, workspaceId)).get() : void 0;
  const aspect = project.aspect;
  const { w: W, h: H } = ASPECT_SIZE[aspect];
  const transition = project.transition;
  const n = scenes.length;
  const modes = scenes.map((s) => effectiveMode(s.mediaMode, project.renderMode));
  const clipAudio = !project.narration && project.clipAudio === "tts" ? "clip" : project.clipAudio;
  const isClipScene = (i) => modes[i] === "veo" || modes[i] === "upload" && !!scenes[i].mediaPath && clipKind(scenes[i].mediaPath) === "video";
  const clipVoiced = scenes.map((s, i) => clipAudio === "clip" && !!s.voiceover.trim() && isClipScene(i));
  const jobDir = node_path.join(mediaDir(), "jobs", jobId);
  node_fs.mkdirSync(jobDir, { recursive: true });
  const check = () => {
    if (signal.aborted) throw new FfmpegError("Đã hủy", "");
  };
  const audio = [];
  let ttsFellBack = false;
  for (const [i, s] of scenes.entries()) {
    check();
    report.progress(i / n * 0.15, `Tạo giọng đọc cảnh ${i + 1}/${n}`);
    const text = s.voiceover.trim();
    if (!text || clipVoiced[i]) {
      audio.push(null);
      continue;
    }
    try {
      audio.push(
        await ttsCached({ provider: ttsFellBack ? "edge_tts" : project.ttsProvider, voiceId: ttsFellBack ? null : s.voiceId ?? project.voiceId, text, workspaceId, signal })
      );
    } catch (err) {
      if (signal.aborted || project.ttsProvider === "edge_tts" || ttsFellBack) throw err;
      report.note(`Giọng ${project.ttsProvider} lỗi (${err instanceof Error ? err.message : String(err)}) → dùng Edge-TTS`);
      ttsFellBack = true;
      for (let j = 0; j < i; j++) if (audio[j]) audio[j] = await ttsCached({ provider: "edge_tts", voiceId: null, text: scenes[j].voiceover.trim(), workspaceId, signal });
      audio.push(await ttsCached({ provider: "edge_tts", voiceId: null, text, workspaceId, signal }));
    }
  }
  const frames = scenes.map((s, i) => Math.max(1, Math.round(Math.max(s.durationSec, (audio[i]?.durationSec ?? 0) + 0.3) * FPS$1)));
  const durations = frames.map((f) => f / FPS$1);
  let totalFrames = frames.reduce((a, b) => a + b, 0);
  let total2 = totalFrames / FPS$1;
  const media = new Array(n).fill(null);
  const veoLabel = veoSource() === "flow" ? "Google Flow" : "Veo";
  const usedStock = /* @__PURE__ */ new Set();
  const stockChain = ["pexels", "pixabay"].filter((p) => hasProvider(p));
  const allEngines = imageEngines();
  const veoReady = veoAvailable();
  const refsOf = sceneRefs(project.id);
  const refScenes = scenes.filter((s) => refsOf(s).length).length;
  if (refScenes) report.note(`${refScenes} cảnh dùng ảnh tham chiếu (nhân vật / sản phẩm) cho ảnh AI Gemini / Veo để hình ảnh đồng nhất`);
  const countOf = (m) => modes.filter((x) => x === m).length;
  if (countOf("veo") && !veoReady)
    report.note(`${countOf("veo")} cảnh chọn Video AI (Veo) nhưng Veo đang tắt/chưa có key Gemini (hoặc chưa đăng nhập Google Flow) – dùng ${allEngines.length ? "ảnh AI" : "video stock"}`);
  if ((countOf("image") || countOf("veo") && !veoReady) && !allEngines.length) report.note(`${imageEngineIssue() ?? "Ảnh AI chưa sẵn sàng"} → dùng video stock`);
  if (!stockChain.length && (countOf("stock") || countOf("image") || countOf("veo")))
    report.note("Kho video miễn phí chưa sẵn sàng (cần kết nối mạng / gói Omnira) – cảnh không có media AI sẽ dùng nền màu");
  const dead = /* @__PURE__ */ new Map();
  const fatal = (err) => {
    if (!(err instanceof AiError)) return null;
    if (err.kind === "auth" || err.kind === "no_provider" || err.kind === "budget" || err.kind === "quota") return err.message;
    if (err.kind === "rate_limit" && /limit:\s*0|quota|free tier|billing/i.test(err.message)) {
      return "key Gemini gói Free không có hạn mức cho model này – cần bật thanh toán (billing) trong Google AI Studio";
    }
    return null;
  };
  for (let i = 0; i < n; i++) report.scene?.(i, { status: "waiting", text: null, source: null, progress: null, startedAt: null });
  let prepared = 0;
  const prepareScene = async (i) => {
    const s = scenes[i];
    check();
    const mode = modes[i];
    const finish = (st) => {
      report.scene?.(i, st);
      prepared++;
      report.progress(0.15 + prepared / n * 0.2, `Chuẩn bị hình ảnh: ${prepared}/${n} cảnh xong`);
    };
    if (mode === "none") {
      media[i] = null;
      finish({ status: "done", source: "Không dùng hình", text: null, progress: 1 });
      return;
    }
    if (mode === "upload") {
      const abs = s.mediaPath ? node_path.join(mediaDir(), s.mediaPath) : null;
      const kind = abs ? clipKind(abs) : null;
      if (abs && kind && node_fs.existsSync(abs)) {
        media[i] = { file: abs, kind, source: "upload", credit: null };
        finish({ status: "done", source: "Clip / ảnh của bạn", text: null, progress: 1 });
        return;
      }
      report.note(`Cảnh ${i + 1}: không tìm thấy clip đã gắn${s.mediaPath ? ` (${s.mediaPath})` : ""} → tìm hình theo chế độ dự án`);
    }
    report.scene?.(i, { status: "running", text: "Bắt đầu…", startedAt: Date.now() });
    const fallbackMode = mode === "upload" ? effectiveMode("auto", project.renderMode) : mode;
    const useVeo = fallbackMode === "veo" && veoReady;
    const engines = fallbackMode === "stock" ? [] : allEngines;
    const query = s.mediaPrompt?.trim() || s.voiceover.split(/\s+/).slice(0, 4).join(" ");
    const imageQuery = stillImagePrompt(query);
    const stockQuery = stockQueryOf(s);
    let m = null;
    const errors = [];
    const attempt = async (label, fn) => {
      if (m || dead.has(label)) return;
      report.scene?.(i, { status: "running", source: label, text: `${label}: đang tạo…`, progress: null });
      try {
        m = await fn();
        if (!m) errors.push(`${label}: không có kết quả cho "${query}"`);
      } catch (err) {
        if (signal.aborted) throw err;
        const reason = fatal(err);
        if (reason) {
          dead.set(label, reason);
          report.note(`${label} bị bỏ qua cho các cảnh còn lại: ${reason}`);
        }
        errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    if (useVeo) {
      const clip2 = () => veoClip(
        // Veo tự lồng tiếng: lời thoại tiếng Việt đặt TRƯỚC phần hình (Veo bám phần đầu prompt);
        // giữ tiếng clip mà cảnh không có lời thoại (teaser, cảnh hình) → cấm nói, chỉ tiếng môi trường
        clipVoiced[i] ? voicedPrompt(query, s.speakerId ? s.label ?? "The character" : null, s.voiceover.trim()) : clipAudio !== "tts" ? noSpeechPrompt(query) : query,
        durations[i],
        workspaceId,
        signal,
        (sec, text) => {
          const pct = text?.match(/\b(\d{1,3})%/)?.[1];
          report.scene?.(i, { status: "running", source: veoLabel, text: text ?? `${veoLabel} đang tạo video… ${sec}s`, progress: pct ? Number(pct) / 100 : null });
        },
        aspect,
        refsOf(s),
        sceneFrames(s)
      );
      await attempt(veoLabel, async () => {
        try {
          return await clip2();
        } catch (err) {
          if (signal.aborted || veoSource() !== "flow" || fatal(err) || err instanceof FlowTransientError) throw err;
          report.scene?.(i, { status: "running", source: veoLabel, text: `${veoLabel} lỗi – thử lại…`, progress: null });
          console.warn(`[render] cảnh ${i + 1}: Google Flow lỗi, thử lại`, err instanceof Error ? err.message : err);
          return await clip2();
        }
      });
    }
    for (const eng of engines) {
      await attempt(IMAGE_ENGINE_LABEL[eng], () => imageBy(eng, imageQuery, workspaceId, signal, aspect, refsOf(s)));
    }
    for (const src of stockChain) {
      await attempt(src === "pexels" ? "Kho video 1" : "Kho video 2", async () => {
        const v = await (src === "pexels" ? pexelsVideo : pixabayVideo)(stockQuery, durations[i], usedStock, signal, aspect);
        if (v) usedStock.add(v.stockId);
        return v;
      });
    }
    const got = m;
    if (errors.length) report.note(`Cảnh ${i + 1}: ${errors.join("; ")}${got ? ` → dùng ${got.credit ?? "nguồn dự phòng"}` : " → dùng nền màu"}`);
    media[i] = got;
    db2.update(videoScenes).set({ mediaPath: got ? rel$3(got.file) : null, mediaCredit: got?.credit ?? null, mediaSource: got?.source ?? null }).where(drizzleOrm.eq(videoScenes.id, s.id)).run();
    finish({
      status: !got ? "failed" : errors.length ? "fallback" : "done",
      source: got ? got.credit?.replace(/^AI:\s*/, "") ?? SOURCE_LABEL[got.source] ?? got.source : "Nền màu",
      text: errors.length ? errors.join("; ").slice(0, 400) : null,
      progress: 1
    });
  };
  const limit = veoSource() === "flow" ? Math.max(2, flowConcurrency()) : 3;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, n) }, async () => {
      while (next < n && !signal.aborted) await prepareScene(next++);
    })
  );
  check();
  const clipHasAudio = /* @__PURE__ */ new Map();
  if (clipAudio !== "tts")
    for (let i = 0; i < n; i++) {
      const m = media[i];
      if (m?.kind === "video" && (m.source === "veo" || m.source === "upload")) clipHasAudio.set(i, await hasAudioStream(m.file));
    }
  let voiceFallback = 0;
  for (let i = 0; i < n; i++) {
    if (!clipVoiced[i] || clipHasAudio.get(i)) continue;
    check();
    const text = scenes[i].voiceover.trim();
    try {
      audio[i] = await ttsCached({
        provider: ttsFellBack ? "edge_tts" : project.ttsProvider,
        voiceId: ttsFellBack ? null : scenes[i].voiceId ?? project.voiceId,
        text,
        workspaceId,
        signal
      });
    } catch (err) {
      if (signal.aborted) throw err;
      audio[i] = await ttsCached({ provider: "edge_tts", voiceId: null, text, workspaceId, signal });
    }
    frames[i] = Math.max(frames[i], Math.round((audio[i].durationSec + 0.3) * FPS$1));
    durations[i] = frames[i] / FPS$1;
    voiceFallback++;
  }
  if (voiceFallback) report.note(`${voiceFallback} cảnh không có tiếng clip (clip câm hoặc Veo không tạo được) → dùng giọng đọc`);
  if (clipAudio !== "tts" && clipHasAudio.size)
    report.note(`${[...clipHasAudio.values()].filter(Boolean).length} cảnh dùng âm thanh của clip (${clipAudio === "clip" ? "tiếng clip thay giọng đọc" : "trộn dưới giọng đọc"})`);
  totalFrames = frames.reduce((a, b) => a + b, 0);
  total2 = totalFrames / FPS$1;
  check();
  node_fs.mkdirSync(node_path.join(jobDir, "fonts"), { recursive: true });
  node_fs.copyFileSync(node_path.join(fontsDir(), "Montserrat-Black.ttf"), node_path.join(jobDir, "fonts", "Montserrat-Black.ttf"));
  const wmFile = ws?.watermarkPath && node_fs.existsSync(ws.watermarkPath) ? ws.watermarkPath : null;
  if (ws?.watermarkPath && !wmFile) report.note(`Không tìm thấy file watermark: ${ws.watermarkPath}`);
  const wmOpacity = (ws?.watermarkOpacity ?? 0.85).toFixed(2);
  const wmPos = watermarkPos(ws?.watermarkPosition ?? "br", H);
  const wmWidth = Math.round(Math.min(W, H) * 0.185);
  const bgmFile = project.bgmTrack ? node_path.join(mediaDir(), "bgm", project.bgmTrack) : null;
  const hasBgm = !!bgmFile && node_fs.existsSync(bgmFile);
  if (project.bgmTrack && !hasBgm) report.note(`Không tìm thấy nhạc nền "${project.bgmTrack}" trong thư mục media/bgm`);
  const segDir = segmentsDir(project.id);
  node_fs.mkdirSync(segDir, { recursive: true });
  const renderSegment = async (i, enc, onRatio) => {
    const m = media[i];
    const d = durations[i].toFixed(3);
    const subScene = {
      start: 0,
      duration: durations[i],
      text: scenes[i].voiceover,
      words: audio[i]?.words ?? null,
      audioDuration: audio[i]?.durationSec ?? durations[i]
    };
    const fadeIn = transition === "fade_black" && i > 0;
    const fadeOut = transition === "fade_black" && i < n - 1;
    const key2 = hashOf(
      JSON.stringify({
        v: SEGMENT_VERSION,
        W,
        H,
        media: m ? [m.kind, m.file] : FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        frames: frames[i],
        kenBurns: i % 2,
        sub: [subScene.text, subScene.words, subScene.audioDuration, project.subtitleStyle],
        wm: wmFile ? [wmFile, wmOpacity, wmPos] : null,
        fade: [fadeIn, fadeOut],
        enc
      })
    );
    const file2 = node_path.join(segDir, `${key2}.mp4`);
    if (node_fs.existsSync(file2)) return { file: file2, cached: true };
    const subName = project.subtitleStyle === "none" || !subScene.text.trim() ? null : `sub-${i}.ass`;
    if (subName) node_fs.writeFileSync(node_path.join(jobDir, subName), buildAss([subScene], project.subtitleStyle, { w: W, h: H }), "utf8");
    const inputs2 = [];
    const filters2 = [];
    if (m?.kind === "video") {
      inputs2.push("-stream_loop", "-1", "-t", d, "-i", m.file);
      filters2.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS$1},setsar=1,format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS[base]`);
    } else if (m?.kind === "image") {
      inputs2.push("-i", m.file);
      const z = i % 2 === 0 ? "min(zoom+0.0007,1.15)" : "if(eq(on,0),1.15,max(zoom-0.0007,1.0))";
      const bw = Math.round(W * 1.2);
      const bh = Math.round(H * 1.2);
      filters2.push(
        `[0:v]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames[i]}:s=${W}x${H}:fps=${FPS$1},setsar=1,format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS[base]`
      );
    } else {
      inputs2.push("-f", "lavfi", "-t", d, "-i", `color=c=${FALLBACK_COLORS[i % FALLBACK_COLORS.length]}:s=${W}x${H}:r=${FPS$1}`);
      filters2.push("[0:v]format=yuv420p,setsar=1[base]");
    }
    let cur = "base";
    if (wmFile) {
      inputs2.push("-i", wmFile);
      filters2.push(`[1:v]scale=${wmWidth}:-1,format=rgba,colorchannelmixer=aa=${wmOpacity}[wm]`, `[${cur}][wm]overlay=${wmPos}:format=auto[vw]`);
      cur = "vw";
    }
    const fades = [fadeIn ? `fade=t=in:st=0:d=${FADE_SEC$1}` : "", fadeOut ? `fade=t=out:st=${(durations[i] - FADE_SEC$1).toFixed(3)}:d=${FADE_SEC$1}` : ""].filter(Boolean);
    filters2.push(`[${cur}]${[subName ? `subtitles=${subName}:fontsdir=fonts` : "null", ...fades].join(",")},format=yuv420p[vout]`);
    const part = node_path.join(jobDir, `seg-${i}.mp4`);
    await runFfmpeg(
      [
        "-loglevel",
        "error",
        ...inputs2,
        "-filter_complex",
        filters2.join(";"),
        "-map",
        "[vout]",
        "-an",
        ...encoderArgs(enc),
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(FPS$1),
        // Mỗi đoạn đúng số khung, cùng timescale → nối bằng concat demuxer không lệch thời gian
        "-frames:v",
        String(frames[i]),
        "-video_track_timescale",
        "15360",
        part
      ],
      { cwd: jobDir, signal, totalSec: durations[i], onProgress: onRatio }
    );
    node_fs.renameSync(part, file2);
    return { file: file2, cached: false };
  };
  const renderAudio = async (i) => {
    const samples = frames[i] * SAMPLES_PER_FRAME$1;
    const a = audio[i];
    const fades = [
      transition === "fade_black" && i > 0 ? `afade=t=in:st=0:d=0.15` : "",
      transition === "fade_black" && i < n - 1 ? `afade=t=out:st=${(durations[i] - 0.15).toFixed(3)}:d=0.15` : ""
    ].filter(Boolean);
    const out = node_path.join(jobDir, `a-${i}.wav`);
    const fit = [`aresample=${SAMPLE_RATE$1}`, "aformat=sample_fmts=s16:channel_layouts=stereo"];
    const pad3 = [`apad=whole_len=${samples}`, `atrim=end_sample=${samples}`];
    const clipFile = clipAudio !== "tts" && clipHasAudio.get(i) ? media[i].file : null;
    if (clipFile && (clipVoiced[i] || !a)) {
      const vol = clipVoiced[i] || clipAudio === "clip" ? 1 : Math.max(project.clipAudioVolume, 0.8);
      await runFfmpeg(
        [
          "-loglevel",
          "error",
          "-i",
          clipFile,
          "-vn",
          "-af",
          [...fit, `volume=${vol.toFixed(2)}`, ...pad3, ...fades].join(","),
          "-c:a",
          "pcm_s16le",
          "-ar",
          String(SAMPLE_RATE$1),
          "-ac",
          "2",
          out
        ],
        { signal }
      );
      return out;
    }
    if (clipFile && a) {
      await runFfmpeg(
        [
          "-loglevel",
          "error",
          "-i",
          a.file,
          "-i",
          clipFile,
          "-filter_complex",
          `[0:a]${[...fit, "adelay=100:all=1", ...pad3].join(",")}[v];[1:a]${[...fit, `volume=${project.clipAudioVolume.toFixed(2)}`, ...pad3].join(",")}[c];[v][c]amix=inputs=2:duration=first:normalize=0${fades.length ? "," + fades.join(",") : ""}[o]`,
          "-map",
          "[o]",
          "-c:a",
          "pcm_s16le",
          "-ar",
          String(SAMPLE_RATE$1),
          "-ac",
          "2",
          out
        ],
        { signal }
      );
      return out;
    }
    await runFfmpeg(
      [
        "-loglevel",
        "error",
        ...a ? ["-i", a.file] : ["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE$1}:cl=stereo`],
        "-af",
        [
          `aresample=${SAMPLE_RATE$1}`,
          "aformat=sample_fmts=s16:channel_layouts=stereo",
          "adelay=100:all=1",
          `apad=whole_len=${samples}`,
          `atrim=end_sample=${samples}`,
          ...fades
        ].join(","),
        "-c:a",
        "pcm_s16le",
        "-ar",
        String(SAMPLE_RATE$1),
        "-ac",
        "2",
        out
      ],
      { signal }
    );
    return out;
  };
  let encoder = await currentEncoder();
  const segFiles = [];
  let reused = 0;
  for (let i = 0; i < n; i++) {
    check();
    const base = 0.35 + i / n * 0.55;
    const stage2 = `Dựng cảnh ${i + 1}/${n} (${encoderLabel[encoder]})`;
    report.progress(base, stage2);
    try {
      const seg = await renderSegment(i, encoder, (r) => report.progress(base + r * 0.55 / n, stage2));
      segFiles.push(seg.file);
      if (seg.cached) reused++;
    } catch (err) {
      if (signal.aborted || encoder === "libx264") throw err;
      report.note(`${encoderLabel[encoder]} lỗi khi mã hóa → chuyển sang CPU libx264`);
      encoder = "libx264";
      segFiles.length = 0;
      reused = 0;
      i = -1;
    }
  }
  if (reused) report.note(`Dùng lại ${reused}/${n} cảnh đã dựng từ lần render trước – chỉ dựng ${n - reused} cảnh mới hoặc đã sửa`);
  check();
  report.progress(0.9, "Chuẩn bị âm thanh");
  const wavs = [];
  for (let i = 0; i < n; i++) wavs.push(await renderAudio(i));
  node_fs.writeFileSync(node_path.join(jobDir, "video.txt"), segFiles.map(concatLine$1).join("\n") + "\n", "utf8");
  node_fs.writeFileSync(node_path.join(jobDir, "audio.txt"), wavs.map(concatLine$1).join("\n") + "\n", "utf8");
  const inputs = ["-f", "concat", "-safe", "0", "-i", "video.txt", "-f", "concat", "-safe", "0", "-i", "audio.txt"];
  const filters = [];
  if (hasBgm) {
    inputs.push("-stream_loop", "-1", "-i", bgmFile);
    filters.push(
      `[2:a]aresample=${SAMPLE_RATE$1},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${project.bgmVolume.toFixed(2)},atrim=0:${total2.toFixed(3)}[bg]`,
      `[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vo1][vo2]`,
      "[bg][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[bgd]",
      "[vo2][bgd]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]"
    );
  } else {
    filters.push("[1:a]alimiter=limit=0.95[aout]");
  }
  const outTmp = node_path.join(jobDir, "out.mp4");
  await runFfmpeg(
    [
      "-loglevel",
      "error",
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "0:v",
      "-map",
      "[aout]",
      // Hình đã mã hóa ở từng đoạn → chỉ nối, không mã hóa lại
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      String(SAMPLE_RATE$1),
      "-t",
      total2.toFixed(3),
      "-movflags",
      "+faststart",
      outTmp
    ],
    { cwd: jobDir, signal, totalSec: total2, onProgress: (r) => report.progress(0.9 + r * 0.06, "Ghép các cảnh & trộn âm thanh") }
  );
  check();
  report.progress(0.96, "Tạo thumbnail & cập nhật kho");
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const renders = node_path.join(mediaDir(), "renders");
  const thumbs = node_path.join(mediaDir(), "thumbs");
  node_fs.mkdirSync(renders, { recursive: true });
  node_fs.mkdirSync(thumbs, { recursive: true });
  const outFile = node_path.join(renders, `${project.id.slice(0, 8)}-${stamp}.mp4`);
  node_fs.renameSync(outTmp, outFile);
  const thumbFile = node_path.join(thumbs, `${project.id.slice(0, 8)}-${stamp}.jpg`);
  await runFfmpeg(
    ["-loglevel", "error", "-ss", Math.min(1, total2 / 2).toFixed(2), "-i", outFile, "-frames:v", "1", "-vf", `scale=${W >= H ? 960 : 540}:-1`, "-q:v", "3", thumbFile],
    { signal }
  );
  db2.transaction((tx) => {
    const values = {
      workspaceId,
      kind: "video",
      title: project.topic.slice(0, 300),
      aspect,
      durationSec: Math.round(total2 * 10) / 10,
      source: "studio",
      mediaPaths: [rel$3(outFile)],
      thumbnailPath: rel$3(thumbFile)
    };
    const existing = project.contentItemId ? tx.select().from(contentItems).where(drizzleOrm.eq(contentItems.id, project.contentItemId)).get() : void 0;
    if (existing) {
      tx.update(contentItems).set({ ...values, ...existing.status === "draft" ? { status: "ready" } : {}, caption: existing.caption ?? scenes[0].voiceover, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, existing.id)).run();
    } else {
      const id2 = newId();
      tx.insert(contentItems).values({ id: id2, ...values, caption: scenes[0].voiceover, status: "ready" }).run();
      tx.update(videoProjects).set({ contentItemId: id2 }).where(drizzleOrm.eq(videoProjects.id, project.id)).run();
    }
    tx.update(videoProjects).set({ status: "rendered", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, project.id)).run();
    tx.insert(activityLog).values({ level: "ok", scope: "render", message: `Render xong "${project.topic.slice(0, 60)}" (${total2.toFixed(1)}s, ${encoderLabel[encoder]})` }).run();
  });
  const keep = new Set(segFiles.map((f) => node_path.basename(f)));
  for (const f of node_fs.readdirSync(segDir)) if (!keep.has(f)) node_fs.rmSync(node_path.join(segDir, f), { force: true });
  node_fs.rmSync(jobDir, { recursive: true, force: true });
  return { outputPath: rel$3(outFile), encoder, durationSec: Math.round(total2 * 100) / 100 };
}
let running$2 = null;
const sceneStates = /* @__PURE__ */ new Map();
function recoverInterruptedJobs() {
  getDb().update(renderJobs).set({ status: "failed", error: "Ứng dụng đã đóng khi đang render", finishedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(renderJobs.status, "running")).run();
  void kick$1();
}
function enqueueRender(projectId) {
  const db2 = getDb();
  const project = db2.select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, projectId)).get();
  if (!project) throw notFound("dự án video");
  const sceneCount = db2.select({ id: videoScenes.id }).from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, projectId)).all().length;
  if (!sceneCount) throw new ApiError("VALIDATION", "Dự án chưa có phân cảnh để render");
  const pending2 = db2.select({ id: renderJobs.id }).from(renderJobs).where(drizzleOrm.and(drizzleOrm.eq(renderJobs.projectId, projectId), drizzleOrm.inArray(renderJobs.status, ["queued", "running"]))).get();
  if (pending2) throw new ApiError("CONFLICT", "Dự án này đang trong hàng đợi render");
  const job = db2.insert(renderJobs).values({ id: newId(), projectId, stage: "Đang chờ trong hàng đợi" }).returning().get();
  void kick$1();
  return { ...job, projectTopic: project.topic };
}
function cancelRender(id2) {
  const db2 = getDb();
  const job = db2.select().from(renderJobs).where(drizzleOrm.eq(renderJobs.id, id2)).get();
  if (!job) throw notFound("job render");
  if (job.status === "queued") {
    db2.update(renderJobs).set({ status: "cancelled", stage: "Đã hủy", finishedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(renderJobs.id, id2)).run();
  } else if (job.status === "running" && running$2?.id === id2) {
    running$2.ctl.abort();
  } else {
    throw new ApiError("CONFLICT", "Job đã kết thúc");
  }
}
function stopAllRenders() {
  running$2?.ctl.abort();
}
function listJobs(projectId, limit) {
  return getDb().select({ job: renderJobs, projectTopic: videoProjects.topic }).from(renderJobs).innerJoin(videoProjects, drizzleOrm.eq(videoProjects.id, renderJobs.projectId)).where(projectId ? drizzleOrm.eq(renderJobs.projectId, projectId) : void 0).orderBy(drizzleOrm.desc(renderJobs.createdAt)).limit(limit).all().map((r) => ({ ...r.job, projectTopic: r.projectTopic, scenes: sceneStates.get(r.job.id) ?? null }));
}
function mediaStatus(encoder) {
  const db2 = getDb();
  const run2 = db2.select({ id: renderJobs.id, progress: renderJobs.progress, stage: renderJobs.stage, topic: videoProjects.topic }).from(renderJobs).innerJoin(videoProjects, drizzleOrm.eq(videoProjects.id, renderJobs.projectId)).where(drizzleOrm.eq(renderJobs.status, "running")).get();
  const queued = db2.select({ id: renderJobs.id }).from(renderJobs).where(drizzleOrm.eq(renderJobs.status, "queued")).all().length;
  return { encoder, running: run2 ?? null, queued };
}
async function kick$1() {
  if (running$2 || !currentUser()) return;
  const db2 = getDb();
  const next = db2.select().from(renderJobs).where(drizzleOrm.eq(renderJobs.status, "queued")).orderBy(drizzleOrm.asc(renderJobs.createdAt)).get();
  if (!next) return;
  const ctl2 = new AbortController();
  running$2 = { id: next.id, ctl: ctl2 };
  const notes = [];
  db2.update(renderJobs).set({ status: "running", startedAt: /* @__PURE__ */ new Date(), progress: 0, stage: "Bắt đầu", notes: [] }).where(drizzleOrm.eq(renderJobs.id, next.id)).run();
  db2.update(videoProjects).set({ status: "rendering", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, next.projectId)).run();
  const startedAt = Date.now();
  console.info(`[render] bắt đầu job ${next.id.slice(0, 8)}`);
  let lastWrite = 0;
  const report = {
    progress: (ratio, stage2) => {
      const now2 = Date.now();
      if (now2 - lastWrite < 250) return;
      lastWrite = now2;
      db2.update(renderJobs).set({ progress: Math.round(ratio * 1e3) / 1e3, stage: stage2 }).where(drizzleOrm.eq(renderJobs.id, next.id)).run();
    },
    scene: (index, patch) => {
      const list2 = sceneStates.get(next.id) ?? [];
      const cur = list2[index] ?? { index, status: "waiting", source: null, text: null, progress: null, startedAt: null };
      list2[index] = { ...cur, ...patch, index };
      sceneStates.set(next.id, list2);
    },
    note: (message) => {
      notes.push(message);
      console.warn(`[render] ${next.id.slice(0, 8)}: ${message}`);
      db2.update(renderJobs).set({ notes: [...notes] }).where(drizzleOrm.eq(renderJobs.id, next.id)).run();
    }
  };
  try {
    const res = await renderProject(next.id, ctl2.signal, report);
    db2.update(renderJobs).set({ status: "done", progress: 1, stage: "Hoàn tất", outputPath: res.outputPath, encoder: res.encoder, finishedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(renderJobs.id, next.id)).run();
    console.info(
      `[render] xong job ${next.id.slice(0, 8)} · ${res.durationSec.toFixed(1)}s video · ${res.encoder} · ${Math.round((Date.now() - startedAt) / 1e3)}s${notes.length ? ` · ${notes.length} cảnh báo` : ""}`
    );
  } catch (err) {
    const cancelled = ctl2.signal.aborted;
    const message = err instanceof Error ? err.message : String(err);
    db2.update(renderJobs).set({ status: cancelled ? "cancelled" : "failed", stage: cancelled ? "Đã hủy" : "Lỗi", error: cancelled ? null : message, finishedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(renderJobs.id, next.id)).run();
    db2.update(videoProjects).set({ status: "scripted", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, next.projectId)).run();
    if (!cancelled) {
      console.error("[render] job lỗi", next.id, message);
      db2.insert(alerts).values({
        id: newId(),
        severity: "error",
        kind: "render_failed",
        entityType: "render_job",
        entityId: next.id,
        title: "Render video thất bại",
        message: message.slice(0, 300)
      }).run();
      db2.insert(activityLog).values({ level: "error", scope: "render", message: `Render lỗi: ${message.slice(0, 120)}` }).run();
    }
  } finally {
    running$2 = null;
    void kick$1();
  }
}
const GRAPH_VERSION = "v23.0";
const graphBase = () => process.env.OMNI_GRAPH_BASE ?? "https://graph.facebook.com";
const graphVideoBase = () => process.env.OMNI_GRAPH_VIDEO_BASE ?? process.env.OMNI_GRAPH_BASE ?? "https://graph-video.facebook.com";
const ruploadBase = () => process.env.OMNI_RUPLOAD_BASE ?? "https://rupload.facebook.com";
const tiktokBase = () => process.env.OMNI_TIKTOK_BASE ?? "https://open.tiktokapis.com";
class PublishError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
    this.name = "PublishError";
  }
}
const TIMEOUT_MS$1 = 6e4;
function withTimeout(signal, ms = TIMEOUT_MS$1) {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}
async function doFetch(url, init, signal, timeoutMs) {
  try {
    return await fetch(url, { ...init, signal: withTimeout(signal, timeoutMs) });
  } catch (err) {
    if (signal.aborted) throw err;
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new PublishError("transient", timeout ? "Hết thời gian chờ phản hồi từ nền tảng" : `Không kết nối được: ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function readBody(res) {
  const text = await res.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text.slice(0, 200) };
  }
}
function graphError(status2, body) {
  const e = body?.error;
  const detail2 = e?.error_user_msg || e?.message || (status2 ? `HTTP ${status2}` : "Lỗi không rõ");
  const code = e?.code ?? 0;
  const msg = `${detail2}${code ? ` (mã ${code}${e?.error_subcode ? `/${e.error_subcode}` : ""})` : ""}`;
  if (code === 190 || code === 102 || code === 10 || code >= 200 && code < 300 || status2 === 401) return new PublishError("auth", msg);
  if ([4, 17, 32, 341, 368, 613, 80001].includes(code) || status2 === 429) return new PublishError("rate_limit", msg);
  if (e?.is_transient || code === 1 || code === 2 || status2 >= 500) return new PublishError("transient", msg);
  return new PublishError("permanent", msg);
}
async function graph(method, path, opts) {
  const url = new URL(`${(opts.base ?? graphBase()).replace(/\/$/, "")}/${GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== void 0) url.searchParams.set(k, String(v));
  const headers = opts.token ? { Authorization: `OAuth ${opts.token}` } : {};
  let body;
  if (opts.multipart) body = opts.multipart;
  else if (opts.form) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.form)) if (v !== void 0) p.set(k, String(v));
    body = p;
  }
  const res = await doFetch(url.toString(), { method, headers, body }, opts.signal, opts.timeoutMs);
  const json2 = await readBody(res);
  if (!res.ok || json2?.error) throw graphError(res.status, json2);
  return json2;
}
async function fileForm(fields, fileField, file2, mime, name) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== void 0) fd.set(k, String(v));
  const buf = await promises$1.readFile(file2);
  fd.set(fileField, new Blob([buf], { type: mime }), name ?? file2.split(/[\\/]/).pop() ?? "media");
  return fd;
}
async function ruploadFile(url, token2, file2, signal) {
  const buf = await promises$1.readFile(file2);
  const res = await doFetch(
    url,
    {
      method: "POST",
      headers: { Authorization: `OAuth ${token2}`, offset: "0", file_size: String(buf.length), "Content-Type": "application/octet-stream" },
      body: buf
    },
    signal,
    10 * 6e4
  );
  const json2 = await readBody(res);
  if (!res.ok || json2?.error) throw graphError(res.status, json2);
}
function tiktokError(status2, body) {
  const e = body?.error;
  const code = e?.code ?? "";
  const detail2 = e?.message || `HTTP ${status2}`;
  const hints = {
    unaudited_client_can_only_post_to_private_accounts: "Ứng dụng TikTok chưa được TikTok duyệt – chỉ đăng được lên tài khoản để riêng tư",
    spam_risk_too_many_posts: "TikTok chặn vì đăng quá nhiều bài trong ngày",
    spam_risk_user_banned_from_posting: "Tài khoản TikTok đang bị cấm đăng bài",
    reached_active_user_cap: "Ứng dụng TikTok đã chạm giới hạn người dùng hoạt động trong ngày",
    privacy_level_option_mismatch: "Chế độ riêng tư không nằm trong các lựa chọn tài khoản cho phép"
  };
  const msg = `${hints[code] ?? detail2}${code ? ` (${code})` : ""}`;
  if (code === "access_token_invalid" || code === "scope_not_authorized" || code === "scope_permission_missed" || status2 === 401) return new PublishError("auth", msg);
  if (code === "rate_limit_exceeded" || code === "spam_risk_too_many_posts" || status2 === 429) return new PublishError("rate_limit", msg);
  if (status2 >= 500 || code === "internal_error") return new PublishError("transient", msg);
  return new PublishError("permanent", msg);
}
async function tiktok(path, opts) {
  const url = new URL(`${tiktokBase().replace(/\/$/, "")}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const res = await doFetch(
    url.toString(),
    {
      method: opts.method ?? "POST",
      headers: { Authorization: `Bearer ${opts.token}`, ...opts.json !== void 0 ? { "Content-Type": "application/json; charset=UTF-8" } : {} },
      body: opts.json !== void 0 ? JSON.stringify(opts.json) : void 0
    },
    opts.signal
  );
  const json2 = await readBody(res);
  if (!res.ok || json2?.error?.code && json2.error.code !== "ok") throw tiktokError(res.status, json2);
  return json2?.data ?? {};
}
async function tiktokOAuth(form, signal, label = "Làm mới token TikTok thất bại") {
  const res = await doFetch(
    `${tiktokBase().replace(/\/$/, "")}/v2/oauth/token/`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) },
    signal
  );
  const json2 = await readBody(res);
  if (!res.ok || json2?.error) {
    const msg = `${label}: ${json2?.error_description || json2?.error || `HTTP ${res.status}`}`;
    throw new PublishError(res.status >= 500 ? "transient" : "auth", msg);
  }
  return json2;
}
async function tiktokPutChunk(url, chunk, start2, total2, signal) {
  const res = await doFetch(
    url,
    {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start2}-${start2 + chunk.length - 1}/${total2}`
      },
      body: chunk
    },
    signal,
    10 * 6e4
  );
  await res.text().catch(() => "");
  if (res.status !== 201 && res.status !== 206 && !res.ok) {
    throw new PublishError(res.status >= 500 ? "transient" : "permanent", `Upload video lên TikTok lỗi HTTP ${res.status}`);
  }
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t2 = setTimeout(resolve, ms);
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(t2);
      reject(signal.reason);
    },
    { once: true }
  );
});
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
function openAuthWindow(o) {
  if (pending && !pending.isDestroyed()) {
    pending.focus();
    return Promise.reject(new PublishError("permanent", "Đang có một cửa sổ đăng nhập mở – hoàn tất hoặc đóng nó trước"));
  }
  const ses = electron.session.fromPartition(`oauth-${o.state}`, { cache: false });
  const win = new electron.BrowserWindow({
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
      clearTimeout(timer2);
      pending = null;
      if (!win.isDestroyed()) win.close();
      void ses.clearStorageData().catch(() => void 0);
      if (err) reject(err);
      else resolve(params);
    };
    const timer2 = setTimeout(() => finish(new PublishError("permanent", `Hết thời gian đăng nhập ${o.provider} (10 phút)`)), 10 * 6e4);
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
let cache = null;
const toPublishError = (e, what) => {
  if (e instanceof PublishError) return e;
  if (e instanceof CloudError) return new PublishError(e.offline ? "transient" : e.status === 401 ? "auth" : "permanent", `${what}: ${e.message}`);
  return new PublishError("transient", `${what}: ${e instanceof Error ? e.message : String(e)}`);
};
async function cloudOAuthConfig(force = false) {
  if (!force && cache && Date.now() - cache.at < 5 * 6e4) return cache.cfg;
  const token2 = cloudCustomerToken();
  if (!token2) return cache?.cfg ?? null;
  try {
    const cfg = await cloud("/api/client/v1/oauth/config", { token: token2, timeoutMs: 1e4 });
    cache = { at: Date.now(), cfg };
    return cfg;
  } catch {
    return cache?.cfg ?? null;
  }
}
async function cloudOAuthEnabled(p) {
  return !!(await cloudOAuthConfig())?.[p]?.enabled;
}
let cancelExternal = null;
function cancelCloudLogin() {
  cancelExternal?.();
}
async function cloudLogin(p, scopes, ui) {
  const token2 = cloudCustomerToken();
  if (!token2) throw new PublishError("auth", "Phiên đăng nhập Omnira đã hết – đăng xuất rồi đăng nhập lại");
  let start2;
  try {
    start2 = await cloud(`/api/client/v1/oauth/${p}/start`, { method: "POST", body: { scopes: scopes || null }, token: token2 });
  } catch (e) {
    throw toPublishError(e, `Không bắt đầu được đăng nhập ${ui.provider}`);
  }
  const appId = new URL(start2.authUrl).searchParams;
  console.info(
    `[oauth] ${ui.provider}: bắt đầu đăng nhập qua Omnira Cloud · app ${appId.get("client_key") ?? appId.get("client_id") ?? "?"} · redirect ${start2.redirectUri}`
  );
  let polls = 20;
  if (ui.external) {
    if (process.env.OMNI_OAUTH_FETCH === "1") void fetch(start2.authUrl).catch(() => void 0);
    else await electron.shell.openExternal(start2.authUrl);
    polls = 600;
  } else {
    const state2 = new URL(start2.authUrl).searchParams.get("state") ?? "";
    const params = await openAuthWindow({
      url: start2.authUrl,
      redirectUri: start2.redirectUri,
      state: state2,
      title: ui.title,
      provider: ui.provider,
      parent: ui.parent,
      blocked: ui.blocked,
      lostFlow: ui.lostFlow
    });
    try {
      await fetch(`${start2.redirectUri}?${params.toString()}`, { signal: AbortSignal.timeout(45e3) });
    } catch (e) {
      throw toPublishError(e, `Không gửi được kết quả đăng nhập ${ui.provider} lên Omnira Cloud`);
    }
  }
  let cancelled = false;
  cancelExternal = () => cancelled = true;
  try {
    return await pollSession(start2.sessionId, token2, ui.provider, polls, () => cancelled);
  } finally {
    cancelExternal = null;
  }
}
async function pollSession(sessionId, token2, provider, polls, cancelled) {
  for (let i = 0; i < polls; i++) {
    if (cancelled()) throw new PublishError("permanent", `Đã hủy kết nối ${provider}`);
    let r;
    try {
      r = await cloud(`/api/client/v1/oauth/sessions/${sessionId}`, { token: token2 });
    } catch (e) {
      throw toPublishError(e, `Không nhận được token ${provider}`);
    }
    if (r.status === "DONE" && r.token) {
      console.info(`[oauth] ${provider}: Omnira Cloud đã đổi mã lấy token`);
      return r.token;
    }
    if (r.status === "ERROR") {
      const msg = r.error ?? "đăng nhập không thành công";
      console.warn(`[oauth] ${provider}: Omnira Cloud báo lỗi – ${msg}`);
      throw new PublishError("permanent", /hủy|denied|từ chối/i.test(msg) ? "Bạn đã hủy / từ chối cấp quyền" : `${provider}: ${msg}`);
    }
    if (r.status === "EXPIRED" || r.status === "CONSUMED") throw new PublishError("permanent", `Phiên đăng nhập ${provider} đã hết hạn – thử lại`);
    await new Promise((res) => setTimeout(res, polls > 100 ? 1500 : 800));
  }
  throw new PublishError("transient", `Chưa nhận được kết quả đăng nhập ${provider} – thử lại`);
}
async function cloudRefresh(p, tokenValue) {
  const token2 = cloudCustomerToken();
  if (!token2) throw new PublishError("auth", "Phiên đăng nhập Omnira đã hết – đăng nhập lại để làm mới token kênh");
  try {
    return await cloud(`/api/client/v1/oauth/${p}/refresh`, { method: "POST", body: { token: tokenValue }, token: token2 });
  } catch (e) {
    if (e instanceof CloudError && e.code === "OAUTH_ERROR") throw new PublishError("auth", `Làm mới token thất bại – kết nối lại kênh (${e.message})`);
    throw toPublishError(e, "Làm mới token qua Omnira Cloud thất bại");
  }
}
function readCred(channelId) {
  const raw = readSecret("channel", channelId, "access_token");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.token === "string") return v;
  } catch {
  }
  return { token: raw };
}
function writeCred(channelId, cred) {
  putSecret({ kind: "access_token", ownerType: "channel", ownerId: channelId, value: JSON.stringify(cred), expiresAt: cred.expiresAt ? new Date(cred.expiresAt) : null });
  getDb().update(secrets).set({ preview: maskSecret(cred.token) }).where(drizzleOrm.and(drizzleOrm.eq(secrets.ownerType, "channel"), drizzleOrm.eq(secrets.ownerId, channelId), drizzleOrm.eq(secrets.kind, "access_token"))).run();
}
function clearCred(channelId) {
  deleteSecret("channel", channelId, "access_token");
}
const DAY$6 = 864e5;
function statusFor(expiresAt) {
  if (!expiresAt) return "valid";
  const left = expiresAt - Date.now();
  return left <= 0 ? "expired" : left < 3 * DAY$6 ? "expiring" : "valid";
}
function markChannel(channelId, patch) {
  const row = getDb().update(channels).set({ ...patch, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(channels.id, channelId)).returning().get();
  if (!row) throw new PublishError("permanent", "Kênh không tồn tại");
  return row;
}
const PAGE_FIELDS = "id,name,access_token,fan_count,picture{url},instagram_business_account{id,username,followers_count,profile_picture_url}";
const BASIC_PAGE_FIELDS = "id,name,access_token,fan_count,picture{url}";
async function withIgFallback(call, onIgError) {
  try {
    return await call(true);
  } catch (err) {
    if (!(err instanceof PublishError) || !/instagram/i.test(err.message)) throw err;
    onIgError?.(err.message);
    return call(false);
  }
}
async function inspectFbToken(token2, signal) {
  try {
    const page = await withIgFallback(
      (ig) => graph("GET", "me", { token: token2, signal, query: { fields: `id,name,category,fan_count,picture{url}${ig ? ",instagram_business_account{id,username,followers_count,profile_picture_url}" : ""}` } })
    );
    return { type: "page", page: { ...page, access_token: token2 } };
  } catch (err) {
    if (!(err instanceof PublishError) || err.kind !== "permanent") throw err;
  }
  const me = await graph("GET", "me", { token: token2, signal, query: { fields: "id,name" } });
  const pages = [];
  let igError = null;
  let after;
  for (let i = 0; i < 10; i++) {
    const res = await withIgFallback(
      (ig) => graph("GET", "me/accounts", { token: token2, signal, query: { fields: ig ? PAGE_FIELDS : BASIC_PAGE_FIELDS, limit: 100, after } }),
      (m) => igError ??= m
    );
    pages.push(...res.data);
    after = res.paging?.next ? res.paging.cursors?.after : void 0;
    if (!after) break;
  }
  return { type: "user", userName: me.name, pages, igError };
}
async function exchangeLongLived(userToken, appId, appSecret, signal) {
  const res = await graph("GET", "oauth/access_token", {
    token: userToken,
    signal,
    query: { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: userToken }
  });
  return { token: res.access_token, expiresAt: res.expires_in ? Date.now() + res.expires_in * 1e3 : null };
}
async function tokenExpiry(token2, signal) {
  try {
    const r = await graph("GET", "debug_token", { token: token2, signal, query: { input_token: token2 } });
    if (r.data?.is_valid === false) throw new PublishError("auth", "Token không còn hiệu lực");
    return r.data?.expires_at ? r.data.expires_at * 1e3 : null;
  } catch (err) {
    if (err instanceof PublishError && err.kind === "auth" && err.message === "Token không còn hiệu lực") throw err;
    return null;
  }
}
async function tiktokUser(token2, signal) {
  const r = await tiktok("/v2/user/info/", { token: token2, signal, method: "GET", query: { fields: "open_id,display_name,avatar_url" } });
  if (!r.user?.open_id) throw new PublishError("auth", "TikTok không trả thông tin người dùng – kiểm tra quyền user.info.basic");
  return r.user;
}
async function freshTikTokCred(channelId, cred, signal) {
  if (!cred.expiresAt || cred.expiresAt - Date.now() > 10 * 6e4) return cred;
  if (cred.viaCloud && cred.refreshToken) {
    const r2 = await cloudRefresh("tiktok", cred.refreshToken);
    const next2 = { ...cred, token: r2.access_token, refreshToken: r2.refresh_token ?? cred.refreshToken, expiresAt: Date.now() + r2.expires_in * 1e3 };
    writeCred(channelId, next2);
    markChannel(channelId, { tokenStatus: "valid", tokenExpiresAt: new Date(next2.expiresAt) });
    console.info(`[publish] đã làm mới token TikTok (qua Omnira Cloud) cho kênh ${channelId.slice(0, 8)}`);
    return next2;
  }
  const clientSecret = cred.clientSecret ?? readSecret("integration", "tiktok", "api_key");
  if (!cred.refreshToken || !cred.clientKey || !clientSecret) {
    if (cred.expiresAt <= Date.now()) throw new PublishError("auth", "Access token TikTok đã hết hạn – dán token mới hoặc thêm refresh token + client key/secret để tự làm mới");
    return cred;
  }
  const r = await tiktokOAuth(
    { client_key: cred.clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: cred.refreshToken },
    signal
  );
  const next = { ...cred, token: r.access_token, refreshToken: r.refresh_token ?? cred.refreshToken, expiresAt: Date.now() + r.expires_in * 1e3 };
  writeCred(channelId, next);
  markChannel(channelId, { tokenStatus: "valid", tokenExpiresAt: new Date(next.expiresAt) });
  console.info(`[publish] đã làm mới token TikTok cho kênh ${channelId.slice(0, 8)}`);
  return next;
}
const IMAGE_EXT = /* @__PURE__ */ new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXT$1 = /* @__PURE__ */ new Set([".mp4", ".mov", ".m4v"]);
const mimeOf$1 = (f) => {
  const e = node_path.extname(f).toLowerCase();
  return e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : e === ".mov" ? "video/quicktime" : VIDEO_EXT$1.has(e) ? "video/mp4" : "image/jpeg";
};
function mediaFiles(content) {
  const files = content.mediaPaths.map((p) => node_path.isAbsolute(p) ? p : node_path.join(mediaDir(), p));
  const missing = files.filter((f) => !node_fs.existsSync(f));
  if (missing.length) throw new PublishError("permanent", `Không tìm thấy file media: ${missing.map((f) => f.split(/[\\/]/).pop()).join(", ")}`);
  return {
    images: files.filter((f) => IMAGE_EXT.has(node_path.extname(f).toLowerCase())),
    videos: files.filter((f) => VIDEO_EXT$1.has(node_path.extname(f).toLowerCase()))
  };
}
function composeCaption(content, max = 63206) {
  const tags = [
    ...new Set(
      content.hashtags.map((t2) => t2.trim()).filter(Boolean).map((t2) => t2.startsWith("#") ? t2 : `#${t2}`)
    )
  ];
  const base = (content.caption ?? content.title).trim();
  const text = tags.length ? `${base}

${tags.join(" ")}` : base;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
const needPageId = (cred) => {
  if (!cred.pageId) throw new PublishError("auth", "Thiếu ID Fanpage trong thông tin kết nối – kết nối lại token cho kênh");
  return cred.pageId;
};
const CHUNKED_FROM_BYTES = 40 * 1024 * 1024;
async function facebookChunkedVideo(pageId, token2, file2, fields, signal, stage2) {
  const size = node_fs.statSync(file2).size;
  const base = graphVideoBase();
  stage2("Khởi tạo upload video");
  const start2 = await graph("POST", `${pageId}/videos`, {
    token: token2,
    signal,
    base,
    form: { upload_phase: "start", file_size: String(size) }
  });
  let from = Number(start2.start_offset);
  let to = Number(start2.end_offset);
  const fh = await promises$1.open(file2, "r");
  try {
    let retries = 0;
    while (from < size) {
      const len = Math.max(0, Math.min(to, size) - from);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, from);
      const fd = new FormData();
      fd.append("upload_phase", "transfer");
      fd.append("upload_session_id", start2.upload_session_id);
      fd.append("start_offset", String(from));
      fd.append("video_file_chunk", new Blob([buf]), "video.mp4");
      try {
        const r = await graph("POST", `${pageId}/videos`, { token: token2, signal, base, multipart: fd, timeoutMs: 5 * 6e4 });
        from = Number(r.start_offset);
        to = Number(r.end_offset);
        retries = 0;
        stage2(`Đang upload video ${Math.min(100, Math.round(from / size * 100))}%`);
      } catch (err) {
        if (signal.aborted || !(err instanceof PublishError) || err.kind !== "transient" || retries >= 3) throw err;
        retries++;
        stage2(`Upload lỗi mạng – gửi lại đoạn (lần ${retries}/3)`);
        await sleep(2e3 * retries, signal);
      }
    }
  } finally {
    await fh.close();
  }
  stage2("Xuất bản video");
  const finish = (f) => graph("POST", `${pageId}/videos`, { token: token2, signal, base, form: { upload_phase: "finish", upload_session_id: start2.upload_session_id, ...f } });
  await finish({ description: fields.description, title: fields.title || void 0 }).catch((err) => {
    if (!nameTooLong(err)) throw err;
    stage2("Facebook từ chối tiêu đề – xuất bản lại không kèm tiêu đề");
    return finish({ description: fields.description });
  });
  return start2.video_id;
}
function fbVideoTitle(title) {
  const t2 = title.replace(/\s+/g, " ").trim();
  if (t2.length <= 80) return t2;
  const cut = t2.slice(0, 80);
  return (cut.lastIndexOf(" ") > 40 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s,.;:–-]+$/, "");
}
const nameTooLong = (err) => err instanceof PublishError && err.kind === "permanent" && /tên (file|tệp)|file ?name|name .*too long|quá dài/i.test(err.message);
async function publishFacebook({ cred, content, signal, stage: stage2 }) {
  const pageId = needPageId(cred);
  const token2 = cred.token;
  const message = composeCaption(content);
  const { images, videos } = content.kind === "text" ? { images: [], videos: [] } : mediaFiles(content);
  const permalinkOf = async (id2) => {
    try {
      return (await graph("GET", id2, { token: token2, signal, query: { fields: "permalink_url" } })).permalink_url ?? null;
    } catch {
      return null;
    }
  };
  if (videos.length) {
    const file2 = videos[0];
    const vertical = content.kind === "reel" || content.aspect === "9:16" && (content.durationSec ?? 0) <= 90;
    if (vertical) {
      stage2("Khởi tạo Reel");
      const start2 = await graph("POST", `${pageId}/video_reels`, { token: token2, signal, form: { upload_phase: "start" } });
      stage2("Đang upload video");
      await ruploadFile(start2.upload_url ?? `${ruploadBase()}/video-upload/${GRAPH_VERSION}/${start2.video_id}`, token2, file2, signal);
      stage2("Xuất bản Reel");
      await graph("POST", `${pageId}/video_reels`, { token: token2, signal, form: { upload_phase: "finish", video_id: start2.video_id, video_state: "PUBLISHED", description: message } });
      return { externalId: start2.video_id, permalink: `https://www.facebook.com/reel/${start2.video_id}` };
    }
    if (node_fs.statSync(file2).size > CHUNKED_FROM_BYTES) {
      const id2 = await facebookChunkedVideo(pageId, token2, file2, { description: message, title: fbVideoTitle(content.title) }, signal, stage2);
      return { externalId: id2, permalink: `https://www.facebook.com/${pageId}/videos/${id2}` };
    }
    stage2("Đang upload video");
    const upload = async (title) => graph("POST", `${pageId}/videos`, {
      token: token2,
      signal,
      multipart: await fileForm({ description: message, title }, "source", file2, mimeOf$1(file2), "video.mp4"),
      base: graphVideoBase(),
      timeoutMs: 10 * 6e4
    });
    const r2 = await upload(fbVideoTitle(content.title) || void 0).catch((err) => {
      if (!nameTooLong(err)) throw err;
      stage2("Facebook từ chối tiêu đề – upload lại không kèm tiêu đề");
      return upload(void 0);
    });
    return { externalId: r2.id, permalink: `https://www.facebook.com/${pageId}/videos/${r2.id}` };
  }
  if (images.length === 1) {
    stage2("Đang upload ảnh");
    const fd = await fileForm({ caption: message }, "source", images[0], mimeOf$1(images[0]));
    const r2 = await graph("POST", `${pageId}/photos`, { token: token2, signal, multipart: fd, timeoutMs: 3 * 6e4 });
    const id2 = r2.post_id ?? r2.id;
    return { externalId: id2, permalink: await permalinkOf(id2) };
  }
  if (images.length > 1) {
    const ids = [];
    for (const [i, img] of images.slice(0, 10).entries()) {
      stage2(`Đang upload ảnh ${i + 1}/${Math.min(images.length, 10)}`);
      const fd = await fileForm({ published: false }, "source", img, mimeOf$1(img));
      ids.push((await graph("POST", `${pageId}/photos`, { token: token2, signal, multipart: fd, timeoutMs: 3 * 6e4 })).id);
    }
    const form = { message };
    ids.forEach((id2, i) => form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id2 }));
    const r2 = await graph("POST", `${pageId}/feed`, { token: token2, signal, form });
    return { externalId: r2.id, permalink: await permalinkOf(r2.id) };
  }
  if (content.kind !== "text") throw new PublishError("permanent", "Nội dung chưa có file ảnh/video để đăng");
  const r = await graph("POST", `${pageId}/feed`, { token: token2, signal, form: { message } });
  return { externalId: r.id, permalink: await permalinkOf(r.id) };
}
async function publishInstagram({ cred, content, signal, stage: stage2 }) {
  if (!cred.igUserId) throw new PublishError("auth", "Thiếu ID tài khoản Instagram Business – kết nối lại token cho kênh");
  const token2 = cred.token;
  if (content.kind === "text") throw new PublishError("permanent", "Instagram không hỗ trợ bài chỉ có chữ");
  const { videos } = mediaFiles(content);
  if (!videos.length) {
    throw new PublishError("permanent", "Instagram API chỉ nhận ảnh qua URL công khai – hiện chỉ đăng được Reels/video từ máy. Hãy đăng ảnh lên Fanpage hoặc chuyển thành video");
  }
  const caption = composeCaption(content, 2200);
  stage2("Tạo container Reels");
  const container = await graph("POST", `${cred.igUserId}/media`, {
    token: token2,
    signal,
    form: { media_type: "REELS", upload_type: "resumable", caption, share_to_feed: true }
  });
  stage2("Đang upload video");
  await ruploadFile(container.uri ?? `${ruploadBase()}/ig-api-upload/${GRAPH_VERSION}/${container.id}`, token2, videos[0], signal);
  const started2 = Date.now();
  for (; ; ) {
    const st = await graph("GET", container.id, { token: token2, signal, query: { fields: "status_code,status" } });
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new PublishError("permanent", `Instagram không xử lý được video: ${st.status ?? st.status_code}`);
    if (Date.now() - started2 > 10 * 6e4) throw new PublishError("transient", "Instagram xử lý video quá 10 phút");
    stage2(`Instagram đang xử lý video (${Math.round((Date.now() - started2) / 1e3)}s)`);
    await sleep(5e3, signal);
  }
  stage2("Xuất bản");
  const r = await graph("POST", `${cred.igUserId}/media_publish`, { token: token2, signal, form: { creation_id: container.id } });
  let permalink = null;
  try {
    permalink = (await graph("GET", r.id, { token: token2, signal, query: { fields: "permalink" } })).permalink ?? null;
  } catch {
  }
  return { externalId: r.id, permalink };
}
const MB = 1024 * 1024;
function tiktokChunks(size) {
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}
async function publishTikTok({ cred, content, signal, stage: stage2 }) {
  const token2 = cred.token;
  if (content.kind !== "video" && content.kind !== "reel") throw new PublishError("permanent", "Kênh TikTok chỉ đăng video từ máy (ảnh TikTok yêu cầu URL công khai)");
  const { videos } = mediaFiles(content);
  if (!videos.length) throw new PublishError("permanent", "Nội dung chưa có file video");
  const file2 = videos[0];
  stage2("Kiểm tra quyền đăng TikTok");
  const info = await tiktok("/v2/post/publish/creator_info/query/", { token: token2, signal, json: {} });
  const max = info.max_video_post_duration_sec;
  if (max && content.durationSec && content.durationSec > max)
    throw new PublishError("permanent", `Video dài ${Math.round(content.durationSec)}s vượt giới hạn ${max}s của tài khoản TikTok`);
  const options = info.privacy_level_options ?? [];
  const privacy = options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0] ?? "SELF_ONLY";
  const note = privacy === "PUBLIC_TO_EVERYONE" ? void 0 : `TikTok chỉ cho phép chế độ "${privacy}" (ứng dụng chưa được TikTok duyệt hoặc tài khoản riêng tư)`;
  const size = node_fs.statSync(file2).size;
  const { chunkSize, count } = tiktokChunks(size);
  stage2("Khởi tạo upload");
  const init = await tiktok("/v2/post/publish/video/init/", {
    token: token2,
    signal,
    json: {
      post_info: {
        title: composeCaption(content, 2200),
        privacy_level: privacy,
        disable_comment: !!info.comment_disabled,
        disable_duet: !!info.duet_disabled,
        disable_stitch: !!info.stitch_disabled
      },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: count }
    }
  });
  const fh = await promises$1.open(file2, "r");
  try {
    for (let i = 0; i < count; i++) {
      const start2 = i * chunkSize;
      const len = i === count - 1 ? size - start2 : chunkSize;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start2);
      stage2(`Đang upload video ${Math.round((i + 1) / count * 100)}%`);
      await tiktokPutChunk(init.upload_url, buf, start2, size, signal);
    }
  } finally {
    await fh.close();
  }
  const started2 = Date.now();
  for (; ; ) {
    const st = await tiktok("/v2/post/publish/status/fetch/", {
      token: token2,
      signal,
      json: { publish_id: init.publish_id }
    });
    if (st.status === "PUBLISH_COMPLETE") {
      const postId = st.publicaly_available_post_id?.[0];
      return {
        externalId: postId ? String(postId) : init.publish_id,
        permalink: postId && info.creator_username ? `https://www.tiktok.com/@${info.creator_username}/video/${postId}` : null,
        note
      };
    }
    if (st.status === "FAILED") throw new PublishError("permanent", `TikTok từ chối video: ${st.fail_reason ?? "không rõ lý do"}`);
    if (Date.now() - started2 > 5 * 6e4) {
      return { externalId: init.publish_id, permalink: null, note: [note, "TikTok vẫn đang xử lý video sau 5 phút – kiểm tra trong ứng dụng TikTok"].filter(Boolean).join(". ") };
    }
    stage2(`TikTok đang xử lý (${Math.round((Date.now() - started2) / 1e3)}s)`);
    await sleep(5e3, signal);
  }
}
const PAGE = (title, body, ok) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,Segoe UI,sans-serif;background:#0B0F17;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.c{background:#151D2A;border:1px solid #1E293B;border-radius:16px;padding:32px 40px;max-width:460px;text-align:center}h1{font-size:20px;color:${ok ? "#4ade80" : "#f87171"}}p{color:#94a3b8;line-height:1.5}</style></head><body><div class="c"><h1>${title}</h1><p>${body}</p></div></body></html>`;
let active$2 = null;
function cancelLoopbackAuth() {
  active$2?.cancel();
}
async function loopbackAuth(opts) {
  active$2?.cancel();
  return new Promise((resolve, reject) => {
    let done = false;
    const server = node_http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/oauth/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        err ? PAGE(
          "Chưa kết nối được",
          `${opts.provider} trả về: ${err === "access_denied" ? "bạn đã từ chối cấp quyền" : err}. Bạn có thể đóng tab này và thử lại trong OmniPage Studio.`,
          false
        ) : PAGE(`Đã kết nối ${opts.provider}`, "Bạn có thể đóng tab này và quay lại OmniPage Studio.", true)
      );
      finish(() => resolve(url.searchParams));
    });
    const timer2 = setTimeout(
      () => finish(() => reject(new PublishError("permanent", `Hết thời gian chờ đăng nhập ${opts.provider} – bấm Kết nối lại`))),
      opts.timeoutMs ?? 5 * 6e4
    );
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer2);
      active$2 = null;
      server.close();
      fn();
    };
    active$2 = { server, cancel: () => finish(() => reject(new PublishError("permanent", `Đã hủy kết nối ${opts.provider}`))) };
    server.on("error", (e) => finish(() => reject(new PublishError("permanent", `Không mở được cổng nhận kết quả đăng nhập: ${e.message}`))));
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const url = opts.buildUrl(`http://127.0.0.1:${port}/oauth/callback`);
      if (process.env.OMNI_OAUTH_FETCH === "1") void fetch(url).catch(() => void 0);
      else void electron.shell.openExternal(url);
    });
  });
}
const authBase = () => process.env.OMNI_YT_AUTH_BASE ?? "https://accounts.google.com";
const tokenBase = () => process.env.OMNI_YT_TOKEN_BASE ?? "https://oauth2.googleapis.com";
const apiBase = () => process.env.OMNI_YT_API_BASE ?? "https://www.googleapis.com";
const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  // Đọc / trả lời / ẩn bình luận (Hộp thư)
  "https://www.googleapis.com/auth/youtube.force-ssl",
  // Số liệu theo ngày (Phân tích)
  "https://www.googleapis.com/auth/yt-analytics.readonly"
];
const setting$1 = (key2) => {
  const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, key2)).get()?.value;
  return typeof v === "string" && v ? v : null;
};
const putSetting$1 = (key2, value) => {
  getDb().insert(settings).values({ key: key2, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: /* @__PURE__ */ new Date() } }).run();
};
const youtubeClientId = () => setting$1("youtube.clientId");
const youtubeClientSecret = () => readSecret("integration", "youtube", "api_key");
const DEFAULT_PUBLISH = { privacy: "public", categoryId: "22", declareSynthetic: true, notifySubscribers: true };
function youtubePublishSettings() {
  const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "youtube.publish")).get()?.value;
  return { ...DEFAULT_PUBLISH, ...v && typeof v === "object" ? v : {} };
}
const saveYoutubePublishSettings = (patch) => {
  const next = { ...youtubePublishSettings(), ...patch };
  putSetting$1("youtube.publish", next);
  return next;
};
async function tokenRequest(params, signal) {
  let res;
  try {
    res = await fetch(`${tokenBase()}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal });
  } catch (err) {
    throw new PublishError("transient", `Không kết nối được máy chủ Google: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.access_token) return body;
  const code = body.error ?? `HTTP ${res.status}`;
  if (code === "invalid_client" || code === "unauthorized_client")
    throw new PublishError("permanent", "Client ID / Client Secret không đúng – kiểm tra OAuth Client (loại Desktop app) trong Google Cloud");
  if (code === "invalid_grant") throw new PublishError("auth", "Phiên đăng nhập YouTube đã hết hạn hoặc bị thu hồi – bấm Kết nối lại YouTube");
  if (res.status >= 500) throw new PublishError("transient", `Google lỗi tạm thời (${code})`);
  throw new PublishError("permanent", `Google từ chối: ${body.error_description ?? code}`);
}
async function saveYoutubeApp(clientId, clientSecret) {
  const secret = clientSecret || youtubeClientSecret();
  if (!secret) throw new PublishError("permanent", "Nhập Client Secret");
  try {
    await tokenRequest({ client_id: clientId, client_secret: secret, grant_type: "refresh_token", refresh_token: "omnipage-kiem-tra" }, AbortSignal.timeout(2e4));
  } catch (err) {
    if (!(err instanceof PublishError) || err.kind !== "auth") throw err;
  }
  putSetting$1("youtube.clientId", clientId);
  if (clientSecret) putSecret({ kind: "api_key", ownerType: "integration", ownerId: "youtube", value: clientSecret });
}
function youtubeError(status2, body) {
  const e = body?.error;
  const reason = e?.errors?.[0]?.reason ?? "";
  const msg = e?.message ?? `HTTP ${status2}`;
  if (status2 === 401) return new PublishError("auth", `Token YouTube không hợp lệ – kết nối lại (${msg})`);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded")
    return new PublishError("rate_limit", "Hết hạn mức YouTube API trong ngày của dự án Google Cloud – thử lại sau 0 giờ (giờ Thái Bình Dương) hoặc xin tăng hạn mức");
  if (reason === "uploadLimitExceeded") return new PublishError("rate_limit", "Kênh đã đạt giới hạn số video tải lên trong ngày của YouTube – thử lại vào ngày mai");
  if (reason === "youtubeSignupRequired") return new PublishError("permanent", "Tài khoản Google này chưa có kênh YouTube – tạo kênh trên youtube.com rồi kết nối lại");
  if (reason === "forbidden" || reason === "insufficientPermissions") return new PublishError("auth", `Thiếu quyền YouTube – kết nối lại và đồng ý mọi quyền (${msg})`);
  if (status2 === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") return new PublishError("rate_limit", msg);
  if (status2 >= 500) return new PublishError("transient", msg);
  return new PublishError("permanent", `YouTube từ chối: ${msg}${reason ? ` (${reason})` : ""}`);
}
async function yt(method, path, opts) {
  const url = new URL(`${apiBase()}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${opts.token}`, ...opts.json ? { "Content-Type": "application/json" } : {} },
      body: opts.json ? JSON.stringify(opts.json) : void 0,
      signal: opts.signal
    });
  } catch (err) {
    if (opts.signal.aborted) throw err;
    throw new PublishError("transient", `Không kết nối được YouTube: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw youtubeError(res.status, body);
  return body;
}
async function youtubeMyChannel(token2, signal) {
  const r = await yt("GET", "/youtube/v3/channels", { token: token2, signal, query: { part: "snippet,statistics", mine: "true" } });
  const c = r.items?.[0];
  if (!c) throw new PublishError("permanent", "Tài khoản Google này chưa có kênh YouTube – tạo kênh trên youtube.com rồi kết nối lại");
  return {
    id: c.id,
    title: c.snippet.title,
    customUrl: c.snippet.customUrl ?? null,
    thumbnail: c.snippet.thumbnails?.default?.url ?? null,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? NaN) || null
  };
}
async function youtubeLogin(parent = null) {
  const clientId = youtubeClientId();
  const clientSecret = youtubeClientSecret();
  if (await cloudOAuthEnabled("google")) {
    const tok2 = await cloudLogin("google", YOUTUBE_SCOPES.join(" "), { title: "Kết nối YouTube", provider: "Google", parent, external: true });
    if (!tok2.access_token) throw new PublishError("permanent", "Omnira Cloud không trả token Google");
    if (!tok2.refresh_token) throw new PublishError("permanent", "Google không trả refresh token – gỡ quyền của ứng dụng tại myaccount.google.com/permissions rồi kết nối lại");
    if (!(tok2.scope ?? "").split(" ").some((s) => s.endsWith("youtube.upload")))
      throw new PublishError("permanent", 'Chưa cấp quyền tải video lên YouTube – kết nối lại và tick đồng ý quyền "Quản lý video YouTube"');
    const channel2 = await youtubeMyChannel(tok2.access_token, AbortSignal.timeout(45e3));
    const cfg = await cloudOAuthConfig();
    return {
      accessToken: tok2.access_token,
      refreshToken: tok2.refresh_token,
      accessExpiresAt: Date.now() + (tok2.expires_in ?? 3600) * 1e3,
      channel: channel2,
      viaCloud: true,
      clientId: cfg?.google.clientId ?? ""
    };
  }
  if (!clientId || !clientSecret)
    throw new PublishError("permanent", "Chưa cấu hình Ứng dụng YouTube – vào Hướng dẫn kết nối → YouTube để nhập Client ID và Client Secret (một lần), hoặc liên hệ Omnira để bật kết nối sẵn");
  const verifier = node_crypto.randomBytes(48).toString("base64url");
  const challenge = node_crypto.createHash("sha256").update(verifier).digest("base64url");
  const state2 = node_crypto.randomBytes(16).toString("hex");
  let redirectUri = "";
  const params = await loopbackAuth({
    provider: "YouTube",
    buildUrl: (redirect) => {
      redirectUri = redirect;
      const u = new URL(`${authBase()}/o/oauth2/v2/auth`);
      u.searchParams.set("client_id", clientId);
      u.searchParams.set("redirect_uri", redirect);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
      u.searchParams.set("access_type", "offline");
      u.searchParams.set("prompt", "consent select_account");
      u.searchParams.set("code_challenge", challenge);
      u.searchParams.set("code_challenge_method", "S256");
      u.searchParams.set("state", state2);
      return u.toString();
    }
  });
  const err = params.get("error");
  if (err) throw new PublishError("permanent", err === "access_denied" ? "Bạn đã từ chối cấp quyền YouTube" : `Google từ chối: ${err}`);
  if (params.get("state") !== state2) throw new PublishError("permanent", "Phiên đăng nhập không khớp – thử kết nối lại");
  const code = params.get("code");
  if (!code) throw new PublishError("permanent", "Google không trả mã đăng nhập");
  const signal = AbortSignal.timeout(45e3);
  const tok = await tokenRequest(
    { client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri },
    signal
  );
  if (!tok.refresh_token) throw new PublishError("permanent", "Google không trả refresh token – gỡ quyền của ứng dụng tại myaccount.google.com/permissions rồi kết nối lại");
  const granted = (tok.scope ?? "").split(" ");
  if (!granted.some((s) => s.endsWith("youtube.upload")))
    throw new PublishError("permanent", 'Chưa cấp quyền tải video lên YouTube – kết nối lại và tick đồng ý quyền "Quản lý video YouTube"');
  const channel = await youtubeMyChannel(tok.access_token, signal);
  return { accessToken: tok.access_token, refreshToken: tok.refresh_token, accessExpiresAt: Date.now() + tok.expires_in * 1e3, channel, viaCloud: false, clientId };
}
async function freshYoutubeCred(channelId, cred, signal) {
  if (cred.accessExpiresAt && cred.accessExpiresAt - Date.now() > 5 * 6e4) return cred;
  if (cred.viaCloud && cred.refreshToken) {
    const r2 = await cloudRefresh("google", cred.refreshToken);
    const next2 = { ...cred, token: r2.access_token, refreshToken: r2.refresh_token ?? cred.refreshToken, accessExpiresAt: Date.now() + r2.expires_in * 1e3 };
    writeCred(channelId, next2);
    markChannel(channelId, { tokenStatus: "valid" });
    return next2;
  }
  const clientId = cred.clientKey ?? youtubeClientId();
  const clientSecret = youtubeClientSecret();
  if (!cred.refreshToken || !clientId || !clientSecret) throw new PublishError("auth", "Thiếu refresh token / ứng dụng YouTube – bấm Kết nối lại YouTube");
  const r = await tokenRequest({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: cred.refreshToken }, signal);
  const next = { ...cred, token: r.access_token, refreshToken: r.refresh_token ?? cred.refreshToken, accessExpiresAt: Date.now() + r.expires_in * 1e3 };
  writeCred(channelId, next);
  markChannel(channelId, { tokenStatus: "valid" });
  return next;
}
const CHUNK = 8 * 1024 * 1024;
const clean = (s) => s.replace(/[<>]/g, "");
function tagsOf(hashtags) {
  const out = [];
  let total2 = 0;
  for (const t2 of hashtags.map((x) => x.replace(/^#/, "").trim()).filter(Boolean)) {
    if (total2 + t2.length + 1 > 480) break;
    out.push(t2);
    total2 += t2.length + 1;
  }
  return out;
}
async function uploadChunks(sessionUrl, file2, size, signal, stage2) {
  const fh = await promises$1.open(file2, "r");
  try {
    let from = 0;
    let retries = 0;
    while (true) {
      const to = Math.min(from + CHUNK, size) - 1;
      const len = to - from + 1;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, from);
      let res = null;
      try {
        res = await fetch(sessionUrl, { method: "PUT", headers: { "Content-Length": String(len), "Content-Range": `bytes ${from}-${to}/${size}` }, body: buf, signal });
      } catch (err) {
        if (signal.aborted) throw err;
      }
      if (res && (res.status === 200 || res.status === 201)) return await res.json();
      if (res && res.status === 308) {
        const range = res.headers.get("range");
        from = range ? Number(range.split("-")[1]) + 1 : 0;
        retries = 0;
        stage2(`Đang upload lên YouTube ${Math.min(100, Math.round(from / size * 100))}%`);
        continue;
      }
      if (res && res.status < 500 && res.status !== 429) throw youtubeError(res.status, await res.json().catch(() => null));
      if (++retries > 5) throw new PublishError("transient", "Upload YouTube bị gián đoạn nhiều lần – sẽ thử lại sau");
      stage2(`Mạng chập chờn – nối lại upload YouTube (lần ${retries}/5)`);
      await sleep(2e3 * retries, signal);
      try {
        const st = await fetch(sessionUrl, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` }, signal });
        if (st.status === 200 || st.status === 201) return await st.json();
        if (st.status === 308) {
          const range = st.headers.get("range");
          from = range ? Number(range.split("-")[1]) + 1 : 0;
        } else if (st.status === 404 || st.status === 410) throw new PublishError("transient", "Phiên upload YouTube đã hết hạn – sẽ tải lại từ đầu");
      } catch (err) {
        if (err instanceof PublishError || signal.aborted) throw err;
      }
    }
  } finally {
    await fh.close();
  }
}
async function publishYouTube({ cred, content, signal, stage: stage2 }) {
  const { videos } = mediaFiles(content);
  const file2 = videos[0];
  if (!file2) throw new PublishError("permanent", "YouTube chỉ đăng video – nội dung này không có file video");
  const size = node_fs.statSync(file2).size;
  const cfg = youtubePublishSettings();
  const shorts = content.aspect === "9:16" && (content.durationSec ?? 0) > 0 && (content.durationSec ?? 0) <= 180;
  let description = clean(composeCaption(content, 4900));
  if (shorts && !/#shorts/i.test(description)) description += "\n#Shorts";
  const title = clean(content.title).trim().slice(0, 100) || "Video mới";
  stage2("Khởi tạo upload YouTube");
  const init = new URL(`${apiBase()}/upload/youtube/v3/videos`);
  init.searchParams.set("uploadType", "resumable");
  init.searchParams.set("part", "snippet,status");
  init.searchParams.set("notifySubscribers", String(cfg.notifySubscribers));
  let res;
  try {
    res = await fetch(init, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/*"
      },
      body: JSON.stringify({
        snippet: { title, description, tags: tagsOf(content.hashtags), categoryId: cfg.categoryId },
        status: {
          privacyStatus: cfg.privacy,
          selfDeclaredMadeForKids: false,
          // Nhãn "nội dung đã chỉnh sửa / tạo bằng AI" – video từ Xưởng video AI
          ...cfg.declareSynthetic && content.source === "studio" ? { containsSyntheticMedia: true } : {}
        }
      }),
      signal
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new PublishError("transient", `Không kết nối được YouTube: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw youtubeError(res.status, await res.json().catch(() => null));
  const session = res.headers.get("location");
  if (!session) throw new PublishError("transient", "YouTube không trả phiên upload");
  stage2("Đang upload lên YouTube 0%");
  const video = await uploadChunks(session, file2, size, signal, stage2);
  const notes = [];
  if (cfg.privacy !== "private" && video.status?.privacyStatus === "private")
    notes.push("YouTube để video ở chế độ Riêng tư (dự án Google Cloud chưa qua kiểm duyệt API) – mở công khai trong YouTube Studio");
  const thumb = content.thumbnailPath ? node_path.isAbsolute(content.thumbnailPath) ? content.thumbnailPath : node_path.join(mediaDir(), content.thumbnailPath) : null;
  if (thumb && node_fs.existsSync(thumb)) {
    stage2("Đặt thumbnail");
    try {
      const t2 = new URL(`${apiBase()}/upload/youtube/v3/thumbnails/set`);
      t2.searchParams.set("videoId", video.id);
      t2.searchParams.set("uploadType", "media");
      const r = await fetch(t2, {
        method: "POST",
        headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": /\.png$/i.test(thumb) ? "image/png" : "image/jpeg" },
        body: await promises$1.readFile(thumb),
        signal
      });
      if (!r.ok) {
        const e = youtubeError(r.status, await r.json().catch(() => null));
        notes.push(`Chưa đặt được thumbnail: ${e.message}${r.status === 403 ? " (kênh cần xác minh số điện thoại để dùng thumbnail tùy chỉnh)" : ""}`);
      }
    } catch (err) {
      if (signal.aborted) throw err;
      notes.push(`Chưa đặt được thumbnail: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    externalId: video.id,
    permalink: shorts ? `https://www.youtube.com/shorts/${video.id}` : `https://www.youtube.com/watch?v=${video.id}`,
    note: notes.join(". ") || void 0
  };
}
const analyticsBase = () => process.env.OMNI_YT_ANALYTICS_BASE ?? "https://youtubeanalytics.googleapis.com";
async function youtubeDaily(token2, signal, days = 30) {
  const notes = [];
  const daily = /* @__PURE__ */ new Map();
  const me = await youtubeMyChannel(token2, signal);
  const day = (t2) => new Date(t2).toISOString().slice(0, 10);
  const url = new URL(`${analyticsBase()}/v2/reports`);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", day(Date.now() - days * 864e5));
  url.searchParams.set("endDate", day(Date.now()));
  url.searchParams.set("metrics", "views,likes,comments,shares,estimatedMinutesWatched");
  url.searchParams.set("dimensions", "day");
  url.searchParams.set("sort", "day");
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token2}` }, signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw youtubeError(res.status, body);
    for (const r of body?.rows ?? []) {
      const [d, views, likes, comments, shares, minutes] = r;
      daily.set(d, { views, engagements: likes + comments + shares, watchMinutes: minutes });
    }
  } catch (err) {
    if (signal.aborted) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    notes.push(
      /accessNotConfigured|has not been used|disabled/i.test(msg) ? "Chưa bật YouTube Analytics API trong dự án Google Cloud – bật để có lượt xem / phút xem theo ngày" : /insufficient|Thiếu quyền|scope/i.test(msg) ? "Kết nối lại YouTube để cấp quyền xem số liệu (yt-analytics.readonly)" : `Số liệu theo ngày lỗi: ${msg}`
    );
  }
  return { daily, followers: me.subscribers, notes };
}
async function youtubeVideoStats(ids, token2, signal) {
  const out = /* @__PURE__ */ new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt("GET", "/youtube/v3/videos", {
      token: token2,
      signal,
      query: { part: "statistics", id: ids.slice(i, i + 50).join(",") }
    });
    for (const v of r.items ?? []) {
      const s = v.statistics ?? {};
      out.set(v.id, { views: Number(s.viewCount ?? 0), engagements: Number(s.likeCount ?? 0) + Number(s.commentCount ?? 0) });
    }
  }
  return out;
}
const toComment = (c) => ({
  id: c.id,
  text: c.snippet.textDisplay ?? "",
  author: c.snippet.authorDisplayName ?? "Người xem YouTube",
  authorChannelId: c.snippet.authorChannelId?.value ?? null,
  publishedAt: c.snippet.publishedAt ?? (/* @__PURE__ */ new Date()).toISOString()
});
async function youtubeCommentThreads(channelId, token2, signal) {
  const r = await yt("GET", "/youtube/v3/commentThreads", {
    token: token2,
    signal,
    query: { part: "snippet,replies", allThreadsRelatedToChannelId: channelId, maxResults: "50", order: "time", textFormat: "plainText" }
  });
  const threads = (r.items ?? []).map((t2) => ({
    id: t2.snippet.topLevelComment.id,
    videoId: t2.snippet.videoId ?? null,
    videoTitle: null,
    top: toComment(t2.snippet.topLevelComment),
    // API trả trả lời mới nhất trước → đảo lại theo thời gian
    replies: (t2.replies?.comments ?? []).map(toComment).reverse()
  }));
  const ids = [...new Set(threads.map((t2) => t2.videoId).filter((x) => !!x))];
  if (ids.length) {
    try {
      const v = await yt("GET", "/youtube/v3/videos", {
        token: token2,
        signal,
        query: { part: "snippet", id: ids.slice(0, 50).join(",") }
      });
      const titles = new Map((v.items ?? []).map((x) => [x.id, x.snippet?.title ?? null]));
      for (const t2 of threads) t2.videoTitle = t2.videoId ? titles.get(t2.videoId) ?? null : null;
    } catch {
    }
  }
  return threads;
}
async function youtubeReply(parentId, text, token2, signal) {
  const r = await yt("POST", "/youtube/v3/comments", { token: token2, signal, query: { part: "snippet" }, json: { snippet: { parentId, textOriginal: text } } });
  return r.id;
}
async function youtubeHoldComment(commentId, token2, signal) {
  const url = new URL(`${apiBase()}/youtube/v3/comments/setModerationStatus`);
  url.searchParams.set("id", commentId);
  url.searchParams.set("moderationStatus", "heldForReview");
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token2}` }, signal });
  if (!res.ok) throw youtubeError(res.status, await res.json().catch(() => null));
}
async function youtubeTopComment(videoId, text, token2, signal) {
  const r = await yt("POST", "/youtube/v3/commentThreads", {
    token: token2,
    signal,
    query: { part: "snippet" },
    json: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } }
  });
  return r.id;
}
const TICK_MS$1 = 2e4;
const RETRY_DELAYS_MIN = [2, 10, 30];
const MAX_ATTEMPTS$1 = RETRY_DELAYS_MIN.length + 1;
let timer$3 = null;
let current = null;
let lastRunAt = null;
let processed = 0;
function publishEnabled() {
  const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "publish.enabled")).get()?.value;
  return v !== false;
}
function setPublishEnabled(enabled) {
  getDb().insert(settings).values({ key: "publish.enabled", value: enabled }).onConflictDoUpdate({ target: settings.key, set: { value: enabled, updatedAt: /* @__PURE__ */ new Date() } }).run();
  if (enabled) kickPublisher();
}
function recoverInterrupted() {
  getDb().update(scheduledPosts).set({ status: "failed", error: "Ứng dụng đã đóng khi đang đăng – kiểm tra trên nền tảng trước khi thử lại để tránh đăng trùng", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(scheduledPosts.status, "publishing")).run();
}
function reconcileTokenStatus() {
  const db2 = getDb();
  const withToken = db2.select({ id: secrets.ownerId }).from(secrets).where(drizzleOrm.and(drizzleOrm.eq(secrets.ownerType, "channel"), drizzleOrm.eq(secrets.kind, "access_token"))).all().map((r) => r.id);
  const res = db2.update(channels).set({ tokenStatus: "missing", tokenExpiresAt: null, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.ne(channels.tokenStatus, "missing"), withToken.length ? drizzleOrm.notInArray(channels.id, withToken) : void 0)).run();
  if (res.changes) console.info(`[publish] ${res.changes} kênh chưa có token trong két → đặt "Chưa có token"`);
}
function startPublisher() {
  lastRunAt = null;
  processed = 0;
  recoverInterrupted();
  reconcileTokenStatus();
  timer$3 = setInterval(() => void tick$1(), TICK_MS$1);
  setTimeout(() => timer$3 && void tick$1(), 3e3);
}
function stopPublisher() {
  if (timer$3) clearInterval(timer$3);
  timer$3 = null;
  current?.ctl.abort();
}
function kickPublisher() {
  setTimeout(() => void tick$1(), 50);
}
function dueCondition(now2) {
  return drizzleOrm.and(
    drizzleOrm.eq(scheduledPosts.status, "queued"),
    drizzleOrm.lte(scheduledPosts.scheduledAt, now2),
    drizzleOrm.or(drizzleOrm.isNull(scheduledPosts.nextAttemptAt), drizzleOrm.lte(scheduledPosts.nextAttemptAt, now2)),
    drizzleOrm.eq(channels.status, "active")
  );
}
function workerStatus() {
  const db2 = getDb();
  const now2 = /* @__PURE__ */ new Date();
  const due = db2.select({ id: scheduledPosts.id }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(dueCondition(now2)).all().length;
  const next = db2.select({ at: scheduledPosts.scheduledAt }).from(scheduledPosts).where(drizzleOrm.eq(scheduledPosts.status, "queued")).orderBy(drizzleOrm.asc(scheduledPosts.scheduledAt)).get();
  return { enabled: publishEnabled(), running: current ? { postId: current.postId, stage: current.stage } : null, due, nextAt: next?.at ?? null, lastRunAt, processed };
}
let ticking = false;
async function tick$1() {
  if (ticking || !timer$3 || !publishEnabled()) return;
  ticking = true;
  try {
    for (; ; ) {
      if (!timer$3 || !publishEnabled()) break;
      const now2 = /* @__PURE__ */ new Date();
      const next = getDb().select({ id: scheduledPosts.id }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(dueCondition(now2)).orderBy(drizzleOrm.asc(scheduledPosts.scheduledAt)).get();
      if (!next) break;
      await publishOne(next.id);
    }
  } catch (err) {
    console.error("[publish] worker lỗi", err);
  } finally {
    ticking = false;
    lastRunAt = /* @__PURE__ */ new Date();
  }
}
async function publishOne(postId) {
  const db2 = getDb();
  const post = db2.update(scheduledPosts).set({ status: "publishing", error: null, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.id, postId), drizzleOrm.eq(scheduledPosts.status, "queued"))).returning().get();
  if (!post) return;
  const channel = db2.select().from(channels).where(drizzleOrm.eq(channels.id, post.channelId)).get();
  const content = db2.select().from(contentItems).where(drizzleOrm.eq(contentItems.id, post.contentItemId)).get();
  const ctl2 = new AbortController();
  current = { postId, stage: "Chuẩn bị", ctl: ctl2 };
  const tag = `${postId.slice(0, 8)} → ${channel?.name ?? "?"}`;
  console.info(`[publish] bắt đầu ${tag} (lần ${post.attempts + 1})`);
  const started2 = Date.now();
  try {
    if (!channel || !content) throw new PublishError("permanent", "Kênh hoặc nội dung đã bị xóa");
    let cred = readCred(channel.id);
    if (!cred) throw new PublishError("auth", "Kênh chưa kết nối API – nhập token trong Tài khoản & Kênh");
    const ctx = { cred, content, signal: ctl2.signal, stage: (s) => current && (current.stage = s) };
    let out;
    if (channel.platform === "facebook") out = await publishFacebook(ctx);
    else if (channel.platform === "instagram") out = await publishInstagram(ctx);
    else if (channel.platform === "youtube") {
      cred = await freshYoutubeCred(channel.id, cred, ctl2.signal);
      out = await publishYouTube({ ...ctx, cred });
    } else {
      cred = await freshTikTokCred(channel.id, cred, ctl2.signal);
      out = await publishTikTok({ ...ctx, cred });
    }
    const first = content.firstComment?.trim();
    if (first) {
      if (channel.platform === "youtube") {
        try {
          current && (current.stage = "Đăng bình luận đầu tiên");
          await youtubeTopComment(out.externalId, first, cred.token, ctl2.signal);
        } catch (err) {
          out.note = [out.note, `Bình luận đầu tiên lỗi: ${err instanceof Error ? err.message : String(err)}`].filter(Boolean).join(". ");
        }
      } else if (channel.platform === "tiktok") {
        out.note = [out.note, "TikTok không có API bình luận – chưa đăng bình luận đầu tiên"].filter(Boolean).join(". ");
      } else {
        try {
          current && (current.stage = "Đăng bình luận đầu tiên");
          await graph("POST", `${out.externalId}/comments`, { token: cred.token, signal: ctl2.signal, form: { message: first } });
        } catch (err) {
          out.note = [out.note, `Bình luận đầu tiên lỗi: ${err instanceof Error ? err.message : String(err)}`].filter(Boolean).join(". ");
        }
      }
    }
    db2.transaction((tx) => {
      tx.update(scheduledPosts).set({ status: "published", publishedAt: /* @__PURE__ */ new Date(), externalPostId: out.externalId, permalink: out.permalink, note: out.note ?? null, error: null, nextAttemptAt: null, attempts: post.attempts + 1, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(scheduledPosts.id, postId)).run();
      const pending2 = tx.select({ id: scheduledPosts.id }).from(scheduledPosts).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.contentItemId, content.id), drizzleOrm.inArray(scheduledPosts.status, ["queued", "publishing"]))).get();
      if (!pending2) tx.update(contentItems).set({ status: "published", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, content.id)).run();
      tx.update(channels).set({ health: "ok", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(channels.id, channel.id)).run();
      tx.insert(activityLog).values({ level: "ok", scope: "publish", message: `Đã đăng "${content.title.slice(0, 60)}" lên ${channel.name}` }).run();
    });
    console.info(`[publish] xong ${tag} · id ${out.externalId} · ${Math.round((Date.now() - started2) / 1e3)}s${out.note ? ` · ${out.note}` : ""}`);
  } catch (err) {
    if (ctl2.signal.aborted) {
      return;
    }
    const e = err instanceof PublishError ? err : new PublishError("transient", err instanceof Error ? err.message : String(err));
    const attempts = post.attempts + 1;
    const retry = (e.kind === "transient" || e.kind === "rate_limit") && attempts < MAX_ATTEMPTS$1;
    const delayMin = RETRY_DELAYS_MIN[attempts - 1] ?? 30;
    console.warn(`[publish] lỗi ${tag} (${e.kind}): ${e.message}${retry ? ` → thử lại sau ${delayMin} phút` : ""}`);
    db2.transaction((tx) => {
      tx.update(scheduledPosts).set(
        retry ? { status: "queued", attempts, error: `${e.message} – sẽ thử lại lúc ${new Date(Date.now() + delayMin * 6e4).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`, nextAttemptAt: new Date(Date.now() + delayMin * 6e4), updatedAt: /* @__PURE__ */ new Date() } : { status: "failed", attempts, error: e.message, nextAttemptAt: null, updatedAt: /* @__PURE__ */ new Date() }
      ).where(drizzleOrm.eq(scheduledPosts.id, postId)).run();
      if (retry) return;
      if (content) {
        const alive = tx.select({ id: scheduledPosts.id }).from(scheduledPosts).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.contentItemId, content.id), drizzleOrm.inArray(scheduledPosts.status, ["queued", "publishing", "published"]))).get();
        if (!alive) tx.update(contentItems).set({ status: "failed", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, content.id)).run();
      }
      if (channel && e.kind === "auth") {
        tx.update(channels).set({ tokenStatus: readCred(channel.id) ? "expired" : "missing", health: "error", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(channels.id, channel.id)).run();
        tx.insert(alerts).values({ id: newId(), severity: "error", kind: "token_invalid", entityType: "channel", entityId: channel.id, title: `Token kênh ${channel.name} không dùng được`, message: e.message.slice(0, 300) }).run();
      }
      tx.insert(alerts).values({ id: newId(), severity: "error", kind: "publish_failed", entityType: "post", entityId: postId, title: `Đăng bài lên ${channel?.name ?? "kênh"} thất bại`, message: e.message.slice(0, 300) }).run();
      tx.insert(activityLog).values({ level: "error", scope: "publish", message: `Đăng lỗi (${channel?.name ?? "?"}): ${e.message.slice(0, 120)}` }).run();
    });
  } finally {
    current = null;
    processed++;
  }
}
function publishNow(postId) {
  const db2 = getDb();
  const res = db2.update(scheduledPosts).set({ status: "queued", scheduledAt: /* @__PURE__ */ new Date(), nextAttemptAt: null, error: null, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.id, postId), drizzleOrm.inArray(scheduledPosts.status, ["queued", "failed"]))).returning({ contentItemId: scheduledPosts.contentItemId }).get();
  if (!res) throw new Error("Chỉ đăng ngay được bài đang chờ hoặc bị lỗi");
  db2.update(contentItems).set({ status: "scheduled", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(contentItems.id, res.contentItemId), drizzleOrm.eq(contentItems.status, "failed"))).run();
  if (publishEnabled()) kickPublisher();
  else if (!current) void publishOne(postId).catch((err) => console.error("[publish] đăng ngay lỗi", err));
}
function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();
}
const lowerNfc = (s) => s.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
const hasMarks = (s) => /[\p{M}đ]/u.test(s.toLowerCase().normalize("NFD"));
const PHONE$1 = /(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/;
function wholeWord(haystack, needle) {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "u").test(haystack);
}
function matchKeywords(keywords, text) {
  return keywords.some((k) => {
    if (k === "{phone}") return PHONE$1.test(text);
    if (!k.trim()) return false;
    return hasMarks(k) ? wholeWord(lowerNfc(text), lowerNfc(k)) : wholeWord(normalize(text), normalize(k));
  });
}
const FRESH_MS$1 = 30 * 6e4;
const COOLDOWN_MS = 60 * 6e4;
function matchRule(rule, text) {
  return matchKeywords(rule.keywords, text);
}
const fill = (template, name) => template.replace(/\{name\}/g, name.replace(/^@/, "")).trim();
function applyRules(items) {
  if (!items.length) return 0;
  const db2 = getDb();
  const rules = db2.select().from(autoReplyRules).where(drizzleOrm.eq(autoReplyRules.enabled, true)).all();
  if (!rules.length) return 0;
  let queued = 0;
  for (const { conversation: conv, message: msg } of items) {
    if (Date.now() - msg.createdAt.getTime() > FRESH_MS$1) continue;
    const comment = conv.source === "comment";
    for (const rule of rules) {
      if (rule.channelId ? rule.channelId !== conv.channelId : rule.workspaceId != null && rule.workspaceId !== conv.workspaceId) continue;
      if ((rule.action === "reply_comment" || rule.action === "hide_comment") && !comment) continue;
      if (conv.platform === "tiktok") continue;
      if (conv.platform === "youtube" && rule.action !== "reply_comment" && rule.action !== "hide_comment") continue;
      if (!matchRule(rule, msg.body)) continue;
      if (rule.action !== "hide_comment" && !rule.template?.trim()) continue;
      const recent = db2.select({ id: messages.id }).from(messages).where(
        drizzleOrm.and(
          drizzleOrm.eq(messages.conversationId, conv.id),
          drizzleOrm.eq(messages.ruleId, rule.id),
          drizzleOrm.or(drizzleOrm.gte(messages.createdAt, new Date(Date.now() - COOLDOWN_MS)), drizzleOrm.isNull(messages.externalId))
        )
      ).get();
      if (recent && rule.action !== "hide_comment") continue;
      const lo = Math.max(0, rule.minDelaySec);
      const hi = Math.max(lo, rule.maxDelaySec);
      const delaySec = rule.action === "hide_comment" ? 2 : lo + Math.random() * (hi - lo);
      db2.insert(messages).values({
        id: newId(),
        conversationId: conv.id,
        direction: "out",
        author: rule.action === "hide_comment" ? "system" : "bot",
        body: rule.action === "hide_comment" ? `Ẩn bình luận: "${msg.body.slice(0, 80)}" (luật "${rule.name}")` : fill(rule.template, conv.customerName),
        action: rule.action === "hide_comment" ? "hide" : "message",
        // Trả lời / ẩn đúng bình luận vừa đến; nhắn riêng từ bình luận dùng private reply theo comment_id
        targetId: comment ? msg.externalId : null,
        ruleId: rule.id,
        deliveryStatus: "pending",
        sendAfter: new Date(Date.now() + delaySec * 1e3)
      }).run();
      queued++;
      console.info(`[inbox] luật "${rule.name}" → ${rule.action} sau ${Math.round(delaySec)}s (hội thoại ${conv.id.slice(0, 8)})`);
    }
  }
  return queued;
}
const clip = (max) => zod.z.preprocess((v) => v == null ? "" : typeof v === "number" || typeof v === "boolean" ? String(v) : v, zod.z.string()).transform((s) => s.trim().slice(0, max));
const need = (max) => clip(max).refine((s) => s.length > 0, "trống");
const opt = (max) => clip(max).catch("");
const num = (min, max, int = false) => zod.z.preprocess((v) => typeof v === "string" ? parseFloat(v.replace(",", ".")) : v, zod.z.number().finite()).transform((n) => {
  const x = Math.min(max, Math.max(min, n));
  return int ? Math.round(x) : x;
});
const bool = () => zod.z.preprocess((v) => v === "true" || v === 1 ? true : v === "false" || v === 0 ? false : v, zod.z.boolean());
function list(item, min, max) {
  return zod.z.array(zod.z.unknown()).transform((arr, ctx) => {
    const ok = [];
    let firstIssue = "";
    for (const x of arr) {
      const r = item.safeParse(x);
      if (r.success) ok.push(r.data);
      else firstIssue ||= issueBrief(r.error);
    }
    if (ok.length < arr.length) console.warn(`[ai] bỏ ${arr.length - ok.length}/${arr.length} phần tử sai cấu trúc (${firstIssue})`);
    if (ok.length < min) {
      ctx.addIssue({ code: zod.z.ZodIssueCode.custom, message: `chỉ ${ok.length}/${arr.length} phần tử hợp lệ, cần ≥ ${min}` });
      return zod.z.NEVER;
    }
    return ok.slice(0, max);
  });
}
function issueBrief(err) {
  return err.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`).join("; ");
}
const WORDS_PER_SEC$1 = 2.8;
const brand = (voice) => voice?.trim() ? `
Giọng văn thương hiệu (bắt buộc tuân theo): ${voice.trim()}` : "";
function shapes(schema2, json2) {
  const out = [json2];
  if (!(schema2 instanceof zod.z.ZodObject)) return out;
  if (Array.isArray(json2)) for (const k of Object.keys(schema2.shape)) out.push({ [k]: json2 });
  else if (json2 && typeof json2 === "object") {
    const vals = Object.values(json2);
    if (vals.length === 1 && vals[0] && typeof vals[0] === "object" && !Array.isArray(vals[0])) out.push(vals[0]);
  }
  return out;
}
function parse(schema2, text, feature = "", salvage = false) {
  const json2 = extractJson(text, salvage);
  let first = null;
  for (const v of shapes(schema2, json2)) {
    const res = schema2.safeParse(v);
    if (res.success) return res.data;
    first ??= res.error;
  }
  console.warn(`[ai] ${feature || "json"}: sai cấu trúc – ${first ? issueBrief(first) : "?"}`);
  throw new AiError("invalid_output", "AI trả về sai cấu trúc dữ liệu");
}
const VI_MARK = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const VI_PLAIN = /* @__PURE__ */ new Set(["khong", "nguoi", "duoc", "cua", "nhung", "trong", "mot", "nay", "cac", "voi", "cho", "la", "va", "den", "thi", "minh", "ban", "nhu", "khi", "roi", "cung", "nhieu", "lam", "biet", "chung"]);
function lacksVietnameseDiacritics(texts) {
  const words = texts.join(" ").normalize("NFC").toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < 12) return false;
  const marked = words.filter((w) => VI_MARK.test(w)).length;
  const plainHits = words.filter((w) => VI_PLAIN.has(w)).length;
  return marked / words.length < 0.08 && plainHits >= 3;
}
const VI_RULE = "Mọi nội dung tiếng Việt phải viết CÓ DẤU đầy đủ, đúng chính tả (Unicode), tuyệt đối không viết tiếng Việt không dấu.";
async function aiJson(req, opts, schema2, vi) {
  const base = { ...req, system: `${req.system}
${VI_RULE}` };
  const attempt = async (r, salvage) => {
    const meta2 = await aiText(r, opts);
    return { data: parse(schema2, meta2.text, opts.feature, salvage), meta: meta2 };
  };
  const checked = async (r, salvage = false) => {
    const res = await attempt(r, salvage);
    if (!vi || !lacksVietnameseDiacritics(vi(res.data))) return res;
    console.warn(`[ai] ${opts.feature}: ${res.meta.model} trả tiếng Việt không dấu → gọi lại`);
    const again = await attempt(
      {
        ...r,
        temperature: Math.min(r.temperature ?? 0.7, 0.4),
        system: `${r.system}
LẦN TRƯỚC BẠN VIẾT TIẾNG VIỆT KHÔNG DẤU – SAI. Viết lại TOÀN BỘ phần tiếng Việt CÓ DẤU đầy đủ (vd "không", "người", "được").`
      },
      true
    );
    if (lacksVietnameseDiacritics(vi(again.data)))
      throw new AiError(
        "invalid_output",
        `Model ${again.meta.model} trả về tiếng Việt KHÔNG DẤU (đã thử lại). Chọn model mạnh hơn ở Cài đặt (vd Gemini Flash thay vì Flash-Lite) rồi tạo lại.`
      );
    return again;
  };
  try {
    return await checked(base);
  } catch (err) {
    if (!(err instanceof AiError) || err.kind !== "invalid_output" || /KHÔNG DẤU/.test(err.message)) throw err;
    console.warn(`[ai] ${opts.feature}: ${err.message} → thử lại với hạn mức ${Math.min(req.maxTokens * 2, 32768)} token`);
    return checked(
      {
        ...base,
        maxTokens: Math.min(req.maxTokens * 2, 32768),
        temperature: Math.min(req.temperature ?? 0.7, 0.4),
        system: `${base.system}
Chỉ trả về DUY NHẤT một JSON hợp lệ, đầy đủ, không giải thích, viết gọn.`
      },
      true
    );
  }
}
const txt = opt;
const ShotZ = zod.z.object({
  characters: list(need(60), 0, 6).catch([]),
  product: bool().catch(false),
  action: txt(400),
  setting: txt(300),
  cameraAngle: txt(120),
  cameraMovement: txt(120),
  lighting: txt(200),
  look: txt(200),
  style: txt(200),
  sound: txt(300)
}).catch({ characters: [], product: false, action: "", setting: "", cameraAngle: "", cameraMovement: "", lighting: "", look: "", style: "", sound: "" });
const BibleZ = zod.z.object({
  style: opt(400),
  styleVi: opt(500),
  characters: list(zod.z.object({ name: need(60), look: need(400), lookVi: opt(500) }), 0, 8).catch([]),
  product: zod.z.object({ name: need(80), look: need(400), lookVi: opt(500) }).nullable().catch(null)
});
const SHOT_RULES = [
  'Mỗi cảnh có "shot" viết TIẾNG ANH, cụ thể như chỉ đạo quay phim:',
  "- characters: tên nhân vật có trong khung hình (đúng tên trong visual bible); product: true nếu sản phẩm xuất hiện",
  "- action: hành động + biểu cảm; setting: bối cảnh, thời điểm, đạo cụ",
  '- cameraAngle (vd "low-angle medium shot", "extreme close-up"); cameraMovement (vd "slow dolly-in", "handheld tracking", "static locked-off")',
  '- lighting (vd "golden hour backlight with soft bounce fill"); look = chất liệu hình ảnh (vd "35mm film, fine grain, shallow depth of field")',
  '- style = phong cách cinematic riêng của cảnh (vd "moody teal-orange grade"); sound = âm thanh môi trường / hiệu ứng / nhạc nền (KHÔNG gồm lời thoại)',
  "KHÔNG tả lại ngoại hình nhân vật hay hình dáng sản phẩm trong action – app tự chèn nguyên văn mô tả từ visual bible để mọi cảnh nhất quán.",
  "Đổi góc máy / cỡ cảnh giữa các cảnh liền nhau cho sinh động. searchQuery: 3–6 từ khóa tiếng Anh để tìm video stock thay thế."
].join("\n");
const SHOT_JSON = '"shot":{"characters":[],"product":false,"action","setting","cameraAngle","cameraMovement","lighting","look","style","sound"},"searchQuery":"3-6 english keywords"';
const BIBLE_RULES = 'visual bible (dùng chung cho mọi cảnh): style = phong cách chung TIẾNG ANH (thể loại điện ảnh, tông màu, ống kính, chất liệu phim); characters = người xuất hiện lặp lại (tên ngắn như "Host", "Mai" + look TIẾNG ANH mô tả cố định: tuổi, giới tính, gương mặt, tóc, trang phục, màu sắc); product = sản phẩm / vật thể chủ đạo nếu có (name + look TIẾNG ANH: hình dáng, màu, chất liệu, chi tiết nhận diện), không có thì null. Kèm bản TIẾNG VIỆT cùng nội dung cho người dùng đọc & sửa: styleVi, lookVi (của từng nhân vật / sản phẩm).';
const NO_NARRATION_RULE = "Video KHÔNG có lời thoại / giọng đọc / phụ đề: kể hoàn toàn bằng hình ảnh, chuyển động máy và âm thanh. Mỗi cảnh 3–5 giây, nhịp nhanh, hình đẹp kiểu quảng cáo công nghệ: cận cảnh chi tiết, macro, ánh sáng tương phản, chuyển động máy mượt; mở bằng hình gây chú ý mạnh, cao trào ở khoảng 2/3, kết bằng cảnh toàn đẹp nhất. voiceover: GHI CHÚ ngắn tiếng Việt (≤ 12 từ) cho biết cảnh này nói gì – app KHÔNG đọc ra. shot.sound: hiệu ứng / không khí rõ ràng (whoosh, click, hum điện tử, nhạc nền điện tử…), tuyệt đối không có người nói.";
const BIBLE_JSON = '{"style","styleVi","characters":[{"name","look","lookVi"}],"product":{"name","look","lookVi"}|null}';
const REFS_SEEN_RULE = "Ảnh ĐÍNH KÈM là ảnh tham chiếu thật của nhân vật / sản phẩm / logo do người dùng cung cấp. Trong visual bible, look của chủ thể tương ứng phải mô tả ĐÚNG những gì thấy trong ảnh (giới tính, độ tuổi ước lượng, gương mặt, kiểu & màu tóc, trang phục, phụ kiện; sản phẩm: hình dáng, màu, chất liệu, nhãn / logo, chi tiết nhận diện). Không tự nghĩ ra ngoại hình khác ảnh, không đoán quốc tịch / dân tộc nếu ảnh không thể hiện rõ. Ảnh nào không có người / sản phẩm thì bỏ qua.";
const NO_BIBLE = { style: "", styleVi: "", characters: [], product: null };
const ScriptSchema = zod.z.object({
  bible: BibleZ.catch(NO_BIBLE),
  scenes: list(
    zod.z.object({
      label: opt(80),
      voiceover: need(600),
      durationSec: num(1, 30),
      shot: ShotZ,
      searchQuery: txt(120)
    }),
    2,
    160
  )
});
async function generateScript(input) {
  const long = input.targetSec > 90;
  const silent = input.narration === false;
  const sceneCount = silent ? Math.max(3, Math.min(40, Math.round(input.targetSec / 4))) : input.targetSec <= 15 ? 3 : input.targetSec <= 30 ? 4 : input.targetSec <= 90 ? 7 : Math.round(input.targetSec / 7);
  const words = Math.round(input.targetSec * WORDS_PER_SEC$1);
  const minutes = Math.round(input.targetSec / 60);
  const { data, meta: res } = await aiJson(
    {
      system: (long ? `Bạn là biên kịch video dài ${input.aspect === "9:16" ? "dọc" : "ngang"} (${minutes} phút) cho mạng xã hội, viết bằng tiếng Việt tự nhiên, câu ngắn, dễ đọc thành giọng nói. Mạch nội dung có mở đầu cuốn hút, các phần phát triển rõ ràng, cao trào và kết. ` : "Bạn là biên kịch video ngắn dọc 9:16 (TikTok, Reels, Shorts) viết bằng tiếng Việt tự nhiên, câu ngắn, dễ đọc thành giọng nói. ") + "Không bịa số liệu, giá cả hay cam kết công dụng y tế/sức khỏe. Không dùng emoji trong lời thoại." + brand(input.brandVoice),
      prompt: [
        `Chủ đề: ${input.topic}`,
        `Nền tảng đích: ${input.platform ?? "TikTok / Reels"}`,
        silent ? `Thời lượng tổng: ${input.targetSec} giây, chia ${sceneCount} cảnh. ${NO_NARRATION_RULE}` : `Thời lượng tổng: ${input.targetSec} giây (khoảng ${words} từ lời thoại tổng cộng), chia ${sceneCount} cảnh.`,
        silent ? "" : long ? "Cảnh 1 là Hook gây tò mò; mỗi cảnh 5–10 giây với hình ảnh khác nhau; cảnh cuối là lời kết + CTA ngắn (theo dõi / bình luận). Viết gọn, không lặp ý." : "Cảnh 1 là Hook gây tò mò trong 3–4 giây; cảnh cuối là CTA ngắn (theo dõi / bình luận / lưu video).",
        input.formatGuide ? `Định dạng nội dung: ${input.formatGuide}` : "",
        `Trước hết lập ${BIBLE_RULES}`,
        input.images?.length ? REFS_SEEN_RULE : "",
        SHOT_RULES,
        `Trả về JSON: {"bible":${BIBLE_JSON},"scenes":[{"label":"nhãn ngắn ≤ 4 từ","voiceover":"${silent ? "ghi chú nội dung cảnh ≤ 12 từ (không đọc)" : "lời thoại tiếng Việt"}","durationSec":số giây,${SHOT_JSON}}]}`,
        `Tổng durationSec phải bằng ${input.targetSec}.`
      ].filter(Boolean).join("\n"),
      json: true,
      // Video dài nhiều cảnh → nhiều token hơn (aiJson tự thử lại với hạn mức gấp đôi nếu bị cắt)
      maxTokens: Math.min(32768, 8e3 + input.targetSec * 45),
      temperature: 0.8,
      images: input.images
    },
    { feature: "studio.script", workspaceId: input.workspaceId },
    ScriptSchema,
    (d) => d.scenes.map((s) => s.voiceover)
  );
  return { scenes: data.scenes, bible: data.bible, meta: res };
}
const tagList = (min) => zod.z.preprocess((t2) => typeof t2 === "string" ? t2.split(/[\s,]+/) : t2, list(need(200), min, 50)).transform((t2) => t2.filter((x) => x.length <= 60).slice(0, 15));
const SpinSchema = zod.z.object({
  variants: list(zod.z.object({ caption: need(2200), hashtags: tagList(0).catch([]) }), 1, 10)
});
async function spinCaption(input) {
  const { data, meta: meta2 } = await aiJson(
    {
      system: "Bạn là copywriter mạng xã hội tiếng Việt. Viết lại caption thành các biến thể khác nhau rõ rệt về câu mở đầu, nhịp câu và lời kêu gọi, nhưng giữ nguyên ý chính và mọi thông tin sự thật (giá, số lượng, chính sách) – không thêm thông tin mới." + brand(input.brandVoice),
      prompt: [
        `Tiêu đề: ${input.title}`,
        `Caption gốc: ${input.caption?.trim() || "(chưa có – viết mới dựa trên tiêu đề)"}`,
        `Hashtag gốc: ${input.hashtags.join(" ") || "(không có)"}`,
        `Tạo ${input.count} biến thể. Mỗi caption ≤ 400 ký tự. Hashtag 3–8 cái, có dấu #, không dấu tiếng Việt.`,
        'Trả về JSON: {"variants":[{"caption":"…","hashtags":["#…","#…"]}]} – mỗi hashtag là một chuỗi trong ngoặc kép; xuống dòng trong caption viết \\n.'
      ].join("\n"),
      json: true,
      maxTokens: 4e3,
      temperature: 0.9
    },
    { feature: "content.spin", workspaceId: input.workspaceId },
    SpinSchema,
    (d) => d.variants.map((v) => v.caption)
  );
  return { variants: data.variants.slice(0, input.count), meta: meta2 };
}
const HashtagSchema = zod.z.object({ hashtags: tagList(1) });
async function suggestHashtags(input) {
  const res = await aiText(
    {
      system: "Bạn là chuyên gia SEO mạng xã hội tại Việt Nam. Chọn hashtag phổ biến, đúng chủ đề, không spam, không gắn thương hiệu không liên quan.",
      prompt: [
        `Nền tảng: ${input.platform}`,
        `Tiêu đề: ${input.title}`,
        `Caption: ${input.caption ?? ""}`,
        'Đề xuất 6–10 hashtag (có dấu #, viết liền không dấu). Trả về JSON: {"hashtags":["#…"]}'
      ].join("\n"),
      json: true,
      maxTokens: 400,
      temperature: 0.5
    },
    { feature: "content.hashtags", workspaceId: input.workspaceId }
  );
  return normalizeTags(parse(HashtagSchema, res.text, "content.hashtags").hashtags);
}
function normalizeTags(tags) {
  const out = tags.map((t2) => t2.trim().replace(/\s+/g, "")).filter(Boolean).map((t2) => t2.startsWith("#") ? t2 : `#${t2}`);
  return [...new Set(out)].slice(0, 15);
}
async function suggestReply(input) {
  const transcript = input.history.slice(-12).map((m) => `${m.direction === "in" ? "Khách" : "Shop"}: ${m.body}`).join("\n");
  const res = await aiText(
    {
      system: `Bạn là nhân viên chăm sóc khách hàng của "${input.channelName}", trả lời bằng tiếng Việt lịch sự, ngắn gọn (≤ 80 từ), xưng "em/shop". Chỉ dùng thông tin có trong "Thông tin cửa hàng" và hội thoại. Nếu khách hỏi giá, tồn kho, thời gian giao hay chính sách mà không có thông tin, KHÔNG được tự đặt ra con số – hãy xin số điện thoại/hẹn nhắn tin riêng để nhân viên kiểm tra. Không hứa điều shop chưa xác nhận.` + brand(input.brandVoice),
      prompt: [
        `Kênh: ${input.source === "comment" ? "bình luận công khai" : "tin nhắn riêng"}`,
        input.contextPostTitle ? `Bài viết khách đang bình luận: ${input.contextPostTitle}` : "",
        input.knowledge.length ? `Thông tin cửa hàng:
${input.knowledge.map((k) => `- ${k.body}`).join("\n")}` : "Thông tin cửa hàng: (chưa có)",
        `Hội thoại với khách "${input.customerName}":
${transcript}`,
        "Viết DUY NHẤT câu trả lời tiếp theo của Shop, không kèm giải thích."
      ].filter(Boolean).join("\n\n"),
      maxTokens: 500,
      temperature: 0.6
    },
    { feature: "inbox.reply", workspaceId: input.workspaceId }
  );
  const text = res.text.trim().replace(/^(Shop|Trả lời)\s*:\s*/i, "").replace(/^"|"$/g, "");
  return { text, meta: res };
}
const DecisionSchema = zod.z.object({
  reply: clip(1200),
  /** 0–1: AI chắc câu trả lời đúng và đủ dựa trên thông tin cửa hàng (thiếu / sai → 0: vào hàng chờ duyệt, không tự gửi) */
  confidence: num(0, 1).catch(0),
  /** Cần người xử lý: khiếu nại, đổi trả, thông tin không có trong kiến thức, khách bực bội… (thiếu / sai → cần người) */
  needsHuman: bool().catch(true),
  reason: opt(200),
  intent: zod.z.enum(["price", "product", "order", "shipping", "complaint", "praise", "spam", "other"]).catch("other"),
  /** Khách thể hiện ý định mua / để lại SĐT – địa chỉ */
  lead: zod.z.boolean().catch(false)
});
async function decideReply(input) {
  const transcript = input.history.slice(-12).map((m) => `${m.direction === "in" ? "Khách" : "Shop"}: ${m.body}`).join("\n");
  const isComment = input.source === "comment";
  const res = await aiText(
    {
      system: `Bạn là nhân viên chăm sóc khách hàng của "${input.channelName}", trả lời tiếng Việt lịch sự, tự nhiên, xưng "em/shop", ` + (isComment ? "đây là bình luận CÔNG KHAI: ngắn (≤ 40 từ), không đưa thông tin cá nhân, mời khách nhắn tin nếu cần tư vấn chi tiết. " : "tin nhắn riêng: ≤ 80 từ. ") + 'QUY TẮC: chỉ dùng thông tin trong "Thông tin cửa hàng" và hội thoại; KHÔNG tự đặt ra giá, tồn kho, thời gian giao, khuyến mãi hay chính sách. Thiếu thông tin → vẫn viết câu trả lời lịch sự xin SĐT/hẹn nhân viên kiểm tra, đặt needsHuman=true. Khiếu nại, đổi trả, hoàn tiền, khách bực bội, câu hỏi nhạy cảm → needsHuman=true. Bình luận spam/quảng cáo → intent "spam", reply rỗng. confidence = mức chắc chắn câu trả lời đúng và đủ chỉ dựa trên thông tin đã cho.' + brand(input.brandVoice) + '\nTrả về DUY NHẤT JSON: {"reply": string, "confidence": number, "needsHuman": boolean, "reason": string, "intent": "price|product|order|shipping|complaint|praise|spam|other", "lead": boolean}',
      prompt: [
        `Kênh: ${isComment ? "bình luận công khai" : "tin nhắn riêng"}`,
        input.contextPostTitle ? `Bài viết khách đang bình luận: ${input.contextPostTitle}` : "",
        `Thông tin cửa hàng:
${input.knowledge.trim() || "(chưa có)"}`,
        `Hội thoại với khách "${input.customerName}":
${transcript}`
      ].filter(Boolean).join("\n\n"),
      maxTokens: 700,
      temperature: 0.3,
      json: true
    },
    { feature: "inbox.autoReply", workspaceId: input.workspaceId }
  );
  const decision = parse(DecisionSchema, res.text, "inbox.autoReply");
  decision.reply = decision.reply.trim().replace(/^(Shop|Trả lời)\s*:\s*/i, "").replace(/^"|"$/g, "");
  return { decision, meta: res };
}
const SeriesPlanSchema = zod.z.object({
  characters: list(
    zod.z.object({
      name: need(60),
      role: opt(80),
      appearance: opt(400),
      personality: opt(300),
      /** Tuyến phát triển qua các tập (tâm lý, vị trí trong truyện) – ngoại hình không đổi */
      arc: opt(400),
      gender: zod.z.preprocess((g) => typeof g === "string" ? g.trim().toLowerCase() : g, zod.z.enum(["male", "female", "other"])).catch("other")
    }),
    0,
    8
  ).catch([]),
  episodes: list(zod.z.object({ title: need(120), synopsis: need(800), cliffhanger: opt(300) }), 1, 30)
});
function previousBrief(previous) {
  if (!previous.length) return "";
  const recent = previous.slice(-10);
  const older = previous.slice(0, -10);
  return [
    `Các tập ĐÃ CÓ (viết tiếp, không lặp lại tình tiết):`,
    older.length ? `- Tập ${older[0].number}–${older[older.length - 1].number}: ${older.map((e) => e.title).join(" · ")}` : "",
    ...recent.map((e) => `- Tập ${e.number} "${e.title}": ${e.synopsis.slice(0, 220)}`)
  ].filter(Boolean).join("\n");
}
async function planSeriesArc(input) {
  const from = (input.previous[input.previous.length - 1]?.number ?? 0) + 1;
  const { data, meta: meta2 } = await aiJson(
    {
      system: "Bạn là biên kịch trưởng series phim ngắn, viết tiếng Việt. Lập mạch truyện cho một mùa: có mở đầu, phát triển, cao trào, kết (hoặc kết mở cho mùa sau), mỗi tập một bước tiến rõ ràng.",
      prompt: [
        `Tên series: ${input.title}`,
        input.logline ? `Ý tưởng: ${input.logline}` : "",
        input.genre ? `Thể loại: ${input.genre}` : "",
        input.existingCharacters.length ? `Nhân vật: ${input.existingCharacters.map((c) => `${c.name}${c.role ? ` (${c.role})` : ""}`).join(", ")}` : "",
        previousBrief(input.previous),
        `Lập mạch cho ${input.episodes} tập tiếp theo (tập ${from}–${from + input.episodes - 1}), mỗi tập MỘT câu nêu sự kiện chính.`,
        `Trả về JSON: {"beats":["…", …]} – đúng ${input.episodes} phần tử.`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: Math.min(16e3, 800 + input.episodes * 120),
      temperature: 0.8
    },
    { feature: "series.arc", workspaceId: input.workspaceId },
    zod.z.object({ beats: list(need(400), 1, 60) }),
    (d) => d.beats
  );
  return { beats: data.beats, meta: meta2 };
}
async function developSeries(input) {
  const from = (input.previous?.[input.previous.length - 1]?.number ?? 0) + 1;
  const { data, meta: res } = await aiJson(
    {
      system: "Bạn là biên kịch series phim ngắn dọc 9:16 cho mạng xã hội, viết tiếng Việt. Mỗi tập chỉ một tình huống chính, nhịp nhanh, kết treo để giữ người xem. Nội dung phù hợp mọi lứa tuổi, không bạo lực/phản cảm, không dùng nhân vật hay thương hiệu có bản quyền của người khác." + brand(input.brandVoice),
      prompt: [
        `Tên series: ${input.title}`,
        input.logline ? `Ý tưởng: ${input.logline}` : "",
        input.genre ? `Thể loại: ${input.genre}` : "",
        input.visualStyle ? `Phong cách hình ảnh: ${input.visualStyle}` : "",
        previousBrief(input.previous ?? []),
        `Số tập cần dàn ý: ${input.episodes} (tập ${from}–${from + input.episodes - 1}), mỗi tập khoảng ${input.episodeLengthSec} giây.`,
        input.beats?.length ? `Bám đúng mạch đã lập cho các tập này:
${input.beats.map((b, i) => `- Tập ${from + i}: ${b}`).join("\n")}` : "",
        input.existingCharacters.length ? `Nhân vật đã có (giữ nguyên, có thể thêm vai phụ nếu cần):
${input.existingCharacters.map((c) => `- ${c.name} (${c.role ?? ""}): ${c.appearance}`).join("\n")}` : "Tạo 2–5 nhân vật.",
        "appearance viết bằng TIẾNG VIỆT, mô tả ngoại hình cố định chi tiết (tuổi, giới tính, kiểu tóc, màu tóc, trang phục đặc trưng, đặc điểm nhận dạng) để AI vẽ nhân vật giống nhau ở mọi cảnh.",
        "arc: tuyến phát triển của nhân vật qua các tập (tâm lý, mối quan hệ, bước ngoặt – nêu tập nếu có), tiếng Việt, 1–2 câu. Nhân vật đã có: vẫn trả về kèm arc (giữ nguyên tên, ngoại hình).",
        'Trả về JSON: {"characters":[{"name","role","appearance","personality","arc","gender":"male|female|other"}],"episodes":[{"title","synopsis","cliffhanger"}]}'
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: Math.min(16e3, 3e3 + input.episodes * 700),
      temperature: 0.85
    },
    { feature: "series.develop", workspaceId: input.workspaceId },
    SeriesPlanSchema,
    (d) => [...d.episodes.flatMap((e) => [e.title, e.synopsis]), ...d.characters.map((c) => c.appearance)]
  );
  return { plan: data, meta: res };
}
const speaker = () => opt(60).transform((s) => s || "narrator");
const EpisodeScriptSchema = zod.z.object({
  scenes: list(
    zod.z.object({
      label: opt(80),
      /** Tên nhân vật nói câu thoại, hoặc "narrator" cho lời dẫn */
      speaker: speaker(),
      line: need(600),
      durationSec: num(1, 30),
      /** Chỉ đạo hình ảnh (tiếng Anh) – app ghép thành prompt video hoàn chỉnh */
      shot: ShotZ,
      searchQuery: txt(120)
    }),
    2,
    20
  )
});
async function writeEpisode(input) {
  const sceneCount = input.lengthSec <= 30 ? 5 : input.lengthSec <= 60 ? 8 : 12;
  const { data, meta: res } = await aiJson(
    {
      system: "Bạn là biên kịch phim ngắn dọc 9:16 viết tiếng Việt. Câu thoại ngắn, tự nhiên, đọc thành giọng nói được; mỗi cảnh một câu thoại của MỘT người nói. Không emoji trong thoại. Nội dung phù hợp mọi lứa tuổi." + brand(input.brandVoice),
      prompt: [
        `Series: ${input.seriesTitle}${input.genre ? ` (${input.genre})` : ""}`,
        input.logline ? `Ý tưởng series: ${input.logline}` : "",
        `Nhân vật:
${input.characters.map((c) => `- ${c.name}${c.role ? ` – ${c.role}` : ""}${c.personality ? `: ${c.personality}` : ""}`).join("\n")}`,
        input.previous.length ? `Các tập trước:
${input.previous.map((p) => `Tập ${p.number} – ${p.title}: ${p.synopsis}`).join("\n")}` : "",
        `Viết TẬP ${input.episode.number}: "${input.episode.title}". Dàn ý: ${input.episode.synopsis}`,
        input.episode.cliffhanger ? `Kết tập bằng tình huống treo: ${input.episode.cliffhanger}` : "Kết tập bằng một tình huống treo.",
        `Thời lượng ${input.lengthSec} giây, khoảng ${sceneCount} cảnh. Cảnh 1 là hook 2–4 giây (có thể dùng lời dẫn tóm tắt tập trước).`,
        bibleBrief(input.bible),
        'speaker là đúng tên một nhân vật ở trên, hoặc "narrator" cho lời dẫn.',
        SHOT_RULES,
        `Trả về JSON: {"scenes":[{"label","speaker","line":"thoại tiếng Việt","durationSec",${SHOT_JSON}}]}`,
        `Tổng durationSec bằng ${input.lengthSec}.`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 16e3,
      temperature: 0.8
    },
    { feature: "series.episode", workspaceId: input.workspaceId },
    EpisodeScriptSchema,
    (d) => d.scenes.map((s) => s.line)
  );
  return { scenes: data.scenes, meta: res };
}
const pad2 = (s) => s.padStart(2, "0");
const isoDate = zod.z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const ymd = v.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${pad2(ymd[2])}-${pad2(ymd[3])}`;
  const dmy = v.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  return dmy ? `${dmy[3]}-${pad2(dmy[2])}-${pad2(dmy[1])}` : v;
}, zod.z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function flattenPlan(v) {
  const root2 = isObj(v) ? v : null;
  let arr = Array.isArray(v) ? v : root2?.ideas ?? root2?.plan ?? root2?.days ?? root2?.items;
  if (!Array.isArray(arr)) {
    if (!root2) return v;
    const byDate = Object.entries(root2).filter(([k, x]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(x));
    if (!byDate.length) return v;
    arr = byDate.flatMap(([date, x]) => x.filter(isObj).map((i) => ({ date, ...i })));
  }
  return {
    ideas: arr.flatMap((x) => {
      if (!isObj(x)) return [x];
      const inner = x.ideas ?? x.items;
      return Array.isArray(inner) ? inner.filter(isObj).map((i) => ({ date: x.date, ...i })) : [x];
    })
  };
}
const PlanSchema = zod.z.preprocess(
  flattenPlan,
  zod.z.object({
    ideas: list(
      zod.z.object({
        date: isoDate,
        format: opt(80),
        title: need(200),
        hook: opt(300),
        description: opt(800)
      }),
      1,
      120
    )
  })
);
const PLAN_CHUNK_DAYS = 7;
async function planContent(input) {
  const ideas = [];
  const metas = [];
  let lastErr = null;
  for (let i = 0; i < input.dates.length; i += PLAN_CHUNK_DAYS) {
    const dates = input.dates.slice(i, i + PLAN_CHUNK_DAYS);
    try {
      const { data, meta: meta2 } = await aiJson(
        {
          system: "Bạn là trưởng nhóm nội dung cho page mạng xã hội (video ngắn và bài viết) tại Việt Nam. Lập kế hoạch thực tế, đa dạng, không lặp chủ đề, phù hợp ngách. Không đề xuất nội dung vi phạm bản quyền (dùng lại phim, nhạc, cảnh quay trận đấu của người khác), không tin giả, không giật tít sai sự thật." + brand(input.brandVoice),
          prompt: [
            `Ngách / chủ đề page: ${input.niche}`,
            input.topPosts.length ? `Bài hiệu quả nhất gần đây của page (học phong cách, chủ đề người xem thích):
${input.topPosts.map((t2) => `- ${t2.title} (${t2.views ?? "?"} xem, ${t2.engagements ?? "?"} tương tác)`).join("\n")}` : "Page chưa có số liệu bài đăng.",
            input.trends.length ? `Xu hướng tìm kiếm hiện tại (chỉ dùng nếu liên quan tới ngách):
${input.trends.map((t2) => `- ${t2}`).join("\n")}` : "",
            `Định dạng được dùng:
${input.formats.map((f) => `- ${f.id}: ${f.label} – ${f.guide}`).join("\n")}`,
            ideas.length ? `Ý tưởng ĐÃ CÓ ở các ngày trước (không lặp lại chủ đề):
${ideas.slice(-40).map((x) => `- ${x.title}`).join("\n")}` : "",
            `Lập ${input.perDay} ý tưởng mỗi ngày cho các ngày: ${dates.join(", ")} (tổng ${dates.length * input.perDay} ý tưởng).`,
            "format phải là một id trong danh sách trên. hook là câu mở đầu giữ chân người xem trong 3 giây đầu. description 1–3 câu nêu nội dung chính.",
            'Trả về DUY NHẤT một JSON hợp lệ theo đúng mẫu – danh sách phẳng, mỗi ý tưởng một object (mọi khóa đều có giá trị chuỗi, không xuống dòng trong chuỗi): {"ideas":[{"date":"YYYY-MM-DD","format":"id định dạng","title":"tiêu đề","hook":"câu mở đầu","description":"mô tả ngắn"}]}'
          ].filter(Boolean).join("\n"),
          json: true,
          maxTokens: Math.min(16e3, 2e3 + dates.length * input.perDay * 400),
          temperature: 0.8
        },
        { feature: "plan.generate", workspaceId: input.workspaceId },
        PlanSchema,
        (d) => d.ideas.flatMap((x) => [x.title, x.hook, x.description])
      );
      ideas.push(...data.ideas);
      metas.push(meta2);
    } catch (err) {
      if (!(err instanceof AiError) || err.kind !== "invalid_output") throw err;
      console.warn(`[ai] plan.generate: đợt ${dates[0]}…${dates[dates.length - 1]} lỗi – ${err.message}`);
      lastErr = err;
    }
  }
  if (!metas.length) throw lastErr ?? new AiError("invalid_output", "AI trả về sai cấu trúc dữ liệu");
  const last = metas[metas.length - 1];
  const cost = metas.reduce((s, m) => m.costUsd == null ? s : (s ?? 0) + m.costUsd, null);
  return { ideas, meta: { ...last, costUsd: cost, attempts: metas.flatMap((m) => m.attempts) } };
}
const ActsSchema = zod.z.object({
  bible: BibleZ.optional().catch(void 0),
  acts: list(zod.z.object({ title: need(120), summary: need(800), durationSec: num(10, 600) }), 2, 10)
});
const ActScenesSchema = zod.z.object({
  scenes: list(
    zod.z.object({
      label: opt(80),
      speaker: speaker(),
      line: need(600),
      durationSec: num(1, 30),
      shot: ShotZ,
      searchQuery: txt(120)
    }),
    1,
    80
  )
});
const actCountFor = (sec) => Math.max(3, Math.min(8, Math.round(sec / 120)));
const longSystem = (ctx) => (ctx.kind === "episode" ? `Bạn là biên kịch phim ${ctx.vertical ? "dọc 9:16" : "ngang 16:9"} nhiều tập viết tiếng Việt. Câu thoại ngắn, tự nhiên, đọc thành giọng nói được; mỗi cảnh một câu thoại của MỘT người nói. Nội dung phù hợp mọi lứa tuổi.` : `Bạn là biên kịch video dài ${ctx.vertical ? "dọc 9:16" : "ngang 16:9"} cho mạng xã hội viết tiếng Việt tự nhiên, câu ngắn, dễ đọc thành giọng nói.`) + " Không bịa số liệu, không emoji trong lời thoại." + brand(ctx.brandVoice);
const charList = (ctx) => ctx.characters.length ? `Nhân vật:
${ctx.characters.map((c) => `- ${c.name}${c.role ? ` – ${c.role}` : ""}${c.personality ? `: ${c.personality}` : ""}`).join("\n")}` : "";
async function outlineActs(ctx) {
  const n = actCountFor(ctx.totalSec);
  const { data, meta: meta2 } = await aiJson(
    {
      system: longSystem(ctx),
      prompt: [
        `${ctx.kind === "episode" ? "Tập phim" : "Chủ đề"}: ${ctx.topic}`,
        ...ctx.brief,
        charList(ctx),
        `Tổng thời lượng ${Math.round(ctx.totalSec / 60)} phút (${ctx.totalSec} giây). Chia thành ${n} hồi theo mạch: mở đầu cuốn hút → phát triển → cao trào → kết${ctx.kind === "episode" ? " (tình huống treo nếu có)" : ""}.`,
        "Mỗi hồi: title ngắn ≤ 8 từ, summary 2–4 câu nêu cụ thể diễn biến/ý chính của hồi (không viết thoại), durationSec.",
        ctx.bible ? bibleBrief(ctx.bible) : `Đồng thời lập ${BIBLE_RULES}`,
        !ctx.bible && ctx.images?.length ? REFS_SEEN_RULE : "",
        `Trả về JSON: {"acts":[{"title","summary","durationSec"}]${ctx.bible ? "" : `,"bible":${BIBLE_JSON}`}}. Tổng durationSec bằng ${ctx.totalSec}.`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 6e3,
      temperature: 0.8,
      ...!ctx.bible && ctx.images?.length ? { images: ctx.images } : {}
    },
    { feature: ctx.kind === "episode" ? "series.outline" : "studio.outline", workspaceId: ctx.workspaceId },
    ActsSchema,
    (d) => d.acts.flatMap((a) => [a.title, a.summary])
  );
  const sum = data.acts.reduce((a, x) => a + x.durationSec, 0) || 1;
  const acts = data.acts.map((a) => ({ title: a.title.trim(), summary: a.summary.trim(), targetSec: Math.max(20, Math.round(a.durationSec * ctx.totalSec / sum)) }));
  return { acts, bible: ctx.bible ?? data.bible ?? null, meta: meta2 };
}
async function writeActScenes(ctx, acts, index, previousTail) {
  const act = acts[index];
  const sceneCount = Math.max(3, Math.round(act.targetSec / 7));
  const { data, meta: meta2 } = await aiJson(
    {
      system: longSystem(ctx),
      prompt: [
        `${ctx.kind === "episode" ? "Tập phim" : "Chủ đề"}: ${ctx.topic}`,
        ...ctx.brief,
        charList(ctx),
        `Dàn ý toàn bộ (${acts.length} hồi):
${acts.map((a, i) => `${i + 1}. ${a.title} (${a.targetSec}s): ${a.summary}`).join("\n")}`,
        previousTail.length ? `Cuối hồi ${index} vừa viết (nối mạch tự nhiên, không lặp lại):
${previousTail.map((l) => `- ${l}`).join("\n")}` : "",
        `Giờ CHỈ viết HỒI ${index + 1}: "${act.title}" – ${act.summary}`,
        `Thời lượng hồi ${act.targetSec} giây, khoảng ${sceneCount} cảnh, mỗi cảnh 4–10 giây.`,
        index === 0 ? "Cảnh đầu tiên là hook gây tò mò." : "",
        index === acts.length - 1 ? ctx.kind === "episode" ? "Cảnh cuối là kết tập / tình huống treo." : "Cảnh cuối là lời kết + CTA ngắn (theo dõi / bình luận)." : "",
        bibleBrief(ctx.bible),
        ctx.kind === "episode" ? 'speaker là đúng tên một nhân vật ở trên, hoặc "narrator" cho lời dẫn.' : 'speaker luôn là "narrator".',
        SHOT_RULES,
        `Trả về JSON: {"scenes":[{"label":"nhãn ≤ 4 từ","speaker","line":"lời thoại tiếng Việt","durationSec",${SHOT_JSON}}]}`,
        `Tổng durationSec bằng ${act.targetSec}.`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 16e3,
      temperature: 0.8
    },
    { feature: ctx.kind === "episode" ? "series.act" : "studio.act", workspaceId: ctx.workspaceId },
    ActScenesSchema,
    (d) => d.scenes.map((s) => s.line)
  );
  return { scenes: data.scenes, meta: meta2 };
}
const CharacterPromptSchema = zod.z.object({
  imagePrompt: need(1500).refine((s) => s.length >= 20, "quá ngắn"),
  appearanceEn: need(500)
});
async function characterImagePrompt(input) {
  const { data, meta: meta2 } = await aiJson(
    {
      system: "You are an expert prompt engineer for AI image generators (Google Nano Banana / Gemini, Imagen, Flux, Midjourney, DALL·E). You turn a Vietnamese character description into precise English prompts. Translate faithfully; you may add plausible concrete visual details (face shape, hairstyle, fabric, colors) that are CONSISTENT with the description, but never contradict it. If nothing says otherwise, the character is Vietnamese.",
      prompt: [
        `Series: "${input.seriesTitle}"${input.genre ? ` – genre: ${input.genre}` : ""}`,
        input.visualStyle ? `Series visual style (may be Vietnamese): ${input.visualStyle}` : "Series visual style: not specified – use photorealistic cinematic",
        `Character name: ${input.name}${input.role ? ` – role: ${input.role}` : ""}`,
        `Appearance (Vietnamese): ${input.appearance || "(none – infer a fitting look from role and personality)"}`,
        input.personality ? `Personality (Vietnamese): ${input.personality}` : "",
        "",
        'Return JSON {"imagePrompt": "...", "appearanceEn": "..."}:',
        '- imagePrompt: ONE English paragraph (80–160 words) for a CHARACTER REFERENCE image: full body, front view, natural standing pose, plain light grey background, soft even studio lighting, sharp focus on the face. Describe age, gender, ethnicity, face, hair, outfit with colors and materials, distinctive features, and a facial expression/pose that conveys the personality. Include the art style from the series visual style (translated), camera/lens and quality keywords. End with: "single character, no text, no watermark, no logo".',
        "- appearanceEn: concise English description of the FIXED visual traits only (age, gender, ethnicity, hair, outfit, distinctive features), comma-separated, max 40 words, no style or background words."
      ].join("\n"),
      json: true,
      maxTokens: 3e3,
      temperature: 0.4
    },
    { feature: "series.characterPrompt", workspaceId: input.workspaceId },
    CharacterPromptSchema
  );
  return { imagePrompt: data.imagePrompt.trim(), appearanceEn: data.appearanceEn.trim(), meta: meta2 };
}
const StyleSchema = zod.z.object({ en: need(400) });
async function filmStyleKeywords(custom, presetEn, workspaceId) {
  const { data } = await aiJson(
    {
      system: "You are a prompt engineer for AI image and video generators. Turn a film style brief (often Vietnamese) into concise English VISUAL style keywords. Keep only what can be seen: art style / medium, era and setting style, costume style, color palette, lighting, mood, camera / lens look. Drop plot, character names and dialogue.",
      prompt: [
        presetEn ? `Already chosen (do not repeat): ${presetEn}` : "",
        `Brief:
${custom}`,
        'Return JSON {"en": "comma-separated English keywords, max 40 words"}.'
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 1500,
      temperature: 0.3
    },
    { feature: "film.style", workspaceId },
    StyleSchema
  );
  return data.en.trim();
}
const AssetDescSchema = zod.z.object({ items: list(zod.z.object({ id: need(80), description: need(2e3) }), 1, 200) });
async function filmAssetDescriptions(items, film, workspaceId) {
  if (items.length > 12) {
    const out = /* @__PURE__ */ new Map();
    for (let i = 0; i < items.length; i += 12) for (const [k, v] of await filmAssetDescriptions(items.slice(i, i + 12), film, workspaceId)) out.set(k, v);
    return out;
  }
  const { data } = await aiJson(
    {
      system: "You are a prompt engineer for AI image and video generators (Nano Banana, Veo, Seedance). The user edits each item in VIETNAMESE – the Vietnamese text is the source of truth. Write the English visual description used inside image/video prompts. Translate faithfully; keep concrete details from the current English description only when they do NOT contradict the Vietnamese; remove details the Vietnamese changed or removed. Describe only what can be seen. If nothing says otherwise, characters are Vietnamese.",
      prompt: [
        `Film: "${film.title}"${film.style ? ` – visual style: ${film.style}` : ""}`,
        "Per kind:",
        "- character: fixed look only – age, gender, ethnicity, face, hair, outfit with colors and materials, distinctive features (no actions, no background), 30–70 words.",
        "- location: the place – architecture / nature, era, time of day, weather, lighting, atmosphere; no people, 30–70 words.",
        "- shot: what happens in the frame – action, expressions, positions, refer to characters by their names, 20–60 words.",
        "",
        "Input (one JSON object):",
        JSON.stringify({
          items: items.map((i) => ({ id: i.id, kind: i.kind, name: i.name, vietnamese: i.summary, currentEnglish: i.current || null, ...i.context ? { context: i.context } : {} }))
        }),
        "",
        `Return exactly ONE JSON object (not one object per line): {"items":[{"id":"…","description":"English description"}, …]} – ${items.length} entries, same ids.`
      ].join("\n"),
      json: true,
      maxTokens: 1500 + items.length * 400,
      temperature: 0.3
    },
    { feature: "film.prompt", workspaceId },
    AssetDescSchema
  );
  return new Map(data.items.filter((x) => items.some((i) => i.id === x.id)).map((x) => [x.id, x.description.trim()]));
}
async function visualStyleKeywords(style, workspaceId) {
  const { data } = await aiJson(
    {
      system: "You are a prompt engineer for AI image and video generators. Convert a visual style description (often Vietnamese) into concise English style keywords.",
      prompt: `Visual style: ${style}
Return JSON {"en": "comma-separated English style keywords, max 30 words (art style, color palette, lighting, mood, camera look); no characters, no story"}.`,
      json: true,
      maxTokens: 1500,
      temperature: 0.3
    },
    { feature: "series.style", workspaceId },
    StyleSchema
  );
  return data.en.trim();
}
const BibleOutZ = zod.z.object({ bible: BibleZ });
const bibleVi = (b) => [b.styleVi, ...b.characters.map((c) => c.lookVi), b.product?.lookVi ?? ""].filter(Boolean);
function keepShape(prev, next) {
  const vi = (s) => s || void 0;
  return {
    style: next.style || prev.style,
    styleVi: vi(next.styleVi) ?? prev.styleVi,
    characters: prev.characters.length ? [
      ...prev.characters.map((c, i) => {
        const n = next.characters.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase()) ?? next.characters[i];
        return n ? { name: c.name, look: n.look, lookVi: vi(n.lookVi) } : c;
      }),
      // Nhân vật mới AI thêm (ảnh có người mà bộ cũ chưa có)
      ...next.characters.slice(prev.characters.length).filter((n) => !prev.characters.some((c) => c.name.trim().toLowerCase() === n.name.trim().toLowerCase())).map((n) => ({ name: n.name, look: n.look, lookVi: vi(n.lookVi) }))
    ] : next.characters.map((c) => ({ name: c.name, look: c.look, lookVi: vi(c.lookVi) })),
    product: prev.product ? next.product ? { name: prev.product.name, look: next.product.look, lookVi: vi(next.product.lookVi) } : prev.product : next.product ? { name: next.product.name, look: next.product.look, lookVi: vi(next.product.lookVi) } : null
  };
}
async function bibleFromImages(input) {
  const { data, meta: meta2 } = await aiJson(
    {
      system: "Bạn là đạo diễn hình ảnh. Bạn viết mô tả ngoại hình cố định của nhân vật / sản phẩm để AI tạo video vẽ nhất quán ở mọi cảnh.",
      prompt: [
        `Chủ đề video: ${input.topic}`,
        `Bộ nhận diện hiện tại:
${bibleBrief(input.bible)}`,
        REFS_SEEN_RULE,
        "Viết lại visual bible theo ảnh: GIỮ NGUYÊN tên (name) và thứ tự các nhân vật / sản phẩm hiện có, chỉ sửa look cho khớp ảnh; giữ style nếu vẫn hợp, có thể bổ sung tông màu từ ảnh.",
        "Bộ hiện tại chưa có nhân vật / sản phẩm mà ảnh có → thêm mới (tên ngắn) vào cuối danh sách.",
        `Quy tắc: ${BIBLE_RULES}`,
        `Trả về JSON: {"bible":${BIBLE_JSON}}`
      ].join("\n"),
      json: true,
      maxTokens: 3e3,
      temperature: 0.3,
      images: input.images
    },
    { feature: "studio.bible", workspaceId: input.workspaceId },
    BibleOutZ,
    (d) => bibleVi(d.bible)
  );
  if (!meta2.imagesSeen)
    throw new AiError(
      "bad_request",
      `${meta2.providerLabel} không xem được ảnh – cần AI văn bản đọc được ảnh (Gemini, OpenAI hoặc Claude) trong Cài đặt › Khóa AI, hoặc sửa tay bộ nhận diện bằng nút "Sửa"`
    );
  return { bible: keepShape(input.bible, data.bible), meta: meta2 };
}
async function translateBible(input) {
  const e = input.edited;
  const { data, meta: meta2 } = await aiJson(
    {
      system: "Bạn dịch mô tả hình ảnh tiếng Việt sang tiếng Anh ngắn gọn, đúng thuật ngữ điện ảnh, dùng làm prompt cho AI tạo video. Giữ nguyên mọi chi tiết, không thêm ý.",
      prompt: [
        "Dịch bộ nhận diện sau, giữ nguyên name và thứ tự. style, look: bản tiếng Anh. styleVi, lookVi: chép lại NGUYÊN VĂN phần tiếng Việt bên dưới (phần nào vốn là tiếng Anh thì dịch sang tiếng Việt).",
        `Phong cách chung: ${e.style}`,
        ...e.characters.map((c) => `Nhân vật "${c.name}": ${c.look}`),
        e.product ? `Sản phẩm "${e.product.name}": ${e.product.look}` : "Không có sản phẩm (product = null).",
        `Trả về JSON: {"bible":${BIBLE_JSON}}`
      ].join("\n"),
      json: true,
      maxTokens: 2500,
      temperature: 0.2
    },
    { feature: "studio.bible", workspaceId: input.workspaceId },
    BibleOutZ,
    (d) => bibleVi(d.bible)
  );
  const t2 = data.bible;
  return {
    bible: {
      style: t2.style || e.style,
      styleVi: e.style,
      characters: e.characters.map((c, i) => {
        const n = t2.characters.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase()) ?? t2.characters[i];
        return { name: c.name, look: n?.look || c.look, lookVi: c.look };
      }),
      product: e.product ? { name: e.product.name, look: t2.product?.look || e.product.look, lookVi: e.product.look } : null
    },
    meta: meta2
  };
}
const FRESH_MS = 30 * 6e4;
const AI_RULE_ID = "ai";
const LEAD_TAG = "Khách tiềm năng";
const PHONE_TAG = "Có SĐT";
const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/;
const DEFAULT_AI_SETTINGS = {
  mode: "off",
  comments: true,
  messages: true,
  minConfidence: 0.8,
  minDelaySec: 20,
  maxDelaySec: 90,
  maxPerHour: 30,
  autoLike: false,
  tagLeads: true
};
function aiSettings() {
  const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "inbox.ai")).get()?.value;
  return { ...DEFAULT_AI_SETTINGS, ...v ?? {} };
}
function saveAiSettings(patch) {
  const next = { ...aiSettings(), ...patch };
  if (next.maxDelaySec < next.minDelaySec) next.maxDelaySec = next.minDelaySec;
  getDb().insert(settings).values({ key: "inbox.ai", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: /* @__PURE__ */ new Date() } }).run();
  if (patch.autoLike === false) getDb().delete(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.action, "like"), drizzleOrm.eq(messages.deliveryStatus, "pending"))).run();
  return next;
}
const between = (lo, hi) => lo + Math.random() * Math.max(0, hi - lo);
function addTags(conversationId, tags) {
  const db2 = getDb();
  const c = db2.select({ tags: conversations.tags }).from(conversations).where(drizzleOrm.eq(conversations.id, conversationId)).get();
  if (!c) return;
  const next = [.../* @__PURE__ */ new Set([...c.tags, ...tags])];
  if (next.length !== c.tags.length) db2.update(conversations).set({ tags: next, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(conversations.id, conversationId)).run();
}
function removeTags(conversationId, tags) {
  const db2 = getDb();
  const c = db2.select({ tags: conversations.tags }).from(conversations).where(drizzleOrm.eq(conversations.id, conversationId)).get();
  if (!c) return;
  const next = c.tags.filter((t2) => !tags.includes(t2));
  if (next.length !== c.tags.length) db2.update(conversations).set({ tags: next, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(conversations.id, conversationId)).run();
}
function quickEngagement(items, cfg = aiSettings()) {
  const db2 = getDb();
  let queued = 0;
  for (const { conversation: conv, message: msg } of items) {
    if (Date.now() - msg.createdAt.getTime() > FRESH_MS) continue;
    if (cfg.tagLeads && PHONE.test(msg.body)) addTags(conv.id, [LEAD_TAG, PHONE_TAG]);
    if (cfg.autoLike && conv.platform === "facebook" && conv.source === "comment" && msg.externalId) {
      db2.insert(messages).values({
        id: newId(),
        conversationId: conv.id,
        direction: "out",
        author: "system",
        body: "Page đã thích bình luận",
        action: "like",
        targetId: msg.externalId,
        deliveryStatus: "pending",
        sendAfter: new Date(Date.now() + between(5, 40) * 1e3)
      }).run();
      queued++;
    }
  }
  return queued;
}
const queue = [];
let working = false;
let onQueued = null;
function setAiKick(fn) {
  onQueued = fn;
}
function clearAiQueue() {
  queue.length = 0;
}
function enqueueAi(items, cfg = aiSettings()) {
  if (cfg.mode === "off") return 0;
  let n = 0;
  for (const { conversation: conv, message: msg } of items) {
    if (conv.platform === "tiktok") continue;
    if (Date.now() - msg.createdAt.getTime() > FRESH_MS) continue;
    if (conv.source === "comment" ? !cfg.comments : !cfg.messages) continue;
    const dup = queue.findIndex((q) => q.conversationId === conv.id);
    if (dup >= 0) queue.splice(dup, 1);
    queue.push({ conversationId: conv.id, messageId: msg.id });
    n++;
  }
  if (n) void work();
  return n;
}
async function work() {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        await handle(job.conversationId, job.messageId);
      } catch (err) {
        if (err instanceof AiError && (err.kind === "budget" || err.kind === "quota" || err.kind === "no_provider")) {
          console.warn(`[inbox-ai] dừng: ${err.message}`);
          queue.length = 0;
          break;
        }
        console.warn(`[inbox-ai] lỗi soạn trả lời: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    working = false;
  }
}
function knowledgeOf(workspaceId) {
  const db2 = getDb();
  const ws = workspaceId ? db2.select({ knowledge: workspaces.knowledge, brandVoice: workspaces.brandVoice }).from(workspaces).where(drizzleOrm.eq(workspaces.id, workspaceId)).get() : void 0;
  const quick = db2.select({ body: quickReplies.body }).from(quickReplies).where(workspaceId ? drizzleOrm.or(drizzleOrm.isNull(quickReplies.workspaceId), drizzleOrm.eq(quickReplies.workspaceId, workspaceId)) : drizzleOrm.isNull(quickReplies.workspaceId)).all();
  const text = [ws?.knowledge?.trim(), ...quick.map((q) => `- ${q.body}`)].filter(Boolean).join("\n");
  return { text, brandVoice: ws?.brandVoice ?? null };
}
async function handle(conversationId, messageId) {
  const db2 = getDb();
  const cfg = aiSettings();
  if (cfg.mode === "off") return;
  const conv = db2.select().from(conversations).where(drizzleOrm.eq(conversations.id, conversationId)).get();
  const msg = db2.select().from(messages).where(drizzleOrm.eq(messages.id, messageId)).get();
  if (!conv || !msg) return;
  const handled = db2.select({ id: messages.id }).from(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.conversationId, conv.id), drizzleOrm.eq(messages.direction, "out"), drizzleOrm.inArray(messages.action, ["message", "hide"]), drizzleOrm.gte(messages.createdAt, msg.createdAt))).get();
  if (handled) return;
  const newer = db2.select({ id: messages.id }).from(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.conversationId, conv.id), drizzleOrm.eq(messages.direction, "in"), drizzleOrm.gt(messages.createdAt, msg.createdAt))).get();
  if (newer) return;
  const history = db2.select({ direction: messages.direction, body: messages.body }).from(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.conversationId, conv.id), drizzleOrm.inArray(messages.action, ["message"]), drizzleOrm.or(drizzleOrm.isNull(messages.deliveryStatus), drizzleOrm.inArray(messages.deliveryStatus, ["sent", "pending"])))).orderBy(drizzleOrm.asc(messages.createdAt)).all();
  const { text: knowledge, brandVoice } = knowledgeOf(conv.workspaceId);
  const { decision, meta: meta2 } = await decideReply({
    customerName: conv.customerName,
    channelName: db2.select({ name: channels.name }).from(channels).where(drizzleOrm.eq(channels.id, conv.channelId)).get()?.name ?? "cửa hàng",
    source: conv.source,
    contextPostTitle: conv.contextPostTitle,
    history,
    knowledge,
    brandVoice,
    workspaceId: conv.workspaceId
  });
  if (cfg.tagLeads && decision.lead) addTags(conv.id, [LEAD_TAG]);
  if (decision.intent === "spam") {
    removeTags(conv.id, [LEAD_TAG, PHONE_TAG]);
    if (msg.externalId) {
      db2.delete(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.conversationId, conv.id), drizzleOrm.eq(messages.action, "like"), drizzleOrm.eq(messages.targetId, msg.externalId), drizzleOrm.eq(messages.deliveryStatus, "pending"))).run();
    }
  }
  if (decision.intent === "spam" || !decision.reply.trim()) {
    console.info(`[inbox-ai] bỏ qua (${decision.intent}) hội thoại ${conv.id.slice(0, 8)}`);
    return;
  }
  const sentLastHour = db2.select({ id: messages.id }).from(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.ruleId, AI_RULE_ID), drizzleOrm.inArray(messages.deliveryStatus, ["pending", "sent"]), drizzleOrm.gte(messages.createdAt, new Date(Date.now() - 36e5)))).all().length;
  const confident = decision.confidence >= cfg.minConfidence && !decision.needsHuman;
  const auto = cfg.mode === "auto" && confident && sentLastHour < cfg.maxPerHour;
  const why = !confident ? decision.needsHuman ? `Cần người xử lý${decision.reason ? `: ${decision.reason}` : ""}` : `AI chưa chắc chắn (${Math.round(decision.confidence * 100)}%)${decision.reason ? ` – ${decision.reason}` : ""}` : cfg.mode === "auto" ? `Đã đạt giới hạn ${cfg.maxPerHour} câu tự gửi/giờ` : "Chế độ soạn nháp – chờ duyệt";
  db2.insert(messages).values({
    id: newId(),
    conversationId: conv.id,
    direction: "out",
    author: "bot",
    body: decision.reply.trim(),
    action: "message",
    targetId: conv.source === "comment" ? msg.externalId : null,
    ruleId: AI_RULE_ID,
    deliveryStatus: auto ? "pending" : "draft",
    sendAfter: auto ? new Date(Date.now() + between(cfg.minDelaySec, cfg.maxDelaySec) * 1e3) : null,
    aiNote: `${auto ? "Tự gửi" : why} · ý định: ${decision.intent} · tin cậy ${Math.round(decision.confidence * 100)}% · ${meta2.model}`
  }).run();
  if (!auto) db2.update(conversations).set({ status: "pending", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(conversations.id, conv.id), drizzleOrm.eq(conversations.status, "open"))).run();
  console.info(`[inbox-ai] ${auto ? "tự gửi" : "nháp chờ duyệt"} · ${decision.intent} · ${Math.round(decision.confidence * 100)}% (hội thoại ${conv.id.slice(0, 8)})`);
  if (auto) onQueued?.();
}
function approveDraft(id2, body) {
  const res = getDb().update(messages).set({ deliveryStatus: "pending", ...body?.trim() ? { body: body.trim() } : {}, sendAfter: null, aiNote: null, createdAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(messages.id, id2), drizzleOrm.eq(messages.deliveryStatus, "draft"))).run();
  return res.changes > 0;
}
function discardDraft(id2) {
  return getDb().delete(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.id, id2), drizzleOrm.eq(messages.deliveryStatus, "draft"))).run().changes > 0;
}
function draftCount() {
  return getDb().select({ id: messages.id }).from(messages).where(drizzleOrm.eq(messages.deliveryStatus, "draft")).all().length;
}
const stateKey = (channelId) => `inbox.sync.${channelId}`;
function syncState(channelId) {
  return getDb().select().from(settings).where(drizzleOrm.eq(settings.key, stateKey(channelId))).get()?.value ?? null;
}
function saveState(channelId, state2) {
  getDb().insert(settings).values({ key: stateKey(channelId), value: state2 }).onConflictDoUpdate({ target: settings.key, set: { value: state2, updatedAt: /* @__PURE__ */ new Date() } }).run();
}
function upsertThread(ch, conv, items, firstSync) {
  const db2 = getDb();
  return db2.transaction((tx) => {
    let row = tx.select().from(conversations).where(drizzleOrm.and(drizzleOrm.eq(conversations.channelId, ch.id), drizzleOrm.eq(conversations.externalId, conv.externalId))).get();
    if (!row) {
      row = tx.insert(conversations).values({
        id: newId(),
        workspaceId: ch.workspaceId,
        channelId: ch.id,
        platform: ch.platform,
        source: conv.source,
        externalId: conv.externalId,
        customerName: conv.customerName,
        customerExternalId: conv.customerExternalId,
        contextPostId: conv.contextPostId ?? null,
        contextPostTitle: conv.contextPostTitle ?? null
      }).returning().get();
    }
    const ids = items.map((m) => m.externalId);
    const existing = new Set(
      ids.length ? tx.select({ externalId: messages.externalId }).from(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.conversationId, row.id), drizzleOrm.inArray(messages.externalId, ids))).all().map((m) => m.externalId) : []
    );
    const added = [];
    let unread = 0;
    let last = null;
    for (const m of [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      if (existing.has(m.externalId)) continue;
      const msg = tx.insert(messages).values({
        id: newId(),
        conversationId: row.id,
        direction: m.inbound ? "in" : "out",
        // Tin đi ra không do app gửi = nhân viên trả lời trực tiếp trên nền tảng
        author: m.inbound ? "customer" : "agent",
        body: m.body,
        attachments: m.attachments,
        externalId: m.externalId,
        deliveryStatus: m.inbound ? null : "sent",
        createdAt: m.createdAt
      }).returning().get();
      if (m.inbound) {
        if (!firstSync) unread++;
        added.push({ conversation: row, message: msg });
      }
      if (!last || m.createdAt > last.createdAt) last = m;
    }
    if (last && (!row.lastMessageAt || last.createdAt >= row.lastMessageAt)) {
      row = tx.update(conversations).set({
        lastMessageAt: last.createdAt,
        lastMessagePreview: last.body.slice(0, 140),
        unreadCount: row.unreadCount + unread,
        // Khách nhắn mới vào hội thoại đã xong → mở lại
        ...unread && row.status === "resolved" ? { status: "open" } : {},
        customerName: conv.customerName || row.customerName,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(drizzleOrm.eq(conversations.id, row.id)).returning().get();
    } else if (unread) {
      row = tx.update(conversations).set({ unreadCount: row.unreadCount + unread, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(conversations.id, row.id)).returning().get();
    }
    return firstSync ? [] : added.map((a) => ({ ...a, conversation: row }));
  });
}
const attachmentsOf = (m) => (m.attachments?.data ?? []).map((a) => a.image_data?.url ?? a.file_url ?? "").filter((u) => u.startsWith("https://"));
const bodyOf = (text, attachments) => text?.trim() || (attachments.length ? "[Tệp đính kèm]" : "[Tin nhắn không có nội dung]");
async function syncDirect(ch, cred, platform2, selfId, firstSync, signal) {
  const res = await graph("GET", `${cred.pageId}/conversations`, {
    token: cred.token,
    signal,
    query: { platform: platform2, fields: "id,updated_time,participants,messages.limit(20){id,message,created_time,from,attachments}", limit: 25 }
  });
  const out = [];
  for (const c of res.data ?? []) {
    const customer = c.participants?.data?.find((p) => p.id !== selfId && p.id !== cred.pageId);
    const items = (c.messages?.data ?? []).map((m) => {
      const att = attachmentsOf(m);
      return {
        externalId: m.id,
        body: bodyOf(m.message, att),
        createdAt: new Date(m.created_time),
        inbound: !!m.from && m.from.id !== selfId && m.from.id !== cred.pageId,
        attachments: att
      };
    });
    out.push(
      ...upsertThread(
        ch,
        {
          externalId: c.id,
          source: platform2 === "messenger" ? "messenger" : "direct",
          customerName: customer?.name ?? (customer?.username ? `@${customer.username}` : "Khách hàng"),
          customerExternalId: customer?.id ?? null
        },
        items,
        firstSync
      )
    );
  }
  return out;
}
function commentThreads(ch, posts, isSelf, firstSync) {
  const out = [];
  for (const post of posts) {
    const title = (post.message ?? post.caption ?? "").trim().slice(0, 120) || "Bài viết";
    for (const top of post.comments?.data ?? []) {
      if (isSelf(top)) continue;
      const toItem = (c) => ({
        externalId: c.id,
        body: bodyOf(c.message ?? c.text, []),
        createdAt: new Date(c.created_time ?? c.timestamp ?? Date.now()),
        inbound: !isSelf(c),
        attachments: []
      });
      const thread = [top, ...top.comments?.data ?? [], ...top.replies?.data ?? []].map(toItem);
      const name = top.from?.name ?? (top.from?.username ? `@${top.from.username}` : top.username ? `@${top.username}` : "Người dùng Facebook");
      out.push(
        ...upsertThread(
          ch,
          { externalId: top.id, source: "comment", customerName: name, customerExternalId: top.from?.id ?? null, contextPostId: post.id, contextPostTitle: title },
          thread,
          firstSync
        )
      );
    }
  }
  return out;
}
async function syncFbComments(ch, cred, firstSync, signal) {
  const res = await graph("GET", `${cred.pageId}/feed`, {
    token: cred.token,
    signal,
    query: {
      fields: "id,message,comments.limit(25).filter(toplevel).order(reverse_chronological){id,message,created_time,from{id,name},comments.limit(25){id,message,created_time,from{id,name}}}",
      limit: 10
    }
  });
  return commentThreads(ch, res.data ?? [], (c) => c.from?.id === cred.pageId, firstSync);
}
async function syncIgComments(ch, cred, firstSync, signal) {
  const res = await graph("GET", `${cred.igUserId}/media`, {
    token: cred.token,
    signal,
    query: { fields: "id,caption,comments.limit(25){id,text,timestamp,username,from{id,username},replies.limit(25){id,text,timestamp,username,from{id,username}}}", limit: 10 }
  });
  const handle2 = (ch.handle ?? "").replace(/^@/, "").toLowerCase();
  return commentThreads(ch, res.data ?? [], (c) => c.from?.id === cred.igUserId || !!handle2 && (c.username ?? c.from?.username ?? "").toLowerCase() === handle2, firstSync);
}
async function syncYoutubeComments(ch, cred, firstSync, signal) {
  const fresh = await freshYoutubeCred(ch.id, cred, signal);
  const own = fresh.channelId ?? ch.externalId ?? "";
  const threads = await youtubeCommentThreads(own, fresh.token, signal);
  const out = [];
  for (const t2 of threads) {
    if (t2.top.authorChannelId === own) continue;
    const toItem = (c) => ({
      externalId: c.id,
      body: c.text.trim() || "[Bình luận trống]",
      createdAt: new Date(c.publishedAt),
      inbound: c.authorChannelId !== own,
      attachments: []
    });
    out.push(
      ...upsertThread(
        ch,
        {
          externalId: t2.id,
          source: "comment",
          customerName: t2.top.author,
          customerExternalId: t2.top.authorChannelId,
          contextPostId: t2.videoId,
          contextPostTitle: t2.videoTitle ?? (t2.videoId ? `Video ${t2.videoId}` : "Video YouTube")
        },
        [t2.top, ...t2.replies].map(toItem),
        firstSync
      )
    );
  }
  return out;
}
async function syncChannel(ch, signal, scope = "all") {
  const cred = readCred(ch.id);
  if (!cred) return { added: [], errors: [], rateLimited: false };
  const firstSync = syncState(ch.id) == null;
  const withComments = scope === "all" || firstSync;
  const added = [];
  const errors = [];
  let attempted = 0;
  let rateLimited = false;
  const run2 = async (label, fn) => {
    attempted++;
    try {
      added.push(...await fn());
    } catch (err) {
      if (signal.aborted) throw err;
      if (err instanceof PublishError && err.kind === "rate_limit") rateLimited = true;
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  if (ch.platform === "facebook" && cred.pageId) {
    await run2("Messenger", () => syncDirect(ch, cred, "messenger", cred.pageId, firstSync, signal));
    if (withComments) await run2("Bình luận", () => syncFbComments(ch, cred, firstSync, signal));
  } else if (ch.platform === "youtube") {
    if (!withComments) return { added: [], errors: [], rateLimited: false };
    await run2("Bình luận YouTube", () => syncYoutubeComments(ch, cred, firstSync, signal));
  } else if (ch.platform === "instagram" && cred.pageId && cred.igUserId) {
    await run2("Instagram Direct", () => syncDirect(ch, cred, "instagram", cred.igUserId, firstSync, signal));
    if (withComments) await run2("Bình luận IG", () => syncIgComments(ch, cred, firstSync, signal));
  } else return { added: [], errors: [], rateLimited: false };
  const allFailed = errors.length === attempted;
  if (!(firstSync && allFailed)) saveState(ch.id, { at: Date.now(), ok: !errors.length, ...errors.length ? { error: errors.join(" · ").slice(0, 400) } : {} });
  return { added, errors, rateLimited };
}
const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  pdf: "application/pdf"
};
const mimeOf = (f) => MIME[f.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
const OUTBOX_MS = 5e3;
const TICK_MS = 5e3;
const MESSAGES_ACTIVE_MS = 15e3;
const MESSAGES_IDLE_MS = 6e4;
const FULL_EVERY_MS = 2 * 6e4;
const BACKOFF_MS = 15 * 6e4;
const RETRY_MIN = [1, 5];
let outboxTimer = null;
let syncTimer = null;
let lastAnySync = 0;
let lastFullSync = 0;
let backoffUntil = 0;
let onChange = null;
let isActive = () => true;
function bindInboxEvents(opts) {
  onChange = opts.onChange;
  isActive = opts.isActive;
}
let sending = false;
let syncing = null;
let lastSync = null;
let version = 0;
let ctl = new AbortController();
function autoSyncEnabled() {
  return getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "inbox.autoSync")).get()?.value !== false;
}
function setAutoSync(enabled) {
  getDb().insert(settings).values({ key: "inbox.autoSync", value: enabled }).onConflictDoUpdate({ target: settings.key, set: { value: enabled, updatedAt: /* @__PURE__ */ new Date() } }).run();
}
function inboxWorkerStatus() {
  const pending2 = getDb().select({ id: messages.id }).from(messages).where(drizzleOrm.eq(messages.deliveryStatus, "pending")).all().length;
  return { autoSync: autoSyncEnabled(), syncing: syncing != null, lastSync, pending: pending2, drafts: draftCount(), version };
}
function startInbox() {
  setAiKick(() => {
    version++;
    kickOutbox();
  });
  ctl = new AbortController();
  lastSync = null;
  sending = false;
  outboxTimer = setInterval(() => void flushOutbox(), OUTBOX_MS);
  lastAnySync = lastFullSync = backoffUntil = 0;
  const startedAt = Date.now();
  syncTimer = setInterval(() => {
    if (syncing || Date.now() - startedAt < 8e3 || !autoSyncEnabled()) return;
    const now2 = Date.now();
    const backoff = now2 < backoffUntil;
    const every = backoff ? FULL_EVERY_MS : isActive() ? MESSAGES_ACTIVE_MS : MESSAGES_IDLE_MS;
    if (now2 - lastAnySync < every) return;
    const full = now2 - lastFullSync >= FULL_EVERY_MS;
    void syncAll(void 0, full ? "all" : "messages").catch(() => void 0);
  }, TICK_MS);
}
function stopInbox() {
  if (outboxTimer) clearInterval(outboxTimer);
  if (syncTimer) clearInterval(syncTimer);
  outboxTimer = syncTimer = null;
  ctl.abort();
  lastSync = null;
  clearAiQueue();
  setAiKick(null);
}
function kickOutbox() {
  setTimeout(() => void flushOutbox(), 50);
}
function syncAll(channelId, scope = "all") {
  if (syncing) return syncing;
  syncing = (async () => {
    const started2 = Date.now();
    lastAnySync = started2;
    if (scope === "all") lastFullSync = started2;
    const changedChannels = [];
    let rateLimited = false;
    const db2 = getDb();
    const list2 = db2.select().from(channels).where(drizzleOrm.and(drizzleOrm.ne(channels.tokenStatus, "missing"), drizzleOrm.ne(channels.platform, "tiktok"), channelId ? drizzleOrm.eq(channels.id, channelId) : void 0)).all();
    const result = { at: /* @__PURE__ */ new Date(), channels: 0, newMessages: 0, autoActions: 0, errors: [], durationMs: 0 };
    for (const ch of list2) {
      if (ctl.signal.aborted) break;
      try {
        const { added, errors, rateLimited: limited } = await syncChannel(ch, AbortSignal.any([ctl.signal, AbortSignal.timeout(6e4)]), scope);
        result.channels++;
        result.newMessages += added.length;
        if (added.length) changedChannels.push(ch.name);
        if (limited) rateLimited = true;
        result.autoActions += applyRules(added);
        const cfg = aiSettings();
        result.autoActions += quickEngagement(added, cfg);
        enqueueAi(added, cfg);
        for (const e of errors) result.errors.push(`${ch.name} – ${e}`);
        if (errors.some((e) => /mã 190/.test(e))) markChannel(ch.id, { tokenStatus: "expired", health: "error" });
      } catch (err) {
        result.errors.push(`${ch.name} – ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    result.durationMs = Date.now() - started2;
    if (result.channels && (scope === "all" || result.newMessages || result.errors.length)) {
      console.info(
        `[inbox] đồng bộ ${scope === "all" ? "" : "tin nhắn "}${result.channels} kênh · ${result.newMessages} tin mới · ${result.autoActions} hành động tự động · ${result.errors.length} lỗi · ${result.durationMs}ms`
      );
    }
    for (const e of result.errors) console.warn("[inbox]", e);
    if (rateLimited && Date.now() >= backoffUntil) {
      backoffUntil = Date.now() + BACKOFF_MS;
      console.warn("[inbox] Facebook báo vượt giới hạn tần suất → giãn nhịp đồng bộ về 2 phút trong 15 phút");
    }
    if (result.newMessages) onChange?.({ newMessages: result.newMessages, channels: changedChannels });
    lastSync = result;
    version++;
    if (result.autoActions) kickOutbox();
    return result;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}
function explain(err) {
  const m = err.message;
  if (/2018278|2534022|outside of allowed window|10\/2018/.test(m))
    return new PublishError("permanent", "Ngoài cửa sổ 24 giờ – Meta chỉ cho nhắn trong 24 giờ kể từ tin cuối của khách");
  if (/1446036|already been replied|private repl/i.test(m))
    return new PublishError("permanent", "Bình luận này đã được nhắn riêng hoặc quá 7 ngày – không gửi private reply được nữa");
  if (/mã 10\b|mã 200|permission/i.test(m))
    return new PublishError(
      "permanent",
      `Token thiếu quyền nhắn tin/quản lý bình luận (pages_messaging, pages_manage_engagement, instagram_manage_messages, instagram_manage_comments) – ${m}`
    );
  return err;
}
async function deliver(msg, conv, ch) {
  if (ch.platform === "youtube") {
    if (msg.action === "like") throw new PublishError("permanent", "YouTube API không hỗ trợ thích bình luận");
    const yc = readCred(ch.id);
    if (!yc) throw new PublishError("auth", "Kênh YouTube chưa kết nối");
    const fresh = await freshYoutubeCred(ch.id, yc, AbortSignal.any([ctl.signal, AbortSignal.timeout(45e3)]));
    const signal2 = AbortSignal.any([ctl.signal, AbortSignal.timeout(45e3)]);
    const target = msg.targetId ?? conv.externalId;
    if (!target) throw new PublishError("permanent", "Không có bình luận để trả lời");
    if (msg.action === "hide") {
      await youtubeHoldComment(target, fresh.token, signal2);
      return null;
    }
    if (msg.attachments.length) throw new PublishError("permanent", "Bình luận YouTube không đính kèm được tệp");
    return youtubeReply(conv.externalId ?? target, msg.body, fresh.token, signal2);
  }
  if (ch.platform === "tiktok") throw new PublishError("permanent", "TikTok không có API nhắn tin / trả lời bình luận công khai – hãy trả lời trong ứng dụng TikTok");
  if (!conv.externalId) throw new PublishError("permanent", "Hội thoại không liên kết với nền tảng (dữ liệu mẫu hoặc tạo tay) – không gửi được");
  const cred = readCred(ch.id);
  if (!cred?.pageId) throw new PublishError("auth", "Kênh chưa kết nối API – nhập token trong Tài khoản & Kênh");
  const token2 = cred.token;
  const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(45e3)]);
  const ig = ch.platform === "instagram";
  if (msg.action === "like") {
    if (ig || !msg.targetId) throw new PublishError("permanent", "Chỉ Facebook cho phép Page thích bình luận qua API");
    await graph("POST", `${msg.targetId}/likes`, { token: token2, signal });
    return null;
  }
  if (msg.action === "hide") {
    if (!msg.targetId) throw new PublishError("permanent", "Thiếu bình luận cần ẩn");
    await graph("POST", msg.targetId, { token: token2, signal, form: ig ? { hide: true } : { is_hidden: true } });
    return null;
  }
  const local = msg.attachments.filter((a) => !/^https?:/.test(a));
  for (const a of local) if (!node_fs.existsSync(node_path.join(mediaDir(), a))) throw new PublishError("permanent", "Không tìm thấy tệp đính kèm trên máy – chọn lại tệp");
  if (local.length && ig) throw new PublishError("permanent", "Instagram API chỉ gửi được tệp qua đường dẫn công khai – hãy gửi ảnh/tệp trong ứng dụng Instagram");
  if (local.length && conv.source === "comment") {
    if (local.length > 1 || attachmentKind(local[0]) !== "image") throw new PublishError("permanent", "Trả lời bình luận Facebook chỉ đính kèm được 1 ảnh");
    const target = msg.targetId ?? conv.externalId;
    const fd = await fileForm(msg.body.trim() ? { message: msg.body } : {}, "source", node_path.join(mediaDir(), local[0]), mimeOf(local[0]));
    const r2 = await graph("POST", `${target}/comments`, { token: token2, signal, multipart: fd, timeoutMs: 12e4 });
    return r2.id ?? null;
  }
  if (local.length) {
    if (!conv.customerExternalId) throw new PublishError("permanent", "Không có ID người nhận của khách trong hội thoại");
    let lastId = null;
    for (const a of local) {
      const fd = await fileForm(
        {
          recipient: JSON.stringify({ id: conv.customerExternalId }),
          messaging_type: "RESPONSE",
          message: JSON.stringify({ attachment: { type: attachmentKind(a), payload: { is_reusable: false } } })
        },
        "filedata",
        node_path.join(mediaDir(), a),
        mimeOf(a)
      );
      const r2 = await graph("POST", `${cred.pageId}/messages`, { token: token2, signal, multipart: fd, timeoutMs: 12e4 });
      lastId = r2.message_id ?? lastId;
    }
    if (!msg.body.trim()) return lastId;
  }
  if (conv.source === "comment") {
    const privateReply = msg.author === "bot" && !!msg.targetId && !!msg.ruleId && ruleAction(msg.ruleId) === "send_dm";
    if (privateReply) {
      const r3 = await graph("POST", `${cred.pageId}/messages`, {
        token: token2,
        signal,
        form: { recipient: JSON.stringify({ comment_id: msg.targetId }), message: JSON.stringify({ text: msg.body }) }
      });
      return r3.message_id ?? null;
    }
    const target = msg.targetId ?? conv.externalId;
    const r2 = await graph("POST", ig ? `${target}/replies` : `${target}/comments`, { token: token2, signal, form: { message: msg.body } });
    return r2.id ?? null;
  }
  if (!conv.customerExternalId) throw new PublishError("permanent", "Không có ID người nhận của khách trong hội thoại");
  const r = await graph("POST", `${cred.pageId}/messages`, {
    token: token2,
    signal,
    form: { recipient: JSON.stringify({ id: conv.customerExternalId }), messaging_type: "RESPONSE", message: JSON.stringify({ text: msg.body }) }
  });
  return r.message_id ?? null;
}
function ruleAction(ruleId) {
  return getDb().select({ action: autoReplyRules.action }).from(autoReplyRules).where(drizzleOrm.eq(autoReplyRules.id, ruleId)).get()?.action ?? "";
}
async function flushOutbox() {
  if (sending) return;
  sending = true;
  try {
    const db2 = getDb();
    for (; ; ) {
      const now2 = /* @__PURE__ */ new Date();
      const msg = db2.select().from(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.deliveryStatus, "pending"), drizzleOrm.eq(messages.direction, "out"), drizzleOrm.or(drizzleOrm.isNull(messages.sendAfter), drizzleOrm.lte(messages.sendAfter, now2)))).orderBy(drizzleOrm.asc(messages.createdAt)).get();
      if (!msg) break;
      const conv = db2.select().from(conversations).where(drizzleOrm.eq(conversations.id, msg.conversationId)).get();
      const ch = conv ? db2.select().from(channels).where(drizzleOrm.eq(channels.id, conv.channelId)).get() : void 0;
      const attempts = msg.attempts + 1;
      try {
        if (!conv || !ch) throw new PublishError("permanent", "Hội thoại hoặc kênh đã bị xóa");
        const externalId = await deliver(msg, conv, ch);
        db2.update(messages).set({ deliveryStatus: "sent", externalId: externalId ?? msg.externalId, attempts, error: null, sendAfter: null }).where(drizzleOrm.eq(messages.id, msg.id)).run();
        console.info(`[inbox] đã gửi ${msg.action === "hide" ? "lệnh ẩn bình luận" : msg.author === "bot" ? "trả lời tự động" : "tin nhắn"} (${ch.name})`);
      } catch (err) {
        if (ctl.signal.aborted) break;
        const e = explain(err instanceof PublishError ? err : new PublishError("transient", err instanceof Error ? err.message : String(err)));
        const retry = (e.kind === "transient" || e.kind === "rate_limit") && attempts <= RETRY_MIN.length;
        db2.update(messages).set(
          retry ? { attempts, error: `${e.message} – đang thử lại`, sendAfter: new Date(Date.now() + RETRY_MIN[attempts - 1] * 6e4) } : { deliveryStatus: "failed", attempts, error: e.message, sendAfter: null }
        ).where(drizzleOrm.eq(messages.id, msg.id)).run();
        console.warn(`[inbox] gửi lỗi (${ch?.name ?? "?"}, ${e.kind}): ${e.message}${retry ? " → thử lại" : ""}`);
        if (!retry && ch && /mã 190/.test(e.message)) {
          markChannel(ch.id, { tokenStatus: "expired", health: "error" });
          db2.insert(alerts).values({
            id: newId(),
            severity: "error",
            kind: "token_invalid",
            entityType: "channel",
            entityId: ch.id,
            title: `Token kênh ${ch.name} không dùng được`,
            message: e.message.slice(0, 300)
          }).run();
        }
        if (!retry && msg.author === "bot")
          db2.insert(activityLog).values({ level: "warn", scope: "inbox", message: `Bot không gửi được (${ch?.name ?? "?"}): ${e.message.slice(0, 100)}` }).run();
      }
      version++;
    }
  } catch (err) {
    console.error("[inbox] outbox lỗi", err);
  } finally {
    sending = false;
  }
}
function resend(messageId) {
  const res = getDb().update(messages).set({ deliveryStatus: "pending", error: null, sendAfter: null, attempts: 0 }).where(drizzleOrm.and(drizzleOrm.eq(messages.id, messageId), drizzleOrm.eq(messages.deliveryStatus, "failed"))).run();
  if (res.changes) kickOutbox();
  return res.changes > 0;
}
const total = (x) => x?.summary?.total_count ?? 0;
async function lifetime(path, token2, candidates, signal) {
  for (const metric of candidates) {
    try {
      const r = await graph("GET", path, { token: token2, signal, query: { metric } });
      const v = r.data?.[0]?.values?.[0]?.value;
      if (typeof v === "number") return v;
    } catch (err) {
      if (err instanceof PublishError && (err.kind === "auth" || err.kind === "rate_limit")) throw err;
    }
  }
  return null;
}
async function facebookPost(id2, token2, signal) {
  try {
    const p = await graph("GET", id2, {
      token: token2,
      signal,
      query: { fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares" }
    });
    const reach = await lifetime(`${id2}/insights`, token2, ["post_impressions_unique", "post_media_view", "post_impressions"], signal);
    return { reach, views: null, engagements: total(p.reactions) + total(p.comments) + (p.shares?.count ?? 0) };
  } catch (err) {
    if (err instanceof PublishError && (err.kind === "auth" || err.kind === "rate_limit")) throw err;
  }
  const v = await graph("GET", id2, {
    token: token2,
    signal,
    query: { fields: "likes.summary(total_count).limit(0),comments.summary(total_count).limit(0)" }
  });
  const views = await lifetime(`${id2}/video_insights`, token2, ["total_video_views", "blue_reels_play_count", "post_video_views"], signal);
  const avgMs = await lifetime(`${id2}/video_insights`, token2, ["total_video_avg_time_watched", "post_video_avg_time_watched"], signal);
  return { reach: null, views, engagements: total(v.likes) + total(v.comments), avgWatchSec: avgMs != null ? avgMs / 1e3 : null };
}
async function instagramMedia(id2, token2, signal) {
  const m = await graph("GET", id2, { token: token2, signal, query: { fields: "like_count,comments_count" } });
  const reach = await lifetime(`${id2}/insights`, token2, ["reach"], signal);
  const views = await lifetime(`${id2}/insights`, token2, ["views", "plays", "video_views"], signal);
  const avgMs = await lifetime(`${id2}/insights`, token2, ["ig_reels_avg_watch_time"], signal);
  return { reach, views, engagements: (m.like_count ?? 0) + (m.comments_count ?? 0), avgWatchSec: avgMs != null ? avgMs / 1e3 : null };
}
async function tiktokVideos(ids, cred, signal) {
  const out = /* @__PURE__ */ new Map();
  const r = await tiktok("/v2/video/query/", {
    token: cred.token,
    signal,
    query: { fields: "id,view_count,like_count,comment_count,share_count" },
    json: { filters: { video_ids: ids.slice(0, 20) } }
  });
  for (const v of r.videos ?? [])
    out.set(String(v.id), { reach: null, views: v.view_count ?? null, engagements: (v.like_count ?? 0) + (v.comment_count ?? 0) + (v.share_count ?? 0) });
  return out;
}
async function fetchChannelPostMetrics(channelId, platform2, list2, signal) {
  const out = /* @__PURE__ */ new Map();
  const posts = list2.filter((p) => !!p.externalId);
  let cred = readCred(channelId);
  if (!cred || !posts.length) return out;
  if (platform2 === "youtube") {
    cred = await freshYoutubeCred(channelId, cred, signal);
    const m = await youtubeVideoStats(
      posts.map((p) => p.externalId),
      cred.token,
      signal
    );
    for (const p of posts) if (m.has(p.externalId)) out.set(p.id, { reach: null, ...m.get(p.externalId) });
    return out;
  }
  if (platform2 === "tiktok") {
    cred = await freshTikTokCred(channelId, cred, signal);
    try {
      const m = await tiktokVideos(
        posts.map((p) => p.externalId),
        cred,
        signal
      );
      for (const p of posts) if (m.has(p.externalId)) out.set(p.id, m.get(p.externalId));
    } catch {
    }
    return out;
  }
  for (const p of posts) {
    try {
      out.set(p.id, platform2 === "instagram" ? await instagramMedia(p.externalId, cred.token, signal) : await facebookPost(p.externalId, cred.token, signal));
    } catch (err) {
      if (err instanceof PublishError && (err.kind === "auth" || err.kind === "rate_limit")) throw err;
    }
  }
  return out;
}
async function syncPostMetrics() {
  const db2 = getDb();
  const since = new Date(Date.now() - 30 * 864e5);
  const rows = db2.select({ id: scheduledPosts.id, externalId: scheduledPosts.externalPostId, channelId: scheduledPosts.channelId, platform: channels.platform, channelName: channels.name }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.status, "published"), drizzleOrm.isNotNull(scheduledPosts.externalPostId), drizzleOrm.gte(scheduledPosts.publishedAt, since))).all();
  const byChannel = /* @__PURE__ */ new Map();
  for (const r of rows) byChannel.set(r.channelId, [...byChannel.get(r.channelId) ?? [], r]);
  let posts = 0;
  const errors = [];
  for (const [channelId, list2] of byChannel) {
    try {
      const m = await fetchChannelPostMetrics(channelId, list2[0].platform, list2, AbortSignal.timeout(9e4));
      for (const [postId, v] of m) {
        db2.update(scheduledPosts).set({ reach: v.reach, views: v.views, engagements: v.engagements, avgWatchSec: v.avgWatchSec ?? null, metricsAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(scheduledPosts.id, postId)).run();
        posts++;
      }
    } catch (err) {
      errors.push(`${list2[0].channelName} (số liệu bài): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { posts, errors };
}
const DAY$5 = 864e5;
const DAYS = 60;
const EVERY_MS$1 = 6 * 36e5;
const isoDay$3 = (ms) => new Date(ms).toISOString().slice(0, 10);
async function dailyMetric(objectId, token2, candidates, signal, extra = {}) {
  const until = Math.floor(Date.now() / 1e3);
  const since = until - DAYS * 86400;
  for (const metric of candidates) {
    try {
      const r = await graph("GET", `${objectId}/insights`, { token: token2, signal, query: { metric, period: "day", since, until, ...extra } });
      const values = /* @__PURE__ */ new Map();
      for (const v of r.data?.[0]?.values ?? []) {
        const day = isoDay$3(new Date(v.end_time).getTime() - DAY$5 / 2);
        const n = typeof v.value === "number" ? v.value : Object.values(v.value ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
        values.set(day, (values.get(day) ?? 0) + n);
      }
      return { metric, values };
    } catch (err) {
      if (err instanceof PublishError && (err.kind === "auth" || err.kind === "rate_limit")) throw err;
    }
  }
  return null;
}
function merge(target, key2, values) {
  for (const [day, n] of values ?? []) target.set(day, { ...target.get(day), [key2]: n });
}
async function facebookDaily(token2, pageId, signal) {
  const daily = /* @__PURE__ */ new Map();
  const notes = [];
  const views = await dailyMetric(pageId, token2, ["page_media_view", "page_views_total", "page_impressions_unique", "page_impressions"], signal);
  const eng = await dailyMetric(pageId, token2, ["page_post_engagements", "page_total_actions", "page_engaged_users"], signal);
  merge(daily, "views", views?.values);
  merge(daily, "engagements", eng?.values);
  const watch = await dailyMetric(pageId, token2, ["page_video_view_time"], signal);
  if (watch) merge(daily, "watchMinutes", new Map([...watch.values].map(([d, ms]) => [d, ms / 6e4])));
  if (!views) notes.push("không lấy được lượt xem (thiếu quyền read_insights hoặc Page chưa đủ dữ liệu)");
  if (!eng) notes.push("không lấy được tương tác");
  const page = await graph("GET", pageId, { token: token2, signal, query: { fields: "followers_count,fan_count" } });
  return { daily, followers: page.followers_count ?? page.fan_count ?? null, notes };
}
async function instagramDaily(token2, igUserId, signal) {
  const daily = /* @__PURE__ */ new Map();
  const notes = [];
  const reach = await dailyMetric(igUserId, token2, ["reach", "impressions"], signal);
  merge(daily, "views", reach?.values);
  if (!reach) notes.push("không lấy được reach (thiếu quyền instagram_manage_insights)");
  const media = await graph("GET", `${igUserId}/media`, {
    token: token2,
    signal,
    query: { fields: "timestamp,like_count,comments_count", limit: 100 }
  });
  const cutoff = Date.now() - DAYS * DAY$5;
  const eng = /* @__PURE__ */ new Map();
  for (const m of media.data ?? []) {
    const t2 = new Date(m.timestamp).getTime();
    if (t2 < cutoff) continue;
    const day = isoDay$3(t2);
    eng.set(day, (eng.get(day) ?? 0) + (m.like_count ?? 0) + (m.comments_count ?? 0));
  }
  merge(daily, "engagements", eng);
  const me = await graph("GET", igUserId, { token: token2, signal, query: { fields: "followers_count" } });
  return { daily, followers: me.followers_count ?? null, notes };
}
async function tiktokDaily(token2, signal) {
  try {
    const r = await tiktok("/v2/user/info/", { token: token2, signal, method: "GET", query: { fields: "follower_count" } });
    return { daily: /* @__PURE__ */ new Map(), followers: r.user?.follower_count ?? null, notes: [] };
  } catch (err) {
    if (err instanceof PublishError && err.kind === "auth") throw err;
    return { daily: /* @__PURE__ */ new Map(), followers: null, notes: ["TikTok: cần quyền user.info.stats để lấy số người theo dõi"] };
  }
}
function save$1(channelId, daily, followers) {
  const db2 = getDb();
  const today = isoDay$3(Date.now());
  if (followers != null) daily.set(today, { ...daily.get(today), followers });
  let rows = 0;
  db2.transaction((tx) => {
    for (const [day, v] of daily) {
      const set2 = {
        ...v.views != null ? { views: Math.round(v.views) } : {},
        ...v.engagements != null ? { engagements: Math.round(v.engagements) } : {},
        ...v.followers != null ? { followers: v.followers } : {},
        ...v.watchMinutes != null ? { watchMinutes: Math.round(v.watchMinutes) } : {}
      };
      if (!Object.keys(set2).length) continue;
      tx.insert(channelMetricsDaily).values({ channelId, day, views: set2.views ?? 0, engagements: set2.engagements ?? 0, followers: set2.followers ?? 0, watchMinutes: set2.watchMinutes ?? 0 }).onConflictDoUpdate({ target: [channelMetricsDaily.channelId, channelMetricsDaily.day], set: set2 }).run();
      rows++;
    }
    if (followers != null) tx.update(channels).set({ followers, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(channels.id, channelId)).run();
  });
  return rows;
}
let running$1 = null;
let timer$2 = null;
function lastInsightsSync() {
  return getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "insights.lastSync")).get()?.value ?? null;
}
function syncInsights() {
  if (running$1) return running$1;
  running$1 = (async () => {
    const db2 = getDb();
    const list2 = db2.select().from(channels).where(drizzleOrm.and(drizzleOrm.ne(channels.tokenStatus, "missing"), drizzleOrm.eq(channels.status, "active"))).all();
    const result = { at: Date.now(), channels: 0, days: 0, posts: 0, errors: [], notes: [] };
    for (const ch of list2) {
      const cred = readCred(ch.id);
      if (!cred) continue;
      const signal = AbortSignal.timeout(6e4);
      try {
        const r = ch.platform === "facebook" && cred.pageId ? await facebookDaily(cred.token, cred.pageId, signal) : ch.platform === "instagram" && cred.igUserId ? await instagramDaily(cred.token, cred.igUserId, signal) : ch.platform === "tiktok" ? await tiktokDaily((await freshTikTokCred(ch.id, cred, signal)).token, signal) : ch.platform === "youtube" ? await youtubeDaily((await freshYoutubeCred(ch.id, cred, signal)).token, signal) : null;
        if (!r) continue;
        result.days += save$1(ch.id, r.daily, r.followers);
        result.channels++;
        for (const n of r.notes) result.notes.push(`${ch.name}: ${n}`);
      } catch (err) {
        result.errors.push(`${ch.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const pm = await syncPostMetrics();
    result.posts = pm.posts;
    result.errors.push(...pm.errors);
    db2.insert(settings).values({ key: "insights.lastSync", value: result }).onConflictDoUpdate({ target: settings.key, set: { value: result, updatedAt: /* @__PURE__ */ new Date() } }).run();
    if (result.channels || result.errors.length)
      console.info(`[insights] ${result.channels} kênh · ${result.days} ngày số liệu · ${result.posts} bài · ${result.errors.length} lỗi`);
    for (const e of result.errors) console.warn("[insights]", e);
    return result;
  })().finally(() => {
    running$1 = null;
  });
  return running$1;
}
function startInsights() {
  stopInsights();
  setTimeout(() => {
    if (!timer$2) return;
    const last = lastInsightsSync();
    if (!last || Date.now() - last.at > EVERY_MS$1) void syncInsights().catch(() => void 0);
  }, 2e4);
  timer$2 = setInterval(() => void syncInsights().catch(() => void 0), EVERY_MS$1);
}
function stopInsights() {
  if (timer$2) clearInterval(timer$2);
  timer$2 = null;
}
const HOUR$1 = 36e5;
const CHECK_AFTER = 2 * HOUR$1;
const GIVE_UP_AFTER = 6 * HOUR$1;
const EVERY_MS = 15 * 6e4;
const MIN_HISTORY = 3;
const HISTORY = 10;
const LOW_RATIO = 0.25;
const MIN_BASELINE = 20;
const metricOf = (m) => m.views != null ? { value: m.views, label: "lượt xem" } : m.reach != null ? { value: m.reach, label: "lượt tiếp cận" } : m.engagements != null ? { value: m.engagements, label: "tương tác" } : null;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
function judge(value, history) {
  const baseline = history.length >= MIN_HISTORY ? median(history) : null;
  if (value === 0) return { flag: "zero", baseline };
  if (baseline != null && baseline >= MIN_BASELINE && value < baseline * LOW_RATIO) return { flag: "low", baseline };
  return { flag: "ok", baseline };
}
let running = false;
async function runEarlyCheck(now2 = Date.now()) {
  if (running) return [];
  running = true;
  try {
    const db2 = getDb();
    const due = db2.select({
      id: scheduledPosts.id,
      externalId: scheduledPosts.externalPostId,
      publishedAt: scheduledPosts.publishedAt,
      channelId: scheduledPosts.channelId,
      platform: channels.platform,
      channelName: channels.name,
      title: contentItems.title
    }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).innerJoin(contentItems, drizzleOrm.eq(contentItems.id, scheduledPosts.contentItemId)).where(
      drizzleOrm.and(
        drizzleOrm.eq(scheduledPosts.status, "published"),
        drizzleOrm.isNotNull(scheduledPosts.externalPostId),
        drizzleOrm.isNull(scheduledPosts.earlyCheckedAt),
        drizzleOrm.lte(scheduledPosts.publishedAt, new Date(now2 - CHECK_AFTER)),
        drizzleOrm.gte(scheduledPosts.publishedAt, new Date(now2 - 7 * 24 * HOUR$1))
      )
    ).all();
    if (!due.length) return [];
    const flagged = [];
    const byChannel = /* @__PURE__ */ new Map();
    for (const r of due) byChannel.set(r.channelId, [...byChannel.get(r.channelId) ?? [], r]);
    for (const [channelId, list2] of byChannel) {
      const stale = list2.filter((p) => now2 - p.publishedAt.getTime() > GIVE_UP_AFTER);
      const fresh = list2.filter((p) => now2 - p.publishedAt.getTime() <= GIVE_UP_AFTER);
      if (stale.length)
        db2.update(scheduledPosts).set({ earlyFlag: "unknown", earlyCheckedAt: new Date(now2) }).where(
          drizzleOrm.inArray(
            scheduledPosts.id,
            stale.map((p) => p.id)
          )
        ).run();
      if (!fresh.length) continue;
      let metrics;
      try {
        metrics = await fetchChannelPostMetrics(channelId, fresh[0].platform, fresh, AbortSignal.timeout(9e4));
      } catch (err) {
        console.warn(`[early] ${fresh[0].channelName}: không lấy được số liệu`, err instanceof Error ? err.message : err);
        continue;
      }
      const history = db2.select({ v: scheduledPosts.earlyMetric }).from(scheduledPosts).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.channelId, channelId), drizzleOrm.isNotNull(scheduledPosts.earlyMetric), drizzleOrm.inArray(scheduledPosts.earlyFlag, ["ok", "low", "zero"]))).orderBy(drizzleOrm.desc(scheduledPosts.publishedAt)).limit(HISTORY).all().map((r) => r.v);
      for (const p of fresh) {
        const m = metrics.get(p.id);
        const metric = m && metricOf(m);
        if (!m || !metric) continue;
        const { flag, baseline } = judge(metric.value, history);
        db2.update(scheduledPosts).set({
          reach: m.reach,
          views: m.views,
          engagements: m.engagements,
          avgWatchSec: m.avgWatchSec ?? null,
          metricsAt: new Date(now2),
          earlyMetric: metric.value,
          earlyBaseline: baseline,
          earlyFlag: flag,
          earlyCheckedAt: new Date(now2)
        }).where(drizzleOrm.eq(scheduledPosts.id, p.id)).run();
        if (flag === "ok") continue;
        const hours = Math.round((now2 - p.publishedAt.getTime()) / HOUR$1);
        db2.insert(alerts).values({
          id: newId(),
          severity: "warn",
          kind: "low_reach",
          entityType: "post",
          entityId: p.id,
          title: `Bài phân phối kém: ${p.title.slice(0, 80)}`,
          message: flag === "zero" ? `${p.channelName} · sau ${hours} giờ vẫn 0 ${metric.label}. Kiểm tra bài có bị giới hạn / chờ duyệt trên nền tảng, nhạc hoặc hình có vi phạm bản quyền không.` : `${p.channelName} · sau ${hours} giờ: ${metric.value} ${metric.label}, kênh thường đạt ~${baseline}. Thử đổi caption / thumbnail / 3 giây mở đầu, hoặc tránh đăng cùng nội dung trùng lặp ở nhiều kênh.`
        }).run();
        flagged.push({ postId: p.id, title: p.title, channelName: p.channelName, metric: metric.value, baseline, flag });
      }
    }
    return flagged;
  } finally {
    running = false;
  }
}
let timer$1 = null;
let onFlagged = null;
function bindEarlyCheckEvents(cb) {
  onFlagged = cb;
}
const tick = () => void runEarlyCheck().then((posts) => posts.length && onFlagged?.(posts)).catch((err) => console.warn("[early] lỗi kiểm tra bài sau đăng", err));
function startEarlyCheck() {
  stopEarlyCheck();
  timer$1 = setInterval(tick, EVERY_MS);
  setTimeout(() => timer$1 && tick(), 6e4);
}
function stopEarlyCheck() {
  if (timer$1) clearInterval(timer$1);
  timer$1 = null;
}
const MAX_REFS = 6;
const FAL_MODEL = "fal-ai/nano-banana";
async function generateFilmImage(opts) {
  const refs = opts.refs.slice(0, MAX_REFS);
  const fallbackReady = isReady(opts.engine === "fal" ? "fal" : "google_image");
  if (flowImagesReady()) {
    try {
      const file2 = await flowGenerateImage({
        prompt: opts.prompt,
        aspect: opts.aspect,
        refs: refs.slice(0, 3),
        destBase: opts.destBase,
        signal: opts.signal,
        attemptTimeoutMs: FLOW_IMAGE_TIMEOUT_MS
      });
      return { file: file2, model: FLOW_IMAGE_LABEL, costUsd: 0 };
    } catch (err) {
      if (opts.signal.aborted || !fallbackReady) throw err;
      console.warn("[film] Google Flow tạo ảnh lỗi → dùng", opts.engine, err instanceof Error ? err.message : err);
    }
  }
  assertBudget(opts.workspaceId);
  return opts.engine === "fal" ? falNanoBanana({ ...opts, refs }) : googleNanoBanana({ ...opts, refs });
}
const FLOW_IMAGE_LABEL = "Nano Banana (Google Flow)";
const FLOW_IMAGE_TIMEOUT_MS = 1e5;
async function googleNanoBanana(o) {
  const { key: key2, baseUrl, row } = requireKey("google_image");
  const model = row.defaultModel ?? "gemini-3.1-flash-image";
  const base = (baseUrl ?? GOOGLE_BASE).replace(/\/$/, "");
  const body = await requestJson(`${base}/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": key2, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ type: "text", text: o.prompt }, ...o.refs.map((f) => ({ type: "image", data: node_fs.readFileSync(f).toString("base64"), mime_type: refMime(f) }))],
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: o.aspect, image_size: "1K" }
    }),
    signal: o.signal
  });
  const img = findInlineData(body, "image");
  if (!img) throw new AiError("invalid_output", "Nano Banana không trả về ảnh (có thể bị bộ lọc an toàn chặn – thử sửa mô tả)");
  const file2 = `${o.destBase}${img.mime.includes("png") ? ".png" : ".jpg"}`;
  node_fs.writeFileSync(file2, Buffer.from(img.data, "base64"));
  const costUsd = unitCost(model, 1);
  recordUsage$1(row.id, o.workspaceId, model, "film.image", costUsd);
  return { file: file2, model, costUsd };
}
async function falNanoBanana(o) {
  const { key: key2, baseUrl, row } = requireKey("fal");
  const model = o.refs.length ? `${FAL_MODEL}/edit` : FAL_MODEL;
  const base = (baseUrl ?? "https://fal.run").replace(/\/$/, "");
  const res = await fetch(`${base}/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key2}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: o.prompt,
      num_images: 1,
      output_format: "jpeg",
      aspect_ratio: o.aspect,
      // fal nhận ảnh dạng data URI – không cần tải ảnh lên trước
      ...o.refs.length ? { image_urls: o.refs.map((f) => `data:${refMime(f)};base64,${node_fs.readFileSync(f).toString("base64")}`) } : {}
    }),
    signal: o.signal
  });
  if (!res.ok)
    throw await providerError("Fal.ai (Nano Banana)", res, {
      401: "key không hợp lệ",
      403: "tài khoản bị khóa hoặc hết số dư – kiểm tra tại fal.ai/dashboard/billing",
      422: "yêu cầu không hợp lệ (ảnh tham chiếu quá lớn hoặc mô tả bị chặn)",
      429: "vượt giới hạn, thử lại sau"
    });
  const out = await res.json();
  const url = out.images?.[0]?.url;
  if (!url) throw new AiError("invalid_output", "Fal.ai không trả về ảnh (có thể bị bộ lọc an toàn chặn – thử sửa mô tả)");
  const file2 = `${o.destBase}.jpg`;
  if (url.startsWith("data:")) node_fs.writeFileSync(file2, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  else await download$1(url, file2, o.signal);
  const costUsd = unitCost(model, 1);
  recordUsage$1(row.id, o.workspaceId, model, "film.image", costUsd);
  return { file: file2, model, costUsd };
}
function filmImageModel(engine2, withRefs) {
  if (flowImagesReady()) return FLOW_IMAGE_LABEL;
  if (engine2 === "fal") return withRefs ? `${FAL_MODEL}/edit` : FAL_MODEL;
  try {
    return requireKey("google_image").row.defaultModel ?? "gemini-3.1-flash-image";
  } catch {
    return "gemini-3.1-flash-image";
  }
}
const POLL_MS = 5e3;
const TIMEOUT_MS = 20 * 6e4;
const SIZE = { "480p": [854, 480], "720p": [1280, 720], "1080p": [1920, 1080] };
const RATE_PER_1K = { fast: 0.0112, standard: 0.014 };
const seedanceModel = (tier) => tier === "fast" ? "bytedance/seedance-2.0/fast/image-to-video" : "bytedance/seedance-2.0/image-to-video";
const seedanceResolution = (f) => f.videoTier === "fast" && f.videoResolution === "1080p" ? "720p" : f.videoResolution;
const seedanceSeconds = (sec) => Math.min(15, Math.max(4, Math.round(sec)));
function seedanceUsd(f, seconds) {
  const [w, h] = SIZE[seedanceResolution(f)];
  return w * h * seconds * 24 / 1024 * (RATE_PER_1K[f.videoTier] / 1e3);
}
function videoPlan(f, shotSec) {
  if (f.videoEngine === "seedance") {
    const seconds2 = seedanceSeconds(shotSec);
    return { model: seedanceModel(f.videoTier), seconds: seconds2, usd: seedanceUsd(f, seconds2) };
  }
  if (veoSource() === "flow") return { model: `${flowModel()} (Google Flow)`, seconds: flowClipSeconds(shotSec), usd: 0 };
  let model = "veo-3.1-lite-generate-preview";
  try {
    model = requireKey("google_veo").row.defaultModel ?? model;
  } catch {
  }
  const seconds = veoSeconds(shotSec, [], {});
  return { model, seconds, usd: unitCost(model, seconds) };
}
const dataUri = (f) => `data:${refMime(f)};base64,${node_fs.readFileSync(f).toString("base64")}`;
async function falJson(url, key2, signal, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal, headers: { Authorization: `Key ${key2}`, "Content-Type": "application/json", ...init.headers ?? {} } });
  } catch (err) {
    if (signal.aborted) throw new AiError("timeout", "Đã hủy hoặc hết thời gian chờ");
    throw new AiError("network", `Không kết nối được fal: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
  }
  if (!res.ok) {
    const b = body;
    const detail2 = typeof b?.detail === "string" ? b.detail : b?.detail ? JSON.stringify(b.detail).slice(0, 300) : typeof b?.error === "string" ? b.error : text.slice(0, 200);
    const e = errorFromStatus(res.status, detail2);
    if (res.status === 403) throw new AiError("auth", `${e.message} – tài khoản fal bị khóa hoặc hết số dư (fal.ai/dashboard/billing)`, 403);
    if (res.status === 422) throw new AiError("bad_request", `fal từ chối yêu cầu: ${detail2}`, 422);
    throw e;
  }
  return body;
}
async function seedanceClip(o) {
  const { key: key2, baseUrl, row } = requireKey("seedance");
  const model = seedanceModel(o.film.videoTier);
  const resolution = seedanceResolution(o.film);
  const base = (baseUrl ?? "https://queue.fal.run").replace(/\/$/, "");
  const sub = await falJson(`${base}/${model}`, key2, o.signal, {
    method: "POST",
    body: JSON.stringify({
      prompt: o.prompt,
      image_url: dataUri(o.start),
      ...o.end ? { end_image_url: dataUri(o.end) } : {},
      resolution,
      duration: String(o.seconds),
      aspect_ratio: o.film.aspect,
      generate_audio: o.film.videoAudio
    })
  });
  const statusUrl = sub.status_url ?? `${base}/${model}/requests/${sub.request_id}/status`;
  const responseUrl = sub.response_url ?? `${base}/${model}/requests/${sub.request_id}`;
  const cancel = () => {
    if (sub.cancel_url) void fetch(sub.cancel_url, { method: "PUT", headers: { Authorization: `Key ${key2}` } }).catch(() => void 0);
  };
  o.signal.addEventListener("abort", cancel, { once: true });
  const started2 = Date.now();
  try {
    for (; ; ) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (o.signal.aborted) throw new Error("Đã hủy");
      if (Date.now() - started2 > TIMEOUT_MS) throw new AiError("timeout", "Seedance chưa xong sau 20 phút");
      const st = await falJson(statusUrl, key2, o.signal);
      o.onStatus?.(st.status === "IN_QUEUE" ? `Đang xếp hàng ở fal${st.queue_position != null ? ` (vị trí ${st.queue_position})` : ""}` : "Seedance đang tạo video…");
      if (st.status === "COMPLETED") break;
    }
    const out = await falJson(responseUrl, key2, o.signal);
    const url = out.video?.url;
    if (!url) throw new AiError("refusal", "Seedance không trả video (có thể bị bộ lọc nội dung chặn – thử sửa hành động / khung hình)");
    if (url.startsWith("data:")) node_fs.writeFileSync(o.dest, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    else await download$1(url, o.dest, o.signal);
  } finally {
    o.signal.removeEventListener("abort", cancel);
  }
  const costUsd = seedanceUsd(o.film, o.seconds);
  recordUsage$1(row.id, o.film.workspaceId, model, "film.video", costUsd);
  return { model, costUsd };
}
async function generateFilmVideo(o) {
  assertBudget(o.film.workspaceId);
  const plan = videoPlan(o.film, o.shotSec);
  if (o.film.videoEngine === "seedance") return { ...await seedanceClip({ ...o, seconds: plan.seconds }), seconds: plan.seconds };
  if (veoSource() === "flow") {
    await flowGenerate({ prompt: o.prompt, aspect: o.film.aspect, seconds: o.shotSec, start: o.start, dest: o.dest, signal: o.signal, onStatus: (t2) => o.onStatus?.(t2) });
    return { model: plan.model, costUsd: 0, seconds: plan.seconds };
  }
  await veoClip(o.prompt, o.shotSec, o.film.workspaceId, o.signal, () => o.onStatus?.("Veo đang tạo video…"), o.film.aspect, [], { start: o.start, end: o.end ?? null }, o.dest);
  return { model: plan.model, costUsd: plan.usd, seconds: plan.seconds };
}
const FILM_GENRES = [
  { label: "Điện ảnh chính kịch", en: "cinematic drama feature film" },
  { label: "Hoạt hình 3D", en: "3D animated feature film" },
  { label: "Hoạt hình 2D / Anime", en: "2D animated anime film" },
  { label: "Kiếm hiệp", en: "wuxia martial arts epic, sword fighting, jianghu heroes" },
  { label: "Cổ trang", en: "historical period drama, ancient costumes and palaces" },
  { label: "Cổ trang tiên hiệp", en: "xianxia fantasy, celestial immortals, flowing hanfu robes, mystical floating mountains, spiritual energy" },
  { label: "Tâm lý hiện đại", en: "contemporary psychological drama, intimate emotional moments" },
  { label: "Tình cảm lãng mạn", en: "romantic drama, tender emotional atmosphere" },
  { label: "Hành động", en: "action thriller, dynamic stunts, high energy" },
  { label: "Giả tưởng", en: "high fantasy adventure, magical world" },
  { label: "Khoa học viễn tưởng", en: "science fiction, futuristic technology" },
  { label: "Trinh thám", en: "detective mystery thriller, suspenseful" },
  { label: "Kinh dị", en: "horror atmosphere, eerie and suspenseful (no gore)" },
  { label: "Hài", en: "lighthearted comedy, playful expressive acting" },
  { label: "Học đường", en: "school life youth drama" },
  { label: "Gia đình", en: "warm family drama" },
  { label: "Cổ tích Việt Nam", en: "Vietnamese folk fairy tale, traditional village setting" }
];
const FILM_STYLES = [
  { label: "Điện ảnh chân thực (35mm)", en: "photorealistic cinematic, 35mm film look, shallow depth of field, natural lighting, subtle film grain" },
  { label: "Hoạt hình 3D phim chiếu rạp", en: "stylized 3D animation, feature-film quality, expressive characters, soft global illumination, vibrant colors" },
  { label: "Anime 2D", en: "Japanese 2D anime style, cel shading, clean line art, vivid colors" },
  { label: "Hoạt hình vẽ tay màu nước", en: "hand-painted 2D animation, watercolor backgrounds, soft pastel palette, gentle lighting" },
  { label: "Cổ trang Trung Hoa điện ảnh", en: "Chinese historical epic cinematography, rich silk costumes, misty mountains, warm candlelight, grand palaces" },
  { label: "Tiên hiệp kỳ ảo", en: "ethereal xianxia fantasy art, glowing spiritual light, floating islands, flowing robes, soft volumetric mist" },
  { label: "Tranh thủy mặc", en: "ink wash painting style, sumi-e brush strokes, monochrome with subtle color accents" },
  { label: "Noir đen trắng", en: "black and white film noir, high contrast, hard shadows, moody" },
  { label: "Cyberpunk neon", en: "cyberpunk, neon-lit night city, rain reflections, teal and magenta palette" },
  { label: "Hoài cổ thập niên 90", en: "retro 1990s film look, warm color grade, film grain, soft vignette" },
  { label: "Phim tài liệu", en: "documentary realism, handheld camera, natural available light" },
  { label: "Đất sét / stop-motion", en: "claymation stop-motion look, handcrafted clay textures, miniature sets" }
];
const DIALOGUE_LANGUAGES = [
  { label: "Tiếng Việt", en: "Vietnamese" },
  { label: "English", en: "English" },
  { label: "Tiếng Trung (中文)", en: "Mandarin Chinese" },
  { label: "Tiếng Hàn (한국어)", en: "Korean" },
  { label: "Tiếng Nhật (日本語)", en: "Japanese" },
  { label: "Không thoại", en: null }
];
const DEFAULT_DIALOGUE_LANGUAGE = "Tiếng Việt";
function dialogueLanguageEn(label) {
  const v = (label ?? DEFAULT_DIALOGUE_LANGUAGE).trim();
  const p = DIALOGUE_LANGUAGES.find((x) => x.label === v);
  return p ? p.en : v || "Vietnamese";
}
const isVietnameseDialogue = (label) => dialogueLanguageEn(label) === "Vietnamese";
const canVietnameseSubtitle = (label) => !!dialogueLanguageEn(label) && !isVietnameseDialogue(label);
const norm$2 = (s) => (s ?? "").trim();
function styleKey(i) {
  return node_crypto.createHash("sha256").update([norm$2(i.genre), norm$2(i.visualStyle), norm$2(i.notes)].join("|")).digest("hex").slice(0, 16);
}
const hasStyleInput = (i) => !!(norm$2(i.genre) || norm$2(i.visualStyle) || norm$2(i.notes));
async function composeStyleEn(i, workspaceId) {
  const parts = [];
  const custom = [];
  const genre = FILM_GENRES.find((g) => g.label === norm$2(i.genre));
  const style = FILM_STYLES.find((s) => s.label === norm$2(i.visualStyle));
  if (norm$2(i.genre)) genre ? parts.push(genre.en) : custom.push(`Thể loại: ${norm$2(i.genre)}`);
  if (norm$2(i.visualStyle)) style ? parts.push(style.en) : custom.push(`Phong cách hình ảnh: ${norm$2(i.visualStyle)}`);
  if (norm$2(i.notes)) custom.push(`Ghi chú thêm: ${norm$2(i.notes)}`);
  if (custom.length) {
    try {
      parts.push(await filmStyleKeywords(custom.join("\n"), parts.join(", "), workspaceId));
    } catch (err) {
      if (!(err instanceof AiError) || err.kind !== "no_provider" && err.kind !== "quota") throw err;
      parts.push(...[norm$2(i.genre) && !genre ? norm$2(i.genre) : "", norm$2(i.visualStyle) && !style ? norm$2(i.visualStyle) : ""].filter(Boolean));
    }
  }
  return parts.filter(Boolean).join(", ");
}
async function ensureFilmStyle(filmId, force = false) {
  const db2 = getDb();
  const f = db2.select().from(filmProjects).where(drizzleOrm.eq(filmProjects.id, filmId)).get();
  if (!f) return "";
  const input = { genre: f.genre, visualStyle: f.visualStyle, notes: f.notes };
  if (!hasStyleInput(input)) return f.style;
  const key2 = styleKey(input);
  if (!force && (f.styleFor === key2 || f.styleFor === `manual:${key2}`)) return f.style;
  const style = await composeStyleEn(input, f.workspaceId);
  db2.update(filmProjects).set({ style, styleFor: key2, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(filmProjects.id, filmId)).run();
  return style;
}
const rel$2 = (abs) => abs.slice(mediaDir().length + 1).split("\\").join("/");
const voiceOf = (c) => ({
  voiceProfile: c.voiceProfile,
  voiceProvider: c.voiceProvider,
  voiceId: c.voiceProvider ? c.voiceId : null
});
const lookOf = (c) => (c.appearanceEn?.trim() || c.appearance).trim();
function createEpisodeFilm(episodeId) {
  const db2 = getDb();
  const ep = db2.select().from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.id, episodeId)).get();
  if (!ep) throw new Error("Không tìm thấy tập");
  if (ep.filmId && db2.select({ id: filmProjects.id }).from(filmProjects).where(drizzleOrm.eq(filmProjects.id, ep.filmId)).get()) return ep.filmId;
  const s = db2.select().from(series).where(drizzleOrm.eq(series.id, ep.seriesId)).get();
  const cast = db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, s.id)).orderBy(drizzleOrm.asc(seriesCharacters.sortOrder), drizzleOrm.asc(seriesCharacters.createdAt)).all();
  const filmId = newId();
  node_fs.mkdirSync(filmDir(filmId), { recursive: true });
  const idea = [
    `Tập ${ep.number} của series "${s.title}": ${ep.title}.`,
    ep.synopsis,
    ep.cliffhanger ? `Kết tập (treo sang tập sau): ${ep.cliffhanger}` : ""
  ].filter(Boolean).join("\n");
  db2.transaction((tx) => {
    tx.insert(filmProjects).values({
      id: filmId,
      workspaceId: s.workspaceId,
      title: `${s.title} – Tập ${ep.number}: ${ep.title}`.slice(0, 160),
      idea,
      logline: ep.synopsis.slice(0, 600) || null,
      style: s.visualStyleEn?.trim() || "",
      genre: s.genre,
      visualStyle: s.visualStyle,
      dialogueLanguage: s.dialogueLanguage,
      notes: s.notes,
      // Cùng dấu với series → phim không tự tối ưu lại (giữ đúng bộ từ khóa chung của series)
      styleFor: s.visualStyleEn ? styleKey({ genre: s.genre, visualStyle: s.visualStyle, notes: s.notes }) : null,
      aspect: isLongForm(s.episodeLengthSec) ? "16:9" : "9:16",
      targetSec: Math.min(900, Math.max(15, s.episodeLengthSec)),
      videoEngine: isReady("seedance") ? "seedance" : "veo",
      imageEngine: isReady("google_image") ? "google" : "fal",
      seriesId: s.id,
      episodeId: ep.id
    }).run();
    cast.forEach((c, i) => {
      const assetId = newId();
      tx.insert(filmAssets).values({ id: assetId, filmId, kind: "character", position: i, name: c.name, summary: c.role ?? "", description: lookOf(c), descriptionSrc: (c.role ?? "").trim(), seriesCharacterId: c.id, ...voiceOf(c) }).run();
      adoptSeriesImage(tx, filmId, assetId, c);
    });
    tx.update(filmProjects).set({ castKnown: cast.map((c) => c.id) }).where(drizzleOrm.eq(filmProjects.id, filmId)).run();
    tx.update(seriesEpisodes).set({ filmId, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(seriesEpisodes.id, ep.id)).run();
  });
  return filmId;
}
function adoptSeriesImage(tx, filmId, assetId, c, select = true) {
  const src = c.referenceImage ? node_path.join(mediaDir(), c.referenceImage) : null;
  if (!src || !node_fs.existsSync(src)) return false;
  const takeId = newId();
  const dir = filmDir(filmId);
  node_fs.mkdirSync(dir, { recursive: true });
  const dest = node_path.join(dir, `${takeId}${node_path.extname(src).toLowerCase() || ".jpg"}`);
  node_fs.copyFileSync(src, dest);
  tx.insert(filmTakes).values({ id: takeId, filmId, assetId, kind: "image", status: "done", file: rel$2(dest), prompt: "(ảnh chuẩn của series)", model: "series", refs: [c.referenceImage], costUsd: 0, finishedAt: /* @__PURE__ */ new Date() }).run();
  if (select) tx.update(filmAssets).set({ selectedTakeId: takeId, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(filmAssets.id, assetId)).run();
  return true;
}
const fileSize = (p) => {
  try {
    return node_fs.statSync(p).size;
  } catch {
    return -1;
  }
};
function syncSeriesCast(filmId) {
  const db2 = getDb();
  const film = db2.select().from(filmProjects).where(drizzleOrm.eq(filmProjects.id, filmId)).get();
  if (!film?.seriesId) return 0;
  const cast = db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, film.seriesId)).orderBy(drizzleOrm.asc(seriesCharacters.sortOrder), drizzleOrm.asc(seriesCharacters.createdAt)).all();
  if (!cast.length) return 0;
  const chars = db2.select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.filmId, filmId), drizzleOrm.eq(filmAssets.kind, "character"))).all();
  const busyOrDone = new Set(
    db2.select({ assetId: filmTakes.assetId }).from(filmTakes).where(drizzleOrm.and(drizzleOrm.eq(filmTakes.filmId, filmId), drizzleOrm.eq(filmTakes.kind, "image"), drizzleOrm.inArray(filmTakes.status, ["queued", "running", "done"]))).all().map((t2) => t2.assetId)
  );
  const known = new Set(film.castKnown ?? chars.map((a) => a.seriesCharacterId).filter((x) => !!x));
  for (const a of chars) {
    const c = a.seriesCharacterId ? cast.find((x) => x.id === a.seriesCharacterId) : void 0;
    if (!c) continue;
    const v = voiceOf(c);
    const patch = {
      ...!a.voiceProfile && v.voiceProfile ? { voiceProfile: v.voiceProfile } : {},
      ...!a.voiceId && v.voiceId ? { voiceProvider: v.voiceProvider, voiceId: v.voiceId } : {}
    };
    if (Object.keys(patch).length) db2.update(filmAssets).set(patch).where(drizzleOrm.eq(filmAssets.id, a.id)).run();
  }
  const images = db2.select({ id: filmTakes.id, assetId: filmTakes.assetId, model: filmTakes.model, refs: filmTakes.refs, file: filmTakes.file }).from(filmTakes).where(drizzleOrm.and(drizzleOrm.eq(filmTakes.filmId, filmId), drizzleOrm.eq(filmTakes.kind, "image"))).all();
  const imageUpdates = [];
  for (const a of chars) {
    const c = a.seriesCharacterId ? cast.find((x) => x.id === a.seriesCharacterId) : void 0;
    const src = c?.referenceImage ? node_path.join(mediaDir(), c.referenceImage) : null;
    if (!c || !src || !node_fs.existsSync(src)) continue;
    const seriesTakes = images.filter((t2) => t2.assetId === a.id && t2.model === "series");
    if (seriesTakes.some((t2) => t2.refs[0] === c.referenceImage)) continue;
    const legacy = seriesTakes.find((t2) => !t2.refs.length && t2.file && fileSize(node_path.join(mediaDir(), t2.file)) === fileSize(src));
    if (legacy) {
      db2.update(filmTakes).set({ refs: [c.referenceImage] }).where(drizzleOrm.eq(filmTakes.id, legacy.id)).run();
      continue;
    }
    const selected = a.selectedTakeId ? images.find((t2) => t2.id === a.selectedTakeId) : void 0;
    const select = selected ? selected.model === "series" : !busyOrDone.has(a.id) || seriesTakes.length > 0;
    imageUpdates.push({ asset: a, c, select });
  }
  const added = cast.filter((c) => !known.has(c.id) && !chars.some((a) => a.seriesCharacterId === c.id));
  if (!imageUpdates.length && !added.length && film.castKnown) return 0;
  let changed = 0;
  db2.transaction((tx) => {
    for (const u of imageUpdates) if (adoptSeriesImage(tx, filmId, u.asset.id, u.c, u.select)) changed++;
    let pos = (tx.select({ m: drizzleOrm.max(filmAssets.position) }).from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.filmId, filmId), drizzleOrm.eq(filmAssets.kind, "character"))).get()?.m ?? -1) + 1;
    for (const c of added) {
      const assetId = newId();
      tx.insert(filmAssets).values({ id: assetId, filmId, kind: "character", position: pos++, name: c.name, summary: c.role ?? "", description: lookOf(c), descriptionSrc: (c.role ?? "").trim(), seriesCharacterId: c.id, ...voiceOf(c) }).run();
      adoptSeriesImage(tx, filmId, assetId, c);
      changed++;
    }
    tx.update(filmProjects).set({ castKnown: [.../* @__PURE__ */ new Set([...known, ...cast.map((c) => c.id)])] }).where(drizzleOrm.eq(filmProjects.id, filmId)).run();
  });
  return changed;
}
function seriesScriptContext(filmId) {
  const db2 = getDb();
  const film = db2.select().from(filmProjects).where(drizzleOrm.eq(filmProjects.id, filmId)).get();
  if (!film?.seriesId || !film.episodeId) return null;
  const s = db2.select().from(series).where(drizzleOrm.eq(series.id, film.seriesId)).get();
  const ep = db2.select().from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.id, film.episodeId)).get();
  if (!s || !ep) return null;
  const castAssets = db2.select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.filmId, filmId), drizzleOrm.eq(filmAssets.kind, "character"), drizzleOrm.isNotNull(filmAssets.seriesCharacterId))).all();
  const chars = db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, s.id)).all();
  const prev = db2.select({ number: seriesEpisodes.number, title: seriesEpisodes.title, synopsis: seriesEpisodes.synopsis }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.seriesId, s.id)).all().filter((e) => e.number < ep.number).sort((a, b) => a.number - b.number).slice(-8);
  return {
    seriesTitle: s.title,
    logline: s.logline,
    episode: { number: ep.number, title: ep.title, synopsis: ep.synopsis, cliffhanger: ep.cliffhanger },
    cast: castAssets.map((a) => {
      const c = chars.find((x) => x.id === a.seriesCharacterId);
      return { name: a.name, role: c?.role ?? (a.summary || null), look: a.description, voice: a.voiceProfile ?? c?.voiceProfile ?? null, arc: c?.arc ?? null };
    }),
    previous: prev,
    castIsLarge: chars.length >= 8,
    locations: seriesLocationRows(filmId).map((l) => ({ name: l.name, summary: l.summary, look: l.description }))
  };
}
function resolveProposals(filmId, decisions) {
  const db2 = getDb();
  const film = db2.select().from(filmProjects).where(drizzleOrm.eq(filmProjects.id, filmId)).get();
  if (!film) throw new Error("Không tìm thấy phim");
  const kept = [];
  let dropped = 0;
  const emptyShots = /* @__PURE__ */ new Set();
  db2.transaction((tx) => {
    for (const d of decisions) {
      const a = tx.select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.id, d.assetId), drizzleOrm.eq(filmAssets.filmId, filmId))).get();
      if (!a || a.kind !== "character") continue;
      if (d.action === "drop") {
        tx.delete(filmAssets).where(drizzleOrm.eq(filmAssets.id, a.id)).run();
        for (const s of tx.select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.filmId, filmId), drizzleOrm.eq(filmAssets.kind, "shot"))).all())
          if (s.characterIds.includes(a.id)) {
            const rest = s.characterIds.filter((x) => x !== a.id);
            tx.update(filmAssets).set({ characterIds: rest }).where(drizzleOrm.eq(filmAssets.id, s.id)).run();
            if (!rest.length) emptyShots.add(s.name);
          }
        dropped++;
        continue;
      }
      let seriesCharacterId = a.seriesCharacterId;
      if (d.action === "series" && film.seriesId && !seriesCharacterId) {
        const order = tx.select({ id: seriesCharacters.id }).from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, film.seriesId)).all().length;
        seriesCharacterId = newId();
        tx.insert(seriesCharacters).values({
          id: seriesCharacterId,
          seriesId: film.seriesId,
          name: a.name,
          role: a.summary || null,
          // Bản gốc: mô tả tiếng Việt = tóm tắt; tiếng Anh = mô tả hình ảnh của phim
          appearance: a.summary || a.description,
          appearanceEn: a.description,
          voiceProfile: a.voiceProfile,
          voiceProvider: a.voiceProvider,
          voiceId: a.voiceId,
          sortOrder: order
        }).run();
      }
      tx.update(filmAssets).set({ proposal: null, seriesCharacterId: d.action === "series" ? seriesCharacterId : null, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(filmAssets.id, a.id)).run();
      kept.push(a.id);
    }
  });
  return { kept, dropped, emptyShots: [...emptyShots] };
}
function promoteToSeries(assetId) {
  const db2 = getDb();
  const a = db2.select().from(filmAssets).where(drizzleOrm.eq(filmAssets.id, assetId)).get();
  if (!a?.seriesCharacterId) throw new Error("Nhân vật này không thuộc dàn nhân vật series");
  const t2 = a.selectedTakeId ? db2.select().from(filmTakes).where(drizzleOrm.eq(filmTakes.id, a.selectedTakeId)).get() : null;
  if (!t2?.file || t2.status !== "done") throw new Error("Chưa có ảnh đã chọn");
  setSeriesImage(a.seriesCharacterId, node_path.join(mediaDir(), t2.file), a.description);
}
function setSeriesImage(characterId, src, look) {
  const db2 = getDb();
  const c = db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.id, characterId)).get();
  if (!c) return;
  const dir = node_path.join(mediaDir(), "series", c.seriesId);
  node_fs.mkdirSync(dir, { recursive: true });
  const dest = node_path.join(dir, `${c.id}-${Date.now().toString(36)}${node_path.extname(src).toLowerCase() || ".jpg"}`);
  node_fs.copyFileSync(src, dest);
  db2.update(seriesCharacters).set({ referenceImage: rel$2(dest), ...look?.trim() ? { appearanceEn: look.trim() } : {} }).where(drizzleOrm.eq(seriesCharacters.id, c.id)).run();
}
function adoptIfSeriesMissingImage(assetId, file2) {
  const db2 = getDb();
  const a = db2.select({ sc: filmAssets.seriesCharacterId, description: filmAssets.description }).from(filmAssets).where(drizzleOrm.eq(filmAssets.id, assetId)).get();
  if (!a?.sc) return;
  const c = db2.select({ img: seriesCharacters.referenceImage }).from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.id, a.sc)).get();
  if (c && !c.img) setSeriesImage(a.sc, node_path.join(mediaDir(), file2), a.description);
}
function markEpisodeRendered(filmId) {
  const db2 = getDb();
  const film = db2.select({ episodeId: filmProjects.episodeId }).from(filmProjects).where(drizzleOrm.eq(filmProjects.id, filmId)).get();
  if (!film?.episodeId) return;
  const ep = db2.select({ status: seriesEpisodes.status }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.id, film.episodeId)).get();
  if (ep && ep.status !== "published") db2.update(seriesEpisodes).set({ status: "rendered", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(seriesEpisodes.id, film.episodeId)).run();
}
function filmProgress(filmIds, renderCount) {
  const out = /* @__PURE__ */ new Map();
  if (!filmIds.length) return out;
  const db2 = getDb();
  const shots = db2.select({ filmId: filmAssets.filmId, sel: filmAssets.selectedTakeId, vsel: filmAssets.selectedVideoTakeId }).from(filmAssets).where(drizzleOrm.and(drizzleOrm.inArray(filmAssets.filmId, filmIds), drizzleOrm.eq(filmAssets.kind, "shot"))).all();
  const doneTakes = new Set(
    db2.select({ id: filmTakes.id }).from(filmTakes).where(drizzleOrm.and(drizzleOrm.inArray(filmTakes.filmId, filmIds), drizzleOrm.eq(filmTakes.status, "done"))).all().map((t2) => t2.id)
  );
  const existing = new Set(
    db2.select({ id: filmProjects.id }).from(filmProjects).where(drizzleOrm.inArray(filmProjects.id, filmIds)).all().map((f) => f.id)
  );
  for (const id2 of filmIds) {
    if (!existing.has(id2)) continue;
    const list2 = shots.filter((s) => s.filmId === id2);
    out.set(id2, {
      filmId: id2,
      shots: list2.length,
      keyframes: list2.filter((s) => s.sel && doneTakes.has(s.sel)).length,
      videos: list2.filter((s) => s.vsel && doneTakes.has(s.vsel)).length,
      renders: renderCount(id2)
    });
  }
  return out;
}
const locKey = (name) => name.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
function seriesLocationRows(filmId) {
  const db2 = getDb();
  const film = db2.select().from(filmProjects).where(drizzleOrm.eq(filmProjects.id, filmId)).get();
  if (!film?.seriesId) return [];
  const eps = new Map(
    db2.select({ id: seriesEpisodes.id, number: seriesEpisodes.number }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.seriesId, film.seriesId)).all().map((e) => [e.id, e.number])
  );
  const current2 = film.episodeId ? eps.get(film.episodeId) ?? 0 : 0;
  const films = db2.select({ id: filmProjects.id, episodeId: filmProjects.episodeId }).from(filmProjects).where(drizzleOrm.eq(filmProjects.seriesId, film.seriesId)).all().filter((f) => f.id !== filmId);
  if (!films.length) return [];
  const epOf = new Map(films.map((f) => [f.id, f.episodeId ? eps.get(f.episodeId) ?? 0 : 0]));
  const locs = db2.select().from(filmAssets).where(
    drizzleOrm.and(
      drizzleOrm.inArray(
        filmAssets.filmId,
        films.map((f) => f.id)
      ),
      drizzleOrm.eq(filmAssets.kind, "location"),
      drizzleOrm.isNotNull(filmAssets.selectedTakeId)
    )
  ).all();
  const takes = new Map(
    locs.length ? db2.select({ id: filmTakes.id, file: filmTakes.file, status: filmTakes.status }).from(filmTakes).where(
      drizzleOrm.inArray(
        filmTakes.id,
        locs.map((l) => l.selectedTakeId)
      )
    ).all().map((t2) => [t2.id, t2]) : []
  );
  const rows = [];
  for (const l of locs) {
    const t2 = takes.get(l.selectedTakeId);
    if (!t2?.file || t2.status !== "done" || !node_fs.existsSync(node_path.join(mediaDir(), t2.file))) continue;
    rows.push({
      assetId: l.id,
      filmId: l.filmId,
      episode: epOf.get(l.filmId) ?? 0,
      name: l.name,
      summary: l.summary,
      image: t2.file,
      description: l.description,
      descriptionSrc: l.descriptionSrc,
      promptManual: l.promptManual
    });
  }
  const rank = (ep) => ep < current2 ? current2 - ep : 1e3 + ep - current2;
  rows.sort((a, b) => rank(a.episode) - rank(b.episode));
  const seen = /* @__PURE__ */ new Set();
  return rows.filter((r) => seen.has(locKey(r.name)) ? false : (seen.add(locKey(r.name)), true));
}
const seriesLocations = (filmId) => seriesLocationRows(filmId).map(({ assetId, episode, name, summary, image }) => ({ assetId, episode, name, summary, image }));
function adoptSeriesLocation(filmId, assetId, sourceAssetId, copyText = true) {
  const db2 = getDb();
  const target = db2.select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.id, assetId), drizzleOrm.eq(filmAssets.filmId, filmId))).get();
  if (!target || target.kind !== "location") throw new Error("Không tìm thấy bối cảnh");
  const src = seriesLocationRows(filmId).find((r) => r.assetId === sourceAssetId);
  if (!src) throw new Error("Bối cảnh của tập kia không còn ảnh đã chọn");
  db2.transaction((tx) => adoptRow(tx, filmId, target.id, src, copyText));
}
function adoptRow(tx, filmId, assetId, src, copyText) {
  const takeId = newId();
  const dir = filmDir(filmId);
  node_fs.mkdirSync(dir, { recursive: true });
  const from = node_path.join(mediaDir(), src.image);
  const dest = node_path.join(dir, `${takeId}${node_path.extname(from).toLowerCase() || ".jpg"}`);
  node_fs.copyFileSync(from, dest);
  tx.insert(filmTakes).values({ id: takeId, filmId, assetId, kind: "image", status: "done", file: rel$2(dest), prompt: `(bối cảnh tập ${src.episode})`, model: "series", refs: [src.image], costUsd: 0, finishedAt: /* @__PURE__ */ new Date() }).run();
  tx.update(filmAssets).set({
    selectedTakeId: takeId,
    ...copyText ? { summary: src.summary, description: src.description, descriptionSrc: src.descriptionSrc, promptManual: src.promptManual } : {},
    updatedAt: /* @__PURE__ */ new Date()
  }).where(drizzleOrm.eq(filmAssets.id, assetId)).run();
}
function reuseSeriesLocations(filmId) {
  const lib = new Map(seriesLocationRows(filmId).map((r) => [locKey(r.name), r]));
  if (!lib.size) return 0;
  const db2 = getDb();
  const locs = db2.select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.filmId, filmId), drizzleOrm.eq(filmAssets.kind, "location"))).all().filter((l) => !l.selectedTakeId && lib.has(locKey(l.name)));
  db2.transaction((tx) => locs.forEach((l) => adoptRow(tx, filmId, l.id, lib.get(locKey(l.name)), true)));
  return locs.length;
}
const UPSCALE_QUALITIES = [
  { id: "1080p", label: "Full HD 1080p", hint: "Đăng mạng xã hội (TikTok, Reels, YouTube Shorts)", shortSide: 1080 },
  { id: "4k", label: "4K (2160p)", hint: "Màn hình lớn, YouTube 4K – file nặng hơn nhiều", shortSide: 2160 }
];
const upscaleKey = (method, quality) => `${method}:${quality}`;
function parseUpscale(v) {
  const m = v?.match(/^(flow|local):(1080p|4k)$/);
  return m ? { method: m[1], quality: m[2] } : null;
}
const canFlowUpscale = (file2) => !!readFlowRef(file2);
function probeSize(file2) {
  return new Promise((resolve, reject) => {
    const child = node_child_process.spawn(ffprobePath(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", file2], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => out += d.toString());
    child.on("error", reject);
    child.on("close", () => {
      const [w, h] = out.trim().split("x").map(Number);
      if (w > 0 && h > 0) resolve({ w, h });
      else reject(new Error("Không đọc được kích thước video"));
    });
  });
}
function encodeArgs(enc, quality) {
  const [b, max] = quality === "4k" ? ["40M", "60M"] : ["12M", "18M"];
  switch (enc) {
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p6", "-rc", "vbr", "-cq", "19", "-b:v", b, "-maxrate", max, "-bufsize", max];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", "quality", "-rc", "vbr_peak", "-b:v", b, "-maxrate", max];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-preset", "slow", "-global_quality", "19", "-maxrate", max];
    default:
      return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-maxrate", max, "-bufsize", max];
  }
}
async function localUpscale(o) {
  const target = UPSCALE_QUALITIES.find((q) => q.id === o.quality).shortSide;
  const { w, h } = await probeSize(o.src);
  if (Math.min(w, h) >= target) throw new Error(`Video đã có độ phân giải ${w}×${h} – không cần nâng cấp lên ${o.quality === "4k" ? "4K" : "1080p"}`);
  const portrait = h > w;
  const scale = portrait ? `scale=${target}:-2:flags=lanczos` : `scale=-2:${target}:flags=lanczos`;
  const totalSec = await probeDuration(o.src).catch(() => 0);
  const run2 = (enc2) => runFfmpeg(
    ["-loglevel", "error", "-i", o.src, "-map", "0:v:0", "-map", "0:a?", "-vf", `${scale},unsharp=5:5:0.6:5:5:0,format=yuv420p`, ...encodeArgs(enc2, o.quality), "-c:a", "copy", "-movflags", "+faststart", o.dest],
    { signal: o.signal, totalSec, onProgress: o.onProgress }
  );
  const enc = await currentEncoder();
  try {
    await run2(enc);
  } catch (err) {
    if (o.signal.aborted || enc === "libx264") throw err;
    console.warn(`[upscale] ${enc} lỗi → thử lại bằng CPU`, err instanceof Error ? err.message : err);
    node_fs.rmSync(o.dest, { force: true });
    await run2("libx264");
  }
}
async function upscaleVideo(o) {
  if (!node_fs.existsSync(o.src)) throw new Error("Không tìm thấy video gốc (có thể đã bị xóa)");
  const label = o.quality === "4k" ? "4K" : "1080p";
  try {
    if (o.method === "flow") {
      const ref = readFlowRef(o.src);
      if (!ref) throw new Error('Video này không tạo bằng Google Flow (hoặc tạo bằng bản app cũ) – chọn cách "Trên máy"');
      await flowUpscale({ ref, quality: o.quality, dest: o.dest, signal: o.signal, onStatus: o.onStatus });
      return `Google Flow · nâng cấp ${label}`;
    }
    o.onStatus?.(`Đang nâng cấp ${label} trên máy…`);
    await localUpscale({ src: o.src, dest: o.dest, quality: o.quality, signal: o.signal, onProgress: (r) => o.onStatus?.(`Đang nâng cấp ${label} trên máy… ${Math.round(r * 100)}%`) });
    return `FFmpeg · nâng cấp ${label}`;
  } catch (err) {
    node_fs.rmSync(o.dest, { force: true });
    throw err;
  }
}
const KEY$1 = "film.queue";
const RETRY_MS = [3e4, 12e4, 3e5];
const MAX_ATTEMPTS = RETRY_MS.length + 1;
const DEFAULTS = { paused: false, imageConcurrency: 4, videoConcurrency: 2 };
function queuePrefs() {
  const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, KEY$1)).get()?.value;
  return { ...DEFAULTS, ...v };
}
function setQueuePrefs(p) {
  const next = { ...queuePrefs(), ...p };
  getDb().insert(settings).values({ key: KEY$1, value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: /* @__PURE__ */ new Date() } }).run();
  kick();
  return next;
}
const filmDir = (filmId) => node_path.join(mediaDir(), "film", filmId);
const active$1 = /* @__PURE__ */ new Map();
let started = false;
let timer = null;
const runningOf = (kind) => [...active$1.values()].filter((a) => a.kind === kind).length;
const progress = /* @__PURE__ */ new Map();
const takeProgress = (id2) => progress.get(id2) ?? null;
function kick() {
  if (!started) return;
  const prefs = queuePrefs();
  if (prefs.paused) return;
  const now2 = /* @__PURE__ */ new Date();
  for (const kind of ["image", "video"]) {
    const free = Math.max(0, (kind === "image" ? prefs.imageConcurrency : prefs.videoConcurrency) - runningOf(kind));
    if (!free) continue;
    const next = getDb().select().from(filmTakes).where(drizzleOrm.and(drizzleOrm.eq(filmTakes.status, "queued"), drizzleOrm.eq(filmTakes.kind, kind), drizzleOrm.or(drizzleOrm.isNull(filmTakes.notBefore), drizzleOrm.lte(filmTakes.notBefore, now2)))).orderBy(drizzleOrm.asc(filmTakes.createdAt)).limit(free).all();
    for (const take of next) void runTake(take);
  }
}
const relMedia = (abs) => node_path.relative(mediaDir(), abs).split("\\").join("/");
async function runTake(take) {
  const db2 = getDb();
  const ctrl = new AbortController();
  active$1.set(take.id, { kind: take.kind, ctrl });
  const claimed = db2.update(filmTakes).set({ status: "running", startedAt: /* @__PURE__ */ new Date(), attempts: take.attempts + 1, error: null }).where(drizzleOrm.and(drizzleOrm.eq(filmTakes.id, take.id), drizzleOrm.eq(filmTakes.status, "queued"))).run();
  if (!claimed.changes) {
    active$1.delete(take.id);
    return;
  }
  const up = parseUpscale(take.upscale);
  try {
    const film = db2.select().from(filmProjects).where(drizzleOrm.eq(filmProjects.id, take.filmId)).get();
    if (!film) throw new Error("Phim đã bị xóa");
    const dir = filmDir(film.id);
    node_fs.mkdirSync(dir, { recursive: true });
    const asset = db2.select({ kind: filmAssets.kind }).from(filmAssets).where(drizzleOrm.eq(filmAssets.id, take.assetId)).get();
    let done;
    if (up) {
      const dest = node_path.join(dir, `${take.id}.mp4`);
      const model = await upscaleVideo({
        src: node_path.join(mediaDir(), take.refs[0] ?? ""),
        dest,
        method: up.method,
        quality: up.quality,
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(20 * 6e4)]),
        onStatus: (st) => progress.set(take.id, st)
      });
      done = { file: dest, model, costUsd: 0 };
    } else if (take.kind === "video") {
      const [start2, end] = take.refs.map((f) => node_path.join(mediaDir(), f));
      const dest = node_path.join(dir, `${take.id}.mp4`);
      const r = await generateFilmVideo({
        film,
        prompt: take.prompt,
        start: start2,
        end: end ?? null,
        shotSec: take.durationSec ?? 6,
        dest,
        // Hàm video tự giới hạn 20 phút; thêm biên an toàn
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(25 * 6e4)]),
        onStatus: (st) => progress.set(take.id, st)
      });
      done = { file: dest, model: r.model, costUsd: r.costUsd };
    } else {
      const r = await generateFilmImage({
        engine: film.imageEngine,
        prompt: take.prompt,
        refs: take.refs.map((f) => node_path.join(mediaDir(), f)),
        // Bảng nhân vật luôn ngang (nhiều góc mặt cạnh nhau); bối cảnh / khung hình theo khung phim
        aspect: asset?.kind === "character" ? "16:9" : film.aspect,
        destBase: node_path.join(dir, take.id),
        workspaceId: film.workspaceId,
        // Một ảnh không nên quá 3 phút
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(18e4)])
      });
      done = r;
    }
    db2.transaction((tx) => {
      tx.update(filmTakes).set({ status: "done", file: relMedia(done.file), model: done.model, costUsd: done.costUsd, finishedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(filmTakes.id, take.id)).run();
      if (up && take.sourceTakeId)
        tx.update(filmAssets).set({ selectedVideoTakeId: take.id, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.id, take.assetId), drizzleOrm.eq(filmAssets.selectedVideoTakeId, take.sourceTakeId))).run();
      if (take.kind === "video")
        tx.update(filmAssets).set({ selectedVideoTakeId: take.id, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.id, take.assetId), drizzleOrm.isNull(filmAssets.selectedVideoTakeId))).run();
      else
        tx.update(filmAssets).set({ selectedTakeId: take.id, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.id, take.assetId), drizzleOrm.isNull(filmAssets.selectedTakeId))).run();
    });
    if (take.kind === "image" && asset?.kind === "character") {
      try {
        adoptIfSeriesMissingImage(take.assetId, relMedia(done.file));
      } catch (err) {
        console.warn("[film] không cập nhật được ảnh chuẩn của nhân vật series", err);
      }
    }
  } catch (err) {
    if (ctrl.signal.aborted) {
      try {
        db2.update(filmTakes).set({ finishedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(filmTakes.id, take.id), drizzleOrm.eq(filmTakes.status, "cancelled"))).run();
      } catch {
      }
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const kind = err instanceof AiError ? err.kind : "network";
    if (kind === "budget") {
      setQueuePrefs({ paused: true });
      db2.update(filmTakes).set({ status: "queued", error: `Tạm dừng: ${msg}` }).where(drizzleOrm.eq(filmTakes.id, take.id)).run();
      console.warn("[film] chạm hạn mức chi tiêu → tạm dừng hàng đợi");
      return;
    }
    const temporary = !up && (["rate_limit", "overloaded", "timeout", "network"].includes(kind) || err instanceof TypeError);
    if (temporary && take.attempts + 1 < MAX_ATTEMPTS) {
      const wait = RETRY_MS[take.attempts] ?? RETRY_MS[RETRY_MS.length - 1];
      db2.update(filmTakes).set({ status: "queued", error: `${msg} – thử lại sau ${Math.round(wait / 1e3)}s`, notBefore: new Date(Date.now() + wait) }).where(drizzleOrm.eq(filmTakes.id, take.id)).run();
    } else {
      db2.update(filmTakes).set({ status: "failed", error: msg.slice(0, 500), finishedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(filmTakes.id, take.id)).run();
    }
  } finally {
    progress.delete(take.id);
    if (active$1.get(take.id)?.ctrl === ctrl) active$1.delete(take.id);
    kick();
  }
}
function cancelTakes(ids) {
  if (!ids.length) return 0;
  const db2 = getDb();
  const res = db2.update(filmTakes).set({ status: "cancelled", finishedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.inArray(filmTakes.id, ids), drizzleOrm.inArray(filmTakes.status, ["queued", "running"]))).run();
  for (const id2 of ids) active$1.get(id2)?.ctrl.abort();
  return res.changes;
}
function queueStatus(filmId) {
  const db2 = getDb();
  const prefs = queuePrefs();
  const byStatus = (where) => Object.fromEntries(
    db2.select({ status: filmTakes.status, n: drizzleOrm.count() }).from(filmTakes).where(where).groupBy(filmTakes.status).all().map((r) => [r.status, r.n])
  );
  const all = byStatus();
  const film = filmId ? byStatus(drizzleOrm.eq(filmTakes.filmId, filmId)) : null;
  return {
    ...prefs,
    queued: all.queued ?? 0,
    running: all.running ?? 0,
    ...film ? { film: { queued: film.queued ?? 0, running: film.running ?? 0, done: film.done ?? 0, failed: film.failed ?? 0 } } : {}
  };
}
function startFilmQueue() {
  stopFilmQueue();
  getDb().update(filmTakes).set({ status: "queued" }).where(drizzleOrm.eq(filmTakes.status, "running")).run();
  started = true;
  kick();
  timer = setInterval(kick, 1e4);
}
function stopFilmQueue() {
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  for (const a of active$1.values()) a.ctrl.abort();
  active$1.clear();
}
const authDir = () => authRoot();
const storeFile = () => node_path.join(authDir(), "users.json");
const sessionFile = () => node_path.join(authDir(), "session.bin");
function readStore() {
  try {
    const s = JSON.parse(node_fs.readFileSync(storeFile(), "utf8"));
    if (s && Array.isArray(s.users)) return s;
  } catch {
  }
  return { version: 1, users: [] };
}
function writeStore(s) {
  node_fs.mkdirSync(authDir(), { recursive: true });
  const tmp = storeFile() + ".tmp";
  node_fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 384 });
  node_fs.renameSync(tmp, storeFile());
}
const normEmail = (e) => e.trim().toLowerCase();
function findUser(email2) {
  const e = normEmail(email2);
  return readStore().users.find((u) => u.email === e);
}
function updateUser(id2, patch) {
  const s = readStore();
  const i = s.users.findIndex((u) => u.id === id2);
  if (i < 0) throw new Error("Không tìm thấy tài khoản");
  s.users[i] = { ...s.users[i], ...patch };
  writeStore(s);
  return s.users[i];
}
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
function scrypt(password2, salt, opts) {
  return new Promise((resolve, reject) => node_crypto.scrypt(password2.normalize("NFKC"), salt, KEYLEN, opts, (err, key2) => err ? reject(err) : resolve(key2)));
}
async function hashPassword(password2) {
  const salt = node_crypto.randomBytes(16);
  const key2 = await scrypt(password2, salt, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key2.toString("base64")}`;
}
async function verifyPassword(password2, stored) {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key2 = await scrypt(password2, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2 });
  return key2.length === expected.length && node_crypto.timingSafeEqual(key2, expected);
}
async function createUser(input) {
  const s = readStore();
  const email2 = normEmail(input.email);
  if (s.users.some((u) => u.email === email2)) throw new Error("Email này đã có tài khoản trên máy");
  const user = {
    id: node_crypto.randomUUID(),
    email: email2,
    displayName: input.displayName.trim(),
    passwordHash: await hashPassword(input.password),
    provider: input.provider ?? "local",
    cloudId: input.cloudId ?? null,
    createdAt: Date.now(),
    lastLoginAt: null
  };
  s.users.push(user);
  writeStore(s);
  return user;
}
const REMEMBER_DAYS = 30;
const sha256 = (s) => node_crypto.createHash("sha256").update(s).digest("hex");
function rememberSession(userId) {
  if (!electron.safeStorage.isEncryptionAvailable()) return;
  const token2 = node_crypto.randomBytes(32).toString("base64url");
  updateUser(userId, { rememberTokenHash: sha256(token2), rememberExpiresAt: Date.now() + REMEMBER_DAYS * 864e5 });
  node_fs.mkdirSync(authDir(), { recursive: true });
  node_fs.writeFileSync(sessionFile(), electron.safeStorage.encryptString(JSON.stringify({ userId, token: token2 })), { mode: 384 });
}
function forgetSession(userId) {
  node_fs.rmSync(sessionFile(), { force: true });
  if (userId) {
    try {
      updateUser(userId, { rememberTokenHash: null, rememberExpiresAt: null });
    } catch {
    }
  }
}
function restoreSession() {
  if (!node_fs.existsSync(sessionFile()) || !electron.safeStorage.isEncryptionAvailable()) return null;
  try {
    const { userId, token: token2 } = JSON.parse(electron.safeStorage.decryptString(node_fs.readFileSync(sessionFile())));
    const user = readStore().users.find((u) => u.id === userId);
    if (!user?.rememberTokenHash || !user.rememberExpiresAt || user.rememberExpiresAt < Date.now()) return null;
    const a = Buffer.from(user.rememberTokenHash, "hex");
    const b = Buffer.from(sha256(token2), "hex");
    return a.length === b.length && node_crypto.timingSafeEqual(a, b) ? user : null;
  } catch {
    return null;
  }
}
const failures = /* @__PURE__ */ new Map();
function lockRemainingSec(email2) {
  const f = failures.get(normEmail(email2));
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1e3) : 0;
}
function recordFailure(email2) {
  const key2 = normEmail(email2);
  const f = failures.get(key2) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (f.count - 5)) * 1e3;
  failures.set(key2, f);
}
function clearFailures(email2) {
  failures.delete(normEmail(email2));
}
let needsPick = false;
const LIMIT_KEY = "quota.lastLimit";
function lastLimit() {
  const row = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, LIMIT_KEY)).get();
  return row ? row.value : void 0;
}
function saveLimit(limit) {
  getDb().insert(settings).values({ key: LIMIT_KEY, value: limit }).onConflictDoUpdate({ target: settings.key, set: { value: limit, updatedAt: /* @__PURE__ */ new Date() } }).run();
}
const listeners = /* @__PURE__ */ new Set();
function onQuotaChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((l) => l());
const activeRows = () => getDb().select().from(channels).where(drizzleOrm.inArray(channels.status, ["active", "error"])).orderBy(drizzleOrm.desc(channels.updatedAt)).all();
const blockedRows = () => getDb().select().from(channels).where(drizzleOrm.eq(channels.quotaBlocked, true)).orderBy(drizzleOrm.desc(channels.updatedAt)).all();
const channelIds = () => new Set(getDb().select({ id: channels.id }).from(channels).all().map((r) => r.id));
function block(ids) {
  if (!ids.length) return;
  getDb().update(channels).set({ status: "paused", quotaBlocked: true }).where(drizzleOrm.inArray(channels.id, ids)).run();
}
function unblock(ids) {
  if (!ids.length) return;
  getDb().update(channels).set({ status: "active", quotaBlocked: false }).where(drizzleOrm.and(drizzleOrm.inArray(channels.id, ids), drizzleOrm.eq(channels.quotaBlocked, true))).run();
}
function log(message) {
  getDb().insert(activityLog).values({ level: "warn", scope: "license", message }).run();
}
function enforceQuota(newIds = /* @__PURE__ */ new Set()) {
  if (!licenseUsable()) return 0;
  const limit = licenseLimits().maxChannels;
  const prev = lastLimit();
  const grew = prev === void 0 || limit === null || prev !== null && limit > prev;
  if (prev !== limit) saveLimit(limit);
  const active2 = activeRows();
  if (limit === null) {
    const b = blockedRows();
    unblock(b.map((r) => r.id));
    if (b.length) log(`Gói không giới hạn kênh – đã bật lại ${b.length} kênh ngoài hạn mức`);
    needsPick = false;
    if (b.length) emit();
    return 0;
  }
  if (active2.length > limit) {
    const ordered = [...active2.filter((r) => !newIds.has(r.id)), ...active2.filter((r) => newIds.has(r.id))];
    const extra = ordered.slice(limit);
    block(extra.map((r) => r.id));
    needsPick = true;
    log(`Vượt hạn mức ${limit} kênh của gói – tạm dừng ${extra.length} kênh: ${extra.map((r) => r.name).join(", ").slice(0, 300)}`);
    emit();
    return extra.length;
  }
  if (grew && active2.length < limit) {
    const b = blockedRows().slice(0, limit - active2.length);
    unblock(b.map((r) => r.id));
    if (b.length) {
      log(`Hạn mức kênh tăng lên ${limit} – đã bật lại ${b.length} kênh`);
      emit();
    }
  }
  if (!blockedRows().length) needsPick = false;
  return 0;
}
function quotaState() {
  const limit = licenseLimits().maxChannels;
  const brief = (r) => ({
    id: r.id,
    name: r.name,
    platform: r.platform,
    kind: r.kind,
    avatarUrl: r.avatarUrl,
    followers: r.followers,
    active: r.status !== "paused",
    quotaBlocked: r.quotaBlocked
  });
  const list2 = [...activeRows(), ...blockedRows()].map(brief);
  const used = list2.filter((c) => c.active).length;
  return { limit, used, blocked: list2.filter((c) => c.quotaBlocked).length, needsPick: needsPick && list2.some((c) => c.quotaBlocked), channels: list2 };
}
function setQuotaSelection(activeIds) {
  const limit = licenseLimits().maxChannels;
  const want = new Set(activeIds);
  if (limit !== null && want.size > limit) throw new ApiError("VALIDATION", `Gói hiện tại dùng tối đa ${limit} kênh – bỏ chọn bớt ${want.size - limit} kênh`);
  const pool = [...activeRows(), ...blockedRows()];
  unblock(pool.filter((r) => want.has(r.id) && r.quotaBlocked).map((r) => r.id));
  block(pool.filter((r) => !want.has(r.id)).map((r) => r.id));
  needsPick = false;
  emit();
  return quotaState();
}
let active = null;
let workersOn = false;
function startWorkers() {
  if (workersOn || !currentUser()) return;
  workersOn = true;
  recoverInterruptedJobs();
  startPublisher();
  startInbox();
  startInsights();
  startEarlyCheck();
  startFilmQueue();
  console.info("[license] bật tác vụ nền");
}
function stopWorkers() {
  if (!workersOn) return;
  workersOn = false;
  stopAllRenders();
  stopPublisher();
  stopInbox();
  stopInsights();
  stopEarlyCheck();
  stopFilmQueue();
  console.info("[license] dừng tác vụ nền");
}
onLicenseChange((usable) => usable ? startWorkers() : stopWorkers());
onLicenseState(() => {
  if (!currentUser()) return;
  try {
    enforceQuota();
  } catch (err) {
    console.error("[quota] áp hạn mức kênh lỗi", err);
  }
});
const toAuthUser = (u) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  provider: u.provider,
  createdAt: new Date(u.createdAt),
  lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
  plan: active?.id === u.id ? licenseView().plan : null
});
function activeUser() {
  return active ? readStore().users.find((u) => u.id === active.id) ?? null : null;
}
function hasLegacyData() {
  return node_fs.existsSync(legacyPaths().db);
}
function mergeTree(from, to) {
  if (!node_fs.existsSync(from)) return 0;
  node_fs.mkdirSync(to, { recursive: true });
  let left = 0;
  for (const name of node_fs.readdirSync(from)) {
    const src = node_path.join(from, name);
    const dst = node_path.join(to, name);
    if (node_fs.statSync(src).isDirectory()) {
      left += mergeTree(src, dst);
      continue;
    }
    if (node_fs.existsSync(dst)) continue;
    try {
      node_fs.renameSync(src, dst);
    } catch {
      try {
        node_fs.cpSync(src, dst);
        node_fs.rmSync(src, { force: true });
      } catch {
        left++;
      }
    }
  }
  try {
    if (!node_fs.readdirSync(from).length) node_fs.rmSync(from, { recursive: true });
  } catch {
  }
  return left;
}
function setLegacyOwner(userId) {
  const s = readStore();
  s.legacyOwner = userId;
  writeStore(s);
}
function adoptLegacyData(userId) {
  const legacy = legacyPaths();
  if (!node_fs.existsSync(legacy.db)) return;
  const dir = userDir(userId);
  node_fs.mkdirSync(dir, { recursive: true });
  const vaultTo = node_path.join(dir, "vault");
  const dataTo = node_path.join(dir, "data");
  if (node_fs.existsSync(vaultTo) || node_fs.existsSync(dataTo)) throw new Error("Tài khoản đã có dữ liệu – không chuyển dữ liệu cũ đè lên");
  const movedVault = node_fs.existsSync(legacy.vault);
  if (movedVault) node_fs.renameSync(legacy.vault, vaultTo);
  try {
    node_fs.renameSync(legacy.dataDir, dataTo);
  } catch (err) {
    if (movedVault) node_fs.renameSync(vaultTo, legacy.vault);
    throw err;
  }
  setLegacyOwner(userId);
  const left = mergeTree(legacy.media, node_path.join(dir, "media"));
  console.info(`[auth] đã chuyển dữ liệu cũ vào tài khoản ${userId.slice(0, 8)}${left ? ` (${left} file media đang bị khóa – sẽ chuyển ở lần đăng nhập sau)` : ""}`);
}
function repairLegacy(userId) {
  const legacy = legacyPaths();
  const legacyKey = node_path.join(legacy.vault, "master.bin");
  const owner = readStore().legacyOwner ?? null;
  if (owner && owner !== userId) return;
  if (node_fs.existsSync(legacyKey)) {
    const { rekeyed, unreadable } = rekeyFromLegacy(legacyKey);
    if (rekeyed && !owner) setLegacyOwner(userId);
    if (rekeyed || owner === userId) {
      const backup = `${legacy.vault}.legacy-backup`;
      if (!node_fs.existsSync(backup)) node_fs.renameSync(legacy.vault, backup);
      console.info(`[auth] đã khôi phục ${rekeyed} bí mật từ két cũ${unreadable ? ` · ${unreadable} bí mật không giải mã được` : ""} · bản sao két cũ: ${backup}`);
    }
  }
  if (readStore().legacyOwner === userId && node_fs.existsSync(legacy.media)) {
    const left = mergeTree(legacy.media, node_path.join(userDir(userId), "media"));
    console.info(`[auth] đã gom media cũ vào tài khoản${left ? ` (${left} file còn bị khóa)` : ""}`);
  }
}
function openSession(user) {
  if (active) closeSession();
  setCurrentUser(user.id);
  try {
    openDatabase();
    if (seedIfEmpty()) console.info("[db] đã nạp dữ liệu mẫu (OMNI_SEED=1)");
    ensureProviders();
    console.info(`[auth] đăng nhập ${user.id.slice(0, 8)} · ${dbFilePath()}`);
  } catch (err) {
    closeDatabase();
    setCurrentUser(null);
    throw err;
  }
  try {
    repairLegacy(user.id);
  } catch (err) {
    console.error("[auth] sửa dữ liệu cũ lỗi", err);
  }
  active = updateUser(user.id, { lastLoginAt: Date.now() });
  startLicense(user.id);
}
function closeSession() {
  if (!currentUser()) return;
  stopLicense();
  stopWorkers();
  closeDatabase();
  resetVaultCache();
  console.info(`[auth] đăng xuất ${currentUser().slice(0, 8)}`);
  setCurrentUser(null);
  active = null;
}
const hasUsers = () => readStore().users.length > 0;
let dummyHash = null;
let pendingRegister = null;
const PENDING_TTL_MS = 24 * 36e5;
const toPending = (r) => ({ email: r.email, expiresInSeconds: r.expiresInSeconds, resendInSeconds: r.resendInSeconds });
function saveLastEmail(email2) {
  const s = readStore();
  s.lastEmail = email2;
  writeStore(s);
}
function toApiError(e) {
  if (e instanceof ApiError) return e;
  if (!(e instanceof CloudError)) return new ApiError("INTERNAL", e instanceof Error ? e.message : String(e));
  if (e.offline) return new ApiError("INTERNAL", e.message);
  if (e.status === 401) return new ApiError("AUTH", "Email hoặc mật khẩu không đúng");
  if (e.code === "EMAIL_EXISTS") return new ApiError("CONFLICT", "Email này đã có tài khoản Omnira – hãy đăng nhập");
  if (e.code === "ACCOUNT_LOCKED") return new ApiError("AUTH", e.message);
  if (e.code === "WRONG_PASSWORD") return new ApiError("VALIDATION", "Mật khẩu hiện tại không đúng");
  return new ApiError(e.status === 409 ? "CONFLICT" : "VALIDATION", e.message);
}
async function linkLocal(customer, password2) {
  const users = readStore().users;
  const byCloud = users.find((u) => u.cloudId === customer.id);
  const byEmail = findUser(customer.email);
  let user = byCloud ?? byEmail;
  if (user && !byCloud) {
    if (user.cloudId && user.cloudId !== customer.id) throw new ApiError("CONFLICT", "Email này trên máy đang gắn với tài khoản Omnira khác");
    if (!await verifyPassword(password2, user.passwordHash))
      throw new ApiError(
        "AUTH",
        "Máy này đã có dữ liệu của tài khoản cùng email nhưng mật khẩu khác. Để liên kết và giữ dữ liệu: đổi mật khẩu tài khoản Omnira cho giống mật khẩu cũ trên máy, đăng nhập, rồi đổi lại sau."
      );
  }
  if (!user) return createUser({ email: customer.email, displayName: customer.fullName, password: password2, provider: "cloud", cloudId: customer.id });
  return updateUser(user.id, { provider: "cloud", cloudId: customer.id, displayName: customer.fullName, passwordHash: await hashPassword(password2) });
}
function start(user, remember, password2) {
  try {
    recoverVaultOnThisMachine(user.id, password2);
  } catch (err) {
    console.error("[vault] không mở được khóa di chuyển", err);
    throw new ApiError("INTERNAL", "Không mở được két bảo mật của dữ liệu này trên máy mới (khóa di chuyển không khớp). API key / token cần nhập lại.");
  }
  try {
    openSession(user);
  } catch (err) {
    throw new ApiError("INTERNAL", `Không mở được dữ liệu của tài khoản: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    writePortableKey(user.id, password2);
  } catch (err) {
    console.error("[vault] không ghi được khóa di chuyển", err);
  }
  if (remember) rememberSession(user.id);
  else forgetSession(user.id);
  saveLastEmail(user.email);
}
async function startCloud(auth, password2, remember, adoptLegacy = false) {
  const isNew = !readStore().users.some((u) => u.cloudId === auth.customer.id || u.email === auth.customer.email.toLowerCase());
  const user = await linkLocal(auth.customer, password2);
  if (isNew && adoptLegacy && hasLegacyData()) {
    try {
      adoptLegacyData(user.id);
    } catch (err) {
      console.error("[auth] chuyển dữ liệu cũ lỗi", err);
      throw new ApiError("INTERNAL", `Đã tạo tài khoản nhưng không chuyển được dữ liệu cũ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const prev = readCloudSession(user.id);
  writeCloudSession(user.id, {
    customerId: auth.customer.id,
    email: auth.customer.email,
    customerToken: auth.token,
    // Token license cũ chỉ còn giá trị nếu cùng tài khoản cloud
    licenseToken: prev?.customerId === auth.customer.id ? prev.licenseToken : null,
    updatedAt: Date.now()
  });
  start(user, remember, password2);
  if ((await refreshLicense()).status === "revoked") await activateLicense();
  return activeUser();
}
const cloudToken = () => {
  const u = activeUser();
  const t2 = u ? readCloudSession(u.id)?.customerToken : null;
  if (!t2) throw new ApiError("AUTH", "Phiên đăng nhập Omnira đã hết – đăng xuất rồi đăng nhập lại");
  return t2;
};
const authHandlers = {
  "auth.state": () => {
    const u = activeUser();
    return {
      user: u ? toAuthUser(u) : null,
      hasUsers: hasUsers(),
      // Dữ liệu từ bản trước khi có đăng nhập – màn đăng ký cho chọn chuyển vào tài khoản mới
      legacyData: hasLegacyData(),
      lastEmail: readStore().lastEmail ?? null,
      vaultAvailable: vaultAvailable(),
      license: u ? licenseView() : null,
      cloudUrl: CLOUD_URL
    };
  },
  "auth.register": async ({ email: email2, displayName, password: password2, phone, referralCode, remember, adoptLegacy }) => {
    let r;
    try {
      r = await cloud("/api/client/v1/auth/register", {
        method: "POST",
        body: { email: email2, password: password2, fullName: displayName, phone: phone || null, referralCode: referralCode || null }
      });
    } catch (e) {
      throw toApiError(e);
    }
    pendingRegister = { email: r.email, password: password2, remember, adoptLegacy, at: Date.now() };
    return toPending(r);
  },
  "auth.registerResend": async ({ email: email2 }) => {
    try {
      return toPending(await cloud("/api/client/v1/auth/register/resend", { method: "POST", body: { email: email2 } }));
    } catch (e) {
      throw toApiError(e);
    }
  },
  "auth.registerVerify": async ({ email: email2, code }) => {
    const p = pendingRegister;
    if (!p || p.email !== email2 || Date.now() - p.at > PENDING_TTL_MS)
      throw new ApiError("VALIDATION", "Phiên đăng ký đã hết – vui lòng điền lại thông tin đăng ký");
    let auth;
    try {
      auth = await cloud("/api/client/v1/auth/register/verify", { method: "POST", body: { email: email2, code } });
    } catch (e) {
      if (e instanceof CloudError && e.code === "REGISTRATION_EXPIRED") pendingRegister = null;
      throw toApiError(e);
    }
    pendingRegister = null;
    return toAuthUser(await startCloud(auth, p.password, p.remember, p.adoptLegacy));
  },
  "auth.forgotPassword": async ({ email: email2 }) => {
    try {
      return toPending(await cloud("/api/client/v1/auth/password/forgot", { method: "POST", body: { email: email2 } }));
    } catch (e) {
      throw toApiError(e);
    }
  },
  "auth.resetPassword": async ({ email: email2, code, newPassword, remember }) => {
    let auth;
    try {
      auth = await cloud("/api/client/v1/auth/password/reset", { method: "POST", body: { email: email2, code, newPassword } });
    } catch (e) {
      throw toApiError(e);
    }
    clearFailures(email2);
    return toAuthUser(await startCloud(auth, newPassword, remember));
  },
  "auth.login": async ({ email: email2, password: password2, remember }) => {
    const wait = lockRemainingSec(email2);
    if (wait) throw new ApiError("AUTH", `Sai mật khẩu quá nhiều lần – thử lại sau ${wait} giây`);
    let auth;
    try {
      auth = await cloud("/api/client/v1/auth/login", { method: "POST", body: { email: email2, password: password2 } });
    } catch (e) {
      if (e instanceof CloudError && e.offline) {
        const user = findUser(email2);
        dummyHash ??= hashPassword("omnipage-dummy-password");
        const ok = user ? await verifyPassword(password2, user.passwordHash) : (await verifyPassword(password2, await dummyHash), false);
        if (!user || !ok) {
          recordFailure(email2);
          throw new ApiError("AUTH", "Không kết nối được Omnira Cloud và mật khẩu không khớp mật khẩu đã lưu trên máy");
        }
        if (user.provider !== "cloud" || !verifyLicenseToken(readCloudSession(user.id)?.licenseToken))
          throw new ApiError("INTERNAL", "Không kết nối được Omnira Cloud – cần có mạng để đăng nhập lần này");
        clearFailures(email2);
        start(user, remember, password2);
        return toAuthUser(activeUser());
      }
      if (e instanceof CloudError && e.status === 401) recordFailure(email2);
      throw toApiError(e);
    }
    clearFailures(email2);
    return toAuthUser(await startCloud(auth, password2, remember));
  },
  "auth.logout": async () => {
    const u = activeUser();
    if (u) {
      await deactivateLicense(readCloudSession(u.id)?.customerToken ?? null);
      clearCloudSession(u.id);
    }
    forgetSession(u?.id);
    closeSession();
  },
  "auth.changePassword": async ({ currentPassword, newPassword }) => {
    const u = activeUser();
    if (!u) throw new ApiError("AUTH", "Chưa đăng nhập");
    try {
      await cloud("/api/client/v1/me/password", { method: "POST", body: { currentPassword, newPassword }, token: cloudToken() });
    } catch (e) {
      throw toApiError(e);
    }
    const remembered = !!u.rememberTokenHash;
    updateUser(u.id, { passwordHash: await hashPassword(newPassword), rememberTokenHash: null, rememberExpiresAt: null });
    try {
      writePortableKey(u.id, newPassword);
    } catch (err) {
      console.error("[vault] không ghi lại được khóa di chuyển", err);
    }
    if (remembered) rememberSession(u.id);
    else forgetSession();
  },
  "auth.updateProfile": async ({ displayName }) => {
    const u = activeUser();
    if (!u) throw new ApiError("AUTH", "Chưa đăng nhập");
    try {
      const token2 = cloudToken();
      const me = await cloud("/api/client/v1/me", { token: token2 });
      await cloud("/api/client/v1/me", { method: "PUT", body: { fullName: displayName.trim(), phone: me.customer.phone, company: me.customer.company }, token: token2 });
    } catch (e) {
      throw toApiError(e);
    }
    updateUser(u.id, { displayName: displayName.trim() });
    return toAuthUser(readStore().users.find((x) => x.id === u.id));
  },
  "auth.checkReferral": async ({ code }) => {
    try {
      const r = await cloud(`/api/public/referral/${encodeURIComponent(code)}`, { timeoutMs: 8e3 });
      return { valid: r.valid, name: r.name ?? null };
    } catch (e) {
      throw toApiError(e);
    }
  }
};
const token = () => {
  const u = activeUser();
  const t2 = u ? readCloudSession(u.id)?.customerToken : null;
  if (!t2) throw new ApiError("AUTH", "Phiên đăng nhập Omnira đã hết – đăng xuất rồi đăng nhập lại");
  return t2;
};
const fail = (e) => {
  if (e instanceof ApiError) return e;
  if (e instanceof CloudError) return new ApiError(e.status === 401 ? "AUTH" : e.status === 404 ? "NOT_FOUND" : e.offline ? "INTERNAL" : "VALIDATION", e.message);
  return new ApiError("INTERNAL", e instanceof Error ? e.message : String(e));
};
async function devices() {
  const me = await cloud("/api/client/v1/me", { token: token() });
  const mine = deviceId();
  return me.devices.filter((d) => !d.revokedAt).map((d) => ({ ...d, current: d.deviceId === mine })).sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt));
}
function compareVersion(a, b) {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
let appInfoCache = null;
const cloudHandlers = {
  "license.state": () => licenseView(),
  "channels.quota": () => quotaState(),
  "channels.setQuota": ({ activeIds }) => setQuotaSelection(activeIds),
  "license.refresh": () => refreshLicense(),
  "license.activate": () => activateLicense(),
  "license.devices": async () => {
    try {
      return await devices();
    } catch (e) {
      throw fail(e);
    }
  },
  "license.removeDevice": async ({ id: id2 }) => {
    try {
      await cloud(`/api/client/v1/devices/${encodeURIComponent(id2)}`, { method: "DELETE", token: token() });
      if (!licenseView().usable) await activateLicense();
      return await devices();
    } catch (e) {
      throw fail(e);
    }
  },
  "billing.plans": async () => {
    try {
      return await cloud("/api/public/plans");
    } catch (e) {
      throw fail(e);
    }
  },
  "billing.createOrder": async ({ planCode, gateway }) => {
    try {
      return await cloud("/api/client/v1/orders", { method: "POST", body: { planCode, gateway: gateway ?? null }, token: token() });
    } catch (e) {
      throw fail(e);
    }
  },
  "billing.order": async ({ code }) => {
    try {
      const o = await cloud(`/api/client/v1/orders/${encodeURIComponent(code)}`, { token: token() });
      if (o.status === "PAID") await refreshLicense();
      return o;
    } catch (e) {
      throw fail(e);
    }
  },
  "billing.orders": async () => {
    try {
      return await cloud("/api/client/v1/orders", { token: token() });
    } catch (e) {
      throw fail(e);
    }
  },
  "cloud.notifications": async () => {
    const u = activeUser();
    const t2 = u ? readCloudSession(u.id)?.customerToken : null;
    if (!t2) return { items: [], unread: 0, offline: false };
    try {
      const r = await cloud("/api/client/v1/notifications", { token: t2, timeoutMs: 1e4 });
      return { items: r.items ?? [], unread: r.unread ?? 0, offline: false };
    } catch (e) {
      if (e instanceof CloudError && (e.offline || e.status === 404)) return { items: [], unread: 0, offline: true };
      throw fail(e);
    }
  },
  "cloud.notificationsSeen": async () => {
    try {
      await cloud("/api/client/v1/notifications/seen", { method: "POST", token: token(), timeoutMs: 1e4 });
    } catch (e) {
      throw fail(e);
    }
  },
  "cloud.appInfo": async () => {
    if (appInfoCache && Date.now() - appInfoCache.at < 10 * 6e4) return appInfoCache.info;
    const current2 = electron.app.getVersion();
    let r = {};
    try {
      r = await cloud("/api/public/app", { timeoutMs: 8e3 });
    } catch {
    }
    const level = r.announcementLevel === "warn" || r.announcementLevel === "critical" || r.announcementLevel === "info" ? r.announcementLevel : r.announcement ? "info" : null;
    const info = {
      currentVersion: current2,
      latestVersion: r.latestVersion ?? null,
      minVersion: r.minVersion ?? null,
      downloadUrl: r.downloadUrl ?? null,
      releaseNotes: r.releaseNotes ?? null,
      announcement: r.announcement ?? null,
      announcementLevel: level,
      updateAvailable: !!r.latestVersion && compareVersion(current2, r.latestVersion) < 0,
      updateRequired: !!r.minVersion && compareVersion(current2, r.minVersion) < 0
    };
    appInfoCache = { at: Date.now(), info };
    return info;
  },
  "system.openExternal": async ({ url }) => {
    if (!/^https?:\/\//i.test(url)) throw new ApiError("VALIDATION", "Chỉ mở được link http(s)");
    await electron.shell.openExternal(url);
  }
};
function dirSize(dir) {
  if (!node_fs.existsSync(dir)) return 0;
  let total2 = 0;
  for (const e of node_fs.readdirSync(dir, { withFileTypes: true })) {
    const p = node_path.join(dir, e.name);
    if (e.isDirectory()) total2 += dirSize(p);
    else if (e.isFile()) total2 += node_fs.statSync(p).size;
  }
  return total2;
}
const isDataDir = (dir) => node_fs.existsSync(node_path.join(dir, DATA_MARKER)) || node_fs.existsSync(node_path.join(dir, "auth", "users.json"));
async function pickFolder(title) {
  if (process.env.OMNI_PICK_DIR) return process.env.OMNI_PICK_DIR;
  const opts = { title, properties: ["openDirectory", "createDirectory"] };
  const win = electron.BrowserWindow.getFocusedWindow();
  const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
  return res.canceled ? null : res.filePaths[0] ?? null;
}
function relaunchSoon() {
  if (process.env.OMNI_NO_RELAUNCH === "1") return;
  setTimeout(() => {
    electron.app.relaunch();
    electron.app.exit(0);
  }, 600);
}
const dataLocationHandlers = {
  "storage.location": () => {
    const root2 = dataRoot();
    let freeBytes = null;
    try {
      const fs = node_fs.statfsSync(root2);
      freeBytes = fs.bavail * fs.bsize;
    } catch {
    }
    return {
      root: root2,
      isDefault: node_path.resolve(root2) === node_path.resolve(defaultDataRoot()),
      defaultRoot: defaultDataRoot(),
      sizeBytes: dirSize(node_path.join(root2, "users")) + dirSize(node_path.join(root2, "auth")),
      freeBytes
    };
  },
  "storage.openRoot": async () => {
    const err = await electron.shell.openPath(dataRoot());
    if (err) throw new ApiError("INTERNAL", `Không mở được thư mục: ${err}`);
  },
  /** Chép toàn bộ dữ liệu sang thư mục mới rồi khởi động lại app dùng thư mục đó. */
  "storage.move": async () => {
    const picked = await pickFolder("Chọn thư mục mới để lưu dữ liệu OmniPage");
    if (!picked) return { moved: false, root: dataRoot() };
    const from = dataRoot();
    const target = isDataDir(picked) ? picked : node_fs.readdirSync(picked).length ? node_path.join(picked, "OmniPage Data") : picked;
    if (node_path.resolve(target) === node_path.resolve(from)) throw new ApiError("VALIDATION", "Đây đang là thư mục dữ liệu hiện tại");
    if (node_path.resolve(target).startsWith(node_path.resolve(from) + "\\") || node_path.resolve(target).startsWith(node_path.resolve(from) + "/"))
      throw new ApiError("VALIDATION", "Không chọn thư mục nằm bên trong thư mục dữ liệu hiện tại");
    if (isDataDir(target) && node_fs.existsSync(node_path.join(target, "auth", "users.json")))
      throw new ApiError("VALIDATION", 'Thư mục này đã chứa dữ liệu OmniPage khác – chọn thư mục trống, hoặc dùng "Dùng thư mục dữ liệu có sẵn"');
    const need2 = dirSize(node_path.join(from, "users")) + dirSize(node_path.join(from, "auth"));
    try {
      const fs = node_fs.statfsSync(picked);
      if (fs.bavail * fs.bsize < need2 * 1.05 + 200 * 1024 * 1024) throw new ApiError("VALIDATION", `Ổ đĩa đích không đủ chỗ (cần khoảng ${(need2 / 1024 ** 3).toFixed(1)} GB)`);
    } catch (err) {
      if (err instanceof ApiError) throw err;
    }
    closeSession();
    console.info(`[data] chuyển dữ liệu ${from} → ${target} (${(need2 / 1024 ** 2).toFixed(0)} MB)`);
    for (const sub of ["auth", "users"]) if (node_fs.existsSync(node_path.join(from, sub))) await promises$1.cp(node_path.join(from, sub), node_path.join(target, sub), { recursive: true, force: false, errorOnExist: false });
    writeDataMarker(target);
    setDataRootPointer(target);
    relaunchSoon();
    return { moved: true, root: target };
  },
  /** Máy mới: trỏ tới thư mục dữ liệu đã sao lưu / chép sang. */
  "storage.useExisting": async () => {
    const picked = await pickFolder("Chọn thư mục dữ liệu OmniPage đã sao lưu");
    if (!picked) return { changed: false, root: dataRoot() };
    const dir = isDataDir(picked) ? picked : isDataDir(node_path.join(picked, "OmniPage Data")) ? node_path.join(picked, "OmniPage Data") : null;
    if (!dir) throw new ApiError("VALIDATION", "Thư mục này không phải thư mục dữ liệu OmniPage (thiếu omnipage-data.json / auth/users.json)");
    if (node_path.resolve(dir) === node_path.resolve(dataRoot())) return { changed: false, root: dir };
    closeSession();
    setDataRootPointer(dir);
    console.info(`[data] dùng thư mục dữ liệu có sẵn: ${dir}`);
    relaunchSoon();
    return { changed: true, root: dir };
  }
};
function byWorkspace(column, workspaceId) {
  return workspaceId ? drizzleOrm.eq(column, workspaceId) : void 0;
}
function toProxy({ passwordSecretId, ...rest }) {
  return { ...rest, hasPassword: passwordSecretId != null };
}
function loadNodes(where) {
  const db2 = getDb();
  const accs = db2.select().from(accounts).where(where).orderBy(drizzleOrm.asc(accounts.platform), drizzleOrm.asc(accounts.displayName)).all();
  if (accs.length === 0) return [];
  const ids = accs.map((a) => a.id);
  const chans = db2.select().from(channels).where(drizzleOrm.inArray(channels.accountId, ids)).orderBy(drizzleOrm.asc(channels.name)).all();
  const proxyIds = accs.map((a) => a.proxyId).filter((p) => p != null);
  const proxyRows = proxyIds.length ? db2.select().from(proxies).where(drizzleOrm.inArray(proxies.id, proxyIds)).all() : [];
  const cookieOwners = new Set(
    db2.select({ ownerId: secrets.ownerId }).from(secrets).where(drizzleOrm.and(drizzleOrm.eq(secrets.ownerType, "account"), drizzleOrm.eq(secrets.kind, "cookie"), drizzleOrm.inArray(secrets.ownerId, ids))).all().map((r) => r.ownerId)
  );
  const channelsByAccount = /* @__PURE__ */ new Map();
  for (const c of chans) {
    const list2 = channelsByAccount.get(c.accountId) ?? [];
    list2.push(c);
    channelsByAccount.set(c.accountId, list2);
  }
  return accs.map((a) => {
    const proxy = proxyRows.find((p) => p.id === a.proxyId);
    return {
      ...a,
      proxy: proxy ? toProxy(proxy) : null,
      channels: channelsByAccount.get(a.id) ?? [],
      hasCookie: cookieOwners.has(a.id)
    };
  });
}
const channelKind = { facebook: "fb_page", tiktok: "tiktok_account", instagram: "ig_account", youtube: "yt_channel" };
const accountHandlers = {
  "accounts.tree": ({ workspaceId }) => loadNodes(byWorkspace(accounts.workspaceId, workspaceId)),
  "accounts.get": ({ id: id2 }) => {
    const db2 = getDb();
    const [node] = loadNodes(drizzleOrm.eq(accounts.id, id2));
    if (!node) throw notFound("tài khoản");
    const ws = node.workspaceId ? db2.select({ name: workspaces.name }).from(workspaces).where(drizzleOrm.eq(workspaces.id, node.workspaceId)).get() : void 0;
    const profile = node.browserProfileId ? db2.select().from(browserProfiles).where(drizzleOrm.eq(browserProfiles.id, node.browserProfileId)).get() ?? null : null;
    const channelIds2 = node.channels.map((c) => c.id);
    const secretRows = db2.select({ kind: secrets.kind, preview: secrets.preview, expiresAt: secrets.expiresAt, updatedAt: secrets.updatedAt }).from(secrets).where(
      channelIds2.length ? drizzleOrm.and(drizzleOrm.inArray(secrets.ownerId, [id2, ...channelIds2]), drizzleOrm.inArray(secrets.ownerType, ["account", "channel"])) : drizzleOrm.and(drizzleOrm.eq(secrets.ownerId, id2), drizzleOrm.eq(secrets.ownerType, "account"))
    ).orderBy(drizzleOrm.desc(secrets.updatedAt)).all();
    return { ...node, workspaceName: ws?.name ?? null, profile, secrets: secretRows };
  },
  "accounts.create": (input) => {
    const db2 = getDb();
    return db2.transaction((tx) => {
      const account = tx.insert(accounts).values({ id: newId(), ...input }).returning().get();
      if (input.platform !== "facebook") {
        tx.insert(channels).values({
          id: newId(),
          accountId: account.id,
          workspaceId: account.workspaceId,
          platform: account.platform,
          kind: channelKind[account.platform],
          name: account.displayName,
          handle: account.handle,
          externalId: account.externalId
        }).run();
      }
      return account;
    });
  },
  "accounts.update": ({ id: id2, patch }) => {
    const db2 = getDb();
    return db2.transaction((tx) => {
      const row = tx.update(accounts).set({ ...patch, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(accounts.id, id2)).returning().get();
      if (!row) throw notFound("tài khoản");
      if (patch.workspaceId !== void 0) {
        tx.update(channels).set({ workspaceId: row.workspaceId, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(channels.accountId, id2)).run();
      }
      return row;
    });
  },
  "accounts.delete": ({ id: id2 }) => {
    const db2 = getDb();
    db2.transaction((tx) => {
      const channelIds2 = tx.select({ id: channels.id }).from(channels).where(drizzleOrm.eq(channels.accountId, id2)).all().map((c) => c.id);
      const res = tx.delete(accounts).where(drizzleOrm.eq(accounts.id, id2)).run();
      if (res.changes === 0) throw notFound("tài khoản");
      tx.delete(secrets).where(drizzleOrm.and(drizzleOrm.eq(secrets.ownerType, "account"), drizzleOrm.eq(secrets.ownerId, id2))).run();
      if (channelIds2.length)
        tx.delete(secrets).where(drizzleOrm.and(drizzleOrm.eq(secrets.ownerType, "channel"), drizzleOrm.inArray(secrets.ownerId, channelIds2))).run();
    });
  },
  "channels.createPage": (input) => {
    const db2 = getDb();
    const parent = db2.select().from(accounts).where(drizzleOrm.eq(accounts.id, input.accountId)).get();
    if (!parent) throw notFound("tài khoản VIA");
    if (parent.platform !== "facebook") throw new ApiError("VALIDATION", "Chỉ thêm Fanpage dưới tài khoản Facebook");
    return db2.insert(channels).values({ id: newId(), ...input, platform: "facebook", kind: "fb_page", workspaceId: parent.workspaceId }).returning().get();
  },
  "channels.delete": ({ id: id2 }) => {
    const db2 = getDb();
    db2.transaction((tx) => {
      const res = tx.delete(channels).where(drizzleOrm.eq(channels.id, id2)).run();
      if (res.changes === 0) throw notFound("kênh");
      tx.delete(secrets).where(drizzleOrm.and(drizzleOrm.eq(secrets.ownerType, "channel"), drizzleOrm.eq(secrets.ownerId, id2))).run();
    });
  },
  "channels.list": ({ workspaceId, platform: platform2 }) => getDb().select({ channel: channels, accountName: accounts.displayName }).from(channels).innerJoin(accounts, drizzleOrm.eq(accounts.id, channels.accountId)).where(drizzleOrm.and(byWorkspace(channels.workspaceId, workspaceId), platform2 ? drizzleOrm.eq(channels.platform, platform2) : void 0)).orderBy(drizzleOrm.asc(channels.platform), drizzleOrm.asc(channels.name)).all().map((r) => ({ ...r.channel, accountName: r.accountName })),
  "proxies.list": ({ workspaceId }) => getDb().select().from(proxies).where(byWorkspace(proxies.workspaceId, workspaceId)).orderBy(drizzleOrm.asc(proxies.label)).all().map(toProxy),
  "proxies.create": (input) => toProxy(
    getDb().insert(proxies).values({ id: newId(), ...input }).returning().get()
  ),
  "proxies.delete": ({ id: id2 }) => {
    const res = getDb().delete(proxies).where(drizzleOrm.eq(proxies.id, id2)).run();
    if (res.changes === 0) throw notFound("proxy");
  }
};
const KEY = "posts.stagger";
const MIN = 6e4;
const DEFAULT_STAGGER = { enabled: true, minMinutes: 5, maxMinutes: 25 };
function staggerPrefs(db2 = getDb()) {
  const v = db2.select().from(settings).where(drizzleOrm.eq(settings.key, KEY)).get()?.value;
  return { ...DEFAULT_STAGGER, ...v };
}
function setStaggerPrefs(p) {
  const next = { ...staggerPrefs(), ...p };
  if (next.maxMinutes < next.minMinutes) next.maxMinutes = next.minMinutes;
  getDb().insert(settings).values({ key: KEY, value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: /* @__PURE__ */ new Date() } }).run();
  return next;
}
function staggerTime(at2, others, prefs, rand = Math.random) {
  if (!prefs.enabled || prefs.minMinutes <= 0) return at2;
  const gap = prefs.minMinutes * MIN;
  let t2 = at2;
  for (let i = 0; i < 500; i++) {
    const clash = others.filter((x) => Math.abs(x - t2) < gap);
    if (!clash.length) return t2;
    const step = (prefs.minMinutes + rand() * (prefs.maxMinutes - prefs.minMinutes)) * MIN;
    t2 = Math.ceil((Math.max(...clash) + step) / MIN) * MIN;
  }
  return t2;
}
function queuedTimesNear(db2, at2, excludeId) {
  const where = [drizzleOrm.eq(scheduledPosts.status, "queued"), drizzleOrm.gte(scheduledPosts.scheduledAt, new Date(at2 - 2 * 36e5)), drizzleOrm.lte(scheduledPosts.scheduledAt, new Date(at2 + 48 * 36e5))];
  if (excludeId) where.push(drizzleOrm.ne(scheduledPosts.id, excludeId));
  return db2.select({ at: scheduledPosts.scheduledAt }).from(scheduledPosts).where(drizzleOrm.and(...where)).all().map((r) => r.at.getTime());
}
const MEDIA_EXT = /* @__PURE__ */ new Set([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".m4v"]);
const VIDEO_EXT = /* @__PURE__ */ new Set([".mp4", ".mov", ".m4v"]);
async function checkMedia(paths) {
  if (!paths) return {};
  const abs = (p) => node_path.isAbsolute(p) ? p : node_path.join(mediaDir(), p);
  for (const p of paths) {
    if (!MEDIA_EXT.has(node_path.extname(p).toLowerCase())) throw new ApiError("VALIDATION", `Định dạng không hỗ trợ: ${p.split(/[\\/]/).pop()}`);
    if (!node_fs.existsSync(abs(p))) throw new ApiError("VALIDATION", `Không tìm thấy file: ${p.split(/[\\/]/).pop()}`);
  }
  const video = paths.find((p) => VIDEO_EXT.has(node_path.extname(p).toLowerCase()));
  let durationSec = null;
  if (video) durationSec = await probeDuration(abs(video)).catch(() => null);
  return { mediaPaths: paths, ...video ? { durationSec } : {} };
}
const likePattern = (q) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const contentHandlers = {
  "content.list": ({ workspaceId, status: status2, search }) => getDb().select().from(contentItems).where(
    drizzleOrm.and(
      byWorkspace(contentItems.workspaceId, workspaceId),
      status2?.length ? drizzleOrm.inArray(contentItems.status, status2) : void 0,
      search ? drizzleOrm.sql`${contentItems.title} like ${likePattern(search)} escape '\\'` : void 0
    )
  ).orderBy(drizzleOrm.desc(contentItems.createdAt)).all(),
  "content.create": async (input) => {
    const media = await checkMedia(input.mediaPaths);
    return getDb().insert(contentItems).values({ id: newId(), ...input, ...media }).returning().get();
  },
  "content.update": async ({ id: id2, patch }) => {
    const media = await checkMedia(patch.mediaPaths);
    const row = getDb().update(contentItems).set({ ...patch, ...media, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, id2)).returning().get();
    if (!row) throw notFound("nội dung");
    return row;
  },
  "content.bulkMove": ({ ids, workspaceId }) => {
    const res = getDb().update(contentItems).set({ workspaceId, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.inArray(contentItems.id, ids)).run();
    return { updated: res.changes };
  },
  // Xóa kéo theo các bài đã lên lịch (FK cascade) – UI phải xác nhận trước
  "content.bulkDelete": ({ ids }) => ({ deleted: getDb().delete(contentItems).where(drizzleOrm.inArray(contentItems.id, ids)).run().changes }),
  "content.stats": ({ workspaceId }) => {
    const db2 = getDb();
    const ws = byWorkspace(contentItems.workspaceId, workspaceId);
    const rows = db2.select({ kind: contentItems.kind, status: contentItems.status, spinVariants: contentItems.spinVariants, createdAt: contentItems.createdAt }).from(contentItems).where(ws).all();
    const startOfDay = /* @__PURE__ */ new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const byKind = { video: 0, reel: 0, image: 0, carousel: 0, text: 0 };
    for (const r of rows) byKind[r.kind]++;
    const now2 = Date.now();
    const channelRows = db2.select({ id: channels.id }).from(channels).where(drizzleOrm.and(byWorkspace(channels.workspaceId, workspaceId), drizzleOrm.eq(channels.status, "active"))).all();
    const busy = new Set(
      db2.select({ channelId: scheduledPosts.channelId }).from(scheduledPosts).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.status, "queued"), drizzleOrm.gte(scheduledPosts.scheduledAt, new Date(now2)), drizzleOrm.lt(scheduledPosts.scheduledAt, new Date(now2 + 7 * 864e5)))).all().map((r) => r.channelId)
    );
    return {
      total: rows.length,
      addedToday: rows.filter((r) => r.createdAt >= startOfDay).length,
      spun: rows.filter((r) => r.spinVariants > 0).length,
      spinVariants: rows.reduce((a, r) => a + r.spinVariants, 0),
      ready: rows.filter((r) => r.status === "ready").length,
      idleChannels: channelRows.filter((c) => !busy.has(c.id)).length,
      // Đếm theo workspace luôn trên toàn bộ kho (để hiện số trên chip lọc)
      byWorkspace: db2.select({ workspaceId: contentItems.workspaceId, n: drizzleOrm.count() }).from(contentItems).groupBy(contentItems.workspaceId).all(),
      byKind
    };
  },
  "content.delete": ({ id: id2 }) => {
    const res = getDb().delete(contentItems).where(drizzleOrm.eq(contentItems.id, id2)).run();
    if (res.changes === 0) throw notFound("nội dung");
  },
  "posts.range": ({ from, to, workspaceId }) => getDb().select({
    post: scheduledPosts,
    contentTitle: contentItems.title,
    contentKind: contentItems.kind,
    thumbnailPath: contentItems.thumbnailPath,
    channelName: channels.name,
    platform: channels.platform,
    workspaceId: channels.workspaceId,
    tokenStatus: channels.tokenStatus
  }).from(scheduledPosts).innerJoin(contentItems, drizzleOrm.eq(contentItems.id, scheduledPosts.contentItemId)).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(drizzleOrm.and(drizzleOrm.gte(scheduledPosts.scheduledAt, new Date(from)), drizzleOrm.lt(scheduledPosts.scheduledAt, new Date(to)), byWorkspace(channels.workspaceId, workspaceId))).orderBy(drizzleOrm.asc(scheduledPosts.scheduledAt)).all().map(({ post, ...rest }) => ({ ...post, ...rest })),
  "posts.schedule": ({ contentItemId, channelId, scheduledAt }) => {
    if (scheduledAt < Date.now() - 5 * 6e4) throw new ApiError("VALIDATION", "Không thể lên lịch vào thời điểm đã qua");
    const db2 = getDb();
    return db2.transaction((tx) => {
      const content = tx.select({ id: contentItems.id }).from(contentItems).where(drizzleOrm.eq(contentItems.id, contentItemId)).get();
      if (!content) throw notFound("nội dung");
      const channel = tx.select({ id: channels.id }).from(channels).where(drizzleOrm.eq(channels.id, channelId)).get();
      if (!channel) throw notFound("kênh");
      const at2 = staggerTime(scheduledAt, queuedTimesNear(tx, scheduledAt), staggerPrefs(tx));
      const post = tx.insert(scheduledPosts).values({ id: newId(), contentItemId, channelId, scheduledAt: new Date(at2) }).returning().get();
      tx.update(contentItems).set({ status: "scheduled", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, contentItemId)).run();
      return post;
    });
  },
  "posts.reschedule": ({ id: id2, scheduledAt }) => {
    if (scheduledAt < Date.now() - 5 * 6e4) throw new ApiError("VALIDATION", "Không thể dời lịch về thời điểm đã qua");
    const db2 = getDb();
    const post = db2.select({ status: scheduledPosts.status }).from(scheduledPosts).where(drizzleOrm.eq(scheduledPosts.id, id2)).get();
    if (!post) throw notFound("bài đăng");
    if (post.status !== "queued" && post.status !== "failed") {
      throw new ApiError("CONFLICT", "Chỉ dời lịch được bài đang chờ hoặc bị lỗi");
    }
    return db2.transaction((tx) => {
      const at2 = staggerTime(scheduledAt, queuedTimesNear(tx, scheduledAt, id2), staggerPrefs(tx));
      const row = tx.update(scheduledPosts).set({ scheduledAt: new Date(at2), status: "queued", error: null, attempts: 0, nextAttemptAt: null, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(scheduledPosts.id, id2)).returning({ contentItemId: scheduledPosts.contentItemId }).get();
      if (row)
        tx.update(contentItems).set({ status: "scheduled", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(contentItems.id, row.contentItemId), drizzleOrm.eq(contentItems.status, "failed"))).run();
      return { scheduledAt: at2 };
    });
  },
  "posts.cancel": ({ id: id2 }) => {
    const db2 = getDb();
    db2.transaction((tx) => {
      const post = tx.update(scheduledPosts).set({ status: "cancelled", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.id, id2), drizzleOrm.inArray(scheduledPosts.status, ["queued", "failed"]))).returning({ contentItemId: scheduledPosts.contentItemId }).get();
      if (!post) throw new ApiError("CONFLICT", "Bài đăng không tồn tại hoặc đã được xử lý");
      const others = tx.select({ id: scheduledPosts.id }).from(scheduledPosts).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.contentItemId, post.contentItemId), drizzleOrm.inArray(scheduledPosts.status, ["queued", "publishing", "published"]))).get();
      if (!others) {
        tx.update(contentItems).set({ status: "ready", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(contentItems.id, post.contentItemId), drizzleOrm.inArray(contentItems.status, ["scheduled", "failed"]))).run();
      }
    });
  }
};
const DAY$4 = 864e5;
const pctChange = (cur, prev) => prev ? Math.round((cur - prev) / prev * 1e3) / 10 : null;
function isoDay$2(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function computeSummary(workspaceId, now2 = Date.now()) {
  const db2 = getDb();
  const ws = byWorkspace(channels.workspaceId, workspaceId);
  const chanRows = db2.select({ platform: channels.platform, health: channels.health, createdAt: channels.createdAt }).from(channels).where(ws).all();
  const byPlatform = { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 };
  const health = { ok: 0, warn: 0, error: 0, idle: 0 };
  let addedThisWeek = 0;
  for (const c of chanRows) {
    byPlatform[c.platform]++;
    health[c.health]++;
    if (c.createdAt.getTime() >= now2 - 7 * DAY$4) addedThisWeek++;
  }
  const total2 = chanRows.length;
  const score = total2 ? Math.round((health.ok + health.warn * 0.5) / total2 * 1e3) / 10 : 0;
  const d = new Date(now2);
  const monthStart2 = new Date(d.getFullYear(), d.getMonth(), 1);
  const postStats = db2.select({ status: scheduledPosts.status, n: drizzleOrm.count() }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(drizzleOrm.and(ws, drizzleOrm.gte(scheduledPosts.scheduledAt, monthStart2))).groupBy(scheduledPosts.status).all();
  const queuedAll = db2.select({ n: drizzleOrm.count() }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(drizzleOrm.and(ws, drizzleOrm.eq(scheduledPosts.status, "queued"))).get();
  const stat = (s) => postStats.find((p) => p.status === s)?.n ?? 0;
  const published = stat("published");
  const failed = stat("failed");
  const today = isoDay$2(now2);
  const todayViews = db2.select({ v: drizzleOrm.sum(channelMetricsDaily.views).mapWith(Number) }).from(channelMetricsDaily).innerJoin(channels, drizzleOrm.eq(channels.id, channelMetricsDaily.channelId)).where(drizzleOrm.and(ws, drizzleOrm.eq(channelMetricsDaily.day, today))).get()?.v;
  const endOffset = todayViews ? 0 : 1;
  const from30 = isoDay$2(now2 - (29 + endOffset) * DAY$4);
  const from60 = isoDay$2(now2 - (59 + endOffset) * DAY$4);
  const metrics = db2.select({
    day: channelMetricsDaily.day,
    platform: channels.platform,
    views: drizzleOrm.sum(channelMetricsDaily.views).mapWith(Number),
    engagements: drizzleOrm.sum(channelMetricsDaily.engagements).mapWith(Number)
  }).from(channelMetricsDaily).innerJoin(channels, drizzleOrm.eq(channels.id, channelMetricsDaily.channelId)).where(drizzleOrm.and(ws, drizzleOrm.gte(channelMetricsDaily.day, from60), drizzleOrm.sql`${channelMetricsDaily.day} <= ${today}`)).groupBy(channelMetricsDaily.day, channels.platform).orderBy(drizzleOrm.asc(channelMetricsDaily.day)).all();
  const byDay = /* @__PURE__ */ new Map();
  const prevByPlatform = { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 };
  for (const m of metrics) {
    if (m.day > isoDay$2(now2 - endOffset * DAY$4)) continue;
    if (m.day < from30) {
      prevByPlatform[m.platform] += m.views;
      continue;
    }
    const point = byDay.get(m.day) ?? { day: m.day, views: 0, engagements: 0, byPlatform: { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 } };
    point.views += m.views;
    point.engagements += m.engagements;
    point.byPlatform[m.platform] += m.views;
    byDay.set(m.day, point);
  }
  const series2 = [];
  for (let i = 29 + endOffset; i >= endOffset; i--) {
    const day = isoDay$2(now2 - i * DAY$4);
    series2.push(byDay.get(day) ?? { day, views: 0, engagements: 0, byPlatform: { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 } });
  }
  const views30d = series2.reduce((a, p) => a + p.views, 0);
  const engagements30d = series2.reduce((a, p) => a + p.engagements, 0);
  const prevViews = prevByPlatform.facebook + prevByPlatform.tiktok + prevByPlatform.instagram + prevByPlatform.youtube;
  const platforms = PLATFORMS.map((platform2) => {
    const cur = series2.reduce((a, p) => a + p.byPlatform[platform2], 0);
    return { platform: platform2, views30d: cur, changePct: pctChange(cur, prevByPlatform[platform2]) };
  });
  const proxyRows = db2.select({ health: proxies.health }).from(proxies).where(byWorkspace(proxies.workspaceId, workspaceId)).all();
  const openAlerts = db2.select({ n: drizzleOrm.count() }).from(alerts).where(drizzleOrm.isNull(alerts.resolvedAt)).get();
  return {
    channels: { total: total2, byPlatform, addedThisWeek },
    health: { ...health, score },
    posts: {
      publishedThisMonth: published,
      queued: queuedAll?.n ?? 0,
      failedThisMonth: failed,
      successRate: published + failed ? Math.round(published / (published + failed) * 1e3) / 10 : null
    },
    reach: {
      views30d,
      engagements30d,
      viewsChangePct: pctChange(views30d, prevViews),
      series: series2,
      platforms
    },
    proxies: { total: proxyRows.length, ok: proxyRows.filter((p) => p.health === "ok").length },
    openAlerts: openAlerts?.n ?? 0
  };
}
function topChannels(workspaceId, limit, now2 = Date.now()) {
  const db2 = getDb();
  const today = isoDay$2(now2);
  const weekAgo = isoDay$2(now2 - 7 * DAY$4);
  const gain = drizzleOrm.sql`coalesce(
    max(case when ${channelMetricsDaily.day} = (select max(d.day) from channel_metrics_daily d where d.channel_id = ${channels.id} and d.followers > 0 and d.day between ${weekAgo} and ${today}) then ${channelMetricsDaily.followers} end)
    - max(case when ${channelMetricsDaily.day} = (select min(d.day) from channel_metrics_daily d where d.channel_id = ${channels.id} and d.followers > 0 and d.day between ${weekAgo} and ${today}) then ${channelMetricsDaily.followers} end), 0)`.mapWith(
    Number
  );
  const rows = db2.select({
    id: channels.id,
    name: channels.name,
    handle: channels.handle,
    externalId: channels.externalId,
    platform: channels.platform,
    followers: channels.followers,
    proxyLabel: proxies.label,
    gain
  }).from(channels).innerJoin(accounts, drizzleOrm.eq(accounts.id, channels.accountId)).leftJoin(proxies, drizzleOrm.eq(proxies.id, accounts.proxyId)).leftJoin(channelMetricsDaily, drizzleOrm.eq(channelMetricsDaily.channelId, channels.id)).where(byWorkspace(channels.workspaceId, workspaceId)).groupBy(channels.id).orderBy(drizzleOrm.desc(gain)).limit(limit).all();
  return rows.map(({ gain: followerGain7d, ...r }) => ({ ...r, followerGain7d }));
}
function daemonStatus(workspaceId, now2 = Date.now()) {
  const db2 = getDb();
  const jobs2 = db2.select({ status: renderJobs.status, n: drizzleOrm.count() }).from(renderJobs).innerJoin(videoProjects, drizzleOrm.eq(videoProjects.id, renderJobs.projectId)).where(byWorkspace(videoProjects.workspaceId, workspaceId)).groupBy(renderJobs.status).all();
  const current2 = db2.select({ topic: videoProjects.topic, progress: renderJobs.progress, encoder: renderJobs.encoder }).from(renderJobs).innerJoin(videoProjects, drizzleOrm.eq(videoProjects.id, renderJobs.projectId)).where(drizzleOrm.and(drizzleOrm.eq(renderJobs.status, "running"), byWorkspace(videoProjects.workspaceId, workspaceId))).orderBy(drizzleOrm.asc(renderJobs.startedAt)).get();
  const upcoming = db2.select({ scheduledAt: scheduledPosts.scheduledAt, channelName: channels.name }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(
    drizzleOrm.and(
      drizzleOrm.eq(scheduledPosts.status, "queued"),
      drizzleOrm.gte(scheduledPosts.scheduledAt, new Date(now2)),
      drizzleOrm.sql`${scheduledPosts.scheduledAt} < ${now2 + DAY$4}`,
      byWorkspace(channels.workspaceId, workspaceId)
    )
  ).orderBy(drizzleOrm.asc(scheduledPosts.scheduledAt)).all();
  const startOfDay = new Date(now2);
  startOfDay.setHours(0, 0, 0, 0);
  const rules = db2.select({ n: drizzleOrm.count() }).from(autoReplyRules).where(drizzleOrm.and(drizzleOrm.eq(autoReplyRules.enabled, true), byWorkspace(autoReplyRules.workspaceId, workspaceId))).get();
  const botReplies = db2.select({ n: drizzleOrm.count() }).from(messages).where(drizzleOrm.and(drizzleOrm.eq(messages.author, "bot"), drizzleOrm.gte(messages.createdAt, startOfDay))).get();
  const jobCount = (s) => jobs2.find((j) => j.status === s)?.n ?? 0;
  return {
    render: { running: jobCount("running"), queued: jobCount("queued"), current: current2 ?? null },
    publish: {
      next24h: upcoming.length,
      nextAt: upcoming[0]?.scheduledAt ?? null,
      nextChannels: [...new Set(upcoming.map((u) => u.channelName))].slice(0, 3)
    },
    autoReply: { enabledRules: rules?.n ?? 0, botRepliesToday: botReplies?.n ?? 0 }
  };
}
const dashboardHandlers = {
  "dashboard.summary": ({ workspaceId }) => computeSummary(workspaceId),
  "dashboard.topChannels": ({ workspaceId, limit }) => topChannels(workspaceId, limit),
  "dashboard.daemon": ({ workspaceId }) => daemonStatus(workspaceId),
  "alerts.open": () => getDb().select().from(alerts).where(drizzleOrm.isNull(alerts.resolvedAt)).orderBy(drizzleOrm.sql`case ${alerts.severity} when 'error' then 0 when 'warn' then 1 else 2 end`, drizzleOrm.desc(alerts.createdAt)).all(),
  "alerts.resolve": ({ id: id2 }) => {
    const res = getDb().update(alerts).set({ resolvedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(alerts.id, id2), drizzleOrm.isNull(alerts.resolvedAt))).run();
    if (res.changes === 0) throw notFound("cảnh báo");
  },
  "activity.recent": ({ limit }) => getDb().select().from(activityLog).orderBy(drizzleOrm.desc(activityLog.id)).limit(limit).all()
};
function draftsByConversation() {
  const rows = getDb().select({ conversationId: messages.conversationId, n: drizzleOrm.count() }).from(messages).where(drizzleOrm.eq(messages.deliveryStatus, "draft")).groupBy(messages.conversationId).all();
  return new Map(rows.map((r) => [r.conversationId, r.n]));
}
const inboxHandlers = {
  "inbox.conversations": ({ workspaceId, platform: platform2, unreadOnly }) => getDb().select({ conversation: conversations, channelName: channels.name }).from(conversations).innerJoin(channels, drizzleOrm.eq(channels.id, conversations.channelId)).where(
    drizzleOrm.and(
      byWorkspace(conversations.workspaceId, workspaceId),
      platform2 ? drizzleOrm.eq(conversations.platform, platform2) : void 0,
      unreadOnly ? drizzleOrm.gt(conversations.unreadCount, 0) : void 0
    )
  ).orderBy(drizzleOrm.desc(conversations.lastMessageAt)).all().map((r) => ({ ...r.conversation, channelName: r.channelName, drafts: draftsByConversation().get(r.conversation.id) ?? 0 })),
  "inbox.messages": ({ conversationId }) => getDb().select().from(messages).where(drizzleOrm.eq(messages.conversationId, conversationId)).orderBy(drizzleOrm.asc(messages.createdAt)).all(),
  "inbox.markRead": ({ conversationId }) => {
    const res = getDb().update(conversations).set({ unreadCount: 0, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(conversations.id, conversationId)).run();
    if (res.changes === 0) throw notFound("hội thoại");
  },
  // Mẫu trả lời chung (workspace = null) + mẫu riêng của workspace
  "inbox.quickReplies": ({ workspaceId }) => getDb().select().from(quickReplies).where(workspaceId ? drizzleOrm.or(drizzleOrm.isNull(quickReplies.workspaceId), drizzleOrm.eq(quickReplies.workspaceId, workspaceId)) : void 0).orderBy(drizzleOrm.asc(quickReplies.shortcut)).all(),
  "inbox.stats": ({ workspaceId }) => {
    const db2 = getDb();
    const ws = byWorkspace(conversations.workspaceId, workspaceId);
    const rows = db2.select({ platform: conversations.platform, unread: conversations.unreadCount }).from(conversations).where(ws).all();
    const byPlatform = { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 };
    for (const r of rows) byPlatform[r.platform]++;
    const convIds = db2.select({ id: conversations.id }).from(conversations).where(ws).all().map((c) => c.id);
    const msgs = convIds.length ? db2.select({ conversationId: messages.conversationId, direction: messages.direction, createdAt: messages.createdAt }).from(messages).where(drizzleOrm.inArray(messages.conversationId, convIds)).orderBy(drizzleOrm.asc(messages.conversationId), drizzleOrm.asc(messages.createdAt)).all() : [];
    const waits = [];
    let pendingIn = null;
    for (const m of msgs) {
      if (m.direction === "in") {
        if (!pendingIn || pendingIn.conv !== m.conversationId) pendingIn = { conv: m.conversationId, at: m.createdAt.getTime() };
      } else if (pendingIn && pendingIn.conv === m.conversationId) {
        waits.push((m.createdAt.getTime() - pendingIn.at) / 1e3);
        pendingIn = null;
      }
    }
    const rules = db2.select({ n: drizzleOrm.count() }).from(autoReplyRules).where(drizzleOrm.and(drizzleOrm.eq(autoReplyRules.enabled, true), byWorkspace(autoReplyRules.workspaceId, workspaceId))).get();
    return {
      total: rows.length,
      unread: rows.filter((r) => r.unread > 0).length,
      byPlatform,
      avgResponseSec: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      enabledRules: rules?.n ?? 0
    };
  },
  "inbox.pickAttachments": async ({ images, multiple }) => {
    const opts = {
      title: images ? "Chọn ảnh gửi kèm" : "Chọn tệp gửi kèm",
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: images ? [{ name: "Ảnh", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }] : [{ name: "Tất cả tệp", extensions: ["*"] }]
    };
    const win = electron.BrowserWindow.getFocusedWindow();
    const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    if (res.canceled) return [];
    const dir = node_path.join(mediaDir(), "inbox");
    node_fs.mkdirSync(dir, { recursive: true });
    return res.filePaths.slice(0, 5).map((src) => {
      const size = node_fs.statSync(src).size;
      if (size > 25 * 1024 * 1024) throw new ApiError("VALIDATION", `${node_path.basename(src)} lớn hơn 25 MB – Messenger không nhận`);
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${node_path.extname(src).toLowerCase().replace(/[^.\w]/g, "")}`;
      node_fs.copyFileSync(src, node_path.join(dir, name));
      return { path: `inbox/${name}`, name: node_path.basename(src), size };
    });
  },
  "inbox.send": ({ conversationId, body, attachments }) => {
    const db2 = getDb();
    for (const a of attachments) if (!/^inbox\/[\w.-]+$/.test(a) || !node_fs.existsSync(node_path.join(mediaDir(), a))) throw new ApiError("VALIDATION", "Tệp đính kèm không hợp lệ – chọn lại tệp");
    const preview = body || `[${attachments.length} tệp đính kèm]`;
    return db2.transaction((tx) => {
      const conv = tx.select({ id: conversations.id }).from(conversations).where(drizzleOrm.eq(conversations.id, conversationId)).get();
      if (!conv) throw notFound("hội thoại");
      const now2 = /* @__PURE__ */ new Date();
      const msg = tx.insert(messages).values({ id: newId(), conversationId, direction: "out", author: "agent", body, attachments, deliveryStatus: "pending", createdAt: now2 }).returning().get();
      tx.update(conversations).set({ lastMessageAt: now2, lastMessagePreview: preview.slice(0, 140), unreadCount: 0, updatedAt: now2 }).where(drizzleOrm.eq(conversations.id, conversationId)).run();
      kickOutbox();
      return msg;
    });
  },
  "inbox.update": ({ conversationId, tags, status: status2 }) => {
    const res = getDb().update(conversations).set({ ...tags ? { tags: [...new Set(tags)] } : {}, ...status2 ? { status: status2 } : {}, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(conversations.id, conversationId)).run();
    if (res.changes === 0) throw notFound("hội thoại");
  },
  "inbox.rules": ({ workspaceId }) => getDb().select().from(autoReplyRules).where(workspaceId ? drizzleOrm.or(drizzleOrm.isNull(autoReplyRules.workspaceId), drizzleOrm.eq(autoReplyRules.workspaceId, workspaceId)) : void 0).orderBy(drizzleOrm.asc(autoReplyRules.createdAt)).all(),
  "inbox.toggleRule": ({ id: id2, enabled }) => {
    const res = getDb().update(autoReplyRules).set({ enabled, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(autoReplyRules.id, id2)).run();
    if (res.changes === 0) throw notFound("luật tự động");
  },
  "inbox.saveRule": ({ id: id2, ...input }) => {
    if (input.maxDelaySec < input.minDelaySec) throw new ApiError("VALIDATION", "Độ trễ tối đa phải ≥ độ trễ tối thiểu");
    if (input.action !== "hide_comment" && !input.template?.trim()) throw new ApiError("VALIDATION", "Luật trả lời cần nội dung mẫu");
    const db2 = getDb();
    const ch = input.channelId ? db2.select({ workspaceId: channels.workspaceId }).from(channels).where(drizzleOrm.eq(channels.id, input.channelId)).get() : void 0;
    if (input.channelId && !ch) throw notFound("kênh");
    const values = {
      ...input,
      keywords: [...new Set(input.keywords)],
      workspaceId: ch ? ch.workspaceId : input.workspaceId ?? null,
      channelId: input.channelId ?? null,
      template: input.action === "hide_comment" ? null : input.template ?? null
    };
    if (!id2)
      return db2.insert(autoReplyRules).values({ id: newId(), ...values }).returning().get();
    const row = db2.update(autoReplyRules).set({ ...values, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(autoReplyRules.id, id2)).returning().get();
    if (!row) throw notFound("luật tự động");
    return row;
  },
  "inbox.deleteRule": ({ id: id2 }) => {
    const res = getDb().delete(autoReplyRules).where(drizzleOrm.eq(autoReplyRules.id, id2)).run();
    if (res.changes === 0) throw notFound("luật tự động");
  },
  "inbox.sync": ({ channelId }) => syncAll(channelId),
  "inbox.worker": () => inboxWorkerStatus(),
  "inbox.setAutoSync": ({ enabled }) => {
    setAutoSync(enabled);
    return inboxWorkerStatus();
  },
  "inbox.aiSettings": () => aiSettings(),
  "inbox.setAiSettings": (patch) => saveAiSettings(patch),
  "inbox.approveDraft": ({ id: id2, body }) => {
    if (!approveDraft(id2, body)) throw new ApiError("CONFLICT", "Câu trả lời không còn ở hàng chờ duyệt");
    kickOutbox();
  },
  "inbox.discardDraft": ({ id: id2 }) => {
    if (!discardDraft(id2)) throw new ApiError("CONFLICT", "Câu trả lời không còn ở hàng chờ duyệt");
  },
  "inbox.resend": ({ id: id2 }) => {
    if (!resend(id2)) throw new ApiError("CONFLICT", "Chỉ gửi lại được tin bị lỗi");
  }
};
const HOUR = 36e5;
const DAY$3 = 24 * HOUR;
const HORIZON_DAYS = 14;
const LEAD_MS = 30 * 6e4;
const DEFAULT_SLOTS = [
  { start: "11:30", end: "13:00", weight: 0.35 },
  { start: "19:30", end: "22:00", weight: 0.45 },
  { start: "07:00", end: "08:30", weight: 0.2 }
];
const PLATFORM_FIT = {
  video: ["tiktok", "youtube", "facebook", "instagram"],
  reel: ["instagram", "tiktok", "youtube", "facebook"],
  carousel: ["instagram", "facebook"],
  image: ["facebook", "instagram"],
  text: ["facebook"]
};
const minutesOf = (hhmm2) => {
  const [h, m] = hhmm2.split(":").map(Number);
  return h * 60 + m;
};
function findSlot(from, slots, taken, spacingMs, horizonDays = HORIZON_DAYS) {
  const ordered = [...slots.length ? slots : DEFAULT_SLOTS].sort((a, b) => b.weight - a.weight);
  const day0 = new Date(from);
  day0.setHours(0, 0, 0, 0);
  for (let d = 0; d < horizonDays; d++) {
    const dayStart = day0.getTime() + d * DAY$3;
    const candidates = ordered.map((s) => dayStart + minutesOf(s.start) * 6e4).filter((t2) => t2 >= from);
    for (const t2 of candidates) {
      if (taken.every((x) => Math.abs(x - t2) >= spacingMs)) return t2;
    }
  }
  return null;
}
const schedulerHandlers = {
  "posts.stagger": () => staggerPrefs(),
  "posts.setStagger": (p) => setStaggerPrefs(p),
  "posts.autoSchedule": ({ contentIds, spacingHours }) => {
    const db2 = getDb();
    const now2 = Date.now();
    const from = now2 + LEAD_MS;
    const spacingMs = spacingHours * HOUR;
    return db2.transaction((tx) => {
      const items = tx.select().from(contentItems).where(drizzleOrm.inArray(contentItems.id, contentIds)).all();
      const wsRows = tx.select({ id: workspaces.id, goldenHours: workspaces.goldenHours }).from(workspaces).where(drizzleOrm.isNull(workspaces.archivedAt)).all();
      const activeChannels = tx.select().from(channels).where(drizzleOrm.eq(channels.status, "active")).all();
      const existing = tx.select({ channelId: scheduledPosts.channelId, at: scheduledPosts.scheduledAt }).from(scheduledPosts).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.status, "queued"), drizzleOrm.gte(scheduledPosts.scheduledAt, new Date(now2 - DAY$3)))).all();
      const taken = /* @__PURE__ */ new Map();
      for (const e of existing) taken.set(e.channelId, [...taken.get(e.channelId) ?? [], e.at.getTime()]);
      const allTimes = existing.map((e) => e.at.getTime());
      const stagger = staggerPrefs(tx);
      const result = { created: [], skipped: [] };
      const byId2 = new Map(items.map((i) => [i.id, i]));
      for (const contentId of contentIds) {
        const item = byId2.get(contentId);
        if (!item) {
          result.skipped.push({ contentId, reason: "Không tìm thấy nội dung" });
          continue;
        }
        if (item.status !== "ready") {
          result.skipped.push({ contentId, reason: 'Chỉ xếp lịch nội dung "Sẵn sàng đăng"' });
          continue;
        }
        const fit = PLATFORM_FIT[item.kind];
        const candidates = activeChannels.filter((c) => c.workspaceId === item.workspaceId && fit.includes(c.platform) && c.tokenStatus !== "expired").sort((a, b) => fit.indexOf(a.platform) - fit.indexOf(b.platform) || (taken.get(a.id)?.length ?? 0) - (taken.get(b.id)?.length ?? 0));
        if (!candidates.length) {
          result.skipped.push({ contentId, reason: "Pocket không có kênh hoạt động phù hợp định dạng" });
          continue;
        }
        const slots = wsRows.find((w) => w.id === item.workspaceId)?.goldenHours ?? [];
        let placed = false;
        for (const ch of candidates) {
          const slot = findSlot(from, slots, taken.get(ch.id) ?? [], spacingMs);
          if (slot == null) continue;
          const t2 = staggerTime(slot, allTimes, stagger);
          allTimes.push(t2);
          const post = tx.insert(scheduledPosts).values({ id: newId(), contentItemId: item.id, channelId: ch.id, scheduledAt: new Date(t2), isGoldenHour: true }).returning().get();
          tx.update(contentItems).set({ status: "scheduled", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, item.id)).run();
          taken.set(ch.id, [...taken.get(ch.id) ?? [], t2]);
          result.created.push({ postId: post.id, contentId: item.id, channelName: ch.name, scheduledAt: post.scheduledAt });
          placed = true;
          break;
        }
        if (!placed) result.skipped.push({ contentId, reason: `Hết khung giờ vàng trống trong ${HORIZON_DAYS} ngày tới` });
      }
      return result;
    });
  }
};
const KEY_CAP = "budget.monthlyHardCapUsd";
const KEY_BREAKER = "budget.circuitBreaker";
function getSetting(key2, fallback) {
  const row = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, key2)).get();
  return row ? row.value : fallback;
}
function setSetting(key2, value) {
  getDb().insert(settings).values({ key: key2, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: /* @__PURE__ */ new Date() } }).run();
}
const backendName = () => process.platform === "win32" ? "Windows DPAPI" : process.platform === "darwin" ? "macOS Keychain" : "libsecret / kwallet";
const settingsHandlers = {
  "ai.providers": () => {
    const db2 = getDb();
    const keys = db2.select({ ownerId: secrets.ownerId, preview: secrets.preview }).from(secrets).where(drizzleOrm.and(drizzleOrm.eq(secrets.ownerType, "ai_provider"), drizzleOrm.eq(secrets.kind, "api_key"))).all();
    return db2.select().from(aiProviders).orderBy(drizzleOrm.asc(aiProviders.category), drizzleOrm.asc(aiProviders.priority)).all().map((p) => {
      const key2 = keys.find((k) => k.ownerId === p.id);
      const live = db2.select().from(settings).where(drizzleOrm.eq(settings.key, `ai.models.${p.id}`)).get();
      return { ...p, hasKey: key2 != null, keyPreview: key2?.preview ?? null, liveModels: Array.isArray(live?.value) ? live.value : [] };
    });
  },
  "ai.updateProvider": ({ id: id2, patch }) => {
    const res = getDb().update(aiProviders).set({ ...patch, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(aiProviders.id, id2)).run();
    if (res.changes === 0) throw notFound("nhà cung cấp");
  },
  "ai.setKey": async ({ providerId, key: key2 }) => {
    const db2 = getDb();
    const provider = db2.select().from(aiProviders).where(drizzleOrm.eq(aiProviders.id, providerId)).get();
    if (!provider) throw notFound("nhà cung cấp");
    const info = providerInfo(provider.provider);
    if (info.keyless) throw new ApiError("VALIDATION", `${provider.label} không cần API key`);
    putSecret({ kind: "api_key", ownerType: "ai_provider", ownerId: providerId, value: key2 });
    db2.update(aiProviders).set({ status: "untested", lastTestedAt: null, lastError: null, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(aiProviders.id, providerId)).run();
    return testWithDependents(providerId);
  },
  "ai.testModel": ({ id: id2 }) => testModel(id2),
  "ai.removeKey": ({ providerId }) => {
    if (!deleteSecret("ai_provider", providerId, "api_key")) throw notFound("API key");
    getDb().update(aiProviders).set({ status: "untested", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(aiProviders.id, providerId)).run();
  },
  "vault.info": () => ({ available: vaultAvailable(), fingerprint: vaultFingerprint(), backend: backendName() }),
  "settings.budget": () => {
    const db2 = getDb();
    const now2 = /* @__PURE__ */ new Date();
    const monthStart2 = new Date(now2.getFullYear(), now2.getMonth(), 1);
    const rows = db2.select({ providerId: aiUsage.providerId, label: aiProviders.label, usd: drizzleOrm.sum(aiUsage.costUsd).mapWith(Number) }).from(aiUsage).leftJoin(aiProviders, drizzleOrm.eq(aiProviders.id, aiUsage.providerId)).where(drizzleOrm.gte(aiUsage.createdAt, monthStart2)).groupBy(aiUsage.providerId).all();
    const byProvider = rows.map((r) => ({ providerId: r.providerId, label: r.label ?? "Khác", usd: Math.round(r.usd * 100) / 100 })).sort((a, b) => b.usd - a.usd);
    return {
      month: `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}`,
      hardCapUsd: getSetting(KEY_CAP, 50),
      circuitBreaker: getSetting(KEY_BREAKER, true),
      spentUsd: Math.round(byProvider.reduce((a, r) => a + r.usd, 0) * 100) / 100,
      byProvider
    };
  },
  "settings.setBudget": ({ hardCapUsd, circuitBreaker }) => {
    getDb().transaction(() => {
      setSetting(KEY_CAP, hardCapUsd);
      setSetting(KEY_BREAKER, circuitBreaker);
    });
  }
};
const okImage = (p) => !!p && /^(uploads|cache\/ai|series\/[\w-]+)\/[\w.-]+$/.test(p) && node_fs.existsSync(node_path.join(mediaDir(), p));
function checkRefs(list2) {
  if (!list2) return void 0;
  const bad = list2.find((p) => !okImage(p));
  if (bad) throw new ApiError("VALIDATION", "Ảnh tham chiếu không hợp lệ – chọn lại ảnh");
  return [...new Set(list2)];
}
function characterRefsOf(projectId) {
  const db2 = getDb();
  const ep = db2.select({ seriesId: seriesEpisodes.seriesId }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.projectId, projectId)).get();
  if (!ep) return [];
  return db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, ep.seriesId)).orderBy(drizzleOrm.asc(seriesCharacters.sortOrder)).all().filter((c) => okImage(c.referenceImage)).map((c) => ({ id: c.id, name: c.name, image: c.referenceImage }));
}
const studioHandlers = {
  /**
   * Prompt thủ công (Google Vids / Flow): kịch bản + nhân vật + phong cách. Tập phim: prompt hình của cảnh đã gồm
   * "phong cách. Tên: ngoại hình. mô tả" → tách lại để prompt tổng không lặp ngoại hình ở mọi cảnh.
   */
  "studio.promptExport": ({ id: id2 }) => {
    const db2 = getDb();
    const p = db2.select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, id2)).get();
    if (!p) throw notFound("dự án video");
    const scenes = db2.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, id2)).orderBy(drizzleOrm.asc(videoScenes.position)).all();
    const ep = db2.select({ seriesId: seriesEpisodes.seriesId }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.projectId, id2)).get();
    const s = ep ? db2.select().from(series).where(drizzleOrm.eq(series.id, ep.seriesId)).get() : void 0;
    const chars = ep ? db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, ep.seriesId)).orderBy(drizzleOrm.asc(seriesCharacters.sortOrder)).all() : [];
    const styles = [s?.visualStyleEn, s?.visualStyle].filter((x) => !!x?.trim());
    const looks = chars.map((c) => ({ c, segs: [c.appearanceEn, c.appearance].filter((x) => !!x?.trim()).map((a) => `${c.name}: ${a}`) }));
    let t2 = 0;
    return {
      title: p.topic,
      aspect: p.aspect,
      totalSec: Math.round(scenes.reduce((a, x) => a + x.durationSec, 0)),
      style: s?.visualStyleEn || s?.visualStyle || null,
      characters: chars.map((c) => ({ name: c.name, role: c.role, look: c.appearanceEn || c.appearance })),
      acts: (p.acts ?? []).map((a) => ({ title: a.title, summary: a.summary })),
      scenes: scenes.map((x, index) => {
        let visual = x.mediaPrompt ?? "";
        const present = [];
        const composed = /Lighting:|Subject:|Setting:/.test(visual);
        if (composed) {
          for (const c of chars) if (visual.includes(`${c.name} (`)) present.push(c.name);
        }
        if (!composed) {
          for (const st of styles) if (visual.startsWith(st)) visual = visual.slice(st.length).replace(/^\.\s*/, "");
        }
        if (!composed) {
          for (const { c, segs } of looks)
            for (const seg of segs)
              if (visual.includes(seg)) {
                visual = visual.replace(seg, "").replace(/^\.\s*/, "").replace(/\.\s*\./g, ".");
                if (!present.includes(c.name)) present.push(c.name);
              }
        }
        const speaker2 = x.speakerId ? chars.find((c) => c.id === x.speakerId)?.name ?? null : null;
        if (speaker2 && !present.includes(speaker2)) present.push(speaker2);
        const out = {
          index,
          act: x.act,
          start: Math.round(t2 * 10) / 10,
          durationSec: x.durationSec,
          speaker: speaker2,
          line: x.voiceover,
          visual: visual.trim().replace(/^\.\s*/, ""),
          present
        };
        t2 += x.durationSec;
        return out;
      })
    };
  },
  "studio.projects": ({ workspaceId }) => {
    const db2 = getDb();
    const stats = new Map(
      db2.select({ projectId: videoScenes.projectId, n: drizzleOrm.count(), total: drizzleOrm.sum(videoScenes.durationSec).mapWith(Number) }).from(videoScenes).groupBy(videoScenes.projectId).all().map((r) => [r.projectId, r])
    );
    return db2.select().from(videoProjects).where(byWorkspace(videoProjects.workspaceId, workspaceId)).orderBy(drizzleOrm.desc(videoProjects.updatedAt)).all().map((p) => ({ ...p, sceneCount: stats.get(p.id)?.n ?? 0, totalDurationSec: Math.round((stats.get(p.id)?.total ?? 0) * 10) / 10 }));
  },
  "studio.get": ({ id: id2 }) => {
    const db2 = getDb();
    const project = db2.select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, id2)).get();
    if (!project) throw notFound("dự án video");
    const scenes = db2.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, id2)).orderBy(drizzleOrm.asc(videoScenes.position)).all();
    return { ...project, scenes, characterRefs: characterRefsOf(id2) };
  },
  "studio.create": ({ referenceImages, ...input }) => getDb().insert(videoProjects).values({ id: newId(), ...input, ...referenceImages ? { referenceImages: checkRefs(referenceImages) } : {} }).returning().get(),
  "studio.update": ({ id: id2, patch: { referenceImages, ...patch } }) => {
    const row = getDb().update(videoProjects).set({ ...patch, ...referenceImages ? { referenceImages: checkRefs(referenceImages) } : {}, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, id2)).returning().get();
    if (!row) throw notFound("dự án video");
    return row;
  },
  "studio.delete": ({ id: id2 }) => {
    if (getDb().delete(videoProjects).where(drizzleOrm.eq(videoProjects.id, id2)).run().changes === 0) throw notFound("dự án video");
    node_fs.rmSync(segmentsDir(id2), { recursive: true, force: true });
  },
  "studio.saveScenes": ({ projectId, scenes }) => {
    const db2 = getDb();
    return db2.transaction((tx) => {
      const project = tx.select({ id: videoProjects.id, status: videoProjects.status }).from(videoProjects).where(drizzleOrm.eq(videoProjects.id, projectId)).get();
      if (!project) throw notFound("dự án video");
      const old = tx.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, projectId)).orderBy(drizzleOrm.asc(videoScenes.position)).all();
      const media = /* @__PURE__ */ new Map();
      for (const o of old) if (o.mediaPath) media.set(o.mediaPrompt ?? "", [...media.get(o.mediaPrompt ?? "") ?? [], o]);
      tx.delete(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, projectId)).run();
      const rows = scenes.map((raw, position) => {
        const startImage = okImage(raw.startImage) ? raw.startImage : null;
        const s = {
          ...raw,
          startImage,
          endImage: startImage && okImage(raw.endImage) ? raw.endImage : null,
          sceneRefs: raw.sceneRefs ? raw.sceneRefs.filter((p) => okImage(p)).slice(0, 3) : null
        };
        const { mediaPath, ...rest } = s;
        if (s.mediaMode === "upload") {
          const ok = !!mediaPath && /^uploads\/[\w.-]+$/.test(mediaPath) && node_fs.existsSync(node_path.join(mediaDir(), mediaPath));
          return { id: newId(), projectId, position, ...rest, mediaPath: ok ? mediaPath : null, mediaSource: "upload", mediaCredit: null };
        }
        const m = media.get(s.mediaPrompt ?? "")?.shift();
        return {
          id: newId(),
          projectId,
          position,
          ...rest,
          ...m && m.mediaSource !== "upload" ? { mediaPath: m.mediaPath, mediaCredit: m.mediaCredit, mediaSource: m.mediaSource } : {}
        };
      });
      if (rows.length) tx.insert(videoScenes).values(rows).run();
      tx.update(videoProjects).set({ status: rows.length && project.status === "draft" ? "scripted" : project.status, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, projectId)).run();
      return tx.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, projectId)).orderBy(drizzleOrm.asc(videoScenes.position)).all();
    });
  },
  "studio.toContent": ({ id: id2 }) => {
    const db2 = getDb();
    return db2.transaction((tx) => {
      const p = tx.select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, id2)).get();
      if (!p) throw notFound("dự án video");
      const scenes = tx.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, id2)).orderBy(drizzleOrm.asc(videoScenes.position)).all();
      const durationSec = Math.round(scenes.reduce((a, s) => a + s.durationSec, 0) * 10) / 10;
      const caption = scenes[0]?.voiceover || null;
      const values = { workspaceId: p.workspaceId, kind: "video", title: p.topic.slice(0, 300), caption, aspect: "9:16", durationSec, source: "studio" };
      const status2 = p.status === "rendered" ? "ready" : "draft";
      const existing = p.contentItemId ? tx.select().from(contentItems).where(drizzleOrm.eq(contentItems.id, p.contentItemId)).get() : void 0;
      if (existing) {
        return tx.update(contentItems).set({ ...values, ...existing.status === "draft" || existing.status === "ready" ? { status: status2 } : {}, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, existing.id)).returning().get();
      }
      const item = tx.insert(contentItems).values({ id: newId(), ...values, status: status2 }).returning().get();
      tx.update(videoProjects).set({ contentItemId: item.id, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, id2)).run();
      return item;
    });
  }
};
const DAY$2 = 864e5;
const emptyCounts = () => ({ facebook: 0, tiktok: 0, instagram: 0, youtube: 0 });
function countMap(rows) {
  return new Map(rows.map((r) => [r.workspaceId, r.n]));
}
function listWorkspaces(now2 = Date.now()) {
  const db2 = getDb();
  const rows = db2.select().from(workspaces).where(drizzleOrm.isNull(workspaces.archivedAt)).orderBy(drizzleOrm.asc(workspaces.sortOrder)).all();
  const channelRows = db2.select({ workspaceId: channels.workspaceId, platform: channels.platform, health: channels.health }).from(channels).all();
  const accountCounts = countMap(db2.select({ workspaceId: accounts.workspaceId, n: drizzleOrm.count() }).from(accounts).groupBy(accounts.workspaceId).all());
  const proxyRows = db2.select({ workspaceId: proxies.workspaceId, health: proxies.health }).from(proxies).all();
  const contentCounts = countMap(
    db2.select({ workspaceId: contentItems.workspaceId, n: drizzleOrm.count() }).from(contentItems).where(drizzleOrm.inArray(contentItems.status, ["ready", "scheduled"])).groupBy(contentItems.workspaceId).all()
  );
  const upcoming = countMap(
    db2.select({ workspaceId: channels.workspaceId, n: drizzleOrm.count() }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(drizzleOrm.and(drizzleOrm.eq(scheduledPosts.status, "queued"), drizzleOrm.gte(scheduledPosts.scheduledAt, new Date(now2)), drizzleOrm.lt(scheduledPosts.scheduledAt, new Date(now2 + 7 * DAY$2)))).groupBy(channels.workspaceId).all()
  );
  const d = new Date(now2);
  const monthStart2 = new Date(d.getFullYear(), d.getMonth(), 1);
  const spend = new Map(
    db2.select({ workspaceId: aiUsage.workspaceId, usd: drizzleOrm.sum(aiUsage.costUsd).mapWith(Number) }).from(aiUsage).where(drizzleOrm.gte(aiUsage.createdAt, monthStart2)).groupBy(aiUsage.workspaceId).all().map((r) => [r.workspaceId, r.usd])
  );
  const noise = db2.select({
    workspaceId: browserProfiles.workspaceId,
    total: drizzleOrm.count(),
    on: drizzleOrm.sql`sum(case when ${browserProfiles.canvasNoise} then 1 else 0 end)`.mapWith(Number)
  }).from(browserProfiles).groupBy(browserProfiles.workspaceId).all();
  return rows.map((ws) => {
    const platformCounts = emptyCounts();
    let unhealthyChannels = 0;
    for (const c of channelRows) {
      if (c.workspaceId !== ws.id) continue;
      platformCounts[c.platform]++;
      if (c.health === "warn" || c.health === "error") unhealthyChannels++;
    }
    const wsProxies = proxyRows.filter((p) => p.workspaceId === ws.id);
    const n = noise.find((x) => x.workspaceId === ws.id);
    return {
      ...ws,
      platformCounts,
      channelCount: platformCounts.facebook + platformCounts.tiktok + platformCounts.instagram,
      unhealthyChannels,
      accountCount: accountCounts.get(ws.id) ?? 0,
      proxyCount: wsProxies.length,
      proxyOk: wsProxies.filter((p) => p.health === "ok").length,
      contentReady: contentCounts.get(ws.id) ?? 0,
      postsPerDay: Math.round((upcoming.get(ws.id) ?? 0) / 7 * 10) / 10,
      aiSpentUsd: Math.round((spend.get(ws.id) ?? 0) * 100) / 100,
      canvasNoise: n ? n.on === n.total : null
    };
  });
}
const workspaceHandlers = {
  "workspaces.list": () => listWorkspaces(),
  "workspaces.create": (input) => {
    const db2 = getDb();
    const [{ n }] = db2.select({ n: drizzleOrm.count() }).from(workspaces).all();
    return db2.transaction((tx) => {
      const ws = tx.insert(workspaces).values({ id: newId(), ...input, sortOrder: n }).returning().get();
      tx.insert(browserProfiles).values({ id: newId(), workspaceId: ws.id, name: `${ws.name} #1` }).run();
      return ws;
    });
  },
  "workspaces.update": ({ id: id2, patch }) => {
    const row = getDb().update(workspaces).set({ ...patch, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(workspaces.id, id2)).returning().get();
    if (!row) throw notFound("không gian làm việc");
    return row;
  },
  // Lưu trữ thay vì xóa cứng: kênh/tài khoản vẫn giữ lại để không mất lịch sử
  "workspaces.archive": ({ id: id2 }) => {
    const res = getDb().update(workspaces).set({ archivedAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(workspaces.id, id2), drizzleOrm.isNull(workspaces.archivedAt))).run();
    if (res.changes === 0) throw notFound("không gian làm việc");
  },
  "workspaces.setCanvasNoise": ({ id: id2, enabled }) => {
    getDb().update(browserProfiles).set({ canvasNoise: enabled, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(browserProfiles.workspaceId, id2)).run();
  },
  "workspaces.export": async () => {
    const win = electron.BrowserWindow.getFocusedWindow();
    const opts = {
      title: "Xuất cấu hình Pocket",
      defaultPath: `omnipage-pockets-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    };
    const res = win ? await electron.dialog.showSaveDialog(win, opts) : await electron.dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    const db2 = getDb();
    const data = {
      format: "omnipage.pockets",
      version: 1,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      workspaces: db2.select().from(workspaces).where(drizzleOrm.isNull(workspaces.archivedAt)).all(),
      proxies: db2.select({
        id: proxies.id,
        workspaceId: proxies.workspaceId,
        label: proxies.label,
        protocol: proxies.protocol,
        host: proxies.host,
        port: proxies.port,
        username: proxies.username,
        country: proxies.country,
        kind: proxies.kind
      }).from(proxies).all(),
      browserProfiles: db2.select().from(browserProfiles).all()
    };
    node_fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), "utf8");
    return { path: res.filePath };
  }
};
const plainMapper = (sc, durationSec, bible) => ({
  label: sc.label || null,
  voiceover: sc.line.trim(),
  durationSec,
  mediaPrompt: composeShotPrompt(sc.shot, bible),
  searchQuery: sc.searchQuery.trim() || null
});
function renumber(projectId) {
  const db2 = getDb();
  const rows = db2.select({ id: videoScenes.id }).from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, projectId)).orderBy(drizzleOrm.asc(videoScenes.act), drizzleOrm.asc(videoScenes.position)).all();
  rows.forEach((r, i) => db2.update(videoScenes).set({ position: i }).where(drizzleOrm.eq(videoScenes.id, r.id)).run());
}
async function writeAct(projectId, ctx, index, map = plainMapper) {
  const db2 = getDb();
  const p = db2.select({ acts: videoProjects.acts, bible: videoProjects.visualBible }).from(videoProjects).where(drizzleOrm.eq(videoProjects.id, projectId)).get();
  if (!p) throw notFound("dự án video");
  const acts = p.acts ?? [];
  if (!acts[index]) throw new AiError("bad_request", `Dự án chưa có dàn ý hồi ${index + 1} – bấm "Sinh kịch bản" để AI viết dàn ý trước`);
  const previousTail = index > 0 ? db2.select({ label: videoScenes.label, voiceover: videoScenes.voiceover }).from(videoScenes).where(drizzleOrm.and(drizzleOrm.eq(videoScenes.projectId, projectId), drizzleOrm.eq(videoScenes.act, index - 1))).orderBy(drizzleOrm.asc(videoScenes.position)).all().slice(-3).map((s) => `${s.label ? `${s.label}: ` : ""}${s.voiceover}`) : [];
  const bible = ctx.bible ?? p.bible ?? null;
  const { scenes, meta: meta2 } = await writeActScenes({ ...ctx, bible }, acts, index, previousTail);
  const durations = fitDurations(
    scenes.map((s) => s.durationSec),
    acts[index].targetSec
  );
  db2.transaction((tx) => {
    tx.delete(videoScenes).where(drizzleOrm.and(drizzleOrm.eq(videoScenes.projectId, projectId), drizzleOrm.eq(videoScenes.act, index))).run();
    tx.insert(videoScenes).values(scenes.map((sc, i) => ({ id: newId(), projectId, act: index, position: 1e5 + i, mediaSource: "stock", ...map(sc, durations[i], bible) }))).run();
    tx.update(videoProjects).set({ status: "scripted", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, projectId)).run();
  });
  renumber(projectId);
  return meta2;
}
async function writeLongScript(projectId, ctx, map = plainMapper) {
  const db2 = getDb();
  const { acts, bible, meta: m0 } = await outlineActs(ctx);
  db2.transaction((tx) => {
    tx.delete(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, projectId)).run();
    tx.update(videoProjects).set({ acts, visualBible: bible, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, projectId)).run();
  });
  console.info(`[ai] video dài: dàn ý ${acts.length} hồi · ${ctx.totalSec}s`);
  let cost = m0.costUsd;
  let last = m0;
  for (let i = 0; i < acts.length; i++) {
    try {
      const m = await writeAct(projectId, { ...ctx, bible }, i, map);
      last = m;
      cost = cost == null || m.costUsd == null ? null : cost + m.costUsd;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AiError(
        err instanceof AiError ? err.kind : "unknown",
        `Đã viết ${i}/${acts.length} hồi – hồi ${i + 1} lỗi: ${reason}. Bấm "Viết hồi này" ở hồi ${i + 1} để thử lại (các hồi trước được giữ nguyên).`
      );
    }
  }
  return { meta: { provider: last.providerLabel, model: last.model, costUsd: cost }, acts };
}
const framing = (a) => a === "16:9" ? "horizontal 16:9" : a === "1:1" ? "square 1:1" : "vertical 9:16";
const styleLine = (f) => f.style.trim() ? ` Visual style: ${f.style.trim()}.` : "";
const NO_TEXT = " No text, no captions, no logos, no watermark.";
function characterSheetPrompt(look, style) {
  return `Character reference sheet for a film, showing ONE person: ${look.trim()}. Layout side by side on a plain light-grey studio background: one full-body front view, then face close-ups from the front, three-quarter and profile angles. Identical face, hairstyle and outfit in every view, neutral expression, even soft lighting.` + (style.trim() ? ` Visual style: ${style.trim()}.` : "") + NO_TEXT;
}
function characterPrompt(f, a) {
  return characterSheetPrompt(a.description.trim() || a.name, f.style);
}
function locationPrompt(f, a) {
  return `Establishing wide shot of a film location, ${framing(f.aspect)} frame: ${a.description.trim() || a.name}. No people. Cinematic composition and lighting.${styleLine(f)}${NO_TEXT}`;
}
function shotPrompt(f, shot, chars, loc) {
  const refs = [];
  chars.forEach((c, i) => refs.push(`reference image ${i + 1} is the character sheet of ${c.name}`));
  if (loc) refs.push(`reference image ${chars.length + 1} is the location`);
  return [
    `Cinematic film still, ${framing(f.aspect)} frame.`,
    shot.camera.trim() ? `Camera: ${shot.camera.trim()}.` : "",
    `Action: ${shot.description.trim() || shot.summary}.`,
    loc ? `Location: ${loc.description.trim() || loc.name}.` : "",
    chars.length ? `Characters: ${chars.map((c) => `${c.name} – ${c.description.trim()}`).join("; ")}.` : "",
    refs.length ? `Use the attached references (${refs.join("; ")}): keep every character's face, hair and outfit exactly as in their sheet, and match the location.` : "",
    styleLine(f).trim(),
    "Natural poses, realistic proportions and hands." + NO_TEXT
  ].filter(Boolean).join(" ");
}
function parseDialogue(text) {
  return (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
    return m ? { speaker: m[1].trim(), line: m[2].trim() } : { speaker: null, line: l };
  });
}
function videoPrompt(f, shot, withAudio, chars = []) {
  const lang = dialogueLanguageEn(f.dialogueLanguage);
  const lines = lang ? parseDialogue(shot.dialogue) : [];
  const voiceOf2 = (name) => {
    const c = name ? chars.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase()) : void 0;
    return c?.voiceProfile?.trim() ? ` (voice: ${c.voiceProfile.trim()})` : "";
  };
  return [
    // Lời thoại đặt ĐẦU prompt (model bám phần đầu) – nói đúng câu, đúng ngôn ngữ, không tự chế lời
    withAudio && lines.length ? `Dialogue in ${lang}, lip-synced, spoken exactly as written: ${lines.map((d) => d.speaker ? `${d.speaker}${voiceOf2(d.speaker)} says "${d.line}"` : `"${d.line}"`).join("; ")}. No other speech${lang !== "English" ? ", no English" : ""}.` : "",
    `${shot.description.trim() || shot.summary}.`,
    shot.camera.trim() ? `Camera: ${shot.camera.trim()}.` : "",
    withAudio ? "Natural ambient sound and foley matching the scene, no background music." : "",
    "Keep every character, outfit and the location exactly as in the first frame; smooth, realistic motion.",
    styleLine(f).trim(),
    "No on-screen text, no subtitles, no watermark."
  ].filter(Boolean).join(" ");
}
const t = opt;
const nullable = (max) => opt(max).transform((s) => s || null);
const ScriptZ = zod.z.object({
  title: t(120),
  logline: t(400),
  style: t(400),
  characters: list(zod.z.object({ name: need(60), summary: t(300), look: t(600), voice: t(300) }), 0, 12).catch([]),
  locations: list(zod.z.object({ name: need(80), summary: t(300), look: t(600) }), 0, 20).catch([]),
  /** Series: nhân vật mới AI đề xuất (người dùng duyệt) – tối đa 3 */
  newCharacters: list(
    zod.z.object({ name: need(60), summary: t(300), look: t(600), voice: t(300), scope: zod.z.enum(["episode", "series"]).catch("episode"), reason: t(300) }),
    0,
    3
  ).catch([]),
  shots: list(
    zod.z.object({
      location: t(80),
      characters: list(need(60), 0, 6).catch([]),
      summary: t(400),
      action: t(600),
      camera: t(200),
      durationSec: num(3, 15, true).catch(6),
      dialogue: nullable(600),
      /** Phim bật phụ đề tiếng Việt: bản dịch lời thoại */
      subtitle: nullable(600)
    }),
    1,
    80
  )
});
function seriesBrief(ctx) {
  return {
    system: [
      "ĐÂY LÀ MỘT TẬP CỦA SERIES – DÀN NHÂN VẬT CỐ ĐỊNH:",
      '- "characters" CHỈ được chứa nhân vật trong dàn đã cho, ĐÚNG tên, "look" và "voice" CHÉP NGUYÊN VĂN mô tả đã cho (không đổi ngoại hình, giọng); nhân vật chưa có voice → viết voice mới.',
      '- Chỉ đưa vào "characters" những nhân vật thật sự xuất hiện trong tập này.',
      '- Cần người mới (vai phụ, người qua đường, nhân vật mới) → KHÔNG đưa vào "characters" mà đưa vào "newCharacters" (tối đa 3): {"name","summary","look","voice","scope","reason"}.',
      '  scope = "episode" nếu chỉ xuất hiện trong tập này; "series" nếu nên xuất hiện lặp lại ở các tập sau. reason: vì sao cần (tiếng Việt).',
      '- Trong "shots"."characters" được dùng tên trong dàn nhân vật và tên trong "newCharacters".',
      "- Hành động, thoại phải hợp với tuyến phát triển của nhân vật ở thời điểm tập này và nối mạch các tập trước.",
      ctx.castIsLarge ? "- Dàn nhân vật đã đông: ƯU TIÊN dùng lại nhân vật có sẵn, chỉ đề xuất người mới khi thật cần." : "",
      ctx.locations.length ? '- BỐI CẢNH ĐÃ CÓ của series: cảnh nào diễn ra ở một nơi đã có (vd phòng trọ, quán cà phê của nhân vật) thì "locations" dùng ĐÚNG tên đó (giữ nguyên chữ) và chép nguyên "look" – app lấy lại ảnh bối cảnh cũ để các tập giống nhau. Chỉ tạo bối cảnh mới khi là nơi khác thật sự.' : ""
    ].filter(Boolean),
    prompt: [
      `Series: ${ctx.seriesTitle}${ctx.logline ? ` – ${ctx.logline}` : ""}`,
      `Tập ${ctx.episode.number}: ${ctx.episode.title}`,
      ctx.previous.length ? `Các tập trước:
${ctx.previous.map((e) => `- Tập ${e.number} "${e.title}": ${e.synopsis.slice(0, 200)}`).join("\n")}` : "",
      ctx.cast.length ? `Dàn nhân vật (look, voice tiếng Anh – chép nguyên văn):
${ctx.cast.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: look="${c.look}"${c.voice ? ` voice="${c.voice}"` : ""}${c.arc ? ` | tuyến: ${c.arc}` : ""}`).join("\n")}` : 'Series chưa có nhân vật – đề xuất nhân vật cần thiết trong "newCharacters" (scope "series" cho nhân vật chính).',
      ctx.locations.length ? `Bối cảnh đã có ở các tập khác (tên – mô tả; look tiếng Anh chép nguyên văn):
${ctx.locations.map((l) => `- ${l.name}: ${l.summary.slice(0, 160)} | look="${l.look}"`).join("\n")}` : ""
    ].filter(Boolean)
  };
}
async function writeFilmScript(f, series2 = null) {
  const shots = Math.max(3, Math.min(60, Math.round(f.targetSec / 6)));
  const lang = dialogueLanguageEn(f.dialogueLanguage);
  const subVi = wantsVietnameseSubtitle(f);
  const system = [
    "Bạn là biên kịch kiêm đạo diễn hình ảnh cho phim ngắn làm bằng AI (ảnh → video từng cảnh quay 4–15 giây).",
    "Trả về DUY NHẤT một JSON đúng cấu trúc:",
    '{"title","logline","style","characters":[{"name","summary","look","voice"}],"locations":[{"name","summary","look"}],',
    `"shots":[{"location","characters":[tên],"summary","action","camera","durationSec","dialogue"${subVi ? ',"subtitle"' : ""}}]}`,
    "Quy tắc:",
    "- title, logline, summary: tiếng Việt. style, look, action, camera: TIẾNG ANH (dùng làm prompt sinh ảnh/video).",
    '- style: một câu từ khóa phong cách chung cho cả phim (thể loại, tông màu, ống kính, chất liệu phim), vd "cinematic 35mm film, teal and orange grade, shallow depth of field".',
    "- look của nhân vật: ngoại hình CỐ ĐỊNH và cụ thể (tuổi, giới tính, dân tộc, khuôn mặt, tóc, vóc dáng, trang phục chính, màu sắc) – không nhắc bối cảnh hay hành động.",
    "- look của bối cảnh: không gian, kiến trúc, đồ vật, thời điểm trong ngày, ánh sáng – không có người.",
    `- voice của nhân vật: hồ sơ giọng CỐ ĐỊNH bằng TIẾNG ANH, ngắn gọn (giới tính, độ tuổi, cao độ, chất giọng, tốc độ, cảm xúc thường trực${lang === "Vietnamese" ? ", giọng vùng miền: Northern / Central / Southern Vietnamese accent" : ""}), vd "young adult female, soft warm mid-pitch voice, calm pace${lang === "Vietnamese" ? ", Northern Vietnamese accent" : ""}". Mỗi nhân vật một giọng dễ phân biệt.`,
    "- Ưu tiên MỖI CẢNH QUAY CHỈ MỘT NGƯỜI NÓI (đối thoại thì tách thành các cảnh quay nối nhau) – để giọng từng nhân vật giữ đúng khi hậu kỳ.",
    '- Mỗi cảnh quay một hành động rõ ràng nhìn thấy được; "location" và "characters" phải dùng ĐÚNG tên đã khai báo.',
    '- camera: cỡ cảnh + góc + chuyển động máy, vd "medium close-up, low angle, slow dolly in".',
    lang ? `- dialogue: lời thoại của cảnh viết bằng ${f.dialogueLanguage} (ngôn ngữ thoại của phim: ${lang}; ghi "Tên: lời", mỗi người một dòng) hoặc null nếu không có.` : "- Phim KHÔNG THOẠI: dialogue luôn là null; kể chuyện bằng hành động, biểu cảm, âm thanh.",
    subVi ? `- subtitle: phụ đề TIẾNG VIỆT CÓ DẤU của dialogue – dịch tự nhiên, ngắn gọn, chỉ lời nói (KHÔNG ghi tên người nói), nhiều câu nối bằng dấu cách; null khi dialogue null.` : "",
    "- Không dùng người thật / người nổi tiếng, không nội dung bạo lực máu me hay tình dục.",
    ...series2 ? seriesBrief(series2).system : []
  ].join("\n");
  const prompt = [
    ...series2 ? seriesBrief(series2).prompt : [],
    f.genre?.trim() ? `Thể loại: ${f.genre.trim()}` : "",
    f.notes?.trim() ? `Ghi chú của đạo diễn (tuân theo): ${f.notes.trim()}` : "",
    `Ý tưởng phim: ${f.idea.trim()}`,
    f.style.trim() ? `Phong cách mong muốn: ${f.style.trim()}` : "",
    `Thời lượng mục tiêu: ${f.targetSec} giây → khoảng ${shots} cảnh quay (tổng durationSec ≈ ${f.targetSec}).`,
    `Khung hình: ${f.aspect}.`
  ].filter(Boolean).join("\n");
  const { data, meta: meta2 } = await aiJson(
    { system, prompt, json: true, maxTokens: Math.min(32768, 2e3 + shots * 260), temperature: 0.8 },
    { feature: "film.script", workspaceId: f.workspaceId },
    ScriptZ,
    // Thoại không phải tiếng Việt thì không kiểm tra dấu tiếng Việt cho phần thoại
    (d) => [d.logline, ...d.shots.flatMap((s) => [s.summary, isVietnameseDialogue(f.dialogueLanguage) ? s.dialogue ?? "" : "", subVi ? s.subtitle ?? "" : ""])]
  );
  return { script: data, model: meta2.model, costUsd: meta2.costUsd };
}
const wantsVietnameseSubtitle = (f) => f.subtitleVi && canVietnameseSubtitle(f.dialogueLanguage);
const SubtitleZ = zod.z.object({ items: list(zod.z.object({ id: need(80), vi: t(800) }), 0, 500).catch([]) });
async function translateSubtitles(f, items) {
  const out = /* @__PURE__ */ new Map();
  if (!items.length) return out;
  const system = [
    "Bạn là biên dịch phụ đề phim. Dịch lời thoại từng cảnh sang TIẾNG VIỆT CÓ DẤU, tự nhiên như phụ đề phim, ngắn gọn, giữ sắc thái.",
    'Lời thoại dạng "Tên: lời" – CHỈ dịch phần lời, KHÔNG ghi tên người nói; nhiều câu nối bằng dấu cách.',
    'Trả về DUY NHẤT JSON: {"items":[{"id","vi"}]} – đủ mọi id, đúng id đã cho.'
  ].join("\n");
  const prompt = [`Phim: ${f.title}`, `Ngôn ngữ thoại: ${f.dialogueLanguage}`, JSON.stringify(items.map((x) => ({ id: x.id, dialogue: x.dialogue })))].join("\n");
  const { data } = await aiJson(
    { system, prompt, json: true, maxTokens: Math.min(16e3, 500 + items.length * 200), temperature: 0.3 },
    { feature: "film.subtitle", workspaceId: f.workspaceId },
    SubtitleZ,
    (d) => d.items.map((x) => x.vi)
  );
  for (const x of data.items) if (x.vi.trim() && items.some((i) => i.id === x.id)) out.set(x.id, x.vi.trim());
  return out;
}
const STS_MODEL = "eleven_multilingual_sts_v2";
async function convertVoice(o) {
  const dir = cacheDir("voice-sts");
  const key2 = hashOf(o.clip, String(node_fs.statSync(o.clip).size), o.voiceId, STS_MODEL);
  const out = node_path.join(dir, `${key2}.mp3`);
  if (node_fs.existsSync(out)) return out;
  const src = node_path.join(dir, `${key2}-src.mp3`);
  await runFfmpeg(["-y", "-loglevel", "error", "-i", o.clip, "-vn", "-ac", "1", "-ar", "44100", "-b:a", "128k", src], { signal: o.signal });
  const { key: apiKey, baseUrl, row } = requireKey("elevenlabs");
  const base = (baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const form = new FormData();
  form.append("audio", new Blob([node_fs.readFileSync(src)], { type: "audio/mpeg" }), "clip.mp3");
  form.append("model_id", STS_MODEL);
  form.append("remove_background_noise", "true");
  const res = await fetch(`${base}/v1/speech-to-speech/${encodeURIComponent(o.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal: o.signal
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(
      res.status === 401 ? "Key ElevenLabs không hợp lệ" : res.status === 404 ? "Không tìm thấy giọng ElevenLabs của nhân vật (voice id sai hoặc đã xóa)" : res.status === 429 ? "ElevenLabs đang giới hạn tần suất – thử lại sau" : `ElevenLabs đổi giọng lỗi HTTP ${res.status}${text ? `: ${text}` : ""}`
    );
  }
  node_fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  recordUsage$1(row.id, o.workspaceId, STS_MODEL, "film.voice", 0);
  return out;
}
function dubVoiceOf(c, vietnamese) {
  if (c?.voiceProvider && (c.voiceId || c.voiceProvider === "edge_tts")) return { provider: c.voiceProvider, voiceId: c.voiceId, fallback: false };
  if (!vietnamese) return null;
  const female = /\b(female|woman|girl|lady)\b/i.test(c?.voiceProfile ?? "") || /\b(she|her)\b/i.test(c?.description ?? "");
  return { provider: "edge_tts", voiceId: female ? EDGE_VOICES$1[0].id : EDGE_VOICES$1[1].id, fallback: true };
}
async function ttsLine(provider, voiceId, text, workspaceId, signal) {
  const dir = node_path.join(cacheDir("tts"), hashOf("film-dub", provider, voiceId ?? "", text));
  const meta2 = node_path.join(dir, "result.json");
  if (node_fs.existsSync(meta2)) {
    try {
      const f = node_path.join(dir, JSON.parse(node_fs.readFileSync(meta2, "utf8")).name);
      if (node_fs.existsSync(f)) return f;
    } catch {
    }
  }
  node_fs.mkdirSync(dir, { recursive: true });
  const r = await synthesize({ provider, voiceId, text, dir, workspaceId, signal });
  node_fs.writeFileSync(meta2, JSON.stringify({ name: r.file.split(/[\\/]/).pop() }));
  return r.file;
}
async function dubLines(o) {
  const files = [];
  for (const l of o.lines) {
    const v = o.voiceFor(l.speaker);
    if (!v) continue;
    files.push(await ttsLine(v.provider, v.voiceId, l.line, o.workspaceId, o.signal));
  }
  if (!files.length) return null;
  const inputs = files.flatMap((f) => ["-i", f]);
  const parts = files.map((_f, i) => `[${i}:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,apad=pad_dur=0.2[p${i}]`);
  const filter = `${parts.join(";")};${files.map((_f, i) => `[p${i}]`).join("")}concat=n=${files.length}:v=0:a=1[out]`;
  await runFfmpeg(["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[out]", "-c:a", "pcm_s16le", o.out], { signal: o.signal });
  return { file: o.out, durationSec: await probeDuration(o.out) };
}
const FPS = 30;
const SAMPLE_RATE = 44100;
const SAMPLES_PER_FRAME = SAMPLE_RATE / FPS;
const FADE_SEC = 0.35;
const jobs = /* @__PURE__ */ new Map();
function assembleStatus(filmId) {
  const j = jobs.get(filmId);
  if (!j) return { running: false, progress: 0, stage: "", error: null, output: null, notes: [] };
  const { ctrl: _c, ...rest } = j;
  return rest;
}
function cancelAssemble(filmId) {
  jobs.get(filmId)?.ctrl?.abort();
}
const rel$1 = (abs) => node_path.relative(mediaDir(), abs).split("\\").join("/");
const concatLine = (file2) => `file '${file2.split("\\").join("/").split("'").join("'\\''")}'`;
const rendersDir = (filmId) => node_path.join(filmDir(filmId), "renders");
function listRenders(filmId) {
  const dir = rendersDir(filmId);
  if (!node_fs.existsSync(dir)) return [];
  return node_fs.readdirSync(dir).filter((f) => f.endsWith(".mp4")).map((f) => {
    const abs = node_path.join(dir, f);
    const st = node_fs.statSync(abs);
    const thumb = abs.replace(/\.mp4$/, ".jpg");
    return { file: rel$1(abs), thumbnail: node_fs.existsSync(thumb) ? rel$1(thumb) : null, sizeBytes: st.size, createdAt: st.mtime };
  }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
function startAssemble(filmId, opts) {
  if (jobs.get(filmId)?.running) throw new Error("Phim đang được ghép");
  const ctrl = new AbortController();
  const job = { running: true, progress: 0, stage: "Chuẩn bị", error: null, output: null, notes: [], ctrl };
  jobs.set(filmId, job);
  assemble(filmId, opts, ctrl.signal, (p, stage2) => (job.progress = p, stage2 && (job.stage = stage2)), (n) => job.notes.push(n)).then((out) => {
    job.output = out;
    job.stage = "Xong";
    job.progress = 1;
    markEpisodeRendered(filmId);
  }).catch((err) => {
    job.error = ctrl.signal.aborted ? "Đã hủy" : err instanceof Error ? err.message : String(err);
    console.error("[film] ghép tập lỗi", err);
  }).finally(() => job.running = false);
}
async function assemble(filmId, opts, signal, progress2, note) {
  const db2 = getDb();
  const film = db2.select().from(filmProjects).where(drizzleOrm.eq(filmProjects.id, filmId)).get();
  if (!film) throw new Error("Không tìm thấy phim");
  const shots = db2.select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.filmId, filmId), drizzleOrm.eq(filmAssets.kind, "shot"))).orderBy(drizzleOrm.asc(filmAssets.position)).all();
  const takes = new Map(
    db2.select().from(filmTakes).where(drizzleOrm.and(drizzleOrm.eq(filmTakes.filmId, filmId), drizzleOrm.eq(filmTakes.status, "done"), drizzleOrm.eq(filmTakes.kind, "video"))).all().map((t2) => [t2.id, t2])
  );
  const clips = [];
  for (const s of shots) {
    const t2 = s.selectedVideoTakeId ? takes.get(s.selectedVideoTakeId) : void 0;
    const file2 = t2?.file ? node_path.join(mediaDir(), t2.file) : null;
    if (file2 && node_fs.existsSync(file2)) clips.push({ shot: s, file: file2 });
  }
  const missing = shots.length - clips.length;
  if (!clips.length) throw new Error("Chưa có cảnh nào có video đã chọn – tạo video ở bước Video trước");
  if (missing) note(`Bỏ qua ${missing} cảnh chưa có video đã chọn`);
  const { w: W, h: H } = ASPECT_SIZE[film.aspect];
  const jobDir = node_path.join(filmDir(filmId), "assemble-tmp");
  node_fs.rmSync(jobDir, { recursive: true, force: true });
  node_fs.mkdirSync(jobDir, { recursive: true });
  if (opts.subtitleStyle !== "none") {
    node_fs.mkdirSync(node_path.join(jobDir, "fonts"), { recursive: true });
    node_fs.copyFileSync(node_path.join(fontsDir(), "Montserrat-Black.ttf"), node_path.join(jobDir, "fonts", "Montserrat-Black.ttf"));
  }
  const n = clips.length;
  const durations = [];
  for (const c of clips) {
    const clipSec = await probeDuration(c.file).catch(() => c.shot.durationSec);
    durations.push(Math.max(1, Math.min(c.shot.durationSec, clipSec)));
  }
  const frames = durations.map((d) => Math.max(1, Math.round(d * FPS)));
  const total2 = frames.reduce((a, f) => a + f, 0) / FPS;
  const fade = opts.transition === "fade_black";
  const viSubs = opts.subtitleStyle !== "none" && wantsVietnameseSubtitle(film) ? await vietnameseSubtitles(film, clips.map((c) => c.shot), progress2, note) : null;
  let encoder = await currentEncoder();
  const segs = [];
  for (let i = 0; i < n; i++) {
    if (signal.aborted) throw new Error("Đã hủy");
    const base = i / n * 0.8;
    const stage2 = `Dựng cảnh ${i + 1}/${n} (${encoderLabel[encoder]})`;
    progress2(base, stage2);
    const d = frames[i] / FPS;
    const subText = viSubs ? viSubs.get(clips[i].shot.id) ?? "" : parseDialogue(clips[i].shot.dialogue).map((x) => x.line).join(" ");
    const subName = opts.subtitleStyle !== "none" && subText.trim() ? `sub-${i}.ass` : null;
    if (subName)
      node_fs.writeFileSync(node_path.join(jobDir, subName), buildAss([{ start: 0, duration: d, text: subText, words: null, audioDuration: Math.max(0.5, d - 0.3) }], opts.subtitleStyle, { w: W, h: H }), "utf8");
    const vf = [
      `scale=${W}:${H}:force_original_aspect_ratio=increase`,
      `crop=${W}:${H}`,
      `fps=${FPS}`,
      "setsar=1",
      `trim=duration=${d.toFixed(3)}`,
      "setpts=PTS-STARTPTS",
      ...subName ? [`subtitles=${subName}:fontsdir=fonts`] : [],
      ...fade && i > 0 ? [`fade=t=in:st=0:d=${FADE_SEC}`] : [],
      ...fade && i < n - 1 ? [`fade=t=out:st=${(d - FADE_SEC).toFixed(3)}:d=${FADE_SEC}`] : [],
      "format=yuv420p"
    ].join(",");
    const seg = node_path.join(jobDir, `seg-${i}.mp4`);
    const encode = (enc) => runFfmpeg(
      ["-loglevel", "error", "-i", clips[i].file, "-an", "-vf", vf, ...encoderArgs(enc), "-r", String(FPS), "-frames:v", String(frames[i]), "-video_track_timescale", "15360", seg],
      { cwd: jobDir, signal, totalSec: d, onProgress: (r) => progress2(base + r * 0.8 / n, stage2) }
    );
    try {
      await encode(encoder);
    } catch (err) {
      if (signal.aborted || encoder === "libx264") throw err;
      note(`${encoderLabel[encoder]} lỗi → chuyển sang CPU libx264`);
      encoder = "libx264";
      segs.length = 0;
      i = -1;
      continue;
    }
    segs.push(seg);
  }
  progress2(0.82, "Chuẩn bị âm thanh");
  const chars = db2.select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.filmId, filmId), drizzleOrm.eq(filmAssets.kind, "character"))).all();
  const charByName = (name) => name ? chars.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()) : void 0;
  const vietnamese = isVietnameseDialogue(film.dialogueLanguage);
  const voiceNotes = /* @__PURE__ */ new Map();
  const vnote = (msg) => void voiceNotes.set(msg, (voiceNotes.get(msg) ?? 0) + 1);
  let converted = 0;
  let dubbed = 0;
  const wavs = [];
  for (let i = 0; i < n; i++) {
    if (signal.aborted) throw new Error("Đã hủy");
    const samples = frames[i] * SAMPLES_PER_FRAME;
    const sceneSec = frames[i] / FPS;
    const out2 = node_path.join(jobDir, `a-${i}.wav`);
    const hasClipAudio = await hasAudioStream(clips[i].file).catch(() => false);
    const lines = parseDialogue(clips[i].shot.dialogue);
    let voice = null;
    let voiceSec = 0;
    if (film.voiceMode === "convert" && lines.length && hasClipAudio) {
      progress2(0.82 + i / n * 0.03, `Đổi giọng nhân vật cảnh ${i + 1}/${n}`);
      const speakers = [...new Set(lines.map((l) => l.speaker?.trim().toLowerCase()).filter(Boolean))];
      const c = speakers.length === 1 ? charByName(speakers[0]) : void 0;
      if (speakers.length !== 1) vnote("cảnh có nhiều người nói (hoặc không ghi tên người nói) → giữ giọng gốc của clip");
      else if (c?.voiceProvider !== "elevenlabs" || !c.voiceId) vnote(`nhân vật "${c?.name ?? speakers[0]}" chưa chọn giọng ElevenLabs → giữ giọng gốc`);
      else {
        try {
          voice = await convertVoice({ clip: clips[i].file, voiceId: c.voiceId, workspaceId: film.workspaceId, signal });
          converted++;
        } catch (err) {
          if (signal.aborted) throw err;
          vnote(`đổi giọng lỗi (${err instanceof Error ? err.message : String(err)}) → giữ giọng gốc`);
        }
      }
    } else if (film.voiceMode === "dub" && lines.length) {
      progress2(0.82 + i / n * 0.03, `Lồng tiếng cảnh ${i + 1}/${n}`);
      try {
        const r = await dubLines({
          lines,
          voiceFor: (sp) => {
            const c = charByName(sp);
            const v = dubVoiceOf(c, vietnamese);
            if (!v) vnote(`"${sp ?? "người dẫn"}" chưa có giọng đọc → bỏ câu thoại`);
            else if (v.fallback) vnote(`"${c?.name ?? sp ?? "người dẫn"}" chưa chọn giọng đọc → dùng giọng Edge-TTS mặc định`);
            return v;
          },
          out: node_path.join(jobDir, `dub-${i}.wav`),
          workspaceId: film.workspaceId,
          signal
        });
        if (r) {
          voice = r.file;
          voiceSec = r.durationSec;
          dubbed++;
        }
      } catch (err) {
        if (signal.aborted) throw err;
        vnote(`lồng tiếng lỗi (${err instanceof Error ? err.message : String(err)}) → giữ tiếng clip`);
      }
    }
    const useClip = !voice && opts.clipAudio && hasClipAudio;
    const tempo = voice && voiceSec > sceneSec - 0.1 ? Math.min(1.35, voiceSec / Math.max(0.5, sceneSec - 0.1)) : 1;
    if (tempo >= 1.35 && voiceSec / Math.max(0.5, sceneSec - 0.1) > 1.35) vnote("lời thoại dài hơn cảnh → bị cắt bớt cuối câu (nên tăng thời lượng cảnh)");
    const af = [
      `aresample=${SAMPLE_RATE}`,
      "aformat=sample_fmts=s16:channel_layouts=stereo",
      ...tempo > 1.01 ? [`atempo=${tempo.toFixed(3)}`] : [],
      ...useClip ? [`volume=${opts.clipVolume.toFixed(2)}`] : [],
      `apad=whole_len=${samples}`,
      `atrim=end_sample=${samples}`,
      ...fade && i > 0 ? ["afade=t=in:st=0:d=0.2"] : [],
      ...fade && i < n - 1 ? [`afade=t=out:st=${(frames[i] / FPS - 0.2).toFixed(3)}:d=0.2`] : []
    ].join(",");
    const input = voice ? ["-i", voice] : useClip ? ["-i", clips[i].file, "-vn"] : ["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`];
    await runFfmpeg(["-loglevel", "error", ...input, "-af", af, "-c:a", "pcm_s16le", "-ar", String(SAMPLE_RATE), "-ac", "2", out2], { signal });
    wavs.push(out2);
  }
  if (converted) note(`Đổi giọng nhân vật (ElevenLabs) cho ${converted} cảnh – tiếng động nền của clip ở các cảnh này được bỏ`);
  if (dubbed) note(`Lồng tiếng ${dubbed} cảnh bằng giọng đọc của nhân vật`);
  for (const [msg, count] of voiceNotes) note(`${count} cảnh: ${msg}`);
  node_fs.writeFileSync(node_path.join(jobDir, "video.txt"), segs.map(concatLine).join("\n") + "\n", "utf8");
  node_fs.writeFileSync(node_path.join(jobDir, "audio.txt"), wavs.map(concatLine).join("\n") + "\n", "utf8");
  const bgm = opts.bgmTrack ? node_path.join(mediaDir(), "bgm", opts.bgmTrack) : null;
  const hasBgm = !!bgm && node_fs.existsSync(bgm);
  if (opts.bgmTrack && !hasBgm) note(`Không tìm thấy nhạc nền "${opts.bgmTrack}" – xuất không nhạc nền`);
  const inputs = ["-f", "concat", "-safe", "0", "-i", "video.txt", "-f", "concat", "-safe", "0", "-i", "audio.txt"];
  const filters = [];
  if (hasBgm) {
    inputs.push("-stream_loop", "-1", "-i", bgm);
    filters.push(
      `[2:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${opts.bgmVolume.toFixed(2)},atrim=0:${total2.toFixed(3)},afade=t=out:st=${Math.max(0, total2 - 2).toFixed(3)}:d=2[bg]`,
      "[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vo1][vo2]",
      "[bg][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[bgd]",
      "[vo2][bgd]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]"
    );
  } else filters.push("[1:a]alimiter=limit=0.95[aout]");
  const tmp = node_path.join(jobDir, "out.mp4");
  await runFfmpeg(
    [
      "-loglevel",
      "error",
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      String(SAMPLE_RATE),
      "-t",
      total2.toFixed(3),
      "-movflags",
      "+faststart",
      tmp
    ],
    { cwd: jobDir, signal, totalSec: total2, onProgress: (r) => progress2(0.85 + r * 0.12, "Nối các cảnh & trộn âm thanh") }
  );
  const dir = rendersDir(filmId);
  node_fs.mkdirSync(dir, { recursive: true });
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const out = node_path.join(dir, `${stamp}.mp4`);
  node_fs.renameSync(tmp, out);
  await runFfmpeg(["-loglevel", "error", "-ss", Math.min(1, total2 / 2).toFixed(2), "-i", out, "-frames:v", "1", "-vf", `scale=${W >= H ? 960 : 540}:-1`, "-q:v", "3", out.replace(/\.mp4$/, ".jpg")], { signal });
  node_fs.rmSync(jobDir, { recursive: true, force: true });
  db2.insert(activityLog).values({ level: "ok", scope: "render", message: `Ghép xong phim "${film.title.slice(0, 60)}" (${n} cảnh, ${total2.toFixed(1)}s, ${encoderLabel[encoder]})` }).run();
  return rel$1(out);
}
async function vietnameseSubtitles(film, shots, progress2, note) {
  const out = /* @__PURE__ */ new Map();
  const todo = [];
  for (const s of shots) {
    const dialogue = s.dialogue?.trim();
    if (!dialogue) continue;
    if (s.subtitle?.trim() && s.subtitleSrc === dialogue) out.set(s.id, s.subtitle.trim());
    else todo.push({ id: s.id, dialogue });
  }
  if (!todo.length) return out;
  progress2(0, `Dịch phụ đề tiếng Việt (${todo.length} cảnh)`);
  try {
    const done = await translateSubtitles(film, todo);
    const db2 = getDb();
    for (const t2 of todo) {
      const vi = done.get(t2.id);
      if (!vi) continue;
      out.set(t2.id, vi);
      db2.update(filmAssets).set({ subtitle: vi, subtitleSrc: t2.dialogue }).where(drizzleOrm.eq(filmAssets.id, t2.id)).run();
    }
    note(`Dịch phụ đề tiếng Việt cho ${done.size} cảnh – xem / sửa ở ô "Phụ đề tiếng Việt" của từng cảnh`);
    if (done.size < todo.length) note(`${todo.length - done.size} cảnh chưa dịch được phụ đề → không có phụ đề`);
  } catch (err) {
    note(`Không dịch được phụ đề tiếng Việt (${err instanceof Error ? err.message : String(err)}) → ${todo.length} cảnh không có phụ đề`);
  }
  return out;
}
async function renderToContent(filmId, file2) {
  const db2 = getDb();
  const film = db2.select().from(filmProjects).where(drizzleOrm.eq(filmProjects.id, filmId)).get();
  if (!film) throw new Error("Không tìm thấy phim");
  const abs = node_path.join(mediaDir(), file2);
  if (!abs.startsWith(rendersDir(filmId)) || !node_fs.existsSync(abs)) throw new Error("Không tìm thấy file video");
  const thumb = file2.replace(/\.mp4$/, ".jpg");
  const durationSec = await probeDuration(abs).catch(() => null);
  const id2 = newId();
  db2.insert(contentItems).values({
    id: id2,
    workspaceId: film.workspaceId,
    kind: "video",
    title: film.title.slice(0, 300),
    caption: film.logline ?? null,
    aspect: film.aspect,
    durationSec: durationSec == null ? null : Math.round(durationSec * 10) / 10,
    source: "film",
    mediaPaths: [file2],
    thumbnailPath: node_fs.existsSync(node_path.join(mediaDir(), thumb)) ? thumb : null,
    status: "ready"
  }).run();
  return id2;
}
const EDGE_VOICES = { female: "vi-VN-HoaiMyNeural", male: "vi-VN-NamMinhNeural" };
const GENDER_VOICES = {
  edge_tts: EDGE_VOICES,
  google_tts: { female: "Kore", male: "Puck" },
  openai_tts: { female: "nova", male: "onyx" }
};
const meta$2 = (r) => ({ provider: r.providerLabel, model: r.model, costUsd: r.costUsd });
const rel = (abs) => abs.startsWith(mediaDir()) ? abs.slice(mediaDir().length + 1).replace(/\\/g, "/") : abs;
function brandVoiceOf$1(workspaceId) {
  return workspaceId ? getDb().select({ v: workspaces.brandVoice }).from(workspaces).where(drizzleOrm.eq(workspaces.id, workspaceId)).get()?.v ?? null : null;
}
function seriesRow(id2) {
  const s = getDb().select().from(series).where(drizzleOrm.eq(series.id, id2)).get();
  if (!s) throw notFound("series");
  return s;
}
function detail$1(id2) {
  const db2 = getDb();
  const s = seriesRow(id2);
  const characters = db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, id2)).orderBy(drizzleOrm.asc(seriesCharacters.sortOrder), drizzleOrm.asc(seriesCharacters.createdAt)).all();
  const eps = db2.select().from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.seriesId, id2)).orderBy(drizzleOrm.asc(seriesEpisodes.number)).all();
  const projectIds = eps.map((e) => e.projectId).filter((x) => !!x);
  const projects = projectIds.length ? db2.select({ id: videoProjects.id, status: videoProjects.status, contentItemId: videoProjects.contentItemId }).from(videoProjects).where(drizzleOrm.inArray(videoProjects.id, projectIds)).all() : [];
  const contentIds = projects.map((p) => p.contentItemId).filter((x) => !!x);
  const contents = contentIds.length ? db2.select({ id: contentItems.id, status: contentItems.status }).from(contentItems).where(drizzleOrm.inArray(contentItems.id, contentIds)).all() : [];
  const films = filmProgress(
    eps.map((e) => e.filmId).filter((x) => !!x),
    (fid) => listRenders(fid).length
  );
  return {
    ...s,
    characters,
    // Đã có tập được sản xuất (dự án Xưởng Video hoặc phim) → không đổi kiểu sản xuất được nữa
    productionLocked: eps.some((e) => e.projectId || e.filmId && films.has(e.filmId)),
    episodes: eps.map((e) => {
      const p = projects.find((x) => x.id === e.projectId);
      const c = contents.find((x) => x.id === p?.contentItemId);
      const film = e.filmId ? films.get(e.filmId) ?? null : null;
      const status2 = film ? e.status === "planned" ? "scripted" : e.status : c?.status === "published" ? "published" : p?.status === "rendered" ? "rendered" : p ? "scripted" : e.projectId ? e.status : "planned";
      return { ...e, status: status2, projectStatus: p?.status ?? null, film };
    })
  };
}
function promptKey(c, s) {
  return node_crypto.createHash("sha256").update([c.name, c.role ?? "", c.appearance, c.personality ?? "", s.title, s.genre ?? "", s.visualStyle ?? ""].join("|")).digest("hex").slice(0, 16);
}
async function ensureCharacterPrompt(id2, force = false) {
  const db2 = getDb();
  const c = db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.id, id2)).get();
  if (!c) throw notFound("nhân vật");
  const s = seriesRow(c.seriesId);
  const key2 = promptKey(c, s);
  if (!force && c.imagePrompt && c.appearanceEn && c.imagePromptFor === key2) return c;
  const keepManual = !force && c.promptManual && !!c.imagePrompt;
  const channel = s.targetChannelId ? db2.select({ workspaceId: channels.workspaceId }).from(channels).where(drizzleOrm.eq(channels.id, s.targetChannelId)).get() : void 0;
  const r = await characterImagePrompt({
    seriesTitle: s.title,
    genre: s.genre,
    visualStyle: s.visualStyle,
    name: c.name,
    role: c.role,
    appearance: c.appearance,
    personality: c.personality,
    workspaceId: s.workspaceId ?? channel?.workspaceId ?? null
  });
  console.info(`[series] tạo prompt ảnh chuẩn cho nhân vật ${c.id.slice(0, 8)} (${r.meta.model})`);
  return db2.update(seriesCharacters).set({ imagePrompt: keepManual ? c.imagePrompt : r.imagePrompt, appearanceEn: r.appearanceEn, imagePromptFor: key2, promptManual: keepManual }).where(drizzleOrm.eq(seriesCharacters.id, id2)).returning().get();
}
async function ensureStyleEn(seriesId) {
  const s = seriesRow(seriesId);
  if (s.productionMode === "film") {
    const input = { genre: s.genre, visualStyle: s.visualStyle, notes: s.notes };
    const key2 = styleKey(input);
    if (!hasStyleInput(input) || s.visualStyleEn && s.visualStyleFor === key2) return;
    const en2 = await composeStyleEn(input, s.workspaceId);
    getDb().update(series).set({ visualStyleEn: en2, visualStyleFor: key2 }).where(drizzleOrm.eq(series.id, seriesId)).run();
    return;
  }
  const style = s.visualStyle?.trim() ?? "";
  if (!style || s.visualStyleEn && s.visualStyleFor === style) return;
  const en = /^[\x00-\x7F]*$/.test(style) ? style : await visualStyleKeywords(style, s.workspaceId);
  getDb().update(series).set({ visualStyleEn: en, visualStyleFor: style }).where(drizzleOrm.eq(series.id, seriesId)).run();
}
function episodeSetup(episodeId) {
  const db2 = getDb();
  const ep = db2.select().from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.id, episodeId)).get();
  if (!ep) throw notFound("tập phim");
  const s = seriesRow(ep.seriesId);
  const chars = db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, s.id)).orderBy(drizzleOrm.asc(seriesCharacters.sortOrder)).all();
  if (!chars.length) throw new ApiError("VALIDATION", 'Series chưa có nhân vật – bấm "AI phát triển series" hoặc thêm nhân vật trước');
  const previous = db2.select({ number: seriesEpisodes.number, title: seriesEpisodes.title, synopsis: seriesEpisodes.synopsis }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.seriesId, s.id)).orderBy(drizzleOrm.asc(seriesEpisodes.number)).all().filter((e) => e.number < ep.number).slice(-5);
  const channel = s.targetChannelId ? db2.select({ workspaceId: channels.workspaceId }).from(channels).where(drizzleOrm.eq(channels.id, s.targetChannelId)).get() : void 0;
  const workspaceId = s.workspaceId ?? channel?.workspaceId ?? null;
  const byName = (n) => chars.find((c) => c.name.trim().toLowerCase() === n.trim().toLowerCase());
  const style = s.visualStyleEn && s.visualStyleFor === s.visualStyle ? s.visualStyleEn : s.visualStyle;
  const bible = {
    style: style?.trim() || "cinematic, natural color grade, shallow depth of field",
    characters: chars.map((c) => ({ name: c.name, look: (c.appearanceEn || c.appearance || "").trim() || c.name })),
    product: null
  };
  const map = (sc, durationSec) => {
    const speaker2 = sc.speaker.toLowerCase() === "narrator" ? void 0 : byName(sc.speaker);
    const present = [.../* @__PURE__ */ new Set([...sc.shot.characters.map((n) => byName(n)?.name ?? n), ...speaker2 ? [speaker2.name] : []])];
    return {
      label: (speaker2 ? speaker2.name : sc.label || "Dẫn truyện").slice(0, 80),
      voiceover: sc.line.trim(),
      durationSec,
      mediaPrompt: composeShotPrompt({ ...sc.shot, characters: present }, bible),
      searchQuery: sc.searchQuery.trim() || null,
      speakerId: speaker2?.id ?? null,
      voiceId: speaker2?.voiceId ?? null
    };
  };
  return { ep, s, chars, previous, workspaceId, map, bible };
}
function episodeLongContext(episodeId, vertical) {
  const { ep, s, chars, previous, workspaceId, map, bible } = episodeSetup(episodeId);
  return {
    map,
    ctx: {
      kind: "episode",
      topic: `Series "${s.title}" – Tập ${ep.number}: ${ep.title}`,
      brief: [
        s.genre ? `Thể loại: ${s.genre}` : "",
        s.logline ? `Ý tưởng series: ${s.logline}` : "",
        previous.length ? `Các tập trước:
${previous.map((p) => `Tập ${p.number} – ${p.title}: ${p.synopsis}`).join("\n")}` : "",
        `Dàn ý tập này: ${ep.synopsis}`,
        ep.cliffhanger ? `Kết tập bằng tình huống treo: ${ep.cliffhanger}` : "Kết tập bằng một tình huống treo."
      ].filter(Boolean),
      characters: chars.map((c) => ({ name: c.name, role: c.role, personality: c.personality })),
      totalSec: s.episodeLengthSec,
      vertical,
      brandVoice: brandVoiceOf$1(workspaceId),
      workspaceId,
      bible
    }
  };
}
async function scriptEpisode(episodeId) {
  const db2 = getDb();
  const epRow = db2.select({ seriesId: seriesEpisodes.seriesId }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.id, episodeId)).get();
  if (epRow) {
    try {
      await ensureStyleEn(epRow.seriesId);
    } catch (err) {
      console.warn(`[series] không chuyển được phong cách hình sang tiếng Anh – dùng nguyên văn: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const ch of db2.select({ id: seriesCharacters.id }).from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, epRow.seriesId)).all()) {
      try {
        await ensureCharacterPrompt(ch.id);
      } catch (err) {
        console.warn(`[series] không tạo được prompt tiếng Anh cho nhân vật – dùng mô tả gốc: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const { ep, s, chars, previous, workspaceId, map, bible } = episodeSetup(episodeId);
  const long = isLongForm(s.episodeLengthSec);
  const ensureProject = () => {
    const values = {
      workspaceId,
      targetChannelId: s.targetChannelId,
      topic: `${s.title} – Tập ${ep.number}: ${ep.title}`.slice(0, 500),
      targetDurationSec: s.episodeLengthSec,
      ttsProvider: s.ttsProvider,
      voiceId: s.narratorVoiceId,
      renderMode: s.renderMode,
      format: "episode",
      updatedAt: /* @__PURE__ */ new Date()
    };
    const existing = ep.projectId ? db2.select({ id: videoProjects.id, aspect: videoProjects.aspect }).from(videoProjects).where(drizzleOrm.eq(videoProjects.id, ep.projectId)).get() : void 0;
    if (existing) {
      db2.update(videoProjects).set(values).where(drizzleOrm.eq(videoProjects.id, existing.id)).run();
      return existing;
    }
    const row = db2.insert(videoProjects).values({ id: newId(), ...values, aspect: long ? "16:9" : "9:16" }).returning({ id: videoProjects.id, aspect: videoProjects.aspect }).get();
    db2.update(seriesEpisodes).set({ projectId: row.id, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(seriesEpisodes.id, ep.id)).run();
    return row;
  };
  if (long) {
    const project2 = ensureProject();
    const { ctx } = episodeLongContext(ep.id, project2.aspect === "9:16");
    const { meta: m2 } = await writeLongScript(project2.id, ctx, map);
    db2.update(seriesEpisodes).set({ status: "scripted", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(seriesEpisodes.id, ep.id)).run();
    const count = db2.select({ id: videoScenes.id }).from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, project2.id)).all().length;
    return { projectId: project2.id, scenes: count, meta: m2 };
  }
  const { scenes, meta: m } = await writeEpisode({
    seriesTitle: s.title,
    logline: s.logline,
    genre: s.genre,
    characters: chars.map((c) => ({ name: c.name, role: c.role, personality: c.personality })),
    previous,
    episode: { number: ep.number, title: ep.title, synopsis: ep.synopsis, cliffhanger: ep.cliffhanger },
    lengthSec: s.episodeLengthSec,
    brandVoice: brandVoiceOf$1(workspaceId),
    workspaceId,
    bible
  });
  const durations = fitDurations(
    scenes.map((sc) => sc.durationSec),
    s.episodeLengthSec
  );
  const project = ensureProject();
  return db2.transaction((tx) => {
    tx.update(videoProjects).set({ status: "scripted", acts: null, visualBible: bible }).where(drizzleOrm.eq(videoProjects.id, project.id)).run();
    tx.delete(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, project.id)).run();
    tx.insert(videoScenes).values(
      scenes.map((sc, i) => ({
        id: newId(),
        projectId: project.id,
        position: i,
        mediaSource: "stock",
        ...map(sc, durations[i], bible)
      }))
    ).run();
    tx.update(seriesEpisodes).set({ projectId: project.id, status: "scripted", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(seriesEpisodes.id, ep.id)).run();
    return { projectId: project.id, scenes: scenes.length, meta: meta$2(m) };
  });
}
function episodeOfProject(projectId) {
  return getDb().select({ id: seriesEpisodes.id }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.projectId, projectId)).get()?.id ?? null;
}
const seriesHandlers = {
  "series.list": ({ workspaceId }) => {
    const db2 = getDb();
    const rows = db2.select().from(series).where(byWorkspace(series.workspaceId, workspaceId)).orderBy(drizzleOrm.asc(series.createdAt)).all();
    return rows.map((s) => ({
      ...s,
      episodeCount: db2.select({ id: seriesEpisodes.id }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.seriesId, s.id)).all().length,
      characterCount: db2.select({ id: seriesCharacters.id }).from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, s.id)).all().length
    }));
  },
  "series.get": ({ id: id2 }) => detail$1(id2),
  "series.create": (input) => getDb().insert(series).values({ id: newId(), ...input }).returning().get(),
  "series.update": ({ id: id2, patch }) => {
    if (patch.productionMode && patch.productionMode !== seriesRow(id2).productionMode && detail$1(id2).productionLocked)
      throw new ApiError("CONFLICT", "Series đã có tập được sản xuất – không đổi kiểu sản xuất được. Tạo series mới nếu muốn làm theo kiểu khác.");
    const row = getDb().update(series).set({ ...patch, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(series.id, id2)).returning().get();
    if (!row) throw notFound("series");
    return row;
  },
  /** Series kiểu Phim: tạo (hoặc mở) phim của tập – nhập dàn nhân vật kèm ảnh chuẩn */
  "series.makeFilm": async ({ episodeId }) => {
    const db2 = getDb();
    const ep = db2.select().from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.id, episodeId)).get();
    if (!ep) throw notFound("tập");
    const s = seriesRow(ep.seriesId);
    if (s.productionMode !== "film") throw new ApiError("VALIDATION", "Series này làm bằng Xưởng Video AI – đổi kiểu sản xuất sang Phim trước (khi chưa có tập nào được sản xuất)");
    if (ep.projectId) throw new ApiError("CONFLICT", "Tập này đã có dự án Xưởng Video AI");
    if (!ep.filmId) {
      for (const c of db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, s.id)).all())
        if (!c.appearanceEn)
          await ensureCharacterPrompt(c.id).catch((err) => {
            if (!(err instanceof AiError) || err.kind !== "no_provider") throw err;
          });
      await ensureStyleEn(s.id).catch((err) => console.warn("[series] không tối ưu được phong cách", err));
    }
    try {
      return createEpisodeFilm(episodeId);
    } catch (err) {
      throw new ApiError("VALIDATION", err instanceof Error ? err.message : String(err));
    }
  },
  "series.delete": ({ id: id2 }) => {
    if (!getDb().delete(series).where(drizzleOrm.eq(series.id, id2)).run().changes) throw notFound("series");
  },
  /**
   * AI: thêm nhân vật còn thiếu + dàn ý các tập tiếp theo (không xóa tập đã có).
   * Nhiều tập (> 10): lập mạch cả mùa trước, rồi viết từng đợt 10 tập bám mạch – mỗi đợt lưu ngay
   * (lỗi giữa chừng vẫn giữ các tập đã viết). Mỗi đợt đều biết các tập đã có để không lặp / lệch mạch.
   */
  "series.develop": async ({ id: id2, episodes }) => {
    const db2 = getDb();
    const s = seriesRow(id2);
    const BATCH = 10;
    const charactersOf = () => db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, id2)).all();
    const episodesOf = () => db2.select({ number: seriesEpisodes.number, title: seriesEpisodes.title, synopsis: seriesEpisodes.synopsis }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.seriesId, id2)).all().sort((a, b) => a.number - b.number);
    let beats = null;
    let lastMeta = null;
    if (episodes > BATCH) {
      const arc = await planSeriesArc({
        title: s.title,
        logline: s.logline,
        genre: s.genre,
        episodes,
        previous: episodesOf(),
        existingCharacters: charactersOf().map((c) => ({ name: c.name, role: c.role })),
        workspaceId: s.workspaceId
      });
      beats = arc.beats;
      lastMeta = arc.meta;
    }
    let addedChars = 0;
    let addedEpisodes = 0;
    while (addedEpisodes < episodes) {
      const count = Math.min(BATCH, episodes - addedEpisodes);
      const existing = charactersOf();
      const previous = episodesOf();
      const lastNumber = previous.reduce((a, b) => Math.max(a, b.number), 0);
      let plan;
      try {
        const r = await developSeries({
          title: s.title,
          logline: s.logline,
          genre: s.genre,
          visualStyle: s.visualStyle,
          episodes: count,
          episodeLengthSec: s.episodeLengthSec,
          existingCharacters: existing.map((c) => ({ name: c.name, role: c.role, appearance: c.appearance })),
          previous,
          beats: beats?.slice(addedEpisodes, addedEpisodes + count),
          brandVoice: brandVoiceOf$1(s.workspaceId),
          workspaceId: s.workspaceId
        });
        plan = r.plan;
        lastMeta = r.meta;
      } catch (err) {
        if (!addedEpisodes) throw err;
        console.warn(`[series] đợt viết tập ${lastNumber + 1}+ lỗi – dừng ở ${addedEpisodes}/${episodes} tập`, err);
        break;
      }
      if (!plan.episodes.length) break;
      const known = new Set(existing.map((c) => c.name.trim().toLowerCase()));
      const added = plan.characters.filter((c) => !known.has(c.name.trim().toLowerCase()));
      const eps = plan.episodes.slice(0, count);
      db2.transaction((tx) => {
        added.forEach(
          (c, i) => tx.insert(seriesCharacters).values({
            id: newId(),
            seriesId: id2,
            name: c.name.trim(),
            role: c.role || null,
            appearance: c.appearance.trim(),
            personality: c.personality || null,
            arc: c.arc || null,
            // Edge/Gemini/OpenAI: gán sẵn giọng theo giới tính; ElevenLabs → người dùng chọn
            voiceId: c.gender !== "other" ? GENDER_VOICES[s.ttsProvider]?.[c.gender] ?? null : null,
            sortOrder: existing.length + i
          }).run()
        );
        for (const c of plan.characters) {
          const old = existing.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
          if (old && !old.arc && c.arc) tx.update(seriesCharacters).set({ arc: c.arc }).where(drizzleOrm.eq(seriesCharacters.id, old.id)).run();
        }
        eps.forEach(
          (e, i) => tx.insert(seriesEpisodes).values({ id: newId(), seriesId: id2, number: lastNumber + i + 1, title: e.title.trim(), synopsis: e.synopsis.trim(), cliffhanger: e.cliffhanger || null }).run()
        );
        tx.update(series).set({ updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(series.id, id2)).run();
      });
      addedChars += added.length;
      addedEpisodes += eps.length;
    }
    return { characters: addedChars, episodes: addedEpisodes, meta: meta$2(lastMeta) };
  },
  "series.saveCharacter": ({ id: id2, seriesId, imagePrompt, promptManual, ...input }) => {
    const db2 = getDb();
    seriesRow(seriesId);
    const manual = promptManual && imagePrompt?.trim() ? { imagePrompt: imagePrompt.trim(), promptManual: true } : { promptManual: false };
    if (!id2) {
      const order = db2.select({ id: seriesCharacters.id }).from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.seriesId, seriesId)).all().length;
      return db2.insert(seriesCharacters).values({ id: newId(), seriesId, ...input, ...manual, sortOrder: order }).returning().get();
    }
    const row = db2.update(seriesCharacters).set({ ...input, ...manual }).where(drizzleOrm.and(drizzleOrm.eq(seriesCharacters.id, id2), drizzleOrm.eq(seriesCharacters.seriesId, seriesId))).returning().get();
    if (!row) throw notFound("nhân vật");
    return row;
  },
  /** Prompt ảnh chuẩn tiếng Anh (tạo nếu chưa có / mô tả đã đổi; `force` = viết lại) */
  "series.characterPrompt": ({ id: id2, force }) => ensureCharacterPrompt(id2, force),
  "series.deleteCharacter": ({ id: id2 }) => {
    if (!getDb().delete(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.id, id2)).run().changes) throw notFound("nhân vật");
  },
  /** Tạo ảnh tham chiếu nhân vật bằng nguồn ảnh AI đang bật (Nano Banana / Fal). */
  "series.characterImage": async ({ id: id2 }) => {
    const db2 = getDb();
    const c = db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.id, id2)).get();
    if (!c) throw notFound("nhân vật");
    const s = seriesRow(c.seriesId);
    if (s.productionMode === "film") {
      const engine2 = isReady("google_image") ? "google" : isReady("fal") ? "fal" : null;
      if (!engine2 && !flowImagesReady()) throw new ApiError("VALIDATION", imageEngineIssue() ?? "Chưa có nguồn ảnh AI");
      const p = await ensureCharacterPrompt(c.id).catch(() => c);
      const look = p.promptManual && p.imagePrompt || p.appearanceEn || c.appearance;
      await ensureStyleEn(s.id).catch(() => void 0);
      const style = seriesRow(s.id).visualStyleEn || s.visualStyle || "";
      const dir = node_path.join(mediaDir(), "series", s.id);
      node_fs.mkdirSync(dir, { recursive: true });
      const r = await generateFilmImage({
        engine: engine2 ?? "google",
        prompt: characterSheetPrompt(look, style),
        refs: [],
        aspect: "16:9",
        destBase: node_path.join(dir, `${c.id}-${Date.now().toString(36)}`),
        workspaceId: s.workspaceId,
        signal: AbortSignal.timeout(18e4)
      });
      return db2.update(seriesCharacters).set({ referenceImage: rel(r.file) }).where(drizzleOrm.eq(seriesCharacters.id, id2)).returning().get();
    }
    const engines = imageEngines();
    if (!engines.length) throw new ApiError("VALIDATION", imageEngineIssue() ?? "Chưa có nguồn ảnh AI");
    let prompt = [`Character reference sheet, full body, front view, plain light background`, s.visualStyle, c.appearance].filter(Boolean).join(". ");
    try {
      prompt = (await ensureCharacterPrompt(c.id)).imagePrompt ?? prompt;
    } catch (err) {
      if (!(err instanceof AiError) || err.kind !== "no_provider") throw err;
    }
    const signal = AbortSignal.timeout(12e4);
    let lastErr = null;
    for (const eng of engines) {
      try {
        const m = await imageBy(eng, prompt, s.workspaceId, signal);
        return db2.update(seriesCharacters).set({ referenceImage: rel(m.file) }).where(drizzleOrm.eq(seriesCharacters.id, id2)).returning().get();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new ApiError("INTERNAL", "Không tạo được ảnh nhân vật");
  },
  /**
   * Ảnh nhân vật do người dùng tải lên: chép vào media/series/<seriesId>/ (ảnh vẫn còn khi file gốc bị xóa/di chuyển).
   * `sourcePath` = null → gỡ ảnh.
   */
  "series.setCharacterImage": ({ id: id2, sourcePath }) => {
    const db2 = getDb();
    const c = db2.select().from(seriesCharacters).where(drizzleOrm.eq(seriesCharacters.id, id2)).get();
    if (!c) throw notFound("nhân vật");
    const old = c.referenceImage && c.referenceImage.startsWith("series/") ? node_path.join(mediaDir(), c.referenceImage) : null;
    if (!sourcePath) {
      if (old) node_fs.rmSync(old, { force: true });
      return db2.update(seriesCharacters).set({ referenceImage: null }).where(drizzleOrm.eq(seriesCharacters.id, id2)).returning().get();
    }
    const ext = node_path.extname(sourcePath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new ApiError("VALIDATION", "Chỉ nhận ảnh PNG, JPG hoặc WEBP");
    if (!node_fs.existsSync(sourcePath)) throw new ApiError("VALIDATION", "Không tìm thấy file ảnh");
    if (node_fs.statSync(sourcePath).size > 15 * 1024 * 1024) throw new ApiError("VALIDATION", "Ảnh tối đa 15 MB");
    const dir = node_path.join(mediaDir(), "series", c.seriesId);
    node_fs.mkdirSync(dir, { recursive: true });
    const dest = node_path.join(dir, `${c.id.slice(0, 8)}-${Date.now().toString(36)}${ext === ".jpeg" ? ".jpg" : ext}`);
    node_fs.copyFileSync(sourcePath, dest);
    if (old && old !== dest) node_fs.rmSync(old, { force: true });
    return db2.update(seriesCharacters).set({ referenceImage: rel(dest) }).where(drizzleOrm.eq(seriesCharacters.id, id2)).returning().get();
  },
  "series.saveEpisode": ({ id: id2, seriesId, ...input }) => {
    const db2 = getDb();
    seriesRow(seriesId);
    if (!id2) {
      const number = db2.select({ n: seriesEpisodes.number }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.seriesId, seriesId)).all().reduce((a, b) => Math.max(a, b.n), 0) + 1;
      return db2.insert(seriesEpisodes).values({ id: newId(), seriesId, number, ...input }).returning().get();
    }
    const row = db2.update(seriesEpisodes).set({ ...input, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(seriesEpisodes.id, id2), drizzleOrm.eq(seriesEpisodes.seriesId, seriesId))).returning().get();
    if (!row) throw notFound("tập phim");
    return row;
  },
  "series.deleteEpisode": ({ id: id2 }) => {
    if (!getDb().delete(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.id, id2)).run().changes) throw notFound("tập phim");
  },
  "series.writeEpisode": ({ id: id2 }) => scriptEpisode(id2)
};
const CONTENT_FORMATS = [
  {
    id: "free",
    group: "entertainment",
    label: "Tự do",
    hint: "Không theo khuôn cố định",
    guide: "Cấu trúc tự do, mở đầu gây tò mò, kết thúc kêu gọi theo dõi.",
    kind: "video"
  },
  {
    id: "episode",
    group: "story",
    label: "Tập phim ngắn",
    hint: "Một tập trong series phim ngắn AI",
    guide: "Kể chuyện có thoại nhân vật, có xung đột, kết bằng tình huống treo để người xem chờ tập sau.",
    kind: "video"
  },
  {
    id: "top_list",
    group: "entertainment",
    label: "Top danh sách",
    hint: "Top 5 / Top 10 …",
    guide: "Cảnh mở nêu chủ đề và hứa hẹn vị trí số 1 bất ngờ; mỗi cảnh một hạng mục đếm ngược; cảnh cuối là hạng số 1 và câu hỏi cho khán giả.",
    kind: "video"
  },
  {
    id: "news",
    group: "entertainment",
    label: "Tin nhanh",
    hint: "Điểm tin ngắn, đúng trọng tâm",
    guide: "Câu đầu là thông tin quan trọng nhất; các cảnh sau giải thích bối cảnh và ảnh hưởng; không suy đoán, nêu rõ nguồn nếu có.",
    kind: "video"
  },
  {
    id: "quiz",
    group: "entertainment",
    label: "Đố vui / thử thách",
    hint: "Câu hỏi – đếm ngược – đáp án",
    guide: "Đặt câu hỏi ngay cảnh đầu, mời người xem bình luận đáp án, đếm ngược, công bố đáp án và giải thích ngắn.",
    kind: "video"
  },
  {
    id: "story",
    group: "story",
    label: "Kể chuyện / sự thật thú vị",
    hint: "Câu chuyện, giai thoại, sự thật ít ai biết",
    guide: "Mở bằng chi tiết gây tò mò, kể theo trình tự có cao trào, kết bằng bài học hoặc sự thật bất ngờ.",
    kind: "video"
  },
  {
    id: "explainer",
    group: "knowledge",
    label: "Giải thích / kiến thức",
    hint: "Giải thích một khái niệm, cách làm",
    guide: "Nêu câu hỏi người xem hay thắc mắc, giải thích từng bước bằng ví dụ dễ hiểu, tóm tắt một câu ở cuối.",
    kind: "video"
  },
  {
    id: "lyric",
    group: "entertainment",
    label: "Video lời bài hát",
    hint: "Nhạc AI hoặc nhạc bạn có bản quyền",
    guide: "Mỗi cảnh một câu/đoạn lời, hình ảnh minh họa theo cảm xúc bài hát; chỉ dùng lời và nhạc do người dùng sở hữu hoặc nhạc AI.",
    kind: "video"
  },
  {
    id: "match_recap",
    group: "entertainment",
    label: "Tóm tắt trận đấu",
    hint: "Từ kết quả & số liệu, không dùng hình ảnh có bản quyền",
    guide: "Tỉ số và điểm nhấn ngay cảnh đầu; diễn biến chính theo thời gian; số liệu nổi bật; nhận định ngắn. Hình minh họa là đồ họa/AI, không dùng cảnh quay trận đấu.",
    kind: "video"
  },
  {
    id: "quote",
    group: "story",
    label: "Trích dẫn / truyền cảm hứng",
    hint: "Câu nói hay, thông điệp ngắn",
    guide: "Một thông điệp chính, nhịp chậm, hình ảnh giàu cảm xúc, kết bằng lời mời chia sẻ.",
    kind: "video"
  },
  // ── Sản phẩm & thương hiệu ──
  {
    id: "product_review",
    group: "product",
    label: "Review sản phẩm",
    hint: "Đánh giá trung thực: điểm nổi bật, điểm cần lưu ý, ai nên dùng",
    guide: 'Cảnh 1 là hook: một khoảnh khắc/vấn đề người xem gặp hằng ngày hoặc cảnh cận sản phẩm ấn tượng. Tiếp theo giới thiệu sản phẩm (tên, dành cho ai). Mỗi cảnh sau là MỘT điểm nổi bật kèm cảnh minh họa đang sử dụng sản phẩm. Có một cảnh nêu điểm cần lưu ý (trung thực, không phóng đại). Kết: ai nên dùng + CTA (bình luận, theo dõi). CHỈ dùng thông tin sản phẩm người dùng cung cấp – không bịa thông số, giá, khuyến mãi, cam kết công dụng. mediaPrompt mô tả "the product" (theo ảnh tham chiếu) ở góc máy cận/trung, ánh sáng studio hoặc bối cảnh sử dụng thực tế.',
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    refsHint: "Ảnh sản phẩm 2–3 góc, nền sạch – AI dựng cảnh giữ đúng hình dáng, màu sắc sản phẩm",
    topicPlaceholder: "Tai nghe XYZ Pro: chống ồn tốt, pin 30 giờ, hơi nặng; dành cho người hay đi tàu xe"
  },
  {
    id: "unboxing",
    group: "product",
    label: "Mở hộp (Unboxing)",
    hint: "Từ hộp kín tới lần dùng đầu tiên",
    guide: 'Hook: hộp còn nguyên seal và câu hỏi "bên trong có gì?". Lần lượt mở hộp, giới thiệu từng món trong hộp, cảm nhận chất liệu – thiết kế, bật/dùng thử lần đầu, cảm nhận ban đầu ngắn gọn, CTA. Không bịa thông số. mediaPrompt: cận tay mở hộp, sản phẩm theo ảnh tham chiếu, ánh sáng mềm.',
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    refsHint: "Ảnh hộp và sản phẩm",
    topicPlaceholder: "Mở hộp máy ảnh ABC bản giới hạn màu xanh rêu"
  },
  {
    id: "comparison",
    group: "product",
    label: "So sánh A vs B",
    hint: "Đặt hai lựa chọn cạnh nhau theo từng tiêu chí",
    guide: 'Hook nêu câu hỏi "chọn A hay B?". Mỗi cảnh một tiêu chí (thiết kế, hiệu năng, trải nghiệm, giá trị…) so sánh công bằng, chỉ dùng thông tin người dùng cung cấp. Kết: A hợp với ai, B hợp với ai, mời khán giả bình luận lựa chọn. mediaPrompt: hai sản phẩm đặt cạnh nhau hoặc chia đôi khung hình.',
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    refsHint: "Ảnh của cả hai sản phẩm",
    topicPlaceholder: "So sánh máy lọc không khí A và B cho phòng ngủ 20m²"
  },
  {
    id: "teaser",
    group: "product",
    label: "Teaser / Trailer",
    hint: "Giới thiệu phim, sự kiện, sản phẩm sắp ra mắt",
    guide: "Nhịp nhanh, nhiều cảnh ngắn 2–4 giây, lời dẫn ít chữ và giàu cảm xúc, giữ bí ẩn; cao trào ở 2/3 video; cảnh cuối là tên + thời điểm ra mắt và lời hẹn. mediaPrompt điện ảnh: góc máy ấn tượng, chuyển động camera, ánh sáng tương phản.",
    kind: "video",
    defaults: { targetDurationSec: 30, aspect: "16:9", renderMode: "full_ai" },
    refsHint: "Ảnh poster, nhân vật hoặc sản phẩm chính (tùy chọn)",
    topicPlaceholder: 'Trailer series phim ngắn "Làng sương" – ra mắt tập 1 tối thứ Sáu'
  },
  // ── Kiến thức & đời sống ──
  {
    id: "how_to",
    group: "knowledge",
    label: "Hướng dẫn từng bước",
    hint: "Làm được ngay sau khi xem",
    guide: 'Hook: kết quả cuối cùng trước. Nêu cần chuẩn bị gì. Mỗi cảnh MỘT bước, đánh số rõ ràng, câu ngắn ra lệnh ("Bước 2: …"). Có một mẹo/lỗi hay gặp. Kết: tóm tắt + CTA lưu video.',
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    topicPlaceholder: "Cách chụp ảnh chân dung đẹp bằng điện thoại trong 5 bước"
  },
  {
    id: "recipe",
    group: "knowledge",
    label: "Công thức nấu ăn",
    hint: "Nguyên liệu – các bước – thành phẩm",
    guide: "Hook: món thành phẩm hấp dẫn. Cảnh nguyên liệu (liệt kê ngắn). Mỗi cảnh một bước nấu với thời gian/nhiệt độ cụ thể nếu có. Kết: thành phẩm + mẹo + CTA. mediaPrompt: góc máy từ trên xuống hoặc cận món ăn, ánh sáng tự nhiên ấm.",
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    topicPlaceholder: "Bánh flan caramel không cần lò nướng"
  },
  {
    id: "before_after",
    group: "knowledge",
    label: "Trước – sau",
    hint: "Sự thay đổi rõ ràng sau một quá trình",
    guide: 'Hook: cảnh "trước" và hứa hẹn kết quả. Quá trình thay đổi qua từng giai đoạn. Cảnh "sau" đặt cạnh "trước". Kết: điều rút ra + CTA. Không phóng đại kết quả.',
    kind: "video",
    defaults: { targetDurationSec: 30, aspect: "9:16", renderMode: "full_ai" },
    refsHint: 'Ảnh "trước" và "sau" – dùng làm khung đầu / khung cuối cho Veo',
    topicPlaceholder: "Cải tạo ban công cũ thành góc cà phê nhỏ"
  },
  // ── Giải trí ──
  {
    id: "vlog",
    group: "entertainment",
    label: "Vlog / Du lịch",
    hint: "Một ngày, một chuyến đi, một trải nghiệm",
    guide: "Kể ở ngôi thứ nhất, giọng thân mật. Hook: khoảnh khắc đẹp nhất. Đi theo trình tự thời gian, mỗi cảnh một địa điểm/khoảnh khắc với cảm nhận ngắn. Kết: cảm xúc + CTA.",
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "stock" },
    topicPlaceholder: "Một ngày ở phố cổ Hội An mùa mưa"
  },
  {
    id: "poll_post",
    label: "Bình chọn / hỏi khán giả",
    hint: "Bài viết kêu gọi bình luận",
    guide: "Bài viết ngắn đặt một câu hỏi hai-ba lựa chọn rõ ràng để khán giả bình luận.",
    kind: "post"
  }
];
const CUSTOM = /^custom(-post)?:(.+)$/s;
const formatById = (id2) => {
  const m = id2?.match(CUSTOM);
  if (m) {
    const label = m[2].trim();
    return {
      id: id2,
      label,
      hint: "Định dạng tự nhập",
      guide: `Theo định dạng "${label}" do người dùng đặt: dựng nội dung đúng tinh thần định dạng này, mở đầu gây tò mò, kết thúc có lời kêu gọi.`,
      kind: m[1] ? "post" : "video"
    };
  }
  return CONTENT_FORMATS.find((f) => f.id === id2) ?? CONTENT_FORMATS[0];
};
function loadChatImages(files, max = 4) {
  const out = [];
  const dir = node_fs.mkdtempSync(node_path.join(os.tmpdir(), "omni-ai-img-"));
  try {
    for (const [i, f] of files.filter((x) => node_fs.existsSync(x)).slice(0, max).entries()) {
      const dest = node_path.join(dir, `${i}.jpg`);
      try {
        node_child_process.execFileSync(
          ffmpegPath(),
          ["-y", "-loglevel", "error", "-i", f, "-frames:v", "1", "-vf", "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease", "-q:v", "4", dest],
          { windowsHide: true, timeout: 3e4 }
        );
        out.push({ mime: "image/jpeg", data: node_fs.readFileSync(dest).toString("base64") });
      } catch (err) {
        console.warn("[ai] không đọc được ảnh tham chiếu", err instanceof Error ? err.message.split("\n")[0] : err);
      }
    }
  } finally {
    node_fs.rmSync(dir, { recursive: true, force: true });
  }
  return out;
}
const HOOK_PLATFORM_LABEL = {
  facebook: "Facebook",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube"
};
function hookFingerprint(x, platform2, extra = "") {
  const s = `${platform2}|${x.title}|${x.caption ?? ""}|${x.hashtags.join(" ")}|${extra}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}
const firstLine = (s) => (s ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
function guessPlatform(item) {
  const db2 = getDb();
  const sched = db2.select({ platform: channels.platform }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(drizzleOrm.eq(scheduledPosts.contentItemId, item.id)).orderBy(drizzleOrm.desc(scheduledPosts.scheduledAt)).get();
  if (sched) return sched.platform;
  const proj = db2.select({ ch: videoProjects.targetChannelId }).from(videoProjects).where(drizzleOrm.eq(videoProjects.contentItemId, item.id)).get();
  const ch = proj?.ch ? db2.select({ platform: channels.platform }).from(channels).where(drizzleOrm.eq(channels.id, proj.ch)).get() : void 0;
  if (ch) return ch.platform;
  return item.kind === "video" || item.kind === "reel" ? "tiktok" : "facebook";
}
function hookContext(item, platform2) {
  const db2 = getDb();
  const proj = db2.select().from(videoProjects).where(drizzleOrm.eq(videoProjects.contentItemId, item.id)).get();
  if (proj) {
    const scenes = db2.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, proj.id)).orderBy(drizzleOrm.asc(videoScenes.position)).limit(2).all();
    const first = scenes[0];
    if (first) {
      const take = first.durationSec < 2.5 && scenes[1] ? scenes : [first];
      const said = proj.narration ? take.map((s) => s.voiceover.trim()).filter(Boolean).join(" ") : "";
      return {
        platform: platform2,
        hook: said || firstLine(item.caption) || item.title,
        visual: take.map((s) => s.mediaPrompt?.trim()).filter(Boolean).join(" | ") || null,
        silent: !proj.narration
      };
    }
  }
  return { platform: platform2, hook: firstLine(item.caption) || item.title, visual: null, silent: false };
}
const CLICHES = [
  "khám phá ngay",
  "tuyệt vời",
  "giải pháp toàn diện",
  "đừng bỏ lỡ",
  "không thể bỏ qua",
  "hãy cùng",
  "cùng tìm hiểu",
  "trong thế giới",
  "trong thời đại",
  "nâng tầm",
  "đẳng cấp",
  "hoàn hảo",
  "trải nghiệm tuyệt vời",
  "bí quyết thành công",
  "thay đổi cuộc chơi",
  "chưa từng có",
  "một cách dễ dàng",
  "hành trình",
  "game changer",
  "unlock",
  "elevate"
];
const GREETING = /^(xin chào|chào (các |mọi )?(bạn|người|cả nhà)|chào mừng|hello|hi\b|hey\b|alo|hôm nay (mình|tôi|chúng ta) (sẽ|cùng))/i;
const HASHTAG_RANGE = { facebook: [1, 3], instagram: [3, 5], tiktok: [3, 5], youtube: [1, 3] };
const syllables = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const emojiCount = (s) => (s.match(/\p{Extended_Pictographic}/gu) ?? []).length;
function codeChecks(item, ctx) {
  const out = [];
  const add = (id2, label, points, evidence = null) => void out.push({ id: id2, label, points, evidence, source: "code" });
  const hook = ctx.hook;
  const n = syllables(hook);
  const head = `${hook}
${(item.caption ?? "").slice(0, 220)}`.toLowerCase();
  if (GREETING.test(hook.trim())) add("greeting", "Mở đầu bằng lời chào / giới thiệu – phí 3 giây đầu", -20, hook.slice(0, 60));
  else add("greeting", "Không mở đầu bằng lời chào", 0);
  if (n > 30) add("length", "Câu mở đầu quá dài (trên 30 tiếng)", -20, `${n} tiếng`);
  else if (n > 20) add("length", "Câu mở đầu dài (trên 20 tiếng)", -10, `${n} tiếng`);
  else if (n < 3) add("length", "Câu mở đầu quá cụt (dưới 3 tiếng)", -10, `${n} tiếng`);
  else add("length", "Độ dài câu mở đầu vừa phải", 0, `${n} tiếng`);
  const found = CLICHES.filter((c) => head.includes(c));
  add("cliche", found.length ? "Có cụm từ sáo rỗng / văn mẫu" : "Không có cụm từ sáo rỗng", -Math.min(24, found.length * 8), found.length ? found.map((f) => `"${f}"`).join(", ") : null);
  const tags = item.hashtags.length;
  const [lo, hi] = HASHTAG_RANGE[ctx.platform];
  if (tags < lo) add("hashtags", `Thiếu hashtag (${HOOK_PLATFORM_LABEL[ctx.platform]} nên ${lo}–${hi})`, -5, `${tags} thẻ`);
  else if (tags > hi * 2) add("hashtags", `Quá nhiều hashtag (${HOOK_PLATFORM_LABEL[ctx.platform]} nên ${lo}–${hi})`, -10, `${tags} thẻ`);
  else if (tags > hi) add("hashtags", `Hơi nhiều hashtag (${HOOK_PLATFORM_LABEL[ctx.platform]} nên ${lo}–${hi})`, -5, `${tags} thẻ`);
  else add("hashtags", "Số hashtag hợp lý", 0, `${tags} thẻ`);
  const caption = item.caption ?? "";
  const longest = Math.max(0, ...caption.split(/\n\s*\n|\n/).map((p) => p.length));
  if (caption.length > 300 && longest > 280) add("density", "Caption đặc chữ (đoạn dài, không ngắt dòng)", -10, `đoạn dài nhất ${longest} ký tự`);
  else add("density", "Caption dễ đọc, có ngắt dòng", 0);
  if (emojiCount(hook) > 3) add("emoji", "Câu mở đầu nhiều emoji (trên 3)", -5, `${emojiCount(hook)} emoji`);
  if (ctx.platform === "youtube") {
    const len = item.title.trim().length;
    add("title", len < 40 || len > 70 ? "Tiêu đề YouTube nên dài 40–70 ký tự" : "Độ dài tiêu đề YouTube hợp lý", len < 40 || len > 70 ? -10 : 0, `${len} ký tự`);
  }
  return out;
}
const POLICY = [
  {
    id: "health-claim",
    level: "risk",
    label: "Cam kết chữa bệnh / công dụng y tế",
    re: /(trị|chữa)\s*(dứt điểm|khỏi hẳn|tận gốc|bách bệnh)|khỏi\s*(hẳn|100\s*%)|đặc trị|thần dược|thay thế thuốc|không cần (đi )?(bác sĩ|uống thuốc)|chữa khỏi/i,
    fix: 'Bỏ cam kết công dụng; nói trải nghiệm / thành phần, thêm "hiệu quả tùy cơ địa"'
  },
  {
    id: "absolute",
    level: "warn",
    label: "Cam kết tuyệt đối (100%, đảm bảo, ngay lập tức)",
    re: /cam kết\s*100\s*%|100\s*%\s*(hiệu quả|thành công|an toàn|khỏi)|hiệu quả\s*(tuyệt đối|ngay lập tức|cấp tốc)|đảm bảo\s*(khỏi|hiệu quả|thành công)|không\s*(có\s*)?tác dụng phụ/i,
    fix: 'Đổi sang mô tả có điều kiện, có dẫn chứng (vd "nhiều khách phản hồi…")'
  },
  {
    id: "before-after",
    level: "warn",
    label: "So sánh trước / sau (ngoại hình, cân nặng, da)",
    re: /trước\s*(và|&|\/|-)?\s*sau\s*(khi\s*)?(dùng|sử dụng|điều trị|uống)|before\s*[&/-]?\s*after/i,
    fix: "Tránh ảnh / câu so sánh trước–sau; mô tả quá trình thay vì kết quả"
  },
  {
    id: "weight",
    level: "risk",
    label: "Giảm cân thần tốc theo thời gian",
    re: /giảm\s*\d+\s*(kg|ký|cân).{0,25}(ngày|tuần|tháng)|giảm cân\s*(cấp tốc|thần tốc|siêu tốc)/i,
    fix: "Bỏ con số kg theo thời gian; nói về thói quen / cảm nhận"
  },
  {
    id: "money",
    level: "risk",
    label: "Hứa hẹn thu nhập / làm giàu nhanh",
    re: /(thu nhập|kiếm|lãi|lời)\s*\d+[\d.,]*\s*(triệu|tr|củ|k|nghìn|đô|\$).{0,15}(\/|mỗi|một|1)\s*(ngày|tuần|tháng)|làm giàu (nhanh|cấp tốc)|lợi nhuận\s*(cam kết|đảm bảo|cố định)|x\s*[2-9]\s*tài khoản|việc nhẹ lương cao/i,
    fix: "Bỏ con số thu nhập cam kết; nói về kỹ năng / quy trình"
  },
  {
    id: "counterfeit",
    level: "risk",
    label: "Từ ngữ hàng nhái / hàng giả thương hiệu",
    re: /hàng\s*(fake|nhái|giả)(?=[\s.,!?;:)]|$)|replica|super\s*fake|\brep\s*1\s*:\s*1|like\s*auth|siêu cấp\s*(like|giống)/i,
    fix: "Không dùng từ chỉ hàng nhái, không gắn tên thương hiệu lớn cho hàng không chính hãng"
  },
  {
    id: "gambling",
    level: "risk",
    label: "Cờ bạc / cá độ / vay nóng",
    re: /cá độ|nhà cái|tài xỉu|lô\s*đề|soi cầu|vay (tiền )?(nhanh|nóng|online không thẩm định)|bốc bát họ|tín dụng đen/i,
    fix: "Nội dung này bị hạn chế trên mọi nền tảng – bỏ hẳn"
  },
  {
    id: "bait",
    level: "warn",
    label: "Câu kéo tương tác (like / share / tag để nhận…)",
    re: /(like|thả tim|share|chia sẻ)\s*(và|&|\+)\s*(share|chia sẻ|bình luận|comment)|tag\s*\d+\s*(người|đứa|bạn)|(comment|bình luận|cmt)\s*["“'‘]?\s*(có|yes|ok|1|\.)\s*["”'’]?\s*(để|nhận|là)|share để nhận/i,
    fix: "Facebook giảm tiếp cận bài xin like / share / tag – đặt câu hỏi thật để người xem tự bình luận",
    platforms: ["facebook", "instagram"]
  }
];
const FOLD = { facebook: 140, instagram: 125, tiktok: 100, youtube: 100 };
const MAX_CAPTION = { instagram: 2200, tiktok: 4e3, facebook: 63206, youtube: 5e3 };
function healthChecks(item, ctx) {
  const out = [];
  const text = `${item.title}
${item.caption ?? ""}
${item.firstComment ?? ""}`;
  for (const p of POLICY) {
    if (p.platforms && !p.platforms.includes(ctx.platform)) continue;
    const m = text.match(p.re);
    if (m) out.push({ id: p.id, level: p.level, label: p.label, evidence: `"${m[0].trim()}"`, fix: p.fix, source: "code" });
  }
  const caption = item.caption ?? "";
  const first = caption.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  const fold = FOLD[ctx.platform];
  if (first.length > fold)
    out.push({
      id: "fold",
      level: "warn",
      label: `Dòng đầu caption dài hơn phần hiện trước "Xem thêm" (~${fold} ký tự trên ${HOOK_PLATFORM_LABEL[ctx.platform]})`,
      evidence: `${first.length} ký tự`,
      fix: "Đưa ý chính / câu hook lên trước, cắt dòng đầu ngắn lại",
      source: "code"
    });
  const max = MAX_CAPTION[ctx.platform];
  if (max && caption.length > max)
    out.push({ id: "too-long", level: "risk", label: `Caption vượt giới hạn ${HOOK_PLATFORM_LABEL[ctx.platform]} (${max} ký tự) – bài có thể đăng lỗi`, evidence: `${caption.length} ký tự`, fix: "Rút gọn caption", source: "code" });
  if (ctx.platform === "instagram" && item.hashtags.length > 30)
    out.push({ id: "ig-tags", level: "risk", label: "Instagram giới hạn 30 hashtag", evidence: `${item.hashtags.length} thẻ`, fix: "Giữ 3–5 hashtag sát chủ đề", source: "code" });
  if (/https?:\/\/|www\./i.test(caption)) {
    if (ctx.platform === "tiktok" || ctx.platform === "instagram")
      out.push({ id: "link", level: "info", label: `Link trong caption ${HOOK_PLATFORM_LABEL[ctx.platform]} không bấm được`, evidence: null, fix: "Đưa link vào bio / bình luận", source: "code" });
    else if (ctx.platform === "facebook")
      out.push({ id: "link", level: "info", label: "Link ngoài trong bài Facebook thường bị giảm tiếp cận", evidence: null, fix: 'Đặt link ở "Bình luận đầu tiên" (ô bên dưới caption)', source: "code" });
  }
  if ((item.kind === "video" || item.kind === "reel") && !item.hashtags.length)
    out.push({ id: "no-tags", level: "warn", label: "Video chưa có hashtag phân loại chủ đề", evidence: null, fix: 'Thêm 3–5 hashtag sát chủ đề (nút "Đổi Hashtag AI")', source: "code" });
  return out;
}
const AI_POLICY_RISK = /* @__PURE__ */ new Set(["health", "finance", "adult", "violence", "hate", "gambling", "misinfo", "counterfeit"]);
const Crit = zod.z.object({ ok: bool(), evidence: opt(300) }).catch({ ok: false, evidence: "" });
const HookAiZ = zod.z.object({
  criteria: zod.z.object({
    curiosity: Crit,
    specific: Crit,
    emotion: Crit,
    clarity: Crit,
    fresh: Crit,
    contrast: Crit,
    visual: Crit.optional()
  }),
  verdict: opt(400),
  suggestions: list(need(300), 0, 5).catch([]),
  /** Ý dễ vi phạm chính sách mà bộ lọc từ khóa có thể bỏ sót (diễn đạt khéo, ngầm hiểu) */
  policy: list(zod.z.object({ category: opt(40), quote: opt(300), why: opt(300), fix: opt(300) }), 0, 8).catch([])
});
const AI_RUBRIC = [
  { id: "curiosity", label: "Gây tò mò / mở vòng lặp ngay câu đầu", fail: -20 },
  { id: "clarity", label: "Người xem hiểu ngay video / bài nói về gì, dành cho ai", fail: -15 },
  { id: "fresh", label: "Giọng tự nhiên như người thật, không văn mẫu / mùi AI", fail: -15 },
  { id: "specific", label: "Có con số / chi tiết cụ thể / tình huống thật", fail: -10 },
  { id: "emotion", label: "Chạm cảm xúc hoặc nỗi đau / mong muốn của người xem", fail: -10 },
  { id: "visual", label: "Hình 3 giây đầu gây chú ý (chuyển động, cận cảnh, bất ngờ)", fail: -10 },
  { id: "contrast", label: 'Có yếu tố đối lập / nghịch lý (vd "Đừng làm X nếu muốn Y")', fail: 0, bonus: 10 }
];
const SYSTEM = 'Bạn là Giám đốc Nội dung cực kỳ khắt khe trên mạng xã hội, chuyên tối ưu tỷ lệ giữ chân người xem cho TikTok, Reels, Facebook, YouTube. Bạn ghét văn phong học thuật, sáo rỗng, mùi AI. Nhiệm vụ: bóc mẽ điểm yếu khiến người xem lướt qua trong 3 giây đầu. Đánh giá NGHIÊM: chỉ cho "ok": true khi tiêu chí đạt rõ ràng, có thể trích dẫn chữ / hình cụ thể. Nghi ngờ → false. evidence: trích nguyên văn phần liên quan hoặc nói ngắn gọn vì sao không đạt (tiếng Việt).';
async function scoreHook(item, platform2, workspaceId) {
  const ctx = hookContext(item, platform2);
  const code = codeChecks(item, ctx);
  const codeScore = Math.max(0, Math.min(100, 100 + code.reduce((a, c) => a + c.points, 0)));
  const withVisual = !!ctx.visual;
  const { data, meta: meta2 } = await aiJson(
    {
      system: SYSTEM,
      prompt: [
        `Nền tảng: ${platform2}. Định dạng: ${item.kind}${ctx.silent ? " (video KHÔNG lời thoại – hook nằm ở hình + chữ caption)" : ""}.`,
        `Tiêu đề: ${item.title}`,
        `Câu mở đầu (${withVisual && !ctx.silent ? "lời nói trong 3 giây đầu video" : "dòng đầu người xem thấy"}): "${ctx.hook}"`,
        withVisual ? `Hình 3 giây đầu (mô tả cảnh quay, tiếng Anh): ${ctx.visual}` : "",
        item.caption ? `Caption đầy đủ:
${item.caption.slice(0, 1500)}` : "",
        item.hashtags.length ? `Hashtag: ${item.hashtags.join(" ")}` : "",
        "Chấm từng tiêu chí (ok true/false + evidence):",
        "- curiosity: câu đầu tạo câu hỏi / khoảng trống khiến phải xem tiếp",
        "- clarity: hiểu ngay chủ đề và người xem mục tiêu",
        "- fresh: tự nhiên như người thật nói, không sáo rỗng, không văn mẫu AI",
        "- specific: có con số, chi tiết, tình huống cụ thể",
        "- emotion: chạm cảm xúc / nỗi đau / mong muốn",
        withVisual ? "- visual: hình 3 giây đầu đủ mạnh để dừng ngón tay lướt" : "",
        "- contrast: có đối lập / nghịch lý / phá vỡ kỳ vọng",
        "verdict: 1–2 câu nhận xét thẳng thắn. suggestions: 3 câu mở đầu viết lại (tiếng Việt, ≤ 20 tiếng, giữ đúng nội dung, không bịa số liệu).",
        "policy: soát như người kiểm duyệt Facebook / TikTok – liệt kê câu dễ bị gỡ / bóp tương tác (kể cả diễn đạt khéo): category ∈ health (công dụng y tế, chữa bệnh), finance (hứa thu nhập, đầu tư), adult, violence, hate, gambling, misinfo (thông tin sai / gây hoang mang), counterfeit (hàng nhái, mạo danh thương hiệu), bait (xin like / share / tag), other. quote: trích nguyên văn; why: vì sao rủi ro; fix: câu viết lại an toàn. Không có thì để mảng rỗng – KHÔNG bịa.",
        `Trả về JSON: {"criteria":{"curiosity":{"ok","evidence"},"clarity":{...},"fresh":{...},"specific":{...},"emotion":{...},${withVisual ? '"visual":{...},' : ""}"contrast":{...}},"verdict","suggestions":[],"policy":[{"category","quote","why","fix"}]}`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 2500,
      temperature: 0.2
    },
    { feature: "content.hook", workspaceId },
    HookAiZ,
    (d) => [d.verdict, ...d.suggestions]
  );
  const ai = AI_RUBRIC.filter((r) => r.id !== "visual" || withVisual).map((r) => {
    const c = data.criteria[r.id] ?? { ok: false, evidence: "" };
    return { id: r.id, label: r.label, points: c.ok ? r.bonus ?? 0 : r.fail, evidence: c.evidence || null, source: "ai" };
  });
  const aiScore = Math.max(0, Math.min(100, 100 + ai.reduce((a, c) => a + c.points, 0)));
  return {
    score: Math.round(0.4 * codeScore + 0.6 * aiScore),
    codeScore,
    aiScore,
    platform: platform2,
    hook: ctx.hook,
    withVisual,
    checks: [...ai, ...code],
    health: buildHealth(item, ctx, data.policy),
    verdict: data.verdict,
    suggestions: data.suggestions.slice(0, 3),
    model: meta2.model,
    at: Date.now(),
    for: hookFingerprint(item, platform2)
  };
}
function buildHealth(item, ctx, policy) {
  const issues = healthChecks(item, ctx);
  const seen = issues.map((i) => (i.evidence ?? "").toLowerCase());
  for (const p of policy) {
    if (!p.quote && !p.why) continue;
    const q = p.quote.toLowerCase();
    if (q && seen.some((e) => e && (e.includes(q) || q.includes(e.replace(/"/g, ""))))) continue;
    const cat = p.category.toLowerCase();
    issues.push({
      id: `ai-${cat || "other"}-${issues.length}`,
      level: AI_POLICY_RISK.has(cat) ? "risk" : "warn",
      label: p.why || "AI: câu có thể vi phạm chính sách",
      evidence: p.quote ? `"${p.quote}"` : null,
      fix: p.fix || null,
      source: "ai"
    });
  }
  const order = { risk: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return { status: issues.some((i) => i.level === "risk") ? "risk" : issues.some((i) => i.level === "warn") ? "warn" : "ok", issues };
}
const brandVoiceOf = (workspaceId) => workspaceId ? getDb().select({ v: workspaces.brandVoice }).from(workspaces).where(drizzleOrm.eq(workspaces.id, workspaceId)).get()?.v ?? null : null;
const meta$1 = (r) => ({ provider: r.providerLabel, model: r.model, costUsd: r.costUsd });
function fitDurations(durations, target) {
  const total2 = durations.reduce((a, b) => a + b, 0) || 1;
  const scaled = durations.map((d) => Math.max(1.5, Math.round(d * target / total2 * 10) / 10));
  const diff = Math.round((target - scaled.reduce((a, b) => a + b, 0)) * 10) / 10;
  scaled[scaled.length - 1] = Math.max(1.5, Math.round((scaled[scaled.length - 1] + diff) * 10) / 10);
  return scaled;
}
function studioLongContext(p) {
  const episodeId = episodeOfProject(p.id);
  if (episodeId) return episodeLongContext(episodeId, p.aspect === "9:16");
  const db2 = getDb();
  const channel = p.targetChannelId ? db2.select({ platform: channels.platform, workspaceId: channels.workspaceId }).from(channels).where(drizzleOrm.eq(channels.id, p.targetChannelId)).get() : void 0;
  const workspaceId = p.workspaceId ?? channel?.workspaceId ?? null;
  return {
    ctx: {
      kind: "video",
      topic: p.topic,
      brief: [
        channel ? `Nền tảng: ${{ facebook: "Facebook", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" }[channel.platform]}` : "",
        p.format ? `Định dạng nội dung: ${formatById(p.format).guide}` : "",
        p.referenceImages.length ? REFS_HINT : "",
        // Không lời thoại: câu "line" của từng cảnh chỉ là ghi chú, app không đọc
        p.narration ? "" : NO_NARRATION_RULE.replace("voiceover:", "line:")
      ].filter(Boolean),
      characters: [],
      totalSec: p.targetDurationSec,
      vertical: p.aspect === "9:16",
      brandVoice: brandVoiceOf(workspaceId),
      workspaceId,
      bible: p.visualBible ?? null,
      // Chưa có bộ nhận diện → AI lập cùng dàn ý, xem ảnh tham chiếu để tả đúng nhân vật / sản phẩm
      images: p.visualBible ? void 0 : refImages(p)
    }
  };
}
const refImages = (p) => loadChatImages(p.referenceImages.map((r) => node_path.join(mediaDir(), r)));
function applyBible(projectId, prev, next) {
  const db2 = getDb();
  let updated = 0;
  db2.transaction((tx) => {
    tx.update(videoProjects).set({ visualBible: next, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, projectId)).run();
    if (!prev) return;
    for (const s of tx.select({ id: videoScenes.id, mediaPrompt: videoScenes.mediaPrompt }).from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, projectId)).all()) {
      if (!s.mediaPrompt) continue;
      const prompt = rebiblePrompt(s.mediaPrompt, prev, next);
      if (prompt === s.mediaPrompt) continue;
      tx.update(videoScenes).set({ mediaPrompt: prompt }).where(drizzleOrm.eq(videoScenes.id, s.id)).run();
      updated++;
    }
  });
  return updated;
}
const projectWorkspace = (p) => p.workspaceId ?? (p.targetChannelId ? getDb().select({ w: channels.workspaceId }).from(channels).where(drizzleOrm.eq(channels.id, p.targetChannelId)).get()?.w ?? null : null);
const REFS_HINT = "Người dùng đã cung cấp ảnh tham chiếu của chủ thể chính (sản phẩm, nhân vật hoặc logo) – app gửi kèm ảnh khi tạo hình. Đưa chủ thể đó vào visual bible (product hoặc characters) với mô tả khớp chủ đề, và đánh dấu nó trong shot của các cảnh có xuất hiện.";
const projectScenes = (id2) => getDb().select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, id2)).orderBy(drizzleOrm.asc(videoScenes.position)).all();
const aiHandlers = {
  "ai.omnira": async () => ({ inUse: textChain().length === 0, quota: await omniraQuota() }),
  /** Lập lại bộ nhận diện theo ảnh tham chiếu (giữ tên nhân vật / sản phẩm) → cập nhật prompt hình các cảnh */
  "studio.bibleFromRefs": async ({ id: id2 }) => {
    const p = getDb().select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, id2)).get();
    if (!p) throw notFound("dự án video");
    const images = refImages(p);
    if (!images.length) throw new AiError("bad_request", 'Dự án chưa có ảnh tham chiếu (hoặc không đọc được ảnh) – thêm ảnh ở mục "Ảnh tham chiếu" trước');
    const prev = p.visualBible ?? { style: "", characters: [], product: null };
    const { bible, meta: m } = await bibleFromImages({ topic: p.topic, bible: prev, images, workspaceId: projectWorkspace(p) });
    const updated = applyBible(id2, p.visualBible, bible);
    return { bible, updated, meta: meta$1(m) };
  },
  /** Người dùng sửa bộ nhận diện (tiếng Việt) → AI dịch sang tiếng Anh cho prompt hình → cập nhật prompt các cảnh */
  "studio.updateBible": async ({ id: id2, bible: edited }) => {
    const p = getDb().select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, id2)).get();
    if (!p) throw notFound("dự án video");
    const prev = p.visualBible;
    if (prev && (edited.characters.length !== prev.characters.length || !!edited.product !== !!prev.product))
      throw new AiError("bad_request", "Bộ nhận diện đã thay đổi ở nơi khác – tải lại rồi sửa lại");
    const { bible, meta: m } = await translateBible({ edited, workspaceId: projectWorkspace(p) });
    const updated = applyBible(id2, prev, bible);
    return { bible, updated, meta: meta$1(m) };
  },
  "studio.writeAct": async ({ projectId, act }) => {
    const p = getDb().select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, projectId)).get();
    if (!p) throw notFound("dự án video");
    const { ctx, map } = studioLongContext(p);
    const m = await writeAct(projectId, ctx, act, map);
    return { scenes: projectScenes(projectId), meta: meta$1(m) };
  },
  // ─────────── Kết nối & định tuyến ───────────
  // Check Connection: kiểm tra cả nhà cung cấp dùng chung key (vd Gemini → Nano Banana, Veo, Lyria)
  "ai.test": ({ id: id2 }) => testWithDependents(id2),
  "ai.testAll": async () => {
    const rows = getDb().select({ id: aiProviders.id, label: aiProviders.label }).from(aiProviders).where(drizzleOrm.eq(aiProviders.enabled, true)).orderBy(drizzleOrm.asc(aiProviders.category), drizzleOrm.asc(aiProviders.priority)).all();
    const results = await Promise.all(rows.map(async (r) => ({ id: r.id, label: r.label, ...await testProvider(r.id) })));
    return results;
  },
  "ai.routing": () => {
    const rows = getDb().select().from(aiProviders).where(drizzleOrm.eq(aiProviders.category, "text")).orderBy(drizzleOrm.asc(aiProviders.priority)).all();
    const fallback = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "ai.fallbackOnError")).get();
    return {
      fallbackOnError: fallback ? Boolean(fallback.value) : true,
      chain: rows.map((p) => ({
        id: p.id,
        label: p.label,
        provider: p.provider,
        model: p.defaultModel,
        enabled: p.enabled,
        hasKey: readSecret("ai_provider", p.id, "api_key") != null
      }))
    };
  },
  "ai.reorder": ({ ids }) => {
    getDb().transaction((tx) => {
      ids.forEach((id2, priority) => tx.update(aiProviders).set({ priority, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(aiProviders.id, id2)).run());
    });
  },
  "ai.setFallback": ({ enabled }) => setSetting$1("ai.fallbackOnError", enabled),
  "ai.pricing": () => {
    const overrides = pricingOverrides();
    const d = /* @__PURE__ */ new Date();
    const used = getDb().selectDistinct({ model: aiUsage.model }).from(aiUsage).where(drizzleOrm.and(drizzleOrm.eq(aiUsage.ok, true), drizzleOrm.gt(aiUsage.inputTokens, 0), drizzleOrm.gte(aiUsage.createdAt, new Date(d.getFullYear(), d.getMonth() - 2, 1)))).all().map((r) => r.model).filter((m) => !!m);
    return { defaults: DEFAULT_PRICING, overrides, unpricedModels: used.filter((m) => !priceFor(m, overrides)) };
  },
  "ai.setPrice": ({ model, price }) => {
    const next = { ...pricingOverrides() };
    if (price) next[model] = price;
    else delete next[model];
    setSetting$1("ai.pricing", next);
  },
  // ─────────── Xưởng Video: sinh kịch bản ───────────
  "studio.generateScript": async ({ id: id2 }) => {
    const db2 = getDb();
    const p = db2.select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, id2)).get();
    if (!p) throw notFound("dự án video");
    const episodeId = episodeOfProject(id2);
    if (episodeId) {
      const r = await scriptEpisode(episodeId);
      const scenes2 = db2.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, id2)).orderBy(drizzleOrm.asc(videoScenes.position)).all();
      return { scenes: scenes2, meta: r.meta };
    }
    if (isLongForm(p.targetDurationSec)) {
      const { ctx } = studioLongContext(p);
      const { meta: m2 } = await writeLongScript(id2, ctx);
      return { scenes: projectScenes(id2), meta: m2 };
    }
    const channel = p.targetChannelId ? db2.select({ platform: channels.platform, workspaceId: channels.workspaceId }).from(channels).where(drizzleOrm.eq(channels.id, p.targetChannelId)).get() : void 0;
    const workspaceId = p.workspaceId ?? channel?.workspaceId ?? null;
    const platformName = channel ? { facebook: "Facebook Reels", tiktok: "TikTok", instagram: "Instagram Reels", youtube: "YouTube Shorts" }[channel.platform] : null;
    const {
      scenes,
      bible,
      meta: m
    } = await generateScript({
      topic: p.topic,
      targetSec: p.targetDurationSec,
      platform: platformName,
      brandVoice: brandVoiceOf(workspaceId),
      workspaceId,
      formatGuide: [p.format ? formatById(p.format).guide : "", p.referenceImages.length ? REFS_HINT : ""].filter(Boolean).join(" ") || null,
      aspect: p.aspect,
      narration: p.narration,
      // AI xem ảnh tham chiếu → bộ nhận diện tả đúng nhân vật / sản phẩm trong ảnh (không tự nghĩ ra)
      images: refImages(p)
    });
    const durations = fitDurations(
      scenes.map((s) => s.durationSec),
      p.targetDurationSec
    );
    const saved = db2.transaction((tx) => {
      tx.delete(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, id2)).run();
      tx.insert(videoScenes).values(
        scenes.map((s, i) => ({
          id: newId(),
          projectId: id2,
          position: i,
          label: s.label,
          voiceover: s.voiceover.trim(),
          durationSec: durations[i],
          // Prompt video hoàn chỉnh (nhân vật, hành động, bối cảnh, góc máy, chuyển động, ánh sáng, chất liệu, phong cách, âm thanh)
          mediaPrompt: composeShotPrompt(s.shot, bible),
          searchQuery: s.searchQuery.trim() || null,
          mediaSource: "stock"
        }))
      ).run();
      tx.update(videoProjects).set({ status: "scripted", acts: null, visualBible: bible, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(videoProjects.id, id2)).run();
      return tx.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, id2)).orderBy(drizzleOrm.asc(videoScenes.position)).all();
    });
    return { scenes: saved, meta: meta$1(m) };
  },
  // ─────────── Kho nội dung: chấm điểm Hook ───────────
  "content.hookScore": async ({ id: id2, platform: platform2, force }) => {
    const db2 = getDb();
    const item = db2.select().from(contentItems).where(drizzleOrm.eq(contentItems.id, id2)).get();
    if (!item) throw notFound("nội dung");
    const pf = platform2 ?? item.hookScore?.platform ?? guessPlatform(item);
    if (!force && item.hookScore?.health && item.hookScore.platform === pf && item.hookScore.for === hookFingerprint(item, pf)) return { score: item.hookScore, cached: true };
    const score = await scoreHook(item, pf, item.workspaceId);
    db2.update(contentItems).set({ hookScore: score }).where(drizzleOrm.eq(contentItems.id, id2)).run();
    return { score, cached: false };
  },
  // ─────────── Kho nội dung: Spin & Hashtag ───────────
  "content.spin": async ({ ids, count }) => {
    const db2 = getDb();
    const items = db2.select().from(contentItems).where(drizzleOrm.inArray(contentItems.id, ids)).all();
    const failed = [];
    let done = 0;
    let lastMeta = null;
    for (const item of items) {
      try {
        const { variants, meta: m } = await spinCaption({
          title: item.title,
          caption: item.caption,
          hashtags: item.hashtags,
          count,
          brandVoice: brandVoiceOf(item.workspaceId),
          workspaceId: item.workspaceId
        });
        db2.transaction((tx) => {
          tx.insert(contentVariants).values(variants.map((v) => ({ id: newId(), contentItemId: item.id, caption: v.caption.trim(), hashtags: normalizeTags(v.hashtags), model: m.model }))).run();
          const total2 = tx.select({ id: contentVariants.id }).from(contentVariants).where(drizzleOrm.eq(contentVariants.contentItemId, item.id)).all().length;
          tx.update(contentItems).set({ spinVariants: total2, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, item.id)).run();
        });
        lastMeta = meta$1(m);
        done++;
      } catch (err) {
        if (err instanceof AiError && (err.kind === "budget" || err.kind === "no_provider")) throw err;
        failed.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    for (const id2 of ids) if (!items.some((i) => i.id === id2)) failed.push({ id: id2, reason: "Không tìm thấy nội dung" });
    return { done, failed, meta: lastMeta };
  },
  "content.variants": ({ id: id2 }) => getDb().select().from(contentVariants).where(drizzleOrm.eq(contentVariants.contentItemId, id2)).orderBy(drizzleOrm.desc(contentVariants.createdAt)).all(),
  "content.applyVariant": ({ id: id2 }) => {
    const db2 = getDb();
    const v = db2.select().from(contentVariants).where(drizzleOrm.eq(contentVariants.id, id2)).get();
    if (!v) throw notFound("biến thể");
    return db2.update(contentItems).set({ caption: v.caption, hashtags: v.hashtags, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, v.contentItemId)).returning().get();
  },
  "content.deleteVariant": ({ id: id2 }) => {
    const db2 = getDb();
    db2.transaction((tx) => {
      const v = tx.delete(contentVariants).where(drizzleOrm.eq(contentVariants.id, id2)).returning({ contentItemId: contentVariants.contentItemId }).get();
      if (!v) throw notFound("biến thể");
      const total2 = tx.select({ id: contentVariants.id }).from(contentVariants).where(drizzleOrm.eq(contentVariants.contentItemId, v.contentItemId)).all().length;
      tx.update(contentItems).set({ spinVariants: total2 }).where(drizzleOrm.eq(contentItems.id, v.contentItemId)).run();
    });
  },
  "content.hashtags": async ({ ids }) => {
    const db2 = getDb();
    const items = db2.select().from(contentItems).where(drizzleOrm.inArray(contentItems.id, ids)).all();
    const failed = [];
    let done = 0;
    for (const item of items) {
      try {
        const platform2 = item.kind === "video" || item.kind === "reel" ? "TikTok / Reels" : item.kind === "text" ? "Facebook" : "Instagram / Facebook";
        const hashtags = await suggestHashtags({ title: item.title, caption: item.caption, platform: platform2, workspaceId: item.workspaceId });
        db2.update(contentItems).set({ hashtags, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentItems.id, item.id)).run();
        done++;
      } catch (err) {
        if (err instanceof AiError && (err.kind === "budget" || err.kind === "no_provider")) throw err;
        failed.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return { done, failed };
  },
  // ─────────── Hộp thư: AI Co-Pilot ───────────
  "inbox.suggestReply": async ({ conversationId }) => {
    const db2 = getDb();
    const conv = db2.select({ c: conversations, channelName: channels.name }).from(conversations).innerJoin(channels, drizzleOrm.eq(channels.id, conversations.channelId)).where(drizzleOrm.eq(conversations.id, conversationId)).get();
    if (!conv) throw notFound("hội thoại");
    const history = db2.select({ direction: messages.direction, body: messages.body }).from(messages).where(drizzleOrm.eq(messages.conversationId, conversationId)).orderBy(drizzleOrm.asc(messages.createdAt)).all();
    const ws = conv.c.workspaceId;
    const knowledge = db2.select({ shortcut: quickReplies.shortcut, body: quickReplies.body }).from(quickReplies).where(ws ? drizzleOrm.or(drizzleOrm.isNull(quickReplies.workspaceId), drizzleOrm.eq(quickReplies.workspaceId, ws)) : drizzleOrm.isNull(quickReplies.workspaceId)).all();
    const { text, meta: m } = await suggestReply({
      customerName: conv.c.customerName,
      channelName: conv.channelName,
      source: conv.c.source,
      contextPostTitle: conv.c.contextPostTitle,
      history,
      knowledge,
      brandVoice: brandVoiceOf(ws),
      workspaceId: ws
    });
    return { text, meta: meta$1(m) };
  }
};
const MEDIA_SCHEME = "omni-media";
function registerMediaScheme() {
  electron.protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}
function resolveMediaPath(relPath) {
  if (!currentUser()) return null;
  const root2 = node_path.resolve(mediaDir());
  const abs = node_path.resolve(root2, relPath.replace(/^\/+/, ""));
  return abs === root2 || abs.startsWith(root2 + node_path.sep) ? abs : null;
}
const EXT_MEDIA = /* @__PURE__ */ new Set([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".m4v", ".webm"]);
const norm$1 = (p) => process.platform === "win32" ? node_path.resolve(p).toLowerCase() : node_path.resolve(p);
let attached = null;
function resolveAttachedPath(absPath) {
  const user = currentUser();
  if (!user || !node_path.isAbsolute(absPath) || !EXT_MEDIA.has(node_path.extname(absPath).toLowerCase())) return null;
  if (!attached || attached.user !== user || Date.now() - attached.at > 5e3) {
    const set2 = /* @__PURE__ */ new Set();
    for (const r of getDb().select({ paths: contentItems.mediaPaths }).from(contentItems).all())
      for (const p of r.paths) if (node_path.isAbsolute(p)) set2.add(norm$1(p));
    attached = { at: Date.now(), user, set: set2 };
  }
  return attached.set.has(norm$1(absPath)) ? node_path.resolve(absPath) : null;
}
function handleMediaProtocol() {
  electron.protocol.handle(MEDIA_SCHEME, (req) => {
    const url = new URL(req.url);
    const abs = url.hostname === "ext" ? resolveAttachedPath(decodeURIComponent(url.pathname.slice(1))) : resolveMediaPath(decodeURIComponent(url.pathname));
    if (!abs) return new Response("Forbidden", { status: 403 });
    return electron.net.fetch(node_url.pathToFileURL(abs).toString(), { headers: req.headers });
  });
}
function fileName(prompt) {
  const slug = prompt.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "nhac-ai";
  const d = /* @__PURE__ */ new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  return `ai-${slug}-${stamp}.mp3`;
}
async function generateMusic(req) {
  assertBudget(req.workspaceId);
  const dir = node_path.join(mediaDir(), "bgm");
  node_fs.mkdirSync(dir, { recursive: true });
  const name = fileName(req.prompt);
  const signal = AbortSignal.timeout(5 * 6e4);
  if (req.provider === "google_lyria") {
    const { key: key22, baseUrl: baseUrl2, row: row2 } = requireKey("google_lyria");
    const model2 = row2.defaultModel ?? "lyria-3-clip-preview";
    const base2 = (baseUrl2 ?? GOOGLE_BASE).replace(/\/$/, "");
    const prompt = [
      req.prompt.trim(),
      req.instrumental ? "Instrumental only, no vocals." : "",
      model2 === "lyria-3.5" ? `Length about ${Math.round(req.durationSec)} seconds.` : "",
      "Suitable as background music for a short social media video."
    ].filter(Boolean).join(" ");
    const body = await requestJson(`${base2}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": key22, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model2, input: prompt }),
      signal
    });
    const audio = findInlineData(body, "audio");
    if (!audio) throw new AiError("invalid_output", "Lyria không trả về âm thanh (prompt có thể bị chặn – không được nhái giọng ca sĩ hay lời bài hát có bản quyền)");
    node_fs.writeFileSync(node_path.join(dir, name), Buffer.from(audio.data, "base64"));
    const costUsd2 = unitCost(model2, 1);
    getDb().insert(aiUsage).values({ id: newId(), providerId: row2.id, workspaceId: req.workspaceId, model: model2, feature: "music.generate", costUsd: costUsd2, ok: true }).run();
    return { file: name, costUsd: costUsd2, model: model2 };
  }
  const { key: key2, baseUrl, row } = requireKey("elevenlabs_music");
  const model = row.defaultModel ?? "music_v2_5";
  const base = (baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const seconds = Math.min(180, Math.max(10, Math.round(req.durationSec)));
  const res = await fetch(`${base}/v1/music?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key2, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: req.prompt.trim(), music_length_ms: seconds * 1e3, model_id: model, force_instrumental: req.instrumental }),
    signal
  });
  if (!res.ok) {
    const detail2 = await res.text().catch(() => "");
    throw errorFromStatus(res.status, detail2.slice(0, 200));
  }
  node_fs.writeFileSync(node_path.join(dir, name), Buffer.from(await res.arrayBuffer()));
  const costUsd = unitCost(model, seconds / 60);
  getDb().insert(aiUsage).values({ id: newId(), providerId: row.id, workspaceId: req.workspaceId, model, feature: "music.generate", costUsd, ok: true }).run();
  return { file: name, costUsd, model };
}
const WORDS_PER_SEC = 2.8;
function estimateRender(projectId) {
  const db2 = getDb();
  const p = db2.select().from(videoProjects).where(drizzleOrm.eq(videoProjects.id, projectId)).get();
  if (!p) throw notFound("dự án video");
  const scenes = db2.select().from(videoScenes).where(drizzleOrm.eq(videoScenes.projectId, projectId)).orderBy(drizzleOrm.asc(videoScenes.position)).all().map((s) => p.narration ? s : { ...s, voiceover: "" });
  const aspect = p.aspect;
  const warnings = [];
  const veoReady = veoAvailable();
  const flow = veoSource() === "flow";
  const veoModel = veoReady ? flow ? flowCacheModel() : providerRow("google_veo")?.defaultModel ?? "veo-3.1-lite-generate-preview" : null;
  const engine2 = imageEngines()[0] ?? null;
  const imageModel = engine2 ? engine2 === "flow" ? FLOW_IMAGE_MODEL : providerRow(engine2)?.defaultModel ?? (engine2 === "google_image" ? "gemini-3.1-flash-image" : "fal-ai/flux/schnell") : null;
  const ttsModel = providerInfo(p.ttsProvider).keyless ? null : providerRow(p.ttsProvider)?.defaultModel ?? null;
  const ttsUnit = ttsModel ? UNIT_PRICES[ttsModel] : void 0;
  const refsOf = sceneRefs(projectId);
  const out = { scenes: [], veoSeconds: 0, veoUsd: 0, veoModel, images: 0, imageUsd: 0, imageModel, ttsChars: 0, ttsUsd: 0, totalUsd: 0, cachedScenes: 0, warnings };
  let veoWanted = 0;
  let imageWanted = 0;
  let missingClips = 0;
  scenes.forEach((s, index) => {
    const words = s.voiceover.trim() ? s.voiceover.trim().split(/\s+/).length : 0;
    const sec = Math.max(s.durationSec, words / WORDS_PER_SEC + 0.3);
    const query = s.mediaPrompt?.trim() || s.voiceover.split(/\s+/).slice(0, 4).join(" ");
    let mode = effectiveMode(s.mediaMode, p.renderMode);
    let cost = 0;
    let cached = false;
    let note = null;
    if (mode === "upload") {
      if (s.mediaPath && node_fs.existsSync(node_path.join(mediaDir(), s.mediaPath))) cached = true;
      else {
        missingClips++;
        mode = effectiveMode("auto", p.renderMode);
        note = "Chưa gắn clip → tìm hình theo dự án";
      }
    }
    if (mode === "veo") {
      veoWanted++;
      if (veoModel) {
        const frames = sceneFrames(s);
        const file2 = flow ? veoCacheFile(veoModel, query, sec, aspect, [], { start: frames.start ?? null }) : veoCacheFile(veoModel, query, sec, aspect, refsOf(s), frames);
        if (node_fs.existsSync(file2)) cached = true;
        else {
          const secs = veoSeconds(sec, refsOf(s), frames);
          cost = flow ? 0 : unitCost(veoModel, secs);
          out.veoSeconds += secs;
          out.veoUsd += cost;
        }
      } else mode = "image";
    }
    if (mode === "image") {
      imageWanted++;
      if (engine2 && imageModel) {
        const hit = engine2 === "flow" ? !!flowImageCached(stillImagePrompt(query), aspect, refsOf(s)) : engine2 === "google_image" ? googleImageCacheFiles(imageModel, stillImagePrompt(query), aspect, refsOf(s)).some((f) => node_fs.existsSync(f)) : node_fs.existsSync(falCacheFile(imageModel, stillImagePrompt(query), aspect));
        if (hit) cached = true;
        else {
          const c = unitCost(imageModel, 1);
          cost += c;
          out.images++;
          out.imageUsd += c;
        }
      } else mode = "stock";
    }
    const clipVoiced = p.clipAudio === "clip" && (mode === "veo" || mode === "upload" && !!s.mediaPath);
    if (ttsModel && s.voiceover.trim() && !clipVoiced) {
      const voice = s.voiceId ?? p.voiceId;
      if (!node_fs.existsSync(node_path.join(ttsCacheDir(p.ttsProvider, voice, s.voiceover.trim()), "result.json"))) {
        const chars = s.voiceover.trim().length;
        out.ttsChars += chars;
        const c = ttsUnit?.per === "char" ? ttsUnit.usd * chars : 0;
        out.ttsUsd += c;
        cost += c;
      }
    }
    if (cached) out.cachedScenes++;
    out.scenes.push({ index, mode, costUsd: Math.round(cost * 1e4) / 1e4, cached, note });
  });
  if (veoWanted && !veoReady) warnings.push(`${veoWanted} cảnh chọn Video AI (Veo) nhưng Veo chưa sẵn sàng (cần key Gemini có billing) → dùng ${engine2 ? "ảnh AI" : "video stock"}`);
  if (imageWanted && !engine2) warnings.push(`${imageEngineIssue() ?? "Ảnh AI chưa sẵn sàng"} → dùng video stock`);
  if (missingClips) warnings.push(`${missingClips} cảnh chọn "Clip của tôi" nhưng chưa gắn file`);
  if (ttsModel && !ttsUnit) warnings.push(`Chưa có đơn giá cho giọng ${ttsModel} – chi phí giọng đọc chưa tính`);
  out.veoUsd = Math.round(out.veoUsd * 100) / 100;
  out.imageUsd = Math.round(out.imageUsd * 100) / 100;
  out.ttsUsd = Math.round(out.ttsUsd * 100) / 100;
  out.totalUsd = Math.round((out.veoUsd + out.imageUsd + out.ttsUsd) * 100) / 100;
  return out;
}
const AUDIO_EXT = [".mp3", ".m4a", ".aac", ".wav", ".ogg"];
const DAY$1 = 864e5;
const upscaling = /* @__PURE__ */ new Map();
function upscaleSource(path) {
  const abs = resolveMediaPath(path);
  if (!abs || !node_fs.existsSync(abs)) throw new ApiError("NOT_FOUND", "Không tìm thấy video");
  if (clipKind(abs) !== "video") throw new ApiError("VALIDATION", "Chỉ nâng cấp được video");
  return abs;
}
function bgmDir() {
  const dir = node_path.join(mediaDir(), "bgm");
  node_fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function sweep(dir, maxAgeMs, now2) {
  let bytes = 0;
  let files = 0;
  if (!node_fs.existsSync(dir)) return { bytes, files };
  for (const e of node_fs.readdirSync(dir, { withFileTypes: true })) {
    const p = node_path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = sweep(p, maxAgeMs, now2);
      bytes += r.bytes;
      files += r.files;
      if (!node_fs.readdirSync(p).length) node_fs.rmSync(p, { recursive: true, force: true });
    } else {
      const st = node_fs.statSync(p);
      if (now2 - st.mtimeMs > maxAgeMs) {
        node_fs.rmSync(p, { force: true });
        bytes += st.size;
        files++;
      }
    }
  }
  return { bytes, files };
}
const mediaHandlers = {
  "media.info": () => cachedEncoders(),
  "media.detect": () => detectEncoders(),
  "media.setEncoder": ({ encoder }) => setPreferredEncoder(encoder),
  "media.status": () => mediaStatus(cachedEncoders()?.chosen ?? null),
  "media.voices": ({ provider }) => listVoices(provider),
  "media.previewVoice": ({ provider, voiceId, workspaceId }) => previewVoice(provider, voiceId ?? null, workspaceId ?? null, mediaDir()),
  "media.bgmList": () => node_fs.readdirSync(bgmDir()).filter((f) => AUDIO_EXT.includes(node_path.extname(f).toLowerCase())).sort((a, b) => a.localeCompare(b)),
  "media.importBgm": async () => {
    const opts = { title: "Chọn nhạc nền", properties: ["openFile"], filters: [{ name: "Âm thanh", extensions: AUDIO_EXT.map((e) => e.slice(1)) }] };
    const win = electron.BrowserWindow.getFocusedWindow();
    const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    const src = res.canceled ? null : res.filePaths[0];
    if (!src) return null;
    const name = node_path.basename(src);
    node_fs.copyFileSync(src, node_path.join(bgmDir(), name));
    return name;
  },
  "media.cleanup": () => {
    const now2 = Date.now();
    const active2 = new Set(
      getDb().select({ id: renderJobs.id }).from(renderJobs).where(drizzleOrm.inArray(renderJobs.status, ["queued", "running"])).all().map((r) => r.id)
    );
    let freed = 0;
    let files = 0;
    const jobs2 = node_path.join(mediaDir(), "jobs");
    if (node_fs.existsSync(jobs2)) {
      for (const d of node_fs.readdirSync(jobs2)) {
        if (active2.has(d)) continue;
        const r = sweep(node_path.join(jobs2, d), DAY$1, now2);
        freed += r.bytes;
        files += r.files;
      }
    }
    const cache2 = sweep(node_path.join(mediaDir(), "cache"), 30 * DAY$1, now2);
    return { freedBytes: freed + cache2.bytes, files: files + cache2.files };
  },
  "media.generateMusic": (input) => generateMusic({ ...input, workspaceId: input.workspaceId ?? null }),
  "media.imageEngine": () => {
    const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "media.imageEngine")).get()?.value;
    return v === "google_image" || v === "fal" ? v : "auto";
  },
  "media.setImageEngine": ({ engine: engine2 }) => {
    getDb().insert(settings).values({ key: "media.imageEngine", value: engine2 }).onConflictDoUpdate({ target: settings.key, set: { value: engine2, updatedAt: /* @__PURE__ */ new Date() } }).run();
  },
  "render.start": ({ projectId }) => enqueueRender(projectId),
  "render.estimate": ({ projectId }) => estimateRender(projectId),
  "media.importClips": async ({ multiple, images }) => {
    const opts = {
      title: images ? "Chọn ảnh" : multiple ? "Chọn các clip / ảnh (gán lần lượt vào các cảnh)" : "Chọn clip / ảnh cho cảnh",
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: images ? [{ name: "Ảnh", extensions: CLIP_IMAGE_EXT }] : [{ name: "Video & ảnh", extensions: [...CLIP_VIDEO_EXT, ...CLIP_IMAGE_EXT] }]
    };
    const win = electron.BrowserWindow.getFocusedWindow();
    const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    if (res.canceled) return [];
    const dir = node_path.join(mediaDir(), "uploads");
    node_fs.mkdirSync(dir, { recursive: true });
    const files = [...res.filePaths].sort((a, b) => node_path.basename(a).localeCompare(node_path.basename(b), "vi", { numeric: true })).slice(0, 100);
    return files.map((src) => {
      const kind = clipKind(src);
      if (!kind) throw new ApiError("VALIDATION", `Không hỗ trợ file ${node_path.basename(src)}`);
      if (node_fs.statSync(src).size > 4 * 1024 ** 3) throw new ApiError("VALIDATION", `${node_path.basename(src)} lớn hơn 4 GB`);
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${node_path.extname(src).toLowerCase()}`;
      node_fs.copyFileSync(src, node_path.join(dir, name));
      return { path: `uploads/${name}`, name: node_path.basename(src), kind };
    });
  },
  /** Video sắp nâng cấp: kích thước hiện tại + còn trong Google Flow không (nâng cấp bằng Flow được) */
  "media.upscaleInfo": async ({ path }) => {
    const abs = upscaleSource(path);
    const { w, h } = await probeSize(abs).catch(() => ({ w: 0, h: 0 }));
    return { width: w, height: h, inFlow: canFlowUpscale(abs) };
  },
  /** Nâng cấp độ phân giải clip của cảnh (Xưởng video) → file mới trong uploads (file gốc giữ nguyên). Chạy tới khi xong. */
  "media.upscale": async ({ path, quality, method }) => {
    const abs = upscaleSource(path);
    if (upscaling.has(path)) throw new ApiError("CONFLICT", "Video này đang được nâng cấp");
    const dir = node_path.join(mediaDir(), "uploads");
    node_fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now().toString(36)}-${quality}.mp4`;
    const ctrl = new AbortController();
    upscaling.set(path, { ctrl, status: "Bắt đầu…" });
    try {
      await upscaleVideo({
        src: abs,
        dest: node_path.join(dir, name),
        method,
        quality,
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(20 * 6e4)]),
        onStatus: (s) => {
          const job = upscaling.get(path);
          if (job) job.status = s;
        }
      });
    } catch (err) {
      if (ctrl.signal.aborted) throw new ApiError("CONFLICT", "Đã hủy nâng cấp");
      throw new ApiError("INTERNAL", err instanceof Error ? err.message : String(err));
    } finally {
      upscaling.delete(path);
    }
    return { path: `uploads/${name}` };
  },
  "media.upscaleProgress": ({ path }) => upscaling.get(path)?.status ?? null,
  "media.cancelUpscale": ({ path }) => upscaling.get(path)?.ctrl.abort(),
  "render.cancel": ({ id: id2 }) => cancelRender(id2),
  "render.jobs": ({ projectId, limit }) => listJobs(projectId, limit),
  "media.showInFolder": ({ path }) => {
    const abs = resolveMediaPath(path) ?? resolveAttachedPath(path);
    if (!abs || !node_fs.existsSync(abs)) throw new ApiError("NOT_FOUND", "Không tìm thấy file");
    electron.shell.showItemInFolder(abs);
  }
};
const DEFAULT_REDIRECT_URI = "http://localhost/omnipage/oauth";
function metaRedirectUri() {
  const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "meta.redirectUri")).get()?.value;
  return typeof v === "string" && /^https?:\/\//.test(v) ? v : DEFAULT_REDIRECT_URI;
}
const dialogBase = () => process.env.OMNI_FB_DIALOG_BASE ?? "https://www.facebook.com";
const PAGE_SCOPES = ["public_profile", "pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement", "pages_messaging", "pages_read_user_content", "read_insights", "business_management"];
const IG_SCOPES = ["instagram_basic", "instagram_content_publish", "instagram_manage_messages", "instagram_manage_comments", "instagram_manage_insights"];
function metaInstagram() {
  return getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "meta.instagram")).get()?.value !== false;
}
function setMetaInstagram(enabled) {
  getDb().insert(settings).values({ key: "meta.instagram", value: enabled }).onConflictDoUpdate({ target: settings.key, set: { value: enabled, updatedAt: /* @__PURE__ */ new Date() } }).run();
}
function fbScopes() {
  return metaInstagram() ? [...PAGE_SCOPES, ...IG_SCOPES] : PAGE_SCOPES;
}
function metaAppId() {
  const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "meta.appId")).get()?.value;
  return typeof v === "string" && v ? v : null;
}
function metaConfigId() {
  const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, "meta.configId")).get()?.value;
  return typeof v === "string" && v ? v : null;
}
function metaAppSecret() {
  return readSecret("integration", "meta", "api_key");
}
async function saveMetaApp(appId, appSecret, configId, redirectUri, instagram) {
  const secret = appSecret || metaAppSecret();
  if (!secret) throw new PublishError("permanent", "Nhập App Secret");
  const signal = AbortSignal.timeout(2e4);
  const tok = await graph("GET", "oauth/access_token", {
    token: "",
    signal,
    query: { client_id: appId, client_secret: secret, grant_type: "client_credentials" }
  });
  let name = null;
  try {
    name = (await graph("GET", appId, { token: tok.access_token, signal, query: { fields: "name" } })).name ?? null;
  } catch {
  }
  getDb().insert(settings).values({ key: "meta.appId", value: appId }).onConflictDoUpdate({ target: settings.key, set: { value: appId, updatedAt: /* @__PURE__ */ new Date() } }).run();
  getDb().insert(settings).values({ key: "meta.redirectUri", value: redirectUri ?? "" }).onConflictDoUpdate({ target: settings.key, set: { value: redirectUri ?? "", updatedAt: /* @__PURE__ */ new Date() } }).run();
  getDb().insert(settings).values({ key: "meta.configId", value: configId ?? "" }).onConflictDoUpdate({ target: settings.key, set: { value: configId ?? "", updatedAt: /* @__PURE__ */ new Date() } }).run();
  getDb().insert(settings).values({ key: "meta.instagram", value: instagram }).onConflictDoUpdate({ target: settings.key, set: { value: instagram, updatedAt: /* @__PURE__ */ new Date() } }).run();
  if (appSecret) putSecret({ kind: "api_key", ownerType: "integration", ownerId: "meta", value: appSecret });
  return { name };
}
async function askForCode(appId, configId, parent) {
  const state2 = node_crypto.randomBytes(16).toString("hex");
  const redirectUri = metaRedirectUri();
  const url = new URL(`${dialogBase()}/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state2);
  url.searchParams.set("response_type", "code");
  if (configId) {
    url.searchParams.set("config_id", configId);
    url.searchParams.set("override_default_response_type", "true");
  } else {
    url.searchParams.set("scope", fbScopes().join(","));
    url.searchParams.set("auth_type", "rerequest");
  }
  const params = await openAuthWindow({
    url: url.toString(),
    redirectUri,
    state: state2,
    title: "Kết nối Facebook",
    provider: "Facebook",
    parent,
    // Facebook hiện trang "URL bị chặn" (URI chuyển hướng chưa hợp lệ) → báo rõ cách sửa
    blocked: (text) => /URL Blocked|URL bị chặn|redirect_uri|URI chuyển hướng|not whitelisted|Valid OAuth Redirect/i.test(text) ? `Facebook chặn URI chuyển hướng "${redirectUri}". Trong Meta App → Facebook Login → Cài đặt: bật Client OAuth login + Web OAuth login, thêm URI này vào "Valid OAuth Redirect URIs" (app ở chế độ Development thì localhost được chấp nhận sẵn).` : null
  });
  const error = params.get("error_reason") ?? params.get("error");
  if (error) throw new PublishError("permanent", error === "user_denied" ? "Bạn đã từ chối cấp quyền cho ứng dụng" : `Facebook từ chối: ${params.get("error_description") ?? error}`);
  const code = params.get("code");
  if (!code) throw new PublishError("permanent", "Facebook không trả mã đăng nhập");
  return code;
}
async function exchangeCode(appId, appSecret, code, redirectUri, signal) {
  const short2 = await graph("GET", "oauth/access_token", {
    token: "",
    signal,
    query: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }
  });
  const long = await graph("GET", "oauth/access_token", {
    token: "",
    signal,
    query: { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: short2.access_token }
  });
  return long.access_token;
}
const PERMISSION_GROUPS = [
  { feature: "Đăng bài lên Fanpage", useCase: "Quản lý mọi thứ trên Trang (Manage everything on your Page)", perms: ["pages_manage_posts", "pages_read_engagement"] },
  { feature: "Trả lời / ẩn bình luận Fanpage", useCase: "Quản lý mọi thứ trên Trang (Manage everything on your Page)", perms: ["pages_manage_engagement", "pages_read_user_content"] },
  { feature: "Tin nhắn Messenger", useCase: "Tương tác với khách hàng trên Messenger (Engage with customers on Messenger from Meta)", perms: ["pages_messaging"] },
  { feature: "Số liệu Fanpage", useCase: "Quản lý mọi thứ trên Trang (Manage everything on your Page)", perms: ["read_insights"] },
  {
    feature: "Instagram (đăng Reels, tin nhắn, bình luận, số liệu)",
    useCase: "Quản lý tin nhắn & nội dung trên Instagram (Manage messaging & content on Instagram)",
    perms: ["instagram_basic", "instagram_content_publish", "instagram_manage_messages", "instagram_manage_comments", "instagram_manage_insights"]
  }
];
async function grantedPermissions(token2, signal) {
  const r = await graph("GET", "me/permissions", { token: token2, signal });
  return new Set((r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission));
}
function missingFeatures(granted) {
  const wanted = new Set(fbScopes());
  return PERMISSION_GROUPS.filter((g) => g.perms.some((p) => wanted.has(p))).map((g) => ({ ...g, perms: g.perms.filter((p) => !granted.has(p)) })).filter((g) => g.perms.length);
}
async function metaViaCloud() {
  return cloudOAuthEnabled("facebook");
}
async function facebookLogin(parent) {
  const appId = metaAppId();
  const appSecret = metaAppSecret();
  const signal = AbortSignal.timeout(6e4);
  let token2;
  if (await metaViaCloud()) {
    const tok = await cloudLogin("facebook", fbScopes().join(","), { title: "Kết nối Facebook", provider: "Facebook", parent });
    token2 = String(tok.access_token ?? "");
    if (!token2) throw new PublishError("permanent", "Omnira Cloud không trả token Facebook");
  } else {
    if (!appId || !appSecret)
      throw new PublishError("permanent", "Chưa cấu hình Ứng dụng Meta – vào Cài đặt → Ứng dụng Meta để nhập App ID và App Secret (một lần), hoặc liên hệ Omnira để bật kết nối sẵn");
    const code = await askForCode(appId, metaConfigId(), parent);
    token2 = await exchangeCode(appId, appSecret, code, metaRedirectUri(), signal);
  }
  const me = await graph("GET", "me", { token: token2, signal, query: { fields: "id,name" } });
  let granted = new Set(fbScopes());
  try {
    granted = await grantedPermissions(token2, signal);
  } catch {
  }
  return { token: token2, userId: me.id, name: me.name, granted };
}
const MIN_POSTS = 8;
const pad = (n) => String(n).padStart(2, "0");
function bestHours(workspaceId) {
  const rows = getDb().select({ channelId: scheduledPosts.channelId, publishedAt: scheduledPosts.publishedAt, engagements: scheduledPosts.engagements }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).where(
    drizzleOrm.and(
      drizzleOrm.eq(scheduledPosts.status, "published"),
      drizzleOrm.isNotNull(scheduledPosts.engagements),
      drizzleOrm.gte(scheduledPosts.publishedAt, new Date(Date.now() - 90 * 864e5)),
      workspaceId ? drizzleOrm.eq(channels.workspaceId, workspaceId) : void 0
    )
  ).all().filter((r) => r.publishedAt && r.engagements != null);
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, posts: 0, score: 0 }));
  if (rows.length < MIN_POSTS) return { posts: rows.length, minPosts: MIN_POSTS, byHour, suggested: [] };
  const avg = /* @__PURE__ */ new Map();
  for (const r of rows) avg.set(r.channelId, (avg.get(r.channelId) ?? 0) + r.engagements);
  const counts = /* @__PURE__ */ new Map();
  for (const r of rows) counts.set(r.channelId, (counts.get(r.channelId) ?? 0) + 1);
  for (const [k, v] of avg) avg.set(k, v / counts.get(k));
  const sum = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    const h = r.publishedAt.getHours();
    const base = avg.get(r.channelId) || 1;
    sum[h] += r.engagements / base;
    byHour[h].posts++;
  }
  for (const b of byHour) b.score = b.posts ? Math.round(sum[b.hour] / b.posts * 100) / 100 : 0;
  const top = byHour.filter((b) => b.posts >= 2 && b.score > 1).sort((a, b) => b.score - a.score).slice(0, 3);
  const totalScore = top.reduce((a, b) => a + b.score, 0) || 1;
  const hours = [...top].sort((a, b) => a.hour - b.hour);
  const merged = [];
  for (const b of hours) {
    const last = merged[merged.length - 1];
    if (last && b.hour === last.to) {
      last.to = b.hour + 1;
      last.score += b.score;
    } else merged.push({ from: b.hour, to: b.hour + 1, score: b.score });
  }
  const suggested = merged.map((m) => ({
    start: `${pad(m.from)}:00`,
    end: m.to >= 24 ? "23:59" : `${pad(m.to)}:00`,
    weight: Math.round(m.score / totalScore * 100) / 100
  }));
  return { posts: rows.length, minPosts: MIN_POSTS, byHour, suggested };
}
const DEFAULT_TIKTOK_REDIRECT = "http://localhost/omnipage/tiktok";
const DEFAULT_TIKTOK_SCOPES = "user.info.basic,video.publish,user.info.stats";
const authorizeBase = () => process.env.OMNI_TIKTOK_AUTH_BASE ?? "https://www.tiktok.com";
const setting = (key2) => {
  const v = getDb().select().from(settings).where(drizzleOrm.eq(settings.key, key2)).get()?.value;
  return typeof v === "string" && v ? v : null;
};
const putSetting = (key2, value) => {
  getDb().insert(settings).values({ key: key2, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: /* @__PURE__ */ new Date() } }).run();
};
const tiktokClientKey = () => setting("tiktok.clientKey");
const tiktokClientSecret = () => readSecret("integration", "tiktok", "api_key");
const tiktokRedirectUri = () => setting("tiktok.redirectUri") ?? DEFAULT_TIKTOK_REDIRECT;
const tiktokScopes = () => setting("tiktok.scopes") ?? DEFAULT_TIKTOK_SCOPES;
async function saveTiktokApp(input) {
  const secret = input.clientSecret || tiktokClientSecret();
  if (!secret) throw new PublishError("permanent", "Nhập Client Secret");
  await tiktokOAuth({ client_key: input.clientKey, client_secret: secret, grant_type: "client_credentials" }, AbortSignal.timeout(2e4), "Client Key / Secret không hợp lệ");
  putSetting("tiktok.clientKey", input.clientKey);
  putSetting("tiktok.redirectUri", input.redirectUri ?? "");
  putSetting("tiktok.scopes", input.scopes ?? "");
  if (input.clientSecret) putSecret({ kind: "api_key", ownerType: "integration", ownerId: "tiktok", value: input.clientSecret });
}
function pkce() {
  const verifier = node_crypto.randomBytes(48).toString("base64url").slice(0, 64);
  return { verifier, challenge: node_crypto.createHash("sha256").update(verifier).digest("hex") };
}
const tiktokBlocked = (redirectUri) => (text) => /redirect_uri|redirect uri|Something went wrong|client_key/i.test(text) && /redirect|client_key|scope/i.test(text) ? `TikTok báo lỗi cấu hình ứng dụng: "${text.replace(/\s+/g, " ").trim().slice(0, 400)}". Kiểm tra Redirect URI "${redirectUri}" đã khai báo trong Login Kit và các scope (${tiktokScopes()}) đã được thêm vào app.` : null;
const tiktokLostFlow = (u) => /(^|\.)tiktok\.com$/.test(u.hostname) && /^\/(|foryou|explore|following|friends|live|@[^/]+)\/?$/.test(u.pathname);
async function tiktokLogin(parent) {
  const clientKey = tiktokClientKey();
  const clientSecret = tiktokClientSecret();
  if (await cloudOAuthEnabled("tiktok")) {
    const cfg0 = await cloudOAuthConfig();
    const tok2 = await cloudLogin("tiktok", tiktokScopes(), {
      title: "Kết nối TikTok",
      provider: "TikTok",
      parent,
      blocked: tiktokBlocked(cfg0?.tiktok.redirectUri ?? "trang callback của Omnira Cloud"),
      lostFlow: tiktokLostFlow
    });
    if (!tok2.access_token) throw new PublishError("permanent", "Omnira Cloud không trả token TikTok");
    const cfg = await cloudOAuthConfig();
    return finishTiktok(
      { access_token: tok2.access_token, expires_in: tok2.expires_in ?? 86400, refresh_token: tok2.refresh_token ?? "", open_id: tok2.open_id ?? "", scope: tok2.scope },
      true,
      cfg?.tiktok.clientId ?? ""
    );
  }
  if (!clientKey || !clientSecret)
    throw new PublishError("permanent", "Chưa cấu hình Ứng dụng TikTok – vào Cài đặt → Ứng dụng TikTok để nhập Client Key và Client Secret (một lần), hoặc liên hệ Omnira để bật kết nối sẵn");
  const redirectUri = tiktokRedirectUri();
  const state2 = node_crypto.randomBytes(16).toString("hex");
  const { verifier, challenge } = pkce();
  const url = new URL(`${authorizeBase()}/v2/auth/authorize/`);
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("scope", tiktokScopes());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state2);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const params = await openAuthWindow({
    url: url.toString(),
    redirectUri,
    state: state2,
    title: "Kết nối TikTok",
    provider: "TikTok",
    parent,
    blocked: tiktokBlocked(redirectUri),
    lostFlow: tiktokLostFlow
  });
  const error = params.get("error");
  if (error) {
    throw new PublishError("permanent", error === "access_denied" ? "Bạn đã từ chối cấp quyền cho ứng dụng" : `TikTok từ chối: ${params.get("error_description") ?? error}`);
  }
  const code = params.get("code");
  if (!code) throw new PublishError("permanent", "TikTok không trả mã đăng nhập");
  const signal = AbortSignal.timeout(45e3);
  const tok = await tiktokOAuth(
    { client_key: clientKey, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: verifier },
    signal,
    "Đổi mã đăng nhập TikTok thất bại"
  );
  return finishTiktok(tok, false, clientKey);
}
async function finishTiktok(tok, viaCloud, clientKey) {
  const signal = AbortSignal.timeout(45e3);
  const scopes = (tok.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const info = await tiktok("/v2/user/info/", {
    token: tok.access_token,
    signal,
    method: "GET",
    query: { fields: "open_id,display_name,avatar_url" }
  });
  let followers = null;
  if (scopes.includes("user.info.stats")) {
    try {
      followers = (await tiktok("/v2/user/info/", { token: tok.access_token, signal, method: "GET", query: { fields: "follower_count" } })).user?.follower_count ?? null;
    } catch {
    }
  }
  return {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1e3,
    openId: tok.open_id || info.user.open_id,
    displayName: info.user.display_name || "TikTok",
    avatarUrl: info.user.avatar_url ?? null,
    followers,
    scopes,
    viaCloud,
    clientKey
  };
}
const timeoutSignal = () => AbortSignal.timeout(45e3);
function apiErr(err, prefix) {
  if (err instanceof ApiError) return err;
  if (err instanceof PublishError) {
    if (err.kind === "auth") return new ApiError("VALIDATION", `${prefix}: token không hợp lệ hoặc thiếu quyền – ${err.message}`);
    return new ApiError(err.kind === "permanent" ? "VALIDATION" : "INTERNAL", `${prefix}: ${err.message}`);
  }
  return new ApiError("INTERNAL", `${prefix}: ${err instanceof Error ? err.message : String(err)}`);
}
function requireVault() {
  if (!vaultAvailable()) throw new ApiError("INTERNAL", "Két bảo mật của hệ điều hành không khả dụng – không thể lưu token an toàn");
}
const norm = (s) => (s ?? "").trim().replace(/^@/, "").toLowerCase();
function resolveTokenAlerts(channelId) {
  getDb().update(alerts).set({ resolvedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.and(drizzleOrm.eq(alerts.entityType, "channel"), drizzleOrm.eq(alerts.entityId, channelId), drizzleOrm.eq(alerts.kind, "token_invalid"), drizzleOrm.isNull(alerts.resolvedAt))).run();
}
function saveConnection(ch, cred, patch) {
  writeCred(ch.id, cred);
  resolveTokenAlerts(ch.id);
  const row = markChannel(ch.id, { ...patch, tokenStatus: statusFor(cred.expiresAt), tokenExpiresAt: cred.expiresAt ? new Date(cred.expiresAt) : null, health: "ok" });
  if (row.platform !== "facebook") getDb().update(accounts).set({ health: "ok", sessionStatus: "valid", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(accounts.id, row.accountId)).run();
  getDb().insert(activityLog).values({ level: "ok", scope: "token", message: `Đã kết nối API cho kênh ${row.name}` }).run();
  kickPublisher();
  return row;
}
const expiryText = (at2) => at2 ? `hết hạn ${new Date(at2).toLocaleString("vi-VN")}` : "không hết hạn";
async function connectFacebook(ch, token2, signal) {
  const info = await inspectFbToken(token2, signal);
  let page;
  if (info.type === "page") {
    page = info.page;
    if (ch.externalId && ch.externalId !== page.id) throw new ApiError("VALIDATION", `Token thuộc Fanpage "${page.name}" (${page.id}), không phải kênh này (${ch.externalId})`);
  } else {
    page = info.pages.find((p) => ch.externalId ? p.id === ch.externalId : norm(p.name) === norm(ch.name));
    if (!page) {
      throw new ApiError(
        "VALIDATION",
        `User token của "${info.userName}" quản lý ${info.pages.length} Fanpage nhưng không có trang khớp "${ch.name}"${ch.externalId ? ` (${ch.externalId})` : ""}. Dùng "Nhập Fanpage từ User Token" ở tài khoản VIA để thêm trang.`
      );
    }
    if (!page.access_token) throw new ApiError("VALIDATION", `Tài khoản không có quyền đăng bài trên "${page.name}" (thiếu pages_manage_posts)`);
  }
  const pageToken = page.access_token ?? token2;
  const expiresAt = await tokenExpiry(pageToken, signal);
  const channel = saveConnection(
    ch,
    { token: pageToken, pageId: page.id, expiresAt },
    { externalId: page.id, followers: page.fan_count ?? ch.followers, avatarUrl: page.picture?.data?.url ?? ch.avatarUrl }
  );
  return { channel, message: `Đã kết nối Fanpage "${page.name}" · token ${expiryText(expiresAt)}` };
}
async function connectInstagram(ch, token2, signal) {
  const info = await inspectFbToken(token2, signal);
  const pages = info.type === "page" ? [info.page] : info.pages;
  const linked = pages.filter((p) => p.instagram_business_account);
  const match = linked.find((p) => ch.externalId && p.instagram_business_account.id === ch.externalId) ?? linked.find((p) => ch.handle && norm(p.instagram_business_account.username) === norm(ch.handle)) ?? (!ch.externalId && !ch.handle && linked.length === 1 ? linked[0] : void 0);
  if (!match) {
    throw new ApiError(
      "VALIDATION",
      linked.length ? `Token có ${linked.length} tài khoản Instagram (${linked.map((p) => "@" + p.instagram_business_account.username).join(", ")}) nhưng không khớp kênh này – sửa @handle của kênh cho đúng` : "Không tìm thấy tài khoản Instagram Business/Creator liên kết với Fanpage của token này"
    );
  }
  const ig = match.instagram_business_account;
  const pageToken = match.access_token ?? token2;
  const expiresAt = await tokenExpiry(pageToken, signal);
  const channel = saveConnection(
    ch,
    { token: pageToken, pageId: match.id, igUserId: ig.id, expiresAt },
    { externalId: ig.id, handle: ig.username ?? ch.handle, followers: ig.followers_count ?? ch.followers, avatarUrl: ig.profile_picture_url ?? ch.avatarUrl }
  );
  return { channel, message: `Đã kết nối Instagram @${ig.username ?? ig.id} (qua Fanpage "${match.name}") · token ${expiryText(expiresAt)}` };
}
async function connectTikTok(ch, input, signal) {
  let cred = { token: input.token, expiresAt: Date.now() + 24 * 36e5 };
  const canRefresh = !!(input.refreshToken && input.clientKey && input.clientSecret);
  if (canRefresh) {
    const r = await tiktokOAuth(
      { client_key: input.clientKey, client_secret: input.clientSecret, grant_type: "refresh_token", refresh_token: input.refreshToken },
      signal
    );
    cred = {
      token: r.access_token,
      refreshToken: r.refresh_token ?? input.refreshToken,
      clientKey: input.clientKey,
      clientSecret: input.clientSecret,
      expiresAt: Date.now() + r.expires_in * 1e3
    };
  }
  const user = await tiktokUser(cred.token, signal);
  const prev = readCred(ch.id);
  if (prev?.openId && prev.openId !== user.open_id) {
    throw new ApiError(
      "VALIDATION",
      `Token thuộc tài khoản TikTok "${user.display_name ?? user.open_id}", khác tài khoản đã kết nối trước đó – ngắt kết nối kênh trước nếu muốn đổi`
    );
  }
  cred.openId = user.open_id;
  const channel = saveConnection(ch, cred, { avatarUrl: user.avatar_url ?? ch.avatarUrl });
  return {
    channel,
    message: `Đã kết nối TikTok "${user.display_name ?? user.open_id}" · ${canRefresh ? `tự làm mới token (${expiryText(cred.expiresAt)})` : "token hết hạn sau ~24 giờ – thêm refresh token + client key/secret để tự làm mới"}`
  };
}
async function importPages(via, token2, longLived, signal) {
  const db2 = getDb();
  const info = await inspectFbToken(token2, signal);
  if (info.type === "page") throw new ApiError("VALIDATION", "Đây là Page token – hãy dán User token của VIA, hoặc dán Page token trực tiếp vào từng Fanpage");
  const usable = info.pages.filter((p) => p.access_token);
  if (!usable.length) throw new ApiError("VALIDATION", `"${info.userName}" không quản lý Fanpage nào (hoặc chưa cấp quyền cho Page nào – khi đăng nhập hãy chọn Page cần kết nối)`);
  let pagesCreated = 0;
  let pagesUpdated = 0;
  let igCount = 0;
  for (const p of usable) {
    const expiresAt = await tokenExpiry(p.access_token, signal);
    let page = db2.select().from(channels).where(drizzleOrm.and(drizzleOrm.eq(channels.platform, "facebook"), drizzleOrm.eq(channels.externalId, p.id))).get();
    if (!page) {
      page = db2.insert(channels).values({ id: newId(), accountId: via.id, workspaceId: via.workspaceId, platform: "facebook", kind: "fb_page", name: p.name, externalId: p.id, role: "admin" }).returning().get();
      pagesCreated++;
    } else pagesUpdated++;
    saveConnection(
      page,
      { token: p.access_token, pageId: p.id, expiresAt },
      { name: p.name, followers: p.fan_count ?? page.followers, avatarUrl: p.picture?.data?.url ?? page.avatarUrl }
    );
    const ig = p.instagram_business_account;
    if (ig) {
      let igCh = db2.select().from(channels).where(drizzleOrm.and(drizzleOrm.eq(channels.platform, "instagram"), drizzleOrm.eq(channels.externalId, ig.id))).get();
      if (!igCh) {
        const acc = db2.insert(accounts).values({
          id: newId(),
          workspaceId: via.workspaceId,
          platform: "instagram",
          displayName: ig.username ?? p.name,
          handle: ig.username ?? null,
          externalId: ig.id,
          sessionStatus: "unknown"
        }).onConflictDoNothing().returning().get() ?? db2.select().from(accounts).where(drizzleOrm.and(drizzleOrm.eq(accounts.platform, "instagram"), drizzleOrm.eq(accounts.externalId, ig.id))).get();
        igCh = db2.insert(channels).values({
          id: newId(),
          accountId: acc.id,
          workspaceId: acc.workspaceId,
          platform: "instagram",
          kind: "ig_account",
          name: ig.username ?? p.name,
          handle: ig.username ?? null,
          externalId: ig.id
        }).returning().get();
      }
      saveConnection(
        igCh,
        { token: p.access_token, pageId: p.id, igUserId: ig.id, expiresAt },
        { handle: ig.username ?? igCh.handle, followers: ig.followers_count ?? igCh.followers, avatarUrl: ig.profile_picture_url ?? igCh.avatarUrl }
      );
      igCount++;
    }
  }
  db2.update(accounts).set({ sessionStatus: "valid", health: "ok", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(accounts.id, via.id)).run();
  let instagramIssue = null;
  if (metaInstagram() && igCount === 0) {
    instagramIssue = info.igError ? `Facebook từ chối đọc Instagram (${info.igError}). Kiểm tra Meta App đã thêm use case Instagram bản "API setup with Facebook login" với quyền instagram_basic, rồi kết nối lại.` : `Không thấy tài khoản Instagram nào liên kết với ${usable.length} Fanpage đã cấp quyền (${usable.map((p) => p.name).join(", ")}). Kiểm tra: Instagram là tài khoản chuyên nghiệp, đã liên kết với đúng Fanpage này, và khi đăng nhập Facebook đã tick chọn tài khoản Instagram (bấm "Chỉnh sửa quyền truy cập" nếu Facebook không hỏi).`;
  }
  console.info(
    `[oauth] nhập từ token: ${usable.length} Fanpage (${pagesCreated} mới) · ${igCount} Instagram · ${usable.filter((p) => p.instagram_business_account).length} Page có liên kết Instagram${info.igError ? ` · Instagram bị từ chối: ${info.igError}` : ""}`
  );
  const message = `Đã kết nối ${usable.length} Fanpage (${pagesCreated} mới, ${pagesUpdated} cập nhật)` + (igCount ? ` và ${igCount} tài khoản Instagram` : "") + (longLived ? " · token dài hạn" : " · token ngắn hạn – nhập App ID/Secret để Page token không hết hạn");
  return { pages: usable.length, created: pagesCreated, instagram: igCount, longLived, message, instagramIssue };
}
const publishingHandlers = {
  "integrations.youtube": async () => ({
    clientId: youtubeClientId(),
    hasSecret: !!youtubeClientSecret(),
    viaCloud: await cloudOAuthEnabled("google"),
    publish: youtubePublishSettings()
  }),
  "integrations.setYoutube": async ({ clientId, clientSecret }) => {
    requireVault();
    try {
      await saveYoutubeApp(clientId, clientSecret || null);
      return { message: "Đã lưu Ứng dụng YouTube – Client ID/Secret hợp lệ" };
    } catch (err) {
      throw apiErr(err, "Không lưu được Ứng dụng YouTube");
    }
  },
  "integrations.setYoutubePublish": (patch) => {
    saveYoutubePublishSettings(patch);
  },
  "integrations.setInstagram": ({ enabled }) => setMetaInstagram(enabled),
  "accounts.cancelYoutubeLogin": () => {
    cancelLoopbackAuth();
    cancelCloudLogin();
  },
  /** "Kết nối YouTube": trình duyệt hệ thống → Google → tạo (hoặc cập nhật) tài khoản + kênh YouTube, lưu refresh token. */
  "accounts.connectYoutube": async ({ accountId, workspaceId }) => {
    requireVault();
    const db2 = getDb();
    const existing = accountId ? db2.select().from(accounts).where(drizzleOrm.eq(accounts.id, accountId)).get() : void 0;
    if (accountId && !existing) throw notFound("tài khoản YouTube");
    if (existing && existing.platform !== "youtube") throw new ApiError("VALIDATION", "Chỉ kết nối YouTube cho tài khoản YouTube");
    try {
      const login = await youtubeLogin(electron.BrowserWindow.getFocusedWindow());
      const yt2 = login.channel;
      if (existing?.externalId && existing.externalId !== yt2.id) {
        throw new ApiError(
          "VALIDATION",
          `Bạn vừa đăng nhập kênh "${yt2.title}" – khác kênh "${existing.displayName}". Đăng nhập đúng kênh, hoặc bấm "Kết nối YouTube" ở đầu trang để thêm kênh mới.`
        );
      }
      let ch = db2.select().from(channels).where(drizzleOrm.and(drizzleOrm.eq(channels.platform, "youtube"), drizzleOrm.eq(channels.externalId, yt2.id))).get();
      let created = false;
      if (!ch) {
        const acc = existing ?? db2.insert(accounts).values({
          id: newId(),
          workspaceId: workspaceId ?? null,
          platform: "youtube",
          displayName: yt2.title,
          handle: yt2.customUrl?.replace(/^@/, "") ?? null,
          externalId: yt2.id,
          sessionStatus: "valid",
          health: "ok"
        }).onConflictDoNothing().returning().get() ?? db2.select().from(accounts).where(drizzleOrm.and(drizzleOrm.eq(accounts.platform, "youtube"), drizzleOrm.eq(accounts.externalId, yt2.id))).get();
        ch = db2.insert(channels).values({
          id: newId(),
          accountId: acc.id,
          workspaceId: acc.workspaceId,
          platform: "youtube",
          kind: "yt_channel",
          name: yt2.title,
          handle: yt2.customUrl?.replace(/^@/, "") ?? null,
          externalId: yt2.id
        }).returning().get();
        created = true;
      }
      saveConnection(
        ch,
        {
          token: login.accessToken,
          refreshToken: login.refreshToken,
          accessExpiresAt: login.accessExpiresAt,
          channelId: yt2.id,
          clientKey: login.clientId || (youtubeClientId() ?? void 0),
          viaCloud: login.viaCloud || void 0,
          expiresAt: null
        },
        {
          name: yt2.title,
          handle: yt2.customUrl?.replace(/^@/, "") ?? ch.handle,
          avatarUrl: yt2.thumbnail ?? ch.avatarUrl,
          ...yt2.subscribers != null ? { followers: yt2.subscribers } : {}
        }
      );
      return { accountId: ch.accountId, channelName: yt2.title, created, message: `${created ? "Đã thêm" : "Đã kết nối lại"} kênh YouTube "${yt2.title}" · token tự làm mới` };
    } catch (err) {
      throw apiErr(err, "Kết nối YouTube thất bại");
    }
  },
  "integrations.tiktok": async () => ({
    clientKey: tiktokClientKey(),
    hasSecret: !!tiktokClientSecret(),
    redirectUri: tiktokRedirectUri(),
    defaultRedirectUri: DEFAULT_TIKTOK_REDIRECT,
    scopes: tiktokScopes(),
    defaultScopes: DEFAULT_TIKTOK_SCOPES,
    viaCloud: await cloudOAuthEnabled("tiktok")
  }),
  "integrations.setTiktok": async ({ clientKey, clientSecret, redirectUri, scopes }) => {
    requireVault();
    try {
      await saveTiktokApp({
        clientKey,
        clientSecret: clientSecret || null,
        redirectUri: redirectUri && redirectUri !== DEFAULT_TIKTOK_REDIRECT ? redirectUri : null,
        scopes: scopes && scopes !== DEFAULT_TIKTOK_SCOPES ? scopes : null
      });
      return { message: "Đã lưu Ứng dụng TikTok – Client Key/Secret hợp lệ" };
    } catch (err) {
      throw apiErr(err, "Không lưu được Ứng dụng TikTok");
    }
  },
  /** "Kết nối TikTok": đăng nhập TikTok → tạo (hoặc cập nhật) tài khoản + kênh TikTok, lưu token tự làm mới. */
  "accounts.connectTiktok": async ({ accountId, workspaceId }) => {
    requireVault();
    const db2 = getDb();
    const existing = accountId ? db2.select().from(accounts).where(drizzleOrm.eq(accounts.id, accountId)).get() : void 0;
    if (accountId && !existing) throw notFound("tài khoản TikTok");
    if (existing && existing.platform !== "tiktok") throw new ApiError("VALIDATION", "Chỉ kết nối TikTok cho tài khoản TikTok");
    try {
      const login = await tiktokLogin(electron.BrowserWindow.getFocusedWindow());
      let ch = db2.select().from(channels).where(drizzleOrm.and(drizzleOrm.eq(channels.platform, "tiktok"), drizzleOrm.eq(channels.externalId, login.openId))).get();
      if (existing) {
        const own = db2.select().from(channels).where(drizzleOrm.eq(channels.accountId, existing.id)).get();
        const prev = own ? readCred(own.id) : null;
        if (prev?.openId && prev.openId !== login.openId) {
          throw new ApiError(
            "VALIDATION",
            `Bạn vừa đăng nhập TikTok "${login.displayName}" – khác tài khoản đã kết nối với "${existing.displayName}". Đăng nhập đúng tài khoản, hoặc bấm "Kết nối TikTok" ở đầu trang để thêm tài khoản mới.`
          );
        }
        ch = own ?? ch;
      }
      let created = false;
      if (!ch) {
        const acc = db2.insert(accounts).values({
          id: newId(),
          workspaceId: workspaceId ?? null,
          platform: "tiktok",
          displayName: login.displayName,
          externalId: login.openId,
          sessionStatus: "valid",
          health: "ok"
        }).onConflictDoNothing().returning().get() ?? db2.select().from(accounts).where(drizzleOrm.and(drizzleOrm.eq(accounts.platform, "tiktok"), drizzleOrm.eq(accounts.externalId, login.openId))).get();
        ch = db2.insert(channels).values({ id: newId(), accountId: acc.id, workspaceId: acc.workspaceId, platform: "tiktok", kind: "tiktok_account", name: login.displayName, externalId: login.openId }).returning().get();
        created = true;
      }
      const clientKey = login.clientKey || tiktokClientKey();
      saveConnection(
        ch,
        { token: login.accessToken, openId: login.openId, refreshToken: login.refreshToken, clientKey, viaCloud: login.viaCloud || void 0, expiresAt: login.expiresAt },
        { externalId: ch.externalId ?? login.openId, avatarUrl: login.avatarUrl ?? ch.avatarUrl, ...login.followers != null ? { followers: login.followers } : {} }
      );
      const missing = ["video.publish", "user.info.basic"].filter((s) => !login.scopes.includes(s));
      return {
        accountId: ch.accountId,
        userName: login.displayName,
        created,
        missingScopes: missing,
        message: `${created ? "Đã thêm" : "Đã kết nối lại"} TikTok "${login.displayName}" · token tự làm mới${missing.length ? ` · thiếu quyền ${missing.join(", ")} – chưa đăng video được` : ""}`
      };
    } catch (err) {
      console.warn(`[oauth] Kết nối TikTok thất bại: ${err instanceof Error ? err.message : String(err)}`);
      throw apiErr(err, "Kết nối TikTok thất bại");
    }
  },
  "integrations.meta": async () => ({
    appId: metaAppId(),
    configId: metaConfigId(),
    hasSecret: !!metaAppSecret(),
    redirectUri: metaRedirectUri(),
    defaultRedirectUri: DEFAULT_REDIRECT_URI,
    instagram: metaInstagram(),
    scopes: fbScopes(),
    viaCloud: await metaViaCloud()
  }),
  "integrations.setMeta": async ({ appId, appSecret, configId, redirectUri, instagram }) => {
    requireVault();
    try {
      const { name } = await saveMetaApp(
        appId,
        appSecret ?? null,
        configId ?? null,
        redirectUri && redirectUri !== DEFAULT_REDIRECT_URI ? redirectUri : null,
        instagram ?? metaInstagram()
      );
      return { message: `Đã lưu Ứng dụng Meta${name ? ` "${name}"` : ""} – App ID/Secret hợp lệ` };
    } catch (err) {
      throw apiErr(err, "App ID / App Secret không hợp lệ");
    }
  },
  /**
   * "Kết nối Facebook": đăng nhập Facebook trong cửa sổ của app → tạo (hoặc dùng) tài khoản VIA tương ứng
   * → nhập mọi Fanpage + Instagram Business đã cấp quyền, lưu Page token dài hạn.
   */
  "accounts.connectFacebook": async ({ accountId, workspaceId }) => {
    requireVault();
    const db2 = getDb();
    let via = accountId ? db2.select().from(accounts).where(drizzleOrm.eq(accounts.id, accountId)).get() : void 0;
    if (accountId && !via) throw notFound("tài khoản Facebook");
    if (via && via.platform !== "facebook") throw new ApiError("VALIDATION", "Chỉ kết nối Facebook cho tài khoản Facebook");
    try {
      const login = await facebookLogin(electron.BrowserWindow.getFocusedWindow());
      if (via?.externalId && via.externalId !== login.userId) {
        throw new ApiError(
          "VALIDATION",
          `Bạn vừa đăng nhập Facebook "${login.name}" – khác tài khoản "${via.displayName}" (UID ${via.externalId}). Hãy đăng nhập đúng tài khoản, hoặc bấm "Kết nối Facebook" ở đầu trang để thêm tài khoản mới.`
        );
      }
      via ??= db2.select().from(accounts).where(drizzleOrm.and(drizzleOrm.eq(accounts.platform, "facebook"), drizzleOrm.eq(accounts.externalId, login.userId))).get();
      if (!via) {
        via = db2.insert(accounts).values({ id: newId(), workspaceId: workspaceId ?? null, platform: "facebook", displayName: login.name, externalId: login.userId, sessionStatus: "valid", health: "ok" }).returning().get();
      } else if (!via.externalId) {
        via = db2.update(accounts).set({ externalId: login.userId, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(accounts.id, via.id)).returning().get();
      }
      const result = await importPages(via, login.token, true, AbortSignal.timeout(9e4));
      const missing = missingFeatures(login.granted);
      if (missing.length) console.warn(`[oauth] thiếu quyền: ${missing.flatMap((m) => m.perms).join(", ")}`);
      return { ...result, accountId: via.id, userName: login.name, missing };
    } catch (err) {
      throw apiErr(err, "Kết nối Facebook thất bại");
    }
  },
  "channels.connect": async ({ channelId, token: token2, refreshToken, clientKey, clientSecret }) => {
    requireVault();
    const ch = getDb().select().from(channels).where(drizzleOrm.eq(channels.id, channelId)).get();
    if (!ch) throw notFound("kênh");
    const signal = timeoutSignal();
    try {
      if (ch.platform === "youtube") throw new ApiError("VALIDATION", 'Kênh YouTube kết nối bằng nút "Kết nối YouTube" (đăng nhập Google), không dán token');
      if (ch.platform === "facebook") return await connectFacebook(ch, token2, signal);
      if (ch.platform === "instagram") return await connectInstagram(ch, token2, signal);
      return await connectTikTok(ch, { token: token2, refreshToken, clientKey, clientSecret }, signal);
    } catch (err) {
      throw apiErr(err, "Không kết nối được");
    }
  },
  "channels.verify": async ({ id: id2 }) => {
    const ch = getDb().select().from(channels).where(drizzleOrm.eq(channels.id, id2)).get();
    if (!ch) throw notFound("kênh");
    const cred = readCred(id2);
    if (!cred) throw new ApiError("VALIDATION", "Kênh chưa kết nối API");
    const signal = timeoutSignal();
    try {
      if (ch.platform === "youtube") {
        const fresh = await freshYoutubeCred(id2, cred, signal);
        const yt2 = await youtubeMyChannel(fresh.token, signal);
        const row2 = markChannel(id2, { tokenStatus: "valid", health: "ok", name: yt2.title, ...yt2.subscribers != null ? { followers: yt2.subscribers } : {} });
        resolveTokenAlerts(id2);
        return { channel: row2, message: `Kết nối hợp lệ – kênh YouTube "${yt2.title}" · token tự làm mới` };
      }
      if (ch.platform === "tiktok") {
        const user = await tiktokUser(cred.token, signal);
        const row2 = markChannel(id2, { tokenStatus: statusFor(cred.expiresAt), health: "ok" });
        resolveTokenAlerts(id2);
        return { channel: row2, message: `Token hợp lệ – TikTok "${user.display_name ?? user.open_id}" · ${expiryText(cred.expiresAt)}` };
      }
      const info = await inspectFbToken(cred.token, signal);
      const name = info.type === "page" ? info.page.name : info.userName;
      const expiresAt = await tokenExpiry(cred.token, signal);
      writeCred(id2, { ...cred, expiresAt });
      const row = markChannel(id2, { tokenStatus: statusFor(expiresAt), tokenExpiresAt: expiresAt ? new Date(expiresAt) : null, health: "ok" });
      resolveTokenAlerts(id2);
      return { channel: row, message: `Token hợp lệ – "${name}" · ${expiryText(expiresAt)}` };
    } catch (err) {
      if (err instanceof PublishError && err.kind === "auth") markChannel(id2, { tokenStatus: "expired", health: "error" });
      throw apiErr(err, "Kiểm tra token thất bại");
    }
  },
  "channels.disconnect": ({ id: id2 }) => {
    const ch = getDb().select({ id: channels.id }).from(channels).where(drizzleOrm.eq(channels.id, id2)).get();
    if (!ch) throw notFound("kênh");
    clearCred(id2);
    markChannel(id2, { tokenStatus: "missing", tokenExpiresAt: null });
  },
  /**
   * Nhập toàn bộ Fanpage (và tài khoản Instagram Business liên kết) từ User token của VIA.
   * Có App ID/Secret → đổi sang token dài hạn trước, Page token sinh ra sẽ không hết hạn.
   */
  "accounts.importFacebook": async ({ accountId, userToken, appId, appSecret }) => {
    requireVault();
    const via = getDb().select().from(accounts).where(drizzleOrm.eq(accounts.id, accountId)).get();
    if (!via) throw notFound("tài khoản VIA");
    if (via.platform !== "facebook") throw new ApiError("VALIDATION", "Chỉ nhập Fanpage cho tài khoản Facebook");
    const signal = AbortSignal.timeout(9e4);
    try {
      let token2 = userToken;
      let longLived = false;
      if (appId && appSecret) {
        token2 = (await exchangeLongLived(userToken, appId, appSecret, signal)).token;
        longLived = true;
      } else if (await metaViaCloud()) {
        token2 = String((await cloudRefresh("facebook", userToken)).access_token ?? userToken);
        longLived = true;
      }
      return await importPages(via, token2, longLived, signal);
    } catch (err) {
      throw apiErr(err, "Nhập Fanpage thất bại");
    }
  },
  "posts.publishNow": ({ id: id2 }) => {
    try {
      publishNow(id2);
    } catch (err) {
      throw new ApiError("CONFLICT", err instanceof Error ? err.message : String(err));
    }
    return { queued: true, workerEnabled: publishEnabled() };
  },
  "insights.sync": () => syncInsights(),
  "insights.last": () => lastInsightsSync(),
  "insights.bestHours": ({ workspaceId }) => bestHours(workspaceId),
  "posts.worker": () => workerStatus(),
  "posts.setWorker": ({ enabled }) => {
    setPublishEnabled(enabled);
    return workerStatus();
  }
};
const meta = (r) => ({ provider: r.providerLabel, model: r.model, costUsd: r.costUsd });
const isoDay$1 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function trendingSearches(geo = "VN") {
  try {
    const res = await fetch(`${process.env.OMNI_TRENDS_URL ?? "https://trends.google.com/trending/rss"}?geo=${geo}`, { signal: AbortSignal.timeout(8e3) });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/title>/g)].map((m) => m[1].trim()).filter(Boolean).slice(0, 20);
  } catch {
    return [];
  }
}
function topPosts(workspaceId) {
  return getDb().select({ title: contentItems.title, engagements: scheduledPosts.engagements, views: scheduledPosts.views }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).innerJoin(contentItems, drizzleOrm.eq(contentItems.id, scheduledPosts.contentItemId)).where(
    drizzleOrm.and(
      drizzleOrm.eq(scheduledPosts.status, "published"),
      drizzleOrm.isNotNull(scheduledPosts.engagements),
      drizzleOrm.gte(scheduledPosts.publishedAt, new Date(Date.now() - 60 * 864e5)),
      workspaceId ? drizzleOrm.eq(channels.workspaceId, workspaceId) : void 0
    )
  ).orderBy(drizzleOrm.desc(scheduledPosts.engagements)).limit(10).all();
}
const planHandlers = {
  "plan.list": ({ workspaceId, from, to }) => getDb().select().from(contentIdeas).where(drizzleOrm.and(byWorkspace(contentIdeas.workspaceId, workspaceId), drizzleOrm.gte(contentIdeas.plannedDate, from), drizzleOrm.lte(contentIdeas.plannedDate, to))).orderBy(drizzleOrm.asc(contentIdeas.plannedDate), drizzleOrm.asc(contentIdeas.createdAt)).all(),
  "plan.generate": async ({ workspaceId, startDate, days, perDay, formats, useTrends }) => {
    const db2 = getDb();
    const ws = workspaceId ? db2.select().from(workspaces).where(drizzleOrm.eq(workspaces.id, workspaceId)).get() : void 0;
    if (workspaceId && !ws) throw notFound("Pocket");
    const niche = ws ? [ws.name, ws.description, ws.tags.join(" ")].filter(Boolean).join(" · ") : "Đa chủ đề giải trí";
    const chosen = (formats.length ? formats : CONTENT_FORMATS.map((f) => f.id)).map(formatById);
    const start2 = /* @__PURE__ */ new Date(`${startDate}T00:00:00`);
    const dates = Array.from({ length: days }, (_, i) => isoDay$1(new Date(start2.getTime() + i * 864e5)));
    const { ideas, meta: m } = await planContent({
      niche,
      brandVoice: ws?.brandVoice ?? null,
      topPosts: topPosts(workspaceId ?? null),
      trends: useTrends ? await trendingSearches() : [],
      formats: chosen.map((f) => ({ id: f.id, label: f.label, guide: f.guide })),
      dates,
      perDay,
      workspaceId: workspaceId ?? null
    });
    const allowed = new Set(chosen.map((f) => f.id));
    const valid = ideas.filter((i) => dates.includes(i.date)).slice(0, days * perDay);
    db2.transaction((tx) => {
      for (const i of valid)
        tx.insert(contentIdeas).values({
          id: newId(),
          workspaceId: workspaceId ?? null,
          plannedDate: i.date,
          title: i.title.trim(),
          format: allowed.has(i.format) ? i.format : chosen[0].id,
          hook: i.hook || null,
          description: i.description || null,
          source: "ai"
        }).run();
    });
    return { created: valid.length, meta: meta(m) };
  },
  "plan.save": ({ id: id2, ...input }) => {
    const db2 = getDb();
    if (!id2)
      return db2.insert(contentIdeas).values({ id: newId(), ...input, source: "manual" }).returning().get();
    const row = db2.update(contentIdeas).set({ ...input, updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentIdeas.id, id2)).returning().get();
    if (!row) throw notFound("ý tưởng");
    return row;
  },
  "plan.delete": ({ id: id2 }) => {
    if (!getDb().delete(contentIdeas).where(drizzleOrm.eq(contentIdeas.id, id2)).run().changes) throw notFound("ý tưởng");
  },
  /** Ý tưởng → dự án Xưởng video theo mẫu định dạng (mở Xưởng để sinh kịch bản & render). */
  "plan.toVideo": ({ id: id2 }) => {
    const db2 = getDb();
    const idea = db2.select().from(contentIdeas).where(drizzleOrm.eq(contentIdeas.id, id2)).get();
    if (!idea) throw notFound("ý tưởng");
    if (idea.projectId && db2.select({ id: videoProjects.id }).from(videoProjects).where(drizzleOrm.eq(videoProjects.id, idea.projectId)).get()) return { projectId: idea.projectId };
    if (formatById(idea.format).kind !== "video") throw new ApiError("VALIDATION", 'Định dạng này là bài viết – dùng "Tạo bài viết"');
    const clean2 = (t2) => (t2 ?? "").trim().replace(/[.…!?]+$/u, "");
    const topic = [clean2(idea.title), idea.hook ? `Mở đầu: ${clean2(idea.hook)}` : "", clean2(idea.description)].filter(Boolean).join(". ").slice(0, 1e3);
    return db2.transaction((tx) => {
      const p = tx.insert(videoProjects).values({ id: newId(), workspaceId: idea.workspaceId, topic, format: idea.format }).returning().get();
      tx.update(contentIdeas).set({ projectId: p.id, status: "in_progress", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentIdeas.id, id2)).run();
      return { projectId: p.id };
    });
  },
  /** Ý tưởng → bài viết nháp trong Kho nội dung. */
  "plan.toPost": ({ id: id2 }) => {
    const db2 = getDb();
    const idea = db2.select().from(contentIdeas).where(drizzleOrm.eq(contentIdeas.id, id2)).get();
    if (!idea) throw notFound("ý tưởng");
    if (idea.contentItemId) return { contentItemId: idea.contentItemId };
    return db2.transaction((tx) => {
      const item = tx.insert(contentItems).values({
        id: newId(),
        workspaceId: idea.workspaceId,
        kind: "text",
        title: idea.title.slice(0, 300),
        caption: [idea.hook, idea.description].filter(Boolean).join("\n\n") || null,
        status: "draft"
      }).returning().get();
      tx.update(contentIdeas).set({ contentItemId: item.id, status: "in_progress", updatedAt: /* @__PURE__ */ new Date() }).where(drizzleOrm.eq(contentIdeas.id, id2)).run();
      return { contentItemId: item.id };
    });
  }
};
const GOAL_METRICS = {
  followers: { label: "Người theo dõi", unit: "người", hint: "Số người theo dõi hiện tại của kênh" },
  watch_minutes_60d: { label: "Phút xem 60 ngày", unit: "phút", hint: "Tổng phút xem video 60 ngày gần nhất (Facebook)" },
  views_30d: { label: "Lượt xem 30 ngày", unit: "lượt", hint: "Tổng lượt xem/tiếp cận 30 ngày gần nhất" },
  videos_30d: { label: "Video đăng 30 ngày", unit: "video", hint: "Số video/Reels đã đăng qua app trong 30 ngày" },
  engagements_30d: { label: "Tương tác 30 ngày", unit: "lượt", hint: "Tổng tương tác 30 ngày gần nhất" }
};
const DAY = 864e5;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const LENGTH_BUCKETS = [
  { key: "lt15", label: "Dưới 15 giây", max: 15 },
  { key: "15_30", label: "15–30 giây", max: 30 },
  { key: "30_60", label: "30–60 giây", max: 60 },
  { key: "gt60", label: "Trên 60 giây", max: Infinity }
];
function group(posts, keyOf) {
  const map = /* @__PURE__ */ new Map();
  for (const p of posts) {
    const k = keyOf(p);
    if (!k) continue;
    const g = map.get(k.key) ?? { label: k.label, list: [] };
    g.list.push(p);
    map.set(k.key, g);
  }
  const avg = (xs) => {
    const v = xs.filter((x) => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null;
  };
  return [...map.entries()].map(([key2, g]) => ({
    key: key2,
    label: g.label,
    posts: g.list.length,
    avgViews: avg(g.list.map((p) => p.views ?? p.reach)),
    avgEngagements: avg(g.list.map((p) => p.engagements)),
    avgRetention: avg(g.list.map((p) => p.retention))
  })).sort((a, b) => (b.avgEngagements ?? 0) - (a.avgEngagements ?? 0));
}
function goalCurrent(channelId, metric) {
  const db2 = getDb();
  const since = (days) => isoDay(Date.now() - (days - 1) * DAY);
  switch (metric) {
    case "followers":
      return db2.select({ f: channels.followers }).from(channels).where(drizzleOrm.eq(channels.id, channelId)).get()?.f ?? 0;
    case "watch_minutes_60d":
    case "views_30d":
    case "engagements_30d": {
      const col = metric === "watch_minutes_60d" ? channelMetricsDaily.watchMinutes : metric === "views_30d" ? channelMetricsDaily.views : channelMetricsDaily.engagements;
      const days = metric === "watch_minutes_60d" ? 60 : 30;
      return db2.select({ v: drizzleOrm.sum(col).mapWith(Number) }).from(channelMetricsDaily).where(drizzleOrm.and(drizzleOrm.eq(channelMetricsDaily.channelId, channelId), drizzleOrm.gte(channelMetricsDaily.day, since(days)))).get()?.v ?? 0;
    }
    case "videos_30d":
      return db2.select({ id: scheduledPosts.id }).from(scheduledPosts).innerJoin(contentItems, drizzleOrm.eq(contentItems.id, scheduledPosts.contentItemId)).where(
        drizzleOrm.and(
          drizzleOrm.eq(scheduledPosts.channelId, channelId),
          drizzleOrm.eq(scheduledPosts.status, "published"),
          drizzleOrm.inArray(contentItems.kind, ["video", "reel"]),
          drizzleOrm.gte(scheduledPosts.publishedAt, new Date(Date.now() - 30 * DAY))
        )
      ).all().length;
  }
}
const analyticsHandlers = {
  "analytics.overview": ({ workspaceId, channelId, days }) => {
    const db2 = getDb();
    const rows = db2.select({
      id: scheduledPosts.id,
      title: contentItems.title,
      kind: contentItems.kind,
      durationSec: contentItems.durationSec,
      contentItemId: contentItems.id,
      channelName: channels.name,
      platform: channels.platform,
      publishedAt: scheduledPosts.publishedAt,
      permalink: scheduledPosts.permalink,
      reach: scheduledPosts.reach,
      views: scheduledPosts.views,
      engagements: scheduledPosts.engagements,
      avgWatchSec: scheduledPosts.avgWatchSec
    }).from(scheduledPosts).innerJoin(channels, drizzleOrm.eq(channels.id, scheduledPosts.channelId)).innerJoin(contentItems, drizzleOrm.eq(contentItems.id, scheduledPosts.contentItemId)).where(
      drizzleOrm.and(
        drizzleOrm.eq(scheduledPosts.status, "published"),
        drizzleOrm.gte(scheduledPosts.publishedAt, new Date(Date.now() - days * DAY)),
        channelId ? drizzleOrm.eq(scheduledPosts.channelId, channelId) : void 0,
        workspaceId ? drizzleOrm.eq(channels.workspaceId, workspaceId) : void 0
      )
    ).orderBy(drizzleOrm.desc(scheduledPosts.publishedAt)).all();
    const ids = rows.map((r) => r.contentItemId);
    const formats = new Map(
      ids.length ? db2.select({ contentItemId: videoProjects.contentItemId, format: videoProjects.format }).from(videoProjects).where(drizzleOrm.inArray(videoProjects.contentItemId, ids)).all().map((r) => [r.contentItemId, r.format]) : []
    );
    const posts = rows.map((r) => {
      const fmt = formats.get(r.contentItemId) ?? null;
      const retention = r.avgWatchSec != null && r.durationSec ? Math.min(100, Math.round(r.avgWatchSec / r.durationSec * 1e3) / 10) : null;
      return {
        id: r.id,
        title: r.title,
        kind: r.kind,
        channelName: r.channelName,
        platform: r.platform,
        publishedAt: r.publishedAt,
        permalink: r.permalink,
        durationSec: r.durationSec,
        format: fmt,
        formatLabel: fmt ? formatById(fmt).label : r.kind === "video" || r.kind === "reel" ? "Video (không theo mẫu)" : "Bài viết / ảnh",
        reach: r.reach,
        views: r.views,
        engagements: r.engagements,
        avgWatchSec: r.avgWatchSec,
        retention
      };
    });
    const withMetrics = posts.filter((p) => p.engagements != null);
    const sorted = [...withMetrics].sort((a, b) => (b.engagements ?? 0) - (a.engagements ?? 0));
    const rets = posts.map((p) => p.retention).filter((x) => x != null);
    return {
      days,
      posts: posts.length,
      postsWithMetrics: withMetrics.length,
      totalViews: posts.reduce((a, p) => a + (p.views ?? p.reach ?? 0), 0),
      totalEngagements: posts.reduce((a, p) => a + (p.engagements ?? 0), 0),
      avgRetention: rets.length ? Math.round(rets.reduce((a, b) => a + b, 0) / rets.length * 10) / 10 : null,
      byFormat: group(posts, (p) => ({ key: p.format ?? `kind:${p.formatLabel}`, label: p.formatLabel })),
      byLength: group(posts, (p) => {
        if (!p.durationSec) return null;
        const b = LENGTH_BUCKETS.find((x) => p.durationSec < x.max) ?? LENGTH_BUCKETS[LENGTH_BUCKETS.length - 1];
        return { key: b.key, label: b.label };
      }),
      top: sorted.slice(0, 5),
      // Không trùng với danh sách tốt nhất khi có ít bài
      bottom: sorted.slice(Math.max(5, sorted.length - 5)).reverse()
    };
  },
  "analytics.goals": ({ workspaceId, channelId }) => {
    const db2 = getDb();
    return db2.select({ goal: channelGoals, channelName: channels.name, platform: channels.platform }).from(channelGoals).innerJoin(channels, drizzleOrm.eq(channels.id, channelGoals.channelId)).where(drizzleOrm.and(channelId ? drizzleOrm.eq(channelGoals.channelId, channelId) : void 0, workspaceId ? drizzleOrm.eq(channels.workspaceId, workspaceId) : void 0)).orderBy(channels.name, drizzleOrm.sql`${channelGoals.createdAt}`).all().map(({ goal, channelName, platform: platform2 }) => {
      const current2 = goalCurrent(goal.channelId, goal.metric);
      return {
        ...goal,
        channelName,
        platform: platform2,
        current: current2,
        progress: goal.target ? Math.min(100, Math.round(current2 / goal.target * 1e3) / 10) : 0,
        metricLabel: GOAL_METRICS[goal.metric].label
      };
    });
  },
  "analytics.saveGoal": ({ id: id2, ...input }) => {
    const db2 = getDb();
    if (!db2.select({ id: channels.id }).from(channels).where(drizzleOrm.eq(channels.id, input.channelId)).get()) throw notFound("kênh");
    if (!id2)
      return db2.insert(channelGoals).values({ id: newId(), ...input }).returning().get();
    const row = db2.update(channelGoals).set(input).where(drizzleOrm.eq(channelGoals.id, id2)).returning().get();
    if (!row) throw notFound("mục tiêu");
    return row;
  },
  "analytics.deleteGoal": ({ id: id2 }) => {
    if (!getDb().delete(channelGoals).where(drizzleOrm.eq(channelGoals.id, id2)).run().changes) throw notFound("mục tiêu");
  }
};
function filmGate() {
  const g = { veo: veoAvailable(), veoFlow: veoSource() === "flow", seedance: isReady("seedance"), imageGoogle: isReady("google_image"), imageFal: isReady("fal"), imageFlow: flowImagesReady() };
  return { ...g, ok: (g.veo || g.seedance) && (g.imageGoogle || g.imageFal || g.imageFlow) };
}
function requireGate() {
  const g = filmGate();
  if (!g.ok)
    throw new ApiError(
      "VALIDATION",
      !g.veo && !g.seedance ? "Xưởng Phim cần Veo (key Gemini hoặc đăng nhập Google Flow) hoặc Seedance (Fal.ai) – thiết lập ở Cài đặt & Khóa API" : "Chưa có nguồn tạo ảnh (Google Flow, Gemini – Ảnh AI hoặc Fal.ai) – thiết lập ở Cài đặt & Khóa API"
    );
}
function getFilm(id2) {
  const f = getDb().select().from(filmProjects).where(drizzleOrm.eq(filmProjects.id, id2)).get();
  if (!f) throw notFound("phim");
  return f;
}
const toTake = (t2) => {
  const { refs: _refs, notBefore: _nb, ...rest } = t2;
  return {
    ...rest,
    progress: t2.status === "running" ? takeProgress(t2.id) : null,
    inFlow: t2.kind === "video" && t2.status === "done" && !!t2.file && canFlowUpscale(node_path.join(mediaDir(), t2.file))
  };
};
function detail(id2) {
  const db2 = getDb();
  const film = getFilm(id2);
  const assets = db2.select().from(filmAssets).where(drizzleOrm.eq(filmAssets.filmId, id2)).orderBy(drizzleOrm.asc(filmAssets.kind), drizzleOrm.asc(filmAssets.position)).all();
  const takes = db2.select().from(filmTakes).where(drizzleOrm.eq(filmTakes.filmId, id2)).orderBy(drizzleOrm.desc(filmTakes.createdAt)).all();
  const byAsset = /* @__PURE__ */ new Map();
  for (const t2 of takes) byAsset.set(t2.assetId, [...byAsset.get(t2.assetId) ?? [], toTake(t2)]);
  const spent = takes.reduce((a, t2) => a + (t2.status === "done" ? t2.costUsd : 0), 0);
  let seriesInfo = null;
  if (film.seriesId && film.episodeId) {
    const sr = db2.select({ id: series.id, title: series.title }).from(series).where(drizzleOrm.eq(series.id, film.seriesId)).get();
    const ep = db2.select({ number: seriesEpisodes.number, title: seriesEpisodes.title }).from(seriesEpisodes).where(drizzleOrm.eq(seriesEpisodes.id, film.episodeId)).get();
    if (sr && ep) seriesInfo = { id: sr.id, title: sr.title, episodeNumber: ep.number, episodeTitle: ep.title };
  }
  return { film, series: seriesInfo, assets: assets.map((a) => ({ ...a, takes: byAsset.get(a.id) ?? [] })), spentUsd: Math.round(spent * 1e3) / 1e3 };
}
function selectedFile(a, takes) {
  const t2 = a.selectedTakeId ? takes.get(a.selectedTakeId) : void 0;
  return t2?.status === "done" && t2.file ? t2.file : null;
}
function prepare(filmId, assetIds, kind = "image") {
  const db2 = getDb();
  const film = getFilm(filmId);
  const all = db2.select().from(filmAssets).where(drizzleOrm.eq(filmAssets.filmId, filmId)).all();
  const byId2 = new Map(all.map((a) => [a.id, a]));
  const takes = new Map(
    db2.select().from(filmTakes).where(drizzleOrm.and(drizzleOrm.eq(filmTakes.filmId, filmId), drizzleOrm.eq(filmTakes.status, "done"))).all().map((t2) => [t2.id, t2])
  );
  const jobs2 = [];
  const skipped = [];
  const pending2 = new Set(all.filter((x) => x.proposal === "pending").map((x) => x.id));
  for (const id2 of assetIds) {
    const a = byId2.get(id2);
    if (!a) continue;
    if (pending2.has(a.id)) {
      skipped.push({ assetId: a.id, reason: `${a.name}: nhân vật đề xuất chưa duyệt (duyệt ở bước Kịch bản)` });
      continue;
    }
    if (a.kind === "shot" && a.characterIds.some((c) => pending2.has(c))) {
      skipped.push({ assetId: a.id, reason: `${a.name}: có nhân vật đề xuất chưa duyệt` });
      continue;
    }
    if (kind === "video") {
      if (a.kind !== "shot") continue;
      const start2 = selectedFile(a, takes);
      if (!start2) {
        skipped.push({ assetId: a.id, reason: `${a.name}: chưa có khung hình đã chọn` });
        continue;
      }
      jobs2.push({ asset: a, prompt: videoPrompt(film, a, film.videoAudio, all.filter((x) => x.kind === "character")), refs: [start2], seconds: a.durationSec });
      continue;
    }
    if (a.kind === "character") jobs2.push({ asset: a, prompt: characterPrompt(film, a), refs: [] });
    else if (a.kind === "location") jobs2.push({ asset: a, prompt: locationPrompt(film, a), refs: [] });
    else {
      const chars = a.characterIds.map((c) => byId2.get(c)).filter((c) => !!c);
      const loc = a.locationId ? byId2.get(a.locationId) ?? null : null;
      const missing = [...chars, ...loc ? [loc] : []].filter((x) => !selectedFile(x, takes)).map((x) => x.name);
      if (missing.length) {
        skipped.push({ assetId: a.id, reason: `Chưa có ảnh đã chọn cho: ${missing.join(", ")}` });
        continue;
      }
      jobs2.push({ asset: a, prompt: shotPrompt(film, a, chars, loc), refs: [...chars, ...loc ? [loc] : []].map((x) => selectedFile(x, takes)) });
    }
  }
  return { jobs: jobs2, skipped };
}
function estimate(filmId, assetIds, takesEach, kind = "image") {
  const film = getFilm(filmId);
  const { jobs: jobs2, skipped } = prepare(filmId, assetIds, kind);
  const takes = jobs2.length * takesEach;
  if (kind === "video") {
    const plans = jobs2.map((j) => videoPlan(film, j.seconds ?? 6));
    const usd = plans.reduce((a, p) => a + p.usd, 0) * takesEach;
    const seconds = plans.reduce((a, p) => a + p.seconds, 0) * takesEach;
    return { kind, takes, seconds, model: plans[0]?.model ?? videoPlan(film, 6).model, usd: Math.round(usd * 100) / 100, skipped, jobs: jobs2 };
  }
  const model = filmImageModel(film.imageEngine, jobs2.some((j) => j.refs.length));
  return { kind, takes, model, usd: Math.round(unitCost(model, takes) * 1e3) / 1e3, skipped, jobs: jobs2 };
}
function requireVideoEngine(film) {
  const g = filmGate();
  if (film.videoEngine === "seedance" && !g.seedance) throw new ApiError("VALIDATION", "Phim đang chọn Seedance nhưng chưa có key Fal.ai – nhập ở Cài đặt hoặc đổi sang Veo");
  if (film.videoEngine === "veo" && !g.veo) throw new ApiError("VALIDATION", veoSource() === "flow" ? "Phim đang chọn Veo qua Google Flow nhưng chưa đăng nhập Flow – vào Cài đặt › Google Flow" : "Phim đang chọn Veo nhưng chưa có key Gemini (Veo) – nhập ở Cài đặt hoặc đổi sang Seedance");
}
const now = () => /* @__PURE__ */ new Date();
async function ensureAssetPrompts(filmId, assetIds, opts = {}) {
  const db2 = getDb();
  const film = getFilm(filmId);
  const all = db2.select().from(filmAssets).where(drizzleOrm.eq(filmAssets.filmId, filmId)).all();
  const byId2 = new Map(all.map((a) => [a.id, a]));
  const involved = /* @__PURE__ */ new Set();
  for (const id2 of assetIds) {
    const a = byId2.get(id2);
    if (!a) continue;
    involved.add(a.id);
    if (a.kind === "shot" && !opts.only) {
      a.characterIds.forEach((c) => involved.add(c));
      if (a.locationId) involved.add(a.locationId);
    }
  }
  const rows = [...involved].map((id2) => byId2.get(id2)).filter((a) => !!a && !a.promptManual);
  const fail2 = (err) => new ApiError("AI", `Không cập nhật được prompt tiếng Anh từ mô tả tiếng Việt: ${err instanceof Error ? err.message : String(err)}`);
  for (const a of rows.filter((x) => x.kind === "character" && x.seriesCharacterId)) {
    let look;
    try {
      look = (await ensureCharacterPrompt(a.seriesCharacterId)).appearanceEn?.trim();
    } catch (err) {
      throw fail2(err);
    }
    if (look && look !== a.description) db2.update(filmAssets).set({ description: look, descriptionSrc: a.summary.trim(), updatedAt: now() }).where(drizzleOrm.eq(filmAssets.id, a.id)).run();
  }
  const stale = rows.filter((a) => !a.seriesCharacterId && a.summary.trim() && (opts.force || a.descriptionSrc !== a.summary.trim() || !a.description.trim()));
  if (!stale.length) return;
  const name = (id2) => id2 ? byId2.get(id2)?.name ?? "" : "";
  let next;
  try {
    next = await filmAssetDescriptions(
      stale.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        summary: a.summary.trim(),
        current: a.description,
        context: a.kind === "shot" ? [a.characterIds.length ? `characters: ${a.characterIds.map(name).filter(Boolean).join(", ")}` : "", a.locationId ? `location: ${name(a.locationId)}` : ""].filter(Boolean).join("; ") : void 0
      })),
      { title: film.title, style: film.style },
      film.workspaceId
    );
  } catch (err) {
    throw fail2(err);
  }
  for (const a of stale) {
    const d = next.get(a.id);
    if (d) db2.update(filmAssets).set({ description: d, descriptionSrc: a.summary.trim(), updatedAt: now() }).where(drizzleOrm.eq(filmAssets.id, a.id)).run();
  }
  console.info(`[film] cập nhật prompt tiếng Anh từ tiếng Việt: ${next.size}/${stale.length} mục`);
}
const touchFilm = (id2) => void getDb().update(filmProjects).set({ updatedAt: now() }).where(drizzleOrm.eq(filmProjects.id, id2)).run();
const filmHandlers = {
  "film.gate": () => filmGate(),
  "film.list": ({ workspaceId }) => {
    const db2 = getDb();
    const films = db2.select().from(filmProjects).where(workspaceId ? drizzleOrm.eq(filmProjects.workspaceId, workspaceId) : void 0).orderBy(drizzleOrm.desc(filmProjects.updatedAt)).all();
    if (!films.length) return [];
    const counts = db2.select({ filmId: filmAssets.filmId, kind: filmAssets.kind, n: drizzleOrm.sql`count(*)` }).from(filmAssets).where(
      drizzleOrm.inArray(
        filmAssets.filmId,
        films.map((f) => f.id)
      )
    ).groupBy(filmAssets.filmId, filmAssets.kind).all();
    const covers = db2.select({ filmId: filmTakes.filmId, file: filmTakes.file, kind: filmAssets.kind, pos: filmAssets.position }).from(filmAssets).innerJoin(filmTakes, drizzleOrm.eq(filmTakes.id, filmAssets.selectedTakeId)).where(
      drizzleOrm.and(
        drizzleOrm.inArray(
          filmAssets.filmId,
          films.map((f) => f.id)
        ),
        drizzleOrm.eq(filmTakes.status, "done")
      )
    ).all();
    const rank = { shot: 0, location: 1, character: 2 };
    return films.map((f) => {
      const c = (k) => counts.find((x) => x.filmId === f.id && x.kind === k)?.n ?? 0;
      const cover = covers.filter((x) => x.filmId === f.id && x.file).sort((a, b) => rank[a.kind] - rank[b.kind] || a.pos - b.pos)[0]?.file ?? null;
      return { ...f, characters: c("character"), locations: c("location"), shots: c("shot"), cover };
    });
  },
  "film.create": (input) => {
    requireGate();
    const g = filmGate();
    return getDb().insert(filmProjects).values({
      id: newId(),
      ...input,
      workspaceId: input.workspaceId ?? null,
      videoEngine: input.videoEngine ?? (g.seedance ? "seedance" : "veo"),
      // Ảnh: Gemini nếu có (rẻ, không cần fal), không thì Nano Banana qua fal
      imageEngine: g.imageGoogle ? "google" : "fal"
    }).returning().get();
  },
  "film.get": ({ id: id2 }) => {
    syncSeriesCast(id2);
    return detail(id2);
  },
  "film.update": ({ id: id2, patch }) => {
    let styleFor;
    if (patch.style !== void 0) {
      const f = getFilm(id2);
      styleFor = `manual:${styleKey({ genre: patch.genre ?? f.genre, visualStyle: patch.visualStyle ?? f.visualStyle, notes: patch.notes ?? f.notes })}`;
    }
    const row = getDb().update(filmProjects).set({ ...patch, ...styleFor ? { styleFor } : {}, updatedAt: now() }).where(drizzleOrm.eq(filmProjects.id, id2)).returning().get();
    if (!row) throw notFound("phim");
    return row;
  },
  "film.delete": ({ id: id2 }) => {
    const db2 = getDb();
    cancelTakes(
      db2.select({ id: filmTakes.id }).from(filmTakes).where(drizzleOrm.eq(filmTakes.filmId, id2)).all().map((t2) => t2.id)
    );
    db2.delete(filmProjects).where(drizzleOrm.eq(filmProjects.id, id2)).run();
    db2.update(seriesEpisodes).set({ filmId: null }).where(drizzleOrm.eq(seriesEpisodes.filmId, id2)).run();
    node_fs.rmSync(filmDir(id2), { recursive: true, force: true });
  },
  /** AI viết kịch bản → THAY toàn bộ nhân vật, bối cảnh, cảnh quay (kể cả ảnh đã tạo) */
  /**
   * AI viết kịch bản → THAY bối cảnh, cảnh quay (và nhân vật, với phim thường).
   * Phim của tập series: GIỮ dàn nhân vật gốc (kèm ảnh đã chọn); nhân vật mới AI cần → đề xuất chờ duyệt.
   */
  "film.generateScript": async ({ id: id2 }) => {
    if (!getFilm(id2).idea.trim()) throw new ApiError("VALIDATION", "Nhập ý tưởng phim trước");
    await ensureFilmStyle(id2);
    const film = getFilm(id2);
    const ctx = seriesScriptContext(id2);
    const { script, model, costUsd } = await writeFilmScript(film, ctx);
    const db2 = getDb();
    const all = db2.select().from(filmAssets).where(drizzleOrm.eq(filmAssets.filmId, id2)).all();
    const keep = new Set(ctx ? all.filter((a) => a.kind === "character" && a.seriesCharacterId).map((a) => a.id) : []);
    const removed = all.filter((a) => !keep.has(a.id));
    const oldTakes = db2.select({ id: filmTakes.id, file: filmTakes.file, assetId: filmTakes.assetId }).from(filmTakes).where(drizzleOrm.eq(filmTakes.filmId, id2)).all().filter((t2) => !keep.has(t2.assetId));
    cancelTakes(oldTakes.map((t2) => t2.id));
    let proposals = 0;
    db2.transaction((tx) => {
      if (removed.length)
        tx.delete(filmAssets).where(
          drizzleOrm.inArray(
            filmAssets.id,
            removed.map((a) => a.id)
          )
        ).run();
      const ids = /* @__PURE__ */ new Map();
      const add = (v) => {
        const aid = newId();
        tx.insert(filmAssets).values({ id: aid, filmId: id2, descriptionSrc: (v.summary ?? "").trim(), ...v }).run();
        return aid;
      };
      if (ctx) {
        for (const a of all.filter((x) => keep.has(x.id))) {
          ids.set(`c:${a.name.toLowerCase()}`, a.id);
          const voice = script.characters.find((c) => c.name.trim().toLowerCase() === a.name.trim().toLowerCase())?.voice?.trim();
          if (voice && !a.voiceProfile) {
            tx.update(filmAssets).set({ voiceProfile: voice }).where(drizzleOrm.eq(filmAssets.id, a.id)).run();
            if (a.seriesCharacterId)
              tx.update(seriesCharacters).set({ voiceProfile: voice }).where(drizzleOrm.and(drizzleOrm.eq(seriesCharacters.id, a.seriesCharacterId), drizzleOrm.isNull(seriesCharacters.voiceProfile))).run();
          }
        }
        let pos = keep.size;
        const extra = script.characters.filter((c) => !ids.has(`c:${c.name.toLowerCase()}`)).map((c) => ({ ...c, scope: "episode", reason: "AI thêm vào kịch bản" }));
        for (const c of [...script.newCharacters, ...extra].slice(0, 5)) {
          if (ids.has(`c:${c.name.toLowerCase()}`)) continue;
          ids.set(
            `c:${c.name.toLowerCase()}`,
            add({ kind: "character", position: pos++, name: c.name, summary: c.summary, description: c.look, voiceProfile: c.voice || null, proposal: "pending", proposedScope: c.scope, proposalReason: c.reason || null })
          );
          proposals++;
        }
      } else {
        script.characters.forEach((c, i) => ids.set(`c:${c.name.toLowerCase()}`, add({ kind: "character", position: i, name: c.name, summary: c.summary, description: c.look, voiceProfile: c.voice || null })));
      }
      script.locations.forEach((l, i) => ids.set(`l:${l.name.toLowerCase()}`, add({ kind: "location", position: i, name: l.name, summary: l.summary, description: l.look })));
      script.shots.forEach(
        (s, i) => add({
          kind: "shot",
          position: i,
          name: `Cảnh ${i + 1}`,
          summary: s.summary,
          description: s.action,
          camera: s.camera,
          durationSec: s.durationSec,
          dialogue: s.dialogue ?? null,
          // Phụ đề tiếng Việt AI viết kèm kịch bản – đánh dấu khớp lời thoại hiện tại
          ...wantsVietnameseSubtitle(film) && s.dialogue?.trim() && s.subtitle?.trim() ? { subtitle: s.subtitle.trim(), subtitleSrc: s.dialogue.trim() } : {},
          locationId: ids.get(`l:${s.location.toLowerCase()}`) ?? null,
          characterIds: s.characters.map((n) => ids.get(`c:${n.toLowerCase()}`)).filter((x) => !!x)
        })
      );
      tx.update(filmProjects).set({
        // Phim của tập giữ tên "Series – Tập N"; phim thường lấy tên AI đặt
        title: ctx ? film.title : script.title.trim() || film.title,
        logline: script.logline || film.logline,
        // Giữ phong cách người dùng đã nhập; trống thì lấy của AI
        style: film.style.trim() || script.style,
        updatedAt: now()
      }).where(drizzleOrm.eq(filmProjects.id, id2)).run();
    });
    for (const t2 of oldTakes) if (t2.file) node_fs.rmSync(node_path.join(mediaDir(), t2.file), { force: true });
    const reusedLocations = ctx ? reuseSeriesLocations(id2) : 0;
    const castUsed = ctx ? script.characters.filter((c) => keep.size && all.some((a) => keep.has(a.id) && a.name.toLowerCase() === c.name.toLowerCase())).length : script.characters.length;
    return { model, costUsd, characters: castUsed, locations: script.locations.length, shots: script.shots.length, proposals, reusedLocations };
  },
  /** Duyệt nhân vật AI đề xuất (chỉ tập này / thêm vào series / bỏ) */
  "film.resolveProposals": ({ filmId, decisions }) => {
    getFilm(filmId);
    const r = resolveProposals(filmId, decisions);
    touchFilm(filmId);
    return r;
  },
  /** Bối cảnh đã có ảnh ở các tập khác của series (thư viện bối cảnh) */
  "film.seriesLocations": ({ filmId }) => {
    getFilm(filmId);
    return seriesLocations(filmId);
  },
  /** Dùng bối cảnh của tập khác cho một bối cảnh của tập này (chép ảnh đã chọn + mô tả) */
  "film.adoptLocation": ({ filmId, assetId, sourceAssetId, copyText }) => {
    getFilm(filmId);
    try {
      adoptSeriesLocation(filmId, assetId, sourceAssetId, copyText);
    } catch (err) {
      throw new ApiError("VALIDATION", err instanceof Error ? err.message : String(err));
    }
    touchFilm(filmId);
  },
  /** Đặt bảng nhân vật đã chọn làm ảnh chuẩn của nhân vật series (tập sau dùng ảnh này) */
  "film.promoteToSeries": ({ assetId }) => {
    try {
      promoteToSeries(assetId);
    } catch (err) {
      throw new ApiError("VALIDATION", err instanceof Error ? err.message : String(err));
    }
  },
  "film.saveAsset": ({ filmId, id: id2, kind, patch }) => {
    const db2 = getDb();
    getFilm(filmId);
    touchFilm(filmId);
    if (id2) {
      let subtitleSrc = {};
      if (patch.subtitle !== void 0) {
        const dialogue = patch.dialogue !== void 0 ? patch.dialogue : db2.select({ d: filmAssets.dialogue }).from(filmAssets).where(drizzleOrm.eq(filmAssets.id, id2)).get()?.d;
        subtitleSrc = { subtitleSrc: patch.subtitle?.trim() ? dialogue?.trim() ?? null : null };
      }
      const row = db2.update(filmAssets).set({ ...patch, ...subtitleSrc, ...patch.promptManual === false ? { descriptionSrc: null } : {}, updatedAt: now() }).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.id, id2), drizzleOrm.eq(filmAssets.filmId, filmId))).returning().get();
      if (!row) throw notFound("mục");
      if (row.seriesCharacterId && (patch.voiceProfile !== void 0 || patch.voiceId !== void 0 || patch.voiceProvider !== void 0))
        db2.update(seriesCharacters).set({
          ...patch.voiceProfile !== void 0 ? { voiceProfile: patch.voiceProfile } : {},
          ...patch.voiceProvider !== void 0 ? { voiceProvider: patch.voiceProvider } : {},
          ...patch.voiceId !== void 0 ? { voiceId: patch.voiceId } : {}
        }).where(drizzleOrm.eq(seriesCharacters.id, row.seriesCharacterId)).run();
      return row;
    }
    const last = db2.select({ p: drizzleOrm.sql`coalesce(max(${filmAssets.position}), -1)` }).from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.filmId, filmId), drizzleOrm.eq(filmAssets.kind, kind))).get();
    const count = (last?.p ?? -1) + 2;
    return db2.insert(filmAssets).values({
      id: newId(),
      filmId,
      kind,
      position: (last?.p ?? -1) + 1,
      name: patch.name ?? (kind === "shot" ? `Cảnh ${count}` : kind === "character" ? `Nhân vật ${count}` : `Bối cảnh ${count}`),
      // Có sẵn prompt tiếng Anh → coi như khớp tóm tắt; chưa có → dịch từ tóm tắt khi tạo
      descriptionSrc: patch.description?.trim() ? (patch.summary ?? "").trim() : null,
      subtitleSrc: patch.subtitle?.trim() ? patch.dialogue?.trim() ?? null : null,
      ...patch
    }).returning().get();
  },
  "film.deleteAsset": ({ id: id2 }) => {
    const db2 = getDb();
    const a = db2.select().from(filmAssets).where(drizzleOrm.eq(filmAssets.id, id2)).get();
    if (!a) return;
    cancelTakes(
      db2.select({ id: filmTakes.id }).from(filmTakes).where(drizzleOrm.eq(filmTakes.assetId, id2)).all().map((t2) => t2.id)
    );
    db2.transaction((tx) => {
      tx.delete(filmAssets).where(drizzleOrm.eq(filmAssets.id, id2)).run();
      if (a.kind !== "shot") {
        for (const s of tx.select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.filmId, a.filmId), drizzleOrm.eq(filmAssets.kind, "shot"))).all())
          if (s.locationId === id2 || s.characterIds.includes(id2))
            tx.update(filmAssets).set({ locationId: s.locationId === id2 ? null : s.locationId, characterIds: s.characterIds.filter((c) => c !== id2) }).where(drizzleOrm.eq(filmAssets.id, s.id)).run();
      }
    });
    touchFilm(a.filmId);
  },
  "film.reorder": ({ filmId, ids }) => {
    getDb().transaction((tx) => {
      ids.forEach(
        (id2, i) => tx.update(filmAssets).set({ position: i }).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.id, id2), drizzleOrm.eq(filmAssets.filmId, filmId))).run()
      );
    });
  },
  "film.refreshPrompt": async ({ filmId, id: id2 }) => {
    await ensureAssetPrompts(filmId, [id2], { only: true, force: true });
    const row = getDb().select().from(filmAssets).where(drizzleOrm.and(drizzleOrm.eq(filmAssets.id, id2), drizzleOrm.eq(filmAssets.filmId, filmId))).get();
    if (!row) throw notFound("mục");
    return row;
  },
  "film.estimate": async ({ filmId, assetIds, takes, kind }) => {
    await ensureFilmStyle(filmId);
    const film = getFilm(filmId);
    const { jobs: _jobs, ...e } = estimate(filmId, assetIds, takes ?? (kind === "video" ? 1 : film.takesPerRun), kind);
    return e;
  },
  /** Xếp hàng tạo ảnh cho các mục (mỗi mục `takes` bản) */
  "film.generate": async ({ filmId, assetIds, takes, kind }) => {
    requireGate();
    await ensureFilmStyle(filmId);
    await ensureAssetPrompts(filmId, assetIds);
    const film = getFilm(filmId);
    if (kind === "video") requireVideoEngine(film);
    const each = takes ?? (kind === "video" ? 1 : film.takesPerRun);
    const { jobs: jobs2, skipped } = estimate(filmId, assetIds, each, kind);
    const db2 = getDb();
    db2.transaction((tx) => {
      let at2 = Date.now();
      for (const j of jobs2)
        for (let i = 0; i < each; i++)
          tx.insert(filmTakes).values({ id: newId(), filmId, assetId: j.asset.id, kind: kind ?? "image", prompt: j.prompt, refs: j.refs, durationSec: j.seconds ?? null, createdAt: new Date(at2++) }).run();
    });
    touchFilm(filmId);
    kick();
    return { queued: jobs2.length * each, skipped };
  },
  /** Nâng cấp độ phân giải một video đã tạo → bản tạo mới (bản gốc giữ nguyên), chạy trong hàng đợi video */
  "film.upscale": ({ takeId, quality, method }) => {
    const db2 = getDb();
    const src = db2.select().from(filmTakes).where(drizzleOrm.eq(filmTakes.id, takeId)).get();
    if (!src || src.kind !== "video") throw notFound("video");
    if (src.status !== "done" || !src.file) throw new ApiError("VALIDATION", "Chỉ nâng cấp được video đã tạo xong");
    if (method === "flow" && !canFlowUpscale(node_path.join(mediaDir(), src.file)))
      throw new ApiError("VALIDATION", 'Video này không còn liên kết với Google Flow (tạo bằng Veo API / Seedance hoặc bản app cũ) – chọn cách "Trên máy"');
    const key2 = upscaleKey(method, quality);
    const dup = db2.select({ id: filmTakes.id }).from(filmTakes).where(drizzleOrm.and(drizzleOrm.eq(filmTakes.sourceTakeId, takeId), drizzleOrm.eq(filmTakes.upscale, key2), drizzleOrm.inArray(filmTakes.status, ["queued", "running", "done"]))).get();
    if (dup) throw new ApiError("CONFLICT", "Video này đã có (hoặc đang tạo) bản nâng cấp cùng chất lượng và cách nâng cấp");
    const id2 = newId();
    db2.insert(filmTakes).values({ id: id2, filmId: src.filmId, assetId: src.assetId, kind: "video", prompt: src.prompt, refs: [src.file], durationSec: src.durationSec, upscale: key2, sourceTakeId: src.id }).run();
    touchFilm(src.filmId);
    kick();
    return { id: id2 };
  },
  "film.selectTake": ({ assetId, takeId, video }) => {
    const db2 = getDb();
    if (takeId) {
      const t2 = db2.select().from(filmTakes).where(drizzleOrm.eq(filmTakes.id, takeId)).get();
      if (!t2 || t2.assetId !== assetId) throw notFound("bản tạo");
      if (t2.status !== "done") throw new ApiError("VALIDATION", "Chỉ chọn được bản đã tạo xong");
    }
    const kind = takeId ? db2.select({ kind: filmTakes.kind }).from(filmTakes).where(drizzleOrm.eq(filmTakes.id, takeId)).get()?.kind : video ? "video" : "image";
    db2.update(filmAssets).set(kind === "video" ? { selectedVideoTakeId: takeId, updatedAt: now() } : { selectedTakeId: takeId, updatedAt: now() }).where(drizzleOrm.eq(filmAssets.id, assetId)).run();
  },
  "film.deleteTake": ({ id: id2 }) => {
    const db2 = getDb();
    const t2 = db2.select().from(filmTakes).where(drizzleOrm.eq(filmTakes.id, id2)).get();
    if (!t2) return;
    cancelTakes([id2]);
    db2.transaction((tx) => {
      tx.delete(filmTakes).where(drizzleOrm.eq(filmTakes.id, id2)).run();
      tx.update(filmAssets).set({ selectedTakeId: null }).where(drizzleOrm.eq(filmAssets.selectedTakeId, id2)).run();
      tx.update(filmAssets).set({ selectedVideoTakeId: null }).where(drizzleOrm.eq(filmAssets.selectedVideoTakeId, id2)).run();
    });
    if (t2.file) {
      const f = `${filmDir(t2.filmId)}/${t2.file.split("/").pop()}`;
      node_fs.rmSync(f, { force: true });
      node_fs.rmSync(`${f}.flow.json`, { force: true });
    }
  },
  /** Hủy bản đang chờ / chạy: theo danh sách, hoặc cả phim */
  "film.cancel": ({ filmId, takeIds }) => {
    const ids = takeIds ?? getDb().select({ id: filmTakes.id }).from(filmTakes).where(drizzleOrm.and(drizzleOrm.eq(filmTakes.filmId, filmId), drizzleOrm.inArray(filmTakes.status, ["queued", "running"]))).all().map((t2) => t2.id);
    return { cancelled: cancelTakes(ids) };
  },
  "film.assemble": ({ filmId, options }) => {
    getFilm(filmId);
    try {
      startAssemble(filmId, options);
    } catch (err) {
      throw new ApiError("CONFLICT", err instanceof Error ? err.message : String(err));
    }
  },
  "film.assembleStatus": ({ filmId }) => assembleStatus(filmId),
  "film.assembleCancel": ({ filmId }) => cancelAssemble(filmId),
  "film.renders": ({ filmId }) => listRenders(filmId),
  "film.deleteRender": ({ filmId, file: file2 }) => {
    const abs = node_path.join(mediaDir(), file2);
    if (!abs.startsWith(node_path.join(filmDir(filmId), "renders")) || !abs.endsWith(".mp4")) throw new ApiError("VALIDATION", "Đường dẫn không hợp lệ");
    node_fs.rmSync(abs, { force: true });
    node_fs.rmSync(abs.replace(/\.mp4$/, ".jpg"), { force: true });
  },
  "film.renderToContent": async ({ filmId, file: file2 }) => {
    try {
      return await renderToContent(filmId, file2);
    } catch (err) {
      throw new ApiError("VALIDATION", err instanceof Error ? err.message : String(err));
    }
  },
  /** Tối ưu (lại) từ khóa phong cách từ thể loại / phong cách / ghi chú */
  "film.optimizeStyle": async ({ id: id2 }) => {
    getFilm(id2);
    return { style: await ensureFilmStyle(id2, true) };
  },
  "film.queue": ({ filmId }) => queueStatus(filmId ?? void 0),
  "film.setQueue": (p) => {
    setQueuePrefs(p);
    return queueStatus();
  }
};
const wrap = async (fn, what) => {
  try {
    return await fn();
  } catch (err) {
    throw new ApiError("VALIDATION", `${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
};
let testAbort = null;
const flowHandlers = {
  "flow.status": () => flowStatus(),
  "flow.setSource": ({ source }) => {
    setVeoSource(source);
    return flowStatus();
  },
  "flow.setPrefs": async ({ hidden, concurrency, images }) => {
    if (images !== void 0) setFlowImages(images);
    if (hidden !== void 0) await setFlowHidden(hidden);
    if (concurrency !== void 0) setFlowConcurrency(concurrency);
    return flowStatus();
  },
  "flow.setModel": ({ model }) => {
    setFlowModel(model);
    return flowStatus();
  },
  "flow.openLogin": () => wrap(openFlowLogin, "Không mở được Chrome"),
  "flow.check": async () => {
    await wrap(checkFlowLogin, "Không kiểm tra được phiên Google Flow");
    return flowStatus();
  },
  "flow.refreshCredits": async () => {
    await wrap(refreshFlowCredits, "Không đọc được credit Google Flow");
    return flowStatus();
  },
  "flow.close": async () => {
    await closeFlowChrome();
    return flowStatus();
  },
  "flow.reset": async () => {
    await resetFlowProfile();
    return flowStatus();
  },
  /** Tạo thử một video ngắn (kiểm tra tự động hóa trên máy khách) → đường dẫn tương đối thư mục media */
  "flow.test": async ({ prompt, aspect, dryRun }) => {
    if (testAbort) throw new ApiError("CONFLICT", "Đang chạy thử – chờ xong hoặc hủy");
    testAbort = new AbortController();
    const dir = node_path.join(mediaDir(), "flow");
    node_fs.mkdirSync(dir, { recursive: true });
    const rel2 = `flow/test-${Date.now().toString(36)}.mp4`;
    try {
      const signal = testAbort.signal;
      if (dryRun) {
        const diagnostics = await wrap(() => flowGenerate({ prompt, aspect, start: sampleFramePng(), dest: "", signal, dryRun: true }), "Kiểm tra giao diện Flow thất bại");
        return { file: null, diagnostics };
      }
      await wrap(() => flowGenerate({ prompt, aspect, dest: node_path.join(mediaDir(), rel2), signal }), "Tạo thử thất bại");
      return { file: rel2, diagnostics: null };
    } finally {
      testAbort = null;
    }
  },
  "flow.cancelTest": () => {
    testAbort?.abort();
  },
  "flow.openDiagnostics": () => {
    const dir = flowDiagnosticsDir();
    node_fs.mkdirSync(dir, { recursive: true });
    void electron.shell.openPath(dir);
  }
};
const HIDDEN_ARG = "--hidden";
const prefsFile = () => node_path.join(electron.app.getPath("userData"), "background.json");
function load() {
  try {
    return { closeToTray: true, hintShown: false, ...JSON.parse(node_fs.readFileSync(prefsFile(), "utf8")) };
  } catch {
    return { closeToTray: true, hintShown: false };
  }
}
function save(patch) {
  node_fs.writeFileSync(prefsFile(), JSON.stringify({ ...load(), ...patch }, null, 2));
}
function backgroundPrefs() {
  return {
    closeToTray: load().closeToTray,
    // Bản dev chạy electron.exe – không đăng ký khởi động cùng Windows
    launchAtLoginSupported: electron.app.isPackaged && process.platform !== "linux",
    launchAtLogin: electron.app.isPackaged && electron.app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin
  };
}
function setBackgroundPrefs(p) {
  if (p.closeToTray != null) save({ closeToTray: p.closeToTray });
  if (p.launchAtLogin != null && electron.app.isPackaged) electron.app.setLoginItemSettings({ openAtLogin: p.launchAtLogin, args: [HIDDEN_ARG] });
  refreshMenu();
  return backgroundPrefs();
}
const startHidden = () => process.argv.includes(HIDDEN_ARG);
let tray = null;
let quitting = false;
let getWindow = () => null;
function showWindow() {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function quit() {
  quitting = true;
  electron.app.quit();
}
function iconImage() {
  const file2 = electron.app.isPackaged ? node_path.join(process.resourcesPath, "icon.png") : node_path.join(__dirname, "../../resources/icon.png");
  return electron.nativeImage.createFromPath(file2).resize({ width: 32, height: 32, quality: "best" });
}
function refreshMenu() {
  if (!tray) return;
  const p = backgroundPrefs();
  tray.setContextMenu(
    electron.Menu.buildFromTemplate([
      { label: "Mở Omnira Studio", click: showWindow },
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
function setupTray(win) {
  getWindow = win;
  electron.app.on("before-quit", () => {
    quitting = true;
  });
  tray = new electron.Tray(iconImage());
  tray.setToolTip("Omnira Studio – đang chạy nền (lập lịch đăng bài, hộp thư, render)");
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  refreshMenu();
}
function hideOnClose(w) {
  w.on("close", (e) => {
    if (quitting || !tray || !load().closeToTray) return;
    e.preventDefault();
    w.hide();
    const s = load();
    if (!s.hintShown && electron.Notification.isSupported()) {
      save({ hintShown: true });
      const n = new electron.Notification({
        title: "Omnira Studio vẫn đang chạy nền",
        body: "Lập lịch đăng bài và hộp thư vẫn hoạt động. Mở lại hoặc thoát hẳn từ biểu tượng ở khay hệ thống (góc phải thanh taskbar)."
      });
      n.on("click", showWindow);
      n.show();
    }
  });
}
const QUOTA_ENDPOINTS = /* @__PURE__ */ new Set([
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
    const win = electron.BrowserWindow.getFocusedWindow();
    const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    return res.canceled ? null : res.filePaths[0] ?? null;
  },
  "system.pickMedia": async () => {
    const opts = {
      title: "Chọn ảnh / video để đăng",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Ảnh & video", extensions: ["jpg", "jpeg", "png", "webp", "mp4", "mov", "m4v"] }]
    };
    const win = electron.BrowserWindow.getFocusedWindow();
    const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    return res.canceled ? [] : res.filePaths.slice(0, 10);
  },
  "system.storage": () => storageInfo(),
  "system.logInfo": () => ({ dir: logDir(), file: logFile(), sizeBytes: node_fs.existsSync(logFile()) ? node_fs.statSync(logFile()).size : 0 }),
  "system.background": () => backgroundPrefs(),
  "system.setBackground": (patch) => setBackgroundPrefs(patch),
  "system.openLogs": async () => {
    const err = await electron.shell.openPath(logDir());
    if (err) throw new ApiError("INTERNAL", `Không mở được thư mục log: ${err}`);
  }
};
function registerApi() {
  for (const endpoint of Object.keys(contract)) {
    const schema2 = contract[endpoint].input;
    const handler = handlers[endpoint];
    electron.ipcMain.handle(API_PREFIX + endpoint, async (_event, raw) => {
      if (!PUBLIC_ENDPOINTS.has(endpoint) && !currentUser()) {
        return { ok: false, error: { code: "AUTH", message: "Phiên đăng nhập đã kết thúc – vui lòng đăng nhập lại" } };
      }
      if (!PUBLIC_ENDPOINTS.has(endpoint) && !UNLICENSED_ENDPOINTS.has(endpoint) && !licenseUsable()) {
        return { ok: false, error: { code: "LICENSE", message: "Chưa có gói đang hoạt động trên máy này – mua / gia hạn gói hoặc kích hoạt lại để tiếp tục" } };
      }
      const feature = featureForEndpoint(endpoint);
      if (feature && !hasFeature(feature)) return { ok: false, error: { code: "FEATURE", message: featureLockedMessage(feature) } };
      try {
        const input = schema2.parse(raw);
        if (QUOTA_ENDPOINTS.has(endpoint)) {
          const before = channelIds();
          const data = await handler(input);
          try {
            enforceQuota(new Set([...channelIds()].filter((id2) => !before.has(id2))));
          } catch (err) {
            console.error("[quota] áp hạn mức kênh lỗi", err);
          }
          return { ok: true, data };
        }
        return { ok: true, data: await handler(input) };
      } catch (err) {
        if (err instanceof ApiError) return { ok: false, error: { code: err.code, message: err.message } };
        if (err instanceof AiError) return { ok: false, error: { code: err.kind === "budget" ? "BUDGET" : "AI", message: err.message } };
        if (err instanceof zod.ZodError) {
          const detail2 = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
          return { ok: false, error: { code: "VALIDATION", message: detail2 } };
        }
        console.error(`[api] ${endpoint} failed`, err);
        return { ok: false, error: { code: "INTERNAL", message: "Lỗi nội bộ – xem log ứng dụng" } };
      }
    });
  }
}
registerMediaScheme();
let mainWindow = null;
let stopStats = null;
function registerIpc() {
  const current2 = (e) => electron.BrowserWindow.fromWebContents(e.sender);
  electron.ipcMain.on(IpcChannel.WindowMinimize, (e) => current2(e)?.minimize());
  electron.ipcMain.on(IpcChannel.WindowToggleMaximize, (e) => {
    const win = current2(e);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  electron.ipcMain.on(IpcChannel.WindowClose, (e) => current2(e)?.close());
  electron.ipcMain.on(IpcChannel.AppSetTheme, (_e, theme) => {
    if (theme === "system" || theme === "dark" || theme === "light") applyTheme(theme);
  });
  electron.ipcMain.handle(IpcChannel.AppInfo, () => ({
    name: electron.app.getName(),
    version: electron.app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron
  }));
}
if (!electron.app.requestSingleInstanceLock()) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => showWindow());
  electron.app.whenReady().then(() => {
    electron.app.setAppUserModelId("com.omnipage.studio");
    initLogger();
    try {
      writeDataMarker();
      console.info(`[data] thư mục dữ liệu: ${dataRoot()}`);
    } catch (err) {
      console.error("[data] không ghi được dấu thư mục dữ liệu", err);
    }
    electron.nativeTheme.themeSource = savedTheme();
    const remembered = restoreSession();
    if (remembered) {
      try {
        openSession(remembered);
      } catch (err) {
        console.error("[auth] không mở được dữ liệu của phiên đã ghi nhớ", err);
        forgetSession(remembered.id);
        electron.dialog.showErrorBox("OmniPage Studio – lỗi dữ liệu", `Không mở được dữ liệu của tài khoản ${remembered.email}:
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
        if (win.isFocused() || !electron.Notification.isSupported() || Date.now() - lastNotify < 2e4) return;
        lastNotify = Date.now();
        const n = new electron.Notification({ title: `${c.newMessages} tin mới trong Hộp thư`, body: c.channels.join(", ").slice(0, 120), silent: false });
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
      if (!electron.Notification.isSupported()) return;
      const n = new electron.Notification({
        title: posts.length === 1 ? "Bài đăng đang phân phối kém" : `${posts.length} bài đăng đang phân phối kém`,
        body: posts.slice(0, 3).map((p) => `${p.channelName}: ${p.title.slice(0, 50)} (${p.flag === "zero" ? "0" : `${p.metric} / thường ~${p.baseline}`})`).join("\n")
      });
      n.on("click", () => {
        showWindow();
        mainWindow?.webContents.send(IpcChannel.AppNavigate, "/");
      });
      n.show();
    });
    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        hideOnClose(mainWindow);
      } else showWindow();
    });
  });
  electron.app.on("window-all-closed", () => {
    stopStats?.();
    if (process.platform !== "darwin") electron.app.quit();
  });
  electron.app.on("will-quit", () => {
    closeSession();
    void stopEngine();
    void closeFlowChrome();
  });
}
