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

// 동시에 보내는 Postgres 쿼리 수를 연결 수 이하로 제한 — postgres.js 내부 대기열에 쌓이면
// Supabase 트랜잭션 풀러에서 응답이 멈추는 일이 있었음(홈: 동시 7개 → 504). 남는 쿼리는 여기서 기다림.
const PG_MAX = 5;
let pgActive = 0;
const pgWaiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (pgActive < PG_MAX) pgActive++;
  else await new Promise<void>((r) => pgWaiting.push(r)); // 끝난 쿼리가 슬롯을 그대로 넘겨줌
  try {
    return await fn();
  } finally {
    const next = pgWaiting.shift();
    if (next) next();
    else pgActive--;
  }
}

function pg(): postgres.Sql {
  // Supabase 풀러(트랜잭션 모드)는 prepared statement를 지원하지 않음.
  // 동시 쿼리가 연결 수(max)보다 많으면 postgres.js가 한 연결에 쿼리를 파이프라이닝하는데(기본 100개),
  // 트랜잭션 풀러에서 이게 간헐적으로 멈춤 → 홈(동시 7개)만 504가 났음. 파이프라이닝을 끄고 남는 쿼리는 대기열로.
  g.__yominPg ??= postgres(process.env.DATABASE_URL!, {
    prepare: false, max: PG_MAX, idle_timeout: 20, connect_timeout: 10,
    ...({ max_pipeline: 1 } as object), // 타입 정의엔 없지만 postgres.js 3.4 옵션 (src/index.js)
  });
  return g.__yominPg;
}

/** 읽기 쿼리. SQL은 SQLite·Postgres 공통 문법으로, 파라미터는 `?`로 쓴다. */
export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  if (USE_PG) {
    let i = 0;
    const sql = text.replace(/\?/g, () => `$${++i}`);
    const rows = await withSlot(() => pg().unsafe(sql, params as postgres.ParameterOrJSON<never>[]));
    return Array.from(rows) as T[];
  }
  return sqlite().prepare(text).all(...params) as T[];
}

export const queryOne = async <T>(text: string, params: unknown[] = []) => (await query<T>(text, params))[0];
