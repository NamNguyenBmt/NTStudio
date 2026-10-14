import { useApiQuery } from "../lib/api";
import { useNavigate } from "react-router-dom";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "./ui/Button";
import { FEATURE_LABEL } from "../../../shared/features";
import { cheapestPlanWith, vnd } from "./billing/BuyPlanDialog";

function useFeature(code) {
  const { data: lic } = useApiQuery("license.state", void 0, { staleTime: 6e4 });
  return { locked: !!code && !!lic && !lic.features.includes(code) };
}

export function FeatureGate({ feature, children }) {
  const { locked } = useFeature(feature);
  if (!locked) return <>{children}</>;
  return (
    <>
      <div className="sticky -top-gutter z-20 -mx-gutter -mt-gutter mb-gutter">
        <UpgradeBar feature={feature} />
      </div>
      <fieldset
        disabled={true}
        aria-label={`${FEATURE_LABEL[feature]} – chỉ xem`}
        className="m-0 min-w-0 border-0 p-0 opacity-75"
      >
        {children}
      </fieldset>
    </>
  );
}

function UpgradeBar({ feature }) {
  const navigate = useNavigate();
  const { data: lic } = useApiQuery("license.state", void 0, { staleTime: 6e4 });
  const { data: plans } = useApiQuery("billing.plans", void 0, { staleTime: 5 * 6e4 });
  const plan = cheapestPlanWith(plans, feature);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-space-sm border-b border-outline-variant/30 bg-secondary-container/40 px-space-lg py-space-sm text-body-sm text-on-surface">
      <Lock size={16} className="shrink-0 text-secondary" />
      <span className="min-w-0 flex-1">
        <b>{FEATURE_LABEL[feature]}</b>
        {" không có trong gói "}
        {lic?.planName ?? "hiện tại"}
        {" – bạn đang xem ở chế độ chỉ xem."}
        {plan && (
          <>
            {" "}
            {"Mở khóa từ gói "}
            <b>{plan.name}</b>
            {" ("}
            {vnd(plan.priceVnd)}
            {plan.periodLabel ? ` / ${plan.periodLabel}` : ""}).
          </>
        )}
      </span>
      <Button variant="primary" size="sm" onClick={() => navigate("/billing")}>
        <Sparkles size={14} />
        {" Nâng cấp gói"}
      </Button>
    </div>
  );
}
