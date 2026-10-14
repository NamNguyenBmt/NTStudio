import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { eq, and, or, isNull, lte, asc, inArray, count } from "drizzle-orm";
import { settings, filmProjects, filmAssets, filmTakes } from "../db/schema";
import { getDb } from "../db/index";
import { AiError } from "../ai/providers";
import { mediaDir } from "../media/paths";
import { generateFilmImage } from "./image";
import { generateFilmVideo } from "./video";
import { adoptIfSeriesMissingImage } from "./series-link";
import { upscaleVideo } from "./upscale";
import { parseUpscale } from "../../shared/upscale";

const KEY = "film.queue";
const RETRY_MS = [3e4, 12e4, 3e5];
const MAX_ATTEMPTS = RETRY_MS.length + 1;
const DEFAULTS = { paused: false, imageConcurrency: 4, videoConcurrency: 2 };

function queuePrefs() {
  const v = getDb().select().from(settings).where(eq(settings.key, KEY)).get()?.value;
  return { ...DEFAULTS, ...v };
}

export function setQueuePrefs(p) {
  const next = { ...queuePrefs(), ...p };
  getDb().insert(settings).values({ key: KEY, value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } }).run();
  kick();
  return next;
}

export const filmDir = (filmId) => join(mediaDir(), "film", filmId);
const active = new Map();
let started = false;
let timer = null;
const runningOf = (kind) => [...active.values()].filter((a) => a.kind === kind).length;
const progress = new Map();
export const takeProgress = (id) => progress.get(id) ?? null;

export function kick() {
  if (!started) return;
  const prefs = queuePrefs();
  if (prefs.paused) return;
  const now = new Date();
  for (const kind of ["image", "video"]) {
    const free = Math.max(0, (kind === "image" ? prefs.imageConcurrency : prefs.videoConcurrency) - runningOf(kind));
    if (!free) continue;
    const next = getDb().select().from(filmTakes).where(and(eq(filmTakes.status, "queued"), eq(filmTakes.kind, kind), or(isNull(filmTakes.notBefore), lte(filmTakes.notBefore, now)))).orderBy(asc(filmTakes.createdAt)).limit(free).all();
    for (const take of next) void runTake(take);
  }
}

const relMedia = (abs) => relative(mediaDir(), abs).split("\\").join("/");

async function runTake(take) {
  const db = getDb();
  const ctrl = new AbortController();
  active.set(take.id, { kind: take.kind, ctrl });
  const claimed = db.update(filmTakes).set({ status: "running", startedAt: new Date(), attempts: take.attempts + 1, error: null }).where(and(eq(filmTakes.id, take.id), eq(filmTakes.status, "queued"))).run();
  if (!claimed.changes) {
    active.delete(take.id);
    return;
  }
  const up = parseUpscale(take.upscale);
  try {
    const film = db.select().from(filmProjects).where(eq(filmProjects.id, take.filmId)).get();
    if (!film) throw new Error("Phim đã bị xóa");
    const dir = filmDir(film.id);
    mkdirSync(dir, { recursive: true });
    const asset = db.select({ kind: filmAssets.kind }).from(filmAssets).where(eq(filmAssets.id, take.assetId)).get();
    let done;
    if (up) {
      const dest = join(dir, `${take.id}.mp4`);
      const model = await upscaleVideo({
        src: join(mediaDir(), take.refs[0] ?? ""),
        dest,
        method: up.method,
        quality: up.quality,
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(20 * 6e4)]),
        onStatus: (st) => progress.set(take.id, st)
      });
      done = { file: dest, model, costUsd: 0 };
    } else if (take.kind === "video") {
      const [start, end] = take.refs.map((f) => join(mediaDir(), f));
      const dest = join(dir, `${take.id}.mp4`);
      const r = await generateFilmVideo({
        film,
        prompt: take.prompt,
        start,
        end: end ?? null,
        shotSec: take.durationSec ?? 6,
        dest,
        // Hàm video tự giới hạn 20 phút; thêm biên an toàn
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(25 * 6e4)]),
        onStatus: (st) => progress.set(take.id, st)
      });
      done = { file: dest, model: r.model, costUsd: r.costUsd };
    } else {
      const r = await generateFilmImage({
        engine: film.imageEngine,
        prompt: take.prompt,
        refs: take.refs.map((f) => join(mediaDir(), f)),
        // Bảng nhân vật luôn ngang (nhiều góc mặt cạnh nhau); bối cảnh / khung hình theo khung phim
        aspect: asset?.kind === "character" ? "16:9" : film.aspect,
        destBase: join(dir, take.id),
        workspaceId: film.workspaceId,
        // Một ảnh không nên quá 3 phút
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(18e4)])
      });
      done = r;
    }
    db.transaction((tx) => {
      tx.update(filmTakes).set({ status: "done", file: relMedia(done.file), model: done.model, costUsd: done.costUsd, finishedAt: new Date() }).where(eq(filmTakes.id, take.id)).run();
      if (up && take.sourceTakeId)
        tx.update(filmAssets).set({ selectedVideoTakeId: take.id, updatedAt: new Date() }).where(and(eq(filmAssets.id, take.assetId), eq(filmAssets.selectedVideoTakeId, take.sourceTakeId))).run();
      if (take.kind === "video")
        tx.update(filmAssets).set({ selectedVideoTakeId: take.id, updatedAt: new Date() }).where(and(eq(filmAssets.id, take.assetId), isNull(filmAssets.selectedVideoTakeId))).run();
      else
        tx.update(filmAssets).set({ selectedTakeId: take.id, updatedAt: new Date() }).where(and(eq(filmAssets.id, take.assetId), isNull(filmAssets.selectedTakeId))).run();
    });
    if (take.kind === "image" && asset?.kind === "character") {
      try {
        adoptIfSeriesMissingImage(take.assetId, relMedia(done.file));
      } catch (err) {
        console.warn("[film] không cập nhật được ảnh chuẩn của nhân vật series", err);
      }
    }
  } catch (err) {
    if (ctrl.signal.aborted) {
      try {
        db.update(filmTakes).set({ finishedAt: new Date() }).where(and(eq(filmTakes.id, take.id), eq(filmTakes.status, "cancelled"))).run();
      } catch {
      }
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const kind = err instanceof AiError ? err.kind : "network";
    if (kind === "budget") {
      setQueuePrefs({ paused: true });
      db.update(filmTakes).set({ status: "queued", error: `Tạm dừng: ${msg}` }).where(eq(filmTakes.id, take.id)).run();
      console.warn("[film] chạm hạn mức chi tiêu → tạm dừng hàng đợi");
      return;
    }
    const temporary = !up && (["rate_limit", "overloaded", "timeout", "network"].includes(kind) || err instanceof TypeError);
    if (temporary && take.attempts + 1 < MAX_ATTEMPTS) {
      const wait = RETRY_MS[take.attempts] ?? RETRY_MS[RETRY_MS.length - 1];
      db.update(filmTakes).set({ status: "queued", error: `${msg} – thử lại sau ${Math.round(wait / 1e3)}s`, notBefore: new Date(Date.now() + wait) }).where(eq(filmTakes.id, take.id)).run();
    } else {
      db.update(filmTakes).set({ status: "failed", error: msg.slice(0, 500), finishedAt: new Date() }).where(eq(filmTakes.id, take.id)).run();
    }
  } finally {
    progress.delete(take.id);
    if (active.get(take.id)?.ctrl === ctrl) active.delete(take.id);
    kick();
  }
}

export function cancelTakes(ids) {
  if (!ids.length) return 0;
  const db = getDb();
  const res = db.update(filmTakes).set({ status: "cancelled", finishedAt: new Date() }).where(and(inArray(filmTakes.id, ids), inArray(filmTakes.status, ["queued", "running"]))).run();
  for (const id of ids) active.get(id)?.ctrl.abort();
  return res.changes;
}

export function queueStatus(filmId) {
  const db = getDb();
  const prefs = queuePrefs();
  const byStatus = (where) => Object.fromEntries(
    db.select({ status: filmTakes.status, n: count() }).from(filmTakes).where(where).groupBy(filmTakes.status).all().map((r) => [r.status, r.n])
  );
  const all = byStatus();
  const film = filmId ? byStatus(eq(filmTakes.filmId, filmId)) : null;
  return {
    ...prefs,
    queued: all.queued ?? 0,
    running: all.running ?? 0,
    ...film ? { film: { queued: film.queued ?? 0, running: film.running ?? 0, done: film.done ?? 0, failed: film.failed ?? 0 } } : {}
  };
}

export function startFilmQueue() {
  stopFilmQueue();
  getDb().update(filmTakes).set({ status: "queued" }).where(eq(filmTakes.status, "running")).run();
  started = true;
  kick();
  timer = setInterval(kick, 1e4);
}

export function stopFilmQueue() {
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  for (const a of active.values()) a.ctrl.abort();
  active.clear();
}
