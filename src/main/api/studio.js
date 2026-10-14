import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq, asc, count, sum, desc } from "drizzle-orm";
import { contentItems, videoProjects, videoScenes, series, seriesCharacters, seriesEpisodes } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError, notFound } from "../errors";
import { mediaDir } from "../media/paths";
import { segmentsDir } from "../media/render";
import { byWorkspace } from "./accounts";

const okImage = (p) => !!p && /^(uploads|cache\/ai|series\/[\w-]+)\/[\w.-]+$/.test(p) && existsSync(join(mediaDir(), p));

function checkRefs(list) {
  if (!list) return void 0;
  const bad = list.find((p) => !okImage(p));
  if (bad) throw new ApiError("VALIDATION", "Ảnh tham chiếu không hợp lệ – chọn lại ảnh");
  return [...new Set(list)];
}

function characterRefsOf(projectId) {
  const db = getDb();
  const ep = db.select({ seriesId: seriesEpisodes.seriesId }).from(seriesEpisodes).where(eq(seriesEpisodes.projectId, projectId)).get();
  if (!ep) return [];
  return db.select().from(seriesCharacters).where(eq(seriesCharacters.seriesId, ep.seriesId)).orderBy(asc(seriesCharacters.sortOrder)).all().filter((c) => okImage(c.referenceImage)).map((c) => ({ id: c.id, name: c.name, image: c.referenceImage }));
}

export const studioHandlers = {
  /**
   * Prompt thủ công (Google Vids / Flow): kịch bản + nhân vật + phong cách. Tập phim: prompt hình của cảnh đã gồm
   * "phong cách. Tên: ngoại hình. mô tả" → tách lại để prompt tổng không lặp ngoại hình ở mọi cảnh.
   */
  "studio.promptExport": ({ id }) => {
    const db = getDb();
    const p = db.select().from(videoProjects).where(eq(videoProjects.id, id)).get();
    if (!p) throw notFound("dự án video");
    const scenes = db.select().from(videoScenes).where(eq(videoScenes.projectId, id)).orderBy(asc(videoScenes.position)).all();
    const ep = db.select({ seriesId: seriesEpisodes.seriesId }).from(seriesEpisodes).where(eq(seriesEpisodes.projectId, id)).get();
    const s = ep ? db.select().from(series).where(eq(series.id, ep.seriesId)).get() : void 0;
    const chars = ep ? db.select().from(seriesCharacters).where(eq(seriesCharacters.seriesId, ep.seriesId)).orderBy(asc(seriesCharacters.sortOrder)).all() : [];
    const styles = [s?.visualStyleEn, s?.visualStyle].filter((x) => !!x?.trim());
    const looks = chars.map((c) => ({ c, segs: [c.appearanceEn, c.appearance].filter((x) => !!x?.trim()).map((a) => `${c.name}: ${a}`) }));
    let t = 0;
    return {
      title: p.topic,
      aspect: p.aspect,
      totalSec: Math.round(scenes.reduce((a, x) => a + x.durationSec, 0)),
      style: s?.visualStyleEn || s?.visualStyle || null,
      characters: chars.map((c) => ({ name: c.name, role: c.role, look: c.appearanceEn || c.appearance })),
      acts: (p.acts ?? []).map((a) => ({ title: a.title, summary: a.summary })),
      scenes: scenes.map((x, index) => {
        let visual = x.mediaPrompt ?? "";
        const present = [];
        const composed = /Lighting:|Subject:|Setting:/.test(visual);
        if (composed) {
          for (const c of chars) if (visual.includes(`${c.name} (`)) present.push(c.name);
        }
        if (!composed) {
          for (const st of styles) if (visual.startsWith(st)) visual = visual.slice(st.length).replace(/^\.\s*/, "");
        }
        if (!composed) {
          for (const { c, segs } of looks)
            for (const seg of segs)
              if (visual.includes(seg)) {
                visual = visual.replace(seg, "").replace(/^\.\s*/, "").replace(/\.\s*\./g, ".");
                if (!present.includes(c.name)) present.push(c.name);
              }
        }
        const speaker = x.speakerId ? chars.find((c) => c.id === x.speakerId)?.name ?? null : null;
        if (speaker && !present.includes(speaker)) present.push(speaker);
        const out = {
          index,
          act: x.act,
          start: Math.round(t * 10) / 10,
          durationSec: x.durationSec,
          speaker,
          line: x.voiceover,
          visual: visual.trim().replace(/^\.\s*/, ""),
          present
        };
        t += x.durationSec;
        return out;
      })
    };
  },
  "studio.projects": ({ workspaceId }) => {
    const db = getDb();
    const stats = new Map(
      db.select({ projectId: videoScenes.projectId, n: count(), total: sum(videoScenes.durationSec).mapWith(Number) }).from(videoScenes).groupBy(videoScenes.projectId).all().map((r) => [r.projectId, r])
    );
    return db.select().from(videoProjects).where(byWorkspace(videoProjects.workspaceId, workspaceId)).orderBy(desc(videoProjects.updatedAt)).all().map((p) => ({ ...p, sceneCount: stats.get(p.id)?.n ?? 0, totalDurationSec: Math.round((stats.get(p.id)?.total ?? 0) * 10) / 10 }));
  },
  "studio.get": ({ id }) => {
    const db = getDb();
    const project = db.select().from(videoProjects).where(eq(videoProjects.id, id)).get();
    if (!project) throw notFound("dự án video");
    const scenes = db.select().from(videoScenes).where(eq(videoScenes.projectId, id)).orderBy(asc(videoScenes.position)).all();
    return { ...project, scenes, characterRefs: characterRefsOf(id) };
  },
  "studio.create": ({ referenceImages, ...input }) => getDb().insert(videoProjects).values({ id: newId(), ...input, ...referenceImages ? { referenceImages: checkRefs(referenceImages) } : {} }).returning().get(),
  "studio.update": ({ id, patch: { referenceImages, ...patch } }) => {
    const row = getDb().update(videoProjects).set({ ...patch, ...referenceImages ? { referenceImages: checkRefs(referenceImages) } : {}, updatedAt: new Date() }).where(eq(videoProjects.id, id)).returning().get();
    if (!row) throw notFound("dự án video");
    return row;
  },
  "studio.delete": ({ id }) => {
    if (getDb().delete(videoProjects).where(eq(videoProjects.id, id)).run().changes === 0) throw notFound("dự án video");
    rmSync(segmentsDir(id), { recursive: true, force: true });
  },
  "studio.saveScenes": ({ projectId, scenes }) => {
    const db = getDb();
    return db.transaction((tx) => {
      const project = tx.select({ id: videoProjects.id, status: videoProjects.status }).from(videoProjects).where(eq(videoProjects.id, projectId)).get();
      if (!project) throw notFound("dự án video");
      const old = tx.select().from(videoScenes).where(eq(videoScenes.projectId, projectId)).orderBy(asc(videoScenes.position)).all();
      const media = new Map();
      for (const o of old) if (o.mediaPath) media.set(o.mediaPrompt ?? "", [...media.get(o.mediaPrompt ?? "") ?? [], o]);
      tx.delete(videoScenes).where(eq(videoScenes.projectId, projectId)).run();
      const rows = scenes.map((raw, position) => {
        const startImage = okImage(raw.startImage) ? raw.startImage : null;
        const s = {
          ...raw,
          startImage,
          endImage: startImage && okImage(raw.endImage) ? raw.endImage : null,
          sceneRefs: raw.sceneRefs ? raw.sceneRefs.filter((p) => okImage(p)).slice(0, 3) : null
        };
        const { mediaPath, ...rest } = s;
        if (s.mediaMode === "upload") {
          const ok = !!mediaPath && /^uploads\/[\w.-]+$/.test(mediaPath) && existsSync(join(mediaDir(), mediaPath));
          return { id: newId(), projectId, position, ...rest, mediaPath: ok ? mediaPath : null, mediaSource: "upload", mediaCredit: null };
        }
        const m = media.get(s.mediaPrompt ?? "")?.shift();
        return {
          id: newId(),
          projectId,
          position,
          ...rest,
          ...m && m.mediaSource !== "upload" ? { mediaPath: m.mediaPath, mediaCredit: m.mediaCredit, mediaSource: m.mediaSource } : {}
        };
      });
      if (rows.length) tx.insert(videoScenes).values(rows).run();
      tx.update(videoProjects).set({ status: rows.length && project.status === "draft" ? "scripted" : project.status, updatedAt: new Date() }).where(eq(videoProjects.id, projectId)).run();
      return tx.select().from(videoScenes).where(eq(videoScenes.projectId, projectId)).orderBy(asc(videoScenes.position)).all();
    });
  },
  "studio.toContent": ({ id }) => {
    const db = getDb();
    return db.transaction((tx) => {
      const p = tx.select().from(videoProjects).where(eq(videoProjects.id, id)).get();
      if (!p) throw notFound("dự án video");
      const scenes = tx.select().from(videoScenes).where(eq(videoScenes.projectId, id)).orderBy(asc(videoScenes.position)).all();
      const durationSec = Math.round(scenes.reduce((a, s) => a + s.durationSec, 0) * 10) / 10;
      const caption = scenes[0]?.voiceover || null;
      const values = { workspaceId: p.workspaceId, kind: "video", title: p.topic.slice(0, 300), caption, aspect: "9:16", durationSec, source: "studio" };
      const status = p.status === "rendered" ? "ready" : "draft";
      const existing = p.contentItemId ? tx.select().from(contentItems).where(eq(contentItems.id, p.contentItemId)).get() : void 0;
      if (existing) {
        return tx.update(contentItems).set({ ...values, ...existing.status === "draft" || existing.status === "ready" ? { status } : {}, updatedAt: new Date() }).where(eq(contentItems.id, existing.id)).returning().get();
      }
      const item = tx.insert(contentItems).values({ id: newId(), ...values, status }).returning().get();
      tx.update(videoProjects).set({ contentItemId: item.id, updatedAt: new Date() }).where(eq(videoProjects.id, id)).run();
      return item;
    });
  }
};
