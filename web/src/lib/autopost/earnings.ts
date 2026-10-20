import { query } from "../db";
import { SOURCE_EN, TRADE_SOURCES } from "./pick";
import { addDays, type Candidate, dayEn, type Flag, moneyTxt, monthEn, pctTxt, todayKst } from "./types";

// 실적 게시물: 발표 직전 '무역 데이터 모델 추정'(프리뷰)과 발표 후 '발표 전 추정 vs 실제'(결과).
// 무역 흐름이 들어간 추정만 — 가이던스만으로 낸 추정은 우리 강점(통관 데이터)이 아니라 뺀다.
// 컨센서스 원 금액은 재게시 금지(로컬 전용)라 괴리율·오차율만 쓴다.

type Est = {
  date: string; ticker: string; q_end: string; est: number; low: number; high: number; yoy: number | null; flows: string;
  mape: number | null; bt_n: number; cons_gap: number | null; currency: string; method: string; caution: string | null; hits: number | null; tier: string | null;
};
type Co = { ticker: string; name: string };
type Fin = { ticker: string; period_end: string; revenue: number; currency: string };

const PREVIEW_DAYS = 2; // 발표일이 오늘(한국)~이틀 뒤면 프리뷰 (미국 장 마감 후 발표 = 한국 다음 날 아침)
const RESULT_DAYS = 21; // 발표 확인 후 이 기간 안에 실제 매출(SEC·DART)이 들어오면 결과 게시
const qLabel = (q: string) => `quarter ending ${monthEn(q)}`;

/** 추정에 쓴 흐름의 출처와 모델 설명 — 통관 데이터만이면 'customs trade', 아니면 실제 출처대로(예: 테슬라 인도량) */
async function sourcesOf(flows: string, method: string): Promise<{ sources: string[]; model: string; trade: boolean }> {
  const ids = (JSON.parse(flows || "[]") as { sid: string }[]).map((f) => f.sid);
  const rows = ids.length ? await query<{ source: string }>(`SELECT DISTINCT source FROM series WHERE id IN (${ids.map(() => "?").join(",")})`, ids) : [];
  const sources = [...new Set(rows.map((r) => SOURCE_EN[r.source] ?? r.source))];
  const trade = rows.length > 0 && rows.every((r) => TRADE_SOURCES.has(r.source));
  const base = trade ? "customs trade flows" : `public operating data (${sources.join(", ")})`;
  return { sources, trade, model: method.includes("guide") ? `${base} cross-checked with company guidance` : base };
}

async function history(ticker: string, upto: string, n = 8) {
  const fins = await query<Fin>("SELECT ticker, period_end, revenue, currency FROM financials WHERE ticker = ? AND period_end <= ? ORDER BY period_end DESC LIMIT ?", [ticker, upto, n]);
  return fins.reverse().map((f) => ({ q: f.period_end, label: `${monthEn(f.period_end).slice(0, 3)} '${f.period_end.slice(2, 4)}`, value: f.revenue }));
}

export type EarnChart = { ticker: string; name: string; currency: string; quarters: { q: string; label: string; value: number }[]; est: number; low: number; high: number; actual: number | null; qLabel: string };

/** 발표 임박 종목 프리뷰 */
export async function previewCandidates(today = todayKst()): Promise<Candidate[]> {
  const cal = await query<{ ticker: string; next_date: string; next_basis: string | null }>(
    "SELECT ticker, next_date, next_basis FROM earnings_calendar WHERE next_date >= ? AND next_date <= ?", [today, addDays(today, PREVIEW_DAYS)],
  ).catch(() => []);
  if (!cal.length) return [];
  const [ests, cos] = await Promise.all([
    query<Est>("SELECT * FROM revenue_estimates WHERE date = (SELECT max(date) FROM revenue_estimates) AND est IS NOT NULL"),
    query<Co>("SELECT ticker, name FROM companies"),
  ]);
  const out: Candidate[] = [];
  for (const c of cal) {
    const e = ests.find((x) => x.ticker === c.ticker && x.q_end < c.next_date);
    if (!e || e.flows === "[]" || !e.flows || (e.tier !== "신뢰" && e.tier !== "보통")) continue;
    const name = cos.find((x) => x.ticker === c.ticker)?.name ?? c.ticker;
    const caution: string[] = JSON.parse(e.caution ?? "[]");
    const flags: Flag[] = [];
    if (e.tier === "보통") flags.push({ code: "medium", ko: `추정 신뢰도 '보통' — 백테스트 ±5% 적중 ${e.hits ?? 0}/${e.bt_n}분기` });
    if (caution.length) flags.push({ code: "caution", ko: caution.join(" · ") });
    if (c.next_basis) flags.push({ code: "date", ko: `발표일 추정치 (${c.next_basis})` });
    const facts = {
      ticker: c.ticker, company: name, report_date: dayEn(c.next_date), quarter: qLabel(e.q_end),
      our_revenue_estimate: moneyTxt(e.est, e.currency), estimate_range: `${moneyTxt(e.low, e.currency)}–${moneyTxt(e.high, e.currency)}`,
      vs_year_ago_quarter: e.yoy != null ? pctTxt(e.yoy) : null,
      vs_consensus: e.cons_gap != null ? `${pctTxt(e.cons_gap)} ${e.cons_gap >= 0 ? "above" : "below"} consensus` : null,
      backtest: `within ±5% of actual in ${e.hits ?? 0} of ${e.bt_n} past quarters; average error ${e.mape != null ? (e.mape * 100).toFixed(1) : "?"}%`,
      ...(({ sources, model }) => ({ sources, model }))(await sourcesOf(e.flows, e.method)), flags: flags.map((f) => f.code),
    };
    out.push({
      kind: "preview", sig: `preview:${c.ticker}:${e.q_end}`, title: `실적 프리뷰 ${c.ticker} (${c.next_date} 발표)`,
      facts,
      guide: `Post type: earnings preview. ${name} ($${c.ticker}) reports on report_date. Give our model's revenue estimate for the quarter (describe the model as in "model" — do not call it customs-trade based unless "model" says so), the range, the year-over-year change and the gap to consensus (as a percentage only — never a consensus dollar amount), and the backtest record so readers can judge it. Say it is a model estimate, not a forecast of the stock.`,
      asof: [dayEn(c.next_date), monthEn(e.q_end)], sources: facts.sources, flags,
      brief: [`추정 ${facts.our_revenue_estimate} (${facts.estimate_range}) · 전년비 ${facts.vs_year_ago_quarter ?? "-"} · 컨센 대비 ${e.cons_gap != null ? pctTxt(e.cons_gap) : "-"} · ${e.tier} (적중 ${e.hits ?? 0}/${e.bt_n})`],
      data: { ticker: c.ticker, name, currency: e.currency, quarters: await history(c.ticker, e.q_end), est: e.est, low: e.low, high: e.high, actual: null, qLabel: monthEn(e.q_end) } satisfies EarnChart,
    });
  }
  return out;
}

/** 발표 끝난 분기: 발표 전 마지막 추정 vs 실제 — 맞든 틀리든 올려 신뢰를 쌓는다 */
export async function resultCandidates(today = todayKst()): Promise<Candidate[]> {
  const seen = await query<{ ticker: string; q_end: string; seen: string }>(
    "SELECT ticker, q_end, min(seen) AS seen FROM earnings_reports GROUP BY ticker, q_end HAVING min(seen) >= ?", [addDays(today, -RESULT_DAYS)],
  ).catch(() => []);
  const cos = await query<Co>("SELECT ticker, name FROM companies");
  const out: Candidate[] = [];
  for (const s of seen) {
    const e = (await query<Est>(
      "SELECT * FROM revenue_estimates WHERE ticker = ? AND q_end = ? AND date < ? AND est IS NOT NULL ORDER BY date DESC LIMIT 1", [s.ticker, s.q_end, s.seen],
    ))[0];
    if (!e || !e.flows || e.flows === "[]") continue;
    const fin = (await query<Fin>(
      "SELECT ticker, period_end, revenue, currency FROM financials WHERE ticker = ? AND period_end >= ? AND period_end <= ?", [s.ticker, addDays(s.q_end, -10), addDays(s.q_end, 10)],
    ))[0];
    if (!fin) continue; // 실제 매출(10-Q·DART)이 아직 안 들어옴 → 다음 날 다시
    const name = cos.find((x) => x.ticker === s.ticker)?.name ?? s.ticker;
    const err = e.est / fin.revenue - 1;
    const consErr = e.cons_gap != null ? e.est / (1 + e.cons_gap) / fin.revenue - 1 : null; // 컨센 금액은 쓰지 않고 오차율만
    const inRange = fin.revenue >= e.low && fin.revenue <= e.high;
    const flags: Flag[] = [];
    if (Math.abs(err) > 0.05) flags.push({ code: "miss", ko: `추정 오차 ${pctTxt(err)} — ±5% 밖 (그래도 기록으로 올릴지 판단)` });
    const facts = {
      ticker: s.ticker, company: name, quarter: qLabel(s.q_end),
      our_estimate_before_report: moneyTxt(e.est, e.currency), estimate_date: dayEn(e.date), estimate_range: `${moneyTxt(e.low, e.currency)}–${moneyTxt(e.high, e.currency)}`,
      actual_revenue: moneyTxt(fin.revenue, fin.currency), our_error: pctTxt(err), actual_within_our_range: inRange ? "yes" : "no",
      consensus_error: consErr != null ? pctTxt(consErr) : null,
      ...(({ sources, model }) => ({ sources: [...sources, "company filings (actual revenue)"], model }))(await sourcesOf(e.flows, e.method)), flags: flags.map((f) => f.code),
    };
    out.push({
      kind: "result", sig: `result:${s.ticker}:${s.q_end}`, title: `실적 결과 ${s.ticker} (추정 오차 ${pctTxt(err)})`,
      facts,
      guide: `Post type: earnings scorecard. Compare our pre-report model estimate (describe the model as in "model") with the actual reported revenue for ${name} ($${s.ticker}). State the error honestly whether it was a hit or a miss. If consensus_error is given, compare our error with the consensus error (percentages only — never a consensus dollar amount).`,
      asof: [monthEn(s.q_end)], sources: facts.sources, flags,
      brief: [`발표 전 추정 ${facts.our_estimate_before_report} (${e.date}) vs 실제 ${facts.actual_revenue} → 오차 ${facts.our_error}${consErr != null ? ` · 컨센 오차 ${pctTxt(consErr)}` : ""} · 범위 안 ${inRange ? "예" : "아니오"}`],
      data: { ticker: s.ticker, name, currency: fin.currency, quarters: await history(s.ticker, fin.period_end), est: e.est, low: e.low, high: e.high, actual: fin.revenue, qLabel: monthEn(s.q_end) } satisfies EarnChart,
    });
  }
  return out;
}
