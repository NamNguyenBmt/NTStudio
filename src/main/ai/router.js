import { eq, sum, and, gte, isNull, asc } from "drizzle-orm";
import { workspaces, aiProviders, aiUsage, alerts, settings } from "../db/schema";
import { getDb, newId } from "../db/index";
import { isUsableModel, preferredModel, providerInfo } from "../../shared/providers";
import { AiError, keyOwner, resolveKey } from "./providers";
import { OMNIRA_AI_LABEL, omniraChat } from "./adapters/omnira";
import { estimateCostUsd } from "../../shared/pricing";
import { ADAPTERS } from "./adapters/index";

const CHAT_TIMEOUT_MS = 9e4;
const TEST_TIMEOUT_MS = 15e3;

function getSetting(key, fallback) {
  const row = getDb().select().from(settings).where(eq(settings.key, key)).get();
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } }).run();
}

const modelsKey = (providerId) => `ai.models.${providerId}`;
export const pricingOverrides = () => getSetting("ai.pricing", {});

function withTimeout(ms, run) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return run(ctl.signal).finally(() => clearTimeout(timer));
}

function markProvider(id, patch) {
  getDb().update(aiProviders).set({ ...patch, updatedAt: new Date() }).where(eq(aiProviders.id, id)).run();
}

function testAdapterFor(p) {
  const from = providerInfo(p.provider).keyFrom;
  return ADAPTERS[p.provider] ?? (from ? ADAPTERS[from] : void 0);
}

export async function testProvider(id) {
  const p = getDb().select().from(aiProviders).where(eq(aiProviders.id, id)).get();
  if (!p) throw new AiError("no_provider", "Không tìm thấy nhà cung cấp");
  if (providerInfo(p.provider).keyless) {
    markProvider(id, { status: "valid", lastTestedAt: new Date(), lastError: null });
    return { ok: true, status: "valid", latencyMs: null, message: "Không cần API key" };
  }
  const k = resolveKey(p);
  if (!k) {
    const owner = keyOwner(p);
    return { ok: false, status: "untested", latencyMs: null, message: owner.id !== p.id ? `Chưa lưu API key ${owner.label}` : "Chưa lưu API key" };
  }
  const adapter = testAdapterFor(p);
  if (!adapter) return { ok: false, status: p.status, latencyMs: null, message: "Chưa hỗ trợ kiểm tra nhà cung cấp này" };
  const started = performance.now();
  try {
    const res = await withTimeout(TEST_TIMEOUT_MS, (signal) => adapter.test({ apiKey: k.key, baseUrl: k.baseUrl, signal }));
    const latencyMs = Math.round(performance.now() - started);
    let modelCount;
    let switched = "";
    let defaultModel = p.defaultModel;
    if (res.models) {
      const models = res.models.filter((m) => isUsableModel(p.provider, m));
      if (models.length) {
        setSetting(modelsKey(id), models);
        modelCount = models.length;
        if (defaultModel && !models.includes(defaultModel)) {
          const pick = preferredModel(p.provider, models);
          if (pick) {
            switched = ` · "${defaultModel}" không còn khả dụng → đã chuyển sang "${pick}"`;
            defaultModel = pick;
          }
        }
      }
    }
    markProvider(id, { status: "valid", lastLatencyMs: latencyMs, lastError: null, lastTestedAt: new Date(), defaultModel });
    const base = res.note ?? (modelCount != null ? `${modelCount} model khả dụng` : "Kết nối thành công");
    if (switched) console.info(`[ai] ${p.provider}: model ${p.defaultModel} → ${defaultModel}`);
    return { ok: true, status: "valid", latencyMs, message: base + switched, modelCount };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError("unknown", String(err));
    const latencyMs = Math.round(performance.now() - started);
    const status = e.kind === "auth" ? "invalid" : e.kind === "rate_limit" ? "rate_limited" : p.status;
    markProvider(id, { status, lastError: `${e.kind}: ${e.message}`, lastTestedAt: new Date(), ...e.kind === "rate_limit" ? { lastLatencyMs: latencyMs } : {} });
    console.warn(`[ai] test ${p.provider} → ${e.kind}${e.status ? ` (${e.status})` : ""}`);
    return { ok: false, status, latencyMs: null, message: e.message };
  }
}

export async function testWithDependents(id) {
  const p = getDb().select().from(aiProviders).where(eq(aiProviders.id, id)).get();
  if (!p) throw new AiError("no_provider", "Không tìm thấy nhà cung cấp");
  const outcome = await testProvider(id);
  if (outcome.ok) {
    const dependents = getDb().select().from(aiProviders).all().filter((r) => providerInfo(r.provider).keyFrom === p.provider);
    await Promise.all(dependents.map((d) => testProvider(d.id)));
  }
  return outcome;
}

export async function testModel(id) {
  const p = getDb().select().from(aiProviders).where(eq(aiProviders.id, id)).get();
  if (!p) throw new AiError("no_provider", "Không tìm thấy nhà cung cấp");
  const adapter = ADAPTERS[p.provider];
  const model = p.defaultModel ?? providerInfo(p.provider).models[0]?.id ?? null;
  if (!adapter?.chat || !model) return { ok: false, status: p.status, latencyMs: null, message: "Chỉ thử được model văn bản", model };
  const k = resolveKey(p);
  if (!k) return { ok: false, status: p.status, latencyMs: null, message: "Chưa lưu API key", model };
  const started = performance.now();
  try {
    const res = await withTimeout(
      3e4,
      (signal) => adapter.chat({ apiKey: k.key, baseUrl: k.baseUrl, model, signal }, { system: "Trả lời đúng một từ.", prompt: "Trả lời: OK", maxTokens: 16 })
    );
    const latencyMs = Math.round(performance.now() - started);
    recordUsage(p, null, "settings.testModel", res.model || model, res.inputTokens, res.outputTokens, true);
    markProvider(id, { status: "valid", lastLatencyMs: latencyMs, lastError: null });
    return { ok: true, status: "valid", latencyMs, message: `Model "${model}" trả lời bình thường`, model };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError("unknown", String(err));
    markProvider(id, { lastError: `${e.kind}: ${e.message}` });
    const hint = e.status === 404 ? " – model không tồn tại hoặc đã bị nhà cung cấp tắt, bấm Check Connection để chọn lại" : e.kind === "overloaded" ? " – máy chủ nhà cung cấp đang quá tải, thử lại sau hoặc chọn model khác" : "";
    return { ok: false, status: p.status, latencyMs: null, message: e.message + hint, model };
  }
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function spentUsd(workspaceId) {
  const row = getDb().select({ usd: sum(aiUsage.costUsd).mapWith(Number) }).from(aiUsage).where(and(gte(aiUsage.createdAt, monthStart()), workspaceId ? eq(aiUsage.workspaceId, workspaceId) : void 0)).get();
  return row?.usd ?? 0;
}

export function assertBudget(workspaceId) {
  const db = getDb();
  const cap = getSetting("budget.monthlyHardCapUsd", 50);
  const breaker = getSetting("budget.circuitBreaker", true);
  const total = spentUsd();
  if (breaker && total >= cap) {
    const open = db.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.kind, "budget"), isNull(alerts.resolvedAt), gte(alerts.createdAt, monthStart()))).get();
    if (!open) {
      db.insert(alerts).values({
        id: newId(),
        severity: "error",
        kind: "budget",
        entityType: "ai_provider",
        title: "Circuit Breaker đã ngắt",
        message: `Chi phí AI tháng này $${total.toFixed(2)} đã chạm hạn mức $${cap.toFixed(2)}. Mọi tác vụ AI tạm dừng.`
      }).run();
    }
    throw new AiError("budget", `Đã chạm hạn mức chi tiêu tháng ($${total.toFixed(2)} / $${cap.toFixed(2)}) – Circuit Breaker đang ngắt`);
  }
  if (workspaceId) {
    const ws = db.select({ name: workspaces.name, budget: workspaces.aiBudgetUsd }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
    if (ws?.budget != null) {
      const used = spentUsd(workspaceId);
      if (used >= ws.budget) throw new AiError("budget", `Pocket "${ws.name}" đã dùng hết ngân sách AI tháng ($${used.toFixed(2)} / $${ws.budget.toFixed(2)})`);
    }
  }
}

function recordUsage(p, workspaceId, feature, model, inTok, outTok, ok) {
  const cost = ok ? estimateCostUsd(model, inTok, outTok, pricingOverrides()) : 0;
  getDb().insert(aiUsage).values({ id: newId(), providerId: p.id, workspaceId: workspaceId ?? null, model, feature, inputTokens: inTok, outputTokens: outTok, costUsd: cost ?? 0, ok }).run();
  return cost;
}

async function omniraText(req, opts) {
  try {
    const res = await omniraChat(req);
    getDb().insert(aiUsage).values({ id: newId(), providerId: null, workspaceId: opts.workspaceId ?? null, model: res.model, feature: opts.feature, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: 0, ok: true }).run();
    return { text: res.text, providerLabel: OMNIRA_AI_LABEL, model: res.model, costUsd: 0, attempts: [{ provider: OMNIRA_AI_LABEL }], imagesSeen: res.imagesSeen ?? 0 };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError("unknown", err instanceof Error ? err.message : String(err));
    console.warn(`[ai] ${opts.feature} · AI NT → ${e.kind}${e.status ? ` (${e.status})` : ""}`);
    throw e;
  }
}

export function textChain() {
  return getDb().select().from(aiProviders).where(and(eq(aiProviders.category, "text"), eq(aiProviders.enabled, true))).orderBy(asc(aiProviders.priority)).all().filter((p) => p.status !== "invalid" && ADAPTERS[p.provider]?.chat && resolveKey(p) != null);
}

async function chatWithRetry(p, ctx, req) {
  const delays = [1500, 4e3];
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(CHAT_TIMEOUT_MS, (signal) => ADAPTERS[p.provider].chat({ ...ctx, signal }, req));
    } catch (err) {
      const retryable = err instanceof AiError && (err.kind === "overloaded" || err.kind === "timeout");
      if (!retryable || attempt >= delays.length) throw err;
      console.warn(`[ai] ${p.provider}/${ctx.model} quá tải → thử lại sau ${delays[attempt]}ms`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

const VISION_PROVIDERS = new Set(["gemini", "openai", "anthropic"]);

export async function aiText(req, opts) {
  assertBudget(opts.workspaceId);
  const chain = textChain();
  if (!chain.length) return omniraText(req, opts);
  const fallback = getSetting("ai.fallbackOnError", true);
  if (req.images?.length) {
    const vision = chain.filter((p) => VISION_PROVIDERS.has(p.provider));
    if (vision.length) chain.splice(0, chain.length, ...vision);
    else {
      console.warn(`[ai] ${opts.feature}: không có AI văn bản nào đọc được ảnh → gửi không kèm ảnh`);
      req = { ...req, images: void 0 };
    }
  }
  const attempts = [];
  let lastErr = null;
  for (const p of fallback ? chain : chain.slice(0, 1)) {
    const k = resolveKey(p);
    if (!k) continue;
    const model = p.defaultModel ?? providerInfo(p.provider).models[0]?.id;
    if (!model) continue;
    const started = performance.now();
    try {
      const res = await chatWithRetry(p, { apiKey: k.key, baseUrl: k.baseUrl, model }, req);
      if (!res.text.trim()) throw new AiError("invalid_output", "Phản hồi rỗng");
      markProvider(p.id, { status: "valid", lastLatencyMs: Math.round(performance.now() - started), lastError: null });
      const costUsd = recordUsage(p, opts.workspaceId, opts.feature, res.model || model, res.inputTokens, res.outputTokens, true);
      attempts.push({ provider: p.label });
      return { text: res.text, providerLabel: p.label, model: res.model || model, costUsd, attempts, imagesSeen: req.images?.length ?? 0 };
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError("unknown", err instanceof Error ? err.message : String(err));
      lastErr = e;
      attempts.push({ provider: p.label, error: e.message });
      console.warn(`[ai] ${opts.feature} · ${p.provider}/${model} → ${e.kind}${e.status ? ` (${e.status})` : ""}`);
      if (e.kind === "auth") markProvider(p.id, { status: "invalid", lastError: `${e.kind}: ${e.message}` });
      else if (e.kind === "rate_limit") markProvider(p.id, { status: "rate_limited", lastError: `${e.kind}: ${e.message}` });
      else markProvider(p.id, { lastError: `${e.kind}: ${e.message}` });
      recordUsage(p, opts.workspaceId, opts.feature, model, 0, 0, false);
      if (!e.retryable) break;
    }
  }
  const tried = attempts.map((a) => `${a.provider}: ${a.error}`).join(" → ");
  throw new AiError(lastErr?.kind ?? "unknown", attempts.length > 1 ? `Tất cả nhà cung cấp đều lỗi (${tried})` : lastErr?.message ?? "Lỗi không xác định");
}
