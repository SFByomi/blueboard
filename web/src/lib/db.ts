import Database from "better-sqlite3";
import path from "node:path";

// ETL(Python)이 채우는 ../data/yomin.db 를 공유한다.
const DB_PATH = process.env.YOMIN_DB ?? path.join(process.cwd(), "..", "data", "yomin.db");

const g = globalThis as unknown as { __yominDb?: Database.Database };

export function db(): Database.Database {
  if (!g.__yominDb) {
    g.__yominDb = new Database(DB_PATH, { fileMustExist: true });
    g.__yominDb.pragma("journal_mode = WAL");
  }
  return g.__yominDb;
}

export const PROJECT_ROOT = path.join(process.cwd(), "..");
