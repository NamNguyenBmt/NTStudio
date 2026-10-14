import { eq, and, or, gte, isNull } from "drizzle-orm";
import { messages, autoReplyRules } from "../db/schema";
import { getDb, newId } from "../db/index";

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();
}

const lowerNfc = (s) => s.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
const hasMarks = (s) => /[\p{M}đ]/u.test(s.toLowerCase().normalize("NFD"));
const PHONE = /(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/;

function wholeWord(haystack, needle) {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "u").test(haystack);
}

function matchKeywords(keywords, text) {
  return keywords.some((k) => {
    if (k === "{phone}") return PHONE.test(text);
    if (!k.trim()) return false;
    return hasMarks(k) ? wholeWord(lowerNfc(text), lowerNfc(k)) : wholeWord(normalize(text), normalize(k));
  });
}

const FRESH_MS = 30 * 6e4;
const COOLDOWN_MS = 60 * 6e4;

function matchRule(rule, text) {
  return matchKeywords(rule.keywords, text);
}

const fill = (template, name) => template.replace(/\{name\}/g, name.replace(/^@/, "")).trim();

export function applyRules(items) {
  if (!items.length) return 0;
  const db = getDb();
  const rules = db.select().from(autoReplyRules).where(eq(autoReplyRules.enabled, true)).all();
  if (!rules.length) return 0;
  let queued = 0;
  for (const { conversation: conv, message: msg } of items) {
    if (Date.now() - msg.createdAt.getTime() > FRESH_MS) continue;
    const comment = conv.source === "comment";
    for (const rule of rules) {
      if (
        rule.channelId
          ? rule.channelId !== conv.channelId
          : rule.workspaceId != null && rule.workspaceId !== conv.workspaceId
      )
        continue;
      if ((rule.action === "reply_comment" || rule.action === "hide_comment") && !comment) continue;
      if (conv.platform === "tiktok") continue;
      if (conv.platform === "youtube" && rule.action !== "reply_comment" && rule.action !== "hide_comment") continue;
      if (!matchRule(rule, msg.body)) continue;
      if (rule.action !== "hide_comment" && !rule.template?.trim()) continue;
      const recent = db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conv.id),
            eq(messages.ruleId, rule.id),
            or(gte(messages.createdAt, new Date(Date.now() - COOLDOWN_MS)), isNull(messages.externalId)),
          ),
        )
        .get();
      if (recent && rule.action !== "hide_comment") continue;
      const lo = Math.max(0, rule.minDelaySec);
      const hi = Math.max(lo, rule.maxDelaySec);
      const delaySec = rule.action === "hide_comment" ? 2 : lo + Math.random() * (hi - lo);
      db.insert(messages)
        .values({
          id: newId(),
          conversationId: conv.id,
          direction: "out",
          author: rule.action === "hide_comment" ? "system" : "bot",
          body:
            rule.action === "hide_comment"
              ? `Ẩn bình luận: "${msg.body.slice(0, 80)}" (luật "${rule.name}")`
              : fill(rule.template, conv.customerName),
          action: rule.action === "hide_comment" ? "hide" : "message",
          // Trả lời / ẩn đúng bình luận vừa đến; nhắn riêng từ bình luận dùng private reply theo comment_id
          targetId: comment ? msg.externalId : null,
          ruleId: rule.id,
          deliveryStatus: "pending",
          sendAfter: new Date(Date.now() + delaySec * 1e3),
        })
        .run();
      queued++;
      console.info(
        `[inbox] luật "${rule.name}" → ${rule.action} sau ${Math.round(delaySec)}s (hội thoại ${conv.id.slice(0, 8)})`,
      );
    }
  }
  return queued;
}
