import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditSection } from "@/components/CreditSection";
import { companies, creditMetrics, finraMarket, ustCurve } from "@/lib/queries";
import { isOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "신용", robots: { index: false, follow: false } };

/** 본인 전용 — 쿠키(/owner?key=...)가 없으면 존재하지 않는 페이지처럼 404 */
export default async function CreditPage() {
  if (!(await isOwner())) notFound();
  const [rows, cos, ust, finra] = await Promise.all([creditMetrics(), companies(), ustCurve(), finraMarket()]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">신용 <span className="text-base font-normal text-muted">🔒 나만 보기</span></h1>
        <p className="mt-1 text-sm text-muted">회사채 시장 분위기 + 추적 종목의 빚 감당 체력 (장부 기준). 이 페이지는 등록한 기기에서만 보입니다.</p>
      </div>
      <CreditSection rows={rows} cos={cos.map((c) => ({ ticker: c.ticker, name: c.name_ko ?? c.name, grp: c.grp }))} ust={ust} finra={finra} />
    </div>
  );
}
