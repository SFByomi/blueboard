import type { Metadata } from "next";
import Link from "next/link";
import { CheckChart } from "@/components/CheckChart";
import { InfoTip } from "@/components/InfoTip";
import { T } from "@/components/Names";
import { Fold, PageHead } from "@/components/ui";
import { check10y, checkBigtech, checkBreadth, checkCore, checkLiquidity, type CheckItem, type Status } from "@/lib/check";
import { bigtechCash, dgs10, inflationContrib, macroObs, relStrength } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "시장 점검", description: "10년물 금리·근원물가·유동성·AI 투자 기업의 현금흐름·중소형주 상대 강세 — 다섯 가지 조건을 공개 데이터와 고정 규칙으로 점검" };

const TONE: Record<Status, { badge: string; dot: string; text: string }> = {
  good: { badge: "bg-emerald-950 text-emerald-300", dot: "bg-emerald-400", text: "text-emerald-300" },
  neutral: { badge: "bg-panel2 text-muted", dot: "bg-[#8a90ad]", text: "text-muted" },
  bad: { badge: "bg-rose-950 text-rose-300", dot: "bg-rose-400", text: "text-rose-300" },
};
const usd = (v: number | null) => (v == null ? "-" : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(1)}B`);

export default async function CheckPage() {
  const [rates, infl, macro, big, rel] = await Promise.all([dgs10(), inflationContrib(), macroObs(), bigtechCash(), relStrength()]);
  const bigtech = checkBigtech(big);
  const items = [check10y(rates), checkCore(infl), checkLiquidity(macro), bigtech, checkBreadth(rel)].filter((x): x is CheckItem => x != null);
  const n = (s: Status) => items.filter((i) => i.status === s).length;
  return (
    <div className="space-y-5">
      <PageHead title={<T ko="시장 점검" en="Market check" />} sub="금리 · 물가 · 유동성 · AI 투자 기업의 현금흐름 · 시장 폭 — 다섯 가지 조건이 지금 어느 쪽인지"
        info={<p>각 조건을 공개 데이터와 미리 정한 규칙으로만 판정합니다(규칙은 카드의 ⓘ). 초록 = 위험자산에 우호적인 쪽, 빨강 = 부담되는 쪽, 회색 = 엇갈리거나 방향이 불분명. 시장 방향을 예측하는 것이 아니라 조건의 현재 상태를 보여주며, 투자 권유가 아닙니다.</p>} />
      {items.length === 0 ? <div className="card text-sm text-muted">수집 전입니다.</div> : (<>
        <div className="card">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="font-mono text-lg font-bold"><span className="text-emerald-300">{n("good")}</span><span className="text-muted"> · </span><span>{n("neutral")}</span><span className="text-muted"> · </span><span className="text-rose-300">{n("bad")}</span></span>
            <span className="text-muted">우호 {n("good")} · 중립 {n("neutral")} · 부담 {n("bad")} (총 {items.length}개)</span>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {items.map((it, i) => (
              <li key={it.id}>
                <a href={`#${it.id}`} className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-panel2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[it.status].dot}`} />
                  <span className="min-w-0 flex-1 truncate">{i + 1}. {it.title}</span>
                  <span className={`shrink-0 text-xs font-bold ${TONE[it.status].text}`}>{it.label}</span>
                  <span className="shrink-0 font-mono text-xs text-muted">{it.headline}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        {items.map((it, i) => (
          <section key={it.id} id={it.id} className="card min-w-0 scroll-mt-28 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-x-1.5 font-bold">{i + 1}. {it.title}<InfoTip>{it.rule}</InfoTip></h2>
                <p className="text-xs text-muted">{it.question} · {it.asof}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${TONE[it.status].badge}`}>{it.label}</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-mono text-2xl font-bold">{it.headline}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                {it.facts.map(([k, v], j) => <span key={j}>{k} <b className="font-mono text-fg">{v}</b></span>)}
              </span>
            </div>
            <CheckChart chart={it.chart} />
            {it.note && <p className="text-xs text-muted">{it.note}</p>}
            {it.id === "bigtech" && bigtech && (
              <Fold summary="회사별 최근 분기">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-xs">
                    <thead><tr className="text-muted"><th className="py-1 text-left font-normal">회사 (분기 말)</th><th className="text-right font-normal">영업이익</th><th className="text-right font-normal">영업현금흐름</th><th className="text-right font-normal">설비투자</th><th className="text-right font-normal">FCF</th></tr></thead>
                    <tbody className="font-mono">
                      {bigtech.table.map((r) => (
                        <tr key={r.name} className="border-t border-line"><td className="py-1 font-sans">{r.name} <span className="text-muted">{r.q}</span></td><td className="text-right">{usd(r.oi)}</td><td className="text-right">{usd(r.ocf)}</td><td className="text-right">{usd(r.capex)}</td><td className={`text-right ${r.fcf < 0 ? "text-down" : ""}`}>{usd(r.fcf)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Fold>
            )}
            <div className="text-right text-xs"><Link href={it.href} className="text-muted hover:text-accent">{it.hrefLabel} →</Link></div>
          </section>
        ))}
        <p className="text-xs leading-relaxed text-muted">판정은 고정 규칙에 따른 현재 상태 표시입니다 — 전망이나 매매 신호가 아니며, 투자 판단의 책임은 본인에게 있습니다. 출처: 미 재무부·BLS·BEA·연준(FRED), SEC EDGAR. 상대 강도는 ETF 수익률의 비율만 표시합니다.</p>
      </>)}
    </div>
  );
}
