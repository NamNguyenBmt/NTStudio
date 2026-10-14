import { eq, asc, inArray, and, desc } from "drizzle-orm";
import { workspaces, proxies, browserProfiles, accounts, channels, secrets } from "../db/schema";
import { getDb, newId } from "../db/index";
import { ApiError, notFound } from "../errors";

export function byWorkspace(column, workspaceId) {
  return workspaceId ? eq(column, workspaceId) : void 0;
}

function toProxy({ passwordSecretId, ...rest }) {
  return { ...rest, hasPassword: passwordSecretId != null };
}

function loadNodes(where) {
  const db = getDb();
  const accs = db.select().from(accounts).where(where).orderBy(asc(accounts.platform), asc(accounts.displayName)).all();
  if (accs.length === 0) return [];
  const ids = accs.map((a) => a.id);
  const chans = db.select().from(channels).where(inArray(channels.accountId, ids)).orderBy(asc(channels.name)).all();
  const proxyIds = accs.map((a) => a.proxyId).filter((p) => p != null);
  const proxyRows = proxyIds.length ? db.select().from(proxies).where(inArray(proxies.id, proxyIds)).all() : [];
  const cookieOwners = new Set(
    db
      .select({ ownerId: secrets.ownerId })
      .from(secrets)
      .where(and(eq(secrets.ownerType, "account"), eq(secrets.kind, "cookie"), inArray(secrets.ownerId, ids)))
      .all()
      .map((r) => r.ownerId),
  );
  const channelsByAccount = new Map();
  for (const c of chans) {
    const list = channelsByAccount.get(c.accountId) ?? [];
    list.push(c);
    channelsByAccount.set(c.accountId, list);
  }
  return accs.map((a) => {
    const proxy = proxyRows.find((p) => p.id === a.proxyId);
    return {
      ...a,
      proxy: proxy ? toProxy(proxy) : null,
      channels: channelsByAccount.get(a.id) ?? [],
      hasCookie: cookieOwners.has(a.id),
    };
  });
}

const channelKind = { facebook: "fb_page", tiktok: "tiktok_account", instagram: "ig_account", youtube: "yt_channel" };

export const accountHandlers = {
  "accounts.tree": ({ workspaceId }) => loadNodes(byWorkspace(accounts.workspaceId, workspaceId)),
  "accounts.get": ({ id }) => {
    const db = getDb();
    const [node] = loadNodes(eq(accounts.id, id));
    if (!node) throw notFound("tài khoản");
    const ws = node.workspaceId
      ? db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, node.workspaceId)).get()
      : void 0;
    const profile = node.browserProfileId
      ? (db.select().from(browserProfiles).where(eq(browserProfiles.id, node.browserProfileId)).get() ?? null)
      : null;
    const channelIds = node.channels.map((c) => c.id);
    const secretRows = db
      .select({
        kind: secrets.kind,
        preview: secrets.preview,
        expiresAt: secrets.expiresAt,
        updatedAt: secrets.updatedAt,
      })
      .from(secrets)
      .where(
        channelIds.length
          ? and(inArray(secrets.ownerId, [id, ...channelIds]), inArray(secrets.ownerType, ["account", "channel"]))
          : and(eq(secrets.ownerId, id), eq(secrets.ownerType, "account")),
      )
      .orderBy(desc(secrets.updatedAt))
      .all();
    return { ...node, workspaceName: ws?.name ?? null, profile, secrets: secretRows };
  },
  "accounts.create": (input) => {
    const db = getDb();
    return db.transaction((tx) => {
      const account = tx
        .insert(accounts)
        .values({ id: newId(), ...input })
        .returning()
        .get();
      if (input.platform !== "facebook") {
        tx.insert(channels)
          .values({
            id: newId(),
            accountId: account.id,
            workspaceId: account.workspaceId,
            platform: account.platform,
            kind: channelKind[account.platform],
            name: account.displayName,
            handle: account.handle,
            externalId: account.externalId,
          })
          .run();
      }
      return account;
    });
  },
  "accounts.update": ({ id, patch }) => {
    const db = getDb();
    return db.transaction((tx) => {
      const row = tx
        .update(accounts)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(accounts.id, id))
        .returning()
        .get();
      if (!row) throw notFound("tài khoản");
      if (patch.workspaceId !== void 0) {
        tx.update(channels)
          .set({ workspaceId: row.workspaceId, updatedAt: new Date() })
          .where(eq(channels.accountId, id))
          .run();
      }
      return row;
    });
  },
  "accounts.delete": ({ id }) => {
    const db = getDb();
    db.transaction((tx) => {
      const channelIds = tx
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.accountId, id))
        .all()
        .map((c) => c.id);
      const res = tx.delete(accounts).where(eq(accounts.id, id)).run();
      if (res.changes === 0) throw notFound("tài khoản");
      tx.delete(secrets)
        .where(and(eq(secrets.ownerType, "account"), eq(secrets.ownerId, id)))
        .run();
      if (channelIds.length)
        tx.delete(secrets)
          .where(and(eq(secrets.ownerType, "channel"), inArray(secrets.ownerId, channelIds)))
          .run();
    });
  },
  "channels.createPage": (input) => {
    const db = getDb();
    const parent = db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
    if (!parent) throw notFound("tài khoản VIA");
    if (parent.platform !== "facebook") throw new ApiError("VALIDATION", "Chỉ thêm Fanpage dưới tài khoản Facebook");
    return db
      .insert(channels)
      .values({ id: newId(), ...input, platform: "facebook", kind: "fb_page", workspaceId: parent.workspaceId })
      .returning()
      .get();
  },
  "channels.delete": ({ id }) => {
    const db = getDb();
    db.transaction((tx) => {
      const res = tx.delete(channels).where(eq(channels.id, id)).run();
      if (res.changes === 0) throw notFound("kênh");
      tx.delete(secrets)
        .where(and(eq(secrets.ownerType, "channel"), eq(secrets.ownerId, id)))
        .run();
    });
  },
  "channels.list": ({ workspaceId, platform }) =>
    getDb()
      .select({ channel: channels, accountName: accounts.displayName })
      .from(channels)
      .innerJoin(accounts, eq(accounts.id, channels.accountId))
      .where(and(byWorkspace(channels.workspaceId, workspaceId), platform ? eq(channels.platform, platform) : void 0))
      .orderBy(asc(channels.platform), asc(channels.name))
      .all()
      .map((r) => ({ ...r.channel, accountName: r.accountName })),
  "proxies.list": ({ workspaceId }) =>
    getDb()
      .select()
      .from(proxies)
      .where(byWorkspace(proxies.workspaceId, workspaceId))
      .orderBy(asc(proxies.label))
      .all()
      .map(toProxy),
  "proxies.create": (input) =>
    toProxy(
      getDb()
        .insert(proxies)
        .values({ id: newId(), ...input })
        .returning()
        .get(),
    ),
  "proxies.delete": ({ id }) => {
    const res = getDb().delete(proxies).where(eq(proxies.id, id)).run();
    if (res.changes === 0) throw notFound("proxy");
  },
};
