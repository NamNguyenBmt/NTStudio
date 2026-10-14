import { useApiQuery, useApiMutation } from "../../lib/api";
import {
  CloudDownload,
  FolderInput,
  KeyRound,
  PlugZap,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Trash,
  Unplug,
} from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { confirmDialog } from "../../components/ui/confirm";
import { Select } from "../../components/ui/Input";
import { PlatformBadge } from "../../components/PlatformBadge";
import { StatusDot } from "../../components/ui/StatusDot";
import { toast } from "../../components/ui/toast";
import { formatRelative } from "../../lib/format";
import { sessionMeta, tokenMeta, daysUntil } from "./meta";
import { ConnectFacebookButton, ConnectTiktokButton, ConnectYoutubeButton } from "./ConnectButtons";

const secretLabel = {
  cookie: "Cookie phiên",
  access_token: "Access Token",
  proxy_password: "Mật khẩu proxy",
  totp_secret: "Khóa 2FA (TOTP)",
  api_key: "API key",
};

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-space-sm">
      <h4 className="text-label-sm uppercase tracking-wider text-outline">{title}</h4>
      {children}
    </section>
  );
}

export function AccountInspector({ accountId, workspaces, onDeleted, onConnect, onImport }) {
  const { data: a, isLoading } = useApiQuery("accounts.get", { id: accountId ?? "" }, { enabled: accountId != null });
  const { data: activity = [] } = useApiQuery("activity.recent", { limit: 5 });
  const move = useApiMutation("accounts.update", ["accounts.", "workspaces.", "dashboard.", "channels."]);
  const remove = useApiMutation("accounts.delete", ["accounts.", "workspaces.", "dashboard.", "channels."]);
  const verify = useApiMutation("channels.verify", ["accounts.", "channels.", "alerts.", "dashboard."]);
  const disconnect = useApiMutation("channels.disconnect", ["accounts.", "channels.", "posts."]);
  if (!accountId) {
    return (
      <Card className="flex flex-col items-center gap-space-sm p-space-xl text-center text-body-sm text-on-surface-variant">
        <ScanSearch size={28} className="text-outline" />
        Chọn một tài khoản để xem phiên đăng nhập, token và kết nối đăng bài.
      </Card>
    );
  }
  if (isLoading || !a) return <Card className="h-[480px] animate-pulse" />;
  const session = sessionMeta[a.sessionStatus];
  const days = daysUntil(a.sessionExpiresAt);
  return (
    <Card className="flex flex-col gap-space-lg p-space-md">
      <div className="flex items-center gap-space-md">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-container-highest text-headline-sm text-on-surface-variant">
          {a.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-headline-sm text-on-surface">{a.displayName}</div>
          <div className="flex items-center gap-space-sm">
            <PlatformBadge platform={a.platform} />
            <span className="truncate font-mono text-code text-on-surface-variant">
              {a.handle ? `@${a.handle}` : `UID: ${a.externalId ?? "—"}`}
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-space-sm">
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() => {
            void confirmDialog({
              title: "Xóa tài khoản",
              message: `Xóa "${a.displayName}" và ${a.channels.length} kênh con? Cookie/token đã lưu cũng bị xóa. Không hoàn tác được.`,
              confirmLabel: "Xóa tài khoản",
              danger: true,
            }).then((ok) => ok && remove.mutate({ id: a.id }, { onSuccess: onDeleted }));
          }}
        >
          <Trash size={14} />
          {" Xóa tài khoản"}
        </Button>
      </div>
      <Section title="Không gian làm việc">
        <div className="flex items-center gap-space-sm">
          <FolderInput size={14} className="shrink-0 text-on-surface-variant" />
          <div className="flex-1">
            <Select
              aria-label="Chuyển không gian làm việc"
              value={a.workspaceId ?? ""}
              disabled={move.isPending}
              onChange={(e) => move.mutate({ id: a.id, patch: { workspaceId: e.target.value || null } })}
            >
              <option value="">— Chưa phân Pocket —</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p className="text-label-sm text-outline">
          {"Chuyển Pocket sẽ chuyển luôn "}
          {a.channels.length}
          {" kênh con."}
        </p>
      </Section>
      <Section title="Kết nối API đăng bài">
        {a.platform === "youtube" && (
          <ConnectYoutubeButton
            size="sm"
            variant="primary"
            accountId={a.id}
            label={a.channels.some((c) => c.tokenStatus !== "missing") ? "Kết nối lại YouTube" : "Kết nối YouTube"}
          />
        )}
        {a.platform === "tiktok" && (
          <ConnectTiktokButton
            size="sm"
            variant="primary"
            accountId={a.id}
            label={a.channels.some((c) => c.tokenStatus !== "missing") ? "Kết nối lại TikTok" : "Kết nối TikTok"}
          />
        )}
        {a.platform === "facebook" && (
          <div className="flex flex-wrap gap-1">
            <ConnectFacebookButton
              size="sm"
              variant="primary"
              accountId={a.id}
              label={a.channels.some((c) => c.tokenStatus !== "missing") ? "Kết nối lại Facebook" : "Kết nối Facebook"}
            />
            <Button
              size="sm"
              variant="subtle"
              onClick={() => onImport(a)}
              title="Nâng cao: dán User Token lấy từ Graph API Explorer"
            >
              <CloudDownload size={13} />
              {" Nhập bằng token"}
            </Button>
          </div>
        )}
        {a.channels.length === 0 && (
          <p className="text-body-sm text-on-surface-variant">Chưa có kênh – thêm Fanpage hoặc nhập từ User Token.</p>
        )}
        {a.channels.map((c) => {
          const t = tokenMeta[c.tokenStatus];
          const connected = c.tokenStatus !== "missing";
          return (
            <div key={c.id} className="flex flex-col gap-1 rounded-lg bg-surface-container-lowest p-space-sm">
              <div className="flex items-center gap-space-sm">
                <PlatformBadge platform={c.platform} />
                <span className="min-w-0 flex-1 truncate text-body-sm text-on-surface">{c.name}</span>
                <Badge tone={t.tone}>{t.label}</Badge>
              </div>
              {c.tokenExpiresAt && (
                <span className="font-mono text-code text-outline">
                  {"Hết hạn "}
                  {formatRelative(c.tokenExpiresAt)}
                </span>
              )}
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant={connected ? "subtle" : "primary"} onClick={() => onConnect(c)}>
                  <PlugZap size={12} /> {connected ? "Cập nhật token" : "Kết nối API"}
                </Button>
                {connected && (
                  <>
                    <Button
                      size="sm"
                      variant="subtle"
                      disabled={verify.isPending}
                      onClick={() =>
                        verify.mutate(
                          { id: c.id },
                          { onSuccess: (r) => toast.success(r.message), onError: (e) => toast.error(e.message) },
                        )
                      }
                    >
                      <ShieldCheck size={12} />
                      {" Kiểm tra"}
                    </Button>
                    <Button
                      size="sm"
                      variant="subtle"
                      disabled={disconnect.isPending}
                      onClick={() =>
                        void confirmDialog({
                          title: "Ngắt kết nối API",
                          message: `Xóa token đã lưu của "${c.name}"? Bài đã lên lịch cho kênh này sẽ lỗi khi tới giờ cho tới khi kết nối lại.`,
                          confirmLabel: "Ngắt kết nối",
                          danger: true,
                        }).then(
                          (ok) =>
                            ok &&
                            disconnect.mutate(
                              { id: c.id },
                              { onSuccess: () => toast.info(`Đã xóa token của ${c.name}`) },
                            ),
                        )
                      }
                    >
                      <Unplug size={12} />
                      {" Ngắt"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </Section>
      <Section title={"Bảo mật & mã truy cập"}>
        <div className="flex items-center gap-space-sm text-body-sm">
          <StatusDot health={session.health} />
          <span className="text-on-surface">{session.label}</span>
          {days != null && (
            <span className="font-mono text-code text-outline">
              {days >= 0 ? `· còn ${days} ngày` : `· quá hạn ${-days} ngày`}
            </span>
          )}
        </div>
        {a.secrets.length === 0 ? (
          <div className="rounded-lg bg-surface-container-lowest p-space-sm text-body-sm text-on-surface-variant">
            <KeyRound size={13} className="mr-1 inline text-outline" />
            Chưa có cookie / token nào trong két mã hóa.
          </div>
        ) : (
          a.secrets.map((s) => (
            <div
              key={`${s.kind}-${s.updatedAt.getTime()}`}
              className="rounded-lg bg-surface-container-lowest p-space-sm"
            >
              <div className="flex justify-between text-label-sm text-on-surface-variant">
                <span>{secretLabel[s.kind]}</span>
                <span>
                  {s.expiresAt ? `hết hạn ${formatRelative(s.expiresAt)}` : `cập nhật ${formatRelative(s.updatedAt)}`}
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-code text-secondary">{s.preview ?? "••••••••"}</div>
            </div>
          ))
        )}
      </Section>
      <Section title="Nhật ký tác vụ gần nhất">
        <ul className="flex flex-col gap-1 font-mono text-code">
          {activity.map((e) => (
            <li key={e.id} className="flex gap-space-sm">
              <span className="shrink-0 text-outline">
                {e.createdAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <Badge
                tone={
                  e.level === "ok"
                    ? "success"
                    : e.level === "warn"
                      ? "warning"
                      : e.level === "error"
                        ? "danger"
                        : "neutral"
                }
                mono={true}
              >
                {e.scope}
              </Badge>
              <span className="truncate text-on-surface-variant">{e.message}</span>
            </li>
          ))}
          {activity.length === 0 && (
            <li className="flex items-center gap-1 text-on-surface-variant">
              <ScrollText size={12} />
              {" Chưa có hoạt động"}
            </li>
          )}
        </ul>
      </Section>
    </Card>
  );
}
