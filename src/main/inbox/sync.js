import { eq, and, inArray } from "drizzle-orm";
import { conversations, messages, settings } from "../db/schema";
import { getDb, newId } from "../db/index";
import { PublishError, graph } from "../publish/http";
import { readCred } from "../publish/credentials";
import { freshYoutubeCred, youtubeCommentThreads } from "../publish/youtube";

const stateKey = (channelId) => `inbox.sync.${channelId}`;

function syncState(channelId) {
  return (
    getDb()
      .select()
      .from(settings)
      .where(eq(settings.key, stateKey(channelId)))
      .get()?.value ?? null
  );
}

function saveState(channelId, state) {
  getDb()
    .insert(settings)
    .values({ key: stateKey(channelId), value: state })
    .onConflictDoUpdate({ target: settings.key, set: { value: state, updatedAt: new Date() } })
    .run();
}

function upsertThread(ch, conv, items, firstSync) {
  const db = getDb();
  return db.transaction((tx) => {
    let row = tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.channelId, ch.id), eq(conversations.externalId, conv.externalId)))
      .get();
    if (!row) {
      row = tx
        .insert(conversations)
        .values({
          id: newId(),
          workspaceId: ch.workspaceId,
          channelId: ch.id,
          platform: ch.platform,
          source: conv.source,
          externalId: conv.externalId,
          customerName: conv.customerName,
          customerExternalId: conv.customerExternalId,
          contextPostId: conv.contextPostId ?? null,
          contextPostTitle: conv.contextPostTitle ?? null,
        })
        .returning()
        .get();
    }
    const ids = items.map((m) => m.externalId);
    const existing = new Set(
      ids.length
        ? tx
            .select({ externalId: messages.externalId })
            .from(messages)
            .where(and(eq(messages.conversationId, row.id), inArray(messages.externalId, ids)))
            .all()
            .map((m) => m.externalId)
        : [],
    );
    const added = [];
    let unread = 0;
    let last = null;
    for (const m of [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      if (existing.has(m.externalId)) continue;
      const msg = tx
        .insert(messages)
        .values({
          id: newId(),
          conversationId: row.id,
          direction: m.inbound ? "in" : "out",
          // Tin đi ra không do app gửi = nhân viên trả lời trực tiếp trên nền tảng
          author: m.inbound ? "customer" : "agent",
          body: m.body,
          attachments: m.attachments,
          externalId: m.externalId,
          deliveryStatus: m.inbound ? null : "sent",
          createdAt: m.createdAt,
        })
        .returning()
        .get();
      if (m.inbound) {
        if (!firstSync) unread++;
        added.push({ conversation: row, message: msg });
      }
      if (!last || m.createdAt > last.createdAt) last = m;
    }
    if (last && (!row.lastMessageAt || last.createdAt >= row.lastMessageAt)) {
      row = tx
        .update(conversations)
        .set({
          lastMessageAt: last.createdAt,
          lastMessagePreview: last.body.slice(0, 140),
          unreadCount: row.unreadCount + unread,
          // Khách nhắn mới vào hội thoại đã xong → mở lại
          ...(unread && row.status === "resolved" ? { status: "open" } : {}),
          customerName: conv.customerName || row.customerName,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, row.id))
        .returning()
        .get();
    } else if (unread) {
      row = tx
        .update(conversations)
        .set({ unreadCount: row.unreadCount + unread, updatedAt: new Date() })
        .where(eq(conversations.id, row.id))
        .returning()
        .get();
    }
    return firstSync ? [] : added.map((a) => ({ ...a, conversation: row }));
  });
}

const attachmentsOf = (m) =>
  (m.attachments?.data ?? []).map((a) => a.image_data?.url ?? a.file_url ?? "").filter((u) => u.startsWith("https://"));
const bodyOf = (text, attachments) =>
  text?.trim() || (attachments.length ? "[Tệp đính kèm]" : "[Tin nhắn không có nội dung]");

async function syncDirect(ch, cred, platform, selfId, firstSync, signal) {
  const res = await graph("GET", `${cred.pageId}/conversations`, {
    token: cred.token,
    signal,
    query: {
      platform,
      fields: "id,updated_time,participants,messages.limit(20){id,message,created_time,from,attachments}",
      limit: 25,
    },
  });
  const out = [];
  for (const c of res.data ?? []) {
    const customer = c.participants?.data?.find((p) => p.id !== selfId && p.id !== cred.pageId);
    const items = (c.messages?.data ?? []).map((m) => {
      const att = attachmentsOf(m);
      return {
        externalId: m.id,
        body: bodyOf(m.message, att),
        createdAt: new Date(m.created_time),
        inbound: !!m.from && m.from.id !== selfId && m.from.id !== cred.pageId,
        attachments: att,
      };
    });
    out.push(
      ...upsertThread(
        ch,
        {
          externalId: c.id,
          source: platform === "messenger" ? "messenger" : "direct",
          customerName: customer?.name ?? (customer?.username ? `@${customer.username}` : "Khách hàng"),
          customerExternalId: customer?.id ?? null,
        },
        items,
        firstSync,
      ),
    );
  }
  return out;
}

function commentThreads(ch, posts, isSelf, firstSync) {
  const out = [];
  for (const post of posts) {
    const title = (post.message ?? post.caption ?? "").trim().slice(0, 120) || "Bài viết";
    for (const top of post.comments?.data ?? []) {
      if (isSelf(top)) continue;
      const toItem = (c) => ({
        externalId: c.id,
        body: bodyOf(c.message ?? c.text, []),
        createdAt: new Date(c.created_time ?? c.timestamp ?? Date.now()),
        inbound: !isSelf(c),
        attachments: [],
      });
      const thread = [top, ...(top.comments?.data ?? []), ...(top.replies?.data ?? [])].map(toItem);
      const name =
        top.from?.name ??
        (top.from?.username ? `@${top.from.username}` : top.username ? `@${top.username}` : "Người dùng Facebook");
      out.push(
        ...upsertThread(
          ch,
          {
            externalId: top.id,
            source: "comment",
            customerName: name,
            customerExternalId: top.from?.id ?? null,
            contextPostId: post.id,
            contextPostTitle: title,
          },
          thread,
          firstSync,
        ),
      );
    }
  }
  return out;
}

async function syncFbComments(ch, cred, firstSync, signal) {
  const res = await graph("GET", `${cred.pageId}/feed`, {
    token: cred.token,
    signal,
    query: {
      fields:
        "id,message,comments.limit(25).filter(toplevel).order(reverse_chronological){id,message,created_time,from{id,name},comments.limit(25){id,message,created_time,from{id,name}}}",
      limit: 10,
    },
  });
  return commentThreads(ch, res.data ?? [], (c) => c.from?.id === cred.pageId, firstSync);
}

async function syncIgComments(ch, cred, firstSync, signal) {
  const res = await graph("GET", `${cred.igUserId}/media`, {
    token: cred.token,
    signal,
    query: {
      fields:
        "id,caption,comments.limit(25){id,text,timestamp,username,from{id,username},replies.limit(25){id,text,timestamp,username,from{id,username}}}",
      limit: 10,
    },
  });
  const handle = (ch.handle ?? "").replace(/^@/, "").toLowerCase();
  return commentThreads(
    ch,
    res.data ?? [],
    (c) =>
      c.from?.id === cred.igUserId || (!!handle && (c.username ?? c.from?.username ?? "").toLowerCase() === handle),
    firstSync,
  );
}

async function syncYoutubeComments(ch, cred, firstSync, signal) {
  const fresh = await freshYoutubeCred(ch.id, cred, signal);
  const own = fresh.channelId ?? ch.externalId ?? "";
  const threads = await youtubeCommentThreads(own, fresh.token, signal);
  const out = [];
  for (const t of threads) {
    if (t.top.authorChannelId === own) continue;
    const toItem = (c) => ({
      externalId: c.id,
      body: c.text.trim() || "[Bình luận trống]",
      createdAt: new Date(c.publishedAt),
      inbound: c.authorChannelId !== own,
      attachments: [],
    });
    out.push(
      ...upsertThread(
        ch,
        {
          externalId: t.id,
          source: "comment",
          customerName: t.top.author,
          customerExternalId: t.top.authorChannelId,
          contextPostId: t.videoId,
          contextPostTitle: t.videoTitle ?? (t.videoId ? `Video ${t.videoId}` : "Video YouTube"),
        },
        [t.top, ...t.replies].map(toItem),
        firstSync,
      ),
    );
  }
  return out;
}

export async function syncChannel(ch, signal, scope = "all") {
  const cred = readCred(ch.id);
  if (!cred) return { added: [], errors: [], rateLimited: false };
  const firstSync = syncState(ch.id) == null;
  const withComments = scope === "all" || firstSync;
  const added = [];
  const errors = [];
  let attempted = 0;
  let rateLimited = false;
  const run = async (label, fn) => {
    attempted++;
    try {
      added.push(...(await fn()));
    } catch (err) {
      if (signal.aborted) throw err;
      if (err instanceof PublishError && err.kind === "rate_limit") rateLimited = true;
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  if (ch.platform === "facebook" && cred.pageId) {
    await run("Messenger", () => syncDirect(ch, cred, "messenger", cred.pageId, firstSync, signal));
    if (withComments) await run("Bình luận", () => syncFbComments(ch, cred, firstSync, signal));
  } else if (ch.platform === "youtube") {
    if (!withComments) return { added: [], errors: [], rateLimited: false };
    await run("Bình luận YouTube", () => syncYoutubeComments(ch, cred, firstSync, signal));
  } else if (ch.platform === "instagram" && cred.pageId && cred.igUserId) {
    await run("Instagram Direct", () => syncDirect(ch, cred, "instagram", cred.igUserId, firstSync, signal));
    if (withComments) await run("Bình luận IG", () => syncIgComments(ch, cred, firstSync, signal));
  } else return { added: [], errors: [], rateLimited: false };
  const allFailed = errors.length === attempted;
  if (!(firstSync && allFailed))
    saveState(ch.id, {
      at: Date.now(),
      ok: !errors.length,
      ...(errors.length ? { error: errors.join(" · ").slice(0, 400) } : {}),
    });
  return { added, errors, rateLimited };
}
