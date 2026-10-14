import { statSync, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { open, readFile } from "node:fs/promises";
import { settings } from "../db/schema";
import { getDb } from "../db/index";
import { putSecret, readSecret } from "../vault";
import { mediaDir } from "../media/paths";
import { writeCred, markChannel } from "./credentials";
import { PublishError, sleep } from "./http";
import { cloudOAuthConfig, cloudOAuthEnabled, cloudLogin, cloudRefresh } from "./cloud-oauth";
import { mediaFiles, composeCaption } from "./platforms";
import { loopbackAuth } from "./loopback";

const authBase = () => process.env.OMNI_YT_AUTH_BASE ?? "https://accounts.google.com";
const tokenBase = () => process.env.OMNI_YT_TOKEN_BASE ?? "https://oauth2.googleapis.com";
const apiBase = () => process.env.OMNI_YT_API_BASE ?? "https://www.googleapis.com";

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  // Đọc / trả lời / ẩn bình luận (Hộp thư)
  "https://www.googleapis.com/auth/youtube.force-ssl",
  // Số liệu theo ngày (Phân tích)
  "https://www.googleapis.com/auth/yt-analytics.readonly"
];

const setting = (key) => {
  const v = getDb().select().from(settings).where(eq(settings.key, key)).get()?.value;
  return typeof v === "string" && v ? v : null;
};

const putSetting = (key, value) => {
  getDb().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } }).run();
};

export const youtubeClientId = () => setting("youtube.clientId");
export const youtubeClientSecret = () => readSecret("integration", "youtube", "api_key");
const DEFAULT_PUBLISH = { privacy: "public", categoryId: "22", declareSynthetic: true, notifySubscribers: true };

export function youtubePublishSettings() {
  const v = getDb().select().from(settings).where(eq(settings.key, "youtube.publish")).get()?.value;
  return { ...DEFAULT_PUBLISH, ...v && typeof v === "object" ? v : {} };
}

export const saveYoutubePublishSettings = (patch) => {
  const next = { ...youtubePublishSettings(), ...patch };
  putSetting("youtube.publish", next);
  return next;
};

async function tokenRequest(params, signal) {
  let res;
  try {
    res = await fetch(`${tokenBase()}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal });
  } catch (err) {
    throw new PublishError("transient", `Không kết nối được máy chủ Google: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.access_token) return body;
  const code = body.error ?? `HTTP ${res.status}`;
  if (code === "invalid_client" || code === "unauthorized_client")
    throw new PublishError("permanent", "Client ID / Client Secret không đúng – kiểm tra OAuth Client (loại Desktop app) trong Google Cloud");
  if (code === "invalid_grant") throw new PublishError("auth", "Phiên đăng nhập YouTube đã hết hạn hoặc bị thu hồi – bấm Kết nối lại YouTube");
  if (res.status >= 500) throw new PublishError("transient", `Google lỗi tạm thời (${code})`);
  throw new PublishError("permanent", `Google từ chối: ${body.error_description ?? code}`);
}

export async function saveYoutubeApp(clientId, clientSecret) {
  const secret = clientSecret || youtubeClientSecret();
  if (!secret) throw new PublishError("permanent", "Nhập Client Secret");
  try {
    await tokenRequest({ client_id: clientId, client_secret: secret, grant_type: "refresh_token", refresh_token: "omnipage-kiem-tra" }, AbortSignal.timeout(2e4));
  } catch (err) {
    if (!(err instanceof PublishError) || err.kind !== "auth") throw err;
  }
  putSetting("youtube.clientId", clientId);
  if (clientSecret) putSecret({ kind: "api_key", ownerType: "integration", ownerId: "youtube", value: clientSecret });
}

function youtubeError(status, body) {
  const e = body?.error;
  const reason = e?.errors?.[0]?.reason ?? "";
  const msg = e?.message ?? `HTTP ${status}`;
  if (status === 401) return new PublishError("auth", `Token YouTube không hợp lệ – kết nối lại (${msg})`);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded")
    return new PublishError("rate_limit", "Hết hạn mức YouTube API trong ngày của dự án Google Cloud – thử lại sau 0 giờ (giờ Thái Bình Dương) hoặc xin tăng hạn mức");
  if (reason === "uploadLimitExceeded") return new PublishError("rate_limit", "Kênh đã đạt giới hạn số video tải lên trong ngày của YouTube – thử lại vào ngày mai");
  if (reason === "youtubeSignupRequired") return new PublishError("permanent", "Tài khoản Google này chưa có kênh YouTube – tạo kênh trên youtube.com rồi kết nối lại");
  if (reason === "forbidden" || reason === "insufficientPermissions") return new PublishError("auth", `Thiếu quyền YouTube – kết nối lại và đồng ý mọi quyền (${msg})`);
  if (status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") return new PublishError("rate_limit", msg);
  if (status >= 500) return new PublishError("transient", msg);
  return new PublishError("permanent", `YouTube từ chối: ${msg}${reason ? ` (${reason})` : ""}`);
}

async function yt(method, path, opts) {
  const url = new URL(`${apiBase()}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${opts.token}`, ...opts.json ? { "Content-Type": "application/json" } : {} },
      body: opts.json ? JSON.stringify(opts.json) : void 0,
      signal: opts.signal
    });
  } catch (err) {
    if (opts.signal.aborted) throw err;
    throw new PublishError("transient", `Không kết nối được YouTube: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw youtubeError(res.status, body);
  return body;
}

export async function youtubeMyChannel(token, signal) {
  const r = await yt("GET", "/youtube/v3/channels", { token, signal, query: { part: "snippet,statistics", mine: "true" } });
  const c = r.items?.[0];
  if (!c) throw new PublishError("permanent", "Tài khoản Google này chưa có kênh YouTube – tạo kênh trên youtube.com rồi kết nối lại");
  return {
    id: c.id,
    title: c.snippet.title,
    customUrl: c.snippet.customUrl ?? null,
    thumbnail: c.snippet.thumbnails?.default?.url ?? null,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? NaN) || null
  };
}

export async function youtubeLogin(parent = null) {
  const clientId = youtubeClientId();
  const clientSecret = youtubeClientSecret();
  if (await cloudOAuthEnabled("google")) {
    const tok2 = await cloudLogin("google", YOUTUBE_SCOPES.join(" "), { title: "Kết nối YouTube", provider: "Google", parent, external: true });
    if (!tok2.access_token) throw new PublishError("permanent", "Omnira Cloud không trả token Google");
    if (!tok2.refresh_token) throw new PublishError("permanent", "Google không trả refresh token – gỡ quyền của ứng dụng tại myaccount.google.com/permissions rồi kết nối lại");
    if (!(tok2.scope ?? "").split(" ").some((s) => s.endsWith("youtube.upload")))
      throw new PublishError("permanent", 'Chưa cấp quyền tải video lên YouTube – kết nối lại và tick đồng ý quyền "Quản lý video YouTube"');
    const channel2 = await youtubeMyChannel(tok2.access_token, AbortSignal.timeout(45e3));
    const cfg = await cloudOAuthConfig();
    return {
      accessToken: tok2.access_token,
      refreshToken: tok2.refresh_token,
      accessExpiresAt: Date.now() + (tok2.expires_in ?? 3600) * 1e3,
      channel: channel2,
      viaCloud: true,
      clientId: cfg?.google.clientId ?? ""
    };
  }
  if (!clientId || !clientSecret)
    throw new PublishError("permanent", "Chưa cấu hình Ứng dụng YouTube – vào Hướng dẫn kết nối → YouTube để nhập Client ID và Client Secret (một lần), hoặc liên hệ Omnira để bật kết nối sẵn");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  let redirectUri = "";
  const params = await loopbackAuth({
    provider: "YouTube",
    buildUrl: (redirect) => {
      redirectUri = redirect;
      const u = new URL(`${authBase()}/o/oauth2/v2/auth`);
      u.searchParams.set("client_id", clientId);
      u.searchParams.set("redirect_uri", redirect);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
      u.searchParams.set("access_type", "offline");
      u.searchParams.set("prompt", "consent select_account");
      u.searchParams.set("code_challenge", challenge);
      u.searchParams.set("code_challenge_method", "S256");
      u.searchParams.set("state", state);
      return u.toString();
    }
  });
  const err = params.get("error");
  if (err) throw new PublishError("permanent", err === "access_denied" ? "Bạn đã từ chối cấp quyền YouTube" : `Google từ chối: ${err}`);
  if (params.get("state") !== state) throw new PublishError("permanent", "Phiên đăng nhập không khớp – thử kết nối lại");
  const code = params.get("code");
  if (!code) throw new PublishError("permanent", "Google không trả mã đăng nhập");
  const signal = AbortSignal.timeout(45e3);
  const tok = await tokenRequest(
    { client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri },
    signal
  );
  if (!tok.refresh_token) throw new PublishError("permanent", "Google không trả refresh token – gỡ quyền của ứng dụng tại myaccount.google.com/permissions rồi kết nối lại");
  const granted = (tok.scope ?? "").split(" ");
  if (!granted.some((s) => s.endsWith("youtube.upload")))
    throw new PublishError("permanent", 'Chưa cấp quyền tải video lên YouTube – kết nối lại và tick đồng ý quyền "Quản lý video YouTube"');
  const channel = await youtubeMyChannel(tok.access_token, signal);
  return { accessToken: tok.access_token, refreshToken: tok.refresh_token, accessExpiresAt: Date.now() + tok.expires_in * 1e3, channel, viaCloud: false, clientId };
}

export async function freshYoutubeCred(channelId, cred, signal) {
  if (cred.accessExpiresAt && cred.accessExpiresAt - Date.now() > 5 * 6e4) return cred;
  if (cred.viaCloud && cred.refreshToken) {
    const r2 = await cloudRefresh("google", cred.refreshToken);
    const next2 = { ...cred, token: r2.access_token, refreshToken: r2.refresh_token ?? cred.refreshToken, accessExpiresAt: Date.now() + r2.expires_in * 1e3 };
    writeCred(channelId, next2);
    markChannel(channelId, { tokenStatus: "valid" });
    return next2;
  }
  const clientId = cred.clientKey ?? youtubeClientId();
  const clientSecret = youtubeClientSecret();
  if (!cred.refreshToken || !clientId || !clientSecret) throw new PublishError("auth", "Thiếu refresh token / ứng dụng YouTube – bấm Kết nối lại YouTube");
  const r = await tokenRequest({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: cred.refreshToken }, signal);
  const next = { ...cred, token: r.access_token, refreshToken: r.refresh_token ?? cred.refreshToken, accessExpiresAt: Date.now() + r.expires_in * 1e3 };
  writeCred(channelId, next);
  markChannel(channelId, { tokenStatus: "valid" });
  return next;
}

const CHUNK = 8 * 1024 * 1024;
const clean = (s) => s.replace(/[<>]/g, "");

function tagsOf(hashtags) {
  const out = [];
  let total = 0;
  for (const t of hashtags.map((x) => x.replace(/^#/, "").trim()).filter(Boolean)) {
    if (total + t.length + 1 > 480) break;
    out.push(t);
    total += t.length + 1;
  }
  return out;
}

async function uploadChunks(sessionUrl, file, size, signal, stage) {
  const fh = await open(file, "r");
  try {
    let from = 0;
    let retries = 0;
    while (true) {
      const to = Math.min(from + CHUNK, size) - 1;
      const len = to - from + 1;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, from);
      let res = null;
      try {
        res = await fetch(sessionUrl, { method: "PUT", headers: { "Content-Length": String(len), "Content-Range": `bytes ${from}-${to}/${size}` }, body: buf, signal });
      } catch (err) {
        if (signal.aborted) throw err;
      }
      if (res && (res.status === 200 || res.status === 201)) return await res.json();
      if (res && res.status === 308) {
        const range = res.headers.get("range");
        from = range ? Number(range.split("-")[1]) + 1 : 0;
        retries = 0;
        stage(`Đang upload lên YouTube ${Math.min(100, Math.round(from / size * 100))}%`);
        continue;
      }
      if (res && res.status < 500 && res.status !== 429) throw youtubeError(res.status, await res.json().catch(() => null));
      if (++retries > 5) throw new PublishError("transient", "Upload YouTube bị gián đoạn nhiều lần – sẽ thử lại sau");
      stage(`Mạng chập chờn – nối lại upload YouTube (lần ${retries}/5)`);
      await sleep(2e3 * retries, signal);
      try {
        const st = await fetch(sessionUrl, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` }, signal });
        if (st.status === 200 || st.status === 201) return await st.json();
        if (st.status === 308) {
          const range = st.headers.get("range");
          from = range ? Number(range.split("-")[1]) + 1 : 0;
        } else if (st.status === 404 || st.status === 410) throw new PublishError("transient", "Phiên upload YouTube đã hết hạn – sẽ tải lại từ đầu");
      } catch (err) {
        if (err instanceof PublishError || signal.aborted) throw err;
      }
    }
  } finally {
    await fh.close();
  }
}

export async function publishYouTube({ cred, content, signal, stage }) {
  const { videos } = mediaFiles(content);
  const file = videos[0];
  if (!file) throw new PublishError("permanent", "YouTube chỉ đăng video – nội dung này không có file video");
  const size = statSync(file).size;
  const cfg = youtubePublishSettings();
  const shorts = content.aspect === "9:16" && (content.durationSec ?? 0) > 0 && (content.durationSec ?? 0) <= 180;
  let description = clean(composeCaption(content, 4900));
  if (shorts && !/#shorts/i.test(description)) description += "\n#Shorts";
  const title = clean(content.title).trim().slice(0, 100) || "Video mới";
  stage("Khởi tạo upload YouTube");
  const init = new URL(`${apiBase()}/upload/youtube/v3/videos`);
  init.searchParams.set("uploadType", "resumable");
  init.searchParams.set("part", "snippet,status");
  init.searchParams.set("notifySubscribers", String(cfg.notifySubscribers));
  let res;
  try {
    res = await fetch(init, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/*"
      },
      body: JSON.stringify({
        snippet: { title, description, tags: tagsOf(content.hashtags), categoryId: cfg.categoryId },
        status: {
          privacyStatus: cfg.privacy,
          selfDeclaredMadeForKids: false,
          // Nhãn "nội dung đã chỉnh sửa / tạo bằng AI" – video từ Xưởng video AI
          ...cfg.declareSynthetic && content.source === "studio" ? { containsSyntheticMedia: true } : {}
        }
      }),
      signal
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new PublishError("transient", `Không kết nối được YouTube: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw youtubeError(res.status, await res.json().catch(() => null));
  const session = res.headers.get("location");
  if (!session) throw new PublishError("transient", "YouTube không trả phiên upload");
  stage("Đang upload lên YouTube 0%");
  const video = await uploadChunks(session, file, size, signal, stage);
  const notes = [];
  if (cfg.privacy !== "private" && video.status?.privacyStatus === "private")
    notes.push("YouTube để video ở chế độ Riêng tư (dự án Google Cloud chưa qua kiểm duyệt API) – mở công khai trong YouTube Studio");
  const thumb = content.thumbnailPath ? isAbsolute(content.thumbnailPath) ? content.thumbnailPath : join(mediaDir(), content.thumbnailPath) : null;
  if (thumb && existsSync(thumb)) {
    stage("Đặt thumbnail");
    try {
      const t = new URL(`${apiBase()}/upload/youtube/v3/thumbnails/set`);
      t.searchParams.set("videoId", video.id);
      t.searchParams.set("uploadType", "media");
      const r = await fetch(t, {
        method: "POST",
        headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": /\.png$/i.test(thumb) ? "image/png" : "image/jpeg" },
        body: await readFile(thumb),
        signal
      });
      if (!r.ok) {
        const e = youtubeError(r.status, await r.json().catch(() => null));
        notes.push(`Chưa đặt được thumbnail: ${e.message}${r.status === 403 ? " (kênh cần xác minh số điện thoại để dùng thumbnail tùy chỉnh)" : ""}`);
      }
    } catch (err) {
      if (signal.aborted) throw err;
      notes.push(`Chưa đặt được thumbnail: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    externalId: video.id,
    permalink: shorts ? `https://www.youtube.com/shorts/${video.id}` : `https://www.youtube.com/watch?v=${video.id}`,
    note: notes.join(". ") || void 0
  };
}

const analyticsBase = () => process.env.OMNI_YT_ANALYTICS_BASE ?? "https://youtubeanalytics.googleapis.com";

export async function youtubeDaily(token, signal, days = 30) {
  const notes = [];
  const daily = new Map();
  const me = await youtubeMyChannel(token, signal);
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const url = new URL(`${analyticsBase()}/v2/reports`);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", day(Date.now() - days * 864e5));
  url.searchParams.set("endDate", day(Date.now()));
  url.searchParams.set("metrics", "views,likes,comments,shares,estimatedMinutesWatched");
  url.searchParams.set("dimensions", "day");
  url.searchParams.set("sort", "day");
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw youtubeError(res.status, body);
    for (const r of body?.rows ?? []) {
      const [d, views, likes, comments, shares, minutes] = r;
      daily.set(d, { views, engagements: likes + comments + shares, watchMinutes: minutes });
    }
  } catch (err) {
    if (signal.aborted) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    notes.push(
      /accessNotConfigured|has not been used|disabled/i.test(msg) ? "Chưa bật YouTube Analytics API trong dự án Google Cloud – bật để có lượt xem / phút xem theo ngày" : /insufficient|Thiếu quyền|scope/i.test(msg) ? "Kết nối lại YouTube để cấp quyền xem số liệu (yt-analytics.readonly)" : `Số liệu theo ngày lỗi: ${msg}`
    );
  }
  return { daily, followers: me.subscribers, notes };
}

export async function youtubeVideoStats(ids, token, signal) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt("GET", "/youtube/v3/videos", {
      token,
      signal,
      query: { part: "statistics", id: ids.slice(i, i + 50).join(",") }
    });
    for (const v of r.items ?? []) {
      const s = v.statistics ?? {};
      out.set(v.id, { views: Number(s.viewCount ?? 0), engagements: Number(s.likeCount ?? 0) + Number(s.commentCount ?? 0) });
    }
  }
  return out;
}

const toComment = (c) => ({
  id: c.id,
  text: c.snippet.textDisplay ?? "",
  author: c.snippet.authorDisplayName ?? "Người xem YouTube",
  authorChannelId: c.snippet.authorChannelId?.value ?? null,
  publishedAt: c.snippet.publishedAt ?? (new Date()).toISOString()
});

export async function youtubeCommentThreads(channelId, token, signal) {
  const r = await yt("GET", "/youtube/v3/commentThreads", {
    token,
    signal,
    query: { part: "snippet,replies", allThreadsRelatedToChannelId: channelId, maxResults: "50", order: "time", textFormat: "plainText" }
  });
  const threads = (r.items ?? []).map((t) => ({
    id: t.snippet.topLevelComment.id,
    videoId: t.snippet.videoId ?? null,
    videoTitle: null,
    top: toComment(t.snippet.topLevelComment),
    // API trả trả lời mới nhất trước → đảo lại theo thời gian
    replies: (t.replies?.comments ?? []).map(toComment).reverse()
  }));
  const ids = [...new Set(threads.map((t) => t.videoId).filter((x) => !!x))];
  if (ids.length) {
    try {
      const v = await yt("GET", "/youtube/v3/videos", {
        token,
        signal,
        query: { part: "snippet", id: ids.slice(0, 50).join(",") }
      });
      const titles = new Map((v.items ?? []).map((x) => [x.id, x.snippet?.title ?? null]));
      for (const t of threads) t.videoTitle = t.videoId ? titles.get(t.videoId) ?? null : null;
    } catch {
    }
  }
  return threads;
}

export async function youtubeReply(parentId, text, token, signal) {
  const r = await yt("POST", "/youtube/v3/comments", { token, signal, query: { part: "snippet" }, json: { snippet: { parentId, textOriginal: text } } });
  return r.id;
}

export async function youtubeHoldComment(commentId, token, signal) {
  const url = new URL(`${apiBase()}/youtube/v3/comments/setModerationStatus`);
  url.searchParams.set("id", commentId);
  url.searchParams.set("moderationStatus", "heldForReview");
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal });
  if (!res.ok) throw youtubeError(res.status, await res.json().catch(() => null));
}

export async function youtubeTopComment(videoId, text, token, signal) {
  const r = await yt("POST", "/youtube/v3/commentThreads", {
    token,
    signal,
    query: { part: "snippet" },
    json: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } }
  });
  return r.id;
}
