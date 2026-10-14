import { join } from "node:path";
import { eq, asc, and, gt, gte, inArray, desc, or, isNull } from "drizzle-orm";
import { workspaces, channels, aiProviders, aiUsage, contentItems, contentVariants, videoProjects, videoScenes, conversations, messages, quickReplies, settings } from "../db/schema";
import { getDb, newId } from "../db/index";
import { notFound } from "../errors";
import { readSecret } from "../vault";
import { AiError } from "../ai/providers";
import { mediaDir } from "../media/paths";
import { DEFAULT_PRICING, priceFor } from "../../shared/pricing";
import { omniraQuota } from "../ai/adapters/omnira";
import { setSetting, pricingOverrides, testProvider, testWithDependents, textChain } from "../ai/router";
import { isLongForm } from "../../shared/video";
import { composeShotPrompt, rebiblePrompt } from "../media/prompts";
import { NO_NARRATION_RULE, generateScript } from "../ai/script";
import { spinCaption, suggestHashtags, normalizeTags, suggestReply } from "../ai/captions";
import { bibleFromImages, translateBible } from "../ai/bible";
import { episodeLongContext, scriptEpisode, episodeOfProject } from "./series";
import { writeAct, writeLongScript } from "../studio/long-script";
import { formatById } from "../../shared/content-formats";
import { loadChatImages } from "../ai/chat-images";
import { guessPlatform, scoreHook } from "../hook/score";
import { hookFingerprint } from "../../shared/hook";

const brandVoiceOf = (workspaceId) => workspaceId ? getDb().select({ v: workspaces.brandVoice }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.v ?? null : null;
const meta = (r) => ({ provider: r.providerLabel, model: r.model, costUsd: r.costUsd });

export function fitDurations(durations, target) {
  const total = durations.reduce((a, b) => a + b, 0) || 1;
  const scaled = durations.map((d) => Math.max(1.5, Math.round(d * target / total * 10) / 10));
  const diff = Math.round((target - scaled.reduce((a, b) => a + b, 0)) * 10) / 10;
  scaled[scaled.length - 1] = Math.max(1.5, Math.round((scaled[scaled.length - 1] + diff) * 10) / 10);
  return scaled;
}

function studioLongContext(p) {
  const episodeId = episodeOfProject(p.id);
  if (episodeId) return episodeLongContext(episodeId, p.aspect === "9:16");
  const db = getDb();
  const channel = p.targetChannelId ? db.select({ platform: channels.platform, workspaceId: channels.workspaceId }).from(channels).where(eq(channels.id, p.targetChannelId)).get() : void 0;
  const workspaceId = p.workspaceId ?? channel?.workspaceId ?? null;
  return {
    ctx: {
      kind: "video",
      topic: p.topic,
      brief: [
        channel ? `Nền tảng: ${{ facebook: "Facebook", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" }[channel.platform]}` : "",
        p.format ? `Định dạng nội dung: ${formatById(p.format).guide}` : "",
        p.referenceImages.length ? REFS_HINT : "",
        // Không lời thoại: câu "line" của từng cảnh chỉ là ghi chú, app không đọc
        p.narration ? "" : NO_NARRATION_RULE.replace("voiceover:", "line:")
      ].filter(Boolean),
      characters: [],
      totalSec: p.targetDurationSec,
      vertical: p.aspect === "9:16",
      brandVoice: brandVoiceOf(workspaceId),
      workspaceId,
      bible: p.visualBible ?? null,
      // Chưa có bộ nhận diện → AI lập cùng dàn ý, xem ảnh tham chiếu để tả đúng nhân vật / sản phẩm
      images: p.visualBible ? void 0 : refImages(p)
    }
  };
}

const refImages = (p) => loadChatImages(p.referenceImages.map((r) => join(mediaDir(), r)));

function applyBible(projectId, prev, next) {
  const db = getDb();
  let updated = 0;
  db.transaction((tx) => {
    tx.update(videoProjects).set({ visualBible: next, updatedAt: new Date() }).where(eq(videoProjects.id, projectId)).run();
    if (!prev) return;
    for (const s of tx.select({ id: videoScenes.id, mediaPrompt: videoScenes.mediaPrompt }).from(videoScenes).where(eq(videoScenes.projectId, projectId)).all()) {
      if (!s.mediaPrompt) continue;
      const prompt = rebiblePrompt(s.mediaPrompt, prev, next);
      if (prompt === s.mediaPrompt) continue;
      tx.update(videoScenes).set({ mediaPrompt: prompt }).where(eq(videoScenes.id, s.id)).run();
      updated++;
    }
  });
  return updated;
}

const projectWorkspace = (p) => p.workspaceId ?? (p.targetChannelId ? getDb().select({ w: channels.workspaceId }).from(channels).where(eq(channels.id, p.targetChannelId)).get()?.w ?? null : null);
const REFS_HINT = "Người dùng đã cung cấp ảnh tham chiếu của chủ thể chính (sản phẩm, nhân vật hoặc logo) – app gửi kèm ảnh khi tạo hình. Đưa chủ thể đó vào visual bible (product hoặc characters) với mô tả khớp chủ đề, và đánh dấu nó trong shot của các cảnh có xuất hiện.";
const projectScenes = (id) => getDb().select().from(videoScenes).where(eq(videoScenes.projectId, id)).orderBy(asc(videoScenes.position)).all();

export const aiHandlers = {
  "ai.omnira": async () => ({ inUse: textChain().length === 0, quota: await omniraQuota() }),
  /** Lập lại bộ nhận diện theo ảnh tham chiếu (giữ tên nhân vật / sản phẩm) → cập nhật prompt hình các cảnh */
  "studio.bibleFromRefs": async ({ id }) => {
    const p = getDb().select().from(videoProjects).where(eq(videoProjects.id, id)).get();
    if (!p) throw notFound("dự án video");
    const images = refImages(p);
    if (!images.length) throw new AiError("bad_request", 'Dự án chưa có ảnh tham chiếu (hoặc không đọc được ảnh) – thêm ảnh ở mục "Ảnh tham chiếu" trước');
    const prev = p.visualBible ?? { style: "", characters: [], product: null };
    const { bible, meta: m } = await bibleFromImages({ topic: p.topic, bible: prev, images, workspaceId: projectWorkspace(p) });
    const updated = applyBible(id, p.visualBible, bible);
    return { bible, updated, meta: meta(m) };
  },
  /** Người dùng sửa bộ nhận diện (tiếng Việt) → AI dịch sang tiếng Anh cho prompt hình → cập nhật prompt các cảnh */
  "studio.updateBible": async ({ id, bible: edited }) => {
    const p = getDb().select().from(videoProjects).where(eq(videoProjects.id, id)).get();
    if (!p) throw notFound("dự án video");
    const prev = p.visualBible;
    if (prev && (edited.characters.length !== prev.characters.length || !!edited.product !== !!prev.product))
      throw new AiError("bad_request", "Bộ nhận diện đã thay đổi ở nơi khác – tải lại rồi sửa lại");
    const { bible, meta: m } = await translateBible({ edited, workspaceId: projectWorkspace(p) });
    const updated = applyBible(id, prev, bible);
    return { bible, updated, meta: meta(m) };
  },
  "studio.writeAct": async ({ projectId, act }) => {
    const p = getDb().select().from(videoProjects).where(eq(videoProjects.id, projectId)).get();
    if (!p) throw notFound("dự án video");
    const { ctx, map } = studioLongContext(p);
    const m = await writeAct(projectId, ctx, act, map);
    return { scenes: projectScenes(projectId), meta: meta(m) };
  },
  // ─────────── Kết nối & định tuyến ───────────
  // Check Connection: kiểm tra cả nhà cung cấp dùng chung key (vd Gemini → Nano Banana, Veo, Lyria)
  "ai.test": ({ id }) => testWithDependents(id),
  "ai.testAll": async () => {
    const rows = getDb().select({ id: aiProviders.id, label: aiProviders.label }).from(aiProviders).where(eq(aiProviders.enabled, true)).orderBy(asc(aiProviders.category), asc(aiProviders.priority)).all();
    const results = await Promise.all(rows.map(async (r) => ({ id: r.id, label: r.label, ...await testProvider(r.id) })));
    return results;
  },
  "ai.routing": () => {
    const rows = getDb().select().from(aiProviders).where(eq(aiProviders.category, "text")).orderBy(asc(aiProviders.priority)).all();
    const fallback = getDb().select().from(settings).where(eq(settings.key, "ai.fallbackOnError")).get();
    return {
      fallbackOnError: fallback ? Boolean(fallback.value) : true,
      chain: rows.map((p) => ({
        id: p.id,
        label: p.label,
        provider: p.provider,
        model: p.defaultModel,
        enabled: p.enabled,
        hasKey: readSecret("ai_provider", p.id, "api_key") != null
      }))
    };
  },
  "ai.reorder": ({ ids }) => {
    getDb().transaction((tx) => {
      ids.forEach((id, priority) => tx.update(aiProviders).set({ priority, updatedAt: new Date() }).where(eq(aiProviders.id, id)).run());
    });
  },
  "ai.setFallback": ({ enabled }) => setSetting("ai.fallbackOnError", enabled),
  "ai.pricing": () => {
    const overrides = pricingOverrides();
    const d = new Date();
    const used = getDb().selectDistinct({ model: aiUsage.model }).from(aiUsage).where(and(eq(aiUsage.ok, true), gt(aiUsage.inputTokens, 0), gte(aiUsage.createdAt, new Date(d.getFullYear(), d.getMonth() - 2, 1)))).all().map((r) => r.model).filter((m) => !!m);
    return { defaults: DEFAULT_PRICING, overrides, unpricedModels: used.filter((m) => !priceFor(m, overrides)) };
  },
  "ai.setPrice": ({ model, price }) => {
    const next = { ...pricingOverrides() };
    if (price) next[model] = price;
    else delete next[model];
    setSetting("ai.pricing", next);
  },
  // ─────────── Xưởng Video: sinh kịch bản ───────────
  "studio.generateScript": async ({ id }) => {
    const db = getDb();
    const p = db.select().from(videoProjects).where(eq(videoProjects.id, id)).get();
    if (!p) throw notFound("dự án video");
    const episodeId = episodeOfProject(id);
    if (episodeId) {
      const r = await scriptEpisode(episodeId);
      const scenes2 = db.select().from(videoScenes).where(eq(videoScenes.projectId, id)).orderBy(asc(videoScenes.position)).all();
      return { scenes: scenes2, meta: r.meta };
    }
    if (isLongForm(p.targetDurationSec)) {
      const { ctx } = studioLongContext(p);
      const { meta: m2 } = await writeLongScript(id, ctx);
      return { scenes: projectScenes(id), meta: m2 };
    }
    const channel = p.targetChannelId ? db.select({ platform: channels.platform, workspaceId: channels.workspaceId }).from(channels).where(eq(channels.id, p.targetChannelId)).get() : void 0;
    const workspaceId = p.workspaceId ?? channel?.workspaceId ?? null;
    const platformName = channel ? { facebook: "Facebook Reels", tiktok: "TikTok", instagram: "Instagram Reels", youtube: "YouTube Shorts" }[channel.platform] : null;
    const {
      scenes,
      bible,
      meta: m
    } = await generateScript({
      topic: p.topic,
      targetSec: p.targetDurationSec,
      platform: platformName,
      brandVoice: brandVoiceOf(workspaceId),
      workspaceId,
      formatGuide: [p.format ? formatById(p.format).guide : "", p.referenceImages.length ? REFS_HINT : ""].filter(Boolean).join(" ") || null,
      aspect: p.aspect,
      narration: p.narration,
      // AI xem ảnh tham chiếu → bộ nhận diện tả đúng nhân vật / sản phẩm trong ảnh (không tự nghĩ ra)
      images: refImages(p)
    });
    const durations = fitDurations(
      scenes.map((s) => s.durationSec),
      p.targetDurationSec
    );
    const saved = db.transaction((tx) => {
      tx.delete(videoScenes).where(eq(videoScenes.projectId, id)).run();
      tx.insert(videoScenes).values(
        scenes.map((s, i) => ({
          id: newId(),
          projectId: id,
          position: i,
          label: s.label,
          voiceover: s.voiceover.trim(),
          durationSec: durations[i],
          // Prompt video hoàn chỉnh (nhân vật, hành động, bối cảnh, góc máy, chuyển động, ánh sáng, chất liệu, phong cách, âm thanh)
          mediaPrompt: composeShotPrompt(s.shot, bible),
          searchQuery: s.searchQuery.trim() || null,
          mediaSource: "stock"
        }))
      ).run();
      tx.update(videoProjects).set({ status: "scripted", acts: null, visualBible: bible, updatedAt: new Date() }).where(eq(videoProjects.id, id)).run();
      return tx.select().from(videoScenes).where(eq(videoScenes.projectId, id)).orderBy(asc(videoScenes.position)).all();
    });
    return { scenes: saved, meta: meta(m) };
  },
  // ─────────── Kho nội dung: chấm điểm Hook ───────────
  "content.hookScore": async ({ id, platform, force }) => {
    const db = getDb();
    const item = db.select().from(contentItems).where(eq(contentItems.id, id)).get();
    if (!item) throw notFound("nội dung");
    const pf = platform ?? item.hookScore?.platform ?? guessPlatform(item);
    if (!force && item.hookScore?.health && item.hookScore.platform === pf && item.hookScore.for === hookFingerprint(item, pf)) return { score: item.hookScore, cached: true };
    const score = await scoreHook(item, pf, item.workspaceId);
    db.update(contentItems).set({ hookScore: score }).where(eq(contentItems.id, id)).run();
    return { score, cached: false };
  },
  // ─────────── Kho nội dung: Spin & Hashtag ───────────
  "content.spin": async ({ ids, count }) => {
    const db = getDb();
    const items = db.select().from(contentItems).where(inArray(contentItems.id, ids)).all();
    const failed = [];
    let done = 0;
    let lastMeta = null;
    for (const item of items) {
      try {
        const { variants, meta: m } = await spinCaption({
          title: item.title,
          caption: item.caption,
          hashtags: item.hashtags,
          count,
          brandVoice: brandVoiceOf(item.workspaceId),
          workspaceId: item.workspaceId
        });
        db.transaction((tx) => {
          tx.insert(contentVariants).values(variants.map((v) => ({ id: newId(), contentItemId: item.id, caption: v.caption.trim(), hashtags: normalizeTags(v.hashtags), model: m.model }))).run();
          const total = tx.select({ id: contentVariants.id }).from(contentVariants).where(eq(contentVariants.contentItemId, item.id)).all().length;
          tx.update(contentItems).set({ spinVariants: total, updatedAt: new Date() }).where(eq(contentItems.id, item.id)).run();
        });
        lastMeta = meta(m);
        done++;
      } catch (err) {
        if (err instanceof AiError && (err.kind === "budget" || err.kind === "no_provider")) throw err;
        failed.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    for (const id of ids) if (!items.some((i) => i.id === id)) failed.push({ id, reason: "Không tìm thấy nội dung" });
    return { done, failed, meta: lastMeta };
  },
  "content.variants": ({ id }) => getDb().select().from(contentVariants).where(eq(contentVariants.contentItemId, id)).orderBy(desc(contentVariants.createdAt)).all(),
  "content.applyVariant": ({ id }) => {
    const db = getDb();
    const v = db.select().from(contentVariants).where(eq(contentVariants.id, id)).get();
    if (!v) throw notFound("biến thể");
    return db.update(contentItems).set({ caption: v.caption, hashtags: v.hashtags, updatedAt: new Date() }).where(eq(contentItems.id, v.contentItemId)).returning().get();
  },
  "content.deleteVariant": ({ id }) => {
    const db = getDb();
    db.transaction((tx) => {
      const v = tx.delete(contentVariants).where(eq(contentVariants.id, id)).returning({ contentItemId: contentVariants.contentItemId }).get();
      if (!v) throw notFound("biến thể");
      const total = tx.select({ id: contentVariants.id }).from(contentVariants).where(eq(contentVariants.contentItemId, v.contentItemId)).all().length;
      tx.update(contentItems).set({ spinVariants: total }).where(eq(contentItems.id, v.contentItemId)).run();
    });
  },
  "content.hashtags": async ({ ids }) => {
    const db = getDb();
    const items = db.select().from(contentItems).where(inArray(contentItems.id, ids)).all();
    const failed = [];
    let done = 0;
    for (const item of items) {
      try {
        const platform = item.kind === "video" || item.kind === "reel" ? "TikTok / Reels" : item.kind === "text" ? "Facebook" : "Instagram / Facebook";
        const hashtags = await suggestHashtags({ title: item.title, caption: item.caption, platform, workspaceId: item.workspaceId });
        db.update(contentItems).set({ hashtags, updatedAt: new Date() }).where(eq(contentItems.id, item.id)).run();
        done++;
      } catch (err) {
        if (err instanceof AiError && (err.kind === "budget" || err.kind === "no_provider")) throw err;
        failed.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return { done, failed };
  },
  // ─────────── Hộp thư: AI Co-Pilot ───────────
  "inbox.suggestReply": async ({ conversationId }) => {
    const db = getDb();
    const conv = db.select({ c: conversations, channelName: channels.name }).from(conversations).innerJoin(channels, eq(channels.id, conversations.channelId)).where(eq(conversations.id, conversationId)).get();
    if (!conv) throw notFound("hội thoại");
    const history = db.select({ direction: messages.direction, body: messages.body }).from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).all();
    const ws = conv.c.workspaceId;
    const knowledge = db.select({ shortcut: quickReplies.shortcut, body: quickReplies.body }).from(quickReplies).where(ws ? or(isNull(quickReplies.workspaceId), eq(quickReplies.workspaceId, ws)) : isNull(quickReplies.workspaceId)).all();
    const { text, meta: m } = await suggestReply({
      customerName: conv.c.customerName,
      channelName: conv.channelName,
      source: conv.c.source,
      contextPostTitle: conv.c.contextPostTitle,
      history,
      knowledge,
      brandVoice: brandVoiceOf(ws),
      workspaceId: ws
    });
    return { text, meta: meta(m) };
  }
};
