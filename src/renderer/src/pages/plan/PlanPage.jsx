import { useState, useEffect, useMemo } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Clapperboard, FileText, Lightbulb, LoaderCircle, Pencil, Plus, Sparkles, Trash, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { confirmDialog } from "../../components/ui/confirm";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { CONTENT_FORMATS, CUSTOM_FORMAT_MAX, customFormatId, isCustomFormat, formatById } from "../../../../shared/content-formats";

const INV = ["plan.", "studio.", "content."];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayLabel = (s) => (new Date(`${s}T00:00:00`)).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });

const statusMeta = {
  idea: { label: "Ý tưởng", tone: "neutral" },
  in_progress: { label: "Đang làm", tone: "secondary" },
  done: { label: "Xong", tone: "success" },
  dropped: { label: "Bỏ", tone: "neutral" }
};

const CUSTOM_KEY = "omni-plan-custom-formats";

const loadCustom = () => {
  try {
    const v = JSON.parse(window.localStorage.getItem(CUSTOM_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && isCustomFormat(x)).slice(0, 30) : [];
  } catch {
    return [];
  }
};

const storeCustom = (list) => {
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
  }
};

function CustomFormatInput({ onAdd, onCancel }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("video");
  const add = () => {
    if (!label.trim()) return;
    onAdd(customFormatId(label, kind));
    setLabel("");
  };
  return <div className="flex flex-wrap items-center gap-1">
    <Input
      autoFocus={true}
      aria-label="Tên định dạng"
      value={label}
      maxLength={CUSTOM_FORMAT_MAX}
      placeholder="VD: Review phim, Mẹo vặt, Hậu trường…"
      onChange={(e) => setLabel(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          add();
        } else if (e.key === "Escape") onCancel?.();
      }}
      className="h-8 w-56"
    />
    <Select aria-label="Loại" value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-28">
      <option value="video">Video</option>
      <option value="post">Bài viết</option>
    </Select>
    <Button size="sm" variant="primary" disabled={!label.trim()} onClick={add}>Thêm</Button>
    {onCancel && <Button size="sm" variant="subtle" onClick={onCancel}>Hủy</Button>}
  </div>;
}

function IdeaDialog({
  target,
  workspaceId,
  customFormats,
  onAddCustom,
  onClose
}) {
  const save = useApiMutation("plan.save", INV);
  const idea = target && "id" in target ? target : null;
  const [f, setF] = useState({ plannedDate: "", title: "", format: "free", hook: "", description: "" });
  const [typing, setTyping] = useState(false);
  const options = [...CONTENT_FORMATS, ...[...new Set([...customFormats, ...isCustomFormat(f.format) ? [f.format] : []])].map(formatById)];
  useEffect(() => {
    if (!target) return;
    setTyping(false);
    setF({
      plannedDate: idea?.plannedDate ?? ("date" in target ? target.date : ""),
      title: idea?.title ?? "",
      format: idea?.format ?? "free",
      hook: idea?.hook ?? "",
      description: idea?.description ?? ""
    });
  }, [target]);
  const submit = () => {
    if (!f.title.trim()) return;
    save.mutate(
      { id: idea?.id, workspaceId: idea ? idea.workspaceId : workspaceId, plannedDate: f.plannedDate || null, title: f.title, format: f.format, hook: f.hook || null, description: f.description || null },
      { onSuccess: onClose }
    );
  };
  return <Dialog
    open={target != null}
    onClose={onClose}
    width={520}
    title={idea ? "Sửa ý tưởng" : "Thêm ý tưởng"}
    footer={<>
      <Button variant="subtle" onClick={onClose}>Hủy</Button>
      <Button variant="primary" disabled={!f.title.trim() || save.isPending} onClick={submit}>Lưu</Button>
    </>}
  >
    <div className="grid grid-cols-2 gap-space-md">
      <Field label="Tiêu đề" required={true} className="col-span-2">
        {(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} />}
      </Field>
      <Field label="Ngày dự kiến">
        {(id) => <Input id={id} type="date" value={f.plannedDate} onChange={(e) => setF({ ...f, plannedDate: e.target.value })} />}
      </Field>
      <Field label="Định dạng">
        {(id) => <Select
          id={id}
          value={f.format}
          onChange={(e) => {
            if (e.target.value === "__custom") return setTyping(true);
            setTyping(false);
            setF({ ...f, format: e.target.value });
          }}
        >
          {options.map((x) => <option key={x.id} value={x.id}>
            {x.label}
            {isCustomFormat(x.id) ? x.kind === "post" ? " (tự nhập · bài viết)" : " (tự nhập)" : ""}
          </option>)}
          <option value="__custom">+ Tự nhập định dạng…</option>
        </Select>}
      </Field>
      {typing && <div className="col-span-2">
        <CustomFormatInput
          onAdd={(fid) => {
            onAddCustom(fid);
            setF({ ...f, format: fid });
            setTyping(false);
          }}
          onCancel={() => setTyping(false)}
        />
      </div>}
      <Field label="Câu mở đầu (hook)" className="col-span-2" hint="Câu giữ chân người xem trong 3 giây đầu">
        {(id) => <Input id={id} value={f.hook} onChange={(e) => setF({ ...f, hook: e.target.value })} maxLength={300} />}
      </Field>
      <Field label="Nội dung chính" className="col-span-2">
        {(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1e3} />}
      </Field>
      {save.error && <p className="col-span-2 text-body-sm text-error">{save.error.message}</p>}
    </div>
  </Dialog>;
}

export function PlanPage() {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: workspaces = [] } = useApiQuery("workspaces.list");
  const [start, setStart] = useState(() => new Date());
  const from = iso(start);
  const to = iso(addDays(start, 13));
  const { data: ideas = [] } = useApiQuery("plan.list", { workspaceId, from, to });
  const generate = useApiMutation("plan.generate", INV);
  const toVideo = useApiMutation("plan.toVideo", INV);
  const toPost = useApiMutation("plan.toPost", INV);
  const del = useApiMutation("plan.delete", INV);
  const save = useApiMutation("plan.save", INV);
  const [days, setDays] = useState(7);
  const [perDay, setPerDay] = useState(1);
  const [formats, setFormats] = useState(["top_list", "story", "quiz", "explainer"]);
  const [customFormats, setCustomFormats] = useState(loadCustom);
  const [addingFormat, setAddingFormat] = useState(false);
  const [useTrends, setUseTrends] = useState(true);
  const [editing, setEditing] = useState(null);
  const ws = workspaces.find((w) => w.id === workspaceId);
  const dates = useMemo(() => Array.from({ length: 14 }, (_, i) => iso(addDays(start, i))), [from]);
  const byDate = useMemo(() => {
    const m = new Map();
    for (const i of ideas) if (i.plannedDate) m.set(i.plannedDate, [...m.get(i.plannedDate) ?? [], i]);
    return m;
  }, [ideas]);
  const toggleFormat = (id) => setFormats((x) => x.includes(id) ? x.filter((y) => y !== id) : [...x, id]);
  const addCustom = (id) => {
    const next = [id, ...customFormats.filter((x) => x !== id)].slice(0, 30);
    setCustomFormats(next);
    storeCustom(next);
  };
  const removeCustom = (id) => {
    const next = customFormats.filter((x) => x !== id);
    setCustomFormats(next);
    storeCustom(next);
    setFormats((x) => x.filter((y) => y !== id));
  };
  return <div className="flex flex-col gap-space-md">
    <Card className="flex flex-col gap-space-md p-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-md">
        <div>
          <h1 className="flex items-center gap-space-sm text-headline-md text-on-surface">
            <Lightbulb size={20} className="text-secondary" />
            {" Kế hoạch nội dung"}
          </h1>
          <p className="text-body-sm text-on-surface-variant">
            {ws ? `Pocket "${ws.name}"` : "Tất cả Pocket"}
            {" – AI học từ bài hiệu quả của page và xu hướng tìm kiếm để lên lịch ý tưởng; mỗi ý tưởng thành video hoặc bài viết chỉ với một lần bấm."}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="subtle" aria-label="Tuần trước" onClick={() => setStart((d) => addDays(d, -7))}>
            <ChevronLeft size={14} />
          </Button>
          <Button size="sm" variant="subtle" onClick={() => setStart(new Date())}>Hôm nay</Button>
          <Button size="sm" variant="subtle" aria-label="Tuần sau" onClick={() => setStart((d) => addDays(d, 7))}>
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container-lowest p-space-sm">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-label-sm uppercase tracking-wider text-outline">Định dạng:</span>
          {CONTENT_FORMATS.map((x) => <button
            key={x.id}
            type="button"
            title={x.hint}
            onClick={() => toggleFormat(x.id)}
            className={cn(
              "rounded-full px-space-sm py-0.5 text-label-sm transition-colors",
              formats.includes(x.id) ? "bg-primary-container text-on-primary" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            )}
          >
            {x.label}
          </button>)}
          {customFormats.map(formatById).map((x) => <span
            key={x.id}
            className={cn(
              "inline-flex items-center rounded-full text-label-sm transition-colors",
              formats.includes(x.id) ? "bg-primary-container text-on-primary" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            )}
          >
            <button type="button" title={x.kind === "post" ? "Định dạng tự nhập · bài viết" : "Định dạng tự nhập · video"} onClick={() => toggleFormat(x.id)} className="py-0.5 pl-space-sm pr-1">
              {x.label}
            </button>
            <button type="button" aria-label={`Bỏ định dạng ${x.label}`} onClick={() => removeCustom(x.id)} className="rounded-full py-0.5 pr-1.5 opacity-70 hover:opacity-100">
              <X size={11} />
            </button>
          </span>)}
          {addingFormat ? <CustomFormatInput
            onAdd={(id) => {
              addCustom(id);
              setFormats((x) => x.includes(id) ? x : [...x, id]);
              setAddingFormat(false);
            }}
            onCancel={() => setAddingFormat(false)}
          /> : <button
            type="button"
            onClick={() => setAddingFormat(true)}
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-outline-variant px-space-sm py-0.5 text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <Plus size={11} />
            {" Tự nhập"}
          </button>}
        </div>
        <div className="flex flex-wrap items-center gap-space-sm">
          <Select aria-label="Số ngày" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-32">
            {[7, 14, 30].map((n) => <option key={n} value={n}>{n}{" ngày"}</option>)}
          </Select>
          <Select aria-label="Số ý tưởng mỗi ngày" value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className="w-36">
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}{" bài / ngày"}</option>)}
          </Select>
          <label className="flex items-center gap-1 text-body-sm text-on-surface">
            <input type="checkbox" checked={useTrends} onChange={(e) => setUseTrends(e.target.checked)} className="h-4 w-4 accent-primary-container" />
            Tham khảo xu hướng tìm kiếm (Google Trends VN)
          </label>
          <Button
            variant="primary"
            className="ml-auto"
            disabled={generate.isPending || formats.length === 0}
            onClick={() => generate.mutate(
              { workspaceId, startDate: from, days, perDay, formats, useTrends },
              { onSuccess: (r) => toast.success(`AI đã thêm ${r.created} ý tưởng vào kế hoạch`), onError: (e) => toast.error(e.message) }
            )}
          >
            {generate.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {" AI lập kế hoạch từ "}
            {dayLabel(from)}
          </Button>
        </div>
      </div>
    </Card>
    <div className="grid grid-cols-1 gap-space-sm md:grid-cols-2 2xl:grid-cols-7">
      {dates.map((d) => {
        const list = byDate.get(d) ?? [];
        const isToday = d === iso(new Date());
        return <Card key={d} className={cn("flex min-h-[140px] flex-col gap-space-sm p-space-sm", isToday && "ring-1 ring-primary-container")}>
          <div className="flex items-center justify-between">
            <span className={cn("text-label-md", isToday ? "text-primary" : "text-on-surface")}>{dayLabel(d)}</span>
            <button type="button" aria-label="Thêm ý tưởng" onClick={() => setEditing({ date: d })} className="rounded p-0.5 text-outline hover:bg-overlay/[0.06] hover:text-on-surface">
              <Plus size={13} />
            </button>
          </div>
          {list.map((i) => {
            const fmt = formatById(i.format);
            const st = statusMeta[i.status];
            return <div key={i.id} className={cn("flex flex-col gap-1 rounded-lg bg-surface-container-lowest p-space-sm", i.status === "dropped" && "opacity-50")}>
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone="secondary">{fmt.label}</Badge>
                {i.status !== "idea" && <Badge tone={st.tone}>{st.label}</Badge>}
              </div>
              <div className="text-label-md text-on-surface">{i.title}</div>
              {i.hook && <div className="text-label-sm italic text-on-surface-variant">"{i.hook}"</div>}
              {i.description && <div className="line-clamp-3 text-label-sm text-on-surface-variant">{i.description}</div>}
              <div className="mt-1 flex flex-wrap gap-1">
                {fmt.kind === "video" ? <Button
                  size="sm"
                  variant={i.projectId ? "subtle" : "primary"}
                  disabled={toVideo.isPending}
                  onClick={() => toVideo.mutate({ id: i.id }, { onSuccess: (r) => navigate(`/studio?project=${r.projectId}`), onError: (e) => toast.error(e.message) })}
                >
                  <Clapperboard size={12} />
                  {" "}
                  {i.projectId ? "Mở video" : "Tạo video"}
                </Button> : <Button
                  size="sm"
                  variant={i.contentItemId ? "subtle" : "primary"}
                  disabled={toPost.isPending}
                  onClick={() => toPost.mutate({ id: i.id }, { onSuccess: () => (toast.success("Đã tạo bài viết nháp trong Kho nội dung"), navigate("/content")), onError: (e) => toast.error(e.message) })}
                >
                  <FileText size={12} />
                  {" "}
                  {i.contentItemId ? "Mở bài" : "Tạo bài viết"}
                </Button>}
                <Button size="sm" variant="subtle" aria-label="Sửa" onClick={() => setEditing(i)}>
                  <Pencil size={12} />
                </Button>
                {i.status !== "done" && <Button size="sm" variant="subtle" title="Đánh dấu đã xong" onClick={() => save.mutate({ id: i.id, title: i.title, format: i.format, status: "done" })}>
                  ✓
                </Button>}
                <Button
                  size="sm"
                  variant="subtle"
                  aria-label="Xóa"
                  onClick={() => void confirmDialog({ title: "Xóa ý tưởng", message: `Xóa "${i.title}"?`, confirmLabel: "Xóa", danger: true }).then((ok) => ok && del.mutate({ id: i.id }))}
                >
                  <Trash size={12} />
                </Button>
              </div>
            </div>;
          })}
        </Card>;
      })}
    </div>
    <IdeaDialog target={editing} workspaceId={workspaceId} customFormats={customFormats} onAddCustom={addCustom} onClose={() => setEditing(null)} />
  </div>;
}
