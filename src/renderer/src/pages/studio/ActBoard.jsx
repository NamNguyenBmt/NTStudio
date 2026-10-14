import { useState, useEffect, useContext, useMemo } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clapperboard, ClipboardList, Film, GripVertical, Image, ListPlus, LoaderCircle, Plus, Scale, Sparkles, Trash } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { confirmDialog } from "../../components/ui/confirm";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { CSS } from "@dnd-kit/utilities";
import { useSensor, useSensors, closestCenter, KeyboardSensor, PointerSensor, DndContext } from "@dnd-kit/core";
import { durationLabel, MEDIA_MODE_LABEL, effectiveMode, autoModeLabel } from "../../../../shared/video";
import { RefsContext } from "./refs";
import { SceneVisualPanel } from "./SceneVisualPanel";
import { arrayMove, verticalListSortingStrategy, SortableContext, useSortable, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { MediaSourceField } from "./MediaSourceField";
import { WORDS_PER_SEC, wordCount, fmtTime, rebalance } from "./Storyboard";

const ACT_COLORS = [
  "bg-primary/70",
  "bg-secondary/70",
  "bg-tertiary/70",
  "bg-warning/70",
  "bg-error/60",
  "bg-primary-container/80",
  "bg-secondary-container",
  "bg-tertiary-container"
];

const actColor = (i) => ACT_COLORS[i % ACT_COLORS.length];
const byAct = (list) => list.map((s, i) => ({ s, i })).sort((a, b) => (a.s.act ?? 0) - (b.s.act ?? 0) || a.i - b.i).map((x) => x.s);
const newScene = (act, n) => ({ key: crypto.randomUUID(), label: `Cảnh ${n}`, voiceover: "", durationSec: 6, mediaPrompt: "", act });

function SceneRow({ scene, index, start, active, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.key });
  const empty = !scene.voiceover.trim();
  return <li
    ref={setNodeRef}
    style={{ transform: CSS.Transform.toString(transform), transition }}
    className={cn(
      "group flex items-center gap-1 rounded-md pr-1 text-body-sm",
      active ? "bg-primary-container/20 text-on-surface" : "text-on-surface-variant hover:bg-surface-container-high",
      isDragging && "z-10 opacity-80 shadow-flyout"
    )}
  >
    <button
      type="button"
      aria-label="Kéo để sắp xếp"
      className="cursor-grab touch-none p-0.5 text-outline opacity-0 group-hover:opacity-100 active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical size={12} />
    </button>
    <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left">
      <span className="w-7 shrink-0 text-right font-mono text-[11px] text-outline">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate">{scene.label || scene.voiceover.slice(0, 40) || "Cảnh trống"}</span>
      {empty ? <CircleAlert size={12} className="shrink-0 text-warning" aria-label="Chưa có lời thoại" /> : scene.mediaMode === "upload" ? <Film size={12} className={cn("shrink-0", scene.mediaPath ? "text-secondary" : "text-warning")} aria-label={scene.mediaPath ? "Dùng clip của bạn" : "Chưa gắn clip"} /> : scene.mediaMode === "veo" ? <Clapperboard size={12} className="shrink-0 text-warning" aria-label="Video AI (Veo) – tính phí" /> : scene.mediaPath ? <Image size={12} className="shrink-0 text-tertiary" aria-label="Đã có hình từ lần render trước" /> : null}
      <span className="shrink-0 font-mono text-[11px] text-outline" title={`Bắt đầu ${fmtTime(start)}`}>
        {scene.durationSec}
        s
      </span>
    </button>
  </li>;
}

function ActEditor({
  act,
  index,
  sceneCount,
  totalSec,
  writing,
  busy,
  onChange,
  onWrite,
  onAddScene,
  onRebalance,
  onRemove,
  renderMode,
  onSetMode,
  onAttachClips,
  onExportPrompts
}) {
  const [bulkMode, setBulkMode] = useState("auto");
  const [d, setD] = useState(act);
  useEffect(() => setD(act), [act.title, act.summary, act.targetSec]);
  const commit = (next) => {
    if (next.title.trim() && (next.title !== act.title || next.summary !== act.summary || next.targetSec !== act.targetSec)) onChange(next);
  };
  return <div className="flex flex-col gap-space-md">
    <div className="flex items-center gap-space-sm">
      <span className={cn("h-3 w-3 rounded-full", actColor(index))} />
      <span className="text-label-md uppercase tracking-wider text-outline">{"Hồi "}{index + 1}</span>
      <Badge mono={true} tone={Math.abs(totalSec - act.targetSec) > 5 ? "warning" : "success"}>
        {sceneCount}
        {" cảnh · "}
        {Math.round(totalSec)}
        {"s / "}
        {act.targetSec}
        s
      </Badge>
    </div>
    <Field label="Tên hồi">
      {(id) => <Input id={id} value={d.title} maxLength={120} onChange={(e) => setD({ ...d, title: e.target.value })} onBlur={() => commit(d)} />}
    </Field>
    <Field label="Diễn biến / ý chính" hint="AI viết cảnh của hồi theo đoạn này – sửa rồi bấm Viết hồi này">
      {(id) => <Textarea id={id} value={d.summary} maxLength={800} onChange={(e) => setD({ ...d, summary: e.target.value })} onBlur={() => commit(d)} className="min-h-[110px]" />}
    </Field>
    <Field label="Thời lượng hồi (giây)">
      {(id) => <Input
        id={id}
        type="number"
        min={10}
        max={900}
        value={d.targetSec}
        onChange={(e) => setD({ ...d, targetSec: Math.max(10, Math.min(900, Math.round(Number(e.target.value) || 10))) })}
        onBlur={() => commit(d)}
        className="w-32 font-mono"
      />}
    </Field>
    <div className="flex flex-wrap gap-space-sm">
      <Button variant="primary" onClick={onWrite} disabled={busy} title="AI viết lại toàn bộ cảnh của hồi này theo dàn ý, nối mạch với hồi trước">
        {writing ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {" "}
        {writing ? "Đang viết hồi…" : sceneCount ? "Viết lại hồi này" : "Viết hồi này"}
      </Button>
      <Button variant="subtle" onClick={onAddScene} disabled={busy}><Plus size={14} />{" Thêm cảnh vào hồi"}</Button>
      <Button variant="subtle" onClick={onRebalance} disabled={busy || !sceneCount} title={`Chia lại thời lượng các cảnh theo số từ cho đủ ${act.targetSec}s`}>
        <Scale size={14} />
        {" Cân bằng thời lượng"}
      </Button>
      <Button variant="subtle" onClick={onRemove} disabled={busy} className="hover:text-error">
        <Trash size={14} />
        {" Xóa hồi"}
      </Button>
    </div>
    <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container-lowest p-space-sm">
      <span className="text-label-md text-on-surface">Nguồn hình cho cả hồi</span>
      <div className="flex flex-wrap items-center gap-space-sm">
        <Select aria-label="Nguồn hình cho cả hồi" value={bulkMode} onChange={(e) => setBulkMode(e.target.value)} className="w-60">
          {Object.keys(MEDIA_MODE_LABEL).filter((m) => m !== "upload").map((m) => <option key={m} value={m}>{m === "auto" ? autoModeLabel(renderMode) : MEDIA_MODE_LABEL[m]}</option>)}
        </Select>
        <Button variant="subtle" onClick={() => onSetMode(bulkMode)} disabled={busy || !sceneCount}>
          {"Áp dụng cho "}
          {sceneCount}
          {" cảnh"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-space-sm">
        <Button
          variant="subtle"
          onClick={onAttachClips}
          disabled={busy || !sceneCount}
          title="Chọn nhiều video/ảnh (vd clip tạo trong Google Flow) – gắn lần lượt theo thứ tên file vào các cảnh của hồi"
        >
          <Film size={14} />
          {" Gắn nhiều clip vào hồi…"}
        </Button>
        <Button variant="subtle" onClick={onExportPrompts} disabled={!sceneCount} title="Prompt của hồi này cho Google Vids / Flow">
          <ClipboardList size={14} />
          {" Xuất prompt hồi này"}
        </Button>
        <span className="text-label-sm text-outline">
          Mẹo: Veo cho cảnh quan trọng, ảnh AI / stock cho cảnh chuyển tiếp để tiết kiệm.
        </span>
      </div>
    </div>
  </div>;
}

function SceneEditor({
  scene,
  index,
  count,
  start,
  acts,
  onChange,
  onRemove,
  onAddAfter,
  onNav,
  renderMode
}) {
  const words = wordCount(scene.voiceover);
  const speechSec = words / WORDS_PER_SEC;
  const tooLong = speechSec > scene.durationSec + 0.3;
  const refCtx = useContext(RefsContext);
  return <div className="flex flex-col gap-space-md">
    <div className="flex items-center gap-space-sm">
      <span className="font-mono text-code text-on-surface-variant">
        {"Cảnh "}
        {index + 1}
        /
        {count}
        {" · "}
        {fmtTime(start)}
        {" – "}
        {fmtTime(start + scene.durationSec)}
      </span>
      <span className="flex-1" />
      <Button size="sm" variant="subtle" aria-label="Cảnh trước" onClick={() => onNav(-1)} disabled={index === 0}>
        <ChevronLeft size={13} />
      </Button>
      <Button size="sm" variant="subtle" aria-label="Cảnh sau" onClick={() => onNav(1)} disabled={index === count - 1}>
        <ChevronRight size={13} />
      </Button>
    </div>
    <div className="grid grid-cols-[1fr_110px_150px] gap-space-sm">
      <Field label="Nhãn cảnh">
        {(id) => <Input id={id} value={scene.label} maxLength={80} onChange={(e) => onChange({ label: e.target.value })} />}
      </Field>
      <Field label="Thời lượng (s)">
        {(id) => <Input
          id={id}
          type="number"
          min={0.5}
          max={120}
          step={0.5}
          value={scene.durationSec}
          onChange={(e) => onChange({ durationSec: Math.max(0.5, Math.min(120, Number(e.target.value) || 0.5)) })}
          className="font-mono"
        />}
      </Field>
      <Field label="Thuộc hồi">
        {(id) => <Select id={id} value={scene.act ?? 0} onChange={(e) => onChange({ act: Number(e.target.value) })}>
          {acts.map((a, i) => <option key={i} value={i}>{i + 1}{". "}{a.title}</option>)}
        </Select>}
      </Field>
    </div>
    <Field label="Lời thoại / voiceover" hint={`${words} từ · đọc ~${speechSec.toFixed(1)}s${tooLong ? " – dài hơn thời lượng cảnh (cảnh sẽ tự kéo dài khi render)" : ""}`}>
      {(id) => <Textarea id={id} value={scene.voiceover} onChange={(e) => onChange({ voiceover: e.target.value })} className="min-h-[120px] text-body-md" />}
    </Field>
    <div className="flex flex-col gap-1">
      <span className="text-label-md text-on-surface-variant">Nguồn hình</span>
      <MediaSourceField scene={scene} renderMode={renderMode} onChange={onChange} />
    </div>
    <SceneVisualPanel scene={scene} mode={effectiveMode(scene.mediaMode, renderMode)} projectRefs={refCtx.projectRefs} characterRefs={refCtx.characterRefs} onChange={onChange} />
    <Field
      label="Prompt video (đầy đủ)"
      hint="Tiếng Anh: góc máy, chuyển động máy, nhân vật / sản phẩm, hành động, bối cảnh, ánh sáng, chất liệu hình ảnh, phong cách, âm thanh. Đổi prompt → lần render sau tạo hình mới cho cảnh này"
    >
      {(id) => <Textarea id={id} value={scene.mediaPrompt} maxLength={2e3} onChange={(e) => onChange({ mediaPrompt: e.target.value })} className="min-h-[120px] font-mono text-code" />}
    </Field>
    <Field label="Từ khóa video stock" hint="3–6 từ khóa tiếng Anh mô tả hình ảnh – dùng để tìm video có sẵn khớp cảnh (chế độ Tiết kiệm)">
      {(id) => <Input id={id} value={scene.searchQuery ?? ""} maxLength={120} onChange={(e) => onChange({ searchQuery: e.target.value })} className="font-mono text-code" />}
    </Field>
    <div className="flex flex-wrap gap-space-sm">
      <Button variant="subtle" onClick={onAddAfter}><ListPlus size={14} />{" Thêm cảnh sau"}</Button>
      <Button variant="subtle" onClick={onRemove} className="hover:text-error"><Trash size={14} />{" Xóa cảnh"}</Button>
    </div>
  </div>;
}

function Timeline({
  scenes,
  acts,
  total,
  activeIndex,
  onSelect
}) {
  const minutes = Math.floor(total / 60);
  const width = Math.max(100, scenes.length * 0.9);
  const actSpans = acts.map((a, i) => {
    const secs = scenes.filter((s) => (s.act ?? 0) === i).reduce((x, s) => x + s.durationSec, 0);
    return { title: a.title, secs };
  });
  return <div className="scroll-thin overflow-x-auto border-t border-overlay/[0.06] px-space-md pb-space-sm pt-space-xs">
    <div style={{ width: `${width}%` }} className="flex min-w-full flex-col gap-0.5">
      <div className="relative h-3.5 font-mono text-[10px] text-outline">
        {total > 0 && Array.from({ length: minutes + 1 }, (_, m) => <span key={m} className={cn("absolute", m > 0 && "-translate-x-1/2")} style={{ left: `${m * 60 / total * 100}%` }}>
          {m}
          :00
        </span>)}
      </div>
      <div className="flex h-4 overflow-hidden text-[10px] text-on-surface-variant">
        {actSpans.map(
          (a, i) => a.secs > 0 ? <span key={i} className="truncate border-l border-overlay/20 px-1" style={{ width: `${a.secs / total * 100}%` }} title={a.title}>
            {i + 1}
            {". "}
            {a.title}
          </span> : null
        )}
      </div>
      <div className="flex h-8 overflow-hidden rounded-md bg-surface-container-lowest">
        {scenes.map((s, i) => <button
          key={s.key}
          type="button"
          onClick={() => onSelect(i)}
          title={`Cảnh ${i + 1} · ${s.durationSec}s · ${s.label || s.voiceover.slice(0, 60)}`}
          style={{ width: `${s.durationSec / total * 100}%` }}
          className={cn(
            "h-full min-w-[3px] border-r border-surface/60 transition-[filter]",
            actColor(s.act ?? 0),
            !s.voiceover.trim() && "opacity-40",
            i === activeIndex ? "ring-2 ring-inset ring-on-surface brightness-125" : "hover:brightness-125"
          )}
        />)}
      </div>
    </div>
  </div>;
}

export function ActBoard({
  acts,
  scenes,
  targetSec,
  activeIndex,
  saveState,
  generating,
  writingAct,
  onChange,
  onFocusScene,
  onActsChange,
  onWriteAct,
  renderMode,
  onAttachClips,
  onExportPrompts
}) {
  const [sel, setSel] = useState({ kind: "scene", index: activeIndex });
  const [collapsed, setCollapsed] = useState(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const busy = generating || writingAct != null;
  const maxAct = scenes.reduce((m, s) => Math.max(m, s.act ?? 0), -1);
  const allActs = useMemo(
    () => [...acts, ...Array.from({ length: Math.max(0, maxAct + 1 - acts.length) }, (_, i) => ({ title: `Hồi ${acts.length + i + 1}`, summary: "", targetSec: 60 }))],
    [acts, maxAct]
  );
  const total = scenes.reduce((a, s) => a + s.durationSec, 0);
  const starts = scenes.reduce((acc, _s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + scenes[i - 1].durationSec], []);
  useEffect(() => {
    if (sel.kind === "scene" && sel.index !== activeIndex && activeIndex < scenes.length) setSel({ kind: "scene", index: activeIndex });
  }, [activeIndex]);
  const selectScene = (i) => {
    setSel({ kind: "scene", index: i });
    onFocusScene(i);
  };
  const update = (list) => onChange(byAct(list));
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = scenes.findIndex((s) => s.key === active.id);
    const to = scenes.findIndex((s) => s.key === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(scenes, from, to).map((s) => s.key === active.id ? { ...s, act: scenes[to].act ?? 0 } : s);
    update(moved);
  };
  const addSceneToAct = (act) => {
    const lastIdx = scenes.reduce((m, s, i) => (s.act ?? 0) === act ? i : m, -1);
    const insertAt = lastIdx >= 0 ? lastIdx + 1 : scenes.filter((s) => (s.act ?? 0) < act).length;
    const list = [...scenes.slice(0, insertAt), newScene(act, insertAt + 1), ...scenes.slice(insertAt)];
    update(list);
    selectScene(insertAt);
  };
  const removeAct = async (act) => {
    const n = scenes.filter((s) => (s.act ?? 0) === act).length;
    if (!await confirmDialog({
      title: `Xóa hồi ${act + 1}`,
      message: n ? `Xóa hồi "${allActs[act].title}" và ${n} cảnh của hồi này?` : `Xóa hồi "${allActs[act].title}"?`,
      confirmLabel: "Xóa",
      danger: true
    }))
      return;
    onActsChange(allActs.filter((_, i) => i !== act));
    update(scenes.filter((s) => (s.act ?? 0) !== act).map((s) => (s.act ?? 0) > act ? { ...s, act: (s.act ?? 0) - 1 } : s));
    setSel({ kind: "act", act: Math.max(0, act - 1) });
  };
  const addAct = () => {
    onActsChange([...allActs, { title: `Hồi ${allActs.length + 1}`, summary: "", targetSec: 60 }]);
    setSel({ kind: "act", act: allActs.length });
  };
  const selScene = sel.kind === "scene" ? scenes[sel.index] : void 0;
  return <Card className="flex min-h-0 flex-col">
    <div className="flex items-center justify-between gap-space-sm border-b border-overlay/[0.06] p-space-md">
      <h2 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-label-md text-on-secondary">
          2
        </span>
        Kịch bản theo hồi
      </h2>
      <div className="flex items-center gap-space-sm">
        {generating && <span className="flex items-center gap-1 text-label-sm text-secondary">
          <LoaderCircle size={12} className="animate-spin" />
          {" AI đang viết"}
          {allActs.length ? ` (${allActs.filter((_, i) => scenes.some((s) => (s.act ?? 0) === i)).length}/${allActs.length} hồi)` : " dàn ý"}
          …
        </span>}
        <span className={cn("font-mono text-code", saveState === "error" ? "text-error" : saveState === "saved" ? "text-tertiary" : "text-outline")}>
          {saveState === "saving" ? "Đang lưu…" : saveState === "dirty" ? "Chưa lưu" : saveState === "error" ? "Lưu lỗi" : "Đã lưu"}
        </span>
        <Badge tone={Math.abs(total - targetSec) > targetSec * 0.05 ? "warning" : "success"} mono={true}>
          {allActs.length}
          {" hồi · "}
          {scenes.length}
          {" cảnh · "}
          {fmtTime(total)}
          {" / "}
          {durationLabel(targetSec)}
        </Badge>
      </div>
    </div>
    {allActs.length === 0 && scenes.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center gap-space-sm p-space-lg text-center text-body-sm text-on-surface-variant">
      {generating ? <><LoaderCircle size={20} className="animate-spin text-secondary" />{" AI đang viết dàn ý các hồi…"}</> : <>
        <p>
          {"Video dài được viết theo "}
          <b className="text-on-surface">hồi</b>
          : AI lập dàn ý (mở đầu → phát triển → cao trào → kết), rồi viết lần lượt từng hồi.
        </p>
        <p>{'Bấm "Sinh Kịch bản & Phân cảnh" ở cột 1, hoặc tự tạo hồi đầu tiên.'}</p>
        <Button variant="subtle" onClick={addAct}><Plus size={14} />{" Thêm hồi"}</Button>
      </>}
    </div> : <div className="grid min-h-0 flex-1 grid-cols-[250px_1fr]">
      <div className="scroll-thin flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-overlay/[0.06] p-space-sm">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={scenes.map((s) => s.key)} strategy={verticalListSortingStrategy}>
            {allActs.map((a, ai) => {
              const items = scenes.map((s, i) => ({ s, i })).filter((x) => (x.s.act ?? 0) === ai);
              const secs = items.reduce((x, y) => x + y.s.durationSec, 0);
              const open = !collapsed.has(ai);
              return <div key={ai} className="flex flex-col">
                <div
                  className={cn("flex items-center gap-1 rounded-md", sel.kind === "act" && sel.act === ai ? "bg-primary-container/20" : "hover:bg-surface-container-high")}
                >
                  <button
                    type="button"
                    aria-label={open ? "Thu gọn hồi" : "Mở hồi"}
                    onClick={() => setCollapsed((c) => c.has(ai) ? new Set([...c].filter((x) => x !== ai)) : new Set([...c, ai]))}
                    className="p-1 text-outline"
                  >
                    <ChevronDown size={13} className={cn("transition-transform", !open && "-rotate-90")} />
                  </button>
                  <button type="button" onClick={() => setSel({ kind: "act", act: ai })} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", actColor(ai))} />
                    <span className="min-w-0 flex-1 truncate text-label-md text-on-surface">{ai + 1}{". "}{a.title}</span>
                    {writingAct === ai ? <LoaderCircle size={12} className="shrink-0 animate-spin text-secondary" /> : <span className={cn("shrink-0 font-mono text-[11px]", items.length === 0 ? "text-warning" : "text-outline")}>
                      {items.length ? fmtTime(secs) : "trống"}
                    </span>}
                  </button>
                </div>
                {open && <ol className="ml-3 flex flex-col border-l border-overlay/10 pl-0.5">
                  {items.map(({ s, i }) => <SceneRow key={s.key} scene={s} index={i} start={starts[i]} active={sel.kind === "scene" && sel.index === i} onSelect={() => selectScene(i)} />)}
                </ol>}
              </div>;
            })}
          </SortableContext>
        </DndContext>
        <Button size="sm" variant="subtle" className="mt-1" onClick={addAct} disabled={busy || allActs.length >= 10}>
          <Plus size={12} />
          {" Thêm hồi"}
        </Button>
      </div>
      <div className="scroll-thin min-h-0 overflow-y-auto p-space-md">
        {sel.kind === "act" && allActs[sel.act] ? <ActEditor
          act={allActs[sel.act]}
          index={sel.act}
          sceneCount={scenes.filter((s) => (s.act ?? 0) === sel.act).length}
          totalSec={scenes.filter((s) => (s.act ?? 0) === sel.act).reduce((a, s) => a + s.durationSec, 0)}
          writing={writingAct === sel.act}
          busy={busy}
          onChange={(next) => onActsChange(allActs.map((x, i) => i === sel.act ? next : x))}
          onWrite={() => onWriteAct(sel.act)}
          onAddScene={() => addSceneToAct(sel.act)}
          onRebalance={() => {
            const act = sel.act;
            const part = rebalance(
              scenes.filter((s) => (s.act ?? 0) === act),
              allActs[act].targetSec
            );
            const byKey = new Map(part.map((s) => [s.key, s]));
            update(scenes.map((s) => byKey.get(s.key) ?? s));
          }}
          onRemove={() => void removeAct(sel.act)}
          renderMode={renderMode}
          onSetMode={(m) => update(scenes.map((s) => (s.act ?? 0) === sel.act ? { ...s, mediaMode: m } : s))}
          onAttachClips={() => onAttachClips(sel.act)}
          onExportPrompts={() => onExportPrompts(sel.act)}
        /> : selScene && sel.kind === "scene" ? <SceneEditor
          scene={selScene}
          index={sel.index}
          count={scenes.length}
          start={starts[sel.index]}
          acts={allActs}
          renderMode={renderMode}
          onChange={(patch) => {
            const list = scenes.map((x, j) => j === sel.index ? { ...x, ...patch } : x);
            if (patch.act != null && patch.act !== selScene.act) {
              const sorted = byAct(list);
              onChange(sorted);
              selectScene(sorted.findIndex((s) => s.key === selScene.key));
            } else onChange(list);
          }}
          onRemove={() => {
            update(scenes.filter((_, j) => j !== sel.index));
            selectScene(Math.max(0, Math.min(sel.index, scenes.length - 2)));
          }}
          onAddAfter={() => {
            const list = [...scenes.slice(0, sel.index + 1), newScene(selScene.act ?? 0, sel.index + 2), ...scenes.slice(sel.index + 1)];
            update(list);
            selectScene(sel.index + 1);
          }}
          onNav={(dir) => selectScene(Math.max(0, Math.min(scenes.length - 1, sel.index + dir)))}
        /> : <p className="text-body-sm text-on-surface-variant">Chọn một hồi hoặc một cảnh ở bên trái để sửa.</p>}
      </div>
    </div>}
    {scenes.length > 0 && <Timeline scenes={scenes} acts={allActs} total={total} activeIndex={sel.kind === "scene" ? sel.index : null} onSelect={selectScene} />}
  </Card>;
}
