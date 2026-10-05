import Database from "better-sqlite3";
import path from "node:path";
import postgres from "postgres";

// 공개 사이트(Vercel)는 DATABASE_URL의 Postgres(Supabase), 로컬은 ETL이 채우는 ../data/yomin.db(SQLite).
// Postgres는 GitHub Actions의 `python -m etl.publish`가 SQLite 결과를 통째로 복사해 채운다.
const DB_PATH = process.env.YOMIN_DB ?? path.join(process.cwd(), "..", "data", "yomin.db");
export const PROJECT_ROOT = path.join(process.cwd(), "..");

export const USE_PG = !!process.env.DATABASE_URL;
/** 관리 페이지는 로컬(SQLite + curation.json)에서만 — 공개 사이트에서는 숨기고 서버 액션도 막는다. */
export const ADMIN_ENABLED = !USE_PG;

const g = globalThis as unknown as { __yominDb?: Database.Database; __yominPg?: postgres.Sql };

/** 로컬 SQLite (관리 페이지 쓰기용 동기 API) */
export function sqlite(): Database.Database {
  if (!g.__yominDb) {
    g.__yominDb = new Database(DB_PATH, { fileMustExist: true });
    g.__yominDb.pragma("journal_mode = WAL");
  }
  return g.__yominDb;
}

function pg(): postgres.Sql {
  // Supabase 풀러(트랜잭션 모드)는 prepared statement를 지원하지 않음
  g.__yominPg ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 5, idle_timeout: 20 });
  return g.__yominPg;
}

/** 읽기 쿼리. SQL은 SQLite·Postgres 공통 문법으로, 파라미터는 `?`로 쓴다. */
export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  if (USE_PG) {
    let i = 0;
    const rows = await pg().unsafe(text.replace(/\?/g, () => `$${++i}`), params as postgres.ParameterOrJSON<never>[]);
    return Array.from(rows) as T[];
  }
  return sqlite().prepare(text).all(...params) as T[];
}

export const queryOne = async <T>(text: string, params: unknown[] = []) => (await query<T>(text, params))[0];
