export const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !isFinite(v) ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;

export function usd(v: number | null | undefined) {
  if (v == null) return "-";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** 매출 등 통화 금액: USD는 $1.2B, KRW는 3.46조 / 6,020억 */
export function money(v: number | null | undefined, currency = "USD") {
  if (v == null) return "-";
  if (currency !== "KRW") return usd(v);
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}조원`;
  return `${Math.round(v / 1e8).toLocaleString()}억원`;
}

export const tone = (v: number | null | undefined) => (v == null ? "text-muted" : v >= 0 ? "text-up" : "text-down");

export const ROLE_STYLE: Record<string, string> = {
  생산출하: "bg-emerald-950 text-emerald-300",
  회사출하: "bg-sky-950 text-sky-300",
  생산투입: "bg-amber-950 text-amber-300",
  최종수요: "bg-violet-950 text-violet-300",
  가격벤치마크: "bg-pink-950 text-pink-300",
};
export const ROLES = Object.keys(ROLE_STYLE);
export const CONFIDENCES = ["높음", "중간", "낮음"];
