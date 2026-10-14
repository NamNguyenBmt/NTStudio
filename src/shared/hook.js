export const HOOK_PLATFORM_LABEL = {
  facebook: "Facebook",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

export const HEALTH_LABEL = {
  ok: { label: "Đạt chuẩn", tone: "success" },
  warn: { label: "Nên sửa", tone: "warning" },
  risk: { label: "Rủi ro cao", tone: "danger" },
};

export function hookGrade(score) {
  if (score >= 75) return { label: "Hook mạnh", tone: "success" };
  if (score >= 55) return { label: "Tạm được", tone: "warning" };
  return { label: "Hook yếu", tone: "danger" };
}

export function hookFingerprint(x, platform, extra = "") {
  const s = `${platform}|${x.title}|${x.caption ?? ""}|${x.hashtags.join(" ")}|${extra}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}
