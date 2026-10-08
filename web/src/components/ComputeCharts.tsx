"use client";

import type { EChartsOption } from "echarts";
import { axis, baseOption, EChart } from "./EChart";

export type Line = { name: string; color: string; points: [string, number][]; dashed?: boolean; step?: boolean };

/** 날짜축 가격 추이 (GPU 렌탈가·토큰 가격 공용) */
export function PriceChart({ lines, unit, height = 220, prefix = "$" }: { lines: Line[]; unit: string; height?: number; prefix?: string }) {
  const option: EChartsOption = {
    ...baseOption(),
    grid: { left: 52, right: 16, top: 24, bottom: 56 },
    tooltip: { ...(baseOption().tooltip as object), valueFormatter: (v) => (v == null ? "-" : `${prefix}${Number(v).toFixed(prefix ? 2 : 1)}`) },
    xAxis: { type: "time", ...axis, minInterval: 86400000, splitNumber: 4, axisLabel: { ...axis.axisLabel, formatter: { year: "{yyyy}", month: "{yy}.{MM}", day: "{MM}-{dd}" }, hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: "value", name: unit, nameTextStyle: { color: "#8a90ad", fontSize: 11 }, scale: true, ...axis },
    series: lines.map((l) => ({
      name: l.name, type: "line", data: l.points, step: l.step ? "end" : undefined, showSymbol: l.points.length < 3,
      symbolSize: 6, lineStyle: { color: l.color, width: 2, type: l.dashed ? "dashed" : "solid" }, itemStyle: { color: l.color },
    })),
  };
  return <EChart option={option} height={height} />;
}

/** 월별 건수 막대 + 3개월 평균 선 (예: 랜섬웨어 피해 공개 건수) */
export function CountBars({ months, values, name, height = 260 }: { months: string[]; values: number[]; name: string; height?: number }) {
  const avg3 = values.map((_, i) => (i >= 2 ? +((values[i] + values[i - 1] + values[i - 2]) / 3).toFixed(0) : null));
  const option: EChartsOption = {
    ...baseOption(),
    grid: { left: 48, right: 16, top: 24, bottom: 56 },
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false } },
    yAxis: { type: "value", name: "건", nameTextStyle: { color: "#8a90ad", fontSize: 11 }, ...axis },
    series: [
      { name, type: "bar", data: values, barMaxWidth: 10, itemStyle: { color: "#60a5fa" } },
      { name: "3개월 평균", type: "line", data: avg3, symbol: "none", lineStyle: { color: "#f87171", width: 2 }, itemStyle: { color: "#f87171" } },
    ],
  };
  return <EChart option={option} height={height} />;
}

export type Bar = { name: string; color: string; values: (number | null)[] };
/** 월별 누적 막대(왼쪽 축) + 선(오른쪽 축) — 전력 인프라 대시보드 공용 */
export function StackChart({ months, bars, lines = [], left, right, height = 300, dots = false }: {
  months: string[]; bars: Bar[]; lines?: Bar[]; left: string; right?: string; height?: number; dots?: boolean;
}) {
  const option: EChartsOption = {
    ...baseOption(),
    grid: { left: 56, right: right ? 52 : 16, top: 28, bottom: 56 },
    xAxis: { type: "category", data: months, ...axis, splitLine: { show: false } },
    yAxis: [
      { type: "value", name: left, nameTextStyle: { color: "#8a90ad", fontSize: 11 }, ...axis },
      ...(right ? [{ type: "value" as const, name: right, nameTextStyle: { color: "#8a90ad", fontSize: 11 }, ...axis, splitLine: { show: false } }] : []),
    ],
    series: [
      ...bars.map((b) => ({ name: b.name, type: "bar" as const, stack: "s", data: b.values, barMaxWidth: 10, itemStyle: { color: b.color } })),
      ...lines.map((l) => ({ name: l.name, type: "line" as const, yAxisIndex: right ? 1 : 0, data: l.values, symbol: dots ? "circle" : "none", symbolSize: 7, connectNulls: true, lineStyle: { color: l.color, width: 2 }, itemStyle: { color: l.color } })),
    ],
  };
  return <EChart option={option} height={height} />;
}
