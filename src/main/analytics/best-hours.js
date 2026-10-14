import { eq, and, isNotNull, gte } from "drizzle-orm";
import { channels, scheduledPosts } from "../db/schema";
import { getDb } from "../db/index";

const MIN_POSTS = 8;
const pad = (n) => String(n).padStart(2, "0");

export function bestHours(workspaceId) {
  const rows = getDb()
    .select({
      channelId: scheduledPosts.channelId,
      publishedAt: scheduledPosts.publishedAt,
      engagements: scheduledPosts.engagements,
    })
    .from(scheduledPosts)
    .innerJoin(channels, eq(channels.id, scheduledPosts.channelId))
    .where(
      and(
        eq(scheduledPosts.status, "published"),
        isNotNull(scheduledPosts.engagements),
        gte(scheduledPosts.publishedAt, new Date(Date.now() - 90 * 864e5)),
        workspaceId ? eq(channels.workspaceId, workspaceId) : void 0,
      ),
    )
    .all()
    .filter((r) => r.publishedAt && r.engagements != null);
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, posts: 0, score: 0 }));
  if (rows.length < MIN_POSTS) return { posts: rows.length, minPosts: MIN_POSTS, byHour, suggested: [] };
  const avg = new Map();
  for (const r of rows) avg.set(r.channelId, (avg.get(r.channelId) ?? 0) + r.engagements);
  const counts = new Map();
  for (const r of rows) counts.set(r.channelId, (counts.get(r.channelId) ?? 0) + 1);
  for (const [k, v] of avg) avg.set(k, v / counts.get(k));
  const sum = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    const h = r.publishedAt.getHours();
    const base = avg.get(r.channelId) || 1;
    sum[h] += r.engagements / base;
    byHour[h].posts++;
  }
  for (const b of byHour) b.score = b.posts ? Math.round((sum[b.hour] / b.posts) * 100) / 100 : 0;
  const top = byHour
    .filter((b) => b.posts >= 2 && b.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const totalScore = top.reduce((a, b) => a + b.score, 0) || 1;
  const hours = [...top].sort((a, b) => a.hour - b.hour);
  const merged = [];
  for (const b of hours) {
    const last = merged[merged.length - 1];
    if (last && b.hour === last.to) {
      last.to = b.hour + 1;
      last.score += b.score;
    } else merged.push({ from: b.hour, to: b.hour + 1, score: b.score });
  }
  const suggested = merged.map((m) => ({
    start: `${pad(m.from)}:00`,
    end: m.to >= 24 ? "23:59" : `${pad(m.to)}:00`,
    weight: Math.round((m.score / totalScore) * 100) / 100,
  }));
  return { posts: rows.length, minPosts: MIN_POSTS, byHour, suggested };
}
