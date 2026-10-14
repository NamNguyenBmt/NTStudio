import { syncPostMetrics } from "./post-metrics";
import { eq, and, ne } from "drizzle-orm";
import { channels, channelMetricsDaily, settings } from "../db/schema";
import { getDb } from "../db/index";
import { PublishError, graph, tiktok } from "../publish/http";
import { readCred, freshTikTokCred } from "../publish/credentials";
import { freshYoutubeCred, youtubeDaily } from "../publish/youtube";

const DAY = 864e5;
const DAYS = 60;
const EVERY_MS = 6 * 36e5;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

async function dailyMetric(objectId, token, candidates, signal, extra = {}) {
  const until = Math.floor(Date.now() / 1e3);
  const since = until - DAYS * 86400;
  for (const metric of candidates) {
    try {
      const r = await graph("GET", `${objectId}/insights`, {
        token,
        signal,
        query: { metric, period: "day", since, until, ...extra },
      });
      const values = new Map();
      for (const v of r.data?.[0]?.values ?? []) {
        const day = isoDay(new Date(v.end_time).getTime() - DAY / 2);
        const n =
          typeof v.value === "number"
            ? v.value
            : Object.values(v.value ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
        values.set(day, (values.get(day) ?? 0) + n);
      }
      return { metric, values };
    } catch (err) {
      if (err instanceof PublishError && (err.kind === "auth" || err.kind === "rate_limit")) throw err;
    }
  }
  return null;
}

function merge(target, key, values) {
  for (const [day, n] of values ?? []) target.set(day, { ...target.get(day), [key]: n });
}

async function facebookDaily(token, pageId, signal) {
  const daily = new Map();
  const notes = [];
  const views = await dailyMetric(
    pageId,
    token,
    ["page_media_view", "page_views_total", "page_impressions_unique", "page_impressions"],
    signal,
  );
  const eng = await dailyMetric(
    pageId,
    token,
    ["page_post_engagements", "page_total_actions", "page_engaged_users"],
    signal,
  );
  merge(daily, "views", views?.values);
  merge(daily, "engagements", eng?.values);
  const watch = await dailyMetric(pageId, token, ["page_video_view_time"], signal);
  if (watch) merge(daily, "watchMinutes", new Map([...watch.values].map(([d, ms]) => [d, ms / 6e4])));
  if (!views) notes.push("không lấy được lượt xem (thiếu quyền read_insights hoặc Page chưa đủ dữ liệu)");
  if (!eng) notes.push("không lấy được tương tác");
  const page = await graph("GET", pageId, { token, signal, query: { fields: "followers_count,fan_count" } });
  return { daily, followers: page.followers_count ?? page.fan_count ?? null, notes };
}

async function instagramDaily(token, igUserId, signal) {
  const daily = new Map();
  const notes = [];
  const reach = await dailyMetric(igUserId, token, ["reach", "impressions"], signal);
  merge(daily, "views", reach?.values);
  if (!reach) notes.push("không lấy được reach (thiếu quyền instagram_manage_insights)");
  const media = await graph("GET", `${igUserId}/media`, {
    token,
    signal,
    query: { fields: "timestamp,like_count,comments_count", limit: 100 },
  });
  const cutoff = Date.now() - DAYS * DAY;
  const eng = new Map();
  for (const m of media.data ?? []) {
    const t = new Date(m.timestamp).getTime();
    if (t < cutoff) continue;
    const day = isoDay(t);
    eng.set(day, (eng.get(day) ?? 0) + (m.like_count ?? 0) + (m.comments_count ?? 0));
  }
  merge(daily, "engagements", eng);
  const me = await graph("GET", igUserId, { token, signal, query: { fields: "followers_count" } });
  return { daily, followers: me.followers_count ?? null, notes };
}

async function tiktokDaily(token, signal) {
  try {
    const r = await tiktok("/v2/user/info/", { token, signal, method: "GET", query: { fields: "follower_count" } });
    return { daily: new Map(), followers: r.user?.follower_count ?? null, notes: [] };
  } catch (err) {
    if (err instanceof PublishError && err.kind === "auth") throw err;
    return { daily: new Map(), followers: null, notes: ["TikTok: cần quyền user.info.stats để lấy số người theo dõi"] };
  }
}

function save(channelId, daily, followers) {
  const db = getDb();
  const today = isoDay(Date.now());
  if (followers != null) daily.set(today, { ...daily.get(today), followers });
  let rows = 0;
  db.transaction((tx) => {
    for (const [day, v] of daily) {
      const set = {
        ...(v.views != null ? { views: Math.round(v.views) } : {}),
        ...(v.engagements != null ? { engagements: Math.round(v.engagements) } : {}),
        ...(v.followers != null ? { followers: v.followers } : {}),
        ...(v.watchMinutes != null ? { watchMinutes: Math.round(v.watchMinutes) } : {}),
      };
      if (!Object.keys(set).length) continue;
      tx.insert(channelMetricsDaily)
        .values({
          channelId,
          day,
          views: set.views ?? 0,
          engagements: set.engagements ?? 0,
          followers: set.followers ?? 0,
          watchMinutes: set.watchMinutes ?? 0,
        })
        .onConflictDoUpdate({ target: [channelMetricsDaily.channelId, channelMetricsDaily.day], set })
        .run();
      rows++;
    }
    if (followers != null)
      tx.update(channels).set({ followers, updatedAt: new Date() }).where(eq(channels.id, channelId)).run();
  });
  return rows;
}

let running = null;
let timer = null;

export function lastInsightsSync() {
  return getDb().select().from(settings).where(eq(settings.key, "insights.lastSync")).get()?.value ?? null;
}

export function syncInsights() {
  if (running) return running;
  running = (async () => {
    const db = getDb();
    const list = db
      .select()
      .from(channels)
      .where(and(ne(channels.tokenStatus, "missing"), eq(channels.status, "active")))
      .all();
    const result = { at: Date.now(), channels: 0, days: 0, posts: 0, errors: [], notes: [] };
    for (const ch of list) {
      const cred = readCred(ch.id);
      if (!cred) continue;
      const signal = AbortSignal.timeout(6e4);
      try {
        const r =
          ch.platform === "facebook" && cred.pageId
            ? await facebookDaily(cred.token, cred.pageId, signal)
            : ch.platform === "instagram" && cred.igUserId
              ? await instagramDaily(cred.token, cred.igUserId, signal)
              : ch.platform === "tiktok"
                ? await tiktokDaily((await freshTikTokCred(ch.id, cred, signal)).token, signal)
                : ch.platform === "youtube"
                  ? await youtubeDaily((await freshYoutubeCred(ch.id, cred, signal)).token, signal)
                  : null;
        if (!r) continue;
        result.days += save(ch.id, r.daily, r.followers);
        result.channels++;
        for (const n of r.notes) result.notes.push(`${ch.name}: ${n}`);
      } catch (err) {
        result.errors.push(`${ch.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const pm = await syncPostMetrics();
    result.posts = pm.posts;
    result.errors.push(...pm.errors);
    db.insert(settings)
      .values({ key: "insights.lastSync", value: result })
      .onConflictDoUpdate({ target: settings.key, set: { value: result, updatedAt: new Date() } })
      .run();
    if (result.channels || result.errors.length)
      console.info(
        `[insights] ${result.channels} kênh · ${result.days} ngày số liệu · ${result.posts} bài · ${result.errors.length} lỗi`,
      );
    for (const e of result.errors) console.warn("[insights]", e);
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startInsights() {
  stopInsights();
  setTimeout(() => {
    if (!timer) return;
    const last = lastInsightsSync();
    if (!last || Date.now() - last.at > EVERY_MS) void syncInsights().catch(() => void 0);
  }, 2e4);
  timer = setInterval(() => void syncInsights().catch(() => void 0), EVERY_MS);
}

export function stopInsights() {
  if (timer) clearInterval(timer);
  timer = null;
}
