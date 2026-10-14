import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call, useApiQuery } from "../../lib/api";
import { Bell, CircleCheck, ExternalLink, Info, TriangleAlert, WifiOff } from "lucide-react";
import { cn } from "../../lib/cn";
import { toast } from "../ui/toast";
import { formatRelative } from "../../lib/format";

const KEY = ["cloud.notifications", null];

const LEVEL = {
  INFO: { icon: Info, box: "bg-secondary/15 text-secondary" },
  SUCCESS: { icon: CircleCheck, box: "bg-tertiary/15 text-tertiary" },
  WARN: { icon: TriangleAlert, box: "bg-warning/15 text-warning" },
};

export function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const known = useRef(null);
  const { data, refetch } = useApiQuery("cloud.notifications", void 0, {
    refetchInterval: 6e4,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 2e4,
  });
  const unread = data?.unread ?? 0;
  useEffect(() => {
    if (!data) return;
    if (known.current) {
      const fresh = data.items.find((n) => n.unread && !known.current.has(n.id));
      if (fresh) toast.info(`Thông báo mới: ${fresh.title}`);
    }
    known.current = new Set(data.items.map((n) => n.id));
  }, [data]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    void refetch().then(({ data: d }) => {
      if (!d?.unread) return;
      qc.setQueryData(KEY, (x) => (x ? { ...x, unread: 0 } : x));
      void call("cloud.notificationsSeen").catch(() => void 0);
    });
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread ? `Thông báo – ${unread} chưa đọc` : "Thông báo"}
        aria-expanded={open}
        title="Thông báo"
        onClick={toggle}
        className={cn(
          "relative inline-flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface",
          open && "bg-surface-container-high text-on-surface",
        )}
      >
        <Bell size={16} strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold leading-none text-on-error">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Thông báo"
          className="absolute right-0 top-9 z-50 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-high shadow-flyout"
        >
          <div className="flex items-center justify-between border-b border-outline-variant/30 px-space-md py-space-sm">
            <span className="text-label-md text-on-surface">Thông báo</span>
            {data?.offline && (
              <span className="flex items-center gap-1 text-label-sm text-outline">
                <WifiOff size={12} />
                {" Không kết nối được Omnira"}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!data?.items.length ? (
              <div className="flex flex-col items-center gap-space-xs px-space-md py-space-xl text-center text-body-sm text-on-surface-variant">
                <Bell size={22} className="text-outline" />
                Chưa có thông báo
              </div>
            ) : (
              data.items.map((n) => {
                const L = LEVEL[n.level] ?? LEVEL.INFO;
                const Wrapper = n.linkUrl ? "button" : "div";
                return (
                  <Wrapper
                    key={n.id}
                    {...(n.linkUrl
                      ? { type: "button", onClick: () => void call("system.openExternal", { url: n.linkUrl }) }
                      : {})}
                    className={cn(
                      "flex w-full gap-space-sm border-b border-outline-variant/20 px-space-md py-space-sm text-left last:border-0",
                      n.linkUrl && "hover:bg-overlay/[0.06]",
                      n.unread && "bg-primary/[0.06]",
                    )}
                  >
                    <span
                      className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", L.box)}
                    >
                      <L.icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-body-sm text-on-surface", n.unread && "font-semibold")}>
                        {n.title}
                      </span>
                      <span className="mt-0.5 block whitespace-pre-line text-label-sm text-on-surface-variant">
                        {n.body}
                      </span>
                      <span className="mt-1 flex items-center gap-space-sm text-[11px] text-outline">
                        <span title={new Date(n.createdAt).toLocaleString("vi-VN")}>
                          {formatRelative(new Date(n.createdAt))}
                        </span>
                        {n.linkUrl && (
                          <span className="inline-flex items-center gap-0.5 text-primary">
                            {"Xem chi tiết "}
                            <ExternalLink size={10} />
                          </span>
                        )}
                      </span>
                    </span>
                    {n.unread && (
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Chưa đọc" />
                    )}
                  </Wrapper>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
