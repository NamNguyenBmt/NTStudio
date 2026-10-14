import { staggerPrefs, staggerTime, queuedTimesNear } from "../posts/stagger";
import { existsSync } from "node:fs";
import { isAbsolute, join, extname } from "node:path";
import { and, inArray, sql, desc, eq, gte, lt, count, asc } from "drizzle-orm";
import { channels, contentItems, scheduledPosts } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError, notFound } from "../errors";
import { mediaDir } from "../media/paths";
import { probeDuration } from "../media/ffmpeg";
import { byWorkspace } from "./accounts";

const MEDIA_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".m4v"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v"]);

async function checkMedia(paths) {
  if (!paths) return {};
  const abs = (p) => (isAbsolute(p) ? p : join(mediaDir(), p));
  for (const p of paths) {
    if (!MEDIA_EXT.has(extname(p).toLowerCase()))
      throw new ApiError("VALIDATION", `Định dạng không hỗ trợ: ${p.split(/[\\/]/).pop()}`);
    if (!existsSync(abs(p))) throw new ApiError("VALIDATION", `Không tìm thấy file: ${p.split(/[\\/]/).pop()}`);
  }
  const video = paths.find((p) => VIDEO_EXT.has(extname(p).toLowerCase()));
  let durationSec = null;
  if (video) durationSec = await probeDuration(abs(video)).catch(() => null);
  return { mediaPaths: paths, ...(video ? { durationSec } : {}) };
}

const likePattern = (q) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

export const contentHandlers = {
  "content.list": ({ workspaceId, status, search }) =>
    getDb()
      .select()
      .from(contentItems)
      .where(
        and(
          byWorkspace(contentItems.workspaceId, workspaceId),
          status?.length ? inArray(contentItems.status, status) : void 0,
          search ? sql`${contentItems.title} like ${likePattern(search)} escape '\\'` : void 0,
        ),
      )
      .orderBy(desc(contentItems.createdAt))
      .all(),
  "content.create": async (input) => {
    const media = await checkMedia(input.mediaPaths);
    return getDb()
      .insert(contentItems)
      .values({ id: newId(), ...input, ...media })
      .returning()
      .get();
  },
  "content.update": async ({ id, patch }) => {
    const media = await checkMedia(patch.mediaPaths);
    const row = getDb()
      .update(contentItems)
      .set({ ...patch, ...media, updatedAt: new Date() })
      .where(eq(contentItems.id, id))
      .returning()
      .get();
    if (!row) throw notFound("nội dung");
    return row;
  },
  "content.bulkMove": ({ ids, workspaceId }) => {
    const res = getDb()
      .update(contentItems)
      .set({ workspaceId, updatedAt: new Date() })
      .where(inArray(contentItems.id, ids))
      .run();
    return { updated: res.changes };
  },
  // Xóa kéo theo các bài đã lên lịch (FK cascade) – UI phải xác nhận trước
  "content.bulkDelete": ({ ids }) => ({
    deleted: getDb().delete(contentItems).where(inArray(contentItems.id, ids)).run().changes,
  }),
  "content.stats": ({ workspaceId }) => {
    const db = getDb();
    const ws = byWorkspace(contentItems.workspaceId, workspaceId);
    const rows = db
      .select({
        kind: contentItems.kind,
        status: contentItems.status,
        spinVariants: contentItems.spinVariants,
        createdAt: contentItems.createdAt,
      })
      .from(contentItems)
      .where(ws)
      .all();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const byKind = { video: 0, reel: 0, image: 0, carousel: 0, text: 0 };
    for (const r of rows) byKind[r.kind]++;
    const now = Date.now();
    const channelRows = db
      .select({ id: channels.id })
      .from(channels)
      .where(and(byWorkspace(channels.workspaceId, workspaceId), eq(channels.status, "active")))
      .all();
    const busy = new Set(
      db
        .select({ channelId: scheduledPosts.channelId })
        .from(scheduledPosts)
        .where(
          and(
            eq(scheduledPosts.status, "queued"),
            gte(scheduledPosts.scheduledAt, new Date(now)),
            lt(scheduledPosts.scheduledAt, new Date(now + 7 * 864e5)),
          ),
        )
        .all()
        .map((r) => r.channelId),
    );
    return {
      total: rows.length,
      addedToday: rows.filter((r) => r.createdAt >= startOfDay).length,
      spun: rows.filter((r) => r.spinVariants > 0).length,
      spinVariants: rows.reduce((a, r) => a + r.spinVariants, 0),
      ready: rows.filter((r) => r.status === "ready").length,
      idleChannels: channelRows.filter((c) => !busy.has(c.id)).length,
      // Đếm theo workspace luôn trên toàn bộ kho (để hiện số trên chip lọc)
      byWorkspace: db
        .select({ workspaceId: contentItems.workspaceId, n: count() })
        .from(contentItems)
        .groupBy(contentItems.workspaceId)
        .all(),
      byKind,
    };
  },
  "content.delete": ({ id }) => {
    const res = getDb().delete(contentItems).where(eq(contentItems.id, id)).run();
    if (res.changes === 0) throw notFound("nội dung");
  },
  "posts.range": ({ from, to, workspaceId }) =>
    getDb()
      .select({
        post: scheduledPosts,
        contentTitle: contentItems.title,
        contentKind: contentItems.kind,
        thumbnailPath: contentItems.thumbnailPath,
        channelName: channels.name,
        platform: channels.platform,
        workspaceId: channels.workspaceId,
        tokenStatus: channels.tokenStatus,
      })
      .from(scheduledPosts)
      .innerJoin(contentItems, eq(contentItems.id, scheduledPosts.contentItemId))
      .innerJoin(channels, eq(channels.id, scheduledPosts.channelId))
      .where(
        and(
          gte(scheduledPosts.scheduledAt, new Date(from)),
          lt(scheduledPosts.scheduledAt, new Date(to)),
          byWorkspace(channels.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(scheduledPosts.scheduledAt))
      .all()
      .map(({ post, ...rest }) => ({ ...post, ...rest })),
  "posts.schedule": ({ contentItemId, channelId, scheduledAt }) => {
    if (scheduledAt < Date.now() - 5 * 6e4) throw new ApiError("VALIDATION", "Không thể lên lịch vào thời điểm đã qua");
    const db = getDb();
    return db.transaction((tx) => {
      const content = tx
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(eq(contentItems.id, contentItemId))
        .get();
      if (!content) throw notFound("nội dung");
      const channel = tx.select({ id: channels.id }).from(channels).where(eq(channels.id, channelId)).get();
      if (!channel) throw notFound("kênh");
      const at = staggerTime(scheduledAt, queuedTimesNear(tx, scheduledAt), staggerPrefs(tx));
      const post = tx
        .insert(scheduledPosts)
        .values({ id: newId(), contentItemId, channelId, scheduledAt: new Date(at) })
        .returning()
        .get();
      tx.update(contentItems)
        .set({ status: "scheduled", updatedAt: new Date() })
        .where(eq(contentItems.id, contentItemId))
        .run();
      return post;
    });
  },
  "posts.reschedule": ({ id, scheduledAt }) => {
    if (scheduledAt < Date.now() - 5 * 6e4) throw new ApiError("VALIDATION", "Không thể dời lịch về thời điểm đã qua");
    const db = getDb();
    const post = db
      .select({ status: scheduledPosts.status })
      .from(scheduledPosts)
      .where(eq(scheduledPosts.id, id))
      .get();
    if (!post) throw notFound("bài đăng");
    if (post.status !== "queued" && post.status !== "failed") {
      throw new ApiError("CONFLICT", "Chỉ dời lịch được bài đang chờ hoặc bị lỗi");
    }
    return db.transaction((tx) => {
      const at = staggerTime(scheduledAt, queuedTimesNear(tx, scheduledAt, id), staggerPrefs(tx));
      const row = tx
        .update(scheduledPosts)
        .set({
          scheduledAt: new Date(at),
          status: "queued",
          error: null,
          attempts: 0,
          nextAttemptAt: null,
          updatedAt: new Date(),
        })
        .where(eq(scheduledPosts.id, id))
        .returning({ contentItemId: scheduledPosts.contentItemId })
        .get();
      if (row)
        tx.update(contentItems)
          .set({ status: "scheduled", updatedAt: new Date() })
          .where(and(eq(contentItems.id, row.contentItemId), eq(contentItems.status, "failed")))
          .run();
      return { scheduledAt: at };
    });
  },
  "posts.cancel": ({ id }) => {
    const db = getDb();
    db.transaction((tx) => {
      const post = tx
        .update(scheduledPosts)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(scheduledPosts.id, id), inArray(scheduledPosts.status, ["queued", "failed"])))
        .returning({ contentItemId: scheduledPosts.contentItemId })
        .get();
      if (!post) throw new ApiError("CONFLICT", "Bài đăng không tồn tại hoặc đã được xử lý");
      const others = tx
        .select({ id: scheduledPosts.id })
        .from(scheduledPosts)
        .where(
          and(
            eq(scheduledPosts.contentItemId, post.contentItemId),
            inArray(scheduledPosts.status, ["queued", "publishing", "published"]),
          ),
        )
        .get();
      if (!others) {
        tx.update(contentItems)
          .set({ status: "ready", updatedAt: new Date() })
          .where(and(eq(contentItems.id, post.contentItemId), inArray(contentItems.status, ["scheduled", "failed"])))
          .run();
      }
    });
  },
};
