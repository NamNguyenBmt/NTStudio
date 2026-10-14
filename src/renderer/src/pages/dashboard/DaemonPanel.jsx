import { Bot, CalendarClock, Clapperboard, Workflow } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Card, CardHeader } from "../../components/ui/Card";
import { Progress } from "../../components/ui/Progress";
import { StatusDot } from "../../components/ui/StatusDot";
import { formatRelative } from "../../lib/format";

function Lane({ icon: Icon, label, badge, title, children }) {
  return <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container p-space-md">
    <div className="flex items-center justify-between gap-space-sm">
      <span className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-outline">
        <Icon size={13} />
        {" "}
        {label}
      </span>
      {badge}
    </div>
    <div className="text-headline-sm text-on-surface">{title}</div>
    {children}
  </div>;
}

export function DaemonPanel({ daemon }) {
  const d = daemon;
  const active = d ? d.render.running + d.publish.next24h + d.autoReply.enabledRules > 0 : false;
  return <Card>
    <CardHeader
      icon={Workflow}
      title="Luồng Tự Động Hóa Chạy Ngầm (Automation Daemon)"
      subtitle="Render video, đăng bài theo lịch và tự động trả lời"
      actions={<Badge tone={active ? "success" : "neutral"} pill={true}>
        <StatusDot health={active ? "ok" : "idle"} live={active} />
        {active ? "Có tác vụ" : "Rảnh"}
      </Badge>}
    />
    <div className="grid grid-cols-1 gap-space-md p-space-md pt-0 lg:grid-cols-3">
      <Lane
        icon={Clapperboard}
        label="Xưởng AI Video"
        badge={<Badge tone="secondary" mono={true}>{d?.render.current?.encoder ?? "Encoder: chưa dò"}</Badge>}
        title={d ? d.render.running ? `Đang render ${d.render.running} video` : "Không có video đang render" : "…"}
      >
        {d?.render.current ? <>
          <p className="truncate text-body-sm text-on-surface-variant">Kịch bản: "{d.render.current.topic}"</p>
          <Progress value={d.render.current.progress * 100} />
        </> : <p className="text-body-sm text-on-surface-variant">{"Hàng chờ: "}{d?.render.queued ?? 0}{" video"}</p>}
      </Lane>
      <Lane
        icon={CalendarClock}
        label="Hàng chờ lên lịch"
        badge={d?.publish.nextAt ? <Badge tone="secondary" mono={true}>{formatRelative(d.publish.nextAt)}</Badge> : null}
        title={d ? `${d.publish.next24h} bài trong 24 giờ tới` : "…"}
      >
        <p className="truncate text-body-sm text-on-surface-variant">
          {d?.publish.nextChannels.length ? `Kênh: ${d.publish.nextChannels.join(", ")}` : "Chưa có bài nào sắp đến hạn."}
        </p>
      </Lane>
      <Lane
        icon={Bot}
        label="Bot trả lời tự động"
        badge={<Badge mono={true}>{d?.autoReply.enabledRules ?? 0}{" luật bật"}</Badge>}
        title={d ? `${d.autoReply.botRepliesToday} phản hồi hôm nay` : "…"}
      >
        <p className="text-body-sm text-on-surface-variant">
          {"Trả lời & ẩn bình luận theo từ khóa, giãn cách ngẫu nhiên."}
        </p>
      </Lane>
    </div>
  </Card>;
}
