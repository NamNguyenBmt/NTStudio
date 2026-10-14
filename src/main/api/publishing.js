import {
  DEFAULT_REDIRECT_URI,
  metaRedirectUri,
  metaInstagram,
  setMetaInstagram,
  fbScopes,
  metaAppId,
  metaConfigId,
  metaAppSecret,
  saveMetaApp,
  missingFeatures,
  metaViaCloud,
  facebookLogin,
} from "../publish/meta-login";
import { bestHours } from "../analytics/best-hours";
import {
  DEFAULT_TIKTOK_REDIRECT,
  DEFAULT_TIKTOK_SCOPES,
  tiktokClientKey,
  tiktokClientSecret,
  tiktokRedirectUri,
  tiktokScopes,
  saveTiktokApp,
  tiktokLogin,
} from "../publish/tiktok-login";
import { BrowserWindow } from "electron";
import { and, eq, isNull } from "drizzle-orm";
import { accounts, channels, alerts, activityLog } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError, notFound } from "../errors";
import { vaultAvailable } from "../vault";
import { PublishError, tiktokOAuth } from "../publish/http";
import { cloudOAuthEnabled, cancelCloudLogin, cloudRefresh } from "../publish/cloud-oauth";
import {
  readCred,
  writeCred,
  clearCred,
  statusFor,
  markChannel,
  inspectFbToken,
  exchangeLongLived,
  tokenExpiry,
  tiktokUser,
} from "../publish/credentials";
import { cancelLoopbackAuth } from "../publish/loopback";
import {
  youtubeClientId,
  youtubeClientSecret,
  youtubePublishSettings,
  saveYoutubePublishSettings,
  saveYoutubeApp,
  youtubeMyChannel,
  youtubeLogin,
  freshYoutubeCred,
} from "../publish/youtube";
import { publishEnabled, setPublishEnabled, kickPublisher, workerStatus, publishNow } from "../publish/worker";
import { lastInsightsSync, syncInsights } from "../analytics/insights";

const timeoutSignal = () => AbortSignal.timeout(45e3);

function apiErr(err, prefix) {
  if (err instanceof ApiError) return err;
  if (err instanceof PublishError) {
    if (err.kind === "auth")
      return new ApiError("VALIDATION", `${prefix}: token không hợp lệ hoặc thiếu quyền – ${err.message}`);
    return new ApiError(err.kind === "permanent" ? "VALIDATION" : "INTERNAL", `${prefix}: ${err.message}`);
  }
  return new ApiError("INTERNAL", `${prefix}: ${err instanceof Error ? err.message : String(err)}`);
}

function requireVault() {
  if (!vaultAvailable())
    throw new ApiError("INTERNAL", "Két bảo mật của hệ điều hành không khả dụng – không thể lưu token an toàn");
}

const norm = (s) => (s ?? "").trim().replace(/^@/, "").toLowerCase();

function resolveTokenAlerts(channelId) {
  getDb()
    .update(alerts)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(alerts.entityType, "channel"),
        eq(alerts.entityId, channelId),
        eq(alerts.kind, "token_invalid"),
        isNull(alerts.resolvedAt),
      ),
    )
    .run();
}

function saveConnection(ch, cred, patch) {
  writeCred(ch.id, cred);
  resolveTokenAlerts(ch.id);
  const row = markChannel(ch.id, {
    ...patch,
    tokenStatus: statusFor(cred.expiresAt),
    tokenExpiresAt: cred.expiresAt ? new Date(cred.expiresAt) : null,
    health: "ok",
  });
  if (row.platform !== "facebook")
    getDb()
      .update(accounts)
      .set({ health: "ok", sessionStatus: "valid", updatedAt: new Date() })
      .where(eq(accounts.id, row.accountId))
      .run();
  getDb()
    .insert(activityLog)
    .values({ level: "ok", scope: "token", message: `Đã kết nối API cho kênh ${row.name}` })
    .run();
  kickPublisher();
  return row;
}

const expiryText = (at) => (at ? `hết hạn ${new Date(at).toLocaleString("vi-VN")}` : "không hết hạn");

async function connectFacebook(ch, token, signal) {
  const info = await inspectFbToken(token, signal);
  let page;
  if (info.type === "page") {
    page = info.page;
    if (ch.externalId && ch.externalId !== page.id)
      throw new ApiError(
        "VALIDATION",
        `Token thuộc Fanpage "${page.name}" (${page.id}), không phải kênh này (${ch.externalId})`,
      );
  } else {
    page = info.pages.find((p) => (ch.externalId ? p.id === ch.externalId : norm(p.name) === norm(ch.name)));
    if (!page) {
      throw new ApiError(
        "VALIDATION",
        `User token của "${info.userName}" quản lý ${info.pages.length} Fanpage nhưng không có trang khớp "${ch.name}"${ch.externalId ? ` (${ch.externalId})` : ""}. Dùng "Nhập Fanpage từ User Token" ở tài khoản VIA để thêm trang.`,
      );
    }
    if (!page.access_token)
      throw new ApiError(
        "VALIDATION",
        `Tài khoản không có quyền đăng bài trên "${page.name}" (thiếu pages_manage_posts)`,
      );
  }
  const pageToken = page.access_token ?? token;
  const expiresAt = await tokenExpiry(pageToken, signal);
  const channel = saveConnection(
    ch,
    { token: pageToken, pageId: page.id, expiresAt },
    {
      externalId: page.id,
      followers: page.fan_count ?? ch.followers,
      avatarUrl: page.picture?.data?.url ?? ch.avatarUrl,
    },
  );
  return { channel, message: `Đã kết nối Fanpage "${page.name}" · token ${expiryText(expiresAt)}` };
}

async function connectInstagram(ch, token, signal) {
  const info = await inspectFbToken(token, signal);
  const pages = info.type === "page" ? [info.page] : info.pages;
  const linked = pages.filter((p) => p.instagram_business_account);
  const match =
    linked.find((p) => ch.externalId && p.instagram_business_account.id === ch.externalId) ??
    linked.find((p) => ch.handle && norm(p.instagram_business_account.username) === norm(ch.handle)) ??
    (!ch.externalId && !ch.handle && linked.length === 1 ? linked[0] : void 0);
  if (!match) {
    throw new ApiError(
      "VALIDATION",
      linked.length
        ? `Token có ${linked.length} tài khoản Instagram (${linked.map((p) => "@" + p.instagram_business_account.username).join(", ")}) nhưng không khớp kênh này – sửa @handle của kênh cho đúng`
        : "Không tìm thấy tài khoản Instagram Business/Creator liên kết với Fanpage của token này",
    );
  }
  const ig = match.instagram_business_account;
  const pageToken = match.access_token ?? token;
  const expiresAt = await tokenExpiry(pageToken, signal);
  const channel = saveConnection(
    ch,
    { token: pageToken, pageId: match.id, igUserId: ig.id, expiresAt },
    {
      externalId: ig.id,
      handle: ig.username ?? ch.handle,
      followers: ig.followers_count ?? ch.followers,
      avatarUrl: ig.profile_picture_url ?? ch.avatarUrl,
    },
  );
  return {
    channel,
    message: `Đã kết nối Instagram @${ig.username ?? ig.id} (qua Fanpage "${match.name}") · token ${expiryText(expiresAt)}`,
  };
}

async function connectTikTok(ch, input, signal) {
  let cred = { token: input.token, expiresAt: Date.now() + 24 * 36e5 };
  const canRefresh = !!(input.refreshToken && input.clientKey && input.clientSecret);
  if (canRefresh) {
    const r = await tiktokOAuth(
      {
        client_key: input.clientKey,
        client_secret: input.clientSecret,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
      },
      signal,
    );
    cred = {
      token: r.access_token,
      refreshToken: r.refresh_token ?? input.refreshToken,
      clientKey: input.clientKey,
      clientSecret: input.clientSecret,
      expiresAt: Date.now() + r.expires_in * 1e3,
    };
  }
  const user = await tiktokUser(cred.token, signal);
  const prev = readCred(ch.id);
  if (prev?.openId && prev.openId !== user.open_id) {
    throw new ApiError(
      "VALIDATION",
      `Token thuộc tài khoản TikTok "${user.display_name ?? user.open_id}", khác tài khoản đã kết nối trước đó – ngắt kết nối kênh trước nếu muốn đổi`,
    );
  }
  cred.openId = user.open_id;
  const channel = saveConnection(ch, cred, { avatarUrl: user.avatar_url ?? ch.avatarUrl });
  return {
    channel,
    message: `Đã kết nối TikTok "${user.display_name ?? user.open_id}" · ${canRefresh ? `tự làm mới token (${expiryText(cred.expiresAt)})` : "token hết hạn sau ~24 giờ – thêm refresh token + client key/secret để tự làm mới"}`,
  };
}

async function importPages(via, token, longLived, signal) {
  const db = getDb();
  const info = await inspectFbToken(token, signal);
  if (info.type === "page")
    throw new ApiError(
      "VALIDATION",
      "Đây là Page token – hãy dán User token của VIA, hoặc dán Page token trực tiếp vào từng Fanpage",
    );
  const usable = info.pages.filter((p) => p.access_token);
  if (!usable.length)
    throw new ApiError(
      "VALIDATION",
      `"${info.userName}" không quản lý Fanpage nào (hoặc chưa cấp quyền cho Page nào – khi đăng nhập hãy chọn Page cần kết nối)`,
    );
  let pagesCreated = 0;
  let pagesUpdated = 0;
  let igCount = 0;
  for (const p of usable) {
    const expiresAt = await tokenExpiry(p.access_token, signal);
    let page = db
      .select()
      .from(channels)
      .where(and(eq(channels.platform, "facebook"), eq(channels.externalId, p.id)))
      .get();
    if (!page) {
      page = db
        .insert(channels)
        .values({
          id: newId(),
          accountId: via.id,
          workspaceId: via.workspaceId,
          platform: "facebook",
          kind: "fb_page",
          name: p.name,
          externalId: p.id,
          role: "admin",
        })
        .returning()
        .get();
      pagesCreated++;
    } else pagesUpdated++;
    saveConnection(
      page,
      { token: p.access_token, pageId: p.id, expiresAt },
      { name: p.name, followers: p.fan_count ?? page.followers, avatarUrl: p.picture?.data?.url ?? page.avatarUrl },
    );
    const ig = p.instagram_business_account;
    if (ig) {
      let igCh = db
        .select()
        .from(channels)
        .where(and(eq(channels.platform, "instagram"), eq(channels.externalId, ig.id)))
        .get();
      if (!igCh) {
        const acc =
          db
            .insert(accounts)
            .values({
              id: newId(),
              workspaceId: via.workspaceId,
              platform: "instagram",
              displayName: ig.username ?? p.name,
              handle: ig.username ?? null,
              externalId: ig.id,
              sessionStatus: "unknown",
            })
            .onConflictDoNothing()
            .returning()
            .get() ??
          db
            .select()
            .from(accounts)
            .where(and(eq(accounts.platform, "instagram"), eq(accounts.externalId, ig.id)))
            .get();
        igCh = db
          .insert(channels)
          .values({
            id: newId(),
            accountId: acc.id,
            workspaceId: acc.workspaceId,
            platform: "instagram",
            kind: "ig_account",
            name: ig.username ?? p.name,
            handle: ig.username ?? null,
            externalId: ig.id,
          })
          .returning()
          .get();
      }
      saveConnection(
        igCh,
        { token: p.access_token, pageId: p.id, igUserId: ig.id, expiresAt },
        {
          handle: ig.username ?? igCh.handle,
          followers: ig.followers_count ?? igCh.followers,
          avatarUrl: ig.profile_picture_url ?? igCh.avatarUrl,
        },
      );
      igCount++;
    }
  }
  db.update(accounts)
    .set({ sessionStatus: "valid", health: "ok", updatedAt: new Date() })
    .where(eq(accounts.id, via.id))
    .run();
  let instagramIssue = null;
  if (metaInstagram() && igCount === 0) {
    instagramIssue = info.igError
      ? `Facebook từ chối đọc Instagram (${info.igError}). Kiểm tra Meta App đã thêm use case Instagram bản "API setup with Facebook login" với quyền instagram_basic, rồi kết nối lại.`
      : `Không thấy tài khoản Instagram nào liên kết với ${usable.length} Fanpage đã cấp quyền (${usable.map((p) => p.name).join(", ")}). Kiểm tra: Instagram là tài khoản chuyên nghiệp, đã liên kết với đúng Fanpage này, và khi đăng nhập Facebook đã tick chọn tài khoản Instagram (bấm "Chỉnh sửa quyền truy cập" nếu Facebook không hỏi).`;
  }
  console.info(
    `[oauth] nhập từ token: ${usable.length} Fanpage (${pagesCreated} mới) · ${igCount} Instagram · ${usable.filter((p) => p.instagram_business_account).length} Page có liên kết Instagram${info.igError ? ` · Instagram bị từ chối: ${info.igError}` : ""}`,
  );
  const message =
    `Đã kết nối ${usable.length} Fanpage (${pagesCreated} mới, ${pagesUpdated} cập nhật)` +
    (igCount ? ` và ${igCount} tài khoản Instagram` : "") +
    (longLived ? " · token dài hạn" : " · token ngắn hạn – nhập App ID/Secret để Page token không hết hạn");
  return { pages: usable.length, created: pagesCreated, instagram: igCount, longLived, message, instagramIssue };
}

export const publishingHandlers = {
  "integrations.youtube": async () => ({
    clientId: youtubeClientId(),
    hasSecret: !!youtubeClientSecret(),
    viaCloud: await cloudOAuthEnabled("google"),
    publish: youtubePublishSettings(),
  }),
  "integrations.setYoutube": async ({ clientId, clientSecret }) => {
    requireVault();
    try {
      await saveYoutubeApp(clientId, clientSecret || null);
      return { message: "Đã lưu Ứng dụng YouTube – Client ID/Secret hợp lệ" };
    } catch (err) {
      throw apiErr(err, "Không lưu được Ứng dụng YouTube");
    }
  },
  "integrations.setYoutubePublish": (patch) => {
    saveYoutubePublishSettings(patch);
  },
  "integrations.setInstagram": ({ enabled }) => setMetaInstagram(enabled),
  "accounts.cancelYoutubeLogin": () => {
    cancelLoopbackAuth();
    cancelCloudLogin();
  },
  /** "Kết nối YouTube": trình duyệt hệ thống → Google → tạo (hoặc cập nhật) tài khoản + kênh YouTube, lưu refresh token. */
  "accounts.connectYoutube": async ({ accountId, workspaceId }) => {
    requireVault();
    const db = getDb();
    const existing = accountId ? db.select().from(accounts).where(eq(accounts.id, accountId)).get() : void 0;
    if (accountId && !existing) throw notFound("tài khoản YouTube");
    if (existing && existing.platform !== "youtube")
      throw new ApiError("VALIDATION", "Chỉ kết nối YouTube cho tài khoản YouTube");
    try {
      const login = await youtubeLogin(BrowserWindow.getFocusedWindow());
      const yt = login.channel;
      if (existing?.externalId && existing.externalId !== yt.id) {
        throw new ApiError(
          "VALIDATION",
          `Bạn vừa đăng nhập kênh "${yt.title}" – khác kênh "${existing.displayName}". Đăng nhập đúng kênh, hoặc bấm "Kết nối YouTube" ở đầu trang để thêm kênh mới.`,
        );
      }
      let ch = db
        .select()
        .from(channels)
        .where(and(eq(channels.platform, "youtube"), eq(channels.externalId, yt.id)))
        .get();
      let created = false;
      if (!ch) {
        const acc =
          existing ??
          db
            .insert(accounts)
            .values({
              id: newId(),
              workspaceId: workspaceId ?? null,
              platform: "youtube",
              displayName: yt.title,
              handle: yt.customUrl?.replace(/^@/, "") ?? null,
              externalId: yt.id,
              sessionStatus: "valid",
              health: "ok",
            })
            .onConflictDoNothing()
            .returning()
            .get() ??
          db
            .select()
            .from(accounts)
            .where(and(eq(accounts.platform, "youtube"), eq(accounts.externalId, yt.id)))
            .get();
        ch = db
          .insert(channels)
          .values({
            id: newId(),
            accountId: acc.id,
            workspaceId: acc.workspaceId,
            platform: "youtube",
            kind: "yt_channel",
            name: yt.title,
            handle: yt.customUrl?.replace(/^@/, "") ?? null,
            externalId: yt.id,
          })
          .returning()
          .get();
        created = true;
      }
      saveConnection(
        ch,
        {
          token: login.accessToken,
          refreshToken: login.refreshToken,
          accessExpiresAt: login.accessExpiresAt,
          channelId: yt.id,
          clientKey: login.clientId || (youtubeClientId() ?? void 0),
          viaCloud: login.viaCloud || void 0,
          expiresAt: null,
        },
        {
          name: yt.title,
          handle: yt.customUrl?.replace(/^@/, "") ?? ch.handle,
          avatarUrl: yt.thumbnail ?? ch.avatarUrl,
          ...(yt.subscribers != null ? { followers: yt.subscribers } : {}),
        },
      );
      return {
        accountId: ch.accountId,
        channelName: yt.title,
        created,
        message: `${created ? "Đã thêm" : "Đã kết nối lại"} kênh YouTube "${yt.title}" · token tự làm mới`,
      };
    } catch (err) {
      throw apiErr(err, "Kết nối YouTube thất bại");
    }
  },
  "integrations.tiktok": async () => ({
    clientKey: tiktokClientKey(),
    hasSecret: !!tiktokClientSecret(),
    redirectUri: tiktokRedirectUri(),
    defaultRedirectUri: DEFAULT_TIKTOK_REDIRECT,
    scopes: tiktokScopes(),
    defaultScopes: DEFAULT_TIKTOK_SCOPES,
    viaCloud: await cloudOAuthEnabled("tiktok"),
  }),
  "integrations.setTiktok": async ({ clientKey, clientSecret, redirectUri, scopes }) => {
    requireVault();
    try {
      await saveTiktokApp({
        clientKey,
        clientSecret: clientSecret || null,
        redirectUri: redirectUri && redirectUri !== DEFAULT_TIKTOK_REDIRECT ? redirectUri : null,
        scopes: scopes && scopes !== DEFAULT_TIKTOK_SCOPES ? scopes : null,
      });
      return { message: "Đã lưu Ứng dụng TikTok – Client Key/Secret hợp lệ" };
    } catch (err) {
      throw apiErr(err, "Không lưu được Ứng dụng TikTok");
    }
  },
  /** "Kết nối TikTok": đăng nhập TikTok → tạo (hoặc cập nhật) tài khoản + kênh TikTok, lưu token tự làm mới. */
  "accounts.connectTiktok": async ({ accountId, workspaceId }) => {
    requireVault();
    const db = getDb();
    const existing = accountId ? db.select().from(accounts).where(eq(accounts.id, accountId)).get() : void 0;
    if (accountId && !existing) throw notFound("tài khoản TikTok");
    if (existing && existing.platform !== "tiktok")
      throw new ApiError("VALIDATION", "Chỉ kết nối TikTok cho tài khoản TikTok");
    try {
      const login = await tiktokLogin(BrowserWindow.getFocusedWindow());
      let ch = db
        .select()
        .from(channels)
        .where(and(eq(channels.platform, "tiktok"), eq(channels.externalId, login.openId)))
        .get();
      if (existing) {
        const own = db.select().from(channels).where(eq(channels.accountId, existing.id)).get();
        const prev = own ? readCred(own.id) : null;
        if (prev?.openId && prev.openId !== login.openId) {
          throw new ApiError(
            "VALIDATION",
            `Bạn vừa đăng nhập TikTok "${login.displayName}" – khác tài khoản đã kết nối với "${existing.displayName}". Đăng nhập đúng tài khoản, hoặc bấm "Kết nối TikTok" ở đầu trang để thêm tài khoản mới.`,
          );
        }
        ch = own ?? ch;
      }
      let created = false;
      if (!ch) {
        const acc =
          db
            .insert(accounts)
            .values({
              id: newId(),
              workspaceId: workspaceId ?? null,
              platform: "tiktok",
              displayName: login.displayName,
              externalId: login.openId,
              sessionStatus: "valid",
              health: "ok",
            })
            .onConflictDoNothing()
            .returning()
            .get() ??
          db
            .select()
            .from(accounts)
            .where(and(eq(accounts.platform, "tiktok"), eq(accounts.externalId, login.openId)))
            .get();
        ch = db
          .insert(channels)
          .values({
            id: newId(),
            accountId: acc.id,
            workspaceId: acc.workspaceId,
            platform: "tiktok",
            kind: "tiktok_account",
            name: login.displayName,
            externalId: login.openId,
          })
          .returning()
          .get();
        created = true;
      }
      const clientKey = login.clientKey || tiktokClientKey();
      saveConnection(
        ch,
        {
          token: login.accessToken,
          openId: login.openId,
          refreshToken: login.refreshToken,
          clientKey,
          viaCloud: login.viaCloud || void 0,
          expiresAt: login.expiresAt,
        },
        {
          externalId: ch.externalId ?? login.openId,
          avatarUrl: login.avatarUrl ?? ch.avatarUrl,
          ...(login.followers != null ? { followers: login.followers } : {}),
        },
      );
      const missing = ["video.publish", "user.info.basic"].filter((s) => !login.scopes.includes(s));
      return {
        accountId: ch.accountId,
        userName: login.displayName,
        created,
        missingScopes: missing,
        message: `${created ? "Đã thêm" : "Đã kết nối lại"} TikTok "${login.displayName}" · token tự làm mới${missing.length ? ` · thiếu quyền ${missing.join(", ")} – chưa đăng video được` : ""}`,
      };
    } catch (err) {
      console.warn(`[oauth] Kết nối TikTok thất bại: ${err instanceof Error ? err.message : String(err)}`);
      throw apiErr(err, "Kết nối TikTok thất bại");
    }
  },
  "integrations.meta": async () => ({
    appId: metaAppId(),
    configId: metaConfigId(),
    hasSecret: !!metaAppSecret(),
    redirectUri: metaRedirectUri(),
    defaultRedirectUri: DEFAULT_REDIRECT_URI,
    instagram: metaInstagram(),
    scopes: fbScopes(),
    viaCloud: await metaViaCloud(),
  }),
  "integrations.setMeta": async ({ appId, appSecret, configId, redirectUri, instagram }) => {
    requireVault();
    try {
      const { name } = await saveMetaApp(
        appId,
        appSecret ?? null,
        configId ?? null,
        redirectUri && redirectUri !== DEFAULT_REDIRECT_URI ? redirectUri : null,
        instagram ?? metaInstagram(),
      );
      return { message: `Đã lưu Ứng dụng Meta${name ? ` "${name}"` : ""} – App ID/Secret hợp lệ` };
    } catch (err) {
      throw apiErr(err, "App ID / App Secret không hợp lệ");
    }
  },
  /**
   * "Kết nối Facebook": đăng nhập Facebook trong cửa sổ của app → tạo (hoặc dùng) tài khoản VIA tương ứng
   * → nhập mọi Fanpage + Instagram Business đã cấp quyền, lưu Page token dài hạn.
   */
  "accounts.connectFacebook": async ({ accountId, workspaceId }) => {
    requireVault();
    const db = getDb();
    let via = accountId ? db.select().from(accounts).where(eq(accounts.id, accountId)).get() : void 0;
    if (accountId && !via) throw notFound("tài khoản Facebook");
    if (via && via.platform !== "facebook")
      throw new ApiError("VALIDATION", "Chỉ kết nối Facebook cho tài khoản Facebook");
    try {
      const login = await facebookLogin(BrowserWindow.getFocusedWindow());
      if (via?.externalId && via.externalId !== login.userId) {
        throw new ApiError(
          "VALIDATION",
          `Bạn vừa đăng nhập Facebook "${login.name}" – khác tài khoản "${via.displayName}" (UID ${via.externalId}). Hãy đăng nhập đúng tài khoản, hoặc bấm "Kết nối Facebook" ở đầu trang để thêm tài khoản mới.`,
        );
      }
      via ??= db
        .select()
        .from(accounts)
        .where(and(eq(accounts.platform, "facebook"), eq(accounts.externalId, login.userId)))
        .get();
      if (!via) {
        via = db
          .insert(accounts)
          .values({
            id: newId(),
            workspaceId: workspaceId ?? null,
            platform: "facebook",
            displayName: login.name,
            externalId: login.userId,
            sessionStatus: "valid",
            health: "ok",
          })
          .returning()
          .get();
      } else if (!via.externalId) {
        via = db
          .update(accounts)
          .set({ externalId: login.userId, updatedAt: new Date() })
          .where(eq(accounts.id, via.id))
          .returning()
          .get();
      }
      const result = await importPages(via, login.token, true, AbortSignal.timeout(9e4));
      const missing = missingFeatures(login.granted);
      if (missing.length) console.warn(`[oauth] thiếu quyền: ${missing.flatMap((m) => m.perms).join(", ")}`);
      return { ...result, accountId: via.id, userName: login.name, missing };
    } catch (err) {
      throw apiErr(err, "Kết nối Facebook thất bại");
    }
  },
  "channels.connect": async ({ channelId, token, refreshToken, clientKey, clientSecret }) => {
    requireVault();
    const ch = getDb().select().from(channels).where(eq(channels.id, channelId)).get();
    if (!ch) throw notFound("kênh");
    const signal = timeoutSignal();
    try {
      if (ch.platform === "youtube")
        throw new ApiError(
          "VALIDATION",
          'Kênh YouTube kết nối bằng nút "Kết nối YouTube" (đăng nhập Google), không dán token',
        );
      if (ch.platform === "facebook") return await connectFacebook(ch, token, signal);
      if (ch.platform === "instagram") return await connectInstagram(ch, token, signal);
      return await connectTikTok(ch, { token, refreshToken, clientKey, clientSecret }, signal);
    } catch (err) {
      throw apiErr(err, "Không kết nối được");
    }
  },
  "channels.verify": async ({ id }) => {
    const ch = getDb().select().from(channels).where(eq(channels.id, id)).get();
    if (!ch) throw notFound("kênh");
    const cred = readCred(id);
    if (!cred) throw new ApiError("VALIDATION", "Kênh chưa kết nối API");
    const signal = timeoutSignal();
    try {
      if (ch.platform === "youtube") {
        const fresh = await freshYoutubeCred(id, cred, signal);
        const yt = await youtubeMyChannel(fresh.token, signal);
        const row2 = markChannel(id, {
          tokenStatus: "valid",
          health: "ok",
          name: yt.title,
          ...(yt.subscribers != null ? { followers: yt.subscribers } : {}),
        });
        resolveTokenAlerts(id);
        return { channel: row2, message: `Kết nối hợp lệ – kênh YouTube "${yt.title}" · token tự làm mới` };
      }
      if (ch.platform === "tiktok") {
        const user = await tiktokUser(cred.token, signal);
        const row2 = markChannel(id, { tokenStatus: statusFor(cred.expiresAt), health: "ok" });
        resolveTokenAlerts(id);
        return {
          channel: row2,
          message: `Token hợp lệ – TikTok "${user.display_name ?? user.open_id}" · ${expiryText(cred.expiresAt)}`,
        };
      }
      const info = await inspectFbToken(cred.token, signal);
      const name = info.type === "page" ? info.page.name : info.userName;
      const expiresAt = await tokenExpiry(cred.token, signal);
      writeCred(id, { ...cred, expiresAt });
      const row = markChannel(id, {
        tokenStatus: statusFor(expiresAt),
        tokenExpiresAt: expiresAt ? new Date(expiresAt) : null,
        health: "ok",
      });
      resolveTokenAlerts(id);
      return { channel: row, message: `Token hợp lệ – "${name}" · ${expiryText(expiresAt)}` };
    } catch (err) {
      if (err instanceof PublishError && err.kind === "auth")
        markChannel(id, { tokenStatus: "expired", health: "error" });
      throw apiErr(err, "Kiểm tra token thất bại");
    }
  },
  "channels.disconnect": ({ id }) => {
    const ch = getDb().select({ id: channels.id }).from(channels).where(eq(channels.id, id)).get();
    if (!ch) throw notFound("kênh");
    clearCred(id);
    markChannel(id, { tokenStatus: "missing", tokenExpiresAt: null });
  },
  /**
   * Nhập toàn bộ Fanpage (và tài khoản Instagram Business liên kết) từ User token của VIA.
   * Có App ID/Secret → đổi sang token dài hạn trước, Page token sinh ra sẽ không hết hạn.
   */
  "accounts.importFacebook": async ({ accountId, userToken, appId, appSecret }) => {
    requireVault();
    const via = getDb().select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!via) throw notFound("tài khoản VIA");
    if (via.platform !== "facebook") throw new ApiError("VALIDATION", "Chỉ nhập Fanpage cho tài khoản Facebook");
    const signal = AbortSignal.timeout(9e4);
    try {
      let token = userToken;
      let longLived = false;
      if (appId && appSecret) {
        token = (await exchangeLongLived(userToken, appId, appSecret, signal)).token;
        longLived = true;
      } else if (await metaViaCloud()) {
        token = String((await cloudRefresh("facebook", userToken)).access_token ?? userToken);
        longLived = true;
      }
      return await importPages(via, token, longLived, signal);
    } catch (err) {
      throw apiErr(err, "Nhập Fanpage thất bại");
    }
  },
  "posts.publishNow": ({ id }) => {
    try {
      publishNow(id);
    } catch (err) {
      throw new ApiError("CONFLICT", err instanceof Error ? err.message : String(err));
    }
    return { queued: true, workerEnabled: publishEnabled() };
  },
  "insights.sync": () => syncInsights(),
  "insights.last": () => lastInsightsSync(),
  "insights.bestHours": ({ workspaceId }) => bestHours(workspaceId),
  "posts.worker": () => workerStatus(),
  "posts.setWorker": ({ enabled }) => {
    setPublishEnabled(enabled);
    return workerStatus();
  },
};
