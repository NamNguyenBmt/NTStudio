import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call, useApiQuery, useApiMutation } from "../../lib/api";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BookOpenText,
  Clapperboard,
  Copy,
  Film,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash,
  Upload,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { confirmDialog } from "../../components/ui/confirm";
import { Select } from "../../components/ui/Input";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { mediaUrl } from "../../lib/media";
import { durationLabel } from "../../../../shared/video";
import { unitCost } from "../../../../shared/pricing";
import { useCharacterBatch } from "./useCharacterBatch";
import { characterPrompt, INV, statusMeta } from "./meta";
import { ProductionBadge } from "./ProductionMode";
import { SeriesDialog } from "./SeriesDialog";
import { CharacterDialog } from "./CharacterDialog";
import { EpisodeDialog } from "./EpisodeDialog";
import { queuedPosition, CharJobOverlay } from "./CharJobOverlay";
import { EpisodeFilmActions } from "./EpisodeFilmActions";

export function SeriesPage() {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s2) => s2.activeWorkspaceId);
  const { data: list = [] } = useApiQuery("series.list", { workspaceId });
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState(() => params.get("id"));
  const { data: s } = useApiQuery(
    "series.get",
    { id: selectedId ?? "" },
    {
      enabled: !!selectedId,
      refetchInterval: (q) => (q.state.data?.episodes.some((e) => e.projectStatus === "rendering") ? 4e3 : false),
    },
  );
  const startRender = useApiMutation("render.start", ["render.", "media.", "series."]);
  const renderEpisode = async (e) => {
    if (!e.projectId || !s) return;
    if (s.renderMode === "full_ai") {
      const ok = await confirmDialog({
        title: "Render bằng Google Veo",
        message: `Series đang ở chế độ Video AI (Veo) – tính phí theo giây video: tập này khoảng ${durationLabel(s.episodeLengthSec)}, tức từ ≈ $${(s.episodeLengthSec * 0.05).toFixed(2)} (Veo Lite) tới $${(s.episodeLengthSec * 0.4).toFixed(2)} (Veo bản thường) theo key Gemini của bạn. Cảnh đã tạo trước đó không tính lại. Tiếp tục?`,
        confirmLabel: "Render",
      });
      if (!ok) return;
    }
    startRender.mutate(
      { projectId: e.projectId },
      {
        onSuccess: () =>
          toast.info(`Đã đưa tập ${e.number} vào hàng đợi render – theo dõi ở thanh trạng thái phía dưới`),
        onError: (err) => toast.error(err.message),
      },
    );
  };
  const { data: voices = [] } = useApiQuery(
    "media.voices",
    { provider: s?.ttsProvider ?? "edge_tts" },
    { staleTime: 10 * 6e4, retry: 0 },
  );
  const [seriesDialog, setSeriesDialog] = useState(null);
  const [charTarget, setCharTarget] = useState(null);
  const [epTarget, setEpTarget] = useState(null);
  const [developCount, setDevelopCount] = useState(5);
  const develop = useApiMutation("series.develop", INV);
  const write = useApiMutation("series.writeEpisode", INV);
  const setImage = useApiMutation("series.setCharacterImage", INV);
  const [copyingId, setCopyingId] = useState(null);
  const qc = useQueryClient();
  const copyPrompt = async (c) => {
    if (!s) return;
    setCopyingId(c.id);
    let text = characterPrompt(c, s);
    let fallback = false;
    try {
      text = (await call("series.characterPrompt", { id: c.id })).imagePrompt ?? text;
      void qc.invalidateQueries({ queryKey: ["series.get"] });
    } catch (e) {
      fallback = true;
      toast.error(`Không tạo được prompt chuẩn: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCopyingId(null);
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        fallback
          ? `Đã chép prompt cơ bản của ${c.name} (mô tả chưa được chuyển sang tiếng Anh)`
          : `Đã chép prompt của ${c.name} – dán vào Gemini / ChatGPT để tạo ảnh, tải ảnh về rồi bấm "Tải lên"`,
      );
    } catch {
      toast.error("Không chép được vào clipboard");
    }
  };
  const uploadImage = async (characterId) => {
    const path = await call("system.pickImage");
    if (!path) return;
    setImage.mutate(
      { id: characterId, sourcePath: path },
      { onSuccess: () => toast.success("Đã cập nhật ảnh nhân vật"), onError: (e) => toast.error(e.message) },
    );
  };
  const update = useApiMutation("series.update", INV);
  const remove = useApiMutation("series.delete", INV);
  const delChar = useApiMutation("series.deleteCharacter", INV);
  const delEp = useApiMutation("series.deleteEpisode", INV);
  const [writingId, setWritingId] = useState(null);
  const batch = useCharacterBatch();
  const { data: filmQueue } = useApiQuery("film.queue", {});
  const { data: providers = [] } = useApiQuery("ai.providers");
  const [pickedChars, setPickedChars] = useState(new Set());
  const [zoomChar, setZoomChar] = useState(null);
  const imageModel = providers.find((p) => p.provider === "google_image")?.defaultModel ?? "gemini-3.1-flash-image";
  const runCharacterImages = async (ids) => {
    if (!s || !ids.length) return;
    const names = Object.fromEntries(s.characters.map((c) => [c.id, c.name]));
    const conc = filmQueue?.imageConcurrency ?? 4;
    if (
      ids.length > 1 &&
      !(await confirmDialog({
        title: `Tạo ${s.productionMode === "film" ? "bảng nhân vật" : "ảnh"} cho ${ids.length} nhân vật`,
        message: `Chạy song song ${Math.min(conc, ids.length)} luồng (đổi số luồng ở Xưởng Phim).
Chi phí ước tính: ≈ $${unitCost(imageModel, ids.length).toFixed(2)} (${imageModel}, tính vào key của bạn).
Ảnh mới thay ảnh hiện tại của nhân vật.`,
        confirmLabel: "Tạo",
      }))
    )
      return;
    batch.start(ids, conc, names);
    setPickedChars(new Set());
  };
  useEffect(() => {
    if (!list.some((x) => x.id === selectedId)) setSelectedId(list[0]?.id ?? null);
  }, [list, selectedId]);
  const voiceLabel = (id) => (id ? (voices.find((v) => v.id === id)?.label ?? id) : "Giọng người dẫn");
  return (
    <div className="grid grid-cols-1 gap-space-md xl:grid-cols-[280px_1fr]">
      <Card className="flex flex-col gap-space-sm p-space-md">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
            <BookOpenText size={18} className="text-secondary" />
            {" Series AI"}
          </h1>
          <Button size="sm" variant="primary" onClick={() => setSeriesDialog("new")}>
            <Plus size={13} />
            {" Tạo"}
          </Button>
        </div>
        {list.length === 0 && (
          <p className="rounded-lg bg-surface-container-lowest p-space-sm text-body-sm text-on-surface-variant">
            Chưa có series. Tạo series để AI dựng nhân vật cố định và viết kịch bản từng tập phim ngắn.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {list.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setSelectedId(x.id)}
                className={cn(
                  "w-full rounded-lg px-space-sm py-2 text-left",
                  x.id === selectedId ? "bg-surface-container-high" : "hover:bg-surface-container",
                )}
              >
                <div className="truncate text-label-md text-on-surface">{x.title}</div>
                <div className="text-label-sm text-on-surface-variant">
                  {x.productionMode === "film" ? "🎞 Phim · " : "🎬 Video · "}
                  {x.genre ? `${x.genre} · ` : ""}
                  {x.episodeCount}
                  {" tập · "}
                  {x.characterCount}
                  {" nhân vật"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {!s ? (
        <Card className="flex min-h-[300px] items-center justify-center p-space-xl text-body-sm text-on-surface-variant">
          Chọn hoặc tạo một series
        </Card>
      ) : (
        <div className="flex min-w-0 flex-col gap-space-md">
          <Card className="flex flex-col gap-space-md p-space-md">
            <div className="flex flex-wrap items-start justify-between gap-space-md">
              <div className="min-w-0">
                <h2 className="text-headline-md text-on-surface">{s.title}</h2>
                <p className="text-body-sm text-on-surface-variant">{s.logline || "Chưa có tóm tắt"}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <ProductionBadge mode={s.productionMode} />
                  {s.genre && <Badge>{s.genre}</Badge>}
                  <Badge mono={true}>{durationLabel(s.episodeLengthSec)}/tập</Badge>
                  {s.visualStyle && <Badge tone="secondary">{s.visualStyle.slice(0, 40)}</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="subtle" onClick={() => setSeriesDialog("edit")}>
                  <Pencil size={13} />
                  {" Sửa"}
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() =>
                    void confirmDialog({
                      title: "Xóa series",
                      message: `Xóa "${s.title}" cùng nhân vật và dàn ý tập? Dự án video đã tạo vẫn giữ trong Xưởng video.`,
                      confirmLabel: "Xóa",
                      danger: true,
                    }).then((ok) => ok && remove.mutate({ id: s.id }, { onSuccess: () => setSelectedId(null) }))
                  }
                >
                  <Trash size={13} />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-space-sm rounded-lg bg-surface-container-lowest p-space-sm">
              {s.productionMode === "video" ? (
                <>
                  <span className="text-body-sm text-on-surface-variant">Giọng người dẫn:</span>
                  <div className="w-56">
                    <Select
                      aria-label="Giọng người dẫn"
                      value={s.narratorVoiceId ?? ""}
                      onChange={(e) => update.mutate({ id: s.id, patch: { narratorVoiceId: e.target.value || null } })}
                    >
                      <option value="">Mặc định</option>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </>
              ) : (
                <span className="text-body-sm text-on-surface-variant">
                  Mỗi tập là một phim trong Xưởng Phim – nhân vật dùng bảng nhân vật chuẩn của series.
                </span>
              )}
              <span className="ml-auto flex items-center gap-space-sm">
                <Select
                  aria-label="Số tập"
                  title="Trên 10 tập: AI lập mạch cả mùa rồi viết từng đợt 10 tập (mất vài phút)"
                  value={developCount}
                  onChange={(e) => setDevelopCount(Number(e.target.value))}
                  className="w-28"
                >
                  {[3, 5, 10, 15, 20, 25, 30].map((n) => (
                    <option key={n} value={n}>
                      {n}
                      {" tập"}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="primary"
                  disabled={develop.isPending}
                  onClick={() =>
                    develop.mutate(
                      { id: s.id, episodes: developCount },
                      {
                        onSuccess: (r) =>
                          r.episodes < developCount
                            ? toast.error(
                                `AI chỉ viết được ${r.episodes}/${developCount} tập (một đợt bị lỗi) – bấm "AI viết thêm tập" để viết tiếp`,
                              )
                            : toast.success(`AI đã thêm ${r.characters} nhân vật và ${r.episodes} tập dàn ý`),
                        onError: (e) => toast.error(e.message),
                      },
                    )
                  }
                >
                  {develop.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}{" "}
                  {develop.isPending
                    ? developCount > 10
                      ? `AI đang viết ${developCount} tập (theo đợt)…`
                      : "AI đang viết…"
                    : s.episodes.length
                      ? "AI viết thêm tập"
                      : "AI phát triển series"}
                </Button>
              </span>
            </div>
          </Card>
          <Card className="flex flex-col gap-space-md p-space-md">
            <div className="flex flex-wrap items-center gap-space-sm">
              <h3 className="text-label-md uppercase tracking-wider text-on-surface-variant">
                Nhân vật ({s.characters.length})
              </h3>
              {s.characters.length > 0 && (
                <>
                  <button
                    type="button"
                    className="text-label-sm text-primary hover:underline"
                    onClick={() =>
                      setPickedChars(
                        pickedChars.size === s.characters.length ? new Set() : new Set(s.characters.map((c) => c.id)),
                      )
                    }
                  >
                    {pickedChars.size === s.characters.length ? "Bỏ chọn" : "Chọn tất cả"}
                  </button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!pickedChars.size}
                    onClick={() => void runCharacterImages([...pickedChars])}
                  >
                    <ImagePlus size={12} />
                    {" Tạo "}
                    {s.productionMode === "film" ? "bảng nhân vật" : "ảnh"}
                    {" cho "}
                    {pickedChars.size}
                    {" đã chọn"}
                  </Button>
                  {s.characters.some((c) => !c.referenceImage) && (
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() =>
                        void runCharacterImages(s.characters.filter((c) => !c.referenceImage).map((c) => c.id))
                      }
                    >
                      <Sparkles size={12} />
                      {" Tạo cho "}
                      {s.characters.filter((c) => !c.referenceImage).length}
                      {" nhân vật chưa có ảnh"}
                    </Button>
                  )}
                  {batch.busy && (
                    <span className="flex items-center gap-1 text-label-sm text-on-surface-variant">
                      <LoaderCircle size={12} className="animate-spin text-secondary" />{" "}
                      {Object.values(batch.jobs).filter((j) => j.status === "running").length}
                      {" đang tạo ·"} {Object.values(batch.jobs).filter((j) => j.status === "queued").length}
                      {" chờ · "}
                      {filmQueue?.imageConcurrency ?? 4}
                      {" luồng"}
                    </span>
                  )}
                </>
              )}
              <Button size="sm" variant="subtle" className="ml-auto" onClick={() => setCharTarget("new")}>
                <Plus size={13} />
                {" Thêm nhân vật"}
              </Button>
            </div>
            {s.characters.length === 0 && (
              <p className="text-body-sm text-outline">
                Bấm "AI phát triển series" để AI tạo dàn nhân vật, hoặc thêm thủ công.
              </p>
            )}
            <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 2xl:grid-cols-3">
              {s.characters.map((c) => (
                <div key={c.id} className="flex gap-space-md rounded-xl bg-surface-container-lowest p-space-sm">
                  <div
                    className={cn(
                      "group relative flex h-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container",
                      // Bảng nhân vật là ảnh ngang (nhiều góc mặt) → khung rộng hơn
                      s.productionMode === "film" ? "w-40" : "w-20",
                    )}
                  >
                    {c.referenceImage ? (
                      <button
                        type="button"
                        className="h-full w-full cursor-zoom-in"
                        title="Xem ảnh lớn"
                        onClick={() => setZoomChar(c)}
                      >
                        <img src={mediaUrl(c.referenceImage)} alt={c.name} className="h-full w-full object-cover" />
                      </button>
                    ) : (
                      <UserRound size={28} className="text-outline" />
                    )}
                    <input
                      type="checkbox"
                      className="absolute left-1 top-1 h-4 w-4 accent-secondary"
                      checked={pickedChars.has(c.id)}
                      onChange={() =>
                        setPickedChars((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                      aria-label={`Chọn ${c.name}`}
                    />
                    {batch.jobs[c.id] && (
                      <CharJobOverlay job={batch.jobs[c.id]} position={queuedPosition(batch.jobs, c.id)} />
                    )}
                    {c.referenceImage && (
                      <button
                        type="button"
                        aria-label="Xem ảnh lớn"
                        title="Xem ảnh lớn"
                        onClick={() => setZoomChar(c)}
                        className="absolute bottom-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-80 hover:opacity-100"
                      >
                        <Maximize2 size={12} />
                      </button>
                    )}
                    {c.referenceImage && (
                      <button
                        type="button"
                        aria-label="Gỡ ảnh nhân vật"
                        title="Gỡ ảnh"
                        onClick={() => setImage.mutate({ id: c.id, sourcePath: null })}
                        className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-label-md text-on-surface">{c.name}</span>
                      {c.role && <Badge>{c.role}</Badge>}
                    </div>
                    <p className="line-clamp-2 text-label-sm text-on-surface-variant" title={c.appearance}>
                      {c.appearance || "Chưa mô tả ngoại hình"}
                    </p>
                    {c.arc && (
                      <p className="line-clamp-2 text-label-sm text-secondary" title={c.arc}>
                        {"↗ "}
                        {c.arc}
                      </p>
                    )}
                    {s.productionMode === "video" && (
                      <span className="text-label-sm text-outline">
                        {"🎙 "}
                        {voiceLabel(c.voiceId)}
                      </span>
                    )}
                    <div className="mt-auto flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={batch.jobs[c.id]?.status === "running" || batch.jobs[c.id]?.status === "queued"}
                        title={
                          s.productionMode === "film"
                            ? "Tạo bảng nhân vật (toàn thân + mặt chính diện, 3/4, nghiêng) – ảnh chuẩn dùng cho mọi tập trong Xưởng Phim"
                            : "Tạo ảnh tham chiếu bằng ảnh AI Gemini (dùng key Gemini, cần bật billing) hoặc Fal – tính phí theo key của bạn"
                        }
                        onClick={() => void runCharacterImages([c.id])}
                      >
                        {batch.jobs[c.id]?.status === "running" ? (
                          <LoaderCircle size={12} className="animate-spin" />
                        ) : (
                          <ImagePlus size={12} />
                        )}{" "}
                        {s.productionMode === "film" ? "Bảng nhân vật AI" : "Ảnh AI"}
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={setImage.isPending}
                        title="Tải ảnh nhân vật từ máy (PNG, JPG, WEBP)"
                        onClick={() => void uploadImage(c.id)}
                      >
                        <Upload size={12} />
                        {" Tải lên"}
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={copyingId === c.id}
                        title="Chép prompt tạo ảnh chuẩn (tiếng Anh, AI viết từ mô tả) – dán vào Gemini, ChatGPT… để tạo ảnh, rồi bấm Tải lên"
                        onClick={() => void copyPrompt(c)}
                      >
                        {copyingId === c.id ? <LoaderCircle size={12} className="animate-spin" /> : <Copy size={12} />}
                        {" Chép prompt"}
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        aria-label={`Sửa nhân vật ${c.name}`}
                        title="Sửa nhân vật"
                        onClick={() => setCharTarget(c)}
                      >
                        <Pencil size={12} />
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        aria-label={`Xóa nhân vật ${c.name}`}
                        title="Xóa nhân vật"
                        onClick={() => delChar.mutate({ id: c.id })}
                      >
                        <Trash size={12} />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="flex flex-col gap-space-sm p-space-md">
            <div className="flex items-center justify-between">
              <h3 className="text-label-md uppercase tracking-wider text-on-surface-variant">
                Các tập ({s.episodes.length})
              </h3>
              <Button size="sm" variant="subtle" onClick={() => setEpTarget("new")}>
                <Plus size={13} />
                {" Thêm tập"}
              </Button>
            </div>
            {s.episodes.length === 0 && <p className="text-body-sm text-outline">Chưa có tập nào.</p>}
            <ul className="flex flex-col gap-space-sm">
              {s.episodes.map((e) => {
                const st = statusMeta[e.status];
                return (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-start gap-space-md rounded-xl bg-surface-container-lowest p-space-sm"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container font-mono text-label-md text-on-surface">
                      {e.number}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-space-sm">
                        <span className="text-label-md text-on-surface">{e.title}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                      <p className="line-clamp-2 text-body-sm text-on-surface-variant">{e.synopsis}</p>
                      {e.cliffhanger && (
                        <p className="text-label-sm text-outline">
                          {"Kết treo: "}
                          {e.cliffhanger}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1">
                      {s.productionMode === "film" ? (
                        <EpisodeFilmActions episode={e} onOpen={(fid) => navigate(`/film/${fid}`)} />
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant={e.projectId ? "subtle" : "primary"}
                            disabled={write.isPending}
                            onClick={() => {
                              setWritingId(e.id);
                              write.mutate(
                                { id: e.id },
                                {
                                  onSuccess: (r) =>
                                    toast.success(
                                      `Đã viết ${r.scenes} cảnh cho tập ${e.number} – mở Xưởng video để dựng & render`,
                                    ),
                                  onError: (err) => toast.error(err.message),
                                  onSettled: () => setWritingId(null),
                                },
                              );
                            }}
                          >
                            {writingId === e.id ? (
                              <LoaderCircle size={12} className="animate-spin" />
                            ) : (
                              <WandSparkles size={12} />
                            )}{" "}
                            {e.projectId ? "Viết lại" : "Viết kịch bản"}
                          </Button>
                          {e.projectId && (
                            <>
                              {e.projectStatus === "rendering" ? (
                                <Badge tone="secondary">
                                  <LoaderCircle size={11} className="animate-spin" />
                                  {" Đang render"}
                                </Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  disabled={startRender.isPending}
                                  title="Dựng video tập này (giọng đọc, hình ảnh, phụ đề)"
                                  onClick={() => void renderEpisode(e)}
                                >
                                  <Play size={12} /> {e.projectStatus === "rendered" ? "Render lại" : "Render"}
                                </Button>
                              )}
                              {e.projectStatus === "rendered" && (
                                <Button
                                  size="sm"
                                  variant="subtle"
                                  title="Video đã render nằm trong Kho nội dung"
                                  onClick={() => navigate("/content")}
                                >
                                  <Film size={12} />
                                  {" Xem video"}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="subtle"
                                onClick={() => navigate(`/studio?project=${e.projectId}`)}
                              >
                                <Clapperboard size={12} />
                                {" Mở trong Xưởng video"}
                              </Button>
                            </>
                          )}
                        </>
                      )}
                      <Button size="sm" variant="subtle" onClick={() => setEpTarget(e)}>
                        <Pencil size={12} />
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() =>
                          void confirmDialog({
                            title: "Xóa tập",
                            message: `Xóa tập ${e.number} "${e.title}"? Dự án video đã tạo vẫn giữ.`,
                            confirmLabel: "Xóa",
                            danger: true,
                          }).then((ok) => ok && delEp.mutate({ id: e.id }))
                        }
                      >
                        <Trash size={12} />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <CharacterDialog
            seriesId={s.id}
            target={charTarget}
            voices={voices}
            film={s.productionMode === "film"}
            workspaceId={s.workspaceId}
            onClose={() => setCharTarget(null)}
          />
          <EpisodeDialog seriesId={s.id} target={epTarget} onClose={() => setEpTarget(null)} />
          <Dialog
            open={!!zoomChar?.referenceImage}
            onClose={() => setZoomChar(null)}
            width={1100}
            title={zoomChar ? `Ảnh nhân vật: ${zoomChar.name}` : ""}
            description={zoomChar?.appearance || void 0}
          >
            {zoomChar?.referenceImage && (
              <img
                src={mediaUrl(zoomChar.referenceImage)}
                alt={zoomChar.name}
                className="max-h-[72vh] w-full rounded-lg object-contain"
              />
            )}
          </Dialog>
        </div>
      )}
      <SeriesDialog
        open={seriesDialog != null}
        initial={seriesDialog === "edit" ? (s ?? null) : null}
        onClose={() => setSeriesDialog(null)}
        onSaved={setSelectedId}
      />
    </div>
  );
}
