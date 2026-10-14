import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { ArrowRight, LoaderCircle, MapPin, Sparkles, UserRound, Video } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { confirmDialog } from "../../components/ui/confirm";
import { Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { Switch } from "../../components/ui/Switch";
import { toast } from "../../components/ui/toast";
import { ASPECT_LABEL, durationLabel } from "../../../../shared/video";
import { canVietnameseSubtitle } from "../../../../shared/film";
import { StyleFields } from "../../components/film/StyleFields";
import { FILM_INV } from "./meta";
import { castOrigin, CAST_LABEL, isUnusedCast, pendingProposals } from "./cast";
import { AssetDrawer } from "./AssetDrawer";
import { ProposalPanel } from "./ProposalPanel";
import { Section, Row } from "./layout";

const LENGTHS = [30, 60, 120, 180, 300, 600, 900];

export function ScriptStep({ detail, onNext }) {
  const { film, assets } = detail;
  const update = useApiMutation("film.update", FILM_INV);
  const write = useApiMutation("film.generateScript", FILM_INV);
  const optimize = useApiMutation("film.optimizeStyle", FILM_INV);
  const save = useApiMutation("film.saveAsset", FILM_INV);
  const [idea, setIdea] = useState(film.idea);
  const [style, setStyle] = useState(film.style);
  const [open, setOpen] = useState(null);
  useEffect(() => (setIdea(film.idea), setStyle(film.style)), [film.id, film.idea, film.style]);
  const chars = assets.filter((a) => a.kind === "character");
  const locs = assets.filter((a) => a.kind === "location");
  const shots = assets.filter((a) => a.kind === "shot");
  const total = shots.reduce((s, a) => s + a.durationSec, 0);
  const nameOf = (id) => assets.find((a) => a.id === id)?.name ?? "—";
  const generate = async () => {
    if (idea !== film.idea || style !== film.style) await update.mutateAsync({ id: film.id, patch: { idea, style } });
    const hasImages = assets.some((a) => a.takes.length);
    if (
      assets.length &&
      !(await confirmDialog({
        title: "Viết lại kịch bản",
        message: detail.series
          ? `AI sẽ viết lại bối cảnh, cảnh quay và vai phụ của tập${hasImages ? " (kể cả ảnh / video đã tạo của chúng)" : ""}. Dàn nhân vật series và bảng nhân vật của họ được GIỮ NGUYÊN. Tiếp tục?`
          : `AI sẽ THAY toàn bộ nhân vật, bối cảnh và cảnh quay hiện có${hasImages ? ", kể cả các ảnh đã tạo" : ""}. Tiếp tục?`,
        danger: true,
        confirmLabel: "Viết lại",
      }))
    )
      return;
    write.mutate(
      { id: film.id },
      {
        onSuccess: (r) =>
          toast.success(
            `AI đã viết: ${r.characters} nhân vật, ${r.locations} bối cảnh, ${r.shots} cảnh quay (${r.model})${r.reusedLocations ? ` – ${r.reusedLocations} bối cảnh lấy lại từ tập trước` : ""}${r.proposals ? ` – ${r.proposals} nhân vật mới chờ bạn duyệt` : ""}`,
          ),
        onError: (e) => toast.error(e.message),
      },
    );
  };
  const add = (kind) => save.mutate({ filmId: film.id, kind, patch: {} }, { onError: (e) => toast.error(e.message) });
  return (
    <div className="grid grid-cols-1 gap-space-md xl:grid-cols-[380px_1fr]">
      <Card className="flex flex-col gap-space-md p-space-md">
        <Field label="Ý tưởng phim" hint="Cốt truyện, nhân vật, không khí, kết thúc…">
          {(id) => (
            <Textarea
              id={id}
              value={idea}
              maxLength={4e3}
              onChange={(e) => setIdea(e.target.value)}
              onBlur={() => idea !== film.idea && update.mutate({ id: film.id, patch: { idea } })}
              className="min-h-[140px]"
            />
          )}
        </Field>
        <StyleFields
          value={{
            genre: film.genre,
            visualStyle: film.visualStyle,
            dialogueLanguage: film.dialogueLanguage,
            notes: film.notes,
          }}
          onChange={(patch) => update.mutate({ id: film.id, patch }, { onError: (e) => toast.error(e.message) })}
        />
        {canVietnameseSubtitle(film.dialogueLanguage) && (
          <div className="flex flex-col gap-1 rounded-md border border-outline-variant px-space-sm py-space-sm">
            <Switch
              label="Thêm phụ đề tiếng Việt"
              checked={film.subtitleVi}
              onChange={(subtitleVi) =>
                update.mutate({ id: film.id, patch: { subtitleVi } }, { onError: (e) => toast.error(e.message) })
              }
            />
            <span className="text-label-sm text-outline">
              {"Nhân vật vẫn nói "}
              {film.dialogueLanguage}; video ghép ra có phụ đề tiếng Việt. AI dịch lời thoại từng cảnh (sửa được trong
              từng cảnh quay).
            </span>
          </div>
        )}
        <details className="rounded-md border border-outline-variant px-space-sm py-1">
          <summary className="cursor-pointer text-label-md text-on-surface-variant">
            Prompt phong cách đã tối ưu (nâng cao)
          </summary>
          <div className="flex flex-col gap-1 py-space-sm">
            <Textarea
              value={style}
              maxLength={600}
              placeholder="Tự tạo khi viết kịch bản / tạo ảnh. Để trống + không chọn gì: AI tự đề xuất"
              onChange={(e) => setStyle(e.target.value)}
              onBlur={() => style !== film.style && update.mutate({ id: film.id, patch: { style } })}
              className="min-h-[70px] font-mono text-label-sm"
            />
            <div className="flex items-center justify-between gap-space-sm">
              <span className="text-label-sm text-outline">
                Từ khóa tiếng Anh chèn vào mọi prompt ảnh / video. Sửa tay thì hệ thống giữ nguyên tới khi bạn đổi lựa
                chọn.
              </span>
              <Button
                size="sm"
                variant="subtle"
                disabled={optimize.isPending || !(film.genre || film.visualStyle || film.notes)}
                onClick={() =>
                  optimize.mutate(
                    { id: film.id },
                    {
                      onSuccess: () => toast.success("Đã tối ưu lại phong cách"),
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }
              >
                {optimize.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {" Tối ưu lại"}
              </Button>
            </div>
          </div>
        </details>
        <div className="grid grid-cols-2 gap-space-sm">
          <Field label="Thời lượng">
            {(id) => (
              <Select
                id={id}
                value={film.targetSec}
                onChange={(e) => update.mutate({ id: film.id, patch: { targetSec: Number(e.target.value) } })}
              >
                {[...new Set([...LENGTHS, film.targetSec])]
                  .sort((a, b) => a - b)
                  .map((s) => (
                    <option key={s} value={s}>
                      {durationLabel(s)}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Khung hình">
            {(id) => (
              <Select
                id={id}
                value={film.aspect}
                onChange={(e) => update.mutate({ id: film.id, patch: { aspect: e.target.value } })}
              >
                {Object.keys(ASPECT_LABEL).map((a) => (
                  <option key={a} value={a}>
                    {ASPECT_LABEL[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Button
          variant="primary"
          className="h-10"
          disabled={write.isPending || !idea.trim()}
          onClick={() => void generate()}
        >
          {write.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}{" "}
          {write.isPending ? "AI đang viết kịch bản…" : assets.length ? "AI viết lại kịch bản" : "AI viết kịch bản"}
        </Button>
        {film.logline && (
          <p className="rounded-lg bg-surface-container-lowest p-space-sm text-body-sm italic text-on-surface-variant">
            {film.logline}
          </p>
        )}
      </Card>
      <div className="flex flex-col gap-space-md">
        <ProposalPanel detail={detail} pending={pendingProposals(detail)} />
        <Section title="Nhân vật" icon={UserRound} count={chars.length} onAdd={() => add("character")}>
          {chars.map((a) => {
            const o = castOrigin(detail, a);
            const unused = isUnusedCast(detail, a);
            return (
              <Row
                key={a.id}
                onClick={() => setOpen(a)}
                title={a.name}
                sub={a.summary || a.description}
                badge={o ? CAST_LABEL[o].label : void 0}
                tone={o ? CAST_LABEL[o].tone : void 0}
                dim={unused}
                note={unused ? "không xuất hiện trong tập" : void 0}
              />
            );
          })}
        </Section>
        <Section title="Bối cảnh" icon={MapPin} count={locs.length} onAdd={() => add("location")}>
          {locs.map((a) => (
            <Row key={a.id} onClick={() => setOpen(a)} title={a.name} sub={a.summary || a.description} />
          ))}
        </Section>
        <Section
          title={`Cảnh quay · tổng ${durationLabel(total)}`}
          icon={Video}
          count={shots.length}
          onAdd={() => add("shot")}
        >
          {shots.map((a, i) => (
            <Row
              key={a.id}
              onClick={() => setOpen(a)}
              title={`${i + 1}. ${a.summary || a.description || a.name}`}
              sub={`${nameOf(a.locationId)} · ${a.characterIds.map(nameOf).join(", ") || "không nhân vật"} · ${a.camera || "—"} · ${a.durationSec}s${a.dialogue ? ` · 💬 ${a.dialogue}` : ""}`}
            />
          ))}
        </Section>
        {shots.length > 0 && (
          <Button variant="primary" className="self-end" onClick={onNext}>
            {"Tiếp: tạo ảnh nhân vật "}
            <ArrowRight size={14} />
          </Button>
        )}
      </div>
      <AssetDrawer
        asset={open ? (assets.find((a) => a.id === open.id) ?? null) : null}
        detail={detail}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
