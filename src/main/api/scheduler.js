import { inArray, isNull, eq, and, gte } from "drizzle-orm";
import { workspaces, channels, contentItems, scheduledPosts } from "../db/schema";
import { getDb, newId } from "../db/index";
import { staggerPrefs, setStaggerPrefs, staggerTime } from "../posts/stagger";

const HOUR = 36e5;
const DAY = 24 * HOUR;
const HORIZON_DAYS = 14;
const LEAD_MS = 30 * 6e4;

const DEFAULT_SLOTS = [
  { start: "11:30", end: "13:00", weight: 0.35 },
  { start: "19:30", end: "22:00", weight: 0.45 },
  { start: "07:00", end: "08:30", weight: 0.2 }
];

const PLATFORM_FIT = {
  video: ["tiktok", "youtube", "facebook", "instagram"],
  reel: ["instagram", "tiktok", "youtube", "facebook"],
  carousel: ["instagram", "facebook"],
  image: ["facebook", "instagram"],
  text: ["facebook"]
};

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function findSlot(from, slots, taken, spacingMs, horizonDays = HORIZON_DAYS) {
  const ordered = [...slots.length ? slots : DEFAULT_SLOTS].sort((a, b) => b.weight - a.weight);
  const day0 = new Date(from);
  day0.setHours(0, 0, 0, 0);
  for (let d = 0; d < horizonDays; d++) {
    const dayStart = day0.getTime() + d * DAY;
    const candidates = ordered.map((s) => dayStart + minutesOf(s.start) * 6e4).filter((t) => t >= from);
    for (const t of candidates) {
      if (taken.every((x) => Math.abs(x - t) >= spacingMs)) return t;
    }
  }
  return null;
}

export const schedulerHandlers = {
  "posts.stagger": () => staggerPrefs(),
  "posts.setStagger": (p) => setStaggerPrefs(p),
  "posts.autoSchedule": ({ contentIds, spacingHours }) => {
    const db = getDb();
    const now = Date.now();
    const from = now + LEAD_MS;
    const spacingMs = spacingHours * HOUR;
    return db.transaction((tx) => {
      const items = tx.select().from(contentItems).where(inArray(contentItems.id, contentIds)).all();
      const wsRows = tx.select({ id: workspaces.id, goldenHours: workspaces.goldenHours }).from(workspaces).where(isNull(workspaces.archivedAt)).all();
      const activeChannels = tx.select().from(channels).where(eq(channels.status, "active")).all();
      const existing = tx.select({ channelId: scheduledPosts.channelId, at: scheduledPosts.scheduledAt }).from(scheduledPosts).where(and(eq(scheduledPosts.status, "queued"), gte(scheduledPosts.scheduledAt, new Date(now - DAY)))).all();
      const taken = new Map();
      for (const e of existing) taken.set(e.channelId, [...taken.get(e.channelId) ?? [], e.at.getTime()]);
      const allTimes = existing.map((e) => e.at.getTime());
      const stagger = staggerPrefs(tx);
      const result = { created: [], skipped: [] };
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const contentId of contentIds) {
        const item = byId.get(contentId);
        if (!item) {
          result.skipped.push({ contentId, reason: "Không tìm thấy nội dung" });
          continue;
        }
        if (item.status !== "ready") {
          result.skipped.push({ contentId, reason: 'Chỉ xếp lịch nội dung "Sẵn sàng đăng"' });
          continue;
        }
        const fit = PLATFORM_FIT[item.kind];
        const candidates = activeChannels.filter((c) => c.workspaceId === item.workspaceId && fit.includes(c.platform) && c.tokenStatus !== "expired").sort((a, b) => fit.indexOf(a.platform) - fit.indexOf(b.platform) || (taken.get(a.id)?.length ?? 0) - (taken.get(b.id)?.length ?? 0));
        if (!candidates.length) {
          result.skipped.push({ contentId, reason: "Pocket không có kênh hoạt động phù hợp định dạng" });
          continue;
        }
        const slots = wsRows.find((w) => w.id === item.workspaceId)?.goldenHours ?? [];
        let placed = false;
        for (const ch of candidates) {
          const slot = findSlot(from, slots, taken.get(ch.id) ?? [], spacingMs);
          if (slot == null) continue;
          const t = staggerTime(slot, allTimes, stagger);
          allTimes.push(t);
          const post = tx.insert(scheduledPosts).values({ id: newId(), contentItemId: item.id, channelId: ch.id, scheduledAt: new Date(t), isGoldenHour: true }).returning().get();
          tx.update(contentItems).set({ status: "scheduled", updatedAt: new Date() }).where(eq(contentItems.id, item.id)).run();
          taken.set(ch.id, [...taken.get(ch.id) ?? [], t]);
          result.created.push({ postId: post.id, contentId: item.id, channelName: ch.name, scheduledAt: post.scheduledAt });
          placed = true;
          break;
        }
        if (!placed) result.skipped.push({ contentId, reason: `Hết khung giờ vàng trống trong ${HORIZON_DAYS} ngày tới` });
      }
      return result;
    });
  }
};
