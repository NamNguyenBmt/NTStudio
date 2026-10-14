import { eq, and, isNotNull, isNull, lte, gte, inArray, desc } from "drizzle-orm";
import { channels, contentItems, scheduledPosts, alerts } from "../db/schema";
import { getDb, newId } from "../db/index";
import { fetchChannelPostMetrics } from "./post-metrics";

const HOUR = 36e5;
const CHECK_AFTER = 2 * HOUR;
const GIVE_UP_AFTER = 6 * HOUR;
const EVERY_MS = 15 * 6e4;
const MIN_HISTORY = 3;
const HISTORY = 10;
const LOW_RATIO = 0.25;
const MIN_BASELINE = 20;

const metricOf = (m) =>
  m.views != null
    ? { value: m.views, label: "lượt xem" }
    : m.reach != null
      ? { value: m.reach, label: "lượt tiếp cận" }
      : m.engagements != null
        ? { value: m.engagements, label: "tương tác" }
        : null;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

function judge(value, history) {
  const baseline = history.length >= MIN_HISTORY ? median(history) : null;
  if (value === 0) return { flag: "zero", baseline };
  if (baseline != null && baseline >= MIN_BASELINE && value < baseline * LOW_RATIO) return { flag: "low", baseline };
  return { flag: "ok", baseline };
}

let running = false;

async function runEarlyCheck(now = Date.now()) {
  if (running) return [];
  running = true;
  try {
    const db = getDb();
    const due = db
      .select({
        id: scheduledPosts.id,
        externalId: scheduledPosts.externalPostId,
        publishedAt: scheduledPosts.publishedAt,
        channelId: scheduledPosts.channelId,
        platform: channels.platform,
        channelName: channels.name,
        title: contentItems.title,
      })
      .from(scheduledPosts)
      .innerJoin(channels, eq(channels.id, scheduledPosts.channelId))
      .innerJoin(contentItems, eq(contentItems.id, scheduledPosts.contentItemId))
      .where(
        and(
          eq(scheduledPosts.status, "published"),
          isNotNull(scheduledPosts.externalPostId),
          isNull(scheduledPosts.earlyCheckedAt),
          lte(scheduledPosts.publishedAt, new Date(now - CHECK_AFTER)),
          gte(scheduledPosts.publishedAt, new Date(now - 7 * 24 * HOUR)),
        ),
      )
      .all();
    if (!due.length) return [];
    const flagged = [];
    const byChannel = new Map();
    for (const r of due) byChannel.set(r.channelId, [...(byChannel.get(r.channelId) ?? []), r]);
    for (const [channelId, list] of byChannel) {
      const stale = list.filter((p) => now - p.publishedAt.getTime() > GIVE_UP_AFTER);
      const fresh = list.filter((p) => now - p.publishedAt.getTime() <= GIVE_UP_AFTER);
      if (stale.length)
        db.update(scheduledPosts)
          .set({ earlyFlag: "unknown", earlyCheckedAt: new Date(now) })
          .where(
            inArray(
              scheduledPosts.id,
              stale.map((p) => p.id),
            ),
          )
          .run();
      if (!fresh.length) continue;
      let metrics;
      try {
        metrics = await fetchChannelPostMetrics(channelId, fresh[0].platform, fresh, AbortSignal.timeout(9e4));
      } catch (err) {
        console.warn(
          `[early] ${fresh[0].channelName}: không lấy được số liệu`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
      const history = db
        .select({ v: scheduledPosts.earlyMetric })
        .from(scheduledPosts)
        .where(
          and(
            eq(scheduledPosts.channelId, channelId),
            isNotNull(scheduledPosts.earlyMetric),
            inArray(scheduledPosts.earlyFlag, ["ok", "low", "zero"]),
          ),
        )
        .orderBy(desc(scheduledPosts.publishedAt))
        .limit(HISTORY)
        .all()
        .map((r) => r.v);
      for (const p of fresh) {
        const m = metrics.get(p.id);
        const metric = m && metricOf(m);
        if (!m || !metric) continue;
        const { flag, baseline } = judge(metric.value, history);
        db.update(scheduledPosts)
          .set({
            reach: m.reach,
            views: m.views,
            engagements: m.engagements,
            avgWatchSec: m.avgWatchSec ?? null,
            metricsAt: new Date(now),
            earlyMetric: metric.value,
            earlyBaseline: baseline,
            earlyFlag: flag,
            earlyCheckedAt: new Date(now),
          })
          .where(eq(scheduledPosts.id, p.id))
          .run();
        if (flag === "ok") continue;
        const hours = Math.round((now - p.publishedAt.getTime()) / HOUR);
        db.insert(alerts)
          .values({
            id: newId(),
            severity: "warn",
            kind: "low_reach",
            entityType: "post",
            entityId: p.id,
            title: `Bài phân phối kém: ${p.title.slice(0, 80)}`,
            message:
              flag === "zero"
                ? `${p.channelName} · sau ${hours} giờ vẫn 0 ${metric.label}. Kiểm tra bài có bị giới hạn / chờ duyệt trên nền tảng, nhạc hoặc hình có vi phạm bản quyền không.`
                : `${p.channelName} · sau ${hours} giờ: ${metric.value} ${metric.label}, kênh thường đạt ~${baseline}. Thử đổi caption / thumbnail / 3 giây mở đầu, hoặc tránh đăng cùng nội dung trùng lặp ở nhiều kênh.`,
          })
          .run();
        flagged.push({
          postId: p.id,
          title: p.title,
          channelName: p.channelName,
          metric: metric.value,
          baseline,
          flag,
        });
      }
    }
    return flagged;
  } finally {
    running = false;
  }
}

let timer = null;
let onFlagged = null;

export function bindEarlyCheckEvents(cb) {
  onFlagged = cb;
}

const tick = () =>
  void runEarlyCheck()
    .then((posts) => posts.length && onFlagged?.(posts))
    .catch((err) => console.warn("[early] lỗi kiểm tra bài sau đăng", err));

export function startEarlyCheck() {
  stopEarlyCheck();
  timer = setInterval(tick, EVERY_MS);
  setTimeout(() => timer && tick(), 6e4);
}

export function stopEarlyCheck() {
  if (timer) clearInterval(timer);
  timer = null;
}
