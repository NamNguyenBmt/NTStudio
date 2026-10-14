import { useState } from "react";
import { useApiMutation } from "../../lib/api";
import { Check, Copy, Gauge, Info, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Input";
import { toast } from "../../components/ui/toast";
import { formatRelative } from "../../lib/format";
import { HOOK_PLATFORM_LABEL, HEALTH_LABEL, hookGrade, hookFingerprint } from "../../../../shared/hook";

const RING = { success: "text-tertiary", warning: "text-warning", danger: "text-error" };

function ScoreRing({ score }) {
  const g = hookGrade(score);
  const c = 2 * Math.PI * 26;
  return <div className={cn("relative h-16 w-16 shrink-0", RING[g.tone])} title={g.label}>
    <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth="6" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
    </svg>
    <span className="absolute inset-0 flex items-center justify-center font-mono text-headline-sm text-on-surface">
      {score}
    </span>
  </div>;
}

const LEVEL = {
  risk: { icon: ShieldAlert, cls: "text-error" },
  warn: { icon: TriangleAlert, cls: "text-warning" },
  info: { icon: Info, cls: "text-outline" }
};

function HealthSection({ health }) {
  const st = HEALTH_LABEL[health.status];
  return <div className="flex flex-col gap-1">
    <span className="flex items-center gap-1.5 text-label-md text-on-surface-variant">
      {health.status === "ok" ? <ShieldCheck size={14} className="text-tertiary" /> : <ShieldAlert size={14} className={health.status === "risk" ? "text-error" : "text-warning"} />}
      {"Kiểm tra trước khi đăng "}
      <Badge tone={st.tone}>{st.label}</Badge>
    </span>
    {health.issues.length === 0 ? <p className="text-body-sm text-on-surface-variant">
      Không thấy từ ngữ dễ bị gỡ / bóp tương tác, bố cục caption ổn.
    </p> : <ul className="flex flex-col gap-1 text-body-sm">
      {health.issues.map((i) => {
        const L = LEVEL[i.level];
        return <li key={i.id} className="flex items-start gap-space-sm rounded-lg bg-surface-container-lowest px-space-sm py-1.5">
          <L.icon size={14} className={cn("mt-0.5 shrink-0", L.cls)} />
          <span className="min-w-0 flex-1">
            <span className="text-on-surface">{i.label}</span>
            <span className="ml-1 text-[10px] uppercase text-outline">{i.source === "ai" ? "AI" : "bộ lọc"}</span>
            {i.evidence && <span className="block text-label-sm text-on-surface-variant">{i.evidence}</span>}
            {i.fix && <span className="block text-label-sm text-outline">{"→ "}{i.fix}</span>}
          </span>
        </li>;
      })}
    </ul>}
    <p className="text-label-sm text-outline">
      Facebook / TikTok không công bố danh sách từ cấm – đây là các lỗi hay gặp, giúp giảm rủi ro chứ không bảo đảm tuyệt đối.
    </p>
  </div>;
}

export function HookPanel({ item, onUseHook }) {
  const saved = item.hookScore;
  const [platform, setPlatform] = useState(saved?.platform ?? "");
  const run = useApiMutation("content.hookScore", ["content."]);
  const s = run.data?.score ?? saved;
  const stale = !!s && s.for !== hookFingerprint(item, s.platform);
  const busy = run.isPending;
  const score = (force) => run.mutate(
    { id: item.id, platform: platform || void 0, force },
    {
      onSuccess: (r) => {
        setPlatform(r.score.platform);
        if (r.cached) toast.info('Bài chưa đổi từ lần chấm trước – giữ điểm cũ (bấm "Chấm lại" để chấm mới)');
      },
      onError: (e) => toast.error(e.message)
    }
  );
  const grade = s ? hookGrade(s.score) : null;
  return <section className="mt-space-md flex flex-col gap-space-sm border-t border-overlay/[0.06] pt-space-md">
    <div className="flex flex-wrap items-center justify-between gap-space-sm">
      <h3 className="flex items-center gap-1.5 text-label-md text-on-surface">
        <Gauge size={14} className="text-secondary" />
        {" Chấm điểm Hook & kiểm tra trước đăng"}
        {grade && <Badge tone={grade.tone}>{grade.label}</Badge>}
        {s?.health && s.health.status !== "ok" && <Badge tone={HEALTH_LABEL[s.health.status].tone}>{HEALTH_LABEL[s.health.status].label}</Badge>}
        {stale && <Badge tone="warning">Bài đã sửa sau khi chấm</Badge>}
      </h3>
      <div className="flex items-center gap-space-xs">
        <div className="w-32">
          <Select aria-label="Nền tảng chấm" value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-7 text-label-sm">
            <option value="">Tự nhận nền tảng</option>
            {Object.keys(HOOK_PLATFORM_LABEL).map((p) => <option key={p} value={p}>{HOOK_PLATFORM_LABEL[p]}</option>)}
          </Select>
        </div>
        <Button size="sm" variant={s ? "subtle" : "primary"} disabled={busy} onClick={() => score(!!s)}>
          {busy ? <LoaderCircle size={12} className="animate-spin" /> : s ? <RefreshCw size={12} /> : <Gauge size={12} />}
          {" "}
          {s ? "Chấm lại" : "Chấm điểm"}
        </Button>
      </div>
    </div>
    {!s ? <p className="text-body-sm text-on-surface-variant">
      AI đóng vai giám đốc nội dung khó tính chấm câu mở đầu (video làm từ Xưởng video: chấm lời + hình 3 giây đầu). Điểm = 40% kiểm tra kỹ thuật + 60% AI, kèm lý do từng điểm trừ và 3 câu mở đầu viết lại. Cùng lúc soát từ ngữ dễ bị gỡ / bóp tương tác (cam kết chữa bệnh, làm giàu nhanh, hàng nhái, câu kéo like / share…) và bố cục caption. Lưu bài trước khi chấm.
    </p> : <>
      <div className="flex items-start gap-space-md rounded-lg bg-surface-container-lowest p-space-sm">
        <ScoreRing score={s.score} />
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-body-sm">
          <div className="flex flex-wrap gap-x-space-md gap-y-0.5 text-label-sm text-on-surface-variant">
            <span>{"Kỹ thuật "}<b className="font-mono text-on-surface">{s.codeScore}</b></span>
            <span>{"AI "}<b className="font-mono text-on-surface">{s.aiScore}</b></span>
            <span>{HOOK_PLATFORM_LABEL[s.platform]}</span>
            <span className="text-outline">{s.model}{" · "}{formatRelative(new Date(s.at))}</span>
          </div>
          <div className="text-on-surface">
            <span className="text-outline">{s.withVisual ? "Lời 3 giây đầu: " : "Câu mở đầu: "}</span>
            “
            {s.hook}
            ”
          </div>
          {s.verdict && <p className="text-on-surface-variant">{s.verdict}</p>}
        </div>
      </div>
      <ul className="flex flex-col gap-1 text-body-sm">
        {[...s.checks].sort((a, b) => a.points - b.points).map((c) => <li key={`${c.source}-${c.id}`} className="flex items-start gap-space-sm rounded px-1 py-0.5">
          <span
            className={cn(
              "mt-0.5 w-9 shrink-0 text-right font-mono text-label-sm",
              c.points < 0 ? "text-error" : c.points > 0 ? "text-tertiary" : "text-outline"
            )}
          >
            {c.points > 0 ? `+${c.points}` : c.points < 0 ? c.points : <Check size={12} className="ml-auto" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={c.points < 0 ? "text-on-surface" : "text-on-surface-variant"}>{c.label}</span>
            <span className="ml-1 text-[10px] uppercase text-outline">{c.source === "ai" ? "AI" : "kỹ thuật"}</span>
            {c.evidence && <span className="block text-label-sm text-outline">{c.evidence}</span>}
          </span>
        </li>)}
      </ul>
      {s.health ? <HealthSection health={s.health} /> : <p className="text-label-sm text-outline">Lần chấm này chưa có kiểm tra trước đăng – bấm "Chấm lại".</p>}
      {s.suggestions.length > 0 && <div className="flex flex-col gap-1">
        <span className="text-label-md text-on-surface-variant">Câu mở đầu gợi ý</span>
        {s.suggestions.map((h) => <div key={h} className="flex items-center gap-space-sm rounded-lg bg-surface-container-lowest px-space-sm py-1.5 text-body-sm">
          <span className="min-w-0 flex-1 text-on-surface">{h}</span>
          {s.withVisual ? <Button
            size="sm"
            variant="subtle"
            title="Lời 3 giây đầu nằm trong video – chép câu này rồi sửa lời cảnh 1 ở Xưởng video và render lại"
            onClick={() => void navigator.clipboard.writeText(h).then(() => toast.success("Đã chép – dán vào lời cảnh 1 ở Xưởng video"))}
          >
            <Copy size={12} />
            {" Chép"}
          </Button> : <Button size="sm" variant="subtle" title="Thay dòng đầu của caption bằng câu này (bấm Lưu để giữ)" onClick={() => onUseHook(h)}>
            Dùng câu này
          </Button>}
        </div>)}
      </div>}
    </>}
  </section>;
}
