import { DEFAULT_DIALOGUE_LANGUAGE } from "../../../../shared/film";

export const EPISODE_LENGTHS = [30, 60, 90, 180, 300, 600, 900];

export function characterPrompt(c, s) {
  return [
    `Create a character reference image for the series "${s.title}"${s.genre ? ` (${s.genre})` : ""}.`,
    `Character: ${c.name}${c.role ? ` – ${c.role}` : ""}.`,
    c.appearance ? `Appearance: ${c.appearance}` : "",
    c.personality ? `Personality (show it through facial expression and pose): ${c.personality}` : "",
    `Visual style: ${s.visualStyle?.trim() || "photorealistic, cinematic lighting, high detail"}.`,
    "Composition: full body, front view, natural standing pose, plain light grey background, soft even lighting, sharp focus on the face, vertical 2:3 image.",
    "Only this one character. No text, no captions, no watermark, no logo."
  ].filter(Boolean).join("\n");
}

export const INV = ["series.", "studio.", "film."];

export const statusMeta = {
  planned: { label: "Dàn ý", tone: "neutral" },
  scripted: { label: "Đã có kịch bản", tone: "secondary" },
  rendered: { label: "Đã render", tone: "success" },
  published: { label: "Đã đăng", tone: "success" }
};

export const EMPTY_SERIES_FORM = {
  productionMode: "video",
  title: "",
  genre: "",
  logline: "",
  visualStyle: "",
  episodeLengthSec: 60,
  renderMode: "semi_ai",
  targetChannelId: "",
  dialogueLanguage: DEFAULT_DIALOGUE_LANGUAGE,
  notes: ""
};
