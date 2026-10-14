import { presetVoices, synthesizeLocal } from "./local-engine";
import { listClones, cloneRef, cloneVoiceId } from "./clones";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { aiUsage } from "../db/schema";
import { getDb, newId } from "../db/index";
import { createHash } from "node:crypto";
import { AiError, providerRow, requireKey } from "../ai/providers";
import { runFfmpeg, probeDuration } from "../media/ffmpeg";
import { UNIT_PRICES } from "../../shared/pricing";
import { assertBudget } from "../ai/router";
import { GOOGLE_BASE, providerError, findInlineData } from "../media/generators";

export const EDGE_VOICES = [
  { id: "vi-VN-HoaiMyNeural", label: "HoaiMy (Nữ miền Bắc)" },
  { id: "vi-VN-NamMinhNeural", label: "NamMinh (Nam miền Bắc)" },
];

const OPENAI_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"].map((v) => ({
  id: v,
  label: v,
}));

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
  ["Sadaltager", "Nam · hiểu biết"],
].map(([id, desc]) => ({ id, label: `${id} (${desc})` }));

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function recordUsage(providerId, workspaceId, model, chars) {
  const unit = UNIT_PRICES[model];
  getDb()
    .insert(aiUsage)
    .values({
      id: newId(),
      providerId,
      workspaceId,
      model,
      feature: "render.tts",
      characters: chars,
      costUsd: unit?.per === "char" ? unit.usd * chars : 0,
      ok: true,
    })
    .run();
}

function bounded(p, ms, signal, onGiveUp) {
  return new Promise((resolve, reject) => {
    const stop = (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      onGiveUp();
      reject(err);
    };
    const onAbort = () => stop(new Error("Đã hủy"));
    const timer = setTimeout(() => stop(new Error(`Edge-TTS không phản hồi sau ${Math.round(ms / 1e3)} giây`)), ms);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      },
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
  const tts = new MsEdgeTTS();
  const limitMs = 15e3 + text.length * 150;
  const giveUp = () => {
    try {
      tts.close();
    } catch {}
  };
  try {
    const { audioFilePath, metadataFilePath } = await bounded(
      (async () => {
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
        return tts.toFile(dir, escapeXml(text));
      })(),
      limitMs,
      signal,
      giveUp,
    );
    let words = null;
    if (metadataFilePath) {
      const meta = JSON.parse(readFileSync(metadataFilePath, "utf8"));
      words = (meta.Metadata ?? [])
        .filter((m) => m.Type === "WordBoundary")
        .map((m) => ({
          text: m.Data.text.Text,
          start: m.Data.Offset / 1e7,
          end: (m.Data.Offset + m.Data.Duration) / 1e7,
        }));
    }
    return {
      file: audioFilePath,
      durationSec: await probeDuration(audioFilePath),
      words: words?.length ? words : null,
      provider: "edge_tts",
    };
  } finally {
    tts.close();
  }
}

async function elevenTts(text, voice, model, dir, workspaceId, signal) {
  const { key, baseUrl, row } = requireKey("elevenlabs");
  assertBudget(workspaceId);
  const base = (baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const res = await fetch(
    `${base}/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: model }),
      // Hủy render hoặc quá 120s đều dừng request
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12e4)]) : AbortSignal.timeout(12e4),
    },
  );
  if (!res.ok)
    throw await providerError("ElevenLabs", res, {
      401: "key không hợp lệ",
      404: "không tìm thấy giọng (voice id)",
      429: "vượt giới hạn / hết ký tự của gói",
    });
  const body = await res.json();
  const file = join(dir, "audio.mp3");
  writeFileSync(file, Buffer.from(body.audio_base64, "base64"));
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
  return { file, durationSec: await probeDuration(file), words, provider: "elevenlabs" };
}

async function openaiTts(text, voice, model, dir, workspaceId, signal) {
  const { key, baseUrl, row } = requireKey("openai_tts");
  assertBudget(workspaceId);
  const base = (baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
    // Hủy render hoặc quá 120s đều dừng request
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12e4)]) : AbortSignal.timeout(12e4),
  });
  if (!res.ok)
    throw await providerError("OpenAI Audio", res, {
      401: "key không hợp lệ",
      429: "vượt giới hạn hoặc hết hạn mức thanh toán",
    });
  const file = join(dir, "audio.mp3");
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  recordUsage(row.id, workspaceId, model, text.length);
  return { file, durationSec: await probeDuration(file), words: null, provider: "openai_tts" };
}

async function googleTts(text, voice, model, dir, workspaceId, signal) {
  const { key, baseUrl, row } = requireKey("google_tts");
  assertBudget(workspaceId);
  const base = (baseUrl ?? GOOGLE_BASE).replace(/\/$/, "");
  const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
    // Hủy render hoặc quá 120s đều dừng request
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12e4)]) : AbortSignal.timeout(12e4),
  });
  if (!res.ok)
    throw await providerError("Google Gemini TTS", res, {
      400: "yêu cầu không hợp lệ (model hoặc giọng không hỗ trợ)",
      403: "key không có quyền hoặc chưa bật Gemini API",
      404: "không tìm thấy model TTS – bấm Kiểm tra kết nối để cập nhật danh sách model",
      429: "vượt hạn mức – key miễn phí giới hạn rất thấp, cần bật thanh toán trong Google AI Studio",
    });
  const audio = findInlineData(await res.json(), "audio");
  if (!audio)
    throw new AiError("invalid_output", "Gemini TTS không trả về âm thanh (có thể bị chặn bởi bộ lọc an toàn)");
  const rate = Number(audio.mime.match(/rate=(\d+)/)?.[1] ?? 24e3);
  const pcm = join(dir, "audio.pcm");
  const file = join(dir, "audio.mp3");
  writeFileSync(pcm, Buffer.from(audio.data, "base64"));
  try {
    await runFfmpeg(
      ["-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", pcm, "-c:a", "libmp3lame", "-b:a", "128k", file],
      { signal },
    );
  } finally {
    rmSync(pcm, { force: true });
  }
  recordUsage(row.id, workspaceId, model, text.length);
  return { file, durationSec: await probeDuration(file), words: null, provider: "google_tts" };
}

async function localTts(text, voiceId, dir, signal) {
  const wav = join(dir, "audio.wav");
  const file = join(dir, "audio.mp3");
  const ref = cloneRef(voiceId);
  try {
    await synthesizeLocal({ text, voice: ref ? null : voiceId, ref, out: wav, signal });
    await runFfmpeg(["-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", "160k", file], { signal });
  } finally {
    rmSync(wav, { force: true });
  }
  return { file, durationSec: await probeDuration(file), words: null, provider: "local_tts" };
}

export async function synthesize(opts) {
  mkdirSync(opts.dir, { recursive: true });
  const row = providerRow(opts.provider);
  switch (opts.provider) {
    case "elevenlabs":
      if (!opts.voiceId || opts.voiceId.length < 15) throw new Error("Chưa chọn giọng ElevenLabs (voice id) cho dự án");
      return elevenTts(
        opts.text,
        opts.voiceId,
        row?.defaultModel ?? "eleven_multilingual_v2",
        opts.dir,
        opts.workspaceId,
        opts.signal,
      );
    case "openai_tts":
      return openaiTts(
        opts.text,
        OPENAI_VOICES.some((v) => v.id === opts.voiceId) ? opts.voiceId : "nova",
        row?.defaultModel ?? "gpt-4o-mini-tts",
        opts.dir,
        opts.workspaceId,
        opts.signal,
      );
    case "google_tts":
      return googleTts(
        opts.text,
        GOOGLE_TTS_VOICES.some((v) => v.id === opts.voiceId) ? opts.voiceId : "Kore",
        row?.defaultModel ?? "gemini-2.5-flash-preview-tts",
        opts.dir,
        opts.workspaceId,
        opts.signal,
      );
    case "local_tts":
      return localTts(opts.text, opts.voiceId, opts.dir, opts.signal);
    default:
      return edgeTts(
        opts.text,
        EDGE_VOICES.some((v) => v.id === opts.voiceId) ? opts.voiceId : EDGE_VOICES[0].id,
        opts.dir,
        opts.signal,
      );
  }
}

const PREVIEW_TEXT = "Xin chào! Đây là giọng đọc mẫu cho video của bạn. Bạn thấy giọng này thế nào?";

export async function previewVoice(provider, voiceId, workspaceId, root) {
  const model = providerRow(provider)?.defaultModel ?? "";
  const key = createHash("sha1")
    .update([provider, model, voiceId ?? "", PREVIEW_TEXT].join("|"))
    .digest("hex")
    .slice(0, 16);
  const rel = `voice-samples/${key}`;
  const dir = join(root, rel);
  const cached = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(".mp3")) : void 0;
  if (cached) return `${rel}/${cached}`;
  try {
    const out = await synthesize({
      provider,
      voiceId,
      text: PREVIEW_TEXT,
      dir,
      workspaceId,
      signal: AbortSignal.timeout(6e4),
    });
    return `${rel}/${basename(out.file)}`;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export async function listVoices(provider) {
  if (provider === "openai_tts") return OPENAI_VOICES;
  if (provider === "google_tts") return GOOGLE_TTS_VOICES;
  if (provider === "local_tts")
    return [
      ...listClones().map((c) => ({ id: cloneVoiceId(c), label: `🎙 ${c.name} (giọng clone)` })),
      ...presetVoices(),
    ];
  if (provider === "elevenlabs") {
    const { key, baseUrl } = requireKey("elevenlabs");
    const base = (baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
    const res = await fetch(`${base}/v1/voices`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15e3) });
    if (!res.ok)
      throw new AiError(
        res.status === 401 ? "auth" : "unknown",
        `ElevenLabs HTTP ${res.status}${res.status === 401 ? " – key không hợp lệ" : ""}`,
      );
    const body = await res.json();
    return body.voices.map((v) => ({
      id: v.voice_id,
      label: [v.name, v.labels?.gender, v.labels?.accent].filter(Boolean).join(" · "),
    }));
  }
  return EDGE_VOICES;
}
