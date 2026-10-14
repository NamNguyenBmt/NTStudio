import { omni } from "../../lib/api";
import { Copy, Minus, Square, X } from "lucide-react";
import { useSystemStore } from "../../stores/system";

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

export function WindowControls() {
  const isMaximized = useSystemStore((s) => s.window.isMaximized);
  const base = "no-drag flex h-titlebar w-[46px] items-center justify-center text-on-surface-variant transition-colors";
  return <div className="flex items-center">
    <button type="button" aria-label="Thu nhỏ" className={`${base} hover:bg-overlay/[0.06]`} onClick={omni.window.minimize}>
      <Minus size={16} strokeWidth={1.5} />
    </button>
    <button
      type="button"
      aria-label={isMaximized ? "Khôi phục" : "Phóng to"}
      className={`${base} hover:bg-overlay/[0.06]`}
      onClick={omni.window.toggleMaximize}
    >
      {isMaximized ? <Copy size={13} strokeWidth={1.5} className="-scale-x-100" /> : <Square size={13} strokeWidth={1.5} />}
    </button>
    <button
      type="button"
      aria-label="Đóng"
      className={`${base} hover:bg-[#E81123] hover:text-white`}
      onClick={omni.window.close}
    >
      <X size={16} strokeWidth={1.5} />
    </button>
  </div>;
}
