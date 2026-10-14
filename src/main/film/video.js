import { readFileSync, writeFileSync } from "node:fs";
import { AiError, requireKey } from "../ai/providers";
import { unitCost } from "../../shared/pricing";
import { errorFromStatus } from "../ai/adapters/http";
import { assertBudget } from "../ai/router";
import { veoSource } from "../flow/session";
import { flowModel, flowClipSeconds, flowGenerate } from "../flow/video";
import { refMime, veoSeconds, recordUsage, download, veoClip } from "../media/generators";

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

export function videoPlan(f, shotSec) {
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

const dataUri = (f) => `data:${refMime(f)};base64,${readFileSync(f).toString("base64")}`;

async function falJson(url, key, signal, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal, headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", ...init.headers ?? {} } });
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
    const detail = typeof b?.detail === "string" ? b.detail : b?.detail ? JSON.stringify(b.detail).slice(0, 300) : typeof b?.error === "string" ? b.error : text.slice(0, 200);
    const e = errorFromStatus(res.status, detail);
    if (res.status === 403) throw new AiError("auth", `${e.message} – tài khoản fal bị khóa hoặc hết số dư (fal.ai/dashboard/billing)`, 403);
    if (res.status === 422) throw new AiError("bad_request", `fal từ chối yêu cầu: ${detail}`, 422);
    throw e;
  }
  return body;
}

async function seedanceClip(o) {
  const { key, baseUrl, row } = requireKey("seedance");
  const model = seedanceModel(o.film.videoTier);
  const resolution = seedanceResolution(o.film);
  const base = (baseUrl ?? "https://queue.fal.run").replace(/\/$/, "");
  const sub = await falJson(`${base}/${model}`, key, o.signal, {
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
    if (sub.cancel_url) void fetch(sub.cancel_url, { method: "PUT", headers: { Authorization: `Key ${key}` } }).catch(() => void 0);
  };
  o.signal.addEventListener("abort", cancel, { once: true });
  const started = Date.now();
  try {
    for (; ; ) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (o.signal.aborted) throw new Error("Đã hủy");
      if (Date.now() - started > TIMEOUT_MS) throw new AiError("timeout", "Seedance chưa xong sau 20 phút");
      const st = await falJson(statusUrl, key, o.signal);
      o.onStatus?.(st.status === "IN_QUEUE" ? `Đang xếp hàng ở fal${st.queue_position != null ? ` (vị trí ${st.queue_position})` : ""}` : "Seedance đang tạo video…");
      if (st.status === "COMPLETED") break;
    }
    const out = await falJson(responseUrl, key, o.signal);
    const url = out.video?.url;
    if (!url) throw new AiError("refusal", "Seedance không trả video (có thể bị bộ lọc nội dung chặn – thử sửa hành động / khung hình)");
    if (url.startsWith("data:")) writeFileSync(o.dest, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    else await download(url, o.dest, o.signal);
  } finally {
    o.signal.removeEventListener("abort", cancel);
  }
  const costUsd = seedanceUsd(o.film, o.seconds);
  recordUsage(row.id, o.film.workspaceId, model, "film.video", costUsd);
  return { model, costUsd };
}

export async function generateFilmVideo(o) {
  assertBudget(o.film.workspaceId);
  const plan = videoPlan(o.film, o.shotSec);
  if (o.film.videoEngine === "seedance") return { ...await seedanceClip({ ...o, seconds: plan.seconds }), seconds: plan.seconds };
  if (veoSource() === "flow") {
    await flowGenerate({ prompt: o.prompt, aspect: o.film.aspect, seconds: o.shotSec, start: o.start, dest: o.dest, signal: o.signal, onStatus: (t) => o.onStatus?.(t) });
    return { model: plan.model, costUsd: 0, seconds: plan.seconds };
  }
  await veoClip(o.prompt, o.shotSec, o.film.workspaceId, o.signal, () => o.onStatus?.("Veo đang tạo video…"), o.film.aspect, [], { start: o.start, end: o.end ?? null }, o.dest);
  return { model: plan.model, costUsd: plan.usd, seconds: plan.seconds };
}
