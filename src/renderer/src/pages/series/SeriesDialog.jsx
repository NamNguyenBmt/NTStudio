import { useState, useEffect } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { useUiStore } from "../../stores/ui";
import { platformMeta } from "../calendar/ScheduleDialog";
import { DEFAULT_DIALOGUE_LANGUAGE } from "../../../../shared/film";
import { StyleFields } from "../../components/film/StyleFields";
import { EPISODE_LENGTHS, INV, EMPTY_SERIES_FORM } from "./meta";
import { ProductionModePicker } from "./ProductionMode";

export function SeriesDialog({ open, initial, onClose, onSaved }) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: channels = [] } = useApiQuery("channels.list", {});
  const create = useApiMutation("series.create", INV);
  const update = useApiMutation("series.update", INV);
  const [f, setF] = useState(EMPTY_SERIES_FORM);
  useEffect(() => {
    if (!open) return;
    setF(
      initial
        ? {
            productionMode: initial.productionMode,
            title: initial.title,
            genre: initial.genre ?? "",
            logline: initial.logline ?? "",
            visualStyle: initial.visualStyle ?? "",
            episodeLengthSec: EPISODE_LENGTHS.includes(initial.episodeLengthSec) ? initial.episodeLengthSec : 60,
            renderMode: initial.renderMode,
            targetChannelId: initial.targetChannelId ?? "",
            dialogueLanguage: initial.dialogueLanguage || DEFAULT_DIALOGUE_LANGUAGE,
            notes: initial.notes ?? "",
          }
        : EMPTY_SERIES_FORM,
    );
  }, [open, initial]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const err = create.error ?? update.error;
  const submit = () => {
    if (!f.title.trim()) return;
    const payload = {
      productionMode: f.productionMode,
      title: f.title,
      genre: f.genre || null,
      logline: f.logline || null,
      visualStyle: f.visualStyle || null,
      episodeLengthSec: f.episodeLengthSec,
      renderMode: f.renderMode,
      targetChannelId: f.targetChannelId || null,
      dialogueLanguage: f.dialogueLanguage,
      notes: f.notes.trim() || null,
    };
    if (initial) update.mutate({ id: initial.id, patch: payload }, { onSuccess: (r) => (onSaved(r.id), onClose()) });
    else create.mutate({ ...payload, workspaceId }, { onSuccess: (r) => (onSaved(r.id), onClose()) });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={f.productionMode === "film" ? 640 : 560}
      title={initial ? "Sửa series" : "Tạo series phim ngắn"}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={!f.title.trim() || create.isPending || update.isPending} onClick={submit}>
            {initial ? "Lưu" : "Tạo series"}
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-2 gap-space-md"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ProductionModePicker
          value={f.productionMode}
          locked={!!initial?.productionLocked}
          onChange={(m) => set("productionMode", m)}
        />
        <Field label="Tên series" required={true} className="col-span-2">
          {(id) => (
            <Input
              id={id}
              value={f.title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={120}
              placeholder="Cô nàng thực tập sinh và sếp khó tính"
            />
          )}
        </Field>
        {f.productionMode === "video" && (
          <Field label="Thể loại">
            {(id) => (
              <Input
                id={id}
                value={f.genre}
                onChange={(e) => set("genre", e.target.value)}
                placeholder="Hài công sở, tình cảm, giả tưởng…"
              />
            )}
          </Field>
        )}
        <Field label="Độ dài mỗi tập">
          {(id) => (
            <Select
              id={id}
              value={f.episodeLengthSec}
              onChange={(e) => set("episodeLengthSec", Number(e.target.value))}
            >
              <optgroup label="Phim ngắn">
                <option value={30}>30 giây</option>
                <option value={60}>60 giây</option>
                <option value={90}>90 giây</option>
              </optgroup>
              <optgroup label="Tập dài (viết theo hồi, khung 16:9)">
                <option value={180}>3 phút</option>
                <option value={300}>5 phút</option>
                <option value={600}>10 phút</option>
                <option value={900}>15 phút</option>
              </optgroup>
            </Select>
          )}
        </Field>
        <Field label="Ý tưởng / tóm tắt" className="col-span-2">
          {(id) => (
            <Textarea
              id={id}
              value={f.logline}
              onChange={(e) => set("logline", e.target.value)}
              maxLength={600}
              placeholder="Một câu mô tả mạch truyện chính của series"
            />
          )}
        </Field>
        {f.productionMode === "film" ? ( // Series kiểu Phim: lựa chọn sẵn / tự nhập – áp chung cho mọi tập (mỗi tập ở Xưởng Phim vẫn chỉnh được)
          <div className="col-span-2">
            <StyleFields
              value={{
                genre: f.genre || null,
                visualStyle: f.visualStyle || null,
                dialogueLanguage: f.dialogueLanguage,
                notes: f.notes || null,
              }}
              onChange={(p) =>
                setF((x) => ({
                  ...x,
                  ...(p.genre !== void 0 ? { genre: p.genre ?? "" } : {}),
                  ...(p.visualStyle !== void 0 ? { visualStyle: p.visualStyle ?? "" } : {}),
                  ...(p.dialogueLanguage !== void 0 ? { dialogueLanguage: p.dialogueLanguage } : {}),
                  ...(p.notes !== void 0 ? { notes: p.notes ?? "" } : {}),
                }))
              }
            />
          </div>
        ) : (
          <Field
            label="Phong cách hình ảnh"
            className="col-span-2"
            hint="Áp cho mọi cảnh để series đồng nhất. Viết tiếng Việt được – AI tự chuyển sang từ khóa tiếng Anh khi tạo hình. VD: hoạt hình 3D kiểu Pixar, ánh sáng ấm điện ảnh"
          >
            {(id) => (
              <Input
                id={id}
                value={f.visualStyle}
                onChange={(e) => set("visualStyle", e.target.value)}
                maxLength={400}
              />
            )}
          </Field>
        )}
        {f.productionMode === "video" ? (
          <Field label="Chế độ hình ảnh">
            {(id) => (
              <Select id={id} value={f.renderMode} onChange={(e) => set("renderMode", e.target.value)}>
                <option value="semi_ai">Ảnh AI + chuyển động (khuyên dùng)</option>
                <option value="full_ai">Video AI (Veo – tốn phí)</option>
                <option value="stock">Video stock</option>
              </Select>
            )}
          </Field>
        ) : (
          <p className="self-end text-label-sm text-on-surface-variant">
            Hình ảnh, video, âm thanh chọn trong Xưởng Phim cho từng tập.
          </p>
        )}
        <Field label="Kênh đăng">
          {(id) => (
            <Select id={id} value={f.targetChannelId} onChange={(e) => set("targetChannelId", e.target.value)}>
              <option value="">— Chọn sau —</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {platformMeta[c.platform].short}
                  {" · "}
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {err && <p className="col-span-2 text-body-sm text-error">{err.message}</p>}
        <button type="submit" hidden={true} />
      </form>
    </Dialog>
  );
}
