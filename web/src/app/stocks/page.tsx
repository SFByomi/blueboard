import Link from "next/link";
import { Spark } from "@/components/Spark";
import { sumSeries, toMonthly, yoy } from "@/lib/compute";
import { pct, tone } from "@/lib/format";
import { allMappings, companies, observations } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function Stocks() {
  const list = companies();
  const maps = allMappings();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">종목</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((c) => {
          const ms = maps.filter((m) => m.ticker === c.ticker);
          const inc = ms.filter((m) => m.include_in_total).map((m) => m.series_id);
          const ids = inc.length ? inc : ms.slice(0, 1).map((m) => m.series_id);
          const m = toMonthly(observations(ids), ids);
          const total = sumSeries(m, ids);
          const y = yoy(total);
          const lastI = total.findLastIndex((v) => v != null);
          return (
            <Link key={c.ticker} href={`/stocks/${encodeURIComponent(c.ticker)}`} className="card block transition hover:border-accent">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-bold">{c.name_ko ?? c.name}</div>
                  <div className="text-xs text-muted">{c.ticker} · {c.market} · {c.sector}</div>
                </div>
                {lastI >= 0 && (
                  <div className="text-right">
                    <div className={`font-mono text-lg font-bold ${tone(y[lastI])}`}>{pct(y[lastI])}</div>
                    <div className="text-xs text-muted">{m.months[lastI]} YoY</div>
                  </div>
                )}
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-muted">{c.thesis}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted">추적 흐름 {ms.length}개{inc.length ? "" : ms.length ? " · 업황 프록시" : " · 매핑 없음"}</span>
                <Spark values={total.slice(-24).map((v) => v ?? 0)} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
