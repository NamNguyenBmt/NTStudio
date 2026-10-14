import { PublishError, graph } from "./http";
import { readCred, freshTikTokCred } from "./credentials";
import { publishFacebook, publishInstagram, publishTikTok } from "./platforms";
import { freshYoutubeCred, publishYouTube, youtubeTopComment } from "./youtube";
import { eq, and, ne, notInArray, lte, or, isNull, asc, inArray } from "drizzle-orm";
import { channels, secrets, contentItems, scheduledPosts, alerts, activityLog, settings } from "../db/schema";
import { getDb, newId } from "../db/index";

const TICK_MS = 2e4;
const RETRY_DELAYS_MIN = [2, 10, 30];
const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1;
let timer = null;
let current = null;
let lastRunAt = null;
let processed = 0;

export function publishEnabled() {
  const v = getDb().select().from(settings).where(eq(settings.key, "publish.enabled")).get()?.value;
  return v !== false;
}

export function setPublishEnabled(enabled) {
  getDb()
    .insert(settings)
    .values({ key: "publish.enabled", value: enabled })
    .onConflictDoUpdate({ target: settings.key, set: { value: enabled, updatedAt: new Date() } })
    .run();
  if (enabled) kickPublisher();
}

function recoverInterrupted() {
  getDb()
    .update(scheduledPosts)
    .set({
      status: "failed",
      error: "Ứng dụng đã đóng khi đang đăng – kiểm tra trên nền tảng trước khi thử lại để tránh đăng trùng",
      updatedAt: new Date(),
    })
    .where(eq(scheduledPosts.status, "publishing"))
    .run();
}

function reconcileTokenStatus() {
  const db = getDb();
  const withToken = db
    .select({ id: secrets.ownerId })
    .from(secrets)
    .where(and(eq(secrets.ownerType, "channel"), eq(secrets.kind, "access_token")))
    .all()
    .map((r) => r.id);
  const res = db
    .update(channels)
    .set({ tokenStatus: "missing", tokenExpiresAt: null, updatedAt: new Date() })
    .where(and(ne(channels.tokenStatus, "missing"), withToken.length ? notInArray(channels.id, withToken) : void 0))
    .run();
  if (res.changes) console.info(`[publish] ${res.changes} kênh chưa có token trong két → đặt "Chưa có token"`);
}

export function startPublisher() {
  lastRunAt = null;
  processed = 0;
  recoverInterrupted();
  reconcileTokenStatus();
  timer = setInterval(() => void tick(), TICK_MS);
  setTimeout(() => timer && void tick(), 3e3);
}

export function stopPublisher() {
  if (timer) clearInterval(timer);
  timer = null;
  current?.ctl.abort();
}

export function kickPublisher() {
  setTimeout(() => void tick(), 50);
}

function dueCondition(now) {
  return and(
    eq(scheduledPosts.status, "queued"),
    lte(scheduledPosts.scheduledAt, now),
    or(isNull(scheduledPosts.nextAttemptAt), lte(scheduledPosts.nextAttemptAt, now)),
    eq(channels.status, "active"),
  );
}

export function workerStatus() {
  const db = getDb();
  const now = new Date();
  const due = db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .innerJoin(channels, eq(channels.id, scheduledPosts.channelId))
    .where(dueCondition(now))
    .all().length;
  const next = db
    .select({ at: scheduledPosts.scheduledAt })
    .from(scheduledPosts)
    .where(eq(scheduledPosts.status, "queued"))
    .orderBy(asc(scheduledPosts.scheduledAt))
    .get();
  return {
    enabled: publishEnabled(),
    running: current ? { postId: current.postId, stage: current.stage } : null,
    due,
    nextAt: next?.at ?? null,
    lastRunAt,
    processed,
  };
}

let ticking = false;

async function tick() {
  if (ticking || !timer || !publishEnabled()) return;
  ticking = true;
  try {
    for (;;) {
      if (!timer || !publishEnabled()) break;
      const now = new Date();
      const next = getDb()
        .select({ id: scheduledPosts.id })
        .from(scheduledPosts)
        .innerJoin(channels, eq(channels.id, scheduledPosts.channelId))
        .where(dueCondition(now))
        .orderBy(asc(scheduledPosts.scheduledAt))
        .get();
      if (!next) break;
      await publishOne(next.id);
    }
  } catch (err) {
    console.error("[publish] worker lỗi", err);
  } finally {
    ticking = false;
    lastRunAt = new Date();
  }
}

async function publishOne(postId) {
  const db = getDb();
  const post = db
    .update(scheduledPosts)
    .set({ status: "publishing", error: null, updatedAt: new Date() })
    .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "queued")))
    .returning()
    .get();
  if (!post) return;
  const channel = db.select().from(channels).where(eq(channels.id, post.channelId)).get();
  const content = db.select().from(contentItems).where(eq(contentItems.id, post.contentItemId)).get();
  const ctl = new AbortController();
  current = { postId, stage: "Chuẩn bị", ctl };
  const tag = `${postId.slice(0, 8)} → ${channel?.name ?? "?"}`;
  console.info(`[publish] bắt đầu ${tag} (lần ${post.attempts + 1})`);
  const started = Date.now();
  try {
    if (!channel || !content) throw new PublishError("permanent", "Kênh hoặc nội dung đã bị xóa");
    let cred = readCred(channel.id);
    if (!cred) throw new PublishError("auth", "Kênh chưa kết nối API – nhập token trong Tài khoản & Kênh");
    const ctx = { cred, content, signal: ctl.signal, stage: (s) => current && (current.stage = s) };
    let out;
    if (channel.platform === "facebook") out = await publishFacebook(ctx);
    else if (channel.platform === "instagram") out = await publishInstagram(ctx);
    else if (channel.platform === "youtube") {
      cred = await freshYoutubeCred(channel.id, cred, ctl.signal);
      out = await publishYouTube({ ...ctx, cred });
    } else {
      cred = await freshTikTokCred(channel.id, cred, ctl.signal);
      out = await publishTikTok({ ...ctx, cred });
    }
    const first = content.firstComment?.trim();
    if (first) {
      if (channel.platform === "youtube") {
        try {
          current && (current.stage = "Đăng bình luận đầu tiên");
          await youtubeTopComment(out.externalId, first, cred.token, ctl.signal);
        } catch (err) {
          out.note = [out.note, `Bình luận đầu tiên lỗi: ${err instanceof Error ? err.message : String(err)}`]
            .filter(Boolean)
            .join(". ");
        }
      } else if (channel.platform === "tiktok") {
        out.note = [out.note, "TikTok không có API bình luận – chưa đăng bình luận đầu tiên"]
          .filter(Boolean)
          .join(". ");
      } else {
        try {
          current && (current.stage = "Đăng bình luận đầu tiên");
          await graph("POST", `${out.externalId}/comments`, {
            token: cred.token,
            signal: ctl.signal,
            form: { message: first },
          });
        } catch (err) {
          out.note = [out.note, `Bình luận đầu tiên lỗi: ${err instanceof Error ? err.message : String(err)}`]
            .filter(Boolean)
            .join(". ");
        }
      }
    }
    db.transaction((tx) => {
      tx.update(scheduledPosts)
        .set({
          status: "published",
          publishedAt: new Date(),
          externalPostId: out.externalId,
          permalink: out.permalink,
          note: out.note ?? null,
          error: null,
          nextAttemptAt: null,
          attempts: post.attempts + 1,
          updatedAt: new Date(),
        })
        .where(eq(scheduledPosts.id, postId))
        .run();
      const pending = tx
        .select({ id: scheduledPosts.id })
        .from(scheduledPosts)
        .where(
          and(eq(scheduledPosts.contentItemId, content.id), inArray(scheduledPosts.status, ["queued", "publishing"])),
        )
        .get();
      if (!pending)
        tx.update(contentItems)
          .set({ status: "published", updatedAt: new Date() })
          .where(eq(contentItems.id, content.id))
          .run();
      tx.update(channels).set({ health: "ok", updatedAt: new Date() }).where(eq(channels.id, channel.id)).run();
      tx.insert(activityLog)
        .values({
          level: "ok",
          scope: "publish",
          message: `Đã đăng "${content.title.slice(0, 60)}" lên ${channel.name}`,
        })
        .run();
    });
    console.info(
      `[publish] xong ${tag} · id ${out.externalId} · ${Math.round((Date.now() - started) / 1e3)}s${out.note ? ` · ${out.note}` : ""}`,
    );
  } catch (err) {
    if (ctl.signal.aborted) {
      return;
    }
    const e =
      err instanceof PublishError
        ? err
        : new PublishError("transient", err instanceof Error ? err.message : String(err));
    const attempts = post.attempts + 1;
    const retry = (e.kind === "transient" || e.kind === "rate_limit") && attempts < MAX_ATTEMPTS;
    const delayMin = RETRY_DELAYS_MIN[attempts - 1] ?? 30;
    console.warn(`[publish] lỗi ${tag} (${e.kind}): ${e.message}${retry ? ` → thử lại sau ${delayMin} phút` : ""}`);
    db.transaction((tx) => {
      tx.update(scheduledPosts)
        .set(
          retry
            ? {
                status: "queued",
                attempts,
                error: `${e.message} – sẽ thử lại lúc ${new Date(Date.now() + delayMin * 6e4).toLocaleTimeString(
                  "vi-VN",
                  { hour: "2-digit", minute: "2-digit" },
                )}`,
                nextAttemptAt: new Date(Date.now() + delayMin * 6e4),
                updatedAt: new Date(),
              }
            : { status: "failed", attempts, error: e.message, nextAttemptAt: null, updatedAt: new Date() },
        )
        .where(eq(scheduledPosts.id, postId))
        .run();
      if (retry) return;
      if (content) {
        const alive = tx
          .select({ id: scheduledPosts.id })
          .from(scheduledPosts)
          .where(
            and(
              eq(scheduledPosts.contentItemId, content.id),
              inArray(scheduledPosts.status, ["queued", "publishing", "published"]),
            ),
          )
          .get();
        if (!alive)
          tx.update(contentItems)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(contentItems.id, content.id))
            .run();
      }
      if (channel && e.kind === "auth") {
        tx.update(channels)
          .set({ tokenStatus: readCred(channel.id) ? "expired" : "missing", health: "error", updatedAt: new Date() })
          .where(eq(channels.id, channel.id))
          .run();
        tx.insert(alerts)
          .values({
            id: newId(),
            severity: "error",
            kind: "token_invalid",
            entityType: "channel",
            entityId: channel.id,
            title: `Token kênh ${channel.name} không dùng được`,
            message: e.message.slice(0, 300),
          })
          .run();
      }
      tx.insert(alerts)
        .values({
          id: newId(),
          severity: "error",
          kind: "publish_failed",
          entityType: "post",
          entityId: postId,
          title: `Đăng bài lên ${channel?.name ?? "kênh"} thất bại`,
          message: e.message.slice(0, 300),
        })
        .run();
      tx.insert(activityLog)
        .values({
          level: "error",
          scope: "publish",
          message: `Đăng lỗi (${channel?.name ?? "?"}): ${e.message.slice(0, 120)}`,
        })
        .run();
    });
  } finally {
    current = null;
    processed++;
  }
}

export function publishNow(postId) {
  const db = getDb();
  const res = db
    .update(scheduledPosts)
    .set({ status: "queued", scheduledAt: new Date(), nextAttemptAt: null, error: null, updatedAt: new Date() })
    .where(and(eq(scheduledPosts.id, postId), inArray(scheduledPosts.status, ["queued", "failed"])))
    .returning({ contentItemId: scheduledPosts.contentItemId })
    .get();
  if (!res) throw new Error("Chỉ đăng ngay được bài đang chờ hoặc bị lỗi");
  db.update(contentItems)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(and(eq(contentItems.id, res.contentItemId), eq(contentItems.status, "failed")))
    .run();
  if (publishEnabled()) kickPublisher();
  else if (!current) void publishOne(postId).catch((err) => console.error("[publish] đăng ngay lỗi", err));
}
