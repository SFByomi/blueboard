import type { Metadata } from "next";
import { CreditSection } from "@/components/CreditSection";
import { companies, creditMetrics, finraMarket, marketCredit, ustCurve } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "신용", description: "AI·반도체 기업의 빚 감당 체력(장부)과 주가 내재 부도확률, 회사채 시장·미 국채 곡선" };

export default async function CreditPage() {
  const [rows, cos, ust, finra, mkt] = await Promise.all([creditMetrics(), companies(), ustCurve(), finraMarket(), marketCredit()]);
  // 주가 내재 부도확률은 일별 → 주 1회(금요일 근처)로 줄여 전송
  const weekly = mkt.filter((r, i) => i === mkt.length - 1 || mkt[i + 1]?.ticker !== r.ticker || new Date(r.date).getDay() === 5);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">신용</h1>
        <p className="mt-1 text-sm text-muted">회사채 시장 분위기 · 추적 종목의 빚 감당 체력(장부) · 주가가 말하는 부도 가능성(시장)</p>
      </div>
      <CreditSection rows={rows} cos={cos.map((c) => ({ ticker: c.ticker, name: c.name_ko ?? c.name, grp: c.grp }))} ust={ust} finra={finra} mkt={weekly} />
    </div>
  );
}
