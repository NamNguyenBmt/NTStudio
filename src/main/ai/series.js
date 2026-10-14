import { z } from "zod";
import { bibleBrief } from "../media/prompts";
import { txt, ShotZ, SHOT_RULES, SHOT_JSON } from "./script";
import { need, opt, num, list, brand, aiJson } from "./structured";
import "./captions";

const SeriesPlanSchema = z.object({
  characters: list(
    z.object({
      name: need(60),
      role: opt(80),
      appearance: opt(400),
      personality: opt(300),
      /** Tuyến phát triển qua các tập (tâm lý, vị trí trong truyện) – ngoại hình không đổi */
      arc: opt(400),
      gender: z.preprocess((g) => typeof g === "string" ? g.trim().toLowerCase() : g, z.enum(["male", "female", "other"])).catch("other")
    }),
    0,
    8
  ).catch([]),
  episodes: list(z.object({ title: need(120), synopsis: need(800), cliffhanger: opt(300) }), 1, 30)
});

function previousBrief(previous) {
  if (!previous.length) return "";
  const recent = previous.slice(-10);
  const older = previous.slice(0, -10);
  return [
    `Các tập ĐÃ CÓ (viết tiếp, không lặp lại tình tiết):`,
    older.length ? `- Tập ${older[0].number}–${older[older.length - 1].number}: ${older.map((e) => e.title).join(" · ")}` : "",
    ...recent.map((e) => `- Tập ${e.number} "${e.title}": ${e.synopsis.slice(0, 220)}`)
  ].filter(Boolean).join("\n");
}

export async function planSeriesArc(input) {
  const from = (input.previous[input.previous.length - 1]?.number ?? 0) + 1;
  const { data, meta } = await aiJson(
    {
      system: "Bạn là biên kịch trưởng series phim ngắn, viết tiếng Việt. Lập mạch truyện cho một mùa: có mở đầu, phát triển, cao trào, kết (hoặc kết mở cho mùa sau), mỗi tập một bước tiến rõ ràng.",
      prompt: [
        `Tên series: ${input.title}`,
        input.logline ? `Ý tưởng: ${input.logline}` : "",
        input.genre ? `Thể loại: ${input.genre}` : "",
        input.existingCharacters.length ? `Nhân vật: ${input.existingCharacters.map((c) => `${c.name}${c.role ? ` (${c.role})` : ""}`).join(", ")}` : "",
        previousBrief(input.previous),
        `Lập mạch cho ${input.episodes} tập tiếp theo (tập ${from}–${from + input.episodes - 1}), mỗi tập MỘT câu nêu sự kiện chính.`,
        `Trả về JSON: {"beats":["…", …]} – đúng ${input.episodes} phần tử.`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: Math.min(16e3, 800 + input.episodes * 120),
      temperature: 0.8
    },
    { feature: "series.arc", workspaceId: input.workspaceId },
    z.object({ beats: list(need(400), 1, 60) }),
    (d) => d.beats
  );
  return { beats: data.beats, meta };
}

export async function developSeries(input) {
  const from = (input.previous?.[input.previous.length - 1]?.number ?? 0) + 1;
  const { data, meta: res } = await aiJson(
    {
      system: "Bạn là biên kịch series phim ngắn dọc 9:16 cho mạng xã hội, viết tiếng Việt. Mỗi tập chỉ một tình huống chính, nhịp nhanh, kết treo để giữ người xem. Nội dung phù hợp mọi lứa tuổi, không bạo lực/phản cảm, không dùng nhân vật hay thương hiệu có bản quyền của người khác." + brand(input.brandVoice),
      prompt: [
        `Tên series: ${input.title}`,
        input.logline ? `Ý tưởng: ${input.logline}` : "",
        input.genre ? `Thể loại: ${input.genre}` : "",
        input.visualStyle ? `Phong cách hình ảnh: ${input.visualStyle}` : "",
        previousBrief(input.previous ?? []),
        `Số tập cần dàn ý: ${input.episodes} (tập ${from}–${from + input.episodes - 1}), mỗi tập khoảng ${input.episodeLengthSec} giây.`,
        input.beats?.length ? `Bám đúng mạch đã lập cho các tập này:
${input.beats.map((b, i) => `- Tập ${from + i}: ${b}`).join("\n")}` : "",
        input.existingCharacters.length ? `Nhân vật đã có (giữ nguyên, có thể thêm vai phụ nếu cần):
${input.existingCharacters.map((c) => `- ${c.name} (${c.role ?? ""}): ${c.appearance}`).join("\n")}` : "Tạo 2–5 nhân vật.",
        "appearance viết bằng TIẾNG VIỆT, mô tả ngoại hình cố định chi tiết (tuổi, giới tính, kiểu tóc, màu tóc, trang phục đặc trưng, đặc điểm nhận dạng) để AI vẽ nhân vật giống nhau ở mọi cảnh.",
        "arc: tuyến phát triển của nhân vật qua các tập (tâm lý, mối quan hệ, bước ngoặt – nêu tập nếu có), tiếng Việt, 1–2 câu. Nhân vật đã có: vẫn trả về kèm arc (giữ nguyên tên, ngoại hình).",
        'Trả về JSON: {"characters":[{"name","role","appearance","personality","arc","gender":"male|female|other"}],"episodes":[{"title","synopsis","cliffhanger"}]}'
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: Math.min(16e3, 3e3 + input.episodes * 700),
      temperature: 0.85
    },
    { feature: "series.develop", workspaceId: input.workspaceId },
    SeriesPlanSchema,
    (d) => [...d.episodes.flatMap((e) => [e.title, e.synopsis]), ...d.characters.map((c) => c.appearance)]
  );
  return { plan: data, meta: res };
}

export const speaker = () => opt(60).transform((s) => s || "narrator");

const EpisodeScriptSchema = z.object({
  scenes: list(
    z.object({
      label: opt(80),
      /** Tên nhân vật nói câu thoại, hoặc "narrator" cho lời dẫn */
      speaker: speaker(),
      line: need(600),
      durationSec: num(1, 30),
      /** Chỉ đạo hình ảnh (tiếng Anh) – app ghép thành prompt video hoàn chỉnh */
      shot: ShotZ,
      searchQuery: txt(120)
    }),
    2,
    20
  )
});

export async function writeEpisode(input) {
  const sceneCount = input.lengthSec <= 30 ? 5 : input.lengthSec <= 60 ? 8 : 12;
  const { data, meta: res } = await aiJson(
    {
      system: "Bạn là biên kịch phim ngắn dọc 9:16 viết tiếng Việt. Câu thoại ngắn, tự nhiên, đọc thành giọng nói được; mỗi cảnh một câu thoại của MỘT người nói. Không emoji trong thoại. Nội dung phù hợp mọi lứa tuổi." + brand(input.brandVoice),
      prompt: [
        `Series: ${input.seriesTitle}${input.genre ? ` (${input.genre})` : ""}`,
        input.logline ? `Ý tưởng series: ${input.logline}` : "",
        `Nhân vật:
${input.characters.map((c) => `- ${c.name}${c.role ? ` – ${c.role}` : ""}${c.personality ? `: ${c.personality}` : ""}`).join("\n")}`,
        input.previous.length ? `Các tập trước:
${input.previous.map((p) => `Tập ${p.number} – ${p.title}: ${p.synopsis}`).join("\n")}` : "",
        `Viết TẬP ${input.episode.number}: "${input.episode.title}". Dàn ý: ${input.episode.synopsis}`,
        input.episode.cliffhanger ? `Kết tập bằng tình huống treo: ${input.episode.cliffhanger}` : "Kết tập bằng một tình huống treo.",
        `Thời lượng ${input.lengthSec} giây, khoảng ${sceneCount} cảnh. Cảnh 1 là hook 2–4 giây (có thể dùng lời dẫn tóm tắt tập trước).`,
        bibleBrief(input.bible),
        'speaker là đúng tên một nhân vật ở trên, hoặc "narrator" cho lời dẫn.',
        SHOT_RULES,
        `Trả về JSON: {"scenes":[{"label","speaker","line":"thoại tiếng Việt","durationSec",${SHOT_JSON}}]}`,
        `Tổng durationSec bằng ${input.lengthSec}.`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 16e3,
      temperature: 0.8
    },
    { feature: "series.episode", workspaceId: input.workspaceId },
    EpisodeScriptSchema,
    (d) => d.scenes.map((s) => s.line)
  );
  return { scenes: data.scenes, meta: res };
}
