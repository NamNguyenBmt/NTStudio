import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Textarea } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { ASPECT_LABEL, durationLabel } from "../../../../shared/video";
import { FORMAT_GROUPS, CONTENT_FORMATS, formatById } from "../../../../shared/content-formats";
import { ProjectRefsField } from "./refs";

const MODE_LABEL = { stock: "Video stock", semi_ai: "Ảnh AI + chuyển động", full_ai: "Video AI (Veo)" };

export function NewProjectDialog({
  open,
  workspaceId,
  onClose,
  onCreated
}) {
  const create = useApiMutation("studio.create", ["studio."]);
  const [format, setFormat] = useState("free");
  const [topic, setTopic] = useState("");
  const [refs, setRefs] = useState([]);
  useEffect(() => {
    if (!open) return;
    setFormat("free");
    setTopic("");
    setRefs([]);
  }, [open]);
  const f = formatById(format);
  const d = { targetDurationSec: 30, aspect: "9:16", renderMode: "stock", ...f.defaults };
  const submit = () => {
    if (!topic.trim()) return;
    create.mutate(
      {
        topic,
        workspaceId,
        format: format === "free" ? null : format,
        targetDurationSec: d.targetDurationSec,
        aspect: d.aspect,
        renderMode: d.renderMode,
        referenceImages: refs,
        ttsProvider: "edge_tts",
        voiceId: "vi-VN-HoaiMyNeural"
      },
      { onSuccess: (p) => onCreated(p.id) }
    );
  };
  return <Dialog
    open={open}
    onClose={onClose}
    width={760}
    title="Dự án video mới"
    description="Chọn mẫu – AI viết kịch bản đúng khuôn của thể loại. Thời lượng, khung hình, nguồn hình đổi lại được sau."
    footer={<>
      <Button variant="subtle" onClick={onClose}>Hủy</Button>
      <Button variant="primary" disabled={!topic.trim() || create.isPending} onClick={submit}>Tạo dự án</Button>
    </>}
  >
    <div className="flex flex-col gap-space-md">
      <div className="scroll-thin flex max-h-[300px] flex-col gap-space-sm overflow-y-auto pr-1">
        {FORMAT_GROUPS.map((g) => {
          const items = CONTENT_FORMATS.filter((x) => x.kind === "video" && x.group === g.id);
          if (!items.length) return null;
          return <div key={g.id} className="flex flex-col gap-space-xs">
            <span className="text-label-sm uppercase tracking-wider text-outline">{g.label}</span>
            <div className="grid grid-cols-3 gap-space-xs">
              {items.map((x) => <button
                key={x.id}
                type="button"
                onClick={() => setFormat(x.id)}
                className={cn(
                  "flex flex-col gap-0.5 rounded-lg border p-space-sm text-left transition-colors",
                  format === x.id ? "border-primary bg-primary/10" : "border-outline-variant/40 hover:bg-surface-container-high"
                )}
              >
                <span className="text-label-md text-on-surface">{x.label}</span>
                <span className="line-clamp-2 text-label-sm text-on-surface-variant">{x.hint}</span>
              </button>)}
            </div>
          </div>;
        })}
      </div>
      <div className="flex flex-wrap items-center gap-space-xs">
        <span className="text-label-sm text-outline">Mẫu "{f.label}":</span>
        <Badge mono={true}>{durationLabel(d.targetDurationSec)}</Badge>
        <Badge mono={true}>{ASPECT_LABEL[d.aspect]}</Badge>
        <Badge mono={true}>{MODE_LABEL[d.renderMode]}</Badge>
      </div>
      <Field
        label={"Chủ đề & thông tin chính"}
        required={true}
        hint={f.id === "product_review" || f.id === "comparison" ? "Ghi tên sản phẩm, điểm nổi bật, điểm cần lưu ý thật – AI chỉ dùng thông tin bạn cung cấp" : void 0}
      >
        {(id) => <Textarea
          id={id}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && submit()}
          maxLength={1e3}
          placeholder={f.topicPlaceholder ?? "Ý tưởng chính của video…"}
          className="min-h-[80px]"
        />}
      </Field>
      <div className="flex flex-col gap-1">
        <span className="text-label-md text-on-surface-variant">
          {"Ảnh tham chiếu "}
          {f.refsHint ? "" : "(tùy chọn)"}
        </span>
        <ProjectRefsField refs={refs} hint={f.refsHint} onChange={setRefs} />
      </div>
      {create.error && <p className="text-body-sm text-error">{create.error.message}</p>}
    </div>
  </Dialog>;
}
