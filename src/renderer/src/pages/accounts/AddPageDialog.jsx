import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";

export function AddPageDialog({ account, onClose }) {
  const [name, setName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [role, setRole] = useState("admin");
  const create = useApiMutation("channels.createPage", ["accounts.", "workspaces.", "dashboard.", "channels."]);
  useEffect(() => {
    if (account) {
      setName("");
      setExternalId("");
      setRole("admin");
      create.reset();
    }
  }, [account]);
  const submit = () => {
    if (!account || !name.trim()) return;
    create.mutate({ accountId: account.id, name, externalId: externalId || null, role }, { onSuccess: onClose });
  };
  return (
    <Dialog
      open={account != null}
      onClose={onClose}
      title="Thêm Fanpage"
      description={account ? `Dưới VIA: ${account.displayName}` : void 0}
      width={440}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={!name.trim() || create.isPending} onClick={submit}>
            Thêm Fanpage
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
        <Field label="Tên Fanpage" required={true}>
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Thời Trang Nữ Công Sở" />
          )}
        </Field>
        <Field label="Page ID">
          {(id) => (
            <Input
              id={id}
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="fb_page_99182"
            />
          )}
        </Field>
        <Field label="Quyền của VIA trên Page">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Quản trị viên</option>
              <option value="editor">Biên tập viên</option>
              <option value="moderator">Kiểm duyệt viên</option>
              <option value="advertiser">Nhà quảng cáo</option>
            </Select>
          )}
        </Field>
        {create.error && <p className="text-body-sm text-error">{create.error.message}</p>}
        <button type="submit" hidden={true} />
      </form>
    </Dialog>
  );
}
