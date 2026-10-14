import { cn } from "../../lib/cn";
import { Card } from "./Card";

export function KpiTile({
  label,
  value,
  unit,
  aside,
  footer,
  valueClassName
}) {
  return <Card className="flex flex-col justify-between gap-space-sm bg-surface-container p-space-md transition-colors hover:bg-surface-container-high">
    <div className="flex items-start justify-between gap-space-sm">
      <span className="text-label-sm uppercase tracking-wider text-outline">{label}</span>
      {aside}
    </div>
    <div className="flex items-baseline gap-space-xs">
      <span className={cn("text-display tabular text-on-surface", valueClassName)}>{value}</span>
      {unit && <span className="text-body-sm text-on-surface-variant">{unit}</span>}
    </div>
    {footer && <div className="text-label-sm text-on-surface-variant">{footer}</div>}
  </Card>;
}
