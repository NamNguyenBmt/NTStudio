import { AiError } from "../providers";
import "./gemini";
import { errorFromStatus, requestJson, probeAuth } from "./http";

export const elevenlabsAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
    const user = await requestJson(`${base}/v1/user`, {
      headers: { "xi-api-key": ctx.apiKey },
      signal: ctx.signal
    });
    const sub = user.subscription;
    return { note: sub ? `Gói ${sub.tier ?? "?"} · đã dùng ${sub.character_count ?? 0}/${sub.character_limit ?? "?"} ký tự` : void 0 };
  }
};

export const replicateAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://api.replicate.com").replace(/\/$/, "");
    const acc = await requestJson(`${base}/v1/account`, { headers: { Authorization: `Bearer ${ctx.apiKey}` }, signal: ctx.signal });
    return { note: acc.username ? `Tài khoản: ${acc.username}` : void 0 };
  }
};

export const pexelsAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://api.pexels.com").replace(/\/$/, "");
    await requestJson(`${base}/videos/search?query=city&per_page=1`, { headers: { Authorization: ctx.apiKey }, signal: ctx.signal });
    return {};
  }
};

export const pixabayAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://pixabay.com/api").replace(/\/$/, "");
    const res = await fetch(`${base}/videos/?key=${encodeURIComponent(ctx.apiKey)}&q=city&per_page=3`, { signal: ctx.signal });
    if (res.status === 400 || res.status === 401) throw new AiError("auth", "HTTP " + res.status + " – key không hợp lệ", res.status);
    if (!res.ok) throw errorFromStatus(res.status, "");
    return {};
  }
};

export const falAdapter = {
  async test(ctx) {
    const base = (ctx.baseUrl ?? "https://queue.fal.run").replace(/\/$/, "");
    await probeAuth(`${base}/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status`, {
      headers: { Authorization: `Key ${ctx.apiKey}` },
      signal: ctx.signal
    });
    return { note: "Key được chấp nhận (kiểm tra xác thực, không tạo ảnh)" };
  }
};
