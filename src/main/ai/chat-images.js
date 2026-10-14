import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { ffmpegPath } from "../media/ffmpeg";

export function loadChatImages(files, max = 4) {
  const out = [];
  const dir = mkdtempSync(join(os.tmpdir(), "omni-ai-img-"));
  try {
    for (const [i, f] of files.filter((x) => existsSync(x)).slice(0, max).entries()) {
      const dest = join(dir, `${i}.jpg`);
      try {
        execFileSync(
          ffmpegPath(),
          ["-y", "-loglevel", "error", "-i", f, "-frames:v", "1", "-vf", "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease", "-q:v", "4", dest],
          { windowsHide: true, timeout: 3e4 }
        );
        out.push({ mime: "image/jpeg", data: readFileSync(dest).toString("base64") });
      } catch (err) {
        console.warn("[ai] không đọc được ảnh tham chiếu", err instanceof Error ? err.message.split("\n")[0] : err);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}
