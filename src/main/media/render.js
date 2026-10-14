import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync, renameSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { synthesize } from "../tts/index";
import { workspaces, channels, contentItems, videoProjects, videoScenes, renderJobs, activityLog, seriesCharacters, seriesEpisodes } from "../db/schema";
import { getDb, newId } from "../db/index";
import { AiError } from "../ai/providers";
import { mediaDir } from "./paths";
import { fontsDir, FfmpegError, runFfmpeg, hasAudioStream } from "./ffmpeg";
import { encoderLabel, currentEncoder, encoderArgs } from "./encoders";
import { veoSource, flowConcurrency } from "../flow/session";
import { FlowTransientError } from "../flow/video";
import { hasProvider, veoAvailable, cacheDir, hashOf, pexelsVideo, pixabayVideo, imageEngineIssue, IMAGE_ENGINE_LABEL, imageEngines, imageBy, veoClip } from "./generators";
import { buildAss } from "./subtitles";
import { ASPECT_SIZE, effectiveMode, clipKind } from "../../shared/video";
import { stillImagePrompt } from "./prompts";
import { eq, asc } from "drizzle-orm";

const FPS = 30;
const SAMPLE_RATE = 44100;
const SAMPLES_PER_FRAME = SAMPLE_RATE / FPS;
const FADE_SEC = 0.25;
const SEGMENT_VERSION = 1;
const FALLBACK_COLORS = ["0x1d2433", "0x2b2440", "0x1f3b33", "0x3b1e2f", "0x1e2a3b"];

function splitPrompt(query) {
  const sound = query.match(/(?:^|\.\s*)Sound:\s*([^.]*)\./i)?.[1]?.trim() || null;
  const visual = query.replace(/(^|\.\s*)Sound:[^.]*\./i, "$1").replace(/\s*No on-screen text[^.]*\.?\s*$/i, "").trim().replace(/[.\s]*$/, ".");
  return { visual, sound };
}

function voicedPrompt(query, speaker, line) {
  const { visual, sound } = splitPrompt(query);
  const who = speaker ?? "The on-screen presenter (or a voice-over narrator if nobody is on screen)";
  return [
    `${who} speaks in Vietnamese (tiếng Việt), saying exactly: "${line}"`,
    "Lip-synced, natural Vietnamese pronunciation and intonation.",
    visual,
    `Audio: the only speech is that Vietnamese line – no English, no other words or dialogue${sound ? `; background: ${sound}` : ""}.`,
    "No on-screen text, no subtitles, no watermark."
  ].join(" ");
}

function noSpeechPrompt(query) {
  const { visual, sound } = splitPrompt(query);
  return `${visual} Audio: ${sound ? `${sound}, ` : ""}ambient sound only – no dialogue, no speech, no narration, nobody talks. No on-screen text, no subtitles, no watermark.`;
}

const SOURCE_LABEL = { stock: "Kho video", pixabay: "Kho video", fal: "Fal.ai", nano_banana: "Ảnh Gemini", veo: "Veo", upload: "Clip của bạn" };
const rel = (abs) => abs.slice(mediaDir().length + 1).replace(/\\/g, "/");
export const segmentsDir = (projectId) => join(mediaDir(), "segments", projectId);

function watermarkPos(pos, h) {
  const top = Math.round(h * 0.083);
  const bottom = Math.round(h * 0.156);
  switch (pos) {
    case "tl":
      return `48:${top}`;
    case "tr":
      return `W-w-48:${top}`;
    case "bl":
      return `48:H-h-${bottom}`;
    case "center":
      return "(W-w)/2:(H-h)/2";
    default:
      return `W-w-48:H-h-${bottom}`;
  }
}

const concatLine = (file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
export const ttsCacheDir = (provider, voiceId, text) => join(cacheDir("tts"), hashOf(provider, voiceId ?? "", text));

async function ttsCached(opts) {
  const dir = ttsCacheDir(opts.provider, opts.voiceId, opts.text);
  const metaFile = join(dir, "result.json");
  if (existsSync(metaFile)) {
    try {
      const m = JSON.parse(readFileSync(metaFile, "utf8"));
      const file = join(dir, m.name);
      if (existsSync(file)) return { file, durationSec: m.durationSec, words: m.words, provider: m.provider };
    } catch {
    }
  }
  rmSync(dir, { recursive: true, force: true });
  const r = await synthesize({ ...opts, dir });
  writeFileSync(metaFile, JSON.stringify({ name: basename(r.file), durationSec: r.durationSec, words: r.words, provider: r.provider }));
  return r;
}

export function sceneRefs(projectId) {
  const db = getDb();
  const abs = (p) => join(mediaDir(), p);
  const project = db.select({ referenceImages: videoProjects.referenceImages }).from(videoProjects).where(eq(videoProjects.id, projectId)).get();
  const projectRefs = (project?.referenceImages ?? []).filter((p) => existsSync(abs(p)));
  const ep = db.select({ seriesId: seriesEpisodes.seriesId }).from(seriesEpisodes).where(eq(seriesEpisodes.projectId, projectId)).get();
  const chars = ep ? db.select().from(seriesCharacters).where(eq(seriesCharacters.seriesId, ep.seriesId)).all().filter((c) => c.referenceImage && existsSync(abs(c.referenceImage))) : [];
  return (s) => {
    if (s.sceneRefs)
      return s.sceneRefs.filter((p) => existsSync(abs(p))).slice(0, 3).map(abs);
    const fromChars = chars.filter((c) => c.id === s.speakerId || (s.mediaPrompt ?? "").includes(`${c.name}: `)).map((c) => c.referenceImage);
    return [...new Set([...fromChars, ...projectRefs])].slice(0, 3).map(abs);
  };
}

export const sceneFrames = (s) => {
  const start = s.startImage && existsSync(join(mediaDir(), s.startImage)) ? join(mediaDir(), s.startImage) : null;
  return { start, end: start && s.endImage && existsSync(join(mediaDir(), s.endImage)) ? join(mediaDir(), s.endImage) : null };
};

function stockQueryOf(s) {
  if (s.searchQuery?.trim()) return s.searchQuery.trim();
  const p = s.mediaPrompt?.trim() ?? "";
  const setting = p.match(/Setting:\s*([^.]+)/i)?.[1];
  return (setting ?? p ?? "").split(/\s+/).filter(Boolean).slice(0, 6).join(" ") || s.voiceover.split(/\s+/).slice(0, 4).join(" ");
}

export async function renderProject(jobId, signal, report) {
  const db = getDb();
  const job = db.select().from(renderJobs).where(eq(renderJobs.id, jobId)).get();
  if (!job) throw new Error("Không tìm thấy job render");
  const project = db.select().from(videoProjects).where(eq(videoProjects.id, job.projectId)).get();
  if (!project) throw new Error("Dự án đã bị xóa");
  const scenes = db.select().from(videoScenes).where(eq(videoScenes.projectId, project.id)).orderBy(asc(videoScenes.position)).all().map((s) => project.narration ? s : { ...s, voiceover: "" });
  if (!scenes.length) throw new Error("Dự án chưa có phân cảnh");
  const channel = project.targetChannelId ? db.select().from(channels).where(eq(channels.id, project.targetChannelId)).get() : void 0;
  const workspaceId = project.workspaceId ?? channel?.workspaceId ?? null;
  const ws = workspaceId ? db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get() : void 0;
  const aspect = project.aspect;
  const { w: W, h: H } = ASPECT_SIZE[aspect];
  const transition = project.transition;
  const n = scenes.length;
  const modes = scenes.map((s) => effectiveMode(s.mediaMode, project.renderMode));
  const clipAudio = !project.narration && project.clipAudio === "tts" ? "clip" : project.clipAudio;
  const isClipScene = (i) => modes[i] === "veo" || modes[i] === "upload" && !!scenes[i].mediaPath && clipKind(scenes[i].mediaPath) === "video";
  const clipVoiced = scenes.map((s, i) => clipAudio === "clip" && !!s.voiceover.trim() && isClipScene(i));
  const jobDir = join(mediaDir(), "jobs", jobId);
  mkdirSync(jobDir, { recursive: true });
  const check = () => {
    if (signal.aborted) throw new FfmpegError("Đã hủy", "");
  };
  const audio = [];
  let ttsFellBack = false;
  for (const [i, s] of scenes.entries()) {
    check();
    report.progress(i / n * 0.15, `Tạo giọng đọc cảnh ${i + 1}/${n}`);
    const text = s.voiceover.trim();
    if (!text || clipVoiced[i]) {
      audio.push(null);
      continue;
    }
    try {
      audio.push(
        await ttsCached({ provider: ttsFellBack ? "edge_tts" : project.ttsProvider, voiceId: ttsFellBack ? null : s.voiceId ?? project.voiceId, text, workspaceId, signal })
      );
    } catch (err) {
      if (signal.aborted || project.ttsProvider === "edge_tts" || ttsFellBack) throw err;
      report.note(`Giọng ${project.ttsProvider} lỗi (${err instanceof Error ? err.message : String(err)}) → dùng Edge-TTS`);
      ttsFellBack = true;
      for (let j = 0; j < i; j++) if (audio[j]) audio[j] = await ttsCached({ provider: "edge_tts", voiceId: null, text: scenes[j].voiceover.trim(), workspaceId, signal });
      audio.push(await ttsCached({ provider: "edge_tts", voiceId: null, text, workspaceId, signal }));
    }
  }
  const frames = scenes.map((s, i) => Math.max(1, Math.round(Math.max(s.durationSec, (audio[i]?.durationSec ?? 0) + 0.3) * FPS)));
  const durations = frames.map((f) => f / FPS);
  let totalFrames = frames.reduce((a, b) => a + b, 0);
  let total = totalFrames / FPS;
  const media = new Array(n).fill(null);
  const veoLabel = veoSource() === "flow" ? "Google Flow" : "Veo";
  const usedStock = new Set();
  const stockChain = ["pexels", "pixabay"].filter((p) => hasProvider(p));
  const allEngines = imageEngines();
  const veoReady = veoAvailable();
  const refsOf = sceneRefs(project.id);
  const refScenes = scenes.filter((s) => refsOf(s).length).length;
  if (refScenes) report.note(`${refScenes} cảnh dùng ảnh tham chiếu (nhân vật / sản phẩm) cho ảnh AI Gemini / Veo để hình ảnh đồng nhất`);
  const countOf = (m) => modes.filter((x) => x === m).length;
  if (countOf("veo") && !veoReady)
    report.note(`${countOf("veo")} cảnh chọn Video AI (Veo) nhưng Veo đang tắt/chưa có key Gemini (hoặc chưa đăng nhập Google Flow) – dùng ${allEngines.length ? "ảnh AI" : "video stock"}`);
  if ((countOf("image") || countOf("veo") && !veoReady) && !allEngines.length) report.note(`${imageEngineIssue() ?? "Ảnh AI chưa sẵn sàng"} → dùng video stock`);
  if (!stockChain.length && (countOf("stock") || countOf("image") || countOf("veo")))
    report.note("Kho video miễn phí chưa sẵn sàng (cần kết nối mạng / gói Omnira) – cảnh không có media AI sẽ dùng nền màu");
  const dead = new Map();
  const fatal = (err) => {
    if (!(err instanceof AiError)) return null;
    if (err.kind === "auth" || err.kind === "no_provider" || err.kind === "budget" || err.kind === "quota") return err.message;
    if (err.kind === "rate_limit" && /limit:\s*0|quota|free tier|billing/i.test(err.message)) {
      return "key Gemini gói Free không có hạn mức cho model này – cần bật thanh toán (billing) trong Google AI Studio";
    }
    return null;
  };
  for (let i = 0; i < n; i++) report.scene?.(i, { status: "waiting", text: null, source: null, progress: null, startedAt: null });
  let prepared = 0;
  const prepareScene = async (i) => {
    const s = scenes[i];
    check();
    const mode = modes[i];
    const finish = (st) => {
      report.scene?.(i, st);
      prepared++;
      report.progress(0.15 + prepared / n * 0.2, `Chuẩn bị hình ảnh: ${prepared}/${n} cảnh xong`);
    };
    if (mode === "none") {
      media[i] = null;
      finish({ status: "done", source: "Không dùng hình", text: null, progress: 1 });
      return;
    }
    if (mode === "upload") {
      const abs = s.mediaPath ? join(mediaDir(), s.mediaPath) : null;
      const kind = abs ? clipKind(abs) : null;
      if (abs && kind && existsSync(abs)) {
        media[i] = { file: abs, kind, source: "upload", credit: null };
        finish({ status: "done", source: "Clip / ảnh của bạn", text: null, progress: 1 });
        return;
      }
      report.note(`Cảnh ${i + 1}: không tìm thấy clip đã gắn${s.mediaPath ? ` (${s.mediaPath})` : ""} → tìm hình theo chế độ dự án`);
    }
    report.scene?.(i, { status: "running", text: "Bắt đầu…", startedAt: Date.now() });
    const fallbackMode = mode === "upload" ? effectiveMode("auto", project.renderMode) : mode;
    const useVeo = fallbackMode === "veo" && veoReady;
    const engines = fallbackMode === "stock" ? [] : allEngines;
    const query = s.mediaPrompt?.trim() || s.voiceover.split(/\s+/).slice(0, 4).join(" ");
    const imageQuery = stillImagePrompt(query);
    const stockQuery = stockQueryOf(s);
    let m = null;
    const errors = [];
    const attempt = async (label, fn) => {
      if (m || dead.has(label)) return;
      report.scene?.(i, { status: "running", source: label, text: `${label}: đang tạo…`, progress: null });
      try {
        m = await fn();
        if (!m) errors.push(`${label}: không có kết quả cho "${query}"`);
      } catch (err) {
        if (signal.aborted) throw err;
        const reason = fatal(err);
        if (reason) {
          dead.set(label, reason);
          report.note(`${label} bị bỏ qua cho các cảnh còn lại: ${reason}`);
        }
        errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    if (useVeo) {
      const clip = () => veoClip(
        // Veo tự lồng tiếng: lời thoại tiếng Việt đặt TRƯỚC phần hình (Veo bám phần đầu prompt);
        // giữ tiếng clip mà cảnh không có lời thoại (teaser, cảnh hình) → cấm nói, chỉ tiếng môi trường
        clipVoiced[i] ? voicedPrompt(query, s.speakerId ? s.label ?? "The character" : null, s.voiceover.trim()) : clipAudio !== "tts" ? noSpeechPrompt(query) : query,
        durations[i],
        workspaceId,
        signal,
        (sec, text) => {
          const pct = text?.match(/\b(\d{1,3})%/)?.[1];
          report.scene?.(i, { status: "running", source: veoLabel, text: text ?? `${veoLabel} đang tạo video… ${sec}s`, progress: pct ? Number(pct) / 100 : null });
        },
        aspect,
        refsOf(s),
        sceneFrames(s)
      );
      await attempt(veoLabel, async () => {
        try {
          return await clip();
        } catch (err) {
          if (signal.aborted || veoSource() !== "flow" || fatal(err) || err instanceof FlowTransientError) throw err;
          report.scene?.(i, { status: "running", source: veoLabel, text: `${veoLabel} lỗi – thử lại…`, progress: null });
          console.warn(`[render] cảnh ${i + 1}: Google Flow lỗi, thử lại`, err instanceof Error ? err.message : err);
          return await clip();
        }
      });
    }
    for (const eng of engines) {
      await attempt(IMAGE_ENGINE_LABEL[eng], () => imageBy(eng, imageQuery, workspaceId, signal, aspect, refsOf(s)));
    }
    for (const src of stockChain) {
      await attempt(src === "pexels" ? "Kho video 1" : "Kho video 2", async () => {
        const v = await (src === "pexels" ? pexelsVideo : pixabayVideo)(stockQuery, durations[i], usedStock, signal, aspect);
        if (v) usedStock.add(v.stockId);
        return v;
      });
    }
    const got = m;
    if (errors.length) report.note(`Cảnh ${i + 1}: ${errors.join("; ")}${got ? ` → dùng ${got.credit ?? "nguồn dự phòng"}` : " → dùng nền màu"}`);
    media[i] = got;
    db.update(videoScenes).set({ mediaPath: got ? rel(got.file) : null, mediaCredit: got?.credit ?? null, mediaSource: got?.source ?? null }).where(eq(videoScenes.id, s.id)).run();
    finish({
      status: !got ? "failed" : errors.length ? "fallback" : "done",
      source: got ? got.credit?.replace(/^AI:\s*/, "") ?? SOURCE_LABEL[got.source] ?? got.source : "Nền màu",
      text: errors.length ? errors.join("; ").slice(0, 400) : null,
      progress: 1
    });
  };
  const limit = veoSource() === "flow" ? Math.max(2, flowConcurrency()) : 3;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, n) }, async () => {
      while (next < n && !signal.aborted) await prepareScene(next++);
    })
  );
  check();
  const clipHasAudio = new Map();
  if (clipAudio !== "tts")
    for (let i = 0; i < n; i++) {
      const m = media[i];
      if (m?.kind === "video" && (m.source === "veo" || m.source === "upload")) clipHasAudio.set(i, await hasAudioStream(m.file));
    }
  let voiceFallback = 0;
  for (let i = 0; i < n; i++) {
    if (!clipVoiced[i] || clipHasAudio.get(i)) continue;
    check();
    const text = scenes[i].voiceover.trim();
    try {
      audio[i] = await ttsCached({
        provider: ttsFellBack ? "edge_tts" : project.ttsProvider,
        voiceId: ttsFellBack ? null : scenes[i].voiceId ?? project.voiceId,
        text,
        workspaceId,
        signal
      });
    } catch (err) {
      if (signal.aborted) throw err;
      audio[i] = await ttsCached({ provider: "edge_tts", voiceId: null, text, workspaceId, signal });
    }
    frames[i] = Math.max(frames[i], Math.round((audio[i].durationSec + 0.3) * FPS));
    durations[i] = frames[i] / FPS;
    voiceFallback++;
  }
  if (voiceFallback) report.note(`${voiceFallback} cảnh không có tiếng clip (clip câm hoặc Veo không tạo được) → dùng giọng đọc`);
  if (clipAudio !== "tts" && clipHasAudio.size)
    report.note(`${[...clipHasAudio.values()].filter(Boolean).length} cảnh dùng âm thanh của clip (${clipAudio === "clip" ? "tiếng clip thay giọng đọc" : "trộn dưới giọng đọc"})`);
  totalFrames = frames.reduce((a, b) => a + b, 0);
  total = totalFrames / FPS;
  check();
  mkdirSync(join(jobDir, "fonts"), { recursive: true });
  copyFileSync(join(fontsDir(), "Montserrat-Black.ttf"), join(jobDir, "fonts", "Montserrat-Black.ttf"));
  const wmFile = ws?.watermarkPath && existsSync(ws.watermarkPath) ? ws.watermarkPath : null;
  if (ws?.watermarkPath && !wmFile) report.note(`Không tìm thấy file watermark: ${ws.watermarkPath}`);
  const wmOpacity = (ws?.watermarkOpacity ?? 0.85).toFixed(2);
  const wmPos = watermarkPos(ws?.watermarkPosition ?? "br", H);
  const wmWidth = Math.round(Math.min(W, H) * 0.185);
  const bgmFile = project.bgmTrack ? join(mediaDir(), "bgm", project.bgmTrack) : null;
  const hasBgm = !!bgmFile && existsSync(bgmFile);
  if (project.bgmTrack && !hasBgm) report.note(`Không tìm thấy nhạc nền "${project.bgmTrack}" trong thư mục media/bgm`);
  const segDir = segmentsDir(project.id);
  mkdirSync(segDir, { recursive: true });
  const renderSegment = async (i, enc, onRatio) => {
    const m = media[i];
    const d = durations[i].toFixed(3);
    const subScene = {
      start: 0,
      duration: durations[i],
      text: scenes[i].voiceover,
      words: audio[i]?.words ?? null,
      audioDuration: audio[i]?.durationSec ?? durations[i]
    };
    const fadeIn = transition === "fade_black" && i > 0;
    const fadeOut = transition === "fade_black" && i < n - 1;
    const key = hashOf(
      JSON.stringify({
        v: SEGMENT_VERSION,
        W,
        H,
        media: m ? [m.kind, m.file] : FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        frames: frames[i],
        kenBurns: i % 2,
        sub: [subScene.text, subScene.words, subScene.audioDuration, project.subtitleStyle],
        wm: wmFile ? [wmFile, wmOpacity, wmPos] : null,
        fade: [fadeIn, fadeOut],
        enc
      })
    );
    const file = join(segDir, `${key}.mp4`);
    if (existsSync(file)) return { file, cached: true };
    const subName = project.subtitleStyle === "none" || !subScene.text.trim() ? null : `sub-${i}.ass`;
    if (subName) writeFileSync(join(jobDir, subName), buildAss([subScene], project.subtitleStyle, { w: W, h: H }), "utf8");
    const inputs2 = [];
    const filters2 = [];
    if (m?.kind === "video") {
      inputs2.push("-stream_loop", "-1", "-t", d, "-i", m.file);
      filters2.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1,format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS[base]`);
    } else if (m?.kind === "image") {
      inputs2.push("-i", m.file);
      const z = i % 2 === 0 ? "min(zoom+0.0007,1.15)" : "if(eq(on,0),1.15,max(zoom-0.0007,1.0))";
      const bw = Math.round(W * 1.2);
      const bh = Math.round(H * 1.2);
      filters2.push(
        `[0:v]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames[i]}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS[base]`
      );
    } else {
      inputs2.push("-f", "lavfi", "-t", d, "-i", `color=c=${FALLBACK_COLORS[i % FALLBACK_COLORS.length]}:s=${W}x${H}:r=${FPS}`);
      filters2.push("[0:v]format=yuv420p,setsar=1[base]");
    }
    let cur = "base";
    if (wmFile) {
      inputs2.push("-i", wmFile);
      filters2.push(`[1:v]scale=${wmWidth}:-1,format=rgba,colorchannelmixer=aa=${wmOpacity}[wm]`, `[${cur}][wm]overlay=${wmPos}:format=auto[vw]`);
      cur = "vw";
    }
    const fades = [fadeIn ? `fade=t=in:st=0:d=${FADE_SEC}` : "", fadeOut ? `fade=t=out:st=${(durations[i] - FADE_SEC).toFixed(3)}:d=${FADE_SEC}` : ""].filter(Boolean);
    filters2.push(`[${cur}]${[subName ? `subtitles=${subName}:fontsdir=fonts` : "null", ...fades].join(",")},format=yuv420p[vout]`);
    const part = join(jobDir, `seg-${i}.mp4`);
    await runFfmpeg(
      [
        "-loglevel",
        "error",
        ...inputs2,
        "-filter_complex",
        filters2.join(";"),
        "-map",
        "[vout]",
        "-an",
        ...encoderArgs(enc),
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(FPS),
        // Mỗi đoạn đúng số khung, cùng timescale → nối bằng concat demuxer không lệch thời gian
        "-frames:v",
        String(frames[i]),
        "-video_track_timescale",
        "15360",
        part
      ],
      { cwd: jobDir, signal, totalSec: durations[i], onProgress: onRatio }
    );
    renameSync(part, file);
    return { file, cached: false };
  };
  const renderAudio = async (i) => {
    const samples = frames[i] * SAMPLES_PER_FRAME;
    const a = audio[i];
    const fades = [
      transition === "fade_black" && i > 0 ? `afade=t=in:st=0:d=0.15` : "",
      transition === "fade_black" && i < n - 1 ? `afade=t=out:st=${(durations[i] - 0.15).toFixed(3)}:d=0.15` : ""
    ].filter(Boolean);
    const out = join(jobDir, `a-${i}.wav`);
    const fit = [`aresample=${SAMPLE_RATE}`, "aformat=sample_fmts=s16:channel_layouts=stereo"];
    const pad = [`apad=whole_len=${samples}`, `atrim=end_sample=${samples}`];
    const clipFile = clipAudio !== "tts" && clipHasAudio.get(i) ? media[i].file : null;
    if (clipFile && (clipVoiced[i] || !a)) {
      const vol = clipVoiced[i] || clipAudio === "clip" ? 1 : Math.max(project.clipAudioVolume, 0.8);
      await runFfmpeg(
        [
          "-loglevel",
          "error",
          "-i",
          clipFile,
          "-vn",
          "-af",
          [...fit, `volume=${vol.toFixed(2)}`, ...pad, ...fades].join(","),
          "-c:a",
          "pcm_s16le",
          "-ar",
          String(SAMPLE_RATE),
          "-ac",
          "2",
          out
        ],
        { signal }
      );
      return out;
    }
    if (clipFile && a) {
      await runFfmpeg(
        [
          "-loglevel",
          "error",
          "-i",
          a.file,
          "-i",
          clipFile,
          "-filter_complex",
          `[0:a]${[...fit, "adelay=100:all=1", ...pad].join(",")}[v];[1:a]${[...fit, `volume=${project.clipAudioVolume.toFixed(2)}`, ...pad].join(",")}[c];[v][c]amix=inputs=2:duration=first:normalize=0${fades.length ? "," + fades.join(",") : ""}[o]`,
          "-map",
          "[o]",
          "-c:a",
          "pcm_s16le",
          "-ar",
          String(SAMPLE_RATE),
          "-ac",
          "2",
          out
        ],
        { signal }
      );
      return out;
    }
    await runFfmpeg(
      [
        "-loglevel",
        "error",
        ...a ? ["-i", a.file] : ["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`],
        "-af",
        [
          `aresample=${SAMPLE_RATE}`,
          "aformat=sample_fmts=s16:channel_layouts=stereo",
          "adelay=100:all=1",
          `apad=whole_len=${samples}`,
          `atrim=end_sample=${samples}`,
          ...fades
        ].join(","),
        "-c:a",
        "pcm_s16le",
        "-ar",
        String(SAMPLE_RATE),
        "-ac",
        "2",
        out
      ],
      { signal }
    );
    return out;
  };
  let encoder = await currentEncoder();
  const segFiles = [];
  let reused = 0;
  for (let i = 0; i < n; i++) {
    check();
    const base = 0.35 + i / n * 0.55;
    const stage = `Dựng cảnh ${i + 1}/${n} (${encoderLabel[encoder]})`;
    report.progress(base, stage);
    try {
      const seg = await renderSegment(i, encoder, (r) => report.progress(base + r * 0.55 / n, stage));
      segFiles.push(seg.file);
      if (seg.cached) reused++;
    } catch (err) {
      if (signal.aborted || encoder === "libx264") throw err;
      report.note(`${encoderLabel[encoder]} lỗi khi mã hóa → chuyển sang CPU libx264`);
      encoder = "libx264";
      segFiles.length = 0;
      reused = 0;
      i = -1;
    }
  }
  if (reused) report.note(`Dùng lại ${reused}/${n} cảnh đã dựng từ lần render trước – chỉ dựng ${n - reused} cảnh mới hoặc đã sửa`);
  check();
  report.progress(0.9, "Chuẩn bị âm thanh");
  const wavs = [];
  for (let i = 0; i < n; i++) wavs.push(await renderAudio(i));
  writeFileSync(join(jobDir, "video.txt"), segFiles.map(concatLine).join("\n") + "\n", "utf8");
  writeFileSync(join(jobDir, "audio.txt"), wavs.map(concatLine).join("\n") + "\n", "utf8");
  const inputs = ["-f", "concat", "-safe", "0", "-i", "video.txt", "-f", "concat", "-safe", "0", "-i", "audio.txt"];
  const filters = [];
  if (hasBgm) {
    inputs.push("-stream_loop", "-1", "-i", bgmFile);
    filters.push(
      `[2:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${project.bgmVolume.toFixed(2)},atrim=0:${total.toFixed(3)}[bg]`,
      `[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vo1][vo2]`,
      "[bg][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[bgd]",
      "[vo2][bgd]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]"
    );
  } else {
    filters.push("[1:a]alimiter=limit=0.95[aout]");
  }
  const outTmp = join(jobDir, "out.mp4");
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
      // Hình đã mã hóa ở từng đoạn → chỉ nối, không mã hóa lại
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
      outTmp
    ],
    { cwd: jobDir, signal, totalSec: total, onProgress: (r) => report.progress(0.9 + r * 0.06, "Ghép các cảnh & trộn âm thanh") }
  );
  check();
  report.progress(0.96, "Tạo thumbnail & cập nhật kho");
  const stamp = (new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const renders = join(mediaDir(), "renders");
  const thumbs = join(mediaDir(), "thumbs");
  mkdirSync(renders, { recursive: true });
  mkdirSync(thumbs, { recursive: true });
  const outFile = join(renders, `${project.id.slice(0, 8)}-${stamp}.mp4`);
  renameSync(outTmp, outFile);
  const thumbFile = join(thumbs, `${project.id.slice(0, 8)}-${stamp}.jpg`);
  await runFfmpeg(
    ["-loglevel", "error", "-ss", Math.min(1, total / 2).toFixed(2), "-i", outFile, "-frames:v", "1", "-vf", `scale=${W >= H ? 960 : 540}:-1`, "-q:v", "3", thumbFile],
    { signal }
  );
  db.transaction((tx) => {
    const values = {
      workspaceId,
      kind: "video",
      title: project.topic.slice(0, 300),
      aspect,
      durationSec: Math.round(total * 10) / 10,
      source: "studio",
      mediaPaths: [rel(outFile)],
      thumbnailPath: rel(thumbFile)
    };
    const existing = project.contentItemId ? tx.select().from(contentItems).where(eq(contentItems.id, project.contentItemId)).get() : void 0;
    if (existing) {
      tx.update(contentItems).set({ ...values, ...existing.status === "draft" ? { status: "ready" } : {}, caption: existing.caption ?? scenes[0].voiceover, updatedAt: new Date() }).where(eq(contentItems.id, existing.id)).run();
    } else {
      const id = newId();
      tx.insert(contentItems).values({ id, ...values, caption: scenes[0].voiceover, status: "ready" }).run();
      tx.update(videoProjects).set({ contentItemId: id }).where(eq(videoProjects.id, project.id)).run();
    }
    tx.update(videoProjects).set({ status: "rendered", updatedAt: new Date() }).where(eq(videoProjects.id, project.id)).run();
    tx.insert(activityLog).values({ level: "ok", scope: "render", message: `Render xong "${project.topic.slice(0, 60)}" (${total.toFixed(1)}s, ${encoderLabel[encoder]})` }).run();
  });
  const keep = new Set(segFiles.map((f) => basename(f)));
  for (const f of readdirSync(segDir)) if (!keep.has(f)) rmSync(join(segDir, f), { force: true });
  rmSync(jobDir, { recursive: true, force: true });
  return { outputPath: rel(outFile), encoder, durationSec: Math.round(total * 100) / 100 };
}
