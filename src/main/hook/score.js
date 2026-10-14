import { z } from "zod";
import { eq, desc, asc } from "drizzle-orm";
import { channels, videoProjects, videoScenes, scheduledPosts } from "../db/schema";
import { getDb } from "../db/index";
import { need, opt, bool, list, aiJson } from "../ai/structured";
import { HOOK_PLATFORM_LABEL, hookFingerprint } from "../../shared/hook";

const firstLine = (s) => (s ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";

export function guessPlatform(item) {
  const db = getDb();
  const sched = db.select({ platform: channels.platform }).from(scheduledPosts).innerJoin(channels, eq(channels.id, scheduledPosts.channelId)).where(eq(scheduledPosts.contentItemId, item.id)).orderBy(desc(scheduledPosts.scheduledAt)).get();
  if (sched) return sched.platform;
  const proj = db.select({ ch: videoProjects.targetChannelId }).from(videoProjects).where(eq(videoProjects.contentItemId, item.id)).get();
  const ch = proj?.ch ? db.select({ platform: channels.platform }).from(channels).where(eq(channels.id, proj.ch)).get() : void 0;
  if (ch) return ch.platform;
  return item.kind === "video" || item.kind === "reel" ? "tiktok" : "facebook";
}

function hookContext(item, platform) {
  const db = getDb();
  const proj = db.select().from(videoProjects).where(eq(videoProjects.contentItemId, item.id)).get();
  if (proj) {
    const scenes = db.select().from(videoScenes).where(eq(videoScenes.projectId, proj.id)).orderBy(asc(videoScenes.position)).limit(2).all();
    const first = scenes[0];
    if (first) {
      const take = first.durationSec < 2.5 && scenes[1] ? scenes : [first];
      const said = proj.narration ? take.map((s) => s.voiceover.trim()).filter(Boolean).join(" ") : "";
      return {
        platform,
        hook: said || firstLine(item.caption) || item.title,
        visual: take.map((s) => s.mediaPrompt?.trim()).filter(Boolean).join(" | ") || null,
        silent: !proj.narration
      };
    }
  }
  return { platform, hook: firstLine(item.caption) || item.title, visual: null, silent: false };
}

const CLICHES = [
  "khám phá ngay",
  "tuyệt vời",
  "giải pháp toàn diện",
  "đừng bỏ lỡ",
  "không thể bỏ qua",
  "hãy cùng",
  "cùng tìm hiểu",
  "trong thế giới",
  "trong thời đại",
  "nâng tầm",
  "đẳng cấp",
  "hoàn hảo",
  "trải nghiệm tuyệt vời",
  "bí quyết thành công",
  "thay đổi cuộc chơi",
  "chưa từng có",
  "một cách dễ dàng",
  "hành trình",
  "game changer",
  "unlock",
  "elevate"
];

const GREETING = /^(xin chào|chào (các |mọi )?(bạn|người|cả nhà)|chào mừng|hello|hi\b|hey\b|alo|hôm nay (mình|tôi|chúng ta) (sẽ|cùng))/i;
const HASHTAG_RANGE = { facebook: [1, 3], instagram: [3, 5], tiktok: [3, 5], youtube: [1, 3] };
const syllables = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const emojiCount = (s) => (s.match(/\p{Extended_Pictographic}/gu) ?? []).length;

function codeChecks(item, ctx) {
  const out = [];
  const add = (id, label, points, evidence = null) => void out.push({ id, label, points, evidence, source: "code" });
  const hook = ctx.hook;
  const n = syllables(hook);
  const head = `${hook}
${(item.caption ?? "").slice(0, 220)}`.toLowerCase();
  if (GREETING.test(hook.trim())) add("greeting", "Mở đầu bằng lời chào / giới thiệu – phí 3 giây đầu", -20, hook.slice(0, 60));
  else add("greeting", "Không mở đầu bằng lời chào", 0);
  if (n > 30) add("length", "Câu mở đầu quá dài (trên 30 tiếng)", -20, `${n} tiếng`);
  else if (n > 20) add("length", "Câu mở đầu dài (trên 20 tiếng)", -10, `${n} tiếng`);
  else if (n < 3) add("length", "Câu mở đầu quá cụt (dưới 3 tiếng)", -10, `${n} tiếng`);
  else add("length", "Độ dài câu mở đầu vừa phải", 0, `${n} tiếng`);
  const found = CLICHES.filter((c) => head.includes(c));
  add("cliche", found.length ? "Có cụm từ sáo rỗng / văn mẫu" : "Không có cụm từ sáo rỗng", -Math.min(24, found.length * 8), found.length ? found.map((f) => `"${f}"`).join(", ") : null);
  const tags = item.hashtags.length;
  const [lo, hi] = HASHTAG_RANGE[ctx.platform];
  if (tags < lo) add("hashtags", `Thiếu hashtag (${HOOK_PLATFORM_LABEL[ctx.platform]} nên ${lo}–${hi})`, -5, `${tags} thẻ`);
  else if (tags > hi * 2) add("hashtags", `Quá nhiều hashtag (${HOOK_PLATFORM_LABEL[ctx.platform]} nên ${lo}–${hi})`, -10, `${tags} thẻ`);
  else if (tags > hi) add("hashtags", `Hơi nhiều hashtag (${HOOK_PLATFORM_LABEL[ctx.platform]} nên ${lo}–${hi})`, -5, `${tags} thẻ`);
  else add("hashtags", "Số hashtag hợp lý", 0, `${tags} thẻ`);
  const caption = item.caption ?? "";
  const longest = Math.max(0, ...caption.split(/\n\s*\n|\n/).map((p) => p.length));
  if (caption.length > 300 && longest > 280) add("density", "Caption đặc chữ (đoạn dài, không ngắt dòng)", -10, `đoạn dài nhất ${longest} ký tự`);
  else add("density", "Caption dễ đọc, có ngắt dòng", 0);
  if (emojiCount(hook) > 3) add("emoji", "Câu mở đầu nhiều emoji (trên 3)", -5, `${emojiCount(hook)} emoji`);
  if (ctx.platform === "youtube") {
    const len = item.title.trim().length;
    add("title", len < 40 || len > 70 ? "Tiêu đề YouTube nên dài 40–70 ký tự" : "Độ dài tiêu đề YouTube hợp lý", len < 40 || len > 70 ? -10 : 0, `${len} ký tự`);
  }
  return out;
}

const POLICY = [
  {
    id: "health-claim",
    level: "risk",
    label: "Cam kết chữa bệnh / công dụng y tế",
    re: /(trị|chữa)\s*(dứt điểm|khỏi hẳn|tận gốc|bách bệnh)|khỏi\s*(hẳn|100\s*%)|đặc trị|thần dược|thay thế thuốc|không cần (đi )?(bác sĩ|uống thuốc)|chữa khỏi/i,
    fix: 'Bỏ cam kết công dụng; nói trải nghiệm / thành phần, thêm "hiệu quả tùy cơ địa"'
  },
  {
    id: "absolute",
    level: "warn",
    label: "Cam kết tuyệt đối (100%, đảm bảo, ngay lập tức)",
    re: /cam kết\s*100\s*%|100\s*%\s*(hiệu quả|thành công|an toàn|khỏi)|hiệu quả\s*(tuyệt đối|ngay lập tức|cấp tốc)|đảm bảo\s*(khỏi|hiệu quả|thành công)|không\s*(có\s*)?tác dụng phụ/i,
    fix: 'Đổi sang mô tả có điều kiện, có dẫn chứng (vd "nhiều khách phản hồi…")'
  },
  {
    id: "before-after",
    level: "warn",
    label: "So sánh trước / sau (ngoại hình, cân nặng, da)",
    re: /trước\s*(và|&|\/|-)?\s*sau\s*(khi\s*)?(dùng|sử dụng|điều trị|uống)|before\s*[&/-]?\s*after/i,
    fix: "Tránh ảnh / câu so sánh trước–sau; mô tả quá trình thay vì kết quả"
  },
  {
    id: "weight",
    level: "risk",
    label: "Giảm cân thần tốc theo thời gian",
    re: /giảm\s*\d+\s*(kg|ký|cân).{0,25}(ngày|tuần|tháng)|giảm cân\s*(cấp tốc|thần tốc|siêu tốc)/i,
    fix: "Bỏ con số kg theo thời gian; nói về thói quen / cảm nhận"
  },
  {
    id: "money",
    level: "risk",
    label: "Hứa hẹn thu nhập / làm giàu nhanh",
    re: /(thu nhập|kiếm|lãi|lời)\s*\d+[\d.,]*\s*(triệu|tr|củ|k|nghìn|đô|\$).{0,15}(\/|mỗi|một|1)\s*(ngày|tuần|tháng)|làm giàu (nhanh|cấp tốc)|lợi nhuận\s*(cam kết|đảm bảo|cố định)|x\s*[2-9]\s*tài khoản|việc nhẹ lương cao/i,
    fix: "Bỏ con số thu nhập cam kết; nói về kỹ năng / quy trình"
  },
  {
    id: "counterfeit",
    level: "risk",
    label: "Từ ngữ hàng nhái / hàng giả thương hiệu",
    re: /hàng\s*(fake|nhái|giả)(?=[\s.,!?;:)]|$)|replica|super\s*fake|\brep\s*1\s*:\s*1|like\s*auth|siêu cấp\s*(like|giống)/i,
    fix: "Không dùng từ chỉ hàng nhái, không gắn tên thương hiệu lớn cho hàng không chính hãng"
  },
  {
    id: "gambling",
    level: "risk",
    label: "Cờ bạc / cá độ / vay nóng",
    re: /cá độ|nhà cái|tài xỉu|lô\s*đề|soi cầu|vay (tiền )?(nhanh|nóng|online không thẩm định)|bốc bát họ|tín dụng đen/i,
    fix: "Nội dung này bị hạn chế trên mọi nền tảng – bỏ hẳn"
  },
  {
    id: "bait",
    level: "warn",
    label: "Câu kéo tương tác (like / share / tag để nhận…)",
    re: /(like|thả tim|share|chia sẻ)\s*(và|&|\+)\s*(share|chia sẻ|bình luận|comment)|tag\s*\d+\s*(người|đứa|bạn)|(comment|bình luận|cmt)\s*["“'‘]?\s*(có|yes|ok|1|\.)\s*["”'’]?\s*(để|nhận|là)|share để nhận/i,
    fix: "Facebook giảm tiếp cận bài xin like / share / tag – đặt câu hỏi thật để người xem tự bình luận",
    platforms: ["facebook", "instagram"]
  }
];

const FOLD = { facebook: 140, instagram: 125, tiktok: 100, youtube: 100 };
const MAX_CAPTION = { instagram: 2200, tiktok: 4e3, facebook: 63206, youtube: 5e3 };

function healthChecks(item, ctx) {
  const out = [];
  const text = `${item.title}
${item.caption ?? ""}
${item.firstComment ?? ""}`;
  for (const p of POLICY) {
    if (p.platforms && !p.platforms.includes(ctx.platform)) continue;
    const m = text.match(p.re);
    if (m) out.push({ id: p.id, level: p.level, label: p.label, evidence: `"${m[0].trim()}"`, fix: p.fix, source: "code" });
  }
  const caption = item.caption ?? "";
  const first = caption.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  const fold = FOLD[ctx.platform];
  if (first.length > fold)
    out.push({
      id: "fold",
      level: "warn",
      label: `Dòng đầu caption dài hơn phần hiện trước "Xem thêm" (~${fold} ký tự trên ${HOOK_PLATFORM_LABEL[ctx.platform]})`,
      evidence: `${first.length} ký tự`,
      fix: "Đưa ý chính / câu hook lên trước, cắt dòng đầu ngắn lại",
      source: "code"
    });
  const max = MAX_CAPTION[ctx.platform];
  if (max && caption.length > max)
    out.push({ id: "too-long", level: "risk", label: `Caption vượt giới hạn ${HOOK_PLATFORM_LABEL[ctx.platform]} (${max} ký tự) – bài có thể đăng lỗi`, evidence: `${caption.length} ký tự`, fix: "Rút gọn caption", source: "code" });
  if (ctx.platform === "instagram" && item.hashtags.length > 30)
    out.push({ id: "ig-tags", level: "risk", label: "Instagram giới hạn 30 hashtag", evidence: `${item.hashtags.length} thẻ`, fix: "Giữ 3–5 hashtag sát chủ đề", source: "code" });
  if (/https?:\/\/|www\./i.test(caption)) {
    if (ctx.platform === "tiktok" || ctx.platform === "instagram")
      out.push({ id: "link", level: "info", label: `Link trong caption ${HOOK_PLATFORM_LABEL[ctx.platform]} không bấm được`, evidence: null, fix: "Đưa link vào bio / bình luận", source: "code" });
    else if (ctx.platform === "facebook")
      out.push({ id: "link", level: "info", label: "Link ngoài trong bài Facebook thường bị giảm tiếp cận", evidence: null, fix: 'Đặt link ở "Bình luận đầu tiên" (ô bên dưới caption)', source: "code" });
  }
  if ((item.kind === "video" || item.kind === "reel") && !item.hashtags.length)
    out.push({ id: "no-tags", level: "warn", label: "Video chưa có hashtag phân loại chủ đề", evidence: null, fix: 'Thêm 3–5 hashtag sát chủ đề (nút "Đổi Hashtag AI")', source: "code" });
  return out;
}

const AI_POLICY_RISK = new Set(["health", "finance", "adult", "violence", "hate", "gambling", "misinfo", "counterfeit"]);
const Crit = z.object({ ok: bool(), evidence: opt(300) }).catch({ ok: false, evidence: "" });

const HookAiZ = z.object({
  criteria: z.object({
    curiosity: Crit,
    specific: Crit,
    emotion: Crit,
    clarity: Crit,
    fresh: Crit,
    contrast: Crit,
    visual: Crit.optional()
  }),
  verdict: opt(400),
  suggestions: list(need(300), 0, 5).catch([]),
  /** Ý dễ vi phạm chính sách mà bộ lọc từ khóa có thể bỏ sót (diễn đạt khéo, ngầm hiểu) */
  policy: list(z.object({ category: opt(40), quote: opt(300), why: opt(300), fix: opt(300) }), 0, 8).catch([])
});

const AI_RUBRIC = [
  { id: "curiosity", label: "Gây tò mò / mở vòng lặp ngay câu đầu", fail: -20 },
  { id: "clarity", label: "Người xem hiểu ngay video / bài nói về gì, dành cho ai", fail: -15 },
  { id: "fresh", label: "Giọng tự nhiên như người thật, không văn mẫu / mùi AI", fail: -15 },
  { id: "specific", label: "Có con số / chi tiết cụ thể / tình huống thật", fail: -10 },
  { id: "emotion", label: "Chạm cảm xúc hoặc nỗi đau / mong muốn của người xem", fail: -10 },
  { id: "visual", label: "Hình 3 giây đầu gây chú ý (chuyển động, cận cảnh, bất ngờ)", fail: -10 },
  { id: "contrast", label: 'Có yếu tố đối lập / nghịch lý (vd "Đừng làm X nếu muốn Y")', fail: 0, bonus: 10 }
];

const SYSTEM = 'Bạn là Giám đốc Nội dung cực kỳ khắt khe trên mạng xã hội, chuyên tối ưu tỷ lệ giữ chân người xem cho TikTok, Reels, Facebook, YouTube. Bạn ghét văn phong học thuật, sáo rỗng, mùi AI. Nhiệm vụ: bóc mẽ điểm yếu khiến người xem lướt qua trong 3 giây đầu. Đánh giá NGHIÊM: chỉ cho "ok": true khi tiêu chí đạt rõ ràng, có thể trích dẫn chữ / hình cụ thể. Nghi ngờ → false. evidence: trích nguyên văn phần liên quan hoặc nói ngắn gọn vì sao không đạt (tiếng Việt).';

export async function scoreHook(item, platform, workspaceId) {
  const ctx = hookContext(item, platform);
  const code = codeChecks(item, ctx);
  const codeScore = Math.max(0, Math.min(100, 100 + code.reduce((a, c) => a + c.points, 0)));
  const withVisual = !!ctx.visual;
  const { data, meta } = await aiJson(
    {
      system: SYSTEM,
      prompt: [
        `Nền tảng: ${platform}. Định dạng: ${item.kind}${ctx.silent ? " (video KHÔNG lời thoại – hook nằm ở hình + chữ caption)" : ""}.`,
        `Tiêu đề: ${item.title}`,
        `Câu mở đầu (${withVisual && !ctx.silent ? "lời nói trong 3 giây đầu video" : "dòng đầu người xem thấy"}): "${ctx.hook}"`,
        withVisual ? `Hình 3 giây đầu (mô tả cảnh quay, tiếng Anh): ${ctx.visual}` : "",
        item.caption ? `Caption đầy đủ:
${item.caption.slice(0, 1500)}` : "",
        item.hashtags.length ? `Hashtag: ${item.hashtags.join(" ")}` : "",
        "Chấm từng tiêu chí (ok true/false + evidence):",
        "- curiosity: câu đầu tạo câu hỏi / khoảng trống khiến phải xem tiếp",
        "- clarity: hiểu ngay chủ đề và người xem mục tiêu",
        "- fresh: tự nhiên như người thật nói, không sáo rỗng, không văn mẫu AI",
        "- specific: có con số, chi tiết, tình huống cụ thể",
        "- emotion: chạm cảm xúc / nỗi đau / mong muốn",
        withVisual ? "- visual: hình 3 giây đầu đủ mạnh để dừng ngón tay lướt" : "",
        "- contrast: có đối lập / nghịch lý / phá vỡ kỳ vọng",
        "verdict: 1–2 câu nhận xét thẳng thắn. suggestions: 3 câu mở đầu viết lại (tiếng Việt, ≤ 20 tiếng, giữ đúng nội dung, không bịa số liệu).",
        "policy: soát như người kiểm duyệt Facebook / TikTok – liệt kê câu dễ bị gỡ / bóp tương tác (kể cả diễn đạt khéo): category ∈ health (công dụng y tế, chữa bệnh), finance (hứa thu nhập, đầu tư), adult, violence, hate, gambling, misinfo (thông tin sai / gây hoang mang), counterfeit (hàng nhái, mạo danh thương hiệu), bait (xin like / share / tag), other. quote: trích nguyên văn; why: vì sao rủi ro; fix: câu viết lại an toàn. Không có thì để mảng rỗng – KHÔNG bịa.",
        `Trả về JSON: {"criteria":{"curiosity":{"ok","evidence"},"clarity":{...},"fresh":{...},"specific":{...},"emotion":{...},${withVisual ? '"visual":{...},' : ""}"contrast":{...}},"verdict","suggestions":[],"policy":[{"category","quote","why","fix"}]}`
      ].filter(Boolean).join("\n"),
      json: true,
      maxTokens: 2500,
      temperature: 0.2
    },
    { feature: "content.hook", workspaceId },
    HookAiZ,
    (d) => [d.verdict, ...d.suggestions]
  );
  const ai = AI_RUBRIC.filter((r) => r.id !== "visual" || withVisual).map((r) => {
    const c = data.criteria[r.id] ?? { ok: false, evidence: "" };
    return { id: r.id, label: r.label, points: c.ok ? r.bonus ?? 0 : r.fail, evidence: c.evidence || null, source: "ai" };
  });
  const aiScore = Math.max(0, Math.min(100, 100 + ai.reduce((a, c) => a + c.points, 0)));
  return {
    score: Math.round(0.4 * codeScore + 0.6 * aiScore),
    codeScore,
    aiScore,
    platform,
    hook: ctx.hook,
    withVisual,
    checks: [...ai, ...code],
    health: buildHealth(item, ctx, data.policy),
    verdict: data.verdict,
    suggestions: data.suggestions.slice(0, 3),
    model: meta.model,
    at: Date.now(),
    for: hookFingerprint(item, platform)
  };
}

function buildHealth(item, ctx, policy) {
  const issues = healthChecks(item, ctx);
  const seen = issues.map((i) => (i.evidence ?? "").toLowerCase());
  for (const p of policy) {
    if (!p.quote && !p.why) continue;
    const q = p.quote.toLowerCase();
    if (q && seen.some((e) => e && (e.includes(q) || q.includes(e.replace(/"/g, ""))))) continue;
    const cat = p.category.toLowerCase();
    issues.push({
      id: `ai-${cat || "other"}-${issues.length}`,
      level: AI_POLICY_RISK.has(cat) ? "risk" : "warn",
      label: p.why || "AI: câu có thể vi phạm chính sách",
      evidence: p.quote ? `"${p.quote}"` : null,
      fix: p.fix || null,
      source: "ai"
    });
  }
  const order = { risk: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return { status: issues.some((i) => i.level === "risk") ? "risk" : issues.some((i) => i.level === "warn") ? "warn" : "ok", issues };
}
