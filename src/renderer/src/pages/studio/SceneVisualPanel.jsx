import { useState } from "react";
import { ArrowRight, ImagePlus, LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Switch";
import { pickImages, Thumb } from "./refs";

export const autoRefs = (scene, projectRefs, chars) => {
  const fromChars = chars
    .filter((c) => c.id === scene.speakerId || scene.mediaPrompt.includes(`${c.name}: `))
    .map((c) => c.image);
  return [...new Set([...fromChars, ...projectRefs])].slice(0, 3);
};

export function SceneVisualPanel({ scene, mode, projectRefs, characterRefs, onChange }) {
  const [busy, setBusy] = useState(null);
  if (mode !== "image" && mode !== "veo")
    return (
      <p className="text-label-sm text-outline">
        Ảnh tham chiếu và khung đầu/cuối dùng cho nguồn hình "Ảnh AI" hoặc "Video AI (Veo)".
      </p>
    );
  const manual = scene.sceneRefs != null;
  const chosen = manual ? scene.sceneRefs : autoRefs(scene, projectRefs, characterRefs);
  const charByImage = new Map(characterRefs.map((c) => [c.image, c.name]));
  const candidates = [...new Set([...characterRefs.map((c) => c.image), ...projectRefs, ...(scene.sceneRefs ?? [])])];
  const toggle = (p) => {
    const cur = scene.sceneRefs ?? [];
    onChange({ sceneRefs: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p].slice(0, 3) });
  };
  const pickOne = async (slot) => {
    setBusy(slot);
    const [p] = await pickImages(false);
    setBusy(null);
    if (!p) return;
    if (slot === "ref") onChange({ sceneRefs: [...(scene.sceneRefs ?? []), p].slice(0, 3) });
    else if (slot === "start") onChange({ startImage: p });
    else onChange({ endImage: p });
  };
  return (
    <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container-lowest p-space-sm">
      <div className="flex items-center justify-between gap-space-sm">
        <span className="text-label-md text-on-surface">Ảnh tham chiếu ({chosen.length}/3)</span>
        <label className="flex items-center gap-space-xs text-label-sm text-on-surface-variant">
          <Switch
            checked={!manual}
            onChange={(auto) => onChange({ sceneRefs: auto ? null : autoRefs(scene, projectRefs, characterRefs) })}
            label="Tự động"
          />
          Tự động
        </label>
      </div>
      {manual ? (
        <div className="flex flex-wrap gap-space-xs">
          {candidates.map((p) => (
            <Thumb
              key={p}
              path={p}
              size="sm"
              label={charByImage.get(p)}
              selected={chosen.includes(p)}
              onClick={() => toggle(p)}
            />
          ))}
          <button
            type="button"
            onClick={() => void pickOne("ref")}
            disabled={busy != null || chosen.length >= 3}
            className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-outline-variant text-[10px] text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-40"
          >
            {busy === "ref" ? <LoaderCircle size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            {" Ảnh riêng"}
          </button>
        </div>
      ) : chosen.length ? (
        <div className="flex flex-wrap gap-space-xs">
          {chosen.map((p) => (
            <Thumb key={p} path={p} size="sm" label={charByImage.get(p)} />
          ))}
        </div>
      ) : (
        <span className="text-label-sm text-outline">
          Chưa có – thêm ảnh tham chiếu ở Cột 1, ảnh nhân vật ở Series AI, hoặc tắt Tự động để chọn ảnh riêng.
        </span>
      )}
      <span className="text-label-sm text-outline">
        {manual ? "Bấm ảnh để chọn / bỏ (tối đa 3)." : "Tự động: nhân vật có trong cảnh + ảnh tham chiếu của dự án."}
        {" Giữ đúng khuôn mặt, sản phẩm, trang phục giữa các cảnh."}
      </span>
      {mode === "veo" && (
        <div className="mt-space-xs flex flex-col gap-space-xs border-t border-overlay/[0.06] pt-space-sm">
          <span className="text-label-md text-on-surface">Khung đầu → khung cuối (Veo)</span>
          <div className="flex items-center gap-space-sm">
            {["start", "end"].map((slot, i) => {
              const path = slot === "start" ? scene.startImage : scene.endImage;
              const disabled = slot === "end" && !scene.startImage;
              return (
                <div key={slot} className="flex items-center gap-space-sm">
                  {i === 1 && <ArrowRight size={14} className="text-outline" />}
                  {path ? (
                    <Thumb
                      path={path}
                      label={slot === "start" ? "Khung đầu" : "Khung cuối"}
                      onRemove={() =>
                        onChange(slot === "start" ? { startImage: null, endImage: null } : { endImage: null })
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={disabled || busy != null}
                      onClick={() => void pickOne(slot)}
                      className="flex h-[72px] w-[72px] flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-outline-variant text-[10px] text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-40"
                    >
                      {busy === slot ? <LoaderCircle size={14} className="animate-spin" /> : <ImagePlus size={14} />}{" "}
                      {slot === "start" ? "Khung đầu" : "Khung cuối"}
                    </button>
                  )}
                </div>
              );
            })}
            {scene.startImage && (
              <Button size="sm" variant="subtle" onClick={() => onChange({ startImage: null, endImage: null })}>
                Bỏ khung
              </Button>
            )}
          </div>
          <span className="text-label-sm text-outline">
            Khung đầu: Veo cho ảnh chuyển động từ ảnh này. Thêm khung cuối: Veo tạo chuyển cảnh mượt từ ảnh đầu tới ảnh
            cuối. Có ảnh tham chiếu hoặc khung → clip 8 giây.
          </span>
        </div>
      )}
    </div>
  );
}
