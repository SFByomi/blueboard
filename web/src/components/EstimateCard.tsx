import { PriceChart } from "@/components/ComputeCharts";
import { InfoTip } from "@/components/InfoTip";
import { Badge, CardHead, Defs, Fold } from "@/components/ui";
import { type Guide, type GuideWhy, type XCheck, confNote, dday, estGuide, estCaution, estExtrap, estRange, estReported, estTier, methodLabel, money, pct, TIER_STYLE, tone, watchFlag } from "@/lib/format";
import type { EstSkip, RevEstimate } from "@/lib/queries";

type Bt = { q_end: string; actual: number; pred: number; naive: number | null };
type Flow = { sid: string; lag: number; r2: number; months: number; extrap?: boolean };

const METHOD_INFO = (
  <Defs items={[
    ["흐름", "매출 연관도 A·B(와 단독 예측이 단순 추세보다 나은 C) 중 단독 예측 오차가 작은 1~3개"],
    ["모델", "전년비 회귀·금액 회귀와 각각의 편향 보정판(직전 4분기 실적/예측 배율), 두 계열 평균, 회사 가이던스 × 과거 초과율 중 백테스트(6분기 이상) 오차가 가장 작은 것"],
    ["신뢰도", "백테스트에서 실제 매출이 추정 ±5% 안에 든 비율(표본 보정). 오차범위 = 백테스트 오차의 80% 범위"],
    ["등급", "신뢰 = 70% 이상 + 단순 추세보다 정확·근거 R² 0.4 이상·외삽·단절 없음 / 보통 = 50% 이상 / 그 밖 참고"],
    ["컨센 대비", "컨센서스 금액은 제공처 약관상 표시하지 않고 차이(%)만"],
  ]} />
);

/** 진행 분기 매출 추정 · 컨센서스 괴리 · 백테스트 (etl/estimates.py) */
export function EstimateCard({ hist, labels, nextEarn, lastReported, skip }: { hist: RevEstimate[]; labels: Record<string, string>; nextEarn?: string | null; lastReported?: string | null; skip?: EstSkip }) {
  const e = hist.at(-1);
  if (!e) return skip ? (
    <div className="card min-w-0">
      <CardHead title="진행 분기 매출 추정" sub={skip.q_start ? `${skip.q_start.slice(0, 7)} ~ ${skip.q_end?.slice(0, 7)}` : undefined} right={<span className={`rounded px-2 py-0.5 text-xs ${TIER_STYLE["추정불가"]}`}>추정불가</span>} info={METHOD_INFO} />
      <p className="text-sm text-muted">{estCaution(skip).join(" · ")}</p>
    </div>
  ) : null;
  const trend = e.method === "trend";
  const guide = estGuide(e), byGuide = e.method.includes("guide");
  const bt: Bt[] = JSON.parse(e.backtest);
  const flows: Flow[] = JSON.parse(e.flows);
  const rep = estReported(e, lastReported);
  const tr = rep ? "발표됨" : estTier(e), ok = tr === "신뢰";
  const why = estCaution(e);
  const range = estRange(e);
  const d = dday(nextEarn);
  const watch = watchFlag(e, nextEarn, lastReported);
  const cur = e.currency;
  const recent = bt.slice(-4);
  const bias = recent.length ? recent.reduce((a, b) => a + (b.pred / b.actual - 1), 0) / recent.length : null; // 최근 4분기 평균 편향
  const gaps = hist.filter((h) => h.q_end === e.q_end && h.cons_gap != null);
  const qoq = e.est / e.last_actual - 1;
  const atGuide = e.cons_gap != null && guide && !guide.prelim && byGuide && guide.beat !== 0 && Math.abs(e.est / (1 + e.cons_gap) / ((guide.low + guide.high) / 2) - 1) < 0.02;
  const notes: React.ReactNode[] = [];
  if (!rep && !ok && why.length) notes.push(<>{tr === "보통" ? "신뢰가 아닌" : tr === "추세" ? "단순 추세로 추정한" : tr === "보류" ? "그 밖의" : "참고인"} 이유: {(tr === "보류" ? why.slice(1) : why).join(" · ")}</>);
  if (e.cons_gap != null && range != null && Math.abs(e.cons_gap) < range) notes.push(<>컨센 차이가 오차범위(±{(range * 100).toFixed(0)}%) 안 — 의미 있는 차이로 보기 어려움</>);
  if (atGuide) notes.push(<>컨센서스가 회사 가이던스 수준 — 차이는 대부분 이 회사의 평소 초과분({pct(guide!.beat)})이라 &lsquo;서프라이즈&rsquo;보다는 예상된 상회</>);
  if (bias != null && Math.abs(bias) >= 0.05) notes.push(<>최근 4분기 모델 편향 <span className={tone(bias)}>{pct(bias)}</span> — {bias < 0 ? "과소" : "과대"}추정 경향 감안</>);
  if (estExtrap(e)) notes.push(<span className="text-down">입력 무역값이 과거 범위를 크게 벗어남 — 외삽이라 &lsquo;참고&rsquo;</span>);

  return (
    <div className="card min-w-0 space-y-4">
      <CardHead
        title={rep ? "발표된 분기 매출 추정" : "진행 분기 매출 추정"} sub={`${e.q_start.slice(0, 7)} ~ ${e.q_end.slice(0, 7)}${nextEarn && !rep ? ` · 실적 발표 ${nextEarn} (D-${d})` : ""}`} info={METHOD_INFO}
        right={<span className="flex flex-wrap justify-end gap-1">
          {watch && <Badge tone="accent" title="신뢰 추정 · 컨센 괴리 10% 이상 · 실적 발표 30일 이내">주목</Badge>}
          <span className={`rounded px-2 py-0.5 text-xs ${TIER_STYLE[tr]}`} title={confNote(e)}>{tr}{e.conf != null ? ` ${(e.conf * 100).toFixed(0)}%` : ""}</span>
        </span>}
      />
      {tr === "보류" && <div className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">추정 보류 — {why[0]}. 아래 숫자는 모델 원값으로, 투자 판단 근거로 쓰지 마세요.</div>}
      {rep && <div className="rounded bg-panel2 px-3 py-2 text-xs text-muted">이 분기 실적은 이미 발표됐습니다. SEC 공시가 들어오면 백테스트에 반영하고 다음 분기 추정으로 넘어갑니다.</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <div className="text-xs text-muted">{trend ? "단순 추세 추정" : byGuide ? (e.method === "guide" ? "가이던스 기반 추정" : "가이던스·무역 결합 추정") : "무역 기반 추정"}</div>
          <div className="font-mono text-2xl font-bold">{money(e.est, cur)}</div>
          <div className="text-xs text-muted">직전 분기 {money(e.last_actual, cur)} 대비 <b className={tone(qoq)}>{pct(qoq)}</b> · 오차 ±{range != null ? `${(range * 100).toFixed(0)}%` : money(e.high - e.est, cur)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">컨센서스 대비</div>
          <div className={`font-mono text-2xl font-bold ${e.cons_gap == null ? "text-muted" : tone(e.cons_gap)}`}>{e.cons_gap == null ? "-" : pct(e.cons_gap)}</div>
          <div className="text-xs text-muted">{e.cons_gap == null ? "비교할 컨센서스 없음" : `${e.date} 기준`}</div>
        </div>
        <div>
          <div className="text-xs text-muted">{guide ? `회사 ${guide.prelim ? "잠정 실적" : guide.annual ? "연간 가이던스(환산)" : "가이던스"}` : "모델"}</div>
          {guide ? (<>
            <div className="font-mono text-base font-bold">{money(guide.low, cur)}{guide.high !== guide.low ? `~${money(guide.high, cur).replace(/^[$€]/, "")}` : ""}</div>
            <div className="text-xs text-muted">{guide.filed} 발표{!guide.prelim && guide.why?.n ? ` · 과거 ${guide.why.n}분기 실적이 중간값보다 ${pct(guide.why.min)}~${pct(guide.why.max)}` : ""}</div>
          </>) : (<>
            <div className="text-sm">{methodLabel(e.method)}</div>
            <div className="text-xs text-muted">평균 오차 {pct(e.mape, 1).replace("+", "")} · 단순 추세 {e.mape_naive == null ? "-" : pct(e.mape_naive, 1).replace("+", "")}</div>
          </>)}
        </div>
      </div>

      {notes.length > 0 && <ul className="space-y-1 rounded-lg bg-panel2 px-3 py-2 text-xs leading-relaxed text-muted">{notes.map((n, i) => <li key={i}>· {n}</li>)}</ul>}

      {guide?.xcheck && !guide.prelim && !rep && <XCheckNote xs={guide.xcheck} gq={(guide.low + guide.high) / 2 / e.last_actual - 1} eq={qoq} />}

      <Fold summary={`근거 자세히 — 모델·백테스트 ${bt.length}분기·사용한 흐름${gaps.length >= 2 ? "·컨센 차이 추이" : ""}`}>
        <div className="space-y-4">
          <div className="text-xs text-muted">
            모델: <span className="text-fg">{e.method === "guide" && guide && guide.beat === 0 ? "회사 가이던스 (중간값 그대로)" : methodLabel(e.method)}</span> · 평균 오차 {pct(e.mape, 1).replace("+", "")} · 단순 추세(직전 성장률 유지) 오차 {e.mape_naive == null ? "-" : pct(e.mape_naive, 1).replace("+", "")}
            {e.conf != null && !rep && <> · 신뢰도 {(e.conf * 100).toFixed(0)}% = 최근 {e.bt_n}분기 중 {e.hits}분기가 ±5% 안</>}
            {guide && !guide.prelim && guide.why && <GuideWhyNote g={guide} w={guide.why} byGuide={byGuide} />}
            {guide && !guide.prelim && !guide.why && <div className="mt-1">과거 실적은 가이던스 중간값보다 보통 <span className={tone(guide.beat)}>{pct(guide.beat)}</span>{byGuide ? " — 그만큼 반영" : " (이 종목은 무역 모델이 더 정확해 참고만)"}</div>}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-1 text-xs text-muted">백테스트 — 그 분기 이전 데이터로만 예측했을 때의 오차</div>
              <table className="w-full text-sm tnum">
                <thead className="text-xs text-muted"><tr className="border-b border-line">
                  <th className="py-1 text-left font-normal">분기</th><th className="text-right font-normal">실적</th><th className="text-right font-normal">모델</th><th className="text-right font-normal">단순 추세</th>
                </tr></thead>
                <tbody className="font-mono">
                  {bt.slice(-6).map((b) => (
                    <tr key={b.q_end} className="border-b border-line/50">
                      <td className="py-1 font-sans text-xs">{b.q_end.slice(0, 7)}</td>
                      <td className="text-right">{money(b.actual, cur)}</td>
                      <td className={`text-right ${tone(b.pred / b.actual - 1)}`}>{pct(b.pred / b.actual - 1)}</td>
                      <td className={`text-right ${b.naive == null ? "" : tone(b.naive / b.actual - 1)}`}>{b.naive == null ? "-" : pct(b.naive / b.actual - 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="min-w-0">
              <div className="mb-1 text-xs text-muted">사용한 흐름</div>
              {flows.length === 0 && <div className="text-sm text-muted">{byGuide ? `없음 — 회사 가이던스${guide && guide.beat === 0 ? "(중간값 그대로)" : "와 과거 초과율"}로 추정 (무역 모델보다 백테스트가 정확)` : "없음 — 매출 이력만으로 추정 (직전 분기 전년비 유지)"}</div>}
              <ul className="space-y-1 text-sm">
                {flows.map((f) => (
                  <li key={f.sid} className="flex justify-between gap-2">
                    <span className="truncate">{labels[f.sid] ?? f.sid}</span>
                    <span className="shrink-0 text-xs text-muted">{f.lag ? `${f.lag}분기 선행` : `동행 · ${f.months}/3개월`} · R² {f.r2.toFixed(2)}{f.extrap ? " · 외삽" : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {gaps.length >= 2 && (
            <div>
              <div className="mb-1 text-xs text-muted">컨센 대비 차이 추이 (이 분기)</div>
              <PriceChart unit="%" prefix="" height={150} lines={[{ name: "컨센 대비", color: "#7c86ff", points: gaps.map((h) => [h.date, +(h.cons_gap! * 100).toFixed(1)]) }]} />
            </div>
          )}
        </div>
      </Fold>
    </div>
  );
}

/** 가이던스 초과율 보정의 근거 — 과거 분기 범위와, 그 보정이 백테스트에서 실제로 더 정확했는지 */
function GuideWhyNote({ g, w, byGuide }: { g: Guide; w: GuideWhy; byGuide: boolean }) {
  const e = (v: number | null) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);
  const same = w.min != null && w.max != null && (w.min > 0 || w.max < 0);
  return (
    <div className="mt-1 space-y-0.5">
      {w.n > 0 && w.min != null && w.max != null && (
        <div>과거 {w.n}분기 실적 ÷ 가이던스 중간값: <span className={tone(w.min)}>{pct(w.min)}</span> ~ <span className={tone(w.max)}>{pct(w.max)}</span>
          {same ? ` (${w.n}분기 모두 ${w.min > 0 ? "상회" : "하회"})` : " (상회·하회 섞임)"}</div>
      )}
      {g.beat !== 0 ? (
        <div>→ 중앙값 <span className={tone(g.beat)}>{pct(g.beat)}</span> 반영. 근거: 그때그때 이전 분기만으로 같은 보정을 한 백테스트 오차 {e(w.mape_beat)} vs 가이던스 그대로 {e(w.mape_mid)}{byGuide ? "" : " (단, 이 종목은 무역 모델이 더 정확해 참고만)"}</div>
      ) : (
        <div>→ 보정 안 함: 백테스트에서 가이던스 그대로({e(w.mape_mid)})가 보정판({e(w.mape_beat)})보다 정확하거나 표본 부족</div>
      )}
    </div>
  );
}

/** 가이던스 교차 확인: 매출과 같은 분기에 움직이는 무역 흐름의 진행 분기 성장률을 가이던스·추정의 성장률과 나란히 */
export function xcheckVerdict(xs: XCheck[], gq: number, eq: number) {
  const top = xs[0];
  return top.qoq >= eq - 0.03 ? "추정(가이던스 상회) 쪽을 지지" : top.qoq <= gq + 0.03 ? "가이던스 수준 — 상회 폭은 작을 수 있음" : "가이던스와 추정 사이";
}
function XCheckNote({ xs, gq, eq }: { xs: XCheck[]; gq: number; eq: number }) {
  const top = xs[0];
  return (
    <div className="rounded-lg border border-line px-3 py-2.5 text-xs leading-relaxed">
      <div className="flex items-center gap-1.5 font-bold">무역 교차 확인
        <InfoTip>같은 분기 매출 전년비와 함께 움직이는(상관 0.7 이상) 무역 흐름의 진행 분기 전분기 대비 — 공표된 달만. 업계 합산·가격 효과가 섞여 있어 모델에는 넣지 않고 가이던스·추정이 맞는 방향인지 확인용으로만 씁니다.</InfoTip></div>
      <div className="mt-1.5 space-y-1">
        <div><span className="text-muted">전분기 대비 —</span> 가이던스 중간값 <b className={tone(gq)}>{pct(gq)}</b> · 우리 추정 <b className={tone(eq)}>{pct(eq)}</b></div>
        {xs.map((x) => (
          <div key={x.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-muted">{x.label}</span>
            <span><b className={tone(x.qoq)}>{pct(x.qoq)}</b> <span className="text-muted">({x.months}개월 · 전년비 {pct(x.yoy, 0)} · 매출 상관 {x.corr.toFixed(2)})</span></span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-muted">→ {top.label}는 {xcheckVerdict(xs, gq, eq)}.</div>
    </div>
  );
}
