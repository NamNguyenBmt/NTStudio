import { useState, useEffect } from "react";
import { useApiQuery } from "../../lib/api";
import { CircleArrowUp, Cpu, LoaderCircle, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { UPSCALE_QUALITIES, UPSCALE_METHODS } from "../../../../shared/upscale";

const METHOD_ICON = { flow: Sparkles, local: Cpu };

export function UpscaleDialog({
  path,
  onClose,
  onSubmit,
  busy = false,
  status,
  onCancel,
  count = 1
}) {
  const { data: info, isLoading } = useApiQuery("media.upscaleInfo", { path: path ?? "" }, { enabled: !!path, staleTime: 0 });
  const [quality, setQuality] = useState("1080p");
  const [method, setMethod] = useState("flow");
  const short = info ? Math.min(info.width, info.height) : 0;
  useEffect(() => {
    if (!info) return;
    setMethod(info.inFlow ? "flow" : "local");
    setQuality(UPSCALE_QUALITIES.find((q) => q.shortSide > short)?.id ?? "4k");
  }, [info, short]);
  const qualityOk = (q) => method === "flow" || !short || q.shortSide > short;
  const methodOk = (m) => m === "local" || !!info?.inFlow;
  const canSubmit = !!info && !busy && methodOk(method) && qualityOk(UPSCALE_QUALITIES.find((q) => q.id === quality));
  return <Dialog
    open={!!path}
    onClose={busy ? () => void 0 : onClose}
    title={count > 1 ? `Nâng cấp chất lượng ${count} video` : "Nâng cấp chất lượng video"}
    description={info?.width ? `Độ phân giải hiện tại${count > 1 ? " (video đầu tiên)" : ""}: ${info.width}×${info.height}` : void 0}
    width={560}
    footer={busy ? onCancel && <Button variant="subtle" onClick={onCancel}>Hủy nâng cấp</Button> : <>
      <Button variant="subtle" onClick={onClose}>Đóng</Button>
      <Button variant="primary" disabled={!canSubmit} onClick={() => onSubmit(quality, method)}>
        <CircleArrowUp size={14} />
        {" Nâng cấp"}
        {count > 1 ? ` ${count} video` : ""}
      </Button>
    </>}
  >
    {isLoading ? <div className="flex items-center gap-space-sm py-space-lg text-body-sm text-on-surface-variant">
      <LoaderCircle size={16} className="animate-spin" />
      {" Đang đọc thông tin video…"}
    </div> : busy ? <div className="flex flex-col items-center gap-space-sm py-space-lg text-center">
      <LoaderCircle size={28} className="animate-spin text-primary" />
      <span className="text-body-md text-on-surface">{status || "Đang nâng cấp…"}</span>
      <span className="text-label-sm text-on-surface-variant">
        Nâng cấp bằng Google Flow có thể mất vài phút (4K lâu hơn).
      </span>
    </div> : <div className="flex flex-col gap-space-md">
      <div className="flex flex-col gap-1">
        <span className="text-label-md text-on-surface-variant">Chất lượng</span>
        <div className="grid grid-cols-2 gap-space-sm" role="radiogroup" aria-label="Chất lượng">
          {UPSCALE_QUALITIES.map((q) => {
            const on = quality === q.id;
            return <button
              key={q.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!qualityOk(q)}
              onClick={() => setQuality(q.id)}
              className={cn(
                "flex flex-col gap-1 rounded-xl border p-space-sm text-left transition-colors disabled:opacity-40",
                on ? "border-primary bg-primary/10" : "border-overlay/[0.1] hover:bg-surface-container"
              )}
            >
              <span className="text-label-md text-on-surface">{q.label}</span>
              <span className="text-label-sm text-on-surface-variant">
                {qualityOk(q) ? q.hint : "Video đã có độ phân giải này"}
              </span>
            </button>;
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-label-md text-on-surface-variant">Cách nâng cấp</span>
        <div className="grid grid-cols-2 gap-space-sm" role="radiogroup" aria-label="Cách nâng cấp">
          {UPSCALE_METHODS.map((m) => {
            const on = method === m.id;
            const Icon = METHOD_ICON[m.id];
            return <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!methodOk(m.id)}
              onClick={() => setMethod(m.id)}
              className={cn(
                "flex flex-col gap-1 rounded-xl border p-space-sm text-left transition-colors disabled:opacity-40",
                on ? "border-primary bg-primary/10" : "border-overlay/[0.1] hover:bg-surface-container"
              )}
            >
              <span className="flex items-center gap-1 text-label-md text-on-surface">
                <Icon size={14} />
                {" "}
                {m.label}
              </span>
              <span className="text-label-sm text-on-surface-variant">
                {methodOk(m.id) ? m.hint : "Chỉ dùng được cho video tạo bằng Google Flow (từ bản app này trở đi) – video này không còn liên kết với Flow."}
              </span>
            </button>;
          })}
        </div>
      </div>
      <p className="text-label-sm text-outline">Bản nâng cấp được lưu thành file mới – video gốc vẫn giữ nguyên.</p>
    </div>}
  </Dialog>;
}
