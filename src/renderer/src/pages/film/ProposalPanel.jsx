import { useState, useEffect } from "react";
import { useApiMutation } from "../../lib/api";
import { Check, LoaderCircle, UserPlus } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { toast } from "../../components/ui/toast";
import { FILM_INV } from "./meta";
import { useGenerate } from "./hooks";

const ACTIONS = [
  { id: "episode", label: "Chỉ trong tập này" },
  { id: "series", label: "Thêm vào dàn nhân vật series" },
  { id: "drop", label: "Bỏ" }
];

export function ProposalPanel({ detail, pending }) {
  const resolve = useApiMutation("film.resolveProposals", FILM_INV);
  const { run } = useGenerate(detail.film.id);
  const [choice, setChoice] = useState({});
  useEffect(() => {
    setChoice(Object.fromEntries(pending.map((a) => [a.id, a.proposedScope ?? "episode"])));
  }, [pending.map((a) => a.id).join(",")]);
  if (!pending.length) return null;
  const kept = pending.filter((a) => (choice[a.id] ?? "episode") !== "drop");
  const submit = (generate) => resolve.mutate(
    { filmId: detail.film.id, decisions: pending.map((a) => ({ assetId: a.id, action: choice[a.id] ?? "episode" })) },
    {
      onSuccess: (r) => {
        if (r.emptyShots.length) toast.info(`${r.emptyShots.join(", ")} không còn nhân vật nào – sửa hành động của cảnh hoặc viết lại kịch bản`);
        else toast.success("Đã duyệt nhân vật đề xuất");
        if (generate && r.kept.length) void run(r.kept);
      },
      onError: (e) => toast.error(e.message)
    }
  );
  return <Card className="flex flex-col gap-space-sm border border-warning/40 p-space-md">
    <h2 className="flex items-center gap-space-sm text-label-md text-on-surface">
      <UserPlus size={15} className="text-warning" />
      {" AI đề xuất "}
      {pending.length}
      {" nhân vật mới"}
      {detail.series ? ` cho tập ${detail.series.episodeNumber}` : ""}
      <Badge tone="warning">Chờ duyệt</Badge>
    </h2>
    <p className="text-label-sm text-on-surface-variant">
      Duyệt xong mới tạo được ảnh cho các nhân vật này và khung hình của các cảnh có họ.
    </p>
    <ul className="flex flex-col gap-space-sm">
      {pending.map((a) => <li key={a.id} className="flex flex-col gap-1 rounded-lg bg-surface-container p-space-sm">
        <div className="flex flex-wrap items-baseline gap-space-sm">
          <span className="text-label-md text-on-surface">{a.name}</span>
          {a.summary && <span className="text-label-sm text-on-surface-variant">{"· "}{a.summary}</span>}
        </div>
        {a.proposalReason && <p className="text-label-sm italic text-on-surface-variant">"{a.proposalReason}"</p>}
        <p className="line-clamp-2 font-mono text-[11px] text-outline" title={a.description}>{a.description}</p>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Quyết định cho ${a.name}`}>
          {ACTIONS.map((o) => {
            const on = (choice[a.id] ?? "episode") === o.id;
            return <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={o.id === "series" && !detail.series}
              onClick={() => setChoice((c) => ({ ...c, [a.id]: o.id }))}
              className={cn(
                "rounded-full border px-space-sm py-0.5 text-label-sm disabled:opacity-40",
                on ? o.id === "drop" ? "border-error bg-error/10 text-error" : "border-primary bg-primary/15 text-primary" : "border-overlay/[0.12] text-on-surface-variant hover:bg-surface-container-high"
              )}
            >
              {on && <Check size={10} className="mr-0.5 inline" />}
              {o.label}
              {a.proposedScope === o.id && " (AI gợi ý)"}
            </button>;
          })}
        </div>
      </li>)}
    </ul>
    <div className="flex flex-wrap justify-end gap-space-sm">
      <Button size="sm" variant="subtle" disabled={resolve.isPending} onClick={() => submit(false)}>
        Duyệt, chưa tạo ảnh
      </Button>
      <Button size="sm" variant="primary" disabled={resolve.isPending || !kept.length} onClick={() => submit(true)}>
        {resolve.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}
        {" Duyệt & tạo ảnh "}
        {kept.length}
        {" nhân vật"}
      </Button>
    </div>
  </Card>;
}
