import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { omni } from "../../lib/api";
import { useLocation, useNavigate, Outlet } from "react-router-dom";
import { navItems } from "../../app/nav";
import { ConfirmHost } from "../ui/confirm";
import { Toaster } from "../ui/toast";
import { bindSystemListeners } from "../../stores/system";
import { useUiStore } from "../../stores/ui";
import { CommandPalette } from "./CommandPalette";
import { NavRail } from "./NavRail";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { CloudBanner } from "./CloudBanner";
import { QuotaPicker } from "./QuotaPicker";

export function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => bindSystemListeners(), []);
  const qc = useQueryClient();
  useEffect(() => {
    const offInbox = omni.inbox.onChanged(() => {
      void qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && /^(inbox\.|dashboard\.)/.test(q.queryKey[0]),
      });
    });
    const offNav = omni.app.onNavigate((path) => navigate(path));
    return () => {
      offInbox();
      offNav();
    };
  }, [qc, navigate]);
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const ui = useUiStore.getState();
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        ui.setCommandOpen(!ui.commandOpen);
      } else if (key === "b") {
        e.preventDefault();
        ui.toggleRail();
      } else if (/^[1-9]$/.test(key)) {
        const item = navItems.find((n) => n.shortcut === `Ctrl+${key}`);
        if (item) {
          e.preventDefault();
          navigate(item.path);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
  return (
    <div className="flex h-full flex-col bg-surface">
      <TitleBar />
      <CloudBanner />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main key={pathname} className="scroll-thin min-w-0 flex-1 overflow-y-auto px-gutter py-gutter">
          <Outlet />
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <QuotaPicker />
      <Toaster />
      <ConfirmHost />
    </div>
  );
}
