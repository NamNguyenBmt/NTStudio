import { useApiQuery, useApiMutation } from "../../lib/api";
import { FolderInput, FolderOpen, HardDrive, LoaderCircle, MoveRight } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { confirmDialog } from "../../components/ui/confirm";
import { toast } from "../../components/ui/toast";
import { formatBytes } from "../content/VariantsPanel";

export function DataLocationCard() {
  const { data } = useApiQuery("storage.location", void 0, { refetchInterval: 6e4 });
  const open = useApiMutation("storage.openRoot");
  const move = useApiMutation("storage.move");
  const useExisting = useApiMutation("storage.useExisting");
  const runMove = async () => {
    const ok = await confirmDialog({
      title: "Chuyển thư mục dữ liệu",
      message: `App sẽ chép toàn bộ dữ liệu (${data ? formatBytes(data.sizeBytes) : "…"}) sang thư mục bạn chọn rồi tự khởi động lại.
• Các tác vụ đang chạy (render, đăng bài) sẽ dừng – chạy lại sau khi khởi động.
• Bản cũ vẫn giữ nguyên ở vị trí cũ – xóa thủ công khi đã kiểm tra dữ liệu mới.
• Thư mục đã có file khác: app tạo thư mục con "OmniPage Data".`,
      confirmLabel: "Chọn thư mục & chuyển",
    });
    if (!ok) return;
    move.mutate(void 0, {
      onSuccess: (r) => (r.moved ? toast.success(`Đã chép dữ liệu sang ${r.root} – app đang khởi động lại…`) : void 0),
      onError: (e) => toast.error(e.message),
    });
  };
  const runUseExisting = async () => {
    const ok = await confirmDialog({
      title: "Dùng thư mục dữ liệu có sẵn",
      message:
        "Chọn thư mục dữ liệu OmniPage đã sao lưu (vd chép từ máy cũ). App sẽ khởi động lại và dùng thư mục đó – đăng nhập bằng email / mật khẩu của dữ liệu đó.",
      confirmLabel: "Chọn thư mục",
    });
    if (!ok) return;
    useExisting.mutate(void 0, {
      onSuccess: (r) => r.changed && toast.success("Đang khởi động lại với thư mục dữ liệu mới…"),
      onError: (e) => toast.error(e.message),
    });
  };
  const busy = move.isPending || useExisting.isPending;
  return (
    <Card className="flex flex-col gap-space-sm p-space-md">
      <h3 className="flex items-center gap-space-sm text-label-md text-on-surface">
        <HardDrive size={15} className="text-secondary" />
        {" Thư mục dữ liệu & chuyển máy"}
      </h3>
      <p className="break-all font-mono text-[11px] text-on-surface-variant" title={data?.root}>
        {data?.root ?? "…"}
      </p>
      <p className="text-label-sm text-outline">
        {data
          ? `${formatBytes(data.sizeBytes)} dữ liệu${data.freeBytes != null ? ` · ổ đĩa còn trống ${formatBytes(data.freeBytes)}` : ""}${data.isDefault ? " · thư mục mặc định" : ""}`
          : ""}
      </p>
      <div className="flex flex-wrap gap-space-xs">
        <Button size="sm" variant="subtle" onClick={() => open.mutate(void 0)}>
          <FolderOpen size={13} />
          {" Mở thư mục"}
        </Button>
        <Button size="sm" variant="subtle" disabled={busy} onClick={() => void runMove()}>
          {move.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <MoveRight size={13} />}{" "}
          {move.isPending ? "Đang chép dữ liệu…" : "Chuyển sang thư mục khác…"}
        </Button>
        <Button size="sm" variant="subtle" disabled={busy} onClick={() => void runUseExisting()}>
          <FolderInput size={13} />
          {" Dùng thư mục có sẵn…"}
        </Button>
      </div>
      <div className="rounded-lg bg-surface-container-lowest p-space-sm text-label-sm text-on-surface-variant">
        <b className="text-on-surface">Đổi máy tính:</b>
        <ol className="mt-1 list-decimal pl-5">
          <li>Tắt hẳn app, sao lưu nguyên thư mục trên (ổ cứng ngoài, Google Drive…).</li>
          <li>Cài OmniPage trên máy mới, chép thư mục sang.</li>
          <li>Màn hình đăng nhập → "Dùng thư mục dữ liệu có sẵn" → chọn thư mục đó.</li>
          <li>
            {
              "Đăng nhập bằng email & mật khẩu cũ – API key, token kênh tự mở lại (két được mã hóa thêm bằng mật khẩu đăng nhập)."
            }
          </li>
        </ol>
        <p className="mt-1 text-outline">
          File nằm ngoài thư mục này (vd logo watermark chọn từ ổ khác) không đi kèm – chép riêng nếu cần.
        </p>
      </div>
    </Card>
  );
}
