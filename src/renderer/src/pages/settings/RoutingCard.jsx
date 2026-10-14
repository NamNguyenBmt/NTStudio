import { useApiQuery, useApiMutation } from "../../lib/api";
import { ArrowDown, ArrowUp, GitBranch } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { IconButton } from "../../components/ui/IconButton";
import { Switch } from "../../components/ui/Switch";

export function RoutingCard() {
  const { data } = useApiQuery("ai.routing");
  const reorder = useApiMutation("ai.reorder", ["ai."]);
  const setFallback = useApiMutation("ai.setFallback", ["ai."]);
  const chain = data?.chain ?? [];
  const move = (i, dir) => {
    const ids = chain.map((c) => c.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate({ ids });
  };
  let rank = 0;
  return (
    <Card className="flex flex-col gap-space-sm p-space-md">
      <h3 className="flex items-center gap-space-sm text-label-md text-on-surface">
        <GitBranch size={15} className="text-secondary" />
        {" Thứ tự gọi & dự phòng (Text AI)"}
      </h3>
      <ol className="flex flex-col gap-1">
        {chain.map((c, i) => {
          const usable = c.enabled && c.hasKey;
          if (usable) rank++;
          return (
            <li
              key={c.id}
              className={cn(
                "flex items-center gap-space-sm rounded-lg bg-surface-container-lowest px-space-sm py-1",
                !usable && "opacity-60",
              )}
            >
              <span className="w-5 text-center font-mono text-code text-outline">{usable ? rank : "–"}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-label-md text-on-surface">{c.label}</div>
                <div className="truncate font-mono text-[10px] text-outline">{c.model ?? "—"}</div>
              </div>
              {!c.hasKey && <Badge tone="danger">Thiếu key</Badge>}
              {c.hasKey && !c.enabled && <Badge>Tắt</Badge>}
              <IconButton
                icon={ArrowUp}
                label={`Đưa ${c.label} lên`}
                disabled={i === 0 || reorder.isPending}
                onClick={() => move(i, -1)}
              />
              <IconButton
                icon={ArrowDown}
                label={`Đưa ${c.label} xuống`}
                disabled={i === chain.length - 1 || reorder.isPending}
                onClick={() => move(i, 1)}
              />
            </li>
          );
        })}
      </ol>
      <div className="flex items-start justify-between gap-space-md rounded-lg bg-surface-container p-space-sm">
        <div>
          <div className="text-label-md text-on-surface">Tự chuyển sang nhà cung cấp kế tiếp khi lỗi</div>
          <p className="text-label-sm text-on-surface-variant">
            Áp dụng khi bị giới hạn tần suất (429), quá tải, hết thời gian chờ hoặc key sai.
          </p>
        </div>
        <Switch
          checked={data?.fallbackOnError ?? true}
          onChange={(enabled) => setFallback.mutate({ enabled })}
          label="Fallback tự động"
        />
      </div>
    </Card>
  );
}
