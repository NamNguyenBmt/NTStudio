import { forwardRef } from "react";
import "./Badge";
import { cn } from "../../lib/cn";

const variants = {
  primary: "bg-primary text-on-primary hover:bg-primary-container shadow-highlight",
  secondary: "bg-surface-container-high text-on-surface hover:bg-surface-bright shadow-highlight",
  subtle: "bg-white/5 text-on-surface border border-white/10 hover:bg-white/10",
  danger: "bg-error-container text-on-error-container hover:bg-danger"
};

const sizes = {
  md: "h-8 px-space-md gap-1.5 text-label-md",
  sm: "h-[26px] px-space-sm gap-1 text-label-sm"
};

export const Button = forwardRef(
  ({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) => <button
    ref={ref}
    type={type}
    className={cn(
      "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-colors",
      "disabled:pointer-events-none disabled:opacity-50",
      variants[variant],
      sizes[size],
      className
    )}
    {...props}
  />
);

Button.displayName = "Button";
