import { Plus } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";

export function Section({ title, icon: Icon, count, onAdd, children }) {
  return (
    <Card className="flex flex-col gap-space-sm p-space-md">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-space-sm text-label-md text-on-surface">
          <Icon size={15} className="text-secondary" /> {title}{" "}
          <span className="font-mono text-outline">({count})</span>
        </h2>
        <Button size="sm" variant="subtle" onClick={onAdd}>
          <Plus size={12} />
          {" Thêm"}
        </Button>
      </div>
      {count === 0 ? (
        <p className="text-body-sm text-outline">Chưa có – bấm "AI viết kịch bản" hoặc thêm tay.</p>
      ) : (
        <ul className="flex max-h-[360px] flex-col gap-1 overflow-y-auto scroll-thin">{children}</ul>
      )}
    </Card>
  );
}

export function Row({ title, sub, onClick, badge, tone, dim, note }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full flex-col rounded-lg px-space-sm py-1.5 text-left hover:bg-surface-container-high",
          dim && "opacity-50",
        )}
      >
        <span className="flex items-center gap-space-sm truncate text-body-sm text-on-surface">
          {title}
          {badge && <Badge tone={tone}>{badge}</Badge>}
          {note && (
            <span className="text-label-sm text-outline">
              {"· "}
              {note}
            </span>
          )}
        </span>
        <span className="truncate text-label-sm text-on-surface-variant">{sub}</span>
      </button>
    </li>
  );
}
