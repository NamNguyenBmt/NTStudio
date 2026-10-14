import { z } from "zod";
import { bibleBrief } from "../media/prompts";
import { speaker } from "./series";
import { need, opt, num, list, brand, aiJson } from "./structured";
import { txt, ShotZ, BibleZ, SHOT_RULES, SHOT_JSON, BIBLE_RULES, BIBLE_JSON, REFS_SEEN_RULE } from "./script";
import "./plan";

const ActsSchema = z.object({
  bible: BibleZ.optional().catch(void 0),
  acts: list(z.object({ title: need(120), summary: need(800), durationSec: num(10, 600) }), 2, 10)
});

const ActScenesSchema = z.object({
  scenes: list(
    z.object({
      label: opt(80),
      speaker: speaker(),
      line: need(600),
      durationSec: num(1, 30),
      shot: ShotZ,
      searchQuery: txt(120)
    }),
    1,
    80
  )
});

const actCountFor = (sec) => Math.max(3, Math.min(8, Math.round(sec / 120)));
const longSystem = (ctx) => (ctx.kind === "episode" ? `Bạn là biên kịch phim ${ctx.vertical ? "dọc 9:16" : "ngang 16:9"} nhiều tập viết tiếng Việt. Câu thoại ngắn, tự nhiên, đọc thành giọng nói được; mỗi cảnh một câu thoại của MỘT người nói. Nội dung phù hợp mọi lứa tuổi.` : `Bạn là biên kịch video dài ${ctx.vertical ? "dọc 9:16" : "ngang 16:9"} cho mạng xã hội viết tiếng Việt tự nhiên, câu ngắn, dễ đọc thành giọng nói.`) + " Không bịa số liệu, không emoji trong lời thoại." + brand(ctx.brandVoice);

const charList = (ctx) => ctx.characters.length ? `Nhân vật:
${ctx.characters.map((c) => `- ${c.name}${c.role ? ` – ${c.role}` : ""}${c.personality ? `: ${c.personality}` : ""}`).join("\n")}` : "";

export async function outlineActs(ctx) {
  const n = actCountFor(ctx.totalSec);
  const { data, meta } = await aiJson(
    {
      system: longSystem(ctx),
      prompt: [
        `${ctx.kind === "episode" ? "Tập phim" : "Chủ đề"}: ${ctx.topic}`,
        ...ctx.brief,
        charList(ctx),
        `Tổng thời lượng ${Math.round(ctx.totalSec / 60)} phút (${ctx.totalSec} giây). Chia thành ${n} hồi theo mạch: mở đầu cuốn hút → phát triển → cao trào → kết${ctx.kind === "episode" ? " (tình huống treo nếu có)" : ""}.`,
        "Mỗi hồi: title ngắn ≤ 8 từ, summary 2–4 câu nêu cụ thể diễn biến/ý chính của hồi (không viết thoại), durationSec.",
        ctx.bible ? bibleBrief(ctx.bible) : `Đồng thời lập ${BIBLE_RULES}`,
        !ctx.bible && ctx.images?.length ? REFS_SEEN_RULE : "",
        `Trả về JSON: {"acts":[{"title","summary","durationSec"}]${ctx.bible ? "" : `,"bible":${BIBLE_JSON}`}}. Tổng durationSec bằng ${ctx.totalSec}.`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 6e3,
      temperature: 0.8,
      ...!ctx.bible && ctx.images?.length ? { images: ctx.images } : {}
    },
    { feature: ctx.kind === "episode" ? "series.outline" : "studio.outline", workspaceId: ctx.workspaceId },
    ActsSchema,
    (d) => d.acts.flatMap((a) => [a.title, a.summary])
  );
  const sum = data.acts.reduce((a, x) => a + x.durationSec, 0) || 1;
  const acts = data.acts.map((a) => ({ title: a.title.trim(), summary: a.summary.trim(), targetSec: Math.max(20, Math.round(a.durationSec * ctx.totalSec / sum)) }));
  return { acts, bible: ctx.bible ?? data.bible ?? null, meta };
}

export async function writeActScenes(ctx, acts, index, previousTail) {
  const act = acts[index];
  const sceneCount = Math.max(3, Math.round(act.targetSec / 7));
  const { data, meta } = await aiJson(
    {
      system: longSystem(ctx),
      prompt: [
        `${ctx.kind === "episode" ? "Tập phim" : "Chủ đề"}: ${ctx.topic}`,
        ...ctx.brief,
        charList(ctx),
        `Dàn ý toàn bộ (${acts.length} hồi):
${acts.map((a, i) => `${i + 1}. ${a.title} (${a.targetSec}s): ${a.summary}`).join("\n")}`,
        previousTail.length ? `Cuối hồi ${index} vừa viết (nối mạch tự nhiên, không lặp lại):
${previousTail.map((l) => `- ${l}`).join("\n")}` : "",
        `Giờ CHỈ viết HỒI ${index + 1}: "${act.title}" – ${act.summary}`,
        `Thời lượng hồi ${act.targetSec} giây, khoảng ${sceneCount} cảnh, mỗi cảnh 4–10 giây.`,
        index === 0 ? "Cảnh đầu tiên là hook gây tò mò." : "",
        index === acts.length - 1 ? ctx.kind === "episode" ? "Cảnh cuối là kết tập / tình huống treo." : "Cảnh cuối là lời kết + CTA ngắn (theo dõi / bình luận)." : "",
        bibleBrief(ctx.bible),
        ctx.kind === "episode" ? 'speaker là đúng tên một nhân vật ở trên, hoặc "narrator" cho lời dẫn.' : 'speaker luôn là "narrator".',
        SHOT_RULES,
        `Trả về JSON: {"scenes":[{"label":"nhãn ≤ 4 từ","speaker","line":"lời thoại tiếng Việt","durationSec",${SHOT_JSON}}]}`,
        `Tổng durationSec bằng ${act.targetSec}.`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 16e3,
      temperature: 0.8
    },
    { feature: ctx.kind === "episode" ? "series.act" : "studio.act", workspaceId: ctx.workspaceId },
    ActScenesSchema,
    (d) => d.scenes.map((s) => s.line)
  );
  return { scenes: data.scenes, meta };
}
