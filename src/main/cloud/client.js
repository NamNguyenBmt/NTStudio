import { safeStorage } from "electron";
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { authRoot } from "../paths";

// Chưa có server NT Cloud: để trống → app chạy chế độ không server (tài khoản lưu trên máy, không cần license).
// Khi có server (vd Vercel) thì đặt địa chỉ vào DEFAULT_CLOUD_URL hoặc biến môi trường NT_CLOUD_URL.
const DEFAULT_CLOUD_URL = "";
export const CLOUD_URL = (process.env.NT_CLOUD_URL ?? DEFAULT_CLOUD_URL).replace(/\/+$/, "");
export const CLOUD_ENABLED = CLOUD_URL !== "";

export class CloudError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
  get offline() {
    return this.code === "OFFLINE";
  }
}

export async function cloud(path, init = {}) {
  if (!CLOUD_ENABLED) throw new CloudError("NO_SERVER", "Bản này chạy không cần server – tính năng này cần NT Cloud (chưa có)", 0);
  let res;
  try {
    res = await fetch(CLOUD_URL + path, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...init.body !== void 0 ? { "Content-Type": "application/json" } : {},
        ...init.token ? { Authorization: `Bearer ${init.token}` } : {}
      },
      body: init.body === void 0 ? void 0 : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 2e4)
    });
  } catch (err) {
    throw new CloudError("OFFLINE", `Không kết nối được NT Cloud (${err instanceof Error ? err.message : String(err)}) – kiểm tra mạng`, 0);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
  }
  if (!res.ok) {
    const e = data ?? {};
    if (res.status >= 500 && !e.code) throw new CloudError("OFFLINE", `NT Cloud đang lỗi (HTTP ${res.status}) – thử lại sau`, res.status);
    throw new CloudError(e.code ?? `HTTP_${res.status}`, e.message ?? `NT Cloud báo lỗi HTTP ${res.status}`, res.status);
  }
  return data;
}

const deviceFile = () => join(authRoot(), "device.json");
const sessionFile = (localUserId) => join(authRoot(), `cloud-${localUserId}.bin`);

export function deviceId() {
  try {
    const d = JSON.parse(readFileSync(deviceFile(), "utf8"));
    if (d.id && /^[A-Za-z0-9_-]{16,128}$/.test(d.id)) return d.id;
  } catch {
  }
  const id = `omn-${randomBytes(20).toString("hex")}`;
  mkdirSync(authRoot(), { recursive: true });
  writeFileSync(deviceFile(), JSON.stringify({ id, createdAt: Date.now() }), { mode: 384 });
  return id;
}

export function readCloudSession(localUserId) {
  const f = sessionFile(localUserId);
  if (!existsSync(f) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(f)));
  } catch {
    return null;
  }
}

export function writeCloudSession(localUserId, s) {
  if (!safeStorage.isEncryptionAvailable()) return;
  mkdirSync(authRoot(), { recursive: true });
  const f = sessionFile(localUserId);
  writeFileSync(f + ".tmp", safeStorage.encryptString(JSON.stringify({ ...s, updatedAt: Date.now() })), { mode: 384 });
  renameSync(f + ".tmp", f);
}

export function patchCloudSession(localUserId, patch) {
  const cur = readCloudSession(localUserId);
  if (cur) writeCloudSession(localUserId, { ...cur, ...patch });
}

export function clearCloudSession(localUserId) {
  rmSync(sessionFile(localUserId), { force: true });
}
