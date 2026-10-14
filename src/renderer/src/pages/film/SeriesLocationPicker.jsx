import { useState } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { LoaderCircle, RotateCcwClock } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Switch } from "../../components/ui/Switch";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";
import { FILM_INV } from "./meta";

export function SeriesLocationPicker({ filmId, assetId, name }) {
  const [open, setOpen] = useState(false);
  const [copyText, setCopyText] = useState(true);
  const { data: lib = [] } = useApiQuery("film.seriesLocations", { filmId }, { staleTime: 3e4 });
  const adopt = useApiMutation("film.adoptLocation", FILM_INV);
  if (!lib.length) return null;
  const pick = (sourceAssetId, label) =>
    adopt.mutate(
      { filmId, assetId, sourceAssetId, copyText },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(
            `"${name}" dùng bối cảnh "${label}"${copyText ? " (ảnh + mô tả)" : " (ảnh)"} – tạo lại khung hình các cảnh quay ở đây để áp dụng`,
          );
        },
        onError: (e) => toast.error(e.message),
      },
    );
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        title="Dùng ảnh bối cảnh đã làm ở tập khác của series (giữ bối cảnh giống nhau giữa các tập)"
      >
        <RotateCcwClock size={12} />
        {" Lấy bối cảnh từ tập khác ("}
        {lib.length})
      </Button>
      <Dialog
        open={open}
        onClose={() => !adopt.isPending && setOpen(false)}
        width={720}
        title={`Bối cảnh cho "${name}"`}
        description="Chọn bối cảnh đã làm ở tập khác của series. Ảnh được chép thành bản đã chọn của bối cảnh này (không tốn phí)."
        footer={
          <Button variant="subtle" onClick={() => setOpen(false)} disabled={adopt.isPending}>
            Đóng
          </Button>
        }
      >
        <div className="flex flex-col gap-space-md">
          <label className="flex items-center gap-space-sm text-body-sm text-on-surface-variant">
            <Switch checked={copyText} onChange={setCopyText} label="Lấy cả mô tả" />
            Lấy cả mô tả / prompt của bối cảnh đó (khuyên dùng – các cảnh quay vẽ đúng không gian)
          </label>
          <div className="grid max-h-[56vh] grid-cols-2 gap-space-sm overflow-y-auto pr-1 sm:grid-cols-3">
            {lib.map((l) => (
              <button
                key={l.assetId}
                type="button"
                disabled={adopt.isPending}
                onClick={() => pick(l.assetId, l.name)}
                className={cn(
                  "group flex flex-col overflow-hidden rounded-xl border border-overlay/[0.1] bg-surface-container-lowest text-left transition-colors hover:border-primary disabled:opacity-60",
                )}
              >
                <div className="relative aspect-video w-full bg-black">
                  <img src={mediaUrl(l.image)} alt={l.name} className="h-full w-full object-cover" loading="lazy" />
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {"Tập "}
                    {l.episode}
                  </span>
                  {adopt.isPending && adopt.variables?.sourceAssetId === l.assetId && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <LoaderCircle size={20} className="animate-spin text-white" />
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 p-space-xs">
                  <span className="truncate text-label-md text-on-surface">{l.name}</span>
                  <span className="line-clamp-2 text-label-sm text-on-surface-variant">{l.summary}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </Dialog>
    </>
  );
}
