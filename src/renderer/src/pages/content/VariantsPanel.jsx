import { useApiQuery, useApiMutation } from "../../lib/api";
import { Check, Clapperboard, FileText, Film, Image, Images, LoaderCircle, Sparkles, Trash } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { toast } from "../../components/ui/toast";
import { formatRelative } from "../../lib/format";

export const kindMeta = {
  video: {
    label: "Video",
    icon: Clapperboard,
    gradient: "from-secondary/25 via-surface-container to-primary-container/20",
  },
  reel: { label: "Reels", icon: Film, gradient: "from-primary-container/30 via-surface-container to-secondary/15" },
  image: { label: "Ảnh", icon: Image, gradient: "from-tertiary/20 via-surface-container to-secondary/10" },
  carousel: {
    label: "Carousel",
    icon: Images,
    gradient: "from-warning/20 via-surface-container to-primary-container/15",
  },
  text: {
    label: "Văn bản",
    icon: FileText,
    gradient: "from-outline/20 via-surface-container to-surface-container-high",
  },
};

export const statusMeta = {
  draft: { label: "Bản nháp", tone: "neutral" },
  ready: { label: "Sẵn sàng đăng", tone: "success" },
  scheduled: { label: "Đã lên lịch", tone: "secondary" },
  published: { label: "Đã đăng", tone: "primary" },
  failed: { label: "Đăng lỗi", tone: "danger" },
};

export const formatOf = (kind) => (kind === "video" || kind === "reel" ? "video" : kind === "text" ? "text" : "visual");

export function formatDuration(sec) {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function VariantsPanel({ item, currentCaption, onApplied }) {
  const { data: variants = [], isLoading } = useApiQuery("content.variants", { id: item.id });
  const spin = useApiMutation("content.spin", ["content.", "settings."]);
  const apply = useApiMutation("content.applyVariant", ["content."]);
  const remove = useApiMutation("content.deleteVariant", ["content."]);
  return (
    <section className="mt-space-md flex flex-col gap-space-sm border-t border-overlay/[0.06] pt-space-md">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-label-md text-on-surface">
          <Sparkles size={14} className="text-secondary" />
          {" Biến thể AI Spin "}
          <Badge mono={true}>{variants.length}</Badge>
        </h3>
        <Button
          size="sm"
          variant="subtle"
          disabled={spin.isPending}
          onClick={() =>
            spin.mutate(
              { ids: [item.id], count: 3 },
              {
                onSuccess: (r) =>
                  r.failed[0]
                    ? toast.error(r.failed[0].reason)
                    : toast.success(`Đã thêm 3 biến thể${r.meta ? ` · ${r.meta.provider}` : ""}`),
                onError: (e) => toast.error(e.message),
              },
            )
          }
        >
          {spin.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {" Sinh thêm 3 biến thể"}
        </Button>
      </div>
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-surface-container" />
      ) : variants.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Chưa có biến thể. AI sẽ viết lại caption giữ nguyên thông tin, khác câu mở đầu và lời kêu gọi.
        </p>
      ) : (
        <ul className="scroll-thin flex max-h-56 flex-col gap-space-sm overflow-y-auto">
          {variants.map((v) => {
            const current = v.caption.trim() === currentCaption.trim();
            return (
              <li key={v.id} className="rounded-lg bg-surface-container p-space-sm">
                <p className="whitespace-pre-line text-body-sm text-on-surface">{v.caption}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {v.hashtags.map((h) => (
                    <Badge key={h} tone="secondary">
                      {h}
                    </Badge>
                  ))}
                  <span className="ml-auto font-mono text-[10px] text-outline">
                    {v.model ?? ""}
                    {" · "}
                    {formatRelative(v.createdAt)}
                  </span>
                  {current ? (
                    <Badge tone="success">
                      <Check size={10} />
                      {" Đang dùng"}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={apply.isPending}
                      onClick={() =>
                        apply.mutate({ id: v.id }, { onSuccess: (c) => onApplied(c.caption ?? "", c.hashtags) })
                      }
                    >
                      Dùng
                    </Button>
                  )}
                  <IconButton
                    icon={Trash}
                    label="Xóa biến thể"
                    onClick={() => remove.mutate({ id: v.id })}
                    className="hover:text-error"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
