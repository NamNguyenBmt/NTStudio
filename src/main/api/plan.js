import { eq, and, isNotNull, gte, desc, lte, asc } from "drizzle-orm";
import { workspaces, channels, contentItems, videoProjects, scheduledPosts, contentIdeas } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError, notFound } from "../errors";
import { planContent } from "../ai/plan";
import { byWorkspace } from "./accounts";
import { CONTENT_FORMATS, formatById } from "../../shared/content-formats";

const meta = (r) => ({ provider: r.providerLabel, model: r.model, costUsd: r.costUsd });
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function trendingSearches(geo = "VN") {
  try {
    const res = await fetch(`${process.env.OMNI_TRENDS_URL ?? "https://trends.google.com/trending/rss"}?geo=${geo}`, { signal: AbortSignal.timeout(8e3) });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/title>/g)].map((m) => m[1].trim()).filter(Boolean).slice(0, 20);
  } catch {
    return [];
  }
}

function topPosts(workspaceId) {
  return getDb().select({ title: contentItems.title, engagements: scheduledPosts.engagements, views: scheduledPosts.views }).from(scheduledPosts).innerJoin(channels, eq(channels.id, scheduledPosts.channelId)).innerJoin(contentItems, eq(contentItems.id, scheduledPosts.contentItemId)).where(
    and(
      eq(scheduledPosts.status, "published"),
      isNotNull(scheduledPosts.engagements),
      gte(scheduledPosts.publishedAt, new Date(Date.now() - 60 * 864e5)),
      workspaceId ? eq(channels.workspaceId, workspaceId) : void 0
    )
  ).orderBy(desc(scheduledPosts.engagements)).limit(10).all();
}

export const planHandlers = {
  "plan.list": ({ workspaceId, from, to }) => getDb().select().from(contentIdeas).where(and(byWorkspace(contentIdeas.workspaceId, workspaceId), gte(contentIdeas.plannedDate, from), lte(contentIdeas.plannedDate, to))).orderBy(asc(contentIdeas.plannedDate), asc(contentIdeas.createdAt)).all(),
  "plan.generate": async ({ workspaceId, startDate, days, perDay, formats, useTrends }) => {
    const db = getDb();
    const ws = workspaceId ? db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get() : void 0;
    if (workspaceId && !ws) throw notFound("Pocket");
    const niche = ws ? [ws.name, ws.description, ws.tags.join(" ")].filter(Boolean).join(" · ") : "Đa chủ đề giải trí";
    const chosen = (formats.length ? formats : CONTENT_FORMATS.map((f) => f.id)).map(formatById);
    const start = new Date(`${startDate}T00:00:00`);
    const dates = Array.from({ length: days }, (_, i) => isoDay(new Date(start.getTime() + i * 864e5)));
    const { ideas, meta: m } = await planContent({
      niche,
      brandVoice: ws?.brandVoice ?? null,
      topPosts: topPosts(workspaceId ?? null),
      trends: useTrends ? await trendingSearches() : [],
      formats: chosen.map((f) => ({ id: f.id, label: f.label, guide: f.guide })),
      dates,
      perDay,
      workspaceId: workspaceId ?? null
    });
    const allowed = new Set(chosen.map((f) => f.id));
    const valid = ideas.filter((i) => dates.includes(i.date)).slice(0, days * perDay);
    db.transaction((tx) => {
      for (const i of valid)
        tx.insert(contentIdeas).values({
          id: newId(),
          workspaceId: workspaceId ?? null,
          plannedDate: i.date,
          title: i.title.trim(),
          format: allowed.has(i.format) ? i.format : chosen[0].id,
          hook: i.hook || null,
          description: i.description || null,
          source: "ai"
        }).run();
    });
    return { created: valid.length, meta: meta(m) };
  },
  "plan.save": ({ id, ...input }) => {
    const db = getDb();
    if (!id)
      return db.insert(contentIdeas).values({ id: newId(), ...input, source: "manual" }).returning().get();
    const row = db.update(contentIdeas).set({ ...input, updatedAt: new Date() }).where(eq(contentIdeas.id, id)).returning().get();
    if (!row) throw notFound("ý tưởng");
    return row;
  },
  "plan.delete": ({ id }) => {
    if (!getDb().delete(contentIdeas).where(eq(contentIdeas.id, id)).run().changes) throw notFound("ý tưởng");
  },
  /** Ý tưởng → dự án Xưởng video theo mẫu định dạng (mở Xưởng để sinh kịch bản & render). */
  "plan.toVideo": ({ id }) => {
    const db = getDb();
    const idea = db.select().from(contentIdeas).where(eq(contentIdeas.id, id)).get();
    if (!idea) throw notFound("ý tưởng");
    if (idea.projectId && db.select({ id: videoProjects.id }).from(videoProjects).where(eq(videoProjects.id, idea.projectId)).get()) return { projectId: idea.projectId };
    if (formatById(idea.format).kind !== "video") throw new ApiError("VALIDATION", 'Định dạng này là bài viết – dùng "Tạo bài viết"');
    const clean = (t) => (t ?? "").trim().replace(/[.…!?]+$/u, "");
    const topic = [clean(idea.title), idea.hook ? `Mở đầu: ${clean(idea.hook)}` : "", clean(idea.description)].filter(Boolean).join(". ").slice(0, 1e3);
    return db.transaction((tx) => {
      const p = tx.insert(videoProjects).values({ id: newId(), workspaceId: idea.workspaceId, topic, format: idea.format }).returning().get();
      tx.update(contentIdeas).set({ projectId: p.id, status: "in_progress", updatedAt: new Date() }).where(eq(contentIdeas.id, id)).run();
      return { projectId: p.id };
    });
  },
  /** Ý tưởng → bài viết nháp trong Kho nội dung. */
  "plan.toPost": ({ id }) => {
    const db = getDb();
    const idea = db.select().from(contentIdeas).where(eq(contentIdeas.id, id)).get();
    if (!idea) throw notFound("ý tưởng");
    if (idea.contentItemId) return { contentItemId: idea.contentItemId };
    return db.transaction((tx) => {
      const item = tx.insert(contentItems).values({
        id: newId(),
        workspaceId: idea.workspaceId,
        kind: "text",
        title: idea.title.slice(0, 300),
        caption: [idea.hook, idea.description].filter(Boolean).join("\n\n") || null,
        status: "draft"
      }).returning().get();
      tx.update(contentIdeas).set({ contentItemId: item.id, status: "in_progress", updatedAt: new Date() }).where(eq(contentIdeas.id, id)).run();
      return { contentItemId: item.id };
    });
  }
};
