import { AiError } from "./providers";
import "./adapters/http";

function repairJson(raw) {
  let out = "";
  let inStr = false;
  let esc = false;
  const src = raw.replace(/[“”]/g, (q, i, s) => /[{,:\[]\s*$/.test(s.slice(0, i)) || /^\s*[:,}\]]/.test(s.slice(i + 1)) ? '"' : q);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') {
        if (/^\s*([,:}\]]|$)/.test(src.slice(i + 1, i + 40))) inStr = false;
        else {
          out += '\\"';
          continue;
        }
      } else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r") continue;
      else if (ch === "	") {
        out += "\\t";
        continue;
      }
    } else if (ch === '"') inStr = true;
    else if (ch === "#") {
      const tag = src.slice(i).match(/^#[^\s,\]}"]*/)[0];
      out += JSON.stringify(tag);
      i += tag.length - 1;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function topLevelValues(s) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if ((ch === "}" || ch === "]") && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        parts.push(s.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return { parts, truncated: depth > 0 || inStr };
}

function closeTruncated(s) {
  const stack = [];
  let inStr = false;
  let esc = false;
  let cut = -1;
  let open = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (!stack.length) return null;
      cut = i;
      open = [...stack];
    }
  }
  return cut < 0 ? null : s.slice(0, cut + 1) + open.reverse().join("");
}

const parseLoose = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return JSON.parse(repairJson(s));
  }
};

export function extractJson(text, salvage = false) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const arrStart = candidate.indexOf("[");
  const objStart = candidate.indexOf("{");
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart) && candidate.lastIndexOf("]") > arrStart)
    try {
      return parseLoose(candidate.slice(arrStart, candidate.lastIndexOf("]") + 1));
    } catch {
    }
  const start = objStart;
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("invalid_output", "Phản hồi không chứa JSON");
  const raw = candidate.slice(start, end + 1);
  try {
    return parseLoose(raw);
  } catch (first) {
    const { parts, truncated } = topLevelValues(candidate.slice(start));
    if (parts.length >= 2) {
      const values = parts.map((p) => {
        try {
          return parseLoose(p);
        } catch {
          return null;
        }
      }).filter((v) => !!v && typeof v === "object" && !Array.isArray(v));
      if (values.length === 1) return values[0];
      if (values.length) return { items: values.flatMap((v) => Array.isArray(v.items) ? v.items : [v]) };
    }
    if (truncated && salvage) {
      const closed = closeTruncated(candidate.slice(start));
      if (closed)
        try {
          const v = parseLoose(closed);
          console.warn(`[ai] JSON bị cắt giữa chừng → giữ phần hoàn chỉnh (${closed.length}/${text.length} ký tự)`);
          return v;
        } catch {
        }
    }
    console.warn(
      `[ai] JSON lỗi: ${first instanceof Error ? first.message : String(first)} · dài ${text.length} ký tự · ${truncated ? "bị cắt giữa chừng" : `đủ ngoặc, ${parts.length} khối JSON`}`
    );
    throw new AiError("invalid_output", truncated ? "AI trả về JSON bị cắt giữa chừng" : "JSON trả về không hợp lệ");
  }
}
