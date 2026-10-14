import { eq, and, isNotNull, gte } from "drizzle-orm";
import { channels, scheduledPosts } from "../db/schema";
import { getDb } from "../db/index";
import { PublishError, graph, tiktok } from "../publish/http";
import { readCred, freshTikTokCred } from "../publish/credentials";
import { freshYoutubeCred, youtubeVideoStats } from "../publish/youtube";

const total = (x) => x?.summary?.total_count ?? 0;

async function lifetime(path, token, candidates, signal) {
  for (const metric of candidates) {
    try {
      const r = await graph("GET", path, { token, signal, query: { metric } });
      const v = r.data?.[0]?.values?.[0]?.value;
      if (typeof v === "number") return v;
    } catch (err) {
      if (err instanceof PublishError && (err.kind === "auth" || err.kind === "rate_limit")) throw err;
    }
  }
  return null;
}

async function facebookPost(id, token, signal) {
  try {
    const p = await graph("GET", id, {
      token,
      signal,
      query: { fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares" },
    });
    const reach = await lifetime(
      `${id}/insights`,
      token,
      ["post_impressions_unique", "post_media_view", "post_impressions"],
      signal,
    );
    return { reach, views: null, engagements: total(p.reactions) + total(p.comments) + (p.shares?.count ?? 0) };
  } catch (err) {
    if (err instanceof PublishError && (err.kind === "auth" || err.kind === "rate_limit")) throw err;
  }
  const v = await graph("GET", id, {
    token,
    signal,
    query: { fields: "likes.summary(total_count).limit(0),comments.summary(total_count).limit(0)" },
  });
  const views = await lifetime(
    `${id}/video_insights`,
    token,
    ["total_video_views", "blue_reels_play_count", "post_video_views"],
    signal,
  );
  const avgMs = await lifetime(
    `${id}/video_insights`,
    token,
    ["total_video_avg_time_watched", "post_video_avg_time_watched"],
    signal,
  );
  return {
    reach: null,
    views,
    engagements: total(v.likes) + total(v.comments),
    avgWatchSec: avgMs != null ? avgMs / 1e3 : null,
  };
}

async function instagramMedia(id, token, signal) {
  const m = await graph("GET", id, { token, signal, query: { fields: "like_count,comments_count" } });
  const reach = await lifetime(`${id}/insights`, token, ["reach"], signal);
  const views = await lifetime(`${id}/insights`, token, ["views", "plays", "video_views"], signal);
  const avgMs = await lifetime(`${id}/insights`, token, ["ig_reels_avg_watch_time"], signal);
  return {
    reach,
    views,
    engagements: (m.like_count ?? 0) + (m.comments_count ?? 0),
    avgWatchSec: avgMs != null ? avgMs / 1e3 : null,
  };
}

async function tiktokVideos(ids, cred, signal) {
  const out = new Map();
  const r = await tiktok("/v2/video/query/", {
    token: cred.token,
    signal,
    query: { fields: "id,view_count,like_count,comment_count,share_count" },
    json: { filters: { video_ids: ids.slice(0, 20) } },
  });
  for (const v of r.videos ?? [])
    out.set(String(v.id), {
      reach: null,
      views: v.view_count ?? null,
      engagements: (v.like_count ?? 0) + (v.comment_count ?? 0) + (v.share_count ?? 0),
    });
  return out;
}

export async function fetchChannelPostMetrics(channelId, platform, list, signal) {
  const out = new Map();
  const posts = list.filter((p) => !!p.externalId);
  let cred = readCred(channelId);
  if (!cred || !posts.length) return out;
  if (platform === "youtube") {
    cred = await freshYoutubeCred(channelId, cred, signal);
    const m = await youtubeVideoStats(
      posts.map((p) => p.externalId),
      cred.token,
      signal,
    );
    for (const p of posts) if (m.has(p.externalId)) out.set(p.id, { reach: null, ...m.get(p.externalId) });
    return out;
  }
  if (platform === "tiktok") {
    cred = await freshTikTokCred(channelId, cred, signal);
    try {
      const m = await tiktokVideos(
        posts.map((p) => p.externalId),
        cred,
        signal,
      );
      for (const p of posts) if (m.has(p.externalId)) out.set(p.id, m.get(p.externalId));
    } catch {}
    return out;
  }
  for (const p of posts) {
    try {
      out.set(
        p.id,
        platform === "instagram"
          ? await instagramMedia(p.externalId, cred.token, signal)
          : await facebookPost(p.externalId, cred.token, signal),
      );
    } catch (err) {
      if (err instanceof PublishError && (err.kind === "auth" || err.kind === "rate_limit")) throw err;
    }
  }
  return out;
}

export async function syncPostMetrics() {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 864e5);
  const rows = db
    .select({
      id: scheduledPosts.id,
      externalId: scheduledPosts.externalPostId,
      channelId: scheduledPosts.channelId,
      platform: channels.platform,
      channelName: channels.name,
    })
    .from(scheduledPosts)
    .innerJoin(channels, eq(channels.id, scheduledPosts.channelId))
    .where(
      and(
        eq(scheduledPosts.status, "published"),
        isNotNull(scheduledPosts.externalPostId),
        gte(scheduledPosts.publishedAt, since),
      ),
    )
    .all();
  const byChannel = new Map();
  for (const r of rows) byChannel.set(r.channelId, [...(byChannel.get(r.channelId) ?? []), r]);
  let posts = 0;
  const errors = [];
  for (const [channelId, list] of byChannel) {
    try {
      const m = await fetchChannelPostMetrics(channelId, list[0].platform, list, AbortSignal.timeout(9e4));
      for (const [postId, v] of m) {
        db.update(scheduledPosts)
          .set({
            reach: v.reach,
            views: v.views,
            engagements: v.engagements,
            avgWatchSec: v.avgWatchSec ?? null,
            metricsAt: new Date(),
          })
          .where(eq(scheduledPosts.id, postId))
          .run();
        posts++;
      }
    } catch (err) {
      errors.push(`${list[0].channelName} (số liệu bài): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { posts, errors };
}
