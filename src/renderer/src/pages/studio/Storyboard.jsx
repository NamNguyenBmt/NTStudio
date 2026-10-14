import { useState, useContext } from "react";
import { GripVertical, ImagePlus, Plus, Scale, Trash } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { IconButton } from "../../components/ui/IconButton";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Textarea } from "../../components/ui/Input";
import { CSS } from "@dnd-kit/utilities";
import { useSensor, useSensors, closestCenter, KeyboardSensor, PointerSensor, DndContext } from "@dnd-kit/core";
import { effectiveMode } from "../../../../shared/video";
import { RefsContext } from "./refs";
import { autoRefs, SceneVisualPanel } from "./SceneVisualPanel";
import {
  arrayMove,
  verticalListSortingStrategy,
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { MediaSourceField } from "./MediaSourceField";

export const WORDS_PER_SEC = 2.8;
export const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
export const fmtTime = (sec) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const labelTone = (i, n) =>
  i === 0
    ? "bg-danger/80 text-white"
    : i === n - 1
      ? "bg-success/80 text-white"
      : "bg-secondary-container text-on-secondary-container";

export function rebalance(scenes, targetSec) {
  if (!scenes.length) return scenes;
  const words = scenes.map((s) => Math.max(1, wordCount(s.voiceover)));
  const total = words.reduce((a, b) => a + b, 0);
  const minEach = 2;
  const spare = Math.max(0, targetSec - minEach * scenes.length);
  const out = scenes.map((s, i) => ({
    ...s,
    durationSec: Math.round((minEach + (spare * words[i]) / total) * 10) / 10,
  }));
  const diff = Math.round((targetSec - out.reduce((a, s) => a + s.durationSec, 0)) * 10) / 10;
  out[out.length - 1].durationSec = Math.max(minEach, Math.round((out[out.length - 1].durationSec + diff) * 10) / 10);
  return out;
}

function SceneImagesButton({ scene, index, renderMode, onChange }) {
  const [open, setOpen] = useState(false);
  const refs = useContext(RefsContext);
  const mode = effectiveMode(scene.mediaMode, renderMode);
  if (mode !== "image" && mode !== "veo") return null;
  const n =
    (scene.sceneRefs ?? autoRefs(scene, refs.projectRefs, refs.characterRefs)).length +
    (scene.startImage ? 1 : 0) +
    (scene.endImage ? 1 : 0);
  return (
    <>
      <Button
        size="sm"
        variant="subtle"
        onClick={() => setOpen(true)}
        title="Ảnh tham chiếu, khung đầu / khung cuối (Veo)"
      >
        <ImagePlus size={12} />
        {" Ảnh"}
        {n ? ` (${n})` : ""}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        title={`Ảnh cho cảnh ${index + 1}`}
        footer={
          <Button variant="primary" onClick={() => setOpen(false)}>
            Xong
          </Button>
        }
      >
        <SceneVisualPanel
          scene={scene}
          mode={mode}
          projectRefs={refs.projectRefs}
          characterRefs={refs.characterRefs}
          onChange={onChange}
        />
      </Dialog>
    </>
  );
}

function SceneCard({ scene, index, count, start, active, renderMode, narration, onChange, onRemove, onFocus }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.key });
  const words = wordCount(scene.voiceover);
  const speechSec = words / WORDS_PER_SEC;
  const tooLong = narration && speechSec > scene.durationSec + 0.3;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onFocusCapture={onFocus}
      className={cn(
        "flex flex-col gap-space-sm rounded-xl border bg-surface-container p-space-sm",
        active ? "border-primary-container/70" : "border-transparent",
        isDragging && "z-10 opacity-80 shadow-flyout",
      )}
    >
      <div className="flex items-center gap-space-sm">
        <button
          type="button"
          aria-label="Kéo để sắp xếp"
          className="cursor-grab touch-none rounded p-0.5 text-on-surface-variant hover:bg-overlay/[0.06] active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
        <Input
          value={scene.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Nhãn cảnh"
          aria-label={`Nhãn cảnh ${index + 1}`}
          className={cn("h-7 w-40 border-0 font-semibold", labelTone(index, count))}
        />
        <span className="flex-1 truncate font-mono text-code text-on-surface-variant">
          {"Cảnh "}
          {index + 1}
          {" ("}
          {fmtTime(start)}
          {" – "}
          {fmtTime(start + scene.durationSec)})
        </span>
        <label className="flex items-center gap-1 font-mono text-code text-on-surface-variant">
          <Input
            type="number"
            min={0.5}
            max={120}
            step={0.5}
            value={scene.durationSec}
            onChange={(e) => onChange({ durationSec: Math.max(0.5, Math.min(120, Number(e.target.value) || 0.5)) })}
            aria-label={`Thời lượng cảnh ${index + 1}`}
            className="h-7 w-16 text-right font-mono"
          />
          s
        </label>
        <IconButton icon={Trash} label={`Xóa cảnh ${index + 1}`} onClick={onRemove} className="hover:text-error" />
      </div>
      <div>
        <div className="mb-1 text-label-sm uppercase tracking-wider text-outline">
          {narration ? "Voiceover / Lời thoại" : "Ghi chú cảnh (không lời thoại – app không đọc, không làm phụ đề)"}
        </div>
        <Textarea
          value={scene.voiceover}
          onChange={(e) => onChange({ voiceover: e.target.value })}
          className={cn("text-body-md", narration ? "min-h-[64px]" : "min-h-[40px] text-on-surface-variant")}
          aria-label={`${narration ? "Lời thoại" : "Ghi chú"} cảnh ${index + 1}`}
        />
      </div>
      <div className="flex items-start gap-space-sm">
        <span className="mt-1 w-12 shrink-0 font-mono text-code text-outline">Prompt:</span>
        <Textarea
          value={scene.mediaPrompt}
          onChange={(e) => onChange({ mediaPrompt: e.target.value })}
          placeholder="Prompt video đầy đủ (tiếng Anh): góc máy, chuyển động, nhân vật, hành động, bối cảnh, ánh sáng, chất liệu, phong cách, âm thanh"
          className="min-h-[52px] font-mono text-code"
          aria-label={`Prompt video cảnh ${index + 1}`}
        />
      </div>
      <div className="flex items-center gap-space-sm">
        <span className="w-12 shrink-0 font-mono text-code text-outline">Stock:</span>
        <Input
          value={scene.searchQuery ?? ""}
          onChange={(e) => onChange({ searchQuery: e.target.value })}
          placeholder="3–6 từ khóa tiếng Anh tìm video stock"
          className="h-7 font-mono text-code"
          aria-label={`Từ khóa video stock cảnh ${index + 1}`}
        />
        {narration && (
          <Badge
            tone={tooLong ? "warning" : "neutral"}
            mono={true}
            title={tooLong ? "Lời thoại dài hơn thời lượng cảnh" : void 0}
          >
            {words}
            {" từ · "}
            {speechSec.toFixed(1)}s
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-space-sm">
        <span className="shrink-0 font-mono text-code text-outline">Nguồn:</span>
        <MediaSourceField scene={scene} renderMode={renderMode} compact={true} onChange={onChange} />
        <SceneImagesButton scene={scene} index={index} renderMode={renderMode} onChange={onChange} />
      </div>
    </li>
  );
}

export function Storyboard({
  scenes,
  targetSec,
  renderMode,
  narration = true,
  activeIndex,
  saveState,
  onChange,
  onFocusScene,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const total = scenes.reduce((a, s) => a + s.durationSec, 0);
  const starts = scenes.reduce((acc, _s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + scenes[i - 1].durationSec], []);
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = scenes.findIndex((s) => s.key === active.id);
    const to = scenes.findIndex((s) => s.key === over.id);
    onChange(arrayMove(scenes, from, to));
  };
  const addScene = () =>
    onChange([
      ...scenes,
      { key: crypto.randomUUID(), label: `Cảnh ${scenes.length + 1}`, voiceover: "", durationSec: 4, mediaPrompt: "" },
    ]);
  return (
    <Card className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-space-sm border-b border-overlay/[0.06] p-space-md">
        <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-label-md text-on-secondary">
            2
          </span>
          {"Phân cảnh (Script & Scene Editor)"}
        </h2>
        <div className="flex items-center gap-space-sm">
          <span
            className={cn(
              "font-mono text-code",
              saveState === "error" ? "text-error" : saveState === "saved" ? "text-tertiary" : "text-outline",
            )}
          >
            {saveState === "saving"
              ? "Đang lưu…"
              : saveState === "dirty"
                ? "Chưa lưu"
                : saveState === "error"
                  ? "Lưu lỗi"
                  : "Đã lưu"}
          </span>
          <Badge tone={Math.abs(total - targetSec) > 1 ? "warning" : "success"} mono={true}>
            {scenes.length}
            {" cảnh · "}
            {total.toFixed(1)}
            {"s / "}
            {targetSec}s
          </Badge>
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-space-md">
        {scenes.length === 0 ? (
          <p className="rounded-xl bg-surface-container p-space-lg text-center text-body-sm text-on-surface-variant">
            Chưa có phân cảnh. Thêm cảnh đầu tiên (Hook) bên dưới.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={scenes.map((s) => s.key)} strategy={verticalListSortingStrategy}>
              <ol className="flex flex-col gap-space-sm">
                {scenes.map((s, i) => (
                  <SceneCard
                    key={s.key}
                    scene={s}
                    index={i}
                    count={scenes.length}
                    start={starts[i]}
                    active={i === activeIndex}
                    renderMode={renderMode}
                    narration={narration}
                    onFocus={() => onFocusScene(i)}
                    onChange={(patch) => onChange(scenes.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                    onRemove={() => onChange(scenes.filter((_, j) => j !== i))}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <div className="grid grid-cols-2 gap-space-sm border-t border-overlay/[0.06] p-space-md">
        <Button variant="subtle" onClick={addScene} disabled={scenes.length >= 40}>
          <Plus size={14} />
          {" Thêm phân cảnh mới"}
        </Button>
        <Button
          variant="subtle"
          onClick={() => onChange(rebalance(scenes, targetSec))}
          disabled={scenes.length === 0}
          title={`Chia lại thời lượng theo số từ cho đủ ${targetSec}s`}
        >
          <Scale size={14} />
          {" Cân bằng lại thời lượng"}
        </Button>
      </div>
    </Card>
  );
}
