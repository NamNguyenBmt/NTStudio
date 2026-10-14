export const PROVIDERS = {
  // ── Văn bản ──
  openai: {
    label: "OpenAI GPT-4o",
    category: "text",
    tagline: "GPT-4o & GPT-4o-mini",
    keyPlaceholder: "sk-proj-…",
    priority: 1,
    models: [
      { id: "gpt-4o", label: "gpt-4o (Chất lượng)" },
      { id: "gpt-4o-mini", label: "gpt-4o-mini (Tiết kiệm)" }
    ]
  },
  gemini: {
    label: "Gemini Flash",
    category: "text",
    tagline: "Gemini Flash (key dùng chung cho Nano Banana, Veo, Lyria)",
    keyPlaceholder: "AIza…",
    priority: 2,
    models: [
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }
    ]
  },
  deepseek: {
    label: "DeepSeek V3 / R1",
    category: "text",
    tagline: "DeepSeek V3 / R1 (Reasoning)",
    keyPlaceholder: "sk-…",
    priority: 0,
    models: [
      { id: "deepseek-chat", label: "deepseek-v3 (chat)" },
      { id: "deepseek-reasoner", label: "deepseek-r1 (reasoner)" }
    ]
  },
  anthropic: {
    label: "Claude",
    category: "text",
    tagline: "Claude Opus / Sonnet / Haiku",
    keyPlaceholder: "sk-ant-…",
    priority: 3,
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
    ]
  },
  // ── Giọng đọc ──
  elevenlabs: {
    label: "ElevenLabs",
    category: "tts",
    tagline: "Giọng đọc đa ngôn ngữ chất lượng cao",
    keyPlaceholder: "xi-…",
    priority: 0,
    models: [
      { id: "eleven_multilingual_v2", label: "Multilingual v2" },
      { id: "eleven_turbo_v2_5", label: "Turbo v2.5" }
    ]
  },
  openai_tts: {
    label: "OpenAI Audio",
    category: "tts",
    tagline: "Dùng chung API key OpenAI",
    keyFrom: "openai",
    priority: 1,
    models: [
      { id: "gpt-4o-mini-tts", label: "gpt-4o-mini-tts" },
      { id: "tts-1-hd", label: "tts-1-hd" }
    ]
  },
  google_tts: {
    label: "Google Gemini TTS",
    category: "tts",
    tagline: "Giọng đọc AI của Google, đọc tốt tiếng Việt – dùng chung key Gemini",
    keyFrom: "gemini",
    priority: 1,
    models: [
      { id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS" },
      { id: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro TTS (hay hơn, đắt hơn)" }
    ]
  },
  edge_tts: {
    label: "Edge-TTS (Miễn phí)",
    category: "tts",
    tagline: "Miễn phí – không cần API key",
    keyless: true,
    priority: 2,
    models: [
      { id: "vi-VN-HoaiMyNeural", label: "HoaiMy (Nữ)" },
      { id: "vi-VN-NamMinhNeural", label: "NamMinh (Nam)" }
    ]
  },
  local_tts: {
    label: "VieNeu-TTS (Local)",
    category: "tts",
    tagline: "Chạy trên máy bạn – miễn phí, clone giọng; GPU NVIDIA (nhanh) hoặc CPU; cài engine ở Cài đặt",
    keyless: true,
    priority: 3,
    models: [{ id: "vieneu-v3-turbo", label: "VieNeu v3 Turbo" }]
  },
  // ── Hình ảnh / video ──
  google_image: {
    label: "Google Gemini – Ảnh AI",
    category: "media",
    tagline: "Model tạo ảnh Nano Banana của Gemini – dùng chung key Gemini, không cần key riêng (key cần bật billing: gói Free không được tạo ảnh qua API)",
    keyFrom: "gemini",
    priority: 0,
    models: [
      { id: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image" },
      { id: "gemini-3.1-flash-lite-image", label: "Gemini 3.1 Flash-Lite Image (rẻ)" },
      { id: "gemini-3-pro-image", label: "Gemini 3 Pro Image" }
    ]
  },
  fal: {
    label: "Fal.ai (Flux)",
    category: "media",
    tagline: "Flux Schnell / Dev – ảnh AI",
    keyPlaceholder: "fal-…",
    priority: 1,
    models: [
      { id: "fal-ai/flux/schnell", label: "Flux Schnell" },
      { id: "fal-ai/flux/dev", label: "Flux Dev" }
    ]
  },
  google_veo: {
    label: "Google Veo 3.1",
    category: "media",
    tagline: "Video AI (thay VideoFX) cho chế độ Full AI – dùng key Gemini",
    keyFrom: "gemini",
    priority: 2,
    models: [
      { id: "veo-3.1-lite-generate-preview", label: "Veo 3.1 Lite (rẻ nhất)" },
      { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast" },
      { id: "veo-3.1-generate-preview", label: "Veo 3.1 Standard" }
    ]
  },
  seedance: {
    label: "ByteDance Seedance 2.0 (qua fal)",
    category: "media",
    tagline: "Video AI cho Xưởng Phim – nhiều ảnh tham chiếu, khung đầu/cuối, có âm thanh; dùng chung key Fal.ai",
    keyFrom: "fal",
    priority: 3,
    models: [
      { id: "bytedance/seedance-2.0/fast/reference-to-video", label: "Seedance 2.0 Fast (rẻ hơn)" },
      { id: "bytedance/seedance-2.0/reference-to-video", label: "Seedance 2.0 (chất lượng cao)" }
    ]
  },
  pexels: {
    label: "Pexels Stock",
    category: "media",
    tagline: "B-roll video stock miễn phí",
    keyPlaceholder: "Pexels API key",
    priority: 3,
    models: [{ id: "videos", label: "Video search" }]
  },
  pixabay: {
    label: "Pixabay Stock",
    category: "media",
    tagline: "Video & ảnh stock miễn phí (key miễn phí)",
    keyPlaceholder: "Pixabay API key",
    priority: 4,
    models: [{ id: "videos", label: "Video search" }]
  },
  replicate: {
    label: "Replicate",
    category: "media",
    tagline: "Kling AI & Hunyuan Video (chưa dùng trong render)",
    keyPlaceholder: "r8_…",
    priority: 5,
    models: [
      { id: "kwaivgi/kling-v1.6-standard", label: "Kling v1.6" },
      { id: "tencent/hunyuan-video", label: "Hunyuan Video" }
    ]
  },
  // ── Nhạc nền AI (tùy chọn) ──
  google_lyria: {
    label: "Google Lyria",
    category: "music",
    tagline: "Nhạc AI của Google (thay MusicFX) – dùng key Gemini",
    keyFrom: "gemini",
    priority: 0,
    models: [
      { id: "lyria-3-clip-preview", label: "Lyria 3 Clip (30 giây)" },
      { id: "lyria-3.5", label: "Lyria 3.5 (cả bài)" }
    ]
  },
  elevenlabs_music: {
    label: "ElevenLabs Music",
    category: "music",
    tagline: "Nhạc AI có quyền thương mại – dùng key ElevenLabs",
    keyFrom: "elevenlabs",
    priority: 1,
    models: [
      { id: "music_v2_5", label: "Music v2.5" },
      { id: "music_v2", label: "Music v2" }
    ]
  }
};

export function isUsableModel(provider, id) {
  switch (provider) {
    case "openai":
      return /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding|moderation)/.test(id);
    case "gemini":
      return /^gemini-/.test(id) && !/(embedding|tts|image|live|native-audio)/.test(id);
    case "google_image":
      return /^gemini-.*image/.test(id);
    case "google_tts":
      return /^gemini-.*tts/.test(id);
    case "google_veo":
      return /^veo-/.test(id);
    case "google_lyria":
      return /^lyria-/.test(id);
    default:
      return true;
  }
}

export function preferredModel(provider, available) {
  if (!available.length) return null;
  if (provider === "gemini") {
    const stable = available.map((id) => ({ id, v: id.match(/^gemini-(\d+(?:\.\d+)?)-flash$/)?.[1] })).filter((x) => x.v != null).sort((a, b) => Number(b.v) - Number(a.v));
    if (stable[0]) return stable[0].id;
  }
  const known = PROVIDERS[provider]?.models.map((m) => m.id) ?? [];
  return known.find((k) => available.includes(k)) ?? available[0];
}

export const providerInfo = (provider) => PROVIDERS[provider] ?? { label: provider, category: "media", tagline: "", models: [], keyPlaceholder: "API key" };
