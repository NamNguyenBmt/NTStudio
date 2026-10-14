import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { elevenlabsAdapter, replicateAdapter, pexelsAdapter, pixabayAdapter, falAdapter } from "./misc";
import { openaiCompatible } from "./openai";

export const ADAPTERS = {
  openai: openaiCompatible("https://api.openai.com/v1", "openai"),
  deepseek: openaiCompatible("https://api.deepseek.com", "deepseek"),
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  elevenlabs: elevenlabsAdapter,
  replicate: replicateAdapter,
  pexels: pexelsAdapter,
  pixabay: pixabayAdapter,
  fal: falAdapter
};
