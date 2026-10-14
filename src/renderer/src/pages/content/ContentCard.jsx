import { useState } from "react";
import {
  CalendarCheck,
  CalendarPlus,
  Gauge,
  PenLine,
  Pencil,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { StatusDot } from "../../components/ui/StatusDot";
import { mediaUrl } from "../../lib/media";
import { kindMeta, statusMeta, formatDuration } from "./VariantsPanel";
import { hookGrade } from "../../../../shared/hook";
import { videoOf, VideoPreviewDialog } from "./VideoPreviewDialog";

function HookBadge({ score, health, overlay }) {
  const g = hookGrade(score);
  return (
    <>
      <Badge
        tone={g.tone}
        mono={true}
        className={overlay ? "bg-black/65" : void 0}
        title={`Điểm Hook ${score}/100 – ${g.label}`}
      >
        <Gauge size={10} /> {score}
      </Badge>
      {health && health !== "ok" && (
        <Badge
          tone={health === "risk" ? "danger" : "warning"}
          className={overlay ? "bg-black/65" : void 0}
          title={`Kiểm tra trước đăng: ${health === "risk" ? "rủi ro cao" : "nên sửa"} – mở bài để xem`}
        >
          <ShieldAlert size={10} /> {health === "risk" ? "Rủi ro" : "Nên sửa"}
        </Badge>
      )}
    </>
  );
}

export function ContentCard({ item, workspaceName, selected, onToggle, onEdit, onSchedule, onDelete, layout }) {
  const kind = kindMeta[item.kind];
  const status = statusMeta[item.status];
  const duration = formatDuration(item.durationSec);
  const video = videoOf(item);
  const [playing, setPlaying] = useState(null);
  const preview = video && <VideoPreviewDialog item={item} file={playing} onClose={() => setPlaying(null)} />;
  const action =
    item.status === "ready" ? (
      <Button size="sm" variant="primary" onClick={onSchedule}>
        <CalendarPlus size={13} />
        {" Đưa vào lịch"}
      </Button>
    ) : item.status === "draft" ? (
      <Button size="sm" variant="subtle" onClick={onEdit}>
        <PenLine size={13} />
        {" Hoàn thiện bài"}
      </Button>
    ) : item.status === "scheduled" ? (
      <Button size="sm" variant="subtle" onClick={onSchedule}>
        <CalendarCheck size={13} />
        {" Xem lịch"}
      </Button>
    ) : item.status === "failed" ? (
      <Button size="sm" variant="danger" onClick={onSchedule}>
        <RotateCcw size={13} />
        {" Lên lịch lại"}
      </Button>
    ) : (
      <Badge tone="primary">Đã xuất bản</Badge>
    );
  const checkbox = (
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggle}
      aria-label={`Chọn ${item.title}`}
      className="h-4 w-4 cursor-pointer rounded accent-primary-container"
    />
  );
  if (layout === "list") {
    return (
      <li
        className={cn(
          "flex items-center gap-space-md rounded-xl bg-surface-container-low px-space-md py-space-sm",
          selected && "ring-1 ring-primary-container/60",
        )}
      >
        {checkbox}
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br",
            kind.gradient,
          )}
        >
          {item.thumbnailPath ? (
            <img src={mediaUrl(item.thumbnailPath)} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <kind.icon size={18} className="text-on-surface-variant" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-label-md text-on-surface">{item.title}</div>
          <div className="truncate text-label-sm text-on-surface-variant">
            {workspaceName ?? "Chưa phân Pocket"}
            {" · "}
            {kind.label}
            {item.aspect ? ` ${item.aspect}` : ""}
            {duration ? ` · ${duration}` : ""}
          </div>
        </div>
        {item.hookScore && <HookBadge score={item.hookScore.score} health={item.hookScore.health?.status} />}
        <Badge tone={status.tone} pill={true}>
          {status.label}
        </Badge>
        {action}
        {video && <IconButton icon={Play} label="Xem video" onClick={() => setPlaying(video)} />}
        <IconButton icon={Pencil} label="Chỉnh sửa" onClick={onEdit} />
        <IconButton icon={Trash} label="Xóa" onClick={onDelete} className="hover:text-error" />
        {preview}
      </li>
    );
  }
  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-surface-container-low",
        selected ? "border-primary-container/70" : "border-overlay/[0.06]",
      )}
    >
      <div
        className={cn(
          "relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br",
          kind.gradient,
        )}
      >
        {item.thumbnailPath ? (
          <img
            src={mediaUrl(item.thumbnailPath)}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <kind.icon size={40} className="text-on-surface-variant/40" strokeWidth={1.25} />
        )}
        {video && (
          <button
            type="button"
            onClick={() => setPlaying(video)}
            aria-label="Xem video"
            title="Xem video"
            className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition hover:scale-105 hover:bg-black/75"
          >
            <Play size={22} className="ml-0.5" fill="currentColor" />
          </button>
        )}
        <div className="absolute left-space-sm top-space-sm">{checkbox}</div>
        <div className="absolute right-space-sm top-space-sm flex gap-1">
          {duration && (
            <Badge className="bg-black/60 text-white">
              <Play size={10} /> {duration}
            </Badge>
          )}
          {item.aspect && (
            <Badge tone="secondary" className="bg-black/50">
              {item.aspect}
            </Badge>
          )}
          <Badge className="bg-black/60 text-white">{kind.label}</Badge>
        </div>
        <div className="absolute bottom-space-sm left-space-sm right-space-sm flex items-end justify-between gap-space-sm">
          <Badge tone={status.tone} pill={true} className="bg-black/60">
            <StatusDot health={item.status === "failed" ? "error" : item.status === "draft" ? "idle" : "ok"} />
            {status.label}
          </Badge>
          <span className="flex gap-1">
            {item.hookScore && (
              <HookBadge score={item.hookScore.score} health={item.hookScore.health?.status} overlay={true} />
            )}
            {item.spinVariants > 0 && (
              <Badge className="bg-black/60 text-white">
                <Sparkles size={10} /> {item.spinVariants}
                {" biến thể"}
              </Badge>
            )}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-space-sm p-space-md">
        <div className="truncate text-label-sm text-on-surface-variant">
          {workspaceName ?? "Chưa phân Pocket"}
          {" · "}
          {item.source === "studio"
            ? "Xưởng Video AI"
            : item.source === "film"
              ? "Xưởng Phim"
              : item.source === "import"
                ? "Nhập ngoài"
                : "Thủ công"}
          {item.aiReviewed && <span className="text-tertiary">{" · Đã duyệt AI"}</span>}
        </div>
        <h3 className="line-clamp-2 text-headline-sm text-on-surface" title={item.title}>
          {item.title}
        </h3>
        {item.caption && <p className="line-clamp-2 text-body-sm text-on-surface-variant">{item.caption}</p>}
        {item.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.hashtags.slice(0, 4).map((h) => (
              <Badge key={h} tone="secondary">
                {h}
              </Badge>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center gap-1 pt-space-sm">
          <div className="flex-1">{action}</div>
          {video && <IconButton icon={Play} label="Xem video" onClick={() => setPlaying(video)} />}
          <IconButton icon={Pencil} label="Chỉnh sửa" onClick={onEdit} />
          <IconButton icon={Trash} label="Xóa" onClick={onDelete} className="hover:text-error" />
        </div>
      </div>
      {preview}
    </article>
  );
}
