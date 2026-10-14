import { eq } from "drizzle-orm";
import { settings } from "../db/schema";
import { getDb } from "../db/index";
import { runFfmpeg, ffmpegOutput } from "./ffmpeg";

const ORDER = ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"];
const CACHE_KEY = "media.encoders";
const PREF_KEY = "media.preferredEncoder";

export const encoderLabel = {
  h264_nvenc: "NVIDIA NVENC",
  h264_amf: "AMD AMF",
  h264_qsv: "Intel QuickSync",
  libx264: "CPU libx264"
};

function getSetting(key) {
  return getDb().select().from(settings).where(eq(settings.key, key)).get()?.value;
}

function setSetting(key, value) {
  getDb().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } }).run();
}

export async function detectEncoders() {
  const version = (await ffmpegOutput(["-version"])).out.split(/\r?\n/)[0] ?? "";
  const listed = (await ffmpegOutput(["-encoders"])).out;
  const tested = [];
  for (const enc of ORDER) {
    if (!new RegExp(`\\b${enc}\\b`).test(listed)) {
      tested.push({ encoder: enc, ok: false, error: "Bản FFmpeg không có encoder này" });
      continue;
    }
    try {
      await runFfmpeg(["-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x256:r=30:d=0.2", "-c:v", enc, "-f", "null", "-"]);
      tested.push({ encoder: enc, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tested.push({ encoder: enc, ok: false, error: msg.length > 160 ? `${msg.slice(0, 160)}…` : msg });
    }
  }
  const info = { version, tested, detectedAt: Date.now(), chosen: "libx264", preferred: getSetting(PREF_KEY) ?? "auto" };
  info.chosen = pick(info);
  setSetting(CACHE_KEY, { version, tested, detectedAt: info.detectedAt });
  return info;
}

function pick(info) {
  const ok = (e) => info.tested.some((t) => t.encoder === e && t.ok);
  if (info.preferred !== "auto" && ok(info.preferred)) return info.preferred;
  return ORDER.find(ok) ?? "libx264";
}

export function cachedEncoders() {
  const c = getSetting(CACHE_KEY);
  if (!c) return null;
  const info = { ...c, preferred: getSetting(PREF_KEY) ?? "auto", chosen: "libx264" };
  info.chosen = pick(info);
  return info;
}

export function setPreferredEncoder(enc) {
  setSetting(PREF_KEY, enc);
}

export async function currentEncoder() {
  return (cachedEncoders() ?? await detectEncoders()).chosen;
}

export function encoderArgs(enc) {
  switch (enc) {
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "23", "-b:v", "8M", "-maxrate", "12M", "-bufsize", "16M"];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", "balanced", "-rc", "vbr_peak", "-b:v", "8M", "-maxrate", "12M"];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", "23", "-maxrate", "12M"];
    default:
      return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-maxrate", "12M", "-bufsize", "16M"];
  }
}
