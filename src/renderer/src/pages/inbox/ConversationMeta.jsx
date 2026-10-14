import { useState } from "react";
import { useApiMutation } from "../../lib/api";
import { Plus, Tags, X } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { tagTone } from "./ConversationList";

export const actionLabel = {
  reply_comment: "Trả lời bình luận",
  send_dm: "Nhắn tin riêng",
  hide_comment: "Ẩn bình luận",
};

export function ConversationMeta({ conversation }) {
  const update = useApiMutation("inbox.update", ["inbox."]);
  const [newTag, setNewTag] = useState("");
  const setTags = (tags) => update.mutate({ conversationId: conversation.id, tags });
  const addTag = () => {
    const t = newTag.trim();
    if (!t) return;
    setTags([...conversation.tags, t]);
    setNewTag("");
  };
  return (
    <Card className="flex flex-col gap-space-md p-space-md">
      <h3 className="flex items-center gap-space-sm text-label-md uppercase tracking-wider text-on-surface-variant">
        <Tags size={14} />
        {" Hội thoại"}
      </h3>
      <div className="flex flex-col gap-1">
        <span className="text-label-sm text-outline">Trạng thái xử lý</span>
        <SegmentedControl
          label="Trạng thái hội thoại"
          value={conversation.status}
          onChange={(status) => update.mutate({ conversationId: conversation.id, status })}
          options={[
            { value: "open", label: "Mở" },
            { value: "pending", label: "Cần tư vấn" },
            { value: "resolved", label: "Đã xong" },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-label-sm text-outline">Nhãn</span>
        <div className="flex flex-wrap gap-1">
          {conversation.tags.length === 0 && <span className="text-body-sm text-on-surface-variant">Chưa có nhãn</span>}
          {conversation.tags.map((t) => (
            <Badge key={t} tone={tagTone(t)} className="pr-0.5">
              {t}
              <button
                type="button"
                aria-label={`Bỏ nhãn ${t}`}
                onClick={() => setTags(conversation.tags.filter((x) => x !== t))}
                className="rounded p-0.5 hover:bg-white/10"
              >
                <X size={10} />
              </button>
            </Badge>
          ))}
        </div>
        <form
          className="mt-1 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            addTag();
          }}
        >
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Thêm nhãn…"
            maxLength={40}
            aria-label="Nhãn mới"
          />
          <button
            type="submit"
            aria-label="Thêm nhãn"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-surface-container-high text-on-surface hover:bg-surface-bright"
          >
            <Plus size={14} />
          </button>
        </form>
      </div>
    </Card>
  );
}
