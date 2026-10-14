import { useApiQuery, useApiMutation } from "../../lib/api";
import { FolderInput, LoaderCircle } from "lucide-react";

export function DataFolderLink() {
  const { data } = useApiQuery("storage.location");
  const use = useApiMutation("storage.useExisting");
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-container-lowest p-space-sm text-label-sm text-on-surface-variant">
      <span>
        {"Thư mục dữ liệu: "}
        <span className="break-all font-mono text-[11px]">{data?.root ?? "…"}</span>
      </span>
      <button
        type="button"
        disabled={use.isPending}
        onClick={() => use.mutate(void 0)}
        className="flex items-center gap-1 self-start text-primary hover:underline disabled:opacity-50"
        title="Đổi máy: chọn thư mục dữ liệu OmniPage đã chép từ máy cũ, rồi đăng nhập bằng mật khẩu cũ"
      >
        {use.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <FolderInput size={12} />}
        {" Dùng thư mục dữ liệu có sẵn (chuyển từ máy khác)…"}
      </button>
      {use.error && <span className="text-error">{use.error.message}</span>}
      {use.data?.changed && <span className="text-tertiary">Đang khởi động lại với thư mục dữ liệu mới…</span>}
    </div>
  );
}
