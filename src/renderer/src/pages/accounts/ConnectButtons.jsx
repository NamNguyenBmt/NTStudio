import { useState } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { PlatformIcon } from "../../components/PlatformIcon";
import { toast } from "../../components/ui/toast";
import { INVALIDATES, useTargetWorkspace } from "./ConnectChannelDialog";

export function ConnectFacebookButton({
  accountId,
  workspaceId,
  label = "Kết nối Facebook",
  onConnected,
  ...props
}) {
  const { data: meta } = useApiQuery("integrations.meta");
  const connect = useApiMutation("accounts.connectFacebook", INVALIDATES);
  const targetWs = useTargetWorkspace(workspaceId);
  const [missing, setMissing] = useState([]);
  const ready = !!meta?.appId && meta.hasSecret || !!meta?.viaCloud;
  return <>
    <Dialog
      open={missing.length > 0}
      onClose={() => setMissing([])}
      width={560}
      title="Kết nối được, nhưng còn thiếu quyền"
      description="Một vài quyền Facebook chưa được cấp nên các chức năng dưới đây tạm chưa dùng được."
      footer={<Button variant="primary" onClick={() => setMissing([])}>Đã hiểu</Button>}
    >
      <div className="flex flex-col gap-space-md text-body-sm">
        <ul className="flex flex-col gap-space-sm">
          {missing.map((m) => <li key={m.feature} className="flex items-center gap-1 rounded-lg bg-surface-container-lowest p-space-sm text-label-md text-warning">
            <TriangleAlert size={13} />
            {" "}
            {m.feature}
            {" – chưa dùng được"}
          </li>)}
        </ul>
        <p className="rounded-lg bg-secondary/10 p-space-sm text-on-surface">
          {"Nếu khi đăng nhập bạn đã bỏ chọn quyền nào đó, bấm "}
          <b>Kết nối lại Facebook</b>
          {" và giữ nguyên các quyền được đề xuất. Vẫn thiếu thì liên hệ hỗ trợ NT – bạn không cần tự cấu hình gì."}
        </p>
      </div>
    </Dialog>
    <Button
      {...props}
      disabled={connect.isPending || props.disabled}
      title={ready ? "Đăng nhập Facebook, chọn Fanpage/Instagram và bấm Đồng ý" : "Kết nối Facebook chưa được bật – liên hệ hỗ trợ NT"}
      onClick={() => {
        if (!ready) {
          toast.error("Kết nối Facebook chưa được bật cho tài khoản – liên hệ hỗ trợ NT");
          return;
        }
        connect.mutate(
          { accountId, workspaceId: targetWs },
          {
            onSuccess: (r) => {
              toast.success(`${r.userName}: ${r.message}`);
              if (r.missing.length) setMissing(r.missing);
              else if (r.instagramIssue) toast.error(r.instagramIssue);
              onConnected?.(r.accountId);
            },
            onError: (e) => /hủy kết nối/.test(e.message) ? toast.info("Đã hủy kết nối Facebook") : toast.error(e.message)
          }
        );
      }}
    >
      {connect.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <PlatformIcon platform="facebook" size={15} />}
      {" "}
      {connect.isPending ? "Đang chờ đăng nhập Facebook…" : label}
    </Button>
  </>;
}

export function ConnectTiktokButton({
  accountId,
  workspaceId,
  label = "Kết nối TikTok",
  onConnected,
  ...props
}) {
  const { data: app } = useApiQuery("integrations.tiktok");
  const connect = useApiMutation("accounts.connectTiktok", INVALIDATES);
  const targetWs = useTargetWorkspace(workspaceId);
  const ready = !!app?.clientKey && app.hasSecret || !!app?.viaCloud;
  return <Button
    {...props}
    disabled={connect.isPending || props.disabled}
    title={ready ? "Đăng nhập TikTok và bấm Đồng ý" : "Kết nối TikTok chưa được bật – liên hệ hỗ trợ NT"}
    onClick={() => {
      if (!ready) {
        toast.error("Kết nối TikTok chưa được bật cho tài khoản – liên hệ hỗ trợ NT");
        return;
      }
      connect.mutate(
        { accountId, workspaceId: targetWs },
        {
          onSuccess: (r) => {
            if (r.missingScopes.length) toast.error(r.message);
            else toast.success(r.message);
            onConnected?.(r.accountId);
          },
          onError: (e) => /hủy kết nối/.test(e.message) ? toast.info("Đã hủy kết nối TikTok") : toast.error(e.message)
        }
      );
    }}
  >
    {connect.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <PlatformIcon platform="tiktok" size={15} />}
    {" "}
    {connect.isPending ? "Đang chờ đăng nhập TikTok…" : label}
  </Button>;
}

export function ConnectYoutubeButton({
  accountId,
  workspaceId,
  label = "Kết nối YouTube",
  onConnected,
  ...props
}) {
  const { data: app } = useApiQuery("integrations.youtube");
  const connect = useApiMutation("accounts.connectYoutube", INVALIDATES);
  const targetWs = useTargetWorkspace(workspaceId);
  const cancel = useApiMutation("accounts.cancelYoutubeLogin");
  const ready = !!app?.clientId && app.hasSecret || !!app?.viaCloud;
  if (connect.isPending)
    return <Button {...props} onClick={() => cancel.mutate(void 0)} title="Đang chờ bạn đăng nhập Google trong trình duyệt – bấm để hủy">
      <LoaderCircle size={14} className="animate-spin" />
      {" Đang chờ trình duyệt… (Hủy)"}
    </Button>;
  return <Button
    {...props}
    disabled={props.disabled}
    title={ready ? "Mở trình duyệt để đăng nhập Google và chọn kênh YouTube" : "Kết nối YouTube chưa được bật – liên hệ hỗ trợ NT"}
    onClick={() => {
      if (!ready) {
        toast.error("Kết nối YouTube chưa được bật cho tài khoản – liên hệ hỗ trợ NT");
        return;
      }
      toast.info("Đã mở trình duyệt – đăng nhập Google, chọn kênh và bấm Cho phép");
      connect.mutate(
        { accountId, workspaceId: targetWs },
        {
          onSuccess: (r) => {
            toast.success(r.message);
            onConnected?.(r.accountId);
          },
          onError: (e) => /Đã hủy/.test(e.message) ? toast.info("Đã hủy kết nối YouTube") : toast.error(e.message)
        }
      );
    }}
  >
    <PlatformIcon platform="youtube" size={15} />
    {" "}
    {label}
  </Button>;
}
