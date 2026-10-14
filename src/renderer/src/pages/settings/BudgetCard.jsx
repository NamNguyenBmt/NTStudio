import { Receipt, Zap } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { Switch } from "../../components/ui/Switch";
import { Progress } from "../../components/ui/Progress";

export function BudgetCard({ budget, draft, onDraft }) {
  const cap = budget?.hardCapUsd ?? 0;
  const spent = budget?.spentUsd ?? 0;
  const pct = cap ? Math.min(100, (spent / cap) * 100) : 0;
  const capNum = Number(draft.hardCapUsd);
  const capInvalid = draft.hardCapUsd.trim() === "" || !Number.isFinite(capNum) || capNum < 0;
  return (
    <Card className="flex flex-col gap-space-md p-space-md">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
          <Receipt size={18} className="text-secondary" />
          {" Hạn mức & Chi phí"}
        </h3>
        <span className="font-mono text-code text-outline">
          {"Tháng "}
          {budget?.month.split("-").reverse().join("/") ?? "—"}
        </span>
      </div>
      <div className="rounded-xl bg-surface-container-lowest p-space-md">
        <div className="flex items-baseline justify-between gap-space-sm">
          <span className="text-label-md text-on-surface-variant">Chi phí thực tế tiêu thụ</span>
          <span>
            <span className="text-display tabular text-on-surface">${spent.toFixed(2)}</span>
            <span className="ml-1 font-mono text-code text-outline">/ ${cap.toFixed(2)}</span>
          </span>
        </div>
        <Progress
          value={pct}
          className="mt-space-sm"
          barClassName={pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-secondary"}
        />
        <div className="mt-1.5 flex justify-between font-mono text-code">
          <span className="text-on-surface-variant">
            {"Tiêu thụ: "}
            {pct.toFixed(1)}%
          </span>
          <span className="text-tertiary">Còn lại: ${Math.max(0, cap - spent).toFixed(2)}</span>
        </div>
      </div>
      <div>
        <div className="mb-1 text-label-sm uppercase tracking-wider text-outline">Phân bổ chi phí theo API</div>
        <ul className="flex flex-col">
          {budget?.byProvider.length === 0 && (
            <li className="text-body-sm text-on-surface-variant">Chưa phát sinh chi phí tháng này.</li>
          )}
          {budget?.byProvider.map((p) => (
            <li key={p.providerId ?? p.label} className="flex justify-between py-1 font-mono text-code">
              <span className="text-on-surface">{p.label}</span>
              <span className="tabular text-on-surface">${p.usd.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
      <Field label="Hạn mức cứng hàng tháng (USD)" error={capInvalid ? "Nhập số ≥ 0" : null}>
        {(id) => (
          <Input
            id={id}
            inputMode="decimal"
            value={draft.hardCapUsd}
            onChange={(e) => onDraft({ ...draft, hardCapUsd: e.target.value })}
          />
        )}
      </Field>
      <div className="flex items-start justify-between gap-space-md rounded-xl bg-surface-container p-space-sm">
        <div>
          <div className="flex items-center gap-1 text-label-md text-on-surface">
            <Zap size={14} className="text-warning" />
            {" Tự động ngắt khẩn cấp (Circuit Breaker)"}
          </div>
          <p className="mt-0.5 text-label-sm text-on-surface-variant">
            Dừng toàn bộ worker AI và tiến trình render khi chi phí chạm $
            {Number.isFinite(capNum) ? capNum.toFixed(2) : "—"}
            {" để tránh phát sinh ngoài ý muốn."}
          </p>
        </div>
        <Switch
          checked={draft.circuitBreaker}
          onChange={(v) => onDraft({ ...draft, circuitBreaker: v })}
          label="Circuit Breaker"
        />
      </div>
    </Card>
  );
}
