import { requestJson } from "./http";

export function openaiCompatible(defaultBase, flavor) {
  const base = (ctx) => (ctx.baseUrl ?? defaultBase).replace(/\/$/, "");
  const headers = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });
  return {
    async test(ctx) {
      const res = await requestJson(`${base(ctx)}/models`, { headers: headers(ctx.apiKey), signal: ctx.signal });
      return { models: res.data.map((m) => m.id).sort() };
    },
    async chat(ctx, req) {
      const reasoning = /^(o\d|gpt-5)/.test(ctx.model) || ctx.model === "deepseek-reasoner";
      const body = {
        model: ctx.model,
        messages: [
          { role: "system", content: req.system },
          {
            role: "user",
            content: req.images?.length && flavor === "openai" ? [...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } })), { type: "text", text: req.prompt }] : req.prompt
          }
        ],
        ...flavor === "openai" ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens },
        ...req.temperature != null && !reasoning ? { temperature: req.temperature } : {},
        ...req.json && ctx.model !== "deepseek-reasoner" ? { response_format: { type: "json_object" } } : {}
      };
      const res = await requestJson(`${base(ctx)}/chat/completions`, {
        method: "POST",
        headers: headers(ctx.apiKey),
        body: JSON.stringify(body),
        signal: ctx.signal
      });
      return {
        text: res.choices[0]?.message.content ?? "",
        model: res.model || ctx.model,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0
      };
    }
  };
}
