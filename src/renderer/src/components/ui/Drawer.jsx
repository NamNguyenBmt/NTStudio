import { useEffect } from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { IconButton } from "./IconButton";

export function Drawer({ open, onClose, title, width = 440, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const w = Math.max(400, Math.min(820, Math.round(width * 1.25)));
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          role="dialog"
          aria-label={typeof title === "string" ? title : void 0}
          initial={{ x: w, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: w, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          style={{ width: w, maxWidth: "92vw" }}
          className="fixed bottom-statusbar right-0 top-titlebar z-30 flex flex-col border-l border-overlay/[0.08] bg-surface-container-low shadow-flyout"
        >
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-overlay/[0.06] px-space-md">
            <h3 className="truncate text-label-md uppercase tracking-wider text-on-surface-variant">{title}</h3>
            <IconButton icon={X} label="Đóng" onClick={onClose} />
          </header>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-space-md">{children}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
