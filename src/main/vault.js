import { safeStorage } from "electron";
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, newId } from "./db/index";
import { currentUser, userDir } from "./paths";
import { secrets } from "./db/schema";
import { ApiError } from "./errors";

let masterKey = null;

function masterKeyPath() {
  return join(userDir(), "vault", "master.bin");
}

export function resetVaultCache() {
  masterKey = null;
}

export function vaultAvailable() {
  return safeStorage.isEncryptionAvailable();
}

function getMasterKey() {
  if (masterKey) return masterKey;
  if (!vaultAvailable()) {
    throw new ApiError("INTERNAL", "Hệ điều hành không cung cấp kho khóa an toàn (safeStorage) – không thể lưu bí mật");
  }
  const file = masterKeyPath();
  if (existsSync(file)) {
    masterKey = Buffer.from(safeStorage.decryptString(readFileSync(file)), "base64");
    if (masterKey.length !== 32) throw new ApiError("INTERNAL", "Master key hỏng – không đúng 32 byte");
  } else {
    masterKey = randomBytes(32);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, safeStorage.encryptString(masterKey.toString("base64")), { mode: 384 });
  }
  return masterKey;
}

const PORTABLE_N = 1 << 15;
const portablePath = (userId) => join(userDir(userId), "vault", "master.portable");
const machinePath = (userId) => join(userDir(userId), "vault", "master.bin");

function portableKey(password, salt) {
  return scryptSync(password.normalize("NFKC"), salt, 32, { N: PORTABLE_N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
}

export function writePortableKey(userId, password) {
  if (currentUser() !== userId) return;
  const key = getMasterKey();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", portableKey(password, salt), iv);
  const data = Buffer.concat([c.update(key), c.final()]);
  const out = {
    v: 1,
    kdf: "scrypt",
    N: PORTABLE_N,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    data: data.toString("base64")
  };
  const file = portablePath(userId);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file + ".tmp", JSON.stringify(out), { mode: 384 });
  renameSync(file + ".tmp", file);
}

export function recoverVaultOnThisMachine(userId, password) {
  const machine = machinePath(userId);
  const portable = portablePath(userId);
  if (!existsSync(portable) || !vaultAvailable()) return false;
  if (existsSync(machine)) {
    try {
      const k = Buffer.from(safeStorage.decryptString(readFileSync(machine)), "base64");
      if (k.length === 32) return false;
    } catch {
    }
  }
  const p = JSON.parse(readFileSync(portable, "utf8"));
  const d = createDecipheriv("aes-256-gcm", portableKey(password, Buffer.from(p.salt, "base64")), Buffer.from(p.iv, "base64"));
  d.setAuthTag(Buffer.from(p.tag, "base64"));
  const key = Buffer.concat([d.update(Buffer.from(p.data, "base64")), d.final()]);
  if (key.length !== 32) throw new ApiError("INTERNAL", "Khóa di chuyển hỏng");
  if (existsSync(machine)) renameSync(machine, machine + `.may-cu-${Date.now()}`);
  writeFileSync(machine, safeStorage.encryptString(key.toString("base64")), { mode: 384 });
  masterKey = null;
  console.info(`[vault] đã mở két bằng khóa di chuyển cho tài khoản ${userId.slice(0, 8)} (dữ liệu chép từ máy khác)`);
  return true;
}

export function vaultFingerprint() {
  if (!vaultAvailable() || !existsSync(masterKeyPath())) return null;
  return createHash("sha256").update(getMasterKey()).digest("hex").slice(0, 8);
}

const aad = (ownerType, ownerId, kind) => Buffer.from(`${ownerType}:${ownerId}:${kind}`, "utf8");

export function maskSecret(value) {
  const v = value.trim();
  if (v.length <= 12) return "•".repeat(Math.max(4, v.length));
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

export function putSecret(input) {
  const key = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(input.ownerType, input.ownerId, input.kind));
  const ciphertext = Buffer.concat([cipher.update(input.value, "utf8"), cipher.final()]);
  const row = {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    preview: maskSecret(input.value),
    expiresAt: input.expiresAt ?? null,
    updatedAt: new Date()
  };
  getDb().insert(secrets).values({ id: newId(), kind: input.kind, ownerType: input.ownerType, ownerId: input.ownerId, ...row }).onConflictDoUpdate({ target: [secrets.ownerType, secrets.ownerId, secrets.kind], set: row }).run();
}

export function readSecret(ownerType, ownerId, kind) {
  const row = getDb().select().from(secrets).where(and(eq(secrets.ownerType, ownerType), eq(secrets.ownerId, ownerId), eq(secrets.kind, kind))).get();
  if (!row) return null;
  const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(row.iv, "base64"));
  decipher.setAAD(aad(ownerType, ownerId, kind));
  decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function rekeyFromLegacy(legacyKeyFile) {
  if (!vaultAvailable() || !existsSync(legacyKeyFile)) return { rekeyed: 0, unreadable: 0 };
  const legacy = Buffer.from(safeStorage.decryptString(readFileSync(legacyKeyFile)), "base64");
  if (legacy.length !== 32) return { rekeyed: 0, unreadable: 0 };
  const decryptWith = (key, r) => {
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(r.iv, "base64"));
      d.setAAD(aad(r.ownerType, r.ownerId, r.kind));
      d.setAuthTag(Buffer.from(r.authTag, "base64"));
      return Buffer.concat([d.update(Buffer.from(r.ciphertext, "base64")), d.final()]).toString("utf8");
    } catch {
      return null;
    }
  };
  const current = getMasterKey();
  let rekeyed = 0;
  let unreadable = 0;
  for (const r of getDb().select().from(secrets).all()) {
    if (decryptWith(current, r) != null) continue;
    const value = decryptWith(legacy, r);
    if (value == null) {
      unreadable++;
      continue;
    }
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", current, iv);
    c.setAAD(aad(r.ownerType, r.ownerId, r.kind));
    const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
    getDb().update(secrets).set({ ciphertext: ct.toString("base64"), iv: iv.toString("base64"), authTag: c.getAuthTag().toString("base64") }).where(eq(secrets.id, r.id)).run();
    rekeyed++;
  }
  return { rekeyed, unreadable };
}

export function deleteSecret(ownerType, ownerId, kind) {
  const res = getDb().delete(secrets).where(and(eq(secrets.ownerType, ownerType), eq(secrets.ownerId, ownerId), eq(secrets.kind, kind))).run();
  return res.changes > 0;
}
