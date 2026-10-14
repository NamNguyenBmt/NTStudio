import { rmSync } from "node:fs";
import { join } from "node:path";
import { eq, asc, desc, and, sql, inArray, isNull } from "drizzle-orm";
import { series, seriesCharacters, seriesEpisodes, filmProjects, filmAssets, filmTakes } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError, notFound } from "../errors";
import { isReady } from "../ai/providers";
import { mediaDir } from "../media/paths";
import { unitCost } from "../../shared/pricing";
import { veoSource } from "../flow/session";
import { flowImagesReady } from "../flow/image";
import { veoAvailable } from "../media/generators";
import { filmAssetDescriptions } from "../ai/film-prompts";
import { filmImageModel } from "../film/image";
import { videoPlan } from "../film/video";
import { styleKey, ensureFilmStyle } from "../film/style";
import {
  syncSeriesCast,
  seriesScriptContext,
  resolveProposals,
  promoteToSeries,
  seriesLocations,
  adoptSeriesLocation,
  reuseSeriesLocations,
} from "../film/series-link";
import { upscaleKey } from "../../shared/upscale";
import { canFlowUpscale } from "../film/upscale";
import { setQueuePrefs, filmDir, takeProgress, kick, cancelTakes, queueStatus } from "../film/queue";
import { characterPrompt, locationPrompt, shotPrompt, videoPrompt } from "../film/prompts";
import { writeFilmScript, wantsVietnameseSubtitle } from "../film/script";
import { assembleStatus, cancelAssemble, listRenders, startAssemble, renderToContent } from "../film/assemble";
import { ensureCharacterPrompt } from "./series";

function filmGate() {
  const g = {
    veo: veoAvailable(),
    veoFlow: veoSource() === "flow",
    seedance: isReady("seedance"),
    imageGoogle: isReady("google_image"),
    imageFal: isReady("fal"),
    imageFlow: flowImagesReady(),
  };
  return { ...g, ok: (g.veo || g.seedance) && (g.imageGoogle || g.imageFal || g.imageFlow) };
}

function requireGate() {
  const g = filmGate();
  if (!g.ok)
    throw new ApiError(
      "VALIDATION",
      !g.veo && !g.seedance
        ? "Xưởng Phim cần Veo (key Gemini hoặc đăng nhập Google Flow) hoặc Seedance (Fal.ai) – thiết lập ở Cài đặt & Khóa API"
        : "Chưa có nguồn tạo ảnh (Google Flow, Gemini – Ảnh AI hoặc Fal.ai) – thiết lập ở Cài đặt & Khóa API",
    );
}

function getFilm(id) {
  const f = getDb().select().from(filmProjects).where(eq(filmProjects.id, id)).get();
  if (!f) throw notFound("phim");
  return f;
}

const toTake = (t) => {
  const { refs: _refs, notBefore: _nb, ...rest } = t;
  return {
    ...rest,
    progress: t.status === "running" ? takeProgress(t.id) : null,
    inFlow: t.kind === "video" && t.status === "done" && !!t.file && canFlowUpscale(join(mediaDir(), t.file)),
  };
};

function detail(id) {
  const db = getDb();
  const film = getFilm(id);
  const assets = db
    .select()
    .from(filmAssets)
    .where(eq(filmAssets.filmId, id))
    .orderBy(asc(filmAssets.kind), asc(filmAssets.position))
    .all();
  const takes = db.select().from(filmTakes).where(eq(filmTakes.filmId, id)).orderBy(desc(filmTakes.createdAt)).all();
  const byAsset = new Map();
  for (const t of takes) byAsset.set(t.assetId, [...(byAsset.get(t.assetId) ?? []), toTake(t)]);
  const spent = takes.reduce((a, t) => a + (t.status === "done" ? t.costUsd : 0), 0);
  let seriesInfo = null;
  if (film.seriesId && film.episodeId) {
    const sr = db.select({ id: series.id, title: series.title }).from(series).where(eq(series.id, film.seriesId)).get();
    const ep = db
      .select({ number: seriesEpisodes.number, title: seriesEpisodes.title })
      .from(seriesEpisodes)
      .where(eq(seriesEpisodes.id, film.episodeId))
      .get();
    if (sr && ep) seriesInfo = { id: sr.id, title: sr.title, episodeNumber: ep.number, episodeTitle: ep.title };
  }
  return {
    film,
    series: seriesInfo,
    assets: assets.map((a) => ({ ...a, takes: byAsset.get(a.id) ?? [] })),
    spentUsd: Math.round(spent * 1e3) / 1e3,
  };
}

function selectedFile(a, takes) {
  const t = a.selectedTakeId ? takes.get(a.selectedTakeId) : void 0;
  return t?.status === "done" && t.file ? t.file : null;
}

function prepare(filmId, assetIds, kind = "image") {
  const db = getDb();
  const film = getFilm(filmId);
  const all = db.select().from(filmAssets).where(eq(filmAssets.filmId, filmId)).all();
  const byId = new Map(all.map((a) => [a.id, a]));
  const takes = new Map(
    db
      .select()
      .from(filmTakes)
      .where(and(eq(filmTakes.filmId, filmId), eq(filmTakes.status, "done")))
      .all()
      .map((t) => [t.id, t]),
  );
  const jobs = [];
  const skipped = [];
  const pending = new Set(all.filter((x) => x.proposal === "pending").map((x) => x.id));
  for (const id of assetIds) {
    const a = byId.get(id);
    if (!a) continue;
    if (pending.has(a.id)) {
      skipped.push({ assetId: a.id, reason: `${a.name}: nhân vật đề xuất chưa duyệt (duyệt ở bước Kịch bản)` });
      continue;
    }
    if (a.kind === "shot" && a.characterIds.some((c) => pending.has(c))) {
      skipped.push({ assetId: a.id, reason: `${a.name}: có nhân vật đề xuất chưa duyệt` });
      continue;
    }
    if (kind === "video") {
      if (a.kind !== "shot") continue;
      const start = selectedFile(a, takes);
      if (!start) {
        skipped.push({ assetId: a.id, reason: `${a.name}: chưa có khung hình đã chọn` });
        continue;
      }
      jobs.push({
        asset: a,
        prompt: videoPrompt(
          film,
          a,
          film.videoAudio,
          all.filter((x) => x.kind === "character"),
        ),
        refs: [start],
        seconds: a.durationSec,
      });
      continue;
    }
    if (a.kind === "character") jobs.push({ asset: a, prompt: characterPrompt(film, a), refs: [] });
    else if (a.kind === "location") jobs.push({ asset: a, prompt: locationPrompt(film, a), refs: [] });
    else {
      const chars = a.characterIds.map((c) => byId.get(c)).filter((c) => !!c);
      const loc = a.locationId ? (byId.get(a.locationId) ?? null) : null;
      const missing = [...chars, ...(loc ? [loc] : [])].filter((x) => !selectedFile(x, takes)).map((x) => x.name);
      if (missing.length) {
        skipped.push({ assetId: a.id, reason: `Chưa có ảnh đã chọn cho: ${missing.join(", ")}` });
        continue;
      }
      jobs.push({
        asset: a,
        prompt: shotPrompt(film, a, chars, loc),
        refs: [...chars, ...(loc ? [loc] : [])].map((x) => selectedFile(x, takes)),
      });
    }
  }
  return { jobs, skipped };
}

function estimate(filmId, assetIds, takesEach, kind = "image") {
  const film = getFilm(filmId);
  const { jobs, skipped } = prepare(filmId, assetIds, kind);
  const takes = jobs.length * takesEach;
  if (kind === "video") {
    const plans = jobs.map((j) => videoPlan(film, j.seconds ?? 6));
    const usd = plans.reduce((a, p) => a + p.usd, 0) * takesEach;
    const seconds = plans.reduce((a, p) => a + p.seconds, 0) * takesEach;
    return {
      kind,
      takes,
      seconds,
      model: plans[0]?.model ?? videoPlan(film, 6).model,
      usd: Math.round(usd * 100) / 100,
      skipped,
      jobs,
    };
  }
  const model = filmImageModel(
    film.imageEngine,
    jobs.some((j) => j.refs.length),
  );
  return { kind, takes, model, usd: Math.round(unitCost(model, takes) * 1e3) / 1e3, skipped, jobs };
}

function requireVideoEngine(film) {
  const g = filmGate();
  if (film.videoEngine === "seedance" && !g.seedance)
    throw new ApiError(
      "VALIDATION",
      "Phim đang chọn Seedance nhưng chưa có key Fal.ai – nhập ở Cài đặt hoặc đổi sang Veo",
    );
  if (film.videoEngine === "veo" && !g.veo)
    throw new ApiError(
      "VALIDATION",
      veoSource() === "flow"
        ? "Phim đang chọn Veo qua Google Flow nhưng chưa đăng nhập Flow – vào Cài đặt › Google Flow"
        : "Phim đang chọn Veo nhưng chưa có key Gemini (Veo) – nhập ở Cài đặt hoặc đổi sang Seedance",
    );
}

const now = () => new Date();

async function ensureAssetPrompts(filmId, assetIds, opts = {}) {
  const db = getDb();
  const film = getFilm(filmId);
  const all = db.select().from(filmAssets).where(eq(filmAssets.filmId, filmId)).all();
  const byId = new Map(all.map((a) => [a.id, a]));
  const involved = new Set();
  for (const id of assetIds) {
    const a = byId.get(id);
    if (!a) continue;
    involved.add(a.id);
    if (a.kind === "shot" && !opts.only) {
      a.characterIds.forEach((c) => involved.add(c));
      if (a.locationId) involved.add(a.locationId);
    }
  }
  const rows = [...involved].map((id) => byId.get(id)).filter((a) => !!a && !a.promptManual);
  const fail = (err) =>
    new ApiError(
      "AI",
      `Không cập nhật được prompt tiếng Anh từ mô tả tiếng Việt: ${err instanceof Error ? err.message : String(err)}`,
    );
  for (const a of rows.filter((x) => x.kind === "character" && x.seriesCharacterId)) {
    let look;
    try {
      look = (await ensureCharacterPrompt(a.seriesCharacterId)).appearanceEn?.trim();
    } catch (err) {
      throw fail(err);
    }
    if (look && look !== a.description)
      db.update(filmAssets)
        .set({ description: look, descriptionSrc: a.summary.trim(), updatedAt: now() })
        .where(eq(filmAssets.id, a.id))
        .run();
  }
  const stale = rows.filter(
    (a) =>
      !a.seriesCharacterId &&
      a.summary.trim() &&
      (opts.force || a.descriptionSrc !== a.summary.trim() || !a.description.trim()),
  );
  if (!stale.length) return;
  const name = (id) => (id ? (byId.get(id)?.name ?? "") : "");
  let next;
  try {
    next = await filmAssetDescriptions(
      stale.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        summary: a.summary.trim(),
        current: a.description,
        context:
          a.kind === "shot"
            ? [
                a.characterIds.length ? `characters: ${a.characterIds.map(name).filter(Boolean).join(", ")}` : "",
                a.locationId ? `location: ${name(a.locationId)}` : "",
              ]
                .filter(Boolean)
                .join("; ")
            : void 0,
      })),
      { title: film.title, style: film.style },
      film.workspaceId,
    );
  } catch (err) {
    throw fail(err);
  }
  for (const a of stale) {
    const d = next.get(a.id);
    if (d)
      db.update(filmAssets)
        .set({ description: d, descriptionSrc: a.summary.trim(), updatedAt: now() })
        .where(eq(filmAssets.id, a.id))
        .run();
  }
  console.info(`[film] cập nhật prompt tiếng Anh từ tiếng Việt: ${next.size}/${stale.length} mục`);
}

const touchFilm = (id) =>
  void getDb().update(filmProjects).set({ updatedAt: now() }).where(eq(filmProjects.id, id)).run();

export const filmHandlers = {
  "film.gate": () => filmGate(),
  "film.list": ({ workspaceId }) => {
    const db = getDb();
    const films = db
      .select()
      .from(filmProjects)
      .where(workspaceId ? eq(filmProjects.workspaceId, workspaceId) : void 0)
      .orderBy(desc(filmProjects.updatedAt))
      .all();
    if (!films.length) return [];
    const counts = db
      .select({ filmId: filmAssets.filmId, kind: filmAssets.kind, n: sql`count(*)` })
      .from(filmAssets)
      .where(
        inArray(
          filmAssets.filmId,
          films.map((f) => f.id),
        ),
      )
      .groupBy(filmAssets.filmId, filmAssets.kind)
      .all();
    const covers = db
      .select({ filmId: filmTakes.filmId, file: filmTakes.file, kind: filmAssets.kind, pos: filmAssets.position })
      .from(filmAssets)
      .innerJoin(filmTakes, eq(filmTakes.id, filmAssets.selectedTakeId))
      .where(
        and(
          inArray(
            filmAssets.filmId,
            films.map((f) => f.id),
          ),
          eq(filmTakes.status, "done"),
        ),
      )
      .all();
    const rank = { shot: 0, location: 1, character: 2 };
    return films.map((f) => {
      const c = (k) => counts.find((x) => x.filmId === f.id && x.kind === k)?.n ?? 0;
      const cover =
        covers
          .filter((x) => x.filmId === f.id && x.file)
          .sort((a, b) => rank[a.kind] - rank[b.kind] || a.pos - b.pos)[0]?.file ?? null;
      return { ...f, characters: c("character"), locations: c("location"), shots: c("shot"), cover };
    });
  },
  "film.create": (input) => {
    requireGate();
    const g = filmGate();
    return getDb()
      .insert(filmProjects)
      .values({
        id: newId(),
        ...input,
        workspaceId: input.workspaceId ?? null,
        videoEngine: input.videoEngine ?? (g.seedance ? "seedance" : "veo"),
        // Ảnh: Gemini nếu có (rẻ, không cần fal), không thì Nano Banana qua fal
        imageEngine: g.imageGoogle ? "google" : "fal",
      })
      .returning()
      .get();
  },
  "film.get": ({ id }) => {
    syncSeriesCast(id);
    return detail(id);
  },
  "film.update": ({ id, patch }) => {
    let styleFor;
    if (patch.style !== void 0) {
      const f = getFilm(id);
      styleFor = `manual:${styleKey({
        genre: patch.genre ?? f.genre,
        visualStyle: patch.visualStyle ?? f.visualStyle,
        notes: patch.notes ?? f.notes,
      })}`;
    }
    const row = getDb()
      .update(filmProjects)
      .set({ ...patch, ...(styleFor ? { styleFor } : {}), updatedAt: now() })
      .where(eq(filmProjects.id, id))
      .returning()
      .get();
    if (!row) throw notFound("phim");
    return row;
  },
  "film.delete": ({ id }) => {
    const db = getDb();
    cancelTakes(
      db
        .select({ id: filmTakes.id })
        .from(filmTakes)
        .where(eq(filmTakes.filmId, id))
        .all()
        .map((t) => t.id),
    );
    db.delete(filmProjects).where(eq(filmProjects.id, id)).run();
    db.update(seriesEpisodes).set({ filmId: null }).where(eq(seriesEpisodes.filmId, id)).run();
    rmSync(filmDir(id), { recursive: true, force: true });
  },
  /** AI viết kịch bản → THAY toàn bộ nhân vật, bối cảnh, cảnh quay (kể cả ảnh đã tạo) */
  /**
   * AI viết kịch bản → THAY bối cảnh, cảnh quay (và nhân vật, với phim thường).
   * Phim của tập series: GIỮ dàn nhân vật gốc (kèm ảnh đã chọn); nhân vật mới AI cần → đề xuất chờ duyệt.
   */
  "film.generateScript": async ({ id }) => {
    if (!getFilm(id).idea.trim()) throw new ApiError("VALIDATION", "Nhập ý tưởng phim trước");
    await ensureFilmStyle(id);
    const film = getFilm(id);
    const ctx = seriesScriptContext(id);
    const { script, model, costUsd } = await writeFilmScript(film, ctx);
    const db = getDb();
    const all = db.select().from(filmAssets).where(eq(filmAssets.filmId, id)).all();
    const keep = new Set(ctx ? all.filter((a) => a.kind === "character" && a.seriesCharacterId).map((a) => a.id) : []);
    const removed = all.filter((a) => !keep.has(a.id));
    const oldTakes = db
      .select({ id: filmTakes.id, file: filmTakes.file, assetId: filmTakes.assetId })
      .from(filmTakes)
      .where(eq(filmTakes.filmId, id))
      .all()
      .filter((t) => !keep.has(t.assetId));
    cancelTakes(oldTakes.map((t) => t.id));
    let proposals = 0;
    db.transaction((tx) => {
      if (removed.length)
        tx.delete(filmAssets)
          .where(
            inArray(
              filmAssets.id,
              removed.map((a) => a.id),
            ),
          )
          .run();
      const ids = new Map();
      const add = (v) => {
        const aid = newId();
        tx.insert(filmAssets)
          .values({ id: aid, filmId: id, descriptionSrc: (v.summary ?? "").trim(), ...v })
          .run();
        return aid;
      };
      if (ctx) {
        for (const a of all.filter((x) => keep.has(x.id))) {
          ids.set(`c:${a.name.toLowerCase()}`, a.id);
          const voice = script.characters
            .find((c) => c.name.trim().toLowerCase() === a.name.trim().toLowerCase())
            ?.voice?.trim();
          if (voice && !a.voiceProfile) {
            tx.update(filmAssets).set({ voiceProfile: voice }).where(eq(filmAssets.id, a.id)).run();
            if (a.seriesCharacterId)
              tx.update(seriesCharacters)
                .set({ voiceProfile: voice })
                .where(and(eq(seriesCharacters.id, a.seriesCharacterId), isNull(seriesCharacters.voiceProfile)))
                .run();
          }
        }
        let pos = keep.size;
        const extra = script.characters
          .filter((c) => !ids.has(`c:${c.name.toLowerCase()}`))
          .map((c) => ({ ...c, scope: "episode", reason: "AI thêm vào kịch bản" }));
        for (const c of [...script.newCharacters, ...extra].slice(0, 5)) {
          if (ids.has(`c:${c.name.toLowerCase()}`)) continue;
          ids.set(
            `c:${c.name.toLowerCase()}`,
            add({
              kind: "character",
              position: pos++,
              name: c.name,
              summary: c.summary,
              description: c.look,
              voiceProfile: c.voice || null,
              proposal: "pending",
              proposedScope: c.scope,
              proposalReason: c.reason || null,
            }),
          );
          proposals++;
        }
      } else {
        script.characters.forEach((c, i) =>
          ids.set(
            `c:${c.name.toLowerCase()}`,
            add({
              kind: "character",
              position: i,
              name: c.name,
              summary: c.summary,
              description: c.look,
              voiceProfile: c.voice || null,
            }),
          ),
        );
      }
      script.locations.forEach((l, i) =>
        ids.set(
          `l:${l.name.toLowerCase()}`,
          add({ kind: "location", position: i, name: l.name, summary: l.summary, description: l.look }),
        ),
      );
      script.shots.forEach((s, i) =>
        add({
          kind: "shot",
          position: i,
          name: `Cảnh ${i + 1}`,
          summary: s.summary,
          description: s.action,
          camera: s.camera,
          durationSec: s.durationSec,
          dialogue: s.dialogue ?? null,
          // Phụ đề tiếng Việt AI viết kèm kịch bản – đánh dấu khớp lời thoại hiện tại
          ...(wantsVietnameseSubtitle(film) && s.dialogue?.trim() && s.subtitle?.trim()
            ? { subtitle: s.subtitle.trim(), subtitleSrc: s.dialogue.trim() }
            : {}),
          locationId: ids.get(`l:${s.location.toLowerCase()}`) ?? null,
          characterIds: s.characters.map((n) => ids.get(`c:${n.toLowerCase()}`)).filter((x) => !!x),
        }),
      );
      tx.update(filmProjects)
        .set({
          // Phim của tập giữ tên "Series – Tập N"; phim thường lấy tên AI đặt
          title: ctx ? film.title : script.title.trim() || film.title,
          logline: script.logline || film.logline,
          // Giữ phong cách người dùng đã nhập; trống thì lấy của AI
          style: film.style.trim() || script.style,
          updatedAt: now(),
        })
        .where(eq(filmProjects.id, id))
        .run();
    });
    for (const t of oldTakes) if (t.file) rmSync(join(mediaDir(), t.file), { force: true });
    const reusedLocations = ctx ? reuseSeriesLocations(id) : 0;
    const castUsed = ctx
      ? script.characters.filter(
          (c) => keep.size && all.some((a) => keep.has(a.id) && a.name.toLowerCase() === c.name.toLowerCase()),
        ).length
      : script.characters.length;
    return {
      model,
      costUsd,
      characters: castUsed,
      locations: script.locations.length,
      shots: script.shots.length,
      proposals,
      reusedLocations,
    };
  },
  /** Duyệt nhân vật AI đề xuất (chỉ tập này / thêm vào series / bỏ) */
  "film.resolveProposals": ({ filmId, decisions }) => {
    getFilm(filmId);
    const r = resolveProposals(filmId, decisions);
    touchFilm(filmId);
    return r;
  },
  /** Bối cảnh đã có ảnh ở các tập khác của series (thư viện bối cảnh) */
  "film.seriesLocations": ({ filmId }) => {
    getFilm(filmId);
    return seriesLocations(filmId);
  },
  /** Dùng bối cảnh của tập khác cho một bối cảnh của tập này (chép ảnh đã chọn + mô tả) */
  "film.adoptLocation": ({ filmId, assetId, sourceAssetId, copyText }) => {
    getFilm(filmId);
    try {
      adoptSeriesLocation(filmId, assetId, sourceAssetId, copyText);
    } catch (err) {
      throw new ApiError("VALIDATION", err instanceof Error ? err.message : String(err));
    }
    touchFilm(filmId);
  },
  /** Đặt bảng nhân vật đã chọn làm ảnh chuẩn của nhân vật series (tập sau dùng ảnh này) */
  "film.promoteToSeries": ({ assetId }) => {
    try {
      promoteToSeries(assetId);
    } catch (err) {
      throw new ApiError("VALIDATION", err instanceof Error ? err.message : String(err));
    }
  },
  "film.saveAsset": ({ filmId, id, kind, patch }) => {
    const db = getDb();
    getFilm(filmId);
    touchFilm(filmId);
    if (id) {
      let subtitleSrc = {};
      if (patch.subtitle !== void 0) {
        const dialogue =
          patch.dialogue !== void 0
            ? patch.dialogue
            : db.select({ d: filmAssets.dialogue }).from(filmAssets).where(eq(filmAssets.id, id)).get()?.d;
        subtitleSrc = { subtitleSrc: patch.subtitle?.trim() ? (dialogue?.trim() ?? null) : null };
      }
      const row = db
        .update(filmAssets)
        .set({
          ...patch,
          ...subtitleSrc,
          ...(patch.promptManual === false ? { descriptionSrc: null } : {}),
          updatedAt: now(),
        })
        .where(and(eq(filmAssets.id, id), eq(filmAssets.filmId, filmId)))
        .returning()
        .get();
      if (!row) throw notFound("mục");
      if (
        row.seriesCharacterId &&
        (patch.voiceProfile !== void 0 || patch.voiceId !== void 0 || patch.voiceProvider !== void 0)
      )
        db.update(seriesCharacters)
          .set({
            ...(patch.voiceProfile !== void 0 ? { voiceProfile: patch.voiceProfile } : {}),
            ...(patch.voiceProvider !== void 0 ? { voiceProvider: patch.voiceProvider } : {}),
            ...(patch.voiceId !== void 0 ? { voiceId: patch.voiceId } : {}),
          })
          .where(eq(seriesCharacters.id, row.seriesCharacterId))
          .run();
      return row;
    }
    const last = db
      .select({ p: sql`coalesce(max(${filmAssets.position}), -1)` })
      .from(filmAssets)
      .where(and(eq(filmAssets.filmId, filmId), eq(filmAssets.kind, kind)))
      .get();
    const count = (last?.p ?? -1) + 2;
    return db
      .insert(filmAssets)
      .values({
        id: newId(),
        filmId,
        kind,
        position: (last?.p ?? -1) + 1,
        name:
          patch.name ??
          (kind === "shot" ? `Cảnh ${count}` : kind === "character" ? `Nhân vật ${count}` : `Bối cảnh ${count}`),
        // Có sẵn prompt tiếng Anh → coi như khớp tóm tắt; chưa có → dịch từ tóm tắt khi tạo
        descriptionSrc: patch.description?.trim() ? (patch.summary ?? "").trim() : null,
        subtitleSrc: patch.subtitle?.trim() ? (patch.dialogue?.trim() ?? null) : null,
        ...patch,
      })
      .returning()
      .get();
  },
  "film.deleteAsset": ({ id }) => {
    const db = getDb();
    const a = db.select().from(filmAssets).where(eq(filmAssets.id, id)).get();
    if (!a) return;
    cancelTakes(
      db
        .select({ id: filmTakes.id })
        .from(filmTakes)
        .where(eq(filmTakes.assetId, id))
        .all()
        .map((t) => t.id),
    );
    db.transaction((tx) => {
      tx.delete(filmAssets).where(eq(filmAssets.id, id)).run();
      if (a.kind !== "shot") {
        for (const s of tx
          .select()
          .from(filmAssets)
          .where(and(eq(filmAssets.filmId, a.filmId), eq(filmAssets.kind, "shot")))
          .all())
          if (s.locationId === id || s.characterIds.includes(id))
            tx.update(filmAssets)
              .set({
                locationId: s.locationId === id ? null : s.locationId,
                characterIds: s.characterIds.filter((c) => c !== id),
              })
              .where(eq(filmAssets.id, s.id))
              .run();
      }
    });
    touchFilm(a.filmId);
  },
  "film.reorder": ({ filmId, ids }) => {
    getDb().transaction((tx) => {
      ids.forEach((id, i) =>
        tx
          .update(filmAssets)
          .set({ position: i })
          .where(and(eq(filmAssets.id, id), eq(filmAssets.filmId, filmId)))
          .run(),
      );
    });
  },
  "film.refreshPrompt": async ({ filmId, id }) => {
    await ensureAssetPrompts(filmId, [id], { only: true, force: true });
    const row = getDb()
      .select()
      .from(filmAssets)
      .where(and(eq(filmAssets.id, id), eq(filmAssets.filmId, filmId)))
      .get();
    if (!row) throw notFound("mục");
    return row;
  },
  "film.estimate": async ({ filmId, assetIds, takes, kind }) => {
    await ensureFilmStyle(filmId);
    const film = getFilm(filmId);
    const { jobs: _jobs, ...e } = estimate(filmId, assetIds, takes ?? (kind === "video" ? 1 : film.takesPerRun), kind);
    return e;
  },
  /** Xếp hàng tạo ảnh cho các mục (mỗi mục `takes` bản) */
  "film.generate": async ({ filmId, assetIds, takes, kind }) => {
    requireGate();
    await ensureFilmStyle(filmId);
    await ensureAssetPrompts(filmId, assetIds);
    const film = getFilm(filmId);
    if (kind === "video") requireVideoEngine(film);
    const each = takes ?? (kind === "video" ? 1 : film.takesPerRun);
    const { jobs, skipped } = estimate(filmId, assetIds, each, kind);
    const db = getDb();
    db.transaction((tx) => {
      let at = Date.now();
      for (const j of jobs)
        for (let i = 0; i < each; i++)
          tx.insert(filmTakes)
            .values({
              id: newId(),
              filmId,
              assetId: j.asset.id,
              kind: kind ?? "image",
              prompt: j.prompt,
              refs: j.refs,
              durationSec: j.seconds ?? null,
              createdAt: new Date(at++),
            })
            .run();
    });
    touchFilm(filmId);
    kick();
    return { queued: jobs.length * each, skipped };
  },
  /** Nâng cấp độ phân giải một video đã tạo → bản tạo mới (bản gốc giữ nguyên), chạy trong hàng đợi video */
  "film.upscale": ({ takeId, quality, method }) => {
    const db = getDb();
    const src = db.select().from(filmTakes).where(eq(filmTakes.id, takeId)).get();
    if (!src || src.kind !== "video") throw notFound("video");
    if (src.status !== "done" || !src.file) throw new ApiError("VALIDATION", "Chỉ nâng cấp được video đã tạo xong");
    if (method === "flow" && !canFlowUpscale(join(mediaDir(), src.file)))
      throw new ApiError(
        "VALIDATION",
        'Video này không còn liên kết với Google Flow (tạo bằng Veo API / Seedance hoặc bản app cũ) – chọn cách "Trên máy"',
      );
    const key = upscaleKey(method, quality);
    const dup = db
      .select({ id: filmTakes.id })
      .from(filmTakes)
      .where(
        and(
          eq(filmTakes.sourceTakeId, takeId),
          eq(filmTakes.upscale, key),
          inArray(filmTakes.status, ["queued", "running", "done"]),
        ),
      )
      .get();
    if (dup)
      throw new ApiError("CONFLICT", "Video này đã có (hoặc đang tạo) bản nâng cấp cùng chất lượng và cách nâng cấp");
    const id = newId();
    db.insert(filmTakes)
      .values({
        id,
        filmId: src.filmId,
        assetId: src.assetId,
        kind: "video",
        prompt: src.prompt,
        refs: [src.file],
        durationSec: src.durationSec,
        upscale: key,
        sourceTakeId: src.id,
      })
      .run();
    touchFilm(src.filmId);
    kick();
    return { id };
  },
  "film.selectTake": ({ assetId, takeId, video }) => {
    const db = getDb();
    if (takeId) {
      const t = db.select().from(filmTakes).where(eq(filmTakes.id, takeId)).get();
      if (!t || t.assetId !== assetId) throw notFound("bản tạo");
      if (t.status !== "done") throw new ApiError("VALIDATION", "Chỉ chọn được bản đã tạo xong");
    }
    const kind = takeId
      ? db.select({ kind: filmTakes.kind }).from(filmTakes).where(eq(filmTakes.id, takeId)).get()?.kind
      : video
        ? "video"
        : "image";
    db.update(filmAssets)
      .set(
        kind === "video"
          ? { selectedVideoTakeId: takeId, updatedAt: now() }
          : { selectedTakeId: takeId, updatedAt: now() },
      )
      .where(eq(filmAssets.id, assetId))
      .run();
  },
  "film.deleteTake": ({ id }) => {
    const db = getDb();
    const t = db.select().from(filmTakes).where(eq(filmTakes.id, id)).get();
    if (!t) return;
    cancelTakes([id]);
    db.transaction((tx) => {
      tx.delete(filmTakes).where(eq(filmTakes.id, id)).run();
      tx.update(filmAssets).set({ selectedTakeId: null }).where(eq(filmAssets.selectedTakeId, id)).run();
      tx.update(filmAssets).set({ selectedVideoTakeId: null }).where(eq(filmAssets.selectedVideoTakeId, id)).run();
    });
    if (t.file) {
      const f = `${filmDir(t.filmId)}/${t.file.split("/").pop()}`;
      rmSync(f, { force: true });
      rmSync(`${f}.flow.json`, { force: true });
    }
  },
  /** Hủy bản đang chờ / chạy: theo danh sách, hoặc cả phim */
  "film.cancel": ({ filmId, takeIds }) => {
    const ids =
      takeIds ??
      getDb()
        .select({ id: filmTakes.id })
        .from(filmTakes)
        .where(and(eq(filmTakes.filmId, filmId), inArray(filmTakes.status, ["queued", "running"])))
        .all()
        .map((t) => t.id);
    return { cancelled: cancelTakes(ids) };
  },
  "film.assemble": ({ filmId, options }) => {
    getFilm(filmId);
    try {
      startAssemble(filmId, options);
    } catch (err) {
      throw new ApiError("CONFLICT", err instanceof Error ? err.message : String(err));
    }
  },
  "film.assembleStatus": ({ filmId }) => assembleStatus(filmId),
  "film.assembleCancel": ({ filmId }) => cancelAssemble(filmId),
  "film.renders": ({ filmId }) => listRenders(filmId),
  "film.deleteRender": ({ filmId, file }) => {
    const abs = join(mediaDir(), file);
    if (!abs.startsWith(join(filmDir(filmId), "renders")) || !abs.endsWith(".mp4"))
      throw new ApiError("VALIDATION", "Đường dẫn không hợp lệ");
    rmSync(abs, { force: true });
    rmSync(abs.replace(/\.mp4$/, ".jpg"), { force: true });
  },
  "film.renderToContent": async ({ filmId, file }) => {
    try {
      return await renderToContent(filmId, file);
    } catch (err) {
      throw new ApiError("VALIDATION", err instanceof Error ? err.message : String(err));
    }
  },
  /** Tối ưu (lại) từ khóa phong cách từ thể loại / phong cách / ghi chú */
  "film.optimizeStyle": async ({ id }) => {
    getFilm(id);
    return { style: await ensureFilmStyle(id, true) };
  },
  "film.queue": ({ filmId }) => queueStatus(filmId ?? void 0),
  "film.setQueue": (p) => {
    setQueuePrefs(p);
    return queueStatus();
  },
};
