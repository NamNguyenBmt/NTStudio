import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call, useApiQuery } from "../../lib/api";
import { Link } from "react-router-dom";
import { LoaderCircle, Network, Plus, RefreshCw, Search, TriangleAlert, UsersRound } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Kbd } from "../../components/ui/Kbd";
import { PlatformIcon } from "../../components/PlatformIcon";
import { StatusDot } from "../../components/ui/StatusDot";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { QuotaBar } from "../../components/shell/QuotaBar";
import { AccountInspector } from "./AccountInspector";
import { needsAttention } from "./meta";
import { ConnectChannelDialog } from "./ConnectChannelDialog";
import { ImportFacebookDialog } from "./ImportFacebookDialog";
import { ConnectFacebookButton, ConnectTiktokButton, ConnectYoutubeButton } from "./ConnectButtons";
import { AddAccountDialog } from "./AddAccountDialog";
import { AddPageDialog } from "./AddPageDialog";
import { TikTokGrid } from "./TikTokGrid";
import { InstagramList } from "./InstagramList";
import { FacebookTree } from "./FacebookTree";

function Block({
  accent,
  icon,
  title,
  count,
  subtitle,
  aside,
  children
}) {
  return <Card>
    <div className="flex items-start justify-between gap-space-md p-space-md">
      <div className="flex gap-space-sm">
        <span className={cn("mt-0.5 h-8 w-1 shrink-0 rounded-full", accent)} />
        <div>
          <h2 className="flex flex-wrap items-center gap-space-sm text-headline-sm text-on-surface">
            {icon}
            {" "}
            {title}
            {" "}
            <Badge mono={true}>{count}</Badge>
          </h2>
          <p className="text-body-sm text-on-surface-variant">{subtitle}</p>
        </div>
      </div>
      {aside}
    </div>
    {children}
  </Card>;
}

function Kpi({ label, value, unit, icon, footer }) {
  return <Card className="flex flex-col gap-space-sm bg-surface-container p-space-md">
    <div className="flex items-start justify-between">
      <span className="text-label-sm uppercase tracking-wider text-outline">{label}</span>
      <span className="text-secondary">{icon}</span>
    </div>
    <div className="flex items-baseline gap-space-xs">
      <span className="text-display tabular text-on-surface">{value}</span>
      <span className="text-body-sm text-on-surface-variant">{unit}</span>
    </div>
    <div className="text-label-sm text-on-surface-variant">{footer}</div>
  </Card>;
}

export function AccountsPage() {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: accounts = [], isLoading } = useApiQuery("accounts.tree", { workspaceId });
  const { data: workspaces = [] } = useApiQuery("workspaces.list");
  const { data: everyAccount = [] } = useApiQuery("accounts.tree", { workspaceId: null }, { enabled: !!workspaceId });
  const unassigned = workspaceId ? everyAccount.filter((a) => !a.workspaceId) : [];
  const [assigning, setAssigning] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pageFor, setPageFor] = useState(null);
  const [connectFor, setConnectFor] = useState(null);
  const [importFor, setImportFor] = useState(null);
  const [checking, setChecking] = useState(false);
  const qc = useQueryClient();
  const verifyAll = async () => {
    const connected = accounts.flatMap((a) => a.channels).filter((c) => c.tokenStatus !== "missing");
    if (!connected.length) return void toast.info("Chưa có kênh nào kết nối API");
    setChecking(true);
    let ok = 0;
    const failed = [];
    for (const c of connected) {
      try {
        await call("channels.verify", { id: c.id });
        ok++;
      } catch (e) {
        failed.push(`${c.name}: ${e.message}`);
      }
    }
    setChecking(false);
    void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^(accounts|channels|alerts|dashboard)\./.test(q.queryKey[0]) });
    if (!failed.length) toast.success(`${ok}/${connected.length} kênh có token hợp lệ`);
    else {
      toast.error(`${failed.length}/${connected.length} kênh lỗi token`);
      for (const f of failed.slice(0, 3)) toast.error(f);
    }
  };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setAddOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter === "attention" && !needsAttention(a)) return false;
      if (filter !== "all" && filter !== "attention" && a.platform !== filter) return false;
      if (!q) return true;
      const hay = [a.displayName, a.handle, a.externalId, ...a.channels.flatMap((c) => [c.name, c.externalId])];
      return hay.some((v) => v?.toLowerCase().includes(q));
    });
  }, [accounts, filter, query]);
  useEffect(() => {
    if (selectedId && !accounts.some((a) => a.id === selectedId)) setSelectedId(null);
    if (!selectedId && visible.length > 0) setSelectedId(visible[0].id);
  }, [accounts, visible, selectedId]);
  const by = (p) => visible.filter((a) => a.platform === p);
  const all = (p) => accounts.filter((a) => a.platform === p);
  const channels = accounts.flatMap((a) => a.channels);
  const activeChannels = channels.filter((c) => c.status === "active");
  const via = all("facebook");
  const fbPages = via.flatMap((a) => a.channels);
  const apiConnected = channels.filter((c) => c.tokenStatus !== "missing");
  const expiredTokens = channels.filter((c) => c.tokenStatus === "expired").length;
  const blocked = accounts.filter((a) => a.sessionStatus === "expired" || a.sessionStatus === "checkpoint").length;
  const attention = accounts.filter(needsAttention);
  const healthPct = channels.length ? Math.round(channels.filter((c) => c.health === "ok").length / channels.length * 1e3) / 10 : 0;
  const chips = [
    { value: "all", label: "Tất cả", count: accounts.length },
    { value: "facebook", label: "Facebook", count: via.length, dot: "bg-brand-facebook" },
    { value: "tiktok", label: "TikTok", count: all("tiktok").length, dot: "bg-brand-tiktok-cyan" },
    { value: "instagram", label: "Instagram", count: all("instagram").length, dot: "bg-brand-instagram" },
    { value: "youtube", label: "YouTube", count: all("youtube").length, dot: "bg-brand-youtube" },
    { value: "attention", label: "Cần xử lý", count: attention.length }
  ];
  return <div className="flex flex-col gap-space-lg">
    <Card className="flex flex-wrap items-start justify-between gap-space-md p-space-md">
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-headline-lg text-on-surface">{"Danh sách Tài khoản & Fanpage / Kênh kết nối"}</h1>
        <div className="mt-space-sm flex flex-wrap gap-space-xs">
          <Badge tone="primary" pill={true} mono={true}>{"Tổng số: "}{channels.length}{" Kênh"}</Badge>
          <Badge mono={true}>{"FB: "}{fbPages.length}</Badge>
          <Badge mono={true}>{"TT: "}{all("tiktok").length}</Badge>
          <Badge mono={true}>{"IG: "}{all("instagram").length}</Badge>
          <Badge mono={true}>{"YT: "}{all("youtube").length}</Badge>
        </div>
        <p className="mt-space-sm text-body-sm text-on-surface-variant">
          Tài khoản Facebook và các Fanpage con, kênh TikTok, tài khoản Instagram, kênh YouTube. Bấm Kết nối Facebook để thêm Fanpage bằng đăng nhập – không cần tự lấy token.
          {" "}
          <Link to="/guide" className="text-primary hover:underline">Xem hướng dẫn kết nối</Link>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-space-sm">
        <ConnectFacebookButton variant="primary" workspaceId={workspaceId} onConnected={setSelectedId} />
        <Button onClick={() => setAddOpen(true)}><Plus size={15} />{" Thêm thủ công "}<Kbd>Ctrl+N</Kbd></Button>
        <ConnectTiktokButton workspaceId={workspaceId} onConnected={setSelectedId} />
        <ConnectYoutubeButton workspaceId={workspaceId} onConnected={setSelectedId} />
        <Button disabled={checking} onClick={() => void verifyAll()}>
          {checking ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {" Kiểm tra token toàn bộ"}
        </Button>
      </div>
    </Card>
    <div className="grid grid-cols-2 gap-space-md xl:grid-cols-4">
      <Kpi
        label="Tổng kênh hoạt động"
        icon={<UsersRound size={18} />}
        value={activeChannels.length}
        unit={`/ ${channels.length} Đang chạy`}
        footer={<span className="flex items-center gap-1">
          <StatusDot health="ok" />
          {" "}
          {healthPct}
          {"% sức khỏe tốt · "}
          {channels.length - activeChannels.length}
          {" kênh tạm ngưng"}
        </span>}
      />
      <Kpi
        label="Nick VIA mẹ (Facebook)"
        icon={<UsersRound size={18} />}
        value={via.length}
        unit="Nick VIA"
        footer={`Phân quyền giữ: ${fbPages.length} Page · ${via.length ? Math.round(via.filter((a) => a.twoFactorEnabled).length / via.length * 100) : 0}% bật 2FA`}
      />
      <Kpi
        label="Kênh đã kết nối API"
        icon={<Network size={18} />}
        value={<span className="text-tertiary">{apiConnected.length}/{channels.length}</span>}
        unit="Kênh"
        footer={`${expiredTokens} token hết hạn · ${channels.length - apiConnected.length} kênh chưa kết nối`}
      />
      <Kpi
        label="Cảnh báo cần xử lý"
        icon={<TriangleAlert size={18} className="text-error" />}
        value={<span className="text-error">{attention.length}</span>}
        unit="Tài khoản"
        footer={<span className="flex gap-space-sm">
          <span className="text-warning">{expiredTokens}{" Token hết hạn"}</span>
          <span className="text-error">{blocked}{" Hết phiên / Checkpoint"}</span>
        </span>}
      />
    </div>
    <QuotaBar />
    {unassigned.length > 0 && <Card className="flex flex-wrap items-center justify-between gap-space-sm border-warning/40 p-space-md">
      <div className="flex min-w-0 items-center gap-space-sm text-body-sm text-on-surface">
        <TriangleAlert size={16} className="shrink-0 text-warning" />
        <span>
          {unassigned.length}
          {" tài khoản chưa thuộc không gian nào nên không hiện ở đây:"}
          {" "}
          <span className="text-on-surface-variant">
            {unassigned.map((a) => `${a.platform === "youtube" ? "YouTube" : a.platform === "tiktok" ? "TikTok" : a.platform === "instagram" ? "Instagram" : "Facebook"} · ${a.displayName}`).join(", ")}
          </span>
        </span>
      </div>
      <Button
        size="sm"
        variant="primary"
        disabled={assigning}
        onClick={async () => {
          setAssigning(true);
          try {
            for (const a of unassigned) await call("accounts.update", { id: a.id, patch: { workspaceId } });
            toast.success(`Đã gán ${unassigned.length} tài khoản vào không gian "${workspaces.find((w) => w.id === workspaceId)?.name ?? "này"}"`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          } finally {
            setAssigning(false);
            void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^(accounts|channels|dashboard|workspaces)\./.test(q.queryKey[0]) });
          }
        }}
      >
        {assigning ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}
        {" Gán vào không gian này"}
      </Button>
    </Card>}
    <div className="flex flex-wrap items-center justify-between gap-space-md">
      <div className="flex flex-wrap gap-space-xs" role="radiogroup" aria-label="Lọc theo nền tảng">
        {chips.map((c) => <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={filter === c.value}
          onClick={() => setFilter(c.value)}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-space-md text-label-md transition-colors",
            filter === c.value ? "bg-surface-container-high text-on-surface shadow-highlight" : "bg-surface-container-low text-on-surface-variant hover:text-on-surface",
            c.value === "attention" && "text-error"
          )}
        >
          {["facebook", "tiktok", "instagram", "youtube"].includes(c.value) ? <PlatformIcon platform={c.value} size={13} /> : c.dot && <span className={cn("h-2 w-2 rounded-full", c.dot)} />}
          {c.value === "attention" && <TriangleAlert size={13} />}
          {c.label}
          <span className="font-mono text-code text-outline">{c.count}</span>
        </button>)}
      </div>
      <div className="relative w-full max-w-sm">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên nick, Fanpage, UID…" className="pl-8" aria-label="Tìm tài khoản" />
      </div>
    </div>
    <div className="grid grid-cols-1 items-start gap-space-md xl:grid-cols-[1fr_380px]">
      <div className="flex min-w-0 flex-col gap-space-md">
        {isLoading && <Card className="h-64 animate-pulse" />}
        {(filter === "all" || filter === "facebook" || filter === "attention") && <Block
          accent="bg-brand-facebook"
          icon={<PlatformIcon platform="facebook" size={18} />}
          title="Khối 1: Nền tảng Facebook"
          count={`${by("facebook").length} VIA Mẹ / ${by("facebook").flatMap((a) => a.channels).length} Page`}
          subtitle="Kết nối bằng đăng nhập Facebook – mỗi Fanpage dùng Page token riêng, mã hóa trong két"
        >
          <FacebookTree accounts={by("facebook")} selectedId={selectedId} onSelect={setSelectedId} onAddPage={setPageFor} onConnect={setConnectFor} />
        </Block>}
        {(filter === "all" || filter === "tiktok" || filter === "attention") && <Block
          accent="bg-brand-tiktok-cyan"
          icon={<PlatformIcon platform="tiktok" size={18} />}
          title="Khối 2: Nền tảng TikTok"
          count={`${by("tiktok").length} Kênh`}
          subtitle="Đăng video qua TikTok Content Posting API"
          aside={<span className="font-mono text-code text-tertiary">
            {all("tiktok").filter((a) => a.health === "ok").length}
            /
            {all("tiktok").length}
            {" Kênh Đang Chạy"}
          </span>}
        >
          <TikTokGrid accounts={by("tiktok")} selectedId={selectedId} onSelect={setSelectedId} />
        </Block>}
        {(filter === "all" || filter === "instagram" || filter === "attention") && <Block
          accent="bg-brand-instagram"
          icon={<PlatformIcon platform="instagram" size={18} />}
          title="Khối 3: Nền tảng Instagram"
          count={`${by("instagram").length} Tài khoản`}
          subtitle={"Đăng Reels, hộp thư & bình luận qua Instagram Graph API (liên kết Fanpage)"}
        >
          <InstagramList accounts={by("instagram")} selectedId={selectedId} onSelect={setSelectedId} />
        </Block>}
        {(filter === "all" || filter === "youtube" || filter === "attention") && <Block
          accent="bg-brand-youtube"
          icon={<PlatformIcon platform="youtube" size={18} />}
          title="Khối 4: Nền tảng YouTube"
          count={`${by("youtube").length} Kênh`}
          subtitle={"Đăng video & Shorts qua YouTube Data API (đăng nhập Google, token tự làm mới)"}
        >
          <TikTokGrid accounts={by("youtube")} selectedId={selectedId} onSelect={setSelectedId} />
        </Block>}
      </div>
      <div className="xl:sticky xl:top-0">
        <AccountInspector accountId={selectedId} workspaces={workspaces} onDeleted={() => setSelectedId(null)} onConnect={setConnectFor} onImport={setImportFor} />
      </div>
    </div>
    <AddAccountDialog open={addOpen} onClose={() => setAddOpen(false)} workspaces={workspaces} defaultWorkspaceId={workspaceId} onCreated={setSelectedId} />
    <AddPageDialog account={pageFor} onClose={() => setPageFor(null)} />
    <ConnectChannelDialog channel={connectFor} onClose={() => setConnectFor(null)} />
    <ImportFacebookDialog account={importFor} onClose={() => setImportFor(null)} />
  </div>;
}
