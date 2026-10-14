import { cn } from "../../lib/cn";
import { PlatformIcon } from "../../components/PlatformIcon";

const platformDot = {
  facebook: { cls: "bg-brand-facebook", letter: "f" },
  tiktok: { cls: "bg-brand-tiktok ring-1 ring-brand-tiktok-cyan", letter: "♪" },
  instagram: { cls: "bg-brand-instagram", letter: "IG" },
  youtube: { cls: "bg-brand-youtube", letter: "▶" }
};

export function PlatformAvatar({ name, platform, size = 36 }) {
  const p = platformDot[platform];
  const initials = name.split(/\s+/).slice(-2).map((w) => w[0]).join("").toUpperCase();
  return <div className="relative shrink-0" style={{ width: size, height: size }}>
    <div className="flex h-full w-full items-center justify-center rounded-full bg-surface-container-highest text-label-md text-on-surface">
      {initials}
    </div>
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-2 ring-surface-container-low",
        p.cls
      )}
      aria-hidden={true}
    >
      <PlatformIcon platform={platform} size={9} colored={false} />
    </span>
  </div>;
}
