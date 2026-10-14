import { ClipboardList, GripVertical, Lightbulb, LoaderCircle, Send, WandSparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useDraggable } from "@dnd-kit/core";
import { kindMeta, formatDuration } from "../content/VariantsPanel";

function QueueCard({ item, workspaceName, checked, highlight, onToggle }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `content:${item.id}`, data: { content: item } });
  const kind = kindMeta[item.kind];
  return <li
    ref={setNodeRef}
    className={cn("flex flex-col gap-1 rounded-xl border bg-surface-container p-space-sm", highlight ? "border-secondary/70" : "border-transparent", isDragging && "opacity-40")}
  >
    <div className="flex items-center gap-space-sm">
      <button type="button" aria-label="Kéo vào lịch" className="cursor-grab touch-none text-on-surface-variant active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVertical size={14} />
      </button>
      <Badge tone="secondary" mono={true}>{kind.label}{item.aspect ? ` ${item.aspect}` : ""}</Badge>
      {formatDuration(item.durationSec) && <span className="font-mono text-[10px] text-outline">{formatDuration(item.durationSec)}</span>}
      {item.spinVariants > 0 && <Badge mono={true}>{"Spin "}{item.spinVariants}</Badge>}
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Chọn ${item.title}`} className="ml-auto h-4 w-4 accent-primary-container" />
    </div>
    <p className="line-clamp-2 text-label-md text-on-surface">{item.title}</p>
    <p className="truncate text-label-sm text-on-surface-variant">
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-secondary" />
      {workspaceName ?? "Chưa phân Pocket"}
      {item.aiReviewed && <span className="text-tertiary">{" · Đã duyệt AI"}</span>}
    </p>
  </li>;
}

export function QueueSidebar({
  items,
  workspaceNames,
  selected,
  highlighted,
  onToggle,
  onToggleAll,
  onAutoSchedule,
  autoPending,
  onSpin,
  spinPending
}) {
  const all = items.length > 0 && items.every((i) => selected.has(i.id));
  return <Card className="flex min-h-0 flex-col">
    <div className="flex items-center justify-between gap-space-sm border-b border-overlay/[0.06] p-space-md">
      <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
        <ClipboardList size={18} className="text-secondary" />
        {" Hàng chờ chưa lên lịch"}
      </h2>
      <Badge tone="primary" mono={true}>{items.length}{" bài"}</Badge>
    </div>
    <p className="mx-space-md mt-space-sm flex gap-1 rounded-lg bg-surface-container-lowest p-space-sm text-body-sm text-on-surface-variant">
      <Lightbulb size={14} className="mt-0.5 shrink-0 text-warning" />
      Kéo thẻ bài viết vào bất kỳ ô ngày nào trên lịch để lên lịch đăng.
    </p>
    <ul className="scroll-thin flex min-h-0 flex-1 flex-col gap-space-sm overflow-y-auto p-space-md">
      {items.length === 0 && <li className="p-space-md text-center text-body-sm text-on-surface-variant">
        Không có nội dung "Sẵn sàng đăng". Đánh dấu sẵn sàng ở Kho nội dung.
      </li>}
      {items.map((i) => <QueueCard key={i.id} item={i} workspaceName={i.workspaceId ? workspaceNames.get(i.workspaceId) ?? null : null} checked={selected.has(i.id)} highlight={highlighted.has(i.id)} onToggle={() => onToggle(i.id)} />)}
    </ul>
    <div className="flex flex-col gap-space-sm border-t border-overlay/[0.06] p-space-md">
      <label className="flex items-center gap-space-sm text-body-sm text-on-surface">
        <input type="checkbox" checked={all} onChange={onToggleAll} disabled={!items.length} className="h-4 w-4 accent-primary-container" />
        Tích chọn tất cả hàng chờ (
        {selected.size}
        /
        {items.length}
        {" đã chọn)"}
      </label>
      <Button disabled={selected.size === 0 || spinPending} onClick={onSpin} title="Sinh 3 biến thể caption cho các bài đã chọn">
        {spinPending ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />}
        {" Áp dụng AI Spin Content"}
      </Button>
      <Button variant="primary" className="h-auto min-h-8 py-1.5" disabled={selected.size === 0 || autoPending} onClick={onAutoSchedule}>
        <Send size={14} />
        {" Đẩy tự động giãn cách 4h vào giờ vàng"}
      </Button>
    </div>
  </Card>;
}
