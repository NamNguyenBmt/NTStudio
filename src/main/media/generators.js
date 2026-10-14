import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  mkdirSync,
  existsSync,
  statSync,
  readFileSync,
  createWriteStream,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { aiUsage, settings } from "../db/schema";
import { getDb, newId } from "../db/index";
import { createHash } from "node:crypto";
import { readSecret } from "../vault";
import { AiError, providerRow, requireKey, isReady } from "../ai/providers";
import { mediaDir } from "./paths";
import { unitCost } from "../../shared/pricing";
import { errorFromStatus, requestJson } from "../ai/adapters/http";
import { assertBudget } from "../ai/router";
import { veoSource, flowReady } from "../flow/session";
import { flowModel, flowGenerate } from "../flow/video";
import { flowImagesReady, flowGenerateImage } from "../flow/image";

const framing = (a) => (a === "16:9" ? "Horizontal 16:9" : a === "1:1" ? "Square 1:1" : "Vertical 9:16");
const aspectKey = (a) => (a === "9:16" ? [] : [a]);
export const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const hasProvider = isReady;
export const veoAvailable = () => (veoSource() === "flow" ? flowReady() : isReady("google_veo"));
const FLOW_VEO_MODEL = "flow-veo";
export const flowCacheModel = () =>
  flowModel().startsWith("Veo")
    ? FLOW_VEO_MODEL
    : `flow-${flowModel()
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, "-")}`;

export async function providerError(provider, res, hints = {}) {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      const d = j.detail ?? j.message ?? j.error;
      detail =
        typeof d === "string"
          ? d
          : d && typeof d === "object" && "message" in d
            ? String(d.message)
            : d
              ? JSON.stringify(d)
              : "";
    } catch {
      detail = text;
    }
  } catch {}
  detail = detail.replace(/\s+/g, " ").trim().slice(0, 200);
  const hint = hints[res.status];
  const base = errorFromStatus(res.status, "");
  return new AiError(
    base.kind,
    `${provider} HTTP ${res.status}${hint ? ` – ${hint}` : ""}${detail ? ` (${detail})` : ""}`,
    res.status,
  );
}

export function cacheDir(sub) {
  const dir = join(mediaDir(), "cache", sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const hashOf = (...parts) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
const refKey = (refs) =>
  refs.length
    ? [`refs:${refs.map((f) => `${f.split(/[\\/]/).pop()}:${existsSync(f) ? statSync(f).size : 0}`).join(",")}`]
    : [];
export const refMime = (f) => (/\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg");
export const FLOW_IMAGE_MODEL = "flow-nano-banana";
const flowImageCacheBase = (prompt, aspect, refs = []) =>
  join(cacheDir("ai"), `flowimg-${hashOf(FLOW_IMAGE_MODEL, prompt, ...aspectKey(aspect), ...refKey(refs))}`);
const IMG_EXT = [".jpg", ".png", ".webp"];
export const flowImageCached = (prompt, aspect, refs = []) =>
  IMG_EXT.map((e) => flowImageCacheBase(prompt, aspect, refs) + e).find((f) => existsSync(f)) ?? null;

async function flowImage(prompt, signal, aspect = "9:16", refs = []) {
  const hit = flowImageCached(prompt, aspect, refs);
  if (hit) return { file: hit, kind: "image", source: "nano_banana", credit: "AI: Nano Banana (Google Flow)" };
  const text = `${prompt}. ${framing(aspect)} photo, photorealistic, no text, no watermark.${refs.length ? " Keep the characters exactly as in the attached reference images (face, hair, outfit)." : ""}`;
  const file = await flowGenerateImage({
    prompt: text,
    aspect,
    refs: refs.slice(0, 3),
    destBase: flowImageCacheBase(prompt, aspect, refs),
    signal,
    attemptTimeoutMs: 1e5,
  });
  return { file, kind: "image", source: "nano_banana", credit: "AI: Nano Banana (Google Flow)" };
}

export const falCacheFile = (model, prompt, aspect) =>
  join(cacheDir("ai"), `fal-${hashOf(model, prompt, ...aspectKey(aspect))}.jpg`);

export const googleImageCacheFiles = (model, prompt, aspect, refs = []) => {
  const jpg = join(cacheDir("ai"), `gimg-${hashOf(model, prompt, ...aspectKey(aspect), ...refKey(refs))}.jpg`);
  return [jpg, jpg.replace(/\.jpg$/, ".png")];
};

const veoAspectOf = (aspect) => (aspect === "9:16" ? "9:16" : "16:9");
export const veoSeconds = (sceneSec, refs = [], _frames = {}) => (refs.length ? 8 : veoDuration(sceneSec));
export const veoCacheFile = (model, prompt, sceneSec, aspect, refs = [], frames = {}) =>
  join(
    cacheDir("ai"),
    `veo-${hashOf(model, prompt, String(veoSeconds(sceneSec, refs, frames)), ...aspectKey(veoAspectOf(aspect)), ...refKey(refs), ...(frames.start ? [`start:${refKey([frames.start])[0]}`] : []), ...(frames.start && frames.end ? [`end:${refKey([frames.end])[0]}`] : []))}.mp4`,
  );

const veoImage = (f, style) => {
  const data = readFileSync(f).toString("base64");
  return style === "bytes"
    ? { bytesBase64Encoded: data, mimeType: refMime(f) }
    : { inlineData: { mimeType: refMime(f), data } };
};

const veoImageStyleOf = new Map();

export function recordUsage(providerId, workspaceId, model, feature, costUsd) {
  getDb().insert(aiUsage).values({ id: newId(), providerId, workspaceId, model, feature, costUsd, ok: true }).run();
}

export async function download(url, dest, signal, headers) {
  const res = await fetch(url, { signal, headers, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Tải media lỗi HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp), { signal });
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export function findInlineData(node, kind) {
  if (!node || typeof node !== "object") return null;
  const o = node;
  const mime = o.mime_type ?? o.mimeType;
  if (typeof o.data === "string" && o.data.length > 100 && (o.type === kind || mime?.startsWith(`${kind}/`)))
    return { data: o.data, mime: mime ?? `${kind}/*` };
  for (const v of Object.values(o)) {
    const found = Array.isArray(v) ? v.map((x) => findInlineData(x, kind)).find(Boolean) : findInlineData(v, kind);
    if (found) return found;
  }
  return null;
}

export async function pexelsVideo(query, minDuration, exclude, signal, aspect = "9:16") {
  const { key, baseUrl } = requireKey("pexels");
  const base = (baseUrl ?? "https://api.pexels.com").replace(/\/$/, "");
  const res = await fetch(
    `${base}/videos/search?query=${encodeURIComponent(query)}&orientation=${aspect === "16:9" ? "landscape" : aspect === "1:1" ? "square" : "portrait"}&size=medium&per_page=15`,
    { headers: { Authorization: key }, signal },
  );
  if (!res.ok)
    throw await providerError("Pexels", res, { 401: "key không hợp lệ", 429: "vượt giới hạn yêu cầu, thử lại sau" });
  const { videos } = await res.json();
  const fresh = videos.filter((v) => !exclude.has(`pexels-${v.id}`));
  const candidates = fresh.length ? fresh : videos;
  const pick =
    candidates.find((v) => v.duration >= minDuration) ?? [...candidates].sort((a, b) => b.duration - a.duration)[0];
  if (!pick) return null;
  const wantLandscape = aspect === "16:9";
  const mp4 = pick.video_files.filter((f) => f.file_type === "video/mp4" && f.width && f.height);
  const oriented = mp4.filter((f) => (wantLandscape ? f.width >= f.height : f.height >= f.width));
  const size = (f) => (wantLandscape ? f.width : f.height);
  const file = (oriented.length ? oriented : mp4).sort(
    (a, b) => Math.abs(size(a) - 1920) - Math.abs(size(b) - 1920),
  )[0];
  if (!file) return null;
  const dest = join(cacheDir("stock"), `pexels-${pick.id}-${file.id}.mp4`);
  if (!existsSync(dest)) await download(file.link, dest, signal);
  return { file: dest, kind: "video", source: "stock", credit: "Kho video miễn phí", stockId: `pexels-${pick.id}` };
}

export async function pixabayVideo(query, minDuration, exclude, signal, aspect = "9:16") {
  const { key, baseUrl } = requireKey("pixabay");
  const base = (baseUrl ?? "https://pixabay.com/api").replace(/\/$/, "");
  const res = await fetch(
    `${base}/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query.slice(0, 100))}&per_page=20&safesearch=true`,
    { signal },
  );
  if (!res.ok)
    throw await providerError("Pixabay", res, {
      400: "key không hợp lệ",
      401: "key không hợp lệ",
      429: "vượt giới hạn yêu cầu, thử lại sau",
    });
  const { hits } = await res.json();
  const fresh = hits.filter((h) => !exclude.has(`pixabay-${h.id}`));
  const usable = fresh.length ? fresh : hits;
  const portrait = (h) => {
    const v2 = h.videos.large ?? h.videos.medium;
    return !!v2 && (aspect === "16:9" ? v2.width > v2.height : v2.height > v2.width);
  };
  const pick =
    usable.find((h) => portrait(h) && h.duration >= minDuration) ??
    usable.find(portrait) ??
    usable.find((h) => h.duration >= minDuration) ??
    usable[0];
  if (!pick) return null;
  const v = [pick.videos.large, pick.videos.medium, pick.videos.small].find((x) => x && x.url);
  if (!v) return null;
  const dest = join(cacheDir("stock"), `pixabay-${pick.id}-${v.width}x${v.height}.mp4`);
  if (!existsSync(dest)) await download(v.url, dest, signal);
  return { file: dest, kind: "video", source: "pixabay", credit: "Kho video miễn phí", stockId: `pixabay-${pick.id}` };
}

async function falImage(prompt, workspaceId, signal, aspect = "9:16") {
  const { key, baseUrl, row } = requireKey("fal");
  const model = row.defaultModel ?? "fal-ai/flux/schnell";
  const dest = falCacheFile(model, prompt, aspect);
  if (existsSync(dest)) return { file: dest, kind: "image", source: "fal", credit: `AI: ${model}` };
  assertBudget(workspaceId);
  const base = (baseUrl ?? "https://fal.run").replace(/\/$/, "");
  const res = await fetch(`${base}/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `${prompt}, ${framing(aspect).toLowerCase()} composition, photorealistic, high detail`,
      image_size: aspect === "16:9" ? "landscape_16_9" : aspect === "1:1" ? "square_hd" : "portrait_16_9",
      num_images: 1,
      enable_safety_checker: true,
    }),
    signal,
  });
  if (!res.ok)
    throw await providerError("Fal.ai", res, {
      401: "key không hợp lệ",
      403: "tài khoản bị khóa hoặc hết số dư – kiểm tra tại fal.ai/dashboard/billing",
      429: "vượt giới hạn, thử lại sau",
    });
  const body = await res.json();
  const imageUrl = body.images?.[0]?.url;
  if (!imageUrl) throw new AiError("invalid_output", "Fal.ai không trả về ảnh (có thể bị bộ lọc an toàn chặn)");
  await download(imageUrl, dest, signal);
  recordUsage(row.id, workspaceId, model, "render.image", unitCost(model, 1));
  return { file: dest, kind: "image", source: "fal", credit: `AI: ${model}` };
}

async function googleImage(prompt, workspaceId, signal, aspect = "9:16", refs = []) {
  const { key, baseUrl, row } = requireKey("google_image");
  const model = row.defaultModel ?? "gemini-3.1-flash-image";
  const [cachedJpg, cachedPng] = googleImageCacheFiles(model, prompt, aspect, refs);
  for (const f of [cachedJpg, cachedPng])
    if (existsSync(f)) return { file: f, kind: "image", source: "nano_banana", credit: `AI: ${model}` };
  assertBudget(workspaceId);
  const base = (baseUrl ?? GOOGLE_BASE).replace(/\/$/, "");
  const body = await requestJson(`${base}/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          type: "text",
          text: `${prompt}. ${framing(aspect)} photo for a ${aspect === "9:16" ? "short social" : "social"} video, photorealistic, no text, no watermark.${refs.length ? " Keep the characters exactly as in the attached reference images (face, hair, outfit)." : ""}`,
        },
        // Ảnh tham chiếu nhân vật (tối đa 3) – giữ khuôn mặt/trang phục đồng nhất giữa các cảnh
        ...refs
          .slice(0, 3)
          .map((f) => ({ type: "image", data: readFileSync(f).toString("base64"), mime_type: refMime(f) })),
      ],
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: aspect, image_size: "1K" },
    }),
    signal,
  });
  const img = findInlineData(body, "image");
  if (!img) throw new AiError("invalid_output", "Nano Banana không trả về ảnh (có thể bị chặn bởi bộ lọc an toàn)");
  const dest = img.mime.includes("png") ? cachedPng : cachedJpg;
  writeFileSync(dest, Buffer.from(img.data, "base64"));
  recordUsage(row.id, workspaceId, model, "render.image", unitCost(model, 1));
  return { file: dest, kind: "image", source: "nano_banana", credit: `AI: ${model}` };
}

export function imageEngineIssue() {
  if (imageEngines().length) return null;
  const g = providerRow("google_image");
  const gemini = providerRow("gemini");
  const hasGeminiKey = !!gemini && !!readSecret("ai_provider", gemini.id, "api_key");
  if (hasGeminiKey && g && !g.enabled)
    return 'Ảnh AI Gemini (Nano Banana) đang TẮT – bật lại dòng "Google Gemini – Ảnh AI" trong Cài đặt (dùng chung key Gemini, không cần key riêng)';
  if (!hasGeminiKey)
    return "Chưa có key Gemini (hoặc Fal.ai) để tạo ảnh AI – nhập key Gemini trong Cài đặt, ảnh AI dùng chung key này";
  return 'Ảnh AI Gemini đang tắt hoặc chưa sẵn sàng – kiểm tra dòng "Google Gemini – Ảnh AI" trong Cài đặt';
}

export const IMAGE_ENGINE_LABEL = { flow: "Google Flow (Nano Banana)", google_image: "Ảnh Gemini", fal: "Fal.ai" };

export function imageEngines() {
  const pref = getDb().select().from(settings).where(eq(settings.key, "media.imageEngine")).get()?.value;
  const order = pref === "fal" ? ["fal", "google_image"] : ["google_image", "fal"];
  return [...(flowImagesReady() ? ["flow"] : []), ...order.filter((p) => isReady(p))];
}

export function imageBy(eng, prompt, workspaceId, signal, aspect = "9:16", refs = []) {
  return eng === "flow"
    ? flowImage(prompt, signal, aspect, refs)
    : eng === "google_image"
      ? googleImage(prompt, workspaceId, signal, aspect, refs)
      : falImage(prompt, workspaceId, signal, aspect);
}

const veoDuration = (sec) => (sec <= 4 ? 4 : sec <= 6 ? 6 : 8);

export async function veoClip(
  prompt,
  sceneSec,
  workspaceId,
  signal,
  onWait,
  aspect = "9:16",
  refs = [],
  frames = {},
  destOverride,
) {
  if (veoSource() === "flow") {
    const start22 = frames.start && existsSync(frames.start) ? frames.start : null;
    const flowRefs = start22 ? [] : refs.filter((f) => existsSync(f)).slice(0, 3);
    const dest2 =
      destOverride ?? veoCacheFile(flowCacheModel(), prompt, sceneSec, aspect, flowRefs, { start: start22 });
    if (!destOverride && existsSync(dest2))
      return { file: dest2, kind: "video", source: "veo", credit: "AI: Veo (Google Flow)" };
    await flowGenerate({
      prompt,
      aspect,
      seconds: sceneSec,
      start: start22,
      refs: flowRefs,
      dest: dest2,
      signal,
      onStatus: (t, sec) => onWait?.(sec, t),
    });
    return { file: dest2, kind: "video", source: "veo", credit: "AI: Veo (Google Flow)" };
  }
  const veoAspect = veoAspectOf(aspect);
  const { key, baseUrl, row } = requireKey("google_veo");
  const model = row.defaultModel ?? "veo-3.1-lite-generate-preview";
  const start = frames.start && existsSync(frames.start) ? frames.start : null;
  const end = start && frames.end && existsSync(frames.end) ? frames.end : null;
  const duration = veoSeconds(sceneSec, refs, {});
  const dest = destOverride ?? veoCacheFile(model, prompt, sceneSec, aspect, refs, { start, end });
  if (!destOverride && existsSync(dest)) return { file: dest, kind: "video", source: "veo", credit: `AI: ${model}` };
  assertBudget(workspaceId);
  const base = (baseUrl ?? GOOGLE_BASE).replace(/\/$/, "");
  const headers = { "x-goog-api-key": key, "Content-Type": "application/json" };
  const begin = (withRefs, style) =>
    requestJson(`${base}/models/${encodeURIComponent(model)}:predictLongRunning`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        instances: [
          {
            prompt: `${prompt}. ${framing(veoAspect)} video, cinematic, smooth camera motion, no on-screen text.`,
            ...(start ? { image: veoImage(start, style) } : {}),
            ...(end ? { lastFrame: veoImage(end, style) } : {}),
            ...(withRefs
              ? {
                  referenceImages: refs.slice(0, 3).map((f) => ({ image: veoImage(f, style), referenceType: "asset" })),
                }
              : {}),
          },
        ],
        parameters: {
          aspectRatio: veoAspect,
          durationSeconds: withRefs ? 8 : duration,
          resolution: "720p",
          // Tạo từ ảnh (khung đầu / cuối / tham chiếu): API chỉ cho "allow_adult"
          ...(start || withRefs ? { personGeneration: "allow_adult" } : {}),
        },
      }),
      signal,
    });
  const isFormatError = (err) =>
    err instanceof AiError && err.kind === "bad_request" && /inlineData|bytesBase64Encoded/i.test(err.message);
  const attempt = async (withRefs) => {
    const first = veoImageStyleOf.get(model) ?? "inline";
    try {
      const r = await begin(withRefs, first);
      if (start || withRefs) veoImageStyleOf.set(model, first);
      return r;
    } catch (err) {
      if (!(start || withRefs) || !isFormatError(err)) throw err;
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
    console.warn(
      `[veo] model ${model} không nhận ảnh tham chiếu (${err.message.slice(0, 120)}) → tạo không kèm ảnh tham chiếu`,
    );
    op = await attempt(false);
  }
  const started = Date.now();
  for (;;) {
    if (signal.aborted) throw new Error("Đã hủy");
    if (Date.now() - started > 10 * 6e4) throw new AiError("timeout", "Veo chưa xong sau 10 phút");
    await new Promise((r) => setTimeout(r, 8e3));
    onWait?.(Math.round((Date.now() - started) / 1e3));
    const st = await requestJson(`${base}/${op.name}`, { headers: { "x-goog-api-key": key }, signal });
    if (!st.done) continue;
    if (st.error) throw new AiError("bad_request", `Veo lỗi: ${st.error.message ?? "không rõ"}`);
    const gvr = st.response?.generateVideoResponse;
    const uri = gvr?.generatedSamples?.[0]?.video?.uri;
    if (!uri)
      throw new AiError(
        "refusal",
        `Veo không trả video${gvr?.raiMediaFilteredReasons?.length ? ` (bị lọc: ${gvr.raiMediaFilteredReasons.join("; ")})` : ""}`,
      );
    const host = new URL(uri).host;
    const trusted = host.endsWith(".googleapis.com") || host === new URL(base).host;
    await download(uri, dest, signal, trusted ? { "x-goog-api-key": key } : void 0);
    break;
  }
  recordUsage(row.id, workspaceId, model, "render.video", unitCost(model, duration));
  return { file: dest, kind: "video", source: "veo", credit: `AI: ${model}` };
}
