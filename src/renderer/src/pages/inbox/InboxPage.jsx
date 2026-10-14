import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { Gauge, LoaderCircle, MessagesSquare, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Switch";
import { StatusDot } from "../../components/ui/StatusDot";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { InboxSidePanel } from "./InboxSidePanel";
import { ConversationList } from "./ConversationList";
import { Thread } from "./Thread";

function formatDuration(sec) {
  if (sec == null) return "—";
  if (sec < 60) return `${sec} giây`;
  if (sec < 3600) return `${Math.round(sec / 60)} phút`;
  return `${(sec / 3600).toFixed(1)} giờ`;
}

export function InboxPage() {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: conversations = [] } = useApiQuery("inbox.conversations", { workspaceId });
  const { data: quickReplies = [] } = useApiQuery("inbox.quickReplies", { workspaceId });
  const { data: stats } = useApiQuery("inbox.stats", { workspaceId });
  const { data: rules = [] } = useApiQuery("inbox.rules", { workspaceId });
  const [selectedId, setSelectedId] = useState(null);
  const { data: worker } = useApiQuery("inbox.worker", void 0, { refetchInterval: 4e3 });
  const sync = useApiMutation("inbox.sync", ["inbox.", "channels.", "accounts."]);
  const setAutoSync = useApiMutation("inbox.setAutoSync", ["inbox.worker"]);
  const qc = useQueryClient();
  const lastVersion = useRef(null);
  useEffect(() => {
    const v = worker?.version;
    if (v == null) return;
    if (lastVersion.current != null && v !== lastVersion.current) {
      void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("inbox.") && q.queryKey[0] !== "inbox.worker" });
    }
    lastVersion.current = v;
  }, [worker?.version, qc]);
  const runSync = () => sync.mutate(
    {},
    {
      onSuccess: (r) => {
        if (!r.channels) toast.info("Chưa có kênh Facebook/Instagram nào kết nối API – vào Tài khoản & Kênh để kết nối");
        else toast.success(`Đã đồng bộ ${r.channels} kênh · ${r.newMessages} tin mới${r.autoActions ? ` · ${r.autoActions} trả lời tự động` : ""}`);
        for (const e of r.errors.slice(0, 3)) toast.error(e);
      },
      onError: (e) => toast.error(e.message)
    }
  );
  useEffect(() => {
    if (!conversations.some((c) => c.id === selectedId)) setSelectedId(conversations[0]?.id ?? null);
  }, [conversations, selectedId]);
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const shieldOn = rules.some((r) => r.action === "hide_comment" && r.enabled);
  return (
    // Chiếm trọn chiều cao vùng nội dung: 100vh − titlebar − statusbar − padding main
    <div className="flex h-[calc(100vh-2.5rem-1.75rem-1.5rem)] min-h-[560px] flex-col gap-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-md rounded-xl bg-surface-container-low p-space-sm pl-space-md">
        <h1 className="flex items-center gap-space-sm text-headline-md text-on-surface">
          <MessagesSquare size={22} className="text-secondary" />
          {" Hộp thư hợp nhất & Chăm sóc khách hàng"}
        </h1>
        <div className="flex flex-wrap items-center gap-space-sm">
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-container px-space-md py-1.5 text-body-sm">
            <StatusDot health={stats?.enabledRules ? "ok" : "idle"} live={!!stats?.enabledRules} />
            <span className="text-on-surface-variant">Auto-Reply:</span>
            <span className="text-tertiary">{stats?.enabledRules ?? 0}{" luật bật"}</span>
          </div>
          {!!worker?.drafts && <div className="flex items-center gap-1.5 rounded-lg bg-secondary/15 px-space-md py-1.5 text-body-sm text-secondary">
            {"AI chờ duyệt: "}
            <b>{worker.drafts}</b>
          </div>}
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-container px-space-md py-1.5 text-body-sm">
            <Gauge size={14} className="text-secondary" />
            <span className="text-on-surface-variant">Phản hồi TB:</span>
            <span className="font-mono text-on-surface">{formatDuration(stats?.avgResponseSec ?? null)}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-container px-space-md py-1.5 text-body-sm">
            <ShieldCheck size={14} className={shieldOn ? "text-tertiary" : "text-outline"} />
            <span className="text-on-surface-variant">Chống cướp khách:</span>
            <span className={shieldOn ? "text-tertiary" : "text-outline"}>{shieldOn ? "Đang bật" : "Tắt"}</span>
          </div>
          <div
            className="flex items-center gap-space-sm rounded-lg bg-surface-container px-space-md py-1.5 text-body-sm text-on-surface-variant"
            title={worker?.lastSync?.errors.join("\n") || void 0}
          >
            <Switch
              label="Tự động đồng bộ"
              checked={worker?.autoSync ?? true}
              disabled={!worker || setAutoSync.isPending}
              onChange={(enabled) => setAutoSync.mutate({ enabled })}
            />
            <span>
              <span title="Tin nhắn: mỗi 15 giây khi đang dùng app, 60 giây khi app chạy nền · Bình luận: mỗi 2 phút">
                Tin nhắn mỗi 15 giây
              </span>
              {worker?.lastSync && <span className={worker.lastSync.errors.length ? "text-warning" : "text-outline"}>
                {" "}
                {"· lần cuối "}
                {worker.lastSync.at.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                {worker.lastSync.errors.length ? ` (${worker.lastSync.errors.length} lỗi)` : ""}
              </span>}
            </span>
          </div>
          <Button variant="primary" disabled={sync.isPending || worker?.syncing} onClick={runSync}>
            {sync.isPending || worker?.syncing ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {" Đồng bộ đa kênh"}
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[290px_1fr] gap-space-md xl:grid-cols-[290px_1fr_290px] 2xl:grid-cols-[320px_1fr_320px]">
        <ConversationList conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} />
        {selected ? <Thread conversation={selected} quickReplies={quickReplies} /> : <div className="flex items-center justify-center rounded-xl bg-surface-container-low text-body-sm text-on-surface-variant">
          {conversations.length ? "Chọn một hội thoại" : "Chưa có hội thoại nào trong Pocket này"}
        </div>}
        <div className="hidden min-h-0 xl:flex">
          <InboxSidePanel conversation={selected} workspaceId={workspaceId} />
        </div>
      </div>
    </div>
  );
}
