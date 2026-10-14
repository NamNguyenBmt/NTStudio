import { useState, useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";

export function queuedPosition(jobs, id) {
  return Object.entries(jobs).filter(([, j]) => j.status === "queued").sort((a, b) => a[1].order - b[1].order).findIndex(([k]) => k === id) + 1;
}

export function CharJobOverlay({ job, position }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(t);
  }, [job.status]);
  if (job.status === "done") return null;
  const elapsed = job.startedAt ? Math.max(0, (now - job.startedAt) / 1e3) : 0;
  return <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-black/65 px-1 py-1 text-[10px] leading-tight text-white" title={job.error}>
    {job.status === "failed" ? <span className="text-[#ffb4ab]">Lỗi – rê chuột xem</span> : <>
      <span className="flex items-center gap-1 truncate">
        <LoaderCircle size={9} className={cn("shrink-0", job.status === "running" && "animate-spin")} />
        {job.status === "running" ? `Đang tạo… ${Math.round(elapsed)}s` : `Chờ luồng · thứ ${position}`}
      </span>
      <span className="h-0.5 w-full overflow-hidden rounded-full bg-white/20">
        {job.status === "running" ? <span className="block h-full rounded-full bg-secondary transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(95, elapsed / 25 * 100)}%` }} /> : <span className="block h-full w-1/4 animate-pulse rounded-full bg-white/40" />}
      </span>
    </>}
  </span>;
}
