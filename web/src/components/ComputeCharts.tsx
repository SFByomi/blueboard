"use client";

import type { EChartsOption } from "echarts";
import { axis, baseOption, EChart } from "./EChart";

export type Line = { name: string; color: string; points: [string, number][]; dashed?: boolean; step?: boolean };

/** 날짜축 가격 추이 (GPU 렌탈가·토큰 가격 공용) */
export function PriceChart({ lines, unit, height = 220 }: { lines: Line[]; unit: string; height?: number }) {
  const option: EChartsOption = {
    ...baseOption(),
    grid: { left: 52, right: 16, top: 24, bottom: 56 },
    tooltip: { ...(baseOption().tooltip as object), valueFormatter: (v) => (v == null ? "-" : `$${Number(v).toFixed(2)}`) },
    xAxis: { type: "time", ...axis, minInterval: 86400000, splitNumber: 4, axisLabel: { ...axis.axisLabel, formatter: "{MM}-{dd}", hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: "value", name: unit, nameTextStyle: { color: "#8a90ad", fontSize: 11 }, scale: true, ...axis },
    series: lines.map((l) => ({
      name: l.name, type: "line", data: l.points, step: l.step ? "end" : undefined, showSymbol: l.points.length < 3,
      symbolSize: 6, lineStyle: { color: l.color, width: 2, type: l.dashed ? "dashed" : "solid" }, itemStyle: { color: l.color },
    })),
  };
  return <EChart option={option} height={height} />;
}
