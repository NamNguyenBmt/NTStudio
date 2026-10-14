import { wantsVietnameseSubtitle, translateSubtitles } from "./script";
import { convertVoice, dubVoiceOf, dubLines } from "./dub";
import { existsSync, readdirSync, statSync, rmSync, mkdirSync, copyFileSync, writeFileSync, renameSync } from "node:fs";
import { relative, join } from "node:path";
import { eq, and, asc } from "drizzle-orm";
import { contentItems, activityLog, filmProjects, filmAssets, filmTakes } from "../db/schema";
import { getDb, newId } from "../db/index";
import { mediaDir } from "../media/paths";
import { fontsDir, runFfmpeg, hasAudioStream, probeDuration } from "../media/ffmpeg";
import { encoderLabel, currentEncoder, encoderArgs } from "../media/encoders";
import { buildAss } from "../media/subtitles";
import { ASPECT_SIZE } from "../../shared/video";
import { isVietnameseDialogue } from "../../shared/film";
import { markEpisodeRendered } from "./series-link";
import { filmDir } from "./queue";
import { parseDialogue } from "./prompts";

const FPS = 30;
const SAMPLE_RATE = 44100;
const SAMPLES_PER_FRAME = SAMPLE_RATE / FPS;
const FADE_SEC = 0.35;
const jobs = new Map();

export function assembleStatus(filmId) {
  const j = jobs.get(filmId);
  if (!j) return { running: false, progress: 0, stage: "", error: null, output: null, notes: [] };
  const { ctrl: _c, ...rest } = j;
  return rest;
}

export function cancelAssemble(filmId) {
  jobs.get(filmId)?.ctrl?.abort();
}

const rel = (abs) => relative(mediaDir(), abs).split("\\").join("/");
const concatLine = (file) => `file '${file.split("\\").join("/").split("'").join("'\\''")}'`;
const rendersDir = (filmId) => join(filmDir(filmId), "renders");

export function listRenders(filmId) {
  const dir = rendersDir(filmId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => {
      const abs = join(dir, f);
      const st = statSync(abs);
      const thumb = abs.replace(/\.mp4$/, ".jpg");
      return {
        file: rel(abs),
        thumbnail: existsSync(thumb) ? rel(thumb) : null,
        sizeBytes: st.size,
        createdAt: st.mtime,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function startAssemble(filmId, opts) {
  if (jobs.get(filmId)?.running) throw new Error("Phim đang được ghép");
  const ctrl = new AbortController();
  const job = { running: true, progress: 0, stage: "Chuẩn bị", error: null, output: null, notes: [], ctrl };
  jobs.set(filmId, job);
  assemble(
    filmId,
    opts,
    ctrl.signal,
    (p, stage) => ((job.progress = p), stage && (job.stage = stage)),
    (n) => job.notes.push(n),
  )
    .then((out) => {
      job.output = out;
      job.stage = "Xong";
      job.progress = 1;
      markEpisodeRendered(filmId);
    })
    .catch((err) => {
      job.error = ctrl.signal.aborted ? "Đã hủy" : err instanceof Error ? err.message : String(err);
      console.error("[film] ghép tập lỗi", err);
    })
    .finally(() => (job.running = false));
}

async function assemble(filmId, opts, signal, progress, note) {
  const db = getDb();
  const film = db.select().from(filmProjects).where(eq(filmProjects.id, filmId)).get();
  if (!film) throw new Error("Không tìm thấy phim");
  const shots = db
    .select()
    .from(filmAssets)
    .where(and(eq(filmAssets.filmId, filmId), eq(filmAssets.kind, "shot")))
    .orderBy(asc(filmAssets.position))
    .all();
  const takes = new Map(
    db
      .select()
      .from(filmTakes)
      .where(and(eq(filmTakes.filmId, filmId), eq(filmTakes.status, "done"), eq(filmTakes.kind, "video")))
      .all()
      .map((t) => [t.id, t]),
  );
  const clips = [];
  for (const s of shots) {
    const t = s.selectedVideoTakeId ? takes.get(s.selectedVideoTakeId) : void 0;
    const file = t?.file ? join(mediaDir(), t.file) : null;
    if (file && existsSync(file)) clips.push({ shot: s, file });
  }
  const missing = shots.length - clips.length;
  if (!clips.length) throw new Error("Chưa có cảnh nào có video đã chọn – tạo video ở bước Video trước");
  if (missing) note(`Bỏ qua ${missing} cảnh chưa có video đã chọn`);
  const { w: W, h: H } = ASPECT_SIZE[film.aspect];
  const jobDir = join(filmDir(filmId), "assemble-tmp");
  rmSync(jobDir, { recursive: true, force: true });
  mkdirSync(jobDir, { recursive: true });
  if (opts.subtitleStyle !== "none") {
    mkdirSync(join(jobDir, "fonts"), { recursive: true });
    copyFileSync(join(fontsDir(), "Montserrat-Black.ttf"), join(jobDir, "fonts", "Montserrat-Black.ttf"));
  }
  const n = clips.length;
  const durations = [];
  for (const c of clips) {
    const clipSec = await probeDuration(c.file).catch(() => c.shot.durationSec);
    durations.push(Math.max(1, Math.min(c.shot.durationSec, clipSec)));
  }
  const frames = durations.map((d) => Math.max(1, Math.round(d * FPS)));
  const total = frames.reduce((a, f) => a + f, 0) / FPS;
  const fade = opts.transition === "fade_black";
  const viSubs =
    opts.subtitleStyle !== "none" && wantsVietnameseSubtitle(film)
      ? await vietnameseSubtitles(
          film,
          clips.map((c) => c.shot),
          progress,
          note,
        )
      : null;
  let encoder = await currentEncoder();
  const segs = [];
  for (let i = 0; i < n; i++) {
    if (signal.aborted) throw new Error("Đã hủy");
    const base = (i / n) * 0.8;
    const stage = `Dựng cảnh ${i + 1}/${n} (${encoderLabel[encoder]})`;
    progress(base, stage);
    const d = frames[i] / FPS;
    const subText = viSubs
      ? (viSubs.get(clips[i].shot.id) ?? "")
      : parseDialogue(clips[i].shot.dialogue)
          .map((x) => x.line)
          .join(" ");
    const subName = opts.subtitleStyle !== "none" && subText.trim() ? `sub-${i}.ass` : null;
    if (subName)
      writeFileSync(
        join(jobDir, subName),
        buildAss(
          [{ start: 0, duration: d, text: subText, words: null, audioDuration: Math.max(0.5, d - 0.3) }],
          opts.subtitleStyle,
          { w: W, h: H },
        ),
        "utf8",
      );
    const vf = [
      `scale=${W}:${H}:force_original_aspect_ratio=increase`,
      `crop=${W}:${H}`,
      `fps=${FPS}`,
      "setsar=1",
      `trim=duration=${d.toFixed(3)}`,
      "setpts=PTS-STARTPTS",
      ...(subName ? [`subtitles=${subName}:fontsdir=fonts`] : []),
      ...(fade && i > 0 ? [`fade=t=in:st=0:d=${FADE_SEC}`] : []),
      ...(fade && i < n - 1 ? [`fade=t=out:st=${(d - FADE_SEC).toFixed(3)}:d=${FADE_SEC}`] : []),
      "format=yuv420p",
    ].join(",");
    const seg = join(jobDir, `seg-${i}.mp4`);
    const encode = (enc) =>
      runFfmpeg(
        [
          "-loglevel",
          "error",
          "-i",
          clips[i].file,
          "-an",
          "-vf",
          vf,
          ...encoderArgs(enc),
          "-r",
          String(FPS),
          "-frames:v",
          String(frames[i]),
          "-video_track_timescale",
          "15360",
          seg,
        ],
        { cwd: jobDir, signal, totalSec: d, onProgress: (r) => progress(base + (r * 0.8) / n, stage) },
      );
    try {
      await encode(encoder);
    } catch (err) {
      if (signal.aborted || encoder === "libx264") throw err;
      note(`${encoderLabel[encoder]} lỗi → chuyển sang CPU libx264`);
      encoder = "libx264";
      segs.length = 0;
      i = -1;
      continue;
    }
    segs.push(seg);
  }
  progress(0.82, "Chuẩn bị âm thanh");
  const chars = db
    .select()
    .from(filmAssets)
    .where(and(eq(filmAssets.filmId, filmId), eq(filmAssets.kind, "character")))
    .all();
  const charByName = (name) =>
    name ? chars.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()) : void 0;
  const vietnamese = isVietnameseDialogue(film.dialogueLanguage);
  const voiceNotes = new Map();
  const vnote = (msg) => void voiceNotes.set(msg, (voiceNotes.get(msg) ?? 0) + 1);
  let converted = 0;
  let dubbed = 0;
  const wavs = [];
  for (let i = 0; i < n; i++) {
    if (signal.aborted) throw new Error("Đã hủy");
    const samples = frames[i] * SAMPLES_PER_FRAME;
    const sceneSec = frames[i] / FPS;
    const out2 = join(jobDir, `a-${i}.wav`);
    const hasClipAudio = await hasAudioStream(clips[i].file).catch(() => false);
    const lines = parseDialogue(clips[i].shot.dialogue);
    let voice = null;
    let voiceSec = 0;
    if (film.voiceMode === "convert" && lines.length && hasClipAudio) {
      progress(0.82 + (i / n) * 0.03, `Đổi giọng nhân vật cảnh ${i + 1}/${n}`);
      const speakers = [...new Set(lines.map((l) => l.speaker?.trim().toLowerCase()).filter(Boolean))];
      const c = speakers.length === 1 ? charByName(speakers[0]) : void 0;
      if (speakers.length !== 1)
        vnote("cảnh có nhiều người nói (hoặc không ghi tên người nói) → giữ giọng gốc của clip");
      else if (c?.voiceProvider !== "elevenlabs" || !c.voiceId)
        vnote(`nhân vật "${c?.name ?? speakers[0]}" chưa chọn giọng ElevenLabs → giữ giọng gốc`);
      else {
        try {
          voice = await convertVoice({
            clip: clips[i].file,
            voiceId: c.voiceId,
            workspaceId: film.workspaceId,
            signal,
          });
          converted++;
        } catch (err) {
          if (signal.aborted) throw err;
          vnote(`đổi giọng lỗi (${err instanceof Error ? err.message : String(err)}) → giữ giọng gốc`);
        }
      }
    } else if (film.voiceMode === "dub" && lines.length) {
      progress(0.82 + (i / n) * 0.03, `Lồng tiếng cảnh ${i + 1}/${n}`);
      try {
        const r = await dubLines({
          lines,
          voiceFor: (sp) => {
            const c = charByName(sp);
            const v = dubVoiceOf(c, vietnamese);
            if (!v) vnote(`"${sp ?? "người dẫn"}" chưa có giọng đọc → bỏ câu thoại`);
            else if (v.fallback)
              vnote(`"${c?.name ?? sp ?? "người dẫn"}" chưa chọn giọng đọc → dùng giọng Edge-TTS mặc định`);
            return v;
          },
          out: join(jobDir, `dub-${i}.wav`),
          workspaceId: film.workspaceId,
          signal,
        });
        if (r) {
          voice = r.file;
          voiceSec = r.durationSec;
          dubbed++;
        }
      } catch (err) {
        if (signal.aborted) throw err;
        vnote(`lồng tiếng lỗi (${err instanceof Error ? err.message : String(err)}) → giữ tiếng clip`);
      }
    }
    const useClip = !voice && opts.clipAudio && hasClipAudio;
    const tempo = voice && voiceSec > sceneSec - 0.1 ? Math.min(1.35, voiceSec / Math.max(0.5, sceneSec - 0.1)) : 1;
    if (tempo >= 1.35 && voiceSec / Math.max(0.5, sceneSec - 0.1) > 1.35)
      vnote("lời thoại dài hơn cảnh → bị cắt bớt cuối câu (nên tăng thời lượng cảnh)");
    const af = [
      `aresample=${SAMPLE_RATE}`,
      "aformat=sample_fmts=s16:channel_layouts=stereo",
      ...(tempo > 1.01 ? [`atempo=${tempo.toFixed(3)}`] : []),
      ...(useClip ? [`volume=${opts.clipVolume.toFixed(2)}`] : []),
      `apad=whole_len=${samples}`,
      `atrim=end_sample=${samples}`,
      ...(fade && i > 0 ? ["afade=t=in:st=0:d=0.2"] : []),
      ...(fade && i < n - 1 ? [`afade=t=out:st=${(frames[i] / FPS - 0.2).toFixed(3)}:d=0.2`] : []),
    ].join(",");
    const input = voice
      ? ["-i", voice]
      : useClip
        ? ["-i", clips[i].file, "-vn"]
        : ["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`];
    await runFfmpeg(
      ["-loglevel", "error", ...input, "-af", af, "-c:a", "pcm_s16le", "-ar", String(SAMPLE_RATE), "-ac", "2", out2],
      { signal },
    );
    wavs.push(out2);
  }
  if (converted)
    note(`Đổi giọng nhân vật (ElevenLabs) cho ${converted} cảnh – tiếng động nền của clip ở các cảnh này được bỏ`);
  if (dubbed) note(`Lồng tiếng ${dubbed} cảnh bằng giọng đọc của nhân vật`);
  for (const [msg, count] of voiceNotes) note(`${count} cảnh: ${msg}`);
  writeFileSync(join(jobDir, "video.txt"), segs.map(concatLine).join("\n") + "\n", "utf8");
  writeFileSync(join(jobDir, "audio.txt"), wavs.map(concatLine).join("\n") + "\n", "utf8");
  const bgm = opts.bgmTrack ? join(mediaDir(), "bgm", opts.bgmTrack) : null;
  const hasBgm = !!bgm && existsSync(bgm);
  if (opts.bgmTrack && !hasBgm) note(`Không tìm thấy nhạc nền "${opts.bgmTrack}" – xuất không nhạc nền`);
  const inputs = ["-f", "concat", "-safe", "0", "-i", "video.txt", "-f", "concat", "-safe", "0", "-i", "audio.txt"];
  const filters = [];
  if (hasBgm) {
    inputs.push("-stream_loop", "-1", "-i", bgm);
    filters.push(
      `[2:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${opts.bgmVolume.toFixed(2)},atrim=0:${total.toFixed(3)},afade=t=out:st=${Math.max(0, total - 2).toFixed(3)}:d=2[bg]`,
      "[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vo1][vo2]",
      "[bg][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[bgd]",
      "[vo2][bgd]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
    );
  } else filters.push("[1:a]alimiter=limit=0.95[aout]");
  const tmp = join(jobDir, "out.mp4");
  await runFfmpeg(
    [
      "-loglevel",
      "error",
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      String(SAMPLE_RATE),
      "-t",
      total.toFixed(3),
      "-movflags",
      "+faststart",
      tmp,
    ],
    {
      cwd: jobDir,
      signal,
      totalSec: total,
      onProgress: (r) => progress(0.85 + r * 0.12, "Nối các cảnh & trộn âm thanh"),
    },
  );
  const dir = rendersDir(filmId);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const out = join(dir, `${stamp}.mp4`);
  renameSync(tmp, out);
  await runFfmpeg(
    [
      "-loglevel",
      "error",
      "-ss",
      Math.min(1, total / 2).toFixed(2),
      "-i",
      out,
      "-frames:v",
      "1",
      "-vf",
      `scale=${W >= H ? 960 : 540}:-1`,
      "-q:v",
      "3",
      out.replace(/\.mp4$/, ".jpg"),
    ],
    { signal },
  );
  rmSync(jobDir, { recursive: true, force: true });
  db.insert(activityLog)
    .values({
      level: "ok",
      scope: "render",
      message: `Ghép xong phim "${film.title.slice(0, 60)}" (${n} cảnh, ${total.toFixed(1)}s, ${encoderLabel[encoder]})`,
    })
    .run();
  return rel(out);
}

async function vietnameseSubtitles(film, shots, progress, note) {
  const out = new Map();
  const todo = [];
  for (const s of shots) {
    const dialogue = s.dialogue?.trim();
    if (!dialogue) continue;
    if (s.subtitle?.trim() && s.subtitleSrc === dialogue) out.set(s.id, s.subtitle.trim());
    else todo.push({ id: s.id, dialogue });
  }
  if (!todo.length) return out;
  progress(0, `Dịch phụ đề tiếng Việt (${todo.length} cảnh)`);
  try {
    const done = await translateSubtitles(film, todo);
    const db = getDb();
    for (const t of todo) {
      const vi = done.get(t.id);
      if (!vi) continue;
      out.set(t.id, vi);
      db.update(filmAssets).set({ subtitle: vi, subtitleSrc: t.dialogue }).where(eq(filmAssets.id, t.id)).run();
    }
    note(`Dịch phụ đề tiếng Việt cho ${done.size} cảnh – xem / sửa ở ô "Phụ đề tiếng Việt" của từng cảnh`);
    if (done.size < todo.length) note(`${todo.length - done.size} cảnh chưa dịch được phụ đề → không có phụ đề`);
  } catch (err) {
    note(
      `Không dịch được phụ đề tiếng Việt (${err instanceof Error ? err.message : String(err)}) → ${todo.length} cảnh không có phụ đề`,
    );
  }
  return out;
}

export async function renderToContent(filmId, file) {
  const db = getDb();
  const film = db.select().from(filmProjects).where(eq(filmProjects.id, filmId)).get();
  if (!film) throw new Error("Không tìm thấy phim");
  const abs = join(mediaDir(), file);
  if (!abs.startsWith(rendersDir(filmId)) || !existsSync(abs)) throw new Error("Không tìm thấy file video");
  const thumb = file.replace(/\.mp4$/, ".jpg");
  const durationSec = await probeDuration(abs).catch(() => null);
  const id = newId();
  db.insert(contentItems)
    .values({
      id,
      workspaceId: film.workspaceId,
      kind: "video",
      title: film.title.slice(0, 300),
      caption: film.logline ?? null,
      aspect: film.aspect,
      durationSec: durationSec == null ? null : Math.round(durationSec * 10) / 10,
      source: "film",
      mediaPaths: [file],
      thumbnailPath: existsSync(join(mediaDir(), thumb)) ? thumb : null,
      status: "ready",
    })
    .run();
  return id;
}
