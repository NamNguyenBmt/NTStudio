import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { Check, CircleArrowUp, LoaderCircle, Maximize2, Sparkles, Trash, TriangleAlert, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { confirmDialog } from "../../components/ui/confirm";
import { Drawer } from "../../components/ui/Drawer";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";
import { parseUpscale, upscaleLabel } from "../../../../shared/upscale";
import { useNow, expectedSeconds, queuePositions, hasActive, TakeProgress } from "../studio/SceneProgressPanel";
import { CharacterVoiceFields } from "../series/CharacterVoiceFields";
import { canVietnameseSubtitle } from "../../../../shared/film";
import { FILM_ASSET_LABEL, FILM_INV } from "./meta";
import { useGenerate } from "./hooks";
import { castOrigin, CAST_LABEL } from "./cast";
import { SeriesLocationPicker } from "./SeriesLocationPicker";
import { canUpscale, useFilmUpscale } from "./useFilmUpscale";
import { PromptField } from "./PromptField";

export function AssetDrawer({ asset, detail, mode = "image", onClose }) {
  const video = mode === "video";
  const save = useApiMutation("film.saveAsset", FILM_INV);
  const del = useApiMutation("film.deleteAsset", FILM_INV);
  const select = useApiMutation("film.selectTake", FILM_INV);
  const delTake = useApiMutation("film.deleteTake", FILM_INV);
  const cancel = useApiMutation("film.cancel", FILM_INV);
  const promote = useApiMutation("film.promoteToSeries", ["series."]);
  const { run, pending } = useGenerate(detail.film.id);
  const now = useNow(!!asset && hasActive(detail));
  const expected = expectedSeconds(detail, mode);
  const positions = queuePositions(detail, mode);
  const [draft, setDraft] = useState({});
  const [zoom, setZoom] = useState(null);
  const upscale = useFilmUpscale();
  useEffect(() => setDraft({}), [asset?.id]);
  const a = asset;
  const takes = a ? a.takes.filter((t) => t.kind === mode) : [];
  const selectedId = video ? a?.selectedVideoTakeId : a?.selectedTakeId;
  const v = (k) => (k in draft ? draft[k] : a?.[k]);
  const set = (p) => setDraft((d) => ({ ...d, ...p }));
  const commit = (p = draft) => {
    if (!a) return;
    const changed = Object.fromEntries(
      Object.entries(p).filter(([k, val]) => JSON.stringify(val) !== JSON.stringify(a[k])),
    );
    if (!Object.keys(changed).length) return;
    if ("name" in changed && !String(changed.name).trim()) return;
    save.mutate(
      { filmId: detail.film.id, id: a.id, kind: a.kind, patch: changed },
      { onError: (e) => toast.error(e.message) },
    );
  };
  const chars = detail.assets.filter((x) => x.kind === "character");
  const locs = detail.assets.filter((x) => x.kind === "location");
  const remove = async () => {
    if (!a) return;
    if (
      !(await confirmDialog({
        title: `Xóa ${FILM_ASSET_LABEL[a.kind].toLowerCase()}`,
        message: `Xóa "${a.name}" cùng các ảnh đã tạo?`,
        danger: true,
        confirmLabel: "Xóa",
      }))
    )
      return;
    del.mutate({ id: a.id }, { onSuccess: onClose });
  };
  return (
    <Drawer
      open={!!a}
      onClose={() => (commit(), onClose())}
      title={a ? `${FILM_ASSET_LABEL[a.kind]}: ${a.name}` : ""}
      width={560}
    >
      {a && (
        <div className="flex flex-col gap-space-md">
          <Field label="Tên">
            {(id) => (
              <Input
                id={id}
                value={v("name") ?? ""}
                maxLength={80}
                onChange={(e) => set({ name: e.target.value })}
                onBlur={() => commit()}
              />
            )}
          </Field>
          <Field
            label={
              a.seriesCharacterId
                ? "Vai trò (tiếng Việt)"
                : a.kind === "shot"
                  ? "Diễn biến trong khung hình (tiếng Việt)"
                  : "Mô tả (tiếng Việt)"
            }
            hint={
              a.seriesCharacterId
                ? "Ngoại hình lấy từ nhân vật của series – sửa mô tả ở Series AI"
                : a.kind === "character"
                  ? "Ngoại hình cố định: tuổi, khuôn mặt, tóc, vóc dáng, trang phục, màu sắc"
                  : a.kind === "location"
                    ? "Không gian, đồ vật, thời điểm, ánh sáng – không có người"
                    : "Ai làm gì, biểu cảm, vị trí trong khung hình"
            }
          >
            {(id) => (
              <Textarea
                id={id}
                value={v("summary") ?? ""}
                maxLength={600}
                onChange={(e) => set({ summary: e.target.value })}
                onBlur={() => commit()}
                className="min-h-[72px]"
              />
            )}
          </Field>
          {a.kind === "location" && detail.film.seriesId && (
            <div className="-mt-space-xs flex flex-wrap items-center gap-space-sm">
              <SeriesLocationPicker filmId={detail.film.id} assetId={a.id} name={a.name} />
            </div>
          )}
          <PromptField
            asset={a}
            filmId={detail.film.id}
            draftSummary={v("summary") ?? ""}
            manual={v("promptManual") ?? false}
            description={v("description") ?? ""}
            onDraft={set}
            onCommit={commit}
          />
          {a.kind === "character" && (
            <CharacterVoiceFields
              value={{
                voiceProfile: v("voiceProfile") ?? null,
                voiceProvider: v("voiceProvider") ?? null,
                voiceId: v("voiceId") ?? null,
              }}
              workspaceId={detail.film.workspaceId}
              onChange={(p) => commit({ ...p })}
            />
          )}
          {a.kind === "character" && a.seriesCharacterId && (
            <p className="-mt-space-sm text-label-sm text-outline">
              Nhân vật của series: đổi giọng ở đây áp dụng cho mọi tập.
            </p>
          )}
          {a.kind === "shot" && (
            <>
              <div className="grid grid-cols-[1fr_96px] gap-space-sm">
                <Field label="Bối cảnh">
                  {(id) => (
                    <Select
                      id={id}
                      value={v("locationId") ?? ""}
                      onChange={(e) => commit({ locationId: e.target.value || null })}
                    >
                      <option value="">— Không —</option>
                      {locs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Thời lượng">
                  {(id) => (
                    <Select
                      id={id}
                      value={v("durationSec") ?? 6}
                      onChange={(e) => commit({ durationSec: Number(e.target.value) })}
                    >
                      {[4, 5, 6, 8, 10, 12, 15].map((s) => (
                        <option key={s} value={s}>
                          {s}
                          {" giây"}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-label-md text-on-surface-variant">Nhân vật trong khung hình (tối đa 6)</span>
                <div className="flex flex-wrap gap-1">
                  {chars.map((c) => {
                    const on = (v("characterIds") ?? []).includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          const cur = v("characterIds") ?? [];
                          commit({ characterIds: on ? cur.filter((x) => x !== c.id) : [...cur, c.id].slice(0, 6) });
                        }}
                        className={cn(
                          "rounded-full border px-space-sm py-0.5 text-label-sm",
                          on
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-overlay/[0.12] text-on-surface-variant hover:bg-surface-container-high",
                        )}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                  {!chars.length && <span className="text-label-sm text-outline">Chưa có nhân vật</span>}
                </div>
              </div>
              <Field
                label="Máy quay (tiếng Anh)"
                hint={'Cỡ cảnh + góc + chuyển động, vd "medium close-up, low angle, slow dolly in"'}
              >
                {(id) => (
                  <Input
                    id={id}
                    value={v("camera") ?? ""}
                    maxLength={300}
                    onChange={(e) => set({ camera: e.target.value })}
                    onBlur={() => commit()}
                  />
                )}
              </Field>
              <Field label="Lời thoại" hint={'Ghi "Tên: lời" – dùng ở bước video / lồng tiếng'}>
                {(id) => (
                  <Textarea
                    id={id}
                    value={v("dialogue") ?? ""}
                    maxLength={800}
                    onChange={(e) => set({ dialogue: e.target.value || null })}
                    onBlur={() => commit()}
                    className="min-h-[56px]"
                  />
                )}
              </Field>
              {detail.film.subtitleVi && canVietnameseSubtitle(detail.film.dialogueLanguage) && (
                <Field
                  label="Phụ đề tiếng Việt"
                  hint={
                    a.subtitle?.trim() && a.subtitleSrc !== (a.dialogue?.trim() ?? null)
                      ? "Lời thoại đã sửa sau khi dịch – khi ghép tập AI sẽ dịch lại (sửa ô này để giữ bản của bạn)"
                      : "Hiện khi ghép tập · để trống: AI tự dịch từ lời thoại"
                  }
                >
                  {(id) => (
                    <Textarea
                      id={id}
                      value={v("subtitle") ?? ""}
                      maxLength={800}
                      placeholder="AI tự dịch khi ghép tập"
                      onChange={(e) => set({ subtitle: e.target.value || null })}
                      onBlur={() => commit()}
                      className="min-h-[56px]"
                    />
                  )}
                </Field>
              )}
            </>
          )}
          <div className="flex flex-col gap-space-sm border-t border-overlay/[0.06] pt-space-md">
            <div className="flex items-center justify-between gap-space-sm">
              <span className="text-label-md text-on-surface">
                {video ? "Video" : "Bản tạo"}
                {" ("}
                {takes.filter((t) => t.status === "done").length})
              </span>
              <div className="flex gap-space-sm">
                {takes.some((t) => t.status === "queued" || t.status === "running") && (
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() =>
                      cancel.mutate({
                        filmId: detail.film.id,
                        takeIds: takes.filter((t) => t.status === "queued" || t.status === "running").map((t) => t.id),
                      })
                    }
                  >
                    <X size={12} />
                    {" Hủy đang chờ"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() => (commit(), void run([a.id], void 0, mode))}
                >
                  <Sparkles size={12} /> {video ? "Tạo 1 video" : `Tạo ${detail.film.takesPerRun} bản`}
                </Button>
              </div>
            </div>
            {takes.length === 0 ? (
              <p className="text-body-sm text-outline">
                {video ? "Chưa có video – khung hình đã chọn sẽ là khung đầu của clip." : "Chưa có bản nào."}
              </p>
            ) : (
              <div
                className={cn(
                  "grid gap-space-sm",
                  a.kind !== "character" && detail.film.aspect === "9:16" ? "grid-cols-3" : "grid-cols-2",
                )}
              >
                {takes
                  .filter((t) => t.status !== "cancelled")
                  .map((t) => {
                    const chosen = t.id === selectedId;
                    const up = parseUpscale(t.upscale);
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          "group relative overflow-hidden rounded-lg border bg-surface-container-lowest",
                          chosen ? "border-tertiary ring-2 ring-tertiary/40" : "border-overlay/[0.08]",
                        )}
                      >
                        <div
                          className={cn(
                            "relative w-full",
                            a.kind === "character" || detail.film.aspect === "16:9"
                              ? "aspect-video"
                              : detail.film.aspect === "1:1"
                                ? "aspect-square"
                                : "aspect-[9/16]",
                          )}
                        >
                          {t.status === "done" && t.file ? (
                            video ? (
                              <video
                                src={mediaUrl(t.file)}
                                controls={true}
                                playsInline={true}
                                preload="metadata"
                                className="h-full w-full bg-black object-contain"
                              />
                            ) : (
                              <img src={mediaUrl(t.file)} alt="" className="h-full w-full object-cover" />
                            )
                          ) : (
                            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-space-sm text-center text-label-sm text-on-surface-variant">
                              {t.status === "failed" ? (
                                <>
                                  <TriangleAlert size={16} className="text-error" />
                                  <span className="line-clamp-4 text-error" title={t.error ?? void 0}>
                                    {t.error ?? "Lỗi"}
                                  </span>
                                </>
                              ) : (
                                <LoaderCircle
                                  size={20}
                                  className={cn("text-secondary", t.status === "running" && "animate-spin")}
                                />
                              )}
                            </span>
                          )}
                          {(t.status === "running" || t.status === "queued") && (
                            <span className="absolute inset-x-0 bottom-0 text-left">
                              <TakeProgress take={t} expectedSec={expected} position={positions.get(t.id)} now={now} />
                            </span>
                          )}
                          {(chosen || up) && (
                            <span className="absolute left-1 top-1 flex flex-wrap items-center gap-1">
                              {chosen && (
                                <span className="flex items-center gap-1 rounded bg-tertiary px-1.5 py-0.5 text-[11px] font-semibold text-on-tertiary shadow">
                                  <Check size={10} />
                                  {" Đã chọn"}
                                </span>
                              )}
                              {up && (
                                <span
                                  className="flex items-center gap-1 rounded bg-primary-container px-1.5 py-0.5 text-[11px] font-semibold text-on-primary-container shadow"
                                  title={
                                    up.method === "flow"
                                      ? "Nâng cấp bằng Google Flow (AI)"
                                      : "Nâng cấp trên máy (FFmpeg)"
                                  }
                                >
                                  <CircleArrowUp size={10} /> {upscaleLabel(up.quality)}
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        {video && canUpscale(t) && (
                          <div className="flex justify-end p-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="w-full justify-center"
                              onClick={() => upscale.open([t])}
                              title="Nâng cấp chất lượng video (1080p / 4K)"
                            >
                              <CircleArrowUp size={12} />
                              {" Nâng cấp"}
                            </Button>
                          </div>
                        )}
                        <div
                          className={cn(
                            "absolute inset-x-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100",
                            video ? "top-1" : "bottom-1",
                          )}
                        >
                          {t.status === "done" && (
                            <>
                              {!video && (
                                <Button size="sm" variant="secondary" aria-label="Xem lớn" onClick={() => setZoom(t)}>
                                  <Maximize2 size={11} />
                                </Button>
                              )}
                              {!chosen && (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => select.mutate({ assetId: a.id, takeId: t.id })}
                                >
                                  <Check size={11} />
                                  {" Chọn"}
                                </Button>
                              )}
                            </>
                          )}
                          {t.status !== "running" && t.status !== "queued" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label="Xóa bản này"
                              onClick={() => delTake.mutate({ id: t.id })}
                            >
                              <Trash size={11} />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
          {!video && a.kind === "character" && castOrigin(detail, a) && (
            <div className="flex flex-col gap-1 rounded-lg bg-surface-container-lowest p-space-sm text-label-sm text-on-surface-variant">
              <span>
                {"Nguồn: "}
                <strong className="text-on-surface">{CAST_LABEL[castOrigin(detail, a)].label}</strong>
                {" – "}
                {CAST_LABEL[castOrigin(detail, a)].title}
              </span>
              {a.seriesCharacterId && (
                <Button
                  size="sm"
                  variant="subtle"
                  className="self-start"
                  disabled={promote.isPending || !takes.some((t) => t.id === a.selectedTakeId && t.status === "done")}
                  title="Bảng nhân vật đã chọn ở tập này trở thành ảnh chuẩn của series – các tập SAU dùng ảnh này (tập đã làm giữ nguyên)"
                  onClick={() =>
                    promote.mutate(
                      { assetId: a.id },
                      {
                        onSuccess: () =>
                          toast.success(`Đã đặt làm ảnh chuẩn của ${a.name} cho series – áp dụng cho các tập sau`),
                        onError: (e) => toast.error(e.message),
                      },
                    )
                  }
                >
                  {promote.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}
                  {" Dùng làm ảnh chuẩn của series"}
                </Button>
              )}
            </div>
          )}
          <Button size="sm" variant="subtle" className="self-start" onClick={() => void remove()}>
            <Trash size={12} />
            {" Xóa "}
            {FILM_ASSET_LABEL[a.kind].toLowerCase()}
          </Button>
        </div>
      )}
      {upscale.dialog}
      <Dialog open={!!zoom} onClose={() => setZoom(null)} title={a?.name ?? ""} width={1100}>
        {zoom?.file && (
          <div className="flex flex-col gap-space-sm">
            <img src={mediaUrl(zoom.file)} alt="" className="max-h-[70vh] w-full rounded-lg object-contain" />
            <details className="text-label-sm text-on-surface-variant">
              <summary className="cursor-pointer">
                {"Prompt đã dùng · "}
                {zoom.model}
              </summary>
              <p className="mt-1 select-text whitespace-pre-wrap font-mono text-[11px]">{zoom.prompt}</p>
            </details>
          </div>
        )}
      </Dialog>
    </Drawer>
  );
}
