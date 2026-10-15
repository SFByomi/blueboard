"use client";

import type * as echarts from "echarts";
import { useMemo, useState } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import type { InflationRow } from "@/lib/queries";

const COMPS = [
  { key: "services", label: "서비스", color: "#3b82f6", note: "에너지 제외 서비스(주거·의료·운송 등)" },
  { key: "goods", label: "공산품", color: "#8b5cf6", note: "식품·에너지 제외 상품" },
  { key: "food", label: "식품", color: "#22c55e", note: "식품" },
  { key: "energy", label: "에너지", color: "#f59e0b", note: "휘발유·전기·가스" },
] as const;
const PERIODS = [["all", "전체", 999], ["1y", "1년", 12], ["6m", "6개월", 6], ["3m", "3개월", 3]] as const;

function Chips<T extends string>({ value, set, items }: { value: T; set: (v: T) => void; items: readonly (readonly [T, string])[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(([v, l]) => (
        <button key={v} onClick={() => set(v)} className={`rounded-lg border px-3 py-1 text-sm ${value === v ? "border-accent bg-accent/15 text-fg" : "border-line text-muted hover:text-fg"}`}>{l}</button>
      ))}
    </div>
  );
}

/** 미국 물가 기여도 — 막대 = 구성요소 기여도(%p, 합 = 물가 상승률), 선 = 발표 물가 상승률 */
export function InflationSection({ rows }: { rows: InflationRow[] }) {
  const [measure, setMeasure] = useState<"CPI" | "PCE">("CPI");
  const [basis, setBasis] = useState<"headline" | "core">("headline");
  const [kind, setKind] = useState<"yoy" | "mom">("yoy");
  const [period, setPeriod] = useState<"all" | "1y" | "6m" | "3m">("1y");
  const [hover, setHover] = useState<number | null>(null);
  const comps = basis === "core" ? COMPS.slice(0, 2) : COMPS;
  const data = useMemo(() => {
    const r = rows.filter((x) => x.measure === measure && x.basis === basis && x.kind === kind);
    return r.slice(-(PERIODS.find((p) => p[0] === period)![2]));
  }, [rows, measure, basis, kind, period]);
  const cur = data[hover ?? data.length - 1];
  const p = (v: number | null | undefined, d = 2) => (v == null ? "-" : (v * 100).toFixed(d));

  const option = useMemo<echarts.EChartsOption>(() => ({
    ...baseOption(),
    grid: { left: 44, right: 16, top: 16, bottom: 30 },
    legend: { show: false },
    tooltip: { show: true, trigger: "axis", showContent: false },
    xAxis: { type: "category", data: data.map((r) => r.month.slice(2).replace("-", ".")), ...axis },
    yAxis: { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${v}` }, name: "% · %p", nameTextStyle: { color: "#8a90ad", fontSize: 11 } },
    series: [
      ...comps.map((c) => ({ name: c.label, type: "bar" as const, stack: "c", barMaxWidth: 28, itemStyle: { color: c.color },
        data: data.map((r) => (r[c.key] == null ? null : +(r[c.key]! * 100).toFixed(3))) })),
      { name: "물가", type: "line" as const, data: data.map((r) => +(r.total * 100).toFixed(3)), symbol: "circle", symbolSize: 4,
        lineStyle: { color: "#e6e8f2", width: 2 }, itemStyle: { color: "#e6e8f2" }, z: 10 },
    ],
  }), [data, comps]);

  if (!rows.length) return null;
  const lab = `${measure} ${basis === "core" ? "코어" : "헤드라인"} ${kind === "yoy" ? "전년비" : "전월비"}`;
  return (
    <div className="card min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Chips value={measure} set={setMeasure} items={[["CPI", "CPI"], ["PCE", "PCE"]] as const} />
          <Chips value={basis} set={setBasis} items={[["headline", "헤드라인"], ["core", "코어"]] as const} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Chips value={kind} set={setKind} items={[["yoy", "전년비"], ["mom", "전월비"]] as const} />
          <Chips value={period} set={setPeriod} items={PERIODS.map(([v, l]) => [v, l] as const)} />
        </div>
      </div>
      {cur && (
        <div className="font-mono text-sm">
          <div><span className="font-sans text-muted">{cur.month.replace("-", ".")} · {lab}</span> <b className="text-base">{p(cur.total)}%</b></div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {comps.map((c) => <span key={c.key} style={{ color: c.color }} title={c.note}>{c.label} {p(cur[c.key])}</span>)}
            <span className="font-sans text-muted">(%p)</span>
          </div>
        </div>
      )}
      <div onMouseLeave={() => setHover(null)}>
        <EChartHover option={option} onHover={setHover} />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        막대 = 구성요소 기여도(%p, 합계 = 물가 상승률), 선 = 발표된 상승률. 서비스는 에너지 제외 서비스, 공산품은 식품·에너지 제외 상품.
        CPI는 지수에서 해마다 상대 중요도를 역산(전년 12월 기준 고정 가중)하고, PCE는 명목 지출 비중 × 가격 변화로 계산 — 구성요소 합을 발표치에 맞춰 조정(차이 수 bp).
        전월비는 계절조정. 출처 BLS·BEA (FRED). CPI는 발표 당일 저녁(한국 시간), PCE는 한 달 늦게 반영.
      </p>
    </div>
  );
}

/** 마우스가 가리킨 달을 위 숫자에 반영 */
function EChartHover({ option, onHover }: { option: echarts.EChartsOption; onHover: (i: number | null) => void }) {
  return <EChart option={option} height={320} onAxis={onHover} />;
}
