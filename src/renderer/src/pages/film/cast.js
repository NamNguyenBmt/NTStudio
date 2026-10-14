export function castOrigin(detail, a) {
  if (a.kind !== "character") return null;
  if (a.proposal === "pending") return "pending";
  if (!detail.series) return null;
  return a.seriesCharacterId ? "series" : "episode";
}

export const CAST_LABEL = {
  series: { label: "Từ series", tone: "primary", title: "Nhân vật gốc của series – ảnh chuẩn dùng chung cho mọi tập" },
  episode: { label: "Riêng tập này", tone: "secondary", title: "Vai phụ chỉ có trong tập này – tập sau không dùng" },
  pending: { label: "Chờ duyệt", tone: "warning", title: "AI đề xuất – duyệt ở bước Kịch bản" }
};

export function isUnusedCast(detail, a) {
  if (!detail.series || a.kind !== "character" || !a.seriesCharacterId) return false;
  const shots = detail.assets.filter((x) => x.kind === "shot");
  return shots.length > 0 && !shots.some((s) => s.characterIds.includes(a.id));
}

export const pendingProposals = (detail) => detail.assets.filter((a) => a.kind === "character" && a.proposal === "pending");
