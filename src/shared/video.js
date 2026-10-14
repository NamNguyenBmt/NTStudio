export const ASPECT_SIZE = { "9:16": { w: 1080, h: 1920 }, "16:9": { w: 1920, h: 1080 }, "1:1": { w: 1080, h: 1080 } };

export const ASPECT_LABEL = { "9:16": "Dọc 9:16", "16:9": "Ngang 16:9", "1:1": "Vuông 1:1" };

export const TRANSITION_LABEL = { cut: "Cắt thẳng", fade_black: "Mờ qua đen" };

export const SUBTITLE_STYLES = [
  { id: "montserrat-kara-pop", label: "Kara Pop (từ đang đọc tô vàng)" },
  { id: "hormozi-green", label: "Hormozi (từ đang đọc xanh lá, phóng to)" },
  { id: "neon-glow", label: "Neon (từ đang đọc phát sáng xanh)" },
  { id: "bold-outline", label: "Viền đen đậm (không tô từ)" },
  { id: "movie-yellow", label: "Phụ đề phim (chữ vàng)" },
  { id: "clean-white", label: "Clean White (hộp mờ, tối giản)" },
  { id: "none", label: "Không phụ đề" },
];

export const SHORT_DURATIONS = [15, 30, 60];
export const LONG_DURATIONS = [180, 300, 600, 900];
export const isLongForm = (sec) => sec > 90;
export const durationLabel = (sec) =>
  sec < 60
    ? `${sec} giây`
    : sec % 60 === 0
      ? `${sec / 60} phút`
      : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export const MEDIA_MODE_LABEL = {
  auto: "Theo dự án",
  stock: "Video stock (miễn phí)",
  image: "Ảnh AI + chuyển động",
  veo: "Video AI (Veo)",
  upload: "Clip / ảnh của tôi",
  none: "Không hình (nền màu)",
};

const modeOfRender = (r) => (r === "full_ai" ? "veo" : r === "semi_ai" ? "image" : "stock");
export const effectiveMode = (m, r) => (!m || m === "auto" ? modeOfRender(r) : m);
export const CLIP_VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "mkv"];
export const CLIP_IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];

export const clipKind = (path) => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return CLIP_VIDEO_EXT.includes(ext) ? "video" : CLIP_IMAGE_EXT.includes(ext) ? "image" : null;
};

export const autoModeLabel = (r) =>
  `Theo dự án · ${{ stock: "video stock", image: "ảnh AI", veo: "Veo" }[modeOfRender(r)]}`;

export const attachmentKind = (path) => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (["mp3", "m4a", "wav", "ogg", "aac"].includes(ext)) return "audio";
  return "file";
};
