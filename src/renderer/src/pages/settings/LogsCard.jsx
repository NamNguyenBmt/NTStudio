import { useApiQuery, useApiMutation } from "../../lib/api";
import { FileText, FolderOpen } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { toast } from "../../components/ui/toast";
import { formatBytes } from "../content/VariantsPanel";

export function LogsCard() {
  const { data } = useApiQuery("system.logInfo", void 0, { refetchInterval: 15e3 });
  const open = useApiMutation("system.openLogs");
  return (
    <Card className="flex flex-col gap-space-sm p-space-md">
      <h3 className="flex items-center gap-space-sm text-label-md text-on-surface">
        <FileText size={15} className="text-secondary" />
        {" Nhật ký ứng dụng (log)"}
      </h3>
      <p className="break-all font-mono text-[11px] text-on-surface-variant" title={data?.file}>
        {data?.file ?? "…"}
      </p>
      <p className="text-label-sm text-outline">
        {data ? `${formatBytes(data.sizeBytes)} · ` : ""}Tự xoay vòng mỗi 5 MB (giữ 3 file cũ). Không ghi nội dung
        prompt, tin nhắn hay API key.
      </p>
      <Button
        size="sm"
        variant="subtle"
        disabled={open.isPending}
        onClick={() => open.mutate(void 0, { onError: (e) => toast.error(e.message) })}
      >
        <FolderOpen size={12} />
        {" Mở thư mục log"}
      </Button>
    </Card>
  );
}
