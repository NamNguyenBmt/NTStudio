export const FILM_GENRES = [
  { label: "Điện ảnh chính kịch", en: "cinematic drama feature film" },
  { label: "Hoạt hình 3D", en: "3D animated feature film" },
  { label: "Hoạt hình 2D / Anime", en: "2D animated anime film" },
  { label: "Kiếm hiệp", en: "wuxia martial arts epic, sword fighting, jianghu heroes" },
  { label: "Cổ trang", en: "historical period drama, ancient costumes and palaces" },
  {
    label: "Cổ trang tiên hiệp",
    en: "xianxia fantasy, celestial immortals, flowing hanfu robes, mystical floating mountains, spiritual energy",
  },
  { label: "Tâm lý hiện đại", en: "contemporary psychological drama, intimate emotional moments" },
  { label: "Tình cảm lãng mạn", en: "romantic drama, tender emotional atmosphere" },
  { label: "Hành động", en: "action thriller, dynamic stunts, high energy" },
  { label: "Giả tưởng", en: "high fantasy adventure, magical world" },
  { label: "Khoa học viễn tưởng", en: "science fiction, futuristic technology" },
  { label: "Trinh thám", en: "detective mystery thriller, suspenseful" },
  { label: "Kinh dị", en: "horror atmosphere, eerie and suspenseful (no gore)" },
  { label: "Hài", en: "lighthearted comedy, playful expressive acting" },
  { label: "Học đường", en: "school life youth drama" },
  { label: "Gia đình", en: "warm family drama" },
  { label: "Cổ tích Việt Nam", en: "Vietnamese folk fairy tale, traditional village setting" },
];

export const FILM_STYLES = [
  {
    label: "Điện ảnh chân thực (35mm)",
    en: "photorealistic cinematic, 35mm film look, shallow depth of field, natural lighting, subtle film grain",
  },
  {
    label: "Hoạt hình 3D phim chiếu rạp",
    en: "stylized 3D animation, feature-film quality, expressive characters, soft global illumination, vibrant colors",
  },
  { label: "Anime 2D", en: "Japanese 2D anime style, cel shading, clean line art, vivid colors" },
  {
    label: "Hoạt hình vẽ tay màu nước",
    en: "hand-painted 2D animation, watercolor backgrounds, soft pastel palette, gentle lighting",
  },
  {
    label: "Cổ trang Trung Hoa điện ảnh",
    en: "Chinese historical epic cinematography, rich silk costumes, misty mountains, warm candlelight, grand palaces",
  },
  {
    label: "Tiên hiệp kỳ ảo",
    en: "ethereal xianxia fantasy art, glowing spiritual light, floating islands, flowing robes, soft volumetric mist",
  },
  {
    label: "Tranh thủy mặc",
    en: "ink wash painting style, sumi-e brush strokes, monochrome with subtle color accents",
  },
  { label: "Noir đen trắng", en: "black and white film noir, high contrast, hard shadows, moody" },
  { label: "Cyberpunk neon", en: "cyberpunk, neon-lit night city, rain reflections, teal and magenta palette" },
  { label: "Hoài cổ thập niên 90", en: "retro 1990s film look, warm color grade, film grain, soft vignette" },
  { label: "Phim tài liệu", en: "documentary realism, handheld camera, natural available light" },
  { label: "Đất sét / stop-motion", en: "claymation stop-motion look, handcrafted clay textures, miniature sets" },
];

export const DIALOGUE_LANGUAGES = [
  { label: "Tiếng Việt", en: "Vietnamese" },
  { label: "English", en: "English" },
  { label: "Tiếng Trung (中文)", en: "Mandarin Chinese" },
  { label: "Tiếng Hàn (한국어)", en: "Korean" },
  { label: "Tiếng Nhật (日本語)", en: "Japanese" },
  { label: "Không thoại", en: null },
];

export const DEFAULT_DIALOGUE_LANGUAGE = "Tiếng Việt";

export function dialogueLanguageEn(label) {
  const v = (label ?? DEFAULT_DIALOGUE_LANGUAGE).trim();
  const p = DIALOGUE_LANGUAGES.find((x) => x.label === v);
  return p ? p.en : v || "Vietnamese";
}

export const isVietnameseDialogue = (label) => dialogueLanguageEn(label) === "Vietnamese";
export const canVietnameseSubtitle = (label) => !!dialogueLanguageEn(label) && !isVietnameseDialogue(label);
export const CUSTOM = "__custom__";

export const EMPTY_FILM_STYLE = {
  genre: null,
  visualStyle: null,
  dialogueLanguage: DEFAULT_DIALOGUE_LANGUAGE,
  notes: null,
};
