import Link from "next/link";
import { GradeBadge } from "@/components/FlowScores";
import { Spark } from "@/components/Spark";
import { GROUPS, pct, tone } from "@/lib/format";
import { flowScores } from "@/lib/queries";
import { stockSignals } from "@/lib/signals";

export const revalidate = 3600; // 데이터는 하루 1회 갱신 — 1시간 캐시

export default async function Stocks() {
  const [sig, scores] = await Promise.all([stockSignals(), flowScores()]);
  const topGrade = (t: string) => scores.filter((x) => x.ticker === t && x.grade).map((x) => x.grade!).sort()[0] ?? null;
  const groups = [...GROUPS, ...new Set(sig.map((s) => s.c.grp ?? "기타"))].filter((g, i, a) => a.indexOf(g) === i);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">종목</h1>
        <p className="mt-1 text-sm text-muted">섹터별 · 숫자는 주요 출하 흐름의 최근 3개월 전년비 (업황 = 회사 흐름이 없어 업계 지표로 대신) · 연관도 = 매출과 가장 잘 맞는 흐름의 등급</p>
      </div>
      {groups.map((g) => {
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
                        <div className={`font-mono text-lg font-bold ${tone(s.yoy3m)}`}>{pct(s.yoy3m)}</div>
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
