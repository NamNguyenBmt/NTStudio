import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export const IconButton = forwardRef(
  ({ icon: Icon, label, iconSize = 16, className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors",
        "hover:bg-surface-container-high hover:text-on-surface",
        className,
      )}
      {...props}
    >
      <Icon size={iconSize} strokeWidth={1.75} />
    </button>
  ),
);

IconButton.displayName = "IconButton";
