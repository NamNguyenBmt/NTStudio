import { useApiQuery } from "../../lib/api";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Progress } from "../../components/ui/Progress";

export function OmniraAiCard() {
  const { data } = useApiQuery("ai.omnira", void 0, { refetchInterval: 6e4 });
  const q = data?.quota;
  return <div className="flex flex-col gap-space-sm rounded-lg border border-secondary/30 bg-secondary-container/20 p-space-md">
    <div className="flex items-center gap-space-sm">
      <Sparkles size={16} className="text-secondary" />
      <span className="text-label-md font-semibold text-on-surface">AI NT</span>
      {!data ? null : !data.inUse ? <Badge tone="neutral">Không dùng – đang dùng key riêng</Badge> : q?.available ? <Badge tone="success">Đang dùng</Badge> : <Badge tone="warning">Tạm không dùng được</Badge>}
    </div>
    <p className="text-body-sm text-on-surface-variant">
      AI văn bản có sẵn trong gói của bạn – tự dùng khi bạn chưa nhập key AI văn bản riêng. Chỉ dùng để viết chữ (kịch bản, caption, trả lời tin nhắn); ảnh / video vẫn cần key riêng hoặc Google Flow. Nhập key riêng bên dưới để dùng không giới hạn.
    </p>
    {data && !q && <p className="text-body-sm text-on-surface-variant">Chưa lấy được hạn mức (kiểm tra kết nối mạng).</p>}
    {q && q.dailyLimit > 0 && <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
      <Meter label="Hôm nay" used={q.dailyUsed} limit={q.dailyLimit} />
      <Meter label="Tháng này" used={q.monthlyUsed} limit={q.monthlyLimit} />
    </div>}
    {q && !q.available && q.message && data?.inUse && <p className="rounded bg-warning/10 p-space-sm text-body-sm text-warning">
      {q.message}
      {(q.reason === "DAILY" || q.reason === "MONTHLY" || q.reason === "NOT_IN_PLAN") && <>{" "}<Link to="/billing" className="font-medium underline">Xem gói</Link></>}
    </p>}
  </div>;
}

function Meter({ label, used, limit }) {
  const left = Math.max(0, limit - used);
  return <div className="flex flex-col gap-1">
    <div className="flex justify-between text-label-sm text-on-surface-variant">
      <span>{label}</span>
      <span className="font-mono">{"còn "}{left.toLocaleString("vi-VN")}/{limit.toLocaleString("vi-VN")}{" lượt"}</span>
    </div>
    <Progress value={used * 100 / Math.max(1, limit)} />
  </div>;
}
