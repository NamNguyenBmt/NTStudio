import { useApiQuery, useApiMutation } from "../../lib/api";
import { Cpu, LoaderCircle, RefreshCw } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Select } from "../../components/ui/Input";
import { StatusDot } from "../../components/ui/StatusDot";
import { toast } from "../../components/ui/toast";
import { encoderShort } from "../../lib/media";
import { formatRelative } from "../../lib/format";

const ENCODERS = ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"];

export function MediaEngineCard() {
  const { data: info } = useApiQuery("media.info");
  const detect = useApiMutation("media.detect", ["media."]);
  const setEncoder = useApiMutation("media.setEncoder", ["media."]);
  return (
    <Card className="flex flex-col gap-space-sm p-space-md">
      <div className="flex items-center justify-between gap-space-sm">
        <h3 className="flex items-center gap-space-sm text-label-md text-on-surface">
          <Cpu size={15} className="text-secondary" />
          {" Engine render (FFmpeg)"}
        </h3>
        {info && <Badge tone={info.chosen === "libx264" ? "warning" : "success"}>{encoderShort[info.chosen]}</Badge>}
      </div>
      {info ? (
        <>
          <ul className="flex flex-col gap-0.5">
            {info.tested.map((t) => (
              <li
                key={t.encoder}
                className="flex items-center justify-between gap-space-sm font-mono text-code"
                title={t.error}
              >
                <span className="flex items-center gap-1.5 text-on-surface">
                  <StatusDot health={t.ok ? "ok" : "idle"} /> {encoderShort[t.encoder]}
                </span>
                <span className={t.ok ? "text-tertiary" : "text-outline"}>{t.ok ? "Chạy được" : "Không khả dụng"}</span>
              </li>
            ))}
          </ul>
          <label className="flex items-center justify-between gap-space-sm text-label-sm text-on-surface-variant">
            Encoder dùng khi render
            <div className="w-40">
              <Select
                value={info.preferred}
                onChange={(e) => setEncoder.mutate({ encoder: e.target.value })}
                aria-label="Encoder ưu tiên"
              >
                <option value="auto">Tự động (tốt nhất)</option>
                {ENCODERS.filter((e) => info.tested.some((t) => t.encoder === e && t.ok)).map((e) => (
                  <option key={e} value={e}>
                    {encoderShort[e]}
                  </option>
                ))}
              </Select>
            </div>
          </label>
          <p className="truncate font-mono text-[10px] text-outline" title={info.version}>
            {info.version.replace(/ Copyright.*$/, "")}
            {" · dò "}
            {formatRelative(info.detectedAt)}
          </p>
        </>
      ) : (
        <p className="text-body-sm text-on-surface-variant">Chưa dò GPU. Engine sẽ tự dò ở lần render đầu tiên.</p>
      )}
      <Button
        size="sm"
        variant="subtle"
        disabled={detect.isPending}
        onClick={() =>
          detect.mutate(void 0, {
            onSuccess: (r) => toast.success(`Encoder: ${encoderShort[r.chosen]}`),
            onError: (e) => toast.error(e.message),
          })
        }
      >
        {detect.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {" Dò lại GPU"}
      </Button>
    </Card>
  );
}
