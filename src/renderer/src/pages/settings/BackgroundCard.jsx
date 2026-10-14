import { useApiQuery, useApiMutation } from "../../lib/api";
import { MonitorDown } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Switch } from "../../components/ui/Switch";
import { toast } from "../../components/ui/toast";

export function BackgroundCard() {
  const { data: p } = useApiQuery("system.background");
  const set = useApiMutation("system.setBackground", ["system.background"]);
  const update = (patch) => set.mutate(patch, { onError: (e) => toast.error(e.message) });
  return <Card className="flex flex-col gap-space-sm p-space-md">
    <h3 className="flex items-center gap-space-sm text-label-md text-on-surface">
      <MonitorDown size={15} className="text-secondary" />
      {" Chạy nền"}
    </h3>
    <label className="flex items-start justify-between gap-space-md text-body-sm">
      <span className="flex flex-col">
        <span className="text-on-surface">Chạy nền khi đóng cửa sổ</span>
        <span className="text-label-sm text-on-surface-variant">
          Bấm ✕ chỉ ẩn app xuống khay hệ thống – lập lịch đăng bài, hộp thư, render vẫn chạy. Thoát hẳn: chuột phải biểu tượng ở khay → Thoát.
        </span>
      </span>
      <Switch label="Chạy nền khi đóng cửa sổ" checked={!!p?.closeToTray} disabled={!p || set.isPending} onChange={(v) => update({ closeToTray: v })} />
    </label>
    <label className="flex items-start justify-between gap-space-md text-body-sm">
      <span className="flex flex-col">
        <span className="text-on-surface">Khởi động cùng Windows</span>
        <span className="text-label-sm text-on-surface-variant">
          {p && !p.launchAtLoginSupported ? "Chỉ có ở bản cài đặt (không áp dụng khi chạy bản dev)." : "Bật máy là app tự chạy ẩn dưới khay để không lỡ lịch đăng bài."}
        </span>
      </span>
      <Switch
        label="Khởi động cùng Windows"
        checked={!!p?.launchAtLogin}
        disabled={!p?.launchAtLoginSupported || set.isPending}
        onChange={(v) => update({ launchAtLogin: v })}
      />
    </label>
  </Card>;
}
