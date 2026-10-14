import { useState, useEffect } from "react";
import { call, useApiMutation } from "../../lib/api";
import { Film, Image, Paperclip, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { kindMeta, VariantsPanel } from "./VariantsPanel";
import { HookPanel } from "./HookPanel";

const empty = (workspaceId) => ({ title: "", caption: "", hashtags: "", kind: "video", aspect: "9:16", workspaceId: workspaceId ?? "", status: "draft", mediaPaths: [], firstComment: "" });

const fromItem = (c) => ({
  title: c.title,
  caption: c.caption ?? "",
  hashtags: c.hashtags.join(" "),
  kind: c.kind,
  aspect: c.aspect ?? "",
  workspaceId: c.workspaceId ?? "",
  status: c.status === "draft" || c.status === "failed" ? c.status : "ready",
  mediaPaths: c.mediaPaths,
  firstComment: c.firstComment ?? ""
});

export function ContentEditor({
  open,
  item,
  workspaces,
  defaultWorkspaceId,
  onClose
}) {
  const [d, setD] = useState(empty(defaultWorkspaceId));
  const create = useApiMutation("content.create", ["content.", "workspaces."]);
  const update = useApiMutation("content.update", ["content.", "workspaces.", "posts."]);
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const lockedStatus = item?.status === "scheduled" || item?.status === "published";
  useEffect(() => {
    if (open) setD(item ? fromItem(item) : empty(defaultWorkspaceId));
  }, [open, item, defaultWorkspaceId]);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const submit = () => {
    if (!d.title.trim()) return;
    const payload = {
      title: d.title,
      caption: d.caption.trim() || null,
      hashtags: d.hashtags.split(/[\s,]+/).filter(Boolean).map((h) => h.startsWith("#") ? h : `#${h}`),
      kind: d.kind,
      aspect: d.aspect || null,
      workspaceId: d.workspaceId || null,
      mediaPaths: d.mediaPaths,
      firstComment: d.firstComment.trim() || null,
      ...lockedStatus || d.status === "failed" ? {} : { status: d.status }
    };
    if (item) update.mutate({ id: item.id, patch: payload }, { onSuccess: onClose });
    else create.mutate(payload, { onSuccess: onClose });
  };
  return <Dialog
    open={open}
    onClose={onClose}
    title={item ? "Chỉnh sửa nội dung" : "Thêm nội dung"}
    width={560}
    footer={<>
      <Button variant="subtle" onClick={onClose}>Hủy</Button>
      <Button variant="primary" disabled={!d.title.trim() || pending} onClick={submit}>
        {item ? "Lưu thay đổi" : "Thêm vào kho"}
      </Button>
    </>}
  >
    <form
      className="grid grid-cols-2 gap-space-md"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Tiêu đề" required={true} className="col-span-2">
        {(id) => <Input id={id} value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={300} />}
      </Field>
      <Field label="Định dạng">
        {(id) => <Select id={id} value={d.kind} onChange={(e) => set("kind", e.target.value)}>
          {Object.entries(kindMeta).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </Select>}
      </Field>
      <Field label="Tỷ lệ khung hình">
        {(id) => <Select id={id} value={d.aspect} onChange={(e) => set("aspect", e.target.value)}>
          <option value="">—</option>
          <option value="9:16">9:16 (Reels / TikTok)</option>
          <option value="4:5">4:5 (Feed)</option>
          <option value="1:1">1:1</option>
          <option value="16:9">16:9</option>
        </Select>}
      </Field>
      <div className="col-span-2 flex flex-col gap-space-xs">
        <div className="flex items-center justify-between">
          <span className="text-label-md text-on-surface-variant">File media ({d.mediaPaths.length}/10)</span>
          <Button
            size="sm"
            variant="subtle"
            disabled={d.mediaPaths.length >= 10}
            onClick={() => void call("system.pickMedia").then((files) => files.length && setD((x) => ({ ...x, mediaPaths: [...new Set([...x.mediaPaths, ...files])].slice(0, 10) }))).catch((e) => toast.error(e.message))}
          >
            <Paperclip size={13} />
            {" Chọn ảnh / video"}
          </Button>
        </div>
        {d.mediaPaths.length === 0 ? <p className="rounded-lg bg-surface-container-lowest p-space-sm text-label-sm text-outline">
          Chưa đính kèm file – bài chữ chỉ đăng được lên Fanpage.
        </p> : <ul className="flex flex-col gap-1">
          {d.mediaPaths.map((p) => <li key={p} className="flex items-center gap-space-sm rounded-lg bg-surface-container-lowest px-space-sm py-1 text-body-sm">
            {/\.(mp4|mov|m4v)$/i.test(p) ? <Film size={13} className="text-secondary" /> : <Image size={13} className="text-secondary" />}
            <span className="min-w-0 flex-1 truncate font-mono text-code text-on-surface" title={p}>
              {p.split(/[\\/]/).pop()}
            </span>
            <button type="button" aria-label="Bỏ file" onClick={() => setD((x) => ({ ...x, mediaPaths: x.mediaPaths.filter((m) => m !== p) }))} className="text-outline hover:text-error">
              <X size={13} />
            </button>
          </li>)}
        </ul>}
      </div>
      <Field label="Caption" className="col-span-2">
        {(id) => <Textarea id={id} value={d.caption} onChange={(e) => set("caption", e.target.value)} maxLength={5e3} />}
      </Field>
      <Field label="Bình luận đầu tiên (tùy chọn)" hint="Tự đăng ngay sau khi bài lên – hợp để gắn link mua hàng, hashtag (Facebook, Instagram)" className="col-span-2">
        {(id) => <Input id={id} value={d.firstComment} onChange={(e) => set("firstComment", e.target.value)} maxLength={2e3} placeholder="👉 Đặt hàng tại: https://…" />}
      </Field>
      <Field label="Hashtag" hint="Cách nhau bằng dấu cách" className="col-span-2">
        {(id) => <Input id={id} value={d.hashtags} onChange={(e) => set("hashtags", e.target.value)} placeholder="#congso #phoido" />}
      </Field>
      <Field label="Không gian làm việc">
        {(id) => <Select id={id} value={d.workspaceId} onChange={(e) => set("workspaceId", e.target.value)}>
          <option value="">— Chưa phân Pocket —</option>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>}
      </Field>
      <Field label="Trạng thái" hint={lockedStatus ? "Bài đã lên lịch/đăng – đổi ở Lịch đăng bài" : void 0}>
        {(id) => <Select id={id} value={d.status} disabled={lockedStatus} onChange={(e) => set("status", e.target.value)}>
          <option value="draft">Bản nháp</option>
          <option value="ready">Sẵn sàng đăng</option>
          {item?.status === "failed" && <option value="failed">Đăng lỗi (giữ nguyên)</option>}
        </Select>}
      </Field>
      {error && <p className="col-span-2 text-body-sm text-error">{error.message}</p>}
      <button type="submit" hidden={true} />
    </form>
    {item && <HookPanel
      item={item}
      onUseHook={(hook) => setD((x) => {
        const lines = x.caption.split("\n");
        const i = lines.findIndex((l) => l.trim());
        if (i < 0) return { ...x, caption: hook };
        lines[i] = hook;
        return { ...x, caption: lines.join("\n") };
      })}
    />}
    {item && <VariantsPanel item={item} currentCaption={d.caption} onApplied={(caption, hashtags) => setD((x) => ({ ...x, caption, hashtags: hashtags.join(" ") }))} />}
  </Dialog>;
}
