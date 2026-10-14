import { eq, inArray, desc, and } from "drizzle-orm";
import { channels, activityLog, settings } from "./db/schema";
import { getDb } from "./db/index";
import { ApiError } from "./errors";
import { licenseUsable, licenseLimits } from "./license/index";

let needsPick = false;
const LIMIT_KEY = "quota.lastLimit";

function lastLimit() {
  const row = getDb().select().from(settings).where(eq(settings.key, LIMIT_KEY)).get();
  return row ? row.value : void 0;
}

function saveLimit(limit) {
  getDb()
    .insert(settings)
    .values({ key: LIMIT_KEY, value: limit })
    .onConflictDoUpdate({ target: settings.key, set: { value: limit, updatedAt: new Date() } })
    .run();
}

const listeners = new Set();

export function onQuotaChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const emit = () => listeners.forEach((l) => l());
const activeRows = () =>
  getDb()
    .select()
    .from(channels)
    .where(inArray(channels.status, ["active", "error"]))
    .orderBy(desc(channels.updatedAt))
    .all();
const blockedRows = () =>
  getDb().select().from(channels).where(eq(channels.quotaBlocked, true)).orderBy(desc(channels.updatedAt)).all();

export const channelIds = () =>
  new Set(
    getDb()
      .select({ id: channels.id })
      .from(channels)
      .all()
      .map((r) => r.id),
  );

function block(ids) {
  if (!ids.length) return;
  getDb().update(channels).set({ status: "paused", quotaBlocked: true }).where(inArray(channels.id, ids)).run();
}

function unblock(ids) {
  if (!ids.length) return;
  getDb()
    .update(channels)
    .set({ status: "active", quotaBlocked: false })
    .where(and(inArray(channels.id, ids), eq(channels.quotaBlocked, true)))
    .run();
}

function log(message) {
  getDb().insert(activityLog).values({ level: "warn", scope: "license", message }).run();
}

export function enforceQuota(newIds = new Set()) {
  if (!licenseUsable()) return 0;
  const limit = licenseLimits().maxChannels;
  const prev = lastLimit();
  const grew = prev === void 0 || limit === null || (prev !== null && limit > prev);
  if (prev !== limit) saveLimit(limit);
  const active = activeRows();
  if (limit === null) {
    const b = blockedRows();
    unblock(b.map((r) => r.id));
    if (b.length) log(`Gói không giới hạn kênh – đã bật lại ${b.length} kênh ngoài hạn mức`);
    needsPick = false;
    if (b.length) emit();
    return 0;
  }
  if (active.length > limit) {
    const ordered = [...active.filter((r) => !newIds.has(r.id)), ...active.filter((r) => newIds.has(r.id))];
    const extra = ordered.slice(limit);
    block(extra.map((r) => r.id));
    needsPick = true;
    log(
      `Vượt hạn mức ${limit} kênh của gói – tạm dừng ${extra.length} kênh: ${extra
        .map((r) => r.name)
        .join(", ")
        .slice(0, 300)}`,
    );
    emit();
    return extra.length;
  }
  if (grew && active.length < limit) {
    const b = blockedRows().slice(0, limit - active.length);
    unblock(b.map((r) => r.id));
    if (b.length) {
      log(`Hạn mức kênh tăng lên ${limit} – đã bật lại ${b.length} kênh`);
      emit();
    }
  }
  if (!blockedRows().length) needsPick = false;
  return 0;
}

export function quotaState() {
  const limit = licenseLimits().maxChannels;
  const brief = (r) => ({
    id: r.id,
    name: r.name,
    platform: r.platform,
    kind: r.kind,
    avatarUrl: r.avatarUrl,
    followers: r.followers,
    active: r.status !== "paused",
    quotaBlocked: r.quotaBlocked,
  });
  const list = [...activeRows(), ...blockedRows()].map(brief);
  const used = list.filter((c) => c.active).length;
  return {
    limit,
    used,
    blocked: list.filter((c) => c.quotaBlocked).length,
    needsPick: needsPick && list.some((c) => c.quotaBlocked),
    channels: list,
  };
}

export function setQuotaSelection(activeIds) {
  const limit = licenseLimits().maxChannels;
  const want = new Set(activeIds);
  if (limit !== null && want.size > limit)
    throw new ApiError("VALIDATION", `Gói hiện tại dùng tối đa ${limit} kênh – bỏ chọn bớt ${want.size - limit} kênh`);
  const pool = [...activeRows(), ...blockedRows()];
  unblock(pool.filter((r) => want.has(r.id) && r.quotaBlocked).map((r) => r.id));
  block(pool.filter((r) => !want.has(r.id)).map((r) => r.id));
  needsPick = false;
  emit();
  return quotaState();
}
