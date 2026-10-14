import { useState, useRef, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, PanelLeft, Search } from "lucide-react";
import { navItems } from "../../app/nav";
import { cn } from "../../lib/cn";
import { AnimatePresence, motion } from "framer-motion";
import { Kbd } from "../ui/Kbd";
import { useUiStore } from "../../stores/ui";
import { normalize } from "../../lib/media";

export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const toggleRail = useUiStore((s) => s.toggleRail);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const commands = useMemo(
    () => [
      ...navItems.map((n) => ({
        id: `nav:${n.path}`,
        label: n.label,
        group: "Điều hướng",
        icon: n.icon,
        shortcut: n.shortcut,
        run: () => navigate(n.path),
      })),
      {
        id: "ui:rail",
        label: "Thu gọn / mở rộng thanh điều hướng",
        group: "Giao diện",
        icon: PanelLeft,
        shortcut: "Ctrl+B",
        run: toggleRail,
      },
    ],
    [navigate, toggleRail],
  );
  const results = useMemo(() => {
    const q = normalize(query.trim());
    return q ? commands.filter((c) => normalize(c.label).includes(q)) : commands;
  }, [commands, query]);
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  useEffect(() => setCursor(0), [query]);
  const exec = (cmd) => {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      exec(results[cursor]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-label="Bảng lệnh"
            initial={{ y: -8, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: -8, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-[560px] overflow-hidden rounded-2xl bg-surface shadow-modal"
          >
            <div className="flex items-center gap-space-sm border-b border-overlay/[0.06] px-space-md">
              <Search size={16} className="text-on-surface-variant" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Gõ lệnh hoặc tên trang..."
                className="h-11 flex-1 bg-transparent text-body-md text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus-visible:ring-0"
              />
              <Kbd>Esc</Kbd>
            </div>
            <ul className="scroll-thin max-h-[360px] overflow-y-auto p-1">
              {results.length === 0 && (
                <li className="px-space-md py-space-lg text-center text-body-sm text-on-surface-variant">
                  Không tìm thấy lệnh phù hợp
                </li>
              )}
              {results.map((cmd, i) => (
                <li key={cmd.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => exec(cmd)}
                    className={cn(
                      "relative flex h-9 w-full items-center gap-space-md rounded px-space-md text-left text-body-sm text-on-surface-variant",
                      i === cursor && "bg-overlay/[0.06] text-on-surface",
                    )}
                  >
                    {i === cursor && (
                      <span className="absolute left-0 top-2 h-5 w-[3px] rounded-full bg-primary-container" />
                    )}
                    <cmd.icon size={16} strokeWidth={1.75} />
                    <span className="flex-1 truncate">{cmd.label}</span>
                    <span className="text-label-sm text-outline">{cmd.group}</span>
                    {cmd.shortcut && <Kbd>{cmd.shortcut}</Kbd>}
                    {i === cursor && <CornerDownLeft size={14} className="text-outline" />}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
