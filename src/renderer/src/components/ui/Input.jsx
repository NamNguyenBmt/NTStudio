import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

const fieldBase =
  "w-full rounded bg-surface-container-lowest/60 text-body-sm text-on-surface placeholder:text-on-surface-variant/50 border border-overlay/[0.12] border-b-2 border-b-overlay/[0.12] transition-colors focus:border-b-primary-container focus:outline-none focus-visible:ring-0 disabled:opacity-50";

export const Input = forwardRef(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-8 px-space-sm", className)} {...props} />
));

Input.displayName = "Input";

export const Textarea = forwardRef(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-[80px] resize-y px-space-sm py-1.5", className)} {...props} />
));

Textarea.displayName = "Textarea";

export const Select = forwardRef(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select ref={ref} className={cn(fieldBase, "h-8 appearance-none pl-space-sm pr-7", className)} {...props}>
      {children}
    </select>
    <ChevronDown
      size={14}
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant"
    />
  </div>
));

Select.displayName = "Select";
