import { useApiQuery, useApiMutation } from "../../lib/api";
import { LoaderCircle, Zap } from "lucide-react";
import { cn } from "../../lib/cn";
import { toast } from "../ui/toast";
import { formatRelative } from "../../lib/format";

export const FLOW_CREDITS_LOW = 100;
export const formatCredits = (n) => n.toLocaleString("vi-VN");

export function FlowCredits() {
  const { data: s } = useApiQuery("flow.status", void 0, { refetchInterval: 3e4, refetchOnWindowFocus: true });
  const refresh = useApiMutation("flow.refreshCredits", ["flow."]);
  if (!s || s.source !== "flow" || !s.loggedIn) return null;
  const low = s.credits !== null && s.credits < FLOW_CREDITS_LOW;
  const run = () => {
    if (s.busy) return void toast.info("Đang tạo video bằng Flow – số credit tự cập nhật sau mỗi video");
    refresh.mutate(void 0, {
      onSuccess: (r) => r.credits !== null ? toast.success(`Google Flow còn ${formatCredits(r.credits)} credit`) : toast.error("Chưa đọc được số credit trên Google Flow"),
      onError: (e) => toast.error(e.message)
    });
  };
  return <button
    type="button"
    onClick={run}
    disabled={refresh.isPending}
    title={[
      `Credit Google Flow còn lại${s.email ? ` (${s.email})` : ""}${s.tier ? ` – gói ${s.tier}` : ""}`,
      s.creditsAt ? `Cập nhật ${formatRelative(s.creditsAt)} · bấm để đọc lại` : "Bấm để đọc số credit từ Google Flow"
    ].join("\n")}
    className={cn(
      "flex h-7 items-center gap-1 rounded-full px-space-sm text-label-sm transition-colors hover:bg-surface-container",
      low ? "bg-warning/15 text-warning" : "bg-surface-container-low text-on-surface-variant"
    )}
  >
    {refresh.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <Zap size={13} className={low ? void 0 : "text-secondary"} />}
    <span className="font-mono tabular-nums text-on-surface">
      {s.credits !== null ? formatCredits(s.credits) : "—"}
    </span>
    <span>credit Flow</span>
  </button>;
}
