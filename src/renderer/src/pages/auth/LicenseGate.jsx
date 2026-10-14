import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call, useApiQuery, useApiMutation } from "../../lib/api";
import { Download, LoaderCircle, LogOut, Network, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ConfirmHost } from "../../components/ui/confirm";
import { toast, Toaster } from "../../components/ui/toast";
import { ThemeToggle } from "../../components/shell/ThemeToggle";
import { isMac, WindowControls } from "../../components/shell/WindowControls";
import { useRefreshLicense, PlanCard, BuyPlanDialog } from "../../components/billing/BuyPlanDialog";
import { DevicesList } from "./DevicesList";

const TITLE = {
  active: "Đang hoạt động",
  offline: "Đang dùng ngoại tuyến",
  checking: "Đang kiểm tra license…",
  no_subscription: "Tài khoản chưa có gói đang hoạt động",
  device_limit: "Đã dùng hết số máy của gói",
  revoked: "Máy này đã bị gỡ khỏi tài khoản",
  expired: "Cần kết nối mạng để kiểm tra license",
  relogin: "Cần đăng nhập lại tài khoản Omnira",
  locked: "Tài khoản đã bị khóa"
};

function Frame({ children }) {
  return <div className="flex h-screen flex-col bg-background">
    <header className="app-drag flex h-titlebar shrink-0 items-center justify-between">
      <div className={`flex items-center gap-space-xs ${isMac ? "pl-[76px]" : "pl-space-md"}`}>
        <Network size={18} className="text-secondary" />
        <span className="text-label-md font-semibold text-on-surface">Omnira Studio</span>
      </div>
      <div className="flex items-center"><ThemeToggle className="mr-space-sm" />{!isMac && <WindowControls />}</div>
    </header>
    <main className="scroll-thin flex flex-1 justify-center overflow-y-auto p-space-lg">
      <div className="w-full max-w-[960px]">{children}</div>
    </main>
    <Toaster />
    <ConfirmHost />
  </div>;
}

function useLogout() {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  return {
    pending,
    logout: async () => {
      setPending(true);
      try {
        await call("auth.logout");
      } finally {
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth.state" });
        await qc.refetchQueries({ queryKey: ["auth.state"] });
        setPending(false);
      }
    }
  };
}

export function UpdateRequired({ info }) {
  return <Frame>
    <div className="mx-auto mt-space-xl flex max-w-[520px] flex-col items-center gap-space-md rounded-2xl border border-outline-variant/30 bg-surface-container-low p-space-xl text-center">
      <Download size={36} className="text-primary" />
      <h1 className="text-headline-md text-on-surface">Cần cập nhật Omnira Studio</h1>
      <p className="text-body-sm text-on-surface-variant">
        {"Phiên bản "}
        {info.currentVersion}
        {" không còn được hỗ trợ (tối thiểu "}
        {info.minVersion}
        {"). Tải bản "}
        {info.latestVersion ?? "mới nhất"}
        {" để tiếp tục – dữ liệu trên máy được giữ nguyên."}
      </p>
      {info.releaseNotes && <p className="whitespace-pre-wrap rounded-lg bg-surface-container-lowest p-space-sm text-left text-body-sm text-on-surface-variant">
        {info.releaseNotes}
      </p>}
      {info.downloadUrl && <Button variant="primary" onClick={() => void call("system.openExternal", { url: info.downloadUrl })}>
        <Download size={15} />
        {" Tải bản cập nhật"}
      </Button>}
    </div>
  </Frame>;
}

export function LicenseGate({ state }) {
  const lic = state.license;
  const { logout, pending } = useLogout();
  const refresh = useRefreshLicense();
  const recheck = useApiMutation("license.refresh", ["auth.", "license."]);
  const activate = useApiMutation("license.activate", ["auth.", "license."]);
  const { data: plans } = useApiQuery("billing.plans", void 0, { enabled: lic.status === "no_subscription", staleTime: 5 * 6e4 });
  const [buy, setBuy] = useState(false);
  const [planCode, setPlanCode] = useState(null);
  if (lic.status === "checking")
    return <Frame>
      <div className="mt-space-xl flex items-center justify-center gap-space-sm text-on-surface-variant">
        <LoaderCircle size={18} className="animate-spin" />
        {" Đang kiểm tra license với Omnira Cloud…"}
      </div>
    </Frame>;
  const again = () => recheck.mutate(void 0, {
    onSuccess: (v) => v.usable ? toast.success("License đã hoạt động") : toast.info(v.message ?? "Chưa có license dùng được"),
    onError: (e) => toast.error(e.message)
  });
  return <Frame>
    <div className="flex flex-col gap-space-lg">
      <div className="flex flex-wrap items-start justify-between gap-space-md rounded-2xl border border-warning/30 bg-warning/5 p-space-lg">
        <div className="flex gap-space-md">
          {lic.status === "locked" || lic.status === "revoked" ? <ShieldAlert size={28} className="shrink-0 text-error" /> : <TriangleAlert size={28} className="shrink-0 text-warning" />}
          <div>
            <h1 className="text-headline-sm text-on-surface">{TITLE[lic.status]}</h1>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              {lic.message ?? "Mua hoặc gia hạn gói để tiếp tục dùng Omnira Studio. Dữ liệu trên máy vẫn được giữ nguyên."}
            </p>
            <p className="mt-1 text-label-sm text-outline">
              {state.user?.email}
              {" · máy "}
              <span className="font-mono">{lic.deviceId.slice(0, 16)}…</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-space-sm">
          {lic.status !== "relogin" && lic.status !== "locked" && <Button variant="subtle" disabled={recheck.isPending} onClick={again}>
            {recheck.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {" Kiểm tra lại"}
          </Button>}
          <Button variant="subtle" disabled={pending} onClick={() => void logout()}>
            <LogOut size={14} />
            {" Đăng xuất"}
          </Button>
        </div>
      </div>
      {lic.status === "no_subscription" && <div className="flex flex-col gap-space-md">
        <h2 className="text-label-md uppercase tracking-wider text-on-surface-variant">Chọn gói</h2>
        <div className="grid grid-cols-1 gap-space-md md:grid-cols-3">
          {plans?.map((p) => <PlanCard key={p.id} plan={p} current={false} busy={false} onBuy={() => (setPlanCode(p.code), setBuy(true))} />)}
        </div>
      </div>}
      {(lic.status === "device_limit" || lic.status === "revoked") && <div className="flex flex-col gap-space-sm rounded-2xl border border-outline-variant/30 bg-surface-container-low p-space-lg">
        <h2 className="text-label-md uppercase tracking-wider text-on-surface-variant">Máy đã kích hoạt</h2>
        <p className="text-body-sm text-on-surface-variant">
          Gỡ một máy không dùng nữa rồi kích hoạt máy này, hoặc nâng cấp gói để dùng thêm máy.
        </p>
        <DevicesList maxDevices={lic.maxDevices} />
        <div className="flex flex-wrap gap-space-sm">
          <Button
            variant="primary"
            disabled={activate.isPending}
            onClick={() => activate.mutate(void 0, {
              onSuccess: (v) => v.usable ? toast.success("Đã kích hoạt máy này") : toast.error(v.message ?? "Chưa kích hoạt được"),
              onError: (e) => toast.error(e.message)
            })}
          >
            {activate.isPending ? <LoaderCircle size={14} className="animate-spin" /> : null}
            {" Kích hoạt máy này"}
          </Button>
          <Button variant="subtle" onClick={() => (setPlanCode(null), setBuy(true))}>Nâng cấp gói</Button>
        </div>
      </div>}
      {lic.status === "expired" && <p className="text-body-sm text-on-surface-variant">
        Kết nối Internet rồi bấm “Kiểm tra lại”. Nếu gói đã hết hạn, bạn có thể gia hạn ngay:
      </p>}
      {lic.status === "expired" && <Button variant="primary" className="self-start" onClick={() => setBuy(true)}>Mua / gia hạn gói</Button>}
    </div>
    <BuyPlanDialog
      open={buy}
      onClose={() => {
        setBuy(false);
        setPlanCode(null);
        void refresh();
      }}
      currentPlan={lic.plan}
      planCode={planCode}
    />
  </Frame>;
}
