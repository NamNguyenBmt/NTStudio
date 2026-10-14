import { app } from "electron";
import { readFileSync, existsSync, statfsSync, createWriteStream, readdirSync, statSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ENGINE_SCRIPT = String.raw`import json, sys, os, traceback

proto = sys.stdout
sys.stdout = sys.stderr  # print() của thư viện không được lẫn vào kênh giao tiếp


def send(obj):
    proto.write(json.dumps(obj, ensure_ascii=False) + "\n")
    proto.flush()


def main():
    device, gpu = "cpu", None
    try:
        import torch
        if torch.cuda.is_available():
            device, gpu = "cuda", torch.cuda.get_device_name(0)
    except Exception:
        pass
    from vieneu import Vieneu
    tts = Vieneu(mode="v3turbo")
    send({"ready": True, "backend": getattr(tts, "backend", "?"), "device": device, "gpu": gpu})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = {}
        try:
            req = json.loads(line)
            op = req.get("op")
            if op == "voices":
                send({"id": req["id"], "ok": True, "voices": [[label, vid] for label, vid in tts.list_preset_voices()]})
            elif op == "synth":
                ref = req.get("ref")
                audio = tts.infer(req["text"], voice=None if ref else req.get("voice"), ref_audio=ref)
                tts.save(audio, req["out"])
                send({"id": req["id"], "ok": True, "seconds": round(len(audio) / tts.sample_rate, 3)})
            elif op == "ping":
                send({"id": req["id"], "ok": True})
            else:
                send({"id": req.get("id"), "ok": False, "error": "op không hợp lệ: %s" % op})
        except Exception as e:
            traceback.print_exc()
            send({"id": req.get("id"), "ok": False, "error": "%s: %s" % (type(e).__name__, e)})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        send({"fatal": "%s: %s" % (type(e).__name__, e)})
        sys.exit(1)
`;

const UV_URL = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip";
const TORCH = ["torch==2.8.0", "torchaudio==2.8.0"];
const TORCH_INDEX = "https://download.pytorch.org/whl/cu128";
const VIENEU = "vieneu==3.8.3";
const GPU_EXTRA = ["transformers==4.57.6"];
const VERSION = "VieNeu-TTS 3.8.3 · v3 Turbo";
const MIN_VRAM_MB = 3e3;
const IDLE_MS = 5 * 6e4;
const SIZE_GB = { cuda: { download: 4, disk: 7 }, cpu: { download: 1.5, disk: 3 } };
const root = () => join(app.getPath("userData"), "local-tts");
const venvPython = () => join(root(), "venv", "Scripts", "python.exe");
const manifestFile = () => join(root(), "installed.json");

function manifest() {
  try {
    const m = JSON.parse(readFileSync(manifestFile(), "utf8"));
    return existsSync(venvPython()) ? m : null;
  } catch {
    return null;
  }
}

function env(offline) {
  return {
    ...process.env,
    HF_HOME: join(root(), "hf"),
    UV_PYTHON_INSTALL_DIR: join(root(), "python"),
    UV_CACHE_DIR: join(root(), "uv-cache"),
    // Windows: Python mặc định cp1252 → lỗi khi in tiếng Việt
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    // Cài xong thì model đã nằm sẵn trong hf/ – không gọi mạng khi chạy
    ...offline ? { HF_HUB_OFFLINE: "1" } : {}
  };
}

let gpuCache = null;

function nvidiaSmi() {
  const candidates = ["nvidia-smi", join(process.env.ProgramFiles ?? "C:\\Program Files", "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe")];
  const tryOne = (i) => i >= candidates.length ? Promise.resolve(null) : new Promise(
    (res) => execFile(
      candidates[i],
      ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
      { timeout: 8e3, windowsHide: true },
      (err, out) => err ? res(tryOne(i + 1)) : res(out)
    )
  );
  return tryOne(0);
}

async function detectGpu(force = false) {
  if (gpuCache && !force) return gpuCache.gpu;
  let gpu = null;
  if (process.platform === "win32") {
    const out = await nvidiaSmi();
    for (const line of out?.split(/\r?\n/) ?? []) {
      const [name, vram, driver] = line.split(",").map((s) => s.trim());
      const vramMb = Number(vram);
      if (!name || !Number.isFinite(vramMb)) continue;
      if (!gpu || vramMb > gpu.vramMb) gpu = { name, vramMb, driver: driver ?? "", driverOk: Number.parseFloat(driver ?? "0") >= 570 };
    }
  }
  gpuCache = { gpu };
  return gpu;
}

const gpuUsable = (gpu) => !!gpu && gpu.vramMb >= MIN_VRAM_MB && gpu.driverOk;

function diskFreeGb() {
  try {
    const s = statfsSync(app.getPath("userData"));
    return s.bavail * s.bsize / 1024 ** 3;
  } catch {
    return null;
  }
}

function assessHardware(gpu) {
  const list = os.cpus();
  const threads = list.length;
  const ramGb = os.totalmem() / 1024 ** 3;
  const variant = gpuUsable(gpu) ? "cuda" : "cpu";
  const notes = [];
  let rating = variant === "cuda" ? "good" : "slow";
  if (gpu && gpuUsable(gpu)) notes.push(`GPU ${gpu.name} (${(gpu.vramMb / 1024).toFixed(0)} GB VRAM) – đọc nhanh hơn thời gian thực nhiều lần`);
  else if (gpu && gpu.vramMb < MIN_VRAM_MB) notes.push(`GPU ${gpu.name} chỉ có ${(gpu.vramMb / 1024).toFixed(1)} GB VRAM (cần từ 3 GB) → chạy bằng CPU`);
  else if (gpu) notes.push(`Driver NVIDIA ${gpu.driver} cũ (cần 570+) → chạy bằng CPU. Cập nhật driver rồi bấm "Dò lại" để dùng GPU`);
  else notes.push("Không có GPU rời NVIDIA → chạy bằng CPU: đọc ~1 giây audio mất ~1 giây, mỗi giọng clone lần đầu cần ~1 phút để phân tích");
  if (ramGb < 6) {
    rating = "poor";
    notes.push(`RAM ${ramGb.toFixed(0)} GB – nên có từ 8 GB (model chiếm ~1–2 GB khi chạy)`);
  } else if (ramGb < 8 && rating === "good") rating = "slow";
  if (threads < 4) {
    rating = "poor";
    notes.push(`CPU chỉ ${threads} luồng – nên có từ 4 luồng`);
  } else if (variant === "cpu" && threads < 8) notes.push(`CPU ${threads} luồng – video dài (nhiều cảnh) sẽ đọc lâu hơn`);
  const disk = diskFreeGb();
  if (disk != null && disk < SIZE_GB[variant].disk) notes.push(`Ổ đĩa còn ${disk.toFixed(1)} GB – cần trống ${SIZE_GB[variant].disk} GB để cài`);
  return {
    cpu: (list[0]?.model ?? "CPU").replace(/\s+/g, " ").trim(),
    threads,
    ramGb: Math.round(ramGb * 10) / 10,
    diskFreeGb: disk == null ? null : Math.round(disk * 10) / 10,
    rating,
    notes,
    variant,
    downloadGb: SIZE_GB[variant].download
  };
}

const install = { running: false, stage: "", progress: 0, startedAt: null, error: null, log: [] };
let installAbort = null;

function log(line) {
  const s = line.trimEnd();
  if (!s) return;
  install.log.push(s.length > 300 ? `${s.slice(0, 300)}…` : s);
  if (install.log.length > 200) install.log.splice(0, install.log.length - 200);
}

function stage(name, progress) {
  install.stage = name;
  install.progress = progress;
  log(`── ${name}`);
}

function run(cmd, args, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root(), env: env(false), windowsHide: true });
    const tail = [];
    const onData = (b) => {
      for (const l of b.toString("utf8").split(/\r?\n|\r/)) {
        if (!l.trim()) continue;
        log(l);
        tail.push(l);
        if (tail.length > 8) tail.shift();
      }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    const onAbort = () => void p.kill();
    signal.addEventListener("abort", onAbort, { once: true });
    p.on("error", (e) => (signal.removeEventListener("abort", onAbort), reject(e)));
    p.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(new Error("Đã hủy"));
      else if (code === 0) resolve();
      else reject(new Error(`${cmd.split(/[\\/]/).pop()} thoát mã ${code}: ${tail.slice(-3).join(" | ")}`));
    });
  });
}

async function download(url, file, signal, from, to) {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Tải ${url} lỗi HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (c) => {
    got += c.length;
    if (total) install.progress = from + (to - from) * got / total;
  });
  await pipeline(body, createWriteStream(file));
}

function findFile(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    }
  }
  return null;
}

function dirSize(dir) {
  let n = 0;
  if (!existsSync(dir)) return 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    try {
      n += e.isDirectory() ? dirSize(p) : statSync(p).size;
    } catch {
    }
  }
  return n;
}

async function doInstall(variant, signal) {
  mkdirSync(root(), { recursive: true });
  rmSync(manifestFile(), { force: true });
  stage("Tải công cụ cài đặt (uv)", 0.01);
  const uvDir = join(root(), "uv");
  let uv = existsSync(uvDir) ? findFile(uvDir, "uv.exe") : null;
  if (!uv) {
    mkdirSync(uvDir, { recursive: true });
    const zip = join(uvDir, "uv.zip");
    await download(UV_URL, zip, signal, 0.01, 0.04);
    await run(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", uvDir], signal);
    rmSync(zip, { force: true });
    uv = findFile(uvDir, "uv.exe");
    if (!uv) throw new Error("Không tìm thấy uv.exe sau khi giải nén");
  }
  stage("Tải Python 3.11", 0.05);
  if (!existsSync(venvPython())) {
    rmSync(join(root(), "venv"), { recursive: true, force: true });
    await run(uv, ["venv", join(root(), "venv"), "--python", "3.11"], signal);
  }
  if (variant === "cuda") {
    stage("Tải PyTorch CUDA 12.8 (~2.5 GB – mất vài phút tùy mạng)", 0.12);
    await run(uv, ["pip", "install", "--python", venvPython(), ...TORCH, "--index-url", TORCH_INDEX], signal);
  }
  stage(variant === "cuda" ? "Cài VieNeu-TTS" : "Cài VieNeu-TTS (bản CPU)", variant === "cuda" ? 0.7 : 0.15);
  await run(uv, ["pip", "install", "--python", venvPython(), VIENEU, ...variant === "cuda" ? GPU_EXTRA : []], signal);
  stage("Tải model giọng & chạy thử (lần đầu ~1–2 phút)", 0.8);
  writeFileSync(join(root(), "engine.py"), ENGINE_SCRIPT, "utf8");
  await stopEngine();
  signal.addEventListener("abort", () => void stopEngine(), { once: true });
  const eng = await startEngine(false);
  log(`Engine: ${eng.info.backend} trên ${eng.info.device}${eng.info.gpu ? ` (${eng.info.gpu})` : ""}`);
  if (variant === "cuda" && eng.info.device !== "cuda") log("⚠ PyTorch không dùng được GPU (driver cũ?) – engine chạy bằng CPU, vẫn dùng được nhưng chậm hơn");
  const voices = (await eng.request({ op: "voices" }, signal, 6e4)).voices;
  const testDir = join(root(), "test");
  mkdirSync(testDir, { recursive: true });
  const sample = join(testDir, "preset.wav");
  install.progress = 0.88;
  await eng.request({ op: "synth", text: "Xin chào, đây là giọng đọc chạy trên máy của bạn.", voice: voices[0]?.[1], out: sample }, signal, 5 * 6e4);
  install.progress = 0.93;
  await eng.request({ op: "synth", text: "Thử clone giọng.", ref: sample, out: join(testDir, "clone.wav") }, signal, 5 * 6e4);
  await stopEngine();
  rmSync(testDir, { recursive: true, force: true });
  stage("Dọn file tạm", 0.98);
  rmSync(join(root(), "uv-cache"), { recursive: true, force: true });
  const m = { version: VERSION, variant, installedAt: Date.now(), sizeBytes: dirSize(root()), voices };
  writeFileSync(manifestFile(), JSON.stringify(m, null, 2));
  stage("Đã cài xong", 1);
}

export async function startInstall() {
  if (install.running) return;
  const s = await status();
  if (!s.eligible || !s.hardware) throw new Error(s.reason ?? "Máy không đủ điều kiện");
  const variant = s.hardware.variant;
  installAbort = new AbortController();
  Object.assign(install, { running: true, stage: "Bắt đầu", progress: 0, startedAt: Date.now(), error: null, log: [] });
  doInstall(variant, installAbort.signal).catch((e) => {
    install.error = installAbort?.signal.aborted ? "Đã hủy cài đặt" : e instanceof Error ? e.message : String(e);
    log(`✖ ${install.error}`);
    void stopEngine();
  }).finally(() => {
    install.running = false;
    installAbort = null;
  });
}

export function cancelInstall() {
  installAbort?.abort();
}

export async function uninstall() {
  if (install.running) throw new Error("Đang cài đặt – hủy cài trước");
  await stopEngine();
  rmSync(root(), { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  Object.assign(install, { stage: "", progress: 0, startedAt: null, error: null, log: [] });
}

export async function status(forceDetect = false) {
  const platformSupported = process.platform === "win32" && process.arch === "x64";
  const gpu = platformSupported ? await detectGpu(forceDetect) : null;
  const hardware = platformSupported ? assessHardware(gpu) : null;
  let reason = null;
  if (!platformSupported) reason = "Giọng local hiện chỉ hỗ trợ Windows 64-bit";
  else if (hardware?.diskFreeGb != null && hardware.diskFreeGb < SIZE_GB[hardware.variant].disk)
    reason = `Ổ đĩa không đủ chỗ: còn ${hardware.diskFreeGb} GB, cần trống ${SIZE_GB[hardware.variant].disk} GB`;
  const m = manifest();
  return {
    platformSupported,
    gpu,
    hardware,
    // Cấu hình yếu vẫn cho cài – giao diện hiện đánh giá & khuyến nghị
    eligible: platformSupported && reason == null,
    reason,
    installed: m ? { version: m.version, variant: m.variant ?? "cuda", installedAt: m.installedAt, sizeBytes: m.sizeBytes, voices: m.voices.length } : null,
    install: { ...install, log: install.log.slice(-60) },
    engine: { running: !!engine, device: engine?.info.device ?? null, gpu: engine?.info.gpu ?? null, backend: engine?.info.backend ?? null }
  };
}

class Engine {
  constructor(proc) {
    this.proc = proc;
    let onReady;
    let onFail;
    this.ready = new Promise((res, rej) => (onReady = res, onFail = rej));
    const startTimer = setTimeout(() => (onFail(new Error("Engine giọng local khởi động quá 5 phút")), proc.kill()), 5 * 6e4);
    proc.stdout.on("data", (b) => {
      this.buf += b.toString("utf8");
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.ready) {
          clearTimeout(startTimer);
          this.info = { backend: String(msg.backend), device: String(msg.device), gpu: msg.gpu ?? null };
          onReady();
        } else if (msg.fatal) {
          clearTimeout(startTimer);
          onFail(new Error(String(msg.fatal)));
        } else if (typeof msg.id === "number") {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.ok) p?.resolve(msg);
          else p?.reject(new Error(`Giọng local lỗi: ${String(msg.error)}`));
          this.touch();
        }
      }
    });
    proc.stderr.on("data", (b) => {
      for (const l of b.toString("utf8").split(/\r?\n/)) {
        if (!l.trim()) continue;
        this.stderr.push(l);
        if (this.stderr.length > 30) this.stderr.shift();
        if (install.running) log(l);
      }
    });
    proc.on("close", (code) => {
      clearTimeout(startTimer);
      if (this.idle) clearTimeout(this.idle);
      const err = new Error(`Engine giọng local đã dừng (mã ${code})${this.stderr.length ? `: ${this.stderr.slice(-3).join(" | ")}` : ""}`);
      onFail(err);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      if (engine === this) engine = null;
    });
    proc.on("error", (e) => onFail(e));
    proc.stdin.on("error", () => void 0);
  }
  info = { backend: "?", device: "?", gpu: null };
  nextId = 1;
  pending = new Map();
  stderr = [];
  buf = "";
  idle = null;
  ready;
  /** Hẹn tắt sau IDLE_MS không dùng (trả VRAM/RAM) */
  touch() {
    if (this.idle) clearTimeout(this.idle);
    if (!this.pending.size) this.idle = setTimeout(() => void this.stop(), IDLE_MS);
  }
  async request(payload, signal, timeoutMs = 5 * 6e4) {
    await this.ready;
    if (this.idle) clearTimeout(this.idle);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (e, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (e) reject(e);
        else resolve(v);
      };
      const timer = setTimeout(() => finish(new Error("Giọng local quá thời gian chờ")), timeoutMs);
      const onAbort = () => finish(new Error("Đã hủy"));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, { resolve: (v) => finish(null, v), reject: (e) => finish(e) });
      this.proc.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
    });
  }
  stop() {
    return new Promise((res) => {
      if (this.proc.exitCode != null) return res();
      this.proc.once("close", () => res());
      this.proc.stdin.end();
      setTimeout(() => this.proc.exitCode == null && this.proc.kill(), 3e3);
    });
  }
}

let engine = null;
let starting = null;

function startEngine(offline = true) {
  if (engine) return engine.ready.then(() => engine);
  if (starting) return starting;
  starting = (async () => {
    const proc = spawn(venvPython(), [join(root(), "engine.py")], { cwd: root(), env: env(offline), windowsHide: true });
    const e = new Engine(proc);
    engine = e;
    try {
      await e.ready;
      return e;
    } catch (err) {
      if (engine === e) engine = null;
      proc.kill();
      throw err;
    }
  })().finally(() => starting = null);
  return starting;
}

export async function stopEngine() {
  const e = engine;
  engine = null;
  await e?.stop();
}

function requireInstalled() {
  const m = manifest();
  if (!m) throw new Error("Chưa cài engine giọng local (Cài đặt → Giọng đọc local)");
  return m;
}

export function presetVoices() {
  return requireInstalled().voices.map(([label, id]) => ({ id, label: label.replace(/^⭐\s*/, "★ ") }));
}

export async function synthesizeLocal(opts) {
  const m = requireInstalled();
  if (!engine) writeFileSync(join(root(), "engine.py"), ENGINE_SCRIPT, "utf8");
  const voice = opts.voice && m.voices.some(([, id]) => id === opts.voice) ? opts.voice : m.voices[0]?.[1] ?? null;
  const eng = await startEngine(true);
  const r = await eng.request({ op: "synth", text: opts.text, voice: opts.ref ? null : voice, ref: opts.ref, out: opts.out }, opts.signal);
  return r.seconds;
}
