import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";

const useToastStore = create((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), t.tone === "error" ? 6e3 : 3500);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (message) => useToastStore.getState().push({ tone: "success", message }),
  error: (message) => useToastStore.getState().push({ tone: "error", message }),
  info: (message) => useToastStore.getState().push({ tone: "info", message }),
};

const icons = { success: CircleCheck, error: CircleX, info: Info };

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div
      className="pointer-events-none fixed bottom-10 right-space-md z-[110] flex w-96 flex-col gap-space-sm"
      aria-live="polite"
    >
      <AnimatePresence>
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <motion.div
              key={t.id}
              layout={true}
              initial={{ x: 24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 24, opacity: 0 }}
              className="pointer-events-auto flex items-start gap-space-sm rounded-xl bg-surface-container-high p-space-sm shadow-flyout"
            >
              <Icon
                size={16}
                className={cn(
                  "mt-0.5 shrink-0",
                  t.tone === "success" ? "text-tertiary" : t.tone === "error" ? "text-error" : "text-secondary",
                )}
              />
              <p className="flex-1 text-body-sm text-on-surface">{t.message}</p>
              <button
                type="button"
                aria-label="Đóng thông báo"
                onClick={() => dismiss(t.id)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
