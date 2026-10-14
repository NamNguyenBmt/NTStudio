import { copyFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { ffmpegPath } from "../media/ffmpeg";
import { getSetting, putSetting, loginState, flowHidden, sleep, ensureChrome, placeWindows, context } from "./session";
import {
  promptCandidates,
  visible,
  clickFirst,
  sendButton,
  settingsButton,
  checkRadio,
  acceptUploadConsent,
  tiles,
  FAIL_TEXT,
  saveDiagnostics,
  isEditView,
  slotPages,
  slotConfig,
  backToGrid,
  openProject,
  acquire,
  requireFlowFeature,
} from "./video";

export const flowImagesEnabled = () => getSetting("flow.images", true) !== false;
export const setFlowImages = (on) => putSetting("flow.images", on);
export const flowImagesReady = () => flowImagesEnabled() && loginState().loggedIn;

async function configureImage(page, aspect) {
  if (!(await clickFirst([settingsButton(page)], 8e3))) throw new Error("Không tìm thấy nút cài đặt tạo trong Flow");
  await sleep(800);
  await checkRadio(page, /hình ảnh|image/i, "Hình ảnh", true);
  await checkRadio(page, new RegExp(`^\\s*(crop_\\w+\\s*)?${aspect.replace(":", "\\:")}\\s*$`), aspect, false);
  const modelBtn = page
    .getByRole("button", { name: /chọn nhóm mô hình|select model|model/i })
    .or(page.locator("button", { hasText: /arrow_drop_down/ }));
  if (await visible(modelBtn, 2500)) {
    const cur = (await modelBtn.first().textContent()) ?? "";
    if (!/nano banana/i.test(cur)) {
      await modelBtn.first().click();
      await sleep(700);
      const item = page.getByRole("menuitem").filter({ hasText: /nano banana/i });
      if (!(await visible(item, 3e3))) throw new Error("Flow không có model Nano Banana");
      await item.first().click();
      await sleep(700);
    }
  }
  await checkRadio(page, /^\s*x1\s*$/, "x1", false);
  await page.keyboard.press("Escape").catch(() => void 0);
  await sleep(600);
  const summary =
    (await settingsButton(page)
      .first()
      .textContent()
      .catch(() => "")) ?? "";
  if (/video/i.test(summary)) throw new Error("Không chuyển được Flow sang chế độ Hình ảnh");
}

async function uploadAndPick(page, file, what) {
  const name = `omnira-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${extname(file).toLowerCase() || ".png"}`;
  const tmp = join(os.tmpdir(), name);
  copyFileSync(file, tmp);
  try {
    const chooser = page.waitForEvent("filechooser", { timeout: 15e3 });
    if (!(await clickFirst([page.getByRole("button", { name: /tải nội dung nghe nhìn lên|upload/i })], 6e3)))
      throw new Error(`Không tìm thấy nút tải ${what} lên trong Flow`);
    await (await chooser).setFiles(tmp);
    const item = page.getByRole("option").filter({ hasText: name });
    const t0 = Date.now();
    for (;;) {
      await acceptUploadConsent(page);
      const txt =
        (await item
          .first()
          .textContent({ timeout: 1e3 })
          .catch(() => null)) ?? "";
      if (txt && !/đang tải lên|uploading/i.test(txt)) break;
      if (Date.now() - t0 > 9e4) throw new Error(`Tải ${what} lên Flow quá lâu`);
      await sleep(700);
    }
    await acceptUploadConsent(page);
    await item.first().click();
    await sleep(900);
    await acceptUploadConsent(page);
    await clickFirst([page.getByRole("button", { name: /thêm vào câu lệnh|add to prompt/i })], 1200);
    await sleep(600);
    await acceptUploadConsent(page);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export async function attachRefs(page, refs) {
  for (const f of refs) {
    const add = page.getByRole("button", { name: /thêm thành phần vào ô nhập câu lệnh|add ingredient|add to prompt/i });
    if (!(await clickFirst([add], 5e3))) throw new Error("Không tìm thấy nút thêm ảnh tham chiếu trong Flow");
    await sleep(900);
    await uploadAndPick(page, f, "ảnh tham chiếu");
    if (
      await page
        .getByRole("button", { name: /tải nội dung nghe nhìn lên|upload/i })
        .first()
        .isVisible()
        .catch(() => false)
    )
      await page.keyboard.press("Escape");
  }
}

async function gridImages(page) {
  return page
    .$$eval("flow-grid-tile-container", (els) =>
      els
        .map((e) => {
          const img = e.querySelector("flow-image-tile img[data-media-id]");
          return {
            id: img?.getAttribute("data-media-id") || "",
            title: (e.getAttribute("aria-label") || "") + " " + (e.querySelector(".footer-title")?.textContent || ""),
            src: img?.currentSrc || img?.getAttribute("src") || "",
            loaded: !!img && img.complete && img.naturalWidth > 0,
          };
        })
        .filter((t) => t.id),
    )
    .catch(() => []);
}

export async function flowGenerateImage(o) {
  const aspect = o.aspect === "9:16" || o.aspect === "1:1" || o.aspect === "3:4" ? o.aspect : "16:9";
  const refs = (o.refs ?? []).filter((f) => existsSync(f)).slice(0, 3);
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
      await openProject(p, slot, (t) => o.onStatus?.(t, 0));
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
      const seen = new Set((await gridImages(p)).map((t) => t.id));
      const beforeFails = (await tiles(p)).filter((x) => FAIL_TEXT.test(x.text)).length;
      if (!(await clickFirst([sendButton(p)], 5e3))) await box.press("Enter");
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
        if (failed.length > beforeFails) throw new Error(`Google Flow báo lỗi: ${failed[0].text.slice(0, 200)}`);
        const grid = await gridImages(p);
        const fresh = grid.slice(0, 6).find((t) => !seen.has(t.id) && !/omnira-/i.test(t.title) && t.loaded && t.src);
        if (fresh) {
          src = fresh.src;
          break;
        }
        for (const t of grid.slice(6)) seen.add(t.id);
        o.onStatus?.(`Google Flow đang tạo ảnh… ${sec}s`, sec);
        await sleep(1e3);
      }
      o.onStatus?.("Google Flow: tải ảnh về máy…", Math.round((Date.now() - t0) / 1e3));
      const r = await p.context().request.get(src, { timeout: 12e4 });
      if (!r.ok()) throw new Error(`Tải ảnh Flow lỗi HTTP ${r.status()}`);
      const type = r.headers()["content-type"] ?? "";
      const body = await r.body();
      if (body.length < 5e3) throw new Error("Ảnh Flow tải về quá nhỏ");
      let file;
      if (/webp/.test(type)) {
        const tmp = `${o.destBase}.webp`;
        writeFileSync(tmp, body);
        file = `${o.destBase}.jpg`;
        try {
          execFileSync(ffmpegPath(), ["-y", "-loglevel", "error", "-i", tmp, "-q:v", "2", file], { windowsHide: true });
          rmSync(tmp, { force: true });
        } catch {
          file = tmp;
        }
      } else {
        file = `${o.destBase}${/png/.test(type) ? ".png" : ".jpg"}`;
        writeFileSync(file, body);
      }
      await backToGrid(p, slot).catch(() => (broken = true));
      return file;
    } finally {
      o.signal.removeEventListener("abort", abort);
    }
  } catch (err) {
    broken = true;
    if (o.signal.aborted || (err instanceof DOMException && err.name === "AbortError"))
      throw new DOMException("Đã hủy", "AbortError");
    const dir = page && !page.isClosed() ? await saveDiagnostics(page, "image") : null;
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
