import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { chromium } from "playwright-core";
import { currentUser, userDir } from "../paths";
import { settings } from "../db/schema";
import { getDb } from "../db/index";
import { newProjectButton, promptCandidates, visible, clickFirst, iconButton, flowModel, slotPages, slotConfig, running, waiting } from "./video";
import { flowImagesEnabled } from "./image";
import { licenseLimits } from "../license/index";

export const FLOW_URL = process.env.OMNI_FLOW_URL || "https://labs.google/fx/tools/flow";
export const GEN_TIMEOUT_MS = 10 * 6e4;
export const TOP_TILES = 4;

export function getSetting(key, fallback) {
  const row = getDb().select().from(settings).where(eq(settings.key, key)).get();
  return row ? row.value : fallback;
}

export function putSetting(key, value) {
  getDb().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } }).run();
}

export const veoSource = () => getSetting("veo.source", "api") === "flow" ? "flow" : "api";
export const setVeoSource = (s) => putSetting("veo.source", s);
export const loginState = () => getSetting("flow.login", { loggedIn: false, email: null, checkedAt: null });
const creditsState = () => getSetting("flow.credits", { credits: null, tier: null, at: null });
export const flowHidden = () => getSetting("flow.hidden", true) !== false;
const flowMaxThreads = () => Math.min(4, Math.max(1, licenseLimits().flowThreads ?? 4));
export const flowConcurrency = () => Math.min(flowMaxThreads(), Math.max(1, Number(getSetting("flow.concurrency", 2)) || 2));
export const setFlowConcurrency = (n) => putSetting("flow.concurrency", Math.min(4, Math.max(1, Math.round(n))));
export const flowReady = () => veoSource() === "flow" && loginState().loggedIn;

function findChrome() {
  const env = process.env;
  const list = process.platform === "win32" ? [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter((b) => !!b).flatMap((b) => [join(b, "Google", "Chrome", "Application", "chrome.exe")]).concat([env["PROGRAMFILES(X86)"], env.PROGRAMFILES].filter((b) => !!b).map((b) => join(b, "Microsoft", "Edge", "Application", "msedge.exe"))) : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"] : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return list.find((p) => existsSync(p)) ?? null;
}

const profileDir = () => join(userDir(), "flow-chrome");
export const diagRoot = () => join(userDir(), "flow-diagnostics");
let chrome = null;
let loginProc = null;
let loginCheck = null;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(port, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 3e3 });
    } catch {
      await sleep(500);
    }
  }
  return null;
}

export async function ensureChrome() {
  const user = currentUser();
  if (!user) throw new Error("Chưa đăng nhập app");
  if (chrome?.user === user && chrome.browser.isConnected()) return chrome.browser;
  if (loginProc) throw new Error("Cửa sổ đăng nhập Google Flow đang mở – đăng nhập xong hãy đóng cửa sổ Chrome đó rồi thử lại");
  await closeFlowChrome();
  const dir = profileDir();
  mkdirSync(dir, { recursive: true });
  const portFile = join(dir, "DevToolsActivePort");
  if (existsSync(portFile)) {
    const port2 = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
    const b2 = port2 ? await connect(port2, 1) : null;
    if (b2) {
      chrome = { user, browser: b2, proc: null };
      b2.on("disconnected", () => chrome?.browser === b2 && (chrome = null));
      return b2;
    }
  }
  const exe = findChrome();
  if (!exe) throw new Error("Không tìm thấy Google Chrome (hoặc Microsoft Edge) trên máy – cài Chrome rồi thử lại");
  rmSync(portFile, { force: true });
  const proc = spawn(
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
    await sleep(500);
    if (existsSync(portFile)) port = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]) || 0;
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

export async function placeWindows(hidden) {
  const b = chrome?.browser;
  if (!b?.isConnected()) return;
  const pages = b.contexts().flatMap((c) => c.pages());
  const seen = new Set();
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

export async function setFlowHidden(hidden) {
  putSetting("flow.hidden", hidden);
  await placeWindows(hidden);
}

export const context = (b) => {
  const ctx = b.contexts()[0];
  if (!ctx) throw new Error("Chrome chưa sẵn sàng");
  return ctx;
};

export async function closeFlowChrome() {
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

export async function openFlowLogin() {
  if (!currentUser()) throw new Error("Chưa đăng nhập app");
  if (loginProc) return;
  if (running > 0) throw new Error("Đang tạo video bằng Flow – chờ xong rồi đăng nhập lại");
  const exe = findChrome();
  if (!exe) throw new Error("Không tìm thấy Google Chrome (hoặc Microsoft Edge) trên máy – cài Chrome rồi thử lại");
  if (chrome) {
    await closeFlowChrome();
    await sleep(1500);
  }
  const dir = profileDir();
  mkdirSync(dir, { recursive: true });
  const proc = spawn(exe, [`--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", FLOW_URL], { stdio: "ignore" });
  loginProc = proc;
  proc.once("exit", () => {
    if (loginProc !== proc) return;
    loginProc = null;
    loginCheck = sleep(1500).then(() => checkFlowLogin()).catch((err) => console.warn("[flow] kiểm tra đăng nhập lỗi", err)).finally(() => {
      loginCheck = null;
      void closeFlowChrome();
    });
  });
  proc.once("error", () => loginProc === proc && (loginProc = null));
}

export async function readLogin(page) {
  const at = Date.now();
  if (/accounts\.google\.com/.test(page.url())) return { loggedIn: false, email: null, checkedAt: at };
  const s = await page.evaluate(async () => {
    try {
      const r = await fetch("/fx/api/auth/session", { credentials: "include" });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }).catch(() => null);
  if (s?.user) return { loggedIn: true, email: s.user.email ?? s.user.name ?? null, checkedAt: at };
  const account = await page.locator('a[aria-label*="@"], [role=button][aria-label*="@"]').first().getAttribute("aria-label", { timeout: 5e3 }).catch(() => null);
  const email = account?.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  if (email) return { loggedIn: true, email, checkedAt: at };
  const signIn = await page.getByRole("button", { name: /sign in|đăng nhập/i }).or(page.getByRole("link", { name: /sign in|đăng nhập/i })).count();
  const app = await newProjectButton(page).count() + await promptCandidates(page).count();
  return { loggedIn: signIn === 0 && app > 0, email: null, checkedAt: at };
}

export async function checkFlowLogin() {
  const ctx = context(await ensureChrome());
  const page = await ctx.newPage();
  try {
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 6e4 });
    await visible(page.locator('a[aria-label*="@"]').or(newProjectButton(page)).or(page.getByRole("link", { name: /sign in|đăng nhập/i })), 2e4);
    const st = await readLogin(page);
    putSetting("flow.login", st);
    if (st.loggedIn) await refreshCredits(page);
    return st;
  } finally {
    await page.close().catch(() => void 0);
  }
}

export async function resetFlowProfile() {
  await closeFlowChrome();
  await sleep(800);
  rmSync(profileDir(), { recursive: true, force: true });
  putSetting("flow.login", { loggedIn: false, email: null, checkedAt: Date.now() });
  putSetting("flow.credits", { credits: null, tier: null, at: null });
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
    await sleep(400);
  }
}

export async function refreshFlowCredits() {
  if (running > 0 || waiting.length > 0 || loginProc || loginCheck) return;
  const wasOpen = !!chrome?.browser.isConnected();
  try {
    await checkFlowLogin();
  } finally {
    if (!wasOpen && running === 0 && waiting.length === 0) await closeFlowChrome();
  }
}

export async function refreshCredits(page) {
  try {
    const c = await readCredits(page);
    if (c) putSetting("flow.credits", c);
    else console.warn("[flow] không đọc được credit trên trang Flow");
  } catch (err) {
    console.warn("[flow] đọc credit lỗi", err);
  }
}

export function flowStatus() {
  const st = loginState();
  const cr = creditsState();
  let profile = false;
  let diagnostics = 0;
  try {
    profile = existsSync(profileDir());
    diagnostics = existsSync(diagRoot()) ? readdirSync(diagRoot()).length : 0;
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
    busy: running > 0 || waiting.length > 0,
    active: running,
    waiting: waiting.length,
    concurrency: flowConcurrency(),
    maxConcurrency: flowMaxThreads(),
    hidden: flowHidden(),
    images: flowImagesEnabled(),
    diagnosticsDir: diagnostics ? diagRoot() : null
  };
}
