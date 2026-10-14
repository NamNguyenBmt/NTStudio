import { z } from "zod";
import { aiText } from "./router";
import { clip, need, opt, num, bool, list, brand, parse, aiJson } from "./structured";

const tagList = (min) =>
  z
    .preprocess((t) => (typeof t === "string" ? t.split(/[\s,]+/) : t), list(need(200), min, 50))
    .transform((t) => t.filter((x) => x.length <= 60).slice(0, 15));

const SpinSchema = z.object({
  variants: list(z.object({ caption: need(2200), hashtags: tagList(0).catch([]) }), 1, 10),
});

export async function spinCaption(input) {
  const { data, meta } = await aiJson(
    {
      system:
        "Bạn là copywriter mạng xã hội tiếng Việt. Viết lại caption thành các biến thể khác nhau rõ rệt về câu mở đầu, nhịp câu và lời kêu gọi, nhưng giữ nguyên ý chính và mọi thông tin sự thật (giá, số lượng, chính sách) – không thêm thông tin mới." +
        brand(input.brandVoice),
      prompt: [
        `Tiêu đề: ${input.title}`,
        `Caption gốc: ${input.caption?.trim() || "(chưa có – viết mới dựa trên tiêu đề)"}`,
        `Hashtag gốc: ${input.hashtags.join(" ") || "(không có)"}`,
        `Tạo ${input.count} biến thể. Mỗi caption ≤ 400 ký tự. Hashtag 3–8 cái, có dấu #, không dấu tiếng Việt.`,
        'Trả về JSON: {"variants":[{"caption":"…","hashtags":["#…","#…"]}]} – mỗi hashtag là một chuỗi trong ngoặc kép; xuống dòng trong caption viết \\n.',
      ].join("\n"),
      json: true,
      maxTokens: 4e3,
      temperature: 0.9,
    },
    { feature: "content.spin", workspaceId: input.workspaceId },
    SpinSchema,
    (d) => d.variants.map((v) => v.caption),
  );
  return { variants: data.variants.slice(0, input.count), meta };
}

const HashtagSchema = z.object({ hashtags: tagList(1) });

export async function suggestHashtags(input) {
  const res = await aiText(
    {
      system:
        "Bạn là chuyên gia SEO mạng xã hội tại Việt Nam. Chọn hashtag phổ biến, đúng chủ đề, không spam, không gắn thương hiệu không liên quan.",
      prompt: [
        `Nền tảng: ${input.platform}`,
        `Tiêu đề: ${input.title}`,
        `Caption: ${input.caption ?? ""}`,
        'Đề xuất 6–10 hashtag (có dấu #, viết liền không dấu). Trả về JSON: {"hashtags":["#…"]}',
      ].join("\n"),
      json: true,
      maxTokens: 400,
      temperature: 0.5,
    },
    { feature: "content.hashtags", workspaceId: input.workspaceId },
  );
  return normalizeTags(parse(HashtagSchema, res.text, "content.hashtags").hashtags);
}

export function normalizeTags(tags) {
  const out = tags
    .map((t) => t.trim().replace(/\s+/g, ""))
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
  return [...new Set(out)].slice(0, 15);
}

export async function suggestReply(input) {
  const transcript = input.history
    .slice(-12)
    .map((m) => `${m.direction === "in" ? "Khách" : "Shop"}: ${m.body}`)
    .join("\n");
  const res = await aiText(
    {
      system:
        `Bạn là nhân viên chăm sóc khách hàng của "${input.channelName}", trả lời bằng tiếng Việt lịch sự, ngắn gọn (≤ 80 từ), xưng "em/shop". Chỉ dùng thông tin có trong "Thông tin cửa hàng" và hội thoại. Nếu khách hỏi giá, tồn kho, thời gian giao hay chính sách mà không có thông tin, KHÔNG được tự đặt ra con số – hãy xin số điện thoại/hẹn nhắn tin riêng để nhân viên kiểm tra. Không hứa điều shop chưa xác nhận.` +
        brand(input.brandVoice),
      prompt: [
        `Kênh: ${input.source === "comment" ? "bình luận công khai" : "tin nhắn riêng"}`,
        input.contextPostTitle ? `Bài viết khách đang bình luận: ${input.contextPostTitle}` : "",
        input.knowledge.length
          ? `Thông tin cửa hàng:
${input.knowledge.map((k) => `- ${k.body}`).join("\n")}`
          : "Thông tin cửa hàng: (chưa có)",
        `Hội thoại với khách "${input.customerName}":
${transcript}`,
        "Viết DUY NHẤT câu trả lời tiếp theo của Shop, không kèm giải thích.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 500,
      temperature: 0.6,
    },
    { feature: "inbox.reply", workspaceId: input.workspaceId },
  );
  const text = res.text
    .trim()
    .replace(/^(Shop|Trả lời)\s*:\s*/i, "")
    .replace(/^"|"$/g, "");
  return { text, meta: res };
}

const DecisionSchema = z.object({
  reply: clip(1200),
  /** 0–1: AI chắc câu trả lời đúng và đủ dựa trên thông tin cửa hàng (thiếu / sai → 0: vào hàng chờ duyệt, không tự gửi) */
  confidence: num(0, 1).catch(0),
  /** Cần người xử lý: khiếu nại, đổi trả, thông tin không có trong kiến thức, khách bực bội… (thiếu / sai → cần người) */
  needsHuman: bool().catch(true),
  reason: opt(200),
  intent: z.enum(["price", "product", "order", "shipping", "complaint", "praise", "spam", "other"]).catch("other"),
  /** Khách thể hiện ý định mua / để lại SĐT – địa chỉ */
  lead: z.boolean().catch(false),
});

export async function decideReply(input) {
  const transcript = input.history
    .slice(-12)
    .map((m) => `${m.direction === "in" ? "Khách" : "Shop"}: ${m.body}`)
    .join("\n");
  const isComment = input.source === "comment";
  const res = await aiText(
    {
      system:
        `Bạn là nhân viên chăm sóc khách hàng của "${input.channelName}", trả lời tiếng Việt lịch sự, tự nhiên, xưng "em/shop", ` +
        (isComment
          ? "đây là bình luận CÔNG KHAI: ngắn (≤ 40 từ), không đưa thông tin cá nhân, mời khách nhắn tin nếu cần tư vấn chi tiết. "
          : "tin nhắn riêng: ≤ 80 từ. ") +
        'QUY TẮC: chỉ dùng thông tin trong "Thông tin cửa hàng" và hội thoại; KHÔNG tự đặt ra giá, tồn kho, thời gian giao, khuyến mãi hay chính sách. Thiếu thông tin → vẫn viết câu trả lời lịch sự xin SĐT/hẹn nhân viên kiểm tra, đặt needsHuman=true. Khiếu nại, đổi trả, hoàn tiền, khách bực bội, câu hỏi nhạy cảm → needsHuman=true. Bình luận spam/quảng cáo → intent "spam", reply rỗng. confidence = mức chắc chắn câu trả lời đúng và đủ chỉ dựa trên thông tin đã cho.' +
        brand(input.brandVoice) +
        '\nTrả về DUY NHẤT JSON: {"reply": string, "confidence": number, "needsHuman": boolean, "reason": string, "intent": "price|product|order|shipping|complaint|praise|spam|other", "lead": boolean}',
      prompt: [
        `Kênh: ${isComment ? "bình luận công khai" : "tin nhắn riêng"}`,
        input.contextPostTitle ? `Bài viết khách đang bình luận: ${input.contextPostTitle}` : "",
        `Thông tin cửa hàng:
${input.knowledge.trim() || "(chưa có)"}`,
        `Hội thoại với khách "${input.customerName}":
${transcript}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 700,
      temperature: 0.3,
      json: true,
    },
    { feature: "inbox.autoReply", workspaceId: input.workspaceId },
  );
  const decision = parse(DecisionSchema, res.text, "inbox.autoReply");
  decision.reply = decision.reply
    .trim()
    .replace(/^(Shop|Trả lời)\s*:\s*/i, "")
    .replace(/^"|"$/g, "");
  return { decision, meta: res };
}
