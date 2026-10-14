import { cn } from "../../lib/cn";

export function Card({ className, ...props }) {
  return <div className={cn("rounded-xl border border-overlay/[0.06] bg-surface-container-low", className)} {...props} />;
}

export function CardHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className
}) {
  return <div className={cn("flex items-start justify-between gap-space-md p-space-md pb-space-sm", className)}>
    <div className="min-w-0">
      <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
        {Icon && <Icon size={18} className="shrink-0 text-secondary" strokeWidth={1.75} />}
        <span className="truncate">{title}</span>
      </h2>
      {subtitle && <p className="mt-0.5 text-body-sm text-on-surface-variant">{subtitle}</p>}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-space-sm">{actions}</div>}
  </div>;
}
