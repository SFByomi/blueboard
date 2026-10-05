import Link from "next/link";
import { notFound } from "next/navigation";
import { Spark } from "@/components/Spark";
import { StockView, type FlowData, type QuarterRow } from "@/components/StockView";
import { corr, quarterize, sumSeries, toMonthly } from "@/lib/compute";
import { money, pct, tone, usd } from "@/lib/format";
import { alertsFor, company, financials, mappingsFor, observations, surgeForTicker } from "@/lib/queries";

export const dynamic = "force-dynamic";

const qYoY = (a: (number | null)[]) => a.map((v, i) => (i >= 4 && v != null && a[i - 4] ? v / a[i - 4]! - 1 : null));

export default async function StockPage({ params }: PageProps<"/stocks/[ticker]">) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw);
  const c = company(ticker);
  if (!c) notFound();

  const maps = mappingsFor(ticker);
  const ids = maps.map((m) => m.series_id);
  const m = toMonthly(observations(ids), ids);
  const fin = financials(ticker).filter((f) => f.period_end >= "2021-01-01");
  const revYoY = qYoY(fin.map((f) => f.revenue));

  const alerts = alertsFor(ids);
  const flows: FlowData[] = maps.map((mp) => {
    const qv = quarterize(m.months, m.value[mp.series_id], fin).map((q) => q.value);
    const ty = qYoY(qv);
    return {
      id: mp.series_id, label: mp.label, reporter: mp.reporter, flow: mp.flow, region: mp.region, hs: mp.hs,
      partner: mp.partner, role: mp.role, confidence: mp.confidence, rationale: mp.rationale, caveat: mp.caveat,
      include: !!mp.include_in_total, unit: mp.unit, lastMonth: mp.last_month,
      values: m.value[mp.series_id], qty: m.qty[mp.series_id],
      alerts: alerts.filter((a) => a.series_id === mp.series_id).map(({ month, kind, detail }) => ({ month, kind, detail })),
      corrYoY: fin.length ? corr(revYoY, ty) : null,
      corrLead: fin.length ? corr(revYoY, [null, ...ty.slice(0, -1)]) : null,
    };
  });

  const incIds = flows.filter((f) => f.include).map((f) => f.id);
  const total = sumSeries(m, incIds);
  const tq = quarterize(m.months, total, fin);
  const quarters: QuarterRow[] = fin.map((f, i) => ({ end: f.period_end, revenue: f.revenue, revYoY: revYoY[i], trade: tq[i].value }));

  // 다음(진행 중) 분기: 마지막 실적 이후 3개월, 반영된 무역월 수
  const lastEnd = fin.at(-1)?.period_end;
  const nextQ = lastEnd ? (() => {
    const s = new Date(lastEnd); s.setDate(s.getDate() + 1);
    const e = new Date(s); e.setMonth(e.getMonth() + 3); e.setDate(e.getDate() - 1);
    const q = quarterize(m.months, total, [{ period_start: s.toISOString().slice(0, 10), period_end: e.toISOString().slice(0, 10) }])[0];
    return { start: s.toISOString().slice(0, 7), end: e.toISOString().slice(0, 7), months: q.months };
  })() : null;

  const related = surgeForTicker(ticker).slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{c.name_ko ?? c.name}</h1>
          <div className="mt-1 text-sm text-muted">{c.ticker} · {c.market} · {c.sector} · {c.fy_note}</div>
        </div>
        <Link href={`/admin/stocks/${encodeURIComponent(c.ticker)}`} className="btn-ghost">매핑 편집</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`최근 분기 매출${fin.at(-1)?.basis ? ` · ${fin.at(-1)!.basis}` : ""}`} value={fin.length ? money(fin.at(-1)!.revenue, fin.at(-1)!.currency) : "-"} sub={fin.at(-1)?.period_end} />
        <Kpi label="매출 YoY" value={pct(revYoY.at(-1))} cls={tone(revYoY.at(-1))} />
        <Kpi label="진행 중 분기 무역 반영" value={nextQ ? `${nextQ.months} / 3개월` : "-"} sub={nextQ ? `${nextQ.start} ~ ${nextQ.end}` : "실적 데이터 없음"} />
        <Kpi label="추적 흐름" value={`${flows.length}개`} sub={`매출 합산 대상 ${incIds.length}개`} />
      </div>

      {c.thesis && <div className="card text-sm leading-relaxed text-muted"><b className="text-fg">투자 포인트 · 매핑 메모</b><br />{c.thesis}</div>}

      {flows.length ? <StockView flows={flows} months={m.months} quarters={quarters} currency={fin.at(-1)?.currency ?? "USD"} /> : (
        <div className="card text-sm text-muted">연결된 무역 흐름이 없습니다. <Link className="text-accent" href={`/admin/stocks/${encodeURIComponent(c.ticker)}`}>관리 페이지</Link>에서 추가하세요.</div>
      )}

      {related.length > 0 && (
        <div className="card">
          <h2 className="font-bold">관련 품목 급등 현황</h2>
          <p className="mb-3 text-xs text-muted">이 종목에 연결된 HS 코드의 미국 무역 흐름 (3개월 YoY 순)</p>
          <div className="grid gap-2 md:grid-cols-2">
            {related.map((r) => (
              <div key={`${r.scope}${r.hs6}${r.partner}`} className="flex items-center justify-between gap-3 rounded-lg bg-panel2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{r.name_ko ?? r.name_en} · {r.scope === "us_exp_world" ? "수출" : "수입"}{r.partner !== "-" ? ` · ${r.partner_name}` : " · 전체"}</div>
                  <div className="font-mono text-xs text-muted">{r.hs6} · {usd(r.value_usd)} · {r.month}</div>
                </div>
                <Spark values={JSON.parse(r.spark)} w={80} />
                <span className={`font-mono ${tone(r.yoy3m)}`}>{pct(r.yoy3m)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-xl border-l-4 border-accent bg-panel2 px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
