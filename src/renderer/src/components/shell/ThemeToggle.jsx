import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../../lib/cn";
import { useUiStore } from "../../stores/ui";
import { resolveTheme } from "../../lib/theme";

const OPTIONS = [
  { value: "system", label: "Theo hệ thống", icon: Monitor },
  { value: "light", label: "Sáng", icon: Sun },
  { value: "dark", label: "Tối", icon: Moon },
];

export function ThemeToggle({ className }) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const dark = resolveTheme(theme) === "dark";
  return (
    <button
      type="button"
      aria-label={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
      title={dark ? "Giao diện sáng" : "Giao diện tối"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={cn(
        "no-drag flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-overlay/[0.06] hover:text-on-surface",
        className,
      )}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function ThemePicker() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-lg bg-surface-container-lowest p-1"
      role="radiogroup"
      aria-label="Giao diện"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => setTheme(o.value)}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded px-1 py-1.5 text-label-sm transition-colors",
            theme === o.value
              ? "bg-primary-container text-on-primary"
              : "text-on-surface-variant hover:bg-overlay/[0.06]",
          )}
        >
          <o.icon size={14} /> {o.label}
        </button>
      ))}
    </div>
  );
}
