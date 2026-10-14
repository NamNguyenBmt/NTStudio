import { useState, useEffect } from "react";
import { Clock, LoaderCircle, RotateCcw } from "lucide-react";
import { cn } from "../lib/cn";

export function useNow(active, ms = 1e3) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

const DEFAULT_SEC = { image: 20, video: 120 };

export function expectedSeconds(detail, kind) {
  const secs = detail.assets.flatMap((a) => a.takes).filter((t) => t.kind === kind && t.status === "done" && t.startedAt && t.finishedAt).map((t) => (new Date(t.finishedAt).getTime() - new Date(t.startedAt).getTime()) / 1e3).filter((s) => s > 0 && s < 3600).sort((a, b) => a - b);
  if (!secs.length) return DEFAULT_SEC[kind];
  return Math.max(3, secs[Math.floor(secs.length / 2)]);
}

export function queuePositions(detail, kind) {
  const queued = detail.assets.flatMap((a) => a.takes).filter((t) => t.kind === kind && t.status === "queued").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return new Map(queued.map((t, i) => [t.id, i + 1]));
}

export function hasActive(detail) {
  return detail.assets.some((a) => a.takes.some((t) => t.status === "running" || t.status === "queued"));
}

const fmt = (s) => s >= 90 ? `${Math.floor(s / 60)}p${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)}s`;

export function TakeProgress({
  take,
  expectedSec,
  position,
  now,
  more = 0,
  variant = "overlay"
}) {
  const running = take.status === "running";
  const retrying = take.status === "queued" && !!take.error;
  const elapsed = running && take.startedAt ? Math.max(0, (now - new Date(take.startedAt).getTime()) / 1e3) : 0;
  const pct = running ? Math.min(95, elapsed / expectedSec * 100) : 0;
  const label = running ? take.progress ?? (take.kind === "video" ? "Đang tạo video…" : "Đang tạo ảnh…") : retrying ? "Chờ thử lại" : `Chờ luồng trống${position ? ` · thứ ${position}` : ""}`;
  const Icon = running ? LoaderCircle : retrying ? RotateCcw : Clock;
  return <div
    className={cn("flex flex-col gap-1", variant === "overlay" ? "bg-black/65 px-2 py-1.5 text-white backdrop-blur-sm" : "w-full text-on-surface-variant")}
    title={retrying ? take.error ?? void 0 : void 0}
  >
    <div className="flex items-center justify-between gap-2 text-[11px] leading-tight">
      <span className="flex min-w-0 items-center gap-1">
        <Icon size={11} className={cn("shrink-0", running && "animate-spin", variant === "overlay" ? "text-secondary" : "text-secondary")} />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-mono opacity-80">
        {running ? `${fmt(elapsed)} / ~${fmt(expectedSec)}` : ""}
        {more > 0 ? ` +${more}` : ""}
      </span>
    </div>
    <div className={cn("h-1 w-full overflow-hidden rounded-full", variant === "overlay" ? "bg-white/20" : "bg-surface-container-highest")}>
      {running ? <div className="h-full rounded-full bg-secondary transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} /> : (
        // Đang chờ: vạch chạy nhẹ để biết vẫn đang trong hàng đợi
        <div className={cn("h-full w-1/4 animate-pulse rounded-full", variant === "overlay" ? "bg-white/40" : "bg-secondary/50")} />
      )}
    </div>
  </div>;
}
