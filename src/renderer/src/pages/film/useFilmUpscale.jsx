import { useState } from "react";
import { useApiMutation } from "../../lib/api";
import { toast } from "../../components/ui/toast";
import { parseUpscale, upscaleLabel } from "../../../../shared/upscale";
import { UpscaleDialog } from "../studio/UpscaleDialog";
import { FILM_INV } from "./meta";

export const canUpscale = (t) =>
  !!t && t.kind === "video" && t.status === "done" && !!t.file && parseUpscale(t.upscale)?.quality !== "4k";

export function useFilmUpscale() {
  const [takes, setTakes] = useState([]);
  const upscale = useApiMutation("film.upscale", FILM_INV);
  const list = takes.filter(canUpscale);
  const submit = async (quality, method) => {
    let ok = 0;
    const errors = [];
    for (const t of list) {
      try {
        await upscale.mutateAsync({ takeId: t.id, quality, method });
        ok++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    setTakes([]);
    if (ok)
      toast.success(
        `Đã xếp hàng nâng cấp ${upscaleLabel(quality)} cho ${ok} video – bản nâng cấp hiện thành video mới và được chọn để ghép tập`,
      );
    if (errors.length) toast.error(`${errors.length} video không nâng cấp được: ${[...new Set(errors)].join(" · ")}`);
  };
  return {
    open: (t) => {
      const ok = t.filter(canUpscale);
      if (!ok.length) toast.info("Chưa có video nào nâng cấp được (cần video đã tạo xong, chưa phải bản 4K)");
      else setTakes(ok);
    },
    dialog: (
      <UpscaleDialog
        path={list[0]?.file ?? null}
        count={list.length}
        busy={upscale.isPending}
        status={upscale.isPending ? "Đang xếp hàng…" : null}
        onClose={() => setTakes([])}
        onSubmit={(q, m) => void submit(q, m)}
      />
    ),
  };
}
