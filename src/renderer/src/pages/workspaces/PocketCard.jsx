import { useState, useRef, useEffect } from "react";
import {
  Archive,
  ArrowRight,
  CalendarClock,
  CirclePause,
  Clapperboard,
  EllipsisVertical,
  RefreshCw,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusDot } from "../../components/ui/StatusDot";

function Stat({ icon: Icon, label, value, sub, subTone }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-label-sm text-on-surface-variant">
        <Icon size={13} /> {label}
      </span>
      <span className="text-headline-sm tabular text-on-surface">{value}</span>
      <span
        className={cn(
          "text-label-sm",
          subTone === "ok" ? "text-tertiary" : subTone === "warn" ? "text-error" : "text-outline",
        )}
      >
        {sub}
      </span>
    </div>
  );
}

export function PocketCard({ ws, index, selected, onConfigure, onEnter, onArchive }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenu(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  const pc = ws.platformCounts;
  const paused = ws.channelCount === 0 || ws.postsPerDay === 0;
  const state = ws.unhealthyChannels > 0 ? "warn" : paused ? "idle" : "ok";
  const code = `PKT-${String(index + 1).padStart(2, "0")}`;
  return (
    <Card
      className={cn(
        "relative flex flex-col gap-space-md overflow-hidden p-space-md transition-colors",
        selected ? "border-primary-container/60 bg-surface-container" : "hover:bg-surface-container",
      )}
    >
      {selected && <span className="absolute inset-x-0 top-0 h-[3px] bg-secondary" />}
      <div className="flex items-start gap-space-sm">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-headline-sm font-bold text-surface"
          style={{ background: ws.color }}
        >
          {ws.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-space-sm">
            <h3 className="truncate text-headline-sm text-on-surface">{ws.name}</h3>
            <StatusDot health={state === "warn" ? "error" : state} live={state === "ok"} />
          </div>
          <div className="font-mono text-code text-outline">
            {"ID: "}
            {code}
          </div>
        </div>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Tùy chọn Pocket"
            onClick={() => setMenu((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant hover:bg-overlay/[0.06]"
          >
            <EllipsisVertical size={16} />
          </button>
          {menu && (
            <div className="absolute right-0 top-8 z-20 w-48 rounded-xl bg-surface-container-high p-1 shadow-flyout">
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  onArchive();
                }}
                className="flex w-full items-center gap-space-sm rounded px-space-sm py-1.5 text-left text-body-sm text-error hover:bg-overlay/[0.06]"
              >
                <Archive size={14} />
                {" Lưu trữ Pocket"}
              </button>
            </div>
          )}
        </div>
      </div>
      {ws.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ws.tags.map((t) => (
            <Badge key={t} tone="secondary">
              {t}
            </Badge>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-space-md gap-y-space-md rounded-xl bg-surface-container-lowest p-space-md">
        <Stat
          icon={Users}
          label="Dàn Kênh"
          value={`${ws.channelCount} Kênh`}
          sub={
            ws.unhealthyChannels
              ? `${ws.unhealthyChannels} kênh cần xử lý`
              : `${pc.facebook} FP • ${pc.tiktok} TikTok • ${pc.instagram} IG`
          }
          subTone={ws.unhealthyChannels ? "warn" : "muted"}
        />
        <Stat
          icon={Wallet}
          label="Ngân sách AI"
          value={`$${ws.aiSpentUsd.toFixed(2)}${ws.aiBudgetUsd != null ? ` / $${ws.aiBudgetUsd.toFixed(0)}` : ""}`}
          sub={ws.aiBudgetUsd != null ? "Đã dùng tháng này" : "Chưa đặt hạn mức"}
          subTone={ws.aiBudgetUsd != null && ws.aiSpentUsd > ws.aiBudgetUsd ? "warn" : "muted"}
        />
        <Stat
          icon={Clapperboard}
          label="Kho Nội Dung"
          value={`${ws.contentReady} bài & video`}
          sub="Sẵn sàng / đã lên lịch"
        />
        <Stat
          icon={CalendarClock}
          label="Tần Suất"
          value={ws.postsPerDay ? `${ws.postsPerDay} bài / ngày` : "Tạm dừng"}
          sub={ws.postsPerDay ? "Trung bình 7 ngày tới" : "Chưa có lịch"}
          subTone={ws.postsPerDay ? "ok" : "muted"}
        />
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-space-sm">
        {state === "warn" ? (
          <Badge tone="danger" pill={true} className="justify-self-start">
            <TriangleAlert size={11} />
            {" Cần xử lý"}
          </Badge>
        ) : state === "idle" ? (
          <Badge pill={true} className="justify-self-start">
            <CirclePause size={11} />
            {" Đang tạm dừng"}
          </Badge>
        ) : (
          <Badge tone="success" pill={true} className="justify-self-start">
            <RefreshCw size={11} />
            {" Đồng bộ tự động"}
          </Badge>
        )}
        <Button size="sm" variant="subtle" onClick={onConfigure}>
          Cài đặt quy tắc
        </Button>
        <Button size="sm" variant="primary" onClick={onEnter}>
          {"Vào không gian "}
          <ArrowRight size={13} />
        </Button>
      </div>
    </Card>
  );
}
