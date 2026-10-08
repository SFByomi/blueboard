// 실적 검증(트랙레코드): 발표 전에 고정한 추정을 실제 매출과 비교 — 누적된 revenue_estimates(일별 스냅샷) × financials
import { query } from "@/lib/db";

type EstRow = { date: string; ticker: string; q_end: string; est: number; low: number; high: number; cons_gap: number | null; tier: string | null; method: string; currency: string };
type Fin = { ticker: string; period_end: string; revenue: number };
type Rep = { ticker: string; q_end: string; seen: string };

export type Call = "Beat" | "Inline" | "Miss";
export type TrackRow = {
  ticker: string; q_end: string; frozen: string; fixedBeforeReport: boolean; reportSeen: string | null;
  est: number; low: number; high: number; actual: number; currency: string; tier: string | null; method: string;
  err: number; inRange: boolean;
  callEst: Call | null; callActual: Call | null; // 추정 vs 컨센 → 판단, 실제 vs 컨센 → 결과
  consErr: number | null; closer: boolean | null; // 컨센 오차, 추정이 컨센보다 실제에 가까웠나
};

const INLINE = 0.01; // 컨센 ±1% 안이면 Inline
const call = (gap: number): Call => (gap > INLINE ? "Beat" : gap < -INLINE ? "Miss" : "Inline");
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

const noTable = <T,>(e: { code?: string; message?: string }): T[] => {
  if (e.code === "42P01" || e.message?.includes("no such table")) return [];
  throw e;
};

export async function trackRecord(): Promise<TrackRow[]> {
  const [ests, fins, reps] = await Promise.all([
    query<EstRow>("SELECT date, ticker, q_end, est, low, high, cons_gap, tier, method, currency FROM revenue_estimates WHERE est IS NOT NULL ORDER BY ticker, q_end, date").catch(noTable<EstRow>),
    query<Fin>("SELECT ticker, period_end, revenue FROM financials WHERE period_end >= '2025-06-01'"),
    query<Rep>("SELECT ticker, q_end, min(seen) AS seen FROM earnings_reports GROUP BY ticker, q_end").catch(noTable<Rep>),
  ]);
  const groups = new Map<string, EstRow[]>();
  for (const e of ests) {
    const k = `${e.ticker}|${e.q_end}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: TrackRow[] = [];
  for (const rows of groups.values()) {
    const { ticker, q_end } = rows[0];
    const fin = fins.find((f) => f.ticker === ticker && days(f.period_end, q_end) < 20);
    if (!fin) continue; // 아직 실적 미반영
    const rep = reps.filter((r) => r.ticker === ticker && days(r.q_end, q_end) < 20).map((r) => r.seen).sort()[0] ?? null;
    // 발표를 처음 본 날 이전의 마지막 추정. 기록이 없으면 마지막 추정(모델은 공시가 들어오기 전까지 실적을 모름)
    const pre = rep ? rows.filter((r) => r.date < rep) : rows;
    if (!pre.length) continue;
    const e = pre.at(-1)!;
    const g = [...pre].reverse().find((r) => r.cons_gap != null);
    const cons = g ? g.est / (1 + g.cons_gap!) : null;
    const actual = fin.revenue;
    out.push({
      ticker, q_end, frozen: e.date, fixedBeforeReport: !!rep, reportSeen: rep,
      est: e.est, low: e.low, high: e.high, actual, currency: e.currency, tier: e.tier, method: e.method,
      err: e.est / actual - 1, inRange: actual >= Math.min(e.low, e.high) && actual <= Math.max(e.low, e.high),
      callEst: g ? call(g.cons_gap!) : null, callActual: cons ? call(actual / cons - 1) : null,
      consErr: cons ? cons / actual - 1 : null, closer: cons ? Math.abs(e.est - actual) < Math.abs(cons - actual) : null,
    });
  }
  return out.sort((a, b) => b.q_end.localeCompare(a.q_end) || Math.abs(a.err) - Math.abs(b.err));
}

export const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
