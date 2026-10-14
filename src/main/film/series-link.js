import { styleKey } from "./style";
import { isLongForm } from "../../shared/video";
import { mkdirSync, existsSync, copyFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { eq, asc, and, inArray, max, isNotNull } from "drizzle-orm";
import { series, seriesCharacters, seriesEpisodes, filmProjects, filmAssets, filmTakes } from "../db/schema";
import { getDb, newId } from "../db/index";
import { isReady } from "../ai/providers";
import { mediaDir } from "../media/paths";
import { filmDir } from "./queue";

const rel = (abs) =>
  abs
    .slice(mediaDir().length + 1)
    .split("\\")
    .join("/");

const voiceOf = (c) => ({
  voiceProfile: c.voiceProfile,
  voiceProvider: c.voiceProvider,
  voiceId: c.voiceProvider ? c.voiceId : null,
});

const lookOf = (c) => (c.appearanceEn?.trim() || c.appearance).trim();

export function createEpisodeFilm(episodeId) {
  const db = getDb();
  const ep = db.select().from(seriesEpisodes).where(eq(seriesEpisodes.id, episodeId)).get();
  if (!ep) throw new Error("Không tìm thấy tập");
  if (ep.filmId && db.select({ id: filmProjects.id }).from(filmProjects).where(eq(filmProjects.id, ep.filmId)).get())
    return ep.filmId;
  const s = db.select().from(series).where(eq(series.id, ep.seriesId)).get();
  const cast = db
    .select()
    .from(seriesCharacters)
    .where(eq(seriesCharacters.seriesId, s.id))
    .orderBy(asc(seriesCharacters.sortOrder), asc(seriesCharacters.createdAt))
    .all();
  const filmId = newId();
  mkdirSync(filmDir(filmId), { recursive: true });
  const idea = [
    `Tập ${ep.number} của series "${s.title}": ${ep.title}.`,
    ep.synopsis,
    ep.cliffhanger ? `Kết tập (treo sang tập sau): ${ep.cliffhanger}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  db.transaction((tx) => {
    tx.insert(filmProjects)
      .values({
        id: filmId,
        workspaceId: s.workspaceId,
        title: `${s.title} – Tập ${ep.number}: ${ep.title}`.slice(0, 160),
        idea,
        logline: ep.synopsis.slice(0, 600) || null,
        style: s.visualStyleEn?.trim() || "",
        genre: s.genre,
        visualStyle: s.visualStyle,
        dialogueLanguage: s.dialogueLanguage,
        notes: s.notes,
        // Cùng dấu với series → phim không tự tối ưu lại (giữ đúng bộ từ khóa chung của series)
        styleFor: s.visualStyleEn ? styleKey({ genre: s.genre, visualStyle: s.visualStyle, notes: s.notes }) : null,
        aspect: isLongForm(s.episodeLengthSec) ? "16:9" : "9:16",
        targetSec: Math.min(900, Math.max(15, s.episodeLengthSec)),
        videoEngine: isReady("seedance") ? "seedance" : "veo",
        imageEngine: isReady("google_image") ? "google" : "fal",
        seriesId: s.id,
        episodeId: ep.id,
      })
      .run();
    cast.forEach((c, i) => {
      const assetId = newId();
      tx.insert(filmAssets)
        .values({
          id: assetId,
          filmId,
          kind: "character",
          position: i,
          name: c.name,
          summary: c.role ?? "",
          description: lookOf(c),
          descriptionSrc: (c.role ?? "").trim(),
          seriesCharacterId: c.id,
          ...voiceOf(c),
        })
        .run();
      adoptSeriesImage(tx, filmId, assetId, c);
    });
    tx.update(filmProjects)
      .set({ castKnown: cast.map((c) => c.id) })
      .where(eq(filmProjects.id, filmId))
      .run();
    tx.update(seriesEpisodes).set({ filmId, updatedAt: new Date() }).where(eq(seriesEpisodes.id, ep.id)).run();
  });
  return filmId;
}

function adoptSeriesImage(tx, filmId, assetId, c, select = true) {
  const src = c.referenceImage ? join(mediaDir(), c.referenceImage) : null;
  if (!src || !existsSync(src)) return false;
  const takeId = newId();
  const dir = filmDir(filmId);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${takeId}${extname(src).toLowerCase() || ".jpg"}`);
  copyFileSync(src, dest);
  tx.insert(filmTakes)
    .values({
      id: takeId,
      filmId,
      assetId,
      kind: "image",
      status: "done",
      file: rel(dest),
      prompt: "(ảnh chuẩn của series)",
      model: "series",
      refs: [c.referenceImage],
      costUsd: 0,
      finishedAt: new Date(),
    })
    .run();
  if (select)
    tx.update(filmAssets)
      .set({ selectedTakeId: takeId, updatedAt: new Date() })
      .where(eq(filmAssets.id, assetId))
      .run();
  return true;
}

const fileSize = (p) => {
  try {
    return statSync(p).size;
  } catch {
    return -1;
  }
};

export function syncSeriesCast(filmId) {
  const db = getDb();
  const film = db.select().from(filmProjects).where(eq(filmProjects.id, filmId)).get();
  if (!film?.seriesId) return 0;
  const cast = db
    .select()
    .from(seriesCharacters)
    .where(eq(seriesCharacters.seriesId, film.seriesId))
    .orderBy(asc(seriesCharacters.sortOrder), asc(seriesCharacters.createdAt))
    .all();
  if (!cast.length) return 0;
  const chars = db
    .select()
    .from(filmAssets)
    .where(and(eq(filmAssets.filmId, filmId), eq(filmAssets.kind, "character")))
    .all();
  const busyOrDone = new Set(
    db
      .select({ assetId: filmTakes.assetId })
      .from(filmTakes)
      .where(
        and(
          eq(filmTakes.filmId, filmId),
          eq(filmTakes.kind, "image"),
          inArray(filmTakes.status, ["queued", "running", "done"]),
        ),
      )
      .all()
      .map((t) => t.assetId),
  );
  const known = new Set(film.castKnown ?? chars.map((a) => a.seriesCharacterId).filter((x) => !!x));
  for (const a of chars) {
    const c = a.seriesCharacterId ? cast.find((x) => x.id === a.seriesCharacterId) : void 0;
    if (!c) continue;
    const v = voiceOf(c);
    const patch = {
      ...(!a.voiceProfile && v.voiceProfile ? { voiceProfile: v.voiceProfile } : {}),
      ...(!a.voiceId && v.voiceId ? { voiceProvider: v.voiceProvider, voiceId: v.voiceId } : {}),
    };
    if (Object.keys(patch).length) db.update(filmAssets).set(patch).where(eq(filmAssets.id, a.id)).run();
  }
  const images = db
    .select({
      id: filmTakes.id,
      assetId: filmTakes.assetId,
      model: filmTakes.model,
      refs: filmTakes.refs,
      file: filmTakes.file,
    })
    .from(filmTakes)
    .where(and(eq(filmTakes.filmId, filmId), eq(filmTakes.kind, "image")))
    .all();
  const imageUpdates = [];
  for (const a of chars) {
    const c = a.seriesCharacterId ? cast.find((x) => x.id === a.seriesCharacterId) : void 0;
    const src = c?.referenceImage ? join(mediaDir(), c.referenceImage) : null;
    if (!c || !src || !existsSync(src)) continue;
    const seriesTakes = images.filter((t) => t.assetId === a.id && t.model === "series");
    if (seriesTakes.some((t) => t.refs[0] === c.referenceImage)) continue;
    const legacy = seriesTakes.find(
      (t) => !t.refs.length && t.file && fileSize(join(mediaDir(), t.file)) === fileSize(src),
    );
    if (legacy) {
      db.update(filmTakes)
        .set({ refs: [c.referenceImage] })
        .where(eq(filmTakes.id, legacy.id))
        .run();
      continue;
    }
    const selected = a.selectedTakeId ? images.find((t) => t.id === a.selectedTakeId) : void 0;
    const select = selected ? selected.model === "series" : !busyOrDone.has(a.id) || seriesTakes.length > 0;
    imageUpdates.push({ asset: a, c, select });
  }
  const added = cast.filter((c) => !known.has(c.id) && !chars.some((a) => a.seriesCharacterId === c.id));
  if (!imageUpdates.length && !added.length && film.castKnown) return 0;
  let changed = 0;
  db.transaction((tx) => {
    for (const u of imageUpdates) if (adoptSeriesImage(tx, filmId, u.asset.id, u.c, u.select)) changed++;
    let pos =
      (tx
        .select({ m: max(filmAssets.position) })
        .from(filmAssets)
        .where(and(eq(filmAssets.filmId, filmId), eq(filmAssets.kind, "character")))
        .get()?.m ?? -1) + 1;
    for (const c of added) {
      const assetId = newId();
      tx.insert(filmAssets)
        .values({
          id: assetId,
          filmId,
          kind: "character",
          position: pos++,
          name: c.name,
          summary: c.role ?? "",
          description: lookOf(c),
          descriptionSrc: (c.role ?? "").trim(),
          seriesCharacterId: c.id,
          ...voiceOf(c),
        })
        .run();
      adoptSeriesImage(tx, filmId, assetId, c);
      changed++;
    }
    tx.update(filmProjects)
      .set({ castKnown: [...new Set([...known, ...cast.map((c) => c.id)])] })
      .where(eq(filmProjects.id, filmId))
      .run();
  });
  return changed;
}

export function seriesScriptContext(filmId) {
  const db = getDb();
  const film = db.select().from(filmProjects).where(eq(filmProjects.id, filmId)).get();
  if (!film?.seriesId || !film.episodeId) return null;
  const s = db.select().from(series).where(eq(series.id, film.seriesId)).get();
  const ep = db.select().from(seriesEpisodes).where(eq(seriesEpisodes.id, film.episodeId)).get();
  if (!s || !ep) return null;
  const castAssets = db
    .select()
    .from(filmAssets)
    .where(
      and(eq(filmAssets.filmId, filmId), eq(filmAssets.kind, "character"), isNotNull(filmAssets.seriesCharacterId)),
    )
    .all();
  const chars = db.select().from(seriesCharacters).where(eq(seriesCharacters.seriesId, s.id)).all();
  const prev = db
    .select({ number: seriesEpisodes.number, title: seriesEpisodes.title, synopsis: seriesEpisodes.synopsis })
    .from(seriesEpisodes)
    .where(eq(seriesEpisodes.seriesId, s.id))
    .all()
    .filter((e) => e.number < ep.number)
    .sort((a, b) => a.number - b.number)
    .slice(-8);
  return {
    seriesTitle: s.title,
    logline: s.logline,
    episode: { number: ep.number, title: ep.title, synopsis: ep.synopsis, cliffhanger: ep.cliffhanger },
    cast: castAssets.map((a) => {
      const c = chars.find((x) => x.id === a.seriesCharacterId);
      return {
        name: a.name,
        role: c?.role ?? (a.summary || null),
        look: a.description,
        voice: a.voiceProfile ?? c?.voiceProfile ?? null,
        arc: c?.arc ?? null,
      };
    }),
    previous: prev,
    castIsLarge: chars.length >= 8,
    locations: seriesLocationRows(filmId).map((l) => ({ name: l.name, summary: l.summary, look: l.description })),
  };
}

export function resolveProposals(filmId, decisions) {
  const db = getDb();
  const film = db.select().from(filmProjects).where(eq(filmProjects.id, filmId)).get();
  if (!film) throw new Error("Không tìm thấy phim");
  const kept = [];
  let dropped = 0;
  const emptyShots = new Set();
  db.transaction((tx) => {
    for (const d of decisions) {
      const a = tx
        .select()
        .from(filmAssets)
        .where(and(eq(filmAssets.id, d.assetId), eq(filmAssets.filmId, filmId)))
        .get();
      if (!a || a.kind !== "character") continue;
      if (d.action === "drop") {
        tx.delete(filmAssets).where(eq(filmAssets.id, a.id)).run();
        for (const s of tx
          .select()
          .from(filmAssets)
          .where(and(eq(filmAssets.filmId, filmId), eq(filmAssets.kind, "shot")))
          .all())
          if (s.characterIds.includes(a.id)) {
            const rest = s.characterIds.filter((x) => x !== a.id);
            tx.update(filmAssets).set({ characterIds: rest }).where(eq(filmAssets.id, s.id)).run();
            if (!rest.length) emptyShots.add(s.name);
          }
        dropped++;
        continue;
      }
      let seriesCharacterId = a.seriesCharacterId;
      if (d.action === "series" && film.seriesId && !seriesCharacterId) {
        const order = tx
          .select({ id: seriesCharacters.id })
          .from(seriesCharacters)
          .where(eq(seriesCharacters.seriesId, film.seriesId))
          .all().length;
        seriesCharacterId = newId();
        tx.insert(seriesCharacters)
          .values({
            id: seriesCharacterId,
            seriesId: film.seriesId,
            name: a.name,
            role: a.summary || null,
            // Bản gốc: mô tả tiếng Việt = tóm tắt; tiếng Anh = mô tả hình ảnh của phim
            appearance: a.summary || a.description,
            appearanceEn: a.description,
            voiceProfile: a.voiceProfile,
            voiceProvider: a.voiceProvider,
            voiceId: a.voiceId,
            sortOrder: order,
          })
          .run();
      }
      tx.update(filmAssets)
        .set({
          proposal: null,
          seriesCharacterId: d.action === "series" ? seriesCharacterId : null,
          updatedAt: new Date(),
        })
        .where(eq(filmAssets.id, a.id))
        .run();
      kept.push(a.id);
    }
  });
  return { kept, dropped, emptyShots: [...emptyShots] };
}

export function promoteToSeries(assetId) {
  const db = getDb();
  const a = db.select().from(filmAssets).where(eq(filmAssets.id, assetId)).get();
  if (!a?.seriesCharacterId) throw new Error("Nhân vật này không thuộc dàn nhân vật series");
  const t = a.selectedTakeId ? db.select().from(filmTakes).where(eq(filmTakes.id, a.selectedTakeId)).get() : null;
  if (!t?.file || t.status !== "done") throw new Error("Chưa có ảnh đã chọn");
  setSeriesImage(a.seriesCharacterId, join(mediaDir(), t.file), a.description);
}

function setSeriesImage(characterId, src, look) {
  const db = getDb();
  const c = db.select().from(seriesCharacters).where(eq(seriesCharacters.id, characterId)).get();
  if (!c) return;
  const dir = join(mediaDir(), "series", c.seriesId);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${c.id}-${Date.now().toString(36)}${extname(src).toLowerCase() || ".jpg"}`);
  copyFileSync(src, dest);
  db.update(seriesCharacters)
    .set({ referenceImage: rel(dest), ...(look?.trim() ? { appearanceEn: look.trim() } : {}) })
    .where(eq(seriesCharacters.id, c.id))
    .run();
}

export function adoptIfSeriesMissingImage(assetId, file) {
  const db = getDb();
  const a = db
    .select({ sc: filmAssets.seriesCharacterId, description: filmAssets.description })
    .from(filmAssets)
    .where(eq(filmAssets.id, assetId))
    .get();
  if (!a?.sc) return;
  const c = db
    .select({ img: seriesCharacters.referenceImage })
    .from(seriesCharacters)
    .where(eq(seriesCharacters.id, a.sc))
    .get();
  if (c && !c.img) setSeriesImage(a.sc, join(mediaDir(), file), a.description);
}

export function markEpisodeRendered(filmId) {
  const db = getDb();
  const film = db
    .select({ episodeId: filmProjects.episodeId })
    .from(filmProjects)
    .where(eq(filmProjects.id, filmId))
    .get();
  if (!film?.episodeId) return;
  const ep = db
    .select({ status: seriesEpisodes.status })
    .from(seriesEpisodes)
    .where(eq(seriesEpisodes.id, film.episodeId))
    .get();
  if (ep && ep.status !== "published")
    db.update(seriesEpisodes)
      .set({ status: "rendered", updatedAt: new Date() })
      .where(eq(seriesEpisodes.id, film.episodeId))
      .run();
}

export function filmProgress(filmIds, renderCount) {
  const out = new Map();
  if (!filmIds.length) return out;
  const db = getDb();
  const shots = db
    .select({ filmId: filmAssets.filmId, sel: filmAssets.selectedTakeId, vsel: filmAssets.selectedVideoTakeId })
    .from(filmAssets)
    .where(and(inArray(filmAssets.filmId, filmIds), eq(filmAssets.kind, "shot")))
    .all();
  const doneTakes = new Set(
    db
      .select({ id: filmTakes.id })
      .from(filmTakes)
      .where(and(inArray(filmTakes.filmId, filmIds), eq(filmTakes.status, "done")))
      .all()
      .map((t) => t.id),
  );
  const existing = new Set(
    db
      .select({ id: filmProjects.id })
      .from(filmProjects)
      .where(inArray(filmProjects.id, filmIds))
      .all()
      .map((f) => f.id),
  );
  for (const id of filmIds) {
    if (!existing.has(id)) continue;
    const list = shots.filter((s) => s.filmId === id);
    out.set(id, {
      filmId: id,
      shots: list.length,
      keyframes: list.filter((s) => s.sel && doneTakes.has(s.sel)).length,
      videos: list.filter((s) => s.vsel && doneTakes.has(s.vsel)).length,
      renders: renderCount(id),
    });
  }
  return out;
}

const locKey = (name) => name.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

function seriesLocationRows(filmId) {
  const db = getDb();
  const film = db.select().from(filmProjects).where(eq(filmProjects.id, filmId)).get();
  if (!film?.seriesId) return [];
  const eps = new Map(
    db
      .select({ id: seriesEpisodes.id, number: seriesEpisodes.number })
      .from(seriesEpisodes)
      .where(eq(seriesEpisodes.seriesId, film.seriesId))
      .all()
      .map((e) => [e.id, e.number]),
  );
  const current = film.episodeId ? (eps.get(film.episodeId) ?? 0) : 0;
  const films = db
    .select({ id: filmProjects.id, episodeId: filmProjects.episodeId })
    .from(filmProjects)
    .where(eq(filmProjects.seriesId, film.seriesId))
    .all()
    .filter((f) => f.id !== filmId);
  if (!films.length) return [];
  const epOf = new Map(films.map((f) => [f.id, f.episodeId ? (eps.get(f.episodeId) ?? 0) : 0]));
  const locs = db
    .select()
    .from(filmAssets)
    .where(
      and(
        inArray(
          filmAssets.filmId,
          films.map((f) => f.id),
        ),
        eq(filmAssets.kind, "location"),
        isNotNull(filmAssets.selectedTakeId),
      ),
    )
    .all();
  const takes = new Map(
    locs.length
      ? db
          .select({ id: filmTakes.id, file: filmTakes.file, status: filmTakes.status })
          .from(filmTakes)
          .where(
            inArray(
              filmTakes.id,
              locs.map((l) => l.selectedTakeId),
            ),
          )
          .all()
          .map((t) => [t.id, t])
      : [],
  );
  const rows = [];
  for (const l of locs) {
    const t = takes.get(l.selectedTakeId);
    if (!t?.file || t.status !== "done" || !existsSync(join(mediaDir(), t.file))) continue;
    rows.push({
      assetId: l.id,
      filmId: l.filmId,
      episode: epOf.get(l.filmId) ?? 0,
      name: l.name,
      summary: l.summary,
      image: t.file,
      description: l.description,
      descriptionSrc: l.descriptionSrc,
      promptManual: l.promptManual,
    });
  }
  const rank = (ep) => (ep < current ? current - ep : 1e3 + ep - current);
  rows.sort((a, b) => rank(a.episode) - rank(b.episode));
  const seen = new Set();
  return rows.filter((r) => (seen.has(locKey(r.name)) ? false : (seen.add(locKey(r.name)), true)));
}

export const seriesLocations = (filmId) =>
  seriesLocationRows(filmId).map(({ assetId, episode, name, summary, image }) => ({
    assetId,
    episode,
    name,
    summary,
    image,
  }));

export function adoptSeriesLocation(filmId, assetId, sourceAssetId, copyText = true) {
  const db = getDb();
  const target = db
    .select()
    .from(filmAssets)
    .where(and(eq(filmAssets.id, assetId), eq(filmAssets.filmId, filmId)))
    .get();
  if (!target || target.kind !== "location") throw new Error("Không tìm thấy bối cảnh");
  const src = seriesLocationRows(filmId).find((r) => r.assetId === sourceAssetId);
  if (!src) throw new Error("Bối cảnh của tập kia không còn ảnh đã chọn");
  db.transaction((tx) => adoptRow(tx, filmId, target.id, src, copyText));
}

function adoptRow(tx, filmId, assetId, src, copyText) {
  const takeId = newId();
  const dir = filmDir(filmId);
  mkdirSync(dir, { recursive: true });
  const from = join(mediaDir(), src.image);
  const dest = join(dir, `${takeId}${extname(from).toLowerCase() || ".jpg"}`);
  copyFileSync(from, dest);
  tx.insert(filmTakes)
    .values({
      id: takeId,
      filmId,
      assetId,
      kind: "image",
      status: "done",
      file: rel(dest),
      prompt: `(bối cảnh tập ${src.episode})`,
      model: "series",
      refs: [src.image],
      costUsd: 0,
      finishedAt: new Date(),
    })
    .run();
  tx.update(filmAssets)
    .set({
      selectedTakeId: takeId,
      ...(copyText
        ? {
            summary: src.summary,
            description: src.description,
            descriptionSrc: src.descriptionSrc,
            promptManual: src.promptManual,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(filmAssets.id, assetId))
    .run();
}

export function reuseSeriesLocations(filmId) {
  const lib = new Map(seriesLocationRows(filmId).map((r) => [locKey(r.name), r]));
  if (!lib.size) return 0;
  const db = getDb();
  const locs = db
    .select()
    .from(filmAssets)
    .where(and(eq(filmAssets.filmId, filmId), eq(filmAssets.kind, "location")))
    .all()
    .filter((l) => !l.selectedTakeId && lib.has(locKey(l.name)));
  db.transaction((tx) => locs.forEach((l) => adoptRow(tx, filmId, l.id, lib.get(locKey(l.name)), true)));
  return locs.length;
}
