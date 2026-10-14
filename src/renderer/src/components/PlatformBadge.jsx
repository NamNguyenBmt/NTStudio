import { cn } from "../lib/cn";
import { PlatformIcon } from "./PlatformIcon";

const labels = {
  facebook: "FB",
  tiktok: "TikTok",
  instagram: "IG",
  youtube: "YT"
};

export function PlatformBadge({
  platform,
  label,
  className
}) {
  return <span
    className={cn(
      "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-bold uppercase leading-none text-white",
      platform === "facebook" && "bg-brand-facebook",
      platform === "tiktok" && "bg-brand-tiktok ring-1 ring-white/10",
      platform === "instagram" && "bg-brand-instagram",
      platform === "youtube" && "bg-brand-youtube",
      className
    )}
  >
    <PlatformIcon platform={platform} size={11} colored={false} />
    {label ?? labels[platform]}
  </span>;
}
