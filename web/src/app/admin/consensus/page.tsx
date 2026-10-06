import Link from "next/link";
import { estReliable, money, pct, tone } from "@/lib/format";
import { companies, latestConsensus, latestEstimates } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** 컨센서스 원 금액 — 로컬 전용(야후 약관상 재게시 금지, Supabase에 게시하지 않음). 공개 사이트엔 괴리율만 */
export default async function ConsensusAdmin() {
  const [cons, ests, cos] = await Promise.all([latestConsensus(), latestEstimates(), companies()]);
  const bySec = Object.fromEntries(cos.filter((c) => c.sec_ticker).map((c) => [c.sec_ticker!, c]));
  const estOf = Object.fromEntries(ests.map((e) => [e.ticker, e]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">컨센서스 vs 무역 추정 <span className="text-sm font-normal text-muted">개인용 · 게시 안 함</span></h1>
        <Link href="/admin" className="btn-ghost">관리로</Link>
      </div>
      <p className="text-sm text-muted">출처: Yahoo Finance earningsTrend (매출 컨센서스 평균·범위·애널리스트 수). 약관상 재게시 금지라 로컬에서만 봅니다. 수집일 {cons[0]?.date ?? "-"}</p>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] whitespace-nowrap text-sm">
          <thead className="text-xs text-muted"><tr className="border-b border-line text-right">
            <th className="py-2 text-left">종목</th><th className="text-left">구간</th><th className="text-left">분기 말</th>
            <th>컨센 평균</th><th>범위</th><th>애널리스트</th><th>무역 추정</th><th>괴리</th>
          </tr></thead>
          <tbody className="font-mono">
            {cons.map((c) => {
              const co = bySec[c.ticker];
              const e = co ? estOf[co.ticker] : undefined;
              const match = e && e.cons_end === c.end_date;
              return (
                <tr key={`${c.ticker}${c.period}`} className="border-b border-line/50 text-right">
                  <td className="py-2 text-left font-sans">{co ? <Link className="hover:text-accent" href={`/stocks/${encodeURIComponent(co.ticker)}`}>{co.name_ko ?? co.name}</Link> : c.ticker}</td>
                  <td className="text-left text-xs text-muted">{c.period === "0q" ? "이번 분기" : "다음 분기"}</td>
                  <td className="text-left text-xs">{c.end_date}</td>
                  <td>{money(c.avg)}</td>
                  <td className="text-xs text-muted">{c.low ? `${money(c.low)} ~ ${money(c.high)}` : "-"}</td>
                  <td>{c.n ?? "-"}</td>
                  <td className={match && !estReliable(e) ? "opacity-60" : ""}>{match ? money(e.est) : ""}</td>
                  <td className={match ? tone(e.cons_gap) : ""}>{match ? pct(e.cons_gap) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
