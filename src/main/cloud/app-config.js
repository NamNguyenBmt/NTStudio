import { cloud, readCloudSession, patchCloudSession } from "./client";

export const MANAGED_PROVIDERS = new Set(["pexels", "pixabay"]);
let cache = null;

let current = () => ({ userId: null, token: null });

export function bindCloudSession(fn) {
  current = fn;
}

export function managedKey(provider) {
  if (!MANAGED_PROVIDERS.has(provider)) return null;
  const { userId } = current();
  if (!userId) return null;
  if (cache?.userId !== userId) cache = { userId, keys: readCloudSession(userId)?.managedKeys ?? {} };
  return cache.keys[provider] || null;
}

export async function syncAppConfig() {
  const { userId, token } = current();
  if (!userId || !token) return;
  try {
    const r = await cloud("/api/client/v1/app-config", { token, timeoutMs: 15e3 });
    const keys = r.stockKeys ?? {};
    patchCloudSession(userId, { managedKeys: keys });
    cache = { userId, keys };
  } catch (e) {
    console.warn("[cloud] chưa lấy được cấu hình dùng chung", e instanceof Error ? e.message : e);
  }
}
