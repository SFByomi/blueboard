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

/** AI·반도체 관심 분야 HS 장(章): 화학·의약·구리·기계·전자·광학/의료기기 (etl/surge.TECH_CHAPTERS) */
export const TECH_CHAPTERS = ["28", "29", "30", "38", "74", "84", "85", "90"];

export function surge(scope: string, sort: "yoy3m" | "mom" | "yoy" | "z", limit = 30, chapters?: string[]) {
  const ch = chapters?.length ? ` AND substr(s.hs6, 1, 2) IN (${chapters.map(() => "?").join(",")})` : "";
  return query<SurgeRow>(
    `SELECT s.*, n.name_ko, n.name_en FROM surge s LEFT JOIN hs_names n ON n.hs = s.hs6
     WHERE s.scope=? AND s.${sort} IS NOT NULL${ch} ORDER BY s.${sort} DESC LIMIT ?`,
    [scope, ...(chapters ?? []), limit],
  );
}

export type KrShare = { hs6: string; month: string; kr_usd: number; world_usd: number; share: number; share_ago: number | null; change: number | null; spark: string; name_ko: string | null; name_en: string | null };
/** 미국 수입 중 한국산 비중 (3개월 합) — 첫 수집 전엔 테이블이 없을 수 있음 */
export function krShare(sort: "change" | "share", limit = 40, chapters?: string[]) {
  const ch = chapters?.length ? ` AND substr(k.hs6, 1, 2) IN (${chapters.map(() => "?").join(",")})` : "";
  return query<KrShare>(
    `SELECT k.*, n.name_ko, n.name_en FROM kr_share k LEFT JOIN hs_names n ON n.hs = k.hs6
     WHERE k.${sort} IS NOT NULL${ch} ORDER BY k.${sort} DESC LIMIT ?`,
    [...(chapters ?? []), limit],
  ).catch(noTable<KrShare>);
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
  query<Mapping & { label: string; unit: string | null }>("SELECT m.*, s.label, s.unit FROM mappings m JOIN series s ON s.id = m.series_id ORDER BY m.ticker, m.sort, m.id");

export type Indicator = { id: string; label: string; grp: string; unit: string | null; source: string | null; note: string | null; sort: number };
/** 가격지수 정의 — 첫 수집 전엔 테이블이 없을 수 있음 */
export const indicators = () =>
  query<Indicator>("SELECT * FROM indicators ORDER BY sort").catch((e: { code?: string; message?: string }) => {
    if (e.code === "42P01" || e.message?.includes("no such table")) return [] as Indicator[];
    throw e;
  });

export type FlowScore = {
  ticker: string; series_id: string; n: number; n_yoy: number; level: number | null;
  yoy0: number | null; yoy1: number | null; yoy2: number | null;
  best: number | null; best_lag: number | null; recent: number | null; grade: "A" | "B" | "C" | "D" | null;
};
/** 매핑별 매출 상관 점수 (etl/scores.py) — 첫 수집 전엔 테이블이 없을 수 있음 */
export const flowScores = (ticker?: string) =>
  query<FlowScore>(`SELECT * FROM flow_scores${ticker ? " WHERE ticker=?" : ""} ORDER BY ticker, best DESC NULLS LAST`, ticker ? [ticker] : []).catch(
    (e: { code?: string; message?: string }) => {
      if (e.code === "42P01" || e.message?.includes("no such table")) return [] as FlowScore[];
      throw e;
    },
  );

export type RevEstimate = {
  date: string; ticker: string; q_start: string; q_end: string;
  est: number; low: number; high: number; yoy: number; last_actual: number; months: number;
  flows: string; mape: number | null; mape_naive: number | null; bt_n: number; backtest: string;
  cons_gap: number | null; cons_end: string | null; currency: string; method: string;
  reliable?: number | null; caution?: string | null; // ETL 판정 (구버전 행엔 없음)
  conf?: number | null; hits?: number | null; tier?: string | null; // 신뢰도(백테스트 ±5% 적중률, 표본 보정)·적중 분기·등급
};
const noTable = <T,>(e: { code?: string; message?: string }): T[] => {
  if (e.code === "42P01" || e.message?.includes("no such table")) return [];
  throw e;
};
/** 종목별 최신 진행 분기 매출 추정 (etl/estimates.py) */
export const latestEstimates = () =>
  query<RevEstimate>("SELECT * FROM revenue_estimates WHERE date = (SELECT max(date) FROM revenue_estimates) AND est IS NOT NULL ORDER BY ticker").catch(noTable<RevEstimate>);
export type EstSkip = { ticker: string; q_start: string | null; q_end: string | null; caution: string | null };
/** 최신 날짜에 '추정불가'로 기록된 종목과 이유 (etl/estimates._skip) */
export const unestimated = () =>
  query<EstSkip>("SELECT ticker, q_start, q_end, caution FROM revenue_estimates WHERE date = (SELECT max(date) FROM revenue_estimates) AND est IS NULL ORDER BY ticker").catch(noTable<EstSkip>);
/** 다음 실적 발표 예정일 (야후 calendarEvents) */
export const earningsDates = () =>
  query<{ ticker: string; next_date: string | null }>("SELECT ticker, next_date FROM earnings_calendar").catch(noTable<{ ticker: string; next_date: string | null }>)
    .then((r) => Object.fromEntries(r.filter((x) => x.next_date && x.next_date >= new Date().toISOString().slice(0, 10)).map((x) => [x.ticker, x.next_date!])) as Record<string, string>);
/** 실적 발표가 끝난 마지막 분기 말일 (야후 earningsHistory) — 컬럼 추가 전 DB면 빈 값 */
export const reportedQuarters = () =>
  query<{ ticker: string; last_reported: string | null }>("SELECT ticker, last_reported FROM earnings_calendar")
    .then((r) => Object.fromEntries(r.filter((x) => x.last_reported).map((x) => [x.ticker, x.last_reported!])) as Record<string, string>)
    .catch(() => ({}) as Record<string, string>);
/** 가장 최근 추정 날짜 — 그날 추정이 없는 종목(모델 탈락)의 옛 추정을 숨기는 기준 */
export const estimateDate = () =>
  query<{ d: string | null }>("SELECT max(date) AS d FROM revenue_estimates").then((r) => r[0]?.d ?? null).catch(() => null);
/** 한 종목의 날짜별 추정 이력 (추정·컨센 괴리율 추이) */
export const estimateHistory = (ticker: string) =>
  query<RevEstimate>("SELECT * FROM revenue_estimates WHERE ticker=? AND est IS NOT NULL ORDER BY date", [ticker]).catch(noTable<RevEstimate>);

export type Consensus = { date: string; ticker: string; period: string; end_date: string | null; avg: number; low: number | null; high: number | null; n: number | null };
/** 컨센서스 원 금액 — 로컬 SQLite에만 있음(게시 안 함). 관리 화면 전용 */
export const latestConsensus = () =>
  query<Consensus>("SELECT * FROM consensus WHERE date = (SELECT max(date) FROM consensus) ORDER BY ticker, period").catch(noTable<Consensus>);
