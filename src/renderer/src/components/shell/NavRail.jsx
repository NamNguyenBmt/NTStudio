import { useApiQuery } from "../../lib/api";
import { NavLink } from "react-router-dom";
import { Lock, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { navItems } from "../../app/nav";
import { cn } from "../../lib/cn";
import { Progress } from "../ui/Progress";
import { StatusDot } from "../ui/StatusDot";
import { useUiStore } from "../../stores/ui";
import { encoderShort } from "../../lib/media";

export function NavRail() {
  const collapsed = useUiStore((s) => s.railCollapsed);
  const toggleRail = useUiStore((s) => s.toggleRail);
  const { data: media } = useApiQuery("media.status", void 0, {
    refetchInterval: (q) => (q.state.data?.running || q.state.data?.queued ? 1e3 : 5e3),
  });
  const run = media?.running;
  const { data: inboxStats } = useApiQuery("inbox.stats", void 0, { refetchInterval: 6e4 });
  const unread = inboxStats?.unread ?? 0;
  const { data: lic } = useApiQuery("license.state", void 0, { staleTime: 6e4 });
  const locked = (f) => !!f && !!lic && !lic.features.includes(f);
  const { data: appInfo } = useApiQuery("cloud.appInfo", void 0, { staleTime: 10 * 6e4, refetchInterval: 30 * 6e4 });
  const version = appInfo ? `v${appInfo.currentVersion}` : null;
  const versionTitle = appInfo
    ? `Omnira Studio ${appInfo.currentVersion}${appInfo.updateAvailable && appInfo.latestVersion ? ` – đã có bản mới ${appInfo.latestVersion}` : ""}`
    : void 0;
  return (
    <aside
      className={cn(
        "mica flex shrink-0 flex-col justify-between overflow-hidden bg-surface-container-low/95 p-space-sm transition-[width] duration-[180ms] ease-fluent",
        collapsed ? "w-rail-collapsed" : "w-rail-expanded",
      )}
    >
      <div className="flex min-h-0 flex-col gap-space-xs">
        <div className="flex h-7 items-center justify-between px-[6px]">
          {!collapsed && (
            <span className="truncate text-label-sm uppercase tracking-wider text-outline">Điều hướng hệ thống</span>
          )}
          <button
            type="button"
            onClick={toggleRail}
            aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
            title={collapsed ? "Mở rộng (Ctrl+B)" : "Thu gọn (Ctrl+B)"}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            {collapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.75} />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.75} />
            )}
          </button>
        </div>
        <nav className="flex flex-col gap-0.5">
          {navItems.map(({ path, label, icon: Icon, badge: staticBadge, shortcut, feature }) => {
            const isLocked = locked(feature);
            const badge = path === "/inbox" && unread > 0 ? (unread > 99 ? "99+" : String(unread)) : staticBadge;
            return (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                title={
                  isLocked
                    ? `${label} – cần nâng cấp gói`
                    : collapsed
                      ? `${label}${shortcut ? ` (${shortcut})` : ""}`
                      : shortcut
                }
                className={({ isActive }) =>
                  cn(
                    "group relative flex h-9 items-center gap-space-md rounded-lg px-[10px] text-body-sm transition-colors",
                    isActive
                      ? "bg-primary-container font-semibold text-on-primary"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                  )
                }
              >
                <span className="relative shrink-0">
                  <Icon size={18} strokeWidth={1.75} />
                  {collapsed && path === "/inbox" && unread > 0 && (
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-error" />
                  )}
                  {collapsed && isLocked && <Lock size={10} className="absolute -bottom-1 -right-1.5 opacity-70" />}
                </span>
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{label}</span>
                    {badge && !isLocked && (
                      <span className="rounded bg-secondary-container px-1.5 py-0.5 text-label-sm text-on-secondary-container">
                        {badge}
                      </span>
                    )}
                    {isLocked && <Lock size={13} className="shrink-0 opacity-70" aria-label="Cần nâng cấp gói" />}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>
      <div className="flex flex-col gap-space-xs">
        {collapsed ? (
          <div
            className="flex justify-center py-space-sm"
            title={run ? `Đang render ${Math.round(run.progress * 100)}%` : "Render: rảnh"}
          >
            <StatusDot health={run ? "ok" : "idle"} live={!!run} />
          </div>
        ) : (
          <div
            className="flex flex-col gap-space-xs rounded-xl bg-surface-container p-space-sm"
            title={run?.stage ?? void 0}
          >
            <div className="flex items-center justify-between">
              <span className="text-label-sm text-on-surface-variant">Cụm Render Local</span>
              <StatusDot health={run ? "ok" : "idle"} live={!!run} />
            </div>
            <Progress value={run ? run.progress * 100 : 0} />
            <div className="flex justify-between font-mono text-[10px] text-on-surface-variant">
              <span>{media?.encoder ? encoderShort[media.encoder] : "Encoder: chưa dò"}</span>
              <span>
                {run ? `${Math.round(run.progress * 100)}% Active` : media?.queued ? `${media.queued} chờ` : "Rảnh"}
              </span>
            </div>
          </div>
        )}
        {version && (
          <div
            className={cn(
              "flex items-center gap-1 px-[6px] font-mono text-[10px] text-outline",
              collapsed ? "justify-center" : "justify-between",
            )}
            title={versionTitle}
          >
            {!collapsed && <span className="truncate">Omnira Studio</span>}
            <span className="flex shrink-0 items-center gap-1">
              {appInfo?.updateAvailable && (
                <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="Có bản mới" />
              )}
              {version}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}

export function Item({ children, title }) {
  return (
    <span title={title} className="flex items-center gap-1.5 whitespace-nowrap">
      {children}
    </span>
  );
}
