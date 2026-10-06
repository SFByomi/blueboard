import Link from "next/link";
import { notFound } from "next/navigation";
import { Spark } from "@/components/Spark";
import { StockView, type FlowData, type QuarterRow } from "@/components/StockView";
import { corr, quarterize, sumSeries, toMonthly } from "@/lib/compute";
import { EstimateCard } from "@/components/EstimateCard";
import { FlowScores } from "@/components/FlowScores";
import { CtyName, HsName } from "@/components/Names";
import { IndexSection } from "@/components/IndexSection";
import { INDEX_FOR_GROUP, money, parseSites, pct, tone, usd } from "@/lib/format";
import { ADMIN_ENABLED } from "@/lib/db";
import { alertsFor, company, estimateHistory, financials, flowScores, indicators, mappingsFor, observations, priceSnapshots, surgeForTicker } from "@/lib/queries";

// 게시 직후 바로 보이도록 요청마다 렌더 (ISR 캐시가 게시 후에도 이전 데이터로 남던 문제). DB가 작아 부담 없음
export const dynamic = "force-dynamic";

const NEOCLOUD = new Set(["IREN", "NBIS"]); // GPU 렌탈가가 핵심 업황인 종목
const NEO_GPUS = ["H100 SXM", "H200", "B200"];

const qYoY = (a: (number | null)[]) => a.map((v, i) => (i >= 4 && v != null && a[i - 4] ? v / a[i - 4]! - 1 : null));

export default async function StockPage({ params }: PageProps<"/stocks/[ticker]">) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw);
  const c = await company(ticker);
  if (!c) notFound();

  const maps = await mappingsFor(ticker);
  const ids = maps.map((m) => m.series_id);
  const [obs, allFin, alerts, relatedAll, scores, estHist] = await Promise.all([observations(ids), financials(ticker), alertsFor(ids), surgeForTicker(ticker), flowScores(ticker), estimateHistory(ticker)]);
  const related = relatedAll.slice(0, 8);
  const idxGroups = INDEX_FOR_GROUP[c.grp ?? ""] ?? [];
  const [prices, defs] = await Promise.all([
    NEOCLOUD.has(ticker) || idxGroups.length ? priceSnapshots() : Promise.resolve([]),
    idxGroups.length ? indicators() : Promise.resolve([]),
  ]);
  const gpuLatest = (NEOCLOUD.has(ticker) ? NEO_GPUS : []).map((g) => prices.filter((r) => r.kind === "gpu" && r.item === g && r.stat === "median").at(-1)).filter((r) => r != null);
  const m = toMonthly(obs, ids);
  const fin = allFin.filter((f) => f.period_end >= "2021-01-01");
  const revYoY = qYoY(fin.map((f) => f.revenue));

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
  const est = estHist.at(-1);
  const sites = parseSites(c.sites);
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


  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{c.name_ko ?? c.name}</h1>
          <div className="mt-1 text-sm text-muted">{c.ticker} · {c.market} · {c.sector} · {c.fy_note}</div>
        </div>
        {ADMIN_ENABLED && <Link href={`/admin/stocks/${encodeURIComponent(c.ticker)}`} className="btn-ghost">매핑 편집</Link>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`최근 분기 매출${fin.at(-1)?.basis ? ` · ${fin.at(-1)!.basis}` : ""}`} value={fin.length ? money(fin.at(-1)!.revenue, fin.at(-1)!.currency) : "-"} sub={fin.at(-1)?.period_end} />
        <Kpi label="매출 YoY" value={pct(revYoY.at(-1))} cls={tone(revYoY.at(-1))} />
        {est ? (
          <Kpi label={`진행 분기 매출 추정 (${est.q_start.slice(0, 7)}~${est.q_end.slice(0, 7)})`} value={money(est.est, est.currency)}
            sub={`직전 대비 ${pct(est.est / est.last_actual - 1)}${est.cons_gap != null ? ` · 컨센 대비 ${pct(est.cons_gap)}` : ""} · 백테스트 오차 ${pct(est.mape, 1).replace("+", "")}`} />
        ) : (
          <Kpi label="진행 중 분기 무역 반영" value={nextQ ? `${nextQ.months} / 3개월` : "-"} sub={nextQ ? `${nextQ.start} ~ ${nextQ.end} · 추정은 매출 연관도 A·B 흐름이 있을 때만` : "실적 데이터 없음"} />
        )}
        <Kpi label="추적 흐름" value={`${flows.length}개`} sub={`매출 합산 대상 ${incIds.length}개`} />
      </div>

      {sites.length > 0 && (
        <div className="card">
          <b>생산거점</b>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {sites.map((st) => (
              <div key={st.name} className="rounded-lg bg-panel2 px-3 py-2 text-sm">
                <div className="font-bold">{st.name}</div>
                <div className="text-xs text-muted">{st.country} · {st.what}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {c.thesis && <div className="card text-sm leading-relaxed text-muted"><b className="text-fg">투자 포인트 · 매핑 메모</b><br />{c.thesis}</div>}

      {gpuLatest.length > 0 && (
        <Link href="/prices" className="card block transition hover:border-accent">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <b>GPU 렌탈가 (업황)</b>
            <span className="text-xs text-muted">{gpuLatest[0].date} · Vast.ai 온디맨드 중앙값 · 전체 보기 →</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3 font-mono">
            {gpuLatest.map((r) => <div key={r.item}><div className="text-xs text-muted">{r.item}</div><div className="text-lg font-bold">${r.value.toFixed(2)}<span className="text-xs font-normal text-muted">/h</span></div></div>)}
          </div>
        </Link>
      )}

      {flows.length ? <StockView flows={flows} months={m.months} quarters={quarters} currency={fin.at(-1)?.currency ?? "USD"} /> : (
        <div className="card text-sm text-muted">연결된 무역 흐름이 없습니다.{ADMIN_ENABLED && <> <Link className="text-accent" href={`/admin/stocks/${encodeURIComponent(c.ticker)}`}>관리 페이지</Link>에서 추가하세요.</>}</div>
      )}

      <EstimateCard hist={estHist} labels={Object.fromEntries(maps.map((mp) => [mp.series_id, mp.label]))} />

      <FlowScores rows={scores.flatMap((sc) => {
        const mp = maps.find((x) => x.series_id === sc.series_id);
        return mp ? [{ ...sc, label: mp.label, role: mp.role }] : [];
      })} />

      {idxGroups.length > 0 && defs.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {idxGroups.map((g) => <IndexSection key={g} grp={`관련 가격지수 · ${g}`} defs={defs.filter((d) => d.grp === g)} rows={prices.filter((r) => r.kind === "index")} compact />)}
        </div>
      )}

      {related.length > 0 && (
        <div className="card">
          <h2 className="font-bold">관련 품목 급등 현황</h2>
          <p className="mb-3 text-xs text-muted">이 종목에 연결된 HS 코드의 미국 무역 흐름 (3개월 YoY 순)</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {related.map((r) => (
              <div key={`${r.scope}${r.hs6}${r.partner}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-panel2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate"><HsName ko={r.name_ko} en={r.name_en} hs={r.hs6} /> · {r.scope === "us_exp_world" ? "수출" : "수입"} · {r.partner !== "-" ? <CtyName name={r.partner_name} /> : "전체"}</div>
                  <div className="font-mono text-xs text-muted">{r.hs6} · {usd(r.value_usd)} · {r.month}</div>
                </div>
                <span className="hidden shrink-0 sm:block"><Spark values={JSON.parse(r.spark)} w={80} /></span>
                <span className={`shrink-0 font-mono ${tone(r.yoy3m)}`}>{pct(r.yoy3m)}</span>
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
