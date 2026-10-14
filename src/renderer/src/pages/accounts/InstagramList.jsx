import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { StatusDot } from "../../components/ui/StatusDot";
import { formatCompact } from "../../lib/format";

export function InstagramList({ accounts, selectedId, onSelect }) {
  if (accounts.length === 0) return <p className="px-space-md pb-space-md text-body-sm text-on-surface-variant">Không có tài khoản Instagram phù hợp.</p>;
  return <ul className="flex flex-col gap-space-sm px-space-md pb-space-md">
    {accounts.map((a) => {
      const channel = a.channels[0];
      return <li key={a.id}>
        <button
          type="button"
          onClick={() => onSelect(a.id)}
          className={cn(
            "flex w-full items-center gap-space-md rounded-xl border bg-surface-container p-space-sm text-left transition-colors hover:bg-surface-container-high",
            selectedId === a.id ? "border-primary-container/60" : "border-transparent"
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-instagram p-[2px]">
            <div className="flex h-full w-full items-center justify-center rounded-full bg-surface-container text-label-sm text-on-surface">
              {a.displayName.slice(0, 2).toUpperCase()}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-label-md text-on-surface">
              @
              {a.handle}
              {" "}
              <span className="font-normal text-on-surface-variant">({a.displayName})</span>
            </div>
            <div className="font-mono text-code text-on-surface-variant">
              {"ID: "}
              {a.externalId ?? "—"}
              {" · "}
              <span className="text-tertiary">{formatCompact(channel?.followers ?? 0)}</span>
              {" người theo dõi"}
            </div>
          </div>
          {channel?.quotaBlocked ? <Badge tone="warning" pill={true} title="Vượt hạn mức kênh của gói – tạm dừng, không đăng bài">
            Ngoài hạn mức
          </Badge> : <Badge tone={a.health === "ok" ? "success" : a.health === "warn" ? "warning" : a.health === "idle" ? "neutral" : "danger"} pill={true}>
            <StatusDot health={a.health} live={a.health === "ok"} />
            {a.health === "ok" ? "Đang chạy" : a.health === "warn" ? "Cảnh báo" : a.health === "idle" ? "Chưa kiểm tra" : "Lỗi"}
          </Badge>}
        </button>
      </li>;
    })}
  </ul>;
}
