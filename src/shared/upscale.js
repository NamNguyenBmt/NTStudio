export const UPSCALE_QUALITIES = [
  { id: "1080p", label: "Full HD 1080p", hint: "Đăng mạng xã hội (TikTok, Reels, YouTube Shorts)", shortSide: 1080 },
  { id: "4k", label: "4K (2160p)", hint: "Màn hình lớn, YouTube 4K – file nặng hơn nhiều", shortSide: 2160 },
];

export const upscaleKey = (method, quality) => `${method}:${quality}`;

export const UPSCALE_METHODS = [
  {
    id: "flow",
    label: "Google Flow (AI)",
    hint: "Flow nâng cấp bằng AI – chi tiết rõ nét nhất. Chỉ dùng được cho video tạo bằng Google Flow; 4K cần gói Google AI hỗ trợ và có thể tốn tín dụng.",
  },
  {
    id: "local",
    label: "Trên máy (FFmpeg)",
    hint: "Phóng to + làm nét trên máy – nhanh, miễn phí, nhưng không thêm chi tiết như AI.",
  },
];

export function parseUpscale(v) {
  const m = v?.match(/^(flow|local):(1080p|4k)$/);
  return m ? { method: m[1], quality: m[2] } : null;
}

export const upscaleLabel = (q) => (q === "4k" ? "4K" : "1080p");
