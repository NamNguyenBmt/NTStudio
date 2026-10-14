import { useRef } from "react";
import { CircleArrowUp, Film, ImageOff, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { mediaUrl } from "../../lib/media";
import { parseUpscale, upscaleLabel } from "../../../../shared/upscale";
import { TakeProgress } from "../studio/SceneProgressPanel";
import { CAST_LABEL } from "./cast";
import { canUpscale } from "./useFilmUpscale";
import { assetState } from "./AssetBoard";

export function Thumb({ s, video }) {
  const img = video ? s.poster : s.file;
  return img ? (
    <img src={mediaUrl(img)} alt="" className="h-full w-full object-cover" />
  ) : (
    <ImageOff size={14} className="m-auto mt-4 text-outline" />
  );
}

export function StatusBadge({ s, miss, video }) {
  if (s.pending)
    return (
      <Badge tone="secondary" title={s.running?.progress ?? void 0}>
        <LoaderCircle size={10} className="animate-spin" />{" "}
        {s.running?.progress ?? (s.running ? "Đang tạo" : "Đang chờ")}
        {s.pending > 1 ? ` (+${s.pending - 1})` : ""}
      </Badge>
    );
  if (s.failed)
    return (
      <Badge tone="danger" title={s.failed.error ?? void 0}>
        <TriangleAlert size={10} />
        {" Lỗi"}
      </Badge>
    );
  if (miss.length)
    return (
      <Badge
        tone="warning"
        title={video ? "Chọn khung hình ở bước Khung hình trước" : `Chưa có ảnh đã chọn: ${miss.join(", ")}`}
      >
        {video ? "Chưa có khung hình" : "Thiếu tham chiếu"}
      </Badge>
    );
  if (video && s.file)
    return (
      <Badge tone="success">
        <Film size={10} />
        {" Có video"}
      </Badge>
    );
  return null;
}

export function AssetCard({
  a,
  index,
  kind,
  mode,
  aspect,
  checked,
  missing,
  progress,
  origin,
  onCheck,
  onOpen,
  onUpscale,
}) {
  const s = assetState(a, mode);
  const video = mode === "video";
  const up = video ? parseUpscale(s.shown?.upscale) : null;
  const ref = useRef(null);
  const ratio =
    kind === "character" || aspect === "16:9" ? "aspect-video" : aspect === "1:1" ? "aspect-square" : "aspect-[9/16]";
  const still = video ? s.poster : s.file;
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-surface-container",
        checked ? "border-primary" : "border-overlay/[0.08]",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={() => void ref.current?.play().catch(() => void 0)}
        onMouseLeave={() => {
          if (ref.current) (ref.current.pause(), (ref.current.currentTime = 0));
        }}
        className={cn("relative w-full overflow-hidden bg-surface-container-lowest", ratio)}
      >
        {video && s.file ? (
          <video
            ref={ref}
            src={mediaUrl(s.file)}
            poster={still ? mediaUrl(still) : void 0}
            muted={true}
            loop={true}
            playsInline={true}
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : still ? (
          <img
            src={mediaUrl(still)}
            alt={a.name}
            className={cn(
              "h-full w-full object-cover transition-transform group-hover:scale-[1.02]",
              video && "opacity-60",
            )}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-outline">
            {s.pending ? <LoaderCircle size={20} className="animate-spin text-secondary" /> : <ImageOff size={20} />}
          </span>
        )}
        {s.active ? ( // Đang chờ / đang tạo: thanh tiến độ đè dưới ảnh
          <span className="absolute inset-x-0 bottom-0 text-left">
            <TakeProgress
              take={s.active}
              expectedSec={progress.expected}
              position={progress.positions.get(s.active.id)}
              now={progress.now}
              more={s.pending - 1}
            />
          </span>
        ) : (
          <span className="absolute bottom-1 right-1 max-w-[95%]">
            <StatusBadge s={s} miss={missing} video={video} />
          </span>
        )}
      </button>
      <input
        type="checkbox"
        className="absolute left-2 top-2 h-4 w-4 accent-secondary"
        checked={checked}
        onChange={onCheck}
        aria-label={`Chọn ${a.name}`}
      />
      {origin && ( // Nằm trên ảnh → nền đặc để đọc được trên mọi màu ảnh
        <span
          title={CAST_LABEL[origin].title}
          className={cn(
            "absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold shadow",
            origin === "series"
              ? "bg-primary text-on-primary"
              : origin === "pending"
                ? "bg-warning text-black"
                : "bg-secondary text-black",
          )}
        >
          {CAST_LABEL[origin].label}
        </span>
      )}
      <button type="button" onClick={onOpen} className="flex flex-col p-space-sm text-left">
        <span className="truncate text-label-md text-on-surface">
          {kind === "shot" ? `${index + 1}. ${a.summary || a.name}` : a.name}
        </span>
        <span className="truncate text-label-sm text-on-surface-variant">
          {kind === "shot" ? `${a.camera || "—"} · ${a.durationSec}s` : a.summary || a.description || "Chưa có mô tả"}
          {s.done > 1 ? ` · ${s.done} bản` : ""}
        </span>
      </button>
      {video && s.shown && (
        <div className="-mt-1 flex items-center gap-1 px-space-sm pb-space-sm">
          {up && (
            <Badge
              tone="primary"
              title={up.method === "flow" ? "Đã nâng cấp bằng Google Flow (AI)" : "Đã nâng cấp trên máy (FFmpeg)"}
            >
              <CircleArrowUp size={10} /> {upscaleLabel(up.quality)}
            </Badge>
          )}
          {canUpscale(s.shown) && (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={() => onUpscale(s.shown)}
              title="Nâng cấp chất lượng video (1080p / 4K)"
            >
              <CircleArrowUp size={12} />
              {" Nâng cấp"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
