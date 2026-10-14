import { z } from "zod";
import { AiError } from "./providers";
import { extractJson } from "./json";
import { aiText } from "./router";

export const clip = (max) => z.preprocess((v) => v == null ? "" : typeof v === "number" || typeof v === "boolean" ? String(v) : v, z.string()).transform((s) => s.trim().slice(0, max));
export const need = (max) => clip(max).refine((s) => s.length > 0, "trống");
export const opt = (max) => clip(max).catch("");

export const num = (min, max, int = false) => z.preprocess((v) => typeof v === "string" ? parseFloat(v.replace(",", ".")) : v, z.number().finite()).transform((n) => {
  const x = Math.min(max, Math.max(min, n));
  return int ? Math.round(x) : x;
});

export const bool = () => z.preprocess((v) => v === "true" || v === 1 ? true : v === "false" || v === 0 ? false : v, z.boolean());

export function list(item, min, max) {
  return z.array(z.unknown()).transform((arr, ctx) => {
    const ok = [];
    let firstIssue = "";
    for (const x of arr) {
      const r = item.safeParse(x);
      if (r.success) ok.push(r.data);
      else firstIssue ||= issueBrief(r.error);
    }
    if (ok.length < arr.length) console.warn(`[ai] bỏ ${arr.length - ok.length}/${arr.length} phần tử sai cấu trúc (${firstIssue})`);
    if (ok.length < min) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `chỉ ${ok.length}/${arr.length} phần tử hợp lệ, cần ≥ ${min}` });
      return z.NEVER;
    }
    return ok.slice(0, max);
  });
}

function issueBrief(err) {
  return err.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`).join("; ");
}

export const WORDS_PER_SEC = 2.8;

export const brand = (voice) => voice?.trim() ? `
Giọng văn thương hiệu (bắt buộc tuân theo): ${voice.trim()}` : "";

function shapes(schema, json) {
  const out = [json];
  if (!(schema instanceof z.ZodObject)) return out;
  if (Array.isArray(json)) for (const k of Object.keys(schema.shape)) out.push({ [k]: json });
  else if (json && typeof json === "object") {
    const vals = Object.values(json);
    if (vals.length === 1 && vals[0] && typeof vals[0] === "object" && !Array.isArray(vals[0])) out.push(vals[0]);
  }
  return out;
}

export function parse(schema, text, feature = "", salvage = false) {
  const json = extractJson(text, salvage);
  let first = null;
  for (const v of shapes(schema, json)) {
    const res = schema.safeParse(v);
    if (res.success) return res.data;
    first ??= res.error;
  }
  console.warn(`[ai] ${feature || "json"}: sai cấu trúc – ${first ? issueBrief(first) : "?"}`);
  throw new AiError("invalid_output", "AI trả về sai cấu trúc dữ liệu");
}

const VI_MARK = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const VI_PLAIN = new Set(["khong", "nguoi", "duoc", "cua", "nhung", "trong", "mot", "nay", "cac", "voi", "cho", "la", "va", "den", "thi", "minh", "ban", "nhu", "khi", "roi", "cung", "nhieu", "lam", "biet", "chung"]);

function lacksVietnameseDiacritics(texts) {
  const words = texts.join(" ").normalize("NFC").toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < 12) return false;
  const marked = words.filter((w) => VI_MARK.test(w)).length;
  const plainHits = words.filter((w) => VI_PLAIN.has(w)).length;
  return marked / words.length < 0.08 && plainHits >= 3;
}

const VI_RULE = "Mọi nội dung tiếng Việt phải viết CÓ DẤU đầy đủ, đúng chính tả (Unicode), tuyệt đối không viết tiếng Việt không dấu.";

export async function aiJson(req, opts, schema, vi) {
  const base = { ...req, system: `${req.system}
${VI_RULE}` };
  const attempt = async (r, salvage) => {
    const meta = await aiText(r, opts);
    return { data: parse(schema, meta.text, opts.feature, salvage), meta };
  };
  const checked = async (r, salvage = false) => {
    const res = await attempt(r, salvage);
    if (!vi || !lacksVietnameseDiacritics(vi(res.data))) return res;
    console.warn(`[ai] ${opts.feature}: ${res.meta.model} trả tiếng Việt không dấu → gọi lại`);
    const again = await attempt(
      {
        ...r,
        temperature: Math.min(r.temperature ?? 0.7, 0.4),
        system: `${r.system}
LẦN TRƯỚC BẠN VIẾT TIẾNG VIỆT KHÔNG DẤU – SAI. Viết lại TOÀN BỘ phần tiếng Việt CÓ DẤU đầy đủ (vd "không", "người", "được").`
      },
      true
    );
    if (lacksVietnameseDiacritics(vi(again.data)))
      throw new AiError(
        "invalid_output",
        `Model ${again.meta.model} trả về tiếng Việt KHÔNG DẤU (đã thử lại). Chọn model mạnh hơn ở Cài đặt (vd Gemini Flash thay vì Flash-Lite) rồi tạo lại.`
      );
    return again;
  };
  try {
    return await checked(base);
  } catch (err) {
    if (!(err instanceof AiError) || err.kind !== "invalid_output" || /KHÔNG DẤU/.test(err.message)) throw err;
    console.warn(`[ai] ${opts.feature}: ${err.message} → thử lại với hạn mức ${Math.min(req.maxTokens * 2, 32768)} token`);
    return checked(
      {
        ...base,
        maxTokens: Math.min(req.maxTokens * 2, 32768),
        temperature: Math.min(req.temperature ?? 0.7, 0.4),
        system: `${base.system}
Chỉ trả về DUY NHẤT một JSON hợp lệ, đầy đủ, không giải thích, viết gọn.`
      },
      true
    );
  }
}
