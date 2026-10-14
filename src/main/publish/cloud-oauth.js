import { openAuthWindow } from "./auth-window";
import { shell } from "electron";
import { CloudError, cloud } from "../cloud/client";
import { cloudCustomerToken } from "../license/index";
import { PublishError } from "./http";

let cache = null;

const toPublishError = (e, what) => {
  if (e instanceof PublishError) return e;
  if (e instanceof CloudError)
    return new PublishError(e.offline ? "transient" : e.status === 401 ? "auth" : "permanent", `${what}: ${e.message}`);
  return new PublishError("transient", `${what}: ${e instanceof Error ? e.message : String(e)}`);
};

export async function cloudOAuthConfig(force = false) {
  if (!force && cache && Date.now() - cache.at < 5 * 6e4) return cache.cfg;
  const token = cloudCustomerToken();
  if (!token) return cache?.cfg ?? null;
  try {
    const cfg = await cloud("/api/client/v1/oauth/config", { token, timeoutMs: 1e4 });
    cache = { at: Date.now(), cfg };
    return cfg;
  } catch {
    return cache?.cfg ?? null;
  }
}

export async function cloudOAuthEnabled(p) {
  return !!(await cloudOAuthConfig())?.[p]?.enabled;
}

let cancelExternal = null;

export function cancelCloudLogin() {
  cancelExternal?.();
}

export async function cloudLogin(p, scopes, ui) {
  const token = cloudCustomerToken();
  if (!token) throw new PublishError("auth", "Phiên đăng nhập Omnira đã hết – đăng xuất rồi đăng nhập lại");
  let start;
  try {
    start = await cloud(`/api/client/v1/oauth/${p}/start`, { method: "POST", body: { scopes: scopes || null }, token });
  } catch (e) {
    throw toPublishError(e, `Không bắt đầu được đăng nhập ${ui.provider}`);
  }
  const appId = new URL(start.authUrl).searchParams;
  console.info(
    `[oauth] ${ui.provider}: bắt đầu đăng nhập qua Omnira Cloud · app ${appId.get("client_key") ?? appId.get("client_id") ?? "?"} · redirect ${start.redirectUri}`,
  );
  let polls = 20;
  if (ui.external) {
    if (process.env.OMNI_OAUTH_FETCH === "1") void fetch(start.authUrl).catch(() => void 0);
    else await shell.openExternal(start.authUrl);
    polls = 600;
  } else {
    const state = new URL(start.authUrl).searchParams.get("state") ?? "";
    const params = await openAuthWindow({
      url: start.authUrl,
      redirectUri: start.redirectUri,
      state,
      title: ui.title,
      provider: ui.provider,
      parent: ui.parent,
      blocked: ui.blocked,
      lostFlow: ui.lostFlow,
    });
    try {
      await fetch(`${start.redirectUri}?${params.toString()}`, { signal: AbortSignal.timeout(45e3) });
    } catch (e) {
      throw toPublishError(e, `Không gửi được kết quả đăng nhập ${ui.provider} lên Omnira Cloud`);
    }
  }
  let cancelled = false;
  cancelExternal = () => (cancelled = true);
  try {
    return await pollSession(start.sessionId, token, ui.provider, polls, () => cancelled);
  } finally {
    cancelExternal = null;
  }
}

async function pollSession(sessionId, token, provider, polls, cancelled) {
  for (let i = 0; i < polls; i++) {
    if (cancelled()) throw new PublishError("permanent", `Đã hủy kết nối ${provider}`);
    let r;
    try {
      r = await cloud(`/api/client/v1/oauth/sessions/${sessionId}`, { token });
    } catch (e) {
      throw toPublishError(e, `Không nhận được token ${provider}`);
    }
    if (r.status === "DONE" && r.token) {
      console.info(`[oauth] ${provider}: Omnira Cloud đã đổi mã lấy token`);
      return r.token;
    }
    if (r.status === "ERROR") {
      const msg = r.error ?? "đăng nhập không thành công";
      console.warn(`[oauth] ${provider}: Omnira Cloud báo lỗi – ${msg}`);
      throw new PublishError(
        "permanent",
        /hủy|denied|từ chối/i.test(msg) ? "Bạn đã hủy / từ chối cấp quyền" : `${provider}: ${msg}`,
      );
    }
    if (r.status === "EXPIRED" || r.status === "CONSUMED")
      throw new PublishError("permanent", `Phiên đăng nhập ${provider} đã hết hạn – thử lại`);
    await new Promise((res) => setTimeout(res, polls > 100 ? 1500 : 800));
  }
  throw new PublishError("transient", `Chưa nhận được kết quả đăng nhập ${provider} – thử lại`);
}

export async function cloudRefresh(p, tokenValue) {
  const token = cloudCustomerToken();
  if (!token) throw new PublishError("auth", "Phiên đăng nhập Omnira đã hết – đăng nhập lại để làm mới token kênh");
  try {
    return await cloud(`/api/client/v1/oauth/${p}/refresh`, { method: "POST", body: { token: tokenValue }, token });
  } catch (e) {
    if (e instanceof CloudError && e.code === "OAUTH_ERROR")
      throw new PublishError("auth", `Làm mới token thất bại – kết nối lại kênh (${e.message})`);
    throw toPublishError(e, "Làm mới token qua Omnira Cloud thất bại");
  }
}
