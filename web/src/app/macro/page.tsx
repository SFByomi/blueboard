import type { Metadata } from "next";
import Link from "next/link";
import { InflationSection } from "@/components/InflationSection";
import { MacroSection } from "@/components/MacroSection";
import { T } from "@/components/Names";
import { SectionNav } from "@/components/SectionNav";
import { PageHead, SectionHead } from "@/components/ui";
import { inflationContrib, macroObs } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "매크로", description: "미국 물가(CPI·PCE) 구성요소 기여도와 연준 대차대조표·TGA·역레포·순유동성·M2·연방부채" };

export default async function MacroPage() {
  const [infl, macro] = await Promise.all([inflationContrib(), macroObs()]);
  return (
    <div className="space-y-6">
      <PageHead title={<T ko="매크로" en="Macro" />} sub="미국 물가 기여도 · 거시 유동성 (FRED·BLS·BEA, 월·주별)"
        info={<p>주가 배수(밸류에이션)를 움직이는 금리·유동성 쪽 지표. 회사채 시장·미 국채 곡선은 <Link className="text-accent" href="/credit">신용</Link> 탭, 발표 일정은 <Link className="text-accent" href="/calendar">일정</Link> 탭에 있습니다.</p>} />
      <SectionNav items={[{ id: "inflation", label: "물가 기여도" }, { id: "liquidity", label: "유동성" }]} />
      <section id="inflation" className="scroll-mt-28 space-y-3">
        <SectionHead title={<T ko="미국 물가 기여도" en="US inflation contributions" />} sub="CPI·PCE를 서비스·공산품·식품·에너지 기여도로" right={<Link href="/calendar" className="hover:text-fg">발표 일정 →</Link>} />
        {infl.length > 0 ? <InflationSection rows={infl} /> : <div className="card text-sm text-muted">수집 전입니다.</div>}
      </section>
      <section id="liquidity" className="scroll-mt-28 space-y-3">
        <SectionHead title={<T ko="거시 유동성" en="Macro liquidity" />} sub="연준 대차대조표·TGA·역레포·M2·연방부채" right={<Link href="/calendar" className="hover:text-fg">FOMC 일정 →</Link>} />
        {macro.length > 0 ? <MacroSection rows={macro} /> : <div className="card text-sm text-muted">수집 전입니다.</div>}
      </section>
    </div>
  );
}
