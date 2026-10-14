export const FILM_STEPS = [
  { id: "script", label: "Kịch bản", ready: true },
  { id: "character", label: "Nhân vật", ready: true },
  { id: "location", label: "Bối cảnh", ready: true },
  { id: "shot", label: "Khung hình", ready: true },
  { id: "video", label: "Video", ready: true },
  { id: "assemble", label: "Ghép tập", ready: true },
];

export const FILM_ASSET_LABEL = { character: "Nhân vật", location: "Bối cảnh", shot: "Cảnh quay" };

export const FILM_VOICE_MODES = [
  {
    id: "clip",
    label: "Giọng do model tạo",
    hint: "Giữ nguyên tiếng của clip Veo / Seedance (khớp môi). Hồ sơ giọng giúp giọng giống nhau hơn giữa các cảnh.",
  },
  {
    id: "convert",
    label: "Đổi sang giọng nhân vật (giữ khẩu hình)",
    hint: "Cần key ElevenLabs và giọng ElevenLabs cho nhân vật. Giữ nhịp, cảm xúc, khẩu hình; giọng giống hệt mọi cảnh, mọi tập. Cảnh nhiều người nói cùng lúc giữ giọng gốc.",
  },
  {
    id: "dub",
    label: "Lồng tiếng bằng giọng đọc",
    hint: "Giọng đọc của từng nhân vật (Edge / ElevenLabs / OpenAI / giọng local) đọc lời thoại – giọng chuẩn, nhưng khẩu hình không khớp hẳn.",
  },
];

export const FILM_INV = ["film."];
