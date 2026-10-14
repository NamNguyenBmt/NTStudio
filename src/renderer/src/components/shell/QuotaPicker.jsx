import { useState, useEffect, useMemo } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { PlatformIcon } from "../PlatformIcon";
import { toast } from "../ui/toast";
import { formatCompact } from "../../lib/format";
import { BuyPlanDialog } from "../billing/BuyPlanDialog";

const INV = ["channels.", "accounts.", "dashboard.", "license."];

export function QuotaPicker({ open: forced, onClose }) {
  const { data: q } = useApiQuery("channels.quota", void 0, { staleTime: 15e3 });
  const { data: lic } = useApiQuery("license.state", void 0, { staleTime: 6e4 });
  const save = useApiMutation("channels.setQuota", INV);
  const [dismissed, setDismissed] = useState(null);
  const key = q ? `${q.used}:${q.blocked}:${q.limit}` : "";
  const [picked, setPicked] = useState(new Set());
  const [buy, setBuy] = useState(false);
  const open = !!q && (forced || (q.needsPick && dismissed !== key));
  useEffect(() => {
    if (open && q) setPicked(new Set(q.channels.filter((c) => c.active).map((c) => c.id)));
  }, [open, q]);
  const sorted = useMemo(
    () => [...(q?.channels ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || b.followers - a.followers),
    [q],
  );
  if (!q) return null;
  const limit = q.limit;
  const over = limit !== null && picked.size > limit;
  const close = () => {
    setDismissed(key);
    onClose?.();
  };
  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <>
      <Dialog
        open={open}
        onClose={close}
        width={620}
        title={limit === null ? "Kênh đang dùng" : `Gói của bạn dùng tối đa ${limit} kênh`}
        description={
          limit === null
            ? "Gói hiện tại không giới hạn số kênh."
            : `Chọn tối đa ${limit} kênh để dùng. Kênh không chọn chuyển "Ngoài hạn mức": không xóa, chỉ tạm dừng đăng bài – đổi lại bất cứ lúc nào, hoặc nâng gói để dùng thêm.`
        }
        footer={
          <>
            {limit !== null && (
              <Button variant="subtle" className="mr-auto" onClick={() => setBuy(true)}>
                Nâng cấp gói
              </Button>
            )}
            <Button variant="subtle" onClick={close}>
              Để sau
            </Button>
            <Button
              variant="primary"
              disabled={over || save.isPending}
              onClick={() =>
                save.mutate(
                  { activeIds: [...picked] },
                  {
                    onSuccess: (r) => (
                      toast.success(`Đang dùng ${r.used} kênh${r.blocked ? ` · ${r.blocked} kênh ngoài hạn mức` : ""}`),
                      close()
                    ),
                    onError: (e) => toast.error(e.message),
                  },
                )
              }
            >
              {save.isPending && <LoaderCircle size={14} className="animate-spin" />}
              {" Lưu lựa chọn"}
            </Button>
          </>
        }
      >
        <div className="mb-space-sm flex items-center justify-between text-body-sm">
          <span className={cn(over ? "text-error" : "text-on-surface-variant")}>
            {"Đã chọn "}
            {picked.size}
            {limit !== null ? ` / ${limit}` : ""}
            {" kênh"}
            {over ? ` – bỏ bớt ${picked.size - limit}` : ""}
          </span>
          {lic?.planName && <Badge tone="primary">{lic.planName}</Badge>}
        </div>
        <ul className="scroll-thin flex max-h-[420px] flex-col gap-1 overflow-y-auto">
          {sorted.map((c) => {
            const on = picked.has(c.id);
            return (
              <li key={c.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-space-sm rounded-lg border px-space-sm py-space-xs",
                    on ? "border-primary/40 bg-primary/5" : "border-outline-variant/30 bg-surface-container-lowest",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(c.id)}
                    className="h-4 w-4 accent-primary-container"
                  />
                  <PlatformIcon platform={c.platform} size={16} />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-on-surface">{c.name}</span>
                  <span className="font-mono text-label-sm text-on-surface-variant">
                    {formatCompact(c.followers)}
                    {" follow"}
                  </span>
                  {c.quotaBlocked && <Badge tone="warning">Ngoài hạn mức</Badge>}
                </label>
              </li>
            );
          })}
        </ul>
      </Dialog>
      <BuyPlanDialog open={buy} onClose={() => setBuy(false)} currentPlan={lic?.plan ?? null} />
    </>
  );
}
