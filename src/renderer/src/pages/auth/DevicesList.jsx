import { useApiQuery, useApiMutation } from "../../lib/api";
import { Laptop, LoaderCircle, Trash } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { confirmDialog } from "../../components/ui/confirm";
import { toast } from "../../components/ui/toast";
import { formatRelative } from "../../lib/format";
import { useRefreshLicense } from "../../components/billing/BuyPlanDialog";

export function DevicesList({ maxDevices }) {
  const { data, isLoading, error } = useApiQuery("license.devices", void 0, { staleTime: 3e4 });
  const remove = useApiMutation("license.removeDevice", ["license.", "auth."]);
  const refresh = useRefreshLicense();
  const doRemove = async (id, name) => {
    const ok = await confirmDialog({
      title: "Gỡ máy",
      message: `Gỡ "${name}" khỏi tài khoản? Máy đó sẽ phải đăng nhập lại để dùng tiếp.`,
      confirmLabel: "Gỡ máy",
      danger: true,
    });
    if (!ok) return;
    remove.mutate(
      { id },
      { onSuccess: () => (toast.success("Đã gỡ máy"), void refresh()), onError: (e) => toast.error(e.message) },
    );
  };
  if (isLoading) return <LoaderCircle size={16} className="animate-spin text-on-surface-variant" />;
  if (error) return <p className="text-body-sm text-error">{error.message}</p>;
  return (
    <div className="flex flex-col gap-space-xs">
      <div className="text-label-sm text-on-surface-variant">
        {"Đang dùng "}
        {data?.length ?? 0}
        {maxDevices ? ` / ${maxDevices}` : ""}
        {" máy"}
      </div>
      {data?.map((d) => (
        <div
          key={d.id}
          className="flex items-center gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-space-sm py-space-xs"
        >
          <Laptop size={16} className="shrink-0 text-secondary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-space-xs truncate text-body-sm text-on-surface">
              {d.name ?? "Máy không tên"} {d.current && <Badge tone="primary">Máy này</Badge>}
            </div>
            <div className="truncate text-label-sm text-on-surface-variant">
              {d.os}
              {" · v"}
              {d.appVersion ?? "?"}
              {" · hoạt động "}
              {formatRelative(new Date(d.lastSeenAt))}
              {d.activeChannels != null ? ` · ${d.activeChannels} kênh` : ""}
            </div>
          </div>
          {!d.current && (
            <Button
              size="sm"
              variant="subtle"
              disabled={remove.isPending}
              onClick={() => void doRemove(d.id, d.name ?? "máy này")}
            >
              <Trash size={13} />
              {" Gỡ"}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
