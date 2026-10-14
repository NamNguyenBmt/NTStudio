import { app } from "electron";
import { existsSync, statSync, rmSync, renameSync, writeFileSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { format } from "node:util";

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;
let file = null;

export function logDir() {
  return join(app.getPath("userData"), "logs");
}

export function logFile() {
  return join(logDir(), "main.log");
}

function rotate() {
  if (!file || !existsSync(file) || statSync(file).size < MAX_BYTES) return;
  rmSync(`${file}.${KEEP}`, { force: true });
  for (let i = KEEP - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
  renameSync(file, `${file}.1`);
  ensureBom();
}

function ensureBom() {
  if (!file) return;
  if (!existsSync(file)) return writeFileSync(file, "\uFEFF", "utf8");
  try {
    const buf = readFileSync(file);
    if (!(buf[0] === 239 && buf[1] === 187 && buf[2] === 191)) writeFileSync(file, Buffer.concat([Buffer.from([239, 187, 191]), buf]));
  } catch {
  }
}

let writes = 0;

function write(level, args) {
  if (!file) return;
  try {
    if (++writes % 200 === 0) rotate();
    appendFileSync(file, `${(new Date()).toISOString()} [${level}] ${format(...args)}
`, "utf8");
  } catch {
  }
}

export function initLogger() {
  mkdirSync(logDir(), { recursive: true });
  file = logFile();
  rotate();
  ensureBom();
  if (process.platform === "win32" && !app.isPackaged) {
    try {
      spawnSync("chcp", ["65001"], { shell: true, stdio: "ignore", windowsHide: true });
    } catch {
    }
  }
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      write(level === "log" ? "info" : level, args);
    };
  }
  process.on("uncaughtException", (err) => console.error("[main] uncaughtException", err));
  process.on("unhandledRejection", (reason) => console.error("[main] unhandledRejection", reason));
  console.info(`[app] khởi động ${app.getName()} ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform}`);
}

export function attachRendererLogging(wc) {
  wc.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2) write(level === 2 ? "warn" : "error", [`[renderer] ${message} (${sourceId.split("/").pop()}:${line})`]);
  });
  wc.on("render-process-gone", (_e, d) => write("error", [`[renderer] tiến trình giao diện dừng: ${d.reason} (mã ${d.exitCode})`]));
}
