import { useState, useEffect } from "react";
import { call, useApiMutation } from "../../lib/api";
import { BookOpen, Clock, ImagePlus, Plus, RotateCcw, Save, SlidersHorizontal, Sparkles, Trash, Wallet } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { Progress } from "../../components/ui/Progress";
import { toast } from "../../components/ui/toast";

const toDraft = (ws) => ({
  brandVoice: ws.brandVoice ?? "",
  knowledge: ws.knowledge ?? "",
  tags: ws.tags.join(" "),
  aiBudgetUsd: ws.aiBudgetUsd != null ? String(ws.aiBudgetUsd) : "",
  watermarkPath: ws.watermarkPath,
  watermarkPosition: ws.watermarkPosition ?? "br",
  watermarkOpacity: ws.watermarkOpacity,
  goldenHours: ws.goldenHours
});

const positionLabel = { tl: "Góc trái trên", tr: "Góc phải trên", bl: "Góc trái dưới", br: "Góc phải dưới", center: "Chính giữa" };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function Section({ icon: Icon, title, aside, children }) {
  return <section className="flex flex-col gap-space-sm">
    <div className="flex items-center justify-between gap-space-sm">
      <h4 className="flex items-center gap-1.5 text-label-md text-on-surface">
        <Icon size={15} className="text-secondary" />
        {" "}
        {title}
      </h4>
      {aside}
    </div>
    {children}
  </section>;
}

export function RulesPanel({ ws }) {
  const [draft, setDraft] = useState(() => toDraft(ws));
  const update = useApiMutation("workspaces.update", ["workspaces.", "dashboard."]);
  useEffect(() => setDraft(toDraft(ws)), [ws]);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setSlot = (i, patch) => set("goldenHours", draft.goldenHours.map((s, j) => j === i ? { ...s, ...patch } : s));
  const budget = draft.aiBudgetUsd.trim() === "" ? null : Number(draft.aiBudgetUsd);
  const budgetInvalid = budget != null && (!Number.isFinite(budget) || budget < 0);
  const slotsInvalid = draft.goldenHours.some((s) => !HHMM.test(s.start) || !HHMM.test(s.end) || s.start >= s.end);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(ws));
  const used = ws.aiBudgetUsd ? Math.min(100, ws.aiSpentUsd / ws.aiBudgetUsd * 100) : 0;
  const save = () => {
    if (budgetInvalid || slotsInvalid) return;
    update.mutate({
      id: ws.id,
      patch: {
        brandVoice: draft.brandVoice.trim() || null,
        knowledge: draft.knowledge.trim() || null,
        tags: draft.tags.split(/[\s,]+/).filter(Boolean).map((t) => t.startsWith("#") ? t : `#${t}`),
        aiBudgetUsd: budget,
        watermarkPath: draft.watermarkPath,
        watermarkPosition: draft.watermarkPosition,
        watermarkOpacity: draft.watermarkOpacity,
        goldenHours: [...draft.goldenHours].sort((a, b) => a.start.localeCompare(b.start))
      }
    });
  };
  return <Card className="flex flex-col gap-space-lg p-space-md">
    <div className="flex items-center justify-between gap-space-sm">
      <h3 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
        <SlidersHorizontal size={18} className="text-secondary" />
        {" Quy tắc & Hạn ngạch"}
      </h3>
      <Badge tone="primary" className="max-w-[45%] truncate">{ws.name}</Badge>
    </div>
    <Section icon={Wallet} title={"Hạn ngạch AI & API phân bổ"} aside={<span className="font-mono text-code text-on-surface">
      {ws.aiBudgetUsd != null ? `$${ws.aiBudgetUsd.toFixed(2)} / tháng` : "Dùng hạn mức chung"}
    </span>}>
      {ws.aiBudgetUsd != null && <div className="rounded-lg bg-surface-container-lowest p-space-sm">
        <div className="flex justify-between font-mono text-code">
          <span className="text-on-surface-variant">
            Đã dùng: $
            {ws.aiSpentUsd.toFixed(2)}
            {" ("}
            {Math.round(used)}
            %)
          </span>
          <span className={used >= 90 ? "text-error" : "text-tertiary"}>
            Còn lại $
            {Math.max(0, ws.aiBudgetUsd - ws.aiSpentUsd).toFixed(2)}
          </span>
        </div>
        <Progress value={used} className="mt-1.5" barClassName={used >= 90 ? "bg-danger" : used >= 70 ? "bg-warning" : "bg-secondary"} />
      </div>}
      <Field label="Ngân sách tháng (USD)" hint="Để trống = dùng hạn mức chung ở Cài đặt" error={budgetInvalid ? "Số không hợp lệ" : null}>
        {(id) => <Input id={id} inputMode="decimal" value={draft.aiBudgetUsd} onChange={(e) => set("aiBudgetUsd", e.target.value)} placeholder="20" />}
      </Field>
    </Section>
    <Section
      icon={ImagePlus}
      title={"Watermark & Nhận diện riêng"}
      aside={<Button
        size="sm"
        variant="subtle"
        onClick={async () => {
          const path = await call("system.pickImage");
          if (path) set("watermarkPath", path);
        }}
      >
        {draft.watermarkPath ? "Thay đổi" : "Chọn ảnh"}
      </Button>}
    >
      <p className="text-body-sm text-on-surface-variant">Tự động đóng dấu góc video khi render bằng FFmpeg (P4).</p>
      <div className="flex items-center gap-space-sm rounded-lg bg-surface-container-lowest p-space-sm">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-code text-on-surface" title={draft.watermarkPath ?? void 0}>
            {draft.watermarkPath ? draft.watermarkPath.split(/[\\/]/).pop() : "Chưa có watermark"}
          </div>
          <div className="text-label-sm text-outline">
            {positionLabel[draft.watermarkPosition]}
            {" · Độ đậm "}
            {Math.round(draft.watermarkOpacity * 100)}
            %
          </div>
        </div>
        {draft.watermarkPath && <IconTrash onClick={() => set("watermarkPath", null)} />}
      </div>
      <div className="grid grid-cols-2 gap-space-sm">
        <Select aria-label="Vị trí watermark" value={draft.watermarkPosition} onChange={(e) => set("watermarkPosition", e.target.value)}>
          {Object.entries(positionLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(draft.watermarkOpacity * 100)}
          onChange={(e) => set("watermarkOpacity", Number(e.target.value) / 100)}
          aria-label="Độ đậm watermark"
          className="accent-primary-container"
        />
      </div>
    </Section>
    <Section icon={SlidersHorizontal} title={"Brand voice & Hashtag"}>
      <Textarea value={draft.brandVoice} onChange={(e) => set("brandVoice", e.target.value)} placeholder="Giọng văn thương hiệu dùng cho AI viết caption, kịch bản, trả lời khách…" className="min-h-[72px]" aria-label="Brand voice" />
      <Input value={draft.tags} onChange={(e) => set("tags", e.target.value)} placeholder="#Fashion #Reels" aria-label="Hashtag ngách" />
    </Section>
    <Section icon={BookOpen} title="Kiến thức trả lời khách (AI)">
      <Textarea
        value={draft.knowledge}
        onChange={(e) => set("knowledge", e.target.value)}
        placeholder={`AI chỉ trả lời dựa trên thông tin ở đây – càng đủ, AI càng tự trả lời được nhiều. Ví dụ:
- Áo thun basic: 189k, size S–XL (S < 50kg, M 50–60kg…)
- Ship toàn quốc 25k, freeship đơn từ 500k, giao 2–4 ngày
- Đổi size trong 7 ngày, giữ tem mác
- Giờ làm việc 8h–22h, hotline 09xx…`}
        className="min-h-[140px]"
        aria-label="Kiến thức trả lời khách"
        maxLength={8e3}
      />
      <p className="text-label-sm text-outline">
        Dùng cho AI tự trả lời bình luận / tin nhắn của các kênh trong Pocket này. Thiếu thông tin, AI sẽ xin SĐT và chuyển cho nhân viên duyệt.
      </p>
    </Section>
    <Section
      icon={Clock}
      title="Lịch giờ vàng của ngách"
      aside={<div className="flex gap-1">
        <Button
          size="sm"
          variant="subtle"
          title="Tính từ tương tác thật của các bài đã đăng trong Pocket (90 ngày)"
          onClick={() => void call("insights.bestHours", { workspaceId: ws.id }).then((r) => {
            if (!r.suggested.length) return toast.info(`Cần ít nhất ${r.minPosts} bài đã đăng có số liệu (hiện có ${r.posts}) – bấm "Đồng bộ số liệu" ở Tổng quan sau khi đăng thêm bài`);
            set("goldenHours", r.suggested);
            toast.success(`Đã gợi ý ${r.suggested.length} khung giờ từ ${r.posts} bài – bấm Lưu để áp dụng`);
          }).catch((e) => toast.error(e.message))}
        >
          <Sparkles size={12} />
          {" Gợi ý từ dữ liệu"}
        </Button>
        <Button size="sm" variant="subtle" onClick={() => set("goldenHours", [...draft.goldenHours, { start: "20:00", end: "22:00", weight: 0.3 }])}>
          <Plus size={12} />
          {" Thêm khung"}
        </Button>
      </div>}
    >
      <ul className="flex flex-col gap-1">
        {draft.goldenHours.length === 0 && <li className="text-body-sm text-outline">Chưa có khung giờ vàng.</li>}
        {draft.goldenHours.map((s, i) => {
          const bad = !HHMM.test(s.start) || !HHMM.test(s.end) || s.start >= s.end;
          return <li key={i} className={cn("grid grid-cols-[1fr_1fr_64px_auto] items-center gap-1", bad && "rounded ring-1 ring-danger/50")}>
            <Input aria-label="Bắt đầu" value={s.start} onChange={(e) => setSlot(i, { start: e.target.value })} className="font-mono" />
            <Input aria-label="Kết thúc" value={s.end} onChange={(e) => setSlot(i, { end: e.target.value })} className="font-mono" />
            <Input
              aria-label="Tỷ trọng %"
              inputMode="numeric"
              value={Math.round(s.weight * 100)}
              onChange={(e) => setSlot(i, { weight: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })}
              className="text-right font-mono"
            />
            <IconTrash onClick={() => set("goldenHours", draft.goldenHours.filter((_, j) => j !== i))} />
          </li>;
        })}
      </ul>
      {slotsInvalid && <p className="text-label-sm text-error">Giờ phải dạng HH:mm và giờ bắt đầu nhỏ hơn giờ kết thúc.</p>}
    </Section>
    <div className="flex gap-space-sm">
      <Button variant="primary" className="flex-1" disabled={!dirty || budgetInvalid || slotsInvalid || update.isPending} onClick={save}>
        <Save size={15} />
        {" Lưu thiết lập Pocket"}
      </Button>
      <Button variant="subtle" disabled={!dirty} onClick={() => setDraft(toDraft(ws))} aria-label="Hoàn tác thay đổi" title="Hoàn tác thay đổi">
        <RotateCcw size={15} />
      </Button>
    </div>
    {update.error && <p className="text-body-sm text-error">{update.error.message}</p>}
  </Card>;
}

function IconTrash({ onClick }) {
  return <button type="button" aria-label="Xóa" onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded text-on-surface-variant hover:bg-danger/15 hover:text-error">
    <Trash size={14} />
  </button>;
}
