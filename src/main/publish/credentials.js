import { and, eq } from "drizzle-orm";
import { channels, secrets } from "../db/schema";
import { getDb } from "../db/index";
import { maskSecret, putSecret, readSecret, deleteSecret } from "../vault";
import { cloudRefresh } from "./cloud-oauth";
import { PublishError, graph, tiktok, tiktokOAuth } from "./http";

export function readCred(channelId) {
  const raw = readSecret("channel", channelId, "access_token");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.token === "string") return v;
  } catch {
  }
  return { token: raw };
}

export function writeCred(channelId, cred) {
  putSecret({ kind: "access_token", ownerType: "channel", ownerId: channelId, value: JSON.stringify(cred), expiresAt: cred.expiresAt ? new Date(cred.expiresAt) : null });
  getDb().update(secrets).set({ preview: maskSecret(cred.token) }).where(and(eq(secrets.ownerType, "channel"), eq(secrets.ownerId, channelId), eq(secrets.kind, "access_token"))).run();
}

export function clearCred(channelId) {
  deleteSecret("channel", channelId, "access_token");
}

const DAY = 864e5;

export function statusFor(expiresAt) {
  if (!expiresAt) return "valid";
  const left = expiresAt - Date.now();
  return left <= 0 ? "expired" : left < 3 * DAY ? "expiring" : "valid";
}

export function markChannel(channelId, patch) {
  const row = getDb().update(channels).set({ ...patch, updatedAt: new Date() }).where(eq(channels.id, channelId)).returning().get();
  if (!row) throw new PublishError("permanent", "Kênh không tồn tại");
  return row;
}

const PAGE_FIELDS = "id,name,access_token,fan_count,picture{url},instagram_business_account{id,username,followers_count,profile_picture_url}";
const BASIC_PAGE_FIELDS = "id,name,access_token,fan_count,picture{url}";

async function withIgFallback(call, onIgError) {
  try {
    return await call(true);
  } catch (err) {
    if (!(err instanceof PublishError) || !/instagram/i.test(err.message)) throw err;
    onIgError?.(err.message);
    return call(false);
  }
}

export async function inspectFbToken(token, signal) {
  try {
    const page = await withIgFallback(
      (ig) => graph("GET", "me", { token, signal, query: { fields: `id,name,category,fan_count,picture{url}${ig ? ",instagram_business_account{id,username,followers_count,profile_picture_url}" : ""}` } })
    );
    return { type: "page", page: { ...page, access_token: token } };
  } catch (err) {
    if (!(err instanceof PublishError) || err.kind !== "permanent") throw err;
  }
  const me = await graph("GET", "me", { token, signal, query: { fields: "id,name" } });
  const pages = [];
  let igError = null;
  let after;
  for (let i = 0; i < 10; i++) {
    const res = await withIgFallback(
      (ig) => graph("GET", "me/accounts", { token, signal, query: { fields: ig ? PAGE_FIELDS : BASIC_PAGE_FIELDS, limit: 100, after } }),
      (m) => igError ??= m
    );
    pages.push(...res.data);
    after = res.paging?.next ? res.paging.cursors?.after : void 0;
    if (!after) break;
  }
  return { type: "user", userName: me.name, pages, igError };
}

export async function exchangeLongLived(userToken, appId, appSecret, signal) {
  const res = await graph("GET", "oauth/access_token", {
    token: userToken,
    signal,
    query: { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: userToken }
  });
  return { token: res.access_token, expiresAt: res.expires_in ? Date.now() + res.expires_in * 1e3 : null };
}

export async function tokenExpiry(token, signal) {
  try {
    const r = await graph("GET", "debug_token", { token, signal, query: { input_token: token } });
    if (r.data?.is_valid === false) throw new PublishError("auth", "Token không còn hiệu lực");
    return r.data?.expires_at ? r.data.expires_at * 1e3 : null;
  } catch (err) {
    if (err instanceof PublishError && err.kind === "auth" && err.message === "Token không còn hiệu lực") throw err;
    return null;
  }
}

export async function tiktokUser(token, signal) {
  const r = await tiktok("/v2/user/info/", { token, signal, method: "GET", query: { fields: "open_id,display_name,avatar_url" } });
  if (!r.user?.open_id) throw new PublishError("auth", "TikTok không trả thông tin người dùng – kiểm tra quyền user.info.basic");
  return r.user;
}

export async function freshTikTokCred(channelId, cred, signal) {
  if (!cred.expiresAt || cred.expiresAt - Date.now() > 10 * 6e4) return cred;
  if (cred.viaCloud && cred.refreshToken) {
    const r2 = await cloudRefresh("tiktok", cred.refreshToken);
    const next2 = { ...cred, token: r2.access_token, refreshToken: r2.refresh_token ?? cred.refreshToken, expiresAt: Date.now() + r2.expires_in * 1e3 };
    writeCred(channelId, next2);
    markChannel(channelId, { tokenStatus: "valid", tokenExpiresAt: new Date(next2.expiresAt) });
    console.info(`[publish] đã làm mới token TikTok (qua NT Cloud) cho kênh ${channelId.slice(0, 8)}`);
    return next2;
  }
  const clientSecret = cred.clientSecret ?? readSecret("integration", "tiktok", "api_key");
  if (!cred.refreshToken || !cred.clientKey || !clientSecret) {
    if (cred.expiresAt <= Date.now()) throw new PublishError("auth", "Access token TikTok đã hết hạn – dán token mới hoặc thêm refresh token + client key/secret để tự làm mới");
    return cred;
  }
  const r = await tiktokOAuth(
    { client_key: cred.clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: cred.refreshToken },
    signal
  );
  const next = { ...cred, token: r.access_token, refreshToken: r.refresh_token ?? cred.refreshToken, expiresAt: Date.now() + r.expires_in * 1e3 };
  writeCred(channelId, next);
  markChannel(channelId, { tokenStatus: "valid", tokenExpiresAt: new Date(next.expiresAt) });
  console.info(`[publish] đã làm mới token TikTok cho kênh ${channelId.slice(0, 8)}`);
  return next;
}
