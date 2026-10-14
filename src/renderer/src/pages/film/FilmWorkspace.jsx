import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, LoaderCircle, Pause, Play, Trash, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { confirmDialog } from "../../components/ui/confirm";
import { Select } from "../../components/ui/Input";
import { Progress } from "../../components/ui/Progress";
import { toast } from "../../components/ui/toast";
import { ScriptStep } from "./ScriptStep";
import { FILM_STEPS, FILM_INV } from "./meta";
import { isUnusedCast } from "./cast";
import "./AssetCard";
import { AssetBoard } from "./AssetBoard";
import { AssembleStep } from "./AssembleStep";

const STEP_KIND = { character: "character", location: "location", shot: "shot" };

export function FilmWorkspace({ id, gate }) {
  const navigate = useNavigate();
  const { data: q } = useApiQuery("film.queue", { filmId: id }, { refetchInterval: 2e3 });
  const busy = !!q?.film && q.film.queued + q.film.running > 0;
  const { data: d, error } = useApiQuery("film.get", { id }, { refetchInterval: busy ? 2e3 : false });
  const qc = useQueryClient();
  const settled = q?.film ? `${q.film.done}:${q.film.failed}` : null;
  useEffect(() => {
    if (settled) void qc.invalidateQueries({ queryKey: ["film.get"] });
  }, [settled, qc]);
  const update = useApiMutation("film.update", FILM_INV);
  const setQueue = useApiMutation("film.setQueue", ["film.queue"]);
  const cancel = useApiMutation("film.cancel", FILM_INV);
  const remove = useApiMutation("film.delete", FILM_INV);
  const [step, setStep] = useState("script");
  if (error) return <p className="p-space-lg text-error">{"Không mở được phim: "}{error.message}</p>;
  if (!d) return <div className="p-space-lg text-on-surface-variant">Đang tải…</div>;
  const { film, assets } = d;
  const count = (k) => {
    const list = assets.filter((a) => a.kind === k && !isUnusedCast(d, a));
    return { all: list.length, chosen: list.filter((a) => a.takes.some((t) => t.id === a.selectedTakeId && t.status === "done")).length };
  };
  const videoCount = () => {
    const shots = assets.filter((a) => a.kind === "shot");
    return { all: shots.length, chosen: shots.filter((a) => a.takes.some((t) => t.id === a.selectedVideoTakeId && t.status === "done")).length };
  };
  const stepDone = (s) => {
    if (s === "script") return assets.some((a) => a.kind === "shot");
    if (s === "video") return videoCount().all > 0 && videoCount().chosen === videoCount().all;
    const k = STEP_KIND[s];
    if (!k) return false;
    const c = count(k);
    return c.all > 0 && c.chosen === c.all;
  };
  const kind = STEP_KIND[step];
  const deleteFilm = async () => {
    if (!await confirmDialog({ title: "Xóa phim", message: `Xóa "${film.title}" cùng toàn bộ ảnh đã tạo? Không hoàn tác được.`, danger: true, confirmLabel: "Xóa" })) return;
    remove.mutate({ id }, { onSuccess: () => navigate("/film") });
  };
  return <div className="flex min-h-[calc(100vh-6rem)] flex-col gap-space-md">
    <div className="flex flex-wrap items-center gap-space-sm">
      <Button size="sm" variant="subtle" onClick={() => navigate("/film")} aria-label="Về danh sách phim">
        <ArrowLeft size={13} />
      </Button>
      <div className="min-w-0 flex-1">
        {d.series && <button
          type="button"
          onClick={() => navigate(`/series?id=${d.series.id}`)}
          className="block truncate text-label-sm text-primary hover:underline"
          title="Về trang series"
        >
          {"🎞 Series "}
          {d.series.title}
          {" · Tập "}
          {d.series.episodeNumber}
        </button>}
        <h1 className="truncate text-headline-sm text-on-surface" title={film.logline ?? void 0}>{film.title}</h1>
      </div>
      <label className="flex items-center gap-1 text-label-sm text-on-surface-variant">
        Video
        <div className="w-36">
          <Select value={film.videoEngine} onChange={(e) => update.mutate({ id, patch: { videoEngine: e.target.value } })} aria-label="Model video">
            <option value="seedance" disabled={!gate.seedance}>Seedance 2.0</option>
            <option value="veo" disabled={!gate.veo}>{gate.veoFlow ? "Veo 3.1 · Flow" : "Veo 3.1"}</option>
          </Select>
        </div>
      </label>
      <label className="flex items-center gap-1 text-label-sm text-on-surface-variant">
        Ảnh (Nano Banana)
        {gate.imageFlow && <Badge tone="primary" title="Ảnh tạo qua Google Flow trước; Flow lỗi mới dùng nguồn bên cạnh">Flow</Badge>}
        <div className="w-28">
          <Select value={film.imageEngine} onChange={(e) => update.mutate({ id, patch: { imageEngine: e.target.value } })} aria-label="Nguồn ảnh">
            <option value="google" disabled={!gate.imageGoogle}>Gemini</option>
            <option value="fal" disabled={!gate.imageFal}>Fal.ai</option>
          </Select>
        </div>
      </label>
      <label className="flex items-center gap-1 text-label-sm text-on-surface-variant" title="Số ảnh tạo cùng lúc (chung cho mọi phim). Nhà cung cấp giới hạn số yêu cầu đồng thời trên một key – đặt quá cao sẽ bị từ chối (429) rồi tự thử lại.">
        Luồng ảnh
        <div className="w-16">
          <Select value={q?.imageConcurrency ?? 4} onChange={(e) => setQueue.mutate({ imageConcurrency: Number(e.target.value) })} aria-label="Số luồng ảnh">
            {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
      </label>
      <label className="flex items-center gap-1 text-label-sm text-on-surface-variant" title="Số video tạo cùng lúc (chung cho mọi phim). Mỗi clip mất vài phút; nhà cung cấp giới hạn số yêu cầu đồng thời.">
        Luồng video
        <div className="w-16">
          <Select value={q?.videoConcurrency ?? 2} onChange={(e) => setQueue.mutate({ videoConcurrency: Number(e.target.value) })} aria-label="Số luồng video">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
      </label>
      <Button size="sm" variant="subtle" onClick={() => void deleteFilm()} aria-label="Xóa phim" title="Xóa phim">
        <Trash size={13} />
      </Button>
    </div>
    <nav className="flex flex-wrap gap-1 rounded-xl bg-surface-container-low p-1" aria-label="Các bước làm phim">
      {FILM_STEPS.map((s, i) => {
        const k = STEP_KIND[s.id];
        const c = s.id === "video" ? videoCount() : k ? count(k) : null;
        return <button
          key={s.id}
          type="button"
          disabled={!s.ready}
          onClick={() => setStep(s.id)}
          title={s.ready ? void 0 : "Giai đoạn sau"}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-space-md py-1.5 text-label-md transition-colors disabled:opacity-40",
            step === s.id ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high"
          )}
        >
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", step === s.id ? "bg-black/20" : "bg-surface-container-highest")}>
            {stepDone(s.id) ? <Check size={11} /> : i + 1}
          </span>
          {s.label}
          {c && c.all > 0 && <span className="font-mono text-[10px] opacity-80">{c.chosen}/{c.all}</span>}
          {!s.ready && <Badge tone="neutral">Sắp có</Badge>}
        </button>;
      })}
    </nav>
    <div className="min-h-0 flex-1">
      {step === "script" ? <ScriptStep detail={d} onNext={() => setStep("character")} /> : step === "video" ? <AssetBoard key={"video"} detail={d} kind="shot" mode="video" /> : step === "assemble" ? <AssembleStep detail={d} /> : kind ? <AssetBoard key={kind} detail={d} kind={kind} /> : null}
    </div>
    <Card className="sticky bottom-0 flex flex-wrap items-center gap-x-space-lg gap-y-1 px-space-md py-space-sm font-mono text-code">
      {q?.film && <>
        <span className="flex items-center gap-1 text-on-surface-variant">
          {q.film.running > 0 && !q.paused && <LoaderCircle size={12} className="animate-spin text-secondary" />}
          {"Đang chạy "}
          <span className="text-on-surface">{q.film.running}</span>
        </span>
        <span className="text-on-surface-variant">
          {"Chờ "}
          <span className="text-on-surface">{q.film.queued}</span>
        </span>
        <span className="text-on-surface-variant">{"Xong "}<span className="text-tertiary">{q.film.done}</span></span>
        <span className="text-on-surface-variant">
          {"Lỗi "}
          <span className={q.film.failed ? "text-error" : "text-on-surface"}>{q.film.failed}</span>
        </span>
        {busy && <Progress className="w-32" value={q.film.done / Math.max(1, q.film.done + q.film.queued + q.film.running) * 100} />}
      </>}
      <span className="text-on-surface-variant">
        {"Đã tiêu "}
        <span className="text-warning">${d.spentUsd.toFixed(2)}</span>
      </span>
      {q?.paused && <span className="text-warning">Hàng đợi đang tạm dừng</span>}
      <span className="ml-auto flex gap-space-sm">
        <Button
          size="sm"
          variant="subtle"
          disabled={!q}
          onClick={() => setQueue.mutate({ paused: !q?.paused }, { onSuccess: (r) => toast.info(r.paused ? "Đã tạm dừng – ảnh đang tạo dở vẫn chạy xong" : "Tiếp tục chạy hàng đợi") })}
        >
          {q?.paused ? <Play size={12} /> : <Pause size={12} />}
          {" "}
          {q?.paused ? "Tiếp tục" : "Tạm dừng"}
        </Button>
        <Button
          size="sm"
          variant="subtle"
          disabled={!busy || cancel.isPending}
          onClick={() => cancel.mutate({ filmId: id }, { onSuccess: (r) => toast.info(`Đã hủy ${r.cancelled} bản đang chờ / đang chạy`) })}
        >
          <X size={12} />
          {" Hủy tất cả"}
        </Button>
      </span>
    </Card>
  </div>;
}
