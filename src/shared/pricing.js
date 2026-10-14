export const DEFAULT_PRICING = {
  // Anthropic
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // DeepSeek (V3.2 – chat & reasoner cùng giá)
  "deepseek-chat": { input: 0.28, output: 0.42 },
  "deepseek-reasoner": { input: 0.28, output: 0.42 },
  // Google (Gemini 3.x: giá niêm yết tra cứu 10/2026)
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.8-flash": { input: 0.375, output: 1.88 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 }
};

export function priceFor(model, overrides = {}) {
  return overrides[model] ?? DEFAULT_PRICING[model] ?? null;
}

export function estimateCostUsd(model, inputTokens, outputTokens, overrides) {
  const p = priceFor(model, overrides);
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1e6;
}

export const UNIT_PRICES = {
  "tts-1": { per: "char", usd: 15 / 1e6, note: "$15 / 1M ký tự" },
  "tts-1-hd": { per: "char", usd: 30 / 1e6, note: "$30 / 1M ký tự" },
  "gpt-4o-mini-tts": { per: "char", usd: 15 / 1e6, note: "≈ $15 / 1M ký tự (ước tính)" },
  // Gemini TTS tính theo token audio đầu ra (~$10/1M token Flash, ~$20/1M Pro) → quy đổi thô theo ký tự
  "gemini-2.5-flash-preview-tts": { per: "char", usd: 20 / 1e6, note: "≈ $20 / 1M ký tự (ước tính)" },
  "gemini-2.5-pro-preview-tts": { per: "char", usd: 40 / 1e6, note: "≈ $40 / 1M ký tự (ước tính)" },
  "fal-ai/flux/schnell": { per: "image", usd: 3e-3, note: "≈ $0.003 / ảnh (ước tính)" },
  "fal-ai/flux/dev": { per: "image", usd: 0.025, note: "≈ $0.025 / ảnh (ước tính)" },
  "gemini-3.1-flash-image": { per: "image", usd: 0.039, note: "≈ $0.039 / ảnh 1K (ước tính)" },
  // Nano Banana qua fal (Xưởng Phim – người chỉ có key fal)
  "fal-ai/nano-banana": { per: "image", usd: 0.039, note: "≈ $0.039 / ảnh (ước tính)" },
  "fal-ai/nano-banana/edit": { per: "image", usd: 0.039, note: "≈ $0.039 / ảnh (ước tính)" },
  "gemini-3.1-flash-lite-image": { per: "image", usd: 0.02, note: "≈ $0.02 / ảnh (ước tính)" },
  "gemini-3-pro-image": { per: "image", usd: 0.134, note: "≈ $0.134 / ảnh (ước tính)" },
  "veo-3.1-lite-generate-preview": { per: "second", usd: 0.05, note: "$0.05 / giây (720p)" },
  "veo-3.1-fast-generate-preview": { per: "second", usd: 0.1, note: "$0.10 / giây (720p)" },
  "veo-3.1-generate-preview": { per: "second", usd: 0.4, note: "$0.40 / giây (720p)" },
  "lyria-3.5": { per: "song", usd: 0.08, note: "$0.08 / bài" },
  "lyria-3-clip-preview": { per: "song", usd: 0.04, note: "≈ $0.04 / clip 30 giây (ước tính)" },
  music_v2_5: { per: "minute", usd: 0.15, note: "$0.15 / phút" },
  music_v2: { per: "minute", usd: 0.15, note: "$0.15 / phút" },
  music_v1: { per: "minute", usd: 0.15, note: "$0.15 / phút" }
};

export function unitCost(model, amount) {
  const u = UNIT_PRICES[model];
  return u ? u.usd * amount : 0;
}
