import { useNavigate } from "react-router-dom";
import { ArrowRight, Award } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { PlatformBadge } from "../../components/PlatformBadge";
import { formatCompact } from "../../lib/format";

const badgeLabel = { facebook: "FB Page", tiktok: "TikTok", instagram: "Insta", youtube: "YouTube" };

export function TopChannelsCard({ channels }) {
  const navigate = useNavigate();
  return <Card className="flex flex-col">
    <CardHeader
      icon={Award}
      title="Top Kênh Tăng Trưởng Mạnh Nhất"
      subtitle="Lượng người theo dõi tăng trong 7 ngày qua"
      actions={<Button size="sm" variant="subtle" onClick={() => navigate("/accounts")}>
        {"Tất cả kênh "}
        <ArrowRight size={13} />
      </Button>}
    />
    <ul className="flex flex-col gap-space-sm px-space-md pb-space-md">
      {!channels && [0, 1, 2].map((i) => <li key={i} className="h-14 animate-pulse rounded-xl bg-surface-container" />)}
      {channels?.length === 0 && <li className="text-body-sm text-on-surface-variant">Chưa có số liệu kênh.</li>}
      {channels?.map((c) => <li key={c.id} className="flex items-center gap-space-md rounded-xl bg-surface-container px-space-md py-space-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest text-label-md text-on-surface-variant">
          {c.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-space-sm">
            <PlatformBadge platform={c.platform} label={badgeLabel[c.platform]} />
            <span className="truncate text-label-md text-on-surface">{c.handle ? `@${c.handle}` : c.name}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-code text-on-surface-variant">
            {c.platform === "facebook" ? `ID: ${c.externalId ?? "—"}` : c.name}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-headline-sm tabular text-tertiary">+{formatCompact(c.followerGain7d)}</div>
          <div className="text-label-sm text-on-surface-variant">Followers mới</div>
        </div>
      </li>)}
    </ul>
  </Card>;
}
