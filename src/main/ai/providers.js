import { eq, and } from "drizzle-orm";
import { readSecret } from "../vault";
import { aiProviders } from "../db/schema";
import { getDb, newId } from "../db/index";
import "../seed";
import { MANAGED_PROVIDERS, managedKey } from "../cloud/app-config";
import { PROVIDERS, providerInfo } from "../../shared/providers";

export class AiError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
  /** Lỗi tạm thời hoặc do nhà cung cấp → thử provider kế tiếp trong chuỗi */
  get retryable() {
    return ["rate_limit", "overloaded", "timeout", "network", "bad_request", "auth", "refusal", "invalid_output", "unknown"].includes(this.kind);
  }
}

export function providerRow(provider) {
  return getDb().select().from(aiProviders).where(eq(aiProviders.provider, provider)).get();
}

export function keyOwner(row) {
  const from = providerInfo(row.provider).keyFrom;
  if (!from || readSecret("ai_provider", row.id, "api_key") != null) return row;
  return providerRow(from) ?? row;
}

export function resolveKey(row) {
  const managed = managedKey(row.provider);
  if (managed) return { key: managed, baseUrl: row.baseUrl ?? null, owner: row };
  const owner = keyOwner(row);
  const key = readSecret("ai_provider", owner.id, "api_key");
  const from = providerInfo(row.provider).keyFrom;
  return key ? { key, baseUrl: row.baseUrl ?? (from ? providerRow(from)?.baseUrl ?? null : null), owner } : null;
}

export function requireKey(provider) {
  const row = providerRow(provider);
  if (!row) throw new AiError("no_provider", `Chưa có nhà cung cấp ${provider}`);
  if (MANAGED_PROVIDERS.has(provider)) {
    const k2 = resolveKey(row);
    if (!k2) throw new AiError("no_provider", "Kho video miễn phí chưa sẵn sàng – kiểm tra kết nối mạng / gói NT");
    return { key: k2.key, baseUrl: k2.baseUrl, row };
  }
  if (!row.enabled) throw new AiError("no_provider", `${row.label} đang tắt trong Cài đặt`);
  const k = resolveKey(row);
  if (!k) {
    const owner = keyOwner(row);
    throw new AiError(
      "no_provider",
      `${owner.id !== row.id ? `${row.label} dùng key ${owner.label}, nhưng ${owner.label}` : row.label} chưa có API key – nhập ở Cài đặt & Khóa API`
    );
  }
  return { key: k.key, baseUrl: k.baseUrl, row };
}

export function isReady(provider) {
  const row = providerRow(provider);
  if (row && MANAGED_PROVIDERS.has(provider)) return resolveKey(row) != null;
  if (!row || !row.enabled) return false;
  return providerInfo(provider).keyless === true || resolveKey(row) != null;
}

export function ensureProviders() {
  const db = getDb();
  const existing = new Set(
    db.select({ provider: aiProviders.provider }).from(aiProviders).all().map((r) => r.provider)
  );
  const renamed = { google_image: ["Google Nano Banana"], local_tts: ["VieNeu-TTS (Local · GPU)"] };
  for (const [provider, oldLabels] of Object.entries(renamed)) {
    const label = PROVIDERS[provider]?.label;
    if (label)
      for (const old of oldLabels)
        db.update(aiProviders).set({ label }).where(and(eq(aiProviders.provider, provider), eq(aiProviders.label, old))).run();
  }
  for (const [provider, info] of Object.entries(PROVIDERS)) {
    if (existing.has(provider)) continue;
    db.insert(aiProviders).values({
      id: newId(),
      provider,
      category: info.category,
      label: info.label,
      defaultModel: info.models[0]?.id ?? null,
      priority: info.priority ?? 9,
      status: info.keyless ? "valid" : "untested"
    }).run();
  }
}
