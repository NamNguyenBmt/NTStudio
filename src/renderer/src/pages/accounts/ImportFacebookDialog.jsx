import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Textarea } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { INVALIDATES } from "./ConnectChannelDialog";

export function ImportFacebookDialog({ account, onClose }) {
  const [token, setToken] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const run = useApiMutation("accounts.importFacebook", INVALIDATES);
  useEffect(() => {
    if (!account) return;
    setToken("");
    setAppId("");
    setAppSecret("");
    run.reset();
  }, [account?.id]);
  const submit = () => {
    if (!account || token.trim().length < 20) return;
    run.mutate(
      { accountId: account.id, userToken: token, appId: appId || null, appSecret: appSecret || null },
      {
        onSuccess: (r) => {
          toast.success(r.message);
          onClose();
        },
      },
    );
  };
  return (
    <Dialog
      open={account != null}
      onClose={() => !run.isPending && onClose()}
      width={540}
      title="Nhập Fanpage từ User Token"
      description={account ? `VIA: ${account.displayName}` : void 0}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={run.isPending}>
            Hủy
          </Button>
          <Button variant="primary" disabled={token.trim().length < 20 || run.isPending} onClick={submit}>
            {run.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <KeyRound size={14} />}{" "}
            {run.isPending ? "Đang lấy danh sách trang…" : "Nhập & kết nối"}
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
        <p className="col-span-2 rounded-lg bg-surface-container-lowest p-space-sm text-body-sm text-on-surface-variant">
          App lấy mọi Fanpage VIA đang quản trị (cùng tài khoản Instagram Business liên kết), tạo kênh còn thiếu trong
          Pocket của VIA và lưu Page token mã hóa cho từng trang. Quyền cần có: pages_show_list, pages_manage_posts,
          pages_read_engagement, instagram_basic, instagram_content_publish.
        </p>
        <Field label="User Access Token" required={true} className="col-span-2">
          {(id) => (
            <Textarea
              id={id}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="min-h-[84px] font-mono text-code"
              spellCheck={false}
              autoComplete="off"
              placeholder="EAAG…"
            />
          )}
        </Field>
        <Field label="App ID (tùy chọn)" hint="Để đổi sang token dài hạn">
          {(id) => (
            <Input
              id={id}
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          )}
        </Field>
        <Field label="App Secret (tùy chọn)" hint="Chỉ dùng một lần, không lưu">
          {(id) => (
            <Input
              id={id}
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          )}
        </Field>
        <p className="col-span-2 text-label-sm text-outline">
          Không có App ID/Secret: token từ Graph API Explorer chỉ sống 1–2 giờ nên Page token cũng hết hạn theo. Có App
          ID/Secret: Page token không hết hạn.
        </p>
        {run.error && <p className="col-span-2 text-body-sm text-error">{run.error.message}</p>}
        <button type="submit" hidden={true} />
      </form>
    </Dialog>
  );
}
