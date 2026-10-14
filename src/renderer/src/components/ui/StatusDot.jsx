import { cn } from "../../lib/cn";

const colors = {
  ok: "bg-success",
  warn: "bg-warning",
  error: "bg-danger",
  idle: "bg-outline"
};

export function StatusDot({ health, live, className }) {
  return <span
    className={cn(
      "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
      colors[health],
      live && health === "ok" && "animate-halo",
      className
    )}
    aria-hidden={true}
  />;
}
