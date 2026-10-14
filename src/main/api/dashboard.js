import { count, eq, and, gte, sum, sql, asc, isNull, desc } from "drizzle-orm";
import { PLATFORMS, proxies, accounts, channels, channelMetricsDaily, videoProjects, renderJobs, scheduledPosts, messages, autoReplyRules, alerts, activityLog } from "../db/schema";
import { getDb } from "../db/index";
import { notFound } from "../errors";
import { byWorkspace } from "./accounts";

const DAY = 864e5;
const pctChange = (cur, prev) => prev ? Math.round((cur - prev) / prev * 1e3) / 10 : null;

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function computeSummary(workspaceId, now = Date.now()) {
  const db = getDb();
  const ws = byWorkspace(channels.workspaceId, workspaceId);
  const chanRows = db.select({ platform: channels.platform, health: channels.health, createdAt: channels.createdAt }).from(channels).where(ws).all();
  const byPlatform = { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 };
  const health = { ok: 0, warn: 0, error: 0, idle: 0 };
  let addedThisWeek = 0;
  for (const c of chanRows) {
    byPlatform[c.platform]++;
    health[c.health]++;
    if (c.createdAt.getTime() >= now - 7 * DAY) addedThisWeek++;
  }
  const total = chanRows.length;
  const score = total ? Math.round((health.ok + health.warn * 0.5) / total * 1e3) / 10 : 0;
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
  const postStats = db.select({ status: scheduledPosts.status, n: count() }).from(scheduledPosts).innerJoin(channels, eq(channels.id, scheduledPosts.channelId)).where(and(ws, gte(scheduledPosts.scheduledAt, monthStart))).groupBy(scheduledPosts.status).all();
  const queuedAll = db.select({ n: count() }).from(scheduledPosts).innerJoin(channels, eq(channels.id, scheduledPosts.channelId)).where(and(ws, eq(scheduledPosts.status, "queued"))).get();
  const stat = (s) => postStats.find((p) => p.status === s)?.n ?? 0;
  const published = stat("published");
  const failed = stat("failed");
  const today = isoDay(now);
  const todayViews = db.select({ v: sum(channelMetricsDaily.views).mapWith(Number) }).from(channelMetricsDaily).innerJoin(channels, eq(channels.id, channelMetricsDaily.channelId)).where(and(ws, eq(channelMetricsDaily.day, today))).get()?.v;
  const endOffset = todayViews ? 0 : 1;
  const from30 = isoDay(now - (29 + endOffset) * DAY);
  const from60 = isoDay(now - (59 + endOffset) * DAY);
  const metrics = db.select({
    day: channelMetricsDaily.day,
    platform: channels.platform,
    views: sum(channelMetricsDaily.views).mapWith(Number),
    engagements: sum(channelMetricsDaily.engagements).mapWith(Number)
  }).from(channelMetricsDaily).innerJoin(channels, eq(channels.id, channelMetricsDaily.channelId)).where(and(ws, gte(channelMetricsDaily.day, from60), sql`${channelMetricsDaily.day} <= ${today}`)).groupBy(channelMetricsDaily.day, channels.platform).orderBy(asc(channelMetricsDaily.day)).all();
  const byDay = new Map();
  const prevByPlatform = { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 };
  for (const m of metrics) {
    if (m.day > isoDay(now - endOffset * DAY)) continue;
    if (m.day < from30) {
      prevByPlatform[m.platform] += m.views;
      continue;
    }
    const point = byDay.get(m.day) ?? { day: m.day, views: 0, engagements: 0, byPlatform: { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 } };
    point.views += m.views;
    point.engagements += m.engagements;
    point.byPlatform[m.platform] += m.views;
    byDay.set(m.day, point);
  }
  const series = [];
  for (let i = 29 + endOffset; i >= endOffset; i--) {
    const day = isoDay(now - i * DAY);
    series.push(byDay.get(day) ?? { day, views: 0, engagements: 0, byPlatform: { facebook: 0, tiktok: 0, instagram: 0, youtube: 0 } });
  }
  const views30d = series.reduce((a, p) => a + p.views, 0);
  const engagements30d = series.reduce((a, p) => a + p.engagements, 0);
  const prevViews = prevByPlatform.facebook + prevByPlatform.tiktok + prevByPlatform.instagram + prevByPlatform.youtube;
  const platforms = PLATFORMS.map((platform) => {
    const cur = series.reduce((a, p) => a + p.byPlatform[platform], 0);
    return { platform, views30d: cur, changePct: pctChange(cur, prevByPlatform[platform]) };
  });
  const proxyRows = db.select({ health: proxies.health }).from(proxies).where(byWorkspace(proxies.workspaceId, workspaceId)).all();
  const openAlerts = db.select({ n: count() }).from(alerts).where(isNull(alerts.resolvedAt)).get();
  return {
    channels: { total, byPlatform, addedThisWeek },
    health: { ...health, score },
    posts: {
      publishedThisMonth: published,
      queued: queuedAll?.n ?? 0,
      failedThisMonth: failed,
      successRate: published + failed ? Math.round(published / (published + failed) * 1e3) / 10 : null
    },
    reach: {
      views30d,
      engagements30d,
      viewsChangePct: pctChange(views30d, prevViews),
      series,
      platforms
    },
    proxies: { total: proxyRows.length, ok: proxyRows.filter((p) => p.health === "ok").length },
    openAlerts: openAlerts?.n ?? 0
  };
}

function topChannels(workspaceId, limit, now = Date.now()) {
  const db = getDb();
  const today = isoDay(now);
  const weekAgo = isoDay(now - 7 * DAY);
  const gain = sql`coalesce(
    max(case when ${channelMetricsDaily.day} = (select max(d.day) from channel_metrics_daily d where d.channel_id = ${channels.id} and d.followers > 0 and d.day between ${weekAgo} and ${today}) then ${channelMetricsDaily.followers} end)
    - max(case when ${channelMetricsDaily.day} = (select min(d.day) from channel_metrics_daily d where d.channel_id = ${channels.id} and d.followers > 0 and d.day between ${weekAgo} and ${today}) then ${channelMetricsDaily.followers} end), 0)`.mapWith(
    Number
  );
  const rows = db.select({
    id: channels.id,
    name: channels.name,
    handle: channels.handle,
    externalId: channels.externalId,
    platform: channels.platform,
    followers: channels.followers,
    proxyLabel: proxies.label,
    gain
  }).from(channels).innerJoin(accounts, eq(accounts.id, channels.accountId)).leftJoin(proxies, eq(proxies.id, accounts.proxyId)).leftJoin(channelMetricsDaily, eq(channelMetricsDaily.channelId, channels.id)).where(byWorkspace(channels.workspaceId, workspaceId)).groupBy(channels.id).orderBy(desc(gain)).limit(limit).all();
  return rows.map(({ gain: followerGain7d, ...r }) => ({ ...r, followerGain7d }));
}

function daemonStatus(workspaceId, now = Date.now()) {
  const db = getDb();
  const jobs = db.select({ status: renderJobs.status, n: count() }).from(renderJobs).innerJoin(videoProjects, eq(videoProjects.id, renderJobs.projectId)).where(byWorkspace(videoProjects.workspaceId, workspaceId)).groupBy(renderJobs.status).all();
  const current = db.select({ topic: videoProjects.topic, progress: renderJobs.progress, encoder: renderJobs.encoder }).from(renderJobs).innerJoin(videoProjects, eq(videoProjects.id, renderJobs.projectId)).where(and(eq(renderJobs.status, "running"), byWorkspace(videoProjects.workspaceId, workspaceId))).orderBy(asc(renderJobs.startedAt)).get();
  const upcoming = db.select({ scheduledAt: scheduledPosts.scheduledAt, channelName: channels.name }).from(scheduledPosts).innerJoin(channels, eq(channels.id, scheduledPosts.channelId)).where(
    and(
      eq(scheduledPosts.status, "queued"),
      gte(scheduledPosts.scheduledAt, new Date(now)),
      sql`${scheduledPosts.scheduledAt} < ${now + DAY}`,
      byWorkspace(channels.workspaceId, workspaceId)
    )
  ).orderBy(asc(scheduledPosts.scheduledAt)).all();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const rules = db.select({ n: count() }).from(autoReplyRules).where(and(eq(autoReplyRules.enabled, true), byWorkspace(autoReplyRules.workspaceId, workspaceId))).get();
  const botReplies = db.select({ n: count() }).from(messages).where(and(eq(messages.author, "bot"), gte(messages.createdAt, startOfDay))).get();
  const jobCount = (s) => jobs.find((j) => j.status === s)?.n ?? 0;
  return {
    render: { running: jobCount("running"), queued: jobCount("queued"), current: current ?? null },
    publish: {
      next24h: upcoming.length,
      nextAt: upcoming[0]?.scheduledAt ?? null,
      nextChannels: [...new Set(upcoming.map((u) => u.channelName))].slice(0, 3)
    },
    autoReply: { enabledRules: rules?.n ?? 0, botRepliesToday: botReplies?.n ?? 0 }
  };
}

export const dashboardHandlers = {
  "dashboard.summary": ({ workspaceId }) => computeSummary(workspaceId),
  "dashboard.topChannels": ({ workspaceId, limit }) => topChannels(workspaceId, limit),
  "dashboard.daemon": ({ workspaceId }) => daemonStatus(workspaceId),
  "alerts.open": () => getDb().select().from(alerts).where(isNull(alerts.resolvedAt)).orderBy(sql`case ${alerts.severity} when 'error' then 0 when 'warn' then 1 else 2 end`, desc(alerts.createdAt)).all(),
  "alerts.resolve": ({ id }) => {
    const res = getDb().update(alerts).set({ resolvedAt: new Date() }).where(and(eq(alerts.id, id), isNull(alerts.resolvedAt))).run();
    if (res.changes === 0) throw notFound("cảnh báo");
  },
  "activity.recent": ({ limit }) => getDb().select().from(activityLog).orderBy(desc(activityLog.id)).limit(limit).all()
};
