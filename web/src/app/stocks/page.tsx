import { T } from "@/components/Names";
import Link from "next/link";
import { GradeBadge } from "@/components/FlowScores";
import { Spark } from "@/components/Spark";
import { baseEffect, GROUPS, pct, tone } from "@/lib/format";
import { flowScores } from "@/lib/queries";
import { stockSignals } from "@/lib/signals";
import { TrendCard } from "@/components/TrendCard";

// 게시 직후 바로 보이도록 요청마다 렌더 (ISR 캐시가 게시 후에도 이전 데이터로 남던 문제). DB가 작아 부담 없음
export const dynamic = "force-dynamic";

export default async function Stocks({ searchParams }: PageProps<"/stocks">) {
  const sp = await searchParams;
  const view = sp.view === "trend" ? "trend" : "sector", sort = sp.sort === "1m" ? "1m" : "3m";
  const [sig, scores] = await Promise.all([stockSignals(), flowScores()]);
  const best = (t: string) => scores.filter((x) => x.ticker === t && x.best != null).sort((a, b) => b.best! - a.best!)[0];
  const tab = (on: boolean) => `rounded-lg px-3 py-1 ${on ? "bg-accent/20 font-bold text-accent" : "text-muted hover:text-fg"}`;
  const key = (s: (typeof sig)[number]) => (sort === "1m" ? s.last.yoy : s.yoy3m);
  const ranked = sig.filter((s) => key(s) != null).sort((a, b) => key(b)! - key(a)!);
  const topGrade = (t: string) => scores.filter((x) => x.ticker === t && x.grade).map((x) => x.grade!).sort()[0] ?? null;
  const groups = [...GROUPS, ...new Set(sig.map((s) => s.c.grp ?? "기타"))].filter((g, i, a) => a.indexOf(g) === i);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold"><T ko="종목" en="Stocks" /></h1>
        <p className="mt-1 text-sm text-muted">{view === "trend" ? "매핑한 무역 흐름(매출 합산 대상)의 전년비 순위 · r = 매출 전년비와의 상관(가장 잘 맞는 흐름) · 흐름 분해 = 최근 월 비중과 전년비" : "섹터별 · 숫자는 주요 출하 흐름의 최근 3개월 전년비 (업황 = 회사 흐름이 없어 업계 지표로 대신) · 연관도 = 매출과 가장 잘 맞는 흐름의 등급"}</p>
        <div className="mt-2 flex flex-wrap gap-1 text-sm">
          <Link href="/stocks" className={tab(view === "sector")}>섹터별</Link>
          <Link href="/stocks?view=trend" className={tab(view === "trend" && sort === "3m")}>매핑 트렌드 · 3개월</Link>
          <Link href="/stocks?view=trend&sort=1m" className={tab(view === "trend" && sort === "1m")}>매핑 트렌드 · 최근 월</Link>
        </div>
      </div>
      {view === "trend" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ranked.map((s, i) => <TrendCard key={s.c.ticker} s={s} rank={i + 1} score={best(s.c.ticker)} />)}
          </div>
          <p className="text-xs text-muted">순위 기준: {sort === "1m" ? "최근 월 전년비 (월별 변동이 큼)" : "최근 3개월 합 전년비"}. 전년 금액이 작아 ±200%를 넘는 값은 기저효과일 수 있어 *로 표시. 무역 흐름이 없는 종목(바이오 등)은 빠집니다.</p>
        </>
      )}
      {view === "sector" && groups.map((g) => {
        const items = sig.filter((s) => (s.c.grp ?? "기타") === g);
        if (!items.length) return null;
        return (
          <section key={g} className="space-y-3">
            <h2 className="border-b border-line pb-1 text-lg font-bold">{g} <span className="text-sm font-normal text-muted">{items.length}</span></h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((s) => (
                <Link key={s.c.ticker} href={`/stocks/${encodeURIComponent(s.c.ticker)}`} className="card block min-w-0 transition hover:border-accent">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-bold">{s.c.name_ko ?? s.c.name}</div>
                      <div className="truncate text-xs text-muted">{s.c.ticker} · {s.c.market} · {s.c.sector}</div>
                    </div>
                    {s.yoy3m != null && (
                      <div className="shrink-0 text-right">
                        <div className={`font-mono text-lg font-bold ${tone(s.yoy3m)}`} title={baseEffect(s.yoy3m)}>{pct(s.yoy3m)}{baseEffect(s.yoy3m) && <sup>*</sup>}</div>
                        <div className="text-xs text-muted">{s.month} 3M</div>
                      </div>
                    )}
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-muted">{s.c.thesis}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted">
                      {s.flows ? `${s.proxy ? "업황 · " : ""}흐름 ${s.flows}개` : "매핑 없음"}{s.revYoY != null ? ` · 매출 YoY ${pct(s.revYoY)}` : ""}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {topGrade(s.c.ticker) && <span className="text-xs text-muted" title="매핑된 흐름 중 매출과 가장 잘 맞는 등급">연관도 <GradeBadge grade={topGrade(s.c.ticker)} /></span>}
                      {s.flows > 0 && <Spark values={s.spark} />}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
