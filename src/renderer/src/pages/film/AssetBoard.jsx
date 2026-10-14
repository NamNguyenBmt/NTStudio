import { useState, useMemo } from "react";
import { useApiMutation } from "../../lib/api";
import { CircleArrowUp, Plus, Sparkles, WandSparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Select } from "../../components/ui/Input";
import { Switch } from "../../components/ui/Switch";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { toast } from "../../components/ui/toast";
import { parseUpscale, upscaleLabel } from "../../../../shared/upscale";
import { useNow, expectedSeconds, queuePositions, hasActive, TakeProgress } from "../../components/TakeProgress";
import { FILM_ASSET_LABEL, FILM_INV } from "./meta";
import { useGenerate } from "./hooks";
import { castOrigin, isUnusedCast, pendingProposals } from "./cast";
import { canUpscale, useFilmUpscale } from "./useFilmUpscale";
import { AssetDrawer } from "./AssetDrawer";
import { Thumb, StatusBadge, AssetCard } from "./AssetCard";

const VIEW_KEY = "film.view";

const HINT = {
  character: "Bảng nhân vật: toàn thân + mặt nhiều góc trên nền trơn – dùng làm ảnh tham chiếu cho mọi khung hình. Chọn bản đẹp nhất cho mỗi nhân vật.",
  location: "Toàn cảnh bối cảnh, không có người – dùng làm tham chiếu không gian và ánh sáng.",
  shot: "Khung hình từng cảnh quay: ghép đúng ảnh đã chọn của nhân vật + bối cảnh. Đây là ảnh đầu vào để tạo video ở bước sau.",
  video: "Video từng cảnh quay: khung hình đã chọn làm khung đầu, chuyển động theo hành động + máy quay, lời thoại được lồng tiếng khớp môi khi bật âm thanh. Rê chuột lên thẻ để xem."
};

export function assetState(a, kind = "image") {
  const takes = a.takes.filter((t) => t.kind === kind);
  const selectedId = kind === "video" ? a.selectedVideoTakeId : a.selectedTakeId;
  const selected = takes.find((t) => t.id === selectedId && t.status === "done");
  const latestDone = takes.find((t) => t.status === "done");
  const keyframe = a.takes.find((t) => t.kind === "image" && t.id === a.selectedTakeId && t.status === "done");
  const last = takes[0];
  return {
    file: (selected ?? latestDone)?.file ?? null,
    shown: selected ?? latestDone ?? null,
    poster: keyframe?.file ?? null,
    pending: takes.filter((t) => t.status === "queued" || t.status === "running").length,
    running: takes.find((t) => t.status === "running") ?? null,
    active: takes.find((t) => t.status === "running") ?? [...takes].reverse().find((t) => t.status === "queued") ?? null,
    failed: last?.status === "failed" ? last : null,
    done: takes.filter((t) => t.status === "done").length
  };
}

export function AssetBoard({ detail, kind, mode = "image" }) {
  const { film } = detail;
  const video = mode === "video";
  const allItems = detail.assets.filter((a) => a.kind === kind);
  const unusedCast = allItems.filter((a) => isUnusedCast(detail, a));
  const items = allItems.filter((a) => !unusedCast.includes(a));
  const pendingCount = kind === "character" || kind === "shot" ? pendingProposals(detail).length : 0;
  const [showUnused, setShowUnused] = useState(false);
  const byId = useMemo(() => new Map(detail.assets.map((a) => [a.id, a])), [detail.assets]);
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(VIEW_KEY) || "grid";
    } catch {
      return "grid";
    }
  });
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(null);
  const { run, pending } = useGenerate(film.id);
  const now = useNow(hasActive(detail));
  const expected = expectedSeconds(detail, mode);
  const positions = queuePositions(detail, mode);
  const update = useApiMutation("film.update", FILM_INV);
  const save = useApiMutation("film.saveAsset", FILM_INV);
  const upscale = useFilmUpscale();
  const upscalable = video ? (selected.size ? items.filter((a) => selected.has(a.id)) : items).map((a) => assetState(a, "video").shown).filter(canUpscale) : [];
  const changeView = (v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
    }
  };
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const missingRefs = (a) => {
    if (video) return assetState(a).poster ? [] : ["khung hình"];
    if (a.kind !== "shot") return [];
    return [...a.characterIds, ...a.locationId ? [a.locationId] : []].map((id) => byId.get(id)).filter((x) => !!x && !x.takes.some((t) => t.id === x.selectedTakeId && t.status === "done")).map((x) => x.name);
  };
  const empty = items.filter((a) => a.proposal !== "pending" && !a.takes.some((t) => t.kind === mode && t.status !== "cancelled" && t.status !== "failed") && !missingRefs(a).length);
  const blocked = items.filter((a) => missingRefs(a).length).length;
  const totalSec = items.reduce((s, a) => s + a.durationSec, 0);
  if (!items.length)
    return <Card className="flex flex-col items-center gap-space-sm p-space-xl text-center text-on-surface-variant">
      {"Chưa có "}
      {FILM_ASSET_LABEL[kind].toLowerCase()}
      {" nào – quay lại bước Kịch bản để AI viết, hoặc thêm tay."}
      <Button variant="subtle" onClick={() => save.mutate({ filmId: film.id, kind, patch: {} })}>
        <Plus size={13} />
        {" Thêm "}
        {FILM_ASSET_LABEL[kind].toLowerCase()}
      </Button>
    </Card>;
  return <div className="flex flex-col gap-space-sm">
    <div className="flex flex-wrap items-center gap-space-sm">
      <SegmentedControl
        label="Kiểu hiển thị"
        value={view}
        onChange={changeView}
        options={[
          { value: "grid", label: "Lưới" },
          { value: "list", label: "Danh sách" }
        ]}
      />
      {video ? <>
        {film.videoEngine === "seedance" && <label className="flex items-center gap-1 text-label-sm text-on-surface-variant" title="Fast rẻ hơn ~20% (tối đa 720p)">
          Bản
          <div className="w-32">
            <Select value={film.videoTier} onChange={(e) => update.mutate({ id: film.id, patch: { videoTier: e.target.value } })} aria-label="Bản Seedance">
              <option value="fast">Seedance Fast</option>
              <option value="standard">Seedance 2.0</option>
            </Select>
          </div>
        </label>}
        <label className="flex items-center gap-1 text-label-sm text-on-surface-variant">
          Độ phân giải
          <div className="w-24">
            <Select
              value={film.videoEngine === "veo" ? "720p" : film.videoResolution}
              disabled={film.videoEngine === "veo"}
              onChange={(e) => update.mutate({ id: film.id, patch: { videoResolution: e.target.value } })}
              aria-label="Độ phân giải video"
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p" disabled={film.videoTier === "fast"}>
                1080p
                {film.videoTier === "fast" ? " (bản thường)" : ""}
              </option>
            </Select>
          </div>
        </label>
        {film.videoEngine === "seedance" && <label className="flex items-center gap-1.5 text-label-sm text-on-surface-variant" title="Model tự tạo tiếng động, không khí và lời thoại khớp môi (giá như nhau)">
          <Switch label="Âm thanh" checked={film.videoAudio} onChange={(v) => update.mutate({ id: film.id, patch: { videoAudio: v } })} />
          Âm thanh + thoại
        </label>}
      </> : <label className="flex items-center gap-1 text-label-sm text-on-surface-variant" title="Số bản tạo cho mỗi mục mỗi lần bấm – nhiều bản để chọn bản đẹp nhất">
        Mỗi mục
        <div className="w-24">
          <Select value={film.takesPerRun} onChange={(e) => update.mutate({ id: film.id, patch: { takesPerRun: Number(e.target.value) } })} aria-label="Số bản mỗi mục">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}{" bản"}</option>)}
          </Select>
        </div>
      </label>}
      <Button variant="primary" size="sm" className="h-8" disabled={pending || !empty.length} onClick={() => void run(empty.map((a) => a.id), void 0, mode)}>
        <Sparkles size={13} />
        {" Tạo "}
        {video ? "video" : ""}
        {" cho "}
        {empty.length}
        {" "}
        {video ? "cảnh chưa có video" : "mục chưa có ảnh"}
      </Button>
      <Button size="sm" className="h-8" disabled={pending || !selected.size} onClick={() => void run([...selected], void 0, mode).then(() => setSelected(new Set()))}>
        <WandSparkles size={13} />
        {" Tạo thêm cho "}
        {selected.size}
        {" mục đã chọn"}
      </Button>
      {video && <Button
        size="sm"
        className="h-8"
        disabled={!upscalable.length}
        onClick={() => upscale.open(upscalable)}
        title="Nâng cấp video lên 1080p / 4K (bằng Google Flow hoặc trên máy)"
      >
        <CircleArrowUp size={13} />
        {" Nâng cấp "}
        {upscalable.length}
        {" video"}
        {selected.size ? " đã chọn" : ""}
      </Button>}
      <button type="button" className="text-label-sm text-primary hover:underline" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((a) => a.id)))}>
        {selected.size === items.length ? "Bỏ chọn" : "Chọn tất cả"}
      </button>
      {!video && <Button size="sm" variant="subtle" className="ml-auto h-8" onClick={() => save.mutate({ filmId: film.id, kind, patch: {} }, { onSuccess: (a) => setOpen(a.id), onError: (e) => toast.error(e.message) })}>
        <Plus size={13} />
        {" Thêm"}
      </Button>}
    </div>
    {pendingCount > 0 && !video && <p className="rounded-lg bg-warning/10 px-space-sm py-1 text-label-sm text-warning">
      {"Còn "}
      {pendingCount}
      {" nhân vật AI đề xuất chưa duyệt – duyệt ở bước Kịch bản trước khi tạo ảnh"}
      {kind === "shot" ? " / khung hình cho các cảnh có họ" : ""}
      .
    </p>}
    <p className="text-label-sm text-on-surface-variant">
      {HINT[video ? "video" : kind]}
      {video && <span className="font-mono">{" · tổng "}{totalSec}s</span>}
      {blocked > 0 && <span className="text-warning">
        {" "}
        {"· "}
        {blocked}
        {" cảnh chưa tạo được vì "}
        {video ? "chưa có khung hình đã chọn" : "nhân vật / bối cảnh chưa có ảnh đã chọn"}
        .
      </span>}
    </p>
    {view === "grid" ? <div className={cn("grid gap-space-sm", kind === "shot" && film.aspect === "9:16" ? "grid-cols-3 md:grid-cols-5 2xl:grid-cols-8" : "grid-cols-2 md:grid-cols-3 2xl:grid-cols-5")}>
      {items.map((a, i) => <AssetCard
        key={a.id}
        a={a}
        index={i}
        kind={kind}
        mode={mode}
        aspect={film.aspect}
        checked={selected.has(a.id)}
        missing={missingRefs(a)}
        progress={{ now, expected, positions }}
        origin={castOrigin(detail, a)}
        onCheck={() => toggle(a.id)}
        onOpen={() => setOpen(a.id)}
        onUpscale={(t) => upscale.open([t])}
      />)}
    </div> : <Card className="overflow-hidden">
      <table className="w-full text-body-sm">
        <tbody>
          {items.map((a, i) => {
            const s = assetState(a, mode);
            const miss = missingRefs(a);
            return <tr key={a.id} className="border-b border-overlay/[0.06] last:border-0 hover:bg-surface-container">
              <td className="w-8 pl-space-sm">
                <input type="checkbox" className="accent-secondary" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label={`Chọn ${a.name}`} />
              </td>
              <td className="w-24 py-1">
                <button type="button" onClick={() => setOpen(a.id)} className="block h-12 w-20 overflow-hidden rounded bg-surface-container-lowest">
                  <Thumb s={s} video={video} />
                </button>
              </td>
              <td className="max-w-0 py-1 pr-space-sm">
                <button type="button" onClick={() => setOpen(a.id)} className="block w-full text-left">
                  <span className="block truncate text-on-surface">
                    {kind === "shot" ? `${i + 1}. ${a.summary || a.name}` : a.name}
                  </span>
                  <span className="block truncate text-label-sm text-on-surface-variant">
                    {kind === "shot" ? `${a.camera || "—"} · ${a.durationSec}s` : a.summary || a.description}
                  </span>
                </button>
              </td>
              <td className="w-64 pr-space-sm text-right">
                {s.active ? <TakeProgress take={s.active} expectedSec={expected} position={positions.get(s.active.id)} now={now} more={s.pending - 1} variant="inline" /> : <StatusBadge s={s} miss={miss} video={video} />}
              </td>
              {video && <td className="w-28 pr-space-sm text-right">
                {canUpscale(s.shown) ? <Button size="sm" variant="secondary" onClick={() => upscale.open([s.shown])} title="Nâng cấp chất lượng video (1080p / 4K)">
                  <CircleArrowUp size={12} />
                  {" Nâng cấp"}
                </Button> : parseUpscale(s.shown?.upscale) && <Badge tone="primary">
                  <CircleArrowUp size={10} />
                  {" "}
                  {upscaleLabel(parseUpscale(s.shown?.upscale).quality)}
                </Badge>}
              </td>}
              <td className="w-20 pr-space-sm text-right font-mono text-label-sm text-outline">{s.done}{" bản"}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </Card>}
    {unusedCast.length > 0 && <div className="flex flex-col gap-space-sm">
      <button type="button" className="self-start text-label-sm text-on-surface-variant hover:text-on-surface" onClick={() => setShowUnused((v) => !v)}>
        {showUnused ? "▾" : "▸"}
        {" Nhân vật series không xuất hiện trong tập này ("}
        {unusedCast.length}
        )
      </button>
      {showUnused && <div className="grid grid-cols-2 gap-space-sm opacity-60 md:grid-cols-3 2xl:grid-cols-5">
        {unusedCast.map((a, i) => <AssetCard
          key={a.id}
          a={a}
          index={i}
          kind={kind}
          mode={mode}
          aspect={film.aspect}
          checked={false}
          missing={[]}
          progress={{ now, expected, positions }}
          origin={castOrigin(detail, a)}
          onCheck={() => void 0}
          onOpen={() => setOpen(a.id)}
          onUpscale={(t) => upscale.open([t])}
        />)}
      </div>}
    </div>}
    <AssetDrawer asset={open ? byId.get(open) ?? null : null} detail={detail} mode={mode} onClose={() => setOpen(null)} />
    {upscale.dialog}
  </div>;
}
