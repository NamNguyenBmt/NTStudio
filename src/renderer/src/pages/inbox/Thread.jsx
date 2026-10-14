import { useState, useRef, useEffect, useMemo } from "react";
import { call, useApiQuery, useApiMutation } from "../../lib/api";
import { Bot, CheckCheck, Check, Clock, ExternalLink, EyeOff, FaceSlightlySmiling, FileText, Image, LoaderCircle, MessageSquareQuote, Paperclip, Pencil, Plus, RotateCcw, Send, Sparkles, Tag, ThumbsUp, Trash, X, Zap } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { Input, Textarea } from "../../components/ui/Input";
import { Kbd } from "../../components/ui/Kbd";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";
import { PlatformAvatar } from "./PlatformAvatar";
import { Attachments } from "./Attachments";
import { attachmentKind } from "../../../../shared/video";
import { sourceLabel, time, dayLabel } from "./thread-utils";
import { EMOJIS, TAG_SUGGESTIONS, Popover } from "./Composer";

function DeliveryState({ m, platformLabel }) {
  const resend = useApiMutation("inbox.resend", ["inbox."]);
  if (m.deliveryStatus === "pending") {
    const later = m.sendAfter && m.sendAfter.getTime() > Date.now() + 1500;
    return <span className="flex items-center gap-0.5 text-warning" title={m.error ?? void 0}>
      <Clock size={10} />
      {" "}
      {m.error ? "Đang thử lại" : later ? `Gửi lúc ${time(m.sendAfter)}` : "Đang gửi"}
    </span>;
  }
  if (m.deliveryStatus === "failed") {
    return <span className="flex items-center gap-1 text-error" title={m.error ?? void 0}>
      Gửi lỗi
      <button
        type="button"
        disabled={resend.isPending}
        onClick={() => resend.mutate({ id: m.id }, { onError: (e) => toast.error(e.message) })}
        className="flex items-center gap-0.5 rounded px-1 text-primary hover:bg-overlay/[0.06]"
      >
        <RotateCcw size={10} />
        {" Gửi lại"}
      </button>
    </span>;
  }
  return <span className="flex items-center gap-0.5 text-tertiary">
    <CheckCheck size={10} />
    {" "}
    {m.action === "hide" ? "Đã ẩn" : `Đã gửi qua ${platformLabel}`}
  </span>;
}

function DraftCard({ m }) {
  const approve = useApiMutation("inbox.approveDraft", ["inbox."]);
  const discard = useApiMutation("inbox.discardDraft", ["inbox."]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const busy = approve.isPending || discard.isPending;
  return <div className="ml-auto flex w-[min(78%,520px)] flex-col gap-space-sm rounded-2xl rounded-tr-sm border border-dashed border-secondary/50 bg-secondary/[0.06] p-space-md">
    <div className="flex items-center gap-1 text-label-sm uppercase tracking-wider text-secondary">
      <Sparkles size={12} />
      {" AI soạn sẵn – chờ duyệt"}
    </div>
    {editing ? <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[80px]" maxLength={4e3} aria-label="Sửa câu trả lời" /> : <div className="whitespace-pre-wrap text-body-md text-on-surface">{m.body}</div>}
    {m.aiNote && <div className="text-label-sm text-on-surface-variant">{m.aiNote}</div>}
    <div className="flex flex-wrap justify-end gap-1">
      <Button size="sm" variant="subtle" disabled={busy} onClick={() => discard.mutate({ id: m.id }, { onError: (e) => toast.error(e.message) })}>
        <Trash size={12} />
        {" Bỏ"}
      </Button>
      {!editing && <Button size="sm" variant="subtle" disabled={busy} onClick={() => setEditing(true)}>
        <Pencil size={12} />
        {" Sửa"}
      </Button>}
      <Button
        size="sm"
        variant="primary"
        disabled={busy || !text.trim()}
        onClick={() => approve.mutate({ id: m.id, body: editing ? text : null }, { onSuccess: () => toast.success("Đã duyệt – đang gửi"), onError: (e) => toast.error(e.message) })}
      >
        <Check size={12} />
        {" "}
        {editing ? "Gửi bản đã sửa" : "Duyệt & gửi"}
      </Button>
    </div>
  </div>;
}

function Bubble({ m, platformLabel }) {
  if (m.deliveryStatus === "draft") return <DraftCard m={m} />;
  if (m.action === "like") {
    return <div className="mx-auto flex items-center gap-1 text-label-sm text-outline" title={m.error ?? void 0}>
      <ThumbsUp size={11} className={m.deliveryStatus === "failed" ? "text-error" : "text-secondary"} />
      {m.deliveryStatus === "pending" ? "Page sẽ thích bình luận này" : m.deliveryStatus === "failed" ? `Thích bình luận lỗi: ${m.error ?? ""}` : "Page đã thích bình luận"}
    </div>;
  }
  if (m.direction === "in") {
    return <div className="flex max-w-[78%] flex-col gap-1">
      <div className="rounded-2xl rounded-tl-sm bg-surface-container-high px-space-md py-space-sm text-body-md text-on-surface">
        {m.body}
        <Attachments urls={m.attachments} />
      </div>
      <span className="pl-1 font-mono text-[10px] text-outline">{time(m.createdAt)}</span>
    </div>;
  }
  if (m.action === "hide") {
    return <div className="mx-auto flex max-w-[90%] flex-col items-center gap-0.5 text-center">
      <span className="flex items-center gap-1 rounded-full bg-surface-container px-space-md py-1 text-label-sm text-on-surface-variant">
        <EyeOff size={11} />
        {" "}
        {m.body}
      </span>
      <span className="flex items-center gap-1 font-mono text-[10px] text-outline">
        {time(m.createdAt)}
        {" · "}
        <DeliveryState m={m} platformLabel={platformLabel} />
      </span>
      {m.deliveryStatus === "failed" && m.error && <span className="text-label-sm text-error">{m.error}</span>}
    </div>;
  }
  const bot = m.author === "bot";
  return <div className="ml-auto flex max-w-[78%] flex-col items-end gap-1">
    <div
      className={cn(
        "rounded-2xl rounded-tr-sm px-space-md py-space-sm text-body-md",
        bot ? "border border-secondary/20 bg-secondary/[0.08] text-on-surface" : "bg-primary-container/25 text-on-surface"
      )}
    >
      {bot && <div className="mb-1 flex items-center gap-1 text-label-sm uppercase tracking-wider text-secondary" title={m.aiNote ?? void 0}>
        {m.ruleId === "ai" ? <Sparkles size={12} /> : <Bot size={12} />}
        {" "}
        {m.ruleId === "ai" ? "AI trả lời" : "Bot trả lời tự động"}
      </div>}
      {m.body}
      <Attachments urls={m.attachments} />
    </div>
    <span className="flex items-center gap-1 pr-1 font-mono text-[10px] text-outline">
      {time(m.createdAt)}
      {" · "}
      <DeliveryState m={m} platformLabel={platformLabel} />
    </span>
    {m.deliveryStatus === "failed" && m.error && <span className="max-w-full pr-1 text-right text-label-sm text-error">{m.error}</span>}
  </div>;
}

export function Thread({ conversation, quickReplies }) {
  const { data: messages = [] } = useApiQuery("inbox.messages", { conversationId: conversation.id });
  const send = useApiMutation("inbox.send", ["inbox."]);
  const markRead = useApiMutation("inbox.markRead", ["inbox."]);
  const [draft, setDraft] = useState("");
  const suggest = useApiMutation("inbox.suggestReply", ["settings."]);
  const askSuggestion = () => suggest.mutate({ conversationId: conversation.id });
  const insertSuggestion = () => {
    if (!suggest.data) return;
    setDraft(suggest.data.text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const platformLabel = conversation.platform === "facebook" ? conversation.source === "comment" ? "Facebook" : "Messenger" : conversation.platform === "tiktok" ? "TikTok" : conversation.platform === "youtube" ? "YouTube" : "Instagram";
  const postUrl = !conversation.contextPostId ? null : conversation.platform === "youtube" ? `https://www.youtube.com/watch?v=${conversation.contextPostId}${conversation.externalId ? `&lc=${conversation.externalId}` : ""}` : conversation.platform === "facebook" ? `https://www.facebook.com/${conversation.contextPostId}` : null;
  useEffect(() => {
    setDraft("");
    suggest.reset();
    if (conversation.unreadCount > 0) markRead.mutate({ conversationId: conversation.id });
  }, [conversation.id]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && e.key.toLowerCase() === "a" && suggest.data) {
        e.preventDefault();
        insertSuggestion();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, conversation.id]);
  const slash = draft.startsWith("/") && !draft.includes(" ") ? draft.toLowerCase() : null;
  const suggestions = useMemo(() => slash ? quickReplies.filter((q) => q.shortcut.toLowerCase().startsWith(slash)) : [], [slash, quickReplies]);
  const insert = (text) => {
    setDraft(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const [files, setFiles] = useState([]);
  const [popup, setPopup] = useState(null);
  const [tagInput, setTagInput] = useState("");
  const update = useApiMutation("inbox.update", ["inbox."]);
  useEffect(() => {
    setFiles([]);
    setPopup(null);
  }, [conversation.id]);
  const fbComment = conversation.platform === "facebook" && conversation.source === "comment";
  const canAttach = conversation.platform === "facebook";
  const attachHint = !canAttach ? `${platformLabel} API chỉ gửi được tệp qua đường dẫn công khai – gửi ảnh/tệp trong ứng dụng ${platformLabel}` : fbComment ? "Trả lời bình luận kèm 1 ảnh" : null;
  const pick = async (images) => {
    try {
      const picked = await call("inbox.pickAttachments", { images, multiple: !fbComment });
      setFiles((cur) => fbComment ? picked.slice(0, 1) : [...cur, ...picked].slice(0, 5));
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const insertAtCursor = (text) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + text + draft.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const toggleTag = (t) => {
    const tags = conversation.tags.includes(t) ? conversation.tags.filter((x) => x !== t) : [...conversation.tags, t];
    update.mutate({ conversationId: conversation.id, tags });
  };
  const submit = () => {
    const body = draft.trim();
    if (!body && !files.length || send.isPending) return;
    send.mutate(
      { conversationId: conversation.id, body, attachments: files.map((f) => f.path) },
      {
        onSuccess: () => {
          setDraft("");
          setFiles([]);
        }
      }
    );
  };
  return <div className="flex min-h-0 flex-col rounded-xl bg-surface-container-low">
    <header className="flex items-center justify-between gap-space-md border-b border-overlay/[0.06] p-space-sm">
      <div className="flex min-w-0 items-center gap-space-sm">
        <PlatformAvatar name={conversation.customerName} platform={conversation.platform} size={40} />
        <div className="min-w-0">
          <div className="flex items-center gap-space-sm">
            <span className="truncate text-headline-sm text-on-surface">{conversation.customerName}</span>
            {conversation.customerExternalId && <Badge mono={true}>ID: #{conversation.customerExternalId}</Badge>}
          </div>
          <div className="truncate text-body-sm text-on-surface-variant">
            {"Nguồn: "}
            {conversation.channelName}
            {" · "}
            <span className="text-secondary">{sourceLabel[conversation.source]}</span>
          </div>
        </div>
      </div>
    </header>
    {conversation.contextPostTitle && <div className="flex items-center gap-space-sm border-b border-overlay/[0.06] bg-surface-container/50 px-space-md py-space-sm">
      <MessageSquareQuote size={16} className="shrink-0 text-secondary" />
      <div className="min-w-0 flex-1">
        <div className="text-label-sm uppercase tracking-wider text-secondary">Ngữ cảnh bài viết gốc</div>
        <div className="truncate text-label-md text-on-surface">{conversation.contextPostTitle}</div>
      </div>
      {postUrl ? <a
        href={postUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-[26px] items-center gap-1 rounded border border-white/10 bg-white/5 px-space-sm text-label-sm text-on-surface hover:bg-white/10"
      >
        {conversation.platform === "youtube" ? "Xem video" : "Xem bài"}
        {" "}
        <ExternalLink size={12} />
      </a> : <Button size="sm" variant="subtle" disabled={true} title="Instagram không có link công khai theo ID bài – mở trong ứng dụng Instagram">
        {"Xem bài "}
        <ExternalLink size={12} />
      </Button>}
    </div>}
    <div ref={scrollRef} className="scroll-thin flex min-h-0 flex-1 flex-col gap-space-md overflow-y-auto p-space-md">
      {messages[0] && <div className="self-center rounded-full bg-surface-container px-space-md py-0.5 font-mono text-[10px] text-outline">
        {dayLabel(messages[0].createdAt)}
      </div>}
      {messages.map((m) => <Bubble key={m.id} m={m} platformLabel={platformLabel} />)}
      <div className="rounded-xl border border-primary-container/30 bg-primary-container/[0.06] p-space-sm">
        <div className="flex items-center justify-between gap-space-sm">
          <span className="flex items-center gap-1.5 text-label-md text-primary">
            <Sparkles size={14} />
            {" Gợi ý phản hồi AI Co-Pilot"}
          </span>
          {suggest.data && <span className="font-mono text-[10px] text-outline">
            {suggest.data.meta.provider}
            {" · "}
            {suggest.data.meta.costUsd != null ? `$${suggest.data.meta.costUsd.toFixed(4)}` : "chưa có đơn giá"}
          </span>}
        </div>
        {suggest.isPending ? <p className="mt-1 flex items-center gap-1.5 text-body-sm text-on-surface-variant">
          <LoaderCircle size={13} className="animate-spin" />
          {" Đang soạn gợi ý theo brand voice & ngữ cảnh…"}
        </p> : suggest.data ? <p className="mt-1 whitespace-pre-line rounded-lg bg-surface-container-lowest p-space-sm text-body-md text-on-surface">
          "
          {suggest.data.text}
          "
        </p> : suggest.error ? <p className="mt-1 text-body-sm text-error">{suggest.error.message}</p> : <p className="mt-1 text-body-sm text-on-surface-variant">
          AI soạn câu trả lời theo Brand voice của Pocket, bài viết gốc và mẫu trả lời nhanh. Không tự bịa giá hay tồn kho.
        </p>}
        <div className="mt-space-sm flex gap-space-sm">
          {suggest.data ? <>
            <Button size="sm" variant="primary" onClick={insertSuggestion}>
              {"Chèn ngay "}
              <Kbd className="bg-black/20 text-on-primary">Alt+A</Kbd>
            </Button>
            <Button size="sm" variant="subtle" disabled={suggest.isPending} onClick={askSuggestion}>Sinh lại</Button>
          </> : <Button size="sm" variant="primary" disabled={suggest.isPending} onClick={askSuggestion}>
            <Sparkles size={12} />
            {" Gợi ý trả lời"}
          </Button>}
        </div>
      </div>
    </div>
    <div className="no-scrollbar flex items-center gap-space-sm overflow-x-auto border-t border-overlay/[0.06] px-space-sm py-1.5">
      <span className="flex shrink-0 items-center gap-1 text-label-sm text-on-surface-variant">
        <Zap size={12} />
        {" Phím gõ nhanh:"}
      </span>
      {quickReplies.map((q) => <button
        key={q.id}
        type="button"
        onClick={() => insert(q.body)}
        title={q.body}
        className="shrink-0 rounded bg-surface-container px-space-sm py-0.5 text-label-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
      >
        <span className="font-mono text-secondary">{q.shortcut}</span>
        {": "}
        {q.title}
      </button>)}
    </div>
    <div className="relative border-t border-overlay/[0.06] p-space-sm">
      {suggestions.length > 0 && <ul className="absolute bottom-full left-space-sm z-10 mb-1 w-80 rounded-xl bg-surface-container-high p-1 shadow-flyout">
        {suggestions.map((q) => <li key={q.id}>
          <button type="button" onClick={() => insert(q.body)} className="flex w-full flex-col rounded px-space-sm py-1 text-left hover:bg-overlay/[0.06]">
            <span className="font-mono text-code text-secondary">{q.shortcut}</span>
            <span className="truncate text-body-sm text-on-surface-variant">{q.body}</span>
          </button>
        </li>)}
      </ul>}
      <Textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === "Tab" && suggestions[0]) {
            e.preventDefault();
            insert(suggestions[0].body);
          }
        }}
        placeholder="Nhập tin nhắn phản hồi khách hàng… (gõ / để mở mẫu trả lời nhanh)"
        className="min-h-[64px]"
        aria-label="Nội dung trả lời"
      />
      {files.length > 0 && <div className="mt-space-xs flex flex-wrap gap-space-xs">
        {files.map((f) => <span key={f.path} className="flex items-center gap-1 rounded-lg bg-surface-container px-1.5 py-1 text-label-sm text-on-surface-variant">
          {attachmentKind(f.path) === "image" ? <img src={mediaUrl(f.path)} alt="" className="h-8 w-8 rounded object-cover" /> : <FileText size={14} />}
          <span className="max-w-[160px] truncate">{f.name}</span>
          <button
            type="button"
            aria-label={`Bỏ ${f.name}`}
            onClick={() => setFiles(files.filter((x) => x.path !== f.path))}
            className="rounded p-0.5 hover:bg-overlay/[0.08]"
          >
            <X size={11} />
          </button>
        </span>)}
      </div>}
      <div className="mt-space-sm flex items-center justify-between gap-space-sm">
        <div className="relative flex items-center gap-0.5">
          <IconButton icon={Image} label={attachHint ?? "Gửi kèm ảnh"} disabled={!canAttach} onClick={() => void pick(true)} />
          <IconButton icon={FaceSlightlySmiling} label="Chèn emoji" onClick={() => setPopup(popup === "emoji" ? null : "emoji")} />
          <IconButton
            icon={Paperclip}
            label={!canAttach ? attachHint : fbComment ? "Bình luận chỉ kèm được ảnh" : "Gửi kèm tệp (≤ 25 MB)"}
            disabled={!canAttach || fbComment}
            onClick={() => void pick(false)}
          />
          <IconButton icon={Tag} label="Gắn nhãn hội thoại" onClick={() => setPopup(popup === "tag" ? null : "tag")} />
          <Popover open={popup === "emoji"} onClose={() => setPopup(null)} className="left-0 w-[296px]">
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJIS.map((e) => <button
                key={e}
                type="button"
                onClick={() => insertAtCursor(e)}
                className="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-overlay/[0.08]"
                aria-label={`Chèn ${e}`}
              >
                {e}
              </button>)}
            </div>
          </Popover>
          <Popover open={popup === "tag"} onClose={() => setPopup(null)} className="left-0 w-64">
            <div className="mb-1 text-label-sm uppercase tracking-wider text-outline">Nhãn hội thoại</div>
            <div className="flex flex-wrap gap-1">
              {[...new Set([...conversation.tags, ...TAG_SUGGESTIONS])].map((t) => {
                const on = conversation.tags.includes(t);
                return <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-label-sm",
                    on ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-highest"
                  )}
                >
                  {on && <Check size={10} />}
                  {" "}
                  {t}
                </button>;
              })}
            </div>
            <form
              className="mt-space-sm flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const t = tagInput.trim();
                if (t && !conversation.tags.includes(t)) toggleTag(t);
                setTagInput("");
              }}
            >
              <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Nhãn mới…" maxLength={40} aria-label="Nhãn mới" className="h-7" />
              <Button size="sm" type="submit" disabled={!tagInput.trim()}><Plus size={12} /></Button>
            </form>
          </Popover>
        </div>
        <div className="flex items-center gap-space-sm">
          {send.error && <span className="text-label-sm text-error">{send.error.message}</span>}
          <span className="text-label-sm text-outline">Ctrl + Enter để gửi</span>
          <Button variant="primary" disabled={!draft.trim() && !files.length || send.isPending} onClick={submit}>
            {"Gửi tin nhắn "}
            <Send size={14} />
          </Button>
        </div>
      </div>
    </div>
  </div>;
}
