import { T } from "@/components/Names";
import { PriceChart } from "@/components/ComputeCharts";
import { confNote, dday, estCaution, estExtrap, estRange, estReported, estTier, methodLabel, money, pct, TIER_STYLE, tone, watchFlag } from "@/lib/format";
import type { RevEstimate } from "@/lib/queries";

type Bt = { q_end: string; actual: number; pred: number; naive: number | null };
type Flow = { sid: string; lag: number; r2: number; months: number; extrap?: boolean };

/** 진행 분기 매출 추정 · 컨센서스 괴리 · 백테스트 (etl/estimates.py). 컨센 금액은 약관상 표시하지 않고 괴리율만 */
export function EstimateCard({ hist, labels, nextEarn, lastReported }: { hist: RevEstimate[]; labels: Record<string, string>; nextEarn?: string | null; lastReported?: string | null }) {
  const e = hist.at(-1);
  if (!e) return null;
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
  return (
    <div className="card min-w-0 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">{rep ? "발표된 분기 매출 추정" : "진행 분기 매출 추정"} <span className="text-sm font-normal text-muted">{e.q_start.slice(0, 7)} ~ {e.q_end.slice(0, 7)}</span></h2>
        <span className="flex flex-wrap gap-1">
          {watch && <span className="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent" title="신뢰 추정 · 컨센 괴리 10% 이상 · 실적 발표 30일 이내">주목</span>}
          <span className={`rounded px-2 py-0.5 text-xs ${TIER_STYLE[tr]}`} title={confNote(e)}>{tr}{e.conf != null ? ` · 신뢰도 ${(e.conf * 100).toFixed(0)}%` : ""} · 평균 오차 {pct(e.mape, 1).replace("+", "")}</span>
        </span>
      </div>
      {rep && <div className="rounded bg-panel2 px-3 py-2 text-xs text-muted">이 분기 실적은 이미 발표됐습니다. SEC 공시(10-Q·10-K)가 들어오면 실적과 비교해 백테스트에 반영하고 다음 분기 추정으로 넘어갑니다 — 그 전까지는 참고용입니다.</div>}
      {e.conf != null && !rep && <div className="text-xs text-muted">신뢰도 {(e.conf * 100).toFixed(0)}% — 최근 {e.bt_n}분기 백테스트 중 {e.hits}분기에서 실제 매출이 추정 ±5% 안에 들어옴 (표본이 적으면 보수적으로 깎음)</div>}
      {!rep && !ok && why.length > 0 && <div className="rounded bg-panel2 px-3 py-2 text-xs text-muted">{tr === "보통" ? "신뢰가 아닌" : "참고인"} 이유: {why.join(" · ")}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div><div className="text-xs text-muted">무역 기반 추정</div><div className="text-2xl font-bold">{money(e.est, cur)}</div>
          <div className="text-xs text-muted">오차범위 ±{money(e.high - e.est, cur)}{range != null ? ` (±${(range * 100).toFixed(0)}%)` : ""} · 직전 분기 대비 <span className={tone(e.est / e.last_actual - 1)}>{pct(e.est / e.last_actual - 1)}</span></div></div>
        <div><div className="text-xs text-muted">컨센서스 대비</div>
          <div className={`text-2xl font-bold ${e.cons_gap == null ? "text-muted" : tone(e.cons_gap)}`}>{e.cons_gap == null ? "-" : pct(e.cons_gap)}</div>
          <div className="text-xs text-muted">{e.cons_gap == null ? "비교 가능한 컨센서스 없음" : `추정 ÷ 컨센 − 1 (${e.date} 기준)`}</div>
          {e.cons_gap != null && range != null && Math.abs(e.cons_gap) < range && <div className="mt-1 text-xs text-muted">괴리가 오차범위(±{(range * 100).toFixed(0)}%) 안 — 의미 있는 차이로 보기 어려움</div>}
          {nextEarn && !rep && <div className="mt-1 text-xs text-muted">실적 발표 {nextEarn} (D-{d}) — 발표 후 실적과 비교해 정확도 갱신</div>}
          {bias != null && Math.abs(bias) >= 0.05 && (
            <div className="mt-1 text-xs text-muted">최근 4분기 모델 편향 <span className={tone(bias)}>{pct(bias)}</span> — {bias < 0 ? "과소" : "과대"}추정 경향 감안</div>
          )}</div>
        <div><div className="text-xs text-muted">모델</div><div className="text-sm">{methodLabel(e.method)}</div>
          <div className="text-xs text-muted">단순 추세(직전 성장률 유지) 오차 {e.mape_naive == null ? "-" : pct(e.mape_naive, 1).replace("+", "")}</div>
          {estExtrap(e) && <div className="mt-1 text-xs text-down">입력 무역값이 과거 범위를 크게 벗어남 — 외삽이라 &lsquo;참고&rsquo;</div>}</div>
      </div>

      {gaps.length >= 2 && (
        <div>
          <div className="mb-1 text-xs text-muted">컨센 대비 괴리율 추이 (이 분기)</div>
          <PriceChart unit="%" prefix="" height={160} lines={[{ name: "컨센 대비", color: "#7c86ff", points: gaps.map((h) => [h.date, +(h.cons_gap! * 100).toFixed(1)]) }]} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted">백테스트 — 그 분기 이전 데이터로만 적합해 예측</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted"><tr className="border-b border-line">
                <th className="py-1 text-left font-normal"><T ko="분기" en="Quarter" /></th><th className="text-right font-normal"><T ko="실적" en="Actual" /></th><th className="text-right font-normal"><T ko="모델" en="Model" /></th><th className="text-right font-normal"><T ko="단순 추세" en="Naive trend" /></th>
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
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted">사용한 흐름 (매출 연관도 A·B)</div>
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
      <p className="text-xs leading-relaxed text-muted">
        흐름: 매출 연관도 A·B 중 단독 예측 오차가 작은 상위 1~3개. 모델: 전년비 회귀·금액 회귀, 각각의 편향 보정판(직전 4분기 실적/예측 배율 — 백테스트도 그 시점까지의 오차로만 보정), 두 계열 평균(앙상블) 중 백테스트(6분기 이상) 오차가 가장 작은 쪽. 신뢰도 = 백테스트에서 실제 매출이 추정 ±5% 안에 든 비율(표본 보정), 오차범위 = 백테스트 오차의 80% 범위. &lsquo;신뢰&rsquo; = 신뢰도 70% 이상 + 단순 추세보다 정확 · 근거 흐름 R² 0.4 이상 · 과거 범위 안 · 최근 2년 금액 단절 없음, &lsquo;보통&rsquo; = 신뢰도 50% 이상(단순 추세보다 정확·외삽·단절 없을 때), 그 밖은 &lsquo;참고&rsquo;.
        추정은 금액 기준이라 수량 단위 변경(물량·단가 분해 불가)에는 영향받지 않습니다. 주목 = 신뢰 추정이면서 컨센 괴리 10% 이상, 실적 발표 30일 이내.
        컨센서스 금액은 데이터 제공처 약관상 표시하지 않고 괴리율만 보여줍니다. 투자 권유가 아닙니다.
      </p>
    </div>
  );
}
