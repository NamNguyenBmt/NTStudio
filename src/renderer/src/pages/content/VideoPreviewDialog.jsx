import { useApiMutation } from "../../lib/api";
import { createPortal } from "react-dom";
import { FolderOpen } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { mediaUrl } from "../../lib/media";
import { kindMeta, formatDuration } from "./VariantsPanel";

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv)$/i;
export const videoOf = (item) =>
  item.kind === "video" || item.kind === "reel" ? (item.mediaPaths.find((p) => VIDEO_EXT.test(p)) ?? null) : null;

export function VideoPreviewDialog({ item, file, onClose }) {
  const showInFolder = useApiMutation("media.showInFolder");
  const portrait = item.aspect === "9:16";
  return createPortal(
    <Dialog
      open={!!file}
      onClose={onClose}
      title={item.title}
      description={[kindMeta[item.kind].label, item.aspect, formatDuration(item.durationSec)]
        .filter(Boolean)
        .join(" · ")}
      width={portrait ? 440 : 860}
      footer={
        file && (
          <Button variant="subtle" onClick={() => showInFolder.mutate({ path: file })}>
            <FolderOpen size={14} />
            {" Mở thư mục"}
          </Button>
        )
      }
    >
      {file && (
        <video
          key={file}
          src={mediaUrl(file)}
          poster={item.thumbnailPath ? mediaUrl(item.thumbnailPath) : void 0}
          controls={true}
          autoPlay={true}
          playsInline={true}
          className={cn("w-full rounded-lg bg-black object-contain", portrait ? "max-h-[70vh]" : "max-h-[65vh]")}
        />
      )}
    </Dialog>,
    document.body,
  );
}
