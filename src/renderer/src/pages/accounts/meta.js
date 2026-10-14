export const sessionMeta = {
  valid: { label: "Phiên hợp lệ", tone: "success", health: "ok" },
  expiring: { label: "Cookie cần làm mới", tone: "warning", health: "warn" },
  expired: { label: "Hết hạn phiên", tone: "danger", health: "error" },
  checkpoint: { label: "Checkpoint", tone: "danger", health: "error" },
  unknown: { label: "Chưa kiểm tra", tone: "neutral", health: "idle" },
};

export const tokenMeta = {
  valid: { label: "Token hợp lệ", tone: "success" },
  expiring: { label: "Token sắp hết hạn", tone: "warning" },
  expired: { label: "Token hết hạn", tone: "danger" },
  missing: { label: "Chưa có token", tone: "neutral" },
};

export const channelStatusMeta = {
  active: { label: "Đang chạy", tone: "success" },
  paused: { label: "Tạm dừng", tone: "warning" },
  error: { label: "Lỗi", tone: "danger" },
};

export const roleLabel = {
  admin: "Quản trị viên",
  editor: "Biên tập viên",
  moderator: "Kiểm duyệt viên",
  advertiser: "Nhà quảng cáo",
};

export function needsAttention(a) {
  return (
    a.health === "warn" ||
    a.health === "error" ||
    a.channels.some((c) => c.health === "warn" || c.health === "error" || c.tokenStatus === "expired")
  );
}

export function daysUntil(date, now = Date.now()) {
  return date ? Math.round((date.getTime() - now) / 864e5) : null;
}
