import { cn } from "../lib/cn";
import { Facebook, TikTok, Instagram, YouTube } from "./icons/brands";

const ICONS = { facebook: Facebook, tiktok: TikTok, instagram: Instagram, youtube: YouTube };

export function PlatformIcon({ platform, size = 16, className, colored = true }) {
  const Icon = ICONS[platform];
  return <Icon size={size} className={cn("shrink-0", className)} colored={colored} />;
}
