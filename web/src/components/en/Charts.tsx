"use client";

import type * as echarts from "echarts";
import { axis, baseOption, EChart } from "@/components/EChart";

const big = (v: number, cur: string) => {
  const s = cur === "KRW" ? "₩" : "$", a = Math.abs(v);
  return a >= 1e12 ? `${s}${(v / 1e12).toFixed(1)}T` : a >= 1e9 ? `${s}${(v / 1e9).toFixed(1)}B` : `${s}${(v / 1e6).toFixed(0)}M`;
};

/** 분기 매출(실제) + 진행 분기 추정(범위는 툴팁) */
export function RevenueChart({ quarters, est, currency }: { quarters: { label: string; value: number }[]; est: { label: string; value: number; low: number; high: number } | null; currency: string }) {
  const xs = [...quarters.map((q) => q.label), ...(est ? [`${est.label} est`] : [])];
  const opt: echarts.EChartsOption = {
    ...baseOption(),
    grid: { left: 56, right: 12, top: 16, bottom: 28 },
    legend: { show: false },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => (v == null ? "-" : big(Number(v), currency)) },
    xAxis: { type: "category", data: xs, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => big(v, currency) } },
    series: [{
      type: "bar", name: "Revenue", barMaxWidth: 34,
      data: [...quarters.map((q) => ({ value: q.value, itemStyle: { color: "#3a4170" } })), ...(est ? [{ value: est.value, itemStyle: { color: "#7c86ff" } }] : [])],
      markLine: est ? { silent: true, symbol: "none", lineStyle: { color: "#8a90ad", type: "dashed" }, label: { show: false }, data: [{ yAxis: est.low }, { yAxis: est.high }] } : undefined,
    }],
  };
  return <EChart option={opt} height={240} />;
}

/** 핵심 흐름 월별 금액 24개월 — 최근 3개월·1년 전 같은 3개월 강조 */
export function FlowChart({ months, values }: { months: string[]; values: number[] }) {
  const n = values.length;
  const opt: echarts.EChartsOption = {
    ...baseOption(),
    grid: { left: 56, right: 12, top: 16, bottom: 28 },
    legend: { show: false },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v) => (v == null ? "-" : big(Number(v), "USD")) },
    xAxis: { type: "category", data: months, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => big(v, "USD") } },
    series: [{
      type: "bar", name: "Monthly value", barMaxWidth: 18,
      data: values.map((v, i) => ({ value: v, itemStyle: { color: i >= n - 3 ? "#7c86ff" : i >= n - 15 && i < n - 12 ? "#4b527e" : "#272d4d" } })),
    }],
  };
  return <EChart option={opt} height={220} />;
}
