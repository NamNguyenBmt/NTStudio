import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call, useApiQuery } from "../../lib/api";
import { Check, CircleCheck, Copy, ExternalLink, LoaderCircle, MonitorSmartphone, Radio, Workflow } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { toast } from "../ui/toast";
import { FEATURE_LABEL, isFeatureCode, normalizeFeatures } from "../../../../shared/features";

export function cheapestPlanWith(plans, code) {
  return (plans ?? []).filter((p) => normalizeFeatures(p.features).includes(code)).sort((a, b) => a.priceVnd - b.priceVnd)[0] ?? null;
}

export const vnd = (n) => `${n.toLocaleString("vi-VN")}đ`;
const PERIOD = { MONTH: "/ tháng", YEAR: "/ năm", LIFETIME: "trọn đời" };

export function useRefreshLicense() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^(auth\.|license\.|billing\.)/.test(q.queryKey[0]) });
  };
}

function CopyText({ value, mono }) {
  const [ok, setOk] = useState(false);
  return <button
    type="button"
    onClick={() => (void navigator.clipboard.writeText(value), setOk(true), setTimeout(() => setOk(false), 1200))}
    className={cn("inline-flex items-center gap-1 rounded px-1 text-left hover:bg-overlay/[0.06]", mono && "font-mono")}
    title="Chép"
  >
    {value}
    {" "}
    {ok ? <Check size={12} className="text-tertiary" /> : <Copy size={12} className="text-outline" />}
  </button>;
}

export function PlanCard({ plan, current, onBuy, busy }) {
  return <div className={cn("flex flex-col gap-space-sm rounded-xl border p-space-md", current ? "border-primary/50 bg-primary/5" : "border-outline-variant/30 bg-surface-container-lowest")}>
    <div className="flex items-start justify-between gap-space-sm">
      <div>
        <div className="text-body-md font-semibold text-on-surface">{plan.name}</div>
        {plan.description && <div className="text-body-sm text-on-surface-variant">{plan.description}</div>}
      </div>
      {current && <Badge tone="primary">Đang dùng</Badge>}
    </div>
    <div className="text-headline-md text-on-surface">
      {vnd(plan.priceVnd)}
      {" "}
      <span className="text-body-sm font-normal text-on-surface-variant">
        {plan.periodLabel && plan.periodUnit !== "LIFETIME" && (plan.periodCount ?? 1) > 1 ? `/ ${plan.periodLabel}` : PERIOD[plan.billingPeriod]}
      </span>
    </div>
    <ul className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
      <li className="flex items-center gap-1.5">
        <Radio size={13} className="text-secondary" />
        {" "}
        {plan.maxChannels == null ? "Không giới hạn kênh" : `Tối đa ${plan.maxChannels} kênh`}
      </li>
      <li className="flex items-center gap-1.5">
        <MonitorSmartphone size={13} className="text-secondary" />
        {" "}
        {plan.maxDevices}
        {" máy cùng lúc"}
      </li>
      <li className="flex items-center gap-1.5">
        <Workflow size={13} className="text-secondary" />
        {" "}
        {plan.flowThreads == null ? "Google Flow không giới hạn luồng" : `Google Flow ${plan.flowThreads} luồng song song`}
      </li>
      {plan.features.map((f) => <li key={f} className="flex items-center gap-1.5">
        <Check size={13} className="text-tertiary" />
        {" "}
        {isFeatureCode(f) ? FEATURE_LABEL[f] : f}
      </li>)}
    </ul>
    <Button variant={current ? "secondary" : "primary"} className="mt-auto" disabled={busy} onClick={onBuy}>
      {busy ? <LoaderCircle size={14} className="animate-spin" /> : null}
      {" "}
      {current ? "Gia hạn" : "Chọn gói này"}
    </Button>
  </div>;
}

export function OrderPayment({ order, onPaid }) {
  const { data: live } = useApiQuery("billing.order", { code: order.code }, { refetchInterval: (q) => q.state.data?.status === "PAID" ? false : 4e3 });
  const o = live ?? order;
  const paid = o.status === "PAID";
  useEffect(() => {
    if (paid) onPaid();
  }, [paid]);
  if (paid)
    return <div className="flex flex-col items-center gap-space-sm py-space-lg text-center">
      <CircleCheck size={44} className="text-tertiary" />
      <div className="text-headline-sm text-on-surface">Đã nhận thanh toán</div>
      <div className="text-body-sm text-on-surface-variant">
        {"Gói "}
        {o.planName}
        {" đã được kích hoạt cho tài khoản của bạn."}
      </div>
    </div>;
  return <div className="flex flex-col gap-space-md">
    <div className="flex flex-col gap-space-md rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-space-md sm:flex-row">
      {o.qrUrl && <img src={o.qrUrl} alt={`QR chuyển khoản ${o.code}`} className="mx-auto h-48 w-48 shrink-0 rounded-lg bg-white object-contain" />}
      {o.bank && <dl className="grid flex-1 grid-cols-[auto_1fr] content-start gap-x-space-md gap-y-1.5 text-body-sm">
        <dt className="text-on-surface-variant">Ngân hàng</dt>
        <dd className="text-on-surface">{o.bank.code}</dd>
        <dt className="text-on-surface-variant">Số tài khoản</dt>
        <dd><CopyText value={o.bank.accountNo} mono={true} /></dd>
        <dt className="text-on-surface-variant">Chủ tài khoản</dt>
        <dd className="text-on-surface">{o.bank.accountName}</dd>
        <dt className="text-on-surface-variant">Số tiền</dt>
        <dd className="font-semibold text-tertiary">{vnd(o.amountVnd)}</dd>
        <dt className="text-on-surface-variant">Nội dung CK</dt>
        <dd className="font-semibold text-warning"><CopyText value={o.code} mono={true} /></dd>
      </dl>}
    </div>
    <div className="flex flex-wrap items-center gap-space-sm text-body-sm text-on-surface-variant">
      <LoaderCircle size={14} className="animate-spin text-primary" />
      Quét QR bằng app ngân hàng (giữ nguyên nội dung chuyển khoản) – gói tự kích hoạt sau khi tiền về, thường dưới 1 phút.
    </div>
    {o.checkoutUrl && <Button variant="subtle" className="self-start" onClick={() => void call("system.openExternal", { url: o.checkoutUrl })}>
      <ExternalLink size={14} />
      {" Mở trang thanh toán PayOS"}
    </Button>}
  </div>;
}

export function BuyPlanDialog({ open, onClose, currentPlan, planCode }) {
  const { data: plans, isLoading, error } = useApiQuery("billing.plans", void 0, { enabled: open, staleTime: 5 * 6e4 });
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(null);
  const refresh = useRefreshLicense();
  useEffect(() => {
    if (!open) setOrder(null);
  }, [open]);
  useEffect(() => {
    const p = open && planCode && !order && !busy ? plans?.find((x) => x.code === planCode) : null;
    if (p) void buy(p);
  }, [open, planCode, plans]);
  const buy = async (p) => {
    setBusy(p.code);
    try {
      setOrder(await call("billing.createOrder", { planCode: p.code }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  return <Dialog
    open={open}
    onClose={onClose}
    width={order ? 620 : 900}
    title={order ? `Thanh toán đơn ${order.code}` : "Chọn gói Omnira Studio"}
    description={order ? `${order.planName} · ${vnd(order.amountVnd)}` : "Thanh toán chuyển khoản / QR – gói kích hoạt tự động khi tiền về"}
    footer={order ? <>
      <Button variant="subtle" onClick={() => setOrder(null)}>Chọn gói khác</Button>
      <Button variant="primary" onClick={onClose}>Xong</Button>
    </> : void 0}
  >
    {order ? <OrderPayment
      order={order}
      onPaid={() => {
        toast.success("Thanh toán thành công – gói đã được kích hoạt");
        void refresh();
      }}
    /> : isLoading ? <div className="flex items-center justify-center py-space-xl text-on-surface-variant">
      <LoaderCircle size={18} className="animate-spin" />
    </div> : error ? <p className="rounded-lg bg-danger/10 p-space-sm text-body-sm text-error">{error.message}</p> : <div className="grid grid-cols-1 gap-space-md md:grid-cols-3">
      {plans?.map((p) => <PlanCard key={p.id} plan={p} current={p.code === currentPlan} busy={busy === p.code} onBuy={() => void buy(p)} />)}
    </div>}
  </Dialog>;
}
