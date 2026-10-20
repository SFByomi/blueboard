import type { Metadata } from "next";
import Link from "next/link";
import { T } from "@/components/Names";
import { Badge, Defs, Fold, PageHead } from "@/components/ui";
import { confNote, dday, estCaution, estRange, estReported, estTier, money, pct, TIER_STYLE, tone, watchFlag } from "@/lib/format";
import { companies, earningsBasis, earningsDates, latestEstimates, latestMultiples, reportedQuarters, unestimated, type RevEstimate } from "@/lib/queries";
import { parseScen, pxLabel } from "@/lib/valuation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "실적 추정", description: "진행 분기 매출 — 세관 무역 흐름·회사 가이던스 기반 추정과 애널리스트 컨센서스의 차이, 실적 발표 일정" };

const FILTERS = [
  { k: "all", label: "전체" },
  { k: "soon", label: "30일 안 발표" },
  { k: "good", label: "신뢰·보통만" },
  { k: "gap", label: "컨센 차이 큰 순" },
] as const;
const RANK: Record<string, number> = { 신뢰: 0, 보통: 1, 참고: 2, 추세: 2, 발표됨: 4, 보류: 5 };

export default async function EarningsPage({ searchParams }: PageProps<"/earnings">) {
  const sp = await searchParams;
  const f = (FILTERS.find((x) => x.k === sp.f)?.k ?? "all") as (typeof FILTERS)[number]["k"];
  const [rows, earn, done, skips, basis, cos, mults] = await Promise.all([latestEstimates(), earningsDates(), reportedQuarters(), unestimated(), earningsBasis(), companies(), latestMultiples()]);
  const names = Object.fromEntries(cos.map((c) => [c.ticker, c.name_ko ?? c.name]));
  const mBy = Object.fromEntries(mults.map((m) => [m.ticker, m]));
  const tierOf = (e: RevEstimate) => (estReported(e, done[e.ticker]) ? "발표됨" : estTier(e));
  let list = [...rows].sort((a, b) => RANK[tierOf(a)] - RANK[tierOf(b)] || (b.conf ?? 0) - (a.conf ?? 0) || Math.abs(b.cons_gap ?? 0) - Math.abs(a.cons_gap ?? 0));
  if (f === "soon") list = list.filter((e) => { const d = dday(earn[e.ticker]); return d != null && d >= 0 && d <= 30; }).sort((a, b) => dday(earn[a.ticker])! - dday(earn[b.ticker])!);
  if (f === "good") list = list.filter((e) => ["신뢰", "보통"].includes(tierOf(e)));
  if (f === "gap") list = list.filter((e) => e.cons_gap != null && !["보류", "발표됨"].includes(tierOf(e))).sort((a, b) => Math.abs(b.cons_gap!) - Math.abs(a.cons_gap!));
  const tab = (on: boolean) => `shrink-0 rounded-full px-3 py-1 ${on ? "bg-accent/20 font-bold text-accent" : "bg-panel2 text-muted hover:text-fg"}`;

  const cell = (e: RevEstimate) => {
    const tr = tierOf(e), r = estRange(e), nx = earn[e.ticker], d = dday(nx);
    const inRange = e.cons_gap != null && r != null && Math.abs(e.cons_gap) < r;
    const s = parseScen(mBy[e.ticker] ?? null);
    return { tr, r, nx, d, inRange, s, held: tr === "보류", faded: tr === "참고" || tr === "발표됨" || (tr === "추세" && (e.conf ?? 0) < 0.5) };
  };

  return (
    <div className="space-y-4">
      <PageHead
        title={<T ko="실적 추정" en="Earnings estimates" />}
        sub="진행 중인 분기 매출 — 세관 무역 흐름·회사 가이던스 기반 추정 vs 애널리스트 컨센서스"
        info={<Defs items={[
          ["추정", "매출과 같이 움직이는 무역 흐름(연관도 A·B, 예측력이 확인된 C)과 회사 가이던스 × 과거 초과율 중 백테스트가 가장 정확한 모델"],
          ["컨센 대비", "추정 ÷ 애널리스트 컨센서스 − 1. 컨센 금액은 제공처 약관상 표시하지 않음. 오차범위 안의 차이는 회색"],
          ["신뢰도", "최근 8~12분기 백테스트(그 분기 이전 데이터로만 예측)에서 실제 매출이 추정 ±5% 안에 든 비율 (표본이 적으면 깎음)"],
          ["신뢰·보통·참고", "신뢰 = 70% 이상 + 단순 추세보다 정확·외삽·단절 없음 / 보통 = 50% 이상 / 참고 = 그 밖"],
          ["추세", "무역 근거가 없거나 무역 모델이 단순 추세보다 부정확해 '직전 분기 전년비 유지'로 추정"],
          ["보류", "회사 가이던스 없이 모델만으로 낸 추정이 컨센서스와 25% 넘게 달라 외삽 가능성이 큼"],
          ["발표됨", "실적은 나왔지만 SEC 공시 반영 전이라 아직 다음 분기로 안 넘어간 추정"],
          ["주목", "신뢰 추정 + 컨센 차이 10% 이상(오차범위 밖) + 실적 발표 30일 이내"],
          ["밸류 Best·Base·Worst", "추정 실적 × 이 회사가 과거 3년 받은 배수(상위 25%·중앙·하위 25%)로 낸 예상 시가총액이 지금 주가 대비 몇 %인지. 주가는 하루 한 번 데이터 갱신 때 값(실시간 아님) — 종목 화면 '밸류에이션'에 날짜 표시"],
          ["실적 발표 ~", "회사가 아직 일정을 안 내 작년 같은 분기 기준으로 추정한 날짜"],
        ]} />}
      />
      <div className="flex gap-1.5 overflow-x-auto text-sm [scrollbar-width:none]">
        {FILTERS.map((x) => <Link key={x.k} href={x.k === "all" ? "/earnings" : `/earnings?f=${x.k}`} className={tab(f === x.k)}>{x.label}</Link>)}
      </div>

      {/* 모바일: 카드 목록 */}
      <div className="space-y-2 md:hidden">
        {list.map((e) => {
          const c = cell(e);
          return (
            <Link key={e.ticker} href={`/stocks/${encodeURIComponent(e.ticker)}#earnings`} className={`card block !p-3.5 ${c.faded || c.held ? "opacity-70" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <b className="truncate">{names[e.ticker] ?? e.ticker}</b>
                  <span className={`shrink-0 rounded px-1.5 text-[11px] ${TIER_STYLE[c.tr] ?? ""}`}>{c.tr}{e.conf != null && !c.held ? ` ${(e.conf * 100).toFixed(0)}%` : ""}</span>
                  {watchFlag(e, c.nx, done[e.ticker]) && <Badge tone="accent">주목</Badge>}
                </div>
                <span className="shrink-0 font-mono text-xs text-muted">{c.nx ? `${basis[e.ticker] ? "~" : ""}${c.nx.slice(5).replace("-", "/")} D-${c.d}` : ""}</span>
              </div>
              {c.held ? <p className="mt-1.5 text-xs text-muted">추정 보류 — {estCaution(e)[0]}</p> : (
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-muted">추정 매출</div><div className="font-mono text-sm font-bold">{money(e.est, e.currency)}</div><div className={`font-mono ${tone(e.est / e.last_actual - 1)}`}>{pct(e.est / e.last_actual - 1)}</div></div>
                  <div><div className="text-muted">컨센 대비</div><div className={`font-mono text-sm font-bold ${e.cons_gap == null || c.inRange ? "text-muted" : tone(e.cons_gap)}`}>{e.cons_gap == null ? "-" : pct(e.cons_gap)}</div><div className="text-muted">오차 ±{c.r == null ? "-" : (c.r * 100).toFixed(0)}%</div></div>
                  <div><div className="text-muted">밸류 Base</div><div className={`font-mono text-sm font-bold ${c.s ? tone(c.s.base.upside) : "text-muted"}`}>{c.s ? pct(c.s.base.upside, 0) : "-"}</div>
                    <div className="font-mono text-muted">{c.s ? <>B <span className={tone(c.s.bull.upside)}>{pct(c.s.bull.upside, 0)}</span> · W <span className={tone(c.s.bear.upside)}>{pct(c.s.bear.upside, 0)}</span></> : "생략"}</div></div>
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {/* 데스크톱: 표 */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="text-xs text-muted"><tr className="border-b border-line">
            <th className="py-2 text-left">종목</th><th className="text-left">분기</th><th className="text-right">추정 매출</th><th className="text-right">직전 분기 대비</th>
            <th className="text-right">컨센 대비</th><th className="text-right">오차범위</th><th className="text-right">신뢰도</th><th className="text-right" title="예상 시가총액이 지금 주가 대비 — Best / Base / Worst">밸류 Best / Base / Worst</th><th className="text-right">실적 발표</th>
          </tr></thead>
          <tbody className="font-mono">
            {list.map((e) => {
              const c = cell(e);
              return (
                <tr key={e.ticker} className={`border-b border-line/50 ${c.faded || c.held ? "text-xs opacity-60" : ""}`}>
                  <td className="py-2 font-sans"><Link className="font-bold hover:text-accent" href={`/stocks/${encodeURIComponent(e.ticker)}#earnings`}>{names[e.ticker] ?? e.ticker}</Link>
                    {watchFlag(e, c.nx, done[e.ticker]) && <Badge tone="accent" className="ml-1">주목</Badge>}</td>
                  <td className="text-xs text-muted">{e.q_start.slice(0, 7)}~{e.q_end.slice(0, 7)}</td>
                  {c.held ? <td colSpan={6} className="text-right font-sans text-muted"><span className={`mr-1 rounded px-1.5 py-0.5 ${TIER_STYLE["보류"]}`}>보류</span>{estCaution(e)[0]}</td> : (<>
                    <td className="text-right font-bold">{money(e.est, e.currency)}</td>
                    <td className={`text-right ${tone(e.est / e.last_actual - 1)}`}>{pct(e.est / e.last_actual - 1)}</td>
                    <td className={`text-right font-bold ${e.cons_gap == null || c.inRange ? "text-muted" : tone(e.cons_gap)}`} title={c.inRange ? "차이가 오차범위 안 — 의미 있는 차이로 보기 어려움" : undefined}>{e.cons_gap == null ? "-" : pct(e.cons_gap)}</td>
                    <td className="text-right text-xs text-muted">{c.r == null ? "-" : `±${(c.r * 100).toFixed(0)}%`}</td>
                    <td className="text-right text-xs" title={confNote(e)}><span className={`mr-1 rounded px-1.5 py-0.5 font-sans ${TIER_STYLE[c.tr]}`}>{c.tr}</span>{e.conf == null ? "-" : `${(e.conf * 100).toFixed(0)}%`}</td>
                    <td className="text-right" title={c.s ? `추정 × 3년 배수 시나리오 · ${pxLabel(mBy[e.ticker]) ?? ""} 주가 대비` : mBy[e.ticker]?.reason ?? undefined}>{c.s ? <>
                      <span className={`text-xs ${tone(c.s.bull.upside)}`}>{pct(c.s.bull.upside, 0)}</span> / <b className={tone(c.s.base.upside)}>{pct(c.s.base.upside, 0)}</b> / <span className={`text-xs ${tone(c.s.bear.upside)}`}>{pct(c.s.bear.upside, 0)}</span>
                    </> : <span className="text-muted">-</span>}</td>
                  </>)}
                  <td className="text-right text-xs text-muted" title={basis[e.ticker]}>{c.nx ? `${basis[e.ticker] ? "~" : ""}${c.nx.slice(5)} D-${c.d}` : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {skips.length > 0 && f === "all" && (
        <Fold summary={`추정하지 않은 종목 ${skips.length}개 — 이유 보기`} className="card !py-3">
          <ul className="space-y-1 text-sm">
            {skips.map((s) => (
              <li key={s.ticker} className="flex flex-wrap gap-x-2"><Link href={`/stocks/${encodeURIComponent(s.ticker)}`} className="font-bold hover:text-accent">{names[s.ticker] ?? s.ticker}</Link><span className="text-xs text-muted">{estCaution(s).join(" · ")}</span></li>
            ))}
          </ul>
        </Fold>
      )}
      <p className="text-xs text-muted">밸류 %는 하루 한 번 데이터 갱신 때의 주가 기준{mults[0]?.date ? ` (${mults[0].date} 계산)` : ""} — 실시간 아님. 한국 종목은 사업부문·연결 매출이라 컨센서스 비교가 없습니다. 투자 권유가 아닙니다.</p>
    </div>
  );
}
