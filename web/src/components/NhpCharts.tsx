"use client";

import { axis, baseOption, EChart } from "@/components/EChart";
import { SegTabs } from "@/components/SegTabs";

export type NhpQuarter = { q: string; partial: boolean; kh: number; mu: number; vn: number; other: number; value: number; rev: number | null };
export type NhpMonth = { m: string; all: number | null; mu: number | null; asia: number | null };  // 마리당 단가(3개월 이동, 달러)

// 색은 계열이 확실히 다른 것만: 주황·파랑·초록·빨강
const C = { kh: "#f59e0b", mu: "#38bdf8", vn: "#22c55e", other: "#f87171" };
const zoom = (h = 16) => [
  { type: "inside" as const, preventDefaultMouseMove: false },
  { type: "slider" as const, height: h, bottom: 6, borderColor: "#2c3358", fillerColor: "rgba(56,189,248,0.15)", handleStyle: { color: "#38bdf8" }, textStyle: { color: "#8a90ad", fontSize: 10 }, brushSelect: false },
];
const qLabel = (x: NhpQuarter) => x.q.slice(2).replace("-", "") + (x.partial ? "*" : "");

/** 실험용 원숭이 미국 수입 — 원산지별 마릿수 · 마리당 단가 · 찰스리버 매출과 비교 */
export function NhpCharts({ quarters, months, events }: { quarters: NhpQuarter[]; months: NhpMonth[]; events: { q: string; label: string }[] }) {
  const cats = quarters.map(qLabel);
  const bar = (name: string, key: "kh" | "mu" | "vn" | "other") => ({ name, type: "bar" as const, stack: "n", data: quarters.map((x) => x[key]), itemStyle: { color: C[key] }, barMaxWidth: 22 });
  const marks = events.map((e) => ({ xAxis: qLabel(quarters.find((x) => x.q === e.q) ?? quarters[0]), label: { formatter: e.label } }));
  const count = {
    ...baseOption(),
    grid: { left: 44, right: 12, top: 34, bottom: 84 },
    legend: { ...baseOption().legend, bottom: 28 },
    dataZoom: zoom(),
    xAxis: { type: "category" as const, data: cats, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value" as const, ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}천` : `${v}`) } },
    series: [
      { ...bar("캄보디아", "kh"), markLine: { symbol: "none", silent: true, lineStyle: { color: "#8a90ad", type: "dashed" as const, width: 1 }, label: { color: "#aab0cc", fontSize: 10, position: "end" as const }, data: marks } },
      bar("모리셔스", "mu"), bar("베트남", "vn"), bar("그 외", "other"),
    ],
  };
  const line = (name: string, key: "all" | "mu" | "asia", color: string, dashed = false) => ({
    name, type: "line" as const, showSymbol: false, connectNulls: false, data: months.map((x) => [`${x.m}-15`, x[key] == null ? null : Math.round(x[key]!)]),
    lineStyle: { color, width: dashed ? 1.8 : 2.5, type: dashed ? ("dashed" as const) : ("solid" as const) }, itemStyle: { color },
  });
  const price = {
    ...baseOption(),
    grid: { left: 48, right: 12, top: 16, bottom: 84 },
    legend: { ...baseOption().legend, bottom: 28 },
    dataZoom: zoom(),
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: unknown) => (v == null ? "-" : `$${Number(v).toLocaleString()}`) },
    xAxis: { type: "time" as const, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value" as const, ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => `$${(v / 1000).toFixed(0)}K` } },
    series: [line("전체", "all", "#f59e0b"), line("모리셔스산", "mu", "#38bdf8", true), line("캄보디아·베트남산", "asia", "#22c55e", true)],
  };
  const withRev = quarters.filter((x) => x.rev != null && !x.partial);
  const crl = {
    ...baseOption(),
    grid: { left: 44, right: 44, top: 28, bottom: 84 },
    legend: { ...baseOption().legend, bottom: 28 },
    dataZoom: zoom(),
    xAxis: { type: "category" as const, data: withRev.map(qLabel), ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: [
      { type: "value" as const, name: "수입 $M", nameTextStyle: { color: "#8a90ad", fontSize: 10 }, ...axis },
      { type: "value" as const, name: "매출 $B", nameTextStyle: { color: "#8a90ad", fontSize: 10 }, ...axis, splitLine: { show: false }, min: (v: { min: number }) => Math.floor(v.min * 10 - 1) / 10 },
    ],
    series: [
      { name: "원숭이 수입 금액", type: "bar" as const, data: withRev.map((x) => +(x.value / 1e6).toFixed(1)), itemStyle: { color: "#38bdf8" }, barMaxWidth: 20 },
      { name: "찰스리버 분기 매출", type: "line" as const, yAxisIndex: 1, data: withRev.map((x) => +(x.rev! / 1e9).toFixed(3)), showSymbol: true, symbolSize: 5, lineStyle: { color: "#f59e0b", width: 2.5 }, itemStyle: { color: "#f59e0b" } },
    ],
  };
  return (
    <SegTabs size="xs" tabs={[
      { key: "count", label: "원산지별 마릿수", content: <><EChart option={count} height={330} /><p className="mt-1 text-[11px] text-muted">분기 합계(마리). * = 아직 석 달이 다 안 찬 분기</p></> },
      { key: "price", label: "마리당 단가", content: <><EChart option={price} height={330} /><p className="mt-1 text-[11px] text-muted">세관 신고 금액 ÷ 마릿수, 3개월 이동. 석 달 동안 들어온 게 없으면 선이 끊깁니다</p></> },
      { key: "crl", label: "찰스리버 매출과 비교", content: <><EChart option={crl} height={330} /><p className="mt-1 text-[11px] text-muted">막대 = 미국 전체 원숭이 수입 금액(분기, 왼쪽) · 선 = 찰스리버 분기 매출(오른쪽)</p></> },
    ]} />
  );
}
