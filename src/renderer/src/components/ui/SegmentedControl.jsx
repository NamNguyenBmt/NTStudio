import { cn } from "../../lib/cn";

export function SegmentedControl({ value, options, onChange, label, className }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-lg bg-surface-container-lowest p-0.5", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded px-space-md text-label-md transition-colors",
            o.value === value
              ? "bg-surface-container-high text-on-surface shadow-highlight"
              : "text-on-surface-variant hover:text-on-surface",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
