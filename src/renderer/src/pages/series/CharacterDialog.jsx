import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { LoaderCircle, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { CharacterVoiceFields } from "./CharacterVoiceFields";
import "./SeriesDialog";
import { INV } from "./meta";

export function CharacterDialog({
  seriesId,
  target,
  voices,
  film,
  workspaceId,
  onClose
}) {
  const save = useApiMutation("series.saveCharacter", INV);
  const genPrompt = useApiMutation("series.characterPrompt", INV);
  const c = target && target !== "new" ? target : null;
  const [f, setF] = useState({ name: "", role: "", appearance: "", personality: "", arc: "", voiceId: "", voiceProvider: "", voiceProfile: "" });
  const [prompt, setPrompt] = useState("");
  const [manual, setManual] = useState(false);
  const [savedId, setSavedId] = useState(null);
  useEffect(() => {
    if (!target) return;
    setF({
      name: c?.name ?? "",
      role: c?.role ?? "",
      appearance: c?.appearance ?? "",
      personality: c?.personality ?? "",
      arc: c?.arc ?? "",
      voiceId: c?.voiceId ?? "",
      voiceProvider: c?.voiceProvider ?? "",
      voiceProfile: c?.voiceProfile ?? ""
    });
    setPrompt(c?.imagePrompt ?? "");
    setManual(c?.promptManual ?? false);
    setSavedId(c?.id ?? null);
  }, [target]);
  const descChanged = !!c && (f.name !== c.name || f.role !== (c.role ?? "") || f.appearance !== c.appearance || f.personality !== (c.personality ?? ""));
  const payload = () => ({
    id: savedId ?? void 0,
    seriesId,
    name: f.name,
    role: f.role || null,
    appearance: f.appearance,
    personality: f.personality || null,
    arc: f.arc || null,
    voiceId: f.voiceId || null,
    ...film ? { voiceProvider: f.voiceProvider || null, voiceProfile: f.voiceProfile.trim() || null } : {},
    promptManual: manual && !!prompt.trim(),
    imagePrompt: manual && prompt.trim() ? prompt : null
  });
  const submit = () => {
    if (!f.name.trim()) return;
    save.mutate(payload(), { onSuccess: onClose });
  };
  const generate = () => {
    if (!f.name.trim()) return;
    save.mutate(
      { ...payload(), promptManual: false, imagePrompt: null },
      {
        onSuccess: (row) => {
          setSavedId(row.id);
          genPrompt.mutate(
            { id: row.id, force: true },
            {
              onSuccess: (r) => {
                setPrompt(r.imagePrompt ?? "");
                setManual(false);
                toast.success("Đã tạo prompt ảnh chuẩn từ mô tả tiếng Việt");
              },
              onError: (e) => toast.error(e.message)
            }
          );
        }
      }
    );
  };
  return <Dialog
    open={target != null}
    onClose={onClose}
    width={620}
    title={c ? `Sửa nhân vật ${c.name}` : "Thêm nhân vật"}
    footer={<>
      <Button variant="subtle" onClick={onClose}>Hủy</Button>
      <Button variant="primary" disabled={!f.name.trim() || save.isPending} onClick={submit}>Lưu</Button>
    </>}
  >
    <div className="grid grid-cols-2 gap-space-md">
      <Field label="Tên" required={true}>
        {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} />}
      </Field>
      <Field label="Vai trò">
        {(id) => <Input id={id} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} maxLength={80} placeholder="Nhân vật chính" />}
      </Field>
      <Field
        label="Ngoại hình cố định"
        className="col-span-2"
        hint="Viết tiếng Việt: tuổi, giới tính, tóc, trang phục đặc trưng, đặc điểm nhận dạng – AI chuyển thành prompt tiếng Anh khi tạo ảnh / viết cảnh"
      >
        {(id) => <Textarea id={id} value={f.appearance} onChange={(e) => setF({ ...f, appearance: e.target.value })} maxLength={600} />}
      </Field>
      <Field label="Tính cách" className="col-span-2">
        {(id) => <Input id={id} value={f.personality} onChange={(e) => setF({ ...f, personality: e.target.value })} maxLength={400} />}
      </Field>
      <Field label="Tuyến phát triển qua các tập" className="col-span-2" hint="Tâm lý, mối quan hệ, bước ngoặt – ngoại hình giữ nguyên. AI dùng khi viết kịch bản từng tập.">
        {(id) => <Textarea id={id} value={f.arc} onChange={(e) => setF({ ...f, arc: e.target.value })} maxLength={600} className="min-h-[56px]" />}
      </Field>
      {film ? <div className="col-span-2">
        <CharacterVoiceFields
          value={{ voiceProfile: f.voiceProfile || null, voiceProvider: f.voiceProvider || null, voiceId: f.voiceId || null }}
          workspaceId={workspaceId}
          onChange={(p) => setF((x) => ({
            ...x,
            ...p.voiceProfile !== void 0 ? { voiceProfile: p.voiceProfile ?? "" } : {},
            ...p.voiceProvider !== void 0 ? { voiceProvider: p.voiceProvider ?? "" } : {},
            ...p.voiceId !== void 0 ? { voiceId: p.voiceId ?? "" } : {}
          }))}
        />
      </div> : <Field label="Giọng đọc" className="col-span-2">
        {(id) => <Select id={id} value={f.voiceId} onChange={(e) => setF({ ...f, voiceId: e.target.value })}>
          <option value="">— Giọng người dẫn —</option>
          {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </Select>}
      </Field>}
      <div className="col-span-2 flex flex-col gap-space-xs rounded-xl bg-surface-container-lowest p-space-sm">
        <div className="flex items-center justify-between gap-space-sm">
          <span className="text-label-md text-on-surface">Prompt ảnh chuẩn (tiếng Anh)</span>
          <Button
            size="sm"
            variant="subtle"
            disabled={!f.name.trim() || save.isPending || genPrompt.isPending}
            onClick={generate}
            title="Lưu mô tả rồi để AI viết lại prompt tiếng Anh từ mô tả tiếng Việt"
          >
            {genPrompt.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {" "}
            {prompt ? "Viết lại từ tiếng Việt" : "Tạo prompt bằng AI"}
          </Button>
        </div>
        <Textarea
          aria-label="Prompt ảnh chuẩn (tiếng Anh)"
          value={prompt}
          readOnly={!manual}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={1500}
          placeholder="Chưa có – AI tự viết từ mô tả tiếng Việt khi bấm Ảnh AI / Chép prompt (hoặc bấm Tạo prompt bằng AI)"
          className={cn("min-h-[96px] font-mono text-code", !manual && "cursor-default text-on-surface-variant")}
        />
        <label className="flex items-center gap-space-sm text-label-md text-on-surface-variant">
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="h-4 w-4 accent-primary-container" />
          Sửa prompt tiếng Anh (nâng cao)
        </label>
        <span className={cn("text-label-sm", descChanged && !manual ? "text-warning" : "text-outline")}>
          {manual ? "Đang dùng nguyên văn prompt bạn sửa – sửa mô tả tiếng Việt sẽ không đổi prompt này. Bỏ chọn để AI viết lại từ tiếng Việt." : descChanged ? "Mô tả tiếng Việt đã đổi – khi Lưu, AI sẽ viết lại prompt theo mô tả mới lúc tạo ảnh / chép prompt." : "AI viết từ mô tả tiếng Việt – chỉ để xem. Dùng cho Ảnh AI, Chép prompt và ghép vào prompt hình từng cảnh."}
        </span>
      </div>
      {save.error && <p className="col-span-2 text-body-sm text-error">{save.error.message}</p>}
    </div>
  </Dialog>;
}
