"use client";

import { axis, baseOption, EChart } from "@/components/EChart";
import type { CheckItem } from "@/lib/check";

/** 시장 점검 카드의 작은 차트 — 선(점선)·막대를 한 축에 */
export function CheckChart({ chart, height = 190 }: { chart: CheckItem["chart"]; height?: number }) {
  const cat = chart.x === "category";
  const suffix = chart.unit === "$B" ? "B" : chart.unit;
  const opt = {
    ...baseOption(),
    grid: { left: 44, right: 12, top: 14, bottom: 50 },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: unknown) => (v == null ? "-" : `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`) },
    xAxis: cat ? { type: "category" as const, data: chart.lines[0].data.map(([d]) => d), ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } }
      : { type: "time" as const, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value" as const, scale: !chart.lines.some((l) => l.kind === "bar"), ...axis, axisLabel: { ...axis.axisLabel, formatter: chart.unit === "$B" ? "{value}" : `{value}${chart.unit}` } },
    series: chart.lines.map((l) => l.kind === "bar"
      ? { name: l.name, type: "bar" as const, barMaxWidth: 10, data: cat ? l.data.map(([, v]) => v) : l.data, itemStyle: { color: l.color } }
      : { name: l.name, type: "line" as const, showSymbol: false, connectNulls: false, data: cat ? l.data.map(([, v]) => v) : l.data,
          lineStyle: { color: l.color, width: l.dashed ? 1.5 : 2, type: l.dashed ? ("dashed" as const) : ("solid" as const) }, itemStyle: { color: l.color } }),
  };
  return <EChart option={opt} height={height} />;
}
