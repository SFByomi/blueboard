import type { Metadata } from "next";
import { CycleOverlay, type CycleData, type CycleRows } from "@/components/CycleOverlay";
import { MemoryPair, type Pair, type PriceLine } from "@/components/MemoryPair";
import { T } from "@/components/Names";
import { SectionNav } from "@/components/SectionNav";
import { PageHead } from "@/components/ui";
import ref2018 from "@/lib/cycle2018.json";
import { earningsDates, financials, latestEstimates, observations, stockIndex, type Fin, type Obs, type RevEstimate } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "메모리 가격·주가", description: "DRAM·NAND·HDD 출하 단가(세관 신고 금액 ÷ 수량)와 마이크론·샌디스크·시게이트 주가를 기간 고점 = 100으로 비교, 2018년 사이클과 겹쳐 보기" };

// 메모리 종류 → 단가를 볼 무역 흐름(첫 번째가 대표) + 대표 종목
const PAIRS = [
  { id: "dram", title: "DRAM ↔ 마이크론", ticker: "MU", name: "마이크론",
    prices: [["kr_exp_dram", "한국 DRAM 수출", "kg", "#22c55e"], ["us_imp_tw_dram", "대만산 DRAM 미국 수입", "개", "#f59e0b"]],
    note: "단가 = 한국 DRAM 수출 금액 ÷ 중량(kg), 3개월 합으로 나눈 이동 단가. 한국 DRAM 수출은 마이크론 매출과 같은 사이클(매출 전년비 상관 0.9 이상)이고, 점선은 마이크론 대만 공장 물량이 섞인 대만산 DRAM의 미국 수입 단가(개당). HBM은 별도 세번(복합구조칩)이라 여기 단가엔 일부만 들어갑니다." },
  { id: "nand", title: "NAND ↔ 샌디스크", ticker: "SNDK", name: "샌디스크",
    prices: [["jp_exp_mem_nat", "일본 메모리 수출", "개", "#3b82f6"], ["kr_exp_flash", "한국 플래시 수출", "kg", "#d95926"]],
    note: "단가 = 일본 전국 메모리IC 수출 금액 ÷ 개수(샌디스크·키옥시아 합작 공장 물량 — 샌디스크 매출과 가장 잘 맞는 흐름), 점선은 한국 플래시메모리 수출 단가(kg당, 삼성·SK하이닉스). 샌디스크는 2025년 2월 상장이라 주가는 그 뒤부터." },
  { id: "hdd", title: "HDD ↔ 시게이트", ticker: "STX", name: "시게이트",
    prices: [["us_imp_th_hdd", "태국산 HDD 수입", "개", "#a78bfa"], ["us_imp_all_hdd", "전체 HDD 수입", "개", "#8a90ad"]],
    note: "단가 = 미국으로 들어오는 태국산 HDD 수입 금액 ÷ 대수(시게이트·웨스턴디지털 태국 공장). HDD는 현물 시장이 따로 없어 수입 단가가 가격·용량 믹스의 대용 지표 — 대당 용량이 커져도 오릅니다. 점선은 전체 원산지." },
] as const;

/** 월별 금액·수량 → 3개월 이동 단가 [YYYY-MM, 금액 합 ÷ 수량 합] */
function unitPrice(obs: Obs[], id: string): [string, number][] {
  const rows = obs.filter((o) => o.series_id === id && (o.value_usd ?? 0) > 0 && (o.qty ?? 0) > 0).sort((a, b) => a.month.localeCompare(b.month));
  return rows.map((r, i) => {
    const w = rows.slice(Math.max(0, i - 2), i + 1);
    return w.length < 3 ? null : [r.month, w.reduce((a, x) => a + x.value_usd!, 0) / w.reduce((a, x) => a + x.qty!, 0)] as [string, number];
  }).filter((x): x is [string, number] => x != null);
}

type Pt = [string, number];
const WEEK = 7 * 864e5;
const usdB = (v: number) => "$" + (v / 1e9).toFixed(2) + "B";
const maxOf = (pts: Pt[]) => pts.reduce((a, p) => (p[1] > a[1] ? p : a), pts[0]);
const minOf = (pts: Pt[]) => pts.reduce((a, p) => (p[1] < a[1] ? p : a), pts[0]);
const months = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / (30.44 * 864e5));
/** 분기가 덮는 달 — 마이크론처럼 달력과 어긋난 회계 분기(5/29~9/3)를 '6~8월'로. 월말·월초 며칠은 가까운 달로 */
function monthSpan(start: string, end: string): string {
  const a = new Date(Date.parse(start) + 6 * 864e5), b = new Date(Date.parse(end) - 6 * 864e5);
  return (a.getUTCMonth() + 1) + "~" + (b.getUTCMonth() + 1) + "월";
}
type Pending = { est: RevEstimate; next: string | null };  // 아직 발표 전인 진행 분기 추정

/** 한 사이클의 주가·출하 단가·분기 매출과 기준일(고점들). from~to 안에서 주가 고점을 찾음 */
function cycle(stock: Pt[], unitMonthly: Pt[], fin: Fin[], from: string, to: string, pending: Pending | null | false): { data: CycleData; row: Record<string, string> } | null {
  const ongoing = pending !== false;
  const win = stock.filter(([d]) => d >= from && d <= to);
  if (win.length < 10 || unitMonthly.length < 6) return null;
  const sPeak = maxOf(win);
  const t0 = Date.parse(sPeak[0]);
  const near = (d: string, before = 110, after = 80) => Date.parse(d) >= t0 - before * WEEK && Date.parse(d) <= t0 + after * WEEK;
  const s = stock.filter(([d]) => near(d));
  const unit = unitMonthly.map(([m, v]): Pt => [m + "-15", v]).filter(([d]) => near(d));
  const fins = fin.filter((f) => near(f.period_end));
  const rev = fins.map((f): Pt => [f.period_end, f.revenue]);
  const span = (end: string) => { const f = fins.find((x) => x.period_end === end); return f ? monthSpan(f.period_start, f.period_end) : end.slice(0, 7); };
  if (!unit.length || rev.length < 2) return null;
  const uPeak = maxOf(unit);
  const rPeak = ongoing ? rev.at(-1)! : maxOf(rev);
  const rIdx = rev.findIndex((r) => r[0] === rPeak[0]);
  const rPrev = rev[Math.max(0, rIdx - 1)];
  const after = s.filter(([d]) => d >= sPeak[0]);
  const low = minOf(after), last = after.at(-1)!;
  const pctDown = (v: number) => "−" + ((1 - v / sPeak[1]) * 100).toFixed(0) + "%";
  const weeks = (d: string) => Math.round((Date.parse(d) - t0) / WEEK);
  const uM = months(sPeak[0], uPeak[0]);
  const uLast = unit.at(-1)!;
  const qoq = (v: number, base: number) => { const g = (v / base - 1) * 100; return (g >= 0 ? "+" : "−") + Math.abs(g).toFixed(0) + "%"; };
  const md = (d: string) => +d.slice(5, 7) + "/" + +d.slice(8, 10);
  let revenue: string, nextQ: string, revEst: Pt | null = null;
  if (ongoing) {
    revenue = "발표된 마지막 분기(" + span(rPeak[0]) + ", " + md(rPeak[0]) + " 마감) " + usdB(rPeak[1]) + ", 전분기 대비 " + qoq(rPeak[1], rPrev[1]) + " — 아직 꺾이지 않음";
    const e = pending && pending.est.q_end > rPeak[0] ? pending.est : null;  // 이미 발표된 분기의 추정이면 쓰지 않음
    if (e) {
      revEst = [e.q_end, e.est];
      let g: { low?: number; high?: number } = {};
      try { g = JSON.parse(e.guide ?? "{}"); } catch { /* 가이던스 없음 */ }
      nextQ = monthSpan(e.q_start, e.q_end) + " 분기(" + md(e.q_end) + " 마감)는 아직 발표 전" + (pending && pending.next ? " — " + md(pending.next) + " 발표 예정" : "")
        + " · 우리 추정 " + usdB(e.est) + " (전분기 대비 " + qoq(e.est, rPeak[1]) + ", 범위 " + usdB(e.low) + "~" + usdB(e.high) + ")"
        + (g.low && g.high ? " · 회사 가이던스 " + usdB(g.low) + "~" + usdB(g.high) : "");
    } else nextQ = "추정 없음";
  } else {
    const rLow = minOf(rev.filter((r) => r[0] > rPeak[0]));
    const rNext = rev[rIdx + 1];
    revenue = span(rPeak[0]) + " 분기(" + rPeak[0].slice(0, 7) + " 마감) " + usdB(rPeak[1]) + "가 고점 → " + rLow[0].slice(0, 7) + " 마감 분기 " + usdB(rLow[1]) + " (−" + ((1 - rLow[1] / rPeak[1]) * 100).toFixed(0) + "%)";
    nextQ = rNext ? "고점 다음 분기(" + span(rNext[0]) + ") " + usdB(rNext[1]) + ", 전분기 대비 " + qoq(rNext[1], rPeak[1]) + " — 여기서 꺾이기 시작" : "-";
  }
  return {
    data: { stock: s, unit, rev, revEst, stockPeak: sPeak[0], unitPeak: uPeak[0], revPeak: rPeak[0], revPrev: rPrev[0] },
    row: {
      "주가 고점": sPeak[0],
      "주가 저점 · 지금": ongoing ? weeks(last[0]) + "주 뒤 지금 " + pctDown(last[1]) + " (가장 낮았던 주 " + pctDown(low[1]) + ")" : weeks(low[0]) + "주 뒤 " + pctDown(low[1]) + "에서 저점",
      "출하 단가 고점": uPeak[0].slice(0, 7) + " (주가 고점 " + (uM >= 0 ? uM + "개월 뒤" : -uM + "개월 전") + ")" + (ongoing ? (uLast[1] >= uPeak[1] * 0.995 ? " · 아직 고점" : " · 지금 고점 대비 −" + ((1 - uLast[1] / uPeak[1]) * 100).toFixed(0) + "%") : ""),
      "분기 매출": revenue,
      "그다음 분기": nextQ,
    },
  };
}

export default async function MemoryPage() {
  const ids = PAIRS.flatMap((p) => p.prices.map((x) => x[0]));
  const [obs, stock, muFin, ests, nextDates] = await Promise.all([observations([...ids]), stockIndex(), financials("MU"), latestEstimates(), earningsDates()]);
  const muEst = ests.find((e) => e.ticker === "MU");
  const pairs: Pair[] = PAIRS.map((p) => ({
    id: p.id, title: p.title, ticker: p.ticker, name: p.name, note: p.note,
    prices: p.prices.map(([id, label, unit, color]): PriceLine => ({ id, label, unit, color, data: unitPrice(obs, id) })).filter((x) => x.data.length > 3),
    stock: stock.filter((s) => s.ticker === p.ticker).map((s): Pt => [s.date, s.value]),
  })).filter((p) => p.prices.length > 0);

  const muStock = stock.filter((x) => x.ticker === "MU").map((x): Pt => [x.date, x.value]);
  const lastDay = muStock.at(-1)?.[0] ?? "";
  const twoYearsAgo = lastDay ? new Date(Date.parse(lastDay) - 104 * WEEK).toISOString().slice(0, 10) : "";
  const old = cycle(ref2018.stock as Pt[], ref2018.unit as Pt[], muFin.filter((f) => f.period_end < "2020"), "2018-01-01", "2018-12-31", false);
  const now = lastDay ? cycle(muStock, unitPrice(obs, "kr_exp_dram"), muFin, twoYearsAgo, lastDay, muEst ? { est: muEst, next: nextDates.MU ?? null } : null) : null;
  const rows: CycleRows | null = old && now ? {
    ...Object.fromEntries(Object.keys(old.row).map((k) => [k, [old.row[k], now.row[k]] as [string, string]])),
    "회사 코멘트": ["2018-09-20 다음 분기 가이던스를 처음 낮춤 → 2018-12-18 실적 발표에서 수요 약화 인정", "다음 실적 발표의 가이던스 방향이 확인 지점"],
  } : null;
  const nav = [...pairs.map((p) => ({ id: p.id, label: p.title.split(" ↔ ")[0] })), ...(rows ? [{ id: "cycle", label: "2018년과 비교" }] : [])];

  return (
    <div className="space-y-5">
      <PageHead title={<T ko="메모리 가격·주가" en="Memory prices vs stocks" />} sub="DRAM · NAND · HDD 출하 단가와 대표 종목 주가 — 어느 쪽이 먼저 움직였나"
        info={<p>가격 선은 현물가가 아니라 세관에 신고된 수출입 금액 ÷ 수량(출하 단가)입니다 — 실제 거래된 물건의 평균 단가라 계약가에 가깝고, 현물가보다 몇 달 늦게 움직이며 고용량 제품 비중이 늘어도 오릅니다. 현물가(TrendForce·DRAMeXchange)는 재게시가 제한돼 싣지 않습니다. 주가는 가격이 아니라 지수로만(주 단위, 기간 고점 = 100) 보여주며, 하루 한 번 갱신됩니다. 차트는 끌어서 옮기고 두 손가락(또는 휠)으로 확대할 수 있습니다. 투자 권유가 아닙니다.</p>} />
      <SectionNav items={nav} />
      {pairs.length === 0 ? <div className="card text-sm text-muted">수집 전입니다.</div> : pairs.map((p) => <MemoryPair key={p.id} pair={p} />)}
      {old && now && rows && <CycleOverlay old={old.data} now={now.data} rows={rows} lastDay={lastDay} />}
      <p className="text-xs leading-relaxed text-muted">
        주가는 보통 가격보다 먼저 움직입니다 — 2018년에는 주가가 6월에 고점을 찍은 뒤에도 출하 단가는 10월까지 올랐습니다. 단가가 아직 버티는데 주가가 먼저 꺾였다면 시장이 가격 고점을 미리 반영하는 것일 수 있지만, 이 차트만으로 다음 방향을 알 수는 없습니다.
        출처: 한국 관세청, 일본 재무성 무역통계, U.S. Census Bureau, SEC EDGAR. 현물가 참고: <a className="text-accent" href="https://www.trendforce.com/price" target="_blank" rel="noreferrer">TrendForce</a>
      </p>
    </div>
  );
}
