"use client";

import { axis, baseOption, EChart } from "@/components/EChart";
import { InfoTip } from "@/components/InfoTip";

export type CycleSide = {
  label: string;
  stockPeak: string;                 // 주가 고점 주(YYYY-MM-DD)
  stock: [number, number][];         // [주가 고점 기준 주(週) 차이, 고점 = 100]
  unit: [number, number][];          // [주가 고점 기준 주 차이, 단가 고점 = 100]
  rows: Record<string, string>;      // 표: 항목 → 값
};
const ROWS = ["주가 고점", "주가 저점 · 지금", "출하 단가 고점", "분기 매출", "회사 코멘트"] as const;
const C = { old: "#f59e0b", now: "#38bdf8" };  // 2018 주황 · 이번 파랑 — 계열이 다른 색

/** 2018년 사이클과 이번 사이클을 '주가 고점 = 0주'로 맞춰 겹침 — 실선 주가, 점선 한국 DRAM 수출 단가 */
export function CycleOverlay({ old, now }: { old: CycleSide; now: CycleSide }) {
  const line = (s: CycleSide, color: string) => [
    { name: `${s.label} 주가`, type: "line" as const, showSymbol: false, data: s.stock, lineStyle: { color, width: 2 }, itemStyle: { color } },
    { name: `${s.label} 출하 단가`, type: "line" as const, showSymbol: false, data: s.unit, lineStyle: { color, width: 1.5, type: "dashed" as const }, itemStyle: { color } },
  ];
  const opt = {
    ...baseOption(),
    grid: { left: 40, right: 14, top: 16, bottom: 70 },
    tooltip: { ...baseOption().tooltip, valueFormatter: (x: unknown) => (x == null ? "-" : `${Number(x).toFixed(0)}`) },
    xAxis: { type: "value" as const, min: -78, max: 52, interval: 26, ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => (v === 0 ? "주가 고점" : `${v > 0 ? "+" : "−"}${Math.abs(v / 4.33).toFixed(0)}개월`) } },
    yAxis: { type: "value" as const, ...axis, max: 100, min: 0 },
    series: [
      ...line(old, C.old), ...line(now, C.now),
      { type: "line" as const, data: [], markLine: { symbol: "none", silent: true, lineStyle: { color: "#8a90ad", type: "dotted" as const }, label: { show: false }, data: [{ xAxis: 0 }] } },
    ],
  };
  return (
    <section id="cycle" className="card min-w-0 scroll-mt-28 space-y-3">
      <div>
        <h2 className="flex flex-wrap items-center gap-x-1.5 font-bold">2018년 사이클과 겹쳐 보기 — DRAM·마이크론
          <InfoTip>2016~2018년 클라우드 서버 사이클과 이번 사이클을 마이크론 주가 고점 주를 0으로 맞춰 겹쳤습니다. 실선 = 주가(고점 = 100), 점선 = 한국 DRAM 수출 단가(3개월 이동, 그 사이클의 고점 = 100). 2018년에는 현물가(3월) → 주가(6월) → 분기 매출(8월 분기) → 출하 단가(10월) 순으로 꺾였고, 회사는 12월 실적 발표에서야 수요 약화를 인정했습니다. 사이클마다 길이와 깊이는 다르며, 과거 경로가 반복된다는 뜻이 아닙니다.</InfoTip>
        </h2>
        <p className="text-xs text-muted">가로 = 주가 고점부터의 기간 · 실선 주가 · 점선 출하 단가 — 각자 고점 = 100</p>
      </div>
      <EChart option={opt} height={300} />
      <dl className="divide-y divide-line text-xs">
        {ROWS.map((k) => (
          <div key={k} className="grid gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[7rem_1fr_1fr]">
            <dt className="text-muted">{k}</dt>
            <dd><span className="mr-1 font-bold" style={{ color: C.old }}>2018</span>{old.rows[k] ?? "-"}</dd>
            <dd><span className="mr-1 font-bold" style={{ color: C.now }}>이번</span>{now.rows[k] ?? "-"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
