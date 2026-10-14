import { app, shell } from "electron";
import { ApiError } from "../errors";
import { CloudError, cloud, deviceId, readCloudSession } from "../cloud/client";
import { licenseView, activateLicense, refreshLicense } from "../license/index";
import { quotaState, setQuotaSelection } from "../quota";
import { activeUser } from "../auth/session";

const token = () => {
  const u = activeUser();
  const t = u ? readCloudSession(u.id)?.customerToken : null;
  if (!t) throw new ApiError("AUTH", "Phiên đăng nhập Omnira đã hết – đăng xuất rồi đăng nhập lại");
  return t;
};

const fail = (e) => {
  if (e instanceof ApiError) return e;
  if (e instanceof CloudError) return new ApiError(e.status === 401 ? "AUTH" : e.status === 404 ? "NOT_FOUND" : e.offline ? "INTERNAL" : "VALIDATION", e.message);
  return new ApiError("INTERNAL", e instanceof Error ? e.message : String(e));
};

async function devices() {
  const me = await cloud("/api/client/v1/me", { token: token() });
  const mine = deviceId();
  return me.devices.filter((d) => !d.revokedAt).map((d) => ({ ...d, current: d.deviceId === mine })).sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt));
}

function compareVersion(a, b) {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

let appInfoCache = null;

export const cloudHandlers = {
  "license.state": () => licenseView(),
  "channels.quota": () => quotaState(),
  "channels.setQuota": ({ activeIds }) => setQuotaSelection(activeIds),
  "license.refresh": () => refreshLicense(),
  "license.activate": () => activateLicense(),
  "license.devices": async () => {
    try {
      return await devices();
    } catch (e) {
      throw fail(e);
    }
  },
  "license.removeDevice": async ({ id }) => {
    try {
      await cloud(`/api/client/v1/devices/${encodeURIComponent(id)}`, { method: "DELETE", token: token() });
      if (!licenseView().usable) await activateLicense();
      return await devices();
    } catch (e) {
      throw fail(e);
    }
  },
  "billing.plans": async () => {
    try {
      return await cloud("/api/public/plans");
    } catch (e) {
      throw fail(e);
    }
  },
  "billing.createOrder": async ({ planCode, gateway }) => {
    try {
      return await cloud("/api/client/v1/orders", { method: "POST", body: { planCode, gateway: gateway ?? null }, token: token() });
    } catch (e) {
      throw fail(e);
    }
  },
  "billing.order": async ({ code }) => {
    try {
      const o = await cloud(`/api/client/v1/orders/${encodeURIComponent(code)}`, { token: token() });
      if (o.status === "PAID") await refreshLicense();
      return o;
    } catch (e) {
      throw fail(e);
    }
  },
  "billing.orders": async () => {
    try {
      return await cloud("/api/client/v1/orders", { token: token() });
    } catch (e) {
      throw fail(e);
    }
  },
  "cloud.notifications": async () => {
    const u = activeUser();
    const t = u ? readCloudSession(u.id)?.customerToken : null;
    if (!t) return { items: [], unread: 0, offline: false };
    try {
      const r = await cloud("/api/client/v1/notifications", { token: t, timeoutMs: 1e4 });
      return { items: r.items ?? [], unread: r.unread ?? 0, offline: false };
    } catch (e) {
      if (e instanceof CloudError && (e.offline || e.status === 404)) return { items: [], unread: 0, offline: true };
      throw fail(e);
    }
  },
  "cloud.notificationsSeen": async () => {
    try {
      await cloud("/api/client/v1/notifications/seen", { method: "POST", token: token(), timeoutMs: 1e4 });
    } catch (e) {
      throw fail(e);
    }
  },
  "cloud.appInfo": async () => {
    if (appInfoCache && Date.now() - appInfoCache.at < 10 * 6e4) return appInfoCache.info;
    const current = app.getVersion();
    let r = {};
    try {
      r = await cloud("/api/public/app", { timeoutMs: 8e3 });
    } catch {
    }
    const level = r.announcementLevel === "warn" || r.announcementLevel === "critical" || r.announcementLevel === "info" ? r.announcementLevel : r.announcement ? "info" : null;
    const info = {
      currentVersion: current,
      latestVersion: r.latestVersion ?? null,
      minVersion: r.minVersion ?? null,
      downloadUrl: r.downloadUrl ?? null,
      releaseNotes: r.releaseNotes ?? null,
      announcement: r.announcement ?? null,
      announcementLevel: level,
      updateAvailable: !!r.latestVersion && compareVersion(current, r.latestVersion) < 0,
      updateRequired: !!r.minVersion && compareVersion(current, r.minVersion) < 0
    };
    appInfoCache = { at: Date.now(), info };
    return info;
  },
  "system.openExternal": async ({ url }) => {
    if (!/^https?:\/\//i.test(url)) throw new ApiError("VALIDATION", "Chỉ mở được link http(s)");
    await shell.openExternal(url);
  }
};
