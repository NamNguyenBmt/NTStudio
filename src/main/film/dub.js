import { statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireKey } from "../ai/providers";
import { runFfmpeg, probeDuration } from "../media/ffmpeg";
import { cacheDir, hashOf, recordUsage } from "../media/generators";
import { EDGE_VOICES, synthesize } from "../tts/index";

const STS_MODEL = "eleven_multilingual_sts_v2";

export async function convertVoice(o) {
  const dir = cacheDir("voice-sts");
  const key = hashOf(o.clip, String(statSync(o.clip).size), o.voiceId, STS_MODEL);
  const out = join(dir, `${key}.mp3`);
  if (existsSync(out)) return out;
  const src = join(dir, `${key}-src.mp3`);
  await runFfmpeg(["-y", "-loglevel", "error", "-i", o.clip, "-vn", "-ac", "1", "-ar", "44100", "-b:a", "128k", src], {
    signal: o.signal,
  });
  const { key: apiKey, baseUrl, row } = requireKey("elevenlabs");
  const base = (baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const form = new FormData();
  form.append("audio", new Blob([readFileSync(src)], { type: "audio/mpeg" }), "clip.mp3");
  form.append("model_id", STS_MODEL);
  form.append("remove_background_noise", "true");
  const res = await fetch(`${base}/v1/speech-to-speech/${encodeURIComponent(o.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal: o.signal,
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(
      res.status === 401
        ? "Key ElevenLabs không hợp lệ"
        : res.status === 404
          ? "Không tìm thấy giọng ElevenLabs của nhân vật (voice id sai hoặc đã xóa)"
          : res.status === 429
            ? "ElevenLabs đang giới hạn tần suất – thử lại sau"
            : `ElevenLabs đổi giọng lỗi HTTP ${res.status}${text ? `: ${text}` : ""}`,
    );
  }
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  recordUsage(row.id, o.workspaceId, STS_MODEL, "film.voice", 0);
  return out;
}

export function dubVoiceOf(c, vietnamese) {
  if (c?.voiceProvider && (c.voiceId || c.voiceProvider === "edge_tts"))
    return { provider: c.voiceProvider, voiceId: c.voiceId, fallback: false };
  if (!vietnamese) return null;
  const female =
    /\b(female|woman|girl|lady)\b/i.test(c?.voiceProfile ?? "") || /\b(she|her)\b/i.test(c?.description ?? "");
  return { provider: "edge_tts", voiceId: female ? EDGE_VOICES[0].id : EDGE_VOICES[1].id, fallback: true };
}

async function ttsLine(provider, voiceId, text, workspaceId, signal) {
  const dir = join(cacheDir("tts"), hashOf("film-dub", provider, voiceId ?? "", text));
  const meta = join(dir, "result.json");
  if (existsSync(meta)) {
    try {
      const f = join(dir, JSON.parse(readFileSync(meta, "utf8")).name);
      if (existsSync(f)) return f;
    } catch {}
  }
  mkdirSync(dir, { recursive: true });
  const r = await synthesize({ provider, voiceId, text, dir, workspaceId, signal });
  writeFileSync(meta, JSON.stringify({ name: r.file.split(/[\\/]/).pop() }));
  return r.file;
}

export async function dubLines(o) {
  const files = [];
  for (const l of o.lines) {
    const v = o.voiceFor(l.speaker);
    if (!v) continue;
    files.push(await ttsLine(v.provider, v.voiceId, l.line, o.workspaceId, o.signal));
  }
  if (!files.length) return null;
  const inputs = files.flatMap((f) => ["-i", f]);
  const parts = files.map(
    (_f, i) => `[${i}:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,apad=pad_dur=0.2[p${i}]`,
  );
  const filter = `${parts.join(";")};${files.map((_f, i) => `[p${i}]`).join("")}concat=n=${files.length}:v=0:a=1[out]`;
  await runFfmpeg(
    ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[out]", "-c:a", "pcm_s16le", o.out],
    { signal: o.signal },
  );
  return { file: o.out, durationSec: await probeDuration(o.out) };
}
