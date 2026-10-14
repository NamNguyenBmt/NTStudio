import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aiUsage } from "../db/schema";
import { getDb, newId } from "../db/index";
import { AiError, requireKey } from "../ai/providers";
import { mediaDir } from "./paths";
import { unitCost } from "../../shared/pricing";
import { errorFromStatus, requestJson } from "../ai/adapters/http";
import { assertBudget } from "../ai/router";
import { GOOGLE_BASE, findInlineData } from "./generators";

function fileName(prompt) {
  const slug = prompt.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "nhac-ai";
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  return `ai-${slug}-${stamp}.mp3`;
}

export async function generateMusic(req) {
  assertBudget(req.workspaceId);
  const dir = join(mediaDir(), "bgm");
  mkdirSync(dir, { recursive: true });
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
    writeFileSync(join(dir, name), Buffer.from(audio.data, "base64"));
    const costUsd2 = unitCost(model2, 1);
    getDb().insert(aiUsage).values({ id: newId(), providerId: row2.id, workspaceId: req.workspaceId, model: model2, feature: "music.generate", costUsd: costUsd2, ok: true }).run();
    return { file: name, costUsd: costUsd2, model: model2 };
  }
  const { key, baseUrl, row } = requireKey("elevenlabs_music");
  const model = row.defaultModel ?? "music_v2_5";
  const base = (baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const seconds = Math.min(180, Math.max(10, Math.round(req.durationSec)));
  const res = await fetch(`${base}/v1/music?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: req.prompt.trim(), music_length_ms: seconds * 1e3, model_id: model, force_instrumental: req.instrumental }),
    signal
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw errorFromStatus(res.status, detail.slice(0, 200));
  }
  writeFileSync(join(dir, name), Buffer.from(await res.arrayBuffer()));
  const costUsd = unitCost(model, seconds / 60);
  getDb().insert(aiUsage).values({ id: newId(), providerId: row.id, workspaceId: req.workspaceId, model, feature: "music.generate", costUsd, ok: true }).run();
  return { file: name, costUsd, model };
}
