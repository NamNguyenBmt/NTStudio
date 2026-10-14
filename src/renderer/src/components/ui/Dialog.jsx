import { useRef, useEffect } from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { IconButton } from "./IconButton";

export function Dialog({ open, onClose, title, description, children, footer, width = 520 }) {
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    requestAnimationFrame(() => {
      panelRef.current?.querySelector("input, select, textarea, button:not([data-dialog-close])")?.focus();
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-space-lg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={onClose}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            initial={{ y: 8, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ width: Math.round(width * 1.2) }}
            className="flex max-h-full max-w-full flex-col rounded-2xl bg-surface shadow-modal"
          >
            <header className="flex items-start justify-between gap-space-md border-b border-overlay/[0.06] p-space-md">
              <div>
                <h2 className="text-headline-sm text-on-surface">{title}</h2>
                {description && <p className="mt-0.5 text-body-sm text-on-surface-variant">{description}</p>}
              </div>
              <IconButton icon={X} label="Đóng" onClick={onClose} data-dialog-close={true} />
            </header>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-space-md">{children}</div>
            {footer && (
              <footer className="flex justify-end gap-space-sm border-t border-overlay/[0.06] p-space-md">
                {footer}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
