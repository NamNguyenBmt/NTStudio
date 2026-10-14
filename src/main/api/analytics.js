import { eq, sum, and, gte, inArray, desc, sql } from "drizzle-orm";
import { channels, channelMetricsDaily, contentItems, videoProjects, scheduledPosts, channelGoals } from "../db/schema";
import { getDb, newId } from "../db/index";
import { notFound } from "../errors";
import { formatById } from "../../shared/content-formats";
import { GOAL_METRICS } from "../../shared/goals";

const DAY = 864e5;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

const LENGTH_BUCKETS = [
  { key: "lt15", label: "Dưới 15 giây", max: 15 },
  { key: "15_30", label: "15–30 giây", max: 30 },
  { key: "30_60", label: "30–60 giây", max: 60 },
  { key: "gt60", label: "Trên 60 giây", max: Infinity }
];

function group(posts, keyOf) {
  const map = new Map();
  for (const p of posts) {
    const k = keyOf(p);
    if (!k) continue;
    const g = map.get(k.key) ?? { label: k.label, list: [] };
    g.list.push(p);
    map.set(k.key, g);
  }
  const avg = (xs) => {
    const v = xs.filter((x) => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null;
  };
  return [...map.entries()].map(([key, g]) => ({
    key,
    label: g.label,
    posts: g.list.length,
    avgViews: avg(g.list.map((p) => p.views ?? p.reach)),
    avgEngagements: avg(g.list.map((p) => p.engagements)),
    avgRetention: avg(g.list.map((p) => p.retention))
  })).sort((a, b) => (b.avgEngagements ?? 0) - (a.avgEngagements ?? 0));
}

function goalCurrent(channelId, metric) {
  const db = getDb();
  const since = (days) => isoDay(Date.now() - (days - 1) * DAY);
  switch (metric) {
    case "followers":
      return db.select({ f: channels.followers }).from(channels).where(eq(channels.id, channelId)).get()?.f ?? 0;
    case "watch_minutes_60d":
    case "views_30d":
    case "engagements_30d": {
      const col = metric === "watch_minutes_60d" ? channelMetricsDaily.watchMinutes : metric === "views_30d" ? channelMetricsDaily.views : channelMetricsDaily.engagements;
      const days = metric === "watch_minutes_60d" ? 60 : 30;
      return db.select({ v: sum(col).mapWith(Number) }).from(channelMetricsDaily).where(and(eq(channelMetricsDaily.channelId, channelId), gte(channelMetricsDaily.day, since(days)))).get()?.v ?? 0;
    }
    case "videos_30d":
      return db.select({ id: scheduledPosts.id }).from(scheduledPosts).innerJoin(contentItems, eq(contentItems.id, scheduledPosts.contentItemId)).where(
        and(
          eq(scheduledPosts.channelId, channelId),
          eq(scheduledPosts.status, "published"),
          inArray(contentItems.kind, ["video", "reel"]),
          gte(scheduledPosts.publishedAt, new Date(Date.now() - 30 * DAY))
        )
      ).all().length;
  }
}

export const analyticsHandlers = {
  "analytics.overview": ({ workspaceId, channelId, days }) => {
    const db = getDb();
    const rows = db.select({
      id: scheduledPosts.id,
      title: contentItems.title,
      kind: contentItems.kind,
      durationSec: contentItems.durationSec,
      contentItemId: contentItems.id,
      channelName: channels.name,
      platform: channels.platform,
      publishedAt: scheduledPosts.publishedAt,
      permalink: scheduledPosts.permalink,
      reach: scheduledPosts.reach,
      views: scheduledPosts.views,
      engagements: scheduledPosts.engagements,
      avgWatchSec: scheduledPosts.avgWatchSec
    }).from(scheduledPosts).innerJoin(channels, eq(channels.id, scheduledPosts.channelId)).innerJoin(contentItems, eq(contentItems.id, scheduledPosts.contentItemId)).where(
      and(
        eq(scheduledPosts.status, "published"),
        gte(scheduledPosts.publishedAt, new Date(Date.now() - days * DAY)),
        channelId ? eq(scheduledPosts.channelId, channelId) : void 0,
        workspaceId ? eq(channels.workspaceId, workspaceId) : void 0
      )
    ).orderBy(desc(scheduledPosts.publishedAt)).all();
    const ids = rows.map((r) => r.contentItemId);
    const formats = new Map(
      ids.length ? db.select({ contentItemId: videoProjects.contentItemId, format: videoProjects.format }).from(videoProjects).where(inArray(videoProjects.contentItemId, ids)).all().map((r) => [r.contentItemId, r.format]) : []
    );
    const posts = rows.map((r) => {
      const fmt = formats.get(r.contentItemId) ?? null;
      const retention = r.avgWatchSec != null && r.durationSec ? Math.min(100, Math.round(r.avgWatchSec / r.durationSec * 1e3) / 10) : null;
      return {
        id: r.id,
        title: r.title,
        kind: r.kind,
        channelName: r.channelName,
        platform: r.platform,
        publishedAt: r.publishedAt,
        permalink: r.permalink,
        durationSec: r.durationSec,
        format: fmt,
        formatLabel: fmt ? formatById(fmt).label : r.kind === "video" || r.kind === "reel" ? "Video (không theo mẫu)" : "Bài viết / ảnh",
        reach: r.reach,
        views: r.views,
        engagements: r.engagements,
        avgWatchSec: r.avgWatchSec,
        retention
      };
    });
    const withMetrics = posts.filter((p) => p.engagements != null);
    const sorted = [...withMetrics].sort((a, b) => (b.engagements ?? 0) - (a.engagements ?? 0));
    const rets = posts.map((p) => p.retention).filter((x) => x != null);
    return {
      days,
      posts: posts.length,
      postsWithMetrics: withMetrics.length,
      totalViews: posts.reduce((a, p) => a + (p.views ?? p.reach ?? 0), 0),
      totalEngagements: posts.reduce((a, p) => a + (p.engagements ?? 0), 0),
      avgRetention: rets.length ? Math.round(rets.reduce((a, b) => a + b, 0) / rets.length * 10) / 10 : null,
      byFormat: group(posts, (p) => ({ key: p.format ?? `kind:${p.formatLabel}`, label: p.formatLabel })),
      byLength: group(posts, (p) => {
        if (!p.durationSec) return null;
        const b = LENGTH_BUCKETS.find((x) => p.durationSec < x.max) ?? LENGTH_BUCKETS[LENGTH_BUCKETS.length - 1];
        return { key: b.key, label: b.label };
      }),
      top: sorted.slice(0, 5),
      // Không trùng với danh sách tốt nhất khi có ít bài
      bottom: sorted.slice(Math.max(5, sorted.length - 5)).reverse()
    };
  },
  "analytics.goals": ({ workspaceId, channelId }) => {
    const db = getDb();
    return db.select({ goal: channelGoals, channelName: channels.name, platform: channels.platform }).from(channelGoals).innerJoin(channels, eq(channels.id, channelGoals.channelId)).where(and(channelId ? eq(channelGoals.channelId, channelId) : void 0, workspaceId ? eq(channels.workspaceId, workspaceId) : void 0)).orderBy(channels.name, sql`${channelGoals.createdAt}`).all().map(({ goal, channelName, platform }) => {
      const current = goalCurrent(goal.channelId, goal.metric);
      return {
        ...goal,
        channelName,
        platform,
        current,
        progress: goal.target ? Math.min(100, Math.round(current / goal.target * 1e3) / 10) : 0,
        metricLabel: GOAL_METRICS[goal.metric].label
      };
    });
  },
  "analytics.saveGoal": ({ id, ...input }) => {
    const db = getDb();
    if (!db.select({ id: channels.id }).from(channels).where(eq(channels.id, input.channelId)).get()) throw notFound("kênh");
    if (!id)
      return db.insert(channelGoals).values({ id: newId(), ...input }).returning().get();
    const row = db.update(channelGoals).set(input).where(eq(channelGoals.id, id)).returning().get();
    if (!row) throw notFound("mục tiêu");
    return row;
  },
  "analytics.deleteGoal": ({ id }) => {
    if (!getDb().delete(channelGoals).where(eq(channelGoals.id, id)).run().changes) throw notFound("mục tiêu");
  }
};
