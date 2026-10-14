import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { LoaderCircle, PlugZap } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Textarea } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { PlatformBadge } from "../../components/PlatformBadge";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";

export const INVALIDATES = ["accounts.", "channels.", "posts.", "dashboard.", "alerts.", "workspaces."];

export function useTargetWorkspace(workspaceId) {
  const active = useUiStore((s) => s.activeWorkspaceId);
  return workspaceId !== void 0 ? workspaceId : active;
}

const HELP = {
  facebook:
    "Dán Page Access Token của Fanpage, hoặc User Token của VIA (app sẽ tự tìm đúng trang). Cần quyền pages_manage_posts, pages_read_engagement. Lấy từ Graph API Explorer hoặc app Meta của bạn.",
  instagram:
    "Dán Page Access Token của Fanpage đã liên kết tài khoản Instagram Business/Creator, hoặc User Token của VIA. Cần quyền instagram_basic, instagram_content_publish.",
  tiktok:
    "Dán Access Token từ app TikTok for Developers của bạn (scope video.publish, user.info.basic). Token sống 24 giờ – thêm refresh token + client key/secret để app tự làm mới.",
  youtube: 'Kênh YouTube kết nối bằng nút "Kết nối YouTube" (đăng nhập Google) – không dán token thủ công.',
};

export function ConnectChannelDialog({ channel, onClose }) {
  const [token, setToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const connect = useApiMutation("channels.connect", INVALIDATES);
  useEffect(() => {
    if (!channel) return;
    setToken("");
    setRefreshToken("");
    setClientKey("");
    setClientSecret("");
    connect.reset();
  }, [channel?.id]);
  const tiktok = channel?.platform === "tiktok";
  const submit = () => {
    if (!channel || token.trim().length < 20) return;
    connect.mutate(
      {
        channelId: channel.id,
        token,
        refreshToken: tiktok ? refreshToken || null : null,
        clientKey: tiktok ? clientKey || null : null,
        clientSecret: tiktok ? clientSecret || null : null,
      },
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
      open={channel != null}
      onClose={() => !connect.isPending && onClose()}
      width={520}
      title="Kết nối API đăng bài"
      description={channel ? `${channel.name}${channel.externalId ? ` · ${channel.externalId}` : ""}` : void 0}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={connect.isPending}>
            Hủy
          </Button>
          <Button variant="primary" disabled={token.trim().length < 20 || connect.isPending} onClick={submit}>
            {connect.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <PlugZap size={14} />}{" "}
            {connect.isPending ? "Đang xác minh…" : "Xác minh & lưu"}
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
        {channel && (
          <div className="flex items-start gap-space-sm rounded-lg bg-surface-container-lowest p-space-sm text-body-sm text-on-surface-variant">
            <PlatformBadge platform={channel.platform} />
            <span>{HELP[channel.platform]}</span>
          </div>
        )}
        <Field
          label="Access Token"
          required={true}
          hint="Lưu mã hóa AES-256-GCM trong két của hệ điều hành; không hiển thị lại sau khi lưu."
        >
          {(id) => (
            <Textarea
              id={id}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="min-h-[84px] font-mono text-code"
              spellCheck={false}
              autoComplete="off"
              placeholder={tiktok ? "act.xxxxxxxx…" : "EAAG…"}
            />
          )}
        </Field>
        {tiktok && (
          <div className="grid grid-cols-2 gap-space-md">
            <Field label="Refresh token (tùy chọn)" className="col-span-2">
              {(id) => (
                <Input
                  id={id}
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  className="font-mono"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="rft.xxxxxxxx…"
                />
              )}
            </Field>
            <Field label="Client key">
              {(id) => (
                <Input
                  id={id}
                  value={clientKey}
                  onChange={(e) => setClientKey(e.target.value)}
                  className="font-mono"
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label="Client secret">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  className="font-mono"
                  autoComplete="off"
                />
              )}
            </Field>
            <p className="col-span-2 text-label-sm text-outline">
              Ứng dụng TikTok chưa qua kiểm duyệt (audit) chỉ đăng được ở chế độ riêng tư (SELF_ONLY) – app sẽ ghi chú
              trên bài đã đăng.
            </p>
          </div>
        )}
        {connect.error && <p className="text-body-sm text-error">{connect.error.message}</p>}
        <button type="submit" hidden={true} />
      </form>
    </Dialog>
  );
}
