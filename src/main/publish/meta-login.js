import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { settings } from "../db/schema";
import { getDb } from "../db/index";
import { putSecret, readSecret } from "../vault";
import { GRAPH_VERSION, PublishError, graph } from "./http";
import { openAuthWindow } from "./auth-window";
import { cloudOAuthEnabled, cloudLogin } from "./cloud-oauth";

export const DEFAULT_REDIRECT_URI = "http://localhost/omnipage/oauth";

export function metaRedirectUri() {
  const v = getDb().select().from(settings).where(eq(settings.key, "meta.redirectUri")).get()?.value;
  return typeof v === "string" && /^https?:\/\//.test(v) ? v : DEFAULT_REDIRECT_URI;
}

const dialogBase = () => process.env.OMNI_FB_DIALOG_BASE ?? "https://www.facebook.com";
const PAGE_SCOPES = ["public_profile", "pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement", "pages_messaging", "pages_read_user_content", "read_insights", "business_management"];
const IG_SCOPES = ["instagram_basic", "instagram_content_publish", "instagram_manage_messages", "instagram_manage_comments", "instagram_manage_insights"];

export function metaInstagram() {
  return getDb().select().from(settings).where(eq(settings.key, "meta.instagram")).get()?.value !== false;
}

export function setMetaInstagram(enabled) {
  getDb().insert(settings).values({ key: "meta.instagram", value: enabled }).onConflictDoUpdate({ target: settings.key, set: { value: enabled, updatedAt: new Date() } }).run();
}

export function fbScopes() {
  return metaInstagram() ? [...PAGE_SCOPES, ...IG_SCOPES] : PAGE_SCOPES;
}

export function metaAppId() {
  const v = getDb().select().from(settings).where(eq(settings.key, "meta.appId")).get()?.value;
  return typeof v === "string" && v ? v : null;
}

export function metaConfigId() {
  const v = getDb().select().from(settings).where(eq(settings.key, "meta.configId")).get()?.value;
  return typeof v === "string" && v ? v : null;
}

export function metaAppSecret() {
  return readSecret("integration", "meta", "api_key");
}

export async function saveMetaApp(appId, appSecret, configId, redirectUri, instagram) {
  const secret = appSecret || metaAppSecret();
  if (!secret) throw new PublishError("permanent", "Nhập App Secret");
  const signal = AbortSignal.timeout(2e4);
  const tok = await graph("GET", "oauth/access_token", {
    token: "",
    signal,
    query: { client_id: appId, client_secret: secret, grant_type: "client_credentials" }
  });
  let name = null;
  try {
    name = (await graph("GET", appId, { token: tok.access_token, signal, query: { fields: "name" } })).name ?? null;
  } catch {
  }
  getDb().insert(settings).values({ key: "meta.appId", value: appId }).onConflictDoUpdate({ target: settings.key, set: { value: appId, updatedAt: new Date() } }).run();
  getDb().insert(settings).values({ key: "meta.redirectUri", value: redirectUri ?? "" }).onConflictDoUpdate({ target: settings.key, set: { value: redirectUri ?? "", updatedAt: new Date() } }).run();
  getDb().insert(settings).values({ key: "meta.configId", value: configId ?? "" }).onConflictDoUpdate({ target: settings.key, set: { value: configId ?? "", updatedAt: new Date() } }).run();
  getDb().insert(settings).values({ key: "meta.instagram", value: instagram }).onConflictDoUpdate({ target: settings.key, set: { value: instagram, updatedAt: new Date() } }).run();
  if (appSecret) putSecret({ kind: "api_key", ownerType: "integration", ownerId: "meta", value: appSecret });
  return { name };
}

async function askForCode(appId, configId, parent) {
  const state = randomBytes(16).toString("hex");
  const redirectUri = metaRedirectUri();
  const url = new URL(`${dialogBase()}/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (configId) {
    url.searchParams.set("config_id", configId);
    url.searchParams.set("override_default_response_type", "true");
  } else {
    url.searchParams.set("scope", fbScopes().join(","));
    url.searchParams.set("auth_type", "rerequest");
  }
  const params = await openAuthWindow({
    url: url.toString(),
    redirectUri,
    state,
    title: "Kết nối Facebook",
    provider: "Facebook",
    parent,
    // Facebook hiện trang "URL bị chặn" (URI chuyển hướng chưa hợp lệ) → báo rõ cách sửa
    blocked: (text) => /URL Blocked|URL bị chặn|redirect_uri|URI chuyển hướng|not whitelisted|Valid OAuth Redirect/i.test(text) ? `Facebook chặn URI chuyển hướng "${redirectUri}". Trong Meta App → Facebook Login → Cài đặt: bật Client OAuth login + Web OAuth login, thêm URI này vào "Valid OAuth Redirect URIs" (app ở chế độ Development thì localhost được chấp nhận sẵn).` : null
  });
  const error = params.get("error_reason") ?? params.get("error");
  if (error) throw new PublishError("permanent", error === "user_denied" ? "Bạn đã từ chối cấp quyền cho ứng dụng" : `Facebook từ chối: ${params.get("error_description") ?? error}`);
  const code = params.get("code");
  if (!code) throw new PublishError("permanent", "Facebook không trả mã đăng nhập");
  return code;
}

async function exchangeCode(appId, appSecret, code, redirectUri, signal) {
  const short = await graph("GET", "oauth/access_token", {
    token: "",
    signal,
    query: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }
  });
  const long = await graph("GET", "oauth/access_token", {
    token: "",
    signal,
    query: { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: short.access_token }
  });
  return long.access_token;
}

const PERMISSION_GROUPS = [
  { feature: "Đăng bài lên Fanpage", useCase: "Quản lý mọi thứ trên Trang (Manage everything on your Page)", perms: ["pages_manage_posts", "pages_read_engagement"] },
  { feature: "Trả lời / ẩn bình luận Fanpage", useCase: "Quản lý mọi thứ trên Trang (Manage everything on your Page)", perms: ["pages_manage_engagement", "pages_read_user_content"] },
  { feature: "Tin nhắn Messenger", useCase: "Tương tác với khách hàng trên Messenger (Engage with customers on Messenger from Meta)", perms: ["pages_messaging"] },
  { feature: "Số liệu Fanpage", useCase: "Quản lý mọi thứ trên Trang (Manage everything on your Page)", perms: ["read_insights"] },
  {
    feature: "Instagram (đăng Reels, tin nhắn, bình luận, số liệu)",
    useCase: "Quản lý tin nhắn & nội dung trên Instagram (Manage messaging & content on Instagram)",
    perms: ["instagram_basic", "instagram_content_publish", "instagram_manage_messages", "instagram_manage_comments", "instagram_manage_insights"]
  }
];

async function grantedPermissions(token, signal) {
  const r = await graph("GET", "me/permissions", { token, signal });
  return new Set((r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission));
}

export function missingFeatures(granted) {
  const wanted = new Set(fbScopes());
  return PERMISSION_GROUPS.filter((g) => g.perms.some((p) => wanted.has(p))).map((g) => ({ ...g, perms: g.perms.filter((p) => !granted.has(p)) })).filter((g) => g.perms.length);
}

export async function metaViaCloud() {
  return cloudOAuthEnabled("facebook");
}

export async function facebookLogin(parent) {
  const appId = metaAppId();
  const appSecret = metaAppSecret();
  const signal = AbortSignal.timeout(6e4);
  let token;
  if (await metaViaCloud()) {
    const tok = await cloudLogin("facebook", fbScopes().join(","), { title: "Kết nối Facebook", provider: "Facebook", parent });
    token = String(tok.access_token ?? "");
    if (!token) throw new PublishError("permanent", "Omnira Cloud không trả token Facebook");
  } else {
    if (!appId || !appSecret)
      throw new PublishError("permanent", "Chưa cấu hình Ứng dụng Meta – vào Cài đặt → Ứng dụng Meta để nhập App ID và App Secret (một lần), hoặc liên hệ Omnira để bật kết nối sẵn");
    const code = await askForCode(appId, metaConfigId(), parent);
    token = await exchangeCode(appId, appSecret, code, metaRedirectUri(), signal);
  }
  const me = await graph("GET", "me", { token, signal, query: { fields: "id,name" } });
  let granted = new Set(fbScopes());
  try {
    granted = await grantedPermissions(token, signal);
  } catch {
  }
  return { token, userId: me.id, name: me.name, granted };
}
