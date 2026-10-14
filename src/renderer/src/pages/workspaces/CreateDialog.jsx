import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { Trash } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";

export function IconTrash({ onClick }) {
  return (
    <button
      type="button"
      aria-label="Xóa"
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded text-on-surface-variant hover:bg-danger/15 hover:text-error"
    >
      <Trash size={14} />
    </button>
  );
}

const COLORS = ["#c0c1ff", "#4edea3", "#4cd7f6", "#F59E0B", "#f472b6", "#a78bfa"];

export function CreateDialog({ open, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const create = useApiMutation("workspaces.create", ["workspaces.", "dashboard."]);
  useEffect(() => {
    if (open) {
      setName("");
      setColor(COLORS[0]);
    }
  }, [open]);
  const submit = () => {
    if (!name.trim()) return;
    create.mutate({ name, color }, { onSuccess: (ws) => (onCreated(ws.id), onClose()) });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tạo Không gian mới"
      description="Mỗi Pocket có dàn kênh, lịch đăng và ngân sách AI tách biệt."
      width={440}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={submit}>
            Tạo Pocket
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-space-md"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Tên ngách" required={true}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={"Mẹ & Bé"}
              maxLength={80}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-label-md text-on-surface-variant">Màu nhận diện</span>
          <div className="flex gap-space-sm" role="radiogroup" aria-label="Màu nhận diện">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-surface ${color === c ? "ring-2 ring-on-surface" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        {create.error && <p className="text-body-sm text-error">{create.error.message}</p>}
        <button type="submit" hidden={true} />
      </form>
    </Dialog>
  );
}
