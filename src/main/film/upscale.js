import { rmSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { ffprobePath, runFfmpeg, probeDuration } from "../media/ffmpeg";
import { currentEncoder } from "../media/encoders";
import { readFlowRef, flowUpscale } from "../flow/video";
import { UPSCALE_QUALITIES } from "../../shared/upscale";

export const canFlowUpscale = (file) => !!readFlowRef(file);

export function probeSize(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", file], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => out += d.toString());
    child.on("error", reject);
    child.on("close", () => {
      const [w, h] = out.trim().split("x").map(Number);
      if (w > 0 && h > 0) resolve({ w, h });
      else reject(new Error("Không đọc được kích thước video"));
    });
  });
}

function encodeArgs(enc, quality) {
  const [b, max] = quality === "4k" ? ["40M", "60M"] : ["12M", "18M"];
  switch (enc) {
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p6", "-rc", "vbr", "-cq", "19", "-b:v", b, "-maxrate", max, "-bufsize", max];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", "quality", "-rc", "vbr_peak", "-b:v", b, "-maxrate", max];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-preset", "slow", "-global_quality", "19", "-maxrate", max];
    default:
      return ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-maxrate", max, "-bufsize", max];
  }
}

async function localUpscale(o) {
  const target = UPSCALE_QUALITIES.find((q) => q.id === o.quality).shortSide;
  const { w, h } = await probeSize(o.src);
  if (Math.min(w, h) >= target) throw new Error(`Video đã có độ phân giải ${w}×${h} – không cần nâng cấp lên ${o.quality === "4k" ? "4K" : "1080p"}`);
  const portrait = h > w;
  const scale = portrait ? `scale=${target}:-2:flags=lanczos` : `scale=-2:${target}:flags=lanczos`;
  const totalSec = await probeDuration(o.src).catch(() => 0);
  const run = (enc2) => runFfmpeg(
    ["-loglevel", "error", "-i", o.src, "-map", "0:v:0", "-map", "0:a?", "-vf", `${scale},unsharp=5:5:0.6:5:5:0,format=yuv420p`, ...encodeArgs(enc2, o.quality), "-c:a", "copy", "-movflags", "+faststart", o.dest],
    { signal: o.signal, totalSec, onProgress: o.onProgress }
  );
  const enc = await currentEncoder();
  try {
    await run(enc);
  } catch (err) {
    if (o.signal.aborted || enc === "libx264") throw err;
    console.warn(`[upscale] ${enc} lỗi → thử lại bằng CPU`, err instanceof Error ? err.message : err);
    rmSync(o.dest, { force: true });
    await run("libx264");
  }
}

export async function upscaleVideo(o) {
  if (!existsSync(o.src)) throw new Error("Không tìm thấy video gốc (có thể đã bị xóa)");
  const label = o.quality === "4k" ? "4K" : "1080p";
  try {
    if (o.method === "flow") {
      const ref = readFlowRef(o.src);
      if (!ref) throw new Error('Video này không tạo bằng Google Flow (hoặc tạo bằng bản app cũ) – chọn cách "Trên máy"');
      await flowUpscale({ ref, quality: o.quality, dest: o.dest, signal: o.signal, onStatus: o.onStatus });
      return `Google Flow · nâng cấp ${label}`;
    }
    o.onStatus?.(`Đang nâng cấp ${label} trên máy…`);
    await localUpscale({ src: o.src, dest: o.dest, quality: o.quality, signal: o.signal, onProgress: (r) => o.onStatus?.(`Đang nâng cấp ${label} trên máy… ${Math.round(r * 100)}%`) });
    return `FFmpeg · nâng cấp ${label}`;
  } catch (err) {
    rmSync(o.dest, { force: true });
    throw err;
  }
}
