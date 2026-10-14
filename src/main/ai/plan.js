import { z } from "zod";
import { AiError } from "./providers";
import { need, opt, list, brand, aiJson } from "./structured";

const pad2 = (s) => s.padStart(2, "0");

const isoDate = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const ymd = v.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${pad2(ymd[2])}-${pad2(ymd[3])}`;
  const dmy = v.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  return dmy ? `${dmy[3]}-${pad2(dmy[2])}-${pad2(dmy[1])}` : v;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function flattenPlan(v) {
  const root = isObj(v) ? v : null;
  let arr = Array.isArray(v) ? v : root?.ideas ?? root?.plan ?? root?.days ?? root?.items;
  if (!Array.isArray(arr)) {
    if (!root) return v;
    const byDate = Object.entries(root).filter(([k, x]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(x));
    if (!byDate.length) return v;
    arr = byDate.flatMap(([date, x]) => x.filter(isObj).map((i) => ({ date, ...i })));
  }
  return {
    ideas: arr.flatMap((x) => {
      if (!isObj(x)) return [x];
      const inner = x.ideas ?? x.items;
      return Array.isArray(inner) ? inner.filter(isObj).map((i) => ({ date: x.date, ...i })) : [x];
    })
  };
}

const PlanSchema = z.preprocess(
  flattenPlan,
  z.object({
    ideas: list(
      z.object({
        date: isoDate,
        format: opt(80),
        title: need(200),
        hook: opt(300),
        description: opt(800)
      }),
      1,
      120
    )
  })
);

const PLAN_CHUNK_DAYS = 7;

export async function planContent(input) {
  const ideas = [];
  const metas = [];
  let lastErr = null;
  for (let i = 0; i < input.dates.length; i += PLAN_CHUNK_DAYS) {
    const dates = input.dates.slice(i, i + PLAN_CHUNK_DAYS);
    try {
      const { data, meta } = await aiJson(
        {
          system: "Bạn là trưởng nhóm nội dung cho page mạng xã hội (video ngắn và bài viết) tại Việt Nam. Lập kế hoạch thực tế, đa dạng, không lặp chủ đề, phù hợp ngách. Không đề xuất nội dung vi phạm bản quyền (dùng lại phim, nhạc, cảnh quay trận đấu của người khác), không tin giả, không giật tít sai sự thật." + brand(input.brandVoice),
          prompt: [
            `Ngách / chủ đề page: ${input.niche}`,
            input.topPosts.length ? `Bài hiệu quả nhất gần đây của page (học phong cách, chủ đề người xem thích):
${input.topPosts.map((t) => `- ${t.title} (${t.views ?? "?"} xem, ${t.engagements ?? "?"} tương tác)`).join("\n")}` : "Page chưa có số liệu bài đăng.",
            input.trends.length ? `Xu hướng tìm kiếm hiện tại (chỉ dùng nếu liên quan tới ngách):
${input.trends.map((t) => `- ${t}`).join("\n")}` : "",
            `Định dạng được dùng:
${input.formats.map((f) => `- ${f.id}: ${f.label} – ${f.guide}`).join("\n")}`,
            ideas.length ? `Ý tưởng ĐÃ CÓ ở các ngày trước (không lặp lại chủ đề):
${ideas.slice(-40).map((x) => `- ${x.title}`).join("\n")}` : "",
            `Lập ${input.perDay} ý tưởng mỗi ngày cho các ngày: ${dates.join(", ")} (tổng ${dates.length * input.perDay} ý tưởng).`,
            "format phải là một id trong danh sách trên. hook là câu mở đầu giữ chân người xem trong 3 giây đầu. description 1–3 câu nêu nội dung chính.",
            'Trả về DUY NHẤT một JSON hợp lệ theo đúng mẫu – danh sách phẳng, mỗi ý tưởng một object (mọi khóa đều có giá trị chuỗi, không xuống dòng trong chuỗi): {"ideas":[{"date":"YYYY-MM-DD","format":"id định dạng","title":"tiêu đề","hook":"câu mở đầu","description":"mô tả ngắn"}]}'
          ].filter(Boolean).join("\n"),
          json: true,
          maxTokens: Math.min(16e3, 2e3 + dates.length * input.perDay * 400),
          temperature: 0.8
        },
        { feature: "plan.generate", workspaceId: input.workspaceId },
        PlanSchema,
        (d) => d.ideas.flatMap((x) => [x.title, x.hook, x.description])
      );
      ideas.push(...data.ideas);
      metas.push(meta);
    } catch (err) {
      if (!(err instanceof AiError) || err.kind !== "invalid_output") throw err;
      console.warn(`[ai] plan.generate: đợt ${dates[0]}…${dates[dates.length - 1]} lỗi – ${err.message}`);
      lastErr = err;
    }
  }
  if (!metas.length) throw lastErr ?? new AiError("invalid_output", "AI trả về sai cấu trúc dữ liệu");
  const last = metas[metas.length - 1];
  const cost = metas.reduce((s, m) => m.costUsd == null ? s : (s ?? 0) + m.costUsd, null);
  return { ideas, meta: { ...last, costUsd: cost, attempts: metas.flatMap((m) => m.attempts) } };
}
