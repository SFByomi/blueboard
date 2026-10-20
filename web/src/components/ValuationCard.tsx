"use client";

import type * as echarts from "echarts";
import { axis, baseOption, EChart } from "@/components/EChart";
import { InfoTip } from "@/components/InfoTip";
import { pct, tone } from "@/lib/format";
import { bandWord, capFmt, METRIC_HINT, METRIC_LABEL, mult, type MultipleHist, type MultipleNow, parseScen, priceFmt, pxLabel, SCEN } from "@/lib/valuation";

/** 밸류에이션: 추정 실적 × 과거 3년 배수 → Best·Base·Worst 예상 시가총액·주가, 배수 밴드 차트 (etl/multiples.py) */
export function ValuationCard({ m, hist }: { m: MultipleNow; hist: MultipleHist[] }) {
  const s = parseScen(m);
  const label = m.metric ? METRIC_LABEL[m.metric] : "배수";
  const h = hist.filter((x) => x.metric === m.metric);
  const xs = [...h.map((x) => x.q_end.slice(2, 7).replace("-", ".")), "지금"];
  const opt: echarts.EChartsOption | null = h.length && m.now != null ? {
    ...baseOption(),
    grid: { left: 40, right: 14, top: 16, bottom: 26 },
    legend: { show: false },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => (v == null ? "-" : `${Number(v).toFixed(1)}배`) },
    xAxis: { type: "category", data: xs, ...axis, axisLabel: { ...axis.axisLabel, fontSize: 10, hideOverlap: true } },
    yAxis: { type: "value", scale: true, ...axis, axisLabel: { ...axis.axisLabel, formatter: "{value}배" } },
    series: [
      {
        name: label, type: "line", data: [...h.map((x) => x.value), null], symbolSize: 5, lineStyle: { color: "#7c86ff", width: 2 }, itemStyle: { color: "#7c86ff" },
        markArea: m.p25 != null && m.p75 != null ? { silent: true, itemStyle: { color: "rgba(124,134,255,0.10)" }, data: [[{ yAxis: m.p25 }, { yAxis: m.p75 }]] } : undefined,
        markLine: m.p50 != null ? { silent: true, symbol: "none", lineStyle: { color: "#8a90ad", type: "dashed" }, label: { formatter: "3년 중앙", color: "#8a90ad", fontSize: 10, position: "insideStartTop" }, data: [{ yAxis: m.p50 }] } : undefined,
      },
      { name: "지금(추정 기준)", type: "scatter", data: [...h.map(() => null), m.now], symbolSize: 11, itemStyle: { color: "#f59e0b" },
        label: { show: true, position: "top", formatter: "지금", color: "#f59e0b", fontSize: 10 } },
    ],
  } : null;

  return (
    <div className="space-y-4">
      {s ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {SCEN.map(({ k, label: lb, how }) => {
              const x = s[k];
              return (
                <div key={k} className={`rounded-xl px-3 py-3 ${k === "base" ? "bg-accent/10 ring-1 ring-accent/40" : "bg-panel2"}`}>
                  <div className="flex items-center gap-1 text-xs font-bold text-muted">{lb}<InfoTip>{how}: {mult(x.mult)} × 연환산 {m.metric === "ev_ebit" ? "영업이익" : "매출"} {capFmt(x.metric, m.currency)} − 순부채 = 예상 시가총액. 주식 수로 나누면 주가.</InfoTip></div>
                  <div className="mt-1 text-[11px] text-muted">예상 시가총액</div>
                  <div className="font-mono text-base font-bold sm:text-xl">{capFmt(x.equity, m.currency)}</div>
                  <div className="mt-1 font-mono text-xs text-muted">주가 {priceFmt(x.price, m.currency)}</div>
                  <div className={`font-mono text-sm font-bold ${tone(x.upside)}`}>{pct(x.upside, 0)}</div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted">
            % = {pxLabel(m) ?? "계산 시점"} 주가 대비 · 하루 한 번(데이터 갱신 때) 계산 — 실시간 주가에 반응하지 않음.
            예상 시가총액은 주가와 무관(추정 실적 × 과거 배수)이라 하루 중 주가가 움직여도 그대로입니다.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-panel2 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <b className="text-fg">시나리오 생략</b> — {m.reason}
        </div>
      )}
      {m.now != null && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span>지금 <b className="font-mono">{mult(m.now)}</b> <span className="text-xs text-muted">({m.basis ?? "추정"} 연환산{pxLabel(m) ? ` · ${pxLabel(m)} 주가` : ""})</span></span>
          <span className="text-xs text-muted">3년 중앙 {mult(m.p50)} · 범위 {mult(m.p10)}~{mult(m.p90)} · {bandWord(m)}</span>
          {m.now_trail != null && <span className="text-xs text-muted">직전 분기 실적 기준 {mult(m.now_trail)}</span>}
        </div>
      )}
      {opt && <EChart option={opt} height={190} />}
      {m.metric && <p className="text-xs text-muted">{label}: {METRIC_HINT[m.metric]}. 음영 = 3년 중 가운데 50% 범위.</p>}
    </div>
  );
}
