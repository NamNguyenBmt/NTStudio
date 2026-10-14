import { useState } from "react";
import { ChevronDown, ChevronRight, CircleCheck, CircleX, Clock, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { IconButton } from "../../components/ui/IconButton";
import { Progress } from "../../components/ui/Progress";
import { useNow } from "../../components/TakeProgress";

const META = {
  waiting: { label: "Chờ lượt", tone: "neutral", icon: Clock },
  running: { label: "Đang tạo", tone: "secondary", icon: LoaderCircle },
  done: { label: "Xong", tone: "success", icon: CircleCheck },
  fallback: { label: "Dùng nguồn dự phòng", tone: "warning", icon: TriangleAlert },
  failed: { label: "Không có hình", tone: "danger", icon: CircleX }
};

const expectedSec = (source) => /flow|veo/i.test(source ?? "") ? 120 : /gemini|fal|ảnh/i.test(source ?? "") ? 20 : 8;
const fmt = (s) => s >= 90 ? `${Math.floor(s / 60)}p${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)}s`;

export function SceneProgressPanel({ job, labels, onFocusScene }) {
  const [open, setOpen] = useState(true);
  const [closedFor, setClosedFor] = useState(null);
  const scenes = (job.scenes ?? []).filter(Boolean);
  const active = job.status === "running" || job.status === "queued";
  const now = useNow(active && scenes.some((s) => s.status === "running"));
  if (!scenes.length || closedFor === job.id) return null;
  const count = (st) => scenes.filter((s) => s.status === st).length;
  const finished = count("done") + count("fallback") + count("failed");
  return <Card className="flex max-h-[42%] min-w-0 shrink-0 flex-col">
    <div className="flex items-center gap-space-sm border-b border-overlay/[0.06] px-space-md py-space-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-space-sm text-left" aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="text-label-md text-on-surface">Tiến độ từng cảnh</span>
        <span className="truncate font-mono text-code text-on-surface-variant">
          {finished}
          /
          {scenes.length}
          {" xong"}
          {count("running") ? ` · ${count("running")} đang tạo` : ""}
          {count("waiting") ? ` · ${count("waiting")} chờ` : ""}
          {count("fallback") ? ` · ${count("fallback")} dự phòng` : ""}
          {count("failed") ? ` · ${count("failed")} lỗi` : ""}
        </span>
      </button>
      <Progress value={finished / scenes.length * 100} className="w-28" />
      {!active && <IconButton icon={X} label="Ẩn bảng tiến độ" onClick={() => setClosedFor(job.id)} />}
    </div>
    {open && <ul className="scroll-thin grid min-h-0 grid-cols-1 gap-1 overflow-y-auto p-space-sm xl:grid-cols-2">
      {scenes.map((s) => {
        const m = META[s.status];
        const elapsed = s.startedAt ? (now - s.startedAt) / 1e3 : 0;
        const pct = s.status === "running" ? s.progress != null ? s.progress * 100 : Math.min(95, elapsed / expectedSec(s.source) * 100) : s.status === "waiting" ? 0 : 100;
        return <li key={s.index} className="min-w-0">
          <button
            type="button"
            onClick={() => onFocusScene(s.index)}
            title={s.text ?? void 0}
            className="flex w-full flex-col gap-1 rounded-lg bg-surface-container px-space-sm py-1.5 text-left hover:bg-surface-container-high"
          >
            <span className="flex items-center gap-space-sm">
              <span className="w-14 shrink-0 font-mono text-code text-on-surface">{"Cảnh "}{s.index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-label-sm text-on-surface-variant">
                {labels[s.index] && labels[s.index] !== `Cảnh ${s.index + 1}` ? labels[s.index] : ""}
              </span>
              <Badge tone={m.tone} pill={true}>
                <m.icon size={11} className={cn(s.status === "running" && "animate-spin")} />
                {" "}
                {m.label}
              </Badge>
            </span>
            <span className="flex items-center gap-space-sm">
              <Progress
                value={pct}
                className="flex-1"
                barClassName={cn(s.status === "failed" ? "bg-error" : s.status === "fallback" ? "bg-warning" : s.status === "done" ? "bg-tertiary" : "bg-secondary")}
              />
              <span className="w-16 shrink-0 text-right font-mono text-code text-outline">
                {s.status === "running" ? s.progress != null ? `${Math.round(s.progress * 100)}%` : fmt(elapsed) : ""}
              </span>
            </span>
            {(s.source || s.text) && // Lỗi có thể rất dài (VD đường dẫn ảnh chẩn đoán) → xuống dòng, tối đa 2 dòng; rê chuột xem đủ
            <span
              className={cn(
                "line-clamp-2 break-words text-label-sm [overflow-wrap:anywhere]",
                s.status === "failed" || s.status === "fallback" ? "text-warning" : "text-outline"
              )}
            >
              {s.text && s.status !== "done" ? s.source && !s.text.startsWith(s.source) ? `${s.source} · ${s.text}` : s.text : s.source}
            </span>}
          </button>
        </li>;
      })}
    </ul>}
  </Card>;
}
