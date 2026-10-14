import { useApiQuery, useApiMutation } from "../../lib/api";
import { LayoutDashboard, LoaderCircle, RefreshCw, TrendingUp, Wrench } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { KpiTile } from "../../components/ui/KpiTile";
import { PlatformBadge } from "../../components/PlatformBadge";
import { Progress } from "../../components/ui/Progress";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { formatCompact, formatInt, formatPct, formatSignedPct } from "../../lib/format";
import { PageHeader } from "../../components/PageHeader";
import { AlertsCard } from "./AlertsCard";
import { DaemonPanel } from "./DaemonPanel";
import { GoldenHoursCard } from "./GoldenHoursCard";
import { ReachCard } from "./ReachCard";
import { TopChannelsCard } from "./TopChannelsCard";

export function DashboardPage() {
  const workspaceId = useUiStore((s2) => s2.activeWorkspaceId);
  const { data: s, error } = useApiQuery("dashboard.summary", { workspaceId });
  const { data: alerts = [] } = useApiQuery("alerts.open");
  const { data: workspaces = [] } = useApiQuery("workspaces.list");
  const { data: top } = useApiQuery("dashboard.topChannels", { workspaceId, limit: 3 });
  const { data: daemon } = useApiQuery("dashboard.daemon", { workspaceId });
  const { data: lastSync } = useApiQuery("insights.last");
  const sync = useApiMutation("insights.sync", ["dashboard.", "insights.", "accounts.", "channels."]);
  const runSync = () =>
    sync.mutate(void 0, {
      onSuccess: (r) => {
        if (!r.channels && !r.errors.length)
          toast.info("Chưa có kênh nào kết nối API – vào Tài khoản & Kênh → Kết nối Facebook");
        else toast.success(`Đã đồng bộ số liệu ${r.channels} kênh`);
        for (const e of [...r.errors, ...r.notes].slice(0, 3)) toast.error(e);
      },
      onError: (e) => toast.error(e.message),
    });
  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        icon={LayoutDashboard}
        title="Trung tâm Điều hành Hệ thống"
        description={
          s ? `Giám sát tự động ${s.channels.total} kênh mạng xã hội và luồng AI Video Renderer` : "Đang tải số liệu…"
        }
        status={
          s && (
            <Badge
              tone={s.health.score >= 90 ? "success" : s.health.score >= 70 ? "warning" : "danger"}
              pill={true}
              mono={true}
            >
              {formatPct(s.health.score)}
              {" Tối ưu"}
            </Badge>
          )
        }
        actions={
          <>
            <Button
              disabled={sync.isPending}
              onClick={runSync}
              title={
                lastSync
                  ? `Lần cuối: ${new Date(lastSync.at).toLocaleString("vi-VN")} · tự đồng bộ mỗi 6 giờ`
                  : "Lấy lượt xem, tương tác, người theo dõi thật từ Facebook / Instagram / TikTok"
              }
            >
              {sync.isPending ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} className="text-secondary" />
              )}
              Đồng bộ số liệu
            </Button>
            <Button variant="primary" disabled={true} title="Bộ xử lý tự động – có ở P6">
              <Wrench size={16} />
              Khắc phục tự động ({alerts.length})
            </Button>
          </>
        }
      />
      {error && (
        <Card className="border-danger/40 p-space-md text-body-sm text-error">
          {"Không tải được số liệu: "}
          {error.message}
        </Card>
      )}
      <div className="grid grid-cols-2 gap-space-md xl:grid-cols-4">
        <KpiTile
          label="Dàn kênh hoạt động"
          value={s ? s.channels.total : "–"}
          unit="Kênh kết nối"
          aside={
            s && s.channels.addedThisWeek > 0 ? (
              <Badge tone="success" pill={true}>
                <TrendingUp size={12} />
                {" +"}
                {s.channels.addedThisWeek}
                {" tuần này"}
              </Badge>
            ) : null
          }
          footer={
            s && (
              <div className="flex gap-space-xs">
                <PlatformBadge platform="facebook" label={`${s.channels.byPlatform.facebook} FB`} />
                <PlatformBadge platform="tiktok" label={`${s.channels.byPlatform.tiktok} TT`} />
                <PlatformBadge platform="instagram" label={`${s.channels.byPlatform.instagram} IG`} />
                <PlatformBadge platform="youtube" label={`${s.channels.byPlatform.youtube} YT`} />
              </div>
            )
          }
        />
        <KpiTile
          label="Chỉ số an toàn dàn"
          value={s ? formatPct(s.health.score) : "–"}
          unit="An toàn"
          valueClassName="text-tertiary"
          aside={
            s && s.health.warn + s.health.error > 0 ? (
              <Badge tone="danger" pill={true}>
                {s.health.warn + s.health.error}
                {" Lưu ý"}
              </Badge>
            ) : null
          }
          footer={
            s && (
              <div className="flex flex-col gap-1.5">
                <Progress value={s.health.score} barClassName="bg-tertiary" />
                <div className="flex justify-between">
                  <span className="text-tertiary">
                    {s.health.ok}
                    {" Xanh"}
                  </span>
                  <span className="text-warning">
                    {s.health.warn}
                    {" Cảnh báo"}
                  </span>
                  <span className="text-error">
                    {s.health.error}
                    {" Lỗi"}
                  </span>
                </div>
              </div>
            )
          }
        />
        <KpiTile
          label="Bài đăng tháng này"
          value={s ? formatInt(s.posts.publishedThisMonth) : "–"}
          unit="Video / Bài"
          aside={
            s?.posts.successRate != null ? (
              <Badge tone="secondary" mono={true}>
                {formatPct(s.posts.successRate)}
                {" Success"}
              </Badge>
            ) : null
          }
          footer={s && `Hàng chờ: ${s.posts.queued} bài · Lỗi: ${s.posts.failedThisMonth}`}
        />
        <KpiTile
          label={"Lượt xem & tiếp cận"}
          value={s ? formatCompact(s.reach.views30d) : "–"}
          unit="Lượt xem / 30 ngày"
          aside={
            s?.reach.viewsChangePct != null ? (
              <Badge tone={s.reach.viewsChangePct >= 0 ? "success" : "danger"} pill={true}>
                {formatSignedPct(s.reach.viewsChangePct)}
              </Badge>
            ) : null
          }
          footer={s && `Tương tác: ${formatCompact(s.reach.engagements30d)}`}
        />
      </div>
      <div className="grid grid-cols-1 gap-space-md xl:grid-cols-[2fr_1fr]">
        <ReachCard summary={s} />
        <GoldenHoursCard workspaces={workspaces} activeWorkspaceId={workspaceId} />
      </div>
      <div className="grid grid-cols-1 gap-space-md xl:grid-cols-[1.2fr_1fr]">
        <TopChannelsCard channels={top} />
        <AlertsCard alerts={alerts} />
      </div>
      <DaemonPanel daemon={daemon} />
    </div>
  );
}
