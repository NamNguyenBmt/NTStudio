import { useState } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { Pencil, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { Switch } from "../../components/ui/Switch";
import { actionLabel, ConversationMeta } from "./ConversationMeta";
import { RuleDialog } from "./RuleDialog";
import { AiReplyCard } from "./AiReplyCard";

export function InboxSidePanel({ conversation, workspaceId }) {
  const { data: rules = [] } = useApiQuery("inbox.rules", { workspaceId });
  const toggle = useApiMutation("inbox.toggleRule", ["inbox.", "dashboard."]);
  const [editing, setEditing] = useState(null);
  const shield = rules.filter((r) => r.action === "hide_comment");
  const replies = rules.filter((r) => r.action !== "hide_comment");
  const ruleCard = (r) => <li key={r.id} className="rounded-lg bg-surface-container-lowest p-space-sm">
    <div className="flex items-start justify-between gap-space-sm">
      <button type="button" onClick={() => setEditing({ mode: "edit", rule: r })} className="group min-w-0 text-left" title="Sửa luật">
        <div className="flex items-center gap-1 text-label-md text-on-surface">
          {r.name}
          {" "}
          <Pencil size={11} className="text-outline opacity-0 group-hover:opacity-100" />
        </div>
        <div className="text-label-sm text-on-surface-variant">{actionLabel[r.action]}</div>
      </button>
      <Switch checked={r.enabled} onChange={(enabled) => toggle.mutate({ id: r.id, enabled })} label={`Bật/tắt ${r.name}`} disabled={toggle.isPending} />
    </div>
    {r.keywords.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">
      {r.keywords.map((k) => <Badge key={k} mono={true}>{k === "{phone}" ? "số điện thoại" : k}</Badge>)}
    </div>}
    {r.template && <p className="mt-1.5 line-clamp-2 text-body-sm text-on-surface-variant">"{r.template}"</p>}
    {r.action !== "hide_comment" && <div className="mt-1.5 flex justify-between font-mono text-[10px] text-outline">
      <span>Độ trễ phản hồi tự nhiên</span>
      <span className="text-secondary">{r.minDelaySec}{" – "}{r.maxDelaySec}{" giây"}</span>
    </div>}
  </li>;
  return <div className="scroll-thin flex min-h-0 flex-col gap-space-md overflow-y-auto">
    {conversation && <ConversationMeta conversation={conversation} />}
    <AiReplyCard />
    <Card className="flex flex-col gap-space-sm p-space-md">
      <h3 className="flex items-center gap-space-sm text-label-md uppercase tracking-wider text-on-surface-variant">
        <ShieldCheck size={14} className="text-tertiary" />
        {" Bảo vệ chống cướp khách"}
      </h3>
      <p className="text-body-sm text-on-surface-variant">
        Tự động ẩn bình luận công khai chứa số điện thoại hoặc từ khóa nhạy cảm trên Page của bạn, tránh đối thủ nhắn tin cướp khách.
      </p>
      <ul className="flex flex-col gap-space-sm">
        {shield.length ? shield.map(ruleCard) : <li className="text-body-sm text-outline">Chưa có luật ẩn bình luận.</li>}
      </ul>
      <button
        type="button"
        onClick={() => setEditing({ mode: "new", action: "hide_comment" })}
        className="flex items-center gap-1 self-start rounded px-space-sm py-1 text-label-sm text-primary hover:bg-overlay/[0.04]"
      >
        <Plus size={12} />
        {" Thêm luật ẩn bình luận"}
      </button>
    </Card>
    <Card className="flex flex-col gap-space-sm p-space-md">
      <h3 className="flex items-center gap-space-sm text-label-md uppercase tracking-wider text-on-surface-variant">
        <SlidersHorizontal size={14} className="text-secondary" />
        {" Auto-Reply theo từ khóa"}
      </h3>
      <ul className="flex flex-col gap-space-sm">
        {replies.length ? replies.map(ruleCard) : <li className="text-body-sm text-outline">Chưa có luật trả lời tự động.</li>}
      </ul>
      <button
        type="button"
        onClick={() => setEditing({ mode: "new", action: "reply_comment" })}
        className="flex items-center gap-1 self-start rounded px-space-sm py-1 text-label-sm text-primary hover:bg-overlay/[0.04]"
      >
        <Plus size={12} />
        {" Thêm luật trả lời"}
      </button>
    </Card>
    <RuleDialog target={editing} workspaceId={workspaceId} onClose={() => setEditing(null)} />
  </div>;
}
