import { useState, useMemo } from "react";
import { Bot, Search } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Input } from "../../components/ui/Input";
import { PlatformIcon } from "../../components/PlatformIcon";
import { formatRelative } from "../../lib/format";
import { PlatformAvatar } from "./PlatformAvatar";

export function tagTone(tag) {
  const t = tag.toLowerCase();
  if (t.includes("khiếu nại") || t.includes("hoàn")) return "danger";
  if (t.includes("vip")) return "success";
  if (t.includes("giá") || t.includes("size") || t.includes("tư vấn")) return "primary";
  if (t.includes("tích cực")) return "success";
  return "neutral";
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect
}) {
  const [platform, setPlatform] = useState("all");
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const count = (p) => conversations.filter((c) => c.platform === p).length;
  const scoped = conversations.filter((c) => platform === "all" || c.platform === platform);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter((c) => {
      if (tab === "unread" && c.unreadCount === 0) return false;
      if (tab === "pending" && c.status !== "pending") return false;
      if (tab === "drafts" && c.drafts === 0) return false;
      if (tab === "comment" && c.source !== "comment") return false;
      if (!q) return true;
      return [c.customerName, c.customerExternalId, c.lastMessagePreview, c.channelName].some((v) => v?.toLowerCase().includes(q));
    });
  }, [scoped, tab, query]);
  const platformChips = [
    { value: "all", label: "Tất cả", n: conversations.length },
    { value: "facebook", label: "FB", n: count("facebook"), dot: "bg-brand-facebook" },
    { value: "tiktok", label: "TikTok", n: count("tiktok"), dot: "bg-brand-tiktok-cyan" },
    { value: "instagram", label: "IG", n: count("instagram"), dot: "bg-brand-instagram" },
    { value: "youtube", label: "YT", n: count("youtube"), dot: "bg-brand-youtube" }
  ];
  const tabs = [
    { value: "all", label: "Tất cả" },
    { value: "unread", label: "Chưa đọc", n: scoped.filter((c) => c.unreadCount > 0).length },
    { value: "drafts", label: "AI chờ duyệt", n: scoped.filter((c) => c.drafts > 0).length },
    { value: "pending", label: "Cần tư vấn", n: scoped.filter((c) => c.status === "pending").length },
    { value: "comment", label: "Comment" }
  ];
  return <div className="flex min-h-0 flex-col rounded-xl bg-surface-container-low">
    <div className="flex flex-col gap-space-sm border-b border-overlay/[0.06] p-space-sm">
      <div className="flex items-center justify-between px-1">
        <span className="text-label-sm uppercase tracking-wider text-outline">Kênh tiếp nhận</span>
        <Badge tone="primary" mono={true}>
          {conversations.filter((c) => c.unreadCount > 0).length}
          {" hội thoại mới"}
        </Badge>
      </div>
      <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Lọc nền tảng">
        {platformChips.map((c) => <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={platform === c.value}
          onClick={() => setPlatform(c.value)}
          className={cn(
            "flex h-8 items-center justify-center gap-1 rounded-lg text-label-md transition-colors",
            platform === c.value ? "bg-surface-container-high text-on-surface shadow-highlight" : "text-on-surface-variant hover:bg-surface-container"
          )}
        >
          {["facebook", "tiktok", "instagram", "youtube"].includes(c.value) ? <PlatformIcon platform={c.value} size={12} /> : c.dot && <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />}
          {c.label}
          <span className="font-mono text-[10px] text-outline">{c.n}</span>
        </button>)}
      </div>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên, nội dung, kênh…" className="pl-8" aria-label="Tìm hội thoại" />
      </div>
      <div className="no-scrollbar flex gap-1 overflow-x-auto" role="tablist">
        {tabs.map((t) => <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={tab === t.value}
          onClick={() => setTab(t.value)}
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded px-space-sm text-label-md transition-colors",
            tab === t.value ? "bg-primary-container text-on-primary" : "text-on-surface-variant hover:bg-surface-container"
          )}
        >
          {t.label}
          {t.n != null && t.n > 0 && <span className="font-mono text-[10px]">{"· "}{t.n}</span>}
        </button>)}
      </div>
    </div>
    <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1">
      {visible.length === 0 && <li className="p-space-lg text-center text-body-sm text-on-surface-variant">Không có hội thoại phù hợp</li>}
      {visible.map((c) => {
        const active = c.id === selectedId;
        return <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn(
              "relative flex w-full flex-col gap-1.5 rounded-lg p-space-sm text-left transition-colors",
              active ? "bg-surface-container-high" : "hover:bg-surface-container"
            )}
          >
            {active && <span className="absolute left-0 top-3 h-8 w-[3px] rounded-full bg-primary-container" />}
            <div className="flex items-start gap-space-sm">
              <PlatformAvatar name={c.customerName} platform={c.platform} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-space-sm">
                  <span className={cn("truncate text-label-md", c.unreadCount > 0 ? "text-on-surface" : "text-on-surface-variant")}>
                    {c.customerName}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-outline">
                    {c.lastMessageAt ? formatRelative(c.lastMessageAt) : ""}
                  </span>
                </div>
                <div className="truncate text-label-sm text-secondary">
                  {c.source === "comment" ? "Comment" : c.source === "messenger" ? "Messenger" : "Direct"}
                  {" · "}
                  {c.channelName}
                </div>
              </div>
            </div>
            <p className={cn("line-clamp-2 text-body-sm", c.unreadCount > 0 ? "text-on-surface" : "text-on-surface-variant")}>
              "
              {c.lastMessagePreview}
              "
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {c.drafts > 0 && <Badge tone="secondary">{"AI chờ duyệt · "}{c.drafts}</Badge>}
              {c.tags.map((t) => <Badge key={t} tone={tagTone(t)}>{t}</Badge>)}
              {c.unreadCount > 0 && <span className="ml-auto h-2 w-2 rounded-full bg-secondary" aria-label={`${c.unreadCount} chưa đọc`} />}
              {c.unreadCount === 0 && c.status === "resolved" && <span className="ml-auto flex items-center gap-1 text-label-sm text-tertiary">
                <Bot size={11} />
                {" Đã xử lý"}
              </span>}
            </div>
          </button>
        </li>;
      })}
    </ul>
  </div>;
}
