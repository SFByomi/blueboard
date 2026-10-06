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

/** 종목 목록 섹터 그룹 (표시 순서) — companies.grp */
export const GROUPS = ["메모리", "광통신", "서버·네트워크", "반도체", "전력·냉각", "AI 클라우드", "부품·소재", "바이오", "기타"];

/** 매핑 역할 → 공급망 단계 (종목 페이지에서 이 순서로 묶음) */
export const STAGES = [
  { key: "input", title: "① 부품 조달", desc: "생산에 들어가는 부품·소재 — 출하보다 먼저 움직임", roles: ["생산투입"] },
  { key: "make", title: "② 생산거점 출하", desc: "공장이 있는 지역의 수출", roles: ["생산출하"] },
  { key: "ship", title: "③ 고객향 반입", desc: "미국 등 최종 시장으로 들어오는 물량", roles: ["회사출하"] },
  { key: "demand", title: "④ 수요·업황", desc: "업계 전체 수요 — 회사 물량 아님", roles: ["최종수요"] },
  { key: "price", title: "⑤ 가격·경쟁사", desc: "단가 사이클·경쟁사 흐름", roles: ["가격벤치마크"] },
] as const;
export const stageOf = (role: string) => STAGES.find((st) => (st.roles as readonly string[]).includes(role))?.key ?? "demand";

export type Site = { name: string; country: string; what: string };
export function parseSites(json: string | null): Site[] {
  try { return json ? (JSON.parse(json) as Site[]) : []; } catch { return []; }
}

/** 종목 섹터 그룹 → 종목 페이지에 붙일 가격지수 그룹 (etl/indicators.py의 그룹명) */
export const INDEX_FOR_GROUP: Record<string, string[]> = {
  메모리: ["메모리 단가", "반도체"], 반도체: ["반도체"], 광통신: ["네트워크"], "서버·네트워크": ["서버·스토리지", "네트워크"],
  "전력·냉각": ["전력·냉각"], "AI 클라우드": ["서버·스토리지"], "부품·소재": ["부품 단가", "반도체"],
};
