import { BrowserWindow, dialog } from "electron";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { eq } from "drizzle-orm";
import { settings } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError } from "../errors";
import { mediaDir } from "../media/paths";
import { runFfmpeg, probeDuration } from "../media/ffmpeg";
import { startInstall, cancelInstall, uninstall, status } from "./local-engine";

const KEY = "localtts.clones";
const CLONE_PREFIX = "clone:";
const MIN_SEC = 3;
const MAX_SEC = 15;

export function listClones() {
  return getDb().select().from(settings).where(eq(settings.key, KEY)).get()?.value ?? [];
}

function saveClones(list) {
  getDb()
    .insert(settings)
    .values({ key: KEY, value: list })
    .onConflictDoUpdate({ target: settings.key, set: { value: list, updatedAt: new Date() } })
    .run();
}

export function cloneRef(voiceId) {
  if (!voiceId?.startsWith(CLONE_PREFIX)) return null;
  const c = listClones().find((x) => x.id === voiceId.slice(CLONE_PREFIX.length));
  const abs = c && join(mediaDir(), c.file);
  return abs && existsSync(abs) ? abs : null;
}

export const cloneVoiceId = (c) => `${CLONE_PREFIX}${c.id}`;

export const localTtsHandlers = {
  "localtts.status": ({ detect }) => status(detect),
  "localtts.install": () => startInstall(),
  "localtts.cancel": () => cancelInstall(),
  "localtts.uninstall": () => uninstall(),
  "localtts.clones": () => listClones(),
  "localtts.addClone": async ({ name }) => {
    const opts = {
      title: "Chọn file giọng mẫu (3–15 giây, một người nói, không nhạc nền)",
      properties: ["openFile"],
      filters: [
        { name: "Âm thanh / video", extensions: ["wav", "mp3", "m4a", "aac", "ogg", "flac", "mp4", "mov", "webm"] },
      ],
    };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const src = res.canceled ? null : res.filePaths[0];
    if (!src) return null;
    const dir = join(mediaDir(), "voice-clones");
    mkdirSync(dir, { recursive: true });
    const id = newId();
    const file = `voice-clones/${id}.wav`;
    const abs = join(mediaDir(), file);
    await runFfmpeg([
      "-y",
      "-i",
      src,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-t",
      String(MAX_SEC),
      "-c:a",
      "pcm_s16le",
      abs,
    ]);
    const durationSec = await probeDuration(abs);
    if (durationSec < MIN_SEC) {
      rmSync(abs, { force: true });
      throw new ApiError(
        "VALIDATION",
        `Giọng mẫu chỉ dài ${durationSec.toFixed(1)} giây – cần ít nhất ${MIN_SEC} giây`,
      );
    }
    const clone = { id, name: name.trim() || basename(src, extname(src)), file, durationSec, createdAt: Date.now() };
    saveClones([...listClones(), clone]);
    return clone;
  },
  "localtts.renameClone": ({ id, name }) => {
    saveClones(listClones().map((c) => (c.id === id ? { ...c, name } : c)));
  },
  "localtts.removeClone": ({ id }) => {
    const list = listClones();
    const c = list.find((x) => x.id === id);
    if (!c) return;
    rmSync(join(mediaDir(), c.file), { force: true });
    saveClones(list.filter((x) => x.id !== id));
  },
};
