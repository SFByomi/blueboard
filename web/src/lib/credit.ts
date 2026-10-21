import type { CreditRow } from "@/lib/queries";

/** 신용 판정 규칙 (신용 탭·종목 페이지 공용) */
export const ebitda = (r?: CreditRow) => r?.ebitda_ttm ?? r?.ebit_ttm ?? null; // 감가상각이 없으면(한국 요약 현금흐름표) 영업이익으로 — 레버리지가 다소 높게 나옴
export const lev = (r?: CreditRow) => { const e = ebitda(r); return r && r.net_debt != null && e && e > 0 ? r.net_debt / e : null; };
export const cov = (r?: CreditRow) => (r && r.ebit_ttm != null && r.interest_ttm ? r.ebit_ttm / r.interest_ttm : null);
export const dueCash = (r?: CreditRow) => (r && r.due_1y != null && r.cash ? r.due_1y / r.cash : null);
export const de = (r?: CreditRow) => (r && r.equity && r.equity > 0 ? (r.currency === "KRW" ? (r.liabilities ?? 0) : (r.debt ?? 0)) / r.equity : null);

/** 주의·관찰·양호 — 레버리지·이자 감당·현금흐름·단기 만기 기준(장부, 단순 규칙) */
export function risk(r?: CreditRow): ["주의" | "관찰" | "양호", string[]] {
  const why: string[] = [], l = lev(r), c = cov(r), d = dueCash(r);
  const e = ebitda(r), netCash = (r?.net_debt ?? 0) <= 0;
  let lvl = 0;
  if (netCash) {  // 순현금: 이자 부담은 기준이 아님 → 현금이 FCF 적자를 몇 년 버티나
    if (r?.fcf_ttm != null && r.fcf_ttm < 0) {
      const run = (r.cash ?? 0) / -r.fcf_ttm;
      lvl = run < 1.5 ? 2 : 1;
      why.push(`순현금이지만 FCF 적자 — 현금으로 ${run.toFixed(1)}년`);
    }
    return [(["양호", "관찰", "주의"] as const)[lvl], why];
  }
  if (e != null && e <= 0) { lvl = 2; why.push("EBITDA 적자인데 순부채"); }
  if (l != null && l > 4) { lvl = 2; why.push(`순부채/EBITDA ${l.toFixed(1)}배`); } else if (l != null && l > 2.5) { lvl = Math.max(lvl, 1); why.push(`순부채/EBITDA ${l.toFixed(1)}배`); }
  if (c != null && c < 2) { lvl = 2; why.push(`이자보상 ${c.toFixed(1)}배`); } else if (c != null && c < 5) { lvl = Math.max(lvl, 1); why.push(`이자보상 ${c.toFixed(1)}배`); }
  if (r?.fcf_ttm != null && r.fcf_ttm < 0) { lvl = Math.max(lvl, d != null && d > 1 ? 2 : 1); why.push(d != null && d > 1 ? "FCF 적자 + 1년 내 만기 > 현금" : "FCF 적자(차입·증자로 투자)"); }
  return [(["양호", "관찰", "주의"] as const)[lvl], why];
}
export const RISK_STYLE = { 주의: "bg-red-950 text-red-300", 관찰: "bg-amber-950 text-amber-300", 양호: "bg-up/20 text-up" };
export const x = (v: number | null, d = 1) => (v == null ? "-" : `${v.toFixed(d)}배`);

export const pdFmt = (p?: number | null) => (p == null ? "-" : p < 0.0005 ? "<0.1%" : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`);
export const pdTone = (p?: number | null) => (p == null ? "" : p >= 0.2 ? "text-down font-bold" : p >= 0.05 ? "text-amber-300" : "");

