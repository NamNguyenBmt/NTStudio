import { useRef, useState, useEffect } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { Lightbulb, LoaderCircle, Sparkles, Square, Volume2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { Kbd } from "../../components/ui/Kbd";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";
import { platformMeta } from "../calendar/ScheduleDialog";
import { ASPECT_LABEL, TRANSITION_LABEL, SHORT_DURATIONS, LONG_DURATIONS, isLongForm, durationLabel } from "../../../../shared/video";
import { providerInfo } from "../../../../shared/providers";
import { CONTENT_FORMATS, isCustomFormat, formatById } from "../../../../shared/content-formats";
import "./SceneVisualPanel";
import { ProjectRefsField } from "./refs";
import { VisualBibleEditor } from "./VisualBibleEditor";

const MODES = [
  {
    value: "stock",
    title: "Tiết kiệm (Video có sẵn)",
    badge: "Miễn phí",
    desc: "Mỗi cảnh tự chọn một đoạn video thực tế có sẵn, khớp nội dung lời thoại, kèm hiệu ứng chuyển động nhẹ. Không tốn phí, render nhanh – hợp video tin tức, mẹo, review."
  },
  {
    value: "semi_ai",
    title: "Bán tự động (Ảnh AI + Parallax)",
    badge: "Gemini / Flux",
    desc: "Sinh ảnh độc quyền theo khung hình (ảnh Gemini – Nano Banana, dùng key Gemini; hoặc Fal Flux), phủ hiệu ứng zoom chuyển động. ~$0.003–0.04/cảnh."
  },
  {
    value: "full_ai",
    title: "Full AI Video (Google Veo 3.1)",
    badge: "Tính phí / giây",
    desc: "Mỗi cảnh là một clip video AI 4–8 giây do Veo tạo (dùng key Gemini). Veo Lite ~$0.05/giây – app báo chi phí và hỏi trước khi render."
  }
];

export function ConfigPanel({
  project,
  channels,
  ttsProviders,
  onChange,
  onGenerate,
  generating,
  lastGen
}) {
  const { data: voices = [], error: voicesError } = useApiQuery("media.voices", { provider: project.ttsProvider }, { staleTime: 10 * 6e4, retry: 0 });
  const { data: localTts } = useApiQuery("localtts.status");
  const topicLen = project.topic.length;
  const preview = useApiMutation("media.previewVoice");
  const audio = useRef(null);
  const [previewing, setPreviewing] = useState(false);
  const stopPreview = () => {
    audio.current?.pause();
    audio.current = null;
    setPreviewing(false);
  };
  useEffect(() => stopPreview, []);
  const togglePreview = () => {
    if (previewing) return stopPreview();
    preview.mutate(
      { provider: project.ttsProvider, voiceId: project.voiceId, workspaceId: project.workspaceId },
      {
        onSuccess: (path) => {
          stopPreview();
          const a = new Audio(mediaUrl(path));
          a.onended = stopPreview;
          audio.current = a;
          setPreviewing(true);
          a.play().catch(() => (stopPreview(), toast.error("Không phát được file nghe thử")));
        },
        onError: (e) => toast.error(`Không nghe thử được: ${e.message}`)
      }
    );
  };
  return <Card className="flex min-h-0 flex-col">
    <div className="flex items-center justify-between gap-space-sm border-b border-overlay/[0.06] p-space-md">
      <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-container text-label-md text-on-primary">
          1
        </span>
        {"Cấu hình & Kịch bản"}
      </h2>
      <Badge tone="secondary" mono={true}>BYOK</Badge>
    </div>
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-space-md overflow-y-auto p-space-md">
      <Field label="Kênh đích (target)" hint={"Watermark & brand voice lấy theo Pocket của kênh"}>
        {(id) => <Select id={id} value={project.targetChannelId ?? ""} onChange={(e) => onChange({ targetChannelId: e.target.value || null })}>
          <option value="">— Chưa chọn kênh —</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{platformMeta[c.platform].short}{" · "}{c.name}</option>)}
        </Select>}
      </Field>
      <Field label={"Chủ đề & ý tưởng chính"} hint={`${topicLen}/1000 ký tự`}>
        {(id) => <Textarea
          key={project.id}
          id={id}
          defaultValue={project.topic}
          maxLength={1e3}
          onBlur={(e) => e.target.value.trim() && e.target.value !== project.topic && onChange({ topic: e.target.value })}
          className="min-h-[96px] text-body-md"
        />}
      </Field>
      <Field label="Mẫu định dạng" hint={formatById(project.format).hint}>
        {(id) => <Select id={id} value={project.format ?? "free"} onChange={(e) => onChange({ format: e.target.value === "free" ? null : e.target.value })}>
          {[...CONTENT_FORMATS.filter((f) => f.kind === "video"), ...isCustomFormat(project.format) ? [formatById(project.format)] : []].map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </Select>}
      </Field>
      <div className="flex flex-col gap-1">
        <span className="text-label-md text-on-surface-variant">Ảnh tham chiếu (sản phẩm, nhân vật, logo)</span>
        <ProjectRefsField refs={project.referenceImages} hint={formatById(project.format).refsHint} onChange={(referenceImages) => onChange({ referenceImages })} />
      </div>
      {project.visualBible && <VisualBibleEditor key={project.id} projectId={project.id} bible={project.visualBible} refs={project.referenceImages} />}
      <div className="flex flex-col gap-1">
        <span className="text-label-md text-on-surface-variant">Thời lượng dự kiến</span>
        <div className="flex flex-col gap-1 rounded-lg bg-surface-container-lowest p-1" role="radiogroup" aria-label="Thời lượng">
          {[
            { label: "Clip ngắn", items: SHORT_DURATIONS },
            { label: "Phim / video dài", items: LONG_DURATIONS }
          ].map((g) => <div key={g.label} className="flex flex-col gap-0.5">
            <span className="px-1 text-[10px] uppercase tracking-wide text-outline">{g.label}</span>
            <div className="grid grid-cols-4 gap-1">
              {g.items.map((s) => <button
                key={s}
                type="button"
                role="radio"
                aria-checked={project.targetDurationSec === s}
                onClick={() => (
                  // Đổi giữa clip ngắn ↔ video dài: tự đổi khung mặc định (ngắn 9:16, dài 16:9) – vẫn chỉnh lại được
                  onChange({
                    targetDurationSec: s,
                    ...isLongForm(s) !== isLongForm(project.targetDurationSec) ? { aspect: isLongForm(s) ? "16:9" : "9:16" } : {}
                  })
                )}
                className={cn(
                  "h-8 rounded text-label-md",
                  project.targetDurationSec === s ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high"
                )}
              >
                {durationLabel(s)}
              </button>)}
            </div>
          </div>)}
        </div>
        {isLongForm(project.targetDurationSec) && <span className="text-label-sm text-outline">
          Video dài render theo từng cảnh rồi ghép: sửa một cảnh chỉ dựng lại cảnh đó, render lỗi giữa chừng thì lần sau chạy tiếp.
        </span>}
      </div>
      <div className="grid grid-cols-2 gap-space-sm">
        <Field label="Khung hình">
          {(id) => <Select id={id} value={project.aspect} onChange={(e) => onChange({ aspect: e.target.value })}>
            {Object.keys(ASPECT_LABEL).map((a) => <option key={a} value={a}>{ASPECT_LABEL[a]}</option>)}
          </Select>}
        </Field>
        <Field label="Chuyển cảnh">
          {(id) => <Select id={id} value={project.transition} onChange={(e) => onChange({ transition: e.target.value })}>
            {Object.keys(TRANSITION_LABEL).map((t) => <option key={t} value={t}>{TRANSITION_LABEL[t]}</option>)}
          </Select>}
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-label-md text-on-surface-variant">Lời thoại</span>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-container-lowest p-1" role="radiogroup" aria-label="Lời thoại">
          {[
            { on: true, label: "Có giọng đọc", hint: "Giọng AI đọc lời thoại + phụ đề" },
            { on: false, label: "Không lời thoại", hint: "Chỉ hình + tiếng clip + nhạc nền (teaser, video công nghệ, quảng cáo hình)" }
          ].map((o) => <button
            key={String(o.on)}
            type="button"
            role="radio"
            aria-checked={project.narration === o.on}
            title={o.hint}
            onClick={() => project.narration !== o.on && onChange({ narration: o.on })}
            className={cn("h-8 rounded text-label-md", project.narration === o.on ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high")}
          >
            {o.label}
          </button>)}
        </div>
        {!project.narration && <span className="text-label-sm text-outline">
          Không giọng đọc, không phụ đề; giữ tiếng của clip (Veo được dặn chỉ tạo tiếng môi trường, không ai nói) + nhạc nền. Sinh kịch bản lại để AI chia cảnh ngắn 3–5 giây kể bằng hình.
        </span>}
      </div>
      <div className={cn("grid grid-cols-2 gap-space-sm", !project.narration && "hidden")}>
        <Field label="Giọng đọc AI (TTS)">
          {(id) => <Select
            id={id}
            value={project.ttsProvider}
            onChange={(e) => (stopPreview(), onChange({
              ttsProvider: e.target.value,
              voiceId: e.target.value === "edge_tts" ? "vi-VN-HoaiMyNeural" : e.target.value === "openai_tts" ? "nova" : e.target.value === "google_tts" ? "Kore" : null
            }))}
          >
            {ttsProviders.map((p) => <option key={p.id} value={p.provider}>
              {p.label}
              {!p.hasKey && !providerInfo(p.provider).keyless ? " (thiếu key)" : p.provider === "local_tts" && !localTts?.installed ? " (chưa cài – xem Cài đặt)" : ""}
            </option>)}
          </Select>}
        </Field>
        <Field label="Giọng" error={voicesError ? `Không tải được danh sách giọng: ${voicesError.message}` : null}>
          {(id) => <div className="flex gap-1">
            <div className="min-w-0 flex-1">
              <Select id={id} value={project.voiceId ?? ""} onChange={(e) => (stopPreview(), onChange({ voiceId: e.target.value || null }))}>
                {project.voiceId && !voices.some((v) => v.id === project.voiceId) && <option value={project.voiceId}>{project.voiceId}{" (không hợp lệ)"}</option>}
                {!project.voiceId && <option value="">— Chọn giọng —</option>}
                {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </Select>
            </div>
            <Button
              className="w-8 px-0"
              aria-label={previewing ? "Dừng nghe thử" : "Nghe thử giọng"}
              title={previewing ? "Dừng nghe thử" : `Nghe thử giọng${providerInfo(project.ttsProvider).keyless ? "" : " (tính phí một lần cho câu mẫu ngắn – nghe lại không tính)"}`}
              disabled={preview.isPending}
              onClick={togglePreview}
            >
              {preview.isPending ? <LoaderCircle size={14} className="animate-spin" /> : previewing ? <Square size={12} /> : <Volume2 size={14} />}
            </Button>
          </div>}
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-label-md text-on-surface-variant">Chế độ sinh video (Render Mode)</span>
        <div className="flex flex-col gap-space-sm" role="radiogroup" aria-label="Chế độ render">
          {MODES.map((m) => {
            const active = project.renderMode === m.value;
            return <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ renderMode: m.value })}
              className={cn(
                "flex gap-space-sm rounded-xl border p-space-sm text-left transition-colors",
                active ? "border-primary-container bg-primary-container/10" : "border-overlay/[0.08] hover:bg-surface-container"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 rounded-full border-2",
                  active ? "border-primary-container bg-primary-container ring-2 ring-inset ring-surface" : "border-outline"
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-space-sm">
                  <span className="text-label-md text-on-surface">{m.title}</span>
                  <Badge tone={m.value === "full_ai" ? "warning" : "secondary"} mono={true}>{m.badge}</Badge>
                </span>
                <span className="mt-0.5 block text-body-sm text-on-surface-variant">{m.desc}</span>
              </span>
            </button>;
          })}
        </div>
      </div>
    </div>
    <div className="border-t border-overlay/[0.06] p-space-md">
      <Button
        variant="primary"
        className="h-11 w-full"
        disabled={generating}
        onClick={onGenerate}
        title={"Sinh kịch bản & phân cảnh bằng LLM theo chủ đề, thời lượng và brand voice của Pocket"}
      >
        {generating ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {" "}
        {generating ? "Đang viết kịch bản…" : "Sinh Kịch bản & Phân cảnh"}
        {" "}
        <Kbd className="bg-black/20 text-on-primary">Ctrl+Enter</Kbd>
      </Button>
      <p className="mt-1.5 flex items-center gap-1 text-label-sm text-outline">
        <Lightbulb size={12} />
        {" "}
        {lastGen ?? "Lưu ý: sẽ thay thế toàn bộ phân cảnh hiện có."}
      </p>
    </div>
  </Card>;
}
