import { useApiMutation } from "../../lib/api";
import { Film, LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { toast } from "../../components/ui/toast";
import { INV } from "./meta";

export function EpisodeFilmActions({ episode: e, onOpen }) {
  const make = useApiMutation("series.makeFilm", [...INV, "film."]);
  const f = e.film;
  return (
    <>
      {f && (
        <span
          className="flex items-center gap-1 font-mono text-label-sm text-on-surface-variant"
          title="Khung hình đã chọn / video đã chọn / số bản đã ghép"
        >
          {"🖼 "}
          {f.keyframes}/{f.shots}
          {" · 🎥 "}
          {f.videos}/{f.shots}
          {" · ✂ "}
          {f.renders}
        </span>
      )}
      <Button
        size="sm"
        variant={f ? "subtle" : "primary"}
        disabled={make.isPending}
        title={
          f
            ? "Mở phim của tập trong Xưởng Phim"
            : "Tạo phim cho tập này trong Xưởng Phim – dàn nhân vật và bảng nhân vật chuẩn của series được đưa sang sẵn"
        }
        onClick={() =>
          f
            ? onOpen(f.filmId)
            : make.mutate(
                { episodeId: e.id },
                {
                  onSuccess: (id) => (
                    toast.success(`Đã tạo phim cho tập ${e.number} – viết kịch bản ở bước 1`),
                    onOpen(id)
                  ),
                  onError: (err) => toast.error(err.message),
                },
              )
        }
      >
        {make.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Film size={12} />}{" "}
        {f ? "Mở phim" : "Làm phim"}
      </Button>
    </>
  );
}
