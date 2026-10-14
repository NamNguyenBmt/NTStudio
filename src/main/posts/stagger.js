import { eq, gte, lte, ne, and } from "drizzle-orm";
import { scheduledPosts, settings } from "../db/schema";
import { getDb } from "../db/index";

const KEY = "posts.stagger";
const MIN = 6e4;

const DEFAULT_STAGGER = { enabled: true, minMinutes: 5, maxMinutes: 25 };

export function staggerPrefs(db = getDb()) {
  const v = db.select().from(settings).where(eq(settings.key, KEY)).get()?.value;
  return { ...DEFAULT_STAGGER, ...v };
}

export function setStaggerPrefs(p) {
  const next = { ...staggerPrefs(), ...p };
  if (next.maxMinutes < next.minMinutes) next.maxMinutes = next.minMinutes;
  getDb()
    .insert(settings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } })
    .run();
  return next;
}

export function staggerTime(at, others, prefs, rand = Math.random) {
  if (!prefs.enabled || prefs.minMinutes <= 0) return at;
  const gap = prefs.minMinutes * MIN;
  let t = at;
  for (let i = 0; i < 500; i++) {
    const clash = others.filter((x) => Math.abs(x - t) < gap);
    if (!clash.length) return t;
    const step = (prefs.minMinutes + rand() * (prefs.maxMinutes - prefs.minMinutes)) * MIN;
    t = Math.ceil((Math.max(...clash) + step) / MIN) * MIN;
  }
  return t;
}

export function queuedTimesNear(db, at, excludeId) {
  const where = [
    eq(scheduledPosts.status, "queued"),
    gte(scheduledPosts.scheduledAt, new Date(at - 2 * 36e5)),
    lte(scheduledPosts.scheduledAt, new Date(at + 48 * 36e5)),
  ];
  if (excludeId) where.push(ne(scheduledPosts.id, excludeId));
  return db
    .select({ at: scheduledPosts.scheduledAt })
    .from(scheduledPosts)
    .where(and(...where))
    .all()
    .map((r) => r.at.getTime());
}
