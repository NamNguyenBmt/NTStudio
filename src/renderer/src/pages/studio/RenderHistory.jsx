import { useApiMutation } from "../../lib/api";
import { FolderOpen, Square, TriangleAlert } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Progress } from "../../components/ui/Progress";
import { mediaUrl, encoderShort } from "../../lib/media";
import { formatRelative } from "../../lib/format";

const statusMeta = {
  queued: { label: "Đang chờ", tone: "neutral" },
  running: { label: "Đang render", tone: "secondary" },
  done: { label: "Hoàn tất", tone: "success" },
  failed: { label: "Lỗi", tone: "danger" },
  cancelled: { label: "Đã hủy", tone: "neutral" }
};

export function RenderHistory({ open, onClose, jobs, onCancel }) {
  const show = useApiMutation("media.showInFolder");
  return <Dialog open={open} onClose={onClose} title="Lịch sử render" description={jobs[0]?.projectTopic} width={640}>
    {jobs.length === 0 ? <p className="text-body-sm text-on-surface-variant">Dự án chưa render lần nào. Bấm F9 để bắt đầu.</p> : <ul className="flex flex-col gap-space-sm">
      {jobs.map((j) => {
        const meta = statusMeta[j.status];
        const secs = j.startedAt && j.finishedAt ? Math.round((j.finishedAt.getTime() - j.startedAt.getTime()) / 1e3) : null;
        return <li key={j.id} className="flex gap-space-md rounded-xl bg-surface-container p-space-sm">
          {j.status === "done" && j.outputPath ? <video src={mediaUrl(j.outputPath)} className="h-24 w-[54px] shrink-0 rounded-lg bg-black object-cover" muted={true} preload="metadata" /> : <div className="h-24 w-[54px] shrink-0 rounded-lg bg-surface-container-highest" />}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-space-sm">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {j.encoder && <Badge mono={true}>{encoderShort[j.encoder] ?? j.encoder}</Badge>}
              <span className="font-mono text-code text-outline">
                {formatRelative(j.createdAt)}
                {secs != null && ` · ${secs}s`}
              </span>
            </div>
            {(j.status === "running" || j.status === "queued") && <>
              <span className="text-label-sm text-on-surface-variant">{j.stage}</span>
              <Progress value={j.progress * 100} />
            </>}
            {j.error && <p className="line-clamp-2 font-mono text-[11px] text-error">{j.error}</p>}
            {j.notes.map((n) => <p key={n} className="flex gap-1 text-[11px] text-warning">
              <TriangleAlert size={11} className="mt-0.5 shrink-0" />
              {" "}
              {n}
            </p>)}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            {j.status === "done" && j.outputPath && <Button size="sm" variant="subtle" onClick={() => show.mutate({ path: j.outputPath })}>
              <FolderOpen size={12} />
              {" Mở thư mục"}
            </Button>}
            {(j.status === "running" || j.status === "queued") && <Button size="sm" variant="danger" onClick={() => onCancel(j.id)}><Square size={12} />{" Hủy"}</Button>}
          </div>
        </li>;
      })}
    </ul>}
  </Dialog>;
}
