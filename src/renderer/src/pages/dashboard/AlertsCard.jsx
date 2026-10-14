import { useApiMutation } from "../../lib/api";
import { CheckCheck, CircleSlash, Gauge, KeyRound, ShieldAlert, TrendingDown, TriangleAlert } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { StatusDot } from "../../components/ui/StatusDot";
import { formatRelative } from "../../lib/format";

const kindMeta = {
  cookie_expired: { label: "Hết hạn Cookie", icon: TriangleAlert },
  token_invalid: { label: "Token mất quyền", icon: KeyRound },
  proxy_latency: { label: "Độ trễ cao", icon: Gauge },
  proxy_dead: { label: "Proxy chết", icon: CircleSlash },
  checkpoint: { label: "Checkpoint", icon: ShieldAlert },
  render_failed: { label: "Render lỗi", icon: TriangleAlert },
  publish_failed: { label: "Đăng lỗi", icon: TriangleAlert },
  budget: { label: "Vượt hạn mức", icon: TriangleAlert },
  low_reach: { label: "Phân phối kém", icon: TrendingDown }
};

const severityTone = { error: "danger", warn: "warning", info: "secondary" };

export function AlertsCard({ alerts }) {
  const resolve = useApiMutation("alerts.resolve", ["alerts.", "dashboard."]);
  return <Card className="flex flex-col">
    <CardHeader
      icon={ShieldAlert}
      title={`Cảnh báo Cần Xử lý (${alerts.length})`}
      actions={alerts.some((a) => a.severity === "error") ? <Badge tone="danger">Ưu tiên cao</Badge> : null}
    />
    <ul className="scroll-thin flex max-h-[380px] flex-col gap-space-sm overflow-y-auto px-space-md">
      {alerts.length === 0 && <li className="flex items-center gap-space-sm rounded-xl bg-surface-container p-space-md text-body-sm text-tertiary">
        <CheckCheck size={16} />
        {" Không có sự cố nào – hệ thống đang ổn định"}
      </li>}
      {alerts.map((a) => {
        const meta = kindMeta[a.kind];
        return <li key={a.id} className="rounded-xl bg-surface-container p-space-sm">
          <div className="flex items-center justify-between gap-space-sm">
            <span className="flex min-w-0 items-center gap-1.5 text-label-md text-on-surface">
              <meta.icon size={14} className={a.severity === "error" ? "text-error" : "text-warning"} />
              <span className="truncate">{a.title}</span>
            </span>
            <Badge tone={severityTone[a.severity]}>{meta.label}</Badge>
          </div>
          <p className="mt-1 text-body-sm text-on-surface-variant">{a.message}</p>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono text-code text-outline">
              <StatusDot health={a.severity === "error" ? "error" : "warn"} />
              {formatRelative(a.createdAt)}
            </span>
            <Button size="sm" variant="subtle" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: a.id })}>
              Đánh dấu đã xử lý
            </Button>
          </div>
        </li>;
      })}
    </ul>
    <div className="p-space-md">
      <Button className="w-full" disabled={true} title="Bộ xử lý tự động sẽ có ở P6 (Hạ tầng tài khoản)">
        <CheckCheck size={15} />
        {" Giải quyết tất cả sự cố tự động"}
      </Button>
    </div>
  </Card>;
}
