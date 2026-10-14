import { confirmDialog } from "../ui/confirm";
import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call, useApiQuery } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, KeyRound, LogOut, UserRound } from "lucide-react";
import "../ui/Drawer";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { ThemePicker } from "./ThemeToggle";

export function AccountMenu() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: state } = useApiQuery("auth.state", void 0, { staleTime: Infinity });
  const { data: lic } = useApiQuery("license.state", void 0, { staleTime: 6e4 });
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const ref = useRef(null);
  const user = state?.user;
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const logout = async () => {
    setOpen(false);
    const ok = await confirmDialog({
      title: "Đăng xuất",
      message: "Các tác vụ nền (đăng bài theo lịch, đồng bộ hộp thư, render) sẽ dừng, máy này được trả chỗ cho tài khoản (đăng nhập lại sẽ kích hoạt lại).",
      confirmLabel: "Đăng xuất"
    });
    if (!ok) return;
    try {
      await call("auth.logout");
    } finally {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth.state" });
      await qc.refetchQueries({ queryKey: ["auth.state"] });
    }
  };
  const initials = (user?.displayName ?? "?").split(/\s+/).map((w) => w[0]).slice(-2).join("").toUpperCase();
  return <div ref={ref} className="relative ml-space-xs">
    <button
      type="button"
      aria-label="Tài khoản"
      aria-expanded={open}
      title={user ? `${user.displayName} · ${user.email}` : "Tài khoản"}
      onClick={() => setOpen((o) => !o)}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-on-primary"
    >
      {user ? initials : <UserRound size={16} strokeWidth={2} />}
    </button>
    {open && user && <div className="absolute right-0 top-9 z-50 w-64 rounded-xl border border-outline-variant/30 bg-surface-container-high p-space-sm shadow-flyout">
      <div className="px-space-sm py-space-xs">
        <div className="truncate text-label-md text-on-surface">{user.displayName}</div>
        <div className="truncate text-body-sm text-on-surface-variant">{user.email}</div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-outline">
          {"Tài khoản Omnira · "}
          {lic?.planName ?? "chưa có gói"}
          {lic?.trial ? " (dùng thử)" : ""}
        </div>
      </div>
      <div className="my-space-xs h-px bg-outline-variant/30" />
      <div className="px-space-sm pb-space-xs text-label-sm uppercase tracking-wider text-outline">Giao diện</div>
      <div className="px-space-xs pb-space-sm"><ThemePicker /></div>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          navigate("/billing");
        }}
        className="flex w-full items-center gap-space-sm rounded px-space-sm py-1.5 text-left text-body-sm text-on-surface hover:bg-overlay/[0.06]"
      >
        <BadgeCheck size={14} />
        {" Gói & thanh toán"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setPwOpen(true);
        }}
        className="flex w-full items-center gap-space-sm rounded px-space-sm py-1.5 text-left text-body-sm text-on-surface hover:bg-overlay/[0.06]"
      >
        <KeyRound size={14} />
        {" Đổi mật khẩu"}
      </button>
      <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-space-sm rounded px-space-sm py-1.5 text-left text-body-sm text-error hover:bg-overlay/[0.06]">
        <LogOut size={14} />
        {" Đăng xuất"}
      </button>
    </div>}
    <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
  </div>;
}
