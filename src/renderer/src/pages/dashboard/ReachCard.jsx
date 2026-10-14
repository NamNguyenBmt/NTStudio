import { useState } from "react";
import { Activity, Table2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Card, CardHeader } from "../../components/ui/Card";
import { IconButton } from "../../components/ui/IconButton";
import { PlatformIcon } from "../../components/PlatformIcon";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { formatCompact, formatSignedPct } from "../../lib/format";
import { PLATFORM_ORDER, platformMeta } from "../calendar/ScheduleDialog";
import { LineChart } from "../../components/LineChart";

const dayLabel = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function ReachCard({ summary }) {
  const [range, setRange] = useState("30");
  const [table, setTable] = useState(false);
  const points = summary?.reach.series.slice(-Number(range)) ?? [];
  const series = PLATFORM_ORDER.map((p) => ({
    key: p,
    label: platformMeta[p].label,
    colorClass: platformMeta[p].seriesClass,
    values: points.map((d) => d.byPlatform[p])
  }));
  return <Card className="flex flex-col">
    <CardHeader
      icon={Activity}
      title={`Lưu lượng View ${range} ngày`}
      subtitle={"Lượt xem theo nền tảng: Facebook, TikTok, Instagram & YouTube"}
      actions={<>
        <SegmentedControl
          label="Khoảng thời gian"
          value={range}
          onChange={setRange}
          options={[
            { value: "30", label: "30 ngày" },
            { value: "14", label: "14 ngày" },
            { value: "7", label: "7 ngày" }
          ]}
        />
        <IconButton
          icon={Table2}
          label={table ? "Xem biểu đồ" : "Xem bảng số liệu"}
          onClick={() => setTable((v) => !v)}
          className={cn(table && "bg-surface-container-high text-on-surface")}
        />
      </>}
    />
    <div className="mx-space-md rounded-xl bg-surface-container-lowest p-space-sm">
      {summary ? <LineChart xLabels={points.map((p) => p.day)} series={series} formatValue={formatCompact} formatX={dayLabel} showTable={table} height={250} /> : <div className="h-[250px] animate-pulse rounded-lg bg-overlay/[0.02]" />}
    </div>
    <div className="grid grid-cols-2 gap-space-sm p-space-md xl:grid-cols-4">
      {PLATFORM_ORDER.map((p) => {
        const r = summary?.reach.platforms.find((x) => x.platform === p);
        return <div key={p} className="flex items-center gap-space-sm rounded-xl bg-surface-container px-space-md py-space-sm">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", platformMeta[p].seriesBg)} aria-hidden={true} />
          <PlatformIcon platform={p} size={16} />
          <div className="min-w-0">
            <div className="text-label-sm text-on-surface-variant">{platformMeta[p].label}{" · 30 ngày"}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-body-md font-semibold tabular text-on-surface">
                {r ? formatCompact(r.views30d) : "–"}
              </span>
              {r?.changePct != null && <span className={cn("font-mono text-code", r.changePct >= 0 ? "text-tertiary" : "text-error")}>
                {formatSignedPct(r.changePct)}
              </span>}
            </div>
          </div>
        </div>;
      })}
    </div>
  </Card>;
}
