import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { Switch } from "../../components/ui/Switch";

const blankAccount = {
  platform: "facebook",
  displayName: "",
  handle: "",
  externalId: "",
  workspaceId: "",
  twoFactorEnabled: false
};

export function AddAccountDialog({
  open,
  onClose,
  workspaces,
  defaultWorkspaceId,
  onCreated
}) {
  const [form, setForm] = useState(blankAccount);
  const create = useApiMutation("accounts.create", ["accounts.", "workspaces.", "dashboard.", "channels."]);
  useEffect(() => {
    if (open) {
      setForm({ ...blankAccount, workspaceId: defaultWorkspaceId ?? "" });
      create.reset();
    }
  }, [open, defaultWorkspaceId]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isFb = form.platform === "facebook";
  const canSubmit = form.displayName.trim() !== "" && (isFb || form.handle.trim() !== "");
  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        platform: form.platform,
        displayName: form.displayName,
        handle: isFb ? null : form.handle.replace(/^@/, ""),
        externalId: form.externalId || null,
        workspaceId: form.workspaceId || null,
        twoFactorEnabled: form.twoFactorEnabled
      },
      {
        onSuccess: (acc) => {
          onCreated(acc.id);
          onClose();
        }
      }
    );
  };
  return <Dialog
    open={open}
    onClose={onClose}
    title="Thêm tài khoản"
    description="Facebook: thêm VIA mẹ rồi gắn Fanpage. TikTok/Instagram: tài khoản chính là kênh đăng."
    footer={<>
      <Button variant="subtle" onClick={onClose}>Hủy</Button>
      <Button variant="primary" disabled={!canSubmit || create.isPending} onClick={submit}>Thêm tài khoản</Button>
    </>}
  >
    <form
      className="grid grid-cols-2 gap-space-md"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Nền tảng" required={true}>
        {(id) => <Select id={id} value={form.platform} onChange={(e) => set("platform", e.target.value)}>
          <option value="facebook">Facebook (VIA)</option>
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
        </Select>}
      </Field>
      <Field label="Không gian làm việc">
        {(id) => <Select id={id} value={form.workspaceId} onChange={(e) => setForm((f) => ({ ...f, workspaceId: e.target.value }))}>
          <option value="">— Chưa phân Pocket —</option>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>}
      </Field>
      <Field label={isFb ? "Tên gợi nhớ VIA" : "Tên hiển thị kênh"} required={true} className="col-span-2">
        {(id) => <Input
          id={id}
          value={form.displayName}
          onChange={(e) => set("displayName", e.target.value)}
          placeholder={isFb ? "NguyenVanA (VIA Cổ 2015)" : "Thời Trang Eva Official"}
        />}
      </Field>
      {!isFb && <Field label="Handle" required={true}>
        {(id) => <Input id={id} value={form.handle} onChange={(e) => set("handle", e.target.value)} placeholder="@thoitrangeva" />}
      </Field>}
      <Field label={isFb ? "UID Facebook" : "ID tài khoản"} className={isFb ? "col-span-2" : void 0}>
        {(id) => <Input id={id} value={form.externalId} onChange={(e) => set("externalId", e.target.value)} placeholder={isFb ? "1000849201" : "tùy chọn"} />}
      </Field>
      <label className="col-span-2 flex items-center gap-space-sm text-body-sm text-on-surface-variant">
        <Switch checked={form.twoFactorEnabled} onChange={(v) => set("twoFactorEnabled", v)} label="Đã bật 2FA" />
        {" Tài khoản đã bật xác thực 2 lớp"}
      </label>
      {create.error && <p className="col-span-2 text-body-sm text-error">{create.error.message}</p>}
      <button type="submit" hidden={true} />
    </form>
  </Dialog>;
}
