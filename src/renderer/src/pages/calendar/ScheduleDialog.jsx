import { useState, useMemo, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { Ban, ExternalLink, Send, Unplug, Zap } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { PlatformBadge } from "../../components/PlatformBadge";
import { toast } from "../../components/ui/toast";
import { dayKey, parseDayKey, hhmm, atTime } from "./dates";

export const PLATFORM_ORDER = ["facebook", "tiktok", "instagram", "youtube"];

export const platformMeta = {
  facebook: { label: "Facebook", short: "FB", seriesClass: "text-series-facebook", seriesBg: "bg-series-facebook" },
  tiktok: { label: "TikTok", short: "TikTok", seriesClass: "text-series-tiktok", seriesBg: "bg-series-tiktok" },
  instagram: { label: "Instagram", short: "IG", seriesClass: "text-series-instagram", seriesBg: "bg-series-instagram" },
  youtube: { label: "YouTube", short: "YT", seriesClass: "text-series-youtube", seriesBg: "bg-series-youtube" },
};

const KIND_LABEL = { video: "Video", reel: "Reel", image: "Ảnh", carousel: "Album", text: "Bài viết" };

const INVALIDATES = ["posts.", "content.", "dashboard.", "workspaces."];

function suggestTime(day, ws) {
  const slots = [...(ws?.goldenHours ?? [])].sort((a, b) => b.weight - a.weight);
  const future = slots.find((s) => atTime(day, s.start).getTime() > Date.now() + 30 * 6e4);
  return future?.start ?? "19:30";
}

export function ScheduleDialog({ target, queue, channels, workspaces, onClose }) {
  const schedule = useApiMutation("posts.schedule", INVALIDATES);
  const reschedule = useApiMutation("posts.reschedule", INVALIDATES);
  const cancel = useApiMutation("posts.cancel", INVALIDATES);
  const publishNow = useApiMutation("posts.publishNow", INVALIDATES);
  const [channelId, setChannelId] = useState("");
  const [contentId, setContentId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:30");
  const content =
    target?.mode === "new"
      ? (queue.find((q) => q.id === contentId) ?? (target.content?.id === contentId ? target.content : null))
      : null;
  const contentWs = target?.mode === "new" ? (content?.workspaceId ?? null) : (target?.post.workspaceId ?? null);
  const ws = workspaces.find((w) => w.id === contentWs);
  const options = useMemo(
    () => channels.filter((c) => c.status === "active" && (!contentWs || c.workspaceId === contentWs)),
    [channels, contentWs],
  );
  const wsName = (id) => (id ? (workspaces.find((w) => w.id === id)?.name ?? "") : "Chưa phân Pocket");
  useEffect(() => {
    if (target?.mode === "new" && !options.some((c) => c.id === channelId)) setChannelId(options[0]?.id ?? "");
  }, [options]);
  useEffect(() => {
    if (!target) return;
    if (target.mode === "new") {
      setContentId(target.content?.id ?? "");
      setChannelId(options[0]?.id ?? "");
      setDate(dayKey(target.day));
      setTime(suggestTime(target.day, ws));
    } else {
      setDate(dayKey(target.post.scheduledAt));
      setTime(hhmm(target.post.scheduledAt));
    }
    schedule.reset();
    reschedule.reset();
  }, [target]);
  const when = date ? atTime(parseDayKey(date), time) : null;
  const past = when != null && when.getTime() < Date.now();
  const isGolden = !!ws?.goldenHours.some((s) => time >= s.start && time < s.end);
  const error = schedule.error ?? reschedule.error ?? cancel.error ?? publishNow.error;
  const editable =
    target?.mode === "new" ||
    (target?.mode === "edit" && (target.post.status === "queued" || target.post.status === "failed"));
  const submit = () => {
    if (!target || !when || past) return;
    if (target.mode === "new") {
      if (!channelId || !content) return;
      schedule.mutate(
        { contentItemId: content.id, channelId, scheduledAt: when.getTime() },
        {
          onSuccess: (p) => (
            toast.success(
              `Đã lên lịch "${content.title}"${
                new Date(p.scheduledAt).getTime() !== when.getTime()
                  ? ` lúc ${new Date(p.scheduledAt).toLocaleTimeString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })} (lùi để giãn cách với bài trùng giờ)`
                  : ""
              }`,
            ),
            onClose()
          ),
        },
      );
    } else {
      reschedule.mutate(
        { id: target.post.id, scheduledAt: when.getTime() },
        {
          onSuccess: (r) => (
            toast.success(
              r.scheduledAt !== when.getTime()
                ? `Đã dời lịch – đăng lúc ${new Date(r.scheduledAt).toLocaleTimeString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })} (lùi để giãn cách với bài trùng giờ)`
                : "Đã dời lịch bài đăng",
            ),
            onClose()
          ),
        },
      );
    }
  };
  return (
    <Dialog
      open={target != null}
      onClose={onClose}
      width={460}
      title={target?.mode === "edit" ? "Chi tiết bài đã lên lịch" : "Lên lịch bài đăng"}
      description={
        target?.mode === "new" ? (content?.title ?? "Chọn nội dung từ Kho nội dung") : target?.post.contentTitle
      }
      footer={
        <>
          {target?.mode === "edit" && editable && (
            <Button
              variant="danger"
              className="mr-auto"
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate(
                  { id: target.post.id },
                  { onSuccess: () => (toast.info("Đã hủy bài – nội dung trở lại hàng chờ"), onClose()) },
                )
              }
            >
              <Ban size={14} />
              {" Hủy bài"}
            </Button>
          )}
          <Button variant="subtle" onClick={onClose}>
            Đóng
          </Button>
          {target?.mode === "edit" && editable && (
            <Button
              variant="secondary"
              disabled={publishNow.isPending}
              onClick={() =>
                publishNow.mutate(
                  { id: target.post.id },
                  {
                    onSuccess: () => (
                      toast.info(target.post.status === "failed" ? "Đang thử đăng lại…" : "Đang đăng bài…"),
                      onClose()
                    ),
                  },
                )
              }
            >
              <Send size={14} /> {target.post.status === "failed" ? "Thử lại ngay" : "Đăng ngay"}
            </Button>
          )}
          {editable && (
            <Button
              variant="primary"
              disabled={
                !when ||
                past ||
                (target?.mode === "new" && (!channelId || !content)) ||
                schedule.isPending ||
                reschedule.isPending
              }
              onClick={submit}
            >
              {target?.mode === "edit" ? "Dời lịch" : "Lên lịch"}
            </Button>
          )}
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
        {target?.mode === "edit" ? (
          <div className="col-span-2 flex items-center gap-space-sm rounded-lg bg-surface-container-lowest p-space-sm">
            <PlatformBadge platform={target.post.platform} />
            <span className="flex-1 truncate text-label-md text-on-surface">{target.post.channelName}</span>
            <Badge
              tone={
                target.post.status === "failed" ? "danger" : target.post.status === "published" ? "success" : "warning"
              }
            >
              {target.post.status === "failed"
                ? "Lỗi"
                : target.post.status === "published"
                  ? "Đã đăng"
                  : target.post.status === "queued"
                    ? "Chờ đăng"
                    : target.post.status}
            </Badge>
          </div>
        ) : (
          <>
            <Field
              label="Nội dung"
              required={true}
              className="col-span-2"
              hint={queue.length ? `${queue.length} nội dung "Sẵn sàng đăng" trong Kho nội dung` : void 0}
            >
              {(id) => (
                <Select id={id} value={contentId} onChange={(e) => setContentId(e.target.value)}>
                  <option value="">— Chọn nội dung —</option>
                  {target?.mode === "new" && target.content && !queue.some((q) => q.id === target.content.id) && (
                    <option value={target.content.id}>
                      {KIND_LABEL[target.content.kind]}
                      {" · "}
                      {target.content.title}
                    </option>
                  )}
                  {queue.map((q) => (
                    <option key={q.id} value={q.id}>
                      {KIND_LABEL[q.kind]}
                      {" · "}
                      {q.title.slice(0, 70)}
                      {workspaces.length > 1 ? ` (${wsName(q.workspaceId)})` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Kênh đăng"
              required={true}
              className="col-span-2"
              hint={contentWs ? `Kênh thuộc Pocket "${ws?.name ?? ""}"` : void 0}
            >
              {(id) => (
                <Select id={id} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                  {options.length === 0 && <option value="">Không có kênh hoạt động</option>}
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {platformMeta[c.platform].short}
                      {" · "}
                      {c.name}
                      {c.tokenStatus === "missing"
                        ? " (chưa kết nối API)"
                        : c.tokenStatus === "expired"
                          ? " (token hết hạn)"
                          : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}
        {target?.mode === "edit" && target.post.error && (
          <p className="col-span-2 rounded-lg bg-danger/10 p-space-sm text-body-sm text-error">{target.post.error}</p>
        )}
        {target?.mode === "edit" && target.post.note && (
          <p className="col-span-2 rounded-lg bg-warning/10 p-space-sm text-body-sm text-warning">{target.post.note}</p>
        )}
        {target?.mode === "edit" && target.post.status === "published" && (
          <div className="col-span-2 flex flex-wrap items-center gap-space-sm text-body-sm text-on-surface-variant">
            {"Đã đăng "}
            {target.post.publishedAt?.toLocaleString("vi-VN")}
            {target.post.permalink?.startsWith("https://") && (
              <a
                href={target.post.permalink}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink size={12} />
                {" Xem bài"}
              </a>
            )}
            {!target.post.permalink && target.post.externalPostId && (
              <span className="font-mono text-code text-outline">
                {"ID: "}
                {target.post.externalPostId}
              </span>
            )}
          </div>
        )}
        {target?.mode === "edit" && target.post.status === "published" && (
          <div className="col-span-2 grid grid-cols-3 gap-space-sm rounded-lg bg-surface-container-lowest p-space-sm text-center">
            {[
              ["Tiếp cận", target.post.reach],
              ["Lượt xem", target.post.views],
              ["Tương tác", target.post.engagements],
            ].map(([label, v]) => (
              <div key={label}>
                <div className="font-mono text-headline-sm text-on-surface">
                  {v != null ? Number(v).toLocaleString("vi-VN") : "—"}
                </div>
                <div className="text-label-sm text-on-surface-variant">{label}</div>
              </div>
            ))}
            <div className="col-span-3 text-label-sm text-outline">
              {target.post.metricsAt
                ? `Cập nhật ${target.post.metricsAt.toLocaleString("vi-VN")}`
                : 'Chưa có số liệu – bấm "Đồng bộ số liệu" ở Tổng quan'}
            </div>
          </div>
        )}
        {editable &&
          (target?.mode === "edit" ? target.post.tokenStatus : channels.find((c) => c.id === channelId)?.tokenStatus) &&
          ["missing", "expired"].includes(
            (target?.mode === "edit"
              ? target.post.tokenStatus
              : channels.find((c) => c.id === channelId)?.tokenStatus) ?? "",
          ) && (
            <p className="col-span-2 flex items-start gap-1 rounded-lg bg-warning/10 p-space-sm text-body-sm text-warning">
              <Unplug size={14} className="mt-0.5 shrink-0" />
              {
                " Kênh chưa kết nối API hoặc token đã hết hạn – vào Tài khoản & Kênh → Kết nối API trước giờ đăng, nếu không bài sẽ lỗi."
              }
            </p>
          )}
        <Field label="Ngày">
          {(id) => (
            <Input id={id} type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
        <Field label="Giờ" error={past ? "Thời điểm đã qua" : null}>
          {(id) => (
            <Input id={id} type="time" value={time} disabled={!editable} onChange={(e) => setTime(e.target.value)} />
          )}
        </Field>
        {ws && ws.goldenHours.length > 0 && editable && (
          <div className="col-span-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-label-sm text-outline">Giờ vàng:</span>
            {ws.goldenHours.map((s) => (
              <button
                key={s.start}
                type="button"
                onClick={() => setTime(s.start)}
                className="rounded bg-surface-container px-space-sm py-0.5 font-mono text-code text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              >
                {s.start}
              </button>
            ))}
            {isGolden && (
              <Badge tone="success" className="ml-auto">
                <Zap size={11} />
                {" Trong khung giờ vàng"}
              </Badge>
            )}
          </div>
        )}
        {error && <p className="col-span-2 text-body-sm text-error">{error.message}</p>}
        <button type="submit" hidden={true} />
      </form>
    </Dialog>
  );
}
