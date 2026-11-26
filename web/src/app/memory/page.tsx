import type { Metadata } from "next";
import { CycleOverlay, type CycleSide } from "@/components/CycleOverlay";
import { MemoryPair, type Pair, type PriceLine } from "@/components/MemoryPair";
import { T } from "@/components/Names";
import { SectionNav } from "@/components/SectionNav";
import { PageHead } from "@/components/ui";
import ref2018 from "@/lib/cycle2018.json";
import { financials, observations, stockIndex, type Fin, type Obs } from "@/lib/queries";

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

const WEEK = 7 * 864e5;
const usdB = (v: number) => "$" + (v / 1e9).toFixed(2) + "B";
const drop = (v: number) => "−" + (100 - v).toFixed(0) + "%";

/** 주가 고점 주를 0으로 맞춘 한 사이클: 주가·단가를 각자 고점 = 100으로, 가로는 주(週) 차이 */
function cycleSide(label: string, stock: [string, number][], unit: [string, number][], from: string, to: string, fin: Fin[], comment: string, ongoing: boolean): CycleSide | null {
  const win = stock.filter(([d]) => d >= from && d <= to);
  if (win.length < 10 || unit.length < 6) return null;
  const peak = win.reduce((a, p) => (p[1] > a[1] ? p : a), win[0]);
  const t0 = Date.parse(peak[0]);
  const wk = (d: string) => Math.round((Date.parse(d) - t0) / WEEK);
  const sLine = stock.map(([d, v]): [number, number] => [wk(d), +((v / peak[1]) * 100).toFixed(1)]).filter(([x]) => x >= -78 && x <= 52);
  const uWin = unit.map(([m, v]): [number, number, string] => [wk(m + "-15"), v, m]).filter(([x]) => x >= -78 && x <= 52);
  if (!uWin.length) return null;
  const uPeak = uWin.reduce((a, p) => (p[1] > a[1] ? p : a), uWin[0]);
  const uLine = uWin.map(([x, v]): [number, number] => [x, +((v / uPeak[1]) * 100).toFixed(1)]);
  const after = sLine.filter(([x]) => x >= 0);
  const low = after.reduce((a, p) => (p[1] < a[1] ? p : a), after[0]);
  const last = after.at(-1)!;
  const uLast = uLine.at(-1)!;
  const uMonths = Math.round(uPeak[0] / 4.33);
  const uWhen = uMonths >= 0 ? "주가 고점 " + uMonths + "개월 뒤" : "주가 고점 " + -uMonths + "개월 전";

  let revenue = "-";
  if (ongoing) {
    const lastQ = fin.at(-1), prevQ = fin.at(-2);
    if (lastQ && prevQ) {
      const g = (lastQ.revenue / prevQ.revenue - 1) * 100;
      revenue = "최근 분기(" + lastQ.period_end.slice(0, 7) + ") " + usdB(lastQ.revenue) + ", 전분기 대비 " + (g >= 0 ? "+" : "−") + Math.abs(g).toFixed(0) + "%";
    }
  } else {
    const q = fin.filter((f) => Date.parse(f.period_end) >= t0 - 30 * WEEK && Date.parse(f.period_end) <= t0 + 80 * WEEK);
    if (q.length) {
      const qPeak = q.reduce((a, f) => (f.revenue > a.revenue ? f : a), q[0]);
      const qAfter = q.filter((f) => f.period_end > qPeak.period_end);
      revenue = qPeak.period_end.slice(0, 7) + " 분기 " + usdB(qPeak.revenue) + "가 고점";
      if (qAfter.length) {
        const qLow = qAfter.reduce((a, f) => (f.revenue < a.revenue ? f : a), qAfter[0]);
        revenue += " → " + qLow.period_end.slice(0, 7) + " 분기 " + usdB(qLow.revenue) + " (−" + ((1 - qLow.revenue / qPeak.revenue) * 100).toFixed(0) + "%)";
      }
    }
  }
  return {
    label, stockPeak: peak[0], stock: sLine, unit: uLine,
    rows: {
      "주가 고점": peak[0],
      "주가 저점 · 지금": ongoing ? last[0] + "주 뒤 지금 " + drop(last[1]) + " (가장 낮았던 주 " + drop(low[1]) + ")" : low[0] + "주 뒤 " + drop(low[1]) + "에서 저점",
      "출하 단가 고점": uPeak[2] + " (" + uWhen + ")" + (ongoing ? (uLast[1] >= 99.5 ? " · 아직 고점" : " · 지금 고점 대비 " + drop(uLast[1])) : ""),
      "분기 매출": revenue,
      "회사 코멘트": comment,
    },
  };
}

export default async function MemoryPage() {
  const ids = PAIRS.flatMap((p) => p.prices.map((x) => x[0]));
  const [obs, stock, muFin] = await Promise.all([observations([...ids]), stockIndex(), financials("MU")]);
  const pairs: Pair[] = PAIRS.map((p) => ({
    id: p.id, title: p.title, ticker: p.ticker, name: p.name, note: p.note,
    prices: p.prices.map(([id, label, unit, color]): PriceLine => ({ id, label, unit, color, data: unitPrice(obs, id) })).filter((x) => x.data.length > 3),
    stock: stock.filter((s) => s.ticker === p.ticker).map((s): [string, number] => [s.date, s.value]),
  })).filter((p) => p.prices.length > 0);

  const muStock = stock.filter((x) => x.ticker === "MU").map((x): [string, number] => [x.date, x.value]);
  const lastDay = muStock.at(-1)?.[0] ?? "";
  const twoYearsAgo = lastDay ? new Date(Date.parse(lastDay) - 104 * WEEK).toISOString().slice(0, 10) : "";
  const old = cycleSide("2018년 사이클", ref2018.stock as [string, number][], ref2018.unit as [string, number][], "2018-01-01", "2018-12-31", muFin.filter((f) => f.period_end < "2020"),
    "2018-09-20 다음 분기 가이던스를 처음 낮춤 → 2018-12-18 실적 발표에서 수요 약화 인정", false);
  const now = lastDay ? cycleSide("이번 사이클", muStock, unitPrice(obs, "kr_exp_dram"), twoYearsAgo, lastDay, muFin, "다음 실적 발표의 가이던스 방향이 확인 지점", true) : null;
  const nav = [...pairs.map((p) => ({ id: p.id, label: p.title.split(" ↔ ")[0] })), ...(old && now ? [{ id: "cycle", label: "2018년과 비교" }] : [])];

  return (
    <div className="space-y-5">
      <PageHead title={<T ko="메모리 가격·주가" en="Memory prices vs stocks" />} sub="DRAM · NAND · HDD 출하 단가와 대표 종목 주가 — 어느 쪽이 먼저 움직였나"
        info={<p>가격 선은 현물가가 아니라 세관에 신고된 수출입 금액 ÷ 수량(출하 단가)입니다 — 실제 거래된 물건의 평균 단가라 계약가에 가깝고, 현물가보다 몇 달 늦게 움직이며 고용량 제품 비중이 늘어도 오릅니다. 현물가(TrendForce·DRAMeXchange)는 재게시가 제한돼 싣지 않습니다. 주가는 가격이 아니라 지수로만(주 단위, 기간 고점 = 100) 보여주며, 하루 한 번 갱신됩니다. 투자 권유가 아닙니다.</p>} />
      <SectionNav items={nav} />
      {pairs.length === 0 ? <div className="card text-sm text-muted">수집 전입니다.</div> : pairs.map((p) => <MemoryPair key={p.id} pair={p} />)}
      {old && now && <CycleOverlay old={old} now={now} />}
      <p className="text-xs leading-relaxed text-muted">
        주가는 보통 가격보다 먼저 움직입니다 — 2018년에는 주가가 6월에 고점을 찍은 뒤에도 출하 단가는 10월까지 올랐습니다. 단가가 아직 버티는데 주가가 먼저 꺾였다면 시장이 가격 고점을 미리 반영하는 것일 수 있지만, 이 차트만으로 다음 방향을 알 수는 없습니다.
        출처: 한국 관세청, 일본 재무성 무역통계, U.S. Census Bureau, SEC EDGAR. 현물가 참고: <a className="text-accent" href="https://www.trendforce.com/price" target="_blank" rel="noreferrer">TrendForce</a>
      </p>
    </div>
  );
}
