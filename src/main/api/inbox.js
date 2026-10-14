import { BrowserWindow, dialog } from "electron";
import { mkdirSync, statSync, copyFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { count, eq, and, gt, desc, asc, or, isNull, inArray } from "drizzle-orm";
import { channels, conversations, messages, quickReplies, autoReplyRules } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError, notFound } from "../errors";
import { mediaDir } from "../media/paths";
import { aiSettings, saveAiSettings, approveDraft, discardDraft } from "../inbox/ai-reply";
import { setAutoSync, inboxWorkerStatus, kickOutbox, syncAll, resend } from "../inbox/worker";
import { byWorkspace } from "./accounts";

function draftsByConversation() {
  const rows = getDb()
    .select({ conversationId: messages.conversationId, n: count() })
    .from(messages)
    .where(eq(messages.deliveryStatus, "draft"))
    .groupBy(messages.conversationId)
    .all();
  return new Map(rows.map((r) => [r.conversationId, r.n]));
}

export const inboxHandlers = {
  "inbox.conversations": ({ workspaceId, platform, unreadOnly }) =>
    getDb()
      .select({ conversation: conversations, channelName: channels.name })
      .from(conversations)
      .innerJoin(channels, eq(channels.id, conversations.channelId))
      .where(
        and(
          byWorkspace(conversations.workspaceId, workspaceId),
          platform ? eq(conversations.platform, platform) : void 0,
          unreadOnly ? gt(conversations.unreadCount, 0) : void 0,
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .all()
      .map((r) => ({
        ...r.conversation,
        channelName: r.channelName,
        drafts: draftsByConversation().get(r.conversation.id) ?? 0,
      })),
  "inbox.messages": ({ conversationId }) =>
    getDb()
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .all(),
  "inbox.markRead": ({ conversationId }) => {
    const res = getDb()
      .update(conversations)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();
    if (res.changes === 0) throw notFound("hội thoại");
  },
  // Mẫu trả lời chung (workspace = null) + mẫu riêng của workspace
  "inbox.quickReplies": ({ workspaceId }) =>
    getDb()
      .select()
      .from(quickReplies)
      .where(workspaceId ? or(isNull(quickReplies.workspaceId), eq(quickReplies.workspaceId, workspaceId)) : void 0)
      .orderBy(asc(quickReplies.shortcut))
      .all(),
  "inbox.stats": ({ workspaceId }) => {
    const db = getDb();
    const ws = byWorkspace(conversations.workspaceId, workspaceId);
    const rows = db
      .select({ platform: conversations.platform, unread: conversations.unreadCount })
      .from(conversations)
      .where(ws)
      .all();
    const byPlatform = { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 };
    for (const r of rows) byPlatform[r.platform]++;
    const convIds = db
      .select({ id: conversations.id })
      .from(conversations)
      .where(ws)
      .all()
      .map((c) => c.id);
    const msgs = convIds.length
      ? db
          .select({
            conversationId: messages.conversationId,
            direction: messages.direction,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(inArray(messages.conversationId, convIds))
          .orderBy(asc(messages.conversationId), asc(messages.createdAt))
          .all()
      : [];
    const waits = [];
    let pendingIn = null;
    for (const m of msgs) {
      if (m.direction === "in") {
        if (!pendingIn || pendingIn.conv !== m.conversationId)
          pendingIn = { conv: m.conversationId, at: m.createdAt.getTime() };
      } else if (pendingIn && pendingIn.conv === m.conversationId) {
        waits.push((m.createdAt.getTime() - pendingIn.at) / 1e3);
        pendingIn = null;
      }
    }
    const rules = db
      .select({ n: count() })
      .from(autoReplyRules)
      .where(and(eq(autoReplyRules.enabled, true), byWorkspace(autoReplyRules.workspaceId, workspaceId)))
      .get();
    return {
      total: rows.length,
      unread: rows.filter((r) => r.unread > 0).length,
      byPlatform,
      avgResponseSec: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      enabledRules: rules?.n ?? 0,
    };
  },
  "inbox.pickAttachments": async ({ images, multiple }) => {
    const opts = {
      title: images ? "Chọn ảnh gửi kèm" : "Chọn tệp gửi kèm",
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: images
        ? [{ name: "Ảnh", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }]
        : [{ name: "Tất cả tệp", extensions: ["*"] }],
    };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled) return [];
    const dir = join(mediaDir(), "inbox");
    mkdirSync(dir, { recursive: true });
    return res.filePaths.slice(0, 5).map((src) => {
      const size = statSync(src).size;
      if (size > 25 * 1024 * 1024)
        throw new ApiError("VALIDATION", `${basename(src)} lớn hơn 25 MB – Messenger không nhận`);
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${extname(src)
        .toLowerCase()
        .replace(/[^.\w]/g, "")}`;
      copyFileSync(src, join(dir, name));
      return { path: `inbox/${name}`, name: basename(src), size };
    });
  },
  "inbox.send": ({ conversationId, body, attachments }) => {
    const db = getDb();
    for (const a of attachments)
      if (!/^inbox\/[\w.-]+$/.test(a) || !existsSync(join(mediaDir(), a)))
        throw new ApiError("VALIDATION", "Tệp đính kèm không hợp lệ – chọn lại tệp");
    const preview = body || `[${attachments.length} tệp đính kèm]`;
    return db.transaction((tx) => {
      const conv = tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get();
      if (!conv) throw notFound("hội thoại");
      const now = new Date();
      const msg = tx
        .insert(messages)
        .values({
          id: newId(),
          conversationId,
          direction: "out",
          author: "agent",
          body,
          attachments,
          deliveryStatus: "pending",
          createdAt: now,
        })
        .returning()
        .get();
      tx.update(conversations)
        .set({ lastMessageAt: now, lastMessagePreview: preview.slice(0, 140), unreadCount: 0, updatedAt: now })
        .where(eq(conversations.id, conversationId))
        .run();
      kickOutbox();
      return msg;
    });
  },
  "inbox.update": ({ conversationId, tags, status }) => {
    const res = getDb()
      .update(conversations)
      .set({ ...(tags ? { tags: [...new Set(tags)] } : {}), ...(status ? { status } : {}), updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();
    if (res.changes === 0) throw notFound("hội thoại");
  },
  "inbox.rules": ({ workspaceId }) =>
    getDb()
      .select()
      .from(autoReplyRules)
      .where(workspaceId ? or(isNull(autoReplyRules.workspaceId), eq(autoReplyRules.workspaceId, workspaceId)) : void 0)
      .orderBy(asc(autoReplyRules.createdAt))
      .all(),
  "inbox.toggleRule": ({ id, enabled }) => {
    const res = getDb()
      .update(autoReplyRules)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(autoReplyRules.id, id))
      .run();
    if (res.changes === 0) throw notFound("luật tự động");
  },
  "inbox.saveRule": ({ id, ...input }) => {
    if (input.maxDelaySec < input.minDelaySec)
      throw new ApiError("VALIDATION", "Độ trễ tối đa phải ≥ độ trễ tối thiểu");
    if (input.action !== "hide_comment" && !input.template?.trim())
      throw new ApiError("VALIDATION", "Luật trả lời cần nội dung mẫu");
    const db = getDb();
    const ch = input.channelId
      ? db.select({ workspaceId: channels.workspaceId }).from(channels).where(eq(channels.id, input.channelId)).get()
      : void 0;
    if (input.channelId && !ch) throw notFound("kênh");
    const values = {
      ...input,
      keywords: [...new Set(input.keywords)],
      workspaceId: ch ? ch.workspaceId : (input.workspaceId ?? null),
      channelId: input.channelId ?? null,
      template: input.action === "hide_comment" ? null : (input.template ?? null),
    };
    if (!id)
      return db
        .insert(autoReplyRules)
        .values({ id: newId(), ...values })
        .returning()
        .get();
    const row = db
      .update(autoReplyRules)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(autoReplyRules.id, id))
      .returning()
      .get();
    if (!row) throw notFound("luật tự động");
    return row;
  },
  "inbox.deleteRule": ({ id }) => {
    const res = getDb().delete(autoReplyRules).where(eq(autoReplyRules.id, id)).run();
    if (res.changes === 0) throw notFound("luật tự động");
  },
  "inbox.sync": ({ channelId }) => syncAll(channelId),
  "inbox.worker": () => inboxWorkerStatus(),
  "inbox.setAutoSync": ({ enabled }) => {
    setAutoSync(enabled);
    return inboxWorkerStatus();
  },
  "inbox.aiSettings": () => aiSettings(),
  "inbox.setAiSettings": (patch) => saveAiSettings(patch),
  "inbox.approveDraft": ({ id, body }) => {
    if (!approveDraft(id, body)) throw new ApiError("CONFLICT", "Câu trả lời không còn ở hàng chờ duyệt");
    kickOutbox();
  },
  "inbox.discardDraft": ({ id }) => {
    if (!discardDraft(id)) throw new ApiError("CONFLICT", "Câu trả lời không còn ở hàng chờ duyệt");
  },
  "inbox.resend": ({ id }) => {
    if (!resend(id)) throw new ApiError("CONFLICT", "Chỉ gửi lại được tin bị lỗi");
  },
};
