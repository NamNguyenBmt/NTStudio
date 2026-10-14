import { currentUser } from "../../paths";
import { CloudError, cloud, readCloudSession } from "../../cloud/client";
import { AiError } from "../providers";
import "./misc";
import "./openai";

export const OMNIRA_AI_LABEL = "AI NT";

function token() {
  const uid = currentUser();
  const t = uid ? readCloudSession(uid)?.customerToken : null;
  if (!t) throw new AiError("no_provider", "Chưa đăng nhập NT – không dùng được AI NT");
  return t;
}

const KIND = {
  AI_DAILY: "quota",
  AI_MONTHLY: "quota",
  AI_NOT_IN_PLAN: "quota",
  AI_NO_SUBSCRIPTION: "quota",
  AI_DISABLED: "no_provider",
  AI_PAUSED: "overloaded",
  AI_NO_KEY: "overloaded",
  AI_UNAVAILABLE: "overloaded",
  AI_CONFIG: "overloaded",
  RATE_LIMITED: "rate_limit",
  AI_REFUSED: "refusal",
  AI_TOO_LONG: "bad_request",
  AI_TRUNCATED: "invalid_output"
};

export async function omniraChat(req) {
  try {
    const r = await cloud("/api/client/v1/ai/chat", {
      method: "POST",
      body: {
        system: req.system,
        prompt: req.prompt,
        json: !!req.json,
        maxTokens: req.maxTokens,
        temperature: req.temperature ?? null,
        ...req.images?.length ? { images: req.images } : {}
      },
      token: token(),
      // Câu trả lời dài (kế hoạch nhiều ngày, kịch bản dài) có thể mất vài phút
      timeoutMs: 3e5
    });
    return { text: r.text, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, imagesSeen: r.imagesSeen ?? 0 };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof CloudError) throw new AiError(err.offline ? "network" : KIND[err.code] ?? "unknown", err.message, err.status || void 0);
    throw new AiError("unknown", err instanceof Error ? err.message : String(err));
  }
}

export async function omniraQuota() {
  try {
    return await cloud("/api/client/v1/ai/quota", { token: token(), timeoutMs: 1e4 });
  } catch {
    return null;
  }
}
