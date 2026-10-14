import { useId } from "react";
import { cn } from "../../lib/cn";

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className
}) {
  const id = useId();
  return <div className={cn("flex flex-col gap-1", className)}>
    <label htmlFor={id} className="text-label-md text-on-surface-variant">
      {label}
      {required && <span className="ml-0.5 text-error">*</span>}
    </label>
    {children(id)}
    {error ? <p className="text-label-sm text-error">{error}</p> : hint ? <p className="text-label-sm text-outline">{hint}</p> : null}
  </div>;
}
