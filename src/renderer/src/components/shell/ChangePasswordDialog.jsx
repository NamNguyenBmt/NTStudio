import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Field } from "../ui/Field";
import "../ui/Switch";
import "./CommandPalette";
import { toast } from "../ui/toast";
import "./StatusBar";
import "./ThemeToggle";

export function ChangePasswordDialog({ open, onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const change = useApiMutation("auth.changePassword");
  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    change.reset();
  }, [open]);
  const valid = current && next.length >= 8 && next === confirm;
  const submit = () => {
    if (valid) change.mutate({ currentPassword: current, newPassword: next }, { onSuccess: () => (toast.success("Đã đổi mật khẩu"), onClose()) });
  };
  return <Dialog
    open={open}
    onClose={onClose}
    width={420}
    title="Đổi mật khẩu"
    footer={<>
      <Button variant="subtle" onClick={onClose}>Hủy</Button>
      <Button variant="primary" disabled={!valid || change.isPending} onClick={submit}>Đổi mật khẩu</Button>
    </>}
  >
    <form
      className="flex flex-col gap-space-md"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Mật khẩu hiện tại">
        {(id) => <Input id={id} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />}
      </Field>
      <Field label="Mật khẩu mới" hint="Tối thiểu 8 ký tự">
        {(id) => <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />}
      </Field>
      <Field label="Nhập lại mật khẩu mới" error={confirm && confirm !== next ? "Không khớp" : null}>
        {(id) => <Input id={id} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />}
      </Field>
      {change.error && <p className="text-body-sm text-error">{change.error.message}</p>}
      <button type="submit" hidden={true} />
    </form>
  </Dialog>;
}
