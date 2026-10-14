import { useState, useEffect } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { Switch } from "../../components/ui/Switch";
import { toast } from "../../components/ui/toast";

export function StaggerControl() {
  const { data: p } = useApiQuery("posts.stagger");
  const set = useApiMutation("posts.setStagger", ["posts.stagger"]);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  useEffect(() => {
    if (p) {
      setMin(String(p.minMinutes));
      setMax(String(p.maxMinutes));
    }
  }, [p?.minMinutes, p?.maxMinutes]);
  const save = () => {
    const lo = Math.round(Number(min));
    const hi = Math.round(Number(max));
    if (!p || !Number.isFinite(lo) || !Number.isFinite(hi) || lo < 1 || lo > 60 || hi < lo || hi > 120) {
      if (p) setMin(String(p.minMinutes)), setMax(String(p.maxMinutes));
      return void toast.error("Khoảng giãn cách: từ 1–60 phút, tới ≤ 120 phút và không nhỏ hơn số đầu");
    }
    if (lo !== p.minMinutes || hi !== p.maxMinutes) set.mutate({ minMinutes: lo, maxMinutes: hi }, { onError: (e) => toast.error(e.message) });
  };
  const num = "w-9 rounded bg-surface-container-high px-1 text-center text-on-surface disabled:opacity-50";
  return <span
    className="flex items-center gap-space-sm text-on-surface-variant"
    title="Nhiều kênh cùng hẹn một giờ → các bài được rải lệch nhau ngẫu nhiên thay vì đăng đồng loạt. Bài đứng một mình giữ đúng giờ. Áp dụng khi lên lịch / dời lịch."
  >
    <Switch
      label="Giãn cách bài trùng giờ"
      checked={p?.enabled ?? true}
      disabled={!p || set.isPending}
      onChange={(enabled) => set.mutate({ enabled }, { onSuccess: () => toast.info(enabled ? "Bài trùng giờ sẽ được rải lệch nhau" : "Đã tắt giãn cách – bài đăng đúng giờ đã chọn") })}
    />
    <span>Giãn cách</span>
    <input aria-label="Giãn cách tối thiểu (phút)" className={num} inputMode="numeric" value={min} disabled={!p?.enabled} onChange={(e) => setMin(e.target.value)} onBlur={save} />
    –
    <input aria-label="Giãn cách tối đa (phút)" className={num} inputMode="numeric" value={max} disabled={!p?.enabled} onChange={(e) => setMax(e.target.value)} onBlur={save} />
    phút
  </span>;
}
