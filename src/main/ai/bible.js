import { z } from "zod";
import { AiError } from "./providers";
import { bibleBrief } from "../media/prompts";
import { aiJson } from "./structured";
import { BibleZ, BIBLE_RULES, BIBLE_JSON, REFS_SEEN_RULE } from "./script";

const BibleOutZ = z.object({ bible: BibleZ });

const bibleVi = (b) => [b.styleVi, ...b.characters.map((c) => c.lookVi), b.product?.lookVi ?? ""].filter(Boolean);

function keepShape(prev, next) {
  const vi = (s) => s || void 0;
  return {
    style: next.style || prev.style,
    styleVi: vi(next.styleVi) ?? prev.styleVi,
    characters: prev.characters.length
      ? [
          ...prev.characters.map((c, i) => {
            const n =
              next.characters.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase()) ??
              next.characters[i];
            return n ? { name: c.name, look: n.look, lookVi: vi(n.lookVi) } : c;
          }),
          // Nhân vật mới AI thêm (ảnh có người mà bộ cũ chưa có)
          ...next.characters
            .slice(prev.characters.length)
            .filter((n) => !prev.characters.some((c) => c.name.trim().toLowerCase() === n.name.trim().toLowerCase()))
            .map((n) => ({ name: n.name, look: n.look, lookVi: vi(n.lookVi) })),
        ]
      : next.characters.map((c) => ({ name: c.name, look: c.look, lookVi: vi(c.lookVi) })),
    product: prev.product
      ? next.product
        ? { name: prev.product.name, look: next.product.look, lookVi: vi(next.product.lookVi) }
        : prev.product
      : next.product
        ? { name: next.product.name, look: next.product.look, lookVi: vi(next.product.lookVi) }
        : null,
  };
}

export async function bibleFromImages(input) {
  const { data, meta } = await aiJson(
    {
      system:
        "Bạn là đạo diễn hình ảnh. Bạn viết mô tả ngoại hình cố định của nhân vật / sản phẩm để AI tạo video vẽ nhất quán ở mọi cảnh.",
      prompt: [
        `Chủ đề video: ${input.topic}`,
        `Bộ nhận diện hiện tại:
${bibleBrief(input.bible)}`,
        REFS_SEEN_RULE,
        "Viết lại visual bible theo ảnh: GIỮ NGUYÊN tên (name) và thứ tự các nhân vật / sản phẩm hiện có, chỉ sửa look cho khớp ảnh; giữ style nếu vẫn hợp, có thể bổ sung tông màu từ ảnh.",
        "Bộ hiện tại chưa có nhân vật / sản phẩm mà ảnh có → thêm mới (tên ngắn) vào cuối danh sách.",
        `Quy tắc: ${BIBLE_RULES}`,
        `Trả về JSON: {"bible":${BIBLE_JSON}}`,
      ].join("\n"),
      json: true,
      maxTokens: 3e3,
      temperature: 0.3,
      images: input.images,
    },
    { feature: "studio.bible", workspaceId: input.workspaceId },
    BibleOutZ,
    (d) => bibleVi(d.bible),
  );
  if (!meta.imagesSeen)
    throw new AiError(
      "bad_request",
      `${meta.providerLabel} không xem được ảnh – cần AI văn bản đọc được ảnh (Gemini, OpenAI hoặc Claude) trong Cài đặt › Khóa AI, hoặc sửa tay bộ nhận diện bằng nút "Sửa"`,
    );
  return { bible: keepShape(input.bible, data.bible), meta };
}

export async function translateBible(input) {
  const e = input.edited;
  const { data, meta } = await aiJson(
    {
      system:
        "Bạn dịch mô tả hình ảnh tiếng Việt sang tiếng Anh ngắn gọn, đúng thuật ngữ điện ảnh, dùng làm prompt cho AI tạo video. Giữ nguyên mọi chi tiết, không thêm ý.",
      prompt: [
        "Dịch bộ nhận diện sau, giữ nguyên name và thứ tự. style, look: bản tiếng Anh. styleVi, lookVi: chép lại NGUYÊN VĂN phần tiếng Việt bên dưới (phần nào vốn là tiếng Anh thì dịch sang tiếng Việt).",
        `Phong cách chung: ${e.style}`,
        ...e.characters.map((c) => `Nhân vật "${c.name}": ${c.look}`),
        e.product ? `Sản phẩm "${e.product.name}": ${e.product.look}` : "Không có sản phẩm (product = null).",
        `Trả về JSON: {"bible":${BIBLE_JSON}}`,
      ].join("\n"),
      json: true,
      maxTokens: 2500,
      temperature: 0.2,
    },
    { feature: "studio.bible", workspaceId: input.workspaceId },
    BibleOutZ,
    (d) => bibleVi(d.bible),
  );
  const t = data.bible;
  return {
    bible: {
      style: t.style || e.style,
      styleVi: e.style,
      characters: e.characters.map((c, i) => {
        const n =
          t.characters.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase()) ?? t.characters[i];
        return { name: c.name, look: n?.look || c.look, lookVi: c.look };
      }),
      product: e.product
        ? { name: e.product.name, look: t.product?.look || e.product.look, lookVi: e.product.look }
        : null,
    },
    meta,
  };
}
