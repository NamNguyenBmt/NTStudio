import { useState, useEffect, useRef } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { AudioLines, CalendarPlus, ClipboardList, Copy, FolderOpen, Pause, Play, Rocket, SkipBack, Square, TriangleAlert, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Select } from "../../components/ui/Input";
import { Kbd } from "../../components/ui/Kbd";
import { Progress } from "../../components/ui/Progress";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { StatusDot } from "../../components/ui/StatusDot";
import { toast } from "../../components/ui/toast";
import { mediaUrl, encoderShort } from "../../lib/media";
import { fmtTime } from "./Storyboard";
import { ASPECT_SIZE, SUBTITLE_STYLES } from "../../../../shared/video";
import { providerInfo } from "../../../../shared/providers";
import { MusicDialog } from "./MusicDialog";

const SUB_LOOK = {
  "montserrat-kara-pop": {
    text: "text-[17px] font-black uppercase tracking-tight",
    style: { WebkitTextStroke: "0.5px #000" },
    active: "text-[#FFD400]"
  },
  "hormozi-green": {
    text: "text-[17px] font-black uppercase tracking-tight",
    style: { WebkitTextStroke: "0.6px #000" },
    active: "inline-block scale-[1.18] text-[#3BFF6B]"
  },
  "neon-glow": {
    text: "text-[16px] font-black",
    active: "text-[#00E5FF]",
    activeStyle: { textShadow: "0 0 6px #00E5FF, 0 0 12px #00E5FF" }
  },
  "bold-outline": {
    text: "text-[16px] font-black uppercase tracking-tight",
    style: { WebkitTextStroke: "0.8px #000" }
  },
  "movie-yellow": {
    text: "text-[13px] font-bold text-[#FFF060]",
    style: { textShadow: "0 0 2px #000, 1px 1px 2px #000" }
  },
  "clean-white": { text: "text-[14px] font-semibold", box: true }
};

const SCENE_BG = [
  "from-[#3b2a1e] via-[#1d2433] to-[#0b1326]",
  "from-[#1e2a3b] via-[#2b2440] to-[#0b1326]",
  "from-[#1f3b33] via-[#1d2433] to-[#0b1326]",
  "from-[#3b1e2f] via-[#24203b] to-[#0b1326]"
];

function karaoke(text, t, duration) {
  const all = text.trim().split(/\s+/).filter(Boolean);
  if (!all.length) return { words: [], active: -1 };
  const idx = Math.min(all.length - 1, Math.floor(t / Math.max(0.1, duration) * all.length));
  const chunk = 5;
  const start = Math.floor(idx / chunk) * chunk;
  return { words: all.slice(start, start + chunk), active: idx - start };
}

const FRAME = {
  "9:16": "aspect-[9/16] w-full max-w-[260px]",
  "16:9": "aspect-video w-full",
  "1:1": "aspect-square w-full max-w-[320px]"
};

export function PreviewPanel({
  project,
  scenes,
  activeIndex,
  channelHandle,
  onPatch,
  onFocusScene,
  onToContent,
  toContentPending,
  contentLinked,
  latestJob,
  onRender,
  onCancelRender,
  renderPending,
  onExportPrompts
}) {
  const { data: bgmList = [] } = useApiQuery("media.bgmList");
  const { data: encoders } = useApiQuery("media.info");
  const { data: estimate } = useApiQuery("render.estimate", { projectId: project.id }, { staleTime: 0 });
  const importBgm = useApiMutation("media.importBgm", ["media."]);
  const { data: providers = [] } = useApiQuery("ai.providers");
  const musicProviders = providers.filter(
    (p) => p.category === "music" && p.enabled && (p.hasKey || providers.some((o) => o.provider === providerInfo(p.provider).keyFrom && o.hasKey))
  );
  const [musicOpen, setMusicOpen] = useState(false);
  const showInFolder = useApiMutation("media.showInFolder");
  const active = latestJob && (latestJob.status === "queued" || latestJob.status === "running");
  const done = latestJob?.status === "done" && latestJob.outputPath ? latestJob : null;
  const [hiddenLog, setHiddenLog] = useState(() => {
    try {
      return localStorage.getItem("studio.hiddenRenderLog");
    } catch {
      return null;
    }
  });
  const hideLog = (jobId) => {
    setHiddenLog(jobId);
    try {
      localStorage.setItem("studio.hiddenRenderLog", jobId);
    } catch {
    }
  };
  const copyLog = (job) => {
    const text = [job.status === "failed" ? "Render lỗi" : job.stage ?? job.status, job.error ?? "", ...job.notes].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success("Đã copy log render"),
      () => toast.error("Không copy được")
    );
  };
  const [view, setView] = useState("live");
  useEffect(() => {
    if (done) setView("render");
  }, [done?.id]);
  const total = scenes.reduce((a, s) => a + s.durationSec, 0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef();
  const last = useRef();
  useEffect(() => {
    if (!playing) return;
    const step = (now) => {
      const dt = last.current != null ? (now - last.current) / 1e3 : 0;
      last.current = now;
      setTime((t) => {
        const next = t + dt;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      last.current = void 0;
    };
  }, [playing, total]);
  useEffect(() => setTime((t) => Math.min(t, total)), [total]);
  let acc = 0;
  let sceneIndex = scenes.length - 1;
  for (let i = 0; i < scenes.length; i++) {
    if (time < acc + scenes[i].durationSec) {
      sceneIndex = i;
      break;
    }
    acc += scenes[i].durationSec;
  }
  const scene = scenes[sceneIndex];
  const sceneStart = scenes.slice(0, Math.max(0, sceneIndex)).reduce((a, s) => a + s.durationSec, 0);
  const sub = scene ? karaoke(scene.voiceover, time - sceneStart, scene.durationSec) : { words: [], active: -1 };
  const look = SUB_LOOK[project.subtitleStyle] ?? SUB_LOOK["montserrat-kara-pop"];
  useEffect(() => {
    if (playing && sceneIndex >= 0) onFocusScene(sceneIndex);
  }, [playing, sceneIndex, onFocusScene]);
  useEffect(() => {
    if (playing || activeIndex === sceneIndex || activeIndex < 0 || activeIndex >= scenes.length) return;
    setTime(scenes.slice(0, activeIndex).reduce((a, s) => a + s.durationSec, 0) + 0.01);
  }, [activeIndex]);
  const togglePlay = () => {
    if (!scenes.length) return;
    if (time >= total) setTime(0);
    setPlaying((p) => !p);
  };
  return <Card className="flex min-h-0 flex-col">
    <div className="flex items-center justify-between gap-space-sm border-b border-overlay/[0.06] p-space-md">
      <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-tertiary text-label-md text-on-tertiary">
          3
        </span>
        {"Preview & Render"}
      </h2>
      <Badge tone="success" mono={true}><StatusDot health="ok" live={playing} />{" Live "}{project.aspect}</Badge>
    </div>
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-space-md overflow-y-auto p-space-md">
      {done && <SegmentedControl
        label="Chế độ xem"
        className="self-center"
        value={view}
        onChange={setView}
        options={[
          { value: "live", label: "Xem nhanh" },
          { value: "render", label: "Bản render" }
        ]}
      />}
      {view === "render" && done ? <video
        key={done.outputPath}
        src={mediaUrl(done.outputPath)}
        poster={mediaUrl(done.outputPath.replace(/^renders\//, "thumbs/").replace(/\.mp4$/, ".jpg"))}
        controls={true}
        className={`mx-auto ${FRAME[project.aspect]} rounded-2xl bg-black shadow-flyout`}
      /> : <>
        <div
          className={cn(
            `relative mx-auto ${FRAME[project.aspect]}`,
            "overflow-hidden rounded-2xl bg-gradient-to-b shadow-flyout",
            SCENE_BG[sceneIndex % SCENE_BG.length]
          )}
        >
          {channelHandle && <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 font-mono text-[10px] text-white">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-secondary" />
            @
            {channelHandle}
          </span>}
          {scene?.mediaPrompt && <span className="absolute left-2 top-2 max-w-[60%] truncate rounded bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-white/70">
            {scene.mediaPrompt}
          </span>}
          {project.narration && project.subtitleStyle !== "none" && <div
            className={cn(
              "absolute inset-x-3 bottom-14 flex min-h-[64px] items-center justify-center rounded-lg px-2 py-2 text-center",
              sub.words.length && !look.box ? "bg-transparent" : "bg-black/45"
            )}
          >
            {sub.words.length ? <p
              className={cn("leading-tight text-white", look.text)}
              style={{
                fontFamily: "Montserrat, sans-serif",
                ...look.style
              }}
            >
              {sub.words.map((w, i) => {
                const on = look.active != null && i === sub.active;
                return <span key={i} className={cn(on && look.active)} style={on ? look.activeStyle : void 0}>
                  {w}
                  {" "}
                </span>;
              })}
            </p> : <span className="text-label-sm text-white/50">
              {scenes.length ? "Cảnh chưa có lời thoại" : "Chưa có phân cảnh"}
            </span>}
          </div>}
          <div className="absolute inset-x-3 bottom-3 flex items-center gap-space-sm">
            <button type="button" onClick={togglePlay} aria-label={playing ? "Tạm dừng" : "Phát"} className="text-white">
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0.1, total)}
              step={0.1}
              value={time}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
              aria-label="Tua thời gian"
              className="h-1 flex-1 accent-secondary"
            />
            <span className="whitespace-nowrap font-mono text-[10px] text-white">
              {fmtTime(time)}
              {" / "}
              {fmtTime(total)}
            </span>
          </div>
        </div>
        <div className="flex justify-center gap-space-sm">
          <Button size="sm" variant="subtle" onClick={() => (setPlaying(false), setTime(0))}>
            <SkipBack size={12} />
            {" Về đầu"}
          </Button>
          <Button size="sm" variant="subtle" onClick={togglePlay} disabled={!scenes.length}>
            {playing ? <Pause size={12} /> : <Play size={12} />}
            {" "}
            {playing ? "Tạm dừng" : "Phát thử"}
          </Button>
        </div>
      </>}
      <div className="grid grid-cols-2 gap-space-sm">
        <label className="flex flex-col gap-1">
          <span className="text-label-sm text-outline">Kiểu phụ đề</span>
          <Select value={project.subtitleStyle} disabled={!project.narration} title={project.narration ? void 0 : "Không lời thoại – không có phụ đề"} onChange={(e) => onPatch({ subtitleStyle: e.target.value })}>
            {SUBTITLE_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label-sm text-outline">Nhạc nền (BGM)</span>
          <Select
            value={project.bgmTrack ?? ""}
            disabled={importBgm.isPending}
            onChange={(e) => {
              if (e.target.value === "__import") {
                importBgm.mutate(void 0, {
                  onSuccess: (name) => name && onPatch({ bgmTrack: name })
                });
              } else if (e.target.value === "__ai") setMusicOpen(true);
              else onPatch({ bgmTrack: e.target.value || null });
            }}
          >
            <option value="">Không nhạc nền</option>
            {project.bgmTrack && !bgmList.includes(project.bgmTrack) && <option value={project.bgmTrack}>{project.bgmTrack}{" (thiếu file)"}</option>}
            {bgmList.map((b) => <option key={b} value={b}>{b}</option>)}
            <option value="__import">+ Nhập file nhạc…</option>
            {musicProviders.length > 0 && <option value="__ai">✨ Sinh nhạc AI…</option>}
          </Select>
        </label>
      </div>
      <label className="flex items-center gap-space-sm text-label-sm text-on-surface-variant">
        <AudioLines size={14} />
        {" Âm lượng BGM (ducking)"}
        <input
          type="range"
          min={0}
          max={50}
          value={Math.round(project.bgmVolume * 100)}
          onChange={(e) => onPatch({ bgmVolume: Number(e.target.value) / 100 })}
          className="flex-1 accent-secondary"
          aria-label="Âm lượng nhạc nền"
        />
        <span className="w-9 text-right font-mono">{Math.round(project.bgmVolume * 100)}%</span>
      </label>
      <label className="flex flex-col gap-1 text-label-sm text-on-surface-variant">
        Âm thanh clip
        {project.narration && <Select
          aria-label="Âm thanh clip"
          value={project.clipAudio}
          onChange={(e) => onPatch({
            clipAudio: e.target.value
          })}
          title="Clip video AI / clip của bạn thường đã có âm thanh – chọn giữ làm nền hoặc dùng thay giọng đọc"
        >
          <option value="tts">Chỉ giọng đọc (bỏ tiếng clip)</option>
          <option value="mix">Giọng đọc + tiếng clip làm nền</option>
          <option value="clip">Dùng tiếng clip (AI tự lồng tiếng)</option>
        </Select>}
        {!project.narration && <span className="text-outline">Không lời thoại: luôn giữ tiếng clip (tiếng môi trường) + nhạc nền.</span>}
        {project.narration && project.clipAudio === "clip" && <span className="text-outline">
          Lời thoại được đưa vào prompt video AI (clip AI đã tạo trước đó sẽ được tạo lại – tính phí lại); cảnh không có clip / clip câm tự dùng giọng đọc. Phụ đề vẫn hiển thị theo lời thoại.
        </span>}
      </label>
      {project.clipAudio === "mix" && <label className="flex items-center gap-space-sm text-label-sm text-on-surface-variant">
        <AudioLines size={14} />
        {" Âm lượng tiếng clip"}
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(project.clipAudioVolume * 100)}
          onChange={(e) => onPatch({ clipAudioVolume: Number(e.target.value) / 100 })}
          className="flex-1 accent-secondary"
          aria-label="Âm lượng tiếng clip"
        />
        <span className="w-9 text-right font-mono">{Math.round(project.clipAudioVolume * 100)}%</span>
      </label>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-space-md gap-y-1 rounded-xl bg-surface-container-lowest p-space-sm font-mono text-code">
        <dt className="text-outline">Engine:</dt>
        <dd className="text-right text-on-surface">
          {"FFmpeg · "}
          {encoders ? encoderShort[encoders.chosen] : "dò khi render"}
        </dd>
        <dt className="text-outline">Output:</dt>
        <dd className="text-right text-secondary">
          {ASPECT_SIZE[project.aspect].w}
          ×
          {ASPECT_SIZE[project.aspect].h}
          {" · 30fps"}
        </dd>
        <dt className="text-outline">Ước tính:</dt>
        <dd className="text-right text-on-surface-variant">
          {total >= 90 ? `${Math.floor(total / 60)} phút ${Math.round(total % 60)}s` : `${total.toFixed(1)}s`}
          {" video"}
        </dd>
        <dt className="text-outline">Chi phí AI:</dt>
        <dd
          className={cn("text-right", estimate && estimate.totalUsd > 0 ? "text-warning" : "text-tertiary")}
          title={estimate ? [
            estimate.veoSeconds ? `Veo: ${estimate.veoSeconds}s ≈ $${estimate.veoUsd.toFixed(2)}` : "",
            estimate.images ? `Ảnh AI: ${estimate.images} ảnh ≈ $${estimate.imageUsd.toFixed(2)}` : "",
            estimate.ttsChars ? `Giọng đọc: ${estimate.ttsChars} ký tự ≈ $${estimate.ttsUsd.toFixed(2)}` : "",
            estimate.cachedScenes ? `${estimate.cachedScenes} cảnh đã có sẵn (không tính lại)` : "",
            ...estimate.warnings
          ].filter(Boolean).join("\n") : void 0}
        >
          {!estimate ? "…" : estimate.totalUsd > 0 ? `≈ $${estimate.totalUsd.toFixed(2)}` : "Miễn phí"}
          {estimate && estimate.warnings.length > 0 && " ⚠"}
        </dd>
      </dl>
    </div>
    <div className="flex flex-col gap-space-sm border-t border-overlay/[0.06] p-space-md">
      {latestJob && (active || hiddenLog !== latestJob.id) && <div className="flex select-text flex-col gap-1 rounded-xl bg-surface-container-lowest p-space-sm">
        <div className="flex items-center justify-between gap-space-sm text-label-sm">
          <span
            className={cn("truncate", latestJob.status === "failed" ? "text-error" : latestJob.status === "done" ? "text-tertiary" : "text-on-surface")}
          >
            {latestJob.status === "queued" ? "Đang chờ trong hàng đợi" : latestJob.status === "failed" ? "Render lỗi" : latestJob.status === "cancelled" ? "Đã hủy" : latestJob.stage ?? ""}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-on-surface-variant">
            {Math.round(latestJob.progress * 100)}
            %
            {(latestJob.error || latestJob.notes.length > 0) && <button
              type="button"
              aria-label="Copy log"
              title="Copy log"
              onClick={() => copyLog(latestJob)}
              className="rounded p-0.5 hover:bg-overlay/[0.08] hover:text-on-surface"
            >
              <Copy size={12} />
            </button>}
            {!active && <button
              type="button"
              aria-label="Ẩn log"
              title="Ẩn log"
              onClick={() => hideLog(latestJob.id)}
              className="rounded p-0.5 hover:bg-overlay/[0.08] hover:text-on-surface"
            >
              <X size={12} />
            </button>}
          </span>
        </div>
        {active && <Progress value={latestJob.progress * 100} />}
        {latestJob.error && <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] text-error">
          {latestJob.error}
        </p>}
        {latestJob.notes.map((n) => <p key={n} className="flex gap-1 text-[11px] text-warning">
          <TriangleAlert size={11} className="mt-0.5 shrink-0" />
          {" "}
          {n}
        </p>)}
        {done && <button
          type="button"
          onClick={() => showInFolder.mutate({ path: done.outputPath })}
          className="flex items-center gap-1 self-start text-label-sm text-primary hover:underline"
        >
          <FolderOpen size={12} />
          {" Mở thư mục chứa video"}
        </button>}
      </div>}
      {active ? <Button variant="danger" className="h-11" onClick={() => onCancelRender(latestJob.id)}>
        <Square size={14} />
        {" Hủy render"}
      </Button> : <Button
        variant="primary"
        className="h-11"
        disabled={renderPending || !scenes.length}
        onClick={onRender}
        title="Render 1080×1920 bằng FFmpeg (GPU nếu có)"
      >
        <Rocket size={16} />
        {" "}
        {done ? "Render lại" : "Bắt đầu Render Video"}
        {" "}
        <Kbd className="bg-black/20 text-on-primary">F9</Kbd>
      </Button>}
      <Button
        variant="subtle"
        onClick={onExportPrompts}
        disabled={!scenes.length}
        title="Soạn prompt từ kịch bản để tự dán vào Google Vids (prompt tổng) hoặc Google Flow / Veo (từng cảnh)"
      >
        <ClipboardList size={15} />
        {" Xuất prompt thủ công (Vids / Flow)"}
      </Button>
      <Button variant="subtle" onClick={onToContent} disabled={toContentPending || !scenes.length}>
        <CalendarPlus size={15} />
        {" "}
        {done ? "Mở trong Kho nội dung" : contentLinked ? "Cập nhật bản ghi trong Kho nội dung" : "Lưu vào Kho nội dung (bản nháp)"}
      </Button>
    </div>
    <MusicDialog
      open={musicOpen}
      onClose={() => setMusicOpen(false)}
      providers={musicProviders}
      topic={project.topic}
      durationSec={total}
      workspaceId={project.workspaceId}
      onCreated={(file) => onPatch({ bgmTrack: file })}
    />
  </Card>;
}
