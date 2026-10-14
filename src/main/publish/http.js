import { readFile } from "node:fs/promises";

export const GRAPH_VERSION = "v23.0";
const graphBase = () => process.env.OMNI_GRAPH_BASE ?? "https://graph.facebook.com";
export const graphVideoBase = () =>
  process.env.OMNI_GRAPH_VIDEO_BASE ?? process.env.OMNI_GRAPH_BASE ?? "https://graph-video.facebook.com";
export const ruploadBase = () => process.env.OMNI_RUPLOAD_BASE ?? "https://rupload.facebook.com";
const tiktokBase = () => process.env.OMNI_TIKTOK_BASE ?? "https://open.tiktokapis.com";

export class PublishError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
    this.name = "PublishError";
  }
}

const TIMEOUT_MS = 6e4;

function withTimeout(signal, ms = TIMEOUT_MS) {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

async function doFetch(url, init, signal, timeoutMs) {
  try {
    return await fetch(url, { ...init, signal: withTimeout(signal, timeoutMs) });
  } catch (err) {
    if (signal.aborted) throw err;
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new PublishError(
      "transient",
      timeout
        ? "Hết thời gian chờ phản hồi từ nền tảng"
        : `Không kết nối được: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function readBody(res) {
  const text = await res.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

function graphError(status, body) {
  const e = body?.error;
  const detail = e?.error_user_msg || e?.message || (status ? `HTTP ${status}` : "Lỗi không rõ");
  const code = e?.code ?? 0;
  const msg = `${detail}${code ? ` (mã ${code}${e?.error_subcode ? `/${e.error_subcode}` : ""})` : ""}`;
  if (code === 190 || code === 102 || code === 10 || (code >= 200 && code < 300) || status === 401)
    return new PublishError("auth", msg);
  if ([4, 17, 32, 341, 368, 613, 80001].includes(code) || status === 429) return new PublishError("rate_limit", msg);
  if (e?.is_transient || code === 1 || code === 2 || status >= 500) return new PublishError("transient", msg);
  return new PublishError("permanent", msg);
}

export async function graph(method, path, opts) {
  const url = new URL(`${(opts.base ?? graphBase()).replace(/\/$/, "")}/${GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== void 0) url.searchParams.set(k, String(v));
  const headers = opts.token ? { Authorization: `OAuth ${opts.token}` } : {};
  let body;
  if (opts.multipart) body = opts.multipart;
  else if (opts.form) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.form)) if (v !== void 0) p.set(k, String(v));
    body = p;
  }
  const res = await doFetch(url.toString(), { method, headers, body }, opts.signal, opts.timeoutMs);
  const json = await readBody(res);
  if (!res.ok || json?.error) throw graphError(res.status, json);
  return json;
}

export async function fileForm(fields, fileField, file, mime, name) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== void 0) fd.set(k, String(v));
  const buf = await readFile(file);
  fd.set(fileField, new Blob([buf], { type: mime }), name ?? file.split(/[\\/]/).pop() ?? "media");
  return fd;
}

export async function ruploadFile(url, token, file, signal) {
  const buf = await readFile(file);
  const res = await doFetch(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token}`,
        offset: "0",
        file_size: String(buf.length),
        "Content-Type": "application/octet-stream",
      },
      body: buf,
    },
    signal,
    10 * 6e4,
  );
  const json = await readBody(res);
  if (!res.ok || json?.error) throw graphError(res.status, json);
}

function tiktokError(status, body) {
  const e = body?.error;
  const code = e?.code ?? "";
  const detail = e?.message || `HTTP ${status}`;
  const hints = {
    unaudited_client_can_only_post_to_private_accounts:
      "Ứng dụng TikTok chưa được TikTok duyệt – chỉ đăng được lên tài khoản để riêng tư",
    spam_risk_too_many_posts: "TikTok chặn vì đăng quá nhiều bài trong ngày",
    spam_risk_user_banned_from_posting: "Tài khoản TikTok đang bị cấm đăng bài",
    reached_active_user_cap: "Ứng dụng TikTok đã chạm giới hạn người dùng hoạt động trong ngày",
    privacy_level_option_mismatch: "Chế độ riêng tư không nằm trong các lựa chọn tài khoản cho phép",
  };
  const msg = `${hints[code] ?? detail}${code ? ` (${code})` : ""}`;
  if (
    code === "access_token_invalid" ||
    code === "scope_not_authorized" ||
    code === "scope_permission_missed" ||
    status === 401
  )
    return new PublishError("auth", msg);
  if (code === "rate_limit_exceeded" || code === "spam_risk_too_many_posts" || status === 429)
    return new PublishError("rate_limit", msg);
  if (status >= 500 || code === "internal_error") return new PublishError("transient", msg);
  return new PublishError("permanent", msg);
}

export async function tiktok(path, opts) {
  const url = new URL(`${tiktokBase().replace(/\/$/, "")}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const res = await doFetch(
    url.toString(),
    {
      method: opts.method ?? "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.json !== void 0 ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
      },
      body: opts.json !== void 0 ? JSON.stringify(opts.json) : void 0,
    },
    opts.signal,
  );
  const json = await readBody(res);
  if (!res.ok || (json?.error?.code && json.error.code !== "ok")) throw tiktokError(res.status, json);
  return json?.data ?? {};
}

export async function tiktokOAuth(form, signal, label = "Làm mới token TikTok thất bại") {
  const res = await doFetch(
    `${tiktokBase().replace(/\/$/, "")}/v2/oauth/token/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    },
    signal,
  );
  const json = await readBody(res);
  if (!res.ok || json?.error) {
    const msg = `${label}: ${json?.error_description || json?.error || `HTTP ${res.status}`}`;
    throw new PublishError(res.status >= 500 ? "transient" : "auth", msg);
  }
  return json;
}

export async function tiktokPutChunk(url, chunk, start, total, signal) {
  const res = await doFetch(
    url,
    {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${start + chunk.length - 1}/${total}`,
      },
      body: chunk,
    },
    signal,
    10 * 6e4,
  );
  await res.text().catch(() => "");
  if (res.status !== 201 && res.status !== 206 && !res.ok) {
    throw new PublishError(
      res.status >= 500 ? "transient" : "permanent",
      `Upload video lên TikTok lỗi HTTP ${res.status}`,
    );
  }
}

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
