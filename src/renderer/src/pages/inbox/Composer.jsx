import { useEffect } from "react";
import { cn } from "../../lib/cn";

export const EMOJIS = [
  "😀",
  "😁",
  "😂",
  "🤣",
  "😊",
  "😍",
  "🥰",
  "😘",
  "😉",
  "😎",
  "🤗",
  "🤔",
  "😅",
  "😢",
  "😭",
  "😡",
  "😱",
  "🙏",
  "👍",
  "👎",
  "👏",
  "🙌",
  "💪",
  "👌",
  "✌️",
  "🤝",
  "❤️",
  "💖",
  "💯",
  "🔥",
  "✨",
  "🎉",
  "🎁",
  "⭐",
  "✅",
  "❌",
  "⚡",
  "📌",
  "📞",
  "💬",
  "👉",
  "👇",
  "🎬",
  "🎵",
  "⚽",
  "🏆",
  "🌸",
  "☕",
];
export const TAG_SUGGESTIONS = ["Khách tiềm năng", "Cần gọi lại", "Đã phản hồi", "Hợp tác", "Góp ý", "Spam"];

export function Popover({ open, onClose, children, className }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden={true} />
      <div
        className={cn(
          "absolute bottom-full z-20 mb-1 rounded-xl bg-surface-container-high p-space-sm shadow-flyout",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
