import { useState, useMemo, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call, useApiQuery, useApiMutation } from "../../lib/api";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Download, LoaderCircle, Plus, Send, Zap } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Switch } from "../../components/ui/Switch";
import { Kbd } from "../../components/ui/Kbd";
import { PlatformBadge } from "../../components/PlatformBadge";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { CalendarGrid } from "./CalendarGrid";
import { useSensor, useSensors, PointerSensor, DndContext, DragOverlay } from "@dnd-kit/core";
import { ContentEditor } from "../content/ContentEditor";
import { dayKey, parseDayKey, startOfWeek, addDays, monthGrid, hhmm, atTime } from "./dates";
import { QueueSidebar } from "./QueueSidebar";
import { ScheduleDialog } from "./ScheduleDialog";
import { StaggerControl } from "./StaggerControl";

const INVALIDATES = ["posts.", "content.", "dashboard.", "workspaces."];
const statusLabel = { queued: "Chờ đăng", publishing: "Đang đăng", published: "Đã đăng", failed: "Lỗi", cancelled: "Đã hủy" };

function exportCsv(posts, label) {
  const esc = (v) => `"${v.replace(/"/g, '""')}"`;
  const rows = [
    ["Ngày", "Giờ", "Nền tảng", "Kênh", "Nội dung", "Trạng thái", "Giờ vàng"],
    ...posts.map((p) => [dayKey(p.scheduledAt), hhmm(p.scheduledAt), p.platform, p.channelName, p.contentTitle, statusLabel[p.status], p.isGoldenHour ? "x" : ""])
  ];
  const blob = new Blob(["\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `lich-dang-bai-${label}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
}

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const setWorkspace = useUiStore((s) => s.setActiveWorkspace);
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState("month");
  const [platforms, setPlatforms] = useState(new Set(["facebook", "tiktok", "instagram"]));
  const [selected, setSelected] = useState(new Set());
  const [target, setTarget] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const days = useMemo(() => view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : monthGrid(anchor), [anchor, view]);
  const rangeFrom = view === "list" ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : days[0];
  const rangeTo = view === "list" ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) : addDays(days[days.length - 1], 1);
  const { data: posts = [] } = useApiQuery("posts.range", { from: rangeFrom.getTime(), to: rangeTo.getTime(), workspaceId });
  const { data: queue = [] } = useApiQuery("content.list", { workspaceId, status: ["ready"] });
  const { data: workspaces = [] } = useApiQuery("workspaces.list");
  const { data: channels = [] } = useApiQuery("channels.list", {});
  const { data: worker } = useApiQuery("posts.worker", void 0, { refetchInterval: 5e3 });
  const setWorker = useApiMutation("posts.setWorker", ["posts."]);
  const qc = useQueryClient();
  const lastProcessed = useRef(null);
  useEffect(() => {
    const n = worker?.processed;
    if (n == null) return;
    if (lastProcessed.current != null && n !== lastProcessed.current) {
      const prefixes = ["posts.", "content.", "alerts.", "dashboard.", "accounts.", "channels."];
      void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && prefixes.some((pre) => q.queryKey[0].startsWith(pre)) });
    }
    lastProcessed.current = n;
  }, [worker?.processed, qc]);
  const reschedule = useApiMutation("posts.reschedule", INVALIDATES);
  const auto = useApiMutation("posts.autoSchedule", INVALIDATES);
  const spin = useApiMutation("content.spin", ["content.", "settings."]);
  const runSpin = () => spin.mutate(
    { ids: [...selected], count: 3 },
    {
      onSuccess: (r) => {
        if (r.done) toast.success(`Đã tạo biến thể caption cho ${r.done} bài – xem trong Kho nội dung`);
        for (const f of r.failed.slice(0, 3)) toast.error(f.reason);
      },
      onError: (e) => toast.error(e.message)
    }
  );
  const wsNames = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);
  const visiblePosts = posts.filter((p) => platforms.has(p.platform) && p.status !== "cancelled");
  const highlighted = useMemo(() => new Set((params.get("content") ?? "").split(",").filter(Boolean)), [params]);
  useEffect(() => {
    if (!highlighted.size) return;
    const inQueue = queue.filter((q) => highlighted.has(q.id)).map((q) => q.id);
    if (inQueue.length) setSelected(new Set(inQueue));
  }, [highlighted, queue]);
  useEffect(() => {
    if (highlighted.size !== 1 || queue.some((q) => highlighted.has(q.id))) return;
    const id = [...highlighted][0];
    void call("posts.range", { from: Date.now() - 60 * 864e5, to: Date.now() + 120 * 864e5 }).then((list) => {
      const p = list.find((x) => x.contentItemId === id && x.status !== "cancelled");
      if (p) {
        setAnchor(p.scheduledAt);
        setTarget({ mode: "edit", post: p });
      }
    });
  }, [highlighted, queue]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setEditorOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const onDragStart = ({ active }) => {
    const d = active.data.current;
    setDragging({ label: d?.content?.title ?? d?.post?.contentTitle ?? "" });
  };
  const onDragEnd = ({ active, over }) => {
    setDragging(null);
    if (!over) return;
    const day = parseDayKey(String(over.id).replace("day:", ""));
    const d = active.data.current;
    if (d?.content) {
      setTarget({ mode: "new", content: d.content, day });
    } else if (d?.post) {
      const when = atTime(day, hhmm(d.post.scheduledAt));
      if (dayKey(when) === dayKey(d.post.scheduledAt)) return;
      if (when.getTime() < Date.now()) return void toast.error("Không thể dời bài về thời điểm đã qua");
      reschedule.mutate(
        { id: d.post.id, scheduledAt: when.getTime() },
        {
          onSuccess: (r) => toast.success(
            `Đã dời sang ${day.toLocaleDateString("vi-VN")} ${hhmm(new Date(r.scheduledAt))}${r.scheduledAt !== when.getTime() ? " (lùi vài phút để giãn cách với bài trùng giờ)" : ""}`
          ),
          onError: (e) => toast.error(e.message)
        }
      );
    }
  };
  const runAuto = () => auto.mutate(
    { contentIds: [...selected] },
    {
      onSuccess: (r) => {
        setSelected(new Set());
        if (params.get("content")) setParams({}, { replace: true });
        if (r.created.length) toast.success(`Đã xếp ${r.created.length} bài vào giờ vàng (giãn cách 4 giờ)`);
        for (const s of r.skipped.slice(0, 3)) toast.error(`${queue.find((q) => q.id === s.contentId)?.title ?? "Nội dung"}: ${s.reason}`);
      },
      onError: (e) => toast.error(e.message)
    }
  );
  const togglePlatform = (p) => setPlatforms((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    return next;
  });
  const shift = (dir) => setAnchor((a) => view === "week" ? addDays(a, dir * 7) : new Date(a.getFullYear(), a.getMonth() + dir, 1));
  const title = view === "week" ? `Tuần ${days[0].toLocaleDateString("vi-VN")} – ${days[6].toLocaleDateString("vi-VN")}` : `Tháng ${anchor.getMonth() + 1}, ${anchor.getFullYear()}`;
  const monthPosts = visiblePosts.filter((p) => p.scheduledAt.getMonth() === anchor.getMonth() && p.scheduledAt.getFullYear() === anchor.getFullYear());
  const done = monthPosts.filter((p) => p.status === "published").length;
  const failed = monthPosts.filter((p) => p.status === "failed").length;
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const wsCount = (id) => posts.filter((p) => (id == null || p.workspaceId === id) && p.status !== "cancelled").length;
  return <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
    <div className="grid grid-cols-1 gap-space-md xl:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-space-md">
        <Card className="flex flex-col gap-space-md p-space-md">
          <div className="flex flex-wrap items-center justify-between gap-space-md">
            <div className="flex items-center gap-space-sm">
              <CalendarDays size={20} className="text-secondary" />
              <h1 className="min-w-[180px] text-headline-lg text-on-surface">{title}</h1>
              <Button size="sm" variant="subtle" aria-label="Trước" onClick={() => shift(-1)}>
                <ChevronLeft size={14} />
              </Button>
              <Button size="sm" variant="subtle" aria-label="Sau" onClick={() => shift(1)}>
                <ChevronRight size={14} />
              </Button>
              <Button size="sm" variant="subtle" onClick={() => setAnchor(new Date())}>Hôm nay</Button>
            </div>
            <SegmentedControl
              label="Chế độ xem"
              value={view}
              onChange={setView}
              options={[
                { value: "month", label: "Theo Tháng" },
                { value: "week", label: "Theo Tuần" },
                { value: "list", label: "Danh sách" }
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-space-sm">
            <Button onClick={() => exportCsv(visiblePosts, view === "week" ? dayKey(days[0]) : `${anchor.getFullYear()}-${anchor.getMonth() + 1}`)} disabled={!visiblePosts.length}>
              <Download size={15} />
              {" Xuất lịch CSV"}
            </Button>
            <Button
              variant="secondary"
              disabled={!queue.length || auto.isPending}
              onClick={() => {
                setSelected(new Set(queue.map((q) => q.id)));
                auto.mutate({ contentIds: queue.map((q) => q.id) }, { onSuccess: (r) => (setSelected(new Set()), toast.success(`Đã lấp ${r.created.length}/${queue.length} bài vào giờ vàng`)) });
              }}
              className="text-secondary"
            >
              <Zap size={15} />
              {" Tự động lấp đầy giờ vàng"}
            </Button>
            <Button variant="primary" onClick={() => setEditorOpen(true)}>
              <Plus size={15} />
              {" Tạo bài đăng mới "}
              <Kbd className="bg-black/20 text-on-primary">Ctrl+N</Kbd>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-space-lg gap-y-space-sm rounded-xl bg-surface-container-lowest p-space-sm">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-label-sm uppercase tracking-wider text-outline">Workspace:</span>
              {[{ id: null, name: "Tất cả" }, ...workspaces.map((w) => ({ id: w.id, name: w.name }))].map((w) => <button
                key={w.id ?? "all"}
                type="button"
                onClick={() => setWorkspace(w.id)}
                className={cn("h-7 rounded px-space-sm text-label-md", workspaceId === w.id ? "bg-surface-container-highest text-on-surface" : "text-on-surface-variant hover:text-on-surface")}
              >
                {w.name}
                {" "}
                <span className="font-mono text-[10px] opacity-70">{wsCount(w.id)}</span>
              </button>)}
            </div>
            <div className="flex items-center gap-space-sm">
              <span className="text-label-sm uppercase tracking-wider text-outline">Kênh:</span>
              {["facebook", "tiktok", "instagram"].map((p) => <label key={p} className="flex items-center gap-1 text-label-md text-on-surface-variant">
                <input type="checkbox" checked={platforms.has(p)} onChange={() => togglePlatform(p)} className="h-3.5 w-3.5 accent-primary-container" />
                <PlatformBadge platform={p} />
              </label>)}
            </div>
            <div className="flex items-center gap-space-md text-label-sm text-on-surface-variant">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-success" />
                {" Đã đăng"}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-warning" />
                {" Đã xếp lịch"}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-danger" />
                {" Lỗi / Hết token"}
              </span>
              <span className="flex items-center gap-1"><Zap size={11} className="text-warning" />{" Giờ vàng"}</span>
            </div>
          </div>
        </Card>
        <Card className="p-space-sm">
          {view === "list" ? <table className="w-full text-left text-body-sm">
            <thead className="text-label-sm uppercase tracking-wider text-outline">
              <tr>
                <th className="px-space-sm py-1.5 font-medium">Thời gian</th>
                <th className="px-space-sm py-1.5 font-medium">Kênh</th>
                <th className="px-space-sm py-1.5 font-medium">Nội dung</th>
                <th className="px-space-sm py-1.5 font-medium">Trạng thái</th>
                <th className="px-space-sm py-1.5 text-right font-medium">Tiếp cận / Xem</th>
                <th className="px-space-sm py-1.5 text-right font-medium">Tương tác</th>
              </tr>
            </thead>
            <tbody>
              {visiblePosts.length === 0 && <tr>
                <td colSpan={6} className="p-space-lg text-center text-on-surface-variant">
                  Không có bài nào trong tháng này.
                </td>
              </tr>}
              {visiblePosts.map((p) => <tr key={p.id} onClick={() => setTarget({ mode: "edit", post: p })} className="cursor-pointer border-t border-overlay/[0.04] hover:bg-overlay/[0.03]">
                <td className="whitespace-nowrap px-space-sm py-1.5 font-mono text-code text-on-surface">
                  {p.scheduledAt.toLocaleDateString("vi-VN")}
                  {" "}
                  {hhmm(p.scheduledAt)}
                  {" "}
                  {p.isGoldenHour && <Zap size={10} className="inline text-warning" />}
                </td>
                <td className="px-space-sm py-1.5">
                  <span className="flex items-center gap-space-sm">
                    <PlatformBadge platform={p.platform} />
                    {" "}
                    <span className="truncate text-on-surface">{p.channelName}</span>
                  </span>
                </td>
                <td className="max-w-[360px] truncate px-space-sm py-1.5 text-on-surface">{p.contentTitle}</td>
                <td className="px-space-sm py-1.5">
                  <Badge tone={p.status === "published" ? "success" : p.status === "failed" ? "danger" : "warning"}>
                    {statusLabel[p.status]}
                  </Badge>
                </td>
                <td className="px-space-sm py-1.5 text-right font-mono text-code text-on-surface-variant">
                  {p.reach ?? p.views ?? "—"}
                </td>
                <td className="px-space-sm py-1.5 text-right font-mono text-code text-on-surface">
                  {p.engagements ?? "—"}
                </td>
              </tr>)}
            </tbody>
          </table> : <CalendarGrid
            days={days}
            anchorMonth={view === "month" ? anchor.getMonth() : -1}
            posts={visiblePosts}
            tall={view === "week"}
            onOpenPost={(p) => setTarget({ mode: "edit", post: p })}
            onAdd={(day) => {
              if (!queue.length) return void toast.info('Hàng chờ trống – thêm nội dung "Sẵn sàng đăng" trước');
              const picked = selected.size === 1 ? queue.find((q) => selected.has(q.id)) ?? null : null;
              setTarget({ mode: "new", content: picked, day });
            }}
          />}
          <div className="mt-space-sm flex flex-wrap items-center gap-x-space-xl gap-y-1 border-t border-overlay/[0.06] px-space-sm pt-space-sm font-mono text-code">
            <span className="text-on-surface-variant">
              {"Tổng bài trong tháng: "}
              <span className="text-on-surface">{monthPosts.length}{" posts"}</span>
            </span>
            <span className="text-on-surface-variant">
              {"Tỷ lệ thành công: "}
              <span className="text-tertiary">
                {done + failed ? `${(done / (done + failed) * 100).toFixed(1)}%` : "—"}
              </span>
            </span>
            <span className="text-on-surface-variant">
              {"Trung bình: "}
              <span className="text-on-surface">{(monthPosts.length / daysInMonth).toFixed(1)}{" bài/ngày"}</span>
            </span>
            <StaggerControl />
            <span className="ml-auto flex items-center gap-space-sm text-on-surface-variant">
              {worker?.running ? <span className="flex items-center gap-1 text-secondary">
                <LoaderCircle size={12} className="animate-spin" />
                {" "}
                {worker.running.stage}
              </span> : worker?.enabled ? <span className="flex items-center gap-1">
                <Send size={12} className="text-tertiary" />
                {worker.due ? `${worker.due} bài đang chờ đăng` : worker.nextAt ? `Bài kế tiếp ${worker.nextAt.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}` : "Không có bài chờ"}
              </span> : <span className="text-warning">Tự động đăng đang tắt</span>}
              <Switch
                label="Tự động đăng bài"
                checked={worker?.enabled ?? true}
                disabled={!worker || setWorker.isPending}
                onChange={(enabled) => setWorker.mutate({ enabled }, { onSuccess: () => toast.info(enabled ? "Đã bật tự động đăng bài" : "Đã tạm dừng tự động đăng – bài tới giờ sẽ chờ") })}
              />
              <span>Tự động đăng</span>
            </span>
          </div>
        </Card>
      </div>
      <div className="xl:sticky xl:top-0 xl:h-[calc(100vh-2.5rem-1.75rem-1.5rem)]">
        <QueueSidebar
          items={queue}
          workspaceNames={wsNames}
          selected={selected}
          highlighted={highlighted}
          onToggle={(id) => setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
          onToggleAll={() => setSelected((prev) => queue.every((q) => prev.has(q.id)) ? new Set() : new Set(queue.map((q) => q.id)))}
          onAutoSchedule={runAuto}
          autoPending={auto.isPending}
          onSpin={runSpin}
          spinPending={spin.isPending}
        />
      </div>
    </div>
    <DragOverlay dropAnimation={null}>
      {dragging && <div className="max-w-[240px] truncate rounded-lg bg-surface-container-high px-space-sm py-1 text-label-md text-on-surface shadow-flyout">
        {dragging.label}
      </div>}
    </DragOverlay>
    <ScheduleDialog target={target} queue={queue} channels={channels} workspaces={workspaces} onClose={() => setTarget(null)} />
    <ContentEditor open={editorOpen} item={null} workspaces={workspaces} defaultWorkspaceId={workspaceId} onClose={() => setEditorOpen(false)} />
  </DndContext>;
}
