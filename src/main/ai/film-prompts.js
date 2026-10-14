import { z } from "zod";
import { need, list, aiJson } from "./structured";

const CharacterPromptSchema = z.object({
  imagePrompt: need(1500).refine((s) => s.length >= 20, "quá ngắn"),
  appearanceEn: need(500)
});

export async function characterImagePrompt(input) {
  const { data, meta } = await aiJson(
    {
      system: "You are an expert prompt engineer for AI image generators (Google Nano Banana / Gemini, Imagen, Flux, Midjourney, DALL·E). You turn a Vietnamese character description into precise English prompts. Translate faithfully; you may add plausible concrete visual details (face shape, hairstyle, fabric, colors) that are CONSISTENT with the description, but never contradict it. If nothing says otherwise, the character is Vietnamese.",
      prompt: [
        `Series: "${input.seriesTitle}"${input.genre ? ` – genre: ${input.genre}` : ""}`,
        input.visualStyle ? `Series visual style (may be Vietnamese): ${input.visualStyle}` : "Series visual style: not specified – use photorealistic cinematic",
        `Character name: ${input.name}${input.role ? ` – role: ${input.role}` : ""}`,
        `Appearance (Vietnamese): ${input.appearance || "(none – infer a fitting look from role and personality)"}`,
        input.personality ? `Personality (Vietnamese): ${input.personality}` : "",
        "",
        'Return JSON {"imagePrompt": "...", "appearanceEn": "..."}:',
        '- imagePrompt: ONE English paragraph (80–160 words) for a CHARACTER REFERENCE image: full body, front view, natural standing pose, plain light grey background, soft even studio lighting, sharp focus on the face. Describe age, gender, ethnicity, face, hair, outfit with colors and materials, distinctive features, and a facial expression/pose that conveys the personality. Include the art style from the series visual style (translated), camera/lens and quality keywords. End with: "single character, no text, no watermark, no logo".',
        "- appearanceEn: concise English description of the FIXED visual traits only (age, gender, ethnicity, hair, outfit, distinctive features), comma-separated, max 40 words, no style or background words."
      ].join("\n"),
      json: true,
      maxTokens: 3e3,
      temperature: 0.4
    },
    { feature: "series.characterPrompt", workspaceId: input.workspaceId },
    CharacterPromptSchema
  );
  return { imagePrompt: data.imagePrompt.trim(), appearanceEn: data.appearanceEn.trim(), meta };
}

const StyleSchema = z.object({ en: need(400) });

export async function filmStyleKeywords(custom, presetEn, workspaceId) {
  const { data } = await aiJson(
    {
      system: "You are a prompt engineer for AI image and video generators. Turn a film style brief (often Vietnamese) into concise English VISUAL style keywords. Keep only what can be seen: art style / medium, era and setting style, costume style, color palette, lighting, mood, camera / lens look. Drop plot, character names and dialogue.",
      prompt: [
        presetEn ? `Already chosen (do not repeat): ${presetEn}` : "",
        `Brief:
${custom}`,
        'Return JSON {"en": "comma-separated English keywords, max 40 words"}.'
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 1500,
      temperature: 0.3
    },
    { feature: "film.style", workspaceId },
    StyleSchema
  );
  return data.en.trim();
}

const AssetDescSchema = z.object({ items: list(z.object({ id: need(80), description: need(2e3) }), 1, 200) });

export async function filmAssetDescriptions(items, film, workspaceId) {
  if (items.length > 12) {
    const out = new Map();
    for (let i = 0; i < items.length; i += 12) for (const [k, v] of await filmAssetDescriptions(items.slice(i, i + 12), film, workspaceId)) out.set(k, v);
    return out;
  }
  const { data } = await aiJson(
    {
      system: "You are a prompt engineer for AI image and video generators (Nano Banana, Veo, Seedance). The user edits each item in VIETNAMESE – the Vietnamese text is the source of truth. Write the English visual description used inside image/video prompts. Translate faithfully; keep concrete details from the current English description only when they do NOT contradict the Vietnamese; remove details the Vietnamese changed or removed. Describe only what can be seen. If nothing says otherwise, characters are Vietnamese.",
      prompt: [
        `Film: "${film.title}"${film.style ? ` – visual style: ${film.style}` : ""}`,
        "Per kind:",
        "- character: fixed look only – age, gender, ethnicity, face, hair, outfit with colors and materials, distinctive features (no actions, no background), 30–70 words.",
        "- location: the place – architecture / nature, era, time of day, weather, lighting, atmosphere; no people, 30–70 words.",
        "- shot: what happens in the frame – action, expressions, positions, refer to characters by their names, 20–60 words.",
        "",
        "Input (one JSON object):",
        JSON.stringify({
          items: items.map((i) => ({ id: i.id, kind: i.kind, name: i.name, vietnamese: i.summary, currentEnglish: i.current || null, ...i.context ? { context: i.context } : {} }))
        }),
        "",
        `Return exactly ONE JSON object (not one object per line): {"items":[{"id":"…","description":"English description"}, …]} – ${items.length} entries, same ids.`
      ].join("\n"),
      json: true,
      maxTokens: 1500 + items.length * 400,
      temperature: 0.3
    },
    { feature: "film.prompt", workspaceId },
    AssetDescSchema
  );
  return new Map(data.items.filter((x) => items.some((i) => i.id === x.id)).map((x) => [x.id, x.description.trim()]));
}

export async function visualStyleKeywords(style, workspaceId) {
  const { data } = await aiJson(
    {
      system: "You are a prompt engineer for AI image and video generators. Convert a visual style description (often Vietnamese) into concise English style keywords.",
      prompt: `Visual style: ${style}
Return JSON {"en": "comma-separated English style keywords, max 30 words (art style, color palette, lighting, mood, camera look); no characters, no story"}.`,
      json: true,
      maxTokens: 1500,
      temperature: 0.3
    },
    { feature: "series.style", workspaceId },
    StyleSchema
  );
  return data.en.trim();
}
