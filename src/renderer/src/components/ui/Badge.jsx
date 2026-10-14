import { cn } from "../../lib/cn";

const tones = {
  neutral: "bg-surface-container-highest text-on-surface-variant",
  primary: "bg-primary/15 text-primary",
  secondary: "bg-secondary/15 text-secondary",
  success: "bg-success/15 text-tertiary",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-error",
};

export function Badge({ tone = "neutral", pill, mono, className, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-0.5 text-label-sm",
        pill ? "rounded-full px-2" : "rounded",
        mono && "font-mono tabular",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
