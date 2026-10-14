import { cn } from "../../lib/cn";

export function Kbd({ children, className }) {
  return (
    <kbd
      className={cn(
        "rounded bg-surface-container-highest px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
