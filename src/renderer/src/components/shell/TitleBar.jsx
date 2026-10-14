import { AccountMenu } from "./AccountMenu";
import { Search } from "lucide-react";
import { AppLogo } from "./AppLogo";
import { Kbd } from "../ui/Kbd";
import { useUiStore } from "../../stores/ui";
import { ThemeToggle } from "./ThemeToggle";
import { FlowCredits } from "./FlowCredits";
import { NotificationBell } from "./NotificationBell";
import { isMac, WindowControls } from "./WindowControls";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { RefreshLicenseButton } from "./RefreshLicenseButton";

export function TitleBar() {
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  return <header className="app-drag mica relative z-40 flex h-titlebar shrink-0 items-center justify-between bg-surface-container-lowest/90">
    <div className={`flex min-w-0 items-center gap-space-sm ${isMac ? "pl-[76px]" : "pl-space-md"}`}>
      <div className="flex items-center gap-space-xs">
        <AppLogo size={18} />
        <span className="text-label-md font-semibold tracking-tight text-on-surface">NT Studio</span>
        <span className="rounded bg-surface-container-highest px-space-xs py-0.5 font-mono text-code text-primary" />
      </div>
      <div className="mx-space-xs h-4 w-px bg-outline-variant/40" />
      <WorkspaceSwitcher />
    </div>
    <button
      type="button"
      onClick={() => setCommandOpen(true)}
      className="no-drag mx-space-lg flex h-7 w-full max-w-md items-center gap-space-sm rounded bg-surface-container-low px-space-md text-on-surface-variant transition-colors hover:bg-surface-container"
    >
      <Search size={15} strokeWidth={1.75} />
      <span className="flex-1 truncate text-left text-body-sm text-on-surface-variant/70">
        Tìm kiếm kênh, bài viết, kịch bản...
      </span>
      <Kbd>Ctrl+K</Kbd>
    </button>
    <div className="flex items-center">
      <div className="no-drag flex items-center gap-space-xs pr-space-sm">
        <FlowCredits />
        <NotificationBell />
        <RefreshLicenseButton />
        <ThemeToggle />
        <AccountMenu />
      </div>
      {!isMac && <WindowControls />}
    </div>
  </header>;
}
