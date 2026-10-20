import type { Metadata } from "next";
import { CreditSection } from "@/components/CreditSection";
import { ImpliedSpread, SPREAD_SET } from "@/components/ImpliedSpread";
import { companies, creditMetrics, finraMarket, marketCredit, ustCurve } from "@/lib/queries";
import { PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "신용", description: "AI·반도체 기업의 빚 감당 체력(장부)과 주가 내재 부도확률, 회사채 시장·미 국채 곡선" };

export default async function CreditPage() {
  const [rows, cos, ust, finra, mkt] = await Promise.all([creditMetrics(), companies(), ustCurve(), finraMarket(), marketCredit()]);
  // 주가 내재 부도확률은 일별 → 주 1회(금요일 근처)로 줄여 전송
  const weekly = mkt.filter((r, i) => i === mkt.length - 1 || mkt[i + 1]?.ticker !== r.ticker || new Date(r.date).getDay() === 5);
  // 내재 스프레드 차트는 최근 6개월 일별, 정해 둔 AI 인프라 차입 기업만
  const latest = mkt.reduce((a, r) => (r.date > a ? r.date : a), "");
  const since = latest ? new Date(Date.parse(latest) - 183 * 864e5).toISOString().slice(0, 10) : "";
  const spreads = mkt.filter((r) => r.date >= since && SPREAD_SET.some((s) => s.ticker === r.ticker));
  return (
    <div className="space-y-4">
      <PageHead title="신용" sub="회사채 시장 분위기 · 추적 종목의 빚 감당 체력(장부) · 주가가 말하는 부도 가능성(시장)" />
      <ImpliedSpread rows={spreads} />
      <CreditSection rows={rows} cos={cos.map((c) => ({ ticker: c.ticker, name: c.name_ko ?? c.name, grp: c.grp }))} ust={ust} finra={finra} mkt={weekly} />
    </div>
  );
}
