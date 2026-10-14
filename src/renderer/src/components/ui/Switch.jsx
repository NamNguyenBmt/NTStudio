import { cn } from "../../lib/cn";

export function Switch({
  checked,
  onChange,
  label,
  disabled
}) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
      checked ? "bg-tertiary" : "bg-surface-container-highest"
    )}
  >
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-[18px]" : "translate-x-[3px]"
      )}
    />
  </button>;
}
