import { z } from "zod";
import { need, opt, num, bool, list, WORDS_PER_SEC, brand, aiJson } from "./structured";

export const txt = opt;

export const ShotZ = z
  .object({
    characters: list(need(60), 0, 6).catch([]),
    product: bool().catch(false),
    action: txt(400),
    setting: txt(300),
    cameraAngle: txt(120),
    cameraMovement: txt(120),
    lighting: txt(200),
    look: txt(200),
    style: txt(200),
    sound: txt(300),
  })
  .catch({
    characters: [],
    product: false,
    action: "",
    setting: "",
    cameraAngle: "",
    cameraMovement: "",
    lighting: "",
    look: "",
    style: "",
    sound: "",
  });

export const BibleZ = z.object({
  style: opt(400),
  styleVi: opt(500),
  characters: list(z.object({ name: need(60), look: need(400), lookVi: opt(500) }), 0, 8).catch([]),
  product: z
    .object({ name: need(80), look: need(400), lookVi: opt(500) })
    .nullable()
    .catch(null),
});

export const SHOT_RULES = [
  'Mỗi cảnh có "shot" viết TIẾNG ANH, cụ thể như chỉ đạo quay phim:',
  "- characters: tên nhân vật có trong khung hình (đúng tên trong visual bible); product: true nếu sản phẩm xuất hiện",
  "- action: hành động + biểu cảm; setting: bối cảnh, thời điểm, đạo cụ",
  '- cameraAngle (vd "low-angle medium shot", "extreme close-up"); cameraMovement (vd "slow dolly-in", "handheld tracking", "static locked-off")',
  '- lighting (vd "golden hour backlight with soft bounce fill"); look = chất liệu hình ảnh (vd "35mm film, fine grain, shallow depth of field")',
  '- style = phong cách cinematic riêng của cảnh (vd "moody teal-orange grade"); sound = âm thanh môi trường / hiệu ứng / nhạc nền (KHÔNG gồm lời thoại)',
  "KHÔNG tả lại ngoại hình nhân vật hay hình dáng sản phẩm trong action – app tự chèn nguyên văn mô tả từ visual bible để mọi cảnh nhất quán.",
  "Đổi góc máy / cỡ cảnh giữa các cảnh liền nhau cho sinh động. searchQuery: 3–6 từ khóa tiếng Anh để tìm video stock thay thế.",
].join("\n");
export const SHOT_JSON =
  '"shot":{"characters":[],"product":false,"action","setting","cameraAngle","cameraMovement","lighting","look","style","sound"},"searchQuery":"3-6 english keywords"';
export const BIBLE_RULES =
  'visual bible (dùng chung cho mọi cảnh): style = phong cách chung TIẾNG ANH (thể loại điện ảnh, tông màu, ống kính, chất liệu phim); characters = người xuất hiện lặp lại (tên ngắn như "Host", "Mai" + look TIẾNG ANH mô tả cố định: tuổi, giới tính, gương mặt, tóc, trang phục, màu sắc); product = sản phẩm / vật thể chủ đạo nếu có (name + look TIẾNG ANH: hình dáng, màu, chất liệu, chi tiết nhận diện), không có thì null. Kèm bản TIẾNG VIỆT cùng nội dung cho người dùng đọc & sửa: styleVi, lookVi (của từng nhân vật / sản phẩm).';
export const NO_NARRATION_RULE =
  "Video KHÔNG có lời thoại / giọng đọc / phụ đề: kể hoàn toàn bằng hình ảnh, chuyển động máy và âm thanh. Mỗi cảnh 3–5 giây, nhịp nhanh, hình đẹp kiểu quảng cáo công nghệ: cận cảnh chi tiết, macro, ánh sáng tương phản, chuyển động máy mượt; mở bằng hình gây chú ý mạnh, cao trào ở khoảng 2/3, kết bằng cảnh toàn đẹp nhất. voiceover: GHI CHÚ ngắn tiếng Việt (≤ 12 từ) cho biết cảnh này nói gì – app KHÔNG đọc ra. shot.sound: hiệu ứng / không khí rõ ràng (whoosh, click, hum điện tử, nhạc nền điện tử…), tuyệt đối không có người nói.";
export const BIBLE_JSON =
  '{"style","styleVi","characters":[{"name","look","lookVi"}],"product":{"name","look","lookVi"}|null}';
export const REFS_SEEN_RULE =
  "Ảnh ĐÍNH KÈM là ảnh tham chiếu thật của nhân vật / sản phẩm / logo do người dùng cung cấp. Trong visual bible, look của chủ thể tương ứng phải mô tả ĐÚNG những gì thấy trong ảnh (giới tính, độ tuổi ước lượng, gương mặt, kiểu & màu tóc, trang phục, phụ kiện; sản phẩm: hình dáng, màu, chất liệu, nhãn / logo, chi tiết nhận diện). Không tự nghĩ ra ngoại hình khác ảnh, không đoán quốc tịch / dân tộc nếu ảnh không thể hiện rõ. Ảnh nào không có người / sản phẩm thì bỏ qua.";

const NO_BIBLE = { style: "", styleVi: "", characters: [], product: null };

const ScriptSchema = z.object({
  bible: BibleZ.catch(NO_BIBLE),
  scenes: list(
    z.object({ label: opt(80), voiceover: need(600), durationSec: num(1, 30), shot: ShotZ, searchQuery: txt(120) }),
    2,
    160,
  ),
});

export async function generateScript(input) {
  const long = input.targetSec > 90;
  const silent = input.narration === false;
  const sceneCount = silent
    ? Math.max(3, Math.min(40, Math.round(input.targetSec / 4)))
    : input.targetSec <= 15
      ? 3
      : input.targetSec <= 30
        ? 4
        : input.targetSec <= 90
          ? 7
          : Math.round(input.targetSec / 7);
  const words = Math.round(input.targetSec * WORDS_PER_SEC);
  const minutes = Math.round(input.targetSec / 60);
  const { data, meta: res } = await aiJson(
    {
      system:
        (long
          ? `Bạn là biên kịch video dài ${input.aspect === "9:16" ? "dọc" : "ngang"} (${minutes} phút) cho mạng xã hội, viết bằng tiếng Việt tự nhiên, câu ngắn, dễ đọc thành giọng nói. Mạch nội dung có mở đầu cuốn hút, các phần phát triển rõ ràng, cao trào và kết. `
          : "Bạn là biên kịch video ngắn dọc 9:16 (TikTok, Reels, Shorts) viết bằng tiếng Việt tự nhiên, câu ngắn, dễ đọc thành giọng nói. ") +
        "Không bịa số liệu, giá cả hay cam kết công dụng y tế/sức khỏe. Không dùng emoji trong lời thoại." +
        brand(input.brandVoice),
      prompt: [
        `Chủ đề: ${input.topic}`,
        `Nền tảng đích: ${input.platform ?? "TikTok / Reels"}`,
        silent
          ? `Thời lượng tổng: ${input.targetSec} giây, chia ${sceneCount} cảnh. ${NO_NARRATION_RULE}`
          : `Thời lượng tổng: ${input.targetSec} giây (khoảng ${words} từ lời thoại tổng cộng), chia ${sceneCount} cảnh.`,
        silent
          ? ""
          : long
            ? "Cảnh 1 là Hook gây tò mò; mỗi cảnh 5–10 giây với hình ảnh khác nhau; cảnh cuối là lời kết + CTA ngắn (theo dõi / bình luận). Viết gọn, không lặp ý."
            : "Cảnh 1 là Hook gây tò mò trong 3–4 giây; cảnh cuối là CTA ngắn (theo dõi / bình luận / lưu video).",
        input.formatGuide ? `Định dạng nội dung: ${input.formatGuide}` : "",
        `Trước hết lập ${BIBLE_RULES}`,
        input.images?.length ? REFS_SEEN_RULE : "",
        SHOT_RULES,
        `Trả về JSON: {"bible":${BIBLE_JSON},"scenes":[{"label":"nhãn ngắn ≤ 4 từ","voiceover":"${silent ? "ghi chú nội dung cảnh ≤ 12 từ (không đọc)" : "lời thoại tiếng Việt"}","durationSec":số giây,${SHOT_JSON}}]}`,
        `Tổng durationSec phải bằng ${input.targetSec}.`,
      ]
        .filter(Boolean)
        .join("\n"),
      json: true,
      // Video dài nhiều cảnh → nhiều token hơn (aiJson tự thử lại với hạn mức gấp đôi nếu bị cắt)
      maxTokens: Math.min(32768, 8e3 + input.targetSec * 45),
      temperature: 0.8,
      images: input.images,
    },
    { feature: "studio.script", workspaceId: input.workspaceId },
    ScriptSchema,
    (d) => d.scenes.map((s) => s.voiceover),
  );
  return { scenes: data.scenes, bible: data.bible, meta: res };
}
