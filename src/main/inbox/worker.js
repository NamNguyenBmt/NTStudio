import { applyRules } from "./rules";
import { aiSettings, quickEngagement, setAiKick, clearAiQueue, enqueueAi, draftCount } from "./ai-reply";
import { syncChannel } from "./sync";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq, and, ne, or, isNull, lte, asc } from "drizzle-orm";
import { channels, conversations, messages, autoReplyRules, alerts, activityLog, settings } from "../db/schema";
import { getDb, newId } from "../db/index";
import { mediaDir } from "../media/paths";
import { attachmentKind } from "../../shared/video";
import { PublishError, graph, fileForm } from "../publish/http";
import { readCred, markChannel } from "../publish/credentials";
import { freshYoutubeCred, youtubeReply, youtubeHoldComment } from "../publish/youtube";

const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  pdf: "application/pdf",
};

const mimeOf = (f) => MIME[f.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
const OUTBOX_MS = 5e3;
const TICK_MS = 5e3;
const MESSAGES_ACTIVE_MS = 15e3;
const MESSAGES_IDLE_MS = 6e4;
const FULL_EVERY_MS = 2 * 6e4;
const BACKOFF_MS = 15 * 6e4;
const RETRY_MIN = [1, 5];
let outboxTimer = null;
let syncTimer = null;
let lastAnySync = 0;
let lastFullSync = 0;
let backoffUntil = 0;
let onChange = null;
let isActive = () => true;

export function bindInboxEvents(opts) {
  onChange = opts.onChange;
  isActive = opts.isActive;
}

let sending = false;
let syncing = null;
let lastSync = null;
let version = 0;
let ctl = new AbortController();

function autoSyncEnabled() {
  return getDb().select().from(settings).where(eq(settings.key, "inbox.autoSync")).get()?.value !== false;
}

export function setAutoSync(enabled) {
  getDb()
    .insert(settings)
    .values({ key: "inbox.autoSync", value: enabled })
    .onConflictDoUpdate({ target: settings.key, set: { value: enabled, updatedAt: new Date() } })
    .run();
}

export function inboxWorkerStatus() {
  const pending = getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.deliveryStatus, "pending"))
    .all().length;
  return { autoSync: autoSyncEnabled(), syncing: syncing != null, lastSync, pending, drafts: draftCount(), version };
}

export function startInbox() {
  setAiKick(() => {
    version++;
    kickOutbox();
  });
  ctl = new AbortController();
  lastSync = null;
  sending = false;
  outboxTimer = setInterval(() => void flushOutbox(), OUTBOX_MS);
  lastAnySync = lastFullSync = backoffUntil = 0;
  const startedAt = Date.now();
  syncTimer = setInterval(() => {
    if (syncing || Date.now() - startedAt < 8e3 || !autoSyncEnabled()) return;
    const now = Date.now();
    const backoff = now < backoffUntil;
    const every = backoff ? FULL_EVERY_MS : isActive() ? MESSAGES_ACTIVE_MS : MESSAGES_IDLE_MS;
    if (now - lastAnySync < every) return;
    const full = now - lastFullSync >= FULL_EVERY_MS;
    void syncAll(void 0, full ? "all" : "messages").catch(() => void 0);
  }, TICK_MS);
}

export function stopInbox() {
  if (outboxTimer) clearInterval(outboxTimer);
  if (syncTimer) clearInterval(syncTimer);
  outboxTimer = syncTimer = null;
  ctl.abort();
  lastSync = null;
  clearAiQueue();
  setAiKick(null);
}

export function kickOutbox() {
  setTimeout(() => void flushOutbox(), 50);
}

export function syncAll(channelId, scope = "all") {
  if (syncing) return syncing;
  syncing = (async () => {
    const started = Date.now();
    lastAnySync = started;
    if (scope === "all") lastFullSync = started;
    const changedChannels = [];
    let rateLimited = false;
    const db = getDb();
    const list = db
      .select()
      .from(channels)
      .where(
        and(
          ne(channels.tokenStatus, "missing"),
          ne(channels.platform, "tiktok"),
          channelId ? eq(channels.id, channelId) : void 0,
        ),
      )
      .all();
    const result = { at: new Date(), channels: 0, newMessages: 0, autoActions: 0, errors: [], durationMs: 0 };
    for (const ch of list) {
      if (ctl.signal.aborted) break;
      try {
        const {
          added,
          errors,
          rateLimited: limited,
        } = await syncChannel(ch, AbortSignal.any([ctl.signal, AbortSignal.timeout(6e4)]), scope);
        result.channels++;
        result.newMessages += added.length;
        if (added.length) changedChannels.push(ch.name);
        if (limited) rateLimited = true;
        result.autoActions += applyRules(added);
        const cfg = aiSettings();
        result.autoActions += quickEngagement(added, cfg);
        enqueueAi(added, cfg);
        for (const e of errors) result.errors.push(`${ch.name} – ${e}`);
        if (errors.some((e) => /mã 190/.test(e))) markChannel(ch.id, { tokenStatus: "expired", health: "error" });
      } catch (err) {
        result.errors.push(`${ch.name} – ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    result.durationMs = Date.now() - started;
    if (result.channels && (scope === "all" || result.newMessages || result.errors.length)) {
      console.info(
        `[inbox] đồng bộ ${scope === "all" ? "" : "tin nhắn "}${result.channels} kênh · ${result.newMessages} tin mới · ${result.autoActions} hành động tự động · ${result.errors.length} lỗi · ${result.durationMs}ms`,
      );
    }
    for (const e of result.errors) console.warn("[inbox]", e);
    if (rateLimited && Date.now() >= backoffUntil) {
      backoffUntil = Date.now() + BACKOFF_MS;
      console.warn("[inbox] Facebook báo vượt giới hạn tần suất → giãn nhịp đồng bộ về 2 phút trong 15 phút");
    }
    if (result.newMessages) onChange?.({ newMessages: result.newMessages, channels: changedChannels });
    lastSync = result;
    version++;
    if (result.autoActions) kickOutbox();
    return result;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

function explain(err) {
  const m = err.message;
  if (/2018278|2534022|outside of allowed window|10\/2018/.test(m))
    return new PublishError(
      "permanent",
      "Ngoài cửa sổ 24 giờ – Meta chỉ cho nhắn trong 24 giờ kể từ tin cuối của khách",
    );
  if (/1446036|already been replied|private repl/i.test(m))
    return new PublishError(
      "permanent",
      "Bình luận này đã được nhắn riêng hoặc quá 7 ngày – không gửi private reply được nữa",
    );
  if (/mã 10\b|mã 200|permission/i.test(m))
    return new PublishError(
      "permanent",
      `Token thiếu quyền nhắn tin/quản lý bình luận (pages_messaging, pages_manage_engagement, instagram_manage_messages, instagram_manage_comments) – ${m}`,
    );
  return err;
}

async function deliver(msg, conv, ch) {
  if (ch.platform === "youtube") {
    if (msg.action === "like") throw new PublishError("permanent", "YouTube API không hỗ trợ thích bình luận");
    const yc = readCred(ch.id);
    if (!yc) throw new PublishError("auth", "Kênh YouTube chưa kết nối");
    const fresh = await freshYoutubeCred(ch.id, yc, AbortSignal.any([ctl.signal, AbortSignal.timeout(45e3)]));
    const signal2 = AbortSignal.any([ctl.signal, AbortSignal.timeout(45e3)]);
    const target = msg.targetId ?? conv.externalId;
    if (!target) throw new PublishError("permanent", "Không có bình luận để trả lời");
    if (msg.action === "hide") {
      await youtubeHoldComment(target, fresh.token, signal2);
      return null;
    }
    if (msg.attachments.length) throw new PublishError("permanent", "Bình luận YouTube không đính kèm được tệp");
    return youtubeReply(conv.externalId ?? target, msg.body, fresh.token, signal2);
  }
  if (ch.platform === "tiktok")
    throw new PublishError(
      "permanent",
      "TikTok không có API nhắn tin / trả lời bình luận công khai – hãy trả lời trong ứng dụng TikTok",
    );
  if (!conv.externalId)
    throw new PublishError(
      "permanent",
      "Hội thoại không liên kết với nền tảng (dữ liệu mẫu hoặc tạo tay) – không gửi được",
    );
  const cred = readCred(ch.id);
  if (!cred?.pageId) throw new PublishError("auth", "Kênh chưa kết nối API – nhập token trong Tài khoản & Kênh");
  const token = cred.token;
  const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(45e3)]);
  const ig = ch.platform === "instagram";
  if (msg.action === "like") {
    if (ig || !msg.targetId) throw new PublishError("permanent", "Chỉ Facebook cho phép Page thích bình luận qua API");
    await graph("POST", `${msg.targetId}/likes`, { token, signal });
    return null;
  }
  if (msg.action === "hide") {
    if (!msg.targetId) throw new PublishError("permanent", "Thiếu bình luận cần ẩn");
    await graph("POST", msg.targetId, { token, signal, form: ig ? { hide: true } : { is_hidden: true } });
    return null;
  }
  const local = msg.attachments.filter((a) => !/^https?:/.test(a));
  for (const a of local)
    if (!existsSync(join(mediaDir(), a)))
      throw new PublishError("permanent", "Không tìm thấy tệp đính kèm trên máy – chọn lại tệp");
  if (local.length && ig)
    throw new PublishError(
      "permanent",
      "Instagram API chỉ gửi được tệp qua đường dẫn công khai – hãy gửi ảnh/tệp trong ứng dụng Instagram",
    );
  if (local.length && conv.source === "comment") {
    if (local.length > 1 || attachmentKind(local[0]) !== "image")
      throw new PublishError("permanent", "Trả lời bình luận Facebook chỉ đính kèm được 1 ảnh");
    const target = msg.targetId ?? conv.externalId;
    const fd = await fileForm(
      msg.body.trim() ? { message: msg.body } : {},
      "source",
      join(mediaDir(), local[0]),
      mimeOf(local[0]),
    );
    const r2 = await graph("POST", `${target}/comments`, { token, signal, multipart: fd, timeoutMs: 12e4 });
    return r2.id ?? null;
  }
  if (local.length) {
    if (!conv.customerExternalId)
      throw new PublishError("permanent", "Không có ID người nhận của khách trong hội thoại");
    let lastId = null;
    for (const a of local) {
      const fd = await fileForm(
        {
          recipient: JSON.stringify({ id: conv.customerExternalId }),
          messaging_type: "RESPONSE",
          message: JSON.stringify({ attachment: { type: attachmentKind(a), payload: { is_reusable: false } } }),
        },
        "filedata",
        join(mediaDir(), a),
        mimeOf(a),
      );
      const r2 = await graph("POST", `${cred.pageId}/messages`, { token, signal, multipart: fd, timeoutMs: 12e4 });
      lastId = r2.message_id ?? lastId;
    }
    if (!msg.body.trim()) return lastId;
  }
  if (conv.source === "comment") {
    const privateReply = msg.author === "bot" && !!msg.targetId && !!msg.ruleId && ruleAction(msg.ruleId) === "send_dm";
    if (privateReply) {
      const r3 = await graph("POST", `${cred.pageId}/messages`, {
        token,
        signal,
        form: { recipient: JSON.stringify({ comment_id: msg.targetId }), message: JSON.stringify({ text: msg.body }) },
      });
      return r3.message_id ?? null;
    }
    const target = msg.targetId ?? conv.externalId;
    const r2 = await graph("POST", ig ? `${target}/replies` : `${target}/comments`, {
      token,
      signal,
      form: { message: msg.body },
    });
    return r2.id ?? null;
  }
  if (!conv.customerExternalId) throw new PublishError("permanent", "Không có ID người nhận của khách trong hội thoại");
  const r = await graph("POST", `${cred.pageId}/messages`, {
    token,
    signal,
    form: {
      recipient: JSON.stringify({ id: conv.customerExternalId }),
      messaging_type: "RESPONSE",
      message: JSON.stringify({ text: msg.body }),
    },
  });
  return r.message_id ?? null;
}

function ruleAction(ruleId) {
  return (
    getDb().select({ action: autoReplyRules.action }).from(autoReplyRules).where(eq(autoReplyRules.id, ruleId)).get()
      ?.action ?? ""
  );
}

async function flushOutbox() {
  if (sending) return;
  sending = true;
  try {
    const db = getDb();
    for (;;) {
      const now = new Date();
      const msg = db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.deliveryStatus, "pending"),
            eq(messages.direction, "out"),
            or(isNull(messages.sendAfter), lte(messages.sendAfter, now)),
          ),
        )
        .orderBy(asc(messages.createdAt))
        .get();
      if (!msg) break;
      const conv = db.select().from(conversations).where(eq(conversations.id, msg.conversationId)).get();
      const ch = conv ? db.select().from(channels).where(eq(channels.id, conv.channelId)).get() : void 0;
      const attempts = msg.attempts + 1;
      try {
        if (!conv || !ch) throw new PublishError("permanent", "Hội thoại hoặc kênh đã bị xóa");
        const externalId = await deliver(msg, conv, ch);
        db.update(messages)
          .set({
            deliveryStatus: "sent",
            externalId: externalId ?? msg.externalId,
            attempts,
            error: null,
            sendAfter: null,
          })
          .where(eq(messages.id, msg.id))
          .run();
        console.info(
          `[inbox] đã gửi ${msg.action === "hide" ? "lệnh ẩn bình luận" : msg.author === "bot" ? "trả lời tự động" : "tin nhắn"} (${ch.name})`,
        );
      } catch (err) {
        if (ctl.signal.aborted) break;
        const e = explain(
          err instanceof PublishError
            ? err
            : new PublishError("transient", err instanceof Error ? err.message : String(err)),
        );
        const retry = (e.kind === "transient" || e.kind === "rate_limit") && attempts <= RETRY_MIN.length;
        db.update(messages)
          .set(
            retry
              ? {
                  attempts,
                  error: `${e.message} – đang thử lại`,
                  sendAfter: new Date(Date.now() + RETRY_MIN[attempts - 1] * 6e4),
                }
              : { deliveryStatus: "failed", attempts, error: e.message, sendAfter: null },
          )
          .where(eq(messages.id, msg.id))
          .run();
        console.warn(`[inbox] gửi lỗi (${ch?.name ?? "?"}, ${e.kind}): ${e.message}${retry ? " → thử lại" : ""}`);
        if (!retry && ch && /mã 190/.test(e.message)) {
          markChannel(ch.id, { tokenStatus: "expired", health: "error" });
          db.insert(alerts)
            .values({
              id: newId(),
              severity: "error",
              kind: "token_invalid",
              entityType: "channel",
              entityId: ch.id,
              title: `Token kênh ${ch.name} không dùng được`,
              message: e.message.slice(0, 300),
            })
            .run();
        }
        if (!retry && msg.author === "bot")
          db.insert(activityLog)
            .values({
              level: "warn",
              scope: "inbox",
              message: `Bot không gửi được (${ch?.name ?? "?"}): ${e.message.slice(0, 100)}`,
            })
            .run();
      }
      version++;
    }
  } catch (err) {
    console.error("[inbox] outbox lỗi", err);
  } finally {
    sending = false;
  }
}

export function resend(messageId) {
  const res = getDb()
    .update(messages)
    .set({ deliveryStatus: "pending", error: null, sendAfter: null, attempts: 0 })
    .where(and(eq(messages.id, messageId), eq(messages.deliveryStatus, "failed")))
    .run();
  if (res.changes) kickOutbox();
  return res.changes > 0;
}
