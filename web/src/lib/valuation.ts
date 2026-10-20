import { pct } from "@/lib/format";

/** etl/multiples.py → multiple_now · multiple_hist (배수·우리 계산 시나리오만 — 원 주가·시총 없음) */
export type MultipleNow = {
  date: string; ticker: string; metric: "ev_s" | "ev_ebit" | null; basis: string | null; tier: string | null; now: number | null; now_trail: number | null;
  p10: number | null; p25: number | null; p50: number | null; p75: number | null; p90: number | null; p50_1y: number | null; n: number | null; pct: number | null;
  scen: string | null; reason: string | null; currency: string | null;
  px_time?: string | null; px_date?: string | null; px_kind?: string | null; // 계산에 쓴 주가 시각(UTC)·거래소 현지 날짜·종가/장중
};
export type MultipleHist = { ticker: string; q_end: string; metric: string; value: number };
export type Scenario = { mult: number; metric: number; equity: number; price: number | null; upside: number };
export const parseScen = (m: MultipleNow | null): Record<"bear" | "base" | "bull", Scenario> | null => (m?.scen ? JSON.parse(m.scen) : null);
/** 시나리오 표시 순서·이름 (저장 키 bear/base/bull) */
export const SCEN = [
  { k: "bull", label: "Best", how: "3년 상위 25% 배수 × 추정 상단" },
  { k: "base", label: "Base", how: "3년 중앙 배수 × 추정" },
  { k: "bear", label: "Worst", how: "3년 하위 25% 배수 × 추정 하단" },
] as const;

/** 이 계산에 쓴 주가가 언제 값인지 — '10/17 종가' 또는 '10/20 10:12 장중(한국 시간)'. 하루 한 번 갱신이라 실시간 아님 */
export function pxLabel(m: Pick<MultipleNow, "px_time" | "px_date" | "px_kind"> | null | undefined) {
  if (!m?.px_date) return null;
  if (m.px_kind !== "장중" || !m.px_time) return `${m.px_date.slice(5).replace("-", "/")} 종가`;
  const d = new Date(m.px_time);
  const kst = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d)
    .reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${kst.month}/${kst.day} ${kst.hour}:${kst.minute} 장중(한국 시간)`;
}

/** 예상 시가총액 (상장 통화) — $1.29T · $845B · 926조원 · €372B */
export function capFmt(v: number | null | undefined, currency: string | null | undefined) {
  if (v == null) return "-";
  if (currency === "KRW") return v >= 1e14 ? `${Math.round(v / 1e12).toLocaleString()}조원` : v >= 1e12 ? `${(v / 1e12).toFixed(1)}조원` : `${Math.round(v / 1e8).toLocaleString()}억원`;
  const s = currency === "EUR" ? "€" : "$";
  return v >= 1e12 ? `${s}${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `${s}${v >= 1e11 ? Math.round(v / 1e9) : (v / 1e9).toFixed(1)}B` : `${s}${Math.round(v / 1e6)}M`;
}

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

/** 요약 타일·표에 쓰는 한 줄: Base(Best·Worst) 또는 지금 배수 위치 */
export function valuationBrief(m: MultipleNow | null): { value: string; sub: string; tone: string } | null {
  if (!m || m.now == null || !m.metric) return null;
  const s = parseScen(m), at = pxLabel(m);
  if (s) return { value: `Base ${pct(s.base.upside, 0)}`, sub: `Best ${pct(s.bull.upside, 0)} · Worst ${pct(s.bear.upside, 0)}${at ? ` · ${at} 기준` : ""}`, tone: s.base.upside >= 0 ? "text-up" : "text-down" };
  return { value: `${mult(m.now)}`, sub: `${METRIC_LABEL[m.metric]} · ${bandWord(m) ?? ""} (3년 중앙 ${mult(m.p50)})`, tone: "" };
}
