import { useState, useRef, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call, useApiQuery, useApiMutation } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  Gauge,
  HardDrive,
  LayoutGrid,
  List,
  LoaderCircle,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash,
  Upload,
  WandSparkles,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { AnimatePresence, motion } from "framer-motion";
import { confirmDialog } from "../../components/ui/confirm";
import { Input, Select } from "../../components/ui/Input";
import { Kbd } from "../../components/ui/Kbd";
import { Progress } from "../../components/ui/Progress";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { formatOf, formatBytes } from "./VariantsPanel";
import { ContentEditor } from "./ContentEditor";
import { ContentCard } from "./ContentCard";

const STATUS_OPTIONS = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "draft", label: "Bản nháp" },
  { value: "ready", label: "Sẵn sàng đăng" },
  { value: "scheduled", label: "Đã lên lịch" },
  { value: "published", label: "Đã đăng" },
  { value: "failed", label: "Đăng lỗi" },
];

function Kpi({ icon: Icon, label, value, unit, aside }) {
  return (
    <Card className="flex items-center gap-space-md bg-surface-container p-space-md">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-container-highest text-secondary">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-label-sm uppercase tracking-wider text-outline">{label}</div>
        <div className="flex items-baseline gap-1">
          <span className="text-headline-lg tabular text-on-surface">{value}</span>
          <span className="text-body-sm text-on-surface-variant">{unit}</span>
        </div>
      </div>
      {aside}
    </Card>
  );
}

export function ContentPage() {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const setWorkspace = useUiStore((s) => s.setActiveWorkspace);
  const [status, setStatus] = useState("");
  const [format, setFormat] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [layout, setLayout] = useState("grid");
  const [selected, setSelected] = useState(new Set());
  const [editor, setEditor] = useState({ open: false, item: null });
  const searchRef = useRef(null);
  const { data: items = [], isLoading } = useApiQuery("content.list", {
    workspaceId,
    status: status ? [status] : void 0,
    search: query.trim() || void 0,
  });
  const { data: stats } = useApiQuery("content.stats", { workspaceId });
  const { data: workspaces = [] } = useApiQuery("workspaces.list");
  const { data: storage } = useApiQuery("system.storage");
  const move = useApiMutation("content.bulkMove", ["content.", "workspaces."]);
  const remove = useApiMutation("content.bulkDelete", ["content.", "workspaces.", "posts.", "dashboard."]);
  const spin = useApiMutation("content.spin", ["content.", "settings.", "dashboard."]);
  const cleanup = useApiMutation("media.cleanup", ["system."]);
  const tags = useApiMutation("content.hashtags", ["content.", "settings.", "dashboard."]);
  const qc = useQueryClient();
  const reportBulk = (label, r) => {
    if (r.done) toast.success(`${label}: ${r.done} nội dung`);
    for (const f of r.failed.slice(0, 3))
      toast.error(`${items.find((i) => i.id === f.id)?.title ?? "Nội dung"}: ${f.reason}`);
  };
  const runSpin = (ids) => {
    if (!ids.length) return void toast.info("Chọn nội dung cần Spin (tick ô ở góc thẻ)");
    spin.mutate(
      { ids, count: 3 },
      { onSuccess: (r) => reportBulk("Đã tạo 3 biến thể caption", r), onError: (e) => toast.error(e.message) },
    );
  };
  const [hookRun, setHookRun] = useState(null);
  const runHooks = async (ids) => {
    if (hookRun) return;
    setHookRun({ done: 0, total: ids.length });
    const scores = [];
    let failed = 0;
    for (const [i, id] of ids.entries()) {
      try {
        scores.push((await call("content.hookScore", { id })).score.score);
      } catch (e) {
        failed++;
        if (failed <= 2)
          toast.error(
            `${items.find((x) => x.id === id)?.title ?? "Nội dung"}: ${e instanceof Error ? e.message : String(e)}`,
          );
      }
      setHookRun({ done: i + 1, total: ids.length });
    }
    setHookRun(null);
    void qc.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("content."),
    });
    if (scores.length) {
      const weak = scores.filter((s) => s < 55).length;
      toast.success(
        `Đã chấm Hook ${scores.length} bài · trung bình ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}${weak ? ` · ${weak} bài hook yếu` : ""}`,
      );
    }
  };
  const runTags = (ids) =>
    tags.mutate({ ids }, { onSuccess: (r) => reportBulk("Đã đổi hashtag", r), onError: (e) => toast.error(e.message) });
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (k === "n") {
        e.preventDefault();
        setEditor({ open: true, item: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const wsName = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);
  const visible = useMemo(() => {
    const list = items.filter((c) => format === "all" || formatOf(c.kind) === format);
    return [...list].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "vi")
        : sort === "oldest"
          ? +a.createdAt - +b.createdAt
          : +b.createdAt - +a.createdAt,
    );
  }, [items, format, sort]);
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(visible.map((v) => v.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = visible.length > 0 && visible.every((v) => selected.has(v.id));
  const confirmDelete = (ids) => {
    const scheduled = visible.filter((v) => ids.includes(v.id) && v.status === "scheduled").length;
    const msg = `Xóa ${ids.length} nội dung?${scheduled ? ` ${scheduled} bài đã lên lịch cũng sẽ bị hủy.` : ""} Không hoàn tác được.`;
    void confirmDialog({ title: "Xóa nội dung", message: msg, confirmLabel: "Xóa", danger: true }).then(
      (ok) => ok && remove.mutate({ ids }, { onSuccess: () => setSelected(new Set()) }),
    );
  };
  const formatChips = [
    { value: "all", label: "Tất cả", n: stats?.total ?? 0 },
    { value: "video", label: "Video / Reels", n: (stats?.byKind.video ?? 0) + (stats?.byKind.reel ?? 0) },
    { value: "visual", label: "Ảnh / Carousel", n: (stats?.byKind.image ?? 0) + (stats?.byKind.carousel ?? 0) },
    { value: "text", label: "Spin văn bản", n: stats?.byKind.text ?? 0 },
  ];
  const wsCount = (id) => stats?.byWorkspace.find((b) => b.workspaceId === id)?.n ?? 0;
  const allCount = stats?.byWorkspace.reduce((a, b) => a + b.n, 0) ?? 0;
  const diskPct = storage?.diskTotalBytes
    ? ((storage.diskTotalBytes - (storage.diskFreeBytes ?? 0)) / storage.diskTotalBytes) * 100
    : 0;
  return (
    <div className="flex flex-col gap-space-lg">
      <div className="grid grid-cols-2 gap-space-md xl:grid-cols-4">
        <Kpi
          icon={Archive}
          label="Tổng tài nguyên"
          value={stats?.total ?? "–"}
          unit="nội dung"
          aside={
            stats?.addedToday ? (
              <Badge tone="success">
                +{stats.addedToday}
                {" hôm nay"}
              </Badge>
            ) : null
          }
        />
        <Kpi
          icon={Sparkles}
          label="Nội dung đã Spin AI"
          value={stats?.spun ?? "–"}
          unit={`bài · ${stats?.spinVariants ?? 0} biến thể`}
        />
        <Kpi
          icon={Send}
          label="Sẵn sàng xuất bản"
          value={stats?.ready ?? "–"}
          unit="bài đăng"
          aside={
            stats?.idleChannels ? (
              <Badge tone="warning">
                {stats.idleChannels}
                {" kênh chờ"}
              </Badge>
            ) : null
          }
        />
        <Card className="flex flex-col justify-center gap-space-sm bg-surface-container p-space-md">
          <div className="flex items-center justify-between gap-space-sm">
            <span className="flex items-center gap-1.5 text-label-md text-on-surface">
              <HardDrive size={15} className="text-secondary" />
              {" Thư mục media"}
            </span>
            <span className="font-mono text-code text-on-surface-variant">
              {storage ? formatBytes(storage.usedBytes) : "–"}
            </span>
          </div>
          <Progress value={diskPct} />
          <div className="flex justify-between text-label-sm text-outline">
            <span>
              {"Ổ đĩa đã dùng "}
              {diskPct.toFixed(0)}
              {"% · trống "}
              {storage?.diskFreeBytes != null ? formatBytes(storage.diskFreeBytes) : "—"}
            </span>
            <button
              type="button"
              title={`Xóa file tạm của job cũ & cache media không dùng > 30 ngày (${storage?.mediaDir ?? ""})`}
              disabled={cleanup.isPending}
              onClick={() =>
                cleanup.mutate(void 0, {
                  onSuccess: (r) =>
                    toast.success(
                      r.files
                        ? `Đã dọn ${r.files} file, giải phóng ${formatBytes(r.freedBytes)}`
                        : "Không có gì cần dọn",
                    ),
                })
              }
              className="text-primary hover:underline disabled:opacity-50"
            >
              Dọn rác
            </button>
          </div>
        </Card>
      </div>
      <Card className="flex flex-col gap-space-md p-space-md">
        <div className="flex flex-wrap items-center gap-space-sm">
          <div className="relative min-w-[260px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tiêu đề…"
              className="h-9 pl-8 pr-16"
              aria-label="Tìm nội dung"
            />
            <Kbd className="absolute right-2 top-1/2 -translate-y-1/2">Ctrl+F</Kbd>
          </div>
          <Button variant="primary" onClick={() => setEditor({ open: true, item: null })}>
            <Plus size={15} />
            {" Thêm nội dung"}
          </Button>
          <Button disabled={true} title="Nhập hàng loạt video/ảnh, tạo thumbnail bằng FFmpeg – có ở P4">
            <Upload size={15} />
            {" Tải lên hàng loạt"}
          </Button>
          <Button
            disabled={spin.isPending}
            onClick={() => runSpin([...selected])}
            title="Sinh 3 biến thể caption + hashtag cho mỗi nội dung đã chọn"
          >
            {spin.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <WandSparkles size={15} />}
            {" AI Spin hàng loạt"}
            {selected.size ? ` (${selected.size})` : ""}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex flex-col gap-space-sm">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-label-md text-on-surface-variant">Không gian:</span>
              {[
                { id: null, name: "Tất cả", n: allCount },
                ...workspaces.map((w) => ({ id: w.id, name: w.name, n: wsCount(w.id) })),
              ].map((w) => (
                <button
                  key={w.id ?? "all"}
                  type="button"
                  onClick={() => setWorkspace(w.id)}
                  className={cn(
                    "h-7 rounded px-space-sm text-label-md transition-colors",
                    workspaceId === w.id
                      ? "bg-primary-container text-on-primary"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                  )}
                >
                  {w.name} <span className="font-mono text-[10px] opacity-70">({w.n})</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-label-md text-on-surface-variant">Định dạng:</span>
              {formatChips.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFormat(f.value)}
                  className={cn(
                    "h-7 rounded px-space-sm text-label-md transition-colors",
                    format === f.value
                      ? "bg-surface-container-highest text-on-surface"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                  )}
                >
                  {f.label} <span className="font-mono text-[10px] opacity-70">({f.n})</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-space-sm">
            <div className="w-44">
              <Select aria-label="Lọc trạng thái" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex rounded-lg bg-surface-container-lowest p-0.5">
              {["grid", "list"].map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-label={l === "grid" ? "Dạng lưới" : "Dạng danh sách"}
                  aria-pressed={layout === l}
                  onClick={() => setLayout(l)}
                  className={cn(
                    "flex h-7 w-8 items-center justify-center rounded",
                    layout === l ? "bg-surface-container-high text-on-surface" : "text-on-surface-variant",
                  )}
                >
                  {l === "grid" ? <LayoutGrid size={15} /> : <List size={15} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <label className="flex items-center gap-space-sm text-body-sm text-on-surface">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((v) => v.id)))}
            className="h-4 w-4 accent-primary-container"
          />
          {"Chọn tất cả "}
          {visible.length}
          {" nội dung"}
        </label>
        <label className="flex items-center gap-space-sm text-body-sm text-on-surface-variant">
          Sắp xếp theo:
          <div className="w-48">
            <Select aria-label="Sắp xếp" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">Thời gian tạo (Mới nhất)</option>
              <option value="oldest">Thời gian tạo (Cũ nhất)</option>
              <option value="title">Tiêu đề (A → Z)</option>
            </Select>
          </div>
        </label>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-space-md">
          {[0, 1, 2, 3, 4].map((i) => (
            <Card key={i} className="h-[420px] animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card className="p-space-xl text-center text-body-sm text-on-surface-variant">
          Không có nội dung phù hợp bộ lọc.
        </Card>
      ) : layout === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-space-md">
          {visible.map((c) => (
            <ContentCard
              key={c.id}
              item={c}
              layout="grid"
              workspaceName={c.workspaceId ? (wsName.get(c.workspaceId) ?? null) : null}
              selected={selected.has(c.id)}
              onToggle={() => toggle(c.id)}
              onEdit={() => setEditor({ open: true, item: c })}
              onSchedule={() => navigate(`/calendar?content=${c.id}`)}
              onDelete={() => confirmDelete([c.id])}
            />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-space-sm">
          {visible.map((c) => (
            <ContentCard
              key={c.id}
              item={c}
              layout="list"
              workspaceName={c.workspaceId ? (wsName.get(c.workspaceId) ?? null) : null}
              selected={selected.has(c.id)}
              onToggle={() => toggle(c.id)}
              onEdit={() => setEditor({ open: true, item: c })}
              onSchedule={() => navigate(`/calendar?content=${c.id}`)}
              onDelete={() => confirmDelete([c.id])}
            />
          ))}
        </ul>
      )}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="sticky bottom-space-md z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-space-sm rounded-2xl bg-surface-container-high p-space-sm pl-space-md shadow-modal"
          >
            <span className="h-2 w-2 rounded-full bg-secondary" />
            <span className="whitespace-nowrap text-headline-sm text-on-surface">
              {"Đã chọn "}
              {selected.size}
              {" nội dung"}
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-space-sm text-label-md text-on-surface-variant underline hover:text-on-surface"
            >
              Bỏ chọn
            </button>
            <Button variant="primary" onClick={() => navigate(`/calendar?content=${[...selected].join(",")}`)}>
              <Send size={14} />
              {" Lập lịch giờ vàng"}
            </Button>
            <Button
              disabled={!!hookRun}
              onClick={() => void runHooks([...selected])}
              title={"AI chấm điểm câu mở đầu của từng bài (mở bài để xem chi tiết & câu gợi ý)"}
            >
              {hookRun ? <LoaderCircle size={14} className="animate-spin" /> : <Gauge size={14} />}{" "}
              {hookRun ? `Đang chấm ${hookRun.done}/${hookRun.total}` : "Chấm Hook"}
            </Button>
            <Button
              disabled={tags.isPending}
              onClick={() => runTags([...selected])}
              title="Thay hashtag bằng bộ hashtag AI đề xuất"
            >
              {tags.isPending ? <LoaderCircle size={14} className="animate-spin" /> : "#"}
              {" Đổi Hashtag AI"}
            </Button>
            <div className="w-44">
              <Select
                aria-label="Chuyển sang Pocket"
                value=""
                disabled={move.isPending}
                onChange={(e) => {
                  if (e.target.value === "") return;
                  move.mutate(
                    { ids: [...selected], workspaceId: e.target.value === "__none" ? null : e.target.value },
                    { onSuccess: () => setSelected(new Set()) },
                  );
                }}
              >
                <option value="">Chuyển Workspace…</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
                <option value="__none">— Bỏ phân Pocket —</option>
              </Select>
            </div>
            <Button
              variant="danger"
              aria-label="Xóa các mục đã chọn"
              disabled={remove.isPending}
              onClick={() => confirmDelete([...selected])}
            >
              <Trash size={14} />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <ContentEditor
        open={editor.open}
        item={editor.item}
        workspaces={workspaces}
        defaultWorkspaceId={workspaceId}
        onClose={() => setEditor({ open: false, item: null })}
      />
    </div>
  );
}
