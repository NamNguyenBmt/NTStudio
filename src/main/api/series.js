import { mkdirSync, rmSync, existsSync, statSync, copyFileSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { eq, asc, inArray, and } from "drizzle-orm";
import { workspaces, channels, contentItems, videoProjects, videoScenes, series, seriesCharacters, seriesEpisodes } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError, notFound } from "../errors";
import { AiError, isReady } from "../ai/providers";
import { mediaDir } from "../media/paths";
import { flowImagesReady } from "../flow/image";
import { imageEngineIssue, imageEngines, imageBy } from "../media/generators";
import { isLongForm } from "../../shared/video";
import { composeShotPrompt } from "../media/prompts";
import { planSeriesArc, developSeries, writeEpisode } from "../ai/series";
import { characterImagePrompt, visualStyleKeywords } from "../ai/film-prompts";
import { generateFilmImage } from "../film/image";
import { styleKey, hasStyleInput, composeStyleEn } from "../film/style";
import { createEpisodeFilm, filmProgress } from "../film/series-link";
import { byWorkspace } from "./accounts";
import { fitDurations } from "./ai";
import { writeLongScript } from "../studio/long-script";
import { listRenders } from "../film/assemble";
import { characterSheetPrompt } from "../film/prompts";

const EDGE_VOICES = { female: "vi-VN-HoaiMyNeural", male: "vi-VN-NamMinhNeural" };

const GENDER_VOICES = {
  edge_tts: EDGE_VOICES,
  google_tts: { female: "Kore", male: "Puck" },
  openai_tts: { female: "nova", male: "onyx" }
};

const meta = (r) => ({ provider: r.providerLabel, model: r.model, costUsd: r.costUsd });
const rel = (abs) => abs.startsWith(mediaDir()) ? abs.slice(mediaDir().length + 1).replace(/\\/g, "/") : abs;

function brandVoiceOf(workspaceId) {
  return workspaceId ? getDb().select({ v: workspaces.brandVoice }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.v ?? null : null;
}

function seriesRow(id) {
  const s = getDb().select().from(series).where(eq(series.id, id)).get();
  if (!s) throw notFound("series");
  return s;
}

function detail(id) {
  const db = getDb();
  const s = seriesRow(id);
  const characters = db.select().from(seriesCharacters).where(eq(seriesCharacters.seriesId, id)).orderBy(asc(seriesCharacters.sortOrder), asc(seriesCharacters.createdAt)).all();
  const eps = db.select().from(seriesEpisodes).where(eq(seriesEpisodes.seriesId, id)).orderBy(asc(seriesEpisodes.number)).all();
  const projectIds = eps.map((e) => e.projectId).filter((x) => !!x);
  const projects = projectIds.length ? db.select({ id: videoProjects.id, status: videoProjects.status, contentItemId: videoProjects.contentItemId }).from(videoProjects).where(inArray(videoProjects.id, projectIds)).all() : [];
  const contentIds = projects.map((p) => p.contentItemId).filter((x) => !!x);
  const contents = contentIds.length ? db.select({ id: contentItems.id, status: contentItems.status }).from(contentItems).where(inArray(contentItems.id, contentIds)).all() : [];
  const films = filmProgress(
    eps.map((e) => e.filmId).filter((x) => !!x),
    (fid) => listRenders(fid).length
  );
  return {
    ...s,
    characters,
    // Đã có tập được sản xuất (dự án Xưởng Video hoặc phim) → không đổi kiểu sản xuất được nữa
    productionLocked: eps.some((e) => e.projectId || e.filmId && films.has(e.filmId)),
    episodes: eps.map((e) => {
      const p = projects.find((x) => x.id === e.projectId);
      const c = contents.find((x) => x.id === p?.contentItemId);
      const film = e.filmId ? films.get(e.filmId) ?? null : null;
      const status = film ? e.status === "planned" ? "scripted" : e.status : c?.status === "published" ? "published" : p?.status === "rendered" ? "rendered" : p ? "scripted" : e.projectId ? e.status : "planned";
      return { ...e, status, projectStatus: p?.status ?? null, film };
    })
  };
}

function promptKey(c, s) {
  return createHash("sha256").update([c.name, c.role ?? "", c.appearance, c.personality ?? "", s.title, s.genre ?? "", s.visualStyle ?? ""].join("|")).digest("hex").slice(0, 16);
}

export async function ensureCharacterPrompt(id, force = false) {
  const db = getDb();
  const c = db.select().from(seriesCharacters).where(eq(seriesCharacters.id, id)).get();
  if (!c) throw notFound("nhân vật");
  const s = seriesRow(c.seriesId);
  const key = promptKey(c, s);
  if (!force && c.imagePrompt && c.appearanceEn && c.imagePromptFor === key) return c;
  const keepManual = !force && c.promptManual && !!c.imagePrompt;
  const channel = s.targetChannelId ? db.select({ workspaceId: channels.workspaceId }).from(channels).where(eq(channels.id, s.targetChannelId)).get() : void 0;
  const r = await characterImagePrompt({
    seriesTitle: s.title,
    genre: s.genre,
    visualStyle: s.visualStyle,
    name: c.name,
    role: c.role,
    appearance: c.appearance,
    personality: c.personality,
    workspaceId: s.workspaceId ?? channel?.workspaceId ?? null
  });
  console.info(`[series] tạo prompt ảnh chuẩn cho nhân vật ${c.id.slice(0, 8)} (${r.meta.model})`);
  return db.update(seriesCharacters).set({ imagePrompt: keepManual ? c.imagePrompt : r.imagePrompt, appearanceEn: r.appearanceEn, imagePromptFor: key, promptManual: keepManual }).where(eq(seriesCharacters.id, id)).returning().get();
}

async function ensureStyleEn(seriesId) {
  const s = seriesRow(seriesId);
  if (s.productionMode === "film") {
    const input = { genre: s.genre, visualStyle: s.visualStyle, notes: s.notes };
    const key = styleKey(input);
    if (!hasStyleInput(input) || s.visualStyleEn && s.visualStyleFor === key) return;
    const en2 = await composeStyleEn(input, s.workspaceId);
    getDb().update(series).set({ visualStyleEn: en2, visualStyleFor: key }).where(eq(series.id, seriesId)).run();
    return;
  }
  const style = s.visualStyle?.trim() ?? "";
  if (!style || s.visualStyleEn && s.visualStyleFor === style) return;
  const en = /^[\x00-\x7F]*$/.test(style) ? style : await visualStyleKeywords(style, s.workspaceId);
  getDb().update(series).set({ visualStyleEn: en, visualStyleFor: style }).where(eq(series.id, seriesId)).run();
}

function episodeSetup(episodeId) {
  const db = getDb();
  const ep = db.select().from(seriesEpisodes).where(eq(seriesEpisodes.id, episodeId)).get();
  if (!ep) throw notFound("tập phim");
  const s = seriesRow(ep.seriesId);
  const chars = db.select().from(seriesCharacters).where(eq(seriesCharacters.seriesId, s.id)).orderBy(asc(seriesCharacters.sortOrder)).all();
  if (!chars.length) throw new ApiError("VALIDATION", 'Series chưa có nhân vật – bấm "AI phát triển series" hoặc thêm nhân vật trước');
  const previous = db.select({ number: seriesEpisodes.number, title: seriesEpisodes.title, synopsis: seriesEpisodes.synopsis }).from(seriesEpisodes).where(eq(seriesEpisodes.seriesId, s.id)).orderBy(asc(seriesEpisodes.number)).all().filter((e) => e.number < ep.number).slice(-5);
  const channel = s.targetChannelId ? db.select({ workspaceId: channels.workspaceId }).from(channels).where(eq(channels.id, s.targetChannelId)).get() : void 0;
  const workspaceId = s.workspaceId ?? channel?.workspaceId ?? null;
  const byName = (n) => chars.find((c) => c.name.trim().toLowerCase() === n.trim().toLowerCase());
  const style = s.visualStyleEn && s.visualStyleFor === s.visualStyle ? s.visualStyleEn : s.visualStyle;
  const bible = {
    style: style?.trim() || "cinematic, natural color grade, shallow depth of field",
    characters: chars.map((c) => ({ name: c.name, look: (c.appearanceEn || c.appearance || "").trim() || c.name })),
    product: null
  };
  const map = (sc, durationSec) => {
    const speaker = sc.speaker.toLowerCase() === "narrator" ? void 0 : byName(sc.speaker);
    const present = [...new Set([...sc.shot.characters.map((n) => byName(n)?.name ?? n), ...speaker ? [speaker.name] : []])];
    return {
      label: (speaker ? speaker.name : sc.label || "Dẫn truyện").slice(0, 80),
      voiceover: sc.line.trim(),
      durationSec,
      mediaPrompt: composeShotPrompt({ ...sc.shot, characters: present }, bible),
      searchQuery: sc.searchQuery.trim() || null,
      speakerId: speaker?.id ?? null,
      voiceId: speaker?.voiceId ?? null
    };
  };
  return { ep, s, chars, previous, workspaceId, map, bible };
}

export function episodeLongContext(episodeId, vertical) {
  const { ep, s, chars, previous, workspaceId, map, bible } = episodeSetup(episodeId);
  return {
    map,
    ctx: {
      kind: "episode",
      topic: `Series "${s.title}" – Tập ${ep.number}: ${ep.title}`,
      brief: [
        s.genre ? `Thể loại: ${s.genre}` : "",
        s.logline ? `Ý tưởng series: ${s.logline}` : "",
        previous.length ? `Các tập trước:
${previous.map((p) => `Tập ${p.number} – ${p.title}: ${p.synopsis}`).join("\n")}` : "",
        `Dàn ý tập này: ${ep.synopsis}`,
        ep.cliffhanger ? `Kết tập bằng tình huống treo: ${ep.cliffhanger}` : "Kết tập bằng một tình huống treo."
      ].filter(Boolean),
      characters: chars.map((c) => ({ name: c.name, role: c.role, personality: c.personality })),
      totalSec: s.episodeLengthSec,
      vertical,
      brandVoice: brandVoiceOf(workspaceId),
      workspaceId,
      bible
    }
  };
}

export async function scriptEpisode(episodeId) {
  const db = getDb();
  const epRow = db.select({ seriesId: seriesEpisodes.seriesId }).from(seriesEpisodes).where(eq(seriesEpisodes.id, episodeId)).get();
  if (epRow) {
    try {
      await ensureStyleEn(epRow.seriesId);
    } catch (err) {
      console.warn(`[series] không chuyển được phong cách hình sang tiếng Anh – dùng nguyên văn: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const ch of db.select({ id: seriesCharacters.id }).from(seriesCharacters).where(eq(seriesCharacters.seriesId, epRow.seriesId)).all()) {
      try {
        await ensureCharacterPrompt(ch.id);
      } catch (err) {
        console.warn(`[series] không tạo được prompt tiếng Anh cho nhân vật – dùng mô tả gốc: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const { ep, s, chars, previous, workspaceId, map, bible } = episodeSetup(episodeId);
  const long = isLongForm(s.episodeLengthSec);
  const ensureProject = () => {
    const values = {
      workspaceId,
      targetChannelId: s.targetChannelId,
      topic: `${s.title} – Tập ${ep.number}: ${ep.title}`.slice(0, 500),
      targetDurationSec: s.episodeLengthSec,
      ttsProvider: s.ttsProvider,
      voiceId: s.narratorVoiceId,
      renderMode: s.renderMode,
      format: "episode",
      updatedAt: new Date()
    };
    const existing = ep.projectId ? db.select({ id: videoProjects.id, aspect: videoProjects.aspect }).from(videoProjects).where(eq(videoProjects.id, ep.projectId)).get() : void 0;
    if (existing) {
      db.update(videoProjects).set(values).where(eq(videoProjects.id, existing.id)).run();
      return existing;
    }
    const row = db.insert(videoProjects).values({ id: newId(), ...values, aspect: long ? "16:9" : "9:16" }).returning({ id: videoProjects.id, aspect: videoProjects.aspect }).get();
    db.update(seriesEpisodes).set({ projectId: row.id, updatedAt: new Date() }).where(eq(seriesEpisodes.id, ep.id)).run();
    return row;
  };
  if (long) {
    const project2 = ensureProject();
    const { ctx } = episodeLongContext(ep.id, project2.aspect === "9:16");
    const { meta: m2 } = await writeLongScript(project2.id, ctx, map);
    db.update(seriesEpisodes).set({ status: "scripted", updatedAt: new Date() }).where(eq(seriesEpisodes.id, ep.id)).run();
    const count = db.select({ id: videoScenes.id }).from(videoScenes).where(eq(videoScenes.projectId, project2.id)).all().length;
    return { projectId: project2.id, scenes: count, meta: m2 };
  }
  const { scenes, meta: m } = await writeEpisode({
    seriesTitle: s.title,
    logline: s.logline,
    genre: s.genre,
    characters: chars.map((c) => ({ name: c.name, role: c.role, personality: c.personality })),
    previous,
    episode: { number: ep.number, title: ep.title, synopsis: ep.synopsis, cliffhanger: ep.cliffhanger },
    lengthSec: s.episodeLengthSec,
    brandVoice: brandVoiceOf(workspaceId),
    workspaceId,
    bible
  });
  const durations = fitDurations(
    scenes.map((sc) => sc.durationSec),
    s.episodeLengthSec
  );
  const project = ensureProject();
  return db.transaction((tx) => {
    tx.update(videoProjects).set({ status: "scripted", acts: null, visualBible: bible }).where(eq(videoProjects.id, project.id)).run();
    tx.delete(videoScenes).where(eq(videoScenes.projectId, project.id)).run();
    tx.insert(videoScenes).values(
      scenes.map((sc, i) => ({
        id: newId(),
        projectId: project.id,
        position: i,
        mediaSource: "stock",
        ...map(sc, durations[i], bible)
      }))
    ).run();
    tx.update(seriesEpisodes).set({ projectId: project.id, status: "scripted", updatedAt: new Date() }).where(eq(seriesEpisodes.id, ep.id)).run();
    return { projectId: project.id, scenes: scenes.length, meta: meta(m) };
  });
}

export function episodeOfProject(projectId) {
  return getDb().select({ id: seriesEpisodes.id }).from(seriesEpisodes).where(eq(seriesEpisodes.projectId, projectId)).get()?.id ?? null;
}

export const seriesHandlers = {
  "series.list": ({ workspaceId }) => {
    const db = getDb();
    const rows = db.select().from(series).where(byWorkspace(series.workspaceId, workspaceId)).orderBy(asc(series.createdAt)).all();
    return rows.map((s) => ({
      ...s,
      episodeCount: db.select({ id: seriesEpisodes.id }).from(seriesEpisodes).where(eq(seriesEpisodes.seriesId, s.id)).all().length,
      characterCount: db.select({ id: seriesCharacters.id }).from(seriesCharacters).where(eq(seriesCharacters.seriesId, s.id)).all().length
    }));
  },
  "series.get": ({ id }) => detail(id),
  "series.create": (input) => getDb().insert(series).values({ id: newId(), ...input }).returning().get(),
  "series.update": ({ id, patch }) => {
    if (patch.productionMode && patch.productionMode !== seriesRow(id).productionMode && detail(id).productionLocked)
      throw new ApiError("CONFLICT", "Series đã có tập được sản xuất – không đổi kiểu sản xuất được. Tạo series mới nếu muốn làm theo kiểu khác.");
    const row = getDb().update(series).set({ ...patch, updatedAt: new Date() }).where(eq(series.id, id)).returning().get();
    if (!row) throw notFound("series");
    return row;
  },
  /** Series kiểu Phim: tạo (hoặc mở) phim của tập – nhập dàn nhân vật kèm ảnh chuẩn */
  "series.makeFilm": async ({ episodeId }) => {
    const db = getDb();
    const ep = db.select().from(seriesEpisodes).where(eq(seriesEpisodes.id, episodeId)).get();
    if (!ep) throw notFound("tập");
    const s = seriesRow(ep.seriesId);
    if (s.productionMode !== "film") throw new ApiError("VALIDATION", "Series này làm bằng Xưởng Video AI – đổi kiểu sản xuất sang Phim trước (khi chưa có tập nào được sản xuất)");
    if (ep.projectId) throw new ApiError("CONFLICT", "Tập này đã có dự án Xưởng Video AI");
    if (!ep.filmId) {
      for (const c of db.select().from(seriesCharacters).where(eq(seriesCharacters.seriesId, s.id)).all())
        if (!c.appearanceEn)
          await ensureCharacterPrompt(c.id).catch((err) => {
            if (!(err instanceof AiError) || err.kind !== "no_provider") throw err;
          });
      await ensureStyleEn(s.id).catch((err) => console.warn("[series] không tối ưu được phong cách", err));
    }
    try {
      return createEpisodeFilm(episodeId);
    } catch (err) {
      throw new ApiError("VALIDATION", err instanceof Error ? err.message : String(err));
    }
  },
  "series.delete": ({ id }) => {
    if (!getDb().delete(series).where(eq(series.id, id)).run().changes) throw notFound("series");
  },
  /**
   * AI: thêm nhân vật còn thiếu + dàn ý các tập tiếp theo (không xóa tập đã có).
   * Nhiều tập (> 10): lập mạch cả mùa trước, rồi viết từng đợt 10 tập bám mạch – mỗi đợt lưu ngay
   * (lỗi giữa chừng vẫn giữ các tập đã viết). Mỗi đợt đều biết các tập đã có để không lặp / lệch mạch.
   */
  "series.develop": async ({ id, episodes }) => {
    const db = getDb();
    const s = seriesRow(id);
    const BATCH = 10;
    const charactersOf = () => db.select().from(seriesCharacters).where(eq(seriesCharacters.seriesId, id)).all();
    const episodesOf = () => db.select({ number: seriesEpisodes.number, title: seriesEpisodes.title, synopsis: seriesEpisodes.synopsis }).from(seriesEpisodes).where(eq(seriesEpisodes.seriesId, id)).all().sort((a, b) => a.number - b.number);
    let beats = null;
    let lastMeta = null;
    if (episodes > BATCH) {
      const arc = await planSeriesArc({
        title: s.title,
        logline: s.logline,
        genre: s.genre,
        episodes,
        previous: episodesOf(),
        existingCharacters: charactersOf().map((c) => ({ name: c.name, role: c.role })),
        workspaceId: s.workspaceId
      });
      beats = arc.beats;
      lastMeta = arc.meta;
    }
    let addedChars = 0;
    let addedEpisodes = 0;
    while (addedEpisodes < episodes) {
      const count = Math.min(BATCH, episodes - addedEpisodes);
      const existing = charactersOf();
      const previous = episodesOf();
      const lastNumber = previous.reduce((a, b) => Math.max(a, b.number), 0);
      let plan;
      try {
        const r = await developSeries({
          title: s.title,
          logline: s.logline,
          genre: s.genre,
          visualStyle: s.visualStyle,
          episodes: count,
          episodeLengthSec: s.episodeLengthSec,
          existingCharacters: existing.map((c) => ({ name: c.name, role: c.role, appearance: c.appearance })),
          previous,
          beats: beats?.slice(addedEpisodes, addedEpisodes + count),
          brandVoice: brandVoiceOf(s.workspaceId),
          workspaceId: s.workspaceId
        });
        plan = r.plan;
        lastMeta = r.meta;
      } catch (err) {
        if (!addedEpisodes) throw err;
        console.warn(`[series] đợt viết tập ${lastNumber + 1}+ lỗi – dừng ở ${addedEpisodes}/${episodes} tập`, err);
        break;
      }
      if (!plan.episodes.length) break;
      const known = new Set(existing.map((c) => c.name.trim().toLowerCase()));
      const added = plan.characters.filter((c) => !known.has(c.name.trim().toLowerCase()));
      const eps = plan.episodes.slice(0, count);
      db.transaction((tx) => {
        added.forEach(
          (c, i) => tx.insert(seriesCharacters).values({
            id: newId(),
            seriesId: id,
            name: c.name.trim(),
            role: c.role || null,
            appearance: c.appearance.trim(),
            personality: c.personality || null,
            arc: c.arc || null,
            // Edge/Gemini/OpenAI: gán sẵn giọng theo giới tính; ElevenLabs → người dùng chọn
            voiceId: c.gender !== "other" ? GENDER_VOICES[s.ttsProvider]?.[c.gender] ?? null : null,
            sortOrder: existing.length + i
          }).run()
        );
        for (const c of plan.characters) {
          const old = existing.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
          if (old && !old.arc && c.arc) tx.update(seriesCharacters).set({ arc: c.arc }).where(eq(seriesCharacters.id, old.id)).run();
        }
        eps.forEach(
          (e, i) => tx.insert(seriesEpisodes).values({ id: newId(), seriesId: id, number: lastNumber + i + 1, title: e.title.trim(), synopsis: e.synopsis.trim(), cliffhanger: e.cliffhanger || null }).run()
        );
        tx.update(series).set({ updatedAt: new Date() }).where(eq(series.id, id)).run();
      });
      addedChars += added.length;
      addedEpisodes += eps.length;
    }
    return { characters: addedChars, episodes: addedEpisodes, meta: meta(lastMeta) };
  },
  "series.saveCharacter": ({ id, seriesId, imagePrompt, promptManual, ...input }) => {
    const db = getDb();
    seriesRow(seriesId);
    const manual = promptManual && imagePrompt?.trim() ? { imagePrompt: imagePrompt.trim(), promptManual: true } : { promptManual: false };
    if (!id) {
      const order = db.select({ id: seriesCharacters.id }).from(seriesCharacters).where(eq(seriesCharacters.seriesId, seriesId)).all().length;
      return db.insert(seriesCharacters).values({ id: newId(), seriesId, ...input, ...manual, sortOrder: order }).returning().get();
    }
    const row = db.update(seriesCharacters).set({ ...input, ...manual }).where(and(eq(seriesCharacters.id, id), eq(seriesCharacters.seriesId, seriesId))).returning().get();
    if (!row) throw notFound("nhân vật");
    return row;
  },
  /** Prompt ảnh chuẩn tiếng Anh (tạo nếu chưa có / mô tả đã đổi; `force` = viết lại) */
  "series.characterPrompt": ({ id, force }) => ensureCharacterPrompt(id, force),
  "series.deleteCharacter": ({ id }) => {
    if (!getDb().delete(seriesCharacters).where(eq(seriesCharacters.id, id)).run().changes) throw notFound("nhân vật");
  },
  /** Tạo ảnh tham chiếu nhân vật bằng nguồn ảnh AI đang bật (Nano Banana / Fal). */
  "series.characterImage": async ({ id }) => {
    const db = getDb();
    const c = db.select().from(seriesCharacters).where(eq(seriesCharacters.id, id)).get();
    if (!c) throw notFound("nhân vật");
    const s = seriesRow(c.seriesId);
    if (s.productionMode === "film") {
      const engine = isReady("google_image") ? "google" : isReady("fal") ? "fal" : null;
      if (!engine && !flowImagesReady()) throw new ApiError("VALIDATION", imageEngineIssue() ?? "Chưa có nguồn ảnh AI");
      const p = await ensureCharacterPrompt(c.id).catch(() => c);
      const look = p.promptManual && p.imagePrompt || p.appearanceEn || c.appearance;
      await ensureStyleEn(s.id).catch(() => void 0);
      const style = seriesRow(s.id).visualStyleEn || s.visualStyle || "";
      const dir = join(mediaDir(), "series", s.id);
      mkdirSync(dir, { recursive: true });
      const r = await generateFilmImage({
        engine: engine ?? "google",
        prompt: characterSheetPrompt(look, style),
        refs: [],
        aspect: "16:9",
        destBase: join(dir, `${c.id}-${Date.now().toString(36)}`),
        workspaceId: s.workspaceId,
        signal: AbortSignal.timeout(18e4)
      });
      return db.update(seriesCharacters).set({ referenceImage: rel(r.file) }).where(eq(seriesCharacters.id, id)).returning().get();
    }
    const engines = imageEngines();
    if (!engines.length) throw new ApiError("VALIDATION", imageEngineIssue() ?? "Chưa có nguồn ảnh AI");
    let prompt = [`Character reference sheet, full body, front view, plain light background`, s.visualStyle, c.appearance].filter(Boolean).join(". ");
    try {
      prompt = (await ensureCharacterPrompt(c.id)).imagePrompt ?? prompt;
    } catch (err) {
      if (!(err instanceof AiError) || err.kind !== "no_provider") throw err;
    }
    const signal = AbortSignal.timeout(12e4);
    let lastErr = null;
    for (const eng of engines) {
      try {
        const m = await imageBy(eng, prompt, s.workspaceId, signal);
        return db.update(seriesCharacters).set({ referenceImage: rel(m.file) }).where(eq(seriesCharacters.id, id)).returning().get();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new ApiError("INTERNAL", "Không tạo được ảnh nhân vật");
  },
  /**
   * Ảnh nhân vật do người dùng tải lên: chép vào media/series/<seriesId>/ (ảnh vẫn còn khi file gốc bị xóa/di chuyển).
   * `sourcePath` = null → gỡ ảnh.
   */
  "series.setCharacterImage": ({ id, sourcePath }) => {
    const db = getDb();
    const c = db.select().from(seriesCharacters).where(eq(seriesCharacters.id, id)).get();
    if (!c) throw notFound("nhân vật");
    const old = c.referenceImage && c.referenceImage.startsWith("series/") ? join(mediaDir(), c.referenceImage) : null;
    if (!sourcePath) {
      if (old) rmSync(old, { force: true });
      return db.update(seriesCharacters).set({ referenceImage: null }).where(eq(seriesCharacters.id, id)).returning().get();
    }
    const ext = extname(sourcePath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new ApiError("VALIDATION", "Chỉ nhận ảnh PNG, JPG hoặc WEBP");
    if (!existsSync(sourcePath)) throw new ApiError("VALIDATION", "Không tìm thấy file ảnh");
    if (statSync(sourcePath).size > 15 * 1024 * 1024) throw new ApiError("VALIDATION", "Ảnh tối đa 15 MB");
    const dir = join(mediaDir(), "series", c.seriesId);
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, `${c.id.slice(0, 8)}-${Date.now().toString(36)}${ext === ".jpeg" ? ".jpg" : ext}`);
    copyFileSync(sourcePath, dest);
    if (old && old !== dest) rmSync(old, { force: true });
    return db.update(seriesCharacters).set({ referenceImage: rel(dest) }).where(eq(seriesCharacters.id, id)).returning().get();
  },
  "series.saveEpisode": ({ id, seriesId, ...input }) => {
    const db = getDb();
    seriesRow(seriesId);
    if (!id) {
      const number = db.select({ n: seriesEpisodes.number }).from(seriesEpisodes).where(eq(seriesEpisodes.seriesId, seriesId)).all().reduce((a, b) => Math.max(a, b.n), 0) + 1;
      return db.insert(seriesEpisodes).values({ id: newId(), seriesId, number, ...input }).returning().get();
    }
    const row = db.update(seriesEpisodes).set({ ...input, updatedAt: new Date() }).where(and(eq(seriesEpisodes.id, id), eq(seriesEpisodes.seriesId, seriesId))).returning().get();
    if (!row) throw notFound("tập phim");
    return row;
  },
  "series.deleteEpisode": ({ id }) => {
    if (!getDb().delete(seriesEpisodes).where(eq(seriesEpisodes.id, id)).run().changes) throw notFound("tập phim");
  },
  "series.writeEpisode": ({ id }) => scriptEpisode(id)
};
