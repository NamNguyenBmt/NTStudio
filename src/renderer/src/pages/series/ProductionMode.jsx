import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";

const MODE_META = {
  video: { icon: "🎬", label: "Video kể chuyện", studio: "Xưởng Video AI" },
  film: { icon: "🎞", label: "Phim chuyên nghiệp", studio: "Xưởng Phim" }
};

export function ProductionBadge({ mode }) {
  return <Badge tone={mode === "film" ? "primary" : "secondary"} title={`Sản xuất bằng ${MODE_META[mode].studio}`}>
    {MODE_META[mode].icon}
    {" "}
    {mode === "film" ? "Phim" : "Video"}
    {" · "}
    {MODE_META[mode].studio}
  </Badge>;
}

export function ProductionModePicker({ value, locked, onChange }) {
  const opts = [
    { id: "video", desc: "Giọng đọc + ảnh AI / stock, phụ đề. Rẻ, nhanh, hợp đăng đều đặn hằng ngày.", cost: "≈ $0–0.5 / tập" },
    { id: "film", desc: "Nhân vật đồng nhất (bảng nhân vật), video AI từng cảnh quay, thoại khớp môi. Cần key Veo / Seedance.", cost: "≈ $10–30 / tập 1 phút" }
  ];
  return <div className="col-span-2 flex flex-col gap-1">
    <span className="text-label-md text-on-surface-variant">Kiểu sản xuất</span>
    <div className="grid grid-cols-2 gap-space-sm" role="radiogroup" aria-label="Kiểu sản xuất">
      {opts.map((o) => {
        const on = value === o.id;
        return <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={on}
          disabled={locked && !on}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex flex-col gap-1 rounded-xl border p-space-sm text-left transition-colors disabled:opacity-40",
            on ? "border-primary bg-primary/10" : "border-overlay/[0.1] hover:bg-surface-container"
          )}
        >
          <span className="flex items-center justify-between gap-1 text-label-md text-on-surface">
            {MODE_META[o.id].icon}
            {" "}
            {MODE_META[o.id].label}
            {o.id === "film" && <Badge tone="primary">PRO</Badge>}
          </span>
          <span className="text-label-sm text-secondary">{"→ "}{MODE_META[o.id].studio}</span>
          <span className="text-label-sm text-on-surface-variant">{o.desc}</span>
          <span className="font-mono text-[10px] text-outline">{o.cost}</span>
        </button>;
      })}
    </div>
    {locked && <span className="text-label-sm text-warning">
      Series đã có tập được sản xuất – không đổi kiểu được (tránh một tập nằm ở cả hai xưởng).
    </span>}
  </div>;
}
