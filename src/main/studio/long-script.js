import { eq, asc, and } from "drizzle-orm";
import { videoProjects, videoScenes } from "../db/schema";
import { getDb, newId } from "../db/index";
import { notFound } from "../errors";
import { AiError } from "../ai/providers";
import { composeShotPrompt } from "../media/prompts";
import { outlineActs, writeActScenes } from "../ai/long-video";
import { fitDurations } from "../api/ai";

const plainMapper = (sc, durationSec, bible) => ({
  label: sc.label || null,
  voiceover: sc.line.trim(),
  durationSec,
  mediaPrompt: composeShotPrompt(sc.shot, bible),
  searchQuery: sc.searchQuery.trim() || null
});

function renumber(projectId) {
  const db = getDb();
  const rows = db.select({ id: videoScenes.id }).from(videoScenes).where(eq(videoScenes.projectId, projectId)).orderBy(asc(videoScenes.act), asc(videoScenes.position)).all();
  rows.forEach((r, i) => db.update(videoScenes).set({ position: i }).where(eq(videoScenes.id, r.id)).run());
}

export async function writeAct(projectId, ctx, index, map = plainMapper) {
  const db = getDb();
  const p = db.select({ acts: videoProjects.acts, bible: videoProjects.visualBible }).from(videoProjects).where(eq(videoProjects.id, projectId)).get();
  if (!p) throw notFound("dự án video");
  const acts = p.acts ?? [];
  if (!acts[index]) throw new AiError("bad_request", `Dự án chưa có dàn ý hồi ${index + 1} – bấm "Sinh kịch bản" để AI viết dàn ý trước`);
  const previousTail = index > 0 ? db.select({ label: videoScenes.label, voiceover: videoScenes.voiceover }).from(videoScenes).where(and(eq(videoScenes.projectId, projectId), eq(videoScenes.act, index - 1))).orderBy(asc(videoScenes.position)).all().slice(-3).map((s) => `${s.label ? `${s.label}: ` : ""}${s.voiceover}`) : [];
  const bible = ctx.bible ?? p.bible ?? null;
  const { scenes, meta } = await writeActScenes({ ...ctx, bible }, acts, index, previousTail);
  const durations = fitDurations(
    scenes.map((s) => s.durationSec),
    acts[index].targetSec
  );
  db.transaction((tx) => {
    tx.delete(videoScenes).where(and(eq(videoScenes.projectId, projectId), eq(videoScenes.act, index))).run();
    tx.insert(videoScenes).values(scenes.map((sc, i) => ({ id: newId(), projectId, act: index, position: 1e5 + i, mediaSource: "stock", ...map(sc, durations[i], bible) }))).run();
    tx.update(videoProjects).set({ status: "scripted", updatedAt: new Date() }).where(eq(videoProjects.id, projectId)).run();
  });
  renumber(projectId);
  return meta;
}

export async function writeLongScript(projectId, ctx, map = plainMapper) {
  const db = getDb();
  const { acts, bible, meta: m0 } = await outlineActs(ctx);
  db.transaction((tx) => {
    tx.delete(videoScenes).where(eq(videoScenes.projectId, projectId)).run();
    tx.update(videoProjects).set({ acts, visualBible: bible, updatedAt: new Date() }).where(eq(videoProjects.id, projectId)).run();
  });
  console.info(`[ai] video dài: dàn ý ${acts.length} hồi · ${ctx.totalSec}s`);
  let cost = m0.costUsd;
  let last = m0;
  for (let i = 0; i < acts.length; i++) {
    try {
      const m = await writeAct(projectId, { ...ctx, bible }, i, map);
      last = m;
      cost = cost == null || m.costUsd == null ? null : cost + m.costUsd;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AiError(
        err instanceof AiError ? err.kind : "unknown",
        `Đã viết ${i}/${acts.length} hồi – hồi ${i + 1} lỗi: ${reason}. Bấm "Viết hồi này" ở hồi ${i + 1} để thử lại (các hồi trước được giữ nguyên).`
      );
    }
  }
  return { meta: { provider: last.providerLabel, model: last.model, costUsd: cost }, acts };
}
