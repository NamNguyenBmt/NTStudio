import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq, asc } from "drizzle-orm";
import { videoProjects, videoScenes } from "../db/schema";
import { getDb } from "../db/index";
import { notFound } from "../errors";
import { providerInfo } from "../../shared/providers";
import { providerRow } from "../ai/providers";
import { mediaDir } from "./paths";
import { UNIT_PRICES, unitCost } from "../../shared/pricing";
import { veoSource } from "../flow/session";
import { veoAvailable, flowCacheModel, FLOW_IMAGE_MODEL, flowImageCached, falCacheFile, googleImageCacheFiles, veoSeconds, veoCacheFile, imageEngineIssue, imageEngines } from "./generators";
import { effectiveMode } from "../../shared/video";
import { stillImagePrompt } from "./prompts";
import { ttsCacheDir, sceneRefs, sceneFrames } from "./render";

const WORDS_PER_SEC = 2.8;

export function estimateRender(projectId) {
  const db = getDb();
  const p = db.select().from(videoProjects).where(eq(videoProjects.id, projectId)).get();
  if (!p) throw notFound("dự án video");
  const scenes = db.select().from(videoScenes).where(eq(videoScenes.projectId, projectId)).orderBy(asc(videoScenes.position)).all().map((s) => p.narration ? s : { ...s, voiceover: "" });
  const aspect = p.aspect;
  const warnings = [];
  const veoReady = veoAvailable();
  const flow = veoSource() === "flow";
  const veoModel = veoReady ? flow ? flowCacheModel() : providerRow("google_veo")?.defaultModel ?? "veo-3.1-lite-generate-preview" : null;
  const engine = imageEngines()[0] ?? null;
  const imageModel = engine ? engine === "flow" ? FLOW_IMAGE_MODEL : providerRow(engine)?.defaultModel ?? (engine === "google_image" ? "gemini-3.1-flash-image" : "fal-ai/flux/schnell") : null;
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
      if (s.mediaPath && existsSync(join(mediaDir(), s.mediaPath))) cached = true;
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
        const file = flow ? veoCacheFile(veoModel, query, sec, aspect, [], { start: frames.start ?? null }) : veoCacheFile(veoModel, query, sec, aspect, refsOf(s), frames);
        if (existsSync(file)) cached = true;
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
      if (engine && imageModel) {
        const hit = engine === "flow" ? !!flowImageCached(stillImagePrompt(query), aspect, refsOf(s)) : engine === "google_image" ? googleImageCacheFiles(imageModel, stillImagePrompt(query), aspect, refsOf(s)).some((f) => existsSync(f)) : existsSync(falCacheFile(imageModel, stillImagePrompt(query), aspect));
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
      if (!existsSync(join(ttsCacheDir(p.ttsProvider, voice, s.voiceover.trim()), "result.json"))) {
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
  if (veoWanted && !veoReady) warnings.push(`${veoWanted} cảnh chọn Video AI (Veo) nhưng Veo chưa sẵn sàng (cần key Gemini có billing) → dùng ${engine ? "ảnh AI" : "video stock"}`);
  if (imageWanted && !engine) warnings.push(`${imageEngineIssue() ?? "Ảnh AI chưa sẵn sàng"} → dùng video stock`);
  if (missingClips) warnings.push(`${missingClips} cảnh chọn "Clip của tôi" nhưng chưa gắn file`);
  if (ttsModel && !ttsUnit) warnings.push(`Chưa có đơn giá cho giọng ${ttsModel} – chi phí giọng đọc chưa tính`);
  out.veoUsd = Math.round(out.veoUsd * 100) / 100;
  out.imageUsd = Math.round(out.imageUsd * 100) / 100;
  out.ttsUsd = Math.round(out.ttsUsd * 100) / 100;
  out.totalUsd = Math.round((out.veoUsd + out.imageUsd + out.ttsUsd) * 100) / 100;
  return out;
}
