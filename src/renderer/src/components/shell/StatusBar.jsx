import { useApiQuery } from "../../lib/api";
import { Cpu, MemoryStick, MonitorPlay } from "lucide-react";
import { StatusDot } from "../ui/StatusDot";
import { useSystemStore } from "../../stores/system";
import { Item } from "./NavRail";
import { encoderShort } from "../../lib/media";

export function StatusBar() {
  const stats = useSystemStore((s) => s.stats);
  const { data: media } = useApiQuery("media.status", void 0, { refetchInterval: (q) => q.state.data?.running || q.state.data?.queued ? 1e3 : 5e3 });
  const run = media?.running;
  return <footer className="flex h-statusbar shrink-0 items-center justify-between gap-space-lg border-t border-overlay/[0.06] bg-surface-container-lowest px-space-md font-mono text-[11px] text-on-surface-variant tabular">
    <div className="flex min-w-0 items-center gap-space-lg overflow-hidden">
      <Item title={run ? run.stage ?? "" : "Hàng đợi render"}>
        <StatusDot health={run ? "ok" : "idle"} live={!!run} />
        {run ? `Rendering "${run.topic.slice(0, 28)}${run.topic.length > 28 ? "…" : ""}" ${Math.round(run.progress * 100)}%` : "Render: rảnh"}
        {media?.queued ? ` · chờ ${media.queued}` : ""}
      </Item>
      <Item title="Bộ mã hóa video">
        <MonitorPlay size={13} />
        {media?.encoder ? `Encoder: ${encoderShort[media.encoder]}` : "Encoder: chưa dò"}
      </Item>
    </div>
    <div className="flex shrink-0 items-center gap-space-lg">
      <Item title="Bộ nhớ ứng dụng / tổng RAM">
        <MemoryStick size={13} />
        {"RAM: "}
        {stats ? `${stats.appMemoryMb}MB / ${Math.round(stats.totalMemoryMb / 1024)}GB` : "—"}
      </Item>
      <Item title="CPU toàn hệ thống"><Cpu size={13} />{"CPU: "}{stats ? `${stats.cpu.toFixed(1)}%` : "—"}</Item>
    </div>
  </footer>;
}
