import { BrowserWindow, dialog, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { inArray, eq } from "drizzle-orm";
import { renderJobs, settings } from "../db/schema";
import { getDb } from "../db/index";
import { ApiError } from "../errors";
import { mediaDir } from "../media/paths";
import { detectEncoders, cachedEncoders, setPreferredEncoder } from "../media/encoders";
import { previewVoice, listVoices } from "../tts/index";
import { CLIP_VIDEO_EXT, CLIP_IMAGE_EXT, clipKind } from "../../shared/video";
import { enqueueRender, cancelRender, listJobs, mediaStatus } from "../media/render-queue";
import { canFlowUpscale, probeSize, upscaleVideo } from "../film/upscale";
import { resolveMediaPath, resolveAttachedPath } from "../media/protocol";
import { generateMusic } from "../media/music";
import { estimateRender } from "../media/estimate";

const AUDIO_EXT = [".mp3", ".m4a", ".aac", ".wav", ".ogg"];
const DAY = 864e5;
const upscaling = new Map();

function upscaleSource(path) {
  const abs = resolveMediaPath(path);
  if (!abs || !existsSync(abs)) throw new ApiError("NOT_FOUND", "Không tìm thấy video");
  if (clipKind(abs) !== "video") throw new ApiError("VALIDATION", "Chỉ nâng cấp được video");
  return abs;
}

function bgmDir() {
  const dir = join(mediaDir(), "bgm");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sweep(dir, maxAgeMs, now) {
  let bytes = 0;
  let files = 0;
  if (!existsSync(dir)) return { bytes, files };
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const r = sweep(p, maxAgeMs, now);
      bytes += r.bytes;
      files += r.files;
      if (!readdirSync(p).length) rmSync(p, { recursive: true, force: true });
    } else {
      const st = statSync(p);
      if (now - st.mtimeMs > maxAgeMs) {
        rmSync(p, { force: true });
        bytes += st.size;
        files++;
      }
    }
  }
  return { bytes, files };
}

export const mediaHandlers = {
  "media.info": () => cachedEncoders(),
  "media.detect": () => detectEncoders(),
  "media.setEncoder": ({ encoder }) => setPreferredEncoder(encoder),
  "media.status": () => mediaStatus(cachedEncoders()?.chosen ?? null),
  "media.voices": ({ provider }) => listVoices(provider),
  "media.previewVoice": ({ provider, voiceId, workspaceId }) => previewVoice(provider, voiceId ?? null, workspaceId ?? null, mediaDir()),
  "media.bgmList": () => readdirSync(bgmDir()).filter((f) => AUDIO_EXT.includes(extname(f).toLowerCase())).sort((a, b) => a.localeCompare(b)),
  "media.importBgm": async () => {
    const opts = { title: "Chọn nhạc nền", properties: ["openFile"], filters: [{ name: "Âm thanh", extensions: AUDIO_EXT.map((e) => e.slice(1)) }] };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const src = res.canceled ? null : res.filePaths[0];
    if (!src) return null;
    const name = basename(src);
    copyFileSync(src, join(bgmDir(), name));
    return name;
  },
  "media.cleanup": () => {
    const now = Date.now();
    const active = new Set(
      getDb().select({ id: renderJobs.id }).from(renderJobs).where(inArray(renderJobs.status, ["queued", "running"])).all().map((r) => r.id)
    );
    let freed = 0;
    let files = 0;
    const jobs = join(mediaDir(), "jobs");
    if (existsSync(jobs)) {
      for (const d of readdirSync(jobs)) {
        if (active.has(d)) continue;
        const r = sweep(join(jobs, d), DAY, now);
        freed += r.bytes;
        files += r.files;
      }
    }
    const cache = sweep(join(mediaDir(), "cache"), 30 * DAY, now);
    return { freedBytes: freed + cache.bytes, files: files + cache.files };
  },
  "media.generateMusic": (input) => generateMusic({ ...input, workspaceId: input.workspaceId ?? null }),
  "media.imageEngine": () => {
    const v = getDb().select().from(settings).where(eq(settings.key, "media.imageEngine")).get()?.value;
    return v === "google_image" || v === "fal" ? v : "auto";
  },
  "media.setImageEngine": ({ engine }) => {
    getDb().insert(settings).values({ key: "media.imageEngine", value: engine }).onConflictDoUpdate({ target: settings.key, set: { value: engine, updatedAt: new Date() } }).run();
  },
  "render.start": ({ projectId }) => enqueueRender(projectId),
  "render.estimate": ({ projectId }) => estimateRender(projectId),
  "media.importClips": async ({ multiple, images }) => {
    const opts = {
      title: images ? "Chọn ảnh" : multiple ? "Chọn các clip / ảnh (gán lần lượt vào các cảnh)" : "Chọn clip / ảnh cho cảnh",
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: images ? [{ name: "Ảnh", extensions: CLIP_IMAGE_EXT }] : [{ name: "Video & ảnh", extensions: [...CLIP_VIDEO_EXT, ...CLIP_IMAGE_EXT] }]
    };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled) return [];
    const dir = join(mediaDir(), "uploads");
    mkdirSync(dir, { recursive: true });
    const files = [...res.filePaths].sort((a, b) => basename(a).localeCompare(basename(b), "vi", { numeric: true })).slice(0, 100);
    return files.map((src) => {
      const kind = clipKind(src);
      if (!kind) throw new ApiError("VALIDATION", `Không hỗ trợ file ${basename(src)}`);
      if (statSync(src).size > 4 * 1024 ** 3) throw new ApiError("VALIDATION", `${basename(src)} lớn hơn 4 GB`);
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${extname(src).toLowerCase()}`;
      copyFileSync(src, join(dir, name));
      return { path: `uploads/${name}`, name: basename(src), kind };
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
    const dir = join(mediaDir(), "uploads");
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now().toString(36)}-${quality}.mp4`;
    const ctrl = new AbortController();
    upscaling.set(path, { ctrl, status: "Bắt đầu…" });
    try {
      await upscaleVideo({
        src: abs,
        dest: join(dir, name),
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
  "render.cancel": ({ id }) => cancelRender(id),
  "render.jobs": ({ projectId, limit }) => listJobs(projectId, limit),
  "media.showInFolder": ({ path }) => {
    const abs = resolveMediaPath(path) ?? resolveAttachedPath(path);
    if (!abs || !existsSync(abs)) throw new ApiError("NOT_FOUND", "Không tìm thấy file");
    shell.showItemInFolder(abs);
  }
};
