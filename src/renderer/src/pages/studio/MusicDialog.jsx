import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { LoaderCircle, Music } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { UNIT_PRICES } from "../../../../shared/pricing";

export function MusicDialog({
  open,
  onClose,
  providers,
  topic,
  durationSec,
  workspaceId,
  onCreated
}) {
  const [provider, setProvider] = useState("google_lyria");
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [instrumental, setInstrumental] = useState(true);
  const gen = useApiMutation("media.generateMusic", ["media.", "settings."]);
  useEffect(() => {
    if (!open) return;
    setProvider(providers[0]?.provider ?? "google_lyria");
    setPrompt(`Nhạc nền nhẹ nhàng, hiện đại, nhịp vừa phải cho video ngắn về: ${topic.slice(0, 120)}`);
    setSeconds(Math.min(180, Math.max(10, Math.ceil(durationSec))));
    setInstrumental(true);
    gen.reset();
  }, [open]);
  const row = providers.find((p) => p.provider === provider);
  const model = row?.defaultModel ?? "";
  const clipOnly = model === "lyria-3-clip-preview";
  const unit = UNIT_PRICES[model];
  const cost = unit ? unit.per === "minute" ? unit.usd * (seconds / 60) : unit.usd : null;
  const submit = () => gen.mutate(
    { provider, prompt, durationSec: clipOnly ? 30 : seconds, instrumental, workspaceId },
    {
      onSuccess: (r) => {
        toast.success(`Đã tạo nhạc nền "${r.file}" · ≈ $${r.costUsd.toFixed(3)}`);
        onCreated(r.file);
        onClose();
      }
    }
  );
  return <Dialog
    open={open}
    onClose={() => !gen.isPending && onClose()}
    title="Sinh nhạc nền AI"
    description="Nhạc có quyền dùng thương mại theo điều khoản nhà cung cấp; được lưu vào thư viện nhạc nền."
    width={520}
    footer={<>
      <Button variant="subtle" onClick={onClose} disabled={gen.isPending}>Hủy</Button>
      <Button variant="primary" disabled={!prompt.trim() || gen.isPending || !row} onClick={submit}>
        {gen.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Music size={14} />}
        {" "}
        {gen.isPending ? "Đang sáng tác…" : `Tạo nhạc${cost != null ? ` (≈ $${cost.toFixed(3)})` : ""}`}
      </Button>
    </>}
  >
    <div className="grid grid-cols-2 gap-space-md">
      <Field label="Nhà cung cấp">
        {(id) => <Select id={id} value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => <option key={p.id} value={p.provider}>{p.label}{" · "}{p.defaultModel}</option>)}
        </Select>}
      </Field>
      <Field label="Độ dài (giây)" hint={clipOnly ? "Lyria 3 Clip luôn tạo 30 giây" : "10–180 giây"}>
        {(id) => <Input id={id} type="number" min={10} max={180} value={clipOnly ? 30 : seconds} disabled={clipOnly} onChange={(e) => setSeconds(Number(e.target.value) || 30)} />}
      </Field>
      <Field label="Mô tả bản nhạc" className="col-span-2" hint="Thể loại, tâm trạng, nhạc cụ, nhịp độ. Không được yêu cầu nhái giọng ca sĩ hay lời bài hát có bản quyền.">
        {(id) => <Textarea id={id} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} className="min-h-[90px]" />}
      </Field>
      <label className="col-span-2 flex items-center gap-space-sm text-body-sm text-on-surface">
        <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} className="h-4 w-4 accent-primary-container" />
        Chỉ nhạc không lời (khuyên dùng – không lấn giọng đọc)
      </label>
      {gen.isPending && <p className="col-span-2 text-body-sm text-on-surface-variant">Thường mất 20–90 giây…</p>}
      {gen.error && <p className="col-span-2 text-body-sm text-error">{gen.error.message}</p>}
    </div>
  </Dialog>;
}
