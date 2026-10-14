import { app } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { userDir } from "../paths";
import * as schema from "./schema";

let sqlite = null;
let db = null;

function migrationsFolder() {
  return app.isPackaged ? join(process.resourcesPath, "drizzle") : join(__dirname, "../../drizzle");
}

export function dbFilePath() {
  return process.env["OMNI_DB_PATH"] ?? join(userDir(), "data", "omnipage.db");
}

export function openDatabase() {
  if (db) return db;
  const file = dbFilePath();
  mkdirSync(join(file, ".."), { recursive: true });
  sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

export function getDb() {
  if (!db) throw new Error("Chưa đăng nhập – cơ sở dữ liệu của người dùng chưa được mở");
  return db;
}

export function closeDatabase() {
  sqlite?.close();
  sqlite = null;
  db = null;
}

export function newId() {
  return crypto.randomUUID();
}
