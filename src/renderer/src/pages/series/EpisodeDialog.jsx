import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Textarea } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { INV } from "./meta";

export function EpisodeDialog({ seriesId, target, onClose }) {
  const save = useApiMutation("series.saveEpisode", INV);
  const e0 = target && target !== "new" ? target : null;
  const [f, setF] = useState({ title: "", synopsis: "", cliffhanger: "" });
  useEffect(() => {
    if (target) setF({ title: e0?.title ?? "", synopsis: e0?.synopsis ?? "", cliffhanger: e0?.cliffhanger ?? "" });
  }, [target]);
  return <Dialog
    open={target != null}
    onClose={onClose}
    width={520}
    title={e0 ? `Sửa tập ${e0.number}` : "Thêm tập"}
    footer={<>
      <Button variant="subtle" onClick={onClose}>Hủy</Button>
      <Button
        variant="primary"
        disabled={!f.title.trim() || save.isPending}
        onClick={() => save.mutate({ id: e0?.id, seriesId, title: f.title, synopsis: f.synopsis, cliffhanger: f.cliffhanger || null }, { onSuccess: onClose })}
      >
        Lưu
      </Button>
    </>}
  >
    <div className="flex flex-col gap-space-md">
      <Field label="Tên tập" required={true}>
        {(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} />}
      </Field>
      <Field label="Dàn ý">
        {(id) => <Textarea id={id} value={f.synopsis} onChange={(e) => setF({ ...f, synopsis: e.target.value })} maxLength={1500} className="min-h-[100px]" />}
      </Field>
      <Field label="Kết treo (dẫn sang tập sau)">
        {(id) => <Input id={id} value={f.cliffhanger} onChange={(e) => setF({ ...f, cliffhanger: e.target.value })} maxLength={400} />}
      </Field>
      {save.error && <p className="text-body-sm text-error">{save.error.message}</p>}
    </div>
  </Dialog>;
}
