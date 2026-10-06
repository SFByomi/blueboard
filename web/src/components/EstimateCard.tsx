import { PriceChart } from "@/components/ComputeCharts";
import { estReliable, money, pct, tone } from "@/lib/format";
import type { RevEstimate } from "@/lib/queries";

type Bt = { q_end: string; actual: number; pred: number; naive: number | null };
type Flow = { sid: string; lag: number; r2: number; months: number };

/** 진행 분기 매출 추정 · 컨센서스 괴리 · 백테스트 (etl/estimates.py). 컨센 금액은 약관상 표시하지 않고 괴리율만 */
export function EstimateCard({ hist, labels }: { hist: RevEstimate[]; labels: Record<string, string> }) {
  const e = hist.at(-1);
  if (!e) return null;
  const bt: Bt[] = JSON.parse(e.backtest);
  const flows: Flow[] = JSON.parse(e.flows);
  const ok = estReliable(e);
  const cur = e.currency;
  const recent = bt.slice(-4);
  const bias = recent.length ? recent.reduce((a, b) => a + (b.pred / b.actual - 1), 0) / recent.length : null; // 최근 4분기 평균 편향
  const gaps = hist.filter((h) => h.q_end === e.q_end && h.cons_gap != null);
  return (
    <div className="card min-w-0 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">진행 분기 매출 추정 <span className="text-sm font-normal text-muted">{e.q_start.slice(0, 7)} ~ {e.q_end.slice(0, 7)}</span></h2>
        <span className={`rounded px-2 py-0.5 text-xs ${ok ? "bg-up/20 text-up" : "bg-panel2 text-muted"}`}>{ok ? "신뢰" : "참고"} · 백테스트 오차 {pct(e.mape, 1).replace("+", "")}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><div className="text-xs text-muted">무역 기반 추정</div><div className="text-2xl font-bold">{money(e.est, cur)}</div>
          <div className="text-xs text-muted">±{money(e.high - e.est, cur)} · 직전 분기 대비 <span className={tone(e.est / e.last_actual - 1)}>{pct(e.est / e.last_actual - 1)}</span></div></div>
        <div><div className="text-xs text-muted">컨센서스 대비</div>
          <div className={`text-2xl font-bold ${e.cons_gap == null ? "text-muted" : tone(e.cons_gap)}`}>{e.cons_gap == null ? "-" : pct(e.cons_gap)}</div>
          <div className="text-xs text-muted">{e.cons_gap == null ? "비교 가능한 컨센서스 없음" : `추정 ÷ 컨센 − 1 (${e.date} 기준)`}</div>
          {bias != null && Math.abs(bias) >= 0.05 && (
            <div className="mt-1 text-xs text-muted">최근 4분기 모델 편향 <span className={tone(bias)}>{pct(bias)}</span> — {bias < 0 ? "과소" : "과대"}추정 경향 감안</div>
          )}</div>
        <div><div className="text-xs text-muted">모델</div><div className="text-sm">{e.method.startsWith("level") ? "무역 금액 회귀 (최근 12분기)" : "무역 전년비 회귀"}{e.method.endsWith("+bias") && <span className="text-muted"> + 최근 4분기 편향 보정</span>}</div>
          <div className="text-xs text-muted">단순 추세(직전 성장률 유지) 오차 {e.mape_naive == null ? "-" : pct(e.mape_naive, 1).replace("+", "")}</div></div>
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
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-xs text-muted">사용한 흐름 (매출 연관도 A·B)</div>
          <ul className="space-y-1 text-sm">
            {flows.map((f) => (
              <li key={f.sid} className="flex justify-between gap-2">
                <span className="truncate">{labels[f.sid] ?? f.sid}</span>
                <span className="shrink-0 text-xs text-muted">{f.lag ? `${f.lag}분기 선행` : `동행 · ${f.months}/3개월`} · R² {f.r2.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        모델: 무역 전년비 회귀·금액 회귀와 각각의 편향 보정판(직전 4분기 실적/예측 배율을 곱함 — 백테스트도 그 시점까지의 오차로만 보정) 중 백테스트 오차가 가장 작은 쪽. 오차 12% 이하이면서 단순 추세보다 나을 때 &lsquo;신뢰&rsquo;.
        컨센서스 금액은 데이터 제공처 약관상 표시하지 않고 괴리율만 보여줍니다. 투자 권유가 아닙니다.
      </p>
    </div>
  );
}
