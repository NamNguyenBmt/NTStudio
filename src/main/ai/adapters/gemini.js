import { AiError } from "../providers";
import "../json";
import { requestJson } from "./http";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const geminiAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    const res = await requestJson(`${base}/models?pageSize=200`, {
      headers: { "x-goog-api-key": ctx.apiKey },
      signal: ctx.signal
    });
    return { models: res.models.map((m) => m.name.replace(/^models\//, "")).sort() };
  },
  async chat(ctx, req) {
    const base = (ctx.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    const res = await requestJson(`${base}/models/${encodeURIComponent(ctx.model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": ctx.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [...(req.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })), { text: req.prompt }] }],
        generationConfig: {
          // Gemini 2.5+/3.x tính cả token "suy nghĩ" vào giới hạn → giới hạn nhỏ dễ trả về rỗng; chỉ trả tiền token thực dùng
          maxOutputTokens: Math.max(req.maxTokens, 8192),
          ...req.temperature != null ? { temperature: req.temperature } : {},
          ...req.json ? { responseMimeType: "application/json" } : {}
        }
      }),
      signal: ctx.signal
    });
    if (res.promptFeedback?.blockReason) throw new AiError("refusal", `Gemini chặn nội dung: ${res.promptFeedback.blockReason}`);
    const cand = res.candidates?.[0];
    if (cand?.finishReason === "SAFETY") throw new AiError("refusal", "Gemini từ chối vì chính sách an toàn");
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text.trim() && cand?.finishReason === "MAX_TOKENS") throw new AiError("invalid_output", `Gemini (${ctx.model}) hết giới hạn token trước khi trả lời`);
    if (req.json && cand?.finishReason === "MAX_TOKENS") throw new AiError("invalid_output", `Gemini (${ctx.model}) bị cắt giữa chừng do hết giới hạn token (${req.maxTokens})`);
    return {
      text,
      model: res.modelVersion ?? ctx.model,
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0
    };
  }
};
