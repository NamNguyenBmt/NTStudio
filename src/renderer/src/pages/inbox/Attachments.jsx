import { FileText, Paperclip } from "lucide-react";
import { mediaUrl } from "../../lib/media";
import { attachmentKind } from "../../../../shared/video";
import "./thread-utils";

export function Attachments({ urls }) {
  if (!urls.length) return null;
  return <div className="mt-1 flex flex-wrap gap-1">
    {urls.map(
      (u, i) => /^https?:/.test(u) ? <a key={u} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-label-sm text-primary hover:underline">
        <Paperclip size={11} />
        {" Tệp "}
        {i + 1}
      </a> : attachmentKind(u) === "image" ? <img key={u} src={mediaUrl(u)} alt="" className="max-h-40 max-w-[220px] rounded-lg object-cover" /> : <span key={u} className="flex items-center gap-1 rounded bg-overlay/[0.06] px-1.5 py-0.5 text-label-sm">
        <FileText size={11} />
        {" "}
        {u.split("/").pop()}
      </span>
    )}
  </div>;
}
