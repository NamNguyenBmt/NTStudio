import { BrowserWindow, dialog } from "electron";
import { writeFileSync } from "node:fs";
import { isNull, asc, count, inArray, eq, and, gte, lt, sum, sql } from "drizzle-orm";
import { workspaces, proxies, browserProfiles, accounts, channels, aiUsage, contentItems, scheduledPosts } from "../db/schema";
import { getDb, newId } from "../db/index";
import { notFound } from "../errors";

const DAY = 864e5;
const emptyCounts = () => ({ facebook: 0, tiktok: 0, instagram: 0, youtube: 0 });

function countMap(rows) {
  return new Map(rows.map((r) => [r.workspaceId, r.n]));
}

function listWorkspaces(now = Date.now()) {
  const db = getDb();
  const rows = db.select().from(workspaces).where(isNull(workspaces.archivedAt)).orderBy(asc(workspaces.sortOrder)).all();
  const channelRows = db.select({ workspaceId: channels.workspaceId, platform: channels.platform, health: channels.health }).from(channels).all();
  const accountCounts = countMap(db.select({ workspaceId: accounts.workspaceId, n: count() }).from(accounts).groupBy(accounts.workspaceId).all());
  const proxyRows = db.select({ workspaceId: proxies.workspaceId, health: proxies.health }).from(proxies).all();
  const contentCounts = countMap(
    db.select({ workspaceId: contentItems.workspaceId, n: count() }).from(contentItems).where(inArray(contentItems.status, ["ready", "scheduled"])).groupBy(contentItems.workspaceId).all()
  );
  const upcoming = countMap(
    db.select({ workspaceId: channels.workspaceId, n: count() }).from(scheduledPosts).innerJoin(channels, eq(channels.id, scheduledPosts.channelId)).where(and(eq(scheduledPosts.status, "queued"), gte(scheduledPosts.scheduledAt, new Date(now)), lt(scheduledPosts.scheduledAt, new Date(now + 7 * DAY)))).groupBy(channels.workspaceId).all()
  );
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
  const spend = new Map(
    db.select({ workspaceId: aiUsage.workspaceId, usd: sum(aiUsage.costUsd).mapWith(Number) }).from(aiUsage).where(gte(aiUsage.createdAt, monthStart)).groupBy(aiUsage.workspaceId).all().map((r) => [r.workspaceId, r.usd])
  );
  const noise = db.select({
    workspaceId: browserProfiles.workspaceId,
    total: count(),
    on: sql`sum(case when ${browserProfiles.canvasNoise} then 1 else 0 end)`.mapWith(Number)
  }).from(browserProfiles).groupBy(browserProfiles.workspaceId).all();
  return rows.map((ws) => {
    const platformCounts = emptyCounts();
    let unhealthyChannels = 0;
    for (const c of channelRows) {
      if (c.workspaceId !== ws.id) continue;
      platformCounts[c.platform]++;
      if (c.health === "warn" || c.health === "error") unhealthyChannels++;
    }
    const wsProxies = proxyRows.filter((p) => p.workspaceId === ws.id);
    const n = noise.find((x) => x.workspaceId === ws.id);
    return {
      ...ws,
      platformCounts,
      channelCount: platformCounts.facebook + platformCounts.tiktok + platformCounts.instagram,
      unhealthyChannels,
      accountCount: accountCounts.get(ws.id) ?? 0,
      proxyCount: wsProxies.length,
      proxyOk: wsProxies.filter((p) => p.health === "ok").length,
      contentReady: contentCounts.get(ws.id) ?? 0,
      postsPerDay: Math.round((upcoming.get(ws.id) ?? 0) / 7 * 10) / 10,
      aiSpentUsd: Math.round((spend.get(ws.id) ?? 0) * 100) / 100,
      canvasNoise: n ? n.on === n.total : null
    };
  });
}

export const workspaceHandlers = {
  "workspaces.list": () => listWorkspaces(),
  "workspaces.create": (input) => {
    const db = getDb();
    const [{ n }] = db.select({ n: count() }).from(workspaces).all();
    return db.transaction((tx) => {
      const ws = tx.insert(workspaces).values({ id: newId(), ...input, sortOrder: n }).returning().get();
      tx.insert(browserProfiles).values({ id: newId(), workspaceId: ws.id, name: `${ws.name} #1` }).run();
      return ws;
    });
  },
  "workspaces.update": ({ id, patch }) => {
    const row = getDb().update(workspaces).set({ ...patch, updatedAt: new Date() }).where(eq(workspaces.id, id)).returning().get();
    if (!row) throw notFound("không gian làm việc");
    return row;
  },
  // Lưu trữ thay vì xóa cứng: kênh/tài khoản vẫn giữ lại để không mất lịch sử
  "workspaces.archive": ({ id }) => {
    const res = getDb().update(workspaces).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(workspaces.id, id), isNull(workspaces.archivedAt))).run();
    if (res.changes === 0) throw notFound("không gian làm việc");
  },
  "workspaces.setCanvasNoise": ({ id, enabled }) => {
    getDb().update(browserProfiles).set({ canvasNoise: enabled, updatedAt: new Date() }).where(eq(browserProfiles.workspaceId, id)).run();
  },
  "workspaces.export": async () => {
    const win = BrowserWindow.getFocusedWindow();
    const opts = {
      title: "Xuất cấu hình Pocket",
      defaultPath: `omnipage-pockets-${(new Date()).toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    const db = getDb();
    const data = {
      format: "omnipage.pockets",
      version: 1,
      exportedAt: (new Date()).toISOString(),
      workspaces: db.select().from(workspaces).where(isNull(workspaces.archivedAt)).all(),
      proxies: db.select({
        id: proxies.id,
        workspaceId: proxies.workspaceId,
        label: proxies.label,
        protocol: proxies.protocol,
        host: proxies.host,
        port: proxies.port,
        username: proxies.username,
        country: proxies.country,
        kind: proxies.kind
      }).from(proxies).all(),
      browserProfiles: db.select().from(browserProfiles).all()
    };
    writeFileSync(res.filePath, JSON.stringify(data, null, 2), "utf8");
    return { path: res.filePath };
  }
};
