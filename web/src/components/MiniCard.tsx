"use client";

import type * as echarts from "echarts";
import { baseOption, EChart } from "@/components/EChart";

/** 기준선(점선 + 이름) — 차트 안에서 '여기 넘으면 위험'을 바로 읽게 */
export const refLine = (y: number, label: string, color: string) =>
  ({ yAxis: y, label: { formatter: label, position: "insideEndTop" as const, color, fontSize: 10, backgroundColor: "#151a33cc", padding: [1, 3] }, lineStyle: { color, type: "dashed" as const, width: 1 } });
export const mini = (o: echarts.EChartsOption, legend = false): echarts.EChartsOption =>
  ({ ...baseOption(), ...o, grid: { left: 44, right: 12, top: 18, bottom: legend ? 44 : 24 }, ...(legend ? {} : { legend: { show: false } }) });

/** 지표 하나 = 카드 하나: 질문형 제목 · 지금 값 · 읽는 법 한 줄 · 축 하나짜리 차트 */
export function Mini({ title, value, tone = "", sub, note, option, empty }: { title: string; value: React.ReactNode; tone?: string; sub?: string; note: string; option?: echarts.EChartsOption; empty?: string }) {
  return (
    <div className="card min-w-0">
      <h4 className="text-sm text-muted">{title}</h4>
      <p className="mt-1 font-mono text-2xl font-bold"><span className={tone}>{value}</span>{sub && <span className="ml-2 text-xs font-normal text-muted">{sub}</span>}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{note}</p>
      {option ? <EChart option={option} height={190} /> : <p className="mt-4 text-sm text-muted">{empty}</p>}
    </div>
  );
}
