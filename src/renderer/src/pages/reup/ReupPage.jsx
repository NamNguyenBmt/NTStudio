import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleCheck, Download, ExternalLink, FolderOpen, FolderPlus, Play, RefreshCw, Repeat2, Send, TriangleAlert, Wand2, X } from "lucide-react";
import { call, useApiMutation, useApiQuery } from "../../lib/api";
import { formatRelative } from "../../lib/format";
import { cn } from "../../lib/cn";
import { useUiStore } from "../../stores/ui";
import { PageHeader } from "../../components/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Progress } from "../../components/ui/Progress";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { toast } from "../../components/ui/toast";

const MB = 1024 ** 2;
const size = (b) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / MB))} MB`;
const openUrl = (url) => call("system.openExternal", { url }).catch((e) => toast.error(e.message));

const FEATURES = [
  "Tải hàng loạt video Douyin, TikTok, YouTube, Facebook…",
  "Nhận dạng giọng nói, dịch phụ đề (HY-MT2 chạy máy hoặc Gemini)",
  "Lồng tiếng VieNeu / OmniVoice / Edge TTS, nhân bản giọng, nhiều người nói",
  "Che phụ đề gốc bằng vá nền hoặc làm mờ, chuẩn hóa 9:16 cho TikTok/Shorts",
  "Xuất / nhập SRT cho CapCut, chế độ Tự động – Hàng loạt – Thủ công"
];

function InstallCard({ status }) {
  const { data: latest } = useApiQuery("reup.latest", void 0, { staleTime: 30 * 6e4, retry: false });
  const install = useApiMutation("reup.install", ["reup."]);
  const launch = useApiMutation("reup.launch");
  const pickExe = useApiMutation("reup.pickExe", ["reup."]);
  const dl = status.download;
  const busy = dl.state === "downloading";
  const outdated = status.installed && latest?.version && status.version && latest.version !== status.version;

  return <Card>
    <CardHeader
      icon={Wand2}
      title="HaizFlow"
      subtitle="Ứng dụng reup miễn phí của tác giả Mạch Hồng Hải – NT Studio mở bản chính thức và gom video thành phẩm về đây"
      actions={status.installed ? <Badge tone="success" pill={true}><CircleCheck size={12} /> Đã cài {status.version ? `v${status.version}` : ""}</Badge> : <Badge tone="warning" pill={true}>Chưa cài</Badge>}
    />
    <div className="flex flex-col gap-space-md p-space-md pt-0">
      <ul className="grid gap-1 text-body-sm text-on-surface-variant md:grid-cols-2">
        {FEATURES.map((f) => <li key={f} className="flex gap-space-sm"><span className="text-secondary">•</span>{f}</li>)}
      </ul>

      {busy && <div className="flex flex-col gap-1">
        <div className="flex justify-between text-label-sm text-on-surface-variant">
          <span>Đang tải bộ cài HaizFlow {dl.version ? `v${dl.version}` : ""}</span>
          <span className="font-mono tabular">{size(dl.received)} / {size(dl.total)}</span>
        </div>
        <Progress value={dl.total ? dl.received / dl.total * 100 : 0} />
      </div>}
      {dl.state === "installing" && <p className="text-body-sm text-secondary">Đã mở trình cài đặt HaizFlow – làm theo hướng dẫn trên cửa sổ cài đặt.</p>}
      {dl.state === "error" && <p className="text-body-sm text-error">{dl.error}</p>}
      {outdated && <p className="text-body-sm text-warning">Có bản mới v{latest.version} – mở HaizFlow để cập nhật ngay trong app (hỗ trợ từ 0.1.8 trở lên).</p>}

      <div className="flex flex-wrap gap-space-sm">
        {status.installed
          ? <Button variant="primary" onClick={() => launch.mutate(void 0, { onSuccess: () => toast.success("Đang mở HaizFlow…"), onError: (e) => toast.error(e.message) })}>
            <Play size={15} /> Mở HaizFlow
          </Button>
          : <Button variant="primary" disabled={busy || install.isPending} onClick={() => install.mutate(void 0, { onError: (e) => toast.error(e.message) })}>
            <Download size={15} /> {busy ? "Đang tải…" : `Tải & cài HaizFlow${latest?.version ? ` v${latest.version}` : ""}`}
          </Button>}
        {!status.installed && <Button variant="subtle" onClick={() => pickExe.mutate(void 0, { onError: (e) => toast.error(e.message) })}>
          <FolderOpen size={15} /> Đã cài ở chỗ khác…
        </Button>}
        <Button variant="subtle" onClick={() => openUrl(status.site)}><ExternalLink size={15} /> Trang chủ</Button>
        <Button variant="subtle" onClick={() => openUrl(status.repo)}><ExternalLink size={15} /> GitHub (cho tác giả 1 sao)</Button>
      </div>

      {!status.installed && <div className="flex gap-space-sm rounded-lg bg-warning/10 p-space-sm text-body-sm text-on-surface">
        <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" />
        <div>Bộ cài ~200 MB, lấy trực tiếp từ GitHub Releases của tác giả và được kiểm SHA-256. Nếu Windows chặn, hãy tắt Smart App Control. Gói AI (CPU/GPU) tải thêm trong HaizFlow.</div>
      </div>}
    </div>
  </Card>;
}

function FoldersCard({ folders }) {
  const add = useApiMutation("reup.addFolder", ["reup."]);
  const remove = useApiMutation("reup.removeFolder", ["reup."]);
  return <Card>
    <CardHeader
      icon={FolderOpen}
      title="Thư mục theo dõi"
      subtitle="Video .mp4 trong các thư mục này hiện ở danh sách thành phẩm"
      actions={<Button size="sm" variant="subtle" onClick={() => add.mutate()}><FolderPlus size={14} /> Thêm thư mục</Button>}
    />
    <div className="flex flex-col gap-1 p-space-md pt-0">
      {folders.length === 0 && <p className="text-body-sm text-on-surface-variant">Chưa có thư mục – xuất một video trong HaizFlow hoặc thêm thư mục thủ công.</p>}
      {folders.map((f) => <div key={f.path} className="flex items-center gap-space-sm rounded-lg bg-surface-container px-space-sm py-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-label-sm text-on-surface-variant">{f.label}</div>
          <div className="truncate font-mono text-body-sm text-on-surface" title={f.path}>{f.path}</div>
        </div>
        <Button size="sm" variant="subtle" onClick={() => call("reup.reveal", { path: f.path })}><FolderOpen size={13} /></Button>
        {!f.auto && <Button size="sm" variant="subtle" onClick={() => remove.mutate({ path: f.path })}><X size={13} /></Button>}
      </div>)}
    </div>
  </Card>;
}

function OutputsCard() {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: outputs = [], isFetching, refetch } = useApiQuery("reup.outputs", void 0, { refetchInterval: 15e3 });
  const doImport = useApiMutation("reup.import", ["reup.", "content."]);
  const [selected, setSelected] = useState(() => new Set());
  const [aspect, setAspect] = useState("9:16");
  const pending = outputs.filter((o) => !o.contentId);
  const toggle = (p) => setSelected((s) => {
    const n = new Set(s);
    n.has(p) ? n.delete(p) : n.add(p);
    return n;
  });
  const submit = () => doImport.mutate({ paths: [...selected], workspaceId: workspaceId ?? null, aspect }, {
    onSuccess: (r) => {
      setSelected(new Set());
      toast.success(`Đã đưa ${r.created.length} video vào Kho nội dung`);
    },
    onError: (e) => toast.error(e.message)
  });

  return <Card className="flex min-h-0 flex-1 flex-col">
    <CardHeader
      icon={Repeat2}
      title="Video thành phẩm"
      subtitle={`${outputs.length} video · ${pending.length} chưa đưa vào Kho nội dung`}
      actions={<>
        <Button size="sm" variant="subtle" onClick={() => refetch()}><RefreshCw size={13} className={cn(isFetching && "animate-spin")} /></Button>
        <Button size="sm" variant="subtle" disabled={!pending.length} onClick={() => setSelected(new Set(pending.map((o) => o.path)))}>Chọn tất cả mới</Button>
      </>}
    />
    <div className="min-h-0 flex-1 overflow-y-auto px-space-md">
      {outputs.length === 0 && <p className="py-space-lg text-center text-body-sm text-on-surface-variant">Chưa thấy video nào. Reup trong HaizFlow rồi bấm Xuất video – thành phẩm sẽ tự hiện ở đây.</p>}
      {outputs.map((o) => <label key={o.path} className={cn("flex cursor-pointer items-center gap-space-sm rounded-lg px-space-sm py-1.5 hover:bg-surface-container", selected.has(o.path) && "bg-primary/10")}>
        <input type="checkbox" checked={selected.has(o.path)} onChange={() => toggle(o.path)} className="accent-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-md text-on-surface" title={o.path}>{o.name}</div>
          <div className="text-label-sm text-on-surface-variant">{size(o.sizeBytes)} · {formatRelative(new Date(o.modifiedAt))}</div>
        </div>
        {o.contentId && <Badge tone="success">Đã vào kho</Badge>}
        <Button size="sm" variant="subtle" onClick={(e) => {
          e.preventDefault();
          call("reup.reveal", { path: o.path }).catch((err) => toast.error(err.message));
        }}><FolderOpen size={13} /></Button>
      </label>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-space-sm border-t border-overlay/[0.06] p-space-md">
      <div className="flex items-center gap-space-sm text-label-md text-on-surface-variant">
        Khung hình
        <SegmentedControl label="Khung hình" value={aspect} onChange={setAspect} options={[{ value: "9:16", label: "9:16" }, { value: "16:9", label: "16:9" }, { value: "1:1", label: "1:1" }]} />
      </div>
      <div className="flex gap-space-sm">
        <Button variant="subtle" onClick={() => navigate("/content")}>Mở Kho nội dung</Button>
        <Button variant="primary" disabled={!selected.size || doImport.isPending} onClick={submit}>
          <Send size={15} /> Đưa {selected.size || ""} video vào Kho nội dung
        </Button>
      </div>
    </div>
  </Card>;
}

export function ReupPage() {
  const { data: status } = useApiQuery("reup.status", void 0, {
    refetchInterval: (q) => q.state.data?.download?.state === "downloading" ? 1e3 : 1e4
  });
  return <div className="flex h-full min-h-0 flex-col gap-space-md p-space-md">
    <PageHeader icon={Repeat2} title="Reup" description="Tải – dịch – lồng tiếng – che phụ đề video bằng HaizFlow, rồi lên lịch đăng bằng NT Studio" />
    {status && <div className="grid min-h-0 flex-1 gap-space-md lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <div className="flex min-h-0 flex-col gap-space-md overflow-y-auto">
        <InstallCard status={status} />
        <FoldersCard folders={status.folders} />
        <p className="px-space-sm text-label-sm text-on-surface-variant">
          HaizFlow © 2026 Mạch Hồng Hải – giấy phép HaizFlow Source-Available 1.0. NT Studio không chứa mã nguồn HaizFlow, chỉ mở bản cài chính thức.
        </p>
      </div>
      <OutputsCard />
    </div>}
  </div>;
}
