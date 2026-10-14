import { z } from "zod";
import { need, opt, num, list, aiJson } from "../ai/structured";
import { dialogueLanguageEn, isVietnameseDialogue, canVietnameseSubtitle } from "../../shared/film";

const t = opt;
const nullable = (max) => opt(max).transform((s) => s || null);

const ScriptZ = z.object({
  title: t(120),
  logline: t(400),
  style: t(400),
  characters: list(z.object({ name: need(60), summary: t(300), look: t(600), voice: t(300) }), 0, 12).catch([]),
  locations: list(z.object({ name: need(80), summary: t(300), look: t(600) }), 0, 20).catch([]),
  /** Series: nhân vật mới AI đề xuất (người dùng duyệt) – tối đa 3 */
  newCharacters: list(
    z.object({
      name: need(60),
      summary: t(300),
      look: t(600),
      voice: t(300),
      scope: z.enum(["episode", "series"]).catch("episode"),
      reason: t(300),
    }),
    0,
    3,
  ).catch([]),
  shots: list(
    z.object({
      location: t(80),
      characters: list(need(60), 0, 6).catch([]),
      summary: t(400),
      action: t(600),
      camera: t(200),
      durationSec: num(3, 15, true).catch(6),
      dialogue: nullable(600),
      /** Phim bật phụ đề tiếng Việt: bản dịch lời thoại */
      subtitle: nullable(600),
    }),
    1,
    80,
  ),
});

function seriesBrief(ctx) {
  return {
    system: [
      "ĐÂY LÀ MỘT TẬP CỦA SERIES – DÀN NHÂN VẬT CỐ ĐỊNH:",
      '- "characters" CHỈ được chứa nhân vật trong dàn đã cho, ĐÚNG tên, "look" và "voice" CHÉP NGUYÊN VĂN mô tả đã cho (không đổi ngoại hình, giọng); nhân vật chưa có voice → viết voice mới.',
      '- Chỉ đưa vào "characters" những nhân vật thật sự xuất hiện trong tập này.',
      '- Cần người mới (vai phụ, người qua đường, nhân vật mới) → KHÔNG đưa vào "characters" mà đưa vào "newCharacters" (tối đa 3): {"name","summary","look","voice","scope","reason"}.',
      '  scope = "episode" nếu chỉ xuất hiện trong tập này; "series" nếu nên xuất hiện lặp lại ở các tập sau. reason: vì sao cần (tiếng Việt).',
      '- Trong "shots"."characters" được dùng tên trong dàn nhân vật và tên trong "newCharacters".',
      "- Hành động, thoại phải hợp với tuyến phát triển của nhân vật ở thời điểm tập này và nối mạch các tập trước.",
      ctx.castIsLarge
        ? "- Dàn nhân vật đã đông: ƯU TIÊN dùng lại nhân vật có sẵn, chỉ đề xuất người mới khi thật cần."
        : "",
      ctx.locations.length
        ? '- BỐI CẢNH ĐÃ CÓ của series: cảnh nào diễn ra ở một nơi đã có (vd phòng trọ, quán cà phê của nhân vật) thì "locations" dùng ĐÚNG tên đó (giữ nguyên chữ) và chép nguyên "look" – app lấy lại ảnh bối cảnh cũ để các tập giống nhau. Chỉ tạo bối cảnh mới khi là nơi khác thật sự.'
        : "",
    ].filter(Boolean),
    prompt: [
      `Series: ${ctx.seriesTitle}${ctx.logline ? ` – ${ctx.logline}` : ""}`,
      `Tập ${ctx.episode.number}: ${ctx.episode.title}`,
      ctx.previous.length
        ? `Các tập trước:
${ctx.previous.map((e) => `- Tập ${e.number} "${e.title}": ${e.synopsis.slice(0, 200)}`).join("\n")}`
        : "",
      ctx.cast.length
        ? `Dàn nhân vật (look, voice tiếng Anh – chép nguyên văn):
${ctx.cast.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: look="${c.look}"${c.voice ? ` voice="${c.voice}"` : ""}${c.arc ? ` | tuyến: ${c.arc}` : ""}`).join("\n")}`
        : 'Series chưa có nhân vật – đề xuất nhân vật cần thiết trong "newCharacters" (scope "series" cho nhân vật chính).',
      ctx.locations.length
        ? `Bối cảnh đã có ở các tập khác (tên – mô tả; look tiếng Anh chép nguyên văn):
${ctx.locations.map((l) => `- ${l.name}: ${l.summary.slice(0, 160)} | look="${l.look}"`).join("\n")}`
        : "",
    ].filter(Boolean),
  };
}

export async function writeFilmScript(f, series = null) {
  const shots = Math.max(3, Math.min(60, Math.round(f.targetSec / 6)));
  const lang = dialogueLanguageEn(f.dialogueLanguage);
  const subVi = wantsVietnameseSubtitle(f);
  const system = [
    "Bạn là biên kịch kiêm đạo diễn hình ảnh cho phim ngắn làm bằng AI (ảnh → video từng cảnh quay 4–15 giây).",
    "Trả về DUY NHẤT một JSON đúng cấu trúc:",
    '{"title","logline","style","characters":[{"name","summary","look","voice"}],"locations":[{"name","summary","look"}],',
    `"shots":[{"location","characters":[tên],"summary","action","camera","durationSec","dialogue"${subVi ? ',"subtitle"' : ""}}]}`,
    "Quy tắc:",
    "- title, logline, summary: tiếng Việt. style, look, action, camera: TIẾNG ANH (dùng làm prompt sinh ảnh/video).",
    '- style: một câu từ khóa phong cách chung cho cả phim (thể loại, tông màu, ống kính, chất liệu phim), vd "cinematic 35mm film, teal and orange grade, shallow depth of field".',
    "- look của nhân vật: ngoại hình CỐ ĐỊNH và cụ thể (tuổi, giới tính, dân tộc, khuôn mặt, tóc, vóc dáng, trang phục chính, màu sắc) – không nhắc bối cảnh hay hành động.",
    "- look của bối cảnh: không gian, kiến trúc, đồ vật, thời điểm trong ngày, ánh sáng – không có người.",
    `- voice của nhân vật: hồ sơ giọng CỐ ĐỊNH bằng TIẾNG ANH, ngắn gọn (giới tính, độ tuổi, cao độ, chất giọng, tốc độ, cảm xúc thường trực${lang === "Vietnamese" ? ", giọng vùng miền: Northern / Central / Southern Vietnamese accent" : ""}), vd "young adult female, soft warm mid-pitch voice, calm pace${lang === "Vietnamese" ? ", Northern Vietnamese accent" : ""}". Mỗi nhân vật một giọng dễ phân biệt.`,
    "- Ưu tiên MỖI CẢNH QUAY CHỈ MỘT NGƯỜI NÓI (đối thoại thì tách thành các cảnh quay nối nhau) – để giọng từng nhân vật giữ đúng khi hậu kỳ.",
    '- Mỗi cảnh quay một hành động rõ ràng nhìn thấy được; "location" và "characters" phải dùng ĐÚNG tên đã khai báo.',
    '- camera: cỡ cảnh + góc + chuyển động máy, vd "medium close-up, low angle, slow dolly in".',
    lang
      ? `- dialogue: lời thoại của cảnh viết bằng ${f.dialogueLanguage} (ngôn ngữ thoại của phim: ${lang}; ghi "Tên: lời", mỗi người một dòng) hoặc null nếu không có.`
      : "- Phim KHÔNG THOẠI: dialogue luôn là null; kể chuyện bằng hành động, biểu cảm, âm thanh.",
    subVi
      ? `- subtitle: phụ đề TIẾNG VIỆT CÓ DẤU của dialogue – dịch tự nhiên, ngắn gọn, chỉ lời nói (KHÔNG ghi tên người nói), nhiều câu nối bằng dấu cách; null khi dialogue null.`
      : "",
    "- Không dùng người thật / người nổi tiếng, không nội dung bạo lực máu me hay tình dục.",
    ...(series ? seriesBrief(series).system : []),
  ].join("\n");
  const prompt = [
    ...(series ? seriesBrief(series).prompt : []),
    f.genre?.trim() ? `Thể loại: ${f.genre.trim()}` : "",
    f.notes?.trim() ? `Ghi chú của đạo diễn (tuân theo): ${f.notes.trim()}` : "",
    `Ý tưởng phim: ${f.idea.trim()}`,
    f.style.trim() ? `Phong cách mong muốn: ${f.style.trim()}` : "",
    `Thời lượng mục tiêu: ${f.targetSec} giây → khoảng ${shots} cảnh quay (tổng durationSec ≈ ${f.targetSec}).`,
    `Khung hình: ${f.aspect}.`,
  ]
    .filter(Boolean)
    .join("\n");
  const { data, meta } = await aiJson(
    { system, prompt, json: true, maxTokens: Math.min(32768, 2e3 + shots * 260), temperature: 0.8 },
    { feature: "film.script", workspaceId: f.workspaceId },
    ScriptZ,
    // Thoại không phải tiếng Việt thì không kiểm tra dấu tiếng Việt cho phần thoại
    (d) => [
      d.logline,
      ...d.shots.flatMap((s) => [
        s.summary,
        isVietnameseDialogue(f.dialogueLanguage) ? (s.dialogue ?? "") : "",
        subVi ? (s.subtitle ?? "") : "",
      ]),
    ],
  );
  return { script: data, model: meta.model, costUsd: meta.costUsd };
}

export const wantsVietnameseSubtitle = (f) => f.subtitleVi && canVietnameseSubtitle(f.dialogueLanguage);

const SubtitleZ = z.object({ items: list(z.object({ id: need(80), vi: t(800) }), 0, 500).catch([]) });

export async function translateSubtitles(f, items) {
  const out = new Map();
  if (!items.length) return out;
  const system = [
    "Bạn là biên dịch phụ đề phim. Dịch lời thoại từng cảnh sang TIẾNG VIỆT CÓ DẤU, tự nhiên như phụ đề phim, ngắn gọn, giữ sắc thái.",
    'Lời thoại dạng "Tên: lời" – CHỈ dịch phần lời, KHÔNG ghi tên người nói; nhiều câu nối bằng dấu cách.',
    'Trả về DUY NHẤT JSON: {"items":[{"id","vi"}]} – đủ mọi id, đúng id đã cho.',
  ].join("\n");
  const prompt = [
    `Phim: ${f.title}`,
    `Ngôn ngữ thoại: ${f.dialogueLanguage}`,
    JSON.stringify(items.map((x) => ({ id: x.id, dialogue: x.dialogue }))),
  ].join("\n");
  const { data } = await aiJson(
    { system, prompt, json: true, maxTokens: Math.min(16e3, 500 + items.length * 200), temperature: 0.3 },
    { feature: "film.subtitle", workspaceId: f.workspaceId },
    SubtitleZ,
    (d) => d.items.map((x) => x.vi),
  );
  for (const x of data.items) if (x.vi.trim() && items.some((i) => i.id === x.id)) out.set(x.id, x.vi.trim());
  return out;
}
