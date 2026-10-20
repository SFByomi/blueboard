import { pct } from "@/lib/format";

/** etl/multiples.py → multiple_now · multiple_hist (배수·우리 계산 시나리오만 — 원 주가·시총 없음) */
export type MultipleNow = {
  date: string; ticker: string; metric: "ev_s" | "ev_ebit" | null; basis: string | null; tier: string | null; now: number | null; now_trail: number | null;
  p10: number | null; p25: number | null; p50: number | null; p75: number | null; p90: number | null; p50_1y: number | null; n: number | null; pct: number | null;
  scen: string | null; reason: string | null; currency: string | null;
};
export type MultipleHist = { ticker: string; q_end: string; metric: string; value: number };
export type Scenario = { mult: number; metric: number; equity: number; price: number | null; upside: number };
export const parseScen = (m: MultipleNow | null): Record<"bear" | "base" | "bull", Scenario> | null => (m?.scen ? JSON.parse(m.scen) : null);

export const METRIC_LABEL: Record<string, string> = { ev_s: "EV/매출", ev_ebit: "EV/영업이익" };
export const METRIC_HINT: Record<string, string> = {
  ev_s: "PSR과 비슷 — 기업가치(시가총액 + 순부채) ÷ 연환산 매출",
  ev_ebit: "PER과 비슷한 이익 배수 — 기업가치(시가총액 + 순부채) ÷ 연환산 영업이익 (이자·세금·일회성 손익 차이를 걷어냄)",
};
export const mult = (v: number | null | undefined) => (v == null ? "-" : `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}배`);

/** 주당 가격 (상장 통화) */
export function priceFmt(v: number | null | undefined, currency: string | null | undefined) {
  if (v == null) return "-";
  if (currency === "KRW") return `${Math.round(v).toLocaleString()}원`;
  const s = currency === "EUR" ? "€" : "$";
  return `${s}${v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2)}`;
}

/** 3년 배수 중 지금 위치 → 말 */
export function bandWord(m: MultipleNow) {
  if (m.now == null || m.p10 == null || m.p90 == null) return null;
  if (m.now > m.p90) return "3년 최고 수준 위";
  if (m.now < m.p10) return "3년 최저 수준 아래";
  const p = m.pct ?? 0.5;
  return p >= 0.75 ? "3년 상단" : p <= 0.25 ? "3년 하단" : "3년 중간";
}

/** 요약 타일·표에 쓰는 한 줄: 기준 시나리오 또는 지금 배수 위치 */
export function valuationBrief(m: MultipleNow | null): { value: string; sub: string; tone: string } | null {
  if (!m || m.now == null || !m.metric) return null;
  const s = parseScen(m);
  if (s) return { value: pct(s.base.upside, 0), sub: `기준 시나리오 · ${METRIC_LABEL[m.metric]} 3년 중앙 ${mult(m.p50)}`, tone: s.base.upside >= 0 ? "text-up" : "text-down" };
  return { value: `${mult(m.now)}`, sub: `${METRIC_LABEL[m.metric]} · ${bandWord(m) ?? ""} (3년 중앙 ${mult(m.p50)})`, tone: "" };
}
