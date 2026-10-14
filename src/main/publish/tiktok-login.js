import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { settings } from "../db/schema";
import { getDb } from "../db/index";
import { putSecret, readSecret } from "../vault";
import { PublishError, tiktok, tiktokOAuth } from "./http";
import { openAuthWindow } from "./auth-window";
import { cloudOAuthConfig, cloudOAuthEnabled, cloudLogin } from "./cloud-oauth";

export const DEFAULT_TIKTOK_REDIRECT = "http://localhost/omnipage/tiktok";
export const DEFAULT_TIKTOK_SCOPES = "user.info.basic,video.publish,user.info.stats";
const authorizeBase = () => process.env.OMNI_TIKTOK_AUTH_BASE ?? "https://www.tiktok.com";

const setting = (key) => {
  const v = getDb().select().from(settings).where(eq(settings.key, key)).get()?.value;
  return typeof v === "string" && v ? v : null;
};

const putSetting = (key, value) => {
  getDb().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } }).run();
};

export const tiktokClientKey = () => setting("tiktok.clientKey");
export const tiktokClientSecret = () => readSecret("integration", "tiktok", "api_key");
export const tiktokRedirectUri = () => setting("tiktok.redirectUri") ?? DEFAULT_TIKTOK_REDIRECT;
export const tiktokScopes = () => setting("tiktok.scopes") ?? DEFAULT_TIKTOK_SCOPES;

export async function saveTiktokApp(input) {
  const secret = input.clientSecret || tiktokClientSecret();
  if (!secret) throw new PublishError("permanent", "Nhập Client Secret");
  await tiktokOAuth({ client_key: input.clientKey, client_secret: secret, grant_type: "client_credentials" }, AbortSignal.timeout(2e4), "Client Key / Secret không hợp lệ");
  putSetting("tiktok.clientKey", input.clientKey);
  putSetting("tiktok.redirectUri", input.redirectUri ?? "");
  putSetting("tiktok.scopes", input.scopes ?? "");
  if (input.clientSecret) putSecret({ kind: "api_key", ownerType: "integration", ownerId: "tiktok", value: input.clientSecret });
}

function pkce() {
  const verifier = randomBytes(48).toString("base64url").slice(0, 64);
  return { verifier, challenge: createHash("sha256").update(verifier).digest("hex") };
}

const tiktokBlocked = (redirectUri) => (text) => /redirect_uri|redirect uri|Something went wrong|client_key/i.test(text) && /redirect|client_key|scope/i.test(text) ? `TikTok báo lỗi cấu hình ứng dụng: "${text.replace(/\s+/g, " ").trim().slice(0, 400)}". Kiểm tra Redirect URI "${redirectUri}" đã khai báo trong Login Kit và các scope (${tiktokScopes()}) đã được thêm vào app.` : null;
const tiktokLostFlow = (u) => /(^|\.)tiktok\.com$/.test(u.hostname) && /^\/(|foryou|explore|following|friends|live|@[^/]+)\/?$/.test(u.pathname);

export async function tiktokLogin(parent) {
  const clientKey = tiktokClientKey();
  const clientSecret = tiktokClientSecret();
  if (await cloudOAuthEnabled("tiktok")) {
    const cfg0 = await cloudOAuthConfig();
    const tok2 = await cloudLogin("tiktok", tiktokScopes(), {
      title: "Kết nối TikTok",
      provider: "TikTok",
      parent,
      blocked: tiktokBlocked(cfg0?.tiktok.redirectUri ?? "trang callback của Omnira Cloud"),
      lostFlow: tiktokLostFlow
    });
    if (!tok2.access_token) throw new PublishError("permanent", "Omnira Cloud không trả token TikTok");
    const cfg = await cloudOAuthConfig();
    return finishTiktok(
      { access_token: tok2.access_token, expires_in: tok2.expires_in ?? 86400, refresh_token: tok2.refresh_token ?? "", open_id: tok2.open_id ?? "", scope: tok2.scope },
      true,
      cfg?.tiktok.clientId ?? ""
    );
  }
  if (!clientKey || !clientSecret)
    throw new PublishError("permanent", "Chưa cấu hình Ứng dụng TikTok – vào Cài đặt → Ứng dụng TikTok để nhập Client Key và Client Secret (một lần), hoặc liên hệ Omnira để bật kết nối sẵn");
  const redirectUri = tiktokRedirectUri();
  const state = randomBytes(16).toString("hex");
  const { verifier, challenge } = pkce();
  const url = new URL(`${authorizeBase()}/v2/auth/authorize/`);
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("scope", tiktokScopes());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const params = await openAuthWindow({
    url: url.toString(),
    redirectUri,
    state,
    title: "Kết nối TikTok",
    provider: "TikTok",
    parent,
    blocked: tiktokBlocked(redirectUri),
    lostFlow: tiktokLostFlow
  });
  const error = params.get("error");
  if (error) {
    throw new PublishError("permanent", error === "access_denied" ? "Bạn đã từ chối cấp quyền cho ứng dụng" : `TikTok từ chối: ${params.get("error_description") ?? error}`);
  }
  const code = params.get("code");
  if (!code) throw new PublishError("permanent", "TikTok không trả mã đăng nhập");
  const signal = AbortSignal.timeout(45e3);
  const tok = await tiktokOAuth(
    { client_key: clientKey, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: verifier },
    signal,
    "Đổi mã đăng nhập TikTok thất bại"
  );
  return finishTiktok(tok, false, clientKey);
}

async function finishTiktok(tok, viaCloud, clientKey) {
  const signal = AbortSignal.timeout(45e3);
  const scopes = (tok.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const info = await tiktok("/v2/user/info/", {
    token: tok.access_token,
    signal,
    method: "GET",
    query: { fields: "open_id,display_name,avatar_url" }
  });
  let followers = null;
  if (scopes.includes("user.info.stats")) {
    try {
      followers = (await tiktok("/v2/user/info/", { token: tok.access_token, signal, method: "GET", query: { fields: "follower_count" } })).user?.follower_count ?? null;
    } catch {
    }
  }
  return {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1e3,
    openId: tok.open_id || info.user.open_id,
    displayName: info.user.display_name || "TikTok",
    avatarUrl: info.user.avatar_url ?? null,
    followers,
    scopes,
    viaCloud,
    clientKey
  };
}
