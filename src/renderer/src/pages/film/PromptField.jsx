import { call, useApiMutation } from "../../lib/api";
import { LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Textarea } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { FILM_INV } from "./meta";

export function PromptField({ asset: a, filmId, draftSummary, manual, description, onDraft, onCommit }) {
  const refresh = useApiMutation("film.refreshPrompt", FILM_INV);
  const stale =
    !manual &&
    !a.seriesCharacterId &&
    !!draftSummary.trim() &&
    (draftSummary.trim() !== (a.descriptionSrc ?? "") || !a.description.trim());
  const updateNow = async () => {
    if (draftSummary !== a.summary)
      await call("film.saveAsset", { filmId, id: a.id, kind: a.kind, patch: { summary: draftSummary } });
    refresh.mutate(
      { filmId, id: a.id },
      {
        onSuccess: () => toast.success("Đã cập nhật prompt tiếng Anh theo mô tả tiếng Việt"),
        onError: (e) => toast.error(e.message),
      },
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Field
        label={a.kind === "shot" ? "Prompt hành động (tiếng Anh)" : "Prompt hình ảnh (tiếng Anh)"}
        hint={
          manual
            ? "Đang dùng nguyên văn prompt bạn sửa – mô tả tiếng Việt không còn được dịch lại"
            : "AI viết từ mô tả tiếng Việt – chỉ để xem"
        }
      >
        {(id) => (
          <Textarea
            id={id}
            value={description}
            maxLength={1500}
            readOnly={!manual}
            onChange={(e) => onDraft({ description: e.target.value })}
            onBlur={() => manual && onCommit()}
            className={cn(
              "min-h-[96px] font-mono text-[12px]",
              !manual && "cursor-default bg-surface-container-lowest text-on-surface-variant",
            )}
          />
        )}
      </Field>
      {stale && (
        <div className="flex items-center gap-space-sm rounded bg-warning/10 px-space-sm py-1.5 text-label-sm text-warning">
          <TriangleAlert size={13} className="shrink-0" />
          <span className="flex-1">Mô tả tiếng Việt đã đổi – AI sẽ cập nhật prompt tiếng Anh khi tạo ảnh / video.</span>
          <Button size="sm" variant="secondary" disabled={refresh.isPending} onClick={() => void updateNow()}>
            {refresh.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {" Cập nhật ngay"}
          </Button>
        </div>
      )}
      <label className="flex items-center gap-space-sm text-label-md text-on-surface-variant">
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) =>
            onCommit({ promptManual: e.target.checked, ...(e.target.checked ? {} : { description: a.description }) })
          }
          className="h-4 w-4 accent-primary-container"
        />
        Sửa prompt tiếng Anh (nâng cao)
      </label>
    </div>
  );
}
