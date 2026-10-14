import { Plus, RotateCcw, TrendingDown, Unplug, Zap } from "lucide-react";
import { cn } from "../../lib/cn";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import "../content/ContentEditor";
import { WEEKDAYS, dayKey, startOfDay, hhmm } from "./dates";

const platformChip = {
  facebook: "bg-brand-facebook text-white",
  tiktok: "bg-black text-white ring-1 ring-brand-tiktok-cyan/60",
  instagram: "bg-brand-instagram text-white",
  youtube: "bg-brand-youtube text-white"
};

const platformShort = { facebook: "FB", tiktok: "TT", instagram: "IG", youtube: "YT" };
const statusDot = { queued: "bg-warning", publishing: "bg-secondary", published: "bg-success", failed: "bg-danger", cancelled: "bg-outline" };

function PostChip({ post, onOpen, stacked }) {
  const movable = post.status === "queued" || post.status === "failed";
  const unconnected = post.status === "queued" && (post.tokenStatus === "missing" || post.tokenStatus === "expired");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `post:${post.id}`, disabled: !movable, data: { post } });
  const lowReach = post.earlyFlag === "low" || post.earlyFlag === "zero";
  return <button
    ref={setNodeRef}
    type="button"
    onClick={onOpen}
    {...movable ? { ...attributes, ...listeners } : {}}
    title={`${hhmm(post.scheduledAt)} · ${post.channelName}
${post.contentTitle}${post.error ? `
Lỗi: ${post.error}` : ""}${unconnected ? "\nKênh chưa kết nối API / token hết hạn – bài sẽ lỗi khi tới giờ" : ""}${lowReach ? `
Phân phối kém sau 2 giờ: ${post.earlyMetric}${post.earlyBaseline != null ? ` (kênh thường ~${post.earlyBaseline})` : ""}` : ""}`}
    className={cn(
      "flex w-full gap-1 rounded bg-surface-container-high px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-surface-bright",
      stacked ? "flex-wrap items-center py-1" : "items-center",
      post.status === "failed" && "bg-danger/15 ring-1 ring-danger/40",
      post.status === "published" && "opacity-75",
      movable && "cursor-grab active:cursor-grabbing",
      isDragging && "opacity-30"
    )}
  >
    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot[post.status])} />
    <span className={cn("shrink-0 rounded-sm px-1 text-[9px] font-bold", platformChip[post.platform])}>
      {platformShort[post.platform]}
    </span>
    <span className="shrink-0 font-mono text-on-surface-variant">{hhmm(post.scheduledAt)}</span>
    {post.isGoldenHour && <Zap size={10} className="shrink-0 text-warning" aria-label="Giờ vàng" />}
    <span className={cn("min-w-0 text-on-surface", stacked ? "order-last line-clamp-2 basis-full" : "flex-1 truncate")}>
      {post.contentTitle}
    </span>
    {post.status === "failed" && <RotateCcw size={10} className="ml-auto shrink-0 text-error" />}
    {unconnected && <Unplug size={10} className="ml-auto shrink-0 text-warning" aria-label="Kênh chưa kết nối API" />}
    {lowReach && <TrendingDown size={10} className="ml-auto shrink-0 text-warning" aria-label="Phân phối kém" />}
  </button>;
}

function DayCell({
  day,
  posts,
  inMonth,
  tall,
  onOpenPost,
  onAdd
}) {
  const key = dayKey(day);
  const isPast = day < startOfDay(new Date());
  const isToday = key === dayKey(new Date());
  const { setNodeRef, isOver } = useDroppable({ id: `day:${key}`, disabled: isPast, data: { day } });
  const published = posts.filter((p) => p.status === "published").length;
  const failed = posts.filter((p) => p.status === "failed").length;
  const max = tall ? 12 : 3;
  return <div
    ref={setNodeRef}
    className={cn(
      "group relative flex flex-col gap-1 rounded-lg border p-1.5 transition-colors",
      tall ? "min-h-[420px]" : "min-h-[112px]",
      inMonth ? "bg-surface-container-low" : "bg-surface-container-lowest/50",
      isToday ? "border-primary-container/70" : "border-overlay/[0.04]",
      isOver && "border-secondary bg-secondary/10",
      isPast && "opacity-70"
    )}
  >
    <div className="flex items-center justify-between">
      <span title={isToday ? "Hôm nay" : void 0} className={cn("font-mono text-code", isToday ? "rounded bg-primary-container px-1 text-on-primary" : inMonth ? "text-on-surface" : "text-outline")}>
        {day.getDate()}
      </span>
      <span className="flex items-center gap-1">
        {failed > 0 && <span className="font-mono text-[10px] text-error">{failed}{" lỗi"}</span>}
        {published > 0 && <span className="font-mono text-[10px] text-tertiary">{published}{" đã đăng"}</span>}
        {posts.length > 0 && failed + published === 0 && <span className="font-mono text-[10px] text-on-surface-variant">{posts.length}{" bài"}</span>}
        {!isPast && <button
          type="button"
          aria-label={`Thêm bài ngày ${day.getDate()}`}
          onClick={() => onAdd(day)}
          className="rounded p-0.5 text-on-surface-variant opacity-0 transition-opacity hover:bg-white/10 hover:text-on-surface focus:opacity-100 group-hover:opacity-100"
        >
          <Plus size={12} />
        </button>}
      </span>
    </div>
    <div className="flex flex-col gap-0.5">
      {posts.slice(0, max).map((p) => <PostChip key={p.id} post={p} onOpen={() => onOpenPost(p)} stacked={tall} />)}
      {posts.length > max && <span className="px-1 text-[10px] text-outline">+{posts.length - max}{" bài khác"}</span>}
    </div>
    {isOver && <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded bg-secondary/20 py-0.5 text-center text-[10px] text-secondary">
      Thả để lên lịch ngày này
    </span>}
  </div>;
}

export function CalendarGrid({
  days,
  anchorMonth,
  posts,
  tall,
  onOpenPost,
  onAdd
}) {
  const byDay = new Map();
  for (const p of posts) {
    const k = dayKey(p.scheduledAt);
    byDay.set(k, [...byDay.get(k) ?? [], p]);
  }
  return <div className="flex flex-col gap-1">
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS.map((w, i) => <div key={w} className={cn("py-1 text-center text-label-md", i >= 5 ? "text-secondary" : "text-on-surface-variant")}>
        {w}
      </div>)}
    </div>
    <div className="grid grid-cols-7 gap-1">
      {days.map((d) => <DayCell key={dayKey(d)} day={d} posts={byDay.get(dayKey(d)) ?? []} inMonth={d.getMonth() === anchorMonth} tall={tall} onOpenPost={onOpenPost} onAdd={onAdd} />)}
    </div>
  </div>;
}
