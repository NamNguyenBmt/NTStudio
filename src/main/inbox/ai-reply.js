import { decideReply } from "../ai/captions";
import { eq, and, or, isNull, inArray, gte, gt, asc } from "drizzle-orm";
import { workspaces, channels, conversations, messages, quickReplies, settings } from "../db/schema";
import { getDb, newId } from "../db/index";
import { AiError } from "../ai/providers";

const FRESH_MS = 30 * 6e4;
const AI_RULE_ID = "ai";
const LEAD_TAG = "Khách tiềm năng";
const PHONE_TAG = "Có SĐT";
const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/;

const DEFAULT_AI_SETTINGS = {
  mode: "off",
  comments: true,
  messages: true,
  minConfidence: 0.8,
  minDelaySec: 20,
  maxDelaySec: 90,
  maxPerHour: 30,
  autoLike: false,
  tagLeads: true,
};

export function aiSettings() {
  const v = getDb().select().from(settings).where(eq(settings.key, "inbox.ai")).get()?.value;
  return { ...DEFAULT_AI_SETTINGS, ...(v ?? {}) };
}

export function saveAiSettings(patch) {
  const next = { ...aiSettings(), ...patch };
  if (next.maxDelaySec < next.minDelaySec) next.maxDelaySec = next.minDelaySec;
  getDb()
    .insert(settings)
    .values({ key: "inbox.ai", value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } })
    .run();
  if (patch.autoLike === false)
    getDb()
      .delete(messages)
      .where(and(eq(messages.action, "like"), eq(messages.deliveryStatus, "pending")))
      .run();
  return next;
}

const between = (lo, hi) => lo + Math.random() * Math.max(0, hi - lo);

function addTags(conversationId, tags) {
  const db = getDb();
  const c = db
    .select({ tags: conversations.tags })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();
  if (!c) return;
  const next = [...new Set([...c.tags, ...tags])];
  if (next.length !== c.tags.length)
    db.update(conversations)
      .set({ tags: next, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();
}

function removeTags(conversationId, tags) {
  const db = getDb();
  const c = db
    .select({ tags: conversations.tags })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();
  if (!c) return;
  const next = c.tags.filter((t) => !tags.includes(t));
  if (next.length !== c.tags.length)
    db.update(conversations)
      .set({ tags: next, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();
}

export function quickEngagement(items, cfg = aiSettings()) {
  const db = getDb();
  let queued = 0;
  for (const { conversation: conv, message: msg } of items) {
    if (Date.now() - msg.createdAt.getTime() > FRESH_MS) continue;
    if (cfg.tagLeads && PHONE.test(msg.body)) addTags(conv.id, [LEAD_TAG, PHONE_TAG]);
    if (cfg.autoLike && conv.platform === "facebook" && conv.source === "comment" && msg.externalId) {
      db.insert(messages)
        .values({
          id: newId(),
          conversationId: conv.id,
          direction: "out",
          author: "system",
          body: "Page đã thích bình luận",
          action: "like",
          targetId: msg.externalId,
          deliveryStatus: "pending",
          sendAfter: new Date(Date.now() + between(5, 40) * 1e3),
        })
        .run();
      queued++;
    }
  }
  return queued;
}

const queue = [];
let working = false;
let onQueued = null;

export function setAiKick(fn) {
  onQueued = fn;
}

export function clearAiQueue() {
  queue.length = 0;
}

export function enqueueAi(items, cfg = aiSettings()) {
  if (cfg.mode === "off") return 0;
  let n = 0;
  for (const { conversation: conv, message: msg } of items) {
    if (conv.platform === "tiktok") continue;
    if (Date.now() - msg.createdAt.getTime() > FRESH_MS) continue;
    if (conv.source === "comment" ? !cfg.comments : !cfg.messages) continue;
    const dup = queue.findIndex((q) => q.conversationId === conv.id);
    if (dup >= 0) queue.splice(dup, 1);
    queue.push({ conversationId: conv.id, messageId: msg.id });
    n++;
  }
  if (n) void work();
  return n;
}

async function work() {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        await handle(job.conversationId, job.messageId);
      } catch (err) {
        if (err instanceof AiError && (err.kind === "budget" || err.kind === "quota" || err.kind === "no_provider")) {
          console.warn(`[inbox-ai] dừng: ${err.message}`);
          queue.length = 0;
          break;
        }
        console.warn(`[inbox-ai] lỗi soạn trả lời: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    working = false;
  }
}

function knowledgeOf(workspaceId) {
  const db = getDb();
  const ws = workspaceId
    ? db
        .select({ knowledge: workspaces.knowledge, brandVoice: workspaces.brandVoice })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .get()
    : void 0;
  const quick = db
    .select({ body: quickReplies.body })
    .from(quickReplies)
    .where(
      workspaceId
        ? or(isNull(quickReplies.workspaceId), eq(quickReplies.workspaceId, workspaceId))
        : isNull(quickReplies.workspaceId),
    )
    .all();
  const text = [ws?.knowledge?.trim(), ...quick.map((q) => `- ${q.body}`)].filter(Boolean).join("\n");
  return { text, brandVoice: ws?.brandVoice ?? null };
}

async function handle(conversationId, messageId) {
  const db = getDb();
  const cfg = aiSettings();
  if (cfg.mode === "off") return;
  const conv = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  const msg = db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!conv || !msg) return;
  const handled = db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conv.id),
        eq(messages.direction, "out"),
        inArray(messages.action, ["message", "hide"]),
        gte(messages.createdAt, msg.createdAt),
      ),
    )
    .get();
  if (handled) return;
  const newer = db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(eq(messages.conversationId, conv.id), eq(messages.direction, "in"), gt(messages.createdAt, msg.createdAt)),
    )
    .get();
  if (newer) return;
  const history = db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conv.id),
        inArray(messages.action, ["message"]),
        or(isNull(messages.deliveryStatus), inArray(messages.deliveryStatus, ["sent", "pending"])),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .all();
  const { text: knowledge, brandVoice } = knowledgeOf(conv.workspaceId);
  const { decision, meta } = await decideReply({
    customerName: conv.customerName,
    channelName:
      db.select({ name: channels.name }).from(channels).where(eq(channels.id, conv.channelId)).get()?.name ??
      "cửa hàng",
    source: conv.source,
    contextPostTitle: conv.contextPostTitle,
    history,
    knowledge,
    brandVoice,
    workspaceId: conv.workspaceId,
  });
  if (cfg.tagLeads && decision.lead) addTags(conv.id, [LEAD_TAG]);
  if (decision.intent === "spam") {
    removeTags(conv.id, [LEAD_TAG, PHONE_TAG]);
    if (msg.externalId) {
      db.delete(messages)
        .where(
          and(
            eq(messages.conversationId, conv.id),
            eq(messages.action, "like"),
            eq(messages.targetId, msg.externalId),
            eq(messages.deliveryStatus, "pending"),
          ),
        )
        .run();
    }
  }
  if (decision.intent === "spam" || !decision.reply.trim()) {
    console.info(`[inbox-ai] bỏ qua (${decision.intent}) hội thoại ${conv.id.slice(0, 8)}`);
    return;
  }
  const sentLastHour = db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.ruleId, AI_RULE_ID),
        inArray(messages.deliveryStatus, ["pending", "sent"]),
        gte(messages.createdAt, new Date(Date.now() - 36e5)),
      ),
    )
    .all().length;
  const confident = decision.confidence >= cfg.minConfidence && !decision.needsHuman;
  const auto = cfg.mode === "auto" && confident && sentLastHour < cfg.maxPerHour;
  const why = !confident
    ? decision.needsHuman
      ? `Cần người xử lý${decision.reason ? `: ${decision.reason}` : ""}`
      : `AI chưa chắc chắn (${Math.round(decision.confidence * 100)}%)${decision.reason ? ` – ${decision.reason}` : ""}`
    : cfg.mode === "auto"
      ? `Đã đạt giới hạn ${cfg.maxPerHour} câu tự gửi/giờ`
      : "Chế độ soạn nháp – chờ duyệt";
  db.insert(messages)
    .values({
      id: newId(),
      conversationId: conv.id,
      direction: "out",
      author: "bot",
      body: decision.reply.trim(),
      action: "message",
      targetId: conv.source === "comment" ? msg.externalId : null,
      ruleId: AI_RULE_ID,
      deliveryStatus: auto ? "pending" : "draft",
      sendAfter: auto ? new Date(Date.now() + between(cfg.minDelaySec, cfg.maxDelaySec) * 1e3) : null,
      aiNote: `${auto ? "Tự gửi" : why} · ý định: ${decision.intent} · tin cậy ${Math.round(decision.confidence * 100)}% · ${meta.model}`,
    })
    .run();
  if (!auto)
    db.update(conversations)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(conversations.id, conv.id), eq(conversations.status, "open")))
      .run();
  console.info(
    `[inbox-ai] ${auto ? "tự gửi" : "nháp chờ duyệt"} · ${decision.intent} · ${Math.round(decision.confidence * 100)}% (hội thoại ${conv.id.slice(0, 8)})`,
  );
  if (auto) onQueued?.();
}

export function approveDraft(id, body) {
  const res = getDb()
    .update(messages)
    .set({
      deliveryStatus: "pending",
      ...(body?.trim() ? { body: body.trim() } : {}),
      sendAfter: null,
      aiNote: null,
      createdAt: new Date(),
    })
    .where(and(eq(messages.id, id), eq(messages.deliveryStatus, "draft")))
    .run();
  return res.changes > 0;
}

export function discardDraft(id) {
  return (
    getDb()
      .delete(messages)
      .where(and(eq(messages.id, id), eq(messages.deliveryStatus, "draft")))
      .run().changes > 0
  );
}

export function draftCount() {
  return getDb().select({ id: messages.id }).from(messages).where(eq(messages.deliveryStatus, "draft")).all().length;
}
