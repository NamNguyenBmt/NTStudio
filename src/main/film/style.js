import { filmStyleKeywords } from "../ai/film-prompts";
import { FILM_GENRES, FILM_STYLES } from "../../shared/film";
import { eq } from "drizzle-orm";
import { filmProjects } from "../db/schema";
import { getDb } from "../db/index";
import { createHash } from "node:crypto";
import { AiError } from "../ai/providers";

const norm = (s) => (s ?? "").trim();

export function styleKey(i) {
  return createHash("sha256")
    .update([norm(i.genre), norm(i.visualStyle), norm(i.notes)].join("|"))
    .digest("hex")
    .slice(0, 16);
}

export const hasStyleInput = (i) => !!(norm(i.genre) || norm(i.visualStyle) || norm(i.notes));

export async function composeStyleEn(i, workspaceId) {
  const parts = [];
  const custom = [];
  const genre = FILM_GENRES.find((g) => g.label === norm(i.genre));
  const style = FILM_STYLES.find((s) => s.label === norm(i.visualStyle));
  if (norm(i.genre)) genre ? parts.push(genre.en) : custom.push(`Thể loại: ${norm(i.genre)}`);
  if (norm(i.visualStyle)) style ? parts.push(style.en) : custom.push(`Phong cách hình ảnh: ${norm(i.visualStyle)}`);
  if (norm(i.notes)) custom.push(`Ghi chú thêm: ${norm(i.notes)}`);
  if (custom.length) {
    try {
      parts.push(await filmStyleKeywords(custom.join("\n"), parts.join(", "), workspaceId));
    } catch (err) {
      if (!(err instanceof AiError) || (err.kind !== "no_provider" && err.kind !== "quota")) throw err;
      parts.push(
        ...[
          norm(i.genre) && !genre ? norm(i.genre) : "",
          norm(i.visualStyle) && !style ? norm(i.visualStyle) : "",
        ].filter(Boolean),
      );
    }
  }
  return parts.filter(Boolean).join(", ");
}

export async function ensureFilmStyle(filmId, force = false) {
  const db = getDb();
  const f = db.select().from(filmProjects).where(eq(filmProjects.id, filmId)).get();
  if (!f) return "";
  const input = { genre: f.genre, visualStyle: f.visualStyle, notes: f.notes };
  if (!hasStyleInput(input)) return f.style;
  const key = styleKey(input);
  if (!force && (f.styleFor === key || f.styleFor === `manual:${key}`)) return f.style;
  const style = await composeStyleEn(input, f.workspaceId);
  db.update(filmProjects).set({ style, styleFor: key, updatedAt: new Date() }).where(eq(filmProjects.id, filmId)).run();
  return style;
}
