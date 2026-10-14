import { safeStorage } from "electron";
import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { authRoot } from "../paths";
import { scrypt as cryptoScrypt, randomBytes, timingSafeEqual, randomUUID, createHash } from "node:crypto";

const authDir = () => authRoot();
const storeFile = () => join(authDir(), "users.json");
const sessionFile = () => join(authDir(), "session.bin");

export function readStore() {
  try {
    const s = JSON.parse(readFileSync(storeFile(), "utf8"));
    if (s && Array.isArray(s.users)) return s;
  } catch {}
  return { version: 1, users: [] };
}

export function writeStore(s) {
  mkdirSync(authDir(), { recursive: true });
  const tmp = storeFile() + ".tmp";
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 384 });
  renameSync(tmp, storeFile());
}

const normEmail = (e) => e.trim().toLowerCase();

export function findUser(email) {
  const e = normEmail(email);
  return readStore().users.find((u) => u.email === e);
}

export function updateUser(id, patch) {
  const s = readStore();
  const i = s.users.findIndex((u) => u.id === id);
  if (i < 0) throw new Error("Không tìm thấy tài khoản");
  s.users[i] = { ...s.users[i], ...patch };
  writeStore(s);
  return s.users[i];
}

const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password, salt, opts) {
  return new Promise((resolve, reject) =>
    cryptoScrypt(password.normalize("NFKC"), salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export async function createUser(input) {
  const s = readStore();
  const email = normEmail(input.email);
  if (s.users.some((u) => u.email === email)) throw new Error("Email này đã có tài khoản trên máy");
  const user = {
    id: randomUUID(),
    email,
    displayName: input.displayName.trim(),
    passwordHash: await hashPassword(input.password),
    provider: input.provider ?? "local",
    cloudId: input.cloudId ?? null,
    createdAt: Date.now(),
    lastLoginAt: null,
  };
  s.users.push(user);
  writeStore(s);
  return user;
}

const REMEMBER_DAYS = 30;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function rememberSession(userId) {
  if (!safeStorage.isEncryptionAvailable()) return;
  const token = randomBytes(32).toString("base64url");
  updateUser(userId, { rememberTokenHash: sha256(token), rememberExpiresAt: Date.now() + REMEMBER_DAYS * 864e5 });
  mkdirSync(authDir(), { recursive: true });
  writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify({ userId, token })), { mode: 384 });
}

export function forgetSession(userId) {
  rmSync(sessionFile(), { force: true });
  if (userId) {
    try {
      updateUser(userId, { rememberTokenHash: null, rememberExpiresAt: null });
    } catch {}
  }
}

export function restoreSession() {
  if (!existsSync(sessionFile()) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const { userId, token } = JSON.parse(safeStorage.decryptString(readFileSync(sessionFile())));
    const user = readStore().users.find((u) => u.id === userId);
    if (!user?.rememberTokenHash || !user.rememberExpiresAt || user.rememberExpiresAt < Date.now()) return null;
    const a = Buffer.from(user.rememberTokenHash, "hex");
    const b = Buffer.from(sha256(token), "hex");
    return a.length === b.length && timingSafeEqual(a, b) ? user : null;
  } catch {
    return null;
  }
}

const failures = new Map();

export function lockRemainingSec(email) {
  const f = failures.get(normEmail(email));
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1e3) : 0;
}

export function recordFailure(email) {
  const key = normEmail(email);
  const f = failures.get(key) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (f.count - 5)) * 1e3;
  failures.set(key, f);
}

export function clearFailures(email) {
  failures.delete(normEmail(email));
}
