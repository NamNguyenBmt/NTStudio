import { createContext, useState } from "react";
import { call } from "../../lib/api";
import { Check, ImagePlus, LoaderCircle, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";

export const RefsContext = createContext({ projectRefs: [], characterRefs: [] });

export async function pickImages(multiple) {
  try {
    return (await call("media.importClips", { multiple, images: true })).map((c) => c.path);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
    return [];
  }
}

export function Thumb({
  path,
  label,
  selected,
  dim,
  onClick,
  onRemove,
  size = "md"
}) {
  return <div className={cn("group relative shrink-0", size === "sm" ? "w-14" : "w-[72px]")}>
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={label}
      className={cn(
        "block w-full overflow-hidden rounded-lg border-2 bg-surface-container-lowest",
        size === "sm" ? "h-14" : "h-[72px]",
        selected ? "border-primary" : "border-transparent",
        dim && "opacity-50",
        onClick && "hover:border-primary/60"
      )}
    >
      <img src={mediaUrl(path)} alt={label ?? ""} className="h-full w-full object-cover" />
      {selected && <span className="absolute left-1 top-1 rounded-full bg-primary p-0.5 text-on-primary">
        <Check size={10} />
      </span>}
    </button>
    {label && <span className="mt-0.5 block truncate text-center text-[10px] text-on-surface-variant">{label}</span>}
    {onRemove && <button type="button" aria-label="Gỡ ảnh" onClick={onRemove} className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block">
      <X size={10} />
    </button>}
  </div>;
}

export function ProjectRefsField({ refs, hint, onChange }) {
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const picked = await pickImages(true);
    setBusy(false);
    if (picked.length) onChange([...new Set([...refs, ...picked])].slice(0, 6));
  };
  return <div className="flex flex-col gap-space-xs">
    <div className="flex flex-wrap gap-space-xs">
      {refs.map((p) => <Thumb key={p} path={p} size="sm" onRemove={() => onChange(refs.filter((x) => x !== p))} />)}
      {refs.length < 6 && <button
        type="button"
        onClick={() => void add()}
        disabled={busy}
        className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-outline-variant text-[10px] text-on-surface-variant hover:border-primary hover:text-primary"
      >
        {busy ? <LoaderCircle size={14} className="animate-spin" /> : <ImagePlus size={14} />}
        {" Thêm"}
      </button>}
    </div>
    <span className="text-label-sm text-outline">
      {hint ?? "Sản phẩm, logo, nhân vật… AI tạo ảnh / Veo bám theo các ảnh này (tối đa 3 ảnh mỗi cảnh)."}
    </span>
  </div>;
}
