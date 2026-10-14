import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "../providers";

const EFFORT_MODELS = /^claude-(opus-5|opus-5-5|sonnet-5|sonnet-5-5|fable-5|fable-5-1|opus-4-[6-8]|sonnet-4-6)$/;
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

function client(ctx) {
  return new Anthropic({ apiKey: ctx.apiKey, baseURL: ctx.baseUrl ?? void 0, maxRetries: 0, timeout: 12e4 });
}

function mapError(err) {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AiError("timeout", "Hết thời gian chờ phản hồi");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout", "Hết thời gian chờ phản hồi");
  if (err instanceof Anthropic.APIConnectionError)
    return new AiError("network", "Không kết nối được tới Anthropic API");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new AiError("auth", `HTTP ${err.status} – key không hợp lệ hoặc thiếu quyền`, err.status);
  if (err instanceof Anthropic.RateLimitError)
    return new AiError("rate_limit", "HTTP 429 – vượt giới hạn tần suất", 429);
  if (err instanceof Anthropic.InternalServerError)
    return new AiError("overloaded", `HTTP ${err.status} – Anthropic quá tải`, err.status);
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return new AiError(
      status === 529 ? "overloaded" : "bad_request",
      `HTTP ${status} – ${err.message.slice(0, 200)}`,
      status,
    );
  }
  return new AiError("unknown", err instanceof Error ? err.message : String(err));
}

export const anthropicAdapter = {
  async test(ctx) {
    try {
      const models = [];
      for await (const m of client(ctx).models.list({ limit: 100 }, { signal: ctx.signal })) models.push(m.id);
      return { models: models.sort() };
    } catch (err) {
      throw mapError(err);
    }
  },
  async chat(ctx, req) {
    const prompt = req.json
      ? `${req.prompt}

Chỉ trả về đúng một object JSON hợp lệ, không kèm giải thích hay markdown.`
      : req.prompt;
    try {
      const res = await client(ctx).beta.messages.create(
        {
          model: ctx.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [
            {
              role: "user",
              content: req.images?.length
                ? [
                    ...req.images.map((i) => ({
                      type: "image",
                      source: { type: "base64", media_type: i.mime, data: i.data },
                    })),
                    { type: "text", text: prompt },
                  ]
                : prompt,
            },
          ],
          ...(EFFORT_MODELS.test(ctx.model) ? { output_config: { effort: "low" } } : {}),
          ...(FALLBACK_MODELS.has(ctx.model)
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
            : {}),
        },
        { signal: ctx.signal },
      );
      if (res.stop_reason === "refusal") {
        throw new AiError(
          "refusal",
          `Claude từ chối yêu cầu${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}`,
        );
      }
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return { text, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    } catch (err) {
      throw mapError(err);
    }
  },
};
