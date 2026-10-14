import { useState, useEffect } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { Trash } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { confirmDialog } from "../../components/ui/confirm";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { platformMeta } from "../calendar/ScheduleDialog";

const INVALIDATES = ["inbox.", "dashboard."];

const ACTIONS = [
  {
    value: "reply_comment",
    label: "Trả lời bình luận công khai",
    hint: "Bot trả lời ngay dưới bình luận khớp từ khóa (Facebook, Instagram).",
  },
  {
    value: "send_dm",
    label: "Nhắn tin riêng",
    hint: "Bình luận khớp → nhắn riêng cho người bình luận (mỗi bình luận 1 lần, trong 7 ngày). Tin nhắn khớp → trả lời trong hộp thư (trong 24 giờ).",
  },
  {
    value: "hide_comment",
    label: "Ẩn bình luận",
    hint: "Ẩn bình luận khớp (vd chứa số điện thoại) – người bình luận và bạn bè họ vẫn thấy, người khác thì không.",
  },
];

export function RuleDialog({ target, workspaceId, onClose }) {
  const { data: channels = [] } = useApiQuery("channels.list", {});
  const save = useApiMutation("inbox.saveRule", INVALIDATES);
  const remove = useApiMutation("inbox.deleteRule", INVALIDATES);
  const [name, setName] = useState("");
  const [action, setAction] = useState("reply_comment");
  const [keywords, setKeywords] = useState("");
  const [phone, setPhone] = useState(false);
  const [template, setTemplate] = useState("");
  const [channelId, setChannelId] = useState("");
  const [minDelay, setMinDelay] = useState(15);
  const [maxDelay, setMaxDelay] = useState(35);
  useEffect(() => {
    if (!target) return;
    const r = target.mode === "edit" ? target.rule : null;
    setName(r?.name ?? "");
    setAction(r?.action ?? (target.mode === "new" ? target.action : "reply_comment"));
    setKeywords((r?.keywords ?? []).filter((k) => k !== "{phone}").join(", "));
    setPhone(r ? r.keywords.includes("{phone}") : target.mode === "new" && target.action === "hide_comment");
    setTemplate(r?.template ?? "");
    setChannelId(r?.channelId ?? "");
    setMinDelay(r?.minDelaySec ?? 15);
    setMaxDelay(r?.maxDelaySec ?? 35);
    save.reset();
  }, [target]);
  const list = [
    ...new Set(
      keywords
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
    ...(phone ? ["{phone}"] : []),
  ];
  const hide = action === "hide_comment";
  const scoped = channels.filter((c) => c.platform !== "tiktok" && (!workspaceId || c.workspaceId === workspaceId));
  const valid = name.trim() && list.length > 0 && (hide || template.trim()) && maxDelay >= minDelay;
  const submit = () => {
    if (!target || !valid) return;
    save.mutate(
      {
        ...(target.mode === "edit" ? { id: target.rule.id, enabled: target.rule.enabled } : {}),
        workspaceId: target.mode === "edit" ? target.rule.workspaceId : workspaceId,
        channelId: channelId || null,
        name,
        action,
        keywords: list,
        template: hide ? null : template,
        minDelaySec: minDelay,
        maxDelaySec: maxDelay,
      },
      {
        onSuccess: () => (
          toast.success(
            target.mode === "edit" ? "Đã lưu luật" : "Đã tạo luật – áp dụng cho tin mới từ lần đồng bộ tới",
          ),
          onClose()
        ),
      },
    );
  };
  return (
    <Dialog
      open={target != null}
      onClose={onClose}
      width={540}
      title={target?.mode === "edit" ? "Sửa luật tự động" : "Thêm luật tự động"}
      footer={
        <>
          {target?.mode === "edit" && (
            <Button
              variant="danger"
              className="mr-auto"
              disabled={remove.isPending}
              onClick={() =>
                void confirmDialog({
                  title: "Xóa luật",
                  message: `Xóa luật "${target.rule.name}"?`,
                  confirmLabel: "Xóa",
                  danger: true,
                }).then(
                  (ok) =>
                    ok &&
                    remove.mutate({ id: target.rule.id }, { onSuccess: () => (toast.info("Đã xóa luật"), onClose()) }),
                )
              }
            >
              <Trash size={14} />
              {" Xóa"}
            </Button>
          )}
          <Button variant="subtle" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={!valid || save.isPending} onClick={submit}>
            {target?.mode === "edit" ? "Lưu luật" : "Tạo luật"}
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
        <Field label="Tên luật" required={true} className="col-span-2">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Hỏi giá sản phẩm"
            />
          )}
        </Field>
        <Field label="Hành động" className="col-span-2" hint={ACTIONS.find((a) => a.value === action)?.hint}>
          {(id) => (
            <Select id={id} value={action} onChange={(e) => setAction(e.target.value)}>
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Từ khóa"
          className="col-span-2"
          hint="Cách nhau bằng dấu phẩy. Không phân biệt hoa thường và dấu: “gia” khớp “Giá”."
        >
          {(id) => (
            <Input
              id={id}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="giá, bao nhiêu, ib, size"
            />
          )}
        </Field>
        <label className="col-span-2 flex items-center gap-space-sm text-body-sm text-on-surface">
          <input
            type="checkbox"
            checked={phone}
            onChange={(e) => setPhone(e.target.checked)}
            className="h-4 w-4 accent-primary-container"
          />
          Khớp cả bình luận / tin chứa số điện thoại
        </label>
        {!hide && (
          <Field
            label="Nội dung trả lời"
            required={true}
            className="col-span-2"
            hint={"{name} = tên khách. Nên viết tự nhiên, tránh nội dung giống hệt nhau gây bị đánh dấu spam."}
          >
            {(id) => (
              <Textarea
                id={id}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                maxLength={1e3}
                placeholder={"Chào {name}, shop đã inbox giá chi tiết cho bạn rồi nhé!"}
              />
            )}
          </Field>
        )}
        <Field label="Áp dụng cho" className="col-span-2">
          {(id) => (
            <Select id={id} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">{workspaceId ? "Mọi kênh trong Pocket hiện tại" : "Mọi kênh"}</option>
              {scoped.map((c) => (
                <option key={c.id} value={c.id}>
                  {platformMeta[c.platform].short}
                  {" · "}
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!hide && (
          <>
            <Field label="Độ trễ tối thiểu (giây)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={600}
                  value={minDelay}
                  onChange={(e) => setMinDelay(Number(e.target.value) || 0)}
                />
              )}
            </Field>
            <Field label="Độ trễ tối đa (giây)" error={maxDelay < minDelay ? "Phải ≥ tối thiểu" : null}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={600}
                  value={maxDelay}
                  onChange={(e) => setMaxDelay(Number(e.target.value) || 0)}
                />
              )}
            </Field>
          </>
        )}
        <p className="col-span-2 text-label-sm text-outline">
          Luật chạy cho tin đến mới (trong 30 phút) sau mỗi lần đồng bộ; mỗi luật trả lời tối đa 1 lần / hội thoại /
          giờ. TikTok không có API nên không áp dụng.
        </p>
        {save.error && <p className="col-span-2 text-body-sm text-error">{save.error.message}</p>}
        <button type="submit" hidden={true} />
      </form>
    </Dialog>
  );
}
