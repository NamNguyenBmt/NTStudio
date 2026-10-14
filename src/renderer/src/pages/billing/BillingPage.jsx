import { useState } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { BadgeCheck, CalendarClock, CreditCard, LoaderCircle, MonitorSmartphone, Radio, RefreshCw, Workflow } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { toast } from "../../components/ui/toast";
import { formatRelative } from "../../lib/format";
import { vnd, useRefreshLicense, PlanCard, OrderPayment, BuyPlanDialog } from "../../components/billing/BuyPlanDialog";
import { DevicesList } from "../auth/DevicesList";

const date = (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "—";
const dateTime = (d) => d ? new Date(d).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";

const ORDER_STATUS = {
  PENDING: ["Chờ thanh toán", "warning"],
  PAID: ["Đã thanh toán", "success"],
  CANCELED: ["Đã hủy", "neutral"],
  EXPIRED: ["Hết hạn chờ", "neutral"]
};

export function BillingPage() {
  const { data: lic } = useApiQuery("license.state", void 0, { refetchInterval: 6e4 });
  const { data: quota } = useApiQuery("channels.quota", void 0, { staleTime: 15e3 });
  const { data: plans, isLoading: loadingPlans } = useApiQuery("billing.plans", void 0, { staleTime: 5 * 6e4 });
  const recheck = useApiMutation("license.refresh", ["auth.", "license.", "channels."]);
  const [buyCode, setBuyCode] = useState(null);
  if (!lic) return <LoaderCircle size={18} className="animate-spin text-on-surface-variant" />;
  const daysLeft = lic.entitlementEndsAt ? Math.ceil((new Date(lic.entitlementEndsAt).getTime() - Date.now()) / 864e5) : null;
  return <div className="flex flex-col gap-space-lg">
    <Card className="flex flex-col gap-space-md p-space-md">
      <div className="flex flex-wrap items-start justify-between gap-space-md">
        <div className="flex gap-space-md">
          <BadgeCheck size={28} className="mt-1 shrink-0 text-tertiary" />
          <div>
            <div className="flex flex-wrap items-center gap-space-sm">
              <h1 className="text-headline-md text-on-surface">{lic.planName ?? "Chưa có gói"}</h1>
              {lic.trial && <Badge tone="secondary">Dùng thử</Badge>}
              {lic.status === "offline" && <Badge tone="warning">Ngoại tuyến</Badge>}
            </div>
            <div className="mt-1 flex items-center gap-1 text-body-sm text-on-surface-variant">
              <CalendarClock size={14} />
              {lic.entitlementEndsAt ? <>
                {"Hết hạn "}
                {date(lic.entitlementEndsAt)}
                <span className={daysLeft != null && daysLeft <= 7 ? "font-semibold text-warning" : ""}>
                  {" · còn "}
                  {Math.max(daysLeft ?? 0, 0)}
                  {" ngày"}
                </span>
              </> : "Không thời hạn"}
            </div>
            <div className="mt-0.5 text-label-sm text-outline">
              {"Cập nhật "}
              {lic.lastOnlineAt ? formatRelative(new Date(lic.lastOnlineAt)) : "—"}
            </div>
          </div>
        </div>
        <Button
          variant="subtle"
          disabled={recheck.isPending}
          onClick={() => recheck.mutate(void 0, { onSuccess: () => toast.success("Đã cập nhật gói từ NT Cloud"), onError: (e) => toast.error(e.message) })}
        >
          {recheck.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {" Cập nhật"}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-3">
        <Limit icon={Radio} label="Kênh đang dùng" value={lic.maxChannels == null ? `${quota?.used ?? "…"} · không giới hạn` : `${quota?.used ?? "…"} / ${lic.maxChannels}`} warn={!!quota?.blocked} />
        <Limit icon={MonitorSmartphone} label="Số máy" value={lic.maxDevices == null ? "—" : `tối đa ${lic.maxDevices}`} />
        <Limit icon={Workflow} label="Luồng Google Flow" value={lic.flowThreads == null ? "Không giới hạn" : `${lic.flowThreads} song song`} />
      </div>
    </Card>
    <section className="flex flex-col gap-space-md">
      <h2 className="text-label-md uppercase tracking-wider text-on-surface-variant">
        {lic.trial || !lic.plan ? "Chọn gói" : "Gia hạn / đổi gói"}
      </h2>
      {loadingPlans ? <LoaderCircle size={16} className="animate-spin text-on-surface-variant" /> : <div className="grid grid-cols-1 gap-space-md md:grid-cols-3">
        {plans?.map((p) => <PlanCard key={p.id} plan={p} current={p.code === lic.plan} busy={false} onBuy={() => setBuyCode(p.code)} />)}
      </div>}
    </section>
    <div className="grid grid-cols-1 items-start gap-space-md xl:grid-cols-[1fr_1.4fr]">
      <Card className="flex flex-col gap-space-sm p-space-md">
        <h2 className="flex items-center gap-space-sm text-label-md text-on-surface">
          <MonitorSmartphone size={15} className="text-secondary" />
          {" Máy đã kích hoạt"}
        </h2>
        <DevicesList maxDevices={lic.maxDevices} />
      </Card>
      <OrderHistory />
    </div>
    <BuyPlanDialog open={!!buyCode} onClose={() => setBuyCode(null)} currentPlan={lic.plan} planCode={buyCode} />
  </div>;
}

function Limit({ icon: Icon, label, value, warn }) {
  return <div className="rounded-lg bg-surface-container p-space-sm">
    <div className="flex items-center gap-1 text-label-sm text-on-surface-variant"><Icon size={12} />{" "}{label}</div>
    <div className={warn ? "mt-0.5 text-label-md text-warning" : "mt-0.5 text-label-md text-on-surface"}>{value}</div>
  </div>;
}

function OrderHistory() {
  const { data: orders, isLoading, error, refetch, isFetching } = useApiQuery("billing.orders", void 0, { staleTime: 3e4 });
  const [pay, setPay] = useState(null);
  const refresh = useRefreshLicense();
  return <Card className="flex flex-col gap-space-sm p-space-md">
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-space-sm text-label-md text-on-surface">
        <CreditCard size={15} className="text-secondary" />
        {" Lịch sử mua gói"}
      </h2>
      <Button size="sm" variant="subtle" disabled={isFetching} onClick={() => void refetch()}>
        {isFetching ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        {" Tải lại"}
      </Button>
    </div>
    {isLoading ? <LoaderCircle size={16} className="animate-spin text-on-surface-variant" /> : error ? <p className="text-body-sm text-error">{error.message}</p> : !orders?.length ? <p className="text-body-sm text-on-surface-variant">Chưa có đơn mua gói nào.</p> : <div className="scroll-thin overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="border-b border-outline-variant/30 text-left text-label-sm uppercase tracking-wider text-outline">
            <th className="py-1.5 pr-space-sm font-medium">Mã đơn</th>
            <th className="py-1.5 pr-space-sm font-medium">Gói</th>
            <th className="py-1.5 pr-space-sm text-right font-medium">Số tiền</th>
            <th className="py-1.5 pr-space-sm font-medium">Ngày tạo</th>
            <th className="py-1.5 pr-space-sm font-medium">Thanh toán</th>
            <th className="py-1.5 font-medium">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => <tr key={o.id} className="border-b border-outline-variant/15 last:border-0">
            <td className="py-1.5 pr-space-sm font-mono text-label-sm text-on-surface">{o.code}</td>
            <td className="py-1.5 pr-space-sm text-on-surface">{o.planName}</td>
            <td className="py-1.5 pr-space-sm text-right tabular text-on-surface">{vnd(o.amountVnd)}</td>
            <td className="py-1.5 pr-space-sm text-on-surface-variant">{dateTime(o.createdAt)}</td>
            <td className="py-1.5 pr-space-sm text-on-surface-variant">{o.paidAt ? dateTime(o.paidAt) : "—"}</td>
            <td className="py-1.5">
              <div className="flex items-center gap-space-xs">
                <Badge tone={ORDER_STATUS[o.status][1]}>{ORDER_STATUS[o.status][0]}</Badge>
                {(o.status === "PENDING" || o.status === "EXPIRED") && o.qrUrl && <Button size="sm" variant="primary" onClick={() => setPay(o)}>Thanh toán</Button>}
              </div>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}
    <Dialog open={!!pay} onClose={() => setPay(null)} width={620} title={`Thanh toán đơn ${pay?.code ?? ""}`} description={pay ? `${pay.planName} · ${vnd(pay.amountVnd)}` : void 0}>
      {pay && <OrderPayment
        order={pay}
        onPaid={() => {
          toast.success("Thanh toán thành công – gói đã được kích hoạt");
          void refresh();
        }}
      />}
    </Dialog>
  </Card>;
}
