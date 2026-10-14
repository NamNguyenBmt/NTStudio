import { useNavigate } from "react-router-dom";
import { Clock, Flame, Settings2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";

function mergeSlots(workspaces) {
  const acc = new Map();
  for (const ws of workspaces) {
    const w = Math.max(1, ws.channelCount);
    for (const slot of ws.goldenHours) {
      const key = `${slot.start}-${slot.end}`;
      const cur = acc.get(key) ?? { slot, weight: 0, total: 0 };
      cur.weight += slot.weight * w;
      cur.total += w;
      acc.set(key, cur);
    }
  }
  return [...acc.values()].map(({ slot, weight, total }) => ({ ...slot, weight: weight / total })).sort((a, b) => a.start.localeCompare(b.start));
}

export function GoldenHoursCard({
  workspaces,
  activeWorkspaceId
}) {
  const navigate = useNavigate();
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const slots = active ? [...active.goldenHours].sort((a, b) => a.start.localeCompare(b.start)) : mergeSlots(workspaces);
  const max = Math.max(0.01, ...slots.map((s) => s.weight));
  const hot = new Set([...slots].sort((a, b) => b.weight - a.weight).slice(0, 2).map((s) => s.start));
  return <Card className="flex flex-col">
    <CardHeader
      icon={Clock}
      title="Giờ vàng Đăng bài"
      subtitle={active ? `Cấu hình của Pocket "${active.name}"` : "Tổng hợp các Pocket (trọng số theo số kênh)"}
      actions={<Badge tone="success">Tự động giãn</Badge>}
    />
    <div className="mx-space-md flex-1 rounded-xl bg-surface-container-lowest p-space-sm">
      <div className="grid grid-cols-[1fr_1.4fr_auto] gap-x-space-md px-space-sm pb-1.5 text-label-sm text-outline">
        <span>Khung giờ</span>
        <span>Mật độ tương tác</span>
        <span className="text-right">Tỷ trọng</span>
      </div>
      {slots.length === 0 && <p className="px-space-sm py-space-md text-body-sm text-on-surface-variant">Chưa cấu hình khung giờ vàng.</p>}
      <ul className="flex flex-col gap-0.5">
        {slots.map((s) => {
          const isHot = hot.has(s.start);
          return <li
            key={`${s.start}-${s.end}`}
            className={cn(
              "grid grid-cols-[1fr_1.4fr_auto] items-center gap-x-space-md rounded-lg px-space-sm py-1.5",
              isHot && "bg-success/[0.07]"
            )}
          >
            <span className={cn("flex items-center gap-1.5 font-mono text-code tabular", isHot ? "text-on-surface" : "text-on-surface-variant")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", isHot ? "bg-tertiary" : "bg-outline-variant")} />
              {s.start}
              {" – "}
              {s.end}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-overlay/[0.06]">
              <span
                className={cn("block h-full rounded-full", isHot ? "bg-tertiary" : "bg-secondary/70")}
                style={{ width: `${s.weight / max * 100}%` }}
              />
            </span>
            <span className={cn("flex items-center justify-end gap-1 font-mono text-code tabular", isHot ? "text-tertiary" : "text-on-surface-variant")}>
              {(s.weight * 100).toFixed(1)}
              %
              {isHot && <Flame size={12} aria-label="Giờ cao điểm" />}
            </span>
          </li>;
        })}
      </ul>
    </div>
    <div className="flex items-center justify-between gap-space-sm p-space-md">
      <span className="text-body-sm text-on-surface-variant">Lịch tự động ưu tiên các khung có tỷ trọng cao nhất.</span>
      <Button size="sm" variant="subtle" onClick={() => navigate("/workspaces")}>
        <Settings2 size={13} />
        {" Cấu hình"}
      </Button>
    </div>
  </Card>;
}
