import { renderProject } from "./render";
import { currentUser } from "../paths";
import { videoProjects, videoScenes, renderJobs, alerts, activityLog } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError, notFound } from "../errors";
import { eq, and, inArray, desc, asc } from "drizzle-orm";

let running = null;
const sceneStates = new Map();

export function recoverInterruptedJobs() {
  getDb().update(renderJobs).set({ status: "failed", error: "Ứng dụng đã đóng khi đang render", finishedAt: new Date() }).where(eq(renderJobs.status, "running")).run();
  void kick();
}

export function enqueueRender(projectId) {
  const db = getDb();
  const project = db.select().from(videoProjects).where(eq(videoProjects.id, projectId)).get();
  if (!project) throw notFound("dự án video");
  const sceneCount = db.select({ id: videoScenes.id }).from(videoScenes).where(eq(videoScenes.projectId, projectId)).all().length;
  if (!sceneCount) throw new ApiError("VALIDATION", "Dự án chưa có phân cảnh để render");
  const pending = db.select({ id: renderJobs.id }).from(renderJobs).where(and(eq(renderJobs.projectId, projectId), inArray(renderJobs.status, ["queued", "running"]))).get();
  if (pending) throw new ApiError("CONFLICT", "Dự án này đang trong hàng đợi render");
  const job = db.insert(renderJobs).values({ id: newId(), projectId, stage: "Đang chờ trong hàng đợi" }).returning().get();
  void kick();
  return { ...job, projectTopic: project.topic };
}

export function cancelRender(id) {
  const db = getDb();
  const job = db.select().from(renderJobs).where(eq(renderJobs.id, id)).get();
  if (!job) throw notFound("job render");
  if (job.status === "queued") {
    db.update(renderJobs).set({ status: "cancelled", stage: "Đã hủy", finishedAt: new Date() }).where(eq(renderJobs.id, id)).run();
  } else if (job.status === "running" && running?.id === id) {
    running.ctl.abort();
  } else {
    throw new ApiError("CONFLICT", "Job đã kết thúc");
  }
}

export function stopAllRenders() {
  running?.ctl.abort();
}

export function listJobs(projectId, limit) {
  return getDb().select({ job: renderJobs, projectTopic: videoProjects.topic }).from(renderJobs).innerJoin(videoProjects, eq(videoProjects.id, renderJobs.projectId)).where(projectId ? eq(renderJobs.projectId, projectId) : void 0).orderBy(desc(renderJobs.createdAt)).limit(limit).all().map((r) => ({ ...r.job, projectTopic: r.projectTopic, scenes: sceneStates.get(r.job.id) ?? null }));
}

export function mediaStatus(encoder) {
  const db = getDb();
  const run = db.select({ id: renderJobs.id, progress: renderJobs.progress, stage: renderJobs.stage, topic: videoProjects.topic }).from(renderJobs).innerJoin(videoProjects, eq(videoProjects.id, renderJobs.projectId)).where(eq(renderJobs.status, "running")).get();
  const queued = db.select({ id: renderJobs.id }).from(renderJobs).where(eq(renderJobs.status, "queued")).all().length;
  return { encoder, running: run ?? null, queued };
}

async function kick() {
  if (running || !currentUser()) return;
  const db = getDb();
  const next = db.select().from(renderJobs).where(eq(renderJobs.status, "queued")).orderBy(asc(renderJobs.createdAt)).get();
  if (!next) return;
  const ctl = new AbortController();
  running = { id: next.id, ctl };
  const notes = [];
  db.update(renderJobs).set({ status: "running", startedAt: new Date(), progress: 0, stage: "Bắt đầu", notes: [] }).where(eq(renderJobs.id, next.id)).run();
  db.update(videoProjects).set({ status: "rendering", updatedAt: new Date() }).where(eq(videoProjects.id, next.projectId)).run();
  const startedAt = Date.now();
  console.info(`[render] bắt đầu job ${next.id.slice(0, 8)}`);
  let lastWrite = 0;
  const report = {
    progress: (ratio, stage) => {
      const now = Date.now();
      if (now - lastWrite < 250) return;
      lastWrite = now;
      db.update(renderJobs).set({ progress: Math.round(ratio * 1e3) / 1e3, stage }).where(eq(renderJobs.id, next.id)).run();
    },
    scene: (index, patch) => {
      const list = sceneStates.get(next.id) ?? [];
      const cur = list[index] ?? { index, status: "waiting", source: null, text: null, progress: null, startedAt: null };
      list[index] = { ...cur, ...patch, index };
      sceneStates.set(next.id, list);
    },
    note: (message) => {
      notes.push(message);
      console.warn(`[render] ${next.id.slice(0, 8)}: ${message}`);
      db.update(renderJobs).set({ notes: [...notes] }).where(eq(renderJobs.id, next.id)).run();
    }
  };
  try {
    const res = await renderProject(next.id, ctl.signal, report);
    db.update(renderJobs).set({ status: "done", progress: 1, stage: "Hoàn tất", outputPath: res.outputPath, encoder: res.encoder, finishedAt: new Date() }).where(eq(renderJobs.id, next.id)).run();
    console.info(
      `[render] xong job ${next.id.slice(0, 8)} · ${res.durationSec.toFixed(1)}s video · ${res.encoder} · ${Math.round((Date.now() - startedAt) / 1e3)}s${notes.length ? ` · ${notes.length} cảnh báo` : ""}`
    );
  } catch (err) {
    const cancelled = ctl.signal.aborted;
    const message = err instanceof Error ? err.message : String(err);
    db.update(renderJobs).set({ status: cancelled ? "cancelled" : "failed", stage: cancelled ? "Đã hủy" : "Lỗi", error: cancelled ? null : message, finishedAt: new Date() }).where(eq(renderJobs.id, next.id)).run();
    db.update(videoProjects).set({ status: "scripted", updatedAt: new Date() }).where(eq(videoProjects.id, next.projectId)).run();
    if (!cancelled) {
      console.error("[render] job lỗi", next.id, message);
      db.insert(alerts).values({
        id: newId(),
        severity: "error",
        kind: "render_failed",
        entityType: "render_job",
        entityId: next.id,
        title: "Render video thất bại",
        message: message.slice(0, 300)
      }).run();
      db.insert(activityLog).values({ level: "error", scope: "render", message: `Render lỗi: ${message.slice(0, 120)}` }).run();
    }
  } finally {
    running = null;
    void kick();
  }
}
