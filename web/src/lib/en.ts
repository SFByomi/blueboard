import { query } from "./db";
import { companies, earningsDates, flowScores, latestEstimates, type Company, type RevEstimate } from "./queries";
import { SOURCE_EN, TRADE_SOURCES } from "./autopost/pick";

// 영어 페이지(/en) 데이터 — 한국어 화면과 같은 숫자, 이름만 영어(curation.json의 label_en·thesis_en).
// 컨센서스 원 금액은 재게시 금지라 괴리율만, 야후 주가·시총은 쓰지 않는다.

export const GROUP_EN: Record<string, string> = {
  메모리: "Memory", 광통신: "Optical", "서버·네트워크": "Servers & networking", "전력·냉각": "Power & cooling",
  "AI 클라우드": "AI cloud", 네오클라우드: "Neoclouds", 반도체: "Semiconductors", "부품·소재": "Components & materials",
  "전기차·에너지": "EV & energy", 보안: "Cybersecurity", 바이오: "Biotech",
};
export const GROUP_ORDER = ["Memory", "Optical", "Servers & networking", "Semiconductors", "Components & materials", "Power & cooling", "Neoclouds", "AI cloud", "EV & energy", "Cybersecurity", "Biotech", "Other"];
export const ROLE_EN: Record<string, string> = {
  생산투입: "Inputs", 생산출하: "Production shipments", 회사출하: "Company shipments", 최종수요: "End demand", 가격벤치마크: "Price benchmark", "고객 투자": "Customer capex",
};
export const GRADE_EN: Record<string, string> = { A: "Direct link", B: "Linked", C: "Industry context", D: "Weak link" };
export const groupOf = (c: Company) => GROUP_EN[c.grp ?? ""] ?? "Other";

type CoEn = Company & { thesis_en?: string | null };
type SeriesEn = { id: string; label: string; label_en?: string | null; source: string; last_month: string | null };

/** 시리즈 영어 이름 (label_en이 아직 없는 DB면 한국어 label) */
export async function seriesEn(): Promise<Record<string, SeriesEn>> {
  const rows = await query<SeriesEn>("SELECT * FROM series");
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}
export const nameOf = (s: SeriesEn | undefined, id: string) => s?.label_en || s?.label || id;

/** 추정 모델 종류: 통관 데이터 / 운영·공개 데이터 / 회사 가이던스 보정 */
export function modelOf(e: Pick<RevEstimate, "flows" | "method">, ser: Record<string, SeriesEn>) {
  const ids = (JSON.parse(e.flows || "[]") as { sid: string }[]).map((f) => f.sid);
  const src = ids.map((i) => ser[i]?.source).filter(Boolean) as string[];
  const kind = !src.length ? "Guidance-based" : src.every((s) => TRADE_SOURCES.has(s)) ? "Trade data" : "Operating data";
  const guide = !!src.length && e.method.includes("guide"); // 흐름 + 가이던스 교차 확인 (흐름이 없으면 kind가 곧 가이던스)
  return { kind, label: guide ? `${kind} + guidance` : kind, sources: [...new Set(src.map((s) => SOURCE_EN[s] ?? s))], ids, guide };
}

export type EstRow = RevEstimate & { name: string; next: string | null; model: ReturnType<typeof modelOf> };

/** 진행 분기 추정 + 다음 발표일 */
export async function estimatesEn(): Promise<EstRow[]> {
  const [ests, cos, dates, ser] = await Promise.all([latestEstimates(), companies(), earningsDates(), seriesEn()]);
  return ests.map((e) => ({ ...e, name: cos.find((c) => c.ticker === e.ticker)?.name ?? e.ticker, next: dates[e.ticker] ?? null, model: modelOf(e, ser) }));
}

export type ScoreRow = { ticker: string; q_end: string; seen: string; est: number; low: number; high: number; date: string; actual: number; currency: string; err: number; inRange: boolean; kind: string };

/** 실적 검증: 발표를 처음 확인한 날(earnings_reports.seen) 전의 마지막 추정 vs 실제 매출 */
export async function scorecard(ticker?: string): Promise<ScoreRow[]> {
  const rows = await query<{ ticker: string; q_end: string; seen: string; est: number; low: number; high: number; date: string; flows: string; method: string; currency: string }>(
    `SELECT r.ticker, r.q_end, s.seen, r.est, r.low, r.high, r.date, r.flows, r.method, r.currency
       FROM revenue_estimates r
       JOIN (SELECT ticker, q_end, min(seen) AS seen FROM earnings_reports GROUP BY ticker, q_end) s ON s.ticker = r.ticker AND s.q_end = r.q_end
      WHERE r.est IS NOT NULL AND r.date < s.seen${ticker ? " AND r.ticker = ?" : ""}
        AND r.date = (SELECT max(r2.date) FROM revenue_estimates r2 WHERE r2.ticker = r.ticker AND r2.q_end = r.q_end AND r2.est IS NOT NULL AND r2.date < s.seen)`,
    ticker ? [ticker] : [],
  ).catch(() => []);
  if (!rows.length) return [];
  const [fins, ser] = await Promise.all([
    query<{ ticker: string; period_end: string; revenue: number }>("SELECT ticker, period_end, revenue FROM financials"),
    seriesEn(),
  ]);
  const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  const out: ScoreRow[] = [];
  for (const r of rows) {
    const f = fins.find((x) => x.ticker === r.ticker && days(x.period_end, r.q_end) <= 10);
    if (!f) continue;
    out.push({ ...r, actual: f.revenue, err: r.est / f.revenue - 1, inRange: f.revenue >= r.low && f.revenue <= r.high, kind: modelOf(r, ser).kind });
  }
  return out.sort((a, b) => b.seen.localeCompare(a.seen));
}

/** 종목 페이지: 회사·매핑 흐름·연관도 */
export async function stockEn(ticker: string) {
  const [co, maps, ser, scores] = await Promise.all([
    query<CoEn>("SELECT * FROM companies WHERE ticker = ?", [ticker]).then((r) => r[0]),
    query<{ series_id: string; role: string; include_in_total: number; sort: number }>("SELECT series_id, role, include_in_total, sort FROM mappings WHERE ticker = ? ORDER BY sort, id", [ticker]),
    seriesEn(),
    flowScores(ticker),
  ]);
  if (!co) return null;
  const flows = maps.map((m) => {
    const s = ser[m.series_id], sc = scores.find((x) => x.series_id === m.series_id);
    return { id: m.series_id, name: nameOf(s, m.series_id), role: ROLE_EN[m.role] ?? m.role, source: SOURCE_EN[s?.source ?? ""] ?? s?.source ?? "", month: s?.last_month ?? null, total: !!m.include_in_total, grade: sc?.grade ?? null, corr: sc?.best ?? null, lag: sc?.best_lag ?? null, n: sc?.n_yoy ?? null };
  });
  const order = { A: 0, B: 1, C: 2, D: 3 } as Record<string, number>;
  flows.sort((a, b) => (order[a.grade ?? ""] ?? 9) - (order[b.grade ?? ""] ?? 9) || (b.corr ?? -9) - (a.corr ?? -9));
  return { co, flows, ser };
}
