import { db } from "./db";

export type Company = {
  ticker: string; name: string; name_ko: string | null; market: string | null; sector: string | null;
  thesis: string | null; sec_ticker: string | null; fy_note: string | null; sort: number; dart_fs: string | null; dart_segment: string | null;
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
export function alertsFor(ids: string[]): Alert[] {
  if (!ids.length) return [];
  return db().prepare(`SELECT * FROM alerts WHERE series_id IN (${ids.map(() => "?").join(",")}) ORDER BY month DESC`).all(...ids) as Alert[];
}
export const allAlerts = () =>
  db().prepare("SELECT a.*, s.label FROM alerts a JOIN series s ON s.id = a.series_id ORDER BY a.month DESC").all() as (Alert & { label: string })[];

export type HsTag = { hs_prefix: string; ticker: string; note: string | null };

export const companies = () => db().prepare("SELECT * FROM companies ORDER BY sort, ticker").all() as Company[];
export const company = (t: string) => db().prepare("SELECT * FROM companies WHERE ticker=?").get(t) as Company | undefined;
export const allSeries = () => db().prepare("SELECT * FROM series ORDER BY source, id").all() as Series[];
export const hsTags = () => db().prepare("SELECT * FROM hs_tags ORDER BY hs_prefix, ticker").all() as HsTag[];
export const allMappings = () => db().prepare("SELECT * FROM mappings ORDER BY ticker, sort").all() as Mapping[];

export function mappingsFor(ticker: string) {
  return db().prepare(
    `SELECT m.*, s.label, s.source, s.reporter, s.flow, s.region, s.hs, s.partner, s.unit, s.last_month
     FROM mappings m JOIN series s ON s.id = m.series_id WHERE m.ticker=? ORDER BY m.sort, m.id`,
  ).all(ticker) as (Mapping & Omit<Series, "id" | "spec" | "updated_at">)[];
}

export function observations(ids: string[]): Obs[] {
  if (!ids.length) return [];
  return db().prepare(`SELECT * FROM observations WHERE series_id IN (${ids.map(() => "?").join(",")}) ORDER BY month`).all(...ids) as Obs[];
}

export const financials = (t: string) =>
  db().prepare("SELECT * FROM financials WHERE ticker=? ORDER BY period_end").all(t) as Fin[];

export function surge(scope: string, sort: "yoy3m" | "mom" | "yoy" | "z", limit = 30): SurgeRow[] {
  return db().prepare(
    `SELECT s.*, n.name_ko, n.name_en FROM surge s LEFT JOIN hs_names n ON n.hs = s.hs6
     WHERE s.scope=? AND s.${sort} IS NOT NULL ORDER BY s.${sort} DESC LIMIT ?`,
  ).all(scope, limit) as SurgeRow[];
}

export function surgeForTicker(ticker: string): SurgeRow[] {
  const prefixes = (db().prepare("SELECT hs_prefix FROM hs_tags WHERE ticker=?").all(ticker) as { hs_prefix: string }[]).map((r) => r.hs_prefix);
  if (!prefixes.length) return [];
  return db().prepare(
    `SELECT s.*, n.name_ko, n.name_en FROM surge s LEFT JOIN hs_names n ON n.hs = s.hs6
     WHERE (${prefixes.map(() => "s.hs6 LIKE ?").join(" OR ")}) ORDER BY s.yoy3m DESC LIMIT 20`,
  ).all(...prefixes.map((p) => `${p}%`)) as SurgeRow[];
}

/** HS6 → 관련 종목 (hs_tags 앞자리 매칭) */
export function tagIndex() {
  const tags = hsTags();
  return (hs6: string) => [...new Set(tags.filter((t) => hs6.startsWith(t.hs_prefix)).map((t) => t.ticker))];
}

export const meta = (key: string) =>
  (db().prepare("SELECT value FROM meta WHERE key=?").get(key) as { value: string } | undefined)?.value;
