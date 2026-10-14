import { cn } from "../../lib/cn";

export function Progress({ value, className, barClassName }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-container-lowest", className)}
    >
      <div
        className={cn("h-full rounded-full bg-secondary transition-[width] duration-300", barClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
