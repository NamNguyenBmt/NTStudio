import { seedIfEmpty } from "../seed";
import { ensureProviders } from "../ai/providers";
import { startFilmQueue, stopFilmQueue } from "../film/queue";
import { recoverInterruptedJobs, stopAllRenders } from "../media/render-queue";
import { startPublisher, stopPublisher } from "../publish/worker";
import { startInbox, stopInbox } from "../inbox/worker";
import { startInsights, stopInsights } from "../analytics/insights";
import { startEarlyCheck, stopEarlyCheck } from "../analytics/early-check";
import { readStore, writeStore, updateUser } from "./store";
import { enforceQuota } from "../quota";
import { existsSync, mkdirSync, readdirSync, statSync, renameSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setCurrentUser, currentUser, userDir, legacyPaths } from "../paths";
import { dbFilePath, openDatabase, closeDatabase } from "../db/index";
import { resetVaultCache, rekeyFromLegacy } from "../vault";
import { onLicenseState, onLicenseChange, licenseView, startLicense, stopLicense } from "../license/index";

let active = null;
let workersOn = false;

function startWorkers() {
  if (workersOn || !currentUser()) return;
  workersOn = true;
  recoverInterruptedJobs();
  startPublisher();
  startInbox();
  startInsights();
  startEarlyCheck();
  startFilmQueue();
  console.info("[license] bật tác vụ nền");
}

function stopWorkers() {
  if (!workersOn) return;
  workersOn = false;
  stopAllRenders();
  stopPublisher();
  stopInbox();
  stopInsights();
  stopEarlyCheck();
  stopFilmQueue();
  console.info("[license] dừng tác vụ nền");
}

onLicenseChange((usable) => (usable ? startWorkers() : stopWorkers()));

onLicenseState(() => {
  if (!currentUser()) return;
  try {
    enforceQuota();
  } catch (err) {
    console.error("[quota] áp hạn mức kênh lỗi", err);
  }
});

export const toAuthUser = (u) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  provider: u.provider,
  createdAt: new Date(u.createdAt),
  lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
  plan: active?.id === u.id ? licenseView().plan : null,
});

export function activeUser() {
  return active ? (readStore().users.find((u) => u.id === active.id) ?? null) : null;
}

export function hasLegacyData() {
  return existsSync(legacyPaths().db);
}

function mergeTree(from, to) {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let left = 0;
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      left += mergeTree(src, dst);
      continue;
    }
    if (existsSync(dst)) continue;
    try {
      renameSync(src, dst);
    } catch {
      try {
        cpSync(src, dst);
        rmSync(src, { force: true });
      } catch {
        left++;
      }
    }
  }
  try {
    if (!readdirSync(from).length) rmSync(from, { recursive: true });
  } catch {}
  return left;
}

function setLegacyOwner(userId) {
  const s = readStore();
  s.legacyOwner = userId;
  writeStore(s);
}

export function adoptLegacyData(userId) {
  const legacy = legacyPaths();
  if (!existsSync(legacy.db)) return;
  const dir = userDir(userId);
  mkdirSync(dir, { recursive: true });
  const vaultTo = join(dir, "vault");
  const dataTo = join(dir, "data");
  if (existsSync(vaultTo) || existsSync(dataTo))
    throw new Error("Tài khoản đã có dữ liệu – không chuyển dữ liệu cũ đè lên");
  const movedVault = existsSync(legacy.vault);
  if (movedVault) renameSync(legacy.vault, vaultTo);
  try {
    renameSync(legacy.dataDir, dataTo);
  } catch (err) {
    if (movedVault) renameSync(vaultTo, legacy.vault);
    throw err;
  }
  setLegacyOwner(userId);
  const left = mergeTree(legacy.media, join(dir, "media"));
  console.info(
    `[auth] đã chuyển dữ liệu cũ vào tài khoản ${userId.slice(0, 8)}${left ? ` (${left} file media đang bị khóa – sẽ chuyển ở lần đăng nhập sau)` : ""}`,
  );
}

function repairLegacy(userId) {
  const legacy = legacyPaths();
  const legacyKey = join(legacy.vault, "master.bin");
  const owner = readStore().legacyOwner ?? null;
  if (owner && owner !== userId) return;
  if (existsSync(legacyKey)) {
    const { rekeyed, unreadable } = rekeyFromLegacy(legacyKey);
    if (rekeyed && !owner) setLegacyOwner(userId);
    if (rekeyed || owner === userId) {
      const backup = `${legacy.vault}.legacy-backup`;
      if (!existsSync(backup)) renameSync(legacy.vault, backup);
      console.info(
        `[auth] đã khôi phục ${rekeyed} bí mật từ két cũ${unreadable ? ` · ${unreadable} bí mật không giải mã được` : ""} · bản sao két cũ: ${backup}`,
      );
    }
  }
  if (readStore().legacyOwner === userId && existsSync(legacy.media)) {
    const left = mergeTree(legacy.media, join(userDir(userId), "media"));
    console.info(`[auth] đã gom media cũ vào tài khoản${left ? ` (${left} file còn bị khóa)` : ""}`);
  }
}

export function openSession(user) {
  if (active) closeSession();
  setCurrentUser(user.id);
  try {
    openDatabase();
    if (seedIfEmpty()) console.info("[db] đã nạp dữ liệu mẫu (OMNI_SEED=1)");
    ensureProviders();
    console.info(`[auth] đăng nhập ${user.id.slice(0, 8)} · ${dbFilePath()}`);
  } catch (err) {
    closeDatabase();
    setCurrentUser(null);
    throw err;
  }
  try {
    repairLegacy(user.id);
  } catch (err) {
    console.error("[auth] sửa dữ liệu cũ lỗi", err);
  }
  active = updateUser(user.id, { lastLoginAt: Date.now() });
  startLicense(user.id);
}

export function closeSession() {
  if (!currentUser()) return;
  stopLicense();
  stopWorkers();
  closeDatabase();
  resetVaultCache();
  console.info(`[auth] đăng xuất ${currentUser().slice(0, 8)}`);
  setCurrentUser(null);
  active = null;
}
