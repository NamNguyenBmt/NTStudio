import { app } from "electron";
import os from "node:os";
import { createPublicKey, verify } from "node:crypto";
import { sql, inArray } from "drizzle-orm";
import { channels } from "../db/schema";
import { getDb } from "../db/index";
import { CloudError, cloud, deviceId, readCloudSession, patchCloudSession } from "../cloud/client";
import { bindCloudSession, syncAppConfig } from "../cloud/app-config";
import { FEATURE_LABEL, normalizeFeatures } from "../../shared/features";

const LICENSE_KEY_ID = "p5JDXbsSf9Pqaw_JsbE5bUWGRH_rhENAbYP4Zzp4jQE";

const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA11kPKElIkEc2daYQkvuc
1HyOCpxrWySW6GoHy6/na6Re+Mlb2NxUuSQfY+QjNZNwhLWsZysKpigqTcFmGGlL
17gSiudRmKOs2YDnYphL+atcVjVkquSeS6rhGyRXMsAnWPulsYogOnIC5Nk4eAP6
VEDpDn6aIYgpH9vGm9GRbfp0VjjC9EI4JJ1Qcs6Exce/Wz9Tl3HMq6Yfvwz1pYhs
reaVWWM2lxy29REPy+4M5Ayh7+v7UOsHRO1iTRuVbvCE0BNa8jc5WxscXrtZek4e
CROlvxl+8TnaGHdITwnW1g5nacIe9mVFVGNxYsKedxVGOsxugThPi8AfphBF4U3K
7wIDAQAB
-----END PUBLIC KEY-----`;

const HEARTBEAT_MS = 6 * 36e5;
let publicKey = null;
const key = () => publicKey ??= createPublicKey(process.env.OMNI_LICENSE_PUBLIC_KEY ?? LICENSE_PUBLIC_KEY);
const b64 = (s) => Buffer.from(s, "base64url");

export function verifyLicenseToken(token, now = Date.now()) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64(parts[0]).toString());
    if (header.alg !== "RS256") return null;
    if (header.kid && header.kid !== LICENSE_KEY_ID && !process.env.OMNI_LICENSE_PUBLIC_KEY) return null;
    if (!verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key(), b64(parts[2]))) return null;
    const c = JSON.parse(b64(parts[1]).toString());
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (c.typ !== "license" || !aud.includes("omnira-studio") || c.did !== deviceId()) return null;
    if (!c.exp || c.exp * 1e3 <= now) return null;
    return c;
  } catch {
    return null;
  }
}

let state = null;
let timer = null;
let inflight = null;
let queue = Promise.resolve();

const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => void 0);
  return run;
};

const listeners = new Set();
const stateListeners = new Set();
const usableStatus = (s) => s === "active" || s === "offline";

export function onLicenseState(fn) {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

export function onLicenseChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(patch) {
  if (!state) return;
  const before = usableStatus(state.status);
  state = { ...state, ...patch };
  const after = usableStatus(state.status);
  if (before !== after) listeners.forEach((l) => l(after));
  stateListeners.forEach((l) => l());
}

bindCloudSession(() => ({ userId: state?.localUserId ?? null, token: state ? readCloudSession(state.localUserId)?.customerToken ?? null : null }));

export function cloudCustomerToken() {
  return state ? readCloudSession(state.localUserId)?.customerToken ?? null : null;
}

export function licenseUsable() {
  return !!state && usableStatus(state.status);
}

export function hasFeature(code) {
  return normalizeFeatures(state?.claims?.features).includes(code);
}

export const featureLockedMessage = (code) => `${FEATURE_LABEL[code]} không có trong gói ${state?.claims?.planName ?? "hiện tại"} – nâng cấp gói để mở khóa`;

export function licenseLimits() {
  const c = state?.claims;
  return { maxChannels: c?.maxChannels ?? null, flowThreads: c?.flowThreads ?? null, maxDevices: c?.maxDevices ?? null };
}

export function licenseView() {
  const c = state?.claims ?? null;
  return {
    status: state?.status ?? "checking",
    usable: licenseUsable(),
    message: state?.message ?? null,
    needRelogin: state?.needRelogin ?? false,
    plan: c?.plan ?? null,
    planName: c?.planName ?? null,
    trial: c?.trial ?? false,
    entitlementEndsAt: c?.entitlementEndsAt ? new Date(c.entitlementEndsAt * 1e3) : null,
    tokenExpiresAt: c ? new Date(c.exp * 1e3) : null,
    maxDevices: c?.maxDevices ?? null,
    maxChannels: c?.maxChannels ?? null,
    flowThreads: c?.flowThreads ?? null,
    features: normalizeFeatures(c?.features),
    deviceId: deviceId(),
    lastCheckedAt: state?.lastCheckedAt ? new Date(state.lastCheckedAt) : null,
    lastOnlineAt: state?.lastOnlineAt ? new Date(state.lastOnlineAt) : null
  };
}

function activeChannelCount() {
  try {
    return Number(getDb().select({ n: sql`count(*)` }).from(channels).where(inArray(channels.status, ["active", "error"])).get()?.n ?? 0);
  } catch {
    return void 0;
  }
}

const deviceBody = () => ({
  deviceId: deviceId(),
  name: os.hostname().slice(0, 120),
  os: `${os.type()} ${os.release()}`.slice(0, 80),
  appVersion: app.getVersion(),
  activeChannels: activeChannelCount()
});

function applyError(e) {
  const now = Date.now();
  const err = e instanceof CloudError ? e : new CloudError("OFFLINE", e instanceof Error ? e.message : String(e), 0);
  if (err.offline) {
    const claims = verifyLicenseToken(readCloudSession(state.localUserId)?.licenseToken);
    set(
      claims ? { claims, status: "offline", message: "Đang dùng ngoại tuyến – app sẽ tự kiểm tra lại license khi có mạng", lastCheckedAt: now } : { claims: null, status: "expired", message: "Cần kết nối mạng để kiểm tra license (đã quá thời gian dùng ngoại tuyến)", lastCheckedAt: now }
    );
    return;
  }
  const map = {
    NO_SUBSCRIPTION: "no_subscription",
    DEVICE_LIMIT: "device_limit",
    DEVICE_REVOKED: "revoked",
    ACCOUNT_LOCKED: "locked"
  };
  if (err.status === 401 || err.code === "UNAUTHORIZED") {
    const claims = verifyLicenseToken(readCloudSession(state.localUserId)?.licenseToken);
    set({ claims, status: claims ? "active" : "relogin", needRelogin: true, message: "Phiên đăng nhập Omnira đã hết hạn – đăng xuất rồi đăng nhập lại", lastCheckedAt: now });
    return;
  }
  set({ claims: null, status: map[err.code] ?? "expired", message: err.message, lastCheckedAt: now, lastOnlineAt: now });
}

function accept(token) {
  const now = Date.now();
  const claims = verifyLicenseToken(token);
  if (!claims) {
    set({ claims: null, status: "expired", message: "Token license không hợp lệ (sai chữ ký / sai máy) – liên hệ hỗ trợ", lastCheckedAt: now, lastOnlineAt: now });
    return;
  }
  patchCloudSession(state.localUserId, { licenseToken: token });
  set({ claims, status: "active", message: null, needRelogin: false, lastCheckedAt: now, lastOnlineAt: now });
  void syncAppConfig();
}

export function activateLicense() {
  return serial(activateNow);
}

async function activateNow() {
  if (!state) throw new Error("Chưa đăng nhập");
  const token = readCloudSession(state.localUserId)?.customerToken;
  if (!token) {
    set({ status: "relogin", needRelogin: true, message: "Đăng nhập lại tài khoản Omnira" });
    return licenseView();
  }
  try {
    accept((await cloud("/api/client/v1/license/activate", { method: "POST", body: deviceBody(), token })).token);
  } catch (e) {
    applyError(e);
  }
  return licenseView();
}

export function refreshLicense() {
  inflight ??= serial(async () => {
    try {
      if (!state) return licenseView();
      const token = readCloudSession(state.localUserId)?.customerToken;
      if (!token) {
        applyError(new CloudError("UNAUTHORIZED", "Chưa đăng nhập Omnira", 401));
        return licenseView();
      }
      try {
        accept((await cloud("/api/client/v1/license/heartbeat", { method: "POST", body: deviceBody(), token })).token);
      } catch (e) {
        if (e instanceof CloudError && (e.code === "DEVICE_NOT_ACTIVATED" || e.code === "DEVICE_REVOKED")) {
          if (e.code === "DEVICE_REVOKED") applyError(e);
          else return await activateNow();
        } else applyError(e);
      }
      return licenseView();
    } finally {
      inflight = null;
    }
  });
  return inflight;
}

export function startLicense(localUserId) {
  stopLicense();
  const claims = verifyLicenseToken(readCloudSession(localUserId)?.licenseToken);
  state = {
    localUserId,
    claims,
    status: claims ? "active" : "checking",
    message: null,
    needRelogin: false,
    lastCheckedAt: null,
    lastOnlineAt: null
  };
  if (claims) listeners.forEach((l) => l(true));
  void refreshLicense();
  timer = setInterval(() => {
    if (state?.claims && state.claims.exp * 1e3 <= Date.now()) set({ claims: null, status: "expired", message: "License hết hạn dùng ngoại tuyến – cần kết nối mạng" });
    if (!state?.lastCheckedAt || Date.now() - state.lastCheckedAt >= HEARTBEAT_MS || !licenseUsable()) void refreshLicense();
  }, 10 * 6e4);
}

export function stopLicense() {
  if (timer) clearInterval(timer);
  timer = null;
  if (state && licenseUsable()) listeners.forEach((l) => l(false));
  state = null;
}

export async function deactivateLicense(customerToken) {
  if (!customerToken) return;
  try {
    await cloud("/api/client/v1/license/deactivate", { method: "POST", body: { deviceId: deviceId() }, token: customerToken, timeoutMs: 6e3 });
  } catch (e) {
    console.warn("[license] không trả được chỗ máy khi đăng xuất", e instanceof Error ? e.message : e);
  }
}
