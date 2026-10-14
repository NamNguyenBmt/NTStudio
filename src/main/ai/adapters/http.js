import { AiError } from "../providers";

export function errorFromStatus(status, detail) {
  const msg = `HTTP ${status}${detail ? ` – ${detail}` : ""}`;
  if (status === 401 || status === 403) return new AiError("auth", msg, status);
  if (status === 429) return new AiError("rate_limit", msg, status);
  if (status === 408) return new AiError("timeout", msg, status);
  if (status >= 500) return new AiError("overloaded", msg, status);
  if (status >= 400) return new AiError("bad_request", msg, status);
  return new AiError("unknown", msg, status);
}

function errorDetail(body) {
  const first = Array.isArray(body) ? body[0] : body;
  if (!first || typeof first !== "object") return "";
  const b = first;
  const raw = typeof b.error === "string" ? b.error : (b.error?.message ?? b.message ?? "");
  return String(raw).slice(0, 200);
}

export async function requestJson(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal.aborted) throw new AiError("timeout", "Hết thời gian chờ phản hồi");
    throw new AiError("network", `Không kết nối được: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw errorFromStatus(res.status, errorDetail(body) || text.slice(0, 120));
  return body;
}

export async function probeAuth(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal.aborted) throw new AiError("timeout", "Hết thời gian chờ phản hồi");
    throw new AiError("network", `Không kết nối được: ${err instanceof Error ? err.message : String(err)}`);
  }
  await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) throw errorFromStatus(res.status, "Key không hợp lệ");
  if (res.status === 429) throw errorFromStatus(429, "");
  return res.status;
}
