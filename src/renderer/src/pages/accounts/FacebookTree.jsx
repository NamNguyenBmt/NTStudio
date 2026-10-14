import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Plus, ShieldCheck } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { StatusDot } from "../../components/ui/StatusDot";
import { formatCompact } from "../../lib/format";
import { sessionMeta, tokenMeta, channelStatusMeta, roleLabel } from "./meta";

function Avatar({ name }) {
  return <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-label-md text-on-surface-variant">
    {name.slice(0, 2).toUpperCase()}
  </div>;
}

export function FacebookTree({
  accounts,
  selectedId,
  onSelect,
  onAddPage,
  onConnect
}) {
  const [collapsed, setCollapsed] = useState(new Set());
  const toggle = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  if (accounts.length === 0) return <p className="px-space-md pb-space-md text-body-sm text-on-surface-variant">Không có tài khoản Facebook phù hợp.</p>;
  return <ul className="flex flex-col gap-space-sm px-space-md pb-space-md">
    {accounts.map((a) => {
      const open = !collapsed.has(a.id);
      const session = sessionMeta[a.sessionStatus];
      return <li key={a.id} className={cn("rounded-xl border bg-surface-container transition-colors", selectedId === a.id ? "border-primary-container/60" : "border-transparent")}>
        <div className="flex items-center gap-space-sm p-space-sm">
          <button
            type="button"
            aria-label={open ? "Thu gọn" : "Mở rộng"}
            aria-expanded={open}
            onClick={() => toggle(a.id)}
            className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant hover:bg-overlay/[0.06]"
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <button type="button" onClick={() => onSelect(a.id)} className="flex min-w-0 flex-1 items-center gap-space-sm text-left">
            <Avatar name={a.displayName} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-space-sm">
                <span className="truncate text-label-md text-on-surface">{a.displayName}</span>
                <Badge mono={true}>{"UID: "}{a.externalId ?? "—"}</Badge>
                {a.twoFactorEnabled && <Badge tone="success"><ShieldCheck size={11} />{" 2FA"}</Badge>}
                {a.note && <Badge tone="secondary">{a.note}</Badge>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-space-md gap-y-0.5">
                <span className="flex items-center gap-1 text-label-sm text-on-surface-variant">
                  <StatusDot health={session.health} />
                  {" "}
                  {session.label}
                </span>
              </div>
            </div>
          </button>
        </div>
        {open && <ul className="ml-[38px] flex flex-col gap-1 border-l border-overlay/[0.08] pb-space-sm pl-space-sm pr-space-sm">
          {a.channels.map((c) => {
            const token = tokenMeta[c.tokenStatus];
            const status = c.quotaBlocked ? { tone: "warning", label: "Ngoài hạn mức" } : channelStatusMeta[c.status];
            const bad = c.health === "error";
            return <li
              key={c.id}
              className={cn(
                "flex items-center gap-space-sm rounded-lg px-space-sm py-1.5",
                bad ? "bg-danger/[0.08] ring-1 ring-danger/30" : "bg-surface-container-high/60"
              )}
            >
              <FileText size={14} className={bad ? "text-error" : "text-secondary"} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-space-sm">
                  <span className="truncate text-body-sm text-on-surface">Fanpage: "{c.name}"</span>
                  <span className="font-mono text-[10px] text-outline">{c.externalId}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-space-md text-label-sm text-on-surface-variant">
                  <span>{"Quyền: "}{c.role ? roleLabel[c.role] ?? c.role : "—"}</span>
                  <span className={cn(token.tone === "success" ? "text-tertiary" : token.tone === "danger" ? "text-error" : "text-warning")}>
                    {token.label}
                  </span>
                  <span className="font-mono tabular">{formatCompact(c.followers)}{" follow"}</span>
                </div>
              </div>
              <Badge tone={status.tone} pill={true}>
                <StatusDot health={c.health} live={c.status === "active" && c.health === "ok"} />
                {status.label}
              </Badge>
              {(c.tokenStatus === "expired" || c.tokenStatus === "missing") && <Button size="sm" variant={c.tokenStatus === "expired" ? "danger" : "subtle"} onClick={() => onConnect(c)}>
                {c.tokenStatus === "expired" ? "Cập nhật Token" : "Kết nối API"}
              </Button>}
            </li>;
          })}
          <li>
            <button
              type="button"
              onClick={() => onAddPage(a)}
              className="flex items-center gap-1 rounded px-space-sm py-1 text-label-sm text-primary hover:bg-overlay/[0.04]"
            >
              <Plus size={12} />
              {" Thêm Fanpage"}
            </button>
          </li>
        </ul>}
      </li>;
    })}
  </ul>;
}
