import { eq, and, asc, sum, gte } from "drizzle-orm";
import { secrets, aiProviders, aiUsage, settings } from "../db/schema";
import { getDb } from "../db/index";
import { ApiError, notFound } from "../errors";
import { vaultAvailable, vaultFingerprint, putSecret, deleteSecret } from "../vault";
import { providerInfo } from "../../shared/providers";
import { testWithDependents, testModel } from "../ai/router";

const KEY_CAP = "budget.monthlyHardCapUsd";
const KEY_BREAKER = "budget.circuitBreaker";

function getSetting(key, fallback) {
  const row = getDb().select().from(settings).where(eq(settings.key, key)).get();
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
    .run();
}

const backendName = () =>
  process.platform === "win32"
    ? "Windows DPAPI"
    : process.platform === "darwin"
      ? "macOS Keychain"
      : "libsecret / kwallet";

export const settingsHandlers = {
  "ai.providers": () => {
    const db = getDb();
    const keys = db
      .select({ ownerId: secrets.ownerId, preview: secrets.preview })
      .from(secrets)
      .where(and(eq(secrets.ownerType, "ai_provider"), eq(secrets.kind, "api_key")))
      .all();
    return db
      .select()
      .from(aiProviders)
      .orderBy(asc(aiProviders.category), asc(aiProviders.priority))
      .all()
      .map((p) => {
        const key = keys.find((k) => k.ownerId === p.id);
        const live = db
          .select()
          .from(settings)
          .where(eq(settings.key, `ai.models.${p.id}`))
          .get();
        return {
          ...p,
          hasKey: key != null,
          keyPreview: key?.preview ?? null,
          liveModels: Array.isArray(live?.value) ? live.value : [],
        };
      });
  },
  "ai.updateProvider": ({ id, patch }) => {
    const res = getDb()
      .update(aiProviders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(aiProviders.id, id))
      .run();
    if (res.changes === 0) throw notFound("nhà cung cấp");
  },
  "ai.setKey": async ({ providerId, key }) => {
    const db = getDb();
    const provider = db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).get();
    if (!provider) throw notFound("nhà cung cấp");
    const info = providerInfo(provider.provider);
    if (info.keyless) throw new ApiError("VALIDATION", `${provider.label} không cần API key`);
    putSecret({ kind: "api_key", ownerType: "ai_provider", ownerId: providerId, value: key });
    db.update(aiProviders)
      .set({ status: "untested", lastTestedAt: null, lastError: null, updatedAt: new Date() })
      .where(eq(aiProviders.id, providerId))
      .run();
    return testWithDependents(providerId);
  },
  "ai.testModel": ({ id }) => testModel(id),
  "ai.removeKey": ({ providerId }) => {
    if (!deleteSecret("ai_provider", providerId, "api_key")) throw notFound("API key");
    getDb()
      .update(aiProviders)
      .set({ status: "untested", updatedAt: new Date() })
      .where(eq(aiProviders.id, providerId))
      .run();
  },
  "vault.info": () => ({ available: vaultAvailable(), fingerprint: vaultFingerprint(), backend: backendName() }),
  "settings.budget": () => {
    const db = getDb();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const rows = db
      .select({ providerId: aiUsage.providerId, label: aiProviders.label, usd: sum(aiUsage.costUsd).mapWith(Number) })
      .from(aiUsage)
      .leftJoin(aiProviders, eq(aiProviders.id, aiUsage.providerId))
      .where(gte(aiUsage.createdAt, monthStart))
      .groupBy(aiUsage.providerId)
      .all();
    const byProvider = rows
      .map((r) => ({ providerId: r.providerId, label: r.label ?? "Khác", usd: Math.round(r.usd * 100) / 100 }))
      .sort((a, b) => b.usd - a.usd);
    return {
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      hardCapUsd: getSetting(KEY_CAP, 50),
      circuitBreaker: getSetting(KEY_BREAKER, true),
      spentUsd: Math.round(byProvider.reduce((a, r) => a + r.usd, 0) * 100) / 100,
      byProvider,
    };
  },
  "settings.setBudget": ({ hardCapUsd, circuitBreaker }) => {
    getDb().transaction(() => {
      setSetting(KEY_CAP, hardCapUsd);
      setSetting(KEY_BREAKER, circuitBreaker);
    });
  },
};
