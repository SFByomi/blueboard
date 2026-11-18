"use client";

import { useMemo, useState } from "react";
import { axis, baseOption, EChart } from "@/components/EChart";
import { InfoTip } from "@/components/InfoTip";
import type { MacroObs } from "@/lib/queries";

const SERIES = [["DGS10", "10년물", "#3b82f6"], ["DGS2", "2년물", "#d95926"], ["DGS30", "30년물", "#8a90ad"], ["DGS3MO", "3개월", "#22c55e"]] as const;
const PERIODS = [["1y", "1년", 365], ["3y", "3년", 3 * 365], ["10y", "10년", 10 * 365]] as const;
type Pt = [string, number];

/** 미 국채 금리(FRED DGS, 일별 %) — 10년물·2년물·장단기 금리차. 곡선 전체·회사채 시장은 신용 탭 */
export function RatesSection({ rows }: { rows: MacroObs[] }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("3y");
  const s = useMemo(() => {
    const m: Record<string, Pt[]> = {};
    for (const r of rows) (m[r.series] ??= []).push([r.date, r.value]);
    return m;
  }, [rows]);
  const ten = s.DGS10 ?? [];
  if (!ten.length) return <div className="card text-sm text-muted">수집 전입니다.</div>;
  const last = ten.at(-1)![0];
  const at = (sid: string, daysAgo: number) => {  // daysAgo일 전 또는 그 직전 영업일 값
    const t = Date.parse(last) - daysAgo * 864e5;
    return [...(s[sid] ?? [])].reverse().find(([d]) => Date.parse(d) <= t)?.[1] ?? null;
  };
  const bp = (a: number | null, b: number | null) => (a == null || b == null ? "-" : `${a - b >= 0 ? "+" : "−"}${Math.abs(Math.round((a - b) * 100))}bp`);
  const d2 = new Map(s.DGS2 ?? []);
  const slope: Pt[] = ten.filter(([d]) => d2.has(d)).map(([d, v]) => [d, +(v - d2.get(d)!).toFixed(2)]);
  const sl = (daysAgo: number) => { const a = at("DGS10", daysAgo), b = at("DGS2", daysAgo); return a == null || b == null ? null : a - b; };
  const tiles = [...SERIES.map(([sid, name]) => [name, at(sid, 0), at(sid, 30), at(sid, 365)] as const), ["10년 − 2년", sl(0), sl(30), sl(365)] as const];
  const from = new Date(Date.parse(last) - PERIODS.find((p) => p[0] === period)![2] * 864e5).toISOString().slice(0, 10);
  const cut = (pts: Pt[]) => pts.filter(([d]) => d >= from);
  const opt = {
    ...baseOption(),
    grid: { left: 44, right: 44, top: 24, bottom: 56 },
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: unknown) => (v == null ? "-" : `${Number(v).toFixed(2)}%`) },
    xAxis: { type: "time" as const, ...axis, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: [{ type: "value" as const, name: "%", scale: true, ...axis }, { type: "value" as const, name: "%p", ...axis, splitLine: { show: false } }],
    series: [
      ...SERIES.slice(0, 2).map(([sid, name, c]) => ({ name, type: "line" as const, showSymbol: false, data: cut(s[sid] ?? []), lineStyle: { color: c, width: 2 }, itemStyle: { color: c } })),
      { name: "10년 − 2년", type: "line" as const, yAxisIndex: 1, showSymbol: false, data: cut(slope), lineStyle: { color: "#f59e0b", width: 1.5 }, itemStyle: { color: "#f59e0b" }, areaStyle: { color: "#f59e0b22" } },
    ],
  };
  return (
    <div className="card min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([k, v, m1, y1]) => (
          <div key={k} className="rounded-lg bg-panel2 p-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="font-mono text-lg font-bold">{v == null ? "-" : `${v.toFixed(2)}${k.includes("−") ? "%p" : "%"}`}</div>
            <div className="text-[11px] text-muted">1달 {bp(v, m1)} · 1년 {bp(v, y1)}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-bold">10년물·2년물 · 장단기 금리차
          <InfoTip>미 재무부 국채 만기수익률(일별, FRED DGS). 금리차 = 10년물 − 2년물(오른쪽 축) — 0 아래(역전)는 시장이 앞으로 금리 인하·경기 둔화를 본다는 뜻으로 흔히 읽힘. 10년물은 주식 할인율·주담대 금리의 기준. {last} 기준. 전체 만기 곡선과 회사채 시장은 신용 탭.</InfoTip>
        </div>
        <div className="flex gap-1 rounded-lg bg-panel2 p-1 text-xs">
          {PERIODS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)} className={`rounded-md px-2.5 py-1 ${period === k ? "bg-panel font-bold text-fg shadow" : "text-muted hover:text-fg"}`}>{l}</button>
          ))}
        </div>
      </div>
      <EChart option={opt} height={300} />
    </div>
  );
}
