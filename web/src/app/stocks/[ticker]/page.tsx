import Link from "next/link";
import { notFound } from "next/navigation";
import { AiLinkCard } from "@/components/AiLinkCard";
import { CreditMini } from "@/components/CreditMini";
import { EstimateCard, xcheckVerdict } from "@/components/EstimateCard";
import { FlowScores, GradeBadge } from "@/components/FlowScores";
import { IndexSection } from "@/components/IndexSection";
import { CtyName, HsName } from "@/components/Names";
import { OiCard } from "@/components/OiCard";
import { PeerSection } from "@/components/PeerSection";
import { SectionNav } from "@/components/SectionNav";
import { Spark } from "@/components/Spark";
import { StockView, type FlowData, type QuarterRow } from "@/components/StockView";
import { Badge, Card, CardHead, Defs, Fold, Stat } from "@/components/ui";
import { ValuationCard } from "@/components/ValuationCard";
import { quarterize, sumSeries, toMonthly } from "@/lib/compute";
import { risk, RISK_STYLE } from "@/lib/credit";
import { ADMIN_ENABLED } from "@/lib/db";
import { yoy3m } from "@/lib/estimate";
import { INDEX_FOR_GROUP, dday, estGuide, estRange, estReported, estTier, money, parseSites, pct, TIER_STYLE, tone, usd } from "@/lib/format";
import { aiArr, aiDeals, alertsFor, company, creditFor, earningsBasis, earningsDates, estimateDate, estimateHistory, financials, flowScores, indicators, mappingsFor, marketCreditLast, multipleHist, multipleNow, observations, oiEstimate, peerRevenue, priceSnapshots, reportedQuarters, surgeForTicker, unestimated, valuations } from "@/lib/queries";
import { valuationBrief } from "@/lib/valuation";

// 게시 직후 바로 보이도록 요청마다 렌더 (ISR 캐시가 게시 후에도 이전 데이터로 남던 문제). DB가 작아 부담 없음
export const dynamic = "force-dynamic";

const NEOCLOUD = new Set(["IREN", "NBIS", "CRWV"]); // GPU 렌탈가가 핵심 업황인 종목
const NEO_GPUS = ["H100 SXM", "H200", "B200"];

/** 분기 전년비 — 1년 전 분기(330~400일 전)와만 짝지음 (분기가 빠진 회사에서 엉뚱한 분기와 비교하지 않게) */
const qYoY = (a: (number | null)[], ends: string[]) => a.map((v, i) => {
  if (i < 4 || v == null || !a[i - 4]) return null;
  const gap = (Date.parse(ends[i]) - Date.parse(ends[i - 4])) / 864e5;
  return gap >= 330 && gap <= 400 ? v / a[i - 4]! - 1 : null;
});

export async function generateMetadata({ params }: PageProps<"/stocks/[ticker]">) {
  const c = await company(decodeURIComponent((await params).ticker));
  return c ? { title: `${c.name_ko ?? c.name} (${c.ticker})` } : {};
}

export default async function StockPage({ params }: PageProps<"/stocks/[ticker]">) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw);
  const c = await company(ticker);
  if (!c) notFound();

  const maps = await mappingsFor(ticker);
  const ids = maps.map((m) => m.series_id);
  const [obs, allFin, alerts, relatedAll, scores, estAll, estDate, earn, done, skips, basis, oi, mNow, mHist, credit, mkt] = await Promise.all([
    observations(ids), financials(ticker), alertsFor(ids), surgeForTicker(ticker), flowScores(ticker), estimateHistory(ticker), estimateDate(), earningsDates(), reportedQuarters(), unestimated(), earningsBasis(), oiEstimate(ticker),
    multipleNow(ticker), multipleHist(ticker), creditFor(ticker), marketCreditLast(ticker)]);
  // 최신 빌드에서 추정이 빠진 종목(예: 백테스트 분기 부족으로 탈락)은 옛 추정을 보여주지 않음
  const estHist = estAll.at(-1)?.date === estDate ? estAll : [];
  const nextEarn = earn[ticker] ?? null, lastReported = done[ticker] ?? null;
  const idxGroups = INDEX_FOR_GROUP[c.grp ?? ""] ?? [];
  const hasPeers = ticker === "000150.KS";  // 대만 CCL 피어·지주사 할인 (etl/peers.py)
  const [prices, defs, peerRev, vals, labArr, deals] = await Promise.all([
    NEOCLOUD.has(ticker) || idxGroups.length ? priceSnapshots() : Promise.resolve([]),
    idxGroups.length ? indicators() : Promise.resolve([]),
    hasPeers ? peerRevenue() : Promise.resolve([]),
    hasPeers ? valuations() : Promise.resolve([]),
    NEOCLOUD.has(ticker) ? aiArr() : Promise.resolve([]),
    NEOCLOUD.has(ticker) ? aiDeals(ticker) : Promise.resolve([]),
  ]);
  const gpuLatest = (NEOCLOUD.has(ticker) ? NEO_GPUS : []).map((g) => prices.filter((r) => r.kind === "gpu" && r.item === g && r.stat === "median").at(-1)).filter((r) => r != null);
  // 네비우스는 자기 클러스터 스팟가를 직접 공시 (etl/prices.nebius_spot)
  const nebLatest = (ticker === "NBIS" ? ["H200", "B200", "B300"] : []).map((g) => prices.filter((r) => r.kind === "nebius" && r.item === g && r.stat === "avg").at(-1)).filter((r) => r != null);
  const m = toMonthly(obs, ids);
  const fin = allFin.filter((f) => f.period_end >= "2021-01-01");
  const revYoY = qYoY(fin.map((f) => f.revenue), fin.map((f) => f.period_end));

  const flows: FlowData[] = maps.map((mp) => {
    const sc = scores.find((s) => s.series_id === mp.series_id);
    return {
      id: mp.series_id, label: mp.label, reporter: mp.reporter, flow: mp.flow, region: mp.region, hs: mp.hs,
      partner: mp.partner, role: mp.role, confidence: mp.confidence, rationale: mp.rationale, caveat: mp.caveat,
      include: !!mp.include_in_total, unit: mp.unit, lastMonth: mp.last_month,
      values: m.value[mp.series_id], qty: m.qty[mp.series_id],
      alerts: alerts.filter((a) => a.series_id === mp.series_id).map(({ month, kind, detail }) => ({ month, kind, detail })),
      grade: sc?.grade ?? null, best: sc?.best ?? null, bestLag: sc?.best_lag ?? null, nYoy: sc?.n_yoy ?? null, recent: sc?.recent ?? null,
    };
  });

  const incIds = flows.filter((f) => f.include).map((f) => f.id);
  const total = sumSeries(m, incIds);
  const est = estHist.at(-1);
  const sites = parseSites(c.sites);
  const tq = quarterize(m.months, total, fin);
  const quarters: QuarterRow[] = fin.map((f, i) => ({ end: f.period_end, revenue: f.revenue, revYoY: revYoY[i], trade: tq[i].value }));
  const last = fin.at(-1);

  // ── 요약: 핵심 흐름 · 밸류 · 신용 · 핵심 포인트
  const order = { A: 0, B: 1, C: 2, D: 3 } as Record<string, number>;
  const core = [...flows].filter((f) => f.grade === "A" || f.grade === "B").sort((a, b) => order[a.grade!] - order[b.grade!] || (b.best ?? 0) - (a.best ?? 0))[0]
    ?? flows.find((f) => f.include) ?? flows[0];
  const core3 = core ? yoy3m(core.values).value : null;
  const vb = valuationBrief(mNow);
  const cr = credit.at(-1), [crLvl, crWhy] = cr ? risk(cr) : [null, []];
  const rep = est ? estReported(est, lastReported) : false;
  const tier = est ? (rep ? "발표됨" : estTier(est)) : null;
  const skip = skips.find((s) => s.ticker === ticker);
  const g = est ? estGuide(est) : null;
  const points: React.ReactNode[] = [];
  if (est && !rep && tier !== "보류") {
    if (g && !g.prelim) {
      const mid = (g.low + g.high) / 2;
      points.push(<>회사 가이던스 {money(g.low, est.currency)}~{money(g.high, est.currency)} — 우리 추정은 중간값보다 <b className={tone(est.est / mid - 1)}>{pct(est.est / mid - 1)}</b>{g.why?.n && g.why.min != null && g.why.min > 0 ? ` (과거 ${g.why.n}분기 모두 가이던스 상회)` : ""}</>);
    }
    if (est.cons_gap != null) {
      const r = estRange(est), inR = r != null && Math.abs(est.cons_gap) < r;
      points.push(<>애널리스트 컨센서스보다 <b className={inR ? "" : tone(est.cons_gap)}>{pct(est.cons_gap)}</b>{inR ? " — 오차범위 안이라 큰 의미는 없음" : ` — 오차범위(±${((r ?? 0) * 100).toFixed(0)}%) 밖`}</>);
    }
    if (g?.xcheck?.length && !g.prelim) points.push(<>무역 교차 확인: {g.xcheck[0].label} 진행 분기 <b className={tone(g.xcheck[0].qoq)}>{pct(g.xcheck[0].qoq)}</b> — {xcheckVerdict(g.xcheck, (g.low + g.high) / 2 / est.last_actual - 1, est.est / est.last_actual - 1)}</>);
  }
  if (core && core3 != null && (core.grade === "A" || core.grade === "B")) points.push(<>{core.label} 최근 3개월 <b className={tone(core3)}>{pct(core3, 0)}</b> (매출 연관도 {core.grade})</>);
  if (crLvl && crLvl !== "양호") points.push(<>신용 <b className={crLvl === "주의" ? "text-down" : "text-amber-300"}>{crLvl}</b> — {crWhy.join(" · ")}</>);

  const hasIndustry = gpuLatest.length > 0 || deals.length > 0 || hasPeers || (idxGroups.length > 0 && defs.length > 0);
  const nav = [
    { id: "earnings", label: "실적 추정" },
    { id: "valuation", label: "밸류에이션" },
    { id: "supply", label: "공급망 흐름" },
    ...(credit.length ? [{ id: "credit", label: "신용" }] : []),
    ...(hasIndustry ? [{ id: "industry", label: "업황" }] : []),
  ];
  const related = relatedAll.slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">{c.name_ko ?? c.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>{c.ticker} · {c.market} · {c.grp ?? c.sector}</span>
            {c.fy_note && <span className="text-xs">· {c.fy_note}</span>}
            {nextEarn && <Badge tone="accent" title={basis[ticker]}>실적 {basis[ticker] ? "~" : ""}{nextEarn.slice(5).replace("-", "/")} D-{dday(nextEarn)}</Badge>}
          </div>
        </div>
        {ADMIN_ENABLED && <Link href={`/admin/stocks/${encodeURIComponent(c.ticker)}`} className="btn-ghost">매핑 편집</Link>}
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {est ? (
            <Stat href="#earnings" label={<>{rep ? "발표된 분기 추정" : "진행 분기 매출 추정"} <span className={`rounded px-1 text-[10px] ${TIER_STYLE[tier!] ?? ""}`}>{tier}</span></>}
              value={money(est.est, est.currency)} tone={tier === "보류" ? "text-muted" : ""}
              sub={<>직전 대비 <span className={tone(est.est / est.last_actual - 1)}>{pct(est.est / est.last_actual - 1)}</span>{est.cons_gap != null && tier !== "보류" ? <> · 컨센 <span className={tone(est.cons_gap)}>{pct(est.cons_gap)}</span></> : null}</>} />
          ) : (
            <Stat href="#earnings" label="진행 분기 매출 추정" value="추정불가" tone="text-muted" sub={skip ? "매출과 연동된 흐름·이력 부족" : "추정 없음"} />
          )}
          <Stat label={`최근 분기 매출${last?.basis ? ` · ${last.basis}` : ""}`} value={last ? money(last.revenue, last.currency) : "-"}
            sub={<>전년비 <span className={tone(revYoY.at(-1))}>{pct(revYoY.at(-1), 0)}</span>{last ? ` · ${last.period_end.slice(0, 7)}` : ""}</>} />
          <Stat href="#supply" label={<span className="flex items-center gap-1">핵심 흐름 {core && <GradeBadge grade={core.grade} />}</span>} value={core3 == null ? "-" : pct(core3, 0)} tone={tone(core3)}
            sub={core ? <span className="line-clamp-1">{core.label} · 3개월 전년비</span> : "연결된 흐름 없음"} />
          {vb ? <Stat href="#valuation" label="밸류에이션" value={vb.value} tone={vb.tone} sub={<span className="line-clamp-2">{vb.sub}</span>} />
            : <Stat href="#valuation" label="밸류에이션" value="-" tone="text-muted" sub={<span className="line-clamp-2">{mNow?.reason ?? "계산 전"}</span>} />}
        </div>
        {points.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm leading-relaxed">
            {points.slice(0, 4).map((p, i) => <li key={i} className="flex gap-2"><span className="text-accent">•</span><span className="min-w-0">{p}</span></li>)}
          </ul>
        )}
        {crLvl === "양호" && <div className="mt-2 text-xs text-muted">신용 <a href="#credit" className={`rounded px-1.5 ${RISK_STYLE[crLvl]}`}>{crLvl}</a></div>}
        {(c.thesis || sites.length > 0) && (
          <Fold summary="투자 포인트 · 생산거점" className="mt-3 border-t border-line/60 pt-3">
            {c.thesis && <p className="text-sm leading-relaxed text-[#c9cde3]">{c.thesis}</p>}
            {sites.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {sites.map((st) => <span key={st.name} className="rounded-lg bg-panel2 px-2.5 py-1 text-xs"><b>{st.name}</b> <span className="text-muted">{st.country} · {st.what}</span></span>)}
                <Link href={`/plants?q=${encodeURIComponent(ticker)}`} className="self-center text-xs text-accent">공장 지도 →</Link>
              </div>
            )}
          </Fold>
        )}
      </Card>

      <SectionNav items={nav} />

      <section id="earnings" className="scroll-mt-28 space-y-4">
        <EstimateCard skip={skip} hist={estHist} nextEarn={nextEarn} lastReported={lastReported} labels={Object.fromEntries(maps.map((mp) => [mp.series_id, mp.label]))} />
        <OiCard o={oi && oi.date >= (estDate ?? "") ? oi : null} />
      </section>

      <section id="valuation" className="scroll-mt-28">
        <Card title="밸류에이션" sub="추정 실적 × 이 회사가 과거 3년 동안 받은 배수"
          info={<Defs items={[
            ["배수", "기업가치(시가총액 + 순부채) ÷ 분기 실적 × 4. 흑자·이익률 10% 이상이면 EV/영업이익(PER과 비슷), 적자·저마진·메모리(경기순환)는 EV/매출(PSR과 비슷)"],
            ["밴드", "최근 12분기(3년) 각 분기 말의 배수 — 하위 25%·중앙·상위 25%"],
            ["시나리오", "약세 = 하위 25% 배수 × 추정 하단, 기준 = 중앙 배수 × 추정, 강세 = 상위 25% 배수 × 추정 상단 → 순부채를 빼고 주식 수로 나눔"],
            ["생략", "배수 변동이 크거나, 최근 1년 배수가 3년과 30% 넘게 다르거나(재평가 진행), 지금 배수가 3년 범위 밖이면 과거 배수 적용이 왜곡이라 이유만 표시"],
            ["주가", "야후 가격은 재게시 금지라 현재 주가·시가총액은 저장·표시하지 않고 비율(현재 대비 %)과 우리 계산값만"],
          ]} />}>
          {mNow ? <ValuationCard m={mNow} hist={mHist} /> : <p className="text-sm text-muted">밸류에이션 계산 전입니다 (다음 데이터 갱신 때 생김).</p>}
        </Card>
      </section>

      <section id="supply" className="scroll-mt-28">
        <Card title="공급망 흐름" sub="부품 조달 → 생산거점 출하 → 고객향 반입 · 숫자는 최근 3개월 전년비">
          {flows.length ? <StockView flows={flows} months={m.months} quarters={quarters} currency={last?.currency ?? "USD"} initial={Math.max(0, flows.indexOf(core))} /> : (
            <p className="text-sm text-muted">연결된 무역 흐름이 없습니다.{ADMIN_ENABLED && <> <Link className="text-accent" href={`/admin/stocks/${encodeURIComponent(c.ticker)}`}>관리 페이지</Link>에서 추가하세요.</>}</p>
          )}
          {scores.length > 0 && (
            <Fold summary="매출 연관도 표 — 흐름별 전년비 상관·표본" className="mt-4 border-t border-line/60 pt-3">
              <FlowScores rows={scores.flatMap((sc) => {
                const mp = maps.find((x) => x.series_id === sc.series_id);
                return mp ? [{ ...sc, label: mp.label, role: mp.role }] : [];
              })} />
            </Fold>
          )}
          {related.length > 0 && (
            <Fold summary={`관련 품목 급등 — 이 종목 HS 코드의 미국 무역 (${related.length}건)`} className="mt-3 border-t border-line/60 pt-3">
              <div className="space-y-3">
                {[...new Set(related.map(surgeKey))].map((k) => {  // 같은 품목·방향끼리 묶어 품목명은 한 번만, 전체 국가가 맨 앞
                  const rows = related.filter((r) => surgeKey(r) === k).sort((a, b) => Number(b.partner === "-") - Number(a.partner === "-")), r0 = rows[0];
                  return (
                    <div key={k}>
                      <h3 className="mb-1 text-sm font-bold"><HsName ko={r0.name_ko} en={r0.name_en} hs={r0.hs6} /> <span className="font-mono text-xs font-normal text-muted">HS {r0.hs6} · 미국 {r0.scope === "us_exp_world" ? "수출" : "수입"}</span></h3>
                      <div className="grid gap-1.5 md:grid-cols-2">
                        {rows.map((r) => (
                          <div key={`${r.scope}${r.hs6}${r.partner}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-panel2 px-3 py-1.5 text-sm">
                            <div className="min-w-0 flex-1"><div className="truncate">{r.partner !== "-" ? <CtyName name={r.partner_name} /> : "전체 국가"}</div>
                              <div className="font-mono text-xs text-muted">{usd(r.value_usd)} · {r.month}</div></div>
                            <span className="hidden shrink-0 sm:block"><Spark values={JSON.parse(r.spark)} w={72} /></span>
                            <span className={`shrink-0 font-mono ${tone(r.yoy3m)}`}>{pct(r.yoy3m, 0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Fold>
          )}
        </Card>
      </section>

      {credit.length > 0 && (
        <section id="credit" className="scroll-mt-28">
          <Card title="신용" sub="빚 감당 체력(장부) · 주가가 말하는 부도 가능성" right={<Link href="/credit" className="text-xs text-muted hover:text-accent">신용 탭 →</Link>}
            info={<p>판정은 신용 탭과 같은 규칙: 순부채/EBITDA 2.5배·4배, 이자보상 5배·2배, FCF 적자와 1년 내 만기 대비 현금. 순현금 회사는 현금이 FCF 적자를 몇 년 버티는지로 봅니다. 주가 내재 부도확률은 주가 변동성과 장부 부채로 계산한 머튼 모형 근사(5년 누적).</p>}>
            <CreditMini rows={credit} mkt={mkt} />
          </Card>
        </section>
      )}

      {hasIndustry && (
        <section id="industry" className="scroll-mt-28 space-y-4">
          {gpuLatest.length > 0 && (
            <Card title="GPU 렌탈가" sub={`${gpuLatest[0].date} · Vast.ai 온디맨드 중앙값`} right={<Link href="/prices#ai" className="text-xs text-muted hover:text-accent">업황 →</Link>}>
              <div className="grid grid-cols-3 gap-2">
                {gpuLatest.map((r) => <Stat key={r.item} label={r.item} value={<>${r.value.toFixed(2)}<span className="text-xs font-normal text-muted">/h</span></>} />)}
              </div>
              {nebLatest.length > 0 && (<>
                <div className="mt-3 mb-1.5 text-xs text-muted">Nebius 자체 스팟가 (선점형, 지역 평균) · {nebLatest[0].date}</div>
                <div className="grid grid-cols-3 gap-2">
                  {nebLatest.map((r) => <Stat key={r.item} label={r.item} value={<>${r.value.toFixed(2)}<span className="text-xs font-normal text-muted">/h</span></>} />)}
                </div>
              </>)}
            </Card>
          )}
          {deals.length > 0 && <AiLinkCard name={c.name_ko ?? c.name} deals={deals} arr={labArr} rev={fin.map((f) => ({ end: f.period_end, revenue: f.revenue }))} />}
          {hasPeers && (peerRev.length > 0 || vals.length > 0) && (
            <PeerSection rev={peerRev} val={vals} own={fin.flatMap((f, i) => (revYoY[i] == null ? [] : [{ month: f.period_end.slice(0, 7), yoy: revYoY[i]! }]))} />
          )}
          {idxGroups.length > 0 && defs.length > 0 && (
            <div className="card">
              <CardHead title="관련 가격지수" sub="생산자물가·수출입 가격 (BLS) · 2021.01 = 100" />
              <Fold summary={`${idxGroups.join(" · ")} 지수 ${defs.filter((d) => idxGroups.includes(d.grp)).length}개 보기`}>
                <div className="grid gap-4 xl:grid-cols-2">
                  {idxGroups.map((gr) => <IndexSection key={gr} grp={gr} defs={defs.filter((d) => d.grp === gr)} rows={prices.filter((r) => r.kind === "index")} compact bare />)}
                </div>
              </Fold>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const surgeKey = (r: { scope: string; hs6: string }) => `${r.scope === "us_exp_world" ? "exp" : "imp"}|${r.hs6}`;
