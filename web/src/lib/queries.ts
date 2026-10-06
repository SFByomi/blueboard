import { query, queryOne } from "./db";

export type Company = {
  ticker: string; name: string; name_ko: string | null; market: string | null; sector: string | null;
  thesis: string | null; sec_ticker: string | null; fy_note: string | null; sort: number; dart_fs: string | null; dart_segment: string | null;
  grp: string | null; sites: string | null; // sites: 생산거점 JSON
};
export type Series = {
  id: string; label: string; source: string; reporter: string | null; flow: string | null; region: string | null;
  hs: string | null; partner: string | null; spec: string; unit: string | null; last_month: string | null; updated_at: string | null;
};
export type Mapping = {
  id: number; ticker: string; series_id: string; role: string; confidence: string; rationale: string | null;
  caveat: string | null; include_in_total: number; sort: number;
};
export type Obs = { series_id: string; month: string; value_usd: number | null; qty: number | null };
export type Fin = { ticker: string; period_end: string; period_start: string; revenue: number; currency: string; basis: string | null };
export type SurgeRow = {
  scope: string; hs6: string; partner: string; partner_name: string | null; month: string; value_usd: number;
  mom: number | null; yoy: number | null; yoy3m: number | null; z: number | null; spark: string;
  name_ko: string | null; name_en: string | null;
};
export type Alert = { series_id: string; month: string; kind: string; detail: string };
export function alertsFor(ids: string[]) {
  if (!ids.length) return Promise.resolve([] as Alert[]);
  return query<Alert>(`SELECT * FROM alerts WHERE series_id IN (${ids.map(() => "?").join(",")}) ORDER BY month DESC`, ids);
}
export const allAlerts = () =>
  query<Alert & { label: string }>("SELECT a.*, s.label FROM alerts a JOIN series s ON s.id = a.series_id ORDER BY a.month DESC");

export type HsTag = { hs_prefix: string; ticker: string; note: string | null };

export const companies = () => query<Company>("SELECT * FROM companies ORDER BY sort, ticker");
export const company = (t: string) => queryOne<Company>("SELECT * FROM companies WHERE ticker=?", [t]);
export const allSeries = () => query<Series>("SELECT * FROM series ORDER BY source, id");
export const hsTags = () => query<HsTag>("SELECT * FROM hs_tags ORDER BY hs_prefix, ticker");
export const allMappings = () => query<Mapping>("SELECT * FROM mappings ORDER BY ticker, sort");
export const hsNames = () => query<{ hs: string; n: string | null }>("SELECT hs, coalesce(name_ko, name_en) n FROM hs_names");

export function mappingsFor(ticker: string) {
  return query<Mapping & Omit<Series, "id" | "spec" | "updated_at">>(
    `SELECT m.*, s.label, s.source, s.reporter, s.flow, s.region, s.hs, s.partner, s.unit, s.last_month
     FROM mappings m JOIN series s ON s.id = m.series_id WHERE m.ticker=? ORDER BY m.sort, m.id`,
    [ticker],
  );
}

export function observations(ids: string[]) {
  if (!ids.length) return Promise.resolve([] as Obs[]);
  return query<Obs>(`SELECT * FROM observations WHERE series_id IN (${ids.map(() => "?").join(",")}) ORDER BY month`, ids);
}

export const financials = (t: string) => query<Fin>("SELECT * FROM financials WHERE ticker=? ORDER BY period_end", [t]);

export function surge(scope: string, sort: "yoy3m" | "mom" | "yoy" | "z", limit = 30) {
  return query<SurgeRow>(
    `SELECT s.*, n.name_ko, n.name_en FROM surge s LEFT JOIN hs_names n ON n.hs = s.hs6
     WHERE s.scope=? AND s.${sort} IS NOT NULL ORDER BY s.${sort} DESC LIMIT ?`,
    [scope, limit],
  );
}

export async function surgeForTicker(ticker: string) {
  const prefixes = (await query<{ hs_prefix: string }>("SELECT hs_prefix FROM hs_tags WHERE ticker=?", [ticker])).map((r) => r.hs_prefix);
  if (!prefixes.length) return [] as SurgeRow[];
  return query<SurgeRow>(
    `SELECT s.*, n.name_ko, n.name_en FROM surge s LEFT JOIN hs_names n ON n.hs = s.hs6
     WHERE (${prefixes.map(() => "s.hs6 LIKE ?").join(" OR ")}) ORDER BY s.yoy3m DESC NULLS LAST LIMIT 20`,
    prefixes.map((p) => `${p}%`),
  );
}

/** HS6 → 관련 종목 (hs_tags 앞자리 매칭) */
export async function tagIndex() {
  const tags = await hsTags();
  return (hs6: string) => [...new Set(tags.filter((t) => hs6.startsWith(t.hs_prefix)).map((t) => t.ticker))];
}

export const meta = async (key: string) => (await queryOne<{ value: string }>("SELECT value FROM meta WHERE key=?", [key]))?.value;

export type PriceRow = { date: string; kind: "gpu" | "token" | "index"; item: string; stat: string; value: number; n: number | null; detail: string | null };
/** 가격 테이블은 첫 수집 전(새 DB·배포 직후)엔 없을 수 있음 → 빈 목록으로 (빌드가 실패하지 않게) */
export const priceSnapshots = () =>
  query<PriceRow>("SELECT * FROM price_snapshots ORDER BY date, item, stat").catch((e: { code?: string; message?: string }) => {
    // 테이블 없음(Postgres 42P01, SQLite "no such table")만 빈 목록 — 접속 실패 등은 그대로 오류로
    if (e.code === "42P01" || e.message?.includes("no such table")) return [] as PriceRow[];
    throw e;
  });

export const allFinancials = () => query<Fin>("SELECT * FROM financials ORDER BY ticker, period_end");
export const allMappingsLabeled = () =>
  query<Mapping & { label: string }>("SELECT m.*, s.label FROM mappings m JOIN series s ON s.id = m.series_id ORDER BY m.ticker, m.sort, m.id");

export type Indicator = { id: string; label: string; grp: string; unit: string | null; source: string | null; note: string | null; sort: number };
/** 가격지수 정의 — 첫 수집 전엔 테이블이 없을 수 있음 */
export const indicators = () =>
  query<Indicator>("SELECT * FROM indicators ORDER BY sort").catch((e: { code?: string; message?: string }) => {
    if (e.code === "42P01" || e.message?.includes("no such table")) return [] as Indicator[];
    throw e;
  });
