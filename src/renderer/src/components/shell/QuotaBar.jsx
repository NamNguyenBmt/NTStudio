import { useState } from "react";
import { useApiQuery } from "../../lib/api";
import { Radio } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { QuotaPicker } from "./QuotaPicker";

export function QuotaBar() {
  const { data: q } = useApiQuery("channels.quota", void 0, { staleTime: 15e3 });
  const [pick, setPick] = useState(false);
  if (!q || q.limit === null) return null;
  const full = q.used >= q.limit;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-space-sm rounded-xl border px-space-md py-space-sm text-body-sm",
        q.blocked ? "border-warning/30 bg-warning/5" : "border-outline-variant/30 bg-surface-container-lowest",
      )}
    >
      <Radio size={15} className={q.blocked || full ? "text-warning" : "text-secondary"} />
      <span className="text-on-surface">
        {"Đang dùng "}
        <b>{q.used}</b>
        {" / "}
        {q.limit}
        {" kênh của gói"}
        {q.blocked ? ` · ${q.blocked} kênh ngoài hạn mức (tạm dừng đăng bài)` : full ? " · đã đủ hạn mức" : ""}
      </span>
      <Button size="sm" variant="subtle" className="ml-auto" onClick={() => setPick(true)}>
        Chọn kênh dùng
      </Button>
      {pick && <QuotaPicker open={true} onClose={() => setPick(false)} />}
    </div>
  );
}
