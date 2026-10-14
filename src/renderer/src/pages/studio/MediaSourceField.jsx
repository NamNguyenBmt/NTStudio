import { useState } from "react";
import { call, useApiQuery } from "../../lib/api";
import { CircleArrowUp, Film, FolderOpen, Image, LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Input";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";
import { MEDIA_MODE_LABEL, clipKind, autoModeLabel } from "../../../../shared/video";
import { upscaleLabel } from "../../../../shared/upscale";
import { UpscaleDialog } from "./UpscaleDialog";

const MODES = Object.keys(MEDIA_MODE_LABEL);

export async function pickClips(multiple) {
  try {
    return await call("media.importClips", { multiple });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
    return [];
  }
}

export function MediaSourceField({ scene, renderMode, compact, onChange }) {
  const [busy, setBusy] = useState(false);
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const mode = scene.mediaMode ?? "auto";
  const upload = mode === "upload";
  const kind = scene.mediaPath ? clipKind(scene.mediaPath) : null;
  const { data: upStatus } = useApiQuery(
    "media.upscaleProgress",
    { path: scene.mediaPath ?? "" },
    { enabled: upscaling && !!scene.mediaPath, refetchInterval: 1e3 },
  );
  const runUpscale = async (quality, method) => {
    if (!scene.mediaPath) return;
    setUpscaling(true);
    try {
      const r = await call("media.upscale", { path: scene.mediaPath, quality, method });
      onChange({ mediaMode: "upload", mediaPath: r.path });
      setUpscaleOpen(false);
      toast.success(`Đã nâng cấp ${upscaleLabel(quality)} – cảnh dùng bản nâng cấp ở lần render sau`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUpscaling(false);
    }
  };
  const upscaleButton = kind === "video" && (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => setUpscaleOpen(true)}
      title="Nâng cấp chất lượng clip của cảnh (1080p / 4K)"
    >
      <CircleArrowUp size={12} />
      {" Nâng cấp"}
    </Button>
  );
  const choose = async () => {
    setBusy(true);
    const [clip] = await pickClips(false);
    setBusy(false);
    if (clip) onChange({ mediaMode: "upload", mediaPath: clip.path });
  };
  return (
    <div className={cn("flex flex-col gap-space-xs", compact && "flex-row items-center")}>
      <div className="flex items-center gap-space-sm">
        <Select
          aria-label="Nguồn hình của cảnh"
          value={mode}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "upload" && !scene.mediaPath) void choose();
            else onChange({ mediaMode: next });
          }}
          className={cn(compact ? "h-7 w-44 text-label-sm" : "w-60")}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m === "auto" ? autoModeLabel(renderMode) : MEDIA_MODE_LABEL[m]}
            </option>
          ))}
        </Select>
        {upload && (
          <Button
            size="sm"
            variant="subtle"
            onClick={() => void choose()}
            disabled={busy}
            title="Chọn video / ảnh từ máy (vd clip tạo trong Google Flow)"
          >
            {busy ? <LoaderCircle size={12} className="animate-spin" /> : <FolderOpen size={12} />}{" "}
            {scene.mediaPath ? "Đổi file" : "Chọn file"}
          </Button>
        )}
        {(compact || !upload) && upscaleButton}
      </div>
      {upload && scene.mediaPath && !compact && (
        <div className="flex items-center gap-space-sm rounded-lg bg-surface-container-lowest p-space-xs">
          {kind === "video" ? (
            <video src={mediaUrl(scene.mediaPath)} className="h-16 rounded bg-black" muted={true} preload="metadata" />
          ) : (
            <img src={mediaUrl(scene.mediaPath)} alt="" className="h-16 rounded object-cover" />
          )}
          <span className="flex min-w-0 items-center gap-1 text-label-sm text-on-surface-variant">
            {kind === "video" ? <Film size={12} /> : <Image size={12} />}
            <span className="truncate">
              {kind === "video"
                ? "Clip của bạn – tự cắt/lặp cho khớp thời lượng cảnh"
                : "Ảnh của bạn – thêm hiệu ứng zoom chuyển động"}
            </span>
          </span>
          <span className="ml-auto shrink-0">{upscaleButton}</span>
        </div>
      )}
      {upload && !scene.mediaPath && (
        <span className="text-label-sm text-warning">Chưa gắn file – khi render sẽ tìm hình theo dự án</span>
      )}
      <UpscaleDialog
        path={upscaleOpen ? (scene.mediaPath ?? null) : null}
        onClose={() => setUpscaleOpen(false)}
        onSubmit={(q, m) => void runUpscale(q, m)}
        busy={upscaling}
        status={upStatus}
        onCancel={() => scene.mediaPath && void call("media.cancelUpscale", { path: scene.mediaPath })}
      />
    </div>
  );
}
