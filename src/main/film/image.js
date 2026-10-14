import { readFileSync, writeFileSync } from "node:fs";
import { AiError, requireKey, isReady } from "../ai/providers";
import { unitCost } from "../../shared/pricing";
import { requestJson } from "../ai/adapters/http";
import { assertBudget } from "../ai/router";
import { flowImagesReady, flowGenerateImage } from "../flow/image";
import { GOOGLE_BASE, providerError, refMime, recordUsage, download, findInlineData } from "../media/generators";

const MAX_REFS = 6;
const FAL_MODEL = "fal-ai/nano-banana";

export async function generateFilmImage(opts) {
  const refs = opts.refs.slice(0, MAX_REFS);
  const fallbackReady = isReady(opts.engine === "fal" ? "fal" : "google_image");
  if (flowImagesReady()) {
    try {
      const file = await flowGenerateImage({
        prompt: opts.prompt,
        aspect: opts.aspect,
        refs: refs.slice(0, 3),
        destBase: opts.destBase,
        signal: opts.signal,
        attemptTimeoutMs: FLOW_IMAGE_TIMEOUT_MS
      });
      return { file, model: FLOW_IMAGE_LABEL, costUsd: 0 };
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
  const { key, baseUrl, row } = requireKey("google_image");
  const model = row.defaultModel ?? "gemini-3.1-flash-image";
  const base = (baseUrl ?? GOOGLE_BASE).replace(/\/$/, "");
  const body = await requestJson(`${base}/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ type: "text", text: o.prompt }, ...o.refs.map((f) => ({ type: "image", data: readFileSync(f).toString("base64"), mime_type: refMime(f) }))],
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: o.aspect, image_size: "1K" }
    }),
    signal: o.signal
  });
  const img = findInlineData(body, "image");
  if (!img) throw new AiError("invalid_output", "Nano Banana không trả về ảnh (có thể bị bộ lọc an toàn chặn – thử sửa mô tả)");
  const file = `${o.destBase}${img.mime.includes("png") ? ".png" : ".jpg"}`;
  writeFileSync(file, Buffer.from(img.data, "base64"));
  const costUsd = unitCost(model, 1);
  recordUsage(row.id, o.workspaceId, model, "film.image", costUsd);
  return { file, model, costUsd };
}

async function falNanoBanana(o) {
  const { key, baseUrl, row } = requireKey("fal");
  const model = o.refs.length ? `${FAL_MODEL}/edit` : FAL_MODEL;
  const base = (baseUrl ?? "https://fal.run").replace(/\/$/, "");
  const res = await fetch(`${base}/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: o.prompt,
      num_images: 1,
      output_format: "jpeg",
      aspect_ratio: o.aspect,
      // fal nhận ảnh dạng data URI – không cần tải ảnh lên trước
      ...o.refs.length ? { image_urls: o.refs.map((f) => `data:${refMime(f)};base64,${readFileSync(f).toString("base64")}`) } : {}
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
  const file = `${o.destBase}.jpg`;
  if (url.startsWith("data:")) writeFileSync(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  else await download(url, file, o.signal);
  const costUsd = unitCost(model, 1);
  recordUsage(row.id, o.workspaceId, model, "film.image", costUsd);
  return { file, model, costUsd };
}

export function filmImageModel(engine, withRefs) {
  if (flowImagesReady()) return FLOW_IMAGE_LABEL;
  if (engine === "fal") return withRefs ? `${FAL_MODEL}/edit` : FAL_MODEL;
  try {
    return requireKey("google_image").row.defaultModel ?? "gemini-3.1-flash-image";
  } catch {
    return "gemini-3.1-flash-image";
  }
}
