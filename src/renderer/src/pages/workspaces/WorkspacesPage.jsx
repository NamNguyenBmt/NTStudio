import { useState, useEffect } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Clapperboard, CloudDownload, Plus, Users, Wallet } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { confirmDialog } from "../../components/ui/confirm";
import { Kbd } from "../../components/ui/Kbd";
import { Progress } from "../../components/ui/Progress";
import { useUiStore } from "../../stores/ui";
import { PocketCard } from "./PocketCard";
import { RulesPanel } from "./RulesPanel";
import { CreateDialog } from "./CreateDialog";

function Kpi({ label, value, sub, icon: Icon, children }) {
  return <Card className="flex items-center justify-between gap-space-md bg-surface-container p-space-md">
    <div className="min-w-0 flex-1">
      <div className="text-label-md text-on-surface-variant">{label}</div>
      <div className="text-headline-lg tabular text-on-surface">{value}</div>
      {sub && <div className="text-label-sm">{sub}</div>}
      {children}
    </div>
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container-highest text-secondary">
      <Icon size={20} />
    </div>
  </Card>;
}

export function WorkspacesPage() {
  const navigate = useNavigate();
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId);
  const setActive = useUiStore((s) => s.setActiveWorkspace);
  const { data: workspaces = [], isLoading } = useApiQuery("workspaces.list");
  const archive = useApiMutation("workspaces.archive", ["workspaces.", "dashboard."]);
  const exportCfg = useApiMutation("workspaces.export");
  const [selectedId, setSelectedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    if (!workspaces.some((w) => w.id === selectedId)) setSelectedId(activeWorkspaceId ?? workspaces[0]?.id ?? null);
  }, [workspaces, selectedId, activeWorkspaceId]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setCreateOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const selected = workspaces.find((w) => w.id === selectedId);
  const totals = workspaces.reduce(
    (a, w) => ({
      channels: a.channels + w.channelCount,
      unhealthy: a.unhealthy + w.unhealthyChannels,
      postsPerDay: a.postsPerDay + (w.postsPerDay ?? 0),
      content: a.content + w.contentReady,
      spent: a.spent + w.aiSpentUsd,
      budget: a.budget + (w.aiBudgetUsd ?? 0)
    }),
    { channels: 0, unhealthy: 0, postsPerDay: 0, content: 0, spent: 0, budget: 0 }
  );
  return <div className="flex flex-col gap-space-lg">
    <div className="flex flex-wrap items-end justify-between gap-space-md">
      <div className="max-w-3xl">
        <div className="text-label-md uppercase tracking-wider text-secondary">
          {"Phân luồng độc lập · "}
          <span className="normal-case text-tertiary">{workspaces.length}{" Pockets đang quản trị"}</span>
        </div>
        <h1 className="text-display text-on-surface">Không gian làm việc (Workspaces / Pockets)</h1>
        <p className="text-body-md text-on-surface-variant">
          Phân vùng tài nguyên, dàn tài khoản, kịch bản nội dung và lịch đăng theo từng ngách kinh doanh riêng biệt.
        </p>
      </div>
      <div className="flex gap-space-sm">
        <Button
          disabled={exportCfg.isPending}
          onClick={() => exportCfg.mutate(void 0)}
          title={exportCfg.data ? `Đã lưu: ${exportCfg.data.path}` : "Xuất cấu hình (không gồm cookie/token/mật khẩu)"}
        >
          <CloudDownload size={15} />
          {" "}
          {exportCfg.data ? "Đã xuất cấu hình" : "Sao lưu & Xuất cấu hình"}
        </Button>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus size={15} />
          {" Tạo Không gian mới "}
          <Kbd className="bg-black/20 text-on-primary">Ctrl+N</Kbd>
        </Button>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-space-md xl:grid-cols-4">
      <Kpi label="Tổng kênh liên kết" value={`${totals.channels} Kênh`} icon={Users} sub={<span className={totals.unhealthy ? "text-error" : "text-tertiary"}>
        {totals.channels - totals.unhealthy}
        {" đồng bộ tốt"}
      </span>} />
      <Kpi label="Tần suất đăng" value={`${Math.round(totals.postsPerDay * 10) / 10} bài / ngày`} icon={CalendarClock} sub={<span className="text-outline">Trung bình 7 ngày tới</span>} />
      <Kpi label="Kho media sẵn sàng" value={`${totals.content} Bài & Video`} icon={Clapperboard} sub={<span className="text-outline">Sẵn sàng hoặc đã lên lịch</span>} />
      <Kpi label="Ngân sách AI tháng" value={`$${totals.spent.toFixed(0)} / $${totals.budget.toFixed(0)}`} icon={Wallet}>
        <Progress value={totals.budget ? totals.spent / totals.budget * 100 : 0} className="mt-1.5" />
      </Kpi>
    </div>
    <div className="grid grid-cols-1 items-start gap-space-md xl:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-space-md">
        <div className="flex items-center gap-space-sm">
          <span className="text-label-md uppercase tracking-wider text-on-surface-variant">Danh mục Pockets</span>
          <Badge tone="secondary">{workspaces.length}{" Ngách"}</Badge>
        </div>
        {isLoading && <Card className="h-72 animate-pulse" />}
        <div className="grid grid-cols-1 gap-space-md lg:grid-cols-2">
          {workspaces.map((ws, i) => <PocketCard
            key={ws.id}
            ws={ws}
            index={i}
            selected={ws.id === selectedId}
            onConfigure={() => setSelectedId(ws.id)}
            onEnter={() => {
              setActive(ws.id);
              navigate("/accounts");
            }}
            onArchive={() => {
              void confirmDialog({ title: "Lưu trữ Pocket", message: `Lưu trữ Pocket "${ws.name}"? Tài khoản và kênh vẫn được giữ lại.`, confirmLabel: "Lưu trữ" }).then(
                (ok) => ok && archive.mutate({ id: ws.id })
              );
            }}
          />)}
        </div>
      </div>
      <div className="xl:sticky xl:top-0">
        {selected ? <RulesPanel ws={selected} /> : <Card className="p-space-lg text-body-sm text-on-surface-variant">Chọn một Pocket để cấu hình.</Card>}
      </div>
    </div>
    <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={setSelectedId} />
  </div>;
}
