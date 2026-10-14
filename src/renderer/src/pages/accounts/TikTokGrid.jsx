import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { StatusDot } from "../../components/ui/StatusDot";
import { formatCompact } from "../../lib/format";
import { sessionMeta, daysUntil } from "./meta";

export function TikTokGrid({ accounts, selectedId, onSelect }) {
  if (accounts.length === 0)
    return (
      <p className="px-space-md pb-space-md text-body-sm text-on-surface-variant">Không có tài khoản TikTok phù hợp.</p>
    );
  return (
    <div className="grid grid-cols-1 gap-space-sm px-space-md pb-space-md lg:grid-cols-2">
      {accounts.map((a) => {
        const channel = a.channels[0];
        const session = sessionMeta[a.sessionStatus];
        const days = daysUntil(a.sessionExpiresAt);
        const bad = a.health === "error";
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id)}
            className={cn(
              "flex flex-col gap-space-sm rounded-xl border p-space-md text-left transition-colors",
              bad
                ? "border-danger/40 bg-danger/[0.06]"
                : "border-transparent bg-surface-container hover:bg-surface-container-high",
              selectedId === a.id && "border-primary-container/60",
            )}
          >
            <div className="flex items-start justify-between gap-space-sm">
              <div className="flex min-w-0 items-center gap-space-sm">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-label-md text-on-surface-variant">
                  {a.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-label-md text-on-surface">@{a.handle}</div>
                  <div className="truncate text-label-sm text-on-surface-variant">{a.displayName}</div>
                </div>
              </div>
              {channel?.quotaBlocked ? (
                <Badge tone="warning" pill={true} title="Vượt hạn mức kênh của gói – tạm dừng, không đăng bài">
                  Ngoài hạn mức
                </Badge>
              ) : (
                <Badge tone={session.tone} pill={true}>
                  <StatusDot health={a.health} live={a.health === "ok"} />
                  {a.health === "ok"
                    ? "Đang chạy"
                    : a.health === "warn"
                      ? "Cảnh báo"
                      : a.health === "idle"
                        ? "Chưa kiểm tra"
                        : "Hết hạn"}
                </Badge>
              )}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-space-md gap-y-1 font-mono text-code">
              <dt className="text-on-surface-variant">Người theo dõi:</dt>
              <dd className="text-right tabular text-tertiary">{formatCompact(channel?.followers ?? 0)}</dd>
              <dt className="text-on-surface-variant">{a.note ? "Ghi chú:" : "Phiên đăng nhập:"}</dt>
              <dd
                className={cn("truncate text-right", bad ? "text-error" : a.note ? "text-secondary" : "text-tertiary")}
              >
                {a.note ?? (days == null ? "—" : days >= 0 ? `Còn ${days} ngày` : "Đã hết hạn")}
              </dd>
            </dl>
            <div className="flex items-center justify-between border-t border-overlay/[0.06] pt-space-sm">
              <span className="text-label-sm uppercase tracking-wider text-outline">
                {"Ngách: "}
                {channel?.nicheTag ?? "—"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
