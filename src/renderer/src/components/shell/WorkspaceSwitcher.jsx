import { useState, useRef, useEffect } from "react";
import { useApiQuery } from "../../lib/api";
import { Check, ChevronDown, FolderKanban, Layers } from "lucide-react";
import { cn } from "../../lib/cn";
import { AnimatePresence, motion } from "framer-motion";
import { useUiStore } from "../../stores/ui";

export function WorkspaceSwitcher() {
  const activeId = useUiStore((s) => s.activeWorkspaceId);
  const setActive = useUiStore((s) => s.setActiveWorkspace);
  const { data: workspaces = [] } = useApiQuery("workspaces.list");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = workspaces.find((w) => w.id === activeId) ?? null;
  const totalChannels = workspaces.reduce((sum, w) => sum + w.channelCount, 0);
  useEffect(() => {
    if (activeId && workspaces.length > 0 && !active) setActive(null);
  }, [activeId, active, workspaces.length, setActive]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const choose = (id) => {
    setActive(id);
    setOpen(false);
  };
  const options = [
    { id: null, name: "Tất cả không gian", count: totalChannels, color: null },
    ...workspaces.map((w) => ({ id: w.id, name: w.name, count: w.channelCount, color: w.color }))
  ];
  return <div ref={ref} className="no-drag relative">
    <button
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className="flex h-7 items-center gap-space-xs rounded bg-surface-container-low px-space-sm text-label-sm text-on-surface transition-colors hover:bg-surface-container-high"
    >
      <FolderKanban size={15} className="text-secondary" strokeWidth={1.75} />
      <span className="max-w-[220px] truncate">
        {active ? active.name : "Tất cả không gian"}
        {" "}
        <span className="text-on-surface-variant">({active ? active.channelCount : totalChannels}{" kênh)"}</span>
      </span>
      <ChevronDown size={14} className="text-on-surface-variant" />
    </button>
    <AnimatePresence>
      {open && <motion.ul
        role="listbox"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.12 }}
        className="absolute left-0 top-9 z-50 w-72 rounded-xl bg-surface-container-high p-1 shadow-flyout"
      >
        <li className="px-space-sm py-1 text-label-sm uppercase tracking-wider text-outline">Không gian làm việc</li>
        {options.map((o) => {
          const selected = o.id === (active?.id ?? null);
          return <li key={o.id ?? "all"}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => choose(o.id)}
              className={cn(
                "flex w-full items-center gap-space-sm rounded px-space-sm py-1.5 text-left text-body-sm transition-colors hover:bg-overlay/[0.06]",
                selected && "text-on-surface"
              )}
            >
              {o.color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.color }} /> : <Layers size={12} className="shrink-0 text-on-surface-variant" />}
              <span className="flex-1 truncate">{o.name}</span>
              <span className="font-mono text-code tabular text-on-surface-variant">{o.count}</span>
              {selected ? <Check size={14} className="text-primary" /> : <span className="w-3.5" />}
            </button>
          </li>;
        })}
      </motion.ul>}
    </AnimatePresence>
  </div>;
}
