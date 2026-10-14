import { call, useApiMutation } from "../../lib/api";
import { confirmDialog } from "../../components/ui/confirm";
import { toast } from "../../components/ui/toast";
import { FILM_INV } from "./meta";

export function useGenerate(filmId) {
  const gen = useApiMutation("film.generate", FILM_INV);
  const run = async (assetIds, takes, kind = "image") => {
    if (!assetIds.length) return void toast.info("Chưa chọn mục nào");
    let est;
    try {
      est = await call("film.estimate", { filmId, assetIds, takes, kind });
    } catch (e) {
      return void toast.error(e instanceof Error ? e.message : String(e));
    }
    const skipped = est.skipped.length ? `

Bỏ qua ${est.skipped.length} mục:
• ${est.skipped.slice(0, 5).map((s) => s.reason).join("\n• ")}` : "";
    if (!est.takes) return void toast.error(`Không có mục nào tạo được.${skipped}`);
    const video = kind === "video";
    const ok = await confirmDialog({
      title: video ? `Tạo ${est.takes} video (${est.seconds ?? 0} giây)` : `Tạo ${est.takes} ảnh`,
      message: `Model: ${est.model}
Chi phí ước tính: ≈ $${est.usd.toFixed(2)} (tính vào key của bạn và hạn mức chi tiêu tháng).` + (video ? "\nMỗi clip mất vài phút; các clip chạy song song theo số luồng video đã đặt." : "") + skipped,
      confirmLabel: "Tạo"
    });
    if (!ok) return;
    gen.mutate(
      { filmId, assetIds, takes, kind },
      {
        onSuccess: (r) => toast.success(`Đã xếp hàng ${r.queued} ${video ? "video" : "ảnh"} – chạy song song theo số luồng đã đặt`),
        onError: (e) => toast.error(e.message)
      }
    );
  };
  return { run, pending: gen.isPending };
}
