import type { InflationRow, MacroObs } from "@/lib/queries";

/** 시장 점검 탭 — 다섯 가지 조건을 공개 데이터와 고정 규칙으로 판정. 규칙은 이 파일의 상수가 전부(화면 ⓘ에 그대로 적음) */
export type Status = "good" | "neutral" | "bad";
export type Line = { name: string; color: string; data: [string, number | null][]; kind?: "line" | "bar"; axis?: 0 | 1; dashed?: boolean };
export type CheckItem = {
  id: string; title: string; question: string; status: Status; label: string; headline: string; asof: string;
  facts: [string, string][]; rule: string; note?: string; href: string; hrefLabel: string;
  chart: { x: "time" | "category"; lines: Line[]; unit: string; unit2?: string };
};
export type BigtechRow = { ticker: string; q_end: string; cal_q: string; oi: number | null; ocf: number; capex: number; fcf: number; raised: number | null };

type Pt = [string, number];
const C = { a: "#3b82f6", b: "#d95926", c: "#8a90ad", d: "#22c55e", e: "#f59e0b" };
const by = (rows: MacroObs[], sid: string): Pt[] => rows.filter((r) => r.series === sid).map((r) => [r.date, r.value]);
/** daysAgo일 전(또는 그 직전 관측) 값 */
const ago = (s: Pt[], days: number) => {
  if (!s.length) return null;
  const t = Date.parse(s.at(-1)![0]) - days * 864e5;
  for (let i = s.length - 1; i >= 0; i--) if (Date.parse(s[i][0]) <= t) return s[i][1];
  return null;
};
const avg = (s: Pt[], n: number) => (s.length ? s.slice(-n).reduce((a, [, v]) => a + v, 0) / Math.min(n, s.length) : null);
const since = (s: Pt[], days: number): Pt[] => (s.length ? s.filter(([d]) => Date.parse(d) >= Date.parse(s.at(-1)![0]) - days * 864e5) : []);
const sgn = (v: number, d = 1, unit = "") => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}${unit}`;
const bp = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}bp`);
const usdB = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(2)}T` : `${Math.abs(v).toFixed(0)}B`}`;

// ── 1. 10년물 금리
export const R10 = { calm13w: 0.10, calmMa: 0.05, rise13w: 0.25 };
export function check10y(rates: MacroObs[]): CheckItem | null {
  const s = by(rates, "DGS10");
  if (s.length < 100) return null;
  const last = s.at(-1)![1], w4 = ago(s, 28), w13 = ago(s, 91), ma = avg(s, 50)!;
  const d4 = w4 == null ? null : last - w4, d13 = w13 == null ? null : last - w13;
  const status: Status = d13 != null && d13 <= R10.calm13w && last <= ma + R10.calmMa ? "good" : d13 != null && d13 >= R10.rise13w && last > ma ? "bad" : "neutral";
  const year = since(s, 370);
  const maLine: [string, number | null][] = year.map(([d], i) => {
    const k = s.length - year.length + i;
    return [d, k >= 49 ? +(s.slice(k - 49, k + 1).reduce((a, [, v]) => a + v, 0) / 50).toFixed(3) : null];
  });
  return {
    id: "rates", title: "미국 10년물 금리", question: "추세적으로 안정됐나", status, label: status === "good" ? "안정" : status === "bad" ? "상승 중" : "방향 불분명",
    headline: `${last.toFixed(2)}%`, asof: s.at(-1)![0],
    facts: [["4주", bp(d4)], ["13주", bp(d13)], ["50일 평균", `${ma.toFixed(2)}%`]],
    rule: `안정 = 13주 변화가 +${R10.calm13w * 100}bp 이하이고 50일 평균(+${R10.calmMa * 100}bp) 아래 · 상승 중 = 13주 +${R10.rise13w * 100}bp 이상이고 50일 평균 위 · 그 사이는 방향 불분명. 미 재무부 일별 수익률(FRED DGS10).`,
    href: "/macro#rates", hrefLabel: "매크로 · 금리",
    chart: { x: "time", unit: "%", lines: [{ name: "10년물", color: C.a, data: year }, { name: "50일 평균", color: C.c, data: maLine, dashed: true }] },
  };
}

// ── 2. 근원물가
export const RCPI = { gap: 0.3 };
const nextMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
/** 전월비 → n개월 연율(%) — 달이 연속일 때만 (2025년 10·11월처럼 빠진 달이 끼면 null) */
function annualized(mom: Pt[], n: number): [string, number | null][] {
  return mom.map(([m], i) => {
    if (i < n - 1) return [m, null];
    const w = mom.slice(i - n + 1, i + 1);
    for (let k = 1; k < w.length; k++) if (nextMonth(w[k - 1][0]) !== w[k][0]) return [m, null];
    return [m, +((w.reduce((a, [, v]) => a * (1 + v), 1) ** (12 / n) - 1) * 100).toFixed(2)];
  });
}
export function checkCore(infl: InflationRow[]): CheckItem | null {
  const pick = (measure: string, kind: string): Pt[] => infl.filter((r) => r.measure === measure && r.basis === "core" && r.kind === kind).map((r) => [r.month, r.total]);
  const mom = pick("CPI", "mom"), yoy = pick("CPI", "yoy"), pce = pick("PCE", "mom");
  if (mom.length < 12) return null;
  const a3 = annualized(mom, 3), a6 = annualized(mom, 6), p3 = annualized(pce, 3);
  const v3 = a3.at(-1)![1], v6 = a6.at(-1)![1], month = mom.at(-1)![0], y = yoy.at(-1);
  if (v3 == null) return null;
  const gap = v6 == null ? null : v3 - v6;
  const status: Status = gap == null ? "neutral" : gap >= RCPI.gap ? "bad" : gap <= -RCPI.gap ? "good" : "neutral";
  const from = a3.length > 36 ? a3[a3.length - 36][0] : a3[0][0];
  const pv = p3.at(-1);
  return {
    id: "core", title: "근원물가", question: "다시 오르고 있나", status, label: status === "bad" ? "재상승" : status === "good" ? "둔화" : "횡보",
    headline: `${v3.toFixed(1)}%`, asof: `${month.slice(0, 4)}년 ${+month.slice(5)}월분`,
    facts: [["근원 CPI 3개월 연율", `${v3.toFixed(1)}%`], ["6개월 연율", v6 == null ? "-" : `${v6.toFixed(1)}%`], [`전년비(${y ? +y[0].slice(5) : "-"}월)`, y ? `${(y[1] * 100).toFixed(1)}%` : "-"],
      ...(pv && pv[1] != null ? [[`근원 PCE 3개월 연율(${+pv[0].slice(5)}월)`, `${pv[1].toFixed(1)}%`] as [string, string]] : [])],
    rule: `재상승 = 근원 CPI 3개월 연율이 6개월 연율보다 ${RCPI.gap}%p 이상 높음 · 둔화 = ${RCPI.gap}%p 이상 낮음 · 그 사이는 횡보. 연율 = 계절조정 전월비를 3(6)개월 곱해 1년으로 환산. 2025년 10월 CPI가 발표되지 않아 그 앞뒤 달은 비어 있고, 2026년 10월 전년비는 계산할 수 없음.`,
    href: "/macro#inflation", hrefLabel: "매크로 · 물가 기여도",
    chart: { x: "category", unit: "%", lines: [
      { name: "근원 CPI 3개월 연율", color: C.b, data: a3.filter(([m]) => m >= from) },
      { name: "6개월 연율", color: C.c, data: a6.filter(([m]) => m >= from), dashed: true },
      { name: "전년비", color: C.a, data: a3.filter(([m]) => m >= from).map(([m]) => { const r = yoy.find(([d]) => d === m); return [m, r ? +(r[1] * 100).toFixed(2) : null]; }) },
    ] },
  };
}

// ── 3. 유동성
export function checkLiquidity(macro: MacroObs[]): CheckItem | null {
  const s = by(macro, "NETLIQ"), res = by(macro, "WRESBAL"), tga = by(macro, "WTREGEN");
  if (s.length < 30) return null;
  const last = s.at(-1)![1], w4 = ago(s, 28), w13 = ago(s, 91);
  const d4 = w4 == null ? null : last - w4, d13 = w13 == null ? null : last - w13;
  const status: Status = d4 != null && d13 != null && d4 > 0 && d13 > 0 ? "good" : d4 != null && d13 != null && d4 < 0 && d13 < 0 ? "bad" : "neutral";
  const r13 = res.length ? res.at(-1)![1] - (ago(res, 91) ?? res.at(-1)![1]) : null, t13 = tga.length ? tga.at(-1)![1] - (ago(tga, 91) ?? tga.at(-1)![1]) : null;
  return {
    id: "liquidity", title: "금융시장 유동성", question: "늘고 있나", status, label: status === "good" ? "개선" : status === "bad" ? "축소" : "엇갈림",
    headline: usdB(last), asof: s.at(-1)![0],
    facts: [["순유동성 4주", d4 == null ? "-" : sgn(d4, 0, "B")], ["13주", d13 == null ? "-" : sgn(d13, 0, "B")], ["지급준비금 13주", r13 == null ? "-" : sgn(r13, 0, "B")], ["TGA 13주", t13 == null ? "-" : sgn(t13, 0, "B")]],
    rule: "개선 = 순유동성이 4주 전·13주 전보다 모두 늘어남 · 축소 = 모두 줄어듦 · 그 밖은 엇갈림. 순유동성 = 연준 총자산 − 재무부 계좌(TGA) − 역레포(주간, 십억 달러). TGA가 늘면 시중에서 돈이 빠지고, 지급준비금은 은행 시스템에 남은 돈.",
    href: "/macro#liquidity", hrefLabel: "매크로 · 유동성",
    chart: { x: "time", unit: "$B", lines: [{ name: "순유동성", color: C.a, data: since(s, 740) }] },
  };
}

// ── 4. AI 투자 기업(빅테크 5곳) 이익·현금흐름
export const BIGTECH = ["MSFT", "GOOGL", "AMZN", "META", "ORCL"];
const BIG_KO: Record<string, string> = { MSFT: "마이크로소프트", GOOGL: "알파벳", AMZN: "아마존", META: "메타", ORCL: "오라클" };
export function checkBigtech(rows: BigtechRow[]): (CheckItem & { table: { name: string; q: string; oi: number | null; ocf: number; capex: number; fcf: number }[] }) | null {
  const qs = [...new Set(rows.map((r) => r.cal_q))].sort();
  const full = qs.filter((q) => BIGTECH.every((t) => rows.some((r) => r.cal_q === q && r.ticker === t)));
  if (full.length < 6) return null;
  const sum = (q: string, k: "oi" | "ocf" | "capex" | "fcf") => rows.filter((r) => r.cal_q === q && BIGTECH.includes(r.ticker)).reduce((a, r) => a + (r[k] ?? 0), 0) / 1e9;
  const q = full.at(-1)!, prev = `${+q.slice(0, 4) - 1}${q.slice(4)}`;
  if (!full.includes(prev)) return null;
  const g = (k: "oi" | "ocf" | "capex") => sum(q, k) / sum(prev, k) - 1;
  const fcf = sum(q, "fcf"), fcf0 = sum(prev, "fcf"), oiG = g("oi"), ocfG = g("ocf"), capG = g("capex");
  const status: Status = oiG > 0 && fcf > fcf0 ? "good" : fcf < fcf0 && (oiG <= 0 || fcf < 0) ? "bad" : "neutral";
  const qLab = (x: string) => `${x.slice(2, 4)}.${x.slice(5)}Q`;
  const show = full.slice(-12);
  return {
    id: "bigtech", title: "AI 투자 기업의 이익·현금흐름", question: "좋아지고 있나", status,
    label: status === "good" ? "개선" : status === "bad" ? "현금흐름 악화" : oiG > 0 ? "이익 증가·현금 감소" : "엇갈림",
    headline: `FCF ${usdB(fcf)}`, asof: `${q.slice(0, 4)}년 ${q.slice(5)}분기 · 5곳 합산`,
    facts: [["영업이익 전년비", sgn(oiG * 100, 0, "%")], ["영업현금흐름", sgn(ocfG * 100, 0, "%")], ["설비투자", sgn(capG * 100, 0, "%")], ["FCF 1년 전", usdB(fcf0)], ["설비투자 ÷ 영업현금흐름", `${((sum(q, "capex") / sum(q, "ocf")) * 100).toFixed(0)}%`]],
    rule: "개선 = 영업이익이 1년 전보다 늘고 FCF도 1년 전보다 큼 · 현금흐름 악화 = FCF가 1년 전보다 줄었는데 영업이익이 줄었거나 FCF가 마이너스 · 그 밖은 엇갈림. 마이크로소프트·알파벳·아마존·메타·오라클 합산(SEC 분기 공시), FCF = 영업현금흐름 − 설비투자(유형자산 취득, 금융리스 제외 — 회사 자체 정의와 다를 수 있음). 오라클은 8·11·2·5월 결산이라 가장 가까운 분기에 붙였고, 다섯 곳이 모두 공시한 분기까지만 표시.",
    note: "설비투자가 영업현금흐름을 넘으면 부족분은 보유 현금·차입으로 메웁니다.",
    href: "/credit", hrefLabel: "신용 탭",
    chart: { x: "category", unit: "$B", lines: [
      { name: "영업현금흐름", color: C.a, kind: "bar", data: show.map((x) => [qLab(x), +sum(x, "ocf").toFixed(1)]) },
      { name: "설비투자", color: C.b, kind: "bar", data: show.map((x) => [qLab(x), +sum(x, "capex").toFixed(1)]) },
      { name: "FCF", color: C.d, data: show.map((x) => [qLab(x), +sum(x, "fcf").toFixed(1)]) },
      { name: "영업이익", color: C.c, dashed: true, data: show.map((x) => [qLab(x), +sum(x, "oi").toFixed(1)]) },
    ] },
    table: BIGTECH.map((t) => { const r = rows.find((x) => x.cal_q === q && x.ticker === t)!; return { name: BIG_KO[t], q: r.q_end.slice(0, 7), oi: r.oi == null ? null : r.oi / 1e9, ocf: r.ocf / 1e9, capex: r.capex / 1e9, fcf: r.fcf / 1e9 }; }),
  };
}

// ── 5. 중소형주·경기민감주 상대 강세
export function checkBreadth(rel: MacroObs[]): CheckItem | null {
  const S = { SMALL: by(rel, "SMALL"), CYC: by(rel, "CYC"), EQUAL: by(rel, "EQUAL") };
  if (S.SMALL.length < 100 || S.CYC.length < 100) return null;
  const m = (s: Pt[]) => {
    const last = s.at(-1)![1], w4 = ago(s, 28), w13 = ago(s, 91), ma = avg(s, 50)!;
    return { d4: w4 == null ? null : (last / w4 - 1) * 100, d13: w13 == null ? null : (last / w13 - 1) * 100, above: last >= ma };
  };
  const sm = m(S.SMALL), cy = m(S.CYC), eq = S.EQUAL.length ? m(S.EQUAL) : null;
  const up = (x: typeof sm) => x.d13 != null && x.d13 > 0 && x.above, down = (x: typeof sm) => x.d13 != null && x.d13 < 0 && !x.above;
  const status: Status = up(sm) && up(cy) ? "good" : down(sm) && down(cy) ? "bad" : "neutral";
  const f = (v: number | null) => (v == null ? "-" : sgn(v, 1, "%"));
  const rebase = (s: Pt[]): [string, number][] => { const y = since(s, 370); const b = y[0]?.[1] ?? 1; return y.map(([d, v]) => [d, +((v / b) * 100).toFixed(2)]); };
  return {
    id: "breadth", title: "중소형주·경기민감주", question: "대형주보다 강한 흐름이 이어지나", status, label: status === "good" ? "상대 강세" : status === "bad" ? "상대 약세" : "엇갈림",
    headline: `중소형 ${f(sm.d13)}`, asof: S.SMALL.at(-1)![0],
    facts: [["중소형주 4주", f(sm.d4)], ["13주", f(sm.d13)], ["경기민감 4주", f(cy.d4)], ["13주", f(cy.d13)], ...(eq ? [["동일가중 13주", f(eq.d13)] as [string, string]] : [])],
    rule: "상대 강세 = 중소형주·경기민감주 모두 S&P 500 대비 13주 수익률이 플러스이고 50일 평균 위 · 상대 약세 = 둘 다 13주 마이너스이고 50일 평균 아래 · 그 밖은 엇갈림. 숫자는 S&P 500(SPY) 대비 초과 수익률: 중소형주 = 러셀 2000(IWM), 경기민감 = 산업재·소재·금융·에너지 업종 ETF 평균, 동일가중 = S&P 500 동일가중(RSP) — 동일가중이 약하면 상승이 소수 대형주에 쏠렸다는 뜻. 차트는 1년 전 = 100인 S&P 500 대비 비율(오르면 S&P 500보다 강함). 배당 반영 종가로 계산한 비율만 표시.",
    href: "/macro", hrefLabel: "매크로",
    chart: { x: "time", unit: "", lines: [{ name: "중소형주", color: C.b, data: rebase(S.SMALL) }, { name: "경기민감", color: C.a, data: rebase(S.CYC) }, { name: "동일가중", color: C.d, data: rebase(S.EQUAL), dashed: true }] },
  };
}
