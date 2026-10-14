import { useState } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { ChartColumn, ExternalLink, Flag, Plus, RefreshCw, Target, Trash } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { KpiTile } from "../../components/ui/KpiTile";
import { PlatformBadge } from "../../components/PlatformBadge";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { formatCompact } from "../../lib/format";
import { platformMeta } from "../calendar/ScheduleDialog";
import { GOAL_METRICS, GOAL_PRESETS } from "../../../../shared/goals";

const num = (v) => v == null ? "—" : formatCompact(Math.round(v));

function GroupTable({ title, rows }) {
  const max = Math.max(1, ...rows.map((r) => r.avgEngagements ?? 0));
  return <Card className="flex flex-col gap-space-sm p-space-md">
    <h3 className="text-label-md uppercase tracking-wider text-on-surface-variant">{title}</h3>
    {rows.length === 0 ? <p className="text-body-sm text-outline">Chưa có dữ liệu – cần bài đã đăng qua app và đã đồng bộ số liệu.</p> : <table className="w-full text-left text-body-sm">
      <thead className="text-label-sm text-outline">
        <tr>
          <th className="py-1 font-medium">Nhóm</th>
          <th className="py-1 text-right font-medium">Bài</th>
          <th className="py-1 text-right font-medium">Xem TB</th>
          <th className="py-1 font-medium">Tương tác TB</th>
          <th className="py-1 text-right font-medium">Giữ chân</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => <tr key={r.key} className="border-t border-overlay/[0.06]">
          <td className="py-1.5 pr-space-sm text-on-surface">{r.label}</td>
          <td className="py-1.5 text-right font-mono text-code text-on-surface-variant">{r.posts}</td>
          <td className="py-1.5 text-right font-mono text-code text-on-surface-variant">{num(r.avgViews)}</td>
          <td className="w-[38%] py-1.5 pl-space-md">
            <div className="flex items-center gap-space-sm">
              <div className="h-2 flex-1 rounded-full bg-surface-container">
                <div className="h-2 rounded-full bg-series-facebook" style={{ width: `${(r.avgEngagements ?? 0) / max * 100}%` }} />
              </div>
              <span className="w-12 text-right font-mono text-code text-on-surface">{num(r.avgEngagements)}</span>
            </div>
          </td>
          <td className="py-1.5 text-right font-mono text-code text-on-surface-variant">
            {r.avgRetention != null ? `${r.avgRetention}%` : "—"}
          </td>
        </tr>)}
      </tbody>
    </table>}
  </Card>;
}

function PostList({ title, posts }) {
  return <Card className="flex flex-col gap-space-sm p-space-md">
    <h3 className="text-label-md uppercase tracking-wider text-on-surface-variant">{title}</h3>
    {posts.length === 0 && <p className="text-body-sm text-outline">Chưa đủ dữ liệu.</p>}
    <ul className="flex flex-col gap-1">
      {posts.map((p) => <li key={p.id} className="flex items-center gap-space-sm rounded-lg bg-surface-container-lowest px-space-sm py-1.5">
        <PlatformBadge platform={p.platform} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-sm text-on-surface">{p.title}</div>
          <div className="text-label-sm text-on-surface-variant">
            {p.formatLabel}
            {" · "}
            {p.publishedAt.toLocaleDateString("vi-VN")}
            {p.durationSec ? ` · ${Math.round(p.durationSec)}s` : ""}
          </div>
        </div>
        <div className="text-right font-mono text-code">
          <div className="text-on-surface">{num(p.engagements)}{" tương tác"}</div>
          <div className="text-on-surface-variant">
            {num(p.views ?? p.reach)}
            {" xem"}
            {p.retention != null ? ` · giữ ${p.retention}%` : ""}
          </div>
        </div>
        {p.permalink?.startsWith("https://") && <a href={p.permalink} target="_blank" rel="noreferrer" aria-label="Xem bài" className="text-outline hover:text-primary">
          <ExternalLink size={13} />
        </a>}
      </li>)}
    </ul>
  </Card>;
}

function GoalDialog({ open, onClose }) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: channels = [] } = useApiQuery("channels.list", { workspaceId });
  const save = useApiMutation("analytics.saveGoal", ["analytics."]);
  const [channelId, setChannelId] = useState("");
  const [preset, setPreset] = useState("");
  const [metric, setMetric] = useState("followers");
  const [target, setTarget] = useState(1e4);
  const p = GOAL_PRESETS.find((x) => x.id === preset);
  const submit = async () => {
    if (!channelId) return;
    const goals = p ? p.goals : [{ metric, target }];
    for (const g of goals) await save.mutateAsync({ channelId, metric: g.metric, target: g.target, label: p?.label ?? null });
    toast.success(`Đã thêm ${goals.length} mục tiêu`);
    onClose();
  };
  return <Dialog
    open={open}
    onClose={onClose}
    width={500}
    title="Thêm mục tiêu kênh"
    footer={<>
      <Button variant="subtle" onClick={onClose}>Hủy</Button>
      <Button variant="primary" disabled={!channelId || save.isPending} onClick={() => void submit().catch((e) => toast.error(e.message))}>
        Thêm
      </Button>
    </>}
  >
    <div className="flex flex-col gap-space-md">
      <Field label="Kênh" required={true}>
        {(id) => <Select id={id} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">— Chọn kênh —</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{platformMeta[c.platform].short}{" · "}{c.name}</option>)}
        </Select>}
      </Field>
      <Field label="Bộ mốc gợi ý" hint={p?.note}>
        {(id) => <Select id={id} value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="">Tự đặt một mục tiêu</option>
          {GOAL_PRESETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </Select>}
      </Field>
      {!p && <div className="grid grid-cols-2 gap-space-md">
        <Field label="Chỉ số" hint={GOAL_METRICS[metric].hint}>
          {(id) => <Select id={id} value={metric} onChange={(e) => setMetric(e.target.value)}>
            {Object.keys(GOAL_METRICS).map((m) => <option key={m} value={m}>{GOAL_METRICS[m].label}</option>)}
          </Select>}
        </Field>
        <Field label={`Mục tiêu (${GOAL_METRICS[metric].unit})`}>
          {(id) => <Input id={id} type="number" min={1} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))} />}
        </Field>
      </div>}
      {p && <ul className="rounded-lg bg-surface-container-lowest p-space-sm text-body-sm text-on-surface-variant">
        {p.goals.map((g) => <li key={g.metric}>
          {"• "}
          {GOAL_METRICS[g.metric].label}
          {": "}
          <b className="text-on-surface">{g.target.toLocaleString("vi-VN")}</b>
          {" "}
          {GOAL_METRICS[g.metric].unit}
        </li>)}
      </ul>}
    </div>
  </Dialog>;
}

export function AnalyticsPage() {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: channels = [] } = useApiQuery("channels.list", { workspaceId });
  const [channelId, setChannelId] = useState("");
  const [days, setDays] = useState(30);
  const { data: o } = useApiQuery("analytics.overview", { workspaceId, channelId: channelId || null, days });
  const { data: goals = [] } = useApiQuery("analytics.goals", { workspaceId, channelId: channelId || null });
  const sync = useApiMutation("insights.sync", ["analytics.", "dashboard.", "insights."]);
  const delGoal = useApiMutation("analytics.deleteGoal", ["analytics."]);
  const [goalOpen, setGoalOpen] = useState(false);
  return <div className="flex flex-col gap-space-md">
    <Card className="flex flex-wrap items-center justify-between gap-space-md p-space-md">
      <div>
        <h1 className="flex items-center gap-space-sm text-headline-md text-on-surface">
          <ChartColumn size={20} className="text-secondary" />
          {" Phân tích nội dung"}
        </h1>
        <p className="text-body-sm text-on-surface-variant">
          Định dạng và độ dài nào hiệu quả, người xem ở lại bao lâu, kênh còn cách mục tiêu bao xa.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-space-sm">
        <div className="w-56">
          <Select aria-label="Kênh" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">Tất cả kênh</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{platformMeta[c.platform].short}{" · "}{c.name}</option>)}
          </Select>
        </div>
        <SegmentedControl
          label="Khoảng thời gian"
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={[
            { value: "30", label: "30 ngày" },
            { value: "60", label: "60 ngày" },
            { value: "90", label: "90 ngày" }
          ]}
        />
        <Button
          disabled={sync.isPending}
          onClick={() => sync.mutate(void 0, { onSuccess: (r) => toast.success(`Đã đồng bộ ${r.channels} kênh · ${r.posts} bài`), onError: (e) => toast.error(e.message) })}
        >
          <RefreshCw size={14} className={sync.isPending ? "animate-spin" : ""} />
          {" Đồng bộ số liệu"}
        </Button>
      </div>
    </Card>
    <div className="grid grid-cols-2 gap-space-md xl:grid-cols-4">
      <KpiTile label="Bài đã đăng" value={o ? o.posts : "–"} unit={`trong ${days} ngày`} footer={o ? `${o.postsWithMetrics} bài có số liệu` : ""} />
      <KpiTile label="Lượt xem / tiếp cận" value={o ? formatCompact(o.totalViews) : "–"} unit="tổng" footer={o && o.postsWithMetrics ? `TB ${formatCompact(o.totalViews / o.postsWithMetrics)}/bài` : ""} />
      <KpiTile label="Tương tác" value={o ? formatCompact(o.totalEngagements) : "–"} unit="tổng" footer={o && o.postsWithMetrics ? `TB ${formatCompact(o.totalEngagements / o.postsWithMetrics)}/bài` : ""} />
      <KpiTile label="Giữ chân người xem" value={o?.avgRetention != null ? `${o.avgRetention}%` : "—"} unit="thời lượng được xem TB" footer="Video/Reels có số liệu thời gian xem" />
    </div>
    <div className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
      <GroupTable title="Hiệu quả theo định dạng" rows={o?.byFormat ?? []} />
      <GroupTable title="Hiệu quả theo độ dài video" rows={o?.byLength ?? []} />
      <PostList title="Bài tốt nhất" posts={o?.top ?? []} />
      <PostList title="Bài kém nhất" posts={o?.bottom ?? []} />
    </div>
    <Card className="flex flex-col gap-space-md p-space-md">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-space-sm text-label-md uppercase tracking-wider text-on-surface-variant">
          <Target size={14} className="text-secondary" />
          {" Mục tiêu kênh"}
        </h3>
        <Button size="sm" variant="subtle" onClick={() => setGoalOpen(true)}>
          <Plus size={13} />
          {" Thêm mục tiêu"}
        </Button>
      </div>
      {goals.length === 0 && <p className="text-body-sm text-outline">
        Đặt mục tiêu (người theo dõi, phút xem 60 ngày, số video…) để theo dõi tiến độ tới mốc bật kiếm tiền hoặc mốc tăng trưởng của bạn.
      </p>}
      <div className="grid grid-cols-1 gap-space-sm md:grid-cols-2 2xl:grid-cols-3">
        {goals.map((g) => <div key={g.id} className="flex flex-col gap-1 rounded-xl bg-surface-container-lowest p-space-sm">
          <div className="flex items-center gap-space-sm">
            <PlatformBadge platform={g.platform} />
            <span className="min-w-0 flex-1 truncate text-label-md text-on-surface">{g.channelName}</span>
            {g.progress >= 100 ? <Badge tone="success"><Flag size={11} />{" Đạt"}</Badge> : <span className="font-mono text-code text-on-surface-variant">{g.progress}%</span>}
            <button type="button" aria-label="Xóa mục tiêu" onClick={() => delGoal.mutate({ id: g.id })} className="text-outline hover:text-error">
              <Trash size={12} />
            </button>
          </div>
          <div className="text-body-sm text-on-surface-variant">
            {g.metricLabel}
            {": "}
            <b className="text-on-surface">{g.current.toLocaleString("vi-VN")}</b>
            {" / "}
            {g.target.toLocaleString("vi-VN")}
            {" "}
            {GOAL_METRICS[g.metric].unit}
          </div>
          <div className="h-2 rounded-full bg-surface-container" role="progressbar" aria-valuenow={g.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.metricLabel} ${g.progress}%`}>
            <div className={g.progress >= 100 ? "h-2 rounded-full bg-success" : "h-2 rounded-full bg-primary-container"} style={{ width: `${g.progress}%` }} />
          </div>
          {g.label && <div className="text-label-sm text-outline">{g.label}</div>}
        </div>)}
      </div>
      <p className="text-label-sm text-outline">
        Mốc gợi ý chỉ để tham khảo – điều kiện kiếm tiền do nền tảng quy định và có thể thay đổi; kiểm tra trong Meta Business Suite / TikTok Studio.
      </p>
    </Card>
    <GoalDialog open={goalOpen} onClose={() => setGoalOpen(false)} />
  </div>;
}
