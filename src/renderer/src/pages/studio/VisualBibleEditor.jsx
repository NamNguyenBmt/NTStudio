import { useState, useRef, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { Image, LoaderCircle, Pencil, Save, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input, Textarea } from "../../components/ui/Input";
import { toast } from "../../components/ui/toast";

const toDraft = (b) => ({
  style: b.styleVi || b.style,
  characters: b.characters.map((c) => ({ name: c.name, look: c.lookVi || c.look })),
  product: b.product ? { name: b.product.name, look: b.product.lookVi || b.product.look } : null,
});

const updatedNote = (n) => (n ? ` – đã cập nhật prompt hình của ${n} cảnh` : "");

export function VisualBibleEditor({ projectId, bible, refs }) {
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(true);
  const hasRefs = refs.length > 0;
  const [english, setEnglish] = useState(false);
  const save = useApiMutation("studio.updateBible", ["studio."]);
  const fromRefs = useApiMutation("studio.bibleFromRefs", ["studio."]);
  const busy = save.isPending || fromRefs.isPending;
  const view = toDraft(bible);
  const submit = () => {
    if (!draft) return;
    save.mutate(
      { id: projectId, bible: draft },
      {
        onSuccess: (r) => {
          setDraft(null);
          toast.success(`Đã lưu bộ nhận diện${updatedNote(r.updated)}`);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };
  const readRefs = (auto = false) =>
    fromRefs.mutate(
      { id: projectId },
      {
        onSuccess: (r) =>
          toast.success(
            `${auto ? "Ảnh tham chiếu đã đổi → " : ""}Đã cập nhật bộ nhận diện theo ảnh${updatedNote(r.updated)}`,
          ),
        onError: (e) => toast.error(e.message),
      },
    );
  const refsKey = refs.join("|");
  const lastRefs = useRef(refsKey);
  useEffect(() => {
    if (refsKey === lastRefs.current) return;
    lastRefs.current = refsKey;
    if (!refsKey || draft) return;
    const t = setTimeout(() => readRefs(true), 1500);
    return () => clearTimeout(t);
  }, [refsKey]);
  const item = (label, text, en) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-outline">{label}</dt>
      <dd className="whitespace-pre-wrap text-body-sm text-on-surface">
        {english ? <span className="font-mono text-[11px]">{en}</span> : text || "—"}
      </dd>
    </div>
  );
  return (
    <details
      className="rounded-lg bg-surface-container-lowest p-space-sm text-label-sm text-on-surface-variant"
      open={open || !!draft}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-label-md text-on-surface">
        Bộ nhận diện hình ảnh (giữ nhất quán giữa các cảnh)
        {fromRefs.isPending && (
          <span className="ml-space-xs inline-flex items-center gap-1 text-label-sm text-secondary">
            <LoaderCircle size={11} className="animate-spin" />
            {" Đang tả lại theo ảnh tham chiếu…"}
          </span>
        )}
      </summary>
      {draft ? (
        <div className="mt-space-sm flex flex-col gap-space-sm">
          <label className="flex flex-col gap-1">
            <span className="text-outline">Phong cách chung</span>
            <Textarea
              value={draft.style}
              rows={2}
              maxLength={800}
              onChange={(e) => setDraft({ ...draft, style: e.target.value })}
              className="text-body-sm"
            />
          </label>
          {draft.characters.map((c, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-space-xs">
                <span className="shrink-0 text-outline">Nhân vật</span>
                <Input
                  value={c.name}
                  maxLength={60}
                  aria-label="Tên nhân vật"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      characters: draft.characters.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    })
                  }
                  className="h-7 text-label-md"
                />
              </div>
              <Textarea
                value={c.look}
                rows={3}
                maxLength={800}
                aria-label={`Ngoại hình ${c.name}`}
                placeholder="Tuổi, giới tính, gương mặt, tóc, trang phục, màu sắc…"
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    characters: draft.characters.map((x, j) => (j === i ? { ...x, look: e.target.value } : x)),
                  })
                }
                className="text-body-sm"
              />
            </div>
          ))}
          {draft.product && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-space-xs">
                <span className="shrink-0 text-outline">Sản phẩm</span>
                <Input
                  value={draft.product.name}
                  maxLength={80}
                  aria-label="Tên sản phẩm"
                  onChange={(e) => setDraft({ ...draft, product: { ...draft.product, name: e.target.value } })}
                  className="h-7 text-label-md"
                />
              </div>
              <Textarea
                value={draft.product.look}
                rows={3}
                maxLength={800}
                aria-label="Hình dáng sản phẩm"
                placeholder="Hình dáng, màu, chất liệu, nhãn / logo, chi tiết nhận diện…"
                onChange={(e) => setDraft({ ...draft, product: { ...draft.product, look: e.target.value } })}
                className="text-body-sm"
              />
            </div>
          )}
          <p className="text-outline">
            Viết bằng tiếng Việt. Khi lưu, app dịch sang tiếng Anh và cập nhật prompt hình của các cảnh đã viết.
          </p>
          <div className="flex justify-end gap-space-xs">
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => setDraft(null)}>
              <X size={12} />
              {" Hủy"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={
                busy ||
                draft.characters.some((c) => !c.name.trim() || !c.look.trim()) ||
                (!!draft.product && (!draft.product.name.trim() || !draft.product.look.trim()))
              }
              onClick={submit}
            >
              {save.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Save size={12} />}
              {" Lưu"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-space-xs flex flex-col gap-space-sm">
          <dl className="flex flex-col gap-space-xs">
            {item("Phong cách chung", view.style, bible.style)}
            {bible.characters.map((c, i) => item(`Nhân vật · ${c.name}`, view.characters[i].look, c.look))}
            {bible.product && item(`Sản phẩm · ${bible.product.name}`, view.product.look, bible.product.look)}
          </dl>
          <div className="flex flex-wrap items-center gap-space-xs">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDraft(toDraft(bible))}>
              <Pencil size={12} />
              {" Sửa"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !hasRefs}
              onClick={() => readRefs()}
              title={
                hasRefs
                  ? "App đã tự làm việc này khi sinh kịch bản và mỗi lần thêm / đổi ảnh. Bấm để AI xem ảnh và tả lại lần nữa (vd sau khi tự sửa mà muốn quay về đúng ảnh)"
                  : "Thêm ảnh tham chiếu ở trên – app sẽ tự tả nhân vật / sản phẩm theo ảnh"
              }
            >
              {fromRefs.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Image size={12} />}
              {" Tả lại theo ảnh"}
            </Button>
            <button
              type="button"
              className="ml-auto text-outline underline-offset-2 hover:underline"
              onClick={() => setEnglish((v) => !v)}
            >
              {english ? "Xem tiếng Việt" : "Xem prompt tiếng Anh"}
            </button>
          </div>
          <p className="text-outline">
            {hasRefs ? "Tự lấy theo ảnh tham chiếu (khi sinh kịch bản và mỗi lần thêm / đổi ảnh). " : ""}Mô tả này được
            chèn nguyên văn (bản tiếng Anh) vào prompt hình của mọi cảnh có nhân vật / sản phẩm.
          </p>
        </div>
      )}
    </details>
  );
}
