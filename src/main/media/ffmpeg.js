import ffmpegStatic from "ffmpeg-static";
import { path } from "ffprobe-static";
import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { settings } from "../db/schema";
import { getDb } from "../db/index";

const unpacked = (p) =>
  p.replace(
    `app.asar${process.platform === "win32" ? "\\" : "/"}`,
    `app.asar.unpacked${process.platform === "win32" ? "\\" : "/"}`,
  );

export function ffmpegPath() {
  const custom = getDb().select().from(settings).where(eq(settings.key, "media.ffmpegPath")).get()?.value;
  if (typeof custom === "string" && custom && existsSync(custom)) return custom;
  if (!ffmpegStatic) throw new Error("Không tìm thấy FFmpeg cho hệ điều hành này");
  return unpacked(ffmpegStatic);
}

export function ffprobePath() {
  return unpacked(path);
}

export function fontsDir() {
  return app.isPackaged ? join(process.resourcesPath, "fonts") : join(__dirname, "../../resources/fonts");
}

export class FfmpegError extends Error {
  constructor(message, stderrTail) {
    super(message);
    this.stderrTail = stderrTail;
  }
}

export function runFfmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const full = [
      "-hide_banner",
      "-nostdin",
      "-y",
      ...(opts.onProgress ? ["-progress", "pipe:1", "-nostats"] : []),
      ...args,
    ];
    const child = spawn(ffmpegPath(), full, { cwd: opts.cwd, windowsHide: true });
    let stderr = "";
    let buf = "";
    const onAbort = () => {
      child.kill("SIGKILL");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d) => {
      if (!opts.onProgress || !opts.totalSec) return;
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/);
        if (m) opts.onProgress(Math.min(1, Number(m[1]) / 1e6 / opts.totalSec));
      }
    });
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-8e3);
    });
    child.on("error", (err) => reject(new FfmpegError(`Không chạy được FFmpeg: ${err.message}`, stderr)));
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new FfmpegError("Đã hủy", stderr));
      if (code === 0) return resolve();
      const tail = stderr.trim().split(/\r?\n/).slice(-6).join("\n");
      reject(new FfmpegError(`FFmpeg lỗi (mã ${code}): ${tail.split("\n").pop() ?? ""}`, tail));
    });
  });
}

export function ffmpegOutput(args) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", ...args], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", (err) => resolve({ code: -1, out: err.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

export async function hasAudioStream(file) {
  const r = await ffmpegOutput(["-i", file]);
  return /Stream #\d+:\d+[^\n]*Audio:/.test(r.out);
}

export function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffprobePath(),
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { windowsHide: true },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      const v = Number(out.trim());
      if (code === 0 && Number.isFinite(v)) resolve(v);
      else reject(new Error(`Không đọc được thời lượng: ${file}`));
    });
  });
}
