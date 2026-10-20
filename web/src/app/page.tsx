import Link from "next/link";
import { EventRow } from "@/components/EconCalendar";
import { LastUpdated } from "@/components/LastUpdated";
import { PlantMini } from "@/components/PlantMini";
import { HsName, T } from "@/components/Names";
import { Spark } from "@/components/Spark";
import { Badge, Card, Defs, MoreLink, PageHead, Stat } from "@/components/ui";
import { combined } from "@/lib/ailabs";
import { baseEffect, dday, estRange, estReported, estTier, money, pct, TIER_STYLE, tone, usd, watchFlag } from "@/lib/format";
import { aiArr, econEvents, earningsBasis, earningsDates, latestEstimates, unestimated, reportedQuarters, TECH_CHAPTERS, meta, priceSnapshots, surge, tagIndex } from "@/lib/queries";
import { busyOf, plantData } from "@/lib/plants";
import { stockSignals, type Signal } from "@/lib/signals";

// 게시 직후 바로 보이도록 요청마다 렌더 (ISR 캐시가 게시 후에도 이전 데이터로 남던 문제). DB가 작아 부담 없음
export const dynamic = "force-dynamic";

const UPCOMING_DAYS = 21;
const UPCOMING_MAX = 8;

function FlowRow({ s }: { s: Signal }) {
  return (
    <Link href={`/stocks/${encodeURIComponent(s.c.ticker)}`} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-panel2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{s.c.name_ko ?? s.c.name} <span className="text-xs font-normal text-muted">{s.c.ticker}</span></div>
        <div className="truncate text-xs text-muted">{s.flowLabel}</div>
      </div>
      <span className="hidden sm:block"><Spark values={s.spark} /></span>
      <div className={`w-16 shrink-0 text-right font-mono text-sm font-bold ${tone(s.yoy3m)}`} title={baseEffect(s.yoy3m)}>{pct(s.yoy3m, 0)}{baseEffect(s.yoy3m) && <sup>*</sup>}</div>
    </Link>
  );
}

export default async function Home() {
  const [sig, prices, top, related, builtAt, estRows, earn, done, skips, basis, pl, events, labArr] = await Promise.all([
    stockSignals(), priceSnapshots(), surge("us_imp_world", "yoy3m", 5, TECH_CHAPTERS), tagIndex(), meta("built_at"), latestEstimates(), earningsDates(), reportedQuarters(), unestimated(), earningsBasis(), plantData(), econEvents(), aiArr(),
  ]);
  const names = Object.fromEntries(sig.map((s) => [s.c.ticker, s.c.name_ko ?? s.c.name]));

  // 실적 임박: 3주 안에 발표하는 추적 종목 — 우리 추정 vs 컨센서스
  const soon = Object.entries(earn).map(([t, d]) => ({ t, d, n: dday(d)! })).filter((x) => x.n >= 0 && x.n <= UPCOMING_DAYS).sort((a, b) => a.n - b.n);

  // 공급망 모멘텀: 회사 고유 흐름만 (업황 지표로 대신 보는 종목은 같은 흐름을 공유해 순위가 의미 없음 → 아래 한 줄로 묶음)
  const own = sig.filter((s) => s.yoy3m != null && !s.proxy).sort((a, b) => b.yoy3m! - a.yoy3m!);
  const up = own.slice(0, 5), down = own.slice(-5).reverse().filter((s) => !up.includes(s));
  const proxies = Object.values(sig.filter((s) => s.proxy && s.yoy3m != null).reduce<Record<string, { label: string; y: number; who: string[] }>>((a, s) => {
    const k = s.flowLabel ?? "";
    (a[k] ??= { label: k, y: s.yoy3m!, who: [] }).who.push(s.c.name_ko ?? s.c.name);
    return a;
  }, {})).sort((a, b) => b.who.length - a.who.length);

  // 이번 주 일정: 오늘(한국)부터 7일
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const weekEnd = new Date(Date.parse(today) + 6 * 864e5).toISOString().slice(0, 10);
  const week = events.filter((e) => e.date >= today && e.date <= weekEnd);

  // 업황 한눈에
  const gpu = ["H100 SXM", "H200", "B200"].map((g) => {
    const rows = prices.filter((r) => r.kind === "gpu" && r.item === g && r.stat === "median");
    const last = rows.at(-1), ago = rows.find((r) => last && r.date >= new Date(Date.parse(last.date) - 30 * 864e5).toISOString().slice(0, 10));
    return last ? { g, v: last.value, m: ago && ago !== last ? last.value / ago.value - 1 : null } : null;
  }).filter((r) => r != null);
  const comb = combined(labArr), cm = Object.keys(comb).sort(), arrNow = cm.length ? comb[cm.at(-1)!] : null;
  const arrYr = cm.length > 12 ? comb[cm.at(-13)!] : null;

  // 공장 — 연결된 흐름의 최근 3개월 전년비로 바쁜/한산한 곳 (같은 흐름을 공유하는 공장이 많아 회사별 한 곳만)
  const plantRows = pl.list.map((p) => ({ p, y: busyOf(p, pl.stats) }));
  const points = plantRows.map(({ p, y }) => ({ id: p.id, lon: p.lon, lat: p.lat, name: `${p.company} ${p.site}`, sub: `${p.product ?? p.category}${y == null ? "" : ` · 흐름 ${pct(y)}`}`, yoy: y, q: p.ticker ?? p.company }));
  const byCo = (rows: typeof plantRows) => rows.filter((r, i) => rows.findIndex((x) => x.p.company === r.p.company) === i);
  const flowed = plantRows.filter((r) => r.y != null).sort((a, b) => b.y! - a.y!);
  const busy = byCo(flowed).slice(0, 3), quiet = byCo([...flowed].reverse()).slice(0, 3);

  return (
    <div className="space-y-5">
      <PageHead
        title={<T ko="오늘의 브리핑" en="Today's briefing" />}
        sub={<>AI·반도체 공급망 — 세관 무역 흐름 · 실적 추정 · 업황 · <LastUpdated builtAt={builtAt} /></>}
        info={<p>미국·일본·한국 세관 무역 데이터로 추적 종목의 공장 출하·고객향 물량을 매달 따라가고, 그 흐름과 회사 가이던스로 진행 중인 분기 매출을 추정합니다. 데이터는 매일 아침 갱신됩니다. 자세한 방법은 <Link className="text-accent" href="/about">소개·방법론</Link>.</p>}
      />

      <Card title={<T ko="실적 임박" en="Earnings ahead" />} sub={`${UPCOMING_DAYS}일 안에 발표 · 우리 추정 vs 애널리스트 컨센서스`} right={<MoreLink href="/earnings">실적 추정 전체</MoreLink>}
        info={<Defs items={[["추정", "세관 무역 흐름·회사 가이던스로 낸 진행 분기 매출"], ["컨센 대비", "추정 ÷ 컨센서스 − 1 (컨센 금액은 약관상 비공개). 회색이면 오차범위 안이라 의미 있는 차이로 보기 어려움"], ["신뢰·보통·참고", "과거 분기 백테스트에서 추정이 실제 ±5% 안에 든 비율로 매긴 등급"], ["~", "회사가 아직 일정을 안 내 작년 같은 분기 기준으로 추정한 날짜"]]} />}>
        {soon.length === 0 ? <p className="text-sm text-muted">{UPCOMING_DAYS}일 안에 실적을 발표하는 추적 종목이 없습니다.</p> : (
          <div className="grid lg:grid-cols-2 lg:gap-x-8">
            {soon.slice(0, UPCOMING_MAX).map(({ t, d, n }) => {
              const e = estRows.find((x) => x.ticker === t), sk = skips.find((x) => x.ticker === t);
              const rep = e ? estReported(e, done[t]) : false, tr = e ? (rep ? "발표됨" : estTier(e)) : "추정불가";
              const r = e ? estRange(e) : null, inRange = e?.cons_gap != null && r != null && Math.abs(e.cons_gap) < r;
              return (
                <Link key={t} href={`/stocks/${encodeURIComponent(t)}#earnings`} className="flex items-center gap-3 border-b border-line/60 py-2 hover:bg-panel2/50">
                  <div className="w-14 shrink-0 text-center">
                    <div className="font-mono text-sm font-bold">D-{n}</div>
                    <div className="font-mono text-[11px] text-muted">{basis[t] ? "~" : ""}{d.slice(5).replace("-", "/")}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-bold">{names[t] ?? t}
                      {e && watchFlag(e, d, done[t]) && <Badge tone="accent">주목</Badge>}</div>
                    <div className="truncate text-xs text-muted">
                      {e && tr !== "보류" ? <>추정 {money(e.est, e.currency)} · 직전 대비 <span className={tone(e.est / e.last_actual - 1)}>{pct(e.est / e.last_actual - 1)}</span></>
                        : tr === "보류" ? "추정 보류 — 컨센서스와 차이가 커 외삽 가능성" : sk ? "추정불가 — 매출과 연동된 흐름·이력 부족" : "추정 없음"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`font-mono text-sm font-bold ${e?.cons_gap == null || inRange || tr === "보류" ? "text-muted" : tone(e.cons_gap)}`}>{e?.cons_gap == null || tr === "보류" ? "-" : pct(e.cons_gap)}</div>
                    <span className={`rounded px-1.5 text-[11px] ${TIER_STYLE[tr] ?? TIER_STYLE["참고"]}`}>{tr}</span>
                  </div>
                </Link>
              );
            })}
            {soon.length > UPCOMING_MAX && <Link href="/earnings?f=soon" className="block pt-2 text-xs text-muted hover:text-accent lg:col-span-2">+{soon.length - UPCOMING_MAX}개 더 — 실적 발표 순으로 보기 →</Link>}
          </div>
        )}
      </Card>

      <Card title={<T ko="공급망 모멘텀" en="Supply-chain momentum" />} sub="회사별 출하 흐름의 최근 3개월 전년비" right={<MoreLink href="/stocks?view=trend">흐름 순위 전체</MoreLink>}
        info={<p>종목마다 매출과 직접 연결된 무역 흐름(공장 지역 수출·고객향 수입)을 합산해 최근 3개월을 1년 전과 비교합니다. 업계 전체 지표로만 볼 수 있는 종목(예: 대만산 AI 서버 수입을 같이 보는 클라우드 기업들)은 숫자가 같아 순위에서 빼고 아래에 묶었습니다. *는 전년 금액이 작아 생긴 기저효과일 수 있다는 표시.</p>}>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          <div><div className="mb-1 text-xs font-bold text-up">강해진 흐름</div>{up.map((s) => <FlowRow key={s.c.ticker} s={s} />)}</div>
          <div><div className="mb-1 text-xs font-bold text-down">약해진 흐름</div>{down.map((s) => <FlowRow key={s.c.ticker} s={s} />)}</div>
        </div>
        {proxies.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-line/60 pt-3 text-xs text-muted">
            {proxies.slice(0, 3).map((p) => (
              <div key={p.label} className="flex flex-wrap items-baseline gap-x-2"><span>업황 지표 · {p.label}</span><b className={`font-mono ${tone(p.y)}`}>{pct(p.y, 0)}</b><span className="truncate">→ {p.who.join("·")}</span></div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={<T ko="이번 주 일정" en="This week" />} sub="한국 시간" right={<MoreLink href="/calendar">달력</MoreLink>}>
          {week.length === 0 ? <p className="text-sm text-muted">이번 주 일정이 없습니다.</p> : (
            <div>
              {week.slice(0, 8).map((e, i) => <EventRow key={i} e={e} showDate />)}
              {week.length > 8 && <Link href="/calendar" className="mt-1 block px-1 text-xs text-muted hover:text-fg">+{week.length - 8}건 더 보기</Link>}
            </div>
          )}
        </Card>

        <Card title={<T ko="업황 한눈에" en="Industry at a glance" />} sub="AI 수요 쪽 가격·규모" right={<MoreLink href="/prices">업황 지표</MoreLink>}>
          <div className="grid grid-cols-2 gap-2">
            {gpu.map((r) => <Stat key={r.g} href="/prices#ai" label={`${r.g} 렌탈`} value={<>${r.v.toFixed(2)}<span className="text-xs font-normal text-muted">/h</span></>} sub={r.m == null ? "Vast.ai 중앙값" : <>1달 <span className={tone(r.m)}>{pct(r.m)}</span></>} />)}
            {arrNow != null && <Stat href="/prices#ai" label="AI 랩 연환산 매출" value={`$${arrNow.toFixed(0)}B`} sub={<>OpenAI+Anthropic{arrYr ? <> · 1년 <span className="text-up">{pct(arrNow / arrYr - 1, 0)}</span></> : null}</>} />}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={<T ko="급등 품목" en="Surging items" />} sub="미국 수입 · 최근 3개월 전년비 · 전자·기계·화학 등" right={<MoreLink href="/surge?f=tech">무역 탐색</MoreLink>}>
          <div className="space-y-1.5 text-sm">
            {top.map((r) => (
              <div key={`${r.hs6}${r.partner}`} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate"><HsName ko={r.name_ko} en={r.name_en} hs={r.hs6} />
                  {related(r.hs6).slice(0, 2).map((t) => <Link key={t} href={`/stocks/${encodeURIComponent(t)}`} className="ml-1 rounded bg-accent/20 px-1.5 text-xs text-accent">{names[t] ?? t}</Link>)}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">{usd(r.value_usd)} <b className={tone(r.yoy3m)}>{pct(r.yoy3m, 0)}</b></span>
              </div>
            ))}
          </div>
        </Card>

        {pl.list.length > 0 && (
          <Card title={<T ko="공장 가동 신호" en="Plant activity" />} sub={`${pl.list.length}곳 · 그 공장 출하를 보는 흐름의 3개월 전년비`} right={<MoreLink href="/plants">공장 지도</MoreLink>}>
            <PlantMini points={points} />
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              {([["바쁜 곳", busy, "text-up"], ["한산한 곳", quiet, "text-down"]] as const).map(([t, rows, c]) => (
                <div key={t} className="min-w-0">
                  <div className={`mb-1 text-xs font-bold ${c}`}>{t}</div>
                  {rows.map(({ p, y }) => (
                    <Link key={p.id} href={`/plants?q=${encodeURIComponent(p.ticker ?? p.company)}`} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-panel2">
                      <span className="min-w-0 truncate">{p.company}</span>
                      <span className={`shrink-0 font-mono text-xs ${tone(y)}`}>{pct(y, 0)}</span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
