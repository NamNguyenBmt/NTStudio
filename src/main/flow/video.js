import { copyFileSync, rmSync, mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import os from "node:os";
import { ApiError } from "../errors";
import { attachRefs } from "./image";
import { FLOW_URL, GEN_TIMEOUT_MS, TOP_TILES, getSetting, putSetting, loginState, flowHidden, flowConcurrency, diagRoot, sleep, ensureChrome, placeWindows, context, readLogin, refreshCredits } from "./session";
import { hasFeature, featureLockedMessage } from "../license/index";

export const flowDiagnosticsDir = () => diagRoot();
export const newProjectButton = (page) => page.getByRole("button", { name: /new project|dự án mới/i }).or(page.getByRole("link", { name: /new project|dự án mới/i }));
export const promptCandidates = (page) => page.locator('[contenteditable="true"]:visible, textarea:visible, [role="textbox"]:visible');

export async function visible(l, timeout) {
  try {
    await l.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

export async function clickFirst(cands, timeout = 3e3) {
  for (const c of cands) {
    if (await visible(c, timeout)) {
      await c.first().click();
      return true;
    }
  }
  return false;
}

export const iconButton = (page, icon) => page.locator("button", { has: page.locator(`mat-icon:text-is("${icon}"), i:text-is("${icon}"), span:text-is("${icon}")`) });
export const sendButton = (page) => page.getByRole("button", { name: /bắt đầu tạo|^generate|^create|arrow_forward/i }).or(iconButton(page, "arrow_forward"));
export const settingsButton = (page) => page.getByRole("button", { name: /điều kiện kích hoạt cài đặt|settings trigger|generation settings/i }).or(page.locator("button", { hasText: /crop_(16_9|9_16|square|landscape|portrait)/ }));
const radio = (page, text) => page.getByRole("radio").filter({ hasText: text });

export async function checkRadio(page, text, what, required) {
  const r = radio(page, text);
  if (!await visible(r, 2500)) {
    if (required) throw new Error(`Không tìm thấy lựa chọn "${what}" trong cài đặt Flow`);
    return;
  }
  if (await r.first().getAttribute("aria-checked") !== "true") {
    await r.first().click();
    await sleep(500);
  }
}

const FLOW_MODELS = ["Veo 3.1 - Fast", "Veo 3.1 - Lite", "Veo 3.1 - Quality", "Omni 1.1 Flash"];

export const flowModel = () => {
  const m = getSetting("flow.model", "Veo 3.1 - Fast");
  return FLOW_MODELS.includes(m) ? m : "Veo 3.1 - Fast";
};

export const setFlowModel = (m) => putSetting("flow.model", m);
const flowSeconds = (sec) => sec <= 4 ? 4 : sec <= 6 ? 6 : sec <= 8 ? 8 : 10;
export const flowClipSeconds = (sec) => flowModel().startsWith("Veo") ? 8 : flowSeconds(sec);

async function configure(page, o) {
  if (!await clickFirst([settingsButton(page)], 8e3)) throw new Error("Không tìm thấy nút cài đặt tạo (model / tỉ lệ) trong Flow");
  await sleep(800);
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
      await sleep(700);
      const item = page.getByRole("menuitem").filter({ hasText: want });
      if (!await visible(item, 3e3)) throw new Error(`Flow không có model "${want}" – chọn model khác ở Cài đặt › Google Flow`);
      await item.first().click();
      await sleep(700);
    }
  } else throw new Error("Không tìm thấy nút chọn model trong Flow");
  await checkRadio(page, /^\s*720p\s*$/i, "720p", false);
  await checkRadio(page, new RegExp(`^\\s*${flowSeconds(o.seconds)}\\s*(giây|s|sec|seconds?)\\s*$`, "i"), `${flowSeconds(o.seconds)} giây`, false);
  await checkRadio(page, /^\s*x1\s*$/, "x1", false);
  await page.keyboard.press("Escape").catch(() => void 0);
  await sleep(600);
  const summary = await settingsButton(page).first().textContent().catch(() => "") ?? "";
  if (!/video/i.test(summary)) throw new Error("Không chuyển được Flow sang chế độ Video");
}

export async function acceptUploadConsent(page) {
  const dialog = page.getByRole("dialog").filter({ hasText: /quyền sử dụng hình ảnh|rights to use|image rights|các quyền cần thiết|necessary rights/i });
  const agree = dialog.getByRole("button", { name: /tôi đồng ý|i agree|^\s*agree\s*$/i });
  if (!await agree.first().isVisible().catch(() => false)) return false;
  await agree.first().click();
  await sleep(800);
  return true;
}

async function attachStartFrame(page, file) {
  const name = `omnira-${Date.now().toString(36)}${extname(file).toLowerCase() || ".png"}`;
  const tmp = join(os.tmpdir(), name);
  copyFileSync(file, tmp);
  try {
    const slot = page.getByRole("button", { name: /^\s*(bắt đầu|start|first frame)\s*$/i });
    if (!await clickFirst([slot], 6e3)) throw new Error('Không tìm thấy ô khung hình đầu ("Bắt đầu") trong Flow');
    await sleep(1200);
    const chooser = page.waitForEvent("filechooser", { timeout: 15e3 });
    if (!await clickFirst([page.getByRole("button", { name: /tải nội dung nghe nhìn lên|upload/i })], 6e3))
      throw new Error("Không tìm thấy nút tải ảnh lên trong Flow");
    await (await chooser).setFiles(tmp);
    const item = page.getByRole("option").filter({ hasText: name });
    const t0 = Date.now();
    for (; ; ) {
      await acceptUploadConsent(page);
      const txt = await item.first().textContent({ timeout: 1e3 }).catch(() => null) ?? "";
      if (txt && !/đang tải lên|uploading/i.test(txt)) break;
      if (Date.now() - t0 > 9e4) throw new Error("Tải khung hình lên Flow quá lâu");
      await sleep(1e3);
    }
    await acceptUploadConsent(page);
    await item.first().click();
    await sleep(1200);
    await acceptUploadConsent(page);
    await clickFirst([page.getByRole("button", { name: /thêm vào câu lệnh|add to prompt/i })], 1500);
    await sleep(800);
    await acceptUploadConsent(page);
    if (await slot.first().isVisible().catch(() => false)) throw new Error("Flow chưa nhận khung hình đầu");
  } finally {
    rmSync(tmp, { force: true });
  }
}

export async function tiles(page) {
  return page.$$eval(
    "flow-grid-tile-container",
    (els) => (
      // Chạy trong trang (DOM) – main process không có kiểu DOM
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      els.map((e, i) => {
        const v = e.querySelector("video");
        const thumb = e.querySelector("img")?.getAttribute("src") || "";
        const id = e.querySelector("[data-media-id]")?.getAttribute("data-media-id") || thumb.match(/flow-content\.google\/(?:image|video)\/([0-9a-f-]{16,})/i)?.[1] || // hoặc link ảnh dạng flow.google.com/asb/<mã> (lấy 48 ký tự đầu của mã – đủ phân biệt, dùng được trong bộ chọn CSS)
        thumb.match(/\/asb\/([\w-]{20,})/)?.[1]?.slice(0, 48) || null;
        const src = v ? v.currentSrc || v.src || v.querySelector("source")?.src || "" : "";
        const isVideo = !!e.querySelector("flow-video-tile") || !!v;
        const icons = [...e.querySelectorAll("mat-icon")].map((m) => (m.textContent || "").trim());
        return {
          id,
          key: id || src || `pending:${e.getAttribute("aria-label") || ""}#${i}`,
          done: isVideo && !!id && !!thumb && icons.includes("play_circle"),
          video: src || null,
          text: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300)
        };
      })
    )
  ).catch(() => []);
}

async function hoverVideoSrc(page, id) {
  const tile = page.locator("flow-grid-tile-container", { has: page.locator(`img[src*="${id}"], [data-media-id="${id}"]`) }).first();
  if (!await tile.count()) return null;
  await tile.scrollIntoViewIfNeeded().catch(() => void 0);
  await tile.hover({ timeout: 5e3 }).catch(() => void 0);
  for (let i = 0; i < 20; i++) {
    const src = await tile.evaluate((e) => e.querySelector("video")?.currentSrc || e.querySelector("video")?.src || "").catch(() => "");
    if (src) {
      await page.mouse.move(0, 0).catch(() => void 0);
      return src;
    }
    await sleep(250);
  }
  return null;
}

export const FAIL_TEXT = /generation failed|failed to generate|couldn'?t generate|something went wrong|violat|policy|unsafe|out of credits|not enough credits|không thể tạo|tạo không thành công|không thành công|thất bại|đã xảy ra lỗi|vi phạm|chính sách|không đủ tín dụng|hết tín dụng/i;
const TRANSIENT_TEXT = /hoạt động bất thường|unusual activity|chưa bị tính phí|(?:not|n'?t) been charged|something went wrong|đã xảy ra lỗi|try again|thử lại/i;
const FATAL_TEXT = /violat|policy|unsafe|out of credits|not enough credits|vi phạm|chính sách|không đủ tín dụng|hết tín dụng/i;

export class FlowTransientError extends Error {
}

export function flowFailure(text) {
  const msg = `Google Flow báo lỗi: ${text.slice(0, 200)}`;
  return TRANSIENT_TEXT.test(text) && !FATAL_TEXT.test(text) ? new FlowTransientError(msg) : new Error(msg);
}

const FLOW_RETRY_WAIT_MS = [2e4, 6e4];
let cooldownUntil = 0;

async function waitCooldown(signal, onStatus) {
  while (Date.now() < cooldownUntil) {
    if (signal.aborted) throw new DOMException("Đã hủy", "AbortError");
    onStatus?.(`Google Flow từ chối tạm thời – tạo lại sau ${Math.ceil((cooldownUntil - Date.now()) / 1e3)}s…`, 0);
    await sleep(Math.min(1e3, Math.max(50, cooldownUntil - Date.now())));
  }
}

export async function withFlowRetry(what, signal, onStatus, run, attemptTimeoutMs) {
  for (let i = 0; ; i++) {
    await waitCooldown(signal, onStatus);
    const attempt = attemptTimeoutMs ? AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]) : signal;
    try {
      return await run(attempt);
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

export async function saveDiagnostics(page, label) {
  try {
    const root = diagRoot();
    mkdirSync(root, { recursive: true });
    const old = readdirSync(root).sort();
    for (const d of old.slice(0, Math.max(0, old.length - 14))) rmSync(join(root, d), { recursive: true, force: true });
    const dir = join(root, `${(new Date()).toISOString().replace(/[:.]/g, "-")}-${label}`);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, "screen.png") }).catch(() => void 0);
    writeFileSync(join(dir, "page.html"), await page.content().catch(() => ""));
    writeFileSync(join(dir, "url.txt"), page.url());
    return dir;
  } catch {
    return null;
  }
}

async function download(page, src, dest) {
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
  writeFileSync(dest, buf);
}

const projectBase = (url) => url.replace(/\/edit\/.*$/, "").replace(/[?#].*$/, "");
export const isEditView = (page) => /\/edit\//.test(page.url());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const editMediaId = (url) => url.match(/\/edit\/([0-9a-f-]{36})/i)?.[1] ?? null;
const flowRefFile = (video) => `${video}.flow.json`;

function writeFlowRef(video, ref) {
  try {
    writeFileSync(flowRefFile(video), JSON.stringify(ref));
  } catch {
  }
}

export function readFlowRef(video) {
  try {
    const r = JSON.parse(readFileSync(flowRefFile(video), "utf8"));
    return r.project && r.media && UUID.test(r.media) && /^https?:\/\/[^/]+\/.*project\//.test(r.project) ? { project: r.project, media: r.media } : null;
  } catch {
    return null;
  }
}

export const slotPages = new Map();
export const slotConfig = new Map();

async function videoSources(page) {
  return page.$$eval("video", (vs) => vs.map((v) => v.currentSrc || v.src || v.querySelector("source")?.src || "").filter(Boolean)).catch(() => []);
}

export async function backToGrid(page, slot) {
  if (!isEditView(page)) return;
  const base = projectBase(page.url());
  await clickFirst([page.getByRole("button", { name: /quay lại|go back|^back/i }), iconButton(page, "arrow_back")], 2e3);
  for (let i = 0; i < 20 && isEditView(page); i++) await sleep(250);
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
        await sleep(800);
        continue;
      }
      const close = agentPanelClose(page).first();
      if (await close.isVisible().catch(() => false)) {
        tries++;
        await close.click().catch(() => void 0);
        await sleep(800);
        continue;
      }
    }
    await sleep(500);
  }
  return false;
}

export async function openProject(page, slot, onStatus) {
  const urls = getSetting("flow.projectUrls", []);
  const saved = urls[slot] ?? (slot === 0 ? getSetting("flow.projectUrl", null) : null);
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
    putSetting("flow.login", login);
    throw new Error('Chưa đăng nhập Google Flow – vào Cài đặt › Google Flow, bấm "Mở Chrome để đăng nhập"');
  }
  if (!await clickFirst([newProjectButton(page)], 15e3)) throw new Error('Không tìm thấy nút "Dự án mới" trong Flow');
  if (!await creationBar(page, 3e4)) throw new Error("Không tìm thấy ô tạo video trong dự án Flow mới");
  if (/\/project\//.test(page.url())) {
    const next = [...getSetting("flow.projectUrls", [])];
    next[slot] = projectBase(page.url());
    putSetting("flow.projectUrls", next);
  }
}

export function sampleFramePng() {
  const f = join(os.tmpdir(), "omnira-flow-sample.png");
  if (!existsSync(f)) writeFileSync(f, Buffer.from(SAMPLE_FRAME_B64, "base64"));
  return f;
}

const SAMPLE_FRAME_B64 = "iVBORw0KGgoAAAANSUhEUgAAAoAAAAFoCAIAAABIUN0GAAAACXBIWXMAAAABAAAAAQBPJcTWAAAFlklEQVR4nO3VMQ0AIQDAQEhQhAYs4N/Ku6DD3yno1rnPHQDAW6sOAIA/MmAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQMCAASBgwAAQMGAACBgwAAQMGAACBgwAAQMGgIABA0DAgAEgYMAAEDBgAAgYMAAEDBgAAgYMAAEDBoCAAQNAwIABIGDAABAwYAAIGDAABAwYAAIGDAABAwaAgAEDQOADDxEGaSzMxjAAAAAASUVORK5CYII=";
export let running = 0;
const busySlots = new Set();
export const waiting = [];

export async function acquire(signal) {
  while (busySlots.size >= flowConcurrency())
    await new Promise((ok, fail) => {
      const go = () => (signal.removeEventListener("abort", stop), ok());
      const stop = () => {
        const i = waiting.indexOf(go);
        if (i >= 0) waiting.splice(i, 1);
        fail(new DOMException("Đã hủy", "AbortError"));
      };
      waiting.push(go);
      signal.addEventListener("abort", stop, { once: true });
    });
  let slot = 0;
  while (busySlots.has(slot)) slot++;
  busySlots.add(slot);
  running++;
  return {
    slot,
    release: () => {
      busySlots.delete(slot);
      running--;
      waiting.shift()?.();
    }
  };
}

export async function flowGenerate(o) {
  if (o.dryRun) return generateVideoOnce(o);
  return withFlowRetry("video", o.signal, o.onStatus, (signal) => generateVideoOnce({ ...o, signal }));
}

export function requireFlowFeature() {
  if (!hasFeature("FLOW")) throw new ApiError("FEATURE", featureLockedMessage("FLOW"));
}

async function generateVideoOnce(o) {
  requireFlowFeature();
  const refs = o.start ? [] : (o.refs ?? []).filter((f) => existsSync(f)).slice(0, 3);
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
      await openProject(p, slot, (t) => o.onStatus?.(t, 0));
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
        if (top.every((t) => t.id || FAIL_TEXT.test(t.text))) break;
        await sleep(500);
      }
      const known = (ts) => ts.forEach((t) => (before.add(t.key), t.id && beforeIds.add(t.id)));
      const before = new Set();
      const beforeIds = new Set();
      known((await tiles(p)).filter((t) => !t.key.startsWith("pending:")));
      const beforeVideos = new Set(await videoSources(p));
      const isNew = (t) => !before.has(t.key) && !(t.id && beforeIds.has(t.id));
      if (!await clickFirst([sendButton(p)], 5e3)) await box.press("Enter");
      const t0 = Date.now();
      let src = null;
      let media = null;
      let started = false;
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
        known(all.slice(TOP_TILES).filter((t) => !t.key.startsWith("pending:")));
        const fresh = all.slice(0, TOP_TILES).filter(isNew);
        const failed = fresh.find((t) => FAIL_TEXT.test(t.text));
        if (failed) throw flowFailure(failed.text);
        if (fresh.some((t) => !t.done)) started = true;
        if (started) {
          const withVideo = fresh.find((t) => t.done && t.video && !beforeVideos.has(t.video));
          src = withVideo?.video ?? null;
          const ready = withVideo ?? fresh.find((t) => t.done && t.id);
          if (!src && ready?.id) src = await hoverVideoSrc(p, ready.id);
          media = ready?.id && UUID.test(ready.id) ? ready.id : null;
          if (src) break;
        } else
          known(fresh.filter((t) => t.done));
        if (sec > 90 && !started && !isEditView(p)) throw new Error("Flow không bắt đầu tạo video (không thấy kết quả mới sau khi gửi)");
        const pct = fresh.map((t) => t.text.match(/\b(\d{1,3})\s?%/)?.[1]).find(Boolean);
        o.onStatus?.(`Google Flow đang tạo video… ${pct ? `${pct}% · ` : ""}${sec}s`, sec);
        await sleep(1500);
      }
      o.onStatus?.("Google Flow: tải video về máy…", Math.round((Date.now() - t0) / 1e3));
      await download(p, src, o.dest);
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

export async function flowUpscale(o) {
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
          putSetting("flow.login", login);
          throw new Error("Phiên Google Flow đã hết – đăng nhập lại ở Cài đặt › Google Flow");
        }
        throw new Error('Không mở được video trong Google Flow (video có thể đã bị xóa khỏi dự án Flow) – dùng cách "Trên máy"');
      }
      await dlButton.first().click();
      await sleep(900);
      const item = p.getByRole("menuitem").filter({ hasText: o.quality === "4k" ? /\b4k\b|2160/i : /1080/ });
      if (!await visible(item, 5e3) || await item.first().getAttribute("aria-disabled") === "true") {
        await p.keyboard.press("Escape").catch(() => void 0);
        throw new Error(`Google Flow không có lựa chọn nâng cấp ${label} cho video này${o.quality === "4k" ? " (4K cần gói Google AI hỗ trợ)" : ""}`);
      }
      const download2 = p.waitForEvent("download", { timeout: UPSCALE_TIMEOUT_MS });
      download2.catch(() => void 0);
      await item.first().click();
      await sleep(1200);
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
        await sleep(2e3);
      }
      const d = await download2.catch((e) => {
        throw new Error(`Google Flow nâng cấp ${label} quá lâu hoặc không tải được (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
      });
      o.onStatus?.("Google Flow: lưu video về máy…");
      await d.saveAs(o.dest);
      if (!existsSync(o.dest) || statSync(o.dest).size < 2e4) throw new Error("File nâng cấp tải về quá nhỏ");
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
