import Link from "next/link";
import { HsName, T } from "@/components/Names";
import { Spark } from "@/components/Spark";
import { baseEffect, confNote, dday, estRange, estReported, estTier, money, pct, TIER_STYLE, tone, usd, watchFlag } from "@/lib/format";
import { earningsDates, latestEstimates, reportedQuarters, TECH_CHAPTERS, meta, priceSnapshots, surge, tagIndex } from "@/lib/queries";
import { stockSignals, type Signal } from "@/lib/signals";

// 게시 직후 바로 보이도록 요청마다 렌더 (ISR 캐시가 게시 후에도 이전 데이터로 남던 문제). DB가 작아 부담 없음
export const dynamic = "force-dynamic";

function Row({ s }: { s: Signal }) {
  return (
    <Link href={`/stocks/${encodeURIComponent(s.c.ticker)}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-panel2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{s.c.name_ko ?? s.c.name} <span className="text-xs font-normal text-muted">{s.c.ticker}</span></div>
        <div className="truncate text-xs text-muted">{s.proxy ? "업황 · " : ""}{s.flowLabel} · {s.month}</div>
      </div>
      <Spark values={s.spark} />
      <div className={`w-20 text-right font-mono font-bold ${tone(s.yoy3m)}`} title={baseEffect(s.yoy3m)}>{pct(s.yoy3m)}{baseEffect(s.yoy3m) && <sup>*</sup>}</div>
    </Link>
  );
}

export default async function Home() {
  const [sig, prices, top, related, builtAt, estRows, earn, done] = await Promise.all([
    stockSignals(), priceSnapshots(), surge("us_imp_world", "yoy3m", 6, TECH_CHAPTERS), tagIndex(), meta("built_at"), latestEstimates(), earningsDates(), reportedQuarters(),
  ]);
  const ranked = sig.filter((s) => s.yoy3m != null).sort((a, b) => b.yoy3m! - a.yoy3m!);
  const half = Math.ceil(ranked.length / 2); // 상위 절반 / 하위 절반 (겹치지 않게) — 하위도 플러스일 수 있어 '둔화'가 아니라 상대 순위
  const up = ranked.slice(0, Math.min(half, 6)), down = ranked.slice(half).reverse().slice(0, 6);
  const names = Object.fromEntries(sig.map((s) => [s.c.ticker, s.c.name_ko ?? s.c.name]));
  // 신뢰 추정 먼저, 그 안에서 컨센 괴리 큰 순
  const RANK: Record<string, number> = { 신뢰: 0, 보통: 1, 참고: 2 };
  const live = (e: (typeof estRows)[number]) => !estReported(e, done[e.ticker]); // 이미 발표된 분기는 맨 아래
  const ests = [...estRows].sort((a, b) => Number(live(b)) - Number(live(a)) || RANK[estTier(a)] - RANK[estTier(b)] || (b.conf ?? 0) - (a.conf ?? 0) || Math.abs(b.cons_gap ?? 0) - Math.abs(a.cons_gap ?? 0));
  const gpu = ["H100 SXM", "H200", "B200"].map((g) => prices.filter((r) => r.kind === "gpu" && r.item === g && r.stat === "median").at(-1)).filter((r) => r != null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold"><T ko="공급망 신호" en="Supply chain signals" /></h1>
        <p className="mt-1 text-sm text-muted">AI·반도체 공급망 출하 흐름 · 최근 3개월 전년비 · 마지막 갱신 {builtAt?.replace("T", " ") ?? "-"}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card min-w-0">
          <h2 className="mb-1 font-bold text-up"><T ko="모멘텀 상위" en="Top momentum" /> <span className="text-xs font-normal text-muted">최근 3개월 전년비 높은 순</span></h2>
          {up.map((s) => <Row key={s.c.ticker} s={s} />)}
        </section>
        <section className="card min-w-0">
          <h2 className="mb-1 font-bold text-down"><T ko="모멘텀 하위" en="Bottom momentum" /> <span className="text-xs font-normal text-muted">추적 종목 중 상대적으로 낮은 순</span></h2>
          {down.map((s) => <Row key={s.c.ticker} s={s} />)}
        </section>
      </div>

      {ests.length > 0 && (
        <section className="card min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold"><T ko="진행 분기 매출 추정 · 컨센서스 괴리" en="Current-quarter revenue estimate vs consensus" /></h2>
            <span className="text-xs text-muted">신뢰도 = 과거 분기에 실제 매출이 추정 ±5% 안에 들어온 비율</span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] whitespace-nowrap text-sm">
              <thead className="text-xs text-muted"><tr className="border-b border-line">
                <th className="py-2 text-left"><T ko="종목" en="Stock" /></th><th className="text-left"><T ko="분기" en="Quarter" /></th><th className="text-right"><T ko="추정 매출" en="Estimate" /></th>
                <th className="text-right"><T ko="직전 분기 대비" en="QoQ" /></th><th className="text-right"><T ko="컨센 대비" en="vs consensus" /></th><th className="text-right"><T ko="오차범위" en="Error range" /></th><th className="text-right"><T ko="신뢰도" en="Reliability" /></th><th className="text-right"><T ko="실적 발표" en="Earnings" /></th>
              </tr></thead>
              <tbody className="font-mono">
                {ests.map((e) => {
                  const rep = estReported(e, done[e.ticker]);
                  const tr = rep ? "발표됨" : estTier(e), ok = tr === "신뢰", r = estRange(e), nx = earn[e.ticker], d = dday(nx);
                  const inRange = e.cons_gap != null && r != null && Math.abs(e.cons_gap) < r;
                  return (
                    <tr key={e.ticker} className={`border-b border-line/50 ${tr === "참고" || rep ? "text-xs opacity-60" : ""}`}>
                      <td className="py-2 font-sans"><Link className="font-bold hover:text-accent" href={`/stocks/${encodeURIComponent(e.ticker)}`}>{names[e.ticker] ?? e.ticker}</Link>
                        {rep && <span className="ml-1 rounded bg-panel2 px-1.5 text-xs text-muted" title="이 분기 실적은 이미 발표됨 — SEC 공시가 반영되면 다음 분기 추정으로 넘어감">발표됨</span>}
                        {watchFlag(e, nx, done[e.ticker]) && <span className="ml-1 rounded bg-accent/20 px-1.5 text-xs text-accent">주목</span>}</td>
                      <td className="text-xs text-muted">{e.q_start.slice(0, 7)}~{e.q_end.slice(0, 7)}</td>
                      <td className={`text-right ${ok ? "font-bold" : ""}`}>{money(e.est, e.currency)}</td>
                      <td className={`text-right ${tone(e.est / e.last_actual - 1)}`}>{pct(e.est / e.last_actual - 1)}</td>
                      <td className={`text-right ${ok ? "font-bold" : ""} ${e.cons_gap == null || inRange ? "text-muted" : tone(e.cons_gap)}`} title={inRange ? "괴리가 오차범위 안 — 의미 있는 차이로 보기 어려움" : undefined}>{e.cons_gap == null ? "-" : pct(e.cons_gap)}</td>
                      <td className="text-right text-xs text-muted">{r == null ? "-" : `±${(r * 100).toFixed(0)}%`}</td>
                      <td className="text-right text-xs" title={confNote(e)}><span className={`mr-1 rounded px-1.5 py-0.5 font-sans ${TIER_STYLE[tr]}`}>{tr}</span>{e.conf == null ? "-" : `${(e.conf * 100).toFixed(0)}%`}</td>
                      <td className="text-right text-xs text-muted">{nx ? `${nx.slice(5)} D-${d}` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">컨센 대비 = 무역 기반 추정 ÷ 애널리스트 컨센서스 − 1 (컨센 금액은 제공처 약관상 비공개). 신뢰도 = 최근 8~12분기 백테스트(그 분기 이전 데이터로만 예측)에서 실제 매출이 추정 ±5% 안에 들어온 비율(표본이 적으면 깎음). 오차범위 = 같은 백테스트 오차의 80% 범위. 신뢰 = 신뢰도 70% 이상이면서 단순 추세보다 정확·근거 R² 0.4 이상·외삽·단절 없음, 보통 = 50% 이상(단순 추세보다 정확할 때), 참고 = 그 미만. 참고 행은 흐리게, 오차범위 안의 괴리는 회색. 발표됨 = 실적은 나왔지만 SEC 공시 반영 전이라 아직 다음 분기로 넘어가지 않은 추정(맨 아래). 주목 = 신뢰 추정이면서 괴리 10% 이상(오차범위 밖)·실적 발표 30일 이내. 한국 종목은 부문 매출이라 컨센 비교 없음.</p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Link href="/prices" className="card block min-w-0 transition hover:border-accent">
          <div className="flex items-baseline justify-between"><h2 className="font-bold"><T ko="가격·지수" en="Prices & indices" /></h2><span className="text-xs text-muted">전체 보기 →</span></div>
          <div className="mt-3 grid grid-cols-3 gap-3 font-mono">
            {gpu.map((r) => <div key={r.item}><div className="text-xs text-muted">{r.item}</div><div className="text-lg font-bold">${r.value.toFixed(2)}<span className="text-xs font-normal text-muted">/h</span></div></div>)}
          </div>
          <p className="mt-2 text-xs text-muted">GPU 렌탈가 · 토큰 가격 · 서버·스토리지 가격지수</p>
        </Link>
        <section className="card min-w-0">
          <div className="flex items-baseline justify-between"><h2 className="font-bold"><T ko="급등 품목" en="Surging items" /> <span className="text-xs font-normal text-muted">전자·기계·화학 등 관심 분야</span></h2><Link href="/surge?f=tech" className="text-xs text-muted hover:text-fg">전체 보기 →</Link></div>
          <div className="mt-2 space-y-1 text-sm">
            {top.map((r) => (
              <div key={`${r.hs6}${r.partner}`} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate"><HsName ko={r.name_ko} en={r.name_en} hs={r.hs6} /> <span className="font-mono text-xs text-muted">{r.hs6}</span>
                  {related(r.hs6).map((t) => <Link key={t} href={`/stocks/${encodeURIComponent(t)}`} className="ml-1 rounded bg-accent/20 px-1.5 text-xs text-accent">{t}</Link>)}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">{usd(r.value_usd)} <span className={tone(r.yoy3m)}>{pct(r.yoy3m)}</span></span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
